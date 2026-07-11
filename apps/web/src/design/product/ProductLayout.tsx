import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  LayoutDashboard,
  Inbox,
  KanbanSquare,
  Workflow,
  BarChart3,
  ShieldCheck,
  Plug,
  Settings,
  Search,
  Bell,
  Plus,
  ChevronLeft,
  Menu,
  X,
  Sun,
  Moon,
  Database,
  CalendarCheck,
  Sparkles,
  UserCircle,
  CreditCard,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { getAuthMe, logout } from "@/lib/api/auth";
import { getCurrentSubscription } from "@/lib/api/billing";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { getCurrentTenant } from "@/lib/api/tenants";
import type { DashboardSummary, Subscription } from "@leadvirt/types";
import { cn } from "../lib/utils";
import { localizeSeedText, relativeTimeLabel } from "./apiAdapters";
import { hrefForRoute, useNav, type Route } from "./nav";
import { useTheme } from "./theme";
import { Avatar } from "./shared";
import { BrandMark } from "../components/BrandMark";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { BrandWordmark } from "../components/BrandWordmark";
import { Button } from "../components/ui/Button";
import { TooltipProvider, Tip, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "./ui";
import { useProductMode, type ProductMode } from "./ProductMode";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/config";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";

type NotificationItem = { id: string; icon: LucideIcon; color: string; text: string; time: string; unread: boolean };
type Translate = (key: TranslationKey, values?: TranslationValues) => string;

const navItems: { id: Route; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { id: "dashboard", labelKey: "product.nav.dashboard", icon: LayoutDashboard },
  { id: "inbox", labelKey: "product.nav.inbox", icon: Inbox },
  { id: "pipeline", labelKey: "product.nav.pipeline", icon: KanbanSquare },
  { id: "automation", labelKey: "product.nav.automation", icon: Workflow },
  { id: "analytics", labelKey: "product.nav.analytics", icon: BarChart3 },
  { id: "audit", labelKey: "product.nav.audit", icon: ShieldCheck },
  { id: "integrations", labelKey: "product.nav.integrations", icon: Plug },
  { id: "settings", labelKey: "product.nav.settings", icon: Settings },
];

const mobileNav: { id: Route; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { id: "dashboard", labelKey: "product.nav.dashboard", icon: LayoutDashboard },
  { id: "inbox", labelKey: "product.mobile.chats", icon: Inbox },
  { id: "pipeline", labelKey: "product.mobile.pipeline", icon: KanbanSquare },
  { id: "analytics", labelKey: "product.nav.analytics", icon: BarChart3 },
  { id: "settings", labelKey: "product.mobile.more", icon: Settings },
];

const productTitleKeys: Record<string, TranslationKey> = {
  "Обзор": "product.nav.dashboard",
  "Входящие": "product.nav.inbox",
  "Воронка / CRM": "product.nav.pipeline",
  "Автоматизация": "product.nav.automation",
  "Аналитика": "product.nav.analytics",
  "AI audit": "product.nav.audit",
  "Интеграции": "product.nav.integrations",
  "Настройки": "product.nav.settings",
  "Биллинг": "product.title.billing",
  "Диалог": "product.title.conversation",
  "Онбординг": "product.title.onboarding",
};

interface ProductIdentity {
  tenantName: string;
  userEmail: string;
  passwordChangeRequired: boolean;
}

const fallbackProductIdentity: ProductIdentity = {
  tenantName: "LeadVirt.ai",
  userEmail: "",
  passwordChangeRequired: false,
};

const demoProductIdentity: ProductIdentity = {
  tenantName: "LeadVirt demo",
  userEmail: "read-only preview",
  passwordChangeRequired: false,
};

function notificationMetaFromAction(action: string): Pick<NotificationItem, "icon" | "color"> {
  if (action.includes("booking") || action.includes("order")) {
    return { icon: CalendarCheck, color: "text-sky-400" };
  }
  if (action.includes("crm")) {
    return { icon: Database, color: "text-teal-400" };
  }
  if (action.includes("lead")) {
    return { icon: Sparkles, color: "text-emerald-400" };
  }
  return { icon: Bot, color: "text-violet-400" };
}

function notificationTimeLabel(createdAt: string, locale: Locale, t: Translate) {
  const label = relativeTimeLabel(createdAt, locale);
  if (label === t("common.now") || label === "—") return label;
  return `${label} ${t("common.ago")}`;
}

function notificationBadgeLabel(count: number, t: Translate) {
  if (count <= 0) return t("product.notifications.noNew");
  if (count === 1) return t("product.notifications.oneNew");
  return t("product.notifications.manyNew", { count });
}

function notificationsFromActivity(activity: DashboardSummary["recentActivity"], locale: Locale, t: Translate): NotificationItem[] {
  return activity.slice(0, 5).map((item, index) => ({
    id: item.id,
    ...notificationMetaFromAction(item.action),
    text: localizeSeedText(item.title, locale),
    time: notificationTimeLabel(item.createdAt, locale, t),
    unread: index < 2,
  }));
}

function daysUntil(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 86400000));
}

