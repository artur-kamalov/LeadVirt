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
import { intlLocale, type Locale } from "@/i18n/config";

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

export function relativeTimeLabel(value?: string | null, locale: Locale = "en") {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  const formatter = new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
    style: "long",
  });
  if (diffMinutes < 1) return formatter.format(0, "second");
  if (diffMinutes < 60) return formatter.format(-diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return formatter.format(-diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(-diffDays, "day");
}

export function formatMessageTime(value?: string | null, locale: Locale = "en") {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });
}

export function localizeSeedText(value?: string | null, locale: Locale = "en") {
  if (!value) return "";
  if (locale !== "ru") return value;

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

const knownSourceKeyByLabel: Record<string, "widget" | "telegramBot" | "integrations" | "partnerLanding"> = {
  "Website widget": "widget",
  "Виджет сайта": "widget",
  "Telegram bot": "telegramBot",
  "Telegram-бот": "telegramBot",
  "LeadVirt.ai integrations page": "integrations",
  "Страница интеграций LeadVirt.ai": "integrations",
  "Partner landing form": "partnerLanding",
  "Партнерская лендинг-форма": "partnerLanding",
};

const knownSourceLabels: Record<
  "widget" | "telegramBot" | "integrations" | "partnerLanding",
  Record<Locale, string>
> = {
  widget: {
    en: "Website widget",
    es: "Widget del sitio web",
    fr: "Widget du site",
    de: "Website-Widget",
    pt: "Widget do site",
    ru: "Виджет сайта",
  },
  telegramBot: {
    en: "Telegram bot",
    es: "Bot de Telegram",
    fr: "Bot Telegram",
    de: "Telegram-Bot",
    pt: "Bot do Telegram",
    ru: "Telegram-бот",
  },
  integrations: {
    en: "LeadVirt.ai integrations page",
    es: "Página de integraciones de LeadVirt.ai",
    fr: "Page des intégrations LeadVirt.ai",
    de: "LeadVirt.ai-Integrationsseite",
    pt: "Página de integrações da LeadVirt.ai",
    ru: "Страница интеграций LeadVirt.ai",
  },
  partnerLanding: {
    en: "Partner landing form",
    es: "Formulario de la página de socio",
    fr: "Formulaire de la page partenaire",
    de: "Formular der Partnerseite",
    pt: "Formulário da página de parceiro",
    ru: "Партнерская лендинг-форма",
  },
};

function localizeSource(value?: string | null, locale: Locale = "en") {
  if (!value) return "";
  const sourceKey = knownSourceKeyByLabel[value];
  return sourceKey ? knownSourceLabels[sourceKey][locale] : localizeSeedText(value, locale);
}

function currencyCode(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/u.test(normalized) ? normalized : "RUB";
}

type LeadFallbacks = {
  client: string;
  conversation: string;
  interest: string;
};

const leadFallbacks: Record<Locale, LeadFallbacks> = {
  en: { client: "Customer", conversation: "Inbound conversation", interest: "Request not identified" },
  es: { client: "Cliente", conversation: "Conversación entrante", interest: "Solicitud sin identificar" },
  fr: { client: "Client", conversation: "Conversation entrante", interest: "Demande non identifiée" },
  de: { client: "Kunde", conversation: "Eingehende Konversation", interest: "Anfrage nicht erkannt" },
  pt: { client: "Cliente", conversation: "Conversa recebida", interest: "Solicitação não identificada" },
  ru: { client: "Клиент", conversation: "Входящий диалог", interest: "Запрос не определён" },
};

export function leadFromConversation(
  conversation: ConversationDetail,
  locale: Locale = "en",
  fallbacks: LeadFallbacks = leadFallbacks[locale],
): Lead {
  const lead = conversation.lead;
  const channelType = lead?.channelType ?? conversation.channelType ?? conversation.channel?.type;
  const lastMessageAt = conversation.lastMessageAt ?? lead?.lastMessageAt ?? lead?.createdAt;

  return {
    id: conversation.id,
    conversationId: conversation.id,
    ...(lead?.id ? { apiLeadId: lead.id } : {}),
    name: localizeSeedText(lead?.name ?? conversation.subject, locale) || fallbacks.client,
    channel: channelIdFromType(channelType),
    stage: stageFromStatus(lead?.status, conversation.status),
    temp: tempFromTemperature(lead?.temperature),
    source: localizeSource(lead?.source ?? conversation.channel?.name ?? conversation.subject, locale) || "LeadVirt",
    value: lead?.valueAmount ?? 0,
    currency: currencyCode(lead?.currency),
    manager: lead?.assignedToName ?? "—",
    service: localizeSeedText(lead?.interest, locale) || fallbacks.interest,
    lastMessage: localizeSeedText(conversation.lastMessage ?? lead?.summary, locale) || fallbacks.conversation,
    time: relativeTimeLabel(lastMessageAt, locale),
    unread: conversation.unreadCount ?? 0,
    ai: conversation.aiEnabled,
  };
}

export function leadFromApiLead(
  lead: ApiLead,
  conversationId?: string,
  locale: Locale = "en",
  fallbacks: LeadFallbacks = leadFallbacks[locale],
): Lead {
  return {
    id: lead.id,
    apiLeadId: lead.id,
    ...(conversationId ? { conversationId } : {}),
    name: localizeSeedText(lead.name, locale) || fallbacks.client,
    channel: channelIdFromType(lead.channelType),
    stage: stageFromStatus(lead.status),
    temp: tempFromTemperature(lead.temperature),
    source: localizeSource(lead.source, locale) || "LeadVirt",
    value: lead.valueAmount ?? 0,
    currency: currencyCode(lead.currency),
    manager: lead.assignedToName ?? "—",
    service: localizeSeedText(lead.interest, locale) || fallbacks.interest,
    lastMessage: localizeSeedText(lead.summary ?? lead.interest, locale) || fallbacks.conversation,
    time: relativeTimeLabel(lead.lastMessageAt ?? lead.createdAt, locale),
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

function chatMessageFromApi(message: Message, locale: Locale): ChatMessage {
  return {
    id: message.id,
    from: message.senderType === "AI" ? "ai" : message.senderType === "CUSTOMER" ? "client" : "manager",
    text: localizeSeedText(message.text, locale) || "",
    time: formatMessageTime(message.createdAt, locale),
    attachments: message.attachments?.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      url: attachment.url,
      sizeBytes: attachment.sizeBytes,
    })),
  };
}

export function messagesFromConversation(conversation: ConversationDetail, locale: Locale = "en"): ChatMessage[] {
  const messages = conversation.messages
    .map((message) => chatMessageFromApi(message, locale))
    .filter((message) => message.text.trim().length > 0 || (message.attachments?.length ?? 0) > 0);

  if (messages.length > 0) {
    return messages;
  }

  const fallbackText = localizeSeedText(conversation.lastMessage ?? conversation.lead?.summary, locale);
  if (!fallbackText) {
    return [];
  }

  return [
    {
      id: `${conversation.id}:last-message`,
      from: "client",
      text: fallbackText,
      time: formatMessageTime(conversation.lastMessageAt, locale),
    },
  ];
}
