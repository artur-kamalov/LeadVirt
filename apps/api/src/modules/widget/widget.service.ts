import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AI_PROVIDER_TOKEN, type AiMessage, type AiProvider } from "@leadvirt/ai";
import { Prisma } from "@leadvirt/db";
import { resolveAiBusinessIdentity } from "@leadvirt/knowledge";
import type {
  AiReplyEnqueueRequest,
  WidgetConfig,
  WidgetConversationMessage,
  WidgetMessageResponse,
  WidgetPosition,
} from "@leadvirt/types";
import { PrismaService } from "../database/prisma.service.js";
import { WorkflowsService } from "../workflows/workflows.service.js";
import { AiReplyQueueService } from "../ai/ai-reply-queue.service.js";
import type { SendWidgetMessageDto, WidgetCustomerDto } from "./dto/send-widget-message.dto.js";
import { claimWebhookEvent } from "../../common/webhook-event-claim.js";
import { assertTenantRuntimeActive } from "../../common/tenant-lifecycle.js";

type WidgetChannel = Prisma.ChannelGetPayload<{
  include: { tenant: true };
}>;

type WidgetConversation = Prisma.ConversationGetPayload<{
  include: {
    lead: true;
    messages: { orderBy: { createdAt: "asc" } };
  };
}>;

type WidgetSendMeta = {
  userAgent?: string | undefined;
};

type WidgetAiState = {
  replied: boolean;
  handoffRequired: boolean;
  confidence: number;
  intent: string;
};

const providerName = "website_widget";
const defaultAiState: WidgetAiState = {
  replied: false,
  handoffRequired: false,
  confidence: 0,
  intent: "duplicate_or_existing",
};

const legacyWidgetTranslations: Record<string, string> = {
  "AI lead assistant": "AI-администратор",
  "Demo Company": "Демо-компания",
  "Hi! I am the LeadVirt.ai assistant. I can answer questions and pass the context to a manager.":
    "Здравствуйте! Я AI-администратор LeadVirt.ai. Отвечу на вопросы, уточню заявку и передам контекст менеджеру.",
  "Hi! I am the LeadVirt.ai assistant. I can answer questions, qualify your request, and pass the context to a manager.":
    "Здравствуйте! Я AI-администратор LeadVirt.ai. Отвечу на вопросы, уточню заявку и передам контекст менеджеру.",
  "I want to book": "Хочу записаться",
  "How much does it cost?": "Сколько стоит?",
  "Call a manager": "Позовите менеджера",
  "By sending a message, you agree that the team may contact you about this request.":
    "Отправляя сообщение, вы соглашаетесь, что команда может связаться с вами по этой заявке.",
};

