import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test("tenant-scoped API requires a credential session", async ({ request }) => {
  for (const path of ["/auth/me", "/current-tenant", "/dashboard/summary"]) {
    const response = await request.get(`${apiBase}${path}`);
    expect(response.status(), path).toBe(401);
  }
});

test("unauthenticated app visit redirects to login", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});

test("interactive demo routes use local browser data only", async ({ page }) => {
  test.setTimeout(90_000);
  const apiCalls: string[] = [];

  await page.route("**/api/**", async (route) => {
    apiCalls.push(route.request().url());
    await route.abort();
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Demo read-only").first()).toBeVisible();
  await expect(page.locator("main")).not.toBeEmpty({ timeout: 20_000 });
  await expect(page.getByText("Студия Лето").first()).toBeVisible({ timeout: 20_000 });

  const routes = [
    "/demo/inbox",
    "/demo/leads",
    "/demo/automations",
    "/demo/analytics",
    "/demo/audit",
    "/demo/integrations",
    "/demo/settings",
  ] as const;

  for (const route of routes) {
    await page.locator(`aside nav a[href="${route}"]`).click();
    await expect(page).toHaveURL(`${webBase}${route}`, { timeout: 30_000 });
    await expect(page.locator("main")).not.toBeEmpty({ timeout: 20_000 });
  }

  await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Написать сообщение...").fill("Подтверждаю запись в demo");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(page.getByText("Подтверждаю запись в demo")).toBeVisible();

  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Переместить лид/ }).first().click();
  await expect(page.getByText(/Лид перемещён|Действие выполнено/)).toBeVisible();

  await page.goto(`${webBase}/widget/demo`, { waitUntil: "domcontentloaded" });
  const openChat = page.getByRole("button", { name: "Открыть чат" });
  const widgetPanel = page.getByLabel("Чат-виджет LeadVirt.ai");
  await expect(openChat).toBeVisible({ timeout: 20_000 });
  await openChat.click();
  try {
    await expect(widgetPanel).toBeVisible({ timeout: 5_000 });
  } catch {
    await openChat.click();
    await expect(widgetPanel).toBeVisible({ timeout: 10_000 });
  }
  await widgetPanel.getByRole("button", { name: "Хочу записаться" }).click();
  await expect(page.getByText("локальный demo-сценарий")).toBeVisible();

  expect(apiCalls).toEqual([]);
});
