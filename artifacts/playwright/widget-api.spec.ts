import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const publicKey = "demo-website-widget";

test("widget frame loads config and sends a message through public widget API", async ({ page }) => {
  let postedBody: { sessionId?: string; text?: string; clientMessageId?: string } | null = null;

  await page.route(`**/api/public/widget/${publicKey}/config`, async (route) => {
    await route.fulfill({
      json: {
        data: {
          publicKey,
          tenantName: "API Tenant",
          businessName: "API Beauty Studio",
          title: "API Widget",
          subtitle: "AI-консультант онлайн",
          welcomeMessage: "Здравствуйте, я API-виджет LeadVirt.",
          primaryColor: "#34d399",
          accentColor: "#10b981",
          position: "bottom-right",
          locale: "ru-RU",
          suggestedReplies: ["Хочу записаться", "Сколько стоит?"],
          poweredBy: "LeadVirt.ai",
        },
      },
    });
  });

  await page.route(`**/api/public/widget/${publicKey}/messages`, async (route) => {
    postedBody = route.request().postDataJSON() as typeof postedBody;
    await route.fulfill({
      json: {
        data: {
          sessionId: postedBody?.sessionId,
          conversationId: "conversation-widget",
          leadId: "lead-widget",
          status: "OPEN",
          messages: [
            {
              id: postedBody?.clientMessageId ?? "customer-message",
              senderType: "CUSTOMER",
              direction: "INBOUND",
              text: postedBody?.text ?? "",
              createdAt: "2026-06-22T10:00:00.000Z",
              status: "SENT",
            },
            {
              id: "ai-message",
              senderType: "AI",
              direction: "OUTBOUND",
              text: "API ответ виджета: подберу свободное время.",
              createdAt: "2026-06-22T10:00:01.000Z",
              status: "SENT",
            },
          ],
          ai: {
            replied: true,
            handoffRequired: false,
            confidence: 0.92,
            intent: "booking",
          },
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/widget/frame?key=${publicKey}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("leadvirt-widget")).toHaveAttribute("data-widget-locale", "ru");
  await page.getByRole("button", { name: "Открыть чат" }).click();

  await expect(page.getByText("API Widget")).toBeVisible();
  await expect(page.getByText("Здравствуйте, я API-виджет LeadVirt.")).toBeVisible();

  await page.locator("textarea").fill("Нужна запись на завтра");
  await page.locator('button[type="submit"]').click();

  await expect.poll(() => postedBody?.text).toBe("Нужна запись на завтра");
  await expect.poll(() => postedBody?.sessionId?.startsWith(`lvw_${publicKey}_`)).toBe(true);
  await expect(page.getByText("API ответ виджета: подберу свободное время.")).toBeVisible();
  await page.screenshot({
    path: "artifacts/playwright/fresh-widget-frame-desktop.png",
    fullPage: true,
  });
});

test("widget demo stays local and never calls the public widget API", async ({ page }) => {
  let publicApiCalls = 0;
  await page.route("**/api/public/widget/**", async (route) => {
    publicApiCalls += 1;
    await route.abort();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/widget/demo`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Открыть чат" }).click();

  await expect(page.getByText("Студия Лето", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Здравствуйте! Подскажу цены, соберу удобное время и передам заявку менеджеру.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByPlaceholder("Напишите сообщение...").fill("Нужно окрашивание в пятницу");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();

  await expect(page.getByText("Нужно окрашивание в пятницу", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Спасибо! Уточню услугу и удобное время, затем передам заявку менеджеру для подтверждения.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(publicApiCalls).toBe(0);
});

test("widget embed script points an iframe at the requested public key", async ({ request }) => {
  const response = await request.get(`${webBase}/widget/embed.js?key=custom-public-key`);
  expect(response.ok()).toBe(true);

  const body = await response.text();
  expect(body).toContain('data-leadvirt-widget="true"');
  expect(body).toContain("custom-public-key");
  expect(body).toContain("/widget/frame");
});

test("widget embed and frame require an explicit public key", async ({ page, request }) => {
  const response = await request.get(`${webBase}/widget/embed.js`);
  expect(response.ok()).toBe(true);

  const body = await response.text();
  expect(body).toContain("LeadVirt widget key is required");
  expect(body).not.toContain("demo-website-widget");

  let publicWidgetCalls = 0;
  await page.route("**/api/public/widget/**", async (route) => {
    publicWidgetCalls += 1;
    await route.abort();
  });

  await page.goto(`${webBase}/widget/frame`, { waitUntil: "networkidle" });
  await expect(page.getByText("LeadVirt widget key is required")).toBeVisible();
  expect(publicWidgetCalls).toBe(0);
});