function subscriptionStatusLabel(status: string, t: Translate) {
  if (status === "ACTIVE") return t("product.billing.active");
  if (status === "TRIALING") return t("product.billing.trial");
  if (status === "CANCELLED" || status === "CANCELED") return t("product.billing.cancelled");
  if (status === "PAST_DUE") return t("product.billing.pastDue");
  return status.toLowerCase();
}

function billingSummary(subscription: Subscription | null, t: Translate) {
  if (!subscription) {
    return {
      active: false,
      title: t("product.billing.noneTitle"),
      detail: t("product.billing.noneDetail"),
      action: t("product.billing.choose"),
    };
  }

  const daysLeft = daysUntil(subscription.periodEnd);
  return {
    active: subscription.status !== "CANCELLED" && subscription.status !== "CANCELED",
    title: t("product.billing.plan", { name: subscription.plan.name }),
    detail: `${subscriptionStatusLabel(subscription.status, t)}${daysLeft === null ? "" : ` · ${t("product.billing.daysLeft", { count: daysLeft })}`}`,
    action: t("product.billing.manage"),
  };
}

function useProductIdentity(mode: ProductMode) {
  const [identity, setIdentity] = React.useState<ProductIdentity>(
    mode === "demo" ? demoProductIdentity : fallbackProductIdentity
  );

  React.useEffect(() => {
    if (mode === "demo") {
      setIdentity(demoProductIdentity);
      return;
    }

    let active = true;

    void Promise.allSettled([getAuthMe(), getCurrentTenant()]).then(([authResult, tenantResult]) => {
      if (!active) return;

      const nextIdentity: ProductIdentity = {
        tenantName: fallbackProductIdentity.tenantName,
        userEmail: fallbackProductIdentity.userEmail,
        passwordChangeRequired: fallbackProductIdentity.passwordChangeRequired,
      };

      if (tenantResult.status === "fulfilled" && tenantResult.value.name) {
        nextIdentity.tenantName = tenantResult.value.name;
      }

      if (authResult.status === "fulfilled") {
        nextIdentity.userEmail = authResult.value.phone || authResult.value.email;
        nextIdentity.passwordChangeRequired = Boolean(authResult.value.passwordChangeRequired);
      }

      setIdentity(nextIdentity);
    });

    return () => {
      active = false;
    };
  }, [mode]);

  return identity;
}

