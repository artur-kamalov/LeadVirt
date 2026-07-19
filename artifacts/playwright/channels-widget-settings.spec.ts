import { expect, test } from "@playwright/test";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes("write-only outbound webhook")) {
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
    return;
  }
  await loginAsCleanUser(page, apiBase);
  const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale: "en" },
  });
  expect(localeResponse.ok()).toBeTruthy();
});

function websiteChannel(title = "LeadVirt.ai") {
  return {
    id: "channel-website",
    tenantId: "tenant-demo",
    type: "WEBSITE",
    status: "ACTIVE",
    name: "Website widget",
    publicKey: "demo-website-widget",
    settings: {
      widget: {
        title,
        subtitle: "AI concierge",
        businessName: "Demo company",
        welcomeMessage: "Welcome! I am the LeadVirt.ai concierge.",
        primaryColor: "#34d399",
        accentColor: "#10b981",
        position: "bottom-right",
        locale: "en-US",
        suggestedReplies: ["Book a demo", "What does it cost?", "Talk to a manager"],
        consentText: "By sending a message, you agree to be contacted about your request.",
        poweredBy: "LeadVirt.ai",
      },
    },
    lastHealthAt: "2026-06-22T10:00:00.000Z",
    automaticRepliesEnabled: false,
    automaticRepliesGeneration: 1,
  };
}

