import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiMockHeaders = {
  "access-control-allow-origin": webBase,
  "access-control-allow-credentials": "true",
  "content-type": "application/json",
};

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
});

test("landing CTAs enter signup with a safe onboarding intent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("link", { name: "LeadVirt.ai" }).first()).toHaveAttribute(
    "href",
    "/",
  );

  const primaryCta = page.getByTestId("landing-desktop-trial");
  await expect(primaryCta).toHaveAttribute("href", "/signup?returnTo=%2Fonboarding");
  await primaryCta.click();
  await expect(page).toHaveURL(`${webBase}/signup?returnTo=%2Fonboarding`);

  await page.goto(`${webBase}/#pricing`, { waitUntil: "domcontentloaded" });
  const professionalCta = page.getByTestId("pricing-cta-pro");
  await expect(professionalCta).toHaveAttribute(
    "href",
    "/signup?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro",
  );
  await expect(page.getByTestId("pricing-cta-corporate")).toHaveAttribute(
    "href",
    "/signup?plan=corporate&returnTo=%2Fonboarding%3Fplan%3Dcorporate",
  );
});

test("public pricing uses the shared RUB catalog without wrapping the corporate price", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/#pricing`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("pricing-price-start")).toHaveText("9,900 RUB");
  await expect(page.getByTestId("pricing-price-pro")).toHaveText("24,900 RUB");
  await expect(page.getByTestId("pricing-price-business")).toHaveText("59,900 RUB");
  await expect(page.getByTestId("pricing-price-corporate")).toHaveText("from 120,000 RUB");
  await expect(
    page.getByText(/All listed prices and invoices are in Russian rubles \(RUB\)/),
  ).toBeVisible();

  const corporatePrice = page.getByTestId("pricing-price-corporate");
  await expect(corporatePrice).toBeVisible();
  expect(
    await corporatePrice.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("selected plan resumes onboarding after email OTP", async ({ page }) => {
  await page.route("**/api/auth/email-otp/config", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: { data: { enabled: true, codeLength: 6, resendAfterSeconds: 60 } },
    });
  });
  await page.route("**/api/auth/email-otp/request", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          sent: true,
          challengeId: "a".repeat(48),
          expiresAt: "2026-07-17T20:10:00.000Z",
          resendAfterSeconds: 60,
          debugCode: "123456",
        },
      },
    });
  });
  await page.route("**/api/auth/email-otp/verify", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          id: "new-owner",
          tenantId: "new-tenant",
          email: "new-owner@example.com",
          phone: null,
          name: "New Owner",
          avatarUrl: null,
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
          isNewUser: true,
        },
      },
    });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          id: "new-owner",
          tenantId: "new-tenant",
          email: "new-owner@example.com",
          name: "New Owner",
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          businessProfileVersion: 1,
          businessProfileEtag: '"business-profile-public-entry-1"',
          businessProfileUpdatedAt: "2026-07-17T20:10:00.000Z",
          currentStep: "business",
          completedSteps: [],
          data: {},
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/signup?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute(
    "href",
    "/login?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro",
  );
  await page.getByLabel("Work email").fill("new-owner@example.com");
  await page.getByTestId("email-otp-request").click();
  await page.getByTestId("email-otp-verify").click();

  await expect(page).toHaveURL(`${webBase}/onboarding?plan=pro`, { timeout: 15_000 });
});

test("desktop navigation aligns Features and Pricing below the fixed header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  for (const [label, selector] of [
    ["Features", "#features"],
    ["Pricing", "#pricing"],
  ] as const) {
    await page.getByRole("link", { name: label, exact: true }).first().click();
    await expect
      .poll(async () =>
        page.locator(selector).evaluate((node) => Math.round(node.getBoundingClientRect().top)),
      )
      .toBe(80);
  }
});

test("mobile menu has a full backdrop, accessible state, and 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  const menu = page.getByTestId("landing-mobile-menu");
  await expect(page.getByTestId("language-switcher").first()).toBeEnabled();
  await expect(menu).toHaveAttribute("aria-label", "Open menu");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(await menu.boundingBox()).toMatchObject({ width: 44, height: 44 });

  await menu.click();
  await expect(menu).toHaveAttribute("aria-label", "Close menu");
  await expect(menu).toHaveAttribute("aria-expanded", "true");

  const backdrop = page.getByTestId("landing-mobile-menu-backdrop");
  await expect.poll(async () => Math.round((await backdrop.boundingBox())?.height ?? 0)).toBe(764);
  const backdropBox = await backdrop.boundingBox();
  expect(backdropBox?.width).toBe(390);

  for (const target of [
    page.getByRole("link", { name: "Solutions", exact: true }),
    page.getByRole("link", { name: "Features", exact: true }),
    page.getByRole("link", { name: "Pricing", exact: true }),
    page.getByTestId("landing-mobile-login"),
  ]) {
    expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }

  await menu.click();
  await expect(menu).toHaveAttribute("aria-label", "Open menu");
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  await menu.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});
