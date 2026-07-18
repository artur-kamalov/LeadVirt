import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});
const conversationId = "pw-actions-conversation";
const leadId = "lead-actions";

function lead(status = "IN_PROGRESS") {
  return {
    id: leadId,
    tenantId: "tenant-demo",
    name: "Action API Client",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status,
    temperature: "WARM",
    valueAmount: 12000,
    currency: "RUB",
    interest: "Action API service",
    summary: "Conversation action smoke",
    assignedToUserId: null,
    assignedToName: "API Manager",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    createdAt: "2026-06-22T09:55:00.000Z",
  };
}

function conversation(status = "IN_PROGRESS") {
  return {
    id: conversationId,
    tenantId: "tenant-demo",
    leadId,
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
    subject: "Action API dialog",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    aiEnabled: true,
    handoffRequested: false,
    lead: lead(status),
    lastMessage: "Нужна консультация",
    unreadCount: 1,
    messages: [
      {
        id: "message-action-1",
        tenantId: "tenant-demo",
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Нужна консультация",
        status: "RECEIVED",
        createdAt: "2026-06-22T10:00:00.000Z",
      },
    ],
    events: [],
  };
}

test("conversation exposes only supported lead actions", async ({ page }) => {
  let qualifiedStatus = "";
  let currentStatus = "IN_PROGRESS";

  await page.route(`**/api/leads/${leadId}`, async (route) => {
    const body = route.request().postDataJSON() as { status?: string };
    qualifiedStatus = body.status ?? "";
    currentStatus = qualifiedStatus;
    await route.fulfill({ json: { data: lead(currentStatus) } });
  });

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ json: { data: conversation(currentStatus) } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });

  await expect(page.getByText("Action API Client")).toBeVisible();
  await expect(page.getByRole("button", { name: /CRM/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Создать задачу/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Записать на приём/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Отметить квалифицированным/ }).click();
  await expect.poll(() => qualifiedStatus).toBe("QUALIFIED");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /Отметить квалифицированным/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /CRM|Создать задачу|Записать на приём/ })).toHaveCount(0);
});

test("conversation transport failures stay distinct from a true not-found response", async ({
  page,
}) => {
  let responseStatus = 503;

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({
      status: responseStatus,
      json: {
        error: {
          code: responseStatus === 404 ? "NOT_FOUND" : "SERVICE_UNAVAILABLE",
          message: responseStatus === 404 ? "Conversation not found" : "Temporary outage",
        },
      },
    });
  });

  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("conversation-load-error")).toBeVisible();
  await expect(page.getByTestId("conversation-not-found")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/playwright/conversation-load-error.png",
    fullPage: true,
    animations: "disabled",
  });

  responseStatus = 404;
  await page.getByTestId("conversation-load-error").getByRole("button").click();

  await expect(page.getByTestId("conversation-not-found")).toBeVisible();
  await expect(page.getByTestId("conversation-load-error")).toHaveCount(0);
});

test("conversation keeps its last successful detail when live refresh fails", async ({ page }) => {
  let failRefresh = false;

  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    if (failRefresh) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary refresh outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: conversation() } });
  });

  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Action API Client")).toBeVisible();

  failRefresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(page.getByTestId("conversation-refresh-error")).toBeVisible();
  await expect(page.getByText("Action API Client")).toBeVisible();

  failRefresh = false;
  await page.getByTestId("conversation-refresh-error").getByRole("button").click();

  await expect(page.getByTestId("conversation-refresh-error")).toHaveCount(0);
  await expect(page.getByText("Action API Client")).toBeVisible();
});

