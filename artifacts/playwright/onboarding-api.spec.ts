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
  let releaseAdvance: (() => void) | null = null;

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

    await route.fulfill({ status: 500, json: { message: "Unexpected state write" } });
  });
  await page.route("**/api/onboarding/advance", async (route) => {
    await new Promise<void>((resolve) => {
      releaseAdvance = resolve;
    });
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(),
          currentStep: "scenario",
          completedSteps: ["business", "channels"],
          data: { businessType: "services", selectedChannels: ["whatsapp"] },
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

  await expect(
    page.getByText(/saved only as preferences; no request is sent automatically/i),
  ).toBeVisible();
  const requestedChannel = page.getByRole("button", { name: /WhatsApp.*Managed setup/i });
  await expect(requestedChannel).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /Telegram.*Available/i })).toBeVisible();
  await requestedChannel.click();
  await expect(requestedChannel).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saving...");
  await expect(requestedChannel).toBeDisabled();
  await expect(page.getByRole("button", { name: /Telegram.*Available/i })).toBeDisabled();
  releaseAdvance?.();
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
  await expect(page.getByLabel(/Company name/)).toHaveAttribute("maxlength", "160");
  await expect(page.getByLabel(/About the company/)).toHaveAttribute("required", "");
  await expect(page.getByLabel(/About the company/)).toHaveAttribute("maxlength", "4000");
  await expect(page.getByLabel("Catalog, services, and prices")).toBeVisible();
  await expect(page.getByTestId("onboarding-timezone")).toBeVisible();
  await expect(page.getByLabel("Business hours")).toBeVisible();
});

test("onboarding hydrates state and persists progress", async ({ page }) => {
  const advances: { step?: string; data?: Record<string, unknown> }[] = [];
  const advanceIfMatches: Array<string | undefined> = [];
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

    await route.fulfill({ status: 500, json: { message: "Unexpected state write" } });
  });

  await page.route("**/api/onboarding/advance", async (route) => {
    const body = route.request().postDataJSON() as {
      step?: string;
      data?: Record<string, unknown>;
    };
    advances.push(body);
    advanceIfMatches.push(route.request().headers()["if-match"]);
    if (body.step) completedSteps.push(body.step);
    if (body.data?.businessType || body.data?.companyInfo) profileVersion += 1;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: "channels",
          completedSteps,
          data: body.data ?? {},
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
  await expect(page.locator("[data-onboarding-step-heading]")).toBeFocused();
  await expect.poll(() => advances.length).toBe(1);
  expect(advances[0]).toEqual({
    step: "business",
    data: { businessType: "beauty" },
  });
  expect(advanceIfMatches).toEqual(['"business-profile-onboarding-1"']);
});

