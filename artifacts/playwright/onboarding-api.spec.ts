import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

function businessProfileRevision(version = 1) {
  return {
    businessProfileVersion: version,
    businessProfileEtag: `"business-profile-onboarding-${version}"`,
    businessProfileUpdatedAt: "2026-07-16T12:00:00.000Z",
  };
}

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "onboarding-owner",
          tenantId: "onboarding-tenant",
          email: "owner@onboarding.test",
          name: "Onboarding Owner",
          role: "OWNER",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
});

test("unauthenticated onboarding returns to login with the selected plan preserved", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.unroute("**/api/auth/me");
  let onboardingRequests = 0;
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    });
  });
  await page.route("**/api/onboarding/state", async (route) => {
    onboardingRequests += 1;
    await route.fulfill({ status: 401, json: { message: "Unexpected onboarding request" } });
  });

  await page.goto(`${webBase}/onboarding?plan=pro`, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(`${webBase}/login?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro`, {
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/signup?plan=pro&returnTo=%2Fonboarding%3Fplan%3Dpro",
  );
  expect(onboardingRequests).toBe(0);
});

test("mobile onboarding announces progress, intent availability, and saving state", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let releaseFirstPatch: (() => void) | null = null;
  let patchCount = 0;

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          data: {
            ...businessProfileRevision(),
            currentStep: "channels",
            completedSteps: ["business"],
            data: { businessType: "services", selectedChannels: [] },
            completedAt: null,
          },
        },
      });
      return;
    }

    patchCount += 1;
    if (patchCount === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstPatch = resolve;
      });
    }
    const body = route.request().postDataJSON() as { currentStep?: string };
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(),
          currentStep: body.currentStep ?? "channels",
          completedSteps: ["business", "channels"],
          data: { businessType: "services", selectedChannels: ["whatsapp"] },
          completedAt: null,
        },
      },
    });
  });
  await page.route("**/api/onboarding/complete-step", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(),
          currentStep: "channels",
          completedSteps: ["business", "channels"],
          data: {},
          completedAt: null,
        },
      },
    });
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "domcontentloaded" });

  const progress = page.getByRole("progressbar", { name: "Step 2 of 6" });
  await expect(progress).toHaveAttribute("aria-valuenow", "2");
  await expect(page.getByTestId("language-switcher")).toBeVisible();
  const skip = page.getByRole("button", { name: "Skip" });
  const skipBox = await skip.boundingBox();
  expect(skipBox).not.toBeNull();
  expect(skipBox!.x).toBeGreaterThanOrEqual(0);
  expect(skipBox!.x + skipBox!.width).toBeLessThanOrEqual(320);
  expect(skipBox?.width).toBeGreaterThanOrEqual(44);
  expect(skipBox?.height).toBeGreaterThanOrEqual(44);

  await expect(page.getByText(/saved only as preferences; no request is sent automatically/i)).toBeVisible();
  const requestedChannel = page.getByRole("button", { name: /WhatsApp.*Managed setup/i });
  await expect(requestedChannel).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /Telegram.*Available/i })).toBeVisible();
  await requestedChannel.click();
  await expect(requestedChannel).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saving...");
  releaseFirstPatch?.();
  await expect(page.getByRole("heading", { name: "Choose a setup goal" })).toBeVisible();
  await expect(page.getByText(/does not activate an automation/i)).toBeVisible();
  await expect(page.getByText(/books customers automatically/i)).toHaveCount(0);
});

test("company onboarding fields expose associated required labels", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(),
          currentStep: "company",
          completedSteps: ["business", "channels", "scenario"],
          data: {
            businessType: "services",
            selectedChannels: ["telegram"],
            scenario: "support",
          },
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "domcontentloaded" });

  await expect(page.getByLabel(/Company name/)).toHaveAttribute("required", "");
  await expect(page.getByLabel(/About the company/)).toHaveAttribute("required", "");
  await expect(page.getByLabel("Catalog, services, and prices")).toBeVisible();
  await expect(page.getByLabel("Business hours")).toBeVisible();
});

