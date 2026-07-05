import { expect, test } from "@playwright/test";

const webUrl = process.env.LEADVIRT_WEB_URL ?? "http://localhost:3001";

test("landing stays responsive during initial animated load", async ({ page }) => {
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor({ state: "visible" });

  const metrics = await page.evaluate(async () => {
    window.scrollTo(0, 0);

    return await new Promise<{
      timerTicks: number;
      maxDelayMs: number;
      p95DelayMs: number;
      longTaskCount: number;
      longestTaskMs: number;
    }>((resolve) => {
      const timerDelays: number[] = [];
      const longTasks: number[] = [];
      const sampleMs = 16;
      const start = performance.now();
      let previous = start;

      const observer =
        "PerformanceObserver" in window
          ? new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                longTasks.push(entry.duration);
              }
            })
          : null;

      try {
        observer?.observe({ entryTypes: ["longtask"] });
      } catch {
        observer?.disconnect();
      }

      const step = () => {
        const now = performance.now();
        timerDelays.push(now - previous);
        previous = now;

        if (now - start < 1400) {
          window.setTimeout(step, sampleMs);
          return;
        }

        observer?.disconnect();
        const measured = timerDelays.slice(1);
        const sorted = [...measured].sort((a, b) => a - b);

        resolve({
          timerTicks: measured.length,
          maxDelayMs: Math.max(...measured, 0),
          p95DelayMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          longTaskCount: longTasks.length,
          longestTaskMs: Math.max(...longTasks, 0),
        });
      };

      window.setTimeout(step, sampleMs);
    });
  });

  console.log(
    `Landing initial sample: ${metrics.timerTicks} timer ticks, p95 ${metrics.p95DelayMs.toFixed(
      1,
    )}ms, max ${metrics.maxDelayMs.toFixed(1)}ms, long tasks ${metrics.longTaskCount}, longest ${metrics.longestTaskMs.toFixed(
      1,
    )}ms`,
  );

  expect(metrics.timerTicks).toBeGreaterThan(35);
  expect(metrics.p95DelayMs).toBeLessThan(45);
  expect(metrics.maxDelayMs).toBeLessThan(220);
  expect(metrics.longTaskCount).toBeLessThan(2);
});
