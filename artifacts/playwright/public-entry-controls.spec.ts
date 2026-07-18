import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiMockHeaders = {
  "access-control-allow-origin": webBase,
  "access-control-allow-credentials": "true",
  "content-type": "application/json",
};

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
});

test("landing CTAs enter signup with a safe onboarding intent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("link", { name: "LeadVirt.ai" }).first()).toHaveAttribute(
    "href",
    "/",
  );

  const primaryCta = page.getByTestId("landing-desktop-trial");
  await expect(primaryCta).toHaveAttribute("href", "/signup?returnTo=%2Fonboarding");
  await primaryCta.click();
  await expect(page).toHaveURL(`${webBase}/signup?returnTo=%2Fonboarding`);

  await page.goto(`${webBase}/#pricing`, { waitUntil: "domcontentloaded" });
  const professionalCta = page.getByTestId("pricing-cta-pro");
  await expect(professionalCta).toHaveAttribute(
    "href",
    "/signup?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro",
  );
  await expect(page.getByTestId("pricing-cta-corporate")).toHaveAttribute(
    "href",
    "/signup?plan=corporate&returnTo=%2Fonboarding%3Fplan%3Dcorporate",
  );
});

test("public pricing uses the shared RUB catalog without wrapping the corporate price", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/#pricing`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("pricing-price-start")).toHaveText("9,900 RUB");
  await expect(page.getByTestId("pricing-price-pro")).toHaveText("24,900 RUB");
  await expect(page.getByTestId("pricing-price-business")).toHaveText("59,900 RUB");
  await expect(page.getByTestId("pricing-price-corporate")).toHaveText("from 120,000 RUB");
  await expect(
    page.getByText(/All listed prices and invoices are in Russian rubles \(RUB\)/),
  ).toBeVisible();
  for (const unavailableFeature of [
    "CRM lead handoff",
    "Advanced analytics and reports",
    "Automation builder",
    "Priority support",
    "AI recommendations and insights",
    "Workflow A/B tests",
    "Account manager",
    "SLA and availability guarantees",
    "Custom integrations",
    "Dedicated infrastructure",
    "Team training",
    "Personal manager 24/7",
  ]) {
    await expect(page.getByText(unavailableFeature, { exact: true })).toHaveCount(0);
  }

  const corporatePrice = page.getByTestId("pricing-price-corporate");
  await expect(corporatePrice).toBeVisible();
  expect(
    await corporatePrice.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("landing describes the current pilot in all locales without mobile overflow", async ({
  context,
  page,
}) => {
  const locales = {
    en: {
      badge: "Pilot: Telegram and website widget",
      knowledge: "Answers from published knowledge",
      request: "Request captured in Inbox",
      handoff: "Operator handoff requested",
      inbox: "Saved to Inbox",
      currency: "All listed prices and invoices are in Russian rubles (RUB).",
      beauty:
        "Answers about services, prices, and hours, then captures appointment requests for the team.",
    },
    ru: {
      badge: "Пилот: Telegram и виджет для сайта",
      knowledge: "Ответы по опубликованным знаниям",
      request: "Запрос сохранён во входящих",
      handoff: "Запрошена передача оператору",
      inbox: "Сохранено во входящих",
      currency: "Все цены и счета указаны в российских рублях (RUB).",
      beauty:
        "Ответы об услугах, ценах и графике с сохранением запросов на визит для команды.",
    },
    es: {
      badge: "Piloto: Telegram y widget web",
      knowledge: "Respuestas basadas en el conocimiento publicado",
      request: "Solicitud guardada en la bandeja de entrada",
      handoff: "Transferencia a un agente solicitada",
      inbox: "Guardado en la bandeja de entrada",
      currency: "Todos los precios y facturas se indican en rublos rusos (RUB).",
      beauty:
        "Respuestas sobre servicios, precios y horarios, con solicitudes de cita guardadas para el equipo.",
    },
    fr: {
      badge: "Pilote : Telegram et widget web",
      knowledge: "Réponses fondées sur les connaissances publiées",
      request: "Demande enregistrée dans la boîte de réception",
      handoff: "Transfert à un opérateur demandé",
      inbox: "Enregistré dans la boîte de réception",
      currency: "Tous les prix et factures sont indiqués en roubles russes (RUB).",
      beauty:
        "Réponses sur les services, les tarifs et les horaires, avec les demandes de rendez-vous transmises à l'équipe.",
    },
    de: {
      badge: "Pilot: Telegram und Website-Widget",
      knowledge: "Antworten aus veröffentlichtem Wissen",
      request: "Anfrage im Posteingang gespeichert",
      handoff: "Übergabe an Mitarbeiter angefordert",
      inbox: "Im Posteingang gespeichert",
      currency: "Alle Preise und Rechnungen sind in russischen Rubeln (RUB) angegeben.",
      beauty:
        "Antworten zu Leistungen, Preisen und Öffnungszeiten; Terminwünsche werden für das Team gespeichert.",
    },
    pt: {
      badge: "Piloto: Telegram e widget para site",
      knowledge: "Respostas baseadas no conhecimento publicado",
      request: "Solicitação salva na Caixa de entrada",
      handoff: "Transferência para atendente solicitada",
      inbox: "Salvo na Caixa de entrada",
      currency: "Todos os preços e faturas são indicados em rublos russos (RUB).",
      beauty:
        "Respostas sobre serviços, preços e horários, com solicitações de atendimento salvas para a equipe.",
    },
  } as const;

  await page.setViewportSize({ width: 390, height: 844 });

  for (const [locale, copy] of Object.entries(locales)) {
    await context.addCookies([
      { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
    ]);
    await page.goto(webBase, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(copy.badge, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.knowledge, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.request, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.handoff, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.inbox, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.beauty, { exact: true })).toBeVisible();
    await expect(page.getByTestId("pricing-currency-notice")).toHaveText(copy.currency);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }
});

test("landing scenarios avoid unsupported automation claims in English and Russian", async ({
  context,
  page,
}) => {
  const locales = {
    en: {
      scenarios: [
        ["Beauty", "Request: Haircut this evening"],
        ["Healthcare", "Request: Cardiology consultation"],
        ["E-commerce", "Request: Black sweater, size L"],
        ["Education", "Request: Design course details"],
        ["Auto service", "Request: Oil change, Toyota Camry"],
        ["Services (B2B/B2C)", "Request: Deep clean, 2 bedrooms"],
      ],
      forbidden: [
        "New booking: 2:00 PM",
        "Lead added to CRM",
        "Automated bookings",
        "appointment reminders",
        "Symptom qualification",
        "doctor bookings",
        "Stock answers",
        "order status updates",
        "New order",
        "Maintenance bookings",
        "repair status updates",
        "Photo-based estimates",
        "Added to CRM",
      ],
    },
    ru: {
      scenarios: [
        ["Бьюти-сфера", "Запрос: Стрижка сегодня вечером"],
        ["Медицина", "Запрос: Консультация кардиолога"],
        ["E-commerce", "Запрос: Чёрный свитер, размер L"],
        ["Образование", "Запрос: Детали курса «Дизайн»"],
        ["Автосервисы", "Запрос: Замена масла, Toyota Camry"],
        ["Услуги (B2B/B2C)", "Запрос: Генеральная уборка, 2 комнаты"],
      ],
      forbidden: [
        "Новая запись: 14:00",
        "Лид добавлен в CRM",
        "Автоматическая запись",
        "напоминания о визитах",
        "Квалификация симптомов",
        "запись к врачам",
        "Ответы по наличию",
        "статусы заказов",
        "Новый заказ",
        "Запись на ТО",
        "статус ремонта",
        "Оценка стоимости по фото",
        "Добавлено в CRM",
      ],
    },
  } as const;

  await page.setViewportSize({ width: 390, height: 844 });

  for (const [locale, copy] of Object.entries(locales)) {
    await context.addCookies([
      { name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" },
    ]);
    await page.goto(webBase, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const body = page.locator("body");
    const niches = page.locator("#niches");
    await expect(niches).toBeVisible();
    await niches.scrollIntoViewIfNeeded();

    for (const phrase of copy.forbidden) {
      await expect(body).not.toContainText(phrase);
    }

    for (const [title, outcome] of copy.scenarios) {
      const niche = niches.getByRole("button").filter({ hasText: title });
      await expect(niche).toHaveCount(1);
      await niche.click();
      await expect(niches).toContainText(outcome);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
    }
  }
});

test("demo readiness actions stay inside the demo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded" });

  const primary = page.getByTestId("dashboard-readiness-primary");
  await expect(primary).toHaveAttribute("href", "/demo/knowledge?view=overview");
  await primary.click();

  await expect(page).toHaveURL(`${webBase}/demo/knowledge?view=overview`);
  await expect(page).not.toHaveURL(/\/login/u);
});

test("selected plan resumes onboarding after email OTP", async ({ page }) => {
  await page.route("**/api/auth/email-otp/config", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: { data: { enabled: true, codeLength: 6, resendAfterSeconds: 60 } },
    });
  });
  await page.route("**/api/auth/email-otp/request", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          sent: true,
          challengeId: "a".repeat(48),
          expiresAt: "2026-07-17T20:10:00.000Z",
          resendAfterSeconds: 60,
          debugCode: "123456",
        },
      },
    });
  });
  await page.route("**/api/auth/email-otp/verify", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          id: "new-owner",
          tenantId: "new-tenant",
          email: "new-owner@example.com",
          phone: null,
          name: "New Owner",
          avatarUrl: null,
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
          isNewUser: true,
        },
      },
    });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          id: "new-owner",
          tenantId: "new-tenant",
          email: "new-owner@example.com",
          name: "New Owner",
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      headers: apiMockHeaders,
      json: {
        data: {
          businessProfileVersion: 1,
          businessProfileEtag: '"business-profile-public-entry-1"',
          businessProfileUpdatedAt: "2026-07-17T20:10:00.000Z",
          currentStep: "business",
          completedSteps: [],
          data: {},
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/signup?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute(
    "href",
    "/login?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro",
  );
  const selectedPlan = page.getByTestId("auth-selected-plan");
  await expect(selectedPlan).toContainText("Selected plan");
  await expect(selectedPlan).toContainText("Professional");
  await expect(selectedPlan).toContainText("RUB");
  await expect(selectedPlan.getByRole("link", { name: "Change plan" })).toHaveAttribute(
    "href",
    "/#pricing",
  );
  await page.getByLabel("Work email").fill("new-owner@example.com");
  await page.getByTestId("email-otp-request").click();
  await page.getByTestId("email-otp-verify").click();

  await expect(page).toHaveURL(`${webBase}/onboarding?plan=pro`, { timeout: 15_000 });
});

