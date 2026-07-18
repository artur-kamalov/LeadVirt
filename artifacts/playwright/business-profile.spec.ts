import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  BusinessProfileData,
  BusinessProfilePatchRequest,
  BusinessProfileView,
} from "@leadvirt/types";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

interface CapturedPatch {
  body: BusinessProfilePatchRequest;
  headers: Record<string, string>;
}

interface ProfileMockState {
  view: BusinessProfileView;
  gets: number;
  patches: CapturedPatch[];
}

type FailureMode = "none" | "conflict" | "transient";

const schedule: BusinessProfileData["weeklySchedule"] = [
  { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "TUE", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "WED", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "THU", enabled: true, opensAt: "09:00", closesAt: "18:00" },
  { day: "FRI", enabled: true, opensAt: "09:00", closesAt: "17:00" },
  { day: "SAT", enabled: false, opensAt: "10:00", closesAt: "16:00" },
  { day: "SUN", enabled: false, opensAt: "10:00", closesAt: "16:00" },
];

function completedProfile(): BusinessProfileData {
  return {
    businessType: "beauty",
    name: "Northstar Wellness Studio",
    description:
      "A completed customer-facing profile for appointments, consultations, and aftercare.",
    avgCheck: "EUR 95",
    servicesCatalog: "Packages are customized after the initial consultation.",
    services: [
      {
        id: "consultation",
        name: "Initial consultation",
        description: "A structured needs assessment and treatment plan.",
        price: "EUR 45",
        duration: "45 minutes",
      },
      {
        id: "signature-session",
        name: "Signature session",
        description: "The studio's most popular appointment.",
        price: "EUR 120",
        duration: "90 minutes",
      },
    ],
    hours: "Public holidays may use reduced hours.",
    weeklySchedule: schedule.map((entry) => ({ ...entry })),
    availability: "Same-week appointments are normally available Tuesday through Thursday.",
    faq: "Clients should arrive ten minutes before their first appointment.",
    policies: "Changes are free up to 24 hours before an appointment.",
    escalationRules: "Escalate medical, payment dispute, and safety questions to the owner.",
    timezone: "Europe/Paris",
  };
}

function profileView(profile = completedProfile()): BusinessProfileView {
  return {
    profile,
    version: 1,
    etag: '"business-profile-1"',
    updatedAt: "2026-07-16T12:00:00.000Z",
  };
}

function overview(canEdit: boolean) {
  return {
    readiness: {
      serving: { status: "READY" },
      draft: { status: "CHANGES_PENDING" },
    },
    permissions: {
      canViewRestricted: canEdit,
      canEdit,
      canManageSettings: canEdit,
      canVerifyHighRisk: canEdit,
      canPublish: canEdit,
      canRollback: canEdit,
    },
  };
}

function knowledgeSettings() {
  return {
    version: 1,
    etag: '"kv2-settings-1"',
    defaultLocale: "en",
    supportedLocales: ["en"],
    defaultScope: null,
    defaultScopeGeneration: 0,
    defaultScopeHash: null,
    autoPublishPolicy: "OFF",
    publicationApprovalPolicy: "OWNER_OR_ADMIN",
    publicationSchedule: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    updatedBy: { id: "owner-user", displayName: "Profile owner" },
  };
}

