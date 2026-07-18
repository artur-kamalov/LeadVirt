import { expect, type Page, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

const authResponse = {
  data: {
    id: "user-demo",
    tenantId: "tenant-demo",
    email: "telegram-100000001@telegram.leadvirt.internal",
    phone: null,
    name: "Студия Glow",
    avatarUrl: null,
    role: "OWNER",
    authMode: "telegram",
    passwordChangeRequired: false,
    expiresAt: "2026-07-27T00:00:00.000Z",
  },
};

const emailAuthResponse = {
  data: {
    ...authResponse.data,
    email: "owner@example.com",
    name: "Email Owner",
    authMode: "email",
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

const telegramWidgetPayload = {
  id: 100000001,
  first_name: "Local",
  last_name: "Telegram",
  username: "leadvirt_local",
  auth_date: 1783728000,
  hash: "signed-widget-payload",
};

const telegramWidgetMock = `
  const script = document.currentScript;
  const testWindow = window;
  testWindow.leadvirtTelegramWidgetScripts = testWindow.leadvirtTelegramWidgetScripts || [];
  testWindow.leadvirtTelegramWidgetScripts.push({
    login: script.getAttribute("data-telegram-login"),
    size: script.getAttribute("data-size"),
    userpic: script.getAttribute("data-userpic"),
    radius: script.getAttribute("data-radius"),
    requestAccess: script.getAttribute("data-request-access"),
    lang: script.getAttribute("data-lang"),
    onauth: script.getAttribute("data-onauth")
  });
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.testid = "telegram-widget-mock-button";
  button.textContent = "Log in with Telegram";
  button.addEventListener("click", () => {
    const payload = testWindow.leadvirtTelegramNextPayload || ${JSON.stringify(telegramWidgetPayload)};
    testWindow.__leadvirtTelegramAuth(payload);
  });
  script.parentNode.insertBefore(button, script);
`;

async function completeTelegramAuth(page: Page) {
  const authButton = page.getByTestId("telegram-widget-mock-button");
  await expect(authButton).toBeEnabled({ timeout: 15000 });
  await authButton.click();
}

test.describe("telegram auth flow", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
    await page.route("**/api/auth/email-otp/config", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { enabled: false, codeLength: 6, resendAfterSeconds: 60 } },
      });
    });
    await page.route("https://telegram.org/js/telegram-widget.js**", async (route) => {
      await route.fulfill({ contentType: "application/javascript", body: telegramWidgetMock });
    });
    await page.route("**/api/auth/telegram/config", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { botId: "123456", botUsername: "LeadVirtAi_bot" } },
      });
    });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.route("**/api/current-tenant", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: currentTenantResponse });
    });
  });

  test("login through official Telegram widget opens the app", async ({ page }) => {
    let oidcRequests = 0;
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      oidcRequests += 1;
      await route.abort();
    });
    await page.route("**/api/auth/telegram", async (route) => {
      const body = route.request().postDataJSON() as typeof telegramWidgetPayload;
      expect(body).toMatchObject(telegramWidgetPayload);
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await expect(page.getByTestId("telegram-brand-button")).toBeVisible();
    await expect(page.getByTestId("telegram-switch-account")).toHaveCount(0);
    await page.evaluate(() => {
      window.localStorage.setItem(
        "leadvirt.auth.session",
        JSON.stringify({ email: "legacy@example.com", authMode: "credentials" }),
      );
    });
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 30000 });
    const scripts = await page.evaluate(
      () =>
        (
          window as Window & {
            leadvirtTelegramWidgetScripts?: Array<Record<string, string | null>>;
          }
        ).leadvirtTelegramWidgetScripts ?? [],
    );
    expect(scripts[0]).toMatchObject({
      login: "LeadVirtAi_bot",
      size: "large",
      userpic: "false",
      radius: "12",
      requestAccess: "write",
      lang: "ru",
      onauth: "window.__leadvirtTelegramAuth(user)",
    });
    expect(oidcRequests).toBe(0);
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
      .toBeNull();
  });

  test("invalid Telegram widget payload stays on login", async ({ page }) => {
    let authRequests = 0;
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      await route.abort();
    });
    await page.route("**/api/auth/telegram", async (route) => {
      authRequests += 1;
      await route.abort();
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      (window as Window & { leadvirtTelegramNextPayload?: unknown }).leadvirtTelegramNextPayload = {
        id: 100000001,
      };
    });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/login`);
    await expect(page.getByText("Telegram вернул некорректный ответ")).toBeVisible();
    expect(authRequests).toBe(0);
  });

  test("signup through Telegram opens onboarding", async ({ page }) => {
    await page.route("**/api/auth/telegram", async (route) => {
      const body = route.request().postDataJSON() as typeof telegramWidgetPayload;
      expect(body).toMatchObject(telegramWidgetPayload);
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { ...authResponse.data, isNewUser: true } },
      });
    });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: { data: { ...authResponse.data, isNewUser: undefined } },
      });
    });
    await page.route("**/api/onboarding/state", async (route) => {
      await route.fulfill({
        headers: apiMockHeaders,
        json: {
          data: {
            businessProfileVersion: 1,
            businessProfileEtag: '"business-profile-auth-telegram-1"',
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

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/onboarding`, { timeout: 15000 });
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
      .toBeNull();
  });

  test("signup distinguishes identity auth from the business Telegram connection", async ({
    context,
    page,
  }) => {
    const copy = {
      en: "Telegram verifies your identity through the LeadVirt authentication bot. You connect your business channel or bot later.",
      ru: "Telegram подтверждает вашу личность через бота авторизации LeadVirt. Бизнес-канал или бот вы подключите позже.",
      es: "Telegram verifica tu identidad mediante el bot de acceso de LeadVirt. Conectarás después el canal o bot de tu negocio.",
      fr: "Telegram vérifie votre identité via le bot d’authentification LeadVirt. Vous connecterez ensuite le canal ou le bot de votre entreprise.",
      de: "Telegram bestätigt Ihre Identität über den LeadVirt-Anmeldebot. Den Kanal oder Bot Ihres Unternehmens verbinden Sie später.",
      pt: "O Telegram verifica sua identidade pelo bot de autenticação do LeadVirt. Você conectará depois o canal ou bot da sua empresa.",
    } as const;

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [locale, explanation] of Object.entries(copy)) {
      await context.addCookies([
        { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
      ]);
      await page.goto(`${webBase}/signup`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("telegram-signup-explanation")).toHaveText(explanation);
    }

    await page.goto(`${webBase}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("telegram-signup-explanation")).toHaveCount(0);
  });
});

test.describe("email OTP configuration", () => {
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
      page.getByTestId("auth-method-email"),
      page.getByTestId("auth-method-telegram"),
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
    await expect(page.getByTestId("auth-method-email")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("auth-method-telegram")).toHaveAttribute("aria-pressed", "false");
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

    await expect(page.getByTestId("auth-method-email")).toHaveAttribute("aria-pressed", "true");
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
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
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
