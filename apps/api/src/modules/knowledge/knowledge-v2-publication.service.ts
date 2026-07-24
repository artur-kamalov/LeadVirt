import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import {
  knowledgeV2DocumentPrefilterEnforcesScope,
  knowledgeV2StructuredAuthorizationFingerprint,
  lockKnowledgeCorpusTransition,
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS,
  KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION,
  parseKnowledgeV2TenantDefaultScopePolicy,
  parseKnowledgeV2SnapshotAuthorizationManifest,
  resolveKnowledgeV2StructuredScope,
  resolveKnowledgeV2PersistedAudiences,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2SnapshotAuthorizationManifest,
  KnowledgeV2StructuredScopeBinding,
  KnowledgeV2TenantDefaultScopePolicy,
} from "@leadvirt/knowledge";
import type {
  KnowledgeV2AcceptedMutation,
  KnowledgeV2CreatePublicationRequest,
  KnowledgeV2DraftStatus,
  KnowledgeV2ErrorCode,
  KnowledgeV2JobStage,
  KnowledgeV2JobView,
  KnowledgeV2MutationResult,
  KnowledgeV2OverviewView,
  KnowledgeV2PublicationDetail,
  KnowledgeV2PublicationGateView,
  KnowledgeV2PublicationItemCounts,
  KnowledgeV2PublicationPage,
  KnowledgeV2PublicationStatus,
  KnowledgeV2PublicationSummary,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessStatus,
  KnowledgeV2ReadinessView,
  KnowledgeV2ResourceRef,
  KnowledgeV2RollbackPublicationRequest,
  KnowledgeV2ValidatePublicationRequest,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  assertIfMatch,
  canonicalKnowledgeV2Hash,
  decodeKnowledgeV2Cursor,
  encodeKnowledgeV2Cursor,
  knowledgeV2Error,
  strongKnowledgeV2Etag,
} from "./knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";
import {
  KnowledgeV2CapabilityService,
  type KnowledgeV2CapabilityEvaluationBundle,
  type KnowledgeV2CapabilityEvidenceSelection,
} from "./knowledge-v2-capability.service.js";
import {
  assertKnowledgeV2PublicationEvaluationGate,
  knowledgeV2CurrentEvaluationSet,
} from "./knowledge-v2-evaluation-gate.js";
import { KnowledgeV2IndexPreparationService } from "./knowledge-v2-index-preparation.service.js";
import { knowledgeV2ScopeView as scopeView } from "./knowledge-v2-scope.js";
import { KnowledgeV2TestRunService } from "./knowledge-v2-test-run.service.js";

const targetKey = "workspace-v2";
const corpusKind = "STRUCTURED_V2";
const pipelineVersion = "knowledge-v2";
const validationPolicyVersion = "structured-v2-capability-snapshot-v2";
const validationTtlMs = 15 * 60 * 1000;
const activationDeadlineMs = 30 * 60 * 1000;

