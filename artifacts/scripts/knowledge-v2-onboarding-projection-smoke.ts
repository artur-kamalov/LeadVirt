import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { strongKnowledgeV2Etag } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { KnowledgeV2MigrationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-migration.service.js";
import { KnowledgeV2OnboardingProjectionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-onboarding-projection.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
    businessType: string | null;
    timezone: string;
  },
  user: {
    id: string;
    email: string;
    phone: string | null;
    name: string | null;
    avatarUrl: string | null;
    passwordChangeRequired: boolean;
  },
  role: RequestContext["role"] = "OWNER",
): RequestContext {
  return {
    tenantId: tenant.id,
    userId: user.id,
    role,
    authMode: "email",
    tenant,
    user,
  };
}

async function createFixture(prisma: PrismaService, userId: string, stamp: string, suffix: string) {
  const businessName = `Projection business ${suffix} ${stamp}`;
  const businessType = `Service business ${suffix}`;
  const businessDescription = `Owner-confirmed description ${suffix} ${stamp}`;
  const hours = `Monday-Friday 09:00-18:00 ${suffix} ${stamp}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: businessName,
      slug: `projection-${suffix}-${stamp}`,
      businessType,
      settings: { locale: "en" },
    },
  });
  await prisma.membership.create({
    data: { tenantId: tenant.id, userId, role: "OWNER" },
  });
  const availability = `Available now ${suffix} ${stamp}`;
  const servicesCatalog = `Service catalog ${suffix} ${stamp}`;
  const policy = `Confirm every commitment ${suffix} ${stamp}`;
  await prisma.onboardingState.create({
    data: {
      tenantId: tenant.id,
      data: {
        businessType,
        companyInfo: {
          name: businessName,
          description: businessDescription,
          hours,
          availability,
          servicesCatalog,
          policies: policy,
        },
      },
    },
  });
  return {
    tenant,
    businessName,
    businessType,
    businessDescription,
    hours,
    availability,
    servicesCatalog,
    policy,
  };
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  try {
    const [ownerUser, managerUser] = await Promise.all([
      prisma.user.create({
        data: { email: `projection-owner-${stamp}@example.test`, name: "Projection owner" },
      }),
      prisma.user.create({
        data: { email: `projection-manager-${stamp}@example.test`, name: "Projection manager" },
      }),
    ]);
    userIds.push(ownerUser.id, managerUser.id);
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const projection = new KnowledgeV2OnboardingProjectionService();

    const manualFixture = await createFixture(prisma, ownerUser.id, stamp, "manual");
    tenantIds.push(manualFixture.tenant.id);
    await prisma.membership.create({
      data: { tenantId: manualFixture.tenant.id, userId: managerUser.id, role: "MANAGER" },
    });
    const manualContext = context(manualFixture.tenant, ownerUser);
    const managerContext = context(manualFixture.tenant, managerUser, "MANAGER");
    const manualMigration = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      projection,
    );
    await manualMigration.start(manualContext, {}, `manual-start-${stamp}`);

    const manualKnowledge = new KnowledgeV2Service(prisma, idempotency);
    const catalogFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: manualFixture.tenant.id,
          factKey: "catalog/summary",
        },
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { evidence: true },
        },
      },
    });
    const catalogHead = catalogFact.versions[0]!;
    assert(
      catalogHead.displayValue === manualFixture.servicesCatalog &&
        catalogHead.riskLevel === "HIGH" &&
        catalogHead.verificationStatus === "UNVERIFIED" &&
        catalogHead.authority === "MANUAL" &&
        catalogHead.verifiedByUserId === null &&
        catalogHead.verifiedAt === null &&
        (catalogHead.scope as { audiences?: string[] } | null)?.audiences?.includes("PUBLIC") ===
          true &&
        catalogHead.evidence.length === 1 &&
        catalogHead.evidence[0]?.isPublic === true,
      "Free-text onboarding catalog was not projected as blocked HIGH/PUBLIC material.",
    );
    const ownerConfirmedFacts = await prisma.knowledgeV2Fact.findMany({
      where: {
        tenantId: manualFixture.tenant.id,
        factKey: {
          in: ["business/name", "business/type", "business/description", "business/hours-summary"],
        },
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { evidence: true },
        },
      },
    });
    const expectedOwnerConfirmedValues = new Map([
      ["business/name", manualFixture.businessName],
      ["business/type", manualFixture.businessType],
      ["business/description", manualFixture.businessDescription],
      ["business/hours-summary", manualFixture.hours],
    ]);
    assert(ownerConfirmedFacts.length === 4, "Owner onboarding facts were not projected.");
    assert(
      ownerConfirmedFacts.every((fact) => {
        const head = fact.versions[0];
        return (
          head?.displayValue === expectedOwnerConfirmedValues.get(fact.factKey) &&
          (head.riskLevel === "LOW" || head.riskLevel === "MEDIUM") &&
          head.lifecycleStatus === "DRAFT" &&
          head.verificationStatus === "VERIFIED" &&
          head.authority === "OWNER_VERIFIED" &&
          head.verifiedByUserId === ownerUser.id &&
          Boolean(head.verifiedAt) &&
          head.evidence.length === 1 &&
          (head.evidence[0]?.sourceReference as { origin?: string } | null)?.origin === "onboarding"
        );
      }),
      "Direct owner onboarding facts were not publish-eligible.",
    );
    const availabilityFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: manualFixture.tenant.id,
          factKey: "business/availability-summary",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const availabilityHead = availabilityFact.versions[0]!;
    assert(
      availabilityHead.riskLevel === "HIGH" &&
        availabilityHead.verificationStatus === "UNVERIFIED" &&
        availabilityHead.authority === "MANUAL" &&
        availabilityHead.verifiedByUserId === null &&
        availabilityHead.verifiedAt === null,
      "HIGH-risk onboarding availability bypassed explicit verification.",
    );
    let managerVerificationDenied = false;
    try {
      await manualKnowledge.verifyFact(
        managerContext,
        catalogFact.id,
        { note: "Manager must not verify free-text catalog terms." },
        `manager-catalog-verify-${stamp}`,
        [strongKnowledgeV2Etag("fact", catalogFact.id, catalogFact.etag)],
      );
    } catch (error) {
      managerVerificationDenied = error instanceof HttpException && error.getStatus() === 403;
    }
    assert(
      managerVerificationDenied &&
        (await prisma.knowledgeV2FactVersion.count({ where: { factId: catalogFact.id } })) === 1,
      "Manager verified a HIGH-risk free-text onboarding catalog.",
    );
    const onboardingBeforeRoleChange = await prisma.onboardingState.findUniqueOrThrow({
      where: { tenantId: manualFixture.tenant.id },
    });
    const roleChangePreviousData = onboardingBeforeRoleChange.data as Record<string, unknown>;
    const roleChangePreviousCompany = roleChangePreviousData.companyInfo as Record<string, unknown>;
    const managerHours = `${manualFixture.hours} manager update`;
    const managerData = {
      ...roleChangePreviousData,
      companyInfo: {
        ...roleChangePreviousCompany,
        hours: managerHours,
      },
    };
    await prisma.$transaction((tx) =>
      projection.projectInTransaction(tx, managerContext, roleChangePreviousData, managerData),
    );
    const managerHoursFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: manualFixture.tenant.id,
          factKey: "business/hours-summary",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const managerHoursHead = managerHoursFact.versions[0]!;
    assert(
      managerHoursHead.displayValue === managerHours &&
        managerHoursHead.verificationStatus === "UNVERIFIED" &&
        managerHoursHead.authority === "MANUAL" &&
        managerHoursHead.verifiedByUserId === null &&
        managerHoursHead.verifiedAt === null,
      "Manager-authored onboarding hours were unexpectedly verified.",
    );
    const ownerNameBefore = ownerConfirmedFacts.find((fact) => fact.factKey === "business/name")!;
    const ownerNameHeadBefore = ownerNameBefore.versions[0]!;
    const ownerDescription = `${manualFixture.businessDescription} owner update`;
    const ownerData = {
      ...managerData,
      companyInfo: {
        ...(managerData.companyInfo as Record<string, unknown>),
        description: ownerDescription,
      },
    };
    await prisma.$transaction((tx) =>
      projection.projectInTransaction(tx, manualContext, managerData, ownerData),
    );
    await prisma.onboardingState.update({
      where: { tenantId: manualFixture.tenant.id },
      data: { data: ownerData },
    });
    const [hoursAfterOwnerEdit, descriptionAfterOwnerEdit, nameAfterOwnerEdit] = await Promise.all([
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: { id: managerHoursFact.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      }),
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: {
          tenantId_factKey: {
            tenantId: manualFixture.tenant.id,
            factKey: "business/description",
          },
        },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      }),
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: { id: ownerNameBefore.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      }),
    ]);
    const hoursHeadAfterOwnerEdit = hoursAfterOwnerEdit.versions[0]!;
    const descriptionHeadAfterOwnerEdit = descriptionAfterOwnerEdit.versions[0]!;
    const nameHeadAfterOwnerEdit = nameAfterOwnerEdit.versions[0]!;
    assert(
      hoursAfterOwnerEdit.latestVersionNumber === managerHoursFact.latestVersionNumber &&
        hoursHeadAfterOwnerEdit.verificationStatus === "UNVERIFIED" &&
        hoursHeadAfterOwnerEdit.authority === "MANUAL" &&
        hoursHeadAfterOwnerEdit.verifiedByUserId === null &&
        hoursHeadAfterOwnerEdit.verifiedAt === null,
      "An owner edit verified unchanged manager-authored onboarding hours.",
    );
    assert(
      descriptionHeadAfterOwnerEdit.displayValue === ownerDescription &&
        descriptionHeadAfterOwnerEdit.verificationStatus === "VERIFIED" &&
        descriptionHeadAfterOwnerEdit.authority === "OWNER_VERIFIED" &&
        descriptionHeadAfterOwnerEdit.verifiedByUserId === ownerUser.id &&
        Boolean(descriptionHeadAfterOwnerEdit.verifiedAt),
      "The directly changed owner onboarding description was not verified.",
    );
    assert(
      nameAfterOwnerEdit.latestVersionNumber === ownerNameBefore.latestVersionNumber &&
        nameHeadAfterOwnerEdit.verificationStatus === "VERIFIED" &&
        nameHeadAfterOwnerEdit.authority === "OWNER_VERIFIED" &&
        nameHeadAfterOwnerEdit.verifiedByUserId === ownerNameHeadBefore.verifiedByUserId &&
        nameHeadAfterOwnerEdit.verifiedAt?.toISOString() ===
          ownerNameHeadBefore.verifiedAt?.toISOString(),
      "An unrelated owner edit replaced an unchanged verified onboarding fact.",
    );
    const initialFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: manualFixture.tenant.id,
          factKey: "business/availability-summary",
        },
      },
    });
    const initialRule = await prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
      where: {
        tenantId_ruleKey: {
          tenantId: manualFixture.tenant.id,
          ruleKey: "onboarding/policy",
        },
      },
    });
    await manualKnowledge.updateFact(
      manualContext,
      initialFact.id,
      {
        normalizedValue: manualFixture.availability,
        displayValue: manualFixture.availability,
        scope: { audiences: ["PUBLIC"], locales: ["en"] },
        riskLevel: "LOW",
        changeReason: "Owner controls availability policy.",
      },
      `manual-fact-${stamp}`,
      [strongKnowledgeV2Etag("fact", initialFact.id, initialFact.etag)],
    );
    await manualKnowledge.updateGuidanceRule(
      manualContext,
      initialRule.id,
      {
        instruction: manualFixture.policy,
        condition: {
          kind: "PREDICATE",
          field: "CHANNEL",
          operator: "EQUALS",
          value: "TELEGRAM",
        },
        priority: 900,
        scope: { audiences: ["INTERNAL"], locales: ["en"] },
        riskLevel: "HIGH",
        requiredApproverRole: "OWNER",
        changeReason: "Owner controls response policy.",
      },
      `manual-rule-${stamp}`,
      [strongKnowledgeV2Etag("guidance-rule", initialRule.id, initialRule.etag)],
    );

    const manualEventCount = await prisma.knowledgeOutbox.count({
      where: {
        tenantId: manualFixture.tenant.id,
        eventType: "knowledge.v2.content-reconciliation.requested",
      },
    });
    await manualMigration.start(manualContext, {}, `manual-reconcile-${stamp}`);
    const [protectedFact, protectedRule, factReview, ruleReview, protectedSettings] =
      await Promise.all([
        prisma.knowledgeV2Fact.findUniqueOrThrow({
          where: { id: initialFact.id },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { evidence: true },
            },
          },
        }),
        prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
          where: { id: initialRule.id },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: { evidence: true },
            },
          },
        }),
        prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
          where: {
            tenantId_reviewKey: {
              tenantId: manualFixture.tenant.id,
              reviewKey: ["onboarding-projection-v1", "ownership", "FACT", initialFact.id].join(
                ":",
              ),
            },
          },
        }),
        prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
          where: {
            tenantId_reviewKey: {
              tenantId: manualFixture.tenant.id,
              reviewKey: [
                "onboarding-projection-v1",
                "ownership",
                "GUIDANCE_RULE",
                initialRule.id,
              ].join(":"),
            },
          },
        }),
        prisma.knowledgeV2Settings.findUniqueOrThrow({
          where: { tenantId: manualFixture.tenant.id },
        }),
      ]);
    assert(
      protectedFact.latestVersionNumber === 2 &&
        protectedFact.versions[0]?.displayValue === manualFixture.availability &&
        protectedFact.versions[0].riskLevel === "LOW" &&
        protectedFact.versions[0].evidence.some(
          (item) =>
            (item.sourceReference as { origin?: string } | null)?.origin === "knowledge_editor",
        ),
      "Same-text onboarding projection replaced the editor-owned fact policy.",
    );
    assert(
      protectedRule.latestVersionNumber === 2 &&
        protectedRule.versions[0]?.instruction === manualFixture.policy &&
        protectedRule.versions[0].priority === 900 &&
        protectedRule.versions[0].evidence.some(
          (item) =>
            (item.sourceReference as { origin?: string } | null)?.origin === "knowledge_editor",
        ),
      "Same-text onboarding projection replaced the editor-owned guidance policy.",
    );
    assert(
      factReview.status === "OPEN" &&
        ruleReview.status === "OPEN" &&
        factReview.reason === "CONFLICTING_VALUES" &&
        ruleReview.reason === "CONFLICTING_VALUES",
      "Editor-owned material differences did not create ownership review work.",
    );
    assert(
      (await prisma.knowledgeOutbox.count({
        where: {
          tenantId: manualFixture.tenant.id,
          eventType: "knowledge.v2.content-reconciliation.requested",
        },
      })) === manualEventCount,
      "Ownership reconciliation enqueued onboarding successors.",
    );

    await manualMigration.start(manualContext, {}, `manual-idempotent-${stamp}`);
    const [manualSettingsAfterReplay, manualVersionsAfterReplay] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: manualFixture.tenant.id },
      }),
      Promise.all([
        prisma.knowledgeV2FactVersion.count({ where: { factId: initialFact.id } }),
        prisma.knowledgeV2GuidanceRuleVersion.count({ where: { guidanceRuleId: initialRule.id } }),
      ]),
    ]);
    assert(
      manualSettingsAfterReplay.draftGeneration === protectedSettings.draftGeneration &&
        manualVersionsAfterReplay[0] === 2 &&
        manualVersionsAfterReplay[1] === 2,
      "Identical migration reconciliation duplicated ownership work.",
    );

    const staleFixture = await createFixture(prisma, ownerUser.id, stamp, "stale");
    tenantIds.push(staleFixture.tenant.id);
    const staleContext = context(staleFixture.tenant, ownerUser);
    const staleMigration = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      projection,
    );
    await staleMigration.start(staleContext, {}, `stale-start-${stamp}`);
    const staleFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: staleFixture.tenant.id,
          factKey: "business/availability-summary",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const staleRule = await prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
      where: {
        tenantId_ruleKey: {
          tenantId: staleFixture.tenant.id,
          ruleKey: "onboarding/policy",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const staleFactHead = staleFact.versions[0]!;
    const staleRuleHead = staleRule.versions[0]!;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.knowledgeV2FactVersion.update({
        where: { id: staleFactHead.id },
        data: {
          scope: { audiences: ["PUBLIC"], locales: ["en"] },
          riskLevel: "LOW",
        },
      });
      await tx.knowledgeV2Evidence.updateMany({
        where: { factVersionId: staleFactHead.id },
        data: { isPublic: true },
      });
      await tx.knowledgeV2GuidanceRuleVersion.update({
        where: { id: staleRuleHead.id },
        data: {
          conditionAst: {
            kind: "PREDICATE",
            field: "CHANNEL",
            operator: "EQUALS",
            value: "EMAIL",
          },
          priority: 999,
          scope: { audiences: ["INTERNAL"], locales: ["en"] },
          riskLevel: "HIGH",
          requiredApproverRole: "OWNER",
        },
      });
      await tx.knowledgeV2Evidence.updateMany({
        where: { guidanceRuleVersionId: staleRuleHead.id },
        data: { isPublic: false },
      });
    });

    await staleMigration.start(staleContext, {}, `stale-repair-${stamp}`);
    const [repairedFact, repairedRule, repairedSettings] = await Promise.all([
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: { id: staleFact.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { evidence: true },
          },
        },
      }),
      prisma.knowledgeV2GuidanceRule.findUniqueOrThrow({
        where: { id: staleRule.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { evidence: true },
          },
        },
      }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: staleFixture.tenant.id },
      }),
    ]);
    const repairedFactHead = repairedFact.versions[0]!;
    const repairedRuleHead = repairedRule.versions[0]!;
    assert(
      repairedFact.latestVersionNumber === 2 &&
        repairedFactHead.supersedesVersionId === staleFactHead.id &&
        repairedFactHead.displayValue === staleFixture.availability &&
        repairedFactHead.riskLevel === "HIGH" &&
        (repairedFactHead.scope as { audiences?: string[] } | null)?.audiences?.includes(
          "INTERNAL",
        ) === true &&
        repairedFactHead.evidence.length === 1 &&
        repairedFactHead.evidence[0]?.isPublic === false,
      "Identical-data migration start did not repair stale onboarding fact policy.",
    );
    assert(
      repairedRule.latestVersionNumber === 2 &&
        repairedRuleHead.supersedesVersionId === staleRuleHead.id &&
        repairedRuleHead.instruction === staleFixture.policy &&
        repairedRuleHead.priority === 100 &&
        repairedRuleHead.riskLevel === "MEDIUM" &&
        repairedRuleHead.requiredApproverRole === "ADMIN" &&
        (repairedRuleHead.conditionAst as { kind?: string }).kind === "ALL" &&
        (repairedRuleHead.scope as { audiences?: string[] } | null)?.audiences?.includes(
          "PUBLIC",
        ) === true &&
        repairedRuleHead.evidence.length === 1 &&
        repairedRuleHead.evidence[0]?.isPublic === true,
      "Identical-data migration start did not repair stale onboarding guidance policy.",
    );

    await staleMigration.start(staleContext, {}, `stale-idempotent-${stamp}`);
    const [staleSettingsAfterReplay, repairedFactVersionCount, repairedRuleVersionCount] =
      await Promise.all([
        prisma.knowledgeV2Settings.findUniqueOrThrow({
          where: { tenantId: staleFixture.tenant.id },
        }),
        prisma.knowledgeV2FactVersion.count({ where: { factId: staleFact.id } }),
        prisma.knowledgeV2GuidanceRuleVersion.count({ where: { guidanceRuleId: staleRule.id } }),
      ]);
    assert(
      staleSettingsAfterReplay.draftGeneration === repairedSettings.draftGeneration &&
        repairedFactVersionCount === 2 &&
        repairedRuleVersionCount === 2,
      "Already-current onboarding heads were not idempotent.",
    );

    const verifiedHighFixture = await createFixture(prisma, ownerUser.id, stamp, "verified-high");
    tenantIds.push(verifiedHighFixture.tenant.id);
    const verifiedHighContext = context(verifiedHighFixture.tenant, ownerUser);
    const verifiedHighMigration = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      projection,
    );
    await verifiedHighMigration.start(verifiedHighContext, {}, `verified-high-start-${stamp}`);
    const verifiedHighKnowledge = new KnowledgeV2Service(prisma, idempotency);
    const highFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: verifiedHighFixture.tenant.id,
          factKey: "business/availability-summary",
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const expiredAt = new Date(Date.now() - 60_000);
    const highUpdate = await verifiedHighKnowledge.updateFact(
      verifiedHighContext,
      highFact.id,
      {
        normalizedValue: verifiedHighFixture.availability,
        displayValue: verifiedHighFixture.availability,
        scope: {
          brandIds: [],
          locationIds: [],
          channelTypes: [],
          assistantIds: [],
          audiences: ["INTERNAL"],
          segments: [],
          locales: ["en"],
        },
        effectiveUntil: expiredAt.toISOString(),
        riskLevel: "HIGH",
        changeReason: "Owner sets an explicit availability window.",
      },
      `verified-high-window-${stamp}`,
      [strongKnowledgeV2Etag("fact", highFact.id, highFact.etag)],
    );
    const highVerification = await verifiedHighKnowledge.verifyFact(
      verifiedHighContext,
      highFact.id,
      { note: "Owner confirms availability." },
      `verified-high-confirm-${stamp}`,
      [highUpdate.resource.etag],
    );
    const onboarding = await prisma.onboardingState.findUniqueOrThrow({
      where: { tenantId: verifiedHighFixture.tenant.id },
    });
    const previousData = onboarding.data as Record<string, unknown>;
    const previousCompany = previousData.companyInfo as Record<string, unknown>;
    await prisma.$transaction((tx) =>
      projection.projectInTransaction(tx, verifiedHighContext, previousData, {
        ...previousData,
        companyInfo: {
          ...previousCompany,
          description: `${verifiedHighFixture.businessDescription} updated`,
        },
      }),
    );
    const preservedHighFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: { id: highFact.id },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const preservedHighHead = preservedHighFact.versions[0]!;
    assert(
      preservedHighFact.latestVersionNumber === highVerification.resource.version &&
        preservedHighHead.verificationStatus === "VERIFIED" &&
        preservedHighHead.authority === "OWNER_VERIFIED" &&
        preservedHighHead.verifiedByUserId === ownerUser.id &&
        preservedHighHead.effectiveUntil?.toISOString() === expiredAt.toISOString() &&
        preservedHighHead.effectiveUntil < new Date() &&
        (await prisma.knowledgeV2ReviewItem.count({
          where: {
            tenantId: verifiedHighFixture.tenant.id,
            factId: highFact.id,
            status: "OPEN",
          },
        })) === 0,
      "An unrelated onboarding sync replaced or renewed an unchanged HIGH-risk verification.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        manualOwnershipReviews: 2,
        repairedOnboardingHeads: 2,
        unchangedManagerFactRemainedUnverified: true,
        unchangedOwnerVerificationPreserved: true,
        preservedExpiredHighRiskVerification: true,
        manualDraftGeneration: manualSettingsAfterReplay.draftGeneration,
        repairedDraftGeneration: staleSettingsAfterReplay.draftGeneration,
      }),
    );
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
