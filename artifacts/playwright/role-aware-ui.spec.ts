import { expect, test, type Page } from "@playwright/test";
import type { UserRole } from "@leadvirt/types";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const conversationId = "role-aware-conversation";
const leadId = "role-aware-lead";

test.setTimeout(90_000);

const lead = {
  id: leadId,
  tenantId: "tenant-role-aware",
  name: "Role Test Lead",
  phone: null,
  email: null,
  companyName: null,
  source: "Website widget",
  channelType: "WEBSITE",
  status: "NEW",
  temperature: "WARM",
  valueAmount: 15000,
  currency: "RUB",
  interest: "Consultation",
  summary: "Role-aware UI fixture",
  assignedToUserId: null,
  assignedToName: "Workspace Agent",
  lastMessageAt: "2026-07-15T10:00:00.000Z",
  createdAt: "2026-07-15T09:00:00.000Z",
};

const conversation = {
  id: conversationId,
  tenantId: "tenant-role-aware",
  leadId,
  channel: {
    id: "channel-role-aware",
    tenantId: "tenant-role-aware",
    type: "WEBSITE",
    status: "ACTIVE",
    name: "Website widget",
  },
  channelType: "WEBSITE",
  status: "OPEN",
  subject: "Role-aware conversation",
  lastMessageAt: "2026-07-15T10:00:00.000Z",
  aiEnabled: true,
  handoffRequested: false,
  lead,
  lastMessage: "Can you help me?",
  unreadCount: 1,
  messages: [
    {
      id: "role-aware-message",
      tenantId: "tenant-role-aware",
      conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      text: "Can you help me?",
      status: "RECEIVED",
      createdAt: "2026-07-15T10:00:00.000Z",
      attachments: [],
    },
  ],
  events: [],
};

function pipelineSummary() {
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
    stages: statuses.map((status) => ({
      status,
      count: status === "NEW" ? 1 : 0,
      valueAmount: status === "NEW" ? lead.valueAmount : 0,
      leads: status === "NEW" ? [lead] : [],
    })),
  };
}

async function mockRoleApis(page: Page, role: UserRole) {
  await page.context().addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = null;

    if (path.endsWith("/api/auth/me")) {
      data = {
        id: `user-${role.toLowerCase()}`,
        email: `${role.toLowerCase()}@role-aware.test`,
        name: `${role} User`,
        tenantId: "tenant-role-aware",
        role,
        authMode: "credentials",
        passwordChangeRequired: false,
      };
    } else if (path.endsWith("/api/current-tenant")) {
      data = {
        id: "tenant-role-aware",
        name: "Role-aware Workspace",
        slug: "role-aware-workspace",
        status: "TRIALING",
        role,
      };
    } else if (path.endsWith("/api/dashboard/summary")) {
      data = {
        metrics: {
          newLeadsCount: 1,
          aiConversationsCount: 1,
          bookingsOrdersCreated: 0,
          leadsSentToCrm: 0,
          averageResponseTimeSeconds: 0,
          conversionRate: 0,
        },
        recentActivity: [],
        channelPerformance: [],
        trend: [],
      };
    } else if (path.endsWith("/api/workflows")) {
      data = [];
    } else if (path.endsWith("/api/integrations")) {
      data = [];
    } else if (path.endsWith("/api/channels")) {
      data = [];
    } else if (path.endsWith("/api/settings/account")) {
      data = {
        businessName: "Role-aware Workspace",
        timezone: "Europe/Paris",
        logoDataUrl: null,
        tenant: {
          id: "tenant-role-aware",
          name: "Role-aware Workspace",
          slug: "role-aware-workspace",
          status: "TRIALING",
          businessType: "services",
          timezone: "Europe/Paris",
        },
        owner: {
          id: "owner-role-aware",
          email: "owner@role-aware.test",
          name: "Workspace Owner",
        },
      };
    } else if (path.endsWith("/api/settings/team")) {
      data = [];
    } else if (path.endsWith("/api/settings/security")) {
      data = {
        authMode: "credentials",
        tenantScoped: true,
        currentRole: role,
        passwordChangeRequired: false,
        sessions: [],
      };
    } else if (path.endsWith("/api/settings/billing")) {
      data = { billingMode: "manual", apiKeys: [] };
    } else if (path.endsWith("/api/settings/notifications")) {
      data = {
        new_lead: true,
        no_reply: true,
        booking: true,
        daily: false,
        tg_summary: true,
      };
    } else if (path.endsWith("/api/leads/pipeline/summary")) {
      data = pipelineSummary();
    } else if (path.endsWith(`/api/conversations/${conversationId}`)) {
      data = conversation;
    } else if (path.endsWith("/api/inbox/conversations")) {
      await route.fulfill({
        json: {
          data: [conversation],
          pagination: { page: 1, limit: 100, total: 1, hasMore: false },
        },
      });
      return;
    }

    await route.fulfill({ json: { data } });
  });
}

test("VIEWER gets read-only product controls", async ({ page }) => {
  await mockRoleApis(page, "VIEWER");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${webBase}/app/automations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("automation-read-only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "AI audit" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Knowledge" })).toHaveCount(0);
  await expect(page.getByTestId("product-topbar-open-inbox")).toHaveAccessibleName("Open inbox");

  await page.goto(`${webBase}/app/settings`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("settings-profile-read-only")).toBeVisible();
  await expect(page.getByTestId("settings-profile-read-only").locator("button").last()).toBeDisabled();
  await page.getByRole("button", { name: /Team and roles/ }).click();
  await expect(page.getByRole("button", { name: /Invite member/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Channels/ }).click();
  await expect(page.getByRole("switch").first()).toBeDisabled();

  await page.goto(`${webBase}/app/integrations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("integration-card-telegram").getByRole("button", { name: "Connect" })).toBeDisabled();
  await expect(page.getByTestId("api-webhook-sample")).toHaveCount(0);

  await page.goto(`${webBase}/app/leads`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Role Test Lead").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Move lead: Role Test Lead" })).toHaveCount(0);

  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-read-only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send to CRM/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Mark as qualified/ })).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/playwright/role-aware-viewer-conversation.png",
    fullPage: true,
  });
});

test("AGENT can operate leads and conversations but not administration", async ({ page }) => {
  await mockRoleApis(page, "AGENT");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${webBase}/app/automations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("automation-read-only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await page.goto(`${webBase}/app/integrations`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("integration-card-telegram").getByRole("button", { name: "Connect" })).toBeDisabled();

  await page.goto(`${webBase}/app/settings`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("settings-profile-read-only")).toBeVisible();
  await page.getByRole("button", { name: /Team and roles/ }).click();
  await expect(page.getByRole("button", { name: /Invite member/ })).toHaveCount(0);

  await page.goto(`${webBase}/app/leads`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Move lead: Role Test Lead" })).toBeVisible();

  await page.goto(`${webBase}/app/inbox/${conversationId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-operator")).toBeVisible();
  await expect(page.getByTestId("product-topbar-open-inbox")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mark as qualified/ }).first()).toBeVisible();
});
