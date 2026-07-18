import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, type AiMessage, type AiProvider } from "@leadvirt/ai";
import { Prisma } from "@leadvirt/db";
import { resolveAiBusinessIdentity } from "@leadvirt/knowledge";
import {
  decryptIntegrationCredentials,
  WebhookAdapter,
  type NormalizedInboundMessage,
  type SendMessageResult,
} from "@leadvirt/integrations";
import type { AiReplyEnqueueRequest } from "@leadvirt/types";
import { PrismaService } from "../database/prisma.service.js";
import { WorkflowsService } from "../workflows/workflows.service.js";
import { AiReplyQueueService } from "../ai/ai-reply-queue.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../../common/webhook-event-claim.js";
import { assertTenantRuntimeActive } from "../../common/tenant-lifecycle.js";

type GenericWebhookChannel = Prisma.ChannelGetPayload<{
  include: { tenant: true };
}>;

type GenericWebhookConversation = Prisma.ConversationGetPayload<{
  include: {
    lead: true;
    messages: { orderBy: { createdAt: "asc" } };
  };
}>;

type GenericWebhookAiDispatch =
  | { queued: true; eventId: string; jobId: string }
  | { queued: false; reason: string };

export interface GenericWebhookResult {
  ok: true;
  duplicate: boolean;
  ignored?: boolean;
  reason?: string;
  conversationId: string;
  leadId: string | null;
  inboundMessageId: string | null;
  aiMessageId: string | null;
  outboundStatus: SendMessageResult["status"] | "skipped";
  reply: string | null;
}

const adapter = new WebhookAdapter();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function payloadHash(payload: Prisma.InputJsonValue) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function shortSubject(text?: string) {
  return (text ?? "Webhook conversation").trim().slice(0, 80) || "Webhook conversation";
}

function jsonPayload(body: unknown): Prisma.InputJsonValue {
  if (body === null) return { value: null };
  if (typeof body === "string" || typeof body === "number" || typeof body === "boolean")
    return body;
  if (Array.isArray(body) || isRecord(body)) return body as Prisma.InputJsonValue;
  return { unsupportedPayloadType: typeof body };
}

function payloadSource(body: unknown) {
  const payload = asRecord(body);
  const message = asRecord(payload.message);
  const lead = asRecord(payload.lead);
  const socialAccount = firstRecord(
    payload.socialAccount,
    payload.social_account,
    message.socialAccount,
    message.social_account,
    message.sa,
    lead.socialAccount,
  );
  const source = firstRecord(payload.source, message.source);
  const explicit = firstString(
    payload.source,
    lead.source,
    socialAccount.name,
    socialAccount.username,
    socialAccount.type,
    source.name,
    source.username,
    source.type,
  );
  return explicit ?? "Webhook/API";
}

