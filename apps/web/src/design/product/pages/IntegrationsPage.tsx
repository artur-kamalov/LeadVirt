import React, { useEffect, useState } from "react";
import type { Channel, IntegrationAccount, IntegrationProvider } from "@leadvirt/types";
import {
  Send,
  MessageCircle,
  Instagram,
  Mail,
  Calendar,
  ShoppingBag,
  Webhook,
  Database,
  Layers,
  Store,
  Copy,
  Check,
  ExternalLink,
  Zap,
  Settings,
  RefreshCw,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ProductLayout } from "../ProductLayout";
import { Card, SectionTitle, Pill } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrations,
  requestIntegrationConnection,
  sendSampleInbound,
  testIntegrationConnection,
} from "@/lib/api/integrations";
import { ApiClientError } from "@/lib/api/client";
import { listChannels } from "@/lib/api/channels";
import { Dropdown, DropdownItem, DropdownSeparator, ConfirmDialog, Modal, Skeleton } from "../ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";
import { useProductPermissions } from "../CurrentUser";
import { useProductMode } from "../ProductMode";
import { ResourceErrorState } from "../ResourceErrorState";

/* ============================================================
   Data
   ============================================================ */
type Category = "crm" | "channels" | "calendar" | "commerce" | "developers";
type IntegrationAvailability = "selfServe" | "request" | "soon";
type Translate = (key: TranslationKey, values?: TranslationValues) => string;

interface Integration {
  id: string;
  provider: IntegrationProvider;
  name: string;
  category: Category;
  descriptionKey: TranslationKey;
  icon: React.ElementType;
  accentColor: string;
  accentBg: string;
  availability?: IntegrationAvailability;
}

const INTEGRATIONS: Integration[] = [
  {
    id: "amocrm",
    provider: "AMOCRM",
    name: "amoCRM",
    category: "crm",
    descriptionKey: "integrations.card.amocrm",
    icon: Database,
    accentColor: "text-violet-400",
    accentBg: "bg-violet-500/15",
    availability: "soon",
  },
  {
    id: "bitrix24",
    provider: "BITRIX24",
    name: "Bitrix24",
    category: "crm",
    descriptionKey: "integrations.card.bitrix24",
    icon: Layers,
    accentColor: "text-blue-400",
    accentBg: "bg-blue-500/15",
    availability: "soon",
  },
  {
    id: "retailcrm",
    provider: "RETAILCRM",
    name: "RetailCRM",
    category: "crm",
    descriptionKey: "integrations.card.retailcrm",
    icon: Store,
    accentColor: "text-orange-400",
    accentBg: "bg-orange-500/15",
    availability: "soon",
  },
  {
    id: "telegram",
    provider: "TELEGRAM",
    name: "Telegram",
    category: "channels",
    descriptionKey: "integrations.card.telegram",
    icon: Send,
    accentColor: "text-sky-400",
    accentBg: "bg-sky-500/15",
  },
  {
    id: "whatsapp",
    provider: "WHATSAPP_BUSINESS",
    name: "WhatsApp Business",
    category: "channels",
    descriptionKey: "integrations.card.whatsapp",
    icon: MessageCircle,
    accentColor: "text-emerald-400",
    accentBg: "bg-emerald-500/15",
    availability: "request",
  },
  {
    id: "instagram",
    provider: "INSTAGRAM",
    name: "Instagram",
    category: "channels",
    descriptionKey: "integrations.card.instagram",
    icon: Instagram,
    accentColor: "text-pink-400",
    accentBg: "bg-pink-500/15",
    availability: "request",
  },
  {
    id: "vk",
    provider: "VK",
    name: "VK",
    category: "channels",
    descriptionKey: "integrations.card.vk",
    icon: MessageCircle,
    accentColor: "text-indigo-400",
    accentBg: "bg-indigo-500/15",
    availability: "soon",
  },
  {
    id: "email",
    provider: "EMAIL",
    name: "Email",
    category: "channels",
    descriptionKey: "integrations.card.email",
    icon: Mail,
    accentColor: "text-amber-400",
    accentBg: "bg-amber-500/15",
    availability: "soon",
  },
  {
    id: "gcalendar",
    provider: "GOOGLE_CALENDAR",
    name: "Google Calendar",
    category: "calendar",
    descriptionKey: "integrations.card.gcalendar",
    icon: Calendar,
    accentColor: "text-teal-400",
    accentBg: "bg-teal-500/15",
    availability: "soon",
  },
  {
    id: "shopify",
    provider: "SHOPIFY",
    name: "Shopify",
    category: "commerce",
    descriptionKey: "integrations.card.shopify",
    icon: ShoppingBag,
    accentColor: "text-lime-400",
    accentBg: "bg-lime-500/15",
    availability: "soon",
  },
  {
    id: "shopscript",
    provider: "SHOP_SCRIPT",
    name: "Shop-Script",
    category: "commerce",
    descriptionKey: "integrations.card.shopscript",
    icon: Store,
    accentColor: "text-fuchsia-400",
    accentBg: "bg-fuchsia-500/15",
    availability: "soon",
  },
  {
    id: "webhook",
    provider: "WEBHOOK_API",
    name: "Webhook",
    category: "developers",
    descriptionKey: "integrations.card.webhook",
    icon: Webhook,
    accentColor: "text-rose-400",
    accentBg: "bg-rose-500/15",
  },
];

const CATEGORIES: Array<{ id: "all" | Category; labelKey: TranslationKey }> = [
  { id: "all", labelKey: "integrations.category.all" },
  { id: "crm", labelKey: "integrations.category.crm" },
  { id: "channels", labelKey: "integrations.category.channels" },
  { id: "calendar", labelKey: "integrations.category.calendar" },
  { id: "commerce", labelKey: "integrations.category.commerce" },
  { id: "developers", labelKey: "integrations.category.developers" },
];

function categoryLabel(category: Category, t: Translate) {
  const item = CATEGORIES.find((candidate) => candidate.id === category);
  return item ? t(item.labelKey) : category;
}

function initialConnectedMap() {
  return Object.fromEntries(INTEGRATIONS.map((integration) => [integration.id, false]));
}

function isConnected(account: IntegrationAccount) {
  return account.status === "CONNECTED";
}

function mergeAccountsIntoConnectedMap(accounts: IntegrationAccount[]) {
  const next = initialConnectedMap();
  for (const account of accounts) {
    const integration = INTEGRATIONS.find((item) => item.provider === account.provider);
    if (integration && isSelfServeIntegration(integration)) {
      next[integration.id] = isConnected(account);
    }
  }
  return next;
}

function apiAccountToConnectedPatch(account: IntegrationAccount) {
  const integration = INTEGRATIONS.find((item) => item.provider === account.provider);
  if (!integration || !isSelfServeIntegration(integration)) return null;
  return { id: integration.id, connected: isConnected(account) };
}

function canSendSample(provider: IntegrationProvider) {
  return provider === "WEBHOOK_API";
}

function isSelfServeIntegration(integration: Integration) {
  return (integration.availability ?? "selfServe") === "selfServe";
}

function availabilityLabel(integration: Integration, t: Translate) {
  if (integration.availability === "request") return t("integrations.availability.request");
  if (integration.availability === "soon") return t("integrations.availability.soon");
  return null;
}

