import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test.setTimeout(60_000);

async function useRussianOperationalUi(page: Page) {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
}

async function mockProductIdentity(page: Page) {
  const calls = { authMe: 0, currentTenant: 0 };

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    calls.authMe += 1;
    await route.fulfill({
      json: {
        data: {
          id: "user-owner",
          email: "owner@clinic.test",
          name: "Owner Demo",
          tenantId: "tenant-clinic",
          role: "OWNER",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });

  await page.route(/\/api\/current-tenant(?:\?.*)?$/, async (route) => {
    calls.currentTenant += 1;
    await route.fulfill({
      json: {
        data: {
          id: "tenant-clinic",
          name: "LeadVirt Clinic",
          slug: "leadvirt-clinic",
          status: "TRIALING",
          businessType: "clinic",
          timezone: "Europe/Paris",
          role: "OWNER",
        },
      },
    });
  });

  await page.route(/\/api\/billing\/current-subscription(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { data: null } });
  });

  return calls;
}

async function mockDashboardSummary(
  page: Page,
  recentActivity: Array<{ id: string; action: string; title: string; createdAt: string }> = [],
) {
  await page.route(/\/api\/dashboard\/summary(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          metrics: {
            newLeadsCount: 0,
            aiConversationsCount: 0,
            bookingsOrdersCreated: 0,
            leadsSentToCrm: 0,
            averageResponseTimeSeconds: 0,
            conversionRate: 0,
          },
          recentActivity,
          channelPerformance: [],
          trend: [],
        },
      },
    });
  });
}

async function mockInboxConversations(page: Page) {
  await page.route(/\/api\/inbox\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "conversation-api-search",
            tenantId: "tenant-clinic",
            leadId: "lead-api-search",
            channel: {
              id: "channel-website",
              tenantId: "tenant-clinic",
              type: "WEBSITE",
              status: "ACTIVE",
              name: "Website",
            },
            channelType: "WEBSITE",
            status: "OPEN",
            subject: "API Lead conversation",
            lastMessageAt: "2026-06-27T10:00:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: {
              id: "lead-api-search",
              tenantId: "tenant-clinic",
              name: "API Lead",
              phone: "+79990000000",
              email: "lead@example.com",
              companyName: null,
              source: "Website widget",
              channelType: "WEBSITE",
              status: "NEW",
              temperature: "WARM",
              valueAmount: 12000,
              currency: "RUB",
              interest: "Consultation",
              summary: "Needs a consultation",
              assignedToUserId: null,
              assignedToName: null,
              lastMessageAt: "2026-06-27T10:00:00.000Z",
              createdAt: "2026-06-27T09:00:00.000Z",
            },
            lastMessage: "Please contact me",
            unreadCount: 1,
            messages: [],
            events: [],
          },
          {
            id: "conversation-other",
            tenantId: "tenant-clinic",
            leadId: "lead-other",
            channel: {
              id: "channel-telegram",
              tenantId: "tenant-clinic",
              type: "TELEGRAM",
              status: "ACTIVE",
              name: "Telegram",
            },
            channelType: "TELEGRAM",
            status: "OPEN",
            subject: "Other Customer conversation",
            lastMessageAt: "2026-06-27T09:30:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: {
              id: "lead-other",
              tenantId: "tenant-clinic",
              name: "Other Customer",
              phone: "+79990000001",
              email: "other@example.com",
              companyName: null,
              source: "Telegram bot",
              channelType: "TELEGRAM",
              status: "NEW",
              temperature: "COLD",
              valueAmount: 0,
              currency: "RUB",
              interest: "Different request",
              summary: "Unrelated message",
              assignedToUserId: null,
              assignedToName: null,
              lastMessageAt: "2026-06-27T09:30:00.000Z",
              createdAt: "2026-06-27T09:00:00.000Z",
            },
            lastMessage: "Different request",
            unreadCount: 0,
            messages: [],
            events: [],
          },
        ],
        pagination: { page: 1, limit: 50, total: 2, hasMore: false },
      },
    });
  });
}

