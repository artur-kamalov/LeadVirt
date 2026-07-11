import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, type AiMessage, type AiProvider } from "@leadvirt/ai";
import { decryptIntegrationCredentials, TelegramAdapter, type NormalizedInboundMessage, type SendMessageResult } from "@leadvirt/integrations";
import type { Prisma } from "@leadvirt/db";
import type { AiReplyJobData } from "@leadvirt/types";
import { PrismaService } from "../database/prisma.service.js";
import { WorkflowsService } from "../workflows/workflows.service.js";
import { AiReplyQueueService } from "../ai/ai-reply-queue.service.js";

type TelegramChannel = Prisma.ChannelGetPayload<{
  include: { tenant: true };
}>;

type TelegramConversation = Prisma.ConversationGetPayload<{
  include: {
    lead: true;
    messages: { orderBy: { createdAt: "asc" } };
  };
}>;

export interface TelegramWebhookResult {
  ok: true;
  duplicate: boolean;
  conversationId: string;
  leadId: string | null;
  inboundMessageId: string | null;
  aiMessageId: string | null;
  outboundStatus: SendMessageResult["status"] | "skipped";
  reply: string | null;
}

const providerName = "telegram";
const adapter = new TelegramAdapter();

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

function channelCredentials(encryptedCredentials?: string | null) {
  if (!encryptedCredentials) return undefined;
  try {
    return decryptIntegrationCredentials(encryptedCredentials);
  } catch {
    return undefined;
  }
}

function isLeadVirtSample(value: unknown) {
  const update = asRecord(value);
  const message = isRecord(update.message) ? update.message : isRecord(update.edited_message) ? update.edited_message : {};
  const sender = asRecord(message.from);
  return sender.username === "leadvirt_sample";
}

function payloadHash(payload: Prisma.InputJsonValue) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function shortSubject(text?: string) {
  return (text ?? "Telegram conversation").trim().slice(0, 80) || "Telegram conversation";
}

function jsonPayload(body: unknown): Prisma.InputJsonValue {
  if (body === null) return { value: null };
  if (typeof body === "string" || typeof body === "number" || typeof body === "boolean") return body;
  if (Array.isArray(body) || isRecord(body)) return body as Prisma.InputJsonValue;
  return { unsupportedPayloadType: typeof body };
}

