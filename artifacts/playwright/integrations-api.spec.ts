import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

function integration(provider: string, status: "CONNECTED" | "DISCONNECTED") {
  const inboundEndpoint =
    provider === "TELEGRAM"
      ? {
          channelType: "TELEGRAM",
          publicKey: "demo-telegram-webhook",
          endpointPath: "/api/public/channels/telegram/demo-telegram-webhook/webhook",
          secretHeader: "x-telegram-bot-api-secret-token",
          samplePayload: {
            update_id: 88001,
            message: {
              text: "I want to book an appointment from Telegram",
            },
          },
        }
      : provider === "WEBHOOK_API"
        ? {
            channelType: "WEBHOOK",
            publicKey: "demo-generic-webhook",
            endpointPath: "/api/public/channels/webhook/demo-generic-webhook/events",
            secretHeader: "x-leadvirt-webhook-secret",
            samplePayload: {
              eventId: "leadvirt-sample-event",
              message: {
                text: "I want a quote from webhook",
              },
            },
          }
        : null;

  return {
    id: `integration-${provider.toLowerCase()}`,
    tenantId: "tenant-demo",
    provider,
    status,
    name: provider === "RETAILCRM" ? "RetailCRM" : provider,
    category: provider === "RETAILCRM" ? "CRM" : "Channels",
    settings: {},
    connectedAt: status === "CONNECTED" ? "2026-06-22T10:00:00.000Z" : null,
    lastSyncAt: status === "CONNECTED" ? "2026-06-22T10:00:00.000Z" : null,
    inboundEndpoint,
    recentSyncLogs: [],
    recentWebhookEvents: inboundEndpoint
      ? [
          {
            id: `event-${provider.toLowerCase()}`,
            provider: provider === "TELEGRAM" ? "telegram" : "webhook:channel-webhook",
            externalEventId: `${provider.toLowerCase()}-latest-event`,
            status: "PROCESSED",
            receivedAt: "2026-06-22T11:30:00.000Z",
            processedAt: "2026-06-22T11:30:01.000Z",
          },
        ]
      : [],
  };
}

function channel(type: string, publicKey: string) {
  return {
    id: `channel-${type.toLowerCase()}`,
    tenantId: "tenant-demo",
    type,
    status: "ACTIVE",
    name: type === "WEBSITE" ? "Website widget" : type,
    publicKey,
    settings:
      type === "WEBHOOK"
        ? {
            webhook: {
              publicKey,
              secret: "demo-webhook-secret",
              acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"],
            },
          }
        : {},
    lastHealthAt: "2026-06-22T12:00:00.000Z",
  };
}

test("integrations page starts empty when API returns no tenant integrations", async ({ page }) => {
  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("integrations-stat-connected")).toContainText(/^0/);
  await expect(page.getByTestId("integrations-stat-active-channels")).toContainText(/^0/);
  await expect(page.getByTestId("pilot-readiness-panel")).toContainText("0/3");
});

