import type {
  AiAuditResponse,
  AiDraftReply,
  AnalyticsOverview,
  ApiEnvelope,
  BillingInvoice,
  BillingPaymentMethod,
  BillingPaymentMethodUpdateRequest,
  Channel,
  ChannelStatus,
  ChannelType,
  ConversationDetail,
  ConversationStatus,
  DashboardSummary,
  IntegrationAccount,
  IntegrationProvider,
  IntegrationSampleDeliveryResult,
  IntegrationTestResult,
  Lead,
  LeadEvent,
  Message,
  PaginatedEnvelope,
  PricingPlan,
  Subscription,
  UsageSummary,
  WidgetConfig,
  WidgetMessageRequest,
  WidgetMessageResponse,
  Workflow,
  WorkflowStepType,
  WorkflowStatus,
} from "@leadvirt/types";

type CurrentTenant = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE";
  businessType: string;
  timezone: string;
  role: "OWNER";
};

type TeamMember = { id: string; role: string; user: { id: string; email: string; name?: string | null } };
type NotificationsSettings = {
  new_lead: boolean;
  no_reply: boolean;
  booking: boolean;
  daily: boolean;
  tg_summary: boolean;
};
type SecuritySettings = {
  authMode: string;
  tenantScoped: boolean;
  currentRole: string;
  passwordChangeRequired?: boolean;
  twoFactor: {
    enabled: boolean;
    setupPending: boolean;
    confirmedAt: string | null;
    recoveryCodesRemaining: number;
  };
  sessions: {
    id: string;
    current: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
  }[];
};
type ApiKeySummary = { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt?: string | null };
type ApiKeyCreated = ApiKeySummary & { secret: string };

type DemoState = {
  tenant: CurrentTenant;
  owner: { id: string; email: string; name: string; phone: string | null; passwordChangeRequired: false };
  channels: Channel[];
  leads: Lead[];
  conversations: ConversationDetail[];
  workflows: Workflow[];
  integrations: IntegrationAccount[];
  team: TeamMember[];
  security: SecuritySettings;
  notifications: NotificationsSettings;
  apiKeys: ApiKeySummary[];
  subscription: Subscription;
  paymentMethod: BillingPaymentMethod;
  paymentRequestedAt: string | null;
  onboarding: { currentStep: string; completedSteps: string[]; data: Record<string, unknown>; completedAt?: string | null };
  widgetSessions: Record<string, WidgetMessageResponse>;
};

const tenantId = "demo-tenant";
const ownerId = "demo-owner";

