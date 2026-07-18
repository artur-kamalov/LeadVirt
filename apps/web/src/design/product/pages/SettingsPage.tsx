"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  Channel,
  ChannelAutomaticReplyReadiness,
  ChannelStatus,
  ChannelType,
  PricingPlanCode,
  SettingsAccount,
} from "@leadvirt/types";
import { motion, AnimatePresence } from "motion/react";
import QRCode from "qrcode";
import {
  Building2,
  Users,
  Radio,
  Bell,
  CreditCard,
  Shield,
  Key,
  ChevronRight,
  MoreHorizontal,
  Copy,
  Trash2,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  LogOut,
  Plus,
  Upload,
  Monitor,
  Smartphone,
  Globe,
  Download,
  UserCog,
  UserX,
  ShieldCheck,
  RotateCcw,
  Send,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import { Card, Avatar, Pill, channels } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  Modal,
  ConfirmDialog,
  Tip,
  Select as BrandSelect,
} from "../ui";
import { toast } from "sonner";
import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  getAccountSettings,
  getLegacyApiKeys,
  getNotificationsSettings,
  getSecuritySettings,
  getTeamSettings,
  inviteTeamMember,
  removeTeamMember,
  revokeApiKey,
  revokeOtherSecuritySessions,
  revokeSecuritySession,
  regenerateTwoFactorRecoveryCodes,
  startTwoFactorSetup,
  type NotificationsSettings,
  type SecuritySession,
  type TeamRole,
  updateAccountSettings,
  updateNotificationsSettings,
  updateTeamMemberRole,
} from "@/lib/api/settings";
import {
  cancelCurrentSubscription,
  getBillingPlanSelection,
  getBillingPaymentMethod,
  getBillingUsage,
  getCurrentSubscription,
  listBillingInvoices,
  listBillingPlans,
  requestBillingPaymentMethodChange,
  selectBillingPlan,
} from "@/lib/api/billing";
import {
  activateChannelAutomaticReplies,
  createChannel,
  deactivateChannelAutomaticReplies,
  getChannelAutomaticReplyReadiness,
  listChannels,
  rotateChannelWebhookSecret,
  sendWebhookChannelSampleInbound,
  updateChannel,
  updateChannelWebhookOutbound,
  type WebhookOutboundSettingsPatch,
} from "@/lib/api/channels";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeDemoSeedText } from "@/i18n/demo-seed-messages";
import type { TranslationKey } from "@/i18n/messages";
import { useCurrentUser, useProductPermissions } from "../CurrentUser";
import { useProductMode } from "../ProductMode";
import { ResourceErrorState } from "../ResourceErrorState";

/* ============================================================
   Reusable primitives
   ============================================================ */

function Toggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none",
        checked ? "bg-emerald-500" : "bg-white/10",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full bg-white/5 border border-white/5 rounded-xl px-4 h-11 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all",
        className,
      )}
      {...props}
    />
  );
}

function Select({
  className,
  children,
  defaultValue,
  value,
  onChange,
  ariaLabel,
}: {
  className?: string;
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  ariaLabel?: string;
}) {
  // Convert <option> children into brand Select options.
  const options = React.Children.toArray(children)
    .filter((c): c is React.ReactElement<{ value: string; children: React.ReactNode }> =>
      React.isValidElement(c),
    )
    .map((c) => ({ value: String(c.props.value), label: c.props.children }));

  return (
    <BrandSelect
      className={className}
      options={options}
      defaultValue={defaultValue ?? (typeof value === "string" ? undefined : options[0]?.value)}
      value={value}
      onValueChange={onChange}
      ariaLabel={ariaLabel}
    />
  );
}

function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none",
        className,
      )}
      {...props}
    />
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold tracking-tight text-zinc-50">{title}</h2>
      {description && <p className="text-sm text-zinc-400 mt-1">{description}</p>}
    </div>
  );
}

function showLocalizedError(error: unknown, message: string) {
  toast.error(message, { description: error instanceof Error ? error.message : undefined });
}

/* ============================================================
   Tab definitions
   ============================================================ */

type TabId = "profile" | "team" | "channels" | "notifications" | "billing" | "security" | "api";

const tabs = [
  { id: "profile", labelKey: "settings.tab.profile", icon: Building2 },
  { id: "team", labelKey: "settings.tab.team", icon: Users },
  { id: "channels", labelKey: "settings.tab.channels", icon: Radio },
  { id: "notifications", labelKey: "settings.tab.notifications", icon: Bell },
  { id: "billing", labelKey: "settings.tab.billing", icon: CreditCard },
  { id: "security", labelKey: "settings.tab.security", icon: Shield },
] as const;

type TeamSettings = Awaited<ReturnType<typeof getTeamSettings>>;
type SecuritySettings = Awaited<ReturnType<typeof getSecuritySettings>>;
type BillingPlan = Awaited<ReturnType<typeof listBillingPlans>>[number];
type BillingSubscription = Awaited<ReturnType<typeof getCurrentSubscription>>;
type BillingPlanSelection = Awaited<ReturnType<typeof getBillingPlanSelection>>;
type BillingUsage = Awaited<ReturnType<typeof getBillingUsage>>;
type BillingPaymentMethod = Awaited<ReturnType<typeof getBillingPaymentMethod>>;
type BillingInvoice = Awaited<ReturnType<typeof listBillingInvoices>>[number];
type SettingsResource = "account" | "team" | "security" | "notifications";
type SettingsResourceStatus = "loading" | "ready" | "error";

const settingsResources: SettingsResource[] = ["account", "team", "security", "notifications"];
const settingsResourceByTab: Partial<Record<TabId, SettingsResource>> = {
  profile: "account",
  team: "team",
  notifications: "notifications",
  security: "security",
};

interface BillingDisplayPlan {
  id: string;
  code: PricingPlanCode | null;
  name: string;
  tagline: string;
  price: string;
  priceNote: string;
  features: string[];
  popular: boolean;
}

interface SettingsApiState {
  account: SettingsAccount | null;
  setAccount: (account: SettingsAccount) => void;
  team: TeamSettings | null;
  setTeam: React.Dispatch<React.SetStateAction<TeamSettings | null>>;
  security: SecuritySettings | null;
  setSecurity: (security: SecuritySettings) => void;
  notifications: NotificationsSettings | null;
  setNotifications: (notifications: NotificationsSettings) => void;
}

const SettingsApiContext = React.createContext<SettingsApiState>({
  account: null,
  setAccount: () => {},
  team: null,
  setTeam: () => {},
  security: null,
  setSecurity: () => {},
  notifications: null,
  setNotifications: () => {},
});

function useSettingsApi() {
  return React.useContext(SettingsApiContext);
}

function SettingsResourceLoading() {
  return (
    <div className="space-y-5" data-testid="settings-resource-loading" aria-busy="true">
      <div className="h-7 w-52 animate-pulse rounded bg-white/10" />
      <div className="h-4 w-full max-w-md animate-pulse rounded bg-white/[0.06]" />
      <div className="h-56 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
    </div>
  );
}

function roleLabel(role: string, i18n: SettingsI18n) {
  const labels: Record<string, string> = {
    OWNER: i18n.t("settings.team.role.admin"),
    ADMIN: i18n.t("settings.team.role.admin"),
    MANAGER: i18n.t("settings.team.role.manager"),
    AGENT: i18n.t("settings.team.role.agent"),
    VIEWER: i18n.t("settings.team.role.viewer"),
  };
  return labels[role] ?? role;
}

function roleColor(role: string) {
  if (role === "OWNER" || role === "ADMIN") return "bg-emerald-500/15 text-emerald-300";
  if (role === "MANAGER") return "bg-indigo-500/15 text-indigo-300";
  return "bg-amber-500/15 text-amber-300";
}

type SettingsI18n = ReturnType<typeof useI18n>;

function formatRub(value: number | null | undefined, i18n: SettingsI18n) {
  if (typeof value !== "number") return i18n.t("settings.common.custom");
  return i18n.formatCurrency(value, "RUB");
}

function planName(plan: Pick<BillingPlan, "code" | "name"> | null | undefined, i18n: SettingsI18n) {
  const labels: Record<string, string> = {
    START: i18n.t("settings.billing.plan.start"),
    PROFESSIONAL: i18n.t("settings.billing.plan.professional"),
    BUSINESS: i18n.t("settings.billing.plan.business"),
    CORPORATE: i18n.t("settings.billing.plan.corporate"),
    Start: i18n.t("settings.billing.plan.start"),
    Professional: i18n.t("settings.billing.plan.professional"),
    Business: i18n.t("settings.billing.plan.business"),
    Corporate: i18n.t("settings.billing.plan.corporate"),
  };

  return (
    labels[plan?.code ?? ""] ??
    labels[plan?.name ?? ""] ??
    plan?.name ??
    i18n.t("settings.billing.plan.business")
  );
}

function planCodeFromQuery(value: string | null): PricingPlanCode | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "START") return "START";
  if (normalized === "PRO" || normalized === "PROFESSIONAL") return "PROFESSIONAL";
  if (normalized === "BUSINESS") return "BUSINESS";
  if (normalized === "CORPORATE") return "CORPORATE";
  return null;
}

const billingPlanCopy: Record<
  PricingPlanCode,
  { tagline: TranslationKey; features: TranslationKey[] }
> = {
  START: {
    tagline: "pricing.start.tagline",
    features: [
      "pricing.feature.ai500",
      "pricing.feature.channels2",
      "pricing.feature.users3",
      "pricing.feature.scenarios3",
      "pricing.feature.basicAnalytics",
    ],
  },
  PROFESSIONAL: {
    tagline: "pricing.pro.tagline",
    features: [
      "pricing.feature.ai2500",
      "pricing.feature.channels5",
      "pricing.feature.users10",
      "pricing.feature.scenarios15",
      "pricing.feature.basicAnalytics",
    ],
  },
  BUSINESS: {
    tagline: "pricing.business.tagline",
    features: [
      "pricing.feature.ai10000",
      "pricing.feature.channels10",
      "pricing.feature.users25",
      "pricing.feature.scenarios50",
      "pricing.feature.basicAnalytics",
    ],
  },
  CORPORATE: {
    tagline: "pricing.corporate.tagline",
    features: [
      "pricing.feature.customLimits",
    ],
  },
};

function apiPlanToDesignPlan(plan: BillingPlan, i18n: SettingsI18n): BillingDisplayPlan {
  const copy = billingPlanCopy[plan.code];
  return {
    id: plan.code.toLowerCase(),
    code: plan.code,
    name: planName(plan, i18n),
    tagline: i18n.t(copy.tagline),
    price:
      plan.code === "CORPORATE"
        ? i18n.t("settings.billing.priceFrom", { price: formatRub(plan.priceMonthlyRub, i18n) })
        : formatRub(plan.priceMonthlyRub, i18n),
    priceNote:
      typeof plan.priceMonthlyRub === "number"
        ? i18n.t("settings.billing.perMonth")
        : i18n.t("settings.billing.byAgreement"),
    features: copy.features.map((key) => i18n.t(key)),
    popular: Boolean(plan.popular),
  };
}

