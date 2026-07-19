import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { loadEnvFile } from "@leadvirt/config";
import { hashKnowledgeValue } from "@leadvirt/knowledge";
import { prisma, type Prisma, type Tenant, type User } from "@leadvirt/db";
import type { BusinessProfileData } from "@leadvirt/types";
import type { Response } from "express";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AuthService } from "../../apps/api/src/modules/auth/auth.service.js";
import { BusinessProfileController } from "../../apps/api/src/modules/business-profile/business-profile.controller.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2OnboardingProjectionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-onboarding-projection.service.js";
import { createKnowledgeV2ValidationPipe } from "../../apps/api/src/modules/knowledge/knowledge-v2-validation.pipe.js";
import { UpdateOnboardingDto } from "../../apps/api/src/modules/onboarding/dto/update-onboarding.dto.js";
import { OnboardingService } from "../../apps/api/src/modules/onboarding/onboarding.service.js";
import { SettingsService } from "../../apps/api/src/modules/settings/settings.service.js";

loadEnvFile();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

async function validateOnboarding(body: unknown) {
  return createKnowledgeV2ValidationPipe().transform(body, {
    type: "body",
    metatype: UpdateOnboardingDto,
    data: undefined,
  });
}

function contextFor(tenant: Tenant, user: User): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role: "OWNER",
    authMode: "email",
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      businessType: tenant.businessType,
      timezone: tenant.timezone,
    },
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      passwordChangeRequired: user.passwordChangeRequired,
    },
  };
}

function responseHeaders() {
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(",") : String(value));
      return response;
    },
  } as unknown as Response;
  return { headers, response };
}

