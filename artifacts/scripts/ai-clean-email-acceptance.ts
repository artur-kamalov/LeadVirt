import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";
import { KnowledgeV2HybridQdrantClient } from "../../packages/knowledge/src/v2-hybrid-qdrant.js";

loadEnvFile();

if (process.env.NODE_ENV === "production") {
  throw new Error("qa:ai:acceptance requires the non-production mock email OTP provider.");
}

const apiBaseUrl = (
  process.env.LEADVIRT_API_BASE ??
  process.env.API_BASE_URL ??
  "http://localhost:4001/api"
).replace(/\/$/, "");
const apiOrigin = apiBaseUrl.replace(/\/api$/, "");
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
const workerMetricsUrl = process.env.WORKER_METRICS_URL ?? "http://localhost:4002/metrics";
const expectedAnswer = "Polar Lantern Studio's signature service code is AURORA-7291.";

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cookieFromResponse(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const raw = values.join("; ");
  const match = raw.match(/leadvirt_session=([^;]+)/);
  assert(match?.[1], "Auth response did not set leadvirt_session cookie.");
  return `leadvirt_session=${match[1]}`;
}

async function apiJson(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-leadvirt-qa": "playwright",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed ${response.status}: ${text}`);
  }
  return { response, payload };
}

function getData(payload: unknown) {
  assert(isRecord(payload), "API response is not an object.");
  assert(payload.data !== undefined, "API response has no data field.");
  return payload.data;
}

function mutationResource(payload: unknown) {
  const data = getData(payload);
  assert(isRecord(data) && isRecord(data.resource), "Mutation response has no resource.");
  return data.resource;
}