@Injectable()
export class TelegramService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    @Inject(AiReplyQueueService) private readonly aiReplyQueue: AiReplyQueueService,
    @Inject(WorkflowsService) private readonly workflowsService: WorkflowsService
  ) {}

  async handleWebhook(
    publicKey: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>
  ): Promise<TelegramWebhookResult> {
    const channel = await this.loadTelegramChannel(publicKey);
    const settings = asRecord(channel.settings);
    const telegramSettings = asRecord(settings.telegram);
    const secret = optionalString(typeof telegramSettings.webhookSecret === "string" ? telegramSettings.webhookSecret : undefined);
    const verified = await adapter.verifyWebhook?.({ headers, body, ...(secret ? { secret } : {}) });
    if (!verified) {
      throw new UnauthorizedException("Telegram webhook secret is invalid.");
    }

    const normalized = await adapter.normalizeInbound(body);
    const payload = jsonPayload(body);
    const externalEventId = this.externalEventId(body, normalized);
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalEventId: { provider: providerName, externalEventId } }
    });
    if (existingEvent) {
      return this.duplicateResponse(channel, normalized);
    }

    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        tenantId: channel.tenantId,
        provider: providerName,
        externalEventId,
        payloadHash: payloadHash(payload),
        payload,
        status: "RECEIVED",
        receivedAt: new Date()
      }
    });

    try {
      const conversation = await this.upsertConversation(channel, normalized);
      const inboundMessage = await this.createInboundMessage(channel, conversation, normalized);
      const aiResult = await this.generateAndQueueReply(channel, conversation, normalized, inboundMessage?.id ?? normalized.externalMessageId);
      await this.workflowsService.runForEvent({
        tenantId: channel.tenantId,
        eventType: "message.received",
        conversationId: conversation.id,
        leadId: conversation.leadId,
        channelType: "TELEGRAM",
        text: normalized.text ?? null,
        source: "telegram",
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
          action: "telegram.webhook.processed",
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
          errorMessage: error instanceof Error ? error.message : "Unknown Telegram webhook processing error",
          processedAt: new Date()
        }
      });
      throw error;
    }
  }

  private async loadTelegramChannel(publicKey: string): Promise<TelegramChannel> {
    const channel = await this.prisma.channel.findFirst({
      where: {
        publicKey: publicKey.trim(),
        type: "TELEGRAM",
        status: "ACTIVE",
        deletedAt: null,
        tenant: { deletedAt: null }
      },
      include: { tenant: true }
    });
    if (!channel) {
      throw new NotFoundException("Telegram channel was not found.");
    }
    return channel;
  }

  private externalEventId(body: unknown, normalized: NormalizedInboundMessage) {
    const update = asRecord(body);
    const updateId = update.update_id;
    if (typeof updateId === "string" || typeof updateId === "number") {
      return `telegram:update:${String(updateId)}`;
    }
    return normalized.externalMessageId;
  }

  private async duplicateResponse(channel: TelegramChannel, normalized: NormalizedInboundMessage): Promise<TelegramWebhookResult> {
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

  private async upsertConversation(channel: TelegramChannel, inbound: NormalizedInboundMessage): Promise<TelegramConversation> {
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

    if (existing) {
      if (existing.leadId) {
        await this.prisma.lead.update({
          where: { id: existing.leadId },
          data: {
            lastMessageAt: receivedAt,
            ...(inbound.customerName ? { name: inbound.customerName } : {}),
            ...(inbound.customerPhone ? { phone: inbound.customerPhone } : {}),
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
        source: "Telegram-бот",
        channelType: "TELEGRAM",
        status: "NEW",
        temperature: "WARM",
        interest: shortSubject(inbound.text),
        summary: "Новый диалог из Telegram.",
        customFields: {
          telegramCustomerExternalId: inbound.customerExternalId,
          telegramConversationExternalId: inbound.externalConversationId
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
          telegramCustomerExternalId: inbound.customerExternalId,
          telegramConversationExternalId: inbound.externalConversationId
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
        title: "Telegram conversation started",
        message: inbound.text ?? null,
        metadata: { conversationId: conversation.id, externalConversationId: inbound.externalConversationId }
      }
    });

    return conversation;
  }

  private async createInboundMessage(channel: TelegramChannel, conversation: TelegramConversation, inbound: NormalizedInboundMessage) {
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
          type: "telegram_message_received",
          title: "Telegram message received",
          message: inbound.text ?? null,
          metadata: { conversationId: conversation.id, externalMessageId: inbound.externalMessageId }
        }
      });
    }

    return message;
  }

  private async generateAndQueueReply(
    channel: TelegramChannel,
    conversation: TelegramConversation,
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
        source: "telegram",
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
              type: "telegram_ai_reply_queued",
              title: "Telegram AI reply queued",
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

    const credentials = channelCredentials(channel.encryptedCredentials);
    const outbound = await adapter.sendMessage({
      tenantId: channel.tenantId,
      channelAccountId: channel.externalId ?? channel.id,
      conversationId: conversation.id,
      externalConversationId: inbound.externalConversationId,
      text: aiReply.reply,
      ...(credentials ? { credentials } : {}),
      metadata: {
        triggerMessageId: inbound.externalMessageId,
        intent: aiReply.intent,
        sample: isLeadVirtSample(inbound.raw)
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
          provider: "telegram",
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
        actionType: "telegram_generate_reply",
        inputTokens: Math.max(24, Math.round(text.length / 4)),
        outputTokens: Math.max(18, Math.round(aiReply.reply.length / 4)),
        estimatedCost: "0.000000",
        latencyMs: 32,
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
          type: "telegram_ai_reply_queued",
          title: "Telegram AI reply queued",
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