const AVAILABLE_INTEGRATIONS = INTEGRATIONS.filter(isSelfServeIntegration);
const PLANNED_INTEGRATIONS = INTEGRATIONS.filter(
  (integration) => !isSelfServeIntegration(integration),
);
const AVAILABLE_CATEGORIES = CATEGORIES.filter(
  (category) =>
    category.id === "all" ||
    AVAILABLE_INTEGRATIONS.some((integration) => integration.category === category.id),
);

type SetupFieldKind = "text" | "password" | "url";

interface ProviderSetupField {
  key: string;
  label: string;
  placeholder?: string;
  placeholderKey?: TranslationKey;
  hint?: string;
  kind?: SetupFieldKind;
  wide?: boolean;
}

interface ProviderSetupConfig {
  summaryKey: TranslationKey;
  stepKeys: TranslationKey[];
  fields: ProviderSetupField[];
  docsUrl?: string;
}

const genericSetupConfig: ProviderSetupConfig = {
  summaryKey: "integrations.setup.generic.summary",
  stepKeys: [
    "integrations.setup.generic.step1",
    "integrations.setup.generic.step2",
    "integrations.setup.generic.step3",
  ],
  fields: [
    {
      key: "endpointUrl",
      label: "Endpoint URL",
      placeholder: "https://example.com/api",
      kind: "url",
      wide: true,
    },
    {
      key: "apiToken",
      label: "API token",
      placeholderKey: "integrations.field.enterToken",
      kind: "password",
      wide: true,
    },
  ],
};

const providerSetupConfigs: Partial<Record<IntegrationProvider, ProviderSetupConfig>> = {
  AMOCRM: {
    summaryKey: "integrations.setup.amocrm.summary",
    stepKeys: [
      "integrations.setup.amocrm.step1",
      "integrations.setup.amocrm.step2",
      "integrations.setup.amocrm.step3",
    ],
    docsUrl: "https://www.amocrm.ru/developers/content/oauth/oauth",
    fields: [
      {
        key: "endpointUrl",
        label: "amoCRM account URL",
        placeholder: "https://example.amocrm.ru",
        kind: "url",
        wide: true,
      },
      { key: "clientId", label: "Client ID", placeholderKey: "integrations.field.integrationUuid" },
      {
        key: "clientSecret",
        label: "Client secret",
        placeholderKey: "integrations.field.integrationSecret",
        kind: "password",
      },
      {
        key: "authorizationCode",
        label: "Authorization code",
        placeholderKey: "integrations.field.authorizationExpiry",
        kind: "password",
        wide: true,
      },
      {
        key: "redirectUri",
        label: "Redirect URI",
        placeholder: "https://leadvirt.com/oauth/amocrm/callback",
        kind: "url",
        wide: true,
      },
    ],
  },
  BITRIX24: {
    summaryKey: "integrations.setup.bitrix.summary",
    stepKeys: [
      "integrations.setup.bitrix.step1",
      "integrations.setup.bitrix.step2",
      "integrations.setup.bitrix.step3",
    ],
    docsUrl: "https://apidocs.bitrix24.com/local-integrations/local-webhooks.html",
    fields: [
      {
        key: "portalUrl",
        label: "Bitrix24 portal URL",
        placeholder: "https://example.bitrix24.ru",
        kind: "url",
        wide: true,
      },
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        placeholder: "https://example.bitrix24.ru/rest/1/key/crm.lead.add.json",
        kind: "url",
        wide: true,
      },
      {
        key: "outgoingSecret",
        label: "Outgoing webhook secret",
        placeholderKey: "integrations.field.outgoingWebhook",
        kind: "password",
        wide: true,
      },
    ],
  },
  RETAILCRM: {
    summaryKey: "integrations.setup.retail.summary",
    stepKeys: [
      "integrations.setup.retail.step1",
      "integrations.setup.retail.step2",
      "integrations.setup.retail.step3",
    ],
    docsUrl: "https://help.retailcrm.pro/Users/ApiKeys",
    fields: [
      {
        key: "endpointUrl",
        label: "RetailCRM account URL",
        placeholder: "https://example.retailcrm.ru",
        kind: "url",
        wide: true,
      },
      {
        key: "apiToken",
        label: "API key",
        placeholderKey: "integrations.field.longKey",
        kind: "password",
      },
      { key: "siteCode", label: "Site code", placeholder: "main" },
    ],
  },
  TELEGRAM: {
    summaryKey: "integrations.setup.telegram.summary",
    stepKeys: ["integrations.setup.telegram.step1", "integrations.setup.telegram.step2"],
    docsUrl: "https://t.me/BotFather",
    fields: [
      {
        key: "apiToken",
        label: "Bot token",
        placeholder: "123456:ABC...",
        kind: "password",
        wide: true,
      },
    ],
  },
  WHATSAPP_BUSINESS: {
    summaryKey: "integrations.setup.whatsapp.summary",
    stepKeys: [
      "integrations.setup.whatsapp.step1",
      "integrations.setup.whatsapp.step2",
      "integrations.setup.whatsapp.step3",
    ],
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    fields: [
      { key: "businessPortfolioId", label: "Business portfolio ID" },
      { key: "wabaId", label: "WhatsApp Business Account ID" },
      { key: "phoneNumberId", label: "Phone number ID" },
      { key: "appId", label: "Meta App ID" },
      { key: "apiToken", label: "Access token", kind: "password", wide: true },
      { key: "verifyToken", label: "Webhook verify token", kind: "password", wide: true },
    ],
  },
  INSTAGRAM: {
    summaryKey: "integrations.setup.instagram.summary",
    stepKeys: [
      "integrations.setup.instagram.step1",
      "integrations.setup.instagram.step2",
      "integrations.setup.instagram.step3",
    ],
    docsUrl: "https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook",
    fields: [
      { key: "appId", label: "Meta App ID" },
      { key: "facebookPageId", label: "Facebook Page ID" },
      { key: "instagramBusinessAccountId", label: "Instagram Business Account ID", wide: true },
      { key: "apiToken", label: "Page access token", kind: "password", wide: true },
      { key: "verifyToken", label: "Webhook verify token", kind: "password", wide: true },
    ],
  },
  VK: {
    summaryKey: "integrations.setup.vk.summary",
    stepKeys: [
      "integrations.setup.vk.step1",
      "integrations.setup.vk.step2",
      "integrations.setup.vk.step3",
    ],
    docsUrl: "https://dev.vk.com/ru/api/callback/getting-started",
    fields: [
      { key: "groupId", label: "Community ID" },
      { key: "apiToken", label: "Community token", kind: "password" },
      { key: "confirmationCode", label: "Confirmation code", kind: "password" },
      { key: "secretKey", label: "Secret key", kind: "password" },
    ],
  },
  EMAIL: {
    summaryKey: "integrations.setup.email.summary",
    stepKeys: [
      "integrations.setup.email.step1",
      "integrations.setup.email.step2",
      "integrations.setup.email.step3",
    ],
    docsUrl: "https://developers.google.com/workspace/gmail/imap/imap-smtp",
    fields: [
      { key: "emailAddress", label: "Email address", placeholder: "sales@example.com", wide: true },
      { key: "imapHost", label: "IMAP host", placeholder: "imap.gmail.com" },
      { key: "imapPort", label: "IMAP port", placeholder: "993" },
      { key: "smtpHost", label: "SMTP host", placeholder: "smtp.gmail.com" },
      { key: "smtpPort", label: "SMTP port", placeholder: "465" },
      { key: "username", label: "Username", placeholder: "sales@example.com" },
      {
        key: "apiToken",
        label: "App password / OAuth token",
        placeholder: "16-digit app password or token",
        kind: "password",
      },
    ],
  },
  GOOGLE_CALENDAR: {
    summaryKey: "integrations.setup.calendar.summary",
    stepKeys: [
      "integrations.setup.calendar.step1",
      "integrations.setup.calendar.step2",
      "integrations.setup.calendar.step3",
    ],
    docsUrl: "https://developers.google.com/workspace/calendar/api/quickstart/nodejs",
    fields: [
      { key: "clientId", label: "OAuth Client ID", wide: true },
      { key: "clientSecret", label: "OAuth Client secret", kind: "password", wide: true },
      { key: "calendarId", label: "Calendar ID", placeholder: "primary" },
      { key: "refreshToken", label: "Refresh token", kind: "password" },
    ],
  },
  SHOPIFY: {
    summaryKey: "integrations.setup.shopify.summary",
    stepKeys: [
      "integrations.setup.shopify.step1",
      "integrations.setup.shopify.step2",
      "integrations.setup.shopify.step3",
    ],
    docsUrl:
      "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
    fields: [
      { key: "shopDomain", label: "Shop domain", placeholder: "example.myshopify.com", wide: true },
      { key: "apiToken", label: "Admin API access token", kind: "password", wide: true },
      { key: "webhookSecret", label: "Webhook secret", kind: "password" },
      { key: "scopes", label: "Scopes", placeholder: "read_orders, read_customers" },
    ],
  },
  SHOP_SCRIPT: {
    summaryKey: "integrations.setup.shopscript.summary",
    stepKeys: [
      "integrations.setup.shopscript.step1",
      "integrations.setup.shopscript.step2",
      "integrations.setup.shopscript.step3",
    ],
    docsUrl: "https://developers.webasyst.com/docs/features/apis/",
    fields: [
      {
        key: "endpointUrl",
        label: "Webasyst installation URL",
        placeholder: "https://shop.example.com",
        kind: "url",
        wide: true,
      },
      { key: "clientId", label: "Client ID" },
      { key: "apiToken", label: "Access token", kind: "password" },
    ],
  },
  WEBHOOK_API: {
    summaryKey: "integrations.setup.webhook.summary",
    stepKeys: [
      "integrations.setup.webhook.step1",
      "integrations.setup.webhook.step2",
      "integrations.setup.webhook.step3",
    ],
    fields: [],
  },
};

