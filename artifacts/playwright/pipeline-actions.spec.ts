import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.setTimeout(60_000);

test.beforeEach(async ({ context, page }) => {
  await loginAsCleanUser(page, apiBase, { locale: "ru" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" },
  ]);
});

const baseLead = {
  id: "lead-api-1",
  tenantId: "tenant-demo",
  name: "API Лид",
  phone: null,
  email: null,
  companyName: null,
  source: "Website widget",
  channelType: "WEBSITE",
  status: "NEW",
  temperature: "WARM",
  valueAmount: 42000,
  currency: "RUB",
  interest: "Демо сделка",
  summary: "Проверяем воронку",
  assignedToUserId: null,
  assignedToName: "Мария К.",
  lastMessageAt: "2026-06-22T10:00:00.000Z",
  createdAt: "2026-06-22T09:55:00.000Z",
};

function pipelineSummary(input: typeof baseLead | Array<typeof baseLead> = baseLead) {
  const leads = Array.isArray(input) ? input : [input];
  const statuses = [
    "NEW",
    "IN_PROGRESS",
    "QUALIFIED",
    "BOOKED",
    "ORDERED",
    "SENT_TO_CRM",
    "CLOSED",
    "LOST",
  ];
  return {
    data: {
      stages: statuses.map((status) => {
        const stageLeads = leads.filter((lead) => lead.status === status);
        return {
          status,
          count: stageLeads.length,
          valueAmount: stageLeads.reduce((sum, lead) => sum + lead.valueAmount, 0),
          leads: stageLeads,
        };
      }),
    },
  };
}

test("pipeline advances API leads through the update adapter", async ({ page }) => {
  let patchedStatus = "";
  const updatedManager = "Updated API Manager";
  const updatedLead = {
    ...baseLead,
    status: "IN_PROGRESS",
    assignedToName: updatedManager,
  };

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary() });
  });

  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: "conversation-api-1",
            tenantId: "tenant-demo",
            leadId: "lead-api-1",
            channel: null,
            channelType: "WEBSITE",
            status: "OPEN",
            subject: "API Лид",
            lastMessageAt: "2026-06-22T10:00:00.000Z",
            aiEnabled: true,
            handoffRequested: false,
            lead: baseLead,
            lastMessage: "Проверяем воронку",
            unreadCount: 1,
            messages: [],
            events: [],
          },
        ],
        pagination: { page: 1, limit: 100, total: 1, hasMore: false },
      },
    });
  });

  await page.route("**/api/leads/lead-api-1", async (route) => {
    const body = route.request().postDataJSON() as { status?: string };
    patchedStatus = body.status ?? "";
    await route.fulfill({ json: { data: updatedLead } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByText("API Лид").first()).toBeVisible();
  await page.getByTestId(`pipeline-advance-${baseLead.id}`).click();

  await expect.poll(() => patchedStatus).toBe("IN_PROGRESS");
  await expect(page.getByText(updatedManager)).toBeVisible();
});

test("pipeline metrics count and value only qualified leads", async ({ page }) => {
  const metricLeads = [
    { ...baseLead, id: "lead-new", status: "NEW", valueAmount: 10_000 },
    { ...baseLead, id: "lead-qualified", status: "QUALIFIED", valueAmount: 30_000 },
    { ...baseLead, id: "lead-closed", status: "CLOSED", valueAmount: 100_000 },
  ];

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary(metricLeads) });
  });
  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: { data: [], pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    });
  });

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("pipeline-stat-qualification")).toContainText(
    "Доля квалифицированных",
  );
  await expect(page.getByTestId("pipeline-stat-qualification")).toContainText(/33\s*%/);
  await expect(page.getByTestId("pipeline-stat-qualified-average")).toContainText(
    "Средняя сумма квалифицированного лида",
  );
  await expect(page.getByTestId("pipeline-stat-qualified-average")).toContainText(
    /30[\s\u00a0]?000/,
  );
});

test("pipeline omits unavailable CRM, task, and implicit booking actions", async ({ page }) => {
  let currentLead = { ...baseLead, status: "QUALIFIED" };

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary(currentLead) });
  });
  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: { data: [], pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    });
  });

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByTestId(`pipeline-advance-${baseLead.id}`)).toHaveCount(0);
  await page.getByRole("button", { name: /Действия лида/ }).click();
  await expect(page.getByRole("menuitem", { name: /Отметить квалифицированным/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Закрыть лид/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /CRM|Создать задачу|Записать на приём/ })).toHaveCount(0);

  currentLead = { ...baseLead, status: "BOOKED" };
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId(`pipeline-advance-${baseLead.id}`)).toHaveCount(0);
});

