import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { BusinessProfilePatchRequestDto } from "../../apps/api/src/modules/business-profile/dto/business-profile.dto.js";
import { createKnowledgeV2ValidationPipe } from "../../apps/api/src/modules/knowledge/knowledge-v2-validation.pipe.js";
import { onboardingKnowledgeInput } from "../../apps/api/src/modules/knowledge/onboarding-knowledge-input.js";
import {
  normalizeOnboardingUpdate,
  UpdateOnboardingDto,
} from "../../apps/api/src/modules/onboarding/dto/update-onboarding.dto.js";
import { UpdateAccountSettingsDto } from "../../apps/api/src/modules/settings/dto/update-account-settings.dto.js";

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function validate(body: unknown) {
  return createKnowledgeV2ValidationPipe().transform(body, {
    type: "body",
    metatype: BusinessProfilePatchRequestDto,
    data: undefined,
  });
}

async function validateOnboarding(body: unknown) {
  return createKnowledgeV2ValidationPipe().transform(body, {
    type: "body",
    metatype: UpdateOnboardingDto,
    data: undefined,
  });
}

async function validateSettings(body: unknown) {
  return createKnowledgeV2ValidationPipe().transform(body, {
    type: "body",
    metatype: UpdateAccountSettingsDto,
    data: undefined,
  });
}

async function expectInvalid(body: unknown, field: string) {
  let error: unknown;
  try {
    await validate(body);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof HttpException && error.getStatus() === 400, `${field} was accepted.`);
  assert(JSON.stringify(error.getResponse()).includes(field), `${field} was not identified.`);
}

async function expectInvalidOnboarding(body: unknown, field: string) {
  let error: unknown;
  try {
    await validateOnboarding(body);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof HttpException && error.getStatus() === 400, `${field} was accepted.`);
  assert(JSON.stringify(error.getResponse()).includes(field), `${field} was not identified.`);
}

async function expectInvalidSettings(body: unknown, field: string) {
  let error: unknown;
  try {
    await validateSettings(body);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof HttpException && error.getStatus() === 400, `${field} was accepted.`);
  assert(JSON.stringify(error.getResponse()).includes(field), `${field} was not identified.`);
}

