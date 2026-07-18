import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});

test("inbox omits unavailable lead actions from the right panel", async ({ page }) => {
  await page.route("**/api/inbox/conversations?*", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "conversation-api-1",
            tenantId: "tenant-demo",
            leadId: "lead-api-1",
            channel: { id: "channel-website", tenantId: "tenant-demo", type: "WEBSITE", status: "ACTIVE", name: "Website" },
            channelType: "WEBSITE",
            status: "OPEN",
            subject: "API lead conversation",
            lastMessageAt: "2026-06-23T10:00:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: {
              id: "lead-api-1",
              tenantId: "tenant-demo",
              name: "API Lead",
              phone: "+79990000000",
              email: "lead@example.com",
              companyName: null,
              source: "Website widget",
              channelType: "WEBSITE",
              status: "NEW",
              temperature: "WARM",
              valueAmount: 12000,
              currency: "RUB",
              interest: "Consultation",
              summary: "Needs a consultation",
              assignedToUserId: null,
              assignedToName: null,
              lastMessageAt: "2026-06-23T10:00:00.000Z",
              createdAt: "2026-06-23T09:00:00.000Z"
            },
            lastMessage: "Please contact me",
            unreadCount: 1,
            messages: [],
            events: []
          }
        ],
        pagination: { page: 1, limit: 50, total: 1, hasMore: false }
      }
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "networkidle" });

  await expect(page.getByText("API Lead").first()).toBeVisible();
  const summary = page.getByTestId("inbox-lead-summary");
  await expect(summary.getByRole("button", { name: /Открыть диалог/ })).toBeVisible();
  await expect(summary.getByRole("button", { name: /CRM/ })).toHaveCount(0);
  await expect(summary.getByRole("button", { name: /Создать задачу/ })).toHaveCount(0);
});

