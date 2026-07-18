import { expect, test, type Page } from "@playwright/test";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import type { IntegrationTranslationKey } from "../../apps/web/src/i18n/integration-messages";
import { messages } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const fullyLocalizedLocales = ["es", "fr", "de", "pt"] as const satisfies readonly Locale[];
const representativeKeys = [
  "integrations.subtitle",
  "integrations.card.telegram",
  "integrations.setup.instagram.summary",
  "integrations.setup.instagram.step1",
  "integrations.readiness.title",
  "integrations.readiness.activeChannelNeeded",
  "integrations.toast.saveFailed",
] as const satisfies readonly IntegrationTranslationKey[];

function telegramAccount() {
  return {
    id: "integration-telegram-localized",
    tenantId: "tenant-integrations-localized",
    provider: "TELEGRAM",
    status: "CONNECTED",
    name: "Telegram @localized_bot",
    category: "Channels",
    settings: {
      botId: "123456789",
      botUsername: "localized_bot",
      tokenConfigured: true,
      webhookConfigured: true,
      managedByLeadVirt: true,
    },
    connectedAt: "2026-07-13T10:00:00.000Z",
    lastSyncAt: "2026-07-13T10:00:00.000Z",
    inboundEndpoint: {
      channelType: "TELEGRAM",
      publicKey: "localized-telegram-key",
      endpointPath: "/api/public/channels/telegram/localized-telegram-key/webhook",
      secretHeader: "x-telegram-bot-api-secret-token",
      samplePayload: { update_id: 1 },
    },
    recentSyncLogs: [],
    recentWebhookEvents: [],
  };
}

async function mockApis(page: Page, connectedTokens: string[]) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-integrations-localized",
          email: "owner@integrations.test",
          name: "Integrations Owner",
          tenantId: "tenant-integrations-localized",
          role: "OWNER",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route(/\/api\/current-tenant(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "tenant-integrations-localized",
          name: "Integrations Workspace",
          slug: "integrations-workspace",
          status: "TRIALING",
          role: "OWNER",
        },
      },
    });
  });
  await page.route(/\/api\/integrations(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route(/\/api\/channels(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "localized-website-channel",
            tenantId: "tenant-integrations-localized",
            type: "WEBSITE",
            status: "ACTIVE",
            name: "Localized website widget",
            publicKey: "localized-widget-key",
            lastHealthAt: "2026-07-13T10:00:00.000Z",
          },
        ],
      },
    });
  });
  await page.route("**/api/integrations/TELEGRAM/connect", async (route) => {
    const body = route.request().postDataJSON() as { botToken?: string };
    connectedTokens.push(body.botToken ?? "");
    await route.fulfill({ json: { data: telegramAccount() } });
  });
}

async function expectNoOverflow(page: Page, locator = page.locator("body")) {
  const widths = await locator.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client);
}

test("customer-facing integration copy does not fall back to English", () => {
  for (const locale of fullyLocalizedLocales) {
    for (const key of representativeKeys) {
      expect(messages[locale][key], `${locale}:${key}`).not.toBe(messages.en[key]);
    }
  }
});