function setupConfigForProvider(provider: IntegrationProvider) {
  return providerSetupConfigs[provider] ?? genericSetupConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringSetting(settings: Record<string, unknown>, key: string, fallback = "") {
  const value = settings[key];
  return typeof value === "string" ? value : fallback;
}

function hasSentConnectionRequest(account?: IntegrationAccount | null) {
  const settings = asRecord(account?.settings);
  return (
    settings.requestStatus === "REQUESTED" &&
    settings.requestDeliveryStatus === "SENT"
  );
}

function hasPendingConnectionRequest(account?: IntegrationAccount | null) {
  const settings = asRecord(account?.settings);
  return (
    settings.requestStatus === "REQUESTED" &&
    (settings.requestDeliveryStatus === "PENDING" ||
      settings.requestDeliveryStatus === undefined)
  );
}

function hasUnknownConnectionRequest(account?: IntegrationAccount | null) {
  const settings = asRecord(account?.settings);
  return (
    settings.requestStatus === "DELIVERY_UNKNOWN" ||
    settings.requestDeliveryStatus === "UNKNOWN"
  );
}

function publicApiOrigin() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api")
    .replace(/\/api\/?$/, "")
    .replace(/\/$/, "");
}

function inboundEndpointUrl(endpointPath: string) {
  return `${publicApiOrigin()}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
}

function formatDateTime(
  value: string | null | undefined,
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string,
  t: Translate,
) {
  if (!value) return t("integrations.date.noEvents");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("integrations.date.noEvents");
  return formatDate(date, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function latestWebhookEvent(account?: IntegrationAccount | null) {
  return account?.recentWebhookEvents?.[0] ?? null;
}

function accountReadiness(
  account: IntegrationAccount | null | undefined,
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string,
  t: Translate,
) {
  const endpoint = account?.inboundEndpoint ?? null;
  const latestEvent = latestWebhookEvent(account);
  const ready = account?.status === "CONNECTED" && Boolean(endpoint?.publicKey);

  return {
    ready,
    signal: latestEvent
      ? t("integrations.readiness.lastInbound", {
          date: formatDateTime(latestEvent.receivedAt, formatDate, t),
        })
      : account?.lastSyncAt
        ? t("integrations.readiness.lastCheck", {
            date: formatDateTime(account.lastSyncAt, formatDate, t),
          })
        : ready
          ? t("integrations.readiness.endpointReady")
          : t("integrations.readiness.activeChannelNeeded"),
  };
}

function widgetReadiness(
  channel: Channel | null | undefined,
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string,
  t: Translate,
) {
  const ready = channel?.status === "ACTIVE" && Boolean(channel.publicKey);
  return {
    ready,
    signal: channel?.lastHealthAt
      ? t("integrations.readiness.lastCheck", {
          date: formatDateTime(channel.lastHealthAt, formatDate, t),
        })
      : ready
        ? t("integrations.readiness.widgetReady")
        : channel
          ? t("integrations.readiness.channelInactive")
          : t("integrations.readiness.channelMissing"),
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function EndpointCopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const disabled = value.length === 0;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-emerald-500/30 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? t("integrations.copied") : (label ?? t("integrations.copy"))}
    </button>
  );
}

function ReadinessTile({
  title,
  ready,
  signal,
  testId,
  actionLabel,
  actionBusyLabel,
  actionHref,
  actionTestId,
  actionDisabled,
  actionBusy,
  onAction,
}: {
  title: string;
  ready: boolean;
  signal: string;
  testId: string;
  actionLabel?: string;
  actionBusyLabel?: string;
  actionHref?: string;
  actionTestId?: string;
  actionDisabled?: boolean;
  actionBusy?: boolean;
  onAction?: () => void;
}) {
  const { t } = useI18n();
  const disabled = actionDisabled || actionBusy || !ready;

  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-2xl border p-4",
        ready
          ? "border-emerald-500/15 bg-emerald-500/[0.04]"
          : "border-amber-500/15 bg-amber-500/[0.04]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">{title}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{signal}</p>
        </div>
        <Pill
          className={cn(
            "shrink-0 border text-[11px]",
            ready
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/20 bg-amber-500/10 text-amber-300",
          )}
        >
          {ready ? t("integrations.ready") : t("integrations.needsSetup")}
        </Pill>
      </div>
      {actionLabel ? (
        <div className="mt-3">
          {actionHref ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className={cn(
                "h-8 w-full rounded-xl text-xs",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <a href={actionHref} target="_blank" rel="noreferrer" data-testid={actionTestId}>
                <ExternalLink className="h-3.5 w-3.5" />
                {actionBusy ? (actionBusyLabel ?? actionLabel) : actionLabel}
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full rounded-xl text-xs"
              disabled={disabled}
              onClick={onAction}
              data-testid={actionTestId}
            >
              <Send className="h-3.5 w-3.5" />
              {actionBusy ? (actionBusyLabel ?? actionLabel) : actionLabel}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PilotReadinessPanel({
  accounts,
  channels,
  pendingId,
  canTest,
  demo,
  onSendSample,
  onTestConnection,
}: {
  accounts: IntegrationAccount[];
  channels: Channel[] | null | undefined;
  pendingId: string | null;
  canTest: boolean;
  demo: boolean;
  onSendSample: (integrationId: string) => void;
  onTestConnection: (integrationId: string) => void;
}) {
  const { formatDate, formatNumber, t } = useI18n();
  const telegram = accountReadiness(
    accounts.find((account) => account.provider === "TELEGRAM"),
    formatDate,
    t,
  );
  const webhook = accountReadiness(
    accounts.find((account) => account.provider === "WEBHOOK_API"),
    formatDate,
    t,
  );
  const websiteChannel = channels?.find((channel) => channel.type === "WEBSITE");
  const widget = widgetReadiness(websiteChannel, formatDate, t);
  const widgetHref = demo
    ? "/widget/demo"
    : websiteChannel?.publicKey
      ? `/widget/frame?key=${encodeURIComponent(websiteChannel.publicKey)}`
      : undefined;
  const readyCount = [telegram.ready, webhook.ready, widget.ready].filter(Boolean).length;

  return (
    <motion.div
      data-testid="pilot-readiness-panel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.12, ease: "easeOut" }}
      className="rounded-3xl border border-white/5 bg-zinc-900/65 p-5"
    >
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-100">{t("integrations.readiness.title")}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {t("integrations.readiness.subtitle")}
          </p>
        </div>
        <Pill className="w-fit border border-sky-500/20 bg-sky-500/10 text-xs text-sky-300">
          {t("integrations.readiness.count", { ready: formatNumber(readyCount) })}
        </Pill>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ReadinessTile
          title="Telegram"
          ready={telegram.ready}
          signal={telegram.signal}
          testId="pilot-readiness-telegram"
          actionLabel={canTest ? t("integrations.testConnection") : undefined}
          actionBusyLabel={t("integrations.syncing")}
          actionTestId="pilot-readiness-telegram-health"
          actionBusy={pendingId === "telegram"}
          onAction={() => onTestConnection("telegram")}
        />
        <ReadinessTile
          title="Webhook"
          ready={webhook.ready}
          signal={webhook.signal}
          testId="pilot-readiness-webhook"
          actionLabel={canTest ? t("integrations.internalSample") : undefined}
          actionBusyLabel={t("integrations.sending")}
          actionTestId="pilot-readiness-webhook-sample"
          actionBusy={pendingId === "webhook"}
          onAction={() => onSendSample("webhook")}
        />
        <ReadinessTile
          title={t("integrations.readiness.websiteWidget")}
          ready={widget.ready}
          signal={widget.signal}
          testId="pilot-readiness-widget"
          actionLabel={t("integrations.openWidget")}
          actionHref={widgetHref}
          actionTestId="pilot-readiness-widget-open"
        />
      </div>
    </motion.div>
  );
}

function DarkInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full bg-white/5 border border-white/5 rounded-xl px-4 h-11 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all",
        props.className,
      )}
    />
  );
}

function TelegramConnectModal({
  account,
  open,
  saving,
  onOpenChange,
  onConnect,
}: {
  account?: IntegrationAccount | null;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (botToken: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [botToken, setBotToken] = useState("");
  const settings = asRecord(account?.settings);
  const botUsername = stringSetting(settings, "botUsername");
  const connected = account?.status === "CONNECTED";

  useEffect(() => {
    if (!open) setBotToken("");
  }, [open]);

  async function handleConnect() {
    if (await onConnect(botToken.trim())) setBotToken("");
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      closeLabel={t("integrations.closeDialog")}
      title={
        connected
          ? botUsername
            ? `Telegram @${botUsername}`
            : t("integrations.telegram.connected")
          : t("integrations.telegram.connect")
      }
      description={t("integrations.telegram.description")}
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {connected ? t("integrations.close") : t("integrations.cancel")}
          </Button>
          <Button
            onClick={() => void handleConnect()}
            disabled={saving || (!connected && !botToken.trim())}
            data-testid="telegram-connect-submit"
          >
            <Zap className="h-4 w-4" />
            {saving
              ? t("integrations.telegram.connecting")
              : connected
                ? t("integrations.telegram.reconnect")
                : t("integrations.telegram.connectBot")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-col items-stretch gap-3 border-b border-white/5 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-200">
              {connected
                ? t("integrations.telegram.botConnected")
                : t("integrations.telegram.botFromBotFather")}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {connected
                ? botUsername
                  ? t("integrations.telegram.managedNamed", { username: botUsername })
                  : t("integrations.telegram.managed")
                : t("integrations.telegram.create")}
            </p>
          </div>
          <Button
            asChild
            variant={connected && botUsername ? "primary" : "outline"}
            size="sm"
            className="w-full shrink-0 sm:w-auto"
          >
            <a
              href={
                connected && botUsername
                  ? `https://t.me/${encodeURIComponent(botUsername)}?start=leadvirt`
                  : "https://t.me/BotFather"
              }
              target="_blank"
              rel="noreferrer"
              data-testid={connected && botUsername ? "telegram-open-bot" : undefined}
            >
              {connected && botUsername ? (
                <>
                  <Send className="h-3.5 w-3.5" />
                  {t("integrations.telegram.openBot")}
                </>
              ) : (
                <>
                  BotFather
                  <ExternalLink className="h-3.5 w-3.5" />
                </>
              )}
            </a>
          </Button>
        </div>

        <Field
          label={connected ? t("integrations.telegram.newToken") : t("integrations.telegram.token")}
        >
          <DarkInput
            type="password"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            placeholder={connected ? t("integrations.telegram.keepToken") : "123456789:AA..."}
            autoComplete="off"
            data-testid="telegram-bot-token"
          />
        </Field>

        <div className="space-y-3 border-t border-white/5 pt-4">
          {[
            t("integrations.telegram.autoWebhook"),
            t("integrations.telegram.safeSecret"),
            t("integrations.telegram.readyMessages"),
          ].map((label) => (
            <div key={label} className="flex items-center gap-2.5 text-sm text-zinc-300">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function IntegrationSettingsModal({
  integration,
  account,
  open,
  saving,
  sampleBusy,
  canRequest,
  requestSent,
  requestUnknown,
  requestContactRequired,
  onOpenChange,
  onSendSample,
  onConnectTelegram,
  onRequest,
}: {
  integration: Integration | null;
  account?: IntegrationAccount | null;
  open: boolean;
  saving: boolean;
  sampleBusy: boolean;
  canRequest: boolean;
  requestSent: boolean;
  requestUnknown: boolean;
  requestContactRequired: boolean;
  onOpenChange: (open: boolean) => void;
  onSendSample: () => void;
  onConnectTelegram: (botToken: string) => Promise<boolean>;
  onRequest: () => void;
}) {
  const { t } = useI18n();

  if (!integration) return null;
  if (integration.provider === "TELEGRAM") {
    return (
      <TelegramConnectModal
        account={account}
        open={open}
        saving={saving}
        onOpenChange={onOpenChange}
        onConnect={onConnectTelegram}
      />
    );
  }
  const isWebhookApi = integration.provider === "WEBHOOK_API";
  const isConnectionRequest = integration.availability === "request";
  const setupConfig = setupConfigForProvider(integration.provider);
  const unavailableLabel = availabilityLabel(integration, t);
  const inboundEndpoint = account?.inboundEndpoint ?? null;
  const fullEndpointUrl = inboundEndpoint ? inboundEndpointUrl(inboundEndpoint.endpointPath) : "";
  const samplePayload = inboundEndpoint
    ? JSON.stringify(inboundEndpoint.samplePayload, null, 2)
    : "";

  return (
    <Modal
      key={integration.id}
      open={open}
      onOpenChange={onOpenChange}
      closeLabel={t("integrations.closeDialog")}
      title={t("integrations.settingsTitle", { name: integration.name })}
      description={
        integration.availability === "soon"
          ? t("integrations.notAvailableYet", { name: integration.name })
          : isConnectionRequest
            ? t("integrations.request.description", { name: integration.name })
            : t(setupConfig.summaryKey)
      }
      className="max-w-2xl"
      footer={
        isWebhookApi ? (
          <>
            <Button asChild variant="outline">
              <a href="/app/settings?tab=channels">
                <Settings className="h-4 w-4" />
                {t("integrations.webhook.manageSettings")}
              </a>
            </Button>
            <Button onClick={() => onOpenChange(false)}>{t("integrations.close")}</Button>
          </>
        ) : isConnectionRequest ? (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("integrations.close")}
            </Button>
            {requestContactRequired ? (
              <Button asChild>
                <a href="/app/settings?tab=profile">
                  <Settings className="h-4 w-4" />
                  {t("integrations.request.openSettings")}
                </a>
              </Button>
            ) : canRequest && !requestUnknown ? (
              <Button
                onClick={onRequest}
                disabled={saving || requestSent}
                data-testid="integration-request-submit"
              >
                {requestSent
                  ? t("integrations.request.sent")
                  : saving
                    ? t("integrations.request.sending")
                    : t("integrations.request.submit")}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {setupConfig.docsUrl && (
              <Button asChild variant="outline">
                <a href={setupConfig.docsUrl} target="_blank" rel="noreferrer">
                  {t("integrations.documentation")}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>{t("integrations.close")}</Button>
          </>
        )
      }
    >
      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-zinc-200">{t("integrations.setupFlow")}</p>
          {unavailableLabel && (
            <Pill
              className={cn(
                "border text-xs",
                requestSent
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : integration.availability === "soon"
                    ? "border-zinc-700 bg-white/[0.03] text-zinc-400"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-300",
              )}
            >
              {requestUnknown
                ? t("integrations.request.unknown")
                : requestSent
                  ? t("integrations.request.sent")
                  : saving && isConnectionRequest
                    ? t("integrations.request.sending")
                    : unavailableLabel}
            </Pill>
          )}
        </div>
        <ol className="space-y-2">
          {setupConfig.stepKeys.map((stepKey, index) => (
            <li key={stepKey} className="flex gap-3 text-sm text-zinc-400">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-zinc-300">
                {index + 1}
              </span>
              <span className="pt-0.5">{t(stepKey)}</span>
            </li>
          ))}
        </ol>
      </div>

      {isWebhookApi ? (
        <div
          className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-4"
          data-testid="webhook-settings-authority"
        >
          <p className="text-sm font-semibold text-zinc-200">
            {t("integrations.webhook.manageTitle")}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {t("integrations.webhook.manageDescription")}
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/5 bg-zinc-950/40 p-4">
          <p className="mb-3 text-sm font-semibold text-zinc-200">
            {t("integrations.requirements")}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {setupConfig.fields.map((field) => (
              <div
                key={field.key}
                className={cn(
                  "rounded-xl border border-white/5 bg-white/[0.03] p-3",
                  field.wide && "md:col-span-2",
                )}
              >
                <p className="text-sm font-medium text-zinc-300">{field.label}</p>
                {(field.placeholder || field.hint) && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {field.hint ??
                      (field.placeholderKey ? t(field.placeholderKey) : field.placeholder)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isWebhookApi && (
        <div
          className={cn(
            "mt-4 rounded-2xl border p-4 text-sm",
            requestSent
              ? "border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-100/90"
              : "border-amber-500/15 bg-amber-500/[0.04] text-amber-100/90",
          )}
          data-testid={isConnectionRequest ? "integration-request-status" : undefined}
        >
          {integration.availability === "soon"
            ? t("integrations.notAvailableYet", { name: integration.name })
            : requestContactRequired
              ? t("integrations.request.contactRequired")
              : requestUnknown
                ? t("integrations.request.unknownDescription")
                : requestSent
                  ? t("integrations.request.confirmation")
                  : saving && isConnectionRequest
                    ? t("integrations.request.sending")
                    : canRequest
                      ? t("integrations.notSelfServe")
                      : t("integrations.request.noPermission")}
        </div>
      )}

      {inboundEndpoint && (
        <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-300">
                {t("integrations.publicEndpoint")}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">{t("integrations.publicEndpointHint")}</p>
            </div>
            <Pill className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
              {inboundEndpoint.channelType}
            </Pill>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">
                  {t("integrations.field.endpoint")}
                </span>
                <EndpointCopyButton value={fullEndpointUrl} />
              </div>
              <div className="break-all rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">
                {fullEndpointUrl}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">
                    {t("integrations.publicKey")}
                  </span>
                  <EndpointCopyButton
                    value={inboundEndpoint.publicKey}
                    label={t("integrations.key")}
                  />
                </div>
                <div className="break-all rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">
                  {inboundEndpoint.publicKey}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">
                    {t("integrations.secretHeader")}
                  </span>
                  <EndpointCopyButton
                    value={inboundEndpoint.secretHeader}
                    label={t("integrations.header")}
                  />
                </div>
                <div className="break-all rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">
                  {inboundEndpoint.secretHeader}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">
                  {t("integrations.samplePayload")}
                </span>
                <EndpointCopyButton value={samplePayload} label={t("integrations.payload")} />
              </div>
              <pre className="max-h-44 overflow-auto rounded-xl border border-white/5 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-300">
                {samplePayload}
              </pre>
            </div>

            {isWebhookApi && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full rounded-xl text-xs"
                disabled={sampleBusy || !inboundEndpoint}
                onClick={onSendSample}
                data-testid="webhook-settings-sample"
              >
                <Send className="h-3.5 w-3.5" />
                {sampleBusy ? t("integrations.sending") : t("integrations.internalSample")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   Integration Card
   ============================================================ */
function IntegrationCard({
  integration,
  account,
  connected,
  pending,
  requestSent,
  requestUnknown,
  onToggle,
  onDisconnect,
  onConfigure,
  onTest,
  onSample,
  canManage,
  canTest,
  index,
}: {
  integration: Integration;
  account?: IntegrationAccount;
  connected: boolean;
  pending: boolean;
  requestSent: boolean;
  requestUnknown: boolean;
  onToggle: () => void;
  onDisconnect: () => void | Promise<void>;
  onConfigure: () => void;
  onTest: () => void;
  onSample: () => void;
  canManage: boolean;
  canTest: boolean;
  index: number;
}) {
  const { t } = useI18n();
  const Icon = integration.icon;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const availability = availabilityLabel(integration, t);
  const availabilityStatus = requestUnknown
    ? t("integrations.request.unknown")
    : requestSent
      ? t("integrations.request.sent")
      : pending && integration.availability === "request"
        ? t("integrations.request.sending")
        : availability;
  const canSelfServe = isSelfServeIntegration(integration);
  const connectedVisible = canSelfServe && connected;
  const telegramUsername =
    integration.provider === "TELEGRAM"
      ? stringSetting(asRecord(account?.settings), "botUsername")
      : undefined;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
        whileHover={{ y: -4 }}
        className="group scroll-mt-20 scroll-mb-24"
      >
        <div
          className={cn(
            "relative rounded-2xl bg-zinc-900/70 border border-white/5 p-5 flex flex-col gap-4 h-full",
            "transition-all duration-300",
            "hover:border-white/10 hover:bg-zinc-900/80",
            connectedVisible && "hover:shadow-[0_0_24px_-6px] hover:shadow-emerald-500/20",
          )}
          data-testid={`integration-card-${integration.id}`}
        >
          {/* Glow blob */}
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 relative">
            <div
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                integration.accentBg,
              )}
            >
              <Icon className={cn("w-6 h-6", integration.accentColor)} />
            </div>
            <Pill
              className={cn(
                "text-[11px] shrink-0",
                "bg-white/5 text-zinc-400 border border-white/5",
              )}
            >
              {categoryLabel(integration.category, t)}
            </Pill>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 flex-1 relative">
            <span className="text-sm font-bold text-zinc-100 tracking-tight">
              {integration.name}
            </span>
            {connectedVisible && telegramUsername ? (
              <a
                href={`https://t.me/${encodeURIComponent(telegramUsername)}?start=leadvirt`}
                target="_blank"
                rel="noreferrer"
                data-testid="telegram-card-open-bot"
                className="mb-1 inline-flex w-fit max-w-full items-center gap-1.5 text-xs font-medium text-sky-300 transition-colors hover:text-sky-200"
              >
                <Send className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">@{telegramUsername}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : null}
            <span className="text-xs text-zinc-500 leading-relaxed">
              {t(integration.descriptionKey)}
            </span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 relative">
            {!canSelfServe ? (
              <div className="flex w-full flex-col gap-2">
                <span
                  className={cn(
                    "w-fit rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    requestSent
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                      : integration.availability === "soon"
                      ? "border-zinc-700 bg-white/[0.03] text-zinc-400"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-300",
                  )}
                >
                  {availabilityStatus}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-8 w-full scroll-mt-20 scroll-mb-24 whitespace-normal rounded-full px-3 py-2 text-xs"
                  onClick={onConfigure}
                >
                  {availabilityStatus}
                </Button>
              </div>
            ) : connectedVisible ? (
              <>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {pending ? t("integrations.syncing") : t("integrations.connected")}
                </span>
                {canManage || canTest ? (
                  <Dropdown
                    trigger={
                      <Button variant="outline" size="sm" className="h-8 px-3 text-xs rounded-full">
                        {canManage ? t("integrations.configure") : t("integrations.testConnection")}
                      </Button>
                    }
                  >
                    {canManage ? (
                      <DropdownItem icon={Settings} onClick={onConfigure}>
                        {t("integrations.configure")}
                      </DropdownItem>
                    ) : null}
                    {canTest ? (
                      <DropdownItem icon={RefreshCw} onClick={onTest}>
                        {t("integrations.testConnection")}
                      </DropdownItem>
                    ) : null}
                    {canTest && canSendSample(integration.provider) ? (
                      <DropdownItem icon={Send} onClick={onSample}>
                        {t("integrations.internalSample")}
                      </DropdownItem>
                    ) : null}
                    {canManage ? <DropdownSeparator /> : null}
                    {canManage ? (
                      <DropdownItem icon={LogOut} onClick={() => setConfirmOpen(true)} danger>
                        {t("integrations.disconnect")}
                      </DropdownItem>
                    ) : null}
                  </Dropdown>
                ) : null}
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="h-8 px-4 text-xs rounded-full w-full"
                onClick={onToggle}
                disabled={pending || !canManage}
              >
                <Zap className="w-3 h-3 mr-1.5" />
                {pending ? t("integrations.connecting") : t("integrations.connect")}
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("integrations.disconnectTitle")}
        description={t("integrations.disconnectDescription", { name: integration.name })}
        danger
        confirmLabel={t("integrations.disconnect")}
        onConfirm={onDisconnect}
      />
    </>
  );
}

/* ============================================================
   API Card
   ============================================================ */
type ApiCopyTarget = "endpoint" | "publicKey" | "secretHeader" | "payload";

function ApiCard({
  accounts,
  pendingId,
  canTest,
  onSendSample,
}: {
  accounts: IntegrationAccount[];
  pendingId: string | null;
  canTest: boolean;
  onSendSample: (integrationId: string) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<ApiCopyTarget | null>(null);
  const webhookAccount = accounts.find((account) => account.provider === "WEBHOOK_API");
  const endpoint = webhookAccount?.inboundEndpoint ?? null;
  const endpointUrl = endpoint ? inboundEndpointUrl(endpoint.endpointPath) : "";
  const samplePayload = endpoint?.samplePayload
    ? JSON.stringify(endpoint.samplePayload, null, 2)
    : "";
  const rows: { id: ApiCopyTarget; label: string; value: string; empty: string }[] = [
    {
      id: "endpoint",
      label: "Webhook URL",
      value: endpointUrl,
      empty: t("integrations.api.connectForUrl"),
    },
    {
      id: "publicKey",
      label: t("integrations.publicKey"),
      value: endpoint?.publicKey ?? "",
      empty: t("integrations.api.publicKeyUnavailable"),
    },
    {
      id: "secretHeader",
      label: "Secret header",
      value: endpoint?.secretHeader ?? "",
      empty: t("integrations.api.headerUnavailable"),
    },
    {
      id: "payload",
      label: "Sample payload",
      value: samplePayload,
      empty: t("integrations.api.payloadUnavailable"),
    },
  ];

  function handleCopy(type: ApiCopyTarget, value: string) {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
    >
      <Card className="p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.id}>
                <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">{row.label}</p>
                <div
                  data-testid={`api-webhook-${row.id}`}
                  className="flex items-center gap-2 rounded-xl border border-white/5 bg-zinc-800/60 px-4 py-2.5"
                >
                  <span
                    className={cn(
                      "flex-1 truncate font-mono text-sm",
                      row.value ? "text-zinc-300" : "text-zinc-600",
                    )}
                  >
                    {row.value || row.empty}
                  </span>
                  <button
                    aria-label={t("integrations.api.copyLabel", { label: row.label })}
                    disabled={!row.value}
                    onClick={() => handleCopy(row.id, row.value)}
                    className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                    title={t("integrations.copy")}
                  >
                    {copied === row.id ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 md:pt-6 md:shrink-0">
            <div data-testid="api-webhook-status" className="flex flex-col gap-2">
              <Pill
                className={cn(
                  "justify-center text-[11px]",
                  endpoint
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300",
                )}
              >
                {endpoint ? t("integrations.webhook.ready") : t("integrations.needsSetup")}
              </Pill>
            </div>
            {canTest ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!endpoint || pendingId === "webhook"}
                onClick={() => onSendSample("webhook")}
                data-testid="api-webhook-sample"
              >
                <Send className="h-4 w-4" />
                {pendingId === "webhook"
                  ? t("integrations.sending")
                  : t("integrations.internalSample")}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

/* ============================================================
   Page
   ============================================================ */
export function IntegrationsPage() {
  const { formatNumber, t } = useI18n();
  const permissions = useProductPermissions();
  const { demo } = useProductMode();
  const [activeCategory, setActiveCategory] = useState<"all" | Category>("all");
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountsLoadStatus, setAccountsLoadStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [accountsReloadRevision, setAccountsReloadRevision] = useState(0);
  const [channels, setChannels] = useState<Channel[] | null | undefined>(undefined);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsLoadStatus, setChannelsLoadStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [channelsReloadRevision, setChannelsReloadRevision] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>(initialConnectedMap);
  const [requestedProviders, setRequestedProviders] = useState<Set<IntegrationProvider>>(
    () => new Set(),
  );
  const [pendingRequestProviders, setPendingRequestProviders] = useState<
    Set<IntegrationProvider>
  >(() => new Set());
  const [unknownRequestProviders, setUnknownRequestProviders] = useState<
    Set<IntegrationProvider>
  >(() => new Set());
  const [contactRequiredProviders, setContactRequiredProviders] = useState<
    Set<IntegrationProvider>
  >(() => new Set());
  const [settingsIntegrationId, setSettingsIntegrationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setAccountsLoadStatus("loading");
    void listIntegrations()
      .then((items) => {
        if (cancelled) return;
        setAccounts(items);
        setAccountsLoaded(true);
        setAccountsLoadStatus("success");
        setConnectedMap(mergeAccountsIntoConnectedMap(items));
        setRequestedProviders(
          new Set(
            items
              .filter((account) => hasSentConnectionRequest(account))
              .map((account) => account.provider),
          ),
        );
        setPendingRequestProviders(
          new Set(
            items
              .filter((account) => hasPendingConnectionRequest(account))
              .map((account) => account.provider),
          ),
        );
        setUnknownRequestProviders(
          new Set(
            items
              .filter((account) => hasUnknownConnectionRequest(account))
              .map((account) => account.provider),
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setAccountsLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [accountsReloadRevision]);

  useEffect(() => {
    let cancelled = false;

    setChannelsLoadStatus("loading");
    void listChannels()
      .then((items) => {
        if (cancelled) return;
        setChannels(items);
        setChannelsLoaded(true);
        setChannelsLoadStatus("success");
      })
      .catch(() => {
        if (!cancelled) setChannelsLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [channelsReloadRevision]);

  function updateFromAccount(account: IntegrationAccount) {
    setAccounts((prev) => {
      const exists = prev.some((item) => item.id === account.id);
      return exists
        ? prev.map((item) => (item.id === account.id ? account : item))
        : [...prev, account];
    });

    const patch = apiAccountToConnectedPatch(account);
    if (patch) {
      setConnectedMap((prev) => ({ ...prev, [patch.id]: patch.connected }));
    }
  }

  async function connectTelegramBot(botToken: string) {
    if (!permissions.canManageIntegrations) return false;
    setPendingId("telegram");
    try {
      const account = await connectIntegration("TELEGRAM", botToken ? { botToken } : {});
      updateFromAccount(account);
      setChannelsLoadStatus("loading");
      void listChannels().then(
        (items) => {
          setChannels(items);
          setChannelsLoaded(true);
          setChannelsLoadStatus("success");
        },
        () => setChannelsLoadStatus("error"),
      );
      const settings = asRecord(account.settings);
      const username = stringSetting(settings, "botUsername");
      toast.success(
        username
          ? t("integrations.toast.telegramNamed", { username })
          : t("integrations.toast.telegramConnected"),
      );
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("integrations.toast.telegramFailed"));
      return false;
    } finally {
      setPendingId(null);
    }
  }

  async function disconnect(id: string) {
    if (!permissions.canManageIntegrations) return;
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;
    const previous = connectedMap[id];
    setPendingId(id);
    setConnectedMap((prev) => ({ ...prev, [id]: false }));

    try {
      const account = await disconnectIntegration(integration.provider);
      updateFromAccount(account);
      toast.success(t("integrations.toast.disconnected", { name: integration.name }));
    } catch (error) {
      setConnectedMap((prev) => ({ ...prev, [id]: previous }));
      toast.error(
        error instanceof Error ? error.message : t("integrations.toast.disconnectFailed"),
      );
    } finally {
      setPendingId(null);
    }
  }

  async function requestConnection(id: string) {
    if (!permissions.canManageIntegrations) return;
    const integration = INTEGRATIONS.find(
      (item) => item.id === id && item.availability === "request",
    );
    if (!integration) return;

    setPendingId(id);
    try {
      const request = await requestIntegrationConnection(integration.provider);
      setRequestedProviders((current) => new Set(current).add(request.provider));
      setPendingRequestProviders((current) => {
        const next = new Set(current);
        next.delete(request.provider);
        return next;
      });
      setUnknownRequestProviders((current) => {
        const next = new Set(current);
        next.delete(request.provider);
        return next;
      });
      setContactRequiredProviders((current) => {
        const next = new Set(current);
        next.delete(request.provider);
        return next;
      });
      toast.success(t("integrations.request.confirmation"));
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "INTEGRATION_REQUEST_DELIVERY_UNKNOWN"
      ) {
        setRequestedProviders((current) => {
          const next = new Set(current);
          next.delete(integration.provider);
          return next;
        });
        setUnknownRequestProviders((current) => new Set(current).add(integration.provider));
        setPendingRequestProviders((current) => {
          const next = new Set(current);
          next.delete(integration.provider);
          return next;
        });
        toast.error(t("integrations.request.unknownDescription"));
      } else if (
        error instanceof ApiClientError &&
        error.code === "INTEGRATION_REQUEST_CONTACT_REQUIRED"
      ) {
        setContactRequiredProviders((current) => new Set(current).add(integration.provider));
        toast.error(t("integrations.request.contactRequired"));
      } else {
        toast.error(t("integrations.request.failed"));
      }
    } finally {
      setPendingId(null);
    }
  }

  function configure(id: string) {
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (integration && isSelfServeIntegration(integration) && !permissions.canManageIntegrations) {
      return;
    }
    setSettingsIntegrationId(id);
  }

  async function testConnection(id: string) {
    if (!permissions.canTestIntegrations) return;
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;
    setPendingId(id);

    try {
      const result = await testIntegrationConnection(integration.provider);
      updateFromAccount(result.integration);
      const notify = result.ok ? toast.success : toast.error;
      notify(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("integrations.toast.testFailed"));
    } finally {
      setPendingId(null);
    }
  }

  async function sendSample(id: string) {
    if (!permissions.canTestIntegrations) return;
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;
    setPendingId(id);

    try {
      const result = await sendSampleInbound(integration.provider);
      updateFromAccount(result.integration);
      toast.success(t("integrations.toast.sampleDone"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("integrations.toast.sampleFailed"));
    } finally {
      setPendingId(null);
    }
  }

  if (!accountsLoaded || !channelsLoaded) {
    const loadFailed = accountsLoadStatus === "error" || channelsLoadStatus === "error";
    return (
      <ProductLayout title={t("integrations.title")}>
        {loadFailed ? (
          <ResourceErrorState
            testId="integrations-load-error"
            onRetry={() => {
              if (accountsLoadStatus === "error") {
                setAccountsReloadRevision((current) => current + 1);
              }
              if (channelsLoadStatus === "error") {
                setChannelsReloadRevision((current) => current + 1);
              }
            }}
          />
        ) : (
          <div className="space-y-7" data-testid="integrations-loading">
            <Skeleton className="h-16 w-96 max-w-full" />
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-32" />
              ))}
            </div>
            <Skeleton className="h-56" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-64" />
              ))}
            </div>
          </div>
        )}
      </ProductLayout>
    );
  }

  const totalConnected = INTEGRATIONS.filter(
    (integration) => isSelfServeIntegration(integration) && connectedMap[integration.id],
  ).length;
  const totalAvailable = AVAILABLE_INTEGRATIONS.length;
  const channelsActive = INTEGRATIONS.filter(
    (i) => i.category === "channels" && isSelfServeIntegration(i) && connectedMap[i.id],
  ).length;

  const filtered =
    activeCategory === "all"
      ? AVAILABLE_INTEGRATIONS
      : AVAILABLE_INTEGRATIONS.filter((i) => i.category === activeCategory);
  const settingsIntegration =
    INTEGRATIONS.find((item) => item.id === settingsIntegrationId) ?? null;
  const settingsAccount = settingsIntegration
    ? (accounts.find((item) => item.provider === settingsIntegration.provider) ?? null)
    : null;

  return (
    <ProductLayout title={t("integrations.title")}>
      <div className="flex flex-col gap-8">
        {accountsLoadStatus === "error" || channelsLoadStatus === "error" ? (
          <ResourceErrorState
            testId="integrations-refresh-error"
            onRetry={() => {
              if (accountsLoadStatus === "error") {
                setAccountsReloadRevision((current) => current + 1);
              }
              if (channelsLoadStatus === "error") {
                setChannelsReloadRevision((current) => current + 1);
              }
            }}
          />
        ) : null}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <p className="max-w-xl text-sm text-zinc-400">{t("integrations.subtitle")}</p>
        </motion.div>

        {/* Stat chips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-wrap gap-3"
        >
          {[
            {
              label: t("integrations.stats.connected"),
              value: totalConnected,
              color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
              testId: "integrations-stat-connected",
            },
            {
              label: t("integrations.stats.available"),
              value: totalAvailable,
              color: "text-zinc-300 bg-white/5 border-white/5",
              testId: "integrations-stat-available",
            },
            {
              label: t("integrations.stats.activeChannels"),
              value: channelsActive,
              color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
              testId: "integrations-stat-active-channels",
            },
          ].map(({ label, value, color, testId }) => (
            <div
              key={label}
              data-testid={testId}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium",
                color,
              )}
            >
              <span className="text-base font-bold">{formatNumber(value)}</span>
              <span className="text-xs opacity-80">{label}</span>
            </div>
          ))}
        </motion.div>

        {/* Category filter */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="flex flex-wrap gap-2"
        >
          {AVAILABLE_CATEGORIES.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-xs font-medium transition-all duration-200",
                activeCategory === category.id
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-white/[0.03] border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]",
              )}
            >
              {t(category.labelKey)}
            </button>
          ))}
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((integration, i) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              account={accounts.find((account) => account.provider === integration.provider)}
              connected={connectedMap[integration.id]}
              pending={
                pendingId === integration.id ||
                pendingRequestProviders.has(integration.provider)
              }
              requestSent={requestedProviders.has(integration.provider)}
              requestUnknown={unknownRequestProviders.has(integration.provider)}
              onToggle={() => configure(integration.id)}
              onDisconnect={() => disconnect(integration.id)}
              onConfigure={() => void configure(integration.id)}
              onTest={() => void testConnection(integration.id)}
              onSample={() => void sendSample(integration.id)}
              canManage={permissions.canManageIntegrations}
              canTest={permissions.canTestIntegrations}
              index={i}
            />
          ))}
        </div>

        <PilotReadinessPanel
          accounts={accounts}
          channels={channels}
          pendingId={pendingId}
          canTest={permissions.canTestIntegrations}
          demo={demo}
          onSendSample={(id) => void sendSample(id)}
          onTestConnection={(id) => void testConnection(id)}
        />

        <details
          className="group/planned rounded-lg border border-white/10 bg-white/[0.02]"
          data-testid="integrations-planned"
        >
          <summary
            className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            data-testid="integrations-planned-toggle"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-200">
                {t("integrations.planned.title")}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                {t("integrations.planned.description")}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open/planned:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-white/10 p-4 md:grid-cols-2 lg:grid-cols-3">
            {PLANNED_INTEGRATIONS.map((integration, index) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                account={accounts.find((account) => account.provider === integration.provider)}
                connected={false}
                pending={
                  pendingId === integration.id ||
                  pendingRequestProviders.has(integration.provider)
                }
                requestSent={requestedProviders.has(integration.provider)}
                requestUnknown={unknownRequestProviders.has(integration.provider)}
                onToggle={() => undefined}
                onDisconnect={() => undefined}
                onConfigure={() => void configure(integration.id)}
                onTest={() => undefined}
                onSample={() => undefined}
                canManage={permissions.canManageIntegrations}
                canTest={false}
                index={index}
              />
            ))}
          </div>
        </details>

        {activeCategory === "developers" || connectedMap.webhook ? (
          <div>
            <SectionTitle
              title={t("integrations.webhook.title")}
              sub={t("integrations.webhook.subtitle")}
            />
            <ApiCard
              accounts={accounts}
              pendingId={pendingId}
              canTest={permissions.canTestIntegrations}
              onSendSample={(id) => void sendSample(id)}
            />
          </div>
        ) : null}

        <IntegrationSettingsModal
          integration={settingsIntegration}
          account={settingsAccount}
          open={settingsIntegrationId !== null}
          saving={
            pendingId === settingsIntegrationId ||
            (settingsIntegration
              ? pendingRequestProviders.has(settingsIntegration.provider)
              : false)
          }
          sampleBusy={pendingId === "webhook"}
          canRequest={permissions.canManageIntegrations}
          requestSent={
            settingsIntegration
              ? requestedProviders.has(settingsIntegration.provider)
              : false
          }
          requestUnknown={
            settingsIntegration
              ? unknownRequestProviders.has(settingsIntegration.provider)
              : false
          }
          requestContactRequired={
            settingsIntegration
              ? contactRequiredProviders.has(settingsIntegration.provider)
              : false
          }
          onOpenChange={(open) => {
            if (!open) setSettingsIntegrationId(null);
          }}
          onSendSample={() => void sendSample("webhook")}
          onConnectTelegram={connectTelegramBot}
          onRequest={() => {
            if (settingsIntegration) void requestConnection(settingsIntegration.id);
          }}
        />
      </div>
    </ProductLayout>
  );
}
