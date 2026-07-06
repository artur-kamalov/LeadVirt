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
import { Button } from "../components/ui/Button";
import { TooltipProvider, Tip, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "./ui";
import { useProductMode, type ProductMode } from "./ProductMode";

type NotificationItem = { id: string; icon: LucideIcon; color: string; text: string; time: string; unread: boolean };

const navItems: { id: Route; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "pipeline", label: "Воронка / CRM", icon: KanbanSquare },
  { id: "automation", label: "Автоматизация", icon: Workflow },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "audit", label: "AI audit", icon: ShieldCheck },
  { id: "integrations", label: "Интеграции", icon: Plug },
  { id: "settings", label: "Настройки", icon: Settings },
];

const mobileNav: { id: Route; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "inbox", label: "Чаты", icon: Inbox },
  { id: "pipeline", label: "Воронка", icon: KanbanSquare },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
  { id: "settings", label: "Ещё", icon: Settings },
];

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

function notificationTimeLabel(createdAt: string) {
  const label = relativeTimeLabel(createdAt);
  if (label === "сейчас" || label === "—") return label;
  return `${label} назад`;
}

function notificationBadgeLabel(count: number) {
  if (count <= 0) return "нет новых";
  if (count === 1) return "1 новое";
  return `${count} новых`;
}

function notificationsFromActivity(activity: DashboardSummary["recentActivity"]): NotificationItem[] {
  return activity.slice(0, 5).map((item, index) => ({
    id: item.id,
    ...notificationMetaFromAction(item.action),
    text: localizeSeedText(item.title),
    time: notificationTimeLabel(item.createdAt),
    unread: index < 2,
  }));
}

function daysUntil(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 86400000));
}

function subscriptionStatusLabel(status: string) {
  if (status === "ACTIVE") return "активен";
  if (status === "TRIALING") return "пробный";
  if (status === "CANCELLED" || status === "CANCELED") return "отменён";
  if (status === "PAST_DUE") return "требует оплаты";
  return status.toLowerCase();
}

function billingSummary(subscription: Subscription | null) {
  if (!subscription) {
    return {
      active: false,
      title: "Тариф не выбран",
      detail: "Подключите план в биллинге",
      action: "Выбрать тариф",
    };
  }

  const daysLeft = daysUntil(subscription.periodEnd);
  return {
    active: subscription.status !== "CANCELLED" && subscription.status !== "CANCELED",
    title: `Тариф «${subscription.plan.name}»`,
    detail: `${subscriptionStatusLabel(subscription.status)}${daysLeft === null ? "" : ` · ${daysLeft} дн. до конца периода`}`,
    action: "Управлять тарифом",
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

function useProductBilling(disabled: boolean, mode: ProductMode) {
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
      title: "Demo preview",
      detail: "Read-only пример данных",
      action: "Создать аккаунт",
    };
  }

  return resolved ? billingSummary(subscription) : {
    active: false,
    title: "Загрузка тарифа",
    detail: "Проверяем биллинг",
    action: "Биллинг",
  };
}

