import { expect, test, type Page } from "@playwright/test";
import type {
  AiAuditResponse,
  AnalyticsOverview,
  ApiEnvelope,
  BusinessProfileView,
  DashboardSummary,
  KnowledgeV2OverviewView,
} from "@leadvirt/types";
import { localizeDemoSeedText } from "../../apps/web/src/i18n/demo-seed-messages";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import { messages } from "../../apps/web/src/i18n/messages";
import { widgetMessage } from "../../apps/web/src/i18n/widget-messages";
import { DemoApiError, demoApiRequest } from "../../apps/web/src/lib/api/demo-runtime";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

const analyticsExpectations: Record<
  Locale,
  { monday: string; scenario: string; price: string; activity: string; leadUpdated: string }
> = {
  en: {
    monday: "Mon",
    scenario: "Lead qualification",
    price: "14,000-16,000",
    activity: "AI prepared a reply",
    leadUpdated: "Lead updated",
  },
  es: {
    monday: "lun",
    scenario: "Calificación de leads",
    price: "14.000 a 16.000",
    activity: "La IA preparó una respuesta",
    leadUpdated: "Lead actualizado",
  },
  fr: {
    monday: "lun.",
    scenario: "Qualification des prospects",
    price: "14 000 à 16 000",
    activity: "L'IA a préparé une réponse",
    leadUpdated: "Prospect mis à jour",
  },
  de: {
    monday: "Mo",
    scenario: "Lead-Qualifizierung",
    price: "14.000 bis 16.000",
    activity: "KI-Antwort vorbereitet",
    leadUpdated: "Lead aktualisiert",
  },
  pt: {
    monday: "seg.",
    scenario: "Qualificação de leads",
    price: "14.000 a 16.000",
    activity: "A IA preparou uma resposta",
    leadUpdated: "Lead atualizado",
  },
  ru: {
    monday: "пн",
    scenario: "Квалификация лидов",
    price: "14 000-16 000",
    activity: "AI подготовил ответ",
    leadUpdated: "Лид обновлён",
  },
};

async function selectLocale(page: Page, locale: Locale) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
});

