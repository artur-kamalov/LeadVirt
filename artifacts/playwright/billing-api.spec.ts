import { readFileSync } from "node:fs";
import { loginAsCleanUser } from "./helpers/auth";
import { expect, test, type Locator, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
}

async function selectLocale(page: Page, locale: string) {
  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  if ((await switcher.getAttribute("data-locale")) !== locale) {
    await switcher.click();
    await page.getByTestId(`language-option-${locale}`).click();
  }
  await expect(switcher).toHaveAttribute("data-locale", locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
});

const professionalPlan = {
  code: "PROFESSIONAL",
  name: "Professional",
  priceMonthlyRub: 24900,
  aiConversations: 2500,
  channelsLimit: 5,
  usersLimit: 10,
  scenariosLimit: 15,
  popular: true,
  bestFor: "Для салонов с несколькими администраторами",
  features: ["2 500 AI-диалогов", "5 каналов", "10 участников", "15 сценариев"],
};

const corporatePlan = {
  code: "CORPORATE",
  name: "Corporate",
  priceMonthlyRub: 120000,
  aiConversations: null,
  channelsLimit: null,
  usersLimit: null,
  scenariosLimit: null,
  popular: false,
  bestFor: "Для сети филиалов",
  features: ["Индивидуальные лимиты", "SLA", "Выделенный менеджер"],
};

const startPlan = {
  code: "START",
  name: "Start",
  priceMonthlyRub: 9900,
  aiConversations: 500,
  channelsLimit: 2,
  usersLimit: 3,
  scenariosLimit: 3,
  popular: false,
  features: [],
};

const businessPlan = {
  code: "BUSINESS",
  name: "Business",
  priceMonthlyRub: 59900,
  aiConversations: 10000,
  channelsLimit: 10,
  usersLimit: 25,
  scenariosLimit: 50,
  popular: false,
  features: [],
};

const catalogPlans = [startPlan, professionalPlan, businessPlan, corporatePlan];

async function mockBillingApi(page: Page) {
  const billingRequests = {
    selectedPlanCode: null as string | null,
    planSelection: null as null | {
      reference: string;
      plan: (typeof catalogPlans)[number];
      selectedAt: string;
      status: "CONTACT_REQUIRED";
      checkout: { available: false; mode: "manual_invoice" };
    },
    canceled: false,
    paymentMethodChangeRequested: false,
  };

  await page.route("**/api/billing/plans", async (route) => {
    await route.fulfill({
      json: {
        data: catalogPlans,
      },
    });
  });

  await page.route("**/api/billing/plan-selection", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { planCode?: string };
      billingRequests.selectedPlanCode = body.planCode ?? null;
      const plan = catalogPlans.find((item) => item.code === body.planCode) ?? startPlan;
      billingRequests.planSelection = {
        reference: "selection-playwright",
        plan,
        selectedAt: "2026-06-27T12:00:00.000Z",
        status: "CONTACT_REQUIRED",
        checkout: { available: false, mode: "manual_invoice" },
      };
    }
    await route.fulfill({ json: { data: billingRequests.planSelection } });
  });

  await page.route("**/api/billing/current-subscription", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { planCode?: string };
      billingRequests.selectedPlanCode = body.planCode ?? null;
      await route.fulfill({
        json: {
          data: {
            id: "sub-playwright",
            status: "ACTIVE",
            periodStart: "2026-06-01T00:00:00.000Z",
            periodEnd: "2026-07-01T00:00:00.000Z",
            plan: corporatePlan,
          },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        data: {
          id: "sub-playwright",
          status: "ACTIVE",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-07-01T00:00:00.000Z",
          plan: professionalPlan,
        },
      },
    });
  });

  await page.route("**/api/billing/current-subscription/cancel", async (route) => {
    billingRequests.canceled = route.request().method() === "POST";
    await route.fulfill({
      json: {
        data: {
          id: "sub-playwright",
          status: "CANCELED",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-07-01T00:00:00.000Z",
          plan: professionalPlan,
        },
      },
    });
  });

  await page.route("**/api/billing/payment-method", async (route) => {
    await route.fulfill({
      json: {
        data: {
          mode: "manual_invoice",
          label: "Безналичный расчёт по счёту",
          description: "Счёт выставляется вручную менеджером LeadVirt.ai.",
          status: "configured",
          updatedAt: "2026-06-01T00:00:00.000Z",
          nextActionLabel: "Запросить изменение",
        },
      },
    });
  });

  await page.route("**/api/billing/payment-method/change-request", async (route) => {
    billingRequests.paymentMethodChangeRequested = route.request().method() === "POST";
    await route.fulfill({
      json: {
        data: {
          requested: true,
          requestedAt: "2026-06-27T12:00:00.000Z",
          mode: "manual_invoice",
        },
      },
    });
  });

  await page.route("**/api/billing/invoices", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "invoice-playwright-2026-06",
            issuedAt: "2026-06-01T00:00:00.000Z",
            periodStart: "2026-06-01T00:00:00.000Z",
            periodEnd: "2026-07-01T00:00:00.000Z",
            amountRub: 24900,
            status: "PAID",
            plan: professionalPlan,
            downloadName: "leadvirt-invoice-2026-06.txt",
          },
        ],
      },
    });
  });

  await page.route("**/api/billing/usage", async (route) => {
    await route.fulfill({
      json: {
        data: {
          aiConversations: 321,
          aiConversationsLimit: 2500,
          messagesSent: 120,
          messagesReceived: 248,
          leadsCreated: 64,
          bookingsCreated: 18,
          ordersCreated: 5,
          crmSyncs: 44,
          workflowRuns: 39,
          channels: 3,
          channelsLimit: 5,
          users: 4,
          usersLimit: 10,
          scenarios: 7,
          scenariosLimit: 15,
        },
      },
    });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: {
            id: "tenant-demo",
            name: "Billing Studio",
            slug: "billing-studio",
            status: "TRIALING",
            businessType: "beauty",
            timezone: "Europe/Moscow",
          },
          owner: {
            id: "owner-demo",
            email: "owner@billing.test",
            name: "Owner",
            avatarUrl: null,
          },
          businessName: "Billing Studio",
          timezone: "Europe/Moscow",
        },
      },
    });
  });

  await page.route("**/api/settings/team", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: { data: { authMode: "demo", tenantScoped: true, currentRole: "OWNER" } },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  return billingRequests;
}

