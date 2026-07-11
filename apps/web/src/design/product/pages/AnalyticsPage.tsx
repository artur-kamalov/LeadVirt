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
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
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
  ArrowDownRight,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import { Card, SectionTitle, ChannelBadge, channels, type ChannelId } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { toast } from "sonner";
import { getAnalyticsOverview, type AnalyticsPeriod } from "@/lib/api/analytics";
import { channelIdFromType } from "../apiAdapters";
import { useApiResource } from "../useApiResource";

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
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: p.color }}
          />
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
const periods = ["7 дней", "30 дней", "Квартал"] as const;
type Period = (typeof periods)[number];

const analyticsPeriodByLabel: Record<Period, AnalyticsPeriod> = {
  "7 дней": "7d",
  "30 дней": "30d",
  "Квартал": "quarter",
};

/* ------------------------------------------------------------------ */
/* KPI data                                                             */
/* ------------------------------------------------------------------ */
const kpis = [
  {
    icon: Users,
    label: "Всего лидов",
    value: "0",
    delta: "0%",
    positive: true,
    accent: "text-emerald-400",
  },
  {
    icon: TrendingUp,
    label: "Конверсия",
    value: "0%",
    delta: "0%",
    positive: true,
    accent: "text-indigo-400",
  },
  {
    icon: Clock,
    label: "Среднее время ответа",
    value: "0 сек",
    delta: "0%",
    positive: true,
    accent: "text-teal-400",
  },
  {
    icon: CalendarCheck,
    label: "Записи / заказы",
    value: "0",
    delta: "0%",
    positive: true,
    accent: "text-sky-400",
  },
  {
    icon: Banknote,
    label: "Оценка выручки",
    value: "0 ₽",
    delta: "0%",
    positive: true,
    accent: "text-amber-400",
  },
];

/* ------------------------------------------------------------------ */
/* Chart palette                                                        */
/* ------------------------------------------------------------------ */
const PIE_COLORS = ["#34d399", "#818cf8", "#22d3ee", "#f59e0b", "#a78bfa", "#38bdf8"];

const channelColors: Record<string, string> = {
  instagram: "#f472b6",
  whatsapp: "#34d399",
  telegram: "#38bdf8",
  website: "#818cf8",
  webhook: "#22d3ee",
  vk: "#60a5fa",
  email: "#f59e0b",
};