async function json(
  route: Route,
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

async function installMocks(
  page: Page,
  options: {
    canEdit?: boolean;
    failure?: FailureMode;
    profile?: BusinessProfileData;
  } = {},
) {
  const canEdit = options.canEdit ?? true;
  const failure = options.failure ?? "none";
  const state: ProfileMockState = {
    view: profileView(options.profile),
    gets: 0,
    patches: [],
  };

  await page.route("**/api/business-profile", async (route) => {
    const request = route.request();
    const method = request.method();

    if (method === "GET") {
      state.gets += 1;
      await json(route, { data: state.view }, 200, { etag: state.view.etag });
      return;
    }

    if (method === "PATCH") {
      const body = request.postDataJSON() as BusinessProfilePatchRequest;
      state.patches.push({ body, headers: request.headers() });

      if (failure === "conflict" && state.patches.length === 1) {
        state.view = {
          ...state.view,
          profile: {
            ...state.view.profile,
            name: "Northstar Wellness Studio - server revision",
            description: "The authoritative profile was updated by another administrator.",
          },
          version: 2,
          etag: '"business-profile-2"',
          updatedAt: "2026-07-16T12:05:00.000Z",
        };
        await json(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This business profile changed after it was loaded.",
              requestId: "request-profile-conflict",
              retryable: false,
              details: {
                currentEtag: state.view.etag,
                currentVersion: state.view.version,
                safeDiff: { changedFields: ["name", "description"] },
              },
            },
          },
          412,
        );
        return;
      }

      if (failure === "transient" && state.patches.length === 1) {
        await json(
          route,
          {
            error: {
              code: "KNOWLEDGE_DEPENDENCY_TEMPORARILY_UNAVAILABLE",
              message: "Business information is temporarily unavailable.",
              requestId: "request-profile-transient",
              retryable: true,
            },
          },
          503,
        );
        return;
      }

      const version = state.view.version + 1;
      state.view = {
        profile: { ...state.view.profile, ...body.profile },
        version,
        etag: `"business-profile-${version}"`,
        updatedAt: `2026-07-16T12:${String(version).padStart(2, "0")}:00.000Z`,
      };
      await json(route, { data: state.view }, 200, { etag: state.view.etag });
      return;
    }

    await json(route, { error: { code: "HTTP_ERROR", message: "Method not supported." } }, 405);
  });

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await json(route, { data: overview(canEdit) });
      return;
    }
    if (pathname === "/api/knowledge/v2/settings" && method === "GET") {
      const settings = knowledgeSettings();
      await json(route, { data: settings }, 200, { etag: settings.etag });
      return;
    }
    if (pathname === "/api/knowledge/v2/facts" && method === "GET") {
      await json(route, {
        data: { items: [], pageInfo: { limit: 50, nextCursor: null, hasNextPage: false } },
      });
      return;
    }

    await json(
      route,
      {
        error: {
          code: "HTTP_ERROR",
          message: `Unhandled business profile mock: ${method} ${pathname}`,
          retryable: false,
        },
      },
      501,
    );
  });

  return state;
}

async function authenticate(page: Page) {
  await loginAsCleanUser(page, apiBase);
  const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale: "en" },
  });
  expect(localeResponse.ok()).toBeTruthy();
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
}

async function openBusinessProfile(page: Page) {
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("business-profile-editor")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("business-profile-loading")).toHaveCount(0);
}

