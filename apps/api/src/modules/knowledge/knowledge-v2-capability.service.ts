import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  buildDefaultKnowledgeCapabilityDefinitionsV1,
  evaluateKnowledgeCapabilitySnapshotV1,
  hashKnowledgeCapabilitySetV1,
  lockKnowledgeCorpusTransition,
  loadKnowledgeOperationalCapabilityProjectionV1,
  type KnowledgeCapabilityDefinitionV1,
  type KnowledgeCapabilityEvidenceRefV1,
  type KnowledgeCapabilityEvidenceV1,
  type KnowledgeCapabilityLocaleConstraintsV1,
  type KnowledgeOperationalCapabilityProjectionV1,
  type KnowledgeCapabilityScopeV1,
  type KnowledgeCapabilitySnapshotV1,
  type KnowledgeCapabilityTypeV1,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2CapabilityListView,
  KnowledgeV2CapabilityReadinessView,
  KnowledgeV2CapabilityType,
  KnowledgeV2CapabilityView,
  KnowledgeV2JsonValue,
  KnowledgeV2MutationResult,
  KnowledgeV2PublicationGateView,
  KnowledgeV2ReadinessRequirementView,
  KnowledgeV2ResourceRef,
  KnowledgeV2UpdateCapabilityRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";

const targetKey = "workspace-v2";
const supportedAutonomyValues: ReadonlySet<string> = new Set([
  "ANSWER_ONLY",
  "COLLECT_INFORMATION",
  "PROPOSE_ACTION",
]);

const capabilityNames: Record<KnowledgeV2CapabilityType, string> = {
  GENERAL_FAQ: "General FAQ",
  LEAD_QUALIFICATION: "Lead qualification",
  PRICING: "Pricing",
  APPOINTMENT_DISCOVERY: "Appointment discovery",
  APPOINTMENT_BOOKING: "Appointment booking",
  ORDER_ACCOUNT_SUPPORT: "Order and account support",
  COMMERCE_RECOMMENDATION: "Commerce recommendation",
  REGULATED_TOPIC: "Regulated topics",
};

const capabilityInclude = {
  requirementDefinitions: {
    where: { active: true },
    orderBy: [{ requirementKey: "asc" }, { definitionVersion: "desc" }],
  },
} satisfies Prisma.KnowledgeV2CapabilityInclude;

type CapabilityRecord = Prisma.KnowledgeV2CapabilityGetPayload<{
  include: typeof capabilityInclude;
}>;

export interface KnowledgeV2CapabilityEvidenceSelection {
  factVersionIds: string[];
  guidanceRuleVersionIds: string[];
  documentRevisionIds: string[];
}

