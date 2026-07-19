import { expect, test } from "@playwright/test";
import { messages } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const authLocales = ["en", "ru", "es", "fr", "de", "pt"] as const;

const emailAuthResponse = {
  data: {
    id: "user-demo",
    tenantId: "tenant-demo",
    email: "owner@example.com",
    phone: null,
    name: "Email Owner",
    avatarUrl: null,
    role: "OWNER",
    authMode: "email",
    passwordChangeRequired: false,
    expiresAt: "2026-07-27T00:00:00.000Z",
  },
};

const currentTenantResponse = {
  data: {
    id: "tenant-demo",
    name: "API Studio",
    slug: "api-studio",
    status: "TRIALING",
    businessType: "education",
    timezone: "Europe/Moscow",
    role: "OWNER",
  },
};

const apiMockHeaders = {
  "access-control-allow-origin": webBase,
  "access-control-allow-credentials": "true",
  "content-type": "application/json",
};

test.describe("email OTP configuration", () => {
  test("login and signup expose only localized email authentication", async ({ context, page }) => {
    const telegramRequests: string[] = [];
    page.on("request", (request) => {
      if (/telegram\.org|\/api\/auth\/telegram/i.test(request.url())) {
        telegramRequests.push(request.url());
      }
    });
    await page.route("**/api/auth/email-otp/config", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { enabled: true, codeLength: 6, resendAfterSeconds: 60 } },
      });
    });

    for (const locale of authLocales) {
      await context.addCookies([
        { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
      ]);
      for (const authRoute of ["login", "signup"] as const) {
        const subtitleKey = authRoute === "login" ? "auth.login.subtitle" : "auth.signup.subtitle";
        await page.goto(`${webBase}/${authRoute}`, { waitUntil: "domcontentloaded" });

        await expect(page.getByText(messages[locale][subtitleKey], { exact: true })).toBeVisible();
        await expect(page.getByTestId("email-otp-request-form")).toBeVisible();
        await expect(page.getByTestId("auth-method-telegram")).toHaveCount(0);
        await expect(page.getByTestId("telegram-auth-button")).toHaveCount(0);
        await expect(page.getByTestId("telegram-brand-button")).toHaveCount(0);
        await expect(page.getByTestId("telegram-signup-explanation")).toHaveCount(0);
        await expect(page.locator('script[src*="telegram.org"]')).toHaveCount(0);
        await expect(page.locator("main")).not.toContainText("Telegram");
      }
    }

    expect(telegramRequests).toEqual([]);
  });

  test("login and signup keep invalid email disabled and explain the correction", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
    ]);
    await page.route("**/api/auth/email-otp/config", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { enabled: true, codeLength: 6, resendAfterSeconds: 60 } },
      });
    });

    for (const authRoute of ["login", "signup"] as const) {
      await page.goto(`${webBase}/${authRoute}`, { waitUntil: "networkidle" });
      const emailInput = page.getByLabel(messages.en["auth.email.label"]);
      const submitButton = page.getByTestId("email-otp-request");

      await emailInput.fill("not-an-email");
      await expect(submitButton).toBeDisabled();
      await emailInput.blur();
      await expect(emailInput).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("email-otp-address-error")).toHaveText(
        messages.en["auth.email.invalid"],
      );

      await emailInput.fill("owner@example.com");
      await expect(submitButton).toBeEnabled();
      await expect(emailInput).toHaveAttribute("aria-invalid", "false");
      await expect(page.getByTestId("email-otp-address-error")).toHaveCount(0);
    }
  });

  test("shows an honest unavailable state when email authentication is disabled", async ({
    page,
  }) => {
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
    await page.route("**/api/auth/email-otp/config", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { enabled: false, codeLength: 6, resendAfterSeconds: 60 } },
      });
    });

    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    await expect(page.getByTestId("email-otp-config-disabled")).toHaveText(
      messages.en["auth.email.disabled"],
    );
    await expect(page.getByTestId("email-otp-request-form")).toHaveCount(0);
    await expect(page.getByTestId("email-otp-config-retry")).toHaveCount(0);
    await expect(page.getByTestId("auth-method-telegram")).toHaveCount(0);
  });

  test("keeps auth controls touch-friendly through the mobile code step", async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
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
            challengeId: "m".repeat(48),
            expiresAt: "2026-07-18T20:10:00.000Z",
            resendAfterSeconds: 60,
            debugCode: "246810",
          },
        },
      });
    });

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    const initialControls = [
      page.getByRole("link", { name: "LeadVirt.ai", exact: true }),
      page.getByTestId("language-switcher"),
      page.getByRole("link", { name: "Back to site", exact: true }),
      page.getByLabel("Work email"),
      page.getByTestId("email-otp-request"),
      page.getByRole("link", { name: "Sign up", exact: true }),
    ];
    for (const control of initialControls) {
      const box = await control.boundingBox();
      expect(box, await control.getAttribute("data-testid")).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await page.getByLabel("Work email").fill("mobile@example.com");
    await page.getByTestId("email-otp-request").click();
    for (const control of [
      page.getByRole("button", { name: "Change email", exact: true }),
      page.getByTestId("email-otp-resend"),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test("keeps a transient configuration failure distinct and retries", async ({ page }) => {
    let configRequests = 0;
    let configAvailable = false;
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
    await page.route("**/api/auth/email-otp/config", async (route) => {
      configRequests += 1;
      if (!configAvailable) {
        await route.fulfill({
          status: 503,
          headers: apiMockHeaders,
          json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
        });
        return;
      }
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { enabled: true, codeLength: 6, resendAfterSeconds: 60 } },
      });
    });

    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("email-otp-config-error")).toBeVisible();
    await expect(page.getByTestId("email-otp-request-form")).toHaveCount(0);
    await expect(page.getByTestId("auth-method-telegram")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);

    const requestsBeforeRetry = configRequests;
    configAvailable = true;
    await page.getByTestId("email-otp-config-retry").click();
    await expect(page.getByTestId("email-otp-request-form")).toBeVisible();
    expect(configRequests).toBeGreaterThan(requestsBeforeRetry);
  });
});

