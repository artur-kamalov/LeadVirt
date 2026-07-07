import { TelegramAdapter, WebhookAdapter, type ChannelAdapter, type SendMessageResult } from "@leadvirt/integrations";
import { prisma, type Prisma } from "@leadvirt/db";
import type { ChannelSendMessageJobData } from "@leadvirt/types";
import { recordSpanError, setSpanOk, SpanKind, startSpan } from "@leadvirt/observability";
import { recordChannelDelivery } from "../observability/metrics.js";

type DeliveryMessage = Prisma.MessageGetPayload<{
  include: {
    conversation: {
      include: {
        channel: true;
        messages: true;
      };
    };
  };
}>;

export interface ChannelDeliveryResult {
  status: "sent" | "failed" | "already_delivered" | "skipped";
  messageId: string;
  outboundStatus?: SendMessageResult["status"];
  providerExternalMessageId?: string;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataWith(message: DeliveryMessage, patch: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const current = isRecord(message.metadata) ? (message.metadata as Prisma.InputJsonObject) : {};
  return {
    ...current,
    ...patch
  };
}

function triggerRaw(message: DeliveryMessage): Prisma.InputJsonValue | null {
  const inbound = message.conversation.messages[0];
  const metadata = isRecord(inbound?.metadata) ? inbound.metadata : {};
  return isRecord(metadata.raw) || Array.isArray(metadata.raw) ? metadata.raw : null;
}

function adapterFor(message: DeliveryMessage): ChannelAdapter | null {
  const type = message.conversation.channel?.type;
  if (type === "TELEGRAM") return new TelegramAdapter();
  if (type === "WEBHOOK") return new WebhookAdapter();
  return null;
}

function expectedChannelType(source: ChannelSendMessageJobData["source"]) {
  return source === "telegram" ? "TELEGRAM" : "WEBHOOK";
}

function successfulStatus(status: SendMessageResult["status"]) {
  return status === "sent" || status === "queued";
}

async function markFailed(message: DeliveryMessage, reason: string, jobId?: string): Promise<ChannelDeliveryResult> {
  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: "FAILED",
      metadata: metadataWith(message, {
        outboundStatus: "failed",
        deliveryJobId: jobId ?? null,
        delivery: {
          status: "failed",
          reason,
          jobId: jobId ?? null,
          failedAt: new Date().toISOString()
        }
      })
    }
  });

  return {
    status: "failed",
    messageId: message.id,
    reason
  };
}

export async function deliverChannelMessage(data: ChannelSendMessageJobData, jobId?: string): Promise<ChannelDeliveryResult> {
  const startedAt = Date.now();
  let deliveryStatus = "failed";
  const span = startSpan("channel.delivery", {
    kind: SpanKind.PRODUCER,
    attributes: {
      "leadvirt.tenant_id": data.tenantId,
      "leadvirt.conversation_id": data.conversationId,
      "leadvirt.message_id": data.messageId,
      "leadvirt.source": data.source,
      "messaging.system": data.source
    }
  });
  try {
  const message = await prisma.message.findFirst({
    where: {
      id: data.messageId,
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      direction: "OUTBOUND",
      senderType: { in: ["AI", "USER"] }
    },
    include: {
      conversation: {
        include: {
          channel: true,
          messages: {
            where: { direction: "INBOUND" },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }
    }
  });

  if (!message) {
    throw new Error(`Message ${data.messageId} was not found for channel delivery.`);
  }

  if (message.status === "SENT" || message.status === "DELIVERED") {
    deliveryStatus = "already_delivered";
    return {
      status: "already_delivered",
      messageId: message.id,
      reason: message.status
    };
  }

  if (message.status !== "QUEUED" && message.status !== "FAILED") {
    deliveryStatus = "skipped";
    return {
      status: "skipped",
      messageId: message.id,
      reason: `message_status_${message.status.toLowerCase()}`
    };
  }

  const channel = message.conversation.channel;
  if (!channel || channel.deletedAt || channel.status !== "ACTIVE") {
    const result = await markFailed(message, "channel_not_active", jobId);
    throw new Error(result.reason ?? "channel_not_active");
  }

  if (channel.type !== expectedChannelType(data.source)) {
    const result = await markFailed(message, `channel_type_${channel.type.toLowerCase()}_does_not_match_${data.source}`, jobId);
    throw new Error(result.reason ?? "channel_type_mismatch");
  }

  const adapter = adapterFor(message);
  if (!adapter) {
    const result = await markFailed(message, "unsupported_channel_adapter", jobId);
    throw new Error(result.reason ?? "unsupported_channel_adapter");
  }

  const text = message.text?.trim();
  if (!text) {
    const result = await markFailed(message, "message_text_empty", jobId);
    throw new Error(result.reason ?? "message_text_empty");
  }

  const outbound = await adapter.sendMessage({
    tenantId: data.tenantId,
    channelAccountId: channel.externalId ?? channel.id,
    conversationId: message.conversationId,
    externalConversationId: message.conversation.externalConversationId ?? message.conversationId,
    text,
    settings: channel.settings,
    credentials: channel.encryptedCredentials,
    metadata: {
      messageId: message.id,
      graphRunId: data.graphRunId ?? null,
      triggerMessageId: data.triggerMessageId ?? null,
      raw: triggerRaw(message),
      deliveryJobId: jobId ?? null
    }
  });

  if (!successfulStatus(outbound.status)) {
    const result = await markFailed(message, `adapter_status_${outbound.status}`, jobId);
    throw new Error(result.reason ?? `adapter_status_${outbound.status}`);
  }

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: "SENT",
      metadata: metadataWith(message, {
        outboundStatus: outbound.status,
        deliveryJobId: jobId ?? null,
        delivery: {
          status: "sent",
          adapterStatus: outbound.status,
          providerExternalMessageId: outbound.externalMessageId,
          jobId: jobId ?? null,
          sentAt: new Date().toISOString()
        }
      })
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: data.tenantId,
      action: "channel.message.sent",
      entityType: "message",
      entityId: message.id,
      payload: {
        source: data.source,
        conversationId: data.conversationId,
        channelId: channel.id,
        channelType: channel.type,
        adapterStatus: outbound.status,
        providerExternalMessageId: outbound.externalMessageId,
        graphRunId: data.graphRunId ?? null,
        triggerMessageId: data.triggerMessageId ?? null,
        jobId: jobId ?? null
      }
    }
  });

  deliveryStatus = "sent";
  return {
    status: "sent",
    messageId: message.id,
    outboundStatus: outbound.status,
    providerExternalMessageId: outbound.externalMessageId
  };
  } catch (error) {
    recordSpanError(span, error);
    throw error;
  } finally {
    span.setAttribute("leadvirt.delivery_status", deliveryStatus);
    if (deliveryStatus !== "failed") setSpanOk(span);
    span.end();
    recordChannelDelivery({
      source: data.source,
      status: deliveryStatus,
      durationMs: Date.now() - startedAt
    });
  }
}
