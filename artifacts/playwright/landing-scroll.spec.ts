import { expect, test } from "@playwright/test";

const webUrl = process.env.LEADVIRT_WEB_URL ?? "http://localhost:3001";

test("landing deferred sections render when scrolled into view", async ({ page }) => {
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor({ state: "visible" });

  await page.locator("#niches").scrollIntoViewIfNeeded();
  await expect
    .poll(async () => page.locator("#niches button").count(), { timeout: 5000 })
    .toBeGreaterThan(2);

  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await expect
    .poll(async () => page.locator("#pricing a[href='/onboarding']").count(), { timeout: 5000 })
    .toBeGreaterThan(2);

  await page.screenshot({
    path: "artifacts/playwright/landing-deferred-sections.png",
    fullPage: false,
  });
});