test("pipeline blocks duplicate lead mutations and reconciles failures from the API", async ({
  page,
}) => {
  const reconciledManager = "Server Reconciled Manager";
  const reconciledLead = {
    ...baseLead,
    status: "QUALIFIED",
    assignedToName: reconciledManager,
  };
  let mutationCalls = 0;
  let reconciliationCalls = 0;
  let mutationStarted = false;
  let releaseMutation!: () => void;
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary() });
  });
  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: { data: [], pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    });
  });
  await page.route("**/api/leads/lead-api-1", async (route) => {
    if (route.request().method() === "GET") {
      reconciliationCalls += 1;
      await route.fulfill({ json: { data: reconciledLead } });
      return;
    }

    mutationCalls += 1;
    mutationStarted = true;
    await mutationGate;
    await route.fulfill({
      status: 409,
      json: { error: { code: "CONFLICT", message: "Lead changed on the server" } },
    });
  });

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });
  const advanceButton = page.getByTestId(`pipeline-advance-${baseLead.id}`);
  await expect(advanceButton).toBeVisible();

  await advanceButton.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  await expect.poll(() => mutationStarted).toBe(true);
  expect(mutationCalls).toBe(1);
  await expect(advanceButton).toBeDisabled();

  releaseMutation();

  await expect.poll(() => reconciliationCalls).toBe(1);
  await expect(page.getByText(reconciledManager)).toBeVisible();
  await expect(page.getByTestId(`pipeline-advance-${baseLead.id}`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Действия лида/ })).toBeEnabled();
  expect(mutationCalls).toBe(1);
});

test("pipeline initial load failure retries without showing an empty board", async ({ page }) => {
  let failLoad = true;

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    if (failLoad) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({ json: pipelineSummary() });
  });
  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: { data: [], pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    });
  });

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("pipeline-load-error")).toBeVisible();
  await expect(page.getByText(baseLead.name)).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/playwright/pipeline-load-error.png",
    fullPage: true,
    animations: "disabled",
  });

  failLoad = false;
  await page.getByTestId("pipeline-load-error").getByRole("button").click();

  await expect(page.getByText(baseLead.name).first()).toBeVisible();
  await expect(page.getByTestId("pipeline-load-error")).toHaveCount(0);
});

test("pipeline retains lead data when conversation enrichment fails", async ({ page }) => {
  let failConversationMap = true;

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary() });
  });
  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    if (failConversationMap) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary enrichment outage" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: [{ id: "conversation-api-1", leadId: baseLead.id }],
        pagination: { page: 1, limit: 100, total: 1, hasMore: false },
      },
    });
  });

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("pipeline-refresh-error")).toBeVisible();
  await expect(page.getByText(baseLead.name).first()).toBeVisible();

  failConversationMap = false;
  await page.getByTestId("pipeline-refresh-error").getByRole("button").click();

  await expect(page.getByTestId("pipeline-refresh-error")).toHaveCount(0);
  await expect(page.getByText(baseLead.name).first()).toBeVisible();
});

test("pipeline keeps successful data when a locale refresh fails", async ({ page }) => {
  let failRefresh = false;

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    if (failRefresh) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary refresh outage" } },
      });
      return;
    }
    await route.fulfill({ json: pipelineSummary() });
  });
  await page.route("**/api/inbox/conversations?limit=100", async (route) => {
    await route.fulfill({
      json: { data: [], pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    });
  });

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });
  await expect(page.getByText(baseLead.name).first()).toBeVisible();

  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  const currentLocale = await switcher.getAttribute("data-locale");
  const nextLocale = currentLocale === "en" ? "ru" : "en";
  failRefresh = true;
  await switcher.click();
  await page.getByTestId(`language-option-${nextLocale}`).click();

  await expect(page.getByTestId("pipeline-refresh-error")).toBeVisible();
  await expect(page.getByText(baseLead.name).first()).toBeVisible();

  failRefresh = false;
  await page.getByTestId("pipeline-refresh-error").getByRole("button").click();

  await expect(page.getByTestId("pipeline-refresh-error")).toHaveCount(0);
  await expect(page.getByText(baseLead.name).first()).toBeVisible();
});
