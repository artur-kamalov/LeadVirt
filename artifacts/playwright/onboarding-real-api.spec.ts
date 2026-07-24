import { expect, test, type Page } from "@playwright/test";

const webBase = (process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001").replace(/\/$/u, "");
const apiBase = (process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api").replace(/\/$/u, "");
const sessionToken = process.env.LEADVIRT_QA_SESSION_TOKEN;

const stepIds = ["business", "channels", "scenario", "company", "crm", "launch"];

type OnboardingState = {
  currentStep: string;
  completedSteps: string[];
  data: Record<string, unknown>;
  completedAt: string | null;
};

async function expectStep(page: Page, step: number, heading: string) {
  const stepHeading = page.getByRole("heading", { name: heading });
  await expect(page.getByRole("progressbar", { name: `Step ${step} of 6` })).toHaveAttribute(
    "aria-valuenow",
    String(step),
  );
  await expect(stepHeading).toBeVisible();
  await expect(stepHeading).toBeFocused();
}

async function advance(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${apiBase}/onboarding/advance` && response.request().method() === "POST",
  );
  await action();
  const response = await responsePromise;
  const body = await response.text();
  expect(
    response.status(),
    `POST /onboarding/advance returned ${response.status()}: ${body}`,
  ).toBeGreaterThanOrEqual(200);
  expect(
    response.status(),
    `POST /onboarding/advance returned ${response.status()}: ${body}`,
  ).toBeLessThan(400);
}

test("a clean QA owner completes all six onboarding steps against the real API", async ({
  context,
  page,
}) => {
  if (!sessionToken) {
    test.skip(
      true,
      "Set LEADVIRT_QA_SESSION_TOKEN to a freshly provisioned QA session before running this real-stack test.",
    );
    return;
  }

  test.setTimeout(180_000);

  const apiUrl = new URL(apiBase);
  await context.addCookies([
    {
      name: "leadvirt_session",
      value: sessionToken,
      url: apiUrl.origin,
      httpOnly: true,
      secure: apiUrl.protocol === "https:",
      sameSite: "Lax",
    },
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);

  const initialResponse = await context.request.get(`${apiBase}/onboarding/state`);
  expect(initialResponse.status()).toBe(200);
  const initialPayload = (await initialResponse.json()) as { data: OnboardingState };
  expect(
    initialPayload.data.currentStep,
    "Re-provision the dedicated QA user before rerunning this test.",
  ).toBe("business");
  expect(
    initialPayload.data.completedSteps,
    "Re-provision the dedicated QA user before rerunning this test.",
  ).toEqual([]);

  const onboardingResponses: Array<{ method: string; status: number; url: string }> = [];
  const knowledgeOverviewResponses: Array<{ status: number; url: string }> = [];
  page.on("response", (response) => {
    if (response.url().startsWith(`${apiBase}/onboarding/`)) {
      onboardingResponses.push({
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
    }
    if (response.url() === `${apiBase}/knowledge/v2/overview`) {
      knowledgeOverviewResponses.push({ status: response.status(), url: response.url() });
    }
  });

  const runId = Date.now().toString();
  const company = {
    name: `LeadVirt Onboarding QA ${runId}`,
    description:
      "A local service business that answers customer questions and arranges consultations.",
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/onboarding`, { waitUntil: "domcontentloaded" });

  await expectStep(page, 1, "What kind of business is this?");
  await expect(page.getByTestId("language-switcher")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeEnabled();
  const back = page.getByRole("button", { name: "Back", exact: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  await expect(back).toBeDisabled();
  await expect(next).toBeDisabled();

  const services = page.getByRole("button", { name: "Services", exact: true });
  await expect(services).toHaveAttribute("aria-pressed", "false");
  await services.click();
  await expect(services).toHaveAttribute("aria-pressed", "true");
  await expect(next).toBeEnabled();
  await advance(page, () => next.click());

  await expectStep(page, 2, "Where do customers contact you?");
  await expect(back).toBeEnabled();
  await expect(next).toBeDisabled();
  const telegram = page.getByRole("button", { name: /Telegram.*Available/i });
  await expect(telegram).toHaveAttribute("aria-pressed", "false");
  await telegram.click();
  await expect(telegram).toHaveAttribute("aria-pressed", "true");
  await expect(next).toBeEnabled();

  await back.click();
  await expectStep(page, 1, "What kind of business is this?");
  await expect(services).toHaveAttribute("aria-pressed", "true");
  await expect(next).toBeEnabled();
  await advance(page, () => next.click());

  await expectStep(page, 2, "Where do customers contact you?");
  await expect(telegram).toHaveAttribute("aria-pressed", "true");
  const website = page.getByRole("button", { name: /Website.*Available/i });
  await expect(website).toHaveAttribute("aria-pressed", "false");
  await website.click();
  await expect(website).toHaveAttribute("aria-pressed", "true");
  await advance(page, () => next.click());

  await expectStep(page, 3, "Choose a setup goal");
  await expect(back).toBeEnabled();
  await expect(next).toBeDisabled();
  const consultation = page.getByRole("button", { name: /Consultation and qualification/i });
  await expect(consultation).toHaveAttribute("aria-pressed", "false");
  await consultation.click();
  await expect(consultation).toHaveAttribute("aria-pressed", "true");
  await expect(next).toBeEnabled();
  await advance(page, () => next.click());

  await expectStep(page, 4, "Tell us about your business");
  await expect(back).toBeEnabled();
  await expect(next).toBeDisabled();

  const companyName = page.getByRole("textbox", { name: "Company name", exact: true });
  const companyDescription = page.getByRole("textbox", {
    name: "About the company",
    exact: true,
  });
  await expect(companyName).toHaveAttribute("maxlength", "160");
  await expect(companyDescription).toHaveAttribute("maxlength", "4000");
  await expect(companyDescription).toHaveAttribute("required", "");
  await expect(page.getByTestId("onboarding-timezone")).toHaveCount(0);

  await companyName.fill(company.name);
  await expect(next).toBeDisabled();
  await companyDescription.fill(company.description);
  await expect(next).toBeEnabled();
  await advance(page, () => next.click());

  await expectStep(page, 5, "Where should leads go?");
  await expect(back).toBeEnabled();
  await expect(next).toBeDisabled();
  const inbox = page.getByRole("button", { name: /LeadVirt Inbox.*Available/i });
  await expect(inbox).toHaveAttribute("aria-pressed", "false");
  await inbox.click();
  await expect(inbox).toHaveAttribute("aria-pressed", "true");
  await expect(next).toBeEnabled();
  await advance(page, () => next.click());

  await expectStep(page, 6, "Initial setup saved");
  await expect(page.getByText(company.name, { exact: true })).toBeVisible();
  const reviewBusiness = page.getByRole("button", {
    name: "Review business information",
    exact: true,
  });
  await expect(reviewBusiness).toBeEnabled();
  await page.screenshot({
    path: "artifacts/screenshots/onboarding-real-api-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("progressbar", { name: "Step 6 of 6" })).toBeVisible();
  await expect(reviewBusiness).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "artifacts/screenshots/onboarding-real-api-mobile.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  const knowledgeNavigation = page.waitForURL(`${webBase}/app/knowledge?welcome=1`);
  await advance(page, () => reviewBusiness.click());
  await knowledgeNavigation;
  await expect(page).toHaveURL(`${webBase}/app/knowledge?welcome=1`);
  await expect(page.getByText("Your setup answers are saved.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("business-profile-description")).toBeVisible();
  await expect(page.getByTestId("business-profile-services")).toBeVisible();
  await expect(page.getByTestId("business-profile-faq")).toBeVisible();
  await expect.poll(() => knowledgeOverviewResponses.length).toBeGreaterThan(0);
  expect(
    knowledgeOverviewResponses.filter(({ status }) => status >= 400),
    "The first Knowledge overview load must not race or fail after onboarding.",
  ).toEqual([]);

  const finalResponse = await context.request.get(`${apiBase}/onboarding/state`);
  expect(finalResponse.status()).toBe(200);
  const finalPayload = (await finalResponse.json()) as { data: OnboardingState };
  expect(finalPayload.data.currentStep).toBe("launch");
  expect(finalPayload.data.completedSteps).toEqual(stepIds);
  expect(finalPayload.data.completedAt).not.toBeNull();
  expect(finalPayload.data.data).toMatchObject({
    businessType: "services",
    selectedChannels: ["telegram", "website"],
    scenario: "consult",
    timezone: expect.any(String),
    crm: "none",
    companyInfo: company,
  });

  const failedOnboardingResponses = onboardingResponses.filter(({ status }) => status >= 400);
  expect(failedOnboardingResponses, "No onboarding request may return 4xx or 5xx.").toEqual([]);
  expect(onboardingResponses.filter(({ method }) => method === "POST")).toHaveLength(7);
  expect(onboardingResponses.some(({ status }) => [400, 428, 500].includes(status))).toBe(false);
});
