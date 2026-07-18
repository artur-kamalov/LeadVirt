"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Scissors,
  ShoppingBag,
  Stethoscope,
  GraduationCap,
  Car,
  MapPin,
  Briefcase,
  CalendarCheck,
  PackageCheck,
  MessageSquare,
  HeadphonesIcon,
  Building2,
  Clock,
  DollarSign,
  Database,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { BrandMark } from "../../components/BrandMark";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { BrandWordmark } from "../../components/BrandWordmark";
import { Card, channels } from "../shared";
import { Skeleton } from "../ui";
import { ResourceErrorState } from "../ResourceErrorState";
import { cn } from "../../lib/utils";
import {
  completeOnboardingStep,
  getOnboardingState,
  updateOnboardingState,
} from "@/lib/api/onboarding";
import { ApiClientError } from "@/lib/api/client";
import type { AcquisitionPlanId } from "@/lib/acquisition";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { localizeDemoSeedText } from "@/i18n/demo-seed-messages";

/* ------------------------------------------------------------------ */
/* Types & constants                                                    */
/* ------------------------------------------------------------------ */

type ChannelId = keyof typeof channels;

interface CompanyInfo {
  name: string;
  description: string;
  hours: string;
  avgCheck: string;
  servicesCatalog: string;
  availability: string;
  faq: string;
  policies: string;
  escalationRules: string;
}

const TOTAL_STEPS = 6;
const stepIds = ["business", "channels", "scenario", "company", "crm", "launch"] as const;

const businessTypes = [
  { id: "services", labelKey: "onboarding.business.services", icon: Briefcase },
  { id: "beauty", labelKey: "onboarding.business.beauty", icon: Scissors },
  { id: "shop", labelKey: "onboarding.business.shop", icon: ShoppingBag },
  { id: "clinic", labelKey: "onboarding.business.clinic", icon: Stethoscope },
  { id: "education", labelKey: "onboarding.business.education", icon: GraduationCap },
  { id: "auto", labelKey: "onboarding.business.auto", icon: Car },
  { id: "local", labelKey: "onboarding.business.local", icon: MapPin },
] satisfies Array<{ id: string; labelKey: TranslationKey; icon: typeof Briefcase }>;

const aiScenarios = [
  {
    id: "booking",
    labelKey: "onboarding.scenario.booking",
    descriptionKey: "onboarding.scenario.bookingDescription",
    icon: CalendarCheck,
  },
  {
    id: "order",
    labelKey: "onboarding.scenario.order",
    descriptionKey: "onboarding.scenario.orderDescription",
    icon: PackageCheck,
  },
  {
    id: "consult",
    labelKey: "onboarding.scenario.consult",
    descriptionKey: "onboarding.scenario.consultDescription",
    icon: MessageSquare,
  },
  {
    id: "support",
    labelKey: "onboarding.scenario.support",
    descriptionKey: "onboarding.scenario.supportDescription",
    icon: HeadphonesIcon,
  },
] satisfies Array<{
  id: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: typeof CalendarCheck;
}>;

const crmOptions = [
  {
    id: "amo",
    label: "amoCRM",
    descriptionKey: "onboarding.crm.amoDescription",
    icon: Database,
    availability: "planned",
  },
  {
    id: "bitrix",
    label: "Bitrix24",
    descriptionKey: "onboarding.crm.bitrixDescription",
    icon: Building2,
    availability: "planned",
  },
  {
    id: "retail",
    label: "RetailCRM",
    descriptionKey: "onboarding.crm.retailDescription",
    icon: ShoppingBag,
    availability: "planned",
  },
  {
    id: "none",
    labelKey: "onboarding.crm.none",
    descriptionKey: "onboarding.crm.noneDescription",
    icon: Bot,
    availability: "available",
  },
] satisfies Array<{
  id: string;
  label?: string;
  labelKey?: TranslationKey;
  descriptionKey: TranslationKey;
  icon: typeof Database;
  availability: SelectionAvailability;
}>;

