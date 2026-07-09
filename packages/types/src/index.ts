export type TenantStatus = "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";

export type ChannelType =
  | "WEBSITE"
  | "TELEGRAM"
  | "WHATSAPP"
  | "INSTAGRAM"
  | "VK"
  | "EMAIL"
  | "WEBHOOK"
  | "PHONE"
  | "DEMO";

export type ChannelStatus = "ACTIVE" | "DISABLED" | "ERROR" | "PENDING" | "COMING_SOON";

export type LeadStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "QUALIFIED"
  | "BOOKED"
  | "ORDERED"
  | "SENT_TO_CRM"
  | "CLOSED"
  | "LOST";

export type LeadTemperature = "COLD" | "WARM" | "HOT";
export type ConversationStatus = "OPEN" | "WAITING_FOR_CUSTOMER" | "WAITING_FOR_HUMAN" | "CLOSED";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageSenderType = "CUSTOMER" | "AI" | "USER" | "SYSTEM";
export type MessageStatus = "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "FAILED";
export type WorkflowStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
export type WorkflowStepType = "TRIGGER" | "AI_MESSAGE" | "QUESTION" | "CONDITION" | "ACTION" | "DELAY" | "HANDOFF" | "END";
export type PricingPlanCode = "START" | "PROFESSIONAL" | "BUSINESS" | "CORPORATE";

export type BusinessKnowledgeSourceType =
  | "BUSINESS_PROFILE"
  | "CATALOG"
  | "AVAILABILITY"
  | "FAQ"
  | "POLICY"
  | "ESCALATION";

export type BusinessKnowledgeSourceStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type IntegrationProvider =
  | "AMOCRM"
  | "BITRIX24"
  | "RETAILCRM"
  | "TELEGRAM"
  | "WHATSAPP_BUSINESS"
  | "INSTAGRAM"
  | "VK"
  | "EMAIL"
  | "GOOGLE_CALENDAR"
  | "SHOPIFY"
  | "SHOP_SCRIPT"
  | "WEBHOOK_API"
  | "OTHER";

export type IntegrationStatus = "CONNECTED" | "DISCONNECTED" | "ERROR" | "PENDING" | "COMING_SOON";

export interface ApiEnvelope<T> {
  data: T;
}

export interface PaginatedEnvelope<T> extends ApiEnvelope<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  businessType?: string | null;
  timezone: string;
}

export interface User {
  id: string;
  email: string;
  phone?: string | null;
  passwordChangeRequired?: boolean;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: UserRole;
}

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  status: ChannelStatus;
  name: string;
  publicKey?: string | null;
  settings?: unknown;
  lastHealthAt?: string | null;
}

export interface Lead {
  id: string;
  tenantId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  companyName?: string | null;
  source?: string | null;
  channelType?: ChannelType | null;
  status: LeadStatus;
  temperature: LeadTemperature;
  valueAmount?: number | null;
  currency: string;
  interest?: string | null;
  summary?: string | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
}

export interface LeadEvent {
  id: string;
  leadId: string;
  type: string;
  title: string;
  message?: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  leadId?: string | null;
  channel?: Channel | null;
  channelType?: ChannelType | null;
  status: ConversationStatus;
  subject?: string | null;
  lastMessageAt?: string | null;
  aiEnabled: boolean;
  handoffRequested: boolean;
  lead?: Lead | null;
  lastMessage?: string | null;
  unreadCount?: number;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  text?: string | null;
  status?: MessageStatus;
  createdAt: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  tenantId: string;
  messageId: string;
  kind: string;
  filename?: string | null;
  mimeType?: string | null;
  url: string;
  sizeBytes?: number | null;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  lead: Lead | null;
  events: LeadEvent[];
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  type: WorkflowStepType;
  name: string;
  positionX: number;
  positionY: number;
  config?: unknown;
}

export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: WorkflowStatus;
  version: number;
  publishedAt?: string | null;
  steps?: WorkflowStep[];
}

export interface IntegrationAccount {
  id: string;
  tenantId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  name: string;
  category?: string | null;
  settings?: unknown;
  connectedAt?: string | null;
  lastSyncAt?: string | null;
  inboundEndpoint?: IntegrationInboundEndpoint | null;
  recentSyncLogs?: IntegrationSyncLogSummary[];
  recentWebhookEvents?: IntegrationWebhookEventSummary[];
}

