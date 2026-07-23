"use client";

import React from "react";
import {
  AlertTriangle,
  Archive,
  Beaker,
  BookCheck,
  CheckCircle2,
  ChevronRight,
  CirclePlay,
  ExternalLink,
  FileText,
  FlaskConical,
  Library,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type {
  ChannelType,
  KnowledgeV2Audience,
  KnowledgeV2ConflictStatus,
  KnowledgeV2CreateTestCaseRequest,
  KnowledgeV2CreateTestRunRequest,
  KnowledgeV2ExpectedBehavior,
  KnowledgeV2FactAuthority,
  KnowledgeV2GateOutcome,
  KnowledgeV2OverviewView,
  KnowledgeV2RetrievalOutcome,
  KnowledgeV2RiskLevel,
  KnowledgeV2ScopeInput,
  KnowledgeV2TestCaseOrigin,
  KnowledgeV2TestCaseStatus,
  KnowledgeV2TestCaseView,
  KnowledgeV2TestExpectationKind,
  KnowledgeV2TestGateReason,
  KnowledgeV2TestMissingSupport,
  KnowledgeV2TestRunStatus,
  KnowledgeV2TestRunView,
  KnowledgeV2TestSuppressionReason,
  KnowledgeV2TestToolCallStatus,
  KnowledgeV2UpdateTestCaseRequest,
  KnowledgeV2VerificationStatus,
} from "@leadvirt/types";
import { localeOptions } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import {
  archiveKnowledgeV2TestCase,
  createKnowledgeV2IdempotencyKey,
  createKnowledgeV2TestCase,
  createKnowledgeV2TestRun,
  getKnowledgeV2TestCase,
  getKnowledgeV2TestCaseInput,
  getKnowledgeV2TestRun,
  listKnowledgeV2Sources,
  listKnowledgeV2TestCases,
  updateKnowledgeV2TestCase,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { EmptyState, LoadingOverlay, Modal, Select, Spinner, StatusBadge } from "../ui";
import type { KnowledgeViewId } from "./knowledge-views";

const TEST_CASE_PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const MIN_RUN_POLL_INTERVAL_MS = 2_000;
const MAX_RUN_POLL_INTERVAL_MS = 15_000;
const MAX_RUN_POLLS = 80;
const ACTIVE_RUN_STORAGE_KEY = "leadvirt:knowledge-v2:active-test-run";

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 aria-invalid:border-rose-500/60 max-sm:min-h-11";
const textareaClass = cn(inputClass, "h-auto min-h-28 resize-y py-2.5");

const channels: ChannelType[] = [
  "WEBSITE",
  "TELEGRAM",
  "WHATSAPP",
  "INSTAGRAM",
  "VK",
  "EMAIL",
  "WEBHOOK",
  "PHONE",
  "DEMO",
];
const audiences: KnowledgeV2Audience[] = ["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"];
const risks: KnowledgeV2RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const caseStatuses: KnowledgeV2TestCaseStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];
const mutableCaseStatuses: Array<Extract<KnowledgeV2TestCaseStatus, "DRAFT" | "ACTIVE">> = [
  "DRAFT",
  "ACTIVE",
];
const expectedBehaviors: KnowledgeV2ExpectedBehavior[] = [
  "ANSWER",
  "ABSTAIN",
  "HANDOFF",
  "REFUSE",
  "TOOL_CALL",
  "HOLD_FOR_APPROVAL",
];

const channelKeys: Record<ChannelType, TranslationKey> = {
  WEBSITE: "knowledge.test.channel.website",
  TELEGRAM: "knowledge.test.channel.telegram",
  WHATSAPP: "knowledge.test.channel.whatsapp",
  INSTAGRAM: "knowledge.test.channel.instagram",
  VK: "knowledge.test.channel.vk",
  EMAIL: "knowledge.test.channel.email",
  WEBHOOK: "knowledge.test.channel.webhook",
  PHONE: "knowledge.test.channel.phone",
  DEMO: "knowledge.test.channel.demo",
};
const audienceKeys: Record<KnowledgeV2Audience, TranslationKey> = {
  PUBLIC: "knowledge.test.audience.public",
  AUTHENTICATED_CUSTOMER: "knowledge.test.audience.customer",
  INTERNAL: "knowledge.test.audience.internal",
};
const riskKeys: Record<KnowledgeV2RiskLevel, TranslationKey> = {
  LOW: "knowledge.review.risk.low",
  MEDIUM: "knowledge.review.risk.medium",
  HIGH: "knowledge.review.risk.high",
  CRITICAL: "knowledge.review.risk.critical",
};
const caseStatusKeys: Record<KnowledgeV2TestCaseStatus, TranslationKey> = {
  DRAFT: "knowledge.test.status.draft",
  ACTIVE: "knowledge.test.status.active",
  ARCHIVED: "knowledge.test.status.archived",
};
const runStatusKeys: Record<KnowledgeV2TestRunStatus, TranslationKey> = {
  QUEUED: "knowledge.test.runStatus.queued",
  RUNNING: "knowledge.test.runStatus.running",
  SUCCEEDED: "knowledge.test.runStatus.succeeded",
  FAILED: "knowledge.test.runStatus.failed",
  CANCELLED: "knowledge.test.runStatus.cancelled",
};
const testErrorKeys: Record<string, TranslationKey> = {
  KNOWLEDGE_DEPENDENCY_TEST_RUN_TIMEOUT: "knowledge.test.error.timeout",
  KNOWLEDGE_PERMISSION_TEST_RUN_REQUESTER_REVOKED: "knowledge.test.error.requesterRevoked",
  KNOWLEDGE_CONFLICT_DRAFT_SNAPSHOT_UNAVAILABLE: "knowledge.test.error.draftUnavailable",
  KNOWLEDGE_DEPENDENCY_TEST_RUN_FAILED: "knowledge.test.error.failed",
  KNOWLEDGE_DEPENDENCY_ACTIVE_PUBLICATION_UNAVAILABLE:
    "knowledge.test.playground.targetUnavailable",
  KNOWLEDGE_DEPENDENCY_RESTRICTED_STORAGE_UNAVAILABLE: "knowledge.test.playground.unavailable",
  KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND: "knowledge.test.error.notFound",
  KNOWLEDGE_CONFLICT_TEST_CASE_ARCHIVED: "knowledge.test.error.conflict",
  KNOWLEDGE_CONFLICT_TEST_CASE_VERSION_INVALID: "knowledge.test.error.conflict",
  KNOWLEDGE_QUOTA_TEST_CASE_LIMIT_REACHED: "knowledge.test.error.quota",
  IDEMPOTENCY_KEY_REUSED: "knowledge.test.error.conflict",
};
const behaviorKeys: Record<KnowledgeV2ExpectedBehavior, TranslationKey> = {
  ANSWER: "knowledge.test.behavior.answer",
  ABSTAIN: "knowledge.test.behavior.abstain",
  HANDOFF: "knowledge.test.behavior.handoff",
  REFUSE: "knowledge.test.behavior.refuse",
  TOOL_CALL: "knowledge.test.behavior.toolCall",
  HOLD_FOR_APPROVAL: "knowledge.test.behavior.hold",
};
const outcomeKeys: Record<KnowledgeV2RetrievalOutcome, TranslationKey> = {
  ANSWERED: "knowledge.test.outcome.answered",
  ABSTAINED: "knowledge.test.outcome.abstained",
  HANDED_OFF: "knowledge.test.outcome.handedOff",
  HELD_FOR_APPROVAL: "knowledge.test.outcome.held",
  REFUSED: "knowledge.test.outcome.refused",
  FAILED: "knowledge.test.outcome.failed",
};
const dispositionKeys: Record<KnowledgeV2GateOutcome, TranslationKey> = {
  AUTO_SEND: "knowledge.test.disposition.autoSend",
  HOLD_FOR_APPROVAL: "knowledge.test.disposition.hold",
  HANDOFF: "knowledge.test.disposition.handoff",
  BLOCKED: "knowledge.test.disposition.blocked",
};
const originKeys: Record<KnowledgeV2TestCaseOrigin, TranslationKey> = {
  PLATFORM: "knowledge.test.origin.platform",
  INDUSTRY_PACK: "knowledge.test.origin.industry",
  TENANT: "knowledge.test.origin.tenant",
  ANONYMIZED_FAILURE: "knowledge.test.origin.failure",
  SYNTHETIC: "knowledge.test.origin.synthetic",
};
const expectationKeys: Record<KnowledgeV2TestExpectationKind, TranslationKey> = {
  REQUIRED_FACT: "knowledge.test.expectation.requiredFact",
  FORBIDDEN_FACT: "knowledge.test.expectation.forbiddenFact",
  REQUIRED_GUIDANCE: "knowledge.test.expectation.requiredGuidance",
  FORBIDDEN_GUIDANCE: "knowledge.test.expectation.forbiddenGuidance",
  REQUIRED_EVIDENCE: "knowledge.test.expectation.requiredEvidence",
  FORBIDDEN_CLAIM: "knowledge.test.expectation.forbiddenClaim",
  REQUIRED_TOOL: "knowledge.test.expectation.requiredTool",
  FORBIDDEN_TOOL: "knowledge.test.expectation.forbiddenTool",
};
const toolStatusKeys: Record<KnowledgeV2TestToolCallStatus, TranslationKey> = {
  SUCCEEDED: "knowledge.test.tool.succeeded",
  FAILED: "knowledge.test.tool.failed",
  SKIPPED: "knowledge.test.tool.skipped",
};
const suppressionKeys: Record<KnowledgeV2TestSuppressionReason, TranslationKey> = {
  PERMISSION: "knowledge.test.suppression.permission",
  STALE: "knowledge.test.suppression.stale",
  CONFLICT: "knowledge.test.suppression.conflict",
  LOW_CONFIDENCE: "knowledge.test.suppression.lowConfidence",
  DUPLICATE: "knowledge.test.suppression.duplicate",
  POLICY: "knowledge.test.suppression.policy",
};

type TestMode = "PLAYGROUND" | "CASES";
type CaseFilter<T extends string> = T | "ALL";

interface ScopeOptions {
  brands: string[];
  locations: string[];
}

interface TestCaseDraft {
  safeLabel: string;
  status: Extract<KnowledgeV2TestCaseStatus, "DRAFT" | "ACTIVE">;
  riskLevel: KnowledgeV2RiskLevel;
  critical: boolean;
  question: string;
  expectedBehavior: KnowledgeV2ExpectedBehavior;
  locale: string;
  channelType: ChannelType;
  audience: KnowledgeV2Audience;
  brandId: string;
  locationId: string;
  segment: string;
  datasetVersion: string;
  sliceKeys: string;
}

type TestCaseDraftKey = keyof TestCaseDraft;

interface EditingCase {
  mode: "CREATE" | "EDIT";
  item: KnowledgeV2TestCaseView | null;
  etag: string | null;
}

function apiError(caught: unknown, fallback: string) {
  return caught instanceof ApiClientError ? caught : new ApiClientError(fallback, 500);
}

function responseEtag(headers: Headers, fallback: string) {
  return headers.get("etag") ?? fallback;
}

function activeRun(status: KnowledgeV2TestRunStatus) {
  return status === "QUEUED" || status === "RUNNING";
}

function testErrorKey(
  code: string | null | undefined,
  status: number | undefined,
  fallback: TranslationKey = "knowledge.test.error.failed",
): TranslationKey {
  const exact = code ? testErrorKeys[code] : undefined;
  if (exact) return exact;
  if (code?.startsWith("KNOWLEDGE_PERMISSION_")) return "knowledge.test.error.permission";
  if (code?.startsWith("KNOWLEDGE_VALIDATION_")) return "knowledge.test.error.validation";
  if (code?.startsWith("KNOWLEDGE_QUOTA_")) return "knowledge.test.error.quota";
  if (code?.startsWith("KNOWLEDGE_CONFLICT_")) return "knowledge.test.error.conflict";
  if (code?.startsWith("KNOWLEDGE_DEPENDENCY_")) {
    return "knowledge.test.playground.unavailable";
  }
  if (status === 401 || status === 403) return "knowledge.test.error.permission";
  if (status === 404) return "knowledge.test.error.notFound";
  if (status === 409 || status === 412) return "knowledge.test.error.conflict";
  if (status === 400 || status === 422) return "knowledge.test.error.validation";
  if (status === 429) return "knowledge.test.error.quota";
  if (status !== undefined && status >= 500) return "knowledge.test.playground.unavailable";
  return fallback;
}

function riskTone(risk: KnowledgeV2RiskLevel) {
  if (risk === "HIGH" || risk === "CRITICAL") return "error" as const;
  if (risk === "MEDIUM") return "warning" as const;
  return "info" as const;
}

function runStatusTone(status: KnowledgeV2TestRunStatus) {
  if (status === "SUCCEEDED") return "success" as const;
  if (status === "FAILED" || status === "CANCELLED") return "error" as const;
  return "warning" as const;
}

function caseStatusTone(status: KnowledgeV2TestCaseStatus) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "ARCHIVED") return "info" as const;
  return "warning" as const;
}

