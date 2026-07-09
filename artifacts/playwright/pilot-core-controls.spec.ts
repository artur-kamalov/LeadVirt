import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.describe.configure({ timeout: 90_000 });

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

test("product shell primary links route without silent clicks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await page.getByTestId("product-topbar-new-lead").click();
  await expect(page).toHaveURL(/\/app\/inbox$/, { timeout: 15_000 });

  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await page.getByTestId("product-billing-link").click();
  await expect(page).toHaveURL(/\/app\/billing$/, { timeout: 15_000 });

  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
  await page.getByTestId("product-logo-link").click();
  await expect(page).toHaveURL(new RegExp(`^${webBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`), {
    timeout: 15_000,
  });
});

test("dashboard recent lead row is a real conversation link", async ({ page }) => {
  await page.route("**/api/dashboard/summary", async (route) => {
    await route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 1,
            aiConversationsCount: 1,
            bookingsOrdersCreated: 0,
            leadsSentToCrm: 0,
            averageResponseTimeSeconds: 0,
            conversionRate: 0,
          },
          recentActivity: [],
          channelPerformance: [],
          trend: [],
          recentLeads: [
            {
              id: "pilot-core-lead",
              conversationId: "pilot-core-conversation",
              name: "Pilot Core Recent Lead",
              source: "Website widget",
              channelType: "WEBSITE",
              status: "NEW",
              temperature: "WARM",
              valueAmount: 12000,
              currency: "RUB",
              interest: "Pilot core service",
              createdAt: "2026-07-09T10:00:00.000Z",
              lastMessageAt: "2026-07-09T10:00:00.000Z",
            },
          ],
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await page.getByRole("link", { name: /Pilot Core Recent Lead/ }).click();
  await expect(page).toHaveURL(/\/app\/inbox\/pilot-core-conversation$/, { timeout: 15_000 });
});

test("conversation back control is a real inbox link", async ({ page }) => {
  await page.route("**/api/conversations/pilot-core-back-conversation", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "pilot-core-back-conversation",
          tenantId: "tenant-demo",
          leadId: "pilot-core-back-lead",
          channel: {
            id: "channel-demo",
            tenantId: "tenant-demo",
            type: "TELEGRAM",
            status: "ACTIVE",
            name: "Telegram bot",
            lastHealthAt: null,
          },
          channelType: "TELEGRAM",
          status: "OPEN",
          subject: "Pilot core back dialog",
          lastMessageAt: "2026-07-09T10:00:00.000Z",
          aiEnabled: true,
          handoffRequested: false,
          lead: {
            id: "pilot-core-back-lead",
            tenantId: "tenant-demo",
            name: "Pilot Core Back Lead",
            phone: null,
            email: null,
            companyName: null,
            source: "Telegram bot",
            channelType: "TELEGRAM",
            status: "IN_PROGRESS",
            temperature: "WARM",
            valueAmount: 12000,
            currency: "RUB",
            interest: "Back link service",
            summary: "Back link smoke",
            assignedToUserId: null,
            assignedToName: "API Manager",
            lastMessageAt: "2026-07-09T10:00:00.000Z",
            createdAt: "2026-07-09T09:55:00.000Z",
          },
          lastMessage: "Проверка назад",
          unreadCount: 0,
          messages: [
            {
              id: "pilot-core-back-message",
              tenantId: "tenant-demo",
              conversationId: "pilot-core-back-conversation",
              direction: "INBOUND",
              senderType: "CUSTOMER",
              text: "Проверка назад",
              status: "RECEIVED",
              createdAt: "2026-07-09T10:00:00.000Z",
            },
          ],
          events: [],
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/pilot-core-back-conversation`, { waitUntil: "networkidle" });

  await page.getByRole("link", { name: "Назад во входящие" }).click();
  await expect(page).toHaveURL(/\/app\/inbox$/, { timeout: 15_000 });
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