test("completed business profile hydrates, saves structured changes, and survives reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBusinessProfile(page);

  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Studio");
  await expect(page.getByTestId("business-profile-description")).toHaveValue(
    /completed customer-facing profile/,
  );
  await expect(page.locator("#business-profile-business-type").getByRole("combobox")).toContainText(
    /Beauty/i,
  );
  await expect(page.getByTestId("business-profile-timezone").getByRole("combobox")).toContainText(
    "Europe/Paris",
  );
  await expect(page.getByTestId("business-profile-service-0-name")).toHaveValue(
    "Initial consultation",
  );
  await expect(page.getByTestId("business-profile-service-1-price")).toHaveValue("EUR 120");
  await expect(page.getByTestId("business-profile-day-MON-enabled")).toBeChecked();
  await expect(page.getByTestId("business-profile-day-MON-opens")).toHaveValue("09:00");
  await expect(page.getByTestId("business-profile-day-SAT-enabled")).not.toBeChecked();

  await page.getByTestId("business-profile-name").fill("Northstar Wellness Paris");
  await page
    .getByTestId("business-profile-description")
    .fill("Appointments, consultations, treatments, and detailed aftercare in central Paris.");
  await page.getByTestId("business-profile-service-0-price").fill("EUR 55");
  await page.getByTestId("business-profile-add-service").click();
  await page.getByTestId("business-profile-service-2-name").fill("Express follow-up");
  await page.getByTestId("business-profile-service-2-price").fill("EUR 30");
  await page.getByTestId("business-profile-service-2-duration").fill("20 minutes");
  await page
    .getByTestId("business-profile-service-2-description")
    .fill("A short progress review after a completed treatment.");
  await page.getByTestId("business-profile-day-SAT-enabled").check();
  await page.getByTestId("business-profile-day-SAT-opens").fill("10:30");
  await page.getByTestId("business-profile-day-SAT-closes").fill("15:30");
  await page
    .getByTestId("business-profile-faq")
    .fill("Arrive ten minutes early. Saturday appointments require confirmation.");
  await page.getByTestId("business-profile-save").click();

  await expect.poll(() => state.patches.length).toBe(1);
  const request = state.patches[0];
  expect(request.headers["idempotency-key"]).toMatch(/^business-profile-/);
  expect(request.headers["if-match"]).toBe('"business-profile-1"');
  expect(request.body.profile).toMatchObject({
    name: "Northstar Wellness Paris",
    description:
      "Appointments, consultations, treatments, and detailed aftercare in central Paris.",
    faq: "Arrive ten minutes early. Saturday appointments require confirmation.",
  });
  expect(request.body.profile.services).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Initial consultation", price: "EUR 55" }),
      expect.objectContaining({
        name: "Express follow-up",
        price: "EUR 30",
        duration: "20 minutes",
      }),
    ]),
  );
  expect(request.body.profile.weeklySchedule).toEqual(
    expect.arrayContaining([{ day: "SAT", enabled: true, opensAt: "10:30", closesAt: "15:30" }]),
  );
  expect(request.body.profile.weeklySchedule).toHaveLength(7);
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  await expect(page.getByText(/The profile is saved\./)).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/business-profile-saved-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Paris");
  await expect(page.getByTestId("business-profile-service-2-name")).toHaveValue(
    "Express follow-up",
  );
  await expect(page.getByTestId("business-profile-day-SAT-enabled")).toBeChecked();
  await expect.poll(() => state.gets).toBeGreaterThanOrEqual(2);
  expect(state.patches).toHaveLength(1);
});

test("an absent weekly schedule is omitted when another profile field is saved", async ({
  page,
}) => {
  await authenticate(page);
  const profile = completedProfile();
  profile.weeklySchedule = [];
  const state = await installMocks(page, { profile });
  await openBusinessProfile(page);

  await expect(page.getByTestId("business-profile-day-MON-enabled")).not.toBeChecked();
  await page.getByTestId("business-profile-name").fill("Northstar Wellness Renamed");
  await page.getByTestId("business-profile-save").click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].body.profile).not.toHaveProperty("weeklySchedule");
});

test("legacy notes cannot look complete while structured services and schedule are missing", async ({
  page,
}) => {
  await authenticate(page);
  const profile = completedProfile();
  profile.services = [];
  profile.weeklySchedule = [];
  profile.servicesCatalog = "Consultations from EUR 45 and signature sessions from EUR 120.";
  profile.hours = "Open every day from 10:00 to 21:00.";
  await installMocks(page, { profile });
  await openBusinessProfile(page);

  await expect(page.getByText("Needs details", { exact: true })).toBeVisible();
  await expect(page.getByTestId("business-profile-attention")).toBeVisible();
  await expect(page.getByTestId("business-profile-services-conflict")).toBeVisible();
  await expect(page.getByTestId("business-profile-schedule-warning")).toContainText(
    "no working days are enabled",
  );

  await page
    .getByTestId("business-profile-attention")
    .getByRole("button", { name: "Add service" })
    .click();
  const serviceName = page.getByTestId("business-profile-service-0-name");
  await expect(serviceName).toBeFocused();
  await serviceName.fill("Initial consultation");
  await expect(page.getByTestId("business-profile-services-conflict")).toHaveCount(0);

  await page.getByTestId("business-profile-day-MON-enabled").check();
  await expect(page.getByTestId("business-profile-day-MON-opens")).toHaveAttribute(
    "inputmode",
    "numeric",
  );
  await expect(page.getByTestId("business-profile-schedule-warning")).toHaveCount(0);
  await expect(page.getByTestId("business-profile-attention")).toHaveCount(0);
});

