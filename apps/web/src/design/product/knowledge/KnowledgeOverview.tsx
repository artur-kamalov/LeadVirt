"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileWarning,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  KnowledgeV2CapabilityAutonomy,
  KnowledgeV2CapabilityReadinessView,
  KnowledgeV2CapabilityType,
  KnowledgeV2CapabilityView,
  KnowledgeV2JobStatus,
  KnowledgeV2OverviewView,
  KnowledgeV2ReadinessStatus,
} from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import {
  createKnowledgeV2IdempotencyKey,
  getKnowledgeV2Capabilities,
  updateKnowledgeV2Capability,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { Card } from "../shared";
import { Select, StatusBadge } from "../ui";
import type { KnowledgeViewId } from "./knowledge-views";

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
  onNavigate: (view: KnowledgeViewId) => void;
  onRefresh: () => void;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const { readiness } = overview;
  const gates = [...readiness.draft.blockers, ...readiness.draft.warnings];
  const canManageCapabilities = overview.permissions.canManageSettings;
  const [capabilitySettings, setCapabilitySettings] = React.useState<KnowledgeV2CapabilityView[]>(
    [],
  );
  const [capabilityStates, setCapabilityStates] = React.useState<
    Partial<Record<KnowledgeV2CapabilityType, CapabilitySaveState>>
  >({});
  const [capabilityLoading, setCapabilityLoading] = React.useState(canManageCapabilities);
  const [capabilityLoadError, setCapabilityLoadError] = React.useState<string | null>(null);
  const capabilityLoadSequence = React.useRef(0);

  const loadCapabilities = React.useCallback(async () => {
    if (!canManageCapabilities) return;
    const sequence = ++capabilityLoadSequence.current;
    setCapabilityLoading(true);
    setCapabilityLoadError(null);
    try {
      const response = await getKnowledgeV2Capabilities();
      if (sequence !== capabilityLoadSequence.current) return;
      setCapabilitySettings(response.items);
      setCapabilityStates({});
    } catch {
      if (sequence !== capabilityLoadSequence.current) return;
      setCapabilityLoadError(t("knowledge.capability.loadError"));
    } finally {
      if (sequence === capabilityLoadSequence.current) setCapabilityLoading(false);
    }
  }, [canManageCapabilities, t]);

  React.useEffect(() => {
    void loadCapabilities();
    return () => {
      capabilityLoadSequence.current += 1;
    };
  }, [loadCapabilities]);

  const capabilitySaving = Object.values(capabilityStates).some(
    (state) => state?.status === "saving",
  );

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

  return (
    <div className="space-y-6" data-testid="knowledge-overview">
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
              <p className="mt-3 text-xs text-zinc-600">{t("knowledge.capability.servingEmpty")}</p>
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">
                {t("knowledge.overview.draftEyebrow")}
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
          <p className="mt-4 text-sm text-zinc-400">
            {readiness.draft.blockers.length > 0
              ? t("knowledge.overview.draftBlocked", {
                  count: formatNumber(readiness.draft.blockers.length),
                })
              : readiness.draft.warnings.length > 0
                ? t("knowledge.overview.draftWarnings")
                : t("knowledge.overview.draftClear")}
          </p>
          <Button
            className="mt-4"
            size="sm"
            variant="outline"
            onClick={() => onNavigate("history")}
          >
            {t("knowledge.overview.openHistory")}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
        </Card>
      </section>

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
            readiness.draft.capabilities.map((capability) => {
              const setting = capabilitySettings.find(
                (item) => item.capabilityType === capability.capabilityType,
              );
              return (
                <CapabilityDraftRow
                  key={capability.capabilityId}
                  capability={capability}
                  setting={setting}
                  canManage={canManageCapabilities}
                  controlsLoading={capabilityLoading || Boolean(capabilityLoadError)}
                  saveState={capabilityStates[capability.capabilityType]}
                  onEnabledChange={(enabled) =>
                    void saveCapability(capability.capabilityType, { enabled })
                  }
                  onAutonomyChange={(allowedAutonomy) =>
                    void saveCapability(capability.capabilityType, { allowedAutonomy })
                  }
                  onReload={() => void loadCapabilities()}
                />
              );
            })
          )}
        </div>
      </section>

      {gates.length > 0 ? (
        <section>
          <h2 className="text-base font-semibold text-zinc-100">
            {t("knowledge.overview.draftAttention")}
          </h2>
          <div className="mt-3 space-y-2">
            {gates.map((gate) => {
              const resource = gate.remediation?.resource ?? gate.resource;
              return (
                <div
                  key={`${gate.code}:${gate.resource?.id ?? "workspace"}`}
                  className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3 sm:flex-row sm:items-center"
                >
                  {gate.status === "BLOCKED" ? (
                    <FileWarning className="h-4 w-4 shrink-0 text-rose-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-200">{gate.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{gate.message}</p>
                  </div>
                  {resource?.type === "FACT" ? (
                    <Button size="sm" variant="ghost" onClick={() => onNavigate("business")}>
                      {t("knowledge.common.resolve")}
                    </Button>
                  ) : resource?.type === "GUIDANCE_RULE" ? (
                    <Button size="sm" variant="ghost" onClick={() => onNavigate("guidance")}>
                      {t("knowledge.common.resolve")}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

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
    </div>
  );
}

function CapabilityDraftRow({
  capability,
  setting,
  canManage,
  controlsLoading,
  saveState,
  onEnabledChange,
  onAutonomyChange,
  onReload,
}: {
  capability: KnowledgeV2CapabilityReadinessView;
  setting?: KnowledgeV2CapabilityView;
  canManage: boolean;
  controlsLoading: boolean;
  saveState?: CapabilitySaveState;
  onEnabledChange: (enabled: boolean) => void;
  onAutonomyChange: (autonomy: KnowledgeV2CapabilityAutonomy) => void;
  onReload: () => void;
}) {
  const { formatNumber, t } = useI18n();
  const name = t(capabilityNameKeys[capability.capabilityType]);
  const enabled = setting?.enabled ?? capability.enabled;
  const autonomy = setting?.allowedAutonomy ?? capability.allowedAutonomy;
  const saving = saveState?.status === "saving";
  const controlsDisabled = controlsLoading || saving || !setting;

  return (
    <div
      className="grid min-w-0 gap-4 border-b border-white/5 px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)_auto] lg:items-center"
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
          {t("knowledge.overview.requirements", {
            done: formatNumber(
              capability.requirements.filter((item) => item.status === "SATISFIED").length,
            ),
            total: formatNumber(capability.requirements.length),
          })}
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
          {saving ? (
            <span className="flex items-center gap-1.5 text-xs text-sky-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("knowledge.capability.saving")}
            </span>
          ) : saveState?.status === "saved" ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("knowledge.capability.saved")}
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