const channelIds: ChannelId[] = [
  "instagram",
  "whatsapp",
  "telegram",
  "website",
  "webhook",
  "vk",
  "email",
  "call",
];

type SelectionAvailability = "available" | "request" | "planned";

const channelAvailability: Record<ChannelId, SelectionAvailability> = {
  telegram: "available",
  website: "available",
  webhook: "available",
  whatsapp: "request",
  instagram: "request",
  vk: "planned",
  email: "planned",
  call: "planned",
};

const availabilityKeys: Record<SelectionAvailability, TranslationKey> = {
  available: "onboarding.availability.available",
  request: "onboarding.availability.request",
  planned: "onboarding.availability.planned",
};

function AvailabilityBadge({ availability }: { availability: SelectionAvailability }) {
  const { t } = useI18n();

  return (
    <span
      className={cn(
        "inline-flex max-w-full whitespace-normal rounded-full border px-2 py-0.5 text-left text-[10px] font-semibold leading-tight",
        availability === "available"
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : availability === "request"
            ? "border-sky-400/25 bg-sky-400/10 text-sky-300"
            : "border-white/10 bg-white/5 text-zinc-500",
      )}
    >
      {t(availabilityKeys[availability])}
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stepIndexFromId(id: string) {
  const index = stepIds.findIndex((stepId) => stepId === id);
  return index >= 0 ? index : 0;
}

function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && channelIds.includes(value as ChannelId);
}

function stringFromData(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function channelsFromData(data: Record<string, unknown>): ChannelId[] {
  const value = data.selectedChannels;
  return Array.isArray(value) ? value.filter(isChannelId) : [];
}

function companyInfoFromData(data: Record<string, unknown>): CompanyInfo {
  const value = data.companyInfo;
  const record = isRecord(value) ? value : {};
  return {
    name: typeof record.name === "string" ? record.name : "",
    description: typeof record.description === "string" ? record.description : "",
    hours: typeof record.hours === "string" ? record.hours : "",
    avgCheck: typeof record.avgCheck === "string" ? record.avgCheck : "",
    servicesCatalog: typeof record.servicesCatalog === "string" ? record.servicesCatalog : "",
    availability: typeof record.availability === "string" ? record.availability : "",
    faq: typeof record.faq === "string" ? record.faq : "",
    policies: typeof record.policies === "string" ? record.policies : "",
    escalationRules: typeof record.escalationRules === "string" ? record.escalationRules : "",
  };
}

function localizeCompanyInfo(
  company: CompanyInfo,
  locale: Parameters<typeof localizeDemoSeedText>[1],
): CompanyInfo {
  return {
    name: localizeDemoSeedText(company.name, locale),
    description: localizeDemoSeedText(company.description, locale),
    hours: localizeDemoSeedText(company.hours, locale),
    avgCheck: localizeDemoSeedText(company.avgCheck, locale),
    servicesCatalog: localizeDemoSeedText(company.servicesCatalog, locale),
    availability: localizeDemoSeedText(company.availability, locale),
    faq: localizeDemoSeedText(company.faq, locale),
    policies: localizeDemoSeedText(company.policies, locale),
    escalationRules: localizeDemoSeedText(company.escalationRules, locale),
  };
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

function BackgroundGrid() {
  return (
    <>
      {/* subtle grid */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
        }}
      />
    </>
  );
}

function Logo({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-11 items-center gap-2.5 rounded-md disabled:cursor-wait disabled:opacity-60"
      aria-label={t("brand.name")}
    >
      <BrandMark className="h-9 w-9 rounded-xl shadow-lg shadow-emerald-500/20" />
      <BrandWordmark className="hidden text-sm sm:inline-flex" />
    </button>
  );
}

function ProgressBar({ step }: { step: number }) {
  const { t } = useI18n();
  const pct = ((step + 1) / TOTAL_STEPS) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-500 whitespace-nowrap">
        {t("onboarding.step", { current: step + 1, total: TOTAL_STEPS })}
      </span>
      <div
        className="h-1 w-24 overflow-hidden rounded-full bg-zinc-800 sm:w-40"
        role="progressbar"
        aria-label={t("onboarding.step", { current: step + 1, total: TOTAL_STEPS })}
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={step + 1}
      >
        <motion.div
          aria-hidden="true"
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}

/* SelectCard — reusable single/multi select card */
function SelectCard({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative w-full cursor-pointer rounded-2xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        selected
          ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_24px_rgba(52,211,153,0.15)]"
          : "border-white/5 bg-zinc-900/50 hover:border-white/10 hover:bg-zinc-900/80",
        className,
      )}
    >
      {selected && (
        <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center">
          <Check className="w-3 h-3 text-zinc-950" aria-hidden="true" />
        </span>
      )}
      {children}
    </motion.button>
  );
}

