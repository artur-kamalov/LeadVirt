import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

test("conversation toolbar handles file upload and emoji picker", async ({ page }) => {
  await page.route("**/api/conversations/pilot-action-audit", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "pilot-action-audit",
          tenantId: "tenant-audit",
          leadId: "lead-audit",
          channel: {
            id: "channel-audit",
            tenantId: "tenant-audit",
            type: "WEBSITE",
            status: "ACTIVE",
            name: "Website",
            lastHealthAt: null,
          },
          channelType: "WEBSITE",
          status: "OPEN",
          subject: "Pilot action audit",
          lastMessageAt: "2026-07-09T10:00:00.000Z",
          aiEnabled: true,
          handoffRequested: false,
          lead: {
            id: "lead-audit",
            tenantId: "tenant-audit",
            name: "Pilot Action",
            phone: null,
            email: null,
            companyName: null,
            source: "Website",
            channelType: "WEBSITE",
            status: "IN_PROGRESS",
            temperature: "WARM",
            valueAmount: 0,
            currency: "RUB",
            interest: "Pilot audit",
            summary: "Pilot audit",
            assignedToUserId: null,
            assignedToName: null,
            lastMessageAt: "2026-07-09T10:00:00.000Z",
            createdAt: "2026-07-09T10:00:00.000Z",
          },
          lastMessage: "Hello",
          unreadCount: 0,
          messages: [
            {
              id: "message-audit",
              tenantId: "tenant-audit",
              conversationId: "pilot-action-audit",
              direction: "INBOUND",
              senderType: "CUSTOMER",
              text: "Hello",
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
  await page.goto(`${webBase}/app/inbox/pilot-action-audit`, { waitUntil: "networkidle" });

  await page.getByTestId("conversation-attachment-input").setInputFiles({
    name: "pilot-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("pilot attachment", "utf8"),
  });
  await expect(page.getByText("Файл прикреплён")).toBeVisible();
  await expect(page.getByTestId("conversation-pending-attachment")).toContainText("pilot-note.txt");

  await page.getByTestId("conversation-emoji").click();
  await expect(page.getByTestId("conversation-emoji-panel")).toBeVisible();
  await page.getByTestId("conversation-emoji-option-0").click();
  await expect(page.getByPlaceholder("Написать сообщение...")).toHaveValue("🙂");
});

test("settings logo upload persists and can be removed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  await page.getByTestId("settings-logo-input").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText("Логотип обновлён")).toBeVisible();
  await expect(page.getByTestId("settings-logo-preview")).toBeVisible();

  await page.getByTestId("settings-logo-remove").click();
  await expect(page.getByText("Логотип удалён")).toBeVisible();
  await expect(page.getByTestId("settings-logo-preview")).toHaveCount(0);
});
