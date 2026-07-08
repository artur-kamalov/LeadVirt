import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextFor(
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
    businessType: string | null;
    timezone: string;
  },
  userId: string
): RequestContext {
  return {
    tenantId: tenant.id,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user: {
      id: userId,
      email: `integration-connect-${tenant.id}@leadvirt.ai`,
      phone: null,
      name: "Integration Connect Smoke",
      avatarUrl: null,
      passwordChangeRequired: false
    }
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  let userId: string | null = null;
  const service = new IntegrationsService(
    prisma as unknown as PrismaService,
    {} as TelegramService,
    {} as WebhookService
  );

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Integration Connect Smoke",
        slug: `integration-connect-smoke-${suffix}`,
        timezone: "Europe/Moscow"
      }
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        email: `integration-connect-${suffix}@leadvirt.ai`,
        name: "Integration Connect Smoke"
      }
    });
    userId = user.id;

    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" }
    });

    const before = await prisma.integrationAccount.findFirst({
      where: { tenantId: tenant.id, provider: "INSTAGRAM", deletedAt: null }
    });
    assert(!before, "Smoke tenant unexpectedly has an Instagram integration.");

    const connected = await service.connect(contextFor(tenant, user.id), "INSTAGRAM");
    assert(connected.provider === "INSTAGRAM", "Connected provider mismatch.");
    assert(connected.status === "CONNECTED", "Missing Instagram integration was not connected.");
    assert(connected.name === "Instagram", "Created Instagram integration name mismatch.");

    const stored = await prisma.integrationAccount.findFirst({
      where: { tenantId: tenant.id, provider: "INSTAGRAM", deletedAt: null }
    });
    assert(stored?.status === "CONNECTED", "Created Instagram integration was not stored as connected.");

    console.log(JSON.stringify({ ok: true, tenantId: tenant.id, integrationId: connected.id }));
  } finally {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
