"use client";

import * as React from "react";
import type {
  BusinessProfileData,
  BusinessProfileScheduleDay,
  BusinessProfileServiceItem,
  BusinessProfileView,
} from "@leadvirt/types";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock3,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeDemoBusinessProfile } from "@/i18n/demo-seed-messages";
import type { TranslationKey } from "@/i18n/messages";
import { getBusinessProfile, updateBusinessProfile } from "@/lib/api/business-profile";
import { ApiClientError } from "@/lib/api/client";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { LoadingOverlay, Select, StatusBadge } from "../ui";
import { useProductMode } from "../ProductMode";

type Day = BusinessProfileScheduleDay["day"];

interface SaveFailure {
  message: string;
  requestId?: string;
}

const DAYS: readonly Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const BUSINESS_TYPES: ReadonlyArray<{ value: string; labelKey: TranslationKey }> = [
  { value: "services", labelKey: "onboarding.business.services" },
  { value: "beauty", labelKey: "onboarding.business.beauty" },
  { value: "fitness", labelKey: "settings.profile.industry.fitness" },
  { value: "shop", labelKey: "onboarding.business.shop" },
  { value: "retail", labelKey: "settings.profile.industry.retail" },
  { value: "clinic", labelKey: "onboarding.business.clinic" },
  { value: "education", labelKey: "onboarding.business.education" },
  { value: "auto", labelKey: "onboarding.business.auto" },
  { value: "local", labelKey: "onboarding.business.local" },
  { value: "other", labelKey: "settings.profile.industry.other" },
];
const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Dubai",
  "Asia/Tbilisi",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Yekaterinburg",
  "Asia/Novosibirsk",
  "Asia/Vladivostok",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
] as const;

const inputClassName =
  "h-11 w-full min-w-0 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-rose-500/60 aria-[invalid=true]:focus:ring-rose-500/15";
const textAreaClassName = cn(inputClassName, "h-auto min-h-24 resize-y py-3");

function createServiceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `service-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createService(): BusinessProfileServiceItem {
  return { id: createServiceId(), name: "", description: "", price: "", duration: "" };
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeProfile(profile: BusinessProfileData): BusinessProfileData {
  const schedule = new Map<Day, BusinessProfileScheduleDay>();
  if (Array.isArray(profile.weeklySchedule)) {
    for (const entry of profile.weeklySchedule) {
      if (entry && DAYS.includes(entry.day)) schedule.set(entry.day, entry);
    }
  }

  return {
    businessType: asString(profile.businessType, "other") || "other",
    name: asString(profile.name),
    description: asString(profile.description),
    avgCheck: asString(profile.avgCheck),
    servicesCatalog: asString(profile.servicesCatalog),
    services: Array.isArray(profile.services)
      ? profile.services.map((service) => ({
          id: asString(service?.id) || createServiceId(),
          name: asString(service?.name),
          description: asString(service?.description),
          price: asString(service?.price),
          duration: asString(service?.duration),
        }))
      : [],
    hours: asString(profile.hours),
    weeklySchedule: DAYS.map((day) => {
      const current = schedule.get(day);
      return {
        day,
        enabled: Boolean(current?.enabled),
        opensAt: asString(current?.opensAt, "09:00"),
        closesAt: asString(current?.closesAt, "18:00"),
      };
    }),
    availability: asString(profile.availability),
    faq: asString(profile.faq),
    policies: asString(profile.policies),
    escalationRules: asString(profile.escalationRules),
    timezone: asString(profile.timezone, "UTC") || "UTC",
  };
}

function profileForSave(profile: BusinessProfileData): BusinessProfileData {
  return {
    ...profile,
    businessType: profile.businessType.trim(),
    name: profile.name.trim(),
    description: profile.description.trim(),
    avgCheck: profile.avgCheck.trim(),
    servicesCatalog: profile.servicesCatalog.trim(),
    services: profile.services.map((service) => ({
      ...service,
      id: service.id.trim(),
      name: service.name.trim(),
      description: service.description.trim(),
      price: service.price.trim(),
      duration: service.duration.trim(),
    })),
    hours: profile.hours.trim(),
    weeklySchedule: profile.weeklySchedule.map((entry) => ({
      ...entry,
      opensAt: entry.opensAt.trim(),
      closesAt: entry.closesAt.trim(),
    })),
    availability: profile.availability.trim(),
    faq: profile.faq.trim(),
    policies: profile.policies.trim(),
    escalationRules: profile.escalationRules.trim(),
    timezone: profile.timezone.trim(),
  };
}

function changedProfilePatch(
  profile: BusinessProfileData,
  baseline: BusinessProfileData,
): Partial<BusinessProfileData> {
  const patch: Partial<BusinessProfileData> = {};
  if (profile.businessType !== baseline.businessType) patch.businessType = profile.businessType;
  if (profile.name !== baseline.name) patch.name = profile.name;
  if (profile.description !== baseline.description) patch.description = profile.description;
  if (profile.avgCheck !== baseline.avgCheck) patch.avgCheck = profile.avgCheck;
  if (profile.servicesCatalog !== baseline.servicesCatalog) {
    patch.servicesCatalog = profile.servicesCatalog;
  }
  if (JSON.stringify(profile.services) !== JSON.stringify(baseline.services)) {
    patch.services = profile.services;
  }
  if (profile.hours !== baseline.hours) patch.hours = profile.hours;
  if (JSON.stringify(profile.weeklySchedule) !== JSON.stringify(baseline.weeklySchedule)) {
    patch.weeklySchedule = profile.weeklySchedule;
  }
  if (profile.availability !== baseline.availability) patch.availability = profile.availability;
  if (profile.faq !== baseline.faq) patch.faq = profile.faq;
  if (profile.policies !== baseline.policies) patch.policies = profile.policies;
  if (profile.escalationRules !== baseline.escalationRules) {
    patch.escalationRules = profile.escalationRules;
  }
  if (profile.timezone !== baseline.timezone) patch.timezone = profile.timezone;
  return patch;
}

function requestKey() {
  return `business-profile-${createServiceId()}`;
}

function fieldKey(field: string) {
  return field.replace(/^profile\./u, "");
}

export function BusinessProfileEditor({
  canEdit,
  onChanged,
}: {
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { locale, t } = useI18n();
  const { demo } = useProductMode();
  const [view, setView] = React.useState<BusinessProfileView | null>(null);
  const [draft, setDraft] = React.useState<BusinessProfileData | null>(null);
  const [baseline, setBaseline] = React.useState<BusinessProfileData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<ApiClientError | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<SaveFailure | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [savedNotice, setSavedNotice] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const mounted = React.useRef(false);
  const requestSequence = React.useRef(0);
  const saveAttempt = React.useRef<{ signature: string; key: string } | null>(null);
  const translate = React.useRef(t);
  const demoLocalization = React.useRef({ demo, locale });

  React.useEffect(() => {
    translate.current = t;
  }, [t]);

  React.useEffect(() => {
    demoLocalization.current = { demo, locale };
  }, [demo, locale]);

  const dirty = React.useMemo(
    () => Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline)),
    [baseline, draft],
  );

  const loadProfile = React.useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getBusinessProfile();
      if (!mounted.current || sequence !== requestSequence.current) return;
      const normalizedProfile = normalizeProfile(next.profile);
      const profile = demoLocalization.current.demo
        ? localizeDemoBusinessProfile(normalizedProfile, demoLocalization.current.locale)
        : normalizedProfile;
      setView({ ...next, profile });
      setDraft(profile);
      setBaseline(profile);
      setConflict(false);
      setSaveError(null);
      setSavedNotice(false);
      setFieldErrors({});
      saveAttempt.current = null;
    } catch (caught) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setLoadError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(
              translate.current("businessProfile.loadError.description"),
              500,
              "HTTP_ERROR",
              true,
            ),
      );
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void loadProfile();
    return () => {
      mounted.current = false;
    };
  }, [loadProfile]);

  React.useEffect(() => {
    if (!demo || dirty) return;
    setView((current) =>
      current
        ? { ...current, profile: localizeDemoBusinessProfile(current.profile, locale) }
        : current,
    );
    setDraft((current) => (current ? localizeDemoBusinessProfile(current, locale) : current));
    setBaseline((current) => (current ? localizeDemoBusinessProfile(current, locale) : current));
  }, [demo, dirty, locale]);

  const businessTypeOptions = React.useMemo(() => {
    const options = BUSINESS_TYPES.map((item) => ({ value: item.value, label: t(item.labelKey) }));
    if (draft?.businessType && !options.some((item) => item.value === draft.businessType)) {
      options.unshift({ value: draft.businessType, label: draft.businessType });
    }
    return options;
  }, [draft?.businessType, t]);

  const timezoneOptions = React.useMemo(() => {
    const values: string[] = [...TIMEZONES];
    if (draft?.timezone && !values.includes(draft.timezone)) values.unshift(draft.timezone);
    return values.map((value) => ({ value, label: value.replaceAll("_", " ") }));
  }, [draft?.timezone]);

  function clearFeedback(field?: string) {
    setSavedNotice(false);
    setSaveError(null);
    if (field) {
      setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function updateField<K extends keyof BusinessProfileData>(
    field: K,
    value: BusinessProfileData[K],
  ) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    clearFeedback(String(field));
  }

  function updateService(index: number, field: keyof BusinessProfileServiceItem, value: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        services: current.services.map((service, serviceIndex) =>
          serviceIndex === index ? { ...service, [field]: value } : service,
        ),
      };
    });
    clearFeedback(`services.${index}.${field}`);
  }

  function addService() {
    setDraft((current) =>
      current ? { ...current, services: [...current.services, createService()] } : current,
    );
    clearFeedback();
  }

  function removeService(index: number) {
    setDraft((current) =>
      current
        ? {
            ...current,
            services: current.services.filter((_, serviceIndex) => serviceIndex !== index),
          }
        : current,
    );
    setFieldErrors({});
    clearFeedback();
  }

  function updateSchedule(index: number, patch: Partial<BusinessProfileScheduleDay>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        weeklySchedule: current.weeklySchedule.map((entry, scheduleIndex) =>
          scheduleIndex === index ? { ...entry, ...patch } : entry,
        ),
      };
    });
    clearFeedback(`weeklySchedule.${index}`);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`weeklySchedule.${index}.opensAt`];
      delete next[`weeklySchedule.${index}.closesAt`];
      return next;
    });
  }

  function validate(profile: BusinessProfileData) {
    const errors: Record<string, string> = {};
    if (!profile.name) errors.name = t("businessProfile.validation.nameRequired");
    if (!profile.description) {
      errors.description = t("businessProfile.validation.descriptionRequired");
    }
    if (!profile.timezone) errors.timezone = t("businessProfile.validation.timezoneRequired");

    profile.services.forEach((service, index) => {
      if (!service.name) {
        errors[`services.${index}.name`] = t("businessProfile.validation.serviceNameRequired");
      }
    });

    profile.weeklySchedule.forEach((entry, index) => {
      if (!entry.enabled) return;
      if (!CLOCK_TIME.test(entry.opensAt) || !CLOCK_TIME.test(entry.closesAt)) {
        const message = t("businessProfile.validation.timeFormat");
        errors[`weeklySchedule.${index}.opensAt`] = message;
        errors[`weeklySchedule.${index}.closesAt`] = message;
      } else if (entry.closesAt === entry.opensAt) {
        errors[`weeklySchedule.${index}.closesAt`] = t("businessProfile.validation.timeOrder");
      }
    });
    return errors;
  }

  async function save() {
    if (!draft || !baseline || !view || !canEdit || saving || conflict) return;
    const nextProfile = profileForSave(draft);
    const profilePatch = changedProfilePatch(nextProfile, profileForSave(baseline));
    setDraft(nextProfile);
    const errors = validate(nextProfile);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError({ message: t("businessProfile.validation.review") });
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>("[data-testid='business-profile-form'] [aria-invalid='true']")
          ?.focus();
      });
      return;
    }

    if (Object.keys(profilePatch).length === 0) {
      setBaseline(nextProfile);
      setSaveError(null);
      setSavedNotice(false);
      setFieldErrors({});
      saveAttempt.current = null;
      return;
    }

    const signature = JSON.stringify(profilePatch);
    if (!saveAttempt.current || saveAttempt.current.signature !== signature) {
      saveAttempt.current = { signature, key: requestKey() };
    }
    setSaving(true);
    setSaveError(null);
    setSavedNotice(false);
    try {
      const result = await updateBusinessProfile(profilePatch, {
        "Idempotency-Key": saveAttempt.current.key,
        "If-Match": view.etag,
      });
      if (!mounted.current) return;
      const profile = normalizeProfile(result.profile);
      setView({ ...result, profile });
      setDraft(profile);
      setBaseline(profile);
      setConflict(false);
      setSavedNotice(true);
      setFieldErrors({});
      saveAttempt.current = null;
      onChanged();
    } catch (caught) {
      if (!mounted.current) return;
      const error =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(t("businessProfile.saveError.description"), 500, "HTTP_ERROR", true);
      const isConflict =
        error.status === 412 || /REVISION_CONFLICT|ETAG|PRECONDITION|VERSION/u.test(error.code);
      if (isConflict) {
        setConflict(true);
        setSaveError(null);
      } else {
        const serverErrors: Record<string, string> = {};
        for (const item of error.fieldErrors ?? [])
          serverErrors[fieldKey(item.field)] = item.message;
        if (error.field) serverErrors[fieldKey(error.field)] = error.message;
        if (Object.keys(serverErrors).length > 0) setFieldErrors(serverErrors);
        setSaveError({ message: error.message, requestId: error.requestId });
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  if (loading && !draft) {
    return (
      <section
        className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/20"
        data-testid="business-profile-editor"
      >
        <div data-testid="business-profile-loading">
          <LoadingOverlay label={t("businessProfile.loading")} />
        </div>
      </section>
    );
  }

  if (!draft || !view) {
    return (
      <section
        className="min-w-0 rounded-lg border border-white/10 bg-zinc-950/20 px-5 py-10 text-center"
        data-testid="business-profile-editor"
      >
        <div data-testid="business-profile-load-error">
          <AlertCircle className="mx-auto h-7 w-7 text-rose-400" />
          <h2 className="mt-3 text-base font-semibold text-zinc-100">
            {t("businessProfile.loadError.title")}
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-zinc-500">
            {loadError?.message || t("businessProfile.loadError.description")}
          </p>
          <Button className="mt-5" onClick={() => void loadProfile()}>
            <RefreshCw className="h-4 w-4" />
            {t("knowledge.common.tryAgain")}
          </Button>
        </div>
      </section>
    );
  }

  const disabled = !canEdit || saving || conflict;
  const hasStructuredServices = draft.services.some((service) => service.name.trim().length > 0);
  const hasWorkingDays = draft.weeklySchedule.some((entry) => entry.enabled);
  const serviceNotesConflict = !hasStructuredServices && draft.servicesCatalog.trim().length > 0;
  const scheduleNotesConflict = !hasWorkingDays && draft.hours.trim().length > 0;
  const needsProfileAttention = !hasStructuredServices || !hasWorkingDays;

  function focusServices() {
    if (draft.services.length === 0) addService();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLInputElement>('[data-testid^="business-profile-service-"][data-testid$="-name"]')
          ?.focus();
      });
    });
  }

  function focusSchedule() {
    document
      .querySelector<HTMLElement>('[data-testid="business-profile-schedule"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/20"
      data-testid="business-profile-editor"
    >
      <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">{t("businessProfile.title")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500">
              {t("businessProfile.description")}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {saving ? (
            <StatusBadge status="info">{t("businessProfile.status.saving")}</StatusBadge>
          ) : dirty ? (
            <StatusBadge status="warning">{t("businessProfile.status.unsaved")}</StatusBadge>
          ) : needsProfileAttention ? (
            <StatusBadge status="warning">{t("businessProfile.status.attention")}</StatusBadge>
          ) : (
            <StatusBadge status="success">{t("businessProfile.status.saved")}</StatusBadge>
          )}
        </div>
      </div>

      {!canEdit ? (
        <div className="mx-4 mb-5 flex items-start gap-3 rounded-md border border-sky-500/20 bg-sky-500/[0.07] px-4 py-3 sm:mx-5">
          <UserRoundCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div>
            <p className="text-sm font-medium text-sky-200">
              {t("businessProfile.readOnly.title")}
            </p>
            <p className="mt-0.5 text-xs text-sky-200/65">
              {t("businessProfile.readOnly.description")}
            </p>
          </div>
        </div>
      ) : null}

      {needsProfileAttention ? (
        <div
          className="mx-4 mb-5 rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-4 py-4 sm:mx-5"
          data-testid="business-profile-attention"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-200">
                {t("businessProfile.attention.title")}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-100/70">
                {t("businessProfile.attention.description")}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-100/75">
                {!hasStructuredServices ? (
                  <li>{t("businessProfile.attention.services")}</li>
                ) : null}
                {!hasWorkingDays ? <li>{t("businessProfile.attention.schedule")}</li> : null}
              </ul>
              {canEdit ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!hasStructuredServices ? (
                    <Button type="button" size="sm" variant="outline" onClick={focusServices}>
                      <Plus className="h-4 w-4" />
                      {t("businessProfile.services.add")}
                    </Button>
                  ) : null}
                  {!hasWorkingDays ? (
                    <Button type="button" size="sm" variant="outline" onClick={focusSchedule}>
                      <Clock3 className="h-4 w-4" />
                      {t("businessProfile.attention.openSchedule")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div
          className="mx-4 mb-5 flex flex-col gap-3 rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 sm:mx-5 sm:flex-row sm:items-center sm:justify-between"
          data-testid="business-profile-conflict"
        >
          <div className="flex min-w-0 items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">
                {t("businessProfile.conflict.title")}
              </p>
              <p className="mt-0.5 text-xs text-amber-200/65">
                {t("businessProfile.conflict.description")}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            data-testid="business-profile-reload"
            disabled={loading}
            onClick={() => void loadProfile()}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("businessProfile.conflict.reload")}
          </Button>
        </div>
      ) : null}

      {loadError && draft ? (
        <div
          className="mx-4 mb-5 flex items-start gap-3 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-4 py-3 sm:mx-5"
          data-testid="business-profile-load-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-rose-200">
              {t("businessProfile.loadError.title")}
            </p>
            <p className="mt-0.5 break-words text-xs text-rose-200/65">{loadError.message}</p>
          </div>
        </div>
      ) : null}

      <form
        data-testid="business-profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={disabled} className="min-w-0 divide-y divide-white/10">
          <FormSection
            title={t("businessProfile.section.basic")}
            description={t("businessProfile.section.basicDescription")}
          >
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <FormField
                label={t("onboarding.company.name")}
                htmlFor="business-profile-name"
                error={fieldErrors.name}
              >
                <input
                  id="business-profile-name"
                  data-testid="business-profile-name"
                  value={draft.name}
                  maxLength={160}
                  required
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? "business-profile-name-error" : undefined}
                  placeholder={t("onboarding.company.namePlaceholder")}
                  className={inputClassName}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </FormField>
              <FormField
                label={t("businessProfile.businessType")}
                htmlFor="business-profile-business-type"
              >
                <div
                  id="business-profile-business-type"
                  data-testid="business-profile-business-type"
                >
                  <Select
                    value={draft.businessType}
                    options={businessTypeOptions}
                    ariaLabel={t("businessProfile.businessType")}
                    className="h-11 rounded-md px-3"
                    onValueChange={(value) => updateField("businessType", value)}
                  />
                </div>
              </FormField>
              <FormField
                label={t("onboarding.company.about")}
                htmlFor="business-profile-description"
                error={fieldErrors.description}
                className="md:col-span-2"
              >
                <textarea
                  id="business-profile-description"
                  data-testid="business-profile-description"
                  value={draft.description}
                  maxLength={4_000}
                  required
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={
                    fieldErrors.description ? "business-profile-description-error" : undefined
                  }
                  placeholder={t("onboarding.company.aboutPlaceholder")}
                  className={cn(textAreaClassName, "min-h-28")}
                  onChange={(event) => updateField("description", event.target.value)}
                />
              </FormField>
              <FormField
                label={t("businessProfile.timezone")}
                htmlFor="business-profile-timezone"
                error={fieldErrors.timezone}
              >
                <div id="business-profile-timezone" data-testid="business-profile-timezone">
                  <Select
                    value={draft.timezone}
                    options={timezoneOptions}
                    ariaLabel={t("businessProfile.timezone")}
                    className={cn(
                      "h-11 rounded-md px-3",
                      fieldErrors.timezone && "border-rose-500/60",
                    )}
                    onValueChange={(value) => updateField("timezone", value)}
                  />
                </div>
              </FormField>
              <FormField
                label={t("onboarding.company.average")}
                htmlFor="business-profile-avg-check"
              >
                <input
                  id="business-profile-avg-check"
                  data-testid="business-profile-avg-check"
                  value={draft.avgCheck}
                  maxLength={500}
                  placeholder={t("onboarding.company.averagePlaceholder")}
                  className={inputClassName}
                  onChange={(event) => updateField("avgCheck", event.target.value)}
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection
            title={t("businessProfile.services.title")}
            description={t("businessProfile.services.description")}
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="business-profile-add-service"
                onClick={addService}
              >
                <Plus className="h-4 w-4" />
                {t("businessProfile.services.add")}
              </Button>
            }
          >
            <div className="min-w-0" data-testid="business-profile-services">
              {serviceNotesConflict ? (
                <div
                  className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs leading-5 text-amber-200"
                  data-testid="business-profile-services-conflict"
                >
                  {t("businessProfile.attention.serviceNotesConflict")}
                </div>
              ) : null}
              {draft.services.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-600">
                  {t("businessProfile.services.empty")}
                </div>
              ) : (
                <div className="divide-y divide-white/10 border-y border-white/10">
                  {draft.services.map((service, index) => (
                    <div
                      key={service.id}
                      className="min-w-0 py-5"
                      data-testid={`business-profile-service-${index}`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h4 className="text-sm font-medium text-zinc-300">
                          {t("businessProfile.services.item", { count: index + 1 })}
                        </h4>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-zinc-500 hover:text-rose-400"
                          aria-label={t("businessProfile.services.remove", { count: index + 1 })}
                          title={t("businessProfile.services.remove", { count: index + 1 })}
                          data-testid={`business-profile-remove-service-${index}`}
                          onClick={() => removeService(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-12">
                        <FormField
                          label={t("businessProfile.services.name")}
                          htmlFor={`business-profile-service-${index}-name`}
                          error={fieldErrors[`services.${index}.name`]}
                          className="lg:col-span-5"
                        >
                          <input
                            id={`business-profile-service-${index}-name`}
                            data-testid={`business-profile-service-${index}-name`}
                            value={service.name}
                            maxLength={160}
                            aria-invalid={Boolean(fieldErrors[`services.${index}.name`])}
                            aria-describedby={
                              fieldErrors[`services.${index}.name`]
                                ? `business-profile-service-${index}-name-error`
                                : undefined
                            }
                            className={inputClassName}
                            onChange={(event) => updateService(index, "name", event.target.value)}
                          />
                        </FormField>
                        <FormField
                          label={t("businessProfile.services.price")}
                          htmlFor={`business-profile-service-${index}-price`}
                          error={fieldErrors[`services.${index}.price`]}
                          className="lg:col-span-3"
                        >
                          <input
                            id={`business-profile-service-${index}-price`}
                            data-testid={`business-profile-service-${index}-price`}
                            value={service.price}
                            maxLength={160}
                            aria-invalid={Boolean(fieldErrors[`services.${index}.price`])}
                            placeholder={t("businessProfile.services.pricePlaceholder")}
                            className={inputClassName}
                            onChange={(event) => updateService(index, "price", event.target.value)}
                          />
                        </FormField>
                        <FormField
                          label={t("businessProfile.services.duration")}
                          htmlFor={`business-profile-service-${index}-duration`}
                          error={fieldErrors[`services.${index}.duration`]}
                          className="lg:col-span-4"
                        >
                          <input
                            id={`business-profile-service-${index}-duration`}
                            data-testid={`business-profile-service-${index}-duration`}
                            value={service.duration}
                            maxLength={160}
                            aria-invalid={Boolean(fieldErrors[`services.${index}.duration`])}
                            placeholder={t("businessProfile.services.durationPlaceholder")}
                            className={inputClassName}
                            onChange={(event) =>
                              updateService(index, "duration", event.target.value)
                            }
                          />
                        </FormField>
                        <FormField
                          label={t("businessProfile.services.descriptionLabel")}
                          htmlFor={`business-profile-service-${index}-description`}
                          error={fieldErrors[`services.${index}.description`]}
                          className="md:col-span-2 lg:col-span-12"
                        >
                          <textarea
                            id={`business-profile-service-${index}-description`}
                            data-testid={`business-profile-service-${index}-description`}
                            value={service.description}
                            maxLength={2_000}
                            aria-invalid={Boolean(fieldErrors[`services.${index}.description`])}
                            placeholder={t("businessProfile.services.descriptionPlaceholder")}
                            className={cn(textAreaClassName, "min-h-20")}
                            onChange={(event) =>
                              updateService(index, "description", event.target.value)
                            }
                          />
                        </FormField>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormSection>

          <FormSection
            title={t("businessProfile.schedule.title")}
            description={t("businessProfile.schedule.description")}
          >
            {!hasWorkingDays ? (
              <div
                className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs leading-5 text-amber-200"
                data-testid="business-profile-schedule-warning"
              >
                {t(
                  scheduleNotesConflict
                    ? "businessProfile.attention.scheduleNotesConflict"
                    : "businessProfile.attention.scheduleMissing",
                )}
              </div>
            ) : null}
            <div
              className="min-w-0 divide-y divide-white/10 border-y border-white/10"
              data-testid="business-profile-schedule"
            >
              {draft.weeklySchedule.map((entry, index) => {
                const openError = fieldErrors[`weeklySchedule.${index}.opensAt`];
                const closeError = fieldErrors[`weeklySchedule.${index}.closesAt`];
                return (
                  <div
                    key={entry.day}
                    className="grid min-w-0 gap-3 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,12rem)_minmax(0,12rem)] sm:items-start"
                    data-testid={`business-profile-day-${entry.day}`}
                  >
                    <label className="flex min-h-10 min-w-0 items-center gap-3 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        className="h-4 w-4 shrink-0 accent-emerald-400"
                        data-testid={`business-profile-day-${entry.day}-enabled`}
                        onChange={(event) =>
                          updateSchedule(index, {
                            enabled: event.target.checked,
                            opensAt: entry.opensAt || "09:00",
                            closesAt: entry.closesAt || "18:00",
                          })
                        }
                      />
                      <span className="min-w-0 font-medium">
                        {t(`businessProfile.day.${entry.day}` as TranslationKey)}
                      </span>
                      {!entry.enabled ? (
                        <span className="text-xs text-zinc-600">
                          {t("businessProfile.schedule.closed")}
                        </span>
                      ) : null}
                    </label>
                    <FormField
                      label={t("businessProfile.schedule.opens")}
                      htmlFor={`business-profile-day-${entry.day}-opens`}
                      error={openError}
                    >
                      <input
                        id={`business-profile-day-${entry.day}-opens`}
                        type="text"
                        inputMode="numeric"
                        pattern="(?:[01]\\d|2[0-3]):[0-5]\\d"
                        maxLength={5}
                        placeholder="09:00"
                        value={entry.opensAt}
                        disabled={!entry.enabled || disabled}
                        aria-invalid={Boolean(openError)}
                        data-testid={`business-profile-day-${entry.day}-opens`}
                        className={inputClassName}
                        onChange={(event) => updateSchedule(index, { opensAt: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      label={t("businessProfile.schedule.closes")}
                      htmlFor={`business-profile-day-${entry.day}-closes`}
                      error={closeError}
                    >
                      <input
                        id={`business-profile-day-${entry.day}-closes`}
                        type="text"
                        inputMode="numeric"
                        pattern="(?:[01]\\d|2[0-3]):[0-5]\\d"
                        maxLength={5}
                        placeholder="18:00"
                        value={entry.closesAt}
                        disabled={!entry.enabled || disabled}
                        aria-invalid={Boolean(closeError)}
                        data-testid={`business-profile-day-${entry.day}-closes`}
                        className={inputClassName}
                        onChange={(event) =>
                          updateSchedule(index, { closesAt: event.target.value })
                        }
                      />
                    </FormField>
                  </div>
                );
              })}
            </div>
          </FormSection>

          <FormSection
            title={t("businessProfile.details.title")}
            description={t("businessProfile.details.description")}
          >
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <TextAreaField
                id="business-profile-services-catalog"
                testId="business-profile-services-catalog"
                label={t("businessProfile.catalogNotes")}
                value={draft.servicesCatalog}
                maxLength={20_000}
                placeholder={t("onboarding.company.catalogPlaceholder")}
                hint={t("businessProfile.catalogNotesHint")}
                onChange={(value) => updateField("servicesCatalog", value)}
              />
              <TextAreaField
                id="business-profile-hours"
                testId="business-profile-hours"
                label={t("businessProfile.hoursNotes")}
                value={draft.hours}
                maxLength={4_000}
                placeholder={t("onboarding.company.hoursPlaceholder")}
                hint={t("businessProfile.hoursNotesHint")}
                onChange={(value) => updateField("hours", value)}
              />
              <TextAreaField
                id="business-profile-availability"
                testId="business-profile-availability"
                label={t("onboarding.company.availability")}
                value={draft.availability}
                maxLength={10_000}
                placeholder={t("onboarding.company.availabilityPlaceholder")}
                onChange={(value) => updateField("availability", value)}
              />
              <TextAreaField
                id="business-profile-faq"
                testId="business-profile-faq"
                label={t("onboarding.company.faq")}
                value={draft.faq}
                maxLength={20_000}
                placeholder={t("onboarding.company.faqPlaceholder")}
                onChange={(value) => updateField("faq", value)}
              />
              <TextAreaField
                id="business-profile-policies"
                testId="business-profile-policies"
                label={t("onboarding.company.policies")}
                value={draft.policies}
                maxLength={20_000}
                placeholder={t("onboarding.company.policiesPlaceholder")}
                onChange={(value) => updateField("policies", value)}
              />
              <TextAreaField
                id="business-profile-escalation-rules"
                testId="business-profile-escalation-rules"
                label={t("onboarding.company.escalation")}
                value={draft.escalationRules}
                maxLength={20_000}
                placeholder={t("onboarding.company.escalationPlaceholder")}
                onChange={(value) => updateField("escalationRules", value)}
              />
            </div>
          </FormSection>
        </fieldset>

        <div className="flex min-w-0 flex-col gap-4 border-t border-white/10 px-4 py-5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {saveError ? (
              <div className="flex min-w-0 items-start gap-2 text-sm text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="break-words font-medium">{saveError.message}</p>
                  {saveError.requestId ? (
                    <p className="mt-0.5 text-xs text-rose-300/55">
                      {t("knowledge.common.request", { id: saveError.requestId })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : savedNotice ? (
              <div className="flex min-w-0 items-start gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="max-w-3xl">{t("businessProfile.status.savedNote")}</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <Clock3 className="h-4 w-4" />
                {t("businessProfile.timezone")}: {draft.timezone}
              </div>
            )}
          </div>
          {canEdit ? (
            <Button
              type="submit"
              className="shrink-0"
              disabled={!dirty || saving || conflict}
              data-testid={saveError ? "business-profile-retry-save" : "business-profile-save"}
              onClick={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : saveError ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saveError ? t("businessProfile.retrySave") : t("businessProfile.save")}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function FormSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 px-4 py-6 sm:px-5">
      <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function FormField({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs text-rose-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TextAreaField({
  id,
  testId,
  label,
  value,
  maxLength,
  placeholder,
  hint,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  value: string;
  maxLength: number;
  placeholder: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <textarea
        id={id}
        data-testid={testId}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        className={textAreaClassName}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className="mt-1.5 text-xs leading-5 text-zinc-600">{hint}</p> : null}
    </FormField>
  );
}