test("onboarding hydrates state and persists progress", async ({ page }) => {
  const statePatches: { currentStep?: string; data?: Record<string, unknown> }[] = [];
  const statePatchIfMatches: Array<string | undefined> = [];
  const completedSteps: string[] = [];
  let stateLoaded = false;
  let profileVersion = 1;

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
      stateLoaded = true;
      await route.fulfill({
        json: {
          data: {
            ...businessProfileRevision(profileVersion),
            currentStep: "business",
            completedSteps: [],
            data: {},
            completedAt: null,
          },
        },
      });
      return;
    }

    const body = route.request().postDataJSON() as {
      currentStep?: string;
      data?: Record<string, unknown>;
    };
    statePatches.push(body);
    statePatchIfMatches.push(route.request().headers()["if-match"]);
    if (body.data?.businessType || body.data?.companyInfo) profileVersion += 1;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: body.currentStep ?? "business",
          completedSteps,
          data: body.data ?? {},
          completedAt: null,
        },
      },
    });
  });

  await page.route("**/api/onboarding/complete-step", async (route) => {
    const body = route.request().postDataJSON() as { step?: string };
    if (body.step) completedSteps.push(body.step);
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: body.step ?? "business",
          completedSteps,
          data: {},
          completedAt: null,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await expect.poll(() => stateLoaded).toBe(true);
  await expect(page.getByRole("button", { name: /^Далее$/ })).toBeDisabled();

  await page.getByRole("button", { name: /Бьюти-студия/ }).click();
  await expect(page.getByRole("button", { name: /^Далее$/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Далее$/ }).click();

  await expect(page.getByText("Откуда приходят клиенты?")).toBeVisible();
  await expect.poll(() => completedSteps).toContain("business");
  await expect.poll(() => statePatches.length).toBe(2);
  expect(statePatches[0]).toEqual({
    currentStep: "business",
    data: { businessType: "beauty" },
  });
  expect(statePatches[1]).toEqual({ currentStep: "channels" });
  expect(statePatchIfMatches[0]).toBe('"business-profile-onboarding-1"');
  expect(statePatchIfMatches[1]).toBeUndefined();
});

test("onboarding does not expose a blank form when saved state cannot load", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let recover = false;
  let getRequests = 0;

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 500, json: { message: "Unexpected write" } });
      return;
    }
    getRequests += 1;
    if (!recover) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(2),
          currentStep: "scenario",
          completedSteps: ["business", "channels"],
          data: {
            businessType: "clinic",
            selectedChannels: ["telegram"],
          },
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`);

  const error = page.getByTestId("onboarding-state-load-error");
  await expect(error).toBeVisible();
  await expect(page.getByTestId("onboarding-step-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);

  recover = true;
  await error.getByRole("button").click();
  await expect(error).toBeHidden();
  await expect(page.getByRole("heading", { name: "Choose a setup goal" })).toBeVisible();
  expect(getRequests).toBeGreaterThanOrEqual(2);
});

test("onboarding blocks navigation and allows retry when persistence fails", async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);

  let patchAttempts = 0;
  const completedSteps: string[] = [];
  const patchIfMatches: Array<string | undefined> = [];

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          data: {
            ...businessProfileRevision(),
            currentStep: "business",
            completedSteps: [],
            data: {},
            completedAt: null,
          },
        },
      });
      return;
    }

    patchAttempts += 1;
    patchIfMatches.push(route.request().headers()["if-match"]);
    if (patchAttempts === 1) {
      await route.fulfill({ status: 503, json: { message: "Persistence unavailable" } });
      return;
    }

    const body = route.request().postDataJSON() as {
      currentStep?: string;
      data?: Record<string, unknown>;
    };
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(2),
          currentStep: body.currentStep ?? "business",
          completedSteps,
          data: body.data ?? {},
          completedAt: null,
        },
      },
    });
  });

  await page.route("**/api/onboarding/complete-step", async (route) => {
    const body = route.request().postDataJSON() as { step?: string };
    if (body.step) completedSteps.push(body.step);
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(2),
          currentStep: body.step ?? "business",
          completedSteps,
          data: {},
          completedAt: null,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Beauty studio" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByTestId("onboarding-persistence-error")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What kind of business is this?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  expect(completedSteps).toEqual([]);

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByTestId("onboarding-persistence-error")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Where do customers contact you?" }),
  ).toBeVisible();
  await expect.poll(() => completedSteps).toContain("business");
  expect(patchIfMatches[0]).toBe('"business-profile-onboarding-1"');
  expect(patchIfMatches[1]).toBe('"business-profile-onboarding-1"');
  expect(patchIfMatches[2]).toBeUndefined();
});

test("onboarding does not present a fresh setup when saved state cannot be loaded", async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);

  let recover = false;
  let requests = 0;
  await page.route("**/api/onboarding/state", async (route) => {
    requests += 1;
    if (!recover) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary outage" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(4),
          currentStep: "company",
          completedSteps: ["business", "channels", "scenario"],
          data: {
            businessType: "beauty",
            selectedChannels: ["telegram"],
            scenario: "support",
            companyInfo: {
              name: "Recovered workspace",
              description: "Recovered description",
            },
          },
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`);

  const error = page.getByTestId("onboarding-state-load-error");
  await expect(error).toBeVisible();
  await expect(page.getByRole("heading", { name: "What kind of business is this?" })).toHaveCount(
    0,
  );

  recover = true;
  await error.getByRole("button").click();

  await expect(error).toBeHidden();
  await expect(page.getByRole("heading", { name: "Company information" })).toBeVisible();
  await expect(page.getByPlaceholder("For example: Aura Beauty Studio")).toHaveValue(
    "Recovered workspace",
  );
  expect(requests).toBeGreaterThanOrEqual(2);
});

