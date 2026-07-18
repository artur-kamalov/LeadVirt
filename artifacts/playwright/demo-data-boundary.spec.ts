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
  await expect(page).toHaveURL(/\/login/, { timeout: 45_000 });
});

test("interactive demo routes use local browser data only", async ({ page }) => {
  test.setTimeout(180_000);
  const apiCalls: string[] = [];

  await page.route("**/api/**", async (route) => {
    apiCalls.push(route.request().url());
    await route.abort();
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Demo read-only").first()).toBeVisible();
  await expect(page.locator("main")).not.toBeEmpty({ timeout: 20_000 });

  const routes = [
    "/demo/inbox",
    "/demo/leads",
    "/demo/automations",
    "/demo/analytics",
    "/demo/knowledge",
    "/demo/integrations",
    "/demo/settings",
  ] as const;

  for (const route of routes) {
    await page.locator(`aside nav a[href="${route}"]`).click();
    await expect(page).toHaveURL(`${webBase}${route}`, { timeout: 45_000 });
    await expect(page.locator("main")).not.toBeEmpty({ timeout: 20_000 });
  }

  await page.goto(`${webBase}/demo/settings?tab=security`, { waitUntil: "domcontentloaded" });
  const twoFactorCard = page.getByTestId("settings-two-factor-card");
  await expect(twoFactorCard).toContainText("Off");
  await expect(twoFactorCard).toContainText("Inactive");
  await expect(twoFactorCard).not.toContainText("Active");

  await page.goto(`${webBase}/demo/settings`, { waitUntil: "domcontentloaded" });
  const businessProfileLink = page.getByTestId("settings-business-profile-link");
  await expect(businessProfileLink).toHaveAttribute("href", "/demo/knowledge?view=business");
  await businessProfileLink.click();
  await expect(page).toHaveURL(`${webBase}/demo/knowledge?view=business`);
  await expect(page.getByTestId("business-profile-editor")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("business-profile-name")).not.toHaveValue("");
  await expect(page.getByTestId("business-profile-name")).not.toBeEditable();

  await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-messages-scroll")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Toggle theme" }).click();

  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).not.toBeEmpty({ timeout: 20_000 });

  await page.goto(`${webBase}/demo/billing`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("RUB 24,900", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("/ 2,500", { exact: true })).toBeVisible();
  await expect(page.getByText("/ 5", { exact: true })).toBeVisible();
  await expect(page.getByText("/ 10", { exact: true })).toBeVisible();
  await expect(page.getByText("/ 15", { exact: true })).toBeVisible();

  expect(apiCalls).toEqual([]);
});