test("invalid 24-hour schedule values are rejected inline before save", async ({ page }) => {
  await authenticate(page);
  const state = await installMocks(page);
  await openBusinessProfile(page);

  const opensAt = page.getByTestId("business-profile-day-MON-opens");
  await opensAt.fill("99:99");
  await page.getByTestId("business-profile-save").click();

  await expect(opensAt).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Use 24-hour HH:MM for opening and closing, for example 09:00.").first(),
  ).toBeVisible();
  expect(state.patches).toHaveLength(0);
});

test("a partial weekly schedule is omitted when another profile field is saved", async ({
  page,
}) => {
  await authenticate(page);
  const profile = completedProfile();
  profile.weeklySchedule = [{ day: "MON", enabled: true, opensAt: "10:00", closesAt: "16:00" }];
  const state = await installMocks(page, { profile });
  await openBusinessProfile(page);

  await expect(page.getByTestId("business-profile-day-MON-enabled")).toBeChecked();
  await expect(page.getByTestId("business-profile-day-TUE-enabled")).not.toBeChecked();
  await page.getByTestId("business-profile-name").fill("Northstar Partial Schedule");
  await page.getByTestId("business-profile-save").click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].body.profile).not.toHaveProperty("weeklySchedule");
});

test("a whitespace-only edit is normalized without sending an empty patch", async ({ page }) => {
  await authenticate(page);
  const state = await installMocks(page);
  await openBusinessProfile(page);

  await page.getByTestId("business-profile-name").fill("  Northstar Wellness Studio  ");
  await page.getByTestId("business-profile-save").click();

  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Studio");
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  expect(state.patches).toHaveLength(0);
});

test("stale ETag conflict preserves the draft until explicit authoritative reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installMocks(page, { failure: "conflict" });
  await openBusinessProfile(page);

  await page.getByTestId("business-profile-name").fill("Local unsaved studio name");
  await page.getByTestId("business-profile-save").click();
  await expect(page.getByTestId("business-profile-conflict")).toBeVisible();
  await expect(page.getByTestId("business-profile-name")).toHaveValue("Local unsaved studio name");
  expect(state.patches[0].headers["if-match"]).toBe('"business-profile-1"');

  await page.getByTestId("business-profile-reload").click();
  await expect(page.getByTestId("business-profile-conflict")).toHaveCount(0);
  await expect(page.getByTestId("business-profile-name")).toHaveValue(
    "Northstar Wellness Studio - server revision",
  );
  await expect(page.getByTestId("business-profile-description")).toHaveValue(
    "The authoritative profile was updated by another administrator.",
  );

  await page.getByTestId("business-profile-name").fill("Reviewed merged studio name");
  await page.getByTestId("business-profile-save").click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1].headers["if-match"]).toBe('"business-profile-2"');
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  await expect(page.getByTestId("business-profile-name")).toHaveValue(
    "Reviewed merged studio name",
  );
});

