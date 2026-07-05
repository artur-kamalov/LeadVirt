import { expect, test } from "@playwright/test";

const webUrl = process.env.LEADVIRT_WEB_URL ?? "http://localhost:3001";

test("landing page renders smoothly enough during first scroll", async ({ page }) => {
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor({ state: "visible" });
  await page.screenshot({
    path: "artifacts/playwright/landing-performance.png",
    fullPage: false,
  });

  const metrics = await page.evaluate(async () => {
    window.scrollTo(0, 0);

    return await new Promise<{
      frames: number;
      averageFrameMs: number;
      p95FrameMs: number;
      approximateFps: number;
    }>((resolve) => {
      const frameDurations: number[] = [];
      const start = performance.now();
      let previous = start;
      const targetScroll = Math.min(
        document.documentElement.scrollHeight - window.innerHeight,
        window.innerHeight * 1.8,
      );

      const step = (now: number) => {
        frameDurations.push(now - previous);
        previous = now;

        const progress = Math.min((now - start) / 1800, 1);
        window.scrollTo(0, targetScroll * progress);

        if (progress < 1) {
          requestAnimationFrame(step);
          return;
        }

        const measured = frameDurations.slice(1);
        const averageFrameMs =
          measured.reduce((sum, duration) => sum + duration, 0) /
          Math.max(measured.length, 1);
        const sorted = [...measured].sort((a, b) => a - b);
        const p95FrameMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

        resolve({
          frames: measured.length,
          averageFrameMs,
          p95FrameMs,
          approximateFps: 1000 / Math.max(averageFrameMs, 1),
        });
      };

      requestAnimationFrame(step);
    });
  });

  console.log(
    `Landing scroll sample: ${metrics.frames} frames, avg ${metrics.averageFrameMs.toFixed(
      1,
    )}ms, p95 ${metrics.p95FrameMs.toFixed(1)}ms, ~${metrics.approximateFps.toFixed(1)} fps`,
  );

  expect(metrics.frames).toBeGreaterThan(40);
  expect(metrics.p95FrameMs).toBeLessThan(80);
});