function localizeLegacyWidgetText(value: string) {
  return legacyWidgetTranslations[value] ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringSetting(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function stringArraySetting(
  source: Record<string, unknown>,
  key: string,
  fallback: string[],
): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return strings.length > 0 ? strings : fallback;
}

function positionSetting(source: Record<string, unknown>): WidgetPosition {
  return source.position === "bottom-left" ? "bottom-left" : "bottom-right";
}

function shortSubject(text: string) {
  return text.trim().slice(0, 80) || "Диалог виджета сайта";
}

function payloadHash(payload: Prisma.InputJsonObject) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function customerPayload(customer?: WidgetCustomerDto): Prisma.InputJsonObject {
  const payload: Record<string, Prisma.InputJsonValue> = {};
  const name = optionalString(customer?.name);
  const phone = optionalString(customer?.phone);
  const email = optionalString(customer?.email);
  if (name) payload.name = name;
  if (phone) payload.phone = phone;
  if (email) payload.email = email;
  return payload;
}

function widgetPayload(dto: SendWidgetMessageDto, userAgent?: string): Prisma.InputJsonObject {
  const payload: Record<string, Prisma.InputJsonValue> = {
    sessionId: dto.sessionId,
    text: dto.text,
  };
  const clientMessageId = optionalString(dto.clientMessageId);
  const pageUrl = optionalString(dto.pageUrl);
  const referrer = optionalString(dto.referrer);
  const effectiveUserAgent = optionalString(dto.userAgent) ?? optionalString(userAgent);
  const customer = customerPayload(dto.customer);

  if (clientMessageId) payload.clientMessageId = clientMessageId;
  if (Object.keys(customer).length > 0) payload.customer = customer;
  if (pageUrl) payload.pageUrl = pageUrl;
  if (referrer) payload.referrer = referrer;
  if (effectiveUserAgent) payload.userAgent = effectiveUserAgent;

  return payload;
}

@Injectable()
export class WidgetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
    @Inject(AiReplyQueueService) private readonly aiReplyQueue: AiReplyQueueService,
    @Inject(WorkflowsService) private readonly workflowsService: WorkflowsService,
  ) {}

  async getConfig(publicKey: string): Promise<WidgetConfig> {
    const channel = await this.loadWidgetChannel(publicKey);
    return this.mapConfig(channel);
  }

  async sendMessage(
    publicKey: string,
    dto: SendWidgetMessageDto,
    meta: WidgetSendMeta = {},
  ): Promise<WidgetMessageResponse> {
    const channel = await this.loadWidgetChannel(publicKey);
    const sessionId = dto.sessionId.trim();
    const text = dto.text.trim();
    const now = new Date();
    const externalEventId = optionalString(dto.clientMessageId) ?? `${sessionId}:${now.getTime()}`;
    const payload = widgetPayload({ ...dto, sessionId, text }, meta.userAgent);
    const provider = `${providerName}:${channel.id}`;
    const claim = await claimWebhookEvent(this.prisma, {
      tenantId: channel.tenantId,
      provider,
      externalEventId,
      payloadHash: payloadHash(payload),
      payload,
      receivedAt: now,
    });
    if (!claim.claimed) {
      return this.responseForSession(channel, sessionId, defaultAiState);
    }
    const webhookEvent = claim.event;

    try {
      const conversation = await this.upsertConversation(channel, sessionId, text, dto, now);
      const clientMessageId = optionalString(dto.clientMessageId);
      const existingMessage = clientMessageId
        ? await this.prisma.message.findFirst({
            where: {
              tenantId: channel.tenantId,
              conversationId: conversation.id,
              externalMessageId: clientMessageId,
            },
          })
        : null;

      if (existingMessage && !claim.resumed) {
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: "PROCESSED_DUPLICATE", processedAt: new Date() },
        });
        return this.responseForSession(channel, sessionId, defaultAiState);
      }

      const inboundMessage =
        existingMessage ??
        (await this.prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "Conversation"
          WHERE "id" = ${conversation.id} AND "tenantId" = ${channel.tenantId} AND "deletedAt" IS NULL
          FOR UPDATE
        `);
          if (locked.length !== 1)
            throw new NotFoundException("Widget conversation was not found.");
          const currentConversation = await tx.conversation.findUniqueOrThrow({
            where: { id: conversation.id },
            select: { status: true },
          });
          if (conversation.leadId) {
            const leadData: Prisma.LeadUpdateInput = {
              lastMessageAt: now,
            };
            const name = optionalString(dto.customer?.name);
            const phone = optionalString(dto.customer?.phone);
            const email = optionalString(dto.customer?.email);
            if (name) leadData.name = name;
            if (phone) leadData.phone = phone;
            if (email) leadData.email = email;
            await tx.lead.update({ where: { id: conversation.leadId }, data: leadData });
          }
          await tx.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: now,
              ...(currentConversation.status === "CLOSED" ? { status: "OPEN" as const } : {}),
              updatedAt: now,
            },
          });
          const message = await tx.message.create({
            data: {
              tenantId: channel.tenantId,
              conversationId: conversation.id,
              direction: "INBOUND",
              senderType: "CUSTOMER",
              ...(clientMessageId ? { externalMessageId: clientMessageId } : {}),
              text,
              status: "RECEIVED",
              metadata: this.messageMetadata(dto, meta.userAgent),
              createdAt: now,
              updatedAt: now,
            },
          });

          await tx.leadEvent.create({
            data: {
              tenantId: channel.tenantId,
              leadId: conversation.leadId!,
              type: "widget_message_received",
              title: "Сообщение из виджета сайта получено",
              message: text,
              metadata: { conversationId: conversation.id, sessionId },
            },
          });
          if (this.aiReplyQueue.enabled) {
            await this.aiReplyQueue.createEvent(
              tx,
              this.aiReplyRequest(channel, conversation, message.id, text),
            );
          }
          return message;
        }));

      const aiState = await this.generateAiReply(
        channel,
        conversation,
        inboundMessage.id,
        text,
        now,
      );
      await this.workflowsService.runForEvent({
        tenantId: channel.tenantId,
        eventType: "message.received",
        idempotencyKey: `widget-message:${webhookEvent.id}`,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        channelType: "WEBSITE",
        text,
        source: "widget",
        receivedAt: webhookEvent.receivedAt,
        metadata: {
          publicKey: channel.publicKey ?? "",
          sessionId,
        },
      });

      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });

      const auditData: Prisma.AuditLogUncheckedCreateInput = {
        tenantId: channel.tenantId,
        action: "widget.message.received",
        entityType: "conversation",
        entityId: conversation.id,
        payload: {
          publicKey: channel.publicKey ?? "",
          sessionId,
          intent: aiState.intent,
          handoffRequired: aiState.handoffRequired,
        },
      };
      const auditUserAgent = optionalString(dto.userAgent) ?? optionalString(meta.userAgent);
      if (auditUserAgent) {
        auditData.userAgent = auditUserAgent;
      }
      await this.prisma.auditLog.create({ data: auditData });

      return this.responseForSession(channel, sessionId, aiState);
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Unknown widget processing error",
          processedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async loadWidgetChannel(publicKey: string): Promise<WidgetChannel> {
    const key = publicKey.trim();
    const channel = await this.prisma.channel.findFirst({
      where: {
        publicKey: key,
        type: "WEBSITE",
        status: "ACTIVE",
        deletedAt: null,
        tenant: { deletedAt: null },
      },
      include: { tenant: true },
    });
    if (!channel) {
      throw new NotFoundException("Виджет сайта не найден");
    }
    assertTenantRuntimeActive(channel.tenant.status);
    return channel;
  }

  private mapConfig(channel: WidgetChannel): WidgetConfig {
    const settings = asRecord(channel.settings);
    const widget = isRecord(settings.widget) ? settings.widget : settings;
    const tenantSettings = asRecord(channel.tenant.settings);
    const businessName = stringSetting(
      widget,
      "businessName",
      stringSetting(tenantSettings, "demoBusinessName", channel.tenant.name),
    );

    const consentText = optionalString(
      typeof widget.consentText === "string" ? widget.consentText : undefined,
    );
    const suggestedReplies = stringArraySetting(widget, "suggestedReplies", [
      "Хочу записаться",
      "Сколько стоит?",
      "Позовите менеджера",
    ]);
    return {
      publicKey: channel.publicKey ?? "",
      tenantName: channel.tenant.name,
      businessName: localizeLegacyWidgetText(businessName),
      title: stringSetting(widget, "title", "LeadVirt.ai"),
      subtitle: localizeLegacyWidgetText(stringSetting(widget, "subtitle", "AI-администратор")),
      welcomeMessage: localizeLegacyWidgetText(
        stringSetting(
          widget,
          "welcomeMessage",
          "Здравствуйте! Я AI-администратор LeadVirt.ai. Отвечу на вопросы, уточню заявку и передам контекст менеджеру.",
        ),
      ),
      primaryColor: stringSetting(widget, "primaryColor", "#34d399"),
      accentColor: stringSetting(widget, "accentColor", "#10b981"),
      position: positionSetting(widget),
      locale: stringSetting(widget, "locale", "ru-RU"),
      suggestedReplies: suggestedReplies.map(localizeLegacyWidgetText),
      ...(consentText ? { consentText: localizeLegacyWidgetText(consentText) } : {}),
      poweredBy: stringSetting(widget, "poweredBy", "LeadVirt.ai"),
    };
  }

  private async upsertConversation(
    channel: WidgetChannel,
    sessionId: string,
    text: string,
    dto: SendWidgetMessageDto,
    createdAt: Date,
  ): Promise<WidgetConversation> {
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `conversation:${channel.tenantId}:${channel.id}:${sessionId}`;
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
          externalConversationId: sessionId,
          deletedAt: null,
        },
        include: { lead: true, messages: { orderBy: { createdAt: "asc" } } },
      });

      if (existing) return existing;

      const leadData: Prisma.LeadUncheckedCreateInput = {
        tenantId: channel.tenantId,
        source: "Виджет сайта",
        channelType: "WEBSITE",
        status: "NEW",
        temperature: "WARM",
        interest: shortSubject(text),
        summary: "Новый диалог из виджета сайта.",
        customFields: {
          widgetSessionId: sessionId,
          pageUrl: optionalString(dto.pageUrl) ?? "",
          referrer: optionalString(dto.referrer) ?? "",
        },
        lastMessageAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      };
      const customerName = optionalString(dto.customer?.name);
      const customerPhone = optionalString(dto.customer?.phone);
      const customerEmail = optionalString(dto.customer?.email);
      if (customerName) leadData.name = customerName;
      if (customerPhone) leadData.phone = customerPhone;
      if (customerEmail) leadData.email = customerEmail;

      const lead = await tx.lead.create({ data: leadData });

      const conversation = await tx.conversation.create({
        data: {
          tenantId: channel.tenantId,
          leadId: lead.id,
          channelId: channel.id,
          externalConversationId: sessionId,
          status: "OPEN",
          subject: shortSubject(text),
          lastMessageAt: createdAt,
          aiEnabled: channelState[0]?.automaticRepliesEnabled ?? false,
          handoffRequested: false,
          metadata: {
            widgetSessionId: sessionId,
            pageUrl: optionalString(dto.pageUrl) ?? "",
            referrer: optionalString(dto.referrer) ?? "",
          },
          createdAt,
          updatedAt: createdAt,
        },
        include: { lead: true, messages: { orderBy: { createdAt: "asc" } } },
      });

      await tx.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: lead.id,
          type: "conversation_started",
          title: "Диалог из виджета сайта начат",
          message: text,
          metadata: { conversationId: conversation.id, sessionId },
        },
      });

      return conversation;
    });
  }

  private messageMetadata(dto: SendWidgetMessageDto, userAgent?: string): Prisma.InputJsonObject {
    const metadata: Record<string, Prisma.InputJsonValue> = {};
    const pageUrl = optionalString(dto.pageUrl);
    const referrer = optionalString(dto.referrer);
    const effectiveUserAgent = optionalString(dto.userAgent) ?? optionalString(userAgent);
    if (pageUrl) metadata.pageUrl = pageUrl;
    if (referrer) metadata.referrer = referrer;
    if (effectiveUserAgent) metadata.userAgent = effectiveUserAgent;
    return metadata;
  }

  private aiReplyRequest(
    channel: WidgetChannel,
    conversation: WidgetConversation,
    triggerMessageId: string,
    text: string,
  ): AiReplyEnqueueRequest {
    return {
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      triggerMessageId,
      text,
      source: "widget",
    };
  }

  private async generateAiReply(
    channel: WidgetChannel,
    conversation: WidgetConversation,
    triggerMessageId: string,
    text: string,
    receivedAt: Date,
  ): Promise<WidgetAiState> {
    const jobData = this.aiReplyRequest(channel, conversation, triggerMessageId, text);
    let syncAdmission: Awaited<ReturnType<AiReplyQueueService["admit"]>> | null = null;
    const messages: AiMessage[] = [
      ...conversation.messages.map((message) => ({
        role: message.senderType === "AI" ? ("assistant" as const) : ("user" as const),
        content: message.text ?? "",
      })),
      { role: "user", content: text },
    ];

    if (this.aiReplyQueue.enabled) {
      const queueResult = await this.aiReplyQueue.enqueue(jobData);
      if (queueResult.queued) {
        if (conversation.leadId) {
          await this.prisma.leadEvent.create({
            data: {
              tenantId: channel.tenantId,
              leadId: conversation.leadId,
              type: "widget_ai_reply_queued",
              title: "Widget AI reply queued",
              message: text,
              metadata: { conversationId: conversation.id, jobId: queueResult.jobId ?? null },
            },
          });
        }
        return {
          replied: false,
          handoffRequired: false,
          confidence: 0,
          intent: "queued",
        };
      }
      return {
        replied: false,
        handoffRequired: false,
        confidence: 0,
        intent: "automatic_replies_inactive",
      };
    }

    syncAdmission = await this.aiReplyQueue.admit(jobData);
    if (!syncAdmission.admitted) {
      return {
        replied: false,
        handoffRequired: false,
        confidence: 0,
        intent: "automatic_replies_inactive",
      };
    }
    const identity = await resolveAiBusinessIdentity(this.prisma, {
      tenantId: channel.tenantId,
      legacyIdentity: () => ({
        businessName: this.mapConfig(channel).businessName,
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

    const aiCreatedAt = new Date(receivedAt.getTime() + 850);
    const handoffRequired = aiReply.handoffRequired || recommendation.handoffRequired;

    const finalAdmission = await this.aiReplyQueue.admit(jobData);
    if (
      !finalAdmission.admitted ||
      finalAdmission.channelGeneration !== syncAdmission.channelGeneration ||
      finalAdmission.publicationId !== syncAdmission.publicationId ||
      finalAdmission.publicationEtag !== syncAdmission.publicationEtag ||
      finalAdmission.channelFingerprint !== syncAdmission.channelFingerprint
    ) {
      return {
        replied: false,
        handoffRequired: false,
        confidence: 0,
        intent: "automatic_replies_revoked",
      };
    }

    await this.prisma.message.create({
      data: {
        tenantId: channel.tenantId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AI",
        text: aiReply.reply,
        status: "SENT",
        metadata: {
          intent: aiReply.intent,
          confidence: aiReply.confidence,
          nextAction: recommendation.action,
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
        actionType: "widget_generate_reply",
        inputTokens: Math.max(24, Math.round(text.length / 4)),
        outputTokens: Math.max(18, Math.round(aiReply.reply.length / 4)),
        estimatedCost: "0.000000",
        latencyMs: 28,
        status: "SUCCESS",
        metadata: {
          intent: aiReply.intent,
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
          ...(summary
            ? { summary }
            : conversation.lead?.summary
              ? { summary: conversation.lead.summary }
              : {}),
          updatedAt: aiCreatedAt,
        },
      });

      await this.prisma.leadEvent.create({
        data: {
          tenantId: channel.tenantId,
          leadId: conversation.leadId,
          type: "ai_reply_generated",
          title: "AI reply generated",
          message: aiReply.reply,
          metadata: {
            conversationId: conversation.id,
            intent: aiReply.intent,
            nextAction: recommendation.action,
            handoffRequired,
          },
        },
      });
    }

    return {
      replied: true,
      handoffRequired,
      confidence: aiReply.confidence,
      intent: aiReply.intent,
    };
  }

  private async responseForSession(
    channel: WidgetChannel,
    sessionId: string,
    ai: WidgetAiState,
  ): Promise<WidgetMessageResponse> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalConversationId: sessionId,
        deletedAt: null,
      },
      include: { lead: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      throw new NotFoundException("Widget conversation not found");
    }
    return this.mapResponse(sessionId, conversation, ai);
  }

  private mapResponse(
    sessionId: string,
    conversation: WidgetConversation,
    ai: WidgetAiState,
  ): WidgetMessageResponse {
    return {
      sessionId,
      conversationId: conversation.id,
      leadId: conversation.leadId,
      status: conversation.status,
      messages: conversation.messages.map(
        (message): WidgetConversationMessage => ({
          id: message.id,
          senderType: message.senderType,
          direction: message.direction,
          text: message.text,
          createdAt: message.createdAt.toISOString(),
          status: message.status,
        }),
      ),
      ai,
    };
  }
}
