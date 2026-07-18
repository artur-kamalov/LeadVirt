import { Inject, Injectable } from "@nestjs/common";
import type { AnalyticsOverview } from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";

type AnalyticsPeriod = "7d" | "30d" | "quarter";

const convertedLeadStatuses = ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"] as const;

const periodDays: Record<AnalyticsPeriod, number> = {
  "7d": 7,
  "30d": 30,
  quarter: 90
};

function normalizePeriod(period: string | undefined): AnalyticsPeriod {
  return period === "7d" || period === "quarter" ? period : "30d";
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function bucketLabel(date: Date, period: AnalyticsPeriod) {
  if (period === "7d") {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
  }

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

function buildBuckets(start: Date, end: Date, period: AnalyticsPeriod) {
  const bucketCount = 7;
  const bucketMs = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketCount));

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + bucketMs * index);
    const bucketEnd = index === bucketCount - 1 ? end : new Date(start.getTime() + bucketMs * (index + 1));
    return {
      name: bucketLabel(bucketStart, period),
      start: bucketStart,
      end: bucketEnd
    };
  });
}

function isInRange(date: Date | null | undefined, start: Date, end: Date) {
  return Boolean(date && date >= start && date < end);
}

function responseTimeStats(
  messages: { conversationId: string; direction: string; senderType: string; createdAt: Date }[]
) {
  const pendingInboundByConversation = new Map<string, Date>();
  const samples: number[] = [];

  for (const message of messages) {
    if (message.direction === "INBOUND" && message.senderType === "CUSTOMER") {
      if (!pendingInboundByConversation.has(message.conversationId)) {
        pendingInboundByConversation.set(message.conversationId, message.createdAt);
      }
      continue;
    }

    if (message.direction === "OUTBOUND" && ["AI", "USER"].includes(message.senderType)) {
      const inboundAt = pendingInboundByConversation.get(message.conversationId);
      if (!inboundAt) continue;
      samples.push(Math.max(0, (message.createdAt.getTime() - inboundAt.getTime()) / 1000));
      pendingInboundByConversation.delete(message.conversationId);
    }
  }

  if (samples.length === 0) {
    return { averageSeconds: 0, p90Seconds: 0 };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const p90Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1);
  return {
    averageSeconds: Math.round(samples.reduce((sum, sample) => sum + sample, 0) / samples.length),
    p90Seconds: Math.round(sorted[p90Index] ?? sorted[sorted.length - 1] ?? 42)
  };
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview(context: RequestContext, options: { period?: string } = {}): Promise<AnalyticsOverview> {
    const period = normalizePeriod(options.period);
    const now = new Date();
    const periodStart = addDays(now, -periodDays[period]);
    const periodRange = { gte: periodStart, lt: now };

    const [leads, workflows, bookings, orders, messages] = await Promise.all([
      this.prisma.lead.findMany({
        where: { tenantId: context.tenantId, deletedAt: null, createdAt: periodRange },
        select: { channelType: true, status: true, valueAmount: true, bookedAt: true, createdAt: true }
      }),
      this.prisma.workflow.findMany({
        where: { tenantId: context.tenantId, deletedAt: null },
        include: { runs: { where: { createdAt: periodRange } } }
      }),
      this.prisma.booking.count({ where: { tenantId: context.tenantId, deletedAt: null, createdAt: periodRange } }),
      this.prisma.order.count({ where: { tenantId: context.tenantId, deletedAt: null, createdAt: periodRange } }),
      this.prisma.message.findMany({
        where: {
          tenantId: context.tenantId,
          createdAt: periodRange,
          senderType: { in: ["CUSTOMER", "AI", "USER"] }
        },
        orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
        select: { conversationId: true, direction: true, senderType: true, createdAt: true }
      })
    ]);

    const channelTypes = [...new Set(leads.map((lead) => lead.channelType).filter((item): item is NonNullable<typeof item> => item !== null))];
    const leadsByChannel = channelTypes.map((channelType) => {
      const channelLeads = leads.filter((lead) => lead.channelType === channelType);
      const converted = channelLeads.filter((lead) =>
        convertedLeadStatuses.includes(lead.status as (typeof convertedLeadStatuses)[number])
      ).length;
      return {
        channelType,
        leads: channelLeads.length,
        conversionRate: channelLeads.length > 0 ? roundOne((converted / channelLeads.length) * 100) : 0
      };
    });

    const buckets = buildBuckets(periodStart, now, period);
    const leadsOverTime = buckets.map((bucket) => {
      const bucketLeads = leads.filter((lead) => isInRange(lead.createdAt, bucket.start, bucket.end));
      return {
        name: bucket.name,
        leads: bucketLeads.length,
        booked: bucketLeads.filter((lead) =>
          isInRange(lead.bookedAt, bucket.start, bucket.end) || ["BOOKED", "ORDERED"].includes(lead.status)
        ).length
      };
    });
    const responseTime = responseTimeStats(messages);

    return {
      leadsOverTime,
      leadsByChannel,
      conversionByScenario: workflows.map((workflow) => ({
        scenario: workflow.name,
        conversionRate: 0,
        runs: workflow.runs.length
      })),
      responseTime,
      bookingsOrders: { bookings, orders },
      estimatedRevenue: leads.reduce((sum, lead) => sum + (lead.valueAmount ?? 0), 0),
      bestPerformingChannels: leadsByChannel
        .map((channel) => ({ channelType: channel.channelType, score: channel.conversionRate }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 3),
      aiInsightCodes: [],
    };
  }
}
