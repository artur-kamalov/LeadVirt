import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@leadvirt/db";
import {
  hashKnowledgeValue,
  lockKnowledgeCorpusTransition,
  stableKnowledgeValue,
} from "@leadvirt/knowledge";
import {
  parseRuntimeQueueEnvelope,
  type BusinessInformationProjectionJobData,
  type BusinessInformationRevisionProjectionJobData,
} from "@leadvirt/runtime-queue";

const TARGET_KEY = "workspace-v2";
const PROJECTION_SCHEMA = "leadvirt.business-information-projection.v1";
const IDENTITY_FACT_SCHEMA = "leadvirt.business-identity-fact.v1";
const OFFERING_FACT_SCHEMA = "leadvirt.business-offering-fact.v1";
const MANIFEST_SCHEMA = "leadvirt.business-information-knowledge-manifest.v1";
export const BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID =
  "leadvirt.business-information.price-effective-window.explicit-or-owner-approval-90d.v1";
const OWNER_APPROVAL_PRICE_FRESHNESS_MS = 90 * 24 * 60 * 60_000;

type ProjectionStage = "VALIDATING" | "PROJECTING" | "FINALIZING";

interface ProjectionRuntimeFields {
  [key: string]: unknown;
  runtimeEventId: string;
  runtimeGeneration: number;
}

export type BusinessInformationImportProjectionRuntimeData = BusinessInformationProjectionJobData &
  ProjectionRuntimeFields;

export type BusinessInformationRevisionProjectionRuntimeData =
  BusinessInformationRevisionProjectionJobData & ProjectionRuntimeFields;

export type BusinessInformationProjectionRuntimeData =
  | BusinessInformationImportProjectionRuntimeData
  | BusinessInformationRevisionProjectionRuntimeData;

export interface BusinessInformationProjectionJob {
  id: string;
  name: "project" | "project-revision";
  data: BusinessInformationProjectionRuntimeData;
  signal: AbortSignal;
}

export interface BusinessInformationProjectionDependencies {
  prisma: PrismaClient;
  now: () => Date;
}

export class BusinessInformationProjectionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly stage: ProjectionStage,
  ) {
    super("Business Information draft projection could not be completed.");
    this.name = "BusinessInformationProjectionError";
  }
}

interface ProjectionEvidence {
  key: string;
  fieldPaths: string[];
  kind: "EXTERNAL_REFERENCE" | "MANUAL";
  locator: string;
  quoteHash: string;
  confidence: number | null;
  sourceReference: Prisma.InputJsonObject;
  elementReference: Prisma.InputJsonObject;
  metadata: Prisma.InputJsonObject;
}

interface FactManifestItem {
  factKey: string;
  factId: string;
  versionId: string;
  versionNumber: number;
  immutableHash: string;
  lifecycleStatus: "DRAFT" | "ARCHIVED";
}

interface ImportedAttribution {
  id: string;
  fieldPath: string;
  confidence: string | null;
  sourceId: string | null;
  importId: string | null;
  candidateId: string | null;
  candidateVersion: number | null;
  candidateValueHash: string | null;
  evidenceId: string | null;
  artifactId: string | null;
  artifactSha256: string | null;
  importGeneration: number | null;
  parsedRevisionId: string | null;
  parsedManifestHash: string | null;
  applicationId: string | null;
  businessRevisionId: string;
  businessRevision: number;
  businessRevisionHash: string;
  parserVersion: string | null;
  ocrVersion: string | null;
  mapperVersion: string | null;
  schemaVersion: string | null;
  modelVersion: string | null;
  promptVersion: string | null;
  evidence: {
    id: string;
    excerptHash: string;
    excerptObjectLedgerId: string;
    sourceValueHash: string;
    semanticElementId: string | null;
    semanticTableId: string | null;
    extractionContractVersion: string;
  } | null;
}

interface EvidenceTarget {
  tenantResource: "business-identity" | "business-offering";
  resourceIdKey: "identityId" | "offeringId";
  resourceId: string;
}

type ExistingFact = Prisma.KnowledgeV2FactGetPayload<{
  include: {
    versions: {
      include: { evidence: true };
    };
  };
}>;

interface ProjectedFactInput {
  target: EvidenceTarget;
  factKey: string;
  factId: string;
  versionId: string;
  entityType: string;
  fieldType: string;
  normalizedValue: Prisma.InputJsonObject;
  displayValue: string;
  localizedValues: Prisma.InputJsonObject;
  unit: string | null;
  currency: string | null;
  timeZone: string | null;
  locale: string;
  scope: Prisma.InputJsonObject;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  effectiveWindowPolicyId: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  authorities: ReadonlySet<string>;
  ownerApproval: { userId: string; approvedAt: Date } | null;
  lifecycleStatus: "DRAFT" | "ARCHIVED";
  evidence: ProjectionEvidence[];
}

export function businessInformationLinkProjectionCanReuse(input: {
  candidateActions: readonly string[];
  baseRevisionId: string | null;
  baseRevision: number;
  baseInformationHash: string;
  resultingInformationHash: string;
  priorProjection: {
    revisionId: string;
    revision: number;
    informationHash: string;
    draftGeneration: number;
    draftManifestHash: string;
  } | null;
  currentDraftGeneration: number | null;
  currentDraftManifestHash: string | null;
}) {
  return (
    input.candidateActions.length > 0 &&
    input.candidateActions.every((action) => action === "LINK") &&
    input.baseInformationHash === input.resultingInformationHash &&
    input.baseRevisionId !== null &&
    input.priorProjection?.revisionId === input.baseRevisionId &&
    input.priorProjection.revision === input.baseRevision &&
    input.priorProjection.informationHash === input.baseInformationHash &&
    input.currentDraftGeneration === input.priorProjection.draftGeneration &&
    input.currentDraftManifestHash === input.priorProjection.draftManifestHash
  );
}

export function businessInformationProjectionGovernance(input: {
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  authorities: ReadonlySet<string>;
  requestedByUserId: string;
  projectedAt: Date;
  ownerApproval: { userId: string; approvedAt: Date } | null;
}) {
  const provenanceAuthority =
    input.authorities.size > 0 && [...input.authorities].every((item) => item === "IMPORTED")
      ? ("IMPORTED" as const)
      : ("MANUAL" as const);
  if (input.riskLevel === "HIGH" && !input.ownerApproval) {
    return {
      authority: provenanceAuthority,
      verificationStatus: "PENDING_REVIEW" as const,
      verifiedByUserId: null,
      verifiedAt: null,
    };
  }
  return {
    authority:
      input.riskLevel === "HIGH" && input.ownerApproval
        ? ("OWNER_VERIFIED" as const)
        : provenanceAuthority,
    verificationStatus: "VERIFIED" as const,
    verifiedByUserId: input.ownerApproval?.userId ?? input.requestedByUserId,
    verifiedAt: input.ownerApproval?.approvedAt ?? input.projectedAt,
  };
}

export function businessInformationProjectionOfferingEffectiveWindow(input: {
  prices: ReadonlyArray<{ effectiveFrom: Date | null; effectiveUntil: Date | null }>;
  ownerApproval: { approvedAt: Date } | null;
}) {
  if (input.prices.length === 0) {
    return {
      effectiveFrom: null,
      effectiveUntil: null,
      policyId: null,
    };
  }
  const starts = input.prices
    .map((price) => price.effectiveFrom)
    .filter((value): value is Date => value !== null);
  const effectiveFrom =
    starts.length > 0 ? new Date(Math.max(...starts.map((value) => value.getTime()))) : null;
  const approvalFreshUntil = input.ownerApproval
    ? new Date(input.ownerApproval.approvedAt.getTime() + OWNER_APPROVAL_PRICE_FRESHNESS_MS)
    : null;
  const expiries = input.prices.map((price) => price.effectiveUntil ?? approvalFreshUntil);
  if (expiries.some((value) => value === null)) {
    return {
      effectiveFrom,
      effectiveUntil: null,
      policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
    };
  }
  return {
    effectiveFrom,
    effectiveUntil: new Date(Math.min(...expiries.map((value) => value!.getTime()))),
    policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  };
}