test("retryable save failure keeps the form editable and reuses the idempotency key", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installMocks(page, { failure: "transient" });
  await openBusinessProfile(page);

  await page
    .getByTestId("business-profile-description")
    .fill("A locally edited description that must survive a failed save.");
  await page.getByTestId("business-profile-save").click();
  await expect(page.getByTestId("business-profile-retry-save")).toBeVisible();
  await expect(page.getByTestId("business-profile-description")).toBeEditable();
  await expect(page.getByTestId("business-profile-description")).toHaveValue(
    "A locally edited description that must survive a failed save.",
  );
  await expect(page.getByText("Business information is temporarily unavailable.")).toBeVisible();

  await page.getByTestId("business-profile-retry-save").click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1].headers["idempotency-key"]).toBe(
    state.patches[0].headers["idempotency-key"],
  );
  expect(state.patches[1].body).toEqual(state.patches[0].body);
  await expect(page.getByTestId("business-profile-save")).toBeDisabled();
  await expect(page.getByText(/The profile is saved\./)).toBeVisible();
});

test("read-only profile stays visible and the populated mobile layout does not overflow", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const profile = completedProfile();
  profile.description = `${profile.description} ${"Long localized business detail ".repeat(14)}`;
  profile.services[0].description = "Detailed service explanation ".repeat(18);
  const state = await installMocks(page, { canEdit: false, profile });
  await page.setViewportSize({ width: 390, height: 844 });
  await openBusinessProfile(page);

  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(page.getByTestId("business-profile-name")).toHaveValue("Northstar Wellness Studio");
  await expect(page.getByTestId("business-profile-name")).not.toBeEditable();
  await expect(page.getByTestId("business-profile-service-0-name")).not.toBeEditable();
  await expect(page.getByTestId("business-profile-day-MON-enabled")).toBeDisabled();
  await expect(page.getByTestId("business-profile-add-service")).toBeDisabled();
  await expect(page.getByTestId("business-profile-save")).toHaveCount(0);
  await expect(page.getByTestId("knowledge-business-advanced")).toBeVisible();

  await page.getByTestId("business-profile-schedule").scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("[data-testid='business-profile-editor']");
    const rect = editor?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      editorLeft: rect?.left ?? -1,
      editorRight: rect?.right ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(geometry.viewportWidth).toBe(390);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.editorLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.editorRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(state.patches).toHaveLength(0);
  await page.screenshot({
    path: "artifacts/screenshots/business-profile-read-only-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("mobile profile keeps schedule times together and discloses additional details on demand", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  await installMocks(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await openBusinessProfile(page);

  const additionalDetails = page.getByTestId("business-profile-additional-details");
  const additionalDetailsSummary = page.getByTestId("business-profile-additional-details-summary");
  await expect(additionalDetails).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("business-profile-faq")).not.toBeVisible();

  const summaryBox = await additionalDetailsSummary.boundingBox();
  expect(summaryBox?.height).toBeGreaterThanOrEqual(44);
  await additionalDetailsSummary.click();
  await expect(additionalDetails).toHaveAttribute("open", "");
  await expect(page.getByTestId("business-profile-faq")).toBeVisible();

  const dayLabel = page.getByTestId("business-profile-day-MON-label");
  const opensAt = page.getByTestId("business-profile-day-MON-opens");
  const closesAt = page.getByTestId("business-profile-day-MON-closes");
  await dayLabel.scrollIntoViewIfNeeded();
  const [labelBox, opensBox, closesBox] = await Promise.all([
    dayLabel.boundingBox(),
    opensAt.boundingBox(),
    closesAt.boundingBox(),
  ]);
  expect(labelBox).not.toBeNull();
  expect(opensBox).not.toBeNull();
  expect(closesBox).not.toBeNull();
  expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(opensBox!.y + 1);
  expect(Math.abs(opensBox!.y - closesBox!.y)).toBeLessThanOrEqual(1);
  expect(opensBox!.x).toBeLessThan(closesBox!.x);
  expect(closesBox!.x + closesBox!.width).toBeLessThanOrEqual(320);
});

test("demo business profile uses a concise mobile product title", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/demo/knowledge?view=business`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("business-profile-editor")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("header h1").first()).toHaveText("Knowledge");
  await expect(page.locator("header h1").first()).not.toHaveText("Business knowledge");
});
