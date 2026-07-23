import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@leadvirt/db";
import { parseRuntimeQueueEnvelope } from "@leadvirt/runtime-queue";
import {
  BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  businessInformationProjectionExactOwnerApproval,
  businessInformationProjectionGovernance,
  businessInformationProjectionHash,
  businessInformationProjectionImportedEvidence,
  businessInformationProjectionOfferingEffectiveWindow,
  businessInformationLinkProjectionCanReuse,
  createBusinessInformationProjectionDependencies,
  isBusinessInformationProjectionRuntimeData,
  processBusinessInformationProjectionJob,
} from "./business-information-projection-processor.js";

const exactLinkProjection = {
  candidateActions: ["LINK"],
  baseRevisionId: "revision-1",
  baseRevision: 1,
  baseInformationHash: "same",
  resultingInformationHash: "same",
  priorProjection: {
    revisionId: "revision-1",
    revision: 1,
    informationHash: "same",
    draftGeneration: 4,
    draftManifestHash: "manifest-1",
  },
  currentDraftGeneration: 4,
  currentDraftManifestHash: "manifest-1",
} as const;
assert.equal(businessInformationLinkProjectionCanReuse(exactLinkProjection), true);
assert.equal(
  businessInformationLinkProjectionCanReuse({ ...exactLinkProjection, priorProjection: null }),
  false,
);
assert.equal(
  businessInformationLinkProjectionCanReuse({ ...exactLinkProjection, currentDraftGeneration: 5 }),
  false,
);
assert.equal(
  businessInformationLinkProjectionCanReuse({
    ...exactLinkProjection,
    currentDraftManifestHash: "intervening-provenance",
  }),
  false,
);
assert.equal(
  businessInformationLinkProjectionCanReuse({
    ...exactLinkProjection,
    candidateActions: ["LINK", "ADD"],
  }),
  false,
);

