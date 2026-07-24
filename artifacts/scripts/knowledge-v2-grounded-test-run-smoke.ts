import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@leadvirt/db";
import { HttpException } from "@nestjs/common";
import { type GroundedAnswerProvider } from "@leadvirt/ai";
import {
  createKnowledgeV2QueryHashKeyring,
  KnowledgeRuntimeRetriever,
  KnowledgeV2GroundedAnswerService,
  KnowledgeV2GroundedOutputPolicy,
  KnowledgeV2Retriever,
  PrismaKnowledgeV2DraftSnapshotResolver,
  PrismaKnowledgeV2ModelProcessorAuthorizer,
  hashKnowledgeValue,
  knowledgeV2StructuredAuthorizationFingerprint,
  resolveKnowledgeV2StructuredScope,
  stableKnowledgeValue,
} from "@leadvirt/knowledge";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import { KnowledgeV2CapabilityService } from "../../apps/api/src/modules/knowledge/knowledge-v2-capability.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import {
  assertKnowledgeV2PublicationEvaluationGate,
  knowledgeV2CurrentEvaluationSet,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-evaluation-gate.js";
import { KnowledgeV2PublicationDispatcherService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication-dispatcher.service.js";
import { KnowledgeV2PublicationService } from "../../apps/api/src/modules/knowledge/knowledge-v2-publication.service.js";
import {
  KnowledgeV2TestRunService,
  knowledgeV2EvaluationAggregate,
  knowledgeV2ForbiddenClaimPasses,
} from "../../apps/api/src/modules/knowledge/knowledge-v2-test-run.service.js";
import { KnowledgeV2TestService } from "../../apps/api/src/modules/knowledge/knowledge-v2-test.service.js";

const prisma = new PrismaClient();
const policyVersion = "grounded-test-model-v1";
const promptPolicyVersion = "grounded-test-prompt-v1";
const identity = {
  provider: "grounded-test-provider",
  model: "grounded-test-model",
  version: "v1",
  region: "test-region",
};
const answerText = "Shipping takes 2 days.";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function modelPolicy() {
  return {
    schemaVersion: 1,
    policyVersion,
    approved: true,
    promptPolicyVersion,
    groundedAnswer: {
      ...identity,
      allowedClassifications: ["PUBLIC", "INTERNAL", "CUSTOMER_PERSONAL"],
    },
  } satisfies Prisma.InputJsonObject;
}

function providerOutput(evidenceKey: string, duplicate = false) {
  return {
    schemaVersion: 1,
    claims: [
      {
        claimId: "shipping-claim",
        text: answerText,
        evidenceKeys: [evidenceKey],
        exactValueText: null,
      },
    ],
    citations: [
      { claimId: "shipping-claim", evidenceKey },
      ...(duplicate ? [{ claimId: "shipping-claim", evidenceKey }] : []),
    ],
  };
}

async function cleanupTenant(tenantId: string | null, userId: string | null) {
  if (!tenantId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.$executeRawUnsafe(
      'DELETE FROM "KnowledgeJobAttempt" WHERE "jobId" IN (SELECT "id" FROM "KnowledgeJob" WHERE "tenantId" = $1)',
      tenantId,
    );
    const tables = [
      "KnowledgeV2Citation",
      "KnowledgeV2RetrievalCandidate",
      "KnowledgeV2EvaluationResultEvidence",
      "KnowledgeV2EvaluationMetric",
      "KnowledgeV2RetrievalTrace",
      "KnowledgeV2EvidenceReference",
      "KnowledgeV2EvaluationResult",
      "KnowledgeV2Feedback",
      "KnowledgeV2EvaluationRun",
      "KnowledgeV2TestExpectation",
      "KnowledgeV2TestCaseVersion",
      "KnowledgeV2TestCase",
      "KnowledgePublicationCapability",
      "KnowledgeV2RequirementEvaluation",
      "KnowledgeV2RequirementDefinition",
      "KnowledgeV2Capability",
      "KnowledgeOutbox",
      "KnowledgeJob",
      "KnowledgeV2IdempotencyRecord",
      "KnowledgeV2PublicationValidation",
      "ActiveKnowledgePublication",
      "KnowledgePublicationItem",
      "KnowledgePublication",
      "KnowledgeV2IndexSnapshotItem",
      "KnowledgeIndexSnapshotItem",
      "KnowledgeIndexSnapshot",
      "KnowledgeV2GuidanceRuleVersion",
      "KnowledgeV2GuidanceRule",
      "KnowledgeV2FactVersion",
      "KnowledgeV2Fact",
      "KnowledgeV2Entity",
      "KnowledgeV2Settings",
      "TenantOperationalAuthorizationState",
      "AuditLog",
      "Membership",
    ];
    for (const table of tables) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
    }
    await tx.$executeRawUnsafe('DELETE FROM "Tenant" WHERE "id" = $1', tenantId);
    if (userId) await tx.$executeRawUnsafe('DELETE FROM "User" WHERE "id" = $1', userId);
  });
}

