import "reflect-metadata";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { Prisma, prisma } from "@leadvirt/db";
import {
  KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
  buildDefaultKnowledgeCapabilityDefinitionsV1,
  hashKnowledgeCapabilitySetV1,
  loadKnowledgeOperationalCapabilityProjectionV1,
} from "@leadvirt/knowledge";
import { automaticReplyChannelFingerprint } from "@leadvirt/runtime-queue";
import { RequestMethod, ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../apps/api/src/app.module.js";
import { HttpExceptionFilter } from "../../apps/api/src/common/filters/http-exception.filter.js";
import { canonicalKnowledgeV2Hash } from "../../apps/api/src/modules/knowledge/knowledge-v2-http.js";

loadEnvFile();
process.env.DATABASE_URL =
  process.env.LEADVIRT_QA_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
process.env.REDIS_URL = process.env.LEADVIRT_QA_REDIS_URL ?? "redis://localhost:6380";
process.env.PORT = "4001";

const apiOrigin = "http://localhost:4001";
const apiBaseUrl = `${apiOrigin}/api`;
const targetKey = "workspace-v2";
const validationPolicyVersion = "structured-v2-capability-snapshot-v2";

type JsonRecord = Record<string, unknown>;

interface ApiResult {
  status: number;
  payload: unknown;
  headers: Headers;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown, label: string): JsonRecord {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} is not an object.`,
  );
  return value as JsonRecord;
}

function asRecords(value: unknown, label: string): JsonRecord[] {
  assert(Array.isArray(value), `${label} is not an array.`);
  return value.map((item, index) => asRecord(item, `${label}[${index}]`));
}

function data(result: ApiResult) {
  assert(
    result.status >= 200 && result.status < 300,
    `Expected success, received ${result.status}: ${JSON.stringify(result.payload)}`,
  );
  return asRecord(asRecord(result.payload, "response payload").data, "response data");
}

function expectError(result: ApiResult, status: number, code?: string) {
  assert(
    result.status === status,
    `Expected HTTP ${status}, received ${result.status}: ${JSON.stringify(result.payload)}`,
  );
  const error = asRecord(asRecord(result.payload, "error payload").error, "error");
  if (code) assert(error.code === code, `Expected ${code}, received ${String(error.code)}.`);
  return error;
}

function hashSecret(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

function cookie(token: string) {
  return `leadvirt_session=${encodeURIComponent(token)}`;
}

async function request(path: string, options: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { text };
    }
  }
  return { status: response.status, payload, headers: response.headers };
}

async function apiIsRunning() {
  try {
    const response = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function startApiIfNeeded(): Promise<INestApplication | null> {
  if (await apiIsRunning()) return null;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(4001);
  return app;
}

function capability(items: JsonRecord[], capabilityType: string) {
  const item = items.find((candidate) => candidate.capabilityType === capabilityType);
  assert(item, `Capability ${capabilityType} is missing.`);
  return item;
}

async function main() {
  const ownedApp = await startApiIfNeeded();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  let tenantId: string | null = null;
  let legacyTenantId: string | null = null;

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Capability API Smoke",
        slug: `capability-api-smoke-${suffix}`,
        timezone: "Europe/Paris",
      },
    });
    tenantId = tenant.id;

    const actors = await Promise.all(
      (["OWNER", "ADMIN", "MANAGER"] as const).map(async (role) => {
        const user = await prisma.user.create({
          data: {
            email: `capability.${role.toLowerCase()}.${suffix}@leadvirt.test`,
            name: `Capability ${role}`,
          },
        });
        userIds.push(user.id);
        await prisma.membership.create({
          data: { tenantId: tenant.id, userId: user.id, role },
        });
        const sessionToken = `lv-capability-${role.toLowerCase()}-${randomBytes(32).toString("hex")}`;
        await prisma.authSession.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            tokenHash: hashSecret(sessionToken),
            expiresAt: new Date(Date.now() + 60 * 60_000),
            ipAddress: "127.0.0.1",
            userAgent: "knowledge-v2-capability-api-smoke",
          },
        });
        return { role, user, cookie: cookie(sessionToken) };
      }),
    );
    const owner = actors.find((actor) => actor.role === "OWNER")!;
    const admin = actors.find((actor) => actor.role === "ADMIN")!;
    const manager = actors.find((actor) => actor.role === "MANAGER")!;

    const expectedDefinitions = buildDefaultKnowledgeCapabilityDefinitionsV1({
      tenantId: tenant.id,
    });
    const expectedCapabilitySetHash = hashKnowledgeCapabilitySetV1(expectedDefinitions);
    const expectedByType = new Map<string, (typeof expectedDefinitions)[number]>(
      expectedDefinitions.map((item) => [item.capabilityType, item]),
    );

    const concurrentOverviews = await Promise.all(
      Array.from({ length: 8 }, () =>
        request("/knowledge/v2/overview", {
          headers: { cookie: owner.cookie },
        }),
      ),
    );
    for (const [index, overview] of concurrentOverviews.entries()) {
      assert(
        overview.status === 200,
        `Concurrent cold overview ${index + 1} failed with ${overview.status}: ${JSON.stringify(overview.payload)}`,
      );
    }
    assert(
      (await prisma.knowledgeV2Capability.count({ where: { tenantId: tenant.id } })) === 0,
      "Capability overview created policy rows during a read.",
    );
    assert(
      (await prisma.knowledgeV2RequirementDefinition.count({ where: { tenantId: tenant.id } })) ===
        0,
      "Capability overview created requirement rows during a read.",
    );

    const emptyList = await request("/knowledge/v2/capabilities", {
      headers: { cookie: manager.cookie },
    });
    const emptyListData = data(emptyList);
    assert(
      asRecords(emptyListData.items, "empty capability list").length === 0 &&
        asRecord(emptyListData.starterPreset, "empty starter preset").applied === false,
      "A zero-row tenant did not expose the unapplied starter state.",
    );
    const emptyPatch = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "if-match": '"kv2-missing"',
        "idempotency-key": `capability-empty-patch-${suffix}`,
      },
      body: JSON.stringify({ enabled: true }),
    });
    expectError(emptyPatch, 404, "KNOWLEDGE_DEPENDENCY_CAPABILITY_NOT_FOUND");
    assert(
      (await prisma.knowledgeV2Capability.count({ where: { tenantId: tenant.id } })) === 0 &&
        (await prisma.knowledgeV2RequirementDefinition.count({
          where: { tenantId: tenant.id },
        })) === 0,
      "A zero-row PATCH created capability policy.",
    );

    const initialPresetKey = `capability-initial-starter-${suffix}`;
    const initialPreset = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: { cookie: owner.cookie, "idempotency-key": initialPresetKey },
    });
    const initialPresetData = data(initialPreset);
    assert(
      initialPresetData.idempotencyReplayed === false,
      "Initial starter preset was incorrectly reported as a replay.",
    );
    assert(
      (await prisma.knowledgeV2Capability.count({ where: { tenantId: tenant.id } })) === 8 &&
        (await prisma.knowledgeV2RequirementDefinition.count({
          where: { tenantId: tenant.id },
        })) === 36,
      "Explicit starter preset did not create the complete policy.",
    );

    const firstList = await request("/knowledge/v2/capabilities", {
      headers: { cookie: manager.cookie },
    });
    const firstListData = data(firstList);
    const firstItems = asRecords(firstListData.items, "capability list");
    const freshStarterPreset = asRecord(firstListData.starterPreset, "fresh starter preset");
    assert(firstListData.targetKey === targetKey, "Capability list target is incorrect.");
    assert(
      freshStarterPreset.id === "SAFE_ANSWER_STARTER_V1" &&
        freshStarterPreset.policyVersion === 2 &&
        freshStarterPreset.applied === true,
      "Explicitly initialized tenant does not report the applied starter policy.",
    );
    assert(
      firstListData.capabilitySetHash === expectedCapabilitySetHash,
      "Default capability hash is not deterministic.",
    );
    assert(
      firstItems.length === 8,
      `Expected 8 default capabilities, received ${firstItems.length}.`,
    );

    for (const item of firstItems) {
      const type = String(item.capabilityType);
      const expected = expectedByType.get(type);
      assert(expected, `Unexpected capability type ${type}.`);
      assert(
        item.id === expected.capabilityId,
        `${type} did not use its deterministic capability ID.`,
      );
      assert(item.enabled === expected.enabled, `${type} default enabled state is incorrect.`);
      assert(item.allowedAutonomy === "ANSWER_ONLY", `${type} default autonomy is incorrect.`);
      assert(
        item.templateKey === expected.templateKey && item.templateVersion === 1,
        `${type} template identity is incorrect.`,
      );
      assert(
        item.serverOwned === true && item.version === 1,
        `${type} default revision is incorrect.`,
      );
      assert(
        typeof item.etag === "string" && /^"kv2-[a-f0-9]{64}"$/.test(item.etag),
        `${type} has an invalid ETag.`,
      );
    }
    assert(
      capability(firstItems, "GENERAL_FAQ").enabled === true,
      "GENERAL_FAQ must be enabled by default.",
    );
    assert(
      firstItems
        .filter((item) => item.enabled === true)
        .map((item) => String(item.capabilityType))
        .sort()
        .join(",") === "APPOINTMENT_DISCOVERY,COMMERCE_RECOMMENDATION,GENERAL_FAQ,PRICING",
      "The safe answer-only starter capabilities are not enabled by default.",
    );

    const secondList = await request("/knowledge/v2/capabilities", {
      headers: { cookie: manager.cookie },
    });
    assert(
      JSON.stringify(secondList.payload) === JSON.stringify(firstList.payload),
      "Repeated capability reads changed the list response.",
    );
    assert(
      (await prisma.knowledgeV2RequirementDefinition.count({ where: { tenantId: tenant.id } })) ===
        36,
      "Default seeding did not create all 36 requirement definitions.",
    );

    const faq = capability(firstItems, "GENERAL_FAQ");
    const originalEtag = String(faq.etag);
    const adminNoop = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: admin.cookie,
        "if-match": originalEtag,
        "idempotency-key": `capability-admin-noop-${suffix}`,
      },
      body: JSON.stringify({ enabled: true }),
    });
    const adminNoopData = data(adminNoop);
    assert(
      adminNoopData.idempotencyReplayed === false,
      "Admin no-op was incorrectly reported as a replay.",
    );
    assert(
      asRecord(adminNoopData.resource, "admin no-op resource").etag === originalEtag,
      "Admin no-op changed the capability ETag.",
    );

    const managerDenied = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: manager.cookie,
        "if-match": originalEtag,
        "idempotency-key": `capability-manager-denied-${suffix}`,
      },
      body: JSON.stringify({ allowedAutonomy: "COLLECT_INFORMATION" }),
    });
    expectError(managerDenied, 403);

    const missingIdempotency = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: { cookie: owner.cookie, "if-match": originalEtag },
      body: JSON.stringify({ allowedAutonomy: "COLLECT_INFORMATION" }),
    });
    expectError(missingIdempotency, 400, "KNOWLEDGE_VALIDATION_IDEMPOTENCY_KEY_REQUIRED");

    const missingIfMatch = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "idempotency-key": `capability-missing-if-match-${suffix}`,
      },
      body: JSON.stringify({ allowedAutonomy: "COLLECT_INFORMATION" }),
    });
    expectError(missingIfMatch, 428, "KNOWLEDGE_VALIDATION_PRECONDITION_REQUIRED");

    const settingsBefore = await prisma.knowledgeV2Settings.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, draftGeneration: 7, etag: 11 },
      update: { draftGeneration: 7, etag: 11 },
    });
    const capabilityRecord = await prisma.knowledgeV2Capability.findUniqueOrThrow({
      where: {
        tenantId_capabilityType_targetKey: {
          tenantId: tenant.id,
          capabilityType: "GENERAL_FAQ",
          targetKey,
        },
      },
      include: {
        requirementDefinitions: {
          where: { active: true },
          orderBy: { requirementKey: "asc" },
        },
      },
    });
    const servingManifestHash = canonicalKnowledgeV2Hash([]);
    const servingRequirementSetHash = canonicalKnowledgeV2Hash({
      tenantId: tenant.id,
      capabilityId: capabilityRecord.id,
      fixture: "serving-requirements-v1",
    });
    const servingCapabilityEvaluationHash = canonicalKnowledgeV2Hash({
      capabilityId: capabilityRecord.id,
      capabilityEtag: capabilityRecord.etag,
      fixture: "serving-capability-v1",
    });
    const servingCapabilitySnapshotHash = canonicalKnowledgeV2Hash({
      capabilityId: capabilityRecord.id,
      allowedAutonomy: capabilityRecord.allowedAutonomy,
      capabilityEtag: capabilityRecord.etag,
    });
    const operationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(prisma, {
      tenantId: tenant.id,
    });
    assert(
      operationalProjection.permissionGeneration !== null,
      "Operational permission generation is missing.",
    );
    const operationalBinding = {
      operationalBindingSchemaVersion: operationalProjection.schemaVersion,
      operationalRegistryVersion: operationalProjection.registryVersion,
      operationalRegistryHash: operationalProjection.registryHash,
      operationalDependencySetHash: operationalProjection.dependencySetHash,
      operationalBindingHash: operationalProjection.bindingHash,
      operationalPermissionGeneration: operationalProjection.permissionGeneration,
    };

    const publication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey,
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: servingManifestHash,
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        capabilitySetHash: expectedCapabilitySetHash,
        requirementEvaluationSetHash: servingRequirementSetHash,
        ...operationalBinding,
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const servingValidation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey,
        corpusKind: "STRUCTURED_V2",
        candidateId: targetKey,
        candidateVersion: settingsBefore.draftGeneration,
        candidateManifestHash: servingManifestHash,
        publicationId: publication.id,
        candidateItems: [],
        status: "PASSED",
        blockers: [],
        warnings: [],
        capabilitySetHash: expectedCapabilitySetHash,
        requirementEvaluationSetHash: servingRequirementSetHash,
        ...operationalBinding,
        validationPolicyVersion,
        validatedByUserId: owner.user.id,
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    await prisma.knowledgeV2RequirementEvaluation.createMany({
      data: capabilityRecord.requirementDefinitions.map((requirement) => ({
        tenantId: tenant.id,
        validationId: servingValidation.id,
        capabilityId: capabilityRecord.id,
        requirementDefinitionId: requirement.id,
        definitionVersion: requirement.definitionVersion,
        status: "SATISFIED" as const,
        evidenceIds: [],
        reasonCode: "SATISFIED",
        details: {
          label: requirement.requirementKey,
          explanation: "Satisfied by the immutable serving fixture.",
          evidenceRefs: [],
          remediation: null,
          capabilityEvaluationHash: servingCapabilityEvaluationHash,
        },
        evaluatorVersion: KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
        immutableHash: canonicalKnowledgeV2Hash({
          validationId: servingValidation.id,
          requirementDefinitionId: requirement.id,
          status: "SATISFIED",
        }),
        evaluatedAt: new Date(),
      })),
    });
    await prisma.knowledgePublicationCapability.create({
      data: {
        tenantId: tenant.id,
        publicationId: publication.id,
        validationId: servingValidation.id,
        capabilityId: capabilityRecord.id,
        capabilityType: "GENERAL_FAQ",
        allowedAutonomy: "ANSWER_ONLY",
        capabilityEtag: capabilityRecord.etag,
        capabilitySnapshotHash: servingCapabilitySnapshotHash,
        requirementEvaluationSetHash: servingCapabilityEvaluationHash,
        operationalBindingHash: operationalProjection.bindingHash,
        operationalPermissionGeneration: operationalProjection.permissionGeneration,
      },
    });
    const pointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey,
        publicationId: publication.id,
        sequence: publication.sequence,
      },
    });

    const pendingDraftValidation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey,
        corpusKind: "STRUCTURED_V2",
        candidateId: targetKey,
        candidateVersion: settingsBefore.draftGeneration,
        candidateManifestHash: canonicalKnowledgeV2Hash({ fixture: "pending-draft", suffix }),
        candidateItems: [],
        status: "PENDING",
        validationPolicyVersion,
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    const passedDraftValidation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: tenant.id,
        targetKey,
        corpusKind: "STRUCTURED_V2",
        candidateId: targetKey,
        candidateVersion: settingsBefore.draftGeneration,
        candidateManifestHash: canonicalKnowledgeV2Hash({ fixture: "passed-draft", suffix }),
        candidateItems: [],
        status: "PASSED",
        blockers: [],
        warnings: [],
        capabilitySetHash: expectedCapabilitySetHash,
        requirementEvaluationSetHash: servingRequirementSetHash,
        validationPolicyVersion,
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });

    const affectedChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Affected automatic reply channel",
        publicKey: `capability-affected-${suffix}`,
        settings: { deliveryMode: "managed", fixture: "affected" },
      },
    });
    await prisma.channel.update({
      where: { id: affectedChannel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 2,
        automaticRepliesPublicationId: publication.id,
        automaticRepliesPublicationEtag: pointer.etag,
        automaticRepliesCapabilitySetHash: expectedCapabilitySetHash,
        automaticRepliesOperationalBindingHash: operationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration: operationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(affectedChannel),
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: owner.user.id,
      },
    });
    const unrelatedChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Unrelated manual channel",
        publicKey: `capability-unrelated-${suffix}`,
        settings: { deliveryMode: "manual", fixture: "unrelated" },
      },
    });
    const affectedConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channelId: affectedChannel.id,
        externalConversationId: `affected-${suffix}`,
        aiEnabled: true,
        aiGeneration: 3,
        aiReplySequence: 8,
        aiReplyFence: 8,
      },
    });
    const unrelatedConversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channelId: unrelatedChannel.id,
        externalConversationId: `unrelated-${suffix}`,
        aiEnabled: true,
        aiGeneration: 6,
        aiReplySequence: 3,
        aiReplyFence: 3,
      },
    });
    const affectedMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: affectedConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Affected pending reply",
      },
    });
    const unrelatedMessage = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: unrelatedConversation.id,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        text: "Unrelated pending reply",
      },
    });
    const affectedRun = await prisma.aiReplyRun.create({
      data: {
        tenantId: tenant.id,
        conversationId: affectedConversation.id,
        inboundMessageId: affectedMessage.id,
        publicationId: publication.id,
        capabilitySetHash: expectedCapabilitySetHash,
        idempotencyKey: `capability-run-${suffix}`,
        inputHash: canonicalKnowledgeV2Hash({ messageId: affectedMessage.id }),
        generation: affectedConversation.aiGeneration,
        sequence: affectedConversation.aiReplySequence,
        status: "RUNNING",
        attemptCount: 1,
        startedAt: new Date(),
      },
    });
    const affectedOutbox = await prisma.runtimeOutbox.create({
      data: {
        tenantId: tenant.id,
        aggregateType: "Message",
        aggregateId: affectedMessage.id,
        aggregateVersion: 1,
        eventType: "ai.reply.requested",
        dedupeKey: `capability-affected-outbox-${suffix}`,
        status: "PENDING",
      },
    });
    const unrelatedOutbox = await prisma.runtimeOutbox.create({
      data: {
        tenantId: tenant.id,
        aggregateType: "Message",
        aggregateId: unrelatedMessage.id,
        aggregateVersion: 1,
        eventType: "ai.reply.requested",
        dedupeKey: `capability-unrelated-outbox-${suffix}`,
        status: "PENDING",
      },
    });

    const unsupportedAutonomy = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "if-match": originalEtag,
        "idempotency-key": `capability-unsupported-autonomy-${suffix}`,
      },
      body: JSON.stringify({ allowedAutonomy: "AUTONOMOUS_ACTION" }),
    });
    expectError(unsupportedAutonomy, 400);

    const updateKey = `capability-owner-update-${suffix}`;
    const update = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "if-match": originalEtag,
        "idempotency-key": updateKey,
      },
      body: JSON.stringify({ allowedAutonomy: "COLLECT_INFORMATION" }),
    });
    const updateData = data(update);
    const updatedResource = asRecord(updateData.resource, "updated capability");
    assert(
      updateData.idempotencyReplayed === false,
      "Initial capability update was reported as a replay.",
    );
    assert(
      updatedResource.allowedAutonomy === "COLLECT_INFORMATION" && updatedResource.version === 2,
      "Capability update did not advance the revision.",
    );
    assert(
      update.headers.get("etag") === updatedResource.etag,
      "PATCH response ETag does not match the resource.",
    );

    const [
      updatedCapability,
      updatedSettings,
      validations,
      revokedChannel,
      untouchedChannel,
      fencedConversation,
      untouchedConversation,
      deadLetteredOutbox,
      pendingOutbox,
      supersededRun,
    ] = await Promise.all([
      prisma.knowledgeV2Capability.findUniqueOrThrow({ where: { id: capabilityRecord.id } }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.knowledgeV2PublicationValidation.findMany({
        where: {
          id: {
            in: [servingValidation.id, pendingDraftValidation.id, passedDraftValidation.id],
          },
        },
        select: { id: true, status: true, publicationId: true },
      }),
      prisma.channel.findUniqueOrThrow({ where: { id: affectedChannel.id } }),
      prisma.channel.findUniqueOrThrow({ where: { id: unrelatedChannel.id } }),
      prisma.conversation.findUniqueOrThrow({ where: { id: affectedConversation.id } }),
      prisma.conversation.findUniqueOrThrow({ where: { id: unrelatedConversation.id } }),
      prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: affectedOutbox.id } }),
      prisma.runtimeOutbox.findUniqueOrThrow({ where: { id: unrelatedOutbox.id } }),
      prisma.aiReplyRun.findUniqueOrThrow({ where: { id: affectedRun.id } }),
    ]);
    assert(
      updatedCapability.generation === 2 && updatedCapability.etag === 2,
      "Capability generation and ETag did not advance once.",
    );
    assert(
      updatedSettings.draftGeneration === 8 && updatedSettings.etag === 12,
      "Draft generation and settings ETag did not advance once.",
    );
    const validationById = new Map(validations.map((item) => [item.id, item]));
    assert(
      validationById.get(pendingDraftValidation.id)?.status === "EXPIRED",
      "Pending draft validation was not expired.",
    );
    assert(
      validationById.get(passedDraftValidation.id)?.status === "EXPIRED",
      "Passed draft validation was not expired.",
    );
    assert(
      validationById.get(servingValidation.id)?.status === "PASSED" &&
        validationById.get(servingValidation.id)?.publicationId === publication.id,
      "Immutable serving validation was modified.",
    );
    assert(
      revokedChannel.automaticRepliesEnabled === false &&
        revokedChannel.automaticRepliesGeneration === 3 &&
        revokedChannel.automaticRepliesPublicationId === null &&
        revokedChannel.automaticRepliesCapabilitySetHash === null,
      "Affected automatic-reply channel was not revoked.",
    );
    assert(
      untouchedChannel.automaticRepliesGeneration === 1 &&
        untouchedChannel.automaticRepliesEnabled === false,
      "Unrelated channel was modified.",
    );
    assert(
      fencedConversation.aiEnabled === false &&
        fencedConversation.aiGeneration === 4 &&
        fencedConversation.aiReplySequence === 9 &&
        fencedConversation.aiReplyFence === fencedConversation.aiReplySequence,
      "Affected conversation was not fenced at its new sequence.",
    );
    assert(
      untouchedConversation.aiEnabled === true &&
        untouchedConversation.aiGeneration === 6 &&
        untouchedConversation.aiReplySequence === 3 &&
        untouchedConversation.aiReplyFence === 3,
      "Unrelated conversation was modified.",
    );
    assert(
      deadLetteredOutbox.status === "DEAD_LETTER" &&
        deadLetteredOutbox.lastErrorCode === "CAPABILITY_CONFIGURATION_CHANGED",
      "Affected pending ai.reply outbox event was not dead-lettered.",
    );
    assert(
      pendingOutbox.status === "PENDING" && pendingOutbox.lastErrorCode === null,
      "Unrelated pending ai.reply outbox event was modified.",
    );
    assert(
      supersededRun.status === "SUPERSEDED" &&
        supersededRun.errorCode === "CAPABILITY_CONFIGURATION_CHANGED" &&
        supersededRun.completedAt !== null,
      "Affected AI reply run was not superseded.",
    );

    const replay = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "if-match": originalEtag,
        "idempotency-key": updateKey,
      },
      body: JSON.stringify({ allowedAutonomy: "COLLECT_INFORMATION" }),
    });
    const replayData = data(replay);
    assert(replayData.idempotencyReplayed === true, "Repeated capability update was not replayed.");
    assert(
      canonicalKnowledgeV2Hash(replayData.resource) === canonicalKnowledgeV2Hash(updatedResource),
      "Idempotency replay returned a different resource.",
    );
    const replayState = await Promise.all([
      prisma.knowledgeV2Capability.findUniqueOrThrow({ where: { id: capabilityRecord.id } }),
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.channel.findUniqueOrThrow({ where: { id: affectedChannel.id } }),
      prisma.conversation.findUniqueOrThrow({ where: { id: affectedConversation.id } }),
    ]);
    assert(
      replayState[0].etag === 2 && replayState[0].generation === 2,
      "Replay advanced the capability twice.",
    );
    assert(
      replayState[1].draftGeneration === 8 && replayState[1].etag === 12,
      "Replay advanced the draft twice.",
    );
    assert(replayState[2].automaticRepliesGeneration === 3, "Replay revoked the channel twice.");
    assert(
      replayState[3].aiReplySequence === 9 && replayState[3].aiReplyFence === 9,
      "Replay fenced the conversation twice.",
    );

    const stale = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: owner.cookie,
        "if-match": originalEtag,
        "idempotency-key": `capability-stale-update-${suffix}`,
      },
      body: JSON.stringify({ allowedAutonomy: "PROPOSE_ACTION" }),
    });
    const staleError = expectError(stale, 412, "REVISION_CONFLICT");
    const staleDetails = asRecord(staleError.details, "stale revision details");
    assert(
      staleDetails.currentEtag === updatedResource.etag,
      "Stale response omitted the current capability ETag.",
    );
    assert(
      (
        await prisma.knowledgeV2Capability.findUniqueOrThrow({
          where: { id: capabilityRecord.id },
        })
      ).etag === 2,
      "Stale update changed the capability.",
    );

    const updatedList = await request("/knowledge/v2/capabilities", {
      headers: { cookie: owner.cookie },
    });
    const updatedListData = data(updatedList);
    const updatedCapabilitySetHash = String(updatedListData.capabilitySetHash);
    assert(
      updatedCapabilitySetHash !== expectedCapabilitySetHash,
      "Capability update did not change the draft capability-set hash.",
    );

    const readinessResult = await request("/knowledge/v2/readiness", {
      headers: { cookie: owner.cookie },
    });
    const readiness = data(readinessResult);
    const serving = asRecord(readiness.serving, "serving readiness");
    const draft = asRecord(readiness.draft, "draft readiness");
    const servingCapabilities = asRecords(serving.capabilities, "serving capabilities");
    const draftCapabilities = asRecords(draft.capabilities, "draft capabilities");
    const servingFaq = capability(servingCapabilities, "GENERAL_FAQ");
    const draftFaq = capability(draftCapabilities, "GENERAL_FAQ");
    assert(serving.status === "READY", `Serving snapshot is not ready: ${String(serving.status)}.`);
    assert(
      serving.capabilitySetHash === expectedCapabilitySetHash,
      "Serving readiness did not retain the publication capability hash.",
    );
    assert(
      servingFaq.allowedAutonomy === "ANSWER_ONLY" && servingFaq.generation === 1,
      "Serving readiness read mutable capability state.",
    );
    assert(
      asRecords(servingFaq.requirements, "serving requirements").every(
        (item) => item.status === "SATISFIED",
      ),
      "Serving readiness did not use persisted publication evaluations.",
    );
    assert(
      draft.capabilitySetHash === updatedCapabilitySetHash,
      "Draft readiness did not evaluate the current capability set.",
    );
    assert(
      draftFaq.allowedAutonomy === "COLLECT_INFORMATION" && draftFaq.generation === 2,
      "Draft readiness did not use current capability state.",
    );
    assert(
      serving.capabilitySetHash !== draft.capabilitySetHash,
      "Serving and draft readiness collapsed into one snapshot.",
    );
    const draftCapabilityBlockers = asRecords(draft.blockers, "draft blockers").filter((item) =>
      String(item.code).startsWith("KNOWLEDGE_CAPABILITY_"),
    );
    assert(
      draftCapabilityBlockers.length === 0,
      "Safe answer-only capability setup was exposed as a publication blocker.",
    );
    for (const capabilityType of [
      "GENERAL_FAQ",
      "PRICING",
      "APPOINTMENT_DISCOVERY",
      "COMMERCE_RECOMMENDATION",
    ]) {
      assert(
        capability(draftCapabilities, capabilityType).status === "READY_WITH_WARNINGS",
        `${capabilityType} is not launchable with safe runtime fallback.`,
      );
    }
    assert(
      asRecords(draft.warnings, "draft warnings").some((item) =>
        String(item.code).startsWith("KNOWLEDGE_CAPABILITY_"),
      ),
      "Optional capability improvements were not retained as readiness warnings.",
    );

    const managerPresetDenied = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: {
        cookie: manager.cookie,
        "idempotency-key": `capability-starter-manager-${suffix}`,
      },
    });
    expectError(managerPresetDenied, 403);
    const missingPresetIdempotency = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: { cookie: owner.cookie },
    });
    expectError(missingPresetIdempotency, 400, "KNOWLEDGE_VALIDATION_IDEMPOTENCY_KEY_REQUIRED");
    const presetKey = `capability-starter-${suffix}`;
    const preset = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: { cookie: owner.cookie, "idempotency-key": presetKey },
    });
    const presetData = data(preset);
    const presetResource = asRecord(presetData.resource, "starter preset resource");
    const presetItems = asRecords(presetResource.items, "starter preset capabilities");
    const enabledPresetTypes = presetItems
      .filter((item) => item.enabled === true)
      .map((item) => String(item.capabilityType))
      .sort();
    assert(
      enabledPresetTypes.join(",") ===
        "APPOINTMENT_DISCOVERY,COMMERCE_RECOMMENDATION,GENERAL_FAQ,PRICING",
      "Starter preset did not apply the safe capability set atomically.",
    );
    assert(
      presetItems.every((item) => item.allowedAutonomy === "ANSWER_ONLY"),
      "Starter preset left a capability above answer-only autonomy.",
    );
    assert(
      presetResource.capabilitySetHash === expectedCapabilitySetHash,
      "Starter preset did not restore the deterministic default hash.",
    );
    assert(
      asRecord(presetResource.starterPreset, "applied starter preset").applied === true,
      "Starter preset response did not report the exact applied state.",
    );
    const presetSettings = await prisma.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    assert(
      presetSettings.draftGeneration === 9 && presetSettings.etag === 13,
      "Starter preset did not advance the draft exactly once.",
    );
    const presetAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        action: "knowledge.v2.capability_starter_preset_applied",
      },
      orderBy: { createdAt: "desc" },
    });
    const presetChanges = asRecords(
      asRecord(presetAudit.payload, "starter preset audit").changes,
      "starter preset audit changes",
    );
    const faqPresetChange = presetChanges.find((item) => item.capabilityType === "GENERAL_FAQ");
    assert(faqPresetChange, "Starter preset audit omitted the changed FAQ capability.");
    assert(
      asRecord(faqPresetChange.previous, "starter preset previous state").allowedAutonomy ===
        "COLLECT_INFORMATION" &&
        asRecord(faqPresetChange.next, "starter preset next state").allowedAutonomy ===
          "ANSWER_ONLY",
      "Starter preset audit did not persist exact previous and next values.",
    );
    const presetReplay = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: { cookie: owner.cookie, "idempotency-key": presetKey },
    });
    const presetReplayData = data(presetReplay);
    assert(
      presetReplayData.idempotencyReplayed === true,
      "Starter preset replay was not idempotent.",
    );
    const replayedPresetSettings = await prisma.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    assert(
      replayedPresetSettings.draftGeneration === 9 && replayedPresetSettings.etag === 13,
      "Starter preset replay advanced the draft twice.",
    );

    const legacyTenant = await prisma.tenant.create({
      data: {
        name: "Capability policy reconciliation smoke",
        slug: `capability-policy-reconciliation-${suffix}`,
        timezone: "Europe/Paris",
      },
    });
    legacyTenantId = legacyTenant.id;
    await prisma.membership.create({
      data: { tenantId: legacyTenant.id, userId: owner.user.id, role: "OWNER" },
    });
    const legacySessionToken = `lv-capability-legacy-${randomBytes(32).toString("hex")}`;
    await prisma.authSession.create({
      data: {
        tenantId: legacyTenant.id,
        userId: owner.user.id,
        tokenHash: hashSecret(legacySessionToken),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        ipAddress: "127.0.0.1",
        userAgent: "knowledge-v2-capability-policy-reconciliation-smoke",
      },
    });
    const legacyCookie = cookie(legacySessionToken);
    const platformV2Defaults = buildDefaultKnowledgeCapabilityDefinitionsV1({
      tenantId: legacyTenant.id,
    });
    await prisma.knowledgeV2Capability.createMany({
      data: platformV2Defaults.map((capabilityDefinition) => ({
        id: capabilityDefinition.capabilityId,
        tenantId: legacyTenant.id,
        capabilityType: capabilityDefinition.capabilityType,
        targetKey,
        enabled: capabilityDefinition.enabled,
        allowedAutonomy: "ANSWER_ONLY" as const,
        templateKey: capabilityDefinition.templateKey,
        templateVersion: capabilityDefinition.templateVersion,
        serverOwned: true,
      })),
    });
    const legacyCapabilities = await prisma.knowledgeV2Capability.findMany({
      where: { tenantId: legacyTenant.id, targetKey },
      orderBy: { capabilityType: "asc" },
    });
    const legacyCapabilityByType = new Map(
      legacyCapabilities.map((capabilityRecord) => [
        capabilityRecord.capabilityType,
        capabilityRecord,
      ]),
    );
    await prisma.knowledgeV2RequirementDefinition.createMany({
      data: platformV2Defaults.flatMap((capabilityDefinition) => {
        const capabilityRecord = legacyCapabilityByType.get(capabilityDefinition.capabilityType)!;
        return capabilityDefinition.requirements.map((requirement) => {
          const legacyDefinition = {
            ...requirement,
            definitionVersion: 1,
            severity: "BLOCKER" as const,
            templateOrigin: "PLATFORM_V1",
          };
          return {
            id: randomUUID(),
            tenantId: legacyTenant.id,
            capabilityId: capabilityRecord.id,
            requirementKey: requirement.requirementKey,
            definitionVersion: 1,
            kind: requirement.kind,
            severity: "BLOCKER" as const,
            riskLevel: requirement.riskLevel,
            active: true,
            freshnessSlaSeconds: requirement.freshnessSlaSeconds ?? null,
            requiredScope: Prisma.DbNull,
            localeConstraints: Prisma.DbNull,
            satisfactionPredicate: requirement.satisfactionPredicate as Prisma.InputJsonValue,
            predicateVersion: requirement.predicateVersion,
            templateOrigin: "PLATFORM_V1",
            tenantOverride: false,
            immutableHash: canonicalKnowledgeV2Hash(legacyDefinition),
          };
        });
      }),
    });
    const legacySettings = await prisma.knowledgeV2Settings.create({
      data: { tenantId: legacyTenant.id, draftGeneration: 4, etag: 6 },
    });
    const legacyOperationalProjection = await loadKnowledgeOperationalCapabilityProjectionV1(
      prisma,
      { tenantId: legacyTenant.id },
    );
    assert(
      legacyOperationalProjection.permissionGeneration !== null,
      "Legacy reconciliation fixture has no operational permission generation.",
    );
    const legacyCapabilitySetHash = canonicalKnowledgeV2Hash({
      fixture: "legacy-capability-policy-v1",
      tenantId: legacyTenant.id,
    });
    const legacyRequirementSetHash = canonicalKnowledgeV2Hash({
      fixture: "legacy-requirements-v1",
      tenantId: legacyTenant.id,
    });
    const legacyManifestHash = canonicalKnowledgeV2Hash([]);
    const legacyBinding = {
      operationalBindingSchemaVersion: legacyOperationalProjection.schemaVersion,
      operationalRegistryVersion: legacyOperationalProjection.registryVersion,
      operationalRegistryHash: legacyOperationalProjection.registryHash,
      operationalDependencySetHash: legacyOperationalProjection.dependencySetHash,
      operationalBindingHash: legacyOperationalProjection.bindingHash,
      operationalPermissionGeneration: legacyOperationalProjection.permissionGeneration,
    };
    const legacyPublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: legacyTenant.id,
        targetKey,
        corpusKind: "STRUCTURED_V2",
        sequence: 1,
        status: "ACTIVE",
        manifestHash: legacyManifestHash,
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "knowledge-v2",
        promptPolicyVersion: "knowledge-v2",
        capabilitySetHash: legacyCapabilitySetHash,
        requirementEvaluationSetHash: legacyRequirementSetHash,
        ...legacyBinding,
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    const legacyPointer = await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: legacyTenant.id,
        targetKey,
        publicationId: legacyPublication.id,
        sequence: legacyPublication.sequence,
      },
    });
    const legacyDraftValidation = await prisma.knowledgeV2PublicationValidation.create({
      data: {
        tenantId: legacyTenant.id,
        targetKey,
        corpusKind: "STRUCTURED_V2",
        candidateId: targetKey,
        candidateVersion: legacySettings.draftGeneration,
        candidateManifestHash: legacyManifestHash,
        candidateItems: [],
        status: "PASSED",
        blockers: [],
        warnings: [],
        capabilitySetHash: legacyCapabilitySetHash,
        requirementEvaluationSetHash: legacyRequirementSetHash,
        ...legacyBinding,
        validationPolicyVersion,
        evaluatedAt: new Date(),
        validUntil: new Date(Date.now() + 60 * 60_000),
      },
    });
    const legacyChannel = await prisma.channel.create({
      data: {
        tenantId: legacyTenant.id,
        type: "WEBHOOK",
        status: "ACTIVE",
        name: "Legacy policy automatic reply channel",
        publicKey: `capability-policy-legacy-${suffix}`,
        settings: { deliveryMode: "managed", fixture: "policy-reconciliation" },
      },
    });
    await prisma.channel.update({
      where: { id: legacyChannel.id },
      data: {
        automaticRepliesEnabled: true,
        automaticRepliesGeneration: 2,
        automaticRepliesPublicationId: legacyPublication.id,
        automaticRepliesPublicationEtag: legacyPointer.etag,
        automaticRepliesCapabilitySetHash: legacyCapabilitySetHash,
        automaticRepliesOperationalBindingHash: legacyOperationalProjection.bindingHash,
        automaticRepliesOperationalPermissionGeneration:
          legacyOperationalProjection.permissionGeneration,
        automaticRepliesChannelFingerprint: automaticReplyChannelFingerprint(legacyChannel),
        automaticRepliesActivatedAt: new Date(),
        automaticRepliesActivatedByUserId: owner.user.id,
      },
    });

    const legacyList = await request("/knowledge/v2/capabilities", {
      headers: { cookie: legacyCookie },
    });
    const legacyListData = data(legacyList);
    assert(
      asRecord(legacyListData.starterPreset, "legacy starter preset").applied === false,
      "Legacy v1 policy was incorrectly reported as the applied starter preset.",
    );
    const legacyFaq = capability(
      asRecords(legacyListData.items, "legacy capability list"),
      "GENERAL_FAQ",
    );
    const legacyNoopPatch = await request("/knowledge/v2/capabilities/GENERAL_FAQ", {
      method: "PATCH",
      headers: {
        cookie: legacyCookie,
        "if-match": String(legacyFaq.etag),
        "idempotency-key": `capability-policy-legacy-noop-${suffix}`,
      },
      body: JSON.stringify({ enabled: true, allowedAutonomy: "ANSWER_ONLY" }),
    });
    data(legacyNoopPatch);
    const [
      untouchedLegacySettings,
      untouchedLegacyValidation,
      untouchedLegacyChannel,
      untouchedLegacyDefinitions,
      incidentalPolicyAuditCount,
    ] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: legacyTenant.id },
      }),
      prisma.knowledgeV2PublicationValidation.findUniqueOrThrow({
        where: { id: legacyDraftValidation.id },
      }),
      prisma.channel.findUniqueOrThrow({ where: { id: legacyChannel.id } }),
      prisma.knowledgeV2RequirementDefinition.findMany({
        where: { tenantId: legacyTenant.id },
        select: { definitionVersion: true },
      }),
      prisma.auditLog.findMany({
        where: {
          tenantId: legacyTenant.id,
          action: "knowledge.v2.capability_starter_preset_applied",
        },
      }),
    ]);
    assert(
      untouchedLegacySettings.draftGeneration === 4 && untouchedLegacySettings.etag === 6,
      "Legacy capability GET changed the draft.",
    );
    assert(
      untouchedLegacyValidation.status === "PASSED",
      "Legacy capability GET expired valid draft validation.",
    );
    assert(
      untouchedLegacyChannel.automaticRepliesEnabled === true &&
        untouchedLegacyChannel.automaticRepliesGeneration === 2 &&
        untouchedLegacyChannel.automaticRepliesPublicationId === legacyPublication.id,
      "Legacy capability GET revoked automatic replies.",
    );
    assert(
      untouchedLegacyDefinitions.length === 36 &&
        untouchedLegacyDefinitions.every((item) => item.definitionVersion === 1),
      "Legacy capability GET inserted a new platform policy.",
    );
    assert(
      incidentalPolicyAuditCount.length === 0,
      "Legacy capability GET wrote a mutation audit.",
    );

    const legacyPresetKey = `capability-policy-upgrade-${suffix}`;
    const legacyPreset = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: { cookie: legacyCookie, "idempotency-key": legacyPresetKey },
    });
    const legacyPresetData = data(legacyPreset);
    assert(
      asRecord(
        asRecord(legacyPresetData.resource, "legacy starter preset resource").starterPreset,
        "legacy applied starter preset",
      ).applied === true,
      "Explicit legacy upgrade did not report the applied starter policy.",
    );
    const [
      upgradedLegacySettings,
      upgradedLegacyValidation,
      upgradedLegacyChannel,
      upgradedLegacyDefinitions,
      legacyPresetAudits,
    ] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({
        where: { tenantId: legacyTenant.id },
      }),
      prisma.knowledgeV2PublicationValidation.findUniqueOrThrow({
        where: { id: legacyDraftValidation.id },
      }),
      prisma.channel.findUniqueOrThrow({ where: { id: legacyChannel.id } }),
      prisma.knowledgeV2RequirementDefinition.findMany({
        where: { tenantId: legacyTenant.id },
        select: { definitionVersion: true },
      }),
      prisma.auditLog.findMany({
        where: {
          tenantId: legacyTenant.id,
          action: "knowledge.v2.capability_starter_preset_applied",
        },
      }),
    ]);
    assert(
      upgradedLegacySettings.draftGeneration === 5 && upgradedLegacySettings.etag === 7,
      "Explicit starter preset did not advance the legacy draft exactly once.",
    );
    assert(
      upgradedLegacyValidation.status === "EXPIRED",
      "Explicit starter preset did not expire stale legacy validation.",
    );
    assert(
      upgradedLegacyChannel.automaticRepliesEnabled === false &&
        upgradedLegacyChannel.automaticRepliesGeneration === 3 &&
        upgradedLegacyChannel.automaticRepliesPublicationId === null,
      "Explicit starter preset did not revoke the legacy automatic-reply binding.",
    );
    assert(
      upgradedLegacyDefinitions.filter((item) => item.definitionVersion === 1).length === 36 &&
        upgradedLegacyDefinitions.filter((item) => item.definitionVersion === 2).length === 36,
      "Explicit starter preset did not preserve v1 and insert v2 definitions.",
    );
    assert(legacyPresetAudits.length === 1, "Explicit starter preset audit is missing.");
    const legacyPresetPayload = asRecord(
      legacyPresetAudits[0]!.payload,
      "legacy starter preset audit",
    );
    const legacyPolicyUpgrade = asRecord(
      legacyPresetPayload.policyUpgrade,
      "legacy starter preset policy upgrade",
    );
    assert(
      asRecords(legacyPresetPayload.changes, "legacy starter preset changes").length === 0 &&
        Array.isArray(legacyPolicyUpgrade.previousDefinitionVersions) &&
        legacyPolicyUpgrade.previousDefinitionVersions.join(",") === "1" &&
        legacyPolicyUpgrade.insertedRequirementDefinitions === 36 &&
        legacyPolicyUpgrade.activeDefinitionVersion === 2,
      "Starter preset audit omitted exact capability or policy upgrade details.",
    );

    const legacyPresetReplay = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: { cookie: legacyCookie, "idempotency-key": legacyPresetKey },
    });
    assert(
      data(legacyPresetReplay).idempotencyReplayed === true,
      "Legacy starter preset replay was not idempotent.",
    );
    const [replayedLegacySettings, replayedLegacyChannel, replayedLegacyAuditCount] =
      await Promise.all([
        prisma.knowledgeV2Settings.findUniqueOrThrow({
          where: { tenantId: legacyTenant.id },
        }),
        prisma.channel.findUniqueOrThrow({ where: { id: legacyChannel.id } }),
        prisma.auditLog.count({
          where: {
            tenantId: legacyTenant.id,
            action: "knowledge.v2.capability_starter_preset_applied",
          },
        }),
      ]);
    assert(
      replayedLegacySettings.draftGeneration === 5 &&
        replayedLegacySettings.etag === 7 &&
        replayedLegacyChannel.automaticRepliesGeneration === 3 &&
        replayedLegacyAuditCount === 1,
      "Legacy starter preset replay repeated upgrade side effects.",
    );

    const faqDefinition = expectedByType.get("GENERAL_FAQ")!;
    const businessIdentity = faqDefinition.requirements.find(
      (requirement) => requirement.requirementKey === "business_identity",
    )!;
    const faqCapability = await prisma.knowledgeV2Capability.findUniqueOrThrow({
      where: {
        tenantId_capabilityType_targetKey: {
          tenantId: tenant.id,
          capabilityType: "GENERAL_FAQ",
          targetKey,
        },
      },
    });
    const malformedOverride = {
      ...businessIdentity,
      definitionVersion: 3,
      severity: "BLOCKER" as const,
      templateOrigin: "TENANT_OVERRIDE",
      tenantOverride: true,
    };
    await prisma.knowledgeV2RequirementDefinition.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        capabilityId: faqCapability.id,
        requirementKey: malformedOverride.requirementKey,
        definitionVersion: malformedOverride.definitionVersion,
        kind: malformedOverride.kind,
        severity: malformedOverride.severity,
        riskLevel: malformedOverride.riskLevel,
        active: malformedOverride.active,
        freshnessSlaSeconds: malformedOverride.freshnessSlaSeconds ?? null,
        requiredScope: Prisma.DbNull,
        localeConstraints: Prisma.DbNull,
        satisfactionPredicate: malformedOverride.satisfactionPredicate as Prisma.InputJsonValue,
        predicateVersion: malformedOverride.predicateVersion,
        templateOrigin: malformedOverride.templateOrigin,
        tenantOverride: malformedOverride.tenantOverride,
        immutableHash: canonicalKnowledgeV2Hash(malformedOverride),
      },
    });
    const overriddenList = data(
      await request("/knowledge/v2/capabilities", {
        headers: { cookie: owner.cookie },
      }),
    );
    assert(
      asRecord(overriddenList.starterPreset, "overridden starter preset").applied === false,
      "A tenant override was incorrectly reported as the exact starter requirement set.",
    );
    const [integritySettingsBefore, integrityAuditCountBefore] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.auditLog.count({
        where: {
          tenantId: tenant.id,
          action: "knowledge.v2.capability_starter_preset_applied",
        },
      }),
    ]);
    const rejectedOverridePreset = await request("/knowledge/v2/capabilities/presets/starter", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "idempotency-key": `capability-malformed-override-${suffix}`,
      },
    });
    expectError(rejectedOverridePreset, 500, "KNOWLEDGE_DEPENDENCY_CAPABILITY_SNAPSHOT_INVALID");
    const [integritySettingsAfter, integrityAuditCountAfter] = await Promise.all([
      prisma.knowledgeV2Settings.findUniqueOrThrow({ where: { tenantId: tenant.id } }),
      prisma.auditLog.count({
        where: {
          tenantId: tenant.id,
          action: "knowledge.v2.capability_starter_preset_applied",
        },
      }),
    ]);
    assert(
      integritySettingsAfter.draftGeneration === integritySettingsBefore.draftGeneration &&
        integritySettingsAfter.etag === integritySettingsBefore.etag &&
        integrityAuditCountAfter === integrityAuditCountBefore,
      "Rejected requirement reconciliation committed starter side effects.",
    );

    console.log(
      JSON.stringify({
        ok: true,
        checks: {
          concurrentColdOverviewReads: concurrentOverviews.length,
          zeroRowGetSideEffectFree: true,
          zeroRowPatchSideEffectFree: true,
          explicitStarterCreation: true,
          deterministicDefaults: 8,
          requirementDefaults: 36,
          roles: ["OWNER", "ADMIN", "MANAGER_DENIED"],
          preconditions: ["IDEMPOTENCY_KEY", "IF_MATCH", "STALE_ETAG"],
          supportedAutonomyLimit: true,
          idempotentReplay: true,
          draftInvalidation: true,
          automaticReplyRevocation: true,
          unrelatedOutboxPreserved: true,
          readinessSnapshotsSeparated: true,
          atomicStarterPreset: true,
          explicitPolicyUpgrade: true,
          legacyReadSideEffectFree: true,
          legacyPatchSideEffectFree: true,
          exactRequirementSetIntegrity: true,
        },
        hashes: {
          serving: expectedCapabilitySetHash,
          draft: updatedCapabilitySetHash,
        },
      }),
    );
  } finally {
    const tenantIds = [tenantId, legacyTenantId].filter((value): value is string => value !== null);
    if (tenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } }).catch(() => undefined);
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await ownedApp?.close();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
