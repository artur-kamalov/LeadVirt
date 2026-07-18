import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase);
  const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale: "en" },
  });
  expect(localeResponse.ok()).toBeTruthy();
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("inbox shows a real empty state when the API returns zero conversations", async ({ page }) => {
  await page.route("**/api/inbox/conversations**", async (route) => {
    await route.fulfill({
      json: {
        data: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          hasMore: false,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("inbox-empty-state")).toBeVisible();
  await expect(page.getByText("No conversations yet")).toBeVisible();
  await expect(page.getByText("No conversation selected")).toBeVisible();
  await expect(page.getByText("Anna Sokolova")).toHaveCount(0);

  await page.getByRole("button", { name: "Connect a channel" }).click();
  await expect(page).toHaveURL(/\/app\/integrations$/u);
});

test("inbox shows a retryable load error before the true empty state", async ({ page }) => {
  let requests = 0;
  let recover = false;
  await page.route("**/api/inbox/conversations**", async (route) => {
    requests += 1;
    if (!recover) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: [],
        pagination: { page: 1, limit: 50, total: 0, hasMore: false },
      },
    });
  });

  await page.goto(`${webBase}/app/inbox`);

  const error = page.getByTestId("inbox-load-error");
  await expect(error).toBeVisible();
  recover = true;
  await error.getByRole("button").click();
  await expect(error).toBeHidden();
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
});

test("inbox does not announce an empty workspace while the first list request is pending", async ({
  page,
}) => {
  let releaseRequest: (() => void) | undefined;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  await page.route("**/api/inbox/conversations**", async (route) => {
    await requestGate;
    await route.fulfill({
      json: {
        data: [],
        pagination: { page: 1, limit: 50, total: 0, hasMore: false },
      },
    });
  });

  await page.goto(`${webBase}/app/inbox`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("inbox-loading")).toBeVisible();
  await expect(page.getByTestId("inbox-detail-loading")).toBeVisible();
  await expect(page.getByTestId("inbox-empty-state")).toHaveCount(0);
  await expect(page.getByText("0 conversations", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "artifacts/playwright/inbox-loading-state.png", fullPage: true });

  releaseRequest?.();

  await expect(page.getByTestId("inbox-loading")).toBeHidden();
  await expect(page.getByTestId("inbox-detail-loading")).toBeHidden();
  await expect(page.getByTestId("inbox-empty-state")).toBeVisible();
});