test("known demo leads follow all six locales without changing unknown customer text", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const unknownCustomerText = "Произвольный текст клиента";

  await page.goto(`${webBase}/demo/inbox`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(localizeDemoSeedText("Мария Белова", locale), { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(localizeDemoSeedText("Консультация по уходу", locale), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(localizeDemoSeedText("Мария, администратор", locale), { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText(
          localizeDemoSeedText(
            "Для начала подойдёт восстановление K18 или Olaplex. Чтобы выбрать точнее: ломкость по длине или больше сухие кончики?",
            locale,
          ),
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    expect(localizeDemoSeedText(unknownCustomerText, locale)).toBe(unknownCustomerText);
  }

  await page.goto(`${webBase}/demo/leads`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(localizeDemoSeedText("Виджет сайта", locale), { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(localizeDemoSeedText("Окрашивание + стрижка", locale), { exact: true }),
    ).toBeVisible();
  }

  await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(messages[locale]["ops.conversation.eventLeadCreated"], { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(messages[locale]["ops.conversation.eventAiPrepared"], { exact: true }),
    ).toBeVisible();
  }
});

test("demo business profile follows all six interface locales", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(`${webBase}/demo/settings`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByTestId("settings-business-profile-name")).toHaveText(
      localizeDemoSeedText("Студия Лето", locale),
    );
    await expect(page.getByTestId("settings-business-profile-description")).toHaveText(
      localizeDemoSeedText(
        "Салон красоты в центре города: окрашивание, стрижки, укладки и уход.",
        locale,
      ),
    );
  }

  await page.goto(`${webBase}/demo/knowledge?view=business`, {
    waitUntil: "domcontentloaded",
  });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByLabel(messages[locale]["onboarding.company.name"])).toHaveValue(
      localizeDemoSeedText("Студия Лето", locale),
    );
    await expect(
      page.getByLabel(messages[locale]["onboarding.company.about"]),
    ).toHaveValue(
      localizeDemoSeedText(
        "Салон красоты в центре города: окрашивание, стрижки, укладки и уход.",
        locale,
      ),
    );
  }
});

test("demo fixtures and API do not claim an unsupported manager task workflow", () => {
  const dashboard = demoApiRequest<ApiEnvelope<DashboardSummary>>("/dashboard/summary").data;
  const audit = demoApiRequest<ApiEnvelope<AiAuditResponse>>("/ai-audit").data;
  const fixtureJson = JSON.stringify({ dashboard, audit });
  const conversationBefore = demoApiRequest<
    ApiEnvelope<{ events: Array<{ id: string; type: string }> }>
  >("/conversations/demo-conv-anna").data;

  let taskError: unknown;
  try {
    demoApiRequest("/leads/demo-lead-anna/actions/create-task", {
      method: "POST",
      body: JSON.stringify({ title: "Contact the lead" }),
    });
  } catch (error) {
    taskError = error;
  }

  const conversationAfter = demoApiRequest<
    ApiEnvelope<{ events: Array<{ id: string; type: string }> }>
  >("/conversations/demo-conv-anna").data;

  expect(dashboard.recentActivity.map((item) => item.action)).toContain("lead.updated");
  expect(audit.items.map((item) => item.action)).toContain("lead.updated");
  expect(fixtureJson).not.toContain("task.created");
  expect(fixtureJson).not.toContain("manager_confirmation");
  expect(taskError).toBeInstanceOf(DemoApiError);
  expect(taskError).toMatchObject({ status: 409, code: "PILOT_CAPABILITY_UNAVAILABLE" });
  expect(conversationAfter.events).toEqual(conversationBefore.events);
  expect(conversationAfter.events.map((event) => event.type)).not.toContain("task.created");
});

test("demo business hours and analytics match the available evidence", () => {
  const profile = demoApiRequest<ApiEnvelope<BusinessProfileView>>("/business-profile").data.profile;
  const analytics = demoApiRequest<ApiEnvelope<AnalyticsOverview>>("/analytics/overview").data;

  expect(profile.hours).toBe("Ежедневно 10:00-21:00");
  expect(profile.weeklySchedule).toHaveLength(7);
  expect(profile.weeklySchedule).toEqual(
    expect.arrayContaining([
      { day: "SUN", enabled: true, opensAt: "10:00", closesAt: "21:00" },
    ]),
  );
  expect(
    profile.weeklySchedule.every(
      (entry) => entry.enabled && entry.opensAt === "10:00" && entry.closesAt === "21:00",
    ),
  ).toBe(true);
  expect(analytics.aiInsightCodes).toEqual([]);
});

test("demo Knowledge resolves the active publication advertised by readiness", () => {
  const overview = demoApiRequest<ApiEnvelope<KnowledgeV2OverviewView>>(
    "/knowledge/v2/overview",
  ).data;

  expect(overview.activePublication).toMatchObject({
    id: overview.readiness.activePublicationId,
    sequence: overview.readiness.activePublicationSequence,
    status: "ACTIVE",
    isActive: true,
  });
  expect(overview.readiness.serving.activePublicationId).toBe(
    overview.activePublication?.id,
  );
});

test("managed integration confirmation addresses the requester in all locales", () => {
  const requesterTerms: Record<Locale, string> = {
    en: "contact you",
    es: "contacto contigo",
    fr: "vous contactera",
    de: "kontaktiert Sie",
    pt: "contato com você",
    ru: "свяжется с вами",
  };
  const ownerTerms: Record<Locale, string> = {
    en: "workspace owner",
    es: "propietario",
    fr: "propriétaire",
    de: "Workspace-Inhaber",
    pt: "proprietário",
    ru: "владельцем",
  };

  for (const locale of supportedLocales) {
    const confirmation = messages[locale]["integrations.request.confirmation"];
    expect(confirmation, locale).toContain(requesterTerms[locale]);
    expect(confirmation, locale).not.toContain(ownerTerms[locale]);
  }
});

test("interactive demo only claims supported pilot outcomes", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(messages.en["dashboard.metric.bookings"], { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(messages.en["dashboard.metric.crmLeads"], { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Instagram", { exact: true })).toHaveCount(0);
  await expect(page.getByText("VK", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("dashboard-readiness-progress").getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "7",
  );
  await expect(page.getByTestId("dashboard-readiness-primary")).toHaveAttribute(
    "href",
    "/demo/inbox",
  );

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/inbox`, { waitUntil: "domcontentloaded" });
  const channelFilters = page.getByRole("group", {
    name: messages.en["ops.inbox.channelFilters"],
  });
  const statusFilters = page.getByRole("group", {
    name: messages.en["ops.inbox.statusFilters"],
  });
  for (const unsupportedChannel of ["Instagram", "WhatsApp", "VK", "Email", "Call"]) {
    await expect(channelFilters.getByText(unsupportedChannel, { exact: true })).toHaveCount(0);
  }
  for (const unsupportedStage of [messages.en["stage.booked"], messages.en["stage.crm"]]) {
    await expect(statusFilters.getByText(unsupportedStage, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByTestId("inbox-status-filters-scroll")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${webBase}/demo/analytics`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText(messages.en["suite.analytics.bookingsOrders"], { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(messages.en["suite.analytics.revenue"], { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Send to CRM", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Instagram", { exact: true })).toHaveCount(0);

  await page.goto(`${webBase}/demo/inbox/demo-conv-anna`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: messages.en["ops.conversation.sendToCrm"] }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: messages.en["ops.common.bookAppointment"] }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: messages.en["ops.conversation.skip"] }).click();
  await expect(page.getByText(messages.en["ops.conversation.demo6"], { exact: true })).toContainText(
    "manager",
  );

  await page.goto(`${webBase}/demo/integrations`, { waitUntil: "domcontentloaded" });
  const telegram = page.getByTestId("integration-card-telegram");
  await expect(telegram).toContainText(messages.en["integrations.connected"]);
  await expect(page.getByTestId("pilot-readiness-telegram")).toContainText(
    messages.en["integrations.ready"],
  );
  await expect(page.getByTestId("integration-card-whatsapp")).not.toContainText(
    messages.en["integrations.connected"],
  );
  await expect(page.getByTestId("integration-card-instagram")).not.toContainText(
    messages.en["integrations.connected"],
  );
  await expect(
    page
      .getByTestId("integration-card-webhook")
      .getByRole("link", { name: messages.en["integrations.demoConnect"] }),
  ).toHaveAttribute("href", "/signup");

  await page.goto(`${webBase}/demo/onboarding`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Summer Studio", { exact: true })).toBeVisible();
  await expect(page.getByText(messages.en["onboarding.scenario.consult"], { exact: true })).toBeVisible();
  await expect(page.getByText(messages.en["onboarding.crm.none"], { exact: true })).toBeVisible();

  await page.goto(`${webBase}/widget/demo`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: widgetMessage("ru", "widget.chat.open") }).click();
  await expect(page.getByText("Студия Лето", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Здравствуйте! Подскажу цены, соберу удобное время и передам заявку менеджеру.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByPlaceholder(widgetMessage("ru", "widget.chat.placeholder"))
    .fill("Нужно окрашивание в пятницу");
  await page.getByRole("button", { name: widgetMessage("ru", "widget.chat.send") }).click();
  await expect(
    page.getByText(
      "Спасибо! Уточню услугу и удобное время, затем передам заявку менеджеру для подтверждения.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("demo planned integration requests respect the read-only boundary", async ({ page }) => {
  await page.goto(`${webBase}/demo/integrations`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("integrations-planned-toggle").click();
  const whatsapp = page.getByTestId("integration-card-whatsapp");
  await whatsapp.getByRole("button", { name: messages.en["integrations.availability.request"] }).click();
  await expect(page.getByTestId("integration-request-submit")).toHaveCount(0);
  await expect(page.getByTestId("integration-request-status")).toContainText(
    messages.en["integrations.request.noPermission"],
  );
});

test("demo analytics and automation use locale-aware system labels", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(`${webBase}/demo/analytics`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(page.getByTestId("analytics-recommendations-empty")).toBeVisible();
    await expect(
      page.getByText(analyticsExpectations[locale].monday, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(analyticsExpectations[locale].scenario, { exact: true }).first(),
    ).toBeVisible();
    expect(messages[locale]["ops.conversation.demo4"]).toContain(
      analyticsExpectations[locale].price,
    );
  }
  await expect(page.getByText("Website widget даёт самый быстрый путь до записи.")).toHaveCount(0);

  await page.goto(`${webBase}/demo/automations`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(messages[locale]["suite.automation.blockQualify"], { exact: true }).first(),
    ).toBeVisible();
  }
  await expect(page.getByText("Lead qualification", { exact: true })).toHaveCount(0);

  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(analyticsExpectations[locale].activity, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(analyticsExpectations[locale].leadUpdated, { exact: true }).first(),
    ).toBeVisible();
  }

  await page.goto(`${webBase}/demo/integrations`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  await expect(page.getByTestId("integration-card-telegram")).toContainText(
    messages.en["integrations.connected"],
  );
  await expect(page.getByTestId("pilot-readiness-telegram")).toContainText(
    messages.en["integrations.ready"],
  );
});

test("automation block labels follow locale switches without changing the draft", async ({ page }) => {
  test.setTimeout(90_000);

  await loginAsCleanUser(page, apiBase, { locale: "en" });
  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "localized-workflow",
            tenantId: "localized-tenant",
            name: "Booking appointment",
            description: null,
            status: "PAUSED",
            version: 1,
            publishedAt: null,
            steps: [
              {
                id: "localized-trigger",
                workflowId: "localized-workflow",
                type: "TRIGGER",
                name: "New message",
                positionX: 80,
                positionY: 120,
                config: { keywordFilter: "" },
              },
              {
                id: "localized-ai",
                workflowId: "localized-workflow",
                type: "AI_MESSAGE",
                name: "AI response",
                positionX: 320,
                positionY: 120,
                config: {},
              },
              {
                id: "localized-crm",
                workflowId: "localized-workflow",
                type: "ACTION",
                name: "",
                positionX: 560,
                positionY: 120,
                config: { blockType: "crm" },
              },
            ],
          },
        ],
      },
    });
  });

  await page.goto(`${webBase}/app/automations`, { waitUntil: "domcontentloaded" });
  const editor = page.getByTestId("automation-editor");
  await expect(editor).toBeVisible();

  const workflowName = editor.locator('input[aria-label="Workflow name"]');
  await workflowName.fill("VIP follow-up workflow");
  await page.getByPlaceholder(messages.en["suite.automation.keywordPlaceholder"]).fill("VIP-2026");

  const blocks = [
    {
      type: "trigger",
      title: "suite.automation.blockTrigger",
      subtitle: "suite.automation.blockTriggerSub",
    },
    {
      type: "ai",
      title: "suite.automation.blockGreeting",
      subtitle: "suite.automation.blockGreetingSub",
    },
    {
      type: "crm",
      title: "suite.automation.blockCrm",
      subtitle: "suite.automation.blockCrmSub",
    },
  ] as const;

  for (const locale of supportedLocales) {
    await selectLocale(page, locale);

    for (const block of blocks) {
      const node = page.getByTestId(`automation-block-${block.type}`);
      await expect(node).toHaveAccessibleName(messages[locale][block.title]);
      await expect(node.getByText(messages[locale][block.subtitle], { exact: true })).toBeVisible();
    }

    await expect(editor.locator("input").first()).toHaveValue("VIP follow-up workflow");
    await expect(
      page.getByPlaceholder(messages[locale]["suite.automation.keywordPlaceholder"]),
    ).toHaveValue("VIP-2026");
    await expect(
      editor.getByText(messages[locale]["suite.automation.unsaved"], { exact: true }),
    ).toBeVisible();
  }
});
