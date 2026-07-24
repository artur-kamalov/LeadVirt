import { randomUUID } from "node:crypto";
import { HttpException, HttpStatus } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { BusinessProfileService } from "../../apps/api/src/modules/business-profile/business-profile.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgePublicationDispatcherService } from "../../apps/api/src/modules/knowledge/knowledge-publication-dispatcher.service.js";
import { KnowledgeService } from "../../apps/api/src/modules/knowledge/knowledge.service.js";
import { KnowledgeV2ContentReconciliationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-content-reconciliation.service.js";
import {
  canonicalKnowledgeV2Hash,
  strongKnowledgeV2Etag,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import type { KnowledgeV2IndexPreparationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-index-preparation.service.js";
import { KnowledgeV2MigrationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-migration.service.js";
import { KnowledgeV2OnboardingProjectionService } from "../../apps/api/src/modules/knowledge/knowledge-v2-onboarding-projection.service.js";
import { KnowledgeV2Service } from "../../apps/api/src/modules/knowledge/knowledge-v2.service.js";
import { OnboardingService } from "../../apps/api/src/modules/onboarding/onboarding.service.js";
import {
  buildKnowledgeV2SnapshotAuthorizationManifest,
  createKnowledgeV2QueryHashKeyring,
  hashKnowledgeValue,
  KnowledgeRuntimeRetriever,
  type KnowledgeV2Retriever,
} from "../../packages/knowledge/src/index.js";
import type { KnowledgeRetriever } from "../../packages/knowledge/src/retriever.js";
import {
  LegacyKnowledgeCorpusInactiveError,
  LegacyKnowledgePublisher,
  legacyKnowledgeCorpusInactiveCode,
} from "../../packages/knowledge/src/publisher.js";

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
  role: RequestContext["role"],
): RequestContext {
  return { tenantId: tenant.id, userId: user.id, role, authMode: "email", tenant, user };
}

function httpCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const payload = error.getResponse();
  return typeof payload === "object" && payload !== null && "code" in payload ? payload.code : null;
}

async function expectHttp(operation: () => Promise<unknown>, status: number, code?: string) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof HttpException && error.getStatus() === status,
      `Expected HTTP ${status}.`,
    );
    if (code)
      assert(httpCode(error) === code, `Expected ${code}, received ${String(httpCode(error))}.`);
    return;
  }
  throw new Error(`Expected HTTP ${status}.`);
}

async function expectDatabaseFailure(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error("Expected database constraint failure.");
}

async function expectLegacyPublicationInactive(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof LegacyKnowledgeCorpusInactiveError,
      "Expected the legacy publication cutover fence.",
    );
    return;
  }
  throw new Error("Expected legacy publication to be terminal after cutover.");
}

class CutoverIndexVerifier {
  calls = 0;
  fail = false;

  constructor(
    private readonly snapshotId: string,
    private readonly pointCount: number,
  ) {}

