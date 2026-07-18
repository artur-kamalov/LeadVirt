import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function nextStep(page: import("@playwright/test").Page) {
  await page.locator("button:visible").last().click();
}

test("onboarding company step exposes RAG business fields", async ({ page }) => {
  const onboardingState = {
    businessProfileVersion: 1,
    businessProfileEtag: '"business-profile-knowledge-ui-1"',
    businessProfileUpdatedAt: "2026-07-18T12:00:00.000Z",
    currentStep: "business",
    completedSteps: [],
    data: {},
    completedAt: null,
  };
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "knowledge-onboarding-owner",
          tenantId: "knowledge-onboarding-tenant",
          email: "owner@knowledge-onboarding.test",
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({ json: { data: onboardingState } });
  });
  await page.route("**/api/onboarding/complete-step", async (route) => {
    await route.fulfill({ json: { data: onboardingState } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });

  await page.locator("main button").nth(1).click();
  await nextStep(page);
  await page.locator("main button").nth(0).click();
  await nextStep(page);
  await page.locator("main button").nth(0).click();
  await nextStep(page);

  await expect(page.locator("textarea")).toHaveCount(6);
  await page.screenshot({
    path: "artifacts/playwright/onboarding-knowledge-fields.png",
    fullPage: true,
  });
});