const publicationInclude = {
  items: {
    include: {
      factVersion: {
        select: {
          factId: true,
          immutableHash: true,
          lifecycleStatus: true,
          verificationStatus: true,
          effectiveFrom: true,
          effectiveUntil: true,
          riskLevel: true,
          authority: true,
          verifiedByUserId: true,
          scope: true,
          evidence: {
            select: {
              id: true,
              kind: true,
              label: true,
              locator: true,
              isPublic: true,
              legacyRevisionId: true,
              sourceReference: true,
              elementReference: true,
              quoteHash: true,
              confidence: true,
            },
            orderBy: { id: "asc" },
          },
          fact: {
            select: {
              factKey: true,
              deletedAt: true,
              latestVersionNumber: true,
              versions: {
                orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
                take: 1,
                select: {
                  versionNumber: true,
                  lifecycleStatus: true,
                  verificationStatus: true,
                },
              },
            },
          },
        },
      },
      guidanceRuleVersion: {
        select: {
          guidanceRuleId: true,
          immutableHash: true,
          title: true,
          reviewStatus: true,
          effectiveFrom: true,
          effectiveUntil: true,
          riskLevel: true,
          scope: true,
          requiredApproverRole: true,
          approvedByUserId: true,
          evidence: {
            select: {
              id: true,
              kind: true,
              label: true,
              locator: true,
              isPublic: true,
              legacyRevisionId: true,
              sourceReference: true,
              elementReference: true,
              quoteHash: true,
              confidence: true,
            },
            orderBy: { id: "asc" },
          },
          guidanceRule: {
            select: {
              deletedAt: true,
              latestVersionNumber: true,
              versions: {
                orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
                take: 1,
                select: { versionNumber: true, reviewStatus: true },
              },
            },
          },
        },
      },
      v2DocumentRevision: {
        select: {
          id: true,
          sourceId: true,
          documentId: true,
          contentHash: true,
          status: true,
          sourcePermissionFingerprint: true,
          scopeSnapshot: true,
          effectiveFrom: true,
          effectiveUntil: true,
          staleAfter: true,
          deletedAt: true,
          document: {
            select: {
              title: true,
              status: true,
              scope: true,
              audience: true,
              classification: true,
              permissionVersion: true,
              tombstonedAt: true,
              deletedAt: true,
              source: {
                select: {
                  id: true,
                  tenantId: true,
                  kind: true,
                  status: true,
                  generation: true,
                  etag: true,
                  sourcePermissionVersion: true,
                  defaultScope: true,
                  defaultClassification: true,
                  defaultLocale: true,
                  tombstonedAt: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ itemType: "asc" }, { itemId: "asc" }],
  },
  validation: true,
  indexSnapshot: {
    include: {
      v2Items: {
        select: {
          chunkId: true,
          contentHash: true,
          vectorPointId: true,
          chunk: {
            select: { revisionId: true, scope: true, locale: true, permissionVersion: true },
          },
        },
        orderBy: { chunkId: "asc" },
      },
    },
  },
  basePublication: {
    include: {
      items: {
        include: {
          factVersion: { select: { factId: true } },
          guidanceRuleVersion: { select: { guidanceRuleId: true } },
        },
      },
    },
  },
  activePointers: { select: { tenantId: true, targetKey: true, etag: true } },
  capabilitySnapshots: {
    orderBy: [{ capabilityType: "asc" }, { capabilityId: "asc" }],
  },
} satisfies Prisma.KnowledgePublicationInclude;

type PublicationRecord = Prisma.KnowledgePublicationGetPayload<{
  include: typeof publicationInclude;
}>;

type PublicationItemRecord = PublicationRecord["items"][number];

function capabilitySnapshotsMatch(
  publication: PublicationRecord,
  evaluation: KnowledgeV2CapabilityEvaluationBundle,
) {
  const executable = evaluation.snapshot.capabilities.filter((capability) => capability.executable);
  if (executable.length !== publication.capabilitySnapshots.length) return false;
  const snapshotsById = new Map(
    publication.capabilitySnapshots.map((snapshot) => [snapshot.capabilityId, snapshot]),
  );
  return executable.every((capability) => {
    const snapshot = snapshotsById.get(capability.capabilityId);
    return (
      snapshot?.capabilityType === capability.capabilityType &&
      snapshot.allowedAutonomy === capability.allowedAutonomy &&
      snapshot.capabilitySnapshotHash === capability.configurationHash &&
      snapshot.requirementEvaluationSetHash === capability.evaluationHash &&
      snapshot.operationalBindingHash === evaluation.operationalProjection.bindingHash &&
      snapshot.operationalPermissionGeneration ===
        evaluation.operationalProjection.permissionGeneration
    );
  });
}

function operationalBinding(bundle: KnowledgeV2CapabilityEvaluationBundle) {
  const projection = bundle.operationalProjection;
  if (projection.permissionGeneration === null) {
    throw knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_DEPENDENCY_OPERATIONAL_AUTHORIZATION_STATE_MISSING",
      "Operational authorization state must be restored before publishing.",
    );
  }
  return {
    operationalBindingSchemaVersion: projection.schemaVersion,
    operationalRegistryVersion: projection.registryVersion,
    operationalRegistryHash: projection.registryHash,
    operationalDependencySetHash: projection.dependencySetHash,
    operationalBindingHash: projection.bindingHash,
    operationalPermissionGeneration: projection.permissionGeneration,
  };
}

function operationalBindingMatches(
  record: {
    operationalBindingSchemaVersion: number | null;
    operationalRegistryVersion: string | null;
    operationalRegistryHash: string | null;
    operationalDependencySetHash: string | null;
    operationalBindingHash: string | null;
    operationalPermissionGeneration: number | null;
  },
  bundle: KnowledgeV2CapabilityEvaluationBundle,
) {
  const binding = operationalBinding(bundle);
  return (
    record.operationalBindingSchemaVersion === binding.operationalBindingSchemaVersion &&
    record.operationalRegistryVersion === binding.operationalRegistryVersion &&
    record.operationalRegistryHash === binding.operationalRegistryHash &&
    record.operationalDependencySetHash === binding.operationalDependencySetHash &&
    record.operationalBindingHash === binding.operationalBindingHash &&
    record.operationalPermissionGeneration === binding.operationalPermissionGeneration
  );
}

interface CandidateState {
  itemType: "FACT_VERSION" | "GUIDANCE_RULE_VERSION";
  itemId: string;
  itemVersionHash: string;
  stableId: string;
  label: string;
  scope: Prisma.JsonValue | null;
  authorizationFingerprint: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  eligible: boolean;
  denied: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  fact?: {
    lifecycleStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    verificationStatus: "UNVERIFIED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "CONFLICTED";
  };
  guidance?: {
    reviewStatus: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "DISABLED";
  };
}

interface CandidateManifestItem {
  itemType:
    | "DOCUMENT_REVISION"
    | "FACT_VERSION"
    | "GUIDANCE_RULE_VERSION"
    | "SOURCE_PERMISSION_SNAPSHOT";
  itemId: string;
  itemVersionHash: string;
  label: string;
  scope: Prisma.JsonValue | null;
  usesTenantDefaultScope: boolean;
  tenantDefaultScopeGeneration: number | null;
  tenantDefaultScopeHash: string | null;
  authorizationFingerprint: string;
}

interface CandidateProjection {
  candidateId: string;
  candidateVersion: number;
  basePublicationId: string | null;
  basePublicationSequence: number | null;
  manifestHash: string;
  items: CandidateManifestItem[];
  states: CandidateState[];
  blockers: KnowledgeV2PublicationGateView[];
  warnings: KnowledgeV2PublicationGateView[];
  validUntil: Date;
  itemCounts: KnowledgeV2PublicationItemCounts;
  settings: {
    publicationApprovalPolicy: "OWNER_ONLY" | "OWNER_OR_ADMIN";
    draftGeneration: number;
  };
  active: {
    publicationId: string;
    sequence: number;
    etag: number;
    manifestHash: string;
    status: KnowledgeV2PublicationStatus;
    corpusKind: "LEGACY_V1" | "STRUCTURED_V2";
    itemCounts: KnowledgeV2PublicationItemCounts;
    servingEligible: boolean;
  } | null;
}

interface PublicationListQuery {
  cursor?: string;
  limit?: number;
  targetKey?: string;
  status?: KnowledgeV2PublicationStatus;
}

function record(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function runtimePolicyVersions(
  settings: {
    retrievalProcessorPolicy: Prisma.JsonValue | null;
    modelProcessorPolicy: Prisma.JsonValue | null;
  } | null,
) {
  const retrieval = record(settings?.retrievalProcessorPolicy);
  const model = record(settings?.modelProcessorPolicy);
  if (
    retrieval.approved !== true ||
    typeof retrieval.policyVersion !== "string" ||
    !retrieval.policyVersion ||
    model.approved !== true ||
    typeof model.promptPolicyVersion !== "string" ||
    !model.promptPolicyVersion
  ) {
    return null;
  }
  return {
    retrievalPolicyVersion: retrieval.policyVersion,
    promptPolicyVersion: model.promptPolicyVersion,
  };
}

function sameScope(
  left: Prisma.JsonValue | null | undefined,
  right: Prisma.JsonValue | null | undefined,
) {
  return canonicalKnowledgeV2Hash(left ?? null) === canonicalKnowledgeV2Hash(right ?? null);
}

function persistedScopeJson(scope: KnowledgeV2StructuredScopeBinding["scope"]): Prisma.JsonValue {
  return scope as unknown as Prisma.JsonValue;
}

function sameScopeBinding(
  item: Pick<
    CandidateManifestItem,
    "scope" | "usesTenantDefaultScope" | "tenantDefaultScopeGeneration" | "tenantDefaultScopeHash"
  >,
  binding: KnowledgeV2StructuredScopeBinding,
) {
  return (
    sameScope(item.scope, persistedScopeJson(binding.scope)) &&
    item.usesTenantDefaultScope === binding.usesTenantDefaultScope &&
    item.tenantDefaultScopeGeneration === binding.tenantDefaultScopeGeneration &&
    item.tenantDefaultScopeHash === binding.tenantDefaultScopeHash
  );
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function itemCounts(items: ReadonlyArray<{ itemType: string }>): KnowledgeV2PublicationItemCounts {
  return {
    documentRevisions: items.filter((item) => item.itemType === "DOCUMENT_REVISION").length,
    factVersions: items.filter((item) => item.itemType === "FACT_VERSION").length,
    guidanceRuleVersions: items.filter((item) => item.itemType === "GUIDANCE_RULE_VERSION").length,
    sourcePermissionSnapshots: items.filter(
      (item) => item.itemType === "SOURCE_PERMISSION_SNAPSHOT",
    ).length,
  };
}

function capabilitySelectionFromProjection(
  projection: Pick<CandidateProjection, "items" | "states">,
): KnowledgeV2CapabilityEvidenceSelection {
  return {
    factVersionIds: projection.states.flatMap((state) =>
      state.itemType === "FACT_VERSION" ? [state.itemId] : [],
    ),
    guidanceRuleVersionIds: projection.states.flatMap((state) =>
      state.itemType === "GUIDANCE_RULE_VERSION" ? [state.itemId] : [],
    ),
    documentRevisionIds: projection.items.flatMap((item) =>
      item.itemType === "DOCUMENT_REVISION" ? [item.itemId] : [],
    ),
  };
}

function capabilitySelectionFromItems(
  items: ReadonlyArray<{ itemType: string; itemId: string }>,
): KnowledgeV2CapabilityEvidenceSelection {
  return {
    factVersionIds: items.flatMap((item) =>
      item.itemType === "FACT_VERSION" ? [item.itemId] : [],
    ),
    guidanceRuleVersionIds: items.flatMap((item) =>
      item.itemType === "GUIDANCE_RULE_VERSION" ? [item.itemId] : [],
    ),
    documentRevisionIds: items.flatMap((item) =>
      item.itemType === "DOCUMENT_REVISION" ? [item.itemId] : [],
    ),
  };
}

export function knowledgeV2ReadinessRemediation(
  code: string,
  resource: KnowledgeV2ResourceRef,
  target: {
    task?: string | null;
    sourceId?: string | null;
    documentId?: string | null;
    revisionId?: string | null;
  } = {},
) {
  const view =
    resource.type === "FACT" || resource.type === "SETTINGS"
      ? ("business" as const)
      : resource.type === "GUIDANCE_RULE"
        ? ("guidance" as const)
        : ["SOURCE", "ARTIFACT", "DOCUMENT", "REVISION", "CHUNK"].includes(resource.type)
          ? ("sources" as const)
          : resource.type === "CAPABILITY"
            ? ("overview" as const)
            : resource.type === "REVIEW_ITEM" || resource.type === "CONFLICT"
              ? ("review" as const)
              : ["TEST_CASE", "EVALUATION_RUN", "EVALUATION_RESULT"].includes(resource.type)
                ? ("test" as const)
                : ("history" as const);
  const task =
    target.task !== undefined
      ? target.task
      : code === "KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED"
        ? "verify-services"
        : resource.type === "FACT"
          ? "verify-fact"
          : null;
  return {
    action: "OPEN_RESOURCE",
    label: "Open",
    resource,
    destination: {
      view,
      task,
      resource,
      ...(target.sourceId ? { sourceId: target.sourceId } : {}),
      ...(target.documentId ? { documentId: target.documentId } : {}),
      ...(target.revisionId ? { revisionId: target.revisionId } : {}),
    },
  };
}

export function knowledgeV2FactReadinessLabel(
  factKey: string,
  displayValue: string | null | undefined,
) {
  return displayValue?.trim() || factKey;
}

function gate(
  code: string,
  status: "WARNING" | "BLOCKED",
  title: string,
  message: string,
  resource?: KnowledgeV2ResourceRef,
  target?: {
    task?: string | null;
    sourceId?: string | null;
    documentId?: string | null;
    revisionId?: string | null;
  },
): KnowledgeV2PublicationGateView {
  return {
    code,
    status,
    title,
    message,
    ...(resource
      ? {
          resource,
          remediation: knowledgeV2ReadinessRemediation(code, resource, target),
        }
      : {}),
  };
}

function dateValue(value: Date | null) {
  return value?.toISOString() ?? null;
}

function isEffective(from: Date | null, until: Date | null, now: Date) {
  return (!from || from <= now) && (!until || until > now);
}

function itemManifestValue(item: CandidateManifestItem) {
  return {
    itemType: item.itemType,
    itemId: item.itemId,
    itemVersionHash: item.itemVersionHash,
    scope: item.scope,
    ...(item.usesTenantDefaultScope
      ? {
          usesTenantDefaultScope: true,
          tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: item.tenantDefaultScopeHash,
        }
      : {}),
    authorizationFingerprint: item.authorizationFingerprint,
  };
}

function compareCanonicalText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manifestHash(items: CandidateManifestItem[]) {
  return canonicalKnowledgeV2Hash(
    items
      .map(itemManifestValue)
      .sort((left, right) =>
        compareCanonicalText(
          `${left.itemType}:${left.itemId}`,
          `${right.itemType}:${right.itemId}`,
        ),
      ),
  );
}

function documentSnapshotManifestHash(
  items: readonly CandidateManifestItem[],
  indexSchemaHash: string,
) {
  return canonicalKnowledgeV2Hash({
    version: 1,
    corpusKind,
    documents: items
      .filter((item) => item.itemType === "DOCUMENT_REVISION")
      .map((item) => ({
        revisionId: item.itemId,
        contentHash: item.itemVersionHash,
        authorizationFingerprint: item.authorizationFingerprint,
        scope: item.scope,
      }))
      .sort((left, right) => compareCanonicalText(left.revisionId, right.revisionId)),
    indexSchemaHash,
  });
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseGates(value: Prisma.JsonValue | null): KnowledgeV2PublicationGateView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).code === "string",
  ) as unknown as KnowledgeV2PublicationGateView[];
}

function parseManifestItems(value: Prisma.JsonValue): CandidateManifestItem[] {
  if (!Array.isArray(value)) {
    throw knowledgeV2Error(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "KNOWLEDGE_DEPENDENCY_MANIFEST_INVALID",
      "The validated knowledge manifest is unavailable.",
    );
  }
  const items: CandidateManifestItem[] = [];
  for (const valueItem of value) {
    const item = record(valueItem);
    if (
      typeof item.itemType !== "string" ||
      ![
        "DOCUMENT_REVISION",
        "FACT_VERSION",
        "GUIDANCE_RULE_VERSION",
        "SOURCE_PERMISSION_SNAPSHOT",
      ].includes(item.itemType) ||
      typeof item.itemId !== "string" ||
      typeof item.itemVersionHash !== "string" ||
      (item.usesTenantDefaultScope !== undefined &&
        typeof item.usesTenantDefaultScope !== "boolean") ||
      typeof item.authorizationFingerprint !== "string"
    ) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_MANIFEST_INVALID",
        "The validated knowledge manifest is unavailable.",
      );
    }
    const tenantDefaultScopeGeneration =
      typeof item.tenantDefaultScopeGeneration === "number" &&
      Number.isSafeInteger(item.tenantDefaultScopeGeneration)
        ? item.tenantDefaultScopeGeneration
        : null;
    const tenantDefaultScopeHash =
      typeof item.tenantDefaultScopeHash === "string" ? item.tenantDefaultScopeHash : null;
    const usesTenantDefaultScope = item.usesTenantDefaultScope === true;
    if (
      usesTenantDefaultScope
        ? !tenantDefaultScopeGeneration ||
          tenantDefaultScopeGeneration < 1 ||
          !tenantDefaultScopeHash ||
          !/^[a-f0-9]{64}$/u.test(tenantDefaultScopeHash)
        : tenantDefaultScopeGeneration !== null || tenantDefaultScopeHash !== null
    ) {
      throw knowledgeV2Error(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "KNOWLEDGE_DEPENDENCY_MANIFEST_INVALID",
        "The validated knowledge manifest is unavailable.",
      );
    }
    scopeView(item.scope ?? null);
    items.push({
      itemType: item.itemType as CandidateManifestItem["itemType"],
      itemId: item.itemId,
      itemVersionHash: item.itemVersionHash,
      label: typeof item.label === "string" ? item.label : item.itemId,
      scope: item.scope ?? null,
      usesTenantDefaultScope,
      tenantDefaultScopeGeneration,
      tenantDefaultScopeHash,
      authorizationFingerprint: item.authorizationFingerprint,
    });
  }
  return items.sort((left, right) =>
    compareCanonicalText(`${left.itemType}:${left.itemId}`, `${right.itemType}:${right.itemId}`),
  );
}

function qualityMetadata(value: Prisma.JsonValue | null) {
  const data = record(value);
  return {
    operation: typeof data.operation === "string" ? data.operation : null,
    actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : null,
    sourcePublicationId:
      typeof data.sourcePublicationId === "string" ? data.sourcePublicationId : null,
    rollbackReason: typeof data.rollbackReason === "string" ? data.rollbackReason : null,
    candidateId: typeof data.candidateId === "string" ? data.candidateId : null,
    candidateVersion:
      typeof data.candidateVersion === "number" && Number.isInteger(data.candidateVersion)
        ? data.candidateVersion
        : null,
    approvedAt: typeof data.approvedAt === "string" ? data.approvedAt : null,
    validationId: typeof data.validationId === "string" ? data.validationId : null,
  };
}

function semanticItemKey(item: PublicationItemRecord) {
  if (item.itemType === "FACT_VERSION") return `FACT:${item.factVersion?.factId ?? item.itemId}`;
  if (item.itemType === "GUIDANCE_RULE_VERSION") {
    return `GUIDANCE:${item.guidanceRuleVersion?.guidanceRuleId ?? item.itemId}`;
  }
  return `${item.itemType}:${item.itemId}`;
}

function publicationDiffValue(item: PublicationItemRecord) {
  return canonicalKnowledgeV2Hash({
    itemId: item.itemId,
    itemVersionHash: item.itemVersionHash,
    scope: item.scope,
    usesTenantDefaultScope: item.usesTenantDefaultScope,
    tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
    tenantDefaultScopeHash: item.tenantDefaultScopeHash,
    authorizationFingerprint: item.authorizationFingerprint,
  });
}

function publicationDiff(publication: PublicationRecord) {
  if (!publication.basePublication) return null;
  const current = new Map(
    publication.items.map((item) => [semanticItemKey(item), publicationDiffValue(item)]),
  );
  const base = new Map(
    publication.basePublication.items.map((item) => [
      semanticItemKey(item as PublicationItemRecord),
      publicationDiffValue(item as PublicationItemRecord),
    ]),
  );
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [key, value] of current) {
    if (!base.has(key)) added += 1;
    else if (base.get(key) !== value) updated += 1;
  }
  for (const key of base.keys()) {
    if (!current.has(key)) removed += 1;
  }
  return { added, updated, removed };
}

type KnowledgeDb = Pick<
  Prisma.TransactionClient,
  | "activeKnowledgePublication"
  | "knowledgeV2Conflict"
  | "knowledgeV2Document"
  | "knowledgeV2Fact"
  | "knowledgeV2GuidanceRule"
  | "knowledgeV2ReviewItem"
  | "knowledgeV2Settings"
>;

type ValidationRecord = Prisma.KnowledgeV2PublicationValidationGetPayload<Record<string, never>>;
type JobRecord = Prisma.KnowledgeJobGetPayload<Record<string, never>>;

const activationEventType = "knowledge.v2.publication.activate.requested";
const activeStages = new Set(["QUEUED", "RUNNING", "RETRY_SCHEDULED"]);
const failedStages = new Set(["FAILED", "DEAD_LETTER"]);
const jobStages = new Set<KnowledgeV2JobStage>([
  "QUEUED",
  "ACQUIRING",
  "SCANNING",
  "PARSING",
  "NORMALIZING",
  "EXTRACTING",
  "CHUNKING",
  "INDEXING",
  "EVALUATING",
  "VALIDATING",
  "PUBLISHING",
  "ROLLING_BACK",
  "RECONCILING",
  "CLEANING_UP",
]);

function actor(userId: string | null) {
  return userId ? { id: userId, displayName: "Workspace member" } : null;
}

function authorizationFingerprint(input: {
  itemType: CandidateState["itemType"];
  binding: KnowledgeV2StructuredScopeBinding;
  riskLevel: CandidateState["riskLevel"];
  authority: Record<string, unknown>;
  evidence: ReadonlyArray<{
    id: string;
    kind: string;
    label: string;
    locator: string | null;
    isPublic: boolean;
    legacyRevisionId: string | null;
    sourceReference: Prisma.JsonValue | null;
    elementReference: Prisma.JsonValue | null;
    quoteHash: string | null;
    confidence: number | null;
  }>;
}) {
  return knowledgeV2StructuredAuthorizationFingerprint(input);
}

function sourcePermissionFingerprint(input: {
  tenantId: string;
  id: string;
  sourcePermissionVersion: number;
  defaultScope: Prisma.JsonValue | null;
  defaultClassification: string;
  defaultLocale: string;
}) {
  return canonicalKnowledgeV2Hash({
    tenantId: input.tenantId,
    sourceId: input.id,
    permissionVersion: input.sourcePermissionVersion,
    scope: input.defaultScope,
    classification: input.defaultClassification,
    locale: input.defaultLocale,
  });
}

function validationStatus(
  recordValue: ValidationRecord,
): KnowledgeV2PublicationValidationView["status"] {
  if (recordValue.status === "PASSED") {
    return parseGates(recordValue.warnings).length > 0 ? "PASSED_WITH_WARNINGS" : "PASSED";
  }
  if (recordValue.status === "PENDING") return "PENDING";
  return "FAILED";
}

function validationView(recordValue: ValidationRecord): KnowledgeV2PublicationValidationView {
  const blockers = parseGates(recordValue.blockers);
  const warnings = parseGates(recordValue.warnings);
  const items = parseManifestItems(recordValue.candidateItems);
  return {
    id: recordValue.id,
    candidateId: recordValue.candidateId,
    candidateVersion: recordValue.candidateVersion,
    candidateManifestHash: recordValue.candidateManifestHash,
    targetKey: recordValue.targetKey,
    status: validationStatus(recordValue),
    itemCounts: itemCounts(items),
    blockers,
    warnings,
    capabilitySetHash: recordValue.capabilitySetHash,
    requirementEvaluationSetHash: recordValue.requirementEvaluationSetHash,
    evaluatedAt: (recordValue.evaluatedAt ?? recordValue.createdAt).toISOString(),
    validUntil: dateValue(recordValue.validUntil),
    version: recordValue.candidateVersion,
    etag: strongKnowledgeV2Etag(
      "publication-validation",
      recordValue.id,
      recordValue.candidateManifestHash,
    ),
  };
}

function isKnowledgeErrorCode(value: string): value is KnowledgeV2ErrorCode {
  return (
    value === "IDEMPOTENCY_KEY_REUSED" ||
    value === "REVISION_CONFLICT" ||
    /^KNOWLEDGE_(VALIDATION|SOURCE|UPLOAD|PARSE|SECURITY|CONFLICT|PUBLICATION|PERMISSION|QUOTA|DEPENDENCY)_/.test(
      value,
    )
  );
}

function jobView(job: JobRecord): KnowledgeV2JobView {
  const total = job.progressTotal;
  const completed = Math.max(0, job.progressCompleted);
  const stage = jobStages.has(job.stage as KnowledgeV2JobStage)
    ? (job.stage as KnowledgeV2JobStage)
    : "RECONCILING";
  const resources: KnowledgeV2ResourceRef[] = [];
  if (job.publicationId) resources.push({ type: "PUBLICATION", id: job.publicationId });
  if (job.v2SourceId) resources.push({ type: "SOURCE", id: job.v2SourceId });
  if (job.v2RevisionId) resources.push({ type: "REVISION", id: job.v2RevisionId });
  const contentResource = job.payloadRef?.match(
    /^content-reconciliation:(FACT|GUIDANCE_RULE):([^:]+):[^:]+$/u,
  );
  if (contentResource?.[1] && contentResource[2]) {
    resources.push({
      type: contentResource[1] === "FACT" ? "FACT" : "GUIDANCE_RULE",
      id: contentResource[2],
    });
  }
  const errorCode = job.errorCode && isKnowledgeErrorCode(job.errorCode) ? job.errorCode : null;
  return {
    id: job.id,
    stage,
    status: job.status,
    progress: {
      completed,
      total,
      percent: total && total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : null,
      label:
        job.status === "SUCCEEDED"
          ? "Completed"
          : job.status === "RUNNING"
            ? "Processing"
            : job.status === "RETRY_SCHEDULED"
              ? "Retry scheduled"
              : job.status === "QUEUED"
                ? "Queued"
                : "Not completed",
    },
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    resources,
    error: errorCode
      ? {
          code: errorCode,
          message: "Knowledge processing did not complete.",
          retryable: job.status === "RETRY_SCHEDULED",
        }
      : null,
    createdAt: job.createdAt.toISOString(),
    startedAt: dateValue(job.startedAt),
    nextAttemptAt: job.status === "RETRY_SCHEDULED" ? job.availableAt.toISOString() : null,
    completedAt: dateValue(job.completedAt),
  };
}

function publicationItemView(item: PublicationItemRecord) {
  if (item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision) {
    return {
      type: "DOCUMENT_REVISION" as const,
      id: item.v2DocumentRevision.documentId,
      versionId: item.itemId,
      label: item.v2DocumentRevision.document.title,
      scope: scopeView(item.scope),
      usesTenantDefaultScope: item.usesTenantDefaultScope,
      tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
      tenantDefaultScopeHash: item.tenantDefaultScopeHash,
    };
  }
  if (item.itemType === "FACT_VERSION" && item.factVersion) {
    return {
      type: "FACT_VERSION" as const,
      id: item.factVersion.factId,
      versionId: item.itemId,
      label: item.factVersion.fact.factKey,
      scope: scopeView(item.scope),
      usesTenantDefaultScope: item.usesTenantDefaultScope,
      tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
      tenantDefaultScopeHash: item.tenantDefaultScopeHash,
    };
  }
  if (item.itemType === "GUIDANCE_RULE_VERSION" && item.guidanceRuleVersion) {
    return {
      type: "GUIDANCE_RULE_VERSION" as const,
      id: item.guidanceRuleVersion.guidanceRuleId,
      versionId: item.itemId,
      label: item.guidanceRuleVersion.title,
      scope: scopeView(item.scope),
      usesTenantDefaultScope: item.usesTenantDefaultScope,
      tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
      tenantDefaultScopeHash: item.tenantDefaultScopeHash,
    };
  }
  if (item.itemType === "SOURCE_PERMISSION_SNAPSHOT") {
    return {
      type: "SOURCE_PERMISSION_SNAPSHOT" as const,
      id: item.itemId,
      versionId: item.itemId,
      label: "Source permission snapshot",
      scope: scopeView(item.scope),
      usesTenantDefaultScope: item.usesTenantDefaultScope,
      tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
      tenantDefaultScopeHash: item.tenantDefaultScopeHash,
    };
  }
  throw knowledgeV2Error(
    HttpStatus.INTERNAL_SERVER_ERROR,
    "KNOWLEDGE_DEPENDENCY_MANIFEST_INVALID",
    "The publication manifest contains an unsupported item.",
  );
}

@Injectable()
export class KnowledgeV2PublicationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(KnowledgeV2TestRunService)
    private readonly testRuns: KnowledgeV2TestRunService,
    @Optional()
    @Inject(KnowledgeV2IndexPreparationService)
    private readonly indexPreparation?: KnowledgeV2IndexPreparationService,
    @Optional()
    @Inject(KnowledgeV2CapabilityService)
    private readonly capabilityService?: KnowledgeV2CapabilityService,
  ) {}

  private capabilities() {
    return (
      this.capabilityService ?? new KnowledgeV2CapabilityService(this.prisma, this.idempotency)
    );
  }

  async getOverview(context: RequestContext): Promise<KnowledgeV2OverviewView> {
    const [readiness, counts, recentJobs, latestDraft] = await Promise.all([
      this.getReadiness(context),
      this.prisma.$transaction(async (tx) => {
        const projection = await this.candidateProjection(tx, context.tenantId);
        const [sources, facts, guidanceRules, reviewItems, failedJobs] = await Promise.all([
          tx.businessKnowledgeSource.count({
            where: { tenantId: context.tenantId, status: "ACTIVE", deletedAt: null },
          }),
          tx.knowledgeV2Fact.count({ where: { tenantId: context.tenantId, deletedAt: null } }),
          tx.knowledgeV2GuidanceRule.count({
            where: { tenantId: context.tenantId, deletedAt: null },
          }),
          tx.knowledgeV2ReviewItem.count({
            where: {
              tenantId: context.tenantId,
              status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
            },
          }),
          tx.knowledgeJob.count({
            where: {
              tenantId: context.tenantId,
              pipelineVersion,
              status: { in: ["FAILED", "DEAD_LETTER"] },
            },
          }),
        ]);
        return {
          sources,
          facts,
          guidanceRules,
          reviewItems:
            reviewItems +
            projection.states.filter((state) => !state.eligible && !state.denied).length,
          failedJobs,
          policy: projection.settings.publicationApprovalPolicy,
        };
      }),
      this.prisma.knowledgeJob.findMany({
        where: { tenantId: context.tenantId, pipelineVersion },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
      }),
      this.prisma.knowledgePublication.findFirst({
        where: {
          tenantId: context.tenantId,
          targetKey,
          corpusKind,
          status: { in: ["VALIDATING", "READY", "PUBLISHING", "FAILED"] },
        },
        include: publicationInclude,
        orderBy: [{ sequence: "desc" }, { id: "desc" }],
      }),
    ]);
    const canApprove = this.canApprove(context, counts.policy);
    return {
      readiness,
      activePublication: readiness.activePublicationId
        ? await this.getPublication(context, readiness.activePublicationId)
        : null,
      latestDraftPublication: latestDraft
        ? this.publicationSummary(latestDraft, context, canApprove)
        : null,
      counts: {
        sources: counts.sources,
        facts: counts.facts,
        guidanceRules: counts.guidanceRules,
        reviewItems: counts.reviewItems,
        failedJobs: counts.failedJobs,
      },
      recentJobs: recentJobs.map(jobView),
      permissions: {
        canViewRestricted: ["OWNER", "ADMIN", "MANAGER"].includes(context.role),
        canEdit: ["OWNER", "ADMIN", "MANAGER"].includes(context.role),
        canManageSettings: ["OWNER", "ADMIN"].includes(context.role),
        canVerifyHighRisk: ["OWNER", "ADMIN"].includes(context.role),
        canPublish: canApprove,
        canRollback: canApprove,
      },
    };
  }

  async getReadiness(context: RequestContext): Promise<KnowledgeV2ReadinessView> {
    return this.prisma.$transaction(async (tx) => {
      const evaluatedAtDate = new Date();
      const projection = await this.candidateProjection(tx, context.tenantId, evaluatedAtDate);
      const [latestJob, currentEvaluationSet, draftCapabilities, servingCapabilities] =
        await Promise.all([
          tx.knowledgeJob.findFirst({
            where: { tenantId: context.tenantId, pipelineVersion },
            include: { publication: { select: { manifestHash: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
          knowledgeV2CurrentEvaluationSet(tx, context.tenantId),
          this.capabilities().evaluateSelection(
            tx,
            context.tenantId,
            capabilitySelectionFromProjection(projection),
            evaluatedAtDate,
          ),
          projection.active
            ? this.capabilities().publicationReadiness(
                tx,
                context.tenantId,
                projection.active.publicationId,
              )
            : Promise.resolve({
                capabilitySetHash: null,
                requirementEvaluationSetHash: null,
                views: [],
                blockers: [] as KnowledgeV2PublicationGateView[],
                warnings: [] as KnowledgeV2PublicationGateView[],
                valid: false,
              }),
        ]);
      const currentValidation = await tx.knowledgeV2PublicationValidation.findFirst({
        where: {
          tenantId: context.tenantId,
          corpusKind,
          targetKey,
          candidateId: projection.candidateId,
          candidateVersion: projection.candidateVersion,
          candidateManifestHash: projection.manifestHash,
          capabilitySetHash: draftCapabilities.snapshot.capabilitySetHash,
          validationPolicyVersion,
          status: "PASSED",
          validUntil: { gt: evaluatedAtDate },
        },
        select: { id: true },
        orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
      });
      const mappedJob = latestJob ? jobView(latestJob) : null;
      const jobMatchesCandidate = latestJob?.publication?.manifestHash === projection.manifestHash;
      let draftStatus: KnowledgeV2DraftStatus;
      if (latestJob && jobMatchesCandidate && activeStages.has(latestJob.status)) {
        draftStatus = "PROCESSING";
      } else if (latestJob && jobMatchesCandidate && failedStages.has(latestJob.status)) {
        draftStatus = "FAILED";
      } else if (projection.active?.manifestHash === projection.manifestHash) {
        draftStatus = "UP_TO_DATE";
      } else {
        draftStatus = "CHANGES_PENDING";
      }

      const publicationServingBlockers = projection.active?.servingEligible
        ? []
        : [
            gate(
              projection.active
                ? "KNOWLEDGE_PUBLICATION_SERVING_AUTHORIZATION_STALE"
                : "KNOWLEDGE_PUBLICATION_REQUIRED",
              "BLOCKED",
              projection.active ? "Serving publication needs review" : "Publication required",
              projection.active
                ? "Current authorization or tombstone state blocks the active manifest."
                : "Publish verified knowledge before enabling structured answers.",
              { type: "PUBLICATION", id: targetKey },
            ),
          ];
      const servingBlockers = [
        ...publicationServingBlockers,
        ...(projection.active ? servingCapabilities.blockers : []),
      ];
      const draftBlockers = [...projection.blockers, ...draftCapabilities.blockers];
      const draftWarnings = [...projection.warnings, ...draftCapabilities.warnings];
      const blockerCount = draftBlockers.length + servingBlockers.length;
      const warningCount = draftWarnings.length + servingCapabilities.warnings.length;
      const unresolvedReviewResources = new Set(
        [...projection.blockers, ...projection.warnings].flatMap((item) =>
          item.resource && ["REVIEW_ITEM", "CONFLICT"].includes(item.resource.type)
            ? [`${item.resource.type}:${item.resource.id}`]
            : [],
        ),
      );
      const needsReviewCount =
        projection.states.filter((state) => !state.eligible && !state.denied).length +
        unresolvedReviewResources.size;
      let status: KnowledgeV2ReadinessStatus;
      if (draftStatus === "PROCESSING") status = "UPDATING";
      else if (blockerCount > 0) status = "BLOCKED";
      else if (needsReviewCount > 0 || draftStatus === "CHANGES_PENDING") status = "NEEDS_REVIEW";
      else if (warningCount > 0) status = "READY_WITH_WARNINGS";
      else status = "READY";

      return {
        targetKey,
        candidateId: projection.candidateId,
        candidateVersion: projection.candidateVersion,
        candidateManifestHash: projection.manifestHash,
        activePublicationId: projection.active?.publicationId ?? null,
        activePublicationSequence: projection.active?.sequence ?? null,
        status,
        serving: {
          status:
            projection.active?.servingEligible && servingCapabilities.valid ? "READY" : "NOT_READY",
          activePublicationId: projection.active?.publicationId ?? null,
          activePublicationSequence: projection.active?.sequence ?? null,
          activeEtag: projection.active
            ? this.activeEtag(context.tenantId, projection.active)
            : null,
          itemCounts: projection.active?.itemCounts ?? itemCounts([]),
          blockers: servingBlockers,
          capabilitySetHash: servingCapabilities.capabilitySetHash,
          requirementEvaluationSetHash: servingCapabilities.requirementEvaluationSetHash,
          capabilities: servingCapabilities.views,
        },
        draft: {
          status: draftStatus,
          candidateId: projection.candidateId,
          candidateVersion: projection.candidateVersion,
          candidateManifestHash: projection.manifestHash,
          validationId: currentValidation?.id ?? null,
          evaluationTestCaseSetHash: currentEvaluationSet.testCaseSetHash,
          itemCounts: projection.itemCounts,
          blockers: draftBlockers,
          warnings: draftWarnings,
          latestJob: mappedJob,
          capabilitySetHash: draftCapabilities.snapshot.capabilitySetHash,
          requirementEvaluationSetHash: draftCapabilities.snapshot.requirementEvaluationSetHash,
          capabilities: draftCapabilities.views,
        },
        capabilities: draftCapabilities.views,
        blockerCount,
        warningCount,
        needsReviewCount,
        evaluatedAt: evaluatedAtDate.toISOString(),
      };
    });
  }

  async assertAutomaticReplyServingReady(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; publicationId: string; evaluatedAt?: Date },
  ) {
    const evaluatedAt = input.evaluatedAt ?? new Date();
    const publication = await tx.knowledgePublication.findFirst({
      where: {
        id: input.publicationId,
        tenantId: input.tenantId,
        targetKey,
        corpusKind,
        status: "ACTIVE",
      },
      include: publicationInclude,
    });
    const active = publication?.activePointers.some(
      (pointer) => pointer.tenantId === input.tenantId && pointer.targetKey === targetKey,
    );
    if (!publication || !active) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_AUTOMATIC_REPLIES_NOT_READY",
        "The active publication is not ready for automatic replies.",
      );
    }
    const defaultScopePolicy = await this.currentDefaultScopePolicy(tx, input.tenantId);
    const eligibleDocumentSourceIds = new Set(
      publication.items.flatMap((item) =>
        item.itemType === "DOCUMENT_REVISION" &&
        item.v2DocumentRevision &&
        this.publicationItemEligible(item, evaluatedAt, defaultScopePolicy)
          ? [item.v2DocumentRevision.sourceId]
          : [],
      ),
    );
    const servingItemsReady = publication.items.every(
      (item) =>
        this.publicationItemEligible(item, evaluatedAt, defaultScopePolicy) &&
        (item.itemType !== "SOURCE_PERMISSION_SNAPSHOT" ||
          eligibleDocumentSourceIds.has(item.itemId)),
    );
    const capabilityEvaluation = await this.capabilities().evaluateSelection(
      tx,
      input.tenantId,
      capabilitySelectionFromItems(publication.items),
      evaluatedAt,
      { lockOperationalAuthorization: true },
    );
    if (
      !servingItemsReady ||
      capabilityEvaluation.blockers.length > 0 ||
      capabilityEvaluation.snapshot.capabilitySetHash !== publication.capabilitySetHash ||
      capabilityEvaluation.snapshot.requirementEvaluationSetHash !==
        publication.requirementEvaluationSetHash ||
      !operationalBindingMatches(publication, capabilityEvaluation) ||
      !capabilitySnapshotsMatch(publication, capabilityEvaluation)
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_AUTOMATIC_REPLIES_NOT_READY",
        "Publication evidence or authorization changed before automatic-reply activation.",
      );
    }
    return operationalBinding(capabilityEvaluation);
  }

  async getActivePublication(context: RequestContext) {
    return (await this.getActivePublicationWithEtag(context)).publication;
  }

  async getActivePublicationWithEtag(
    context: RequestContext,
  ): Promise<{ publication: KnowledgeV2PublicationDetail | null; etag: string }> {
    const pointer = await this.prisma.activeKnowledgePublication.findUnique({
      where: { tenantId_targetKey: { tenantId: context.tenantId, targetKey } },
      include: { publication: { include: publicationInclude } },
    });
    if (!pointer) {
      return {
        publication: null,
        etag: this.emptyActiveEtag(context.tenantId),
      };
    }
    if (
      pointer.publication.corpusKind !== corpusKind ||
      pointer.publication.targetKey !== targetKey ||
      pointer.publication.status !== "ACTIVE"
    ) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_ACTIVE_PUBLICATION_INVALID",
        "The active structured knowledge publication is inconsistent.",
        { retryable: true },
      );
    }
    const canRollback = await this.canApproveForContext(context);
    return {
      publication: this.publicationDetail(pointer.publication, context, canRollback),
      etag: this.activeEtag(context.tenantId, {
        publicationId: pointer.publicationId,
        sequence: pointer.sequence,
        etag: pointer.etag,
      }),
    };
  }

  async listPublications(
    context: RequestContext,
    query: PublicationListQuery = {},
  ): Promise<KnowledgeV2PublicationPage> {
    this.assertTarget(query.targetKey ?? targetKey);
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 25)));
    const cursor = decodeKnowledgeV2Cursor(query.cursor);
    const rows = await this.prisma.knowledgePublication.findMany({
      where: {
        tenantId: context.tenantId,
        targetKey,
        corpusKind,
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: publicationInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNextPage = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const canRollback = await this.canApproveForContext(context);
    return {
      items: pageRows.map((publication) =>
        this.publicationSummary(publication, context, canRollback),
      ),
      pageInfo: {
        limit,
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeKnowledgeV2Cursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getPublication(
    context: RequestContext,
    publicationId: string,
  ): Promise<KnowledgeV2PublicationDetail> {
    const publication = await this.prisma.knowledgePublication.findFirst({
      where: { id: publicationId, tenantId: context.tenantId, targetKey, corpusKind },
      include: publicationInclude,
    });
    if (!publication) this.notFound();
    const canRollback = await this.canApproveForContext(context);
    return this.publicationDetail(publication, context, canRollback);
  }

  private snapshotReconciliationError() {
    return knowledgeV2Error(
      HttpStatus.SERVICE_UNAVAILABLE,
      "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
      "The prepared knowledge index did not reconcile.",
      { retryable: true },
    );
  }

  private snapshotAuthorizationManifest(
    tenantId: string,
    snapshot: {
      id: string;
      tenantId: string;
      manifestHash: string;
      indexSchemaHash: string | null;
      expectedPointCount: number;
      observedPointCount: number | null;
      authorizationManifest: Prisma.JsonValue | null;
      authorizationManifestHash: string | null;
      authorizationManifestVersion: number | null;
    },
    items: readonly CandidateManifestItem[],
  ): KnowledgeV2SnapshotAuthorizationManifest {
    const parsed = parseKnowledgeV2SnapshotAuthorizationManifest(
      snapshot.authorizationManifest,
      snapshot.authorizationManifestHash,
    );
    const revisionIds = items
      .filter((item) => item.itemType === "DOCUMENT_REVISION")
      .map((item) => item.itemId)
      .sort(compareCanonicalText);
    if (
      snapshot.authorizationManifestVersion !==
        KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MANIFEST_VERSION ||
      !snapshot.indexSchemaHash ||
      snapshot.expectedPointCount <= 0 ||
      snapshot.observedPointCount !== snapshot.expectedPointCount ||
      !parsed ||
      snapshot.tenantId !== tenantId ||
      parsed.tenantId !== tenantId ||
      parsed.snapshotId !== snapshot.id ||
      parsed.snapshotManifestHash !== snapshot.manifestHash ||
      parsed.indexSchemaHash !== snapshot.indexSchemaHash ||
      parsed.expectedPointCount !== snapshot.expectedPointCount ||
      !sameOrderedValues(revisionIds, parsed.revisionIds) ||
      documentSnapshotManifestHash(items, snapshot.indexSchemaHash) !== snapshot.manifestHash
    ) {
      throw this.snapshotReconciliationError();
    }
    return parsed;
  }

  private async assertCurrentSnapshotAuthorization(
    tx: Prisma.TransactionClient,
    tenantId: string,
    manifest: KnowledgeV2SnapshotAuthorizationManifest,
    publicationItems: readonly PublicationItemRecord[],
  ) {
    const sourceIds = manifest.partitions
      .map((partition) => partition.sourceId)
      .sort(compareCanonicalText);
    if (
      sourceIds.length === 0 ||
      sourceIds.length > KNOWLEDGE_V2_SNAPSHOT_AUTHORIZATION_MAXIMUM_PARTITIONS ||
      new Set(sourceIds).size !== sourceIds.length
    ) {
      throw this.snapshotReconciliationError();
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "KnowledgeV2Source"
      WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(sourceIds)})
      ORDER BY "id"
      FOR SHARE
    `);
    const sources = await tx.knowledgeV2Source.findMany({
      where: { tenantId, id: { in: sourceIds } },
      select: {
        id: true,
        tenantId: true,
        generation: true,
        sourcePermissionVersion: true,
        defaultScope: true,
        defaultClassification: true,
        defaultLocale: true,
        tombstonedAt: true,
        deletedAt: true,
      },
      orderBy: { id: "asc" },
    });
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    for (const partition of manifest.partitions) {
      const source = sourcesById.get(partition.sourceId);
      if (
        !source ||
        source.deletedAt ||
        source.tombstonedAt ||
        source.generation < partition.sourceGeneration ||
        source.sourcePermissionVersion !== partition.permissionVersion ||
        sourcePermissionFingerprint(source) !== partition.authorizationFingerprint
      ) {
        throw knowledgeV2Error(
          HttpStatus.CONFLICT,
          "KNOWLEDGE_PERMISSION_DOCUMENT_FINGERPRINT_MISMATCH",
          "Source permissions changed before publication activation.",
        );
      }
    }
    if (sources.length !== sourceIds.length) throw this.snapshotReconciliationError();

    const partitionsByRevisionId = new Map(
      manifest.partitions.flatMap((partition) =>
        partition.revisionIds.map((revisionId) => [revisionId, partition] as const),
      ),
    );
    const documentItems = publicationItems.filter((item) => item.itemType === "DOCUMENT_REVISION");
    const revisionIds = documentItems.map((item) => item.itemId).sort(compareCanonicalText);
    if (!sameOrderedValues(revisionIds, manifest.revisionIds)) {
      throw this.snapshotReconciliationError();
    }
    for (const item of documentItems) {
      const revision = item.v2DocumentRevision;
      const partition = partitionsByRevisionId.get(item.itemId);
      if (
        !revision ||
        !partition ||
        revision.id !== item.itemId ||
        revision.sourceId !== partition.sourceId ||
        revision.document.source.id !== partition.sourceId ||
        revision.document.source.tenantId !== tenantId ||
        revision.contentHash !== item.itemVersionHash ||
        item.authorizationFingerprint !== partition.authorizationFingerprint ||
        revision.sourcePermissionFingerprint !== partition.authorizationFingerprint ||
        revision.document.permissionVersion !== partition.permissionVersion
      ) {
        throw this.snapshotReconciliationError();
      }
    }
  }

  async validatePublication(
    context: RequestContext,
    dto: KnowledgeV2ValidatePublicationRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>> {
    this.assertTarget(dto.targetKey);
    const result = await this.idempotency.executePrepared(
      {
        tenantId: context.tenantId,
        endpoint: "POST /knowledge/v2/publications/validate",
        key: idempotencyKey,
        request: dto,
        transactionTimeoutMs: 120_000,
      },
      async () => {
        const preflight = await this.candidateProjection(this.prisma, context.tenantId);
        this.assertCandidate(dto, preflight);
        const documentRevisionIds = preflight.items.flatMap((item) =>
          item.itemType === "DOCUMENT_REVISION" ? [item.itemId] : [],
        );
        let preparedSnapshotId: string | null = null;
        let preparedProjection = preflight;
        if (preflight.blockers.length === 0 && documentRevisionIds.length > 0) {
          if (!this.indexPreparation) {
            throw knowledgeV2Error(
              HttpStatus.SERVICE_UNAVAILABLE,
              "KNOWLEDGE_DEPENDENCY_INDEX_PREPARATION_UNAVAILABLE",
              "The knowledge index could not be prepared.",
              { retryable: true },
            );
          }
          const prepared = await this.indexPreparation.prepareCandidate({
            tenantId: context.tenantId,
            candidateId: preflight.candidateId,
            candidateVersion: preflight.candidateVersion,
            candidateManifestHash: preflight.manifestHash,
            items: preflight.items,
          });
          preparedSnapshotId = prepared.snapshotId;
          if (!preparedSnapshotId || prepared.expectedPointCount <= 0) {
            throw knowledgeV2Error(
              HttpStatus.SERVICE_UNAVAILABLE,
              "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
              "The prepared knowledge index did not reconcile.",
              { retryable: true },
            );
          }
          preparedProjection = await this.candidateProjection(this.prisma, context.tenantId);
          this.assertCandidate(dto, preparedProjection);
          if (preparedProjection.manifestHash !== preflight.manifestHash) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "KNOWLEDGE_PUBLICATION_CANDIDATE_STALE",
              "The draft changed while its index snapshot was being prepared.",
            );
          }
        }
        const preparedCapabilities = await this.capabilities().evaluateSelection(
          this.prisma,
          context.tenantId,
          capabilitySelectionFromProjection(preparedProjection),
        );
        return {
          preflight: preparedProjection,
          preflightCapabilities: preparedCapabilities,
          documentRevisionIds,
          preparedSnapshotId,
        };
      },
      async (tx, preparedState) => {
        await this.lockTarget(tx, context.tenantId);
        await this.lockDraftSettings(tx, context.tenantId);
        const { preflight, preflightCapabilities, preparedSnapshotId } = preparedState;
        const evaluatedAt = new Date();
        const projection = await this.candidateProjection(tx, context.tenantId, evaluatedAt);
        this.assertCandidate(dto, projection);
        if (projection.manifestHash !== preflight.manifestHash) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_CANDIDATE_STALE",
            "The draft changed while its index snapshot was being prepared.",
          );
        }
        const capabilityEvaluation = await this.capabilities().evaluateSelection(
          tx,
          context.tenantId,
          capabilitySelectionFromProjection(projection),
          evaluatedAt,
        );
        if (
          capabilityEvaluation.snapshot.capabilitySetHash !==
            preflightCapabilities.snapshot.capabilitySetHash ||
          capabilityEvaluation.snapshot.requirementEvaluationSetHash !==
            preflightCapabilities.snapshot.requirementEvaluationSetHash ||
          capabilityEvaluation.operationalProjection.bindingHash !==
            preflightCapabilities.operationalProjection.bindingHash ||
          capabilityEvaluation.operationalProjection.permissionGeneration !==
            preflightCapabilities.operationalProjection.permissionGeneration
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_CONFLICT_CAPABILITY_CONFIGURATION_CHANGED",
            "Capability settings changed while the draft was being validated.",
          );
        }
        const documentItems = projection.items.filter(
          (item) => item.itemType === "DOCUMENT_REVISION",
        );
        const blockers = [...projection.blockers, ...capabilityEvaluation.blockers];
        const warnings = [...projection.warnings, ...capabilityEvaluation.warnings];
        if (documentItems.length > 0 && (preparedSnapshotId !== null || blockers.length === 0)) {
          const snapshot = preparedSnapshotId
            ? await tx.knowledgeIndexSnapshot.findFirst({
                where: {
                  id: preparedSnapshotId,
                  tenantId: context.tenantId,
                  corpusKind,
                  status: "READY",
                  pipelineVersion: "knowledge-v2-hybrid-v1",
                  expectedPointCount: { gt: 0 },
                },
              })
            : null;
          if (!snapshot) throw this.snapshotReconciliationError();
          this.snapshotAuthorizationManifest(context.tenantId, snapshot, documentItems);
        }
        const validationData = {
          targetKey,
          corpusKind: "STRUCTURED_V2" as const,
          candidateManifestHash: projection.manifestHash,
          basePublicationId: projection.basePublicationId,
          indexSnapshotId: preparedSnapshotId,
          candidateItems: inputJson(projection.items),
          status: blockers.length === 0 ? ("PASSED" as const) : ("FAILED" as const),
          blockers: inputJson(blockers),
          warnings: inputJson(warnings),
          capabilitySetHash: capabilityEvaluation.snapshot.capabilitySetHash,
          requirementEvaluationSetHash: capabilityEvaluation.snapshot.requirementEvaluationSetHash,
          ...operationalBinding(capabilityEvaluation),
          validatedByUserId: context.userId,
          evaluatedAt,
          validUntil: projection.validUntil,
        };
        const validation = await tx.knowledgeV2PublicationValidation.create({
          data: {
            tenantId: context.tenantId,
            candidateId: dto.candidateId,
            candidateVersion: dto.candidateVersion,
            validationPolicyVersion,
            ...validationData,
          },
        });
        await this.capabilities().persistValidationEvaluations(
          tx,
          context.tenantId,
          validation.id,
          capabilityEvaluation,
        );
        const resource = validationView(validation);
        return {
          httpStatus: HttpStatus.CREATED,
          responseBody: { resource, idempotencyReplayed: false },
          responseRef: validation.id,
        };
      },
    );
    return {
      resource: result.responseBody.resource,
      idempotencyReplayed: result.idempotencyReplayed,
    };
  }

  async publishPublication(
    context: RequestContext,
    dto: KnowledgeV2CreatePublicationRequest,
    idempotencyKey: string,
  ): Promise<KnowledgeV2AcceptedMutation> {
    this.assertTarget(dto.targetKey);
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "POST /knowledge/v2/publications",
        key: idempotencyKey,
        request: dto,
      },
      async (tx) => {
        await this.lockTarget(tx, context.tenantId);
        await this.lockDraftSettings(tx, context.tenantId);
        await this.assertActivationActor(tx, {
          tenantId: context.tenantId,
          actorUserId: context.userId,
        });
        const projection = await this.candidateProjection(tx, context.tenantId);
        this.assertCandidate(dto, projection);
        const capabilityEvaluation = await this.capabilities().evaluateSelection(
          tx,
          context.tenantId,
          capabilitySelectionFromProjection(projection),
        );
        const blockers = [...projection.blockers, ...capabilityEvaluation.blockers];
        if (blockers.length > 0) this.validationFailed(blockers);
        const validation = await tx.knowledgeV2PublicationValidation.findFirst({
          where: {
            id: dto.validationId,
            tenantId: context.tenantId,
            targetKey,
            corpusKind,
          },
        });
        this.assertValidation(validation, dto, projection);
        if (
          !validation.capabilitySetHash ||
          !validation.requirementEvaluationSetHash ||
          validation.capabilitySetHash !== capabilityEvaluation.snapshot.capabilitySetHash ||
          validation.requirementEvaluationSetHash !==
            capabilityEvaluation.snapshot.requirementEvaluationSetHash ||
          !operationalBindingMatches(validation, capabilityEvaluation)
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_CAPABILITY_VALIDATION_REQUIRED",
            "Capability settings changed after this validation.",
          );
        }
        const validationItems = parseManifestItems(validation.candidateItems);
        if (
          validationItems.some((item) => item.itemType === "DOCUMENT_REVISION") &&
          !validation.indexSnapshotId
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_VALIDATION_REQUIRED",
            "The publication validation does not reference its exact index snapshot.",
          );
        }
        if (
          !validationItems.some((item) => item.itemType === "DOCUMENT_REVISION") &&
          validation.indexSnapshotId
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_INDEX_SNAPSHOT_UNEXPECTED",
            "A publication without documents cannot reference an index snapshot.",
          );
        }
        const accepted = await this.createActivationRequest(tx, {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          operation: "PUBLISH",
          items: validationItems,
          manifestHash: validation.candidateManifestHash,
          basePublicationId: validation.basePublicationId,
          validationId: validation.id,
          candidateId: dto.candidateId,
          candidateVersion: dto.candidateVersion,
          indexSnapshotId: validation.indexSnapshotId,
          approvalNote: dto.approvalNote ?? null,
          capabilitySetHash: validation.capabilitySetHash,
          requirementEvaluationSetHash: validation.requirementEvaluationSetHash,
          capabilityEvaluation,
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: accepted.response,
          responseRef: accepted.jobId,
        };
      },
    );
    const response = { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
    const publicationId = response.resource?.type === "PUBLICATION" ? response.resource.id : null;
    if (publicationId) {
      await this.queuePublicationEvaluation(context, publicationId);
    }
    return response;
  }

  async activationEvaluationState(input: { tenantId: string; publicationId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const publication = await tx.knowledgePublication.findFirst({
        where: {
          id: input.publicationId,
          tenantId: input.tenantId,
          targetKey,
          corpusKind,
        },
        include: { validation: true },
      });
      const validation = publication?.validation;
      if (!publication || !validation) return "FAILED" as const;
      const currentSet = await knowledgeV2CurrentEvaluationSet(tx, input.tenantId);
      if (!currentSet.cases.some((testCase) => testCase.critical)) return "PASSED" as const;
      const run = await tx.knowledgeV2EvaluationRun.findFirst({
        where: {
          tenantId: input.tenantId,
          corpusKind,
          runKind: "PUBLICATION",
          snapshotKind: "DRAFT_CANDIDATE",
          targetKey,
          candidateId: validation.candidateId,
          candidateVersion: validation.candidateVersion,
          candidateManifestHash: validation.candidateManifestHash,
          testCaseSetHash: currentSet.testCaseSetHash,
        },
        select: { status: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!run || run.status === "QUEUED" || run.status === "RUNNING") return "PENDING" as const;
      if (run.status !== "SUCCEEDED") return "FAILED" as const;
      try {
        await assertKnowledgeV2PublicationEvaluationGate(tx, {
          tenantId: input.tenantId,
          candidateId: validation.candidateId,
          candidateVersion: validation.candidateVersion,
          candidateManifestHash: validation.candidateManifestHash,
        });
        return "PASSED" as const;
      } catch {
        return "FAILED" as const;
      }
    });
  }

  private async queuePublicationEvaluation(context: RequestContext, publicationId: string) {
    const publication = await this.prisma.knowledgePublication.findFirst({
      where: { id: publicationId, tenantId: context.tenantId, targetKey, corpusKind },
      include: { validation: true },
    });
    const validation = publication?.validation;
    if (!publication || !validation) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_VALIDATION_REQUIRED",
        "The publication evaluation target is unavailable.",
      );
    }
    const currentSet = await this.prisma.$transaction((tx) =>
      knowledgeV2CurrentEvaluationSet(tx, context.tenantId),
    );
    if (!currentSet.cases.some((testCase) => testCase.critical)) return;
    try {
      await this.prisma.$transaction((tx) =>
        assertKnowledgeV2PublicationEvaluationGate(tx, {
          tenantId: context.tenantId,
          candidateId: validation.candidateId,
          candidateVersion: validation.candidateVersion,
          candidateManifestHash: validation.candidateManifestHash,
        }),
      );
      return;
    } catch {
      await this.testRuns.createEvaluationRun(
        context,
        {
          target: "DRAFT",
          candidateId: validation.candidateId,
          candidateVersion: validation.candidateVersion,
          candidateManifestHash: validation.candidateManifestHash,
          runKind: "PUBLICATION",
        },
        `publication-evaluation:${publication.id}`,
      );
    }
  }

  async createPublication(
    context: RequestContext,
    dto: KnowledgeV2CreatePublicationRequest,
    idempotencyKey: string,
  ) {
    return this.publishPublication(context, dto, idempotencyKey);
  }

  async rollbackPublication(
    context: RequestContext,
    sourcePublicationId: string,
    dto: KnowledgeV2RollbackPublicationRequest,
    idempotencyKey: string,
    ifMatch: string[],
  ): Promise<KnowledgeV2AcceptedMutation> {
    const result = await this.idempotency.execute(
      {
        tenantId: context.tenantId,
        endpoint: "POST /knowledge/v2/publications/:publicationId/rollback",
        key: idempotencyKey,
        request: { publicationId: sourcePublicationId, ...dto, ifMatch },
      },
      async (tx) => {
        await this.lockTarget(tx, context.tenantId);
        await this.lockDraftSettings(tx, context.tenantId);
        await this.assertActivationActor(tx, {
          tenantId: context.tenantId,
          actorUserId: context.userId,
        });
        const pointer = await tx.activeKnowledgePublication.findUnique({
          where: { tenantId_targetKey: { tenantId: context.tenantId, targetKey } },
          include: { publication: { select: { id: true, sequence: true } } },
        });
        if (!pointer) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_ACTIVE_REQUIRED",
            "There is no active structured publication to roll back.",
          );
        }
        assertIfMatch(
          ifMatch,
          this.activeEtag(context.tenantId, {
            publicationId: pointer.publicationId,
            sequence: pointer.sequence,
            etag: pointer.etag,
          }),
          pointer.etag,
          ["activePublicationId", "activePublicationSequence"],
        );
        if (pointer.publicationId === sourcePublicationId) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_ALREADY_ACTIVE",
            "The requested publication is already active.",
          );
        }
        const source = await tx.knowledgePublication.findFirst({
          where: {
            id: sourcePublicationId,
            tenantId: context.tenantId,
            targetKey,
            corpusKind,
            status: { in: ["SUPERSEDED", "ROLLED_BACK"] },
          },
          include: publicationInclude,
        });
        if (!source) this.notFound();
        const defaultScopePolicy = await this.currentDefaultScopePolicy(tx, context.tenantId);
        const filtered = this.rollbackManifest(source, new Date(), defaultScopePolicy);
        if (filtered.items.length === 0) {
          this.validationFailed([
            gate(
              "KNOWLEDGE_PUBLICATION_ROLLBACK_EMPTY",
              "BLOCKED",
              "Rollback has no eligible content",
              "The prior manifest no longer contains content that can be served safely.",
              { type: "PUBLICATION", id: source.id },
            ),
          ]);
        }
        const candidateId = `rollback-${canonicalKnowledgeV2Hash({
          sourcePublicationId,
          activePublicationId: pointer.publicationId,
          activeEtag: pointer.etag,
        }).slice(0, 48)}`;
        const candidateVersion = pointer.etag;
        const evaluatedAt = new Date();
        const capabilityEvaluation = await this.capabilities().evaluateSelection(
          tx,
          context.tenantId,
          capabilitySelectionFromItems(filtered.items),
          evaluatedAt,
        );
        if (capabilityEvaluation.blockers.length > 0) {
          this.validationFailed(capabilityEvaluation.blockers);
        }
        const validation = await tx.knowledgeV2PublicationValidation.create({
          data: {
            tenantId: context.tenantId,
            targetKey,
            corpusKind,
            candidateId,
            candidateVersion,
            candidateManifestHash: filtered.manifestHash,
            basePublicationId: pointer.publicationId,
            indexSnapshotId: null,
            candidateItems: inputJson(filtered.items),
            status: "PASSED",
            blockers: inputJson([]),
            warnings: inputJson([...filtered.warnings, ...capabilityEvaluation.warnings]),
            capabilitySetHash: capabilityEvaluation.snapshot.capabilitySetHash,
            requirementEvaluationSetHash:
              capabilityEvaluation.snapshot.requirementEvaluationSetHash,
            ...operationalBinding(capabilityEvaluation),
            validationPolicyVersion: `${validationPolicyVersion}:rollback:${randomUUID()}`,
            validatedByUserId: context.userId,
            evaluatedAt,
            validUntil: new Date(Date.now() + validationTtlMs),
          },
        });
        await this.capabilities().persistValidationEvaluations(
          tx,
          context.tenantId,
          validation.id,
          capabilityEvaluation,
        );
        const accepted = await this.createActivationRequest(tx, {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          operation: "ROLLBACK",
          items: filtered.items,
          manifestHash: filtered.manifestHash,
          basePublicationId: pointer.publicationId,
          validationId: validation.id,
          candidateId,
          candidateVersion,
          indexSnapshotId: null,
          sourcePublicationId,
          rollbackReason: dto.reason,
          capabilitySetHash: capabilityEvaluation.snapshot.capabilitySetHash,
          requirementEvaluationSetHash: capabilityEvaluation.snapshot.requirementEvaluationSetHash,
          capabilityEvaluation,
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: accepted.response,
          responseRef: accepted.jobId,
        };
      },
    );
    const response = { ...result.responseBody, idempotencyReplayed: result.idempotencyReplayed };
    const publicationId = response.resource?.type === "PUBLICATION" ? response.resource.id : null;
    if (publicationId) await this.queuePublicationEvaluation(context, publicationId);
    return response;
  }

  async getJob(context: RequestContext, jobId: string): Promise<KnowledgeV2JobView> {
    const job = await this.prisma.knowledgeJob.findFirst({
      where: { id: jobId, tenantId: context.tenantId, pipelineVersion },
    });
    if (!job) {
      throw knowledgeV2Error(
        HttpStatus.NOT_FOUND,
        "KNOWLEDGE_PUBLICATION_JOB_NOT_FOUND",
        "The knowledge job was not found.",
      );
    }
    return jobView(job);
  }

  async activatePublication(input: {
    tenantId: string;
    publicationId: string;
    actorUserId: string | null;
    operation: "PUBLISH" | "ROLLBACK";
  }): Promise<{ publicationId: string; sequence: number; itemCount: number; etag: string }> {
    if (!this.indexPreparation) {
      throw knowledgeV2Error(
        HttpStatus.SERVICE_UNAVAILABLE,
        "KNOWLEDGE_DEPENDENCY_INDEX_PREPARATION_UNAVAILABLE",
        "Knowledge index preparation is unavailable.",
        { retryable: true },
      );
    }
    const preparedSnapshot = await this.indexPreparation.preparePublication({
      tenantId: input.tenantId,
      publicationId: input.publicationId,
    });
    return this.prisma.$transaction(
      async (tx) => {
        await lockKnowledgeCorpusTransition(tx, input.tenantId);
        await this.lockTarget(tx, input.tenantId);
        const publication = await tx.knowledgePublication.findFirst({
          where: {
            id: input.publicationId,
            tenantId: input.tenantId,
            targetKey,
            corpusKind,
          },
          include: publicationInclude,
        });
        if (!publication) this.notFound();
        const pointer = await tx.activeKnowledgePublication.findUnique({
          where: { tenantId_targetKey: { tenantId: input.tenantId, targetKey } },
        });
        if (publication.status === "ACTIVE" && pointer?.publicationId === publication.id) {
          return {
            publicationId: publication.id,
            sequence: publication.sequence,
            itemCount: publication.items.length,
            etag: this.activeEtag(input.tenantId, {
              publicationId: pointer.publicationId,
              sequence: pointer.sequence,
              etag: pointer.etag,
            }),
          };
        }
        await this.lockDraftSettings(tx, input.tenantId);
        await this.assertActivationActor(tx, input);
        const defaultScopePolicy = await this.currentDefaultScopePolicy(tx, input.tenantId);
        const settings = await tx.knowledgeV2Settings.findUnique({
          where: { tenantId: input.tenantId },
          select: { retrievalProcessorPolicy: true, modelProcessorPolicy: true },
        });
        const policyVersions = runtimePolicyVersions(settings);
        if (
          !policyVersions ||
          publication.retrievalPolicyVersion !== policyVersions.retrievalPolicyVersion ||
          publication.promptPolicyVersion !== policyVersions.promptPolicyVersion
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_PROCESSOR_POLICY_STALE",
            "The publication processor policy changed before activation.",
          );
        }
        const metadata = qualityMetadata(publication.qualitySummary);
        const validation = publication.validation;
        const now = new Date();
        const validationPolicyMatches =
          input.operation === "PUBLISH"
            ? validation?.validationPolicyVersion === validationPolicyVersion
            : validation?.validationPolicyVersion.startsWith(
                `${validationPolicyVersion}:rollback:`,
              );
        if (
          !validation ||
          validation.status !== "PASSED" ||
          !validation.evaluatedAt ||
          !validation.validUntil ||
          validation.validUntil <= now ||
          !validationPolicyMatches ||
          validation.publicationId !== publication.id ||
          validation.basePublicationId !== publication.basePublicationId ||
          validation.candidateManifestHash !== publication.manifestHash ||
          !validation.capabilitySetHash ||
          !validation.requirementEvaluationSetHash ||
          validation.capabilitySetHash !== publication.capabilitySetHash ||
          validation.requirementEvaluationSetHash !== publication.requirementEvaluationSetHash ||
          validation.operationalBindingSchemaVersion !==
            publication.operationalBindingSchemaVersion ||
          validation.operationalRegistryVersion !== publication.operationalRegistryVersion ||
          validation.operationalRegistryHash !== publication.operationalRegistryHash ||
          validation.operationalDependencySetHash !== publication.operationalDependencySetHash ||
          validation.operationalBindingHash !== publication.operationalBindingHash ||
          validation.operationalPermissionGeneration !==
            publication.operationalPermissionGeneration ||
          publication.capabilitySnapshots.length === 0 ||
          manifestHash(parseManifestItems(validation.candidateItems)) !==
            publication.manifestHash ||
          (publication.items.some((item) => item.itemType === "DOCUMENT_REVISION") &&
            validation.indexSnapshotId !== preparedSnapshot.snapshotId) ||
          metadata.validationId !== validation.id
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_VALIDATION_REQUIRED",
            "The publication does not have a current exact validation.",
          );
        }
        const capabilityEvaluation = await this.capabilities().evaluateSelection(
          tx,
          input.tenantId,
          capabilitySelectionFromItems(publication.items),
          now,
          { lockOperationalAuthorization: true },
        );
        if (
          capabilityEvaluation.blockers.length > 0 ||
          capabilityEvaluation.snapshot.capabilitySetHash !== publication.capabilitySetHash ||
          capabilityEvaluation.snapshot.requirementEvaluationSetHash !==
            publication.requirementEvaluationSetHash ||
          !operationalBindingMatches(publication, capabilityEvaluation) ||
          !capabilitySnapshotsMatch(publication, capabilityEvaluation)
        ) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_CAPABILITY_SNAPSHOT_STALE",
            "Capability readiness changed before publication activation.",
          );
        }
        if (!["READY", "PUBLISHING"].includes(publication.status)) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_STATE_INVALID",
            "The publication cannot be activated from its current state.",
          );
        }
        if (metadata.operation !== input.operation || metadata.actorUserId !== input.actorUserId) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_REQUEST_MISMATCH",
            "The activation request does not match the publication.",
          );
        }
        if ((pointer?.publicationId ?? null) !== publication.basePublicationId) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_BASE_CHANGED",
            "The active publication changed before activation.",
          );
        }
        const storedItems = publication.items.map((item) => this.manifestItemFromRecord(item));
        if (manifestHash(storedItems) !== publication.manifestHash) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_MANIFEST_INVALID",
            "The publication manifest failed reconciliation.",
          );
        }
        const documentRevisionIds = new Set(
          publication.items.flatMap((item) =>
            item.itemType === "DOCUMENT_REVISION" ? [item.itemId] : [],
          ),
        );
        let authorizationManifest: KnowledgeV2SnapshotAuthorizationManifest | null = null;
        if (documentRevisionIds.size > 0) {
          const snapshot = publication.indexSnapshot;
          if (
            !snapshot ||
            snapshot.id !== preparedSnapshot.snapshotId ||
            snapshot.status !== "READY" ||
            snapshot.corpusKind !== corpusKind ||
            snapshot.pipelineVersion !== "knowledge-v2-hybrid-v1" ||
            snapshot.expectedPointCount <= 0 ||
            snapshot.expectedPointCount !== snapshot.observedPointCount ||
            snapshot.expectedPointCount !== snapshot.v2Items.length ||
            snapshot.expectedPointCount !== preparedSnapshot.expectedPointCount ||
            snapshot.observedPointCount !== preparedSnapshot.observedPointCount ||
            !sameOrderedValues(
              [...documentRevisionIds].sort(compareCanonicalText),
              [...new Set(snapshot.v2Items.map((item) => item.chunk.revisionId))].sort(
                compareCanonicalText,
              ),
            )
          ) {
            throw this.snapshotReconciliationError();
          }
          authorizationManifest = this.snapshotAuthorizationManifest(
            input.tenantId,
            snapshot,
            storedItems,
          );
        } else if (publication.indexSnapshotId || preparedSnapshot.snapshotId) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_INDEX_SNAPSHOT_UNEXPECTED",
            "A publication without documents cannot activate an index snapshot.",
          );
        }
        if (input.operation === "PUBLISH") {
          const projection = await this.candidateProjection(tx, input.tenantId);
          if (
            metadata.candidateId !== projection.candidateId ||
            metadata.candidateVersion !== projection.candidateVersion ||
            projection.manifestHash !== publication.manifestHash ||
            projection.blockers.length > 0
          ) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "KNOWLEDGE_PUBLICATION_CANDIDATE_STALE",
              "The draft changed before publication activation.",
            );
          }
        } else {
          this.assertRollbackItemsStillEligible(publication, now, defaultScopePolicy);
          const currentRollbackManifest = publication.items.map((item) =>
            this.manifestItemFromRecord(item, true, defaultScopePolicy),
          );
          if (manifestHash(currentRollbackManifest) !== publication.manifestHash) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "KNOWLEDGE_PUBLICATION_ROLLBACK_STALE",
              "The rollback evidence or authorization changed before activation.",
            );
          }
        }
        await assertKnowledgeV2PublicationEvaluationGate(tx, {
          tenantId: input.tenantId,
          candidateId: validation.candidateId,
          candidateVersion: validation.candidateVersion,
          candidateManifestHash: validation.candidateManifestHash,
        });
        if (authorizationManifest) {
          await this.assertCurrentSnapshotAuthorization(
            tx,
            input.tenantId,
            authorizationManifest,
            publication.items,
          );
        }
        const claimed = await tx.knowledgePublication.updateMany({
          where: {
            id: publication.id,
            tenantId: input.tenantId,
            status: { in: ["READY", "PUBLISHING"] },
          },
          data: { status: "PUBLISHING" },
        });
        if (claimed.count !== 1) {
          throw knowledgeV2Error(
            HttpStatus.CONFLICT,
            "KNOWLEDGE_PUBLICATION_STATE_INVALID",
            "The publication activation state changed.",
          );
        }
        let nextPointerEtag: number;
        if (pointer) {
          const advanced = await tx.activeKnowledgePublication.updateMany({
            where: {
              tenantId: input.tenantId,
              targetKey,
              publicationId: pointer.publicationId,
              sequence: pointer.sequence,
              etag: pointer.etag,
            },
            data: {
              publicationId: publication.id,
              sequence: publication.sequence,
              etag: { increment: 1 },
              updatedByUserId: input.actorUserId,
            },
          });
          if (advanced.count !== 1) {
            throw knowledgeV2Error(
              HttpStatus.CONFLICT,
              "KNOWLEDGE_PUBLICATION_BASE_CHANGED",
              "The active publication changed before activation.",
            );
          }
          nextPointerEtag = pointer.etag + 1;
          await tx.knowledgePublication.updateMany({
            where: { id: pointer.publicationId, tenantId: input.tenantId, status: "ACTIVE" },
            data: {
              status: input.operation === "ROLLBACK" ? "ROLLED_BACK" : "SUPERSEDED",
              supersededAt: new Date(),
            },
          });
        } else {
          await tx.activeKnowledgePublication.create({
            data: {
              tenantId: input.tenantId,
              targetKey,
              publicationId: publication.id,
              sequence: publication.sequence,
              etag: 1,
              updatedByUserId: input.actorUserId,
            },
          });
          nextPointerEtag = 1;
        }
        const activatedAt = new Date();
        await tx.knowledgePublication.update({
          where: { id: publication.id },
          data: { status: "ACTIVE", activatedAt, failureCode: null, failedAt: null },
        });
        await this.finalizeDocumentPublication(tx, publication, activatedAt);
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action:
              input.operation === "ROLLBACK"
                ? "knowledge.v2.publication.rollback_activated"
                : "knowledge.v2.publication.activated",
            entityType: "knowledge_publication",
            entityId: publication.id,
            payload: {
              targetKey,
              corpusKind,
              sequence: publication.sequence,
              itemCount: publication.items.length,
              basePublicationId: publication.basePublicationId,
              indexSnapshotId: publication.indexSnapshotId,
              indexedPointCount: publication.indexSnapshot?.expectedPointCount ?? 0,
              authorizationManifestVersion: authorizationManifest?.version ?? null,
              authorizationManifestHash:
                publication.indexSnapshot?.authorizationManifestHash ?? null,
            },
          },
        });
        return {
          publicationId: publication.id,
          sequence: publication.sequence,
          itemCount: publication.items.length,
          etag: this.activeEtag(input.tenantId, {
            publicationId: publication.id,
            sequence: publication.sequence,
            etag: nextPointerEtag,
          }),
        };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  }

  private async finalizeDocumentPublication(
    tx: Prisma.TransactionClient,
    publication: PublicationRecord,
    activatedAt: Date,
  ) {
    const documentItems = publication.items.filter(
      (item) => item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision,
    );
    if (documentItems.length === 0) return;
    const snapshotId = publication.indexSnapshotId;
    if (!snapshotId || !publication.indexSnapshot) this.notFound();
    const operation = qualityMetadata(publication.qualitySummary).operation;
    const expectedSources = new Map(
      documentItems.map((item) => {
        const revision = item.v2DocumentRevision!;
        return [revision.sourceId, revision.document.source] as const;
      }),
    );
    const lockedSources = new Map<
      string,
      Awaited<ReturnType<typeof tx.knowledgeV2Source.findFirst>>
    >();
    for (const [sourceId, expected] of [...expectedSources].sort(([left], [right]) =>
      compareCanonicalText(left, right),
    )) {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "KnowledgeV2Source"
        WHERE "tenantId" = ${publication.tenantId} AND "id" = ${sourceId}
        FOR UPDATE
      `);
      const current = await tx.knowledgeV2Source.findFirst({
        where: { id: sourceId, tenantId: publication.tenantId },
      });
      if (
        !current ||
        current.deletedAt ||
        current.tombstonedAt ||
        current.generation !== expected.generation ||
        current.etag !== expected.etag ||
        current.sourcePermissionVersion !== expected.sourcePermissionVersion ||
        sourcePermissionFingerprint(current) !== sourcePermissionFingerprint(expected)
      ) {
        throw this.manifestConflict();
      }
      lockedSources.set(sourceId, current);
    }
    for (const item of documentItems) {
      const revision = item.v2DocumentRevision!;
      const expectedChunks = publication.indexSnapshot.v2Items.filter(
        (snapshotItem) => snapshotItem.chunk.revisionId === revision.id,
      );
      if (expectedChunks.length === 0) {
        throw knowledgeV2Error(
          HttpStatus.SERVICE_UNAVAILABLE,
          "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
          "The publication index snapshot did not reconcile.",
          { retryable: true },
        );
      }
      const effectiveScope = revision.scopeSnapshot ?? revision.document.scope;
      const effectiveScopeView = scopeView(effectiveScope);
      const audiencePolicy = resolveKnowledgeV2PersistedAudiences(
        revision.document.audience,
        revision.document.classification,
      );
      if (
        audiencePolicy.state === "INVALID" ||
        expectedChunks.some(
          (snapshotItem) =>
            snapshotItem.chunk.permissionVersion !== revision.document.permissionVersion ||
            !sameScope(snapshotItem.chunk.scope, effectiveScope) ||
            !knowledgeV2DocumentPrefilterEnforcesScope(
              effectiveScopeView,
              audiencePolicy.audiences,
              snapshotItem.chunk.locale,
            ),
        )
      ) {
        throw this.manifestConflict();
      }
      if (!item.itemVersionHash || !item.authorizationFingerprint) {
        throw this.manifestConflict();
      }
      const revisionUpdated = await tx.knowledgeV2DocumentRevision.updateMany({
        where: {
          id: revision.id,
          tenantId: publication.tenantId,
          contentHash: item.itemVersionHash,
          sourcePermissionFingerprint: item.authorizationFingerprint,
          deletedAt: null,
          status: { in: ["CHUNKING", "READY", "PUBLISHED"] },
        },
        data: { status: "PUBLISHED" },
      });
      if (revisionUpdated.count !== 1) throw this.manifestConflict();
      const chunksUpdated = await tx.knowledgeV2Chunk.updateMany({
        where: {
          tenantId: publication.tenantId,
          revisionId: revision.id,
          id: { in: expectedChunks.map((snapshotItem) => snapshotItem.chunkId) },
          deletedAt: null,
        },
        data: { indexState: "INDEXED", indexedAt: activatedAt },
      });
      if (chunksUpdated.count !== expectedChunks.length) throw this.manifestConflict();
      const documentUpdated = await tx.knowledgeV2Document.updateMany({
        where: {
          id: revision.documentId,
          tenantId: publication.tenantId,
          deletedAt: null,
          tombstonedAt: null,
          permissionVersion: revision.document.permissionVersion,
          ...(operation === "PUBLISH" ? { currentDraftRevisionId: revision.id } : {}),
        },
        data: {
          currentPublishedRevisionId: revision.id,
          ...(operation === "PUBLISH" ? { status: "ACTIVE" as const } : {}),
        },
      });
      if (documentUpdated.count !== 1) throw this.manifestConflict();
    }
    for (const [sourceId, source] of lockedSources) {
      if (!source || source.status === "PAUSED") continue;
      const [needsReview, pending] = await Promise.all([
        tx.knowledgeV2Document.count({
          where: {
            tenantId: publication.tenantId,
            sourceId,
            deletedAt: null,
            status: "NEEDS_REVIEW",
          },
        }),
        tx.knowledgeV2Document.count({
          where: {
            tenantId: publication.tenantId,
            sourceId,
            deletedAt: null,
            status: "DISCOVERED",
          },
        }),
      ]);
      const status = needsReview > 0 ? "NEEDS_REVIEW" : pending > 0 ? "SYNCING" : "READY";
      const sourceUpdated = await tx.knowledgeV2Source.updateMany({
        where: {
          id: sourceId,
          tenantId: publication.tenantId,
          generation: source.generation,
          etag: source.etag,
          sourcePermissionVersion: source.sourcePermissionVersion,
          deletedAt: null,
          tombstonedAt: null,
        },
        data: {
          status,
          ...(status === "READY" ? { lastSuccessAt: activatedAt } : {}),
          lastErrorCode: null,
          lastErrorAt: null,
          etag: { increment: 1 },
        },
      });
      if (sourceUpdated.count !== 1) throw this.manifestConflict();
    }
  }

  private async candidateProjection(
    db: KnowledgeDb,
    tenantId: string,
    evaluatedAt = new Date(),
  ): Promise<CandidateProjection> {
    const [settingsRecord, documents, facts, guidanceRules, openReviews, openConflicts, pointer] =
      await Promise.all([
        db.knowledgeV2Settings.findUnique({ where: { tenantId } }),
        db.knowledgeV2Document.findMany({
          where: { tenantId, deletedAt: null, tombstonedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            scope: true,
            audience: true,
            classification: true,
            permissionVersion: true,
            currentDraftRevisionId: true,
            source: {
              select: {
                id: true,
                tenantId: true,
                kind: true,
                status: true,
                sourcePermissionVersion: true,
                defaultScope: true,
                defaultClassification: true,
                defaultLocale: true,
                lastErrorCode: true,
                tombstonedAt: true,
                deletedAt: true,
              },
            },
            currentDraftRevision: {
              select: {
                id: true,
                contentHash: true,
                status: true,
                sourcePermissionFingerprint: true,
                scopeSnapshot: true,
                effectiveFrom: true,
                effectiveUntil: true,
                staleAfter: true,
                deletedAt: true,
                chunks: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    contentHash: true,
                    scope: true,
                    locale: true,
                    permissionVersion: true,
                    denseSchemaVersion: true,
                    sparseSchemaVersion: true,
                    pipelineVersion: true,
                  },
                  orderBy: { ordinal: "asc" },
                },
              },
            },
          },
          orderBy: { id: "asc" },
        }),
        db.knowledgeV2Fact.findMany({
          where: { tenantId, deletedAt: null },
          select: {
            id: true,
            factKey: true,
            entityType: true,
            latestVersionNumber: true,
            versions: {
              orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                id: true,
                versionNumber: true,
                immutableHash: true,
                displayValue: true,
                scope: true,
                effectiveFrom: true,
                effectiveUntil: true,
                riskLevel: true,
                authority: true,
                verifiedByUserId: true,
                lifecycleStatus: true,
                verificationStatus: true,
                evidence: {
                  select: {
                    id: true,
                    kind: true,
                    label: true,
                    locator: true,
                    isPublic: true,
                    legacyRevisionId: true,
                    sourceReference: true,
                    elementReference: true,
                    quoteHash: true,
                    confidence: true,
                  },
                  orderBy: { id: "asc" },
                },
              },
            },
          },
          orderBy: { id: "asc" },
        }),
        db.knowledgeV2GuidanceRule.findMany({
          where: { tenantId, deletedAt: null },
          select: {
            id: true,
            title: true,
            latestVersionNumber: true,
            versions: {
              orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                id: true,
                versionNumber: true,
                immutableHash: true,
                title: true,
                scope: true,
                effectiveFrom: true,
                effectiveUntil: true,
                riskLevel: true,
                reviewStatus: true,
                requiredApproverRole: true,
                approvedByUserId: true,
                evidence: {
                  select: {
                    id: true,
                    kind: true,
                    label: true,
                    locator: true,
                    isPublic: true,
                    legacyRevisionId: true,
                    sourceReference: true,
                    elementReference: true,
                    quoteHash: true,
                    confidence: true,
                  },
                  orderBy: { id: "asc" },
                },
              },
            },
          },
          orderBy: { id: "asc" },
        }),
        db.knowledgeV2ReviewItem.findMany({
          where: {
            tenantId,
            status: { in: ["OPEN", "ASSIGNED", "IN_REVIEW"] },
          },
          select: {
            id: true,
            safeTitle: true,
            reason: true,
            riskLevel: true,
          },
          orderBy: { id: "asc" },
        }),
        db.knowledgeV2Conflict.findMany({
          where: { tenantId, status: { in: ["OPEN", "IN_REVIEW"] } },
          select: {
            id: true,
            semanticKey: true,
            severity: true,
          },
          orderBy: { id: "asc" },
        }),
        db.activeKnowledgePublication.findUnique({
          where: { tenantId_targetKey: { tenantId, targetKey } },
          include: { publication: { include: publicationInclude } },
        }),
      ]);
    const settings = settingsRecord ?? {
      publicationApprovalPolicy: "OWNER_OR_ADMIN" as const,
      draftGeneration: 1,
      defaultScope: null,
      defaultScopeGeneration: 0,
      defaultScopeHash: null,
    };
    const blockers: KnowledgeV2PublicationGateView[] = [];
    const warnings: KnowledgeV2PublicationGateView[] = [];
    const states: CandidateState[] = [];
    const items: CandidateManifestItem[] = [];
    const sourcePermissionItems = new Map<string, CandidateManifestItem>();
    const defaultScopePolicy = parseKnowledgeV2TenantDefaultScopePolicy({
      scope: settings.defaultScope,
      generation: settings.defaultScopeGeneration,
      hash: settings.defaultScopeHash,
    });
    if (settings.defaultScope !== null && !defaultScopePolicy) {
      blockers.push(
        gate(
          "KNOWLEDGE_PERMISSION_TENANT_DEFAULT_SCOPE_INVALID",
          "BLOCKED",
          "Workspace audience is invalid",
          "Repair the workspace default audience before publishing inherited knowledge.",
          { type: "SETTINGS", id: tenantId },
        ),
      );
    }

    for (const document of documents) {
      const revision = document.currentDraftRevision;
      const resource: KnowledgeV2ResourceRef = {
        type: "DOCUMENT",
        id: document.id,
        label: document.title,
      };
      const documentTarget = {
        sourceId: document.source.id,
        documentId: document.id,
        revisionId: revision?.id ?? null,
      };
      if (document.source.kind === "LEGACY_ONBOARDING") {
        warnings.push(
          gate(
            "KNOWLEDGE_PUBLICATION_LEGACY_ONBOARDING_FILTERED",
            "WARNING",
            "Legacy onboarding snapshot excluded",
            "Use the classified onboarding facts and guidance instead of the compatibility snapshot.",
            resource,
            documentTarget,
          ),
        );
        continue;
      }
      if (!revision || document.currentDraftRevisionId !== revision.id) {
        blockers.push(
          gate(
            "KNOWLEDGE_DEPENDENCY_DOCUMENT_HEAD_INVALID",
            "BLOCKED",
            "Document revision is unavailable",
            "The current document revision could not be reconciled.",
            resource,
            documentTarget,
          ),
        );
        continue;
      }
      scopeView(document.source.defaultScope);
      scopeView(document.scope);
      scopeView(revision.scopeSnapshot);
      for (const chunk of revision.chunks) scopeView(chunk.scope);
      const currentFingerprint = sourcePermissionFingerprint(document.source);
      const effectiveScope = revision.scopeSnapshot ?? document.scope;
      const effectiveScopeView = scopeView(effectiveScope);
      const audiencePolicy = resolveKnowledgeV2PersistedAudiences(
        document.audience,
        document.classification,
      );
      const permissionReady =
        audiencePolicy.state !== "INVALID" &&
        revision.sourcePermissionFingerprint === currentFingerprint &&
        document.permissionVersion === document.source.sourcePermissionVersion &&
        revision.chunks.every(
          (chunk) =>
            chunk.permissionVersion === document.permissionVersion &&
            sameScope(chunk.scope, effectiveScope) &&
            knowledgeV2DocumentPrefilterEnforcesScope(
              effectiveScopeView,
              audiencePolicy.audiences,
              chunk.locale,
            ) &&
            Boolean(chunk.denseSchemaVersion) &&
            Boolean(chunk.sparseSchemaVersion) &&
            Boolean(chunk.pipelineVersion),
        );
      const sourceReady =
        !document.source.deletedAt &&
        !document.source.tombstonedAt &&
        (["SYNCING", "READY", "PAUSED"].includes(document.source.status) ||
          (document.source.status === "FAILED" &&
            document.source.lastErrorCode === "KNOWLEDGE_DEPENDENCY_INDEXING_UNAVAILABLE"));
      const documentReady = ["DISCOVERED", "ACTIVE"].includes(document.status);
      const revisionReady =
        !revision.deletedAt && ["CHUNKING", "READY", "PUBLISHED"].includes(revision.status);
      const currentlyEffective =
        isEffective(revision.effectiveFrom, revision.effectiveUntil, evaluatedAt) &&
        (!revision.staleAfter || revision.staleAfter > evaluatedAt);
      if (
        !sourceReady ||
        !documentReady ||
        !revisionReady ||
        !permissionReady ||
        revision.chunks.length === 0
      ) {
        blockers.push(
          gate(
            permissionReady
              ? "KNOWLEDGE_DEPENDENCY_DOCUMENT_INDEX_INPUT_INVALID"
              : "KNOWLEDGE_PERMISSION_DOCUMENT_FINGERPRINT_MISMATCH",
            "BLOCKED",
            "Document is not ready for indexing",
            "The document content, permission snapshot, and chunks must reconcile before publication.",
            resource,
            documentTarget,
          ),
        );
        continue;
      }
      if (!currentlyEffective) {
        warnings.push(
          gate(
            "KNOWLEDGE_PUBLICATION_DOCUMENT_NOT_EFFECTIVE",
            "WARNING",
            "Document is outside its effective window",
            "This document revision will not be included in the current publication.",
            resource,
            documentTarget,
          ),
        );
        continue;
      }
      items.push({
        itemType: "DOCUMENT_REVISION",
        itemId: revision.id,
        itemVersionHash: revision.contentHash,
        label: document.title,
        scope: revision.scopeSnapshot ?? document.scope,
        usesTenantDefaultScope: false,
        tenantDefaultScopeGeneration: null,
        tenantDefaultScopeHash: null,
        authorizationFingerprint: currentFingerprint,
      });
      sourcePermissionItems.set(document.source.id, {
        itemType: "SOURCE_PERMISSION_SNAPSHOT",
        itemId: document.source.id,
        itemVersionHash: canonicalKnowledgeV2Hash({
          sourceId: document.source.id,
          permissionVersion: document.source.sourcePermissionVersion,
          authorizationFingerprint: currentFingerprint,
        }),
        label: "Source permission snapshot",
        scope: document.source.defaultScope,
        usesTenantDefaultScope: false,
        tenantDefaultScopeGeneration: null,
        tenantDefaultScopeHash: null,
        authorizationFingerprint: currentFingerprint,
      });
    }
    items.push(...sourcePermissionItems.values());

    for (const fact of facts) {
      const version = fact.versions[0];
      const factLabel = knowledgeV2FactReadinessLabel(fact.factKey, version?.displayValue);
      const resource: KnowledgeV2ResourceRef = {
        type: "FACT",
        id: fact.id,
        label: factLabel,
      };
      if (!version || version.versionNumber !== fact.latestVersionNumber) {
        blockers.push(
          gate(
            "KNOWLEDGE_DEPENDENCY_FACT_HEAD_INVALID",
            "BLOCKED",
            "Fact version is unavailable",
            "The current fact version could not be reconciled.",
            resource,
          ),
        );
        continue;
      }
      const factScope = scopeView(version.scope);
      const factScopeBinding = resolveKnowledgeV2StructuredScope(version.scope, defaultScopePolicy);
      const currentlyEffective = isEffective(
        version.effectiveFrom,
        version.effectiveUntil,
        evaluatedAt,
      );
      const denied =
        version.lifecycleStatus === "ARCHIVED" || version.verificationStatus === "REJECTED";
      const highRisk = ["HIGH", "CRITICAL"].includes(version.riskLevel);
      const highRiskReady =
        !highRisk ||
        (version.evidence.length > 0 &&
          version.authority === "OWNER_VERIFIED" &&
          Boolean(version.verifiedByUserId) &&
          Boolean(version.effectiveUntil && version.effectiveUntil > evaluatedAt));
      const eligible =
        !denied &&
        currentlyEffective &&
        highRiskReady &&
        Boolean(factScopeBinding) &&
        version.verificationStatus === "VERIFIED";
      const fingerprint = factScopeBinding
        ? authorizationFingerprint({
            itemType: "FACT_VERSION",
            binding: factScopeBinding,
            riskLevel: version.riskLevel,
            authority: {
              authority: version.authority,
              verifiedByUserId: version.verifiedByUserId,
            },
            evidence: version.evidence,
          })
        : "";
      states.push({
        itemType: "FACT_VERSION",
        itemId: version.id,
        itemVersionHash: version.immutableHash,
        stableId: fact.id,
        label: factLabel,
        scope: factScopeBinding ? persistedScopeJson(factScopeBinding.scope) : version.scope,
        authorizationFingerprint: fingerprint,
        effectiveFrom: dateValue(version.effectiveFrom),
        effectiveUntil: dateValue(version.effectiveUntil),
        eligible,
        denied,
        riskLevel: version.riskLevel,
        fact: {
          lifecycleStatus: version.lifecycleStatus,
          verificationStatus: version.verificationStatus,
        },
      });
      if (eligible) {
        items.push({
          itemType: "FACT_VERSION",
          itemId: version.id,
          itemVersionHash: version.immutableHash,
          label: factLabel,
          scope: persistedScopeJson(factScopeBinding!.scope),
          usesTenantDefaultScope: factScopeBinding!.usesTenantDefaultScope,
          tenantDefaultScopeGeneration: factScopeBinding!.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: factScopeBinding!.tenantDefaultScopeHash,
          authorizationFingerprint: fingerprint,
        });
      } else if (!denied && !factScopeBinding) {
        blockers.push(
          gate(
            factScope.usesTenantDefault
              ? "KNOWLEDGE_PERMISSION_TENANT_DEFAULT_SCOPE_UNAVAILABLE"
              : "KNOWLEDGE_PERMISSION_EXPLICIT_AUDIENCE_REQUIRED",
            "BLOCKED",
            "Fact audience is required",
            factScope.usesTenantDefault
              ? "Set a workspace default audience or choose an explicit audience for this fact."
              : "Choose at least one explicit audience before publishing this fact.",
            resource,
          ),
        );
      } else if (!denied && !highRiskReady) {
        blockers.push(
          gate(
            "KNOWLEDGE_PUBLICATION_HIGH_RISK_FACT_EVIDENCE_REQUIRED",
            "BLOCKED",
            "High-risk fact needs current evidence",
            "High-risk facts require owner-verified authority, evidence, and a future expiry.",
            resource,
            {
              task: fact.entityType === "BUSINESS_OFFERING" ? "verify-services" : "verify-fact",
            },
          ),
        );
      } else if (!denied && !currentlyEffective) {
        warnings.push(
          gate(
            "KNOWLEDGE_PUBLICATION_FACT_NOT_EFFECTIVE",
            "WARNING",
            "Fact is outside its effective window",
            "This fact will not be included in the current publication.",
            resource,
          ),
        );
      } else if (!denied) {
        blockers.push(
          gate(
            version.verificationStatus === "CONFLICTED"
              ? "KNOWLEDGE_PUBLICATION_FACT_CONFLICTED"
              : "KNOWLEDGE_PUBLICATION_FACT_REVIEW_REQUIRED",
            "BLOCKED",
            "Fact review required",
            "Verify this fact before publication.",
            resource,
          ),
        );
      }
    }

    for (const rule of guidanceRules) {
      const version = rule.versions[0];
      const resource: KnowledgeV2ResourceRef = {
        type: "GUIDANCE_RULE",
        id: rule.id,
        label: rule.title,
      };
      if (!version || version.versionNumber !== rule.latestVersionNumber) {
        blockers.push(
          gate(
            "KNOWLEDGE_DEPENDENCY_GUIDANCE_HEAD_INVALID",
            "BLOCKED",
            "Guidance version is unavailable",
            "The current guidance version could not be reconciled.",
            resource,
          ),
        );
        continue;
      }
      const guidanceScope = scopeView(version.scope);
      const guidanceScopeBinding = resolveKnowledgeV2StructuredScope(
        version.scope,
        defaultScopePolicy,
      );
      const currentlyEffective = isEffective(
        version.effectiveFrom,
        version.effectiveUntil,
        evaluatedAt,
      );
      const denied = ["REJECTED", "DISABLED"].includes(version.reviewStatus);
      const highRisk = ["HIGH", "CRITICAL"].includes(version.riskLevel);
      const highRiskReady =
        !highRisk ||
        (version.evidence.length > 0 &&
          Boolean(version.approvedByUserId) &&
          ["OWNER", "ADMIN"].includes(version.requiredApproverRole ?? "") &&
          Boolean(version.effectiveUntil && version.effectiveUntil > evaluatedAt));
      const eligible =
        !denied &&
        currentlyEffective &&
        highRiskReady &&
        Boolean(guidanceScopeBinding) &&
        version.reviewStatus === "APPROVED";
      const fingerprint = guidanceScopeBinding
        ? authorizationFingerprint({
            itemType: "GUIDANCE_RULE_VERSION",
            binding: guidanceScopeBinding,
            riskLevel: version.riskLevel,
            authority: {
              requiredApproverRole: version.requiredApproverRole,
              approvedByUserId: version.approvedByUserId,
            },
            evidence: version.evidence,
          })
        : "";
      states.push({
        itemType: "GUIDANCE_RULE_VERSION",
        itemId: version.id,
        itemVersionHash: version.immutableHash,
        stableId: rule.id,
        label: version.title,
        scope: guidanceScopeBinding
          ? persistedScopeJson(guidanceScopeBinding.scope)
          : version.scope,
        authorizationFingerprint: fingerprint,
        effectiveFrom: dateValue(version.effectiveFrom),
        effectiveUntil: dateValue(version.effectiveUntil),
        eligible,
        denied,
        riskLevel: version.riskLevel,
        guidance: { reviewStatus: version.reviewStatus },
      });
      if (eligible) {
        items.push({
          itemType: "GUIDANCE_RULE_VERSION",
          itemId: version.id,
          itemVersionHash: version.immutableHash,
          label: version.title,
          scope: persistedScopeJson(guidanceScopeBinding!.scope),
          usesTenantDefaultScope: guidanceScopeBinding!.usesTenantDefaultScope,
          tenantDefaultScopeGeneration: guidanceScopeBinding!.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: guidanceScopeBinding!.tenantDefaultScopeHash,
          authorizationFingerprint: fingerprint,
        });
      } else if (!denied && !guidanceScopeBinding) {
        blockers.push(
          gate(
            guidanceScope.usesTenantDefault
              ? "KNOWLEDGE_PERMISSION_TENANT_DEFAULT_SCOPE_UNAVAILABLE"
              : "KNOWLEDGE_PERMISSION_EXPLICIT_AUDIENCE_REQUIRED",
            "BLOCKED",
            "Guidance audience is required",
            guidanceScope.usesTenantDefault
              ? "Set a workspace default audience or choose an explicit audience for this guidance rule."
              : "Choose at least one explicit audience before publishing this guidance rule.",
            resource,
          ),
        );
      } else if (!denied && !highRiskReady) {
        blockers.push(
          gate(
            "KNOWLEDGE_PUBLICATION_HIGH_RISK_GUIDANCE_EVIDENCE_REQUIRED",
            "BLOCKED",
            "High-risk guidance needs current evidence",
            "High-risk guidance requires evidence, owner/admin approval policy, and a future expiry.",
            resource,
          ),
        );
      } else if (!denied && !currentlyEffective) {
        warnings.push(
          gate(
            "KNOWLEDGE_PUBLICATION_GUIDANCE_NOT_EFFECTIVE",
            "WARNING",
            "Guidance is outside its effective window",
            "This guidance rule will not be included in the current publication.",
            resource,
          ),
        );
      } else if (!denied) {
        blockers.push(
          gate(
            "KNOWLEDGE_PUBLICATION_GUIDANCE_REVIEW_REQUIRED",
            "BLOCKED",
            "Guidance approval required",
            "Approve this guidance rule before publication.",
            resource,
          ),
        );
      }
    }
    for (const review of openReviews) {
      const reviewGate = gate(
        review.reason === "SENSITIVE_CONTENT"
          ? "KNOWLEDGE_SECURITY_REVIEW_REQUIRED"
          : "KNOWLEDGE_PUBLICATION_REVIEW_REQUIRED",
        review.reason === "SENSITIVE_CONTENT" || ["HIGH", "CRITICAL"].includes(review.riskLevel)
          ? "BLOCKED"
          : "WARNING",
        "Knowledge review required",
        "Resolve this review item before including its affected content.",
        { type: "REVIEW_ITEM", id: review.id, label: review.safeTitle },
      );
      if (reviewGate.status === "BLOCKED") blockers.push(reviewGate);
      else warnings.push(reviewGate);
    }
    for (const conflict of openConflicts) {
      blockers.push(
        gate(
          "KNOWLEDGE_PUBLICATION_CONFLICT_UNRESOLVED",
          "BLOCKED",
          "Knowledge conflict requires a decision",
          "Choose an explicit conflict resolution before publication.",
          { type: "CONFLICT", id: conflict.id, label: conflict.semanticKey },
        ),
      );
    }
    if (items.length === 0) {
      blockers.push(
        gate(
          "KNOWLEDGE_PUBLICATION_EMPTY",
          "BLOCKED",
          "No publishable knowledge",
          "Add and verify at least one business fact before publishing.",
        ),
      );
    }
    const sortedItems = items.sort((left, right) =>
      compareCanonicalText(`${left.itemType}:${left.itemId}`, `${right.itemType}:${right.itemId}`),
    );
    const active =
      pointer &&
      pointer.publication.corpusKind === corpusKind &&
      pointer.publication.targetKey === targetKey &&
      pointer.publication.status === "ACTIVE"
        ? {
            publicationId: pointer.publication.id,
            sequence: pointer.publication.sequence,
            etag: pointer.etag,
            manifestHash: pointer.publication.manifestHash,
            status: pointer.publication.status,
            corpusKind: pointer.publication.corpusKind,
            itemCounts: itemCounts(pointer.publication.items),
            servingEligible:
              pointer.publication.items.every((item) =>
                this.publicationItemEligible(item, evaluatedAt, defaultScopePolicy),
              ) &&
              manifestHash(
                pointer.publication.items.map((item) =>
                  this.manifestItemFromRecord(item, true, defaultScopePolicy),
                ),
              ) === pointer.publication.manifestHash,
          }
        : null;
    if (pointer && !active) {
      blockers.push(
        gate(
          "KNOWLEDGE_DEPENDENCY_ACTIVE_PUBLICATION_INVALID",
          "BLOCKED",
          "Active publication is inconsistent",
          "The structured publication pointer requires reconciliation.",
        ),
      );
    }
    return {
      candidateId: targetKey,
      candidateVersion: settings.draftGeneration,
      basePublicationId: active?.publicationId ?? null,
      basePublicationSequence: active?.sequence ?? null,
      manifestHash: manifestHash(sortedItems),
      items: sortedItems,
      states,
      blockers,
      warnings,
      validUntil: new Date(evaluatedAt.getTime() + validationTtlMs),
      itemCounts: itemCounts(sortedItems),
      settings: {
        publicationApprovalPolicy: settings.publicationApprovalPolicy,
        draftGeneration: settings.draftGeneration,
      },
      active,
    };
  }

  private publicationSummary(
    publication: PublicationRecord,
    _context: RequestContext,
    canRollback: boolean,
  ): KnowledgeV2PublicationSummary {
    const metadata = qualityMetadata(publication.qualitySummary);
    const creator = actor(metadata.actorUserId);
    const active = publication.activePointers.some(
      (pointer) => pointer.targetKey === targetKey && pointer.tenantId === publication.tenantId,
    );
    const rollbackAllowed =
      canRollback && !active && ["SUPERSEDED", "ROLLED_BACK"].includes(publication.status);
    return {
      id: publication.id,
      targetKey: publication.targetKey,
      sequence: publication.sequence,
      status: publication.status,
      isActive: active,
      basePublicationId: publication.basePublicationId,
      sourcePublicationId: metadata.sourcePublicationId,
      validationId: publication.validation?.id ?? null,
      itemCounts: itemCounts(publication.items),
      validationStatus: publication.validation ? validationStatus(publication.validation) : null,
      capabilitySetHash: publication.capabilitySetHash,
      requirementEvaluationSetHash: publication.requirementEvaluationSetHash,
      diff: publicationDiff(publication),
      allowedActions: rollbackAllowed ? ["VIEW", "ROLLBACK"] : ["VIEW"],
      createdAt: publication.createdAt.toISOString(),
      createdBy: creator,
      approvedAt: metadata.approvedAt ?? publication.readyAt?.toISOString() ?? null,
      approvedBy: creator,
      activatedAt: dateValue(publication.activatedAt),
      supersededAt: dateValue(publication.supersededAt),
      failedAt: dateValue(publication.failedAt),
      failureCode:
        publication.failureCode && isKnowledgeErrorCode(publication.failureCode)
          ? publication.failureCode
          : null,
    };
  }

  private publicationDetail(
    publication: PublicationRecord,
    context: RequestContext,
    canRollback: boolean,
  ): KnowledgeV2PublicationDetail {
    const metadata = qualityMetadata(publication.qualitySummary);
    return {
      ...this.publicationSummary(publication, context, canRollback),
      validation: publication.validation ? validationView(publication.validation) : null,
      items: publication.items.map(publicationItemView),
      rollbackReason: metadata.rollbackReason,
    };
  }

  private async createActivationRequest(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      actorUserId: string;
      operation: "PUBLISH" | "ROLLBACK";
      items: CandidateManifestItem[];
      manifestHash: string;
      basePublicationId: string | null;
      validationId: string;
      candidateId: string;
      candidateVersion: number;
      indexSnapshotId: string | null;
      approvalNote?: string | null;
      sourcePublicationId?: string;
      rollbackReason?: string;
      capabilitySetHash: string;
      requirementEvaluationSetHash: string;
      capabilityEvaluation: KnowledgeV2CapabilityEvaluationBundle;
    },
  ) {
    const settings = await tx.knowledgeV2Settings.findUnique({
      where: { tenantId: input.tenantId },
      select: { retrievalProcessorPolicy: true, modelProcessorPolicy: true },
    });
    const policyVersions = runtimePolicyVersions(settings);
    if (!policyVersions) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_DEPENDENCY_PROCESSOR_POLICY_INVALID",
        "The approved knowledge processor policy is unavailable.",
      );
    }
    const latest = await tx.knowledgePublication.aggregate({
      where: { tenantId: input.tenantId, targetKey },
      _max: { sequence: true },
    });
    const sequence = (latest._max.sequence ?? 0) + 1;
    const now = new Date();
    const requiresIndexPreparation =
      input.indexSnapshotId === null &&
      input.items.some((item) => item.itemType === "DOCUMENT_REVISION");
    const publication = await tx.knowledgePublication.create({
      data: {
        tenantId: input.tenantId,
        targetKey,
        corpusKind,
        sequence,
        status: requiresIndexPreparation ? "VALIDATING" : "READY",
        indexSnapshotId: input.indexSnapshotId,
        basePublicationId: input.basePublicationId,
        manifestHash: input.manifestHash,
        pipelineVersion,
        ...policyVersions,
        capabilitySetHash: input.capabilitySetHash,
        requirementEvaluationSetHash: input.requirementEvaluationSetHash,
        ...operationalBinding(input.capabilityEvaluation),
        qualitySummary: {
          schemaVersion: 1,
          operation: input.operation,
          actorUserId: input.actorUserId,
          candidateId: input.candidateId,
          candidateVersion: input.candidateVersion,
          validationId: input.validationId,
          approvedAt: now.toISOString(),
          ...(input.approvalNote
            ? { approvalNoteHash: canonicalKnowledgeV2Hash(input.approvalNote) }
            : {}),
          ...(input.sourcePublicationId ? { sourcePublicationId: input.sourcePublicationId } : {}),
          ...(input.rollbackReason ? { rollbackReason: input.rollbackReason } : {}),
        },
        readyAt: requiresIndexPreparation ? null : now,
      },
    });
    await tx.knowledgeV2PublicationValidation.update({
      where: { id: input.validationId },
      data: { publicationId: publication.id },
    });
    await this.capabilities().createPublicationSnapshots(tx, {
      tenantId: input.tenantId,
      publicationId: publication.id,
      validationId: input.validationId,
      bundle: input.capabilityEvaluation,
    });
    if (input.items.length > 0) {
      await tx.knowledgePublicationItem.createMany({
        data: input.items.map((item) => ({
          tenantId: input.tenantId,
          publicationId: publication.id,
          corpusKind: "STRUCTURED_V2" as const,
          itemType: item.itemType,
          itemId: item.itemId,
          itemVersionHash: item.itemVersionHash,
          v2DocumentRevisionId: item.itemType === "DOCUMENT_REVISION" ? item.itemId : null,
          factVersionId: item.itemType === "FACT_VERSION" ? item.itemId : null,
          guidanceRuleVersionId: item.itemType === "GUIDANCE_RULE_VERSION" ? item.itemId : null,
          scope: item.scope === null ? Prisma.JsonNull : inputJson(item.scope),
          usesTenantDefaultScope: item.usesTenantDefaultScope,
          tenantDefaultScopeGeneration: item.tenantDefaultScopeGeneration,
          tenantDefaultScopeHash: item.tenantDefaultScopeHash,
          authorizationFingerprint: item.authorizationFingerprint,
        })),
      });
    }
    const jobId = randomUUID();
    const outboxId = randomUUID();
    const deadlineAt = new Date(now.getTime() + activationDeadlineMs);
    const job = await tx.knowledgeJob.create({
      data: {
        id: jobId,
        tenantId: input.tenantId,
        idempotencyKey: `${activationEventType}:${publication.id}`,
        stage: input.operation === "ROLLBACK" ? "ROLLING_BACK" : "PUBLISHING",
        pipelineVersion,
        generation: sequence,
        status: "QUEUED",
        deadlineAt,
        maxAttempts: 5,
        progressTotal: input.items.length,
        payloadRef: `knowledge-outbox:${outboxId}`,
        publicationId: publication.id,
      },
    });
    await tx.knowledgeOutbox.create({
      data: {
        id: outboxId,
        tenantId: input.tenantId,
        aggregateType: "KnowledgePublication",
        aggregateId: publication.id,
        aggregateVersion: sequence,
        eventType: activationEventType,
        schemaVersion: 1,
        dedupeKey: `${activationEventType}:${publication.id}`,
        payload: {
          publicationId: publication.id,
          actorUserId: input.actorUserId,
          operation: input.operation,
          jobId: job.id,
        },
        deadlineAt,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action:
          input.operation === "ROLLBACK"
            ? "knowledge.v2.publication.rollback_requested"
            : "knowledge.v2.publication.publish_requested",
        entityType: "knowledge_publication",
        entityId: publication.id,
        payload: {
          targetKey,
          corpusKind,
          sequence,
          validationId: input.validationId,
          itemCount: input.items.length,
          basePublicationId: input.basePublicationId,
          ...(input.sourcePublicationId ? { sourcePublicationId: input.sourcePublicationId } : {}),
        },
      },
    });
    return {
      publicationId: publication.id,
      jobId: job.id,
      response: {
        jobId: job.id,
        status: job.status,
        acceptedAt: job.createdAt.toISOString(),
        resource: { type: "PUBLICATION" as const, id: publication.id },
        idempotencyReplayed: false,
      },
    };
  }

  private rollbackManifest(
    publication: PublicationRecord,
    now: Date,
    defaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null,
  ) {
    const items: CandidateManifestItem[] = [];
    const warnings: KnowledgeV2PublicationGateView[] = [];
    const eligibleDocumentSourceIds = new Set(
      publication.items.flatMap((item) =>
        item.itemType === "DOCUMENT_REVISION" &&
        item.v2DocumentRevision &&
        this.publicationItemEligible(item, now, defaultScopePolicy)
          ? [item.v2DocumentRevision.sourceId]
          : [],
      ),
    );
    for (const item of publication.items) {
      const eligible =
        this.publicationItemEligible(item, now, defaultScopePolicy) &&
        (item.itemType !== "SOURCE_PERMISSION_SNAPSHOT" ||
          eligibleDocumentSourceIds.has(item.itemId));
      if (eligible) {
        items.push(this.manifestItemFromRecord(item, true, defaultScopePolicy));
      } else {
        warnings.push(
          gate(
            "KNOWLEDGE_PUBLICATION_ROLLBACK_ITEM_FILTERED",
            "WARNING",
            "Rollback item is no longer eligible",
            "A deleted, denied, or ineffective item was excluded from the rollback.",
            { type: "PUBLICATION", id: publication.id },
          ),
        );
      }
    }
    return { items, warnings, manifestHash: manifestHash(items) };
  }

  private publicationItemEligible(
    item: PublicationItemRecord,
    now: Date,
    defaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null = null,
  ) {
    if (item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision) {
      const revision = item.v2DocumentRevision;
      const document = revision.document;
      const source = document.source;
      const fingerprint = sourcePermissionFingerprint(source);
      return (
        !revision.deletedAt &&
        ["READY", "PUBLISHED"].includes(revision.status) &&
        !document.deletedAt &&
        !document.tombstonedAt &&
        ["ACTIVE", "DISCOVERED"].includes(document.status) &&
        source.kind !== "LEGACY_ONBOARDING" &&
        !source.deletedAt &&
        !source.tombstonedAt &&
        ["READY", "SYNCING", "PAUSED"].includes(source.status) &&
        document.permissionVersion === source.sourcePermissionVersion &&
        revision.sourcePermissionFingerprint === fingerprint &&
        item.authorizationFingerprint === fingerprint &&
        item.itemVersionHash === revision.contentHash &&
        isEffective(revision.effectiveFrom, revision.effectiveUntil, now) &&
        (!revision.staleAfter || revision.staleAfter > now)
      );
    }
    if (item.itemType === "FACT_VERSION" && item.factVersion) {
      const binding = resolveKnowledgeV2StructuredScope(item.factVersion.scope, defaultScopePolicy);
      const head = item.factVersion.fact.versions[0];
      const currentHeadAllowsRollback =
        head !== undefined &&
        head.versionNumber === item.factVersion.fact.latestVersionNumber &&
        head.lifecycleStatus !== "ARCHIVED" &&
        !["REJECTED", "CONFLICTED"].includes(head.verificationStatus);
      const highRisk = ["HIGH", "CRITICAL"].includes(item.factVersion.riskLevel);
      const highRiskReady =
        !highRisk ||
        (item.factVersion.evidence.length > 0 &&
          item.factVersion.authority === "OWNER_VERIFIED" &&
          Boolean(item.factVersion.verifiedByUserId) &&
          Boolean(item.factVersion.effectiveUntil && item.factVersion.effectiveUntil > now));
      return (
        Boolean(binding) &&
        sameScopeBinding(item, binding!) &&
        !item.factVersion.fact.deletedAt &&
        currentHeadAllowsRollback &&
        highRiskReady &&
        item.authorizationFingerprint ===
          authorizationFingerprint({
            itemType: "FACT_VERSION",
            binding: binding!,
            riskLevel: item.factVersion.riskLevel,
            authority: {
              authority: item.factVersion.authority,
              verifiedByUserId: item.factVersion.verifiedByUserId,
            },
            evidence: item.factVersion.evidence,
          }) &&
        item.factVersion.lifecycleStatus !== "ARCHIVED" &&
        item.factVersion.verificationStatus === "VERIFIED" &&
        isEffective(item.factVersion.effectiveFrom, item.factVersion.effectiveUntil, now)
      );
    }
    if (item.itemType === "GUIDANCE_RULE_VERSION" && item.guidanceRuleVersion) {
      const binding = resolveKnowledgeV2StructuredScope(
        item.guidanceRuleVersion.scope,
        defaultScopePolicy,
      );
      const head = item.guidanceRuleVersion.guidanceRule.versions[0];
      const currentHeadAllowsRollback =
        head !== undefined &&
        head.versionNumber === item.guidanceRuleVersion.guidanceRule.latestVersionNumber &&
        !["REJECTED", "DISABLED"].includes(head.reviewStatus);
      const highRisk = ["HIGH", "CRITICAL"].includes(item.guidanceRuleVersion.riskLevel);
      const highRiskReady =
        !highRisk ||
        (item.guidanceRuleVersion.evidence.length > 0 &&
          Boolean(item.guidanceRuleVersion.approvedByUserId) &&
          ["OWNER", "ADMIN"].includes(item.guidanceRuleVersion.requiredApproverRole ?? "") &&
          Boolean(
            item.guidanceRuleVersion.effectiveUntil &&
            item.guidanceRuleVersion.effectiveUntil > now,
          ));
      return (
        Boolean(binding) &&
        sameScopeBinding(item, binding!) &&
        !item.guidanceRuleVersion.guidanceRule.deletedAt &&
        currentHeadAllowsRollback &&
        highRiskReady &&
        item.authorizationFingerprint ===
          authorizationFingerprint({
            itemType: "GUIDANCE_RULE_VERSION",
            binding: binding!,
            riskLevel: item.guidanceRuleVersion.riskLevel,
            authority: {
              requiredApproverRole: item.guidanceRuleVersion.requiredApproverRole,
              approvedByUserId: item.guidanceRuleVersion.approvedByUserId,
            },
            evidence: item.guidanceRuleVersion.evidence,
          }) &&
        item.guidanceRuleVersion.reviewStatus === "APPROVED" &&
        isEffective(
          item.guidanceRuleVersion.effectiveFrom,
          item.guidanceRuleVersion.effectiveUntil,
          now,
        )
      );
    }
    return item.itemType === "SOURCE_PERMISSION_SNAPSHOT" && Boolean(item.authorizationFingerprint);
  }

  private manifestItemFromRecord(
    item: PublicationItemRecord,
    recomputeAuthorization = false,
    defaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null = null,
  ): CandidateManifestItem {
    scopeView(item.scope);
    const binding =
      item.itemType === "FACT_VERSION" && item.factVersion
        ? resolveKnowledgeV2StructuredScope(item.factVersion.scope, defaultScopePolicy)
        : item.itemType === "GUIDANCE_RULE_VERSION" && item.guidanceRuleVersion
          ? resolveKnowledgeV2StructuredScope(item.guidanceRuleVersion.scope, defaultScopePolicy)
          : null;
    const label =
      item.itemType === "DOCUMENT_REVISION"
        ? (item.v2DocumentRevision?.document.title ?? item.itemId)
        : item.itemType === "FACT_VERSION"
          ? (item.factVersion?.fact.factKey ?? item.itemId)
          : item.itemType === "GUIDANCE_RULE_VERSION"
            ? (item.guidanceRuleVersion?.title ?? item.itemId)
            : "Source permission snapshot";
    const currentAuthorizationFingerprint =
      recomputeAuthorization && item.itemType === "DOCUMENT_REVISION" && item.v2DocumentRevision
        ? sourcePermissionFingerprint(item.v2DocumentRevision.document.source)
        : recomputeAuthorization && item.itemType === "FACT_VERSION" && item.factVersion
          ? binding
            ? authorizationFingerprint({
                itemType: "FACT_VERSION",
                binding,
                riskLevel: item.factVersion.riskLevel,
                authority: {
                  authority: item.factVersion.authority,
                  verifiedByUserId: item.factVersion.verifiedByUserId,
                },
                evidence: item.factVersion.evidence,
              })
            : null
          : recomputeAuthorization &&
              item.itemType === "GUIDANCE_RULE_VERSION" &&
              item.guidanceRuleVersion
            ? binding
              ? authorizationFingerprint({
                  itemType: "GUIDANCE_RULE_VERSION",
                  binding,
                  riskLevel: item.guidanceRuleVersion.riskLevel,
                  authority: {
                    requiredApproverRole: item.guidanceRuleVersion.requiredApproverRole,
                    approvedByUserId: item.guidanceRuleVersion.approvedByUserId,
                  },
                  evidence: item.guidanceRuleVersion.evidence,
                })
              : null
            : item.authorizationFingerprint;
    if (!item.itemVersionHash || !currentAuthorizationFingerprint) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_MANIFEST_INVALID",
        "The publication manifest contains incomplete authorization metadata.",
      );
    }
    return {
      itemType: item.itemType as CandidateManifestItem["itemType"],
      itemId: item.itemId,
      itemVersionHash: item.itemVersionHash,
      label,
      scope: recomputeAuthorization && binding ? persistedScopeJson(binding.scope) : item.scope,
      usesTenantDefaultScope:
        recomputeAuthorization && binding
          ? binding.usesTenantDefaultScope
          : item.usesTenantDefaultScope,
      tenantDefaultScopeGeneration:
        recomputeAuthorization && binding
          ? binding.tenantDefaultScopeGeneration
          : item.tenantDefaultScopeGeneration,
      tenantDefaultScopeHash:
        recomputeAuthorization && binding
          ? binding.tenantDefaultScopeHash
          : item.tenantDefaultScopeHash,
      authorizationFingerprint: currentAuthorizationFingerprint,
    };
  }

  private assertRollbackItemsStillEligible(
    publication: PublicationRecord,
    now: Date,
    defaultScopePolicy: KnowledgeV2TenantDefaultScopePolicy | null,
  ) {
    if (
      publication.items.some((item) => !this.publicationItemEligible(item, now, defaultScopePolicy))
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_ROLLBACK_STALE",
        "The rollback manifest changed before activation.",
      );
    }
  }

  private assertCandidate(
    dto: { candidateId: string; candidateVersion: number },
    projection: CandidateProjection,
  ) {
    if (
      dto.candidateId !== projection.candidateId ||
      dto.candidateVersion !== projection.candidateVersion
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_CONFLICT_CANDIDATE_STALE",
        "The knowledge draft changed. Reload readiness and validate the latest candidate.",
      );
    }
  }

  private assertValidation(
    validation: ValidationRecord | null,
    dto: KnowledgeV2CreatePublicationRequest,
    projection: CandidateProjection,
  ): asserts validation is ValidationRecord {
    if (!validation) {
      throw knowledgeV2Error(
        HttpStatus.NOT_FOUND,
        "KNOWLEDGE_PUBLICATION_VALIDATION_NOT_FOUND",
        "The publication validation was not found.",
      );
    }
    if (
      validation.status !== "PASSED" ||
      !validation.evaluatedAt ||
      !validation.validUntil ||
      validation.validUntil <= new Date()
    ) {
      throw knowledgeV2Error(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "KNOWLEDGE_PUBLICATION_VALIDATION_REQUIRED",
        "Run publication validation again before publishing.",
      );
    }
    if (
      validation.publicationId ||
      validation.validationPolicyVersion !== validationPolicyVersion ||
      validation.candidateId !== dto.candidateId ||
      validation.candidateVersion !== dto.candidateVersion ||
      validation.candidateManifestHash !== projection.manifestHash ||
      validation.basePublicationId !== projection.basePublicationId ||
      manifestHash(parseManifestItems(validation.candidateItems)) !== projection.manifestHash
    ) {
      throw knowledgeV2Error(
        HttpStatus.CONFLICT,
        "KNOWLEDGE_PUBLICATION_VALIDATION_STALE",
        "The validation does not match the exact current candidate.",
      );
    }
  }

  private validationFailed(blockers: KnowledgeV2PublicationGateView[]): never {
    throw knowledgeV2Error(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "KNOWLEDGE_PUBLICATION_VALIDATION_FAILED",
      "The publication is blocked by validation requirements.",
      { details: { blockerCount: blockers.length } },
    );
  }

  private async lockTarget(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`knowledge-v2:publication-target:${tenantId}:${targetKey}`}, 0)
        )
      ) AS publication_lock
    `);
  }

  private async lockDraftSettings(tx: Prisma.TransactionClient, tenantId: string) {
    const tenants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Tenant"
      WHERE "id" = ${tenantId} AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    if (tenants.length !== 1) {
      throw knowledgeV2Error(
        HttpStatus.NOT_FOUND,
        "KNOWLEDGE_DEPENDENCY_TENANT_NOT_FOUND",
        "The knowledge workspace was not found.",
      );
    }
    await tx.knowledgeV2Settings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
    await tx.$queryRaw<Array<{ tenantId: string }>>(Prisma.sql`
      SELECT "tenantId"
      FROM "KnowledgeV2Settings"
      WHERE "tenantId" = ${tenantId}
      FOR UPDATE
    `);
  }

  private async currentDefaultScopePolicy(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<KnowledgeV2TenantDefaultScopePolicy | null> {
    const settings = await tx.knowledgeV2Settings.findUnique({
      where: { tenantId },
      select: {
        defaultScope: true,
        defaultScopeGeneration: true,
        defaultScopeHash: true,
      },
    });
    return settings
      ? parseKnowledgeV2TenantDefaultScopePolicy({
          scope: settings.defaultScope,
          generation: settings.defaultScopeGeneration,
          hash: settings.defaultScopeHash,
        })
      : null;
  }

  private async assertActivationActor(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; actorUserId: string | null },
  ) {
    if (!input.actorUserId) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_PUBLICATION_APPROVAL_REQUIRED",
        "Publication activation requires an active owner or administrator.",
      );
    }
    const [membership, settings] = await Promise.all([
      tx.membership.findUnique({
        where: {
          tenantId_userId: { tenantId: input.tenantId, userId: input.actorUserId },
        },
        select: {
          role: true,
          user: { select: { deletedAt: true } },
          tenant: { select: { status: true, deletedAt: true } },
        },
      }),
      tx.knowledgeV2Settings.findUnique({
        where: { tenantId: input.tenantId },
        select: { publicationApprovalPolicy: true },
      }),
    ]);
    const policy = settings?.publicationApprovalPolicy ?? "OWNER_OR_ADMIN";
    const permittedRole =
      membership?.role === "OWNER" || (policy === "OWNER_OR_ADMIN" && membership?.role === "ADMIN");
    if (
      !membership ||
      membership.user.deletedAt ||
      membership.tenant.deletedAt ||
      !["TRIALING", "ACTIVE"].includes(membership.tenant.status) ||
      !permittedRole
    ) {
      throw knowledgeV2Error(
        HttpStatus.FORBIDDEN,
        "KNOWLEDGE_PERMISSION_PUBLICATION_APPROVAL_REQUIRED",
        "Publication activation requires an active owner or administrator.",
      );
    }
  }

  private assertTarget(value: string) {
    if (value !== targetKey) {
      throw knowledgeV2Error(
        HttpStatus.BAD_REQUEST,
        "KNOWLEDGE_VALIDATION_PUBLICATION_TARGET_INVALID",
        "Only the structured workspace publication target is supported.",
        { field: "targetKey" },
      );
    }
  }

  private canApprove(
    context: RequestContext,
    policy: CandidateProjection["settings"]["publicationApprovalPolicy"],
  ) {
    return context.role === "OWNER" || (policy === "OWNER_OR_ADMIN" && context.role === "ADMIN");
  }

  private async canApproveForContext(context: RequestContext) {
    const settings = await this.prisma.knowledgeV2Settings.findUnique({
      where: { tenantId: context.tenantId },
      select: { publicationApprovalPolicy: true },
    });
    return this.canApprove(context, settings?.publicationApprovalPolicy ?? "OWNER_OR_ADMIN");
  }

  private activeEtag(
    tenantId: string,
    active: { publicationId: string; sequence: number; etag: number },
  ) {
    return strongKnowledgeV2Etag(
      "active-publication",
      `${tenantId}:${targetKey}`,
      `${active.etag}:${active.sequence}:${active.publicationId}`,
    );
  }

  private emptyActiveEtag(tenantId: string) {
    return strongKnowledgeV2Etag("active-publication", `${tenantId}:${targetKey}`, "empty");
  }

  private manifestConflict() {
    return knowledgeV2Error(
      HttpStatus.CONFLICT,
      "KNOWLEDGE_PUBLICATION_MANIFEST_INVALID",
      "The publication manifest failed reconciliation.",
    );
  }

  private notFound(): never {
    throw knowledgeV2Error(
      HttpStatus.NOT_FOUND,
      "KNOWLEDGE_PUBLICATION_NOT_FOUND",
      "The knowledge publication was not found.",
    );
  }
}
