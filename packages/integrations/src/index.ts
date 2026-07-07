import type { ChannelType } from "@leadvirt/types";

export interface WebhookVerificationInput {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  secret?: string;
}

export interface NormalizedAttachment {
  url: string;
  mimeType?: string;
  fileName?: string;
}

export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalConversationId: string;
  customerExternalId: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  text?: string;
  attachments?: NormalizedAttachment[];
  timestamp: string;
  raw: unknown;
}

export interface SendMessageInput {
  tenantId: string;
  channelAccountId: string;
  conversationId: string;
  externalConversationId: string;
  text: string;
  attachments?: string[];
  settings?: unknown;
  credentials?: unknown;
  metadata?: Record<string, unknown>;
}

export interface SendMessageResult {
  externalMessageId: string;
  status: "queued" | "sent" | "failed";
}

export interface ChannelAdapter {
  type: ChannelType;
  verifyWebhook?(input: WebhookVerificationInput): Promise<boolean>;
  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}

export interface CrmCreateLeadInput {
  tenantId: string;
  leadId: string;
  fields: Record<string, unknown>;
}

export interface CrmCreateLeadResult {
  externalId: string;
  url?: string;
}

export interface CrmAdapter {
  provider: string;
  createLead(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult>;
  updateLead(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult>;
  createTask(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult>;
}

export interface CalendarAdapter {
  provider: string;
  createBooking(input: {
    tenantId: string;
    leadId: string;
    title: string;
    startsAt: string;
    endsAt?: string;
  }): Promise<{ externalId: string; url?: string }>;
}

abstract class StubChannelAdapter implements ChannelAdapter {
  abstract type: ChannelType;

  normalizeInbound(input: unknown): Promise<NormalizedInboundMessage> {
    return Promise.resolve({
      externalMessageId: `mock-${Date.now()}`,
      externalConversationId: "mock-conversation",
      customerExternalId: "mock-customer",
      text: typeof input === "string" ? input : "Mock inbound message",
      timestamp: new Date().toISOString(),
      raw: input
    });
  }

  sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return Promise.resolve({
      externalMessageId: `${input.channelAccountId}-${Date.now()}`,
      status: "queued"
    });
  }
}

export class WebsiteWidgetAdapter extends StubChannelAdapter {
  type = "WEBSITE" as const;
}

export class TelegramAdapter extends StubChannelAdapter {
  type = "TELEGRAM" as const;

  verifyWebhook(input: WebhookVerificationInput): Promise<boolean> {
    if (!input.secret) {
      return Promise.resolve(true);
    }
    const token = readHeader(input.headers, "x-telegram-bot-api-secret-token");
    return Promise.resolve(token === input.secret);
  }

  override normalizeInbound(input: unknown): Promise<NormalizedInboundMessage> {
    const update = isRecord(input) ? input : {};
    const message = isRecord(update.message) ? update.message : isRecord(update.edited_message) ? update.edited_message : {};
    const chat = isRecord(message.chat) ? message.chat : {};
    const from = isRecord(message.from) ? message.from : {};
    const contact = isRecord(message.contact) ? message.contact : {};
    const updateId = readScalar(update.update_id, "telegram-update");
    const messageId = readScalar(message.message_id, updateId);
    const chatId = readScalar(chat.id, readScalar(from.id, "telegram-chat"));
    const customerId = readScalar(from.id, chatId);
    const firstName = typeof from.first_name === "string" ? from.first_name : "";
    const lastName = typeof from.last_name === "string" ? from.last_name : "";
    const username = typeof from.username === "string" ? `@${from.username}` : "";
    const customerName = [firstName, lastName].filter(Boolean).join(" ") || username || undefined;
    const phone = typeof contact.phone_number === "string" ? contact.phone_number : undefined;
    const text = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "Telegram message";
    const unixDate = typeof message.date === "number" ? message.date : undefined;

    return Promise.resolve({
      externalMessageId: `telegram:${messageId}`,
      externalConversationId: `telegram:${chatId}`,
      customerExternalId: `telegram:${customerId}`,
      ...(customerName ? { customerName } : {}),
      ...(phone ? { customerPhone: phone } : {}),
      text,
      timestamp: unixDate ? new Date(unixDate * 1000).toISOString() : new Date().toISOString(),
      raw: input
    });
  }
}

export class EmailAdapter extends StubChannelAdapter {
  type = "EMAIL" as const;
}

export class WebhookAdapter extends StubChannelAdapter {
  type = "WEBHOOK" as const;

  verifyWebhook(input: WebhookVerificationInput): Promise<boolean> {
    if (!input.secret) {
      return Promise.resolve(true);
    }

    const explicitSecret = readHeader(input.headers, "x-leadvirt-webhook-secret") ?? readHeader(input.headers, "x-webhook-secret");
    const authHeader = readHeader(input.headers, "authorization");
    const bearerSecret = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : undefined;

    return Promise.resolve(explicitSecret === input.secret || bearerSecret === input.secret);
  }

  override normalizeInbound(input: unknown): Promise<NormalizedInboundMessage> {
    const payload = isRecord(input) ? input : {};
    const umnico = normalizeUmnicoInbound(input, payload);
    if (umnico) {
      return Promise.resolve(umnico);
    }

    const message = isRecord(payload.message) ? payload.message : {};
    const customer = firstRecord(payload.customer, payload.contact, payload.lead, payload.from);
    const eventId = readScalar(firstValue(payload.eventId, payload.event_id, payload.id), "webhook-event");
    const messageId = readScalar(firstValue(message.id, message.messageId, message.message_id, payload.messageId, payload.message_id), eventId);
    const conversationId = readScalar(
      firstValue(payload.conversationId, payload.conversation_id, payload.threadId, payload.sessionId, payload.orderId, customer.id, customer.externalId),
      messageId
    );
    const customerId = readScalar(firstValue(customer.id, customer.externalId, customer.external_id, customer.email, customer.phone), conversationId);
    const firstName = typeof customer.firstName === "string" ? customer.firstName : typeof customer.first_name === "string" ? customer.first_name : "";
    const lastName = typeof customer.lastName === "string" ? customer.lastName : typeof customer.last_name === "string" ? customer.last_name : "";
    const fallbackName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
    const customerName = (typeof customer.name === "string" ? customer.name : undefined) ?? fallbackName;
    const customerPhone = typeof customer.phone === "string" ? customer.phone : undefined;
    const customerEmail = typeof customer.email === "string" ? customer.email : undefined;
    const textValue = firstValue(message.text, payload.text, typeof payload.message === "string" ? payload.message : undefined, payload.body);
    const text = typeof textValue === "string" && textValue.trim().length > 0 ? textValue : "Webhook message";
    const timestampValue = firstValue(message.timestamp, message.createdAt, message.created_at, payload.timestamp, payload.createdAt, payload.created_at);

    return Promise.resolve({
      externalMessageId: `webhook:${messageId}`,
      externalConversationId: `webhook:${conversationId}`,
      customerExternalId: `webhook:${customerId}`,
      ...(customerName ? { customerName } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(customerEmail ? { customerEmail } : {}),
      text,
      timestamp: normalizeTimestamp(timestampValue),
      raw: input
    });
  }

  override async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const config = umnicoConfig(input);
    if (!config.enabled) {
      return super.sendMessage(input);
    }

    const customId = readScalar(firstValue(input.metadata?.messageId, input.metadata?.deliveryJobId), `leadvirt:${input.conversationId}:${Date.now()}`);
    if (!config.token || !config.leadId) {
      return { externalMessageId: customId, status: "failed" };
    }

    const source = config.sourceRealId ?? (await fetchUmnicoSource(config).catch(() => undefined));
    const userId = config.userId ?? (await fetchUmnicoUserId(config).catch(() => undefined));
    if (!source || !userId) {
      return { externalMessageId: customId, status: "failed" };
    }

    const body: Record<string, unknown> = {
      message: { text: input.text },
      source: String(source),
      userId,
      customId
    };
    if (config.saId) body.saId = config.saId;

    const response = await fetch(`${config.baseUrl}/messaging/${encodeURIComponent(config.leadId)}/send`, {
      method: "POST",
      headers: {
        authorization: `bearer ${config.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }).catch(() => null);

    if (!response?.ok) {
      return { externalMessageId: customId, status: "failed" };
    }

    const payload: unknown = await response.json().catch(() => null);
    const sentRecords = Array.isArray(payload) ? payload.filter(isRecord) : [];
    const sent = sentRecords[0] ?? firstRecord(payload);
    const externalId = readScalar(firstValue(sent.messageId, sent.id, sent.customId), customId);
    return {
      externalMessageId: `umnico:${config.leadId}:${externalId}`,
      status: "sent"
    };
  }
}

function normalizeUmnicoInbound(input: unknown, payload: Record<string, unknown>): NormalizedInboundMessage | null {
  if (payload.type !== "message.incoming") {
    return null;
  }

  const message = firstRecord(payload.message);
  const data = firstRecord(message.data, payload.data);
  const nestedMessage = firstRecord(message.message, data.message);
  const lead = firstRecord(payload.lead);
  const sender = firstRecord(message.sender, payload.sender);
  const customer = firstRecord(payload.customer, payload.contact, payload.client, payload.from, message.customer, message.contact, sender, lead.customer);
  const socialAccount = firstRecord(payload.socialAccount, payload.social_account, message.socialAccount, message.social_account, message.sa, payload.source, message.source, lead.socialAccount);

  const accountId = readScalar(firstValue(payload.accountId, payload.account_id, message.accountId, message.account_id, socialAccount.id), "umnico-account");
  const leadId = readScalar(firstValue(payload.leadId, payload.lead_id, message.leadId, message.lead_id, lead.id), "umnico-lead");
  const timestampValue = firstValue(message.timestamp, message.datetime, message.createdAt, message.created_at, data.timestamp, payload.timestamp, payload.createdAt, payload.created_at);
  const messageId = readScalar(
    firstValue(message.id, message.messageId, message.message_id, payload.messageId, payload.message_id, data.id, nestedMessage.id),
    `${leadId}:${readScalar(timestampValue, String(Date.now()))}`
  );
  const customerId = readScalar(
    firstValue(customer.id, customer.customerId, customer.customer_id, payload.customerId, payload.customer_id, message.customerId, message.customer_id, sender.customerId, sender.customer_id, lead.customerId, lead.customer_id),
    leadId
  );

  const firstName = typeof customer.firstName === "string" ? customer.firstName : typeof customer.first_name === "string" ? customer.first_name : "";
  const lastName = typeof customer.lastName === "string" ? customer.lastName : typeof customer.last_name === "string" ? customer.last_name : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const username = firstString(customer.username, customer.login, customer.nickname, customer.screenName, customer.screen_name);
  const customerName = firstString(customer.name, fullName, username);
  const customerPhone = firstString(customer.phone, customer.phoneNumber, customer.phone_number);
  const customerEmail = firstString(customer.email);
  const textValue = firstValue(nestedMessage.text, message.text, data.text, nestedMessage.caption, message.caption, data.caption, nestedMessage.body, message.body, data.body, payload.text, payload.body);
  const text = typeof textValue === "string" && textValue.trim().length > 0 ? textValue : "Umnico message";
  const attachments = normalizeAttachments(message.attachment, message.attachments, data.attachment, data.attachments);

  return {
    externalMessageId: `umnico:${accountId}:${messageId}`,
    externalConversationId: `umnico:${accountId}:${leadId}`,
    customerExternalId: `umnico:${customerId}`,
    ...(customerName ? { customerName } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    text,
    ...(attachments ? { attachments } : {}),
    timestamp: normalizeTimestamp(timestampValue),
    raw: input
  };
}

interface UmnicoDeliveryConfig {
  enabled: boolean;
  baseUrl: string;
  token?: string;
  leadId?: string;
  sourceRealId?: string;
  userId?: number;
  saId?: number;
}

function normalizeUmnicoBaseUrl(value: unknown) {
  const configured = firstString(value) ?? "https://api.umnico.com/v1.3";
  const cleaned = configured.replace(/\/$/, "");
  return cleaned.endsWith("/v1.3") ? cleaned : `${cleaned}/v1.3`;
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function parseUmnicoLeadId(externalConversationId: string) {
  const parts = externalConversationId.split(":");
  return parts[0] === "umnico" && parts.length >= 3 ? parts.slice(2).join(":") : undefined;
}

function umnicoConfig(input: SendMessageInput): UmnicoDeliveryConfig {
  const settings = firstRecord(input.settings);
  const credentials = firstRecord(input.credentials);
  const metadata = firstRecord(input.metadata);
  const webhook = firstRecord(settings.webhook);
  const umnico = firstRecord(settings.umnico, webhook.umnico, credentials.umnico);
  const raw = firstRecord(metadata.raw, metadata.triggerRaw, metadata.triggerMessageRaw);
  const rawMessage = firstRecord(raw.message);
  const rawSource = firstRecord(rawMessage.source, raw.source);
  const rawSa = firstRecord(rawMessage.sa, raw.sa);
  const provider = firstString(umnico.provider, webhook.provider, settings.provider);
  const enabled = provider?.toLowerCase() === "umnico" || input.externalConversationId.startsWith("umnico:");
  const token = firstString(
    umnico.apiToken,
    umnico.token,
    umnico.jwt,
    umnico.accessToken,
    webhook.umnicoApiToken,
    settings.umnicoApiToken,
    credentials.apiToken,
    credentials.token,
    credentials.jwt,
    credentials.accessToken
  );
  const leadId = firstString(metadata.umnicoLeadId, umnico.leadId, webhook.umnicoLeadId, parseUmnicoLeadId(input.externalConversationId));
  const sourceRealId = readScalar(firstValue(metadata.umnicoSourceRealId, metadata.sourceRealId, umnico.sourceRealId, webhook.umnicoSourceRealId, rawSource.realId, rawSource.real_id, rawSource.id), "") || undefined;
  const userId = positiveNumber(firstValue(metadata.umnicoUserId, umnico.userId, webhook.umnicoUserId, settings.umnicoUserId));
  const saId = positiveNumber(firstValue(metadata.umnicoSaId, umnico.saId, webhook.umnicoSaId, rawSa.id, rawSource.saId));

  return {
    enabled,
    baseUrl: normalizeUmnicoBaseUrl(firstValue(umnico.apiBase, umnico.baseUrl, webhook.umnicoApiBase, settings.umnicoApiBase)),
    ...(token ? { token } : {}),
    ...(leadId ? { leadId } : {}),
    ...(sourceRealId ? { sourceRealId } : {}),
    ...(userId ? { userId } : {}),
    ...(saId ? { saId } : {})
  };
}

async function fetchUmnicoSource(config: UmnicoDeliveryConfig): Promise<string | undefined> {
  if (!config.token || !config.leadId) return undefined;
  const response = await fetch(`${config.baseUrl}/messaging/${encodeURIComponent(config.leadId)}/sources`, {
    headers: { authorization: `bearer ${config.token}` }
  });
  if (!response.ok) return undefined;
  const payload: unknown = await response.json().catch(() => null);
  const sources = Array.isArray(payload) ? payload.filter(isRecord) : [];
  const preferred = sources.find((source) => firstString(source.type)?.toLowerCase() === "message") ?? sources[0];
  return preferred ? readScalar(firstValue(preferred.realId, preferred.real_id, preferred.id), "") || undefined : undefined;
}

async function fetchUmnicoUserId(config: UmnicoDeliveryConfig): Promise<number | undefined> {
  if (!config.token) return undefined;
  const response = await fetch(`${config.baseUrl}/managers`, {
    headers: { authorization: `bearer ${config.token}` }
  });
  if (!response.ok) return undefined;
  const payload: unknown = await response.json().catch(() => null);
  const managers = Array.isArray(payload) ? payload.filter(isRecord) : [];
  const preferred = managers.find((manager) => firstString(manager.role)?.toLowerCase() === "owner") ?? managers[0];
  return preferred ? positiveNumber(preferred.id) : undefined;
}

export class AmoCrmAdapter implements CrmAdapter {
  provider = "AMOCRM";

  createLead(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult> {
    return Promise.resolve({ externalId: `amo-${input.leadId}`, url: `https://amocrm.demo.local/leads/detail/${input.leadId}` });
  }

  updateLead(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult> {
    return Promise.resolve({ externalId: `amo-${input.leadId}`, url: `https://amocrm.demo.local/leads/detail/${input.leadId}` });
  }

  createTask(input: CrmCreateLeadInput): Promise<CrmCreateLeadResult> {
    return Promise.resolve({ externalId: `amo-task-${input.leadId}`, url: `https://amocrm.demo.local/tasks/${input.leadId}` });
  }
}

export class BitrixAdapter extends AmoCrmAdapter {
  override provider = "BITRIX24";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readScalar(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readHeader(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function normalizeAttachments(...values: unknown[]): NormalizedAttachment[] | undefined {
  const records = values.flatMap((value) => {
    if (Array.isArray(value)) return value.filter(isRecord);
    return isRecord(value) ? [value] : [];
  });
  const attachments = records
    .map((record) => {
      const media = firstRecord(record.media, record.file);
      const url = firstString(record.url, record.src, record.href, record.path, media.url, media.src, media.path);
      if (!url) return null;
      const mimeType = firstString(record.mimeType, record.mime_type, record.mime, record.contentType, record.content_type, media.mimeType, media.mime_type, media.mime, media.contentType);
      const fileName = firstString(record.fileName, record.file_name, record.name, record.filename, media.fileName, media.file_name, media.name, media.filename);
      return {
        url,
        ...(mimeType ? { mimeType } : {}),
        ...(fileName ? { fileName } : {})
      };
    })
    .filter((attachment): attachment is NormalizedAttachment => Boolean(attachment));
  return attachments.length > 0 ? attachments : undefined;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}
