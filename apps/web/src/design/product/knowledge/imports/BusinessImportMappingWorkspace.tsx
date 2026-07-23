"use client";

import * as React from "react";
import type {
  BusinessImportMappingColumnStatus,
  BusinessImportMappingConfirmRequest,
  BusinessImportMappingDefaults,
  BusinessImportMappingTarget,
  BusinessImportMappingView,
} from "@leadvirt/types";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleSlash2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Settings2,
  TriangleAlert,
  X,
} from "lucide-react";
import { localeOptions } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import type { ApiClientError } from "@/lib/api/client";
import { Button } from "../../../components/ui/Button";
import { cn } from "../../../lib/utils";
import { Select, StatusBadge, type SelectOption } from "../../ui";

const commonTargets: BusinessImportMappingTarget[] = [
  "IGNORE",
  "name",
  "description",
  "category",
  "price",
  "currency",
  "duration",
  "booking_notes",
  "active",
  "language",
];

const advancedTargets: BusinessImportMappingTarget[] = [
  "external_id",
  "price_type",
  "price_amount",
  "price_from",
  "price_to",
  "price_unit",
  "tax_note",
  "duration_minutes",
  "duration_max_minutes",
  "location_external_id",
  "valid_from",
  "valid_until",
];
const targets = [...commonTargets, ...advancedTargets];

const targetLabelKeys: Record<BusinessImportMappingTarget, TranslationKey> = {
  IGNORE: "businessImport.mapping.target.ignore",
  external_id: "businessImport.field.externalId",
  category: "businessImport.field.category",
  name: "businessImport.edit.name",
  description: "businessImport.edit.descriptionLabel",
  price: "businessImport.mapping.target.price",
  price_type: "businessImport.field.priceType",
  price_amount: "businessImport.field.amount",
  price_from: "businessImport.field.from",
  price_to: "businessImport.field.to",
  currency: "businessImport.edit.currency",
  price_unit: "businessImport.field.unit",
  tax_note: "businessImport.field.taxNote",
  duration: "businessImport.mapping.target.duration",
  duration_minutes: "businessImport.field.minimumMinutes",
  duration_max_minutes: "businessImport.field.maximumMinutes",
  location_external_id: "businessImport.field.locationExternalId",
  booking_notes: "businessImport.field.bookingNotes",
  active: "businessImport.field.active",
  valid_from: "businessImport.field.validFrom",
  valid_until: "businessImport.field.validUntil",
  language: "businessImport.field.language",
};

const priceTargets = new Set<BusinessImportMappingTarget>([
  "price",
  "price_amount",
  "price_from",
  "price_to",
]);
const priceLeafTargets = new Set<BusinessImportMappingTarget>([
  "price_type",
  "price_amount",
  "price_from",
  "price_to",
]);
const durationLeafTargets = new Set<BusinessImportMappingTarget>([
  "duration_minutes",
  "duration_max_minutes",
]);

const currencies = [
  ["EUR", "€"],
  ["USD", "$"],
  ["RUB", "₽"],
  ["GBP", "£"],
  ["UAH", "₴"],
  ["KZT", "₸"],
  ["AED", "د.إ"],
  ["TRY", "₺"],
  ["CNY", "¥"],
  ["JPY", "¥"],
  ["CHF", "CHF"],
  ["CAD", "C$"],
  ["AUD", "A$"],
  ["BRL", "R$"],
  ["INR", "₹"],
  ["PLN", "zł"],
] as const;

type TargetDraft = Record<string, BusinessImportMappingTarget | null>;

function initialTargets(mapping: BusinessImportMappingView): TargetDraft {
  const draft = Object.fromEntries(
    mapping.table.columns.map((column) => [
      column.sourceColumnKey,
      column.status === "CHECK_MAPPING" ? null : column.proposedTarget,
    ]),
  );
  const values = Object.values(draft);
  const compositePriceConflict =
    values.includes("price") && values.some((target) => target && priceLeafTargets.has(target));
  const compositeDurationConflict =
    values.includes("duration") &&
    values.some((target) => target && durationLeafTargets.has(target));
  if (compositePriceConflict || compositeDurationConflict) {
    for (const column of mapping.table.columns) {
      if (
        (compositePriceConflict && column.proposedTarget === "price") ||
        (compositeDurationConflict && column.proposedTarget === "duration")
      ) {
        draft[column.sourceColumnKey] = null;
      }
    }
  }
  return draft;
}