async function main() {
  let tenantId: string | null = null;
  let userId: string | null = null;
  const storageRoot = await mkdtemp(join(tmpdir(), "leadvirt-grounded-test-"));
  try {
    const tenant = await prisma.tenant.create({
      data: { name: "Grounded Test", slug: `grounded-test-${randomUUID()}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { email: `grounded-${randomUUID()}@example.test`, name: "Grounded Tester" },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId, userId, role: "ADMIN" },
    });
    await prisma.knowledgeV2Settings.create({
      data: {
        tenantId,
        retrievalProcessorPolicy: {
          schemaVersion: 1,
          policyVersion: "grounded-test-retrieval-v1",
          approved: true,
        },
        modelProcessorPolicy: modelPolicy(),
      },
    });
    const entity = await prisma.knowledgeV2Entity.create({
      data: { tenantId, entityType: "BUSINESS", entityKey: "business/default" },
    });
    const fact = await prisma.knowledgeV2Fact.create({
      data: {
        tenantId,
        entityId: entity.id,
        entityType: "BUSINESS",
        factKey: "shipping/time",
        fieldType: "TEXT",
        latestVersionNumber: 1,
      },
    });
    const normalizedValue = { value: answerText } satisfies Prisma.InputJsonObject;
    const factScope = {
      brandIds: [],
      locationIds: [],
      channelTypes: [],
      assistantIds: [],
      audiences: ["PUBLIC"],
      segments: [],
      locales: [],
    } satisfies Prisma.InputJsonObject;
    const immutableHash = sha256(stableKnowledgeValue(normalizedValue));
    const factVersion = await prisma.knowledgeV2FactVersion.create({
      data: {
        tenantId,
        factId: fact.id,
        versionNumber: 1,
        normalizedValue,
        displayValue: answerText,
        scope: factScope,
        riskLevel: "LOW",
        authority: "MANUAL",
        lifecycleStatus: "DRAFT",
        verificationStatus: "VERIFIED",
        immutableHash,
        verifiedByUserId: userId,
        verifiedAt: new Date(),
      },
    });
    const factScopeBinding = resolveKnowledgeV2StructuredScope(factScope, null);
    assert.ok(factScopeBinding);
    const authorizationFingerprint = knowledgeV2StructuredAuthorizationFingerprint({
      itemType: "FACT_VERSION",
      binding: factScopeBinding,
      riskLevel: "LOW",
      authority: { authority: "MANUAL", verifiedByUserId: userId },
      evidence: [],
    });
    const businessNameValue = { value: "Grounded Test" } satisfies Prisma.InputJsonObject;
    const capabilityScope = {
      audiences: ["INTERNAL"],
    } satisfies Prisma.InputJsonObject;
    const capabilityScopeBinding = resolveKnowledgeV2StructuredScope(capabilityScope, null);
    assert.ok(capabilityScopeBinding);
    const businessNameFact = await prisma.knowledgeV2Fact.create({
      data: {
        tenantId,
        entityId: entity.id,
        entityType: "BUSINESS",
        factKey: "business/name",
        fieldType: "TEXT",
        latestVersionNumber: 1,
      },
    });
    const businessNameVersion = await prisma.knowledgeV2FactVersion.create({
      data: {
        tenantId,
        factId: businessNameFact.id,
        versionNumber: 1,
        normalizedValue: businessNameValue,
        displayValue: businessNameValue.value,
        scope: capabilityScope,
        riskLevel: "LOW",
        authority: "MANUAL",
        lifecycleStatus: "DRAFT",
        verificationStatus: "VERIFIED",
        immutableHash: sha256(stableKnowledgeValue(businessNameValue)),
        verifiedByUserId: userId,
        verifiedAt: new Date(),
      },
    });
    const businessNameAuthorizationFingerprint = knowledgeV2StructuredAuthorizationFingerprint({
      itemType: "FACT_VERSION",
      binding: capabilityScopeBinding,
      riskLevel: "LOW",
      authority: { authority: "MANUAL", verifiedByUserId: userId },
      evidence: [],
    });
    const escalationCondition = {
      kind: "ALL",
      conditions: [],
    } satisfies Prisma.InputJsonObject;
    const escalationInstruction = "Escalate unresolved questions to a human specialist.";
    const escalationRule = await prisma.knowledgeV2GuidanceRule.create({
      data: {
        tenantId,
        ruleKey: "support/escalation",
        title: "Human escalation",
        ruleType: "ESCALATION",
        latestVersionNumber: 1,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    const escalationVersion = await prisma.knowledgeV2GuidanceRuleVersion.create({
      data: {
        tenantId,
        guidanceRuleId: escalationRule.id,
        versionNumber: 1,
        title: escalationRule.title,
        ruleType: escalationRule.ruleType,
        conditionAst: escalationCondition,
        instruction: escalationInstruction,
        priority: 100,
        tieBreakKey: "support/escalation",
        scope: capabilityScope,
        riskLevel: "LOW",
        reviewStatus: "APPROVED",
        immutableHash: sha256(
          stableKnowledgeValue({
            conditionAst: escalationCondition,
            instruction: escalationInstruction,
            ruleType: escalationRule.ruleType,
          }),
        ),
        createdByUserId: userId,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
    });
    const escalationAuthorizationFingerprint = knowledgeV2StructuredAuthorizationFingerprint({
      itemType: "GUIDANCE_RULE_VERSION",
      binding: capabilityScopeBinding,
      riskLevel: "LOW",
      authority: { requiredApproverRole: null, approvedByUserId: userId },
      evidence: [],
    });
    const rollbackPublicationItems = [
      {
        itemType: "FACT_VERSION" as const,
        itemId: factVersion.id,
        itemVersionHash: factVersion.immutableHash,
        factVersionId: factVersion.id,
        guidanceRuleVersionId: null,
        scope: factScope,
        authorizationFingerprint,
      },
      {
        itemType: "FACT_VERSION" as const,
        itemId: businessNameVersion.id,
        itemVersionHash: businessNameVersion.immutableHash,
        factVersionId: businessNameVersion.id,
        guidanceRuleVersionId: null,
        scope: capabilityScopeBinding.scope as unknown as Prisma.InputJsonObject,
        authorizationFingerprint: businessNameAuthorizationFingerprint,
      },
      {
        itemType: "GUIDANCE_RULE_VERSION" as const,
        itemId: escalationVersion.id,
        itemVersionHash: escalationVersion.immutableHash,
        factVersionId: null,
        guidanceRuleVersionId: escalationVersion.id,
        scope: capabilityScopeBinding.scope as unknown as Prisma.InputJsonObject,
        authorizationFingerprint: escalationAuthorizationFingerprint,
      },
    ];
    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 2,
        status: "READY",
        manifestHash: sha256(`publication:${tenantId}`),
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        readyAt: new Date(),
      },
    });
    await prisma.knowledgePublicationItem.createMany({
      data: rollbackPublicationItems.map((item) => ({
        tenantId,
        publicationId: publication.id,
        corpusKind: "STRUCTURED_V2" as const,
        ...item,
      })),
    });
    await prisma.knowledgePublication.update({
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
    const rollbackSource = await prisma.knowledgePublication.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "READY",
        manifestHash: sha256(`rollback-source:${tenantId}`),
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        readyAt: new Date(),
      },
    });
    await prisma.knowledgePublicationItem.createMany({
      data: rollbackPublicationItems.map((item) => ({
        tenantId,
        publicationId: rollbackSource.id,
        corpusKind: "STRUCTURED_V2" as const,
        ...item,
      })),
    });
    await prisma.knowledgePublication.update({
      where: { id: rollbackSource.id },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });
    const draftCandidateId = `candidate-${randomUUID()}`;
    const draftCandidateItems = [
      {
        itemType: "FACT_VERSION",
        itemId: factVersion.id,
        itemVersionHash: factVersion.immutableHash,
        scope: factScope,
        authorizationFingerprint,
      },
    ];
    const draftCandidateManifestHash = hashKnowledgeValue(
      stableKnowledgeValue(draftCandidateItems),
    );
    const evidenceKey = `v2:fact:${factVersion.id}:${factVersion.immutableHash}`;
    const queryHashes = createKnowledgeV2QueryHashKeyring({
      activeKeyId: "grounded-test-query-v1",
      keys: { "grounded-test-query-v1": randomBytes(32) },
    });
    const content = new Map<string, Uint8Array>();
    const restrictedStore = {
      async put(input: { identity: string; content: Uint8Array }) {
        const reference = `memory:${input.identity}`;
        const created = !content.has(reference);
        content.set(reference, input.content);
        return { reference, hash: sha256(Buffer.from(input.content).toString("utf8")), created };
      },
      async delete(reference: string) {
        content.delete(reference);
      },
    };
    const structured = new KnowledgeV2Retriever(
      prisma,
      {
        hybridClient: {} as never,
        denseProvider: { schema: { provider: "test", model: "test" } } as never,
        sparseEncoder: { schema: { provider: "test", model: "test" } } as never,
        reranker: { version: "test-reranker" } as never,
        restrictedStore: restrictedStore as never,
        queryHashKeyring: queryHashes,
        draftResolver: new PrismaKnowledgeV2DraftSnapshotResolver(prisma),
      },
      {
        candidateLimit: 20,
        documentLimit: 4,
        maximumChunksPerDocument: 2,
        maximumFacts: 12,
        maximumGuidance: 12,
        minimumRerankScore: 0,
        maximumParentCharacters: 4_000,
        retentionMs: 60_000,
        graphVersion: "grounded-test-v1",
      },
    );
    const runtime = new KnowledgeRuntimeRetriever(
      prisma,
      {
        retrieve: async () => {
          throw new Error("Legacy retrieval must not run.");
        },
      } as never,
      structured,
      queryHashes,
    );

    const providerCalls = new Map<string, number>();
    const provider: GroundedAnswerProvider = {
      identity,
      async generate(input) {
        providerCalls.set(input.question, (providerCalls.get(input.question) ?? 0) + 1);
        if (input.question.includes("race") && input.purpose === "GENERATE") {
          await prisma.knowledgeV2Fact.update({
            where: { id: fact.id },
            data: { deletedAt: new Date() },
          });
        }
        if (input.question.includes("repair")) return providerOutput(evidenceKey, true);
        if (input.question.includes("arbitrary") && input.purpose === "GENERATE") {
          return { ...providerOutput(evidenceKey), finalText: "UNTRUSTED RAW PROVIDER OUTPUT" };
        }
        return providerOutput(evidenceKey);
      },
    };
    const authorizer = new PrismaKnowledgeV2ModelProcessorAuthorizer(prisma, {
      policyVersion,
      promptPolicyVersion,
      ...identity,
      maxClassification: "CUSTOMER_PERSONAL",
    });
    const grounded = new KnowledgeV2GroundedAnswerService(
      provider,
      authorizer,
      new KnowledgeV2GroundedOutputPolicy(),
      queryHashes,
    );
    const encryptionKey = randomBytes(32).toString("base64");
    const config = {
      knowledgeV2GroundedPromptPolicyVersion: promptPolicyVersion,
      knowledgeV2GroundedAnswerProvider: identity.provider,
      knowledgeV2GroundedAnswerModel: identity.model,
      knowledgeV2RerankerProvider: "test",
      knowledgeV2RerankerModel: "test",
      knowledgeV2RerankerVersion: "v1",
      knowledgeV2RerankerRegion: "test-region",
      knowledgeObjectStorePath: storageRoot,
      knowledgeArtifactEncryptionKey: encryptionKey,
      knowledgeArtifactEncryptionKeyId: "grounded-test-key",
    };
    const idempotency = new KnowledgeV2IdempotencyService(prisma as never);
    const capabilityService = new KnowledgeV2CapabilityService(prisma as never, idempotency);
    const testService = new KnowledgeV2TestService(
      prisma as never,
      idempotency,
      config as never,
      queryHashes,
    );
    const service = new KnowledgeV2TestRunService(
      prisma as never,
      config as never,
      idempotency,
      testService,
      runtime,
      grounded,
      queryHashes,
    );
    const publicationService = new KnowledgeV2PublicationService(
      prisma as never,
      idempotency,
      service,
      {
        preparePublication: async () => ({
          snapshotId: null,
          expectedPointCount: 0,
          observedPointCount: 0,
        }),
      } as never,
      capabilityService,
    );
    const publicationDispatcher = new KnowledgeV2PublicationDispatcherService(
      prisma as never,
      publicationService,
    );
    const context: RequestContext = {
      tenantId,
      userId,
      role: "ADMIN",
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
    await capabilityService.applyStarterPreset(context, `grounded-starter-preset-${randomUUID()}`);
    const draftValidation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        candidateId: draftCandidateId,
        candidateVersion: 1,
        candidateManifestHash: draftCandidateManifestHash,
        candidateItems: draftCandidateItems,
        status: "PASSED",
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60_000),
        validatedByUserId: userId,
      },
    });
    const internals = service as unknown as { drain(): Promise<void> };
    const realDrain = internals.drain.bind(service);
    let drainEnabled = false;
    internals.drain = () => (drainEnabled ? realDrain() : Promise.resolve());
    const drain = async () => {
      drainEnabled = true;
      try {
        for (let attempt = 0; attempt < 10; attempt += 1) await internals.drain();
      } finally {
        drainEnabled = false;
      }
    };
    const run = async (question: string, target: "ACTIVE" | "DRAFT" = "ACTIVE") => {
      const queued = await service.createRun(
        context,
        {
          target: "ACTIVE",
          question,
          locale: "en",
          channelType: "WEBSITE",
          audience: "PUBLIC",
          ...(target === "DRAFT"
            ? {
                target: "DRAFT" as const,
                candidateId: draftValidation.candidateId,
                candidateVersion: draftValidation.candidateVersion,
                candidateManifestHash: draftValidation.candidateManifestHash,
              }
            : {}),
        },
        `grounded-${randomUUID()}`,
      );
      await drain();
      return queued.resource.id;
    };

    const successId = await run("shipping");
    const successView = await service.getRun(context, successId);
    if (successView.status !== "SUCCEEDED") {
      const debug = await prisma.knowledgeJob.findFirst({
        where: { tenantId, payloadRef: `evaluation-run:${successId}` },
        select: { status: true, errorCode: true, errorMessage: true },
      });
      throw new Error(
        `success run did not complete: ${JSON.stringify({ view: successView, job: debug })}`,
      );
    }
    assert.equal(successView.status, "SUCCEEDED");
    assert.equal(successView.result?.disposition, "AUTO_SEND");
    assert.equal(successView.result?.finalText, answerText);
    const successResult = await prisma.knowledgeV2EvaluationResult.findFirstOrThrow({
      where: { tenantId, evaluationRunId: successId },
    });
    assert.equal(successResult.provider, identity.provider);
    assert.equal(successResult.generatorModel, identity.model);
    assert.equal(successResult.promptPolicyVersion, promptPolicyVersion);
    assert.match(successResult.modelProcessorPolicyHash ?? "", /^[a-f0-9]{64}$/u);
    assert.match(successResult.providerOutputHash ?? "", /^[a-f0-9]{64}$/u);
    assert.match(successResult.gateInputHash ?? "", /^[a-f0-9]{64}$/u);
    assert.match(successResult.gateResultHash ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(successResult.responseHash, sha256(answerText));
    assert.match(successResult.restrictedResultHash ?? "", /^[a-f0-9]{64}$/u);
    assert.notEqual(successResult.restrictedResultHash, successResult.responseHash);
    const successTrace = await prisma.knowledgeV2RetrievalTrace.findFirstOrThrow({
      where: { tenantId, evaluationRunId: successId },
    });
    assert.equal(successTrace.answerHash, successResult.responseHash);
    assert.equal(
      Buffer.from(content.get(successTrace.restrictedTraceRef ?? "") ?? []).toString("utf8"),
      answerText,
    );
    const successCitation = await prisma.knowledgeV2Citation.findFirstOrThrow({
      where: { tenantId, retrievalTrace: { evaluationRunId: successId } },
    });
    assert.equal(successCitation.support, "SUPPORTS");
    const successAudit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: "knowledge.v2.test_run.completed", entityId: successId },
    });
    assert.equal(
      (successAudit.payload as Record<string, unknown>).gateResultHash,
      successResult.gateResultHash,
    );

    const revokedQuestion = "shipping revoked policy";
    const revokedIdPromise = service.createRun(
      context,
      {
        target: "ACTIVE",
        question: revokedQuestion,
        locale: "en",
        channelType: "WEBSITE",
        audience: "PUBLIC",
      },
      `grounded-${randomUUID()}`,
    );
    const revokedId = (await revokedIdPromise).resource.id;
    await prisma.knowledgeV2Settings.update({
      where: { tenantId },
      data: { modelProcessorPolicy: Prisma.DbNull },
    });
    const callsBeforeRevocation = providerCalls.get(revokedQuestion) ?? 0;
    await drain();
    assert.equal(providerCalls.get(revokedQuestion) ?? 0, callsBeforeRevocation);
    const revokedView = await service.getRun(context, revokedId);
    if (revokedView.status !== "SUCCEEDED") {
      const debug = await prisma.knowledgeJob.findFirst({
        where: { tenantId, payloadRef: `evaluation-run:${revokedId}` },
        select: { status: true, errorCode: true, errorMessage: true },
      });
      throw new Error(
        `revoked run did not complete: ${JSON.stringify({ view: revokedView, job: debug })}`,
      );
    }
    assert.equal(revokedView.status, "SUCCEEDED");
    assert.equal(revokedView.result?.disposition, "HANDOFF");
    assert.equal(revokedView.result?.finalText, null);
    const revokedResult = await prisma.knowledgeV2EvaluationResult.findFirstOrThrow({
      where: { tenantId, evaluationRunId: revokedId },
    });
    assert.equal(revokedResult.responseHash, null);
    assert.match(revokedResult.restrictedResultHash ?? "", /^[a-f0-9]{64}$/u);
    const revokedTrace = await prisma.knowledgeV2RetrievalTrace.findFirstOrThrow({
      where: { tenantId, evaluationRunId: revokedId },
    });
    assert.equal(revokedTrace.answerHash, null);
    assert.equal(revokedTrace.restrictedTraceRef, null);
    await prisma.knowledgeV2Settings.update({
      where: { tenantId },
      data: { modelProcessorPolicy: modelPolicy() },
    });

    const repairQuestion = "shipping repair exhaustion";
    const repairId = await run(repairQuestion);
    const repairView = await service.getRun(context, repairId);
    assert.equal(providerCalls.get(repairQuestion), 2);
    assert.equal(repairView.result?.disposition, "HANDOFF");
    assert.equal(repairView.result?.finalText, null);
    const repairCitations = await prisma.knowledgeV2Citation.count({
      where: { tenantId, retrievalTrace: { evaluationRunId: repairId } },
    });
    assert.equal(repairCitations, 0);

    const arbitraryQuestion = "shipping arbitrary output";
    const arbitraryId = await run(arbitraryQuestion);
    const arbitraryView = await service.getRun(context, arbitraryId);
    assert.equal(providerCalls.get(arbitraryQuestion), 2);
    assert.equal(arbitraryView.result?.disposition, "AUTO_SEND");
    assert.equal(arbitraryView.result?.finalText, answerText);
    assert.ok(!JSON.stringify(arbitraryView.result).includes("UNTRUSTED RAW PROVIDER OUTPUT"));

    const draftId = await run("shipping draft exact fact", "DRAFT");
    const draftView = await service.getRun(context, draftId);
    if (draftView.status !== "SUCCEEDED") {
      const debug = await prisma.knowledgeJob.findFirst({
        where: { tenantId, payloadRef: `evaluation-run:${draftId}` },
        select: { status: true, errorCode: true },
      });
      throw new Error(
        `draft run did not complete: ${JSON.stringify({ view: draftView, job: debug })}`,
      );
    }
    assert.equal(draftView.status, "SUCCEEDED");
    assert.equal(draftView.result?.disposition, "AUTO_SEND");
    assert.equal(draftView.result?.finalText, answerText);

    await prisma.$transaction((tx) =>
      assertKnowledgeV2PublicationEvaluationGate(tx, {
        tenantId: tenantId!,
        candidateId: draftValidation.candidateId,
        candidateVersion: draftValidation.candidateVersion,
        candidateManifestHash: draftValidation.candidateManifestHash,
      }),
    );

    const localeCases = [
      { locale: "EN", handoffRisk: "HIGH" },
      { locale: "FR", handoffRisk: "CRITICAL" },
      { locale: "DE", handoffRisk: "HIGH" },
      { locale: "ES", handoffRisk: "CRITICAL" },
      { locale: "PT", handoffRisk: "HIGH" },
      { locale: "RU", handoffRisk: "CRITICAL" },
    ] as const;
    const behaviorCases = [
      { behavior: "ANSWER", question: (locale: string) => `shipping ${locale} answer` },
      { behavior: "ABSTAIN", question: (locale: string) => `astronomy ${locale} abstain` },
      { behavior: "HANDOFF", question: (locale: string) => `shipping repair ${locale} handoff` },
    ] as const;
    const multilingualCases = [];
    for (const localeCase of localeCases) {
      for (const behaviorCase of behaviorCases) {
        multilingualCases.push(
          await testService.createTestCase(
            context,
            {
              safeLabel: `${localeCase.locale} ${behaviorCase.behavior}`,
              status: "ACTIVE",
              riskLevel:
                behaviorCase.behavior === "ANSWER"
                  ? "LOW"
                  : behaviorCase.behavior === "ABSTAIN"
                    ? "MEDIUM"
                    : localeCase.handoffRisk,
              critical: true,
              question: behaviorCase.question(localeCase.locale.toLowerCase()),
              expectedBehavior: behaviorCase.behavior,
              locale: localeCase.locale,
              channelType: "WEBSITE",
              audience: "PUBLIC",
              scope: null,
              sliceKeys: [localeCase.locale.toLowerCase(), behaviorCase.behavior.toLowerCase()],
              datasetVersion: "grounded-multilingual-v1",
              expectations: [],
            },
            `grounded-case-${localeCase.locale}-${behaviorCase.behavior}-${randomUUID()}`,
          ),
        );
      }
    }
    const evaluationCase = multilingualCases.find(
      (item) =>
        item.resource.currentVersion?.locale === "de" &&
        item.resource.currentVersion.expectedBehavior === "ANSWER",
    );
    assert.ok(evaluationCase);
    const evaluationTarget = {
      target: "DRAFT" as const,
      candidateId: draftValidation.candidateId,
      candidateVersion: draftValidation.candidateVersion,
      candidateManifestHash: draftValidation.candidateManifestHash,
      runKind: "PUBLICATION" as const,
    };
    const evaluationKey = `grounded-evaluation-${randomUUID()}`;
    const queuedEvaluation = await service.createEvaluationRun(
      context,
      evaluationTarget,
      evaluationKey,
    );
    const replayedEvaluation = await service.createEvaluationRun(
      context,
      evaluationTarget,
      evaluationKey,
    );
    assert.equal(replayedEvaluation.idempotencyReplayed, true);
    assert.equal(replayedEvaluation.resource.id, queuedEvaluation.resource.id);
    await drain();
    const passedEvaluation = await service.getEvaluationRun(context, queuedEvaluation.resource.id);
    assert.equal(passedEvaluation.status, "SUCCEEDED");
    assert.equal(passedEvaluation.aggregate.criticalTotal, 18);
    assert.equal(passedEvaluation.aggregate.criticalPassed, 18);
    assert.equal(passedEvaluation.aggregate.passRate, 1);
    const localeSlices = passedEvaluation.aggregate.slices.filter(
      (slice) => slice.dimension === "LOCALE",
    );
    assert.deepEqual(
      localeSlices.map((slice) => slice.value),
      ["de", "en", "es", "fr", "pt", "ru"],
    );
    assert.ok(localeSlices.every((slice) => slice.total === 3 && slice.passed === 3));
    const persistedAggregateResults = await prisma.knowledgeV2EvaluationResult.findMany({
      where: { tenantId, evaluationRunId: queuedEvaluation.resource.id },
      include: {
        testCaseVersion: { select: { locale: true, riskLevel: true } },
        metrics: { select: { metricKey: true, value: true } },
      },
    });
    const aggregateInput = {
      testCaseSetHash: passedEvaluation.testCaseSetHash,
      results: persistedAggregateResults.map((result) => ({
        testCaseVersionId: result.testCaseVersionId!,
        status: result.status,
        metricManifestHash: result.metricManifestHash,
        locale: result.testCaseVersion!.locale,
        riskLevel: result.testCaseVersion!.riskLevel,
        critical: result.metrics.some(
          (metric) => metric.metricKey === "system:critical" && metric.value === 1,
        ),
      })),
    };
    const forwardAggregate = knowledgeV2EvaluationAggregate(aggregateInput);
    const reverseAggregate = knowledgeV2EvaluationAggregate({
      ...aggregateInput,
      results: [...aggregateInput.results].reverse(),
    });
    assert.equal(forwardAggregate.aggregateHash, reverseAggregate.aggregateHash);
    assert.equal(forwardAggregate.sliceManifestHash, reverseAggregate.sliceManifestHash);
    assert.deepEqual(
      forwardAggregate.slices.map((slice) => [slice.sliceKey, slice.aggregateHash]),
      reverseAggregate.slices.map((slice) => [slice.sliceKey, slice.aggregateHash]),
    );
    assert.equal(passedEvaluation.aggregate.aggregateHash, forwardAggregate.aggregateHash);
    const assertPublicationGate = () =>
      prisma.$transaction((tx) =>
        assertKnowledgeV2PublicationEvaluationGate(tx, {
          tenantId: tenantId!,
          candidateId: draftValidation.candidateId,
          candidateVersion: draftValidation.candidateVersion,
          candidateManifestHash: draftValidation.candidateManifestHash,
        }),
      );
    const currentEvaluationSet = await prisma.$transaction((tx) =>
      knowledgeV2CurrentEvaluationSet(tx, tenantId!),
    );
    assert.equal(currentEvaluationSet.testCaseSetHash, passedEvaluation.testCaseSetHash);
    await assertPublicationGate();

    const activeBeforeRollback = await publicationService.getActivePublicationWithEtag(context);
    const rollbackAccepted = await publicationService.rollbackPublication(
      context,
      rollbackSource.id,
      { reason: "Restore the prior verified publication." },
      `grounded-rollback-${randomUUID()}`,
      [activeBeforeRollback.etag],
    );
    const successfulRollbackPublicationId =
      rollbackAccepted.resource?.type === "PUBLICATION" ? rollbackAccepted.resource.id : null;
    assert.ok(successfulRollbackPublicationId);
    const successfulRollbackEvent = await prisma.knowledgeOutbox.findFirstOrThrow({
      where: {
        tenantId,
        aggregateId: successfulRollbackPublicationId,
        eventType: "knowledge.v2.publication.activate.requested",
      },
    });
    await publicationDispatcher.dispatch(successfulRollbackEvent.id);
    assert.equal(
      (
        await prisma.activeKnowledgePublication.findUniqueOrThrow({
          where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
        })
      ).publicationId,
      publication.id,
    );
    await drain();
    await prisma.knowledgeOutbox.update({
      where: { id: successfulRollbackEvent.id },
      data: { availableAt: new Date() },
    });
    await publicationDispatcher.dispatch(successfulRollbackEvent.id);
    assert.equal(
      (
        await prisma.activeKnowledgePublication.findUniqueOrThrow({
          where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
        })
      ).publicationId,
      successfulRollbackPublicationId,
    );
    const rollbackEvaluation = await prisma.knowledgeV2EvaluationRun.findFirstOrThrow({
      where: {
        tenantId,
        runKind: "PUBLICATION",
        candidateId: { startsWith: "rollback-" },
        status: "SUCCEEDED",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    assert.equal(
      await prisma.knowledgeV2EvaluationResult.count({
        where: { tenantId, evaluationRunId: rollbackEvaluation.id, status: "PASSED" },
      }),
      18,
    );

    const evaluationJob = await prisma.knowledgeJob.findFirstOrThrow({
      where: { tenantId, payloadRef: `evaluation-run:${queuedEvaluation.resource.id}` },
    });
    const evaluationEvent = await prisma.knowledgeOutbox.findFirstOrThrow({
      where: { tenantId, aggregateId: queuedEvaluation.resource.id },
    });
    await prisma.$transaction([
      prisma.knowledgeV2EvaluationRun.update({
        where: { id: queuedEvaluation.resource.id },
        data: { status: "RUNNING", completedAt: null },
      }),
      prisma.knowledgeJob.update({
        where: { id: evaluationJob.id },
        data: { status: "RETRY_SCHEDULED", completedAt: null },
      }),
      prisma.knowledgeOutbox.update({
        where: { id: evaluationEvent.id },
        data: {
          status: "FAILED",
          publishedAt: null,
          lockedAt: null,
          lockedBy: null,
          availableAt: new Date(),
          deadlineAt: new Date(Date.now() + 60_000),
        },
      }),
    ]);
    await drain();
    assert.equal(
      await prisma.knowledgeV2EvaluationResult.count({
        where: { tenantId, evaluationRunId: queuedEvaluation.resource.id },
      }),
      18,
    );

    const staleTarget = await service.createEvaluationRun(
      context,
      evaluationTarget,
      `grounded-stale-target-${randomUUID()}`,
    );
    await prisma.knowledgeV2PublicationValidation.update({
      where: { id: draftValidation.id },
      data: { status: "EXPIRED" },
    });
    await drain();
    assert.equal(
      (await service.getEvaluationRun(context, staleTarget.resource.id)).status,
      "FAILED",
    );
    await prisma.knowledgeV2PublicationValidation.update({
      where: { id: draftValidation.id },
      data: { status: "PASSED", validUntil: new Date(Date.now() + 60_000) },
    });

    const revokedRole = await service.createEvaluationRun(
      context,
      evaluationTarget,
      `grounded-role-revoked-${randomUUID()}`,
    );
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { role: "VIEWER" },
    });
    await drain();
    assert.equal(
      (await service.getEvaluationRun(context, revokedRole.resource.id)).status,
      "FAILED",
    );
    await prisma.membership.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { role: "ADMIN" },
    });

    const staleVersion = await service.createEvaluationRun(
      context,
      evaluationTarget,
      `grounded-stale-version-${randomUUID()}`,
    );
    const failedCaseVersion = await testService.updateTestCase(
      context,
      evaluationCase.resource.id,
      { expectedBehavior: "REFUSE", datasetVersion: "grounded-evaluation-v2" },
      `grounded-case-version-${randomUUID()}`,
      [evaluationCase.resource.etag],
    );
    await drain();
    assert.equal(
      (await service.getEvaluationRun(context, staleVersion.resource.id)).status,
      "FAILED",
    );

    const failedEvaluation = await service.createEvaluationRun(
      context,
      evaluationTarget,
      `grounded-failed-evaluation-${randomUUID()}`,
    );
    await drain();
    const failedEvaluationView = await service.getEvaluationRun(
      context,
      failedEvaluation.resource.id,
    );
    assert.equal(failedEvaluationView.status, "SUCCEEDED");
    assert.equal(failedEvaluationView.aggregate.criticalTotal, 18);
    assert.equal(failedEvaluationView.aggregate.criticalPassed, 17);
    assert.equal(failedEvaluationView.aggregate.failed, 1);
    assert.ok((failedEvaluationView.aggregate.passRate ?? 0) > 0.9);
    const failedGermanSlice = failedEvaluationView.aggregate.slices.find(
      (slice) => slice.sliceKey === "LOCALE:de",
    );
    assert.equal(failedGermanSlice?.total, 3);
    assert.equal(failedGermanSlice?.passed, 2);
    assert.equal(failedGermanSlice?.failed, 1);
    assert.ok(
      failedEvaluationView.aggregate.slices
        .filter((slice) => slice.dimension === "LOCALE" && slice.value !== "de")
        .every((slice) => slice.failed === 0),
    );
    await assert.rejects(assertPublicationGate, (error: unknown) => {
      if (!(error instanceof HttpException) || error.getStatus() !== 409) return false;
      const response = error.getResponse();
      return (
        typeof response === "object" &&
        response !== null &&
        "code" in response &&
        response.code === "KNOWLEDGE_PUBLICATION_CRITICAL_EVALUATION_REQUIRED"
      );
    });
    const activeBeforeFailedRollback =
      await publicationService.getActivePublicationWithEtag(context);
    const failedRollbackAccepted = await publicationService.rollbackPublication(
      context,
      publication.id,
      { reason: "This rollback must remain blocked by the failed German critical case." },
      `grounded-failed-rollback-${randomUUID()}`,
      [activeBeforeFailedRollback.etag],
    );
    const failedRollbackPublicationId =
      failedRollbackAccepted.resource?.type === "PUBLICATION"
        ? failedRollbackAccepted.resource.id
        : null;
    assert.ok(failedRollbackPublicationId);
    await drain();
    const failedRollbackEvent = await prisma.knowledgeOutbox.findFirstOrThrow({
      where: {
        tenantId,
        aggregateId: failedRollbackPublicationId,
        eventType: "knowledge.v2.publication.activate.requested",
      },
    });
    const failedRollbackEvaluationState = await publicationService.activationEvaluationState({
      tenantId,
      publicationId: failedRollbackPublicationId,
    });
    assert.equal(failedRollbackEvaluationState, "FAILED");
    await publicationDispatcher.dispatch(failedRollbackEvent.id).catch(() => null);
    assert.equal(
      (
        await prisma.activeKnowledgePublication.findUniqueOrThrow({
          where: { tenantId_targetKey: { tenantId, targetKey: "workspace-v2" } },
        })
      ).publicationId,
      successfulRollbackPublicationId,
    );
    assert.equal(
      (
        await prisma.knowledgePublication.findUniqueOrThrow({
          where: { id: failedRollbackPublicationId },
        })
      ).status,
      "FAILED",
    );
    const failedRollbackEventAfter = await prisma.knowledgeOutbox.findUniqueOrThrow({
      where: { id: failedRollbackEvent.id },
    });
    assert.equal(failedRollbackEventAfter.status, "DEAD_LETTER");
    assert.equal(
      failedRollbackEventAfter.lastErrorCode,
      "KNOWLEDGE_PUBLICATION_CRITICAL_EVALUATION_REQUIRED",
    );
    assert.equal(failedCaseVersion.resource.currentVersion?.versionNumber, 2);

    const validatedClaims = [{ claimId: "shipping-claim", claimHash: sha256(answerText) }];
    assert.equal(
      knowledgeV2ForbiddenClaimPasses({
        expectedValueHash: sha256(answerText),
        semanticKey: null,
        validatedClaims,
      }),
      false,
    );
    assert.equal(
      knowledgeV2ForbiddenClaimPasses({
        expectedValueHash: sha256("Another claim"),
        semanticKey: null,
        validatedClaims,
      }),
      true,
    );
    assert.equal(
      knowledgeV2ForbiddenClaimPasses({
        expectedValueHash: null,
        semanticKey: "shipping-claim",
        validatedClaims,
      }),
      false,
    );
    assert.equal(
      knowledgeV2ForbiddenClaimPasses({
        expectedValueHash: null,
        semanticKey: null,
        validatedClaims,
      }),
      false,
    );

    const raceQuestion = "shipping race revocation";
    const raceId = await run(raceQuestion);
    const raceRun = await prisma.knowledgeV2EvaluationRun.findUniqueOrThrow({
      where: { id: raceId },
    });
    assert.equal(providerCalls.get(raceQuestion), 1);
    assert.equal(raceRun.status, "FAILED");
    assert.equal(
      await prisma.knowledgeV2EvaluationResult.count({
        where: { tenantId, evaluationRunId: raceId },
      }),
      0,
    );
    await prisma.knowledgeV2Fact.update({
      where: { id: fact.id },
      data: { deletedAt: null },
    });

    console.log(JSON.stringify({ checks: 65, passed: 65 }));
  } finally {
    await cleanupTenant(tenantId, userId).catch((error) => console.error("cleanup failed", error));
    await prisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