function iso(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function future(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function stringArrayValue(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function envelope<T>(data: T): ApiEnvelope<T> {
  return { data };
}

function paginated<T>(data: T[], page = 1, limit = 50): PaginatedEnvelope<T> {
  const start = (page - 1) * limit;
  const items = data.slice(start, start + limit);
  return {
    data: items,
    pagination: {
      page,
      limit,
      total: data.length,
      hasMore: start + limit < data.length,
    },
  };
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function pricingPlans(): PricingPlan[] {
  return [
    {
      code: "START",
      name: "Старт",
      priceMonthlyRub: 7900,
      aiConversations: 500,
      channelsLimit: 2,
      usersLimit: 3,
      scenariosLimit: 3,
      bestFor: "Первые каналы и базовая автоматизация",
      features: ["Website widget", "Telegram", "Базовая воронка", "Отчёты"],
    },
    {
      code: "PROFESSIONAL",
      name: "Профессиональный",
      priceMonthlyRub: 19900,
      aiConversations: 2500,
      channelsLimit: 6,
      usersLimit: 10,
      scenariosLimit: 12,
      popular: true,
      bestFor: "Растущая команда продаж",
      features: ["Все основные каналы", "AI-подсказки", "CRM-синхронизация", "Автоматизации"],
    },
    {
      code: "BUSINESS",
      name: "Бизнес",
      priceMonthlyRub: 49900,
      aiConversations: 10000,
      channelsLimit: 15,
      usersLimit: 30,
      scenariosLimit: 40,
      bestFor: "Несколько филиалов и ролей",
      features: ["Расширенная аналитика", "AI audit", "Webhook/API", "Приоритетная поддержка"],
    },
    {
      code: "CORPORATE",
      name: "Корпоративный",
      priceMonthlyRub: null,
      aiConversations: null,
      channelsLimit: null,
      usersLimit: null,
      scenariosLimit: null,
      bestFor: "Индивидуальная инфраструктура",
      features: ["SLA", "Выделенные лимиты", "Security review", "Кастомные интеграции"],
    },
  ];
}

const plans = pricingPlans();

function baseChannels(): Channel[] {
  return [
    {
      id: "demo-channel-website",
      tenantId,
      type: "WEBSITE",
      status: "ACTIVE",
      name: "Виджет сайта",
      publicKey: "demo-website-widget",
      settings: {
        widget: {
          businessName: "Студия Лето",
          title: "Студия Лето",
          subtitle: "AI-администратор на связи",
          welcomeMessage: "Здравствуйте! Подскажу цены, свободные окна и помогу записаться.",
          primaryColor: "#34d399",
          accentColor: "#10b981",
          position: "bottom-right",
          suggestedReplies: ["Хочу записаться", "Сколько стоит окрашивание?", "Позовите менеджера"],
          consentText: "Нажимая отправить, вы соглашаетесь на обработку заявки.",
          poweredBy: "LeadVirt.ai",
        },
      },
      lastHealthAt: iso(12),
    },
    {
      id: "demo-channel-telegram",
      tenantId,
      type: "TELEGRAM",
      status: "ACTIVE",
      name: "Telegram",
      publicKey: "demo-telegram",
      settings: { botUsername: "studio_leto_bot" },
      lastHealthAt: iso(5),
    },
    {
      id: "demo-channel-webhook",
      tenantId,
      type: "WEBHOOK",
      status: "ACTIVE",
      name: "Webhook / API",
      publicKey: "lvwh_demo_preview",
      settings: {
        endpointPath: "/api/public/channels/webhook/lvwh_demo_preview/events",
        secretHeader: "x-leadvirt-webhook-secret",
      },
      lastHealthAt: iso(18),
    },
    {
      id: "demo-channel-instagram",
      tenantId,
      type: "INSTAGRAM",
      status: "PENDING",
      name: "Instagram Direct",
      settings: {},
      lastHealthAt: null,
    },
  ];
}

function makeLead(input: Partial<Lead> & Pick<Lead, "id" | "name" | "status" | "temperature" | "channelType">): Lead {
  return {
    tenantId,
    phone: null,
    email: null,
    companyName: null,
    source: "Виджет сайта",
    valueAmount: 0,
    currency: "RUB",
    interest: "Консультация",
    summary: "Новый входящий лид",
    assignedToUserId: ownerId,
    assignedToName: "Мария, администратор",
    lastMessageAt: iso(8),
    createdAt: iso(40),
    ...input,
  };
}

function makeMessage(input: Partial<Message> & Pick<Message, "id" | "conversationId" | "senderType" | "direction" | "text">): Message {
  return {
    tenantId,
    status: input.direction === "INBOUND" ? "RECEIVED" : "SENT",
    createdAt: iso(12),
    ...input,
  };
}

function makeEvent(input: Partial<LeadEvent> & Pick<LeadEvent, "id" | "leadId" | "type" | "title">): LeadEvent {
  return {
    message: null,
    createdAt: iso(10),
    ...input,
  };
}

function buildInitialState(): DemoState {
  const channels = baseChannels();
  const leads: Lead[] = [
    makeLead({
      id: "demo-lead-anna",
      name: "Анна Соколова",
      phone: "+7 911 320-44-12",
      email: "anna@example.ru",
      source: "Instagram Direct",
      channelType: "INSTAGRAM",
      status: "QUALIFIED",
      temperature: "HOT",
      valueAmount: 16500,
      interest: "Окрашивание + стрижка",
      summary: "Хочет записаться на пятницу, просит уточнить свободные окна.",
      lastMessageAt: iso(6),
      createdAt: iso(52),
    }),
    makeLead({
      id: "demo-lead-dmitry",
      name: "Дмитрий Орлов",
      phone: "+7 916 450-71-90",
      source: "Виджет сайта",
      channelType: "WEBSITE",
      status: "IN_PROGRESS",
      temperature: "WARM",
      valueAmount: 8900,
      interest: "Мужская стрижка и уход",
      summary: "AI собрал услугу, бюджет и предложил два окна.",
      lastMessageAt: iso(18),
      createdAt: iso(95),
    }),
    makeLead({
      id: "demo-lead-elena",
      name: "Елена Васнецова",
      phone: "+7 921 772-12-33",
      source: "Telegram",
      channelType: "TELEGRAM",
      status: "BOOKED",
      temperature: "HOT",
      valueAmount: 4200,
      interest: "Укладка перед мероприятием",
      summary: "Запись подтверждена на завтра, 16:00.",
      lastMessageAt: iso(32),
      createdAt: iso(120),
    }),
    makeLead({
      id: "demo-lead-igor",
      name: "Игорь Лебедев",
      source: "Webhook / API",
      channelType: "WEBHOOK",
      status: "SENT_TO_CRM",
      temperature: "WARM",
      valueAmount: 28000,
      interest: "Подарочный сертификат",
      summary: "Передан в CRM с комментарием менеджеру.",
      lastMessageAt: iso(60),
      createdAt: iso(210),
    }),
    makeLead({
      id: "demo-lead-maria",
      name: "Мария Белова",
      source: "VK",
      channelType: "VK",
      status: "NEW",
      temperature: "COLD",
      valueAmount: 3200,
      interest: "Консультация по уходу",
      summary: "Нужно ответить на вопрос по домашнему уходу.",
      lastMessageAt: iso(4),
      createdAt: iso(35),
    }),
  ];

  const conversations: ConversationDetail[] = [
    conversationForLead(leads[0], channels[3], "Нужна запись на окрашивание", [
      makeMessage({ id: "demo-msg-anna-1", conversationId: "demo-conv-anna", senderType: "CUSTOMER", direction: "INBOUND", text: "Здравствуйте! Можно записаться на окрашивание и стрижку в пятницу?", createdAt: iso(18) }),
      makeMessage({ id: "demo-msg-anna-2", conversationId: "demo-conv-anna", senderType: "AI", direction: "OUTBOUND", text: "Да, есть окна в пятницу в 15:30 и 18:00. Окрашивание со стрижкой обычно от 14 000 ₽, точнее скажем после консультации.", createdAt: iso(16) }),
      makeMessage({ id: "demo-msg-anna-3", conversationId: "demo-conv-anna", senderType: "CUSTOMER", direction: "INBOUND", text: "Подойдёт 18:00. Нужно ли внести предоплату?", createdAt: iso(6) }),
    ]),
    conversationForLead(leads[1], channels[0], "Мужская стрижка", [
      makeMessage({ id: "demo-msg-dmitry-1", conversationId: "demo-conv-dmitry", senderType: "CUSTOMER", direction: "INBOUND", text: "Сколько стоит мужская стрижка и можно сегодня?", createdAt: iso(28) }),
      makeMessage({ id: "demo-msg-dmitry-2", conversationId: "demo-conv-dmitry", senderType: "AI", direction: "OUTBOUND", text: "Стрижка от 2 800 ₽. Сегодня есть окна в 17:00 и 19:30. Записать вас?", createdAt: iso(25) }),
    ]),
    conversationForLead(leads[2], channels[1], "Укладка перед мероприятием", [
      makeMessage({ id: "demo-msg-elena-1", conversationId: "demo-conv-elena", senderType: "CUSTOMER", direction: "INBOUND", text: "Нужна укладка завтра днём.", createdAt: iso(50) }),
      makeMessage({ id: "demo-msg-elena-2", conversationId: "demo-conv-elena", senderType: "AI", direction: "OUTBOUND", text: "Нашла окно завтра в 16:00. Стоимость укладки от 4 200 ₽. Подтверждаю запись?", createdAt: iso(46) }),
      makeMessage({ id: "demo-msg-elena-3", conversationId: "demo-conv-elena", senderType: "CUSTOMER", direction: "INBOUND", text: "Да, подтверждаю.", createdAt: iso(32) }),
    ]),
    conversationForLead(leads[3], channels[2], "Подарочный сертификат", [
      makeMessage({ id: "demo-msg-igor-1", conversationId: "demo-conv-igor", senderType: "CUSTOMER", direction: "INBOUND", text: "Хочу купить сертификат на 28 000 ₽.", createdAt: iso(72) }),
      makeMessage({ id: "demo-msg-igor-2", conversationId: "demo-conv-igor", senderType: "AI", direction: "OUTBOUND", text: "Передала заявку в CRM. Менеджер свяжется и отправит ссылку на оплату.", createdAt: iso(60) }),
    ]),
    conversationForLead(leads[4], null, "Консультация по уходу", [
      makeMessage({ id: "demo-msg-maria-1", conversationId: "demo-conv-maria", senderType: "CUSTOMER", direction: "INBOUND", text: "Какой уход выбрать после осветления?", createdAt: iso(4) }),
    ], 2),
  ];

  return {
    tenant: {
      id: tenantId,
      name: "Студия Лето",
      slug: "studio-leto",
      status: "ACTIVE",
      businessType: "beauty",
      timezone: "Europe/Moscow",
      role: "OWNER",
    },
    owner: {
      id: ownerId,
      email: "owner@studio-leto.ru",
      name: "Мария",
      phone: "+7 999 123-45-67",
      passwordChangeRequired: false,
    },
    channels,
    leads,
    conversations,
    workflows: baseWorkflows(),
    integrations: baseIntegrations(),
    team: [
      { id: "demo-member-owner", role: "OWNER", user: { id: ownerId, email: "owner@studio-leto.ru", name: "Мария" } },
      { id: "demo-member-manager", role: "MANAGER", user: { id: "demo-manager", email: "manager@studio-leto.ru", name: "Алина" } },
      { id: "demo-member-agent", role: "AGENT", user: { id: "demo-agent", email: "operator@studio-leto.ru", name: "Никита" } },
    ],
    security: {
      authMode: "telegram",
      tenantScoped: true,
      currentRole: "OWNER",
      passwordChangeRequired: false,
      twoFactor: { enabled: true, setupPending: false, confirmedAt: iso(7200), recoveryCodesRemaining: 8 },
      sessions: [
        {
          id: "demo-session-current",
          current: true,
          ipAddress: "127.0.0.1",
          userAgent: "Demo browser",
          createdAt: iso(420),
          lastUsedAt: iso(2),
          expiresAt: future(14),
        },
      ],
    },
    notifications: { new_lead: true, no_reply: true, booking: true, daily: true, tg_summary: false },
    apiKeys: [
      { id: "demo-api-key-1", name: "Website bridge", keyPrefix: "lvpk_demo_8f3a", createdAt: iso(5000), lastUsedAt: iso(42) },
    ],
    subscription: {
      id: "demo-subscription",
      status: "TRIALING",
      periodStart: iso(10000),
      periodEnd: future(21),
      plan: plans[1],
    },
    paymentMethod: {
      mode: "manual_invoice",
      label: "Оплата по счёту",
      description: "Счёт отправляется на email владельца workspace.",
      status: "configured",
      updatedAt: iso(4000),
      nextActionLabel: "Запросить изменение реквизитов",
    },
    paymentRequestedAt: null,
    onboarding: {
      currentStep: "launch",
      completedSteps: ["business", "channels", "scenario", "company", "crm", "launch"],
      data: {
        businessType: "beauty",
        selectedChannels: ["website", "telegram", "instagram"],
        scenario: "booking",
        crm: "amocrm",
        companyInfo: {
          name: "Студия Лето",
          description: "Салон красоты в центре города: окрашивание, стрижки, укладки и уход.",
          hours: "Ежедневно 10:00-21:00",
          avgCheck: "6500",
          servicesCatalog: "Стрижка 2800 ₽, окрашивание от 12000 ₽, укладка от 4200 ₽",
          availability: "Свободные окна: сегодня 17:00, завтра 12:30 и 16:00",
          faq: "Предоплата нужна только для сложного окрашивания.",
          policies: "Отмена записи за 12 часов.",
          escalationRules: "Передавать менеджеру сложное окрашивание и жалобы.",
        },
      },
      completedAt: iso(3600),
    },
    widgetSessions: {},
  };
}

function conversationForLead(lead: Lead, channel: Channel | null, subject: string, messages: Message[], unreadCount = 0): ConversationDetail {
  const conversationId = messages[0]?.conversationId ?? `demo-conv-${lead.id}`;
  return {
    id: conversationId,
    tenantId,
    leadId: lead.id,
    channel,
    channelType: lead.channelType,
    status: lead.status === "CLOSED" || lead.status === "LOST" ? "CLOSED" : "OPEN",
    subject,
    lastMessageAt: lead.lastMessageAt,
    aiEnabled: true,
    handoffRequested: false,
    lead,
    lastMessage: messages[messages.length - 1]?.text ?? lead.summary ?? "",
    unreadCount,
    messages,
    events: [
      makeEvent({ id: `${lead.id}-event-created`, leadId: lead.id, type: "lead.created", title: "Лид создан", createdAt: lead.createdAt }),
      makeEvent({ id: `${lead.id}-event-ai`, leadId: lead.id, type: "ai.reply", title: "AI подготовил ответ", createdAt: lead.lastMessageAt ?? iso(20) }),
    ],
  };
}

function baseWorkflows(): Workflow[] {
  return [
    {
      id: "demo-workflow-booking",
      tenantId,
      name: "Квалификация и запись",
      description: "AI собирает услугу, время и контакт, затем предлагает запись.",
      status: "ACTIVE",
      version: 3,
      publishedAt: iso(1440),
      steps: [
        { id: "demo-step-trigger", workflowId: "demo-workflow-booking", type: "TRIGGER", name: "Новый входящий лид", positionX: 80, positionY: 160, config: { channels: { website: true, telegram: true, instagram: true } } },
        { id: "demo-step-ai", workflowId: "demo-workflow-booking", type: "AI_MESSAGE", name: "AI уточняет запрос", positionX: 320, positionY: 160, config: { tone: "friendly", fallback: "handoff" } },
        { id: "demo-step-action", workflowId: "demo-workflow-booking", type: "ACTION", name: "Создать задачу менеджеру", positionX: 560, positionY: 160, config: { action: "task" } },
      ],
    },
    {
      id: "demo-workflow-crm",
      tenantId,
      name: "Передача горячих лидов в CRM",
      description: "Лид с высокой температурой уходит в CRM и получает follow-up.",
      status: "PAUSED",
      version: 1,
      publishedAt: null,
      steps: [
        { id: "demo-step-crm-trigger", workflowId: "demo-workflow-crm", type: "TRIGGER", name: "Лид квалифицирован", positionX: 80, positionY: 160, config: {} },
        { id: "demo-step-crm", workflowId: "demo-workflow-crm", type: "ACTION", name: "Отправить в amoCRM", positionX: 320, positionY: 160, config: { provider: "AMOCRM" } },
      ],
    },
  ];
}

function integration(provider: IntegrationProvider, name: string, status: IntegrationAccount["status"], category: string, settings: Record<string, unknown> = {}): IntegrationAccount {
  return {
    id: `demo-integration-${provider.toLowerCase()}`,
    tenantId,
    provider,
    status,
    name,
    category,
    settings,
    connectedAt: status === "CONNECTED" ? iso(2200) : null,
    lastSyncAt: status === "CONNECTED" ? iso(21) : null,
    inboundEndpoint: provider === "WEBHOOK_API" ? {
      channelType: "WEBHOOK",
      publicKey: "lvwh_demo_preview",
      endpointPath: "/api/public/channels/webhook/lvwh_demo_preview/events",
      secretHeader: "x-leadvirt-webhook-secret",
      samplePayload: { event: "lead.created", name: "Новый клиент", phone: "+79990000000", message: "Нужна консультация" },
    } : null,
    recentSyncLogs: status === "CONNECTED" ? [{ id: `${provider}-sync`, action: "sync.completed", status: "SUCCESS", message: "Синхронизация завершена", createdAt: iso(21) }] : [],
    recentWebhookEvents: provider === "WEBHOOK_API" ? [{ id: "demo-webhook-event", provider, externalEventId: "evt_preview_001", status: "PROCESSED", receivedAt: iso(35), processedAt: iso(34) }] : [],
  };
}

function baseIntegrations(): IntegrationAccount[] {
  return [
    integration("AMOCRM", "amoCRM", "CONNECTED", "CRM", { syncMode: "two-way" }),
    integration("BITRIX24", "Bitrix24", "DISCONNECTED", "CRM"),
    integration("RETAILCRM", "RetailCRM", "DISCONNECTED", "CRM"),
    integration("TELEGRAM", "Telegram", "CONNECTED", "Каналы"),
    integration("WHATSAPP_BUSINESS", "WhatsApp Business", "DISCONNECTED", "Каналы"),
    integration("INSTAGRAM", "Instagram", "PENDING", "Каналы"),
    integration("VK", "VK", "DISCONNECTED", "Каналы"),
    integration("EMAIL", "Email", "CONNECTED", "Каналы"),
    integration("GOOGLE_CALENDAR", "Google Calendar", "CONNECTED", "Календарь"),
    integration("SHOPIFY", "Shopify", "DISCONNECTED", "E-commerce"),
    integration("WEBHOOK_API", "Webhook / API", "CONNECTED", "Разработчикам"),
  ];
}

let state: DemoState | null = null;

function demoState() {
  state ??= buildInitialState();
  return state;
}

export function shouldUseDemoApi() {
  if (typeof window === "undefined") return false;
  const pathname = window.location.pathname;
  return pathname === "/demo" || pathname.startsWith("/demo/") || pathname === "/widget/demo";
}

function apiPath(path: string) {
  const url = path.startsWith("http") ? new URL(path) : new URL(path.startsWith("/") ? path : `/${path}`, "http://demo.local");
  let pathname = url.pathname.replace(/\/+$/u, "") || "/";
  if (pathname.startsWith("/api/")) pathname = pathname.slice(4);
  return { pathname, searchParams: url.searchParams };
}

function jsonBody(init: RequestInit) {
  if (typeof init.body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(init.body);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function leadById(s: DemoState, leadId: string) {
  return s.leads.find((lead) => lead.id === leadId) ?? null;
}

function conversationById(s: DemoState, conversationId: string) {
  return s.conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

function syncLead(s: DemoState, updated: Lead) {
  s.leads = s.leads.map((lead) => (lead.id === updated.id ? updated : lead));
  s.conversations = s.conversations.map((conversation) =>
    conversation.leadId === updated.id ? { ...conversation, lead: updated, channelType: updated.channelType } : conversation
  );
}

function appendEvent(s: DemoState, leadId: string, type: string, title: string) {
  const conversation = s.conversations.find((item) => item.leadId === leadId);
  if (!conversation) return;
  conversation.events = [
    { id: id("demo-event"), leadId, type, title, message: null, createdAt: new Date().toISOString() },
    ...conversation.events,
  ];
}

function dashboardSummary(s: DemoState): DashboardSummary {
  const activeLeads = s.leads.filter((lead) => lead.status !== "LOST");
  const bookings = activeLeads.filter((lead) => lead.status === "BOOKED" || lead.status === "ORDERED").length;
  const crm = activeLeads.filter((lead) => lead.status === "SENT_TO_CRM").length;
  return {
    metrics: {
      newLeadsCount: activeLeads.length,
      aiConversationsCount: s.conversations.filter((conversation) => conversation.aiEnabled).length,
      bookingsOrdersCreated: bookings,
      leadsSentToCrm: crm,
      averageResponseTimeSeconds: 18,
      conversionRate: Math.round(((bookings + crm) / Math.max(activeLeads.length, 1)) * 100),
      deltas: {
        newLeadsPercent: 18,
        aiConversationsPercent: 24,
        bookingsOrdersPercent: 12,
        leadsSentToCrmPercent: 16,
        averageResponseTimePercent: -22,
        conversionRatePoints: 4,
      },
    },
    recentLeads: activeLeads.slice(0, 5).map((lead) => ({
      id: lead.id,
      conversationId: s.conversations.find((conversation) => conversation.leadId === lead.id)?.id,
      name: lead.name,
      source: lead.source,
      channelType: lead.channelType,
      status: lead.status,
      temperature: lead.temperature,
      valueAmount: lead.valueAmount,
      currency: lead.currency,
      interest: lead.interest,
      summary: lead.summary,
      createdAt: lead.createdAt,
      lastMessageAt: lead.lastMessageAt,
    })),
    recentActivity: [
      { id: "demo-activity-1", action: "ai.reply", title: "AI квалифицировал 4 обращения за последний час", createdAt: iso(4) },
      { id: "demo-activity-2", action: "booking.created", title: "Создана запись: укладка, завтра 16:00", createdAt: iso(32) },
      { id: "demo-activity-3", action: "crm.sent", title: "Лид Игорь Лебедев отправлен в CRM", createdAt: iso(60) },
      { id: "demo-activity-4", action: "lead.created", title: "Новый вопрос по уходу после осветления", createdAt: iso(4) },
    ],
    channelPerformance: [
      { channelType: "INSTAGRAM", name: "Instagram", leads: 412, conversations: 390, conversionRate: 31, valueAmount: 820000 },
      { channelType: "WEBSITE", name: "Website widget", leads: 388, conversations: 365, conversionRate: 38, valueAmount: 940000 },
      { channelType: "TELEGRAM", name: "Telegram", leads: 256, conversations: 244, conversionRate: 34, valueAmount: 610000 },
      { channelType: "WEBHOOK", name: "Webhook / API", leads: 198, conversations: 170, conversionRate: 27, valueAmount: 520000 },
    ],
    trend: [
      { name: "Пн", leads: 32, booked: 9 },
      { name: "Вт", leads: 45, booked: 16 },
      { name: "Ср", leads: 38, booked: 13 },
      { name: "Чт", leads: 52, booked: 19 },
      { name: "Пт", leads: 61, booked: 24 },
      { name: "Сб", leads: 44, booked: 15 },
      { name: "Вс", leads: 29, booked: 8 },
    ],
  };
}

function analyticsOverview(): AnalyticsOverview {
  return {
    leadsOverTime: [
      { name: "Пн", leads: 32, booked: 9 },
      { name: "Вт", leads: 45, booked: 16 },
      { name: "Ср", leads: 38, booked: 13 },
      { name: "Чт", leads: 52, booked: 19 },
      { name: "Пт", leads: 61, booked: 24 },
      { name: "Сб", leads: 44, booked: 15 },
      { name: "Вс", leads: 29, booked: 8 },
    ],
    leadsByChannel: [
      { channelType: "WEBSITE", leads: 388, conversionRate: 38 },
      { channelType: "INSTAGRAM", leads: 412, conversionRate: 31 },
      { channelType: "TELEGRAM", leads: 256, conversionRate: 34 },
      { channelType: "WEBHOOK", leads: 198, conversionRate: 27 },
    ],
    conversionByScenario: [
      { scenario: "Квалификация и запись", conversionRate: 38, runs: 982 },
      { scenario: "Передача в CRM", conversionRate: 31, runs: 612 },
      { scenario: "Повторный follow-up", conversionRate: 24, runs: 204 },
    ],
    responseTime: { averageSeconds: 18, p90Seconds: 44 },
    bookingsOrders: { bookings: 386, orders: 42 },
    estimatedRevenue: 3260000,
    bestPerformingChannels: [
      { channelType: "WEBSITE", score: 94 },
      { channelType: "TELEGRAM", score: 89 },
      { channelType: "INSTAGRAM", score: 84 },
    ],
    aiInsights: [
      "Website widget даёт самый быстрый путь до записи.",
      "Instagram лиды чаще требуют уточнения услуги перед записью.",
      "Webhook/API хорошо подходит для заявок с внешних лендингов.",
    ],
  };
}

function pipelineSummary(s: DemoState) {
  const statuses: Lead["status"][] = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "SENT_TO_CRM", "CLOSED"];
  return {
    stages: statuses.map((status) => {
      const leads = s.leads.filter((lead) => lead.status === status);
      return {
        status,
        count: leads.length,
        valueAmount: leads.reduce((sum, lead) => sum + (lead.valueAmount ?? 0), 0),
        leads,
      };
    }),
  };
}

function billingInvoices(s: DemoState): BillingInvoice[] {
  return [
    {
      id: "INV-DEMO-0003",
      issuedAt: iso(1440),
      periodStart: iso(2880),
      periodEnd: future(21),
      amountRub: s.subscription.plan.priceMonthlyRub,
      status: "DUE",
      plan: s.subscription.plan,
      downloadName: "leadvirt-demo-invoice-0003.txt",
    },
    {
      id: "INV-DEMO-0002",
      issuedAt: iso(45000),
      periodStart: iso(90000),
      periodEnd: iso(2880),
      amountRub: s.subscription.plan.priceMonthlyRub,
      status: "PAID",
      plan: s.subscription.plan,
      downloadName: "leadvirt-demo-invoice-0002.txt",
    },
  ];
}

function billingUsage(s: DemoState): UsageSummary {
  return {
    aiConversations: 982,
    aiConversationsLimit: s.subscription.plan.aiConversations,
    messagesSent: 1840,
    messagesReceived: 2190,
    leadsCreated: 1439,
    bookingsCreated: 386,
    ordersCreated: 42,
    crmSyncs: 612,
    workflowRuns: 1204,
    channels: s.channels.filter((channel) => channel.status === "ACTIVE").length,
    channelsLimit: s.subscription.plan.channelsLimit,
    users: s.team.length,
    usersLimit: s.subscription.plan.usersLimit,
    scenarios: s.workflows.filter((workflow) => workflow.status !== "ARCHIVED").length,
    scenariosLimit: s.subscription.plan.scenariosLimit,
  };
}

function auditResponse(): AiAuditResponse {
  return {
    summary: {
      totalEvents: 6,
      usageLogs: 4,
      auditLogs: 2,
      success: 5,
      handoff: 1,
      failed: 0,
      budgetBlocked: 0,
      toolCalls: 3,
      lastEventAt: iso(4),
    },
    items: [
      {
        id: "demo-audit-1",
        kind: "usage",
        createdAt: iso(4),
        action: "ai.reply",
        status: "SUCCESS",
        provider: "openai",
        model: "gpt-5.5",
        conversationId: "demo-conv-maria",
        conversationSubject: "Консультация по уходу",
        leadId: "demo-lead-maria",
        leadName: "Мария Белова",
        inputTokens: 780,
        outputTokens: 160,
        estimatedCost: "0.014",
        latencyMs: 1320,
        quality: { decision: "allowed", confidence: 0.86 },
        toolCalls: [{ name: "search_knowledge", status: "success" }],
        retrievedContext: [{ title: "Каталог услуг", score: 0.91 }],
        payload: { redacted: true, source: "demo" },
      },
      {
        id: "demo-audit-2",
        kind: "audit",
        createdAt: iso(32),
        action: "booking.created",
        status: "SUCCESS",
        entityType: "lead",
        entityId: "demo-lead-elena",
        leadId: "demo-lead-elena",
        leadName: "Елена Васнецова",
        payload: { slot: "завтра 16:00", redacted: true },
      },
    ],
  };
}

function widgetConfig(s: DemoState): WidgetConfig {
  const settings = s.channels.find((channel) => channel.type === "WEBSITE")?.settings;
  const widget = isRecord(settings) && isRecord(settings.widget) ? settings.widget : {};
  const position = widget.position === "bottom-left" ? "bottom-left" : "bottom-right";
  return {
    publicKey: "demo-website-widget",
    tenantName: s.tenant.name,
    businessName: stringValue(widget.businessName, "Студия Лето"),
    title: stringValue(widget.title, "Студия Лето"),
    subtitle: stringValue(widget.subtitle, "AI-администратор на связи"),
    welcomeMessage: stringValue(widget.welcomeMessage, "Здравствуйте! Подскажу цены и помогу записаться."),
    primaryColor: stringValue(widget.primaryColor, "#34d399"),
    accentColor: stringValue(widget.accentColor, "#10b981"),
    position,
    locale: "ru",
    suggestedReplies: stringArrayValue(widget.suggestedReplies, ["Хочу записаться", "Сколько стоит?", "Позовите менеджера"]),
    consentText: typeof widget.consentText === "string" ? widget.consentText : undefined,
    poweredBy: stringValue(widget.poweredBy, "LeadVirt.ai"),
  };
}

function providerFromPath(value: string): IntegrationProvider {
  return decodeURIComponent(value).toUpperCase() as IntegrationProvider;
}

function ensureIntegration(s: DemoState, provider: IntegrationProvider) {
  let account = s.integrations.find((item) => item.provider === provider);
  if (!account) {
    account = integration(provider, provider, "DISCONNECTED", "Other");
    s.integrations.push(account);
  }
  return account;
}

function workflowPatch(workflow: Workflow, body: Record<string, unknown>): Workflow {
  const stepTypes: WorkflowStepType[] = ["TRIGGER", "AI_MESSAGE", "QUESTION", "CONDITION", "ACTION", "DELAY", "HANDOFF", "END"];
  return {
    ...workflow,
    name: typeof body.name === "string" ? body.name : workflow.name,
    description: typeof body.description === "string" ? body.description : workflow.description,
    status: typeof body.status === "string" ? body.status as WorkflowStatus : workflow.status,
    version: workflow.version + 1,
    steps: Array.isArray(body.steps) ? body.steps.map((rawStep, index) => {
      const step = isRecord(rawStep) ? rawStep : {};
      const type = stepTypes.includes(step.type as WorkflowStepType) ? step.type as WorkflowStepType : "AI_MESSAGE";
      return {
        id: typeof step.id === "string" ? step.id : id("demo-step"),
        workflowId: workflow.id,
        type,
        name: typeof step.name === "string" ? step.name : `Шаг ${index + 1}`,
        positionX: typeof step.positionX === "number" ? step.positionX : 80 + index * 220,
        positionY: typeof step.positionY === "number" ? step.positionY : 160,
        config: isRecord(step.config) ? step.config : {},
      };
    }) : workflow.steps,
  };
}

export function demoApiRequest<T>(path: string, init: RequestInit = {}): T {
  const s = demoState();
  const { pathname, searchParams } = apiPath(path);
  const method = (init.method ?? "GET").toUpperCase();
  const body = jsonBody(init);

  if (method === "GET" && pathname === "/auth/me") return envelope({ ...s.owner, authMode: "telegram", role: "OWNER", tenant: s.tenant, expiresAt: future(14) }) as T;
  if (method === "GET" && pathname === "/current-tenant") return envelope(clone(s.tenant)) as T;
  if (method === "GET" && pathname === "/tenants") return envelope([clone(s.tenant)]) as T;
  if (method === "GET" && pathname === "/dashboard/summary") return envelope(dashboardSummary(s)) as T;
  if (method === "GET" && pathname === "/analytics/overview") return envelope(analyticsOverview()) as T;
  if (method === "GET" && pathname === "/ai-audit") return envelope(auditResponse()) as T;

  if (method === "GET" && pathname === "/inbox/conversations") {
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Number(searchParams.get("limit") ?? 50);
    const search = (searchParams.get("search") ?? "").toLowerCase();
    const items = s.conversations
      .filter((conversation) => !search || `${conversation.subject ?? ""} ${conversation.lead?.name ?? ""} ${conversation.lastMessage ?? ""}`.toLowerCase().includes(search))
      .sort((a, b) => new Date(b.lastMessageAt ?? "").getTime() - new Date(a.lastMessageAt ?? "").getTime());
    return paginated(items, page, limit) as T;
  }

  const conversationMatch = pathname.match(/^\/conversations\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/u);
  if (conversationMatch) {
    const conversationId = decodeURIComponent(conversationMatch[1]);
    const action = conversationMatch[2];
    const subAction = conversationMatch[3];
    const conversation = conversationById(s, conversationId);
    if (!conversation) return envelope(null) as T;

    if (method === "GET" && !action) return envelope(clone(conversation)) as T;
    if (method === "POST" && action === "messages") {
      const text = typeof body.text === "string" ? body.text : "";
      const message = makeMessage({ id: id("demo-msg"), conversationId, senderType: "USER", direction: "OUTBOUND", text, createdAt: new Date().toISOString() });
      conversation.messages.push(message);
      conversation.lastMessage = text;
      conversation.lastMessageAt = message.createdAt;
      conversation.unreadCount = 0;
      if (conversation.lead) {
        conversation.lead.lastMessageAt = message.createdAt;
        conversation.lead.summary = text;
        syncLead(s, conversation.lead);
      }
      return envelope(clone(conversation)) as T;
    }
    if (method === "POST" && action === "ai" && subAction === "reply") {
      const reply: AiDraftReply = {
        reply: "Спасибо! Могу предложить ближайшие окна: сегодня 17:00 или завтра 12:30. Подскажите, какое время удобнее?",
        intent: "booking",
        leadFields: { interest: conversation.lead?.interest ?? "Запись", temperature: "HOT" },
        nextAction: { type: "send_message", reason: "Клиент готов выбрать время" },
        confidence: 0.88,
        handoffRequired: false,
      };
      return envelope(reply) as T;
    }
    if (method === "PATCH" && action === "status") {
      conversation.status = (body.status as ConversationStatus) ?? conversation.status;
      conversation.handoffRequested = conversation.status === "WAITING_FOR_HUMAN";
      return envelope(clone(conversation)) as T;
    }
    if (method === "POST" && action === "assign") return envelope(clone(conversation)) as T;
    if (method === "POST" && action === "handoff") {
      conversation.status = "WAITING_FOR_HUMAN";
      conversation.handoffRequested = true;
      return envelope(clone(conversation)) as T;
    }
  }

  if (method === "GET" && pathname === "/leads/pipeline/summary") return envelope(pipelineSummary(s)) as T;
  if (method === "GET" && pathname === "/leads") {
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Number(searchParams.get("limit") ?? 50);
    return paginated(s.leads, page, limit) as T;
  }

  const leadMatch = pathname.match(/^\/leads\/([^/]+)(?:\/actions\/([^/]+))?$/u);
  if (leadMatch) {
    const leadId = decodeURIComponent(leadMatch[1]);
    const action = leadMatch[2];
    const lead = leadById(s, leadId);
    if (!lead) return envelope(null) as T;

    if (method === "GET" && !action) return envelope(clone(lead)) as T;
    if (method === "PATCH" && !action) {
      const updated = { ...lead, ...body, lastMessageAt: new Date().toISOString() } as Lead;
      syncLead(s, updated);
      appendEvent(s, updated.id, "lead.updated", "Лид обновлён");
      return envelope(clone(updated)) as T;
    }
    if (method === "POST" && action === "send-to-crm") {
      const updated = { ...lead, status: "SENT_TO_CRM" as const, lastMessageAt: new Date().toISOString() };
      syncLead(s, updated);
      appendEvent(s, updated.id, "crm.sent", "Лид отправлен в CRM");
      return envelope(clone(updated)) as T;
    }
    if (method === "POST" && action === "create-task") {
      appendEvent(s, lead.id, "task.created", typeof body.title === "string" ? body.title : "Задача создана");
      return envelope({ id: id("demo-task"), created: true }) as T;
    }
    if (method === "POST" && action === "book-appointment") {
      const updated = { ...lead, status: "BOOKED" as const, lastMessageAt: new Date().toISOString() };
      syncLead(s, updated);
      appendEvent(s, lead.id, "booking.created", typeof body.title === "string" ? body.title : "Запись создана");
      return envelope({ id: id("demo-booking"), created: true }) as T;
    }
  }

  if (method === "GET" && pathname === "/integrations") return envelope(clone(s.integrations)) as T;
  const integrationMatch = pathname.match(/^\/integrations\/([^/]+)(?:\/([^/]+))?$/u);
  if (integrationMatch) {
    const provider = providerFromPath(integrationMatch[1]);
    const action = integrationMatch[2];
    const account = ensureIntegration(s, provider);
    if (method === "POST" && action === "connect") {
      account.status = "CONNECTED";
      account.connectedAt = new Date().toISOString();
      account.lastSyncAt = new Date().toISOString();
      return envelope(clone(account)) as T;
    }
    if (method === "POST" && action === "disconnect") {
      account.status = "DISCONNECTED";
      return envelope(clone(account)) as T;
    }
    if (method === "POST" && action === "test") {
      const result: IntegrationTestResult = { ok: true, provider, integrationId: account.id, status: "SUCCESS", message: "Demo connection OK", checkedAt: new Date().toISOString(), integration: clone(account) };
      return envelope(result) as T;
    }
    if (method === "POST" && action === "sample-inbound") {
      const lead = s.leads[0] ?? null;
      const result: IntegrationSampleDeliveryResult = {
        ok: true,
        provider,
        integrationId: account.id,
        duplicate: false,
        conversationId: s.conversations[0]?.id ?? "demo-conv-anna",
        leadId: lead?.id ?? null,
        inboundMessageId: id("demo-inbound"),
        aiMessageId: id("demo-ai"),
        outboundStatus: "skipped",
        reply: "Demo inbound processed locally.",
        integration: clone(account),
      };
      return envelope(result) as T;
    }
    if (method === "PATCH" && action === "settings") {
      const currentSettings = isRecord(account.settings) ? account.settings : {};
      const nextSettings = isRecord(body.settings) ? body.settings : {};
      account.settings = { ...currentSettings, ...nextSettings };
      return envelope(clone(account)) as T;
    }
  }

  if (method === "GET" && pathname === "/channels") return envelope(clone(s.channels)) as T;
  if (method === "POST" && pathname === "/channels") {
    const channel: Channel = {
      id: id("demo-channel"),
      tenantId,
      type: (body.type as ChannelType) ?? "WEBSITE",
      status: (body.status as ChannelStatus) ?? "PENDING",
      name: typeof body.name === "string" ? body.name : "Новый канал",
      publicKey: typeof body.publicKey === "string" ? body.publicKey : `lv_demo_${Math.random().toString(16).slice(2, 8)}`,
      settings: isRecord(body.settings) ? body.settings : {},
      lastHealthAt: null,
    };
    s.channels.push(channel);
    return envelope(clone(channel)) as T;
  }
  const channelMatch = pathname.match(/^\/channels\/([^/]+)$/u);
  if (channelMatch && method === "PATCH") {
    const channel = s.channels.find((item) => item.id === decodeURIComponent(channelMatch[1]));
    if (!channel) return envelope(null) as T;
    Object.assign(channel, body);
    return envelope(clone(channel)) as T;
  }

  if (method === "GET" && pathname === "/settings/account") return envelope({ tenant: s.tenant, owner: s.owner, businessName: s.tenant.name, timezone: s.tenant.timezone }) as T;
  if (method === "PATCH" && pathname === "/settings/account") {
    if (typeof body.businessName === "string") s.tenant.name = body.businessName;
    if (typeof body.businessType === "string") s.tenant.businessType = body.businessType;
    if (typeof body.timezone === "string") s.tenant.timezone = body.timezone;
    return envelope({ tenant: s.tenant, owner: s.owner, businessName: s.tenant.name, timezone: s.tenant.timezone }) as T;
  }
  if (method === "GET" && pathname === "/settings/team") return envelope(clone(s.team)) as T;
  if (method === "POST" && pathname === "/settings/team") {
    const member: TeamMember = {
      id: id("demo-member"),
      role: typeof body.role === "string" ? body.role : "AGENT",
      user: {
        id: id("demo-user"),
        email: typeof body.email === "string" ? body.email : "new@studio-leto.ru",
        name: typeof body.name === "string" ? body.name : null,
      },
    };
    s.team.push(member);
    return envelope(clone(member)) as T;
  }
  const teamMatch = pathname.match(/^\/settings\/team\/([^/]+)(?:\/reset-password)?$/u);
  if (teamMatch) {
    const memberId = decodeURIComponent(teamMatch[1]);
    const member = s.team.find((item) => item.id === memberId);
    if (pathname.endsWith("/reset-password") && method === "POST") {
      return envelope({ membershipId: memberId, userId: member?.user.id ?? id("demo-user"), temporaryPassword: "demo-temp-42", revokedSessions: 1 }) as T;
    }
    if (method === "PATCH" && member) {
      member.role = typeof body.role === "string" ? body.role : member.role;
      return envelope(clone(member)) as T;
    }
    if (method === "DELETE") {
      s.team = s.team.filter((item) => item.id !== memberId);
      return envelope({ id: memberId, removed: true }) as T;
    }
  }

  if (method === "GET" && pathname === "/settings/security") return envelope(clone(s.security)) as T;
  if (method === "PATCH" && pathname === "/settings/security/password") return envelope({ updated: true, revokedSessions: 0 }) as T;
  if (method === "POST" && pathname === "/settings/security/2fa/setup") return envelope({ secret: "DEMOSECRET42", otpauthUri: "otpauth://totp/LeadVirt:demo?secret=DEMOSECRET42&issuer=LeadVirt" }) as T;
  if (method === "POST" && pathname === "/settings/security/2fa/enable") {
    s.security.twoFactor = { enabled: true, setupPending: false, confirmedAt: new Date().toISOString(), recoveryCodesRemaining: 8 };
    return envelope({ twoFactor: s.security.twoFactor, recoveryCodes: ["demo-1111", "demo-2222", "demo-3333"] }) as T;
  }
  if (method === "POST" && pathname === "/settings/security/2fa/disable") {
    s.security.twoFactor = { enabled: false, setupPending: false, confirmedAt: null, recoveryCodesRemaining: 0 };
    return envelope({ twoFactor: s.security.twoFactor }) as T;
  }
  if (method === "POST" && pathname === "/settings/security/2fa/recovery-codes") return envelope({ twoFactor: s.security.twoFactor, recoveryCodes: ["demo-4444", "demo-5555", "demo-6666"] }) as T;
  if (method === "POST" && pathname === "/settings/security/sessions/revoke-others") return envelope({ revoked: 0 }) as T;
  const sessionMatch = pathname.match(/^\/settings\/security\/sessions\/([^/]+)$/u);
  if (sessionMatch && method === "DELETE") return envelope({ id: decodeURIComponent(sessionMatch[1]), revoked: true, current: false }) as T;
  if (method === "GET" && pathname === "/settings/notifications") return envelope(clone(s.notifications)) as T;
  if (method === "PATCH" && pathname === "/settings/notifications") {
    s.notifications = { ...s.notifications, ...body };
    return envelope(clone(s.notifications)) as T;
  }
  if (method === "GET" && pathname === "/settings/billing") return envelope({ billingMode: "manual_invoice", apiKeys: clone(s.apiKeys) }) as T;
  if (method === "POST" && pathname === "/settings/api-keys") {
    const created: ApiKeyCreated = {
      id: id("demo-api-key"),
      name: typeof body.name === "string" ? body.name : "Demo key",
      keyPrefix: "lvpk_demo_new",
      secret: "lvpk_demo_new_secret",
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    s.apiKeys.unshift(created);
    return envelope(created) as T;
  }
  const apiKeyMatch = pathname.match(/^\/settings\/api-keys\/([^/]+)$/u);
  if (apiKeyMatch && method === "DELETE") {
    const keyId = decodeURIComponent(apiKeyMatch[1]);
    s.apiKeys = s.apiKeys.filter((key) => key.id !== keyId);
    return envelope({ id: keyId, revoked: true }) as T;
  }

  if (method === "GET" && pathname === "/billing/plans") return envelope(plans) as T;
  if (method === "GET" && pathname === "/billing/payment-method") return envelope(clone(s.paymentMethod)) as T;
  if (method === "POST" && pathname === "/billing/payment-method/change-request") {
    s.paymentRequestedAt = new Date().toISOString();
    s.paymentMethod.status = "change_requested";
    s.paymentMethod.updatedAt = s.paymentRequestedAt;
    const result: BillingPaymentMethodUpdateRequest = { requested: true, requestedAt: s.paymentRequestedAt, mode: "manual_invoice" };
    return envelope(result) as T;
  }
  if (method === "GET" && pathname === "/billing/invoices") return envelope(billingInvoices(s)) as T;
  if (method === "GET" && pathname === "/billing/current-subscription") return envelope(clone(s.subscription)) as T;
  if (method === "PATCH" && pathname === "/billing/current-subscription") {
    const plan = plans.find((item) => item.code === body.planCode) ?? s.subscription.plan;
    s.subscription = { ...s.subscription, status: "ACTIVE", plan };
    return envelope(clone(s.subscription)) as T;
  }
  if (method === "POST" && pathname === "/billing/current-subscription/cancel") {
    s.subscription = { ...s.subscription, status: "CANCELLED" };
    return envelope(clone(s.subscription)) as T;
  }
  if (method === "GET" && pathname === "/billing/usage") return envelope(billingUsage(s)) as T;

  if (pathname === "/workflows" && method === "GET") {
    const includeArchived = searchParams.get("includeArchived") === "true";
    return envelope(clone(includeArchived ? s.workflows : s.workflows.filter((workflow) => workflow.status !== "ARCHIVED"))) as T;
  }
  if (pathname === "/workflows" && method === "POST") {
    const workflow: Workflow = workflowPatch({ id: id("demo-workflow"), tenantId, name: "Новый сценарий", status: "DRAFT", version: 0, description: null, publishedAt: null, steps: [] }, body);
    s.workflows.unshift(workflow);
    return envelope(clone(workflow)) as T;
  }
  const workflowMatch = pathname.match(/^\/workflows\/([^/]+)(?:\/([^/]+))?$/u);
  if (workflowMatch) {
    const workflowId = decodeURIComponent(workflowMatch[1]);
    const action = workflowMatch[2];
    const index = s.workflows.findIndex((workflow) => workflow.id === workflowId);
    const workflow = index >= 0 ? s.workflows[index] : null;
    if (!workflow) return envelope(null) as T;
    if (method === "GET" && !action) return envelope(clone(workflow)) as T;
    if (method === "PATCH" && !action) {
      const updated = workflowPatch(workflow, body);
      s.workflows[index] = updated;
      return envelope(clone(updated)) as T;
    }
    if (method === "POST" && action === "publish") {
      workflow.status = "ACTIVE";
      workflow.publishedAt = new Date().toISOString();
      return envelope(clone(workflow)) as T;
    }
    if (method === "POST" && action === "test") return envelope({ runId: id("demo-run"), status: "SUCCESS", message: "Demo-сценарий прошёл тест локально" }) as T;
  }

  if (method === "GET" && pathname === "/onboarding/state") return envelope(clone(s.onboarding)) as T;
  if (method === "PATCH" && pathname === "/onboarding/state") {
    const nextData = isRecord(body.data) ? body.data : {};
    s.onboarding = { ...s.onboarding, ...body, data: { ...s.onboarding.data, ...nextData } };
    return envelope(clone(s.onboarding)) as T;
  }
  if (method === "POST" && pathname === "/onboarding/complete-step") {
    const step = typeof body.step === "string" ? body.step : "";
    if (step && !s.onboarding.completedSteps.includes(step)) s.onboarding.completedSteps.push(step);
    if (step === "launch") s.onboarding.completedAt = new Date().toISOString();
    return envelope(clone(s.onboarding)) as T;
  }

  const widgetConfigMatch = pathname.match(/^\/public\/widget\/([^/]+)\/config$/u);
  if (method === "GET" && widgetConfigMatch) return envelope(widgetConfig(s)) as T;
  const widgetMessageMatch = pathname.match(/^\/public\/widget\/([^/]+)\/messages$/u);
  if (method === "POST" && widgetMessageMatch) {
    const request = body as unknown as WidgetMessageRequest;
    const sessionId = request.sessionId || id("demo-widget-session");
    const existing = s.widgetSessions[sessionId]?.messages ?? [];
    const createdAt = new Date().toISOString();
    const customerMessage = { id: request.clientMessageId ?? id("demo-widget-customer"), senderType: "CUSTOMER" as const, direction: "INBOUND" as const, text: request.text ?? "", createdAt, status: "RECEIVED" as const };
    const aiMessage = { id: id("demo-widget-ai"), senderType: "AI" as const, direction: "OUTBOUND" as const, text: "Спасибо! В demo я не записываю данные в базу, но сценарий выглядит так: уточняю услугу, предлагаю время и передаю менеджеру.", createdAt: iso(0), status: "SENT" as const };
    const response: WidgetMessageResponse = {
      sessionId,
      conversationId: "demo-widget-conversation",
      leadId: "demo-widget-lead",
      status: "OPEN",
      messages: [...existing, customerMessage, aiMessage],
      ai: { replied: true, handoffRequired: false, confidence: 0.84, intent: "booking" },
    };
    s.widgetSessions[sessionId] = response;
    return envelope(response) as T;
  }

  return envelope(null) as T;
}