test("onboarding company step sends a scoped profile write with the loaded ETag", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  const initialData = {
    businessType: "beauty",
    selectedChannels: ["telegram"],
    scenario: "support",
    companyInfo: {
      name: "Existing workspace",
      description: "Existing description",
      hours: "",
      avgCheck: "",
      servicesCatalog: "",
      availability: "",
      faq: "",
      policies: "",
      escalationRules: "",
    },
  };
  const statePatches: Array<{
    currentStep?: string;
    data?: Record<string, unknown>;
  }> = [];
  const statePatchIfMatches: Array<string | undefined> = [];
  let profileVersion = 7;
  let savedData: Record<string, unknown> = initialData;

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          data: {
            ...businessProfileRevision(profileVersion),
            currentStep: "company",
            completedSteps: ["business", "channels", "scenario"],
            data: savedData,
            completedAt: null,
          },
        },
      });
      return;
    }

    const body = route.request().postDataJSON() as {
      currentStep?: string;
      data?: Record<string, unknown>;
    };
    statePatches.push(body);
    statePatchIfMatches.push(route.request().headers()["if-match"]);
    if (body.data?.companyInfo) {
      profileVersion += 1;
      savedData = { ...savedData, companyInfo: body.data.companyInfo };
    }
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: body.currentStep ?? "company",
          completedSteps: ["business", "channels", "scenario", "company"],
          data: savedData,
          completedAt: null,
        },
      },
    });
  });

  await page.route("**/api/onboarding/complete-step", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: "company",
          completedSteps: ["business", "channels", "scenario", "company"],
          data: savedData,
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("For example: Aura Beauty Studio").fill("Scoped profile update");
  await page
    .getByPlaceholder("What your company does and what makes it different...")
    .fill("Only the company step should be persisted.");
  await page.getByPlaceholder(/For example: women's haircut/).fill("Consultation - 60 min");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Where should leads go?" })).toBeVisible();
  await expect.poll(() => statePatches.length).toBe(2);
  expect(statePatchIfMatches[0]).toBe('"business-profile-onboarding-7"');
  expect(statePatchIfMatches[1]).toBeUndefined();
  expect(statePatches[0]?.currentStep).toBe("company");
  expect(Object.keys(statePatches[0]?.data ?? {})).toEqual(["companyInfo"]);
  expect(statePatches[0]?.data).not.toHaveProperty("businessType");
  expect(statePatches[0]?.data).not.toHaveProperty("selectedChannels");
  expect(statePatches[0]?.data).not.toHaveProperty("scenario");
  expect(statePatches[0]?.data).not.toHaveProperty("crm");
  expect(statePatches[1]).toEqual({ currentStep: "crm" });
});

