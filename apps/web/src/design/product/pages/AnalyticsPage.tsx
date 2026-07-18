import React, { useCallback, useState } from "react";
import type { AnalyticsOverview } from "@leadvirt/types";
import { motion } from "motion/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Users,
  TrendingUp,
  Clock,
  CalendarCheck,
  Banknote,
  Download,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import { useProductMode } from "../ProductMode";
import { Card, SectionTitle, ChannelBadge, channels, type ChannelId } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import { getAnalyticsOverview, type AnalyticsPeriod } from "@/lib/api/analytics";
import { channelIdFromType } from "../apiAdapters";
import { useApiResource } from "../useApiResource";
import { ResourceErrorState } from "../ResourceErrorState";
import { Skeleton } from "../ui";
import { useI18n } from "@/i18n/I18nProvider";
import {
  analyticsInsightLabel,
  demoAnalyticsScenarioLabel,
  demoAnalyticsWeekdayLabel,
} from "@/i18n/api-labels";
import type { Locale } from "@/i18n/config";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";

/* ------------------------------------------------------------------ */
/* Tooltip                                                              */
/* ------------------------------------------------------------------ */
function DarkTooltip({
  active,
  payload,
  label,
  unit = "",
}: {
  active?: boolean;
  payload?: { color: string; name: string; value: number }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl text-sm">
      {label && <p className="text-zinc-400 mb-1.5 text-xs">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-zinc-300">{p.name}:</span>
          <span className="font-semibold text-zinc-50">
            {p.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Period filter                                                        */
/* ------------------------------------------------------------------ */
const periods: Array<{ value: AnalyticsPeriod; labelKey: TranslationKey }> = [
  { value: "7d", labelKey: "suite.analytics.period7" },
  { value: "30d", labelKey: "suite.analytics.period30" },
  { value: "quarter", labelKey: "suite.analytics.periodQuarter" },
];

/* ------------------------------------------------------------------ */
/* KPI data                                                             */
/* ------------------------------------------------------------------ */
const kpiStyles = [
  {
    icon: Users,
    labelKey: "suite.analytics.totalLeads",
    accent: "text-emerald-400",
  },
  {
    icon: TrendingUp,
    labelKey: "suite.analytics.conversion",
    accent: "text-indigo-400",
  },
  {
    icon: Clock,
    labelKey: "suite.analytics.averageResponse",
    accent: "text-teal-400",
  },
  {
    icon: CalendarCheck,
    labelKey: "suite.analytics.bookingsOrders",
    accent: "text-sky-400",
  },
  {
    icon: Banknote,
    labelKey: "suite.analytics.revenue",
    accent: "text-amber-400",
  },
] satisfies Array<{ icon: typeof Users; labelKey: TranslationKey; accent: string }>;

/* ------------------------------------------------------------------ */
/* Chart palette                                                        */
/* ------------------------------------------------------------------ */
const PIE_COLORS = ["#34d399", "#818cf8", "#22d3ee", "#f59e0b", "#a78bfa", "#38bdf8"];

type Kpi = {
  icon: typeof Users;
  label: string;
  value: string;
  accent: string;
};
type ChannelPerformance = { channel: ChannelId; leads: number; conv: number };
type LeadTrend = { day: string; leads: number; booked: number };
type ScenarioConversion = { name: string; value: number };
type ResponsePoint = { label: string; sec: number };
type LoadedAnalyticsOverview = { period: AnalyticsPeriod; overview: AnalyticsOverview };
type Translate = (key: TranslationKey, values?: TranslationValues) => string;

function EmptyAnalyticsSection({
  testId,
  t,
  className = "h-48 sm:h-[280px]",
}: {
  testId: string;
  t: Translate;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-start pt-8 text-sm text-zinc-500 sm:justify-center sm:pt-0",
        className,
      )}
      data-testid={testId}
    >
      {t("dashboard.recent.empty")}
    </div>
  );
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildAnalyticsCsv({
  kpis: reportKpis,
  channels: reportChannels,
  scenarios,
  responses,
  trends,
  insights,
  periodLabel,
  channelLabel,
  formatDate,
  formatNumber,
  t,
}: {
  periodLabel: string;
  kpis: Kpi[];
  channels: ChannelPerformance[];
  scenarios: ScenarioConversion[];
  responses: ResponsePoint[];
  trends: LeadTrend[];
  insights: ReturnType<typeof aiRecommendationsFromOverview>;
  channelLabel: (channel: ChannelId) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  t: Translate;
}) {
  const generatedAt = formatDate(new Date(), {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const rows: Array<Array<string | number>> = [
    [
      t("suite.analytics.csvSection"),
      t("suite.analytics.csvMetric"),
      t("suite.analytics.csvValue"),
      t("suite.analytics.csvAdditional"),
    ],
    [
      t("suite.analytics.csvReport"),
      t("suite.analytics.csvPeriod"),
      periodLabel,
      t("suite.analytics.csvGenerated", { date: generatedAt }),
    ],
    ...reportKpis.map((kpi) => ["KPI", kpi.label, kpi.value, ""]),
    ...reportChannels.map((channel) => [
      t("suite.analytics.csvChannels"),
      channelLabel(channel.channel),
      formatNumber(channel.leads),
      t("suite.analytics.csvConversion", { value: formatNumber(channel.conv) }),
    ]),
    ...scenarios.map((scenario) => [
      t("suite.analytics.csvScenarios"),
      scenario.name,
      `${formatNumber(scenario.value)}%`,
      t("suite.analytics.conversion"),
    ]),
    ...responses.map((point) => [
      t("suite.analytics.responseTime"),
      point.label,
      t("suite.analytics.seconds", { count: formatNumber(point.sec) }),
      "",
    ]),
    ...trends.map((point) => [
      t("suite.analytics.csvLeadsByDay"),
      point.day,
      formatNumber(point.leads),
      t("suite.analytics.csvBookings", { count: formatNumber(point.booked) }),
    ]),
    ...insights.map((insight) => [
      t("suite.analytics.csvRecommendations"),
      insight.insight,
      insight.sub,
      "",
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function kpisFromOverview(
  overview: AnalyticsOverview,
  t: Translate,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatCurrency: (value: number, currency?: string) => string,
): Kpi[] {
  const totalLeads = overview.leadsByChannel.reduce((sum, channel) => sum + channel.leads, 0);
  const weightedConversion =
    totalLeads > 0
      ? overview.leadsByChannel.reduce(
          (sum, channel) => sum + channel.conversionRate * channel.leads,
          0,
        ) / totalLeads
      : 0;
  const bookingsOrders = overview.bookingsOrders.bookings + overview.bookingsOrders.orders;

  const values = [
    formatNumber(totalLeads),
    formatNumber(weightedConversion / 100, { style: "percent", maximumFractionDigits: 0 }),
    t("suite.analytics.seconds", {
      count: formatNumber(Math.round(overview.responseTime.averageSeconds)),
    }),
    formatNumber(bookingsOrders),
    formatCurrency(overview.estimatedRevenue),
  ];
  return kpiStyles.map((item, index) => ({
    ...item,
    label: t(item.labelKey),
    value: values[index] ?? "",
  }));
}

function channelPerformanceFromOverview(overview: AnalyticsOverview): ChannelPerformance[] {
  const grouped = new Map<ChannelId, { leads: number; weightedConversion: number }>();

  for (const item of overview.leadsByChannel) {
    const channel = channelIdFromType(item.channelType);
    const current = grouped.get(channel) ?? { leads: 0, weightedConversion: 0 };
    current.leads += item.leads;
    current.weightedConversion += item.conversionRate * item.leads;
    grouped.set(channel, current);
  }

  return [...grouped.entries()]
    .map(([channel, value]) => ({
      channel,
      leads: value.leads,
      conv: value.leads > 0 ? Math.round(value.weightedConversion / value.leads) : 0,
    }))
    .filter((item) => item.leads > 0)
    .sort((left, right) => right.leads - left.leads);
}

function leadsTrendFromOverview(
  overview: AnalyticsOverview,
  locale: Locale,
  localizeDemo: boolean,
): LeadTrend[] {
  return overview.leadsOverTime.map((item) => ({
    day: localizeDemo ? demoAnalyticsWeekdayLabel(item.name, locale) : item.name,
    leads: item.leads,
    booked: item.booked,
  }));
}

function scenarioConversionFromOverview(
  overview: AnalyticsOverview,
  locale: Locale,
  localizeDemo: boolean,
): ScenarioConversion[] {
  return overview.conversionByScenario.map((item) => ({
    name: localizeDemo ? demoAnalyticsScenarioLabel(item.scenario, locale) : item.scenario,
    value: Math.round(item.conversionRate),
  }));
}

function responseSummaryFromOverview(overview: AnalyticsOverview, t: Translate): ResponsePoint[] {
  return [
    {
      label: t("suite.analytics.averageResponse"),
      sec: Math.max(0, Math.round(overview.responseTime.averageSeconds)),
    },
    {
      label: `${t("suite.analytics.responseTime")} P90`,
      sec: Math.max(0, Math.round(overview.responseTime.p90Seconds)),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* AI Recommendations                                                   */
/* ------------------------------------------------------------------ */
const aiRecommendationStyles = [
  {
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Clock,
    color: "text-sky-400",
    bg: "bg-sky-500/10",
  },
  {
    icon: Sparkles,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  {
    icon: ArrowUpRight,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
];

function aiRecommendationsFromOverview(overview: AnalyticsOverview, locale: Locale, sub = "") {
  const insights = overview.aiInsightCodes?.length
    ? overview.aiInsightCodes.map((code) => analyticsInsightLabel(code, locale))
    : (overview.aiInsights ?? []);
  if (insights.length === 0) return [];

  return insights.map((insight, index) => {
    const style = aiRecommendationStyles[index % aiRecommendationStyles.length];
    return {
      ...style,
      insight,
      sub,
    };
  });
}

/* ------------------------------------------------------------------ */
/* AnalyticsPage                                                        */
/* ------------------------------------------------------------------ */
export function AnalyticsPage() {
  const { formatDate, formatNumber, locale, localeTag, t } = useI18n();
  const { demo } = useProductMode();
  const formatCompactCurrency = (value: number) =>
    new Intl.NumberFormat(localeTag, {
      style: "currency",
      currency: "RUB",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const loadAnalyticsOverview = useCallback(
    async () => ({ period, overview: await getAnalyticsOverview(period) }),
    [period],
  );
  const analyticsResource = useApiResource<LoadedAnalyticsOverview>(loadAnalyticsOverview);
  const overview = analyticsResource.data?.overview ?? null;
  const displayedPeriod = analyticsResource.data?.period ?? period;
  const loadingSelectedPeriod = analyticsResource.isLoading && !overview;
  const periodLabel = t(
    periods.find((item) => item.value === displayedPeriod)?.labelKey ?? "suite.analytics.period30",
  );
  const channelLabel = (channel: ChannelId) => {
    const channelConfig = channels[channel];
    return channelConfig.labelKey ? t(channelConfig.labelKey) : channelConfig.label;
  };
  if (!overview) {
    return (
      <ProductLayout title={t("suite.analytics.title")}>
        {loadingSelectedPeriod ? (
          <div className="space-y-6" data-testid="analytics-loading">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-10 w-28" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
          </div>
        ) : (
          <ResourceErrorState testId="analytics-load-error" onRetry={analyticsResource.reload} />
        )}
      </ProductLayout>
    );
  }

  const displayKpis = kpisFromOverview(overview, t, formatNumber, formatCompactCurrency);
  const analyticsChannels = channelPerformanceFromOverview(overview);
  const scenarioData = scenarioConversionFromOverview(overview, locale, demo);
  const responseData = responseSummaryFromOverview(overview, t);
  const leadsTrend = leadsTrendFromOverview(overview, locale, demo);
  const recommendations = aiRecommendationsFromOverview(
    overview,
    locale,
    t("suite.analytics.insightSub"),
  );

  const barData = analyticsChannels.map((d) => ({
    name: channelLabel(d.channel),
    leads: d.leads,
    channel: d.channel,
  }));

  const pieData = analyticsChannels.map((d, i) => ({
    name: channelLabel(d.channel),
    value: d.leads,
    channel: d.channel,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const handleExportReport = () => {
    const csv = buildAnalyticsCsv({
      kpis: displayKpis,
      channels: analyticsChannels,
      scenarios: scenarioData,
      responses: responseData,
      trends: leadsTrend,
      insights: recommendations,
      periodLabel,
      channelLabel,
      formatDate,
      formatNumber,
      t,
    });
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `leadvirt-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    toast.success(t("suite.analytics.exported"), {
      description: t("suite.analytics.exportReady"),
    });
  };

  return (
    <ProductLayout title={t("suite.analytics.title")}>
      <div className="space-y-8">
        {analyticsResource.isError ? (
          <ResourceErrorState testId="analytics-refresh-error" onRetry={analyticsResource.reload} />
        ) : null}
        {/* ── Header row ── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-1.5 rounded-2xl bg-zinc-900/60 border border-white/5 p-1">
            {periods.map((item) => (
              <button
                key={item.value}
                onClick={() => setPeriod(item.value)}
                disabled={analyticsResource.isLoading}
                aria-pressed={displayedPeriod === item.value}
                className={cn(
                  "rounded-xl px-4 py-1.5 text-sm font-medium transition-all disabled:cursor-wait disabled:opacity-70",
                  displayedPeriod === item.value
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 shadow-[0_0_14px_rgba(52,211,153,0.1)]"
                    : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExportReport}
            disabled={analyticsResource.isLoading}
          >
            <Download className="w-4 h-4" />
            {t("suite.analytics.export")}
          </Button>
        </motion.div>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {displayKpis.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.06, ease: "easeOut" }}
              >
                <Card
                  hover
                  className="p-4 relative overflow-hidden group"
                  data-testid={`analytics-kpi-${i}`}
                >
                  <div className="mb-3 flex items-center">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center",
                        kpi.accent,
                      )}
                    >
                      <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                    </div>
                  </div>
                  <div
                    className="text-2xl font-bold text-zinc-50 tracking-tight leading-none"
                    data-testid={`analytics-kpi-${i}-value`}
                  >
                    {kpi.value}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">{kpi.label}</div>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* ── Charts grid ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Leads by channel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <Card className="p-6">
              <SectionTitle
                title={t("suite.analytics.leadsByChannel")}
                sub={t("suite.analytics.inquiriesPeriod")}
              />
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={barData}
                    layout="vertical"
                    margin={{ left: 8, right: 12, top: 0, bottom: 0 }}
                  >
                    <CartesianGrid key="grid" horizontal={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      key="x"
                      type="number"
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      key="y"
                      type="category"
                      dataKey="name"
                      tick={{ fill: "#71717a", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={76}
                    />
                    <Tooltip
                      content={<DarkTooltip />}
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    />
                    <Bar
                      dataKey="leads"
                      name={t("suite.analytics.leads")}
                      radius={[0, 6, 6, 0]}
                      fill="#34d399"
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyAnalyticsSection testId="analytics-channels-empty" t={t} />
              )}
            </Card>
          </motion.div>

          {/* Workflow conversion */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="p-6">
              <SectionTitle title={t("suite.analytics.scenarioConversion")} sub="%" />
              {scenarioData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={scenarioData} margin={{ left: 0, right: 12, top: 0, bottom: 40 }}>
                    <CartesianGrid key="grid" vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      key="x"
                      dataKey="name"
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      angle={-22}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      key="y"
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      unit="%"
                    />
                    <Tooltip
                      content={<DarkTooltip unit="%" />}
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    />
                    <Bar
                      dataKey="value"
                      name={t("suite.analytics.conversion")}
                      radius={[6, 6, 0, 0]}
                    >
                      {scenarioData.map((_, i) => (
                        <Cell key={i} fill={["#818cf8", "#22d3ee", "#a78bfa", "#f59e0b"][i % 4]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyAnalyticsSection testId="analytics-scenarios-empty" t={t} />
              )}
            </Card>
          </motion.div>

          {/* Response time */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <Card className="p-6" data-testid="analytics-response-chart">
              <SectionTitle
                title={t("suite.analytics.aiResponse")}
                sub={`${t("suite.analytics.averageResponse")} / P90`}
              />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={responseData} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
                  <CartesianGrid key="grid" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    key="x"
                    dataKey="label"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    key="y"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    unit={` ${t("suite.analytics.seconds", { count: "" }).trim()}`}
                  />
                  <Tooltip
                    content={
                      <DarkTooltip
                        unit={` ${t("suite.analytics.seconds", { count: "" }).trim()}`}
                      />
                    }
                    cursor={{ stroke: "rgba(255,255,255,0.08)" }}
                  />
                  <Bar
                    dataKey="sec"
                    name={t("suite.analytics.responseTime")}
                    fill="#14b8a6"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>

          {/* Leads and bookings by day */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Card className="p-6">
              <SectionTitle
                title={t("suite.analytics.leadsBookings")}
                sub={t("suite.analytics.weeklyTrend")}
              />
              {leadsTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={leadsTrend} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
                    <defs key="defs-analytics-leads">
                      <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradBooked" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid key="grid" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      key="x"
                      dataKey="day"
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      key="y"
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<DarkTooltip />}
                      cursor={{ stroke: "rgba(255,255,255,0.08)" }}
                    />
                    <Area
                      key="leads"
                      type="monotone"
                      dataKey="leads"
                      name={t("suite.analytics.leads")}
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#gradLeads)"
                      dot={{ r: 3, fill: "#34d399", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                    <Area
                      key="booked"
                      type="monotone"
                      dataKey="booked"
                      name={t("suite.analytics.bookings")}
                      stroke="#818cf8"
                      strokeWidth={2}
                      fill="url(#gradBooked)"
                      dot={{ r: 3, fill: "#818cf8", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyAnalyticsSection
                  testId="analytics-trend-empty"
                  t={t}
                  className="h-48 sm:h-[260px]"
                />
              )}
            </Card>
          </motion.div>
        </div>

        {/* Best channels */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <Card className="p-6">
            <SectionTitle
              title={t("suite.analytics.bestChannels")}
              sub={t("suite.analytics.channelDistribution")}
            />
            {analyticsChannels.length > 0 ? (
              <div className="flex flex-col lg:flex-row items-center gap-8">
                <ResponsiveContainer width="100%" height={280} className="lg:max-w-xs">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={110}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<DarkTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {analyticsChannels.map((d, i) => {
                    const total = analyticsChannels.reduce((s, x) => s + x.leads, 0);
                    const pct = Math.round((d.leads / total) * 100);
                    return (
                      <div
                        key={d.channel}
                        className="flex items-center gap-3 rounded-2xl bg-white/[0.03] border border-white/5 px-4 py-3"
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <ChannelBadge id={d.channel} withLabel />
                        <div className="ml-auto text-right">
                          <div className="text-sm font-bold text-zinc-50">
                            {formatNumber(d.leads)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {formatNumber(pct / 100, {
                              style: "percent",
                              maximumFractionDigits: 0,
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyAnalyticsSection testId="analytics-best-channels-empty" t={t} />
            )}
          </Card>
        </motion.div>

        {/* ── AI Recommendations ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Card className="p-6 border-emerald-500/10 bg-gradient-to-br from-emerald-500/5 via-zinc-900/50 to-zinc-900/50">
            <SectionTitle
              title={t("suite.analytics.recommendations")}
              sub={t("suite.analytics.recommendationsSub")}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {recommendations.length === 0 ? (
                <EmptyAnalyticsSection
                  testId="analytics-recommendations-empty"
                  t={t}
                  className="h-32 sm:col-span-2"
                />
              ) : null}
              {recommendations.map((rec, i) => {
                const Icon = rec.icon;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.45 + i * 0.07 }}
                    className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4 flex gap-3 group hover:border-white/10 hover:bg-white/[0.05] transition-colors"
                  >
                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                        rec.bg,
                      )}
                    >
                      <Icon className={cn("w-4.5 h-[18px] w-[18px]", rec.color)} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-100 leading-snug">
                        {rec.insight}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{rec.sub}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      </div>
    </ProductLayout>
  );
}