test("billing route renders API-backed plan and usage inside copied settings UI", async ({
  page,
}) => {
  const billingRequests = await mockBillingApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/billing`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");

  await expect(page.getByText("Биллинг и подписка")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Тариф «Профессиональный»" })).toBeVisible();
  await expect(page.getByText("24 900 ₽").first()).toBeVisible();
  await expect(page.getByText("AI-диалоги")).toBeVisible();
  await expect(page.getByText("321")).toBeVisible();
  await expect(page.getByText("2 500")).toBeVisible();
  await expect(page.getByText("Безналичный расчёт по счёту")).toBeVisible();
  await expect(page.getByText("Ручное выставление счетов")).toBeVisible();
  await expect(page.getByText("24 900 ₽").first()).toBeVisible();

  await page.getByRole("button", { name: "Запросить изменение" }).click();
  await expect(page.getByRole("button", { name: "Запрос отправлен" })).toBeVisible();
  expect(billingRequests.paymentMethodChangeRequested).toBe(true);

  const [invoiceDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Скачать счёт 01 июн. 2026 г." }).click(),
  ]);
  expect(invoiceDownload.suggestedFilename()).toBe("leadvirt-invoice-2026-06.txt");
  const invoicePath = await invoiceDownload.path();
  expect(invoicePath).toBeTruthy();
  const invoiceText = readFileSync(invoicePath!, "utf8");
  expect(invoiceText).toContain("Счёт: invoice-playwright-2026-06");
  expect(invoiceText).toContain("Клиент: Billing Studio");

  await page.getByRole("button", { name: "Изменить тариф" }).click();
  await expect(page.getByText("Для сетей, клиник, e-commerce и холдингов")).toBeVisible();
  await expect(page.getByText("от 120 000 ₽")).toBeVisible();

  await page.getByTestId("billing-plan-CORPORATE").getByRole("button", { name: "Выбрать" }).click();
  await expect(page.getByRole("heading", { name: "Тариф «Профессиональный»" })).toBeVisible();
  await expect(page.getByTestId("billing-plan-selection")).toContainText(
    "Выбран тариф «Корпоративный»",
  );
  await expect(page.getByTestId("billing-plan-selection")).toContainText(
    "Онлайн-оплата пока не подключена",
  );
  expect(billingRequests.selectedPlanCode).toBe("CORPORATE");

  await page.getByRole("button", { name: "Отменить подписку" }).click();
  await expect(page.getByRole("dialog", { name: "Отменить подписку?" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить отмену" }).click();
  await expect(page.getByText("Подписка отменена").first()).toBeVisible();
  await expect(page.getByText(/Доступ сохранён до/).first()).toBeVisible();
  expect(billingRequests.canceled).toBe(true);
});

test("billing sidebar link opens the billing route", async ({ page }) => {
  await mockBillingApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });
  await selectLocale(page, "ru");

  await page.getByRole("link", { name: /^(Выбрать тариф|Управлять тарифом)$/ }).click();
  await expect(page).toHaveURL(`${webBase}/app/billing`);
  await expect(page.getByText("Биллинг и подписка")).toBeVisible();
});

test("settings and billing localize six locales without mobile overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await mockBillingApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  const locales = {
    en: {
      tag: "en-US",
      profile: "Workspace and contacts",
      team: "Team and roles",
      billing: "Billing",
      billingHeading: "Billing and subscription",
    },
    ru: {
      tag: "ru-RU",
      profile: "Рабочее пространство и контакты",
      team: "Команда и роли",
      billing: "Биллинг",
      billingHeading: "Биллинг и подписка",
    },
    es: {
      tag: "es-ES",
      profile: "Espacio de trabajo y contactos",
      team: "Equipo y roles",
      billing: "Facturación",
      billingHeading: "Facturación y suscripción",
    },
    fr: {
      tag: "fr-FR",
      profile: "Espace de travail et contacts",
      team: "Équipe et rôles",
      billing: "Facturation",
      billingHeading: "Facturation et abonnement",
    },
    de: {
      tag: "de-DE",
      profile: "Arbeitsbereich und Kontakte",
      team: "Team und Rollen",
      billing: "Abrechnung",
      billingHeading: "Abrechnung und Abonnement",
    },
    pt: {
      tag: "pt-BR",
      profile: "Workspace e contatos",
      team: "Equipe e funções",
      billing: "Faturamento",
      billingHeading: "Faturamento e assinatura",
    },
  } as const;

  for (const [locale, copy] of Object.entries(locales)) {
    await page.goto(`${webBase}/app/settings`, { waitUntil: "domcontentloaded" });
    await selectLocale(page, locale);
    await expect(page.getByRole("heading", { name: copy.profile })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: copy.team, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.team })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: copy.billing, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy.billingHeading })).toBeVisible();

    const currency = new Intl.NumberFormat(copy.tag, {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(24900);
    await expect(page.getByText(currency).first()).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: locales.pt.billingHeading })).toBeVisible({
    timeout: 15_000,
  });
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({
    path: "artifacts/playwright/settings-billing-localized-mobile.png",
    fullPage: true,
  });
});

test("billing failure is actionable in the active locale", async ({ page }) => {
  await mockBillingApi(page);
  let allowRecovery = false;
  await page.route("**/api/billing/current-subscription", async (route) => {
    if (allowRecovery) {
      await route.fulfill({
        json: {
          data: {
            id: "sub-recovered",
            status: "ACTIVE",
            periodStart: "2026-06-01T00:00:00.000Z",
            periodEnd: "2026-07-01T00:00:00.000Z",
            plan: professionalPlan,
          },
        },
      });
      return;
    }
    await route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "billing offline" } },
    });
  });
  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  const error = page.getByTestId("settings-billing-load-error");
  await expect(error).toContainText("Data could not be loaded");
  await expect(
    page.getByText(
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 0,
      }).format(4900),
    ),
  ).toHaveCount(0);
  allowRecovery = true;
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Plan “Professional”" })).toBeVisible();
});

test("billing shows a truthful no-subscription state", async ({ page }) => {
  const billingRequests = await mockBillingApi(page);
  await page.route("**/api/billing/current-subscription", async (route) => {
    await route.fulfill({ json: { data: null } });
  });
  await page.route("**/api/billing/usage", async (route) => {
    await route.fulfill({
      json: {
        data: {
          aiConversations: 0,
          aiConversationsLimit: null,
          messagesSent: 0,
          messagesReceived: 0,
          leadsCreated: 0,
          bookingsCreated: 0,
          ordersCreated: 0,
          crmSyncs: 0,
          workflowRuns: 0,
          channels: 1,
          channelsLimit: null,
          users: 1,
          usersLimit: null,
          scenarios: 0,
          scenariosLimit: null,
        },
      },
    });
  });
  await page.route("**/api/billing/invoices", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("No active subscription")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a plan to get started" })).toBeVisible();
  await expect(page.getByText("Next charge:")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Plan “Professional”" })).toHaveCount(0);
  await expect(page.getByText("unlimited", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/not set/)).toHaveCount(4);
  await expect(page.getByText("No payments or invoices yet.")).toBeVisible();

  const choosePlan = page.getByTestId("billing-choose-plan");
  await expectTouchTarget(choosePlan);
  await choosePlan.click();
  await expect(page.getByTestId("billing-plan-START")).toContainText("9,900");
  await expect(page.getByTestId("billing-plan-PROFESSIONAL")).toContainText("24,900");
  await expect(page.getByTestId("billing-plan-BUSINESS")).toContainText("59,900");
  await expect(page.getByTestId("billing-plan-CORPORATE")).toContainText("120,000");
  await expect(page.getByText("CRM lead handoff", { exact: true })).toHaveCount(0);
  await expect(page.getByText("AI recommendations and insights", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Workflow A/B tests", { exact: true })).toHaveCount(0);
  await expect(page.getByText("SLA and availability guarantees", { exact: true })).toHaveCount(0);
  await page.getByTestId("billing-plan-START").getByRole("button", { name: "Choose" }).click();

  await expect(page.getByText("No active subscription")).toBeVisible();
  await expect(page.getByTestId("billing-plan-selection")).toContainText("Start selected");
  await expect(page.getByTestId("billing-plan-selection")).toContainText(
    "Your request is recorded",
  );
  await expect(page.getByText("Start is now active")).toHaveCount(0);
  expect(billingRequests.selectedPlanCode).toBe("START");

  await expect(page.getByRole("button", { name: "Request activation" })).toHaveCount(0);
  expect(billingRequests.paymentMethodChangeRequested).toBe(false);
});

test("billing empty catalog offers recovery and restores the published plans", async ({ page }) => {
  await mockBillingApi(page);
  let catalogAvailable = false;
  await page.route("**/api/billing/plans", async (route) => {
    await route.fulfill({ json: { data: catalogAvailable ? catalogPlans : [] } });
  });

  await page.goto(`${webBase}/app/billing`, { waitUntil: "domcontentloaded" });
  await selectLocale(page, "en");
  await page.getByTestId("billing-choose-plan").click();

  const dialog = page.getByRole("dialog", { name: "Choose a plan" });
  await expect(dialog.getByText("No plans are currently available.")).toBeVisible();
  await expect(dialog.getByText(/Refresh the catalog/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "View published plans" })).toHaveAttribute(
    "href",
    "/#pricing",
  );

  catalogAvailable = true;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("billing-plan-START")).toBeVisible();
  await expect(page.locator("[data-testid^='billing-plan-']")).toHaveCount(4);
});

test("billing keeps the public plan identity through the onboarding handoff", async ({ page }) => {
  const billingRequests = await mockBillingApi(page);
  await page.route("**/api/billing/current-subscription", async (route) => {
    await route.fulfill({ json: { data: null } });
  });

  await page.goto(`${webBase}/app/billing?plan=pro`, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/app\/billing\?plan=pro$/);
  const dialog = page.getByRole("dialog", { name: "Выбрать тариф" });
  await expect(dialog).toBeVisible();
  await page
    .getByTestId("billing-plan-PROFESSIONAL")
    .getByRole("button", { name: "Продолжить с этим тарифом" })
    .click();

  expect(billingRequests.selectedPlanCode).toBe("PROFESSIONAL");
  await expect(page.getByTestId("billing-plan-selection")).toContainText(
    "Выбран тариф «Профессиональный»",
  );
});
