import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { decryptIntegrationCredentials } from "@leadvirt/integrations";
import { prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramBotApiService } from "../../apps/api/src/modules/telegram/telegram-bot-api.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

loadEnvFile();
process.env.API_URL = "https://leadvirt.test";
process.env.TELEGRAM_WEBHOOK_BASE_URL = "https://telegram-gateway.test/telegram-webhook/";
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = "telegram-managed-connection-smoke";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextFor(tenant: RequestContext["tenant"], userId: string): RequestContext {
  return {
    tenantId: tenant.id,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user: {
      id: userId,
      email: `telegram-smoke-${tenant.id}@leadvirt.ai`,
      phone: null,
      name: "Telegram Smoke",
      avatarUrl: null,
      passwordChangeRequired: false,
    },
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const botToken = "987654321:AA-managed-connection-token";
  const replacementToken = "987654322:AA-replacement-connection-token";
  let tenantId: string | null = null;
  let userId: string | null = null;
  let webhookUrl = "";
  let webhookSecret = "";
  let deleteCalls = 0;

  const botApi = {
    getMe: async (token: string) => ({
      id: token === replacementToken ? 987654322 : 987654321,
      is_bot: true,
      first_name: "Client Magic",
      username: token === replacementToken ? "replacement_magic_bot" : "client_magic_bot",
    }),
    setWebhook: async (input: { url: string; secretToken: string }) => {
      webhookUrl = input.url;
      webhookSecret = input.secretToken;
      return true;
    },
    getWebhookInfo: async () => ({ url: webhookUrl, pending_update_count: 0 }),
    deleteWebhook: async () => {
      deleteCalls += 1;
      return true;
    },
  } as TelegramBotApiService;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Telegram Managed Connection Smoke",
        slug: `telegram-managed-${suffix}`,
        timezone: "Europe/Paris",
      },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { email: `telegram-managed-${suffix}@leadvirt.ai`, name: "Telegram Smoke" },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });

    const context = contextFor(tenant, user.id);
    const channels = new ChannelsService(prisma as unknown as PrismaService);
    const integrations = new IntegrationsService(
      prisma as unknown as PrismaService,
      channels,
      botApi,
      {} as TelegramService,
      {} as WebhookService,
    );

    const connected = await integrations.connect(context, "TELEGRAM", { botToken });
    assert(connected.status === "CONNECTED", "Telegram integration was not connected.");
    assert(
      connected.name.includes("@client_magic_bot"),
      "Bot username was not derived from getMe.",
    );
    assert(
      webhookUrl.startsWith("https://telegram-gateway.test/telegram-webhook/lvtg_") &&
        webhookUrl.endsWith("/webhook"),
      "Managed webhook relay URL was not registered.",
    );
    assert(webhookSecret.length >= 24, "Managed webhook secret was not generated.");
    assert(
      !JSON.stringify(connected).includes(botToken),
      "Integration response leaked the bot token.",
    );
    assert(
      !JSON.stringify(connected).includes(webhookSecret),
      "Integration response leaked the webhook secret.",
    );

    const channel = await prisma.channel.findFirst({
      where: { tenantId: tenant.id, type: "TELEGRAM", deletedAt: null },
    });
    assert(channel?.status === "ACTIVE", "Telegram channel was not activated.");
    assert(channel.externalId === "987654321", "Telegram bot id was not stored.");
    assert(Boolean(channel.encryptedCredentials), "Telegram credentials were not stored.");
    assert(
      !channel.encryptedCredentials!.includes(botToken),
      "Stored credentials contain the raw bot token.",
    );
    assert(
      decryptIntegrationCredentials(channel.encryptedCredentials!).botToken === botToken,
      "Stored Telegram credentials could not be decrypted.",
    );
    assert(
      !JSON.stringify(await channels.list(context)).includes(webhookSecret),
      "Channel response leaked the Telegram webhook secret.",
    );

    const tested = await integrations.testConnection(context, "TELEGRAM");
    assert(tested.ok, "Managed Telegram connection check failed.");
    await integrations.connect(context, "TELEGRAM", {});
    assert(webhookUrl.length > 0, "Token-free reconnect did not reuse stored credentials.");

    const firstSecret = webhookSecret;
    const replaced = await integrations.connect(context, "TELEGRAM", {
      botToken: replacementToken,
    });
    assert(replaced.name.includes("@replacement_magic_bot"), "Replacement bot was not connected.");
    assert(webhookSecret !== firstSecret, "Replacing a bot did not rotate the webhook secret.");
    assert(deleteCalls === 1, "Replacing a bot did not remove the previous webhook.");

    const disconnected = await integrations.disconnect(context, "TELEGRAM");
    assert(disconnected.status === "DISCONNECTED", "Telegram integration was not disconnected.");
    assert(deleteCalls === 2, "Telegram deleteWebhook lifecycle calls were incomplete.");
    const disabledChannel = await prisma.channel.findUnique({ where: { id: channel.id } });
    assert(disabledChannel?.status === "DISABLED", "Telegram channel was not disabled.");

    console.log("Telegram managed connection smoke: 21/21 checks passed");
  } finally {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main();
