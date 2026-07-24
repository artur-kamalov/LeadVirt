import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { PrismaClient } from "../../packages/db/src/index.js";
import {
  KNOWLEDGE_ACCEPTANCE_WEBSITE_EXPECTED_SENTENCE,
  KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_URL,
} from "../../packages/knowledge/src/acceptance-website-fixture.js";
import { KnowledgeV2HybridQdrantClient } from "../../packages/knowledge/src/v2-hybrid-qdrant.js";
import type {
  ApiEnvelope,
  KnowledgeV2AcceptedMutation,
  KnowledgeV2BatchEvaluationRunView,
  KnowledgeV2DocumentPage,
  KnowledgeV2DiagnosticSearchView,
  KnowledgeV2FactView,
  KnowledgeV2GuidanceRuleView,
  KnowledgeV2MutationResult,
  KnowledgeV2PublicationDetail,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessView,
  KnowledgeV2RevisionPage,
  KnowledgeV2RevisionPreviewView,
  KnowledgeV2ReviewItemPage,
  KnowledgeV2SettingsView,
  KnowledgeV2SourceView,
  KnowledgeV2TestCaseMutationResult,
  KnowledgeV2TestRunView,
} from "@leadvirt/types";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const providerBase = process.env.KNOWLEDGE_ACCEPTANCE_PROVIDER_URL ?? "http://127.0.0.1:4011";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";

function key(label: string) {
  return `fresh-owner:${label}:${randomUUID()}`;
}

async function data<T>(response: APIResponse, expectedStatus: number | number[] = 200) {
  const text = await response.text();
  const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  expect(statuses, text).toContain(response.status());
  return (JSON.parse(text) as ApiEnvelope<T>).data;
}

async function waitForKnowledgeJob(request: APIRequestContext, jobId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const run = await data<{
      status: string;
      error?: { code?: string; message?: string } | null;
    }>(await request.get(`${apiBase}/knowledge/v2/jobs/${encodeURIComponent(jobId)}`));
    if (run.status === "SUCCEEDED") return;
    if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(run.status)) {
      throw new Error(`Knowledge job ${jobId} failed: ${run.error?.code ?? run.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Knowledge job ${jobId} did not finish.`);
}

async function waitForEvaluation(request: APIRequestContext, runId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const run = await data<KnowledgeV2BatchEvaluationRunView>(
      await request.get(`${apiBase}/knowledge/v2/evaluation-runs/${encodeURIComponent(runId)}`),
    );
    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "CANCELLED"].includes(run.status)) {
      throw new Error(`Evaluation ${runId} failed: ${run.error?.code ?? run.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, run.pollAfterMs ?? 500));
  }
  throw new Error(`Evaluation ${runId} did not finish.`);
}

async function waitForTestRun(request: APIRequestContext, runId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const run = await data<KnowledgeV2TestRunView>(
      await request.get(`${apiBase}/knowledge/v2/test-runs/${encodeURIComponent(runId)}`),
    );
    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "CANCELLED"].includes(run.status)) {
      throw new Error(`Test run ${runId} failed: ${run.error?.code ?? run.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, run.pollAfterMs ?? 500));
  }
  throw new Error(`Test run ${runId} did not finish.`);
}

async function deleteQdrantSnapshots(prisma: PrismaClient, tenantId: string) {
  const snapshots = await prisma.knowledgeIndexSnapshot.findMany({
    where: { tenantId },
    select: { id: true },
  });
  if (snapshots.length === 0) return;
  const client = new KnowledgeV2HybridQdrantClient({
    qdrantUrl: process.env.RAG_QDRANT_URL ?? "http://localhost:6333",
    ...(process.env.RAG_QDRANT_API_KEY ? { qdrantApiKey: process.env.RAG_QDRANT_API_KEY } : {}),
    collectionPrefix: process.env.RAG_QDRANT_COLLECTION ?? "leadvirt_knowledge",
    dense: {
      vectorName: "dense",
      schemaVersion: "knowledge-dense-v1",
      provider: "openai-compatible",
      model: process.env.KNOWLEDGE_V2_EMBEDDING_MODEL ?? "acceptance-embedding-v1",
      dimensions: Number(process.env.KNOWLEDGE_V2_EMBEDDING_DIMENSIONS ?? 16),
      distance: "Cosine",
    },
    sparse: {
      vectorName: "sparse",
      schemaVersion: "knowledge-sparse-v1",
      provider: "leadvirt",
      model: "unicode-hash-tf-v1",
      maxNonZeroValues: Number(process.env.KNOWLEDGE_V2_SPARSE_MAX_NON_ZERO ?? 256),
    },
    requestTimeoutMs: Number(process.env.RAG_QDRANT_TIMEOUT_MS ?? 3_000),
    maxAttempts: 3,
    retryBaseDelayMs: 100,
    maxBatchSize: 64,
    maxReconcilePoints: 100_000,
  });
  for (const snapshot of snapshots) {
    await client.deleteSnapshotPartition({
      workspaceId: tenantId,
      indexSnapshotId: snapshot.id,
    });
  }
}

