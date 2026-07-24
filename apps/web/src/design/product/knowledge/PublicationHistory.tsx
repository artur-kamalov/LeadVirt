"use client";

import React from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileClock,
  FileDiff,
  FlaskConical,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UploadCloud,
  UserRound,
  XCircle,
} from "lucide-react";
import type {
  KnowledgeV2BatchEvaluationRunView,
  KnowledgeV2EvaluationRunStatus,
  KnowledgeV2JobStatus,
  KnowledgeV2JobView,
  KnowledgeV2PublicationDetail,
  KnowledgeV2PublicationGateView,
  KnowledgeV2PublicationStatus,
  KnowledgeV2PublicationSummary,
  KnowledgeV2PublicationValidationStatus,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessView,
} from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import {
  createKnowledgeV2EvaluationRun,
  createKnowledgeV2IdempotencyKey,
  createKnowledgeV2Publication,
  getActiveKnowledgeV2Publication,
  getKnowledgeV2EvaluationRun,
  getKnowledgeV2Job,
  listKnowledgeV2EvaluationRuns,
  listKnowledgeV2Publications,
  rollbackKnowledgeV2Publication,
  validateKnowledgeV2Publication,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { useNav } from "../nav";
import { ConfirmDialog, EmptyState, Modal, StatusBadge } from "../ui";
import type { KnowledgeNavigationTarget, KnowledgeViewId } from "./knowledge-views";
import {
  groupKnowledgePublicationGates,
  knowledgeGateGroupCopy,
} from "./knowledge-publication-gates";

const PAGE_SIZE = 25;
const JOB_POLL_LIMIT = 48;
const EVALUATION_POLL_LIMIT = 60;
const EVALUATION_RECOVERY_PAGE_LIMIT = 4;
const terminalJobStatuses = new Set<KnowledgeV2JobStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);
const terminalEvaluationStatuses = new Set<KnowledgeV2EvaluationRunStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

type OperationKind = "PUBLISH" | "ROLLBACK";
type KnowledgeDiagnosticView = "test" | "review";
type Translate = ReturnType<typeof useI18n>["t"];
type FormatNumber = ReturnType<typeof useI18n>["formatNumber"];
type FormatDate = ReturnType<typeof useI18n>["formatDate"];

const publicationStatusKeys: Record<KnowledgeV2PublicationStatus, TranslationKey> = {
  VALIDATING: "knowledge.status.publication.validating",
  READY: "knowledge.status.publication.ready",
  PUBLISHING: "knowledge.status.publication.publishing",
  ACTIVE: "knowledge.status.publication.active",
  SUPERSEDED: "knowledge.status.publication.superseded",
  FAILED: "knowledge.status.publication.failed",
  ROLLED_BACK: "knowledge.status.publication.rolledBack",
};

const validationStatusKeys: Record<KnowledgeV2PublicationValidationStatus, TranslationKey> = {
  PENDING: "knowledge.status.validation.pending",
  PASSED: "knowledge.status.validation.passed",
  PASSED_WITH_WARNINGS: "knowledge.status.validation.passedWithWarnings",
  FAILED: "knowledge.status.validation.failed",
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

const evaluationStatusKeys: Record<KnowledgeV2EvaluationRunStatus, TranslationKey> = {
  QUEUED: "knowledge.status.evaluation.queued",
  RUNNING: "knowledge.status.evaluation.running",
  SUCCEEDED: "knowledge.status.evaluation.succeeded",
  FAILED: "knowledge.status.evaluation.failed",
  CANCELLED: "knowledge.status.evaluation.cancelled",
};

type DraftStatus = KnowledgeV2ReadinessView["draft"]["status"];

const draftStatusKeys: Record<DraftStatus, TranslationKey> = {
  UP_TO_DATE: "knowledge.status.draft.upToDate",
  CHANGES_PENDING: "knowledge.status.draft.changesPending",
  PROCESSING: "knowledge.status.draft.processing",
  FAILED: "knowledge.status.draft.failed",
};

interface TrackedOperation {
  kind: OperationKind;
  jobId: string;
  acceptedStatus: KnowledgeV2JobStatus;
  job: KnowledgeV2JobView | null;
  sourcePublication: KnowledgeV2PublicationSummary | null;
}

interface PublicationHistoryProps {
  canPublish: boolean;
  canRollback: boolean;
  readiness: KnowledgeV2ReadinessView;
  task: string | null;
  onNavigate: (target: KnowledgeViewId | KnowledgeNavigationTarget) => void;
  onChanged?: () => void;
}

interface EvaluationTargetIdentity {
  targetKey: string;
  candidateId: string;
  candidateVersion: number;
  candidateManifestHash: string;
  testCaseSetHash: string;
}

function asApiError(caught: unknown, fallback: string) {
  if (caught instanceof ApiClientError) return caught;
  return new ApiClientError(fallback, 0, "NETWORK_ERROR", true);
}

function dateLabel(value: string | null | undefined, formatDate: FormatDate, t: Translate) {
  if (!value) return t("knowledge.common.notRecorded");
  return formatDate(value, { dateStyle: "medium", timeStyle: "short" });
}

function sentenceLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function publicationTone(status: KnowledgeV2PublicationStatus) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "FAILED") return "error" as const;
  if (status === "VALIDATING" || status === "READY" || status === "PUBLISHING") {
    return "info" as const;
  }
  return "warning" as const;
}

function validationTone(status: KnowledgeV2PublicationValidationStatus) {
  if (status === "PASSED") return "success" as const;
  if (status === "FAILED") return "error" as const;
  if (status === "PASSED_WITH_WARNINGS") return "warning" as const;
  return "info" as const;
}

function jobTone(status: KnowledgeV2JobStatus) {
  if (status === "SUCCEEDED") return "success" as const;
  if (status === "FAILED" || status === "DEAD_LETTER" || status === "CANCELLED") {
    return "error" as const;
  }
  if (status === "RETRY_SCHEDULED") return "warning" as const;
  return "info" as const;
}

function isTerminal(status: KnowledgeV2JobStatus) {
  return terminalJobStatuses.has(status);
}

function isEvaluationTerminal(status: KnowledgeV2EvaluationRunStatus) {
  return terminalEvaluationStatuses.has(status);
}

function jobStatusRank(status: KnowledgeV2JobStatus) {
  if (status === "SUCCEEDED") return 4;
  if (isTerminal(status)) return 3;
  if (status === "RUNNING") return 2;
  if (status === "RETRY_SCHEDULED") return 1;
  return 0;
}

function evaluationStatusRank(status: KnowledgeV2EvaluationRunStatus) {
  if (isEvaluationTerminal(status)) return 2;
  return status === "RUNNING" ? 1 : 0;
}

function evaluationMatchesCandidate(
  run: KnowledgeV2BatchEvaluationRunView,
  target: EvaluationTargetIdentity,
) {
  return (
    run.runKind === "PUBLICATION" &&
    run.target === "DRAFT" &&
    run.targetKey === target.targetKey &&
    run.candidateId === target.candidateId &&
    run.candidateVersion === target.candidateVersion &&
    run.candidateManifestHash === target.candidateManifestHash
  );
}

function evaluationMatchesTarget(
  run: KnowledgeV2BatchEvaluationRunView,
  target: EvaluationTargetIdentity,
) {
  return evaluationMatchesCandidate(run, target) && run.testCaseSetHash === target.testCaseSetHash;
}

function mergeEvaluationRun(
  current: KnowledgeV2BatchEvaluationRunView | null,
  incoming: KnowledgeV2BatchEvaluationRunView,
) {
  if (!current || current.id !== incoming.id) return incoming;
  return evaluationStatusRank(current.status) > evaluationStatusRank(incoming.status)
    ? current
    : incoming;
}

