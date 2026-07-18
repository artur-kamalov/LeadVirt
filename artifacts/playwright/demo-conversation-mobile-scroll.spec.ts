import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

const mobileViewports = [
  { name: "320px", width: 320, height: 640 },
  { name: "390px", width: 390, height: 720 },
] as const;

async function conversationScrollState(page: Page) {
  return page.getByTestId("conversation-messages-scroll").evaluate((element) => ({
    scrollTop: element.scrollTop,
    maxScrollTop: element.scrollHeight - element.clientHeight,
  }));
}

for (const viewport of mobileViewports) {
  test(`demo AI reply clears the fixed navigation at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize(viewport);
    await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, { waitUntil: "domcontentloaded" });

    const latestReply = page.getByTestId("conversation-message-demo-replay-anna-6");
    const mobileNavigation = page.getByTestId("product-mobile-bottom-navigation");
    await expect(latestReply).toBeVisible({ timeout: 30_000 });
    await expect(mobileNavigation).toBeVisible();

    await expect
      .poll(async () => {
        const [replyBox, navigationBox] = await Promise.all([
          latestReply.boundingBox(),
          mobileNavigation.boundingBox(),
        ]);
        if (!replyBox || !navigationBox) return -1;
        return navigationBox.y - (replyBox.y + replyBox.height);
      })
      .toBeGreaterThanOrEqual(0);

    const scrollState = await conversationScrollState(page);
    expect(scrollState.maxScrollTop - scrollState.scrollTop).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: `artifacts/screenshots/demo-conversation-live-end-${viewport.width}.png`,
      animations: "disabled",
    });
  });
}

test("demo replay stops following after the reader scrolls away", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("conversation-message-demo-replay-anna-4")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await conversationScrollState(page)).maxScrollTop)
    .toBeGreaterThan(100);

  const messages = page.getByTestId("conversation-messages-scroll");
  await messages.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(async () => (await conversationScrollState(page)).scrollTop)
    .toBeLessThanOrEqual(2);

  await expect(page.getByTestId("conversation-message-demo-replay-anna-6")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await conversationScrollState(page)).scrollTop)
    .toBeLessThanOrEqual(2);
  expect((await conversationScrollState(page)).maxScrollTop).toBeGreaterThan(100);
});
