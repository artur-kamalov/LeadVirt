import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test("landing desktop CTAs and nav links route to live pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  await page.getByTestId("landing-desktop-login").click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

  await page.goto(webBase, { waitUntil: "domcontentloaded" });
  await page.getByTestId("landing-desktop-trial").click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });

  await page.goto(webBase, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Смотреть демо" }).click();
  await expect(page).toHaveURL(/\/demo$/, { timeout: 15_000 });

  await page.goto(webBase, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Тарифы" }).click();
  await expect(page.locator("#pricing")).toBeInViewport({ timeout: 10_000 });
});

test("landing mobile menu opens, closes, and routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  await page.getByTestId("landing-mobile-menu").click();
  await expect(page.getByTestId("landing-mobile-solutions")).toBeVisible();

  await page.getByTestId("landing-mobile-solutions").click();
  await expect(page.locator("#niches")).toBeInViewport({ timeout: 10_000 });

  await page.goto(webBase, { waitUntil: "domcontentloaded" });
  await page.getByTestId("landing-mobile-menu").click();
  await expect(page.getByTestId("landing-mobile-login")).toBeVisible();
  await page.getByTestId("landing-mobile-login").click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
});
