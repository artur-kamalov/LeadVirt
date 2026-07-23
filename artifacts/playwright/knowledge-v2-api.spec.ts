import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import type {
  ApiEnvelope,
  KnowledgeV2AcceptedMutation,
  KnowledgeV2FactView,
  KnowledgeV2GuidanceRuleView,
  KnowledgeV2JobView,
  KnowledgeV2MutationResult,
  KnowledgeV2PublicationDetail,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessView,
  KnowledgeV2SettingsView,
} from "@leadvirt/types";
import { Prisma, PrismaClient } from "../../packages/db/src/index.js";

const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

function key(label: string) {
  return `kv2:${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function signup(context: APIRequestContext, label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await context.post(`${apiBase}/auth/signup`, {
    headers: { "x-leadvirt-qa": "playwright" },
    data: {
      email: `knowledge-v2-${label}-${stamp}@yandex.ru`,
      password: `Knowledge-${stamp}!Aa`,
      companyName: `Knowledge v2 ${label}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function installProcessorPolicyFixture(context: APIRequestContext) {
  const tenantResponse = await context.get(`${apiBase}/current-tenant`);
  expect(tenantResponse.ok(), await tenantResponse.text()).toBeTruthy();
  const tenant = (await tenantResponse.json()) as ApiEnvelope<{ id: string }>;
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_URL ??
          "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public",
      },
    },
  });

  try {
    await prisma.knowledgeV2Settings.update({
      where: { tenantId: tenant.data.id },
      data: {
        retrievalProcessorPolicy: {
          schemaVersion: 1,
          policyVersion: "qa-retrieval-v1",
          approved: true,
          queryEmbedding: {
            provider: "openai-compatible",
            deployment: "qa-embedding",
            region: "local",
            allowedClassifications: ["PUBLIC", "INTERNAL"],
          },
          reranker: {
            provider: "qa-reranker",
            model: "qa-reranker",
            version: "v1",
            region: "local",
            allowedClassifications: ["PUBLIC", "INTERNAL"],
          },
        } satisfies Prisma.InputJsonObject,
        modelProcessorPolicy: {
          schemaVersion: 1,
          policyVersion: "qa-model-v1",
          approved: true,
          promptPolicyVersion: "qa-grounded-prompt-v1",
          groundedAnswer: {
            provider: "qa-grounded-answer",
            model: "qa-grounded-answer",
            version: "v1",
            region: "local",
            allowedClassifications: ["PUBLIC", "INTERNAL"],
          },
        } satisfies Prisma.InputJsonObject,
        draftGeneration: { increment: 1 },
        etag: { increment: 1 },
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  const settingsResponse = await context.get(`${apiBase}/knowledge/v2/settings`);
  expect(settingsResponse.ok(), await settingsResponse.text()).toBeTruthy();
  return settingsResponse.headers().etag;
}

async function errorCode(response: APIResponse) {
  const payload = (await response.json()) as {
    error?: { code?: string; requestId?: string; details?: Record<string, unknown> };
  };
  expect(payload.error?.requestId).toBeTruthy();
  return payload.error;
}

async function waitForJob(context: APIRequestContext, jobId: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await context.get(`${apiBase}/knowledge/v2/jobs/${encodeURIComponent(jobId)}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const payload = (await response.json()) as ApiEnvelope<KnowledgeV2JobView>;
    if (payload.data.status === "SUCCEEDED") return payload.data;
    if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(payload.data.status)) {
      throw new Error(`Knowledge job ${jobId} ended as ${payload.data.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Knowledge job ${jobId} did not finish.`);
}

async function waitForRecovery(prisma: PrismaClient, outboxId: string, jobId: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const [outbox, job] = await Promise.all([
      prisma.knowledgeOutbox.findUnique({ where: { id: outboxId }, select: { status: true } }),
      prisma.knowledgeJob.findUnique({ where: { id: jobId }, select: { status: true } }),
    ]);
    if (outbox?.status === "PUBLISHED" && job?.status === "SUCCEEDED") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Committed publication was not reconciled after dispatcher recovery.");
}

test("owner verification derives an immutable OWNER_VERIFIED successor from an imported fact", async ({
  request,
}) => {
  await signup(request, "imported-verification");

  const tenantResponse = await request.get(`${apiBase}/current-tenant`);
  expect(tenantResponse.ok(), await tenantResponse.text()).toBeTruthy();
  const tenant = (await tenantResponse.json()) as ApiEnvelope<{ id: string }>;
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_URL ??
          "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public",
      },
    },
  });

  try {
    const owner = await prisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.data.id, role: "OWNER" },
      select: { userId: true },
    });
    const factKey = `catalog/imported-service-${Date.now()}`;
    const source = await prisma.$transaction(async (tx) => {
      const fact = await tx.knowledgeV2Fact.create({
        data: {
          tenantId: tenant.data.id,
          entityType: "CATALOG_ITEM",
          factKey,
          fieldType: "TEXT",
          latestVersionNumber: 1,
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
      });
      const version = await tx.knowledgeV2FactVersion.create({
        data: {
          tenantId: tenant.data.id,
          factId: fact.id,
          versionNumber: 1,
          normalizedValue: "Imported air-conditioner installation",
          displayValue: "Imported air-conditioner installation",
          locale: "en",
          localeBehavior: "LANGUAGE_NEUTRAL",
          riskLevel: "LOW",
          authority: "IMPORTED",
          lifecycleStatus: "DRAFT",
          verificationStatus: "UNVERIFIED",
          immutableHash: key("imported-source-hash"),
          createdByUserId: owner.userId,
        },
      });
      await tx.knowledgeV2Evidence.create({
        data: {
          tenantId: tenant.data.id,
          kind: "EXTERNAL_REFERENCE",
          factVersionId: version.id,
          label: "Imported CSV fixture",
          locator: "fixture://services.csv",
          sourceReference: { fixture: "services.csv", factKey },
          createdByUserId: owner.userId,
        },
      });
      return version;
    });

    const factsResponse = await request.get(
      `${apiBase}/knowledge/v2/facts?query=${encodeURIComponent(factKey)}`,
    );
    expect(factsResponse.ok(), await factsResponse.text()).toBeTruthy();
    const facts = (await factsResponse.json()) as ApiEnvelope<{
      items: KnowledgeV2FactView[];
    }>;
    const importedFact = facts.data.items.find((item) => item.factKey === factKey);
    if (!importedFact) throw new Error("Seeded imported fact was not returned by the API.");
    expect(importedFact.authority).toBe("IMPORTED");
    expect(importedFact.verificationStatus).toBe("UNVERIFIED");
    expect(importedFact.allowedActions).toContain("VERIFY");

    const verifiedResponse = await request.post(
      `${apiBase}/knowledge/v2/facts/${importedFact.id}/verify`,
      {
        headers: {
          "Idempotency-Key": key("verify-imported-fact"),
          "If-Match": importedFact.etag,
        },
        data: { note: "Owner verified the imported service." },
      },
    );
    expect(verifiedResponse.ok(), await verifiedResponse.text()).toBeTruthy();
    const verified = (
      (await verifiedResponse.json()) as ApiEnvelope<KnowledgeV2MutationResult<KnowledgeV2FactView>>
    ).data.resource;
    expect(verified.version).toBe(2);
    expect(verified.authority).toBe("OWNER_VERIFIED");
    expect(verified.verificationStatus).toBe("VERIFIED");

    const lineage = await prisma.knowledgeV2FactVersion.findMany({
      where: { tenantId: tenant.data.id, factId: importedFact.id },
      orderBy: { versionNumber: "asc" },
      include: { evidence: true },
    });
    expect(lineage).toHaveLength(2);
    expect(lineage[0]?.id).toBe(source.id);
    expect(lineage[0]?.authority).toBe("IMPORTED");
    expect(lineage[0]?.verificationStatus).toBe("UNVERIFIED");
    expect(lineage[0]?.verifiedByUserId).toBeNull();
    expect(lineage[0]?.immutableHash).toBe(source.immutableHash);
    expect(lineage[0]?.evidence).toHaveLength(1);
    expect(lineage[1]?.supersedesVersionId).toBe(source.id);
    expect(lineage[1]?.authority).toBe("OWNER_VERIFIED");
    expect(lineage[1]?.verificationStatus).toBe("VERIFIED");
    expect(lineage[1]?.verifiedByUserId).toBe(owner.userId);
    expect(lineage[1]?.immutableHash).not.toBe(source.immutableHash);
    expect(lineage[1]?.evidence).toHaveLength(2);
  } finally {
    await prisma.$disconnect();
  }
});

test("Knowledge v2 supports conditional drafts, explicit publication, and exact rollback", async ({
  request,
}) => {
  await signup(request, "primary");

  const initialSettingsResponse = await request.get(`${apiBase}/knowledge/v2/settings`);
  expect(initialSettingsResponse.ok(), await initialSettingsResponse.text()).toBeTruthy();
  const initialSettings =
    (await initialSettingsResponse.json()) as ApiEnvelope<KnowledgeV2SettingsView>;
  const initialSettingsEtag = initialSettingsResponse.headers().etag;
  expect(initialSettings.data.defaultLocale).toBe("en");
  expect(initialSettings.data.defaultScope).toBeNull();
  expect(initialSettings.data.defaultScopeGeneration).toBe(0);
  expect(initialSettings.data.defaultScopeHash).toBeNull();
  expect(initialSettingsEtag).toMatch(/^"kv2-/);

  const missingHeaders = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    data: { supportedLocales: ["en", "fr"] },
  });
  expect(missingHeaders.status()).toBe(400);
  expect((await errorCode(missingHeaders))?.code).toBe(
    "KNOWLEDGE_VALIDATION_IDEMPOTENCY_KEY_REQUIRED",
  );

  const settingsKey = key("settings");
  const settingsHeaders = {
    "Idempotency-Key": settingsKey,
    "If-Match": initialSettingsEtag,
  };
  const settingsUpdate = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    headers: settingsHeaders,
    data: {
      defaultLocale: "en",
      supportedLocales: ["en", "fr"],
      defaultScope: { audiences: ["PUBLIC"] },
    },
  });
  expect(settingsUpdate.ok(), await settingsUpdate.text()).toBeTruthy();
  const settingsPayload = (await settingsUpdate.json()) as ApiEnvelope<
    KnowledgeV2MutationResult<KnowledgeV2SettingsView>
  >;
  expect(settingsPayload.data.idempotencyReplayed).toBe(false);
  expect(settingsPayload.data.resource.supportedLocales).toEqual(["en", "fr"]);
  expect(settingsPayload.data.resource.defaultScope?.audiences).toEqual(["PUBLIC"]);
  expect(settingsPayload.data.resource.defaultScopeGeneration).toBe(1);
  expect(settingsPayload.data.resource.defaultScopeHash).toMatch(/^[a-f0-9]{64}$/u);
  const currentSettingsEtag = await installProcessorPolicyFixture(request);

  const settingsReplay = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    headers: settingsHeaders,
    data: {
      defaultLocale: "en",
      supportedLocales: ["en", "fr"],
      defaultScope: { audiences: ["PUBLIC"] },
    },
  });
  expect(settingsReplay.ok(), await settingsReplay.text()).toBeTruthy();
  expect(
    (
      (await settingsReplay.json()) as ApiEnvelope<
        KnowledgeV2MutationResult<KnowledgeV2SettingsView>
      >
    ).data.idempotencyReplayed,
  ).toBe(true);

  const emptyDefaultScope = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    headers: {
      "Idempotency-Key": key("empty-default-scope"),
      "If-Match": currentSettingsEtag,
    },
    data: { defaultScope: {} },
  });
  expect(emptyDefaultScope.status()).toBe(400);
  expect((await errorCode(emptyDefaultScope))?.code).toBe(
    "KNOWLEDGE_VALIDATION_SCOPE_AUDIENCE_REQUIRED",
  );

  const changedReplay = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    headers: settingsHeaders,
    data: { defaultLocale: "fr", supportedLocales: ["en", "fr"] },
  });
  expect(changedReplay.status()).toBe(409);
  expect((await errorCode(changedReplay))?.code).toBe("IDEMPOTENCY_KEY_REUSED");

  const staleSettings = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    headers: { "Idempotency-Key": key("stale-settings"), "If-Match": initialSettingsEtag },
    data: { autoPublishPolicy: "OFF" },
  });
  expect(staleSettings.status()).toBe(412);
  const staleError = await errorCode(staleSettings);
  expect(staleError?.code).toBe("REVISION_CONFLICT");
  expect(staleError?.details?.currentEtag).toBe(currentSettingsEtag);

  const invalidFact = await request.post(`${apiBase}/knowledge/v2/facts`, {
    headers: { "Idempotency-Key": key("invalid-fact") },
    data: { factKey: "x", unknownField: "not allowed" },
  });
  expect(invalidFact.status()).toBe(400);
  const invalidFactPayload = (await invalidFact.json()) as {
    error?: { code?: string; fieldErrors?: Array<{ field: string }> };
  };
  expect(invalidFactPayload.error?.code).toBe("KNOWLEDGE_VALIDATION_INPUT_INVALID");
  expect(invalidFactPayload.error?.fieldErrors?.length).toBeGreaterThan(0);

  const spoofedAuthority = await request.post(`${apiBase}/knowledge/v2/facts`, {
    headers: { "Idempotency-Key": key("spoofed-authority") },
    data: {
      factKey: "business/spoofed-authority",
      entityType: "BUSINESS_PROFILE",
      fieldType: "TEXT",
      normalizedValue: "Untrusted claim",
      locale: "en",
      localeBehavior: "LANGUAGE_NEUTRAL",
      riskLevel: "LOW",
      authority: "TRUSTED_SOURCE",
    },
  });
  expect(spoofedAuthority.status()).toBe(400);
  expect((await errorCode(spoofedAuthority))?.code).toBe(
    "KNOWLEDGE_VALIDATION_AUTHORITY_READ_ONLY",
  );

  const factResponse = await request.post(`${apiBase}/knowledge/v2/facts`, {
    headers: { "Idempotency-Key": key("fact") },
    data: {
      factKey: "business/name",
      entityType: "BUSINESS_PROFILE",
      fieldType: "TEXT",
      normalizedValue: "North Star Studio",
      displayValue: "North Star Studio",
      locale: "en",
      localeBehavior: "LANGUAGE_NEUTRAL",
      riskLevel: "LOW",
      authority: "MANUAL",
    },
  });
  expect(factResponse.status(), await factResponse.text()).toBe(201);
  const fact = (
    (await factResponse.json()) as ApiEnvelope<KnowledgeV2MutationResult<KnowledgeV2FactView>>
  ).data.resource;
  expect(fact.version).toBe(1);

  const verifiedFactResponse = await request.post(
    `${apiBase}/knowledge/v2/facts/${fact.id}/verify`,
    {
      headers: {
        "Idempotency-Key": key("verify-fact"),
        "If-Match": factResponse.headers().etag,
      },
      data: { note: "Verified for initial publication." },
    },
  );
  expect(verifiedFactResponse.ok(), await verifiedFactResponse.text()).toBeTruthy();
  const verifiedFact = (
    (await verifiedFactResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2FactView>
    >
  ).data.resource;
  expect(verifiedFact.authority).toBe("OWNER_VERIFIED");

  const changedAuthority = await request.patch(`${apiBase}/knowledge/v2/facts/${fact.id}`, {
    headers: {
      "Idempotency-Key": key("changed-authority"),
      "If-Match": verifiedFactResponse.headers().etag,
    },
    data: { authority: "TRUSTED_SOURCE" },
  });
  expect(changedAuthority.status()).toBe(400);
  expect((await errorCode(changedAuthority))?.code).toBe(
    "KNOWLEDGE_VALIDATION_AUTHORITY_READ_ONLY",
  );

  const highRiskExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  const highRiskFactResponse = await request.post(`${apiBase}/knowledge/v2/facts`, {
    headers: { "Idempotency-Key": key("high-risk-fact") },
    data: {
      factKey: "catalog/consultation/price",
      entityType: "CATALOG_ITEM",
      fieldType: "MONEY",
      normalizedValue: 125,
      displayValue: "125 EUR",
      currency: "EUR",
      locale: "en",
      localeBehavior: "LANGUAGE_NEUTRAL",
      riskLevel: "HIGH",
      authority: "MANUAL",
      effectiveUntil: highRiskExpiry,
    },
  });
  expect(highRiskFactResponse.status(), await highRiskFactResponse.text()).toBe(201);
  const highRiskFact = (
    (await highRiskFactResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2FactView>
    >
  ).data.resource;

  const verifiedHighRiskFactResponse = await request.post(
    `${apiBase}/knowledge/v2/facts/${highRiskFact.id}/verify`,
    {
      headers: {
        "Idempotency-Key": key("verify-high-risk-fact"),
        "If-Match": highRiskFactResponse.headers().etag,
      },
      data: { note: "Owner verified the time-bounded high-risk price." },
    },
  );
  expect(verifiedHighRiskFactResponse.ok(), await verifiedHighRiskFactResponse.text()).toBeTruthy();
  const verifiedHighRiskFact = (
    (await verifiedHighRiskFactResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2FactView>
    >
  ).data.resource;
  expect(verifiedHighRiskFact.authority).toBe("OWNER_VERIFIED");
  expect(verifiedHighRiskFact.riskLevel).toBe("HIGH");
  expect(verifiedHighRiskFact.effectiveUntil).toBe(highRiskExpiry);

  const guidanceResponse = await request.post(`${apiBase}/knowledge/v2/guidance`, {
    headers: { "Idempotency-Key": key("guidance") },
    data: {
      title: "Unresolved pricing escalation",
      type: "ESCALATION",
      condition: { kind: "PREDICATE", field: "INTENT", operator: "EQUALS", value: "pricing" },
      instruction: "Require a human handoff when verified knowledge cannot resolve pricing.",
      priority: 100,
      tieBreakKey: "pricing.unresolved-handoff",
      riskLevel: "LOW",
    },
  });
  expect(guidanceResponse.status(), await guidanceResponse.text()).toBe(201);
  const guidance = (
    (await guidanceResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>
    >
  ).data.resource;

  const approvedGuidanceResponse = await request.post(
    `${apiBase}/knowledge/v2/guidance/${guidance.id}/approve`,
    {
      headers: {
        "Idempotency-Key": key("approve-guidance"),
        "If-Match": guidanceResponse.headers().etag,
      },
      data: { note: "Approved for initial publication." },
    },
  );
  expect(approvedGuidanceResponse.ok(), await approvedGuidanceResponse.text()).toBeTruthy();

  const readinessResponse = await request.get(`${apiBase}/knowledge/v2/readiness`);
  expect(readinessResponse.ok(), await readinessResponse.text()).toBeTruthy();
  const readiness = (await readinessResponse.json()) as ApiEnvelope<KnowledgeV2ReadinessView>;
  expect(readiness.data.serving.status).toBe("NOT_READY");
  expect(readiness.data.draft.itemCounts.factVersions).toBe(2);
  expect(readiness.data.draft.itemCounts.guidanceRuleVersions).toBe(1);
  const candidateA = readiness.data.candidateId;
  if (!candidateA) throw new Error("Knowledge readiness omitted candidateId.");
  expect(readiness.data.candidateManifestHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(readiness.data.draft.candidateManifestHash).toBe(readiness.data.candidateManifestHash);
  expect(readiness.data.draft.evaluationTestCaseSetHash).toMatch(/^[a-f0-9]{64}$/u);

  const validationResponse = await request.post(`${apiBase}/knowledge/v2/publications/validate`, {
    headers: { "Idempotency-Key": key("validate-a") },
    data: {
      targetKey: "workspace-v2",
      candidateId: candidateA,
      candidateVersion: readiness.data.candidateVersion,
    },
  });
  expect(validationResponse.status(), await validationResponse.text()).toBe(201);
  const validation = (
    (await validationResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>
    >
  ).data.resource;
  expect(["PASSED", "PASSED_WITH_WARNINGS"]).toContain(validation.status);
  expect(validation.candidateManifestHash).toBe(readiness.data.candidateManifestHash);
  const validatedReadinessResponse = await request.get(`${apiBase}/knowledge/v2/readiness`);
  const validatedReadiness =
    (await validatedReadinessResponse.json()) as ApiEnvelope<KnowledgeV2ReadinessView>;
  expect(validatedReadiness.data.draft.validationId).toBe(validation.id);
  expect(validatedReadiness.data.draft.candidateManifestHash).toBe(
    validation.candidateManifestHash,
  );

  const publishAResponse = await request.post(`${apiBase}/knowledge/v2/publications`, {
    headers: { "Idempotency-Key": key("publish-a") },
    data: {
      targetKey: "workspace-v2",
      candidateId: candidateA,
      candidateVersion: readiness.data.candidateVersion,
      validationId: validation.id,
    },
  });
  expect(publishAResponse.status(), await publishAResponse.text()).toBe(202);
  const publishA = (await publishAResponse.json()) as ApiEnvelope<KnowledgeV2AcceptedMutation>;
  await waitForJob(request, publishA.data.jobId);

  const activeAResponse = await request.get(`${apiBase}/knowledge/v2/publications/active`);
  expect(activeAResponse.ok(), await activeAResponse.text()).toBeTruthy();
  const activeA = (await activeAResponse.json()) as ApiEnvelope<KnowledgeV2PublicationDetail>;
  expect(activeA.data.status).toBe("ACTIVE");
  expect(activeA.data.items).toHaveLength(3);
  expect(
    activeA.data.items.every(
      (item) =>
        item.usesTenantDefaultScope &&
        item.tenantDefaultScopeGeneration === 1 &&
        item.tenantDefaultScopeHash === settingsPayload.data.resource.defaultScopeHash,
    ),
  ).toBe(true);

  const factUpdateResponse = await request.patch(`${apiBase}/knowledge/v2/facts/${fact.id}`, {
    headers: {
      "Idempotency-Key": key("fact-update"),
      "If-Match": verifiedFactResponse.headers().etag,
    },
    data: { normalizedValue: "North Star Studio Paris", displayValue: "North Star Studio Paris" },
  });
  expect(factUpdateResponse.ok(), await factUpdateResponse.text()).toBeTruthy();

  const reverifiedFactResponse = await request.post(
    `${apiBase}/knowledge/v2/facts/${fact.id}/verify`,
    {
      headers: {
        "Idempotency-Key": key("reverify-fact"),
        "If-Match": factUpdateResponse.headers().etag,
      },
      data: { note: "Verified after the business name update." },
    },
  );
  expect(reverifiedFactResponse.ok(), await reverifiedFactResponse.text()).toBeTruthy();

  const readinessBResponse = await request.get(`${apiBase}/knowledge/v2/readiness`);
  const readinessB = (await readinessBResponse.json()) as ApiEnvelope<KnowledgeV2ReadinessView>;
  expect(readinessB.data.serving.status).toBe("READY");
  expect(readinessB.data.draft.status).toBe("CHANGES_PENDING");
  const candidateB = readinessB.data.candidateId;
  if (!candidateB) throw new Error("Updated readiness omitted candidateId.");

  const validationBResponse = await request.post(`${apiBase}/knowledge/v2/publications/validate`, {
    headers: { "Idempotency-Key": key("validate-b") },
    data: {
      targetKey: "workspace-v2",
      candidateId: candidateB,
      candidateVersion: readinessB.data.candidateVersion,
    },
  });
  const validationB = (
    (await validationBResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>
    >
  ).data.resource;
  const publishBResponse = await request.post(`${apiBase}/knowledge/v2/publications`, {
    headers: { "Idempotency-Key": key("publish-b") },
    data: {
      targetKey: "workspace-v2",
      candidateId: candidateB,
      candidateVersion: readinessB.data.candidateVersion,
      validationId: validationB.id,
    },
  });
  expect(publishBResponse.status(), await publishBResponse.text()).toBe(202);
  const publishB = (await publishBResponse.json()) as ApiEnvelope<KnowledgeV2AcceptedMutation>;
  await waitForJob(request, publishB.data.jobId);

  const activeBResponse = await request.get(`${apiBase}/knowledge/v2/publications/active`);
  const activeB = (await activeBResponse.json()) as ApiEnvelope<KnowledgeV2PublicationDetail>;
  expect(activeB.data.id).not.toBe(activeA.data.id);
  expect(activeB.data.sequence).toBeGreaterThan(activeA.data.sequence);

  const tenantResponse = await request.get(`${apiBase}/current-tenant`);
  const tenantPayload = (await tenantResponse.json()) as ApiEnvelope<{ id: string }>;
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_URL ??
          "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public",
      },
    },
  });
  try {
    const [outboxA, jobA] = await Promise.all([
      prisma.knowledgeOutbox.findFirstOrThrow({
        where: {
          tenantId: tenantPayload.data.id,
          aggregateId: activeA.data.id,
          eventType: "knowledge.v2.publication.activate.requested",
        },
      }),
      prisma.knowledgeJob.findFirstOrThrow({
        where: { tenantId: tenantPayload.data.id, publicationId: activeA.data.id },
      }),
    ]);
    await prisma.$transaction([
      prisma.knowledgeOutbox.update({
        where: { id: outboxA.id },
        data: {
          status: "PUBLISHING",
          attemptCount: 5,
          lockedAt: new Date(Date.now() - 120_000),
          lockedBy: "crashed-worker",
          deadlineAt: new Date(Date.now() - 1_000),
          publishedAt: null,
          lastErrorCode: "SIMULATED_CRASH",
        },
      }),
      prisma.knowledgeJob.update({
        where: { id: jobA.id },
        data: {
          status: "DEAD_LETTER",
          errorCode: "SIMULATED_CRASH",
          completedAt: new Date(),
        },
      }),
    ]);
    await waitForRecovery(prisma, outboxA.id, jobA.id);
  } finally {
    await prisma.$disconnect();
  }

  const rollbackResponse = await request.post(
    `${apiBase}/knowledge/v2/publications/${activeA.data.id}/rollback`,
    {
      headers: {
        "Idempotency-Key": key("rollback-a"),
        "If-Match": activeBResponse.headers().etag,
      },
      data: { reason: "Restore the previous verified manifest." },
    },
  );
  expect(rollbackResponse.status(), await rollbackResponse.text()).toBe(202);
  const rollback = (await rollbackResponse.json()) as ApiEnvelope<KnowledgeV2AcceptedMutation>;
  await waitForJob(request, rollback.data.jobId);

  const activeCResponse = await request.get(`${apiBase}/knowledge/v2/publications/active`);
  const activeC = (await activeCResponse.json()) as ApiEnvelope<KnowledgeV2PublicationDetail>;
  expect(activeC.data.id).not.toBe(activeA.data.id);
  expect(activeC.data.id).not.toBe(activeB.data.id);
  expect(activeC.data.sequence).toBeGreaterThan(activeB.data.sequence);
  expect(activeC.data.sourcePublicationId).toBe(activeA.data.id);
  expect(activeC.data.items.map((item) => `${item.type}:${item.versionId}`).sort()).toEqual(
    activeA.data.items.map((item) => `${item.type}:${item.versionId}`).sort(),
  );

  const [historyAResponse, historyBResponse] = await Promise.all([
    request.get(`${apiBase}/knowledge/v2/publications/${activeA.data.id}`),
    request.get(`${apiBase}/knowledge/v2/publications/${activeB.data.id}`),
  ]);
  const historyA = (await historyAResponse.json()) as ApiEnvelope<KnowledgeV2PublicationDetail>;
  const historyB = (await historyBResponse.json()) as ApiEnvelope<KnowledgeV2PublicationDetail>;
  expect(historyA.data.status).toBe("SUPERSEDED");
  expect(historyB.data.status).toBe("ROLLED_BACK");

  const secondary = await playwrightRequest.newContext();
  try {
    await signup(secondary, "secondary");
    const isolated = await secondary.get(`${apiBase}/knowledge/v2/publications/${activeA.data.id}`);
    expect(isolated.status()).toBe(404);
  } finally {
    await secondary.dispose();
  }

  const changedDefaultScopeResponse = await request.patch(`${apiBase}/knowledge/v2/settings`, {
    headers: {
      "Idempotency-Key": key("change-default-scope"),
      "If-Match": currentSettingsEtag,
    },
    data: { defaultScope: { audiences: ["INTERNAL"] } },
  });
  expect(changedDefaultScopeResponse.ok(), await changedDefaultScopeResponse.text()).toBeTruthy();
  const changedDefaultScope = (
    (await changedDefaultScopeResponse.json()) as ApiEnvelope<
      KnowledgeV2MutationResult<KnowledgeV2SettingsView>
    >
  ).data.resource;
  expect(changedDefaultScope.defaultScopeGeneration).toBe(2);
  expect(changedDefaultScope.defaultScopeHash).not.toBe(
    settingsPayload.data.resource.defaultScopeHash,
  );

  const revokedReadinessResponse = await request.get(`${apiBase}/knowledge/v2/readiness`);
  expect(revokedReadinessResponse.ok(), await revokedReadinessResponse.text()).toBeTruthy();
  const revokedReadiness = (
    (await revokedReadinessResponse.json()) as ApiEnvelope<KnowledgeV2ReadinessView>
  ).data;
  expect(revokedReadiness.serving.status).toBe("NOT_READY");
});
