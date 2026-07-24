export type TenantStatus = "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type ActiveTenantStatus = Extract<TenantStatus, "TRIALING" | "ACTIVE">;
export type InactiveTenantStatus = Exclude<TenantStatus, ActiveTenantStatus>;
export type TenantLifecycleAccessErrorCode = "TENANT_INACTIVE";
export type ApiKeyAvailabilityErrorCode = "API_KEYS_NOT_AVAILABLE";
export type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER";

export interface LegacyApiKeyCleanupSummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  status: "INERT";
  cleanupOnly: true;
}

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
export type WorkflowStepType =
  | "TRIGGER"
  | "AI_MESSAGE"
  | "QUESTION"
  | "CONDITION"
  | "ACTION"
  | "DELAY"
  | "HANDOFF"
  | "END";
export type WorkflowExecutionIssueCode =
  | "UNSUPPORTED_STEP"
  | "MISSING_TRIGGER"
  | "MULTIPLE_TRIGGERS"
  | "UNREACHABLE_STEP";
export type WorkflowTestStatus = "COMPLETED" | "FAILED" | "BLOCKED";
export type PricingPlanCode = "START" | "PROFESSIONAL" | "BUSINESS" | "CORPORATE";

export type BusinessKnowledgeSourceType =
  | "BUSINESS_PROFILE"
  | "CATALOG"
  | "AVAILABILITY"
  | "FAQ"
  | "POLICY"
  | "ESCALATION";

export type BusinessKnowledgeSourceStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type KnowledgeRevisionStatus =
  | "ACQUIRED"
  | "SCANNING"
  | "PARSING"
  | "NORMALIZING"
  | "EXTRACTING"
  | "CHUNKING"
  | "EMBEDDING"
  | "EVALUATING"
  | "NEEDS_REVIEW"
  | "READY"
  | "REJECTED"
  | "SUPERSEDED"
  | "DELETED";

export type KnowledgeIndexSnapshotStatus =
  | "PREPARING"
  | "READY"
  | "ABANDONED"
  | "DELETING"
  | "DELETED";

export type KnowledgePublicationStatus =
  | "VALIDATING"
  | "READY"
  | "PUBLISHING"
  | "ACTIVE"
  | "SUPERSEDED"
  | "FAILED"
  | "ROLLED_BACK";

export type KnowledgePublicationItemType =
  | "LEGACY_REVISION"
  | "DOCUMENT_REVISION"
  | "FACT_VERSION"
  | "GUIDANCE_RULE_VERSION"
  | "SOURCE_PERMISSION_SNAPSHOT";

export type KnowledgeCorpusKind = "LEGACY_V1" | "STRUCTURED_V2";

export type KnowledgeJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRY_SCHEDULED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "DEAD_LETTER";

export type KnowledgeJobAttemptStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";
export type KnowledgeOutboxStatus =
  | "PENDING"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "DEAD_LETTER";
export type KnowledgeInboxStatus = "PROCESSING" | "SUCCEEDED" | "FAILED";

export type KnowledgeV2Audience = "PUBLIC" | "AUTHENTICATED_CUSTOMER" | "INTERNAL";
export type KnowledgeV2SourceKind =
  | "MANUAL"
  | "WEBSITE"
  | "FILE"
  | "SPREADSHEET"
  | "HELP_CENTER"
  | "DRIVE"
  | "NOTION"
  | "API"
  | "LEGACY_ONBOARDING";
export type KnowledgeV2SourceSyncMode = "MANUAL" | "SCHEDULED" | "WEBHOOK";
export type KnowledgeV2SourceStatus =
  | "CONNECTING"
  | "DISCOVERING"
  | "SYNCING"
  | "READY"
  | "NEEDS_REVIEW"
  | "PAUSED"
  | "FAILED"
  | "DISCONNECTED"
  | "DELETING"
  | "DELETED";
export type KnowledgeV2RevisionStatus =
  | "ACQUIRED"
  | "SCANNING"
  | "PARSING"
  | "NORMALIZING"
  | "EXTRACTING"
  | "CHUNKING"
  | "EMBEDDING"
  | "INDEXING"
  | "EVALUATING"
  | "READY"
  | "NEEDS_REVIEW"
  | "QUARANTINED"
  | "REJECTED"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "FAILED"
  | "CANCELLED"
  | "DELETED";
export type KnowledgeV2ElementKind =
  | "TITLE"
  | "PARAGRAPH"
  | "LIST"
  | "TABLE"
  | "TABLE_ROW_GROUP"
  | "IMAGE_CAPTION"
  | "CODE"
  | "HEADER_FOOTER";
export type KnowledgeV2DeletionStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
export type KnowledgeV2SecurityClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "CUSTOMER_PERSONAL"
  | "SENSITIVE"
  | "SECRET";
export type KnowledgeV2ArtifactMalwareStatus =
  | "PENDING"
  | "NOT_APPLICABLE"
  | "CLEAN"
  | "DETECTED"
  | "SCAN_FAILED";
export type KnowledgeV2MimeValidationStatus = "PENDING" | "VALID" | "INVALID";
export type KnowledgeV2ArtifactDeletionState =
  | "RETAINED"
  | "TOMBSTONED"
  | "DELETING"
  | "DELETED"
  | "FAILED";
export type KnowledgeV2DocumentStatus =
  | "DISCOVERED"
  | "ACTIVE"
  | "NEEDS_REVIEW"
  | "TOMBSTONED"
  | "DELETED";
export type KnowledgeV2ChunkIndexState = "PENDING" | "INDEXED" | "FAILED" | "DELETED";
export type KnowledgeV2RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type KnowledgeV2EvidenceTargetType =
  | "DOCUMENT_REVISION"
  | "FACT_VERSION"
  | "GUIDANCE_RULE_VERSION"
  | "MESSAGE"
  | "TOOL_RESULT"
  | "EXTERNAL_REFERENCE";
export type KnowledgeV2ConflictType =
  | "FACT_VALUE"
  | "GUIDANCE_RULE"
  | "AUTHORITY"
  | "SCOPE_OVERLAP"
  | "EFFECTIVE_PERIOD"
  | "PERMISSION"
  | "DUPLICATE_IDENTITY";
export type KnowledgeV2ConflictStatus =
  | "OPEN"
  | "IN_REVIEW"
  | "RESOLVED"
  | "DISMISSED"
  | "SUPERSEDED";
export type KnowledgeV2ConflictResolution =
  | "KEEP_LEFT"
  | "KEEP_RIGHT"
  | "MERGE"
  | "SPLIT_SCOPE"
  | "MARK_UNANSWERABLE"
  | "REQUIRE_HANDOFF"
  | "DISMISS";
export type KnowledgeV2ConflictDecision = Exclude<
  KnowledgeV2ConflictResolution,
  "MERGE" | "SPLIT_SCOPE" | "DISMISS"
>;
export type KnowledgeV2ConflictCandidateType =
  | "DOCUMENT_REVISION"
  | "FACT_VERSION"
  | "GUIDANCE_RULE_VERSION";
export type KnowledgeV2ReviewReason =
  | "MISSING_REQUIRED_INFORMATION"
  | "CONFLICTING_VALUES"
  | "INFERRED_HIGH_RISK"
  | "LOW_CONFIDENCE_CONTENT"
  | "SENSITIVE_CONTENT"
  | "STALE_SOURCE"
  | "INACCESSIBLE_SOURCE"
  | "FAILING_TEST";
export type KnowledgeV2ReviewStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_REVIEW"
  | "RESOLVED"
  | "DISMISSED"
  | "SUPERSEDED";
export type KnowledgeV2ReviewAction =
  | "REVIEW_VALUE"
  | "CORRECT_SOURCE"
  | "ADD_MISSING_ANSWER"
  | "CHANGE_GUIDANCE"
  | "MARK_UNANSWERABLE"
  | "REQUIRE_HANDOFF"
  | "EXCLUDE_CONTENT"
  | "RETRY_SOURCE"
  | "VERIFY_PERMISSION"
  | "APPROVE"
  | "REJECT"
  | "DISMISS";
export type KnowledgeV2TestCaseStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type KnowledgeV2TestCaseOrigin =
  | "PLATFORM"
  | "INDUSTRY_PACK"
  | "TENANT"
  | "ANONYMIZED_FAILURE"
  | "SYNTHETIC";
export type KnowledgeV2ExpectedBehavior =
  | "ANSWER"
  | "ABSTAIN"
  | "HANDOFF"
  | "REFUSE"
  | "TOOL_CALL"
  | "HOLD_FOR_APPROVAL";
export type KnowledgeV2TestExpectationKind =
  | "REQUIRED_FACT"
  | "FORBIDDEN_FACT"
  | "REQUIRED_GUIDANCE"
  | "FORBIDDEN_GUIDANCE"
  | "REQUIRED_EVIDENCE"
  | "FORBIDDEN_CLAIM"
  | "REQUIRED_TOOL"
  | "FORBIDDEN_TOOL";
export type KnowledgeV2EvaluationRunKind =
  | "PULL_REQUEST"
  | "DEPLOY"
  | "PUBLICATION"
  | "MODEL_MIGRATION"
  | "MANUAL"
  | "PLAYGROUND";
export type KnowledgeV2EvaluationRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";
export type KnowledgeV2EvaluationResultStatus =
  | "PASSED"
  | "WARNING"
  | "FAILED"
  | "ERROR"
  | "SKIPPED";
export type KnowledgeV2MetricCategory =
  | "INGESTION"
  | "STRUCTURED_EXTRACTION"
  | "RETRIEVAL"
  | "GENERATION"
  | "POLICY_TOOLS"
  | "SECURITY"
  | "SYSTEM";
export type KnowledgeV2MetricComparator =
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN_OR_EQUAL"
  | "EQUAL"
  | "NOT_EQUAL";
export type KnowledgeV2SnapshotKind = "PUBLICATION" | "DRAFT_CANDIDATE";
export type KnowledgeV2FeedbackCategory =
  | "INCORRECT_ANSWER"
  | "MISSING_ANSWER"
  | "WRONG_GUIDANCE"
  | "SHOULD_BE_UNANSWERABLE"
  | "SHOULD_HANDOFF"
  | "BAD_CITATION"
  | "STALE_INFORMATION"
  | "SECURITY_CONCERN"
  | "OTHER";
export type KnowledgeV2FeedbackStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
export type KnowledgeV2CorrectionTargetType =
  | "SOURCE"
  | "DOCUMENT_REVISION"
  | "FACT"
  | "GUIDANCE_RULE"
  | "MARK_UNANSWERABLE"
  | "REQUIRE_HANDOFF";
export type KnowledgeV2RetrievalOutcome =
  | "ANSWERED"
  | "ABSTAINED"
  | "HANDED_OFF"
  | "HELD_FOR_APPROVAL"
  | "REFUSED"
  | "FAILED";
export type KnowledgeV2GateOutcome = "AUTO_SEND" | "HOLD_FOR_APPROVAL" | "HANDOFF" | "BLOCKED";
export type KnowledgeV2RetrievalRejectionReason =
  | "BELOW_THRESHOLD"
  | "DUPLICATE"
  | "PERMISSION_DENIED"
  | "STALE"
  | "DELETED"
  | "CONFLICTED"
  | "RERANKED_OUT"
  | "NOT_SELECTED";
export type KnowledgeV2CitationSupport = "SUPPORTS" | "PARTIAL" | "CONTRADICTS" | "NOT_ASSESSED";
export type KnowledgeV2LifecycleStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type KnowledgeV2VerificationStatus =
  | "UNVERIFIED"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "CONFLICTED";
export type KnowledgeV2FactAuthority =
  | "INFERRED"
  | "IMPORTED"
  | "MANUAL"
  | "TRUSTED_SOURCE"
  | "OWNER_VERIFIED";
export type KnowledgeV2LocaleBehavior = "LANGUAGE_NEUTRAL" | "LOCALIZED" | "LOCALE_SPECIFIC";
export type KnowledgeV2AutoPublishPolicy = "OFF" | "TRUSTED_LOW_RISK" | "SCHEDULED";
export type KnowledgeV2PublicationApprovalPolicy = "OWNER_ONLY" | "OWNER_OR_ADMIN";
export type KnowledgeV2GuidanceRuleType =
  | "RESPONSE"
  | "PROHIBITION"
  | "ESCALATION"
  | "APPROVAL"
  | "TOOL_USE"
  | "STYLE";
export type KnowledgeV2GuidanceReviewStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "DISABLED";
export type KnowledgeV2GuidanceConditionField =
  | "INTENT"
  | "CHANNEL"
  | "LOCALE"
  | "LOCATION"
  | "BUSINESS_HOURS"
  | "CUSTOMER_AUTHORIZATION"
  | "LEAD_STAGE"
  | "TOOL_RESULT";
export type KnowledgeV2GuidanceConditionOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "IN"
  | "NOT_IN"
  | "CONTAINS"
  | "EXISTS"
  | "GREATER_THAN"
  | "LESS_THAN";
export type KnowledgeV2ReadinessStatus =
  | "READY"
  | "READY_WITH_WARNINGS"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "UPDATING";
export type KnowledgeV2ServingStatus = "READY" | "NOT_READY";
export type KnowledgeV2DraftStatus = "UP_TO_DATE" | "CHANGES_PENDING" | "PROCESSING" | "FAILED";
export type KnowledgeV2RequirementKind =
  | "FACT"
  | "RULE"
  | "DOCUMENT_COVERAGE"
  | "CONNECTOR"
  | "TOOL"
  | "PERMISSION"
  | "LOCALE"
  | "EVALUATION_CASE";