test.describe("email OTP auth flow", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
    await page.route("**/api/auth/email-otp/config", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { enabled: true, codeLength: 6, resendAfterSeconds: 60 } },
      });
    });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: emailAuthResponse });
    });
    await page.route("**/api/current-tenant", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: currentTenantResponse });
    });
  });

  test("email code login opens the app without persisting identity data", async ({ page }) => {
    let requestCount = 0;
    let verifyCount = 0;
    await page.route("**/api/auth/email-otp/request", async (route) => {
      requestCount += 1;
      expect(route.request().postDataJSON()).toEqual({ email: "owner@example.com", locale: "en" });
      await route.fulfill({
        headers: apiMockHeaders,
        json: {
          data: {
            sent: true,
            challengeId: "a".repeat(48),
            expiresAt: "2026-07-10T20:10:00.000Z",
            resendAfterSeconds: 60,
            debugCode: "384921",
          },
        },
      });
    });
    await page.route("**/api/auth/email-otp/verify", async (route) => {
      verifyCount += 1;
      expect(route.request().postDataJSON()).toEqual({
        challengeId: "a".repeat(48),
        code: "384921",
      });
      await route.fulfill({ headers: apiMockHeaders, json: emailAuthResponse });
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    await page.getByLabel("Work email").fill("owner@example.com");
    await page.getByTestId("email-otp-request").click();
    await expect(page.getByText("We sent a 6-digit code to owner@example.com")).toBeVisible();
    await expect(page.getByTestId("email-otp-resend")).toBeDisabled();
    await expect(page.getByTestId("email-otp-code-input").locator("input")).toHaveCount(6);
    if (process.env.LEADVIRT_EMAIL_AUTH_SCREENSHOTS === "1") {
      await page.screenshot({
        path: "artifacts/screenshots/email-auth-code-desktop.png",
        animations: "disabled",
      });
    }
    await page.getByTestId("email-otp-verify").click();

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 30_000 });
    expect(requestCount).toBe(1);
    expect(verifyCount).toBe(1);
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
      .toBeNull();
  });

  test("email code signup opens onboarding on mobile", async ({ page }) => {
    await page.route("**/api/auth/email-otp/request", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: {
          data: {
            sent: true,
            challengeId: "b".repeat(48),
            expiresAt: "2026-07-10T20:10:00.000Z",
            resendAfterSeconds: 60,
            debugCode: "624105",
          },
        },
      });
    });
    await page.route("**/api/auth/email-otp/verify", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { ...emailAuthResponse.data, isNewUser: true } },
      });
    });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { ...emailAuthResponse.data, isNewUser: undefined } },
      });
    });
    await page.route("**/api/onboarding/state", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: {
          data: {
            businessProfileVersion: 1,
            businessProfileEtag: '"business-profile-auth-email-1"',
            businessProfileUpdatedAt: "2026-07-17T20:10:00.000Z",
            currentStep: "business",
            completedSteps: [],
            data: {},
            completedAt: null,
          },
        },
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webBase}/signup`, { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill("new-owner@example.com");
    await page.getByTestId("email-otp-request").click();
    if (process.env.LEADVIRT_EMAIL_AUTH_SCREENSHOTS === "1") {
      await page.screenshot({
        path: "artifacts/screenshots/email-auth-code-mobile.png",
        animations: "disabled",
      });
    }
    await page.getByTestId("email-otp-verify").click();
    await expect(page).toHaveURL(`${webBase}/onboarding`, { timeout: 15_000 });
  });

  test("existing email account authenticating from signup opens the app", async ({ page }) => {
    await page.route("**/api/auth/email-otp/request", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: {
          data: {
            sent: true,
            challengeId: "c".repeat(48),
            expiresAt: "2026-07-10T20:10:00.000Z",
            resendAfterSeconds: 60,
            debugCode: "731408",
          },
        },
      });
    });
    await page.route("**/api/auth/email-otp/verify", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { ...emailAuthResponse.data, isNewUser: false } },
      });
    });

    await page.goto(`${webBase}/signup`, { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill("owner@example.com");
    await page.getByTestId("email-otp-request").click();
    await page.getByTestId("email-otp-verify").click();

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 15_000 });
  });
});

test.describe("authenticated route guard", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
    ]);
  });

  test("redirects to login only when the session is unauthorized", async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 401,
        headers: apiMockHeaders,
        json: { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      });
    });

    await page.goto(`${webBase}/app`);

    await expect(page).toHaveURL(`${webBase}/login`, { timeout: 15_000 });
  });

  test("preserves the session and retries a transient auth check", async ({ page }) => {
    let authChecks = 0;
    await page.route("**/api/auth/me", async (route) => {
      authChecks += 1;
      if (authChecks === 1) {
        await route.fulfill({
          status: 503,
          headers: apiMockHeaders,
          json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
        });
        return;
      }
      await route.fulfill({ headers: apiMockHeaders, json: emailAuthResponse });
    });
    await page.route("**/api/current-tenant", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: currentTenantResponse });
    });

    await page.goto(`${webBase}/app`);

    await expect(page).toHaveURL(`${webBase}/app`);
    await expect(page.getByTestId("auth-check-error")).toBeVisible();
    await expect(page.getByText("Your session is preserved.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("product-shell")).toBeVisible({ timeout: 15_000 });
    expect(authChecks).toBeGreaterThanOrEqual(2);
  });
});
