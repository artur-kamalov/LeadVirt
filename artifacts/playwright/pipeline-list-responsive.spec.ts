import { expect, test, type Locator, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function openListView(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });
  const listButton = page.getByRole("button", { name: "List", exact: true });
  await expect(listButton).toBeVisible();
  await listButton.click();
}

async function expectInside(field: Locator, card: Locator) {
  const [fieldBox, cardBox] = await Promise.all([field.boundingBox(), card.boundingBox()]);
  expect(fieldBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(fieldBox!.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
  expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
}

test("pipeline view selector exposes the active view", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });

  const kanbanButton = page.getByRole("button", { name: "Kanban", exact: true });
  const listButton = page.getByRole("button", { name: "List", exact: true });
  await expect(kanbanButton).toHaveAttribute("aria-pressed", "true");
  await expect(listButton).toHaveAttribute("aria-pressed", "false");

  await listButton.click();
  await expect(listButton).toHaveAttribute("aria-pressed", "true");
  await expect(kanbanButton).toHaveAttribute("aria-pressed", "false");

  await kanbanButton.click();
  await expect(kanbanButton).toHaveAttribute("aria-pressed", "true");
  await expect(listButton).toHaveAttribute("aria-pressed", "false");
});

test("mobile pipeline list exposes every lead field and conversation action", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);

  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await openListView(page, viewport.width, viewport.height);

    const mobileList = page.getByTestId("pipeline-list-mobile");
    await expect(mobileList).toBeVisible();
    await expect(page.getByTestId("pipeline-list-table")).toBeHidden();

    const cards = mobileList.locator('[data-testid^="pipeline-list-card-"]');
    await expect(cards).toHaveCount(4);

    for (const card of await cards.all()) {
      await expect(card).toBeVisible();
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

      for (const fieldName of ["stage", "temperature", "channel", "value", "manager"]) {
        const field = card.locator(`[data-field="${fieldName}"]`);
        await expect(field).toBeVisible();
        await expectInside(field, card);
      }

      await expect(card.getByText("Open conversation", { exact: true })).toBeVisible();
      const openButton = card.getByRole("button", { name: /Open conversation:/ });
      const openBox = await openButton.boundingBox();
      expect(openBox).not.toBeNull();
      expect(openBox!.width).toBeGreaterThanOrEqual(44);
      expect(openBox!.height).toBeGreaterThanOrEqual(44);
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await page.getByRole("button", { name: "Open conversation: Maria Belova" }).click();
  await expect(page).toHaveURL(/\/demo\/inbox\/[^/]+$/);
});

test("desktop pipeline list preserves the dense table and keyboard navigation", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await openListView(page, 1440, 900);

  const tableRegion = page.getByTestId("pipeline-list-table");
  await expect(tableRegion).toBeVisible();
  await expect(page.getByTestId("pipeline-list-mobile")).toBeHidden();
  await expect(tableRegion.locator("thead th")).toHaveCount(7);
  expect(await tableRegion.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

  for (const heading of ["Lead", "Stage", "Channel", "Value", "Manager", "Temperature"]) {
    await expect(
      tableRegion.getByRole("columnheader", { name: heading, exact: true }),
    ).toBeVisible();
  }

  const mariaRow = tableRegion
    .locator('[data-testid^="pipeline-list-row-"]')
    .filter({ hasText: "Maria Belova" });
  await expect(mariaRow).toHaveCount(1);
  await mariaRow.focus();
  await mariaRow.press("Enter");
  await expect(page).toHaveURL(/\/demo\/inbox\/[^/]+$/);
});