export interface KnowledgeV2CapabilityEvaluationBundle {
  snapshot: KnowledgeCapabilitySnapshotV1;
  operationalProjection: KnowledgeOperationalCapabilityProjectionV1;
  definitions: KnowledgeCapabilityDefinitionV1[];
  records: CapabilityRecord[];
  views: KnowledgeV2CapabilityReadinessView[];
  blockers: KnowledgeV2PublicationGateView[];
  warnings: KnowledgeV2PublicationGateView[];
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function scopeOrNull(value: Prisma.JsonValue | null): KnowledgeCapabilityScopeV1 | null {
  return value as KnowledgeCapabilityScopeV1 | null;
}

function localeConstraintsOrNull(
  value: Prisma.JsonValue | null,
): KnowledgeCapabilityLocaleConstraintsV1 | null {
  return value as KnowledgeCapabilityLocaleConstraintsV1 | null;
}

function requirementLabel(key: string) {
  return key
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function capabilityEtag(record: Pick<CapabilityRecord, "id" | "etag">) {
  return strongKnowledgeV2Etag("capability", record.id, record.etag);
}

function capabilityView(record: CapabilityRecord): KnowledgeV2CapabilityView {
  return {
    id: record.id,
    capabilityType: record.capabilityType,
    targetKey: record.targetKey,
    name: capabilityNames[record.capabilityType],
    enabled: record.enabled,
    allowedAutonomy: record.allowedAutonomy,
    scope: record.scope as KnowledgeV2JsonValue | null,
    templateKey: record.templateKey,
    templateVersion: record.templateVersion,
    serverOwned: record.serverOwned,
    version: record.etag,
    etag: capabilityEtag(record),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function definitionsFromRecords(records: CapabilityRecord[]): KnowledgeCapabilityDefinitionV1[] {
  return records.map((record) => ({
    schemaVersion: 1,
    capabilityId: record.id,
    capabilityType: record.capabilityType,
    targetKey: record.targetKey,
    name: capabilityNames[record.capabilityType],
    enabled: record.enabled,
    allowedAutonomy: record.allowedAutonomy,
    templateKey: record.templateKey,
    templateVersion: record.templateVersion,
    serverOwned: record.serverOwned,
    weight: 100,
    requiredScope: scopeOrNull(record.scope),
    localeConstraints: null,
    requirements: record.requirementDefinitions.map((definition) => ({
      schemaVersion: 1,
      requirementKey: definition.requirementKey,
      definitionVersion: definition.definitionVersion,
      predicateVersion: "knowledge-requirement-v1",
      kind: definition.kind,
      label: requirementLabel(definition.requirementKey),
      severity: definition.severity,
      riskLevel: definition.riskLevel,
      active: definition.active,
      requiredScope: scopeOrNull(definition.requiredScope),
      localeConstraints: localeConstraintsOrNull(definition.localeConstraints),
      freshnessSlaSeconds: definition.freshnessSlaSeconds,
      satisfactionPredicate: definition.satisfactionPredicate,
      templateOrigin: definition.templateOrigin,
      tenantOverride: definition.tenantOverride,
    })),
  }));
}

function evidenceResource(ref: KnowledgeCapabilityEvidenceRefV1): KnowledgeV2ResourceRef {
  if (ref.type === "FACT_VERSION") return { type: "FACT", id: ref.id };
  if (ref.type === "GUIDANCE_RULE_VERSION") return { type: "GUIDANCE_RULE", id: ref.id };
  if (ref.type === "DOCUMENT_REVISION") return { type: "REVISION", id: ref.id };
  return { type: "SETTINGS", id: ref.id };
}

function requirementView(
  requirement: KnowledgeCapabilitySnapshotV1["capabilities"][number]["requirements"][number],
): KnowledgeV2ReadinessRequirementView {
  return {
    id: requirement.requirementKey,
    kind: requirement.kind,
    label: requirement.label,
    status: requirement.status,
    severity: requirement.severity,
    riskLevel: requirement.riskLevel,
    explanation: requirement.explanation,
    evidence: requirement.evidenceRefs.map(evidenceResource),
    remediation: requirement.remediation
      ? {
          action: requirement.remediation.action,
          label: requirement.remediation.label,
        }
      : null,
    evaluatedAt: requirement.evaluatedAt,
  };
}

function readinessStatus(
  status: KnowledgeCapabilitySnapshotV1["capabilities"][number]["status"],
): KnowledgeV2CapabilityReadinessView["status"] {
  if (status === "NOT_APPLICABLE") return "READY";
  return status;
}

function capabilityReadinessViews(
  snapshot: KnowledgeCapabilitySnapshotV1,
  records: CapabilityRecord[],
) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return snapshot.capabilities.map((capability): KnowledgeV2CapabilityReadinessView => {
    const record = recordsById.get(capability.capabilityId);
    if (!record) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_CAPABILITY_SNAPSHOT_INVALID",
        "Capability readiness could not be reconciled.",
      );
    }
    return {
      capabilityId: capability.capabilityId,
      capabilityType: capability.capabilityType,
      name: capability.name,
      enabled: capability.enabled,
      allowedAutonomy: capability.allowedAutonomy,
      generation: record.generation,
      etag: capabilityEtag(record),
      status: readinessStatus(capability.status),
      weight: capability.weight,
      requirements: capability.requirements.map(requirementView),
      blockerCount: capability.blockerCount,
      warningCount: capability.warningCount,
    };
  });
}

function capabilityGates(
  snapshot: KnowledgeCapabilitySnapshotV1,
  severity: "BLOCKER" | "WARNING",
): KnowledgeV2PublicationGateView[] {
  return snapshot.capabilities.flatMap((capability) =>
    capability.enabled
      ? capability.requirements.flatMap((requirement) =>
          requirement.severity === severity && requirement.status !== "SATISFIED"
            ? [
                {
                  code: `KNOWLEDGE_CAPABILITY_${capability.capabilityType}_${requirement.requirementKey}_${requirement.status}`.toUpperCase(),
                  status: severity === "BLOCKER" ? ("BLOCKED" as const) : ("WARNING" as const),
                  title: `${capability.name}: ${requirement.label}`,
                  message: requirement.explanation,
                  resource: {
                    type: "CAPABILITY" as const,
                    id: capability.capabilityId,
                    label: capability.name,
                  },
                  ...(requirement.remediation
                    ? {
                        remediation: {
                          action: requirement.remediation.action,
                          label: requirement.remediation.label,
                        },
                      }
                    : {}),
                },
              ]
            : [],
        )
      : [],
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function persistedRequirementStatus(status: string): KnowledgeV2ReadinessRequirementView["status"] {
  if (
    status === "SATISFIED" ||
    status === "STALE" ||
    status === "CONFLICTED" ||
    status === "NOT_APPLICABLE"
  ) {
    return status;
  }
  return "UNSATISFIED";
}

@Injectable()
export class KnowledgeV2CapabilityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
  ) {}

  async listCapabilities(context: RequestContext): Promise<KnowledgeV2CapabilityListView> {
    return this.prisma.$transaction(async (tx) => {
      const records = await this.loadRecords(tx, context.tenantId);
      const definitions = definitionsFromRecords(records);
      return {
        targetKey,
        capabilitySetHash: hashKnowledgeCapabilitySetV1(definitions),
        items: records.map(capabilityView),
      };
    });
  }

  async updateCapability(
    context: RequestContext,
    capabilityType: KnowledgeV2CapabilityType,
    input: KnowledgeV2UpdateCapabilityRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2CapabilityView>> {
    if (
      input.allowedAutonomy !== undefined &&
      !supportedAutonomyValues.has(input.allowedAutonomy)
    ) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_CAPABILITY_AUTONOMY_UNSUPPORTED",
        "Choose a supported autonomy level.",
      );
    }
    if (input.enabled === undefined && input.allowedAutonomy === undefined) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_CAPABILITY_UPDATE_REQUIRED",
        "Choose a capability setting to update.",
      );
    }
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: `PATCH:/knowledge/v2/capabilities/${capabilityType}`,
        key: idempotencyKey,
        request: { body: input, ifMatch },
      },
      async (tx) => {
        await lockKnowledgeCorpusTransition(tx, context.tenantId);
        await this.ensureDefaults(tx, context.tenantId);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "KnowledgeV2Capability"
          WHERE "tenantId" = ${context.tenantId}
            AND "targetKey" = ${targetKey}
            AND "capabilityType" = ${capabilityType}::"KnowledgeV2CapabilityType"
          FOR UPDATE
        `);
        const current = await tx.knowledgeV2Capability.findUnique({
          where: {
            tenantId_capabilityType_targetKey: {
              tenantId: context.tenantId,
              capabilityType,
              targetKey,
            },
          },
          include: capabilityInclude,
        });
        if (!current) {
          throw knowledgeV2Error(
            HttpStatus.NOT_FOUND,
            "KNOWLEDGE_DEPENDENCY_CAPABILITY_NOT_FOUND",
            "The capability was not found.",
          );
        }
        assertIfMatch(ifMatch, capabilityEtag(current), current.etag, [
          "enabled",
          "allowedAutonomy",
        ]);
        const enabled = input.enabled ?? current.enabled;
        const allowedAutonomy = input.allowedAutonomy ?? current.allowedAutonomy;
        const changed = enabled !== current.enabled || allowedAutonomy !== current.allowedAutonomy;
        const updated = changed
          ? await tx.knowledgeV2Capability.update({
              where: { id: current.id },
              data: {
                enabled,
                allowedAutonomy,
                generation: { increment: 1 },
                etag: { increment: 1 },
                updatedByUserId: context.userId,
              },
              include: capabilityInclude,
            })
          : current;
        if (changed) {
          await tx.knowledgeV2Settings.upsert({
            where: { tenantId: context.tenantId },
            create: { tenantId: context.tenantId, draftGeneration: 2, etag: 2 },
            update: { draftGeneration: { increment: 1 }, etag: { increment: 1 } },
          });
          const validationWhere = {
            tenantId: context.tenantId,
            targetKey,
            corpusKind: "STRUCTURED_V2" as const,
            publicationId: null,
          };
          await tx.knowledgeV2PublicationValidation.updateMany({
            where: {
              ...validationWhere,
              status: "PENDING",
            },
            data: { status: "EXPIRED", evaluatedAt: new Date() },
          });
          await tx.knowledgeV2PublicationValidation.updateMany({
            where: {
              ...validationWhere,
              status: "PASSED",
            },
            data: { status: "EXPIRED" },
          });
          await this.revokeAutomaticReplies(tx, context.tenantId);
          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "knowledge.v2.capability_updated",
              entityType: "knowledge_capability",
              entityId: current.id,
              payload: {
                capabilityType,
                previousEnabled: current.enabled,
                enabled,
                previousAllowedAutonomy: current.allowedAutonomy,
                allowedAutonomy,
                automaticRepliesRevoked: true,
              },
            },
          });
        }
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { resource: capabilityView(updated), idempotencyReplayed: false },
          responseRef: updated.id,
        };
      },
    );
    return {
      resource: result.responseBody.resource,
      idempotencyReplayed: result.idempotencyReplayed,
    };
  }

  async evaluateSelection(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    selection: KnowledgeV2CapabilityEvidenceSelection,
    evaluatedAt = new Date(),
    options?: { lockOperationalAuthorization?: boolean },
  ): Promise<KnowledgeV2CapabilityEvaluationBundle> {
    const [records, evidenceBundle, settings] = await Promise.all([
      this.loadRecords(db, tenantId),
      this.evidence(db, tenantId, selection, evaluatedAt, options),
      db.knowledgeV2Settings.findUnique({
        where: { tenantId },
        select: { supportedLocales: true },
      }),
    ]);
    const definitions = definitionsFromRecords(records);
    const snapshot = evaluateKnowledgeCapabilitySnapshotV1({
      schemaVersion: 1,
      evaluatedAt: evaluatedAt.toISOString(),
      tenantSupportedLocales: settings?.supportedLocales ?? ["en"],
      capabilities: definitions,
      evidence: evidenceBundle.evidence,
    });
    const enabledCapabilityBlockers: KnowledgeV2PublicationGateView[] = snapshot.capabilities.some(
      (capability) => capability.enabled,
    )
      ? []
      : [
          {
            code: "KNOWLEDGE_CAPABILITY_ENABLED_REQUIRED",
            status: "BLOCKED",
            title: "Enable a customer capability",
            message: "Enable at least one customer capability before validating this draft.",
            resource: { type: "CAPABILITY", id: targetKey },
          },
        ];
    const operationalBlockers: KnowledgeV2PublicationGateView[] =
      evidenceBundle.operationalProjection.permissionGeneration === null
        ? [
            {
              code: "KNOWLEDGE_DEPENDENCY_OPERATIONAL_AUTHORIZATION_STATE_MISSING",
              status: "BLOCKED",
              title: "Operational authorization unavailable",
              message: "Operational authorization state must be restored before publishing.",
              resource: { type: "SETTINGS", id: targetKey },
            },
          ]
        : [];
    return {
      snapshot,
      operationalProjection: evidenceBundle.operationalProjection,
      definitions,
      records,
      views: capabilityReadinessViews(snapshot, records),
      blockers: [
        ...enabledCapabilityBlockers,
        ...operationalBlockers,
        ...capabilityGates(snapshot, "BLOCKER"),
      ],
      warnings: capabilityGates(snapshot, "WARNING"),
    };
  }

  async persistValidationEvaluations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    validationId: string,
    bundle: KnowledgeV2CapabilityEvaluationBundle,
  ) {
    const definitionByKey = new Map(
      bundle.records.flatMap((capability) =>
        capability.requirementDefinitions.map(
          (definition) => [`${capability.id}:${definition.requirementKey}`, definition] as const,
        ),
      ),
    );
    const data = bundle.snapshot.capabilities.flatMap((capability) =>
      capability.requirements.map((evaluation) => {
        const definition = definitionByKey.get(
          `${capability.capabilityId}:${evaluation.requirementKey}`,
        );
        if (!definition) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_DEPENDENCY_CAPABILITY_DEFINITION_CHANGED",
            "A capability requirement changed during validation.",
          );
        }
        return {
          id: randomUUID(),
          tenantId,
          validationId,
          capabilityId: capability.capabilityId,
          requirementDefinitionId: definition.id,
          definitionVersion: definition.definitionVersion,
          status: evaluation.status,
          evidenceIds: evaluation.evidenceIds,
          reasonCode: evaluation.reasonCode,
          details: inputJson({
            schemaVersion: 1,
            label: evaluation.label,
            explanation: evaluation.explanation,
            remediation: evaluation.remediation,
            evidenceRefs: evaluation.evidenceRefs,
            evaluationDetails: evaluation.details,
            evaluationHash: evaluation.evaluationHash,
            capabilityEvaluationHash: capability.evaluationHash,
            capabilityConfigurationHash: capability.configurationHash,
          }),
          evaluatorVersion: bundle.snapshot.evaluatorVersion,
          immutableHash: evaluation.evaluationHash,
          evaluatedAt: new Date(evaluation.evaluatedAt),
        };
      }),
    );
    const existing = await tx.knowledgeV2RequirementEvaluation.findMany({
      where: { tenantId, validationId },
      select: { requirementDefinitionId: true, immutableHash: true },
      orderBy: { requirementDefinitionId: "asc" },
    });
    if (existing.length > 0) {
      const expected = data
        .map((item) => ({
          requirementDefinitionId: item.requirementDefinitionId,
          immutableHash: item.immutableHash,
        }))
        .sort((left, right) =>
          left.requirementDefinitionId.localeCompare(right.requirementDefinitionId),
        );
      if (canonicalKnowledgeV2Hash(existing) !== canonicalKnowledgeV2Hash(expected)) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_CONFLICT_CAPABILITY_EVALUATION_CHANGED",
          "The stored capability evaluation does not match this draft.",
        );
      }
      return;
    }
    if (data.length > 0) await tx.knowledgeV2RequirementEvaluation.createMany({ data });
  }

  async publicationReadiness(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    publicationId: string,
  ): Promise<{
    capabilitySetHash: string | null;
    requirementEvaluationSetHash: string | null;
    views: KnowledgeV2CapabilityReadinessView[];
    blockers: KnowledgeV2PublicationGateView[];
    warnings: KnowledgeV2PublicationGateView[];
    valid: boolean;
  }> {
    const publication = await db.knowledgePublication.findFirst({
      where: { id: publicationId, tenantId, targetKey, corpusKind: "STRUCTURED_V2" },
      include: {
        capabilitySnapshots: {
          include: { capability: true },
          orderBy: [{ capabilityType: "asc" }, { capabilityId: "asc" }],
        },
        validation: {
          include: {
            requirementEvaluations: {
              include: { requirementDefinition: true },
              orderBy: [
                { capabilityId: "asc" },
                { requirementDefinition: { requirementKey: "asc" } },
              ],
            },
          },
        },
      },
    });
    if (
      !publication ||
      !publication.validation ||
      !publication.capabilitySetHash ||
      !publication.requirementEvaluationSetHash ||
      publication.capabilitySnapshots.length === 0
    ) {
      return {
        capabilitySetHash: publication?.capabilitySetHash ?? null,
        requirementEvaluationSetHash: publication?.requirementEvaluationSetHash ?? null,
        views: [],
        blockers: [
          {
            code: "KNOWLEDGE_CAPABILITY_SNAPSHOT_REQUIRED",
            status: "BLOCKED",
            title: "Capability snapshot required",
            message: "Validate and publish this knowledge again before it can serve customers.",
            resource: { type: "PUBLICATION", id: publicationId },
          },
        ],
        warnings: [],
        valid: false,
      };
    }
    const evaluationsByCapability = new Map<
      string,
      typeof publication.validation.requirementEvaluations
    >();
    for (const evaluation of publication.validation.requirementEvaluations) {
      const current = evaluationsByCapability.get(evaluation.capabilityId) ?? [];
      current.push(evaluation);
      evaluationsByCapability.set(evaluation.capabilityId, current);
    }
    const views = publication.capabilitySnapshots.map(
      (snapshot): KnowledgeV2CapabilityReadinessView => {
        const evaluations = evaluationsByCapability.get(snapshot.capabilityId) ?? [];
        const requirements = evaluations.map((evaluation): KnowledgeV2ReadinessRequirementView => {
          const details = record(evaluation.details);
          const remediationRecord = record(details.remediation);
          const evidenceRefs = Array.isArray(details.evidenceRefs)
            ? details.evidenceRefs.flatMap((value) => {
                const ref = record(value);
                return typeof ref.type === "string" && typeof ref.id === "string"
                  ? [evidenceResource(ref as unknown as KnowledgeCapabilityEvidenceRefV1)]
                  : [];
              })
            : [];
          return {
            id: evaluation.requirementDefinition.requirementKey,
            kind: evaluation.requirementDefinition.kind,
            label:
              typeof details.label === "string"
                ? details.label
                : requirementLabel(evaluation.requirementDefinition.requirementKey),
            status: persistedRequirementStatus(evaluation.status),
            severity: evaluation.requirementDefinition.severity,
            riskLevel: evaluation.requirementDefinition.riskLevel,
            explanation:
              typeof details.explanation === "string"
                ? details.explanation
                : "The persisted requirement evaluation is unavailable.",
            evidence: evidenceRefs,
            remediation:
              typeof remediationRecord.action === "string" &&
              typeof remediationRecord.label === "string"
                ? { action: remediationRecord.action, label: remediationRecord.label }
                : null,
            evaluatedAt: (evaluation.evaluatedAt ?? evaluation.createdAt).toISOString(),
          };
        });
        const blockerCount = requirements.filter(
          (requirement) => requirement.severity === "BLOCKER" && requirement.status !== "SATISFIED",
        ).length;
        const warningCount = requirements.filter(
          (requirement) => requirement.severity === "WARNING" && requirement.status !== "SATISFIED",
        ).length;
        return {
          capabilityId: snapshot.capabilityId,
          capabilityType: snapshot.capabilityType,
          name: capabilityNames[snapshot.capabilityType],
          enabled: true,
          allowedAutonomy: snapshot.allowedAutonomy,
          generation: snapshot.capabilityEtag,
          etag: strongKnowledgeV2Etag(
            "publication-capability",
            `${publicationId}:${snapshot.capabilityId}`,
            snapshot.capabilitySnapshotHash,
          ),
          status: blockerCount > 0 ? "BLOCKED" : warningCount > 0 ? "READY_WITH_WARNINGS" : "READY",
          weight: 100,
          requirements,
          blockerCount,
          warningCount,
        };
      },
    );
    const blockers = views.flatMap((view) =>
      view.requirements.flatMap((requirement) =>
        requirement.severity === "BLOCKER" && requirement.status !== "SATISFIED"
          ? [
              {
                code: `KNOWLEDGE_CAPABILITY_${view.capabilityType}_${requirement.id}_${requirement.status}`.toUpperCase(),
                status: "BLOCKED" as const,
                title: `${view.name}: ${requirement.label}`,
                message: requirement.explanation,
                resource: { type: "CAPABILITY" as const, id: view.capabilityId, label: view.name },
              },
            ]
          : [],
      ),
    );
    const warnings = views.flatMap((view) =>
      view.requirements.flatMap((requirement) =>
        requirement.severity === "WARNING" && requirement.status !== "SATISFIED"
          ? [
              {
                code: `KNOWLEDGE_CAPABILITY_${view.capabilityType}_${requirement.id}_${requirement.status}`.toUpperCase(),
                status: "WARNING" as const,
                title: `${view.name}: ${requirement.label}`,
                message: requirement.explanation,
                resource: { type: "CAPABILITY" as const, id: view.capabilityId, label: view.name },
              },
            ]
          : [],
      ),
    );
    return {
      capabilitySetHash: publication.capabilitySetHash,
      requirementEvaluationSetHash: publication.requirementEvaluationSetHash,
      views,
      blockers,
      warnings,
      valid: blockers.length === 0,
    };
  }

  async createPublicationSnapshots(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      publicationId: string;
      validationId: string;
      bundle: KnowledgeV2CapabilityEvaluationBundle;
    },
  ) {
    const recordById = new Map(input.bundle.records.map((record) => [record.id, record]));
    const enabled = input.bundle.snapshot.capabilities.filter((capability) => capability.enabled);
    if (enabled.length === 0) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_VALIDATION_CAPABILITY_ENABLED_REQUIRED",
        "Enable at least one ready capability before publishing.",
      );
    }
    const persistedEvaluations = await tx.knowledgeV2RequirementEvaluation.findMany({
      where: { tenantId: input.tenantId, validationId: input.validationId },
      select: { capabilityId: true, details: true },
      orderBy: [{ capabilityId: "asc" }, { requirementDefinitionId: "asc" }],
    });
    const persistedCapabilityHashes = new Map<string, string>();
    for (const evaluation of persistedEvaluations) {
      const hash = record(evaluation.details).capabilityEvaluationHash;
      if (typeof hash === "string") persistedCapabilityHashes.set(evaluation.capabilityId, hash);
    }
    await tx.knowledgePublicationCapability.createMany({
      data: enabled.map((capability) => {
        const record = recordById.get(capability.capabilityId);
        const persistedEvaluationHash = persistedCapabilityHashes.get(capability.capabilityId);
        if (!record || !persistedEvaluationHash) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_DEPENDENCY_CAPABILITY_EVALUATION_MISSING",
            "The capability evaluation snapshot is incomplete.",
          );
        }
        return {
          tenantId: input.tenantId,
          publicationId: input.publicationId,
          validationId: input.validationId,
          capabilityId: capability.capabilityId,
          capabilityType: capability.capabilityType,
          allowedAutonomy: capability.allowedAutonomy,
          capabilityEtag: record.etag,
          capabilitySnapshotHash: capability.configurationHash,
          requirementEvaluationSetHash: persistedEvaluationHash,
          operationalBindingHash: input.bundle.operationalProjection.bindingHash,
          operationalPermissionGeneration: input.bundle.operationalProjection.permissionGeneration!,
        };
      }),
    });
  }

  private async loadRecords(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
  ): Promise<CapabilityRecord[]> {
    await this.ensureDefaults(db, tenantId);
    return db.knowledgeV2Capability.findMany({
      where: { tenantId, targetKey },
      include: capabilityInclude,
      orderBy: [{ capabilityType: "asc" }, { id: "asc" }],
    });
  }

  private async ensureDefaults(db: Prisma.TransactionClient | PrismaService, tenantId: string) {
    const defaults = buildDefaultKnowledgeCapabilityDefinitionsV1({ tenantId });
    await db.knowledgeV2Capability.createMany({
      data: defaults.map((definition) => ({
        id: definition.capabilityId,
        tenantId,
        capabilityType: definition.capabilityType,
        targetKey,
        enabled: definition.enabled,
        allowedAutonomy: definition.allowedAutonomy,
        templateKey: definition.templateKey,
        templateVersion: definition.templateVersion,
        serverOwned: definition.serverOwned,
      })),
      skipDuplicates: true,
    });
    const capabilities = await db.knowledgeV2Capability.findMany({
      where: { tenantId, targetKey },
      select: { id: true, capabilityType: true },
    });
    const capabilityIds = Object.fromEntries(
      capabilities.map((capability) => [capability.capabilityType, capability.id]),
    ) as Partial<Record<KnowledgeCapabilityTypeV1, string>>;
    if (defaults.some((definition) => !capabilityIds[definition.capabilityType])) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_CAPABILITY_SNAPSHOT_INVALID",
        "Default capabilities could not be reconciled.",
      );
    }
    const completeDefaults = buildDefaultKnowledgeCapabilityDefinitionsV1({
      tenantId,
      capabilityIds,
    });
    const requirementDefaults = completeDefaults.flatMap((capability) => {
      const capabilityId = capabilityIds[capability.capabilityType]!;
      return capability.requirements.map((requirement) => ({
        id: `kvr_v1_${canonicalKnowledgeV2Hash({
          capabilityId,
          requirementKey: requirement.requirementKey,
          definitionVersion: requirement.definitionVersion,
        }).slice(0, 32)}`,
        tenantId,
        capabilityId,
        requirementKey: requirement.requirementKey,
        definitionVersion: requirement.definitionVersion,
        kind: requirement.kind,
        severity: requirement.severity,
        riskLevel: requirement.riskLevel,
        active: requirement.active,
        freshnessSlaSeconds: requirement.freshnessSlaSeconds ?? null,
        requiredScope: requirement.requiredScope
          ? inputJson(requirement.requiredScope)
          : Prisma.DbNull,
        localeConstraints: requirement.localeConstraints
          ? inputJson(requirement.localeConstraints)
          : Prisma.DbNull,
        satisfactionPredicate: inputJson(requirement.satisfactionPredicate),
        predicateVersion: requirement.predicateVersion,
        templateOrigin: requirement.templateOrigin,
        tenantOverride: requirement.tenantOverride,
        immutableHash: canonicalKnowledgeV2Hash(requirement),
      }));
    });
    await db.knowledgeV2RequirementDefinition.createMany({
      data: requirementDefaults,
      skipDuplicates: true,
    });
    const persistedRequirements = await db.knowledgeV2RequirementDefinition.findMany({
      where: {
        tenantId,
        capabilityId: { in: capabilities.map((capability) => capability.id) },
      },
      select: {
        capabilityId: true,
        requirementKey: true,
        definitionVersion: true,
      },
    });
    const persistedRequirementKeys = new Set(
      persistedRequirements.map(
        (requirement) =>
          `${requirement.capabilityId}:${requirement.requirementKey}:${requirement.definitionVersion}`,
      ),
    );
    if (
      requirementDefaults.some(
        (requirement) =>
          !persistedRequirementKeys.has(
            `${requirement.capabilityId}:${requirement.requirementKey}:${requirement.definitionVersion}`,
          ),
      )
    ) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_CAPABILITY_SNAPSHOT_INVALID",
        "Default capability requirements could not be reconciled.",
      );
    }
  }

  private async evidence(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    selection: KnowledgeV2CapabilityEvidenceSelection,
    evaluatedAt: Date,
    options?: { lockOperationalAuthorization?: boolean },
  ): Promise<{
    evidence: KnowledgeCapabilityEvidenceV1[];
    operationalProjection: KnowledgeOperationalCapabilityProjectionV1;
  }> {
    const [
      facts,
      rules,
      revisions,
      integrations,
      evaluationResults,
      settings,
      operationalProjection,
    ] = await Promise.all([
      db.knowledgeV2FactVersion.findMany({
        where: { tenantId, id: { in: unique(selection.factVersionIds) } },
        include: {
          fact: {
            select: {
              id: true,
              factKey: true,
              fieldType: true,
              conflicts: {
                where: { status: { in: ["OPEN", "IN_REVIEW"] } },
                select: { id: true },
              },
            },
          },
        },
      }),
      db.knowledgeV2GuidanceRuleVersion.findMany({
        where: { tenantId, id: { in: unique(selection.guidanceRuleVersionIds) } },
        include: {
          guidanceRule: {
            select: {
              id: true,
              ruleKey: true,
              conflicts: {
                where: { status: { in: ["OPEN", "IN_REVIEW"] } },
                select: { id: true },
              },
            },
          },
        },
      }),
      db.knowledgeV2DocumentRevision.findMany({
        where: { tenantId, id: { in: unique(selection.documentRevisionIds) } },
        include: {
          document: {
            include: { source: { select: { kind: true, defaultLocale: true } } },
          },
        },
      }),
      db.integrationAccount.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ provider: "asc" }, { id: "asc" }],
      }),
      db.knowledgeV2EvaluationResult.findMany({
        where: {
          tenantId,
          testCaseVersionId: { not: null },
          evaluationRun: { status: "SUCCEEDED" },
        },
        include: {
          testCaseVersion: { include: { testCase: { select: { id: true, caseKey: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      db.knowledgeV2Settings.findUnique({ where: { tenantId } }),
      loadKnowledgeOperationalCapabilityProjectionV1(db, {
        tenantId,
        evaluatedAt,
        lock: options?.lockOperationalAuthorization === true,
      }),
    ]);
    const evidence: KnowledgeCapabilityEvidenceV1[] = [];
    for (const version of facts) {
      evidence.push({
        schemaVersion: 1,
        evidenceId: `fact:${version.id}`,
        kind: "FACT",
        ref: {
          type: "FACT_VERSION",
          id: version.fact.id,
          versionId: version.id,
          versionHash: version.immutableHash,
        },
        factKey: version.fact.factKey,
        fieldType: version.fact.fieldType,
        verificationStatus: version.verificationStatus,
        scope: scopeOrNull(version.scope),
        locales: [version.locale],
        observedAt: version.createdAt.toISOString(),
        effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
        effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
        activeConflictIds: version.fact.conflicts.map((conflict) => conflict.id),
      });
    }
    for (const version of rules) {
      evidence.push({
        schemaVersion: 1,
        evidenceId: `rule:${version.id}`,
        kind: "RULE",
        ref: {
          type: "GUIDANCE_RULE_VERSION",
          id: version.guidanceRule.id,
          versionId: version.id,
          versionHash: version.immutableHash,
        },
        ruleType: version.ruleType,
        reviewStatus: version.reviewStatus,
        scope: scopeOrNull(version.scope),
        observedAt: version.createdAt.toISOString(),
        effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
        effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
        activeConflictIds: version.guidanceRule.conflicts.map((conflict) => conflict.id),
      });
    }
    for (const revision of revisions) {
      const ready =
        !revision.deletedAt &&
        !revision.document.deletedAt &&
        !revision.document.tombstonedAt &&
        ["READY", "PUBLISHED"].includes(revision.status) &&
        ["ACTIVE", "DISCOVERED"].includes(revision.document.status);
      evidence.push({
        schemaVersion: 1,
        evidenceId: `document:${revision.id}`,
        kind: "DOCUMENT_COVERAGE",
        ref: {
          type: "DOCUMENT_REVISION",
          id: revision.document.id,
          versionId: revision.id,
          versionHash: revision.contentHash,
        },
        documentKey: revision.document.id,
        tags: unique([
          revision.document.classification,
          revision.document.source.kind,
          ...(ready ? ["APPROVED"] : []),
        ]),
        ready,
        coverageBps: ready ? 10_000 : 0,
        scope: scopeOrNull(revision.scopeSnapshot ?? revision.document.scope),
        locales: [revision.document.source.defaultLocale],
        observedAt: revision.createdAt.toISOString(),
        effectiveFrom: revision.effectiveFrom?.toISOString() ?? null,
        effectiveUntil: revision.effectiveUntil?.toISOString() ?? null,
        expiresAt: revision.staleAfter?.toISOString() ?? null,
      });
    }
    const connectorKeys: Partial<Record<(typeof integrations)[number]["provider"], string[]>> = {
      GOOGLE_CALENDAR: ["calendar", "google_calendar"],
      SHOPIFY: ["commerce_catalog", "shopify"],
      SHOP_SCRIPT: ["commerce_catalog", "shop_script"],
    };
    for (const integration of integrations) {
      for (const connectorKey of connectorKeys[integration.provider] ?? [
        integration.provider.toLowerCase(),
      ]) {
        evidence.push({
          schemaVersion: 1,
          evidenceId: `connector:${integration.id}:${connectorKey}`,
          kind: "CONNECTOR",
          ref: { type: "CONNECTOR", id: integration.id },
          connectorKey,
          connectorType: integration.provider,
          connected: integration.status === "CONNECTED",
          observedAt: (
            integration.lastSyncAt ??
            integration.connectedAt ??
            integration.updatedAt
          ).toISOString(),
        });
      }
    }
    for (const locale of settings?.supportedLocales ?? ["en"]) {
      evidence.push({
        schemaVersion: 1,
        evidenceId: `locale:${locale}`,
        kind: "LOCALE",
        ref: { type: "LOCALE", id: locale },
        locale,
        covered: true,
        observedAt: evaluatedAt.toISOString(),
      });
    }
    const seenCases = new Set<string>();
    for (const result of evaluationResults) {
      const testCase = result.testCaseVersion?.testCase;
      if (!testCase || seenCases.has(testCase.caseKey)) continue;
      seenCases.add(testCase.caseKey);
      evidence.push({
        schemaVersion: 1,
        evidenceId: `evaluation:${result.id}`,
        kind: "EVALUATION_CASE",
        ref: { type: "EVALUATION_CASE", id: testCase.id, versionId: result.testCaseVersionId },
        caseKey: testCase.caseKey,
        passed: result.status === "PASSED",
        observedAt: result.createdAt.toISOString(),
      });
    }
    evidence.push(...operationalProjection.evidence);
    return { evidence, operationalProjection };
  }

  private async revokeAutomaticReplies(tx: Prisma.TransactionClient, tenantId: string) {
    const channels = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Channel"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND "automaticRepliesEnabled" = true
      ORDER BY "id"
    `);
    const candidateChannelIds = channels.map((channel) => channel.id);
    if (candidateChannelIds.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Conversation"
      WHERE "tenantId" = ${tenantId}
        AND "channelId" IN (${Prisma.join(candidateChannelIds)})
        AND "deletedAt" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `);
    const lockedChannels = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Channel"
      WHERE "tenantId" = ${tenantId}
        AND "id" IN (${Prisma.join(candidateChannelIds)})
        AND "deletedAt" IS NULL
        AND "automaticRepliesEnabled" = true
      ORDER BY "id"
      FOR UPDATE
    `);
    const channelIds = lockedChannels.map((channel) => channel.id);
    if (channelIds.length === 0) return;
    await tx.channel.updateMany({
      where: { tenantId, id: { in: channelIds } },
      data: {
        automaticRepliesEnabled: false,
        automaticRepliesGeneration: { increment: 1 },
        automaticRepliesPublicationId: null,
        automaticRepliesPublicationEtag: null,
        automaticRepliesCapabilitySetHash: null,
        automaticRepliesOperationalBindingHash: null,
        automaticRepliesOperationalPermissionGeneration: null,
        automaticRepliesChannelFingerprint: null,
        automaticRepliesActivatedAt: null,
        automaticRepliesActivatedByUserId: null,
      },
    });
    await tx.$executeRaw(Prisma.sql`
      UPDATE "RuntimeOutbox" AS outbox
      SET "status" = 'DEAD_LETTER'::"RuntimeOutboxStatus",
          "lastErrorCode" = 'CAPABILITY_CONFIGURATION_CHANGED',
          "lastErrorMessage" = NULL,
          "lockedAt" = NULL,
          "lockExpiresAt" = NULL,
          "lockedBy" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE outbox."tenantId" = ${tenantId}
        AND outbox."eventType" = 'ai.reply.requested'
        AND outbox."status" IN (
          'PENDING'::"RuntimeOutboxStatus",
          'PUBLISHING'::"RuntimeOutboxStatus",
          'FAILED'::"RuntimeOutboxStatus"
        )
        AND EXISTS (
          SELECT 1
          FROM "Message" AS message
          JOIN "Conversation" AS conversation
            ON conversation."tenantId" = message."tenantId"
           AND conversation."id" = message."conversationId"
          WHERE message."tenantId" = outbox."tenantId"
            AND message."id" = outbox."aggregateId"
            AND conversation."channelId" IN (${Prisma.join(channelIds)})
        )
    `);
    await tx.aiReplyRun.updateMany({
      where: {
        tenantId,
        conversation: { channelId: { in: channelIds } },
        status: { in: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "FAILED", "CANCEL_REQUESTED"] },
      },
      data: {
        status: "SUPERSEDED",
        errorCode: "CAPABILITY_CONFIGURATION_CHANGED",
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation"
      SET "aiEnabled" = false,
          "aiGeneration" = "aiGeneration" + 1,
          "aiReplySequence" = "aiReplySequence" + 1,
          "aiReplyFence" = "aiReplySequence" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tenantId" = ${tenantId}
        AND "channelId" IN (${Prisma.join(channelIds)})
        AND "deletedAt" IS NULL
    `);
  }
}
