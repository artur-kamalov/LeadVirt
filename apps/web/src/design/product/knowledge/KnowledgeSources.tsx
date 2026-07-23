"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  Ban,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  FileSpreadsheet,
  FileUp,
  Globe2,
  Library,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type {
  BusinessImportSourcePage,
  BusinessImportSourceView,
  KnowledgeV2AcceptedMutation,
  KnowledgeV2Audience,
  KnowledgeV2DocumentPage,
  KnowledgeV2DocumentStatus,
  KnowledgeV2DocumentView,
  KnowledgeV2JobStage,
  KnowledgeV2JobStatus,
  KnowledgeV2JobView,
  KnowledgeV2FileUploadIntentView,
  KnowledgeV2RevisionPage,
  KnowledgeV2RevisionPreviewView,
  KnowledgeV2RevisionStatus,
  KnowledgeV2RevisionView,
  KnowledgeV2ScopeInput,
  KnowledgeV2SecurityClassification,
  KnowledgeV2SourceKind,
  KnowledgeV2SourcePage,
  KnowledgeV2SourceStatus,
  KnowledgeV2SourceView,
  KnowledgeV2UpdateSourceRequest,
} from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import { listBusinessImportSources } from "@/lib/api/business-imports";
import {
  createKnowledgeV2IdempotencyKey,
  createKnowledgeV2Source,
  completeKnowledgeV2FileUpload,
  createKnowledgeV2FileUploadIntent,
  deleteKnowledgeV2Source,
  excludeKnowledgeV2Revision,
  getKnowledgeV2Job,
  getKnowledgeV2Source,
  listKnowledgeV2DocumentRevisions,
  listKnowledgeV2Documents,
  listKnowledgeV2Sources,
  pauseKnowledgeV2Source,
  previewKnowledgeV2Revision,
  resumeKnowledgeV2Source,
  syncKnowledgeV2Source,
  updateKnowledgeV2Source,
  uploadKnowledgeV2File,
} from "@/lib/api/knowledge";
import {
  businessImportStateKeys,
  businessImportStateTone,
} from "./imports/businessImportPresentation";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { EmptyState, LoadingOverlay, Modal, Select, Spinner, StatusBadge } from "../ui";

const SOURCE_PAGE_SIZE = 25;
const CATALOG_PAGE_SIZE = 25;
const DOCUMENT_PAGE_SIZE = 25;
const REVISION_PAGE_SIZE = 25;
const JOB_POLL_INTERVAL_MS = 1_500;
const JOB_POLL_LIMIT = 40;
const SOURCE_REFRESH_INTERVAL_MS = 5_000;
const SOURCE_REFRESH_LIMIT = 24;
const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 aria-invalid:border-rose-500/60 aria-invalid:ring-rose-500/10 max-sm:min-h-11";
const textareaClass = cn(inputClass, "h-auto min-h-24 resize-y py-2.5");

const sourceStatusKeys: Record<KnowledgeV2SourceStatus, TranslationKey> = {
  CONNECTING: "knowledge.sources.status.connecting",
  DISCOVERING: "knowledge.sources.status.discovering",
  SYNCING: "knowledge.sources.status.syncing",
  READY: "knowledge.sources.status.ready",
  NEEDS_REVIEW: "knowledge.sources.status.needsReview",
  PAUSED: "knowledge.sources.status.paused",
  FAILED: "knowledge.sources.status.failed",
  DISCONNECTED: "knowledge.sources.status.disconnected",
  DELETING: "knowledge.sources.status.deleting",
  DELETED: "knowledge.sources.status.deleted",
};

const documentStatusKeys: Record<KnowledgeV2DocumentStatus, TranslationKey> = {
  DISCOVERED: "knowledge.sources.documentStatus.discovered",
  ACTIVE: "knowledge.sources.documentStatus.active",
  NEEDS_REVIEW: "knowledge.sources.documentStatus.needsReview",
  TOMBSTONED: "knowledge.sources.documentStatus.tombstoned",
  DELETED: "knowledge.sources.documentStatus.deleted",
};

const revisionStatusKeys: Record<KnowledgeV2RevisionStatus, TranslationKey> = {
  ACQUIRED: "knowledge.sources.revisionStatus.acquired",
  SCANNING: "knowledge.sources.revisionStatus.scanning",
  PARSING: "knowledge.sources.revisionStatus.parsing",
  NORMALIZING: "knowledge.sources.revisionStatus.normalizing",
  EXTRACTING: "knowledge.sources.revisionStatus.extracting",
  CHUNKING: "knowledge.sources.revisionStatus.chunking",
  EMBEDDING: "knowledge.sources.revisionStatus.embedding",
  INDEXING: "knowledge.sources.revisionStatus.indexing",
  EVALUATING: "knowledge.sources.revisionStatus.evaluating",
  READY: "knowledge.sources.revisionStatus.ready",
  NEEDS_REVIEW: "knowledge.sources.revisionStatus.needsReview",
  QUARANTINED: "knowledge.sources.revisionStatus.quarantined",
  REJECTED: "knowledge.sources.revisionStatus.rejected",
  PUBLISHED: "knowledge.sources.revisionStatus.published",
  SUPERSEDED: "knowledge.sources.revisionStatus.superseded",
  FAILED: "knowledge.sources.revisionStatus.failed",
  CANCELLED: "knowledge.sources.revisionStatus.cancelled",
  DELETED: "knowledge.sources.revisionStatus.deleted",
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

const jobStageKeys: Record<KnowledgeV2JobStage | "CHUNKING", TranslationKey> = {
  QUEUED: "knowledge.sources.job.stage.queued",
  ACQUIRING: "knowledge.sources.job.stage.acquiring",
  SCANNING: "knowledge.sources.job.stage.scanning",
  PARSING: "knowledge.sources.job.stage.parsing",
  NORMALIZING: "knowledge.sources.job.stage.normalizing",
  EXTRACTING: "knowledge.sources.job.stage.extracting",
  CHUNKING: "knowledge.sources.job.stage.chunking",
  INDEXING: "knowledge.sources.job.stage.indexing",
  EVALUATING: "knowledge.sources.job.stage.evaluating",
  VALIDATING: "knowledge.sources.job.stage.validating",
  PUBLISHING: "knowledge.sources.job.stage.publishing",
  ROLLING_BACK: "knowledge.sources.job.stage.rollingBack",
  RECONCILING: "knowledge.sources.job.stage.reconciling",
  CLEANING_UP: "knowledge.sources.job.stage.cleaningUp",
  MIGRATING_LEGACY: "knowledge.sources.job.stage.migratingLegacy",
};

const sourceKindKeys: Record<KnowledgeV2SourceKind, TranslationKey> = {
  MANUAL: "knowledge.sources.kind.manual",
  WEBSITE: "knowledge.sources.kind.website",
  FILE: "knowledge.sources.kind.file",
  SPREADSHEET: "knowledge.sources.kind.spreadsheet",
  HELP_CENTER: "knowledge.sources.kind.helpCenter",
  DRIVE: "knowledge.sources.kind.drive",
  NOTION: "knowledge.sources.kind.notion",
  API: "knowledge.sources.kind.api",
  LEGACY_ONBOARDING: "knowledge.sources.kind.legacyOnboarding",
};

const classificationKeys: Record<KnowledgeV2SecurityClassification, TranslationKey> = {
  PUBLIC: "knowledge.sources.classification.public",
  INTERNAL: "knowledge.sources.classification.internal",
  CUSTOMER_PERSONAL: "knowledge.sources.classification.customerPersonal",
  SENSITIVE: "knowledge.sources.classification.sensitive",
  SECRET: "knowledge.sources.classification.secret",
};

const audienceKeys: Record<KnowledgeV2Audience, TranslationKey> = {
  PUBLIC: "knowledge.sources.audience.public",
  AUTHENTICATED_CUSTOMER: "knowledge.sources.audience.authenticatedCustomer",
  INTERNAL: "knowledge.sources.audience.internal",
};

const audienceValues: KnowledgeV2Audience[] = ["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"];

const filePhaseKeys: Record<Exclude<FileUploadPhase, "IDLE">, TranslationKey> = {
  PREPARING: "knowledge.sources.file.phase.preparing",
  UPLOADING: "knowledge.sources.file.phase.uploading",
  SCANNING: "knowledge.sources.file.phase.scanning",
  PROCESSING: "knowledge.sources.file.phase.processing",
};

const localeOptions: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: "en", labelKey: "knowledge.settings.locale.en" },
  { value: "ru", labelKey: "knowledge.settings.locale.ru" },
  { value: "es", labelKey: "knowledge.settings.locale.es" },
  { value: "fr", labelKey: "knowledge.settings.locale.fr" },
  { value: "de", labelKey: "knowledge.settings.locale.de" },
  { value: "pt", labelKey: "knowledge.settings.locale.pt" },
];

const terminalJobStatuses = new Set<KnowledgeV2JobStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);
const transientSourceStatuses = new Set<KnowledgeV2SourceStatus>([
  "CONNECTING",
  "DISCOVERING",
  "SYNCING",
  "DELETING",
]);

type SourceAction = "SYNC" | "PAUSE" | "RESUME" | "DELETE";
type JobOperation = "IMPORT" | "SYNC" | "RESUME" | "DELETE" | "EXCLUDE" | "RECONCILE";
type FileUploadPhase = "IDLE" | "PREPARING" | "UPLOADING" | "SCANNING" | "PROCESSING";

interface AttemptKey {
  signature: string;
  key: string;
}

interface ActiveJob {
  jobId: string;
  operation: JobOperation;
  acceptedStatus: KnowledgeV2JobStatus;
  job: KnowledgeV2JobView | null;
  pollError: ApiClientError | null;
  pollingStopped: boolean;
}

interface SettingsDirtyFields {
  displayName: boolean;
  defaultLocale: boolean;
  defaultClassification: boolean;
  audiences: boolean;
  syncMode: boolean;
}

interface SourceSettingsDraft {
  displayName: string;
  defaultLocale: string;
  defaultClassification: "PUBLIC" | "INTERNAL";
  audiences: KnowledgeV2Audience[];
  syncMode: "MANUAL";
  dirty: SettingsDirtyFields;
}

const cleanSettingsFields: SettingsDirtyFields = {
  displayName: false,
  defaultLocale: false,
  defaultClassification: false,
  audiences: false,
  syncMode: false,
};

function apiError(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error : new ApiClientError(fallback, 500);
}

function fieldErrors(error: ApiClientError) {
  const result: Record<string, string> = {};
  for (const item of error.fieldErrors ?? []) result[item.field] = item.message;
  if (error.field) result[error.field] = error.message;
  return result;
}

function isConflict(error: ApiClientError) {
  return error.status === 412 || error.code === "REVISION_CONFLICT";
}

function idempotencyKeyFor(ref: React.MutableRefObject<AttemptKey | null>, signature: string) {
  if (ref.current?.signature === signature) return ref.current.key;
  const key = createKnowledgeV2IdempotencyKey();
  ref.current = { signature, key };
  return key;
}

function fileMimeType(file: File) {
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (extension === "txt") return "text/plain" as const;
  if (extension === "csv") return "text/csv" as const;
  return null;
}

function fileDisplayName(file: File) {
  return file.name
    .replace(/\.(?:txt|csv)$/iu, "")
    .trim()
    .slice(0, 160);
}

function statusTone(
  status: KnowledgeV2SourceStatus | KnowledgeV2DocumentStatus | KnowledgeV2RevisionStatus,
) {
  if (["READY", "ACTIVE", "PUBLISHED"].includes(status)) return "success" as const;
  if (["FAILED", "QUARANTINED", "REJECTED", "DELETED"].includes(status)) return "error" as const;
  if (["NEEDS_REVIEW", "PAUSED", "DISCONNECTED", "TOMBSTONED"].includes(status)) {
    return "warning" as const;
  }
  return "info" as const;
}

function jobTone(status: KnowledgeV2JobStatus) {
  if (status === "SUCCEEDED") return "success" as const;
  if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(status)) return "error" as const;
  if (status === "RETRY_SCHEDULED") return "warning" as const;
  return "info" as const;
}

function jobStatusRank(status: KnowledgeV2JobStatus) {
  if (status === "SUCCEEDED") return 4;
  if (terminalJobStatuses.has(status)) return 3;
  if (status === "RUNNING") return 2;
  if (status === "RETRY_SCHEDULED") return 1;
  return 0;
}