function liveSeedCollisionConversation() {
  return {
    id: "conversation-live-seed-collision",
    tenantId: "tenant-clinic",
    leadId: "lead-live-seed-collision",
    channel: {
      id: "channel-website",
      tenantId: "tenant-clinic",
      type: "WEBSITE",
      status: "ACTIVE",
      name: "Website widget",
    },
    channelType: "WEBSITE",
    status: "OPEN",
    subject: "Пользовательский диалог",
    lastMessageAt: "2026-06-27T10:00:00.000Z",
    aiEnabled: true,
    handoffRequested: false,
    lead: {
      id: "lead-live-seed-collision",
      tenantId: "tenant-clinic",
      name: "Мария Белова",
      phone: "+79990000000",
      email: "maria@example.com",
      companyName: null,
      source: "Website widget",
      channelType: "WEBSITE",
      status: "NEW",
      temperature: "WARM",
      valueAmount: 0,
      currency: "RUB",
      interest: "Консультация",
      summary: "Пользовательский текст",
      assignedToUserId: "manager-live",
      assignedToName: "Мария, администратор",
      lastMessageAt: "2026-06-27T10:00:00.000Z",
      createdAt: "2026-06-27T09:00:00.000Z",
    },
    lastMessage: "Да, забронируйте. Телефон +7 999 123-45-67.",
    unreadCount: 1,
    messages: [
      {
        id: "message-live-seed-collision",
        tenantId: "tenant-clinic",
        conversationId: "conversation-live-seed-collision",
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Да, забронируйте. Телефон +7 999 123-45-67.",
        status: "RECEIVED",
        createdAt: "2026-06-27T10:00:00.000Z",
        attachments: [],
      },
    ],
    events: [],
  };
}

async function mockLiveSeedCollisionInbox(page: Page) {
  const conversation = liveSeedCollisionConversation();
  await page.route(/\/api\/inbox\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: [conversation],
        pagination: { page: 1, limit: 50, total: 1, hasMore: false },
      },
    });
  });
  await page.route(/\/api\/conversations\/conversation-live-seed-collision$/, async (route) => {
    await route.fulfill({ json: { data: conversation } });
  });
}

test("product shell renders tenant and user identity from API", async ({ page }) => {
  await useRussianOperationalUi(page);
  const calls = await mockProductIdentity(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await expect.poll(() => calls.authMe).toBeGreaterThan(0);
  await expect.poll(() => calls.currentTenant).toBeGreaterThan(0);
  await expect(page.getByText("LeadVirt Clinic").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("owner@clinic.test")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: "AI audit" })).toHaveCount(0);
  await expect(page.locator('[data-testid="language-switcher"]:visible')).toHaveCount(1);
});

