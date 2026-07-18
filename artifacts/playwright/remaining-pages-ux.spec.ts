import { expect, test, type Locator } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function expectTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(43.5);
  expect(box!.height).toBeGreaterThanOrEqual(43.5);
}

test("analytics mobile controls and charts expose truthful accessible evidence", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/analytics`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("analytics-recommendations-empty")).toHaveText(
    "No recommendations available for this period.",
  );
  for (const name of ["7 days", "30 days", "Quarter", "Export"]) {
    await expectTouchTarget(page.getByRole("button", { name, exact: true }));
  }

  const chartIds = [
    "analytics-channel-chart",
    "analytics-scenario-chart",
    "analytics-response-chart-graphic",
    "analytics-trend-chart",
    "analytics-channel-distribution-chart",
  ];
  for (const chartId of chartIds) {
    const chart = page.getByTestId(chartId);
    await expect(chart).toHaveAttribute("role", "img");
    await expect(chart).toHaveAttribute("aria-label", /\S/);
    const surface = chart.locator("svg.recharts-surface");
    await expect(surface).toBeVisible();
    expect(await surface.evaluate((node) => node.closest('[aria-hidden="true"]') !== null)).toBe(
      true,
    );
    const box = await surface.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/demo/analytics`, { waitUntil: "domcontentloaded" });
  for (const chartId of chartIds) {
    const surface = page.getByTestId(chartId).locator("svg.recharts-surface");
    await expect(surface).toBeVisible();
    const box = await surface.boundingBox();
    expect(box?.width).toBeGreaterThan(200);
    expect(box?.height).toBeGreaterThan(200);
  }
  const pieBox = await page
    .getByTestId("analytics-channel-distribution-chart")
    .locator("svg.recharts-surface")
    .boundingBox();
  expect(pieBox?.width).toBeLessThanOrEqual(320);
});

test("pipeline cards, touch controls, mobile title, and desktop overflow cue remain usable", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });

  await expect(page.locator("header").getByText("Pipeline", { exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole("button", { name: "Kanban", exact: true }));
  await expectTouchTarget(page.getByRole("button", { name: "List", exact: true }));
  await expectTouchTarget(page.getByRole("button", { name: "Lead actions: Maria Belova" }));

  const openMaria = page.getByRole("button", { name: "Open conversation: Maria Belova" });
  await expect(openMaria).toBeVisible();
  await openMaria.press("Enter");
  await expect(page).toHaveURL(/\/demo\/inbox\/[^/]+$/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });
  const board = page.getByTestId("pipeline-kanban-scroll");
  await expect.poll(() => board.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(page.getByTestId("pipeline-scroll-cue")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("billing, settings, and automation expose clear mobile affordances", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/demo/billing`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Payment history", { exact: true })).toBeVisible();
  const invoiceButtons = page.getByRole("button", { name: /Download invoice/ });
  const invoiceCount = await invoiceButtons.count();
  expect(invoiceCount).toBeGreaterThan(0);
  for (let index = 0; index < invoiceCount; index += 1) {
    await expectTouchTarget(invoiceButtons.nth(index));
  }

  await page.goto(`${webBase}/demo/settings`, { waitUntil: "domcontentloaded" });
  const notice = page.getByTestId("settings-demo-read-only-notice");
  await expect(notice).toContainText("This sample workspace is read-only.");
  await expect(notice.getByRole("link", { name: "Create account" })).toHaveAttribute(
    "href",
    "/signup",
  );

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/automations`, { waitUntil: "domcontentloaded" });
  const scenarioTabs = page.getByTestId("automation-scenario-tabs");
  await expect(scenarioTabs).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => scenarioTabs.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
    true,
  );
  const next = page.getByTestId("automation-scenario-tabs-next");
  await expect(next).toBeVisible();
  await expectTouchTarget(next);
  const before = await scenarioTabs.evaluate((node) => node.scrollLeft);
  await next.click();
  await expect.poll(() => scenarioTabs.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before);

  const tabs = scenarioTabs.getByRole("button");
  expect(await tabs.count()).toBeGreaterThanOrEqual(3);
  const lastTab = tabs.nth(2);
  await lastTab.click();
  await expect.poll(async () => {
    const tabBox = await lastTab.boundingBox();
    const viewportBox = await scenarioTabs.boundingBox();
    return Boolean(
      tabBox &&
        viewportBox &&
        tabBox.x >= viewportBox.x - 1 &&
        tabBox.x + tabBox.width <= viewportBox.x + viewportBox.width + 1,
    );
  }).toBe(true);
});
