import { expect, test, type Page } from "@playwright/test";
import { messages } from "../../apps/web/src/i18n/messages";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

async function selectLocale(page: Page, locale: string) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  await switcher.click();
  await page.getByTestId(`language-option-${locale}`).click();
  await expect(switcher).toHaveAttribute("data-locale", locale);
}

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" },
  ]);
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("integrations-stat-connected")).toContainText(/^0/);
  await expect(page.getByTestId("integrations-stat-available")).toContainText(/^2/);
  await expect(page.getByTestId("integrations-stat-active-channels")).toContainText(/^0/);
  await expect(page.getByTestId("pilot-readiness-panel")).toContainText("0/3");
  await expect(page.getByTestId("integration-card-telegram")).toBeVisible();
  await expect(page.getByTestId("integration-card-webhook")).toBeVisible();
  await expect(page.getByTestId("integration-card-amocrm")).not.toBeVisible();
  await expect(page.getByTestId("pilot-readiness-panel").locator("code")).toHaveCount(0);
  await expect(page.getByTestId("integrations-planned")).not.toHaveAttribute("open", "");

  const webhookCard = await page.getByTestId("integration-card-webhook").boundingBox();
  const readinessPanel = await page.getByTestId("pilot-readiness-panel").boundingBox();
  expect(webhookCard).not.toBeNull();
  expect(readinessPanel).not.toBeNull();
  expect(webhookCard!.y).toBeLessThan(readinessPanel!.y);
});

test("integration resource failures retry instead of appearing disconnected", async ({ page }) => {
  let failLoad = true;

  await page.route("**/api/integrations", async (route) => {
    if (failLoad) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/channels", async (route) => {
    if (failLoad) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: [] } });
  });

  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("integrations-load-error")).toBeVisible();
  await expect(page.getByTestId("integrations-stat-connected")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/playwright/integrations-load-error.png",
    fullPage: true,
    animations: "disabled",
  });

  failLoad = false;
  await page.getByTestId("integrations-load-error").getByRole("button").click();

  await expect(page.getByTestId("integrations-load-error")).toHaveCount(0);
  await expect(page.getByTestId("integrations-stat-connected")).toContainText(/^0/);
  await expect(page.getByTestId("pilot-readiness-panel")).toContainText("0/3");
});

test("ambiguous managed request delivery requires review without a duplicate action", async ({
  page,
}) => {
  let deliveryUnknown = false;
  let requestAttempts = 0;
  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({
      json: {
        data: deliveryUnknown
          ? [
              {
                ...integration("INSTAGRAM", "DISCONNECTED"),
                settings: {
                  requestStatus: "DELIVERY_UNKNOWN",
                  requestDeliveryStatus: "UNKNOWN",
                },
              },
            ]
          : [],
      },
    });
  });
  await page.route("**/api/integrations/INSTAGRAM/request", async (route) => {
    requestAttempts += 1;
    deliveryUnknown = true;
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "INTEGRATION_REQUEST_DELIVERY_UNKNOWN",
          message: "Delivery could not be confirmed.",
          retryable: false,
        },
      },
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });
  await selectLocale(page, "en");
  await page.getByTestId("integrations-planned-toggle").click();

  const card = page.getByTestId("integration-card-instagram");
  await card.getByRole("button", { name: "Connect by request", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Instagram: settings" });
  await dialog.getByTestId("integration-request-submit").click();
  await expect.poll(() => requestAttempts).toBe(1);
  await expect(dialog.getByTestId("integration-request-status")).toContainText(
    "LeadVirt will not send a duplicate automatically",
  );
  await expect(dialog.getByTestId("integration-request-submit")).toHaveCount(0);
  await expect(dialog).not.toContainText("The request could not be sent. Try again.");
});

