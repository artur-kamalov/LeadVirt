"use client";

import * as React from "react";
import type {
  KnowledgeV2Audience,
  KnowledgeV2CreateFactRequest,
  KnowledgeV2FactView,
  KnowledgeV2JsonValue,
  KnowledgeV2RiskLevel,
  KnowledgeV2UpdateFactRequest,
  KnowledgeV2VerificationStatus,
} from "@leadvirt/types";
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  FileText,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { ApiClientError } from "@/lib/api/client";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";
import {
  createKnowledgeV2Fact,
  createKnowledgeV2IdempotencyKey,
  listKnowledgeV2Facts,
  rejectKnowledgeV2Fact,
  updateKnowledgeV2Fact,
  verifyKnowledgeV2Fact,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog, EmptyState, LoadingOverlay, Modal, Select, StatusBadge } from "../ui";

type FactKind =
  | "BUSINESS_NAME"
  | "CONTACT"
  | "ADDRESS"
  | "SERVICE"
  | "PRICE"
  | "DURATION"
  | "HOURS"
  | "POLICY";

type FilterValue<T extends string> = "ALL" | T;

interface FactForm {
  kind: FactKind;
  subject: string;
  value: string;
  displayValue: string;
  currency: string;
  timeZone: string;
  locale: string;
  effectiveUntil: string;
  audience: KnowledgeV2Audience;
  riskLevel: KnowledgeV2RiskLevel;
  changeReason: string;
}

interface EditorState {
  mode: "create" | "edit";
  fact: KnowledgeV2FactView | null;
  form: FactForm;
  fieldErrors: Record<string, string>;
  error: string | null;
  conflict: boolean;
  saving: boolean;
}

interface KindConfig {
  labelKey: TranslationKey;
  valueLabelKey: TranslationKey;
  valuePlaceholderKey: TranslationKey;
  entityType: string;
  fieldType: string;
  needsSubject: boolean;
  multiline: boolean;
  defaultRisk: KnowledgeV2RiskLevel;
}