export type KnowledgeV2CapabilityType =
  | "GENERAL_FAQ"
  | "LEAD_QUALIFICATION"
  | "PRICING"
  | "APPOINTMENT_DISCOVERY"
  | "APPOINTMENT_BOOKING"
  | "ORDER_ACCOUNT_SUPPORT"
  | "COMMERCE_RECOMMENDATION"
  | "REGULATED_TOPIC";
export type KnowledgeV2CapabilityAutonomy =
  | "ANSWER_ONLY"
  | "COLLECT_INFORMATION"
  | "PROPOSE_ACTION"
  | "ACT_WITH_CONFIRMATION"
  | "AUTONOMOUS_ACTION";
export type KnowledgeV2RequirementSeverity = "BLOCKER" | "WARNING";
export type KnowledgeV2RequirementStatus =
  | "SATISFIED"
  | "UNSATISFIED"
  | "STALE"
  | "CONFLICTED"
  | "NOT_APPLICABLE";
export type KnowledgeV2RequirementReasonCode =
  | "SATISFIED"
  | "CAPABILITY_DISABLED"
  | "REQUIREMENT_INACTIVE"
  | "INVALID_DEFINITION"
  | "INVALID_PREDICATE"
  | "ACTIVE_CONFLICT"
  | "EVIDENCE_STALE"
  | "EVIDENCE_MISSING"
  | "THRESHOLD_NOT_MET"
  | "SCOPE_NOT_COVERED"
  | "LOCALE_NOT_COVERED"
  | "LOCALE_CONTEXT_MISSING";
export type KnowledgeV2PublicationStatus =
  | "VALIDATING"
  | "READY"
  | "PUBLISHING"
  | "ACTIVE"
  | "SUPERSEDED"
  | "FAILED"
  | "ROLLED_BACK";
export type KnowledgeV2PublicationValidationStatus =
  | "PENDING"
  | "PASSED"
  | "PASSED_WITH_WARNINGS"
  | "FAILED";
export type KnowledgeV2PublicationGateStatus = "PASSED" | "WARNING" | "BLOCKED";
export type KnowledgeV2PublicationItemType =
  | "DOCUMENT_REVISION"
  | "FACT_VERSION"
  | "GUIDANCE_RULE_VERSION"
  | "SOURCE_PERMISSION_SNAPSHOT";
export type KnowledgeV2JobStage =
  | "QUEUED"
  | "ACQUIRING"
  | "SCANNING"
  | "PARSING"
  | "NORMALIZING"
  | "EXTRACTING"
  | "CHUNKING"
  | "INDEXING"
  | "EVALUATING"
  | "VALIDATING"
  | "PUBLISHING"
  | "ROLLING_BACK"
  | "RECONCILING"
  | "CLEANING_UP"
  | "MIGRATING_LEGACY";
export type KnowledgeV2JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "RETRY_SCHEDULED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "DEAD_LETTER";
export type KnowledgeV2ErrorCode =
  | "IDEMPOTENCY_KEY_REUSED"
  | "REVISION_CONFLICT"
  | `BUSINESS_IMPORT_${string}`
  | `BUSINESS_INFORMATION_${string}`
  | `KNOWLEDGE_VALIDATION_${string}`
  | `KNOWLEDGE_SOURCE_${string}`
  | `KNOWLEDGE_UPLOAD_${string}`
  | `KNOWLEDGE_PARSE_${string}`
  | `KNOWLEDGE_SECURITY_${string}`
  | `KNOWLEDGE_CONFLICT_${string}`
  | `KNOWLEDGE_PUBLICATION_${string}`
  | `KNOWLEDGE_PERMISSION_${string}`
  | `KNOWLEDGE_QUOTA_${string}`
  | `KNOWLEDGE_DEPENDENCY_${string}`;

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
  locale?: string | null;
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
  automaticRepliesEnabled: boolean;
  automaticRepliesGeneration: number;
  automaticRepliesPublicationId?: string | null;
  automaticRepliesPublicationEtag?: number | null;
  automaticRepliesCapabilitySetHash?: string | null;
  automaticRepliesOperationalBindingHash?: string | null;
  automaticRepliesOperationalPermissionGeneration?: number | null;
  automaticRepliesActivatedAt?: string | null;
}

export interface ChannelProvisioningResult extends Channel {
  oneTimeSecret?: string;
}

export interface ChannelWebhookSecretRotation {
  channel: Channel;
  oneTimeSecret: string;
}

export type ChannelAutomaticReplyReadinessStatus = "ACTIVE" | "READY" | "BLOCKED";

export interface ChannelAutomaticReplyReadinessBlocker {
  code: string;
  message: string;
}

export interface ChannelAutomaticReplyReadiness {
  channelId: string;
  status: ChannelAutomaticReplyReadinessStatus;
  enabled: boolean;
  canActivate: boolean;
  generation: number;
  activePublicationId: string | null;
  activePublicationEtag: number | null;
  activeCapabilitySetHash: string | null;
  activatedAt: string | null;
  blockers: ChannelAutomaticReplyReadinessBlocker[];
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
  activationWelcomeAt?: string | null;
  isInternalSample?: boolean;
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
  execution?: {
    executable: boolean;
    issues: WorkflowExecutionIssue[];
  };
}

export interface WorkflowExecutionIssue {
  code: WorkflowExecutionIssueCode;
  stepId: string | null;
  stepName: string | null;
  stepType: WorkflowStepType | null;
  message: string;
}

