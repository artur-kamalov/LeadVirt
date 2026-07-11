import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  sendSampleInbound,
  testIntegrationConnection,
  updateIntegrationSettings,
} from "@/lib/api/integrations";
import { listChannels } from "@/lib/api/channels";
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  ConfirmDialog,
  Modal,
  Select as BrandSelect,
} from "../ui";

/* ============================================================
   Data
   ============================================================ */
type Category = "CRM" | "Каналы" | "Календарь" | "E-commerce" | "Разработчикам";
type IntegrationAvailability = "selfServe" | "request" | "soon";

interface Integration {
  id: string;
  provider: IntegrationProvider;
  name: string;
  category: Category;
  description: string;
  icon: React.ElementType;
  accentColor: string;
  accentBg: string;
  connected: boolean;
  availability?: IntegrationAvailability;
}

const INTEGRATIONS: Integration[] = [
  {
    id: "amocrm",
    provider: "AMOCRM",
    name: "amoCRM",
    category: "CRM",
    description: "Передача сделок и контактов",
    icon: Database,
    accentColor: "text-violet-400",
    accentBg: "bg-violet-500/15",
    connected: true,
  },
  {
    id: "bitrix24",
    provider: "BITRIX24",
    name: "Bitrix24",
    category: "CRM",
    description: "Синхронизация лидов и задач",
    icon: Layers,
    accentColor: "text-blue-400",
    accentBg: "bg-blue-500/15",
    connected: true,
  },
  {
    id: "retailcrm",
    provider: "RETAILCRM",
    name: "RetailCRM",
    category: "CRM",
    description: "Заказы для интернет-магазина",
    icon: Store,
    accentColor: "text-orange-400",
    accentBg: "bg-orange-500/15",
    connected: false,
  },
  {
    id: "telegram",
    provider: "TELEGRAM",
    name: "Telegram",
    category: "Каналы",
    description: "Автоматические ответы в чатах и каналах",
    icon: Send,
    accentColor: "text-sky-400",
    accentBg: "bg-sky-500/15",
    connected: true,
  },
  {
    id: "whatsapp",
    provider: "WHATSAPP_BUSINESS",
    name: "WhatsApp Business",
    category: "Каналы",
    description: "Обработка входящих сообщений и уведомления",
    icon: MessageCircle,
    accentColor: "text-emerald-400",
    accentBg: "bg-emerald-500/15",
    connected: true,
    availability: "request",
  },
  {
    id: "instagram",
    provider: "INSTAGRAM",
    name: "Instagram",
    category: "Каналы",
    description: "Директ и комментарии под постами",
    icon: Instagram,
    accentColor: "text-pink-400",
    accentBg: "bg-pink-500/15",
    connected: true,
    availability: "request",
  },
  {
    id: "vk",
    provider: "VK",
    name: "VK",
    category: "Каналы",
    description: "Сообщения и заявки из сообщества ВКонтакте",
    icon: MessageCircle,
    accentColor: "text-indigo-400",
    accentBg: "bg-indigo-500/15",
    connected: false,
    availability: "soon",
  },
  {
    id: "email",
    provider: "EMAIL",
    name: "Email",
    category: "Каналы",
    description: "Входящие письма превращаются в задачи",
    icon: Mail,
    accentColor: "text-amber-400",
    accentBg: "bg-amber-500/15",
    connected: true,
  },
  {
    id: "gcalendar",
    provider: "GOOGLE_CALENDAR",
    name: "Google Calendar",
    category: "Календарь",
    description: "Запись клиентов и синхронизация расписания",
    icon: Calendar,
    accentColor: "text-teal-400",
    accentBg: "bg-teal-500/15",
    connected: true,
  },
  {
    id: "shopify",
    provider: "SHOPIFY",
    name: "Shopify",
    category: "E-commerce",
    description: "Заказы и статусы доставки в одном месте",
    icon: ShoppingBag,
    accentColor: "text-lime-400",
    accentBg: "bg-lime-500/15",
    connected: false,
    availability: "soon",
  },
  {
    id: "shopscript",
    provider: "SHOP_SCRIPT",
    name: "Shop-Script",
    category: "E-commerce",
    description: "Заказы и клиенты из Webasyst Shop-Script",
    icon: Store,
    accentColor: "text-fuchsia-400",
    accentBg: "bg-fuchsia-500/15",
    connected: false,
    availability: "soon",
  },
  {
    id: "webhook",
    provider: "WEBHOOK_API",
    name: "Webhook / API",
    category: "Разработчикам",
    description: "Гибкая интеграция с любым сервисом через HTTP",
    icon: Webhook,
    accentColor: "text-rose-400",
    accentBg: "bg-rose-500/15",
    connected: false,
  },
];