export function businessInformationProjectionExactOwnerApproval(input: {
  requiresApproval: boolean;
  approvalGrantId: string | null;
  grant: {
    id: string;
    grantedByUserId: string;
    grantedAt: Date;
    membershipRole: string;
    approvalState: string;
    approvalInvalidatedAt: Date | null;
    approvalDecidedByUserId: string | null;
    approvalDecidedAt: Date | null;
  } | null;
}) {
  const grant = input.grant;
  if (
    !input.requiresApproval ||
    !grant ||
    input.approvalGrantId !== grant.id ||
    grant.approvalState !== "APPROVED" ||
    grant.approvalInvalidatedAt !== null ||
    grant.approvalDecidedByUserId !== grant.grantedByUserId ||
    grant.approvalDecidedAt?.getTime() !== grant.grantedAt.getTime() ||
    !["OWNER", "ADMIN"].includes(grant.membershipRole)
  ) {
    return null;
  }
  return { userId: grant.grantedByUserId, approvedAt: grant.grantedAt };
}

const importRuntimeDataKeys = new Set([
  "tenantId",
  "sourceId",
  "importId",
  "applicationId",
  "businessRevisionId",
  "businessRevision",
  "generation",
  "requestedByUserId",
  "requestedAt",
  "runtimeEventId",
  "runtimeGeneration",
]);

const revisionRuntimeDataKeys = new Set([
  "tenantId",
  "businessRevisionId",
  "businessRevision",
  "generation",
  "requestedByUserId",
  "requestedAt",
  "runtimeEventId",
  "runtimeGeneration",
]);

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^c[a-z0-9]{24}$/u.test(value) ||
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value))
  );
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validSharedRuntimeData(value: Record<string, unknown>) {
  return (
    validId(value.tenantId) &&
    validId(value.businessRevisionId) &&
    validId(value.requestedByUserId) &&
    validId(value.runtimeEventId) &&
    typeof value.businessRevision === "number" &&
    Number.isInteger(value.businessRevision) &&
    value.businessRevision > 0 &&
    typeof value.generation === "number" &&
    Number.isInteger(value.generation) &&
    value.generation > 0 &&
    value.runtimeGeneration === value.generation &&
    validTimestamp(value.requestedAt)
  );
}

export function isBusinessInformationProjectionRuntimeData(
  value: Record<string, unknown>,
): value is BusinessInformationProjectionRuntimeData {
  if (!validSharedRuntimeData(value)) return false;
  if ("applicationId" in value) {
    return (
      Object.keys(value).length === importRuntimeDataKeys.size &&
      Object.keys(value).every((key) => importRuntimeDataKeys.has(key)) &&
      validId(value.sourceId) &&
      validId(value.importId) &&
      validId(value.applicationId)
    );
  }
  return (
    Object.keys(value).length === revisionRuntimeDataKeys.size &&
    Object.keys(value).every((key) => revisionRuntimeDataKeys.has(key)) &&
    value.generation === value.businessRevision
  );
}

