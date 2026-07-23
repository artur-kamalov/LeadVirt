"use client";

import * as React from "react";
import {
  CheckCircle2,
  Download,
  FilePlus2,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import type { BusinessImportSourceView } from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createBusinessImportIdempotencyKey,
  createBusinessImportIntent,
  finalizeBusinessImport,
  getBusinessImportTemplates,
  listBusinessImportSources,
  uploadBusinessImport,
  type BusinessImportTemplateCatalogView,
} from "@/lib/api/business-imports";
import { ApiClientError } from "@/lib/api/client";
import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/utils";
import { Modal, Select } from "../../ui";

type UploadPhase = "IDLE" | "CREATING" | "UPLOADING" | "FINALIZING";
type SourceLookupPhase = "IDLE" | "LOADING" | "READY" | "ERROR";

interface AttemptKey {
  signature: string;
  key: string;
}

function idempotencyKeyFor(ref: React.MutableRefObject<AttemptKey | null>, signature: string) {
  if (ref.current?.signature === signature) return ref.current.key;
  const key = createBusinessImportIdempotencyKey();
  ref.current = { signature, key };
  return key;
}

function displayFileSize(bytes: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024);
}

function sourceNameFromFile(file: File) {
  return (
    file.name
      .replace(/\.(?:csv|xlsx|pdf)$/iu, "")
      .trim()
      .slice(0, 160) || "Services"
  );
}

function normalizedSourceName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

const formatByExtension = {
  csv: "CSV",
  xlsx: "XLSX",
  pdf: "PDF",
} as const;

function fileFormat(filename: string) {
  const extension = filename.toLocaleLowerCase().split(".").at(-1);
  return extension && extension in formatByExtension
    ? formatByExtension[extension as keyof typeof formatByExtension]
    : null;
}