test("pending managed request stays pending instead of showing a sent confirmation", async ({
  page,
}) => {
  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            ...integration("WHATSAPP_BUSINESS", "DISCONNECTED"),
            settings: {
              requestStatus: "REQUESTED",
              requestDeliveryStatus: "PENDING",
              requestedAt: "2026-07-18T10:00:00.000Z",
            },
          },
        ],
      },
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });
  await selectLocale(page, "en");
  await page.getByTestId("integrations-planned-toggle").click();

  const card = page.getByTestId("integration-card-whatsapp");
  await expect(card).toContainText("Sending request...");
  await expect(card).not.toContainText("Request sent");
  await card.getByRole("button", { name: "Sending request...", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "WhatsApp Business: settings" });
  await expect(dialog.getByTestId("integration-request-status")).toHaveText("Sending request...");
  await expect(dialog.getByTestId("integration-request-submit")).toBeDisabled();
  await expect(dialog).not.toContainText("Request sent. Our team will contact you");
});

test("managed requests direct users without a reachable contact to add one", async ({ page }) => {
  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/integrations/WHATSAPP_BUSINESS/request", async (route) => {
    await route.fulfill({
      status: 400,
      json: {
        error: {
          code: "INTEGRATION_REQUEST_CONTACT_REQUIRED",
          message: "A reachable requester contact is required.",
          retryable: false,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });
  await selectLocale(page, "en");
  await page.getByTestId("integrations-planned-toggle").click();
  const card = page.getByTestId("integration-card-whatsapp");
  await card.getByRole("button", { name: "Connect by request", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "WhatsApp Business: settings" });
  await dialog.getByTestId("integration-request-submit").click();
  await expect(dialog.getByTestId("integration-request-status")).toContainText(
    "Add a reachable phone number in Settings",
  );
  await expect(dialog.getByTestId("integration-request-submit")).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Add contact", exact: true })).toHaveAttribute(
    "href",
    "/app/settings?tab=profile",
  );
});

test("Telegram connects from one bot token while LeadVirt manages webhook security", async ({
  page,
}) => {
  let connectBody: unknown = null;
  let channelRequests = 0;
  let failChannelRefresh = false;
  await page.route("**/api/integrations", async (route) => {
    await route.fulfill({ json: { data: [integration("TELEGRAM", "DISCONNECTED")] } });
  });
  await page.route("**/api/channels", async (route) => {
    channelRequests += 1;
    if (failChannelRefresh) {
      await route.fulfill({
        status: 503,
        json: { error: { message: "Temporary refresh outage" } },
      });
    } else {
      await route.fulfill({ json: { data: [channel("WEBSITE", "retained-widget-key")] } });
    }
  });
  await page.route("**/api/integrations/TELEGRAM/connect", async (route) => {
    connectBody = await route.request().postDataJSON();
    failChannelRefresh = true;
    await route.fulfill({
      json: {
        data: {
          ...integration("TELEGRAM", "CONNECTED"),
          name: "Telegram @client_magic_bot",
          settings: {
            botId: "987654321",
            botUsername: "client_magic_bot",
            tokenConfigured: true,
            webhookConfigured: true,
            managedByLeadVirt: true,
          },
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/integrations`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");
  await page
    .getByTestId("integration-card-telegram")
    .getByRole("button", { name: "Подключить" })
    .click();

  const dialog = page.getByRole("dialog", { name: "Подключить Telegram" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input")).toHaveCount(1);
  await expect(dialog.getByText("Webhook secret token")).toHaveCount(0);
  await expect(dialog.getByText("Allowed updates")).toHaveCount(0);
  await dialog.screenshot({
    path: "artifacts/playwright/telegram-magic-connect-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({
    path: "artifacts/playwright/telegram-magic-connect-mobile.png",
  });

  await page.getByTestId("telegram-bot-token").fill("987654321:AA-client-token");
  await page.getByTestId("telegram-connect-submit").click();
  await expect.poll(() => connectBody).toEqual({ botToken: "987654321:AA-client-token" });
  await expect.poll(() => channelRequests).toBeGreaterThan(1);
  const connectedDialog = page.getByRole("dialog", { name: "Telegram @client_magic_bot" });
  await expect(connectedDialog).toBeVisible();
  await expect(connectedDialog).toContainText("@client_magic_bot");
  await expect(page.getByTestId("telegram-bot-token")).toHaveValue("");
  await expect(connectedDialog.getByTestId("telegram-open-bot")).toHaveAttribute(
    "href",
    "https://t.me/client_magic_bot?start=leadvirt",
  );
  await expect(page.getByTestId("integration-card-telegram")).toContainText("Подключено");
  await expect(page.getByTestId("integrations-refresh-error")).toBeVisible();
  await expect(page.getByTestId("pilot-readiness-widget")).not.toContainText("retained-widget-key");

  await page.keyboard.press("Escape");
  await expect(connectedDialog).toBeHidden();
  await expect(page.getByTestId("telegram-card-open-bot")).toHaveAttribute(
    "href",
    "https://t.me/client_magic_bot?start=leadvirt",
  );
  await expect(page.getByTestId("telegram-card-open-bot")).toContainText("@client_magic_bot");
  await page.getByTestId("integration-card-telegram").screenshot({
    path: "artifacts/playwright/telegram-connected-card-mobile.png",
  });
  failChannelRefresh = false;
  await page.getByTestId("integrations-refresh-error").getByRole("button").click();
  await expect(page.getByTestId("integrations-refresh-error")).toHaveCount(0);
  await expect(page.getByTestId("pilot-readiness-widget")).not.toContainText("retained-widget-key");
});

test("integrations expose only live self-service controls and preserve channel workflows", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const sampledProviders: string[] = [];
  const testedProviders: string[] = [];
  const requestedProviders: string[] = [];
  const unavailableMutationRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/integrations\/(?:AMOCRM|BITRIX24|RETAILCRM|EMAIL|GOOGLE_CALENDAR)\//.test(
        request.url(),
      )
    ) {
      unavailableMutationRequests.push(request.url());
    }
  });

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
          {
            ...integration("EMAIL", "CONNECTED"),
            settings: { credentialsConfigured: true, host: "mail.example.test" },
          },
          {
            ...integration("GOOGLE_CALENDAR", "CONNECTED"),
            settings: { credentialsConfigured: true, calendarId: "primary" },
          },
          {
            ...integration("TELEGRAM", "CONNECTED"),
            name: "Telegram @demo_telegram_bot",
            settings: {
              botId: "123456789",
              botUsername: "demo_telegram_bot",
              tokenConfigured: true,
              webhookConfigured: true,
              managedByLeadVirt: true,
            },
          },
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

  await page.route("**/api/integrations/*/request", async (route) => {
    const provider = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    requestedProviders.push(provider);
    await route.fulfill({
      json: {
        data: {
          id: `request-${provider.toLowerCase()}`,
          provider,
          status: "REQUESTED",
          requestedAt: "2026-07-18T10:00:00.000Z",
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
          integration: {
            ...integration("TELEGRAM", "CONNECTED"),
            name: "Telegram @demo_telegram_bot",
            settings: {
              botId: "123456789",
              botUsername: "demo_telegram_bot",
              tokenConfigured: true,
              webhookConfigured: true,
              managedByLeadVirt: true,
            },
          },
        },
      },
    });
  });

  await page.route("**/api/integrations/TELEGRAM/test", async (route) => {
    testedProviders.push("TELEGRAM");
    await route.fulfill({
      json: {
        data: {
          ok: true,
          provider: "TELEGRAM",
          integrationId: "integration-telegram",
          status: "SUCCESS",
          message: "Telegram is connected and ready.",
          checkedAt: new Date().toISOString(),
          integration: {
            ...integration("TELEGRAM", "CONNECTED"),
            name: "Telegram @demo_telegram_bot",
            settings: {
              botId: "123456789",
              botUsername: "demo_telegram_bot",
              tokenConfigured: true,
              webhookConfigured: true,
              managedByLeadVirt: true,
            },
          },
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
  await selectLocale(page, "ru");

  const productShell = page.getByTestId("product-shell");
  await expect(productShell).toBeVisible();
  await expect(productShell.locator('[class*="backdrop-blur"]')).toHaveCount(0);
  await expect(productShell.locator('[class*="blur-"]')).toHaveCount(0);

  const pageWheelLatency = page.evaluate(
    () =>
      new Promise<{ latency: number; scrollTop: number }>((resolve) => {
        let wheelAt = 0;
        window.addEventListener("wheel", () => (wheelAt = performance.now()), {
          once: true,
          passive: true,
        });
        window.addEventListener(
          "scroll",
          () => resolve({ latency: performance.now() - wheelAt, scrollTop: window.scrollY }),
          { once: true, passive: true },
        );
      }),
  );
  await page.mouse.move(1200, 800);
  await page.mouse.wheel(0, 600);
  const pageWheelResult = await pageWheelLatency;
  expect(pageWheelResult.scrollTop).toBeGreaterThan(0);
  expect(pageWheelResult.latency).toBeLessThan(150);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));

  await expect(page.getByTestId("pilot-readiness-panel")).toContainText("3/3");
  await expect(page.getByTestId("pilot-readiness-telegram")).not.toContainText(
    "demo-telegram-webhook",
  );
  await expect(page.getByTestId("pilot-readiness-webhook")).not.toContainText(
    "demo-generic-webhook",
  );
  await expect(page.getByTestId("pilot-readiness-widget")).not.toContainText("demo-website-widget");
  await expect(page.getByTestId("pilot-readiness-widget-open")).toHaveAttribute(
    "href",
    "/widget/frame?key=demo-website-widget",
  );
  await expect(page.getByTestId("api-webhook-endpoint")).toContainText(
    "http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events",
  );
  await expect(page.getByTestId("api-webhook-publicKey")).toContainText("demo-generic-webhook");
  await expect(page.getByTestId("api-webhook-secretHeader")).toContainText(
    "x-leadvirt-webhook-secret",
  );
  await expect(page.getByTestId("api-webhook-payload")).toContainText("leadvirt-sample-event");
  await expect(page.getByTestId("api-webhook-status")).toContainText("Webhook готов");
  await page.getByTestId("integrations-planned-toggle").click();
  await expect(page.getByTestId("integration-card-instagram")).toContainText(
    "Подключение по запросу",
  );
  await page
    .getByTestId("integration-card-instagram")
    .getByRole("button", { name: "Подключение по запросу" })
    .click();
  const instagramDialog = page.getByRole("dialog", { name: /Instagram: настройки/ });
  await expect(instagramDialog).toBeVisible();
  await expect
    .poll(() => instagramDialog.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior))
    .toBe("auto");
  await instagramDialog.screenshot({
    path: "artifacts/playwright/integrations-provider-setup-instagram.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => instagramDialog.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(0);
  await instagramDialog.screenshot({
    path: "artifacts/playwright/integrations-provider-setup-instagram-mobile.png",
  });
  const modalWheelLatency = instagramDialog.evaluate(
    (element) =>
      new Promise<{ latency: number; scrollTop: number }>((resolve) => {
        let wheelAt = 0;
        element.addEventListener("wheel", () => (wheelAt = performance.now()), {
          once: true,
          passive: true,
        });
        element.addEventListener(
          "scroll",
          () => resolve({ latency: performance.now() - wheelAt, scrollTop: element.scrollTop }),
          { once: true, passive: true },
        );
      }),
  );
  await page.mouse.move(195, 700);
  await page.mouse.wheel(0, 400);
  const modalWheelResult = await modalWheelLatency;
  expect(modalWheelResult.scrollTop).toBeGreaterThan(0);
  expect(modalWheelResult.latency).toBeLessThan(150);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(instagramDialog).toContainText(
    messages.ru["integrations.field.instagramBusinessAccountId"],
  );
  await expect(instagramDialog).toContainText(messages.ru["integrations.setup.instagram.step1"]);
  await instagramDialog.getByTestId("integration-request-submit").click();
  await expect.poll(() => requestedProviders).toContain("INSTAGRAM");
  await expect(instagramDialog.getByTestId("integration-request-status")).toContainText(
    "Заявка отправлена",
  );
  await expect(instagramDialog.getByTestId("integration-request-submit")).toBeDisabled();
  await instagramDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(instagramDialog).toBeHidden();
  await expect(page.getByTestId("integration-card-instagram")).toContainText("Заявка отправлена");
  await expect(page.getByTestId("integration-card-whatsapp")).toContainText(
    "Подключение по запросу",
  );
  await page
    .getByTestId("integration-card-whatsapp")
    .getByRole("button", { name: "Подключение по запросу" })
    .click();
  const whatsappDialog = page.getByRole("dialog", { name: /WhatsApp Business: настройки/ });
  await expect(whatsappDialog).toBeVisible();
  await expect(whatsappDialog).toContainText(messages.ru["integrations.field.phoneNumberId"]);
  await expect(whatsappDialog).toContainText(messages.ru["integrations.field.wabaId"]);
  await whatsappDialog.getByTestId("integration-request-submit").click();
  await expect.poll(() => requestedProviders).toContain("WHATSAPP_BUSINESS");
  await expect(whatsappDialog.getByTestId("integration-request-status")).toContainText(
    "Заявка отправлена",
  );
  await whatsappDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(whatsappDialog).toBeHidden();
  await expect(page.getByTestId("integration-card-vk")).toContainText("Скоро будет");
  await page
    .getByTestId("integration-card-vk")
    .getByRole("button", { name: "Скоро будет" })
    .click();
  const vkDialog = page.getByRole("dialog", { name: /VK: настройки/ });
  await expect(vkDialog).toBeVisible();
  await expect(vkDialog).toContainText(messages.ru["integrations.field.communityToken"]);
  await vkDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(vkDialog).toBeHidden();
  await page
    .getByTestId("integration-card-shopify")
    .getByRole("button", { name: "Скоро будет" })
    .click();
  const shopifyDialog = page.getByRole("dialog", { name: /Shopify: настройки/ });
  await expect(shopifyDialog).toBeVisible();
  await expect(shopifyDialog).toContainText(messages.ru["integrations.field.adminApiAccessToken"]);
  await shopifyDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(shopifyDialog).toBeHidden();
  await page
    .getByTestId("integration-card-shopscript")
    .getByRole("button", { name: "Скоро будет" })
    .click();
  const shopScriptDialog = page.getByRole("dialog", { name: /Shop-Script: настройки/ });
  await expect(shopScriptDialog).toBeVisible();
  await expect(shopScriptDialog).toContainText(
    messages.ru["integrations.field.webasystInstallationUrl"],
  );
  await shopScriptDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(shopScriptDialog).toBeHidden();
  await expect(page.getByText("sk-admin")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Входящий webhook" })).toBeVisible();
  await expect(page.locator('a[href="/app/settings?tab=api"]')).toHaveCount(0);
  await expect(page.getByText("Открыть API ключи")).toHaveCount(0);
  await page.getByTestId("pilot-readiness-telegram-health").click();
  await expect.poll(() => testedProviders).toContain("TELEGRAM");
  expect(sampledProviders).not.toContain("TELEGRAM");
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
  await expect(amoCard).toContainText("Скоро будет");
  await expect(amoCard.getByText("Подключено")).toHaveCount(0);
  await expect(amoCard.getByRole("button", { name: /Подключить|Настроить/ })).toHaveCount(0);
  await amoCard.getByRole("button", { name: "Скоро будет" }).click();
  const amoDialog = page.getByRole("dialog", { name: /amoCRM: настройки/ });
  await expect(amoDialog).toBeVisible();
  await expect(amoDialog.locator("input, textarea, [role='switch']")).toHaveCount(0);
  await amoDialog.screenshot({ path: "artifacts/playwright/integrations-crm-unavailable.png" });
  await expect(
    amoDialog.getByRole("button", { name: /Сохранить|Подключить|Отключить/ }),
  ).toHaveCount(0);
  await amoDialog.getByRole("button", { name: "Закрыть", exact: true }).click();

  const telegramCard = page.locator(".group").filter({ hasText: "Telegram" }).first();
  await telegramCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /^Настроить$/ }).click();
  const telegramDialog = page.getByRole("dialog", { name: "Telegram @demo_telegram_bot" });
  await expect(telegramDialog).toBeVisible();
  await expect(telegramDialog.getByText("Бот подключён")).toBeVisible();
  await expect(
    telegramDialog.getByText("@demo_telegram_bot управляется LeadVirt.ai"),
  ).toBeVisible();
  await expect(telegramDialog.getByTestId("telegram-open-bot")).toHaveAttribute(
    "href",
    "https://t.me/demo_telegram_bot?start=leadvirt",
  );
  await telegramDialog.screenshot({
    path: "artifacts/playwright/telegram-connected-bot-cta.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => telegramDialog.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBe(0);
  await telegramDialog.screenshot({
    path: "artifacts/playwright/telegram-connected-bot-cta-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(telegramDialog.getByText("Webhook secret token")).toHaveCount(0);
  await expect(telegramDialog.getByText("x-telegram-bot-api-secret-token")).toHaveCount(0);
  await telegramDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(telegramDialog).toBeHidden();

  const webhookCard = page.getByTestId("integration-card-webhook");
  await webhookCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /^Настроить$/ }).click();
  const webhookDialog = page.getByRole("dialog", { name: /Webhook: настройки/ });
  await expect(webhookDialog).toBeVisible();
  await expect(
    webhookDialog.getByText(
      "http://localhost:4001/api/public/channels/webhook/demo-generic-webhook/events",
    ),
  ).toBeVisible();
  await expect(webhookDialog.getByText("demo-generic-webhook", { exact: true })).toBeVisible();
  await expect(webhookDialog.getByText("x-leadvirt-webhook-secret")).toBeVisible();
  await expect(webhookDialog.locator("input, textarea, [role='switch']")).toHaveCount(0);
  await expect(webhookDialog.getByTestId("webhook-settings-authority")).toBeVisible();
  await expect(
    webhookDialog.getByRole("link", { name: "Открыть настройки канала" }),
  ).toHaveAttribute("href", "/app/settings?tab=channels");
  const modalWebhookSamples = sampledProviders.filter(
    (provider) => provider === "WEBHOOK_API",
  ).length;
  await webhookDialog.getByTestId("webhook-settings-sample").click();
  await expect
    .poll(() => sampledProviders.filter((provider) => provider === "WEBHOOK_API").length)
    .toBe(modalWebhookSamples + 1);
  await webhookDialog.screenshot({
    path: "artifacts/playwright/integrations-webhook-authoritative-settings.png",
  });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(webhookDialog).toBeHidden();

  const retailCard = page.locator(".group").filter({ hasText: "RetailCRM" }).first();
  await expect(retailCard).toContainText("Скоро будет");
  await expect(retailCard.getByRole("button", { name: /Подключить|Настроить/ })).toHaveCount(0);
  await retailCard.getByRole("button", { name: "Скоро будет" }).click();
  const retailDialog = page.getByRole("dialog", { name: /RetailCRM: настройки/ });
  await expect(retailDialog).toBeVisible();
  await expect(retailDialog.locator("input, textarea, [role='switch']")).toHaveCount(0);
  await retailDialog.getByRole("button", { name: "Закрыть", exact: true }).click();

  const bitrixCard = page.getByTestId("integration-card-bitrix24");
  await expect(bitrixCard).toContainText("Скоро будет");
  await expect(bitrixCard.getByRole("button", { name: /Подключить|Настроить/ })).toHaveCount(0);
  for (const unavailable of [
    { id: "email", dialogName: /^Email:/ },
    { id: "gcalendar", dialogName: /^Google Calendar:/ },
  ]) {
    const card = page.getByTestId(`integration-card-${unavailable.id}`);
    await expect(card.getByRole("button")).toHaveCount(1);
    await card.getByRole("button").click();
    const dialog = page.getByRole("dialog", { name: unavailable.dialogName });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input, textarea, [role='switch']")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  expect(unavailableMutationRequests).toEqual([]);

  await webhookCard.getByRole("button", { name: /Настроить/ }).click();
  await page.getByRole("menuitem", { name: /^Настроить$/ }).click();
  await expect(webhookDialog).toBeVisible();
  await webhookDialog.getByRole("link", { name: "Открыть настройки канала" }).click();
  await expect(page).toHaveURL(`${webBase}/app/settings?tab=channels`);
  await expect(page.getByTestId("settings-channels-list")).toBeVisible();
});
