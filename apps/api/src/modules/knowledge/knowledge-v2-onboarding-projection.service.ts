import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { enqueueKnowledgeV2ContentReconciliation } from "./knowledge-v2-content-reconciliation.service.js";
import { canonicalKnowledgeV2Hash } from "./knowledge-v2-http.js";
import {
  onboardingKnowledgeInput,
  type OnboardingKnowledgeInput,
} from "./onboarding-knowledge-input.js";

const factInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    include: { evidence: true },
  },
} satisfies Prisma.KnowledgeV2FactInclude;

const guidanceInclude = {
  versions: {
    orderBy: { versionNumber: "desc" },
    take: 1,
    include: { evidence: true },
  },
} satisfies Prisma.KnowledgeV2GuidanceRuleInclude;

type FactRecord = Prisma.KnowledgeV2FactGetPayload<{ include: typeof factInclude }>;
type FactVersion = FactRecord["versions"][number];
type GuidanceRecord = Prisma.KnowledgeV2GuidanceRuleGetPayload<{
  include: typeof guidanceInclude;
}>;
type GuidanceVersion = GuidanceRecord["versions"][number];
type Evidence = FactVersion["evidence"][number];
type OnboardingKnowledgeStringKey = {
  [Key in keyof OnboardingKnowledgeInput]: OnboardingKnowledgeInput[Key] extends string
    ? Key
    : never;
}[keyof OnboardingKnowledgeInput];

interface FactSpec {
  semanticKey: OnboardingKnowledgeStringKey;
  factKey: string;
  entityType: "BUSINESS_PROFILE" | "CATALOG";
  audience: "PUBLIC" | "INTERNAL";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  locator: string;
  value: string;
}

interface GuidanceSpec {
  semanticKey: OnboardingKnowledgeStringKey;
  ruleKey: string;
  title: string;
  ruleType: "RESPONSE" | "ESCALATION";
  audience: "PUBLIC" | "INTERNAL";
  riskLevel: "MEDIUM" | "HIGH";
  requiredApproverRole: "ADMIN" | "OWNER";
  priority: number;
  locator: string;
  value: string;
}

interface ProjectionEvidence {
  id: string;
  kind: "MANUAL";
  legacyRevisionId: null;
  label: string;
  locator: string;
  isPublic: boolean;
  sourceReference: Prisma.InputJsonObject;
  elementReference: null;
  quoteHash: string;
  confidence: null;
  metadata: Prisma.InputJsonObject;
  createdByUserId: string;
}

type PendingReconciliation = {
  resourceType: "FACT" | "GUIDANCE_RULE";
  resourceId: string;
  resourceGeneration: number;
  versionId: string;
  versionNumber: number;
  versionHash: string;
  action: "CREATE" | "UPDATE" | "VERIFY" | "DISABLE";
  semanticKey: string;
  sourceValueHash: string;
};

type OwnershipConflict = {
  kind: "OWNERSHIP_CONFLICT";
  semanticKey: string;
  resourceType: "FACT" | "GUIDANCE_RULE";
  resourceId: string;
  reviewId: string;
  sourceValueHash: string;
};

type ProjectionChange = { kind: "RECONCILIATION"; item: PendingReconciliation } | OwnershipConflict;

interface FactMaterial {
  normalizedValue: Prisma.JsonValue;
  displayValue: string | null;
  localizedValues: Prisma.JsonValue | null;
  unit: string | null;
  currency: string | null;
  timeZone: string | null;
  locale: string;
  localeBehavior: FactVersion["localeBehavior"];
  scope: Prisma.JsonValue | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  riskLevel: FactVersion["riskLevel"];
  authority: FactVersion["authority"];
  extractionConfidence: number | null;
  extractionModelVersion: string | null;
}

interface GuidanceMaterial {
  title: string;
  ruleType: GuidanceVersion["ruleType"];
  condition: Prisma.JsonValue;
  instruction: string;
  outcome: Prisma.JsonValue | null;
  priority: number;
  tieBreakPolicy: string;
  tieBreakKey: string;
  scope: Prisma.JsonValue | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  riskLevel: GuidanceVersion["riskLevel"];
  requiredApproverRole: GuidanceVersion["requiredApproverRole"];
  examples: Prisma.JsonValue | null;
}

