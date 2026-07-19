"use client";

import React from "react";
import {
  AlertTriangle,
  Check,
  Globe2,
  Loader2,
  LockKeyhole,
  RefreshCw,
  UserCheck,
  Users,
} from "lucide-react";
import type { KnowledgeV2Audience, KnowledgeV2SettingsView } from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import {
  createKnowledgeV2IdempotencyKey,
  getKnowledgeV2Settings,
  updateKnowledgeV2Settings,
} from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { Select } from "../ui";

const localeOptions = [
  { value: "en", labelKey: "knowledge.settings.locale.en" },
  { value: "es", labelKey: "knowledge.settings.locale.es" },
  { value: "fr", labelKey: "knowledge.settings.locale.fr" },
  { value: "de", labelKey: "knowledge.settings.locale.de" },
  { value: "pt", labelKey: "knowledge.settings.locale.pt" },
  { value: "ru", labelKey: "knowledge.settings.locale.ru" },
] satisfies { value: string; labelKey: TranslationKey }[];

const audienceOptions = [
  { value: "PUBLIC", labelKey: "knowledge.settings.audience.public", icon: Users },
  {
    value: "AUTHENTICATED_CUSTOMER",
    labelKey: "knowledge.settings.audience.authenticatedCustomer",
    icon: UserCheck,
  },
  { value: "INTERNAL", labelKey: "knowledge.settings.audience.internal", icon: LockKeyhole },
] satisfies {
  value: KnowledgeV2Audience;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
}[];

function configuredAudience(settings: KnowledgeV2SettingsView) {
  return settings.defaultScope?.audiences.length === 1
    ? (settings.defaultScope.audiences[0] ?? null)
    : null;
}