function mappingStatus(
  target: BusinessImportMappingTarget | null,
): BusinessImportMappingColumnStatus {
  if (target === null) return "CHECK_MAPPING";
  return target === "IGNORE" ? "NOT_USED" : "MATCHED";
}

function statusTone(status: BusinessImportMappingColumnStatus) {
  if (status === "MATCHED") return "success" as const;
  if (status === "CHECK_MAPPING") return "warning" as const;
  return "info" as const;
}

export function BusinessImportMappingWorkspace({
  mapping,
  loading,
  error,
  saveError,
  busy,
  canEdit,
  canCancel,
  onRetry,
  onEdit,
  onCancel,
  onConfirm,
}: {
  mapping: BusinessImportMappingView | null;
  loading: boolean;
  error: ApiClientError | null;
  saveError: ApiClientError | null;
  busy: boolean;
  canEdit: boolean;
  canCancel: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onConfirm: (request: BusinessImportMappingConfirmRequest) => void;
}) {
  const { formatNumber, t } = useI18n();
  const [selectedTargets, setSelectedTargets] = React.useState<TargetDraft>({});
  const [defaults, setDefaults] = React.useState<BusinessImportMappingDefaults>({
    locale: null,
    numberFormat: null,
    currency: null,
    timezone: null,
    unit: null,
  });
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const firstInvalidRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!mapping) return;
    setSelectedTargets(initialTargets(mapping));
    setDefaults(mapping.defaults);
    setShowAdvanced(false);
  }, [mapping]);

  if (loading && !mapping) {
    return (
      <div
        className="flex min-h-64 items-center justify-center gap-3 border-y border-white/10 text-sm text-zinc-400"
        role="status"
        data-testid="business-import-mapping-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
        {t("businessImport.mapping.loading")}
      </div>
    );
  }

  if (error && !mapping) {
    return (
      <div
        className="flex min-h-64 flex-col items-center justify-center gap-4 border-y border-rose-500/20 px-4 text-center"
        role="alert"
        data-testid="business-import-mapping-error"
      >
        <AlertCircle className="h-7 w-7 text-rose-400" />
        <p className="text-sm text-rose-200">
          {error.message || t("businessImport.mapping.loadError")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {t("businessImport.common.tryAgain")}
          </Button>
          {canCancel ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={onCancel}
              data-testid="business-import-mapping-cancel"
            >
              <X className="h-4 w-4" />
              {t("businessImport.processing.cancel")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!mapping) return null;

  const statuses = mapping.table.columns.map((column) =>
    mappingStatus(selectedTargets[column.sourceColumnKey] ?? null),
  );
  const matchedCount = statuses.filter((status) => status === "MATCHED").length;
  const checkCount = statuses.filter((status) => status === "CHECK_MAPPING").length;
  const notUsedCount = statuses.filter((status) => status === "NOT_USED").length;
  const selectedValues = Object.values(selectedTargets);
  const nameCount = selectedValues.filter((target) => target === "name").length;
  const hasPrice = selectedValues.some((target) => target !== null && priceTargets.has(target));
  const showCurrencyDefault = hasPrice;
  const currencyValid = defaults.currency === null || /^[A-Z]{3}$/u.test(defaults.currency);
  const incompatibleLeaves =
    (selectedValues.includes("price_amount") &&
      (selectedValues.includes("price_from") || selectedValues.includes("price_to"))) ||
    (selectedValues.includes("price_to") && !selectedValues.includes("price_from")) ||
    (selectedValues.includes("duration_max_minutes") &&
      !selectedValues.includes("duration_minutes"));
  const canConfirm =
    mapping.validation.canConfirm &&
    checkCount === 0 &&
    nameCount === 1 &&
    currencyValid &&
    !incompatibleLeaves;
  const showLocaleDefault = !selectedValues.includes("language");
  const showNumberFormat = hasPrice || selectedValues.includes("duration");
  const showUnitDefault = hasPrice && !selectedValues.includes("price_unit");

  const usedByTarget = new Map<BusinessImportMappingTarget, string>();
  for (const column of mapping.table.columns) {
    const target = selectedTargets[column.sourceColumnKey];
    if (target && target !== "IGNORE") usedByTarget.set(target, column.sourceColumnKey);
  }

  function targetOptions(sourceColumnKey: string): SelectOption[] {
    const selected = selectedTargets[sourceColumnKey];
    const visibleTargets = showAdvanced
      ? targets
      : [...commonTargets, ...(selected && advancedTargets.includes(selected) ? [selected] : [])];
    return [...new Set(visibleTargets)].map((target) => {
      const usedBy = usedByTarget.get(target);
      const otherTargets = Object.entries(selectedTargets)
        .filter(([key]) => key !== sourceColumnKey)
        .map(([, value]) => value);
      const semanticConflict =
        (target === "price" &&
          otherTargets.some((value) => value !== null && priceLeafTargets.has(value))) ||
        (priceLeafTargets.has(target) && otherTargets.includes("price")) ||
        (target === "duration" &&
          otherTargets.some((value) => value !== null && durationLeafTargets.has(value))) ||
        (durationLeafTargets.has(target) && otherTargets.includes("duration")) ||
        (target === "price_amount" &&
          otherTargets.some((value) => value === "price_from" || value === "price_to")) ||
        ((target === "price_from" || target === "price_to") &&
          otherTargets.includes("price_amount")) ||
        (target === "duration_max_minutes" && !otherTargets.includes("duration_minutes")) ||
        (target === "price_to" && !otherTargets.includes("price_from"));
      const alreadyUsed = target !== "IGNORE" && Boolean(usedBy && usedBy !== sourceColumnKey);
      const disabled = alreadyUsed || semanticConflict;
      return {
        value: target,
        disabled,
        label: disabled
          ? `${t(targetLabelKeys[target])} · ${t(
              alreadyUsed
                ? "businessImport.mapping.targetUsed"
                : "businessImport.mapping.targetConflict",
            )}`
          : t(targetLabelKeys[target]),
      };
    });
  }

  function updateTarget(sourceColumnKey: string, target: string) {
    onEdit();
    setSelectedTargets((current) => ({
      ...current,
      [sourceColumnKey]: target as BusinessImportMappingTarget,
    }));
  }

  function updateDefaults(next: Partial<BusinessImportMappingDefaults>) {
    onEdit();
    setDefaults((current) => ({ ...current, ...next }));
  }

  function submit() {
    if (!canEdit || busy || !canConfirm) {
      firstInvalidRef.current?.focus();
      return;
    }
    onConfirm({
      tableKey: mapping.table.tableKey,
      schemaHash: mapping.table.schemaHash,
      headerRow: mapping.table.headerRow,
      columns: mapping.table.columns.map((column) => ({
        sourceColumnKey: column.sourceColumnKey,
        target: selectedTargets[column.sourceColumnKey],
      })),
      defaults,
    });
  }

  function statusLabel(status: BusinessImportMappingColumnStatus) {
    if (status === "MATCHED") return t("businessImport.mapping.status.matched");
    if (status === "CHECK_MAPPING") return t("businessImport.mapping.status.check");
    return t("businessImport.mapping.status.notUsed");
  }

  function sourceColumnLabel(column: BusinessImportMappingView["table"]["columns"][number]) {
    return (
      column.header.trim() ||
      t("businessImport.mapping.columnNumber", {
        number: formatNumber(column.index),
      })
    );
  }

  function TargetControl({
    column,
    mobile = false,
  }: {
    column: BusinessImportMappingView["table"]["columns"][number];
    mobile?: boolean;
  }) {
    const value = selectedTargets[column.sourceColumnKey] ?? undefined;
    const status = mappingStatus(value ?? null);
    return (
      <div className={cn("min-w-0", mobile && "mt-3")}>
        <Select
          value={value}
          options={targetOptions(column.sourceColumnKey)}
          placeholder={t("businessImport.mapping.selectTarget")}
          disabled={!canEdit || busy}
          ariaLabel={t("businessImport.mapping.importColumnAs", {
            column: sourceColumnLabel(column),
          })}
          ariaInvalid={status === "CHECK_MAPPING"}
          testId={`business-import-mapping-target${mobile ? "-mobile" : ""}-${column.sourceColumnKey}`}
          className="rounded-md px-3"
          onValueChange={(next) => updateTarget(column.sourceColumnKey, next)}
        />
        {status === "CHECK_MAPPING" && column.proposedTarget !== "IGNORE" ? (
          <p className="mt-1.5 break-words text-xs text-amber-300">
            {t("businessImport.mapping.suggested", {
              field: t(targetLabelKeys[column.proposedTarget]),
            })}
          </p>
        ) : null}
      </div>
    );
  }

  function ExampleValues({
    examples,
  }: {
    examples: BusinessImportMappingView["table"]["columns"][number]["examples"];
  }) {
    if (examples.length === 0) {
      return (
        <span className="text-xs text-zinc-600">{t("businessImport.mapping.noExamples")}</span>
      );
    }
    return (
      <ul className="min-w-0 space-y-1">
        {examples.slice(0, 3).map((example, index) => (
          <li
            key={`${index}:${example}`}
            className="max-w-full truncate text-xs text-zinc-400"
            title={example}
          >
            {example}
          </li>
        ))}
      </ul>
    );
  }

  const blockingMessages = [
    !mapping.validation.canConfirm ? t("businessImport.mapping.serverValidationBlocked") : null,
    nameCount !== 1 ? t("businessImport.mapping.requiredName") : null,
    checkCount > 0 ? t("businessImport.mapping.reviewRequired") : null,
    !currencyValid ? t("businessImport.mapping.currencyInvalid") : null,
    incompatibleLeaves ? t("businessImport.mapping.incompatibleTargets") : null,
  ].filter((message): message is string => Boolean(message));

  const currencyOptions = [
    { value: "__NONE__", label: t("businessImport.mapping.noDefault") },
    ...(defaults.currency && !currencies.some(([value]) => value === defaults.currency)
      ? [{ value: defaults.currency, label: defaults.currency }]
      : []),
    ...currencies.map(([value, label]) => ({ value, label: `${value} · ${label}` })),
  ];
  const languageOptions = [
    { value: "__NONE__", label: t("businessImport.mapping.noDefault") },
    ...(defaults.locale && !localeOptions.some(({ value }) => value === defaults.locale)
      ? [{ value: defaults.locale, label: defaults.locale }]
      : []),
    ...localeOptions.map(({ value, label }) => ({ value, label })),
  ];
  const numberFormatOptions = [
    { value: "__NONE__", label: t("businessImport.mapping.numberFormatAuto") },
    { value: "DECIMAL_DOT", label: t("businessImport.mapping.numberFormatDot") },
    { value: "DECIMAL_COMMA", label: t("businessImport.mapping.numberFormatComma") },
  ];

  return (
    <section className="min-w-0" data-testid="business-import-mapping-workspace">
      <div className="flex min-w-0 flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-zinc-100">
                {t("businessImport.mapping.title")}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
                {t("businessImport.mapping.phaseOneDescription")}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" aria-label={t("businessImport.mapping.summary")}>
          <StatusBadge status="success">
            {t("businessImport.mapping.matchedCount", { count: formatNumber(matchedCount) })}
          </StatusBadge>
          {checkCount > 0 ? (
            <StatusBadge status="warning">
              {t("businessImport.mapping.checkCount", { count: formatNumber(checkCount) })}
            </StatusBadge>
          ) : null}
          <StatusBadge status="info">
            {t("businessImport.mapping.notUsedCount", { count: formatNumber(notUsedCount) })}
          </StatusBadge>
        </div>
      </div>

      {!canEdit ? (
        <div
          className="my-4 flex items-start gap-3 border-y border-sky-500/20 bg-sky-500/[0.06] px-4 py-3"
          role="status"
          data-testid="business-import-mapping-read-only"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div>
            <p className="text-sm font-medium text-sky-100">
              {t("businessImport.mapping.readOnlyTitle")}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-sky-200/65">
              {t("businessImport.mapping.readOnlyDescription")}
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="my-4 flex min-w-0 items-center justify-between gap-3 border-y border-amber-500/20 bg-amber-500/[0.06] px-4 py-3"
          role="alert"
          data-testid="business-import-mapping-refresh-error"
        >
          <p className="min-w-0 break-words text-sm text-amber-100">{error.message}</p>
          <Button variant="outline" size="sm" disabled={loading} onClick={onRetry}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("businessImport.common.tryAgain")}
          </Button>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 py-4 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-medium text-zinc-300">
            {t("businessImport.mapping.detectedTable")}
          </span>
          <span className="text-zinc-500">
            {t("businessImport.mapping.headerRow", {
              row: formatNumber(mapping.table.headerRow),
            })}
          </span>
          <span className="text-zinc-500">
            {t("businessImport.mapping.rowsDetected", {
              count: formatNumber(mapping.table.totalRows),
            })}
          </span>
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
            data-testid="business-import-mapping-advanced-toggle"
          >
            <Settings2 className="h-4 w-4" />
            {t(
              showAdvanced
                ? "businessImport.mapping.hideAdvanced"
                : "businessImport.mapping.showAdvanced",
            )}
          </Button>
        ) : null}
      </div>

      <div className="hidden min-w-0 lg:block">
        <table
          className="w-full table-fixed border-collapse"
          data-testid="business-import-mapping-table"
        >
          <thead>
            <tr className="border-b border-white/10 text-left text-xs font-medium text-zinc-500">
              <th className="w-[25%] px-3 py-3">{t("businessImport.mapping.sourceColumn")}</th>
              <th className="w-[35%] px-3 py-3">{t("businessImport.mapping.examples")}</th>
              <th className="w-[28%] px-3 py-3">{t("businessImport.mapping.importAs")}</th>
              <th className="w-[12%] px-3 py-3">{t("businessImport.mapping.statusLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {mapping.table.columns.map((column) => {
              const status = mappingStatus(selectedTargets[column.sourceColumnKey] ?? null);
              return (
                <tr
                  key={column.sourceColumnKey}
                  className="border-b border-white/[0.07] align-top"
                  data-testid={`business-import-mapping-column-${column.sourceColumnKey}`}
                >
                  <th scope="row" className="min-w-0 px-3 py-4 text-left">
                    <span className="block break-words text-sm font-medium text-zinc-200">
                      {sourceColumnLabel(column)}
                    </span>
                    <span className="mt-1 block text-xs font-normal text-zinc-600">
                      {t("businessImport.mapping.columnNumber", {
                        number: formatNumber(column.index),
                      })}
                    </span>
                  </th>
                  <td className="min-w-0 px-3 py-4">
                    <ExampleValues examples={column.examples} />
                  </td>
                  <td className="min-w-0 px-3 py-4">
                    <TargetControl column={column} />
                  </td>
                  <td className="px-3 py-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium",
                        status === "MATCHED"
                          ? "text-emerald-300"
                          : status === "CHECK_MAPPING"
                            ? "text-amber-300"
                            : "text-zinc-500",
                      )}
                    >
                      {status === "MATCHED" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      ) : status === "CHECK_MAPPING" ? (
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CircleSlash2 className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {statusLabel(status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="divide-y divide-white/[0.07] lg:hidden"
        data-testid="business-import-mapping-mobile"
      >
        {mapping.table.columns.map((column) => {
          const status = mappingStatus(selectedTargets[column.sourceColumnKey] ?? null);
          return (
            <div
              key={column.sourceColumnKey}
              className="min-w-0 py-5"
              data-testid={`business-import-mapping-card-${column.sourceColumnKey}`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-zinc-200">
                    {sourceColumnLabel(column)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {t("businessImport.mapping.columnNumber", {
                      number: formatNumber(column.index),
                    })}
                  </p>
                </div>
                <StatusBadge status={statusTone(status)}>{statusLabel(status)}</StatusBadge>
              </div>
              <div className="mt-3 min-w-0">
                <p className="mb-1.5 text-xs font-medium text-zinc-500">
                  {t("businessImport.mapping.examples")}
                </p>
                <ExampleValues examples={column.examples} />
              </div>
              <TargetControl column={column} mobile />
            </div>
          );
        })}
      </div>

      {(showCurrencyDefault || showLocaleDefault || showNumberFormat || showUnitDefault) &&
      canEdit ? (
        <div
          className="border-t border-white/10 py-5"
          data-testid="business-import-mapping-defaults"
        >
          <h3 className="text-sm font-semibold text-zinc-200">
            {t("businessImport.mapping.defaultsTitle")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {t("businessImport.mapping.defaultsDescription")}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {showCurrencyDefault ? (
              <label className="min-w-0 text-xs font-medium text-zinc-400">
                {t("businessImport.mapping.defaultCurrency")}
                <Select
                  value={defaults.currency ?? "__NONE__"}
                  options={currencyOptions}
                  disabled={busy}
                  ariaLabel={t("businessImport.mapping.defaultCurrency")}
                  testId="business-import-mapping-default-currency"
                  className="mt-2 rounded-md"
                  onValueChange={(currency) =>
                    updateDefaults({ currency: currency === "__NONE__" ? null : currency })
                  }
                />
              </label>
            ) : null}
            {showLocaleDefault ? (
              <label className="min-w-0 text-xs font-medium text-zinc-400">
                {t("businessImport.mapping.defaultLocale")}
                <Select
                  value={defaults.locale ?? "__NONE__"}
                  options={languageOptions}
                  disabled={busy}
                  ariaLabel={t("businessImport.mapping.defaultLocale")}
                  testId="business-import-mapping-default-locale"
                  className="mt-2 rounded-md"
                  onValueChange={(locale) =>
                    updateDefaults({ locale: locale === "__NONE__" ? null : locale })
                  }
                />
              </label>
            ) : null}
            {showNumberFormat ? (
              <label className="min-w-0 text-xs font-medium text-zinc-400">
                {t("businessImport.mapping.numberFormat")}
                <Select
                  value={defaults.numberFormat ?? "__NONE__"}
                  options={numberFormatOptions}
                  disabled={busy}
                  ariaLabel={t("businessImport.mapping.numberFormat")}
                  testId="business-import-mapping-number-format"
                  className="mt-2 rounded-md"
                  onValueChange={(numberFormat) =>
                    updateDefaults({
                      numberFormat:
                        numberFormat === "__NONE__"
                          ? null
                          : (numberFormat as BusinessImportMappingDefaults["numberFormat"]),
                    })
                  }
                />
              </label>
            ) : null}
            {showUnitDefault ? (
              <label className="min-w-0 text-xs font-medium text-zinc-400">
                {t("businessImport.mapping.defaultUnit")}
                <input
                  value={defaults.unit ?? ""}
                  maxLength={80}
                  disabled={busy}
                  placeholder={t("businessImport.mapping.defaultUnitPlaceholder")}
                  data-testid="business-import-mapping-default-unit"
                  className="mt-2 min-h-11 w-full rounded-md border border-white/10 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50"
                  onChange={(event) =>
                    updateDefaults({ unit: event.target.value.trimStart() || null })
                  }
                  onBlur={() =>
                    setDefaults((current) => ({
                      ...current,
                      unit: current.unit?.trim() || null,
                    }))
                  }
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {saveError ? (
        <div
          className="mt-4 flex min-w-0 items-start gap-3 border-y border-rose-500/20 bg-rose-500/[0.06] px-4 py-3"
          role="alert"
          data-testid="business-import-mapping-save-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <p className="min-w-0 break-words text-sm text-rose-200">{saveError.message}</p>
        </div>
      ) : null}

      {canEdit ? (
        <div
          className="sticky bottom-16 z-10 mt-5 flex min-w-0 flex-col gap-3 border-t border-white/10 bg-zinc-950/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-0"
          data-testid="business-import-mapping-actions"
        >
          <div
            ref={firstInvalidRef}
            tabIndex={-1}
            className="min-w-0 outline-none"
            role={blockingMessages.length > 0 ? "alert" : "status"}
          >
            {blockingMessages.length > 0 ? (
              <ul className="space-y-1 text-xs text-amber-300">
                {blockingMessages.map((message) => (
                  <li key={message} className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-xs text-emerald-300">
                <Check className="h-3.5 w-3.5" />
                {t("businessImport.mapping.ready")}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            {canCancel ? (
              <Button
                variant="outline"
                className="min-h-11 shrink-0"
                disabled={busy}
                onClick={onCancel}
                data-testid="business-import-mapping-cancel"
              >
                <X className="h-4 w-4" />
                {t("businessImport.processing.cancel")}
              </Button>
            ) : null}
            <Button
              className="min-h-11 shrink-0"
              disabled={!canConfirm || busy}
              onClick={submit}
              data-testid="business-import-mapping-confirm"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {busy ? t("businessImport.mapping.saving") : t("businessImport.mapping.confirm")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
