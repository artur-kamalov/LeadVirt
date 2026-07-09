import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

const baseConversation = {
  id: "pw-conversation",
  tenantId: "tenant-demo",
  leadId: "lead-demo",
  channel: {
    id: "channel-demo",
    tenantId: "tenant-demo",
    type: "TELEGRAM",
    status: "ACTIVE",
    name: "Telegram bot",
    lastHealthAt: null
  },
  channelType: "TELEGRAM",
  status: "OPEN",
  subject: "Playwright Диалог",
  lastMessageAt: "2026-06-22T10:00:00.000Z",
  aiEnabled: true,
  handoffRequested: false,
  lead: {
    id: "lead-demo",
    tenantId: "tenant-demo",
    name: "Playwright Клиент",
    phone: null,
    email: null,
    companyName: null,
    source: "Telegram bot",
    channelType: "TELEGRAM",
    status: "IN_PROGRESS",
    temperature: "WARM",
    valueAmount: 12000,
    currency: "RUB",
    interest: "Проверка отправки",
    summary: "Тестовый диалог",
    assignedToUserId: null,
    assignedToName: "Мария К.",
    lastMessageAt: "2026-06-22T10:00:00.000Z",
    createdAt: "2026-06-22T09:55:00.000Z"
  },
  lastMessage: "Здравствуйте, хочу уточнить детали",
  unreadCount: 1,
  messages: [
    {
      id: "message-1",
      tenantId: "tenant-demo",
      conversationId: "pw-conversation",
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: "Здравствуйте, хочу уточнить детали",
      status: "RECEIVED",
      createdAt: "2026-06-22T10:00:00.000Z"
    }
  ],
  events: []
};

test("conversation detail sends a message through the API adapter", async ({ page }) => {
  let postedText = "";
  let postedAttachments: Array<{ filename?: string; mimeType?: string; dataUrl?: string; sizeBytes?: number }> = [];

  await page.route("**/api/conversations/pw-conversation/messages", async (route) => {
    const body = route.request().postDataJSON() as {
      text?: string;
      attachments?: Array<{ filename?: string; mimeType?: string; dataUrl?: string; sizeBytes?: number }>;
    };
    postedText = body.text ?? "";
    postedAttachments = body.attachments ?? [];

    await route.fulfill({
      json: {
        data: {
          ...baseConversation,
          lastMessage: "API ответ принят",
          messages: [
            ...baseConversation.messages,
            {
              id: "message-2",
              tenantId: "tenant-demo",
              conversationId: "pw-conversation",
              direction: "OUTBOUND",
              senderType: "USER",
              text: postedText,
              status: "SENT",
              createdAt: "2026-06-22T10:01:00.000Z",
              attachments: postedAttachments.map((attachment, index) => ({
                id: `attachment-${index + 1}`,
                tenantId: "tenant-demo",
                messageId: "message-2",
                kind: "file",
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                url: attachment.dataUrl,
                sizeBytes: attachment.sizeBytes,
                createdAt: "2026-06-22T10:01:00.000Z"
              }))
            },
            {
              id: "message-3",
              tenantId: "tenant-demo",
              conversationId: "pw-conversation",
              direction: "OUTBOUND",
              senderType: "AI",
              text: "API ответ принят",
              status: "SENT",
              createdAt: "2026-06-22T10:01:01.000Z"
            }
          ]
        }
      }
    });
  });

  await page.route("**/api/conversations/pw-conversation", async (route) => {
    await route.fulfill({ json: { data: baseConversation } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox/pw-conversation`, { waitUntil: "networkidle" });
  await expect(page.getByText("Playwright Клиент")).toBeVisible();
  await expect(page.getByText("Здравствуйте, хочу уточнить детали")).toBeVisible();

  await page.getByTestId("conversation-attachment-input").setInputFiles({
    name: "pilot-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("pilot attachment", "utf8"),
  });
  await expect(page.getByTestId("conversation-pending-attachment")).toContainText("pilot-note.txt");

  await page.getByPlaceholder("Написать сообщение...").fill("Проверка API отправки");
  await page.getByPlaceholder("Написать сообщение...").press("Enter");

  await expect.poll(() => postedText).toBe("Проверка API отправки");
  await expect.poll(() => postedAttachments[0]?.filename).toBe("pilot-note.txt");
  await expect(page.getByText("Проверка API отправки")).toBeVisible();
  await expect(page.getByText("pilot-note.txt")).toBeVisible();
  await expect(page.getByText("API ответ принят")).toBeVisible();
});

