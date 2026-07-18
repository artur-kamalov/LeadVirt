import { expect, test, type Page } from "@playwright/test";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";

const webBase = process.env.LEADVIRT_WEB_URL ?? "http://localhost:3001";

const viewports = [
  { name: "mobile", width: 320, height: 568 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const directRoutes = [
  { route: "/solutions", section: "#niches", destination: "/#niches" },
  { route: "/features", section: "#features", destination: "/#features" },
  { route: "/pricing", section: "#pricing", destination: "/#pricing" },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(widths.document).toBe(widths.viewport);
  expect(widths.body).toBe(widths.viewport);
}

async function expectControlInsideViewport(page: Page, testId: string, viewportWidth: number) {
  const control = page.getByTestId(testId);
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  expect(
    await control.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth + 1 &&
        element.scrollHeight <= element.clientHeight + 1,
    ),
  ).toBe(true);
}

async function useLocale(page: Page, locale: Locale) {
  await page.context().addCookies([
    { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(webBase, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
}

for (const viewport of viewports) {
  test(`${viewport.name} direct marketing routes reveal their named sections`, async ({ page }) => {
    await page.setViewportSize(viewport);

    for (const { route, section, destination } of directRoutes) {
      await page.goto(`${webBase}${route}`, { waitUntil: "domcontentloaded" });

      const target = page.locator(section);
      await expect(target).toBeVisible();
      await expect
        .poll(async () => Math.round((await target.boundingBox())?.y ?? -1), { timeout: 10_000 })
        .toBe(80);
      await expect(page).toHaveURL(`${webBase}${destination}`);
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`${viewport.name} landing first viewport continues into the next section`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(webBase, { waitUntil: "domcontentloaded" });

    const heroBox = await page.getByTestId("landing-hero").boundingBox();
    const nextBox = await page.getByTestId("landing-next-section").boundingBox();
    expect(heroBox).not.toBeNull();
    expect(nextBox).not.toBeNull();
    expect(Math.round(heroBox!.y + heroBox!.height)).toBe(Math.round(nextBox!.y));
    expect(viewport.height - nextBox!.y).toBeGreaterThanOrEqual(32);
    expect(nextBox!.y + nextBox!.height).toBeGreaterThan(viewport.height);
    await expectNoHorizontalOverflow(page);
  });
}

test("320px landing CTAs fit and preserve the next-section hint in every locale", async ({
  page,
}) => {
  const viewport = { width: 320, height: 568 };
  await page.setViewportSize(viewport);

  for (const locale of supportedLocales) {
    await useLocale(page, locale);
    await expectControlInsideViewport(page, "landing-primary-cta", viewport.width);
    await expectControlInsideViewport(page, "landing-demo-cta", viewport.width);

    const nextBox = await page.getByTestId("landing-next-section").boundingBox();
    expect(nextBox, locale).not.toBeNull();
    expect(viewport.height - nextBox!.y, locale).toBeGreaterThanOrEqual(32);
    await expectNoHorizontalOverflow(page);
  }
});
