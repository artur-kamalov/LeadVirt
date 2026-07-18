import { expect, test } from "@playwright/test";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import { messages, type TranslationKey } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

const landingHeadings: Record<Locale, string> = {
  en: "An AI administrator for",
  es: "Un administrador de IA para",
  fr: "Un administrateur IA pour",
  de: "Ein KI-Administrator für",
  pt: "Um administrador de IA para",
  ru: "AI-администратор для",
};

test.describe("six-language localization", () => {
  test.setTimeout(60_000);

  test("English is the default and a language choice persists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(webBase, { waitUntil: "domcontentloaded" });

    const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
    await expect(switcher).toHaveAttribute("data-locale", "en");
    await expect(switcher).toBeEnabled();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "AI administrator for inbound leads, conversations, and sales.",
    );
    await expect(page.locator("header").getByText("LeadVirt.ai", { exact: true })).toBeVisible();
    await expect(page.locator("footer").getByText("LeadVirt.ai", { exact: true })).toBeVisible();
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.locator("footer").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: "artifacts/screenshots/localization-footer.png",
        animations: "disabled",
      });
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await switcher.click();
    await expect(page.locator('[data-testid^="language-option-"]')).toHaveCount(
      supportedLocales.length,
    );
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.screenshot({
        path: "artifacts/screenshots/localization-language-menu.png",
        animations: "disabled",
      });
    }
    await page.getByTestId("language-option-es").click();

    await expect(switcher).toHaveAttribute("data-locale", "es");
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("es");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(landingHeadings.es);
    await expect(page.getByRole("link", { name: "Iniciar gratis" }).first()).toBeVisible();

    const cookies = await page.context().cookies(webBase);
    expect(cookies.find((cookie) => cookie.name === "leadvirt-locale")?.value).toBe("es");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="language-switcher"]:visible').first()).toHaveAttribute(
      "data-locale",
      "es",
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Administrador de IA para clientes potenciales entrantes, conversaciones y ventas.",
    );

    await page.goto(`${webBase}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "Inicie sesión en LeadVirt.ai",
    );
  });

  test("every supported locale renders its landing translation", async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    for (const locale of supportedLocales) {
      await context.addCookies([
        { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
      ]);
      await page.goto(webBase, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator('[data-testid="language-switcher"]:visible').first(),
      ).toHaveAttribute("data-locale", locale);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(landingHeadings[locale]);
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
    }
  });

  test("new locales cover onboarding and workspace overview on mobile", async ({
    context,
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await context.addCookies([
      { name: "leadvirt-locale", value: "pt", url: webBase, sameSite: "Lax" },
    ]);
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        json: {
          data: {
            id: "localization-owner",
            tenantId: "localization-tenant",
            email: "owner@localization.test",
            role: "OWNER",
            authMode: "email",
            passwordChangeRequired: false,
          },
        },
      });
    });
    await page.route("**/api/onboarding/state", async (route) => {
      await route.fulfill({
        json: {
          data: {
            businessProfileVersion: 1,
            businessProfileEtag: '"business-profile-localization-1"',
            businessProfileUpdatedAt: "2026-07-16T12:00:00.000Z",
            currentStep: "business",
            completedSteps: [],
            data: {},
            completedAt: null,
          },
        },
      });
    });

    await page.goto(`${webBase}/onboarding`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Que tipo de negócio é esse?");
    await expect(page.getByText("Etapa 1 de 6")).toBeVisible();
    await expect(page.locator('[data-testid="language-switcher"]:visible')).toHaveAttribute(
      "data-locale",
      "pt",
    );
    await expect(page.getByTestId("onboarding-step-panel")).toHaveCSS("opacity", "1");
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.screenshot({
        path: "artifacts/screenshots/localization-onboarding-pt-mobile.png",
      });
    }

    await context.addCookies([
      { name: "leadvirt-locale", value: "de", url: webBase, sameSite: "Lax" },
    ]);
    await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);
    expect(runtimeErrors).toEqual([]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Übersicht");
    await expect(page.getByText(/^Willkommen, /)).toBeVisible();
    await expect(page.getByText("Neue Leads", { exact: true }).first()).toBeVisible();
    if (process.env.LEADVIRT_LOCALIZATION_SCREENSHOTS === "1") {
      await page.screenshot({
        path: "artifacts/screenshots/localization-dashboard-de-mobile.png",
        animations: "disabled",
      });
    }
  });

  test("all dictionaries preserve interpolation tokens", () => {
    const english = messages.en;

    for (const locale of supportedLocales) {
      for (const key of Object.keys(english) as TranslationKey[]) {
        const expected = [...english[key].matchAll(/\{[a-zA-Z0-9_]+\}/g)]
          .map(([token]) => token)
          .sort();
        const actual = [...messages[locale][key].matchAll(/\{[a-zA-Z0-9_]+\}/g)]
          .map(([token]) => token)
          .sort();
        expect(actual, `${locale}.${key}`).toEqual(expected);
      }
    }
  });
});