function billingInvoiceStatusLabel(status: BillingInvoice["status"], i18n: SettingsI18n) {
  const labels: Record<BillingInvoice["status"], string> = {
    PAID: i18n.t("settings.billing.status.paid"),
    DUE: i18n.t("settings.billing.status.due"),
    CANCELED: i18n.t("settings.billing.status.canceled"),
  };
  return labels[status];
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildInvoiceText(
  invoice: BillingInvoice,
  businessName: string | undefined,
  i18n: SettingsI18n,
) {
  const amount = formatRub(invoice.amountRub, i18n);
  const date = (value: string) =>
    i18n.formatDate(value, { day: "2-digit", month: "short", year: "numeric" });
  return [
    "LeadVirt.ai",
    i18n.t("settings.billing.invoice.id", { value: invoice.id }),
    i18n.t("settings.billing.invoice.customer", {
      value: businessName ?? i18n.t("settings.billing.invoice.defaultCustomer"),
    }),
    i18n.t("settings.billing.invoice.plan", { value: planName(invoice.plan, i18n) }),
    i18n.t("settings.billing.invoice.period", {
      start: date(invoice.periodStart),
      end: date(invoice.periodEnd),
    }),
    i18n.t("settings.billing.invoice.issued", { date: date(invoice.issuedAt) }),
    i18n.t("settings.billing.invoice.amount", { value: amount }),
    i18n.t("settings.billing.invoice.status", {
      value: billingInvoiceStatusLabel(invoice.status, i18n),
    }),
    "",
    i18n.t("settings.billing.invoice.mode"),
    i18n.t("settings.billing.invoice.note"),
  ].join("\n");
}

/* ============================================================
   Tab contents
   ============================================================ */

const LOGO_MAX_BYTES = 60 * 1024;

const businessTypeLabelKeys: Record<string, TranslationKey> = {
  services: "onboarding.business.services",
  beauty: "onboarding.business.beauty",
  fitness: "settings.profile.industry.fitness",
  shop: "onboarding.business.shop",
  retail: "settings.profile.industry.retail",
  clinic: "onboarding.business.clinic",
  education: "onboarding.business.education",
  auto: "onboarding.business.auto",
  local: "onboarding.business.local",
  other: "settings.profile.industry.other",
};

function businessTypeLabel(value: string | null | undefined, i18n: SettingsI18n) {
  const normalized = value?.trim() || "other";
  const key = businessTypeLabelKeys[normalized];
  return key ? i18n.t(key) : normalized;
}

function ProfileTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const { demo } = useProductMode();
  const permissions = useProductPermissions();
  const { account, setAccount } = useSettingsApi();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const skipNextAccountHydration = useRef(false);
  const businessName =
    demo && account?.businessName
      ? localizeDemoSeedText(account.businessName, i18n.locale)
      : account?.businessName;
  const businessDescription =
    demo && account?.description
      ? localizeDemoSeedText(account.description, i18n.locale)
      : account?.description;

  useEffect(() => {
    if (!account) return;
    if (skipNextAccountHydration.current) {
      skipNextAccountHydration.current = false;
      return;
    }
    setPhone(account.phone ?? "");
    setWebsite(account.website ?? "");
    setLogoDataUrl(account.logoDataUrl ?? null);
  }, [account]);

  const normalizedPhone = phone.trim() || null;
  const normalizedWebsite = website.trim() || null;
  const contactsDirty = Boolean(
    account &&
      (normalizedPhone !== (account.phone?.trim() || null) ||
        normalizedWebsite !== (account.website?.trim() || null)),
  );

  const handleSave = async () => {
    if (!permissions.canManageAccount || !account || !contactsDirty) return;
    setSaving(true);
    try {
      const updated = await updateAccountSettings({
        phone: normalizedPhone,
        website: normalizedWebsite,
      });
      setAccount(updated);
      setSaved(true);
      toast.success(t("settings.profile.savedToast"));
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      showLocalizedError(error, t("settings.profile.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const saveLogo = async (nextLogoDataUrl: string | null) => {
    if (!permissions.canManageAccount) return;
    setLogoUploading(true);
    try {
      const updated = await updateAccountSettings({ logoDataUrl: nextLogoDataUrl });
      skipNextAccountHydration.current = true;
      setAccount(updated);
      setLogoDataUrl(updated.logoDataUrl ?? null);
      toast.success(
        nextLogoDataUrl ? t("settings.profile.logoUpdated") : t("settings.profile.logoRemoved"),
      );
    } catch (error) {
      showLocalizedError(error, t("settings.profile.logoError"));
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error(t("settings.profile.logoTypeError"));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error(t("settings.profile.logoSizeError"));
      return;
    }

    try {
      const nextLogoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("empty"));
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
      await saveLogo(nextLogoDataUrl);
    } catch {
      toast.error(t("settings.profile.logoReadError"));
    }
  };

  return (
    <>
      {demo && !permissions.canManageAccount ? (
        <div
          className="mb-5 flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="settings-demo-read-only-notice"
        >
          <div className="flex min-w-0 items-center gap-2.5 text-sm text-zinc-300">
            <Eye aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{t("settings.profile.demoReadOnly")}</span>
          </div>
          <Button asChild size="sm" className="min-h-11 shrink-0">
            <Link href="/signup">{t("product.billing.createAccount")}</Link>
          </Button>
        </div>
      ) : null}
      <fieldset
        className="m-0 min-w-0 space-y-6 border-0 p-0"
        disabled={!permissions.canManageAccount}
        data-testid={
          permissions.canManageAccount ? "settings-profile-editor" : "settings-profile-read-only"
        }
      >
      <SectionHeader
        title={t("settings.profile.title")}
        description={t("settings.profile.description")}
      />

      <div
        className="min-w-0 space-y-4 border-y border-white/10 py-5"
        data-testid="settings-business-profile-summary"
      >
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-200">
                {t("businessProfile.settingsCta.title")}
              </p>
              <p className="mt-1 max-w-2xl text-xs text-zinc-500">
                {t("businessProfile.settingsCta.description")}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link
              href={demo ? "/demo/knowledge?view=business" : "/app/knowledge?view=business"}
              data-testid="settings-business-profile-link"
            >
              {t("businessProfile.settingsCta.action")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        <dl className="grid min-w-0 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              {t("settings.profile.name")}
            </dt>
            <dd
              className="mt-1 break-words text-sm font-medium text-zinc-200"
              data-testid="settings-business-profile-name"
            >
              {businessName || "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              {t("settings.profile.industry")}
            </dt>
            <dd
              className="mt-1 break-words text-sm text-zinc-300"
              data-testid="settings-business-profile-type"
            >
              {businessTypeLabel(account?.tenant.businessType, i18n)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              {t("settings.profile.timezone")}
            </dt>
            <dd
              className="mt-1 break-words text-sm text-zinc-300"
              data-testid="settings-business-profile-timezone"
            >
              {account?.timezone || "—"}
            </dd>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              {t("settings.profile.about")}
            </dt>
            <dd
              className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400"
              data-testid="settings-business-profile-description"
            >
              {businessDescription || "—"}
            </dd>
          </div>
        </dl>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-5">
          {logoDataUrl ? (
            <img
              src={logoDataUrl}
              alt=""
              data-testid="settings-logo-preview"
              className="h-16 w-16 rounded-full border border-white/10 object-cover"
            />
          ) : (
            <Avatar name={businessName ?? ""} size={64} />
          )}
          <div>
            <p className="text-sm font-semibold text-zinc-200 mb-1">{t("settings.profile.logo")}</p>
            <p className="text-xs text-zinc-500 mb-3">{t("settings.profile.logoHint")}</p>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              data-testid="settings-logo-input"
              onChange={(event) => void handleLogoSelected(event)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid="settings-logo-upload"
                disabled={logoUploading || !account}
                onClick={() => logoInputRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                {logoUploading ? t("settings.profile.uploading") : t("settings.profile.upload")}
              </Button>
              {logoDataUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="settings-logo-remove"
                  disabled={logoUploading}
                  onClick={() => void saveLogo(null)}
                >
                  {t("settings.common.delete")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            {t("settings.profile.contactsTitle")}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">{t("settings.profile.contactsDescription")}</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t("settings.profile.email")} hint={t("settings.profile.emailHint")}>
            <Input
              data-testid="settings-account-email"
              type="email"
              value={account?.owner.email ?? ""}
              readOnly
              placeholder={t("settings.profile.emailPlaceholder")}
            />
          </Field>

          <Field label={t("settings.profile.phone")}>
            <Input
              data-testid="settings-profile-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={t("settings.profile.phonePlaceholder")}
            />
          </Field>
        </div>

        <Field label={t("settings.profile.website")}>
          <Input
            data-testid="settings-profile-website"
            type="url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://"
          />
        </Field>

        <div className="flex justify-end pt-2">
          <Button
            data-testid="settings-contact-save"
            onClick={() => void handleSave()}
            disabled={saving || !account || !contactsDirty}
            className="gap-2"
          >
            <AnimatePresence mode="wait" initial={false}>
              {saved ? (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-2"
                >
                  <Check className="w-4 h-4" /> {t("settings.common.saved")}
                </motion.span>
              ) : (
                <motion.span
                  key="save"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  {saving ? t("settings.common.saving") : t("settings.common.save")}
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </Card>
      </fieldset>
    </>
  );
}

function TeamTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const { team, setTeam } = useSettingsApi();
  const currentUser = useCurrentUser();
  const permissions = useProductPermissions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("AGENT");
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [savingInvite, setSavingInvite] = useState(false);
  const teamMutationInFlightRef = useRef(false);
  const canManageTeam = permissions.canManageTeam;
  const actorIsAdmin = permissions.role === "ADMIN";
  const members = (team ?? []).map((membership, index) => ({
    id: membership.id,
    name: membership.user.name ?? membership.user.email,
    email: membership.user.email,
    userId: membership.user.id,
    isSelf: membership.user.id === currentUser.id,
    role: roleLabel(membership.role, i18n),
    roleCode: membership.role,
    roleColor: roleColor(membership.role),
    online: index === 0,
  }));

  const openDeleteConfirm = (member: { id: string; name: string }) => {
    setDeleteTarget({ id: member.id, name: member.name });
    setConfirmDelete(true);
  };

  const handleRoleChange = async (memberId: string, role: TeamRole) => {
    if (!canManageTeam || teamMutationInFlightRef.current) return;
    if (!team) {
      toast.error(t("settings.team.apiUnavailable"));
      return;
    }
    if (
      team.some((membership) => membership.id === memberId && membership.user.id === currentUser.id)
    ) {
      return;
    }
    teamMutationInFlightRef.current = true;
    setSavingMemberId(memberId);
    try {
      const updated = await updateTeamMemberRole(memberId, role);
      setTeam(
        (current) =>
          current?.map((membership) => (membership.id === updated.id ? updated : membership)) ??
          current,
      );
      toast.success(t("settings.team.roleUpdated"));
    } catch (error) {
      showLocalizedError(error, t("settings.team.roleError"));
    } finally {
      teamMutationInFlightRef.current = false;
      setSavingMemberId(null);
    }
  };

  const handleInvite = async () => {
    if (!canManageTeam || teamMutationInFlightRef.current) return;
    if (!inviteEmail.trim()) {
      toast.error(t("settings.team.emailRequired"));
      return;
    }
    teamMutationInFlightRef.current = true;
    setSavingInvite(true);
    try {
      const created = await inviteTeamMember({
        email: inviteEmail,
        ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
        role: inviteRole,
      });
      setTeam((current) => [
        ...(current?.filter((membership) => membership.id !== created.id) ?? []),
        created,
      ]);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("AGENT");
      toast.success(t("settings.team.added"));
    } catch (error) {
      showLocalizedError(error, t("settings.team.addError"));
    } finally {
      teamMutationInFlightRef.current = false;
      setSavingInvite(false);
    }
  };

  const handleRemove = async () => {
    if (!canManageTeam || teamMutationInFlightRef.current) return;
    if (!deleteTarget || !team) return;
    if (
      team.some(
        (membership) => membership.id === deleteTarget.id && membership.user.id === currentUser.id,
      )
    ) {
      return;
    }
    teamMutationInFlightRef.current = true;
    setSavingMemberId(deleteTarget.id);
    try {
      await removeTeamMember(deleteTarget.id);
      setTeam(
        (current) => current?.filter((membership) => membership.id !== deleteTarget.id) ?? current,
      );
      toast.success(t("settings.team.removed"));
    } catch (error) {
      showLocalizedError(error, t("settings.team.removeError"));
    } finally {
      teamMutationInFlightRef.current = false;
      setSavingMemberId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.team.title")}
        description={t("settings.team.description")}
      />

      {/* Roles legend */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
          {t("settings.team.accessLevels")}
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            {
              role: t("settings.team.role.admin"),
              desc: t("settings.team.adminDesc"),
              color: "text-emerald-300 bg-emerald-500/15",
            },
            {
              role: t("settings.team.role.manager"),
              desc: t("settings.team.managerDesc"),
              color: "text-indigo-300 bg-indigo-500/15",
            },
            {
              role: t("settings.team.role.agent"),
              desc: t("settings.team.agentDesc"),
              color: "text-amber-300 bg-amber-500/15",
            },
          ].map((r) => (
            <div
              key={r.role}
              className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2"
            >
              <Pill className={r.color}>{r.role}</Pill>
              <span className="text-xs text-zinc-500">{r.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="divide-y divide-white/5">
        {members.length === 0 && (
          <div className="px-5 py-6">
            <p className="text-sm font-semibold text-zinc-100">{t("settings.team.empty")}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("settings.team.emptyDesc")}</p>
          </div>
        )}
        {members.map((member) => (
          <div
            key={member.id}
            data-testid={`settings-team-member-${member.id}`}
            className="flex items-center gap-4 px-5 py-4 relative"
          >
            <div className="relative shrink-0">
              <Avatar name={member.name} size={40} />
              {member.online && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-zinc-900" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{member.name}</p>
              <p className="text-xs text-zinc-500 truncate">{member.email}</p>
            </div>

            <Pill className={cn("hidden sm:inline-flex", member.roleColor)}>{member.role}</Pill>

            {canManageTeam && !member.isSelf && !(actorIsAdmin && member.roleCode === "OWNER") && (
              <Dropdown
                trigger={
                  <button
                    aria-label={t("settings.team.manage", { name: member.name })}
                    disabled={savingMemberId !== null || savingInvite}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                }
              >
                {(["ADMIN", "MANAGER", "AGENT", "VIEWER"] as TeamRole[]).map((role) => (
                  <DropdownItem
                    key={role}
                    icon={UserCog}
                    onClick={() => void handleRoleChange(member.id, role)}
                  >
                    {roleLabel(role, i18n)}
                  </DropdownItem>
                ))}
                <DropdownSeparator />
                <DropdownItem danger icon={UserX} onClick={() => openDeleteConfirm(member)}>
                  {t("settings.team.remove")}
                </DropdownItem>
              </Dropdown>
            )}
          </div>
        ))}
      </Card>

      {canManageTeam && (
        <div className="flex justify-end">
          <Button
            aria-label={t("settings.team.invite")}
            onClick={() => setInviteOpen(true)}
            disabled={savingMemberId !== null || savingInvite}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {t("settings.team.invite")}
          </Button>
        </div>
      )}

      {canManageTeam ? (
        <Modal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          title={t("settings.team.invite")}
          description={t("settings.team.inviteDescription")}
          className="max-w-md"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setInviteOpen(false)}
                disabled={savingInvite}
              >
                {t("settings.common.cancel")}
              </Button>
              <Button
                onClick={() => void handleInvite()}
                disabled={savingInvite || savingMemberId !== null}
              >
                {savingInvite ? t("settings.team.adding") : t("settings.team.add")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label={t("settings.team.name")}>
              <Input
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                placeholder={t("settings.team.namePlaceholder")}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="name@company.ru"
              />
            </Field>
            <Field label={t("settings.team.role")}>
              <Select value={inviteRole} onChange={(value) => setInviteRole(value as TeamRole)}>
                <option value="ADMIN">{t("settings.team.role.admin")}</option>
                <option value="MANAGER">{t("settings.team.role.manager")}</option>
                <option value="AGENT">{t("settings.team.role.agent")}</option>
                <option value="VIEWER">{t("settings.team.role.viewer")}</option>
              </Select>
            </Field>
          </div>
        </Modal>
      ) : null}

      {canManageTeam ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t("settings.team.deleteTitle")}
          description={t("settings.team.deleteDescription", {
            name: deleteTarget?.name ?? t("settings.team.memberFallback"),
          })}
          danger
          confirmLabel={t("settings.common.delete")}
          onConfirm={handleRemove}
        />
      ) : null}
    </div>
  );
}

const channelEntries = Object.entries(channels) as [
  keyof typeof channels,
  (typeof channels)[keyof typeof channels],
][];

type DesignChannelId = keyof typeof channels;

type WidgetSettingsForm = {
  title: string;
  subtitle: string;
  businessName: string;
  welcomeMessage: string;
  primaryColor: string;
  accentColor: string;
  position: "bottom-right" | "bottom-left";
  suggestedRepliesText: string;
  consentText: string;
  poweredBy: string;
};

type WebhookOutboundAuthMode = "preserve" | "none" | "bearer" | "custom";

type WebhookOutboundForm = {
  targetUrl: string;
  removeTarget: boolean;
  authMode: WebhookOutboundAuthMode;
  headerName: string;
  secret: string;
};

type WebhookOutboundFormErrors = Partial<
  Record<"targetUrl" | "headerName" | "secret" | "request", string>
>;

type WebhookSampleResult = Awaited<ReturnType<typeof sendWebhookChannelSampleInbound>>;

const webhookSampleMessageKey = {
  sent: "settings.channels.webhookSampleSent",
  queued: "settings.channels.webhookSampleQueued",
  skipped: "settings.channels.webhookSampleSkipped",
  failed: "settings.channels.webhookSampleFailed",
} as const satisfies Record<WebhookSampleResult["outboundStatus"], string>;

const channelTypeByDesignId: Record<DesignChannelId, ChannelType> = {
  instagram: "INSTAGRAM",
  whatsapp: "WHATSAPP",
  telegram: "TELEGRAM",
  website: "WEBSITE",
  webhook: "WEBHOOK",
  vk: "VK",
  email: "EMAIL",
  call: "PHONE",
};

const creatableChannelIds = new Set<DesignChannelId>(["website", "webhook"]);

const defaultWidgetSettings: WidgetSettingsForm = {
  title: "LeadVirt.ai",
  subtitle: "AI-администратор",
  businessName: "Демо-компания",
  welcomeMessage:
    "Здравствуйте! Я AI-администратор LeadVirt.ai. Отвечу на вопросы, уточню заявку и передам контекст менеджеру.",
  primaryColor: "#34d399",
  accentColor: "#10b981",
  position: "bottom-right",
  suggestedRepliesText: "Хочу записаться\nСколько стоит?\nПозовите менеджера",
  consentText:
    "Отправляя сообщение, вы соглашаетесь, что команда может связаться с вами по этой заявке.",
  poweredBy: "LeadVirt.ai",
};

const reservedWebhookAuthHeaders = new Set([
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-leadvirt-delivery-id",
  "x-leadvirt-event",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringFromRecord(source: Record<string, unknown>, key: string, fallback: string) {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function widgetFormFromChannel(channel: Channel | null): WidgetSettingsForm {
  const settings = asRecord(channel?.settings);
  const widget = isRecord(settings.widget) ? asRecord(settings.widget) : settings;
  const suggestedReplies = Array.isArray(widget.suggestedReplies)
    ? widget.suggestedReplies.filter((item): item is string => typeof item === "string")
    : defaultWidgetSettings.suggestedRepliesText.split("\n");

  return {
    title: stringFromRecord(widget, "title", defaultWidgetSettings.title),
    subtitle: stringFromRecord(widget, "subtitle", defaultWidgetSettings.subtitle),
    businessName: stringFromRecord(widget, "businessName", defaultWidgetSettings.businessName),
    welcomeMessage: stringFromRecord(
      widget,
      "welcomeMessage",
      defaultWidgetSettings.welcomeMessage,
    ),
    primaryColor: stringFromRecord(widget, "primaryColor", defaultWidgetSettings.primaryColor),
    accentColor: stringFromRecord(widget, "accentColor", defaultWidgetSettings.accentColor),
    position: widget.position === "bottom-left" ? "bottom-left" : "bottom-right",
    suggestedRepliesText: suggestedReplies.join("\n"),
    consentText: stringFromRecord(widget, "consentText", defaultWidgetSettings.consentText),
    poweredBy: stringFromRecord(widget, "poweredBy", defaultWidgetSettings.poweredBy),
  };
}

function widgetSettingsPayload(form: WidgetSettingsForm) {
  return {
    widget: {
      title: form.title,
      subtitle: form.subtitle,
      businessName: form.businessName,
      welcomeMessage: form.welcomeMessage,
      primaryColor: form.primaryColor,
      accentColor: form.accentColor,
      position: form.position,
      locale: "ru-RU",
      suggestedReplies: form.suggestedRepliesText
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
      consentText: form.consentText,
      poweredBy: form.poweredBy,
    },
  };
}

function publicApiOrigin() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api")
    .replace(/\/api\/?$/, "")
    .replace(/\/$/, "");
}

function webhookConnectionDetails(channel: Channel | null) {
  const publicKey = channel?.publicKey ?? "";
  const settings = asRecord(channel?.settings);
  const webhook = isRecord(settings.webhook) ? asRecord(settings.webhook) : settings;
  const outbound = asRecord(webhook.outbound);
  return {
    publicKey,
    secretConfigured: webhook.secretConfigured === true,
    secretHeader: "x-leadvirt-webhook-secret",
    outboundTargetConfigured: outbound.targetConfigured === true,
    outboundAuthenticationConfigured: outbound.authenticationConfigured === true,
    endpoint: publicKey
      ? `${publicApiOrigin()}/api/public/channels/webhook/${publicKey}/events`
      : "",
  };
}

function webhookOutboundFormFromChannel(channel: Channel | null): WebhookOutboundForm {
  const details = webhookConnectionDetails(channel);
  return {
    targetUrl: "",
    removeTarget: false,
    authMode: details.outboundAuthenticationConfigured ? "preserve" : "none",
    headerName: "x-webhook-token",
    secret: "",
  };
}

function channelStatusLabel(status: ChannelStatus, i18n: SettingsI18n) {
  const labels: Record<ChannelStatus, string> = {
    ACTIVE: i18n.t("settings.channels.status.active"),
    DISABLED: i18n.t("settings.channels.status.disabled"),
    ERROR: i18n.t("settings.channels.status.error"),
    PENDING: i18n.t("settings.channels.status.pending"),
    COMING_SOON: i18n.t("settings.channels.status.soon"),
  };
  return labels[status];
}

function channelStatusClass(status: ChannelStatus) {
  if (status === "ACTIVE") return "text-emerald-400";
  if (status === "ERROR") return "text-rose-400";
  if (status === "PENDING") return "text-amber-400";
  return "text-zinc-500";
}

function ChannelsTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const permissions = useProductPermissions();
  const [apiChannels, setApiChannels] = useState<Channel[] | null>(null);
  const [channelsLoadState, setChannelsLoadState] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const channelsLoadRequestRef = useRef(0);
  const [automaticReplyReadiness, setAutomaticReplyReadiness] = useState<
    Record<string, ChannelAutomaticReplyReadiness | null>
  >({});
  const [selectedWidgetChannel, setSelectedWidgetChannel] = useState<Channel | null>(null);
  const [selectedWebhookChannel, setSelectedWebhookChannel] = useState<Channel | null>(null);
  const [widgetForm, setWidgetForm] = useState<WidgetSettingsForm>(defaultWidgetSettings);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [webhookRotateConfirmOpen, setWebhookRotateConfirmOpen] = useState(false);
  const [webhookOneTimeSecret, setWebhookOneTimeSecret] = useState("");
  const [webhookOutboundForm, setWebhookOutboundForm] = useState<WebhookOutboundForm>(() =>
    webhookOutboundFormFromChannel(null),
  );
  const [webhookOutboundErrors, setWebhookOutboundErrors] = useState<WebhookOutboundFormErrors>({});
  const [webhookSampleResult, setWebhookSampleResult] = useState<WebhookSampleResult | null>(null);
  const [webhookSampleError, setWebhookSampleError] = useState(false);
  const [savingChannelId, setSavingChannelId] = useState<string | null>(null);
  const canRotateWebhookSecret = permissions.canManageChannelSecrets;
  const canManageWebhookOutbound = permissions.canManageChannelSecrets;

  const loadChannels = useCallback(async () => {
    const requestId = ++channelsLoadRequestRef.current;
    setChannelsLoadState("loading");
    setApiChannels(null);
    setAutomaticReplyReadiness({});

    try {
      const items = await listChannels();
      if (requestId !== channelsLoadRequestRef.current) return;
      setApiChannels(items);
      setChannelsLoadState("success");

      const supported = items.filter((item) =>
        ["WEBSITE", "TELEGRAM", "WEBHOOK"].includes(item.type),
      );
      const readiness = await Promise.all(
        supported.map(async (item) => {
          try {
            return [item.id, await getChannelAutomaticReplyReadiness(item.id)] as const;
          } catch {
            return [item.id, null] as const;
          }
        }),
      );
      if (requestId === channelsLoadRequestRef.current) {
        setAutomaticReplyReadiness(Object.fromEntries(readiness));
      }
    } catch {
      if (requestId !== channelsLoadRequestRef.current) return;
      setApiChannels(null);
      setChannelsLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadChannels();
    return () => {
      channelsLoadRequestRef.current += 1;
    };
  }, [loadChannels]);

  const channelForDesignId = (id: DesignChannelId) =>
    apiChannels?.find((channel) => channel.type === channelTypeByDesignId[id]) ?? null;

  const refreshAutomaticReplyReadiness = async (channelId: string) => {
    try {
      const readiness = await getChannelAutomaticReplyReadiness(channelId);
      setAutomaticReplyReadiness((previous) => ({ ...previous, [channelId]: readiness }));
      return readiness;
    } catch {
      setAutomaticReplyReadiness((previous) => ({ ...previous, [channelId]: null }));
      return null;
    }
  };

  const openWebhookSettings = (channel: Channel | null, oneTimeSecret = "") => {
    if (!channel) {
      toast.error(t("settings.channels.webhookMissing"));
      return;
    }
    setSelectedWebhookChannel(channel);
    setWebhookOneTimeSecret(oneTimeSecret);
    setWebhookOutboundForm(webhookOutboundFormFromChannel(channel));
    setWebhookOutboundErrors({});
    setWebhookSampleResult(null);
    setWebhookSampleError(false);
    setWebhookModalOpen(true);
  };

  const changeWebhookModalOpen = (open: boolean) => {
    if (
      !open &&
      [
        `webhook-outbound:${selectedWebhookChannel?.id ?? ""}`,
        `webhook-sample:${selectedWebhookChannel?.id ?? ""}`,
      ].includes(savingChannelId ?? "")
    ) {
      return;
    }
    setWebhookModalOpen(open);
    if (!open) {
      setWebhookOneTimeSecret("");
      setWebhookOutboundForm(webhookOutboundFormFromChannel(null));
      setWebhookOutboundErrors({});
      setWebhookSampleResult(null);
      setWebhookSampleError(false);
      setWebhookRotateConfirmOpen(false);
    }
  };

  const createWorkspaceChannel = async (id: DesignChannelId) => {
    if (!permissions.canManageChannels || channelsLoadState !== "success") return null;
    if (!creatableChannelIds.has(id)) {
      toast.error(t("settings.channels.providerOnly"));
      return null;
    }

    const label = channels[id].label;
    const savingId = `create:${id}`;
    setSavingChannelId(savingId);
    try {
      const result = await createChannel({
        type: channelTypeByDesignId[id] as "WEBSITE" | "WEBHOOK",
        name: label,
        status: "ACTIVE",
      });
      const { oneTimeSecret, ...created } = result;
      setApiChannels((prev) => (prev ? [...prev, created] : [created]));
      void refreshAutomaticReplyReadiness(created.id);
      toast.success(t("settings.channels.created"), { description: created.publicKey ?? label });
      if (id === "webhook") openWebhookSettings(created, oneTimeSecret);
      return created;
    } catch (error) {
      showLocalizedError(error, t("settings.channels.createError"));
      return null;
    } finally {
      setSavingChannelId(null);
    }
  };

  const openWidgetSettings = (channel: Channel | null) => {
    if (!channel) {
      toast.error(t("settings.channels.websiteMissing"));
      return;
    }
    setSelectedWidgetChannel(channel);
    setWidgetForm(widgetFormFromChannel(channel));
    setWidgetModalOpen(true);
  };

  const toggleChannel = async (id: DesignChannelId, checked: boolean) => {
    if (!permissions.canManageChannels || channelsLoadState !== "success") return;
    const channel = channelForDesignId(id);
    if (!channel) {
      if (checked) {
        await createWorkspaceChannel(id);
        return;
      }
      toast.error(t("settings.channels.missing"));
      return;
    }
    if (channel.status === "COMING_SOON") {
      toast(t("settings.channels.soon"));
      return;
    }

    const nextStatus: ChannelStatus = checked ? "ACTIVE" : "DISABLED";
    const previousChannels = apiChannels;
    setApiChannels((prev) =>
      prev
        ? prev.map((item) => (item.id === channel.id ? { ...item, status: nextStatus } : item))
        : prev,
    );
    setSavingChannelId(channel.id);
    try {
      const updated = await updateChannel(channel.id, { status: nextStatus });
      setApiChannels((prev) =>
        prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : prev,
      );
      toast(checked ? t("settings.channels.enabled") : t("settings.channels.disabled"));
      void refreshAutomaticReplyReadiness(channel.id);
    } catch (error) {
      setApiChannels(previousChannels);
      showLocalizedError(error, t("settings.channels.updateError"));
    } finally {
      setSavingChannelId(null);
    }
  };

  const toggleAutomaticReplies = async (channel: Channel, checked: boolean) => {
    if (!permissions.canManageChannelSecrets) return;
    const readiness = automaticReplyReadiness[channel.id];
    if (checked && readiness && !readiness.canActivate) {
      toast.error(t("settings.channels.automaticRepliesBlocked"));
      return;
    }
    setSavingChannelId(`automatic:${channel.id}`);
    try {
      const updated = checked
        ? await activateChannelAutomaticReplies(channel.id)
        : await deactivateChannelAutomaticReplies(channel.id);
      setAutomaticReplyReadiness((previous) => ({ ...previous, [channel.id]: updated }));
      setApiChannels((previous) =>
        previous
          ? previous.map((item) =>
              item.id === channel.id
                ? {
                    ...item,
                    automaticRepliesEnabled: updated.enabled,
                    automaticRepliesGeneration: updated.generation,
                    automaticRepliesPublicationId: updated.enabled
                      ? updated.activePublicationId
                      : null,
                    automaticRepliesPublicationEtag: updated.enabled
                      ? updated.activePublicationEtag
                      : null,
                    automaticRepliesActivatedAt: updated.activatedAt,
                  }
                : item,
            )
          : previous,
      );
      toast.success(
        t(
          checked
            ? "settings.channels.automaticRepliesEnabled"
            : "settings.channels.automaticRepliesDisabled",
        ),
      );
    } catch (error) {
      showLocalizedError(error, t("settings.channels.automaticRepliesError"));
      void refreshAutomaticReplyReadiness(channel.id);
    } finally {
      setSavingChannelId(null);
    }
  };

  const saveWidgetSettings = async () => {
    if (!permissions.canManageChannels) return;
    if (!selectedWidgetChannel) return;
    setSavingChannelId(selectedWidgetChannel.id);
    try {
      const updated = await updateChannel(selectedWidgetChannel.id, {
        status:
          selectedWidgetChannel.status === "COMING_SOON" ? "PENDING" : selectedWidgetChannel.status,
        settings: widgetSettingsPayload(widgetForm),
      });
      setApiChannels((prev) =>
        prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : prev,
      );
      setSelectedWidgetChannel(updated);
      setWidgetModalOpen(false);
      toast.success(t("settings.channels.widgetSaved"));
      void refreshAutomaticReplyReadiness(updated.id);
    } catch (error) {
      showLocalizedError(error, t("settings.channels.widgetSaveError"));
    } finally {
      setSavingChannelId(null);
    }
  };

  const handleRotateWebhookSecret = async () => {
    if (!selectedWebhookChannel || !canRotateWebhookSecret) return;
    const savingId = `webhook-secret:${selectedWebhookChannel.id}`;
    setSavingChannelId(savingId);
    try {
      const result = await rotateChannelWebhookSecret(selectedWebhookChannel.id);
      setApiChannels((previous) =>
        previous
          ? previous.map((channel) => (channel.id === result.channel.id ? result.channel : channel))
          : previous,
      );
      setSelectedWebhookChannel(result.channel);
      setWebhookOneTimeSecret(result.oneTimeSecret);
      void refreshAutomaticReplyReadiness(result.channel.id);
      toast.success(t("settings.channels.webhookSecretRotated"));
    } catch (error) {
      showLocalizedError(error, t("settings.channels.webhookSecretRotateError"));
    } finally {
      setSavingChannelId(null);
    }
  };

  const saveWebhookOutboundSettings = async () => {
    if (!selectedWebhookChannel || !canManageWebhookOutbound) return;

    const details = webhookConnectionDetails(selectedWebhookChannel);
    const targetUrl = webhookOutboundForm.targetUrl.trim();
    const headerName = webhookOutboundForm.headerName.trim().toLowerCase();
    const secret = webhookOutboundForm.secret;
    const errors: WebhookOutboundFormErrors = {};

    if (!webhookOutboundForm.removeTarget && !targetUrl && !details.outboundTargetConfigured) {
      errors.targetUrl = t("settings.channels.webhookOutboundTargetRequired");
    } else if (!webhookOutboundForm.removeTarget && targetUrl) {
      try {
        const parsed = new URL(targetUrl);
        if (
          targetUrl.length > 2_048 ||
          parsed.protocol !== "https:" ||
          !parsed.hostname ||
          parsed.username ||
          parsed.password ||
          parsed.port ||
          parsed.hash
        ) {
          errors.targetUrl = t("settings.channels.webhookOutboundTargetInvalid");
        }
      } catch {
        errors.targetUrl = t("settings.channels.webhookOutboundTargetInvalid");
      }
    }

    if (webhookOutboundForm.authMode === "custom" && !webhookOutboundForm.removeTarget) {
      if (
        !/^x-[!#$%&'*+.^_`|~0-9a-z-]{1,126}$/u.test(headerName) ||
        reservedWebhookAuthHeaders.has(headerName)
      ) {
        errors.headerName = t("settings.channels.webhookOutboundHeaderInvalid");
      }
    }

    if (
      !webhookOutboundForm.removeTarget &&
      (webhookOutboundForm.authMode === "bearer" || webhookOutboundForm.authMode === "custom") &&
      !secret
    ) {
      errors.secret = t("settings.channels.webhookOutboundSecretRequired");
    } else if (
      !webhookOutboundForm.removeTarget &&
      secret &&
      (secret.length > 4_096 ||
        [...secret].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || code > 126;
        }))
    ) {
      errors.secret = t("settings.channels.webhookOutboundSecretInvalid");
    }

    if (Object.keys(errors).length > 0) {
      setWebhookOutboundErrors(errors);
      return;
    }

    const outbound: WebhookOutboundSettingsPatch = {};
    if (webhookOutboundForm.removeTarget) {
      outbound.targetUrl = null;
      outbound.auth = null;
    } else if (targetUrl) {
      outbound.targetUrl = targetUrl;
    }
    if (!webhookOutboundForm.removeTarget && webhookOutboundForm.authMode === "none") {
      outbound.auth = null;
    } else if (!webhookOutboundForm.removeTarget && webhookOutboundForm.authMode === "bearer") {
      outbound.auth = {
        headerName: "authorization",
        scheme: "Bearer",
        secret,
      };
    } else if (!webhookOutboundForm.removeTarget && webhookOutboundForm.authMode === "custom") {
      outbound.auth = {
        headerName,
        secret,
      };
    }

    const savingId = `webhook-outbound:${selectedWebhookChannel.id}`;
    setSavingChannelId(savingId);
    setWebhookOutboundErrors({});
    try {
      const updated = await updateChannelWebhookOutbound(selectedWebhookChannel.id, outbound);
      setApiChannels((previous) =>
        previous
          ? previous.map((channel) => (channel.id === updated.id ? updated : channel))
          : previous,
      );
      setSelectedWebhookChannel(updated);
      setWebhookOutboundForm(webhookOutboundFormFromChannel(updated));
      setWebhookSampleResult(null);
      setWebhookSampleError(false);
      toast.success(t("settings.channels.webhookOutboundSaved"));
      void refreshAutomaticReplyReadiness(updated.id);
    } catch (error) {
      setWebhookOutboundErrors({
        request: t("settings.channels.webhookOutboundSaveError"),
      });
      showLocalizedError(error, t("settings.channels.webhookOutboundSaveError"));
    } finally {
      setSavingChannelId(null);
    }
  };

  const runWebhookSample = async () => {
    if (!selectedWebhookChannel || !permissions.canManageChannels) return;
    const details = webhookConnectionDetails(selectedWebhookChannel);
    if (
      selectedWebhookChannel.status !== "ACTIVE" ||
      !details.outboundTargetConfigured ||
      webhookOutboundForm.removeTarget ||
      webhookOutboundForm.targetUrl.trim() ||
      webhookOutboundForm.authMode !==
        (details.outboundAuthenticationConfigured ? "preserve" : "none")
    ) {
      return;
    }

    setSavingChannelId(`webhook-sample:${selectedWebhookChannel.id}`);
    setWebhookSampleResult(null);
    setWebhookSampleError(false);
    try {
      const result = await sendWebhookChannelSampleInbound();
      setWebhookSampleResult(result);
      if (result.outboundStatus === "failed") {
        toast.error(t("settings.channels.webhookSampleFailed"));
      } else if (result.outboundStatus === "sent") {
        toast.success(t("settings.channels.webhookSampleSent"));
      } else {
        toast(t(webhookSampleMessageKey[result.outboundStatus]));
      }
    } catch (error) {
      setWebhookSampleError(true);
      showLocalizedError(error, t("settings.channels.webhookSampleError"));
    } finally {
      setSavingChannelId(null);
    }
  };

  const webhookDetails = webhookConnectionDetails(selectedWebhookChannel);
  const webhookOutboundSaving =
    savingChannelId === `webhook-outbound:${selectedWebhookChannel?.id ?? ""}`;
  const webhookSampleRunning =
    savingChannelId === `webhook-sample:${selectedWebhookChannel?.id ?? ""}`;
  const webhookOutboundChanged =
    webhookOutboundForm.removeTarget ||
    webhookOutboundForm.targetUrl.trim().length > 0 ||
    webhookOutboundForm.authMode !==
      (webhookDetails.outboundAuthenticationConfigured ? "preserve" : "none");
  const webhookSampleDisabled =
    webhookSampleRunning ||
    webhookOutboundSaving ||
    selectedWebhookChannel?.status !== "ACTIVE" ||
    !webhookDetails.outboundTargetConfigured ||
    webhookOutboundChanged;
  const webhookSampleMessage = webhookSampleResult
    ? t(webhookSampleMessageKey[webhookSampleResult.outboundStatus])
    : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.channels.title")}
        description={t("settings.channels.description")}
      />
      {channelsLoadState === "loading" ? (
        <Card data-testid="settings-channels-loading" aria-busy="true">
          <span className="sr-only" role="status">
            {t("resource.loading")}
          </span>
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex min-h-[72px] items-center gap-4 border-b border-white/5 px-5 py-4 last:border-b-0"
            >
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-white/[0.07]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-36 animate-pulse rounded bg-white/[0.07]" />
                <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
              </div>
              <div className="h-6 w-11 shrink-0 animate-pulse rounded-full bg-white/[0.07]" />
            </div>
          ))}
        </Card>
      ) : channelsLoadState === "error" ? (
        <ResourceErrorState
          testId="settings-channels-load-error"
          title={t("settings.channels.apiError")}
          onRetry={() => void loadChannels()}
        />
      ) : (
        <Card className="divide-y divide-white/5" data-testid="settings-channels-list">
          {channelEntries.map(([id, ch]) => {
            const channel = channelForDesignId(id);
            const channelLabel = ch.labelKey ? t(ch.labelKey) : ch.label;
            const Icon = ch.icon;
            const isProviderManaged = id === "telegram";
            const isSettingsManaged = id === "website" || id === "webhook";
            const isUnavailable = !isProviderManaged && !isSettingsManaged;
            const isOn = channel ? channel.status === "ACTIVE" : false;
            const isSaving = channel
              ? savingChannelId === channel.id
              : savingChannelId === `create:${id}`;
            const automation = channel ? automaticReplyReadiness[channel.id] : undefined;
            const automationSaving = channel
              ? savingChannelId === `automatic:${channel.id}`
              : false;
            const supportsAutomaticReplies = channel
              ? ["WEBSITE", "TELEGRAM", "WEBHOOK"].includes(channel.type)
              : false;
            return (
              <div key={id} className="px-5 py-4" data-testid={`settings-channel-${id}`}>
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      ch.bg,
                    )}
                  >
                    <Icon className={cn("w-5 h-5", ch.color)} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-100">
                      {channel?.name ?? channelLabel}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {channel ? (
                        <span className={channelStatusClass(channel.status)}>
                          {channelStatusLabel(channel.status, i18n)}
                        </span>
                      ) : isUnavailable ? (
                        t("settings.channels.status.soon")
                      ) : (
                        t("settings.channels.notConnected")
                      )}
                      {channel?.publicKey && (
                        <span className="hidden sm:inline text-zinc-600">
                          {" "}
                          · {channel.publicKey}
                        </span>
                      )}
                    </p>
                  </div>

                  {isProviderManaged ? (
                    <Link
                      href="/app/integrations"
                      aria-label={t("settings.channels.manageIntegrationNamed", {
                        name: channelLabel,
                      })}
                      className="mr-1 inline-flex min-h-8 shrink-0 items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-emerald-400 sm:mr-2"
                    >
                      <span className="sr-only sm:not-sr-only">
                        {t("settings.channels.manageIntegration")}
                      </span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : isSettingsManaged ? (
                    <>
                      <button
                        aria-label={t("settings.channels.configureNamed", { name: channelLabel })}
                        disabled={!channel && !permissions.canManageChannels}
                        onClick={() => {
                          if (id === "website") {
                            if (channel) {
                              openWidgetSettings(channel);
                            } else if (permissions.canManageChannels) {
                              void createWorkspaceChannel(id).then((created) => {
                                if (created) openWidgetSettings(created);
                              });
                            }
                            return;
                          }
                          if (channel) {
                            openWebhookSettings(channel);
                          } else if (permissions.canManageChannels) {
                            void createWorkspaceChannel(id);
                          }
                        }}
                        className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center text-zinc-400 transition-colors hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 sm:mr-2 sm:h-auto sm:w-auto sm:gap-1 sm:text-xs"
                      >
                        <span className="sr-only sm:not-sr-only">
                          {t("settings.channels.configure")}
                        </span>
                        <ExternalLink className="w-3 h-3" />
                      </button>

                      <Toggle
                        ariaLabel={channelLabel}
                        checked={isOn}
                        disabled={!permissions.canManageChannels || isSaving}
                        onChange={(v) => {
                          if (isSaving) return;
                          void toggleChannel(id, v);
                        }}
                      />
                    </>
                  ) : null}
                </div>

                {channel && supportsAutomaticReplies && (
                  <div
                    className="mt-3 ml-14 flex min-h-9 items-center gap-3 border-t border-white/5 pt-3"
                    title={automation?.blockers[0]?.message}
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-300">
                        {t("settings.channels.automaticReplies")}
                      </p>
                      <p
                        className={cn(
                          "text-xs",
                          automation?.enabled
                            ? "text-emerald-400"
                            : automation?.canActivate
                              ? "text-zinc-400"
                              : "text-amber-400",
                        )}
                      >
                        {automation?.enabled
                          ? t("settings.channels.automaticRepliesActive")
                          : automation?.canActivate
                            ? t("settings.channels.automaticRepliesReady")
                            : t("settings.channels.automaticRepliesBlocked")}
                      </p>
                    </div>
                    <Toggle
                      ariaLabel={t("settings.channels.automaticReplies")}
                      checked={automation?.enabled ?? false}
                      disabled={
                        !permissions.canManageChannelSecrets ||
                        automationSaving ||
                        automation === undefined ||
                        automation === null ||
                        (!automation.enabled && !automation.canActivate)
                      }
                      onChange={(value) => void toggleAutomaticReplies(channel, value)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <Modal
        open={widgetModalOpen}
        onOpenChange={setWidgetModalOpen}
        title={t("settings.channels.widgetTitle")}
        description={t("settings.channels.widgetDescription")}
        className="max-w-2xl"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setWidgetModalOpen(false)}
              disabled={savingChannelId === selectedWidgetChannel?.id}
            >
              {t("settings.common.cancel")}
            </Button>
            {permissions.canManageChannels ? (
              <Button
                onClick={() => void saveWidgetSettings()}
                disabled={savingChannelId === selectedWidgetChannel?.id}
              >
                {t("settings.channels.saveWidget")}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">Public key</p>
                <p className="text-sm font-mono text-zinc-200 mt-1">
                  {selectedWidgetChannel?.publicKey ?? t("settings.channels.notCreated")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(selectedWidgetChannel?.publicKey ?? "");
                  toast(t("settings.channels.publicKeyCopied"));
                }}
                disabled={!selectedWidgetChannel?.publicKey}
              >
                <Copy className="w-4 h-4 mr-1.5" />
                {t("settings.common.copy")}
              </Button>
            </div>
          </div>

          <fieldset
            className="m-0 min-w-0 space-y-5 border-0 p-0"
            disabled={!permissions.canManageChannels}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t("settings.channels.widget.heading")}>
                <Input
                  aria-label={t("settings.channels.widget.heading")}
                  value={widgetForm.title}
                  onChange={(event) =>
                    setWidgetForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </Field>
              <Field label={t("settings.channels.widget.subtitle")}>
                <Input
                  aria-label={t("settings.channels.widget.subtitle")}
                  value={widgetForm.subtitle}
                  onChange={(event) =>
                    setWidgetForm((prev) => ({ ...prev, subtitle: event.target.value }))
                  }
                />
              </Field>
            </div>

            <Field label={t("settings.channels.widget.business")}>
              <Input
                aria-label={t("settings.channels.widget.business")}
                value={widgetForm.businessName}
                onChange={(event) =>
                  setWidgetForm((prev) => ({ ...prev, businessName: event.target.value }))
                }
              />
            </Field>

            <Field label={t("settings.channels.widget.welcome")}>
              <Textarea
                aria-label={t("settings.channels.widget.welcome")}
                rows={4}
                value={widgetForm.welcomeMessage}
                onChange={(event) =>
                  setWidgetForm((prev) => ({ ...prev, welcomeMessage: event.target.value }))
                }
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label={t("settings.channels.widget.primary")}>
                <Input
                  aria-label={t("settings.channels.widget.primary")}
                  value={widgetForm.primaryColor}
                  onChange={(event) =>
                    setWidgetForm((prev) => ({ ...prev, primaryColor: event.target.value }))
                  }
                />
              </Field>
              <Field label={t("settings.channels.widget.accent")}>
                <Input
                  aria-label={t("settings.channels.widget.accent")}
                  value={widgetForm.accentColor}
                  onChange={(event) =>
                    setWidgetForm((prev) => ({ ...prev, accentColor: event.target.value }))
                  }
                />
              </Field>
              <Field label={t("settings.channels.widget.position")}>
                <Select
                  value={widgetForm.position}
                  onChange={(position) =>
                    setWidgetForm((prev) => ({
                      ...prev,
                      position: position === "bottom-left" ? "bottom-left" : "bottom-right",
                    }))
                  }
                >
                  <option value="bottom-right">{t("settings.channels.widget.bottomRight")}</option>
                  <option value="bottom-left">{t("settings.channels.widget.bottomLeft")}</option>
                </Select>
              </Field>
            </div>

            <Field
              label={t("settings.channels.widget.replies")}
              hint={t("settings.channels.widget.repliesHint")}
            >
              <Textarea
                aria-label={t("settings.channels.widget.replies")}
                rows={3}
                value={widgetForm.suggestedRepliesText}
                onChange={(event) =>
                  setWidgetForm((prev) => ({ ...prev, suggestedRepliesText: event.target.value }))
                }
              />
            </Field>

            <Field label={t("settings.channels.widget.consent")}>
              <Textarea
                aria-label={t("settings.channels.widget.consent")}
                rows={2}
                value={widgetForm.consentText}
                onChange={(event) =>
                  setWidgetForm((prev) => ({ ...prev, consentText: event.target.value }))
                }
              />
            </Field>
          </fieldset>
        </div>
      </Modal>

      <Modal
        open={webhookModalOpen}
        onOpenChange={changeWebhookModalOpen}
        title="Webhook/API"
        description={t("settings.channels.webhookDescription")}
        className="max-w-2xl"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => changeWebhookModalOpen(false)}
              disabled={webhookOutboundSaving || webhookSampleRunning}
            >
              {t("settings.common.close")}
            </Button>
            {canManageWebhookOutbound ? (
              <Button
                data-testid="webhook-outbound-save"
                onClick={() => void saveWebhookOutboundSettings()}
                disabled={webhookOutboundSaving || webhookSampleRunning || !webhookOutboundChanged}
                aria-busy={webhookOutboundSaving}
              >
                {webhookOutboundSaving
                  ? t("settings.channels.webhookOutboundSaving")
                  : t("settings.channels.webhookOutboundSave")}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {t("settings.channels.webhookInboundTitle")}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              {t("settings.channels.webhookInboundDescription")}
            </p>
          </div>
          {[
            { label: t("settings.channels.webhookEndpoint"), value: webhookDetails.endpoint },
            { label: t("settings.channels.webhookPublicKey"), value: webhookDetails.publicKey },
            {
              label: t("settings.channels.webhookSecretHeader"),
              value: webhookDetails.secretHeader,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-zinc-500">{item.label}</p>
                  <p className="mt-1 break-all font-mono text-sm text-zinc-200">
                    {item.value || t("settings.channels.notGenerated")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(item.value);
                    toast(t("settings.common.copied"));
                  }}
                  disabled={!item.value}
                >
                  <Copy className="mr-1.5 h-4 w-4" />
                  {t("settings.common.copy")}
                </Button>
              </div>
            </div>
          ))}

          <div
            className="rounded-lg border border-white/5 bg-white/[0.03] p-4"
            data-testid="webhook-secret-panel"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-zinc-500">
                  {t("settings.channels.webhookSecret")}
                </p>
                {webhookOneTimeSecret ? (
                  <>
                    <p
                      className="mt-1 break-all font-mono text-sm text-zinc-200"
                      data-testid="webhook-one-time-secret"
                    >
                      {webhookOneTimeSecret}
                    </p>
                    <p className="mt-2 text-xs text-amber-300">
                      {t("settings.channels.webhookSecretOneTimeHint")}
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className={cn(
                        "mt-1 text-sm font-medium",
                        webhookDetails.secretConfigured ? "text-emerald-300" : "text-amber-300",
                      )}
                      data-testid="webhook-secret-status"
                    >
                      {t(
                        webhookDetails.secretConfigured
                          ? "settings.channels.webhookSecretConfigured"
                          : "settings.channels.webhookSecretNotConfigured",
                      )}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {t("settings.channels.webhookSecretRedactedHint")}
                    </p>
                  </>
                )}
              </div>

              {webhookOneTimeSecret && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(webhookOneTimeSecret);
                    toast(t("settings.common.copied"));
                  }}
                >
                  <Copy className="mr-1.5 h-4 w-4" />
                  {t("settings.common.copy")}
                </Button>
              )}
            </div>

            {canRotateWebhookSecret && (
              <div className="mt-4 border-t border-white/5 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="webhook-rotate-secret"
                  disabled={
                    savingChannelId === `webhook-secret:${selectedWebhookChannel?.id ?? ""}`
                  }
                  onClick={() => setWebhookRotateConfirmOpen(true)}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {savingChannelId === `webhook-secret:${selectedWebhookChannel?.id ?? ""}`
                    ? t("settings.channels.webhookSecretRotating")
                    : t("settings.channels.webhookSecretRotate")}
                </Button>
              </div>
            )}
          </div>

          <div
            className="min-w-0 border-t border-white/5 pt-5"
            data-testid="webhook-outbound-panel"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {t("settings.channels.webhookOutboundTitle")}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("settings.channels.webhookOutboundDescription")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <span data-testid="webhook-outbound-target-status">
                  <Pill
                    className={cn(
                      "w-fit shrink-0 text-xs",
                      webhookDetails.outboundTargetConfigured
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300",
                    )}
                  >
                    {t(
                      webhookDetails.outboundTargetConfigured
                        ? "settings.channels.webhookOutboundConfigured"
                        : "settings.channels.webhookOutboundNotConfigured",
                    )}
                  </Pill>
                </span>
                <span data-testid="webhook-outbound-auth-status">
                  <Pill
                    className={cn(
                      "w-fit shrink-0 text-xs",
                      webhookDetails.outboundAuthenticationConfigured
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-white/5 text-zinc-400",
                    )}
                  >
                    {t(
                      webhookDetails.outboundAuthenticationConfigured
                        ? "settings.channels.webhookOutboundAuthenticationConfigured"
                        : "settings.channels.webhookOutboundAuthenticationNone",
                    )}
                  </Pill>
                </span>
              </div>
            </div>

            {canManageWebhookOutbound ? (
              <fieldset
                className="mt-4 min-w-0 space-y-4 border-0 p-0"
                disabled={webhookOutboundSaving}
              >
                <Field
                  label={t("settings.channels.webhookOutboundTarget")}
                  hint={t(
                    webhookDetails.outboundTargetConfigured
                      ? "settings.channels.webhookOutboundTargetReplaceHint"
                      : "settings.channels.webhookOutboundTargetRequiredHint",
                  )}
                >
                  <Input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    aria-label={t("settings.channels.webhookOutboundTarget")}
                    aria-invalid={Boolean(webhookOutboundErrors.targetUrl)}
                    aria-describedby={
                      webhookOutboundErrors.targetUrl ? "webhook-outbound-target-error" : undefined
                    }
                    placeholder={t("settings.channels.webhookOutboundTargetPlaceholder")}
                    value={webhookOutboundForm.targetUrl}
                    disabled={webhookOutboundForm.removeTarget}
                    onChange={(event) => {
                      setWebhookOutboundForm((previous) => ({
                        ...previous,
                        targetUrl: event.target.value,
                      }));
                      setWebhookOutboundErrors((previous) => ({
                        ...previous,
                        targetUrl: undefined,
                        request: undefined,
                      }));
                      setWebhookSampleResult(null);
                      setWebhookSampleError(false);
                    }}
                  />
                  {webhookOutboundErrors.targetUrl ? (
                    <p id="webhook-outbound-target-error" className="text-xs text-rose-300">
                      {webhookOutboundErrors.targetUrl}
                    </p>
                  ) : null}
                </Field>

                {webhookDetails.outboundTargetConfigured ? (
                  <label className="flex min-w-0 items-start gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-rose-500"
                      checked={webhookOutboundForm.removeTarget}
                      onChange={(event) => {
                        setWebhookOutboundForm((previous) => ({
                          ...previous,
                          removeTarget: event.target.checked,
                        }));
                        setWebhookOutboundErrors({});
                        setWebhookSampleResult(null);
                        setWebhookSampleError(false);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-zinc-200">
                        {t("settings.channels.webhookOutboundRemoveTarget")}
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500">
                        {t("settings.channels.webhookOutboundRemoveTargetHint")}
                      </span>
                    </span>
                  </label>
                ) : null}

                {!webhookOutboundForm.removeTarget ? (
                  <>
                    <Field
                      label={t("settings.channels.webhookOutboundAuth")}
                      hint={
                        webhookDetails.outboundAuthenticationConfigured
                          ? t("settings.channels.webhookOutboundAuthRedactedHint")
                          : undefined
                      }
                    >
                      <Select
                        ariaLabel={t("settings.channels.webhookOutboundAuth")}
                        value={webhookOutboundForm.authMode}
                        onChange={(value) => {
                          setWebhookOutboundForm((previous) => ({
                            ...previous,
                            authMode: value as WebhookOutboundAuthMode,
                            secret: "",
                          }));
                          setWebhookOutboundErrors({});
                          setWebhookSampleResult(null);
                          setWebhookSampleError(false);
                        }}
                      >
                        {webhookDetails.outboundAuthenticationConfigured ? (
                          <option value="preserve">
                            {t("settings.channels.webhookOutboundAuthPreserve")}
                          </option>
                        ) : null}
                        <option value="none">
                          {t("settings.channels.webhookOutboundAuthNone")}
                        </option>
                        <option value="bearer">
                          {t("settings.channels.webhookOutboundAuthBearer")}
                        </option>
                        <option value="custom">
                          {t("settings.channels.webhookOutboundAuthCustom")}
                        </option>
                      </Select>
                    </Field>

                    {webhookOutboundForm.authMode === "bearer" ||
                    webhookOutboundForm.authMode === "custom" ? (
                      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field
                          label={t("settings.channels.webhookOutboundHeader")}
                          hint={
                            webhookOutboundForm.authMode === "bearer"
                              ? t("settings.channels.webhookOutboundBearerHint")
                              : t("settings.channels.webhookOutboundCustomHeaderHint")
                          }
                        >
                          <Input
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            aria-label={t("settings.channels.webhookOutboundHeader")}
                            aria-invalid={Boolean(webhookOutboundErrors.headerName)}
                            value={
                              webhookOutboundForm.authMode === "bearer"
                                ? "Authorization"
                                : webhookOutboundForm.headerName
                            }
                            readOnly={webhookOutboundForm.authMode === "bearer"}
                            onChange={(event) => {
                              setWebhookOutboundForm((previous) => ({
                                ...previous,
                                headerName: event.target.value,
                              }));
                              setWebhookOutboundErrors((previous) => ({
                                ...previous,
                                headerName: undefined,
                                request: undefined,
                              }));
                              setWebhookSampleResult(null);
                              setWebhookSampleError(false);
                            }}
                          />
                          {webhookOutboundErrors.headerName ? (
                            <p className="text-xs text-rose-300">
                              {webhookOutboundErrors.headerName}
                            </p>
                          ) : null}
                        </Field>
                        <Field
                          label={t("settings.channels.webhookOutboundSecretValue")}
                          hint={
                            webhookDetails.outboundAuthenticationConfigured
                              ? t("settings.channels.webhookOutboundSecretReplaceHint")
                              : undefined
                          }
                        >
                          <Input
                            type="password"
                            autoComplete="new-password"
                            aria-label={t("settings.channels.webhookOutboundSecretValue")}
                            aria-invalid={Boolean(webhookOutboundErrors.secret)}
                            placeholder={t("settings.channels.webhookOutboundSecretPlaceholder")}
                            value={webhookOutboundForm.secret}
                            onChange={(event) => {
                              setWebhookOutboundForm((previous) => ({
                                ...previous,
                                secret: event.target.value,
                              }));
                              setWebhookOutboundErrors((previous) => ({
                                ...previous,
                                secret: undefined,
                                request: undefined,
                              }));
                              setWebhookSampleResult(null);
                              setWebhookSampleError(false);
                            }}
                          />
                          {webhookOutboundErrors.secret ? (
                            <p className="text-xs text-rose-300">{webhookOutboundErrors.secret}</p>
                          ) : null}
                        </Field>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-amber-300">
                    {t("settings.channels.webhookOutboundRemoveTargetPending")}
                  </p>
                )}

                {webhookOutboundErrors.request ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
                  >
                    {webhookOutboundErrors.request}
                  </div>
                ) : null}
              </fieldset>
            ) : (
              <p
                className="mt-4 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400"
                data-testid="webhook-outbound-readonly"
              >
                {t("settings.channels.webhookOutboundRestricted")}
              </p>
            )}

            {permissions.canManageChannels ? (
              <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.03] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200">
                      {t("settings.channels.webhookSampleTitle")}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t(
                        selectedWebhookChannel?.status !== "ACTIVE"
                          ? "settings.channels.webhookSampleChannelDisabled"
                          : webhookOutboundChanged
                            ? "settings.channels.webhookSampleSaveFirst"
                            : webhookDetails.outboundTargetConfigured
                              ? "settings.channels.webhookSampleDescription"
                              : "settings.channels.webhookSampleTargetRequired",
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="webhook-sample-run"
                    onClick={() => void runWebhookSample()}
                    disabled={webhookSampleDisabled}
                    aria-busy={webhookSampleRunning}
                  >
                    <Send className="mr-1.5 h-4 w-4" />
                    {webhookSampleRunning
                      ? t("settings.channels.webhookSampleRunning")
                      : t("settings.channels.webhookSampleRun")}
                  </Button>
                </div>

                {webhookSampleMessage ? (
                  <div
                    role={webhookSampleResult?.outboundStatus === "failed" ? "alert" : "status"}
                    data-testid="webhook-sample-result"
                    className={cn(
                      "mt-3 rounded-md border px-3 py-2 text-xs",
                      webhookSampleResult?.outboundStatus === "sent"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                        : webhookSampleResult?.outboundStatus === "failed"
                          ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-200",
                    )}
                  >
                    {webhookSampleMessage}
                  </div>
                ) : webhookSampleError ? (
                  <div
                    role="alert"
                    data-testid="webhook-sample-result"
                    className="mt-3 rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
                  >
                    {t("settings.channels.webhookSampleError")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={webhookRotateConfirmOpen}
        onOpenChange={setWebhookRotateConfirmOpen}
        title={t("settings.channels.webhookSecretRotateTitle")}
        description={t("settings.channels.webhookSecretRotateDescription")}
        confirmLabel={t("settings.channels.webhookSecretRotateConfirm")}
        cancelLabel={t("settings.common.cancel")}
        danger
        onConfirm={handleRotateWebhookSecret}
      />
    </div>
  );
}

const notifItems = [
  {
    id: "new_lead",
    labelKey: "settings.notifications.newLead",
    descKey: "settings.notifications.newLeadDesc",
  },
  {
    id: "no_reply",
    labelKey: "settings.notifications.noReply",
    descKey: "settings.notifications.noReplyDesc",
  },
  {
    id: "booking",
    labelKey: "settings.notifications.booking",
    descKey: "settings.notifications.bookingDesc",
  },
  {
    id: "daily",
    labelKey: "settings.notifications.daily",
    descKey: "settings.notifications.dailyDesc",
  },
  {
    id: "tg_summary",
    labelKey: "settings.notifications.telegram",
    descKey: "settings.notifications.telegramDesc",
  },
] as const;

function NotificationsTab() {
  const { t } = useI18n();
  const { notifications, setNotifications } = useSettingsApi();
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    new_lead: true,
    no_reply: true,
    booking: true,
    daily: false,
    tg_summary: true,
  });

  useEffect(() => {
    if (notifications) setToggles(notifications);
  }, [notifications]);

  const handleToggle = async (id: string, value: boolean) => {
    const previous = toggles;
    const next = { ...toggles, [id]: value };
    setToggles(next);
    try {
      const updated = await updateNotificationsSettings({
        [id]: value,
      });
      setNotifications(updated);
      toast(t("settings.notifications.updated"));
    } catch (error) {
      setToggles(previous);
      showLocalizedError(error, t("settings.notifications.error"));
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.notifications.title")}
        description={t("settings.notifications.description")}
      />

      <Card className="divide-y divide-white/5">
        {notifItems.map((item) => (
          <div key={item.id} className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-100">{t(item.labelKey)}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{t(item.descKey)}</p>
            </div>
            <Toggle checked={toggles[item.id]} onChange={(v) => void handleToggle(item.id, v)} />
          </div>
        ))}
      </Card>
    </div>
  );
}

function BillingTab() {
  const i18n = useI18n();
  const { t, formatDate: formatLocalizedDate, formatNumber } = i18n;
  const searchParams = useSearchParams();
  const permissions = useProductPermissions();
  const { account } = useSettingsApi();
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [paymentMethodRequesting, setPaymentMethodRequesting] = useState(false);
  const [paymentMethodRequestedAt, setPaymentMethodRequestedAt] = useState<string | null>(null);
  const [planChangeCode, setPlanChangeCode] = useState<BillingPlan["code"] | null>(null);
  const [billingData, setBillingData] = useState<{
    plans: BillingPlan[];
    subscription: BillingSubscription;
    selection: BillingPlanSelection;
    usage: BillingUsage | null;
    paymentMethod: BillingPaymentMethod | null;
    invoices: BillingInvoice[];
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState(false);
  const billingGeneration = useRef(0);
  const handoffOpened = useRef(false);

  const loadBilling = React.useCallback(async () => {
    const generation = ++billingGeneration.current;
    setBillingLoading(true);
    try {
      const [billingPlans, subscription, selection, usage, paymentMethod, invoices] = await Promise.all([
        listBillingPlans(),
        getCurrentSubscription(),
        getBillingPlanSelection(),
        getBillingUsage(),
        getBillingPaymentMethod(),
        listBillingInvoices(),
      ]);
      if (billingGeneration.current !== generation) return;
      setBillingData({ plans: billingPlans, subscription, selection, usage, paymentMethod, invoices });
      setBillingError(false);
    } catch {
      if (billingGeneration.current === generation) setBillingError(true);
    } finally {
      if (billingGeneration.current === generation) setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
    return () => {
      billingGeneration.current += 1;
    };
  }, [loadBilling]);

  const activePlan = billingData?.subscription?.plan;
  const selectedPlan = billingData?.selection?.plan;
  const requestedPlanCode = planCodeFromQuery(searchParams.get("plan"));
  const displayPlans: BillingDisplayPlan[] =
    billingData?.plans.map((plan) => apiPlanToDesignPlan(plan, i18n)) ?? [];
  const currentPlanName = activePlan ? planName(activePlan, i18n) : "";
  const currentPrice = activePlan ? formatRub(activePlan.priceMonthlyRub, i18n) : "—";
  const subscriptionStatus = billingData?.subscription?.status ?? null;
  const subscriptionCanceled =
    subscriptionStatus === "CANCELED" || subscriptionStatus === "CANCELLED";
  const currentPeriodEnd = billingData?.subscription?.periodEnd
    ? formatLocalizedDate(billingData.subscription.periodEnd, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  useEffect(() => {
    if (
      handoffOpened.current ||
      billingLoading ||
      !billingData ||
      !requestedPlanCode ||
      activePlan?.code === requestedPlanCode ||
      selectedPlan?.code === requestedPlanCode
    ) {
      return;
    }
    handoffOpened.current = true;
    setPlanModalOpen(true);
  }, [activePlan?.code, billingData, billingLoading, requestedPlanCode, selectedPlan?.code]);
  const usage = billingData?.usage;
  const paymentMethod = billingData?.paymentMethod;
  const paymentMethodChangeRequested = Boolean(
    paymentMethodRequestedAt || paymentMethod?.status === "change_requested",
  );
  const canRequestBillingContact = Boolean(activePlan || selectedPlan);
  const usageItems: { label: string; used: number; total: number | null }[] = usage
    ? [
        {
          label: t("settings.billing.usage.ai"),
          used: usage.aiConversations,
          total: usage.aiConversationsLimit,
        },
        {
          label: t("settings.billing.usage.channels"),
          used: usage.channels,
          total: usage.channelsLimit,
        },
        { label: t("settings.billing.usage.users"), used: usage.users, total: usage.usersLimit },
        {
          label: t("settings.billing.usage.automations"),
          used: usage.scenarios,
          total: usage.scenariosLimit,
        },
      ]
    : [];

  const handleSelectPlan = async (planCode: BillingPlan["code"], displayName: string) => {
    if (!permissions.canManageBilling) return;
    setPlanChangeCode(planCode);
    try {
      const selection = await selectBillingPlan(planCode);
      setBillingData((current) => {
        return {
          plans: current?.plans.length ? current.plans : [selection.plan],
          subscription: current?.subscription ?? null,
          selection,
          usage: current?.usage ?? null,
          paymentMethod: current?.paymentMethod ?? null,
          invoices: current?.invoices ?? [],
        };
      });
      setPlanModalOpen(false);
      toast.success(t("settings.billing.planSelected", { plan: displayName }), {
        description: t("settings.billing.noCharge"),
      });
    } catch (error) {
      showLocalizedError(error, t("settings.billing.planChangeError"));
    } finally {
      setPlanChangeCode(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!permissions.canManageBilling) return;
    setCancelSaving(true);
    try {
      const subscription = await cancelCurrentSubscription();
      setBillingData((current) => ({
        plans: current?.plans ?? [],
        subscription,
        selection: current?.selection ?? null,
        usage: current?.usage ?? null,
        paymentMethod: current?.paymentMethod ?? null,
        invoices: current?.invoices ?? [],
      }));
      toast.success(t("settings.billing.canceled"), {
        description: t("settings.billing.accessUntil", {
          date: formatLocalizedDate(subscription.periodEnd, {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
        }),
      });
    } catch (error) {
      showLocalizedError(error, t("settings.billing.cancelError"));
    } finally {
      setCancelSaving(false);
    }
  };

  const handlePaymentMethodChangeRequest = async () => {
    if (!permissions.canManageBilling) return;
    if (!paymentMethod) {
      toast.error(t("settings.billing.paymentUnavailable"));
      return;
    }
    setPaymentMethodRequesting(true);
    try {
      const result = await requestBillingPaymentMethodChange();
      setPaymentMethodRequestedAt(result.requestedAt);
      setBillingData((current) =>
        current
          ? {
              ...current,
              paymentMethod: {
                ...paymentMethod,
                status: "change_requested",
                updatedAt: result.requestedAt,
              },
            }
          : current,
      );
      toast.success(t("settings.billing.requestSent"), {
        description: t("settings.billing.requestSentDescription"),
      });
    } catch (error) {
      showLocalizedError(error, t("settings.billing.requestError"));
    } finally {
      setPaymentMethodRequesting(false);
    }
  };

  const handleDownloadInvoice = (invoice: BillingInvoice | null) => {
    if (!invoice) {
      toast.error(t("settings.billing.invoiceUnavailable"));
      return;
    }
    downloadTextFile(invoice.downloadName, buildInvoiceText(invoice, account?.businessName, i18n));
    toast.success(t("settings.billing.invoiceDownloaded"));
  };

  const invoices = billingData?.invoices.length
    ? billingData.invoices.map((invoice) => ({
        id: invoice.id,
        date: formatLocalizedDate(invoice.issuedAt, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        amount: formatRub(invoice.amountRub, i18n),
        status: billingInvoiceStatusLabel(invoice.status, i18n),
        plan: t("settings.billing.plan", { name: planName(invoice.plan, i18n) }),
        invoice,
      }))
    : [];

  const manualInvoice = !paymentMethod || paymentMethod.mode === "manual_invoice";
  const paymentMethodLabel = manualInvoice
    ? t("settings.billing.paymentDefault")
    : paymentMethod.label;
  const paymentMethodDescription = manualInvoice
    ? t("settings.billing.paymentDescription")
    : paymentMethod.description;
  const paymentMethodActionLabel = paymentMethodRequesting
    ? t("settings.billing.requesting")
    : paymentMethodChangeRequested
      ? t("settings.billing.requestSent")
      : !canRequestBillingContact
        ? t("settings.billing.choosePlanFirst")
      : manualInvoice
        ? t("settings.billing.requestChange")
        : paymentMethod.nextActionLabel;
  const paymentMethodStatusLabel = paymentMethodChangeRequested
    ? t("settings.billing.requestSent")
    : t("settings.billing.manual");
  const paymentMethodStatusClass = paymentMethodChangeRequested
    ? "bg-amber-500/15 text-amber-300"
    : "bg-emerald-500/15 text-emerald-300";

  if (billingLoading && !billingData) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title={t("settings.billing.title")}
          description={t("settings.billing.description")}
        />
        <SettingsResourceLoading />
      </div>
    );
  }

  if (billingError && !billingData) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title={t("settings.billing.title")}
          description={t("settings.billing.description")}
        />
        <ResourceErrorState
          testId="settings-billing-load-error"
          onRetry={() => void loadBilling()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.billing.title")}
        description={t("settings.billing.description")}
      />
      {billingError && billingData ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3"
        >
          <p className="text-xs text-amber-200">{t("settings.billing.apiError")}</p>
          <Button variant="outline" size="sm" onClick={() => void loadBilling()}>
            <RotateCcw className="h-4 w-4" />
            {t("resource.retry")}
          </Button>
        </div>
      ) : null}

      {/* Plan card */}
      <div className="relative rounded-3xl p-px overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/40 via-teal-500/20 to-transparent" />
        <div className="relative rounded-[calc(1.5rem-1px)] bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Pill
                className={cn(
                  "mb-3 text-xs",
                  subscriptionCanceled
                    ? "bg-rose-500/15 text-rose-300"
                    : activePlan
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-zinc-500/15 text-zinc-300",
                )}
              >
                {subscriptionCanceled
                  ? t("settings.billing.canceled")
                  : activePlan
                    ? t("settings.billing.current")
                    : t("settings.billing.noSubscription")}
              </Pill>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-50">
                {activePlan
                  ? t("settings.billing.plan", { name: currentPlanName })
                  : t("settings.billing.noSubscriptionTitle")}
              </h3>
              <p className="text-zinc-400 text-sm mt-1">
                {activePlan && currentPeriodEnd
                  ? subscriptionCanceled
                    ? t("settings.billing.accessUntil", { date: currentPeriodEnd })
                    : t("settings.billing.nextCharge", { date: currentPeriodEnd })
                  : t("settings.billing.noSubscriptionDescription")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-zinc-50 tracking-tight">{currentPrice}</p>
              {activePlan ? (
                <p className="text-xs text-zinc-500">
                  {activePlan.priceMonthlyRub === null
                    ? t("settings.billing.byAgreement")
                    : t("settings.billing.perMonth")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {usageItems.map((item) => {
              const pct =
                item.total !== null && item.total > 0
                  ? Math.min(100, Math.round((item.used / item.total) * 100))
                  : 0;
              return (
                <div key={item.label}>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                    <span>{item.label}</span>
                    <span className="text-zinc-300 font-medium">
                      {formatNumber(item.used)}{" "}
                      <span className="text-zinc-500">
                        /{" "}
                        {item.total !== null
                          ? formatNumber(item.total)
                          : activePlan
                            ? t("settings.common.custom")
                            : t("settings.billing.limitUnavailable")}
                      </span>
                    </span>
                  </div>
                  {item.total !== null ? (
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className={cn(
                          "h-full rounded-full",
                          pct >= 80
                            ? "bg-amber-400"
                            : "bg-gradient-to-r from-emerald-500 to-teal-400",
                        )}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {permissions.canManageBilling ? (
            <div className="mt-6 flex gap-3">
              <Button data-testid="billing-choose-plan" onClick={() => setPlanModalOpen(true)}>
                {activePlan ? t("settings.billing.changePlan") : t("settings.billing.chooseTitle")}
              </Button>
              {billingData?.subscription ? (
                <Button
                  variant="outline"
                  disabled={
                    billingLoading ||
                    billingError ||
                    !billingData?.subscription ||
                    subscriptionCanceled ||
                    cancelSaving
                  }
                  onClick={() => setCancelConfirmOpen(true)}
                >
                  {cancelSaving
                    ? t("settings.billing.canceling")
                    : subscriptionCanceled
                      ? t("settings.billing.canceled")
                      : t("settings.billing.cancelPlan")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {billingData?.selection ? (
        <Card className="border-amber-500/25 bg-amber-500/5 p-5" data-testid="billing-plan-selection">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <Pill className="mb-3 bg-amber-500/15 text-amber-200">
                {t("settings.billing.activationPending")}
              </Pill>
              <h3 className="text-base font-semibold text-zinc-100">
                {t("settings.billing.planSelected", {
                  plan: planName(billingData.selection.plan, i18n),
                })}
              </h3>
              <p className="mt-1 text-sm text-zinc-400">
                {t("settings.billing.checkoutUnavailable")}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Plan selection modal */}
      {permissions.canManageBilling ? (
        <Modal
          open={planModalOpen}
          onOpenChange={setPlanModalOpen}
          title={t("settings.billing.chooseTitle")}
          description={t("settings.billing.chooseDescription")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            {displayPlans.length === 0 ? (
              <div className="md:col-span-2 flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm font-medium text-zinc-200">{t("settings.billing.noPlans")}</p>
                <p className="max-w-md text-xs text-zinc-500">
                  {t("settings.billing.noPlansDescription")}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={billingLoading}
                    onClick={() => void loadBilling()}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t("resource.retry")}
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/#pricing">{t("settings.billing.viewPublicPricing")}</Link>
                  </Button>
                </div>
              </div>
            ) : null}
            {displayPlans.map((plan) => {
              const planCode = plan.code;
              const active = Boolean(planCode && activePlan?.code === planCode);
              const selected = Boolean(planCode && selectedPlan?.code === planCode);
              const requested = Boolean(planCode && requestedPlanCode === planCode);
              const changing = Boolean(planCode && planChangeCode === planCode);
              return (
                <div
                  key={plan.id}
                  data-testid={`billing-plan-${plan.code ?? plan.id}`}
                  className={cn(
                    "relative rounded-2xl border p-5 flex flex-col gap-3 transition-colors",
                    plan.popular
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : "border-white/5 bg-white/[0.03]",
                    requested && "ring-2 ring-emerald-400/70",
                  )}
                >
                  {plan.popular && (
                    <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                      {t("settings.billing.popular")}
                    </span>
                  )}
                  <div>
                    <p className="text-sm font-bold text-zinc-100">{plan.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{plan.tagline}</p>
                  </div>
                  <div>
                    <span className="text-xl font-bold text-zinc-50">{plan.price}</span>
                    <span className="text-xs text-zinc-500 ml-1">{plan.priceNote}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {plan.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-zinc-400">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        {f}
                      </li>
                    ))}
                    {plan.features.length > 4 && (
                      <li className="text-xs text-zinc-600">
                        {t("settings.billing.more", { count: plan.features.length - 4 })}
                      </li>
                    )}
                  </ul>
                  <Button
                    size="sm"
                    variant={plan.popular ? "primary" : "outline"}
                    className="mt-auto"
                    disabled={!planCode || active || selected || planChangeCode !== null}
                    onClick={() => {
                      if (planCode) void handleSelectPlan(planCode, plan.name);
                    }}
                  >
                    {changing
                      ? t("settings.billing.changing")
                      : active
                        ? t("settings.billing.current")
                        : selected
                          ? t("settings.billing.activationPending")
                        : requested
                          ? t("settings.billing.continueWithPlan")
                        : planCode
                          ? t("settings.billing.choose")
                          : t("settings.common.unavailable")}
                  </Button>
                </div>
              );
            })}
          </div>
        </Modal>
      ) : null}

      {permissions.canManageBilling && billingData?.subscription && currentPeriodEnd ? (
        <ConfirmDialog
          open={cancelConfirmOpen}
          onOpenChange={setCancelConfirmOpen}
          title={t("settings.billing.cancelTitle")}
          description={t("settings.billing.cancelDescription", {
            plan: currentPlanName,
            date: currentPeriodEnd,
          })}
          danger
          confirmLabel={t("settings.billing.confirmCancel")}
          onConfirm={handleCancelSubscription}
        />
      ) : null}

      {/* Payment method */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          {t("settings.billing.paymentMethod")}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-zinc-100">{paymentMethodLabel}</p>
                <Pill className={cn("text-[10px]", paymentMethodStatusClass)}>
                  {paymentMethodStatusLabel}
                </Pill>
              </div>
              <p className="text-xs text-zinc-500">{paymentMethodDescription}</p>
            </div>
          </div>
          {permissions.canManageBilling ? (
            <Button
              size="sm"
              variant="outline"
              disabled={
                !paymentMethod ||
                !canRequestBillingContact ||
                paymentMethodRequesting ||
                paymentMethodChangeRequested
              }
              onClick={() => void handlePaymentMethodChangeRequest()}
            >
              {paymentMethodActionLabel}
            </Button>
          ) : null}
        </div>
      </Card>

      {/* Invoices */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          {t("settings.billing.invoices")}
        </p>
        <div className="space-y-2">
          {invoices.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500">{t("settings.billing.noPayments")}</p>
          ) : null}
          {invoices.map((inv) => (
            <div
              key={inv.date}
              className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
            >
              <div>
                <p className="text-sm text-zinc-200 font-medium">{inv.date}</p>
                <p className="text-xs text-zinc-500">{inv.plan}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-zinc-100">{inv.amount}</span>
                <Pill className="bg-emerald-500/15 text-emerald-300 text-[10px]">{inv.status}</Pill>
                <Tip content={t("settings.billing.downloadInvoice", { date: inv.date })}>
                  <button
                    aria-label={t("settings.billing.downloadInvoice", { date: inv.date })}
                    disabled={!inv.invoice}
                    onClick={() => handleDownloadInvoice(inv.invoice)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </Tip>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function sessionPresentation(session: SecuritySession, i18n: SettingsI18n) {
  const userAgent = session.userAgent?.toLowerCase() ?? "";
  const isPhone = /iphone|android|mobile/.test(userAgent);
  const isDesktop = /macintosh|windows|linux/.test(userAgent);
  const browser = userAgent.includes("firefox")
    ? "Firefox"
    : userAgent.includes("edg/")
      ? "Edge"
      : userAgent.includes("safari") && !userAgent.includes("chrome")
        ? "Safari"
        : userAgent.includes("chrome")
          ? "Chrome"
          : i18n.t("settings.security.browser");

  return {
    device: isPhone
      ? `${browser} / ${i18n.t("settings.security.phone")}`
      : isDesktop
        ? `${browser} / ${i18n.t("settings.security.computer")}`
        : browser,
    icon: isPhone ? Smartphone : isDesktop ? Monitor : Globe,
    time: session.current
      ? i18n.t("settings.security.now")
      : i18n.formatDate(session.lastUsedAt, { day: "2-digit", month: "short", year: "numeric" }),
  };
}

function defaultSecuritySettings(): SecuritySettings {
  return {
    authMode: "credentials",
    hasPassword: true,
    productionAuthReadyFor: ["Local credentials", "HTTP-only sessions"],
    tenantScoped: true,
    currentRole: "OWNER",
    passwordChangeRequired: false,
    twoFactor: {
      enabled: false,
      setupPending: false,
      confirmedAt: null,
      recoveryCodesRemaining: 0,
    },
    sessions: [],
  };
}

function SecurityTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const { security, setSecurity } = useSettingsApi();
  const [showPass, setShowPass] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<Awaited<
    ReturnType<typeof startTwoFactorSetup>
  > | null>(null);
  const [twoFactorQrDataUrl, setTwoFactorQrDataUrl] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorAction, setTwoFactorAction] = useState<
    "setup" | "enable" | "disable" | "recovery" | null
  >(null);
  const [visibleRecoveryCodes, setVisibleRecoveryCodes] = useState<string[]>([]);

  const sessions = security?.sessions ?? [];
  const twoFactor = security?.twoFactor ?? defaultSecuritySettings().twoFactor;
  const authMode = security?.authMode ?? "credentials";
  const usesPassword =
    security?.hasPassword ??
    (authMode === "credentials" || Boolean(security?.passwordChangeRequired));
  const authModeLabel =
    authMode === "credentials"
      ? t("settings.security.authCredentials")
      : authMode === "email"
        ? t("settings.security.authEmail")
        : authMode === "telegram"
          ? t("settings.security.authTelegram")
          : t("settings.security.authUnknown");
  const passwordlessDescription =
    authMode === "email"
      ? t("settings.security.passwordlessEmailDesc")
      : authMode === "telegram"
        ? t("settings.security.passwordlessTelegramDesc")
        : t("settings.security.passwordlessOtherDesc");

  useEffect(() => {
    let cancelled = false;
    if (!twoFactorSetup) {
      setTwoFactorQrDataUrl("");
      return;
    }

    QRCode.toDataURL(twoFactorSetup.otpauthUri, {
      margin: 1,
      width: 176,
      color: {
        dark: "#0f172a",
        light: "#f8fafc",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setTwoFactorQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setTwoFactorQrDataUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [twoFactorSetup]);

  async function refreshSecurity() {
    const updated = await getSecuritySettings();
    setSecurity(updated);
    return updated;
  }

  async function handlePasswordChange() {
    if (newPassword !== repeatPassword) {
      toast.error(t("settings.security.passwordMismatch"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("settings.security.passwordLength"));
      return;
    }

    setPasswordSaving(true);
    try {
      const result = await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      await refreshSecurity();
      toast.success(t("settings.security.passwordUpdated"), {
        description:
          result.revokedSessions > 0
            ? t("settings.security.otherSessionsEnded", { count: result.revokedSessions })
            : undefined,
      });
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.passwordError"));
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setSessionActionId(sessionId);
    try {
      await revokeSecuritySession(sessionId);
      setSecurity({
        ...(security ?? defaultSecuritySettings()),
        sessions: sessions.filter((session) => session.id !== sessionId),
      });
      toast.success(t("settings.security.sessionEnded"));
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.sessionError"));
    } finally {
      setSessionActionId(null);
    }
  }

  async function handleRevokeOthers() {
    setSessionActionId("others");
    try {
      const result = await revokeOtherSecuritySessions();
      await refreshSecurity();
      toast.success(t("settings.security.othersEnded"), {
        description: t("settings.security.countEnded", { count: result.revoked }),
      });
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.othersError"));
    } finally {
      setSessionActionId(null);
    }
  }

  function updateTwoFactor(nextTwoFactor: SecuritySettings["twoFactor"]) {
    setSecurity({
      ...(security ?? defaultSecuritySettings()),
      twoFactor: nextTwoFactor,
    });
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard?.writeText(value);
      toast.success(label);
    } catch {
      toast.error(t("settings.security.copyError"));
    }
  }

  async function handleStartTwoFactor() {
    setTwoFactorAction("setup");
    setVisibleRecoveryCodes([]);
    try {
      const setup = await startTwoFactorSetup();
      setTwoFactorSetup(setup);
      setTwoFactorCode("");
      toast.success(t("settings.security.setupCreated"));
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.setupError"));
    } finally {
      setTwoFactorAction(null);
    }
  }

  async function handleEnableTwoFactor() {
    setTwoFactorAction("enable");
    try {
      const result = await enableTwoFactor({ code: twoFactorCode });
      updateTwoFactor(result.twoFactor);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setVisibleRecoveryCodes(result.recoveryCodes);
      toast.success(t("settings.security.twoFactorEnabled"), {
        description: t("settings.security.saveRecoveryHint"),
      });
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.enableError"));
    } finally {
      setTwoFactorAction(null);
    }
  }

  async function handleDisableTwoFactor() {
    setTwoFactorAction("disable");
    try {
      const result = await disableTwoFactor({ currentPassword: twoFactorPassword });
      updateTwoFactor(result.twoFactor);
      setTwoFactorPassword("");
      setVisibleRecoveryCodes([]);
      setTwoFactorSetup(null);
      toast.success(t("settings.security.twoFactorDisabled"));
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.disableError"));
    } finally {
      setTwoFactorAction(null);
    }
  }

  async function handleRegenerateRecoveryCodes() {
    setTwoFactorAction("recovery");
    try {
      const result = await regenerateTwoFactorRecoveryCodes({ currentPassword: twoFactorPassword });
      updateTwoFactor(result.twoFactor);
      setVisibleRecoveryCodes(result.recoveryCodes);
      setTwoFactorPassword("");
      toast.success(t("settings.security.recoveryUpdated"));
    } catch (caught) {
      showLocalizedError(caught, t("settings.security.recoveryError"));
    } finally {
      setTwoFactorAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.security.title")}
        description={t("settings.security.description")}
      />

      <Card className="p-5 grid gap-3 sm:grid-cols-2">
        {[
          { label: t("settings.security.authMode"), value: authModeLabel },
          {
            label: t("settings.security.currentRole"),
            value: security ? roleLabel(security.currentRole, i18n) : t("settings.team.role.admin"),
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3"
          >
            <p className="text-xs text-zinc-500">{item.label}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</p>
          </div>
        ))}
      </Card>

      {usesPassword ? (
        <Card
          data-testid="settings-password-controls"
          className={cn(
            "p-6 space-y-5",
            security?.passwordChangeRequired && "border-amber-500/30 bg-amber-500/5",
          )}
        >
        {security?.passwordChangeRequired && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-200">
              {t("settings.security.temporaryWarning")}
            </p>
            <p className="mt-1 text-xs text-amber-100/70">
              {t("settings.security.temporaryWarningDesc")}
            </p>
          </div>
        )}
        <p className="text-sm font-bold text-zinc-200 tracking-tight">
          {t("settings.security.changePassword")}
        </p>
        <Field label={t("settings.security.currentPassword")}>
          <div className="relative">
            <Input
              type={showPass ? "text" : "password"}
              placeholder="••••••••"
              className="pr-10"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-label={t("settings.security.currentPassword")}
            />
            <Tip
              content={
                showPass ? t("settings.security.hidePassword") : t("settings.security.showPassword")
              }
            >
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </Tip>
          </div>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label={t("settings.security.newPassword")}>
            <Input
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-label={t("settings.security.newPassword")}
            />
          </Field>
          <Field label={t("settings.security.repeatPassword")}>
            <Input
              type="password"
              placeholder="••••••••"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              aria-label={t("settings.security.repeatPassword")}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => void handlePasswordChange()}
            disabled={passwordSaving || !currentPassword || !newPassword || !repeatPassword}
          >
            {t("settings.security.updatePassword")}
          </Button>
        </div>
        </Card>
      ) : (
        <Card className="p-5" data-testid="settings-passwordless-note">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">
                {t("settings.security.passwordlessTitle")}
              </p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">{passwordlessDescription}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5 space-y-5" data-testid="settings-two-factor-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              {t("settings.security.twoFactor")}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{t("settings.security.twoFactorDesc")}</p>
          </div>
          <Pill
            className={
              twoFactor.enabled
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-zinc-500/15 text-zinc-300"
            }
          >
            {twoFactor.enabled
              ? t("settings.security.on")
              : twoFactor.setupPending || twoFactorSetup
                ? t("settings.security.settingUp")
                : t("settings.security.off")}
          </Pill>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">{t("settings.security.status")}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              {twoFactor.enabled ? t("settings.security.active") : t("settings.security.inactive")}
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">{t("settings.security.recoveryCodes")}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              {twoFactor.recoveryCodesRemaining}
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
            <p className="text-xs text-zinc-500">{t("settings.security.confirmed")}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              {twoFactor.confirmedAt
                ? i18n.formatDate(twoFactor.confirmedAt, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : t("settings.security.no")}
            </p>
          </div>
        </div>

        {!usesPassword && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-sm leading-6 text-amber-100/80">
            {t("settings.security.twoFactorPasswordRequired")}
          </div>
        )}

        {usesPassword && !twoFactor.enabled && !twoFactorSetup && (
          <div className="flex justify-end">
            <Button
              data-testid="settings-two-factor-setup"
              onClick={() => void handleStartTwoFactor()}
              disabled={twoFactorAction === "setup"}
              className="gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              {t("settings.security.setup2fa")}
            </Button>
          </div>
        )}

        {usesPassword && !twoFactor.enabled && twoFactorSetup && (
          <div className="space-y-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-200">
                  {t("settings.security.addAuthenticator")}
                </p>
                <p className="mt-1 text-xs text-emerald-100/70">{t("settings.security.scanQr")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(twoFactorSetup.secret, t("settings.common.copied"))}
                >
                  <Copy className="w-4 h-4 mr-1.5" />
                  Key
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void copyText(twoFactorSetup.otpauthUri, t("settings.common.copied"))
                  }
                >
                  <Copy className="w-4 h-4 mr-1.5" />
                  URI
                </Button>
              </div>
            </div>
            {twoFactorQrDataUrl && (
              <div
                role="img"
                aria-label={t("settings.security.qrLabel")}
                className="h-44 w-44 rounded-2xl border border-white/10 bg-slate-50 bg-contain bg-center bg-no-repeat p-2"
                style={{ backgroundImage: `url(${twoFactorQrDataUrl})` }}
              />
            )}
            <code className="block rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 font-mono text-xs text-zinc-200 break-all">
              {twoFactorSetup.secret}
            </code>
            <Field label={t("settings.security.appCode")}>
              <Input
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
                inputMode="numeric"
                placeholder="123456"
                aria-label={t("settings.security.confirmCodeLabel")}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleEnableTwoFactor()}
                disabled={twoFactorAction === "enable" || twoFactorCode.length < 6}
              >
                {t("settings.security.confirmEnable")}
              </Button>
            </div>
          </div>
        )}

        {usesPassword && twoFactor.enabled && (
          <div className="space-y-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <Field
              label={t("settings.security.currentPassword")}
              hint={t("settings.security.actionPasswordHint")}
            >
              <Input
                value={twoFactorPassword}
                onChange={(event) => setTwoFactorPassword(event.target.value)}
                type="password"
                placeholder="••••••••"
                aria-label={t("settings.security.actionPasswordLabel")}
              />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => void handleRegenerateRecoveryCodes()}
                disabled={twoFactorAction === "recovery" || !twoFactorPassword}
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                {t("settings.security.newRecovery")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleDisableTwoFactor()}
                disabled={twoFactorAction === "disable" || !twoFactorPassword}
                className="border-rose-500/20 text-rose-300 hover:bg-rose-500/5"
              >
                {t("settings.security.disable2fa")}
              </Button>
            </div>
          </div>
        )}

        {visibleRecoveryCodes.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-100">
                  {t("settings.security.saveRecovery")}
                </p>
                <p className="mt-1 text-xs text-amber-100/70">
                  {t("settings.security.recoveryDesc")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void copyText(visibleRecoveryCodes.join("\n"), t("settings.common.copied"))
                }
              >
                <Copy className="w-4 h-4 mr-1.5" />
                {t("settings.common.copy")}
              </Button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {visibleRecoveryCodes.map((code) => (
                <code
                  key={code}
                  className="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-amber-50"
                >
                  {code}
                </code>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Sessions */}
      <Card className="p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          {t("settings.security.sessions")}
        </p>
        <div className="space-y-3">
          {sessions.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
              {t("settings.security.noSessions")}
            </div>
          )}
          {sessions.map((s) => {
            const presentation = sessionPresentation(s, i18n);
            const Icon = presentation.icon;
            return (
              <div
                key={s.id}
                className="flex items-start gap-3 border-b border-white/5 py-2 last:border-0 sm:items-center"
              >
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-200">{presentation.device}</p>
                    {s.current && (
                      <Pill className="bg-emerald-500/15 text-emerald-300 text-[10px]">
                        {t("settings.security.currentSession")}
                      </Pill>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">{presentation.time}</p>
                </div>
                {!s.current && (
                  <Tip content={t("settings.security.endSession")}>
                    <button
                      type="button"
                      onClick={() => void handleRevokeSession(s.id)}
                      disabled={sessionActionId === s.id}
                      className="inline-flex min-h-11 shrink-0 items-center px-2 text-xs text-rose-400 transition-colors hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      {t("settings.common.close")}
                    </button>
                  </Tip>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-white/5">
          <Button
            variant="outline"
            className="gap-2 text-rose-400 border-rose-500/20 hover:bg-rose-500/5"
            disabled={
              sessions.filter((session) => !session.current).length === 0 ||
              sessionActionId === "others"
            }
            onClick={() => setConfirmLogout(true)}
          >
            <LogOut className="w-4 h-4" />
            {t("settings.security.signOutOthers")}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title={t("settings.security.signOutTitle")}
        description={t("settings.security.signOutDesc")}
        danger
        confirmLabel={t("settings.security.endOthers")}
        onConfirm={handleRevokeOthers}
      />
    </div>
  );
}

function ApiKeysTab() {
  const { t, formatDate: formatLocalizedDate } = useI18n();
  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof getLegacyApiKeys>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokingKey, setRevokingKey] = useState(false);
  const loadGeneration = useRef(0);

  const loadApiKeys = React.useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const keys = await getLegacyApiKeys();
      if (loadGeneration.current !== generation) return;
      setApiKeys(keys);
      setLoadError(false);
    } catch {
      if (loadGeneration.current === generation) setLoadError(true);
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApiKeys();
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadApiKeys]);

  const openRevoke = (id: string) => {
    setRevokeTarget(id);
    setConfirmRevoke(true);
  };

  const targetKey = apiKeys?.find((key) => key.id === revokeTarget);

  const handleRevokeKey = async () => {
    if (!revokeTarget) return false;
    setRevokingKey(true);
    try {
      await revokeApiKey(revokeTarget);
      setApiKeys((current) => current?.filter((key) => key.id !== revokeTarget) ?? []);
      setRevokeTarget(null);
      toast.success(t("settings.api.removed"));
      return true;
    } catch (error) {
      showLocalizedError(error, t("settings.api.removeError"));
      return false;
    } finally {
      setRevokingKey(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title={t("settings.api.title")} description={t("settings.api.description")} />

      <Card
        className="border-amber-500/20 bg-amber-500/5 p-5"
        data-testid="settings-api-unavailable"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
            <Key className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-amber-200">
                {t("settings.api.unavailableTitle")}
              </p>
              <Pill className="bg-amber-500/15 text-amber-200 text-[10px]">
                {t("settings.api.unavailableStatus")}
              </Pill>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {t("settings.api.unavailableDescription")}
            </p>
          </div>
        </div>
      </Card>

      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{t("settings.api.legacyTitle")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t("settings.api.legacyDescription")}</p>
      </div>

      {loading && !apiKeys ? (
        <Card className="space-y-3 p-5" data-testid="settings-api-cleanup-loading" aria-busy="true">
          <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
          <div className="h-9 animate-pulse rounded bg-white/[0.06]" />
        </Card>
      ) : loadError && !apiKeys ? (
        <ResourceErrorState
          testId="settings-api-keys-load-error"
          onRetry={() => void loadApiKeys()}
        />
      ) : (
        <Card className="divide-y divide-white/5" data-testid="settings-api-cleanup-list">
          {loadError && apiKeys ? (
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-amber-200">{t("settings.api.refreshError")}</p>
              <Button variant="outline" size="sm" onClick={() => void loadApiKeys()}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t("resource.retry")}
              </Button>
            </div>
          ) : null}
          {apiKeys?.length === 0 ? (
            <div className="px-5 py-6">
              <p className="text-sm font-semibold text-zinc-100">{t("settings.api.legacyEmpty")}</p>
              <p className="mt-1 text-xs text-zinc-500">{t("settings.api.legacyEmptyDesc")}</p>
            </div>
          ) : null}
          {apiKeys?.map((key) => (
            <div key={key.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-100">{key.name}</p>
                    <Pill className="bg-zinc-500/15 text-zinc-300 text-[10px]">
                      {t("settings.api.inactive")}
                    </Pill>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {t("settings.api.created", {
                      date: formatLocalizedDate(key.createdAt, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      }),
                    })}
                  </p>
                  <code className="mt-2 inline-block max-w-full truncate rounded bg-white/5 px-3 py-1.5 font-mono text-xs text-zinc-400">
                    {key.keyPrefix}
                  </code>
                </div>
                <Tip content={t("settings.api.removeKey")}>
                  <button
                    type="button"
                    onClick={() => openRevoke(key.id)}
                    className="flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs text-rose-400 transition-colors hover:bg-rose-500/5 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("settings.api.remove")}
                  </button>
                </Tip>
              </div>
            </div>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={t("settings.api.removeTitle")}
        description={t("settings.api.removeDescription", { name: targetKey?.name ?? "" })}
        danger
        confirmLabel={revokingKey ? t("settings.api.removing") : t("settings.api.remove")}
        cancelLabel={t("settings.common.cancel")}
        onConfirm={handleRevokeKey}
      />
    </div>
  );
}

const tabContentMap: Record<TabId, React.ComponentType> = {
  profile: ProfileTab,
  team: TeamTab,
  channels: ChannelsTab,
  notifications: NotificationsTab,
  billing: BillingTab,
  security: SecurityTab,
  api: ApiKeysTab,
};

/* ============================================================
   Main SettingsPage
   ============================================================ */

export function SettingsPage({
  initialTab = "profile",
  title,
}: {
  initialTab?: TabId;
  title?: string;
}) {
  const { t } = useI18n();
  const allowedInitialTab = initialTab === "api" ? "profile" : initialTab;
  const visibleTabs = tabs;
  const [activeTab, setActiveTab] = useState<TabId>(allowedInitialTab);
  const [account, setAccount] = useState<SettingsAccount | null>(null);
  const [team, setTeam] = useState<TeamSettings | null>(null);
  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [notifications, setNotifications] = useState<NotificationsSettings | null>(null);
  const [resourceStatus, setResourceStatus] = useState<
    Record<SettingsResource, SettingsResourceStatus>
  >({
    account: "loading",
    team: "loading",
    security: "loading",
    notifications: "loading",
  });
  const resourceGeneration = useRef<Record<SettingsResource, number>>({
    account: 0,
    team: 0,
    security: 0,
    notifications: 0,
  });
  const ActiveContent = tabContentMap[activeTab];

  useEffect(() => {
    setActiveTab(initialTab === "api" ? "profile" : initialTab);
  }, [initialTab]);

  const loadResource = React.useCallback(async (resource: SettingsResource) => {
    const generation = ++resourceGeneration.current[resource];
    setResourceStatus((current) => ({ ...current, [resource]: "loading" }));
    try {
      switch (resource) {
        case "account": {
          const value = await getAccountSettings();
          if (resourceGeneration.current[resource] !== generation) return;
          setAccount(value);
          break;
        }
        case "team": {
          const value = await getTeamSettings();
          if (resourceGeneration.current[resource] !== generation) return;
          setTeam(value);
          break;
        }
        case "security": {
          const value = await getSecuritySettings();
          if (resourceGeneration.current[resource] !== generation) return;
          setSecurity(value);
          break;
        }
        case "notifications": {
          const value = await getNotificationsSettings();
          if (resourceGeneration.current[resource] !== generation) return;
          setNotifications(value);
          break;
        }
      }
      if (resourceGeneration.current[resource] === generation) {
        setResourceStatus((current) => ({ ...current, [resource]: "ready" }));
      }
    } catch {
      if (resourceGeneration.current[resource] === generation) {
        setResourceStatus((current) => ({ ...current, [resource]: "error" }));
      }
    }
  }, []);

  useEffect(() => {
    for (const resource of settingsResources) void loadResource(resource);
    return () => {
      for (const resource of settingsResources) resourceGeneration.current[resource] += 1;
    };
  }, [loadResource]);

  const activeResource = settingsResourceByTab[activeTab];
  const activeResourceValue = activeResource
    ? { account, team, security, notifications }[activeResource]
    : true;
  const activeResourceStatus = activeResource ? resourceStatus[activeResource] : "ready";
  const showInitialLoading = activeResourceStatus === "loading" && !activeResourceValue;
  const showInitialError = activeResourceStatus === "error" && !activeResourceValue;

  return (
    <SettingsApiContext.Provider
      value={{
        account,
        setAccount,
        team,
        setTeam,
        security,
        setSecurity,
        notifications,
        setNotifications,
      }}
    >
      <ProductLayout
        title={title ?? t(initialTab === "billing" ? "settings.billingTitle" : "settings.title")}
      >
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* ── Settings navigation ── */}

          {/* Mobile section selector */}
          <nav
            aria-label={t("settings.title")}
            className="w-full lg:hidden"
            data-testid="settings-mobile-section-selector"
          >
            <BrandSelect
              ariaLabel={t("settings.title")}
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as TabId)}
              options={visibleTabs.map((tab) => {
                const Icon = tab.icon;
                return {
                  value: tab.id,
                  label: (
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t(tab.labelKey)}</span>
                    </span>
                  ),
                };
              })}
            />
          </nav>

          {/* Desktop vertical nav */}
          <nav className="hidden lg:flex lg:w-56 shrink-0 flex-col gap-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-left transition-all",
                    active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="settings-active"
                      className="absolute inset-0 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.08)]"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon
                    className={cn(
                      "w-4 h-4 relative z-10 shrink-0",
                      active ? "text-emerald-400" : "text-zinc-500",
                    )}
                  />
                  <span className="relative z-10">{t(tab.labelKey)}</span>
                  {active && (
                    <ChevronRight className="w-3.5 h-3.5 relative z-10 ml-auto text-emerald-400/60" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* ── Content panel ── */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {showInitialLoading ? (
                  <SettingsResourceLoading />
                ) : showInitialError && activeResource ? (
                  <ResourceErrorState
                    testId={`settings-${activeResource}-load-error`}
                    onRetry={() => void loadResource(activeResource)}
                  />
                ) : (
                  <ActiveContent />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </ProductLayout>
    </SettingsApiContext.Provider>
  );
}
