"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CheckCircle2,
  Clock3,
  FileWarning,
  ListChecks,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  KnowledgeV2CapabilityAutonomy,
  KnowledgeV2CapabilityReadinessView,
  KnowledgeV2CapabilityType,
  KnowledgeV2CapabilityView,
  KnowledgeV2JobStatus,
  KnowledgeV2OverviewView,
  KnowledgeV2ReadinessStatus,
  KnowledgeV2ReadinessRequirementView,
  KnowledgeV2RequirementKind,
  KnowledgeV2RequirementReasonCode,
} from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import { getBusinessProfile } from "@/lib/api/business-profile";
import {
  applyKnowledgeV2CapabilityStarterPreset,
  createKnowledgeV2IdempotencyKey,
  getKnowledgeV2Capabilities,
  updateKnowledgeV2Capability,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { Card } from "../shared";
import { ConfirmDialog, Select, StatusBadge } from "../ui";
import type { KnowledgeNavigationTarget, KnowledgeViewId } from "./knowledge-views";
import { findKnowledgeDataElement } from "./knowledge-dom";
import {
  groupKnowledgePublicationGates,
  knowledgeGateGroupCopy,
  type KnowledgeGateGroup,
} from "./knowledge-publication-gates";

const readinessLabelKeys: Record<KnowledgeV2ReadinessStatus, TranslationKey> = {
  READY: "knowledge.status.readiness.ready",
  READY_WITH_WARNINGS: "knowledge.status.readiness.readyWithWarnings",
  NEEDS_REVIEW: "knowledge.status.readiness.needsReview",
  BLOCKED: "knowledge.status.readiness.blocked",
  UPDATING: "knowledge.status.readiness.updating",
};

const jobStatusKeys: Record<KnowledgeV2JobStatus, TranslationKey> = {
  QUEUED: "knowledge.status.job.queued",
  RUNNING: "knowledge.status.job.running",
  RETRY_SCHEDULED: "knowledge.status.job.retryScheduled",
  SUCCEEDED: "knowledge.status.job.succeeded",
  FAILED: "knowledge.status.job.failed",
  CANCELLED: "knowledge.status.job.cancelled",
  DEAD_LETTER: "knowledge.status.job.deadLetter",
};

type DraftStatus = KnowledgeV2OverviewView["readiness"]["draft"]["status"];

const draftStatusKeys: Record<DraftStatus, TranslationKey> = {
  UP_TO_DATE: "knowledge.status.draft.upToDate",
  CHANGES_PENDING: "knowledge.status.draft.changesPending",
  PROCESSING: "knowledge.status.draft.processing",
  FAILED: "knowledge.status.draft.failed",
};

const capabilityNameKeys: Record<KnowledgeV2CapabilityType, TranslationKey> = {
  GENERAL_FAQ: "knowledge.capability.type.generalFaq",
  LEAD_QUALIFICATION: "knowledge.capability.type.leadQualification",
  PRICING: "knowledge.capability.type.pricing",
  APPOINTMENT_DISCOVERY: "knowledge.capability.type.appointmentDiscovery",
  APPOINTMENT_BOOKING: "knowledge.capability.type.appointmentBooking",
  ORDER_ACCOUNT_SUPPORT: "knowledge.capability.type.orderAccountSupport",
  COMMERCE_RECOMMENDATION: "knowledge.capability.type.commerceRecommendation",
  REGULATED_TOPIC: "knowledge.capability.type.regulatedTopic",
};

const capabilityRequirementLabelKeys: Partial<Record<string, TranslationKey>> = {
  business_identity: "knowledge.capability.requirement.business_identity",
  contact_route: "knowledge.capability.requirement.contact_route",
  approved_knowledge: "knowledge.capability.requirement.approved_knowledge",
  escalation_route: "knowledge.capability.requirement.escalation_route",
  supported_locales: "knowledge.capability.requirement.supported_locales",
  qualification_fields: "knowledge.capability.requirement.qualification_fields",
  disqualifier_rules: "knowledge.capability.requirement.disqualifier_rules",
  collection_consent: "knowledge.capability.requirement.collection_consent",
  routing_rules: "knowledge.capability.requirement.routing_rules",
  structured_price: "knowledge.capability.requirement.structured_price",
  pricing_conditions: "knowledge.capability.requirement.pricing_conditions",
  quote_policy: "knowledge.capability.requirement.quote_policy",
  dynamic_quote_tool: "knowledge.capability.requirement.dynamic_quote_tool",
  service_details: "knowledge.capability.requirement.service_details",
  business_hours: "knowledge.capability.requirement.business_hours",
  booking_policy: "knowledge.capability.requirement.booking_policy",
  calendar_connector: "knowledge.capability.requirement.calendar_connector",
  availability_tool: "knowledge.capability.requirement.availability_tool",
  booking_constraints: "knowledge.capability.requirement.booking_constraints",
  confirmation_rule: "knowledge.capability.requirement.confirmation_rule",
  booking_tool: "knowledge.capability.requirement.booking_tool",
  booking_permission: "knowledge.capability.requirement.booking_permission",
  booking_safety_cases: "knowledge.capability.requirement.booking_safety_cases",
  support_policy: "knowledge.capability.requirement.support_policy",
  account_lookup_tool: "knowledge.capability.requirement.account_lookup_tool",
  customer_state_permission: "knowledge.capability.requirement.customer_state_permission",
  identity_verification_cases: "knowledge.capability.requirement.identity_verification_cases",
  product_attributes: "knowledge.capability.requirement.product_attributes",
  commerce_policies: "knowledge.capability.requirement.commerce_policies",
  inventory_tool: "knowledge.capability.requirement.inventory_tool",
  catalog_connector: "knowledge.capability.requirement.catalog_connector",
  approved_wording: "knowledge.capability.requirement.approved_wording",
  regulated_rules: "knowledge.capability.requirement.regulated_rules",
  specialist_permission: "knowledge.capability.requirement.specialist_permission",
  regulated_safety_cases: "knowledge.capability.requirement.regulated_safety_cases",
};

const capabilityRequirementKindKeys: Record<KnowledgeV2RequirementKind, TranslationKey> = {
  FACT: "knowledge.capability.kind.fact",
  RULE: "knowledge.capability.kind.rule",
  DOCUMENT_COVERAGE: "knowledge.capability.kind.document",
  CONNECTOR: "knowledge.capability.kind.connector",
  TOOL: "knowledge.capability.kind.tool",
  PERMISSION: "knowledge.capability.kind.permission",
  LOCALE: "knowledge.capability.kind.locale",
  EVALUATION_CASE: "knowledge.capability.kind.evaluation",
};

const capabilityRequirementReasonKeys: Record<KnowledgeV2RequirementReasonCode, TranslationKey> = {
  SATISFIED: "knowledge.capability.reason.satisfied",
  CAPABILITY_DISABLED: "knowledge.capability.reason.disabled",
  REQUIREMENT_INACTIVE: "knowledge.capability.reason.inactive",
  INVALID_DEFINITION: "knowledge.capability.reason.invalid",
  INVALID_PREDICATE: "knowledge.capability.reason.invalid",
  ACTIVE_CONFLICT: "knowledge.capability.reason.conflict",
  EVIDENCE_STALE: "knowledge.capability.reason.stale",
  EVIDENCE_MISSING: "knowledge.capability.reason.missing",
  THRESHOLD_NOT_MET: "knowledge.capability.reason.threshold",
  SCOPE_NOT_COVERED: "knowledge.capability.reason.scope",
  LOCALE_NOT_COVERED: "knowledge.capability.reason.locale",
  LOCALE_CONTEXT_MISSING: "knowledge.capability.reason.localeContext",
};

const autonomyLabelKeys: Record<KnowledgeV2CapabilityAutonomy, TranslationKey> = {
  ANSWER_ONLY: "knowledge.capability.autonomy.answerOnly",
  COLLECT_INFORMATION: "knowledge.capability.autonomy.collectInformation",
  PROPOSE_ACTION: "knowledge.capability.autonomy.proposeAction",
  ACT_WITH_CONFIRMATION: "knowledge.capability.autonomy.actWithConfirmation",
  AUTONOMOUS_ACTION: "knowledge.capability.autonomy.autonomousAction",
};

const configurableAutonomyValues = [
  "ANSWER_ONLY",
  "COLLECT_INFORMATION",
  "PROPOSE_ACTION",
] as const satisfies readonly KnowledgeV2CapabilityAutonomy[];

const quickStartCapabilityTypes = [
  "GENERAL_FAQ",
  "PRICING",
  "APPOINTMENT_DISCOVERY",
  "COMMERCE_RECOMMENDATION",
] as const satisfies readonly KnowledgeV2CapabilityType[];

const advancedCapabilityTypes = [
  "LEAD_QUALIFICATION",
  "APPOINTMENT_BOOKING",
  "ORDER_ACCOUNT_SUPPORT",
  "REGULATED_TOPIC",
] as const satisfies readonly KnowledgeV2CapabilityType[];

const autonomyOptions = configurableAutonomyValues.map(
  (value) => [value, autonomyLabelKeys[value]] as const,
);

type CapabilitySaveState = {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
};

function statusTone(status: KnowledgeV2ReadinessStatus) {
  if (status === "READY") return "success" as const;
  if (status === "BLOCKED") return "error" as const;
  if (status === "READY_WITH_WARNINGS" || status === "NEEDS_REVIEW") return "warning" as const;
  return "info" as const;
}

function jobTone(status: KnowledgeV2JobStatus) {
  if (status === "SUCCEEDED") return "success" as const;
  if (status === "FAILED" || status === "DEAD_LETTER") return "error" as const;
  if (status === "RETRY_SCHEDULED") return "warning" as const;
  return "info" as const;
}

export function KnowledgeOverview({
  overview,
  onNavigate,
  onRefresh,
}: {
  overview: KnowledgeV2OverviewView;
  onNavigate: (target: KnowledgeViewId | KnowledgeNavigationTarget) => void;
  onRefresh: () => void;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const searchParams = useSearchParams();
  const focusedCapabilityId = searchParams.get("capabilityId");
  const [expandedCapabilityId, setExpandedCapabilityId] = React.useState<string | null>(
    focusedCapabilityId,
  );
  const [expandedGateKey, setExpandedGateKey] = React.useState<string | null>(null);
  const expandedGateDetailsRef = React.useRef<HTMLDivElement>(null);
  const { readiness } = overview;
  const firstLaunch = !readiness.serving.activePublicationSequence;
  const gates = [...readiness.draft.blockers, ...readiness.draft.warnings];
  const gateGroups = groupKnowledgePublicationGates(gates);
  const blockerGroups = gateGroups.filter((group) => group.status === "BLOCKED");
  const warningGroups = gateGroups.filter((group) => group.status !== "BLOCKED");
  const firstBlockerGroup = blockerGroups[0] ?? null;
  const canManageCapabilities = overview.permissions.canManageSettings;
  const [capabilitySettings, setCapabilitySettings] = React.useState<KnowledgeV2CapabilityView[]>(
    [],
  );
  const [starterPresetApplied, setStarterPresetApplied] = React.useState<boolean | null>(null);
  const [businessName, setBusinessName] = React.useState<string | null>(null);
  const [businessDescription, setBusinessDescription] = React.useState<string | null>(null);
  const [businessProfileLoading, setBusinessProfileLoading] = React.useState(firstLaunch);
  const [capabilityStates, setCapabilityStates] = React.useState<
    Partial<Record<KnowledgeV2CapabilityType, CapabilitySaveState>>
  >({});
  const [capabilityLoading, setCapabilityLoading] = React.useState(true);
  const [capabilityLoadError, setCapabilityLoadError] = React.useState<string | null>(null);
  const [quickStartConfirmOpen, setQuickStartConfirmOpen] = React.useState(false);
  const [quickStartApplying, setQuickStartApplying] = React.useState(false);
  const [quickStartError, setQuickStartError] = React.useState<string | null>(null);
  const [advancedCapabilitiesOpen, setAdvancedCapabilitiesOpen] = React.useState(false);
  const [capabilityEditorOpen, setCapabilityEditorOpen] = React.useState(false);
  const capabilityLoadSequence = React.useRef(0);
  const quickStartAttemptKey = React.useRef<string | null>(null);

  const loadCapabilities = React.useCallback(async () => {
    const sequence = ++capabilityLoadSequence.current;
    setCapabilityLoading(true);
    setCapabilityLoadError(null);
    try {
      const response = await getKnowledgeV2Capabilities();
      if (sequence !== capabilityLoadSequence.current) return null;
      setCapabilitySettings(response.items);
      setStarterPresetApplied(response.starterPreset.applied);
      setCapabilityStates({});
      return { applied: response.starterPreset.applied };
    } catch {
      if (sequence !== capabilityLoadSequence.current) return null;
      setCapabilityLoadError(t("knowledge.capability.loadError"));
      return null;
    } finally {
      if (sequence === capabilityLoadSequence.current) setCapabilityLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void loadCapabilities();
    return () => {
      capabilityLoadSequence.current += 1;
    };
  }, [loadCapabilities]);

  React.useEffect(() => {
    if (!firstLaunch) {
      setBusinessProfileLoading(false);
      return;
    }
    let cancelled = false;
    setBusinessProfileLoading(true);
    void getBusinessProfile()
      .then((profile) => {
        if (!cancelled) {
          setBusinessName(profile.profile.name);
          setBusinessDescription(profile.profile.description);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBusinessName("");
          setBusinessDescription("");
        }
      })
      .finally(() => {
        if (!cancelled) setBusinessProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firstLaunch]);

  React.useEffect(() => {
    if (!focusedCapabilityId || capabilityLoading) return;
    if (firstLaunch) setCapabilityEditorOpen(true);
    const focusedCapability = readiness.draft.capabilities.find(
      (capability) => capability.capabilityId === focusedCapabilityId,
    );
    if (
      focusedCapability &&
      advancedCapabilityTypes.includes(
        focusedCapability.capabilityType as (typeof advancedCapabilityTypes)[number],
      )
    ) {
      setAdvancedCapabilitiesOpen(true);
    }
    setExpandedCapabilityId(focusedCapabilityId);
    const target = findKnowledgeDataElement("data-capability-id", focusedCapabilityId);
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.focus();
    });
  }, [capabilityLoading, firstLaunch, focusedCapabilityId, readiness.draft.capabilities]);

  const capabilitySaving = Object.values(capabilityStates).some(
    (state) => state?.status === "saving",
  );
  const quickStartApplied = starterPresetApplied === true;
  const starterCapabilities = readiness.draft.capabilities.filter((capability) =>
    quickStartCapabilityTypes.includes(
      capability.capabilityType as (typeof quickStartCapabilityTypes)[number],
    ),
  );
  const advancedCapabilities = readiness.draft.capabilities.filter((capability) =>
    advancedCapabilityTypes.includes(
      capability.capabilityType as (typeof advancedCapabilityTypes)[number],
    ),
  );
  const starterBlockerCount = starterCapabilities.reduce(
    (total, capability) =>
      total + Math.max(capability.blockerCount, capability.status === "BLOCKED" ? 1 : 0),
    0,
  );
  const enabledAdvancedCount = advancedCapabilities.filter((capability) => {
    const setting = capabilitySettings.find(
      (item) => item.capabilityType === capability.capabilityType,
    );
    return setting?.enabled ?? capability.enabled;
  }).length;
  const businessIdentityRequirement = starterCapabilities
    .find((capability) => capability.capabilityType === "GENERAL_FAQ")
    ?.requirements.find((requirement) => requirement.id === "business_identity");
  const approvedKnowledgeRequirement = starterCapabilities
    .find((capability) => capability.capabilityType === "GENERAL_FAQ")
    ?.requirements.find((requirement) => requirement.id === "approved_knowledge");
  const hasBusinessName = businessIdentityRequirement
    ? businessIdentityRequirement.status === "SATISFIED"
    : Boolean(businessName?.trim());
  const hasUsefulContext =
    Boolean(businessDescription?.trim()) ||
    approvedKnowledgeRequirement?.status === "SATISFIED" ||
    readiness.draft.itemCounts.documentRevisions > 0;
  const needsOwnerCompletion = !canManageCapabilities || !overview.permissions.canPublish;

  React.useEffect(() => {
    if (!expandedGateKey) return;
    window.requestAnimationFrame(() => {
      expandedGateDetailsRef.current?.scrollIntoView({ block: "center" });
      expandedGateDetailsRef.current?.focus();
    });
  }, [expandedGateKey]);

  function openGateGroup(group: KnowledgeGateGroup) {
    if (group.target) {
      onNavigate(group.target);
      return;
    }
    setExpandedGateKey((current) => (current === group.key ? null : group.key));
  }

  async function saveCapability(
    capabilityType: KnowledgeV2CapabilityType,
    update: { enabled?: boolean; allowedAutonomy?: KnowledgeV2CapabilityAutonomy },
  ) {
    const current = capabilitySettings.find((item) => item.capabilityType === capabilityType);
    const state = capabilityStates[capabilityType];
    if (!canManageCapabilities || !current || state?.status === "saving") return;

    setCapabilityStates((states) => ({
      ...states,
      [capabilityType]: { status: "saving", error: null },
    }));
    try {
      const response = await updateKnowledgeV2Capability(capabilityType, update, {
        "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        "If-Match": current.etag,
      });
      setCapabilitySettings((items) =>
        items.map((item) =>
          item.capabilityType === capabilityType ? response.data.resource : item,
        ),
      );
      setCapabilityStates((states) => ({
        ...states,
        [capabilityType]: { status: "saved", error: null },
      }));
      onRefresh();
      void loadCapabilities();
    } catch (caught) {
      const error =
        caught instanceof ApiClientError && caught.status === 412
          ? t("knowledge.capability.saveConflict")
          : t("knowledge.capability.saveError");
      setCapabilityStates((states) => ({
        ...states,
        [capabilityType]: { status: "error", error },
      }));
    }
  }

  async function applyQuickStart() {
    if (!canManageCapabilities || capabilityLoading || quickStartApplying) return false;
    if (quickStartApplied) {
      setQuickStartError(null);
      return true;
    }

    setQuickStartApplying(true);
    setQuickStartError(null);
    try {
      quickStartAttemptKey.current ??= createKnowledgeV2IdempotencyKey();
      await applyKnowledgeV2CapabilityStarterPreset(quickStartAttemptKey.current);
      quickStartAttemptKey.current = null;
      const reconciled = await loadCapabilities();
      onRefresh();
      if (reconciled?.applied) {
        onNavigate({ view: "history", task: "first-launch" });
        return true;
      }
      setQuickStartError(t("knowledge.quickStart.applyError"));
      return false;
    } catch {
      const reconciled = await loadCapabilities();
      if (reconciled) quickStartAttemptKey.current = null;
      onRefresh();
      if (reconciled?.applied) {
        onNavigate({ view: "history", task: "first-launch" });
        return true;
      }
      setQuickStartError(t("knowledge.quickStart.applyError"));
      return false;
    } finally {
      setQuickStartApplying(false);
    }
  }

  function openStarterBlockers() {
    if (firstLaunch) setCapabilityEditorOpen(true);
    const blockedCapability = starterCapabilities.find(
      (capability) => capability.blockerCount > 0 || capability.status === "BLOCKED",
    );
    if (blockedCapability) {
      setExpandedCapabilityId(blockedCapability.capabilityId);
      window.requestAnimationFrame(() => {
        findKnowledgeDataElement(
          "data-capability-id",
          blockedCapability.capabilityId,
        )?.scrollIntoView({ block: "center" });
      });
      return;
    }
    if (firstBlockerGroup) openGateGroup(firstBlockerGroup);
  }

  function renderCapabilityRow(capability: KnowledgeV2CapabilityReadinessView) {
    const setting = capabilitySettings.find(
      (item) => item.capabilityType === capability.capabilityType,
    );
    return (
      <CapabilityDraftRow
        key={capability.capabilityId}
        capability={capability}
        setting={setting}
        canManage={canManageCapabilities}
        controlsLoading={capabilityLoading || quickStartApplying || Boolean(capabilityLoadError)}
        saveState={capabilityStates[capability.capabilityType]}
        focused={focusedCapabilityId === capability.capabilityId}
        expanded={expandedCapabilityId === capability.capabilityId}
        onExpandedChange={(expanded) =>
          setExpandedCapabilityId(expanded ? capability.capabilityId : null)
        }
        onNavigate={onNavigate}
        onEnabledChange={(enabled) => void saveCapability(capability.capabilityType, { enabled })}
        onAutonomyChange={(allowedAutonomy) =>
          void saveCapability(capability.capabilityType, { allowedAutonomy })
        }
        onReload={() => void loadCapabilities()}
      />
    );
  }

  function renderCapabilityRows() {
    return (
      <>
        {capabilityLoadError ? (
          <div className="flex items-center gap-3 border-b border-white/5 px-5 py-3" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <p className="min-w-0 flex-1 text-xs text-amber-300">{capabilityLoadError}</p>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("knowledge.capability.reload")}
              onClick={() => void loadCapabilities()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
        {readiness.draft.capabilities.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-zinc-500">
            {t("knowledge.overview.noCapabilities")}
          </div>
        ) : (
          <>
            <div data-testid="knowledge-starter-capabilities">
              {starterCapabilities.map(renderCapabilityRow)}
            </div>
            {advancedCapabilities.length > 0 ? (
              <details
                open={advancedCapabilitiesOpen}
                onToggle={(event) => setAdvancedCapabilitiesOpen(event.currentTarget.open)}
                className="group border-t border-white/10"
                data-testid="knowledge-advanced-capabilities"
              >
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/50">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-200">
                        {t("knowledge.quickStart.advanced.title")}
                      </span>
                      {enabledAdvancedCount > 0 ? (
                        <StatusBadge status="warning">
                          {t("knowledge.quickStart.advanced.enabled", {
                            count: formatNumber(enabledAdvancedCount),
                          })}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {t("knowledge.quickStart.advanced.description")}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-white/10">
                  {advancedCapabilities.map(renderCapabilityRow)}
                </div>
              </details>
            ) : null}
          </>
        )}
      </>
    );
  }

  function renderGateGroup(group: KnowledgeGateGroup) {
    const copy = knowledgeGateGroupCopy(group, t, formatNumber);
    const expanded = !group.target && expandedGateKey === group.key;
    return (
      <div key={group.key}>
        <button
          type="button"
          className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 sm:flex-row sm:items-center"
          onClick={() => openGateGroup(group)}
          aria-expanded={group.target ? undefined : expanded}
          data-testid={`knowledge-gate-${group.gates[0]?.code ?? "unknown"}`}
        >
          {group.status === "BLOCKED" ? (
            <FileWarning className="h-4 w-4 shrink-0 text-rose-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-200">{copy.title}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{copy.description}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-400">
            {t(group.target ? "knowledge.ux.attention.open" : "knowledge.ux.attention.details")}
            <ArrowRight
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
            />
          </span>
        </button>
        {expanded ? (
          <div
            ref={expandedGateDetailsRef}
            tabIndex={-1}
            className="mx-3 border-x border-b border-amber-500/20 bg-amber-500/[0.05] px-4 py-3"
            data-testid="knowledge-gate-in-place-details"
          >
            <p className="text-sm font-medium text-amber-200">
              {t("knowledge.ux.gate.unknownDetailsTitle")}
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-100/70">
              {t("knowledge.ux.gate.unknownDetailsDescription")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("knowledge.page.refresh")}
              </Button>
              <span className="break-all text-xs text-zinc-600">
                {t("knowledge.ux.gate.reference", {
                  code: group.gates[0]?.code ?? "UNKNOWN",
                })}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="knowledge-overview">
      {firstLaunch ? (
        <section
          className="min-w-0 border-y border-emerald-500/25 bg-emerald-500/[0.055]"
          data-testid="knowledge-quick-start"
        >
          <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-100">
                    {t("knowledge.quickStart.title")}
                  </h2>
                  <StatusBadge status="success">{t("knowledge.quickStart.badge")}</StatusBadge>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                  {t("knowledge.quickStart.description")}
                </p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">
                  {t("knowledge.quickStart.safety")}
                </p>
              </div>
            </div>
          </div>

          <div className="grid border-t border-white/10 lg:grid-cols-3 lg:divide-x lg:divide-white/10">
            <div className="flex min-w-0 gap-3 border-b border-white/10 px-4 py-4 lg:border-b-0 sm:px-5">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  hasBusinessName
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/15 bg-white/5 text-zinc-300",
                )}
              >
                {hasBusinessName ? <CheckCircle2 className="h-4 w-4" /> : "1"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">
                  {t("knowledge.quickStart.step.business")}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {t("knowledge.quickStart.step.businessDescription")}
                </p>
                {!hasBusinessName ? (
                  <Button
                    className="mt-3 min-h-11"
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigate("business")}
                  >
                    {t("knowledge.quickStart.action.business")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <p className="mt-2 text-xs font-medium text-emerald-300">
                    {t("knowledge.quickStart.complete")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex min-w-0 gap-3 border-b border-white/10 px-4 py-4 lg:border-b-0 sm:px-5">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  hasUsefulContext
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/15 bg-white/5 text-zinc-300",
                )}
              >
                {hasUsefulContext ? <CheckCircle2 className="h-4 w-4" /> : "2"}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-100">
                    {t("knowledge.quickStart.step.context")}
                  </p>
                  <span className="text-xs text-zinc-600">
                    {t(
                      hasUsefulContext
                        ? "knowledge.quickStart.contextComplete"
                        : "knowledge.quickStart.required",
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {t("knowledge.quickStart.step.contextDescription")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigate("sources")}
                  >
                    {t("knowledge.quickStart.action.website")}
                  </Button>
                  <Button
                    className="min-h-11"
                    size="sm"
                    variant="ghost"
                    onClick={() => onNavigate("business")}
                  >
                    {t("knowledge.quickStart.action.priceList")}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex min-w-0 gap-3 px-4 py-4 sm:px-5">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  quickStartApplied
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/15 bg-white/5 text-zinc-300",
                )}
              >
                {quickStartApplied ? <CheckCircle2 className="h-4 w-4" /> : "3"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">
                  {t("knowledge.quickStart.step.activate")}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {t("knowledge.quickStart.step.activateDescription")}
                </p>
                {quickStartApplied ? (
                  <p className="mt-2 text-xs font-medium text-emerald-300">
                    {t("knowledge.quickStart.applied")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 border-t border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              {needsOwnerCompletion ? (
                <p
                  className="text-sm text-amber-300"
                  data-testid="knowledge-quick-start-permission"
                >
                  {t("knowledge.quickStart.permission")}
                </p>
              ) : quickStartError ? (
                <p className="text-sm text-rose-300" role="alert">
                  {quickStartError}
                </p>
              ) : (
                <p className="text-xs leading-5 text-zinc-500">
                  {t("knowledge.quickStart.reversible")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              {quickStartApplied ? (
                <Button size="sm" variant="outline" onClick={() => onNavigate("test")}>
                  <MessageSquareText className="h-4 w-4" />
                  {t("knowledge.quickStart.action.test")}
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={
                  capabilityLoading ||
                  businessProfileLoading ||
                  quickStartApplying ||
                  (hasBusinessName && hasUsefulContext && needsOwnerCompletion)
                }
                onClick={() => {
                  if (!hasBusinessName) {
                    onNavigate("business");
                  } else if (!hasUsefulContext) {
                    onNavigate("business");
                  } else if (!quickStartApplied) {
                    setQuickStartConfirmOpen(true);
                  } else if (starterBlockerCount > 0) {
                    openStarterBlockers();
                  } else {
                    onNavigate({ view: "history", task: "first-launch" });
                  }
                }}
                data-testid="knowledge-quick-start-primary"
              >
                {quickStartApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t(
                  !hasBusinessName
                    ? "knowledge.quickStart.action.business"
                    : !hasUsefulContext
                      ? "knowledge.quickStart.action.context"
                      : needsOwnerCompletion
                        ? "knowledge.quickStart.action.ownerRequired"
                        : !quickStartApplied
                          ? "knowledge.quickStart.action.apply"
                          : starterBlockerCount > 0
                            ? "knowledge.quickStart.action.review"
                            : "knowledge.quickStart.action.publish",
                  starterBlockerCount > 0
                    ? { count: formatNumber(starterBlockerCount) }
                    : undefined,
                )}
                {!quickStartApplying ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <section
          className={cn(
            "flex min-w-0 flex-col gap-4 border-y px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5",
            firstBlockerGroup
              ? "border-amber-500/25 bg-amber-500/[0.06]"
              : "border-emerald-500/25 bg-emerald-500/[0.06]",
          )}
          data-testid="knowledge-next-action"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
                firstBlockerGroup
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
              )}
            >
              {firstBlockerGroup ? (
                <ListChecks className="h-5 w-5" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-100">
                {firstBlockerGroup
                  ? t("knowledge.ux.next.blockedTitle", {
                      count: formatNumber(blockerGroups.length),
                    })
                  : t("knowledge.ux.next.readyTitle")}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                {t(
                  firstBlockerGroup
                    ? "knowledge.ux.next.blockedDescription"
                    : "knowledge.ux.next.readyDescription",
                )}
              </p>
            </div>
          </div>
          <Button
            className="shrink-0"
            onClick={() =>
              firstBlockerGroup ? openGateGroup(firstBlockerGroup) : onNavigate("history")
            }
          >
            {t(
              firstBlockerGroup ? "knowledge.ux.next.fixAction" : "knowledge.ux.next.publishAction",
            )}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      )}

      {!firstLaunch ? (
        <section
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 xl:grid-cols-4"
          data-testid="knowledge-overview-metrics"
        >
          <Metric
            label={t("knowledge.overview.metric.facts")}
            value={formatNumber(overview.counts.facts)}
          />
          <Metric
            label={t("knowledge.overview.metric.rules")}
            value={formatNumber(overview.counts.guidanceRules)}
          />
          <Metric
            label={t("knowledge.overview.metric.review")}
            value={formatNumber(overview.counts.reviewItems)}
            attention={overview.counts.reviewItems > 0}
          />
          <Metric
            label={t("knowledge.overview.metric.failed")}
            value={formatNumber(overview.counts.failedJobs)}
            attention={overview.counts.failedJobs > 0}
          />
        </section>
      ) : null}

      {!firstLaunch ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <Card className="min-w-0 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  {t("knowledge.overview.servingEyebrow")}
                </p>
                <h2 className="mt-1 text-base font-semibold text-zinc-100">
                  {t(
                    readiness.serving.status === "READY"
                      ? "knowledge.overview.servingActive"
                      : "knowledge.overview.servingEmpty",
                  )}
                </h2>
              </div>
              <StatusBadge status={readiness.serving.status === "READY" ? "success" : "warning"}>
                {t(
                  readiness.serving.status === "READY"
                    ? "knowledge.status.serving.ready"
                    : "knowledge.status.serving.notReady",
                )}
              </StatusBadge>
            </div>
            <p className="mt-4 text-sm text-zinc-400">
              {readiness.serving.activePublicationSequence
                ? t("knowledge.overview.servingActiveDescription", {
                    sequence: formatNumber(readiness.serving.activePublicationSequence),
                  })
                : t("knowledge.overview.servingEmptyDescription")}
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500">
              <span>
                {t("knowledge.common.facts", {
                  count: formatNumber(readiness.serving.itemCounts.factVersions),
                })}
              </span>
              <span>
                {t("knowledge.common.rules", {
                  count: formatNumber(readiness.serving.itemCounts.guidanceRuleVersions),
                })}
              </span>
              <span>
                {t("knowledge.common.documents", {
                  count: formatNumber(readiness.serving.itemCounts.documentRevisions),
                })}
              </span>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs font-medium text-zinc-400">
                {t("knowledge.capability.servingTitle")}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {t("knowledge.capability.servingDescription")}
              </p>
              {readiness.serving.capabilities.filter((capability) => capability.enabled).length >
              0 ? (
                <ul
                  className="mt-3 divide-y divide-white/5"
                  data-testid="knowledge-serving-capabilities"
                >
                  {readiness.serving.capabilities
                    .filter((capability) => capability.enabled)
                    .map((capability) => (
                      <li
                        key={capability.capabilityId}
                        className="flex min-w-0 items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                      >
                        <span className="truncate text-xs font-medium text-zinc-300">
                          {t(capabilityNameKeys[capability.capabilityType])}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-600">
                          {t(autonomyLabelKeys[capability.allowedAutonomy])}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-zinc-600">
                  {t("knowledge.capability.servingEmpty")}
                </p>
              )}
            </div>
          </Card>

          <Card className="min-w-0 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  {t("knowledge.ux.draft.title")}
                </p>
                <h2 className="mt-1 text-base font-semibold text-zinc-100">
                  {t("knowledge.overview.draftVersion", {
                    version: formatNumber(readiness.draft.candidateVersion),
                  })}
                </h2>
              </div>
              <StatusBadge
                status={
                  readiness.draft.status === "UP_TO_DATE"
                    ? "success"
                    : readiness.draft.status === "FAILED"
                      ? "error"
                      : "info"
                }
              >
                {t(draftStatusKeys[readiness.draft.status])}
              </StatusBadge>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {readiness.serving.activePublicationSequence
                ? t("knowledge.ux.draft.descriptionActive", {
                    sequence: formatNumber(readiness.serving.activePublicationSequence),
                  })
                : t("knowledge.ux.draft.descriptionEmpty")}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              {blockerGroups.length > 0
                ? t("knowledge.overview.draftBlocked", {
                    count: formatNumber(blockerGroups.length),
                  })
                : readiness.draft.warnings.length > 0
                  ? t("knowledge.overview.draftWarnings")
                  : t("knowledge.overview.draftClear")}
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() =>
                firstBlockerGroup ? openGateGroup(firstBlockerGroup) : onNavigate("history")
              }
            >
              {t(
                firstBlockerGroup
                  ? "knowledge.ux.next.fixAction"
                  : "knowledge.ux.next.publishAction",
              )}
              <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Button>
          </Card>
        </section>
      ) : null}

      {!firstLaunch ? (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                {t("knowledge.capability.draftTitle")}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {t("knowledge.capability.draftDescription")}
              </p>
              {!canManageCapabilities ? (
                <p className="mt-1 text-xs text-zinc-600">{t("knowledge.capability.readOnly")}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={statusTone(readiness.status)}>
                {t(readinessLabelKeys[readiness.status])}
              </StatusBadge>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("knowledge.page.refresh")}
                disabled={capabilityLoading || capabilitySaving}
                onClick={() => {
                  onRefresh();
                  void loadCapabilities();
                }}
              >
                <RefreshCw className={cn("h-4 w-4", capabilityLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <div
            className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950/30"
            data-testid="knowledge-draft-capabilities"
          >
            {renderCapabilityRows()}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={quickStartConfirmOpen}
        onOpenChange={setQuickStartConfirmOpen}
        title={t("knowledge.quickStart.confirm.title")}
        description={t("knowledge.quickStart.confirm.description")}
        confirmLabel={t("knowledge.quickStart.confirm.apply")}
        cancelLabel={t("knowledge.common.cancel")}
        onConfirm={applyQuickStart}
      />

      {(firstLaunch ? blockerGroups : gateGroups).length > 0 ? (
        <section>
          <h2 className="text-base font-semibold text-zinc-100">
            {t("knowledge.overview.draftAttention")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{t("knowledge.ux.attention.description")}</p>
          <div className="mt-3 space-y-2">
            {(firstLaunch ? blockerGroups : gateGroups).map(renderGateGroup)}
          </div>
        </section>
      ) : null}

      {firstLaunch && warningGroups.length > 0 ? (
        <details
          className="group min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/20"
          data-testid="knowledge-optional-improvements"
        >
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/50 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-200">
                {t("knowledge.quickStart.improvements.title")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                {t("knowledge.quickStart.improvements.description")}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-white/10 p-3 sm:p-4">
            {warningGroups.map(renderGateGroup)}
          </div>
        </details>
      ) : null}

      {firstLaunch ? (
        <details
          open={capabilityEditorOpen}
          onToggle={(event) => setCapabilityEditorOpen(event.currentTarget.open)}
          className="group min-w-0 overflow-hidden border-y border-white/10"
          data-testid="knowledge-capability-editor-disclosure"
        >
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/50 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-200">
                {t("knowledge.quickStart.settings.title")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                {t("knowledge.quickStart.settings.description")}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
          </summary>
          <div
            className="min-w-0 border-t border-white/10 bg-zinc-950/20"
            data-testid="knowledge-draft-capabilities"
          >
            {renderCapabilityRows()}
          </div>
        </details>
      ) : null}

      {!firstLaunch ? (
        <section>
          <h2 className="text-base font-semibold text-zinc-100">
            {t("knowledge.overview.recentWork")}
          </h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/30">
            {overview.recentJobs.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-7 text-sm text-zinc-500">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {t("knowledge.overview.noWork")}
              </div>
            ) : (
              overview.recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3 last:border-b-0"
                >
                  {job.status === "SUCCEEDED" ? (
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-sky-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-200">{job.progress.label}</p>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {formatDate(job.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <StatusBadge status={jobTone(job.status)}>
                    {t(jobStatusKeys[job.status])}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CapabilityDraftRow({
  capability,
  setting,
  canManage,
  controlsLoading,
  saveState,
  focused,
  expanded,
  onExpandedChange,
  onNavigate,
  onEnabledChange,
  onAutonomyChange,
  onReload,
}: {
  capability: KnowledgeV2CapabilityReadinessView;
  setting?: KnowledgeV2CapabilityView;
  canManage: boolean;
  controlsLoading: boolean;
  saveState?: CapabilitySaveState;
  focused: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onNavigate: (target: KnowledgeViewId | KnowledgeNavigationTarget) => void;
  onEnabledChange: (enabled: boolean) => void;
  onAutonomyChange: (autonomy: KnowledgeV2CapabilityAutonomy) => void;
  onReload: () => void;
}) {
  const router = useRouter();
  const { formatNumber, locale, t } = useI18n();
  const name = t(capabilityNameKeys[capability.capabilityType]);
  const enabled = setting?.enabled ?? capability.enabled;
  const autonomy = setting?.allowedAutonomy ?? capability.allowedAutonomy;
  const saving = saveState?.status === "saving";
  const controlsDisabled = controlsLoading || saving || !setting;
  const unresolvedRequirements = capability.requirements
    .filter((requirement) => !["SATISFIED", "NOT_APPLICABLE"].includes(requirement.status))
    .sort((left, right) => {
      if (left.severity === right.severity) return left.id.localeCompare(right.id);
      return left.severity === "BLOCKER" ? -1 : 1;
    });
  const requirementsId = `knowledge-capability-requirements-${capability.capabilityType}`;

  function openRequirement(requirement: KnowledgeV2ReadinessRequirementView) {
    if (requirement.remediation?.href) {
      router.push(requirement.remediation.href);
      return;
    }

    const destination = requirement.remediation?.destination;
    if (destination) {
      onNavigate({
        view: destination.view,
        task: destination.task,
        resourceType: destination.resource?.type,
        resourceId: destination.resource?.id,
        sourceId: destination.sourceId,
        documentId: destination.documentId,
        revisionId: destination.revisionId,
      });
      return;
    }

    if (requirement.kind === "FACT") {
      onNavigate({ view: "business", task: "complete-capability-requirement" });
    } else if (requirement.kind === "RULE") {
      onNavigate({ view: "guidance", task: requirement.id });
    } else if (requirement.kind === "DOCUMENT_COVERAGE") {
      onNavigate({ view: "sources", task: requirement.id });
    } else if (requirement.kind === "LOCALE") {
      onNavigate({ view: "business", task: "configure-locales" });
    } else if (requirement.kind === "EVALUATION_CASE") {
      onNavigate({ view: "test", task: requirement.id });
    } else {
      router.push("/app/integrations");
    }
  }

  function requirementActionKey(requirement: KnowledgeV2ReadinessRequirementView): TranslationKey {
    if (requirement.remediation?.href) return "knowledge.capability.action.integrations";
    const destination = requirement.remediation?.destination;
    if (destination?.view === "business") {
      return destination.task === "configure-locales"
        ? "knowledge.capability.action.languages"
        : "knowledge.capability.action.business";
    }
    if (destination?.view === "guidance") return "knowledge.capability.action.guidance";
    if (destination?.view === "sources") return "knowledge.capability.action.sources";
    if (destination?.view === "test") return "knowledge.capability.action.test";
    if (requirement.kind === "FACT") return "knowledge.capability.action.business";
    if (requirement.kind === "RULE") return "knowledge.capability.action.guidance";
    if (requirement.kind === "DOCUMENT_COVERAGE") {
      return "knowledge.capability.action.sources";
    }
    if (requirement.kind === "LOCALE") return "knowledge.capability.action.languages";
    if (requirement.kind === "EVALUATION_CASE") return "knowledge.capability.action.test";
    if (["CONNECTOR", "TOOL", "PERMISSION"].includes(requirement.kind)) {
      return "knowledge.capability.action.integrations";
    }
    return "knowledge.capability.action.details";
  }

  return (
    <div
      tabIndex={-1}
      className={cn(
        "grid min-w-0 scroll-mt-24 gap-4 border-b border-white/5 px-5 py-4 outline-none last:border-b-0 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)_auto] lg:items-center",
        focused && "bg-amber-500/[0.07] ring-1 ring-inset ring-amber-400/40",
      )}
      data-capability-id={capability.capabilityId}
      data-capability-type={capability.capabilityType}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-zinc-100">{name}</h3>
          {!enabled ? (
            <span className="text-xs text-zinc-600">
              {t("knowledge.overview.capabilityDisabled")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {enabled
            ? t("knowledge.overview.requirements", {
                done: formatNumber(
                  capability.requirements.filter((item) => item.status === "SATISFIED").length,
                ),
                total: formatNumber(capability.requirements.length),
              })
            : t("knowledge.capability.fixes.disabled")}
        </p>
        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-3" aria-live="polite">
          {capability.blockerCount > 0 ? (
            <span className="text-xs text-rose-400">
              {t("knowledge.common.blockers", { count: formatNumber(capability.blockerCount) })}
            </span>
          ) : null}
          {capability.warningCount > 0 ? (
            <span className="text-xs text-amber-400">
              {t("knowledge.common.warnings", { count: formatNumber(capability.warningCount) })}
            </span>
          ) : null}
          {enabled && unresolvedRequirements.length === 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("knowledge.capability.fixes.ready")}
            </span>
          ) : null}
        </div>
        {enabled && unresolvedRequirements.length > 0 ? (
          <button
            type="button"
            aria-controls={requirementsId}
            aria-expanded={expanded}
            className="mt-2 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md text-left text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
            data-testid={`knowledge-capability-fixes-${capability.capabilityType}`}
            onClick={() => onExpandedChange(!expanded)}
          >
            <ListChecks className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              {t(expanded ? "knowledge.capability.fixes.hide" : "knowledge.capability.fixes.show", {
                count: formatNumber(unresolvedRequirements.length),
              })}
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")}
            />
          </button>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-zinc-500">
          {t("knowledge.capability.autonomyLabel")}
        </p>
        {canManage ? (
          <Select
            value={autonomy}
            disabled={controlsDisabled}
            onValueChange={(value) => onAutonomyChange(value as KnowledgeV2CapabilityAutonomy)}
            options={autonomyOptions.map(([value, labelKey]) => ({
              value,
              label: t(labelKey),
            }))}
            ariaLabel={t("knowledge.capability.autonomyAria", { name })}
            className="h-9 rounded-lg px-3 max-sm:min-h-11"
          />
        ) : (
          <div className="flex h-9 items-center text-sm text-zinc-400">
            {t(autonomyLabelKeys[autonomy])}
          </div>
        )}
        <div className="mt-2 min-h-5" aria-live="polite">
          {saving ? (
            <span className="flex items-center gap-1.5 text-xs text-sky-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("knowledge.capability.saving")}
            </span>
          ) : saveState?.status === "saved" ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("knowledge.capability.fixes.saved")}
            </span>
          ) : saveState?.status === "error" ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-amber-300" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{saveState.error}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("knowledge.capability.reload")}
                onClick={onReload}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-28 items-center justify-between gap-3 lg:justify-end">
        <StatusBadge status={statusTone(capability.status)}>
          {t(readinessLabelKeys[capability.status])}
        </StatusBadge>
        {canManage ? (
          <CapabilityToggle
            checked={enabled}
            disabled={controlsDisabled}
            label={t(
              enabled ? "knowledge.capability.disableAria" : "knowledge.capability.enableAria",
              { name },
            )}
            onChange={onEnabledChange}
          />
        ) : (
          <span className="text-xs text-zinc-500">
            {t(enabled ? "knowledge.capability.enabled" : "knowledge.overview.capabilityDisabled")}
          </span>
        )}
      </div>

      {expanded && enabled && unresolvedRequirements.length > 0 ? (
        <div
          id={requirementsId}
          className="-mx-5 -mb-4 min-w-0 border-t border-white/10 bg-white/[0.015] px-5 py-4 lg:col-span-3"
          data-testid={requirementsId}
        >
          <div className="flex min-w-0 items-start gap-3">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm leading-5 text-zinc-300">
                {t("knowledge.capability.fixes.intro")}
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                {t("knowledge.capability.fixes.disableHint")}
              </p>
            </div>
          </div>
          <div className="mt-3 divide-y divide-white/10 border-y border-white/10">
            {unresolvedRequirements.map((requirement) => {
              const titleKey = capabilityRequirementLabelKeys[requirement.id];
              const title = titleKey
                ? t(titleKey)
                : locale === "en"
                  ? requirement.label
                  : t("knowledge.capability.requirement.custom");
              const reasonKey =
                capabilityRequirementReasonKeys[requirement.reasonCode] ??
                (requirement.status === "STALE"
                  ? "knowledge.capability.reason.stale"
                  : requirement.status === "CONFLICTED"
                    ? "knowledge.capability.reason.conflict"
                    : "knowledge.capability.reason.missing");

              return (
                <div
                  key={requirement.id}
                  className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  data-testid={`knowledge-capability-requirement-${requirement.id}`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {requirement.severity === "BLOCKER" ? (
                      <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-medium text-zinc-100">{title}</h4>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            requirement.severity === "BLOCKER" ? "text-rose-400" : "text-amber-400",
                          )}
                        >
                          {t(
                            requirement.severity === "BLOCKER"
                              ? "knowledge.capability.fixes.required"
                              : "knowledge.capability.fixes.recommended",
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-zinc-300">{t(reasonKey)}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {t(capabilityRequirementKindKeys[requirement.kind])}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 w-full justify-center sm:w-auto"
                    onClick={() => openRequirement(requirement)}
                  >
                    {t(requirementActionKey(requirement))}
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CapabilityToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative block h-6 w-11 rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-emerald-500" : "bg-white/10",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-0 block h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

function Metric({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: string;
  attention?: boolean;
}) {
  return (
    <div className="bg-zinc-950 px-5 py-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${attention ? "text-amber-300" : "text-zinc-100"}`}
      >
        {value}
      </p>
    </div>
  );
}