function useProductBilling(disabled: boolean, mode: ProductMode, t: Translate) {
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [resolved, setResolved] = React.useState(false);

  React.useEffect(() => {
    if (mode === "demo") {
      setSubscription(null);
      setResolved(true);
      return;
    }

    if (disabled) {
      setSubscription(null);
      setResolved(true);
      return;
    }

    let active = true;
    setResolved(false);

    void getCurrentSubscription()
      .then((nextSubscription) => {
        if (active) {
          setSubscription(nextSubscription);
          setResolved(true);
        }
      })
      .catch(() => {
        if (active) {
          setSubscription(null);
          setResolved(true);
        }
      });

    return () => {
      active = false;
    };
  }, [disabled, mode]);

  if (mode === "demo") {
    return {
      active: true,
      title: t("product.billing.demoTitle"),
      detail: t("product.billing.demoDetail"),
      action: t("product.billing.createAccount"),
    };
  }

  return resolved ? billingSummary(subscription, t) : {
    active: false,
    title: t("product.billing.loadingTitle"),
    detail: t("product.billing.loadingDetail"),
    action: t("product.billing.shortAction"),
  };
}

function useProductNotifications(disabled: boolean, locale: Locale, t: Translate) {
  const [apiNotifications, setApiNotifications] = React.useState<NotificationItem[] | null>(null);
  const [apiResolved, setApiResolved] = React.useState(false);

  React.useEffect(() => {
    if (disabled) {
      setApiNotifications([]);
      setApiResolved(true);
      return;
    }

    let active = true;
    setApiResolved(false);

    void getDashboardSummary()
      .then((summary) => {
        if (active) {
          setApiNotifications(notificationsFromActivity(summary.recentActivity, locale, t));
          setApiResolved(true);
        }
      })
      .catch(() => {
        if (active) {
          setApiNotifications([]);
          setApiResolved(true);
        }
      });

    return () => {
      active = false;
    };
  }, [disabled, locale, t]);

  if (apiResolved) {
    return { notifications: apiNotifications ?? [], apiBacked: true };
  }

  return { notifications: [], apiBacked: false };
}