test("Integrations and the one-token Telegram dialog render all six locales", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const connectedTokens: string[] = [];
  await mockApis(page, connectedTokens);
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const locale of supportedLocales) {
    await context.addCookies([
      { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
    ]);
    const localePage = locale === "en" ? page : await context.newPage();
    if (locale !== "en") await mockApis(localePage, connectedTokens);
    await localePage.setViewportSize({ width: 1440, height: 1000 });
    await localePage.goto(`${webBase}/app/integrations`, { waitUntil: "domcontentloaded" });
    await expect(
      localePage.locator('[data-testid="language-switcher"]:visible').first(),
    ).toHaveAttribute("data-locale", locale);
    await expect(
      localePage.getByRole("heading", { name: messages[locale]["integrations.title"] }).first(),
    ).toBeVisible();
    await expect(
      localePage.getByText(messages[locale]["integrations.subtitle"], { exact: true }),
    ).toBeVisible();
    await expect(
      localePage.getByRole("button", {
        name: messages[locale]["integrations.category.channels"],
        exact: true,
      }),
    ).toBeVisible();
    await expectNoOverflow(localePage);

    const readinessPanel = localePage.getByTestId("pilot-readiness-panel");
    await expect(readinessPanel).toContainText(messages[locale]["integrations.readiness.title"]);
    await expect(readinessPanel).toContainText(
      messages[locale]["integrations.readiness.activeChannelNeeded"],
    );
    const widgetTitle = messages[locale]["integrations.readiness.websiteWidget"];
    const widgetTile = localePage.getByTestId("pilot-readiness-widget");
    await expect(widgetTile).toContainText(widgetTitle);
    await expect(
      widgetTile.getByRole("link", {
        name: messages[locale]["integrations.openWidget"],
      }),
    ).toBeVisible();

    const card = localePage.getByTestId("integration-card-telegram");
    await expect(card).toContainText(messages[locale]["integrations.card.telegram"]);
    await card
      .getByRole("button", { name: messages[locale]["integrations.connect"], exact: true })
      .click();
    const dialog = localePage.getByRole("dialog", {
      name: messages[locale]["integrations.telegram.connect"],
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(messages[locale]["integrations.telegram.description"]);
    await expect(dialog).toContainText(messages[locale]["integrations.telegram.autoWebhook"]);
    await expect(
      dialog.getByRole("button", {
        name: messages[locale]["integrations.closeDialog"],
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.locator("input")).toHaveCount(1);
    await expect(dialog.getByText("Webhook secret token")).toHaveCount(0);
    await expectNoOverflow(localePage, dialog);
    await dialog
      .getByRole("button", { name: messages[locale]["integrations.cancel"], exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await localePage.getByTestId("integrations-planned-toggle").click();
    const instagramCard = localePage.getByTestId("integration-card-instagram");
    await instagramCard
      .getByRole("button", {
        name: messages[locale]["integrations.availability.request"],
        exact: true,
      })
      .click();
    const setupDialog = localePage.getByRole("dialog", {
      name: messages[locale]["integrations.settingsTitle"].replace("{name}", "Instagram"),
    });
    await expect(setupDialog).toContainText(
      messages[locale]["integrations.request.description"].replace("{name}", "Instagram"),
    );
    await expect(setupDialog).toContainText(messages[locale]["integrations.setup.instagram.step1"]);
    await expect(setupDialog).toContainText(messages[locale]["integrations.notSelfServe"]);
    await expect(
      setupDialog.getByRole("button", {
        name: messages[locale]["integrations.request.submit"],
        exact: true,
      }),
    ).toBeVisible();
    await expectNoOverflow(localePage, setupDialog);
    await setupDialog
      .getByRole("button", { name: messages[locale]["integrations.close"], exact: true })
      .click();
    await expect(setupDialog).toBeHidden();

    if (locale === "en") {
      await card
        .getByRole("button", { name: messages.en["integrations.connect"], exact: true })
        .click();
      await localePage.getByTestId("telegram-bot-token").fill("123456789:AA-localized-token");
      await localePage.getByTestId("telegram-connect-submit").click();
      await expect.poll(() => connectedTokens).toEqual(["123456789:AA-localized-token"]);
      await expect(card).toContainText(messages.en["integrations.connected"]);
    }

    if (locale !== "en") await localePage.close();
  }
});

for (const testCase of [
  { locale: "es" as Locale, width: 390, height: 844 },
  { locale: "fr" as Locale, width: 390, height: 844 },
  { locale: "de" as Locale, width: 390, height: 844 },
  { locale: "pt" as Locale, width: 390, height: 844 },
]) {
  test(`${testCase.locale} integrations and setup dialog avoid overflow at ${testCase.width}px`, async ({
    context,
    page,
  }) => {
    const connectedTokens: string[] = [];
    await mockApis(page, connectedTokens);
    await context.addCookies([
      { name: "leadvirt-locale", value: testCase.locale, url: webBase, sameSite: "Lax" },
    ]);
    await page.setViewportSize({ width: testCase.width, height: testCase.height });
    await page.goto(`${webBase}/app/integrations`, { waitUntil: "domcontentloaded" });
    await expectNoOverflow(page);

    await page.getByTestId("integrations-planned-toggle").click();
    const instagramCard = page.getByTestId("integration-card-instagram");
    await instagramCard
      .getByRole("button", {
        name: messages[testCase.locale]["integrations.availability.request"],
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: messages[testCase.locale]["integrations.settingsTitle"].replace("{name}", "Instagram"),
    });
    await expect(dialog).toBeVisible();
    await expectNoOverflow(page, dialog);
  });
}