test("onboarding ignores profile ETags from workflow, completion, and navigation responses", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  const initialData = {
    businessType: "beauty",
    selectedChannels: ["telegram"],
  };
  const profileIfMatches: string[] = [];
  let profileVersion = 1;
  let workflowResponseVersion = 40;

  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          data: {
            ...businessProfileRevision(profileVersion),
            currentStep: "scenario",
            completedSteps: ["business", "channels"],
            data: initialData,
            completedAt: null,
          },
        },
      });
      return;
    }

    const body = route.request().postDataJSON() as {
      currentStep?: string;
      data?: Record<string, unknown>;
    };
    const profileWrite = Boolean(body.data?.companyInfo);
    if (profileWrite) {
      profileIfMatches.push(route.request().headers()["if-match"] ?? "");
      profileVersion += 1;
    } else {
      workflowResponseVersion += 1;
    }
    const responseVersion = profileWrite ? profileVersion : workflowResponseVersion;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(responseVersion),
          currentStep: body.currentStep ?? "scenario",
          completedSteps: ["business", "channels", "scenario", "company"],
          data: { ...initialData, ...(body.data ?? {}) },
          completedAt: null,
        },
      },
    });
  });

  await page.route("**/api/onboarding/complete-step", async (route) => {
    workflowResponseVersion += 1;
    const body = route.request().postDataJSON() as { step?: string };
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(workflowResponseVersion),
          currentStep: body.step ?? "scenario",
          completedSteps: ["business", "channels", "scenario", "company"],
          data: initialData,
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Customer support/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Company information" })).toBeVisible();
  const companyName = page.getByPlaceholder("For example: Aura Beauty Studio");
  await companyName.fill("First fenced profile save");
  await page
    .getByPlaceholder("What your company does and what makes it different...")
    .fill("The workflow responses must not replace the loaded profile token.");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Where should leads go?" })).toBeVisible();
  expect(profileIfMatches).toEqual(['"business-profile-onboarding-1"']);

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Company information" })).toBeVisible();
  await companyName.fill("Second fenced profile save");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect.poll(() => profileIfMatches.length).toBe(2);
  expect(profileIfMatches).toEqual([
    '"business-profile-onboarding-1"',
    '"business-profile-onboarding-2"',
  ]);
});

async function mockLaunchReadyOnboarding(page: Page) {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  const data = {
    businessType: "beauty",
    selectedChannels: ["telegram"],
    scenario: "support",
    companyInfo: { name: "Launch fixture", description: "Launch fixture description" },
    crm: "none",
  };
  let stateUpdates = 0;
  let launchCompletions = 0;

  await page.route("**/api/onboarding/state", async (route) => {
    const isPatch = route.request().method() === "PATCH";
    const body = isPatch ? route.request().postDataJSON() : null;
    if (isPatch) stateUpdates += 1;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(5),
          currentStep: body?.currentStep ?? "launch",
          completedSteps: ["business", "channels", "scenario", "company", "crm"],
          data: body?.data ?? data,
          completedAt: null,
        },
      },
    });
  });
  await page.route("**/api/onboarding/complete-step", async (route) => {
    launchCompletions += 1;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(5),
          currentStep: "launch",
          completedSteps: ["business", "channels", "scenario", "company", "crm", "launch"],
          data,
          completedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.route("**/api/knowledge/v2/overview", async (route) => {
    await route.fulfill({ status: 503, json: { message: "Fixture overview unavailable" } });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "owner",
          email: "owner@example.test",
          role: "OWNER",
          tenantId: "tenant",
          authMode: "email",
        },
      },
    });
  });
  await page.route("**/api/billing/**", async (route) => {
    await route.fulfill({ status: 503, json: { message: "Fixture billing unavailable" } });
  });

  return {
    stateUpdates: () => stateUpdates,
    launchCompletions: () => launchCompletions,
  };
}

async function launchReadyOnboarding(page: Page, path: string, actionLabel: string) {
  const requests = await mockLaunchReadyOnboarding(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}${path}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Initial setup saved" })).toBeVisible();
  await expect(
    page.getByText(/complete readiness before enabling automatic replies/i),
  ).toBeVisible();
  await expect(page.getByText("Everything is ready!")).toHaveCount(0);
  await page.getByRole("button", { name: actionLabel }).click();

  await expect.poll(requests.stateUpdates).toBe(1);
  await expect.poll(requests.launchCompletions).toBe(1);
  await expect(page.getByTestId("onboarding-persistence-error")).toBeHidden();
}

test("successful onboarding launch opens Knowledge review", async ({ page }) => {
  await launchReadyOnboarding(page, "/onboarding", "Review business information");

  await expect(page).toHaveURL(`${webBase}/app/knowledge?welcome=1`, { timeout: 15_000 });
  await expect(page.getByText("Your setup answers are saved.")).toBeVisible();
});

test("successful onboarding launch hands a selected plan to billing", async ({ page }) => {
  await launchReadyOnboarding(page, "/onboarding?plan=pro", "Review selected plan");

  await expect(page).toHaveURL(`${webBase}/app/billing?plan=pro`, { timeout: 15_000 });
});

test("successful onboarding launch ignores a malformed plan", async ({ page }) => {
  await launchReadyOnboarding(
    page,
    "/onboarding?plan=pro%2F..%2Fcorporate",
    "Review business information",
  );

  await expect(page).toHaveURL(`${webBase}/app/knowledge?welcome=1`, { timeout: 15_000 });
  await expect(page.getByText("Your setup answers are saved.")).toBeVisible();
});
