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

const telegramOidcToken = "mock-telegram-id-token";

function telegramPopupInitScript(token: string) {
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const testWindow = window as Window & {
      leadvirtTelegramNextMessage?: unknown;
      leadvirtTelegramPopupCalls?: Array<{ url: string; target?: string; features?: string }>;
      leadvirtTelegramPopupMode?: "closed";
    };
    testWindow.leadvirtTelegramPopupCalls = testWindow.leadvirtTelegramPopupCalls ?? [];
    testWindow.leadvirtTelegramPopupCalls.push({ url: String(url), target, features });
    const popup = {
      closed: false,
      focus() {},
      close() {
        popup.closed = true;
      }
    };
    window.setTimeout(() => {
      if (testWindow.leadvirtTelegramPopupMode === "closed") {
        popup.closed = true;
        return;
      }
      const data = testWindow.leadvirtTelegramNextMessage ?? { event: "auth_result", result: token };
      window.dispatchEvent(new MessageEvent("message", { origin: "https://oauth.telegram.org", data: JSON.stringify(data) }));
      popup.closed = true;
    }, 0);
    return popup as Window;
  }) as typeof window.open;
}

async function completeTelegramAuth(page: Page) {
  const authButton = page.getByTestId("telegram-auth-button");
  await expect(authButton).toBeEnabled({ timeout: 15000 });
  await authButton.click();
}

test.describe("telegram auth flow", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/telegram", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.addInitScript(telegramPopupInitScript, telegramOidcToken);
    await page.route("**/api/auth/telegram/config", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: { data: { botId: "123456" } } });
    });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.route("**/api/current-tenant", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: currentTenantResponse });
    });
  });

  test("login through Telegram opens the app", async ({ page }) => {
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      const body = route.request().postDataJSON() as { idToken?: string; nonce?: string };
      expect(body.idToken).toBe(telegramOidcToken);
      expect(body.nonce).toBeTruthy();
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 15000 });
    const popupCalls = await page.evaluate(() => (window as Window & { leadvirtTelegramPopupCalls?: Array<{ url: string }> }).leadvirtTelegramPopupCalls ?? []);
    const authUrl = new URL(popupCalls[0]?.url ?? "");
    expect(authUrl.origin).toBe("https://oauth.telegram.org");
    expect(authUrl.pathname).toBe("/auth");
    expect(authUrl.searchParams.get("response_type")).toBe("post_message");
    expect(authUrl.searchParams.get("client_id")).toBe("123456");
    expect(authUrl.searchParams.get("origin")).toBe(webBase);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(`${webBase}/login`);
    expect(authUrl.searchParams.get("scope")).toBe("openid profile telegram:bot_access");
    expect(authUrl.searchParams.get("lang")).toBe("ru");
    expect(authUrl.searchParams.get("nonce")).toBeTruthy();
    expect(authUrl.searchParams.get("prompt")).toBeNull();
    await expect.poll(async () => {
      return page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "");
    }).toContain("telegram");
  });

  test("switch account clears local session and logs in through Telegram popup", async ({ page }) => {
    let logoutRequests = 0;
    let oidcRequests = 0;
    await page.route("**/api/auth/logout", async (route) => {
      logoutRequests += 1;
      await route.fulfill({ headers: apiMockHeaders, json: { data: { loggedOut: true } } });
    });
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      oidcRequests += 1;
      const body = route.request().postDataJSON() as { idToken?: string; nonce?: string };
      expect(body.idToken).toBe(telegramOidcToken);
      expect(body.nonce).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.localStorage.setItem("leadvirt.auth.session", "cached"));
    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    const switchAccountButton = page.getByTestId("telegram-switch-account");
    if ((await switchAccountButton.count()) === 0) {
      await expect(page.getByText("Telegram Login client id")).toBeVisible();
      return;
    }

    await switchAccountButton.click();

    const popupCalls = await page.evaluate(() => (window as Window & { leadvirtTelegramPopupCalls?: Array<{ url: string }> }).leadvirtTelegramPopupCalls ?? []);
    expect(popupCalls).toHaveLength(1);
    const authUrl = new URL(popupCalls[0]?.url ?? "");
    expect(authUrl.searchParams.get("client_id")).toBe("123456");
    expect(authUrl.searchParams.get("origin")).toBe(webBase);
    expect(authUrl.searchParams.get("scope")).toBe("openid profile telegram:bot_access");
    expect(authUrl.searchParams.get("lang")).toBe("ru");
    expect(authUrl.searchParams.get("nonce")).toBeTruthy();
    expect(authUrl.searchParams.get("prompt")).toBe("login select_account");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
      .toBeNull();
    await expect(page).toHaveURL(`${webBase}/app`, { timeout: 15000 });
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "")).toContain("telegram");
    expect(logoutRequests).toBe(1);
    expect(oidcRequests).toBe(1);
  });

  test("switch account reports Telegram popup close", async ({ page }) => {
    await page.route("**/api/auth/logout", async (route) => {
      await route.fulfill({ headers: apiMockHeaders, json: { data: { loggedOut: true } } });
    });
    await page.addInitScript(() => {
      (window as Window & { leadvirtTelegramPopupMode?: "closed" }).leadvirtTelegramPopupMode = "closed";
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${webBase}/login`, { waitUntil: "networkidle" });

    const switchAccountButton = page.getByTestId("telegram-switch-account");
    if ((await switchAccountButton.count()) === 0) {
      await expect(page.getByText("Telegram Login client id")).toBeVisible();
      return;
    }

    await switchAccountButton.click();

    await expect(page).toHaveURL(`${webBase}/login`);
    await expect(page.getByText("Telegram закрыл окно без результата")).toBeVisible();
  });

  test("signup through Telegram opens onboarding", async ({ page }) => {
    await page.route("**/api/auth/telegram/oidc", async (route) => {
      const body = route.request().postDataJSON() as { idToken?: string; nonce?: string };
      expect(body.idToken).toBe(telegramOidcToken);
      expect(body.nonce).toBeTruthy();
      await route.fulfill({ headers: apiMockHeaders, json: authResponse });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webBase}/signup`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 2 })).toContainText("LeadVirt.ai");
    await completeTelegramAuth(page);

    await expect(page).toHaveURL(`${webBase}/onboarding`, { timeout: 15000 });
    await expect.poll(async () => {
      return page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session") ?? "");
    }).toContain("telegram");
  });
});