  async preparePublication() {
    this.calls += 1;
    if (this.fail) {
      throw new HttpException(
        {
          code: "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
          message: "Physical index reconciliation failed.",
          retryable: true,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      snapshotId: this.snapshotId,
      expectedPointCount: this.pointCount,
      observedPointCount: this.pointCount,
      reused: true,
    };
  }
}

class ForbiddenLegacyDispatcher {
  createCalls = 0;
  dispatchCalls = 0;

  async createEvent() {
    this.createCalls += 1;
    throw new Error("Legacy publication was requested after structured cutover.");
  }

  async dispatch() {
    this.dispatchCalls += 1;
    throw new Error("Legacy publication was dispatched after structured cutover.");
  }
}

class RecordingLegacyDispatcher {
  createCalls = 0;
  dispatchCalls = 0;

  async createEvent() {
    this.createCalls += 1;
    return { id: randomUUID() };
  }

  async dispatch(eventId: string) {
    this.dispatchCalls += 1;
    return { id: eventId };
  }
}

async function createStructuredPublication(
  prisma: PrismaService,
  tenantId: string,
  userId: string,
  migrationId: string,
) {
  const revisions = await prisma.knowledgeV2DocumentRevision.findMany({
    where: { tenantId, legacyMigrationId: migrationId },
    include: { chunks: true, document: { include: { source: true } } },
    orderBy: { id: "asc" },
  });
  assert(revisions.length > 0, "Migration created no structured revisions.");
  for (const revision of revisions) {
    await prisma.knowledgeV2Source.update({
      where: { id: revision.sourceId },
      data: { status: "READY" },
    });
    await prisma.knowledgeV2Document.update({
      where: { id: revision.documentId },
      data: { status: "ACTIVE" },
    });
    await prisma.knowledgeV2DocumentRevision.update({
      where: { id: revision.id },
      data: { status: "READY" },
    });
    await prisma.knowledgeV2Chunk.updateMany({
      where: { tenantId, revisionId: revision.id },
      data: { indexState: "INDEXED", indexedAt: new Date() },
    });
  }
  const refreshed = await prisma.knowledgeV2DocumentRevision.findMany({
    where: { tenantId, id: { in: revisions.map((revision) => revision.id) } },
    include: { chunks: true, document: { include: { source: true } } },
    orderBy: { id: "asc" },
  });
  const items = refreshed.map((revision) => ({
    itemType: "DOCUMENT_REVISION" as const,
    itemId: revision.id,
    itemVersionHash: revision.contentHash,
    scope: revision.scopeSnapshot,
    authorizationFingerprint: revision.sourcePermissionFingerprint,
  }));
  const publicationManifestHash = canonicalKnowledgeV2Hash(items);
  const indexSchema = {
    schemaVersion: 1,
    dense: { provider: "smoke", model: "dense-v1", dimensions: 3 },
    sparse: { provider: "smoke", model: "sparse-v1" },
    pipelineVersion: "knowledge-v2-hybrid-v1",
  };
  const indexSchemaHash = canonicalKnowledgeV2Hash(indexSchema);
  const snapshotManifestHash = canonicalKnowledgeV2Hash({
    version: 1,
    corpusKind: "STRUCTURED_V2",
    documents: items
      .map((item) => ({
        revisionId: item.itemId,
        contentHash: item.itemVersionHash,
        authorizationFingerprint: item.authorizationFingerprint,
        scope: item.scope,
      }))
      .sort((left, right) => left.revisionId.localeCompare(right.revisionId)),
    indexSchemaHash,
  });
  const snapshotId = randomUUID();
  const snapshotPoints = refreshed.flatMap((revision) =>
    revision.chunks.map((chunk) => {
      const pointFingerprint = canonicalKnowledgeV2Hash({
        chunkId: chunk.id,
        contentHash: chunk.contentHash,
        vectorPointId: chunk.vectorPointId,
      });
      return {
        sourceId: revision.sourceId,
        sourceGeneration: revision.document.source.generation,
        authorizationFingerprint: revision.sourcePermissionFingerprint,
        permissionVersion: revision.document.source.sourcePermissionVersion,
        chunkId: chunk.id,
        documentId: revision.documentId,
        revisionId: revision.id,
        contentHash: chunk.contentHash,
        vectorPointId: chunk.vectorPointId,
        pointFingerprint,
      };
    }),
  );
  assert(snapshotPoints.length > 0, "Migration created no structured snapshot points.");
  const settings = await prisma.knowledgeV2Settings.findUnique({
    where: { tenantId },
    select: { draftGeneration: true },
  });
  const snapshot = await prisma.knowledgeIndexSnapshot.create({
    data: {
      id: snapshotId,
      tenantId,
      corpusKind: "STRUCTURED_V2",
      status: "PREPARING",
      collectionName: `migration-smoke-${tenantId}`,
      embeddingProvider: "smoke",
      embeddingModel: "dense-v1",
      manifestHash: snapshotManifestHash,
      authorizationManifestVersion: 1,
      indexSchema,
      indexSchemaHash,
      pipelineVersion: "knowledge-v2-hybrid-v1",
      expectedPointCount: snapshotPoints.length,
      preparationStartedAt: new Date(),
    },
  });
  await prisma.knowledgeV2IndexSnapshotItem.createMany({
    data: snapshotPoints.map((point) => ({
      tenantId,
      snapshotId: snapshot.id,
      corpusKind: "STRUCTURED_V2" as const,
      chunkId: point.chunkId,
      contentHash: point.contentHash,
      vectorPointId: point.vectorPointId,
      pointFingerprint: point.pointFingerprint,
    })),
  });
  const authorization = buildKnowledgeV2SnapshotAuthorizationManifest({
    tenantId,
    snapshotId: snapshot.id,
    snapshotManifestHash,
    indexSchemaHash,
    points: snapshotPoints,
  });
  const readySnapshot = await prisma.knowledgeIndexSnapshot.update({
    where: { id: snapshot.id },
    data: {
      status: "READY",
      observedPointCount: snapshotPoints.length,
      verifiedAt: new Date(),
      preparationStartedAt: null,
      authorizationManifest: authorization.manifest as unknown as Prisma.InputJsonValue,
      authorizationManifestHash: authorization.hash,
    },
  });
  let publication = await prisma.knowledgePublication.create({
    data: {
      tenantId,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      sequence: 1,
      status: "READY",
      indexSnapshotId: snapshot.id,
      manifestHash: publicationManifestHash,
      pipelineVersion: "knowledge-v2",
      retrievalPolicyVersion: "structured-v2-v1",
      promptPolicyVersion: "structured-v2-v1",
      readyAt: new Date(),
    },
  });
  await prisma.knowledgePublicationItem.createMany({
    data: items.map((item) => ({
      tenantId,
      publicationId: publication.id,
      corpusKind: "STRUCTURED_V2" as const,
      itemType: item.itemType,
      itemId: item.itemId,
      itemVersionHash: item.itemVersionHash,
      v2DocumentRevisionId: item.itemId,
      scope: item.scope ?? Prisma.JsonNull,
      authorizationFingerprint: item.authorizationFingerprint,
    })),
  });
  await prisma.knowledgeV2PublicationValidation.create({
    data: {
      tenantId,
      targetKey: "workspace-v2",
      corpusKind: "STRUCTURED_V2",
      candidateId: "workspace-v2",
      candidateVersion: settings?.draftGeneration ?? 1,
      candidateManifestHash: publicationManifestHash,
      publicationId: publication.id,
      indexSnapshotId: snapshot.id,
      candidateItems: items,
      status: "PASSED",
      validatedByUserId: userId,
      evaluatedAt: new Date(),
      validUntil: new Date(Date.now() + 60_000),
    },
  });
  publication = await prisma.knowledgePublication.update({
    where: { id: publication.id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
  await prisma.activeKnowledgePublication.create({
    data: {
      tenantId,
      targetKey: "workspace-v2",
      publicationId: publication.id,
      sequence: publication.sequence,
      updatedByUserId: userId,
    },
  });
  return { publication, snapshot: readySnapshot, pointCount: snapshotPoints.length };
}

async function createLegacyRuntimeFixture(prisma: PrismaService, tenantId: string, userId: string) {
  const publication = await prisma.knowledgePublication.create({
    data: {
      tenantId,
      targetKey: "workspace",
      corpusKind: "LEGACY_V1",
      sequence: 1,
      status: "ACTIVE",
      manifestHash: canonicalKnowledgeV2Hash({ tenantId, corpus: "legacy" }),
      pipelineVersion: "legacy-v1",
      retrievalPolicyVersion: "legacy-v1",
      promptPolicyVersion: "legacy-v1",
      readyAt: new Date(),
      activatedAt: new Date(),
    },
  });
  await prisma.activeKnowledgePublication.create({
    data: {
      tenantId,
      targetKey: "workspace",
      publicationId: publication.id,
      sequence: publication.sequence,
      updatedByUserId: userId,
    },
  });
  return publication;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const projectedBusinessName = `Projected business ${stamp}`;
  const projectedBusinessType = `projected-type-${stamp}`;
  const projectedPolicy = `Only make confirmed commitments ${stamp}`;
  const projectedEscalation = `Escalate refund requests ${stamp}`;
  const ordinaryLegacyMarker = `Customer-uploaded knowledge ${stamp}`;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  try {
    const [ownerUser, managerUser] = await Promise.all([
      prisma.user.create({
        data: { email: `migration-owner-${stamp}@example.test`, name: "Owner" },
      }),
      prisma.user.create({
        data: { email: `migration-manager-${stamp}@example.test`, name: "Manager" },
      }),
    ]);
    userIds.push(ownerUser.id, managerUser.id);
    const tenant = await prisma.tenant.create({
      data: {
        name: "Tenant truth",
        slug: `migration-${stamp}`,
        businessType: "services",
        settings: { locale: "en" },
      },
    });
    tenantIds.push(tenant.id);
    await prisma.membership.createMany({
      data: [
        { tenantId: tenant.id, userId: ownerUser.id, role: "OWNER" },
        { tenantId: tenant.id, userId: managerUser.id, role: "MANAGER" },
      ],
    });
    await prisma.onboardingState.create({
      data: {
        tenantId: tenant.id,
        data: {
          companyInfo: {
            name: projectedBusinessName,
            policies: projectedPolicy,
            escalationRules: projectedEscalation,
          },
          businessType: projectedBusinessType,
        },
      },
    });
    const [unsafeCompatibilitySource, ordinaryLegacySource, ordinaryArchiveSource] =
      await Promise.all([
        prisma.businessKnowledgeSource.create({
          data: {
            tenantId: tenant.id,
            type: "ESCALATION",
            status: "ACTIVE",
            source: "onboarding",
            sourceKey: "onboarding:escalation",
            title: "Escalation rules",
            content: projectedEscalation,
            structuredData: {
              source: "onboarding",
              escalationRules: projectedEscalation,
            },
          },
        }),
        prisma.businessKnowledgeSource.create({
          data: {
            id: `zz-${randomUUID()}`,
            tenantId: tenant.id,
            type: "FAQ",
            status: "ACTIVE",
            source: "manual",
            sourceKey: `onboarding:customer-uploaded:${stamp}`,
            title: "Customer-uploaded knowledge",
            content: ordinaryLegacyMarker,
          },
        }),
        prisma.businessKnowledgeSource.create({
          data: {
            tenantId: tenant.id,
            type: "FAQ",
            status: "ACTIVE",
            source: "manual",
            sourceKey: `manual:archive:${stamp}`,
            title: "Archive test knowledge",
            content: `Archive test ${stamp}`,
          },
        }),
      ]);
    const owner = context(tenant, ownerUser, "OWNER");
    const manager = context(tenant, managerUser, "MANAGER");
    const preCutoverDispatcher = new RecordingLegacyDispatcher();
    const preCutoverKnowledge = new KnowledgeService(
      prisma,
      {} as never,
      {} as never,
      preCutoverDispatcher as never,
      {} as never,
      {} as never,
    );
    await expectHttp(
      () =>
        preCutoverKnowledge.update(owner, unsafeCompatibilitySource.id, {
          content: `Unsafe direct edit ${stamp}`,
        }),
      409,
      "KNOWLEDGE_CONFLICT_ONBOARDING_SOURCE_MANAGED",
    );
    await expectHttp(
      () => preCutoverKnowledge.archive(owner, unsafeCompatibilitySource.id),
      409,
      "KNOWLEDGE_CONFLICT_ONBOARDING_SOURCE_MANAGED",
    );
    const compatibilityAfterDirectWrites = await prisma.businessKnowledgeSource.findUniqueOrThrow({
      where: { id: unsafeCompatibilitySource.id },
    });
    const ordinaryUpdated = await preCutoverKnowledge.update(owner, ordinaryLegacySource.id, {
      title: `Customer-uploaded knowledge updated ${stamp}`,
    });
    const ordinaryArchived = await preCutoverKnowledge.archive(owner, ordinaryArchiveSource.id);
    const ordinaryArchiveRow = await prisma.businessKnowledgeSource.findUniqueOrThrow({
      where: { id: ordinaryArchiveSource.id },
    });
    assert(
      compatibilityAfterDirectWrites.version === unsafeCompatibilitySource.version &&
        compatibilityAfterDirectWrites.status === unsafeCompatibilitySource.status &&
        compatibilityAfterDirectWrites.content === unsafeCompatibilitySource.content &&
        ordinaryUpdated.title === `Customer-uploaded knowledge updated ${stamp}` &&
        ordinaryArchived.archived &&
        ordinaryArchiveRow.status === "ARCHIVED" &&
        ordinaryArchiveRow.deletedAt !== null &&
        preCutoverDispatcher.createCalls === 2 &&
        preCutoverDispatcher.dispatchCalls === 2,
      "Managed onboarding sources changed directly or ordinary legacy mutations regressed.",
    );
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const startRollbackTenant = await prisma.tenant.create({
      data: {
        name: "Migration rollback",
        slug: `migration-rollback-${stamp}`,
        businessType: "services",
      },
    });
    tenantIds.push(startRollbackTenant.id);
    await prisma.membership.create({
      data: { tenantId: startRollbackTenant.id, userId: ownerUser.id, role: "OWNER" },
    });
    await prisma.onboardingState.create({
      data: {
        tenantId: startRollbackTenant.id,
        data: {
          businessType: "services",
          companyInfo: { name: "Rollback truth", policies: "Rollback policy" },
        },
      },
    });
    const rollbackOwner = context(startRollbackTenant, ownerUser, "OWNER");
    const realRollbackProjection = new KnowledgeV2OnboardingProjectionService();
    const failingMigrationProjection = {
      projectInTransaction: async (
        ...args: Parameters<typeof realRollbackProjection.projectInTransaction>
      ) => {
        await realRollbackProjection.projectInTransaction(...args);
        throw new Error("forced migration projection failure");
      },
    } as unknown as KnowledgeV2OnboardingProjectionService;
    const rollbackService = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      failingMigrationProjection,
    );
    let migrationProjectionRejected = false;
    try {
      await rollbackService.start(rollbackOwner, {}, `rollback-start-${stamp}`);
    } catch {
      migrationProjectionRejected = true;
    }
    const [rollbackMigrationCount, rollbackFactCount, rollbackRuleCount, rollbackEventCount] =
      await Promise.all([
        prisma.knowledgeV2LegacyMigration.count({ where: { tenantId: startRollbackTenant.id } }),
        prisma.knowledgeV2Fact.count({ where: { tenantId: startRollbackTenant.id } }),
        prisma.knowledgeV2GuidanceRule.count({ where: { tenantId: startRollbackTenant.id } }),
        prisma.knowledgeOutbox.count({ where: { tenantId: startRollbackTenant.id } }),
      ]);
    assert(
      migrationProjectionRejected &&
        rollbackMigrationCount === 0 &&
        rollbackFactCount === 0 &&
        rollbackRuleCount === 0 &&
        rollbackEventCount === 0 &&
        (await prisma.knowledgeCorpusSelector.findUnique({
          where: { tenantId: startRollbackTenant.id },
        })) === null &&
        (await prisma.knowledgeV2Settings.findUnique({
          where: { tenantId: startRollbackTenant.id },
        })) === null &&
        (await prisma.businessKnowledgeSource.count({
          where: { tenantId: startRollbackTenant.id },
        })) === 0,
      "Migration-start projection failure escaped its atomic transaction.",
    );
    const migrationProjection = new KnowledgeV2OnboardingProjectionService();
    const migrationReconciliation = new KnowledgeV2ContentReconciliationService(prisma);
    const migrationDispatchedEvents: string[] = [];
    const service = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      undefined,
      migrationProjection,
      {
        dispatch: async (eventId: string) => {
          assert(
            (await prisma.knowledgeV2LegacyMigration.count({
              where: { tenantId: tenant.id },
            })) === 1,
            "Onboarding reconciliation started before migration commit.",
          );
          migrationDispatchedEvents.push(eventId);
          return migrationReconciliation.dispatch(eventId);
        },
      } as KnowledgeV2ContentReconciliationService,
    );

    await expectHttp(
      () => service.start(manager, { batchSize: 1 }, `manager-${stamp}`),
      403,
      "KNOWLEDGE_PERMISSION_LEGACY_MIGRATION_DENIED",
    );
    const first = await service.start(owner, { batchSize: 1 }, `start-${stamp}`);
    const replay = await service.start(owner, { batchSize: 1 }, `start-${stamp}`);
    const existingReplay = await service.start(owner, { batchSize: 1 }, `start-existing-${stamp}`);
    assert(replay.idempotencyReplayed, "Migration start was not idempotent.");
    assert(
      !existingReplay.idempotencyReplayed && existingReplay.resource.id === first.resource.id,
      "A matching migration start did not reuse the existing migration safely.",
    );
    assert(
      first.resource.expectedSourceCount === 2,
      "Migration did not keep ordinary knowledge while excluding onboarding compatibility data.",
    );
    const [backfilledFacts, backfilledRules, backfillSettings, backfillEvents, backfillJobs] =
      await Promise.all([
        prisma.knowledgeV2Fact.findMany({
          where: { tenantId: tenant.id },
          include: { versions: { include: { evidence: true } } },
          orderBy: { factKey: "asc" },
        }),
        prisma.knowledgeV2GuidanceRule.findMany({
          where: { tenantId: tenant.id },
          include: { versions: { include: { evidence: true } } },
          orderBy: { ruleKey: "asc" },
        }),
        prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
        prisma.knowledgeOutbox.findMany({
          where: {
            tenantId: tenant.id,
            eventType: "knowledge.v2.content-reconciliation.requested",
          },
        }),
        prisma.knowledgeJob.findMany({
          where: { tenantId: tenant.id, payloadRef: { startsWith: "content-reconciliation:" } },
        }),
      ]);
    assert(
      backfilledFacts.length === 2 &&
        backfilledFacts.every(
          (fact) =>
            fact.latestVersionNumber === 1 &&
            fact.versions[0]?.lifecycleStatus === "DRAFT" &&
            fact.versions[0].verificationStatus === "VERIFIED" &&
            fact.versions[0].authority === "OWNER_VERIFIED" &&
            fact.versions[0].verifiedByUserId === ownerUser.id &&
            Boolean(fact.versions[0].verifiedAt) &&
            fact.versions[0].evidence.length === 1,
        ),
      "Migration start did not backfill owner-confirmed onboarding facts.",
    );
    assert(
      backfilledRules.length === 2 &&
        backfilledRules.every(
          (rule) => rule.latestVersionNumber === 1 && rule.versions[0]?.reviewStatus === "DRAFT",
        ),
      "Migration start did not backfill onboarding guidance as reviewable drafts.",
    );
    assert(
      backfillSettings.draftGeneration === 2 &&
        backfillEvents.length === 4 &&
        backfillEvents.every((event) => event.status === "PUBLISHED") &&
        backfillJobs.length === 4 &&
        backfillJobs.every((job) => job.status === "SUCCEEDED") &&
        migrationDispatchedEvents.length === 4,
      "Migration-start onboarding reconciliation was not committed and dispatched once.",
    );
    assert(
      (await prisma.knowledgePublication.count({
        where: { tenantId: tenant.id, corpusKind: "STRUCTURED_V2" },
      })) === 0 &&
        (await prisma.activeKnowledgePublication.findUnique({
          where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
        })) === null,
      "Migration-start onboarding backfill auto-published the structured corpus.",
    );
    const firstBatch = await service.resume(
      owner,
      first.resource.id,
      { generation: first.resource.generation, batchSize: 1 },
      `resume-${stamp}`,
    );
    assert(
      firstBatch.resource.status === "QUEUED" && firstBatch.resource.migratedSourceCount === 1,
      "First legacy migration batch did not preserve resumable progress.",
    );
    const migrated = await service.resume(
      owner,
      first.resource.id,
      { generation: first.resource.generation, batchSize: 1 },
      `resume-final-${stamp}`,
    );
    assert(
      migrated.resource.status === "BLOCKED" &&
        migrated.resource.reviewCount > 0 &&
        migrated.resource.conflictCount > 0,
      "Observable disagreement did not block migration.",
    );
    const imported = await prisma.knowledgeV2DocumentRevision.findFirstOrThrow({
      where: { tenantId: tenant.id, legacyMigrationId: first.resource.id },
      include: { chunks: { include: { parentElement: true } } },
    });
    assert(
      imported.revisionNumber === 1 &&
        imported.parserVersion === "legacy-snapshot-v1" &&
        imported.pipelineVersion === "knowledge-v2-legacy-migration-v1" &&
        imported.legacySourceVersion === 1,
      "Imported revision provenance is invalid.",
    );
    assert(
      imported.chunks.length > 0 &&
        imported.chunks.every(
          (chunk) =>
            chunk.parentElement !== null &&
            chunk.contentHash === hashKnowledgeValue(chunk.parentElement.normalizedText) &&
            chunk.parentElement.contentHash === chunk.contentHash,
        ),
      "Migrated chunk hashes do not match their exact text.",
    );
    await expectDatabaseFailure(() =>
      prisma.knowledgeV2DocumentRevision.update({
        where: { id: imported.id },
        data: { legacySnapshotHash: "0".repeat(64) },
      }),
    );
    await expectDatabaseFailure(() =>
      prisma.knowledgeV2LegacyMigration.update({
        where: { id: first.resource.id },
        data: { sourceManifestHash: "0".repeat(64) },
      }),
    );
    await expectDatabaseFailure(() =>
      prisma.knowledgeCorpusSelector.update({
        where: { tenantId: tenant.id },
        data: {
          corpusKind: "STRUCTURED_V2",
          migrationId: first.resource.id,
          generation: { increment: 1 },
        },
      }),
    );

    const resolvedAt = new Date();
    await prisma.knowledgeV2Conflict.updateMany({
      where: {
        tenantId: tenant.id,
        conflictKey: { startsWith: `legacy-migration:${first.resource.id}:` },
      },
      data: {
        status: "RESOLVED",
        resolution: "REQUIRE_HANDOFF",
        resolutionRationaleHash: canonicalKnowledgeV2Hash("owner resolution"),
        resolvedByUserId: ownerUser.id,
        resolvedAt,
      },
    });
    await prisma.knowledgeV2ReviewItem.updateMany({
      where: {
        tenantId: tenant.id,
        reviewKey: { startsWith: `legacy-migration:${first.resource.id}:` },
      },
      data: {
        status: "RESOLVED",
        resolutionAction: "REQUIRE_HANDOFF",
        resolutionSummaryHash: canonicalKnowledgeV2Hash("owner resolution"),
        resolvedByUserId: ownerUser.id,
        resolvedAt,
      },
    });
    const ready = await service.resume(
      owner,
      first.resource.id,
      { generation: first.resource.generation },
      `ready-${stamp}`,
    );
    assert(ready.resource.status === "READY", "Resolved migration did not become READY.");
    const [unsafeRevisionCount, ordinaryRevision] = await Promise.all([
      prisma.knowledgeV2DocumentRevision.count({
        where: { tenantId: tenant.id, legacySourceId: unsafeCompatibilitySource.id },
      }),
      prisma.knowledgeV2DocumentRevision.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          legacyMigrationId: first.resource.id,
          legacySourceId: ordinaryLegacySource.id,
        },
        include: {
          document: { include: { source: true } },
          elements: { select: { normalizedText: true } },
        },
      }),
    ]);
    assert(
      unsafeRevisionCount === 0 &&
        ordinaryRevision.document.source.kind === "MANUAL" &&
        ordinaryRevision.elements.some(
          (element) => element.normalizedText === ordinaryLegacyMarker,
        ),
      "Legacy migration dropped ordinary knowledge or published an onboarding compatibility source.",
    );

    const legacyPublication = await createLegacyRuntimeFixture(prisma, tenant.id, ownerUser.id);
    const delayedLegacyDispatcher = new KnowledgePublicationDispatcherService(
      prisma,
      new LegacyKnowledgePublisher(prisma, {
        mode: "database",
        qdrantUrl: "http://localhost:6333",
        qdrantCollection: `legacy_cutover_${stamp.replaceAll("-", "_")}`,
        qdrantTimeoutMs: 1_000,
        minScore: 0.05,
        candidateLimit: 20,
        targetKey: "workspace",
      }),
    );
    const delayedLegacyEvent = await prisma.$transaction((tx) =>
      delayedLegacyDispatcher.createEvent(tx, {
        tenantId: tenant.id,
        actorUserId: ownerUser.id,
        reason: "queued_before_structured_cutover",
        stateParts: [legacyPublication.id, legacyPublication.sequence],
      }),
    );
    const structured = await createStructuredPublication(
      prisma,
      tenant.id,
      ownerUser.id,
      first.resource.id,
    );
    const migratedPublicationItems = await prisma.knowledgePublicationItem.findMany({
      where: {
        tenantId: tenant.id,
        publicationId: structured.publication.id,
        itemType: "DOCUMENT_REVISION",
      },
      include: {
        v2DocumentRevision: { include: { document: { include: { source: true } } } },
      },
    });
    assert(
      migratedPublicationItems.some(
        (item) => item.v2DocumentRevision?.legacySourceId === ordinaryLegacySource.id,
      ) &&
        migratedPublicationItems.every(
          (item) =>
            item.v2DocumentRevision?.legacySourceId !== unsafeCompatibilitySource.id &&
            item.v2DocumentRevision?.document.source.kind !== "LEGACY_ONBOARDING",
        ),
      "Structured publication retained a legacy onboarding compatibility document.",
    );
    await prisma.knowledgeIndexSnapshot.update({
      where: { id: structured.snapshot.id },
      data: { observedPointCount: structured.pointCount + 1 },
    });
    await expectDatabaseFailure(() =>
      prisma.knowledgeCorpusSelector.update({
        where: { tenantId: tenant.id },
        data: {
          corpusKind: "STRUCTURED_V2",
          migrationId: first.resource.id,
          generation: { increment: 1 },
        },
      }),
    );
    const verifier = new CutoverIndexVerifier(structured.snapshot.id, structured.pointCount);
    const cutoverService = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      verifier as unknown as KnowledgeV2IndexPreparationService,
    );
    await expectHttp(
      () =>
        cutoverService.cutover(
          owner,
          {
            migrationId: first.resource.id,
            migrationGeneration: first.resource.generation,
            selectorGeneration: 1,
          },
          `corrupt-${stamp}`,
        ),
      409,
      "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
    );
    await prisma.knowledgeIndexSnapshot.update({
      where: { id: structured.snapshot.id },
      data: { observedPointCount: structured.pointCount },
    });
    await prisma.knowledgeV2Source.update({
      where: { id: ordinaryRevision.sourceId },
      data: { kind: "LEGACY_ONBOARDING" },
    });
    const unsafeKindVerifier = new CutoverIndexVerifier(
      structured.snapshot.id,
      structured.pointCount,
    );
    const unsafeKindCutover = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      unsafeKindVerifier as unknown as KnowledgeV2IndexPreparationService,
    );
    await expectHttp(
      () =>
        unsafeKindCutover.cutover(
          owner,
          {
            migrationId: first.resource.id,
            migrationGeneration: first.resource.generation,
            selectorGeneration: 1,
          },
          `legacy-onboarding-${stamp}`,
        ),
      409,
      "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
    );
    await prisma.knowledgeV2Source.update({
      where: { id: ordinaryRevision.sourceId },
      data: { kind: "MANUAL" },
    });
    assert(
      unsafeKindVerifier.calls === 1,
      "Legacy onboarding cutover was not rejected fail-closed.",
    );
    const backfilledName = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: { tenantId: tenant.id, factKey: "business/name" },
      },
    });
    const ownershipReview = await prisma.knowledgeV2ReviewItem.create({
      data: {
        tenantId: tenant.id,
        corpusKind: "STRUCTURED_V2",
        reviewKey: ["onboarding-projection-v1", "ownership", "FACT", backfilledName.id].join(":"),
        reason: "CONFLICTING_VALUES",
        riskLevel: "HIGH",
        status: "OPEN",
        suggestedAction: "APPROVE",
        safeTitle: "Onboarding answer needs Knowledge review",
        safeSummary: "Resolve ownership before cutover.",
        factId: backfilledName.id,
        createdByUserId: ownerUser.id,
      },
    });
    const ownershipCutover = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      new CutoverIndexVerifier(
        structured.snapshot.id,
        structured.pointCount,
      ) as unknown as KnowledgeV2IndexPreparationService,
    );
    await expectHttp(
      () =>
        ownershipCutover.cutover(
          owner,
          {
            migrationId: first.resource.id,
            migrationGeneration: first.resource.generation,
            selectorGeneration: 1,
          },
          `ownership-${stamp}`,
        ),
      409,
      "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
    );
    await prisma.knowledgeV2ReviewItem.update({
      where: { id: ownershipReview.id },
      data: {
        status: "DISMISSED",
        resolutionAction: "DISMISS",
        resolutionSummaryHash: canonicalKnowledgeV2Hash("ownership review resolved"),
        resolvedByUserId: ownerUser.id,
        resolvedAt: new Date(),
      },
    });
    verifier.fail = true;
    await expectHttp(
      () =>
        cutoverService.cutover(
          owner,
          {
            migrationId: first.resource.id,
            migrationGeneration: first.resource.generation,
            selectorGeneration: 1,
          },
          `physical-${stamp}`,
        ),
      503,
      "KNOWLEDGE_DEPENDENCY_INDEX_RECONCILIATION_FAILED",
    );
    assert(
      (await prisma.knowledgeCorpusSelector.findUniqueOrThrow({ where: { tenantId: tenant.id } }))
        .corpusKind === "LEGACY_V1",
      "Physical verifier failure changed the corpus selector.",
    );
    verifier.fail = false;
    const cutoverInput = {
      migrationId: first.resource.id,
      migrationGeneration: first.resource.generation,
      selectorGeneration: 1,
    };
    const cutover = await cutoverService.cutover(owner, cutoverInput, `cutover-${stamp}`);
    const cutoverReplay = await cutoverService.cutover(owner, cutoverInput, `cutover-${stamp}`);
    assert(
      cutover.resource.corpusKind === "STRUCTURED_V2" &&
        cutoverReplay.idempotencyReplayed &&
        verifier.calls === 3,
      "Cutover or prepared idempotency replay failed.",
    );
    await expectDatabaseFailure(() =>
      prisma.knowledgeCorpusSelector.update({
        where: { tenantId: tenant.id },
        data: { corpusKind: "LEGACY_V1", migrationId: null, generation: { increment: 1 } },
      }),
    );
    await expectHttp(
      () => cutoverService.start(owner, {}, `post-cutover-${stamp}`),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_AFTER_CUTOVER",
    );
    const legacyPublicationCountBeforeDelayedDispatch = await prisma.knowledgePublication.count({
      where: { tenantId: tenant.id, corpusKind: "LEGACY_V1" },
    });
    await expectLegacyPublicationInactive(() =>
      delayedLegacyDispatcher.dispatch(delayedLegacyEvent.id),
    );
    const [terminalLegacyEvent, terminalLegacyJob, terminalLegacyAttempt, legacyPointerAfterFence] =
      await Promise.all([
        prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: delayedLegacyEvent.id } }),
        prisma.knowledgeJob.findUniqueOrThrow({
          where: {
            tenantId_idempotencyKey: {
              tenantId: tenant.id,
              idempotencyKey: `outbox:${delayedLegacyEvent.id}`,
            },
          },
        }),
        prisma.knowledgeJobAttempt.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            job: { idempotencyKey: `outbox:${delayedLegacyEvent.id}` },
          },
        }),
        prisma.activeKnowledgePublication.findUniqueOrThrow({
          where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace" } },
        }),
      ]);
    assert(
      terminalLegacyEvent.status === "DEAD_LETTER" &&
        terminalLegacyEvent.lastErrorCode === legacyKnowledgeCorpusInactiveCode &&
        terminalLegacyJob.status === "CANCELLED" &&
        terminalLegacyJob.errorCode === legacyKnowledgeCorpusInactiveCode &&
        terminalLegacyAttempt.status === "CANCELLED" &&
        terminalLegacyAttempt.errorCode === legacyKnowledgeCorpusInactiveCode &&
        legacyPointerAfterFence.publicationId === legacyPublication.id &&
        (await prisma.knowledgePublication.count({
          where: { tenantId: tenant.id, corpusKind: "LEGACY_V1" },
        })) === legacyPublicationCountBeforeDelayedDispatch,
      "A queued legacy publication retried or activated after structured cutover.",
    );
    await expectLegacyPublicationInactive(() =>
      delayedLegacyDispatcher.dispatch(delayedLegacyEvent.id),
    );

    const exhaustedLegacyEvent = await prisma.$transaction((tx) =>
      delayedLegacyDispatcher.createEvent(tx, {
        tenantId: tenant.id,
        actorUserId: ownerUser.id,
        reason: "exhausted_legacy_publication",
        stateParts: [stamp],
      }),
    );
    const activeLeaseAt = new Date();
    await prisma.knowledgeOutbox.update({
      where: { id: exhaustedLegacyEvent.id },
      data: {
        status: "PUBLISHING",
        attemptCount: 5,
        lockedAt: activeLeaseAt,
        lockedBy: "active-legacy-worker",
      },
    });
    const exhaustedLegacyJob = await prisma.knowledgeJob.create({
      data: {
        tenantId: tenant.id,
        idempotencyKey: `outbox:${exhaustedLegacyEvent.id}`,
        stage: "publish_legacy_snapshot",
        status: "RUNNING",
        attemptCount: 1,
        startedAt: activeLeaseAt,
        heartbeatAt: activeLeaseAt,
      },
    });
    await Promise.all([
      prisma.knowledgeJobAttempt.create({
        data: {
          tenantId: tenant.id,
          jobId: exhaustedLegacyJob.id,
          attempt: 1,
          status: "RUNNING",
          workerId: "active-legacy-worker",
        },
      }),
      prisma.knowledgeInbox.create({
        data: {
          tenantId: tenant.id,
          consumer: "api.legacy-knowledge-publisher.v1",
          eventId: exhaustedLegacyEvent.id,
          status: "PROCESSING",
        },
      }),
    ]);
    assert(
      (await delayedLegacyDispatcher.dispatch(exhaustedLegacyEvent.id)) === null &&
        (
          await prisma.knowledgeOutbox.findUniqueOrThrow({
            where: { id: exhaustedLegacyEvent.id },
          })
        ).status === "PUBLISHING",
      "Exhaustion handling stole a live legacy publication lease.",
    );
    await prisma.knowledgeOutbox.update({
      where: { id: exhaustedLegacyEvent.id },
      data: { lockedAt: new Date(Date.now() - 120_000) },
    });
    let exhaustedLegacyRejected = false;
    try {
      await delayedLegacyDispatcher.dispatch(exhaustedLegacyEvent.id);
    } catch (error) {
      exhaustedLegacyRejected =
        error instanceof Error && !(error instanceof LegacyKnowledgeCorpusInactiveError);
    }
    assert(exhaustedLegacyRejected, "An exhausted legacy publication was not terminalized.");
    const [exhaustedEventAfter, exhaustedJobAfter, exhaustedAttemptAfter, exhaustedInboxAfter] =
      await Promise.all([
        prisma.knowledgeOutbox.findUniqueOrThrow({ where: { id: exhaustedLegacyEvent.id } }),
        prisma.knowledgeJob.findUniqueOrThrow({ where: { id: exhaustedLegacyJob.id } }),
        prisma.knowledgeJobAttempt.findUniqueOrThrow({
          where: { jobId_attempt: { jobId: exhaustedLegacyJob.id, attempt: 1 } },
        }),
        prisma.knowledgeInbox.findUniqueOrThrow({
          where: {
            consumer_eventId: {
              consumer: "api.legacy-knowledge-publisher.v1",
              eventId: exhaustedLegacyEvent.id,
            },
          },
        }),
      ]);
    assert(
      exhaustedEventAfter.status === "DEAD_LETTER" &&
        exhaustedEventAfter.lockedAt === null &&
        exhaustedEventAfter.lockedBy === null &&
        exhaustedEventAfter.lastErrorCode === "KNOWLEDGE_OUTBOX_EXHAUSTED" &&
        exhaustedJobAfter.status === "DEAD_LETTER" &&
        exhaustedJobAfter.completedAt !== null &&
        exhaustedJobAfter.errorCode === "KNOWLEDGE_OUTBOX_EXHAUSTED" &&
        exhaustedAttemptAfter.status === "FAILED" &&
        exhaustedAttemptAfter.completedAt !== null &&
        exhaustedAttemptAfter.errorCode === "KNOWLEDGE_OUTBOX_EXHAUSTED" &&
        exhaustedInboxAfter.status === "FAILED" &&
        exhaustedInboxAfter.completedAt !== null &&
        exhaustedInboxAfter.errorCode === "KNOWLEDGE_OUTBOX_EXHAUSTED",
      "Exhausted legacy publication state was not terminalized consistently.",
    );

    const [backfilledFactsAfterCutover, backfilledRulesAfterCutover, publishedBackfillItems] =
      await Promise.all([
        prisma.knowledgeV2Fact.findMany({
          where: { tenantId: tenant.id },
          include: { versions: true },
        }),
        prisma.knowledgeV2GuidanceRule.findMany({
          where: { tenantId: tenant.id },
          include: { versions: true },
        }),
        prisma.knowledgePublicationItem.count({
          where: {
            tenantId: tenant.id,
            publicationId: structured.publication.id,
            itemType: { in: ["FACT_VERSION", "GUIDANCE_RULE_VERSION"] },
          },
        }),
      ]);
    assert(
      backfilledFactsAfterCutover.length === 2 &&
        backfilledFactsAfterCutover.every(
          (fact) => fact.latestVersionNumber === 1 && fact.versions.length === 1,
        ) &&
        backfilledRulesAfterCutover.length === 2 &&
        backfilledRulesAfterCutover.every(
          (rule) => rule.latestVersionNumber === 1 && rule.versions.length === 1,
        ) &&
        publishedBackfillItems === 0,
      "Migration-start onboarding drafts did not survive cutover without auto-publication.",
    );

    const activeBeforeProjection = await prisma.activeKnowledgePublication.findUniqueOrThrow({
      where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
      include: { publication: true },
    });
    const [
      documentRevisionCountBeforeProjection,
      structuredPublicationCountBeforeProjection,
      legacyPublicationEventCountBeforeProjection,
      contentEventCountBeforeProjection,
      contentJobCountBeforeProjection,
    ] = await Promise.all([
      prisma.knowledgeV2DocumentRevision.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgePublication.count({
        where: { tenantId: tenant.id, corpusKind: "STRUCTURED_V2" },
      }),
      prisma.knowledgeOutbox.count({
        where: { tenantId: tenant.id, eventType: "knowledge.publication.requested" },
      }),
      prisma.knowledgeOutbox.count({
        where: {
          tenantId: tenant.id,
          eventType: "knowledge.v2.content-reconciliation.requested",
        },
      }),
      prisma.knowledgeJob.count({
        where: { tenantId: tenant.id, payloadRef: { startsWith: "content-reconciliation:" } },
      }),
    ]);
    const legacyDispatcher = new ForbiddenLegacyDispatcher();
    const realContentReconciliation = new KnowledgeV2ContentReconciliationService(prisma);
    const dispatchedContentEvents: string[] = [];
    const contentReconciliation = {
      dispatch: async (eventId: string) => {
        dispatchedContentEvents.push(eventId);
        return realContentReconciliation.dispatch(eventId);
      },
    };
    const onboardingProjection = new KnowledgeV2OnboardingProjectionService();
    const knowledgeService = new KnowledgeService(
      prisma,
      { ragRetrievalMode: "database" } as never,
      {} as never,
      legacyDispatcher as never,
      onboardingProjection,
      contentReconciliation as never,
    );
    const guardedLegacySource = await prisma.businessKnowledgeSource.findUniqueOrThrow({
      where: { id: ordinaryLegacySource.id },
    });
    const [guardedSourceCount, guardedOutboxCount, guardedAuditCount] = await Promise.all([
      prisma.businessKnowledgeSource.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeOutbox.count({ where: { tenantId: tenant.id } }),
      prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    ]);
    await expectHttp(
      () =>
        knowledgeService.create(owner, {
          type: "FAQ",
          title: `Blocked legacy source ${stamp}`,
          content: `Must not persist ${stamp}`,
        }),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
    );
    await expectHttp(
      () =>
        knowledgeService.update(owner, unsafeCompatibilitySource.id, {
          title: `Blocked managed update ${stamp}`,
        }),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
    );
    await expectHttp(
      () => knowledgeService.archive(owner, unsafeCompatibilitySource.id),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
    );
    await expectHttp(
      () =>
        knowledgeService.update(owner, guardedLegacySource.id, {
          title: `Blocked legacy update ${stamp}`,
        }),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
    );
    await expectHttp(
      () => knowledgeService.archive(owner, guardedLegacySource.id),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
    );
    await expectHttp(
      () => knowledgeService.reindex(owner),
      409,
      "KNOWLEDGE_CONFLICT_LEGACY_WRITES_AFTER_CUTOVER",
    );
    const [
      guardedLegacySourceAfter,
      guardedSourceCountAfter,
      guardedOutboxCountAfter,
      guardedAuditCountAfter,
    ] = await Promise.all([
      prisma.businessKnowledgeSource.findUniqueOrThrow({
        where: { id: guardedLegacySource.id },
      }),
      prisma.businessKnowledgeSource.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeOutbox.count({ where: { tenantId: tenant.id } }),
      prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    ]);
    assert(
      guardedSourceCountAfter === guardedSourceCount &&
        guardedOutboxCountAfter === guardedOutboxCount &&
        guardedAuditCountAfter === guardedAuditCount &&
        guardedLegacySourceAfter.title === guardedLegacySource.title &&
        guardedLegacySourceAfter.status === guardedLegacySource.status &&
        guardedLegacySourceAfter.version === guardedLegacySource.version &&
        legacyDispatcher.createCalls === 0 &&
        legacyDispatcher.dispatchCalls === 0,
      "A public legacy writer changed state after structured cutover.",
    );
    const onboardingService = new OnboardingService(
      prisma,
      new BusinessProfileService(prisma, knowledgeService, {} as KnowledgeV2IdempotencyService),
    );
    const projectedCompanyInfo = {
      name: projectedBusinessName,
      description: `Structured description ${stamp}`,
      hours: `Weekdays 09:00-18:00 ${stamp}`,
      avgCheck: `Internal average ${stamp}`,
      servicesCatalog: `Consultation service ${stamp}`,
      availability: `Appointments available ${stamp}`,
      faq: `Frequently asked answer ${stamp}`,
      policies: projectedPolicy,
      escalationRules: projectedEscalation,
    };
    const projectedPatch = {
      currentStep: "launch",
      data: {
        businessType: projectedBusinessType,
        scenario: `support-${stamp}`,
        companyInfo: projectedCompanyInfo,
      },
    };
    let projectedProfileState = await onboardingService.state(owner);
    projectedProfileState = await onboardingService.update(
      owner,
      projectedPatch,
      projectedProfileState.businessProfileEtag,
    );

    const [
      projectedState,
      projectedTenant,
      projectedProfileSource,
      projectedFacts,
      projectedRules,
      projectedSettings,
      projectedContentEvents,
      projectedContentJobs,
      activeAfterProjection,
      documentRevisionCountAfterProjection,
      structuredPublicationCountAfterProjection,
      legacyPublicationEventCountAfterProjection,
      projectionAudit,
    ] = await Promise.all([
      prisma.onboardingState.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }),
      prisma.businessKnowledgeSource.findUniqueOrThrow({
        where: {
          tenantId_sourceKey: {
            tenantId: tenant.id,
            sourceKey: "onboarding:business_profile",
          },
        },
      }),
      prisma.knowledgeV2Fact.findMany({
        where: { tenantId: tenant.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { evidence: true },
          },
        },
        orderBy: { factKey: "asc" },
      }),
      prisma.knowledgeV2GuidanceRule.findMany({
        where: { tenantId: tenant.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: { evidence: true },
          },
        },
        orderBy: { ruleKey: "asc" },
      }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.knowledgeOutbox.findMany({
        where: {
          tenantId: tenant.id,
          eventType: "knowledge.v2.content-reconciliation.requested",
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.knowledgeJob.findMany({
        where: { tenantId: tenant.id, payloadRef: { startsWith: "content-reconciliation:" } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.activeKnowledgePublication.findUniqueOrThrow({
        where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
        include: { publication: true },
      }),
      prisma.knowledgeV2DocumentRevision.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgePublication.count({
        where: { tenantId: tenant.id, corpusKind: "STRUCTURED_V2" },
      }),
      prisma.knowledgeOutbox.count({
        where: { tenantId: tenant.id, eventType: "knowledge.publication.requested" },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: { tenantId: tenant.id, action: "knowledge.v2.onboarding_projected" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const projectedStateData = projectedState.data as Record<string, unknown>;
    const projectedStateCompany = projectedStateData.companyInfo as Record<string, unknown>;
    assert(
      projectedStateCompany.name === projectedBusinessName &&
        projectedStateData.businessType === projectedBusinessType,
      "Post-cutover onboarding state did not commit.",
    );
    assert(
      projectedTenant.name === projectedBusinessName &&
        projectedTenant.businessType === projectedBusinessType,
      `Post-cutover tenant compatibility projection did not commit: ${JSON.stringify({
        expectedName: projectedBusinessName,
        actualName: projectedTenant.name,
        expectedBusinessType: projectedBusinessType,
        actualBusinessType: projectedTenant.businessType,
      })}`,
    );
    assert(
      projectedProfileSource.content.includes(projectedBusinessName) &&
        projectedProfileSource.content.includes(projectedBusinessType),
      "Post-cutover legacy compatibility source did not commit.",
    );
    assert(projectedFacts.length === 9, "Onboarding did not create all structured facts.");
    assert(projectedRules.length === 2, "Onboarding did not create both structured rules.");
    assert(
      projectedFacts.every((fact) => {
        const version = fact.versions[0];
        const ownerConfirmed = version?.riskLevel === "LOW" || version?.riskLevel === "MEDIUM";
        return (
          fact.latestVersionNumber === 1 &&
          fact.fieldType === "TEXT" &&
          version?.lifecycleStatus === "DRAFT" &&
          (ownerConfirmed
            ? version.verificationStatus === "VERIFIED" &&
              version.authority === "OWNER_VERIFIED" &&
              version.verifiedByUserId === ownerUser.id &&
              Boolean(version.verifiedAt)
            : version.verificationStatus === "UNVERIFIED" &&
              version.authority === "MANUAL" &&
              version.verifiedByUserId === null &&
              version.verifiedAt === null) &&
          version.evidence.length === 1 &&
          (version.evidence[0]?.metadata as { origin?: string } | null)?.origin === "onboarding"
        );
      }),
      "Structured fact versions or onboarding evidence are invalid.",
    );
    const projectedFactsByKey = new Map(projectedFacts.map((fact) => [fact.factKey, fact]));
    const availabilityVersion = projectedFactsByKey.get("business/availability-summary")
      ?.versions[0];
    assert(
      projectedFactsByKey.get("business/hours-summary")?.versions[0]?.riskLevel === "MEDIUM" &&
        projectedFactsByKey.get("business/average-check")?.versions[0]?.riskLevel === "MEDIUM" &&
        projectedFactsByKey.get("catalog/summary")?.versions[0]?.riskLevel === "HIGH" &&
        availabilityVersion?.riskLevel === "HIGH" &&
        (availabilityVersion.scope as { audiences?: string[] } | null)?.audiences?.includes(
          "INTERNAL",
        ) === true &&
        (availabilityVersion.scope as { audiences?: string[] } | null)?.audiences?.includes(
          "PUBLIC",
        ) !== true,
      "Onboarding hours, catalog, average-check, or operational availability risk is unsafe.",
    );
    const policyRule = projectedRules.find((rule) => rule.ruleKey === "onboarding/policy");
    const escalationRule = projectedRules.find((rule) => rule.ruleKey === "onboarding/escalation");
    assert(
      policyRule?.versions[0]?.reviewStatus === "DRAFT" &&
        policyRule.versions[0].ruleType === "RESPONSE" &&
        escalationRule?.versions[0]?.reviewStatus === "DRAFT" &&
        escalationRule.versions[0].ruleType === "ESCALATION",
      "Structured onboarding guidance is invalid.",
    );
    assert(
      projectedSettings.draftGeneration === 3,
      "One onboarding batch did not increment the draft generation exactly once.",
    );
    assert(
      projectedContentEvents.length - contentEventCountBeforeProjection === 7 &&
        projectedContentEvents.every((event) => event.status === "PUBLISHED"),
      "Structured onboarding reconciliation events were not accepted.",
    );
    assert(
      projectedContentJobs.length - contentJobCountBeforeProjection === 7 &&
        projectedContentJobs.every((job) => job.status === "SUCCEEDED"),
      "Structured onboarding reconciliation jobs did not complete.",
    );
    const serializedProjectionMetadata = JSON.stringify({
      events: projectedContentEvents.map((event) => event.payload),
      audit: projectionAudit.payload,
    });
    assert(
      !serializedProjectionMetadata.includes(projectedBusinessName) &&
        !serializedProjectionMetadata.includes(projectedBusinessType) &&
        !serializedProjectionMetadata.includes(projectedPolicy) &&
        !serializedProjectionMetadata.includes(projectedEscalation),
      "Raw onboarding content leaked into outbox or audit metadata.",
    );
    assert(
      documentRevisionCountAfterProjection === documentRevisionCountBeforeProjection,
      "Onboarding fabricated another legacy migration snapshot.",
    );
    assert(
      structuredPublicationCountAfterProjection === structuredPublicationCountBeforeProjection &&
        activeAfterProjection.publicationId === activeBeforeProjection.publicationId &&
        activeAfterProjection.sequence === activeBeforeProjection.sequence &&
        activeAfterProjection.etag === activeBeforeProjection.etag &&
        activeAfterProjection.publication.manifestHash ===
          activeBeforeProjection.publication.manifestHash,
      "Onboarding changed the active structured publication.",
    );
    assert(
      legacyPublicationEventCountAfterProjection === legacyPublicationEventCountBeforeProjection &&
        legacyDispatcher.createCalls === 0 &&
        legacyDispatcher.dispatchCalls === 0,
      "Structured cutover still queued or dispatched legacy publication work.",
    );
    assert(
      dispatchedContentEvents.length === 7,
      "Committed structured onboarding events were not dispatched.",
    );

    const [versionCountBeforeReplay, jobCountBeforeReplay, eventCountBeforeReplay] =
      await Promise.all([
        prisma.knowledgeV2FactVersion.count({ where: { tenantId: tenant.id } }).then(
          async (facts) =>
            facts +
            (await prisma.knowledgeV2GuidanceRuleVersion.count({
              where: { tenantId: tenant.id },
            })),
        ),
        prisma.knowledgeJob.count({
          where: { tenantId: tenant.id, payloadRef: { startsWith: "content-reconciliation:" } },
        }),
        prisma.knowledgeOutbox.count({
          where: {
            tenantId: tenant.id,
            eventType: "knowledge.v2.content-reconciliation.requested",
          },
        }),
      ]);
    projectedProfileState = await onboardingService.update(
      owner,
      projectedPatch,
      projectedProfileState.businessProfileEtag,
    );
    const [
      settingsAfterReplay,
      versionCountAfterReplay,
      jobCountAfterReplay,
      eventCountAfterReplay,
    ] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.knowledgeV2FactVersion
        .count({ where: { tenantId: tenant.id } })
        .then(
          async (facts) =>
            facts +
            (await prisma.knowledgeV2GuidanceRuleVersion.count({ where: { tenantId: tenant.id } })),
        ),
      prisma.knowledgeJob.count({
        where: { tenantId: tenant.id, payloadRef: { startsWith: "content-reconciliation:" } },
      }),
      prisma.knowledgeOutbox.count({
        where: {
          tenantId: tenant.id,
          eventType: "knowledge.v2.content-reconciliation.requested",
        },
      }),
    ]);
    assert(
      settingsAfterReplay.draftGeneration === projectedSettings.draftGeneration &&
        versionCountAfterReplay === versionCountBeforeReplay &&
        jobCountAfterReplay === jobCountBeforeReplay &&
        eventCountAfterReplay === eventCountBeforeReplay &&
        dispatchedContentEvents.length === 7,
      "Identical onboarding replay created structured work.",
    );

    const updatedBusinessName = `Projected successor ${stamp}`;
    projectedProfileState = await onboardingService.update(
      owner,
      {
        ...projectedPatch,
        data: {
          ...projectedPatch.data,
          companyInfo: { ...projectedCompanyInfo, name: updatedBusinessName },
        },
      },
      projectedProfileState.businessProfileEtag,
    );
    const updatedNameFact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: { tenantId_factKey: { tenantId: tenant.id, factKey: "business/name" } },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
    });
    const settingsAfterSuccessor = await prisma.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    assert(
      updatedNameFact.latestVersionNumber === 2 &&
        updatedNameFact.versions[1]?.supersedesVersionId === updatedNameFact.versions[0]?.id &&
        settingsAfterSuccessor.draftGeneration === projectedSettings.draftGeneration + 1,
      "Changed onboarding field did not append one structured successor.",
    );

    const manualCorrection = `Manually corrected ${stamp}`;
    const manualKnowledgeAfterProjection = new KnowledgeV2Service(prisma, idempotency);
    await manualKnowledgeAfterProjection.updateFact(
      owner,
      updatedNameFact.id,
      {
        normalizedValue: manualCorrection,
        displayValue: manualCorrection,
        changeReason: "Owner corrected the onboarding value in Knowledge.",
      },
      `manual-correction-${stamp}`,
      [strongKnowledgeV2Etag("fact", updatedNameFact.id, updatedNameFact.etag)],
    );
    projectedProfileState = await onboardingService.update(
      owner,
      {
        ...projectedPatch,
        data: {
          ...projectedPatch.data,
          companyInfo: {
            ...projectedCompanyInfo,
            name: `Later onboarding answer ${stamp}`,
          },
        },
      },
      projectedProfileState.businessProfileEtag,
    );
    const [protectedNameFact, protectedNameReview, settingsAfterOwnershipConflict] =
      await Promise.all([
        prisma.knowledgeV2Fact.findUniqueOrThrow({
          where: { tenantId_factKey: { tenantId: tenant.id, factKey: "business/name" } },
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
              tenantId: tenant.id,
              reviewKey: ["onboarding-projection-v1", "ownership", "FACT", updatedNameFact.id].join(
                ":",
              ),
            },
          },
        }),
        prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      ]);
    assert(
      protectedNameFact.latestVersionNumber === 3 &&
        protectedNameFact.versions[0]?.displayValue === manualCorrection &&
        protectedNameFact.versions[0].evidence.some(
          (evidence) =>
            (evidence.sourceReference as { origin?: string } | null)?.origin === "knowledge_editor",
        ) &&
        protectedNameReview.status === "OPEN" &&
        protectedNameReview.riskLevel === "HIGH" &&
        protectedNameReview.suggestedAction === "DISMISS" &&
        settingsAfterOwnershipConflict.draftGeneration === projectedSettings.draftGeneration + 3,
      "A manual Knowledge successor was overwritten or produced non-blocking review work.",
    );

    const rollbackState = await prisma.onboardingState.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    const rollbackTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    const rollbackSource = await prisma.businessKnowledgeSource.findUniqueOrThrow({
      where: {
        tenantId_sourceKey: {
          tenantId: tenant.id,
          sourceKey: "onboarding:business_profile",
        },
      },
    });
    const rollbackCounts = await Promise.all([
      prisma.knowledgeV2FactVersion.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeV2GuidanceRuleVersion.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeJob.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeOutbox.count({ where: { tenantId: tenant.id } }),
      prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    ]);
    const dispatchCountBeforeRollback = dispatchedContentEvents.length;
    const failingProjection = {
      projectInTransaction: async (
        tx: Prisma.TransactionClient,
        requestContext: RequestContext,
        previousData: Record<string, unknown>,
        nextData: Record<string, unknown>,
      ) => {
        await onboardingProjection.projectInTransaction(tx, requestContext, previousData, nextData);
        throw new Error("FORCED_ONBOARDING_PROJECTION_FAILURE");
      },
    };
    const failingKnowledgeService = new KnowledgeService(
      prisma,
      { ragRetrievalMode: "database" } as never,
      {} as never,
      legacyDispatcher as never,
      failingProjection as never,
      contentReconciliation as never,
    );
    const failingOnboardingService = new OnboardingService(
      prisma,
      new BusinessProfileService(
        prisma,
        failingKnowledgeService,
        {} as KnowledgeV2IdempotencyService,
      ),
    );
    let projectionRejected = false;
    try {
      await failingOnboardingService.update(
        owner,
        {
          ...projectedPatch,
          data: {
            ...projectedPatch.data,
            companyInfo: { ...projectedCompanyInfo, name: `Must roll back ${stamp}` },
          },
        },
        projectedProfileState.businessProfileEtag,
      );
    } catch {
      projectionRejected = true;
    }
    assert(projectionRejected, "Forced structured projection failure did not reject onboarding.");
    const [
      stateAfterRollback,
      tenantAfterRollback,
      sourceAfterRollback,
      settingsAfterRollback,
      activeAfterRollback,
    ] = await Promise.all([
      prisma.onboardingState.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }),
      prisma.businessKnowledgeSource.findUniqueOrThrow({
        where: {
          tenantId_sourceKey: {
            tenantId: tenant.id,
            sourceKey: "onboarding:business_profile",
          },
        },
      }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.activeKnowledgePublication.findUniqueOrThrow({
        where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
      }),
    ]);
    const countsAfterRollback = await Promise.all([
      prisma.knowledgeV2FactVersion.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeV2GuidanceRuleVersion.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeJob.count({ where: { tenantId: tenant.id } }),
      prisma.knowledgeOutbox.count({ where: { tenantId: tenant.id } }),
      prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    ]);
    assert(
      canonicalKnowledgeV2Hash(stateAfterRollback.data) ===
        canonicalKnowledgeV2Hash(rollbackState.data) &&
        tenantAfterRollback.name === rollbackTenant.name &&
        tenantAfterRollback.businessType === rollbackTenant.businessType &&
        sourceAfterRollback.version === rollbackSource.version &&
        sourceAfterRollback.content === rollbackSource.content &&
        settingsAfterRollback.draftGeneration === settingsAfterOwnershipConflict.draftGeneration &&
        rollbackCounts.every((count, index) => count === countsAfterRollback[index]) &&
        activeAfterRollback.publicationId === activeBeforeProjection.publicationId &&
        activeAfterRollback.etag === activeBeforeProjection.etag &&
        dispatchedContentEvents.length === dispatchCountBeforeRollback,
      "Structured projection failure escaped its onboarding transaction.",
    );

    let legacyCalls = 0;
    let structuredCalls = 0;
    const queryHashKeyring = createKnowledgeV2QueryHashKeyring({
      activeKeyId: "legacy-migration-query-key-v1",
      keys: { "legacy-migration-query-key-v1": new Uint8Array(32).fill(109) },
    });
    const runtime = new KnowledgeRuntimeRetriever(
      prisma,
      {
        retrieve: async () => {
          legacyCalls += 1;
          return {
            status: "unavailable" as const,
            reason: "qdrant_error" as const,
            retryable: true,
            evidence: [] as [],
            diagnostics: {
              backend: "database" as const,
              candidateCount: 0,
              hydratedCount: 0,
              durationMs: 0,
            },
          };
        },
      } as KnowledgeRetriever,
      {
        retrievePublication: async () => {
          structuredCalls += 1;
          return {
            status: "unavailable" as const,
            reason: "QDRANT_UNAVAILABLE" as const,
            retryable: true,
            diagnostics: {
              backend: "qdrant" as const,
              corpusKind: "STRUCTURED_V2" as const,
              candidateCount: 0,
              hydratedCount: 0,
              selectedCount: 0,
              durationMs: 0,
              retrievalPolicyVersion: "structured-v2-v1",
              rerankerVersion: null,
            },
          };
        },
      } as unknown as KnowledgeV2Retriever,
      queryHashKeyring,
    );
    const runtimeInput = {
      tenantId: tenant.id,
      query: "test",
      limit: 3,
      graphVersion: "smoke-v1",
      authorization: {
        locale: "en",
        channelType: "WEBSITE" as const,
        audience: "PUBLIC" as const,
        classifications: ["PUBLIC" as const],
        queryClassification: "PUBLIC" as const,
      },
    };
    await runtime.retrieve(runtimeInput);
    await runtime.retrieve({ ...runtimeInput, publicationId: legacyPublication.id });
    assert(
      structuredCalls === 1 && legacyCalls === 1,
      "Runtime mixed corpora or ignored the captured legacy publication.",
    );

    const transitionTenant = await prisma.tenant.create({
      data: {
        name: "Transition truth",
        slug: `migration-transition-${stamp}`,
        businessType: "services",
        settings: { locale: "en" },
      },
    });
    tenantIds.push(transitionTenant.id);
    await prisma.membership.create({
      data: { tenantId: transitionTenant.id, userId: ownerUser.id, role: "OWNER" },
    });
    await prisma.onboardingState.create({
      data: {
        tenantId: transitionTenant.id,
        data: {
          businessType: "services",
          companyInfo: { name: "Transition truth" },
        },
      },
    });
    const transitionOwner = context(transitionTenant, ownerUser, "OWNER");
    const transitionService = new KnowledgeV2MigrationService(prisma, idempotency);
    const transitionStart = await transitionService.start(
      transitionOwner,
      { batchSize: 2 },
      `transition-start-${stamp}`,
    );
    const transitionReady = await transitionService.resume(
      transitionOwner,
      transitionStart.resource.id,
      { generation: transitionStart.resource.generation, batchSize: 2 },
      `transition-resume-${stamp}`,
    );
    assert(
      transitionReady.resource.status === "READY",
      "Transition migration did not become READY.",
    );
    const transitionPublication = await createStructuredPublication(
      prisma,
      transitionTenant.id,
      ownerUser.id,
      transitionStart.resource.id,
    );
    const transitionVerifier = new CutoverIndexVerifier(
      transitionPublication.snapshot.id,
      transitionPublication.pointCount,
    );
    const transitionCutover = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      transitionVerifier as unknown as KnowledgeV2IndexPreparationService,
    );
    await prisma.knowledgeV2Settings.create({
      data: { tenantId: transitionTenant.id, draftGeneration: 2 },
    });
    const manuallyCuratedName = `Manually curated ${stamp}`;
    const manualKnowledge = new KnowledgeV2Service(prisma, idempotency);
    const manualNameFact = await manualKnowledge.createFact(
      transitionOwner,
      {
        factKey: "business/name",
        entityType: "BUSINESS_PROFILE",
        fieldType: "TEXT",
        normalizedValue: manuallyCuratedName,
        displayValue: manuallyCuratedName,
        locale: "en",
        localeBehavior: "LOCALE_SPECIFIC",
        riskLevel: "LOW",
        authority: "MANUAL",
      },
      `transition-manual-name-${stamp}`,
    );
    const transitionInput = {
      migrationId: transitionStart.resource.id,
      migrationGeneration: transitionStart.resource.generation,
      selectorGeneration: 1,
    };
    await expectHttp(
      () =>
        transitionCutover.cutover(
          transitionOwner,
          transitionInput,
          `transition-draft-fence-${stamp}`,
        ),
      409,
      "KNOWLEDGE_CONFLICT_STRUCTURED_CUTOVER_BLOCKED",
    );
    assert(
      transitionVerifier.calls === 0,
      "Stale structured draft verification reached the physical index.",
    );
    const revalidatedGeneration = await prisma.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: transitionTenant.id },
      select: { draftGeneration: true },
    });
    await prisma.knowledgeV2PublicationValidation.updateMany({
      where: {
        tenantId: transitionTenant.id,
        publicationId: transitionPublication.publication.id,
      },
      data: {
        candidateVersion: revalidatedGeneration.draftGeneration,
        validUntil: new Date(Date.now() + 600_000),
      },
    });

    const transitionLegacyDispatcher = new RecordingLegacyDispatcher();
    const transitionContentReconciliation = new KnowledgeV2ContentReconciliationService(prisma);
    const transitionKnowledge = new KnowledgeService(
      prisma,
      { ragRetrievalMode: "database" } as never,
      {} as never,
      transitionLegacyDispatcher as never,
      new KnowledgeV2OnboardingProjectionService(),
      transitionContentReconciliation,
    );
    const transitionOnboarding = new OnboardingService(
      prisma,
      new BusinessProfileService(prisma, transitionKnowledge, {} as KnowledgeV2IdempotencyService),
    );
    let verificationStartedResolve!: () => void;
    let verificationReleaseResolve!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      verificationStartedResolve = resolve;
    });
    const verificationRelease = new Promise<void>((resolve) => {
      verificationReleaseResolve = resolve;
    });
    const overlappingVerifier = {
      preparePublication: async () => {
        verificationStartedResolve();
        await verificationRelease;
        return {
          snapshotId: transitionPublication.snapshot.id,
          expectedPointCount: transitionPublication.pointCount,
          observedPointCount: transitionPublication.pointCount,
          reused: true,
        };
      },
    };
    const overlappingCutover = new KnowledgeV2MigrationService(
      prisma,
      idempotency,
      overlappingVerifier as unknown as KnowledgeV2IndexPreparationService,
    );
    const overlappingAttempt = overlappingCutover.cutover(
      transitionOwner,
      transitionInput,
      `transition-overlap-${stamp}`,
    );
    await verificationStarted;
    try {
      const transitionProfileState = await transitionOnboarding.state(transitionOwner);
      await transitionOnboarding.update(
        transitionOwner,
        {
          currentStep: "company",
          data: {
            businessType: "consulting",
            companyInfo: {
              name: "Transition truth",
              description: `Must be represented ${stamp}`,
            },
          },
        },
        transitionProfileState.businessProfileEtag,
      );
    } finally {
      verificationReleaseResolve();
    }
    await expectHttp(() => overlappingAttempt, 409, "KNOWLEDGE_CONFLICT_LEGACY_MIGRATION_STALE");
    const [
      transitionSelector,
      transitionFact,
      transitionDescription,
      transitionReview,
      transitionSettings,
      transitionEventCount,
    ] = await Promise.all([
      prisma.knowledgeCorpusSelector.findUniqueOrThrow({
        where: { tenantId: transitionTenant.id },
      }),
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: {
          tenantId_factKey: {
            tenantId: transitionTenant.id,
            factKey: "business/name",
          },
        },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      }),
      prisma.knowledgeV2Fact.findUniqueOrThrow({
        where: {
          tenantId_factKey: {
            tenantId: transitionTenant.id,
            factKey: "business/description",
          },
        },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      }),
      prisma.knowledgeV2ReviewItem.findUniqueOrThrow({
        where: {
          tenantId_reviewKey: {
            tenantId: transitionTenant.id,
            reviewKey: [
              "onboarding-projection-v1",
              "ownership",
              "FACT",
              manualNameFact.resource.id,
            ].join(":"),
          },
        },
      }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: transitionTenant.id },
      }),
      prisma.knowledgeOutbox.count({
        where: {
          tenantId: transitionTenant.id,
          eventType: "knowledge.v2.content-reconciliation.requested",
        },
      }),
    ]);
    assert(
      transitionSelector.corpusKind === "LEGACY_V1" &&
        transitionFact.latestVersionNumber === 1 &&
        transitionFact.versions[0]?.displayValue === manuallyCuratedName &&
        transitionDescription.versions[0]?.displayValue === `Must be represented ${stamp}` &&
        transitionReview.factId === manualNameFact.resource.id &&
        transitionReview.status === "OPEN" &&
        transitionReview.reason === "CONFLICTING_VALUES" &&
        transitionSettings.draftGeneration === 4 &&
        transitionEventCount > 0 &&
        transitionLegacyDispatcher.createCalls === 1 &&
        transitionLegacyDispatcher.dispatchCalls === 1,
      "Overlapping onboarding save was omitted, took over manual Knowledge, or switched corpus.",
    );
    await prisma.knowledgeV2ReviewItem.update({
      where: { id: transitionReview.id },
      data: {
        status: "DISMISSED",
        resolutionAction: "DISMISS",
        resolutionSummaryHash: canonicalKnowledgeV2Hash({ reason: "ownership accepted" }),
        resolvedByUserId: ownerUser.id,
        resolvedAt: new Date(),
      },
    });
    await transitionOnboarding.update(transitionOwner, { currentStep: "launch" });
    const [resolvedOwnershipReview, settingsAfterUnrelatedSave] = await Promise.all([
      prisma.knowledgeV2ReviewItem.findUniqueOrThrow({ where: { id: transitionReview.id } }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: transitionTenant.id } }),
    ]);
    assert(
      resolvedOwnershipReview.status === "DISMISSED" &&
        settingsAfterUnrelatedSave.draftGeneration === transitionSettings.draftGeneration,
      "An unrelated onboarding save reopened a resolved ownership review.",
    );

    const staleTenant = await prisma.tenant.create({
      data: {
        name: "Version tenant",
        slug: `migration-version-${stamp}`,
        settings: { version: 1 },
      },
    });
    tenantIds.push(staleTenant.id);
    await prisma.membership.create({
      data: { tenantId: staleTenant.id, userId: ownerUser.id, role: "OWNER" },
    });
    await prisma.businessKnowledgeSource.create({
      data: {
        tenantId: staleTenant.id,
        type: "FAQ",
        status: "ACTIVE",
        sourceKey: "manual:version-seven",
        title: "Version seven",
        content: "Current answer only",
        version: 7,
      },
    });
    const staleOwner = context(staleTenant, ownerUser, "OWNER");
    const staleService = new KnowledgeV2MigrationService(prisma, idempotency);
    const staleStart = await staleService.start(
      staleOwner,
      { batchSize: 2 },
      `stale-start-${stamp}`,
    );
    await prisma.tenant.update({
      where: { id: staleTenant.id },
      data: { settings: { version: 2 } },
    });
    await expectHttp(
      () =>
        staleService.resume(
          staleOwner,
          staleStart.resource.id,
          { generation: staleStart.resource.generation, batchSize: 2 },
          `stale-resume-${stamp}`,
        ),
      409,
    );
    const stale = await prisma.knowledgeV2LegacyMigration.findUniqueOrThrow({
      where: { id: staleStart.resource.id },
      include: { job: true },
    });
    assert(
      stale.status === "STALE" && stale.job.status === "FAILED",
      "Changed manifest was not terminally fenced.",
    );
    const staleAttempt = await prisma.knowledgeJobAttempt.findFirstOrThrow({
      where: { tenantId: staleTenant.id, jobId: stale.jobId },
      orderBy: { attempt: "desc" },
    });
    assert(staleAttempt.status === "FAILED", "Stale migration attempt remained non-terminal.");
    const replacement = await staleService.start(
      staleOwner,
      { batchSize: 2 },
      `replacement-${stamp}`,
    );
    const replacementReady = await staleService.resume(
      staleOwner,
      replacement.resource.id,
      { generation: replacement.resource.generation, batchSize: 2 },
      `replacement-resume-${stamp}`,
    );
    assert(replacementReady.resource.status === "READY", "Replacement migration did not complete.");
    const versionSeven = await prisma.knowledgeV2DocumentRevision.findFirstOrThrow({
      where: { tenantId: staleTenant.id, legacySourceVersion: 7 },
    });
    assert(
      versionSeven.revisionNumber === 1,
      "Legacy counter was incorrectly turned into revision history.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        zeroLegacySources: first.resource.expectedSourceCount,
        blockedConflicts: migrated.resource.conflictCount,
        physicalVerifierCalls: verifier.calls,
        selectorCorpus: cutover.resource.corpusKind,
        staleStatus: stale.status,
        importedLegacyVersion: versionSeven.legacySourceVersion,
        importedRevisionNumber: versionSeven.revisionNumber,
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
