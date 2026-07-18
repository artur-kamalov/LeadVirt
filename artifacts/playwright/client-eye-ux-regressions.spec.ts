import { expect, test, type Locator, type Page } from "@playwright/test";
import { type Locale } from "../../apps/web/src/i18n/config";
import { localizeDemoSeedText } from "../../apps/web/src/i18n/demo-seed-messages";
import { messages } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

async function useLocale(page: Page, locale: Locale) {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" }]);
}

async function expectNoGlobalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          document.body.scrollWidth - window.innerWidth,
          document.documentElement.scrollWidth - window.innerWidth,
        ),
      ),
    )
    .toBeLessThanOrEqual(1);
}

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return box ? Math.min(box.height, box.width) : 0;
    })
    .toBeGreaterThanOrEqual(44);
}

async function expectContentInside(locator: Locator) {
  await expect(locator).toBeVisible();
  const result = await locator.evaluate((element) => {
    const parent = element.getBoundingClientRect();
    const textElements = Array.from(element.querySelectorAll("p, span")).filter((child) =>
      child.textContent?.trim(),
    );

    return {
      selfFits:
        element.scrollWidth <= element.clientWidth + 1 &&
        element.scrollHeight <= element.clientHeight + 1,
      textFits: textElements.every((child) => {
        const rect = child.getBoundingClientRect();
        return (
          rect.left >= parent.left - 1 &&
          rect.right <= parent.right + 1 &&
          rect.top >= parent.top - 1 &&
          rect.bottom <= parent.bottom + 1 &&
          child.scrollWidth <= child.clientWidth + 1 &&
          child.scrollHeight <= child.clientHeight + 1
        );
      }),
    };
  });

  expect(result).toEqual({ selfFits: true, textFits: true });
}

async function expectCustomFocusIndicator(locator: Locator) {
  const before = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { boxShadow: style.boxShadow, outline: style.outline };
  });

  await locator.focus();
  await expect(locator).toBeFocused();
  const after = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      focusVisible: element.matches(":focus-visible"),
      outline: style.outline,
    };
  });

  expect(after.focusVisible).toBe(true);
  expect(
    (after.boxShadow !== "none" && after.boxShadow !== before.boxShadow) ||
      (after.outline !== "none" && after.outline !== before.outline),
  ).toBe(true);
}

async function mockOperatorConversation(page: Page) {
  const conversationId = "client-eye-mobile-conversation";
  const lead = {
    id: "client-eye-mobile-lead",
    tenantId: "client-eye-tenant",
    name: "Mobile Test Lead",
    phone: null,
    email: null,
    companyName: null,
    source: "Website widget",
    channelType: "WEBSITE",
    status: "IN_PROGRESS",
    temperature: "WARM",
    valueAmount: 12000,
    currency: "RUB",
    interest: "Mobile UX",
    summary: "Mobile target regression fixture",
    assignedToUserId: null,
    assignedToName: "Test Agent",
    lastMessageAt: "2026-07-18T10:00:00.000Z",
    createdAt: "2026-07-18T09:00:00.000Z",
  };
  const conversation = {
    id: conversationId,
    tenantId: "client-eye-tenant",
    leadId: lead.id,
    channel: {
      id: "client-eye-channel",
      tenantId: "client-eye-tenant",
      type: "WEBSITE",
      status: "ACTIVE",
      name: "Website widget",
      lastHealthAt: null,
    },
    channelType: "WEBSITE",
    status: "OPEN",
    subject: "Mobile target regression",
    lastMessageAt: "2026-07-18T10:00:00.000Z",
    aiEnabled: true,
    handoffRequested: false,
    lead,
    lastMessage: "Can you help me?",
    unreadCount: 1,
    messages: [
      {
        id: "client-eye-mobile-message",
        tenantId: "client-eye-tenant",
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Can you help me?",
        status: "RECEIVED",
        createdAt: "2026-07-18T10:00:00.000Z",
        attachments: [],
      },
    ],
    events: [],
  };

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = null;
    if (path.endsWith("/api/auth/me")) {
      data = {
        id: "client-eye-agent",
        tenantId: "client-eye-tenant",
        email: "agent@client-eye.test",
        name: "Client Eye Agent",
        role: "AGENT",
        authMode: "credentials",
        passwordChangeRequired: false,
        locale: "en",
      };
    } else if (path.endsWith("/api/current-tenant")) {
      data = {
        id: "client-eye-tenant",
        name: "Client Eye Workspace",
        slug: "client-eye-workspace",
        status: "TRIALING",
        role: "AGENT",
      };
    } else if (path.endsWith(`/api/conversations/${conversationId}`)) {
      data = conversation;
    }
    await route.fulfill({ json: { data } });
  });

  return conversationId;
}

test("localized final CTA fits at 320px and desktop header controls stay accessible", async ({
  page,
}) => {
  for (const locale of ["ru", "fr"] as const) {
    await useLocale(page, locale);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(webBase, { waitUntil: "domcontentloaded" });

    const finalCta = page.getByTestId("landing-final-cta");
    await finalCta.scrollIntoViewIfNeeded();
    await expectContentInside(finalCta);
    const box = await finalCta.boundingBox();
    expect(box, locale).not.toBeNull();
    expect(box!.x, locale).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, locale).toBeLessThanOrEqual(320);
    await expectNoGlobalOverflow(page);
  }

  await useLocale(page, "en");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Tab");

  const header = page.locator("header");
  for (const control of [
    header.getByRole("link", { name: "Solutions", exact: true }),
    header.getByRole("link", { name: "Features", exact: true }),
    header.getByRole("link", { name: "Pricing", exact: true }),
    page.getByTestId("landing-desktop-login"),
    page.getByTestId("landing-desktop-trial"),
  ]) {
    await expectTouchTarget(control);
    await expectCustomFocusIndicator(control);
  }
});