function cuid(seed: string) {
  return `c${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function hash(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

const runId = randomUUID();
const tenantId = cuid(`tenant:${runId}`);
const userId = cuid(`user:${runId}`);
const runtimeEventId = cuid(`event:${runId}`);
const sourceId = randomUUID();
const importId = randomUUID();
const applicationId = randomUUID();
const revisionId = randomUUID();
const identityId = randomUUID();
const activeOfferingId = randomUUID();
const archivedOfferingId = randomUUID();
const priceId = randomUUID();
const durationId = randomUUID();
const publicationId = randomUUID();
const committedAt = new Date("2026-07-21T18:00:00.000Z");
const archivedAt = new Date("2026-07-20T18:00:00.000Z");
const baseHash = hash(`base:${runId}`);
const dedupeKey = `business-import-project:${applicationId}:1`;

const canonicalHash = businessInformationProjectionHash({
  schema: "leadvirt.business-information.v2",
  identity: {
    id: identityId,
    displayName: "Projection smoke business",
    legalName: null,
    businessType: "Services",
    description: "Projection fixture",
    defaultLocale: "en",
    timezone: "UTC",
    defaultCurrency: "EUR",
  },
  offerings: [
    {
      id: activeOfferingId,
      kind: "SERVICE",
      category: "Consulting",
      parentCategory: null,
      name: "Consultation",
      description: "Structured service",
      locale: "en",
      bookingNotes: null,
      active: true,
      archivedAt: null,
      prices: [
        {
          id: priceId,
          type: "FIXED",
          amount: "125",
          amountFrom: null,
          amountTo: null,
          currency: "EUR",
          unit: "session",
          taxNote: null,
          effectiveFrom: "2026-07-01",
          effectiveUntil: null,
        },
      ],
      duration: {
        id: durationId,
        minimumMinutes: 45,
        maximumMinutes: 60,
        preparationMinutes: 5,
        bufferMinutes: 10,
      },
    },
    {
      id: archivedOfferingId,
      kind: "SERVICE",
      category: null,
      parentCategory: null,
      name: "Archived service",
      description: null,
      locale: "en",
      bookingNotes: null,
      active: false,
      archivedAt: archivedAt.toISOString(),
      prices: [],
      duration: null,
    },
  ].sort((left, right) => left.id.localeCompare(right.id)),
});

const projectData = {
  tenantId,
  sourceId,
  importId,
  applicationId,
  businessRevisionId: revisionId,
  businessRevision: 1,
  generation: 1,
  requestedByUserId: userId,
  requestedAt: committedAt.toISOString(),
  runtimeEventId,
  runtimeGeneration: 1,
} satisfies Record<string, unknown>;

assert.equal(isBusinessInformationProjectionRuntimeData(projectData), true);
assert.equal(
  isBusinessInformationProjectionRuntimeData({ ...projectData, forbiddenContent: "raw row" }),
  false,
);
assert.equal(
  isBusinessInformationProjectionRuntimeData({ ...projectData, runtimeGeneration: 2 }),
  false,
);

const storedEnvelope = {
  queueName: "business.import",
  jobName: "project",
  jobId: dedupeKey,
  data: {
    tenantId,
    sourceId,
    importId,
    applicationId,
    businessRevisionId: revisionId,
    businessRevision: 1,
    generation: 1,
    requestedByUserId: userId,
    requestedAt: committedAt.toISOString(),
  },
  attempts: 10,
  backoffMs: 2_000,
} as const;
assert.equal(parseRuntimeQueueEnvelope(storedEnvelope).jobName, "project");
assert.throws(() =>
  parseRuntimeQueueEnvelope({
    ...storedEnvelope,
    data: { ...storedEnvelope.data, normalizedValue: { name: "forbidden" } },
  }),
);

const importedEvidence = businessInformationProjectionImportedEvidence(
  {
    id: randomUUID(),
    fieldPath: "prices.amount",
    confidence: "HIGH",
    sourceId,
    importId,
    candidateId: randomUUID(),
    candidateVersion: 2,
    candidateValueHash: hash("candidate"),
    evidenceId: randomUUID(),
    artifactId: randomUUID(),
    artifactSha256: hash("artifact"),
    importGeneration: 1,
    parsedRevisionId: randomUUID(),
    parsedManifestHash: hash("manifest"),
    applicationId,
    businessRevisionId: revisionId,
    businessRevision: 1,
    businessRevisionHash: canonicalHash,
    parserVersion: "csv-v1",
    ocrVersion: null,
    mapperVersion: "mapper-v1",
    schemaVersion: "schema-v1",
    modelVersion: null,
    promptVersion: null,
    evidence: {
      id: randomUUID(),
      excerptHash: hash("excerpt"),
      excerptObjectLedgerId: randomUUID(),
      sourceValueHash: hash("source"),
      semanticElementId: randomUUID(),
      semanticTableId: randomUUID(),
      extractionContractVersion: "extraction-v1",
    },
  },
  activeOfferingId,
);
assert(importedEvidence);
assert.equal(importedEvidence.kind, "EXTERNAL_REFERENCE");
assert.equal(importedEvidence.sourceReference.offeringId, activeOfferingId);
assert.equal(JSON.stringify(importedEvidence).includes("raw row"), false);

const governanceProjectedAt = new Date("2026-07-21T17:00:00.000Z");
const governanceApprovedAt = new Date("2026-07-21T16:59:00.000Z");
const exactApprovalGrant = {
  id: randomUUID(),
  grantedByUserId: userId,
  grantedAt: governanceApprovedAt,
  membershipRole: "OWNER",
  approvalState: "APPROVED",
  approvalInvalidatedAt: null,
  approvalDecidedByUserId: userId,
  approvalDecidedAt: governanceApprovedAt,
};
assert.deepEqual(
  businessInformationProjectionExactOwnerApproval({
    requiresApproval: true,
    approvalGrantId: exactApprovalGrant.id,
    grant: exactApprovalGrant,
  }),
  { userId, approvedAt: governanceApprovedAt },
);
assert.equal(
  businessInformationProjectionExactOwnerApproval({
    requiresApproval: true,
    approvalGrantId: exactApprovalGrant.id,
    grant: { ...exactApprovalGrant, membershipRole: "AGENT" },
  }),
  null,
);
assert.equal(
  businessInformationProjectionExactOwnerApproval({
    requiresApproval: true,
    approvalGrantId: exactApprovalGrant.id,
    grant: {
      ...exactApprovalGrant,
      approvalDecidedAt: new Date(governanceApprovedAt.getTime() - 1),
    },
  }),
  null,
);
assert.deepEqual(
  businessInformationProjectionGovernance({
    riskLevel: "LOW",
    authorities: new Set(["IMPORTED", "SYSTEM"]),
    requestedByUserId: userId,
    projectedAt: governanceProjectedAt,
    ownerApproval: null,
  }),
  {
    authority: "MANUAL",
    verificationStatus: "VERIFIED",
    verifiedByUserId: userId,
    verifiedAt: governanceProjectedAt,
  },
);
assert.deepEqual(
  businessInformationProjectionGovernance({
    riskLevel: "HIGH",
    authorities: new Set(["IMPORTED"]),
    requestedByUserId: userId,
    projectedAt: governanceProjectedAt,
    ownerApproval: null,
  }),
  {
    authority: "IMPORTED",
    verificationStatus: "PENDING_REVIEW",
    verifiedByUserId: null,
    verifiedAt: null,
  },
);
assert.deepEqual(
  businessInformationProjectionGovernance({
    riskLevel: "HIGH",
    authorities: new Set(["IMPORTED"]),
    requestedByUserId: userId,
    projectedAt: governanceProjectedAt,
    ownerApproval: { userId, approvedAt: governanceApprovedAt },
  }),
  {
    authority: "OWNER_VERIFIED",
    verificationStatus: "VERIFIED",
    verifiedByUserId: userId,
    verifiedAt: governanceApprovedAt,
  },
);
const ownerApprovalFreshUntil = new Date(governanceApprovedAt.getTime() + 90 * 24 * 60 * 60_000);
assert.deepEqual(
  businessInformationProjectionOfferingEffectiveWindow({
    prices: [{ effectiveFrom: null, effectiveUntil: null }],
    ownerApproval: { approvedAt: governanceApprovedAt },
  }),
  {
    effectiveFrom: null,
    effectiveUntil: ownerApprovalFreshUntil,
    policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  },
);
assert.deepEqual(
  businessInformationProjectionOfferingEffectiveWindow({
    prices: [
      {
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveUntil: new Date("2026-08-15T00:00:00.000Z"),
      },
      {
        effectiveFrom: new Date("2026-07-15T00:00:00.000Z"),
        effectiveUntil: null,
      },
    ],
    ownerApproval: { approvedAt: governanceApprovedAt },
  }),
  {
    effectiveFrom: new Date("2026-07-15T00:00:00.000Z"),
    effectiveUntil: new Date("2026-08-15T00:00:00.000Z"),
    policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  },
);
assert.deepEqual(
  businessInformationProjectionOfferingEffectiveWindow({
    prices: [
      {
        effectiveFrom: null,
        effectiveUntil: new Date("2026-12-01T00:00:00.000Z"),
      },
      { effectiveFrom: null, effectiveUntil: null },
    ],
    ownerApproval: { approvedAt: governanceApprovedAt },
  }),
  {
    effectiveFrom: null,
    effectiveUntil: ownerApprovalFreshUntil,
    policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  },
);
assert.deepEqual(
  businessInformationProjectionOfferingEffectiveWindow({
    prices: [{ effectiveFrom: null, effectiveUntil: null }],
    ownerApproval: null,
  }),
  {
    effectiveFrom: null,
    effectiveUntil: null,
    policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  },
);
assert.deepEqual(
  businessInformationProjectionOfferingEffectiveWindow({
    prices: [
      {
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveUntil: new Date("2026-10-01T00:00:00.000Z"),
      },
      {
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        effectiveUntil: new Date("2026-09-01T00:00:00.000Z"),
      },
    ],
    ownerApproval: null,
  }),
  {
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: new Date("2026-09-01T00:00:00.000Z"),
    policyId: BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  },
);
assert.deepEqual(
  businessInformationProjectionOfferingEffectiveWindow({
    prices: [],
    ownerApproval: null,
  }),
  { effectiveFrom: null, effectiveUntil: null, policyId: null },
);

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.tenant.deleteMany({ where: { id: tenantId } });
    await tx.user.deleteMany({ where: { id: userId } });
  });
}

async function createImportApplication(input: {
  sourceId: string;
  importId: string;
  applicationId: string;
  revisionId: string;
  revision: number;
  parentRevisionId: string | null;
  parentRevision: number | null;
  baseRevisionId: string | null;
  baseRevision: number;
  baseHash: string;
  resultHash: string;
  runtimeEventId: string;
  committedAt: Date;
}) {
  const deltaLedgerId = randomUUID();
  const previewLedgerId = randomUUID();
  const projectionDedupe = `business-import-project:${input.applicationId}:${input.revision}`;
  await prisma.businessImportObjectLedger.createMany({
    data: [
      {
        id: deltaLedgerId,
        tenantId,
        objectKind: "REVISION_DELTA",
        objectStorageKey: `smoke/${runId}/revision/${input.revision}`,
        encryptionKeyRef: "smoke-key",
        retentionClass: "SMOKE",
      },
      {
        id: previewLedgerId,
        tenantId,
        objectKind: "APPLICATION_PREVIEW",
        objectStorageKey: `smoke/${runId}/preview/${input.revision}`,
        encryptionKeyRef: "smoke-key",
        retentionClass: "SMOKE",
      },
    ],
  });
  await prisma.businessInformationRevision.create({
    data: {
      id: input.revisionId,
      tenantId,
      revision: input.revision,
      parentRevisionId: input.parentRevisionId,
      parentRevision: input.parentRevision,
      canonicalHash: input.resultHash,
      origin: "IMPORT",
      deltaObjectKey: `smoke/${runId}/revision/${input.revision}`,
      deltaEncryptionKeyRef: "smoke-key",
      deltaObjectLedgerId: deltaLedgerId,
      deltaHash: hash(`delta:${input.revision}`),
      affectedResources: [],
      createdByUserId: userId,
    },
  });
  await prisma.businessImport.create({
    data: {
      id: input.importId,
      tenantId,
      sourceId: input.sourceId,
      purpose: "SERVICES",
      format: "CSV",
      state: "PROJECTING",
      generation: 1,
      displayName: `Projection smoke ${input.revision}`,
      originalFilename: "projection-smoke.csv",
      declaredMimeType: "text/csv",
      expectedByteSize: 1,
      uploadTokenHash: hash(`upload:${input.revision}:${runId}`),
      baseBusinessRevisionId: input.baseRevisionId,
      baseInformationRevision: input.baseRevision,
      baseInformationHash: input.baseHash,
      selectedCategories: ["OFFERINGS"],
      schemaVersion: "business-import-v1",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      applyStartedAt: input.committedAt,
      createdByUserId: userId,
    },
  });
  await prisma.runtimeOutbox.create({
    data: {
      id: input.runtimeEventId,
      tenantId,
      aggregateType: "BusinessInformationRevision",
      aggregateId: input.revisionId,
      aggregateVersion: input.revision,
      generation: 1,
      eventType: "business.import.project.requested",
      schemaVersion: 1,
      dedupeKey: projectionDedupe,
      payload: {
        queueName: "business.import",
        jobName: "project",
        jobId: projectionDedupe,
        data: {
          tenantId,
          sourceId: input.sourceId,
          importId: input.importId,
          applicationId: input.applicationId,
          businessRevisionId: input.revisionId,
          businessRevision: input.revision,
          generation: 1,
          requestedByUserId: userId,
          requestedAt: input.committedAt.toISOString(),
        },
        attempts: 10,
        backoffMs: 2_000,
      },
      status: "PUBLISHED",
      publishedAt: input.committedAt,
    },
  });
  await prisma.businessImportApplication.create({
    data: {
      id: input.applicationId,
      tenantId,
      sourceId: input.sourceId,
      importId: input.importId,
      kind: "APPLY",
      state: "COMMITTED",
      previewManifestHash: hash(`preview:${input.revision}`),
      previewObjectLedgerId: previewLedgerId,
      previewObjectKind: "APPLICATION_PREVIEW",
      previewObjectKey: `smoke/${runId}/preview/${input.revision}`,
      previewEncryptionKeyRef: "smoke-key",
      candidateManifestHash: hash(`candidates:${input.revision}`),
      idempotencyKeyHash: hash(`idempotency:${input.revision}:${runId}`),
      idempotencyRequestHash: hash(`idempotency-request:${input.revision}:${runId}`),
      baseInformationRevision: input.baseRevision,
      baseInformationHash: input.baseHash,
      baseBusinessRevisionId: input.baseRevisionId,
      resultingInformationRevision: input.revision,
      resultingInformationHash: input.resultHash,
      businessRevisionId: input.revisionId,
      affectedResourceVersions: [],
      projectionOutboxDedupeKey: projectionDedupe,
      projectionOutboxId: input.runtimeEventId,
      createdByUserId: userId,
      committedAt: input.committedAt,
    },
  });
}

async function attachAppliedLinkCandidate(input: {
  sourceId: string;
  importId: string;
  applicationId: string;
  offeringId: string;
}) {
  const candidateId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRaw`
      INSERT INTO "BusinessImportCandidate" (
        "id", "tenantId", "sourceId", "importId", "candidateKey", "targetCategory",
        "semanticTargetKey", "action", "normalizedValue", "normalizedValueHash",
        "targetOfferingId", "currentFingerprint", "risk", "confidence", "decision",
        "requiresApproval", "requiredPermission", "version", "etag", "appliedAt",
        "createdAt", "updatedAt"
      ) VALUES (
        ${candidateId}, ${tenantId}, ${input.sourceId}, ${input.importId}, ${hash(candidateId)},
        'OFFERINGS'::"BusinessImportTargetCategory", ${`offering:${input.offeringId}`},
        'LINK'::"BusinessImportCandidateAction", ${JSON.stringify({ name: "Linked service" })}::jsonb,
        ${hash(`value:${candidateId}`)}, ${input.offeringId}, ${hash(`current:${candidateId}`)},
        'LOW'::"BusinessImportRiskLevel", 'HIGH'::"BusinessImportConfidenceBand",
        'APPLIED'::"BusinessImportCandidateDecision", FALSE, '', 1, 1, NOW(), NOW(), NOW()
      )
    `;
    await tx.$executeRaw`
      INSERT INTO "BusinessImportApplicationCandidate" (
        "tenantId", "sourceId", "importId", "applicationId", "candidateId",
        "candidateVersion", "candidateValueHash", "action", "targetCategory", "risk",
        "requiresApproval", "requiredPermission", "appliedAt"
      ) VALUES (
        ${tenantId}, ${input.sourceId}, ${input.importId}, ${input.applicationId}, ${candidateId},
        1, ${hash(`value:${candidateId}`)}, 'LINK'::"BusinessImportCandidateAction",
        'OFFERINGS'::"BusinessImportTargetCategory", 'LOW'::"BusinessImportRiskLevel",
        FALSE, '', NOW()
      )
    `;
  });
}

async function currentCanonicalHash() {
  const identity = await prisma.businessIdentity.findUniqueOrThrow({ where: { tenantId } });
  const offerings = await prisma.businessOffering.findMany({
    where: { tenantId },
    include: { prices: true, duration: true },
    orderBy: { id: "asc" },
  });
  return businessInformationProjectionHash({
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
          effectiveFrom: price.effectiveFrom?.toISOString().slice(0, 10) ?? null,
          effectiveUntil: price.effectiveUntil?.toISOString().slice(0, 10) ?? null,
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
}

async function createManualRevision(input: {
  revisionId: string;
  revision: number;
  parentRevisionId: string;
  parentRevision: number;
  canonicalHash: string;
  runtimeEventId: string;
  createdAt: Date;
}) {
  const ledgerId = randomUUID();
  const dedupeKey = `business-information-project:${input.revisionId}:${input.revision}`;
  await prisma.businessImportObjectLedger.create({
    data: {
      id: ledgerId,
      tenantId,
      objectKind: "REVISION_DELTA",
      objectStorageKey: `smoke/${runId}/manual-revision/${input.revision}`,
      encryptionKeyRef: "smoke-key",
      retentionClass: "BUSINESS_INFORMATION_REVISION",
    },
  });
  await prisma.businessInformationRevision.create({
    data: {
      id: input.revisionId,
      tenantId,
      revision: input.revision,
      parentRevisionId: input.parentRevisionId,
      parentRevision: input.parentRevision,
      canonicalHash: input.canonicalHash,
      origin: "MANUAL",
      deltaObjectKey: `smoke/${runId}/manual-revision/${input.revision}`,
      deltaEncryptionKeyRef: "smoke-key",
      deltaObjectLedgerId: ledgerId,
      deltaHash: hash(`manual-delta:${input.revision}:${runId}`),
      affectedResources: [],
      createdByUserId: userId,
      createdAt: input.createdAt,
    },
  });
  await prisma.runtimeOutbox.create({
    data: {
      id: input.runtimeEventId,
      tenantId,
      aggregateType: "BusinessInformationRevision",
      aggregateId: input.revisionId,
      aggregateVersion: input.revision,
      generation: input.revision,
      eventType: "business.information.project.requested",
      schemaVersion: 1,
      dedupeKey,
      payload: {
        queueName: "business.import",
        jobName: "project-revision",
        jobId: dedupeKey,
        data: {
          tenantId,
          businessRevisionId: input.revisionId,
          businessRevision: input.revision,
          generation: input.revision,
          requestedByUserId: userId,
          requestedAt: input.createdAt.toISOString(),
        },
        attempts: 10,
        backoffMs: 2_000,
      },
      status: "PUBLISHED",
      publishedAt: input.createdAt,
    },
  });
  await prisma.businessInformationState.update({
    where: { tenantId },
    data: {
      revision: input.revision,
      currentRevisionId: input.revisionId,
      canonicalHash: input.canonicalHash,
      etag: { increment: 1 },
      updatedByUserId: userId,
    },
  });
  return {
    dedupeKey,
    data: {
      tenantId,
      businessRevisionId: input.revisionId,
      businessRevision: input.revision,
      generation: input.revision,
      requestedByUserId: userId,
      requestedAt: input.createdAt.toISOString(),
      runtimeEventId: input.runtimeEventId,
      runtimeGeneration: input.revision,
    },
  };
}

await cleanup();
try {
  await prisma.user.create({ data: { id: userId, email: `${runId}@projection-smoke.invalid` } });
  await prisma.tenant.create({
    data: { id: tenantId, name: "Projection smoke", slug: `projection-smoke-${runId}` },
  });
  await prisma.membership.create({
    data: { tenantId, userId, role: "OWNER" },
  });
  const publicationManifestHash = hash(`active-publication:${runId}`);
  await prisma.knowledgePublication.create({
    data: {
      id: publicationId,
      tenantId,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      sequence: 7,
      status: "ACTIVE",
      manifestHash: publicationManifestHash,
      pipelineVersion: "knowledge-v2",
      retrievalPolicyVersion: "smoke-retrieval-v1",
      promptPolicyVersion: "smoke-prompt-v1",
      readyAt: committedAt,
      activatedAt: committedAt,
    },
  });
  await prisma.activeKnowledgePublication.create({
    data: {
      tenantId,
      targetKey: "workspace-v2",
      publicationId,
      sequence: 7,
      etag: 4,
      updatedByUserId: userId,
    },
  });
  await prisma.businessImportSource.create({
    data: {
      id: sourceId,
      tenantId,
      lineageKey: `projection-smoke:${runId}`,
      displayName: "Projection smoke source",
      createdByUserId: userId,
    },
  });
  await prisma.businessIdentity.create({
    data: {
      id: identityId,
      tenantId,
      displayName: "Projection smoke business",
      businessType: "Services",
      description: "Projection fixture",
      defaultLocale: "en",
      timezone: "UTC",
      defaultCurrency: "EUR",
    },
  });
  await prisma.businessOffering.create({
    data: {
      id: activeOfferingId,
      tenantId,
      kind: "SERVICE",
      category: "Consulting",
      name: "Consultation",
      description: "Structured service",
      locale: "en",
      active: true,
      prices: {
        create: {
          id: priceId,
          type: "FIXED",
          amount: "125",
          currency: "EUR",
          unit: "session",
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        },
      },
      duration: {
        create: {
          id: durationId,
          minimumMinutes: 45,
          maximumMinutes: 60,
          preparationMinutes: 5,
          bufferMinutes: 10,
        },
      },
    },
  });
  await prisma.businessOffering.create({
    data: {
      id: archivedOfferingId,
      tenantId,
      kind: "SERVICE",
      name: "Archived service",
      locale: "en",
      active: false,
      archivedAt,
    },
  });
  await createImportApplication({
    sourceId,
    importId,
    applicationId,
    revisionId,
    revision: 1,
    parentRevisionId: null,
    parentRevision: null,
    baseRevisionId: null,
    baseRevision: 0,
    baseHash,
    resultHash: canonicalHash,
    runtimeEventId,
    committedAt,
  });
  await prisma.businessInformationState.create({
    data: {
      tenantId,
      revision: 1,
      currentRevisionId: revisionId,
      canonicalHash,
      updatedByUserId: userId,
    },
  });

  const dependencies = createBusinessInformationProjectionDependencies(prisma);
  const result = await processBusinessInformationProjectionJob(
    {
      id: dedupeKey,
      name: "project",
      data: projectData,
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(result.status, "succeeded");
  assert.equal(result.projectedFactCount, 3);
  assert.equal(result.importState, "APPLIED");

  const [application, importRecord, state, facts, settings, activePointers] = await Promise.all([
    prisma.businessImportApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: { projectionReceipt: true },
    }),
    prisma.businessImport.findUniqueOrThrow({ where: { id: importId } }),
    prisma.businessInformationState.findUniqueOrThrow({ where: { tenantId } }),
    prisma.knowledgeV2Fact.findMany({
      where: { tenantId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { evidence: true },
        },
      },
      orderBy: { factKey: "asc" },
    }),
    prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId } }),
    prisma.activeKnowledgePublication.findUniqueOrThrow({
      where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
      include: { publication: true },
    }),
  ]);
  assert.equal(application.state, "READY");
  assert(application.projectionReceipt);
  assert.equal(application.projectionReceiptHash, application.projectionReceipt.receiptHash);
  assert.equal(application.projectionReceipt.runtimeOutboxId, runtimeEventId);
  assert.equal(importRecord.state, "APPLIED");
  assert.equal(state.lastProjectionReceiptId, application.projectionReceipt.id);
  assert.equal(state.lastProjectedRevisionId, revisionId);
  assert.equal(facts.length, 3);
  assert.equal(activePointers.publicationId, publicationId);
  assert.equal(activePointers.sequence, 7);
  assert.equal(activePointers.etag, 4);
  assert.equal(activePointers.publication.manifestHash, publicationManifestHash);
  const activeFact = facts.find((fact) => fact.factKey.endsWith(activeOfferingId));
  const archivedFact = facts.find((fact) => fact.factKey.endsWith(archivedOfferingId));
  const identityFact = facts.find((fact) => fact.factKey.endsWith(identityId));
  assert(activeFact?.versions[0]);
  assert(archivedFact?.versions[0]);
  assert(identityFact?.versions[0]);
  assert.equal(identityFact.versions[0].displayValue, "Projection smoke business");
  assert.equal(activeFact.versions[0].lifecycleStatus, "DRAFT");
  assert.equal(activeFact.versions[0].riskLevel, "HIGH");
  assert.equal(activeFact.versions[0].authority, "MANUAL");
  assert.equal(activeFact.versions[0].verificationStatus, "PENDING_REVIEW");
  assert.equal(activeFact.versions[0].verifiedByUserId, null);
  assert.equal(activeFact.versions[0].verifiedAt, null);
  assert.equal(activeFact.versions[0].effectiveFrom?.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(activeFact.versions[0].effectiveUntil, null);
  assert.equal(identityFact.versions[0].verificationStatus, "VERIFIED");
  assert.equal(archivedFact.versions[0].lifecycleStatus, "ARCHIVED");
  assert.match(activeFact.versions[0].immutableHash, /^[a-f0-9]{64}$/u);
  assert.equal(activeFact.versions[0].evidence.length, 1);
  const activeEvidenceMetadata = activeFact.versions[0].evidence[0]?.metadata as Record<
    string,
    unknown
  >;
  assert.equal(
    activeEvidenceMetadata.effectiveWindowPolicyId,
    BUSINESS_INFORMATION_PRICE_EFFECTIVE_WINDOW_POLICY_ID,
  );
  const normalized = activeFact.versions[0].normalizedValue as Record<string, unknown>;
  const prices = normalized.prices as Array<Record<string, unknown>>;
  const duration = normalized.duration as Record<string, unknown>;
  assert.equal(prices[0]?.amount, "125");
  assert.equal(prices[0]?.currency, "EUR");
  assert.equal(duration.minimumMinutes, 45);

  const versionCountsBeforeReplay = await Promise.all(
    facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
  );
  const replay = await processBusinessInformationProjectionJob(
    {
      id: dedupeKey,
      name: "project",
      data: projectData,
      signal: new AbortController().signal,
    },
    dependencies,
  );
  const versionCountsAfterReplay = await Promise.all(
    facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
  );
  const settingsAfterReplay = await prisma.knowledgeV2Settings.findUniqueOrThrow({
    where: { tenantId },
  });
  assert.equal(replay.status, "already_succeeded");
  assert.deepEqual(versionCountsAfterReplay, versionCountsBeforeReplay);
  assert.equal(settingsAfterReplay.draftGeneration, settings.draftGeneration);

  const overtakenImportId = randomUUID();
  const overtakenApplicationId = randomUUID();
  const overtakenRevisionId = randomUUID();
  const overtakenRuntimeEventId = cuid(`overtaken-event:${runId}`);
  const overtakenCommittedAt = new Date("2026-07-21T18:01:00.000Z");
  await createImportApplication({
    sourceId,
    importId: overtakenImportId,
    applicationId: overtakenApplicationId,
    revisionId: overtakenRevisionId,
    revision: 2,
    parentRevisionId: revisionId,
    parentRevision: 1,
    baseRevisionId: revisionId,
    baseRevision: 1,
    baseHash: canonicalHash,
    resultHash: canonicalHash,
    runtimeEventId: overtakenRuntimeEventId,
    committedAt: overtakenCommittedAt,
  });
  await prisma.businessInformationState.update({
    where: { tenantId },
    data: {
      revision: 2,
      currentRevisionId: overtakenRevisionId,
      canonicalHash,
      etag: { increment: 1 },
    },
  });
  const overtakenData = {
    tenantId,
    sourceId,
    importId: overtakenImportId,
    applicationId: overtakenApplicationId,
    businessRevisionId: overtakenRevisionId,
    businessRevision: 2,
    generation: 1,
    requestedByUserId: userId,
    requestedAt: overtakenCommittedAt.toISOString(),
    runtimeEventId: overtakenRuntimeEventId,
    runtimeGeneration: 1,
  };

  await prisma.businessIdentity.update({
    where: { tenantId },
    data: { displayName: "Projection smoke business updated", rowVersion: { increment: 1 } },
  });
  const manualIdentityHash = await currentCanonicalHash();
  const manualIdentityRevisionId = randomUUID();
  const manualIdentityRuntimeEventId = cuid(`manual-identity-event:${runId}`);
  const manualIdentityCreatedAt = new Date("2026-07-21T18:02:00.000Z");
  const manualIdentityProjection = await createManualRevision({
    revisionId: manualIdentityRevisionId,
    revision: 3,
    parentRevisionId: overtakenRevisionId,
    parentRevision: 2,
    canonicalHash: manualIdentityHash,
    runtimeEventId: manualIdentityRuntimeEventId,
    createdAt: manualIdentityCreatedAt,
  });
  await prisma.businessInformationAttribution.create({
    data: {
      tenantId,
      resourceType: "BUSINESS_IDENTITY",
      resourceKey: identityId,
      identityId,
      fieldPath: "/displayName",
      currentValueHash: hash("Projection smoke business updated"),
      authority: "MANUAL",
      businessRevisionId: manualIdentityRevisionId,
      businessRevision: 3,
      businessRevisionHash: manualIdentityHash,
    },
  });

  const overtaken = await processBusinessInformationProjectionJob(
    {
      id: `business-import-project:${overtakenApplicationId}:2`,
      name: "project",
      data: overtakenData,
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(overtaken.status, "superseded");
  const [overtakenApplication, overtakenImport, overtakenReceipt, stateBeforeManualProjection] =
    await Promise.all([
      prisma.businessImportApplication.findUniqueOrThrow({
        where: { id: overtakenApplicationId },
      }),
      prisma.businessImport.findUniqueOrThrow({ where: { id: overtakenImportId } }),
      prisma.businessInformationProjectionReceipt.findUnique({
        where: { applicationId: overtakenApplicationId },
      }),
      prisma.businessInformationState.findUniqueOrThrow({ where: { tenantId } }),
    ]);
  assert.equal(overtakenApplication.state, "SUPERSEDED");
  assert(overtakenApplication.supersededAt);
  assert.equal(overtakenApplication.projectionReceiptHash, null);
  assert.equal(overtakenImport.state, "CLOSED_WITH_REMAINDER");
  assert.equal(overtakenReceipt, null);
  assert.equal(stateBeforeManualProjection.currentRevisionId, manualIdentityRevisionId);
  assert.equal(stateBeforeManualProjection.lastProjectionReceiptId, state.lastProjectionReceiptId);

  const manualIdentityResult = await processBusinessInformationProjectionJob(
    {
      id: manualIdentityProjection.dedupeKey,
      name: "project-revision",
      data: manualIdentityProjection.data,
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(manualIdentityResult.status, "succeeded");
  assert.equal(manualIdentityResult.projectedFactCount, 3);
  const manualIdentityReceipt = await prisma.businessInformationProjectionReceipt.findUniqueOrThrow(
    {
      where: {
        tenantId_runtimeOutboxDedupeKey: {
          tenantId,
          runtimeOutboxDedupeKey: manualIdentityProjection.dedupeKey,
        },
      },
    },
  );
  assert.equal(manualIdentityReceipt.sourceId, null);
  assert.equal(manualIdentityReceipt.importId, null);
  assert.equal(manualIdentityReceipt.applicationId, null);
  const identityAfterManual = await prisma.knowledgeV2Fact.findUniqueOrThrow({
    where: {
      tenantId_factKey: { tenantId, factKey: `business-information:identity:${identityId}` },
    },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: { evidence: true },
      },
    },
  });
  assert.equal(identityAfterManual.versions[0]?.displayValue, "Projection smoke business updated");
  assert(
    identityAfterManual.versions[0]?.evidence.some((item) => {
      const reference = item.sourceReference as Record<string, unknown>;
      return reference.provenance === "MANUAL_ATTRIBUTION";
    }),
  );
  assert.equal(
    JSON.stringify(identityAfterManual.versions[0]?.evidence).includes("business updated"),
    false,
  );
  const countsAfterIdentityProjection = await Promise.all(
    facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
  );
  const manualIdentityReplay = await processBusinessInformationProjectionJob(
    {
      id: manualIdentityProjection.dedupeKey,
      name: "project-revision",
      data: manualIdentityProjection.data,
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(manualIdentityReplay.status, "already_succeeded");
  assert.deepEqual(
    await Promise.all(
      facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
    ),
    countsAfterIdentityProjection,
  );

  await prisma.businessOffering.update({
    where: { id: activeOfferingId },
    data: { name: "Consultation updated", rowVersion: { increment: 1 } },
  });
  const manualOfferingHash = await currentCanonicalHash();
  const manualOfferingRevisionId = randomUUID();
  const manualOfferingProjection = await createManualRevision({
    revisionId: manualOfferingRevisionId,
    revision: 4,
    parentRevisionId: manualIdentityRevisionId,
    parentRevision: 3,
    canonicalHash: manualOfferingHash,
    runtimeEventId: cuid(`manual-offering-event:${runId}`),
    createdAt: new Date("2026-07-21T18:03:00.000Z"),
  });
  await prisma.businessInformationAttribution.create({
    data: {
      tenantId,
      resourceType: "OFFERING",
      resourceKey: activeOfferingId,
      offeringId: activeOfferingId,
      fieldPath: "/name",
      currentValueHash: hash("Consultation updated"),
      authority: "MANUAL",
      businessRevisionId: manualOfferingRevisionId,
      businessRevision: 4,
      businessRevisionHash: manualOfferingHash,
    },
  });
  const manualOfferingResult = await processBusinessInformationProjectionJob(
    {
      id: manualOfferingProjection.dedupeKey,
      name: "project-revision",
      data: manualOfferingProjection.data,
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(manualOfferingResult.status, "succeeded");
  const [offeringAfterManual, finalState, finalCounts] = await Promise.all([
    prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId,
          factKey: `business-information:offering:${activeOfferingId}`,
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    }),
    prisma.businessInformationState.findUniqueOrThrow({ where: { tenantId } }),
    Promise.all(
      facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
    ),
  ]);
  assert.equal(offeringAfterManual.versions[0]?.displayValue, "Consultation updated");
  assert.equal(offeringAfterManual.versions[0]?.riskLevel, "HIGH");
  assert.equal(offeringAfterManual.versions[0]?.authority, "MANUAL");
  assert.equal(offeringAfterManual.versions[0]?.verificationStatus, "PENDING_REVIEW");
  assert.equal(finalState.currentRevisionId, manualOfferingRevisionId);
  assert.equal(finalState.lastProjectedRevisionId, manualOfferingRevisionId);
  assert.equal(finalState.lastProjectionReceiptId, manualOfferingResult.receiptId);
  assert(finalCounts.every((count) => count === 3));

  const linkImportId = randomUUID();
  const linkApplicationId = randomUUID();
  const linkRevisionId = randomUUID();
  const linkRuntimeEventId = cuid(`link-event:${runId}`);
  const linkCommittedAt = new Date("2026-07-21T18:04:00.000Z");
  await createImportApplication({
    sourceId,
    importId: linkImportId,
    applicationId: linkApplicationId,
    revisionId: linkRevisionId,
    revision: 5,
    parentRevisionId: manualOfferingRevisionId,
    parentRevision: 4,
    baseRevisionId: manualOfferingRevisionId,
    baseRevision: 4,
    baseHash: manualOfferingHash,
    resultHash: manualOfferingHash,
    runtimeEventId: linkRuntimeEventId,
    committedAt: linkCommittedAt,
  });
  await attachAppliedLinkCandidate({
    sourceId,
    importId: linkImportId,
    applicationId: linkApplicationId,
    offeringId: activeOfferingId,
  });
  await prisma.businessInformationState.update({
    where: { tenantId },
    data: {
      revision: 5,
      currentRevisionId: linkRevisionId,
      canonicalHash: manualOfferingHash,
      etag: { increment: 1 },
    },
  });
  const linkResult = await processBusinessInformationProjectionJob(
    {
      id: `business-import-project:${linkApplicationId}:5`,
      name: "project",
      data: {
        tenantId,
        sourceId,
        importId: linkImportId,
        applicationId: linkApplicationId,
        businessRevisionId: linkRevisionId,
        businessRevision: 5,
        generation: 1,
        requestedByUserId: userId,
        requestedAt: linkCommittedAt.toISOString(),
        runtimeEventId: linkRuntimeEventId,
        runtimeGeneration: 1,
      },
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(linkResult.status, "succeeded");
  assert.equal(linkResult.knowledgeDraftGeneration, manualOfferingResult.knowledgeDraftGeneration);
  assert.equal(
    linkResult.knowledgeDraftManifestHash,
    manualOfferingResult.knowledgeDraftManifestHash,
  );
  assert.deepEqual(
    await Promise.all(
      facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
    ),
    finalCounts,
  );

  const intervenedImportId = randomUUID();
  const intervenedApplicationId = randomUUID();
  const intervenedRevisionId = randomUUID();
  const intervenedRuntimeEventId = cuid(`intervened-link-event:${runId}`);
  const intervenedCommittedAt = new Date("2026-07-21T18:05:00.000Z");
  await createImportApplication({
    sourceId,
    importId: intervenedImportId,
    applicationId: intervenedApplicationId,
    revisionId: intervenedRevisionId,
    revision: 6,
    parentRevisionId: linkRevisionId,
    parentRevision: 5,
    baseRevisionId: linkRevisionId,
    baseRevision: 5,
    baseHash: manualOfferingHash,
    resultHash: manualOfferingHash,
    runtimeEventId: intervenedRuntimeEventId,
    committedAt: intervenedCommittedAt,
  });
  await attachAppliedLinkCandidate({
    sourceId,
    importId: intervenedImportId,
    applicationId: intervenedApplicationId,
    offeringId: activeOfferingId,
  });
  await prisma.businessInformationState.update({
    where: { tenantId },
    data: {
      revision: 6,
      currentRevisionId: intervenedRevisionId,
      canonicalHash: manualOfferingHash,
      etag: { increment: 1 },
    },
  });
  await prisma.knowledgeV2Settings.update({
    where: { tenantId },
    data: { draftGeneration: { increment: 1 }, etag: { increment: 1 } },
  });
  const intervenedResult = await processBusinessInformationProjectionJob(
    {
      id: `business-import-project:${intervenedApplicationId}:6`,
      name: "project",
      data: {
        tenantId,
        sourceId,
        importId: intervenedImportId,
        applicationId: intervenedApplicationId,
        businessRevisionId: intervenedRevisionId,
        businessRevision: 6,
        generation: 1,
        requestedByUserId: userId,
        requestedAt: intervenedCommittedAt.toISOString(),
        runtimeEventId: intervenedRuntimeEventId,
        runtimeGeneration: 1,
      },
      signal: new AbortController().signal,
    },
    dependencies,
  );
  assert.equal(intervenedResult.status, "succeeded");
  const countsAfterIntervenedProjection = await Promise.all(
    facts.map((fact) => prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } })),
  );
  assert.deepEqual(
    countsAfterIntervenedProjection,
    finalCounts.map((count) => count + 1),
  );
  const [intervenedApplication, intervenedSettings, intervenedFacts] = await Promise.all([
    prisma.businessImportApplication.findUniqueOrThrow({
      where: { id: intervenedApplicationId },
      include: { projectionReceipt: true },
    }),
    prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId } }),
    prisma.knowledgeV2Fact.findMany({
      where: {
        tenantId,
        factKey: {
          in: [
            `business-information:identity:${identityId}`,
            `business-information:offering:${activeOfferingId}`,
            `business-information:offering:${archivedOfferingId}`,
          ],
        },
      },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    }),
  ]);
  const intervenedManifestHash = businessInformationProjectionHash({
    schema: "leadvirt.business-information-knowledge-manifest.v1",
    targetKey: "workspace-v2",
    tenantId,
    businessRevisionId: intervenedRevisionId,
    businessRevision: 6,
    businessRevisionHash: manualOfferingHash,
    facts: intervenedFacts
      .map((fact) => {
        const version = fact.versions[0]!;
        return {
          factKey: fact.factKey,
          factId: fact.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          immutableHash: version.immutableHash,
          lifecycleStatus: version.lifecycleStatus,
        };
      })
      .sort((left, right) => left.factKey.localeCompare(right.factKey)),
  });
  assert(intervenedApplication.projectionReceipt);
  assert.equal(
    intervenedApplication.projectionReceipt.knowledgeDraftGeneration,
    intervenedSettings.draftGeneration,
  );
  assert.equal(
    intervenedApplication.projectionReceipt.knowledgeDraftManifestHash,
    intervenedManifestHash,
  );
  assert.notEqual(
    intervenedApplication.projectionReceipt.knowledgeDraftGeneration,
    linkResult.knowledgeDraftGeneration,
  );
  assert.notEqual(
    intervenedApplication.projectionReceipt.knowledgeDraftManifestHash,
    linkResult.knowledgeDraftManifestHash,
  );
  const linkFinalState = await prisma.businessInformationState.findUniqueOrThrow({
    where: { tenantId },
  });

  const activeAfterManual = await prisma.activeKnowledgePublication.findUniqueOrThrow({
    where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
    include: { publication: true },
  });
  assert.equal(activeAfterManual.publicationId, publicationId);
  assert.equal(activeAfterManual.sequence, 7);
  assert.equal(activeAfterManual.etag, 4);
  assert.equal(activeAfterManual.publication.manifestHash, publicationManifestHash);

  console.log(
    JSON.stringify({
      ok: true,
      projectedFacts: facts.length,
      replayVersionCounts: versionCountsAfterReplay,
      supersededImportState: overtakenImport.state,
      finalRevision: linkFinalState.revision,
    }),
  );
} finally {
  await cleanup();
  await prisma.$disconnect();
}
