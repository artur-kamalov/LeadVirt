import { expect, test, type Page } from "@playwright/test";
import { intlLocale, supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import { messages } from "../../apps/web/src/i18n/messages";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const conversationId = "conversation-operational-locale";
const leadId = "lead-operational-locale";
const relativeTimestamp = new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString();
const unidentifiedRequest: Record<Locale, string> = {
  en: "Request not identified",
  es: "Solicitud sin identificar",
  fr: "Demande non identifiée",
  de: "Anfrage nicht erkannt",
  pt: "Solicitação não identificada",
  ru: "Запрос не определён",
};
const websiteWidgetSource: Record<Locale, string> = {
  en: "Website widget",
  es: "Widget del sitio web",
  fr: "Widget du site",
  de: "Website-Widget",
  pt: "Widget do site",
  ru: "Виджет сайта",
};

function expectedRelativeTime(locale: Locale) {
  return new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
    style: "long",
  }).format(-5, "day");
}

function expectedLeadValue(locale: Locale) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(1234567);
}

function lead(status = "IN_PROGRESS") {
  return {
    id: leadId,
    tenantId: "tenant-localization",
    name: "Localized Lead",
    phone: null,
    email: null,
    companyName: null,
    source: "Виджет сайта",
    channelType: "WEBSITE",
    status,
    temperature: "WARM",
    valueAmount: 1234567,
    currency: "EUR",
    interest: null,
    summary: "Customer asks about pricing and availability",
    assignedToUserId: null,
    assignedToName: "Workspace Manager",
    lastMessageAt: relativeTimestamp,
    createdAt: relativeTimestamp,
  };
}

function conversation(status = "IN_PROGRESS") {
  return {
    id: conversationId,
    tenantId: "tenant-localization",
    leadId,
    channel: {
      id: "channel-operational-locale",
      tenantId: "tenant-localization",
      type: "WEBSITE",
      status: "ACTIVE",
      name: "Website widget",
    },
    channelType: "WEBSITE",
    status: "OPEN",
    subject: "Customer asks about pricing and availability",
    lastMessageAt: relativeTimestamp,
    aiEnabled: true,
    handoffRequested: false,
    lead: lead(status),
    lastMessage: "Customer asks about pricing and availability",
    unreadCount: 1,
    messages: [
      {
        id: "message-operational-locale",
        tenantId: "tenant-localization",
        conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Customer asks about pricing and availability",
        status: "RECEIVED",
        createdAt: relativeTimestamp,
        attachments: [],
      },
    ],
    events: [
      {
        id: "event-operational-locale",
        leadId,
        type: "message_received",
        title: "Message received",
        message: null,
        createdAt: relativeTimestamp,
      },
    ],
  };
}

function pipelineSummary(status = "IN_PROGRESS") {
  const statuses = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"];
  return {
    data: {
      stages: statuses.map((candidate) => ({
        status: candidate,
        count: candidate === status ? 1 : 0,
        valueAmount: candidate === status ? 1234567 : 0,
        leads: candidate === status ? [lead(status)] : [],
      })),
    },
  };
}

async function mockOperationalApis(page: Page) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-operational-locale",
          email: "owner@localization.test",
          name: "Localization Owner",
          tenantId: "tenant-localization",
          role: "OWNER",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route(/\/api\/current-tenant(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "tenant-localization",
          name: "Localization Workspace",
          slug: "localization-workspace",
          status: "TRIALING",
          role: "OWNER",
        },
      },
    });
  });
  await page.route(/\/api\/inbox\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: [conversation()],
        pagination: { page: 1, limit: 50, total: 1, hasMore: false },
      },
    });
  });
  await page.route(/\/api\/conversations\/conversation-operational-locale$/, async (route) => {
    await route.fulfill({ json: { data: conversation() } });
  });
  await page.route(/\/api\/leads\/pipeline\/summary$/, async (route) => {
    await route.fulfill({ json: pipelineSummary() });
  });
}

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      })),
    )
    .toEqual(expect.objectContaining({ body: expect.any(Number), document: expect.any(Number) }));

  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.body, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
  expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
}

