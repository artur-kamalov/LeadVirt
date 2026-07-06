import { test, expect, type Page } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const refBase = "http://localhost:5173";
const routeChangeTimeoutMs = 15000;

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 }
] as const;

const webRoutes = [
  { name: "root", path: "/", readyText: /AI-администратор/ },
  { name: "login", path: "/login", readyText: /Вход в LeadVirt\.ai/ },
  { name: "signup", path: "/signup", readyText: /Запуск LeadVirt\.ai/ },
  { name: "demo", path: "/demo", readyText: /Demo read-only|Студия Лето/ },
  { name: "onboarding", path: "/onboarding", readyText: /С каким бизнесом|Откуда приходят клиенты|Выберите сценарий AI|Информация о компании|Куда отправлять лиды|Всё готово/, requiresAuth: true },
  { name: "app", path: "/app", readyText: /Добро пожаловать/, requiresAuth: true },
  { name: "inbox", path: "/app/inbox", readyText: /Диалогов пока нет|Входящие/, requiresAuth: true },
  { name: "conversation", path: "/app/inbox/demo", readyText: /Диалог не найден|Загружаем диалог/, requiresAuth: true },
  { name: "leads", path: "/app/leads", readyText: /Воронка продаж/, requiresAuth: true },
  { name: "automations", path: "/app/automations", readyText: /Автоматизация|Тест/, requiresAuth: true },
  { name: "analytics", path: "/app/analytics", readyText: /Лиды по каналам/, requiresAuth: true },
  { name: "integrations", path: "/app/integrations", readyText: /Интеграции|API ключи/, requiresAuth: true },
  { name: "settings", path: "/app/settings", readyText: /Основная информация/, requiresAuth: true },
  { name: "billing", path: "/app/billing", readyText: /Биллинг и подписка/, requiresAuth: true }
] as const;

function isBenignBrowserNoise(message: string) {
  return (
    (message.includes("A tree hydrated") && message.includes("caret-color")) ||
    (message.includes("_rsc=") && message.includes("net::ERR_ABORTED")) ||
    (message.includes("localhost:4001/api/") && message.includes("net::ERR_CONNECTION_REFUSED")) ||
    message === "Failed to load resource: net::ERR_CONNECTION_REFUSED" ||
    message.includes("/favicon.ico") ||
    message === "Failed to load resource: the server responded with a status of 404 ()" ||
    message === "Failed to load resource: the server responded with a status of 404 (Not Found)"
  );
}

function recordPageErrors(page: Page, errors: string[]) {
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isBenignBrowserNoise(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    const message = `${request.url()} ${failure?.errorText ?? "failed"}`;
    if (!isBenignBrowserNoise(message)) errors.push(message);
  });
}

async function waitForRouteReady(page: Page, readyText: RegExp) {
  await expect
    .poll(
      async () => {
        const matches = page.getByText(readyText);
        const count = await matches.count();
        for (let index = 0; index < count; index += 1) {
          if (await matches.nth(index).isVisible()) return true;
        }
        return false;
      },
      { timeout: 5000 }
    )
    .toBe(true);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

test.describe("LeadVirt copied UI smoke", () => {
  test.describe.configure({ timeout: 60000 });

  for (const viewport of viewports) {
    for (const route of webRoutes) {
      test(`web ${route.name} ${viewport.name}`, async ({ page }) => {
        const errors: string[] = [];
        recordPageErrors(page, errors);

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        if (route.requiresAuth) {
          await loginAsCleanUser(page, apiBase);
        }
        await page.goto(`${webBase}${route.path}`, { waitUntil: "networkidle" });
        await expect(page.locator("body")).not.toBeEmpty();
        await waitForRouteReady(page, route.readyText);
        await page.screenshot({
          path: `artifacts/playwright/fresh-web-${route.name}-${viewport.name}.png`,
          fullPage: true
        });

        expect(errors).toEqual([]);
      });
    }

    test(`reference root ${viewport.name}`, async ({ page }) => {
      const errors: string[] = [];
      recordPageErrors(page, errors);

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(refBase, { waitUntil: "networkidle" });
      await expect(page.locator("body")).not.toBeEmpty();
      await waitForRouteReady(page, /AI-администратор/);
      await page.screenshot({
        path: `artifacts/playwright/fresh-reference-root-${viewport.name}.png`,
        fullPage: true
      });

      expect(errors).toEqual([]);
    });
  }

  test("desktop landing CTAs and product navigation map to Next routes", async ({ page }) => {
    const errors: string[] = [];
    recordPageErrors(page, errors);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(webBase, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /^Войти$/ }).click();
    await expect(page).toHaveURL(`${webBase}/login`, { timeout: routeChangeTimeoutMs });
    await waitForRouteReady(page, /Вход в LeadVirt\.ai/);

    await page.goto(webBase, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /^Смотреть демо$/ }).click();
    await expect(page).toHaveURL(`${webBase}/demo`, { timeout: routeChangeTimeoutMs });
    await waitForRouteReady(page, /Demo read-only|Студия Лето/);

    await loginAsCleanUser(page, apiBase);
    await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
    await waitForRouteReady(page, /Добро пожаловать/);

    const navTargets = [
      { label: /^Входящие$/, url: "/app/inbox", readyText: /Диалогов пока нет|Входящие/ },
      { label: /^Воронка \/ CRM$/, url: "/app/leads", readyText: /Воронка продаж/ },
      { label: /^Автоматизация$/, url: "/app/automations", readyText: /Тест/ },
      { label: /^Аналитика$/, url: "/app/analytics", readyText: /Лиды по каналам/ },
      { label: /^Интеграции$/, url: "/app/integrations", readyText: /API ключи/ },
      { label: /^Настройки$/, url: "/app/settings", readyText: /Основная информация/ }
    ] as const;
    const sidebarNav = page.getByRole("complementary").getByRole("navigation");

    for (const target of navTargets) {
      await sidebarNav.getByRole("link", { name: target.label }).click();
      await expect(page).toHaveURL(`${webBase}${target.url}`, { timeout: routeChangeTimeoutMs });
      await waitForRouteReady(page, target.readyText);
    }

    expect(errors).toEqual([]);
  });

  test("mobile bottom navigation maps to Next routes", async ({ page }) => {
    const errors: string[] = [];
    recordPageErrors(page, errors);

    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsCleanUser(page, apiBase);
    await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });
    await waitForRouteReady(page, /Добро пожаловать/);

    const navTargets = [
      { label: /^Чаты$/, url: "/app/inbox", readyText: /Диалогов пока нет|Входящие/ },
      { label: /^Воронка$/, url: "/app/leads", readyText: /Воронка продаж/ },
      { label: /^Аналитика$/, url: "/app/analytics", readyText: /Лиды по каналам/ },
      { label: /^Ещё$/, url: "/app/settings", readyText: /Основная информация/ },
      { label: /^Обзор$/, url: "/app", readyText: /Добро пожаловать/ }
    ] as const;

    for (const target of navTargets) {
      await page.getByRole("link", { name: target.label }).last().click();
      await expect(page).toHaveURL(`${webBase}${target.url}`, { timeout: routeChangeTimeoutMs });
      await waitForRouteReady(page, target.readyText);
    }

    expect(errors).toEqual([]);
  });
});