function idempotencyKey(suffix: string, label: string) {
  return `ai-acceptance:${label}:${suffix}`;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required for structured AI acceptance.`);
  return value;
}

function acceptanceRedisConnection(value: string) {
  const url = new URL(value);
  assert(url.protocol === "redis:" || url.protocol === "rediss:", "REDIS_URL is invalid.");
  const database = url.pathname.replace(/^\//u, "");
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(database ? { db: Number(database) } : {}),
    ...(url.protocol === "rediss:" ? { tls: { servername: url.hostname } } : {}),
    maxRetriesPerRequest: null,
  };
}

async function waitFor<T>(
  label: string,
  read: () => Promise<T | null>,
  timeoutMs = 45_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await read();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

async function createVerifiedFact(
  cookie: string,
  suffix: string,
  label: string,
  input: JsonRecord,
) {
  const created = await apiJson("/knowledge/v2/facts", {
    method: "POST",
    headers: { cookie, "Idempotency-Key": idempotencyKey(suffix, `fact-${label}`) },
    body: JSON.stringify(input),
  });
  const fact = mutationResource(created.payload);
  assert(typeof fact.id === "string", `${label} fact has no id.`);
  const etag = created.response.headers.get("etag");
  assert(etag, `${label} fact has no ETag.`);
  await apiJson(`/knowledge/v2/facts/${encodeURIComponent(fact.id)}/verify`, {
    method: "POST",
    headers: {
      cookie,
      "Idempotency-Key": idempotencyKey(suffix, `verify-${label}`),
      "If-Match": etag,
    },
    body: JSON.stringify({ note: "Verified by the AI acceptance owner." }),
  });
  return fact;
}

async function createApprovedEscalation(cookie: string, suffix: string) {
  const created = await apiJson("/knowledge/v2/guidance", {
    method: "POST",
    headers: { cookie, "Idempotency-Key": idempotencyKey(suffix, "guidance") },
    body: JSON.stringify({
      title: "Human support escalation",
      type: "ESCALATION",
      condition: {
        kind: "PREDICATE",
        field: "INTENT",
        operator: "EQUALS",
        value: "human_handoff",
      },
      instruction: "Escalate explicit requests for a human manager.",
      priority: 100,
      tieBreakKey: "acceptance.human-escalation",
      riskLevel: "LOW",
    }),
  });
  const guidance = mutationResource(created.payload);
  assert(typeof guidance.id === "string", "Escalation guidance has no id.");
  const etag = created.response.headers.get("etag");
  assert(etag, "Escalation guidance has no ETag.");
  await apiJson(`/knowledge/v2/guidance/${encodeURIComponent(guidance.id)}/approve`, {
    method: "POST",
    headers: {
      cookie,
      "Idempotency-Key": idempotencyKey(suffix, "approve-guidance"),
      "If-Match": etag,
    },
    body: JSON.stringify({ note: "Approved by the AI acceptance owner." }),
  });
}

async function configureKnowledgeSettings(cookie: string, suffix: string) {
  const current = await apiJson("/knowledge/v2/settings", { headers: { cookie } });
  const etag = current.response.headers.get("etag");
  assert(etag, "Knowledge settings have no ETag.");
  const embeddingDeployment = requiredEnv("KNOWLEDGE_V2_EMBEDDING_DEPLOYMENT");
  const embeddingRegion = requiredEnv("KNOWLEDGE_V2_EMBEDDING_REGION");
  const rerankerProvider = requiredEnv("KNOWLEDGE_V2_RERANKER_PROVIDER");
  const rerankerModel = requiredEnv("KNOWLEDGE_V2_RERANKER_MODEL");
  const rerankerVersion = requiredEnv("KNOWLEDGE_V2_RERANKER_VERSION");
  const rerankerRegion = requiredEnv("KNOWLEDGE_V2_RERANKER_REGION");
  const groundedProvider = requiredEnv("KNOWLEDGE_V2_GROUNDED_ANSWER_PROVIDER");
  const groundedModel = requiredEnv("KNOWLEDGE_V2_GROUNDED_ANSWER_MODEL");
  const groundedVersion = requiredEnv("KNOWLEDGE_V2_GROUNDED_ANSWER_VERSION");
  const groundedRegion = requiredEnv("KNOWLEDGE_V2_GROUNDED_ANSWER_REGION");
  await apiJson("/knowledge/v2/settings", {
    method: "PATCH",
    headers: {
      cookie,
      "Idempotency-Key": idempotencyKey(suffix, "knowledge-settings"),
      "If-Match": etag,
    },
    body: JSON.stringify({
      defaultLocale: "en",
      supportedLocales: ["en"],
      defaultScope: {
        audiences: ["PUBLIC"],
      },
      embeddingProviderPolicy: {
        schemaVersion: 1,
        policyVersion: process.env.KNOWLEDGE_V2_EMBEDDING_POLICY_VERSION ?? "external-embedding-v1",
        approved: true,
        provider: "openai-compatible",
        deployment: embeddingDeployment,
        region: embeddingRegion,
        allowedClassifications: ["PUBLIC", "INTERNAL"],
      },
      retrievalProcessorPolicy: {
        schemaVersion: 1,
        policyVersion: process.env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION ?? "external-retrieval-v1",
        approved: true,
        queryEmbedding: {
          provider: "openai-compatible",
          deployment: embeddingDeployment,
          region: embeddingRegion,
          allowedClassifications: ["PUBLIC", "INTERNAL", "SECRET"],
        },
        reranker: {
          provider: rerankerProvider,
          model: rerankerModel,
          version: rerankerVersion,
          region: rerankerRegion,
          allowedClassifications: ["PUBLIC", "INTERNAL"],
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
          region: groundedRegion,
          allowedClassifications: ["PUBLIC", "INTERNAL"],
        },
      },
    }),
  });
}

async function deleteQdrantSnapshots(tenantId: string) {
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

async function cleanupEmailUser(email: string) {
  await prisma.authEmailOtpChallenge.deleteMany({ where: { email } });
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, memberships: { select: { tenantId: true } } },
  });
  if (!user) return;
  const tenantIds = user.memberships.map((membership) => membership.tenantId);
  for (const tenantId of tenantIds) {
    await deleteQdrantSnapshots(tenantId);
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const tenantTables = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenantId' ORDER BY table_name",
    );
    for (const tenantId of tenantIds) {
      for (const { table_name: table } of tenantTables) {
        const safeTable = table.replaceAll('"', '""');
        await tx.$executeRawUnsafe(`DELETE FROM "${safeTable}" WHERE "tenantId" = $1`, tenantId);
      }
      await tx.$executeRawUnsafe('DELETE FROM "Tenant" WHERE "id" = $1', tenantId);
    }
    const userTables = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'userId' ORDER BY table_name",
    );
    for (const { table_name: table } of userTables) {
      const safeTable = table.replaceAll('"', '""');
      await tx.$executeRawUnsafe(`DELETE FROM "${safeTable}" WHERE "userId" = $1`, user.id);
    }
    await tx.$executeRawUnsafe('DELETE FROM "User" WHERE "id" = $1', user.id);
  });
}

function metadataRecord(value: unknown) {
  assert(isRecord(value), "AI message metadata is not an object.");
  return value;
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function main() {
  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(3_000) }).catch(
    () => null,
  );
  assert(health?.ok, `LeadVirt API is not running at ${apiOrigin}.`);

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const email = `ai-acceptance-${suffix}@example.com`;
  const publicKey = `lvwd_accept_${suffix.replace(/-/g, "_")}`;
  const connection = acceptanceRedisConnection(redisUrl);
  const aiQueue = new Queue("ai.reply", { connection });
  let tenantId: string | null = null;
  let userId: string | null = null;
  let aiJobId: string | null = null;

  try {
    await cleanupEmailUser(email);

    const otpRequest = getData(
      (
        await apiJson("/auth/email-otp/request", {
          method: "POST",
          body: JSON.stringify({ email, locale: "en" }),
        })
      ).payload,
    );
    assert(isRecord(otpRequest), "Email OTP request data is not an object.");
    assert(typeof otpRequest.challengeId === "string", "Email OTP challenge id is missing.");
    assert(
      typeof otpRequest.debugCode === "string" && /^\d{6}$/u.test(otpRequest.debugCode),
      "Mock email OTP code is missing.",
    );

    const login = await apiJson("/auth/email-otp/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeId: otpRequest.challengeId,
        code: otpRequest.debugCode,
      }),
    });
    const cookie = cookieFromResponse(login.response);
    const loginData = getData(login.payload);
    assert(isRecord(loginData), "Email OTP login data is not an object.");
    assert(loginData.isNewUser === true, "Expected email OTP auth to create a clean user.");
    assert(loginData.authMode === "email", "Expected email authMode.");

    const me = getData((await apiJson("/auth/me", { headers: { cookie } })).payload);
    assert(isRecord(me), "Auth me response is not an object.");
    assert(typeof me.tenantId === "string", "Auth me response has no tenant id.");
    assert(typeof me.id === "string", "Auth me response has no user id.");
    tenantId = me.tenantId;
    userId = me.id;

    const migrationStart = mutationResource(
      (
        await apiJson("/knowledge/v2/migrations/legacy", {
          method: "POST",
          headers: {
            cookie,
            "Idempotency-Key": idempotencyKey(suffix, "legacy-migration"),
          },
          body: JSON.stringify({ batchSize: 10 }),
        })
      ).payload,
    );
    assert(typeof migrationStart.id === "string", "Legacy migration has no id.");
    let migrationState = migrationStart;
    let migrationResumeAttempt = 0;
    const migration = await waitFor("empty legacy migration", async () => {
      if (["BLOCKED", "STALE", "FAILED"].includes(String(migrationState.status))) {
        throw new Error(`Legacy migration ended as ${String(migrationState.status)}.`);
      }
      if (migrationState.status === "READY") return migrationState;
      assert(typeof migrationState.generation === "number", "Legacy migration has no generation.");
      migrationResumeAttempt += 1;
      migrationState = mutationResource(
        (
          await apiJson(
            `/knowledge/v2/migrations/legacy/${encodeURIComponent(migrationStart.id as string)}/resume`,
            {
              method: "POST",
              headers: {
                cookie,
                "Idempotency-Key": idempotencyKey(
                  suffix,
                  `resume-migration-${migrationResumeAttempt}`,
                ),
              },
              body: JSON.stringify({
                generation: migrationState.generation,
                batchSize: 10,
              }),
            },
          )
        ).payload,
      );
      return migrationState.status === "READY" ? migrationState : null;
    });
    assert(typeof migration.generation === "number", "Legacy migration has no generation.");

    await configureKnowledgeSettings(cookie, suffix);

    const channel = getData(
      (
        await apiJson("/channels", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            type: "WEBSITE",
            name: "Acceptance Website Widget",
            publicKey,
            settings: {
              widget: {
                businessName: "Polar Lantern Studio",
                locale: "en-US",
              },
            },
          }),
        })
      ).payload,
    );
    assert(
      isRecord(channel) && typeof channel.id === "string" && channel.publicKey === publicKey,
      "Website channel was not created.",
    );

    await createVerifiedFact(cookie, suffix, "business-name", {
      factKey: "business/name",
      entityType: "BUSINESS_PROFILE",
      fieldType: "TEXT",
      normalizedValue: "Polar Lantern Studio",
      displayValue: "Polar Lantern Studio",
      locale: "en",
      localeBehavior: "LANGUAGE_NEUTRAL",
      riskLevel: "LOW",
      authority: "MANUAL",
    });
    await createVerifiedFact(cookie, suffix, "service-code", {
      factKey: "business/signature-service-code",
      entityType: "BUSINESS_PROFILE",
      fieldType: "TEXT",
      normalizedValue: expectedAnswer,
      displayValue: expectedAnswer,
      locale: "en",
      localeBehavior: "LANGUAGE_NEUTRAL",
      riskLevel: "LOW",
      authority: "MANUAL",
    });
    await createApprovedEscalation(cookie, suffix);

    const readiness = getData(
      (await apiJson("/knowledge/v2/readiness", { headers: { cookie } })).payload,
    );
    assert(isRecord(readiness), "Knowledge readiness is not an object.");
    assert(typeof readiness.candidateId === "string", "Knowledge readiness has no candidate id.");
    assert(
      typeof readiness.candidateVersion === "number",
      "Knowledge readiness has no candidate version.",
    );
    assert(isRecord(readiness.draft), "Knowledge readiness has no draft state.");
    assert(
      Array.isArray(readiness.draft.blockers) && readiness.draft.blockers.length === 0,
      `Knowledge draft has blockers: ${JSON.stringify(readiness.draft.blockers)}.`,
    );
    const generalFaq = arrayOfRecords(readiness.draft.capabilities).find(
      (capability) => capability.capabilityType === "GENERAL_FAQ",
    );
    assert(
      generalFaq?.enabled === true &&
        generalFaq.allowedAutonomy === "ANSWER_ONLY" &&
        generalFaq.blockerCount === 0,
      "GENERAL_FAQ is not ready for ANSWER_ONLY automation.",
    );
    const validation = mutationResource(
      (
        await apiJson("/knowledge/v2/publications/validate", {
          method: "POST",
          headers: {
            cookie,
            "Idempotency-Key": idempotencyKey(suffix, "validate-publication"),
          },
          body: JSON.stringify({
            targetKey: "workspace-v2",
            candidateId: readiness.candidateId,
            candidateVersion: readiness.candidateVersion,
          }),
        })
      ).payload,
    );
    assert(typeof validation.id === "string", "Knowledge validation has no id.");
    assert(
      ["PASSED", "PASSED_WITH_WARNINGS"].includes(String(validation.status)),
      `Knowledge validation ended as ${String(validation.status)}.`,
    );
    const publicationRequest = getData(
      (
        await apiJson("/knowledge/v2/publications", {
          method: "POST",
          headers: {
            cookie,
            "Idempotency-Key": idempotencyKey(suffix, "publish"),
          },
          body: JSON.stringify({
            targetKey: "workspace-v2",
            candidateId: readiness.candidateId,
            candidateVersion: readiness.candidateVersion,
            validationId: validation.id,
          }),
        })
      ).payload,
    );
    assert(
      isRecord(publicationRequest) && typeof publicationRequest.jobId === "string",
      "Publication request has no job id.",
    );
    await waitFor(
      "structured publication",
      async () => {
        const job = getData(
          (
            await apiJson(
              `/knowledge/v2/jobs/${encodeURIComponent(publicationRequest.jobId as string)}`,
              { headers: { cookie } },
            )
          ).payload,
        );
        assert(isRecord(job), "Publication job is not an object.");
        if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(String(job.status))) {
          throw new Error(`Publication job ended as ${String(job.status)}.`);
        }
        return job.status === "SUCCEEDED" ? job : null;
      },
      120_000,
    );
    const publication = getData(
      (await apiJson("/knowledge/v2/publications/active", { headers: { cookie } })).payload,
    );
    assert(
      isRecord(publication) &&
        typeof publication.id === "string" &&
        publication.status === "ACTIVE",
      "Structured publication is not active.",
    );
    assert(
      arrayOfRecords(publication.items).some((item) => item.type === "DOCUMENT_REVISION"),
      "Structured publication has no indexed document revision.",
    );
    const publicationRecord = await prisma.knowledgePublication.findFirst({
      where: { id: publication.id as string, tenantId: tenantId ?? "" },
      select: { retrievalPolicyVersion: true, promptPolicyVersion: true },
    });
    assert(
      publicationRecord?.retrievalPolicyVersion ===
        (process.env.KNOWLEDGE_V2_RETRIEVAL_POLICY_VERSION ?? "external-retrieval-v1") &&
        publicationRecord.promptPolicyVersion ===
          (process.env.KNOWLEDGE_V2_GROUNDED_PROMPT_POLICY_VERSION ?? "grounded-answer-v1"),
      "Structured publication did not capture the approved runtime processor policies.",
    );
    const selector = getData(
      (await apiJson("/knowledge/v2/migrations/corpus-selector", { headers: { cookie } })).payload,
    );
    assert(
      isRecord(selector) && typeof selector.generation === "number",
      "Corpus selector is not available.",
    );
    const cutover = mutationResource(
      (
        await apiJson("/knowledge/v2/migrations/corpus-selector/cutover", {
          method: "POST",
          headers: {
            cookie,
            "Idempotency-Key": idempotencyKey(suffix, "corpus-cutover"),
          },
          body: JSON.stringify({
            migrationId: migrationStart.id,
            migrationGeneration: migration.generation,
            selectorGeneration: selector.generation,
          }),
        })
      ).payload,
    );
    assert(cutover.corpusKind === "STRUCTURED_V2", "Structured corpus cutover did not complete.");
    const channelReadiness = getData(
      (
        await apiJson(`/channels/${encodeURIComponent(channel.id)}/automatic-replies/readiness`, {
          headers: { cookie },
        })
      ).payload,
    );
    assert(
      isRecord(channelReadiness) &&
        channelReadiness.status === "READY" &&
        channelReadiness.canActivate === true,
      "Website channel is not ready for automatic replies.",
    );
    const activation = getData(
      (
        await apiJson(`/channels/${encodeURIComponent(channel.id)}/automatic-replies/activate`, {
          method: "POST",
          headers: { cookie },
        })
      ).payload,
    );
    assert(
      isRecord(activation) && activation.enabled === true && activation.status === "ACTIVE",
      "Website automatic replies were not activated.",
    );

    const eventId = `ai-acceptance-${suffix}`;
    const inboundText = "What is Polar Lantern Studio's signature service code?";
    const intake = getData(
      (
        await apiJson(`/public/widget/${encodeURIComponent(publicKey)}/messages`, {
          method: "POST",
          body: JSON.stringify({
            sessionId: `session-${suffix}`,
            clientMessageId: eventId,
            text: inboundText,
            customer: {
              name: "Acceptance Client",
              phone: "+79990000001",
              email: `acceptance.${suffix}@example.com`,
            },
          }),
        })
      ).payload,
    );
    assert(isRecord(intake), "Widget intake data is not an object.");
    assert(isRecord(intake.ai) && intake.ai.intent === "queued", "Widget AI reply was not queued.");
    assert(typeof intake.conversationId === "string", "Widget intake has no conversation id.");
    assert(typeof intake.leadId === "string", "Widget intake has no lead id.");
    const inboundMessage = arrayOfRecords(intake.messages).find(
      (message) => message.senderType === "CUSTOMER",
    );
    assert(
      inboundMessage && typeof inboundMessage.id === "string",
      "Widget intake has no inbound message id.",
    );

    const conversationId = intake.conversationId;
    const leadId = intake.leadId;
    aiJobId = `ai-reply:${conversationId}:${inboundMessage.id}`;

    const aiMessage = await waitFor("structured AI reply", async () => {
      assert(tenantId, "Tenant id was not resolved.");
      const message = await prisma.message.findFirst({
        where: { tenantId, conversationId, senderType: "AI" },
        orderBy: { createdAt: "desc" },
      });
      if (!message) return null;
      if (message.status === "FAILED") {
        throw new Error(`AI message failed: ${JSON.stringify(message.metadata)}`);
      }
      return message.status === "SENT" ? message : null;
    });

    const metadata = metadataRecord(aiMessage.metadata);
    assert(
      aiMessage.text === expectedAnswer,
      `Grounded AI reply changed: ${aiMessage.text ?? ""}. Metadata: ${JSON.stringify(metadata)}`,
    );

    assert(typeof metadata.graphRunId === "string", "AI metadata has no graphRunId.");
    assert(isRecord(metadata.quality), "AI metadata has no quality payload.");
    assert(metadata.quality.passed === true, "AI quality gate did not pass.");
    assert(isRecord(metadata.groundedAnswer), "AI metadata has no grounded-answer audit.");
    assert(
      metadata.groundedAnswer.disposition === "AUTO_SEND",
      "Grounded-answer audit did not preserve the auto-send decision.",
    );
    assert(
      Array.isArray(metadata.groundedAnswer.citationKeys) &&
        metadata.groundedAnswer.citationKeys.length > 0,
      "Grounded-answer audit has no citations.",
    );
    for (const key of [
      "providerOutputHash",
      "gateInputHash",
      "gateResultHash",
      "evidenceManifestHash",
    ]) {
      assert(
        typeof metadata.groundedAnswer[key] === "string" &&
          /^[a-f0-9]{64}$/u.test(metadata.groundedAnswer[key] as string),
        `Grounded-answer audit has an invalid ${key}.`,
      );
    }
    assert(isRecord(metadata.knowledgeRetrieval), "AI metadata has no knowledge retrieval audit.");
    assert(
      metadata.knowledgeRetrieval.status === "grounded" &&
        metadata.knowledgeRetrieval.corpusKind === "STRUCTURED_V2" &&
        metadata.knowledgeRetrieval.snapshotKind === "PUBLICATION" &&
        metadata.knowledgeRetrieval.publicationId === publication.id &&
        metadata.knowledgeRetrieval.gateOutcome === "AUTO_SEND" &&
        Array.isArray(metadata.knowledgeRetrieval.citationKeys) &&
        metadata.knowledgeRetrieval.citationKeys.length > 0,
      `AI metadata did not preserve the structured publication retrieval: ${JSON.stringify(
        metadata.knowledgeRetrieval,
      )}`,
    );
    assert(
      typeof metadata.retrievalTraceId === "string",
      "AI metadata has no structured retrieval trace id.",
    );
    const trace = await prisma.knowledgeV2RetrievalTrace.findFirstOrThrow({
      where: {
        id: metadata.retrievalTraceId,
        tenantId: tenantId!,
        responseMessageId: aiMessage.id,
      },
      include: {
        citations: {
          include: { evidenceReference: { include: { factVersion: { include: { fact: true } } } } },
          orderBy: { ordinal: "asc" },
        },
      },
    });
    assert(
      trace.publicationId === publication.id &&
        trace.outcome === "ANSWERED" &&
        trace.gateOutcome === "AUTO_SEND",
      "Structured trace did not preserve the active publication and auto-send decision.",
    );
    const serviceCodeCitation = trace.citations.find(
      (citation) =>
        citation.support === "SUPPORTS" &&
        citation.evidenceReference.factVersion?.fact.factKey ===
          "business/signature-service-code" &&
        citation.evidenceReference.factVersion.displayValue === expectedAnswer,
    );
    assert(serviceCodeCitation, "Structured citation did not bind the verified service-code fact.");
    assert(
      await prisma.knowledgePublicationItem.findFirst({
        where: {
          tenantId: tenantId!,
          publicationId: publication.id,
          factVersionId: serviceCodeCitation.evidenceReference.factVersionId,
        },
      }),
      "Structured citation referenced a fact outside the published snapshot.",
    );
    const replyRun = await prisma.aiReplyRun.findFirstOrThrow({
      where: { tenantId: tenantId!, replyMessageId: aiMessage.id },
    });
    assert(
      replyRun.status === "SUCCEEDED" &&
        replyRun.publicationId === publication.id &&
        replyRun.capabilityType === "GENERAL_FAQ" &&
        replyRun.allowedAutonomy === "ANSWER_ONLY" &&
        replyRun.requiredAutonomy === "ANSWER_ONLY" &&
        replyRun.capabilityDecision === "AUTHORIZED" &&
        replyRun.replyDisposition === "AUTO_SEND",
      "AI reply run did not preserve its authorized GENERAL_FAQ binding.",
    );
    assert(
      arrayOfRecords(metadata.toolCalls).length === 0 &&
        arrayOfRecords(metadata.toolResults).length === 0,
      "ANSWER_ONLY general FAQ executed side-effect tools.",
    );
    assert(
      metadata.deliveryJobId === undefined || metadata.deliveryJobId === null,
      "Website reply unexpectedly queued external channel delivery.",
    );

    const usage = await prisma.aiUsageLog.findFirst({
      where: { tenantId: tenantId!, conversationId, actionType: "langgraph_queued_reply" },
      orderBy: { createdAt: "desc" },
    });
    assert(usage, "AI usage log was not stored.");
    assert(
      (usage.inputTokens ?? 0) > 0 && (usage.outputTokens ?? 0) > 0,
      "AI usage log has no token usage.",
    );
    assert(usage.estimatedCost !== null, "AI usage log has no estimated cost.");

    const [persistedLead, booking, task] = await Promise.all([
      prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId: tenantId! } }),
      prisma.booking.findFirst({ where: { tenantId: tenantId!, leadId } }),
      prisma.task.findFirst({ where: { tenantId: tenantId!, leadId } }),
    ]);
    assert(
      persistedLead.status === "NEW" && !booking && !task,
      "ANSWER_ONLY general FAQ created a lead, booking, or task side effect.",
    );

    const inbox = (await apiJson("/inbox/conversations", { headers: { cookie } })).payload;
    assert(
      JSON.stringify(inbox).includes(conversationId),
      "Inbox does not include the acceptance conversation.",
    );
    const conversation = getData(
      (await apiJson(`/conversations/${conversationId}`, { headers: { cookie } })).payload,
    );
    assert(
      JSON.stringify(conversation).includes(aiMessage.id),
      "Conversation detail does not include AI reply.",
    );
    assert(
      JSON.stringify(conversation).includes("langgraph_ai_reply_generated"),
      "Conversation activity timeline does not include AI event.",
    );
    const lead = getData((await apiJson(`/leads/${leadId}`, { headers: { cookie } })).payload);
    assert(JSON.stringify(lead).includes(leadId), "Lead detail does not include acceptance lead.");
    const dashboard = getData(
      (await apiJson("/dashboard/summary", { headers: { cookie } })).payload,
    );
    assert(
      JSON.stringify(dashboard).includes(leadId),
      "Dashboard summary does not include acceptance lead.",
    );
    assert(
      !JSON.stringify(dashboard).includes("Анна Соколова"),
      "Dashboard leaked demo lead data.",
    );

    const audit = getData((await apiJson("/ai-audit?limit=30", { headers: { cookie } })).payload);
    assert(
      JSON.stringify(audit).includes(String(metadata.graphRunId)),
      "AI audit does not include graph run.",
    );
    assert(
      JSON.stringify(audit).includes("langgraph_queued_reply"),
      "AI audit does not include usage log event.",
    );

    const completedAiJob = await aiQueue.getJob(aiJobId);
    assert(
      !completedAiJob || (await completedAiJob.getState()) === "completed",
      "AI reply job did not complete.",
    );

    const metrics = await fetch(workerMetricsUrl, { signal: AbortSignal.timeout(3_000) });
    assert(metrics.ok, `Worker metrics endpoint is not available at ${workerMetricsUrl}.`);
    const metricsText = await metrics.text();
    assert(
      metricsText.includes("leadvirt_ai_graph_runs_total"),
      "Worker metrics do not include AI graph run counter.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        tenantId,
        userId,
        channelId: channel.id,
        conversationId,
        leadId,
        aiMessageId: aiMessage.id,
        aiJobId,
        graphRunId: metadata.graphRunId,
        publicationId: publication.id,
        retrievalTraceId: trace.id,
      }),
    );
  } finally {
    const job = aiJobId ? await aiQueue.getJob(aiJobId).catch(() => null) : null;
    await job?.remove().catch(() => undefined);
    await aiQueue.close().catch(() => undefined);
    await cleanupEmailUser(email).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