function isImportProjection(
  data: BusinessInformationProjectionRuntimeData,
): data is BusinessInformationImportProjectionRuntimeData {
  return "applicationId" in data;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalBusinessInformationProjectionJson(value: unknown) {
  return stableKnowledgeValue(canonicalize(value));
}

export function businessInformationProjectionHash(value: unknown) {
  return hashKnowledgeValue(canonicalBusinessInformationProjectionJson(value));
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${businessInformationProjectionHash(parts).slice(0, 24)}`;
}

function appliedOfferingId(tenantId: string, candidateId: string) {
  return `bio_${createHash("sha256")
    .update([tenantId, candidateId].join("\0"), "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function assertActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new BusinessInformationProjectionError(
      "BUSINESS_INFORMATION_PROJECTION_INTERRUPTED",
      true,
      "PROJECTING",
    );
  }
}

function fail(code: string, retryable: boolean, stage: ProjectionStage): never {
  throw new BusinessInformationProjectionError(code, retryable, stage);
}

function confidence(value: string | null) {
  if (value === "CONFIRMED_FORMAT") return 1;
  if (value === "HIGH") return 0.9;
  if (value === "MEDIUM") return 0.7;
  if (value === "LOW") return 0.4;
  return null;
}

function safeError(error: unknown) {
  if (error instanceof BusinessInformationProjectionError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return new BusinessInformationProjectionError(
      "BUSINESS_INFORMATION_PROJECTION_SERIALIZATION_CONFLICT",
      true,
      "PROJECTING",
    );
  }
  return new BusinessInformationProjectionError(
    "BUSINESS_INFORMATION_PROJECTION_DEPENDENCY_FAILED",
    true,
    "PROJECTING",
  );
}

export function businessInformationProjectionSafeError(error: unknown) {
  const safe = safeError(error);
  return {
    code: safe.code,
    retryable: safe.retryable,
    stage: safe.stage,
    message: safe.message,
  };
}

function expectedJobIdentity(data: BusinessInformationProjectionRuntimeData) {
  return isImportProjection(data)
    ? {
        name: "project" as const,
        id: `business-import-project:${data.applicationId}:${data.businessRevision}`,
        eventType: "business.import.project.requested",
      }
    : {
        name: "project-revision" as const,
        id: `business-information-project:${data.businessRevisionId}:${data.businessRevision}`,
        eventType: "business.information.project.requested",
      };
}

function persistedProjectionData(data: BusinessInformationProjectionRuntimeData) {
  if (isImportProjection(data)) {
    return {
      tenantId: data.tenantId,
      sourceId: data.sourceId,
      importId: data.importId,
      applicationId: data.applicationId,
      businessRevisionId: data.businessRevisionId,
      businessRevision: data.businessRevision,
      generation: data.generation,
      requestedByUserId: data.requestedByUserId,
      requestedAt: data.requestedAt,
    };
  }
  return {
    tenantId: data.tenantId,
    businessRevisionId: data.businessRevisionId,
    businessRevision: data.businessRevision,
    generation: data.generation,
    requestedByUserId: data.requestedByUserId,
    requestedAt: data.requestedAt,
  };
}

function projectionEnvelopeMatches(
  payload: Prisma.JsonValue,
  data: BusinessInformationProjectionRuntimeData,
  jobId: string,
) {
  let envelope;
  try {
    envelope = parseRuntimeQueueEnvelope(payload);
  } catch {
    return false;
  }
  const expected = expectedJobIdentity(data);
  return (
    envelope.queueName === "business.import" &&
    envelope.jobName === expected.name &&
    envelope.jobId === jobId &&
    envelope.attempts === 10 &&
    envelope.backoffMs === 2_000 &&
    canonicalBusinessInformationProjectionJson(envelope.data) ===
      canonicalBusinessInformationProjectionJson(persistedProjectionData(data))
  );
}

function importedEvidence(
  attribution: ImportedAttribution,
  target: EvidenceTarget,
): ProjectionEvidence | null {
  const evidence = attribution.evidence;
  if (
    !evidence ||
    !attribution.sourceId ||
    !attribution.importId ||
    !attribution.candidateId ||
    !attribution.candidateVersion ||
    !attribution.candidateValueHash ||
    !attribution.evidenceId ||
    !attribution.artifactId ||
    !attribution.artifactSha256 ||
    !attribution.importGeneration ||
    !attribution.parsedRevisionId ||
    !attribution.parsedManifestHash ||
    !attribution.applicationId
  ) {
    return null;
  }
  const resourceReference = { [target.resourceIdKey]: target.resourceId };
  return {
    key: evidence.id,
    fieldPaths: [attribution.fieldPath],
    kind: "EXTERNAL_REFERENCE",
    locator: `business-import-evidence:${evidence.id}`,
    quoteHash: evidence.excerptHash,
    confidence: confidence(attribution.confidence),
    sourceReference: {
      projectionSchema: PROJECTION_SCHEMA,
      tenantResource: target.tenantResource,
      ...resourceReference,
      sourceId: attribution.sourceId,
      importId: attribution.importId,
      candidateId: attribution.candidateId,
      candidateVersion: attribution.candidateVersion,
      candidateValueHash: attribution.candidateValueHash,
      evidenceId: evidence.id,
      artifactId: attribution.artifactId,
      artifactSha256: attribution.artifactSha256,
      importGeneration: attribution.importGeneration,
      parsedRevisionId: attribution.parsedRevisionId,
      parsedManifestHash: attribution.parsedManifestHash,
      applicationId: attribution.applicationId,
      businessRevisionId: attribution.businessRevisionId,
      businessRevision: attribution.businessRevision,
      businessRevisionHash: attribution.businessRevisionHash,
      excerptObjectLedgerId: evidence.excerptObjectLedgerId,
    },
    elementReference: {
      ...resourceReference,
      fieldPaths: [attribution.fieldPath],
      semanticElementId: evidence.semanticElementId,
      semanticTableId: evidence.semanticTableId,
    },
    metadata: {
      projectionSchema: PROJECTION_SCHEMA,
      sourceValueHash: evidence.sourceValueHash,
      parserVersion: attribution.parserVersion,
      ocrVersion: attribution.ocrVersion,
      mapperVersion: attribution.mapperVersion,
      schemaVersion: attribution.schemaVersion,
      modelVersion: attribution.modelVersion,
      promptVersion: attribution.promptVersion,
      extractionContractVersion: evidence.extractionContractVersion,
    },
  };
}

export function businessInformationProjectionImportedEvidence(
  attribution: ImportedAttribution,
  offeringId: string,
): ProjectionEvidence | null {
  return importedEvidence(attribution, {
    tenantResource: "business-offering",
    resourceIdKey: "offeringId",
    resourceId: offeringId,
  });
}

function manualEvidence(
  attribution: {
    id: string;
    authority: string;
    resourceType: string;
    resourceKey: string;
    fieldPath: string;
    currentValueHash: string;
    businessRevisionId: string;
    businessRevision: number;
    businessRevisionHash: string;
  },
  target: EvidenceTarget,
): ProjectionEvidence | null {
  if (attribution.authority !== "MANUAL") return null;
  const resourceReference = { [target.resourceIdKey]: target.resourceId };
  return {
    key: attribution.id,
    fieldPaths: [attribution.fieldPath],
    kind: "MANUAL",
    locator: `business-information-attribution:${attribution.id}`,
    quoteHash: attribution.currentValueHash,
    confidence: null,
    sourceReference: {
      projectionSchema: PROJECTION_SCHEMA,
      provenance: "MANUAL_ATTRIBUTION",
      tenantResource: target.tenantResource,
      ...resourceReference,
      attributionId: attribution.id,
      resourceType: attribution.resourceType,
      resourceKey: attribution.resourceKey,
      businessRevisionId: attribution.businessRevisionId,
      businessRevision: attribution.businessRevision,
      businessRevisionHash: attribution.businessRevisionHash,
    },
    elementReference: {
      ...resourceReference,
      fieldPaths: [attribution.fieldPath],
    },
    metadata: {
      projectionSchema: PROJECTION_SCHEMA,
      authority: "CANONICAL_MANUAL",
    },
  };
}

function revisionEvidence(
  data: BusinessInformationProjectionRuntimeData,
  revisionHash: string,
  target: EvidenceTarget,
): ProjectionEvidence {
  const resourceReference = { [target.resourceIdKey]: target.resourceId };
  return {
    key: `revision:${data.businessRevisionId}`,
    fieldPaths: [],
    kind: "MANUAL",
    locator: `business-information-revision:${data.businessRevisionId}`,
    quoteHash: revisionHash,
    confidence: null,
    sourceReference: {
      projectionSchema: PROJECTION_SCHEMA,
      provenance: "CANONICAL_REVISION",
      revisionOrigin: isImportProjection(data) ? "IMPORT" : "MANUAL",
      tenantResource: target.tenantResource,
      ...resourceReference,
      businessRevisionId: data.businessRevisionId,
      businessRevision: data.businessRevision,
      businessRevisionHash: revisionHash,
      ...(isImportProjection(data) ? { applicationId: data.applicationId } : {}),
    },
    elementReference: {
      ...resourceReference,
      fieldPaths: [],
    },
    metadata: {
      projectionSchema: PROJECTION_SCHEMA,
      authority: "CANONICAL",
    },
  };
}

function mergeEvidence(existing: ProjectionEvidence, incoming: ProjectionEvidence) {
  const paths = [...existing.fieldPaths, ...incoming.fieldPaths].sort();
  existing.fieldPaths = [...new Set(paths)];
  existing.elementReference = {
    ...existing.elementReference,
    fieldPaths: existing.fieldPaths,
  };
  if (incoming.confidence !== null) {
    existing.confidence =
      existing.confidence === null
        ? incoming.confidence
        : Math.min(existing.confidence, incoming.confidence);
  }
}

function addEvidence(map: Map<string, ProjectionEvidence>, evidence: ProjectionEvidence | null) {
  if (!evidence) return;
  const existing = map.get(evidence.key);
  if (existing) mergeEvidence(existing, evidence);
  else map.set(evidence.key, evidence);
}

async function markProjectionDelayed(
  dependencies: BusinessInformationProjectionDependencies,
  data: BusinessInformationProjectionRuntimeData,
  error: BusinessInformationProjectionError,
) {
  if (!isImportProjection(data)) return;
  await dependencies.prisma.$transaction(async (tx) => {
    const application = await tx.businessImportApplication.updateMany({
      where: {
        id: data.applicationId,
        tenantId: data.tenantId,
        sourceId: data.sourceId,
        importId: data.importId,
        businessRevisionId: data.businessRevisionId,
        resultingInformationRevision: data.businessRevision,
        projectionOutboxId: data.runtimeEventId,
        projectionOutboxDedupeKey: `business-import-project:${data.applicationId}:${data.businessRevision}`,
        projectionReceiptHash: null,
        state: { in: ["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"] },
      },
      data: { state: "PROJECTION_DELAYED" },
    });
    if (application.count !== 1) return;
    await tx.businessImport.updateMany({
      where: {
        id: data.importId,
        tenantId: data.tenantId,
        sourceId: data.sourceId,
        generation: data.generation,
        state: { in: ["PROJECTING", "PROJECTION_DELAYED"] },
      },
      data: {
        state: "PROJECTION_DELAYED",
        failureCode: error.code,
        failureStage: "PROJECTION",
        retryable: false,
        etag: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorUserId: null,
        action: "business_information.projection_delayed",
        entityType: "BusinessImportApplication",
        entityId: data.applicationId,
        payload: {
          applicationId: data.applicationId,
          importId: data.importId,
          businessRevisionId: data.businessRevisionId,
          businessRevision: data.businessRevision,
          runtimeEventId: data.runtimeEventId,
          generation: data.generation,
          errorCode: error.code,
          retryable: error.retryable,
        },
      },
    });
  });
}

async function projectFact(
  tx: Prisma.TransactionClient,
  data: BusinessInformationProjectionRuntimeData,
  existing: ExistingFact | undefined,
  input: ProjectedFactInput,
  projectedAt: Date,
) {
  const previous = existing?.versions[0] ?? null;
  const evidence = input.effectiveWindowPolicyId
    ? input.evidence.map((item) => ({
        ...item,
        metadata: {
          ...item.metadata,
          effectiveWindowPolicyId: input.effectiveWindowPolicyId,
        },
      }))
    : input.evidence;
  const previousOwned =
    !previous ||
    previous.evidence.some((evidence) => {
      const reference =
        typeof evidence.sourceReference === "object" &&
        evidence.sourceReference !== null &&
        !Array.isArray(evidence.sourceReference)
          ? evidence.sourceReference
          : {};
      return (
        reference.projectionSchema === PROJECTION_SCHEMA &&
        reference[input.target.resourceIdKey] === input.target.resourceId
      );
    });
  if (
    existing &&
    (existing.entityType !== input.entityType ||
      existing.fieldType !== input.fieldType ||
      existing.entityId !== null ||
      !previous ||
      previous.versionNumber !== existing.latestVersionNumber ||
      !previousOwned)
  ) {
    fail("BUSINESS_INFORMATION_PROJECTION_FACT_OWNERSHIP_CONFLICT", false, "PROJECTING");
  }
  const versionNumber = (existing?.latestVersionNumber ?? 0) + 1;
  const governance = businessInformationProjectionGovernance({
    riskLevel: input.riskLevel,
    authorities: input.authorities,
    requestedByUserId: data.requestedByUserId,
    projectedAt,
    ownerApproval: input.ownerApproval,
  });
  const immutableHash = businessInformationProjectionHash({
    schema: PROJECTION_SCHEMA,
    fact: {
      id: input.factId,
      factKey: input.factKey,
      entityType: input.entityType,
      entityId: null,
      fieldType: input.fieldType,
    },
    versionNumber,
    normalizedValue: input.normalizedValue,
    displayValue: input.displayValue,
    localizedValues: input.localizedValues,
    unit: input.unit,
    currency: input.currency,
    timeZone: input.timeZone,
    locale: input.locale,
    localeBehavior: "LOCALE_SPECIFIC",
    scope: input.scope,
    effectiveFrom: input.effectiveFrom?.toISOString() ?? null,
    effectiveUntil: input.effectiveUntil?.toISOString() ?? null,
    effectiveWindowPolicyId: input.effectiveWindowPolicyId,
    riskLevel: input.riskLevel,
    authority: governance.authority,
    lifecycleStatus: input.lifecycleStatus,
    verificationStatus: governance.verificationStatus,
    changeReason: "Business Information revision projection",
    supersedesVersionId: previous?.id ?? null,
    createdByUserId: data.requestedByUserId,
    verifiedByUserId: governance.verifiedByUserId,
    verifiedAt: governance.verifiedAt?.toISOString() ?? null,
    createdAt: projectedAt.toISOString(),
    evidence,
  });
  if (!existing) {
    await tx.knowledgeV2Fact.create({
      data: {
        id: input.factId,
        tenantId: data.tenantId,
        entityType: input.entityType,
        factKey: input.factKey,
        fieldType: input.fieldType,
        latestVersionNumber: 1,
        createdByUserId: data.requestedByUserId,
        updatedByUserId: data.requestedByUserId,
      },
    });
  } else {
    const updated = await tx.knowledgeV2Fact.updateMany({
      where: {
        id: existing.id,
        tenantId: data.tenantId,
        etag: existing.etag,
        latestVersionNumber: existing.latestVersionNumber,
      },
      data: {
        latestVersionNumber: versionNumber,
        generation: { increment: 1 },
        etag: { increment: 1 },
        updatedByUserId: data.requestedByUserId,
        deletedAt: null,
      },
    });
    if (updated.count !== 1) {
      fail("BUSINESS_INFORMATION_PROJECTION_FACT_CHANGED", true, "PROJECTING");
    }
  }
  await tx.knowledgeV2FactVersion.create({
    data: {
      id: input.versionId,
      tenantId: data.tenantId,
      factId: input.factId,
      versionNumber,
      normalizedValue: input.normalizedValue,
      displayValue: input.displayValue,
      localizedValues: input.localizedValues,
      unit: input.unit,
      currency: input.currency,
      timeZone: input.timeZone,
      locale: input.locale,
      localeBehavior: "LOCALE_SPECIFIC",
      scope: input.scope,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      riskLevel: input.riskLevel,
      authority: governance.authority,
      lifecycleStatus: input.lifecycleStatus,
      verificationStatus: governance.verificationStatus,
      extractionConfidence:
        evidence.length > 0 && evidence.every((item) => item.confidence !== null)
          ? Math.min(...evidence.map((item) => item.confidence!))
          : null,
      changeReason: "Business Information revision projection",
      supersedesVersionId: previous?.id ?? null,
      immutableHash,
      createdByUserId: data.requestedByUserId,
      verifiedByUserId: governance.verifiedByUserId,
      verifiedAt: governance.verifiedAt,
      createdAt: projectedAt,
    },
  });
  for (const item of evidence) {
    await tx.knowledgeV2Evidence.create({
      data: {
        id: stableId("kv2_bio_evidence", input.versionId, item.key),
        tenantId: data.tenantId,
        kind: item.kind,
        factVersionId: input.versionId,
        label: "Business Information evidence",
        locator: item.locator,
        isPublic: false,
        sourceReference: item.sourceReference,
        elementReference: item.elementReference,
        quoteHash: item.quoteHash,
        confidence: item.confidence,
        metadata: item.metadata,
        createdByUserId: data.requestedByUserId,
        createdAt: projectedAt,
      },
    });
  }
  return {
    factKey: input.factKey,
    factId: input.factId,
    versionId: input.versionId,
    versionNumber,
    immutableHash,
    lifecycleStatus: input.lifecycleStatus,
  } satisfies FactManifestItem;
}

export function createBusinessInformationProjectionDependencies(
  prisma: PrismaClient,
): BusinessInformationProjectionDependencies {
  return { prisma, now: () => new Date() };
}

export async function processBusinessInformationProjectionJob(
  job: BusinessInformationProjectionJob,
  dependencies: BusinessInformationProjectionDependencies,
) {
  const { data } = job;
  const expected = expectedJobIdentity(data);
  if (job.name !== expected.name || job.id !== expected.id) {
    fail("BUSINESS_INFORMATION_PROJECTION_JOB_FENCE_INVALID", false, "VALIDATING");
  }
  assertActive(job.signal);
  try {
    return await dependencies.prisma.$transaction(
      async (tx) => {
        await lockKnowledgeCorpusTransition(tx, data.tenantId);
        await tx.$queryRaw(Prisma.sql`
          SELECT TRUE AS "locked"
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(
            ${`business-information-state:${data.tenantId}`},
            0
          ))) AS business_information_state_lock
        `);
        assertActive(job.signal);

        const [outbox, state] = await Promise.all([
          tx.runtimeOutbox.findFirst({
            where: { id: data.runtimeEventId, tenantId: data.tenantId },
          }),
          tx.businessInformationState.findUnique({ where: { tenantId: data.tenantId } }),
        ]);
        if (!outbox || !state) {
          fail("BUSINESS_INFORMATION_PROJECTION_REFERENCE_NOT_FOUND", false, "VALIDATING");
        }
        if (
          outbox.aggregateType !== "BusinessInformationRevision" ||
          outbox.aggregateId !== data.businessRevisionId ||
          outbox.aggregateVersion !== data.businessRevision ||
          outbox.generation !== data.generation ||
          outbox.eventType !== expected.eventType ||
          outbox.schemaVersion !== 1 ||
          outbox.dedupeKey !== expected.id ||
          !["PUBLISHED", "PUBLISHING", "FAILED"].includes(outbox.status) ||
          !projectionEnvelopeMatches(outbox.payload, data, expected.id)
        ) {
          fail("BUSINESS_INFORMATION_PROJECTION_OUTBOX_FENCE_INVALID", false, "VALIDATING");
        }

        const revision = await tx.businessInformationRevision.findFirst({
          where: {
            id: data.businessRevisionId,
            tenantId: data.tenantId,
            revision: data.businessRevision,
          },
        });
        if (!revision) {
          fail("BUSINESS_INFORMATION_PROJECTION_REVISION_NOT_FOUND", false, "VALIDATING");
        }

        const application = isImportProjection(data)
          ? await tx.businessImportApplication.findFirst({
              where: {
                id: data.applicationId,
                tenantId: data.tenantId,
                sourceId: data.sourceId,
                importId: data.importId,
              },
              include: {
                projectionReceipt: true,
                candidateItems: {
                  orderBy: { candidateId: "asc" },
                  include: {
                    candidate: { select: { targetOfferingId: true } },
                    approvalGrant: {
                      include: {
                        approval: true,
                        grantedByMembership: true,
                      },
                    },
                  },
                },
              },
            })
          : null;
        const importRecord = isImportProjection(data)
          ? await tx.businessImport.findFirst({
              where: {
                id: data.importId,
                tenantId: data.tenantId,
                sourceId: data.sourceId,
                generation: data.generation,
              },
            })
          : null;
        if (isImportProjection(data)) {
          if (!application || !importRecord) {
            fail("BUSINESS_INFORMATION_PROJECTION_REFERENCE_NOT_FOUND", false, "VALIDATING");
          }
          if (
            revision.origin !== "IMPORT" ||
            application.kind !== "APPLY" ||
            application.businessRevisionId !== data.businessRevisionId ||
            application.resultingInformationRevision !== data.businessRevision ||
            application.resultingInformationHash !== revision.canonicalHash ||
            application.projectionOutboxId !== data.runtimeEventId ||
            application.projectionOutboxDedupeKey !== expected.id ||
            application.createdByUserId !== data.requestedByUserId ||
            application.committedAt.toISOString() !== data.requestedAt
          ) {
            fail("BUSINESS_INFORMATION_PROJECTION_APPLICATION_FENCE_INVALID", false, "VALIDATING");
          }
        } else if (
          revision.origin !== "MANUAL" ||
          revision.createdByUserId !== data.requestedByUserId ||
          revision.createdAt.toISOString() !== data.requestedAt
        ) {
          fail("BUSINESS_INFORMATION_PROJECTION_REVISION_FENCE_INVALID", false, "VALIDATING");
        }

        const existingReceipt =
          application?.projectionReceipt ??
          (await tx.businessInformationProjectionReceipt.findUnique({
            where: {
              tenantId_runtimeOutboxDedupeKey: {
                tenantId: data.tenantId,
                runtimeOutboxDedupeKey: expected.id,
              },
            },
          }));
        if (existingReceipt) {
          const importReceiptValid =
            !isImportProjection(data) ||
            (application?.state === "READY" &&
              application.projectionReceiptHash === existingReceipt.receiptHash &&
              ["APPLIED", "PARTIALLY_APPLIED"].includes(importRecord?.state ?? ""));
          if (
            !importReceiptValid ||
            existingReceipt.runtimeOutboxId !== data.runtimeEventId ||
            existingReceipt.runtimeOutboxDedupeKey !== expected.id ||
            existingReceipt.businessRevisionId !== data.businessRevisionId ||
            existingReceipt.businessRevision !== data.businessRevision ||
            existingReceipt.businessRevisionHash !== revision.canonicalHash ||
            existingReceipt.sourceId !== (isImportProjection(data) ? data.sourceId : null) ||
            existingReceipt.importId !== (isImportProjection(data) ? data.importId : null) ||
            existingReceipt.applicationId !== (isImportProjection(data) ? data.applicationId : null)
          ) {
            fail("BUSINESS_INFORMATION_PROJECTION_RECEIPT_FENCE_INVALID", false, "VALIDATING");
          }
          return {
            status: "already_succeeded" as const,
            ...(isImportProjection(data) ? { applicationId: data.applicationId } : {}),
            businessRevisionId: data.businessRevisionId,
            receiptId: existingReceipt.id,
            receiptHash: existingReceipt.receiptHash,
            knowledgeDraftGeneration: existingReceipt.knowledgeDraftGeneration,
            knowledgeDraftManifestHash: existingReceipt.knowledgeDraftManifestHash,
          };
        }

        if (
          isImportProjection(data) &&
          application!.state === "SUPERSEDED" &&
          application!.projectionReceiptHash === null &&
          application!.supersededAt !== null &&
          importRecord!.state === "CLOSED_WITH_REMAINDER" &&
          state.revision > data.businessRevision &&
          state.currentRevisionId !== data.businessRevisionId
        ) {
          return {
            status: "already_superseded" as const,
            applicationId: data.applicationId,
            businessRevisionId: data.businessRevisionId,
            currentBusinessRevisionId: state.currentRevisionId,
            currentBusinessRevision: state.revision,
          };
        }
        if (
          isImportProjection(data) &&
          state.revision > data.businessRevision &&
          state.currentRevisionId !== data.businessRevisionId
        ) {
          const supersededAt = dependencies.now();
          const applicationUpdated = await tx.businessImportApplication.updateMany({
            where: {
              id: data.applicationId,
              tenantId: data.tenantId,
              sourceId: data.sourceId,
              importId: data.importId,
              businessRevisionId: data.businessRevisionId,
              resultingInformationRevision: data.businessRevision,
              resultingInformationHash: revision.canonicalHash,
              projectionOutboxId: data.runtimeEventId,
              projectionOutboxDedupeKey: expected.id,
              projectionReceiptHash: null,
              state: { in: ["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"] },
            },
            data: { state: "SUPERSEDED", supersededAt },
          });
          if (applicationUpdated.count !== 1) {
            fail("BUSINESS_INFORMATION_PROJECTION_APPLICATION_CHANGED", true, "FINALIZING");
          }
          const importUpdated = await tx.businessImport.updateMany({
            where: {
              id: data.importId,
              tenantId: data.tenantId,
              sourceId: data.sourceId,
              generation: data.generation,
              state: { in: ["PROJECTING", "PROJECTION_DELAYED"] },
            },
            data: {
              state: "CLOSED_WITH_REMAINDER",
              failureCode: null,
              failureStage: null,
              retryable: false,
              etag: { increment: 1 },
            },
          });
          if (importUpdated.count !== 1) {
            fail("BUSINESS_INFORMATION_PROJECTION_IMPORT_CHANGED", true, "FINALIZING");
          }
          await tx.auditLog.create({
            data: {
              tenantId: data.tenantId,
              actorUserId: data.requestedByUserId,
              action: "business_information.projection_superseded",
              entityType: "BusinessImportApplication",
              entityId: data.applicationId,
              payload: {
                applicationId: data.applicationId,
                importId: data.importId,
                businessRevisionId: data.businessRevisionId,
                businessRevision: data.businessRevision,
                currentBusinessRevisionId: state.currentRevisionId,
                currentBusinessRevision: state.revision,
                runtimeEventId: data.runtimeEventId,
                receiptCreated: false,
                publicationChanged: false,
              },
            },
          });
          return {
            status: "superseded" as const,
            applicationId: data.applicationId,
            businessRevisionId: data.businessRevisionId,
            currentBusinessRevisionId: state.currentRevisionId,
            currentBusinessRevision: state.revision,
          };
        }

        if (
          state.currentRevisionId !== data.businessRevisionId ||
          state.revision !== data.businessRevision ||
          state.canonicalHash !== revision.canonicalHash ||
          (isImportProjection(data) &&
            (!["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"].includes(application!.state) ||
              !["PROJECTING", "PROJECTION_DELAYED"].includes(importRecord!.state)))
        ) {
          fail("BUSINESS_INFORMATION_PROJECTION_REVISION_FENCE_INVALID", false, "VALIDATING");
        }

        const [identity, offerings] = await Promise.all([
          tx.businessIdentity.findUnique({ where: { tenantId: data.tenantId } }),
          tx.businessOffering.findMany({
            where: { tenantId: data.tenantId },
            include: {
              prices: { orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }] },
              duration: true,
            },
            orderBy: { id: "asc" },
          }),
        ]);
        if (!identity) {
          fail("BUSINESS_INFORMATION_PROJECTION_IDENTITY_NOT_FOUND", false, "VALIDATING");
        }
        const canonicalHash = businessInformationProjectionHash({
          schema: "leadvirt.business-information.v2",
          identity: {
            id: identity.id,
            displayName: identity.displayName,
            legalName: identity.legalName,
            businessType: identity.businessType,
            description: identity.description,
            defaultLocale: identity.defaultLocale,
            timezone: identity.timezone,
            defaultCurrency: identity.defaultCurrency,
          },
          offerings: offerings.map((offering) => ({
            id: offering.id,
            kind: offering.kind,
            category: offering.category,
            parentCategory: offering.parentCategory,
            name: offering.name,
            description: offering.description,
            locale: offering.locale,
            bookingNotes: offering.bookingNotes,
            active: offering.active,
            archivedAt: offering.archivedAt?.toISOString() ?? null,
            prices: [...offering.prices]
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((price) => ({
                id: price.id,
                type: price.type,
                amount: price.amount?.toString() ?? null,
                amountFrom: price.amountFrom?.toString() ?? null,
                amountTo: price.amountTo?.toString() ?? null,
                currency: price.currency,
                unit: price.unit,
                taxNote: price.taxNote,
                effectiveFrom: dateOnly(price.effectiveFrom),
                effectiveUntil: dateOnly(price.effectiveUntil),
              })),
            duration: offering.duration
              ? {
                  id: offering.duration.id,
                  minimumMinutes: offering.duration.minimumMinutes,
                  maximumMinutes: offering.duration.maximumMinutes,
                  preparationMinutes: offering.duration.preparationMinutes,
                  bufferMinutes: offering.duration.bufferMinutes,
                }
              : null,
          })),
        });
        if (canonicalHash !== revision.canonicalHash) {
          fail("BUSINESS_INFORMATION_PROJECTION_CANONICAL_HASH_MISMATCH", false, "VALIDATING");
        }
        const linkOnlyCandidateSet = Boolean(
          isImportProjection(data) &&
          application!.candidateItems.length > 0 &&
          application!.candidateItems.every((item) => item.action === "LINK") &&
          application!.baseInformationHash === revision.canonicalHash,
        );
        const priorProjectionReceipt =
          linkOnlyCandidateSet &&
          application!.baseBusinessRevisionId !== null &&
          state.lastProjectedRevisionId === application!.baseBusinessRevisionId &&
          state.lastProjectedRevision === application!.baseInformationRevision &&
          state.lastProjectedHash === application!.baseInformationHash &&
          state.lastProjectionReceiptId &&
          state.lastProjectionReceiptHash
            ? await tx.businessInformationProjectionReceipt.findFirst({
                where: {
                  id: state.lastProjectionReceiptId,
                  tenantId: data.tenantId,
                  businessRevisionId: application!.baseBusinessRevisionId,
                  businessRevision: application!.baseInformationRevision,
                  businessRevisionHash: application!.baseInformationHash,
                  receiptHash: state.lastProjectionReceiptHash,
                },
              })
            : null;

        const priceOwners = new Map<string, string>();
        const durationOwners = new Map<string, string>();
        for (const offering of offerings) {
          for (const price of offering.prices) priceOwners.set(price.id, offering.id);
          if (offering.duration) durationOwners.set(offering.duration.id, offering.id);
        }
        const attributions = await tx.businessInformationAttribution.findMany({
          where: {
            tenantId: data.tenantId,
            supersededAt: null,
            resourceType: {
              in: ["BUSINESS_IDENTITY", "OFFERING", "OFFERING_PRICE", "OFFERING_DURATION"],
            },
          },
          include: { evidence: true },
          orderBy: [{ resourceType: "asc" }, { resourceKey: "asc" }, { fieldPath: "asc" }],
        });
        const identityTarget: EvidenceTarget = {
          tenantResource: "business-identity",
          resourceIdKey: "identityId",
          resourceId: identity.id,
        };
        const identityEvidence = new Map<string, ProjectionEvidence>();
        const identityAuthorities = new Set<string>();
        const evidenceByOffering = new Map<string, Map<string, ProjectionEvidence>>();
        const authoritiesByOffering = new Map<string, Set<string>>();
        for (const attribution of attributions) {
          if (attribution.identityId === identity.id) {
            identityAuthorities.add(attribution.authority);
            addEvidence(
              identityEvidence,
              attribution.authority === "IMPORTED"
                ? importedEvidence(attribution, identityTarget)
                : manualEvidence(attribution, identityTarget),
            );
            continue;
          }
          const offeringId =
            attribution.offeringId ??
            (attribution.offeringPriceId
              ? priceOwners.get(attribution.offeringPriceId)
              : undefined) ??
            (attribution.offeringDurationId
              ? durationOwners.get(attribution.offeringDurationId)
              : undefined);
          if (!offeringId) continue;
          const authorities = authoritiesByOffering.get(offeringId) ?? new Set<string>();
          authorities.add(attribution.authority);
          authoritiesByOffering.set(offeringId, authorities);
          const target: EvidenceTarget = {
            tenantResource: "business-offering",
            resourceIdKey: "offeringId",
            resourceId: offeringId,
          };
          const byKey = evidenceByOffering.get(offeringId) ?? new Map<string, ProjectionEvidence>();
          addEvidence(
            byKey,
            attribution.authority === "IMPORTED"
              ? importedEvidence(attribution, target)
              : manualEvidence(attribution, target),
          );
          evidenceByOffering.set(offeringId, byKey);
        }

        const highRiskCandidatesByOffering = new Map<
          string,
          Array<{
            candidateId: string;
            approval: { userId: string; approvedAt: Date } | null;
          }>
        >();
        for (const item of application?.candidateItems ?? []) {
          if (item.targetCategory !== "OFFERINGS" || item.risk !== "HIGH") continue;
          const offeringId =
            item.candidate.targetOfferingId ?? appliedOfferingId(data.tenantId, item.candidateId);
          const grant = item.approvalGrant;
          const exactApproval = businessInformationProjectionExactOwnerApproval({
            requiresApproval: item.requiresApproval,
            approvalGrantId: item.approvalGrantId,
            grant: grant
              ? {
                  id: grant.id,
                  grantedByUserId: grant.grantedByUserId,
                  grantedAt: grant.grantedAt,
                  membershipRole: grant.grantedByMembership.role,
                  approvalState: grant.approval.state,
                  approvalInvalidatedAt: grant.approval.invalidatedAt,
                  approvalDecidedByUserId: grant.approval.decidedByUserId,
                  approvalDecidedAt: grant.approval.decidedAt,
                }
              : null,
          });
          const candidates = highRiskCandidatesByOffering.get(offeringId) ?? [];
          candidates.push({ candidateId: item.candidateId, approval: exactApproval });
          highRiskCandidatesByOffering.set(offeringId, candidates);
        }
        const ownerApprovalByOffering = new Map<string, { userId: string; approvedAt: Date }>();
        for (const [offeringId, candidates] of highRiskCandidatesByOffering) {
          if (candidates.some((item) => !item.approval)) continue;
          const finalApproval = candidates
            .map((item) => ({ ...item.approval!, candidateId: item.candidateId }))
            .sort(
              (left, right) =>
                left.approvedAt.getTime() - right.approvedAt.getTime() ||
                left.userId.localeCompare(right.userId) ||
                left.candidateId.localeCompare(right.candidateId),
            )
            .at(-1);
          if (finalApproval) {
            ownerApprovalByOffering.set(offeringId, {
              userId: finalApproval.userId,
              approvedAt: finalApproval.approvedAt,
            });
          }
        }

        const identityFactKey = `business-information:identity:${identity.id}`;
        const offeringFactKeys = offerings.map(
          (offering) => `business-information:offering:${offering.id}`,
        );
        const existingFacts = await tx.knowledgeV2Fact.findMany({
          where: {
            tenantId: data.tenantId,
            factKey: { in: [identityFactKey, ...offeringFactKeys] },
          },
          include: {
            versions: {
              orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
              take: 1,
              include: { evidence: { orderBy: { id: "asc" } } },
            },
          },
        });
        const factsByKey = new Map(existingFacts.map((fact) => [fact.factKey, fact]));
        const existingManifestItems = existingFacts.flatMap((fact): FactManifestItem[] => {
          const version = fact.versions[0];
          if (
            !version ||
            (version.lifecycleStatus !== "DRAFT" && version.lifecycleStatus !== "ARCHIVED")
          ) {
            return [];
          }
          return [
            {
              factKey: fact.factKey,
              factId: fact.id,
              versionId: version.id,
              versionNumber: version.versionNumber,
              immutableHash: version.immutableHash,
              lifecycleStatus: version.lifecycleStatus,
            },
          ];
        });
        const currentSettings = await tx.knowledgeV2Settings.findUnique({
          where: { tenantId: data.tenantId },
          select: { draftGeneration: true },
        });
        const currentDraftManifestHash = application?.baseBusinessRevisionId
          ? businessInformationProjectionHash({
              schema: MANIFEST_SCHEMA,
              targetKey: TARGET_KEY,
              tenantId: data.tenantId,
              businessRevisionId: application.baseBusinessRevisionId,
              businessRevision: application.baseInformationRevision,
              businessRevisionHash: application.baseInformationHash,
              facts: [...existingManifestItems].sort((left, right) =>
                left.factKey.localeCompare(right.factKey),
              ),
            })
          : null;
        const linkOnlyProjection = businessInformationLinkProjectionCanReuse({
          candidateActions: application?.candidateItems.map((item) => item.action) ?? [],
          baseRevisionId: application?.baseBusinessRevisionId ?? null,
          baseRevision: application?.baseInformationRevision ?? 0,
          baseInformationHash: application?.baseInformationHash ?? "",
          resultingInformationHash: revision.canonicalHash,
          priorProjection: priorProjectionReceipt
            ? {
                revisionId: priorProjectionReceipt.businessRevisionId,
                revision: priorProjectionReceipt.businessRevision,
                informationHash: priorProjectionReceipt.businessRevisionHash,
                draftGeneration: priorProjectionReceipt.knowledgeDraftGeneration,
                draftManifestHash: priorProjectionReceipt.knowledgeDraftManifestHash,
              }
            : null,
          currentDraftGeneration: currentSettings?.draftGeneration ?? null,
          currentDraftManifestHash,
        });
        const manifestItems: FactManifestItem[] = [];
        const projectedAt = isImportProjection(data)
          ? application!.committedAt
          : revision.createdAt;

        if (linkOnlyProjection) {
          manifestItems.push(...existingManifestItems);
        } else {
          const identityEvidenceItems = [...identityEvidence.values()];
          if (
            !isImportProjection(data) ||
            identityEvidenceItems.length === 0 ||
            [...identityAuthorities].some((authority) => authority !== "IMPORTED")
          ) {
            identityEvidenceItems.push(
              revisionEvidence(data, revision.canonicalHash, identityTarget),
            );
          }
          identityEvidenceItems.sort((left, right) => left.key.localeCompare(right.key));
          const identityFactId = stableId("kv2_bii_fact", data.tenantId, identity.id);
          manifestItems.push(
            await projectFact(
              tx,
              data,
              factsByKey.get(identityFactKey),
              {
                target: identityTarget,
                factKey: identityFactKey,
                factId: identityFactId,
                versionId: stableId(
                  "kv2_bii_version",
                  data.tenantId,
                  identity.id,
                  String(data.businessRevision),
                ),
                entityType: "BUSINESS_PROFILE",
                fieldType: "BUSINESS_PROFILE",
                normalizedValue: {
                  schema: IDENTITY_FACT_SCHEMA,
                  identityId: identity.id,
                  displayName: identity.displayName,
                  legalName: identity.legalName,
                  businessType: identity.businessType,
                  description: identity.description,
                  defaultLocale: identity.defaultLocale,
                  timezone: identity.timezone,
                  defaultCurrency: identity.defaultCurrency,
                },
                displayValue: identity.displayName,
                localizedValues: {
                  [identity.defaultLocale]: {
                    displayName: identity.displayName,
                    description: identity.description,
                  },
                },
                unit: null,
                currency: identity.defaultCurrency,
                timeZone: identity.timezone,
                locale: identity.defaultLocale,
                scope: {
                  brandIds: [],
                  locationIds: [],
                  channelTypes: [],
                  assistantIds: [],
                  audiences: ["PUBLIC"],
                  segments: [],
                  locales: [identity.defaultLocale],
                },
                effectiveFrom: null,
                effectiveUntil: null,
                effectiveWindowPolicyId: null,
                riskLevel: "LOW",
                authorities: identityAuthorities,
                ownerApproval: null,
                lifecycleStatus: "DRAFT",
                evidence: identityEvidenceItems,
              },
              projectedAt,
            ),
          );

          for (const offering of offerings) {
            assertActive(job.signal);
            const target: EvidenceTarget = {
              tenantResource: "business-offering",
              resourceIdKey: "offeringId",
              resourceId: offering.id,
            };
            const factKey = `business-information:offering:${offering.id}`;
            const evidence = [...(evidenceByOffering.get(offering.id)?.values() ?? [])];
            const offeringAuthorities = authoritiesByOffering.get(offering.id) ?? new Set<string>();
            if (
              !isImportProjection(data) ||
              evidence.length === 0 ||
              [...offeringAuthorities].some((authority) => authority !== "IMPORTED")
            ) {
              evidence.push(revisionEvidence(data, revision.canonicalHash, target));
            }
            evidence.sort((left, right) => left.key.localeCompare(right.key));
            const currencies = [...new Set(offering.prices.map((price) => price.currency))];
            const units = [
              ...new Set(
                offering.prices
                  .map((price) => price.unit)
                  .filter((value): value is string => value !== null),
              ),
            ];
            const normalizedValue = {
              schema: OFFERING_FACT_SCHEMA,
              offeringId: offering.id,
              kind: offering.kind,
              category: offering.category,
              parentCategory: offering.parentCategory,
              name: offering.name,
              description: offering.description,
              locale: offering.locale,
              bookingNotes: offering.bookingNotes,
              active: offering.active,
              prices: offering.prices.map((price) => ({
                id: price.id,
                type: price.type,
                amount: price.amount?.toString() ?? null,
                amountFrom: price.amountFrom?.toString() ?? null,
                amountTo: price.amountTo?.toString() ?? null,
                currency: price.currency,
                unit: price.unit,
                taxNote: price.taxNote,
                effectiveFrom: dateOnly(price.effectiveFrom),
                effectiveUntil: dateOnly(price.effectiveUntil),
              })),
              duration: offering.duration
                ? {
                    id: offering.duration.id,
                    minimumMinutes: offering.duration.minimumMinutes,
                    maximumMinutes: offering.duration.maximumMinutes,
                    preparationMinutes: offering.duration.preparationMinutes,
                    bufferMinutes: offering.duration.bufferMinutes,
                  }
                : null,
            } satisfies Prisma.InputJsonObject;
            const factId = stableId("kv2_bio_fact", data.tenantId, offering.id);
            const riskLevel =
              offering.prices.length > 0
                ? ("HIGH" as const)
                : offering.duration || offering.bookingNotes
                  ? ("MEDIUM" as const)
                  : ("LOW" as const);
            const ownerApproval =
              riskLevel === "HIGH" ? (ownerApprovalByOffering.get(offering.id) ?? null) : null;
            const effectiveWindow = businessInformationProjectionOfferingEffectiveWindow({
              prices: offering.prices,
              ownerApproval,
            });
            manifestItems.push(
              await projectFact(
                tx,
                data,
                factsByKey.get(factKey),
                {
                  target,
                  factKey,
                  factId,
                  versionId: stableId(
                    "kv2_bio_version",
                    data.tenantId,
                    offering.id,
                    String(data.businessRevision),
                  ),
                  entityType: "BUSINESS_OFFERING",
                  fieldType: "OFFERING",
                  normalizedValue,
                  displayValue: offering.name,
                  localizedValues: {
                    [offering.locale]: {
                      name: offering.name,
                      description: offering.description,
                      bookingNotes: offering.bookingNotes,
                    },
                  },
                  unit: units.length === 1 ? (units[0] ?? null) : null,
                  currency: currencies.length === 1 ? (currencies[0] ?? null) : null,
                  timeZone: null,
                  locale: offering.locale,
                  scope: {
                    brandIds: [],
                    locationIds: [],
                    channelTypes: [],
                    assistantIds: [],
                    audiences: ["PUBLIC"],
                    segments: [],
                    locales: [offering.locale],
                  },
                  effectiveFrom: effectiveWindow.effectiveFrom,
                  effectiveUntil: effectiveWindow.effectiveUntil,
                  effectiveWindowPolicyId: effectiveWindow.policyId,
                  riskLevel,
                  authorities: offeringAuthorities,
                  ownerApproval,
                  lifecycleStatus: offering.active ? "DRAFT" : "ARCHIVED",
                  evidence,
                },
                projectedAt,
              ),
            );
          }
        }

        const settings = linkOnlyProjection
          ? currentSettings!
          : await tx.knowledgeV2Settings.upsert({
              where: { tenantId: data.tenantId },
              create: { tenantId: data.tenantId, draftGeneration: 2 },
              update: { draftGeneration: { increment: 1 }, etag: { increment: 1 } },
              select: { draftGeneration: true },
            });
        const knowledgeDraftGeneration = linkOnlyProjection
          ? priorProjectionReceipt!.knowledgeDraftGeneration
          : settings.draftGeneration;
        const manifestHash = linkOnlyProjection
          ? priorProjectionReceipt!.knowledgeDraftManifestHash
          : businessInformationProjectionHash({
              schema: MANIFEST_SCHEMA,
              targetKey: TARGET_KEY,
              tenantId: data.tenantId,
              businessRevisionId: data.businessRevisionId,
              businessRevision: data.businessRevision,
              businessRevisionHash: revision.canonicalHash,
              facts: manifestItems.sort((left, right) => left.factKey.localeCompare(right.factKey)),
            });
        const receiptIdentity = isImportProjection(data)
          ? data.applicationId
          : `${data.businessRevisionId}:${data.businessRevision}`;
        const receiptId = stableId("bio_projection_receipt", data.tenantId, receiptIdentity);
        const committedAt = dependencies.now();
        const receiptContext = isImportProjection(data)
          ? {
              sourceId: data.sourceId,
              importId: data.importId,
              applicationId: data.applicationId,
            }
          : { sourceId: null, importId: null, applicationId: null };
        const receiptHash = businessInformationProjectionHash({
          schema: PROJECTION_SCHEMA,
          receiptId,
          tenantId: data.tenantId,
          ...receiptContext,
          businessRevisionId: data.businessRevisionId,
          businessRevision: data.businessRevision,
          businessRevisionHash: revision.canonicalHash,
          knowledgeTargetKey: TARGET_KEY,
          knowledgeDraftGeneration,
          knowledgeDraftManifestHash: manifestHash,
          runtimeOutboxId: data.runtimeEventId,
          runtimeOutboxDedupeKey: expected.id,
        });
        await tx.businessInformationProjectionReceipt.create({
          data: {
            id: receiptId,
            tenantId: data.tenantId,
            ...receiptContext,
            businessRevisionId: data.businessRevisionId,
            businessRevision: data.businessRevision,
            businessRevisionHash: revision.canonicalHash,
            knowledgeTargetKey: TARGET_KEY,
            knowledgeDraftGeneration,
            knowledgeDraftManifestHash: manifestHash,
            runtimeOutboxId: data.runtimeEventId,
            runtimeOutboxDedupeKey: expected.id,
            receiptHash,
            projectedAt: committedAt,
            createdAt: committedAt,
          },
        });

        let importState: "APPLIED" | "PARTIALLY_APPLIED" | null = null;
        let unresolvedCandidates: number | null = null;
        if (isImportProjection(data)) {
          const applicationUpdated = await tx.businessImportApplication.updateMany({
            where: {
              id: data.applicationId,
              tenantId: data.tenantId,
              sourceId: data.sourceId,
              importId: data.importId,
              businessRevisionId: data.businessRevisionId,
              resultingInformationRevision: data.businessRevision,
              resultingInformationHash: revision.canonicalHash,
              projectionOutboxId: data.runtimeEventId,
              projectionOutboxDedupeKey: expected.id,
              projectionReceiptHash: null,
              state: { in: ["COMMITTED", "PROJECTING", "PROJECTION_DELAYED"] },
            },
            data: {
              state: "READY",
              projectionReceiptHash: receiptHash,
              projectedAt: committedAt,
            },
          });
          if (applicationUpdated.count !== 1) {
            fail("BUSINESS_INFORMATION_PROJECTION_APPLICATION_CHANGED", true, "FINALIZING");
          }
          unresolvedCandidates = await tx.businessImportCandidate.count({
            where: {
              tenantId: data.tenantId,
              sourceId: data.sourceId,
              importId: data.importId,
              decision: { notIn: ["APPLIED", "REJECTED", "STALE"] },
              action: { not: "UNCHANGED" },
            },
          });
          importState = unresolvedCandidates > 0 ? "PARTIALLY_APPLIED" : "APPLIED";
          const importUpdated = await tx.businessImport.updateMany({
            where: {
              id: data.importId,
              tenantId: data.tenantId,
              sourceId: data.sourceId,
              generation: data.generation,
              state: { in: ["PROJECTING", "PROJECTION_DELAYED"] },
            },
            data: {
              state: importState,
              failureCode: null,
              failureStage: null,
              retryable: false,
              appliedAt: committedAt,
              etag: { increment: 1 },
            },
          });
          if (importUpdated.count !== 1) {
            fail("BUSINESS_INFORMATION_PROJECTION_IMPORT_CHANGED", true, "FINALIZING");
          }
        }

        const stateUpdated = await tx.businessInformationState.updateMany({
          where: {
            tenantId: data.tenantId,
            currentRevisionId: data.businessRevisionId,
            revision: data.businessRevision,
            canonicalHash: revision.canonicalHash,
          },
          data: {
            lastProjectedRevisionId: data.businessRevisionId,
            lastProjectedRevision: data.businessRevision,
            lastProjectedHash: revision.canonicalHash,
            lastProjectionReceiptId: receiptId,
            lastProjectionReceiptHash: receiptHash,
          },
        });
        if (stateUpdated.count !== 1) {
          fail("BUSINESS_INFORMATION_PROJECTION_STATE_CHANGED", true, "FINALIZING");
        }
        await tx.auditLog.create({
          data: {
            tenantId: data.tenantId,
            actorUserId: data.requestedByUserId,
            action: "business_information.projection_ready",
            entityType: isImportProjection(data)
              ? "BusinessImportApplication"
              : "BusinessInformationRevision",
            entityId: isImportProjection(data) ? data.applicationId : data.businessRevisionId,
            payload: {
              ...(isImportProjection(data)
                ? {
                    applicationId: data.applicationId,
                    importId: data.importId,
                    unresolvedCandidateCount: unresolvedCandidates,
                    importState,
                  }
                : { revisionOrigin: "MANUAL" }),
              businessRevisionId: data.businessRevisionId,
              businessRevision: data.businessRevision,
              receiptId,
              receiptHash,
              runtimeEventId: data.runtimeEventId,
              knowledgeTargetKey: TARGET_KEY,
              knowledgeDraftGeneration,
              knowledgeDraftManifestHash: manifestHash,
              projectedFactCount: manifestItems.length,
            },
          },
        });
        return {
          status: "succeeded" as const,
          ...(isImportProjection(data) ? { applicationId: data.applicationId } : {}),
          businessRevisionId: data.businessRevisionId,
          receiptId,
          receiptHash,
          knowledgeDraftGeneration,
          knowledgeDraftManifestHash: manifestHash,
          projectedFactCount: manifestItems.length,
          ...(importState ? { importState } : {}),
        };
      },
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
    );
  } catch (error) {
    const safe = safeError(error);
    try {
      await markProjectionDelayed(dependencies, data, safe);
    } catch {
      // Runtime outbox retry remains authoritative.
    }
    throw safe;
  }
}
