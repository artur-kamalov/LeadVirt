import { expect, test, type Page } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";
import { readFileSync } from "node:fs";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

async function selectLocale(page: Page, locale: string) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
}

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" },
  ]);
});

const overview = {
  data: {
    leadsOverTime: [
      { name: "Пн", leads: 2, booked: 1 },
      { name: "Вт", leads: 4, booked: 2 },
      { name: "Ср", leads: 4, booked: 1 },
    ],
    leadsByChannel: [
      { channelType: "WEBSITE", leads: 6, conversionRate: 50 },
      { channelType: "TELEGRAM", leads: 4, conversionRate: 25 },
    ],
    conversionByScenario: [{ scenario: "Playwright сценарий", conversionRate: 42, runs: 11 }],
    responseTime: { averageSeconds: 11, p90Seconds: 29 },
    bookingsOrders: { bookings: 3, orders: 2 },
    estimatedRevenue: 987000,
    bestPerformingChannels: [
      { channelType: "WEBSITE", score: 50 },
      { channelType: "TELEGRAM", score: 25 },
    ],
    aiInsights: ["Playwright insight from analytics API"],
  },
};

const emptyOverview = {
  data: {
    leadsOverTime: [
      { name: "1", leads: 0, booked: 0 },
      { name: "2", leads: 0, booked: 0 },
      { name: "3", leads: 0, booked: 0 },
      { name: "4", leads: 0, booked: 0 },
      { name: "5", leads: 0, booked: 0 },
      { name: "6", leads: 0, booked: 0 },
      { name: "7", leads: 0, booked: 0 },
    ],
    leadsByChannel: [],
    conversionByScenario: [],
    responseTime: { averageSeconds: 0, p90Seconds: 0 },
    bookingsOrders: { bookings: 0, orders: 0 },
    estimatedRevenue: 0,
    bestPerformingChannels: [],
    aiInsights: [],
  },
};

test("analytics page keeps response time at zero for empty workspaces", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/analytics/overview*", async (route) => {
    await route.fulfill({ json: emptyOverview });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/analytics`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  await expect(page.getByTestId("analytics-kpi-2-value")).toContainText(/^0/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("analytics-channels-empty")).toBeVisible();
  await expect(page.getByTestId("analytics-scenarios-empty")).toBeVisible();
  await expect(page.getByTestId("analytics-best-channels-empty")).toBeVisible();
  await expect(page.getByTestId("analytics-recommendations-empty")).toBeVisible();
  await page.screenshot({ path: "artifacts/playwright/analytics-empty-state.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.waitForTimeout(750);
  await page.screenshot({
    path: "artifacts/playwright/analytics-empty-state-mobile.png",
    fullPage: true,
  });
});

test("analytics page renders API overview data", async ({ page }) => {
  let requested = false;
  const requestedPeriods: string[] = [];

  await page.route("**/api/analytics/overview*", async (route) => {
    requested = true;
    requestedPeriods.push(new URL(route.request().url()).searchParams.get("period") ?? "");
    await route.fulfill({ json: overview });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/analytics`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");

  await expect.poll(() => requested).toBe(true);
  await expect.poll(() => requestedPeriods).toContain("30d");
  await expect(page.getByText("Playwright сценарий").first()).toBeVisible();
  await expect(page.getByText("Playwright insight from analytics API")).toHaveCount(0);
  await expect(page.getByTestId("analytics-recommendations-empty")).toBeVisible();
  await expect(page.getByText(/987.*тыс.*₽/)).toBeVisible();

  await page.getByRole("button", { name: "7 дней" }).click();
  await expect.poll(() => requestedPeriods).toContain("7d");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Экспорт/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^leadvirt-analytics-\d{4}-\d{2}-\d{2}\.csv$/);

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = readFileSync(downloadPath!, "utf8");
  expect(csv).toContain("7 дней");
  expect(csv).toContain("Playwright сценарий");
  expect(csv).not.toContain("Playwright insight from analytics API");
  expect(csv).toMatch(/987.*тыс.*₽/);
});

test("analytics API does not invent recommendations without measured evidence", async ({ page }) => {
  const response = await page.request.get(`${apiBase}/analytics/overview?period=30d`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    data: { aiInsightCodes?: string[]; aiInsights?: string[] };
  };

  expect(payload.data.aiInsights).toBeUndefined();
  expect(payload.data.aiInsightCodes).toEqual([]);
});

test("analytics blocks export on load failure and retries without fake KPIs", async ({ page }) => {
  let requests = 0;
  let recover = false;
  await page.route("**/api/analytics/overview*", async (route) => {
    requests += 1;
    if (!recover) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: overview });
  });

  await page.goto(`${webBase}/app/analytics`);

  const error = page.getByTestId("analytics-load-error");
  await expect(error).toBeVisible();
  await expect(page.locator('[data-testid^="analytics-kpi-"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export|Экспорт/ })).toHaveCount(0);
  recover = true;
  await error.getByRole("button").click();
  await expect(error).toBeHidden();
  await expect(page.getByText("Playwright insight from analytics API")).toHaveCount(0);
  await expect(page.getByTestId("analytics-recommendations-empty")).toBeVisible();
  expect(requests).toBeGreaterThanOrEqual(2);
});

test("analytics keeps the last successful period truthful when a new period fails", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let recoverSevenDays = false;

  await page.route("**/api/analytics/overview*", async (route) => {
    const period = new URL(route.request().url()).searchParams.get("period");
    if (period === "7d" && !recoverSevenDays) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }

    await route.fulfill({
      json:
        period === "7d"
          ? {
              data: {
                ...overview.data,
                aiInsights: ["Recovered seven-day insight"],
              },
            }
          : overview,
    });
  });

  await page.goto(`${webBase}/app/analytics`);
  await expect(page.getByText("Playwright insight from analytics API")).toHaveCount(0);
  await expect(page.getByTestId("analytics-recommendations-empty")).toBeVisible();
  await selectLocale(page, "en");

  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByTestId("analytics-refresh-error")).toBeVisible();
  await expect(page.getByText("Playwright insight from analytics API")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const [staleDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const stalePath = await staleDownload.path();
  expect(stalePath).toBeTruthy();
  expect(readFileSync(stalePath!, "utf8")).toContain("30 days");

  recoverSevenDays = true;
  await page.getByTestId("analytics-refresh-error").getByRole("button").click();
  await expect(page.getByTestId("analytics-refresh-error")).toBeHidden();
  await expect(page.getByText("Recovered seven-day insight")).toHaveCount(0);
  await expect(page.getByTestId("analytics-recommendations-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("analytics renders measured response aggregates without invented hourly points", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.route("**/api/analytics/overview*", async (route) => {
    await route.fulfill({ json: overview });
  });

  await page.goto(`${webBase}/app/analytics`);
  await selectLocale(page, "en");

  await expect(page.getByText("Average response time", { exact: true }).last()).toBeVisible();
  await expect(page.getByTestId("analytics-response-chart")).toContainText("Response time P90");
  await expect(page.getByText("00:00", { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId("analytics-kpi-0").locator("svg.lucide-arrow-up-right"),
  ).toHaveCount(0);
});
