import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("dashboard quick actions navigate to real product routes", async ({ page }) => {
  await page.route("**/api/dashboard/summary", async (route) => {
    await route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 0,
            aiConversationsCount: 0,
            bookingsOrdersCreated: 0,
            leadsSentToCrm: 0,
            averageResponseTimeSeconds: 0,
            conversionRate: 0,
          },
          recentActivity: [],
          channelPerformance: [],
          trend: [],
          recentLeads: [],
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await page.getByTestId("dashboard-new-lead").click();
  await expect(page).toHaveURL(/\/app\/inbox$/, { timeout: 15_000 });

  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await page.getByTestId("dashboard-scenarios").click();
  await expect(page).toHaveURL(/\/app\/automations$/, { timeout: 15_000 });

  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await page.getByTestId("dashboard-analytics").click();
  await expect(page).toHaveURL(/\/app\/analytics$/, { timeout: 15_000 });
});

test("product shell theme toggle visibly switches theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const shell = page.locator(".min-h-screen").first();
  const hadLightTheme = await shell.evaluate((node) => node.classList.contains("theme-light"));

  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect
    .poll(async () => shell.evaluate((node) => node.classList.contains("theme-light")))
    .toBe(!hadLightTheme);
});
