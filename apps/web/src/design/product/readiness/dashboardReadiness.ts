import type {
  BusinessProfileData,
  BusinessProfileView,
  Channel,
  ChannelAutomaticReplyReadiness,
  IntegrationAccount,
  KnowledgeV2OverviewView,
} from "@leadvirt/types";
import { getBusinessProfile } from "@/lib/api/business-profile";
import { getChannelAutomaticReplyReadiness, listChannels } from "@/lib/api/channels";
import { listIntegrations } from "@/lib/api/integrations";
import { getKnowledgeV2Overview } from "@/lib/api/knowledge";

export type DashboardReadinessStepId =
  | "profile"
  | "knowledge"
  | "test"
  | "publish"
  | "channel"
  | "replies"
  | "inbound";

export type DashboardReadinessStepState = "completed" | "current" | "blocked";
export type DashboardReadinessEvidence = "complete" | "incomplete" | "needs_check";

type DataCheck<T> = { state: "available"; value: T } | { state: "unavailable" };

type ReplyReadinessCheck = {
  state: "available" | "unavailable";
  values: ChannelAutomaticReplyReadiness[];
  verifiedAll: boolean;
};

export interface DashboardReadinessSnapshot {
  profile: DataCheck<BusinessProfileView>;
  knowledge: DataCheck<KnowledgeV2OverviewView>;
  channels: DataCheck<Channel[]>;
  integrations: DataCheck<IntegrationAccount[]>;
  automaticReplies: ReplyReadinessCheck;
}

export type DashboardReadinessDetail =
  | { kind: "profile_complete" }
  | { kind: "profile_missing"; count: number }
  | { kind: "knowledge_complete" }
  | { kind: "knowledge_review"; count: number }
  | { kind: "knowledge_blocked"; count: number }
  | { kind: "knowledge_updating" }
  | { kind: "test_complete" }
  | { kind: "test_incomplete" }
  | { kind: "publish_complete" }
  | { kind: "publish_incomplete" }
  | { kind: "channel_complete" }
  | { kind: "channel_incomplete" }
  | { kind: "replies_complete" }
  | { kind: "replies_incomplete" }
  | { kind: "inbound_complete" }
  | { kind: "inbound_incomplete" }
  | { kind: "needs_check" };

export interface DashboardReadinessStep {
  id: DashboardReadinessStepId;
  state: DashboardReadinessStepState;
  evidence: DashboardReadinessEvidence;
  detail: DashboardReadinessDetail;
  href: string;
}

export interface DashboardReadinessModel {
  steps: DashboardReadinessStep[];
  completedCount: number;
  isReady: boolean;
  primaryStepId: DashboardReadinessStepId | null;
  primaryHref: string;
}

async function check<T>(promise: Promise<T>): Promise<DataCheck<T>> {
  try {
    const value = await promise;
    return value == null ? { state: "unavailable" } : { state: "available", value };
  } catch {
    return { state: "unavailable" };
  }
}

function isConnectedChannel(channel: Channel) {
  return channel.status === "ACTIVE";
}

function isConnectedCustomerIntegration(integration: IntegrationAccount) {
  return (
    integration.status === "CONNECTED" &&
    (integration.provider === "TELEGRAM" || integration.provider === "WEBHOOK_API")
  );
}

