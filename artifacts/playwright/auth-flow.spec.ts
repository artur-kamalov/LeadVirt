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
    expiresAt: "2026-07-27T00:00:00.000Z"
  }
};

const currentTenantResponse = {
  data: {
    id: "tenant-demo",
    name: "API Studio",
    slug: "api-studio",
    status: "TRIALING",
    businessType: "education",
    timezone: "Europe/Moscow",
    role: "OWNER"
  }
};

const apiMockHeaders = {
  "access-control-allow-origin": webBase,
  "access-control-allow-credentials": "true",
  "content-type": "application/json"
};

const telegramWidgetPayload = {
  id: 100000001,
  first_name: "Local",
  last_name: "Telegram",
  username: "leadvirt_local",
  auth_date: 1783728000,
  hash: "signed-widget-payload"
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
  testWindow.Telegram = testWindow.Telegram || {};
  testWindow.Telegram.Login = testWindow.Telegram.Login || {};
  testWindow.Telegram.Login.auth = (options, callback) => {
    testWindow.leadvirtTelegramLoginAuthCalls = testWindow.leadvirtTelegramLoginAuthCalls || [];
    testWindow.leadvirtTelegramLoginAuthCalls.push(options);
    if (testWindow.leadvirtTelegramAuthCallbackPayload) {
      callback(testWindow.leadvirtTelegramAuthCallbackPayload);
    }
  };
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.testid = "telegram-widget-mock-button";
  button.textContent = "Log in with Telegram";
  button.addEventListener("click", () => {
    const payload = testWindow.leadvirtTelegramNextPayload || ${JSON.stringify(telegramWidgetPayload)};
    new Function("user", script.getAttribute("data-onauth"))(payload);
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
    await page.route("https://telegram.org/js/telegram-widget.js**", async (route) => {
      await route.fulfill({ contentType: "application/javascript", body: telegramWidgetMock });
    });
    await page.route("**/api/auth/telegram/config", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: { data: { botId: "123456", botUsername: "LeadVirtAi_bot" } } });
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
    await expect(page.getByTestId("telegram-switch-account")).toBeVisible();
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 30000 });
    const scripts = await page.evaluate(() => (window as Window & { leadvirtTelegramWidgetScripts?: Array<Record<string, string | null>> }).leadvirtTelegramWidgetScripts ?? []);
    expect(scripts[0]).toMatchObject({
      login: "LeadVirtAi_bot",
      size: "large",
      userpic: "false",
      radius: "12",
      requestAccess: "write",
      lang: "ru",
      onauth: "window.__leadvirtTelegramAuth(user)"
    });
    expect(oidcRequests).toBe(0);
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "")).toContain("telegram");
  });

  test("switch account clears LeadVirt session, remounts widget, and opens Telegram auth", async ({ page }) => {
    let logoutRequests = 0;
    await page.route("**/api/auth/logout", async (route) => {
      logoutRequests += 1;
      await route.fulfill({ headers: apiMockHeaders, json: { data: { loggedOut: true } } });
    });
    await page.route("**/api/auth/telegram", async (route) => {
      await route.abort();
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.localStorage.setItem("leadvirt.auth.session", "cached");
      window.localStorage.setItem("leadvirt.demo.session", "cached-demo");
    });

    await page.getByTestId("telegram-switch-account").click();

    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session"))).toBeNull();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("leadvirt.demo.session"))).toBeNull();
    await expect.poll(() => logoutRequests).toBe(1);
    await expect(page.getByTestId("telegram-auth-button")).toHaveAttribute("data-telegram-widget-mount", "1");
    const authCalls = await page.evaluate(
      () =>
        (window as Window & { leadvirtTelegramLoginAuthCalls?: Array<{ bot_id: string; request_access?: string; lang?: string }> })
          .leadvirtTelegramLoginAuthCalls ?? []
    );
    expect(authCalls).toEqual([{ bot_id: "123456", request_access: "write", lang: "ru" }]);
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
      (window as Window & { leadvirtTelegramNextPayload?: unknown }).leadvirtTelegramNextPayload = { id: 100000001 };
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
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webBase}/signup`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/onboarding`, { timeout: 15000 });
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "")).toContain("telegram");
  });
});
