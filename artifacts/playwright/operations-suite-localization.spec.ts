import { expect, test, type Page } from "@playwright/test";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import { messages } from "../../apps/web/src/i18n/messages";
import { operationsSuiteMessages } from "../../apps/web/src/i18n/operations-suite-messages";
import { deOperationsSuiteOverrides } from "../../apps/web/src/i18n/operations-suite-translations/de";
import { esOperationsSuiteOverrides } from "../../apps/web/src/i18n/operations-suite-translations/es";
import { frOperationsSuiteOverrides } from "../../apps/web/src/i18n/operations-suite-translations/fr";
import { ptOperationsSuiteOverrides } from "../../apps/web/src/i18n/operations-suite-translations/pt";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test("Operations Suite catalogs explicitly cover every supported non-base locale", () => {
  const expectedKeys = Object.keys(operationsSuiteMessages.en).sort();
  const catalogs = {
    es: esOperationsSuiteOverrides,
    fr: frOperationsSuiteOverrides,
    de: deOperationsSuiteOverrides,
    pt: ptOperationsSuiteOverrides,
  } as const;

  for (const [locale, catalog] of Object.entries(catalogs)) {
    expect(Object.keys(catalog).sort(), locale).toEqual(expectedKeys);
  }

  for (const key of expectedKeys as (keyof typeof operationsSuiteMessages.en)[]) {
    expect(operationsSuiteMessages.ru[key], `ru:${key}`).not.toBe(
      operationsSuiteMessages.en[key],
    );
  }
});

const overview = {
  data: {
    leadsOverTime: [{ name: "Mon", leads: 4, booked: 2 }],
    leadsByChannel: [{ channelType: "WEBSITE", leads: 4, conversionRate: 50 }],
    conversionByScenario: [{ scenario: "Localized workflow", conversionRate: 50, runs: 4 }],
    responseTime: { averageSeconds: 8, p90Seconds: 15 },
    bookingsOrders: { bookings: 2, orders: 1 },
    estimatedRevenue: 250000,
    bestPerformingChannels: [{ channelType: "WEBSITE", score: 50 }],
    aiInsights: ["API insight content"],
  },
};

function workflow(name = "Localized workflow") {
  return {
    id: "wf-localized",
    tenantId: "tenant-operations-localization",
    name,
    description: "Workflow API content",
    status: "ACTIVE",
    version: 1,
    publishedAt: "2026-07-13T10:00:00.000Z",
    steps: [],
  };
}

async function mockApis(page: Page, requestedPeriods: string[]) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-operations-localization",
          email: "owner@operations.test",
          name: "Operations Owner",
          tenantId: "tenant-operations-localization",
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
          id: "tenant-operations-localization",
          name: "Operations Workspace",
          slug: "operations-workspace",
          status: "TRIALING",
          role: "OWNER",
        },
      },
    });
  });
  await page.route(/\/api\/analytics\/overview(?:\?.*)?$/, async (route) => {
    requestedPeriods.push(new URL(route.request().url()).searchParams.get("period") ?? "");
    await route.fulfill({ json: overview });
  });
  await page.route(/\/api\/workflows(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name?: string };
      await route.fulfill({ json: { data: { ...workflow(body.name), status: "PAUSED", publishedAt: null } } });
      return;
    }
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/workflows/wf-localized/publish", async (route) => {
    await route.fulfill({ json: { data: workflow() } });
  });
  await page.route("**/api/workflows/wf-localized/test", async (route) => {
    await route.fulfill({ json: { data: { runId: "run-localized", status: "COMPLETED", message: "Localized test completed" } } });
  });
  await page.route(/\/api\/ai-audit(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          summary: {
            totalEvents: 1,
            usageLogs: 1,
            auditLogs: 0,
            success: 1,
            handoff: 0,
            failed: 0,
            budgetBlocked: 0,
            toolCalls: 1,
            lastEventAt: "2026-07-13T10:00:00.000Z",
          },
          items: [{
            id: "audit-localized",
            kind: "usage",
            createdAt: "2026-07-13T10:00:00.000Z",
            action: "localized_audit_event",
            status: "SUCCESS",
            inputTokens: 1000,
            outputTokens: 2000,
            latencyMs: 25,
            payload: { safe: true },
            toolCalls: [{ type: "lead.note.create" }],
            toolResults: [],
          }],
        },
      },
    });
  });
}

async function selectLocale(page: Page, locale: Locale) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
}

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.body, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
  expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
}

test("Automation, Analytics, and AI Audit render all six locales with truthful actions", async ({ context, page }) => {
  test.setTimeout(90_000);
  const requestedPeriods: string[] = [];
  await mockApis(page, requestedPeriods);
  await context.addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${webBase}/app/automations`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByText(messages[locale]["suite.automation.title"], { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: messages[locale]["suite.automation.save"], exact: true })).toBeVisible();
  }
  await selectLocale(page, "en");
  await page.getByRole("button", { name: messages.en["suite.automation.save"], exact: true }).click();
  await expect(
    page.getByRole("button", { name: messages.en["suite.automation.test"], exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("automation-test-note")).toHaveText(
    messages.en["suite.automation.testNeedsConversation"],
  );

  await page.goto(`${webBase}/app/analytics`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByText(messages[locale]["suite.analytics.title"], { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: messages[locale]["suite.analytics.export"], exact: true })).toBeVisible();
  }
  await selectLocale(page, "en");
  await page.getByRole("button", { name: messages.en["suite.analytics.period7"], exact: true }).click();
  await expect.poll(() => requestedPeriods).toContain("7d");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: messages.en["suite.analytics.export"], exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^leadvirt-analytics-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.goto(`${webBase}/app/audit`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByText(messages[locale]["suite.audit.subtitle"], { exact: true })).toBeVisible();
    await expect(page.getByText(messages[locale]["suite.audit.tenantScoped"], { exact: true })).toBeVisible();
  }
  await page.getByText(messages.ru["suite.audit.payload"], { exact: true }).click();
  await expect(page.getByText('"safe": true', { exact: false })).toBeVisible();
});

for (const testCase of [
  { locale: "de" as Locale, width: 1440, height: 900 },
  { locale: "pt" as Locale, width: 390, height: 844 },
]) {
  test(`${testCase.locale} operations suite avoids viewport overflow at ${testCase.width}px`, async ({ context, page }) => {
    const requestedPeriods: string[] = [];
    await mockApis(page, requestedPeriods);
    await context.addCookies([{ name: "leadvirt-locale", value: testCase.locale, url: webBase, sameSite: "Lax" }]);
    await page.setViewportSize({ width: testCase.width, height: testCase.height });

    for (const path of ["automations", "analytics", "audit"]) {
      await page.goto(`${webBase}/app/${path}`, { waitUntil: "domcontentloaded" });
      await expectNoPageOverflow(page);
    }
  });
}
