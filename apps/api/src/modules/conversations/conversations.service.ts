import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue, type ConnectionOptions } from "bullmq";
import { AI_PROVIDER_TOKEN, type AiProvider } from "@leadvirt/ai";
import type { AiDraftReply, Channel, ChannelSendMessageJobData, ConversationDetail, Lead, Message, PaginatedEnvelope } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import { positiveInt } from "../../common/pagination.js";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AssignConversationDto } from "./dto/assign-conversation.dto.js";
import type { ListConversationsDto } from "./dto/list-conversations.dto.js";
import type { SendMessageDto } from "./dto/send-message.dto.js";
import type { UpdateConversationStatusDto } from "./dto/update-conversation-status.dto.js";

type LeadWithOwner = Prisma.LeadGetPayload<{
  include: { assignedTo: { select: { name: true } } };
}>;

type ConversationWithPreview = Prisma.ConversationGetPayload<{
  include: {
    lead: { include: { assignedTo: { select: { name: true } } } };
    channel: true;
    messages: { orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;

type ConversationWithDetail = Prisma.ConversationGetPayload<{
  include: {
    lead: { include: { assignedTo: { select: { name: true } }; events: { orderBy: { createdAt: "desc" }; take: 20 } } };
    channel: true;
    messages: { orderBy: { createdAt: "asc" }; include: { attachments: true } };
  };
}>;

function channelSendSource(channel: ConversationWithDetail["channel"]): ChannelSendMessageJobData["source"] | null {
  if (!channel || channel.status !== "ACTIVE") return null;
  if (channel.type === "TELEGRAM") return "telegram";
  if (channel.type === "WEBHOOK") return "webhook";
  return null;
}

function connectionFromRedisUrl(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6380),
    maxRetriesPerRequest: null
  };

  if (parsed.username) connection.username = decodeURIComponent(parsed.username);
  if (parsed.password) connection.password = decodeURIComponent(parsed.password);
  return connection;
}

function attachmentKind(mimeType?: string) {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document";
  return "file";
}

function attachmentSummary(attachments: NonNullable<SendMessageDto["attachments"]>) {
  return attachments.map((attachment) => attachment.filename ?? "attachment").join(", ");
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider
  ) {}

  async list(context: RequestContext, query: ListConversationsDto): Promise<PaginatedEnvelope<ConversationDetail>> {
    const where: Prisma.ConversationWhereInput = {
      tenantId: context.tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: { type: query.channel } } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: "insensitive" } },
              { lead: { name: { contains: query.search, mode: "insensitive" } } },
              { messages: { some: { text: { contains: query.search, mode: "insensitive" } } } }
            ]
          }
        : {})
    };

    const page = positiveInt(query.page, 1, 100);
    const limit = positiveInt(query.limit, 20, 100);
    const [total, rows] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          lead: { include: { assignedTo: { select: { name: true } } } },
          channel: true,
          messages: { orderBy: { createdAt: "desc" }, take: 1 }
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      data: rows.map((row) => this.mapConversationPreview(row)),
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total
      }
    };
  }

  async get(context: RequestContext, id: string): Promise<ConversationDetail> {
    const conversation = await this.loadConversation(context.tenantId, id);
    return this.mapConversationDetail(conversation);
  }

  async draftAiReply(context: RequestContext, id: string): Promise<AiDraftReply> {
    const conversation = await this.loadConversation(context.tenantId, id);
    return this.aiProvider.generateReply({
      tenantId: context.tenantId,
      businessName: context.tenant.name,
      conversationId: conversation.id,
      ...(context.tenant.businessType ? { businessType: context.tenant.businessType } : {}),
      messages: conversation.messages.map((message) => ({
        role: message.senderType === "AI" ? "assistant" : "user",
        content: message.text ?? ""
      }))
    });
  }

  async sendMessage(context: RequestContext, id: string, dto: SendMessageDto): Promise<ConversationDetail> {
    const conversation = await this.loadConversation(context.tenantId, id);
    const createdAt = new Date();
    const attachments = dto.attachments ?? [];
    const text = dto.text?.trim() ?? "";
    if (!text && attachments.length === 0) {
      throw new BadRequestException("Message text or attachment is required.");
    }
    const deliverySource = text ? channelSendSource(conversation.channel) : null;

    const userMessage = await this.prisma.message.create({
      data: {
        tenantId: context.tenantId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "USER",
        senderUserId: context.userId,
        text: text || null,
        status: deliverySource ? "QUEUED" : "SENT",
        ...(deliverySource ? { metadata: { outboundStatus: "queued", attachmentCount: attachments.length } } : {}),
        createdAt,
        updatedAt: createdAt
      }
    });

    if (attachments.length > 0) {
      await this.prisma.messageAttachment.createMany({
        data: attachments.map((attachment) => ({
          tenantId: context.tenantId,
          messageId: userMessage.id,
          kind: attachmentKind(attachment.mimeType),
          url: attachment.dataUrl,
          ...(attachment.filename ? { filename: attachment.filename } : {}),
          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
          ...(typeof attachment.sizeBytes === "number" ? { sizeBytes: attachment.sizeBytes } : {})
        }))
      });
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: createdAt, updatedAt: createdAt }
    });

    const deliveryJobId = deliverySource ? await this.enqueueChannelDelivery(context, conversation.id, userMessage.id, deliverySource, createdAt) : null;
    if (deliveryJobId) {
      await this.prisma.message.update({
        where: { id: userMessage.id },
        data: {
          metadata: {
            outboundStatus: "queued",
            deliveryJobId
          }
        }
      });
    }

    if (conversation.leadId) {
      await this.prisma.leadEvent.create({
        data: {
          tenantId: context.tenantId,
          leadId: conversation.leadId,
          type: "message_sent",
          title: "Message sent",
          message: text || attachmentSummary(attachments),
          metadata: { conversationId: conversation.id }
        }
      });
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "message.sent",
        entityType: "conversation",
        entityId: conversation.id,
        payload: {
          deliverySource,
          deliveryJobId,
          attachmentCount: attachments.length
        }
      }
    });

    return this.get(context, id);
  }

  private async enqueueChannelDelivery(
    context: RequestContext,
    conversationId: string,
    messageId: string,
    source: ChannelSendMessageJobData["source"],
    requestedAt: Date
  ) {
    const queue = new Queue<ChannelSendMessageJobData>("channels.sendMessage", {
      connection: connectionFromRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6380")
    });
    const jobId = `channel-send-${messageId}`;

    try {
      const job = await queue.add(
        "send-message",
        {
          tenantId: context.tenantId,
          conversationId,
          messageId,
          source,
          requestedByUserId: context.userId,
          requestedAt: requestedAt.toISOString()
        } as ChannelSendMessageJobData & { requestedByUserId: string },
        {
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 }
        }
      );
      return job.id ?? jobId;
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  async updateStatus(context: RequestContext, id: string, dto: UpdateConversationStatusDto): Promise<ConversationDetail> {
    await this.ensureConversation(context.tenantId, id);
    const conversation = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: dto.status,
        handoffRequested: dto.status === "WAITING_FOR_HUMAN"
      }
    });
    await this.logConversationAction(context, "conversation.status_changed", conversation.id, { status: dto.status });
    return this.get(context, id);
  }

  async assign(context: RequestContext, id: string, dto: AssignConversationDto): Promise<ConversationDetail> {
    await this.ensureConversation(context.tenantId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        assignedToUserId: dto.userId ?? context.userId,
        status: "WAITING_FOR_HUMAN"
      }
    });
    await this.logConversationAction(context, "conversation.assigned", id, { userId: dto.userId ?? context.userId });
    return this.get(context, id);
  }

  async handoff(context: RequestContext, id: string): Promise<ConversationDetail> {
    await this.ensureConversation(context.tenantId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        handoffRequested: true,
        status: "WAITING_FOR_HUMAN"
      }
    });
    await this.logConversationAction(context, "conversation.handoff_requested", id, {});
    return this.get(context, id);
  }

  private async loadConversation(tenantId: string, id: string): Promise<ConversationWithDetail> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        lead: {
          include: {
            assignedTo: { select: { name: true } },
            events: { orderBy: { createdAt: "desc" }, take: 20 }
          }
        },
        channel: true,
        messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } }
      }
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found.");
    }
    return conversation;
  }

  private async ensureConversation(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true }
    });
    if (!conversation) {
      throw new NotFoundException("Conversation was not found.");
    }
    return conversation;
  }

  private mapConversationPreview(conversation: ConversationWithPreview): ConversationDetail {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      leadId: conversation.leadId,
      channel: this.mapChannel(conversation.channel),
      channelType: conversation.channel?.type ?? null,
      status: conversation.status,
      subject: conversation.subject,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      aiEnabled: conversation.aiEnabled,
      handoffRequested: conversation.handoffRequested,
      lead: conversation.lead ? this.mapLead(conversation.lead) : null,
      lastMessage: conversation.messages[0]?.text ?? null,
      unreadCount: conversation.status === "OPEN" ? 1 : 0,
      messages: [],
      events: []
    };
  }

  private mapConversationDetail(conversation: ConversationWithDetail): ConversationDetail {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      leadId: conversation.leadId,
      channel: this.mapChannel(conversation.channel),
      channelType: conversation.channel?.type ?? null,
      status: conversation.status,
      subject: conversation.subject,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      aiEnabled: conversation.aiEnabled,
      handoffRequested: conversation.handoffRequested,
      lead: conversation.lead ? this.mapLead(conversation.lead) : null,
      lastMessage: conversation.messages.at(-1)?.text ?? null,
      unreadCount: conversation.status === "OPEN" ? 1 : 0,
      messages: conversation.messages.map((message) => this.mapMessage(message)),
      events:
        conversation.lead?.events.map((event) => ({
          id: event.id,
          leadId: event.leadId,
          type: event.type,
          title: event.title,
          message: event.message,
          createdAt: event.createdAt.toISOString()
        })) ?? []
    };
  }

  private mapLead(lead: LeadWithOwner): Lead {
    return {
      id: lead.id,
      tenantId: lead.tenantId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      companyName: lead.companyName,
      source: lead.source,
      channelType: lead.channelType,
      status: lead.status,
      temperature: lead.temperature,
      valueAmount: lead.valueAmount,
      currency: lead.currency,
      interest: lead.interest,
      summary: lead.summary,
      assignedToUserId: lead.assignedToUserId,
      assignedToName: lead.assignedTo?.name ?? null,
      lastMessageAt: lead.lastMessageAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString()
    };
  }

  private mapMessage(message: ConversationWithDetail["messages"][number]): Message {
    return {
      id: message.id,
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      text: message.text,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        tenantId: attachment.tenantId,
        messageId: attachment.messageId,
        kind: attachment.kind,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        url: attachment.url,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt.toISOString()
      }))
    };
  }

  private mapChannel(channel: ConversationWithDetail["channel"]): Channel | null {
    if (!channel) {
      return null;
    }
    return {
      id: channel.id,
      tenantId: channel.tenantId,
      type: channel.type,
      status: channel.status,
      name: channel.name,
      lastHealthAt: channel.lastHealthAt?.toISOString() ?? null
    };
  }

  private async logConversationAction(context: RequestContext, action: string, entityId: string, payload: Prisma.JsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "conversation",
        entityId,
        payload
      }
    });
  }
}