export interface IntegrationTestResult {
  ok: boolean;
  provider: IntegrationProvider;
  integrationId: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  message: string;
  checkedAt: string;
  integration: IntegrationAccount;
}

export interface IntegrationSampleDeliveryResult {
  ok: boolean;
  provider: IntegrationProvider;
  integrationId: string;
  duplicate: boolean;
  conversationId: string;
  leadId: string | null;
  inboundMessageId: string | null;
  aiMessageId: string | null;
  outboundStatus: "queued" | "sent" | "failed" | "skipped";
  reply: string | null;
  integration: IntegrationAccount;
}

export interface IntegrationInboundEndpoint {
  channelType: ChannelType;
  publicKey: string;
  endpointPath: string;
  secretHeader: string;
  samplePayload: unknown;
}

export interface IntegrationSyncLogSummary {
  id: string;
  action: string;
  status: string;
  message?: string | null;
  createdAt: string;
}

export interface IntegrationWebhookEventSummary {
  id: string;
  provider: string;
  externalEventId: string;
  status: string;
  errorMessage?: string | null;
  receivedAt: string;
  processedAt?: string | null;
}

export interface PricingPlan {
  code: PricingPlanCode;
  name: string;
  priceMonthlyRub: number | null;
  aiConversations: number | null;
  channelsLimit: number | null;
  usersLimit: number | null;
  scenariosLimit: number | null;
  popular?: boolean;
  bestFor?: string;
  features: string[];
}

export interface Subscription {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  plan: PricingPlan;
}

export type BillingInvoiceStatus = "PAID" | "DUE" | "CANCELED";

export interface BillingInvoice {
  id: string;
  issuedAt: string;
  periodStart: string;
  periodEnd: string;
  amountRub: number | null;
  status: BillingInvoiceStatus;
  plan: PricingPlan;
  downloadName: string;
}

export interface BillingPaymentMethod {
  mode: "manual_invoice";
  label: string;
  description: string;
  status: "configured" | "change_requested";
  updatedAt: string | null;
  nextActionLabel: string;
}

export interface BillingPaymentMethodUpdateRequest {
  requested: boolean;
  requestedAt: string;
  mode: BillingPaymentMethod["mode"];
}

export interface UsageSummary {
  aiConversations: number;
  aiConversationsLimit: number | null;
  messagesSent: number;
  messagesReceived: number;
  leadsCreated: number;
  bookingsCreated: number;
  ordersCreated: number;
  crmSyncs: number;
  workflowRuns: number;
  channels: number;
  channelsLimit: number | null;
  users: number;
  usersLimit: number | null;
  scenarios: number;
  scenariosLimit: number | null;
}

export interface DashboardMetricDeltas {
  newLeadsPercent: number;
  aiConversationsPercent: number;
  bookingsOrdersPercent: number;
  leadsSentToCrmPercent: number;
  averageResponseTimePercent: number;
  conversionRatePoints: number;
}

export interface DashboardRecentLead {
  id: string;
  conversationId?: string | null;
  name?: string | null;
  source?: string | null;
  channelType?: ChannelType | null;
  status: LeadStatus;
  temperature: LeadTemperature;
  valueAmount?: number | null;
  currency: string;
  interest?: string | null;
  summary?: string | null;
  createdAt: string;
  lastMessageAt?: string | null;
}

export interface DashboardSummary {
  metrics: {
    newLeadsCount: number;
    aiConversationsCount: number;
    bookingsOrdersCreated: number;
    leadsSentToCrm: number;
    averageResponseTimeSeconds: number;
    conversionRate: number;
    deltas?: DashboardMetricDeltas;
  };
  recentLeads: DashboardRecentLead[];
  recentActivity: { id: string; action: string; title: string; createdAt: string }[];
  channelPerformance: { channelType: ChannelType; name: string; leads: number; conversations: number; conversionRate: number; valueAmount: number }[];
  trend: { name: string; leads: number; booked: number }[];
}

