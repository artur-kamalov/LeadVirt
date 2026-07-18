import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

const locales = [
  {
    code: "en",
    tag: "en-US",
    open: "Open chat",
    close: "Close chat",
    placeholder: "Write a message...",
    secure: "Secure session",
    demoTitle: "LeadVirt.ai website widget",
  },
  {
    code: "es",
    tag: "es-ES",
    open: "Abrir chat",
    close: "Cerrar chat",
    placeholder: "Escribe un mensaje...",
    secure: "Sesión segura",
    demoTitle: "Widget de LeadVirt.ai para sitios web",
  },
  {
    code: "fr",
    tag: "fr-FR",
    open: "Ouvrir le chat",
    close: "Fermer le chat",
    placeholder: "Écrivez un message...",
    secure: "Session sécurisée",
    demoTitle: "Widget LeadVirt.ai pour site web",
  },
  {
    code: "de",
    tag: "de-DE",
    open: "Chat öffnen",
    close: "Chat schließen",
    placeholder: "Nachricht schreiben...",
    secure: "Sichere Sitzung",
    demoTitle: "LeadVirt.ai Website-Widget",
  },
  {
    code: "pt",
    tag: "pt-BR",
    open: "Abrir chat",
    close: "Fechar chat",
    placeholder: "Escreva uma mensagem...",
    secure: "Sessão segura",
    demoTitle: "Widget da LeadVirt.ai para sites",
  },
  {
    code: "ru",
    tag: "ru-RU",
    open: "Открыть чат",
    close: "Закрыть чат",
    placeholder: "Напишите сообщение...",
    secure: "Защищённая сессия",
    demoTitle: "Виджет LeadVirt.ai для сайта",
  },
] as const;

function widgetConfig(code: string, locale: string) {
  return {
    publicKey: `widget-${code}`,
    tenantName: `Tenant ${code}`,
    businessName: `Business ${code}`,
    title: `Tenant title ${code}`,
    subtitle: `Tenant subtitle ${code}`,
    welcomeMessage: `Tenant welcome ${code}`,
    primaryColor: "#34d399",
    accentColor: "#10b981",
    position: "bottom-right",
    locale,
    suggestedReplies: [`Tenant reply ${code}`],
    consentText: `Tenant consent ${code}`,
    poweredBy: `Tenant brand ${code}`,
  };
}

async function mockWidgetConfig(page: Page) {
  await page.route(/\/api\/public\/widget\/([^/]+)\/config(?:\?.*)?$/u, async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /\/widget\/widget-([^/]+)\/config$/u,
    );
    const code = match?.[1] ?? "en";
    const entry = locales.find((item) => item.code === code) ?? locales[0];
    await route.fulfill({ json: { data: widgetConfig(entry.code, entry.tag) } });
  });
}

test("public widget chrome follows the tenant locale and preserves tenant content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mockWidgetConfig(page);

  for (const locale of locales) {
    await page.goto(`${webBase}/widget/frame?key=widget-${locale.code}`, {
      waitUntil: "networkidle",
    });

    const widget = page.getByTestId("leadvirt-widget");
    await expect(widget).toHaveAttribute("data-widget-locale", locale.code);
    await expect(widget).toHaveAttribute("lang", locale.code);
    await page.getByRole("button", { name: locale.open }).click();

    await expect(page.getByRole("button", { name: locale.close })).toBeVisible();
    await expect(page.getByPlaceholder(locale.placeholder)).toBeVisible();
    await expect(page.getByText(locale.secure, { exact: true })).toBeVisible();
    await expect(page.getByText(`Tenant title ${locale.code}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Tenant welcome ${locale.code}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Tenant reply ${locale.code}`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("widget-consent")).toHaveText(`Tenant consent ${locale.code}`);

    const panel = page.getByTestId("leadvirt-widget-panel");
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await page.screenshot({
    path: "artifacts/playwright/widget-localization-mobile.png",
    fullPage: true,
  });
});

test("widget demo follows the browser locale across all supported languages", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWidgetConfig(page);

  for (const locale of locales) {
    await context.addCookies([
      { name: "leadvirt-locale", value: locale.code, url: webBase, sameSite: "Lax" },
    ]);
    await page.goto(`${webBase}/widget/demo`, { waitUntil: "networkidle" });

    await expect(page.getByTestId("widget-demo")).toHaveAttribute(
      "data-widget-demo-locale",
      locale.code,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale.demoTitle);
    const widget = page.getByTestId("leadvirt-widget");
    await expect(widget).toHaveAttribute("data-widget-locale", locale.code);
    await page.getByRole("button", { name: locale.open }).click();
    await expect(page.getByRole("button", { name: locale.close })).toBeVisible();
    await expect(page.getByPlaceholder(locale.placeholder)).toBeVisible();
    await expect(page.getByText(locale.secure, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("widget send failures use tenant-localized chrome", async ({ page }) => {
  await page.route("**/api/public/widget/widget-es/config", async (route) => {
    await route.fulfill({ json: { data: widgetConfig("es", "es-ES") } });
  });
  await page.route("**/api/public/widget/widget-es/messages", async (route) => {
    await route.fulfill({
      status: 503,
      json: { error: { code: "HTTP_ERROR", message: "Raw server error" } },
    });
  });

  await page.goto(`${webBase}/widget/frame?key=widget-es`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Abrir chat" }).click();
  await page.getByPlaceholder("Escribe un mensaje...").fill("Necesito ayuda");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();

  await expect(page.getByText("El mensaje no se ha enviado. Inténtalo de nuevo.")).toBeVisible();
  await expect(page.getByText("Error", { exact: true })).toBeVisible();
  await expect(page.getByText("Raw server error")).toHaveCount(0);
});

test("missing widget key uses the browser locale without calling the public API", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "de", url: webBase, sameSite: "Lax" },
  ]);
  let publicApiCalls = 0;
  await page.route("**/api/public/widget/**", async (route) => {
    publicApiCalls += 1;
    await route.abort();
  });

  await page.goto(`${webBase}/widget/frame`, { waitUntil: "networkidle" });

  const missing = page.getByTestId("widget-missing-key");
  await expect(missing).toHaveAttribute("data-widget-locale", "de");
  await expect(missing).toContainText("Der LeadVirt-Widget-Schlüssel ist erforderlich");
  expect(publicApiCalls).toBe(0);
});
