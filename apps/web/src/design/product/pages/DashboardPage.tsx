import React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Users,
  MessageSquare,
  CalendarCheck,
  GitMerge,
  Timer,
  TrendingUp,
  ChevronRight,
  UserPlus,
  Inbox,
  Zap,
  Bot,
  Building2,
  Sparkles,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ProductLayout } from "../ProductLayout";
import { Card, SectionTitle, StatCard, Avatar, ChannelBadge, StatusPill } from "../shared";
import { hrefForRoute, useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../ui";
import { cn } from "../../lib/utils";
import { getDashboardSummary } from "@/lib/api/dashboard";
import { getCurrentTenant, type CurrentTenant } from "@/lib/api/tenants";
import type { DashboardMetricDeltas, DashboardRecentLead, DashboardSummary } from "@leadvirt/types";
import type { ChannelId } from "../shared";
import {
  channelIdFromType,
  localizeSeedText,
  relativeTimeLabel,
  stageFromStatus,
} from "../apiAdapters";
import { useApiResource } from "../useApiResource";
import { ResourceErrorState } from "../ResourceErrorState";
import { useI18n } from "@/i18n/I18nProvider";
import { dashboardActivityLabel } from "@/i18n/api-labels";
import { intlLocale, type Locale } from "@/i18n/config";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";
import { DashboardReadinessJourney } from "../readiness/DashboardReadinessJourney";
import { loadDashboardReadinessSnapshot } from "../readiness/dashboardReadiness";

/* ─── helpers ─── */
type Translate = (key: TranslationKey, values?: TranslationValues) => string;

function weekdayLabels(locale: Locale) {
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    timeZone: "UTC",
  });
  const firstMonday = Date.UTC(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(firstMonday + index * 86_400_000),
  );
}

