"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  BusinessImportApplicationView,
  BusinessImportApplyEligibilityView,
  BusinessImportApplyPreviewView,
  BusinessImportCandidateAction,
  BusinessImportCandidateView,
  BusinessImportDiagnosticView,
  BusinessImportMappingConfirmRequest,
  BusinessImportMappingView,
  BusinessImportOfferingValue,
  BusinessImportState,
  BusinessImportView,
  BusinessOfferingPriceType,
} from "@leadvirt/types";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Eye,
  FileSearch,
  FileSpreadsheet,
  FileUp,
  FlaskConical,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import {
  applyBusinessImport,
  bulkApproveBusinessImportCandidates,
  bulkDecideBusinessImportCandidates,
  cancelBusinessImport,
  confirmBusinessImportMapping,
  createBusinessImportIdempotencyKey,
  decideBusinessImportApproval,
  getBusinessImport,
  getBusinessImportMapping,
  listBusinessImportApplications,
  listBusinessImportCandidates,
  previewBusinessImportApply,
  rebaseBusinessImport,
  requestBusinessImportApproval,
  retryBusinessImport,
  updateBusinessImportCandidate,
} from "@/lib/api/business-imports";
import { ApiClientError } from "@/lib/api/client";
import { businessImportEnabled } from "@/lib/features";
import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/utils";
import { ProductLayout } from "../../ProductLayout";
import { useProductPermissions } from "../../CurrentUser";
import { EmptyState, LoadingOverlay, Modal, Select, StatusBadge } from "../../ui";
import { BusinessImportUploadDialog } from "./BusinessImportUploadDialog";
import { BusinessImportMappingWorkspace } from "./BusinessImportMappingWorkspace";
import { businessImportStateKeys, businessImportStateTone } from "./businessImportPresentation";

const IMPORT_POLL_INTERVAL_MS = 3_000;
const MAX_IMPORTED_SERVICES = 200;
const MAX_MISSING_SOURCE_SERVICES = 200;
const MAX_REVIEW_CANDIDATES = MAX_IMPORTED_SERVICES + MAX_MISSING_SOURCE_SERVICES;
const REVIEW_PAGE_SIZE = 100;
const MAX_REVIEW_PAGES = MAX_REVIEW_CANDIDATES / REVIEW_PAGE_SIZE;
const PROCESSING_STATES = new Set<BusinessImportState>([
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "PARSING",
  "EXTRACTING",
  "APPLYING",
  "PROJECTING",
]);
const REVIEW_STATES = new Set<BusinessImportState>([
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "PARTIALLY_APPLIED",
  "CLOSED_WITH_REMAINDER",
]);
const TERMINAL_FAILURE_STATES = new Set<BusinessImportState>([
  "FAILED_RETRYABLE",
  "FAILED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
]);

const actionKeys: Record<BusinessImportCandidateAction, TranslationKey> = {
  ADD: "businessImport.action.add",
  UPDATE: "businessImport.action.update",
  LINK: "businessImport.action.link",
  UNCHANGED: "businessImport.action.unchanged",
  CONFLICT: "businessImport.action.conflict",
  INVALID: "businessImport.action.invalid",
  MISSING: "businessImport.action.missing",
  ARCHIVE: "businessImport.action.archive",
};

type ReviewFilter = "ALL" | "SELECTED" | "ATTENTION" | "APPROVAL";

function asApiError(error: unknown, fallback: string) {
  return error instanceof ApiClientError
    ? error
    : new ApiClientError(fallback, 500, "HTTP_ERROR", true);
}

function actionTone(action: BusinessImportCandidateAction) {
  if (action === "ADD") return "success" as const;
  if (action === "UPDATE") return "info" as const;
  if (action === "LINK") return "success" as const;
  if (["CONFLICT", "MISSING", "ARCHIVE"].includes(action)) return "warning" as const;
  if (action === "INVALID") return "error" as const;
  return "info" as const;
}

function diagnosticText(
  diagnostic: BusinessImportDiagnosticView,
  t: ReturnType<typeof useI18n>["t"],
) {
  const code = diagnostic.code;
  if (code === "BUSINESS_IMPORT_MISSING_FROM_REVISION") {
    return t("businessImport.diagnostic.missingFromFile");
  }
  if (code.includes("SERVICE_NAME_REQUIRED") || code.includes("NAME_COLUMN_REQUIRED")) {
    return t("businessImport.diagnostic.nameRequired");
  }
  if (code.includes("PRICE") || code.includes("CURRENCY")) {
    return t("businessImport.diagnostic.priceInvalid");
  }
  if (code.includes("DURATION")) return t("businessImport.diagnostic.durationInvalid");
  if (code.includes("DUPLICATE") || code.includes("AMBIGUOUS")) {
    return t("businessImport.diagnostic.duplicate");
  }
  if (code.includes("LIMIT") || code.includes("TOO_LONG") || code.includes("TOO_LARGE")) {
    return t("businessImport.diagnostic.limit");
  }
  if (code.includes("EVIDENCE")) return t("businessImport.diagnostic.evidence");
  if (
    code.includes("REBASE") ||
    code.includes("REVISION_CONFLICT") ||
    code.includes("TARGET_CHANGED") ||
    code.includes("STALE")
  ) {
    return t("businessImport.diagnostic.dataChanged");
  }
  if (
    code.includes("PROHIBITED") ||
    code.includes("MALWARE") ||
    code.includes("ACTIVE_CONTENT") ||
    code.includes("MACRO") ||
    code.includes("PATH_TRAVERSAL") ||
    code.includes("EXTERNAL_FORMULA")
  ) {
    return t("businessImport.diagnostic.unsafe");
  }
  if (code.includes("CSV_") || code.includes("XLSX_") || code.includes("PDF_")) {
    return t("businessImport.diagnostic.fileInvalid");
  }
  if (code.includes("INVALID_ROW") || code.includes("VALUE_INVALID")) {
    return t("businessImport.diagnostic.rowInvalid");
  }
  return diagnostic.message;
}

function hasBlockingDiagnostic(candidate: BusinessImportCandidateView) {
  return candidate.diagnostics.some((item) => item.severity === "ERROR");
}

function selected(candidate: BusinessImportCandidateView) {
  return candidate.selected;
}

function approvalRequired(candidate: BusinessImportCandidateView) {
  return candidate.requiresApproval && candidate.approval?.state !== "APPROVED";
}

function approvalRequestNeeded(candidate: BusinessImportCandidateView) {
  return candidate.requiresApproval && !candidate.approval;
}

function approvalVersionClosed(candidate: BusinessImportCandidateView) {
  return Boolean(
    candidate.approval && ["REJECTED", "INVALIDATED"].includes(candidate.approval.state),
  );
}

function applyEligible(candidate: BusinessImportCandidateView) {
  return (
    candidate.selected &&
    ["ADD", "UPDATE", "LINK", "ARCHIVE"].includes(candidate.action) &&
    !hasBlockingDiagnostic(candidate) &&
    !approvalRequired(candidate)
  );
}

function cloneOffering(value: BusinessImportOfferingValue): BusinessImportOfferingValue {
  return {
    ...value,
    price: value.price ? { ...value.price } : null,
    duration: value.duration ? { ...value.duration } : null,
  };
}

const priceTypeKeys: Record<BusinessOfferingPriceType, TranslationKey> = {
  FIXED: "businessImport.priceType.fixed",
  FROM: "businessImport.priceType.from",
  RANGE: "businessImport.priceType.range",
  FREE: "businessImport.priceType.free",
  ON_REQUEST: "businessImport.priceType.onRequest",
};

interface OfferingDisplayField {
  key: string;
  label: string;
  value: string;
}

function offeringDisplayFields(
  value: BusinessImportOfferingValue,
  t: ReturnType<typeof useI18n>["t"],
): OfferingDisplayField[] {
  const text = (item: string | number | null | undefined) =>
    item === null || item === undefined || String(item).trim() === "" ? "-" : String(item);
  return [
    {
      key: "externalId",
      label: t("businessImport.field.externalId"),
      value: text(value.externalId),
    },
    { key: "name", label: t("businessImport.edit.name"), value: text(value.name) },
    { key: "category", label: t("businessImport.field.category"), value: text(value.category) },
    {
      key: "description",
      label: t("businessImport.edit.descriptionLabel"),
      value: text(value.description),
    },
    {
      key: "priceType",
      label: t("businessImport.field.priceType"),
      value: value.price ? t(priceTypeKeys[value.price.type]) : "-",
    },
    { key: "amount", label: t("businessImport.field.amount"), value: text(value.price?.amount) },
    { key: "from", label: t("businessImport.field.from"), value: text(value.price?.from) },
    { key: "to", label: t("businessImport.field.to"), value: text(value.price?.to) },
    {
      key: "currency",
      label: t("businessImport.edit.currency"),
      value: text(value.price?.currency),
    },
    { key: "unit", label: t("businessImport.field.unit"), value: text(value.price?.unit) },
    { key: "taxNote", label: t("businessImport.field.taxNote"), value: text(value.price?.taxNote) },
    {
      key: "minimumMinutes",
      label: t("businessImport.field.minimumMinutes"),
      value: text(value.duration?.minimumMinutes),
    },
    {
      key: "maximumMinutes",
      label: t("businessImport.field.maximumMinutes"),
      value: text(value.duration?.maximumMinutes),
    },
    {
      key: "locationExternalId",
      label: t("businessImport.field.locationExternalId"),
      value: text(value.locationExternalId),
    },
    {
      key: "bookingNotes",
      label: t("businessImport.field.bookingNotes"),
      value: text(value.bookingNotes),
    },
    {
      key: "active",
      label: t("businessImport.field.active"),
      value: t(value.active ? "businessImport.common.yes" : "businessImport.common.no"),
    },
    { key: "validFrom", label: t("businessImport.field.validFrom"), value: text(value.validFrom) },
    {
      key: "validUntil",
      label: t("businessImport.field.validUntil"),
      value: text(value.validUntil),
    },
    { key: "language", label: t("businessImport.field.language"), value: text(value.language) },
  ];
}