function scopeWithAudience(
  scope: KnowledgeV2SettingsView["defaultScope"],
  audience: KnowledgeV2Audience,
) {
  return {
    brandIds: [...(scope?.brandIds ?? [])],
    locationIds: [...(scope?.locationIds ?? [])],
    channelTypes: [...(scope?.channelTypes ?? [])],
    assistantIds: [...(scope?.assistantIds ?? [])],
    audiences: [audience],
    segments: [...(scope?.segments ?? [])],
    locales: [...(scope?.locales ?? [])],
  };
}

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export function KnowledgeSettingsPanel({
  canEdit,
  onChanged,
}: {
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = React.useState<KnowledgeV2SettingsView | null>(null);
  const [defaultLocale, setDefaultLocale] = React.useState("en");
  const [supportedLocales, setSupportedLocales] = React.useState<string[]>(["en"]);
  const [defaultAudience, setDefaultAudience] = React.useState<KnowledgeV2Audience | null>(null);
  const [audienceDirty, setAudienceDirty] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const initialized = React.useRef(false);
  const editGeneration = React.useRef(0);
  const saving = React.useRef(false);

  const load = React.useCallback(async () => {
    try {
      const response = await getKnowledgeV2Settings();
      setSettings(response.data);
      setDefaultLocale(response.data.defaultLocale);
      setSupportedLocales(response.data.supportedLocales);
      setDefaultAudience(configuredAudience(response.data));
      setAudienceDirty(false);
      setSaveState("idle");
      setError(null);
      setDirty(false);
      initialized.current = true;
    } catch {
      setError(t("knowledge.settings.loadError"));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = React.useCallback(async () => {
    if (!settings || !canEdit || saving.current) return;
    const generation = editGeneration.current;
    saving.current = true;
    setSaveState("saving");
    setError(null);
    try {
      const response = await updateKnowledgeV2Settings(
        {
          defaultLocale,
          supportedLocales,
          ...(audienceDirty && defaultAudience
            ? { defaultScope: scopeWithAudience(settings.defaultScope, defaultAudience) }
            : {}),
        },
        {
          "Idempotency-Key": createKnowledgeV2IdempotencyKey(),
          "If-Match": settings.etag,
        },
      );
      setSettings(response.data.resource);
      if (generation === editGeneration.current) {
        setDefaultLocale(response.data.resource.defaultLocale);
        setSupportedLocales(response.data.resource.supportedLocales);
        setDefaultAudience(configuredAudience(response.data.resource));
        setAudienceDirty(false);
        setSaveState("saved");
        setDirty(false);
      } else {
        setSaveState("idle");
      }
      onChanged?.();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 412) {
        setSaveState("conflict");
        setError(t("knowledge.settings.conflict"));
      } else {
        setSaveState("error");
        setError(t("knowledge.settings.saveError"));
      }
    } finally {
      saving.current = false;
    }
  }, [
    audienceDirty,
    canEdit,
    defaultAudience,
    defaultLocale,
    onChanged,
    settings,
    supportedLocales,
    t,
  ]);

  React.useEffect(() => {
    if (!initialized.current || !canEdit || !dirty) return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, save]);

  function changeDefaultLocale(next: string) {
    editGeneration.current += 1;
    setDefaultLocale(next);
    setSupportedLocales((current) => (current.includes(next) ? current : [...current, next]));
    setSaveState("idle");
    setDirty(true);
  }

  function toggleLocale(locale: string) {
    if (locale === defaultLocale) return;
    editGeneration.current += 1;
    setSupportedLocales((current) =>
      current.includes(locale) ? current.filter((item) => item !== locale) : [...current, locale],
    );
    setSaveState("idle");
    setDirty(true);
  }

  function changeDefaultAudience(audience: KnowledgeV2Audience) {
    if (!canEdit || audience === defaultAudience) return;
    editGeneration.current += 1;
    setDefaultAudience(audience);
    setAudienceDirty(true);
    setSaveState("idle");
    setDirty(true);
  }

  const defaultLocaleOption = localeOptions.find((locale) => locale.value === defaultLocale);

  if (!settings && !error) {
    return (
      <div className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.025]" />
    );
  }

  return (
    <section
      className="rounded-lg border border-white/10 bg-zinc-950/30 px-4 py-4"
      data-testid="knowledge-language-settings"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-start gap-3 xl:w-72">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
            <Globe2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{t("knowledge.settings.title")}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{t("knowledge.settings.description")}</p>
          </div>
        </div>

        {settings ? (
          <>
            <div className="w-full xl:w-48">
              <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                {t("knowledge.settings.primary")}
              </label>
              {canEdit ? (
                <Select
                  value={defaultLocale}
                  onValueChange={changeDefaultLocale}
                  options={localeOptions.map((locale) => ({
                    value: locale.value,
                    label: t(locale.labelKey),
                  }))}
                  ariaLabel={t("knowledge.settings.primary")}
                  className="h-9 rounded-lg max-sm:min-h-11"
                />
              ) : (
                <div className="flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.025] px-3 text-sm text-zinc-300">
                  {defaultLocaleOption ? t(defaultLocaleOption.labelKey) : defaultLocale}
                </div>
              )}
            </div>
            <fieldset className="min-w-0 flex-1">
              <legend className="mb-1.5 text-xs font-medium text-zinc-500">
                {t("knowledge.settings.supported")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {localeOptions.map((locale) => {
                  const checked = supportedLocales.includes(locale.value);
                  return (
                    <label
                      key={locale.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                        checked
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-white/10 text-zinc-500 hover:text-zinc-300",
                        (!canEdit || locale.value === defaultLocale) && "cursor-default opacity-70",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        disabled={!canEdit || locale.value === defaultLocale}
                        onChange={() => toggleLocale(locale.value)}
                      />
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-current">
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      {t(locale.labelKey)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : null}

        <div className="flex min-w-28 items-center justify-end gap-2 text-xs" aria-live="polite">
          {saveState === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
              <span className="text-zinc-400">{t("knowledge.settings.saving")}</span>
            </>
          ) : saveState === "saved" ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-300">{t("knowledge.settings.saved")}</span>
            </>
          ) : saveState === "error" || saveState === "conflict" || error ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-amber-300">{t("knowledge.settings.notSaved")}</span>
            </>
          ) : null}
          {saveState === "conflict" || (!settings && error) ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("knowledge.settings.reload")}
              onClick={() => void load()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          ) : saveState === "error" && settings ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("knowledge.settings.retry")}
              onClick={() => void save()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {settings ? (
        <div
          className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-center"
          data-testid="knowledge-default-audience"
        >
          <div className="flex min-w-0 items-center gap-3 lg:w-72">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-100">
                {t("knowledge.settings.audience.title")}
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                {defaultAudience
                  ? t("knowledge.settings.audience.configured")
                  : t("knowledge.settings.audience.notConfigured")}
              </p>
            </div>
          </div>
          <fieldset className="min-w-0 flex-1">
            <legend className="sr-only">{t("knowledge.settings.audience.title")}</legend>
            <div className="grid grid-cols-1 gap-1 rounded-lg border border-white/10 bg-black/20 p-1 sm:grid-cols-3">
              {audienceOptions.map((option) => {
                const checked = defaultAudience === option.value;
                const Icon = option.icon;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-md px-2.5 py-2 text-center text-xs font-medium transition-colors",
                      checked
                        ? "bg-white/10 text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
                      !canEdit && "cursor-default opacity-70",
                      canEdit && "cursor-pointer",
                    )}
                  >
                    <input
                      type="radio"
                      name="knowledge-default-audience"
                      value={option.value}
                      checked={checked}
                      disabled={!canEdit}
                      onChange={() => changeDefaultAudience(option.value)}
                      className="sr-only"
                    />
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">{t(option.labelKey)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-amber-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