/* Step slide variants */
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

const transition = { duration: 0.35, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] };

/* ------------------------------------------------------------------ */
/* Steps                                                                */
/* ------------------------------------------------------------------ */

function StepBusinessType({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          {t("onboarding.business.title")}
        </h2>
        <p className="text-zinc-400 mt-2">{t("onboarding.business.description")}</p>
      </div>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        role="group"
        aria-label={t("onboarding.business.title")}
      >
        {businessTypes.map((b) => {
          const Icon = b.icon;
          return (
            <SelectCard key={b.id} selected={value === b.id} onClick={() => onChange(b.id)}>
              <div className="flex flex-col items-start gap-2 pr-4">
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center",
                    value === b.id ? "bg-emerald-400/20" : "bg-white/5",
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4.5 h-4.5",
                      value === b.id ? "text-emerald-400" : "text-zinc-400",
                    )}
                  />
                </div>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    value === b.id ? "text-emerald-300" : "text-zinc-200",
                  )}
                >
                  {t(b.labelKey)}
                </span>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepChannels({
  value,
  onChange,
}: {
  value: ChannelId[];
  onChange: (v: ChannelId[]) => void;
}) {
  const { t } = useI18n();
  const toggle = (id: ChannelId) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          {t("onboarding.channels.title")}
        </h2>
        <p className="text-zinc-400 mt-2">{t("onboarding.channels.description")}</p>
      </div>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        role="group"
        aria-label={t("onboarding.channels.title")}
      >
        {channelIds.map((id) => {
          const ch = channels[id];
          const Icon = ch.icon;
          const sel = value.includes(id);
          return (
            <SelectCard key={id} selected={sel} onClick={() => toggle(id)}>
              <div className="flex items-center gap-2.5 pr-4">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    ch.bg,
                  )}
                >
                  <Icon className={cn("w-4 h-4", ch.color)} />
                </div>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm font-semibold",
                      sel ? "text-emerald-300" : "text-zinc-200",
                    )}
                  >
                    {ch.labelKey ? t(ch.labelKey) : ch.label}
                  </span>
                  <AvailabilityBadge availability={channelAvailability[id]} />
                </span>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepScenario({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          {t("onboarding.scenario.title")}
        </h2>
        <p className="text-zinc-400 mt-2">{t("onboarding.scenario.description")}</p>
      </div>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        role="group"
        aria-label={t("onboarding.scenario.title")}
      >
        {aiScenarios.map((s) => {
          const Icon = s.icon;
          const sel = value === s.id;
          return (
            <SelectCard key={s.id} selected={sel} onClick={() => onChange(s.id)}>
              <div className="flex flex-col gap-2 pr-4">
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center",
                    sel ? "bg-emerald-400/20" : "bg-white/5",
                  )}
                >
                  <Icon className={cn("w-4.5 h-4.5", sel ? "text-emerald-400" : "text-zinc-400")} />
                </div>
                <div>
                  <div
                    className={cn("text-sm font-bold", sel ? "text-emerald-300" : "text-zinc-100")}
                  >
                    {t(s.labelKey)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                    {t(s.descriptionKey)}
                  </div>
                </div>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepCompanyInfo({
  value,
  onChange,
}: {
  value: CompanyInfo;
  onChange: (v: CompanyInfo) => void;
}) {
  const { t } = useI18n();
  const fieldIdPrefix = React.useId();
  const fieldId = (key: keyof CompanyInfo) => `${fieldIdPrefix}-${key}`;
  const field = (k: keyof CompanyInfo) => ({
    id: fieldId(k),
    value: value[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...value, [k]: e.target.value }),
  });
  const inputCls =
    "w-full h-11 bg-white/5 border border-white/5 rounded-xl px-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:bg-white/[0.07] transition-colors";
  const textareaCls = cn(inputCls, "h-auto py-3 resize-none leading-relaxed");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          {t("onboarding.company.title")}
        </h2>
        <p className="text-zinc-400 mt-2">{t("onboarding.company.description")}</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("name")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.name")} <span aria-hidden="true">*</span>
          </label>
          <input
            {...field("name")}
            required
            placeholder={t("onboarding.company.namePlaceholder")}
            className={inputCls}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("description")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.about")} <span aria-hidden="true">*</span>
          </label>
          <textarea
            {...field("description")}
            required
            rows={3}
            placeholder={t("onboarding.company.aboutPlaceholder")}
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("servicesCatalog")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.catalog")}
          </label>
          <textarea
            {...field("servicesCatalog")}
            rows={5}
            placeholder={t("onboarding.company.catalogPlaceholder")}
            className={textareaCls}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor={fieldId("hours")}
              className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              <Clock className="w-3 h-3" />
              {t("onboarding.company.hours")}
            </label>
            <input
              {...field("hours")}
              placeholder={t("onboarding.company.hoursPlaceholder")}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={fieldId("avgCheck")}
              className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              <DollarSign className="w-3 h-3" />
              {t("onboarding.company.average")}
            </label>
            <input
              {...field("avgCheck")}
              placeholder={t("onboarding.company.averagePlaceholder")}
              className={inputCls}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("availability")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.availability")}
          </label>
          <textarea
            {...field("availability")}
            rows={4}
            placeholder={t("onboarding.company.availabilityPlaceholder")}
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("faq")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.faq")}
          </label>
          <textarea
            {...field("faq")}
            rows={4}
            placeholder={t("onboarding.company.faqPlaceholder")}
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("policies")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.policies")}
          </label>
          <textarea
            {...field("policies")}
            rows={4}
            placeholder={t("onboarding.company.policiesPlaceholder")}
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={fieldId("escalationRules")}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider"
          >
            {t("onboarding.company.escalation")}
          </label>
          <textarea
            {...field("escalationRules")}
            rows={3}
            placeholder={t("onboarding.company.escalationPlaceholder")}
            className={textareaCls}
          />
        </div>
      </div>
    </div>
  );
}

function StepCRM({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          {t("onboarding.crm.title")}
        </h2>
        <p className="text-zinc-400 mt-2">{t("onboarding.crm.description")}</p>
      </div>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        role="group"
        aria-label={t("onboarding.crm.title")}
      >
        {crmOptions.map((c) => {
          const Icon = c.icon;
          const sel = value === c.id;
          return (
            <SelectCard key={c.id} selected={sel} onClick={() => onChange(c.id)}>
              <div className="flex flex-col gap-2 pr-4">
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center",
                    sel ? "bg-emerald-400/20" : "bg-white/5",
                  )}
                >
                  <Icon className={cn("w-4.5 h-4.5", sel ? "text-emerald-400" : "text-zinc-400")} />
                </div>
                <div>
                  <div
                    className={cn("text-sm font-bold", sel ? "text-emerald-300" : "text-zinc-100")}
                  >
                    {c.labelKey ? t(c.labelKey) : c.label}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">{t(c.descriptionKey)}</div>
                  <div className="mt-2">
                    <AvailabilityBadge availability={c.availability} />
                  </div>
                </div>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepLaunch({
  businessType,
  selectedChannels,
  scenario,
  crm,
  companyName,
  nextAction,
  onLaunch,
  disabled,
  saving,
}: {
  businessType: string | null;
  selectedChannels: ChannelId[];
  scenario: string | null;
  crm: string | null;
  companyName: string;
  nextAction: "billing" | "knowledge" | "dashboard";
  onLaunch: () => void;
  disabled: boolean;
  saving: boolean;
}) {
  const { t } = useI18n();
  const business = businessTypes.find((item) => item.id === businessType);
  const selectedScenario = aiScenarios.find((item) => item.id === scenario);
  const selectedCrm = crmOptions.find((item) => item.id === crm);
  const btLabel = business ? t(business.labelKey) : "—";
  const scenLabel = selectedScenario ? t(selectedScenario.labelKey) : "—";
  const crmBaseLabel = selectedCrm
    ? selectedCrm.labelKey
      ? t(selectedCrm.labelKey)
      : selectedCrm.label
    : "—";
  const crmLabel =
    selectedCrm && selectedCrm.availability !== "available"
      ? `${crmBaseLabel} · ${t(availabilityKeys[selectedCrm.availability])}`
      : crmBaseLabel;
  const channelLabels = selectedChannels.map((id) => {
    const label = channels[id].labelKey ? t(channels[id].labelKey) : channels[id].label;
    const availability = channelAvailability[id];
    return availability === "available" ? label : `${label} · ${t(availabilityKeys[availability])}`;
  });
  const actionLabel =
    nextAction === "billing"
      ? t("onboarding.continue.billing")
      : nextAction === "knowledge"
        ? t("onboarding.continue.knowledge")
        : t("onboarding.launch");

  const summaryItems = [
    { label: t("onboarding.summary.business"), value: btLabel },
    {
      label: t("onboarding.summary.channels"),
      value: channelLabels.length ? channelLabels.join(", ") : t("onboarding.summary.notSelected"),
    },
    { label: t("onboarding.summary.scenario"), value: scenLabel },
    { label: "CRM", value: crmLabel },
    ...(companyName ? [{ label: t("onboarding.summary.company"), value: companyName }] : []),
  ];

  return (
    <div className="space-y-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
          className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-2xl shadow-emerald-500/30"
        >
          <Check className="w-10 h-10 text-zinc-950 stroke-[2.5]" />
        </motion.div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">
            {t("onboarding.ready.title")}
          </h2>
          <p className="text-zinc-400 mt-2">{t("onboarding.ready.description")}</p>
        </div>
      </div>

      {/* Summary card */}
      <Card className="p-5 text-left">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          {t("onboarding.ready.summary")}
        </div>
        <div className="space-y-2.5">
          {summaryItems.map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-4">
              <span className="text-sm text-zinc-500 shrink-0">{item.label}</span>
              <span className="text-sm text-zinc-200 font-medium text-right">{item.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Launch button (desktop) */}
      <div className="hidden sm:flex justify-center">
        <Button
          size="lg"
          onClick={onLaunch}
          disabled={disabled}
          className="gap-2 shadow-xl shadow-emerald-500/20"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {saving ? t("onboarding.saving") : actionLabel}
          {!saving ? <ChevronRight className="w-5 h-5" aria-hidden="true" /> : null}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                            */
/* ------------------------------------------------------------------ */

export function OnboardingPage({
  selectedPlan = null,
}: {
  selectedPlan?: AcquisitionPlanId | null;
}) {
  const { locale, t } = useI18n();
  const { go, mode } = useNav();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1); // slide direction
  const [saving, setSaving] = useState(false);
  const [persistenceError, setPersistenceError] = useState(false);
  const [persistenceConflict, setPersistenceConflict] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadRevision, setLoadRevision] = useState(0);
  const hasLocalChangesRef = useRef(false);
  const businessProfileEtagRef = useRef<string | null>(null);
  const localeRef = useRef(locale);

  // Step state
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<ChannelId[]>([]);
  const [scenario, setScenario] = useState<string | null>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    name: "",
    description: "",
    hours: "",
    avgCheck: "",
    servicesCatalog: "",
    availability: "",
    faq: "",
    policies: "",
    escalationRules: "",
  });
  const [crm, setCrm] = useState<string | null>(null);

  useEffect(() => {
    localeRef.current = locale;
    if (mode !== "demo" || loadStatus !== "success" || hasLocalChangesRef.current) return;
    setCompanyInfo((current) => localizeCompanyInfo(current, locale));
  }, [loadStatus, locale, mode]);

  useEffect(() => {
    let active = true;
    setLoadStatus("loading");

    void getOnboardingState()
      .then((state) => {
        if (!active) return;
        businessProfileEtagRef.current = state.businessProfileEtag;
        if (!hasLocalChangesRef.current) {
          const data = isRecord(state.data) ? state.data : {};
          setBusinessType(stringFromData(data, "businessType"));
          setSelectedChannels(channelsFromData(data));
          setScenario(stringFromData(data, "scenario"));
          const loadedCompanyInfo = companyInfoFromData(data);
          setCompanyInfo(
            mode === "demo"
              ? localizeCompanyInfo(loadedCompanyInfo, localeRef.current)
              : loadedCompanyInfo,
          );
          setCrm(stringFromData(data, "crm"));
          setStep(stepIndexFromId(state.currentStep));
        }
        setPersistenceConflict(false);
        setLoadStatus("success");
      })
      .catch(() => {
        if (!active) return;
        setLoadStatus("error");
      });

    return () => {
      active = false;
    };
  }, [loadRevision, mode]);

  const navigate = (nextStep: number) => {
    setDir(nextStep > step ? 1 : -1);
    setStep(nextStep);
  };

  const markLocalChange = () => {
    hasLocalChangesRef.current = true;
  };

  const updateBusinessType = (value: string) => {
    markLocalChange();
    setBusinessType(value);
  };

  const updateSelectedChannels = (value: ChannelId[]) => {
    markLocalChange();
    setSelectedChannels(value);
  };

  const updateScenario = (value: string) => {
    markLocalChange();
    setScenario(value);
  };

  const updateCompanyInfo = (value: CompanyInfo) => {
    markLocalChange();
    setCompanyInfo(value);
  };

  const updateCrm = (value: string) => {
    markLocalChange();
    setCrm(value);
  };

  const onboardingDataForStep = (stepId: (typeof stepIds)[number]): Record<string, unknown> => {
    switch (stepId) {
      case "business":
        return { businessType };
      case "channels":
        return { selectedChannels };
      case "scenario":
        return { scenario };
      case "company":
        return { companyInfo };
      case "crm":
        return { crm };
      case "launch":
        return {};
    }
  };

  const rememberBusinessProfileEtag = (etag: string) => {
    businessProfileEtagRef.current = etag;
  };

  const persistProgress = async (
    completedStepId: (typeof stepIds)[number],
    nextStepId: (typeof stepIds)[number],
  ) => {
    setPersistenceError(false);
    setPersistenceConflict(false);

    try {
      const stepData = onboardingDataForStep(completedStepId);
      const profileAffectingStep = completedStepId === "business" || completedStepId === "company";
      const updated = await updateOnboardingState(
        {
          currentStep: completedStepId,
          ...(Object.keys(stepData).length > 0 ? { data: stepData } : {}),
        },
        profileAffectingStep ? { ifMatch: businessProfileEtagRef.current ?? undefined } : undefined,
      );
      if (profileAffectingStep) rememberBusinessProfileEtag(updated.businessProfileEtag);

      await completeOnboardingStep(completedStepId);

      if (nextStepId !== completedStepId) {
        await updateOnboardingState({ currentStep: nextStepId });
      }
      hasLocalChangesRef.current = false;
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 412) {
        setPersistenceConflict(true);
      } else {
        setPersistenceError(true);
      }
      return false;
    }
  };

  const reloadAfterConflict = () => {
    businessProfileEtagRef.current = null;
    hasLocalChangesRef.current = false;
    setPersistenceConflict(false);
    setPersistenceError(false);
    setLoadRevision((current) => current + 1);
  };

  const isStepValid = () => {
    if (step === 0) return !!businessType;
    if (step === 1) return selectedChannels.length > 0;
    if (step === 2) return !!scenario;
    if (step === 3)
      return companyInfo.name.trim().length > 0 && companyInfo.description.trim().length > 0;
    if (step === 4) return !!crm;
    return true;
  };

  const handleNext = async () => {
    if (!isStepValid() || saving || persistenceConflict) return;

    if (step < TOTAL_STEPS - 1) {
      const nextStep = step + 1;
      setSaving(true);
      const persisted = await persistProgress(stepIds[step], stepIds[nextStep]);
      setSaving(false);
      if (!persisted) return;
      navigate(nextStep);
      return;
    }

    await handleLaunch();
  };

  const handleBack = () => {
    if (step > 0 && !saving && !persistenceConflict) navigate(step - 1);
  };

  const handleLaunch = async () => {
    if (saving || persistenceConflict) return;
    setSaving(true);
    const persisted = await persistProgress("launch", "launch");
    setSaving(false);
    if (!persisted) return;
    if (mode === "demo") {
      go("dashboard");
      return;
    }
    if (selectedPlan) {
      router.push(`/app/billing?plan=${encodeURIComponent(selectedPlan)}`);
      return;
    }
    go("knowledge", { welcome: 1 });
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepBusinessType value={businessType} onChange={updateBusinessType} />;
      case 1:
        return <StepChannels value={selectedChannels} onChange={updateSelectedChannels} />;
      case 2:
        return <StepScenario value={scenario} onChange={updateScenario} />;
      case 3:
        return <StepCompanyInfo value={companyInfo} onChange={updateCompanyInfo} />;
      case 4:
        return <StepCRM value={crm} onChange={updateCrm} />;
      case 5:
        return (
          <StepLaunch
            businessType={businessType}
            selectedChannels={selectedChannels}
            scenario={scenario}
            crm={crm}
            companyName={companyInfo.name}
            nextAction={mode === "demo" ? "dashboard" : selectedPlan ? "billing" : "knowledge"}
            onLaunch={() => void handleLaunch()}
            disabled={saving || persistenceConflict}
            saving={saving}
          />
        );
      default:
        return null;
    }
  };

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-50 flex flex-col overflow-x-hidden">
      <BackgroundGrid />

      {/* ---- Top bar ---- */}
      <header className="relative z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b border-white/5 bg-zinc-950/95 px-4 py-3 sm:flex sm:justify-between sm:px-8 sm:py-4">
        <Logo onClick={() => go("landing")} disabled={saving} />
        <div className="order-3 col-span-2 flex min-w-0 justify-center sm:order-none sm:col-span-1 sm:block">
          {loadStatus === "success" ? (
            <ProgressBar step={step} />
          ) : loadStatus === "loading" ? (
            <Skeleton className="h-8 w-40 sm:w-64" />
          ) : (
            <span className="max-w-full truncate text-xs text-red-300 sm:max-w-[14rem] sm:text-sm">
              {t("resource.loadFailed.title")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <LanguageSwitcher compact className="h-11" />
          <button
            type="button"
            onClick={() => go("dashboard")}
            disabled={saving}
            aria-label={t("onboarding.skip")}
            className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-wait disabled:opacity-60"
          >
            <X className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("onboarding.skip")}</span>
          </button>
        </div>
      </header>

      {/* ---- Step content ---- */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 pb-32 sm:pb-12">
        <div className="w-full max-w-2xl">
          {loadStatus === "loading" ? (
            <div className="space-y-4" data-testid="onboarding-state-loading">
              <Skeleton className="h-80 w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-11 w-28" />
                <Skeleton className="h-11 w-28" />
              </div>
            </div>
          ) : loadStatus === "error" ? (
            <Card className="p-6 sm:p-8">
              <ResourceErrorState
                testId="onboarding-state-load-error"
                onRetry={() => setLoadRevision((current) => current + 1)}
              />
            </Card>
          ) : (
            <>
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  data-testid="onboarding-step-panel"
                  key={step}
                  custom={dir}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={transition}
                >
                  <Card className="p-6 sm:p-8">{renderStep()}</Card>
                </motion.div>
              </AnimatePresence>

              <p className="sr-only" role="status" aria-live="polite">
                {saving ? t("onboarding.saving") : ""}
              </p>

              {persistenceError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  data-testid="onboarding-persistence-error"
                  className="mt-4 flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100"
                >
                  <AlertCircle
                    className="mt-0.5 h-5 w-5 shrink-0 text-red-400"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold">{t("onboarding.saveError.title")}</p>
                    <p className="mt-1 text-sm text-red-200/80">
                      {t("onboarding.saveError.description")}
                    </p>
                  </div>
                </div>
              )}

              {persistenceConflict && (
                <div
                  role="alert"
                  aria-live="assertive"
                  data-testid="onboarding-persistence-conflict"
                  className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex gap-3">
                    <AlertCircle
                      className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-sm font-semibold">{t("businessProfile.conflict.title")}</p>
                      <p className="mt-1 text-sm text-amber-200/80">
                        {t("businessProfile.conflict.description")}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={reloadAfterConflict}
                    className="shrink-0"
                  >
                    {t("businessProfile.conflict.reload")}
                  </Button>
                </div>
              )}

              {!isLastStep && (
                <div className="hidden sm:flex items-center justify-between mt-6">
                  <Button
                    variant="ghost"
                    onClick={handleBack}
                    disabled={step === 0 || saving || persistenceConflict}
                    className="gap-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    {t("onboarding.back")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void handleNext()}
                    disabled={!isStepValid() || saving || persistenceConflict}
                    className="gap-1.5"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {saving ? t("onboarding.saving") : t("onboarding.next")}
                    {!saving ? <ChevronRight className="w-4 h-4" aria-hidden="true" /> : null}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ---- Mobile sticky bottom bar ---- */}
      {loadStatus === "success" && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-20 border-t border-white/5 bg-zinc-950 px-4 py-3 safe-area-inset-bottom">
          {isLastStep ? (
            <Button
              size="lg"
              onClick={() => void handleLaunch()}
              disabled={saving || persistenceConflict}
              className="min-h-11 w-full gap-2 shadow-xl shadow-emerald-500/20"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
              {saving
                ? t("onboarding.saving")
                : mode === "demo"
                  ? t("onboarding.launch")
                  : selectedPlan
                    ? t("onboarding.continue.billing")
                    : t("onboarding.continue.knowledge")}
              {!saving ? <ChevronRight className="w-5 h-5" aria-hidden="true" /> : null}
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={step === 0 || saving || persistenceConflict}
                aria-label={t("onboarding.back")}
                className="h-12 w-12 shrink-0 p-0 flex items-center justify-center"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={() => void handleNext()}
                disabled={!isStepValid() || saving || persistenceConflict}
                className="min-h-11 flex-1 gap-1.5"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                {saving ? t("onboarding.saving") : t("onboarding.next")}
                {!saving ? <ChevronRight className="w-5 h-5" aria-hidden="true" /> : null}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