function itemCountLabel(
  counts: KnowledgeV2PublicationSummary["itemCounts"],
  t: Translate,
  formatNumber: FormatNumber,
) {
  return [
    t("knowledge.common.facts", { count: formatNumber(counts.factVersions) }),
    t("knowledge.common.rules", { count: formatNumber(counts.guidanceRuleVersions) }),
    t("knowledge.common.documents", { count: formatNumber(counts.documentRevisions) }),
    t("knowledge.common.accessRules", { count: formatNumber(counts.sourcePermissionSnapshots) }),
  ];
}

function expiryLabel(
  validUntil: string | null | undefined,
  now: number,
  t: Translate,
  formatNumber: FormatNumber,
) {
  if (!validUntil) return t("knowledge.history.expiryMissing");
  const remaining = new Date(validUntil).getTime() - now;
  if (remaining <= 0) return t("knowledge.history.expired");
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return minutes > 0
    ? t("knowledge.history.expiresMinutes", {
        minutes: formatNumber(minutes),
        seconds: formatNumber(seconds),
      })
    : t("knowledge.history.expiresSeconds", { seconds: formatNumber(seconds) });
}

export function PublicationHistory({
  canPublish,
  canRollback,
  readiness,
  task,
  onNavigate,
  onChanged,
}: PublicationHistoryProps) {
  const { formatDate, formatNumber, t } = useI18n();
  const { go } = useNav();
  const [active, setActive] = React.useState<KnowledgeV2PublicationDetail | null>(null);
  const [historyItems, setHistoryItems] = React.useState<KnowledgeV2PublicationSummary[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [snapshotError, setSnapshotError] = React.useState<ApiClientError | null>(null);
  const [validationOpen, setValidationOpen] = React.useState(false);
  const [validation, setValidation] = React.useState<KnowledgeV2PublicationValidationView | null>(
    null,
  );
  const [validating, setValidating] = React.useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = React.useState(false);
  const [rollbackTarget, setRollbackTarget] = React.useState<KnowledgeV2PublicationSummary | null>(
    null,
  );
  const [rollbackReason, setRollbackReason] = React.useState("");
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState<OperationKind | null>(null);
  const [actionError, setActionError] = React.useState<ApiClientError | null>(null);
  const [operation, setOperation] = React.useState<TrackedOperation | null>(null);
  const [pollError, setPollError] = React.useState<ApiClientError | null>(null);
  const [pollingStopped, setPollingStopped] = React.useState(false);
  const [pollGeneration, setPollGeneration] = React.useState(0);
  const [evaluation, setEvaluation] = React.useState<KnowledgeV2BatchEvaluationRunView | null>(
    null,
  );
  const [evaluationLoading, setEvaluationLoading] = React.useState(false);
  const [evaluationError, setEvaluationError] = React.useState<ApiClientError | null>(null);
  const [evaluationPollingStopped, setEvaluationPollingStopped] = React.useState(false);
  const [evaluationPollGeneration, setEvaluationPollGeneration] = React.useState(0);
  const [clock, setClock] = React.useState(() => Date.now());
  const mounted = React.useRef(false);
  const refreshSequence = React.useRef(0);
  const jobPollCount = React.useRef(0);
  const evaluationPollCount = React.useRef(0);
  const evaluationRecoverySequence = React.useRef(0);
  const evaluationStartInFlight = React.useRef(false);
  const firstLaunchValidationAttemptKey = React.useRef<string | null>(null);
  const startValidationRef = React.useRef<() => Promise<void>>(() => Promise.resolve());
  const dismissedJobId = React.useRef<string | null>(null);
  const onChangedRef = React.useRef(onChanged);

  React.useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const evaluationTarget = React.useMemo<EvaluationTargetIdentity>(
    () => ({
      targetKey: readiness.targetKey,
      candidateId: readiness.draft.candidateId,
      candidateVersion: readiness.draft.candidateVersion,
      candidateManifestHash: readiness.draft.candidateManifestHash,
      testCaseSetHash: readiness.draft.evaluationTestCaseSetHash,
    }),
    [
      readiness.draft.candidateId,
      readiness.draft.candidateManifestHash,
      readiness.draft.candidateVersion,
      readiness.draft.evaluationTestCaseSetHash,
      readiness.targetKey,
    ],
  );
  const validationAttemptKey = [
    evaluationTarget.candidateId,
    evaluationTarget.candidateVersion,
    evaluationTarget.candidateManifestHash,
  ].join(":");

  const refreshSnapshot = React.useCallback(
    async (showLoading = false) => {
      const sequence = ++refreshSequence.current;
      if (showLoading) setLoading(true);

      try {
        const [activeResponse, historyPage] = await Promise.all([
          getActiveKnowledgeV2Publication(),
          listKnowledgeV2Publications({ limit: PAGE_SIZE }),
        ]);
        if (!mounted.current || sequence !== refreshSequence.current) return;
        setActive(activeResponse.data);
        setHistoryItems(historyPage.items);
        setNextCursor(historyPage.pageInfo.nextCursor);
        setSnapshotError(null);
      } catch (caught) {
        if (!mounted.current || sequence !== refreshSequence.current) return;
        setSnapshotError(asApiError(caught, t("knowledge.history.error.history")));
      } finally {
        if (mounted.current && sequence === refreshSequence.current) setLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    mounted.current = true;
    void refreshSnapshot(true);
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
    };
  }, [refreshSnapshot]);

  const findPublicationEvaluation = React.useCallback(async (target: EvaluationTargetIdentity) => {
    let cursor: string | undefined;
    let newest: KnowledgeV2BatchEvaluationRunView | null = null;

    for (let pageIndex = 0; pageIndex < EVALUATION_RECOVERY_PAGE_LIMIT; pageIndex += 1) {
      const page = await listKnowledgeV2EvaluationRuns({
        cursor,
        limit: PAGE_SIZE,
        runKind: "PUBLICATION",
        target: "DRAFT",
      });
      newest ??= page.items[0] ?? null;
      const exact = page.items.find((run) => evaluationMatchesTarget(run, target));
      if (exact) return { exact, newest };
      if (!page.pageInfo.nextCursor) break;
      cursor = page.pageInfo.nextCursor;
    }

    return { exact: null, newest };
  }, []);

  React.useEffect(() => {
    const sequence = ++evaluationRecoverySequence.current;
    let cancelled = false;
    setEvaluationLoading(true);

    void findPublicationEvaluation(evaluationTarget)
      .then(({ exact, newest }) => {
        if (cancelled || !mounted.current || sequence !== evaluationRecoverySequence.current) {
          return;
        }
        setEvaluation((current) =>
          exact ? mergeEvaluationRun(current, exact) : (current ?? newest),
        );
        setEvaluationError(null);
      })
      .catch((caught) => {
        if (cancelled || !mounted.current || sequence !== evaluationRecoverySequence.current) {
          return;
        }
        setEvaluationError(asApiError(caught, t("knowledge.history.error.evaluationList")));
      })
      .finally(() => {
        if (!cancelled && mounted.current && sequence === evaluationRecoverySequence.current) {
          setEvaluationLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [evaluationTarget, findPublicationEvaluation, t]);

  React.useEffect(() => {
    if (!validationOpen || !validation?.validUntil) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [validation?.validUntil, validationOpen]);

  const latestServerJob = readiness.draft.latestJob;
  React.useEffect(() => {
    if (
      !latestServerJob ||
      !latestServerJob.resources.some((resource) => resource.type === "PUBLICATION") ||
      dismissedJobId.current === latestServerJob.id
    ) {
      return;
    }
    const publicationId = latestServerJob.resources.find(
      (resource) => resource.type === "PUBLICATION",
    )?.id;
    const publication = historyItems.find((item) => item.id === publicationId) ?? null;
    const sourcePublication = publication?.sourcePublicationId
      ? (historyItems.find((item) => item.id === publication.sourcePublicationId) ?? null)
      : null;
    const kind: OperationKind = latestServerJob.stage === "ROLLING_BACK" ? "ROLLBACK" : "PUBLISH";
    setOperation((current) => {
      if (current?.jobId === latestServerJob.id) {
        const currentStatus = current.job?.status ?? current.acceptedStatus;
        if (jobStatusRank(currentStatus) > jobStatusRank(latestServerJob.status)) return current;
        return {
          ...current,
          kind,
          job: latestServerJob,
          acceptedStatus: latestServerJob.status,
          sourcePublication,
        };
      }
      if (latestServerJob.status === "SUCCEEDED") return current;
      const currentStatus = current?.job?.status ?? current?.acceptedStatus;
      if (currentStatus && !isTerminal(currentStatus)) return current;
      return {
        kind,
        jobId: latestServerJob.id,
        acceptedStatus: latestServerJob.status,
        job: latestServerJob,
        sourcePublication,
      };
    });
  }, [historyItems, latestServerJob]);

  React.useEffect(() => {
    jobPollCount.current = 0;
    setPollingStopped(false);
  }, [operation?.jobId]);

  React.useEffect(() => {
    const tracked = operation;
    if (!tracked || pollingStopped || isTerminal(tracked.job?.status ?? tracked.acceptedStatus)) {
      return;
    }

    let cancelled = false;
    let polling = false;
    let timer: number | undefined;
    let delay = 750;

    function schedule(nextDelay: number) {
      if (cancelled) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), nextDelay);
    }

    async function poll() {
      if (cancelled || polling) return;
      if (document.visibilityState !== "visible") return;
      if (jobPollCount.current >= JOB_POLL_LIMIT) {
        setPollingStopped(true);
        return;
      }
      polling = true;
      jobPollCount.current += 1;
      try {
        const job = await getKnowledgeV2Job(tracked.jobId);
        if (cancelled || !mounted.current) return;
        setPollError(null);
        setOperation((current) =>
          current?.jobId === tracked.jobId ? { ...current, job } : current,
        );

        if (isTerminal(job.status)) {
          await refreshSnapshot(false);
          if (!cancelled && mounted.current) onChangedRef.current?.();
          return;
        }

        delay = Math.min(5_000, Math.round(delay * 1.35));
        schedule(delay);
      } catch (caught) {
        if (cancelled || !mounted.current) return;
        const error = asApiError(caught, t("knowledge.history.error.job"));
        setPollError(error);
        if (error.retryable || error.status >= 500 || error.status === 0) {
          delay = Math.min(8_000, Math.max(2_000, Math.round(delay * 1.75)));
          schedule(delay);
        }
      } finally {
        polling = false;
      }
    }

    function resumeWhenVisible() {
      if (document.visibilityState === "visible") schedule(0);
    }

    document.addEventListener("visibilitychange", resumeWhenVisible);
    window.addEventListener("focus", resumeWhenVisible);
    schedule(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.removeEventListener("focus", resumeWhenVisible);
    };
  }, [operation?.jobId, pollGeneration, pollingStopped, refreshSnapshot, t]);

  const evaluationCandidateCurrent = Boolean(
    evaluation && evaluationMatchesCandidate(evaluation, evaluationTarget),
  );
  const evaluationExact = Boolean(
    evaluation && evaluationMatchesTarget(evaluation, evaluationTarget),
  );
  const evaluationCandidateStale = Boolean(evaluation && !evaluationCandidateCurrent);
  const evaluationSetStale = Boolean(evaluation && evaluationCandidateCurrent && !evaluationExact);

  React.useEffect(() => {
    evaluationPollCount.current = 0;
    setEvaluationPollingStopped(false);
  }, [evaluation?.id]);

  React.useEffect(() => {
    const tracked = evaluation;
    if (
      !tracked ||
      !evaluationExact ||
      evaluationPollingStopped ||
      isEvaluationTerminal(tracked.status)
    ) {
      return;
    }

    let cancelled = false;
    let polling = false;
    let timer: number | undefined;

    function schedule(nextDelay: number) {
      if (cancelled) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), nextDelay);
    }

    async function poll() {
      if (cancelled || polling) return;
      if (document.visibilityState !== "visible") return;
      if (evaluationPollCount.current >= EVALUATION_POLL_LIMIT) {
        setEvaluationPollingStopped(true);
        return;
      }

      polling = true;
      evaluationPollCount.current += 1;
      try {
        const run = await getKnowledgeV2EvaluationRun(tracked.id);
        if (cancelled || !mounted.current) return;
        setEvaluationError(null);
        setEvaluation((current) =>
          current?.id === tracked.id ? mergeEvaluationRun(current, run) : current,
        );
        if (isEvaluationTerminal(run.status)) {
          onChangedRef.current?.();
          return;
        }
        schedule(Math.min(5_000, Math.max(750, run.pollAfterMs ?? 1_000)));
      } catch (caught) {
        if (cancelled || !mounted.current) return;
        const error = asApiError(caught, t("knowledge.history.error.evaluationRun"));
        setEvaluationError(error);
        if (error.retryable || error.status >= 500 || error.status === 0) {
          schedule(3_000);
        }
      } finally {
        polling = false;
      }
    }

    function resumeWhenVisible() {
      if (document.visibilityState === "visible") schedule(0);
    }

    document.addEventListener("visibilitychange", resumeWhenVisible);
    window.addEventListener("focus", resumeWhenVisible);
    schedule(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.removeEventListener("focus", resumeWhenVisible);
    };
  }, [evaluation?.id, evaluationExact, evaluationPollGeneration, evaluationPollingStopped, t]);

  const operationStatus = operation?.job?.status ?? operation?.acceptedStatus;
  const operationBusy = Boolean(operationStatus && !isTerminal(operationStatus));
  const candidateChanged = Boolean(
    validation &&
    (validation.candidateId !== readiness.draft.candidateId ||
      validation.candidateVersion !== readiness.draft.candidateVersion ||
      validation.candidateManifestHash !== readiness.draft.candidateManifestHash),
  );
  const validationExpired = Boolean(
    validation?.validUntil && new Date(validation.validUntil).getTime() <= clock,
  );
  const validationPassed = Boolean(
    validation && ["PASSED", "PASSED_WITH_WARNINGS"].includes(validation.status),
  );
  const currentValidationId = validation
    ? validationPassed && !validationExpired && !candidateChanged
      ? validation.id
      : null
    : readiness.draft.validationId;
  const evaluationGatePassed = Boolean(
    evaluationExact &&
    evaluation?.status === "SUCCEEDED" &&
    evaluation.aggregate.criticalPassed === evaluation.aggregate.criticalTotal,
  );
  const evaluationBusy = Boolean(
    evaluationExact && evaluation && !isEvaluationTerminal(evaluation.status),
  );
  const canSubmitPublication = Boolean(
    canPublish && currentValidationId && evaluationGatePassed && !operationBusy && !submitting,
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const sequence = refreshSequence.current;
    setLoadingMore(true);
    try {
      const page = await listKnowledgeV2Publications({ cursor: nextCursor, limit: PAGE_SIZE });
      if (!mounted.current || sequence !== refreshSequence.current) return;
      setHistoryItems((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !knownIds.has(item.id))];
      });
      setNextCursor(page.pageInfo.nextCursor);
      setSnapshotError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setSnapshotError(asApiError(caught, t("knowledge.history.error.more")));
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }

  async function startOrRecoverEvaluation(
    target: EvaluationTargetIdentity,
    options: { forceNew?: boolean } = {},
  ) {
    if (evaluationStartInFlight.current) return;
    evaluationStartInFlight.current = true;
    setEvaluationLoading(true);
    setEvaluationError(null);
    setEvaluationPollingStopped(false);
    evaluationPollCount.current = 0;

    try {
      if (!options.forceNew) {
        const recovered = await findPublicationEvaluation(target);
        if (!mounted.current) return;
        if (recovered.exact) {
          setEvaluation((current) => mergeEvaluationRun(current, recovered.exact));
          return;
        }
      }

      const response = await createKnowledgeV2EvaluationRun(
        {
          target: "DRAFT",
          runKind: "PUBLICATION",
          candidateId: target.candidateId,
          candidateVersion: target.candidateVersion,
          candidateManifestHash: target.candidateManifestHash,
        },
        { "Idempotency-Key": createKnowledgeV2IdempotencyKey() },
      );
      if (!mounted.current) return;
      setEvaluation(response.data.resource);
    } catch (caught) {
      if (!mounted.current) return;
      setEvaluationError(asApiError(caught, t("knowledge.history.error.evaluationStart")));
    } finally {
      evaluationStartInFlight.current = false;
      if (mounted.current) setEvaluationLoading(false);
    }
  }

  async function startValidation() {
    if (
      !canPublish ||
      validating ||
      submitting ||
      operationBusy ||
      evaluationBusy ||
      evaluationLoading
    ) {
      return;
    }
    setValidationOpen(true);
    setValidation(null);
    setActionError(null);
    setValidating(true);
    try {
      const response = await validateKnowledgeV2Publication(
        {
          targetKey: readiness.targetKey,
          candidateId: readiness.draft.candidateId,
          candidateVersion: readiness.draft.candidateVersion,
        },
        { "Idempotency-Key": createKnowledgeV2IdempotencyKey() },
      );
      if (!mounted.current) return;
      const nextValidation = response.data.resource;
      setValidation(nextValidation);
      setClock(Date.now());
      setValidating(false);
      onChangedRef.current?.();
      if (["PASSED", "PASSED_WITH_WARNINGS"].includes(nextValidation.status)) {
        await startOrRecoverEvaluation({
          targetKey: nextValidation.targetKey,
          candidateId: nextValidation.candidateId,
          candidateVersion: nextValidation.candidateVersion,
          candidateManifestHash: nextValidation.candidateManifestHash,
          testCaseSetHash: readiness.draft.evaluationTestCaseSetHash,
        });
      }
    } catch (caught) {
      if (!mounted.current) return;
      setActionError(asApiError(caught, t("knowledge.history.error.validation")));
    } finally {
      if (mounted.current) setValidating(false);
    }
  }
  startValidationRef.current = startValidation;

  React.useEffect(() => {
    if (task !== "first-launch") {
      firstLaunchValidationAttemptKey.current = null;
      return;
    }
    if (
      firstLaunchValidationAttemptKey.current === validationAttemptKey ||
      !canPublish ||
      validating ||
      submitting !== null ||
      operationBusy ||
      evaluationBusy ||
      evaluationLoading
    ) {
      return;
    }
    firstLaunchValidationAttemptKey.current = validationAttemptKey;
    void startValidationRef.current();
  }, [
    canPublish,
    evaluationBusy,
    evaluationLoading,
    operationBusy,
    submitting,
    task,
    validating,
    validationAttemptKey,
  ]);

  async function publishValidatedCandidate() {
    if (!currentValidationId || !canSubmitPublication) return;
    setSubmitting("PUBLISH");
    setActionError(null);
    try {
      const response = await createKnowledgeV2Publication(
        {
          targetKey: evaluationTarget.targetKey,
          candidateId: evaluationTarget.candidateId,
          candidateVersion: evaluationTarget.candidateVersion,
          validationId: currentValidationId,
        },
        { "Idempotency-Key": createKnowledgeV2IdempotencyKey() },
      );
      if (!mounted.current) return;
      setOperation({
        kind: "PUBLISH",
        jobId: response.data.jobId,
        acceptedStatus: response.data.status,
        job: null,
        sourcePublication: null,
      });
      dismissedJobId.current = null;
      setPollingStopped(false);
      setPollError(null);
      setValidationOpen(false);
      setValidation(null);
      onChangedRef.current?.();
    } catch (caught) {
      if (!mounted.current) return;
      setActionError(asApiError(caught, t("knowledge.history.error.publish")));
    } finally {
      if (mounted.current) setSubmitting(null);
    }
  }

  function openRollback(publication: KnowledgeV2PublicationSummary) {
    setRollbackTarget(publication);
    setRollbackReason("");
    setActionError(null);
  }

  async function startRollback() {
    const target = rollbackTarget;
    const reason = rollbackReason.trim();
    if (!target || !canRollback || reason.length < 5 || submitting || operationBusy) return;

    setSubmitting("ROLLBACK");
    setActionError(null);
    try {
      const pointer = await getActiveKnowledgeV2Publication();
      const activeEtag = pointer.headers.get("etag");
      if (!pointer.data || !activeEtag) {
        throw new ApiClientError(
          t("knowledge.history.error.active"),
          409,
          "KNOWLEDGE_PUBLICATION_ACTIVE_REQUIRED",
        );
      }
      if (pointer.data.id === target.id) {
        throw new ApiClientError(
          t("knowledge.history.error.alreadyActive"),
          409,
          "KNOWLEDGE_PUBLICATION_ALREADY_ACTIVE",
        );
      }

      const response = await rollbackKnowledgeV2Publication(
        target.id,
        { reason },
        {
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
          "If-Match": activeEtag,
        },
      );
      if (!mounted.current) return;
      setOperation({
        kind: "ROLLBACK",
        jobId: response.data.jobId,
        acceptedStatus: response.data.status,
        job: null,
        sourcePublication: target,
      });
      dismissedJobId.current = null;
      setPollingStopped(false);
      setPollError(null);
      setRollbackTarget(null);
      setRollbackReason("");
      onChangedRef.current?.();
    } catch (caught) {
      if (!mounted.current) return;
      setActionError(asApiError(caught, t("knowledge.history.error.rollback")));
    } finally {
      if (mounted.current) setSubmitting(null);
    }
  }

  async function reloadAfterConflict() {
    setActionError(null);
    await refreshSnapshot(false);
    if (mounted.current) onChangedRef.current?.();
  }

  return (
    <div className="space-y-6" data-testid="knowledge-publication-history">
      <section className="grid gap-4 xl:grid-cols-2">
        <ReadinessPanel
          eyebrow={t("knowledge.history.servingEyebrow")}
          title={
            readiness.serving.activePublicationSequence
              ? t("knowledge.common.publishedVersion", {
                  number: formatNumber(readiness.serving.activePublicationSequence),
                })
              : t("knowledge.history.noPublishedVersion")
          }
          status={readiness.serving.status === "READY" ? "success" : "warning"}
          statusLabel={t(
            readiness.serving.status === "READY"
              ? "knowledge.status.serving.ready"
              : "knowledge.status.serving.notReady",
          )}
          counts={readiness.serving.itemCounts}
          gates={readiness.serving.blockers}
          onNavigate={onNavigate}
          detail={
            active
              ? t("knowledge.history.activeDescription", {
                  date: dateLabel(active.activatedAt, formatDate, t),
                  approver:
                    active.approvedBy?.displayName ??
                    active.createdBy?.displayName ??
                    t("knowledge.common.unknownMember"),
                })
              : t("knowledge.history.emptyDescription")
          }
        />

        <ReadinessPanel
          eyebrow={t("knowledge.history.draftEyebrow")}
          title={t("knowledge.overview.draftVersion", {
            version: formatNumber(readiness.draft.candidateVersion),
          })}
          status={
            readiness.draft.status === "UP_TO_DATE"
              ? "success"
              : readiness.draft.status === "FAILED"
                ? "error"
                : readiness.draft.blockers.length > 0
                  ? "warning"
                  : "info"
          }
          statusLabel={t(draftStatusKeys[readiness.draft.status])}
          counts={readiness.draft.itemCounts}
          gates={[...readiness.draft.blockers, ...readiness.draft.warnings]}
          onNavigate={onNavigate}
          detail={
            readiness.draft.status === "UP_TO_DATE"
              ? t("knowledge.history.draftUpToDate")
              : t("knowledge.history.draftDescription")
          }
          action={
            <Button
              size="sm"
              disabled={
                !canPublish ||
                validating ||
                submitting !== null ||
                operationBusy ||
                evaluationBusy ||
                evaluationLoading
              }
              onClick={() => void startValidation()}
              data-testid="knowledge-validate-button"
            >
              {validating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              {t("knowledge.history.validate")}
            </Button>
          }
          permissionNote={!canPublish ? t("knowledge.history.publishPermission") : null}
        />
      </section>

      {operation ? (
        <OperationNotice
          operation={operation}
          pollError={pollError}
          pollingStopped={pollingStopped}
          canRetry={
            operation.kind === "PUBLISH"
              ? canPublish
              : canRollback && Boolean(operation.sourcePublication)
          }
          onResumePolling={() => {
            jobPollCount.current = 0;
            setPollingStopped(false);
            setPollError(null);
            setPollGeneration((value) => value + 1);
          }}
          onDismiss={() => {
            dismissedJobId.current = operation.jobId;
            setOperation(null);
          }}
          onRetryPublish={() => void startValidation()}
          onRetryRollback={() => {
            const source = operation.sourcePublication;
            setOperation(null);
            if (source) openRollback(source);
          }}
          showActivationAction={task === "first-launch"}
          onActivate={() => go("settings", { tab: "channels" })}
        />
      ) : null}

      {!validationOpen &&
      (evaluation ||
        (evaluationError && readiness.draft.validationId) ||
        (evaluationLoading && readiness.draft.validationId)) ? (
        <EvaluationPanel
          run={evaluation}
          loading={evaluationLoading}
          error={evaluationError}
          candidateStale={evaluationCandidateStale}
          testSetStale={evaluationSetStale}
          currentCandidateVersion={evaluationTarget.candidateVersion}
          pollingStopped={evaluationPollingStopped}
          canRetry={canPublish && !evaluationLoading}
          canReviewPublish={canSubmitPublication}
          onRetry={() => {
            if (!evaluation) void startOrRecoverEvaluation(evaluationTarget);
            else if (evaluationCandidateStale) void startValidation();
            else void startOrRecoverEvaluation(evaluationTarget, { forceNew: true });
          }}
          onResume={() => {
            evaluationPollCount.current = 0;
            setEvaluationPollingStopped(false);
            setEvaluationError(null);
            setEvaluationPollGeneration((value) => value + 1);
          }}
          onNavigate={onNavigate}
          onReviewPublish={() => setValidationOpen(true)}
        />
      ) : null}

      {snapshotError ? (
        <ErrorNotice
          error={snapshotError}
          onRetry={() => void refreshSnapshot(historyItems.length === 0)}
        />
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              {t("knowledge.history.title")}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{t("knowledge.history.description")}</p>
          </div>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("knowledge.history.refresh")}
            title={t("knowledge.history.refresh")}
            disabled={loading}
            onClick={() => void refreshSnapshot(historyItems.length === 0)}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {loading && historyItems.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center rounded-lg border border-white/10 bg-zinc-950/30">
            <Loader2
              className="h-6 w-6 animate-spin text-emerald-400"
              aria-label={t("knowledge.history.loading")}
            />
          </div>
        ) : historyItems.length === 0 && !snapshotError ? (
          <EmptyState
            icon={History}
            title={t("knowledge.history.emptyTitle")}
            description={t("knowledge.history.emptyBody")}
            className="min-h-64 rounded-lg border border-white/10 bg-zinc-950/30"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950/30">
            {historyItems.map((publication) => (
              <PublicationRow
                key={publication.id}
                publication={publication}
                canRollback={canRollback && publication.allowedActions.includes("ROLLBACK")}
                busy={operationBusy || submitting !== null}
                onRollback={() => openRollback(publication)}
              />
            ))}
          </div>
        )}

        {nextCursor ? (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("knowledge.history.loadOlder")}
            </Button>
          </div>
        ) : null}
      </section>

      <Modal
        open={validationOpen}
        onOpenChange={(open) => {
          if (!submitting) setValidationOpen(open);
        }}
        title={t("knowledge.history.validationTitle")}
        description={t("knowledge.history.validationDescription")}
        className="max-w-2xl"
        footer={
          <>
            <Button
              variant="outline"
              disabled={Boolean(submitting)}
              onClick={() => setValidationOpen(false)}
            >
              {t("knowledge.common.close")}
            </Button>
            <Button
              disabled={!canSubmitPublication}
              onClick={() => setPublishConfirmOpen(true)}
              data-testid="knowledge-publish-review-button"
            >
              {submitting === "PUBLISH" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              {t("knowledge.history.publish")}
            </Button>
          </>
        }
      >
        <div data-testid="knowledge-validation-result">
          {validating ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-sm text-zinc-500">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              {t("knowledge.history.validating", {
                version: formatNumber(readiness.draft.candidateVersion),
              })}
            </div>
          ) : actionError ? (
            <ErrorNotice
              error={actionError}
              onRetry={() => void startValidation()}
              onReload={
                actionError.status === 412 ||
                actionError.code === "REVISION_CONFLICT" ||
                actionError.code.includes("STALE")
                  ? () => void reloadAfterConflict()
                  : undefined
              }
            />
          ) : validation ? (
            <ValidationResult
              validation={validation}
              now={clock}
              candidateChanged={candidateChanged}
              expired={validationExpired}
              onNavigate={onNavigate}
            />
          ) : null}

          {evaluation || evaluationError || evaluationLoading ? (
            <EvaluationPanel
              run={evaluation}
              loading={evaluationLoading}
              error={evaluationError}
              candidateStale={evaluationCandidateStale}
              testSetStale={evaluationSetStale}
              currentCandidateVersion={evaluationTarget.candidateVersion}
              pollingStopped={evaluationPollingStopped}
              canRetry={canPublish && !evaluationLoading}
              canReviewPublish={false}
              embedded
              onRetry={() => {
                if (!evaluation) void startOrRecoverEvaluation(evaluationTarget);
                else if (evaluationCandidateStale) void startValidation();
                else void startOrRecoverEvaluation(evaluationTarget, { forceNew: true });
              }}
              onResume={() => {
                evaluationPollCount.current = 0;
                setEvaluationPollingStopped(false);
                setEvaluationError(null);
                setEvaluationPollGeneration((value) => value + 1);
              }}
              onNavigate={onNavigate}
              onReviewPublish={() => setValidationOpen(true)}
            />
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title={t("knowledge.history.publishConfirmTitle")}
        description={
          active
            ? t("knowledge.history.publishConfirmActive", {
                sequence: formatNumber(active.sequence),
              })
            : t("knowledge.history.publishConfirmEmpty")
        }
        confirmLabel={t("knowledge.history.publishConfirm")}
        cancelLabel={t("knowledge.history.keepReviewing")}
        onConfirm={publishValidatedCandidate}
      />

      <Modal
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setRollbackTarget(null);
            setRollbackReason("");
            setActionError(null);
          }
        }}
        title={
          rollbackTarget
            ? t("knowledge.history.rollbackTitle", {
                sequence: formatNumber(rollbackTarget.sequence),
              })
            : t("knowledge.history.rollback")
        }
        description={t("knowledge.history.rollbackDescription")}
        className="max-w-xl"
        footer={
          <>
            <Button
              variant="outline"
              disabled={Boolean(submitting)}
              onClick={() => setRollbackTarget(null)}
            >
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              className="bg-rose-500 text-white hover:bg-rose-600"
              disabled={
                rollbackReason.trim().length < 5 ||
                Boolean(submitting) ||
                operationBusy ||
                !canRollback
              }
              onClick={() => setRollbackConfirmOpen(true)}
              data-testid="knowledge-rollback-review-button"
            >
              {submitting === "ROLLBACK" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              {t("knowledge.history.rollbackReview")}
            </Button>
          </>
        }
      >
        <div className="space-y-4" data-testid="knowledge-rollback-dialog">
          {rollbackTarget ? (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-4">
              {itemCountLabel(rollbackTarget.itemCounts, t, formatNumber).map((label) => (
                <div key={label} className="bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                  {label}
                </div>
              ))}
            </div>
          ) : null}
          <label className="block">
            <span className="text-sm font-medium text-zinc-200">
              {t("knowledge.history.rollbackReason")}
            </span>
            <textarea
              value={rollbackReason}
              onChange={(event) => setRollbackReason(event.target.value)}
              rows={4}
              maxLength={2000}
              disabled={Boolean(submitting)}
              placeholder={t("knowledge.history.rollbackPlaceholder")}
              className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-700 focus:border-emerald-500/50"
            />
            <span className="mt-1 flex justify-between gap-3 text-xs text-zinc-600">
              <span>{t("knowledge.history.rollbackMinimum")}</span>
              <span>
                {t("knowledge.history.rollbackLength", {
                  current: formatNumber(rollbackReason.length),
                  maximum: formatNumber(2000),
                })}
              </span>
            </span>
          </label>
          {actionError ? (
            <ErrorNotice
              error={actionError}
              onReload={
                actionError.status === 412 || actionError.code === "REVISION_CONFLICT"
                  ? () => void reloadAfterConflict()
                  : undefined
              }
            />
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={rollbackConfirmOpen}
        onOpenChange={setRollbackConfirmOpen}
        title={t("knowledge.history.rollbackConfirmTitle")}
        description={
          rollbackTarget
            ? t("knowledge.history.rollbackConfirmBody", {
                sequence: formatNumber(rollbackTarget.sequence),
              })
            : undefined
        }
        confirmLabel={t("knowledge.history.rollbackConfirm")}
        cancelLabel={t("knowledge.common.cancel")}
        danger
        onConfirm={startRollback}
      />
    </div>
  );
}

function ReadinessPanel({
  eyebrow,
  title,
  status,
  statusLabel,
  counts,
  gates,
  onNavigate,
  detail,
  action,
  permissionNote,
}: {
  eyebrow: string;
  title: string;
  status: "success" | "error" | "warning" | "info";
  statusLabel: string;
  counts: KnowledgeV2ReadinessView["serving"]["itemCounts"];
  gates: KnowledgeV2PublicationGateView[];
  onNavigate: (target: KnowledgeViewId | KnowledgeNavigationTarget) => void;
  detail: string;
  action?: React.ReactNode;
  permissionNote?: string | null;
}) {
  const { formatNumber, t } = useI18n();
  const gateGroups = groupKnowledgePublicationGates(gates);
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-zinc-950/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-600">{eyebrow}</p>
          <h2 className="mt-1 truncate text-base font-semibold text-zinc-100">{title}</h2>
        </div>
        <StatusBadge status={status}>{statusLabel}</StatusBadge>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">{detail}</p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {itemCountLabel(counts, t, formatNumber).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {gates.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-white/5 pt-3">
          {gateGroups.slice(0, 3).map((group) => {
            const copy = knowledgeGateGroupCopy(group, t, formatNumber);
            const content = (
              <>
                {group.status === "BLOCKED" ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                )}
                <span className="min-w-0 flex-1 text-zinc-400">{copy.title}</span>
                {group.target ? (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : null}
              </>
            );
            return group.target ? (
              <button
                key={group.key}
                type="button"
                className="flex w-full gap-2 text-left text-xs hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
                onClick={() => onNavigate(group.target)}
                data-testid={`knowledge-readiness-gate-${group.kind.toLowerCase()}`}
              >
                {content}
              </button>
            ) : (
              <div
                key={group.key}
                className="flex gap-2 text-xs"
                data-testid={`knowledge-readiness-gate-${group.kind.toLowerCase()}`}
              >
                {content}
              </div>
            );
          })}
          {gateGroups.length > 3 ? (
            <p className="pl-5 text-xs text-zinc-600">
              {t("knowledge.common.moreChecks", {
                count: formatNumber(gateGroups.length - 3),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {action || permissionNote ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {action}
          {permissionNote ? <p className="text-xs text-zinc-600">{permissionNote}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function PublicationRow({
  publication,
  canRollback,
  busy,
  onRollback,
}: {
  publication: KnowledgeV2PublicationSummary;
  canRollback: boolean;
  busy: boolean;
  onRollback: () => void;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const approver = publication.approvedBy?.displayName ?? publication.createdBy?.displayName;
  return (
    <article
      className="border-b border-white/5 px-4 py-4 last:border-b-0 sm:px-5"
      data-testid={`knowledge-publication-row-${publication.id}`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">
              {t("knowledge.common.publishedVersion", {
                number: formatNumber(publication.sequence),
              })}
            </span>
            <StatusBadge status={publicationTone(publication.status)}>
              {t(publicationStatusKeys[publication.status])}
            </StatusBadge>
            {publication.isActive ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("knowledge.history.servingEyebrow")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <FileClock className="h-3.5 w-3.5" />
              {dateLabel(publication.createdAt, formatDate, t)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              {approver ?? t("knowledge.common.unknownMember")}
            </span>
          </div>
          {publication.failureCode ? (
            <p className="mt-2 break-words text-xs text-rose-400">
              {t("knowledge.history.failure", { code: sentenceLabel(publication.failureCode) })}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 text-xs text-zinc-500">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {itemCountLabel(publication.itemCounts, t, formatNumber).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {publication.diff ? (
              <span className="inline-flex items-center gap-1.5 text-zinc-400">
                <FileDiff className="h-3.5 w-3.5" />
                {t("knowledge.common.added", { count: formatNumber(publication.diff.added) })},{" "}
                {t("knowledge.common.updated", { count: formatNumber(publication.diff.updated) })},{" "}
                {t("knowledge.common.removed", { count: formatNumber(publication.diff.removed) })}
              </span>
            ) : (
              <span>{t("knowledge.history.initial")}</span>
            )}
            {publication.validationStatus ? (
              <span>
                {t("knowledge.history.validation", {
                  status: t(validationStatusKeys[publication.validationStatus]),
                })}
              </span>
            ) : null}
          </div>
          {publication.approvedAt ? (
            <p className="mt-2">
              {t("knowledge.history.approved", {
                date: dateLabel(publication.approvedAt, formatDate, t),
              })}
            </p>
          ) : null}
        </div>

        <div className="flex justify-start lg:justify-end">
          {canRollback ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onRollback}
              data-testid={`knowledge-rollback-${publication.id}`}
            >
              <ArchiveRestore className="mr-2 h-4 w-4" />
              {t("knowledge.history.rollback")}
            </Button>
          ) : (
            <span className="text-xs text-zinc-700">{t("knowledge.history.savedVersion")}</span>
          )}
        </div>
      </div>
    </article>
  );
}

function ValidationResult({
  validation,
  now,
  candidateChanged,
  expired,
  onNavigate,
}: {
  validation: KnowledgeV2PublicationValidationView;
  now: number;
  candidateChanged: boolean;
  expired: boolean;
  onNavigate: (target: KnowledgeViewId | KnowledgeNavigationTarget) => void;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const gates = [...validation.blockers, ...validation.warnings];
  const gateGroups = groupKnowledgePublicationGates(gates);
  const [expandedGateKey, setExpandedGateKey] = React.useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/50 p-4">
        <div>
          <p className="text-xs text-zinc-600">
            {t("knowledge.overview.draftVersion", {
              version: formatNumber(validation.candidateVersion),
            })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={validationTone(validation.status)}>
              {t(validationStatusKeys[validation.status])}
            </StatusBadge>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                expired ? "text-rose-400" : "text-zinc-500",
              )}
              title={
                validation.validUntil
                  ? t("knowledge.history.validUntil", {
                      date: dateLabel(validation.validUntil, formatDate, t),
                    })
                  : undefined
              }
            >
              <Clock3 className="h-3.5 w-3.5" />
              {expiryLabel(validation.validUntil, now, t, formatNumber)}
            </span>
          </div>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <p>
            {t("knowledge.common.facts", {
              count: formatNumber(validation.itemCounts.factVersions),
            })}
          </p>
          <p>
            {t("knowledge.common.rules", {
              count: formatNumber(validation.itemCounts.guidanceRuleVersions),
            })}
          </p>
        </div>
      </div>

      {candidateChanged ? (
        <div className="flex gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-200">
              {t("knowledge.history.draftChangedTitle")}
            </p>
            <p className="mt-1 text-xs text-amber-200/70">
              {t("knowledge.history.draftChangedBody")}
            </p>
          </div>
        </div>
      ) : null}

      {expired ? (
        <div className="flex gap-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div>
            <p className="text-sm font-medium text-rose-200">
              {t("knowledge.history.expiredTitle")}
            </p>
            <p className="mt-1 text-xs text-rose-200/70">{t("knowledge.history.expiredBody")}</p>
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium text-zinc-200">{t("knowledge.history.gatesTitle")}</h3>
        {gates.length === 0 ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.05] px-4 py-3 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {t("knowledge.history.noGates")}
          </div>
        ) : (
          <div className="mt-2 space-y-2" data-testid="knowledge-validation-gates">
            {gateGroups.map((group) => {
              const copy = knowledgeGateGroupCopy(group, t, formatNumber);
              const expanded = !group.target && expandedGateKey === group.key;
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-white/10 bg-zinc-950/40 px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 sm:flex-row sm:items-center"
                    onClick={() => {
                      if (group.target) {
                        onNavigate(group.target);
                        return;
                      }
                      setExpandedGateKey((current) => (current === group.key ? null : group.key));
                    }}
                    aria-expanded={group.target ? undefined : expanded}
                    data-testid={`knowledge-validation-gate-${group.kind.toLowerCase()}`}
                  >
                    {group.status === "BLOCKED" ? (
                      <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-200">{copy.title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-zinc-500">{copy.description}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-400">
                      {t(
                        group.target
                          ? "knowledge.ux.attention.open"
                          : "knowledge.ux.attention.details",
                      )}
                      <ArrowRight
                        className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
                      />
                    </span>
                  </button>
                  {expanded ? (
                    <div
                      className="mx-3 border-x border-b border-amber-500/20 bg-amber-500/[0.05] px-4 py-3"
                      data-testid="knowledge-validation-gate-in-place-details"
                    >
                      <p className="text-sm font-medium text-amber-200">
                        {t("knowledge.ux.gate.unknownDetailsTitle")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-100/70">
                        {t("knowledge.ux.gate.unknownDetailsDescription")}
                      </p>
                      <p className="mt-3 break-all text-xs text-zinc-600">
                        {t("knowledge.ux.gate.reference", {
                          code: group.gates[0]?.code ?? "UNKNOWN",
                        })}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationPanel({
  run,
  loading,
  error,
  candidateStale,
  testSetStale,
  currentCandidateVersion,
  pollingStopped,
  canRetry,
  canReviewPublish,
  embedded = false,
  onRetry,
  onResume,
  onNavigate,
  onReviewPublish,
}: {
  run: KnowledgeV2BatchEvaluationRunView | null;
  loading: boolean;
  error: ApiClientError | null;
  candidateStale: boolean;
  testSetStale: boolean;
  currentCandidateVersion: number;
  pollingStopped: boolean;
  canRetry: boolean;
  canReviewPublish: boolean;
  embedded?: boolean;
  onRetry: () => void;
  onResume: () => void;
  onNavigate: (view: KnowledgeDiagnosticView) => void;
  onReviewPublish: () => void;
}) {
  const { formatNumber, t } = useI18n();
  const terminal = run ? isEvaluationTerminal(run.status) : false;
  const criticalBlocked = run
    ? Math.max(0, run.aggregate.criticalTotal - run.aggregate.criticalPassed)
    : 0;
  const ready = Boolean(
    run && !candidateStale && !testSetStale && run.status === "SUCCEEDED" && criticalBlocked === 0,
  );
  const needsAttention = Boolean(
    error ||
    candidateStale ||
    testSetStale ||
    run?.status === "FAILED" ||
    run?.status === "CANCELLED" ||
    (run?.status === "SUCCEEDED" && criticalBlocked > 0),
  );
  const canStartAgain = Boolean(
    canRetry &&
    (!run ||
      terminal ||
      candidateStale ||
      testSetStale ||
      (run.status === "SUCCEEDED" && criticalBlocked > 0)),
  );
  const Icon = ready
    ? CheckCircle2
    : needsAttention
      ? XCircle
      : run || loading
        ? Loader2
        : FlaskConical;
  const tone = ready ? "success" : needsAttention ? "error" : "info";

  let summary = t("knowledge.history.evaluationDescription");
  if (candidateStale && run) {
    summary = t("knowledge.history.evaluationStaleBody", {
      tested: formatNumber(run.candidateVersion ?? 0),
      current: formatNumber(currentCandidateVersion),
    });
  } else if (testSetStale) {
    summary = t("knowledge.history.evaluationSetStaleBody");
  } else if (run?.status === "FAILED") {
    summary = t("knowledge.history.evaluationFailureBody");
  } else if (run?.status === "CANCELLED") {
    summary = t("knowledge.history.evaluationCancelledBody");
  } else if (run?.status === "SUCCEEDED" && criticalBlocked > 0) {
    summary = t("knowledge.history.evaluationCriticalBlocked", {
      count: formatNumber(criticalBlocked),
    });
  } else if (ready) {
    summary = t("knowledge.history.evaluationReady");
  } else if (loading && !run) {
    summary = t("knowledge.history.evaluationStarting");
  }

  return (
    <section
      className={cn(
        "min-w-0",
        embedded
          ? "mt-5 border-t border-white/10 pt-5"
          : "rounded-lg border border-sky-500/20 bg-sky-500/[0.05] px-4 py-4 sm:px-5",
      )}
      aria-live="polite"
      data-testid="knowledge-publication-evaluation"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            !ready && !needsAttention && (run || loading) && "animate-spin",
            ready ? "text-emerald-400" : needsAttention ? "text-rose-400" : "text-sky-400",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">
              {candidateStale
                ? t("knowledge.history.evaluationStaleTitle")
                : testSetStale
                  ? t("knowledge.history.evaluationSetStaleTitle")
                  : t("knowledge.history.evaluationTitle")}
            </h2>
            {run ? (
              <StatusBadge status={tone}>{t(evaluationStatusKeys[run.status])}</StatusBadge>
            ) : null}
          </div>
          <p className="mt-1 break-words text-sm leading-6 text-zinc-400">{summary}</p>

          {run && !terminal && !candidateStale && !testSetStale ? (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-400" />
            </div>
          ) : null}

          {run ? (
            <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
              <EvaluationCount
                label={t("knowledge.history.evaluationCritical", {
                  passed: formatNumber(run.aggregate.criticalPassed),
                  total: formatNumber(run.aggregate.criticalTotal),
                })}
                value={`${formatNumber(run.aggregate.criticalPassed)}/${formatNumber(
                  run.aggregate.criticalTotal,
                )}`}
                tone={criticalBlocked > 0 ? "error" : "success"}
              />
              <EvaluationCount
                label={t("knowledge.history.evaluationPassed", {
                  count: formatNumber(run.aggregate.passed),
                })}
                value={formatNumber(run.aggregate.passed)}
                tone="success"
              />
              <EvaluationCount
                label={t("knowledge.history.evaluationFailedCount", {
                  count: formatNumber(run.aggregate.failed),
                })}
                value={formatNumber(run.aggregate.failed)}
                tone={run.aggregate.failed > 0 ? "error" : "neutral"}
              />
              <EvaluationCount
                label={t("knowledge.history.evaluationWarningCount", {
                  count: formatNumber(run.aggregate.warning),
                })}
                value={formatNumber(run.aggregate.warning)}
                tone={run.aggregate.warning > 0 ? "warning" : "neutral"}
              />
            </div>
          ) : null}

          {run ? (
            <p className="mt-3 text-xs text-zinc-600">
              {t("knowledge.history.evaluationProgress", {
                count: formatNumber(run.aggregate.total),
              })}
              {run.aggregate.error > 0
                ? ` | ${t("knowledge.history.evaluationErrorCount", {
                    count: formatNumber(run.aggregate.error),
                  })}`
                : ""}
            </p>
          ) : null}

          {run?.error ? (
            <div className="mt-3 border-l-2 border-rose-500/40 pl-3 text-xs leading-5 text-rose-300/80">
              <p className="break-words">{run.error.message}</p>
              <p className="break-all text-rose-400/60">{run.error.code}</p>
            </div>
          ) : null}

          {error ? <p className="mt-3 break-words text-xs text-rose-300">{error.message}</p> : null}
          {pollingStopped ? (
            <p className="mt-3 text-xs text-amber-300">
              {t("knowledge.history.evaluationPollingStopped")}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {canReviewPublish ? (
              <Button size="sm" onClick={onReviewPublish}>
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {t("knowledge.history.evaluationReviewPublish")}
              </Button>
            ) : null}
            {needsAttention ? (
              <>
                <Button size="sm" variant="outline" onClick={() => onNavigate("test")}>
                  <FlaskConical className="mr-2 h-4 w-4" />
                  {t("knowledge.history.evaluationViewTests")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => onNavigate("review")}>
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  {t("knowledge.history.evaluationViewReview")}
                </Button>
              </>
            ) : null}
            {canStartAgain && needsAttention ? (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t("knowledge.history.evaluationRunAgain")}
              </Button>
            ) : null}
            {(pollingStopped || (error && run && !terminal)) && run && !terminal ? (
              <Button size="sm" variant="outline" onClick={onResume}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("knowledge.history.evaluationResume")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function EvaluationCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "error" | "neutral";
}) {
  return (
    <div className="min-w-0 border-l border-white/10 pl-3">
      <p
        className={cn(
          "text-base font-semibold",
          tone === "success"
            ? "text-emerald-300"
            : tone === "warning"
              ? "text-amber-300"
              : tone === "error"
                ? "text-rose-300"
                : "text-zinc-300",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 break-words text-[11px] leading-4 text-zinc-600">{label}</p>
    </div>
  );
}

function OperationNotice({
  operation,
  pollError,
  pollingStopped,
  canRetry,
  onResumePolling,
  onDismiss,
  onRetryPublish,
  onRetryRollback,
  showActivationAction,
  onActivate,
}: {
  operation: TrackedOperation;
  pollError: ApiClientError | null;
  pollingStopped: boolean;
  canRetry: boolean;
  onResumePolling: () => void;
  onDismiss: () => void;
  onRetryPublish: () => void;
  onRetryRollback: () => void;
  showActivationAction: boolean;
  onActivate: () => void;
}) {
  const { t } = useI18n();
  const status = operation.job?.status ?? operation.acceptedStatus;
  const terminal = isTerminal(status);
  const failed = status === "FAILED" || status === "DEAD_LETTER" || status === "CANCELLED";
  const progress = operation.job?.progress;
  const Icon = status === "SUCCEEDED" ? CheckCircle2 : failed ? XCircle : Loader2;
  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-4",
        status === "SUCCEEDED"
          ? "border-emerald-500/20 bg-emerald-500/[0.06]"
          : failed
            ? "border-rose-500/20 bg-rose-500/[0.06]"
            : "border-sky-500/20 bg-sky-500/[0.06]",
      )}
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            !terminal && "animate-spin",
            status === "SUCCEEDED" ? "text-emerald-400" : failed ? "text-rose-400" : "text-sky-400",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">
              {t(
                operation.kind === "PUBLISH"
                  ? "knowledge.history.publishProgress"
                  : "knowledge.history.rollbackProgress",
              )}
            </h2>
            <StatusBadge status={jobTone(status)}>{t(jobStatusKeys[status])}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {t(
              operation.kind === "PUBLISH"
                ? "knowledge.history.publishAccepted"
                : "knowledge.history.rollbackAccepted",
            )}
          </p>
          {progress?.percent !== null && progress?.percent !== undefined ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-sky-400 transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
              />
            </div>
          ) : null}
          {operation.job?.error ? (
            <div className="mt-3 text-xs text-rose-300">
              <p>{operation.job.error.message}</p>
              <p className="mt-1 text-rose-300/65">
                {operation.job.error.retryable
                  ? t("knowledge.history.retryableJob")
                  : t("knowledge.history.failure", {
                      code: sentenceLabel(operation.job.error.code),
                    })}
              </p>
            </div>
          ) : null}
          {pollError || pollingStopped ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-amber-300">
              <span>{pollError?.message ?? t("knowledge.sources.job.pollingStopped")}</span>
              <Button size="sm" variant="outline" onClick={onResumePolling}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t("knowledge.history.resume")}
              </Button>
            </div>
          ) : null}
          <p className="mt-2 truncate text-xs text-zinc-700">
            {t("knowledge.history.progressId", { id: operation.jobId })}
          </p>
        </div>
        {terminal ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
            {showActivationAction && operation.kind === "PUBLISH" && status === "SUCCEEDED" ? (
              <Button
                size="sm"
                onClick={onActivate}
                data-testid="knowledge-activate-customer-replies"
              >
                {t("knowledge.quickStart.action.activateReplies")}
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
            ) : null}
            {failed && canRetry ? (
              <Button
                size="sm"
                variant="outline"
                onClick={operation.kind === "PUBLISH" ? onRetryPublish : onRetryRollback}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t("knowledge.common.tryAgain")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              {t("knowledge.common.dismiss")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ErrorNotice({
  error,
  onRetry,
  onReload,
}: {
  error: ApiClientError;
  onRetry?: () => void;
  onReload?: () => void;
}) {
  const { t } = useI18n();
  const conflict = error.status === 412 || error.code === "REVISION_CONFLICT";
  return (
    <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3" role="alert">
      <div className="flex gap-3">
        {conflict ? (
          <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">
            {conflict ? t("knowledge.history.error.conflictTitle") : error.message}
          </p>
          {conflict ? <p className="mt-1 text-xs text-zinc-500">{error.message}</p> : null}
          {error.retryable ? (
            <p className="mt-1 text-xs text-amber-300">{t("knowledge.history.error.retryable")}</p>
          ) : null}
          {error.fieldErrors?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-rose-300">
              {error.fieldErrors.map((fieldError) => (
                <li key={`${fieldError.field}:${fieldError.code}`}>
                  <span className="font-medium">{fieldError.field}:</span> {fieldError.message}
                </li>
              ))}
            </ul>
          ) : null}
          {error.requestId ? (
            <p className="mt-2 text-xs text-zinc-700">
              {t("knowledge.common.request", { id: error.requestId })}
            </p>
          ) : null}
          {onRetry || onReload ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {onReload ? (
                <Button size="sm" variant="outline" onClick={onReload}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  {t("knowledge.history.error.reload")}
                </Button>
              ) : null}
              {onRetry && !conflict ? (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  {t("knowledge.common.tryAgain")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