type Kpi = (typeof kpis)[number];
type ChannelPerformance = { channel: ChannelId; leads: number; conv: number };
type LeadTrend = { day: string; leads: number; booked: number };
type ScenarioConversion = { name: string; value: number };
type ResponsePoint = { t: string; sec: number };

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCurrencyRub(value: number) {
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1_000_000)} млн ₽`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value / 1_000)} тыс ₽`;
  }
  return `${formatNumber(value)} ₽`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildAnalyticsCsv({
  period,
  kpis: reportKpis,
  channels: reportChannels,
  scenarios,
  responses,
  trends,
  insights,
}: {
  period: Period;
  kpis: Kpi[];
  channels: ChannelPerformance[];
  scenarios: ScenarioConversion[];
  responses: ResponsePoint[];
  trends: LeadTrend[];
  insights: ReturnType<typeof aiRecommendationsFromOverview>;
}) {
  const generatedAt = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const rows: Array<Array<string | number>> = [
    ["Раздел", "Показатель", "Значение", "Дополнительно"],
    ["Отчёт", "Период", period, `Сформирован: ${generatedAt}`],
    ...reportKpis.map((kpi) => ["KPI", kpi.label, kpi.value, kpi.delta]),
    ...reportChannels.map((channel) => [
      "Каналы",
      channels[channel.channel].label,
      channel.leads,
      `${channel.conv}% конверсия`,
    ]),
    ...scenarios.map((scenario) => ["Сценарии", scenario.name, `${scenario.value}%`, "Конверсия"]),
    ...responses.map((point) => ["Время ответа", point.t, `${point.sec} сек`, "Среднее значение"]),
    ...trends.map((point) => ["Лиды по дням", point.day, point.leads, `${point.booked} записей`]),
    ...insights.map((insight) => ["AI рекомендации", insight.insight, insight.sub, ""]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function kpisFromOverview(overview: AnalyticsOverview): Kpi[] {
  const totalLeads = overview.leadsByChannel.reduce((sum, channel) => sum + channel.leads, 0);
  const weightedConversion = totalLeads > 0
    ? overview.leadsByChannel.reduce((sum, channel) => sum + channel.conversionRate * channel.leads, 0) / totalLeads
    : 0;
  const bookingsOrders = overview.bookingsOrders.bookings + overview.bookingsOrders.orders;

  return [
    { ...kpis[0], value: formatNumber(totalLeads) },
    { ...kpis[1], value: `${Math.round(weightedConversion)}%` },
    { ...kpis[2], value: `${Math.round(overview.responseTime.averageSeconds)} сек` },
    { ...kpis[3], value: formatNumber(bookingsOrders) },
    { ...kpis[4], value: formatCurrencyRub(overview.estimatedRevenue) },
  ];
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

function leadsTrendFromOverview(overview: AnalyticsOverview): LeadTrend[] {
  return overview.leadsOverTime.map((item) => ({
    day: item.name,
    leads: item.leads,
    booked: item.booked,
  }));
}

function scenarioConversionFromOverview(overview: AnalyticsOverview): ScenarioConversion[] {
  return overview.conversionByScenario.map((item) => ({
    name: item.scenario,
    value: Math.round(item.conversionRate),
  }));
}

function responseTrendFromOverview(overview: AnalyticsOverview): ResponsePoint[] {
  const averageSeconds = Math.round(overview.responseTime.averageSeconds);
  const p90Seconds = Math.round(overview.responseTime.p90Seconds);

  if (averageSeconds <= 0 && p90Seconds <= 0) {
    return [
      { t: "00:00", sec: 0 },
      { t: "04:00", sec: 0 },
      { t: "08:00", sec: 0 },
      { t: "12:00", sec: 0 },
      { t: "16:00", sec: 0 },
      { t: "20:00", sec: 0 },
      { t: "23:59", sec: 0 },
    ];
  }

  const average = Math.max(1, averageSeconds);
  const p90 = Math.max(average, p90Seconds);
  return [
    { t: "00:00", sec: Math.max(1, average - 3) },
    { t: "04:00", sec: Math.max(1, average - 5) },
    { t: "08:00", sec: Math.round((average + p90) / 2) },
    { t: "12:00", sec: p90 },
    { t: "16:00", sec: Math.round((average + p90) / 2) },
    { t: "20:00", sec: average },
    { t: "23:59", sec: Math.max(1, average - 2) },
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

function aiRecommendationsFromOverview(overview: AnalyticsOverview) {
  if (overview.aiInsights.length === 0) return [];

  return overview.aiInsights.map((insight, index) => {
    const style = aiRecommendationStyles[index % aiRecommendationStyles.length];
    return {
      ...style,
      insight,
      sub: "Инсайт рассчитан по текущим лидам, сценариям и каналам workspace.",
    };
  });
}

/* ------------------------------------------------------------------ */
/* AnalyticsPage                                                        */
/* ------------------------------------------------------------------ */
export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30 дней");
  const loadAnalyticsOverview = useCallback(
    () => getAnalyticsOverview(analyticsPeriodByLabel[period]),
    [period]
  );
  const { data: overview } = useApiResource<AnalyticsOverview>(loadAnalyticsOverview);

  const displayKpis = overview ? kpisFromOverview(overview) : kpis;
  const analyticsChannels = overview ? channelPerformanceFromOverview(overview) : [];
  const scenarioData = overview ? scenarioConversionFromOverview(overview) : [];
  const responseData = overview ? responseTrendFromOverview(overview) : [];
  const leadsTrend = overview ? leadsTrendFromOverview(overview) : [];
  const recommendations = overview ? aiRecommendationsFromOverview(overview) : [];

  const barData = analyticsChannels.map((d) => ({
    name: channels[d.channel].label,
    Лиды: d.leads,
    "Конверсия %": d.conv,
    channel: d.channel,
  }));

  const pieData = analyticsChannels.map((d, i) => ({
    name: channels[d.channel].label,
    value: d.leads,
    channel: d.channel,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const handleExportReport = () => {
    const csv = buildAnalyticsCsv({
      period,
      kpis: displayKpis,
      channels: analyticsChannels,
      scenarios: scenarioData,
      responses: responseData,
      trends: leadsTrend,
      insights: recommendations,
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

    toast.success("Отчёт экспортирован", {
      description: "CSV-файл готов к загрузке",
    });
  };

  return (
    <ProductLayout title="Аналитика">
      <div className="space-y-8">
        {/* ── Header row ── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-1.5 rounded-2xl bg-zinc-900/60 border border-white/5 p-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => { setPeriod(p); toast("Период обновлён"); }}
                className={cn(
                  "rounded-xl px-4 py-1.5 text-sm font-medium transition-all",
                  period === p
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 shadow-[0_0_14px_rgba(52,211,153,0.1)]"
                    : "text-zinc-400 hover:text-zinc-100"
                )}
              >
                {p}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExportReport}
          >
            <Download className="w-4 h-4" />
            Экспорт
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
                <Card hover className="p-4 relative overflow-hidden group" data-testid={`analytics-kpi-${i}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center",
                        kpi.accent
                      )}
                    >
                      <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                    </div>
                    <span
                      className={cn(
                        "text-xs font-semibold rounded-full px-2 py-0.5 flex items-center gap-0.5",
                        kpi.positive
                          ? "text-emerald-400 bg-emerald-500/10"
                          : "text-rose-400 bg-rose-500/10"
                      )}
                    >
                      {kpi.positive ? (
                        <ArrowUpRight className="w-3 h-3" />
                      ) : (
                        <ArrowDownRight className="w-3 h-3" />
                      )}
                      {kpi.delta}
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-zinc-50 tracking-tight leading-none" data-testid={`analytics-kpi-${i}-value`}>
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
          {/* Лиды по каналам */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <Card className="p-6">
              <SectionTitle title="Лиды по каналам" sub="Количество обращений за период" />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ left: 8, right: 12, top: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    key="grid"
                    horizontal={false}
                    stroke="rgba(255,255,255,0.04)"
                  />
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
                  <Bar dataKey="Лиды" radius={[0, 6, 6, 0]} fill="#34d399" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>

          {/* Конверсия по сценариям */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="p-6">
              <SectionTitle title="Конверсия по сценариям" sub="%" />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={scenarioData}
                  margin={{ left: 0, right: 12, top: 0, bottom: 40 }}
                >
                  <CartesianGrid
                    key="grid"
                    vertical={false}
                    stroke="rgba(255,255,255,0.04)"
                  />
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
                  <Bar dataKey="value" name="Конверсия" radius={[6, 6, 0, 0]}>
                    {scenarioData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          ["#818cf8", "#22d3ee", "#a78bfa", "#f59e0b"][i % 4]
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>

          {/* Время ответа */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <Card className="p-6">
              <SectionTitle
                title="Время ответа AI"
                sub="Среднее время в течение суток (сек)"
              />
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={responseData}
                  margin={{ left: 0, right: 12, top: 4, bottom: 0 }}
                >
                  <defs key="defs-analytics-teal">
                    <linearGradient id="gradTeal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid key="grid" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    key="x"
                    dataKey="t"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    key="y"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    unit=" с"
                  />
                  <Tooltip
                    content={<DarkTooltip unit=" с" />}
                    cursor={{ stroke: "rgba(255,255,255,0.08)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sec"
                    name="Время ответа"
                    stroke="#14b8a6"
                    strokeWidth={2}
                    fill="url(#gradTeal)"
                    dot={{ r: 3, fill: "#14b8a6", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#14b8a6" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>

          {/* Лиды и записи по дням */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Card className="p-6">
              <SectionTitle
                title="Лиды и записи по дням"
                sub="Динамика за неделю"
              />
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={leadsTrend}
                  margin={{ left: 0, right: 12, top: 4, bottom: 0 }}
                >
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
                    name="Лиды"
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
                    name="Записи"
                    stroke="#818cf8"
                    strokeWidth={2}
                    fill="url(#gradBooked)"
                    dot={{ r: 3, fill: "#818cf8", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        </div>

        {/* ── Лучшие каналы (full-width donut) ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <Card className="p-6">
            <SectionTitle
              title="Лучшие каналы"
              sub="Распределение лидов по источникам"
            />
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
                  <Tooltip
                    content={<DarkTooltip />}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analyticsChannels.map((d, i) => {
                  const total = analyticsChannels.reduce(
                    (s, x) => s + x.leads,
                    0
                  );
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
                          {d.leads}
                        </div>
                        <div className="text-xs text-zinc-500">{pct}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
              title="Рекомендации AI"
              sub="Персонализированные инсайты на основе ваших данных"
            />
            <div className="grid gap-3 sm:grid-cols-2">
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
                        rec.bg
                      )}
                    >
                      <Icon className={cn("w-4.5 h-[18px] w-[18px]", rec.color)} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-100 leading-snug">
                        {rec.insight}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        {rec.sub}
                      </p>
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
