import { expect, test } from "@playwright/test";
import { messages } from "../../apps/web/src/i18n/messages";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});
const conversationId = "pw-events-conversation";
const leadId = "lead-events";

function lead() {
  return {
    id: leadId,
    tenantId: "tenant-demo",
    name: "Events API Client",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status: "IN_PROGRESS",
    temperature: "HOT",
    valueAmount: 21000,
    currency: "RUB",
    interest: "Events timeline service",
    summary: "Conversation events smoke",
    assignedToUserId: null,
    assignedToName: "API Manager",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    createdAt: "2026-06-22T09:55:00.000Z",
  };
}

function conversation() {
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
    subject: "Events API dialog",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    aiEnabled: true,
    handoffRequested: false,
    lead: lead(),
    lastMessage: "Покажите историю действий",
    unreadCount: 1,
    messages: [
      {
        id: "message-events-1",
        tenantId: "tenant-demo",
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Покажите историю действий",
        status: "RECEIVED",
        createdAt: "2026-06-22T10:00:00.000Z",
      },
    ],
    events: [
      {
        id: "event-api-1",
        leadId,
        type: "sent_to_crm",
        title: "API событие CRM",
        message: "Лид синхронизирован",
        createdAt: "2026-06-22T10:04:00.000Z",
      },
      {
        id: "event-api-2",
        leadId,
        type: "booking.created",
        title: "API запись создана",
        message: "Запись из API",
        createdAt: "2026-06-22T10:03:00.000Z",
      },
    ],
  };
}

test("conversation timeline localizes known system events and preserves unknown API titles", async ({
  page,
}) => {
  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ json: { data: conversation() } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "networkidle" });

  await expect(page.getByText("Events API Client")).toBeVisible();
  await expect(
    page.getByText(messages.ru["ops.conversation.eventCrm"], { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("API запись создана")).toBeVisible();
  await expect(page.getByText("Создан лид")).toHaveCount(0);
});