function localizeWeekday(value: string | undefined, locale: Locale, weekday?: number) {
  if (weekday !== undefined && weekday >= 0 && weekday < 7) return weekdayLabels(locale)[weekday];
  if (!value) return "";
  if (locale === "ru") return value;
  const weekdayIndexes: Record<string, number> = {
    Пн: 0,
    Вт: 1,
    Ср: 2,
    Чт: 3,
    Пт: 4,
    Сб: 5,
    Вс: 6,
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const index = weekdayIndexes[value];
  return index === undefined ? value : weekdayLabels(locale)[index];
}

/* ─── Custom tooltip for recharts ─── */
interface ChartTooltipItem {
  color?: string;
  dataKey?: number | string;
  name?: number | string;
  value?: Array<number | string> | number | string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: number | string;
  payload?: ChartTooltipItem[];
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md bg-zinc-900 border border-white/10 px-4 py-3 shadow-xl text-sm">
      <p className="text-zinc-400 mb-2 font-medium">{label}</p>
      {payload.map((item, index) => (
        <div key={item.dataKey ?? item.name ?? index} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
          <span className="text-zinc-300">{item.name}:</span>
          <span className="font-bold text-zinc-50">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Activity icon/color per type ─── */
const activityMeta = {
  lead: { icon: UserPlus, color: "text-sky-400", bg: "bg-sky-500/15", dot: "bg-sky-400" },
  booking: {
    icon: CalendarCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-500/15",
    dot: "bg-emerald-400",
  },
  crm: { icon: Building2, color: "text-indigo-400", bg: "bg-indigo-500/15", dot: "bg-indigo-400" },
  ai: { icon: Bot, color: "text-violet-400", bg: "bg-violet-500/15", dot: "bg-violet-400" },
};

type ActivityType = keyof typeof activityMeta;

function activityTypeFromAction(action: string): ActivityType {
  if (action.includes("booking") || action.includes("order")) return "booking";
  if (action.includes("crm")) return "crm";
  if (action.includes("lead")) return "lead";
  return "ai";
}

function dashboardRelativeTimeLabel(value: string, locale: Locale, t: Translate) {
  const label = relativeTimeLabel(value, locale);
  if (label === "—" || label === t("common.now")) return t("common.justNow");
  return label;
}

function useDashboardSummaryResource() {
  return useApiResource<DashboardSummary>(getDashboardSummary);
}

function useCurrentTenantResource() {
  return useApiResource<CurrentTenant>(getCurrentTenant);
}

function useDashboardReadinessResource() {
  return useApiResource(loadDashboardReadinessSnapshot);
}

function summarizeChannelPerformance(summary: DashboardSummary) {
  const grouped = new Map<ChannelId, { channel: ChannelId; leads: number; convWeighted: number }>();

  for (const channel of summary.channelPerformance) {
    const id = channelIdFromType(channel.channelType);
    const current = grouped.get(id) ?? { channel: id, leads: 0, convWeighted: 0 };
    current.leads += channel.leads;
    current.convWeighted += channel.conversionRate * channel.leads;
    grouped.set(id, current);
  }

  return Array.from(grouped.values()).map((channel) => ({
    channel: channel.channel,
    leads: channel.leads,
    conv: channel.leads > 0 ? Math.round((channel.convWeighted / channel.leads) * 10) / 10 : 0,
  }));
}

function formatMetricDelta(
  value: number | undefined,
  formatNumber: (value: number) => string,
  suffix = "%",
) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${formatNumber(rounded)}${suffix}`;
}

function leadName(lead: DashboardRecentLead, locale: Locale, t: Translate) {
  return localizeSeedText(lead.name, locale) || t("dashboard.fallback.client");
}

function leadService(lead: DashboardRecentLead, locale: Locale, t: Translate) {
  return localizeSeedText(lead.interest, locale) || t("dashboard.fallback.lead");
}

function leadTime(lead: DashboardRecentLead, locale: Locale) {
  return relativeTimeLabel(lead.lastMessageAt ?? lead.createdAt, locale);
}

function dashboardDeltaConfig(deltas: DashboardMetricDeltas | undefined, pointsSuffix: string) {
  return [
    { value: deltas?.newLeadsPercent, suffix: "%", positiveWhen: (value: number) => value >= 0 },
    {
      value: deltas?.aiConversationsPercent,
      suffix: "%",
      positiveWhen: (value: number) => value >= 0,
    },
    {
      value: deltas?.bookingsOrdersPercent,
      suffix: "%",
      positiveWhen: (value: number) => value >= 0,
    },
    {
      value: deltas?.leadsSentToCrmPercent,
      suffix: "%",
      positiveWhen: (value: number) => value >= 0,
    },
    {
      value: deltas?.averageResponseTimePercent,
      suffix: "%",
      positiveWhen: (value: number) => value <= 0,
    },
    {
      value: deltas?.conversionRatePoints,
      suffix: pointsSuffix,
      positiveWhen: (value: number) => value >= 0,
    },
  ];
}

/* ══════════════════════════════════════════════════
   DashboardPage
══════════════════════════════════════════════════ */
export function DashboardPage() {
  const { locale, formatCurrency, formatDate, formatNumber, t } = useI18n();
  const { mode } = useNav();
  const summaryResource = useDashboardSummaryResource();
  const tenantResource = useCurrentTenantResource();
  const readinessResource = useDashboardReadinessResource();
  const summary = summaryResource.data;
  const tenantName = tenantResource.data?.name || null;

  if (!summary) {
    return (
      <ProductLayout title={t("dashboard.title")}>
        <div className="space-y-8">
          <DashboardReadinessJourney
            snapshot={readinessResource.data}
            isLoading={readinessResource.isLoading}
            isError={readinessResource.isError}
            onRetry={readinessResource.reload}
          />
          {summaryResource.isLoading ? (
            <div className="space-y-8" data-testid="dashboard-loading">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 sm:h-32" />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Skeleton className="h-72 lg:col-span-2" />
                <Skeleton className="h-72" />
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Skeleton className="h-72" />
                <Skeleton className="h-72" />
              </div>
            </div>
          ) : (
            <ResourceErrorState testId="dashboard-load-error" onRetry={summaryResource.reload} />
          )}
        </div>
      </ProductLayout>
    );
  }

  const stats = [
    {
      icon: Users,
      label: t("dashboard.metric.newLeads"),
      value: "0",
      positive: true,
      accent: "text-sky-400",
    },
    {
      icon: MessageSquare,
      label: t("dashboard.metric.aiDialogs"),
      value: "0",
      positive: true,
      accent: "text-violet-400",
    },
    {
      icon: CalendarCheck,
      label: t("dashboard.metric.bookings"),
      value: "0",
      positive: true,
      accent: "text-emerald-400",
    },
    {
      icon: GitMerge,
      label: t("dashboard.metric.crmLeads"),
      value: "0",
      positive: true,
      accent: "text-indigo-400",
    },
    {
      icon: Timer,
      label: t("dashboard.metric.responseTime"),
      value: t("dashboard.metric.seconds", { count: 0 }),
      positive: true,
      accent: "text-amber-400",
    },
    {
      icon: TrendingUp,
      label: t("dashboard.metric.conversion"),
      value: "0%",
      positive: true,
      accent: "text-rose-400",
    },
  ];

  const currentMetricValues = [
    summary.metrics.newLeadsCount,
    summary.metrics.aiConversationsCount,
    summary.metrics.bookingsOrdersCreated,
    summary.metrics.leadsSentToCrm,
    summary.metrics.averageResponseTimeSeconds,
    summary.metrics.conversionRate,
  ];
  const dashboardStats = stats.map((stat, index) => {
    const values = [
      formatNumber(summary.metrics.newLeadsCount),
      formatNumber(summary.metrics.aiConversationsCount),
      formatNumber(summary.metrics.bookingsOrdersCreated),
      formatNumber(summary.metrics.leadsSentToCrm),
      t("dashboard.metric.seconds", { count: summary.metrics.averageResponseTimeSeconds }),
      `${summary.metrics.conversionRate}%`,
    ];
    const delta =
      (currentMetricValues[index] ?? 0) > 0
        ? dashboardDeltaConfig(summary.metrics.deltas, t("dashboard.metric.points"))[index]
        : undefined;

    return {
      ...stat,
      value: values[index] ?? stat.value,
      delta: delta ? formatMetricDelta(delta.value, formatNumber, delta.suffix) : undefined,
      positive: delta?.value === undefined ? stat.positive : delta.positiveWhen(delta.value),
    };
  });
  const recentLeads = summary?.recentLeads ?? [];
  const dashboardLeadsByDay = summary?.trend?.length
    ? summary.trend.map((item) => ({
        ...item,
        name: localizeWeekday(item.name, locale, item.weekday),
      }))
    : [];
  const dashboardChannelPerformance = summary ? summarizeChannelPerformance(summary) : [];
  const dashboardActivity = summary
    ? summary.recentActivity.map((item) => ({
        id: item.id,
        type: activityTypeFromAction(item.action),
        text: dashboardActivityLabel(item, locale),
        time: dashboardRelativeTimeLabel(item.createdAt, locale, t),
      }))
    : [];

  return (
    <ProductLayout title={t("dashboard.title")}>
      {/* ── Glow orbs (decorative) ── */}
      <div className="space-y-8">
        {summaryResource.isError ? (
          <ResourceErrorState testId="dashboard-refresh-error" onRetry={summaryResource.reload} />
        ) : null}

        {/* ── 1. Greeting row ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
        >
          <div>
            {tenantName ? (
              <h2 className="text-2xl font-bold tracking-tight text-zinc-50">
                {t("dashboard.welcome", { name: tenantName })}
              </h2>
            ) : tenantResource.isLoading ? (
              <Skeleton className="h-8 w-64 max-w-full" />
            ) : (
              <h2 className="text-2xl font-bold tracking-tight text-zinc-50">
                {t("auth.toast.welcome")}
              </h2>
            )}
            <p className="text-sm text-zinc-500 mt-1 capitalize">
              {formatDate(new Date(), {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild variant="secondary" size="sm" data-testid="dashboard-open-inbox">
              <Link href={hrefForRoute("inbox", {}, mode)}>
                <Inbox className="w-4 h-4 mr-1.5" />
                {t("dashboard.action.openInbox")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" data-testid="dashboard-scenarios">
              <Link href={hrefForRoute("automation", {}, mode)}>
                <Sparkles className="w-4 h-4 mr-1.5" />
                {t("dashboard.action.scenarios")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" data-testid="dashboard-analytics">
              <Link href={hrefForRoute("analytics", {}, mode)}>
                <Zap className="w-4 h-4 mr-1.5" />
                {t("dashboard.action.analytics")}
              </Link>
            </Button>
          </div>
        </motion.div>

        <DashboardReadinessJourney
          snapshot={readinessResource.data}
          isLoading={readinessResource.isLoading}
          isError={readinessResource.isError}
          onRetry={readinessResource.reload}
        />

        {/* ── 2. Stat cards ── */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {dashboardStats.map((s, i) => (
            <StatCard
              key={s.label}
              icon={s.icon}
              label={s.label}
              value={s.value}
              delta={s.delta}
              positive={s.positive}
              accent={s.accent}
              index={i + 1}
            />
          ))}
        </div>

        {/* ── 3. Chart + Channels ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          <motion.div
            className="lg:col-span-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.3, ease: "easeOut" }}
          >
            <Card className="p-4 sm:p-6">
              <SectionTitle
                title={t("dashboard.chart.title")}
                sub={t("dashboard.chart.description")}
                action={
                  <Link
                    href={hrefForRoute("analytics", {}, mode)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                  >
                    {t("dashboard.chart.details")} <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                }
              />
              {dashboardLeadsByDay.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={dashboardLeadsByDay}
                      margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
                    >
                      <defs key="defs-dashboard-leads">
                        <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradBooked" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#818cf8" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid key="grid" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        key="x"
                        dataKey="name"
                        tick={{ fill: "#71717a", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        key="y"
                        tick={{ fill: "#71717a", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={<ChartTooltip />}
                        cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
                      />
                      <Area
                        key="leads"
                        type="monotone"
                        dataKey="leads"
                        name={t("dashboard.chart.leads")}
                        stroke="#34d399"
                        strokeWidth={2}
                        fill="url(#gradLeads)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#34d399", stroke: "#18181b", strokeWidth: 2 }}
                      />
                      <Area
                        key="booked"
                        type="monotone"
                        dataKey="booked"
                        name={t("dashboard.chart.bookings")}
                        stroke="#818cf8"
                        strokeWidth={2}
                        fill="url(#gradBooked)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#818cf8", stroke: "#18181b", strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  className="flex h-32 items-center justify-center text-sm text-zinc-500 sm:h-56"
                  data-testid="dashboard-trend-empty"
                >
                  {t("dashboard.recent.empty")}
                </div>
              )}
              {dashboardLeadsByDay.length > 0 ? (
                <div className="flex items-center gap-5 mt-4">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-0.5 bg-emerald-400 rounded-full" />
                    <span className="text-xs text-zinc-500">{t("dashboard.chart.leads")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-0.5 bg-indigo-400 rounded-full" />
                    <span className="text-xs text-zinc-500">{t("dashboard.chart.bookings")}</span>
                  </div>
                </div>
              ) : null}
            </Card>
          </motion.div>

          {/* Channels */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.38, ease: "easeOut" }}
          >
            <Card className="h-full p-4 sm:p-6">
              <SectionTitle
                title={t("dashboard.channels.title")}
                sub={t("dashboard.channels.description")}
              />
              <div className="space-y-4">
                {dashboardChannelPerformance.length === 0 && (
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-5">
                    <p className="text-sm font-medium text-zinc-300">
                      {t("dashboard.channels.empty")}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("dashboard.channels.emptyDetail")}
                    </p>
                  </div>
                )}
                {dashboardChannelPerformance.map((cp, i) => (
                  <motion.div
                    key={cp.channel}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.42 + i * 0.06, duration: 0.4 }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <ChannelBadge id={cp.channel} withLabel />
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-zinc-400">
                          {t("dashboard.channels.leads", { count: formatNumber(cp.leads) })}
                        </span>
                        <span className="text-emerald-400 font-semibold">{cp.conv}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${cp.conv}%` }}
                        transition={{ delay: 0.5 + i * 0.06, duration: 0.7, ease: "easeOut" }}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* ── 4. Recent leads + Activity ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Leads */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.46, ease: "easeOut" }}
          >
            <Card className="p-4 sm:p-6">
              <SectionTitle
                title={t("dashboard.recent.title")}
                sub={t("dashboard.recent.description")}
                action={
                  <Link
                    href={hrefForRoute("inbox", {}, mode)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                  >
                    {t("dashboard.recent.all")} <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                }
              />
              <div className="space-y-1">
                {recentLeads.length === 0 && (
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-5">
                    <p className="text-sm font-medium text-zinc-300">
                      {t("dashboard.recent.empty")}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("dashboard.recent.emptyDetail")}
                    </p>
                  </div>
                )}
                {recentLeads.map((lead, i) => (
                  <motion.div
                    key={lead.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + i * 0.07, duration: 0.4 }}
                  >
                    <Link
                      href={
                        lead.conversationId
                          ? hrefForRoute("conversation", { id: lead.conversationId }, mode)
                          : hrefForRoute("pipeline", {}, mode)
                      }
                      className="w-full flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-white/5 transition-colors text-left group"
                    >
                      <Avatar name={leadName(lead, locale, t)} size={38} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-zinc-100 truncate">
                            {leadName(lead, locale, t)}
                          </span>
                          <ChannelBadge id={channelIdFromType(lead.channelType)} />
                        </div>
                        <span className="text-xs text-zinc-500 truncate block">
                          {leadService(lead, locale, t)}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <StatusPill stage={stageFromStatus(lead.status)} />
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-emerald-400">
                            {formatCurrency(lead.valueAmount ?? 0, lead.currency)}
                          </span>
                          <span className="text-[10px] text-zinc-600">
                            {leadTime(lead, locale)}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0 ml-1" />
                    </Link>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Activity feed */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.52, ease: "easeOut" }}
          >
            <Card className="p-6">
              <SectionTitle
                title={t("dashboard.activity.title")}
                sub={t("dashboard.activity.description")}
                action={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-xs text-emerald-400 font-medium">Live</span>
                  </span>
                }
              />
              <div className="relative">
                {/* Vertical line */}
                {dashboardActivity.length > 0 && (
                  <div className="absolute left-[18px] top-3 bottom-3 w-px bg-white/5" />
                )}
                <div className="space-y-1">
                  {dashboardActivity.length === 0 && (
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-5">
                      <p className="text-sm font-medium text-zinc-300">
                        {t("dashboard.activity.empty")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {t("dashboard.activity.emptyDetail")}
                      </p>
                    </div>
                  )}
                  {dashboardActivity.map((item, i) => {
                    const meta = activityMeta[item.type];
                    const Icon = meta.icon;
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.56 + i * 0.07, duration: 0.38 }}
                        className="flex items-start gap-3 py-2.5 px-1"
                      >
                        <div
                          className={cn(
                            "relative z-10 w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                            meta.bg,
                          )}
                        >
                          <Icon className={cn("w-4 h-4", meta.color)} />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <p className="text-sm text-zinc-300 leading-snug">{item.text}</p>
                          <p className="text-xs text-zinc-600 mt-0.5">{item.time}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </ProductLayout>
  );
}