@Injectable()
export class KnowledgeV2OnboardingProjectionService {
  async projectInTransaction(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    previousData: Record<string, unknown>,
    nextData: Record<string, unknown>,
  ) {
    const selector = await tx.knowledgeCorpusSelector.findUnique({
      where: { tenantId: context.tenantId },
      select: { corpusKind: true },
    });
    const structured = selector?.corpusKind === "STRUCTURED_V2";
    const migrationEnabled = structured
      ? null
      : await tx.knowledgeV2LegacyMigration.findFirst({
          where: { tenantId: context.tenantId },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        });
    if (!structured && !migrationEnabled) {
      return { structured: false, changed: 0, eventIds: [] as string[] };
    }

    await tx.knowledgeV2Settings.upsert({
      where: { tenantId: context.tenantId },
      create: { tenantId: context.tenantId },
      update: {},
    });
    await tx.$queryRaw<Array<{ tenantId: string }>>(Prisma.sql`
      SELECT "tenantId"
      FROM "KnowledgeV2Settings"
      WHERE "tenantId" = ${context.tenantId}
      FOR UPDATE
    `);
    const settings = await tx.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: context.tenantId },
    });
    const previous = onboardingKnowledgeInput(previousData);
    const next = onboardingKnowledgeInput(nextData);
    const changes: ProjectionChange[] = [];

    for (const spec of this.factSpecs(next)) {
      const fieldChanged =
        this.valueHash(previous[spec.semanticKey]) !== this.valueHash(spec.value);
      const projected = await this.projectFact(
        tx,
        context,
        settings.defaultLocale,
        spec,
        fieldChanged,
      );
      if (projected) changes.push(projected);
    }
    for (const spec of this.guidanceSpecs(next)) {
      const fieldChanged =
        this.valueHash(previous[spec.semanticKey]) !== this.valueHash(spec.value);
      const projected = await this.projectGuidance(
        tx,
        context,
        settings.defaultLocale,
        spec,
        fieldChanged,
      );
      if (projected) changes.push(projected);
    }

    if (changes.length === 0) {
      return { structured, changed: 0, eventIds: [] as string[] };
    }
    const pending = changes.flatMap((change) =>
      change.kind === "RECONCILIATION" ? [change.item] : [],
    );
    const ownershipConflicts = changes.filter(
      (change): change is OwnershipConflict => change.kind === "OWNERSHIP_CONFLICT",
    );
    const updatedSettings = await tx.knowledgeV2Settings.update({
      where: { tenantId: context.tenantId },
      data: { draftGeneration: { increment: 1 } },
      select: { draftGeneration: true },
    });
    const eventIds: string[] = [];
    for (const item of pending) {
      const queued = await enqueueKnowledgeV2ContentReconciliation(tx, {
        tenantId: context.tenantId,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        resourceGeneration: item.resourceGeneration,
        versionId: item.versionId,
        versionNumber: item.versionNumber,
        versionHash: item.versionHash,
        draftGeneration: updatedSettings.draftGeneration,
        action: item.action,
        actorUserId: context.userId,
        requestedRole: context.role,
        mutationIdempotencyKey: [
          "onboarding-projection-v1",
          item.semanticKey,
          item.sourceValueHash,
          item.versionId,
        ].join(":"),
      });
      eventIds.push(queued.event.id);
    }
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "knowledge.v2.onboarding_projected",
        entityType: "knowledge_v2",
        entityId: context.tenantId,
        payload: {
          projectionVersion: 1,
          draftGeneration: updatedSettings.draftGeneration,
          count: changes.length,
          reconciliationCount: pending.length,
          ownershipConflictCount: ownershipConflicts.length,
          semanticKeys: changes.map((item) =>
            item.kind === "RECONCILIATION" ? item.item.semanticKey : item.semanticKey,
          ),
        },
      },
    });
    return { structured, changed: changes.length, eventIds };
  }

  private async projectFact(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    locale: string,
    spec: FactSpec,
    fieldChanged: boolean,
  ): Promise<ProjectionChange | null> {
    const existing = await tx.knowledgeV2Fact.findUnique({
      where: { tenantId_factKey: { tenantId: context.tenantId, factKey: spec.factKey } },
      include: factInclude,
    });
    if (!existing && !spec.value) return null;
    if (existing?.deletedAt && !spec.value) return null;

    const previous = existing?.versions[0] ?? null;
    if (existing && (!previous || previous.versionNumber !== existing.latestVersionNumber)) {
      throw new Error("KNOWLEDGE_DEPENDENCY_ONBOARDING_FACT_HEAD_INVALID");
    }
    const archived = !spec.value;
    const baseMaterial = archived
      ? this.factMaterialFromVersion(previous!)
      : this.factMaterial(spec.value, locale, spec.audience, spec.riskLevel);
    const directOwnerVerification =
      !archived &&
      (fieldChanged || !existing) &&
      (context.role === "OWNER" || context.role === "ADMIN") &&
      (baseMaterial.riskLevel === "LOW" || baseMaterial.riskLevel === "MEDIUM");
    const preservesOwnerVerification =
      !archived &&
      previous?.verificationStatus === "VERIFIED" &&
      previous.authority === "OWNER_VERIFIED" &&
      Boolean(previous.verifiedByUserId) &&
      Boolean(previous.verifiedAt) &&
      this.factMaterialContentHash(previous) === this.factMaterialContentHash(baseMaterial);
    const ownerVerified = directOwnerVerification || preservesOwnerVerification;
    const material: FactMaterial = {
      ...baseMaterial,
      ...(preservesOwnerVerification
        ? {
            effectiveFrom: previous.effectiveFrom,
            effectiveUntil: previous.effectiveUntil,
          }
        : {}),
      authority: ownerVerified ? "OWNER_VERIFIED" : baseMaterial.authority,
    };
    if (existing) {
      const materialIsCurrent =
        existing.deletedAt === null &&
        existing.entityType === spec.entityType &&
        existing.fieldType === "TEXT" &&
        (archived
          ? previous!.lifecycleStatus === "ARCHIVED"
          : previous!.lifecycleStatus !== "ARCHIVED" &&
            this.factMaterialHash(previous!) === this.factMaterialHash(material));
      if (!this.onboardingOwnsHead(previous!, spec.semanticKey)) {
        if (materialIsCurrent) return null;
        return this.recordOwnershipConflict(tx, context, {
          resourceType: "FACT",
          resourceId: existing.id,
          semanticKey: spec.semanticKey,
          sourceValue: spec.value,
          riskLevel: "HIGH",
          reopen: fieldChanged,
        });
      }
      if (materialIsCurrent && this.projectionEvidenceIsCurrent(previous!, spec, locale)) {
        return null;
      }
    }

    const versionNumber = (existing?.latestVersionNumber ?? 0) + 1;
    const createdAt = new Date();
    const verificationStatus = ownerVerified ? "VERIFIED" : "UNVERIFIED";
    const verifiedByUserId = directOwnerVerification
      ? context.userId
      : ownerVerified
        ? previous!.verifiedByUserId
        : null;
    const verifiedAt = directOwnerVerification
      ? createdAt
      : ownerVerified
        ? previous!.verifiedAt
        : null;
    const evidence = this.evidence(context, spec, locale);
    const fact = existing
      ? existing
      : await tx.knowledgeV2Fact.create({
          data: {
            tenantId: context.tenantId,
            factKey: spec.factKey,
            entityType: spec.entityType,
            fieldType: "TEXT",
            latestVersionNumber: 1,
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          },
          include: factInclude,
        });
    const immutableHash = this.factHash({
      fact,
      versionNumber,
      material,
      lifecycleStatus: archived ? "ARCHIVED" : "DRAFT",
      verificationStatus,
      changeReason: archived ? "Removed from onboarding" : "Updated from onboarding",
      supersedesVersionId: previous?.id ?? null,
      createdByUserId: context.userId,
      verifiedByUserId,
      verifiedAt,
      createdAt,
      evidence,
    });
    if (existing) {
      const updated = await tx.knowledgeV2Fact.updateMany({
        where: {
          id: existing.id,
          tenantId: context.tenantId,
          etag: existing.etag,
          latestVersionNumber: existing.latestVersionNumber,
        },
        data: {
          entityType: spec.entityType,
          fieldType: "TEXT",
          latestVersionNumber: versionNumber,
          generation: { increment: 1 },
          etag: { increment: 1 },
          updatedByUserId: context.userId,
          deletedAt: null,
        },
      });
      if (updated.count !== 1) throw new Error("KNOWLEDGE_CONFLICT_ONBOARDING_FACT_CHANGED");
    }
    const version = await tx.knowledgeV2FactVersion.create({
      data: {
        tenantId: context.tenantId,
        factId: fact.id,
        versionNumber,
        normalizedValue: requiredJson(material.normalizedValue),
        displayValue: material.displayValue,
        localizedValues: optionalJson(material.localizedValues),
        unit: material.unit,
        currency: material.currency,
        timeZone: material.timeZone,
        locale: material.locale,
        localeBehavior: material.localeBehavior,
        scope: optionalJson(material.scope),
        effectiveFrom: material.effectiveFrom,
        effectiveUntil: material.effectiveUntil,
        riskLevel: material.riskLevel,
        authority: material.authority,
        lifecycleStatus: archived ? "ARCHIVED" : "DRAFT",
        verificationStatus,
        changeReason: archived ? "Removed from onboarding" : "Updated from onboarding",
        supersedesVersionId: previous?.id ?? null,
        immutableHash,
        createdByUserId: context.userId,
        verifiedByUserId,
        verifiedAt,
        createdAt,
      },
    });
    await this.createEvidence(tx, context.tenantId, evidence, {
      factVersionId: version.id,
      guidanceRuleVersionId: null,
    });
    return {
      kind: "RECONCILIATION",
      item: {
        resourceType: "FACT",
        resourceId: fact.id,
        resourceGeneration: existing ? existing.generation + 1 : fact.generation,
        versionId: version.id,
        versionNumber,
        versionHash: immutableHash,
        action: ownerVerified ? "VERIFY" : existing ? "UPDATE" : "CREATE",
        semanticKey: spec.semanticKey,
        sourceValueHash: this.valueHash(spec.value),
      },
    };
  }

  private async projectGuidance(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    locale: string,
    spec: GuidanceSpec,
    fieldChanged: boolean,
  ): Promise<ProjectionChange | null> {
    const existing = await tx.knowledgeV2GuidanceRule.findUnique({
      where: { tenantId_ruleKey: { tenantId: context.tenantId, ruleKey: spec.ruleKey } },
      include: guidanceInclude,
    });
    if (!existing && !spec.value) return null;
    if (existing?.deletedAt && !spec.value) return null;

    const previous = existing?.versions[0] ?? null;
    if (existing && (!previous || previous.versionNumber !== existing.latestVersionNumber)) {
      throw new Error("KNOWLEDGE_DEPENDENCY_ONBOARDING_GUIDANCE_HEAD_INVALID");
    }
    const disabled = !spec.value;
    const material = disabled
      ? this.guidanceMaterialFromVersion(previous!)
      : this.guidanceMaterial(spec, locale);
    if (existing) {
      const materialIsCurrent =
        existing.deletedAt === null &&
        existing.title === material.title &&
        existing.ruleType === material.ruleType &&
        (disabled
          ? previous!.reviewStatus === "DISABLED"
          : previous!.reviewStatus !== "DISABLED" &&
            this.guidanceMaterialHash(previous!) === this.guidanceMaterialHash(material));
      if (!this.onboardingOwnsHead(previous!, spec.semanticKey)) {
        if (materialIsCurrent) return null;
        return this.recordOwnershipConflict(tx, context, {
          resourceType: "GUIDANCE_RULE",
          resourceId: existing.id,
          semanticKey: spec.semanticKey,
          sourceValue: spec.value,
          riskLevel: "HIGH",
          reopen: fieldChanged,
        });
      }
      if (materialIsCurrent && this.projectionEvidenceIsCurrent(previous!, spec, locale)) {
        return null;
      }
    }

    const versionNumber = (existing?.latestVersionNumber ?? 0) + 1;
    const createdAt = new Date();
    const evidence = this.evidence(context, spec, locale);
    const rule = existing
      ? existing
      : await tx.knowledgeV2GuidanceRule.create({
          data: {
            tenantId: context.tenantId,
            ruleKey: spec.ruleKey,
            title: material.title,
            ruleType: material.ruleType,
            latestVersionNumber: 1,
            createdByUserId: context.userId,
            updatedByUserId: context.userId,
          },
          include: guidanceInclude,
        });
    const immutableHash = this.guidanceHash({
      rule,
      versionNumber,
      material,
      reviewStatus: disabled ? "DISABLED" : "DRAFT",
      changeReason: disabled ? "Removed from onboarding" : "Updated from onboarding",
      supersedesVersionId: previous?.id ?? null,
      createdByUserId: context.userId,
      createdAt,
      evidence,
    });
    if (existing) {
      const updated = await tx.knowledgeV2GuidanceRule.updateMany({
        where: {
          id: existing.id,
          tenantId: context.tenantId,
          etag: existing.etag,
          latestVersionNumber: existing.latestVersionNumber,
        },
        data: {
          title: material.title,
          ruleType: material.ruleType,
          latestVersionNumber: versionNumber,
          generation: { increment: 1 },
          etag: { increment: 1 },
          updatedByUserId: context.userId,
          deletedAt: null,
        },
      });
      if (updated.count !== 1) throw new Error("KNOWLEDGE_CONFLICT_ONBOARDING_GUIDANCE_CHANGED");
    }
    const version = await tx.knowledgeV2GuidanceRuleVersion.create({
      data: {
        tenantId: context.tenantId,
        guidanceRuleId: rule.id,
        versionNumber,
        title: material.title,
        ruleType: material.ruleType,
        conditionAst: requiredJson(material.condition),
        instruction: material.instruction,
        outcome: optionalJson(material.outcome),
        priority: material.priority,
        tieBreakPolicy: material.tieBreakPolicy,
        tieBreakKey: material.tieBreakKey,
        scope: optionalJson(material.scope),
        effectiveFrom: material.effectiveFrom,
        effectiveUntil: material.effectiveUntil,
        riskLevel: material.riskLevel,
        requiredApproverRole: material.requiredApproverRole,
        examples: optionalJson(material.examples),
        reviewStatus: disabled ? "DISABLED" : "DRAFT",
        changeReason: disabled ? "Removed from onboarding" : "Updated from onboarding",
        supersedesVersionId: previous?.id ?? null,
        immutableHash,
        createdByUserId: context.userId,
        createdAt,
      },
    });
    await this.createEvidence(tx, context.tenantId, evidence, {
      factVersionId: null,
      guidanceRuleVersionId: version.id,
    });
    return {
      kind: "RECONCILIATION",
      item: {
        resourceType: "GUIDANCE_RULE",
        resourceId: rule.id,
        resourceGeneration: existing ? existing.generation + 1 : rule.generation,
        versionId: version.id,
        versionNumber,
        versionHash: immutableHash,
        action: disabled ? "DISABLE" : existing ? "UPDATE" : "CREATE",
        semanticKey: spec.semanticKey,
        sourceValueHash: this.valueHash(spec.value),
      },
    };
  }

  private onboardingOwnsHead(
    version: Pick<FactVersion | GuidanceVersion, "changeReason" | "evidence">,
    semanticKey: keyof OnboardingKnowledgeInput,
  ) {
    const onboardingReason =
      version.changeReason === "Updated from onboarding" ||
      version.changeReason === "Removed from onboarding";
    const onboardingEvidence =
      version.evidence.length > 0 &&
      version.evidence.every((item) => {
        const reference = jsonRecord(item.sourceReference);
        return (
          reference.origin === "onboarding" &&
          reference.projectionVersion === 1 &&
          reference.semanticKey === semanticKey
        );
      });
    return onboardingReason && onboardingEvidence;
  }

  private projectionEvidenceIsCurrent(
    version: Pick<FactVersion | GuidanceVersion, "evidence">,
    spec: Pick<FactSpec | GuidanceSpec, "semanticKey" | "locator" | "audience" | "value">,
    locale: string,
  ) {
    const sourceValueHash = this.valueHash(spec.value);
    return (
      version.evidence.length === 1 &&
      version.evidence.some((item) => {
        const reference = jsonRecord(item.sourceReference);
        const metadata = jsonRecord(item.metadata);
        return (
          item.kind === "MANUAL" &&
          item.legacyRevisionId === null &&
          item.locator === spec.locator &&
          item.isPublic === (spec.audience === "PUBLIC") &&
          item.quoteHash === sourceValueHash &&
          reference.origin === "onboarding" &&
          reference.projectionVersion === 1 &&
          reference.semanticKey === spec.semanticKey &&
          reference.sourceValueHash === sourceValueHash &&
          metadata.origin === "onboarding" &&
          metadata.projectionVersion === 1 &&
          metadata.semanticKey === spec.semanticKey &&
          metadata.sourceValueHash === sourceValueHash &&
          metadata.locale === locale
        );
      })
    );
  }

  private async recordOwnershipConflict(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    input: {
      resourceType: "FACT" | "GUIDANCE_RULE";
      resourceId: string;
      semanticKey: keyof OnboardingKnowledgeInput;
      sourceValue: string;
      riskLevel: "MEDIUM" | "HIGH";
      reopen: boolean;
    },
  ): Promise<OwnershipConflict | null> {
    const reviewKey = [
      "onboarding-projection-v1",
      "ownership",
      input.resourceType,
      input.resourceId,
    ].join(":");
    const existingReview = await tx.knowledgeV2ReviewItem.findUnique({
      where: { tenantId_reviewKey: { tenantId: context.tenantId, reviewKey } },
      select: { id: true },
    });
    if (existingReview && !input.reopen) return null;
    const review = await tx.knowledgeV2ReviewItem.upsert({
      where: { tenantId_reviewKey: { tenantId: context.tenantId, reviewKey } },
      create: {
        tenantId: context.tenantId,
        corpusKind: "STRUCTURED_V2",
        reviewKey,
        reason: "CONFLICTING_VALUES",
        riskLevel: input.riskLevel,
        status: "OPEN",
        suggestedAction: "DISMISS",
        safeTitle: "Onboarding answer needs Knowledge review",
        safeSummary:
          "Keep the current Knowledge value, or edit it to match onboarding before resolving.",
        ...(input.resourceType === "FACT"
          ? { factId: input.resourceId }
          : { guidanceRuleId: input.resourceId }),
        createdByUserId: context.userId,
      },
      update: {
        reason: "CONFLICTING_VALUES",
        riskLevel: input.riskLevel,
        status: "OPEN",
        suggestedAction: "DISMISS",
        safeTitle: "Onboarding answer needs Knowledge review",
        safeSummary:
          "Keep the current Knowledge value, or edit it to match onboarding before resolving.",
        assignedToUserId: null,
        assignedAt: null,
        resolutionAction: null,
        resolutionSummaryHash: null,
        restrictedResolutionRef: null,
        resolvedByUserId: null,
        resolvedAt: null,
        etag: { increment: 1 },
        generation: { increment: 1 },
      },
    });
    const sourceValueHash = this.valueHash(input.sourceValue);
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "knowledge.v2.onboarding_ownership_conflict",
        entityType: "knowledge_v2_review",
        entityId: review.id,
        payload: {
          projectionVersion: 1,
          semanticKey: input.semanticKey,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          sourceValueHash,
        },
      },
    });
    return {
      kind: "OWNERSHIP_CONFLICT",
      semanticKey: input.semanticKey,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reviewId: review.id,
      sourceValueHash,
    };
  }

  private factSpecs(input: OnboardingKnowledgeInput): FactSpec[] {
    return [
      {
        semanticKey: "businessName",
        factKey: "business/name",
        entityType: "BUSINESS_PROFILE",
        audience: "PUBLIC",
        riskLevel: "LOW",
        locator: "companyInfo.name",
        value: input.businessName,
      },
      {
        semanticKey: "businessType",
        factKey: "business/type",
        entityType: "BUSINESS_PROFILE",
        audience: "PUBLIC",
        riskLevel: "LOW",
        locator: "businessType",
        value: input.businessType,
      },
      {
        semanticKey: "businessDescription",
        factKey: "business/description",
        entityType: "BUSINESS_PROFILE",
        audience: "PUBLIC",
        riskLevel: "LOW",
        locator: "companyInfo.description",
        value: input.businessDescription,
      },
      {
        semanticKey: "scenario",
        factKey: "business/primary-ai-scenario",
        entityType: "BUSINESS_PROFILE",
        audience: "INTERNAL",
        riskLevel: "LOW",
        locator: "scenario",
        value: input.scenario,
      },
      {
        semanticKey: "averageCheck",
        factKey: "business/average-check",
        entityType: "BUSINESS_PROFILE",
        audience: "INTERNAL",
        riskLevel: "MEDIUM",
        locator: "companyInfo.avgCheck",
        value: input.averageCheck,
      },
      {
        semanticKey: "servicesCatalog",
        factKey: "catalog/summary",
        entityType: "CATALOG",
        audience: "PUBLIC",
        riskLevel: "HIGH",
        locator: "companyInfo.servicesCatalog",
        value: input.servicesCatalog,
      },
      {
        semanticKey: "hours",
        factKey: "business/hours-summary",
        entityType: "BUSINESS_PROFILE",
        audience: "PUBLIC",
        riskLevel: "MEDIUM",
        locator: "companyInfo.hours",
        value: input.hours,
      },
      {
        semanticKey: "availability",
        factKey: "business/availability-summary",
        entityType: "BUSINESS_PROFILE",
        audience: "INTERNAL",
        riskLevel: "HIGH",
        locator: "companyInfo.availability",
        value: input.availability,
      },
      {
        semanticKey: "faq",
        factKey: "business/faq",
        entityType: "BUSINESS_PROFILE",
        audience: "PUBLIC",
        riskLevel: "LOW",
        locator: "companyInfo.faq",
        value: input.faq,
      },
    ];
  }

  private guidanceSpecs(input: OnboardingKnowledgeInput): GuidanceSpec[] {
    return [
      {
        semanticKey: "policies",
        ruleKey: "onboarding/policy",
        title: "Onboarding policies",
        ruleType: "RESPONSE",
        audience: "PUBLIC",
        riskLevel: "MEDIUM",
        requiredApproverRole: "ADMIN",
        priority: 100,
        locator: "companyInfo.policies",
        value: input.policies,
      },
      {
        semanticKey: "escalationRules",
        ruleKey: "onboarding/escalation",
        title: "Onboarding escalation rules",
        ruleType: "ESCALATION",
        audience: "INTERNAL",
        riskLevel: "HIGH",
        requiredApproverRole: "OWNER",
        priority: 200,
        locator: "companyInfo.escalationRules",
        value: input.escalationRules,
      },
    ];
  }

  private factMaterial(
    value: string,
    locale: string,
    audience: "PUBLIC" | "INTERNAL",
    riskLevel: "LOW" | "MEDIUM" | "HIGH",
  ): FactMaterial {
    return {
      normalizedValue: value,
      displayValue: value,
      localizedValues: null,
      unit: null,
      currency: null,
      timeZone: null,
      locale,
      localeBehavior: "LOCALE_SPECIFIC" as const,
      scope: this.scope(locale, audience),
      effectiveFrom: null,
      effectiveUntil: null,
      riskLevel,
      authority: "MANUAL" as const,
      extractionConfidence: null,
      extractionModelVersion: null,
    };
  }

  private factMaterialFromVersion(version: FactVersion): FactMaterial {
    return {
      normalizedValue: version.normalizedValue,
      displayValue: version.displayValue,
      localizedValues: version.localizedValues,
      unit: version.unit,
      currency: version.currency,
      timeZone: version.timeZone,
      locale: version.locale,
      localeBehavior: version.localeBehavior,
      scope: version.scope,
      effectiveFrom: version.effectiveFrom,
      effectiveUntil: version.effectiveUntil,
      riskLevel: version.riskLevel,
      authority: version.authority,
      extractionConfidence: version.extractionConfidence,
      extractionModelVersion: version.extractionModelVersion,
    };
  }

  private guidanceMaterial(spec: GuidanceSpec, locale: string): GuidanceMaterial {
    return {
      title: spec.title,
      ruleType: spec.ruleType,
      condition: { kind: "ALL", conditions: [] },
      instruction: spec.value,
      outcome: null as Prisma.JsonValue | null,
      priority: spec.priority,
      tieBreakPolicy: "stable_rule_key",
      tieBreakKey: spec.ruleKey,
      scope: this.scope(locale, spec.audience),
      effectiveFrom: null as Date | null,
      effectiveUntil: null as Date | null,
      riskLevel: spec.riskLevel,
      requiredApproverRole: spec.requiredApproverRole,
      examples: [],
    };
  }

  private guidanceMaterialFromVersion(version: GuidanceVersion): GuidanceMaterial {
    return {
      title: version.title,
      ruleType: version.ruleType,
      condition: version.conditionAst,
      instruction: version.instruction,
      outcome: version.outcome,
      priority: version.priority,
      tieBreakPolicy: version.tieBreakPolicy,
      tieBreakKey: version.tieBreakKey,
      scope: version.scope,
      effectiveFrom: version.effectiveFrom,
      effectiveUntil: version.effectiveUntil,
      riskLevel: version.riskLevel,
      requiredApproverRole: version.requiredApproverRole,
      examples: version.examples ?? [],
    };
  }

  private evidence(
    context: RequestContext,
    spec: Pick<FactSpec | GuidanceSpec, "semanticKey" | "locator" | "audience" | "value">,
    locale: string,
  ): ProjectionEvidence {
    const sourceValueHash = this.valueHash(spec.value);
    const sourceReference = {
      origin: "onboarding",
      projectionVersion: 1,
      semanticKey: spec.semanticKey,
      sourceValueHash,
    } satisfies Prisma.InputJsonObject;
    return {
      id: randomUUID(),
      kind: "MANUAL",
      legacyRevisionId: null,
      label: "Onboarding form submission",
      locator: spec.locator,
      isPublic: spec.audience === "PUBLIC",
      sourceReference,
      elementReference: null,
      quoteHash: sourceValueHash,
      confidence: null,
      metadata: { ...sourceReference, locale },
      createdByUserId: context.userId,
    };
  }

  private async createEvidence(
    tx: Prisma.TransactionClient,
    tenantId: string,
    evidence: ProjectionEvidence,
    link: { factVersionId: string | null; guidanceRuleVersionId: string | null },
  ) {
    await tx.knowledgeV2Evidence.create({
      data: {
        id: evidence.id,
        tenantId,
        kind: evidence.kind,
        factVersionId: link.factVersionId,
        guidanceRuleVersionId: link.guidanceRuleVersionId,
        label: evidence.label,
        locator: evidence.locator,
        isPublic: evidence.isPublic,
        sourceReference: evidence.sourceReference,
        quoteHash: evidence.quoteHash,
        metadata: evidence.metadata,
        createdByUserId: evidence.createdByUserId,
      },
    });
  }

  private factHash(input: {
    fact: Pick<FactRecord, "id" | "factKey" | "entityType" | "entityId" | "fieldType">;
    versionNumber: number;
    material: FactMaterial;
    lifecycleStatus: "DRAFT" | "ARCHIVED";
    verificationStatus: "UNVERIFIED" | "VERIFIED";
    changeReason: string;
    supersedesVersionId: string | null;
    createdByUserId: string;
    verifiedByUserId: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    evidence: ProjectionEvidence;
  }) {
    return canonicalKnowledgeV2Hash({
      schemaVersion: 1,
      factId: input.fact.id,
      factKey: input.fact.factKey,
      entityType: input.fact.entityType,
      entityId: input.fact.entityId,
      fieldType: input.fact.fieldType,
      versionNumber: input.versionNumber,
      normalizedValue: input.material.normalizedValue,
      displayValue: input.material.displayValue,
      localizedValues: input.material.localizedValues,
      unit: input.material.unit,
      currency: input.material.currency,
      timeZone: input.material.timeZone,
      locale: input.material.locale,
      localeBehavior: input.material.localeBehavior,
      scope: input.material.scope,
      effectiveFrom: dateValue(input.material.effectiveFrom),
      effectiveUntil: dateValue(input.material.effectiveUntil),
      riskLevel: input.material.riskLevel,
      authority: input.material.authority,
      lifecycleStatus: input.lifecycleStatus,
      verificationStatus: input.verificationStatus,
      extractionConfidence: input.material.extractionConfidence,
      extractionModelVersion: input.material.extractionModelVersion,
      changeReason: input.changeReason,
      supersedesVersionId: input.supersedesVersionId,
      createdByUserId: input.createdByUserId,
      verifiedByUserId: input.verifiedByUserId,
      verifiedAt: dateValue(input.verifiedAt),
      rejectedByUserId: null,
      rejectedAt: null,
      createdAt: input.createdAt.toISOString(),
      evidence: [evidenceHashValue(input.evidence)],
    });
  }

  private guidanceHash(input: {
    rule: Pick<GuidanceRecord, "id" | "ruleKey">;
    versionNumber: number;
    material: GuidanceMaterial;
    reviewStatus: "DRAFT" | "DISABLED";
    changeReason: string;
    supersedesVersionId: string | null;
    createdByUserId: string;
    createdAt: Date;
    evidence: ProjectionEvidence;
  }) {
    return canonicalKnowledgeV2Hash({
      schemaVersion: 1,
      guidanceRuleId: input.rule.id,
      ruleKey: input.rule.ruleKey,
      versionNumber: input.versionNumber,
      title: input.material.title,
      ruleType: input.material.ruleType,
      condition: input.material.condition,
      instruction: input.material.instruction,
      outcome: input.material.outcome,
      priority: input.material.priority,
      tieBreakPolicy: input.material.tieBreakPolicy,
      tieBreakKey: input.material.tieBreakKey,
      scope: input.material.scope,
      effectiveFrom: dateValue(input.material.effectiveFrom),
      effectiveUntil: dateValue(input.material.effectiveUntil),
      riskLevel: input.material.riskLevel,
      requiredApproverRole: input.material.requiredApproverRole,
      examples: input.material.examples,
      reviewStatus: input.reviewStatus,
      changeReason: input.changeReason,
      supersedesVersionId: input.supersedesVersionId,
      createdByUserId: input.createdByUserId,
      approvedByUserId: null,
      approvedAt: null,
      rejectedByUserId: null,
      rejectedAt: null,
      createdAt: input.createdAt.toISOString(),
      evidence: [evidenceHashValue(input.evidence)],
    });
  }

  private factMaterialHash(value: FactVersion | FactMaterial) {
    return canonicalKnowledgeV2Hash({
      normalizedValue: value.normalizedValue,
      displayValue: value.displayValue,
      localizedValues: value.localizedValues,
      unit: value.unit,
      currency: value.currency,
      timeZone: value.timeZone,
      locale: value.locale,
      localeBehavior: value.localeBehavior,
      scope: value.scope,
      effectiveFrom: dateValue(value.effectiveFrom),
      effectiveUntil: dateValue(value.effectiveUntil),
      riskLevel: value.riskLevel,
      authority: value.authority,
      extractionConfidence: value.extractionConfidence,
      extractionModelVersion: value.extractionModelVersion,
    });
  }

  private factMaterialContentHash(value: FactVersion | FactMaterial) {
    return canonicalKnowledgeV2Hash({
      normalizedValue: value.normalizedValue,
      displayValue: value.displayValue,
      localizedValues: value.localizedValues,
      unit: value.unit,
      currency: value.currency,
      timeZone: value.timeZone,
      locale: value.locale,
      localeBehavior: value.localeBehavior,
      scope: value.scope,
      riskLevel: value.riskLevel,
      extractionConfidence: value.extractionConfidence,
      extractionModelVersion: value.extractionModelVersion,
    });
  }

  private guidanceMaterialHash(value: GuidanceVersion | GuidanceMaterial) {
    const condition = "conditionAst" in value ? value.conditionAst : value.condition;
    return canonicalKnowledgeV2Hash({
      title: value.title,
      ruleType: value.ruleType,
      condition,
      instruction: value.instruction,
      outcome: value.outcome,
      priority: value.priority,
      tieBreakPolicy: value.tieBreakPolicy,
      tieBreakKey: value.tieBreakKey,
      scope: value.scope,
      effectiveFrom: dateValue(value.effectiveFrom),
      effectiveUntil: dateValue(value.effectiveUntil),
      riskLevel: value.riskLevel,
      requiredApproverRole: value.requiredApproverRole,
      examples: value.examples,
    });
  }

  private scope(locale: string, audience: "PUBLIC" | "INTERNAL"): Prisma.JsonObject {
    return {
      brandIds: [],
      locationIds: [],
      channelTypes: [],
      assistantIds: [],
      audiences: [audience],
      segments: [],
      locales: [locale],
    };
  }

  private valueHash(value: string) {
    return canonicalKnowledgeV2Hash({ projectionVersion: 1, value });
  }
}

function requiredJson(value: Prisma.JsonValue) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function optionalJson(value: Prisma.JsonValue | null) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function dateValue(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function evidenceHashValue(evidence: ProjectionEvidence | Evidence) {
  return {
    kind: evidence.kind,
    legacyRevisionId: evidence.legacyRevisionId,
    label: evidence.label,
    locator: evidence.locator,
    isPublic: evidence.isPublic,
    sourceReference: evidence.sourceReference,
    elementReference: evidence.elementReference,
    quoteHash: evidence.quoteHash,
    confidence: evidence.confidence,
    metadata: evidence.metadata,
  };
}