const CATEGORIES: ("Все" | Category)[] = [
  "Все",
  "CRM",
  "Каналы",
  "Календарь",
  "E-commerce",
  "Разработчикам",
];

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
    if (integration) {
      next[integration.id] = isConnected(account);
    }
  }
  return next;
}

function apiAccountToConnectedPatch(account: IntegrationAccount) {
  const integration = INTEGRATIONS.find((item) => item.provider === account.provider);
  if (!integration) return null;
  return { id: integration.id, connected: isConnected(account) };
}

function canSendSample(provider: IntegrationProvider) {
  return provider === "TELEGRAM" || provider === "WEBHOOK_API";
}

function isSelfServeIntegration(integration: Integration) {
  return (integration.availability ?? "selfServe") === "selfServe";
}

function availabilityLabel(integration: Integration) {
  if (integration.availability === "request") return "Подключение по запросу";
  if (integration.availability === "soon") return "Скоро будет";
  return null;
}

type SyncMode = "leads-to-service" | "two-way" | "events-only";

type SetupFieldKind = "text" | "password" | "url";

interface ProviderSetupField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  kind?: SetupFieldKind;
  defaultValue?: string;
  wide?: boolean;
}

interface ProviderSetupConfig {
  summary: string;
  steps: string[];
  fields: ProviderSetupField[];
  docsUrl?: string;
}

interface IntegrationSettingsForm {
  displayName: string;
  fields: Record<string, string>;
  syncMode: SyncMode;
  syncEnabled: boolean;
  notes: string;
}

const syncModeOptions = [
  { value: "leads-to-service", label: "Лиды в сервис" },
  { value: "two-way", label: "Двусторонняя" },
  { value: "events-only", label: "Только события" },
];

const genericSetupConfig: ProviderSetupConfig = {
  summary: "Ручное подключение через URL сервиса и секретный ключ.",
  steps: [
    "Создайте ключ или webhook в сервисе.",
    "Вставьте URL и токен.",
    "Сохраните настройки и проверьте связь.",
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
      placeholder: "Введите токен",
      kind: "password",
      wide: true,
    },
  ],
};