function dispositionTone(disposition: KnowledgeV2GateOutcome) {
  if (disposition === "AUTO_SEND") return "success" as const;
  if (disposition === "HOLD_FOR_APPROVAL") return "warning" as const;
  if (disposition === "HANDOFF") return "info" as const;
  return "error" as const;
}

function stringArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function scopeInput(
  brandId: string,
  locationId: string,
  segment: string,
): KnowledgeV2ScopeInput | null {
  const brandIds = brandId ? [brandId] : [];
  const locationIds = locationId ? [locationId] : [];
  const segments = segment.trim() ? [segment.trim()] : [];
  return brandIds.length || locationIds.length || segments.length
    ? { brandIds, locationIds, segments }
    : null;
}

function safePublicUrl(value: string | null | undefined, isPublic: boolean, redacted: boolean) {
  if (!value || !isPublic || redacted) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function blankDraft(locale: string): TestCaseDraft {
  return {
    safeLabel: "",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    critical: false,
    question: "",
    expectedBehavior: "ANSWER",
    locale,
    channelType: "WEBSITE",
    audience: "PUBLIC",
    brandId: "",
    locationId: "",
    segment: "",
    datasetVersion: "tenant-v1",
    sliceKeys: "",
  };
}

function draftFromCase(item: KnowledgeV2TestCaseView, question = ""): TestCaseDraft {
  const version = item.currentVersion;
  return {
    safeLabel: item.safeLabel,
    status: item.status === "ARCHIVED" ? "DRAFT" : item.status,
    riskLevel: item.riskLevel,
    critical: item.critical,
    question,
    expectedBehavior: version?.expectedBehavior ?? "ANSWER",
    locale: version?.locale ?? "en",
    channelType: version?.channelType ?? "WEBSITE",
    audience: version?.audience ?? "PUBLIC",
    brandId: stringArray(version?.scope, "brandIds")[0] ?? "",
    locationId: stringArray(version?.scope, "locationIds")[0] ?? "",
    segment: stringArray(version?.scope, "segments")[0] ?? "",
    datasetVersion: version?.datasetVersion ?? "tenant-v1",
    sliceKeys: version?.sliceKeys.join(", ") ?? "",
  };
}

function mergeDraft(
  latest: TestCaseDraft,
  current: TestCaseDraft,
  dirty: ReadonlySet<TestCaseDraftKey>,
) {
  const next = { ...latest };
  for (const key of dirty) {
    assignDraftField(next, current, key);
  }
  return next;
}

function assignDraftField<Key extends TestCaseDraftKey>(
  target: TestCaseDraft,
  source: TestCaseDraft,
  key: Key,
) {
  target[key] = source[key];
}

export function KnowledgeTestPlayground({
  overview,
  onNavigate,
  onChanged,
}: {
  overview: KnowledgeV2OverviewView;
  onNavigate: (view: KnowledgeViewId) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<TestMode>("PLAYGROUND");
  const [selectedSavedCase, setSelectedSavedCase] = React.useState<KnowledgeV2TestCaseView | null>(
    null,
  );
  const [scopeOptions, setScopeOptions] = React.useState<ScopeOptions>({
    brands: [],
    locations: [],
  });

  React.useEffect(() => {
    let active = true;
    void listKnowledgeV2Sources({ limit: 100 })
      .then((page) => {
        if (!active) return;
        setScopeOptions({
          brands: unique(page.items.flatMap((source) => source.defaultScope.brandIds)),
          locations: unique(page.items.flatMap((source) => source.defaultScope.locationIds)),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="min-w-0 space-y-4" data-testid="knowledge-test-workspace">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-zinc-100">{t("knowledge.test.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">{t("knowledge.test.description")}</p>
      </div>

      <div
        className="inline-flex w-full items-stretch rounded-md border border-white/10 bg-white/[0.025] p-1 sm:w-auto"
        role="tablist"
        aria-label={t("knowledge.test.title")}
      >
        <ModeButton
          active={mode === "PLAYGROUND"}
          icon={FlaskConical}
          label={t("knowledge.test.tab.playground")}
          onClick={() => setMode("PLAYGROUND")}
        />
        <ModeButton
          active={mode === "CASES"}
          icon={BookCheck}
          label={t("knowledge.test.tab.cases")}
          onClick={() => setMode("CASES")}
        />
      </div>

      {mode === "PLAYGROUND" ? (
        <PlaygroundPanel
          key={selectedSavedCase?.id ?? "new-question"}
          overview={overview}
          scopeOptions={scopeOptions}
          savedCase={selectedSavedCase}
          onClearSavedCase={() => setSelectedSavedCase(null)}
          onNavigate={onNavigate}
        />
      ) : (
        <TestCasesPanel
          canManageTests={overview.permissions.canManageSettings}
          scopeOptions={scopeOptions}
          onRun={(item) => {
            setSelectedSavedCase(item);
            setMode("PLAYGROUND");
          }}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof FlaskConical;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-center text-sm font-medium leading-4 transition-colors sm:h-9 sm:min-h-9 sm:flex-none sm:gap-2 sm:px-3 sm:py-0",
        active ? "bg-emerald-500/12 text-emerald-300" : "text-zinc-500 hover:text-zinc-200",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 whitespace-normal break-words sm:whitespace-nowrap">{label}</span>
    </button>
  );
}

function PlaygroundPanel({
  overview,
  scopeOptions,
  savedCase,
  onClearSavedCase,
  onNavigate,
}: {
  overview: KnowledgeV2OverviewView;
  scopeOptions: ScopeOptions;
  savedCase: KnowledgeV2TestCaseView | null;
  onClearSavedCase: () => void;
  onNavigate: (view: KnowledgeViewId) => void;
}) {
  const { t, locale: interfaceLocale, formatDate, formatNumber } = useI18n();
  const version = savedCase?.currentVersion;
  const [question, setQuestion] = React.useState("");
  const [locale, setLocale] = React.useState(version?.locale ?? interfaceLocale);
  const [channelType, setChannelType] = React.useState<ChannelType>(
    version?.channelType ?? "WEBSITE",
  );
  const [audience, setAudience] = React.useState<KnowledgeV2Audience>(
    version?.audience ?? "PUBLIC",
  );
  const [brandId, setBrandId] = React.useState(stringArray(version?.scope, "brandIds")[0] ?? "");
  const [locationId, setLocationId] = React.useState(
    stringArray(version?.scope, "locationIds")[0] ?? "",
  );
  const [segment, setSegment] = React.useState(stringArray(version?.scope, "segments")[0] ?? "");
  const [target, setTarget] = React.useState<"ACTIVE" | "DRAFT">(
    overview.readiness.activePublicationId ? "ACTIVE" : "DRAFT",
  );
  const [run, setRun] = React.useState<KnowledgeV2TestRunView | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [loadingStoredRun, setLoadingStoredRun] = React.useState(false);
  const [validationError, setValidationError] = React.useState(false);
  const [runError, setRunError] = React.useState<ApiClientError | null>(null);
  const [pollPaused, setPollPaused] = React.useState(false);
  const mounted = React.useRef(false);
  const requestSequence = React.useRef(0);
  const pollCount = React.useRef(0);
  const refreshInFlight = React.useRef(false);

  const refreshRun = React.useCallback(
    async (runId: string, silent = false) => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      const sequence = ++requestSequence.current;
      if (!silent) setLoadingStoredRun(true);
      try {
        const response = await getKnowledgeV2TestRun(runId);
        if (!mounted.current || sequence !== requestSequence.current) return;
        setRun(response.data);
        setRunError(null);
        if (activeRun(response.data.status)) {
          window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, response.data.id);
        } else {
          window.sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
        }
      } catch (caught) {
        if (!mounted.current || sequence !== requestSequence.current) return;
        const error = apiError(caught, t("knowledge.test.playground.requestFailed"));
        if (error.status === 404) window.sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
        setRunError(error);
      } finally {
        refreshInFlight.current = false;
        if (mounted.current && sequence === requestSequence.current) setLoadingStoredRun(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    mounted.current = true;
    const storedRunId = window.sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
    if (storedRunId) void refreshRun(storedRunId);
    return () => {
      mounted.current = false;
    };
  }, [refreshRun]);

  React.useEffect(() => {
    if (!run || !activeRun(run.status) || pollPaused) return;

    function pollWhenVisible() {
      if (document.visibilityState !== "visible" || !document.hasFocus() || !run) return;
      if (pollCount.current >= MAX_RUN_POLLS) {
        setPollPaused(true);
        return;
      }
      pollCount.current += 1;
      void refreshRun(run.id, true);
    }

    function refreshOnFocus() {
      if (document.visibilityState !== "visible" || !document.hasFocus() || !run) return;
      pollCount.current = 0;
      setPollPaused(false);
      void refreshRun(run.id, true);
    }

    const pollInterval = Math.min(
      MAX_RUN_POLL_INTERVAL_MS,
      Math.max(MIN_RUN_POLL_INTERVAL_MS, run.pollAfterMs ?? 3_000),
    );
    const interval = window.setInterval(pollWhenVisible, pollInterval);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [pollPaused, refreshRun, run]);

  async function startRun() {
    if (!savedCase && question.trim().length < 2) {
      setValidationError(true);
      return;
    }
    if (target === "DRAFT" && !overview.readiness.draft.validationId) {
      return;
    }
    if (target === "ACTIVE" && !overview.readiness.activePublicationId) {
      setRunError(new ApiClientError(t("knowledge.test.playground.targetUnavailable"), 409));
      return;
    }

    const context = {
      locale,
      channelType,
      audience,
      scope: scopeInput(brandId, locationId, segment),
    };
    const request: KnowledgeV2CreateTestRunRequest =
      target === "DRAFT"
        ? savedCase
          ? {
              ...context,
              testCaseId: savedCase.id,
              target: "DRAFT",
              candidateId: overview.readiness.draft.candidateId,
              candidateVersion: overview.readiness.draft.candidateVersion,
              candidateManifestHash: overview.readiness.draft.candidateManifestHash,
            }
          : {
              ...context,
              question: question.trim(),
              target: "DRAFT",
              candidateId: overview.readiness.draft.candidateId,
              candidateVersion: overview.readiness.draft.candidateVersion,
              candidateManifestHash: overview.readiness.draft.candidateManifestHash,
            }
        : savedCase
          ? { ...context, testCaseId: savedCase.id, target: "ACTIVE" }
          : { ...context, question: question.trim(), target: "ACTIVE" };

    setStarting(true);
    setRunError(null);
    setValidationError(false);
    setPollPaused(false);
    pollCount.current = 0;
    try {
      const response = await createKnowledgeV2TestRun(request, {
        "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
      });
      setRun(response.data.resource);
      if (activeRun(response.data.resource.status)) {
        window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, response.data.resource.id);
      }
    } catch (caught) {
      const error = apiError(caught, t("knowledge.test.playground.requestFailed"));
      setRunError(
        error.status === 404 || error.status === 501
          ? new ApiClientError(t("knowledge.test.playground.unavailable"), error.status, error.code)
          : error,
      );
    } finally {
      setStarting(false);
    }
  }

  const brandOptions = unique([...(brandId ? [brandId] : []), ...scopeOptions.brands]);
  const locationOptions = unique([...(locationId ? [locationId] : []), ...scopeOptions.locations]);
  const running = Boolean(run && activeRun(run.status));
  const draftTestUnavailable = target === "DRAFT" && !overview.readiness.draft.validationId;
  const draftHasBlockers = overview.readiness.draft.blockers.length > 0;

  return (
    <div className="min-w-0 space-y-5" data-testid="knowledge-test-playground">
      <div className="min-w-0 rounded-lg border border-white/10 bg-zinc-950/25 p-4 sm:p-5">
        {savedCase ? (
          <div className="mb-4 flex min-w-0 flex-col gap-3 rounded-md border border-sky-500/20 bg-sky-500/[0.06] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-sky-300">{t("knowledge.test.playground.savedQuestion")}</p>
              <p className="mt-1 truncate text-sm font-medium text-zinc-100">
                {savedCase.safeLabel}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onClearSavedCase}>
              {t("knowledge.test.playground.clearSaved")}
            </Button>
          </div>
        ) : (
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              {t("knowledge.test.playground.question")}
            </span>
            <textarea
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                if (event.target.value.trim().length >= 2) setValidationError(false);
              }}
              aria-invalid={validationError}
              aria-describedby={validationError ? "knowledge-test-question-error" : undefined}
              placeholder={t("knowledge.test.playground.questionPlaceholder")}
              className={textareaClass}
              data-testid="knowledge-test-question"
            />
            {validationError ? (
              <span
                id="knowledge-test-question-error"
                className="mt-1.5 block text-xs text-rose-400"
              >
                {t("knowledge.test.playground.questionRequired")}
              </span>
            ) : null}
          </label>
        )}

        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <FieldSelect
            label={t("knowledge.test.playground.locale")}
            value={locale}
            onValueChange={setLocale}
            options={localeOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
          <FieldSelect
            label={t("knowledge.test.playground.channel")}
            value={channelType}
            onValueChange={(value) => setChannelType(value as ChannelType)}
            options={channels.map((value) => ({ value, label: t(channelKeys[value]) }))}
          />
          <FieldSelect
            label={t("knowledge.test.playground.audience")}
            value={audience}
            onValueChange={(value) => setAudience(value as KnowledgeV2Audience)}
            options={audiences.map((value) => ({ value, label: t(audienceKeys[value]) }))}
          />
          <FieldSelect
            label={t("knowledge.test.playground.brand")}
            value={brandId || "ALL"}
            onValueChange={(value) => setBrandId(value === "ALL" ? "" : value)}
            options={[
              { value: "ALL", label: t("knowledge.test.playground.allBrands") },
              ...brandOptions.map((value) => ({ value, label: value })),
            ]}
          />
          <FieldSelect
            label={t("knowledge.test.playground.location")}
            value={locationId || "ALL"}
            onValueChange={(value) => setLocationId(value === "ALL" ? "" : value)}
            options={[
              { value: "ALL", label: t("knowledge.test.playground.allLocations") },
              ...locationOptions.map((value) => ({ value, label: value })),
            ]}
          />
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              {t("knowledge.test.playground.segment")}
            </span>
            <input
              value={segment}
              maxLength={128}
              onChange={(event) => setSegment(event.target.value)}
              placeholder={t("knowledge.test.playground.segmentPlaceholder")}
              className={inputClass}
            />
          </label>
        </div>

        <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full min-w-0 lg:max-w-md">
            <FieldSelect
              label={t("knowledge.test.playground.target")}
              value={target}
              onValueChange={(value) => setTarget(value as "ACTIVE" | "DRAFT")}
              options={[
                ...(overview.readiness.activePublicationId
                  ? [
                      {
                        value: "ACTIVE",
                        label: t("knowledge.test.playground.targetActive", {
                          number: formatNumber(overview.readiness.activePublicationSequence ?? 0),
                        }),
                      },
                    ]
                  : []),
                {
                  value: "DRAFT",
                  label: t("knowledge.test.playground.targetDraft", {
                    number: formatNumber(overview.readiness.candidateVersion),
                  }),
                },
              ]}
            />
            {draftTestUnavailable ? (
              <p
                id="knowledge-test-draft-validation-required"
                className="mt-1.5 text-xs text-amber-300"
                data-testid="knowledge-test-draft-validation-required"
              >
                {t(
                  draftHasBlockers
                    ? "knowledge.test.playground.draftHasBlockers"
                    : "knowledge.test.playground.draftNeedsValidation",
                )}
              </p>
            ) : !overview.readiness.activePublicationId ? (
              <p className="mt-1.5 text-xs text-amber-300">
                {t("knowledge.test.playground.targetUnavailable")}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {draftTestUnavailable ? (
              <Button
                variant="outline"
                onClick={() => onNavigate(draftHasBlockers ? "overview" : "history")}
                data-testid="knowledge-test-draft-remediation"
              >
                {t(
                  draftHasBlockers
                    ? "knowledge.test.playground.draftResolveAction"
                    : "knowledge.history.validate",
                )}
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              disabled={starting || running || draftTestUnavailable}
              aria-describedby={
                draftTestUnavailable ? "knowledge-test-draft-validation-required" : undefined
              }
              onClick={() => void startRun()}
              data-testid="knowledge-test-run"
            >
              {starting || running ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <CirclePlay className="mr-2 h-4 w-4" />
              )}
              {t(
                starting || running
                  ? "knowledge.test.playground.running"
                  : "knowledge.test.playground.run",
              )}
            </Button>
          </div>
        </div>
      </div>

      {runError ? (
        <TestError
          error={runError}
          onRetry={run && activeRun(run.status) ? () => void refreshRun(run.id) : undefined}
        />
      ) : null}

      {loadingStoredRun && !run ? (
        <LoadingOverlay label={t("knowledge.test.playground.running")} />
      ) : run ? (
        <TestRunResult
          run={run}
          pollPaused={pollPaused}
          onRefresh={() => {
            pollCount.current = 0;
            setPollPaused(false);
            void refreshRun(run.id);
          }}
        />
      ) : (
        <EmptyState
          icon={Beaker}
          title={t("knowledge.test.tab.playground")}
          description={t("knowledge.test.description")}
          className="min-h-[260px] rounded-lg border border-white/10 bg-zinc-950/20"
        />
      )}
    </div>
  );

  function TestRunResult({
    run,
    pollPaused,
    onRefresh,
  }: {
    run: KnowledgeV2TestRunView;
    pollPaused: boolean;
    onRefresh: () => void;
  }) {
    const progress = Math.max(0, Math.min(100, run.progress.percent ?? 0));
    return (
      <article className="min-w-0 border-y border-white/10" data-testid="knowledge-test-result">
        <div className="flex min-w-0 flex-col gap-3 border-b border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge status={runStatusTone(run.status)}>
              {t(runStatusKeys[run.status])}
            </StatusBadge>
            <span className="break-words text-sm text-zinc-400">
              {run.target === "ACTIVE"
                ? t("knowledge.test.result.publication", {
                    number: formatNumber(run.publicationSequence ?? 0),
                  })
                : t("knowledge.test.result.draft", {
                    number: formatNumber(run.candidateVersion ?? 0),
                  })}
            </span>
          </div>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("knowledge.common.refresh")}
            onClick={onRefresh}
          >
            <RefreshCw className={cn("h-4 w-4", activeRun(run.status) && "animate-spin")} />
          </Button>
        </div>

        {activeRun(run.status) ? (
          <div className="py-8">
            <div className="mx-auto max-w-lg text-center">
              <Spinner className="mx-auto h-6 w-6" />
              <p className="mt-3 text-sm font-medium text-zinc-200">
                {t("knowledge.test.playground.running")}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{stageLabel(run.progress.stage)}</p>
              <div
                className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5"
                aria-hidden="true"
              >
                <div
                  className="h-full bg-emerald-400 transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="sr-only">{formatNumber(progress)}%</span>
              {pollPaused ? (
                <p className="mt-4 text-xs text-amber-300">
                  {t("knowledge.test.playground.pollPaused")}
                </p>
              ) : null}
            </div>
          </div>
        ) : run.status === "FAILED" ? (
          <TerminalRunState
            icon={TriangleAlert}
            title={t("knowledge.test.result.failedTitle")}
            description={t(testErrorKey(run.error?.code, undefined, "knowledge.test.error.failed"))}
          />
        ) : run.status === "CANCELLED" ? (
          <TerminalRunState
            icon={AlertTriangle}
            title={t("knowledge.test.result.cancelledTitle")}
            description={t(
              testErrorKey(run.error?.code, undefined, "knowledge.test.error.cancelled"),
            )}
          />
        ) : !run.result ? (
          <TerminalRunState
            icon={ShieldAlert}
            title={t("knowledge.test.playground.resultMissing")}
            description={t("knowledge.test.playground.resultMissing")}
          />
        ) : (
          <CompletedResult run={run} />
        )}
      </article>
    );
  }

  function CompletedResult({ run }: { run: KnowledgeV2TestRunView }) {
    const result = run.result;
    const snapshotId = run.target === "ACTIVE" ? run.publicationId : run.candidateId;
    return (
      <div className="min-w-0 py-5">
        <div className="mb-5 min-w-0 border-b border-white/10 pb-4">
          <p className="text-xs text-zinc-600">{t("knowledge.test.result.snapshotId")}</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-400">
            {snapshotId ?? t("knowledge.common.notRecorded")}
          </p>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <ResultDecision
            label={t("knowledge.test.result.behavior")}
            value={t(outcomeKeys[result.outcome])}
            tone={result.outcome === "FAILED" ? "error" : "info"}
          />
          <ResultDecision
            label={t("knowledge.test.result.disposition")}
            value={t(dispositionKeys[result.disposition])}
            tone={dispositionTone(result.disposition)}
          />
        </div>

        <ResultSection title={t("knowledge.test.result.finalAnswer")}>
          {result.finalTextRedacted ? (
            <RestrictedLine label={t("knowledge.test.result.redacted")} />
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">
              {result.finalText || t("knowledge.test.result.noText")}
            </p>
          )}
        </ResultSection>

        {result.gateReasons.length > 0 ? (
          <ResultSection title={t("knowledge.test.result.gateReasons")}>
            <SafeList values={result.gateReasons.map((value) => gateReasonLabel(value))} />
          </ResultSection>
        ) : null}

        <ResultSection title={t("knowledge.test.result.facts")}>
          {result.facts.length === 0 ? (
            <EmptyResult />
          ) : (
            <div className="grid min-w-0 gap-2 md:grid-cols-2">
              {result.facts.map((fact) => (
                <div
                  key={fact.factId}
                  className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3"
                >
                  <p className="break-words text-sm font-medium text-zinc-200">{fact.safeLabel}</p>
                  {fact.redacted ? (
                    <RestrictedLine label={t("knowledge.test.result.restrictedEvidence")} />
                  ) : (
                    <p className="mt-1 break-words text-sm text-zinc-400">
                      {fact.safeValue ?? t("knowledge.test.result.none")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-600">
                    <span>{verificationLabel(fact.verificationStatus)}</span>
                    <span>{authorityLabel(fact.authority)}</span>
                    {fact.expiresAt ? (
                      <span>
                        {t("knowledge.test.result.freshUntil", {
                          date: formatDate(fact.expiresAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ResultSection>

        <ResultSection title={t("knowledge.test.result.guidance")}>
          {result.guidance.length === 0 ? (
            <EmptyResult />
          ) : (
            <div className="space-y-2">
              {result.guidance.map((rule) => (
                <div
                  key={rule.guidanceRuleId}
                  className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="break-words text-sm font-medium text-zinc-200">
                      {rule.safeLabel}
                    </p>
                    <StatusBadge status={riskTone(rule.riskLevel)}>
                      {t(riskKeys[rule.riskLevel])}
                    </StatusBadge>
                  </div>
                  {rule.redacted ? (
                    <RestrictedLine label={t("knowledge.test.result.restrictedEvidence")} />
                  ) : rule.safeSummary ? (
                    <p className="mt-2 break-words text-sm text-zinc-500">{rule.safeSummary}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </ResultSection>

        <ResultSection title={t("knowledge.test.result.documents")}>
          {result.documents.length === 0 ? (
            <EmptyResult />
          ) : (
            <div className="space-y-2">
              {result.documents.map((document) => {
                const publicUrl = safePublicUrl(
                  document.anchor.publicUrl,
                  document.isPublic,
                  document.redacted,
                );
                return (
                  <div
                    key={document.evidenceReferenceId}
                    className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-zinc-200">
                          {document.safeLabel}
                        </p>
                        {document.redacted ? (
                          <RestrictedLine label={t("knowledge.test.result.restrictedEvidence")} />
                        ) : document.safeExcerpt ? (
                          <p className="mt-1 break-words text-sm leading-5 text-zinc-500">
                            {document.safeExcerpt}
                          </p>
                        ) : null}
                      </div>
                      {publicUrl ? (
                        <a
                          href={publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t("knowledge.test.result.openSource")}
                        </a>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-zinc-600">
                          <LockKeyhole className="h-3.5 w-3.5" />
                          {t("knowledge.test.result.internalLinkHidden")}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600">
                      {document.anchor.pageNumber ? (
                        <span>
                          {t("knowledge.test.result.page", {
                            number: formatNumber(document.anchor.pageNumber),
                          })}
                        </span>
                      ) : null}
                      {document.anchor.headingPath.map((heading) => (
                        <span key={heading}>{heading}</span>
                      ))}
                      {document.observedAt ? (
                        <span>
                          {t("knowledge.test.result.observed", {
                            date: formatDate(document.observedAt, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }),
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ResultSection>

        <ResultSection title={t("knowledge.test.result.tools")}>
          {result.toolCalls.length === 0 ? (
            <EmptyResult />
          ) : (
            <div className="grid min-w-0 gap-2 md:grid-cols-2">
              {result.toolCalls.map((tool) => (
                <div
                  key={tool.toolCallId}
                  className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="break-words text-sm font-medium text-zinc-200">{tool.safeName}</p>
                    <StatusBadge
                      status={
                        tool.status === "SUCCEEDED"
                          ? "success"
                          : tool.status === "FAILED"
                            ? "error"
                            : "info"
                      }
                    >
                      {t(toolStatusKeys[tool.status])}
                    </StatusBadge>
                  </div>
                  {tool.redacted ? (
                    <RestrictedLine label={t("knowledge.test.result.restrictedEvidence")} />
                  ) : tool.safeSummary ? (
                    <p className="mt-2 break-words text-sm text-zinc-500">{tool.safeSummary}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600">
                    {tool.observedAt ? (
                      <span>
                        {t("knowledge.test.result.observed", {
                          date: formatDate(tool.observedAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
                      </span>
                    ) : null}
                    {tool.expiresAt ? (
                      <span>
                        {t("knowledge.test.result.freshUntil", {
                          date: formatDate(tool.expiresAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ResultSection>

        <div className="grid min-w-0 gap-5 border-t border-white/10 pt-5 lg:grid-cols-3">
          <ResultGroup title={t("knowledge.test.result.conflicts")} icon={AlertTriangle}>
            {result.conflicts.length === 0 ? (
              <EmptyResult />
            ) : (
              result.conflicts.map((conflict) => (
                <div
                  key={conflict.conflictId}
                  className="mb-2 min-w-0 rounded-md border border-white/10 px-3 py-2 last:mb-0"
                >
                  <p className="break-words text-sm text-zinc-300">
                    {conflict.redacted
                      ? t("knowledge.test.result.restrictedEvidence")
                      : conflict.safeLabel}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-600">
                    <span>{conflictStatusLabel(conflict.status)}</span>
                    <span>{t(riskKeys[conflict.riskLevel])}</span>
                  </div>
                </div>
              ))
            )}
          </ResultGroup>
          <ResultGroup title={t("knowledge.test.result.missing")} icon={FileText}>
            {result.missingSupport.length ? (
              <SafeList values={result.missingSupport.map((value) => missingSupportLabel(value))} />
            ) : (
              <EmptyResult />
            )}
          </ResultGroup>
          <ResultGroup title={t("knowledge.test.result.suppressed")} icon={ShieldAlert}>
            {result.suppressedEvidence.length ? (
              <SafeList
                values={result.suppressedEvidence.map(
                  (item) => `${t(suppressionKeys[item.reason])}: ${formatNumber(item.count)}`,
                )}
              />
            ) : (
              <EmptyResult />
            )}
          </ResultGroup>
        </div>
      </div>
    );
  }

  function stageLabel(stage: KnowledgeV2TestRunView["progress"]["stage"]) {
    const labels: Record<typeof stage, string> = {
      QUEUED: t("knowledge.test.stage.queued"),
      CHECKING_KNOWLEDGE: t("knowledge.test.stage.checkingKnowledge"),
      PREPARING_RESPONSE: t("knowledge.test.stage.preparingResponse"),
      CHECKING_POLICY: t("knowledge.test.stage.checkingPolicy"),
      COMPLETE: t("knowledge.test.stage.complete"),
    };
    return labels[stage];
  }

  function gateReasonLabel(value: KnowledgeV2TestGateReason) {
    const labels: Record<string, string> = {
      SUFFICIENT_SUPPORT: t("knowledge.test.outcome.answered"),
      MISSING_SUPPORT: t("knowledge.test.result.missing"),
      CONFLICT: t("knowledge.test.result.conflicts"),
      STALE_INFORMATION: t("knowledge.test.suppression.stale"),
      SENSITIVE_CONTENT: t("knowledge.test.suppression.policy"),
      TOOL_FAILURE: t("knowledge.test.tool.failed"),
      POLICY_REQUIRES_APPROVAL: t("knowledge.test.disposition.hold"),
      POLICY_REQUIRES_HANDOFF: t("knowledge.test.disposition.handoff"),
      PUBLICATION_UNAVAILABLE: t("knowledge.test.playground.targetUnavailable"),
      UNKNOWN: t("knowledge.test.result.none"),
    };
    return labels[value] ?? labels.UNKNOWN;
  }

  function missingSupportLabel(value: KnowledgeV2TestMissingSupport) {
    const labels: Record<string, string> = {
      REQUIRED_FACT: t("knowledge.test.expectation.requiredFact"),
      REQUIRED_GUIDANCE: t("knowledge.test.expectation.requiredGuidance"),
      REQUIRED_EVIDENCE: t("knowledge.test.expectation.requiredEvidence"),
      FRESH_TOOL_RESULT: t("knowledge.test.expectation.requiredTool"),
      SCOPE_MATCH: t("knowledge.test.playground.location"),
      PERMISSION: t("knowledge.test.suppression.permission"),
      UNKNOWN: t("knowledge.test.result.none"),
    };
    return labels[value] ?? labels.UNKNOWN;
  }

  function verificationLabel(value: KnowledgeV2VerificationStatus) {
    const labels: Record<KnowledgeV2VerificationStatus, string> = {
      UNVERIFIED: t("knowledge.business.verification.unverified"),
      PENDING_REVIEW: t("knowledge.business.verification.pendingReview"),
      VERIFIED: t("knowledge.business.verification.verified"),
      REJECTED: t("knowledge.business.verification.rejected"),
      CONFLICTED: t("knowledge.business.verification.conflicted"),
    };
    return labels[value];
  }

  function authorityLabel(value: KnowledgeV2FactAuthority) {
    const labels: Record<KnowledgeV2FactAuthority, string> = {
      INFERRED: t("knowledge.business.authority.inferred"),
      IMPORTED: t("knowledge.business.authority.imported"),
      MANUAL: t("knowledge.business.authority.manual"),
      TRUSTED_SOURCE: t("knowledge.business.authority.trustedSource"),
      OWNER_VERIFIED: t("knowledge.business.authority.ownerVerified"),
    };
    return labels[value];
  }

  function conflictStatusLabel(value: KnowledgeV2ConflictStatus) {
    if (value === "RESOLVED") return t("knowledge.review.status.resolved");
    if (value === "DISMISSED") return t("knowledge.review.status.dismissed");
    if (value === "IN_REVIEW") return t("knowledge.review.status.inReview");
    if (value === "SUPERSEDED") return t("knowledge.review.status.superseded");
    return t("knowledge.review.status.open");
  }
}

function FieldSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: React.ReactNode }>;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>
      <Select
        value={value}
        onValueChange={onValueChange}
        options={options}
        ariaLabel={label}
        className="h-10 rounded-md"
      />
    </label>
  );
}

function TestError({ error, onRetry }: { error: ApiClientError; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3" role="alert">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm text-rose-200">
            {t(testErrorKey(error.code, error.status))}
          </p>
          {error.requestId ? (
            <p className="mt-1 text-xs text-rose-200/55">
              {t("knowledge.common.request", { id: error.requestId })}
            </p>
          ) : null}
          {onRetry ? (
            <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
              {t("knowledge.common.tryAgain")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TerminalRunState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/10">
        <Icon className="h-5 w-5 text-rose-400" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-200">{title}</h3>
      <p className="mt-1.5 max-w-md break-words text-sm text-zinc-500">{description}</p>
    </div>
  );
}

function ResultDecision({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "info" | "error";
}) {
  return (
    <div className="min-w-0 border-b border-white/10 pb-4">
      <p className="text-xs text-zinc-600">{label}</p>
      <div className="mt-2">
        <StatusBadge status={tone}>{value}</StatusBadge>
      </div>
    </div>
  );
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 min-w-0 border-t border-white/10 pt-5">
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function ResultGroup({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-500" />
        {title}
      </h3>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function EmptyResult() {
  const { t } = useI18n();
  return <p className="text-sm text-zinc-600">{t("knowledge.test.result.none")}</p>;
}

function RestrictedLine({ label }: { label: string }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
      <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {label}
    </p>
  );
}

function SafeList({ values }: { values: string[] }) {
  return (
    <ul className="space-y-1.5">
      {values.map((value, index) => (
        <li key={`${value}:${index}`} className="flex items-start gap-2 text-sm text-zinc-400">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
          <span className="break-words">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function TestCasesPanel({
  canManageTests,
  scopeOptions,
  onRun,
  onChanged,
}: {
  canManageTests: boolean;
  scopeOptions: ScopeOptions;
  onRun: (item: KnowledgeV2TestCaseView) => void;
  onChanged: () => void;
}) {
  const { t, locale, formatNumber } = useI18n();
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [status, setStatus] = React.useState<CaseFilter<KnowledgeV2TestCaseStatus>>("ALL");
  const [risk, setRisk] = React.useState<CaseFilter<KnowledgeV2RiskLevel>>("ALL");
  const [items, setItems] = React.useState<KnowledgeV2TestCaseView[]>([]);
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [listError, setListError] = React.useState<ApiClientError | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<KnowledgeV2TestCaseView | null>(null);
  const [detailEtag, setDetailEtag] = React.useState<string | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<ApiClientError | null>(null);
  const [editing, setEditing] = React.useState<EditingCase | null>(null);
  const [draft, setDraft] = React.useState<TestCaseDraft>(() => blankDraft(locale));
  const [dirtyFields, setDirtyFields] = React.useState<Set<TestCaseDraftKey>>(() => new Set());
  const [formLoading, setFormLoading] = React.useState(false);
  const [formInputUnavailable, setFormInputUnavailable] = React.useState(false);
  const [formBusy, setFormBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<ApiClientError | null>(null);
  const [formValidation, setFormValidation] = React.useState(false);
  const [formStale, setFormStale] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [archiveReason, setArchiveReason] = React.useState("");
  const [archiveValidation, setArchiveValidation] = React.useState(false);
  const [archiveBusy, setArchiveBusy] = React.useState(false);
  const [archiveError, setArchiveError] = React.useState<ApiClientError | null>(null);
  const [archiveStale, setArchiveStale] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const mounted = React.useRef(false);
  const listSequence = React.useRef(0);
  const detailSequence = React.useRef(0);
  const nextCursor = React.useRef<string | null>(null);
  const itemCount = React.useRef(0);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadCases = React.useCallback(
    async ({ append = false, silent = false }: { append?: boolean; silent?: boolean } = {}) => {
      const sequence = ++listSequence.current;
      if (append) setLoadingMore(true);
      else if (!silent) setLoading(true);
      try {
        const page = await listKnowledgeV2TestCases({
          limit: append
            ? TEST_CASE_PAGE_SIZE
            : Math.min(Math.max(TEST_CASE_PAGE_SIZE, itemCount.current), 100),
          ...(append && nextCursor.current ? { cursor: nextCursor.current } : {}),
          ...(status === "ALL" ? {} : { status }),
          ...(risk === "ALL" ? {} : { riskLevel: risk }),
          ...(debouncedQuery ? { query: debouncedQuery } : {}),
        });
        if (!mounted.current || sequence !== listSequence.current) return;
        setItems((current) => {
          const next = append
            ? [
                ...current,
                ...page.items.filter((item) => !current.some((entry) => entry.id === item.id)),
              ]
            : page.items;
          itemCount.current = next.length;
          return next;
        });
        nextCursor.current = page.pageInfo.nextCursor;
        setHasNextPage(page.pageInfo.hasNextPage);
        setListError(null);
        if (!append) {
          setSelectedId((current) =>
            current && page.items.some((item) => item.id === current)
              ? current
              : (page.items[0]?.id ?? null),
          );
        }
      } catch (caught) {
        if (!mounted.current || sequence !== listSequence.current) return;
        if (!silent || itemCount.current === 0) {
          setListError(apiError(caught, t("knowledge.test.cases.error")));
        }
      } finally {
        if (mounted.current && sequence === listSequence.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedQuery, risk, status, t],
  );

  const loadDetail = React.useCallback(
    async (id: string, silent = false) => {
      const sequence = ++detailSequence.current;
      if (!silent) setDetailLoading(true);
      try {
        const response = await getKnowledgeV2TestCase(id);
        if (!mounted.current || sequence !== detailSequence.current) return;
        setDetail(response.data);
        setDetailEtag(responseEtag(response.headers, response.data.etag));
        setItems((current) =>
          current.map((item) => (item.id === response.data.id ? response.data : item)),
        );
        setDetailError(null);
      } catch (caught) {
        if (!mounted.current || sequence !== detailSequence.current) return;
        setDetailError(apiError(caught, t("knowledge.test.cases.error")));
        if (!silent) setDetail(null);
      } finally {
        if (mounted.current && sequence === detailSequence.current) setDetailLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    itemCount.current = 0;
    nextCursor.current = null;
    void loadCases();
  }, [loadCases]);

  React.useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [loadDetail, selectedId]);

  React.useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      void loadCases({ silent: true });
      if (selectedId && !editing && !archiveOpen) void loadDetail(selectedId, true);
    }
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [archiveOpen, editing, loadCases, loadDetail, selectedId]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function updateDraft<Key extends TestCaseDraftKey>(key: Key, value: TestCaseDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirtyFields((current) => new Set(current).add(key));
    setFormValidation(false);
    if (!formInputUnavailable) setFormError(null);
  }

  function openCreate() {
    setEditing({ mode: "CREATE", item: null, etag: null });
    setDraft(blankDraft(locale));
    setDirtyFields(new Set());
    setFormError(null);
    setFormValidation(false);
    setFormStale(false);
    setFormLoading(false);
    setFormInputUnavailable(false);
  }

  async function openEdit(item: KnowledgeV2TestCaseView) {
    setEditing({ mode: "EDIT", item, etag: item.etag });
    setDraft(draftFromCase(item));
    setDirtyFields(new Set());
    setFormError(null);
    setFormValidation(false);
    setFormStale(false);
    setFormLoading(true);
    setFormInputUnavailable(false);
    try {
      const [detailResponse, inputResponse] = await Promise.all([
        getKnowledgeV2TestCase(item.id),
        getKnowledgeV2TestCaseInput(item.id),
      ]);
      setEditing({
        mode: "EDIT",
        item: detailResponse.data,
        etag: responseEtag(detailResponse.headers, detailResponse.data.etag),
      });
      setDraft(draftFromCase(detailResponse.data, inputResponse.data.question));
    } catch (caught) {
      setFormInputUnavailable(true);
      setFormError(apiError(caught, t("knowledge.test.form.error")));
    } finally {
      setFormLoading(false);
    }
  }

  function validDraft() {
    return Boolean(
      draft.safeLabel.trim().length >= 2 &&
      draft.datasetVersion.trim() &&
      (editing?.mode === "CREATE" ||
        !dirtyFields.has("question") ||
        draft.question.trim().length >= 2) &&
      !formInputUnavailable,
    );
  }

  function parsedSlices() {
    return unique(
      draft.sliceKeys
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  async function reloadFormAfterConflict(
    currentDraft: TestCaseDraft,
    dirty: Set<TestCaseDraftKey>,
  ) {
    if (!editing?.item) return;
    try {
      const [detailResponse, inputResponse] = await Promise.all([
        getKnowledgeV2TestCase(editing.item.id),
        getKnowledgeV2TestCaseInput(editing.item.id),
      ]);
      setEditing({
        mode: "EDIT",
        item: detailResponse.data,
        etag: responseEtag(detailResponse.headers, detailResponse.data.etag),
      });
      setDraft(
        mergeDraft(
          draftFromCase(detailResponse.data, inputResponse.data.question),
          currentDraft,
          dirty,
        ),
      );
      setFormStale(true);
      setFormError(null);
      setFormInputUnavailable(false);
    } catch (caught) {
      setFormInputUnavailable(true);
      setFormError(apiError(caught, t("knowledge.test.form.error")));
    }
  }

  async function saveForm() {
    if (!editing || !validDraft()) {
      setFormValidation(true);
      return;
    }
    const currentDraft = draft;
    const currentDirty = new Set(dirtyFields);
    setFormBusy(true);
    setFormError(null);
    setFormValidation(false);
    try {
      if (editing.mode === "CREATE") {
        const body: KnowledgeV2CreateTestCaseRequest = {
          safeLabel: draft.safeLabel.trim(),
          status: draft.status,
          riskLevel: draft.riskLevel,
          critical: draft.critical,
          question: draft.question.trim(),
          expectedBehavior: draft.expectedBehavior,
          locale: draft.locale,
          channelType: draft.channelType,
          audience: draft.audience,
          scope: scopeInput(draft.brandId, draft.locationId, draft.segment),
          sliceKeys: parsedSlices(),
          datasetVersion: draft.datasetVersion.trim(),
          expectations: [],
        };
        const response = await createKnowledgeV2TestCase(body, {
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        });
        setSelectedId(response.data.resource.id);
        setDetail(response.data.resource);
        setDetailEtag(responseEtag(response.headers, response.data.resource.etag));
      } else {
        if (!editing.item || !editing.etag || dirtyFields.size === 0) {
          setEditing(null);
          return;
        }
        const body: KnowledgeV2UpdateTestCaseRequest = {};
        if (dirtyFields.has("safeLabel")) body.safeLabel = draft.safeLabel.trim();
        if (dirtyFields.has("status")) body.status = draft.status;
        if (dirtyFields.has("riskLevel")) body.riskLevel = draft.riskLevel;
        if (dirtyFields.has("critical")) body.critical = draft.critical;
        if (dirtyFields.has("question")) body.question = draft.question.trim();
        if (dirtyFields.has("expectedBehavior")) body.expectedBehavior = draft.expectedBehavior;
        if (dirtyFields.has("locale")) body.locale = draft.locale;
        if (dirtyFields.has("channelType")) body.channelType = draft.channelType;
        if (dirtyFields.has("audience")) body.audience = draft.audience;
        if (
          dirtyFields.has("brandId") ||
          dirtyFields.has("locationId") ||
          dirtyFields.has("segment")
        ) {
          body.scope = scopeInput(draft.brandId, draft.locationId, draft.segment);
        }
        if (dirtyFields.has("sliceKeys")) body.sliceKeys = parsedSlices();
        if (dirtyFields.has("datasetVersion")) {
          body.datasetVersion = draft.datasetVersion.trim();
        }
        const response = await updateKnowledgeV2TestCase(editing.item.id, body, {
          "If-Match": editing.etag,
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        });
        setSelectedId(response.data.resource.id);
        setDetail(response.data.resource);
        setDetailEtag(responseEtag(response.headers, response.data.resource.etag));
        setItems((current) =>
          current.map((item) =>
            item.id === response.data.resource.id ? response.data.resource : item,
          ),
        );
      }
      setEditing(null);
      setDraft(blankDraft(locale));
      setDirtyFields(new Set());
      setNotice(t("knowledge.test.form.saved"));
      void loadCases({ silent: true });
      if (selectedId) void loadDetail(selectedId, true);
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.test.form.error"));
      if (error.status === 412 && editing.mode === "EDIT") {
        await reloadFormAfterConflict(currentDraft, currentDirty);
      } else {
        setFormError(error);
      }
    } finally {
      setFormBusy(false);
    }
  }

  function openArchive() {
    if (!detail) return;
    setArchiveOpen(true);
    setArchiveReason("");
    setArchiveValidation(false);
    setArchiveError(null);
    setArchiveStale(false);
  }

  async function archiveCase() {
    if (!detail || !detailEtag) return;
    if (archiveReason.trim().length < 3) {
      setArchiveValidation(true);
      return;
    }
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const response = await archiveKnowledgeV2TestCase(
        detail.id,
        { reason: archiveReason.trim() },
        {
          "If-Match": detailEtag,
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
        },
      );
      setDetail(response.data.resource);
      setDetailEtag(responseEtag(response.headers, response.data.resource.etag));
      setArchiveOpen(false);
      setNotice(t("knowledge.test.archive.saved"));
      void loadCases({ silent: true });
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.test.form.error"));
      if (error.status === 412) {
        try {
          const response = await getKnowledgeV2TestCase(detail.id);
          setDetail(response.data);
          setDetailEtag(responseEtag(response.headers, response.data.etag));
          setArchiveStale(true);
        } catch (reloadError) {
          setArchiveError(apiError(reloadError, t("knowledge.test.form.error")));
        }
      } else {
        setArchiveError(error);
      }
    } finally {
      setArchiveBusy(false);
    }
  }

  const hasFilters = Boolean(debouncedQuery || status !== "ALL" || risk !== "ALL");

  return (
    <div className="min-w-0 space-y-4" data-testid="knowledge-test-cases">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-zinc-100">
            {t("knowledge.test.cases.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            {t("knowledge.test.cases.description")}
          </p>
        </div>
        {canManageTests ? (
          <Button onClick={openCreate} data-testid="knowledge-test-case-add">
            <Plus className="mr-2 h-4 w-4" />
            {t("knowledge.test.cases.add")}
          </Button>
        ) : null}
      </div>

      {!canManageTests ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-200">
              {t("knowledge.test.permissionTitle")}
            </p>
            <p className="mt-0.5 text-xs text-amber-200/65">{t("knowledge.test.permissionBody")}</p>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div
          className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-200"
          role="status"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(220px,1.5fr)_minmax(150px,1fr)_minmax(150px,1fr)]">
        <label className="relative min-w-0">
          <span className="sr-only">{t("knowledge.test.cases.search")}</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-600" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("knowledge.test.cases.search")}
            aria-label={t("knowledge.test.cases.search")}
            className={cn(inputClass, "pl-9")}
          />
        </label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as CaseFilter<KnowledgeV2TestCaseStatus>)}
          ariaLabel={t("knowledge.test.form.status")}
          className="h-10 rounded-md"
          options={[
            { value: "ALL", label: t("knowledge.test.cases.allStatuses") },
            ...caseStatuses.map((value) => ({ value, label: t(caseStatusKeys[value]) })),
          ]}
        />
        <Select
          value={risk}
          onValueChange={(value) => setRisk(value as CaseFilter<KnowledgeV2RiskLevel>)}
          ariaLabel={t("knowledge.test.form.risk")}
          className="h-10 rounded-md"
          options={[
            { value: "ALL", label: t("knowledge.test.cases.allRisks") },
            ...risks.map((value) => ({ value, label: t(riskKeys[value]) })),
          ]}
        />
      </div>

      <div className="grid min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/25 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 border-b border-white/10 lg:border-b-0 lg:border-r">
          {loading && items.length === 0 ? (
            <LoadingOverlay label={t("knowledge.test.cases.loading")} />
          ) : listError && items.length === 0 ? (
            <CaseError error={listError} onRetry={() => void loadCases()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={BookCheck}
              title={t(
                hasFilters ? "knowledge.test.cases.noMatches" : "knowledge.test.cases.emptyTitle",
              )}
              description={hasFilters ? undefined : t("knowledge.test.cases.emptyBody")}
              className="min-h-[360px]"
            />
          ) : (
            <div className="min-w-0 p-2" role="list">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  aria-current={selectedId === item.id ? "true" : undefined}
                  data-testid={`knowledge-test-case-${item.id}`}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "mb-1.5 flex w-full min-w-0 items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors last:mb-0",
                    selectedId === item.id
                      ? "border-emerald-500/30 bg-emerald-500/[0.07]"
                      : "border-transparent hover:border-white/10 hover:bg-white/[0.035]",
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-400">
                    <Beaker className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-zinc-100">
                      {item.safeLabel}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StatusBadge status={caseStatusTone(item.status)}>
                        {t(caseStatusKeys[item.status])}
                      </StatusBadge>
                      <StatusBadge status={riskTone(item.riskLevel)}>
                        {t(riskKeys[item.riskLevel])}
                      </StatusBadge>
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      "mt-2 h-4 w-4 shrink-0",
                      selectedId === item.id ? "text-emerald-400" : "text-zinc-700",
                    )}
                  />
                </button>
              ))}
              {hasNextPage ? (
                <div className="flex justify-center border-t border-white/10 px-3 py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={() => void loadCases({ append: true })}
                  >
                    {loadingMore ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {t("knowledge.review.loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="min-h-[420px] min-w-0">
          {detailLoading && !detail ? (
            <LoadingOverlay label={t("knowledge.test.cases.loading")} />
          ) : detailError && !detail ? (
            <CaseError
              error={detailError}
              onRetry={() => selectedId && void loadDetail(selectedId)}
            />
          ) : !detail ? (
            <EmptyState
              icon={Library}
              title={t("knowledge.test.cases.select")}
              description={t("knowledge.test.cases.protectedQuestion")}
              className="min-h-[420px]"
            />
          ) : (
            <CaseDetail
              item={detail}
              canManageTests={canManageTests}
              onRun={() => onRun(detail)}
              onEdit={() => void openEdit(detail)}
              onArchive={openArchive}
            />
          )}
        </div>
      </div>

      <TestCaseFormModal
        editing={editing}
        draft={draft}
        dirtyFields={dirtyFields}
        scopeOptions={scopeOptions}
        loading={formLoading}
        busy={formBusy}
        error={formError}
        inputUnavailable={formInputUnavailable}
        validation={formValidation}
        stale={formStale}
        onOpenChange={(open) => {
          if (!open && !formBusy) {
            setEditing(null);
            setDraft(blankDraft(locale));
            setDirtyFields(new Set());
            setFormError(null);
            setFormInputUnavailable(false);
          }
        }}
        onChange={updateDraft}
        onSave={() => void saveForm()}
      />

      <Modal
        open={archiveOpen}
        onOpenChange={(open) => {
          if (!archiveBusy) setArchiveOpen(open);
        }}
        title={t("knowledge.test.archive.title")}
        description={t("knowledge.test.archive.description")}
        className="max-w-lg rounded-lg"
        footer={
          <>
            <Button variant="outline" disabled={archiveBusy} onClick={() => setArchiveOpen(false)}>
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              disabled={archiveBusy}
              className="bg-rose-500 text-white hover:bg-rose-600"
              onClick={() => void archiveCase()}
              data-testid="knowledge-test-archive-confirm"
            >
              {archiveBusy ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <Archive className="mr-2 h-4 w-4" />
              )}
              {t("knowledge.test.archive.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {archiveStale ? <StaleNotice /> : null}
          {archiveError ? <TestError error={archiveError} /> : null}
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              {t("knowledge.test.archive.reason")}
            </span>
            <textarea
              value={archiveReason}
              onChange={(event) => {
                setArchiveReason(event.target.value);
                if (event.target.value.trim().length >= 3) setArchiveValidation(false);
              }}
              aria-invalid={archiveValidation}
              placeholder={t("knowledge.test.archive.reasonPlaceholder")}
              className={textareaClass}
              data-testid="knowledge-test-archive-reason"
            />
            {archiveValidation ? (
              <span className="mt-1.5 block text-xs text-rose-400">
                {t("knowledge.test.archive.validation")}
              </span>
            ) : null}
          </label>
        </div>
      </Modal>
    </div>
  );

  function CaseDetail({
    item,
    canManageTests,
    onRun,
    onEdit,
    onArchive,
  }: {
    item: KnowledgeV2TestCaseView;
    canManageTests: boolean;
    onRun: () => void;
    onEdit: () => void;
    onArchive: () => void;
  }) {
    const current = item.currentVersion;
    return (
      <article className="min-w-0 p-4 sm:p-5" data-testid="knowledge-test-case-detail">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={caseStatusTone(item.status)}>
                {t(caseStatusKeys[item.status])}
              </StatusBadge>
              <StatusBadge status={riskTone(item.riskLevel)}>
                {t(riskKeys[item.riskLevel])}
              </StatusBadge>
              {item.critical ? (
                <StatusBadge status="error">{t("knowledge.test.form.critical")}</StatusBadge>
              ) : null}
            </div>
            <h4 className="mt-3 break-words text-base font-semibold text-zinc-50">
              {item.safeLabel}
            </h4>
            <p className="mt-1 text-xs text-zinc-600">{t(originKeys[item.origin])}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.status !== "ARCHIVED" ? (
              <Button size="sm" onClick={onRun} data-testid="knowledge-test-case-run">
                <CirclePlay className="mr-2 h-4 w-4" />
                {t("knowledge.test.cases.run")}
              </Button>
            ) : null}
            {canManageTests && item.allowedActions.includes("EDIT") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                data-testid="knowledge-test-case-edit"
              >
                <Pencil className="mr-2 h-4 w-4" />
                {t("knowledge.test.cases.edit")}
              </Button>
            ) : null}
            {canManageTests && item.allowedActions.includes("ARCHIVE") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onArchive}
                data-testid="knowledge-test-case-archive"
              >
                <Archive className="mr-2 h-4 w-4" />
                {t("knowledge.test.cases.archive")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <p className="text-sm text-zinc-500">{t("knowledge.test.cases.protectedQuestion")}</p>
        </div>

        {current ? (
          <>
            <div className="mt-5 grid gap-x-5 gap-y-3 border-y border-white/10 py-4 sm:grid-cols-2">
              <CaseField
                label={t("knowledge.test.cases.version")}
                value={formatNumber(current.versionNumber)}
              />
              <CaseField
                label={t("knowledge.test.cases.expected")}
                value={t(behaviorKeys[current.expectedBehavior])}
              />
              <CaseField label={t("knowledge.test.playground.locale")} value={current.locale} />
              <CaseField
                label={t("knowledge.test.playground.channel")}
                value={t(channelKeys[current.channelType])}
              />
              <CaseField
                label={t("knowledge.test.playground.audience")}
                value={t(audienceKeys[current.audience])}
              />
              <CaseField label={t("knowledge.test.cases.dataset")} value={current.datasetVersion} />
            </div>
            <section className="mt-5">
              <h5 className="text-sm font-semibold text-zinc-200">
                {t("knowledge.test.cases.expectations")}
              </h5>
              {current.expectations.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">{t("knowledge.test.result.none")}</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {current.expectations.map((expectation) => (
                    <span
                      key={expectation.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.025] px-2.5 py-1.5 text-xs text-zinc-400"
                    >
                      {expectation.hasRestrictedExpectedValue ? (
                        <LockKeyhole className="h-3.5 w-3.5 text-amber-400" />
                      ) : null}
                      {t(expectationKeys[expectation.kind])}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </article>
    );
  }

  function StaleNotice() {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/[0.07] px-3 py-3"
        role="alert"
      >
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
        <div>
          <p className="text-sm font-medium text-sky-200">
            {t("knowledge.test.form.changedTitle")}
          </p>
          <p className="mt-0.5 text-xs text-sky-200/65">{t("knowledge.test.form.changedBody")}</p>
        </div>
      </div>
    );
  }
}

function CaseField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-600">{label}</p>
      <p className="mt-1 break-words text-sm text-zinc-300">{value}</p>
    </div>
  );
}

function CaseError({ error, onRetry }: { error: ApiClientError; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="h-5 w-5 text-rose-400" />
      <p className="mt-3 break-words text-sm text-zinc-300">
        {t(testErrorKey(error.code, error.status))}
      </p>
      <Button variant="outline" className="mt-4" onClick={onRetry}>
        {t("knowledge.common.tryAgain")}
      </Button>
    </div>
  );
}

function TestCaseFormModal({
  editing,
  draft,
  dirtyFields,
  scopeOptions,
  loading,
  busy,
  error,
  inputUnavailable,
  validation,
  stale,
  onOpenChange,
  onChange,
  onSave,
}: {
  editing: EditingCase | null;
  draft: TestCaseDraft;
  dirtyFields: ReadonlySet<TestCaseDraftKey>;
  scopeOptions: ScopeOptions;
  loading: boolean;
  busy: boolean;
  error: ApiClientError | null;
  inputUnavailable: boolean;
  validation: boolean;
  stale: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: <Key extends TestCaseDraftKey>(key: Key, value: TestCaseDraft[Key]) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const isEdit = editing?.mode === "EDIT";
  const brandOptions = unique([...(draft.brandId ? [draft.brandId] : []), ...scopeOptions.brands]);
  const locationOptions = unique([
    ...(draft.locationId ? [draft.locationId] : []),
    ...scopeOptions.locations,
  ]);
  return (
    <Modal
      open={editing !== null}
      onOpenChange={onOpenChange}
      title={t(isEdit ? "knowledge.test.form.editTitle" : "knowledge.test.form.createTitle")}
      description={t("knowledge.test.form.description")}
      className="max-w-3xl rounded-lg"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("knowledge.common.cancel")}
          </Button>
          <Button
            disabled={busy || loading || inputUnavailable || (isEdit && dirtyFields.size === 0)}
            onClick={onSave}
            data-testid="knowledge-test-case-save"
          >
            {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
            {t(busy ? "knowledge.test.form.saving" : "knowledge.test.form.save")}
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingOverlay label={t("knowledge.test.cases.loading")} />
      ) : (
        <div className="min-w-0 space-y-4">
          {stale ? (
            <div className="rounded-md border border-sky-500/20 bg-sky-500/[0.07] px-3 py-3">
              <p className="text-sm font-medium text-sky-200">
                {t("knowledge.test.form.changedTitle")}
              </p>
              <p className="mt-0.5 text-xs text-sky-200/65">
                {t("knowledge.test.form.changedBody")}
              </p>
            </div>
          ) : null}
          {error ? <TestError error={error} /> : null}
          {validation ? (
            <div
              className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-3 py-2 text-sm text-rose-200"
              role="alert"
            >
              {t("knowledge.test.form.validation")}
            </div>
          ) : null}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="block min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("knowledge.test.form.label")}
              </span>
              <input
                value={draft.safeLabel}
                maxLength={160}
                onChange={(event) => onChange("safeLabel", event.target.value)}
                placeholder={t("knowledge.test.form.labelPlaceholder")}
                className={inputClass}
              />
            </label>
            <FieldSelect
              label={t("knowledge.test.form.status")}
              value={draft.status}
              onValueChange={(value) => onChange("status", value as TestCaseDraft["status"])}
              options={mutableCaseStatuses.map((value) => ({
                value,
                label: t(caseStatusKeys[value]),
              }))}
            />
            <FieldSelect
              label={t("knowledge.test.form.risk")}
              value={draft.riskLevel}
              onValueChange={(value) => onChange("riskLevel", value as KnowledgeV2RiskLevel)}
              options={risks.map((value) => ({ value, label: t(riskKeys[value]) }))}
            />
            <label className="flex min-w-0 items-start gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.critical}
                onChange={(event) => onChange("critical", event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm text-zinc-300">{t("knowledge.test.form.critical")}</span>
            </label>
            <label className="block min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("knowledge.test.form.question")}
              </span>
              <textarea
                value={draft.question}
                onChange={(event) => onChange("question", event.target.value)}
                placeholder={t("knowledge.test.playground.questionPlaceholder")}
                className={textareaClass}
                data-testid="knowledge-test-case-question"
              />
              <span className="mt-1.5 block text-xs text-zinc-600">
                {t(
                  isEdit
                    ? "knowledge.test.form.questionEditHelp"
                    : "knowledge.test.form.questionCreateHelp",
                )}
              </span>
            </label>
            <FieldSelect
              label={t("knowledge.test.form.behavior")}
              value={draft.expectedBehavior}
              onValueChange={(value) =>
                onChange("expectedBehavior", value as KnowledgeV2ExpectedBehavior)
              }
              options={expectedBehaviors.map((value) => ({ value, label: t(behaviorKeys[value]) }))}
            />
            <FieldSelect
              label={t("knowledge.test.playground.locale")}
              value={draft.locale}
              onValueChange={(value) => onChange("locale", value)}
              options={localeOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <FieldSelect
              label={t("knowledge.test.playground.channel")}
              value={draft.channelType}
              onValueChange={(value) => onChange("channelType", value as ChannelType)}
              options={channels.map((value) => ({ value, label: t(channelKeys[value]) }))}
            />
            <FieldSelect
              label={t("knowledge.test.playground.audience")}
              value={draft.audience}
              onValueChange={(value) => onChange("audience", value as KnowledgeV2Audience)}
              options={audiences.map((value) => ({ value, label: t(audienceKeys[value]) }))}
            />
            <FieldSelect
              label={t("knowledge.test.playground.brand")}
              value={draft.brandId || "ALL"}
              onValueChange={(value) => onChange("brandId", value === "ALL" ? "" : value)}
              options={[
                { value: "ALL", label: t("knowledge.test.playground.allBrands") },
                ...brandOptions.map((value) => ({ value, label: value })),
              ]}
            />
            <FieldSelect
              label={t("knowledge.test.playground.location")}
              value={draft.locationId || "ALL"}
              onValueChange={(value) => onChange("locationId", value === "ALL" ? "" : value)}
              options={[
                { value: "ALL", label: t("knowledge.test.playground.allLocations") },
                ...locationOptions.map((value) => ({ value, label: value })),
              ]}
            />
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("knowledge.test.playground.segment")}
              </span>
              <input
                value={draft.segment}
                maxLength={128}
                onChange={(event) => onChange("segment", event.target.value)}
                placeholder={t("knowledge.test.playground.segmentPlaceholder")}
                className={inputClass}
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("knowledge.test.form.dataset")}
              </span>
              <input
                value={draft.datasetVersion}
                maxLength={128}
                onChange={(event) => onChange("datasetVersion", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("knowledge.test.form.slices")}
              </span>
              <input
                value={draft.sliceKeys}
                onChange={(event) => onChange("sliceKeys", event.target.value)}
                placeholder={t("knowledge.test.form.slicesPlaceholder")}
                className={inputClass}
              />
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}