export interface AnalyticsOverview {
  leadsOverTime: { name: string; leads: number; booked: number }[];
  leadsByChannel: { channelType: ChannelType; leads: number; conversionRate: number }[];
  conversionByScenario: { scenario: string; conversionRate: number; runs: number }[];
  responseTime: { averageSeconds: number; p90Seconds: number };
  bookingsOrders: { bookings: number; orders: number };
  estimatedRevenue: number;
  bestPerformingChannels: { channelType: ChannelType; score: number }[];
  aiInsights: string[];
}

export interface SettingsAccount {
  tenant: Tenant;
  owner: User;
  businessName: string;
  timezone: string;
  logoDataUrl?: string | null;
}

export interface OnboardingState {
  currentStep: string;
  completedSteps: string[];
  data: Record<string, unknown>;
  completedAt?: string | null;
}

export interface BusinessKnowledgeSource {
  id: string;
  tenantId: string;
  type: BusinessKnowledgeSourceType;
  status: BusinessKnowledgeSourceStatus;
  source: string;
  sourceKey: string;
  title: string;
  content: string;
  structuredData?: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessKnowledgeChunk {
  id: string;
  tenantId: string;
  sourceId: string;
  sourceVersion: number;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenEstimate: number;
  embeddingProvider: string;
  embeddingModel: string;
  vectorPointId?: string | null;
  metadata?: unknown;
  embeddedAt?: string | null;
  indexedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessKnowledgeSearchResult {
  chunk: BusinessKnowledgeChunk;
  source: BusinessKnowledgeSource;
  score: number;
}

export interface AiAuditSummary {
  totalEvents: number;
  usageLogs: number;
  auditLogs: number;
  success: number;
  handoff: number;
  failed: number;
  budgetBlocked: number;
  toolCalls: number;
  lastEventAt: string | null;
}

export interface AiAuditItem {
  id: string;
  kind: "usage" | "audit";
  createdAt: string;
  action: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  conversationId?: string | null;
  conversationSubject?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: string | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  graphRunId?: string | null;
  quality?: unknown;
  toolCalls?: unknown[] | undefined;
  toolResults?: unknown[] | undefined;
  retrievedContext?: unknown[] | undefined;
  payload?: Record<string, unknown> | null;
}

export interface AiAuditResponse {
  summary: AiAuditSummary;
  items: AiAuditItem[];
}

export type WidgetPosition = "bottom-right" | "bottom-left";

export interface WidgetConfig {
  publicKey: string;
  tenantName: string;
  businessName: string;
  title: string;
  subtitle: string;
  welcomeMessage: string;
  primaryColor: string;
  accentColor: string;
  position: WidgetPosition;
  locale: string;
  suggestedReplies: string[];
  consentText?: string;
  poweredBy: string;
}

export interface WidgetCustomer {
  name?: string;
  phone?: string;
  email?: string;
}

export interface WidgetMessageRequest {
  sessionId: string;
  clientMessageId?: string;
  text: string;
  customer?: WidgetCustomer;
  pageUrl?: string;
  referrer?: string;
  userAgent?: string;
}

export interface WidgetConversationMessage {
  id: string;
  senderType: MessageSenderType;
  direction: MessageDirection;
  text: string | null;
  createdAt: string;
  status: MessageStatus;
}

export interface WidgetMessageResponse {
  sessionId: string;
  conversationId: string;
  leadId: string | null;
  status: ConversationStatus;
  messages: WidgetConversationMessage[];
  ai: {
    replied: boolean;
    handoffRequired: boolean;
    confidence: number;
    intent: string;
  };
}

export interface AiDraftReply {
  reply: string;
  intent: string;
  leadFields: Record<string, unknown>;
  nextAction: {
    type: string;
    reason: string;
  };
  confidence: number;
  handoffRequired: boolean;
}

export type AiReplySource = "inbox" | "widget" | "webhook" | "telegram" | "worker-test";

export interface AiReplyJobData {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  text: string;
  businessName: string;
  businessType?: string;
  leadId?: string | null;
  leadStatus?: LeadStatus | null;
  source: AiReplySource;
  requestedByUserId?: string | null;
  receivedAt: string;
}

export type ChannelSendMessageSource = "telegram" | "webhook";

export interface ChannelSendMessageJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
  source: ChannelSendMessageSource;
  graphRunId?: string | null;
  triggerMessageId?: string | null;
  requestedAt: string;
}