function NavLink({
  item,
  active,
  mode,
  onClick,
}: {
  item: typeof navItems[number];
  active: boolean;
  mode: ProductMode;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <Link
      href={hrefForRoute(item.id, {}, mode)}
      onClick={() => {
        onClick?.();
      }}
      className={cn(
        "group relative flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
      )}
    >
      {active && (
        <motion.div
          layoutId="nav-active"
          className="pointer-events-none absolute inset-0 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.12)]"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <Icon className={cn("w-5 h-5 relative z-10", active && "text-emerald-400")} />
      <span className="relative z-10 truncate">{t(item.labelKey)}</span>
    </Link>
  );
}

export function ProductLayout({
  title,
  children,
  contentClassName,
}: {
  title: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const { mode, demo } = useProductMode();
  const { route, go } = useNav();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { locale, t } = useI18n();
  const localizedTitle = productTitleKeys[title] ? t(productTitleKeys[title]) : title;
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [globalSearch, setGlobalSearch] = React.useState("");
  const identity = useProductIdentity(mode);
  const billing = useProductBilling(identity.passwordChangeRequired, mode, t);
  const productNotifications = useProductNotifications(identity.passwordChangeRequired, locale, t);
  const unreadNotificationCount = productNotifications.apiBacked
    ? productNotifications.notifications.length
    : productNotifications.notifications.filter((item) => item.unread).length;

  React.useEffect(() => {
    if (demo || !identity.passwordChangeRequired || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.pathname === "/app/settings" && url.searchParams.get("tab") === "security") return;
    router.replace("/app/settings?tab=security");
  }, [demo, identity.passwordChangeRequired, router]);

  const handleLogout = React.useCallback(async () => {
    if (demo) {
      router.push("/signup");
      return;
    }
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("leadvirt.auth.session");
        window.localStorage.removeItem("leadvirt.demo.session");
      }
      router.replace("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("product.account.logoutError"));
    } finally {
      setLoggingOut(false);
    }
  }, [demo, loggingOut, router, t]);

  const handleGlobalSearch = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = globalSearch.trim();
    const inboxPath = hrefForRoute("inbox", {}, mode);
    router.push(query ? `${inboxPath}?q=${encodeURIComponent(query)}` : inboxPath);
  }, [globalSearch, mode, router]);

  const sidebar = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <Link
        href="/"
        data-testid="product-logo-link"
        className="flex h-20 w-full min-w-0 shrink-0 items-center gap-2 px-3"
      >
        <BrandMark className="h-8 w-8 rounded-lg" />
        <BrandWordmark className="truncate text-lg" />
      </Link>

      <nav className="min-w-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            active={route === item.id || (route === "billing" && item.id === "settings")}
            mode={mode}
            onClick={() => {
              setMobileOpen(false);
            }}
          />
        ))}
      </nav>

      <div className="min-w-0 p-3">
        <div className="w-full min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/5 border border-emerald-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className={cn("relative inline-flex rounded-full h-2 w-2", billing.active ? "bg-emerald-500" : "bg-zinc-500")} />
            </span>
            <span className={cn("truncate text-xs font-semibold", billing.active ? "text-emerald-300" : "text-zinc-400")}>{billing.title}</span>
          </div>
          <p className="mb-3 truncate text-xs text-zinc-400">{billing.detail}</p>
          <Button size="sm" className="w-full" asChild>
            <Link
              href={demo ? "/signup" : hrefForRoute("billing", {}, mode)}
              data-testid="product-billing-link"
            >
              {billing.action}
            </Link>
          </Button>
        </div>

          <LanguageSwitcher className="mt-3 w-full justify-center" />

          <Dropdown
          align="start"
          trigger={
            <button className="mt-3 flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 transition-colors">
              <Avatar name={identity.tenantName} size={36} />
              <div className="text-left min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-100 truncate">{identity.tenantName}</div>
                <div className="text-xs text-zinc-500 truncate">{identity.userEmail}</div>
              </div>
              <ChevronDown className="w-4 h-4 text-zinc-500" />
            </button>
          }
        >
          <DropdownLabel>{t("product.account.label")}</DropdownLabel>
          <DropdownItem icon={UserCircle} onClick={() => go("settings")}>{t("product.account.profile")}</DropdownItem>
          <DropdownItem icon={CreditCard} onClick={() => go("billing")}>{t("product.account.billing")}</DropdownItem>
          <DropdownItem icon={Settings} onClick={() => go("settings")}>{t("product.account.settings")}</DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={LogOut} danger={!demo} onClick={() => void handleLogout()}>{demo ? t("product.account.create") : loggingOut ? t("product.account.loggingOut") : t("product.account.logout")}</DropdownItem>
        </Dropdown>
      </div>
    </div>
  );

  return (
    <TooltipProvider>
    <div className={cn("min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30 selection:text-emerald-200", theme === "light" && "theme-light")} data-testid="product-shell">
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!rounded-2xl !border !border-white/10 !bg-zinc-900 !text-zinc-100 !shadow-2xl",
            description: "!text-zinc-400",
            actionButton: "!bg-emerald-400 !text-zinc-950",
            cancelButton: "!bg-white/10 !text-zinc-300",
          },
        }}
      />
      {/* ambient bg */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 overflow-hidden border-r border-white/5 bg-zinc-950 z-40">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/70 z-50"
            />
            <motion.aside
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 400, damping: 38 }}
              className="lg:hidden fixed inset-y-0 left-0 w-72 overflow-hidden border-r border-white/5 bg-zinc-950 z-50"
            >
              <button onClick={() => setMobileOpen(false)} className="absolute top-6 right-4 text-zinc-400 z-10">
                <X className="w-5 h-5" />
              </button>
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="lg:pl-64 relative z-10">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-16 lg:h-20 border-b border-white/5 bg-zinc-950/95">
          <div className="h-full px-4 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button aria-label={t("product.menu.open")} className="lg:hidden text-zinc-400" onClick={() => setMobileOpen(true)}>
                <Menu className="w-6 h-6" />
              </button>
              <h1 className="text-lg lg:text-2xl font-bold tracking-tight truncate">{localizedTitle}</h1>
              {demo && (
                <span className="hidden sm:inline-flex shrink-0 items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  {t("product.demo.readOnly")}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 lg:gap-3">
              <form
                role="search"
                aria-label={t("product.search.form")}
                action={hrefForRoute("inbox", {}, mode)}
                onSubmit={handleGlobalSearch}
                className="hidden md:flex items-center gap-2 rounded-full bg-white/5 border border-white/5 px-3 h-10 w-64"
              >
                <Search className="w-4 h-4 text-zinc-500" />
                <input
                  aria-label={t("product.search.input")}
                  name="q"
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder={t("product.search.placeholder")}
                  className="bg-transparent text-sm outline-none placeholder:text-zinc-600 w-full"
                />
              </form>
              <LanguageSwitcher compact className="hidden sm:inline-flex" />
              <Tip content={theme === "dark" ? t("product.theme.light") : t("product.theme.dark")}>
                <button
                  onClick={toggle}
                  aria-label={t("product.theme.toggle")}
                  className="w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-emerald-400 transition-colors"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {theme === "dark" ? (
                      <motion.span key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                        <Sun className="w-5 h-5" />
                      </motion.span>
                    ) : (
                      <motion.span key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                        <Moon className="w-5 h-5" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </Tip>

              <Dropdown
                className="w-[340px] p-0 overflow-hidden"
                trigger={
                  <button aria-label={t("product.notifications.label")} className="relative w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors">
                    <Bell className="w-5 h-5" />
                    {unreadNotificationCount > 0 && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    )}
                  </button>
                }
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
                  <span className="text-sm font-semibold text-zinc-100">{t("product.notifications.label")}</span>
                  <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">
                    {notificationBadgeLabel(unreadNotificationCount, t)}
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto p-1.5">
                  {productNotifications.notifications.length === 0 && (
                    <div className="rounded-xl px-3 py-4 text-sm text-zinc-400">
                      <p className="font-medium text-zinc-300">{t("product.notifications.none")}</p>
                      <p className="mt-1 text-xs text-zinc-500">{t("product.notifications.noneDetail")}</p>
                    </div>
                  )}
                  {productNotifications.notifications.map((n) => {
                    const NIcon = n.icon;
                    return (
                      <Link
                        key={n.id}
                        href={hrefForRoute("inbox", {}, mode)}
                        className="flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                      >
                        <div className={cn("w-8 h-8 shrink-0 rounded-lg bg-white/5 flex items-center justify-center", n.color)}>
                          <NIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-200 leading-snug">{n.text}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">{n.time}</p>
                        </div>
                        {n.unread && <span className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-emerald-400" />}
                      </Link>
                    );
                  })}
                </div>
                <Link href={hrefForRoute("inbox", {}, mode)} className="block w-full text-center text-sm font-medium text-emerald-400 hover:bg-white/5 py-3 border-t border-white/8 transition-colors">
                  {t("product.notifications.openAll")}
                </Link>
              </Dropdown>
              <Button size="sm" className="hidden sm:inline-flex" asChild>
                <Link href={hrefForRoute("inbox", {}, mode)} data-testid="product-topbar-new-lead">
                  <Plus className="w-4 h-4 mr-1.5" /> {t("product.newLead")}
                </Link>
              </Button>
            </div>
          </div>
        </header>

        <main className={cn("px-4 lg:px-8 py-6 pb-28 lg:pb-10 max-w-[1500px] mx-auto", contentClassName)}>
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/5 bg-zinc-950">
        <div className="grid grid-cols-5 h-16">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = route === item.id || (route === "billing" && item.id === "settings");
            return (
              <Link
                key={item.id}
                href={hrefForRoute(item.id, {}, mode)}
                className={cn("flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors", active ? "text-emerald-400" : "text-zinc-500")}
              >
                <Icon className="w-5 h-5" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
    </TooltipProvider>
  );
}

/* Back button for sub-pages */
export function BackButton({ to, label }: { to: Route; label: string }) {
  const { mode } = useNav();
  return (
    <Link href={hrefForRoute(to, {}, mode)} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-4">
      <ChevronLeft className="w-4 h-4" /> {label}
    </Link>
  );
}
