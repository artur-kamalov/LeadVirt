import { expect, test, type Page } from "@playwright/test";
import { localizeDemoSeedText } from "../../apps/web/src/i18n/demo-seed-messages";
import { analyticsInsightLabel } from "../../apps/web/src/i18n/api-labels";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import { messages } from "../../apps/web/src/i18n/messages";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

const analyticsExpectations: Record<
  Locale,
  { monday: string; scenario: string; price: string; activity: string }
> = {
  en: {
    monday: "Mon",
    scenario: "Qualification and booking",
    price: "14,000-16,000",
    activity: "AI prepared a reply",
  },
  es: {
    monday: "lun",
    scenario: "Calificación y reserva",
    price: "14.000 a 16.000",
    activity: "La IA preparó una respuesta",
  },
  fr: {
    monday: "lun.",
    scenario: "Qualification et réservation",
    price: "14 000 à 16 000",
    activity: "L'IA a préparé une réponse",
  },
  de: {
    monday: "Mo",
    scenario: "Qualifizierung und Buchung",
    price: "14.000 bis 16.000",
    activity: "KI-Antwort vorbereitet",
  },
  pt: {
    monday: "seg.",
    scenario: "Qualificação e agendamento",
    price: "14.000 a 16.000",
    activity: "A IA preparou uma resposta",
  },
  ru: {
    monday: "пн",
    scenario: "Квалификация и запись",
    price: "14 000-16 000",
    activity: "AI подготовил ответ",
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
      page.getByText(localizeDemoSeedText("Виджет сайта", locale), { exact: true }),
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

test("demo analytics and automation use locale-aware system labels", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(`${webBase}/demo/analytics`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(analyticsInsightLabel("EARLY_BOOKING_TIME", locale), { exact: true }),
    ).toBeVisible();
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
      page.getByText(messages[locale]["suite.automation.scenarioBooking"], { exact: true }).first(),
    ).toBeVisible();
  }
  await expect(page.getByText("Квалификация и запись", { exact: true })).toHaveCount(0);

  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });
  for (const locale of supportedLocales) {
    await selectLocale(page, locale);
    await expect(
      page.getByText(analyticsExpectations[locale].activity, { exact: true }).first(),
    ).toBeVisible();
  }

  await page.goto(`${webBase}/demo/integrations`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  await expect(page.getByText(/"name": "New customer"/u)).toBeVisible();
  await expect(page.getByText(/"message": "Consultation request"/u)).toBeVisible();
  await expect(page.getByText(/Новый клиент|Нужна консультация/u)).toHaveCount(0);
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