async function main() {
  const valid = await validate({
    profile: {
      name: "Northstar Studio",
      timezone: "Europe/Paris",
      services: [
        {
          id: "second-service",
          name: "Second service",
          description: "Second in the intended catalog order.",
          price: "EUR 80",
          duration: "60 minutes",
        },
      ],
      weeklySchedule: [{ day: "SAT", enabled: false, opensAt: "10:00", closesAt: "16:00" }],
    },
  });
  assert(valid instanceof BusinessProfilePatchRequestDto, "A valid profile was not transformed.");

  await expectInvalid({ profile: { name: "Studio", unknown: true } }, "unknown");
  await expectInvalid(
    {
      profile: {
        services: [
          {
            id: "consultation",
            name: "Consultation",
            description: "",
            price: "EUR 45",
            duration: "45 minutes",
            internal: true,
          },
        ],
      },
    },
    "internal",
  );
  await expectInvalid(
    {
      profile: {
        weeklySchedule: [
          { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
          { day: "MON", enabled: true, opensAt: "10:00", closesAt: "19:00" },
        ],
      },
    },
    "weeklySchedule",
  );
  await expectInvalid({ profile: { timezone: "Mars/Olympus" } }, "timezone");
  await expectInvalid(
    {
      profile: {
        faq: "x".repeat(20_000),
        services: Array.from({ length: 110 }, (_, index) => ({
          id: `service-${index}`,
          name: `Service ${index}`,
          description: "x".repeat(2_000),
          price: "",
          duration: "",
        })),
      },
    },
    "profile",
  );
  await expectInvalidSettings({ businessName: null }, "businessName");
  await expectInvalidSettings({ businessType: null }, "businessType");
  await expectInvalidSettings({ timezone: null }, "timezone");

  const validOnboarding = await validateOnboarding({
    currentStep: "company",
    data: {
      businessType: "wellness",
      companyInfo: {
        name: "Northstar Studio",
        services: [
          {
            id: "consultation",
            name: "Consultation",
            description: "Needs assessment.",
            price: "EUR 45",
            duration: "45 minutes",
          },
        ],
        weeklySchedule: [{ day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" }],
      },
    },
  });
  assert(validOnboarding instanceof UpdateOnboardingDto, "Valid onboarding was not transformed.");
  const customOnboarding = await validateOnboarding({
    data: { businessType: "consulting", scenario: "sales", crm: "spreadsheet" },
  });
  assert(
    customOnboarding.data?.businessType === "consulting" &&
      customOnboarding.data.scenario === "sales" &&
      customOnboarding.data.crm === "spreadsheet",
    "Existing custom onboarding values were rejected or rewritten.",
  );
  const transformedChannelPatch = await validateOnboarding({
    currentStep: "channels",
    data: { selectedChannels: ["telegram"] },
  });
  const normalizedChannelPatch = normalizeOnboardingUpdate(transformedChannelPatch);
  assert(
    JSON.stringify(Object.keys(normalizedChannelPatch.data ?? {}).sort()) ===
      JSON.stringify(["selectedChannels"]),
    "A class-transformed channel patch retained omitted profile fields.",
  );
  const transformedCompanyPatch = await validateOnboarding({
    currentStep: "company",
    data: { companyInfo: { description: "Updated description." } },
  });
  const normalizedCompanyPatch = normalizeOnboardingUpdate(transformedCompanyPatch);
  assert(
    JSON.stringify(Object.keys(normalizedCompanyPatch.data?.companyInfo ?? {}).sort()) ===
      JSON.stringify(["description"]),
    "A class-transformed company patch retained omitted structured fields.",
  );
  await expectInvalidOnboarding(
    { data: { companyInfo: { name: "Studio", internal: true } } },
    "internal",
  );
  await expectInvalidOnboarding({ data: { companyInfo: { name: "   " } } }, "name");
  await expectInvalidOnboarding({ data: { businessType: "   " } }, "businessType");
  await expectInvalidOnboarding(
    { data: { companyInfo: { description: "x".repeat(4_001) } } },
    "description",
  );

  const input = onboardingKnowledgeInput({
    timezone: "Europe/Paris",
    companyInfo: {
      servicesCatalog: "Legacy catalog note.",
      services: [
        {
          id: "opaque-second-id",
          name: "Second service",
          description: "Second by user choice.",
          price: "EUR 80",
          duration: "60 minutes",
        },
        {
          id: "opaque-first-id",
          name: "First service",
          description: "Still rendered second.",
          price: "EUR 40",
          duration: "30 minutes",
        },
      ],
      hours: "Holiday hours vary.",
      weeklySchedule: [
        { day: "SUN", enabled: false, opensAt: "", closesAt: "" },
        { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      ],
    },
  });
  assert(
    input.servicesCatalog.indexOf("Second service") <
      input.servicesCatalog.indexOf("First service"),
    "Service order was not preserved.",
  );
  assert(!input.servicesCatalog.includes("opaque-"), "Opaque service IDs leaked into AI text.");
  assert(input.servicesCatalog.includes("Legacy catalog note."), "Legacy catalog notes were lost.");
  assert(input.hours.indexOf("MON:") < input.hours.indexOf("SUN:"), "Schedule order is unstable.");
  assert(input.hours.includes("Europe/Paris"), "Schedule timezone was omitted.");
  assert(input.hours.includes("Holiday hours vary."), "Legacy hours notes were lost.");

  const timezoneOnly = onboardingKnowledgeInput({ timezone: "Europe/Paris" });
  assert(timezoneOnly.hours === "", "Timezone-only onboarding created hours evidence.");
  const explicitClosedSchedule = onboardingKnowledgeInput({
    timezone: "Europe/Paris",
    companyInfo: {
      weeklySchedule: [{ day: "MON", enabled: false, opensAt: "", closesAt: "" }],
    },
  });
  assert(
    explicitClosedSchedule.hours.includes("MON: closed"),
    "An explicitly supplied closed schedule was not projected.",
  );

  console.log(`Business profile contract smoke: ${checks}/${checks} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