test("desktop navigation aligns Features and Pricing below the fixed header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  for (const [label, selector] of [
    ["Features", "#features"],
    ["Pricing", "#pricing"],
  ] as const) {
    await page.getByRole("link", { name: label, exact: true }).first().click();
    await expect
      .poll(async () =>
        page.locator(selector).evaluate((node) => Math.round(node.getBoundingClientRect().top)),
      )
      .toBe(80);
  }
});

test("mobile menu traps focus, restores its trigger, and keeps 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(webBase, { waitUntil: "domcontentloaded" });

  const menu = page.getByTestId("landing-mobile-menu");
  await expect(page.getByTestId("language-switcher").first()).toBeEnabled();
  await expect(menu).toHaveAttribute("aria-label", "Open menu");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(await menu.boundingBox()).toMatchObject({ width: 44, height: 44 });

  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");

  const backdrop = page.getByTestId("landing-mobile-menu-backdrop");
  const dialog = page.getByTestId("landing-mobile-menu-dialog");
  const close = page.getByTestId("landing-mobile-menu-close");
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(close).toBeFocused();
  await expect(close).toHaveAccessibleName("Close menu");
  await expect.poll(async () => Math.round((await backdrop.boundingBox())?.height ?? 0)).toBe(844);
  const backdropBox = await backdrop.boundingBox();
  expect(backdropBox?.width).toBe(390);
  await expect.poll(async () => Math.round((await close.boundingBox())?.height ?? 0)).toBe(44);

  for (const target of [
    page.getByRole("link", { name: "Solutions", exact: true }),
    page.getByRole("link", { name: "Features", exact: true }),
    page.getByRole("link", { name: "Pricing", exact: true }),
    page.getByTestId("landing-mobile-login"),
  ]) {
    await expect
      .poll(async () => Math.round((await target.boundingBox())?.height ?? 0))
      .toBeGreaterThanOrEqual(44);
  }

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="landing-mobile-menu-dialog"]')),
      ),
    ).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});