function useProductNotifications(disabled: boolean) {
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
          setApiNotifications(notificationsFromActivity(summary.recentActivity));
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
  }, [disabled]);

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
      <span className="relative z-10 truncate">{item.label}</span>
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
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [globalSearch, setGlobalSearch] = React.useState("");
  const identity = useProductIdentity(mode);
  const billing = useProductBilling(identity.passwordChangeRequired, mode);
  const productNotifications = useProductNotifications(identity.passwordChangeRequired);
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
      toast.error(error instanceof Error ? error.message : "Не удалось выйти из аккаунта");
    } finally {
      setLoggingOut(false);
    }
  }, [demo, loggingOut, router]);

  const handleGlobalSearch = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = globalSearch.trim();
    const inboxPath = hrefForRoute("inbox", {}, mode);
    router.push(query ? `${inboxPath}?q=${encodeURIComponent(query)}` : inboxPath);
  }, [globalSearch, mode, router]);

  const sidebar = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <button onClick={() => go("landing")} className="flex h-20 w-full min-w-0 shrink-0 items-center gap-2 px-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex shrink-0 items-center justify-center">
          <Bot className="w-5 h-5 text-zinc-950" />
        </div>
        <span className="truncate text-lg font-bold tracking-tight">AI Администратор</span>
      </button>

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
          <Button size="sm" className="w-full" onClick={() => (demo ? router.push("/signup") : go("billing"))}>{billing.action}</Button>
        </div>

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
          <DropdownLabel>Аккаунт</DropdownLabel>
          <DropdownItem icon={UserCircle} onClick={() => go("settings")}>Профиль компании</DropdownItem>
          <DropdownItem icon={CreditCard} onClick={() => go("billing")}>Биллинг и тариф</DropdownItem>
          <DropdownItem icon={Settings} onClick={() => go("settings")}>Настройки</DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={LogOut} danger={!demo} onClick={() => void handleLogout()}>{demo ? "Создать workspace" : loggingOut ? "Выходим..." : "Выйти"}</DropdownItem>
        </Dropdown>
      </div>
    </div>
  );

  return (
    <TooltipProvider>
    <div className={cn("min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30 selection:text-emerald-200", theme === "light" && "theme-light")}>
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
        <div className="absolute top-[-10%] right-[5%] w-[40rem] h-[40rem] bg-emerald-500/5 blur-[150px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[10%] w-[40rem] h-[40rem] bg-indigo-500/5 blur-[150px] rounded-full" />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 overflow-hidden border-r border-white/5 bg-zinc-950/70 backdrop-blur-xl z-40">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
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
        <header className="sticky top-0 z-30 h-16 lg:h-20 border-b border-white/5 bg-zinc-950/60 backdrop-blur-xl">
          <div className="h-full px-4 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button aria-label="Открыть меню" className="lg:hidden text-zinc-400" onClick={() => setMobileOpen(true)}>
                <Menu className="w-6 h-6" />
              </button>
              <h1 className="text-lg lg:text-2xl font-bold tracking-tight truncate">{title}</h1>
              {demo && (
                <span className="hidden sm:inline-flex shrink-0 items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  Demo read-only
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 lg:gap-3">
              <form
                role="search"
                aria-label="Поиск лидов и чатов"
                action={hrefForRoute("inbox", {}, mode)}
                onSubmit={handleGlobalSearch}
                className="hidden md:flex items-center gap-2 rounded-full bg-white/5 border border-white/5 px-3 h-10 w-64"
              >
                <Search className="w-4 h-4 text-zinc-500" />
                <input
                  aria-label="Глобальный поиск"
                  name="q"
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Поиск лидов, чатов..."
                  className="bg-transparent text-sm outline-none placeholder:text-zinc-600 w-full"
                />
              </form>
              <Tip content={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
                <button
                  onClick={toggle}
                  aria-label="Переключить тему"
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
                  <button aria-label="Уведомления" className="relative w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors">
                    <Bell className="w-5 h-5" />
                    {unreadNotificationCount > 0 && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    )}
                  </button>
                }
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
                  <span className="text-sm font-semibold text-zinc-100">Уведомления</span>
                  <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">
                    {notificationBadgeLabel(unreadNotificationCount)}
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto p-1.5">
                  {productNotifications.notifications.length === 0 && (
                    <div className="rounded-xl px-3 py-4 text-sm text-zinc-400">
                      <p className="font-medium text-zinc-300">Новых событий пока нет</p>
                      <p className="mt-1 text-xs text-zinc-500">Когда появятся лиды, записи или CRM-синхронизации, они будут здесь.</p>
                    </div>
                  )}
                  {productNotifications.notifications.map((n) => {
                    const NIcon = n.icon;
                    return (
                      <div key={n.id} className="flex gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className={cn("w-8 h-8 shrink-0 rounded-lg bg-white/5 flex items-center justify-center", n.color)}>
                          <NIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-200 leading-snug">{n.text}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">{n.time}</p>
                        </div>
                        {n.unread && <span className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-emerald-400" />}
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => go("inbox")} className="w-full text-center text-sm font-medium text-emerald-400 hover:bg-white/5 py-3 border-t border-white/8 transition-colors">
                  Открыть все
                </button>
              </Dropdown>
              <Button size="sm" className="hidden sm:inline-flex" onClick={() => go("inbox")}>
                <Plus className="w-4 h-4 mr-1.5" /> Новый лид
              </Button>
            </div>
          </div>
        </header>

        <main className={cn("px-4 lg:px-8 py-6 pb-28 lg:pb-10 max-w-[1500px] mx-auto", contentClassName)}>
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/5 bg-zinc-950/90 backdrop-blur-xl">
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
                {item.label}
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
  const { go } = useNav();
  return (
    <button onClick={() => go(to)} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-4">
      <ChevronLeft className="w-4 h-4" /> {label}
    </button>
  );
}