test("Russian mobile pipeline stat content stays inside every chip", async ({ page }) => {
  await useLocale(page, "ru");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });

  for (const testId of [
    "pipeline-stat-total",
    "pipeline-stat-value",
    "pipeline-stat-qualification",
    "pipeline-stat-qualified-average",
  ]) {
    await expectContentInside(page.getByTestId(testId));
  }
  await expectNoGlobalOverflow(page);
});

test("demo channel management stays in demo and English channel names are localized", async ({
  page,
}) => {
  await useLocale(page, "en");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/settings?tab=channels`, { waitUntil: "domcontentloaded" });

  await expect(page.locator("body")).not.toContainText("Виджет сайта");
  const manageTelegram = page.getByTestId("settings-manage-integration-telegram");
  await expectTouchTarget(manageTelegram);
  await expect(manageTelegram).toHaveAttribute("href", "/demo/integrations");
  await manageTelegram.click();
  await expect(page).toHaveURL(`${webBase}/demo/integrations`);
});

test("demo widget settings localize every customer-facing value", async ({ page }) => {
  const seed = {
    business: "Студия Лето",
    consent: "Нажимая отправить, вы соглашаетесь на обработку заявки.",
    replies: ["Хочу оставить заявку", "Сколько стоит окрашивание?", "Позовите менеджера"],
    subtitle: "AI-администратор на связи",
    title: "Студия Лето",
    welcome: "Здравствуйте! Подскажу цены, соберу удобное время и передам заявку менеджеру.",
  } as const;

  for (const locale of ["en", "de", "fr", "ru"] as const) {
    await useLocale(page, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webBase}/demo/settings?tab=channels`, {
      waitUntil: "domcontentloaded",
    });

    const websiteRow = page.getByTestId("settings-channel-website");
    await expect(websiteRow).toBeVisible({ timeout: 30_000 });
    await websiteRow.getByRole("button").first().click();

    const dialog = page.getByRole("dialog", {
      name: messages[locale]["settings.channels.widgetTitle"],
    });
    await expect(dialog).toBeVisible();
    const fields = [
      ["settings.channels.widget.heading", localizeDemoSeedText(seed.title, locale)],
      ["settings.channels.widget.subtitle", localizeDemoSeedText(seed.subtitle, locale)],
      ["settings.channels.widget.business", localizeDemoSeedText(seed.business, locale)],
      ["settings.channels.widget.welcome", localizeDemoSeedText(seed.welcome, locale)],
      [
        "settings.channels.widget.replies",
        seed.replies.map((value) => localizeDemoSeedText(value, locale)).join("\n"),
      ],
      ["settings.channels.widget.consent", localizeDemoSeedText(seed.consent, locale)],
    ] as const;

    for (const [labelKey, expectedValue] of fields) {
      await expect(dialog.getByLabel(messages[locale][labelKey], { exact: true })).toHaveValue(
        expectedValue,
      );
    }

    const renderedValues = fields.map(([, value]) => value).join("\n");
    if (locale === "ru") expect(renderedValues).toMatch(/[А-Яа-яЁё]/);
    else expect(renderedValues).not.toMatch(/[А-Яа-яЁё]/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("mobile dashboard and conversation actions keep 44px targets", async ({ page }) => {
  await useLocale(page, "en");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

  for (const testId of ["dashboard-open-inbox", "dashboard-scenarios", "dashboard-analytics"]) {
    await expectTouchTarget(page.getByTestId(testId));
  }

  await page.goto(`${webBase}/demo/inbox`, { waitUntil: "domcontentloaded" });
  const inboxSearch = page.getByTestId("inbox-search-input");
  await expect(inboxSearch).toBeVisible();
  const searchBox = await inboxSearch.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.height).toBeGreaterThanOrEqual(42);
  for (const y of [searchBox!.y + 2, searchBox!.y + searchBox!.height - 2]) {
    await page.mouse.click(searchBox!.x + searchBox!.width / 2, y);
    await expect(inboxSearch).toBeFocused();
    await inboxSearch.blur();
  }

  await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, {
    waitUntil: "domcontentloaded",
  });
  for (const testId of ["conversation-lead-info-toggle", "conversation-actions-menu"]) {
    await expectTouchTarget(page.getByTestId(testId));
  }

  const conversationId = await mockOperatorConversation(page);
  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "domcontentloaded" });
  for (const testId of ["conversation-attach-file", "conversation-emoji", "conversation-send"]) {
    await expectTouchTarget(page.getByTestId(testId));
  }
  await expectNoGlobalOverflow(page);
});

test("mobile integration readiness and Telegram links keep 44px targets", async ({ page }) => {
  await useLocale(page, "en");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/integrations`, { waitUntil: "domcontentloaded" });

  const widgetAction = page.getByTestId("pilot-readiness-widget-open");
  await expectTouchTarget(widgetAction);
  await expect(widgetAction).toHaveAttribute("href", "/widget/demo");

  const botLink = page.getByTestId("telegram-card-open-bot");
  await expectTouchTarget(botLink);
  await expect(botLink).toHaveAttribute("href", "https://t.me/studio_leto_bot?start=leadvirt");
  await expectNoGlobalOverflow(page);
});