const KIND_CONFIG: Record<FactKind, KindConfig> = {
  BUSINESS_NAME: {
    labelKey: "knowledge.business.kind.businessName.label",
    valueLabelKey: "knowledge.business.kind.businessName.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.businessName.placeholder",
    entityType: "BUSINESS_PROFILE",
    fieldType: "TEXT",
    needsSubject: false,
    multiline: false,
    defaultRisk: "LOW",
  },
  CONTACT: {
    labelKey: "knowledge.business.kind.contact.label",
    valueLabelKey: "knowledge.business.kind.contact.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.contact.placeholder",
    entityType: "BUSINESS_PROFILE",
    fieldType: "CONTACT",
    needsSubject: false,
    multiline: false,
    defaultRisk: "MEDIUM",
  },
  ADDRESS: {
    labelKey: "knowledge.business.kind.address.label",
    valueLabelKey: "knowledge.business.kind.address.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.address.placeholder",
    entityType: "LOCATION",
    fieldType: "ADDRESS",
    needsSubject: false,
    multiline: true,
    defaultRisk: "MEDIUM",
  },
  SERVICE: {
    labelKey: "knowledge.business.kind.service.label",
    valueLabelKey: "knowledge.business.kind.service.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.service.placeholder",
    entityType: "CATALOG_ITEM",
    fieldType: "TEXT",
    needsSubject: true,
    multiline: true,
    defaultRisk: "LOW",
  },
  PRICE: {
    labelKey: "knowledge.business.kind.price.label",
    valueLabelKey: "knowledge.business.kind.price.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.price.placeholder",
    entityType: "CATALOG_ITEM",
    fieldType: "MONEY",
    needsSubject: true,
    multiline: false,
    defaultRisk: "HIGH",
  },
  DURATION: {
    labelKey: "knowledge.business.kind.duration.label",
    valueLabelKey: "knowledge.business.kind.duration.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.duration.placeholder",
    entityType: "CATALOG_ITEM",
    fieldType: "DURATION",
    needsSubject: true,
    multiline: false,
    defaultRisk: "MEDIUM",
  },
  HOURS: {
    labelKey: "knowledge.business.kind.hours.label",
    valueLabelKey: "knowledge.business.kind.hours.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.hours.placeholder",
    entityType: "BUSINESS_HOURS",
    fieldType: "SCHEDULE",
    needsSubject: false,
    multiline: true,
    defaultRisk: "HIGH",
  },
  POLICY: {
    labelKey: "knowledge.business.kind.policy.label",
    valueLabelKey: "knowledge.business.kind.policy.valueLabel",
    valuePlaceholderKey: "knowledge.business.kind.policy.placeholder",
    entityType: "POLICY",
    fieldType: "POLICY_TEXT",
    needsSubject: true,
    multiline: true,
    defaultRisk: "HIGH",
  },
};

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type FormatDate = (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;

const VERIFICATION_KEYS: Record<KnowledgeV2VerificationStatus, TranslationKey> = {
  UNVERIFIED: "knowledge.business.verification.unverified",
  PENDING_REVIEW: "knowledge.business.verification.pendingReview",
  VERIFIED: "knowledge.business.verification.verified",
  REJECTED: "knowledge.business.verification.rejected",
  CONFLICTED: "knowledge.business.verification.conflicted",
};
const RISK_KEYS: Record<KnowledgeV2RiskLevel, TranslationKey> = {
  LOW: "knowledge.business.risk.low",
  MEDIUM: "knowledge.business.risk.medium",
  HIGH: "knowledge.business.risk.high",
  CRITICAL: "knowledge.business.risk.critical",
};
const AUDIENCE_KEYS: Record<KnowledgeV2Audience, TranslationKey> = {
  PUBLIC: "knowledge.business.audience.public",
  AUTHENTICATED_CUSTOMER: "knowledge.business.audience.authenticatedCustomer",
  INTERNAL: "knowledge.business.audience.internal",
};
const AUTHORITY_KEYS: Record<KnowledgeV2FactView["authority"], TranslationKey> = {
  INFERRED: "knowledge.business.authority.inferred",
  IMPORTED: "knowledge.business.authority.imported",
  MANUAL: "knowledge.business.authority.manual",
  TRUSTED_SOURCE: "knowledge.business.authority.trustedSource",
  OWNER_VERIFIED: "knowledge.business.authority.ownerVerified",
};
const LOCALE_BEHAVIOR_KEYS: Record<KnowledgeV2FactView["localeBehavior"], TranslationKey> = {
  LANGUAGE_NEUTRAL: "knowledge.business.localeBehavior.languageNeutral",
  LOCALIZED: "knowledge.business.localeBehavior.localized",
  LOCALE_SPECIFIC: "knowledge.business.localeBehavior.localeSpecific",
};
const LIFECYCLE_KEYS: Record<KnowledgeV2FactView["lifecycleStatus"], TranslationKey> = {
  DRAFT: "knowledge.business.lifecycle.draft",
  PUBLISHED: "knowledge.business.lifecycle.published",
  ARCHIVED: "knowledge.business.lifecycle.archived",
};
const ENTITY_KEYS: Partial<Record<string, TranslationKey>> = {
  BUSINESS_PROFILE: "knowledge.business.entity.businessProfile",
  LOCATION: "knowledge.business.entity.location",
  CATALOG_ITEM: "knowledge.business.entity.catalogItem",
  BUSINESS_HOURS: "knowledge.business.entity.businessHours",
  POLICY: "knowledge.business.entity.policy",
};
const FIELD_TYPE_KEYS: Partial<Record<string, TranslationKey>> = {
  TEXT: "knowledge.business.fieldType.text",
  CONTACT: "knowledge.business.fieldType.contact",
  ADDRESS: "knowledge.business.fieldType.address",
  MONEY: "knowledge.business.fieldType.money",
  DURATION: "knowledge.business.fieldType.duration",
  SCHEDULE: "knowledge.business.fieldType.schedule",
  POLICY_TEXT: "knowledge.business.fieldType.policyText",
};

const inputClassName =
  "h-10 w-full min-w-0 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60";
const textAreaClassName = `${inputClassName} h-auto min-h-24 resize-y py-2.5`;

function emptyForm(kind: FactKind = "BUSINESS_NAME"): FactForm {
  return {
    kind,
    subject: "",
    value: "",
    displayValue: "",
    currency: "USD",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    locale: "en",
    effectiveUntil: "",
    audience: "PUBLIC",
    riskLevel: KIND_CONFIG[kind].defaultRisk,
    changeReason: "",
  };
}

function humanize(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function titleCase(value: string) {
  const normalized = humanize(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function translatedOrTitle(
  value: string,
  keys: Partial<Record<string, TranslationKey>>,
  t: Translate,
) {
  const key = keys[value];
  return key ? t(key) : titleCase(value);
}

function safeDate(value: string, formatDate: FormatDate) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return formatDate(date, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isScalar(value: KnowledgeV2JsonValue): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function valueSummary(fact: KnowledgeV2FactView, t: Translate) {
  if (fact.displayValue?.trim()) return fact.displayValue;
  if (isScalar(fact.normalizedValue)) return String(fact.normalizedValue);
  if (Array.isArray(fact.normalizedValue)) {
    const count = fact.normalizedValue.length;
    return t(
      count === 1
        ? "knowledge.business.summary.items.one"
        : "knowledge.business.summary.items.many",
      { count },
    );
  }
  if (fact.normalizedValue === null) return t("knowledge.business.summary.noValue");
  const count = Object.keys(fact.normalizedValue).length;
  return t(
    count === 1
      ? "knowledge.business.summary.fields.one"
      : "knowledge.business.summary.fields.many",
    { count },
  );
}

function inferKind(fact: KnowledgeV2FactView): FactKind {
  const key = fact.factKey.toLowerCase();
  const fieldType = fact.fieldType.toUpperCase();
  if (fieldType === "MONEY" || key.includes("price")) return "PRICE";
  if (fieldType === "DURATION" || key.includes("duration")) return "DURATION";
  if (fieldType === "SCHEDULE" || key.includes("hours")) return "HOURS";
  if (fieldType === "POLICY_TEXT" || key.startsWith("policy/")) return "POLICY";
  if (fieldType === "CONTACT" || key.includes("contact")) return "CONTACT";
  if (fieldType === "ADDRESS" || key.includes("address")) return "ADDRESS";
  if (key.startsWith("service/")) return "SERVICE";
  return "BUSINESS_NAME";
}

function subjectFromFact(fact: KnowledgeV2FactView, kind: FactKind) {
  if (!KIND_CONFIG[kind].needsSubject) return "";
  const parts = fact.factKey.split("/");
  if (parts.length < 2) return fact.factKey;
  const encoded = parts[1].replaceAll("-", " ").replaceAll("_", " ");
  return encoded.charAt(0).toUpperCase() + encoded.slice(1);
}

function dateTimeLocalValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function effectiveUntilIso(value: string, existing?: string | null) {
  if (!value.trim()) return null;
  if (existing && value === dateTimeLocalValue(existing)) return existing;
  return new Date(value).toISOString();
}

function formFromFact(fact: KnowledgeV2FactView): FactForm {
  const kind = inferKind(fact);
  return {
    kind,
    subject: subjectFromFact(fact, kind),
    value: isScalar(fact.normalizedValue) ? String(fact.normalizedValue) : "",
    displayValue: fact.displayValue ?? "",
    currency: fact.currency ?? "USD",
    timeZone: fact.timeZone ?? "UTC",
    locale: fact.locale ?? "en",
    effectiveUntil: dateTimeLocalValue(fact.effectiveUntil),
    audience: fact.scope.audiences[0] ?? "PUBLIC",
    riskLevel: fact.riskLevel,
    changeReason: "",
  };
}

function slug(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (normalized) return normalized;
  return encodeURIComponent(value.trim()).replaceAll("%", "").toLowerCase().slice(0, 80);
}

function factKeyFor(form: FactForm) {
  const subject = slug(form.subject);
  switch (form.kind) {
    case "BUSINESS_NAME":
      return "business/name";
    case "CONTACT":
      return "business/contact";
    case "ADDRESS":
      return "business/address";
    case "SERVICE":
      return `service/${subject}/description`;
    case "PRICE":
      return `service/${subject}/base-price`;
    case "DURATION":
      return `service/${subject}/duration`;
    case "HOURS":
      return "business/hours/regular";
    case "POLICY":
      return `policy/${subject}`;
  }
}

function localeBehavior(kind: FactKind) {
  return kind === "PRICE" || kind === "DURATION" || kind === "CONTACT"
    ? ("LANGUAGE_NEUTRAL" as const)
    : ("LOCALIZED" as const);
}

function normalizedFormValue(form: FactForm, existing?: KnowledgeV2FactView): KnowledgeV2JsonValue {
  if (form.kind === "DURATION") return Number(form.value);
  if (form.kind === "PRICE") return Number(form.value);
  if (existing && typeof existing.normalizedValue === "number") return Number(form.value);
  if (existing && typeof existing.normalizedValue === "boolean") {
    return form.value.trim().toLowerCase() === "true";
  }
  return form.value.trim();
}

function validateForm(editor: EditorState, t: Translate) {
  const { form, fact } = editor;
  const config = KIND_CONFIG[form.kind];
  const errors: Record<string, string> = {};
  const canEditValue = !fact || isScalar(fact.normalizedValue);

  if (config.needsSubject && !form.subject.trim())
    errors.subject = t("knowledge.business.validation.subjectRequired");
  if (config.needsSubject && form.subject.trim() && !slug(form.subject)) {
    errors.subject = t("knowledge.business.validation.subjectInvalid");
  }
  if (canEditValue && !form.value.trim())
    errors.value = t("knowledge.business.validation.valueRequired");
  if (canEditValue && form.kind === "PRICE" && !/^\d+(?:\.\d+)?$/.test(form.value.trim())) {
    errors.value = t("knowledge.business.validation.priceFormat");
  }
  if (canEditValue && form.kind === "PRICE" && Number(form.value) <= 0)
    errors.value = t("knowledge.business.validation.pricePositive");
  if (form.kind === "PRICE" && !/^[A-Za-z]{3}$/.test(form.currency.trim())) {
    errors.currency = t("knowledge.business.validation.currency");
  }
  if (
    canEditValue &&
    form.kind === "DURATION" &&
    (!Number.isFinite(Number(form.value)) || Number(form.value) <= 0)
  ) {
    errors.value = t("knowledge.business.validation.durationPositive");
  }
  if (fact && typeof fact.normalizedValue === "number" && !Number.isFinite(Number(form.value))) {
    errors.value = t("knowledge.business.validation.number");
  }
  if (
    fact &&
    typeof fact.normalizedValue === "boolean" &&
    !["true", "false"].includes(form.value.trim().toLowerCase())
  ) {
    errors.value = t("knowledge.business.validation.boolean");
  }
  if (!form.locale.trim()) errors.locale = t("knowledge.business.validation.locale");
  if (form.kind === "HOURS" && !form.timeZone.trim())
    errors.timeZone = t("knowledge.business.validation.timeZone");
  const requiresExpiry = form.riskLevel === "HIGH" || form.riskLevel === "CRITICAL";
  if (requiresExpiry && !form.effectiveUntil.trim()) {
    errors.effectiveUntil = t("knowledge.business.validation.highRiskExpiry");
  } else if (form.effectiveUntil.trim()) {
    const effectiveUntil = new Date(form.effectiveUntil);
    if (Number.isNaN(effectiveUntil.valueOf())) {
      errors.effectiveUntil = t("knowledge.business.validation.expiryInvalid");
    } else if (requiresExpiry && effectiveUntil.valueOf() <= Date.now()) {
      errors.effectiveUntil = t("knowledge.business.validation.expiryFuture");
    }
  }
  return errors;
}

function createBody(form: FactForm): KnowledgeV2CreateFactRequest {
  const config = KIND_CONFIG[form.kind];
  const behavior = localeBehavior(form.kind);
  return {
    factKey: factKeyFor(form),
    entityType: config.entityType,
    fieldType: config.fieldType,
    normalizedValue: normalizedFormValue(form),
    displayValue: form.displayValue.trim() || null,
    unit: form.kind === "DURATION" ? "minutes" : null,
    currency: form.kind === "PRICE" ? form.currency.trim().toUpperCase() : null,
    timeZone: form.kind === "HOURS" ? form.timeZone.trim() : null,
    locale: behavior === "LANGUAGE_NEUTRAL" ? null : form.locale.trim(),
    localeBehavior: behavior,
    scope: { audiences: [form.audience] },
    effectiveUntil: effectiveUntilIso(form.effectiveUntil),
    riskLevel: form.riskLevel,
    authority: "MANUAL",
  };
}

function updateBody(form: FactForm, fact: KnowledgeV2FactView): KnowledgeV2UpdateFactRequest {
  const currentAudience = fact.scope.audiences[0] ?? "PUBLIC";
  const audienceChanged = form.audience !== currentAudience;
  const body: KnowledgeV2UpdateFactRequest = {
    displayValue: form.displayValue.trim() || null,
    currency: form.kind === "PRICE" ? form.currency.trim().toUpperCase() : fact.currency,
    timeZone: form.kind === "HOURS" ? form.timeZone.trim() : fact.timeZone,
    locale: fact.localeBehavior === "LANGUAGE_NEUTRAL" ? null : form.locale.trim(),
    scope:
      fact.scope.usesTenantDefault && !audienceChanged
        ? null
        : {
            brandIds: fact.scope.brandIds,
            locationIds: fact.scope.locationIds,
            channelTypes: fact.scope.channelTypes,
            assistantIds: fact.scope.assistantIds,
            audiences: [form.audience],
            segments: fact.scope.segments,
            locales: fact.scope.locales,
          },
    effectiveUntil: effectiveUntilIso(form.effectiveUntil, fact.effectiveUntil),
    riskLevel: form.riskLevel,
    changeReason: form.changeReason.trim() || null,
  };
  if (isScalar(fact.normalizedValue)) body.normalizedValue = normalizedFormValue(form, fact);
  return body;
}

function errorMessage(error: unknown, t: Translate) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return t("knowledge.business.error.request");
}

function apiFieldErrors(error: unknown) {
  if (!(error instanceof ApiClientError)) return {};
  const errors: Record<string, string> = {};
  for (const item of error.fieldErrors ?? []) errors[item.field] = item.message;
  if (error.field && !errors[error.field]) errors[error.field] = error.message;
  if (errors.normalizedValue && !errors.value) errors.value = errors.normalizedValue;
  if (errors.factKey && !errors.subject) errors.subject = errors.factKey;
  return errors;
}

function isRevisionConflict(error: unknown) {
  return (
    error instanceof ApiClientError && (error.status === 412 || error.code === "REVISION_CONFLICT")
  );
}

function riskTone(risk: KnowledgeV2RiskLevel) {
  if (risk === "LOW") return "success" as const;
  if (risk === "MEDIUM") return "info" as const;
  if (risk === "HIGH") return "warning" as const;
  return "error" as const;
}

function verificationTone(status: KnowledgeV2VerificationStatus) {
  if (status === "VERIFIED") return "success" as const;
  if (status === "REJECTED" || status === "CONFLICTED") return "error" as const;
  if (status === "PENDING_REVIEW") return "warning" as const;
  return "info" as const;
}

function matchesSearch(fact: KnowledgeV2FactView, query: string, t: Translate) {
  if (!query) return true;
  const value = query.toLowerCase();
  return [
    fact.factKey,
    fact.entityType,
    fact.fieldType,
    fact.displayValue ?? "",
    valueSummary(fact, t),
  ]
    .join(" ")
    .toLowerCase()
    .includes(value);
}

export function BusinessFactsEditor({
  canEdit,
  canVerifyHighRisk,
  onChanged,
}: {
  canEdit: boolean;
  canVerifyHighRisk: boolean;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [facts, setFacts] = React.useState<KnowledgeV2FactView[]>([]);
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [riskFilter, setRiskFilter] = React.useState<FilterValue<KnowledgeV2RiskLevel>>("ALL");
  const [verificationFilter, setVerificationFilter] =
    React.useState<FilterValue<KnowledgeV2VerificationStatus>>("ALL");
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = React.useState(false);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<KnowledgeV2FactView | null>(null);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const requestSequence = React.useRef(0);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadFacts = React.useCallback(
    async (cursor?: string | null, append = false, silent = false) => {
      const sequence = ++requestSequence.current;
      if (append) setLoadingMore(true);
      else if (!silent) setLoading(true);
      setListError(null);
      try {
        const page = await listKnowledgeV2Facts({
          cursor: cursor ?? undefined,
          limit: 50,
          query: query || undefined,
          riskLevel: riskFilter === "ALL" ? undefined : riskFilter,
          verificationStatus: verificationFilter === "ALL" ? undefined : verificationFilter,
        });
        if (sequence !== requestSequence.current) return;
        setPermissionDenied(false);
        setFacts((current) => {
          if (!append) return page.items;
          const merged = new Map(current.map((fact) => [fact.id, fact]));
          for (const fact of page.items) merged.set(fact.id, fact);
          return [...merged.values()];
        });
        setNextCursor(page.pageInfo.nextCursor);
      } catch (error) {
        if (sequence !== requestSequence.current) return;
        if (error instanceof ApiClientError && error.status === 403) {
          setPermissionDenied(true);
          setFacts([]);
        } else {
          setListError(errorMessage(error, t));
        }
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [query, riskFilter, t, verificationFilter],
  );

  React.useEffect(() => {
    void loadFacts();
  }, [loadFacts]);

  const factPassesCurrentFilters = React.useCallback(
    (fact: KnowledgeV2FactView) =>
      (riskFilter === "ALL" || fact.riskLevel === riskFilter) &&
      (verificationFilter === "ALL" || fact.verificationStatus === verificationFilter) &&
      matchesSearch(fact, query, t),
    [query, riskFilter, t, verificationFilter],
  );

  const applyMutation = React.useCallback(
    (fact: KnowledgeV2FactView, allowInsert: boolean) => {
      setFacts((current) => {
        const exists = current.some((item) => item.id === fact.id);
        if (!exists && (!allowInsert || !factPassesCurrentFilters(fact))) return current;
        if (!factPassesCurrentFilters(fact)) return current.filter((item) => item.id !== fact.id);
        return exists
          ? current.map((item) => (item.id === fact.id ? fact : item))
          : [fact, ...current];
      });
    },
    [factPassesCurrentFilters],
  );

  function openCreate() {
    if (!canEdit) return;
    setEditor({
      mode: "create",
      fact: null,
      form: emptyForm(),
      fieldErrors: {},
      error: null,
      conflict: false,
      saving: false,
    });
  }

  function openEdit(fact: KnowledgeV2FactView, conflict = false, message?: string) {
    if (!canEdit || (!conflict && !fact.allowedActions.includes("EDIT"))) return;
    setEditor({
      mode: "edit",
      fact,
      form: formFromFact(fact),
      fieldErrors: {},
      error: message ?? null,
      conflict,
      saving: false,
    });
  }

  function setFormField<K extends keyof FactForm>(field: K, value: FactForm[K]) {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        form: { ...current.form, [field]: value },
        fieldErrors: { ...current.fieldErrors, [field]: "" },
        error: null,
      };
    });
  }

  function changeKind(kind: FactKind) {
    setEditor((current) => {
      if (!current || current.mode !== "create") return current;
      const next = emptyForm(kind);
      return {
        ...current,
        form: {
          ...next,
          locale: current.form.locale,
          audience: current.form.audience,
        },
        fieldErrors: {},
        error: null,
      };
    });
  }

  async function submitEditor() {
    if (!editor || editor.saving || !canEdit) return;
    if (editor.mode === "edit" && !editor.fact?.allowedActions.includes("EDIT")) {
      setEditor({ ...editor, error: t("knowledge.business.error.notEditable") });
      return;
    }
    const fieldErrors = validateForm(editor, t);
    if (Object.keys(fieldErrors).length > 0) {
      setEditor({ ...editor, fieldErrors, error: t("knowledge.business.error.reviewFields") });
      return;
    }

    setEditor({ ...editor, saving: true, error: null, fieldErrors: {} });
    try {
      const idempotencyKey = createKnowledgeV2IdempotencyKey();
      const response =
        editor.mode === "create"
          ? await createKnowledgeV2Fact(createBody(editor.form), {
              "Idempotency-Key": idempotencyKey,
            })
          : await updateKnowledgeV2Fact(editor.fact.id, updateBody(editor.form, editor.fact), {
              "Idempotency-Key": idempotencyKey,
              "If-Match": editor.fact.etag,
            });
      const saved = response.data.resource;
      applyMutation(saved, editor.mode === "create");
      setEditor(null);
      setActionError(null);
      setAnnouncement(
        editor.mode === "create"
          ? t("knowledge.business.announcement.created")
          : t("knowledge.business.announcement.updated"),
      );
      onChanged?.();
      void loadFacts(undefined, false, true);
    } catch (error) {
      setEditor((current) => {
        if (!current) return current;
        return {
          ...current,
          saving: false,
          conflict: isRevisionConflict(error),
          error: isRevisionConflict(error)
            ? t("knowledge.business.error.conflictSave")
            : errorMessage(error, t),
          fieldErrors: apiFieldErrors(error),
        };
      });
    }
  }

  async function reloadCurrentFact() {
    if (!editor?.fact || editor.saving) return;
    const stale = editor.fact;
    setEditor({ ...editor, saving: true, error: null });
    try {
      const page = await listKnowledgeV2Facts({ query: stale.factKey, limit: 100 });
      const currentFact = page.items.find((fact) => fact.id === stale.id);
      if (!currentFact) throw new Error(t("knowledge.business.error.currentUnavailable"));
      applyMutation(currentFact, false);
      setEditor({
        mode: "edit",
        fact: currentFact,
        form: formFromFact(currentFact),
        fieldErrors: {},
        error: null,
        conflict: false,
        saving: false,
      });
      setAnnouncement(t("knowledge.business.announcement.reloaded"));
    } catch (error) {
      setEditor((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: errorMessage(error, t),
            }
          : current,
      );
    }
  }

  async function verifyFact(fact: KnowledgeV2FactView) {
    const isHighRisk = fact.riskLevel === "HIGH" || fact.riskLevel === "CRITICAL";
    if (
      !canEdit ||
      !fact.allowedActions.includes("VERIFY") ||
      (isHighRisk && !canVerifyHighRisk) ||
      busyAction
    ) {
      return;
    }
    setBusyAction(`${fact.id}:verify`);
    setActionError(null);
    try {
      const response = await verifyKnowledgeV2Fact(
        fact.id,
        {},
        {
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
          "If-Match": fact.etag,
        },
      );
      applyMutation(response.data.resource, false);
      setAnnouncement(t("knowledge.business.announcement.verified"));
      onChanged?.();
      void loadFacts(undefined, false, true);
    } catch (error) {
      if (isRevisionConflict(error)) {
        openEdit(fact, true, t("knowledge.business.error.verifyConflict"));
      } else {
        setActionError(errorMessage(error, t));
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function rejectFact(fact: KnowledgeV2FactView) {
    if (!canEdit || !fact.allowedActions.includes("REJECT") || busyAction) return;
    setBusyAction(`${fact.id}:reject`);
    setActionError(null);
    try {
      const response = await rejectKnowledgeV2Fact(
        fact.id,
        {},
        {
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
          "If-Match": fact.etag,
        },
      );
      applyMutation(response.data.resource, false);
      setAnnouncement(t("knowledge.business.announcement.rejected"));
      onChanged?.();
      void loadFacts(undefined, false, true);
    } catch (error) {
      if (isRevisionConflict(error)) {
        openEdit(fact, true, t("knowledge.business.error.rejectConflict"));
      } else {
        setActionError(errorMessage(error, t));
      }
    } finally {
      setBusyAction(null);
    }
  }

  const showInitialLoading = loading && facts.length === 0 && !listError && !permissionDenied;
  const verificationOptions = [
    { value: "ALL", label: t("knowledge.business.verification.all") },
    ...Object.entries(VERIFICATION_KEYS).map(([value, key]) => ({ value, label: t(key) })),
  ];
  const riskOptions = [
    { value: "ALL", label: t("knowledge.business.risk.all") },
    ...Object.entries(RISK_KEYS).map(([value, key]) => ({
      value,
      label: t("knowledge.business.risk.label", { risk: t(key) }),
    })),
  ];

  return (
    <div className="space-y-4" data-testid="business-facts-editor">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("knowledge.business.search.placeholder")}
            aria-label={t("knowledge.business.search.aria")}
            className={`${inputClassName} pl-9`}
          />
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:w-[390px]">
          <Select
            value={verificationFilter}
            onValueChange={(value) =>
              setVerificationFilter(value as FilterValue<KnowledgeV2VerificationStatus>)
            }
            options={verificationOptions}
            ariaLabel={t("knowledge.business.filter.verificationAria")}
            className="h-10 rounded-md px-3 max-sm:min-h-11"
          />
          <Select
            value={riskFilter}
            onValueChange={(value) => setRiskFilter(value as FilterValue<KnowledgeV2RiskLevel>)}
            options={riskOptions}
            ariaLabel={t("knowledge.business.filter.riskAria")}
            className="h-10 rounded-md px-3 max-sm:min-h-11"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("knowledge.business.refresh")}
            title={t("knowledge.business.refresh")}
            disabled={loading}
            onClick={() => void loadFacts()}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {canEdit ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("knowledge.business.add")}
            </Button>
          ) : null}
        </div>
      </div>

      {!canEdit && !permissionDenied ? (
        <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-zinc-400">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <span>{t("knowledge.business.readOnly")}</span>
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{actionError}</span>
          <Button size="sm" variant="ghost" onClick={() => setActionError(null)}>
            {t("knowledge.business.dismiss")}
          </Button>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      {permissionDenied ? (
        <div className="rounded-lg border border-white/10 bg-zinc-950/30">
          <EmptyState
            icon={LockKeyhole}
            title={t("knowledge.business.permission.title")}
            description={t("knowledge.business.permission.description")}
          />
        </div>
      ) : showInitialLoading ? (
        <div className="rounded-lg border border-white/10 bg-zinc-950/30">
          <LoadingOverlay label={t("knowledge.business.loading")} />
        </div>
      ) : listError && facts.length === 0 ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5">
          <EmptyState
            icon={AlertCircle}
            title={t("knowledge.business.loadError.title")}
            description={listError}
            action={
              <Button size="sm" variant="outline" onClick={() => void loadFacts()}>
                <RefreshCw className="h-4 w-4" />
                {t("knowledge.business.retry")}
              </Button>
            }
          />
        </div>
      ) : facts.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-zinc-950/30">
          <EmptyState
            icon={FileText}
            title={
              query || riskFilter !== "ALL" || verificationFilter !== "ALL"
                ? t("knowledge.business.empty.filteredTitle")
                : t("knowledge.business.empty.title")
            }
            description={
              query || riskFilter !== "ALL" || verificationFilter !== "ALL"
                ? t("knowledge.business.empty.filteredDescription")
                : canEdit
                  ? t("knowledge.business.empty.editableDescription")
                  : t("knowledge.business.empty.readOnlyDescription")
            }
            action={
              canEdit && !query && riskFilter === "ALL" && verificationFilter === "ALL" ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  {t("knowledge.business.add")}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950/30">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)_auto] gap-4 border-b border-white/10 bg-white/[0.025] px-4 py-2 text-xs font-medium uppercase text-zinc-600 lg:grid">
            <span>{t("knowledge.business.table.fact")}</span>
            <span>{t("knowledge.business.table.control")}</span>
            <span className="text-right">{t("knowledge.business.table.actions")}</span>
          </div>
          {facts.map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              canEdit={canEdit}
              canVerifyHighRisk={canVerifyHighRisk}
              busyAction={busyAction}
              onEdit={() => openEdit(fact)}
              onVerify={() => void verifyFact(fact)}
              onReject={() => setRejectTarget(fact)}
            />
          ))}
          {listError ? (
            <div
              role="alert"
              className="flex items-center gap-3 border-t border-rose-500/20 px-4 py-3 text-sm text-rose-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{listError}</span>
              <Button size="sm" variant="ghost" onClick={() => void loadFacts()}>
                {t("knowledge.business.retry")}
              </Button>
            </div>
          ) : null}
          {nextCursor ? (
            <div className="flex justify-center border-t border-white/10 px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadFacts(nextCursor, true)}
              >
                {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                {loadingMore
                  ? t("knowledge.business.pagination.loading")
                  : t("knowledge.business.pagination.more")}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <FactEditorModal
        editor={editor}
        onClose={() => {
          if (!editor?.saving) setEditor(null);
        }}
        onFieldChange={setFormField}
        onKindChange={changeKind}
        onSubmit={() => void submitEditor()}
        onReload={() => void reloadCurrentFact()}
      />

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
        title={t("knowledge.business.reject.title")}
        description={t("knowledge.business.reject.description")}
        confirmLabel={t("knowledge.business.reject.confirm")}
        cancelLabel={t("knowledge.business.cancel")}
        danger
        onConfirm={async () => {
          const fact = rejectTarget;
          if (!fact) return false;
          await rejectFact(fact);
        }}
      />
    </div>
  );
}

function FactRow({
  fact,
  canEdit,
  canVerifyHighRisk,
  busyAction,
  onEdit,
  onVerify,
  onReject,
}: {
  fact: KnowledgeV2FactView;
  canEdit: boolean;
  canVerifyHighRisk: boolean;
  busyAction: string | null;
  onEdit: () => void;
  onVerify: () => void;
  onReject: () => void;
}) {
  const { t, formatDate } = useI18n();
  const isHighRisk = fact.riskLevel === "HIGH" || fact.riskLevel === "CRITICAL";
  const canVerify =
    canEdit && fact.allowedActions.includes("VERIFY") && (!isHighRisk || canVerifyHighRisk);
  const hasActions =
    canEdit &&
    (fact.allowedActions.includes("EDIT") || canVerify || fact.allowedActions.includes("REJECT"));
  const rowBusy = busyAction?.startsWith(`${fact.id}:`) ?? false;

  return (
    <article className="grid min-w-0 gap-4 border-b border-white/5 px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3
            className="max-w-full truncate text-sm font-medium text-zinc-100"
            title={valueSummary(fact, t)}
          >
            {valueSummary(fact, t)}
          </h3>
          <StatusBadge status={verificationTone(fact.verificationStatus)}>
            {t(VERIFICATION_KEYS[fact.verificationStatus])}
          </StatusBadge>
          <StatusBadge status={riskTone(fact.riskLevel)}>
            {t("knowledge.business.risk.label", { risk: t(RISK_KEYS[fact.riskLevel]) })}
          </StatusBadge>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-zinc-500">{fact.factKey}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600">
          <span>{translatedOrTitle(fact.entityType, ENTITY_KEYS, t)}</span>
          <span>{translatedOrTitle(fact.fieldType, FIELD_TYPE_KEYS, t)}</span>
          <span>{t(LIFECYCLE_KEYS[fact.lifecycleStatus])}</span>
          <span>{t("knowledge.business.row.version", { version: fact.version })}</span>
          <span title={safeDate(fact.updatedAt, formatDate)}>
            {t("knowledge.business.row.updated", { date: safeDate(fact.updatedAt, formatDate) })}
          </span>
        </div>
      </div>

      <div className="min-w-0 text-xs">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <dt className="text-zinc-600">{t("knowledge.business.row.authority")}</dt>
          <dd className="truncate text-zinc-400">{t(AUTHORITY_KEYS[fact.authority])}</dd>
          <dt className="text-zinc-600">{t("knowledge.business.row.locale")}</dt>
          <dd className="truncate text-zinc-400">
            {fact.locale ?? t("knowledge.business.localeBehavior.languageNeutral")} /{" "}
            {t(LOCALE_BEHAVIOR_KEYS[fact.localeBehavior])}
          </dd>
          <dt className="text-zinc-600">{t("knowledge.business.row.audience")}</dt>
          <dd className="truncate text-zinc-400">
            {fact.scope.audiences.length > 0
              ? fact.scope.audiences.map((audience) => t(AUDIENCE_KEYS[audience])).join(", ")
              : fact.scope.usesTenantDefault
                ? t("knowledge.business.row.workspaceDefault")
                : t("knowledge.business.row.notSpecified")}
          </dd>
          {fact.effectiveUntil ? (
            <>
              <dt className="text-zinc-600">{t("knowledge.business.row.validUntil")}</dt>
              <dd
                className="truncate text-zinc-400"
                title={safeDate(fact.effectiveUntil, formatDate)}
              >
                {safeDate(fact.effectiveUntil, formatDate)}
              </dd>
            </>
          ) : null}
          <dt className="text-zinc-600">{t("knowledge.business.row.evidence")}</dt>
          <dd className="min-w-0 text-zinc-400">
            {fact.evidence.length === 0 ? (
              <span className="text-zinc-600">{t("knowledge.business.row.noEvidence")}</span>
            ) : (
              <ul className="space-y-1">
                {fact.evidence.map((item) => (
                  <li key={item.id} className="min-w-0 truncate" title={item.locator ?? item.label}>
                    {item.label}
                    {item.locator ? <span className="text-zinc-600"> / {item.locator}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </div>

      <div className="flex items-start justify-end gap-1">
        {hasActions ? (
          <>
            {fact.allowedActions.includes("EDIT") ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("knowledge.business.action.editAria", { factKey: fact.factKey })}
                title={t("knowledge.business.action.edit")}
                disabled={rowBusy}
                onClick={onEdit}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            ) : null}
            {canVerify ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("knowledge.business.action.verifyAria", { factKey: fact.factKey })}
                title={t("knowledge.business.action.verify")}
                disabled={rowBusy}
                onClick={onVerify}
              >
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </Button>
            ) : null}
            {canEdit &&
            fact.allowedActions.includes("VERIFY") &&
            isHighRisk &&
            !canVerifyHighRisk ? (
              <span
                className="inline-flex h-9 w-9 items-center justify-center text-zinc-600"
                title={t("knowledge.business.action.highRiskPermission")}
              >
                <LockKeyhole className="h-4 w-4" />
              </span>
            ) : null}
            {fact.allowedActions.includes("REJECT") ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("knowledge.business.action.rejectAria", { factKey: fact.factKey })}
                title={t("knowledge.business.action.reject")}
                disabled={rowBusy}
                onClick={onReject}
              >
                <ShieldX className="h-4 w-4 text-rose-400" />
              </Button>
            ) : null}
          </>
        ) : (
          <span className="px-2 py-2 text-xs text-zinc-600">
            {t("knowledge.business.action.none")}
          </span>
        )}
      </div>
    </article>
  );
}

function FactEditorModal({
  editor,
  onClose,
  onFieldChange,
  onKindChange,
  onSubmit,
  onReload,
}: {
  editor: EditorState | null;
  onClose: () => void;
  onFieldChange: <K extends keyof FactForm>(field: K, value: FactForm[K]) => void;
  onKindChange: (kind: FactKind) => void;
  onSubmit: () => void;
  onReload: () => void;
}) {
  const { t } = useI18n();
  if (!editor) return null;
  const config = KIND_CONFIG[editor.form.kind];
  const structuredValue = Boolean(editor.fact && !isScalar(editor.fact.normalizedValue));
  const canSave = editor.mode === "create" || Boolean(editor.fact?.allowedActions.includes("EDIT"));
  const requiresExpiry = editor.form.riskLevel === "HIGH" || editor.form.riskLevel === "CRITICAL";
  const detailedErrors = [...new Set(Object.values(editor.fieldErrors).filter(Boolean))];
  const fieldError = (field: string) => editor.fieldErrors[field] || null;
  const kindOptions = Object.entries(KIND_CONFIG).map(([value, kindConfig]) => ({
    value,
    label: t(kindConfig.labelKey),
  }));
  const formRiskOptions = Object.entries(RISK_KEYS).map(([value, key]) => ({
    value,
    label: t("knowledge.business.risk.label", { risk: t(key) }),
  }));
  const audienceOptions = Object.entries(AUDIENCE_KEYS).map(([value, key]) => ({
    value,
    label: t(key),
  }));

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        editor.mode === "create"
          ? t("knowledge.business.editor.addTitle")
          : t("knowledge.business.editor.editTitle")
      }
      description={
        editor.mode === "create"
          ? t("knowledge.business.editor.createDescription")
          : editor.fact?.factKey
      }
      className="max-w-2xl rounded-lg"
      footer={
        <>
          <Button variant="outline" disabled={editor.saving} onClick={onClose}>
            {t("knowledge.business.cancel")}
          </Button>
          <Button disabled={editor.saving || editor.conflict || !canSave} onClick={onSubmit}>
            {editor.saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {editor.saving
              ? t("knowledge.business.editor.saving")
              : editor.mode === "create"
                ? t("knowledge.business.editor.create")
                : t("knowledge.business.editor.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {editor.conflict ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
            <p className="min-w-0 flex-1 text-sm text-amber-100">
              {editor.error ?? t("knowledge.business.editor.newerVersion")}
            </p>
            <Button size="sm" variant="outline" disabled={editor.saving} onClick={onReload}>
              <RefreshCw className={`h-4 w-4 ${editor.saving ? "animate-spin" : ""}`} />
              {t("knowledge.business.editor.reload")}
            </Button>
          </div>
        ) : editor.error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p>{editor.error}</p>
              {detailedErrors.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-xs text-rose-300">
                  {detailedErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {editor.mode === "edit" && !canSave && !editor.conflict ? (
          <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-zinc-400">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            <span>{t("knowledge.business.editor.serverDenied")}</span>
          </div>
        ) : null}

        {editor.mode === "create" ? (
          <FormField label={t("knowledge.business.form.factType")} error={fieldError("kind")}>
            <Select
              value={editor.form.kind}
              onValueChange={(value) => onKindChange(value as FactKind)}
              options={kindOptions}
              ariaLabel={t("knowledge.business.form.factType")}
              className="h-10 rounded-md px-3"
            />
          </FormField>
        ) : (
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
            <span className="rounded-md border border-white/10 px-2 py-1">
              {t(config.labelKey)}
            </span>
            <span className="rounded-md border border-white/10 px-2 py-1">
              {editor.fact?.fieldType}
            </span>
            <span className="rounded-md border border-white/10 px-2 py-1">
              {t("knowledge.business.row.version", { version: editor.fact?.version ?? "" })}
            </span>
          </div>
        )}

        {config.needsSubject && editor.mode === "create" ? (
          <FormField
            label={
              editor.form.kind === "POLICY"
                ? t("knowledge.business.form.policyName")
                : t("knowledge.business.form.serviceName")
            }
            error={fieldError("subject")}
            htmlFor="business-fact-subject"
          >
            <input
              id="business-fact-subject"
              value={editor.form.subject}
              onChange={(event) => onFieldChange("subject", event.target.value)}
              placeholder={
                editor.form.kind === "POLICY"
                  ? t("knowledge.business.form.policyPlaceholder")
                  : t("knowledge.business.form.servicePlaceholder")
              }
              className={inputClassName}
              aria-invalid={Boolean(fieldError("subject"))}
              aria-describedby={fieldError("subject") ? "business-fact-subject-error" : undefined}
            />
          </FormField>
        ) : null}

        {structuredValue ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3">
            <p className="text-sm font-medium text-zinc-200">
              {t("knowledge.business.form.structuredTitle")}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {t("knowledge.business.form.structuredDescription")}
            </p>
          </div>
        ) : (
          <FormField
            label={t(config.valueLabelKey)}
            error={fieldError("value")}
            htmlFor="business-fact-value"
          >
            {config.multiline ? (
              <textarea
                id="business-fact-value"
                value={editor.form.value}
                onChange={(event) => onFieldChange("value", event.target.value)}
                placeholder={t(config.valuePlaceholderKey)}
                className={textAreaClassName}
                aria-invalid={Boolean(fieldError("value"))}
                aria-describedby={fieldError("value") ? "business-fact-value-error" : undefined}
              />
            ) : (
              <input
                id="business-fact-value"
                inputMode={
                  editor.form.kind === "PRICE" || editor.form.kind === "DURATION"
                    ? "decimal"
                    : undefined
                }
                value={editor.form.value}
                onChange={(event) => onFieldChange("value", event.target.value)}
                placeholder={t(config.valuePlaceholderKey)}
                className={inputClassName}
                aria-invalid={Boolean(fieldError("value"))}
                aria-describedby={fieldError("value") ? "business-fact-value-error" : undefined}
              />
            )}
          </FormField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {editor.form.kind === "PRICE" ? (
            <FormField
              label={t("knowledge.business.form.currency")}
              error={fieldError("currency")}
              htmlFor="business-fact-currency"
            >
              <input
                id="business-fact-currency"
                value={editor.form.currency}
                maxLength={3}
                onChange={(event) => onFieldChange("currency", event.target.value.toUpperCase())}
                placeholder={t("knowledge.business.form.currencyPlaceholder")}
                className={inputClassName}
                aria-invalid={Boolean(fieldError("currency"))}
                aria-describedby={
                  fieldError("currency") ? "business-fact-currency-error" : undefined
                }
              />
            </FormField>
          ) : null}
          {editor.form.kind === "HOURS" ? (
            <FormField
              label={t("knowledge.business.form.timeZone")}
              error={fieldError("timeZone")}
              htmlFor="business-fact-time-zone"
            >
              <input
                id="business-fact-time-zone"
                value={editor.form.timeZone}
                onChange={(event) => onFieldChange("timeZone", event.target.value)}
                placeholder={t("knowledge.business.form.timeZonePlaceholder")}
                className={inputClassName}
                aria-invalid={Boolean(fieldError("timeZone"))}
                aria-describedby={
                  fieldError("timeZone") ? "business-fact-time-zone-error" : undefined
                }
              />
            </FormField>
          ) : null}
          <FormField
            label={t("knowledge.business.form.locale")}
            error={fieldError("locale")}
            htmlFor="business-fact-locale"
          >
            <input
              id="business-fact-locale"
              value={editor.form.locale}
              onChange={(event) => onFieldChange("locale", event.target.value)}
              placeholder={t("knowledge.business.form.localePlaceholder")}
              disabled={
                localeBehavior(editor.form.kind) === "LANGUAGE_NEUTRAL" && editor.mode === "create"
              }
              className={inputClassName}
              aria-invalid={Boolean(fieldError("locale"))}
              aria-describedby={fieldError("locale") ? "business-fact-locale-error" : undefined}
            />
          </FormField>
          <FormField
            label={t("knowledge.business.form.displayValue")}
            error={fieldError("displayValue")}
            htmlFor="business-fact-display-value"
          >
            <input
              id="business-fact-display-value"
              value={editor.form.displayValue}
              onChange={(event) => onFieldChange("displayValue", event.target.value)}
              placeholder={t("knowledge.business.form.displayPlaceholder")}
              className={inputClassName}
              aria-invalid={Boolean(fieldError("displayValue"))}
              aria-describedby={
                fieldError("displayValue") ? "business-fact-display-value-error" : undefined
              }
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("knowledge.business.form.risk")} error={fieldError("riskLevel")}>
            <Select
              value={editor.form.riskLevel}
              onValueChange={(value) => onFieldChange("riskLevel", value as KnowledgeV2RiskLevel)}
              options={formRiskOptions}
              ariaLabel={t("knowledge.business.form.risk")}
              className="h-10 rounded-md px-3"
            />
          </FormField>
          <FormField label={t("knowledge.business.form.authority")} error={null}>
            <div className="flex h-10 items-center rounded-md border border-white/10 bg-white/[0.025] px-3 text-sm text-zinc-400">
              {editor.mode === "create"
                ? t("knowledge.business.form.manualEntry")
                : t(AUTHORITY_KEYS[editor.fact?.authority ?? "MANUAL"])}
            </div>
          </FormField>
        </div>

        <FormField
          label={
            requiresExpiry
              ? t("knowledge.business.form.validUntilRequired")
              : t("knowledge.business.form.validUntil")
          }
          error={fieldError("effectiveUntil")}
          htmlFor="business-fact-effective-until"
        >
          <input
            id="business-fact-effective-until"
            type="datetime-local"
            value={editor.form.effectiveUntil}
            min={requiresExpiry ? dateTimeLocalValue(new Date().toISOString()) : undefined}
            onChange={(event) => onFieldChange("effectiveUntil", event.target.value)}
            className={inputClassName}
            aria-required={requiresExpiry}
            aria-invalid={Boolean(fieldError("effectiveUntil"))}
            aria-describedby={
              fieldError("effectiveUntil") ? "business-fact-effective-until-error" : undefined
            }
          />
        </FormField>

        <FormField label={t("knowledge.business.form.audience")} error={fieldError("audience")}>
          <Select
            value={editor.form.audience}
            onValueChange={(value) => onFieldChange("audience", value as KnowledgeV2Audience)}
            options={audienceOptions}
            ariaLabel={t("knowledge.business.form.audienceAria")}
            className="h-10 rounded-md px-3"
          />
        </FormField>

        {editor.mode === "edit" ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3 text-xs text-zinc-500">
            {t("knowledge.business.form.scopePreserved")}
          </div>
        ) : null}

        {editor.mode === "edit" ? (
          <FormField
            label={t("knowledge.business.form.changeReason")}
            error={fieldError("changeReason")}
            htmlFor="business-fact-change-reason"
          >
            <textarea
              id="business-fact-change-reason"
              value={editor.form.changeReason}
              onChange={(event) => onFieldChange("changeReason", event.target.value)}
              placeholder={t("knowledge.business.form.changeReasonPlaceholder")}
              className={`${textAreaClassName} min-h-20`}
              aria-invalid={Boolean(fieldError("changeReason"))}
              aria-describedby={
                fieldError("changeReason") ? "business-fact-change-reason-error" : undefined
              }
            />
          </FormField>
        ) : null}

        {editor.fact ? (
          <div className="border-t border-white/10 pt-4">
            <p className="text-xs font-medium uppercase text-zinc-600">
              {t("knowledge.business.form.evidence")}
            </p>
            {editor.fact.evidence.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">
                {t("knowledge.business.form.noEvidence")}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {editor.fact.evidence.map((item) => (
                  <li key={item.id} className="min-w-0 text-sm text-zinc-400">
                    <span className="font-medium text-zinc-300">{item.label}</span>
                    {item.locator ? (
                      <span className="ml-2 break-all text-xs text-zinc-600">{item.locator}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function FormField({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error: string | null;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="mt-1.5 text-xs text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