function replaceSource(items: KnowledgeV2SourceView[], source: KnowledgeV2SourceView) {
  return items.some((item) => item.id === source.id)
    ? items.map((item) => (item.id === source.id ? source : item))
    : [source, ...items];
}

function recoveredSourceOperation(
  job: KnowledgeV2JobView,
  source: KnowledgeV2SourceView | undefined,
): JobOperation {
  if (job.stage === "CLEANING_UP") return "DELETE";
  if (job.resources.some((resource) => resource.type === "REVISION")) return "EXCLUDE";
  if (job.stage === "RECONCILING") return "RECONCILE";
  return source?.lastSuccessAt ? "SYNC" : "IMPORT";
}

function settingsDraftFromSource(source: KnowledgeV2SourceView): SourceSettingsDraft {
  return {
    displayName: source.displayName,
    defaultLocale: source.defaultLocale,
    defaultClassification: source.defaultClassification === "PUBLIC" ? "PUBLIC" : "INTERNAL",
    audiences: [...(source.defaultScope?.audiences ?? [])],
    syncMode: "MANUAL",
    dirty: { ...cleanSettingsFields },
  };
}

function mergeSettingsDraft(
  draft: SourceSettingsDraft,
  source: KnowledgeV2SourceView,
): SourceSettingsDraft {
  const current = settingsDraftFromSource(source);
  return {
    displayName: draft.dirty.displayName ? draft.displayName : current.displayName,
    defaultLocale: draft.dirty.defaultLocale ? draft.defaultLocale : current.defaultLocale,
    defaultClassification: draft.dirty.defaultClassification
      ? draft.defaultClassification
      : current.defaultClassification,
    audiences: draft.dirty.audiences ? draft.audiences : current.audiences,
    syncMode: draft.dirty.syncMode ? draft.syncMode : current.syncMode,
    dirty: draft.dirty,
  };
}

function scopeWithAudiences(
  source: KnowledgeV2SourceView,
  audiences: KnowledgeV2Audience[],
): KnowledgeV2ScopeInput {
  const current = source.defaultScope;
  return {
    brandIds: [...(current?.brandIds ?? [])],
    locationIds: [...(current?.locationIds ?? [])],
    channelTypes: [...(current?.channelTypes ?? [])],
    assistantIds: [...(current?.assistantIds ?? [])],
    audiences,
    segments: [...(current?.segments ?? [])],
    locales: [...(current?.locales ?? [])],
  };
}

