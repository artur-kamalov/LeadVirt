import { expect, test, type Page } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

const summary = {
  metrics: {
    newLeadsCount: 0,
    aiConversationsCount: 0,
    bookingsOrdersCreated: 0,
    leadsSentToCrm: 0,
    averageResponseTimeSeconds: 0,
    conversionRate: 0,
  },
  recentLeads: [],
  recentActivity: [],
  channelPerformance: [],
  trend: [],
};

const completeProfile = {
  businessType: "services",
  name: "North Star Studio",
  description: "A customer service business",
  avgCheck: "100",
  servicesCatalog: "Consultation - 100",
  services: [
    {
      id: "consultation",
      name: "Consultation",
      description: "A structured customer consultation.",
      price: "100",
      duration: "60 minutes",
    },
  ],
  hours: "Weekdays 09:00-18:00",
  weeklySchedule: [{ day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" }],
  availability: "By appointment",
  faq: "Appointments can be changed 24 hours in advance.",
  policies: "Confirm the price before booking.",
  escalationRules: "Transfer complaints to a manager.",
  timezone: "Europe/Paris",
};

function overview(kind: "ready" | "review") {
  const ready = kind === "ready";
  const capabilities = [
    {
      enabled: true,
      requirements: [
        {
          kind: "EVALUATION_CASE",
          status: ready ? "SATISFIED" : "UNSATISFIED",
        },
      ],
    },
  ];
  return {
    readiness: {
      status: ready ? "READY" : "NEEDS_REVIEW",
      activePublicationId: "publication-active",
      serving: { status: "READY", capabilities },
      draft: { status: "UP_TO_DATE", capabilities },
      capabilities,
      blockerCount: ready ? 0 : 3,
      warningCount: 0,
      needsReviewCount: ready ? 0 : 3,
    },
    activePublication: {
      id: "publication-active",
      status: "ACTIVE",
      isActive: true,
    },
    counts: {},
    recentJobs: [],
    permissions: {},
  };
}

async function mockBase(page: Page) {
  await page.route("**/api/dashboard/summary", (route) =>
    route.fulfill({ json: { data: summary } }),
  );
  await page.route("**/api/current-tenant", (route) =>
    route.fulfill({
      json: {
        data: {
          id: "tenant-readiness",
          name: "North Star Studio",
          slug: "north-star-studio",
          role: "OWNER",
        },
      },
    }),
  );
  await page.route("**/api/business-profile", (route) =>
    route.fulfill({
      json: {
        data: {
          profile: completeProfile,
          version: 2,
          etag: "profile-etag",
          updatedAt: "2026-07-17T10:00:00.000Z",
        },
      },
    }),
  );
}

async function mockReadiness(
  page: Page,
  options: {
    knowledge: "ready" | "review" | "unavailable" | "null";
    repliesActive?: boolean;
    inboundSucceeded?: boolean;
    channelConnected?: boolean;
    integrationProvider?: "TELEGRAM" | "AMOCRM";
    channelsFailingInitially?: boolean;
  },
) {
  let channelsFailing = Boolean(options.channelsFailingInitially);
  await page.route("**/api/knowledge/v2/overview", (route) => {
    if (options.knowledge === "unavailable") {
      return route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "internal-service-name failed" } },
      });
    }
    if (options.knowledge === "null") return route.fulfill({ json: { data: null } });
    return route.fulfill({ json: { data: overview(options.knowledge) } });
  });
  await page.route("**/api/channels", (route) => {
    if (channelsFailing) {
      return route.fulfill({ json: {} });
    }
    return route.fulfill({
      json: {
        data:
          options.channelConnected === false
            ? []
            : [
                {
                  id: "channel-telegram",
                  tenantId: "tenant-readiness",
                  type: "TELEGRAM",
                  status: "ACTIVE",
                  name: "Telegram",
                  publicKey: "public-channel-key",
                  automaticRepliesEnabled: Boolean(options.repliesActive),
                  automaticRepliesGeneration: options.repliesActive ? 1 : 0,
                },
              ],
      },
    });
  });
  await page.route("**/api/channels/channel-telegram/automatic-replies/readiness", (route) =>
    route.fulfill({
      json: {
        data: {
          channelId: "channel-telegram",
          status: options.repliesActive ? "ACTIVE" : "READY",
          enabled: Boolean(options.repliesActive),
          canActivate: !options.repliesActive,
          generation: options.repliesActive ? 1 : 0,
          activePublicationId: "publication-active",
          activePublicationEtag: 1,
          activeCapabilitySetHash: "capability-set",
          activatedAt: options.repliesActive ? "2026-07-17T10:00:00.000Z" : null,
          blockers: [],
        },
      },
    }),
  );
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "integration-telegram",
            tenantId: "tenant-readiness",
            provider: options.integrationProvider ?? "TELEGRAM",
            status: "CONNECTED",
            name: "Telegram",
            connectedAt: "2026-07-17T09:00:00.000Z",
            recentSyncLogs: options.inboundSucceeded
              ? [
                  {
                    id: "successful-sample",
                    action: "sample_inbound",
                    status: "SUCCESS",
                    createdAt: "2026-07-17T10:00:00.000Z",
                  },
                ]
              : [],
            recentWebhookEvents: [],
          },
        ],
      },
    }),
  );
  return {
    setChannelsFailing: (value: boolean) => {
      channelsFailing = value;
    },
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "en" });
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  await mockBase(page);
});

