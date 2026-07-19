import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { hashKnowledgeValue } from "@leadvirt/knowledge";
import { prisma, type Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import { KnowledgeV2OnboardingProjectionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-onboarding-projection.service.js";
import { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import { OnboardingService } from "../../apps/api/src/modules/onboarding/onboarding.service.js";

loadEnvFile();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

class TestDispatcher {
  readonly dispatched: string[] = [];
  failNext = false;

  async createEvent(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      actorUserId?: string | null;
      reason: string;
      stateParts: Array<string | number>;
    },
  ) {
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
  }

  async dispatch(eventId: string) {
    const event = await prisma.knowledgeOutbox.findUnique({ where: { id: eventId } });
    assert(event?.status === "PENDING", "Dispatch ran before its transaction committed.");
    this.dispatched.push(eventId);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated post-commit dispatch failure");
    }
    return { accepted: true };
  }
}

class TestContentReconciliation {
  readonly dispatched: string[] = [];

  async dispatch(eventId: string) {
    const event = await prisma.knowledgeOutbox.findUnique({ where: { id: eventId } });
    assert(event?.status === "PENDING", "Structured dispatch ran before commit.");
    this.dispatched.push(eventId);
  }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dispatcher = new TestDispatcher();
  let tenantId: string | null = null;
  let userId: string | null = null;
  let advanceTenantId: string | null = null;
  let advanceUserId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: { email: `onboarding-atomic-${suffix}@example.test`, name: "Atomic Owner" },
    });
    userId = user.id;
    const tenant = await prisma.tenant.create({
      data: { name: "Original name", slug: `onboarding-atomic-${suffix}`, timezone: "UTC" },
    });
    tenantId = tenant.id;
    await prisma.membership.create({
      data: { tenantId, userId, role: "OWNER" },
    });
    await prisma.knowledgeV2Settings.create({ data: { tenantId } });
    await prisma.knowledgeCorpusSelector.create({
      data: { tenantId, corpusKind: "LEGACY_V1", selectedByUserId: userId },
    });

    const context: RequestContext = {
      tenantId,
      userId,
      role: "OWNER",
      authMode: "credentials",
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
    const contentReconciliation = new TestContentReconciliation();
    const knowledge = new KnowledgeService(
      prisma as never,
      { ragRetrievalMode: "database" } as never,
      {} as never,
      dispatcher as never,
      new KnowledgeV2OnboardingProjectionService(),
      contentReconciliation as never,
    );
    const businessProfile = new BusinessProfileService(prisma as never, knowledge, {} as never);
    const onboarding = new OnboardingService(prisma as never, businessProfile);

    const initialState = await onboarding.state(context);
    const workflowUpdated = await onboarding.update(context, {
      currentStep: "channels",
      data: { selectedChannels: ["telegram"], crm: "none" },
    });
    const [workflowState, workflowSourceCount, workflowOutboxCount] = await Promise.all([
      prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }),
      prisma.businessKnowledgeSource.count({ where: { tenantId, deletedAt: null } }),
      prisma.knowledgeOutbox.count({ where: { tenantId } }),
    ]);
    const workflowData = workflowState.data as Record<string, unknown>;
    assert(workflowUpdated.businessProfileVersion === 1, "Workflow changed profile revision.");
    assert(
      workflowSourceCount === 0 && workflowOutboxCount === 0,
      "Workflow-only onboarding synchronized profile knowledge.",
    );
    assert(
      !Object.prototype.hasOwnProperty.call(workflowData, "companyInfo") &&
        !Object.prototype.hasOwnProperty.call(workflowData, "timezone"),
      "Workflow-only onboarding materialized the profile.",
    );

    const scenarioUpdated = await onboarding.update(context, {
      currentStep: "scenario",
      data: { scenario: "lead-qualification" },
    });
    const [scenarioState, scenarioSource] = await Promise.all([
      prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }),
      prisma.businessKnowledgeSource.findUniqueOrThrow({
        where: { tenantId_sourceKey: { tenantId, sourceKey: "onboarding:business_profile" } },
      }),
    ]);
    const scenarioData = scenarioState.data as Record<string, unknown>;
    assert(scenarioUpdated.businessProfileVersion === 1, "Scenario changed profile revision.");
    assert(
      record(scenarioData.companyInfo).name === "Original name" && scenarioData.timezone === "UTC",
      "Scenario sync did not materialize the fallback profile.",
    );
    assert(
      scenarioSource.content.includes("Original name"),
      "Scenario sync projected a sparse profile without fallback identity.",
    );
    const businessUpdated = await onboarding.update(
      context,
      {
        currentStep: "channels",
        data: { businessType: "beauty" },
      },
      scenarioUpdated.businessProfileEtag,
    );
    const companyUpdated = await onboarding.update(
      context,
      {
        currentStep: "company",
        data: { companyInfo: { name: "Atomic Business" } },
      },
      businessUpdated.businessProfileEtag,
    );

    const [
      state,
      updatedTenant,
      sources,
      auditCount,
      outboxCount,
      structuredFactCount,
      structuredGuidanceCount,
      structuredEventCount,
    ] = await Promise.all([
      prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } }),
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.businessKnowledgeSource.findMany({ where: { tenantId, deletedAt: null } }),
      prisma.auditLog.count({ where: { tenantId } }),
      prisma.knowledgeOutbox.count({ where: { tenantId } }),
      prisma.knowledgeV2Fact.count({ where: { tenantId } }),
      prisma.knowledgeV2GuidanceRule.count({ where: { tenantId } }),
      prisma.knowledgeOutbox.count({
        where: { tenantId, eventType: "knowledge.v2.content-reconciliation.requested" },
      }),
    ]);
    const data = state.data as Record<string, unknown>;
    assert(data.businessType === "beauty", "An onboarding patch was lost.");
    assert(
      (data.companyInfo as Record<string, unknown>)?.name === "Atomic Business",
      "The serialized onboarding merge lost company information.",
    );
    assert(updatedTenant.name === "Atomic Business", "Tenant identity did not commit atomically.");
    assert(
      state.businessProfileVersion === 3 &&
        companyUpdated.businessProfileVersion === state.businessProfileVersion,
      "Profile revisions did not advance exactly once per canonical change.",
    );
    assert(
      updatedTenant.businessType === "beauty",
      "Tenant business type did not commit atomically.",
    );
    assert(
      sources.some(
        (source) =>
          source.sourceKey === "onboarding:business_profile" &&
          source.content.includes("Atomic Business") &&
          source.content.includes("beauty"),
      ),
      "The onboarding knowledge projection is incomplete.",
    );
    assert(auditCount >= 4, "Atomic onboarding and knowledge audits are missing.");
    assert(outboxCount >= 2, "Atomic onboarding publication outbox events are missing.");
    assert(dispatcher.dispatched.length === 3, "Committed onboarding events were not dispatched.");
    assert(structuredFactCount === 0, "Legacy onboarding unexpectedly created structured facts.");
    assert(
      structuredGuidanceCount === 0,
      "Legacy onboarding unexpectedly created structured guidance.",
    );
    assert(structuredEventCount === 0, "Legacy onboarding queued structured reconciliation.");
    assert(contentReconciliation.dispatched.length === 0, "Legacy onboarding dispatched v2 work.");

    const stateBeforeRollback = state.currentStep;
    const dispatchesBeforeRollback = dispatcher.dispatched.length;
    const invalidContext = { ...context, userId: randomUUID() };
    let rejected = false;
    try {
      await onboarding.update(invalidContext, { currentStep: "must-not-commit", data: {} });
    } catch {
      rejected = true;
    }
    assert(rejected, "The late audit failure did not reject the onboarding mutation.");
    const rolledBackState = await prisma.onboardingState.findUniqueOrThrow({ where: { tenantId } });
    assert(
      rolledBackState.currentStep === stateBeforeRollback,
      "Onboarding state survived a transaction rollback.",
    );
    assert(
      dispatcher.dispatched.length === dispatchesBeforeRollback,
      "A rolled-back onboarding event was dispatched.",
    );

    rejected = false;
    try {
      await onboarding.update(
        invalidContext,
        {
          data: { companyInfo: { name: "Must Roll Back" } },
        },
        companyUpdated.businessProfileEtag,
      );
    } catch {
      rejected = true;
    }
    assert(rejected, "The knowledge-audit failure did not reject the onboarding mutation.");
    const [tenantAfterRollback, sourceAfterRollback] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.businessKnowledgeSource.findUniqueOrThrow({
        where: { tenantId_sourceKey: { tenantId, sourceKey: "onboarding:business_profile" } },
      }),
    ]);
    assert(tenantAfterRollback.name === "Atomic Business", "Tenant identity escaped rollback.");
    assert(!sourceAfterRollback.content.includes("Must Roll Back"), "Knowledge escaped rollback.");

    dispatcher.failNext = true;
    const committedDespiteDispatchFailure = await onboarding.update(
      context,
      { data: { companyInfo: { description: "Committed before dispatch." } } },
      companyUpdated.businessProfileEtag,
    );
    const failedDispatchEventId = dispatcher.dispatched.at(-1);
    const failedDispatchEvent = failedDispatchEventId
      ? await prisma.knowledgeOutbox.findUnique({ where: { id: failedDispatchEventId } })
      : null;
    assert(
      committedDespiteDispatchFailure.businessProfileVersion === 4,
      "A post-commit dispatch failure turned a committed save into a failed response.",
    );
    assert(
      failedDispatchEvent?.status === "PENDING",
      "The durable outbox event was not left pending for retry.",
    );

    const advanceUser = await prisma.user.create({
      data: { email: `onboarding-advance-${suffix}@example.test`, name: "Advance Owner" },
    });
    advanceUserId = advanceUser.id;
    const advanceTenant = await prisma.tenant.create({
      data: { name: "Advance Business", slug: `onboarding-advance-${suffix}`, timezone: "UTC" },
    });
    advanceTenantId = advanceTenant.id;
    await prisma.membership.create({
      data: { tenantId: advanceTenant.id, userId: advanceUser.id, role: "OWNER" },
    });
    await prisma.knowledgeV2Settings.create({ data: { tenantId: advanceTenant.id } });
    await prisma.knowledgeCorpusSelector.create({
      data: {
        tenantId: advanceTenant.id,
        corpusKind: "LEGACY_V1",
        selectedByUserId: advanceUser.id,
      },
    });
    const advanceContext: RequestContext = {
      tenantId: advanceTenant.id,
      userId: advanceUser.id,
      role: "OWNER",
      authMode: "credentials",
      tenant: {
        id: advanceTenant.id,
        name: advanceTenant.name,
        slug: advanceTenant.slug,
        status: advanceTenant.status,
        businessType: advanceTenant.businessType,
        timezone: advanceTenant.timezone,
      },
      user: {
        id: advanceUser.id,
        email: advanceUser.email,
        phone: advanceUser.phone,
        name: advanceUser.name,
        avatarUrl: advanceUser.avatarUrl,
        passwordChangeRequired: advanceUser.passwordChangeRequired,
      },
    };
    const advanceInitial = await onboarding.state(advanceContext);
    const business = await onboarding.advance(
      advanceContext,
      { step: "business", data: { businessType: "services" } },
      advanceInitial.businessProfileEtag,
    );
    const channels = await onboarding.advance(advanceContext, {
      step: "channels",
      data: { selectedChannels: ["telegram", "website"] },
    });
    const scenario = await onboarding.advance(advanceContext, {
      step: "scenario",
      data: { scenario: "consult" },
    });
    const company = await onboarding.advance(
      advanceContext,
      {
        step: "company",
        data: {
          companyInfo: {
            name: "Advance Business",
            description: "Atomic advance path coverage.",
          },
          timezone: "Europe/Paris",
        },
      },
      scenario.businessProfileEtag,
    );
    const crm = await onboarding.advance(advanceContext, {
      step: "crm",
      data: { crm: "none" },
    });
    const launched = await onboarding.advance(advanceContext, { step: "launch", data: {} });
    const replayed = await onboarding.advance(advanceContext, {
      step: "scenario",
      data: { scenario: "support" },
    });
    assert(business.currentStep === "channels", "Business advance did not navigate to channels.");
    assert(channels.currentStep === "scenario", "Channel advance did not navigate to scenario.");
    assert(scenario.currentStep === "company", "Scenario advance did not navigate to company.");
    assert(company.currentStep === "crm", "Company advance did not navigate to CRM.");
    assert(crm.currentStep === "launch", "CRM advance did not navigate to launch.");
    assert(
      launched.currentStep === "launch" && launched.completedAt !== null,
      "Launch advance did not complete onboarding.",
    );
    assert(
      JSON.stringify(launched.completedSteps) ===
        JSON.stringify(["business", "channels", "scenario", "company", "crm", "launch"]),
      "Atomic advance did not complete all steps in order.",
    );
    assert(
      replayed.currentStep === "launch" && replayed.completedAt === launched.completedAt,
      "An older-step replay regressed or recompleted onboarding.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        assertions: 36,
        sources: sources.length,
        audits: auditCount,
        outboxEvents: outboxCount,
      }),
    );
  } finally {
    if (advanceTenantId)
      await prisma.tenant.delete({ where: { id: advanceTenantId } }).catch(() => undefined);
    if (advanceUserId)
      await prisma.user.delete({ where: { id: advanceUserId } }).catch(() => undefined);
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