@Injectable()
export class WebhookService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    @Inject(AiReplyQueueService) private readonly aiReplyQueue: AiReplyQueueService,
    @Inject(WorkflowsService) private readonly workflowsService: WorkflowsService,
  ) {}

  async handleEvent(
    publicKey: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<GenericWebhookResult> {
    const channel = await this.loadWebhookChannel(publicKey);
    const settings = asRecord(channel.settings);
    const webhookSettings = asRecord(settings.webhook);
    const secret = optionalString(
      firstString(
        webhookSettings.secret,
        webhookSettings.webhookSecret,
        settings.secret,
        settings.webhookSecret,
      ),
    );
    if (!secret) {
      throw new UnauthorizedException("Webhook secret is not configured.");
    }
    const verified = await adapter.verifyWebhook?.({
      headers,
      body,
      secret,
    });
    if (!verified) {
      throw new UnauthorizedException("Webhook secret is invalid.");
    }

    const normalized = await adapter.normalizeInbound(body);
    const payload = jsonPayload(body);
    const provider = `webhook:${channel.id}`;
    const externalEventId = this.externalEventId(body, normalized);
    const claim = await claimWebhookEvent(this.prisma, {
      tenantId: channel.tenantId,
      provider,
      externalEventId,
      payloadHash: payloadHash(payload),
      payload,
      receivedAt: new Date(),
    });
    if (!claim.claimed) {
      return this.duplicateResponse(channel, normalized);
    }
    const webhookEvent = claim.event;
    const claimToken = claim.claimToken;

    try {
      const conversation = await this.upsertConversation(channel, normalized, body);
      const inbound = await this.createInboundMessage(channel, conversation, normalized);
      let aiResult: {
        messageId: string | null;
        reply: string | null;
        outbound: SendMessageResult | { externalMessageId: string; status: "skipped" };
      };
      if (this.aiReplyQueue.enabled) {
        if (!inbound.aiDispatch) {
          throw new Error("Webhook AI dispatch result was not persisted.");
        }
        if (inbound.aiDispatch.queued) {
          this.aiReplyQueue.dispatchPersisted(inbound.aiDispatch.eventId);
          aiResult = {
            messageId: null,
            reply: null,
            outbound: {
              externalMessageId: inbound.aiDispatch.jobId,
              status: "queued",
            },
          };
        } else {
          aiResult = {
            messageId: null,
            reply: null,
            outbound: { externalMessageId: "", status: "skipped" },
          };
        }
      } else {
        aiResult = await this.generateSyncReply(
          channel,
          conversation,
          normalized,
          inbound.message.id,
        );
      }
      const aiDispatchRejectionReason =
        inbound.aiDispatch && !inbound.aiDispatch.queued ? inbound.aiDispatch.reason : null;
      await this.workflowsService.runForEvent({
        tenantId: channel.tenantId,
        eventType: "message.received",
        idempotencyKey: `generic-webhook:${webhookEvent.id}`,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        channelType: "WEBHOOK",
        text: normalized.text ?? null,
        source: "webhook",
        receivedAt: new Date(normalized.timestamp),
        metadata: {
          publicKey: channel.publicKey ?? "",
          externalConversationId: normalized.externalConversationId,
          externalMessageId: normalized.externalMessageId,
        },
      });

      await this.prisma.$transaction(async (tx) => {
        await completeWebhookEvent(tx, { eventId: webhookEvent.id, claimToken });
        await tx.auditLog.create({
          data: {
            tenantId: channel.tenantId,
            action: "webhook.event.processed",
            entityType: "conversation",
            entityId: conversation.id,
            payload: {
              publicKey: channel.publicKey ?? "",
              externalEventId,
              externalMessageId: normalized.externalMessageId,
              outboundStatus: aiResult.outbound.status,
              ...(aiDispatchRejectionReason ? { aiDispatchRejectionReason } : {}),
            },
          },
        });
      });

      return {
        ok: true,
        duplicate: false,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        inboundMessageId: inbound.message.id,
        aiMessageId: aiResult.messageId,
        outboundStatus: aiResult.outbound.status,
        reply: aiResult.reply,
      };
    } catch (error) {
      await failWebhookEvent(this.prisma, {
        eventId: webhookEvent.id,
        claimToken,
        errorMessage: error instanceof Error ? error.message : "Unknown webhook processing error",
      });
      throw error;
    }
  }

  private async loadWebhookChannel(publicKey: string): Promise<GenericWebhookChannel> {
    const channel = await this.prisma.channel.findFirst({
      where: {
        publicKey: publicKey.trim(),
        type: "WEBHOOK",
        status: "ACTIVE",
        deletedAt: null,
        tenant: { deletedAt: null },
      },
      include: { tenant: true },
    });
    if (!channel) {
      throw new NotFoundException("Webhook channel was not found.");
    }
    assertTenantRuntimeActive(channel.tenant.status);
    return channel;
  }

  private externalEventId(body: unknown, normalized?: NormalizedInboundMessage) {
    const payload = asRecord(body);
    const eventId = firstString(payload.eventId, payload.event_id, payload.id);
    if (eventId) {
      return `webhook:event:${eventId}`;
    }
    return normalized?.externalMessageId ?? `webhook:payload:${payloadHash(jsonPayload(body))}`;
  }

  private async duplicateResponse(
    channel: GenericWebhookChannel,
    normalized: NormalizedInboundMessage,
  ): Promise<GenericWebhookResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalConversationId: normalized.externalConversationId,
        deletedAt: null,
      },
      select: { id: true, leadId: true },
    });
    return {
      ok: true,
      duplicate: true,
      conversationId: conversation?.id ?? "",
      leadId: conversation?.leadId ?? null,
      inboundMessageId: null,
      aiMessageId: null,
      outboundStatus: "skipped",
      reply: null,
    };
  }

  private async upsertConversation(
    channel: GenericWebhookChannel,
    inbound: NormalizedInboundMessage,
    body: unknown,
  ): Promise<GenericWebhookConversation> {
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `conversation:${channel.tenantId}:${channel.id}:${inbound.externalConversationId}`;
      await tx.$queryRaw(Prisma.sql`
        SELECT TRUE AS "locked"
        FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
      `);
      const channelState = await tx.$queryRaw<Array<{ automaticRepliesEnabled: boolean }>>(
        Prisma.sql`
          SELECT "automaticRepliesEnabled"
          FROM "Channel"
          WHERE "id" = ${channel.id}
            AND "tenantId" = ${channel.tenantId}
            AND "deletedAt" IS NULL
          FOR SHARE
        `,
      );
      const existing = await tx.conversation.findFirst({
        where: {
          tenantId: channel.tenantId,
          channelId: channel.id,
          externalConversationId: inbound.externalConversationId,
          deletedAt: null,
        },
        include: { lead: true, messages: { orderBy: { createdAt: "asc" } } },
      });
      const receivedAt = new Date(inbound.timestamp);
      const source = payloadSource(body);

      if (existing) return existing;

      const lead = await tx.lead.create({
        data: {
          tenantId: channel.tenantId,
          ...(inbound.customerName ? { name: inbound.customerName } : {}),
          ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
          ...(inbound.customerEmail ? { email: inbound.customerEmail } : {}),
          source,
          channelType: "WEBHOOK",
          status: "NEW",
          temperature: "WARM",
          interest: shortSubject(inbound.text),
          summary: "Новый лид из Webhook/API.",
          customFields: {
            webhookCustomerExternalId: inbound.customerExternalId,
            webhookConversationExternalId: inbound.externalConversationId,
            payloadSource: source,
          },
          lastMessageAt: receivedAt,
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          tenantId: channel.tenantId,
          leadId: lead.id,
          channelId: channel.id,
          externalConversationId: inbound.externalConversationId,
          status: "OPEN",
          subject: shortSubject(inbound.text),
          lastMessageAt: receivedAt,
          aiEnabled: channelState[0]?.automaticRepliesEnabled ?? false,
          metadata: {
            webhookCustomerExternalId: inbound.customerExternalId,
            webhookConversationExternalId: inbound.externalConversationId,
            payloadSource: source,
          },
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
        include: { lead: true, messages: { orderBy: { createdAt: "asc" } } },
      });

      await tx.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: lead.id,
          type: "conversation_started",
          title: "Webhook/API conversation started",
          message: inbound.text ?? null,
          metadata: {
            conversationId: conversation.id,
            externalConversationId: inbound.externalConversationId,
          },
        },
      });

      return conversation;
    });
  }

  private async createInboundMessage(
    channel: GenericWebhookChannel,
    conversation: GenericWebhookConversation,
    inbound: NormalizedInboundMessage,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Conversation"
        WHERE "id" = ${conversation.id} AND "tenantId" = ${channel.tenantId} AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException("Webhook conversation was not found.");
      const existing = await tx.message.findFirst({
        where: {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          externalMessageId: inbound.externalMessageId,
        },
        select: { id: true },
      });
      if (existing) {
        return {
          message: existing,
          aiDispatch: await this.persistAiDispatch(
            tx,
            channel,
            conversation,
            existing.id,
            inbound.text ?? "",
          ),
        };
      }

      const receivedAt = new Date(inbound.timestamp);
      const currentConversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: { status: true },
      });
      if (conversation.leadId) {
        await tx.lead.update({
          where: { id: conversation.leadId },
          data: {
            lastMessageAt: receivedAt,
            ...(inbound.customerName ? { name: inbound.customerName } : {}),
            ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
            ...(inbound.customerEmail ? { email: inbound.customerEmail } : {}),
          },
        });
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: receivedAt,
          ...(currentConversation.status === "CLOSED" ? { status: "OPEN" as const } : {}),
          updatedAt: receivedAt,
        },
      });

      const message = await tx.message.create({
        data: {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          externalMessageId: inbound.externalMessageId,
          text: inbound.text ?? null,
          status: "RECEIVED",
          metadata: {
            customerExternalId: inbound.customerExternalId,
            raw: jsonPayload(inbound.raw),
          },
          createdAt: receivedAt,
          updatedAt: receivedAt,
        },
      });

      if (conversation.leadId) {
        await tx.leadEvent.create({
          data: {
            tenantId: channel.tenantId,
            leadId: conversation.leadId,
            type: "webhook_message_received",
            title: "Webhook/API message received",
            message: inbound.text ?? null,
            metadata: {
              conversationId: conversation.id,
              externalMessageId: inbound.externalMessageId,
            },
          },
        });
      }

      return {
        message,
        aiDispatch: await this.persistAiDispatch(
          tx,
          channel,
          conversation,
          message.id,
          inbound.text ?? "",
        ),
      };
    });
  }

  private async persistAiDispatch(
    tx: Prisma.TransactionClient,
    channel: GenericWebhookChannel,
    conversation: GenericWebhookConversation,
    triggerMessageId: string,
    text: string,
  ): Promise<GenericWebhookAiDispatch | null> {
    if (!this.aiReplyQueue.enabled) return null;

    const jobId = `ai-reply:${conversation.id}:${triggerMessageId}`;
    const existing = await tx.runtimeOutbox.findUnique({
      where: { tenantId_dedupeKey: { tenantId: channel.tenantId, dedupeKey: jobId } },
      select: { id: true, aggregateType: true, aggregateId: true, eventType: true },
    });
    if (existing) {
      if (
        existing.aggregateType !== "conversation" ||
        existing.aggregateId !== triggerMessageId ||
        existing.eventType !== "ai.reply.requested"
      ) {
        throw new Error(`AI reply outbox dedupe key ${jobId} has conflicting metadata.`);
      }
      return { queued: true, eventId: existing.id, jobId };
    }

    const result = await this.aiReplyQueue.createEvent(
      tx,
      this.aiReplyRequest(channel, conversation, triggerMessageId, text),
    );
    if (!result.created) return { queued: false, reason: result.reason };

    if (conversation.leadId) {
      await tx.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: conversation.leadId,
          type: "webhook_ai_reply_queued",
          title: "Webhook/API AI reply queued",
          message: text,
          metadata: {
            conversationId: conversation.id,
            externalMessageId: jobId,
            outboundStatus: "queued",
          },
        },
      });
    }
    return { queued: true, eventId: result.event.id, jobId };
  }

  private aiReplyRequest(
    channel: GenericWebhookChannel,
    conversation: GenericWebhookConversation,
    triggerMessageId: string,
    text: string,
  ): AiReplyEnqueueRequest {
    return {
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      triggerMessageId,
      text,
      source: "webhook",
    };
  }

  private async generateSyncReply(
    channel: GenericWebhookChannel,
    conversation: GenericWebhookConversation,
    inbound: NormalizedInboundMessage,
    triggerMessageId: string,
  ) {
    const text = inbound.text ?? "";
    const jobData = this.aiReplyRequest(channel, conversation, triggerMessageId, text);
    const messages: AiMessage[] = [
      ...conversation.messages.map((message) => ({
        role: message.senderType === "AI" ? ("assistant" as const) : ("user" as const),
        content: message.text ?? "",
      })),
      { role: "user", content: text },
    ];

    const syncAdmission = await this.aiReplyQueue.admit(jobData);
    if (!syncAdmission.admitted) {
      return {
        messageId: null,
        reply: null,
        outbound: { externalMessageId: "", status: "skipped" as const },
      };
    }
    const identity = await resolveAiBusinessIdentity(this.prisma, {
      tenantId: channel.tenantId,
      legacyIdentity: () => ({
        businessName: channel.tenant.name,
        businessType: channel.tenant.businessType,
      }),
    });

    const [extraction, aiReply, recommendation] = await Promise.all([
      this.aiProvider.extractLeadFields({
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        text,
      }),
      this.aiProvider.generateReply({
        tenantId: channel.tenantId,
        businessName: identity.businessName,
        ...(identity.businessType ? { businessType: identity.businessType } : {}),
        conversationId: conversation.id,
        messages,
      }),
      this.aiProvider.recommendNextAction({
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        ...(conversation.lead?.status ? { leadStatus: conversation.lead.status } : {}),
        text,
      }),
    ]);

    const finalAdmission = await this.aiReplyQueue.admit(jobData);
    if (
      !finalAdmission.admitted ||
      finalAdmission.channelGeneration !== syncAdmission.channelGeneration ||
      finalAdmission.publicationId !== syncAdmission.publicationId ||
      finalAdmission.publicationEtag !== syncAdmission.publicationEtag ||
      finalAdmission.channelFingerprint !== syncAdmission.channelFingerprint
    ) {
      return {
        messageId: null,
        reply: null,
        outbound: { externalMessageId: "", status: "skipped" as const },
      };
    }

    const outbound = await adapter.sendMessage({
      tenantId: channel.tenantId,
      channelAccountId: channel.externalId ?? channel.id,
      conversationId: conversation.id,
      externalConversationId: inbound.externalConversationId,
      text: aiReply.reply,
      settings: channel.settings,
      ...(channel.encryptedCredentials
        ? { credentials: decryptIntegrationCredentials(channel.encryptedCredentials) }
        : {}),
      metadata: {
        triggerMessageId: inbound.externalMessageId,
        raw: jsonPayload(inbound.raw),
        intent: aiReply.intent,
      },
    });

    const aiCreatedAt = new Date(new Date(inbound.timestamp).getTime() + 1000);
    const handoffRequired = aiReply.handoffRequired || recommendation.handoffRequired;
    const aiMessage = await this.prisma.message.create({
      data: {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AI",
        externalMessageId: outbound.externalMessageId,
        text: aiReply.reply,
        status:
          outbound.status === "queued" ? "QUEUED" : outbound.status === "sent" ? "SENT" : "FAILED",
        metadata: {
          provider: "webhook",
          intent: aiReply.intent,
          confidence: aiReply.confidence,
          nextAction: recommendation.action,
          outboundStatus: outbound.status,
          handoffRequired,
        },
        createdAt: aiCreatedAt,
        updatedAt: aiCreatedAt,
      },
    });

    await this.prisma.aiUsageLog.create({
      data: {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        provider: this.aiProvider.providerName ?? "unknown",
        model: this.aiProvider.modelName ?? "unknown",
        actionType: "webhook_generate_reply",
        inputTokens: Math.max(24, Math.round(text.length / 4)),
        outputTokens: Math.max(18, Math.round(aiReply.reply.length / 4)),
        estimatedCost: "0.000000",
        latencyMs: 30,
        status: "SUCCESS",
        metadata: {
          recommendation: recommendation.action,
          reason: recommendation.reason,
          extractionConfidence: extraction.confidence,
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: aiCreatedAt,
        handoffRequested: conversation.handoffRequested || handoffRequired,
        status: handoffRequired ? "WAITING_FOR_HUMAN" : "OPEN",
        updatedAt: aiCreatedAt,
      },
    });

    if (conversation.leadId) {
      const summary =
        typeof extraction.fields.summary === "string" ? extraction.fields.summary : undefined;
      await this.prisma.lead.update({
        where: { id: conversation.leadId },
        data: {
          lastMessageAt: aiCreatedAt,
          status:
            conversation.lead?.status === "NEW"
              ? "IN_PROGRESS"
              : (conversation.lead?.status ?? "IN_PROGRESS"),
          ...(summary ? { summary } : {}),
          updatedAt: aiCreatedAt,
        },
      });

      await this.prisma.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: conversation.leadId,
          type: "webhook_ai_reply_queued",
          title: "Webhook/API AI reply queued",
          message: aiReply.reply,
          metadata: {
            conversationId: conversation.id,
            messageId: aiMessage.id,
            externalMessageId: outbound.externalMessageId,
            outboundStatus: outbound.status,
            intent: aiReply.intent,
          },
        },
      });
    }

    return {
      messageId: aiMessage.id,
      reply: aiReply.reply,
      outbound,
    };
  }
}
