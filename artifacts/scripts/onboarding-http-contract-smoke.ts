import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { RolesGuard } from "../../apps/api/src/common/guards/roles.guard.js";
import { AuthService } from "../../apps/api/src/modules/auth/auth.service.js";
import { WorkspaceAuthGuard } from "../../apps/api/src/modules/auth/workspace-auth.guard.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { OnboardingController } from "../../apps/api/src/modules/onboarding/onboarding.controller.js";
import { OnboardingService } from "../../apps/api/src/modules/onboarding/onboarding.service.js";

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function own(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const context: RequestContext = {
  tenantId: "onboarding-http-tenant",
  userId: "onboarding-http-owner",
  role: "OWNER",
  authMode: "email",
  tenant: {
    id: "onboarding-http-tenant",
    name: "HTTP Contract Workspace",
    slug: "onboarding-http-contract",
    status: "TRIALING",
    businessType: "beauty",
    timezone: "Europe/Paris",
  },
  user: {
    id: "onboarding-http-owner",
    email: "owner@onboarding-http.test",
    phone: null,
    name: "HTTP Contract Owner",
    avatarUrl: null,
    passwordChangeRequired: false,
  },
};

let state = {
  id: "onboarding-http-state",
  tenantId: context.tenantId,
  businessProfileVersion: 4,
  businessProfileUpdatedAt: new Date("2026-07-19T00:00:00.000Z"),
  currentStep: "channels",
  completedSteps: ["business"],
  data: {
    businessType: "beauty",
    selectedChannels: ["telegram"],
    scenario: "support",
    timezone: "Europe/Paris",
    companyInfo: {
      name: "HTTP Contract Workspace",
      description: "Saved profile description.",
      services: [{ id: "consultation", name: "Consultation" }],
      weeklySchedule: [{ day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" }],
    },
    crm: "none",
  },
  completedAt: null as Date | null,
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  updatedAt: new Date("2026-07-19T00:00:00.000Z"),
};

const captured: Array<{ currentStep?: string; data?: Record<string, unknown> }> = [];
const auditEvents: string[] = [];
let dispatches = 0;

const prisma = {
  $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
};

const transaction = {
  auditLog: {
    create: async ({ data }: { data: { action: string } }) => {
      auditEvents.push(data.action);
      return {};
    },
  },
  onboardingState: {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      state = {
        ...state,
        ...data,
        updatedAt: new Date(),
      } as typeof state;
      return state;
    },
  },
};

const businessProfile = {
  updateOnboardingInTransaction: async (
    _tx: unknown,
    _context: RequestContext,
    input: { currentStep?: string; data?: Record<string, unknown> },
  ) => {
    const data = input.data ?? {};
    const companyInfo =
      typeof data.companyInfo === "object" && data.companyInfo !== null
        ? (data.companyInfo as Record<string, unknown>)
        : {};
    const unexpectedProfileField =
      own(data, "businessType") ||
      own(data, "timezone") ||
      [
        "name",
        "description",
        "avgCheck",
        "servicesCatalog",
        "services",
        "hours",
        "weeklySchedule",
        "availability",
        "faq",
        "policies",
        "escalationRules",
      ].some((field) => own(companyInfo, field));
    if (input.currentStep === "channels") {
      assert(!unexpectedProfileField, "HTTP channel patch retained an omitted profile field.");
    }
    captured.push(input);
    state = {
      ...state,
      ...(input.currentStep ? { currentStep: input.currentStep } : {}),
      data: { ...state.data, ...data },
      updatedAt: new Date(),
    };
    return {
      state,
      eventId: `onboarding-http-event-${captured.length}`,
      reconciliationEventIds: [],
    };
  },
  dispatch: async () => {
    dispatches += 1;
  },
  profileEtag: (_tenantId: string, version: number) => `"onboarding-http-${version}"`,
};

const authService = {
  readSessionToken: () => "onboarding-http-session",
  contextForSessionToken: async () => context,
};

@Module({
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    RolesGuard,
    { provide: PrismaService, useValue: prisma },
    { provide: BusinessProfileService, useValue: businessProfile },
    { provide: AuthService, useValue: authService },
    WorkspaceAuthGuard,
  ],
})
class OnboardingHttpContractModule {}

async function request(
  origin: string,
  path: string,
  body: unknown,
  headers: HeadersInit = {},
  method: "PATCH" | "POST" = "PATCH",
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function main() {
  const app = await NestFactory.create(OnboardingHttpContractModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");

  try {
    const address = app.getHttpServer().address();
    assert(address && typeof address === "object", "Nest did not bind an HTTP test port.");
    const origin = `http://127.0.0.1:${address.port}`;

    const channel = await request(origin, "/api/onboarding/state", {
      currentStep: "channels",
      data: { selectedChannels: ["telegram"] },
    });
    assert(
      channel.response.status === 200,
      `Channel HTTP patch returned ${channel.response.status}.`,
    );
    assert(
      JSON.stringify(Object.keys(captured[0]?.data ?? {}).sort()) ===
        JSON.stringify(["selectedChannels"]),
      "Channel HTTP patch did not reach the service with exact JSON patch semantics.",
    );

    const company = await request(
      origin,
      "/api/onboarding/state",
      { currentStep: "company", data: { companyInfo: { description: "Updated text." } } },
      { "If-Match": '"onboarding-http-4"' },
    );
    assert(
      company.response.status === 200,
      `Company HTTP patch returned ${company.response.status}.`,
    );
    const companyInfo = captured[1]?.data?.companyInfo as Record<string, unknown>;
    assert(
      JSON.stringify(Object.keys(companyInfo ?? {}).sort()) === JSON.stringify(["description"]),
      "Company HTTP patch retained omitted structured fields.",
    );

    state = { ...state, currentStep: "channels", completedSteps: ["business"] };

    const advance = async (
      step: string,
      data: Record<string, unknown>,
      expectedCurrentStep: string,
      headers: HeadersInit = {},
    ) => {
      const result = await request(
        origin,
        "/api/onboarding/advance",
        { step, data },
        headers,
        "POST",
      );
      assert(result.response.status === 201, `${step} advance returned ${result.response.status}.`);
      assert(
        result.payload.data?.currentStep === expectedCurrentStep,
        `${step} advance did not commit ${expectedCurrentStep}.`,
      );
      return result.payload.data;
    };

    await advance("channels", { selectedChannels: ["telegram", "website"] }, "scenario");
    await advance("scenario", { scenario: "support" }, "company");
    await advance(
      "company",
      {
        companyInfo: {
          name: "HTTP Contract Workspace",
          description: "Atomic onboarding HTTP coverage.",
        },
        timezone: "Europe/Paris",
      },
      "crm",
      { "If-Match": '"onboarding-http-4"' },
    );
    await advance("crm", { crm: "none" }, "launch");
    const launched = await advance("launch", {}, "launch");
    assert(
      JSON.stringify(launched.completedSteps) ===
        JSON.stringify(["business", "channels", "scenario", "company", "crm", "launch"]),
      "Atomic advances did not complete every onboarding step in order.",
    );
    assert(typeof launched.completedAt === "string", "Launch did not set completedAt.");

    const completedAt = launched.completedAt;
    const replayed = await advance("scenario", { scenario: "consult" }, "launch");
    assert(replayed.completedAt === completedAt, "Older-step replay changed launch completion time.");
    assert(dispatches === 8, "Every state write did not dispatch after its transaction.");
    assert(
      auditEvents.filter((event) => event === "onboarding.step_completed").length === 6,
      "Atomic advance did not emit one completion audit event per call.",
    );

    console.log(`Onboarding HTTP contract smoke: ${checks}/${checks} checks passed`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
