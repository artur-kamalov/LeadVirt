import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, type AiMessage, type AiProvider } from "@leadvirt/ai";
import type { Prisma } from "@leadvirt/db";
import { WebhookAdapter, type NormalizedInboundMessage, type SendMessageResult } from "@leadvirt/integrations";
import type { AiReplyJobData } from "@leadvirt/types";
import { PrismaService } from "../database/prisma.service.js";
import { WorkflowsService } from "../workflows/workflows.service.js";
import { AiReplyQueueService } from "../ai/ai-reply-queue.service.js";

type GenericWebhookChannel = Prisma.ChannelGetPayload<{
  include: { tenant: true };
}>;

type GenericWebhookConversation = Prisma.ConversationGetPayload<{
  include: {
    lead: true;
    messages: { orderBy: { createdAt: "asc" } };
  };
}>;

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
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function firstScalar(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function payloadHash(payload: Prisma.InputJsonValue) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function shortSubject(text?: string) {
  return (text ?? "Webhook conversation").trim().slice(0, 80) || "Webhook conversation";
}

function jsonPayload(body: unknown): Prisma.InputJsonValue {
  if (body === null) return { value: null };
  if (typeof body === "string" || typeof body === "number" || typeof body === "boolean") return body;
  if (Array.isArray(body) || isRecord(body)) return body as Prisma.InputJsonValue;
  return { unsupportedPayloadType: typeof body };
}

const umnicoNonInboundEventTypes = new Set([
  "message.outgoing",
  "lead.created",
  "lead.changed",
  "lead.changed.status",
  "customer.created",
  "customer.changed",
  "integration.created",
  "integration.deleted"
]);

function umnicoEventType(body: unknown): string | undefined {
  const payload = asRecord(body);
  const type = firstString(payload.type);
  if (!type) return undefined;
  const hasUmnicoShape =
    payload.accountId !== undefined ||
    payload.account_id !== undefined ||
    payload.leadId !== undefined ||
    payload.lead_id !== undefined ||
    payload.customerId !== undefined ||
    payload.integrationId !== undefined;
  if (!hasUmnicoShape) return undefined;
  return type === "message.incoming" || umnicoNonInboundEventTypes.has(type) ? type : undefined;
}

function ignoredUmnicoEventType(body: unknown): string | undefined {
  const type = umnicoEventType(body);
  return type && type !== "message.incoming" ? type : undefined;
}

function umnicoExternalEventId(body: unknown): string | undefined {
  const payload = asRecord(body);
  const type = umnicoEventType(payload);
  if (!type) return undefined;
  const message = asRecord(payload.message);
  const lead = asRecord(payload.lead);
  const key = firstScalar(
    message.id,
    message.messageId,
    message.message_id,
    payload.messageId,
    payload.message_id,
    lead.id,
    payload.leadId,
    payload.lead_id,
    payload.customerId,
    payload.customer_id,
    payload.integrationId,
    payload.integration_id,
    message.timestamp,
    payload.timestamp
  );
  const accountId = firstScalar(payload.accountId, payload.account_id) ?? "account";
  return `umnico:${type}:${accountId}:${key ?? payloadHash(jsonPayload(body))}`;
}

function payloadSource(body: unknown) {
  const payload = asRecord(body);
  const message = asRecord(payload.message);
  const lead = asRecord(payload.lead);
  const socialAccount = firstRecord(payload.socialAccount, payload.social_account, message.socialAccount, message.social_account, message.sa, lead.socialAccount);
  const source = firstRecord(payload.source, message.source);
  if (umnicoEventType(payload)) {
    const socialType = firstString(socialAccount.type);
    const socialLogin = firstString(socialAccount.login, socialAccount.username, socialAccount.name);
    const normalizedType = socialType?.toLowerCase().startsWith("instagram") ? "Instagram" : socialType;
    const explicit = firstString(normalizedType, socialLogin, lead.source, payload.source);
    return explicit ? `Umnico ${explicit}` : "Umnico";
  }
  const explicit = firstString(payload.source, lead.source, socialAccount.name, socialAccount.username, socialAccount.type, source.name, source.username, source.type);
  return explicit ?? "Webhook/API";
}

@Injectable()
export class WebhookService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    @Inject(AiReplyQueueService) private readonly aiReplyQueue: AiReplyQueueService,
    @Inject(WorkflowsService) private readonly workflowsService: WorkflowsService
  ) {}

  async handleEvent(
    publicKey: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>
  ): Promise<GenericWebhookResult> {
    const channel = await this.loadWebhookChannel(publicKey);
    const settings = asRecord(channel.settings);
    const webhookSettings = asRecord(settings.webhook);
    const secret = optionalString(firstString(webhookSettings.secret, webhookSettings.webhookSecret, settings.secret, settings.webhookSecret));
    const verified = await adapter.verifyWebhook?.({ headers, body, ...(secret ? { secret } : {}) });
    if (!verified) {
      throw new UnauthorizedException("Webhook secret is invalid.");
    }

    const ignoredType = ignoredUmnicoEventType(body);
    if (ignoredType) {
      return this.ignoredResponse(channel, body, ignoredType);
    }

    const normalized = await adapter.normalizeInbound(body);
    const payload = jsonPayload(body);
    const provider = `webhook:${channel.id}`;
    const externalEventId = this.externalEventId(body, normalized);
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } }
    });
    if (existingEvent) {
      return this.duplicateResponse(channel, normalized);
    }

    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        tenantId: channel.tenantId,
        provider,
        externalEventId,
        payloadHash: payloadHash(payload),
        payload,
        status: "RECEIVED",
        receivedAt: new Date()
      }
    });

    try {
      const conversation = await this.upsertConversation(channel, normalized, body);
      const inboundMessage = await this.createInboundMessage(channel, conversation, normalized);
      const aiResult = await this.generateAndQueueReply(channel, conversation, normalized, inboundMessage?.id ?? normalized.externalMessageId);
      await this.workflowsService.runForEvent({
        tenantId: channel.tenantId,
        eventType: "message.received",
        conversationId: conversation.id,
        leadId: conversation.leadId,
        channelType: "WEBHOOK",
        text: normalized.text ?? null,
        source: "webhook",
        receivedAt: new Date(normalized.timestamp),
        metadata: {
          publicKey: channel.publicKey ?? "",
          externalConversationId: normalized.externalConversationId,
          externalMessageId: normalized.externalMessageId
        }
      });

      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: "PROCESSED", processedAt: new Date() }
      });

      await this.prisma.auditLog.create({
        data: {
          tenantId: channel.tenantId,
          action: "webhook.event.processed",
          entityType: "conversation",
          entityId: conversation.id,
          payload: {
            publicKey: channel.publicKey ?? "",
            externalEventId,
            externalMessageId: normalized.externalMessageId,
            outboundStatus: aiResult.outbound.status
          }
        }
      });

      return {
        ok: true,
        duplicate: false,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        inboundMessageId: inboundMessage?.id ?? null,
        aiMessageId: aiResult.messageId,
        outboundStatus: aiResult.outbound.status,
        reply: aiResult.reply
      };
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Unknown webhook processing error",
          processedAt: new Date()
        }
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
        tenant: { deletedAt: null }
      },
      include: { tenant: true }
    });
    if (!channel) {
      throw new NotFoundException("Webhook channel was not found.");
    }
    return channel;
  }

  private externalEventId(body: unknown, normalized?: NormalizedInboundMessage) {
    const payload = asRecord(body);
    const eventId = firstString(payload.eventId, payload.event_id, payload.id);
    if (eventId) {
      return `webhook:event:${eventId}`;
    }
    return umnicoExternalEventId(body) ?? normalized?.externalMessageId ?? `webhook:payload:${payloadHash(jsonPayload(body))}`;
  }

  private async ignoredResponse(channel: GenericWebhookChannel, body: unknown, eventType: string): Promise<GenericWebhookResult> {
    const payload = jsonPayload(body);
    const provider = `webhook:${channel.id}`;
    const externalEventId = this.externalEventId(body);
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalEventId: { provider, externalEventId } }
    });
    if (!existingEvent) {
      await this.prisma.webhookEvent.create({
        data: {
          tenantId: channel.tenantId,
          provider,
          externalEventId,
          payloadHash: payloadHash(payload),
          payload,
          status: "IGNORED",
          errorMessage: `Ignored Umnico event type ${eventType}.`,
          receivedAt: new Date(),
          processedAt: new Date()
        }
      });
    }
    return {
      ok: true,
      duplicate: Boolean(existingEvent),
      ignored: true,
      reason: `Ignored Umnico event type ${eventType}.`,
      conversationId: "",
      leadId: null,
      inboundMessageId: null,
      aiMessageId: null,
      outboundStatus: "skipped",
      reply: null
    };
  }

  private async duplicateResponse(channel: GenericWebhookChannel, normalized: NormalizedInboundMessage): Promise<GenericWebhookResult> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalConversationId: normalized.externalConversationId,
        deletedAt: null
      },
      select: { id: true, leadId: true }
    });
    return {
      ok: true,
      duplicate: true,
      conversationId: conversation?.id ?? "",
      leadId: conversation?.leadId ?? null,
      inboundMessageId: null,
      aiMessageId: null,
      outboundStatus: "skipped",
      reply: null
    };
  }

  private async upsertConversation(
    channel: GenericWebhookChannel,
    inbound: NormalizedInboundMessage,
    body: unknown
  ): Promise<GenericWebhookConversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalConversationId: inbound.externalConversationId,
        deletedAt: null
      },
      include: { lead: true, messages: { orderBy: { createdAt: "asc" } } }
    });
    const receivedAt = new Date(inbound.timestamp);
    const source = payloadSource(body);

    if (existing) {
      if (existing.leadId) {
        await this.prisma.lead.update({
          where: { id: existing.leadId },
          data: {
            lastMessageAt: receivedAt,
            ...(inbound.customerName ? { name: inbound.customerName } : {}),
            ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
            ...(inbound.customerEmail ? { email: inbound.customerEmail } : {}),
            interest: shortSubject(inbound.text)
          }
        });
      }
      await this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastMessageAt: receivedAt,
          status: existing.status === "CLOSED" ? "OPEN" : existing.status,
          updatedAt: receivedAt
        }
      });
      return existing;
    }

    const lead = await this.prisma.lead.create({
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
          payloadSource: source
        },
        lastMessageAt: receivedAt,
        createdAt: receivedAt,
        updatedAt: receivedAt
      }
    });

    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId: channel.tenantId,
        leadId: lead.id,
        channelId: channel.id,
        externalConversationId: inbound.externalConversationId,
        status: "OPEN",
        subject: shortSubject(inbound.text),
        lastMessageAt: receivedAt,
        aiEnabled: true,
        metadata: {
          webhookCustomerExternalId: inbound.customerExternalId,
          webhookConversationExternalId: inbound.externalConversationId,
          payloadSource: source
        },
        createdAt: receivedAt,
        updatedAt: receivedAt
      },
      include: { lead: true, messages: { orderBy: { createdAt: "asc" } } }
    });

    await this.prisma.leadEvent.create({
      data: {
        tenantId: channel.tenantId,
        leadId: lead.id,
        type: "conversation_started",
        title: "Webhook/API conversation started",
        message: inbound.text ?? null,
        metadata: { conversationId: conversation.id, externalConversationId: inbound.externalConversationId }
      }
    });

    return conversation;
  }

  private async createInboundMessage(
    channel: GenericWebhookChannel,
    conversation: GenericWebhookConversation,
    inbound: NormalizedInboundMessage
  ) {
    const existing = await this.prisma.message.findFirst({
      where: {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        externalMessageId: inbound.externalMessageId
      },
      select: { id: true }
    });
    if (existing) {
      return null;
    }

    const message = await this.prisma.message.create({
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
          raw: jsonPayload(inbound.raw)
        },
        createdAt: new Date(inbound.timestamp),
        updatedAt: new Date(inbound.timestamp)
      }
    });

    if (conversation.leadId) {
      await this.prisma.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: conversation.leadId,
          type: "webhook_message_received",
          title: "Webhook/API message received",
          message: inbound.text ?? null,
          metadata: { conversationId: conversation.id, externalMessageId: inbound.externalMessageId }
        }
      });
    }

    return message;
  }

  private async generateAndQueueReply(
    channel: GenericWebhookChannel,
    conversation: GenericWebhookConversation,
    inbound: NormalizedInboundMessage,
    triggerMessageId: string
  ) {
    const text = inbound.text ?? "";
    const messages: AiMessage[] = [
      ...conversation.messages.map((message) => ({
        role: message.senderType === "AI" ? ("assistant" as const) : ("user" as const),
        content: message.text ?? ""
      })),
      { role: "user", content: text }
    ];

    if (this.aiReplyQueue.enabled) {
      const jobData: AiReplyJobData = {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        triggerMessageId,
        text,
        businessName: channel.tenant.name,
        ...(channel.tenant.businessType ? { businessType: channel.tenant.businessType } : {}),
        leadId: conversation.leadId,
        ...(conversation.lead?.status ? { leadStatus: conversation.lead.status } : {}),
        source: "webhook",
        receivedAt: inbound.timestamp
      };
      const queueResult = await this.aiReplyQueue.enqueue(jobData);
      if (queueResult.queued) {
        const outbound: SendMessageResult = {
          externalMessageId: queueResult.jobId ?? `ai-reply:${conversation.id}:${triggerMessageId}`,
          status: "queued"
        };
        if (conversation.leadId) {
          await this.prisma.leadEvent.create({
            data: {
              tenantId: channel.tenantId,
              leadId: conversation.leadId,
              type: "webhook_ai_reply_queued",
              title: "Webhook/API AI reply queued",
              message: text,
              metadata: {
                conversationId: conversation.id,
                externalMessageId: outbound.externalMessageId,
                outboundStatus: outbound.status
              }
            }
          });
        }
        return {
          messageId: null,
          reply: null,
          outbound
        };
      }
    }

    const [extraction, aiReply, recommendation] = await Promise.all([
      this.aiProvider.extractLeadFields({
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        text
      }),
      this.aiProvider.generateReply({
        tenantId: channel.tenantId,
        businessName: channel.tenant.name,
        ...(channel.tenant.businessType ? { businessType: channel.tenant.businessType } : {}),
        conversationId: conversation.id,
        messages
      }),
      this.aiProvider.recommendNextAction({
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        ...(conversation.lead?.status ? { leadStatus: conversation.lead.status } : {}),
        text
      })
    ]);

    const outbound = await adapter.sendMessage({
      tenantId: channel.tenantId,
      channelAccountId: channel.externalId ?? channel.id,
      conversationId: conversation.id,
      externalConversationId: inbound.externalConversationId,
      text: aiReply.reply,
      settings: channel.settings,
      metadata: {
        triggerMessageId: inbound.externalMessageId,
        raw: jsonPayload(inbound.raw),
        intent: aiReply.intent
      }
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
        status: outbound.status === "queued" ? "QUEUED" : outbound.status === "sent" ? "SENT" : "FAILED",
        metadata: {
          provider: "webhook",
          intent: aiReply.intent,
          confidence: aiReply.confidence,
          nextAction: recommendation.action,
          outboundStatus: outbound.status,
          handoffRequired
        },
        createdAt: aiCreatedAt,
        updatedAt: aiCreatedAt
      }
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
          extractionConfidence: extraction.confidence
        }
      }
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: aiCreatedAt,
        handoffRequested: conversation.handoffRequested || handoffRequired,
        status: handoffRequired ? "WAITING_FOR_HUMAN" : "OPEN",
        updatedAt: aiCreatedAt
      }
    });

    if (conversation.leadId) {
      const summary = typeof extraction.fields.summary === "string" ? extraction.fields.summary : undefined;
      await this.prisma.lead.update({
        where: { id: conversation.leadId },
        data: {
          lastMessageAt: aiCreatedAt,
          status: conversation.lead?.status === "NEW" ? "IN_PROGRESS" : (conversation.lead?.status ?? "IN_PROGRESS"),
          ...(summary ? { summary } : {}),
          updatedAt: aiCreatedAt
        }
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
            intent: aiReply.intent
          }
        }
      });
    }

    return {
      messageId: aiMessage.id,
      reply: aiReply.reply,
      outbound
    };
  }
}
