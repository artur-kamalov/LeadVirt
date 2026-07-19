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

test("demo product shell restores the saved theme after hydration", async ({ page }) => {
  const hydrationErrors: string[] = [];
  const recordHydrationError = (message: string) => {
    if (/hydration|server rendered html|did not match/i.test(message)) {
      hydrationErrors.push(message);
    }
  };

  page.on("console", (message) => {
    if (message.type() === "error") recordHydrationError(message.text());
  });
  page.on("pageerror", (error) => recordHydrationError(error.message));
  await page.addInitScript(() => window.localStorage.setItem("ai-admin-theme", "light"));

  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("product-shell")).toHaveClass(/theme-light/);
  expect(hydrationErrors).toEqual([]);
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

test("demo team settings render without an authenticated user provider", async ({ page }) => {
  const apiCalls: string[] = [];
  const pageErrors: string[] = [];

  await page.route("**/api/**", async (route) => {
    apiCalls.push(route.request().url());
    await route.abort();
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/demo/settings`, { waitUntil: "domcontentloaded" });
  const mobileSectionSelector = page.getByRole("combobox", { name: "Settings" });
  await expect(mobileSectionSelector).toHaveText("Workspace and contacts");
  await mobileSectionSelector.click();
  await page.getByRole("option", { name: "Team and roles", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team and roles", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/demo/settings`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("settings-demo-read-only-notice")).toBeVisible();
  await page.getByRole("button", { name: "Team and roles", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team and roles", exact: true })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(apiCalls).toEqual([]);
});