test("desktop presents the first unresolved step as the primary next action", async ({ page }) => {
  await mockReadiness(page, { knowledge: "review" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const journey = page.getByTestId("dashboard-readiness");
  await expect(journey).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAccessibleName(/\S/);
  await expect(page.getByTestId("dashboard-readiness-step-profile")).toHaveAttribute(
    "data-state",
    "completed",
  );
  await expect(page.getByTestId("dashboard-readiness-step-knowledge")).toHaveAttribute(
    "data-state",
    "current",
  );
  await expect(page.getByTestId("dashboard-readiness-step-channel")).toHaveAttribute(
    "data-state",
    "completed",
  );
  await expect(page.getByTestId("dashboard-readiness-step-replies")).toHaveAttribute(
    "data-state",
    "blocked",
  );
  await expect(page.getByTestId("dashboard-readiness-step-inbound")).toBeVisible();
  await expect(page.getByTestId("dashboard-readiness-steps-toggle")).toBeHidden();
  await expect(page.getByTestId("dashboard-readiness-step-knowledge")).toContainText("3");

  const primary = page.getByTestId("dashboard-readiness-primary");
  await expect(primary).toHaveCount(1);
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute("href", "/app/knowledge?view=review");
  await page.screenshot({
    path: "artifacts/tmp/dashboard-readiness-desktop.png",
    fullPage: true,
  });
});

test("unavailable evidence is labeled as needing a check", async ({ page }) => {
  await mockReadiness(page, { knowledge: "unavailable" });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const knowledge = page.getByTestId("dashboard-readiness-step-knowledge");
  await expect(knowledge).toHaveAttribute("data-state", "current");
  await expect(knowledge).toHaveAttribute("data-evidence", "needs_check");
  await expect(knowledge.locator("p")).toHaveCount(2);
  await expect(page.getByText("internal-service-name failed")).toHaveCount(0);
});

test("an empty Knowledge overview is treated as missing evidence, not a dashboard crash", async ({
  page,
}) => {
  await mockReadiness(page, { knowledge: "null" });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("dashboard-readiness")).toBeVisible();
  await expect(page.getByTestId("dashboard-readiness-step-knowledge")).toHaveAttribute(
    "data-evidence",
    "needs_check",
  );
  await expect(page.getByText(/Application error:/)).toHaveCount(0);
});

test("a channel readiness outage becomes evidence that needs a check", async ({ page }) => {
  const readiness = await mockReadiness(page, {
    knowledge: "ready",
    channelsFailingInitially: true,
  });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const journey = page.getByTestId("dashboard-readiness");
  const replies = page.getByTestId("dashboard-readiness-step-replies");
  await expect(journey).toBeVisible();
  await expect(replies).toHaveAttribute("data-evidence", "needs_check");
  await expect(page.getByTestId("dashboard-readiness-loading")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-readiness-load-error")).toHaveCount(0);

  readiness.setChannelsFailing(false);
  await page.getByTestId("dashboard-readiness-refresh").click();

  await expect(journey).toBeVisible();
  await expect(page.getByTestId("dashboard-readiness-step-profile")).toHaveAttribute(
    "data-state",
    "completed",
  );
  await expect(replies).toHaveAttribute("data-evidence", "incomplete");
});

test("a refresh exposes unavailable channel evidence without hiding verified steps", async ({
  page,
}) => {
  const readiness = await mockReadiness(page, {
    knowledge: "ready",
    repliesActive: true,
    inboundSucceeded: true,
  });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const journey = page.getByTestId("dashboard-readiness");
  const profile = page.getByTestId("dashboard-readiness-step-profile");
  await expect(journey).toHaveAttribute("data-ready", "true");
  await expect(profile).toHaveAttribute("data-state", "completed");

  readiness.setChannelsFailing(true);
  await page.getByTestId("dashboard-readiness-refresh").click();

  await expect(page.getByTestId("dashboard-readiness-refresh-error")).toHaveCount(0);
  await expect(journey).toHaveAttribute("data-ready", "false");
  await expect(profile).toHaveAttribute("data-state", "completed");
  await expect(page.getByTestId("dashboard-readiness-step-replies")).toHaveAttribute(
    "data-evidence",
    "needs_check",
  );
  await expect(page.getByTestId("dashboard-readiness-load-error")).toHaveCount(0);

  readiness.setChannelsFailing(false);
  await page.getByTestId("dashboard-readiness-refresh").click();
  await expect(page.getByTestId("dashboard-readiness-refresh-error")).toHaveCount(0);
  await expect(journey).toHaveAttribute("data-ready", "true");
});

test("a connected CRM does not complete customer channel or inbound readiness", async ({
  page,
}) => {
  await mockReadiness(page, {
    knowledge: "ready",
    channelConnected: false,
    integrationProvider: "AMOCRM",
    inboundSucceeded: true,
  });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("dashboard-readiness-step-channel")).toHaveAttribute(
    "data-state",
    "current",
  );
  await expect(page.getByTestId("dashboard-readiness-step-channel")).toHaveAttribute(
    "data-evidence",
    "incomplete",
  );
  await expect(page.getByTestId("dashboard-readiness-step-inbound")).toHaveAttribute(
    "data-evidence",
    "incomplete",
  );
  await expect(page.getByTestId("dashboard-readiness-primary")).toHaveAttribute(
    "href",
    "/app/integrations",
  );
});

test("legacy notes do not replace structured services and schedule", async ({ page }) => {
  await page.unroute("**/api/business-profile");
  await page.route("**/api/business-profile", (route) =>
    route.fulfill({
      json: {
        data: {
          profile: { ...completeProfile, services: [], weeklySchedule: [] },
          version: 2,
          etag: "legacy-profile-etag",
          updatedAt: "2026-07-17T10:00:00.000Z",
        },
      },
    }),
  );
  await mockReadiness(page, {
    knowledge: "ready",
    repliesActive: true,
    inboundSucceeded: true,
  });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const profile = page.getByTestId("dashboard-readiness-step-profile");
  await expect(profile).toHaveAttribute("data-state", "current");
  await expect(profile).toHaveAttribute("data-evidence", "incomplete");
  await expect(profile).toContainText("2");
  await expect(page.getByTestId("dashboard-readiness-primary")).toHaveAttribute(
    "href",
    "/app/knowledge?view=business",
  );
  await expect(page.getByTestId("dashboard-readiness")).toHaveAttribute("data-ready", "false");
});

test("mobile keeps the detailed journey collapsed until requested", async ({ page }) => {
  await mockReadiness(page, { knowledge: "review" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("dashboard-readiness-step-knowledge")).toBeHidden();
  await expect(page.getByTestId("dashboard-readiness-step-profile")).toBeHidden();
  await expect(page.getByTestId("dashboard-readiness-step-channel")).toBeHidden();
  const stepsToggle = page.getByTestId("dashboard-readiness-steps-toggle");
  await expect(stepsToggle).toHaveAccessibleName("Show all steps");
  await stepsToggle.click();
  await expect(page.getByTestId("dashboard-readiness-step-knowledge")).toBeVisible();
});

test("mobile prioritizes the relevant launch step and can disclose the complete journey", async ({
  page,
}) => {
  await mockReadiness(page, {
    knowledge: "ready",
    repliesActive: true,
    inboundSucceeded: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  const journey = page.getByTestId("dashboard-readiness");
  await expect(journey).toHaveAttribute("data-ready", "true");
  await expect(journey.locator('[data-state="completed"]')).toHaveCount(7);
  await expect(journey.locator('[data-state="completed"]:visible')).toHaveCount(0);
  await expect(page.getByTestId("dashboard-readiness-step-inbound")).toBeHidden();
  await expect(page.getByTestId("dashboard-readiness-step-profile")).toBeHidden();

  const stepsToggle = page.getByTestId("dashboard-readiness-steps-toggle");
  await expect(stepsToggle).toHaveAccessibleName("Show all steps");
  await expect(stepsToggle).toHaveAttribute("aria-expanded", "false");
  await stepsToggle.click();
  await expect(stepsToggle).toHaveAccessibleName("Show less");
  await expect(stepsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(journey.locator('[data-state="completed"]:visible')).toHaveCount(7);
  await expect(page.getByTestId("dashboard-readiness-primary")).toBeVisible();
  await expect(page.getByTestId("dashboard-readiness-primary")).toHaveAttribute(
    "href",
    "/app/inbox",
  );

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await journey.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "artifacts/tmp/dashboard-readiness-mobile.png",
    fullPage: true,
  });
});