test("onboarding completes all six steps through atomic ordered advances", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  const steps = ["business", "channels", "scenario", "company", "crm", "launch"];
  const requests: Array<{
    step: string;
    data: Record<string, unknown>;
    ifMatch?: string;
  }> = [];
  let profileVersion = 1;
  let currentStep = "business";
  let completedSteps: string[] = [];
  let data: Record<string, unknown> = {};

  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep,
          completedSteps,
          data,
          completedAt: null,
        },
      },
    });
  });
  await page.route("**/api/onboarding/advance", async (route) => {
    const body = route.request().postDataJSON() as {
      step: string;
      data: Record<string, unknown>;
    };
    const ifMatch = route.request().headers()["if-match"];
    requests.push({ ...body, ...(ifMatch ? { ifMatch } : {}) });
    const profileWrite = body.step === "business" || body.step === "company";
    if (profileWrite) {
      expect(ifMatch).toBe(`"business-profile-onboarding-${profileVersion}"`);
      profileVersion += 1;
    } else {
      expect(ifMatch).toBeUndefined();
    }
    data = {
      ...data,
      ...body.data,
      ...(body.data.companyInfo
        ? {
            companyInfo: {
              ...((data.companyInfo as Record<string, unknown> | undefined) ?? {}),
              ...(body.data.companyInfo as Record<string, unknown>),
            },
          }
        : {}),
    };
    completedSteps = [...completedSteps, body.step];
    currentStep = steps[Math.min(steps.indexOf(body.step) + 1, steps.length - 1)] ?? "launch";
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep,
          completedSteps,
          data,
          completedAt: body.step === "launch" ? "2026-07-19T12:00:00.000Z" : null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Beauty studio" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where do customers contact you?" }),
  ).toBeFocused();

  await page.getByRole("button", { name: /Telegram.*Available/i }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /Customer support/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Company name").fill("Complete onboarding workspace");
  await page
    .getByLabel("About the company")
    .fill("A complete six-step onboarding contract fixture.");
  await expect(page.getByTestId("onboarding-timezone")).toContainText(/Paris|UTC/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /LeadVirt Inbox/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Initial setup saved" })).toBeFocused();
  await page.getByRole("button", { name: "Review business information" }).click();

  await expect(page).toHaveURL(`${webBase}/app/knowledge?welcome=1`);
  expect(requests.map((request) => request.step)).toEqual(steps);
  expect(requests[3]?.data).toMatchObject({
    timezone: expect.any(String),
    companyInfo: {
      name: "Complete onboarding workspace",
      description: "A complete six-step onboarding contract fixture.",
    },
  });
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

test("onboarding is read-protected for agent and viewer roles", async ({ page }) => {
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        data: {
          id: "onboarding-agent",
          tenantId: "onboarding-tenant",
          email: "agent@onboarding.test",
          role: "AGENT",
          authMode: "email",
          passwordChangeRequired: false,
        },
      },
    });
  });
  await page.route("**/api/onboarding/state", async (route) => {
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
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("onboarding-role-boundary")).toBeVisible();
  await expect(page.getByTestId("onboarding-step-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
});

test("onboarding saves a dirty answer before Skip leaves the flow", async ({ context, page }) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let savedDraft: Record<string, unknown> | null = null;
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
    savedDraft = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(2),
          currentStep: "business",
          completedSteps: [],
          data: { businessType: "beauty" },
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Beauty studio" }).click();
  await page.getByRole("button", { name: "Skip" }).click();

  await expect
    .poll(() => savedDraft)
    .toEqual({
      currentStep: "business",
      data: { businessType: "beauty" },
    });
  await expect(page).toHaveURL(`${webBase}/app`);
});

test("onboarding preserves a dirty later step across Back and repeated progress", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  let profileVersion = 1;
  let savedDraft: Record<string, unknown> | null = null;
  await page.route("**/api/onboarding/state", async (route) => {
    if (route.request().method() === "GET") {
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
    savedDraft = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: "channels",
          completedSteps: ["business"],
          data: { businessType: "services", selectedChannels: ["telegram"] },
          completedAt: null,
        },
      },
    });
  });
  await page.route("**/api/onboarding/advance", async (route) => {
    profileVersion += 1;
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: "channels",
          completedSteps: ["business"],
          data: { businessType: "services" },
          completedAt: null,
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /Telegram.*Available/i }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  await expect
    .poll(() => savedDraft)
    .toEqual({
      currentStep: "channels",
      data: { selectedChannels: ["telegram"] },
    });
});