export function BusinessImportPage({ importId }: { importId: string }) {
  const { formatNumber, t } = useI18n();
  const router = useRouter();
  const permissions = useProductPermissions();
  const [resource, setResource] = React.useState<BusinessImportView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<ApiClientError | null>(null);
  const [mapping, setMapping] = React.useState<BusinessImportMappingView | null>(null);
  const [mappingLoading, setMappingLoading] = React.useState(false);
  const [mappingError, setMappingError] = React.useState<ApiClientError | null>(null);
  const [mappingSaveError, setMappingSaveError] = React.useState<ApiClientError | null>(null);
  const [candidates, setCandidates] = React.useState<BusinessImportCandidateView[]>([]);
  const [candidateLoading, setCandidateLoading] = React.useState(false);
  const [candidateError, setCandidateError] = React.useState<ApiClientError | null>(null);
  const [search, setSearch] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState<"ALL" | BusinessImportCandidateAction>(
    "ALL",
  );
  const [reviewFilter, setReviewFilter] = React.useState<ReviewFilter>("ALL");
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());
  const [operation, setOperation] = React.useState<
    | "candidateDecision"
    | "candidateEdit"
    | "approvalDecision"
    | "preview"
    | "apply"
    | "approval"
    | "bulkApproval"
    | "bulkDecision"
    | "retry"
    | "cancel"
    | "rebase"
    | "mapping"
    | null
  >(null);
  const [operationError, setOperationError] = React.useState<ApiClientError | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [preview, setPreview] = React.useState<BusinessImportApplyPreviewView | null>(null);
  const [previewCandidates, setPreviewCandidates] = React.useState<BusinessImportCandidateView[]>(
    [],
  );
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [applyIdempotencyKey, setApplyIdempotencyKey] = React.useState<string | null>(null);
  const [application, setApplication] = React.useState<BusinessImportApplicationView | null>(null);
  const [applicationError, setApplicationError] = React.useState<ApiClientError | null>(null);
  const [evidenceCandidate, setEvidenceCandidate] =
    React.useState<BusinessImportCandidateView | null>(null);
  const [evidenceOpen, setEvidenceOpen] = React.useState(false);
  const [editCandidate, setEditCandidate] = React.useState<BusinessImportCandidateView | null>(
    null,
  );
  const [editValue, setEditValue] = React.useState<BusinessImportOfferingValue | null>(null);
  const [editError, setEditError] = React.useState<ApiClientError | null>(null);
  const [revisionUploadOpen, setRevisionUploadOpen] = React.useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = React.useState(false);
  const mounted = React.useRef(false);
  const requestSequence = React.useRef(0);
  const mappingRequestSequence = React.useRef(0);
  const mappingMutation = React.useRef<{ request: string; idempotencyKey: string } | null>(null);
  const candidateRequestSequence = React.useRef(0);
  const applicationRequestSequence = React.useRef(0);

  const canApprove = permissions.role === "OWNER" || permissions.role === "ADMIN";
  const canEdit = canApprove || permissions.role === "MANAGER";

  const loadImport = React.useCallback(
    async (showLoading = false) => {
      const sequence = ++requestSequence.current;
      if (showLoading) setLoading(true);
      try {
        const next = await getBusinessImport(importId);
        if (!mounted.current || sequence !== requestSequence.current) return null;
        setResource(next);
        setLoadError(null);
        return next;
      } catch (caught) {
        if (!mounted.current || sequence !== requestSequence.current) return null;
        setLoadError(asApiError(caught, t("businessImport.error.load")));
        return null;
      } finally {
        if (mounted.current && sequence === requestSequence.current) setLoading(false);
      }
    },
    [importId, t],
  );

  const loadMapping = React.useCallback(async () => {
    const sequence = ++mappingRequestSequence.current;
    setMappingLoading(true);
    setMappingError(null);
    try {
      const next = await getBusinessImportMapping(importId);
      if (!mounted.current || sequence !== mappingRequestSequence.current) return;
      setMapping((current) => (current?.etag === next.etag ? current : next));
    } catch (caught) {
      if (!mounted.current || sequence !== mappingRequestSequence.current) return;
      setMappingError(asApiError(caught, t("businessImport.mapping.loadError")));
    } finally {
      if (mounted.current && sequence === mappingRequestSequence.current) {
        setMappingLoading(false);
      }
    }
  }, [importId, t]);

  const loadCandidates = React.useCallback(
    async (expectedTotalOverride?: number) => {
      const sequence = ++candidateRequestSequence.current;
      setCandidateLoading(true);
      setCandidateError(null);
      try {
        const expectedTotal = expectedTotalOverride ?? resource?.counts.total;
        if (expectedTotal !== undefined && expectedTotal > MAX_REVIEW_CANDIDATES) {
          throw new ApiClientError(
            t("businessImport.review.limitExceeded", {
              count: expectedTotal,
              maximum: MAX_REVIEW_CANDIDATES,
            }),
            409,
            "BUSINESS_IMPORT_REVIEW_LIMIT_EXCEEDED",
            false,
          );
        }
        const loaded: BusinessImportCandidateView[] = [];
        const seenCursors = new Set<string>();
        let pageCount = 0;
        let cursor: string | undefined;
        do {
          pageCount += 1;
          if (pageCount > MAX_REVIEW_PAGES) {
            throw new ApiClientError(
              t("businessImport.review.incompleteLoad"),
              409,
              "BUSINESS_IMPORT_PAGINATION_INVALID",
              true,
            );
          }
          const page = await listBusinessImportCandidates(importId, {
            limit: REVIEW_PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          });
          if (!mounted.current || sequence !== candidateRequestSequence.current) return;
          loaded.push(...page.items);
          if (loaded.length > MAX_REVIEW_CANDIDATES) {
            throw new ApiClientError(
              t("businessImport.review.limitExceeded", {
                count: loaded.length,
                maximum: MAX_REVIEW_CANDIDATES,
              }),
              409,
              "BUSINESS_IMPORT_REVIEW_LIMIT_EXCEEDED",
              false,
            );
          }
          const next = page.nextCursor ?? undefined;
          if (next && seenCursors.has(next)) {
            throw new ApiClientError(
              t("businessImport.review.incompleteLoad"),
              409,
              "BUSINESS_IMPORT_PAGINATION_INVALID",
              true,
            );
          }
          if (next) seenCursors.add(next);
          cursor = next;
        } while (cursor);
        const unique = Array.from(
          new Map(loaded.map((candidate) => [candidate.id, candidate])).values(),
        );
        if (
          unique.length !== loaded.length ||
          (expectedTotal !== undefined && unique.length !== expectedTotal)
        ) {
          throw new ApiClientError(
            t("businessImport.review.incompleteLoad"),
            409,
            "BUSINESS_IMPORT_CANDIDATE_SET_CHANGED",
            true,
          );
        }
        if (!mounted.current || sequence !== candidateRequestSequence.current) return;
        setCandidates(unique);
      } catch (caught) {
        if (!mounted.current || sequence !== candidateRequestSequence.current) return;
        setCandidateError(asApiError(caught, t("businessImport.error.candidates")));
      } finally {
        if (mounted.current && sequence === candidateRequestSequence.current) {
          setCandidateLoading(false);
        }
      }
    },
    [importId, resource?.counts.total, t],
  );

  const loadApplications = React.useCallback(async () => {
    const sequence = ++applicationRequestSequence.current;
    try {
      const page = await listBusinessImportApplications(importId, { limit: 10 });
      if (mounted.current && sequence === applicationRequestSequence.current) {
        setApplication(page.items[0] ?? null);
        setApplicationError(null);
      }
    } catch (caught) {
      if (mounted.current && sequence === applicationRequestSequence.current) {
        setApplicationError(asApiError(caught, t("businessImport.error.applications")));
      }
    }
  }, [importId, t]);

  const refreshAll = React.useCallback(
    async (showLoading = false) => {
      const next = await loadImport(showLoading);
      if (!next) return;
      const tasks: Promise<void>[] = [];
      if (next.state === "MAPPING_REQUIRED" && next.format === "CSV") {
        tasks.push(loadMapping());
      } else {
        setMapping(null);
        setMappingError(null);
        setMappingSaveError(null);
      }
      if (
        REVIEW_STATES.has(next.state) ||
        ["PROJECTING", "PROJECTION_DELAYED", "APPLIED"].includes(next.state)
      ) {
        tasks.push(loadCandidates(next.counts.total));
      }
      if (
        ["PROJECTING", "PROJECTION_DELAYED", "APPLIED", "PARTIALLY_APPLIED"].includes(next.state)
      ) {
        tasks.push(loadApplications());
      }
      await Promise.all(tasks);
    },
    [loadApplications, loadCandidates, loadImport, loadMapping],
  );

  const refreshAfterConflict = React.useCallback(
    async (error: ApiClientError) => {
      setConflict(
        ["BUSINESS_IMPORT_REBASE_REQUIRED", "BUSINESS_INFORMATION_REVISION_CONFLICT"].includes(
          error.code,
        ),
      );
      await refreshAll(false);
    },
    [refreshAll],
  );

  React.useEffect(() => {
    mounted.current = true;
    void loadImport(true);
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      mappingRequestSequence.current += 1;
      candidateRequestSequence.current += 1;
      applicationRequestSequence.current += 1;
    };
  }, [loadImport]);

  React.useEffect(() => {
    if (
      !resource ||
      (!PROCESSING_STATES.has(resource.state) && resource.state !== "PROJECTION_DELAYED")
    )
      return;
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshAll(false);
    };
    const timer = window.setInterval(refresh, IMPORT_POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshAll, resource]);

  React.useEffect(() => {
    if (!resource) return;
    if (resource.state === "MAPPING_REQUIRED" && resource.format === "CSV") {
      void loadMapping();
    } else {
      mappingRequestSequence.current += 1;
      mappingMutation.current = null;
      setMapping(null);
      setMappingError(null);
      setMappingSaveError(null);
      setMappingLoading(false);
    }
    if (
      REVIEW_STATES.has(resource.state) ||
      ["PROJECTING", "PROJECTION_DELAYED", "APPLIED"].includes(resource.state)
    ) {
      void loadCandidates();
    }
    if (
      ["PROJECTING", "PROJECTION_DELAYED", "APPLIED", "PARTIALLY_APPLIED"].includes(resource.state)
    ) {
      void loadApplications();
    }
  }, [loadApplications, loadCandidates, loadMapping, resource?.id, resource?.state]);

  function replaceCandidate(next: BusinessImportCandidateView) {
    setCandidates((current) => current.map((item) => (item.id === next.id ? next : item)));
    if (evidenceCandidate?.id === next.id) setEvidenceCandidate(next);
  }

  function mergeCandidateUpdates(updates: BusinessImportCandidateView[]) {
    const byId = new Map(updates.map((candidate) => [candidate.id, candidate]));
    setCandidates((current) => current.map((candidate) => byId.get(candidate.id) ?? candidate));
    if (evidenceCandidate) {
      setEvidenceCandidate(byId.get(evidenceCandidate.id) ?? evidenceCandidate);
    }
  }

  async function decideCandidate(
    candidate: BusinessImportCandidateView,
    decision: "ACCEPTED" | "REJECTED",
  ) {
    if (
      !canEdit ||
      operation ||
      previewOpen ||
      pendingIds.size > 0 ||
      pendingIds.has(candidate.id) ||
      !candidate.allowedDecisions.includes(decision)
    ) {
      return;
    }
    setOperation("candidateDecision");
    setPendingIds((current) => new Set(current).add(candidate.id));
    setOperationError(null);
    try {
      const response = await updateBusinessImportCandidate(
        importId,
        candidate.id,
        { decision },
        {
          "If-Match": candidate.etag,
          "Idempotency-Key": createBusinessImportIdempotencyKey(),
        },
      );
      replaceCandidate(response.data);
      await loadImport(false);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.decision"));
      setOperationError(error);
      if (error.status === 412) {
        await refreshAfterConflict(error);
      }
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(candidate.id);
        return next;
      });
      setOperation(null);
    }
  }

  async function decideVisibleCandidates(
    scope: BusinessImportCandidateView[],
    decision: "ACCEPTED" | "REJECTED",
  ) {
    if (!resource || !canEdit || operation || previewOpen || pendingIds.size > 0) return;
    const target = scope.filter(
      (candidate) =>
        !approvalVersionClosed(candidate) &&
        candidate.allowedDecisions.includes(decision) &&
        (decision === "ACCEPTED" ? !selected(candidate) : candidate.decision !== "REJECTED"),
    );
    if (target.length === 0) return;
    setOperation("bulkDecision");
    setPendingIds(new Set(target.map((candidate) => candidate.id)));
    setOperationError(null);
    try {
      await bulkDecideBusinessImportCandidates(
        importId,
        {
          candidates: target.map((candidate) => ({
            id: candidate.id,
            etag: candidate.etag,
            decision,
          })),
        },
        {
          "If-Match": resource.etag,
          "Idempotency-Key": createBusinessImportIdempotencyKey(),
        },
      );
      await refreshAll(false);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.decision"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setPendingIds(new Set());
      setOperation(null);
    }
  }

  function openEdit(candidate: BusinessImportCandidateView) {
    if (!canEdit || operation || previewOpen || pendingIds.size > 0) return;
    setEditCandidate(candidate);
    setEditValue(cloneOffering(candidate.proposed));
    setEditError(null);
  }

  async function saveCandidateEdit() {
    if (
      !editCandidate ||
      !editValue ||
      !editValue.name.trim() ||
      operation ||
      pendingIds.size > 0 ||
      pendingIds.has(editCandidate.id)
    ) {
      return;
    }
    setOperation("candidateEdit");
    setPendingIds((current) => new Set(current).add(editCandidate.id));
    setEditError(null);
    try {
      const response = await updateBusinessImportCandidate(
        importId,
        editCandidate.id,
        { decision: "ACCEPTED", proposed: { ...editValue, name: editValue.name.trim() } },
        {
          "If-Match": editCandidate.etag,
          "Idempotency-Key": createBusinessImportIdempotencyKey(),
        },
      );
      replaceCandidate(response.data);
      setEditCandidate(null);
      setEditValue(null);
      await loadImport(false);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.edit"));
      if (error.status === 412) {
        setEditCandidate(null);
        setEditValue(null);
        setOperationError(error);
        await refreshAfterConflict(error);
      } else {
        setEditError(error);
      }
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(editCandidate.id);
        return next;
      });
      setOperation(null);
    }
  }

  async function requestApproval() {
    if (
      !resource ||
      operation ||
      previewOpen ||
      pendingIds.size > 0 ||
      candidateLoading ||
      candidateError ||
      candidates.length !== resource.counts.total
    )
      return;
    const ids = candidates
      .filter((item) => selected(item) && approvalRequestNeeded(item))
      .map((item) => item.id);
    if (ids.length === 0) return;
    setOperation("approval");
    setOperationError(null);
    try {
      const response = await requestBusinessImportApproval(
        importId,
        { candidateIds: ids },
        { "If-Match": resource.etag, "Idempotency-Key": createBusinessImportIdempotencyKey() },
      );
      setResource(response.data.import);
      mergeCandidateUpdates(response.data.candidates);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.approval"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  async function approveSelected() {
    if (
      !resource ||
      !canApprove ||
      operation ||
      previewOpen ||
      pendingIds.size > 0 ||
      candidateLoading ||
      candidateError ||
      candidates.length !== resource.counts.total
    ) {
      return;
    }
    const selectedForApproval = candidates.filter(
      (candidate) =>
        selected(candidate) && approvalRequired(candidate) && !approvalVersionClosed(candidate),
    );
    if (selectedForApproval.length === 0) return;
    setOperation("bulkApproval");
    setOperationError(null);
    try {
      const response = await bulkApproveBusinessImportCandidates(
        importId,
        {
          candidates: selectedForApproval.map((candidate) => ({
            id: candidate.id,
            version: candidate.version,
            etag: candidate.etag,
          })),
        },
        {
          "If-Match": resource.etag,
          "Idempotency-Key": createBusinessImportIdempotencyKey(),
        },
      );
      setResource(response.data.import);
      mergeCandidateUpdates(response.data.candidates);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.approval"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  async function decideApproval(
    candidate: BusinessImportCandidateView,
    decision: "APPROVED" | "REJECTED",
  ) {
    if (
      !resource ||
      !canApprove ||
      !candidate.approval ||
      operation ||
      previewOpen ||
      pendingIds.size > 0 ||
      pendingIds.has(candidate.id)
    )
      return;
    setOperation("approvalDecision");
    setPendingIds((current) => new Set(current).add(candidate.id));
    setOperationError(null);
    try {
      const response = await decideBusinessImportApproval(
        importId,
        candidate.approval.id,
        { decision },
        { "If-Match": resource.etag, "Idempotency-Key": createBusinessImportIdempotencyKey() },
      );
      setResource(response.data.import);
      mergeCandidateUpdates(response.data.candidates);
      setOperationError(null);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.approval"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(candidate.id);
        return next;
      });
      setOperation(null);
    }
  }

  async function prepareApply() {
    if (
      !resource ||
      operation ||
      previewOpen ||
      pendingIds.size > 0 ||
      !resource.allowedActions.includes("APPLY") ||
      !resource.applyEligibility.eligible ||
      candidateLoading ||
      candidateError ||
      candidates.length !== resource.counts.total
    ) {
      return;
    }
    setOperation("preview");
    setOperationError(null);
    setApplyIdempotencyKey(null);
    setPreviewCandidates([]);
    try {
      const chosen = candidates.filter(selected);
      const chosenSnapshot = structuredClone(chosen);
      if (chosen.length !== resource.applyEligibility.selectedCandidates) {
        await Promise.all([loadImport(false), loadCandidates()]);
        throw new ApiClientError(
          t("businessImport.error.preview"),
          409,
          "BUSINESS_IMPORT_SELECTION_CHANGED",
          true,
        );
      }
      const response = await previewBusinessImportApply(
        importId,
        { candidateIds: chosen.map((item) => item.id) },
        { "If-Match": resource.etag, "Idempotency-Key": createBusinessImportIdempotencyKey() },
      );
      const blocking = response.data.diagnostics.find(
        (diagnostic) => diagnostic.severity === "ERROR",
      );
      if (blocking) {
        setConflict(blocking.code === "BUSINESS_IMPORT_REBASE_REQUIRED");
        setOperationError(
          new ApiClientError(diagnosticText(blocking, t), 409, blocking.code, false),
        );
        return;
      }
      const previewIds = new Set(response.data.candidateIds);
      const exactSnapshot = chosenSnapshot.filter(
        (candidate) =>
          previewIds.has(candidate.id) &&
          response.data.candidateVersions[candidate.id] === candidate.version,
      );
      if (
        exactSnapshot.length !== response.data.candidateIds.length ||
        exactSnapshot.length !== chosenSnapshot.length
      ) {
        throw new ApiClientError(
          t("businessImport.error.preview"),
          409,
          "BUSINESS_IMPORT_SELECTION_CHANGED",
          true,
        );
      }
      setPreview(response.data);
      setPreviewCandidates(exactSnapshot);
      setApplyIdempotencyKey(createBusinessImportIdempotencyKey());
      setPreviewOpen(true);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.preview"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  async function executeApply() {
    if (!resource || !preview || !applyIdempotencyKey || operation) return;
    setOperation("apply");
    setOperationError(null);
    try {
      const response = await applyBusinessImport(
        importId,
        { candidateIds: preview.candidateIds, manifestHash: preview.manifestHash },
        {
          "If-Match": resource.etag,
          "X-Business-Information-If-Match": preview.businessInformationEtag,
          "Idempotency-Key": applyIdempotencyKey,
        },
      );
      setApplication(response.data);
      setPreviewOpen(false);
      setPreview(null);
      setPreviewCandidates([]);
      setApplyIdempotencyKey(null);
      await loadImport(false);
      await loadCandidates();
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.apply"));
      setOperationError(error);
      if (
        error.status === 412 ||
        [
          "BUSINESS_IMPORT_PREVIEW_EXPIRED",
          "BUSINESS_IMPORT_PREVIEW_INTEGRITY_FAILED",
          "BUSINESS_IMPORT_SELECTION_CHANGED",
        ].includes(error.code)
      ) {
        setPreviewOpen(false);
        setPreview(null);
        setPreviewCandidates([]);
        setApplyIdempotencyKey(null);
      }
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  async function rebase() {
    if (
      !resource ||
      operation ||
      pendingIds.size > 0 ||
      !resource.allowedActions.includes("REBASE")
    )
      return;
    setOperation("rebase");
    try {
      const response = await rebaseBusinessImport(
        importId,
        { candidateIds: null },
        {
          "If-Match": resource.etag,
          "Idempotency-Key": createBusinessImportIdempotencyKey(),
        },
      );
      setResource(response.data);
      setConflict(false);
      setOperationError(null);
      await loadCandidates();
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.rebase"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  async function confirmMapping(request: BusinessImportMappingConfirmRequest) {
    if (!resource || !mapping || !canEdit || operation || resource.state !== "MAPPING_REQUIRED") {
      return;
    }
    setOperation("mapping");
    setMappingSaveError(null);
    const serializedRequest = JSON.stringify(request);
    if (mappingMutation.current?.request !== serializedRequest) {
      mappingMutation.current = {
        request: serializedRequest,
        idempotencyKey: createBusinessImportIdempotencyKey(),
      };
    }
    try {
      const response = await confirmBusinessImportMapping(importId, request, {
        "If-Match": mapping.etag,
        "Idempotency-Key": mappingMutation.current.idempotencyKey,
      });
      mappingMutation.current = null;
      setMapping(null);
      setResource((current) =>
        current
          ? {
              ...current,
              state: response.data.state,
              generation: response.data.generation,
              etag: response.data.etag,
            }
          : current,
      );
      await loadImport(false);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.mapping.saveError"));
      if (error.status === 412) {
        mappingMutation.current = null;
        await loadImport(false);
        await loadMapping();
        setMappingSaveError(
          new ApiClientError(
            t("businessImport.mapping.conflict"),
            412,
            error.code,
            false,
            undefined,
            undefined,
            error.requestId,
          ),
        );
      } else {
        setMappingSaveError(error);
      }
    } finally {
      setOperation(null);
    }
  }

  async function retry() {
    if (!resource || operation || pendingIds.size > 0 || !resource.allowedActions.includes("RETRY"))
      return;
    setOperation("retry");
    try {
      const response = await retryBusinessImport(
        importId,
        { generation: resource.generation },
        {
          "If-Match": resource.etag,
          "Idempotency-Key": createBusinessImportIdempotencyKey(),
        },
      );
      setResource(response.data);
      setOperationError(null);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.retry"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  async function cancel() {
    if (
      !resource ||
      operation ||
      pendingIds.size > 0 ||
      !resource.allowedActions.includes("CANCEL")
    )
      return;
    setOperation("cancel");
    setOperationError(null);
    try {
      await cancelBusinessImport(importId, {
        "If-Match": resource.etag,
        "Idempotency-Key": createBusinessImportIdempotencyKey(),
      });
      setCancelConfirmOpen(false);
      await loadImport(false);
      setOperationError(null);
    } catch (caught) {
      const error = asApiError(caught, t("businessImport.error.cancel"));
      setOperationError(error);
      if (error.status === 412) await refreshAfterConflict(error);
    } finally {
      setOperation(null);
    }
  }

  function openCancelConfirmation() {
    if (operation || pendingIds.size > 0) return;
    setOperationError(null);
    setCancelConfirmOpen(true);
  }

  if (!businessImportEnabled) {
    return (
      <ProductLayout title="Knowledge">
        <EmptyState
          icon={ShieldCheck}
          title={t("businessImport.disabled.title")}
          description={t("businessImport.disabled.description")}
          action={
            <Button asChild variant="outline">
              <Link href="/app/knowledge?view=business">{t("businessImport.common.back")}</Link>
            </Button>
          }
        />
      </ProductLayout>
    );
  }

  if (!importId) {
    return (
      <ProductLayout title="Knowledge">
        <EmptyState
          icon={AlertCircle}
          title={t("businessImport.error.invalidRoute")}
          action={
            <Button asChild variant="outline">
              <Link href="/app/knowledge?view=business">{t("businessImport.common.back")}</Link>
            </Button>
          }
        />
      </ProductLayout>
    );
  }

  const visibleCandidates = candidates.filter((candidate) => {
    const query = search.trim().toLocaleLowerCase();
    if (
      query &&
      ![candidate.proposed.name, candidate.proposed.category, candidate.proposed.description]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(query))
    ) {
      return false;
    }
    if (actionFilter !== "ALL" && candidate.action !== actionFilter) return false;
    if (reviewFilter === "SELECTED" && !selected(candidate)) return false;
    if (
      reviewFilter === "ATTENTION" &&
      !["CONFLICT", "INVALID", "MISSING", "ARCHIVE"].includes(candidate.action) &&
      !hasBlockingDiagnostic(candidate)
    ) {
      return false;
    }
    if (reviewFilter === "APPROVAL" && !approvalRequired(candidate)) return false;
    return true;
  });
  const selectedCandidates = candidates.filter(selected);
  const eligibleCandidates = candidates.filter(applyEligible);
  const approvalCandidates = selectedCandidates.filter(approvalRequestNeeded);
  const bulkApprovalCandidates = selectedCandidates.filter(
    (candidate) => approvalRequired(candidate) && !approvalVersionClosed(candidate),
  );
  const addCount = eligibleCandidates.filter((item) => item.action === "ADD").length;
  const updateCount = eligibleCandidates.filter((item) =>
    ["UPDATE", "ARCHIVE"].includes(item.action),
  ).length;
  const linkCount = eligibleCandidates.filter((item) => item.action === "LINK").length;
  const candidateSetComplete = Boolean(
    resource && !candidateLoading && !candidateError && candidates.length === resource.counts.total,
  );
  const reviewMutationLocked =
    operation !== null || pendingIds.size > 0 || previewOpen || loading || !candidateSetComplete;
  const testReady = Boolean(resource?.projection.ready || application?.projection.ready);

  return (
    <ProductLayout title="Knowledge" mobileTitle={t("businessImport.page.mobileTitle")}>
      <div
        className="mx-auto w-full min-w-0 max-w-[1500px] space-y-5 overflow-x-clip"
        data-testid="business-import-page"
      >
        <header className="flex min-w-0 flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/app/knowledge?view=business"
              className="inline-flex min-h-11 items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("businessImport.common.back")}
            </Link>
            <div className="mt-2 flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="break-words text-xl font-semibold text-zinc-50 sm:text-2xl">
                  {resource?.originalFilename || t("businessImport.page.title")}
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  {resource?.sourceName || t("businessImport.page.description")}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {resource ? (
              <StatusBadge status={businessImportStateTone(resource.state)}>
                {t(businessImportStateKeys[resource.state])}
              </StatusBadge>
            ) : null}
            {resource && canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevisionUploadOpen(true)}
                data-testid="business-import-upload-revision"
              >
                <FileUp className="h-4 w-4" />
                {t("businessImport.entry.uploadNewRevision")}
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="outline"
              aria-label={t("businessImport.common.refresh")}
              disabled={loading}
              onClick={() => void refreshAll(true)}
              data-testid="business-import-refresh"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        {loading && !resource ? <LoadingOverlay label={t("businessImport.loading")} /> : null}

        {loadError && !resource ? (
          <EmptyState
            icon={TriangleAlert}
            title={t("businessImport.error.loadTitle")}
            description={loadError.message}
            action={
              <Button onClick={() => void loadImport(true)}>
                <RefreshCw className="h-4 w-4" />
                {t("businessImport.common.tryAgain")}
              </Button>
            }
          />
        ) : null}

        {loadError && resource ? (
          <div
            className="flex min-w-0 flex-col gap-3 border-y border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 sm:flex-row sm:items-center"
            role="alert"
            data-testid="business-import-refresh-error"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <p className="min-w-0 flex-1 break-words text-sm text-rose-200">{loadError.message}</p>
            <Button variant="outline" size="sm" onClick={() => void loadImport(false)}>
              <RefreshCw className="h-4 w-4" />
              {t("businessImport.common.tryAgain")}
            </Button>
          </div>
        ) : null}

        {operationError ? (
          <div
            className="flex min-w-0 flex-col gap-3 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 sm:flex-row sm:items-center"
            role="alert"
            data-testid="business-import-operation-error"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <p className="min-w-0 flex-1 break-words text-sm text-rose-200">
              {operationError.message}
            </p>
            {conflict && resource?.allowedActions.includes("REBASE") ? (
              <Button
                variant="outline"
                size="sm"
                disabled={operation === "rebase"}
                onClick={() => void rebase()}
                data-testid="business-import-rebase"
              >
                <RotateCcw className={cn("h-4 w-4", operation === "rebase" && "animate-spin")} />
                {t("businessImport.review.rebase")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {applicationError ? (
          <div
            className="flex min-w-0 flex-col gap-3 border-y border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 sm:flex-row sm:items-center"
            role="alert"
            data-testid="business-import-application-error"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <p className="min-w-0 flex-1 break-words text-sm text-rose-200">
              {applicationError.message}
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadApplications()}>
              <RefreshCw className="h-4 w-4" />
              {t("businessImport.common.tryAgain")}
            </Button>
          </div>
        ) : null}

        {resource ? (
          <>
            {resource.state !== "MAPPING_REQUIRED" ? <ImportMetrics resource={resource} /> : null}
            {resource.diagnostics.length > 0 ? (
              <ImportDiagnostics diagnostics={resource.diagnostics} />
            ) : null}

            {PROCESSING_STATES.has(resource.state) &&
            !["APPLYING", "PROJECTING"].includes(resource.state) ? (
              <ProcessingState
                resource={resource}
                onCancel={openCancelConfirmation}
                busy={operation !== null}
              />
            ) : null}

            {resource.state === "MAPPING_REQUIRED" && resource.format === "CSV" ? (
              <BusinessImportMappingWorkspace
                mapping={mapping}
                loading={mappingLoading}
                error={mappingError}
                saveError={mappingSaveError}
                busy={operation === "mapping"}
                canEdit={canEdit}
                canCancel={resource.allowedActions.includes("CANCEL")}
                onRetry={() => void loadMapping()}
                onEdit={() => setMappingSaveError(null)}
                onCancel={openCancelConfirmation}
                onConfirm={(request) => void confirmMapping(request)}
              />
            ) : null}

            {resource.state === "MAPPING_REQUIRED" && resource.format !== "CSV" ? (
              <UnsupportedMappingState
                resource={resource}
                onCancel={openCancelConfirmation}
                busy={operation !== null}
              />
            ) : null}

            {REVIEW_STATES.has(resource.state) ? (
              <ReviewWorkspace
                resource={resource}
                candidates={visibleCandidates}
                allCandidates={candidates}
                loading={candidateLoading}
                error={candidateError}
                search={search}
                actionFilter={actionFilter}
                reviewFilter={reviewFilter}
                pendingIds={pendingIds}
                mutationLocked={reviewMutationLocked}
                evidenceCandidate={evidenceCandidate}
                canApprove={canApprove}
                onSearch={setSearch}
                onActionFilter={setActionFilter}
                onReviewFilter={setReviewFilter}
                onDecide={(candidate, decision) => void decideCandidate(candidate, decision)}
                onBulkDecision={(scope, decision) => void decideVisibleCandidates(scope, decision)}
                onEdit={openEdit}
                onEvidence={(candidate) => {
                  setEvidenceCandidate(candidate);
                  setEvidenceOpen(true);
                }}
                onSelectEvidence={setEvidenceCandidate}
                onApprove={(candidate) => void decideApproval(candidate, "APPROVED")}
                onRejectApproval={(candidate) => void decideApproval(candidate, "REJECTED")}
                onRetry={() => void loadCandidates()}
              />
            ) : null}

            {["APPLYING", "PROJECTING", "PROJECTION_DELAYED"].includes(resource.state) ? (
              <ProjectionState state={resource.state} onRefresh={() => void loadImport(false)} />
            ) : null}

            {resource.state === "APPLIED" ? (
              <AppliedState resource={resource} application={application} testReady={testReady} />
            ) : null}

            {TERMINAL_FAILURE_STATES.has(resource.state) ? (
              <FailureState
                resource={resource}
                busy={reviewMutationLocked}
                onRetry={() => void retry()}
              />
            ) : null}

            {canEdit && resource.allowedActions.includes("APPLY") ? (
              <ApplyActions
                addCount={addCount}
                updateCount={updateCount}
                linkCount={linkCount}
                approvalCount={
                  candidateSetComplete
                    ? canApprove
                      ? bulkApprovalCandidates.length
                      : approvalCandidates.length
                    : 0
                }
                approvalMode={canApprove ? "APPROVE" : "REQUEST"}
                eligibility={resource.applyEligibility}
                canApply={
                  candidateSetComplete &&
                  resource.allowedActions.includes("APPLY") &&
                  resource.applyEligibility.eligible
                }
                busy={operation !== null}
                onApply={() => void prepareApply()}
                onApproval={() => void requestApproval()}
                onBulkApproval={() => void approveSelected()}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <EvidenceDialog
        candidate={evidenceCandidate}
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
      />
      <EditCandidateDialog
        candidate={editCandidate}
        value={editValue}
        error={editError}
        busy={Boolean(editCandidate && pendingIds.has(editCandidate.id))}
        onValue={setEditValue}
        onOpenChange={(open) => {
          if (!open) {
            setEditCandidate(null);
            setEditValue(null);
            setEditError(null);
          }
        }}
        onSave={() => void saveCandidateEdit()}
      />
      <ApplyPreviewDialog
        preview={preview}
        candidates={previewCandidates}
        error={previewOpen ? operationError : null}
        open={previewOpen}
        busy={operation === "apply"}
        onOpenChange={(open) => {
          if (operation === "apply") return;
          setPreviewOpen(open);
          if (!open) {
            setPreview(null);
            setPreviewCandidates([]);
            setApplyIdempotencyKey(null);
            setOperationError(null);
          }
        }}
        onApply={() => void executeApply()}
      />
      <Modal
        open={cancelConfirmOpen}
        onOpenChange={(open) => {
          if (operation !== "cancel") setCancelConfirmOpen(open);
        }}
        title={t("businessImport.cancel.title")}
        description={t("businessImport.cancel.description")}
        closeLabel={t("businessImport.common.close")}
        className="max-w-lg rounded-lg"
        footer={
          <>
            <Button
              variant="outline"
              disabled={operation === "cancel"}
              onClick={() => setCancelConfirmOpen(false)}
            >
              {t("businessImport.common.close")}
            </Button>
            <Button
              variant="outline"
              className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
              disabled={operation === "cancel"}
              onClick={() => void cancel()}
              data-testid="business-import-cancel-confirm"
            >
              {operation === "cancel" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {t("businessImport.cancel.confirm")}
            </Button>
          </>
        }
      >
        {operationError ? (
          <p
            className="border-y border-rose-500/20 bg-rose-500/[0.06] px-3 py-3 text-sm text-rose-200"
            role="alert"
          >
            {operationError.message}
          </p>
        ) : null}
      </Modal>
      {resource && canEdit ? (
        <BusinessImportUploadDialog
          open={revisionUploadOpen}
          onOpenChange={setRevisionUploadOpen}
          onCreated={(nextImportId) => {
            setRevisionUploadOpen(false);
            router.push(`/app/knowledge/imports/${encodeURIComponent(nextImportId)}`);
          }}
          sourceId={resource.sourceId}
          sourceName={resource.sourceName}
        />
      ) : null}
    </ProductLayout>
  );

  function ImportMetrics({ resource: item }: { resource: BusinessImportView }) {
    const metrics = [
      ["businessImport.metrics.found", item.counts.total],
      ["businessImport.metrics.additions", item.counts.additions],
      ["businessImport.metrics.updates", item.counts.updates],
      ["businessImport.metrics.linked", item.counts.linked],
      ["businessImport.metrics.attention", item.counts.invalid + item.counts.conflicts],
    ] as const;
    return (
      <dl
        className="grid grid-cols-2 border-y border-white/10 sm:grid-cols-5"
        data-testid="business-import-metrics"
      >
        {metrics.map(([key, value]) => (
          <div key={key} className="min-w-0 px-3 py-3 sm:px-4">
            <dt className="text-xs text-zinc-500">{t(key)}</dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-100">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  function ProcessingState({
    resource: item,
    onCancel,
    busy,
  }: {
    resource: BusinessImportView;
    onCancel: () => void;
    busy: boolean;
  }) {
    const stages: Array<{ states: BusinessImportState[]; key: TranslationKey }> = [
      { states: ["CREATED", "UPLOADING", "UPLOADED"], key: "businessImport.processing.upload" },
      { states: ["SCANNING"], key: "businessImport.processing.security" },
      { states: ["PARSING"], key: "businessImport.processing.reading" },
      { states: ["EXTRACTING"], key: "businessImport.processing.recognizing" },
      { states: ["READY_FOR_REVIEW"], key: "businessImport.processing.preparing" },
    ];
    const stateOrder: BusinessImportState[] = [
      "CREATED",
      "UPLOADING",
      "UPLOADED",
      "SCANNING",
      "PARSING",
      "EXTRACTING",
      "READY_FOR_REVIEW",
    ];
    const currentIndex = stateOrder.indexOf(item.state);
    return (
      <section
        className="min-w-0 rounded-lg border border-white/10 bg-zinc-950/25 p-5 sm:p-6"
        data-testid="business-import-processing"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">
              {t("businessImport.processing.title")}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t("businessImport.processing.description")}
            </p>
          </div>
          {item.allowedActions.includes("CANCEL") ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
              {t("businessImport.processing.cancel")}
            </Button>
          ) : null}
        </div>
        <ol className="mt-6 divide-y divide-white/10 border-y border-white/10">
          {stages.map((stage) => {
            const stageIndex = Math.min(...stage.states.map((state) => stateOrder.indexOf(state)));
            const active = stage.states.includes(item.state);
            const done = currentIndex > stageIndex;
            return (
              <li key={stage.key} className="flex min-h-12 items-center gap-3 py-3">
                {done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                ) : active ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-400" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-zinc-700" />
                )}
                <span className={cn("text-sm", active || done ? "text-zinc-200" : "text-zinc-600")}>
                  {t(stage.key)}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-xs text-zinc-500">{t("businessImport.processing.leave")}</p>
      </section>
    );
  }

  function UnsupportedMappingState({
    resource: item,
    onCancel,
    busy,
  }: {
    resource: BusinessImportView;
    onCancel: () => void;
    busy: boolean;
  }) {
    return (
      <section
        className="flex min-w-0 flex-col gap-4 border-y border-amber-500/20 bg-amber-500/[0.05] px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        data-testid="business-import-mapping-unsupported"
        role="alert"
      >
        <div className="flex min-w-0 items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-amber-100">
              {t("businessImport.mapping.unsupportedTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-amber-100/65">
              {t("businessImport.mapping.unsupportedDescription", { format: item.format })}
            </p>
          </div>
        </div>
        {item.allowedActions.includes("CANCEL") ? (
          <Button
            variant="outline"
            className="min-h-11 shrink-0"
            disabled={busy}
            onClick={onCancel}
          >
            {t("businessImport.processing.cancel")}
          </Button>
        ) : null}
      </section>
    );
  }

  function AppliedState({
    resource: item,
    application: currentApplication,
    testReady: ready,
  }: {
    resource: BusinessImportView;
    application: BusinessImportApplicationView | null;
    testReady: boolean;
  }) {
    return (
      <section
        className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-5 sm:p-6"
        data-testid="business-import-applied"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-emerald-100">
              {t("businessImport.result.title")}
            </h2>
            <p className="mt-1 text-sm text-emerald-100/70">
              {t("businessImport.result.summary", {
                added: currentApplication?.counts.additions ?? item.counts.additions,
                updated: currentApplication?.counts.updates ?? item.counts.updates,
                linked: currentApplication?.counts.linked ?? item.counts.linked,
              })}
            </p>
            <p className="mt-3 text-sm text-sky-200/75">
              {t("businessImport.result.publicationBoundary")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {ready ? (
                <Button asChild data-testid="business-import-test-answers">
                  <Link href={`/app/knowledge?view=test&importId=${encodeURIComponent(item.id)}`}>
                    <FlaskConical className="h-4 w-4" />
                    {t("businessImport.result.testAnswers")}
                  </Link>
                </Button>
              ) : (
                <Button disabled data-testid="business-import-test-answers">
                  <FlaskConical className="h-4 w-4" />
                  {t("businessImport.result.testAnswers")}
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/app/knowledge?view=business">
                  {t("businessImport.result.openBusinessInformation")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/app/knowledge?view=history">
                  {t("businessImport.result.openPublication")}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function ProjectionState({
    state,
    onRefresh,
  }: {
    state: BusinessImportState;
    onRefresh: () => void;
  }) {
    const delayed = state === "PROJECTION_DELAYED";
    const applying = state === "APPLYING";
    return (
      <section
        className="rounded-lg border border-sky-500/20 bg-sky-500/[0.05] p-5 sm:p-6"
        data-testid="business-import-projecting"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {delayed ? (
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            ) : (
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-400" />
            )}
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                {t(
                  delayed
                    ? "businessImport.projection.delayedTitle"
                    : applying
                      ? "businessImport.projection.applyingTitle"
                      : "businessImport.projection.title",
                )}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {t(
                  delayed
                    ? "businessImport.projection.delayedDescription"
                    : applying
                      ? "businessImport.projection.applyingDescription"
                      : "businessImport.projection.description",
                )}
              </p>
              <p className="mt-3 text-xs text-zinc-500">
                {t("businessImport.result.publicationBoundary")}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            {t("businessImport.common.refresh")}
          </Button>
        </div>
      </section>
    );
  }

  function FailureState({
    resource: item,
    busy,
    onRetry,
  }: {
    resource: BusinessImportView;
    busy: boolean;
    onRetry: () => void;
  }) {
    const diagnostic = item.diagnostics.find((entry) => entry.severity === "ERROR");
    return (
      <EmptyState
        icon={item.state === "CANCELLED" ? XCircle : TriangleAlert}
        title={t(businessImportStateKeys[item.state])}
        description={
          diagnostic ? diagnosticText(diagnostic, t) : t("businessImport.failure.description")
        }
        action={
          item.allowedActions.includes("RETRY") ? (
            <Button disabled={busy} onClick={onRetry}>
              <RefreshCw className={cn("h-4 w-4", operation === "retry" && "animate-spin")} />
              {t("businessImport.common.tryAgain")}
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/app/knowledge?view=business">
                {t("businessImport.failure.chooseAnother")}
              </Link>
            </Button>
          )
        }
      />
    );
  }
}

function ReviewWorkspace({
  resource,
  candidates,
  allCandidates,
  loading,
  error,
  search,
  actionFilter,
  reviewFilter,
  pendingIds,
  mutationLocked,
  evidenceCandidate,
  canApprove,
  onSearch,
  onActionFilter,
  onReviewFilter,
  onDecide,
  onBulkDecision,
  onEdit,
  onEvidence,
  onSelectEvidence,
  onApprove,
  onRejectApproval,
  onRetry,
}: {
  resource: BusinessImportView;
  candidates: BusinessImportCandidateView[];
  allCandidates: BusinessImportCandidateView[];
  loading: boolean;
  error: ApiClientError | null;
  search: string;
  actionFilter: "ALL" | BusinessImportCandidateAction;
  reviewFilter: ReviewFilter;
  pendingIds: Set<string>;
  mutationLocked: boolean;
  evidenceCandidate: BusinessImportCandidateView | null;
  canApprove: boolean;
  onSearch: (value: string) => void;
  onActionFilter: (value: "ALL" | BusinessImportCandidateAction) => void;
  onReviewFilter: (value: ReviewFilter) => void;
  onDecide: (candidate: BusinessImportCandidateView, decision: "ACCEPTED" | "REJECTED") => void;
  onBulkDecision: (
    candidates: BusinessImportCandidateView[],
    decision: "ACCEPTED" | "REJECTED",
  ) => void;
  onEdit: (candidate: BusinessImportCandidateView) => void;
  onEvidence: (candidate: BusinessImportCandidateView) => void;
  onSelectEvidence: (candidate: BusinessImportCandidateView) => void;
  onApprove: (candidate: BusinessImportCandidateView) => void;
  onRejectApproval: (candidate: BusinessImportCandidateView) => void;
  onRetry: () => void;
}) {
  const { formatNumber, t } = useI18n();
  const actionOptions = (
    [
      "ALL",
      "ADD",
      "UPDATE",
      "LINK",
      "UNCHANGED",
      "CONFLICT",
      "INVALID",
      "MISSING",
      "ARCHIVE",
    ] as const
  ).map((value) => ({
    value,
    label: value === "ALL" ? t("businessImport.filter.allActions") : t(actionKeys[value]),
  }));
  const reviewOptions: Array<{ value: ReviewFilter; label: string }> = [
    { value: "ALL", label: t("businessImport.filter.all") },
    { value: "SELECTED", label: t("businessImport.filter.selected") },
    { value: "ATTENTION", label: t("businessImport.filter.attention") },
    { value: "APPROVAL", label: t("businessImport.filter.approval") },
  ];

  return (
    <section className="min-w-0 space-y-4" data-testid="business-import-review">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-100">
            {t("businessImport.review.title")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("businessImport.review.description", { count: formatNumber(resource.counts.total) })}
          </p>
        </div>
        <p className="text-xs text-zinc-500">{t("businessImport.review.saved")}</p>
      </div>

      <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(220px,1.4fr)_minmax(160px,0.8fr)_minmax(160px,0.8fr)]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("businessImport.filter.search")}
            aria-label={t("businessImport.filter.search")}
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15"
            data-testid="business-import-search"
          />
        </div>
        <Select
          value={actionFilter}
          options={actionOptions}
          ariaLabel={t("businessImport.filter.actionLabel")}
          onValueChange={(value) => onActionFilter(value as typeof actionFilter)}
          className="rounded-md px-3"
        />
        <Select
          value={reviewFilter}
          options={reviewOptions}
          ariaLabel={t("businessImport.filter.reviewLabel")}
          onValueChange={(value) => onReviewFilter(value as ReviewFilter)}
          className="rounded-md px-3"
        />
      </div>

      <BulkDecisionBar
        candidates={candidates}
        locked={mutationLocked}
        onDecision={onBulkDecision}
      />

      {error ? (
        <div
          className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3"
          role="alert"
        >
          <p className="text-sm text-rose-200">{error.message}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {t("businessImport.common.tryAgain")}
          </Button>
        </div>
      ) : null}

      {loading && allCandidates.length === 0 ? (
        <LoadingOverlay label={t("businessImport.review.loading")} />
      ) : candidates.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={t("businessImport.review.emptyTitle")}
          description={t("businessImport.review.emptyDescription")}
        />
      ) : (
        <>
          <div className="hidden min-w-0 gap-4 lg:grid 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 overflow-x-auto rounded-lg border border-white/10 bg-zinc-950/25">
              <table
                className="w-full min-w-[940px] text-left text-sm"
                data-testid="business-import-review-table"
              >
                <thead>
                  <tr className="border-b border-white/10 text-xs text-zinc-500">
                    <th className="w-44 px-3 py-3">{t("businessImport.review.decision")}</th>
                    <th className="px-3 py-3">{t("businessImport.review.service")}</th>
                    <th className="px-3 py-3">{t("businessImport.review.current")}</th>
                    <th className="px-3 py-3">{t("businessImport.review.proposed")}</th>
                    <th className="px-3 py-3">{t("businessImport.review.status")}</th>
                    <th className="w-28 px-3 py-3 text-right">
                      {t("businessImport.review.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.07]">
                  {candidates.map((candidate) => (
                    <CandidateTableRow
                      key={candidate.id}
                      candidate={candidate}
                      pending={pendingIds.has(candidate.id)}
                      mutationLocked={mutationLocked}
                      canApprove={canApprove}
                      onDecide={onDecide}
                      onEdit={onEdit}
                      onEvidence={(item) => {
                        onSelectEvidence(item);
                        onEvidence(item);
                      }}
                      onApprove={onApprove}
                      onRejectApproval={onRejectApproval}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <EvidencePanel candidate={evidenceCandidate ?? candidates[0] ?? null} />
          </div>

          <div
            className="divide-y divide-white/10 border-y border-white/10 lg:hidden"
            data-testid="business-import-review-mobile"
          >
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                pending={pendingIds.has(candidate.id)}
                mutationLocked={mutationLocked}
                canApprove={canApprove}
                onDecide={onDecide}
                onEdit={onEdit}
                onEvidence={onEvidence}
                onApprove={onApprove}
                onRejectApproval={onRejectApproval}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BulkDecisionBar({
  candidates,
  locked,
  onDecision,
}: {
  candidates: BusinessImportCandidateView[];
  locked: boolean;
  onDecision: (
    candidates: BusinessImportCandidateView[],
    decision: "ACCEPTED" | "REJECTED",
  ) => void;
}) {
  const { formatNumber, t } = useI18n();
  const includeCount = candidates.filter(
    (candidate) =>
      !approvalVersionClosed(candidate) &&
      candidate.allowedDecisions.includes("ACCEPTED") &&
      !selected(candidate),
  ).length;
  const excludeCount = candidates.filter(
    (candidate) =>
      !approvalVersionClosed(candidate) &&
      candidate.allowedDecisions.includes("REJECTED") &&
      candidate.decision !== "REJECTED",
  ).length;
  const includedCount = candidates.filter(selected).length;
  const pendingCount = candidates.filter((candidate) => candidate.decision === "PENDING").length;

  return (
    <div
      className="flex min-w-0 flex-col gap-3 border-y border-white/10 bg-white/[0.02] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="business-import-bulk-decisions"
    >
      <p className="min-w-0 text-xs text-zinc-500">
        {t("businessImport.review.bulkSummary", {
          visible: formatNumber(candidates.length),
          included: formatNumber(includedCount),
          pending: formatNumber(pendingCount),
        })}
      </p>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          className="max-sm:w-full max-sm:min-w-0 max-sm:whitespace-normal"
          disabled={locked || includeCount === 0}
          onClick={() => onDecision(candidates, "ACCEPTED")}
          data-testid="business-import-include-visible"
        >
          <Check className="h-4 w-4 text-emerald-400" />
          {t("businessImport.review.includeVisible", { count: formatNumber(includeCount) })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="max-sm:w-full max-sm:min-w-0 max-sm:whitespace-normal"
          disabled={locked || excludeCount === 0}
          onClick={() => onDecision(candidates, "REJECTED")}
          data-testid="business-import-exclude-visible"
        >
          <XCircle className="h-4 w-4 text-rose-400" />
          {t("businessImport.review.excludeVisible", { count: formatNumber(excludeCount) })}
        </Button>
      </div>
    </div>
  );
}

function CandidateDecisionControl({
  candidate,
  disabled,
  compact = false,
  onDecision,
}: {
  candidate: BusinessImportCandidateView;
  disabled: boolean;
  compact?: boolean;
  onDecision: (candidate: BusinessImportCandidateView, decision: "ACCEPTED" | "REJECTED") => void;
}) {
  const { t } = useI18n();
  const closed = approvalVersionClosed(candidate);
  const includeActive = selected(candidate);
  const excludeActive = candidate.decision === "REJECTED";
  const groupLabel = t("businessImport.review.decisionFor", { name: candidate.proposed.name });
  const includeLabel = t("businessImport.review.includeService", { name: candidate.proposed.name });
  const excludeLabel = t("businessImport.review.excludeService", { name: candidate.proposed.name });

  return (
    <div
      className="inline-flex min-w-0 items-center gap-1 rounded-md border border-white/10 bg-black/10 p-1"
      role="group"
      aria-label={groupLabel}
      data-testid={`business-import-decision-${candidate.id}`}
    >
      <Button
        type="button"
        size={compact ? "icon" : "sm"}
        variant="ghost"
        className={cn(
          compact ? "h-8 w-8 min-h-8 min-w-8" : "min-w-0",
          includeActive && "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20",
        )}
        disabled={
          disabled || closed || includeActive || !candidate.allowedDecisions.includes("ACCEPTED")
        }
        aria-label={includeLabel}
        title={includeLabel}
        aria-pressed={includeActive}
        onClick={() => onDecision(candidate, "ACCEPTED")}
      >
        <Check className="h-4 w-4" />
        {!compact ? t("businessImport.review.include") : null}
      </Button>
      <Button
        type="button"
        size={compact ? "icon" : "sm"}
        variant="ghost"
        className={cn(
          compact ? "h-8 w-8 min-h-8 min-w-8" : "min-w-0",
          excludeActive && "bg-rose-500/15 text-rose-300 hover:bg-rose-500/20",
        )}
        disabled={
          disabled || closed || excludeActive || !candidate.allowedDecisions.includes("REJECTED")
        }
        aria-label={excludeLabel}
        title={excludeLabel}
        aria-pressed={excludeActive}
        onClick={() => onDecision(candidate, "REJECTED")}
      >
        <XCircle className="h-4 w-4" />
        {!compact ? t("businessImport.review.exclude") : null}
      </Button>
    </div>
  );
}

function CandidateTableRow({
  candidate,
  pending,
  mutationLocked,
  canApprove,
  onDecide,
  onEdit,
  onEvidence,
  onApprove,
  onRejectApproval,
}: CandidateActionsProps) {
  const { t } = useI18n();
  return (
    <tr data-testid={`business-import-candidate-${candidate.id}`} aria-busy={pending}>
      <td className="px-3 py-4 align-top">
        <CandidateDecisionControl
          candidate={candidate}
          disabled={pending || mutationLocked}
          compact
          onDecision={onDecide}
        />
      </td>
      <td className="max-w-64 px-3 py-4 align-top">
        <p className="break-words font-medium text-zinc-200">{candidate.proposed.name}</p>
        <p className="mt-1 break-words text-xs text-zinc-600">
          {candidate.proposed.category || t("businessImport.review.noCategory")}
        </p>
      </td>
      <td className="max-w-56 px-3 py-4 align-top text-xs text-zinc-500">
        {candidate.current ? (
          <CandidateValueSummary candidate={candidate} side="current" />
        ) : (
          t("businessImport.review.notExisting")
        )}
      </td>
      <td className="max-w-56 px-3 py-4 align-top text-xs text-zinc-300">
        <CandidateValueSummary candidate={candidate} side="proposed" />
      </td>
      <td className="px-3 py-4 align-top">
        <CandidateStatus candidate={candidate} />
      </td>
      <td className="px-3 py-4 align-top">
        <CandidateButtons
          candidate={candidate}
          pending={pending}
          mutationLocked={mutationLocked}
          canApprove={canApprove}
          onEdit={onEdit}
          onEvidence={onEvidence}
          onApprove={onApprove}
          onRejectApproval={onRejectApproval}
        />
      </td>
    </tr>
  );
}

interface CandidateActionsProps {
  candidate: BusinessImportCandidateView;
  pending: boolean;
  mutationLocked: boolean;
  canApprove: boolean;
  onDecide: (candidate: BusinessImportCandidateView, decision: "ACCEPTED" | "REJECTED") => void;
  onEdit: (candidate: BusinessImportCandidateView) => void;
  onEvidence: (candidate: BusinessImportCandidateView) => void;
  onApprove: (candidate: BusinessImportCandidateView) => void;
  onRejectApproval: (candidate: BusinessImportCandidateView) => void;
}

function CandidateCard(props: CandidateActionsProps) {
  const { candidate, pending, mutationLocked, onDecide } = props;
  const { t } = useI18n();
  return (
    <article
      className="min-w-0 py-4"
      data-testid={`business-import-candidate-card-${candidate.id}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="break-words text-sm font-semibold text-zinc-100">
                {candidate.proposed.name}
              </h3>
              <p className="mt-0.5 text-xs text-zinc-600">
                {candidate.proposed.category || t("businessImport.review.noCategory")}
              </p>
            </div>
            <StatusBadge status={actionTone(candidate.action)}>
              {t(actionKeys[candidate.action])}
            </StatusBadge>
          </div>
          <div className="mt-3">
            <CandidateDecisionControl
              candidate={candidate}
              disabled={pending || mutationLocked}
              onDecision={onDecide}
            />
          </div>
          <details className="group mt-3 border-t border-white/10 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-zinc-400 marker:hidden">
              {t("businessImport.review.compare")}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 pb-2 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs text-zinc-600">{t("businessImport.review.current")}</p>
                <div className="mt-1 text-xs text-zinc-400">
                  {candidate.current ? (
                    <CandidateValueSummary candidate={candidate} side="current" />
                  ) : (
                    t("businessImport.review.notExisting")
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-zinc-600">{t("businessImport.review.proposed")}</p>
                <div className="mt-1 text-xs text-zinc-300">
                  <CandidateValueSummary candidate={candidate} side="proposed" />
                </div>
              </div>
            </div>
          </details>
          <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
            <CandidateStatus candidate={candidate} />
            <CandidateButtons {...props} />
          </div>
        </div>
      </div>
    </article>
  );
}

function CandidateButtons({
  candidate,
  pending,
  mutationLocked,
  canApprove,
  onEdit,
  onEvidence,
  onApprove,
  onRejectApproval,
}: Omit<CandidateActionsProps, "onDecide">) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {candidate.canEditProposed ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={pending || mutationLocked}
          aria-label={t("businessImport.review.edit", { name: candidate.proposed.name })}
          title={t("businessImport.review.edit", { name: candidate.proposed.name })}
          onClick={() => onEdit(candidate)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={candidate.evidence.length === 0 || mutationLocked}
        aria-label={t("businessImport.evidence.open", { name: candidate.proposed.name })}
        title={t("businessImport.evidence.open", { name: candidate.proposed.name })}
        onClick={() => onEvidence(candidate)}
      >
        <Eye className="h-4 w-4" />
      </Button>
      {canApprove && candidate.approval?.state === "PENDING" ? (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending || mutationLocked}
            aria-label={t("businessImport.approval.approve", { name: candidate.proposed.name })}
            title={t("businessImport.approval.approve", { name: candidate.proposed.name })}
            onClick={() => onApprove(candidate)}
          >
            <Check className="h-4 w-4 text-emerald-400" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending || mutationLocked}
            aria-label={t("businessImport.approval.reject", { name: candidate.proposed.name })}
            title={t("businessImport.approval.reject", { name: candidate.proposed.name })}
            onClick={() => onRejectApproval(candidate)}
          >
            <XCircle className="h-4 w-4 text-rose-400" />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function CandidateStatus({ candidate }: { candidate: BusinessImportCandidateView }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 max-w-72">
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={actionTone(candidate.action)}>
          {t(actionKeys[candidate.action])}
        </StatusBadge>
        {candidate.decision === "PENDING" ? (
          <StatusBadge status="warning">{t("businessImport.review.pendingDecision")}</StatusBadge>
        ) : null}
        {candidate.decision === "REJECTED" ? (
          <StatusBadge status="info">{t("businessImport.review.excluded")}</StatusBadge>
        ) : null}
        {["ACCEPTED", "EDITED", "SUBMITTED_FOR_APPROVAL"].includes(candidate.decision) ? (
          <StatusBadge status="success">{t("businessImport.review.included")}</StatusBadge>
        ) : null}
        {approvalRequired(candidate) ? (
          <StatusBadge status="warning">
            {candidate.approval?.state === "PENDING"
              ? t("businessImport.approval.pending")
              : t("businessImport.approval.required")}
          </StatusBadge>
        ) : null}
        {candidate.decision === "APPLIED" ? (
          <StatusBadge status="success">{t("businessImport.review.applied")}</StatusBadge>
        ) : null}
      </div>
      {candidate.diagnostics.length > 0 ? (
        <ul className="mt-2 space-y-1.5" data-testid="business-import-candidate-diagnostics">
          {candidate.diagnostics.map((diagnostic, index) => {
            const location = [
              diagnostic.field
                ? t("businessImport.diagnostic.field", { field: diagnostic.field })
                : null,
              diagnostic.row ? t("businessImport.diagnostic.row", { row: diagnostic.row }) : null,
              diagnostic.column
                ? t("businessImport.diagnostic.column", { column: diagnostic.column })
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={`${diagnostic.code}:${index}`}
                className={cn(
                  "break-words text-xs",
                  diagnostic.severity === "ERROR" ? "text-rose-300" : "text-amber-300",
                )}
              >
                <span>{diagnosticText(diagnostic, t)}</span>
                {location ? <span className="mt-0.5 block opacity-75">{location}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {approvalVersionClosed(candidate) ? (
        <p className="mt-2 break-words text-xs text-amber-300">
          {t("businessImport.approval.editBeforeRetry")}
        </p>
      ) : null}
    </div>
  );
}

function ImportDiagnostics({ diagnostics }: { diagnostics: BusinessImportView["diagnostics"] }) {
  const { t } = useI18n();
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === "ERROR");
  return (
    <section
      className={cn(
        "border-y px-4 py-3",
        hasError
          ? "border-rose-500/20 bg-rose-500/[0.06]"
          : "border-amber-500/20 bg-amber-500/[0.06]",
      )}
      role={hasError ? "alert" : "status"}
      data-testid="business-import-diagnostics"
    >
      <h2 className="text-sm font-semibold text-zinc-200">
        {t("businessImport.diagnostic.importTitle")}
      </h2>
      <ul className="mt-2 space-y-2">
        {diagnostics.map((diagnostic, index) => {
          const location = [
            diagnostic.field
              ? t("businessImport.diagnostic.field", { field: diagnostic.field })
              : null,
            diagnostic.row ? t("businessImport.diagnostic.row", { row: diagnostic.row }) : null,
            diagnostic.column
              ? t("businessImport.diagnostic.column", { column: diagnostic.column })
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={`${diagnostic.code}:${index}`} className="break-words text-sm text-zinc-300">
              {diagnosticText(diagnostic, t)}
              {location ? (
                <span className="mt-0.5 block text-xs text-zinc-500">{location}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CandidateValueSummary({
  candidate,
  side,
}: {
  candidate: BusinessImportCandidateView;
  side: "current" | "proposed";
}) {
  const { t } = useI18n();
  const value = side === "current" ? candidate.current : candidate.proposed;
  if (!value) return null;
  const rows = offeringDisplayFields(value, t);
  const currentRows = candidate.current ? offeringDisplayFields(candidate.current, t) : [];
  const proposedRows = offeringDisplayFields(candidate.proposed, t);
  const currentByKey = new Map(currentRows.map((row) => [row.key, row.value]));
  const changedKeys = new Set(
    candidate.current
      ? proposedRows.filter((row) => currentByKey.get(row.key) !== row.value).map((row) => row.key)
      : proposedRows.filter((row) => row.value !== "-").map((row) => row.key),
  );
  const visibleRows = rows.filter((row) => changedKeys.has(row.key));
  const fallbackRows =
    visibleRows.length > 0 ? visibleRows : rows.filter((row) => row.value !== "-");
  return (
    <dl className="min-w-0 space-y-1.5">
      {fallbackRows.map((row) => (
        <div key={row.key} className="min-w-0">
          <dt className="break-words text-[11px] text-zinc-600">{row.label}</dt>
          <dd className="break-words text-xs text-zinc-300">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidencePanel({ candidate }: { candidate: BusinessImportCandidateView | null }) {
  const { t } = useI18n();
  return (
    <aside
      className="hidden min-w-0 rounded-lg border border-white/10 bg-zinc-950/25 p-4 2xl:block"
      data-testid="business-import-evidence-panel"
    >
      <h3 className="text-sm font-semibold text-zinc-200">{t("businessImport.evidence.title")}</h3>
      {!candidate ? (
        <p className="mt-3 text-sm text-zinc-600">{t("businessImport.evidence.select")}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="break-words text-sm font-medium text-zinc-300">{candidate.proposed.name}</p>
          <EvidenceList candidate={candidate} />
        </div>
      )}
    </aside>
  );
}

function EvidenceList({ candidate }: { candidate: BusinessImportCandidateView }) {
  const { formatDate, t } = useI18n();
  return candidate.evidence.length === 0 ? (
    <p className="text-sm text-zinc-600">{t("businessImport.evidence.empty")}</p>
  ) : (
    <div className="divide-y divide-white/10 border-y border-white/10">
      {candidate.evidence.map((evidence, index) => {
        return (
          <div
            key={`${evidence.artifactId}:${index}`}
            className="min-w-0 py-3"
            data-evidence-availability={evidence.availability}
          >
            <p className="text-xs font-medium text-zinc-400">
              {evidence.format === "CSV"
                ? t("businessImport.evidence.csv", {
                    row: evidence.locator.row ?? "-",
                    column: evidence.locator.header || evidence.locator.column || "-",
                  })
                : evidence.format === "XLSX"
                  ? t("businessImport.evidence.xlsx", {
                      sheet: evidence.locator.sheet || "-",
                      range: evidence.locator.range || "-",
                    })
                  : t("businessImport.evidence.pdf", { page: evidence.locator.page ?? "-" })}
            </p>
            {evidence.availability === "AVAILABLE" ? (
              evidence.sourceValue.length > 0 ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-300">
                  {evidence.sourceValue}
                </p>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">{t("businessImport.evidence.blank")}</p>
              )
            ) : (
              <p
                className={cn(
                  "mt-1 text-sm",
                  evidence.availability === "EXPIRED" ? "text-amber-400" : "text-rose-300",
                )}
              >
                {t(
                  evidence.availability === "EXPIRED"
                    ? evidence.expiresAt
                      ? "businessImport.evidence.expiredAt"
                      : "businessImport.evidence.expired"
                    : evidence.availability === "CORRUPT"
                      ? "businessImport.evidence.corrupt"
                      : "businessImport.evidence.unavailable",
                  evidence.availability === "EXPIRED" && evidence.expiresAt
                    ? { date: formatDate(evidence.expiresAt, { dateStyle: "medium" }) }
                    : undefined,
                )}
              </p>
            )}
            {evidence.availability !== "EXPIRED" && evidence.expiresAt ? (
              <p className="mt-1 text-xs text-zinc-700">
                {t(
                  evidence.availability === "AVAILABLE"
                    ? "businessImport.evidence.availableUntil"
                    : "businessImport.evidence.retainedUntil",
                  {
                    date: formatDate(evidence.expiresAt, { dateStyle: "medium" }),
                  },
                )}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function EvidenceDialog({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: BusinessImportCandidateView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("businessImport.evidence.title")}
      description={candidate?.proposed.name || t("businessImport.evidence.select")}
      closeLabel={t("businessImport.common.close")}
      className="h-[calc(100vh-2rem)] max-w-3xl rounded-lg p-4 sm:h-auto sm:p-6"
    >
      <div className="min-w-0 overflow-y-auto" data-testid="business-import-evidence-dialog">
        {candidate ? <EvidenceList candidate={candidate} /> : null}
      </div>
    </Modal>
  );
}

function EditCandidateDialog({
  candidate,
  value,
  error,
  busy,
  onValue,
  onOpenChange,
  onSave,
}: {
  candidate: BusinessImportCandidateView | null;
  value: BusinessImportOfferingValue | null;
  error: ApiClientError | null;
  busy: boolean;
  onValue: (value: BusinessImportOfferingValue) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const inputClass =
    "h-11 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15";
  const updatePrice = (patch: Partial<NonNullable<BusinessImportOfferingValue["price"]>>) => {
    if (!value) return;
    onValue({
      ...value,
      price: { type: value.price?.type ?? "FIXED", ...value.price, ...patch },
    });
  };
  const setPriceType = (type: "" | BusinessOfferingPriceType) => {
    if (!value) return;
    if (!type) {
      onValue({ ...value, price: null });
      return;
    }
    const previous = value.price;
    const shared = {
      currency: previous?.currency ?? null,
      unit: previous?.unit ?? null,
      taxNote: previous?.taxNote ?? null,
    };
    const seed = previous?.amount ?? previous?.from ?? null;
    const price =
      type === "FIXED"
        ? { ...shared, type, amount: seed, from: null, to: null }
        : type === "FROM"
          ? { ...shared, type, amount: null, from: seed, to: null }
          : type === "RANGE"
            ? {
                ...shared,
                type,
                amount: null,
                from: previous?.from ?? seed,
                to: previous?.to ?? null,
              }
            : { ...shared, type, amount: null, from: null, to: null };
    onValue({ ...value, price });
  };
  return (
    <Modal
      open={Boolean(candidate && value)}
      onOpenChange={onOpenChange}
      title={t("businessImport.edit.title")}
      description={t("businessImport.edit.description")}
      closeLabel={t("businessImport.common.close")}
      className="max-w-3xl rounded-lg"
      footer={
        <>
          <Button
            variant="outline"
            className="max-sm:h-auto max-sm:w-full max-sm:min-w-0 max-sm:whitespace-normal max-sm:py-2"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("businessImport.common.cancel")}
          </Button>
          <Button
            disabled={busy || !value?.name.trim()}
            onClick={onSave}
            data-testid="business-import-edit-save"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("businessImport.edit.save")}
          </Button>
        </>
      }
    >
      {value ? (
        <div
          className="max-h-[calc(100vh-13rem)] min-w-0 space-y-6 overflow-y-auto pr-1"
          data-testid="business-import-edit-dialog"
        >
          <fieldset className="grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-zinc-200">
              {t("businessImport.edit.serviceSection")}
            </legend>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.externalId")}
              </span>
              <input
                value={value.externalId || ""}
                maxLength={200}
                className={inputClass}
                onChange={(event) => onValue({ ...value, externalId: event.target.value })}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.category")}
              </span>
              <input
                value={value.category || ""}
                maxLength={160}
                className={inputClass}
                onChange={(event) => onValue({ ...value, category: event.target.value })}
              />
            </label>
            <label className="min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.edit.name")}
              </span>
              <input
                value={value.name}
                maxLength={160}
                className={inputClass}
                onChange={(event) => onValue({ ...value, name: event.target.value })}
              />
            </label>
            <label className="min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.edit.descriptionLabel")}
              </span>
              <textarea
                value={value.description || ""}
                maxLength={2000}
                className={cn(inputClass, "h-auto min-h-24 resize-y py-3")}
                onChange={(event) => onValue({ ...value, description: event.target.value })}
              />
            </label>
          </fieldset>

          <fieldset className="grid min-w-0 gap-4 border-0 border-t border-white/10 p-0 pt-5 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-zinc-200">
              {t("businessImport.edit.priceSection")}
            </legend>
            <label className="min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.priceType")}
              </span>
              <select
                value={value.price?.type ?? ""}
                className={inputClass}
                onChange={(event) =>
                  setPriceType(event.target.value as "" | BusinessOfferingPriceType)
                }
              >
                <option value="">{t("businessImport.priceType.none")}</option>
                {(Object.keys(priceTypeKeys) as BusinessOfferingPriceType[]).map((type) => (
                  <option key={type} value={type}>
                    {t(priceTypeKeys[type])}
                  </option>
                ))}
              </select>
            </label>
            {value.price?.type === "FIXED" ? (
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                  {t("businessImport.field.amount")}
                </span>
                <input
                  inputMode="decimal"
                  value={value.price.amount || ""}
                  className={inputClass}
                  onChange={(event) => updatePrice({ amount: event.target.value })}
                />
              </label>
            ) : null}
            {value.price?.type === "FROM" || value.price?.type === "RANGE" ? (
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                  {t("businessImport.field.from")}
                </span>
                <input
                  inputMode="decimal"
                  value={value.price.from || ""}
                  className={inputClass}
                  onChange={(event) => updatePrice({ from: event.target.value })}
                />
              </label>
            ) : null}
            {value.price?.type === "RANGE" ? (
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                  {t("businessImport.field.to")}
                </span>
                <input
                  inputMode="decimal"
                  value={value.price.to || ""}
                  className={inputClass}
                  onChange={(event) => updatePrice({ to: event.target.value })}
                />
              </label>
            ) : null}
            {value.price ? (
              <>
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {t("businessImport.edit.currency")}
                  </span>
                  <input
                    value={value.price.currency || ""}
                    maxLength={3}
                    className={inputClass}
                    onChange={(event) =>
                      updatePrice({ currency: event.target.value.toUpperCase() })
                    }
                  />
                </label>
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {t("businessImport.field.unit")}
                  </span>
                  <input
                    value={value.price.unit || ""}
                    maxLength={80}
                    className={inputClass}
                    onChange={(event) => updatePrice({ unit: event.target.value })}
                  />
                </label>
                <label className="min-w-0 sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                    {t("businessImport.field.taxNote")}
                  </span>
                  <textarea
                    value={value.price.taxNote || ""}
                    maxLength={500}
                    className={cn(inputClass, "h-auto min-h-20 resize-y py-3")}
                    onChange={(event) => updatePrice({ taxNote: event.target.value })}
                  />
                </label>
              </>
            ) : null}
          </fieldset>

          <fieldset className="grid min-w-0 gap-4 border-0 border-t border-white/10 p-0 pt-5 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-zinc-200">
              {t("businessImport.edit.availabilitySection")}
            </legend>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.minimumMinutes")}
              </span>
              <input
                type="number"
                min={1}
                max={10080}
                value={value.duration?.minimumMinutes ?? ""}
                className={inputClass}
                onChange={(event) =>
                  onValue({
                    ...value,
                    duration: event.target.value
                      ? {
                          minimumMinutes: Number(event.target.value),
                          maximumMinutes: value.duration?.maximumMinutes ?? null,
                        }
                      : null,
                  })
                }
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.maximumMinutes")}
              </span>
              <input
                type="number"
                min={value.duration?.minimumMinutes ?? 1}
                max={10080}
                disabled={!value.duration}
                value={value.duration?.maximumMinutes ?? ""}
                className={inputClass}
                onChange={(event) =>
                  value.duration &&
                  onValue({
                    ...value,
                    duration: {
                      ...value.duration,
                      maximumMinutes: event.target.value ? Number(event.target.value) : null,
                    },
                  })
                }
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.locationExternalId")}
              </span>
              <input
                value={value.locationExternalId || ""}
                maxLength={200}
                className={inputClass}
                onChange={(event) => onValue({ ...value, locationExternalId: event.target.value })}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.language")}
              </span>
              <input
                value={value.language || ""}
                maxLength={35}
                className={inputClass}
                onChange={(event) => onValue({ ...value, language: event.target.value })}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.validFrom")}
              </span>
              <input
                type="date"
                value={value.validFrom || ""}
                className={inputClass}
                onChange={(event) => onValue({ ...value, validFrom: event.target.value })}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.validUntil")}
              </span>
              <input
                type="date"
                value={value.validUntil || ""}
                className={inputClass}
                onChange={(event) => onValue({ ...value, validUntil: event.target.value })}
              />
            </label>
            <label className="min-w-0 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                {t("businessImport.field.bookingNotes")}
              </span>
              <textarea
                value={value.bookingNotes || ""}
                maxLength={1000}
                className={cn(inputClass, "h-auto min-h-20 resize-y py-3")}
                onChange={(event) => onValue({ ...value, bookingNotes: event.target.value })}
              />
            </label>
            <label className="flex min-h-11 min-w-0 items-center gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={value.active}
                className="h-5 w-5 accent-emerald-400"
                onChange={(event) => onValue({ ...value, active: event.target.checked })}
              />
              <span className="text-sm text-zinc-300">{t("businessImport.field.active")}</span>
            </label>
          </fieldset>
          {error ? (
            <p className="text-sm text-rose-300" role="alert">
              {error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function ApplyPreviewDialog({
  preview,
  candidates,
  error,
  open,
  busy,
  onOpenChange,
  onApply,
}: {
  preview: BusinessImportApplyPreviewView | null;
  candidates: BusinessImportCandidateView[];
  error: ApiClientError | null;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}) {
  const { formatNumber, t } = useI18n();
  const blocked = Boolean(
    preview?.diagnostics.some((diagnostic) => diagnostic.severity === "ERROR"),
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("businessImport.apply.title")}
      description={t("businessImport.apply.description")}
      closeLabel={t("businessImport.common.close")}
      className="max-w-xl rounded-lg"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("businessImport.common.cancel")}
          </Button>
          <Button
            className="max-sm:h-auto max-sm:w-full max-sm:min-w-0 max-sm:whitespace-normal max-sm:py-2"
            disabled={!preview || busy || blocked}
            onClick={onApply}
            data-testid="business-import-apply-confirm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {preview
              ? t("businessImport.apply.confirm", {
                  add: formatNumber(preview.counts.additions),
                  update: formatNumber(preview.counts.updates),
                  link: formatNumber(preview.counts.linked),
                })
              : t("businessImport.apply.confirmEmpty")}
          </Button>
        </>
      }
    >
      {preview ? (
        <div className="space-y-4" data-testid="business-import-apply-preview">
          <dl className="grid grid-cols-3 border-y border-white/10">
            <div className="px-3 py-3">
              <dt className="text-xs text-zinc-500">{t("businessImport.metrics.additions")}</dt>
              <dd className="mt-1 text-lg font-semibold text-zinc-100">
                {formatNumber(preview.counts.additions)}
              </dd>
            </div>
            <div className="px-3 py-3">
              <dt className="text-xs text-zinc-500">{t("businessImport.metrics.updates")}</dt>
              <dd className="mt-1 text-lg font-semibold text-zinc-100">
                {formatNumber(preview.counts.updates)}
              </dd>
            </div>
            <div className="px-3 py-3">
              <dt className="text-xs text-zinc-500">{t("businessImport.metrics.linked")}</dt>
              <dd className="mt-1 text-lg font-semibold text-zinc-100">
                {formatNumber(preview.counts.linked)}
              </dd>
            </div>
          </dl>
          {error ? (
            <div
              className="flex items-start gap-2 border-y border-rose-500/20 bg-rose-500/[0.06] px-3 py-3 text-sm text-rose-200"
              role="alert"
              data-testid="business-import-apply-error"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{error.message}</span>
            </div>
          ) : null}
          <section aria-labelledby="business-import-selected-changes">
            <h3
              id="business-import-selected-changes"
              className="mb-2 text-xs font-medium text-zinc-400"
            >
              {t("businessImport.apply.selectedChanges")}
            </h3>
            <ul
              className="max-h-64 divide-y divide-white/10 overflow-y-auto border-y border-white/10"
              data-testid="business-import-apply-items"
            >
              {candidates.map((candidate) => (
                <li key={candidate.id} className="min-w-0 py-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium text-zinc-100">
                      {candidate.proposed.name}
                    </span>
                    <StatusBadge status={actionTone(candidate.action)}>
                      {t(actionKeys[candidate.action])}
                    </StatusBadge>
                  </div>
                  {candidate.current ? (
                    <dl className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-zinc-500">{t("businessImport.review.current")}</dt>
                        <dd className="mt-1 text-zinc-400">
                          <CandidateValueSummary candidate={candidate} side="current" />
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-zinc-500">{t("businessImport.review.proposed")}</dt>
                        <dd className="mt-1 text-zinc-300">
                          <CandidateValueSummary candidate={candidate} side="proposed" />
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <div className="mt-2 text-xs text-zinc-400">
                      <CandidateValueSummary candidate={candidate} side="proposed" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {preview.diagnostics.length > 0 ? (
            <ul className="space-y-2 text-sm text-amber-200">
              {preview.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}:${index}`}>{diagnosticText(diagnostic, t)}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/[0.06] px-3 py-3 text-xs text-sky-200/75">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            {t("businessImport.apply.draftBoundary")}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ApplyActions({
  addCount,
  updateCount,
  linkCount,
  approvalCount,
  approvalMode,
  eligibility,
  canApply,
  busy,
  onApply,
  onApproval,
  onBulkApproval,
}: {
  addCount: number;
  updateCount: number;
  linkCount: number;
  approvalCount: number;
  approvalMode: "APPROVE" | "REQUEST";
  eligibility: BusinessImportApplyEligibilityView;
  canApply: boolean;
  busy: boolean;
  onApply: () => void;
  onApproval: () => void;
  onBulkApproval: () => void;
}) {
  const { formatNumber, t } = useI18n();
  const label = t("businessImport.apply.primary", {
    add: formatNumber(addCount),
    update: formatNumber(updateCount),
    link: formatNumber(linkCount),
  });
  const content = (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {eligibility.eligible
            ? t("businessImport.apply.selectionSaved")
            : t("businessImport.apply.blocked", {
                selected: formatNumber(eligibility.selectedCandidates),
                conflicts: formatNumber(eligibility.blockingConflicts),
                invalid: formatNumber(eligibility.blockingInvalid),
                approvals: formatNumber(eligibility.pendingApprovals),
                stale: formatNumber(eligibility.staleCandidates),
              })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        {approvalCount > 0 ? (
          <Button
            variant="outline"
            className="max-sm:h-auto max-sm:w-full max-sm:min-w-0 max-sm:whitespace-normal max-sm:py-2"
            disabled={busy}
            onClick={approvalMode === "APPROVE" ? onBulkApproval : onApproval}
            data-testid={
              approvalMode === "APPROVE"
                ? "business-import-approve-selected"
                : "business-import-request-approval"
            }
          >
            {approvalMode === "APPROVE" ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t(
              approvalMode === "APPROVE"
                ? "businessImport.approval.approveSelected"
                : "businessImport.approval.request",
              { count: formatNumber(approvalCount) },
            )}
          </Button>
        ) : null}
        <Button
          className="max-sm:h-auto max-sm:w-full max-sm:min-w-0 max-sm:whitespace-normal max-sm:py-2"
          disabled={busy || !canApply}
          onClick={onApply}
          data-testid="business-import-apply-selected"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {label}
        </Button>
      </div>
    </div>
  );
  return (
    <div className="sticky bottom-16 z-30 border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-2xl shadow-black/40 lg:bottom-0 lg:z-20">
      {content}
    </div>
  );
}