export async function loadDashboardReadinessSnapshot(): Promise<DashboardReadinessSnapshot> {
  const [profile, knowledge, channels, integrations] = await Promise.all([
    check(getBusinessProfile()),
    check(getKnowledgeV2Overview()),
    check(listChannels()),
    check(listIntegrations()),
  ]);

  if (channels.state === "unavailable") {
    return {
      profile,
      knowledge,
      channels,
      integrations,
      automaticReplies: { state: "unavailable", values: [], verifiedAll: false },
    };
  }

  const connectedChannels = channels.value.filter(isConnectedChannel);
  const replyChecks = await Promise.all(
    connectedChannels.map((channel) => check(getChannelAutomaticReplyReadiness(channel.id))),
  );
  const values = replyChecks.flatMap((result) =>
    result.state === "available" ? [result.value] : [],
  );
  const verifiedAll = values.length === connectedChannels.length;

  return {
    profile,
    knowledge,
    channels,
    integrations,
    automaticReplies: {
      state: verifiedAll ? "available" : "unavailable",
      values,
      verifiedAll,
    },
  };
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function countMissingProfileSections(profile: BusinessProfileData) {
  const hasCoreProfile = hasText(profile.name) && hasText(profile.description);
  const hasServices = profile.services.some((service) => hasText(service.name));
  const hasSchedule = profile.weeklySchedule.some((entry) => entry.enabled);

  return [
    hasCoreProfile,
    hasServices,
    hasSchedule,
    hasText(profile.faq),
    hasText(profile.policies),
    hasText(profile.escalationRules),
  ].filter((complete) => !complete).length;
}

function profileAssessment(
  profile: DataCheck<BusinessProfileView>,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  if (profile.state === "unavailable") {
    return { evidence: "needs_check", detail: { kind: "needs_check" } };
  }
  const missing = countMissingProfileSections(profile.value.profile);
  return missing === 0
    ? { evidence: "complete", detail: { kind: "profile_complete" } }
    : { evidence: "incomplete", detail: { kind: "profile_missing", count: missing } };
}

function knowledgeAssessment(
  knowledge: DataCheck<KnowledgeV2OverviewView>,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  if (knowledge.state === "unavailable") {
    return { evidence: "needs_check", detail: { kind: "needs_check" } };
  }

  const readiness = knowledge.value.readiness;
  if (readiness.status === "UPDATING" || readiness.draft.status === "PROCESSING") {
    return { evidence: "incomplete", detail: { kind: "knowledge_updating" } };
  }
  if (readiness.needsReviewCount > 0) {
    return {
      evidence: "incomplete",
      detail: { kind: "knowledge_review", count: readiness.needsReviewCount },
    };
  }
  if (
    readiness.blockerCount > 0 ||
    readiness.status === "BLOCKED" ||
    readiness.status === "NEEDS_REVIEW" ||
    readiness.draft.status === "FAILED"
  ) {
    return {
      evidence: "incomplete",
      detail: { kind: "knowledge_blocked", count: Math.max(1, readiness.blockerCount) },
    };
  }
  if (readiness.status === "READY" || readiness.status === "READY_WITH_WARNINGS") {
    return { evidence: "complete", detail: { kind: "knowledge_complete" } };
  }
  return { evidence: "needs_check", detail: { kind: "needs_check" } };
}

function testAssessment(
  knowledge: DataCheck<KnowledgeV2OverviewView>,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  if (knowledge.state === "unavailable") {
    return { evidence: "needs_check", detail: { kind: "needs_check" } };
  }

  const requirements = knowledge.value.readiness.draft.capabilities.flatMap((capability) =>
    capability.enabled
      ? capability.requirements.filter((requirement) => requirement.kind === "EVALUATION_CASE")
      : [],
  );
  if (requirements.length === 0) {
    return { evidence: "needs_check", detail: { kind: "needs_check" } };
  }

  const complete =
    requirements.some((requirement) => requirement.status === "SATISFIED") &&
    requirements.every(
      (requirement) =>
        requirement.status === "SATISFIED" || requirement.status === "NOT_APPLICABLE",
    );
  return complete
    ? { evidence: "complete", detail: { kind: "test_complete" } }
    : { evidence: "incomplete", detail: { kind: "test_incomplete" } };
}

function publicationAssessment(
  knowledge: DataCheck<KnowledgeV2OverviewView>,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  if (knowledge.state === "unavailable") {
    return { evidence: "needs_check", detail: { kind: "needs_check" } };
  }
  const { activePublication, readiness } = knowledge.value;
  const active =
    (activePublication?.isActive && activePublication.status === "ACTIVE") ||
    (readiness.serving.status === "READY" && Boolean(readiness.activePublicationId));
  const latestChangesPublished = readiness.draft.status === "UP_TO_DATE";
  return active && latestChangesPublished
    ? { evidence: "complete", detail: { kind: "publish_complete" } }
    : { evidence: "incomplete", detail: { kind: "publish_incomplete" } };
}

function connectedChannelAssessment(
  channels: DataCheck<Channel[]>,
  integrations: DataCheck<IntegrationAccount[]>,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  const channelConnected =
    channels.state === "available" && channels.value.some(isConnectedChannel);
  const integrationConnected =
    integrations.state === "available" &&
    integrations.value.some(isConnectedCustomerIntegration);
  if (channelConnected || integrationConnected) {
    return { evidence: "complete", detail: { kind: "channel_complete" } };
  }
  if (channels.state === "available" && integrations.state === "available") {
    return { evidence: "incomplete", detail: { kind: "channel_incomplete" } };
  }
  return { evidence: "needs_check", detail: { kind: "needs_check" } };
}

function repliesAssessment(
  replies: ReplyReadinessCheck,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  if (replies.values.some((item) => item.enabled && item.status === "ACTIVE")) {
    return { evidence: "complete", detail: { kind: "replies_complete" } };
  }
  if (replies.state === "available" && replies.verifiedAll) {
    return { evidence: "incomplete", detail: { kind: "replies_incomplete" } };
  }
  return { evidence: "needs_check", detail: { kind: "needs_check" } };
}

function inboundAssessment(
  integrations: DataCheck<IntegrationAccount[]>,
): Pick<DashboardReadinessStep, "evidence" | "detail"> {
  if (integrations.state === "unavailable") {
    return { evidence: "needs_check", detail: { kind: "needs_check" } };
  }
  const successfulInbound = integrations.value.some((integration) => {
    if (!isConnectedCustomerIntegration(integration)) return false;
    return Boolean(
      integration.recentSyncLogs?.some(
        (log) => log.action === "sample_inbound" && log.status.toUpperCase() === "SUCCESS",
      ) ||
        integration.recentWebhookEvents?.some(
          (event) => Boolean(event.processedAt) && !event.errorMessage,
        ),
    );
  });
  return successfulInbound
    ? { evidence: "complete", detail: { kind: "inbound_complete" } }
    : { evidence: "incomplete", detail: { kind: "inbound_incomplete" } };
}

function inboundHref(snapshot: DashboardReadinessSnapshot) {
  if (
    snapshot.channels.state === "available" &&
    snapshot.channels.value.some(
      (channel) => channel.status === "ACTIVE" && channel.type === "WEBSITE",
    ) &&
    !snapshot.channels.value.some(
      (channel) =>
        channel.status === "ACTIVE" && (channel.type === "TELEGRAM" || channel.type === "WEBHOOK"),
    )
  ) {
    return "/app/settings?tab=channels";
  }
  return "/app/integrations";
}

export function deriveDashboardReadiness(
  snapshot: DashboardReadinessSnapshot,
): DashboardReadinessModel {
  const assessed = [
    {
      id: "profile" as const,
      href: "/app/knowledge?view=business",
      ...profileAssessment(snapshot.profile),
    },
    {
      id: "knowledge" as const,
      href:
        snapshot.knowledge.state === "available" &&
        snapshot.knowledge.value.readiness.needsReviewCount > 0
          ? "/app/knowledge?view=review"
          : "/app/knowledge?view=overview",
      ...knowledgeAssessment(snapshot.knowledge),
    },
    {
      id: "test" as const,
      href: "/app/knowledge?view=test",
      ...testAssessment(snapshot.knowledge),
    },
    {
      id: "publish" as const,
      href: "/app/knowledge?view=history",
      ...publicationAssessment(snapshot.knowledge),
    },
    {
      id: "channel" as const,
      href: "/app/integrations",
      ...connectedChannelAssessment(snapshot.channels, snapshot.integrations),
    },
    {
      id: "replies" as const,
      href: "/app/settings?tab=channels",
      ...repliesAssessment(snapshot.automaticReplies),
    },
    {
      id: "inbound" as const,
      href: inboundHref(snapshot),
      ...inboundAssessment(snapshot.integrations),
    },
  ];

  const primaryIndex = assessed.findIndex((step) => step.evidence !== "complete");
  const steps = assessed.map<DashboardReadinessStep>((step, index) => ({
    ...step,
    state:
      step.evidence === "complete" ? "completed" : index === primaryIndex ? "current" : "blocked",
  }));
  const completedCount = steps.filter((step) => step.state === "completed").length;
  const isReady = primaryIndex === -1;

  return {
    steps,
    completedCount,
    isReady,
    primaryStepId: isReady ? null : (steps[primaryIndex]?.id ?? null),
    primaryHref: isReady ? "/app/inbox" : (steps[primaryIndex]?.href ?? "/app"),
  };
}