test("legacy custom onboarding values remain reviewable and recoverable", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(9),
          currentStep: "launch",
          completedSteps: ["business", "channels", "scenario", "company", "crm"],
          data: {
            businessType: "wellness-studio",
            selectedChannels: ["telegram"],
            scenario: "sales-assistant",
            companyInfo: { name: "Legacy Workspace", description: "Existing profile." },
            timezone: "Europe/Paris",
            crm: "spreadsheet",
          },
          completedAt: null,
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await expect(page.getByText("wellness-studio", { exact: true })).toBeVisible();
  await expect(page.getByText("sales-assistant", { exact: true })).toBeVisible();
  await expect(page.getByText("spreadsheet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review business information" })).toBeEnabled();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "spreadsheet", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
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

    await route.fulfill({ status: 500, json: { message: "Unexpected state write" } });
  });

  await page.route("**/api/onboarding/advance", async (route) => {
    patchAttempts += 1;
    patchIfMatches.push(route.request().headers()["if-match"]);
    if (patchAttempts === 1) {
      await route.fulfill({ status: 503, json: { message: "Persistence unavailable" } });
      return;
    }

    const body = route.request().postDataJSON() as {
      step?: string;
      data?: Record<string, unknown>;
    };
    if (body.step) completedSteps.push(body.step);
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(2),
          currentStep: "channels",
          completedSteps,
          data: body.data ?? {},
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
  expect(patchIfMatches).toHaveLength(2);
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
  const advances: Array<{
    step?: string;
    data?: Record<string, unknown>;
  }> = [];
  const advanceIfMatches: Array<string | undefined> = [];
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

    await route.fulfill({ status: 500, json: { message: "Unexpected state write" } });
  });

  await page.route("**/api/onboarding/advance", async (route) => {
    const body = route.request().postDataJSON() as {
      step?: string;
      data?: Record<string, unknown>;
    };
    advances.push(body);
    advanceIfMatches.push(route.request().headers()["if-match"]);
    if (body.data?.companyInfo) {
      profileVersion += 1;
      savedData = { ...savedData, ...body.data };
    }
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(profileVersion),
          currentStep: "crm",
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
  await expect.poll(() => advances.length).toBe(1);
  expect(advanceIfMatches).toEqual(['"business-profile-onboarding-7"']);
  expect(advances[0]?.step).toBe("company");
  expect(Object.keys(advances[0]?.data ?? {}).sort()).toEqual(["companyInfo", "timezone"]);
  expect(advances[0]?.data).not.toHaveProperty("businessType");
  expect(advances[0]?.data).not.toHaveProperty("selectedChannels");
  expect(advances[0]?.data).not.toHaveProperty("scenario");
  expect(advances[0]?.data).not.toHaveProperty("crm");
});

test("onboarding shows API validation beside the company field without a connection warning", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(3),
          currentStep: "company",
          completedSteps: ["business", "channels", "scenario"],
          data: {
            businessType: "services",
            selectedChannels: ["telegram"],
            scenario: "support",
            timezone: "Europe/Paris",
            companyInfo: { name: "Validation fixture", description: "Existing description" },
          },
          completedAt: null,
        },
      },
    });
  });
  await page.route("**/api/onboarding/advance", async (route) => {
    await route.fulfill({
      status: 400,
      json: {
        error: {
          code: "KNOWLEDGE_VALIDATION_INPUT_INVALID",
          message: "The request contains invalid fields.",
          fieldErrors: [
            {
              field: "data.companyInfo.description",
              code: "KNOWLEDGE_VALIDATION_MAX_LENGTH",
              message: "The company description is invalid.",
            },
            {
              field: "data.companyInfo.faq",
              code: "KNOWLEDGE_VALIDATION_MAX_LENGTH",
              message: "The FAQ is invalid.",
            },
          ],
        },
      },
    });
  });

  await page.goto(`${webBase}/onboarding`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("The company description is invalid.")).toBeVisible();
  const description = page.getByLabel("About the company");
  const faq = page.getByLabel("FAQ and common objections");
  await expect(description).toHaveAttribute("aria-invalid", "true");
  await expect(description).toBeFocused();
  await expect(faq).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("onboarding-persistence-error")).toHaveCount(0);

  await description.fill("Corrected description");
  await expect(page.getByText("The company description is invalid.")).toHaveCount(0);
  await expect(faq).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("The FAQ is invalid.")).toBeVisible();
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

    await route.fulfill({ status: 500, json: { message: "Unexpected state write" } });
  });

  await page.route("**/api/onboarding/advance", async (route) => {
    const body = route.request().postDataJSON() as {
      step?: string;
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
          currentStep: body.step === "scenario" ? "company" : "crm",
          completedSteps: ["business", "channels", "scenario", "company"],
          data: { ...initialData, ...(body.data ?? {}) },
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
    timezone: "Europe/Paris",
    crm: "none",
  };
  let stateUpdates = 0;
  let launchCompletions = 0;

  await page.route("**/api/onboarding/state", async (route) => {
    await route.fulfill({
      json: {
        data: {
          ...businessProfileRevision(5),
          currentStep: "launch",
          completedSteps: ["business", "channels", "scenario", "company", "crm"],
          data,
          completedAt: null,
        },
      },
    });
  });
  await page.route("**/api/onboarding/advance", async (route) => {
    stateUpdates += 1;
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