function completedProfile(suffix: string): BusinessProfileData {
  return {
    businessType: "wellness",
    name: `Northstar Studio ${suffix}`,
    description: "Appointments, consultations, and aftercare.",
    avgCheck: "EUR 95",
    servicesCatalog: "Packages are customized after consultation.",
    services: [
      {
        id: "consultation",
        name: "Initial consultation",
        description: "Needs assessment and treatment plan.",
        price: "EUR 45",
        duration: "45 minutes",
      },
      {
        id: "signature-session",
        name: "Signature session",
        description: "The most popular appointment.",
        price: "EUR 120",
        duration: "90 minutes",
      },
    ],
    hours: "Public holidays may use reduced hours.",
    weeklySchedule: [
      { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      { day: "SUN", enabled: false, opensAt: "", closesAt: "" },
    ],
    availability: "Same-week appointments are normally available.",
    faq: "Arrive ten minutes before the first appointment.",
    policies: "Changes are free up to 24 hours before an appointment.",
    escalationRules: "Escalate medical and payment disputes to the owner.",
    timezone: "Europe/Paris",
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let tenantId: string | null = null;
  let userId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: { email: `business-profile-${suffix}@example.test`, name: "Profile Owner" },
    });
    userId = user.id;
    const tenant = await prisma.tenant.create({
      data: {
        name: "Initial Studio",
        slug: `business-profile-${suffix}`,
        timezone: "UTC",
        settings: {
          unrelated: { retained: true },
          profile: { phone: "+33123456789", website: "https://old.example.test" },
        },
      },
    });
    tenantId = tenant.id;
    await prisma.membership.create({ data: { tenantId, userId, role: "OWNER" } });
    await prisma.onboardingState.create({
      data: { tenantId, currentStep: "business", completedSteps: [], data: {} },
    });
    await prisma.knowledgeV2Settings.create({ data: { tenantId } });
    const migrationJob = await prisma.knowledgeJob.create({
      data: {
        tenantId,
        idempotencyKey: `business-profile-migration-${suffix}`,
        stage: "MIGRATING_LEGACY",
      },
    });
    await prisma.knowledgeV2LegacyMigration.create({
      data: {
        tenantId,
        jobId: migrationJob.id,
        sourceManifest: [],
        sourceManifestHash: hashKnowledgeValue(`business-profile-manifest-${suffix}`),
        expectedSourceCount: 0,
        requestedByUserId: userId,
      },
    });
    await prisma.knowledgeCorpusSelector.create({
      data: {
        tenantId,
        corpusKind: "LEGACY_V1",
        selectedByUserId: userId,
      },
    });

    const reconciliationDispatches: string[] = [];
    const legacyDispatcher = {
      createEvent: async (
        tx: Prisma.TransactionClient,
        input: {
          tenantId: string;
          actorUserId?: string | null;
          reason: string;
          stateParts: Array<string | number>;
        },
      ) => {
        const stateToken = hashKnowledgeValue(
          [input.tenantId, input.reason, ...input.stateParts.map(String)].join(":"),
        );
        return tx.knowledgeOutbox.upsert({
          where: {
            tenantId_dedupeKey: {
              tenantId: input.tenantId,
              dedupeKey: `knowledge.publish:${stateToken}`,
            },
          },
          update: {},
          create: {
            tenantId: input.tenantId,
            aggregateType: "tenant_knowledge",
            aggregateId: stateToken,
            aggregateVersion: 1,
            eventType: "knowledge.publication.requested",
            schemaVersion: 1,
            dedupeKey: `knowledge.publish:${stateToken}`,
            payload: {
              tenantId: input.tenantId,
              actorUserId: input.actorUserId ?? null,
              reason: input.reason,
            },
          },
        });
      },
      dispatch: async () => ({ accepted: true }),
    };
    const knowledge = new KnowledgeService(
      prisma as never,
      { ragRetrievalMode: "database" } as never,
      {} as never,
      legacyDispatcher as never,
      new KnowledgeV2OnboardingProjectionService(),
      {
        dispatch: async (eventId: string) => {
          reconciliationDispatches.push(eventId);
        },
      } as never,
    );
    const businessProfile = new BusinessProfileService(
      prisma as unknown as PrismaService,
      knowledge,
      new KnowledgeV2IdempotencyService(prisma as unknown as PrismaService),
    );
    const controller = new BusinessProfileController(businessProfile);
    const settings = new SettingsService(
      prisma as unknown as PrismaService,
      {} as AuthService,
      businessProfile,
    );
    const onboarding = new OnboardingService(prisma as unknown as PrismaService, businessProfile);
    const context = contextFor(tenant, user);

    const initialHeaders = responseHeaders();
    const initial = await controller.get(context, initialHeaders.response);
    assert(initial.data.version === 1, "GET returned the wrong initial version.");
    assert(
      initialHeaders.headers.get("etag") === initial.data.etag,
      "GET did not expose the canonical ETag header.",
    );

    const profile = completedProfile(suffix);
    const mutationHeaders = responseHeaders();
    const first = await controller.patch(
      context,
      { profile },
      `business-profile-create-${suffix}`,
      initial.data.etag,
      mutationHeaders.response,
    );
    assert(first.data.version === 2, "PATCH did not increment the profile version.");
    assert(first.data.profile.name === profile.name, "PATCH did not persist the profile.");
    assert(
      mutationHeaders.headers.get("etag") === first.data.etag,
      "PATCH did not expose the new ETag header.",
    );

    const [stateAfterPatch, tenantAfterPatch, sources, facts, guidance, eventCount] =
      await Promise.all([
        prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }),
        prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
        prisma.businessKnowledgeSource.findMany({ where: { tenantId, deletedAt: null } }),
        prisma.knowledgeV2Fact.findMany({ where: { tenantId }, include: { versions: true } }),
        prisma.knowledgeV2GuidanceRule.findMany({
          where: { tenantId },
          include: { versions: true },
        }),
        prisma.knowledgeOutbox.count({
          where: { tenantId, eventType: "knowledge.v2.content-reconciliation.requested" },
        }),
      ]);
    assert(
      stateAfterPatch.businessProfileVersion === 2,
      "Canonical storage did not persist version 2.",
    );
    const materializedData = stateAfterPatch.data as Record<string, unknown>;
    const materializedCompany = materializedData.companyInfo as Record<string, unknown>;
    assert(
      materializedData.timezone === profile.timezone &&
        Array.isArray(materializedCompany.services) &&
        Array.isArray(materializedCompany.weeklySchedule),
      "The effective canonical profile was not materialized before projection.",
    );
    assert(
      tenantAfterPatch.name === profile.name && tenantAfterPatch.timezone === profile.timezone,
      "Tenant identity was not synchronized atomically.",
    );
    const catalog = sources.find((source) => source.sourceKey === "onboarding:catalog");
    assert(
      catalog?.content.includes("Initial consultation") &&
        catalog.content.includes("Packages are customized") &&
        !catalog.content.includes("[consultation]"),
      "Legacy catalog projection is incomplete or leaks service IDs.",
    );
    assert(facts.length === 8 && guidance.length === 2, "Structured projection is incomplete.");
    assert(
      facts
        .flatMap((fact) => fact.versions)
        .every((version) => version.lifecycleStatus === "DRAFT") &&
        guidance
          .flatMap((rule) => rule.versions)
          .every((version) => version.reviewStatus === "DRAFT"),
      "Onboarding profile changes were published without review.",
    );
    assert(eventCount === 10, "Structured projection did not queue its reconciliation outbox.");
    assert(reconciliationDispatches.length === 10, "Structured reconciliation was not dispatched.");

    const auditCountBeforeNoop = await prisma.auditLog.count({
      where: { tenantId, action: "business_profile.updated" },
    });
    const noOp = await controller.patch(
      context,
      { profile: { name: profile.name } },
      `business-profile-noop-${suffix}`,
      first.data.etag,
      responseHeaders().response,
    );
    assert(noOp.data.version === 2, "A no-op PATCH incremented the version.");
    assert(
      (await prisma.auditLog.count({
        where: { tenantId, action: "business_profile.updated" },
      })) === auditCountBeforeNoop,
      "A no-op PATCH wrote a business profile audit.",
    );

    await prisma.tenant.update({ where: { id: tenantId }, data: { name: "Drifted tenant name" } });
    const repairedDrift = await controller.patch(
      context,
      { profile: { name: profile.name } },
      `business-profile-repair-drift-${suffix}`,
      first.data.etag,
      responseHeaders().response,
    );
    assert(repairedDrift.data.version === 2, "Repairing Tenant drift incremented the revision.");
    assert(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name === profile.name,
      "A direct profile no-op did not repair Tenant drift.",
    );

    let staleError: unknown;
    try {
      await controller.patch(
        context,
        { profile: { description: "Stale write must fail." } },
        `business-profile-stale-${suffix}`,
        initial.data.etag,
        responseHeaders().response,
      );
    } catch (error) {
      staleError = error;
    }
    assert(
      staleError instanceof HttpException && staleError.getStatus() === 412,
      "A stale ETag was accepted.",
    );
    assert(
      (await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }))
        .businessProfileVersion === 2,
      "A stale PATCH changed canonical storage.",
    );

    const replay = await controller.patch(
      context,
      { profile },
      `business-profile-create-${suffix}`,
      initial.data.etag,
      responseHeaders().response,
    );
    assert(replay.data.version === 2, "Idempotency replay repeated the mutation.");

    let settingsPrecondition: unknown;
    try {
      await settings.updateAccount(context, { businessName: `${profile.name} Rejected` });
    } catch (error) {
      settingsPrecondition = error;
    }
    assert(
      settingsPrecondition instanceof HttpException && settingsPrecondition.getStatus() === 428,
      "Profile-affecting Settings accepted a missing If-Match.",
    );

    const settingsResult = await settings.updateAccount(
      context,
      {
        businessName: `${profile.name} Updated`,
        businessType: "wellness-studio",
        description: "Updated through settings.",
        timezone: "Europe/Berlin",
        phone: "+4930123456",
      },
      first.data.etag,
    );
    assert(settingsResult.businessName.endsWith("Updated"), "Settings did not update the name.");
    const [stateAfterSettings, tenantAfterSettings] = await Promise.all([
      prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }),
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    ]);
    const settingsData = stateAfterSettings.data as Record<string, unknown>;
    const companyInfo = settingsData.companyInfo as Record<string, unknown>;
    assert(
      stateAfterSettings.businessProfileVersion === 3,
      "Settings did not increment canonical version.",
    );
    assert(
      companyInfo.description === "Updated through settings." &&
        settingsData.businessType === "wellness-studio" &&
        settingsData.timezone === "Europe/Berlin",
      "Settings overlap did not synchronize onboarding data.",
    );
    assert(
      JSON.stringify(tenantAfterSettings.settings).includes("+4930123456") &&
        JSON.stringify(tenantAfterSettings.settings).includes("retained"),
      "Settings synchronization lost private or unrelated profile fields.",
    );

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { businessType: "drifted-business-type" },
    });
    await settings.updateAccount(
      context,
      {
        businessName: settingsResult.businessName,
        website: "https://current.example.test",
      },
      settingsResult.businessProfileEtag,
    );
    assert(
      (await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }))
        .businessProfileVersion === 3,
      "An effective Settings profile no-op incremented canonical version.",
    );
    assert(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).businessType ===
        "wellness-studio",
      "A Settings profile no-op did not repair unrequested Tenant drift.",
    );

    await onboarding.completeStep(context, { step: "business" });
    const transformedChannelPatch = await validateOnboarding({
      currentStep: "channels",
      data: { selectedChannels: ["telegram"] },
    });
    const updatedOnboarding = await onboarding.update(context, transformedChannelPatch);
    assert(
      updatedOnboarding.businessProfileVersion === 3,
      "Workflow-only onboarding changed the profile version.",
    );
    const channelState = await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } });
    const channelData = channelState.data as Record<string, unknown>;
    const channelCompanyInfo = channelData.companyInfo as Record<string, unknown>;
    assert(channelData.businessType === "wellness-studio", "Channel patch erased business type.");
    assert(Array.isArray(channelCompanyInfo.services), "Channel patch erased structured services.");
    assert(
      Array.isArray(channelCompanyInfo.weeklySchedule),
      "Channel patch erased the weekly schedule.",
    );
    const completed = await onboarding.completeStep(context, { step: "channels" });
    assert(
      completed.businessProfileVersion === 3,
      "Onboarding completion changed the profile version.",
    );

    let onboardingNoOpPrecondition: unknown;
    try {
      await onboarding.update(context, {
        data: { companyInfo: { name: settingsResult.businessName } },
      });
    } catch (error) {
      onboardingNoOpPrecondition = error;
    }
    assert(
      onboardingNoOpPrecondition instanceof HttpException &&
        onboardingNoOpPrecondition.getStatus() === 428,
      "An onboarding profile no-op accepted a missing If-Match.",
    );

    let invalidSchedule: unknown;
    try {
      await onboarding.update(
        context,
        {
          data: {
            companyInfo: {
              weeklySchedule: [{ day: "MON", enabled: true, opensAt: "09:00", closesAt: "09:00" }],
            },
          },
        },
        completed.businessProfileEtag,
      );
    } catch (error) {
      invalidSchedule = error;
    }
    assert(
      invalidSchedule instanceof HttpException && invalidSchedule.getStatus() === 400,
      "Onboarding accepted an enabled day without a usable time range.",
    );
    assert(
      (await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }))
        .businessProfileVersion === 3,
      "Invalid onboarding hours changed the canonical profile.",
    );

    let onboardingPrecondition: unknown;
    try {
      await onboarding.update(context, {
        data: { companyInfo: { description: "Updated through onboarding." } },
      });
    } catch (error) {
      onboardingPrecondition = error;
    }
    assert(
      onboardingPrecondition instanceof HttpException && onboardingPrecondition.getStatus() === 428,
      "Profile-affecting onboarding accepted a missing If-Match.",
    );
    const transformedCompanyPatch = await validateOnboarding({
      data: { companyInfo: { description: "Updated through onboarding." } },
    });
    const profileOnboarding = await onboarding.update(
      context,
      transformedCompanyPatch,
      completed.businessProfileEtag,
    );
    assert(
      profileOnboarding.businessProfileVersion === 4,
      "Profile-affecting onboarding did not increment the profile version.",
    );
    const profileState = await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } });
    const profileData = profileState.data as Record<string, unknown>;
    const profileCompanyInfo = profileData.companyInfo as Record<string, unknown>;
    assert(
      Array.isArray(profileCompanyInfo.services) && profileCompanyInfo.services.length === 2,
      "A transformed company text patch erased structured services.",
    );
    assert(
      Array.isArray(profileCompanyInfo.weeklySchedule) &&
        profileCompanyInfo.weeklySchedule.length === 2,
      "A transformed company text patch erased the weekly schedule.",
    );

    await onboarding.update(context, { data: { scenario: "support" } });
    await onboarding.completeStep(context, { step: "scenario" });
    await onboarding.completeStep(context, { step: "company" });
    await onboarding.update(context, { data: { crm: "none" } });
    await onboarding.completeStep(context, { step: "crm" });
    await onboarding.update(context, { data: { selectedChannels: [] } });
    let incompleteLaunch: unknown;
    try {
      await onboarding.completeStep(context, { step: "launch" });
    } catch (error) {
      incompleteLaunch = error;
    }
    assert(
      incompleteLaunch instanceof HttpException && incompleteLaunch.getStatus() === 400,
      "Launch accepted completed-step flags after required channel data was cleared.",
    );
    await onboarding.update(context, { data: { selectedChannels: ["telegram"] } });
    const firstLaunch = await onboarding.advance(context, { step: "launch", data: {} });
    const repeatedLaunch = await onboarding.advance(context, { step: "launch", data: {} });
    assert(Boolean(firstLaunch.completedAt), "Launch did not record completion time.");
    assert(
      repeatedLaunch.completedAt === firstLaunch.completedAt,
      "Repeated launch completion rewrote the original completion time.",
    );

    const finalHeaders = responseHeaders();
    const final = await controller.get(context, finalHeaders.response);
    assert(final.data.version === 4, "Final GET did not return the canonical version.");
    assert(
      finalHeaders.headers.get("etag") === final.data.etag,
      "Final GET returned a stale ETag header.",
    );

    const finalState = await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } });
    const oversizedData = finalState.data as Record<string, unknown>;
    await prisma.onboardingState.update({
      where: { tenantId },
      data: {
        data: {
          ...oversizedData,
          companyInfo: {
            ...((oversizedData.companyInfo as Record<string, unknown>) ?? {}),
            faq: "x".repeat(230 * 1024),
          },
        },
      },
    });
    let oversizedError: unknown;
    try {
      await controller.patch(
        context,
        { profile: { name: final.data.profile.name } },
        `business-profile-oversized-${suffix}`,
        final.data.etag,
        responseHeaders().response,
      );
    } catch (error) {
      oversizedError = error;
    }
    assert(
      oversizedError instanceof HttpException &&
        oversizedError.getStatus() === 400 &&
        JSON.stringify(oversizedError.getResponse()).includes("MAX_UTF8_BYTES"),
      "A save accepted an oversized full effective profile.",
    );
    assert(
      (await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }))
        .businessProfileVersion === 4,
      "An oversized profile changed the revision.",
    );

    console.log(`Business profile API smoke: ${checks}/${checks} checks passed`);
  } finally {
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