test("channel controls stay unavailable while loading and after a load failure", async ({
  page,
}) => {
  let loadRequests = 0;
  let mutationRequests = 0;
  let failLoads = true;
  let releaseInitialLoad: (() => void) | undefined;
  const initialLoadGate = new Promise<void>((resolve) => {
    releaseInitialLoad = resolve;
  });

  await page.route("**/api/channels", async (route) => {
    if (route.request().method() !== "GET") {
      mutationRequests += 1;
      await route.fulfill({ status: 500, json: { error: { message: "Unexpected mutation" } } });
      return;
    }

    loadRequests += 1;
    await initialLoadGate;
    if (failLoads) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }

    await route.fulfill({ json: { data: [] } });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${webBase}/app/settings?tab=channels`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("settings-channels-loading")).toBeVisible();
  await expect(page.getByTestId("settings-channels-loading").getByRole("status")).toHaveText(
    "Loading current data...",
  );
  await expect(page.getByTestId("settings-channels-list")).toHaveCount(0);

  releaseInitialLoad?.();
  await expect(page.getByTestId("settings-channels-load-error")).toBeVisible();
  await expect(page.getByTestId("settings-channels-list")).toHaveCount(0);
  expect(mutationRequests).toBe(0);
  await page.screenshot({
    path: "artifacts/playwright/settings-channels-load-error.png",
    fullPage: true,
    animations: "disabled",
  });

  const failedLoadRequests = loadRequests;
  failLoads = false;
  await page.getByTestId("settings-channels-load-error").getByRole("button").click();
  await expect.poll(() => loadRequests).toBeGreaterThan(failedLoadRequests);
  const channelList = page.getByTestId("settings-channels-list");
  await expect(channelList).toBeVisible();
  await expect(channelList.getByRole("switch")).toHaveCount(2);
  await expect(channelList.getByRole("switch", { name: "Website" })).toBeVisible();
  await expect(channelList.getByRole("switch", { name: "Webhook/API" })).toBeVisible();
  await expect(channelList.getByRole("switch", { name: "Telegram" })).toHaveCount(0);
  await expect(
    channelList.getByRole("link", { name: "Manage Telegram in Integrations" }),
  ).toHaveAttribute("href", "/app/integrations");
  await expect(page.getByTestId("settings-channel-instagram")).toContainText("Coming soon");
  expect(mutationRequests).toBe(0);
  await page.screenshot({
    path: "artifacts/playwright/settings-channels-authoritative-controls.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    channelList.getByRole("link", { name: "Manage Telegram in Integrations" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "artifacts/playwright/settings-channels-authoritative-controls-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  const mobileBottomOverlap = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="settings-channel-call"]');
    const navigation = document.querySelector("nav.fixed.bottom-0");
    if (!(row instanceof HTMLElement) || !(navigation instanceof HTMLElement)) return null;
    return row.getBoundingClientRect().bottom - navigation.getBoundingClientRect().top;
  });
  expect(mobileBottomOverlap).not.toBeNull();
  expect(mobileBottomOverlap ?? 1).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "artifacts/playwright/settings-channels-authoritative-controls-mobile-bottom.png",
    animations: "disabled",
  });
});

test("settings channels tab saves website widget settings", async ({ page }) => {
  let patchedBody: {
    status?: string;
    settings?: {
      widget?: {
        title?: string;
        suggestedReplies?: string[];
      };
    };
  } | null = null;

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: {
            id: "tenant-demo",
            name: "Demo Company",
            slug: "demo-company",
            status: "ACTIVE",
            timezone: "Europe/Paris",
          },
          owner: { id: "user-demo", email: "admin@leadvirt.ai", name: "Demo Owner" },
          businessName: "Demo Company",
          timezone: "Europe/Paris",
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

  await page.route("**/api/channels/channel-website", async (route) => {
    patchedBody = route.request().postDataJSON() as NonNullable<typeof patchedBody>;
    await route.fulfill({
      json: { data: websiteChannel(patchedBody.settings?.widget?.title ?? "Updated") },
    });
  });

  await page.route("**/api/channels", async (route) => {
    await route.fulfill({
      json: {
        data: [
          websiteChannel(),
          {
            id: "channel-telegram",
            tenantId: "tenant-demo",
            type: "TELEGRAM",
            status: "ACTIVE",
            name: "Telegram bot",
            publicKey: "demo-telegram-webhook",
            settings: {},
            lastHealthAt: null,
          },
        ],
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  await page.locator("main nav").getByRole("button").nth(2).click();
  const websiteRow = page.getByText("Website widget", { exact: true }).locator("../..");
  await expect(websiteRow).toBeVisible();
  await websiteRow.getByRole("button", { name: /Configure/ }).click();
  await expect(page.getByText("Website widget settings")).toBeVisible();

  await page.getByLabel("Title", { exact: true }).fill("LeadVirt Concierge");
  await page.getByLabel("Quick replies").fill("Book a demo\nWhat does it cost?");
  await page.getByRole("button", { name: "Save widget" }).click();

  await expect.poll(() => patchedBody?.settings?.widget?.title).toBe("LeadVirt Concierge");
  expect(patchedBody?.settings?.widget?.suggestedReplies).toEqual([
    "Book a demo",
    "What does it cost?",
  ]);
});

test("webhook secret is shown once, redacted after reload, and explicitly rotated", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let createdBody: { type?: string; name?: string; status?: string } | null = null;
  let channelCreated = false;
  let currentRole = "OWNER";
  let rotationRequests = 0;
  let releaseRotation: (() => void) | null = null;
  const rotationGate = new Promise<void>((resolve) => {
    releaseRotation = resolve;
  });

  const redactedChannel = {
    id: "channel-webhook",
    tenantId: "tenant-clean",
    type: "WEBHOOK",
    status: "ACTIVE",
    name: "Webhook/API",
    publicKey: "lvwh_settings_smoke",
    settings: {
      webhook: {
        publicKey: "lvwh_settings_smoke",
        secretConfigured: true,
        autoReply: true,
        acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"],
      },
    },
    lastHealthAt: null,
    automaticRepliesEnabled: false,
    automaticRepliesGeneration: 1,
  };

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-clean",
          email: "clean@example.com",
          name: "Clean Owner",
          avatarUrl: null,
          role: currentRole,
          tenantId: "tenant-clean",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "tenant-clean",
          name: "Clean Company",
          slug: "clean-company",
          status: "ACTIVE",
          timezone: "Europe/Paris",
          role: currentRole,
        },
      },
    });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: {
            id: "tenant-clean",
            name: "Clean Company",
            slug: "clean-company",
            status: "ACTIVE",
            timezone: "Europe/Paris",
          },
          owner: { id: "user-clean", email: "clean@example.com", name: "Clean Owner" },
          businessName: "Clean Company",
          timezone: "Europe/Paris",
        },
      },
    });
  });
  await page.route("**/api/settings/team", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({ json: { data: { tenantScoped: true, currentRole } } });
  });
  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/channels", async (route) => {
    if (route.request().method() === "POST") {
      createdBody = route.request().postDataJSON() as NonNullable<typeof createdBody>;
      channelCreated = true;
      await route.fulfill({
        status: 201,
        json: {
          data: { ...redactedChannel, oneTimeSecret: "settings-smoke-secret" },
        },
      });
      return;
    }

    await route.fulfill({ json: { data: channelCreated ? [redactedChannel] : [] } });
  });

  await page.route("**/api/channels/channel-webhook/automatic-replies/readiness", async (route) => {
    await route.fulfill({
      json: {
        data: {
          channelId: "channel-webhook",
          status: "BLOCKED",
          enabled: false,
          canActivate: false,
          generation: 1,
          activePublicationId: null,
          activePublicationEtag: null,
          activeCapabilitySetHash: null,
          activatedAt: null,
          blockers: [{ code: "KNOWLEDGE_REQUIRED", message: "Knowledge required" }],
        },
      },
    });
  });

  await page.route("**/api/channels/channel-webhook/webhook-secret/rotate", async (route) => {
    rotationRequests += 1;
    expect(route.request().method()).toBe("POST");
    await rotationGate;
    await route.fulfill({
      json: {
        data: {
          channel: redactedChannel,
          oneTimeSecret: "settings-rotated-secret",
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  await page.locator("main nav").getByRole("button").nth(2).click();
  await expect(page.getByText("Webhook/API")).toBeVisible();
  await page.getByRole("switch", { name: /Webhook/ }).click();

  await expect.poll(() => createdBody?.type).toBe("WEBHOOK");
  expect(createdBody?.status).toBe("ACTIVE");

  await expect(page.getByText("lvwh_settings_smoke", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("http://localhost:4001/api/public/channels/webhook/lvwh_settings_smoke/events"),
  ).toBeVisible();
  await expect(page.getByText("x-leadvirt-webhook-secret")).toBeVisible();
  await expect(page.getByText("settings-smoke-secret")).toBeVisible();
  await expect(page.getByText(/will not be shown again/i)).toBeVisible();

  const storedAfterCreate = await page.evaluate(() =>
    JSON.stringify({
      localStorage: Object.fromEntries(Object.entries(localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    }),
  );
  expect(storedAfterCreate).not.toContain("settings-smoke-secret");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("settings-smoke-secret")).toBeHidden();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("main nav").getByRole("button").nth(2).click();
  await page.getByRole("button", { name: "Configure Webhook/API" }).click();

  await expect(page.getByTestId("webhook-secret-status")).toHaveText("Secret configured");
  await expect(page.getByText("settings-smoke-secret")).toBeHidden();
  await expect(page.getByText(/saved secrets are never displayed/i)).toBeVisible();

  await page.getByTestId("webhook-rotate-secret").click();
  const confirmDialog = page.getByRole("dialog").last();
  await expect(confirmDialog).toHaveAccessibleName("Rotate webhook secret?");
  const confirmSubmit = confirmDialog.getByTestId("confirm-dialog-submit");
  await confirmSubmit.click();

  await expect.poll(() => rotationRequests).toBe(1);
  await expect(confirmDialog).toBeVisible();
  await expect(confirmSubmit).toBeDisabled();
  await expect(confirmSubmit).toHaveAttribute("aria-busy", "true");
  releaseRotation?.();
  await expect(page.getByTestId("webhook-one-time-secret")).toHaveText("settings-rotated-secret");
  await expect(page.getByText("settings-smoke-secret")).toBeHidden();

  const storedAfterRotation = await page.evaluate(() =>
    JSON.stringify({
      localStorage: Object.fromEntries(Object.entries(localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    }),
  );
  expect(storedAfterRotation).not.toContain("settings-rotated-secret");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Configure Webhook/API" }).click();
  await expect(page.getByText("settings-rotated-secret")).toBeHidden();
  await expect(page.getByTestId("webhook-secret-status")).toHaveText("Secret configured");
  await expect(page.getByText("Webhook secret rotated")).toBeHidden({ timeout: 10_000 });
  await page.screenshot({
    path: "artifacts/playwright/settings-webhook-secret-redacted-desktop.png",
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("settings-mobile-section-selector").getByRole("combobox").click();
  await page.getByRole("option", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Configure Webhook/API" }).click();
  await expect(page.getByTestId("webhook-secret-panel")).toBeVisible();
  await expect(page.getByText("settings-rotated-secret")).toBeHidden();
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);
  await page.screenshot({
    path: "artifacts/playwright/settings-webhook-secret-redacted-mobile.png",
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Close", exact: true }).click();
  currentRole = "MANAGER";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("main nav").getByRole("button").nth(2).click();
  await page.getByRole("button", { name: "Configure Webhook/API" }).click();
  await expect(page.getByTestId("webhook-rotate-secret")).toHaveCount(0);
});

test("owners configure write-only outbound webhook delivery with retry and role gating", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let currentRole = "OWNER";
  let targetConfigured = true;
  let authenticationConfigured = true;
  let sampleRequests = 0;
  const patchBodies: Array<Record<string, unknown>> = [];
  let releaseSuccessfulSave: (() => void) | null = null;
  const successfulSaveGate = new Promise<void>((resolve) => {
    releaseSuccessfulSave = resolve;
  });

  const webhookChannel = () => ({
    id: "channel-webhook",
    tenantId: "tenant-clean",
    type: "WEBHOOK",
    status: "ACTIVE",
    name: "Webhook/API",
    publicKey: "lvwh_outbound_settings",
    settings: {
      webhook: {
        secretConfigured: true,
        outbound: { targetConfigured, authenticationConfigured },
      },
    },
    lastHealthAt: null,
    automaticRepliesEnabled: true,
    automaticRepliesGeneration: 1,
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "user-clean",
          email: "clean@example.com",
          name: "Clean Owner",
          avatarUrl: null,
          role: currentRole,
          tenantId: "tenant-clean",
          authMode: "credentials",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "tenant-clean",
          name: "Clean Company",
          slug: "clean-company",
          status: "ACTIVE",
          timezone: "Europe/Paris",
          role: currentRole,
        },
      },
    });
  });
  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: {
            id: "tenant-clean",
            name: "Clean Company",
            slug: "clean-company",
            status: "ACTIVE",
            timezone: "Europe/Paris",
          },
          owner: { id: "user-clean", email: "clean@example.com", name: "Clean Owner" },
          businessName: "Clean Company",
          timezone: "Europe/Paris",
        },
      },
    });
  });
  await page.route("**/api/settings/team", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({ json: { data: { tenantScoped: true, currentRole } } });
  });
  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [webhookChannel()] } });
  });
  await page.route("**/api/channels/channel-webhook/automatic-replies/readiness", async (route) => {
    await route.fulfill({
      json: {
        data: {
          channelId: "channel-webhook",
          status: "ACTIVE",
          enabled: true,
          canActivate: true,
          generation: 1,
          activePublicationId: null,
          activePublicationEtag: null,
          activeCapabilitySetHash: null,
          activatedAt: null,
          blockers: [],
        },
      },
    });
  });
  await page.route("**/api/integrations/WEBHOOK_API/sample-inbound", async (route) => {
    sampleRequests += 1;
    expect(route.request().method()).toBe("POST");
    if (sampleRequests === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary sample failure" } },
      });
      return;
    }

    const outboundStatus = sampleRequests === 2 ? "queued" : "sent";
    await route.fulfill({
      json: {
        data: {
          ok: true,
          provider: "WEBHOOK_API",
          integrationId: "integration-webhook",
          duplicate: false,
          conversationId: `conversation-sample-${sampleRequests}`,
          leadId: `lead-sample-${sampleRequests}`,
          inboundMessageId: `message-sample-${sampleRequests}`,
          aiMessageId: `ai-sample-${sampleRequests}`,
          outboundStatus,
          reply: "Sample reply",
          integration: {
            id: "integration-webhook",
            tenantId: "tenant-clean",
            provider: "WEBHOOK_API",
            status: "CONNECTED",
            name: "Webhook/API",
          },
        },
      },
    });
  });
  await page.route("**/api/channels/channel-webhook", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    patchBodies.push(body);
    if (patchBodies.length === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary failure" } },
      });
      return;
    }
    if (patchBodies.length === 2) await successfulSaveGate;

    const settings = body.settings as
      | { webhook?: { outbound?: { targetUrl?: string | null; auth?: unknown } } }
      | undefined;
    const outbound = settings?.webhook?.outbound;
    if (outbound?.targetUrl === null) {
      targetConfigured = false;
      authenticationConfigured = false;
    } else {
      if (typeof outbound?.targetUrl === "string") targetConfigured = true;
      if (outbound?.auth === null) authenticationConfigured = false;
      else if (outbound?.auth) authenticationConfigured = true;
    }
    await route.fulfill({ json: { data: webhookChannel() } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Configure Webhook/API" }).click();

  await expect(page.getByTestId("webhook-outbound-target-status")).toHaveText("Target configured");
  await expect(page.getByTestId("webhook-outbound-auth-status")).toHaveText("Authentication saved");
  await expect(page.getByLabel("HTTPS target URL")).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Request authentication" })).toHaveText(
    "Keep saved authentication",
  );
  await expect(page.getByTestId("webhook-outbound-save")).toBeDisabled();
  await expect(page.getByTestId("webhook-sample-run")).toBeEnabled();

  await page.getByLabel("HTTPS target URL").fill("http://internal.example/replies");
  await expect(page.getByTestId("webhook-sample-run")).toBeDisabled();
  await expect(page.getByText("Save the pending changes before testing.")).toBeVisible();
  await page.getByTestId("webhook-outbound-save").click();
  await expect(page.getByText(/Use a valid public HTTPS URL/)).toBeVisible();
  expect(patchBodies).toHaveLength(0);

  await page.getByLabel("HTTPS target URL").fill("https://hooks.company.com/leadvirt/replies");
  await page.getByRole("combobox", { name: "Request authentication" }).click();
  await page.getByRole("option", { name: "Custom x-* header" }).click();
  await page.getByLabel("Header name", { exact: true }).fill("x-company-token");
  await page.getByLabel("Token or header value").fill("outbound-settings-secret");

  await page.getByTestId("webhook-outbound-save").click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await expect(page.getByLabel("HTTPS target URL")).toHaveValue(
    "https://hooks.company.com/leadvirt/replies",
  );
  await expect(page.getByLabel("Token or header value")).toHaveValue("outbound-settings-secret");

  await page.getByTestId("webhook-outbound-save").click();
  await expect.poll(() => patchBodies.length).toBe(2);
  await expect(page.getByTestId("webhook-outbound-save")).toBeDisabled();
  await expect(page.getByTestId("webhook-outbound-save")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("dialog", { name: "Webhook/API" })).toBeVisible();

  const savedBody = patchBodies[1] as {
    settings?: { webhook?: { outbound?: Record<string, unknown>; secret?: unknown } };
  };
  expect(savedBody.settings?.webhook?.outbound).toEqual({
    targetUrl: "https://hooks.company.com/leadvirt/replies",
    auth: { headerName: "x-company-token", secret: "outbound-settings-secret" },
  });
  expect(savedBody.settings?.webhook?.secret).toBeUndefined();
  releaseSuccessfulSave?.();

  await expect(page.getByLabel("HTTPS target URL")).toHaveValue("");
  await expect(page.getByLabel("Token or header value")).toHaveCount(0);
  await expect(page.getByTestId("webhook-outbound-target-status")).toHaveText("Target configured");
  await expect(page.getByTestId("webhook-sample-run")).toBeEnabled();

  await page.getByTestId("webhook-sample-run").click();
  await expect.poll(() => sampleRequests).toBe(1);
  await expect(page.getByTestId("webhook-sample-result")).toContainText("could not run");

  await page.getByTestId("webhook-sample-run").click();
  await expect.poll(() => sampleRequests).toBe(2);
  await expect(page.getByTestId("webhook-sample-result")).toHaveText(
    "Test lead received and the reply was queued. Delivery is not confirmed yet.",
  );

  await page.getByTestId("webhook-sample-run").click();
  await expect.poll(() => sampleRequests).toBe(3);
  await expect(page.getByTestId("webhook-sample-result")).toHaveText(
    "Test lead received and the reply was delivered to the saved endpoint.",
  );
  const storedState = await page.evaluate(() =>
    JSON.stringify({
      localStorage: Object.fromEntries(Object.entries(localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    }),
  );
  expect(storedState).not.toContain("outbound-settings-secret");
  await page.screenshot({
    path: "artifacts/playwright/settings-webhook-outbound-desktop.png",
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);
  await page.screenshot({
    path: "artifacts/playwright/settings-webhook-outbound-mobile.png",
    animations: "disabled",
  });

  await page.getByText("Disable outgoing webhook delivery", { exact: true }).click();
  await page.getByTestId("webhook-outbound-save").click();
  await expect.poll(() => patchBodies.length).toBe(3);
  const removalBody = patchBodies[2] as {
    settings?: { webhook?: { outbound?: Record<string, unknown>; secret?: unknown } };
  };
  expect(removalBody.settings?.webhook?.outbound).toEqual({ targetUrl: null, auth: null });
  expect(removalBody.settings?.webhook?.secret).toBeUndefined();
  await expect(page.getByTestId("webhook-secret-status")).toHaveText("Secret configured");
  await expect(page.getByTestId("webhook-outbound-target-status")).toHaveText("Target required");
  await expect(page.getByTestId("webhook-sample-run")).toBeDisabled();
  expect(sampleRequests).toBe(3);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  currentRole = "MANAGER";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Configure Webhook/API" }).click();
  await expect(page.getByTestId("webhook-outbound-readonly")).toBeVisible();
  await expect(page.getByLabel("HTTPS target URL")).toHaveCount(0);
  await expect(page.getByTestId("webhook-outbound-save")).toHaveCount(0);
});

test("channel automatic replies require readiness and explicit activation", async ({ page }) => {
  let activated = false;
  const channel = websiteChannel();

  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({
      json: {
        data: {
          tenant: {
            id: "tenant-demo",
            name: "Demo Company",
            slug: "demo-company",
            status: "ACTIVE",
            timezone: "Europe/Paris",
          },
          owner: { id: "user-demo", email: "admin@leadvirt.ai", name: "Demo Owner" },
          businessName: "Demo Company",
          timezone: "Europe/Paris",
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
  await page.route("**/api/channels/channel-website/automatic-replies/**", async (route) => {
    if (route.request().url().endsWith("/activate")) activated = true;
    await route.fulfill({
      json: {
        data: {
          channelId: channel.id,
          status: activated ? "ACTIVE" : "READY",
          enabled: activated,
          canActivate: true,
          generation: activated ? 2 : 1,
          activePublicationId: "publication-v2",
          activePublicationEtag: 4,
          activatedAt: activated ? "2026-07-14T12:00:00.000Z" : null,
          blockers: [],
        },
      },
    });
  });
  await page.route("**/api/channels", async (route) => {
    await route.fulfill({ json: { data: [channel] } });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });
  await page.locator("main nav").getByRole("button").nth(2).click();

  await expect(page.getByText("Ready to activate")).toBeVisible();
  await page.getByRole("switch", { name: "Automatic replies" }).click();
  await expect.poll(() => activated).toBe(true);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Automatic replies" })).toBeChecked();
  await page.screenshot({
    path: "artifacts/screenshots/channel-automatic-replies-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("switch", { name: "Automatic replies" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/channel-automatic-replies-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