export function BusinessImportUploadDialog({
  open,
  onOpenChange,
  onCreated,
  sourceId,
  sourceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (importId: string) => void;
  sourceId?: string;
  sourceName?: string;
}) {
  const { localeTag, t } = useI18n();
  const [catalog, setCatalog] = React.useState<BusinessImportTemplateCatalogView | null>(null);
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<ApiClientError | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState("");
  const [phase, setPhase] = React.useState<UploadPhase>("IDLE");
  const [submitError, setSubmitError] = React.useState<ApiClientError | null>(null);
  const [intent, setIntent] = React.useState<
    Awaited<ReturnType<typeof createBusinessImportIntent>>["data"] | null
  >(null);
  const [uploaded, setUploaded] = React.useState(false);
  const [sourceLookupPhase, setSourceLookupPhase] = React.useState<SourceLookupPhase>("IDLE");
  const [sourceLookupError, setSourceLookupError] = React.useState<ApiClientError | null>(null);
  const [matchingSources, setMatchingSources] = React.useState<BusinessImportSourceView[]>([]);
  const [selectedSourceId, setSelectedSourceId] = React.useState<string | null>(null);
  const [createSeparateSource, setCreateSeparateSource] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const intentAttempt = React.useRef<AttemptKey | null>(null);
  const finalizeAttempt = React.useRef<AttemptKey | null>(null);
  const requestSequence = React.useRef(0);
  const sourceLookupSequence = React.useRef(0);

  const policies = React.useMemo(
    () => catalog?.items.filter((item) => item.enabled && item.target === "SERVICES") ?? [],
    [catalog],
  );
  const selectedPolicy = file
    ? policies.find((item) => item.format === fileFormat(file.name))
    : undefined;
  const templates = policies.filter((item) => item.downloadUrl);
  const enabledFormats = policies.map((item) => item.format).join(", ");
  const maximumBytes = policies.reduce((maximum, item) => Math.max(maximum, item.maxBytes), 0);
  const accept = policies
    .flatMap((item) =>
      item.format === "CSV"
        ? [".csv", "text/csv"]
        : item.format === "XLSX"
          ? [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
          : [".pdf", "application/pdf"],
    )
    .join(",");
  const busy = phase !== "IDLE";
  const matchedSource = createSeparateSource
    ? null
    : (matchingSources.find((item) => item.id === selectedSourceId) ?? null);
  const sourceLookupBlocked =
    !sourceId && file !== null && ["LOADING", "ERROR"].includes(sourceLookupPhase);

  const resetUpload = React.useCallback(() => {
    setFile(null);
    setFileError("");
    setPhase("IDLE");
    setSubmitError(null);
    setIntent(null);
    setUploaded(false);
    setSourceLookupPhase("IDLE");
    setSourceLookupError(null);
    setMatchingSources([]);
    setSelectedSourceId(null);
    setCreateSeparateSource(false);
    intentAttempt.current = null;
    finalizeAttempt.current = null;
    sourceLookupSequence.current += 1;
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const loadTemplates = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const next = await getBusinessImportTemplates();
      if (sequence !== requestSequence.current) return;
      setCatalog(next);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setCatalogError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("businessImport.error.templates"), 500, "HTTP_ERROR", true),
      );
    } finally {
      if (sequence === requestSequence.current) setCatalogLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (!open) return;
    resetUpload();
    void loadTemplates();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadTemplates, open, resetUpload]);

  const lookupExistingSource = React.useCallback(
    async (selectedFile: File) => {
      if (sourceId) return;
      const sequence = ++sourceLookupSequence.current;
      const candidateName = sourceNameFromFile(selectedFile);
      setSourceLookupPhase("LOADING");
      setSourceLookupError(null);
      setMatchingSources([]);
      setSelectedSourceId(null);
      setCreateSeparateSource(false);
      try {
        const page = await listBusinessImportSources({
          limit: 100,
          status: "ACTIVE",
          query: candidateName,
        });
        if (sequence !== sourceLookupSequence.current) return;
        const normalizedCandidateName = normalizedSourceName(candidateName);
        const matches = page.items
          .filter((item) => normalizedSourceName(item.displayName) === normalizedCandidateName)
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
        setMatchingSources(matches);
        setSelectedSourceId(matches[0]?.id ?? null);
        setSourceLookupPhase("READY");
      } catch (caught) {
        if (sequence !== sourceLookupSequence.current) return;
        setSourceLookupError(
          caught instanceof ApiClientError
            ? caught
            : new ApiClientError(
                t("businessImport.upload.sourceLookupError"),
                500,
                "HTTP_ERROR",
                true,
              ),
        );
        setSourceLookupPhase("ERROR");
      }
    },
    [sourceId, t],
  );

  function clearIntent() {
    setIntent(null);
    setUploaded(false);
    intentAttempt.current = null;
    finalizeAttempt.current = null;
  }

  function selectFile(next: File | null) {
    setSubmitError(null);
    setFileError("");
    clearIntent();
    sourceLookupSequence.current += 1;
    setSourceLookupPhase("IDLE");
    setSourceLookupError(null);
    setMatchingSources([]);
    setSelectedSourceId(null);
    setCreateSeparateSource(false);
    if (!next) {
      setFile(null);
      return;
    }
    const format = fileFormat(next.name);
    const policy = policies.find((item) => item.format === format);
    if (!format || !policy) {
      setFile(null);
      setFileError(t("businessImport.upload.validation.type", { formats: enabledFormats }));
      return;
    }
    if (next.size < 1) {
      setFile(null);
      setFileError(t("businessImport.upload.validation.empty"));
      return;
    }
    if (next.size > policy.maxBytes) {
      setFile(null);
      setFileError(
        t("businessImport.upload.validation.size", {
          size: displayFileSize(policy.maxBytes, localeTag),
        }),
      );
      return;
    }
    setFile(next);
    if (!sourceId) void lookupExistingSource(next);
  }

  async function submit() {
    if (!file || !selectedPolicy || busy || sourceLookupBlocked) return;
    const effectiveSourceId = sourceId ?? matchedSource?.id;
    const effectiveSourceName =
      sourceName?.trim() || matchedSource?.displayName || sourceNameFromFile(file);
    const body = {
      filename: file.name,
      declaredMimeType: selectedPolicy.declaredMimeType,
      byteSize: file.size,
      sourceName: effectiveSourceName,
      ...(effectiveSourceId ? { sourceId: effectiveSourceId } : {}),
    } as const;
    const signature = JSON.stringify({ ...body, lastModified: file.lastModified });
    let nextIntent = intent;
    let nextUploaded = uploaded;
    setSubmitError(null);
    try {
      if (!nextIntent) {
        setPhase("CREATING");
        nextIntent = (
          await createBusinessImportIntent(body, {
            "Idempotency-Key": idempotencyKeyFor(intentAttempt, signature),
          })
        ).data;
        setIntent(nextIntent);
      }
      if (!nextUploaded) {
        setPhase("UPLOADING");
        await uploadBusinessImport(nextIntent, file);
        nextUploaded = true;
        setUploaded(true);
      }
      setPhase("FINALIZING");
      const finalized = await finalizeBusinessImport(nextIntent.importId, {
        "Idempotency-Key": idempotencyKeyFor(finalizeAttempt, nextIntent.importId),
      });
      setPhase("IDLE");
      onOpenChange(false);
      onCreated(finalized.data.id || nextIntent.importId);
    } catch (caught) {
      const error =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("businessImport.error.upload"), 500, "HTTP_ERROR", true);
      setSubmitError(error);
      if (
        [
          "BUSINESS_IMPORT_UPLOAD_EXPIRED",
          "BUSINESS_IMPORT_UPLOAD_ALREADY_USED",
          "BUSINESS_IMPORT_UPLOAD_ABORTED",
          "BUSINESS_IMPORT_UPLOAD_TIMEOUT",
          "BUSINESS_IMPORT_UPLOAD_INVALID",
          "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
          "BUSINESS_IMPORT_UPLOAD_POLICY_MISMATCH",
          "BUSINESS_IMPORT_MALWARE_DETECTED",
        ].includes(error.code)
      ) {
        clearIntent();
      }
      setPhase("IDLE");
    }
  }

  const phaseLabel =
    phase === "CREATING"
      ? t("businessImport.upload.phase.preparing")
      : phase === "UPLOADING"
        ? t("businessImport.upload.phase.uploading")
        : phase === "FINALIZING"
          ? t("businessImport.upload.phase.security")
          : "";

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={sourceId ? t("businessImport.upload.revisionTitle") : t("businessImport.upload.title")}
      description={
        sourceId && sourceName
          ? t("businessImport.upload.revisionDescription", { name: sourceName })
          : t("businessImport.upload.description")
      }
      closeLabel={t("businessImport.common.close")}
      className="max-w-2xl rounded-lg p-4 sm:p-6"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("businessImport.common.cancel")}
          </Button>
          <Button
            disabled={!file || !selectedPolicy || busy || catalogLoading || sourceLookupBlocked}
            onClick={() => void submit()}
            data-testid="business-import-upload-submit"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : submitError?.retryable ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {busy
              ? phaseLabel
              : submitError?.retryable
                ? t("businessImport.common.tryAgain")
                : t("businessImport.upload.submit")}
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-5" data-testid="business-import-upload-dialog">
        {sourceId && sourceName ? (
          <p
            className="rounded-md border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3 text-sm text-sky-100"
            data-testid="business-import-revision-source"
          >
            {t("businessImport.upload.revisionSource", { name: sourceName })}
          </p>
        ) : null}
        {!sourceId && sourceLookupPhase === "LOADING" ? (
          <div
            className="flex min-h-12 items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-zinc-400"
            data-testid="business-import-source-lookup"
          >
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            {t("businessImport.upload.sourceLookup")}
          </div>
        ) : null}
        {!sourceId && sourceLookupError ? (
          <div
            className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3"
            role="alert"
            data-testid="business-import-source-lookup-error"
          >
            <p className="text-sm font-medium text-rose-200">{sourceLookupError.message}</p>
            {file ? (
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => void lookupExistingSource(file)}
              >
                <RefreshCw className="h-4 w-4" />
                {t("businessImport.common.tryAgain")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {!sourceId && matchedSource ? (
          <div
            className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3"
            data-testid="business-import-existing-source"
          >
            <div className="flex items-start gap-3">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-emerald-100">
                  {t("businessImport.upload.revisionSource", { name: matchedSource.displayName })}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  {t("businessImport.upload.revisionDescription", {
                    name: matchedSource.displayName,
                  })}
                </p>
                {matchingSources.length > 1 ? (
                  <div className="mt-3">
                    <Select
                      value={selectedSourceId ?? undefined}
                      options={matchingSources.map((item) => ({
                        value: item.id,
                        label: `${item.displayName} - ${new Intl.DateTimeFormat(localeTag, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.updatedAt))}`,
                      }))}
                      ariaLabel={t("businessImport.upload.existingSourceLabel")}
                      testId="business-import-existing-source-select"
                      onValueChange={setSelectedSourceId}
                      className="rounded-md"
                    />
                  </div>
                ) : null}
                <Button
                  className="mt-3"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateSeparateSource(true)}
                  data-testid="business-import-create-separate-source"
                >
                  <FilePlus2 className="h-4 w-4" />
                  {t("businessImport.upload.createSeparateSource")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {!sourceId && createSeparateSource && matchingSources.length > 0 ? (
          <div
            className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3"
            data-testid="business-import-separate-source"
          >
            <p className="text-sm font-medium text-amber-100">
              {t("businessImport.upload.separateSourceTitle")}
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              {t("businessImport.upload.separateSourceDescription")}
            </p>
            <Button
              className="mt-3"
              variant="ghost"
              size="sm"
              onClick={() => setCreateSeparateSource(false)}
              data-testid="business-import-use-existing-source"
            >
              <History className="h-4 w-4" />
              {t("businessImport.upload.useExistingSource")}
            </Button>
          </div>
        ) : null}
        {catalogLoading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            {t("businessImport.upload.loadingPolicy")}
          </div>
        ) : null}

        {catalogError ? (
          <div
            className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3"
            role="alert"
          >
            <p className="text-sm font-medium text-rose-200">{catalogError.message}</p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => void loadTemplates()}
            >
              <RefreshCw className="h-4 w-4" />
              {t("businessImport.common.tryAgain")}
            </Button>
          </div>
        ) : null}

        {!catalogLoading && !catalogError && policies.length === 0 ? (
          <div
            className="rounded-md border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3"
            role="status"
          >
            <p className="text-sm font-medium text-amber-200">
              {t("businessImport.upload.unavailable")}
            </p>
          </div>
        ) : null}

        {policies.length > 0 ? (
          <>
            <div
              className={cn(
                "min-w-0 rounded-md border border-dashed border-white/15 bg-white/[0.025] p-5 transition-colors",
                file && "border-emerald-500/35 bg-emerald-500/[0.05]",
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!busy) selectFile(event.dataTransfer.files[0] ?? null);
              }}
              data-testid="business-import-dropzone"
            >
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
                    {file ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    ) : (
                      <FileSpreadsheet className="h-5 w-5 text-zinc-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-zinc-200">
                      {file ? file.name : t("businessImport.upload.choose")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {t("businessImport.upload.limit", {
                        formats: enabledFormats,
                        size: displayFileSize(selectedPolicy?.maxBytes ?? maximumBytes, localeTag),
                      })}
                    </p>
                  </div>
                </div>
                <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.07] focus-within:ring-2 focus-within:ring-emerald-500/30">
                  <Upload className="h-4 w-4" />
                  {t("businessImport.upload.browse")}
                  <input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    className="sr-only"
                    disabled={busy}
                    aria-label={t("businessImport.upload.inputLabel")}
                    onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {fileError ? (
                <p className="mt-3 text-xs text-rose-400" role="alert" aria-live="polite">
                  {fileError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-300">
                  {t("businessImport.upload.templateTitle")}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {t("businessImport.upload.templateDescription")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {templates.map((template) => (
                  <Button key={template.id} asChild variant="outline" size="sm">
                    <a href={template.downloadUrl ?? undefined} download={template.filename}>
                      <Download className="h-4 w-4" />
                      {template.format === "XLSX"
                        ? t("businessImport.upload.downloadXlsx")
                        : t("businessImport.upload.downloadCsv")}
                    </a>
                  </Button>
                ))}
              </div>
            </div>

            <p className="text-xs leading-5 text-sky-200/75">
              {t("businessImport.upload.draftBoundary")}
            </p>
          </>
        ) : null}

        {submitError ? (
          <div
            className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3"
            role="alert"
          >
            <p className="break-words text-sm text-rose-200">{submitError.message}</p>
            {submitError.requestId ? (
              <p className="mt-1 text-xs text-rose-300/55">
                {t("businessImport.common.request", { id: submitError.requestId })}
              </p>
            ) : null}
          </div>
        ) : null}

        {busy ? (
          <div
            className="flex items-center gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-400" />
            <span className="text-sm text-emerald-100">{phaseLabel}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