test("mobile product navigation exposes accessible touch targets", async ({ page }, testInfo) => {
  await useRussianOperationalUi(page);
  await mockProductIdentity(page);
  await mockDashboardSummary(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  const bottomNavigation = page.getByTestId("product-mobile-bottom-navigation");
  await expect(bottomNavigation).toBeVisible();
  await expect(bottomNavigation.getByRole("link", { name: "Обзор" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(bottomNavigation.getByRole("link", { name: "Настройки" })).toBeVisible();
  await expect(bottomNavigation.getByRole("link", { name: "Ещё" })).toHaveCount(0);

  const bottomLinks = bottomNavigation.getByRole("link");
  for (let index = 0; index < (await bottomLinks.count()); index += 1) {
    const box = await bottomLinks.nth(index).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const notifications = page.getByRole("button", { name: "Уведомления" });
  const notificationsBox = await notifications.boundingBox();
  expect(notificationsBox?.width).toBeGreaterThanOrEqual(44);
  expect(notificationsBox?.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("product-navigation-mobile.png"),
  });

  const trigger = page.getByTestId("product-mobile-menu-trigger");
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox?.height).toBeGreaterThanOrEqual(44);

  await trigger.click();
  const close = page.getByTestId("product-mobile-menu-close");
  const themeToggle = page
    .getByTestId("product-mobile-navigation")
    .getByTestId("product-mobile-theme-toggle");
  await expect(close).toBeVisible();
  await expect(close).toHaveAccessibleName("Закрыть меню");
  await expect(themeToggle).toBeVisible();
  await expect(themeToggle).toHaveAccessibleName("Переключить тему");
  const closeBox = await close.boundingBox();
  const themeBox = await themeToggle.boundingBox();
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);
  expect(themeBox?.height).toBeGreaterThanOrEqual(44);
});

test("Inbox exposes truthful reply state and accessible filters", async (
  { context, page },
  testInfo,
) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockProductIdentity(page);
  await mockDashboardSummary(page);
  await mockInboxConversations(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "domcontentloaded" });

  const desktopNavigation = page.locator("aside").first().getByRole("navigation", {
    name: "Navigation",
  });
  await expect(desktopNavigation.getByRole("link", { name: "Inbox" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const channelFilters = page.getByRole("group", { name: "Filter by channel" });
  const statusFilters = page.getByRole("group", { name: "Filter by status" });
  const allChannels = channelFilters.getByRole("button", { name: "All channels" });
  const allStatuses = statusFilters.getByRole("button", { name: "All statuses" });
  await expect(allChannels).toHaveAttribute("aria-pressed", "true");
  await expect(allStatuses).toHaveAttribute("aria-pressed", "true");

  for (const filter of [allChannels, allStatuses]) {
    const box = await filter.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const firstConversation = page.getByTestId("inbox-conversation-conversation-api-search");
  await expect(firstConversation).toHaveAttribute("aria-current", "true");
  await expect(firstConversation.locator("button")).toHaveCount(0);
  await expect(firstConversation.getByTestId("inbox-needs-reply")).toHaveText("Needs reply");
  await expect(firstConversation.getByTestId("inbox-needs-reply")).not.toContainText("1");
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("inbox-ux-desktop.png"),
  });

  const telegram = channelFilters.getByRole("button", { name: "Telegram" });
  await telegram.click();
  await expect(telegram).toHaveAttribute("aria-pressed", "true");
  await expect(allChannels).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("inbox-lead-summary")).toContainText("Other Customer");
  await expect(page.getByTestId("inbox-lead-summary")).not.toContainText("API Lead");

  const search = page.getByLabel("Search conversations");
  await search.fill("API Lead");
  const clearSearch = page.getByRole("button", { name: "Clear search" });
  const clearBox = await clearSearch.boundingBox();
  expect(clearBox?.width).toBeGreaterThanOrEqual(44);
  expect(clearBox?.height).toBeGreaterThanOrEqual(44);
  await clearSearch.click();
  await expect(search).toHaveValue("");

  await page.goto(`${webBase}/app/inbox/conversation-api-search`, {
    waitUntil: "domcontentloaded",
  });
  await expect(desktopNavigation.getByRole("link", { name: "Inbox" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page
      .getByTestId("product-mobile-bottom-navigation")
      .getByRole("link", { name: "Inbox" }),
  ).toHaveAttribute("aria-current", "page");
});

test("live workspace preserves customer content that matches demo seed text", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockProductIdentity(page);
  await mockDashboardSummary(page);
  await mockLiveSeedCollisionInbox(page);

  await page.goto(`${webBase}/app/inbox`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Мария Белова", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Консультация", { exact: true })).toBeVisible();
  await expect(page.getByText("Мария, администратор", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Да, забронируйте. Телефон +7 999 123-45-67.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Maria Belova", { exact: true })).toHaveCount(0);

  await page.goto(`${webBase}/app/inbox/conversation-live-seed-collision`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByText("Да, забронируйте. Телефон +7 999 123-45-67.", { exact: true }),
  ).toBeVisible();
});

test("product shell distinguishes failed reads from empty workspace state", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let recoverTenant = false;
  let recoverBilling = false;
  let recoverNotifications = false;

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-owner",
          email: "owner@clinic.test",
          name: "Owner Demo",
          tenantId: "tenant-clinic",
          role: "OWNER",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route(/\/api\/current-tenant(?:\?.*)?$/, async (route) => {
    if (!recoverTenant) {
      await route.fulfill({ status: 503, json: { message: "Tenant unavailable" } });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          id: "tenant-clinic",
          name: "Recovered Workspace",
          slug: "recovered-workspace",
          status: "TRIALING",
          businessType: "clinic",
          timezone: "Europe/Paris",
          role: "OWNER",
        },
      },
    });
  });
  await page.route("**/api/billing/current-subscription", async (route) => {
    if (!recoverBilling) {
      await route.fulfill({ status: 503, json: { message: "Billing unavailable" } });
      return;
    }
    await route.fulfill({ json: { data: null } });
  });
  await page.route(/\/api\/dashboard\/summary(?:\?.*)?$/, async (route) => {
    if (!recoverNotifications) {
      await route.fulfill({ status: 503, json: { message: "Activity unavailable" } });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          recentActivity: [
            {
              id: "recovered-activity",
              action: "lead.created",
              title: "Recovered activity",
              createdAt: "2026-07-15T10:00:00.000Z",
            },
          ],
        },
      },
    });
  });
  await mockInboxConversations(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`);

  await expect(page.getByRole("button", { name: /Account/ })).toBeVisible();
  await expect(page.getByTestId("product-billing-retry")).toBeVisible();
  await expect(page.getByText("No plan selected")).toHaveCount(0);

  await page.getByRole("button", { name: "Notifications" }).click();
  const notificationError = page.getByTestId("product-notifications-error");
  await expect(notificationError).toBeVisible();
  await expect(page.getByText("No new events yet")).toHaveCount(0);
  recoverNotifications = true;
  await notificationError.getByRole("button").click();
  await expect(notificationError).toBeHidden();
  await expect(page.getByText("Recovered activity")).toBeVisible();

  await page.keyboard.press("Escape");
  recoverTenant = true;
  await page.getByRole("button", { name: /Account/ }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Try again" }).click();
  await expect(page.getByText("Recovered Workspace").first()).toBeVisible();

  recoverBilling = true;
  await page.getByTestId("product-billing-retry").click();
  await expect(page.getByTestId("product-billing-retry")).toBeHidden();
  await expect(page.getByText("No plan selected")).toBeVisible();
});

test("product shell notifications render dashboard activity data", async ({ page }) => {
  await useRussianOperationalUi(page);
  await mockProductIdentity(page);
  await mockDashboardSummary(page, [
    {
      id: "activity-api-notification",
      action: "custom.dashboard_notification",
      title: "API dashboard notification",
      createdAt: "2026-06-27T10:00:00.000Z",
    },
  ]);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: /LeadVirt Clinic/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("API dashboard notification")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Уведомления" }).click();

  await expect(page.getByText("1 новое")).toHaveCount(0);
  await expect(page.getByRole("menu").getByText("API dashboard notification")).toBeVisible();
  await page.getByRole("menu").getByText("API dashboard notification").click();
  await expect(page).toHaveURL(/\/app\/inbox$/, { timeout: 15_000 });
  await expect(page.getByText("2 новых")).toHaveCount(0);
});

test("product shell global search opens Inbox with a prefilled query", async ({ page }) => {
  await useRussianOperationalUi(page);
  await mockProductIdentity(page);
  await mockDashboardSummary(page);
  await mockInboxConversations(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  await page.getByLabel("Глобальный поиск").fill("API Lead");
  await page.getByLabel("Глобальный поиск").press("Enter");

  await expect(page).toHaveURL(/\/app\/inbox\?q=API(?:%20|\+)Lead$/, { timeout: 15_000 });
  await expect(page.getByLabel("Поиск в диалогах")).toHaveValue("API Lead");
  await expect(page.getByText("API Lead").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Other Customer")).toHaveCount(0);
});

test("product shell does not present dependency outages as an empty plan or notification list", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await mockProductIdentity(page);
  await mockInboxConversations(page);

  let billingAvailable = false;
  let notificationsAvailable = false;
  await page.route(/\/api\/billing\/current-subscription(?:\?.*)?$/, async (route) => {
    if (!billingAvailable) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: null } });
  });
  await page.route(/\/api\/dashboard\/summary(?:\?.*)?$/, async (route) => {
    if (!notificationsAvailable) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: { data: { recentActivity: [] } } });
  });

  await page.goto(`${webBase}/app/inbox`);

  const billingRetry = page.getByTestId("product-billing-retry");
  await expect(billingRetry).toBeVisible();
  await expect(page.getByText("No plan selected")).toHaveCount(0);

  await page.getByRole("button", { name: "Notifications" }).click();
  const notificationError = page.getByTestId("product-notifications-error");
  await expect(notificationError).toBeVisible();
  await expect(page.getByText("No new events yet")).toHaveCount(0);

  await page.keyboard.press("Escape");
  billingAvailable = true;
  await billingRetry.click();
  await expect(page.getByTestId("product-billing-link")).toContainText("Choose plan");

  notificationsAvailable = true;
  await page.getByRole("button", { name: "Notifications" }).click();
  await notificationError.getByRole("button").click();
  await expect(notificationError).toBeHidden();
  await expect(page.getByText("No new events yet")).toBeVisible();
});

test("product shell logout calls auth API and clears local session", async ({ page }) => {
  test.setTimeout(90_000);
  await useRussianOperationalUi(page);
  let logoutCalled = false;
  await mockProductIdentity(page);
  await page.route(/\/api\/auth\/logout(?:\?.*)?$/, async (route) => {
    logoutCalled = true;
    await route.fulfill({ json: { data: { loggedOut: true } } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "leadvirt.auth.session",
      JSON.stringify({ tenantId: "tenant-clinic" }),
    );
    window.localStorage.setItem("leadvirt.demo.session", JSON.stringify({ tenantId: "demo" }));
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /LeadVirt Clinic/ }).click();
  await page.getByRole("menuitem", { name: "Выйти" }).click();

  await expect.poll(() => logoutCalled).toBe(true);
  await expect(page).toHaveURL(`${webBase}/login`, { timeout: 45_000 });
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.auth.session")))
    .toBeNull();
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("leadvirt.demo.session")))
    .toBeNull();
});