export interface WorkflowTestResult {
  runId: string | null;
  status: WorkflowTestStatus;
  message: string;
  events: number;
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

export interface IntegrationConnectionRequest {
  id: string;
  provider: IntegrationProvider;
  status: "REQUESTED";
  requestedAt: string;
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
  internalSample: boolean;
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

export const BILLING_PLAN_CATALOG: ReadonlyArray<PricingPlan> = [
  {
    code: "START",
    name: "Start",
    priceMonthlyRub: 9900,
    aiConversations: 500,
    channelsLimit: 2,
    usersLimit: 3,
    scenariosLimit: 3,
    features: [],
  },
  {
    code: "PROFESSIONAL",
    name: "Professional",
    priceMonthlyRub: 24900,
    aiConversations: 2500,
    channelsLimit: 5,
    usersLimit: 10,
    scenariosLimit: 15,
    popular: true,
    features: [],
  },
  {
    code: "BUSINESS",
    name: "Business",
    priceMonthlyRub: 59900,
    aiConversations: 10000,
    channelsLimit: 10,
    usersLimit: 25,
    scenariosLimit: 50,
    features: [],
  },
  {
    code: "CORPORATE",
    name: "Corporate",
    priceMonthlyRub: 120000,
    aiConversations: null,
    channelsLimit: null,
    usersLimit: null,
    scenariosLimit: null,
    features: [],
  },
];

export interface Subscription {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  plan: PricingPlan;
}

export interface BillingPlanSelection {
  reference: string;
  plan: PricingPlan;
  selectedAt: string;
  status: "CONTACT_REQUIRED";
  checkout: {
    available: false;
    mode: "manual_invoice";
  };
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
  activation: {
    hasRealInbound: boolean;
    hasProviderReply: boolean;
    latestRealConversationId: string | null;
    latestRealInboundAt: string | null;
  };
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
  recentActivity: { id: string; action: string; title?: string; createdAt: string }[];
  channelPerformance: {
    channelType: ChannelType;
    name: string;
    leads: number;
    conversations: number;
    conversionRate: number;
    valueAmount: number;
  }[];
  trend: { weekday?: number; name?: string; leads: number; booked: number }[];
}

export interface AnalyticsOverview {
  leadsOverTime: { name: string; leads: number; booked: number }[];
  leadsByChannel: { channelType: ChannelType; leads: number; conversionRate: number }[];
  conversionByScenario: { scenario: string; conversionRate: number; runs: number }[];
  responseTime: { averageSeconds: number; p90Seconds: number };
  bookingsOrders: { bookings: number; orders: number };
  estimatedRevenue: number;
  bestPerformingChannels: { channelType: ChannelType; score: number }[];
  aiInsightCodes?: Array<
    "CHANNEL_VALUE" | "HIGH_RISK_HANDOFF" | "EARLY_BOOKING_TIME" | "PRICE_FOLLOWUP"
  >;
  aiInsights?: string[];
}

export interface SettingsAccount {
  tenant: Tenant;
  owner: User;
  businessName: string;
  timezone: string;
  logoDataUrl?: string | null;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  businessProfileVersion: number;
  businessProfileEtag: string;
  businessProfileUpdatedAt: string;
}

export interface SecuritySession {
  id: string;
  current: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface SecuritySettings {
  authMode: "credentials" | "email" | "telegram";
  hasPassword: boolean;
  productionAuthReadyFor: string[];
  tenantScoped: boolean;
  currentRole: UserRole;
  passwordChangeRequired: boolean;
  twoFactor: {
    enabled: boolean;
    setupPending: boolean;
    confirmedAt: string | null;
    recoveryCodesRemaining: number;
  };
  sessions: SecuritySession[];
}

export interface OnboardingState {
  businessProfileVersion: number;
  businessProfileEtag: string;
  businessProfileUpdatedAt: string;
  currentStep: string;
  completedSteps: string[];
  data: Record<string, unknown>;
  completedAt?: string | null;
}

export type BusinessProfileDay = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface BusinessProfileServiceItem {
  id: string;
  name: string;
  description: string;
  price: string;
  duration: string;
}

export interface BusinessProfileScheduleDay {
  day: BusinessProfileDay;
  enabled: boolean;
  opensAt: string;
  closesAt: string;
}

export interface BusinessProfileData {
  businessType: string;
  name: string;
  description: string;
  avgCheck: string;
  servicesCatalog: string;
  services: BusinessProfileServiceItem[];
  hours: string;
  weeklySchedule: BusinessProfileScheduleDay[];
  availability: string;
  faq: string;
  policies: string;
  escalationRules: string;
  timezone: string;
}

export type BusinessProfilePatch = Partial<BusinessProfileData>;

export interface BusinessProfilePatchRequest {
  profile: BusinessProfilePatch;
}

export interface BusinessProfileView {
  profile: BusinessProfileData;
  version: number;
  etag: string;
  updatedAt: string;
}

export type BusinessImportFormat = "CSV" | "XLSX" | "PDF";
export type BusinessImportCatalogMode = "ADD" | "REPLACE";
export type BusinessImportState =
  | "CREATED"
  | "UPLOADING"
  | "UPLOADED"
  | "SCANNING"
  | "PARSING"
  | "MAPPING_REQUIRED"
  | "EXTRACTING"
  | "READY_FOR_REVIEW"
  | "AWAITING_APPROVAL"
  | "APPLYING"
  | "PROJECTING"
  | "PROJECTION_DELAYED"
  | "PARTIALLY_APPLIED"
  | "APPLIED"
  | "CLOSED_WITH_REMAINDER"
  | "FAILED_RETRYABLE"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";
export type BusinessImportCandidateAction =
  | "ADD"
  | "UPDATE"
  | "LINK"
  | "UNCHANGED"
  | "CONFLICT"
  | "INVALID"
  | "MISSING"
  | "ARCHIVE";
export type BusinessImportCandidateDecision =
  | "PENDING"
  | "ACCEPTED"
  | "EDITED"
  | "SUBMITTED_FOR_APPROVAL"
  | "REJECTED"
  | "STALE"
  | "APPLIED";
export type BusinessImportRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED";
export type BusinessImportConfidence = "CONFIRMED_FORMAT" | "HIGH" | "MEDIUM" | "LOW";
export type BusinessOfferingPriceType = "FIXED" | "FROM" | "RANGE" | "FREE" | "ON_REQUEST";
export type BusinessImportAllowedAction =
  | "UPLOAD"
  | "FINALIZE"
  | "MAP"
  | "REVIEW"
  | "REBASE"
  | "APPLY"
  | "RETRY"
  | "CANCEL"
  | "REVERT";

export interface BusinessImportCreateIntentRequest {
  filename: string;
  declaredMimeType:
    | "text/csv"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    | "application/pdf";
  byteSize: number;
  mode?: BusinessImportCatalogMode;
  sourceId?: string | null;
  sourceName?: string | null;
}

export interface BusinessImportUploadPolicyView {
  maxBytes: number;
  expectedBytes: number;
  allowedMimeTypes: readonly string[];
  expiresAt: string;
  oneTime: true;
}

export interface BusinessImportUploadIntentView {
  id: string;
  importId: string;
  uploadUrl: string;
  method: "PUT";
  headers: {
    Authorization: string;
    "Content-Type": string;
    "Content-Length": string;
  };
  policy: BusinessImportUploadPolicyView;
  idempotencyReplayed: boolean;
}

export interface BusinessImportUploadReceiptView {
  importId: string;
  status: "UPLOADED";
  uploadedAt: string;
}

export interface BusinessImportDiagnosticView {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  row?: number | null;
  column?: number | null;
  field?: string | null;
}

export type BusinessImportMappingTarget =
  | "IGNORE"
  | "external_id"
  | "category"
  | "name"
  | "description"
  | "price"
  | "price_type"
  | "price_amount"
  | "price_from"
  | "price_to"
  | "currency"
  | "price_unit"
  | "tax_note"
  | "duration"
  | "duration_minutes"
  | "duration_max_minutes"
  | "location_external_id"
  | "booking_notes"
  | "active"
  | "valid_from"
  | "valid_until"
  | "language";

export type BusinessImportMappingColumnStatus = "MATCHED" | "CHECK_MAPPING" | "NOT_USED";

export interface BusinessImportMappingColumnView {
  sourceColumnKey: string;
  index: number;
  header: string;
  examples: string[];
  proposedTarget: BusinessImportMappingTarget;
  status: BusinessImportMappingColumnStatus;
}

export interface BusinessImportMappingTableView {
  tableKey: string;
  schemaHash: string;
  headerRow: number;
  totalRows: number;
  totalColumns: number;
  columns: BusinessImportMappingColumnView[];
}

export interface BusinessImportMappingDefaults {
  locale: string | null;
  numberFormat: BusinessImportNumberFormat | null;
  currency: string | null;
  timezone: string | null;
  unit: string | null;
}

export type BusinessImportNumberFormat = "DECIMAL_DOT" | "DECIMAL_COMMA";

export interface BusinessImportMappingValidationView {
  canConfirm: boolean;
  errorCodes: string[];
  warningCodes: string[];
}

export interface BusinessImportMappingView {
  importId: string;
  etag: string;
  format: BusinessImportFormat;
  table: BusinessImportMappingTableView;
  defaults: BusinessImportMappingDefaults;
  validation: BusinessImportMappingValidationView;
}

export interface BusinessImportMappingAssignment {
  sourceColumnKey: string;
  target: BusinessImportMappingTarget;
}

export interface BusinessImportMappingConfirmRequest {
  tableKey: string;
  schemaHash: string;
  headerRow: number;
  columns: BusinessImportMappingAssignment[];
  defaults: BusinessImportMappingDefaults;
}

export interface BusinessImportMappingConfirmReceipt {
  importId: string;
  mappingId: string;
  generation: number;
  state: "PARSING";
  etag: string;
  idempotencyReplayed: boolean;
}

export interface BusinessImportCountsView {
  total: number;
  valid: number;
  invalid: number;
  additions: number;
  updates: number;
  removals: number;
  linked: number;
  unchanged: number;
  conflicts: number;
  pendingApproval: number;
  applied: number;
}

export interface BusinessImportProjectionView {
  businessInformationRevision?: number | null;
  knowledgeDraftGeneration?: number | null;
  ready: boolean;
  errorCode?: string | null;
}

export interface BusinessImportApplyEligibilityView {
  eligible: boolean;
  selectedCandidates: number;
  blockingConflicts: number;
  blockingInvalid: number;
  pendingApprovals: number;
  staleCandidates: number;
  reasonCodes: string[];
}

export interface BusinessImportView {
  id: string;
  sourceId: string;
  sourceName: string;
  mode: BusinessImportCatalogMode;
  format: BusinessImportFormat;
  state: BusinessImportState;
  generation: number;
  etag: string;
  originalFilename: string;
  schemaVersion?: string | null;
  baseBusinessInformationRevision: number;
  counts: BusinessImportCountsView;
  diagnostics: BusinessImportDiagnosticView[];
  projection: BusinessImportProjectionView;
  allowedActions: BusinessImportAllowedAction[];
  applyEligibility: BusinessImportApplyEligibilityView;
  retryable: boolean;
  errorCode?: string | null;
  createdAt: string;
  updatedAt: string;
  reviewReadyAt?: string | null;
  appliedAt?: string | null;
}

export type BusinessImportCandidateEvidenceAvailability =
  | "AVAILABLE"
  | "EXPIRED"
  | "UNAVAILABLE"
  | "CORRUPT";

interface BusinessImportCandidateEvidenceBaseView {
  format: BusinessImportFormat;
  artifactId: string;
  locator: {
    row?: number | null;
    column?: number | null;
    header?: string | null;
    sheet?: string | null;
    range?: string | null;
    page?: number | null;
    boundingBox?: readonly number[] | null;
  };
  expiresAt?: string | null;
}

export type BusinessImportCandidateEvidenceView =
  | (BusinessImportCandidateEvidenceBaseView & {
      availability: "AVAILABLE";
      sourceValue: string;
    })
  | (BusinessImportCandidateEvidenceBaseView & {
      availability: Exclude<BusinessImportCandidateEvidenceAvailability, "AVAILABLE">;
      sourceValue: null;
    });

export interface BusinessImportOfferingValue {
  externalId?: string | null;
  category?: string | null;
  name: string;
  description?: string | null;
  price?: {
    type: BusinessOfferingPriceType;
    amount?: string | null;
    from?: string | null;
    to?: string | null;
    currency?: string | null;
    unit?: string | null;
    taxNote?: string | null;
  } | null;
  duration?: {
    minimumMinutes: number;
    maximumMinutes?: number | null;
  } | null;
  locationExternalId?: string | null;
  bookingNotes?: string | null;
  active: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  language?: string | null;
}

export interface BusinessImportCandidateView {
  id: string;
  importId: string;
  action: BusinessImportCandidateAction;
  decision: BusinessImportCandidateDecision;
  riskLevel: BusinessImportRiskLevel;
  requiresApproval: boolean;
  confidence: BusinessImportConfidence;
  version: number;
  etag: string;
  targetOfferingId?: string | null;
  proposed: BusinessImportOfferingValue;
  current?: BusinessImportOfferingValue | null;
  diagnostics: BusinessImportDiagnosticView[];
  evidence: BusinessImportCandidateEvidenceView[];
  approval?: {
    id: string;
    state: "PENDING" | "APPROVED" | "REJECTED" | "INVALIDATED";
    candidateVersion: number;
    decidedAt?: string | null;
  } | null;
  selected: boolean;
  canEditProposed: boolean;
  allowedDecisions: Array<"ACCEPTED" | "REJECTED">;
  appliedAt?: string | null;
}

export interface BusinessImportCandidatePage {
  items: BusinessImportCandidateView[];
  nextCursor?: string | null;
}

export interface BusinessImportListQuery {
  cursor?: string;
  limit?: number;
  sourceId?: string;
  state?: BusinessImportState;
}

export interface BusinessImportPage {
  items: BusinessImportView[];
  nextCursor?: string | null;
}

export type BusinessImportSourceStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

export interface BusinessImportSourceListQuery {
  cursor?: string;
  limit?: number;
  status?: BusinessImportSourceStatus;
  query?: string;
}

export interface BusinessImportSourceView {
  id: string;
  displayName: string;
  status: BusinessImportSourceStatus;
  etag: string;
  latestImport: BusinessImportView | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessImportSourcePage {
  items: BusinessImportSourceView[];
  nextCursor?: string | null;
}

export interface BusinessImportSourceArchivePreview {
  sourceId: string;
  sourceEtag: string;
  status: BusinessImportSourceStatus;
  canArchive: boolean;
  impact: {
    detachedOfferingBindings: number;
    removeOfferings: number;
    retainedOfferings: number;
    sharedOfferings: number;
    manualOfferings: number;
    objectsScheduledForDeletion: number;
  };
  activeImports: {
    count: number;
    items: Array<{
      id: string;
      state: BusinessImportState;
      displayName: string;
      href: string;
    }>;
  };
}

export interface BusinessImportSourceArchiveReceipt {
  sourceId: string;
  status: "ARCHIVED";
  sourceEtag: string;
  archivedAt: string;
  detachedOfferingBindings: number;
  archivedOfferings: number;
  retainedOfferings: number;
  sharedOfferings: number;
  manualOfferings: number;
  objectsScheduledForDeletion: number;
  businessInformationRevisionId: string | null;
  businessInformationRevision: number | null;
  projectionQueued: boolean;
}

export interface BusinessImportCandidateDecisionRequest {
  decision: Extract<BusinessImportCandidateDecision, "ACCEPTED" | "REJECTED">;
  proposed?: BusinessImportOfferingValue | null;
}

export interface BusinessImportBulkCandidateDecisionRequest {
  candidates: Array<{
    id: string;
    etag: string;
    decision: Extract<BusinessImportCandidateDecision, "ACCEPTED" | "REJECTED">;
  }>;
}

export interface BusinessImportApprovalDecisionRequest {
  decision: "APPROVED" | "REJECTED";
  reason?: string | null;
}

export interface BusinessImportBulkApprovalRequest {
  candidates: Array<{
    id: string;
    version: number;
    etag: string;
  }>;
}

export interface BusinessImportApprovalMutationView {
  import: BusinessImportView;
  candidates: BusinessImportCandidateView[];
}

export interface BusinessImportBulkApprovalView extends BusinessImportApprovalMutationView {
  summary: {
    selected: number;
    newlyApproved: number;
    approvalRequestsCreated: number;
    alreadyApproved: number;
  };
}

export interface BusinessImportApplyPreviewRequest {
  candidateIds: string[];
}

export interface BusinessImportApplyPreviewView {
  importId: string;
  candidateIds: string[];
  candidateVersions: Record<string, number>;
  manifestHash: string;
  businessInformationEtag: string;
  expiresAt: string;
  counts: Pick<
    BusinessImportCountsView,
    "additions" | "updates" | "removals" | "linked" | "unchanged" | "conflicts"
  >;
  diagnostics: BusinessImportDiagnosticView[];
}

export interface BusinessImportApplyRequest {
  candidateIds: string[];
  manifestHash: string;
}

export interface BusinessImportApplicationView {
  id: string;
  importId: string;
  state: "COMMITTED" | "PROJECTING" | "READY" | "PROJECTION_DELAYED" | "REVERTED" | "SUPERSEDED";
  baseBusinessInformationRevision: number;
  resultingBusinessInformationRevision: number;
  counts: Pick<
    BusinessImportCountsView,
    "additions" | "updates" | "removals" | "linked" | "unchanged"
  >;
  projection: BusinessImportProjectionView;
  createdAt: string;
  readyAt?: string | null;
  revertedAt?: string | null;
}

export interface BusinessImportRebaseRequest {
  candidateIds?: string[] | null;
}

export interface BusinessImportRetryRequest {
  generation: number;
}

export interface BusinessImportCancelView {
  importId: string;
  state: "CANCELLED";
  cancelledAt: string;
}

export interface BusinessImportRevertPreviewView {
  applicationId: string;
  eligible: boolean;
  manifestHash: string;
  businessInformationEtag: string;
  expiresAt: string;
  affectedOfferingIds: string[];
  blockers: string[];
}

export interface BusinessImportRevertRequest {
  manifestHash: string;
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

export interface KnowledgeRevision {
  id: string;
  tenantId: string;
  sourceId: string;
  sourceVersion: number;
  sourceType: BusinessKnowledgeSourceType;
  title: string;
  content: string;
  structuredData?: unknown;
  contentHash: string;
  status: KnowledgeRevisionStatus;
  pipelineVersion: string;
  supersedesRevisionId?: string | null;
  createdAt: string;
}

export interface KnowledgeRevisionChunk {
  id: string;
  tenantId: string;
  revisionId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenEstimate: number;
  embeddingProvider: string;
  embeddingModel: string;
  metadata?: unknown;
  embeddedAt?: string | null;
  createdAt: string;
}

export interface KnowledgeIndexSnapshot {
  id: string;
  tenantId: string;
  corpusKind: KnowledgeCorpusKind;
  status: KnowledgeIndexSnapshotStatus;
  collectionName: string;
  embeddingProvider: string;
  embeddingModel: string;
  manifestHash: string;
  pipelineVersion: string;
  expectedPointCount: number;
  observedPointCount?: number | null;
  errorCode?: string | null;
  createdAt: string;
  verifiedAt?: string | null;
  deleteAfter?: string | null;
  deletedAt?: string | null;
}

export interface KnowledgeIndexSnapshotItem {
  tenantId: string;
  snapshotId: string;
  chunkId: string;
  corpusKind: Extract<KnowledgeCorpusKind, "LEGACY_V1">;
  contentHash: string;
  vectorPointId: string;
  createdAt: string;
}

export interface KnowledgeV2IndexSnapshotItem {
  tenantId: string;
  snapshotId: string;
  chunkId: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  contentHash: string;
  vectorPointId: string;
  createdAt: string;
}

export interface KnowledgePublication {
  id: string;
  tenantId: string;
  corpusKind: KnowledgeCorpusKind;
  targetKey: string;
  sequence: number;
  status: KnowledgePublicationStatus;
  indexSnapshotId?: string | null;
  basePublicationId?: string | null;
  manifestHash: string;
  pipelineVersion: string;
  retrievalPolicyVersion: string;
  promptPolicyVersion: string;
  qualitySummary?: unknown;
  failureCode?: string | null;
  createdAt: string;
  readyAt?: string | null;
  activatedAt?: string | null;
  supersededAt?: string | null;
  failedAt?: string | null;
}

export interface ActiveKnowledgePublication {
  tenantId: string;
  targetKey: string;
  publicationId: string;
  sequence: number;
  etag: number;
  updatedAt: string;
  updatedByUserId?: string | null;
}

export interface KnowledgePublicationItem {
  tenantId: string;
  publicationId: string;
  corpusKind: KnowledgeCorpusKind;
  itemType: KnowledgePublicationItemType;
  itemId: string;
  revisionId?: string | null;
  v2DocumentRevisionId?: string | null;
  scope?: unknown;
  authorizationFingerprint?: string | null;
  createdAt: string;
}

export interface KnowledgeJob {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  stage: string;
  pipelineVersion: string;
  generation: number;
  status: KnowledgeJobStatus;
  priority: number;
  deadlineAt?: string | null;
  availableAt: string;
  maxAttempts: number;
  attemptCount: number;
  progressCompleted: number;
  progressTotal?: number | null;
  payloadRef?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  traceId?: string | null;
  sourceId?: string | null;
  v2SourceId?: string | null;
  revisionId?: string | null;
  v2RevisionId?: string | null;
  indexSnapshotId?: string | null;
  publicationId?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  heartbeatAt?: string | null;
  completedAt?: string | null;
}

export interface KnowledgeJobAttempt {
  id: string;
  tenantId: string;
  jobId: string;
  attempt: number;
  status: KnowledgeJobAttemptStatus;
  workerId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  traceId?: string | null;
  startedAt: string;
  heartbeatAt?: string | null;
  completedAt?: string | null;
}

export interface KnowledgeOutbox {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  schemaVersion: number;
  dedupeKey: string;
  payload: unknown;
  status: KnowledgeOutboxStatus;
  availableAt: string;
  deadlineAt?: string | null;
  attemptCount: number;
  lockedAt?: string | null;
  lockedBy?: string | null;
  publishedAt?: string | null;
  lastErrorCode?: string | null;
  traceId?: string | null;
  traceParent?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeInbox {
  id: string;
  tenantId: string;
  consumer: string;
  eventId: string;
  status: KnowledgeInboxStatus;
  result?: unknown;
  errorCode?: string | null;
  attemptCount: number;
  receivedAt: string;
  startedAt: string;
  completedAt?: string | null;
  updatedAt: string;
}

export type KnowledgeV2JsonPrimitive = string | number | boolean | null;
export type KnowledgeV2JsonValue =
  | KnowledgeV2JsonPrimitive
  | KnowledgeV2JsonValue[]
  | { [key: string]: KnowledgeV2JsonValue };

export interface KnowledgeV2PageInfo {
  limit: number;
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface KnowledgeV2CursorPage<T> {
  items: T[];
  pageInfo: KnowledgeV2PageInfo;
}

export interface KnowledgeV2VersionedView {
  version: number;
  etag: string;
}

export interface KnowledgeV2ActorView {
  id: string;
  displayName: string;
}

export type KnowledgeV2ResourceType =
  | "SETTINGS"
  | "CAPABILITY"
  | "FACT"
  | "GUIDANCE_RULE"
  | "PUBLICATION"
  | "PUBLICATION_VALIDATION"
  | "JOB"
  | "SOURCE"
  | "ARTIFACT"
  | "DOCUMENT"
  | "REVISION"
  | "CHUNK"
  | "EVIDENCE_REFERENCE"
  | "CONFLICT"
  | "REVIEW_ITEM"
  | "TEST_CASE"
  | "EVALUATION_RUN"
  | "EVALUATION_RESULT"
  | "FEEDBACK"
  | "RETRIEVAL_TRACE"
  | "CITATION";

export interface KnowledgeV2ResourceRef {
  type: KnowledgeV2ResourceType;
  id: string;
  label?: string | null;
}

export interface KnowledgeV2ScopeView {
  usesTenantDefault: boolean;
  brandIds: string[];
  locationIds: string[];
  channelTypes: ChannelType[];
  assistantIds: string[];
  audiences: KnowledgeV2Audience[];
  segments: string[];
  locales: string[];
}

export interface KnowledgeV2ScopeInput {
  brandIds?: string[];
  locationIds?: string[];
  channelTypes?: ChannelType[];
  assistantIds?: string[];
  audiences?: KnowledgeV2Audience[];
  segments?: string[];
  locales?: string[];
}

export type KnowledgeV2SourceAction = "EDIT" | "SYNC" | "PAUSE" | "RESUME" | "DELETE";
export type KnowledgeV2RevisionAction = "PREVIEW" | "EXCLUDE";

export interface KnowledgeV2SourceListQuery {
  cursor?: string;
  limit?: number;
  kind?: KnowledgeV2SourceKind;
  status?: KnowledgeV2SourceStatus;
  query?: string;
}

export interface KnowledgeV2DocumentListQuery {
  cursor?: string;
  limit?: number;
  sourceId?: string;
  kind?: string;
  status?: KnowledgeV2DocumentStatus;
  locale?: string;
  query?: string;
}

export interface KnowledgeV2RevisionListQuery {
  cursor?: string;
  limit?: number;
  status?: KnowledgeV2RevisionStatus;
}

export interface KnowledgeV2CreateSourceRequest {
  kind: KnowledgeV2SourceKind;
  displayName: string;
  canonicalUri?: string | null;
  syncMode?: KnowledgeV2SourceSyncMode;
  defaultScope?: KnowledgeV2ScopeInput | null;
  defaultClassification: KnowledgeV2SecurityClassification;
  defaultLocale: string;
}

export interface KnowledgeV2CreateFileUploadIntentRequest {
  displayName: string;
  filename: string;
  declaredMimeType: "text/plain" | "text/csv" | "application/pdf";
  byteSize: number;
  defaultScope?: KnowledgeV2ScopeInput | null;
  defaultClassification: KnowledgeV2SecurityClassification;
  defaultLocale: string;
}

export interface KnowledgeV2FileUploadPolicyView {
  maxBytes: number;
  expectedBytes: number;
  allowedMimeTypes: readonly ["text/plain", "text/csv"];
  expiresAt: string;
  oneTime: true;
}

export interface KnowledgeV2FileUploadIntentView {
  id: string;
  uploadUrl: string;
  method: "PUT";
  headers: {
    Authorization: string;
    "Content-Type": "text/plain" | "text/csv";
    "Content-Length": string;
  };
  policy: KnowledgeV2FileUploadPolicyView;
  idempotencyReplayed: boolean;
}

export interface KnowledgeV2FileUploadReceiptView {
  uploadIntentId: string;
  status: "UPLOADED";
  uploadedAt: string;
}

export interface KnowledgeV2UpdateSourceRequest {
  displayName?: string;
  syncMode?: KnowledgeV2SourceSyncMode;
  defaultScope?: KnowledgeV2ScopeInput | null;
  defaultClassification?: KnowledgeV2SecurityClassification;
  defaultLocale?: string;
}

export interface KnowledgeV2ExcludeRevisionRequest {
  reason: string;
}

export interface KnowledgeV2SourceView {
  id: string;
  kind: KnowledgeV2SourceKind;
  displayName: string;
  canonicalUri?: string | null;
  syncMode: KnowledgeV2SourceSyncMode;
  status: KnowledgeV2SourceStatus;
  defaultScope?: KnowledgeV2ScopeView | null;
  defaultClassification: KnowledgeV2SecurityClassification;
  defaultLocale: string;
  sourcePermissionVersion: number;
  generation: number;
  etag: string;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  sourceObservedAt?: string | null;
  nextSyncAt?: string | null;
  lastErrorCode?: KnowledgeV2ErrorCode | null;
  lastErrorAt?: string | null;
  documentCount: number;
  allowedActions: KnowledgeV2SourceAction[];
  createdAt: string;
  updatedAt: string;
  tombstonedAt?: string | null;
  deletedAt?: string | null;
}

export type KnowledgeV2SourcePage = KnowledgeV2CursorPage<KnowledgeV2SourceView>;

export interface KnowledgeV2ArtifactView {
  id: string;
  sourceId: string;
  sha256: string;
  byteSize: string;
  detectedMimeType?: string | null;
  declaredMimeType?: string | null;
  originalFilename?: string | null;
  upstreamModifiedAt?: string | null;
  malwareStatus: KnowledgeV2ArtifactMalwareStatus;
  mimeValidationStatus: KnowledgeV2MimeValidationStatus;
  securityClassification: KnowledgeV2SecurityClassification;
  retentionClass: string;
  legalHold: boolean;
  deletionState: KnowledgeV2ArtifactDeletionState;
  acquiredAt: string;
  scannedAt?: string | null;
  deletedAt?: string | null;
}

export interface KnowledgeV2DocumentView {
  id: string;
  etag: string;
  sourceId: string;
  kind: string;
  canonicalUri?: string | null;
  title: string;
  canonicalLocale: string;
  translationGroup?: string | null;
  scope: KnowledgeV2ScopeView;
  audiences: KnowledgeV2Audience[];
  classification: KnowledgeV2SecurityClassification;
  permissionVersion: number;
  currentDraftRevisionId?: string | null;
  currentPublishedRevisionId?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  sourceDeletedAt?: string | null;
  status: KnowledgeV2DocumentStatus;
  deletionGeneration: number;
  createdAt: string;
  updatedAt: string;
  tombstonedAt?: string | null;
  deletedAt?: string | null;
}

export type KnowledgeV2DocumentPage = KnowledgeV2CursorPage<KnowledgeV2DocumentView>;

export interface KnowledgeV2RevisionView {
  id: string;
  etag: string;
  sourceId: string;
  documentId: string;
  revisionNumber: number;
  contentHash: string;
  status: KnowledgeV2RevisionStatus;
  parserVersion?: string | null;
  ocrVersion?: string | null;
  normalizerVersion?: string | null;
  extractorVersion?: string | null;
  chunkerVersion?: string | null;
  embeddingVersion?: string | null;
  sparseIndexVersion?: string | null;
  pipelineVersion: string;
  detectedLocale?: string | null;
  characterCount: number;
  tokenCount: number;
  pageCount: number;
  tableCount: number;
  imageCount: number;
  extractionCoverage?: number | null;
  parserQuality?: KnowledgeV2JsonValue | null;
  scopeSnapshot: KnowledgeV2ScopeView;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  staleAfter?: string | null;
  supersedesRevisionId?: string | null;
  generation: number;
  allowedActions: KnowledgeV2RevisionAction[];
  createdBy?: KnowledgeV2ActorView | null;
  createdAt: string;
  deletedAt?: string | null;
}

export type KnowledgeV2RevisionPage = KnowledgeV2CursorPage<KnowledgeV2RevisionView>;

export interface KnowledgeV2ElementView {
  id: string;
  documentId: string;
  revisionId: string;
  kind: KnowledgeV2ElementKind;
  ordinal: number;
  parentElementId?: string | null;
  headingPath: string[];
  pageNumber?: number | null;
  boundingBox?: KnowledgeV2JsonValue | null;
  urlAnchor?: string | null;
  sheetName?: string | null;
  sheetRange?: string | null;
  normalizedText?: string | null;
  hasObjectReference: boolean;
  contentHash: string;
  parserConfidence?: number | null;
  locale: string;
  classification: KnowledgeV2SecurityClassification;
}

export interface KnowledgeV2ChunkView {
  id: string;
  revisionId: string;
  documentId: string;
  ordinal: number;
  parentElementId?: string | null;
  parentSectionId?: string | null;
  contentHash: string;
  tokenCount: number;
  locale: string;
  scope: KnowledgeV2ScopeView;
  classification: KnowledgeV2SecurityClassification;
  permissionVersion: number;
  denseSchemaVersion: string;
  sparseSchemaVersion: string;
  pipelineVersion: string;
  indexState: KnowledgeV2ChunkIndexState;
  indexedAt?: string | null;
  deletedAt?: string | null;
  provenanceRange: KnowledgeV2JsonValue;
}

export interface KnowledgeV2RevisionPreviewView {
  revision: KnowledgeV2RevisionView;
  elements: KnowledgeV2ElementView[];
  chunks: KnowledgeV2ChunkView[];
}

export interface KnowledgeV2IndexSnapshotItemView {
  snapshotId: string;
  chunkId: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  contentHash: string;
  vectorPointId: string;
  createdAt: string;
}

export interface KnowledgeV2DeletionLedgerView {
  id: string;
  sourceId: string;
  sourceGeneration: number;
  targetType: string;
  targetId: string;
  subsystem: string;
  status: KnowledgeV2DeletionStatus;
  deniedAt: string;
  notBefore?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  attemptCount: number;
  lastErrorCode?: KnowledgeV2ErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeV2EvidenceReferenceView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  evidenceKey?: string | null;
  targetType: KnowledgeV2EvidenceTargetType;
  itemVersionHash?: string | null;
  documentRevisionId?: string | null;
  factVersionId?: string | null;
  guidanceRuleVersionId?: string | null;
  messageId?: string | null;
  externalReferenceHash?: string | null;
  safeLabel: string;
  locatorHash?: string | null;
  isPublic: boolean;
  confidence?: number | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  permissionFingerprint?: string | null;
  hasRestrictedPayload: boolean;
  redacted: boolean;
  createdAt: string;
}

export interface KnowledgeV2EvidenceLinkView {
  evidence: KnowledgeV2EvidenceReferenceView;
  ordinal: number;
  relevanceScore?: number | null;
}

export interface KnowledgeV2ConflictCandidateView {
  id: string;
  candidateKey?: string | null;
  ordinal: number;
  candidateType: KnowledgeV2ConflictCandidateType;
  itemVersionHash?: string | null;
  documentRevisionId?: string | null;
  factVersionId?: string | null;
  guidanceRuleVersionId?: string | null;
  candidateValueHash?: string | null;
  safeValue?: string | null;
  authorityFingerprint?: string | null;
  extractionMethod?: string | null;
  confidence?: number | null;
  scope?: KnowledgeV2JsonValue | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  hasRestrictedValue: boolean;
  redacted: boolean;
  evidenceCount: number;
  evidenceTruncated: boolean;
  evidence: KnowledgeV2EvidenceLinkView[];
  createdAt: string;
}

export type KnowledgeV2ConflictAllowedAction =
  | "CLAIM"
  | "ASSIGN"
  | "UNASSIGN"
  | "RESOLVE"
  | "DISMISS";

export interface KnowledgeV2ConflictView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  conflictKey: string;
  conflictType: KnowledgeV2ConflictType;
  semanticKey: string;
  scope?: KnowledgeV2JsonValue | null;
  scopeHash: string;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  severity: KnowledgeV2RiskLevel;
  status: KnowledgeV2ConflictStatus;
  sourceId?: string | null;
  factId?: string | null;
  guidanceRuleId?: string | null;
  publicationId?: string | null;
  candidateSetHash: string;
  candidateCount: number;
  candidatesTruncated: boolean;
  candidates?: KnowledgeV2ConflictCandidateView[];
  assignedTo?: KnowledgeV2ActorView | null;
  assignedAt?: string | null;
  dueAt?: string | null;
  resolution?: KnowledgeV2ConflictResolution | null;
  resolutionRationaleHash?: string | null;
  hasRestrictedResolution: boolean;
  resolvedBy?: KnowledgeV2ActorView | null;
  resolvedAt?: string | null;
  etag: string;
  generation: number;
  allowedActions: KnowledgeV2ConflictAllowedAction[];
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeV2ConflictPage = KnowledgeV2CursorPage<KnowledgeV2ConflictView>;

export interface KnowledgeV2ConflictListQuery {
  cursor?: string;
  limit?: number;
  status?: KnowledgeV2ConflictStatus;
  conflictType?: KnowledgeV2ConflictType;
  severity?: KnowledgeV2RiskLevel;
  assignedToUserId?: string;
  sourceId?: string;
  query?: string;
}

export interface KnowledgeV2AssignReviewRequest {
  assigneeUserId?: string | null;
}

export interface KnowledgeV2ResolveConflictRequest {
  resolution: KnowledgeV2ConflictDecision;
  rationale?: string | null;
}

export interface KnowledgeV2DismissReviewRequest {
  rationale: string;
}

export interface KnowledgeV2ReviewItemView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  reviewKey: string;
  reason: KnowledgeV2ReviewReason;
  riskLevel: KnowledgeV2RiskLevel;
  status: KnowledgeV2ReviewStatus;
  suggestedAction: KnowledgeV2ReviewAction;
  safeTitle: string;
  safeSummary?: string | null;
  hasRestrictedPayload: boolean;
  sourceId?: string | null;
  documentRevisionId?: string | null;
  factId?: string | null;
  guidanceRuleId?: string | null;
  conflictId?: string | null;
  evaluationResultId?: string | null;
  feedbackId?: string | null;
  publicationId?: string | null;
  createdBy?: KnowledgeV2ActorView | null;
  assignedTo?: KnowledgeV2ActorView | null;
  assignedAt?: string | null;
  dueAt?: string | null;
  freshnessDueAt?: string | null;
  resolutionAction?: KnowledgeV2ReviewAction | null;
  resolutionSummaryHash?: string | null;
  hasRestrictedResolution: boolean;
  resolvedBy?: KnowledgeV2ActorView | null;
  resolvedAt?: string | null;
  evidenceCount: number;
  evidenceTruncated: boolean;
  evidence?: KnowledgeV2EvidenceLinkView[];
  etag: string;
  generation: number;
  allowedActions: KnowledgeV2ReviewAllowedAction[];
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeV2ReviewItemPage = KnowledgeV2CursorPage<KnowledgeV2ReviewItemView>;

export type KnowledgeV2ReviewAllowedAction =
  | "CLAIM"
  | "ASSIGN"
  | "UNASSIGN"
  | "RESOLVE"
  | "DISMISS";

export interface KnowledgeV2ReviewItemListQuery {
  cursor?: string;
  limit?: number;
  status?: KnowledgeV2ReviewStatus;
  reason?: KnowledgeV2ReviewReason;
  riskLevel?: KnowledgeV2RiskLevel;
  assignedToUserId?: string;
  sourceId?: string;
  conflictId?: string;
  query?: string;
}

export interface KnowledgeV2ResolveReviewItemRequest {
  action: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
  rationale?: string | null;
}

export type KnowledgeV2BulkReviewEligibilityReason =
  | "NOT_FOUND"
  | "STATUS_NOT_OPEN"
  | "RISK_NOT_LOW"
  | "SOURCE_REQUIRED"
  | "SOURCE_NOT_READY"
  | "CONFLICT_LINKED"
  | "RESTRICTED_CONTENT"
  | "ACTION_MISMATCH"
  | "ACTION_UNSUPPORTED"
  | "TARGET_SCHEMA_UNAVAILABLE"
  | "SOURCE_MISMATCH"
  | "REASON_MISMATCH"
  | "TARGET_SCHEMA_MISMATCH";

export interface KnowledgeV2BulkReviewPreviewRequest {
  itemIds: string[];
  action: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
}

export interface KnowledgeV2BulkReviewPreviewItemView {
  id: string;
  etag?: string | null;
  generation?: number | null;
  eligible: boolean;
  reasons: KnowledgeV2BulkReviewEligibilityReason[];
}

export interface KnowledgeV2BulkReviewPreviewView {
  eligible: boolean;
  action: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
  sourceId?: string | null;
  reason?: KnowledgeV2ReviewReason | null;
  targetSchemaHash?: string | null;
  previewHash?: string | null;
  expiresAt?: string | null;
  items: KnowledgeV2BulkReviewPreviewItemView[];
}

export interface KnowledgeV2BulkReviewExecuteItem {
  id: string;
  etag: string;
}

export interface KnowledgeV2BulkReviewExecuteRequest {
  action: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
  items: KnowledgeV2BulkReviewExecuteItem[];
  previewHash: string;
  previewExpiresAt: string;
  rationale?: string | null;
}

export interface KnowledgeV2BulkReviewExecutionItemView {
  id: string;
  etag: string;
  generation: number;
}

export interface KnowledgeV2BulkReviewExecutionView {
  batchHash: string;
  items: KnowledgeV2BulkReviewExecutionItemView[];
}

export type KnowledgeV2BulkReviewMutationResult =
  KnowledgeV2MutationResult<KnowledgeV2BulkReviewExecutionView>;

export type KnowledgeV2ReviewItemMutationResult =
  KnowledgeV2MutationResult<KnowledgeV2ReviewItemView>;
export type KnowledgeV2ConflictMutationResult = KnowledgeV2MutationResult<KnowledgeV2ConflictView>;

export interface KnowledgeV2TestExpectationView {
  id: string;
  ordinal: number;
  kind: KnowledgeV2TestExpectationKind;
  factId?: string | null;
  guidanceRuleId?: string | null;
  evidenceReferenceId?: string | null;
  semanticKey?: string | null;
  expectedValueHash?: string | null;
  hasRestrictedExpectedValue: boolean;
  createdAt: string;
}

export interface KnowledgeV2TestCaseVersionView {
  id: string;
  versionNumber: number;
  queryHash: string;
  queryHashKeyId: string;
  queryHashVersion: string;
  hasRestrictedInput: true;
  expectedBehavior: KnowledgeV2ExpectedBehavior;
  locale: string;
  channelType: ChannelType;
  audience: KnowledgeV2Audience;
  scope?: KnowledgeV2JsonValue | null;
  sliceKeys: string[];
  datasetVersion: string;
  riskLevel: KnowledgeV2RiskLevel;
  supersedesVersionId?: string | null;
  immutableHash: string;
  createdBy?: KnowledgeV2ActorView | null;
  expectations: KnowledgeV2TestExpectationView[];
  createdAt: string;
}

export interface KnowledgeV2TestCaseView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  caseKey: string;
  safeLabel: string;
  origin: KnowledgeV2TestCaseOrigin;
  status: KnowledgeV2TestCaseStatus;
  riskLevel: KnowledgeV2RiskLevel;
  critical: boolean;
  currentVersion?: KnowledgeV2TestCaseVersionView | null;
  latestVersionNumber: number;
  createdBy?: KnowledgeV2ActorView | null;
  archivedBy?: KnowledgeV2ActorView | null;
  archivedAt?: string | null;
  etag: string;
  allowedActions: KnowledgeV2TestCaseAction[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeV2TestCaseInputView {
  testCaseId: string;
  versionId: string;
  question: string;
  expectations: Array<{
    ordinal: number;
    restrictedExpectedValue?: string | null;
  }>;
}

export type KnowledgeV2TestCasePage = KnowledgeV2CursorPage<KnowledgeV2TestCaseView>;

export type KnowledgeV2TestCaseAction = "EDIT" | "ARCHIVE";

export interface KnowledgeV2TestCaseListQuery {
  cursor?: string;
  limit?: number;
  status?: KnowledgeV2TestCaseStatus;
  origin?: KnowledgeV2TestCaseOrigin;
  riskLevel?: KnowledgeV2RiskLevel;
  critical?: boolean;
  locale?: string;
  query?: string;
}

export interface KnowledgeV2TestExpectationInput {
  kind: KnowledgeV2TestExpectationKind;
  factId?: string | null;
  guidanceRuleId?: string | null;
  evidenceReferenceId?: string | null;
  semanticKey?: string | null;
  expectedValueHash?: string | null;
  restrictedExpectedValue?: string | null;
}

export interface KnowledgeV2CreateTestCaseRequest {
  safeLabel: string;
  status?: Extract<KnowledgeV2TestCaseStatus, "DRAFT" | "ACTIVE">;
  riskLevel: KnowledgeV2RiskLevel;
  critical: boolean;
  question: string;
  expectedBehavior: KnowledgeV2ExpectedBehavior;
  locale: string;
  channelType: ChannelType;
  audience: KnowledgeV2Audience;
  scope?: KnowledgeV2ScopeInput | null;
  sliceKeys: string[];
  datasetVersion: string;
  expectations: KnowledgeV2TestExpectationInput[];
}

export interface KnowledgeV2UpdateTestCaseRequest {
  safeLabel?: string;
  status?: Extract<KnowledgeV2TestCaseStatus, "DRAFT" | "ACTIVE">;
  riskLevel?: KnowledgeV2RiskLevel;
  critical?: boolean;
  question?: string;
  expectedBehavior?: KnowledgeV2ExpectedBehavior;
  locale?: string;
  channelType?: ChannelType;
  audience?: KnowledgeV2Audience;
  scope?: KnowledgeV2ScopeInput | null;
  sliceKeys?: string[];
  datasetVersion?: string;
  expectations?: KnowledgeV2TestExpectationInput[];
}

export interface KnowledgeV2ArchiveTestCaseRequest {
  reason: string;
}

export type KnowledgeV2TestCaseMutationResult = KnowledgeV2MutationResult<KnowledgeV2TestCaseView>;

export type KnowledgeV2TestRunTarget = "ACTIVE" | "DRAFT";
export type KnowledgeV2TestRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type KnowledgeV2TestRunProgressStage =
  | "QUEUED"
  | "CHECKING_KNOWLEDGE"
  | "PREPARING_RESPONSE"
  | "CHECKING_POLICY"
  | "COMPLETE";
export type KnowledgeV2TestToolCallStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";
export type KnowledgeV2TestSuppressionReason =
  | "PERMISSION"
  | "STALE"
  | "CONFLICT"
  | "LOW_CONFIDENCE"
  | "DUPLICATE"
  | "POLICY";
export type KnowledgeV2TestGateReason =
  | "SUFFICIENT_SUPPORT"
  | "MISSING_SUPPORT"
  | "CONFLICT"
  | "STALE_INFORMATION"
  | "SENSITIVE_CONTENT"
  | "TOOL_FAILURE"
  | "POLICY_REQUIRES_APPROVAL"
  | "POLICY_REQUIRES_HANDOFF"
  | "PUBLICATION_UNAVAILABLE"
  | "UNKNOWN";
export type KnowledgeV2TestMissingSupport =
  | "REQUIRED_FACT"
  | "REQUIRED_GUIDANCE"
  | "REQUIRED_EVIDENCE"
  | "FRESH_TOOL_RESULT"
  | "SCOPE_MATCH"
  | "PERMISSION"
  | "UNKNOWN";

export interface KnowledgeV2TestRunContextInput {
  locale: string;
  channelType: ChannelType;
  audience: KnowledgeV2Audience;
  scope?: KnowledgeV2ScopeInput | null;
}

export type KnowledgeV2CreateTestRunRequest = KnowledgeV2TestRunContextInput &
  ({ question: string; testCaseId?: null } | { question?: never; testCaseId: string }) &
  (
    | {
        target: "ACTIVE";
        candidateId?: never;
        candidateVersion?: never;
        candidateManifestHash?: never;
      }
    | {
        target: "DRAFT";
        candidateId: string;
        candidateVersion: number;
        candidateManifestHash: string;
      }
  );

export interface KnowledgeV2TestRunContextView {
  locale: string;
  channelType: ChannelType;
  audience: KnowledgeV2Audience;
  scope: KnowledgeV2ScopeView;
}

export interface KnowledgeV2TestFactResultView {
  factId: string;
  safeLabel: string;
  safeValue?: string | null;
  redacted: boolean;
  verificationStatus: KnowledgeV2VerificationStatus;
  authority: KnowledgeV2FactAuthority;
  observedAt?: string | null;
  expiresAt?: string | null;
}

export interface KnowledgeV2TestGuidanceResultView {
  guidanceRuleId: string;
  safeLabel: string;
  safeSummary?: string | null;
  redacted: boolean;
  riskLevel: KnowledgeV2RiskLevel;
}

export interface KnowledgeV2TestDocumentAnchorView {
  pageNumber?: number | null;
  headingPath: string[];
  urlAnchor?: string | null;
  publicUrl?: string | null;
}

export interface KnowledgeV2TestDocumentResultView {
  evidenceReferenceId: string;
  safeLabel: string;
  safeExcerpt?: string | null;
  isPublic: boolean;
  redacted: boolean;
  confidence?: number | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  anchor: KnowledgeV2TestDocumentAnchorView;
}

export interface KnowledgeV2TestToolCallView {
  toolCallId: string;
  safeName: string;
  safeSummary?: string | null;
  status: KnowledgeV2TestToolCallStatus;
  redacted: boolean;
  calledAt: string;
  observedAt?: string | null;
  expiresAt?: string | null;
}

export interface KnowledgeV2TestConflictResultView {
  conflictId: string;
  safeLabel: string;
  riskLevel: KnowledgeV2RiskLevel;
  status: KnowledgeV2ConflictStatus;
  redacted: boolean;
}

export interface KnowledgeV2TestSuppressedEvidenceView {
  reason: KnowledgeV2TestSuppressionReason;
  count: number;
}

export interface KnowledgeV2TestRunResultView {
  outcome: KnowledgeV2RetrievalOutcome;
  disposition: KnowledgeV2GateOutcome;
  finalText?: string | null;
  finalTextRedacted: boolean;
  gateReasons: KnowledgeV2TestGateReason[];
  facts: KnowledgeV2TestFactResultView[];
  guidance: KnowledgeV2TestGuidanceResultView[];
  documents: KnowledgeV2TestDocumentResultView[];
  toolCalls: KnowledgeV2TestToolCallView[];
  conflicts: KnowledgeV2TestConflictResultView[];
  missingSupport: KnowledgeV2TestMissingSupport[];
  suppressedEvidence: KnowledgeV2TestSuppressedEvidenceView[];
  retrievalTraceId?: string | null;
  latencyMs?: number | null;
}

export interface KnowledgeV2TestRunView {
  id: string;
  status: KnowledgeV2TestRunStatus;
  target: KnowledgeV2TestRunTarget;
  testCaseId?: string | null;
  hasRestrictedQuestion: true;
  context: KnowledgeV2TestRunContextView;
  targetKey: string;
  publicationId?: string | null;
  publicationSequence?: number | null;
  candidateId?: string | null;
  candidateVersion?: number | null;
  candidateManifestHash?: string | null;
  progress: {
    stage: KnowledgeV2TestRunProgressStage;
    percent?: number | null;
  };
  result?: KnowledgeV2TestRunResultView | null;
  error?: {
    code: KnowledgeV2ErrorCode;
    message: string;
    retryable: boolean;
  } | null;
  requestedBy?: KnowledgeV2ActorView | null;
  etag: string;
  pollAfterMs?: number | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
}

export type KnowledgeV2TestRunMutationResult = KnowledgeV2MutationResult<KnowledgeV2TestRunView>;

export interface KnowledgeV2EvaluationVersionsView {
  parser?: string | null;
  normalizer?: string | null;
  chunker?: string | null;
  embedding?: string | null;
  sparse?: string | null;
  reranker?: string | null;
  retrievalPolicy: string;
  promptPolicy: string;
  graph: string;
  generatorModel?: string | null;
  judgeModel?: string | null;
  judgePrompt?: string | null;
  codeCommit: string;
}

export interface KnowledgeV2EvaluationMetricView {
  id: string;
  metricKey: string;
  category: KnowledgeV2MetricCategory;
  value?: number | null;
  numerator?: number | null;
  denominator?: number | null;
  unit?: string | null;
  threshold?: number | null;
  comparator?: KnowledgeV2MetricComparator | null;
  status: KnowledgeV2EvaluationResultStatus;
  sliceKey?: string | null;
  sampleCount?: number | null;
  confidenceLower?: number | null;
  confidenceUpper?: number | null;
  createdAt: string;
}

export interface KnowledgeV2EvaluationResultView {
  id: string;
  resultKey: string;
  evaluationRunId: string;
  testCaseVersionId: string;
  repeatIndex: number;
  status: KnowledgeV2EvaluationResultStatus;
  expectedBehavior: KnowledgeV2ExpectedBehavior;
  observedBehavior?: KnowledgeV2ExpectedBehavior | null;
  gateOutcome?: KnowledgeV2GateOutcome | null;
  provider?: string | null;
  generatorModel?: string | null;
  promptPolicyVersion?: string | null;
  modelProcessorPolicyHash?: string | null;
  providerOutputHash?: string | null;
  gateInputHash?: string | null;
  gateResultHash?: string | null;
  responseHash?: string | null;
  restrictedResultHash?: string | null;
  safeSummaryHash?: string | null;
  metricManifestHash: string;
  evidenceManifestHash: string;
  errorCode?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costMicros?: string | null;
  hasRestrictedResult: boolean;
  metrics: KnowledgeV2EvaluationMetricView[];
  evidence: KnowledgeV2EvidenceLinkView[];
  createdAt: string;
}

export interface KnowledgeV2EvaluationRunView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  runKey: string;
  runKind: KnowledgeV2EvaluationRunKind;
  status: KnowledgeV2EvaluationRunStatus;
  snapshotKind: KnowledgeV2SnapshotKind;
  targetKey: string;
  publicationId?: string | null;
  candidateId?: string | null;
  candidateVersion?: number | null;
  candidateManifestHash?: string | null;
  datasetVersion: string;
  testCaseSetHash: string;
  configHash: string;
  hasRestrictedConfig: boolean;
  versions: KnowledgeV2EvaluationVersionsView;
  provider?: string | null;
  modelProcessorPolicyHash?: string | null;
  environment: string;
  requestedBy?: KnowledgeV2ActorView | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  results: KnowledgeV2EvaluationResultView[];
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeV2EvaluationRunPage = KnowledgeV2CursorPage<KnowledgeV2EvaluationRunView>;

export type KnowledgeV2BatchEvaluationRunKind = Extract<
  KnowledgeV2EvaluationRunKind,
  "MANUAL" | "PUBLICATION"
>;

export type KnowledgeV2CreateEvaluationRunRequest = {
  runKind?: KnowledgeV2BatchEvaluationRunKind;
} & (
  | {
      target: "ACTIVE";
      candidateId?: never;
      candidateVersion?: never;
      candidateManifestHash?: never;
    }
  | {
      target: "DRAFT";
      candidateId: string;
      candidateVersion: number;
      candidateManifestHash: string;
    }
);

export interface KnowledgeV2EvaluationRunListQuery {
  cursor?: string;
  limit?: number;
  status?: KnowledgeV2EvaluationRunStatus;
  runKind?: KnowledgeV2BatchEvaluationRunKind;
  target?: KnowledgeV2TestRunTarget;
}

export interface KnowledgeV2EvaluationAggregateView {
  total: number;
  passed: number;
  warning: number;
  failed: number;
  error: number;
  skipped: number;
  criticalTotal: number;
  criticalPassed: number;
  passRate: number | null;
  aggregateHash: string;
  sliceManifestHash: string;
  slices: KnowledgeV2EvaluationAggregateSliceView[];
}

export type KnowledgeV2EvaluationSliceDimension = "LOCALE" | "RISK_LEVEL" | "CRITICAL_STATUS";

export interface KnowledgeV2EvaluationAggregateSliceView {
  sliceKey: string;
  dimension: KnowledgeV2EvaluationSliceDimension;
  value: string;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  error: number;
  skipped: number;
  criticalTotal: number;
  criticalPassed: number;
  passRate: number | null;
  aggregateHash: string;
}

export interface KnowledgeV2BatchEvaluationRunView extends Omit<
  KnowledgeV2EvaluationRunView,
  "runKind"
> {
  runKind: KnowledgeV2BatchEvaluationRunKind;
  target: KnowledgeV2TestRunTarget;
  aggregate: KnowledgeV2EvaluationAggregateView;
  etag: string;
  pollAfterMs?: number | null;
  error?: {
    code: KnowledgeV2ErrorCode;
    message: string;
    retryable: boolean;
  } | null;
}

export type KnowledgeV2BatchEvaluationRunPage =
  KnowledgeV2CursorPage<KnowledgeV2BatchEvaluationRunView>;

export type KnowledgeV2EvaluationRunMutationResult =
  KnowledgeV2MutationResult<KnowledgeV2BatchEvaluationRunView>;

export interface KnowledgeV2FeedbackView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  feedbackKey: string;
  category: KnowledgeV2FeedbackCategory;
  status: KnowledgeV2FeedbackStatus;
  riskLevel: KnowledgeV2RiskLevel;
  responseMessageId?: string | null;
  evaluationRunId?: string | null;
  evaluationResultId?: string | null;
  publicationId?: string | null;
  retrievalTraceId?: string | null;
  actor?: KnowledgeV2ActorView | null;
  noteHash?: string | null;
  hasRestrictedNote: boolean;
  proposedAction?: KnowledgeV2ReviewAction | null;
  correctionTargetType?: KnowledgeV2CorrectionTargetType | null;
  sourceId?: string | null;
  documentRevisionId?: string | null;
  factId?: string | null;
  guidanceRuleId?: string | null;
  assignedTo?: KnowledgeV2ActorView | null;
  assignedAt?: string | null;
  resolutionAction?: KnowledgeV2ReviewAction | null;
  resolutionSummaryHash?: string | null;
  hasRestrictedResolution: boolean;
  resolvedBy?: KnowledgeV2ActorView | null;
  resolvedAt?: string | null;
  evidence: KnowledgeV2EvidenceLinkView[];
  etag: number;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeV2FeedbackPage = KnowledgeV2CursorPage<KnowledgeV2FeedbackView>;

export interface KnowledgeV2RetrievalCandidateView {
  id: string;
  candidateKey: string;
  evidenceReferenceId: string;
  denseRank?: number | null;
  denseScore?: number | null;
  sparseRank?: number | null;
  sparseScore?: number | null;
  fusedRank?: number | null;
  fusedScore?: number | null;
  rerankRank?: number | null;
  rerankScore?: number | null;
  selected: boolean;
  rejectionReason?: KnowledgeV2RetrievalRejectionReason | null;
  createdAt: string;
}

export interface KnowledgeV2CitationView {
  id: string;
  citationKey: string;
  evidenceReferenceId: string;
  ordinal: number;
  claimHash: string;
  support: KnowledgeV2CitationSupport;
  confidence?: number | null;
  toolObservedAt?: string | null;
  toolExpiresAt?: string | null;
  hasRestrictedClaim: boolean;
  createdAt: string;
}

export interface KnowledgeV2RetrievalTraceView {
  id: string;
  corpusKind: Extract<KnowledgeCorpusKind, "STRUCTURED_V2">;
  traceKey: string;
  distributedTraceId?: string | null;
  snapshotKind: KnowledgeV2SnapshotKind;
  targetKey: string;
  publicationId?: string | null;
  candidateId?: string | null;
  candidateVersion?: number | null;
  candidateManifestHash?: string | null;
  evaluationRunId?: string | null;
  evaluationResultId?: string | null;
  responseMessageId?: string | null;
  queryHash: string;
  queryHashKeyId: string;
  queryHashVersion: string;
  filters: KnowledgeV2JsonValue;
  filtersHash: string;
  permissionFingerprint: string;
  candidateCount: number;
  selectedCount: number;
  retrievalPolicyVersion: string;
  retrievalProcessorPolicyHash?: string | null;
  modelProcessorPolicyHash?: string | null;
  rerankerVersion?: string | null;
  promptPolicyVersion: string;
  graphVersion: string;
  provider?: string | null;
  generatorModel?: string | null;
  providerOutputHash?: string | null;
  gateInputHash?: string | null;
  gateResultHash?: string | null;
  outcome: KnowledgeV2RetrievalOutcome;
  gateOutcome: KnowledgeV2GateOutcome;
  answerHash?: string | null;
  retrievalCandidateManifestHash: string;
  citationManifestHash: string;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costMicros?: string | null;
  retentionClass: string;
  retentionExpiresAt: string;
  hasRestrictedQuery: true;
  hasRestrictedTrace: boolean;
  candidates: KnowledgeV2RetrievalCandidateView[];
  citations: KnowledgeV2CitationView[];
  createdAt: string;
}

export type KnowledgeV2RetrievalTracePage = KnowledgeV2CursorPage<KnowledgeV2RetrievalTraceView>;

export interface KnowledgeV2SourceMutationResult extends KnowledgeV2MutationResult<KnowledgeV2SourceView> {
  job?: KnowledgeV2AcceptedMutation | null;
}

export interface KnowledgeV2EvidenceView {
  id: string;
  sourceId?: string | null;
  documentId?: string | null;
  revisionId?: string | null;
  label: string;
  locator?: string | null;
  isPublic: boolean;
}

export interface KnowledgeV2WorkspacePermissionsView {
  canViewRestricted: boolean;
  canEdit: boolean;
  canManageSettings: boolean;
  canVerifyHighRisk: boolean;
  canPublish: boolean;
  canRollback: boolean;
}

export type KnowledgeV2ApproverRole = Extract<UserRole, "OWNER" | "ADMIN" | "MANAGER">;

export interface KnowledgeV2PublicationScheduleInput {
  timeZone: string;
  daysOfWeek: number[];
  hour: number;
  minute: number;
}

export interface KnowledgeV2PublicationScheduleView extends KnowledgeV2PublicationScheduleInput {
  nextRunAt?: string | null;
}

export interface KnowledgeV2SettingsView extends KnowledgeV2VersionedView {
  defaultLocale: string;
  supportedLocales: string[];
  defaultScope: KnowledgeV2ScopeView | null;
  defaultScopeGeneration: number;
  defaultScopeHash: string | null;
  autoPublishPolicy: KnowledgeV2AutoPublishPolicy;
  publicationApprovalPolicy: KnowledgeV2PublicationApprovalPolicy;
  publicationSchedule?: KnowledgeV2PublicationScheduleView | null;
  embeddingProviderPolicy?: KnowledgeV2EmbeddingProviderPolicy | null;
  retrievalProcessorPolicy?: KnowledgeV2RetrievalProcessorPolicy | null;
  modelProcessorPolicy?: KnowledgeV2ModelProcessorPolicy | null;
  createdAt: string;
  updatedAt: string;
  updatedBy?: KnowledgeV2ActorView | null;
}

export type KnowledgeV2LegacyMigrationStatus =
  | "QUEUED"
  | "RUNNING"
  | "BLOCKED"
  | "READY"
  | "CUTOVER"
  | "STALE"
  | "FAILED";

export interface KnowledgeV2LegacyMigrationView {
  id: string;
  generation: number;
  status: KnowledgeV2LegacyMigrationStatus;
  sourceManifestHash: string;
  expectedSourceCount: number;
  migratedSourceCount: number;
  reviewCount: number;
  conflictCount: number;
  jobId: string;
  jobStatus: KnowledgeV2JobStatus;
  etag: string;
  completedAt?: string | null;
  cutoverAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCorpusSelectorView {
  corpusKind: KnowledgeCorpusKind;
  generation: number;
  migrationId?: string | null;
  selectedAt: string;
  selectedByUserId?: string | null;
  etag: string;
}

export interface KnowledgeV2StartLegacyMigrationRequest {
  batchSize?: number;
}

export interface KnowledgeV2ResumeLegacyMigrationRequest {
  generation: number;
  batchSize?: number;
}

export interface KnowledgeV2CutoverRequest {
  migrationId: string;
  migrationGeneration: number;
  selectorGeneration: number;
}

export interface KnowledgeV2EmbeddingProviderPolicy {
  schemaVersion: 1;
  policyVersion: string;
  approved: true;
  provider: "openai-compatible";
  deployment: string;
  region: string;
  allowedClassifications: KnowledgeV2SecurityClassification[];
}

export interface KnowledgeV2QueryEmbeddingProcessorPolicy {
  provider: "openai-compatible";
  deployment: string;
  region: string;
  allowedClassifications: KnowledgeV2SecurityClassification[];
}

export interface KnowledgeV2RerankerProcessorPolicy {
  provider: string;
  model: string;
  version: string;
  region: string;
  allowedClassifications: KnowledgeV2SecurityClassification[];
}

export interface KnowledgeV2RetrievalProcessorPolicy {
  schemaVersion: 1;
  policyVersion: string;
  approved: true;
  queryEmbedding: KnowledgeV2QueryEmbeddingProcessorPolicy;
  reranker: KnowledgeV2RerankerProcessorPolicy;
}

export interface KnowledgeV2ModelProcessorDescriptor {
  provider: string;
  model: string;
  version: string;
  region: string;
  allowedClassifications: KnowledgeV2SecurityClassification[];
}

export interface KnowledgeV2ModelProcessorPolicy {
  schemaVersion: 1;
  policyVersion: string;
  approved: true;
  promptPolicyVersion: string;
  groundedAnswer: KnowledgeV2ModelProcessorDescriptor;
}

export interface KnowledgeV2UpdateSettingsRequest {
  defaultLocale?: string;
  supportedLocales?: string[];
  defaultScope?: KnowledgeV2ScopeInput | null;
  autoPublishPolicy?: KnowledgeV2AutoPublishPolicy;
  publicationApprovalPolicy?: KnowledgeV2PublicationApprovalPolicy;
  publicationSchedule?: KnowledgeV2PublicationScheduleInput | null;
  embeddingProviderPolicy?: KnowledgeV2EmbeddingProviderPolicy | null;
  retrievalProcessorPolicy?: KnowledgeV2RetrievalProcessorPolicy | null;
  modelProcessorPolicy?: KnowledgeV2ModelProcessorPolicy | null;
}

export interface KnowledgeV2FactDraftInput {
  factKey: string;
  entityType: string;
  entityId?: string | null;
  fieldType: string;
  normalizedValue: KnowledgeV2JsonValue;
  displayValue?: string | null;
  unit?: string | null;
  currency?: string | null;
  timeZone?: string | null;
  locale?: string | null;
  localeBehavior: KnowledgeV2LocaleBehavior;
  scope?: KnowledgeV2ScopeInput | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  riskLevel: KnowledgeV2RiskLevel;
  authority: KnowledgeV2FactAuthority;
  evidenceIds?: string[];
}

export type KnowledgeV2CreateFactRequest = KnowledgeV2FactDraftInput;

export interface KnowledgeV2UpdateFactRequest {
  normalizedValue?: KnowledgeV2JsonValue;
  displayValue?: string | null;
  unit?: string | null;
  currency?: string | null;
  timeZone?: string | null;
  locale?: string | null;
  localeBehavior?: KnowledgeV2LocaleBehavior;
  scope?: KnowledgeV2ScopeInput | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  riskLevel?: KnowledgeV2RiskLevel;
  authority?: KnowledgeV2FactAuthority;
  evidenceIds?: string[];
  changeReason?: string | null;
}

export interface KnowledgeV2FactDecisionRequest {
  note?: string | null;
}

export interface KnowledgeV2BulkFactVerificationItem {
  id: string;
  etag: string;
}

export interface KnowledgeV2BulkFactVerificationRequest {
  items: KnowledgeV2BulkFactVerificationItem[];
  note?: string | null;
}

export interface KnowledgeV2BulkFactVerificationItemView {
  id: string;
  version: number;
  etag: string;
  verificationStatus: "VERIFIED";
  authority: "OWNER_VERIFIED";
  effectiveUntil: string;
}

export interface KnowledgeV2BulkFactVerificationView {
  verifiedCount: number;
  items: KnowledgeV2BulkFactVerificationItemView[];
}

export type KnowledgeV2BulkFactVerificationMutationResult =
  KnowledgeV2MutationResult<KnowledgeV2BulkFactVerificationView>;

export type KnowledgeV2FactAction = "EDIT" | "VERIFY" | "REJECT" | "ARCHIVE";

export interface KnowledgeV2FactView extends KnowledgeV2VersionedView {
  id: string;
  versionId: string;
  factKey: string;
  entityType: string;
  entityId?: string | null;
  fieldType: string;
  normalizedValue: KnowledgeV2JsonValue;
  displayValue?: string | null;
  unit?: string | null;
  currency?: string | null;
  timeZone?: string | null;
  locale?: string | null;
  localeBehavior: KnowledgeV2LocaleBehavior;
  scope: KnowledgeV2ScopeView;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  riskLevel: KnowledgeV2RiskLevel;
  authority: KnowledgeV2FactAuthority;
  lifecycleStatus: KnowledgeV2LifecycleStatus;
  verificationStatus: KnowledgeV2VerificationStatus;
  evidence: KnowledgeV2EvidenceView[];
  allowedActions: KnowledgeV2FactAction[];
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string | null;
  verifiedBy?: KnowledgeV2ActorView | null;
}

export type KnowledgeV2FactPage = KnowledgeV2CursorPage<KnowledgeV2FactView>;

export type KnowledgeV2GuidanceCondition =
  | { kind: "ALL"; conditions: KnowledgeV2GuidanceCondition[] }
  | { kind: "ANY"; conditions: KnowledgeV2GuidanceCondition[] }
  | { kind: "NOT"; condition: KnowledgeV2GuidanceCondition }
  | {
      kind: "PREDICATE";
      field: KnowledgeV2GuidanceConditionField;
      operator: KnowledgeV2GuidanceConditionOperator;
      value?: KnowledgeV2JsonValue;
    };

export interface KnowledgeV2GuidanceRuleDraftInput {
  title: string;
  type: KnowledgeV2GuidanceRuleType;
  condition: KnowledgeV2GuidanceCondition;
  instruction: string;
  priority: number;
  tieBreakKey: string;
  scope?: KnowledgeV2ScopeInput | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  riskLevel: KnowledgeV2RiskLevel;
  requiredApproverRole?: KnowledgeV2ApproverRole | null;
  examples?: string[];
  evidenceIds?: string[];
}

export type KnowledgeV2CreateGuidanceRuleRequest = KnowledgeV2GuidanceRuleDraftInput;

export interface KnowledgeV2UpdateGuidanceRuleRequest {
  title?: string;
  type?: KnowledgeV2GuidanceRuleType;
  condition?: KnowledgeV2GuidanceCondition;
  instruction?: string;
  priority?: number;
  tieBreakKey?: string;
  scope?: KnowledgeV2ScopeInput | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  riskLevel?: KnowledgeV2RiskLevel;
  requiredApproverRole?: KnowledgeV2ApproverRole | null;
  examples?: string[];
  evidenceIds?: string[];
  changeReason?: string | null;
}

export interface KnowledgeV2GuidanceDecisionRequest {
  note?: string | null;
}

export type KnowledgeV2GuidanceRuleAction = "EDIT" | "APPROVE" | "REJECT" | "DISABLE";

export interface KnowledgeV2GuidanceRuleView extends KnowledgeV2VersionedView {
  id: string;
  versionId: string;
  title: string;
  type: KnowledgeV2GuidanceRuleType;
  condition: KnowledgeV2GuidanceCondition;
  instruction: string;
  priority: number;
  tieBreakKey: string;
  scope: KnowledgeV2ScopeView;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  riskLevel: KnowledgeV2RiskLevel;
  requiredApproverRole?: KnowledgeV2ApproverRole | null;
  examples: string[];
  evidence: KnowledgeV2EvidenceView[];
  reviewStatus: KnowledgeV2GuidanceReviewStatus;
  allowedActions: KnowledgeV2GuidanceRuleAction[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  approvedBy?: KnowledgeV2ActorView | null;
}

export type KnowledgeV2GuidanceRulePage = KnowledgeV2CursorPage<KnowledgeV2GuidanceRuleView>;

export interface KnowledgeV2ReadinessRemediationView {
  action: string;
  label: string;
  resource?: KnowledgeV2ResourceRef | null;
  href?: "/app/integrations" | null;
  destination?: {
    view: "overview" | "business" | "sources" | "guidance" | "review" | "test" | "history";
    task?: string | null;
    resource?: KnowledgeV2ResourceRef | null;
    sourceId?: string | null;
    documentId?: string | null;
    revisionId?: string | null;
  } | null;
}

export interface KnowledgeV2ReadinessRequirementView {
  id: string;
  kind: KnowledgeV2RequirementKind;
  label: string;
  status: KnowledgeV2RequirementStatus;
  reasonCode: KnowledgeV2RequirementReasonCode;
  severity: KnowledgeV2RequirementSeverity;
  riskLevel: KnowledgeV2RiskLevel;
  explanation: string;
  evidence: KnowledgeV2ResourceRef[];
  remediation?: KnowledgeV2ReadinessRemediationView | null;
  evaluatedAt: string;
}

export interface KnowledgeV2CapabilityView extends KnowledgeV2VersionedView {
  id: string;
  capabilityType: KnowledgeV2CapabilityType;
  targetKey: string;
  name: string;
  enabled: boolean;
  allowedAutonomy: KnowledgeV2CapabilityAutonomy;
  scope?: KnowledgeV2JsonValue | null;
  templateKey: string;
  templateVersion: number;
  serverOwned: boolean;
  updatedAt: string;
}

export interface KnowledgeV2CapabilityListView {
  targetKey: string;
  capabilitySetHash: string;
  items: KnowledgeV2CapabilityView[];
}

export interface KnowledgeV2UpdateCapabilityRequest {
  enabled?: boolean;
  allowedAutonomy?: KnowledgeV2CapabilityAutonomy;
}

export interface KnowledgeV2CapabilityReadinessView {
  capabilityId: string;
  capabilityType: KnowledgeV2CapabilityType;
  name: string;
  enabled: boolean;
  allowedAutonomy: KnowledgeV2CapabilityAutonomy;
  generation: number;
  etag: string;
  status: KnowledgeV2ReadinessStatus;
  weight: number;
  requirements: KnowledgeV2ReadinessRequirementView[];
  blockerCount: number;
  warningCount: number;
}

export interface KnowledgeV2ReadinessView {
  targetKey: string;
  candidateId?: string | null;
  candidateVersion: number;
  candidateManifestHash: string;
  activePublicationId?: string | null;
  activePublicationSequence?: number | null;
  status: KnowledgeV2ReadinessStatus;
  serving: {
    status: KnowledgeV2ServingStatus;
    activePublicationId?: string | null;
    activePublicationSequence?: number | null;
    activeEtag?: string | null;
    itemCounts: KnowledgeV2PublicationItemCounts;
    blockers: KnowledgeV2PublicationGateView[];
    capabilitySetHash?: string | null;
    requirementEvaluationSetHash?: string | null;
    capabilities: KnowledgeV2CapabilityReadinessView[];
  };
  draft: {
    status: KnowledgeV2DraftStatus;
    candidateId: string;
    candidateVersion: number;
    candidateManifestHash: string;
    validationId?: string | null;
    evaluationTestCaseSetHash: string;
    itemCounts: KnowledgeV2PublicationItemCounts;
    blockers: KnowledgeV2PublicationGateView[];
    warnings: KnowledgeV2PublicationGateView[];
    latestJob?: KnowledgeV2JobView | null;
    capabilitySetHash: string;
    requirementEvaluationSetHash: string;
    capabilities: KnowledgeV2CapabilityReadinessView[];
  };
  capabilities: KnowledgeV2CapabilityReadinessView[];
  blockerCount: number;
  warningCount: number;
  needsReviewCount: number;
  evaluatedAt: string;
}

export interface KnowledgeV2PublicationItemCounts {
  documentRevisions: number;
  factVersions: number;
  guidanceRuleVersions: number;
  sourcePermissionSnapshots: number;
}

export interface KnowledgeV2PublicationDiffSummary {
  added: number;
  updated: number;
  removed: number;
}

export interface KnowledgeV2PublicationGateView {
  code: string;
  status: KnowledgeV2PublicationGateStatus;
  title: string;
  message: string;
  resource?: KnowledgeV2ResourceRef | null;
  remediation?: KnowledgeV2ReadinessRemediationView | null;
}

export interface KnowledgeV2PublicationValidationView extends KnowledgeV2VersionedView {
  id: string;
  candidateId: string;
  candidateVersion: number;
  candidateManifestHash: string;
  targetKey: string;
  status: KnowledgeV2PublicationValidationStatus;
  itemCounts: KnowledgeV2PublicationItemCounts;
  blockers: KnowledgeV2PublicationGateView[];
  warnings: KnowledgeV2PublicationGateView[];
  capabilitySetHash?: string | null;
  requirementEvaluationSetHash?: string | null;
  evaluatedAt: string;
  validUntil?: string | null;
}

export type KnowledgeV2PublicationAction = "VIEW" | "ROLLBACK";

export interface KnowledgeV2PublicationSummary {
  id: string;
  targetKey: string;
  sequence: number;
  status: KnowledgeV2PublicationStatus;
  isActive: boolean;
  basePublicationId?: string | null;
  sourcePublicationId?: string | null;
  validationId?: string | null;
  itemCounts: KnowledgeV2PublicationItemCounts;
  validationStatus?: KnowledgeV2PublicationValidationStatus | null;
  capabilitySetHash?: string | null;
  requirementEvaluationSetHash?: string | null;
  diff?: KnowledgeV2PublicationDiffSummary | null;
  allowedActions: KnowledgeV2PublicationAction[];
  createdAt: string;
  createdBy?: KnowledgeV2ActorView | null;
  approvedAt?: string | null;
  approvedBy?: KnowledgeV2ActorView | null;
  activatedAt?: string | null;
  supersededAt?: string | null;
  failedAt?: string | null;
  failureCode?: KnowledgeV2ErrorCode | null;
}

export interface KnowledgeV2PublicationItemView {
  type: KnowledgeV2PublicationItemType;
  id: string;
  versionId: string;
  label: string;
  scope: KnowledgeV2ScopeView;
  usesTenantDefaultScope: boolean;
  tenantDefaultScopeGeneration: number | null;
  tenantDefaultScopeHash: string | null;
}

export interface KnowledgeV2PublicationDetail extends KnowledgeV2PublicationSummary {
  validation?: KnowledgeV2PublicationValidationView | null;
  items: KnowledgeV2PublicationItemView[];
  rollbackReason?: string | null;
}

export type KnowledgeV2PublicationPage = KnowledgeV2CursorPage<KnowledgeV2PublicationSummary>;

export interface KnowledgeV2ValidatePublicationRequest {
  targetKey: string;
  candidateId: string;
  candidateVersion: number;
}

export interface KnowledgeV2CreatePublicationRequest {
  targetKey: string;
  candidateId: string;
  candidateVersion: number;
  validationId: string;
  approvalNote?: string | null;
}

export interface KnowledgeV2RollbackPublicationRequest {
  reason: string;
}

export interface KnowledgeV2JobProgressView {
  completed: number;
  total?: number | null;
  percent?: number | null;
  label: string;
}

export interface KnowledgeV2JobErrorView {
  code: KnowledgeV2ErrorCode;
  message: string;
  retryable: boolean;
}

export interface KnowledgeV2JobView {
  id: string;
  stage: KnowledgeV2JobStage;
  status: KnowledgeV2JobStatus;
  progress: KnowledgeV2JobProgressView;
  attempt: number;
  maxAttempts: number;
  resources: KnowledgeV2ResourceRef[];
  error?: KnowledgeV2JobErrorView | null;
  createdAt: string;
  startedAt?: string | null;
  nextAttemptAt?: string | null;
  completedAt?: string | null;
}

export type KnowledgeV2JobPage = KnowledgeV2CursorPage<KnowledgeV2JobView>;

export interface KnowledgeV2AcceptedMutation {
  jobId: string;
  status: KnowledgeV2JobStatus;
  acceptedAt: string;
  resource?: KnowledgeV2ResourceRef | null;
  idempotencyReplayed: boolean;
}

export interface KnowledgeV2MutationResult<T> {
  resource: T;
  idempotencyReplayed: boolean;
}

export interface KnowledgeV2CreateHeaders {
  "Idempotency-Key": string;
}

export interface KnowledgeV2UpdateHeaders extends KnowledgeV2CreateHeaders {
  "If-Match": string;
}

export interface KnowledgeV2FieldError {
  field: string;
  code: string;
  message: string;
}

export interface KnowledgeV2SafeDiffSummary {
  changedFields: string[];
  summary?: string | null;
}

export interface KnowledgeV2StandardError {
  code: Exclude<KnowledgeV2ErrorCode, "IDEMPOTENCY_KEY_REUSED" | "REVISION_CONFLICT">;
  message: string;
  requestId: string;
  retryable: boolean;
  field?: string;
  fieldErrors?: KnowledgeV2FieldError[];
  details?: { [key: string]: KnowledgeV2JsonValue };
}

export interface KnowledgeV2RevisionConflictError {
  code: "REVISION_CONFLICT";
  message: string;
  requestId: string;
  retryable: false;
  details: {
    currentEtag: string;
    currentVersion: number;
    safeDiff: KnowledgeV2SafeDiffSummary;
  };
}

export interface KnowledgeV2IdempotencyKeyReusedError {
  code: "IDEMPOTENCY_KEY_REUSED";
  message: string;
  requestId: string;
  retryable: false;
}

export type KnowledgeV2PublicError =
  | KnowledgeV2StandardError
  | KnowledgeV2RevisionConflictError
  | KnowledgeV2IdempotencyKeyReusedError;

export interface KnowledgeV2ErrorEnvelope {
  error: KnowledgeV2PublicError;
}

export interface KnowledgeV2OverviewView {
  readiness: KnowledgeV2ReadinessView;
  activePublication?: KnowledgeV2PublicationSummary | null;
  latestDraftPublication?: KnowledgeV2PublicationSummary | null;
  counts: {
    sources: number;
    facts: number;
    guidanceRules: number;
    reviewItems: number;
    failedJobs: number;
  };
  recentJobs: KnowledgeV2JobView[];
  permissions: KnowledgeV2WorkspacePermissionsView;
}

export type KnowledgeV2DiagnosticSearchStatus = "grounded" | "insufficient_grounding";
export type KnowledgeV2DiagnosticSearchReason =
  | "NO_MATCH"
  | "CONFLICT"
  | "STALE"
  | "UNAUTHORIZED"
  | "HASH_MISMATCH"
  | "LIVE_EVIDENCE_REQUIRED";
export type KnowledgeV2DiagnosticGateReason =
  | "EVIDENCE_READY"
  | "NO_MATCH"
  | "CONFLICT"
  | "STALE_EVIDENCE"
  | "UNAUTHORIZED_EVIDENCE"
  | "HASH_MISMATCH"
  | "LIVE_EVIDENCE_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE";
export type KnowledgeV2DiagnosticDegradedReason =
  | "NO_ACTIVE_PUBLICATION"
  | "PUBLICATION_INVALID"
  | "SNAPSHOT_NOT_READY"
  | "SNAPSHOT_INCOMPATIBLE"
  | "DRAFT_SNAPSHOT_UNAVAILABLE"
  | "RESTRICTED_STORAGE_UNAVAILABLE"
  | "EMBEDDING_UNAVAILABLE"
  | "PROCESSOR_POLICY_DENIED"
  | "SPARSE_ENCODING_UNAVAILABLE"
  | "QDRANT_UNAVAILABLE"
  | "RERANKER_UNAVAILABLE"
  | "PERMISSION_PARTITION_UNAVAILABLE"
  | "RUNTIME_NOT_CONFIGURED";

export interface KnowledgeV2DiagnosticFactView {
  factId: string;
  safeLabel: string;
  safeValue: string;
  truncated: boolean;
  riskLevel: KnowledgeV2RiskLevel;
  score: number;
  observedAt?: string | null;
  expiresAt?: string | null;
}

export interface KnowledgeV2DiagnosticGuidanceView {
  guidanceRuleId: string;
  safeLabel: string;
  safeSummary: string;
  truncated: boolean;
  riskLevel: KnowledgeV2RiskLevel;
  priority: number;
  score: number;
}

export interface KnowledgeV2DiagnosticDocumentView {
  documentId: string;
  revisionId: string;
  chunkId: string;
  sourceId: string;
  sourceKind: string;
  safeLabel: string;
  safeExcerpt: string;
  truncated: boolean;
  classification: KnowledgeV2SecurityClassification;
  locale: string;
  confidence: number;
  anchor: {
    headingPath: string[];
    pageNumber?: number | null;
    urlAnchor?: string | null;
    publicUrl?: string | null;
  };
}

export interface KnowledgeV2DiagnosticSearchView {
  schemaVersion: 1;
  status: KnowledgeV2DiagnosticSearchStatus;
  reason: KnowledgeV2DiagnosticSearchReason | null;
  context: {
    locale: string;
    channelType: "DEMO";
    audience: KnowledgeV2Audience;
    classifications: KnowledgeV2SecurityClassification[];
    queryClassification: "SENSITIVE";
  };
  target: {
    corpusKind: "STRUCTURED_V2";
    targetKey: "workspace-v2";
    publicationId: string;
    publicationSequence: number;
    indexSnapshotId: string | null;
    retrievalPolicyVersion: string;
    pipelineVersion: string;
  };
  outcome: KnowledgeV2RetrievalOutcome;
  gateOutcome: KnowledgeV2GateOutcome;
  gateReasons: KnowledgeV2DiagnosticGateReason[];
  facts: KnowledgeV2DiagnosticFactView[];
  guidance: KnowledgeV2DiagnosticGuidanceView[];
  documents: KnowledgeV2DiagnosticDocumentView[];
  conflicts: Array<{
    conflictId: string;
    safeLabel: string;
    riskLevel: KnowledgeV2RiskLevel;
    status: Extract<KnowledgeV2ConflictStatus, "OPEN" | "IN_REVIEW">;
  }>;
  missingSupport: KnowledgeV2DiagnosticGateReason[];
  suppressedEvidence: Array<{
    reason: KnowledgeV2RetrievalRejectionReason;
    count: number;
  }>;
  diagnostics: {
    backend: "qdrant";
    candidateCount: number;
    hydratedCount: number;
    selectedCount: number;
    durationMs: number;
    degradedReason: KnowledgeV2DiagnosticDegradedReason | null;
    retrievalPolicyVersion: string | null;
    rerankerVersion: string | null;
    responseLimit: number;
    returnedCounts: {
      facts: number;
      guidance: number;
      documents: number;
      conflicts: number;
    };
  };
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

export interface AuthenticatedCustomerIdentityReference {
  id: string;
  version: 1;
  subjectHash: string;
  attestationHash: string;
}

export interface AiReplyJobData {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  source: AiReplySource;
  customerIdentity?: AuthenticatedCustomerIdentityReference;
  requestedByUserId?: string | null;
}

export interface AiReplyEnqueueRequest {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  text: string;
  source: AiReplySource;
  requestedByUserId?: string | null;
}

export type ChannelSendMessageSource = "telegram" | "webhook";

export interface ChannelSendMessageJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
  source: ChannelSendMessageSource;
  graphRunId?: string | null;
  triggerMessageId?: string | null;
  aiReplyRunId?: string | null;
  aiReplyGeneration?: number | null;
  aiReplySequence?: number | null;
  requestedAt: string;
}

export type OperatorOperationKind =
  | "EXTERNAL_OPERATION"
  | "CHANNEL_DELIVERY"
  | "TOOL_OPERATION"
  | "RUNTIME_OUTBOX"
  | "KNOWLEDGE_OUTBOX";

export type OperatorOperationStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "RECONCILED"
  | "DEAD_LETTER";

export type OperatorOperationAction = "RECONCILE" | "REDRIVE";

export interface OperatorOperationItem {
  id: string;
  kind: OperatorOperationKind;
  status: OperatorOperationStatus;
  code: string;
  errorCode: string | null;
  attemptCount: number;
  generation: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  etag: string;
  allowedActions: OperatorOperationAction[];
}

export interface OperatorOperationListQuery {
  cursor?: string;
  limit?: number;
  kind?: OperatorOperationKind;
  status?: OperatorOperationStatus;
}

export interface OperatorOperationList {
  items: OperatorOperationItem[];
  nextCursor: string | null;
}

export interface OperatorOperationMutationRequest {
  reason: string;
}

export interface OperatorOperationMutationResult {
  resource: OperatorOperationItem;
  outcome: "AUTHORITATIVE_SUCCEEDED" | "AUTHORITATIVE_FAILED" | "STILL_UNKNOWN" | "REDRIVEN";
  replacementId?: string;
  idempotencyReplayed: boolean;
}
