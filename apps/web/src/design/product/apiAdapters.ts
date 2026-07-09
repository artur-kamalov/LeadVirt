import type {
  ChannelType,
  ConversationDetail,
  ConversationStatus,
  Lead as ApiLead,
  LeadStatus,
  LeadTemperature,
  Message
} from "@leadvirt/types";
import type { ChatMessage, Lead } from "./types";
import type { ChannelId, StageId } from "./shared";

export function channelIdFromType(channelType?: ChannelType | null): ChannelId {
  switch (channelType) {
    case "INSTAGRAM":
      return "instagram";
    case "WHATSAPP":
      return "whatsapp";
    case "TELEGRAM":
      return "telegram";
    case "VK":
      return "vk";
    case "EMAIL":
      return "email";
    case "PHONE":
      return "call";
    case "WEBHOOK":
      return "webhook";
    case "WEBSITE":
    case "DEMO":
    case null:
    case undefined:
      return "website";
  }
}

export function stageFromStatus(status?: LeadStatus | null, conversationStatus?: ConversationStatus | null): StageId {
  switch (status) {
    case "NEW":
      return "new";
    case "IN_PROGRESS":
      return "progress";
    case "QUALIFIED":
      return "qualified";
    case "BOOKED":
    case "ORDERED":
      return "booked";
    case "SENT_TO_CRM":
      return "crm";
    case "CLOSED":
    case "LOST":
      return "closed";
    case null:
    case undefined:
      break;
  }

  switch (conversationStatus) {
    case "OPEN":
      return "new";
    case "WAITING_FOR_CUSTOMER":
    case "WAITING_FOR_HUMAN":
      return "progress";
    case "CLOSED":
      return "closed";
    case null:
    case undefined:
      return "closed";
  }
}

export function tempFromTemperature(temperature?: LeadTemperature | null): Lead["temp"] {
  switch (temperature) {
    case "HOT":
      return "hot";
    case "WARM":
      return "warm";
    case "COLD":
    case null:
    case undefined:
      return "cold";
  }
}

export function relativeTimeLabel(value?: string | null) {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "сейчас";
  if (diffMinutes < 60) return `${diffMinutes} мин`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ч`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} д`;
}

export function formatMessageTime(value?: string | null) {
  if (!value) {
    return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function localizeSeedText(value?: string | null) {
  if (!value) return "";

  const exact: Record<string, string> = {
    "Delivery Demo": "Тест доставки",
    "LeadVirt Sample Lead": "Тестовый лид LeadVirt",
    "LeadVirt Demo": "Демо LeadVirt",
    "Webhook Demo Client": "Клиент из webhook-демо",
    "Telegram bot": "Telegram-бот",
    "Website widget": "Виджет сайта",
    "Email campaign": "Email-кампания",
    "Referral": "Рекомендация",
    "Demo Owner": "Менеджер demo",
    "Instagram ads": "Реклама Instagram",
    "Instagram Direct": "Instagram Direct",
    "VK messages": "Сообщения VK",
    "Call tracking": "Коллтрекинг",
    "Partner landing form": "Форма партнёрского лендинга",
    "Testing Telegram delivery history in LeadVirt.ai": "Проверка доставки Telegram в LeadVirt.ai",
    "Sample Webhook/API inbound message from the integrations page":
      "Тестовое входящее сообщение Webhook/API со страницы интеграций",
    "Sample Telegram inbound message from the integrations page":
      "Тестовое входящее сообщение Telegram со страницы интеграций",
    "I need pricing and an appointment from the webhook API": "Нужна цена и запись через webhook API",
    "Thanks, I can qualify this request. Could you share the service, preferred timing, and contact details?":
      "Спасибо, я квалифицирую заявку. Уточните услугу, удобное время и контактные данные.",
    "I can help with that. What day and time would be convenient for the customer?":
      "Помогу с этим. Какой день и время будут удобны клиенту?",
    "I can bring a manager into this conversation and keep the lead context ready.":
      "Я подключу менеджера и сохраню контекст лида.",
  };

  return exact[value] ?? value;
}

export function leadFromConversation(conversation: ConversationDetail): Lead {
  const lead = conversation.lead;
  const channelType = lead?.channelType ?? conversation.channelType ?? conversation.channel?.type;
  const lastMessageAt = conversation.lastMessageAt ?? lead?.lastMessageAt ?? lead?.createdAt;

  return {
    id: conversation.id,
    conversationId: conversation.id,
    ...(lead?.id ? { apiLeadId: lead.id } : {}),
    name: localizeSeedText(lead?.name ?? conversation.subject) || "Клиент LeadVirt",
    channel: channelIdFromType(channelType),
    stage: stageFromStatus(lead?.status, conversation.status),
    temp: tempFromTemperature(lead?.temperature),
    source: localizeSeedText(lead?.source ?? conversation.channel?.name ?? conversation.subject) || "LeadVirt",
    value: lead?.valueAmount ?? 0,
    manager: lead?.assignedToName ?? "—",
    service: localizeSeedText(lead?.interest ?? conversation.subject) || "Входящий диалог",
    lastMessage: localizeSeedText(conversation.lastMessage ?? lead?.summary) || "Новый диалог",
    time: relativeTimeLabel(lastMessageAt),
    unread: conversation.unreadCount ?? 0,
    ai: conversation.aiEnabled,
  };
}

export function leadFromApiLead(lead: ApiLead, conversationId?: string): Lead {
  return {
    id: lead.id,
    apiLeadId: lead.id,
    ...(conversationId ? { conversationId } : {}),
    name: localizeSeedText(lead.name) || "Клиент LeadVirt",
    channel: channelIdFromType(lead.channelType),
    stage: stageFromStatus(lead.status),
    temp: tempFromTemperature(lead.temperature),
    source: localizeSeedText(lead.source) || "LeadVirt",
    value: lead.valueAmount ?? 0,
    manager: lead.assignedToName ?? "—",
    service: localizeSeedText(lead.interest ?? lead.summary) || "Входящий лид",
    lastMessage: localizeSeedText(lead.summary ?? lead.interest) || "Новый лид",
    time: relativeTimeLabel(lead.lastMessageAt ?? lead.createdAt),
    unread: 0,
    ai: true,
  };
}

export function statusFromStage(stage: StageId): LeadStatus {
  switch (stage) {
    case "new":
      return "NEW";
    case "progress":
      return "IN_PROGRESS";
    case "qualified":
      return "QUALIFIED";
    case "booked":
      return "BOOKED";
    case "crm":
      return "SENT_TO_CRM";
    case "closed":
      return "CLOSED";
  }
}

function chatMessageFromApi(message: Message): ChatMessage {
  return {
    id: message.id,
    from: message.senderType === "AI" ? "ai" : message.senderType === "CUSTOMER" ? "client" : "manager",
    text: localizeSeedText(message.text) || "",
    time: formatMessageTime(message.createdAt),
    attachments: message.attachments?.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      url: attachment.url,
      sizeBytes: attachment.sizeBytes,
    })),
  };
}

export function messagesFromConversation(conversation: ConversationDetail): ChatMessage[] {
  const messages = conversation.messages
    .map(chatMessageFromApi)
    .filter((message) => message.text.trim().length > 0 || (message.attachments?.length ?? 0) > 0);

  if (messages.length > 0) {
    return messages;
  }

  const fallbackText = localizeSeedText(conversation.lastMessage ?? conversation.lead?.summary);
  if (!fallbackText) {
    return [];
  }

  return [
    {
      id: `${conversation.id}:last-message`,
      from: "client",
      text: fallbackText,
      time: formatMessageTime(conversation.lastMessageAt),
    },
  ];
}