async function cleanupIdentity(prisma: PrismaClient, tenantId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const tenantTables = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenantId' ORDER BY table_name",
    );
    for (const { table_name: table } of tenantTables) {
      const safeTable = table.replaceAll('"', '""');
      await tx.$executeRawUnsafe(`DELETE FROM "${safeTable}" WHERE "tenantId" = $1`, tenantId);
    }
    const userTables = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'userId' ORDER BY table_name",
    );
    for (const { table_name: table } of userTables) {
      const safeTable = table.replaceAll('"', '""');
      await tx.$executeRawUnsafe(`DELETE FROM "${safeTable}" WHERE "userId" = $1`, userId);
    }
    await tx.$executeRawUnsafe('DELETE FROM "Tenant" WHERE "id" = $1', tenantId);
    await tx.$executeRawUnsafe('DELETE FROM "User" WHERE "id" = $1', userId);
  });
}

test("fresh owner imports, evaluates, publishes, and retrieves real website evidence", async ({
  request,
}) => {
  test.setTimeout(240_000);
  expect(process.env.APP_ENV).toBe("acceptance");
  expect(process.env.KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_ENABLED).toBe("true");
  expect((await fetch(`${providerBase}/health`)).ok).toBe(true);
  const qdrantUrl = (process.env.RAG_QDRANT_URL ?? "http://localhost:6333").replace(/\/+$/, "");
  expect((await fetch(`${qdrantUrl}/healthz`)).ok).toBe(true);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let tenantId: string | null = null;
  let userId: string | null = null;
  let acceptanceEmail: string | null = null;
  try {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    acceptanceEmail = `fresh-owner-${stamp}@yandex.ru`;
    const signup = await request.post(`${apiBase}/auth/signup`, {
      headers: { "x-leadvirt-qa": "playwright" },
      data: {
        email: acceptanceEmail,
        password: `Fresh-${stamp}!Aa`,
        companyName: `Fresh Knowledge ${stamp}`,
      },
    });
    expect(signup.ok(), await signup.text()).toBe(true);

    const tenant = await data<{ id: string; role: string }>(
      await request.get(`${apiBase}/current-tenant`),
    );
    const owner = await data<{ id: string; tenantId: string; role: string }>(
      await request.get(`${apiBase}/auth/me`),
    );
    tenantId = tenant.id;
    userId = owner.id;
    expect(tenant.role).toBe("OWNER");
    expect(owner.tenantId).toBe(tenantId);

    const settingsResponse = await request.get(`${apiBase}/knowledge/v2/settings`);
    await data<KnowledgeV2SettingsView>(settingsResponse);
    const embeddingDeployment = process.env.KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT!;
    const region = process.env.KNOWLEDGE_V2_EMBEDDING_REGION!;
    const rerankerProvider = process.env.KNOWLEDGE_V2_RERANKER_PROVIDER!;
    const rerankerModel = process.env.KNOWLEDGE_V2_RERANKER_MODEL!;
    const rerankerVersion = process.env.KNOWLEDGE_V2_RERANKER_VERSION!;
    const groundedProvider = process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER!;
    const groundedModel = process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL!;
    const groundedVersion = process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION!;
    const updatedSettings = await request.patch(`${apiBase}/knowledge/v2/settings`, {
      headers: {
        "Idempotency-Key": key("settings"),
        "If-Match": settingsResponse.headers().etag,
      },
      data: {
        defaultLocale: "en",
        supportedLocales: ["en"],
        embeddingProviderPolicy: {
          schemaVersion: 1,
          policyVersion:
            process.env.KNOWLEDGE_V2_EMBEDDING_POLICY_VERSION ?? "external-embedding-v1",
          approved: true,
          provider: "openai-compatible",
          deployment: embeddingDeployment,
          region,
          allowedClassifications: ["PUBLIC", "INTERNAL"],
        },
        retrievalProcessorPolicy: {
          schemaVersion: 1,
          policyVersion:
            process.env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION ?? "external-retrieval-v1",
          approved: true,
          queryEmbedding: {
            provider: "openai-compatible",
            deployment: embeddingDeployment,
            region,
            allowedClassifications: ["PUBLIC", "INTERNAL", "SENSITIVE"],
          },
          reranker: {
            provider: rerankerProvider,
            model: rerankerModel,
            version: rerankerVersion,
            region,
            allowedClassifications: ["PUBLIC", "INTERNAL", "SENSITIVE"],
          },
        },
        modelProcessorPolicy: {
          schemaVersion: 1,
          policyVersion:
            process.env.KNOWLEDGE_V2_MODEL_PROCESSOR_POLICY_VERSION ?? "external-model-v1",
          approved: true,
          promptPolicyVersion:
            process.env.KNOWLEDGE_V2_GROUNDED_PROMPT_POLICY_VERSION ?? "grounded-answer-v1",
          groundedAnswer: {
            provider: groundedProvider,
            model: groundedModel,
            version: groundedVersion,
            region: process.env.KNOWLEDGE_V2_GROUNDED_ANSWER_REGION,
            allowedClassifications: ["PUBLIC", "INTERNAL"],
          },
        },
      },
    });
    expect(updatedSettings.ok(), await updatedSettings.text()).toBe(true);

    const factResponse = await request.post(`${apiBase}/knowledge/v2/facts`, {
      headers: { "Idempotency-Key": key("fact") },
      data: {
        factKey: "business/name",
        entityType: "BUSINESS_PROFILE",
        fieldType: "TEXT",
        normalizedValue: "Polar Lantern Studio",
        displayValue: "Polar Lantern Studio",
        locale: "en",
        localeBehavior: "LANGUAGE_NEUTRAL",
        riskLevel: "LOW",
        authority: "MANUAL",
      },
    });
    const fact = (await data<KnowledgeV2MutationResult<KnowledgeV2FactView>>(factResponse, 201))
      .resource;
    const verifiedFactResponse = await request.post(
      `${apiBase}/knowledge/v2/facts/${encodeURIComponent(fact.id)}/verify`,
      {
        headers: {
          "Idempotency-Key": key("verify-fact"),
          "If-Match": factResponse.headers().etag,
        },
        data: { note: "Fresh owner verified the required business identity." },
      },
    );
    expect(verifiedFactResponse.ok(), await verifiedFactResponse.text()).toBe(true);

    const sourceMutation = await data<KnowledgeV2AcceptedMutation>(
      await request.post(`${apiBase}/knowledge/v2/sources`, {
        headers: { "Idempotency-Key": key("website") },
        data: {
          kind: "WEBSITE",
          displayName: "Polar Lantern service page",
          canonicalUri: KNOWLEDGE_ACCEPTANCE_WEBSITE_FIXTURE_URL,
          syncMode: "MANUAL",
          defaultScope: { audiences: ["PUBLIC"], locales: ["en"] },
          defaultClassification: "PUBLIC",
          defaultLocale: "en",
        },
      }),
      202,
    );
    expect(sourceMutation.resource?.type).toBe("SOURCE");
    const sourceId = sourceMutation.resource!.id;
    await waitForKnowledgeJob(request, sourceMutation.jobId);

    const source = await data<KnowledgeV2SourceView>(
      await request.get(`${apiBase}/knowledge/v2/sources/${encodeURIComponent(sourceId)}`),
    );
    expect(source.kind).toBe("WEBSITE");
    expect(source.lastErrorCode ?? null).toBeNull();
    const documents = await data<KnowledgeV2DocumentPage>(
      await request.get(
        `${apiBase}/knowledge/v2/documents?sourceId=${encodeURIComponent(sourceId)}`,
      ),
    );
    expect(documents.items).toHaveLength(1);
    const document = documents.items[0]!;
    const revisions = await data<KnowledgeV2RevisionPage>(
      await request.get(
        `${apiBase}/knowledge/v2/documents/${encodeURIComponent(document.id)}/revisions`,
      ),
    );
    expect(revisions.items).toHaveLength(1);
    expect(revisions.items[0]!.status).toBe("CHUNKING");
    const preview = await data<KnowledgeV2RevisionPreviewView>(
      await request.get(
        `${apiBase}/knowledge/v2/revisions/${encodeURIComponent(revisions.items[0]!.id)}/preview`,
      ),
    );
    expect(preview.elements.some((item) => item.normalizedText?.includes("AURORA-7291"))).toBe(
      true,
    );
    expect(preview.chunks.length).toBeGreaterThan(0);
    const reviews = await data<KnowledgeV2ReviewItemPage>(
      await request.get(
        `${apiBase}/knowledge/v2/review-items?status=OPEN&sourceId=${encodeURIComponent(sourceId)}`,
      ),
    );
    expect(reviews.items).toEqual([]);

    const testCase = (
      await data<KnowledgeV2TestCaseMutationResult>(
        await request.post(`${apiBase}/knowledge/v2/test-cases`, {
          headers: { "Idempotency-Key": key("critical-test") },
          data: {
            safeLabel: "Signature service code",
            status: "ACTIVE",
            riskLevel: "LOW",
            critical: true,
            question: "What is Polar Lantern Studio's signature service code?",
            expectedBehavior: "ANSWER",
            locale: "en",
            channelType: "WEBSITE",
            audience: "PUBLIC",
            scope: { audiences: ["PUBLIC"], locales: ["en"] },
            sliceKeys: ["fresh-owner", "en"],
            datasetVersion: "fresh-owner-v1",
            expectations: [],
          },
        }),
        201,
      )
    ).resource;
    expect(testCase.critical).toBe(true);

    const blockedReadiness = await data<KnowledgeV2ReadinessView>(
      await request.get(`${apiBase}/knowledge/v2/readiness`),
    );
    expect(blockedReadiness.draft.itemCounts.documentRevisions).toBe(1);
    expect(
      blockedReadiness.draft.blockers.some(
        (blocker) => blocker.code === "KNOWLEDGE_PERMISSION_TENANT_DEFAULT_SCOPE_UNAVAILABLE",
      ),
    ).toBe(true);
    const blockedValidation = (
      await data<KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>>(
        await request.post(`${apiBase}/knowledge/v2/publications/validate`, {
          headers: { "Idempotency-Key": key("validate-blocked") },
          data: {
            targetKey: blockedReadiness.targetKey,
            candidateId: blockedReadiness.draft.candidateId,
            candidateVersion: blockedReadiness.draft.candidateVersion,
          },
        }),
        201,
      )
    ).resource;
    expect(blockedValidation.status).toBe("FAILED");
    expect(
      blockedValidation.blockers.some(
        (blocker) => blocker.code === "KNOWLEDGE_PERMISSION_TENANT_DEFAULT_SCOPE_UNAVAILABLE",
      ),
    ).toBe(true);
    expect(await prisma.knowledgeIndexSnapshot.count({ where: { tenantId } })).toBe(0);

    const scopedSettings = await request.patch(`${apiBase}/knowledge/v2/settings`, {
      headers: {
        "Idempotency-Key": key("default-scope"),
        "If-Match": updatedSettings.headers().etag,
      },
      data: { defaultScope: { audiences: ["PUBLIC"], locales: ["en"] } },
    });
    expect(scopedSettings.ok(), await scopedSettings.text()).toBe(true);

    const guidanceResponse = await request.post(`${apiBase}/knowledge/v2/guidance`, {
      headers: { "Idempotency-Key": key("guidance") },
      data: {
        title: "Unresolved question escalation",
        type: "ESCALATION",
        condition: {
          kind: "PREDICATE",
          field: "INTENT",
          operator: "EQUALS",
          value: "human_handoff",
        },
        instruction: "Escalate explicit requests for a human specialist.",
        priority: 100,
        tieBreakKey: "support.unresolved-handoff",
        riskLevel: "LOW",
      },
    });
    const guidance = (
      await data<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>>(guidanceResponse, 201)
    ).resource;
    const approvedGuidance = await request.post(
      `${apiBase}/knowledge/v2/guidance/${encodeURIComponent(guidance.id)}/approve`,
      {
        headers: {
          "Idempotency-Key": key("approve-guidance"),
          "If-Match": guidanceResponse.headers().etag,
        },
        data: { note: "Approved for the fresh-owner publication." },
      },
    );
    expect(approvedGuidance.ok(), await approvedGuidance.text()).toBe(true);

    const starterPresetResponse = await request.post(
      `${apiBase}/knowledge/v2/capabilities/presets/starter`,
      {
        headers: { "Idempotency-Key": key("starter-preset") },
      },
    );
    expect(starterPresetResponse.ok(), await starterPresetResponse.text()).toBe(true);

    const readiness = await data<KnowledgeV2ReadinessView>(
      await request.get(`${apiBase}/knowledge/v2/readiness`),
    );
    expect(readiness.draft.itemCounts.documentRevisions).toBe(1);
    expect(readiness.draft.itemCounts.guidanceRuleVersions).toBe(1);
    expect(readiness.draft.blockers).toEqual([]);
    const validation = (
      await data<KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>>(
        await request.post(`${apiBase}/knowledge/v2/publications/validate`, {
          headers: { "Idempotency-Key": key("validate") },
          data: {
            targetKey: readiness.targetKey,
            candidateId: readiness.draft.candidateId,
            candidateVersion: readiness.draft.candidateVersion,
          },
        }),
        201,
      )
    ).resource;
    expect(["PASSED", "PASSED_WITH_WARNINGS"]).toContain(validation.status);
    const preparedRevisions = await data<KnowledgeV2RevisionPage>(
      await request.get(
        `${apiBase}/knowledge/v2/documents/${encodeURIComponent(document.id)}/revisions`,
      ),
    );
    expect(preparedRevisions.items[0]!.status).toBe("READY");

    const evaluation = (
      await data<KnowledgeV2MutationResult<KnowledgeV2BatchEvaluationRunView>>(
        await request.post(`${apiBase}/knowledge/v2/evaluation-runs`, {
          headers: { "Idempotency-Key": key("evaluation") },
          data: {
            target: "DRAFT",
            runKind: "PUBLICATION",
            candidateId: validation.candidateId,
            candidateVersion: validation.candidateVersion,
            candidateManifestHash: validation.candidateManifestHash,
          },
        }),
        202,
      )
    ).resource;
    const completedEvaluation = await waitForEvaluation(request, evaluation.id);
    expect(completedEvaluation.testCaseSetHash).toBe(readiness.draft.evaluationTestCaseSetHash);
    expect(completedEvaluation.aggregate.criticalTotal).toBe(1);
    expect(completedEvaluation.aggregate.criticalPassed).toBe(1);

    const publicationMutation = await data<KnowledgeV2AcceptedMutation>(
      await request.post(`${apiBase}/knowledge/v2/publications`, {
        headers: { "Idempotency-Key": key("publication") },
        data: {
          targetKey: validation.targetKey,
          candidateId: validation.candidateId,
          candidateVersion: validation.candidateVersion,
          validationId: validation.id,
        },
      }),
      202,
    );
    await waitForKnowledgeJob(request, publicationMutation.jobId);
    const active = await data<KnowledgeV2PublicationDetail>(
      await request.get(`${apiBase}/knowledge/v2/publications/active`),
    );
    expect(active.status).toBe("ACTIVE");
    expect(active.items.some((item) => item.type === "DOCUMENT_REVISION")).toBe(true);

    const diagnosticResponse = await request.get(`${apiBase}/knowledge/sources/search`, {
      params: {
        q: "What is Polar Lantern Studio's signature service code?",
        limit: 5,
      },
    });
    const diagnostic = await data<KnowledgeV2DiagnosticSearchView>(diagnosticResponse);
    expect(diagnosticResponse.headers()["cache-control"]).toBe("no-store, private");
    expect(diagnosticResponse.headers().pragma).toBe("no-cache");
    expect(diagnostic).toMatchObject({
      schemaVersion: 1,
      status: "grounded",
      context: {
        channelType: "DEMO",
        audience: "INTERNAL",
        classifications: ["PUBLIC", "INTERNAL", "SENSITIVE"],
        queryClassification: "SENSITIVE",
      },
      target: {
        corpusKind: "STRUCTURED_V2",
        targetKey: "workspace-v2",
        publicationId: active.id,
        publicationSequence: active.sequence,
      },
    });
    expect(Array.isArray(diagnostic)).toBe(false);
    expect(diagnostic).not.toHaveProperty("source");
    expect(diagnostic).not.toHaveProperty("chunk");
    expect(diagnostic.documents.some((item) => item.safeExcerpt.includes("AURORA-7291"))).toBe(
      true,
    );
    expect(diagnostic.facts.length).toBeLessThanOrEqual(5);
    expect(diagnostic.guidance.length).toBeLessThanOrEqual(5);
    expect(diagnostic.documents.length).toBeLessThanOrEqual(5);
    expect(diagnostic.conflicts.length).toBeLessThanOrEqual(5);
    expect(diagnostic.diagnostics.returnedCounts).toEqual({
      facts: diagnostic.facts.length,
      guidance: diagnostic.guidance.length,
      documents: diagnostic.documents.length,
      conflicts: diagnostic.conflicts.length,
    });
    for (const item of diagnostic.facts) {
      expect(item).not.toHaveProperty("source");
      expect(item).not.toHaveProperty("chunk");
      expect(item.safeValue.length).toBeLessThanOrEqual(2_000);
    }
    for (const item of diagnostic.guidance) {
      expect(item).not.toHaveProperty("source");
      expect(item).not.toHaveProperty("chunk");
      expect(item.safeSummary.length).toBeLessThanOrEqual(2_000);
    }
    for (const item of diagnostic.documents) {
      expect(item).not.toHaveProperty("source");
      expect(item).not.toHaveProperty("chunk");
      expect(item.safeExcerpt.length).toBeLessThanOrEqual(4_000);
    }

    const activeRun = (
      await data<KnowledgeV2MutationResult<KnowledgeV2TestRunView>>(
        await request.post(`${apiBase}/knowledge/v2/test-runs`, {
          headers: { "Idempotency-Key": key("active-retrieval") },
          data: {
            testCaseId: testCase.id,
            target: "ACTIVE",
            locale: "en",
            channelType: "WEBSITE",
            audience: "PUBLIC",
            scope: { audiences: ["PUBLIC"], locales: ["en"] },
          },
        }),
        202,
      )
    ).resource;
    const retrieved = await waitForTestRun(request, activeRun.id);
    expect(retrieved.publicationId).toBe(active.id);
    expect(retrieved.result?.outcome).toBe("ANSWERED");
    expect(retrieved.result?.disposition).toBe("AUTO_SEND");
    expect(retrieved.result?.finalText).toContain(KNOWLEDGE_ACCEPTANCE_WEBSITE_EXPECTED_SENTENCE);
    expect(retrieved.result?.retrievalTraceId).toBeTruthy();
    expect(
      retrieved.result?.documents.some(
        (item) => item.evidenceReferenceId && item.safeExcerpt?.includes("AURORA-7291"),
      ),
    ).toBe(true);
  } finally {
    const cleanupErrors: unknown[] = [];
    if (acceptanceEmail && (!tenantId || !userId)) {
      try {
        const createdUser = await prisma.user.findUnique({
          where: { email: acceptanceEmail },
          select: {
            id: true,
            memberships: {
              select: { tenantId: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });
        userId ??= createdUser?.id ?? null;
        tenantId ??= createdUser?.memberships[0]?.tenantId ?? null;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (tenantId && userId) {
      try {
        await deleteQdrantSnapshots(prisma, tenantId);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await cleanupIdentity(prisma, tenantId, userId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1)
      throw new AggregateError(cleanupErrors, "Acceptance cleanup failed.");
  }
});
