import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }) => {
  await loginAsCleanUser(page, apiBase);
});

type SocialLead = {
  id: string;
  name: string;
  source: string;
  channelType: "TELEGRAM" | "INSTAGRAM";
  status: "NEW" | "QUALIFIED";
  temperature: "WARM" | "HOT";
  interest: string;
  summary: string;
  valueAmount: number;
  lastMessageAt: string;
  createdAt: string;
};

const telegramLead: SocialLead = {
  id: "lead-social-telegram",
  name: "Telegram Pilot",
  source: "Telegram-бот",
  channelType: "TELEGRAM",
  status: "NEW",
  temperature: "WARM",
  interest: "Запись из Telegram",
  summary: "Хочу записаться на пробный визит",
  valueAmount: 9000,
  lastMessageAt: "2026-06-23T10:00:00.000Z",
  createdAt: "2026-06-23T09:50:00.000Z",
};

const instagramLead: SocialLead = {
  id: "lead-social-instagram",
  name: "Instagram Pilot",
  source: "Instagram Direct",
  channelType: "INSTAGRAM",
  status: "QUALIFIED",
  temperature: "HOT",
  interest: "Заявка из Instagram",
  summary: "Нужна консультация после рекламы",
  valueAmount: 15000,
  lastMessageAt: "2026-06-23T10:05:00.000Z",
  createdAt: "2026-06-23T09:45:00.000Z",
};

function apiLead(lead: SocialLead) {
  return {
    ...lead,
    tenantId: "tenant-demo",
    phone: null,
    email: null,
    companyName: null,
    currency: "RUB",
    assignedToUserId: null,
    assignedToName: null,
  };
}

function conversation(lead: SocialLead, index: number) {
  return {
    id: `conversation-social-${index}`,
    tenantId: "tenant-demo",
    leadId: lead.id,
    channel: {
      id: `channel-social-${index}`,
      tenantId: "tenant-demo",
      type: lead.channelType,
      status: "ACTIVE",
      name: lead.source,
    },
    channelType: lead.channelType,
    status: "OPEN",
    subject: lead.name,
    lastMessageAt: lead.lastMessageAt,
    aiEnabled: true,
    handoffRequested: false,
    lead: apiLead(lead),
    lastMessage: lead.summary,
    unreadCount: index === 1 ? 2 : 0,
    messages: [],
    events: [],
  };
}

function pipelineSummary(leads: SocialLead[]) {
  const statuses = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"];
  return {
    data: {
      stages: statuses.map((status) => {
        const stageLeads = leads.filter((lead) => lead.status === status).map(apiLead);
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

test("social-source leads stay traceable in inbox and pipeline", async ({ page }) => {
  const leads = [telegramLead, instagramLead];

  await page.route("**/api/inbox/conversations?*", async (route) => {
    const limit = route.request().url().includes("limit=100") ? 100 : 50;
    await route.fulfill({
      json: {
        data: leads.map(conversation),
        pagination: { page: 1, limit, total: leads.length, hasMore: false },
      },
    });
  });

  await page.route("**/api/leads/pipeline/summary", async (route) => {
    await route.fulfill({ json: pipelineSummary(leads) });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/inbox`, { waitUntil: "networkidle" });

  await expect(page.getByText("Telegram Pilot").first()).toBeVisible();
  await expect(page.getByText("Хочу записаться на пробный визит").first()).toBeVisible();
  await expect(page.getByText("Telegram bot").first()).toBeVisible();
  await expect(page.getByText("Telegram").first()).toBeVisible();

  await page.getByText("Instagram Pilot").first().click();
  await expect(page.getByText("Instagram Direct").first()).toBeVisible();
  await expect(page.getByText("Instagram").first()).toBeVisible();

  await page.goto(`${webBase}/app/leads`, { waitUntil: "networkidle" });

  await expect(page.getByText("Telegram Pilot").first()).toBeVisible();
  await expect(page.getByText("Telegram bot").first()).toBeVisible();
  await expect(page.getByText("Instagram Pilot").first()).toBeVisible();
  await expect(page.getByText("Instagram Direct").first()).toBeVisible();
});