test("integrations page connects and disconnects through provider API", async ({ page }) => {
  let connectedProvider = "";
  let disconnectedProvider = "";
  const sampledProviders: string[] = [];
  let savedSettings: unknown = null;

  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            ...integration("AMOCRM", "CONNECTED"),
            settings: {
              displayName: "amoCRM main",
              endpointUrl: "https://old.example.test/hook",
              apiToken: "old-token",
              syncMode: "leads-to-service",
              syncEnabled: true,
              notes: "Old note",
            },
          },
          integration("RETAILCRM", "DISCONNECTED"),
          integration("TELEGRAM", "CONNECTED"),
          integration("WEBHOOK_API", "CONNECTED"),
        ],
      },
    });
  });

  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        data: [
          channel("WEBSITE", "demo-website-widget"),
          channel("TELEGRAM", "demo-telegram-webhook"),
          channel("WEBHOOK", "demo-generic-webhook"),
        ],
      },
    });
  });

  await page.route("**/api/integrations/RETAILCRM/connect", async (route) => {
    connectedProvider = "RETAILCRM";
    await route.fulfill({ json: { data: integration("RETAILCRM", "CONNECTED") } });
  });

  await page.route("**/api/integrations/RETAILCRM/disconnect", async (route) => {
    disconnectedProvider = "RETAILCRM";
    await route.fulfill({ json: { data: integration("RETAILCRM", "DISCONNECTED") } });
  });

  await page.route("**/api/integrations/AMOCRM/settings", async (route) => {
    savedSettings = await route.request().postDataJSON();
    await route.fulfill({
      json: {
        data: {
          ...integration("AMOCRM", "CONNECTED"),
          settings: (savedSettings as { settings?: unknown }).settings ?? {},
        },
      },
    });
  });

  await page.route("**/api/integrations/TELEGRAM/sample-inbound", async (route) => {
    sampledProviders.push("TELEGRAM");
    await route.fulfill({
      json: {
        data: {
          ok: true,
          provider: "TELEGRAM",
          integrationId: "integration-telegram",
          duplicate: false,
          conversationId: "conversation-telegram-sample",
          leadId: "lead-telegram-sample",
          inboundMessageId: "message-telegram-sample",
          aiMessageId: null,
          outboundStatus: "queued",
          reply: null,
          integration: integration("TELEGRAM", "CONNECTED"),
        },
      },
    });
  });

  await page.route("**/api/integrations/WEBHOOK_API/sample-inbound", async (route) => {
    sampledProviders.push("WEBHOOK_API");
    await route.fulfill({
      json: {
        data: {
          ok: true,
          provider: "WEBHOOK_API",
          integrationId: "integration-webhook_api",
          duplicate: false,
          conversationId: "conversation-webhook-sample",
          leadId: "lead-webhook-sample",
          inboundMessageId: "message-webhook-sample",
          aiMessageId: null,
          outboundStatus: "queued",
          reply: null,
          integration: integration("WEBHOOK_API", "CONNECTED"),
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("pilot-readiness-panel")).toContainText("3/3");
  await expect(page.getByTestId("pilot-readiness-telegram")).toContainText("demo-telegram-webhook");
  await expect(page.getByTestId("pilot-readiness-webhook")).toContainText("demo-generic-webhook");
  await expect(page.getByTestId("pilot-readiness-widget")).toContainText("demo-website-widget");
  await expect(page.getByTestId("pilot-readiness-widget-open")).toHaveAttribute(
    "href",
    "/widget/demo",
  );
  await expect(page.getByTestId("api-webhook-endpoint")).toContainText(
    "http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events",
  );
  await expect(page.getByTestId("api-webhook-publicKey")).toContainText("demo-generic-webhook");
  await expect(page.getByTestId("api-webhook-secretHeader")).toContainText(
    "x-leadvirt-webhook-secret",
  );
  await expect(page.getByTestId("api-webhook-payload")).toContainText("leadvirt-sample-event");
  await expect(page.getByTestId("api-webhook-status")).toContainText("Webhook/API готов");
  await expect(page.getByTestId("integration-card-instagram")).toContainText(
    "Подключение по запросу",
  );
  await expect(
    page.getByTestId("integration-card-instagram").getByRole("button", {
      name: "Подключение по запросу",
    }),
  ).toBeDisabled();
  await expect(page.getByTestId("integration-card-whatsapp")).toContainText(
    "Подключение по запросу",
  );
  await expect(page.getByTestId("integration-card-vk")).toContainText("Скоро будет");
  await expect(page.getByText("sk-admin")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Открыть API ключи" })).toHaveAttribute(
    "href",
    "/app/settings?tab=api",
  );
  await page.getByTestId("pilot-readiness-telegram-sample").click();
  await expect.poll(() => sampledProviders).toContain("TELEGRAM");
  await page.getByTestId("pilot-readiness-webhook-sample").click();
  await expect.poll(() => sampledProviders).toContain("WEBHOOK_API");
  const apiCardWebhookSamples = sampledProviders.filter(
    (provider) => provider === "WEBHOOK_API",
  ).length;
  await page.getByTestId("api-webhook-sample").click();
  await expect
    .poll(() => sampledProviders.filter((provider) => provider === "WEBHOOK_API").length)
    .toBe(apiCardWebhookSamples + 1);

  const amoCard = page.locator(".group").filter({ hasText: "amoCRM" }).first();
  await amoCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /^Настроить$/ }).click();
  await expect(page.getByRole("dialog", { name: /amoCRM: настройки/ })).toBeVisible();
  await page.getByLabel("Название подключения").fill("amoCRM production");
  await page.getByLabel("Endpoint URL").fill("https://crm.example.test/webhook");
  await page.getByLabel("API token").fill("secret-token-42");
  await page.getByLabel("Синхронизация включена").click();
  await page.getByLabel("Заметки").fill("Production CRM account");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect
    .poll(
      () =>
        (savedSettings as { settings?: { displayName?: string } } | null)?.settings?.displayName,
    )
    .toBe("amoCRM production");
  await expect
    .poll(
      () =>
        (savedSettings as { settings?: { endpointUrl?: string } } | null)?.settings?.endpointUrl,
    )
    .toBe("https://crm.example.test/webhook");
  await expect
    .poll(() => (savedSettings as { settings?: { apiToken?: string } } | null)?.settings?.apiToken)
    .toBe("secret-token-42");
  await expect
    .poll(
      () =>
        (savedSettings as { settings?: { syncEnabled?: boolean } } | null)?.settings?.syncEnabled,
    )
    .toBe(false);
  await expect
    .poll(() => (savedSettings as { settings?: { notes?: string } } | null)?.settings?.notes)
    .toBe("Production CRM account");
  await expect
    .poll(
      () =>
        (savedSettings as { settings?: { ui?: { configuredFrom?: string } } } | null)?.settings?.ui
          ?.configuredFrom,
    )
    .toBe("integrations-page");
  await expect(page.getByRole("dialog", { name: /amoCRM: настройки/ })).toBeHidden();

  const telegramCard = page.locator(".group").filter({ hasText: "Telegram" }).first();
  await telegramCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /^Настроить$/ }).click();
  const telegramDialog = page.getByRole("dialog", { name: /Telegram: настройки/ });
  await expect(telegramDialog).toBeVisible();
  await expect(telegramDialog.getByText("Публичный входящий endpoint")).toBeVisible();
  await expect(
    telegramDialog.getByText(
      "http://localhost:4001/api/public/channels/telegram/demo-telegram-webhook/webhook",
    ),
  ).toBeVisible();
  await expect(telegramDialog.getByText("demo-telegram-webhook", { exact: true })).toBeVisible();
  await expect(telegramDialog.getByText("x-telegram-bot-api-secret-token")).toBeVisible();
  await expect(
    telegramDialog.getByText("I want to book an appointment from Telegram"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(telegramDialog).toBeHidden();

  const webhookCard = page.locator(".group").filter({ hasText: "Webhook / API" }).first();
  await webhookCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /^Настроить$/ }).click();
  const webhookDialog = page.getByRole("dialog", { name: /Webhook \/ API: настройки/ });
  await expect(webhookDialog).toBeVisible();
  await expect(webhookDialog.getByText("http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events")).toBeVisible();
  await expect(webhookDialog.getByText("demo-generic-webhook", { exact: true })).toBeVisible();
  await expect(webhookDialog.getByText("x-leadvirt-webhook-secret")).toBeVisible();
  await expect(webhookDialog.getByLabel("Endpoint URL")).toHaveValue("");
  const modalWebhookSamples = sampledProviders.filter(
    (provider) => provider === "WEBHOOK_API",
  ).length;
  await webhookDialog.getByTestId("webhook-settings-sample").click();
  await expect
    .poll(() => sampledProviders.filter((provider) => provider === "WEBHOOK_API").length)
    .toBe(modalWebhookSamples + 1);
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(webhookDialog).toBeHidden();

  const retailCard = page.locator(".group").filter({ hasText: "RetailCRM" }).first();
  await expect(retailCard.getByRole("button", { name: /Подключить/ })).toBeVisible();

  await retailCard.getByRole("button", { name: /Подключить/ }).click();
  await expect.poll(() => connectedProvider).toBe("RETAILCRM");
  await expect(retailCard.getByText("Подключено")).toBeVisible();

  await retailCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /Отключить/ }).click();
  await page.getByRole("button", { name: "Отключить" }).click();

  await expect.poll(() => disconnectedProvider).toBe("RETAILCRM");
  await expect(retailCard.getByRole("button", { name: /Подключить/ })).toBeVisible();
});
