import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { AnalyticsService } from "../../apps/api/src/modules/analytics/analytics.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { email: `analytics-truth-${suffix}@example.test`, name: "Analytics Truth Owner" },
  });
  const tenant = await prisma.tenant.create({
    data: { name: "Analytics Truth Smoke", slug: `analytics-truth-${suffix}` },
  });

  try {
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "Measured lead",
        channelType: "WEBSITE",
        status: "QUALIFIED",
        valueAmount: 12500,
      },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, leadId: lead.id, status: "OPEN" },
    });
    const inboundAt = new Date(Date.now() - 120_000);
    await prisma.message.createMany({
      data: [
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          text: "I need details",
          createdAt: inboundAt,
        },
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          senderType: "USER",
          text: "Here are the measured details",
          createdAt: new Date(inboundAt.getTime() + 30_000),
        },
      ],
    });
    const workflow = await prisma.workflow.create({
      data: { tenantId: tenant.id, name: "Measured workflow", status: "ACTIVE" },
    });
    await prisma.workflowRun.create({
      data: {
        tenantId: tenant.id,
        workflowId: workflow.id,
        status: "COMPLETED",
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(),
      },
    });

    const context: RequestContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user,
    };
    const overview = await new AnalyticsService(prisma as never).overview(context);

    assert(overview.leadsByChannel.length === 1, "Analytics smoke did not create lead signals.");
    assert(overview.conversionByScenario[0]?.runs === 1, "Analytics smoke did not create workflow signals.");
    assert(overview.responseTime.averageSeconds === 30, "Analytics smoke did not create response signals.");
    assert(overview.aiInsightCodes?.length === 0, "Analytics invented recommendations from generic signals.");

    console.log("Analytics recommendation truthfulness smoke passed.");
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