async function selectLocale(page: Page, locale: Locale) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
}

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
  await mockOperationalApis(page);
});

test("Inbox, Conversation, and Pipeline render all six operational locales", async ({ context, page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);

  await page.goto(`${webBase}/app/inbox`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByText(messages[locale]["ops.inbox.title"], { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel(messages[locale]["ops.inbox.searchLabel"])).toBeVisible();
    await expect(page.getByTestId("inbox-needs-reply")).toHaveText(
      messages[locale]["ops.inbox.awaitingReply"],
    );
    await expect(
      page
        .getByTestId("inbox-lead-summary")
        .getByRole("button", { name: messages[locale]["ops.inbox.openConversation"], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(expectedRelativeTime(locale), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(messages[locale]["ops.common.service"], { exact: true })).toBeVisible();
    await expect(page.getByText(unidentifiedRequest[locale], { exact: true })).toBeVisible();
    await expect(page.getByText(websiteWidgetSource[locale], { exact: true }).first()).toBeVisible();
    await expect(page.getByText(expectedLeadValue(locale), { exact: true }).first()).toBeVisible();
  }

  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByText(messages[locale]["ops.conversation.title"], { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: messages[locale]["ops.common.qualified"] }).first(),
    ).toBeVisible();
    await expect(page.getByText(expectedRelativeTime(locale), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(unidentifiedRequest[locale], { exact: true })).toBeVisible();
    await expect(page.getByText(websiteWidgetSource[locale], { exact: true })).toBeVisible();
    await expect(page.getByText(expectedLeadValue(locale), { exact: true })).toBeVisible();
  }

  await page.goto(`${webBase}/app/leads`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByRole("heading", { name: messages[locale]["ops.pipeline.heading"] })).toBeVisible();
    await expect(page.getByRole("button", { name: messages[locale]["ops.pipeline.list"] })).toBeVisible();
    await expect(page.getByText(expectedLeadValue(locale), { exact: true }).first()).toBeVisible();
  }
});

test("localized supported operational controls keep their API actions wired", async ({ page }) => {
  let handoffCalled = false;
  let qualifiedStatus = "";

  await page.context().addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  await page.route(`**/api/conversations/${conversationId}/handoff`, async (route) => {
    handoffCalled = true;
    await route.fulfill({ json: { data: { ...conversation(), status: "WAITING_FOR_HUMAN", handoffRequested: true } } });
  });
  await page.route(`**/api/leads/${leadId}`, async (route) => {
    qualifiedStatus = (route.request().postDataJSON() as { status?: string }).status ?? "";
    await route.fulfill({ json: { data: lead(qualifiedStatus || "QUALIFIED") } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "domcontentloaded" });
  await expect(
    page
      .getByTestId("inbox-lead-summary")
      .getByRole("button", { name: messages.en["ops.inbox.openConversation"], exact: true }),
  ).toBeVisible();

  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: messages.en["ops.conversation.menuLabel"] }).click();
  await page.getByRole("menuitem", { name: messages.en["ops.conversation.handoff"] }).click();
  await expect.poll(() => handoffCalled).toBe(true);

  await page.goto(`${webBase}/app/leads`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: messages.en["ops.pipeline.leadActions"].replace("{name}", "Localized Lead") }).click();
  await page.getByText(messages.en["ops.common.qualified"], { exact: true }).click();
  await expect.poll(() => qualifiedStatus).toBe("QUALIFIED");
});

for (const testCase of [
  { locale: "de" as Locale, width: 1440, height: 900 },
  { locale: "pt" as Locale, width: 390, height: 844 },
]) {
  test(`${testCase.locale} operational pages avoid viewport overflow at ${testCase.width}px`, async ({ context, page }) => {
    await context.addCookies([{ name: "leadvirt-locale", value: testCase.locale, url: webBase, sameSite: "Lax" }]);
    await page.setViewportSize({ width: testCase.width, height: testCase.height });

    for (const path of ["/app/inbox", `/app/inbox/${conversationId}`, "/app/leads"]) {
      await page.goto(`${webBase}${path}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Localized Lead").first()).toBeVisible({ timeout: 15_000 });
      await expectNoPageOverflow(page);
    }
  });
}