const providerSetupConfigs: Partial<Record<IntegrationProvider, ProviderSetupConfig>> = {
  AMOCRM: {
    summary:
      "amoCRM подключается через OAuth: аккаунт, ID/secret интеграции и короткоживущий authorization code.",
    steps: [
      "Создайте или откройте интеграцию в amoCRM.",
      "Скопируйте Client ID, Client secret и Redirect URI.",
      "Установите интеграцию в аккаунте и вставьте authorization code.",
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
      { key: "clientId", label: "Client ID", placeholder: "uuid интеграции" },
      {
        key: "clientSecret",
        label: "Client secret",
        placeholder: "Секрет интеграции",
        kind: "password",
      },
      {
        key: "authorizationCode",
        label: "Authorization code",
        placeholder: "Код живет около 20 минут",
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
    summary: "Bitrix24 можно подключать локальным входящим webhook для одного портала.",
    steps: [
      "В портале откройте Applications > Developer resources.",
      "Создайте Incoming webhook с CRM правами.",
      "Вставьте портал и webhook URL.",
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
        placeholder: "Если используете исходящие webhooks",
        kind: "password",
        wide: true,
      },
    ],
  },
  RETAILCRM: {
    summary:
      "RetailCRM использует API key и URL аккаунта. Для нескольких магазинов нужен site code.",
    steps: [
      "Создайте API key в RetailCRM.",
      "Разрешите нужные методы для лидов и заказов.",
      "Вставьте account URL, API key и site code при необходимости.",
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
        placeholder: "Ключ длиной от 32 символов",
        kind: "password",
      },
      { key: "siteCode", label: "Site code", placeholder: "main" },
    ],
  },
  TELEGRAM: {
    summary: "Вставьте токен бота. Всё остальное LeadVirt.ai настроит автоматически.",
    steps: ["Создайте bot через BotFather.", "Вставьте bot token и нажмите «Подключить»."],
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
    summary:
      "WhatsApp Cloud API требует Meta app, WABA, phone number ID, access token и webhook verify token.",
    steps: [
      "Подготовьте Meta app и WhatsApp Business Account.",
      "Добавьте или выберите From phone number.",
      "Передайте нам Phone number ID, WABA ID и webhook данные.",
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
    summary:
      "Instagram Messaging требует Meta app, Facebook Page и Professional Instagram account.",
    steps: [
      "Свяжите Facebook Page с Professional Instagram account.",
      "Настройте webhook fields для Instagram Messaging.",
      "Подготовьте Page token, Page ID и Instagram account ID.",
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
    summary:
      "VK подключается через Callback API сообщества, confirmation code, secret key и community token.",
    steps: [
      "Создайте token сообщества с правами сообщений.",
      "Укажите LeadVirt callback URL в настройках сообщества.",
      "Скопируйте confirmation code и secret key.",
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
    summary: "Email подключается через IMAP для входящих и SMTP для исходящих писем.",
    steps: [
      "Включите IMAP/SMTP у провайдера.",
      "Создайте app password или OAuth token.",
      "Вставьте адрес, серверы, порты и учетные данные.",
    ],
    docsUrl: "https://developers.google.com/workspace/gmail/imap/imap-smtp",
    fields: [
      { key: "emailAddress", label: "Email address", placeholder: "sales@example.com", wide: true },
      { key: "imapHost", label: "IMAP host", placeholder: "imap.gmail.com" },
      { key: "imapPort", label: "IMAP port", placeholder: "993", defaultValue: "993" },
      { key: "smtpHost", label: "SMTP host", placeholder: "smtp.gmail.com" },
      { key: "smtpPort", label: "SMTP port", placeholder: "465", defaultValue: "465" },
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
    summary: "Google Calendar подключается через OAuth client и calendar ID.",
    steps: [
      "Включите Google Calendar API в Google Cloud.",
      "Создайте OAuth client.",
      "Вставьте client credentials и calendar ID.",
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
    summary: "Shopify Admin API использует shop domain и Admin API access token с нужными scopes.",
    steps: [
      "Создайте custom app в Shopify admin.",
      "Выдайте scopes для заказов и клиентов.",
      "Установите app и скопируйте Admin API access token.",
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
    summary: "Shop-Script/Webasyst API работает через api.php и OAuth token установки.",
    steps: [
      "Откройте Webasyst installation URL.",
      "Получите API token через OAuth flow.",
      "Разрешите доступ к shop app API.",
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
    summary: "Webhook/API уже дает публичный endpoint для внешних форм и серверных интеграций.",
    steps: [
      "Скопируйте endpoint URL, public key и secret header.",
      "Отправляйте события POST-запросом на endpoint.",
      "Проверьте поток кнопкой тестового лида.",
    ],
    fields: [
      { key: "sourceName", label: "Source name", placeholder: "Landing page" },
      { key: "externalIdPrefix", label: "External ID prefix", placeholder: "landing" },
    ],
  },
};

function setupConfigForProvider(provider: IntegrationProvider) {
  return providerSetupConfigs[provider] ?? genericSetupConfig;
}

function setupFieldInputType(field: ProviderSetupField) {
  if (field.kind === "password") return "password";
  if (field.kind === "url") return "url";
  return "text";
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

function booleanSetting(settings: Record<string, unknown>, key: string, fallback: boolean) {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

function syncModeSetting(settings: Record<string, unknown>): SyncMode {
  const value = settings.syncMode;
  return value === "two-way" || value === "events-only" || value === "leads-to-service"
    ? value
    : "leads-to-service";
}

function formFromSettings(
  integration: Integration,
  account?: IntegrationAccount | null,
): IntegrationSettingsForm {
  const settings = asRecord(account?.settings);
  const setupConfig = setupConfigForProvider(integration.provider);
  const fields = Object.fromEntries(
    setupConfig.fields.map((field) => [
      field.key,
      stringSetting(settings, field.key, field.defaultValue ?? ""),
    ]),
  );

  return {
    displayName: stringSetting(settings, "displayName", integration.name),
    fields,
    syncMode: syncModeSetting(settings),
    syncEnabled: booleanSetting(settings, "syncEnabled", true),
    notes: stringSetting(settings, "notes"),
  };
}

function settingsFromForm(
  currentSettings: Record<string, unknown>,
  form: IntegrationSettingsForm,
  provider: IntegrationProvider,
) {
  const setupConfig = setupConfigForProvider(provider);
  const fieldKeys = new Set(setupConfig.fields.map((field) => field.key));
  const retainedSettings: Record<string, unknown> = { ...currentSettings };

  if (!fieldKeys.has("endpointUrl")) delete retainedSettings.endpointUrl;
  if (!fieldKeys.has("apiToken")) delete retainedSettings.apiToken;

  const fieldSettings = Object.fromEntries(
    setupConfig.fields.map((field) => [field.key, (form.fields[field.key] ?? "").trim()]),
  );

  const base = {
    ...retainedSettings,
    ...fieldSettings,
    displayName: form.displayName.trim(),
    syncMode: form.syncMode,
    syncEnabled: form.syncEnabled,
    notes: form.notes.trim(),
    ui: {
      ...asRecord(currentSettings.ui),
      configuredFrom: "integrations-page",
      configuredAt: new Date().toISOString(),
    },
  };

  if (provider === "WEBHOOK_API") {
    return {
      ...base,
      provider: "generic",
      webhook: {
        ...asRecord(currentSettings.webhook),
        provider: "generic",
      },
    };
  }

  return base;
}

function publicApiOrigin() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api")
    .replace(/\/api\/?$/, "")
    .replace(/\/$/, "");
}

function inboundEndpointUrl(endpointPath: string) {
  return `${publicApiOrigin()}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
}

function publicEndpointUrl(endpointPath: string) {
  return `${publicApiOrigin()}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "нет событий";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет событий";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function latestWebhookEvent(account?: IntegrationAccount | null) {
  return account?.recentWebhookEvents?.[0] ?? null;
}

function accountReadiness(account?: IntegrationAccount | null) {
  const endpoint = account?.inboundEndpoint ?? null;
  const latestEvent = latestWebhookEvent(account);
  const ready = account?.status === "CONNECTED" && Boolean(endpoint?.publicKey);

  return {
    ready,
    publicKey: endpoint?.publicKey ?? "нет публичного ключа",
    url: endpoint ? inboundEndpointUrl(endpoint.endpointPath) : "",
    signal: latestEvent
      ? `Последний входящий: ${formatDateTime(latestEvent.receivedAt)}`
      : account?.lastSyncAt
        ? `Последняя проверка: ${formatDateTime(account.lastSyncAt)}`
        : ready
          ? "Endpoint настроен"
          : "Нужен активный канал",
  };
}

function widgetReadiness(channel?: Channel | null) {
  const ready = channel?.status === "ACTIVE" && Boolean(channel.publicKey);
  const publicKey = channel?.publicKey ?? "нет публичного ключа";

  return {
    ready,
    publicKey,
    url: channel?.publicKey
      ? publicEndpointUrl(`/api/public/widget/${channel.publicKey}/config`)
      : "",
    signal: channel?.lastHealthAt
      ? `Последняя проверка: ${formatDateTime(channel.lastHealthAt)}`
      : ready
        ? "Widget config доступен"
        : channel
          ? "Канал не активен"
          : "Канал не найден",
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

function EndpointCopyButton({ value, label = "Копировать" }: { value: string; label?: string }) {
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
      {copied ? "Скопировано" : label}
    </button>
  );
}

function ReadinessTile({
  title,
  ready,
  signal,
  publicKey,
  url,
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
  publicKey: string;
  url: string;
  testId: string;
  actionLabel?: string;
  actionBusyLabel?: string;
  actionHref?: string;
  actionTestId?: string;
  actionDisabled?: boolean;
  actionBusy?: boolean;
  onAction?: () => void;
}) {
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
          {ready ? "Готов к пилоту" : "Нужна настройка"}
        </Pill>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/5 bg-zinc-950/45 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">{publicKey}</code>
        {url ? (
          <a
            aria-label={`${title} endpoint`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-emerald-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
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
  onSendSample,
}: {
  accounts: IntegrationAccount[];
  channels: Channel[] | null | undefined;
  pendingId: string | null;
  onSendSample: (integrationId: string) => void;
}) {
  const telegram = accountReadiness(accounts.find((account) => account.provider === "TELEGRAM"));
  const webhook = accountReadiness(accounts.find((account) => account.provider === "WEBHOOK_API"));
  const widget = widgetReadiness(channels?.find((channel) => channel.type === "WEBSITE"));
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
          <p className="text-sm font-semibold text-zinc-100">Готовность входящих каналов</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Проверьте public key, endpoint и последние события перед запуском первого тестового
            трафика.
          </p>
        </div>
        <Pill className="w-fit border border-sky-500/20 bg-sky-500/10 text-xs text-sky-300">
          {readyCount}/3 канала готовы
        </Pill>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ReadinessTile
          title="Telegram"
          ready={telegram.ready}
          signal={telegram.signal}
          publicKey={telegram.publicKey}
          url={telegram.url}
          testId="pilot-readiness-telegram"
          actionLabel="Тестовый лид"
          actionBusyLabel="Отправляем..."
          actionTestId="pilot-readiness-telegram-sample"
          actionBusy={pendingId === "telegram"}
          onAction={() => onSendSample("telegram")}
        />
        <ReadinessTile
          title="Webhook/API"
          ready={webhook.ready}
          signal={webhook.signal}
          publicKey={webhook.publicKey}
          url={webhook.url}
          testId="pilot-readiness-webhook"
          actionLabel="Тестовый лид"
          actionBusyLabel="Отправляем..."
          actionTestId="pilot-readiness-webhook-sample"
          actionBusy={pendingId === "webhook"}
          onAction={() => onSendSample("webhook")}
        />
        <ReadinessTile
          title="Website widget"
          ready={widget.ready}
          signal={widget.signal}
          publicKey={widget.publicKey}
          url={widget.url}
          testId="pilot-readiness-widget"
          actionLabel="Открыть виджет"
          actionHref="/widget/demo"
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

function DarkTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none",
        props.className,
      )}
    />
  );
}

function SettingsSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label="Синхронизация включена"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none",
        checked ? "bg-emerald-500" : "bg-white/10",
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
  onConnect: (botToken: string) => void;
}) {
  const [botToken, setBotToken] = useState("");
  const settings = asRecord(account?.settings);
  const botUsername = stringSetting(settings, "botUsername");
  const connected = account?.status === "CONNECTED";

  useEffect(() => {
    if (!open) setBotToken("");
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        connected
          ? botUsername
            ? `Telegram @${botUsername}`
            : "Telegram подключён"
          : "Подключить Telegram"
      }
      description="LeadVirt.ai сам настроит webhook, защиту и получение сообщений."
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button
            onClick={() => onConnect(botToken.trim())}
            disabled={saving || (!connected && !botToken.trim())}
            data-testid="telegram-connect-submit"
          >
            <Zap className="h-4 w-4" />
            {saving ? "Подключаем..." : connected ? "Проверить и подключить" : "Подключить бота"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-200">
              {connected ? "Бот подключён" : "Бот из BotFather"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {connected
                ? botUsername
                  ? `@${botUsername} управляется LeadVirt.ai`
                  : "Текущий бот управляется LeadVirt.ai"
                : "Создайте бота и вставьте полученный токен"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
              BotFather
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>

        <Field label={connected ? "Новый bot token (только для замены бота)" : "Bot token"}>
          <DarkInput
            type="password"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            placeholder={
              connected ? "Оставьте пустым, чтобы использовать текущего бота" : "123456789:AA..."
            }
            autoComplete="off"
            data-testid="telegram-bot-token"
          />
        </Field>

        <div className="space-y-3 border-t border-white/5 pt-4">
          {[
            "Webhook настраивается автоматически",
            "Секрет создаётся и хранится безопасно",
            "Входящие сообщения и ответы готовы сразу",
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
  onOpenChange,
  onSave,
  onSendSample,
  onConnectTelegram,
}: {
  integration: Integration | null;
  account?: IntegrationAccount | null;
  open: boolean;
  saving: boolean;
  sampleBusy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: IntegrationSettingsForm) => void;
  onSendSample: () => void;
  onConnectTelegram: (botToken: string) => void;
}) {
  const [form, setForm] = useState<IntegrationSettingsForm>(() =>
    integration ? formFromSettings(integration, account) : formFromSettings(INTEGRATIONS[0]),
  );
  const formSeedKeyRef = useRef("");

  useEffect(() => {
    if (!open || !integration) {
      formSeedKeyRef.current = "";
      return;
    }
    const formSeedKey = `${integration.id}:${account?.id ?? "new"}`;
    if (formSeedKeyRef.current === formSeedKey) return;
    formSeedKeyRef.current = formSeedKey;
    setForm(formFromSettings(integration, account));
  }, [account, integration, open]);

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
  const setupConfig = setupConfigForProvider(integration.provider);
  const canSaveSettings = isSelfServeIntegration(integration);
  const unavailableLabel = availabilityLabel(integration);
  const inboundEndpoint = account?.inboundEndpoint ?? null;
  const fullEndpointUrl = inboundEndpoint ? inboundEndpointUrl(inboundEndpoint.endpointPath) : "";
  const samplePayload = inboundEndpoint
    ? JSON.stringify(inboundEndpoint.samplePayload, null, 2)
    : "";
  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${integration.name}: настройки`}
      description={setupConfig.summary}
      className="max-w-2xl"
      footer={
        canSaveSettings ? (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={() => onSave(form)} disabled={saving}>
              {saving ? "Сохраняем..." : "Сохранить настройки"}
            </Button>
          </>
        ) : (
          <>
            {setupConfig.docsUrl && (
              <Button asChild variant="outline">
                <a href={setupConfig.docsUrl} target="_blank" rel="noreferrer">
                  Документация
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
          </>
        )
      }
    >
      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-zinc-200">Сценарий подключения</p>
          {unavailableLabel && (
            <Pill
              className={cn(
                "border text-xs",
                integration.availability === "soon"
                  ? "border-zinc-700 bg-white/[0.03] text-zinc-400"
                  : "border-amber-500/20 bg-amber-500/10 text-amber-300",
              )}
            >
              {unavailableLabel}
            </Pill>
          )}
        </div>
        <ol className="space-y-2">
          {setupConfig.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm text-zinc-400">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-zinc-300">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        {setupConfig.docsUrl && canSaveSettings && (
          <a
            href={setupConfig.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 transition-colors hover:text-emerald-200"
          >
            Открыть документацию
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {canSaveSettings ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Название подключения">
              <DarkInput
                aria-label="Название подключения"
                value={form.displayName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, displayName: event.target.value }))
                }
              />
            </Field>

            <Field label="Режим синхронизации">
              <BrandSelect
                ariaLabel="Режим синхронизации"
                value={form.syncMode}
                options={syncModeOptions}
                onValueChange={(syncMode) =>
                  setForm((prev) => ({ ...prev, syncMode: syncMode as SyncMode }))
                }
              />
            </Field>

            {setupConfig.fields.map((field) => (
              <div key={field.key} className={cn(field.wide && "md:col-span-2")}>
                <Field label={field.label} hint={field.hint}>
                  <DarkInput
                    aria-label={field.label}
                    type={setupFieldInputType(field)}
                    placeholder={field.placeholder}
                    value={form.fields[field.key] ?? ""}
                    onChange={(event) => updateField(field.key, event.target.value)}
                  />
                </Field>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Синхронизация включена</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Отключите, чтобы сохранить подключение без автоматического обмена данными.
              </p>
            </div>
            <SettingsSwitch
              checked={form.syncEnabled}
              onChange={(syncEnabled) => setForm((prev) => ({ ...prev, syncEnabled }))}
            />
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/5 bg-zinc-950/40 p-4">
          <p className="mb-3 text-sm font-semibold text-zinc-200">
            Что понадобится для подключения
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
                  <p className="mt-1 text-xs text-zinc-500">{field.hint ?? field.placeholder}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {canSaveSettings && (
        <div className="mt-4">
          <Field label="Заметки">
            <DarkTextarea
              aria-label="Заметки"
              rows={3}
              placeholder="Например: основной аккаунт продаж, sandbox или продакшен."
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </Field>
        </div>
      )}

      {!canSaveSettings && (
        <div className="mt-4 rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] p-4 text-sm text-amber-100/90">
          Эта интеграция не входит в самостоятельное подключение пилота. Окно показывает реальные
          требования, но не сохраняет настройки.
        </div>
      )}

      {inboundEndpoint && (
        <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-300">Публичный входящий endpoint</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Используйте эти данные для первого пилота или внешней формы.
              </p>
            </div>
            <Pill className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
              {inboundEndpoint.channelType}
            </Pill>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">Endpoint URL</span>
                <EndpointCopyButton value={fullEndpointUrl} />
              </div>
              <div className="break-all rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">
                {fullEndpointUrl}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">Public key</span>
                  <EndpointCopyButton value={inboundEndpoint.publicKey} label="Ключ" />
                </div>
                <div className="break-all rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">
                  {inboundEndpoint.publicKey}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">Secret header</span>
                  <EndpointCopyButton value={inboundEndpoint.secretHeader} label="Header" />
                </div>
                <div className="break-all rounded-xl border border-white/5 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">
                  {inboundEndpoint.secretHeader}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-400">Sample payload</span>
                <EndpointCopyButton value={samplePayload} label="Payload" />
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
                {sampleBusy ? "Отправляем..." : "Отправить тестовый лид"}
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
  connected,
  pending,
  onToggle,
  onDisconnect,
  onConfigure,
  onTest,
  onSample,
  index,
}: {
  integration: Integration;
  connected: boolean;
  pending: boolean;
  onToggle: () => void;
  onDisconnect: () => void;
  onConfigure: () => void;
  onTest: () => void;
  onSample: () => void;
  index: number;
}) {
  const Icon = integration.icon;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const availability = availabilityLabel(integration);
  const canSelfServe = isSelfServeIntegration(integration);
  const connectedVisible = canSelfServe && connected;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
        whileHover={{ y: -4 }}
        className="group"
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
              {integration.category}
            </Pill>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 flex-1 relative">
            <span className="text-sm font-bold text-zinc-100 tracking-tight">
              {integration.name}
            </span>
            <span className="text-xs text-zinc-500 leading-relaxed">{integration.description}</span>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 relative">
            {!canSelfServe ? (
              <div className="flex w-full flex-col gap-2">
                <span
                  className={cn(
                    "w-fit rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    integration.availability === "soon"
                      ? "border-zinc-700 bg-white/[0.03] text-zinc-400"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-300",
                  )}
                >
                  {availability}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-8 w-full whitespace-normal rounded-full px-3 py-2 text-xs"
                  onClick={onConfigure}
                >
                  {availability}
                </Button>
              </div>
            ) : connectedVisible ? (
              <>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {pending ? "Синхронизация..." : "Подключено"}
                </span>
                <Dropdown
                  trigger={
                    <Button variant="outline" size="sm" className="h-8 px-3 text-xs rounded-full">
                      Настроить
                    </Button>
                  }
                >
                  <DropdownItem icon={Settings} onClick={onConfigure}>
                    Настроить
                  </DropdownItem>
                  <DropdownItem icon={RefreshCw} onClick={onTest}>
                    Проверить связь
                  </DropdownItem>
                  {canSendSample(integration.provider) && (
                    <DropdownItem icon={Send} onClick={onSample}>
                      Тестовый входящий
                    </DropdownItem>
                  )}
                  <DropdownSeparator />
                  <DropdownItem icon={LogOut} onClick={() => setConfirmOpen(true)} danger>
                    Отключить
                  </DropdownItem>
                </Dropdown>
              </>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="h-8 px-4 text-xs rounded-full w-full"
                onClick={onToggle}
                disabled={pending}
              >
                <Zap className="w-3 h-3 mr-1.5" />
                {pending ? "Подключаем..." : "Подключить"}
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Отключить интеграцию?"
        description={`${integration.name} будет отключён. Вы сможете подключить его снова в любое время.`}
        danger
        confirmLabel="Отключить"
        onConfirm={() => {
          onDisconnect();
        }}
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
  onSendSample,
}: {
  accounts: IntegrationAccount[];
  pendingId: string | null;
  onSendSample: (integrationId: string) => void;
}) {
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
      empty: "Подключите Webhook / API, чтобы получить URL",
    },
    {
      id: "publicKey",
      label: "Публичный ключ",
      value: endpoint?.publicKey ?? "",
      empty: "Публичный ключ пока недоступен",
    },
    {
      id: "secretHeader",
      label: "Secret header",
      value: endpoint?.secretHeader ?? "",
      empty: "Header появится после подключения",
    },
    {
      id: "payload",
      label: "Sample payload",
      value: samplePayload,
      empty: "Sample payload появится после подключения",
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
                    aria-label={`Скопировать ${row.label}`}
                    disabled={!row.value}
                    onClick={() => handleCopy(row.id, row.value)}
                    className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Скопировать"
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
                {endpoint ? "Webhook/API готов" : "Нужна настройка"}
              </Pill>
            </div>
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
              {pendingId === "webhook" ? "Отправляем..." : "Тестовый лид"}
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/app/settings?tab=api">
                <ExternalLink className="w-4 h-4" />
                Открыть API ключи
              </Link>
            </Button>
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
  const [activeCategory, setActiveCategory] = useState<"Все" | Category>("Все");
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [channels, setChannels] = useState<Channel[] | null | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>(initialConnectedMap);
  const [settingsIntegrationId, setSettingsIntegrationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void listIntegrations()
      .then((items) => {
        if (cancelled) return;
        setAccounts(items);
        setConnectedMap(mergeAccountsIntoConnectedMap(items));
      })
      .catch(() => {
        if (cancelled) return;
        setAccounts([]);
        setConnectedMap(initialConnectedMap());
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void listChannels()
      .then((items) => {
        if (!cancelled) setChannels(items);
      })
      .catch(() => {
        if (!cancelled) setChannels(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    setPendingId("telegram");
    try {
      const account = await connectIntegration("TELEGRAM", botToken ? { botToken } : {});
      updateFromAccount(account);
      setChannels(await listChannels());
      setSettingsIntegrationId(null);
      const settings = asRecord(account.settings);
      const username = stringSetting(settings, "botUsername");
      toast.success(username ? `Telegram @${username} подключён` : "Telegram подключён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось подключить Telegram");
    } finally {
      setPendingId(null);
    }
  }

  async function disconnect(id: string) {
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;
    const previous = connectedMap[id];
    setPendingId(id);
    setConnectedMap((prev) => ({ ...prev, [id]: false }));

    try {
      const account = await disconnectIntegration(integration.provider);
      updateFromAccount(account);
      toast.success(`${integration.name} отключён`);
    } catch (error) {
      setConnectedMap((prev) => ({ ...prev, [id]: previous }));
      toast.error(error instanceof Error ? error.message : "Не удалось отключить интеграцию");
    } finally {
      setPendingId(null);
    }
  }

  function configure(id: string) {
    setSettingsIntegrationId(id);
  }

  async function saveSettings(form: IntegrationSettingsForm) {
    const id = settingsIntegrationId;
    if (!id) return;
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;

    const account = accounts.find((item) => item.provider === integration.provider);
    const currentSettings = asRecord(account?.settings);
    const nextSettings = settingsFromForm(currentSettings, form, integration.provider);

    setPendingId(id);

    try {
      const updated = await updateIntegrationSettings(integration.provider, nextSettings);
      updateFromAccount(updated);
      setSettingsIntegrationId(null);
      toast.success(`${integration.name} настройки сохранены`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось сохранить настройки интеграции",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function testConnection(id: string) {
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;
    setPendingId(id);

    try {
      const result = await testIntegrationConnection(integration.provider);
      updateFromAccount(result.integration);
      const notify = result.ok ? toast.success : toast.error;
      notify(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось проверить интеграцию");
    } finally {
      setPendingId(null);
    }
  }

  async function sendSample(id: string) {
    const integration = INTEGRATIONS.find((item) => item.id === id);
    if (!integration) return;
    setPendingId(id);

    try {
      const result = await sendSampleInbound(integration.provider);
      updateFromAccount(result.integration);
      toast.success("Тестовый входящий обработан", {
        description: result.conversationId,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось отправить тестовый входящий",
      );
    } finally {
      setPendingId(null);
    }
  }

  const totalConnected = INTEGRATIONS.filter(
    (integration) => isSelfServeIntegration(integration) && connectedMap[integration.id],
  ).length;
  const totalAvailable = INTEGRATIONS.length;
  const channelsActive = INTEGRATIONS.filter(
    (i) => i.category === "Каналы" && isSelfServeIntegration(i) && connectedMap[i.id],
  ).length;

  const filtered =
    activeCategory === "Все"
      ? INTEGRATIONS
      : INTEGRATIONS.filter((i) => i.category === activeCategory);
  const settingsIntegration =
    INTEGRATIONS.find((item) => item.id === settingsIntegrationId) ?? null;
  const settingsAccount = settingsIntegration
    ? (accounts.find((item) => item.provider === settingsIntegration.provider) ?? null)
    : null;

  return (
    <ProductLayout title="Интеграции">
      <div className="flex flex-col gap-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50 mb-1">Интеграции</h1>
          <p className="text-sm text-zinc-400 max-w-xl">
            Подключите каналы и сервисы — AI Администратор будет работать со всеми вашими
            источниками заявок.
          </p>
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
              label: "Подключено",
              value: totalConnected,
              color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
              testId: "integrations-stat-connected",
            },
            {
              label: "Доступно",
              value: totalAvailable,
              color: "text-zinc-300 bg-white/5 border-white/5",
              testId: "integrations-stat-available",
            },
            {
              label: "Каналов активно",
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
              <span className="text-base font-bold">{value}</span>
              <span className="text-xs opacity-80">{label}</span>
            </div>
          ))}
        </motion.div>

        <PilotReadinessPanel
          accounts={accounts}
          channels={channels}
          pendingId={pendingId}
          onSendSample={(id) => void sendSample(id)}
        />

        {/* Category filter */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="flex flex-wrap gap-2"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-xs font-medium transition-all duration-200",
                activeCategory === cat
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-white/[0.03] border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]",
              )}
            >
              {cat}
            </button>
          ))}
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((integration, i) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              connected={connectedMap[integration.id]}
              pending={pendingId === integration.id}
              onToggle={() => configure(integration.id)}
              onDisconnect={() => void disconnect(integration.id)}
              onConfigure={() => void configure(integration.id)}
              onTest={() => void testConnection(integration.id)}
              onSample={() => void sendSample(integration.id)}
              index={i}
            />
          ))}
        </div>

        {/* API / Webhook section */}
        <div>
          <SectionTitle
            title="API ключи / Webhook"
            sub="Используйте для прямой интеграции с вашими сервисами"
          />
          <ApiCard
            accounts={accounts}
            pendingId={pendingId}
            onSendSample={(id) => void sendSample(id)}
          />
        </div>

        <IntegrationSettingsModal
          integration={settingsIntegration}
          account={settingsAccount}
          open={settingsIntegrationId !== null}
          saving={pendingId === settingsIntegrationId}
          sampleBusy={pendingId === "webhook"}
          onOpenChange={(open) => {
            if (!open) setSettingsIntegrationId(null);
          }}
          onSave={(form) => void saveSettings(form)}
          onSendSample={() => void sendSample("webhook")}
          onConnectTelegram={(botToken) => void connectTelegramBot(botToken)}
        />
      </div>
    </ProductLayout>
  );
}