export function KnowledgeSources({
  canManageSources,
  recentJobs,
  onChanged,
}: {
  canManageSources: boolean;
  recentJobs: KnowledgeV2JobView[];
  onChanged: () => void;
}) {
  const { t, locale, formatDate, formatNumber } = useI18n();
  const [sources, setSources] = React.useState<KnowledgeV2SourceView[]>([]);
  const [sourcePage, setSourcePage] = React.useState<KnowledgeV2SourcePage["pageInfo"] | null>(
    null,
  );
  const sourcePageCursor = React.useRef<string | null>(null);
  const [sourceLoading, setSourceLoading] = React.useState(true);
  const [sourceLoadingMore, setSourceLoadingMore] = React.useState(false);
  const [sourceError, setSourceError] = React.useState<ApiClientError | null>(null);
  const [search, setSearch] = React.useState("");
  const [kindFilter, setKindFilter] = React.useState<"ALL" | "WEBSITE" | "FILE" | "MANUAL">("ALL");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | KnowledgeV2SourceStatus>("ALL");
  const [selectedSourceId, setSelectedSourceId] = React.useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = React.useState<KnowledgeV2SourceView | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<ApiClientError | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const sourceRequest = React.useRef(0);
  const detailRequest = React.useRef(0);

  const [catalogSources, setCatalogSources] = React.useState<BusinessImportSourceView[]>([]);
  const [catalogPage, setCatalogPage] = React.useState<BusinessImportSourcePage | null>(null);
  const catalogPageCursor = React.useRef<string | null>(null);
  const [catalogLoading, setCatalogLoading] = React.useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<ApiClientError | null>(null);
  const catalogRequest = React.useRef(0);

  const [documents, setDocuments] = React.useState<KnowledgeV2DocumentView[]>([]);
  const [documentPage, setDocumentPage] = React.useState<
    KnowledgeV2DocumentPage["pageInfo"] | null
  >(null);
  const documentPageCursor = React.useRef<string | null>(null);
  const [documentLoading, setDocumentLoading] = React.useState(false);
  const [documentLoadingMore, setDocumentLoadingMore] = React.useState(false);
  const [documentError, setDocumentError] = React.useState<ApiClientError | null>(null);
  const [documentSearch, setDocumentSearch] = React.useState("");
  const [documentStatus, setDocumentStatus] = React.useState<"ALL" | KnowledgeV2DocumentStatus>(
    "ALL",
  );
  const [selectedDocumentId, setSelectedDocumentId] = React.useState<string | null>(null);
  const documentRequest = React.useRef(0);

  const [revisions, setRevisions] = React.useState<KnowledgeV2RevisionView[]>([]);
  const [revisionPage, setRevisionPage] = React.useState<
    KnowledgeV2RevisionPage["pageInfo"] | null
  >(null);
  const revisionPageCursor = React.useRef<string | null>(null);
  const [revisionLoading, setRevisionLoading] = React.useState(false);
  const [revisionLoadingMore, setRevisionLoadingMore] = React.useState(false);
  const [revisionError, setRevisionError] = React.useState<ApiClientError | null>(null);
  const revisionRequest = React.useRef(0);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createUrl, setCreateUrl] = React.useState("");
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState<ApiClientError | null>(null);
  const [createFields, setCreateFields] = React.useState<Record<string, string>>({});
  const [websiteAvailability, setWebsiteAvailability] = React.useState<
    "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE"
  >("UNKNOWN");
  const createAttempt = React.useRef<AttemptKey | null>(null);

  const [fileOpen, setFileOpen] = React.useState(false);
  const [fileValue, setFileValue] = React.useState<File | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [fileLocale, setFileLocale] = React.useState(locale);
  const [fileClassification, setFileClassification] = React.useState<"PUBLIC" | "INTERNAL">(
    "PUBLIC",
  );
  const [fileAudience, setFileAudience] = React.useState<KnowledgeV2Audience>("PUBLIC");
  const [filePhase, setFilePhase] = React.useState<FileUploadPhase>("IDLE");
  const [fileError, setFileError] = React.useState<ApiClientError | null>(null);
  const [fileFields, setFileFields] = React.useState<Record<string, string>>({});
  const [fileAvailability, setFileAvailability] = React.useState<
    "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE"
  >("UNKNOWN");
  const [pendingFileIntent, setPendingFileIntent] =
    React.useState<KnowledgeV2FileUploadIntentView | null>(null);
  const [fileUploaded, setFileUploaded] = React.useState(false);
  const fileIntentAttempt = React.useRef<AttemptKey | null>(null);
  const fileCompleteAttempt = React.useRef<AttemptKey | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [pendingAction, setPendingAction] = React.useState<SourceAction | null>(null);
  const [actionReason, setActionReason] = React.useState("");
  const [actionBusy, setActionBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<ApiClientError | null>(null);
  const actionAttempt = React.useRef<AttemptKey | null>(null);

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsDraft, setSettingsDraft] = React.useState<SourceSettingsDraft | null>(null);
  const [settingsBusy, setSettingsBusy] = React.useState(false);
  const [settingsError, setSettingsError] = React.useState<ApiClientError | null>(null);
  const [settingsFields, setSettingsFields] = React.useState<Record<string, string>>({});
  const [settingsConflictReloaded, setSettingsConflictReloaded] = React.useState(false);
  const settingsAttempt = React.useRef<AttemptKey | null>(null);

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [preview, setPreview] = React.useState<KnowledgeV2RevisionPreviewView | null>(null);
  const [previewError, setPreviewError] = React.useState<ApiClientError | null>(null);
  const [excludeMode, setExcludeMode] = React.useState(false);
  const [excludeReason, setExcludeReason] = React.useState("");
  const [excludeBusy, setExcludeBusy] = React.useState(false);
  const excludeAttempt = React.useRef<AttemptKey | null>(null);

  const [activeJob, setActiveJob] = React.useState<ActiveJob | null>(null);
  const jobPollCount = React.useRef(0);
  const jobPollBusy = React.useRef(false);
  const dismissedJobId = React.useRef<string | null>(null);

  const loadSources = React.useCallback(
    async (append = false) => {
      const sequence = ++sourceRequest.current;
      if (append) setSourceLoadingMore(true);
      else setSourceLoading(true);
      try {
        const page = await listKnowledgeV2Sources({
          limit: SOURCE_PAGE_SIZE,
          ...(append && sourcePageCursor.current ? { cursor: sourcePageCursor.current } : {}),
          ...(kindFilter !== "ALL" ? { kind: kindFilter } : {}),
          ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
          ...(search.trim() ? { query: search.trim() } : {}),
        });
        if (sequence !== sourceRequest.current) return;
        setSources((current) => (append ? [...current, ...page.items] : page.items));
        setSourcePage(page.pageInfo);
        sourcePageCursor.current = page.pageInfo.nextCursor;
        setSourceError(null);
        if (!append) {
          setSelectedSourceId((current) =>
            current && page.items.some((item) => item.id === current)
              ? current
              : (page.items[0]?.id ?? null),
          );
        }
      } catch (caught) {
        if (sequence !== sourceRequest.current) return;
        setSourceError(apiError(caught, t("knowledge.sources.error.list")));
      } finally {
        if (sequence === sourceRequest.current) {
          setSourceLoading(false);
          setSourceLoadingMore(false);
        }
      }
    },
    [kindFilter, search, statusFilter, t],
  );

  React.useEffect(() => {
    const timer = window.setTimeout(() => void loadSources(false), search.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [loadSources, search]);

  const loadCatalogSources = React.useCallback(
    async (append = false) => {
      const sequence = ++catalogRequest.current;
      if (append) setCatalogLoadingMore(true);
      else setCatalogLoading(true);
      try {
        const page = await listBusinessImportSources({
          limit: CATALOG_PAGE_SIZE,
          ...(append && catalogPageCursor.current ? { cursor: catalogPageCursor.current } : {}),
        });
        if (sequence !== catalogRequest.current) return;
        setCatalogSources((current) => (append ? [...current, ...page.items] : page.items));
        setCatalogPage(page);
        catalogPageCursor.current = page.nextCursor ?? null;
        setCatalogError(null);
      } catch (caught) {
        if (sequence !== catalogRequest.current) return;
        setCatalogError(apiError(caught, t("knowledge.sources.catalog.error")));
      } finally {
        if (sequence === catalogRequest.current) {
          setCatalogLoading(false);
          setCatalogLoadingMore(false);
        }
      }
    },
    [t],
  );

  React.useEffect(() => {
    void loadCatalogSources(false);
  }, [loadCatalogSources]);

  const loadSourceDetail = React.useCallback(
    async (sourceId: string, showLoading = true) => {
      const sequence = ++detailRequest.current;
      if (showLoading) setDetailLoading(true);
      try {
        const response = await getKnowledgeV2Source(sourceId);
        if (sequence !== detailRequest.current) return null;
        setSourceDetail(response.data);
        setSources((current) => replaceSource(current, response.data));
        setDetailError(null);
        setConflict(false);
        return response.data;
      } catch (caught) {
        if (sequence !== detailRequest.current) return null;
        const error = apiError(caught, t("knowledge.sources.error.detail"));
        if (error.status === 404) {
          setSourceDetail(null);
          setSelectedSourceId(null);
          void loadSources(false);
        } else {
          setDetailError(error);
        }
        return null;
      } finally {
        if (sequence === detailRequest.current) setDetailLoading(false);
      }
    },
    [loadSources, t],
  );

  React.useEffect(() => {
    setSourceDetail(null);
    setDetailError(null);
    setConflict(false);
    setSelectedDocumentId(null);
    setDocuments([]);
    setRevisions([]);
    setSettingsOpen(false);
    setSettingsDraft(null);
    if (selectedSourceId) void loadSourceDetail(selectedSourceId, true);
  }, [loadSourceDetail, selectedSourceId]);

  const loadDocuments = React.useCallback(
    async (sourceId: string, append = false) => {
      const sequence = ++documentRequest.current;
      if (append) setDocumentLoadingMore(true);
      else setDocumentLoading(true);
      try {
        const page = await listKnowledgeV2Documents({
          sourceId,
          limit: DOCUMENT_PAGE_SIZE,
          ...(append && documentPageCursor.current ? { cursor: documentPageCursor.current } : {}),
          ...(documentStatus !== "ALL" ? { status: documentStatus } : {}),
          ...(documentSearch.trim() ? { query: documentSearch.trim() } : {}),
        });
        if (sequence !== documentRequest.current) return;
        setDocuments((current) => (append ? [...current, ...page.items] : page.items));
        setDocumentPage(page.pageInfo);
        documentPageCursor.current = page.pageInfo.nextCursor;
        setDocumentError(null);
        if (!append) {
          setSelectedDocumentId((current) =>
            current && page.items.some((item) => item.id === current)
              ? current
              : (page.items[0]?.id ?? null),
          );
        }
      } catch (caught) {
        if (sequence !== documentRequest.current) return;
        setDocumentError(apiError(caught, t("knowledge.sources.error.documents")));
      } finally {
        if (sequence === documentRequest.current) {
          setDocumentLoading(false);
          setDocumentLoadingMore(false);
        }
      }
    },
    [documentSearch, documentStatus, t],
  );

  React.useEffect(() => {
    if (!selectedSourceId) return;
    const timer = window.setTimeout(
      () => void loadDocuments(selectedSourceId, false),
      documentSearch.trim() ? 300 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [documentSearch, documentStatus, loadDocuments, selectedSourceId]);

  const loadRevisions = React.useCallback(
    async (documentId: string, append = false) => {
      const sequence = ++revisionRequest.current;
      if (append) setRevisionLoadingMore(true);
      else setRevisionLoading(true);
      try {
        const page = await listKnowledgeV2DocumentRevisions(documentId, {
          limit: REVISION_PAGE_SIZE,
          ...(append && revisionPageCursor.current ? { cursor: revisionPageCursor.current } : {}),
        });
        if (sequence !== revisionRequest.current) return;
        setRevisions((current) => (append ? [...current, ...page.items] : page.items));
        setRevisionPage(page.pageInfo);
        revisionPageCursor.current = page.pageInfo.nextCursor;
        setRevisionError(null);
      } catch (caught) {
        if (sequence !== revisionRequest.current) return;
        setRevisionError(apiError(caught, t("knowledge.sources.error.revisions")));
      } finally {
        if (sequence === revisionRequest.current) {
          setRevisionLoading(false);
          setRevisionLoadingMore(false);
        }
      }
    },
    [t],
  );

  React.useEffect(() => {
    setRevisions([]);
    setRevisionPage(null);
    revisionPageCursor.current = null;
    setRevisionError(null);
    if (selectedDocumentId) void loadRevisions(selectedDocumentId, false);
  }, [loadRevisions, selectedDocumentId]);

  const refreshAfterJob = React.useCallback(async () => {
    await loadSources(false);
    if (selectedSourceId) {
      await loadSourceDetail(selectedSourceId, false);
      await loadDocuments(selectedSourceId, false);
    }
    if (selectedDocumentId) await loadRevisions(selectedDocumentId, false);
    onChanged();
  }, [
    loadDocuments,
    loadRevisions,
    loadSourceDetail,
    loadSources,
    onChanged,
    selectedDocumentId,
    selectedSourceId,
  ]);

  const serverSourceJob = React.useMemo(
    () =>
      recentJobs.find((job) => job.resources.some((resource) => resource.type === "SOURCE")) ??
      null,
    [recentJobs],
  );

  React.useEffect(() => {
    if (!serverSourceJob || dismissedJobId.current === serverSourceJob.id) return;
    const sourceId = serverSourceJob.resources.find((resource) => resource.type === "SOURCE")?.id;
    const source = sources.find((item) => item.id === sourceId);
    const operation = recoveredSourceOperation(serverSourceJob, source);
    setActiveJob((current) => {
      if (current?.jobId === serverSourceJob.id) {
        const currentStatus = current.job?.status ?? current.acceptedStatus;
        if (jobStatusRank(currentStatus) > jobStatusRank(serverSourceJob.status)) return current;
        return {
          ...current,
          operation,
          acceptedStatus: serverSourceJob.status,
          job: serverSourceJob,
        };
      }
      if (serverSourceJob.status === "SUCCEEDED") return current;
      const currentStatus = current?.job?.status ?? current?.acceptedStatus;
      if (currentStatus && !terminalJobStatuses.has(currentStatus)) return current;
      return {
        jobId: serverSourceJob.id,
        operation,
        acceptedStatus: serverSourceJob.status,
        job: serverSourceJob,
        pollError: null,
        pollingStopped: false,
      };
    });
  }, [serverSourceJob, sources]);

  React.useEffect(() => {
    jobPollCount.current = 0;
    jobPollBusy.current = false;
  }, [activeJob?.jobId]);

  const pollActiveJob = React.useCallback(
    async (manual = false) => {
      const jobId = activeJob?.jobId;
      if (!jobId || jobPollBusy.current || (!manual && document.visibilityState !== "visible"))
        return;
      if (!manual && jobPollCount.current >= JOB_POLL_LIMIT) {
        setActiveJob((current) => (current ? { ...current, pollingStopped: true } : current));
        return;
      }
      jobPollBusy.current = true;
      jobPollCount.current += 1;
      try {
        const job = await getKnowledgeV2Job(jobId);
        setActiveJob((current) =>
          current?.jobId === jobId
            ? { ...current, job, pollError: null, pollingStopped: false }
            : current,
        );
        if (terminalJobStatuses.has(job.status)) await refreshAfterJob();
      } catch (caught) {
        setActiveJob((current) =>
          current?.jobId === jobId
            ? {
                ...current,
                pollError: apiError(caught, t("knowledge.sources.error.job")),
                pollingStopped: !manual && jobPollCount.current >= JOB_POLL_LIMIT,
              }
            : current,
        );
      } finally {
        jobPollBusy.current = false;
      }
    },
    [activeJob?.jobId, refreshAfterJob, t],
  );

  const activeJobId = activeJob?.jobId ?? null;
  const activeJobStatus = activeJob?.job?.status ?? activeJob?.acceptedStatus ?? null;
  const activeJobPollingStopped = activeJob?.pollingStopped ?? false;
  React.useEffect(() => {
    if (
      !activeJobId ||
      !activeJobStatus ||
      terminalJobStatuses.has(activeJobStatus) ||
      activeJobPollingStopped
    ) {
      return;
    }
    const timer = window.setInterval(() => void pollActiveJob(false), JOB_POLL_INTERVAL_MS);
    const first = window.setTimeout(() => void pollActiveJob(false), 100);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollActiveJob(false);
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeJobId, activeJobPollingStopped, activeJobStatus, pollActiveJob]);

  const hasTransientSource = sources.some((source) => transientSourceStatuses.has(source.status));
  React.useEffect(() => {
    if (!hasTransientSource || activeJob) return;
    let count = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || count >= SOURCE_REFRESH_LIMIT) return;
      count += 1;
      void loadSources(false);
      if (selectedSourceId) void loadSourceDetail(selectedSourceId, false);
    };
    const timer = window.setInterval(refresh, SOURCE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [activeJob, hasTransientSource, loadSourceDetail, loadSources, selectedSourceId]);

  function startJob(accepted: KnowledgeV2AcceptedMutation, operation: JobOperation) {
    jobPollCount.current = 0;
    dismissedJobId.current = null;
    setActiveJob({
      jobId: accepted.jobId,
      operation,
      acceptedStatus: accepted.status,
      job: null,
      pollError: null,
      pollingStopped: false,
    });
  }

  function validateWebsite() {
    const errors: Record<string, string> = {};
    const name = createName.trim();
    const url = createUrl.trim();
    if (!name) errors.displayName = t("knowledge.sources.create.validation.name");
    else if (name.length > 160)
      errors.displayName = t("knowledge.sources.create.validation.nameLength");
    if (!url) errors.canonicalUri = t("knowledge.sources.create.validation.url");
    else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") {
          errors.canonicalUri = t("knowledge.sources.create.validation.https");
        } else if (parsed.username || parsed.password) {
          errors.canonicalUri = t("knowledge.sources.create.validation.credentials");
        } else if (parsed.search) {
          errors.canonicalUri = t("knowledge.sources.create.validation.query");
        }
      } catch {
        errors.canonicalUri = t("knowledge.sources.create.validation.url");
      }
    }
    setCreateFields(errors);
    return Object.keys(errors).length === 0;
  }

  async function submitWebsite() {
    if (!validateWebsite() || websiteAvailability === "UNAVAILABLE") return;
    const body = {
      kind: "WEBSITE" as const,
      displayName: createName.trim(),
      canonicalUri: createUrl.trim(),
      syncMode: "MANUAL" as const,
      defaultClassification: "PUBLIC" as const,
      defaultLocale: locale,
      defaultScope: { audiences: ["PUBLIC" as const] },
    };
    const signature = JSON.stringify(body);
    setCreateBusy(true);
    setCreateError(null);
    try {
      const response = await createKnowledgeV2Source(body, {
        "Idempotency-Key": idempotencyKeyFor(createAttempt, signature),
      });
      setWebsiteAvailability("AVAILABLE");
      startJob(response.data, "IMPORT");
      setSelectedSourceId(response.data.resource?.id ?? null);
      setCreateOpen(false);
      setCreateName("");
      setCreateUrl("");
      setCreateFields({});
      createAttempt.current = null;
      await loadSources(false);
      if (response.data.resource?.id) await loadSourceDetail(response.data.resource.id, true);
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.sources.error.create"));
      setCreateError(error);
      setCreateFields(fieldErrors(error));
      if (error.code === "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED") {
        setWebsiteAvailability("UNAVAILABLE");
      }
    } finally {
      setCreateBusy(false);
    }
  }

  function clearPendingFileIntent() {
    setPendingFileIntent(null);
    setFileUploaded(false);
    fileIntentAttempt.current = null;
    fileCompleteAttempt.current = null;
  }

  function resetFileForm() {
    setFileValue(null);
    setFileName("");
    setFileLocale(locale);
    setFileClassification("PUBLIC");
    setFileAudience("PUBLIC");
    setFilePhase("IDLE");
    setFileError(null);
    setFileFields({});
    clearPendingFileIntent();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function localizedFileError(error: ApiClientError) {
    let key: TranslationKey = "knowledge.sources.file.error.generic";
    if (error.code.startsWith("KNOWLEDGE_UPLOAD_SCANNER_")) {
      key = "knowledge.sources.file.error.scanner";
    } else if (error.code === "KNOWLEDGE_DEPENDENCY_OBJECT_STORAGE_UNAVAILABLE") {
      key = "knowledge.sources.file.error.storage";
    } else if (
      error.code === "KNOWLEDGE_UPLOAD_INTENT_EXPIRED" ||
      error.code === "KNOWLEDGE_UPLOAD_INTENT_ALREADY_USED" ||
      error.code === "KNOWLEDGE_UPLOAD_NOT_READY"
    ) {
      key = "knowledge.sources.file.error.restart";
    } else if (error.code === "KNOWLEDGE_UPLOAD_MALWARE_DETECTED") {
      key = "knowledge.sources.file.error.malware";
    } else if (error.code === "KNOWLEDGE_PARSE_PDF_SANDBOX_REQUIRED") {
      key = "knowledge.sources.file.pdfUnavailable";
    }
    return new ApiClientError(
      t(key),
      error.status,
      error.code,
      error.retryable,
      error.field,
      error.details,
      error.requestId,
      error.fieldErrors,
    );
  }

  function selectFile(next: File | null) {
    setFileError(null);
    setFileFields({});
    clearPendingFileIntent();
    if (!next) {
      setFileValue(null);
      return;
    }
    const extension = next.name.toLowerCase().split(".").at(-1);
    if (extension === "pdf" || next.type === "application/pdf") {
      setFileValue(null);
      setFileFields({ file: t("knowledge.sources.file.pdfUnavailable") });
      return;
    }
    const mimeType = fileMimeType(next);
    if (!mimeType) {
      setFileValue(null);
      setFileFields({ file: t("knowledge.sources.file.validation.type") });
      return;
    }
    if (next.size < 1) {
      setFileValue(null);
      setFileFields({ file: t("knowledge.sources.file.validation.empty") });
      return;
    }
    if (next.size > FILE_UPLOAD_MAX_BYTES) {
      setFileValue(null);
      setFileFields({ file: t("knowledge.sources.file.validation.size") });
      return;
    }
    setFileValue(next);
    if (!fileName.trim()) setFileName(fileDisplayName(next));
  }

  function validateFileForm() {
    const errors: Record<string, string> = {};
    const name = fileName.trim();
    if (!fileValue) errors.file = t("knowledge.sources.file.validation.required");
    else if (!fileMimeType(fileValue)) errors.file = t("knowledge.sources.file.validation.type");
    else if (fileValue.size > FILE_UPLOAD_MAX_BYTES) {
      errors.file = t("knowledge.sources.file.validation.size");
    }
    if (!name) errors.displayName = t("knowledge.sources.create.validation.name");
    else if (name.length > 160) {
      errors.displayName = t("knowledge.sources.create.validation.nameLength");
    }
    setFileFields(errors);
    return Object.keys(errors).length === 0;
  }

  async function submitFile() {
    if (!validateFileForm() || !fileValue || fileAvailability === "UNAVAILABLE") return;
    const mimeType = fileMimeType(fileValue);
    if (!mimeType) return;
    const body = {
      displayName: fileName.trim(),
      filename: fileValue.name,
      declaredMimeType: mimeType,
      byteSize: fileValue.size,
      defaultScope: { audiences: [fileAudience] },
      defaultClassification: fileClassification,
      defaultLocale: fileLocale,
    };
    const signature = JSON.stringify({
      ...body,
      fileLastModified: fileValue.lastModified,
    });
    let intent = pendingFileIntent;
    let uploaded = fileUploaded;
    let step: FileUploadPhase = "PREPARING";
    setFileError(null);
    try {
      if (!intent) {
        setFilePhase("PREPARING");
        intent = (
          await createKnowledgeV2FileUploadIntent(body, {
            "Idempotency-Key": idempotencyKeyFor(fileIntentAttempt, signature),
          })
        ).data;
        setPendingFileIntent(intent);
        setFileAvailability("AVAILABLE");
      }
      if (!uploaded) {
        step = "UPLOADING";
        setFilePhase("UPLOADING");
        await uploadKnowledgeV2File(intent, fileValue);
        uploaded = true;
        setFileUploaded(true);
      }
      step = "SCANNING";
      setFilePhase("SCANNING");
      const response = await completeKnowledgeV2FileUpload(intent.id, {
        "Idempotency-Key": idempotencyKeyFor(fileCompleteAttempt, intent.id),
      });
      setFilePhase("PROCESSING");
      startJob(response.data, "IMPORT");
      setSelectedSourceId(response.data.resource?.id ?? null);
      await loadSources(false);
      if (response.data.resource?.id) await loadSourceDetail(response.data.resource.id, true);
      onChanged();
      setFileOpen(false);
      resetFileForm();
    } catch (caught) {
      const raw = apiError(caught, t("knowledge.sources.file.error.generic"));
      const error = localizedFileError(raw);
      setFileError(error);
      setFileFields(fieldErrors(error));
      if (raw.code === "KNOWLEDGE_DEPENDENCY_FILE_INGESTION_DISABLED") {
        setFileAvailability("UNAVAILABLE");
      }
      const restart =
        step === "UPLOADING" ||
        raw.code === "KNOWLEDGE_UPLOAD_INTENT_EXPIRED" ||
        raw.code === "KNOWLEDGE_UPLOAD_INTENT_ALREADY_USED" ||
        raw.code === "KNOWLEDGE_UPLOAD_NOT_READY" ||
        raw.code === "KNOWLEDGE_UPLOAD_MALWARE_DETECTED";
      if (restart) clearPendingFileIntent();
      setFilePhase("IDLE");
    }
  }

  function openAction(action: SourceAction) {
    setPendingAction(action);
    setActionReason("");
    setActionError(null);
    setConflict(false);
    actionAttempt.current = null;
  }

  function openSettings() {
    if (!sourceDetail) return;
    setSettingsDraft(settingsDraftFromSource(sourceDetail));
    setSettingsFields({});
    setSettingsError(null);
    setSettingsConflictReloaded(false);
    settingsAttempt.current = null;
    setSettingsOpen(true);
  }

  function editSettings(
    patch: Partial<Omit<SourceSettingsDraft, "dirty">>,
    field: keyof SettingsDirtyFields,
  ) {
    setSettingsDraft((current) =>
      current ? { ...current, ...patch, dirty: { ...current.dirty, [field]: true } } : current,
    );
    setSettingsFields((current) => ({ ...current, [field]: "", defaultScope: "" }));
    setSettingsError(null);
    setSettingsConflictReloaded(false);
    settingsAttempt.current = null;
  }

  function editSettingsClassification(value: "PUBLIC" | "INTERNAL") {
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            defaultClassification: value,
            audiences: value === "INTERNAL" ? ["INTERNAL"] : current.audiences,
            dirty: {
              ...current.dirty,
              defaultClassification: true,
              audiences: value === "INTERNAL" ? true : current.dirty.audiences,
            },
          }
        : current,
    );
    setSettingsFields((current) => ({
      ...current,
      defaultClassification: "",
      defaultScope: "",
    }));
    setSettingsError(null);
    setSettingsConflictReloaded(false);
    settingsAttempt.current = null;
  }

  function toggleSettingsAudience(audience: KnowledgeV2Audience) {
    setSettingsDraft((current) => {
      if (!current || current.defaultClassification === "INTERNAL") return current;
      const selected = current.audiences.includes(audience);
      return {
        ...current,
        audiences: selected
          ? current.audiences.filter((value) => value !== audience)
          : audienceValues.filter(
              (value) => value === audience || current.audiences.includes(value),
            ),
        dirty: { ...current.dirty, audiences: true },
      };
    });
    setSettingsFields((current) => ({ ...current, defaultScope: "" }));
    setSettingsError(null);
    setSettingsConflictReloaded(false);
    settingsAttempt.current = null;
  }

  async function submitSettings() {
    if (!sourceDetail || !settingsDraft) return;
    const errors: Record<string, string> = {};
    if (!settingsDraft.displayName.trim()) {
      errors.displayName = t("knowledge.sources.settings.validation.name");
    } else if (settingsDraft.displayName.trim().length > 160) {
      errors.displayName = t("knowledge.sources.settings.validation.nameLength");
    }
    try {
      if (
        !settingsDraft.defaultLocale ||
        settingsDraft.defaultLocale.length > 35 ||
        !Intl.getCanonicalLocales(settingsDraft.defaultLocale)[0]
      ) {
        throw new Error("invalid locale");
      }
    } catch {
      errors.defaultLocale = t("knowledge.sources.settings.validation.locale");
    }
    if (settingsDraft.dirty.audiences && settingsDraft.audiences.length === 0) {
      errors.defaultScope = t("knowledge.sources.settings.validation.audience");
    }
    if (
      (settingsDraft.dirty.defaultClassification || settingsDraft.dirty.audiences) &&
      settingsDraft.defaultClassification === "INTERNAL" &&
      (settingsDraft.audiences.length !== 1 || settingsDraft.audiences[0] !== "INTERNAL")
    ) {
      errors.defaultScope = t("knowledge.sources.settings.validation.internalAudience");
    }
    if (Object.keys(errors).length > 0) {
      setSettingsFields(errors);
      return;
    }

    const body: KnowledgeV2UpdateSourceRequest = {};
    if (settingsDraft.dirty.displayName) body.displayName = settingsDraft.displayName.trim();
    if (settingsDraft.dirty.defaultLocale) body.defaultLocale = settingsDraft.defaultLocale;
    if (settingsDraft.dirty.defaultClassification) {
      body.defaultClassification = settingsDraft.defaultClassification;
    }
    if (settingsDraft.dirty.audiences) {
      body.defaultScope = scopeWithAudiences(sourceDetail, settingsDraft.audiences);
    }
    if (settingsDraft.dirty.syncMode) body.syncMode = settingsDraft.syncMode;
    if (Object.keys(body).length === 0) return;

    const signature = JSON.stringify({ sourceId: sourceDetail.id, etag: sourceDetail.etag, body });
    setSettingsBusy(true);
    setSettingsError(null);
    setSettingsConflictReloaded(false);
    try {
      const response = await updateKnowledgeV2Source(sourceDetail.id, body, {
        "Idempotency-Key": idempotencyKeyFor(settingsAttempt, signature),
        "If-Match": sourceDetail.etag,
      });
      setSourceDetail(response.data.resource);
      setSources((current) => replaceSource(current, response.data.resource));
      if (response.data.job) startJob(response.data.job, "RECONCILE");
      setSettingsOpen(false);
      setSettingsDraft(null);
      settingsAttempt.current = null;
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.sources.settings.error.save"));
      setSettingsError(error);
      setSettingsFields(fieldErrors(error));
      if (isConflict(error)) {
        try {
          const latest = await getKnowledgeV2Source(sourceDetail.id);
          setSourceDetail(latest.data);
          setSources((current) => replaceSource(current, latest.data));
          setSettingsDraft((current) =>
            current ? mergeSettingsDraft(current, latest.data) : current,
          );
          setSettingsError(null);
          setSettingsConflictReloaded(true);
          settingsAttempt.current = null;
        } catch (reloadCaught) {
          setSettingsError(
            apiError(reloadCaught, t("knowledge.sources.settings.error.conflictReload")),
          );
        }
      }
    } finally {
      setSettingsBusy(false);
    }
  }

  async function submitAction() {
    if (!pendingAction || !sourceDetail) return;
    const reason = actionReason.trim();
    if (pendingAction === "DELETE" && reason.length < 3) {
      setActionError(new ApiClientError(t("knowledge.sources.action.reasonMinimum"), 400));
      return;
    }
    const signature = JSON.stringify({
      action: pendingAction,
      sourceId: sourceDetail.id,
      etag: sourceDetail.etag,
      reason,
    });
    const headers = {
      "Idempotency-Key": idempotencyKeyFor(actionAttempt, signature),
      "If-Match": sourceDetail.etag,
    };
    setActionBusy(true);
    setActionError(null);
    try {
      if (pendingAction === "PAUSE") {
        const response = await pauseKnowledgeV2Source(
          sourceDetail.id,
          reason ? { reason } : {},
          headers,
        );
        setSourceDetail(response.data.resource);
        setSources((current) => replaceSource(current, response.data.resource));
      } else if (pendingAction === "SYNC") {
        const response = await syncKnowledgeV2Source(
          sourceDetail.id,
          reason ? { reason } : {},
          headers,
        );
        startJob(response.data, "SYNC");
      } else if (pendingAction === "RESUME") {
        const response = await resumeKnowledgeV2Source(
          sourceDetail.id,
          reason ? { reason } : {},
          headers,
        );
        startJob(response.data, "RESUME");
      } else {
        const response = await deleteKnowledgeV2Source(sourceDetail.id, { reason }, headers);
        startJob(response.data, "DELETE");
      }
      setPendingAction(null);
      actionAttempt.current = null;
      await loadSourceDetail(sourceDetail.id, false);
      await loadSources(false);
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.sources.error.action"));
      setActionError(error);
      if (isConflict(error)) setConflict(true);
    } finally {
      setActionBusy(false);
    }
  }

  async function openPreview(revision: KnowledgeV2RevisionView) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreview(null);
    setPreviewError(null);
    setExcludeMode(false);
    setExcludeReason("");
    excludeAttempt.current = null;
    try {
      const response = await previewKnowledgeV2Revision(revision.id);
      setPreview(response.data);
    } catch (caught) {
      setPreviewError(apiError(caught, t("knowledge.sources.error.preview")));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function reloadPreview() {
    if (!preview) return;
    await openPreview(preview.revision);
  }

  async function submitExclusion() {
    if (!preview) return;
    const reason = excludeReason.trim();
    if (reason.length < 3) {
      setPreviewError(new ApiClientError(t("knowledge.sources.exclude.reasonMinimum"), 400));
      return;
    }
    const signature = JSON.stringify({
      revisionId: preview.revision.id,
      etag: preview.revision.etag,
      reason,
    });
    setExcludeBusy(true);
    setPreviewError(null);
    try {
      const response = await excludeKnowledgeV2Revision(
        preview.revision.id,
        { reason },
        {
          "Idempotency-Key": idempotencyKeyFor(excludeAttempt, signature),
          "If-Match": preview.revision.etag,
        },
      );
      startJob(response.data, "EXCLUDE");
      setPreviewOpen(false);
      setExcludeMode(false);
      excludeAttempt.current = null;
      if (selectedDocumentId) await loadRevisions(selectedDocumentId, false);
      if (selectedSourceId) await loadSourceDetail(selectedSourceId, false);
      onChanged();
    } catch (caught) {
      const error = apiError(caught, t("knowledge.sources.error.exclude"));
      setPreviewError(error);
      if (isConflict(error)) setConflict(true);
    } finally {
      setExcludeBusy(false);
    }
  }

  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? null;
  const sourceFilterOptions = [
    { value: "ALL", label: t("knowledge.sources.filter.allTypes") },
    { value: "WEBSITE", label: t("knowledge.sources.kind.website") },
    { value: "FILE", label: t("knowledge.sources.kind.file") },
    { value: "MANUAL", label: t("knowledge.sources.kind.manual") },
  ];
  const sourceStatusOptions = [
    { value: "ALL", label: t("knowledge.sources.filter.allStatuses") },
    ...Object.entries(sourceStatusKeys).map(([value, key]) => ({ value, label: t(key) })),
  ];
  const documentStatusOptions = [
    { value: "ALL", label: t("knowledge.sources.filter.allDocumentStatuses") },
    ...Object.entries(documentStatusKeys).map(([value, key]) => ({ value, label: t(key) })),
  ];
  const settingsLocaleOptions = [
    ...localeOptions.map((option) => ({ value: option.value, label: t(option.labelKey) })),
    ...(settingsDraft &&
    !localeOptions.some((option) => option.value === settingsDraft.defaultLocale)
      ? [{ value: settingsDraft.defaultLocale, label: settingsDraft.defaultLocale }]
      : []),
  ];
  const settingsChanged = settingsDraft ? Object.values(settingsDraft.dirty).some(Boolean) : false;
  const fileBusy = filePhase !== "IDLE";
  const fileRestartRequired = Boolean(
    fileError &&
    [
      "KNOWLEDGE_UPLOAD_INTENT_EXPIRED",
      "KNOWLEDGE_UPLOAD_INTENT_ALREADY_USED",
      "KNOWLEDGE_UPLOAD_NOT_READY",
      "KNOWLEDGE_UPLOAD_MALWARE_DETECTED",
    ].includes(fileError.code),
  );

  return (
    <div className="space-y-4" data-testid="knowledge-sources">
      <section className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-100">{t("knowledge.sources.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            {t("knowledge.sources.description")}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setFileError(null);
              setFileFields({});
              setFileLocale(locale);
              setFileOpen(true);
            }}
            disabled={!canManageSources}
            data-testid="knowledge-source-add-file"
          >
            <FileUp className="h-4 w-4" />
            {t("knowledge.sources.addFile")}
          </Button>
          <Button
            onClick={() => {
              setCreateError(null);
              setCreateFields({});
              createAttempt.current = null;
              setCreateOpen(true);
            }}
            disabled={!canManageSources || websiteAvailability === "UNAVAILABLE"}
            data-testid="knowledge-source-add"
          >
            <Plus className="h-4 w-4" />
            {t("knowledge.sources.addWebsite")}
          </Button>
        </div>
      </section>

      {!canManageSources ? (
        <Notice tone="info" icon={ShieldCheck} title={t("knowledge.sources.permissionTitle")}>
          {t("knowledge.sources.permissionBody")}
        </Notice>
      ) : null}

      {websiteAvailability === "UNAVAILABLE" ? (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title={t("knowledge.sources.unavailableTitle")}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setWebsiteAvailability("UNKNOWN");
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("knowledge.sources.checkAgain")}
            </Button>
          }
        >
          {t("knowledge.sources.unavailableBody")}
        </Notice>
      ) : null}

      {activeJob ? (
        <JobProgressPanel
          activeJob={activeJob}
          onCheck={() => {
            jobPollCount.current = 0;
            setActiveJob((current) =>
              current ? { ...current, pollError: null, pollingStopped: false } : current,
            );
            void pollActiveJob(true);
          }}
          onRetry={
            sourceDetail &&
            activeJob.job?.resources.some(
              (resource) => resource.type === "SOURCE" && resource.id === sourceDetail.id,
            ) &&
            terminalJobStatuses.has(activeJob.job.status) &&
            (sourceDetail.allowedActions.includes("SYNC") ||
              sourceDetail.allowedActions.includes("RESUME"))
              ? () => openAction(sourceDetail.allowedActions.includes("SYNC") ? "SYNC" : "RESUME")
              : undefined
          }
          onDismiss={() => {
            dismissedJobId.current = activeJob.jobId;
            setActiveJob(null);
          }}
        />
      ) : null}

      <section className="min-w-0" data-testid="knowledge-catalog-sources">
        <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-100">
              {t("knowledge.sources.catalog.title")}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500">
              {t("knowledge.sources.catalog.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">
              {t("knowledge.sources.catalog.count", {
                count: formatNumber(catalogSources.length),
              })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("knowledge.sources.refreshList")}
              onClick={() => void loadCatalogSources(false)}
              disabled={catalogLoading}
            >
              <RefreshCw className={cn("h-4 w-4", catalogLoading && "animate-spin")} />
            </Button>
            {canManageSources ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/app/knowledge?view=business">
                  <FileSpreadsheet className="h-4 w-4" />
                  {t("businessImport.entry.importFile")}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        {catalogLoading && catalogSources.length === 0 ? (
          <LoadingOverlay label={t("knowledge.sources.loading")} />
        ) : catalogError && catalogSources.length === 0 ? (
          <ErrorState error={catalogError} onRetry={() => void loadCatalogSources(false)} />
        ) : catalogSources.length === 0 ? (
          <div className="border-y border-white/10 py-4">
            <p className="text-sm text-zinc-500">{t("knowledge.sources.catalog.empty")}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.07] border-y border-white/10">
            {catalogSources.map((source) => {
              const latest = source.latestImport;
              return (
                <article
                  key={source.id}
                  className="flex min-w-0 items-center gap-3 py-3"
                  data-testid={`knowledge-catalog-source-${source.id}`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-medium text-zinc-200">
                          {source.displayName}
                        </p>
                        {latest ? (
                          <StatusBadge status={businessImportStateTone(latest.state)}>
                            {t(businessImportStateKeys[latest.state])}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {latest?.originalFilename ?? t("knowledge.sources.catalog.noImport")}
                      </p>
                      {latest ? (
                        <p className="mt-1 text-xs text-zinc-600">
                          {t("businessImport.metrics.found")}: {formatNumber(latest.counts.total)}
                          {" · "}
                          {formatDate(latest.updatedAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {latest ? (
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link href={`/app/knowledge/imports/${encodeURIComponent(latest.id)}`}>
                        {t("knowledge.sources.catalog.open")}
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                </article>
              );
            })}
            {catalogPage?.nextCursor ? (
              <div className="py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadCatalogSources(true)}
                  disabled={catalogLoadingMore}
                >
                  {catalogLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("knowledge.sources.loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 text-xs text-sky-200/70">
          <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <p>{t("knowledge.sources.catalog.boundary")}</p>
        </div>
      </section>

      <div className="min-w-0">
        <h3 className="text-base font-semibold text-zinc-100">
          {t("knowledge.sources.documents.title")}
        </h3>
        <p className="mt-1 text-sm text-zinc-500">{t("knowledge.sources.documents.description")}</p>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/25">
          <div className="space-y-3 border-b border-white/10 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={cn(inputClass, "pl-9")}
                placeholder={t("knowledge.sources.searchPlaceholder")}
                aria-label={t("knowledge.sources.searchLabel")}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={kindFilter}
                onValueChange={(value) => setKindFilter(value as typeof kindFilter)}
                options={sourceFilterOptions}
                ariaLabel={t("knowledge.sources.filter.type")}
                className="h-10 rounded-md px-3"
              />
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
                options={sourceStatusOptions}
                ariaLabel={t("knowledge.sources.filter.status")}
                className="h-10 rounded-md px-3"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <p className="text-xs font-medium text-zinc-500">
              {t("knowledge.sources.sourceCount", { count: formatNumber(sources.length) })}
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("knowledge.sources.refreshList")}
              onClick={() => void loadSources(false)}
              disabled={sourceLoading}
            >
              <RefreshCw className={cn("h-4 w-4", sourceLoading && "animate-spin")} />
            </Button>
          </div>

          {sourceLoading && sources.length === 0 ? (
            <LoadingOverlay label={t("knowledge.sources.loading")} />
          ) : sourceError && sources.length === 0 ? (
            <ErrorState error={sourceError} onRetry={() => void loadSources(false)} />
          ) : sources.length === 0 ? (
            <EmptyState
              icon={Library}
              title={
                search || kindFilter !== "ALL" || statusFilter !== "ALL"
                  ? t("knowledge.sources.noResultsTitle")
                  : t("knowledge.sources.emptyTitle")
              }
              description={
                search || kindFilter !== "ALL" || statusFilter !== "ALL"
                  ? t("knowledge.sources.noResultsBody")
                  : t("knowledge.sources.emptyBody")
              }
              action={
                canManageSources && websiteAvailability !== "UNAVAILABLE" ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t("knowledge.sources.addWebsite")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-white/[0.07]" role="list">
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="listitem"
                  aria-current={selectedSourceId === source.id ? "true" : undefined}
                  onClick={() => setSelectedSourceId(source.id)}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left transition-colors",
                    selectedSourceId === source.id
                      ? "bg-emerald-500/[0.08]"
                      : "hover:bg-white/[0.035]",
                  )}
                  data-testid={`knowledge-source-${source.id}`}
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
                    {source.kind === "WEBSITE" ? (
                      <Globe2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <FileText className="h-4 w-4 text-zinc-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium text-zinc-200"
                      title={source.displayName}
                    >
                      {source.displayName}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <SourceStatus status={source.status} kind={source.kind} />
                      <span className="text-xs text-zinc-600">
                        {t("knowledge.common.documents", {
                          count: formatNumber(source.documentCount),
                        })}
                      </span>
                    </div>
                    {source.canonicalUri ? (
                      <p
                        className="mt-1.5 truncate text-xs text-zinc-600"
                        title={source.canonicalUri}
                      >
                        {source.canonicalUri}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-zinc-700" />
                </button>
              ))}
              {sourcePage?.hasNextPage ? (
                <div className="p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => void loadSources(true)}
                    disabled={sourceLoadingMore}
                  >
                    {sourceLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t("knowledge.sources.loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/25">
          {!selectedSourceId ? (
            <EmptyState
              icon={Globe2}
              title={t("knowledge.sources.selectTitle")}
              description={t("knowledge.sources.selectBody")}
            />
          ) : detailLoading && !sourceDetail ? (
            <LoadingOverlay label={t("knowledge.sources.detailLoading")} />
          ) : detailError && !sourceDetail ? (
            <ErrorState
              error={detailError}
              onRetry={() => void loadSourceDetail(selectedSourceId, true)}
            />
          ) : sourceDetail ? (
            <div className="min-w-0">
              <div className="border-b border-white/10 p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceStatus status={sourceDetail.status} kind={sourceDetail.kind} />
                      <span className="text-xs text-zinc-600">
                        {t(sourceKindKeys[sourceDetail.kind])}
                      </span>
                    </div>
                    <h3 className="mt-2 break-words text-xl font-semibold text-zinc-100">
                      {sourceDetail.displayName}
                    </h3>
                    {sourceDetail.canonicalUri ? (
                      <a
                        href={sourceDetail.canonicalUri}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
                      >
                        <span className="truncate" title={sourceDetail.canonicalUri}>
                          {sourceDetail.canonicalUri}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <span className="sr-only">{t("knowledge.sources.openWebsite")}</span>
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("knowledge.sources.refreshDetail")}
                      onClick={() => void loadSourceDetail(sourceDetail.id, false)}
                      disabled={detailLoading}
                    >
                      <RefreshCw className={cn("h-4 w-4", detailLoading && "animate-spin")} />
                    </Button>
                    {canManageSources && sourceDetail.allowedActions.includes("EDIT") ? (
                      <Button variant="outline" size="sm" onClick={openSettings}>
                        <Settings2 className="h-4 w-4" />
                        {t("knowledge.sources.settings.action")}
                      </Button>
                    ) : null}
                    {sourceDetail.allowedActions.includes("SYNC") ? (
                      <Button variant="outline" size="sm" onClick={() => openAction("SYNC")}>
                        <RefreshCw className="h-4 w-4" />
                        {t("knowledge.sources.action.sync")}
                      </Button>
                    ) : null}
                    {sourceDetail.allowedActions.includes("PAUSE") ? (
                      <Button variant="outline" size="sm" onClick={() => openAction("PAUSE")}>
                        <Pause className="h-4 w-4" />
                        {t("knowledge.sources.action.pause")}
                      </Button>
                    ) : null}
                    {sourceDetail.allowedActions.includes("RESUME") ? (
                      <Button variant="outline" size="sm" onClick={() => openAction("RESUME")}>
                        <Play className="h-4 w-4" />
                        {t("knowledge.sources.action.resume")}
                      </Button>
                    ) : null}
                    {sourceDetail.allowedActions.includes("DELETE") ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                        aria-label={t("knowledge.sources.action.delete")}
                        onClick={() => openAction("DELETE")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2.5 text-xs text-sky-200/80">
                  <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                  <p>{t("knowledge.sources.draftNotice")}</p>
                </div>

                {conflict ? (
                  <Notice
                    className="mt-4"
                    tone="warning"
                    icon={TriangleAlert}
                    title={t("knowledge.sources.conflictTitle")}
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void (async () => {
                            setPendingAction(null);
                            await loadSourceDetail(sourceDetail.id, true);
                            if (selectedDocumentId) {
                              await loadRevisions(selectedDocumentId, false);
                            }
                          })();
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {t("knowledge.sources.conflictReload")}
                      </Button>
                    }
                  >
                    {t("knowledge.sources.conflictBody")}
                  </Notice>
                ) : null}

                {sourceDetail.lastErrorCode ? (
                  <SourceFailure
                    source={sourceDetail}
                    onSync={
                      sourceDetail.allowedActions.includes("SYNC")
                        ? () => openAction("SYNC")
                        : undefined
                    }
                  />
                ) : null}

                <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric
                    label={t("knowledge.sources.detail.documents")}
                    value={formatNumber(sourceDetail.documentCount)}
                  />
                  <Metric
                    label={t("knowledge.sources.detail.locale")}
                    value={sourceDetail.defaultLocale.toUpperCase()}
                  />
                  <Metric
                    label={t("knowledge.sources.detail.classification")}
                    value={t(classificationKeys[sourceDetail.defaultClassification])}
                  />
                  <Metric
                    label={t("knowledge.sources.detail.audience")}
                    value={
                      sourceDetail.defaultScope?.audiences.length
                        ? sourceDetail.defaultScope.audiences
                            .map((audience) => t(audienceKeys[audience]))
                            .join(", ")
                        : t("knowledge.common.workspaceDefault")
                    }
                  />
                  <Metric
                    label={t("knowledge.sources.detail.lastSuccess")}
                    value={
                      sourceDetail.lastSuccessAt
                        ? formatDate(sourceDetail.lastSuccessAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : t("knowledge.common.notRecorded")
                    }
                  />
                </dl>
              </div>

              <div className="min-w-0 p-4 sm:p-5">
                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-200">
                      {t("knowledge.sources.documentsTitle")}
                    </h4>
                    <p className="mt-1 text-xs text-zinc-600">
                      {t("knowledge.sources.documentsBody")}
                    </p>
                  </div>
                  <div className="grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(180px,1fr)_190px] 2xl:w-auto">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                      <input
                        value={documentSearch}
                        onChange={(event) => setDocumentSearch(event.target.value)}
                        className={cn(inputClass, "pl-8")}
                        placeholder={t("knowledge.sources.documentsSearch")}
                        aria-label={t("knowledge.sources.documentsSearchLabel")}
                      />
                    </div>
                    <Select
                      value={documentStatus}
                      onValueChange={(value) => setDocumentStatus(value as typeof documentStatus)}
                      options={documentStatusOptions}
                      ariaLabel={t("knowledge.sources.filter.documentStatus")}
                      className="h-10 rounded-md px-3"
                    />
                  </div>
                </div>

                {documentError ? (
                  <InlineError
                    error={documentError}
                    onRetry={() => void loadDocuments(sourceDetail.id, false)}
                    className="mt-4"
                  />
                ) : null}

                {documentLoading && documents.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <Spinner className="h-6 w-6" />
                    <span className="ml-2 text-sm text-zinc-500">
                      {t("knowledge.sources.documentsLoading")}
                    </span>
                  </div>
                ) : documents.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    className="py-12"
                    title={
                      documentSearch || documentStatus !== "ALL"
                        ? t("knowledge.sources.documentsNoResultsTitle")
                        : t("knowledge.sources.documentsEmptyTitle")
                    }
                    description={
                      documentSearch || documentStatus !== "ALL"
                        ? t("knowledge.sources.documentsNoResultsBody")
                        : t("knowledge.sources.documentsEmptyBody")
                    }
                  />
                ) : (
                  <div className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
                    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10">
                      <div className="divide-y divide-white/[0.07]">
                        {documents.map((document) => (
                          <button
                            key={document.id}
                            type="button"
                            aria-current={selectedDocumentId === document.id ? "true" : undefined}
                            onClick={() => setSelectedDocumentId(document.id)}
                            className={cn(
                              "flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left transition-colors",
                              selectedDocumentId === document.id
                                ? "bg-emerald-500/[0.07]"
                                : "hover:bg-white/[0.03]",
                            )}
                          >
                            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-sm font-medium text-zinc-300"
                                title={document.title}
                              >
                                {document.title}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <StatusBadge status={statusTone(document.status)}>
                                  {t(documentStatusKeys[document.status])}
                                </StatusBadge>
                                <span className="text-xs text-zinc-600">
                                  {document.canonicalLocale.toUpperCase()}
                                </span>
                                <span className="text-xs text-zinc-600">
                                  {formatDate(document.updatedAt, { dateStyle: "medium" })}
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-700" />
                          </button>
                        ))}
                      </div>
                      {documentPage?.hasNextPage ? (
                        <div className="border-t border-white/10 p-3">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => void loadDocuments(sourceDetail.id, true)}
                            disabled={documentLoadingMore}
                          >
                            {documentLoadingMore ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            {t("knowledge.sources.loadMoreDocuments")}
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <RevisionList
                      document={selectedDocument}
                      revisions={revisions}
                      pageInfo={revisionPage}
                      loading={revisionLoading}
                      loadingMore={revisionLoadingMore}
                      error={revisionError}
                      onRetry={() =>
                        selectedDocumentId && void loadRevisions(selectedDocumentId, false)
                      }
                      onLoadMore={() =>
                        selectedDocumentId && void loadRevisions(selectedDocumentId, true)
                      }
                      onPreview={(revision) => void openPreview(revision)}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          if (createBusy) return;
          setCreateOpen(open);
          if (!open) {
            setCreateError(null);
            setCreateFields({});
          }
        }}
        title={t("knowledge.sources.create.title")}
        description={t("knowledge.sources.create.description")}
        className="max-w-xl rounded-lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              onClick={() => void submitWebsite()}
              disabled={createBusy || websiteAvailability === "UNAVAILABLE"}
              data-testid="knowledge-source-import"
            >
              {createBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe2 className="h-4 w-4" />
              )}
              {createBusy
                ? t("knowledge.sources.create.importing")
                : t("knowledge.sources.create.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {websiteAvailability === "UNAVAILABLE" ? (
            <Notice
              tone="warning"
              icon={TriangleAlert}
              title={t("knowledge.sources.unavailableTitle")}
            >
              {t("knowledge.sources.unavailableBody")}
            </Notice>
          ) : null}
          {createError && websiteAvailability !== "UNAVAILABLE" ? (
            <InlineError error={createError} />
          ) : null}
          <Field
            label={t("knowledge.sources.create.name")}
            error={createFields.displayName}
            htmlFor="knowledge-source-name"
          >
            <input
              id="knowledge-source-name"
              value={createName}
              onChange={(event) => {
                setCreateName(event.target.value);
                setCreateFields((current) => ({ ...current, displayName: "" }));
                createAttempt.current = null;
              }}
              className={inputClass}
              maxLength={160}
              placeholder={t("knowledge.sources.create.namePlaceholder")}
              aria-invalid={Boolean(createFields.displayName)}
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field
            label={t("knowledge.sources.create.url")}
            hint={t("knowledge.sources.create.urlHint")}
            error={createFields.canonicalUri ?? createFields.url}
            htmlFor="knowledge-source-url"
          >
            <input
              id="knowledge-source-url"
              value={createUrl}
              onChange={(event) => {
                setCreateUrl(event.target.value);
                setCreateFields((current) => ({ ...current, canonicalUri: "", url: "" }));
                createAttempt.current = null;
              }}
              className={inputClass}
              maxLength={2048}
              placeholder="https://example.com"
              inputMode="url"
              autoComplete="url"
              aria-invalid={Boolean(createFields.canonicalUri ?? createFields.url)}
            />
          </Field>
          <div className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-zinc-300">
                {t("knowledge.sources.create.safeTitle")}
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                {t("knowledge.sources.create.safeBody")}
              </p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={fileOpen}
        onOpenChange={(open) => {
          if (fileBusy) return;
          setFileOpen(open);
          if (!open) resetFileForm();
        }}
        title={t("knowledge.sources.file.title")}
        description={t("knowledge.sources.file.description")}
        className="max-w-2xl rounded-lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setFileOpen(false);
                resetFileForm();
              }}
              disabled={fileBusy}
            >
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              onClick={() => void submitFile()}
              disabled={fileBusy || fileAvailability === "UNAVAILABLE" || !fileValue}
              data-testid="knowledge-file-upload-submit"
            >
              {fileBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : fileRestartRequired || fileError?.retryable ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              {fileBusy
                ? t(filePhaseKeys[filePhase])
                : fileRestartRequired
                  ? t("knowledge.sources.file.restart")
                  : fileError?.retryable
                    ? t("knowledge.common.tryAgain")
                    : t("knowledge.sources.file.submit")}
            </Button>
          </>
        }
      >
        <div className="min-w-0 space-y-5" data-testid="knowledge-file-upload">
          {fileAvailability === "UNAVAILABLE" ? (
            <Notice
              tone="warning"
              icon={TriangleAlert}
              title={t("knowledge.sources.file.error.unavailableTitle")}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFileAvailability("UNKNOWN");
                    setFileError(null);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("knowledge.sources.checkAgain")}
                </Button>
              }
            >
              {t("knowledge.sources.file.error.unavailableBody")}
            </Notice>
          ) : null}
          {fileError && fileAvailability !== "UNAVAILABLE" ? (
            <InlineError error={fileError} />
          ) : null}

          <div className="min-w-0">
            <div className="flex flex-col gap-3 rounded-md border border-dashed border-white/15 bg-white/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200">
                  {t("knowledge.sources.file.choose")}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {t("knowledge.sources.file.limits")}
                </p>
                <p className="text-xs leading-5 text-amber-300/80">
                  {t("knowledge.sources.file.pdfUnavailable")}
                </p>
              </div>
              <label className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.07] focus-within:ring-2 focus-within:ring-emerald-500/30">
                <FileText className="h-4 w-4" />
                {t("knowledge.sources.file.browse")}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  className="sr-only"
                  aria-label={t("knowledge.sources.file.inputLabel")}
                  onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            {fileValue ? (
              <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-zinc-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="min-w-0 truncate" title={fileValue.name}>
                  {t("knowledge.sources.file.selected", {
                    name: fileValue.name,
                    size: formatNumber(fileValue.size),
                  })}
                </span>
              </div>
            ) : null}
            {fileFields.file ? (
              <p className="mt-1.5 text-xs text-rose-400">{fileFields.file}</p>
            ) : null}
          </div>

          <Field
            label={t("knowledge.sources.file.name")}
            error={fileFields.displayName}
            htmlFor="knowledge-file-source-name"
          >
            <input
              id="knowledge-file-source-name"
              value={fileName}
              onChange={(event) => {
                setFileName(event.target.value);
                setFileFields((current) => ({ ...current, displayName: "" }));
                clearPendingFileIntent();
              }}
              className={inputClass}
              maxLength={160}
              placeholder={t("knowledge.sources.file.namePlaceholder")}
              aria-invalid={Boolean(fileFields.displayName)}
              autoComplete="off"
            />
          </Field>

          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-300">
                {t("knowledge.sources.file.locale")}
              </p>
              <Select
                value={fileLocale}
                onValueChange={(value) => {
                  setFileLocale(value as typeof locale);
                  clearPendingFileIntent();
                }}
                options={localeOptions.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
                ariaLabel={t("knowledge.sources.file.locale")}
                className="mt-2 h-10 rounded-md px-3"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-300">
                {t("knowledge.sources.file.classification")}
              </p>
              <Select
                value={fileClassification}
                onValueChange={(value) => {
                  const classification = value as "PUBLIC" | "INTERNAL";
                  setFileClassification(classification);
                  if (classification === "INTERNAL") setFileAudience("INTERNAL");
                  clearPendingFileIntent();
                }}
                options={[
                  { value: "PUBLIC", label: t("knowledge.sources.classification.public") },
                  { value: "INTERNAL", label: t("knowledge.sources.classification.internal") },
                ]}
                ariaLabel={t("knowledge.sources.file.classification")}
                className="mt-2 h-10 rounded-md px-3"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-300">
                {t("knowledge.sources.file.audience")}
              </p>
              <Select
                value={fileAudience}
                onValueChange={(value) => {
                  setFileAudience(value as KnowledgeV2Audience);
                  clearPendingFileIntent();
                }}
                options={(fileClassification === "INTERNAL"
                  ? ["INTERNAL" as const]
                  : audienceValues
                ).map((audience) => ({
                  value: audience,
                  label: t(audienceKeys[audience]),
                }))}
                ariaLabel={t("knowledge.sources.file.audience")}
                className="mt-2 h-10 rounded-md px-3"
              />
            </div>
          </div>

          {fileBusy ? (
            <div
              className="flex min-w-0 items-center gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-3"
              aria-live="polite"
              data-testid="knowledge-file-upload-phase"
            >
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-400" />
              <span className="text-sm text-emerald-100">{t(filePhaseKeys[filePhase])}</span>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        onOpenChange={(open) => {
          if (settingsBusy) return;
          setSettingsOpen(open);
          if (!open) {
            setSettingsDraft(null);
            setSettingsError(null);
            setSettingsFields({});
            setSettingsConflictReloaded(false);
          }
        }}
        title={t("knowledge.sources.settings.title")}
        description={t("knowledge.sources.settings.description")}
        className="max-w-2xl rounded-lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(false)}
              disabled={settingsBusy}
            >
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              onClick={() => void submitSettings()}
              disabled={settingsBusy || !settingsChanged}
              data-testid="knowledge-source-settings-save"
            >
              {settingsBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Settings2 className="h-4 w-4" />
              )}
              {settingsBusy
                ? t("knowledge.sources.settings.saving")
                : t("knowledge.sources.settings.save")}
            </Button>
          </>
        }
      >
        {settingsDraft ? (
          <div className="min-w-0 space-y-5" data-testid="knowledge-source-settings">
            {settingsConflictReloaded ? (
              <Notice
                tone="warning"
                icon={TriangleAlert}
                title={t("knowledge.sources.settings.conflictTitle")}
              >
                {t("knowledge.sources.settings.conflictBody")}
              </Notice>
            ) : null}
            {settingsError ? <InlineError error={settingsError} /> : null}

            <Field
              label={t("knowledge.sources.settings.name")}
              error={settingsFields.displayName}
              htmlFor="knowledge-source-settings-name"
            >
              <input
                id="knowledge-source-settings-name"
                value={settingsDraft.displayName}
                onChange={(event) =>
                  editSettings({ displayName: event.target.value }, "displayName")
                }
                className={inputClass}
                maxLength={160}
                aria-invalid={Boolean(settingsFields.displayName)}
                autoComplete="off"
                autoFocus
              />
            </Field>

            <div className="grid min-w-0 gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-300">
                  {t("knowledge.sources.settings.locale")}
                </p>
                <Select
                  value={settingsDraft.defaultLocale}
                  onValueChange={(value) => editSettings({ defaultLocale: value }, "defaultLocale")}
                  options={settingsLocaleOptions}
                  ariaLabel={t("knowledge.sources.settings.locale")}
                  className="mt-2 h-10 rounded-md px-3"
                />
                {settingsFields.defaultLocale ? (
                  <p className="mt-1.5 text-xs text-rose-400">{settingsFields.defaultLocale}</p>
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-300">
                  {t("knowledge.sources.settings.classification")}
                </p>
                <Select
                  value={settingsDraft.defaultClassification}
                  onValueChange={(value) =>
                    editSettingsClassification(value as "PUBLIC" | "INTERNAL")
                  }
                  options={[
                    { value: "PUBLIC", label: t("knowledge.sources.classification.public") },
                    { value: "INTERNAL", label: t("knowledge.sources.classification.internal") },
                  ]}
                  ariaLabel={t("knowledge.sources.settings.classification")}
                  className="mt-2 h-10 rounded-md px-3"
                />
                {settingsFields.defaultClassification ? (
                  <p className="mt-1.5 text-xs text-rose-400">
                    {settingsFields.defaultClassification}
                  </p>
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-300">
                  {t("knowledge.sources.settings.syncMode")}
                </p>
                <Select
                  value={settingsDraft.syncMode}
                  onValueChange={() => editSettings({ syncMode: "MANUAL" }, "syncMode")}
                  options={[
                    { value: "MANUAL", label: t("knowledge.sources.settings.syncModeManual") },
                  ]}
                  ariaLabel={t("knowledge.sources.settings.syncMode")}
                  className="mt-2 h-10 rounded-md px-3"
                />
              </div>
            </div>

            <fieldset className="min-w-0">
              <legend className="text-sm font-medium text-zinc-300">
                {t("knowledge.sources.settings.audience")}
              </legend>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                {settingsDraft.defaultClassification === "INTERNAL"
                  ? t("knowledge.sources.settings.internalAudienceOnly")
                  : t("knowledge.sources.settings.audienceHint")}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {audienceValues.map((audience) => (
                  <label
                    key={audience}
                    className={cn(
                      "flex min-w-0 items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors",
                      settingsDraft.audiences.includes(audience)
                        ? "border-emerald-500/30 bg-emerald-500/[0.07] text-zinc-200"
                        : "border-white/10 bg-white/[0.025] text-zinc-500",
                      settingsDraft.defaultClassification === "INTERNAL" &&
                        "cursor-not-allowed opacity-65",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={settingsDraft.audiences.includes(audience)}
                      onChange={() => toggleSettingsAudience(audience)}
                      disabled={settingsDraft.defaultClassification === "INTERNAL"}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
                    />
                    <span className="min-w-0 break-words">{t(audienceKeys[audience])}</span>
                  </label>
                ))}
              </div>
              {(settingsFields.defaultScope ?? settingsFields["defaultScope.audiences"]) ? (
                <p className="mt-1.5 text-xs text-rose-400">
                  {settingsFields.defaultScope ?? settingsFields["defaultScope.audiences"]}
                </p>
              ) : null}
            </fieldset>

            <div className="flex items-start gap-3 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-amber-200">
                  {t("knowledge.sources.settings.permissionsTitle")}
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-100/60">
                  {t("knowledge.sources.settings.permissionsBody")}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <SourceActionModal
        action={pendingAction}
        source={sourceDetail}
        reason={actionReason}
        busy={actionBusy}
        error={actionError}
        onReasonChange={(value) => {
          setActionReason(value);
          setActionError(null);
          actionAttempt.current = null;
        }}
        onClose={() => {
          if (!actionBusy) setPendingAction(null);
        }}
        onConfirm={() => void submitAction()}
        onReload={
          sourceDetail
            ? () => {
                void (async () => {
                  await loadSourceDetail(sourceDetail.id, true);
                  setPendingAction(null);
                })();
              }
            : undefined
        }
      />

      <RevisionPreviewModal
        open={previewOpen}
        loading={previewLoading}
        preview={preview}
        error={previewError}
        excludeMode={excludeMode}
        excludeReason={excludeReason}
        excludeBusy={excludeBusy}
        onOpenChange={(open) => {
          if (!excludeBusy) setPreviewOpen(open);
        }}
        onRetry={() => preview && void reloadPreview()}
        onExclude={() => {
          setExcludeMode(true);
          setPreviewError(null);
        }}
        onCancelExclude={() => {
          setExcludeMode(false);
          setExcludeReason("");
          setPreviewError(null);
          excludeAttempt.current = null;
        }}
        onReasonChange={(value) => {
          setExcludeReason(value);
          setPreviewError(null);
          excludeAttempt.current = null;
        }}
        onConfirmExclude={() => void submitExclusion()}
      />
    </div>
  );
}

function SourceStatus({
  status,
  kind,
}: {
  status: KnowledgeV2SourceStatus;
  kind: KnowledgeV2SourceKind;
}) {
  const { t } = useI18n();
  const key =
    kind === "FILE" && status === "NEEDS_REVIEW"
      ? "knowledge.sources.file.phase.review"
      : kind === "FILE" && status === "READY"
        ? "knowledge.sources.file.phase.ready"
        : sourceStatusKeys[status];
  return <StatusBadge status={statusTone(status)}>{t(key)}</StatusBadge>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
      <dt className="text-xs text-zinc-600">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium leading-snug text-zinc-300" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone: "info" | "warning";
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-start",
        tone === "warning"
          ? "border-amber-500/20 bg-amber-500/[0.06]"
          : "border-sky-500/20 bg-sky-500/[0.05]",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "warning" ? "text-amber-400" : "text-sky-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        <div className="mt-1 text-xs leading-5 text-zinc-500">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: ApiClientError; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t("knowledge.sources.error.title")}
      description={error.message}
      action={
        <div className="space-y-2 text-center">
          <Button size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {t("knowledge.common.tryAgain")}
          </Button>
          {error.requestId ? (
            <p className="text-xs text-zinc-700">
              {t("knowledge.common.request", { id: error.requestId })}
            </p>
          ) : null}
        </div>
      }
    />
  );
}

function InlineError({
  error,
  onRetry,
  retryLabel,
  className,
}: {
  error: ApiClientError;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2.5 sm:flex-row sm:items-start",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-rose-200">{error.message}</p>
        {error.requestId ? (
          <p className="mt-1 text-xs text-rose-300/45">
            {t("knowledge.common.request", { id: error.requestId })}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel ?? t("knowledge.common.tryAgain")}
        </Button>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-300">
        {label}
      </label>
      {hint ? <p className="mt-1 text-xs text-zinc-600">{hint}</p> : null}
      <div className="mt-2">{children}</div>
      {error ? <p className="mt-1.5 text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

function SourceFailure({ source, onSync }: { source: KnowledgeV2SourceView; onSync?: () => void }) {
  const { t } = useI18n();
  const deferred = source.lastErrorCode === "KNOWLEDGE_SOURCE_SYNC_DEFERRED_PAUSED";
  const config = source.lastErrorCode === "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED";
  const security = source.lastErrorCode?.startsWith("KNOWLEDGE_SECURITY_");
  const message = deferred
    ? t("knowledge.sources.failure.deferred")
    : config
      ? t("knowledge.sources.failure.configuration")
      : security
        ? t("knowledge.sources.failure.security")
        : t("knowledge.sources.failure.generic", { code: source.lastErrorCode ?? "UNKNOWN" });
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-3 sm:flex-row sm:items-start">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-amber-200">{t("knowledge.sources.failure.title")}</p>
        <p className="mt-1 break-words text-xs leading-5 text-amber-100/60">{message}</p>
      </div>
      {onSync && !deferred && !config ? (
        <Button variant="outline" size="sm" onClick={onSync}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("knowledge.sources.action.sync")}
        </Button>
      ) : null}
    </div>
  );
}

function JobProgressPanel({
  activeJob,
  onCheck,
  onRetry,
  onDismiss,
}: {
  activeJob: ActiveJob;
  onCheck: () => void;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const job = activeJob.job;
  const status = job?.status ?? activeJob.acceptedStatus;
  const terminal = terminalJobStatuses.has(status);
  const percent =
    typeof job?.progress.percent === "number"
      ? Math.max(0, Math.min(100, job.progress.percent))
      : null;
  const operationKeys: Record<JobOperation, TranslationKey> = {
    IMPORT: "knowledge.sources.job.operation.import",
    SYNC: "knowledge.sources.job.operation.sync",
    RESUME: "knowledge.sources.job.operation.resume",
    DELETE: "knowledge.sources.job.operation.delete",
    EXCLUDE: "knowledge.sources.job.operation.exclude",
    RECONCILE: "knowledge.sources.job.operation.reconcile",
  };
  return (
    <section
      aria-live="polite"
      className="rounded-lg border border-white/10 bg-zinc-950/30 px-4 py-3"
      data-testid="knowledge-source-job"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
            {status === "SUCCEEDED" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : terminal ? (
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-200">
                {t(operationKeys[activeJob.operation])}
              </h3>
              <StatusBadge status={jobTone(status)}>{t(jobStatusKeys[status])}</StatusBadge>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {job ? t(jobStageKeys[job.stage]) : t("knowledge.sources.job.waiting")}
            </p>
            <p
              className="mt-1 truncate font-mono text-[11px] text-zinc-700"
              title={activeJob.jobId}
            >
              {t("knowledge.sources.job.id", { id: activeJob.jobId })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {terminal && onRetry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              data-testid="knowledge-source-job-retry"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("knowledge.common.tryAgain")}
            </Button>
          ) : null}
          {activeJob.pollingStopped || activeJob.pollError ? (
            <Button variant="outline" size="sm" onClick={onCheck}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("knowledge.sources.job.checkNow")}
            </Button>
          ) : null}
          {terminal ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t("knowledge.common.dismiss")}
            </Button>
          ) : null}
        </div>
      </div>
      {percent !== null ? (
        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-label={t("knowledge.sources.job.progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full bg-emerald-400 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-xs text-zinc-600">
            {t("knowledge.sources.job.percent", { percent: formatNumber(percent) })}
          </p>
        </div>
      ) : null}
      {activeJob.pollError ? <InlineError error={activeJob.pollError} className="mt-3" /> : null}
      {activeJob.pollingStopped && !activeJob.pollError ? (
        <p className="mt-3 text-xs text-amber-300/70">
          {t("knowledge.sources.job.pollingStopped")}
        </p>
      ) : null}
      {job?.error ? (
        <div className="mt-3 rounded-md border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2.5">
          <p className="text-sm text-rose-200">{job.error.message}</p>
          <p className="mt-1 font-mono text-xs text-rose-300/45">{job.error.code}</p>
          {job.error.retryable ? (
            <p className="mt-1 text-xs text-rose-200/60">{t("knowledge.sources.job.retryable")}</p>
          ) : null}
        </div>
      ) : null}
      {status === "SUCCEEDED" && activeJob.operation !== "DELETE" ? (
        <p className="mt-3 text-xs leading-5 text-sky-200/65">
          {t("knowledge.sources.job.ingestionStepComplete")}
        </p>
      ) : null}
    </section>
  );
}

function RevisionList({
  document,
  revisions,
  pageInfo,
  loading,
  loadingMore,
  error,
  onRetry,
  onLoadMore,
  onPreview,
}: {
  document: KnowledgeV2DocumentView | null;
  revisions: KnowledgeV2RevisionView[];
  pageInfo: KnowledgeV2RevisionPage["pageInfo"] | null;
  loading: boolean;
  loadingMore: boolean;
  error: ApiClientError | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onPreview: (revision: KnowledgeV2RevisionView) => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  if (!document) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-white/10 px-5 text-center text-sm text-zinc-600">
        {t("knowledge.sources.revisionsSelect")}
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10">
      <div className="border-b border-white/10 px-3 py-3">
        <p className="truncate text-sm font-semibold text-zinc-300" title={document.title}>
          {t("knowledge.sources.revisionsTitle")}
        </p>
        <p className="mt-1 truncate text-xs text-zinc-600" title={document.title}>
          {document.title}
        </p>
      </div>
      {error ? <InlineError error={error} onRetry={onRetry} className="m-3" /> : null}
      {loading && revisions.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-5 w-5" />
        </div>
      ) : revisions.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-zinc-600">
          {t("knowledge.sources.revisionsEmpty")}
        </p>
      ) : (
        <div className="divide-y divide-white/[0.07]">
          {revisions.map((revision) => (
            <div key={revision.id} className="min-w-0 px-3 py-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-zinc-300">
                      {t("knowledge.sources.revisionNumber", {
                        number: formatNumber(revision.revisionNumber),
                      })}
                    </p>
                    <StatusBadge status={statusTone(revision.status)}>
                      {t(revisionStatusKeys[revision.status])}
                    </StatusBadge>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-600">
                    {t("knowledge.sources.revisionSize", {
                      characters: formatNumber(revision.characterCount),
                      tokens: formatNumber(revision.tokenCount),
                    })}
                  </p>
                  <p className="mt-1 text-xs text-zinc-700">
                    {formatDate(revision.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                {revision.allowedActions.includes("PREVIEW") ? (
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("knowledge.sources.preview.openRevision", {
                      number: revision.revisionNumber,
                    })}
                    onClick={() => onPreview(revision)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {pageInfo?.hasNextPage ? (
            <div className="p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("knowledge.sources.loadMoreRevisions")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SourceActionModal({
  action,
  source,
  reason,
  busy,
  error,
  onReasonChange,
  onClose,
  onConfirm,
  onReload,
}: {
  action: SourceAction | null;
  source: KnowledgeV2SourceView | null;
  reason: string;
  busy: boolean;
  error: ApiClientError | null;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onReload?: () => void;
}) {
  const { t } = useI18n();
  if (!action || !source) return null;
  const titleKeys: Record<SourceAction, TranslationKey> = {
    SYNC: "knowledge.sources.action.confirmSyncTitle",
    PAUSE: "knowledge.sources.action.confirmPauseTitle",
    RESUME: "knowledge.sources.action.confirmResumeTitle",
    DELETE: "knowledge.sources.action.confirmDeleteTitle",
  };
  const bodyKeys: Record<SourceAction, TranslationKey> = {
    SYNC: "knowledge.sources.action.confirmSyncBody",
    PAUSE: "knowledge.sources.action.confirmPauseBody",
    RESUME: "knowledge.sources.action.confirmResumeBody",
    DELETE: "knowledge.sources.action.confirmDeleteBody",
  };
  const labelKeys: Record<SourceAction, TranslationKey> = {
    SYNC: "knowledge.sources.action.sync",
    PAUSE: "knowledge.sources.action.pause",
    RESUME: "knowledge.sources.action.resume",
    DELETE: "knowledge.sources.action.deleteConfirm",
  };
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(titleKeys[action], { name: source.displayName })}
      description={t(bodyKeys[action])}
      className="max-w-lg rounded-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("knowledge.common.cancel")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy || (action === "DELETE" && reason.trim().length < 3)}
            className={action === "DELETE" ? "bg-rose-500 text-white hover:bg-rose-600" : ""}
            data-testid="knowledge-source-action-confirm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t(labelKeys[action])}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-3">
          {action === "DELETE" ? (
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          ) : action === "PAUSE" ? (
            <CirclePause className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          ) : (
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          )}
          <p className="text-xs leading-5 text-amber-100/65">
            {action === "DELETE"
              ? t("knowledge.sources.action.deletePublicationNotice")
              : t("knowledge.sources.action.draftOnlyNotice")}
          </p>
        </div>
        {action === "DELETE" ? (
          <Field
            htmlFor="knowledge-source-action-reason"
            label={t("knowledge.sources.action.reason")}
            hint={t("knowledge.sources.action.reasonHint")}
          >
            <textarea
              id="knowledge-source-action-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              className={textareaClass}
              maxLength={1_000}
              placeholder={t("knowledge.sources.action.reasonPlaceholder")}
              autoFocus
            />
          </Field>
        ) : null}
        {error ? (
          <InlineError
            error={error}
            onRetry={isConflict(error) && onReload ? onReload : undefined}
            retryLabel={isConflict(error) ? t("knowledge.sources.conflictReload") : undefined}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function RevisionPreviewModal({
  open,
  loading,
  preview,
  error,
  excludeMode,
  excludeReason,
  excludeBusy,
  onOpenChange,
  onRetry,
  onExclude,
  onCancelExclude,
  onReasonChange,
  onConfirmExclude,
}: {
  open: boolean;
  loading: boolean;
  preview: KnowledgeV2RevisionPreviewView | null;
  error: ApiClientError | null;
  excludeMode: boolean;
  excludeReason: string;
  excludeBusy: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onExclude: () => void;
  onCancelExclude: () => void;
  onReasonChange: (value: string) => void;
  onConfirmExclude: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const visibleElements = preview?.elements.slice(0, 200) ?? [];
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        preview
          ? t("knowledge.sources.preview.title", {
              number: formatNumber(preview.revision.revisionNumber),
            })
          : t("knowledge.sources.preview.loadingTitle")
      }
      description={t("knowledge.sources.preview.description")}
      className="max-w-4xl rounded-lg"
      footer={
        preview && !excludeMode ? (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("knowledge.common.close")}
            </Button>
            {preview.revision.allowedActions.includes("EXCLUDE") ? (
              <Button
                variant="outline"
                className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                onClick={onExclude}
              >
                <Ban className="h-4 w-4" />
                {t("knowledge.sources.exclude.action")}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {loading ? (
        <LoadingOverlay label={t("knowledge.sources.preview.loading")} />
      ) : !preview ? (
        error ? (
          <InlineError error={error} onRetry={onRetry} />
        ) : null
      ) : excludeMode ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-rose-500/20 bg-rose-500/[0.06] px-3 py-3">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-medium text-rose-200">
                {t("knowledge.sources.exclude.title")}
              </p>
              <p className="mt-1 text-xs leading-5 text-rose-100/60">
                {t("knowledge.sources.exclude.description")}
              </p>
            </div>
          </div>
          <Field
            htmlFor="knowledge-revision-exclude-reason"
            label={t("knowledge.sources.exclude.reason")}
            hint={t("knowledge.sources.exclude.reasonHint")}
          >
            <textarea
              id="knowledge-revision-exclude-reason"
              value={excludeReason}
              onChange={(event) => onReasonChange(event.target.value)}
              className={textareaClass}
              maxLength={1_000}
              placeholder={t("knowledge.sources.exclude.reasonPlaceholder")}
              autoFocus
            />
          </Field>
          {error ? (
            <InlineError
              error={error}
              onRetry={isConflict(error) ? onRetry : undefined}
              retryLabel={isConflict(error) ? t("knowledge.sources.conflictReload") : undefined}
            />
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancelExclude} disabled={excludeBusy}>
              {t("knowledge.common.cancel")}
            </Button>
            <Button
              onClick={onConfirmExclude}
              disabled={excludeBusy || excludeReason.trim().length < 3}
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              {excludeBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              {t("knowledge.sources.exclude.confirm")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {error ? (
            <InlineError
              error={error}
              onRetry={isConflict(error) ? onRetry : undefined}
              retryLabel={isConflict(error) ? t("knowledge.sources.conflictReload") : undefined}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={statusTone(preview.revision.status)}>
              {t(revisionStatusKeys[preview.revision.status])}
            </StatusBadge>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-500">
              {t("knowledge.sources.preview.elements", {
                count: formatNumber(preview.elements.length),
              })}
            </span>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-500">
              {t("knowledge.sources.preview.chunks", {
                count: formatNumber(preview.chunks.length),
              })}
            </span>
          </div>
          {visibleElements.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-5 py-12 text-center text-sm text-zinc-600">
              {t("knowledge.sources.preview.empty")}
            </div>
          ) : (
            <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-white/10">
              <div className="divide-y divide-white/[0.07]">
                {visibleElements.map((element) => (
                  <article key={element.id} className="min-w-0 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                      <span className="font-medium text-zinc-500">{element.kind}</span>
                      {element.pageNumber ? (
                        <span>
                          {t("knowledge.sources.preview.page", {
                            number: formatNumber(element.pageNumber),
                          })}
                        </span>
                      ) : null}
                      {element.headingPath.length > 0 ? (
                        <span className="min-w-0 truncate" title={element.headingPath.join(" / ")}>
                          {element.headingPath.join(" / ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                      {element.normalizedText || t("knowledge.sources.preview.nonText")}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}
          {preview.elements.length > visibleElements.length ? (
            <p className="text-xs text-zinc-600">
              {t("knowledge.sources.preview.truncated", {
                count: formatNumber(visibleElements.length),
              })}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
