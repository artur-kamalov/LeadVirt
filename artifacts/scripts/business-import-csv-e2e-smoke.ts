import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { BusinessImportFileScanner } from "@leadvirt/business-import";
import { Prisma, PrismaClient } from "@leadvirt/db";
import {
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeObjectStoreError,
} from "@leadvirt/knowledge";
import {
  createRuntimeQueueEvent,
  parseRuntimeQueueEnvelope,
  type BusinessImportParseJobData,
} from "@leadvirt/runtime-queue";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AppConfigService } from "../../apps/api/src/config/app-config.service.js";
import { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../../apps/api/src/modules/knowledge/knowledge-v2-idempotency.service.js";
import { BusinessImportApplicationService } from "../../apps/api/src/modules/business-profile/business-import-application.service.js";
import {
  businessImportCandidateEtag,
  businessImportEtag,
  businessInformationEtag,
} from "../../apps/api/src/modules/business-profile/business-import-http.js";
import { BusinessImportMappingService } from "../../apps/api/src/modules/business-profile/business-import-mapping.service.js";
import type { BusinessImportQueueService } from "../../apps/api/src/modules/business-profile/business-import-queue.service.js";
import { BusinessImportReviewService } from "../../apps/api/src/modules/business-profile/business-import-review.service.js";
import { BusinessImportRuntimeService } from "../../apps/api/src/modules/business-profile/business-import-runtime.service.js";
import { BusinessImportUploadService } from "../../apps/api/src/modules/business-profile/business-import-upload.service.js";
import { BusinessImportViewService } from "../../apps/api/src/modules/business-profile/business-import-view.service.js";
import { BusinessImportWorkflowService } from "../../apps/api/src/modules/business-profile/business-import-workflow.service.js";
import { BusinessInformationStateService } from "../../apps/api/src/modules/business-profile/business-information-state.service.js";
import {
  BusinessImportProcessorError,
  createBusinessImportDependencies,
  processBusinessImportJob,
  type BusinessImportRuntimeData,
} from "../../apps/worker/src/business-import/business-import-processor.js";
import {
  createBusinessInformationProjectionDependencies,
  processBusinessInformationProjectionJob,
  type BusinessInformationProjectionRuntimeData,
} from "../../apps/worker/src/business-import/business-information-projection-processor.js";

const root = resolve(import.meta.dirname, "../..");
const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const databaseName = `leadvirt_import_e2e_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");

const csv = new TextEncoder().encode(
  [
    "external_id,category,name,description,price_type,price_amount,price_from,price_to,currency,price_unit,tax_note,duration_minutes,duration_max_minutes,location_external_id,booking_notes,active,valid_from,valid_until,language",
    "svc-e2e,Consulting,Strategy Session,Deep strategy review,FIXED,125.00,,,EUR,session,VAT included,60,75,,Bring goals,true,2026-07-01,,en",
  ].join("\n"),
);
const malformedCsv = new TextEncoder().encode('external_id,name\nsvc-bad,"unterminated\n');
const arbitraryCsv = new TextEncoder().encode(
  ["Код;Услуга;Цена;Время", "mapped-e2e;Mapped Advisory;от 50 EUR;45 минут"].join("\n"),
);

function command(args: string[], env: NodeJS.ProcessEnv) {
  const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")] : args;
  return new Promise<{ status: number | null; output: string }>((resolveCommand, rejectCommand) => {
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (status) => resolveCommand({ status, output }));
  });
}

function runtimeConfig(objectRoot: string, encodedKey: string) {
  return {
    apiUrl: "http://localhost:4001",
    businessImportEnabled: true,
    businessImportMaxFileBytes: 10 * 1024 * 1024,
    businessImportUploadTtlSeconds: 600,
    businessImportMaxPendingPerTenant: 5,
    businessImportParserApproved: false,
    businessImportParserUrl: undefined,
    businessImportParserVersion: "csv-e2e-parser-v1",
    businessImportParserTimeoutMs: 5_000,
    businessImportXlsxSandboxApproved: false,
    knowledgeObjectStorePath: objectRoot,
    knowledgeArtifactEncryptionKey: encodedKey,
    knowledgeArtifactEncryptionKeyId: "csv-e2e-key-v1",
    knowledgeFileUploadStreamTimeoutMs: 5_000,
    knowledgeFileScannerHost: "deterministic-scanner.invalid",
    knowledgeFileScannerApproved: true,
    knowledgeFileScannerPort: 3310,
    knowledgeFileScannerVersion: "deterministic-clean-v1",
    knowledgeFileScannerTimeoutMs: 5_000,
  } as unknown as AppConfigService;
}

const scanner: BusinessImportFileScanner = {
  identity: {
    provider: "leadvirt-deterministic-acceptance",
    version: "clean-v1",
    approvedForProduction: true,
  },
  async scan(input) {
    const expectedBytes =
      input.filename === "services.csv"
        ? csv
        : input.filename === "arbitrary-services.csv"
          ? arbitraryCsv
          : input.filename === "malformed-services.csv"
            ? malformedCsv
            : null;
    assert(expectedBytes, `Unexpected scanner fixture: ${input.filename}`);
    assert.equal(input.mimeType, "text/csv");
    assert.deepEqual(input.bytes, expectedBytes);
    assert.equal(input.signal.aborted, false);
    return { verdict: "CLEAN" };
  },
};

function projectionData(value: Record<string, unknown>): BusinessInformationProjectionRuntimeData {
  return value as BusinessInformationProjectionRuntimeData;
}

async function main() {
  const maintenance = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
  const objectRoot = await mkdtemp(join(tmpdir(), "leadvirt-business-import-e2e-"));
  const encodedKey = randomBytes(32).toString("base64");
  let prisma: PrismaService | null = null;
  let failure: unknown;
  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const migrated = await command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
      DATABASE_URL: smokeUrl.toString(),
    });
    assert.equal(migrated.status, 0, migrated.output);
    process.env.DATABASE_URL = smokeUrl.toString();

    prisma = new PrismaService();
    await prisma.$connect();
    const config = runtimeConfig(objectRoot, encodedKey);
    const runtime = new BusinessImportRuntimeService(config);
    const idempotency = new KnowledgeV2IdempotencyService(prisma);
    const informationState = new BusinessInformationStateService(prisma);
    const views = new BusinessImportViewService(prisma, runtime);
    const upload = new BusinessImportUploadService(
      prisma,
      idempotency,
      runtime,
      informationState,
      config,
    );
    const queue = {
      async createParseEvent(tx: Prisma.TransactionClient, data: BusinessImportParseJobData) {
        const jobId = `business-import:${data.importId}:${data.generation}`;
        return createRuntimeQueueEvent(tx, {
          tenantId: data.tenantId,
          aggregateType: "business-import",
          aggregateId: data.importId,
          aggregateVersion: data.generation,
          generation: data.generation,
          eventType: "business.import.parse.requested",
          dedupeKey: jobId,
          deadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
          envelope: {
            queueName: "business.import",
            jobName: "parse",
            jobId,
            data: data as unknown as Record<string, unknown>,
            attempts: 5,
            backoffMs: 2_000,
          },
        });
      },
      dispatch() {},
    } as unknown as BusinessImportQueueService;
    const workflow = new BusinessImportWorkflowService(prisma, idempotency, queue, runtime, views);
    const mappings = new BusinessImportMappingService(prisma, idempotency, queue, runtime);
    const review = new BusinessImportReviewService(prisma, idempotency, runtime, views);
    const applications = new BusinessImportApplicationService(
      prisma,
      idempotency,
      runtime,
      informationState,
    );

    const user = await prisma.user.create({
      data: { email: `${databaseName}@example.test`, name: "CSV E2E owner" },
    });
    const tenant = await prisma.tenant.create({
      data: {
        name: "CSV E2E business",
        slug: databaseName.replaceAll("_", "-"),
        timezone: "UTC",
      },
    });
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });
    const context: RequestContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: "OWNER",
      authMode: "credentials",
      tenant,
      user,
    };
    await prisma.businessIdentity.create({
      data: {
        tenantId: tenant.id,
        displayName: "CSV E2E business",
        businessType: "Consulting",
        description: "End-to-end import fixture",
        defaultLocale: "en",
        timezone: "UTC",
        defaultCurrency: "EUR",
      },
    });

    const activePublication = await prisma.knowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        corpusKind: "STRUCTURED_V2",
        sequence: 9,
        status: "ACTIVE",
        manifestHash: randomBytes(32).toString("hex"),
        pipelineVersion: "knowledge-v2",
        retrievalPolicyVersion: "csv-e2e-retrieval-v1",
        promptPolicyVersion: "csv-e2e-prompt-v1",
        readyAt: new Date(),
        activatedAt: new Date(),
      },
    });
    await prisma.activeKnowledgePublication.create({
      data: {
        tenantId: tenant.id,
        targetKey: "workspace-v2",
        publicationId: activePublication.id,
        sequence: activePublication.sequence,
        etag: 7,
        updatedByUserId: user.id,
      },
    });
    const activePointerBefore = await prisma.activeKnowledgePublication.findUniqueOrThrow({
      where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
      select: { publicationId: true, sequence: true, etag: true },
    });

    const intentInput = {
      filename: "services.csv",
      declaredMimeType: "text/csv",
      byteSize: csv.byteLength,
      sourceName: "CSV E2E services",
    } as const;
    const intent = await upload.createIntent(context, intentInput, "csv-e2e-intent");
    const intentReplay = await upload.createIntent(context, intentInput, "csv-e2e-intent");
    assert.equal(intentReplay.importId, intent.importId);
    assert.equal(await prisma.businessImport.count({ where: { tenantId: tenant.id } }), 1);

    const authorization = intent.headers.Authorization;
    const uploadReceipt = await upload.upload(
      intent.importId,
      authorization,
      "text/csv",
      String(csv.byteLength),
      Readable.from([csv]),
    );
    const uploadReplay = await upload.upload(
      intent.importId,
      authorization,
      "text/csv",
      String(csv.byteLength),
      Readable.from([csv]),
    );
    assert.deepEqual(uploadReplay, uploadReceipt);

    await workflow.finalize(context, intent.importId, "csv-e2e-finalize");
    await workflow.finalize(context, intent.importId, "csv-e2e-finalize");
    const importBeforeProcess = await prisma.businessImport.findUniqueOrThrow({
      where: { id: intent.importId },
    });
    assert.equal(importBeforeProcess.state, "SCANNING");
    assert(importBeforeProcess.uploadedAt);
    assert(importBeforeProcess.finalizedAt);
    const parseOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `business-import:${intent.importId}:1`,
        },
      },
    });
    await prisma.runtimeOutbox.update({
      where: { id: parseOutbox.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const parseEnvelope = parseRuntimeQueueEnvelope(parseOutbox.payload);
    assert.equal(parseEnvelope.jobName, "parse");
    const storedParseData = parseEnvelope.data as unknown as BusinessImportParseJobData;

    const objectStore = new EncryptedFileKnowledgeObjectStore({
      rootPath: objectRoot,
      activeKey: {
        id: "csv-e2e-key-v1",
        key: decodeKnowledgeObjectEncryptionKey(encodedKey),
      },
      maxPlaintextBytes: 10 * 1024 * 1024,
    });
    const processorDependencies = createBusinessImportDependencies(prisma, {
      objectStore,
      objectEncryptionKeyId: "csv-e2e-key-v1",
      scanner,
      now: () => new Date(),
    });
    const parseData = {
      ...storedParseData,
      runtimeEventId: parseOutbox.id,
      runtimeGeneration: parseOutbox.generation,
    } satisfies BusinessImportRuntimeData;
    await assert.rejects(
      processBusinessImportJob(
        {
          id: parseEnvelope.jobId,
          name: parseEnvelope.jobName,
          data: {
            ...parseData,
            requestedAt: new Date(Date.parse(parseData.requestedAt) - 1_000).toISOString(),
          },
          signal: new AbortController().signal,
        },
        processorDependencies,
      ),
      (error: unknown) =>
        error instanceof BusinessImportProcessorError &&
        error.code === "BUSINESS_IMPORT_RUNTIME_OUTBOX_FENCE_INVALID" &&
        error.canMutateImportOnFailure === false,
    );
    const importAfterForgedJob = await prisma.businessImport.findUniqueOrThrow({
      where: { id: intent.importId },
    });
    assert.equal(importAfterForgedJob.state, "SCANNING");
    assert.equal(importAfterForgedJob.failureCode, null);
    assert.equal(importAfterForgedJob.etag, importBeforeProcess.etag);
    const processed = await processBusinessImportJob(
      {
        id: parseEnvelope.jobId,
        name: parseEnvelope.jobName,
        data: parseData,
        signal: new AbortController().signal,
      },
      processorDependencies,
    );
    assert.equal(processed.status, "succeeded");
    assert.equal(processed.state, "READY_FOR_REVIEW");
    assert.equal(processed.candidateCount, 1);
    const processorReplay = await processBusinessImportJob(
      {
        id: parseEnvelope.jobId,
        name: parseEnvelope.jobName,
        data: parseData,
        signal: new AbortController().signal,
      },
      processorDependencies,
    );
    assert.equal(processorReplay.status, "already_succeeded");
    assert.equal(await prisma.businessImportParsedRevision.count(), 1);
    assert.equal(await prisma.businessImportArtifact.count(), 1);
    assert.equal(await prisma.businessImportCandidate.count(), 1);

    const candidate = await prisma.businessImportCandidate.findFirstOrThrow({
      where: { tenantId: tenant.id, importId: intent.importId },
    });
    assert.equal(candidate.action, "ADD");
    assert.equal(candidate.risk, "HIGH");
    assert.equal(candidate.requiresApproval, true);
    assert.equal(candidate.version, 1);
    assert.equal(candidate.decision, "PENDING");
    await review.decideCandidate(
      context,
      intent.importId,
      candidate.id,
      { decision: "ACCEPTED" },
      businessImportCandidateEtag(candidate.id, candidate.etag),
      "csv-e2e-candidate-accept",
    );

    const importBeforeApproval = await prisma.businessImport.findUniqueOrThrow({
      where: { id: intent.importId },
    });
    const informationBeforeApproval = await informationState.get(context);
    const blockedPreview = await applications.preview(
      context,
      intent.importId,
      { candidateIds: [candidate.id] },
      businessImportEtag(intent.importId, importBeforeApproval.etag),
      businessInformationEtag(tenant.id, informationBeforeApproval.etag),
      "csv-e2e-blocked-preview",
    );
    assert(
      blockedPreview.diagnostics.some(
        (diagnostic) => diagnostic.code === "BUSINESS_IMPORT_APPROVAL_REQUIRED",
      ),
    );
    assert.equal(await prisma.businessImportApplication.count(), 0);
    assert.equal(await prisma.businessInformationRevision.count(), 0);
    assert.equal(await prisma.businessOffering.count(), 0);
    assert.equal(await prisma.knowledgeV2Fact.count(), 0);

    const approvalRequest = await review.requestApproval(
      context,
      intent.importId,
      [candidate.id],
      businessImportEtag(intent.importId, importBeforeApproval.etag),
      "csv-e2e-approval-request",
    );
    const pendingApproval = approvalRequest.candidates[0]?.approval;
    assert(pendingApproval);
    assert.equal(pendingApproval.state, "PENDING");
    const importForApproval = await prisma.businessImport.findUniqueOrThrow({
      where: { id: intent.importId },
    });
    await review.decideApproval(
      context,
      intent.importId,
      pendingApproval.id,
      { decision: "APPROVED", reason: "Exact imported price approved" },
      businessImportEtag(intent.importId, importForApproval.etag),
      "csv-e2e-approval-decision",
    );
    await review.decideApproval(
      context,
      intent.importId,
      pendingApproval.id,
      { decision: "APPROVED", reason: "Exact imported price approved" },
      businessImportEtag(intent.importId, importForApproval.etag),
      "csv-e2e-approval-decision",
    );
    const [approvedCandidate, approvedGrant] = await Promise.all([
      prisma.businessImportCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      prisma.businessImportApprovalGrant.findFirstOrThrow({ where: { candidateId: candidate.id } }),
    ]);
    assert.equal(approvedCandidate.decision, "ACCEPTED");
    assert.equal(approvedGrant.candidateVersion, approvedCandidate.version);
    assert.equal(approvedGrant.candidateValueHash, approvedCandidate.normalizedValueHash);
    assert.equal(approvedGrant.grantedByUserId, user.id);
    assert.equal(await prisma.businessImportApprovalGrant.count(), 1);

    const importForApply = await prisma.businessImport.findUniqueOrThrow({
      where: { id: intent.importId },
    });
    const informationForApply = await informationState.get(context);
    const importIfMatch = businessImportEtag(intent.importId, importForApply.etag);
    const informationIfMatch = businessInformationEtag(tenant.id, informationForApply.etag);
    const preview = await applications.preview(
      context,
      intent.importId,
      { candidateIds: [candidate.id] },
      importIfMatch,
      informationIfMatch,
      "csv-e2e-apply-preview",
    );
    assert.equal(preview.diagnostics.length, 0);
    const application = await applications.apply(
      context,
      intent.importId,
      { candidateIds: [candidate.id], manifestHash: preview.manifestHash },
      importIfMatch,
      informationIfMatch,
      "csv-e2e-apply",
    );
    const applicationReplay = await applications.apply(
      context,
      intent.importId,
      { candidateIds: [candidate.id], manifestHash: preview.manifestHash },
      importIfMatch,
      informationIfMatch,
      "csv-e2e-apply",
    );
    assert.equal(applicationReplay.id, application.id);
    assert.equal(await prisma.businessImportApplication.count(), 1);
    assert.equal(await prisma.businessInformationRevision.count(), 1);
    assert.equal(await prisma.businessOffering.count(), 1);
    assert.equal(await prisma.businessOfferingPrice.count(), 1);

    const storedApplication = await prisma.businessImportApplication.findUniqueOrThrow({
      where: { id: application.id },
      include: { projectionOutbox: true },
    });
    assert(storedApplication.projectionOutbox);
    await prisma.runtimeOutbox.update({
      where: { id: storedApplication.projectionOutbox.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const projectionEnvelope = parseRuntimeQueueEnvelope(
      storedApplication.projectionOutbox.payload,
    );
    assert.equal(projectionEnvelope.jobName, "project");
    const projectionRuntimeData = projectionData({
      ...projectionEnvelope.data,
      runtimeEventId: storedApplication.projectionOutbox.id,
      runtimeGeneration: storedApplication.projectionOutbox.generation,
    });
    const projectionDependencies = createBusinessInformationProjectionDependencies(prisma);
    const projection = await processBusinessInformationProjectionJob(
      {
        id: projectionEnvelope.jobId,
        name: "project",
        data: projectionRuntimeData,
        signal: new AbortController().signal,
      },
      projectionDependencies,
    );
    assert.equal(projection.status, "succeeded");
    assert.equal(projection.importState, "APPLIED");

    const offering = await prisma.businessOffering.findFirstOrThrow({
      where: { tenantId: tenant.id },
      include: { prices: true, duration: true },
    });
    const fact = await prisma.knowledgeV2Fact.findUniqueOrThrow({
      where: {
        tenantId_factKey: {
          tenantId: tenant.id,
          factKey: `business-information:offering:${offering.id}`,
        },
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { evidence: true },
        },
      },
    });
    const factVersion = fact.versions[0];
    assert(factVersion);
    const normalized = factVersion.normalizedValue as Record<string, unknown>;
    const prices = normalized.prices as Array<Record<string, unknown>>;
    const duration = normalized.duration as Record<string, unknown>;
    assert.equal(factVersion.lifecycleStatus, "DRAFT");
    assert.equal(factVersion.riskLevel, "HIGH");
    assert.equal(factVersion.verificationStatus, "VERIFIED");
    assert.equal(factVersion.verifiedByUserId, user.id);
    assert.equal(factVersion.displayValue, "Strategy Session");
    assert.equal(normalized.schema, "leadvirt.business-offering-fact.v1");
    assert.equal(normalized.name, "Strategy Session");
    assert.equal(prices[0]?.type, "FIXED");
    assert.equal(prices[0]?.amount, "125");
    assert.equal(prices[0]?.currency, "EUR");
    assert.equal(duration.minimumMinutes, 60);
    assert.equal(duration.maximumMinutes, 75);
    assert(factVersion.evidence.length > 0);

    const finalApplication = await prisma.businessImportApplication.findUniqueOrThrow({
      where: { id: application.id },
      include: { projectionReceipt: true },
    });
    assert.equal(finalApplication.state, "READY");
    assert(finalApplication.projectionReceipt);
    assert.equal(
      finalApplication.projectionReceiptHash,
      finalApplication.projectionReceipt.receiptHash,
    );
    assert.equal(finalApplication.projectionReceipt.importId, intent.importId);
    assert.equal(finalApplication.projectionReceipt.applicationId, application.id);
    assert.equal(
      finalApplication.projectionReceipt.businessRevisionId,
      finalApplication.businessRevisionId,
    );
    assert.equal(
      finalApplication.projectionReceipt.businessRevisionHash,
      finalApplication.resultingInformationHash,
    );
    assert.equal(finalApplication.projectionReceipt.knowledgeTargetKey, "workspace-v2");
    assert.match(finalApplication.projectionReceipt.knowledgeDraftManifestHash, /^[a-f0-9]{64}$/u);
    assert.match(finalApplication.projectionReceipt.receiptHash, /^[a-f0-9]{64}$/u);

    const factVersionCount = await prisma.knowledgeV2FactVersion.count({
      where: { factId: fact.id },
    });
    const settingsBeforeReplay = await prisma.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    const projectionReplay = await processBusinessInformationProjectionJob(
      {
        id: projectionEnvelope.jobId,
        name: "project",
        data: projectionRuntimeData,
        signal: new AbortController().signal,
      },
      projectionDependencies,
    );
    assert.equal(projectionReplay.status, "already_succeeded");
    assert.equal(
      await prisma.knowledgeV2FactVersion.count({ where: { factId: fact.id } }),
      factVersionCount,
    );
    const settingsAfterReplay = await prisma.knowledgeV2Settings.findUniqueOrThrow({
      where: { tenantId: tenant.id },
    });
    assert.equal(settingsAfterReplay.draftGeneration, settingsBeforeReplay.draftGeneration);
    assert.equal(await prisma.businessInformationProjectionReceipt.count(), 1);

    const activePointerAfter = await prisma.activeKnowledgePublication.findUniqueOrThrow({
      where: { tenantId_targetKey: { tenantId: tenant.id, targetKey: "workspace-v2" } },
      select: { publicationId: true, sequence: true, etag: true },
    });
    assert.deepEqual(activePointerAfter, activePointerBefore);
    const finalImport = await prisma.businessImport.findUniqueOrThrow({
      where: { id: intent.importId },
    });
    assert.equal(finalImport.state, "APPLIED");

    const arbitraryIntent = await upload.createIntent(
      context,
      {
        filename: "arbitrary-services.csv",
        declaredMimeType: "text/csv",
        byteSize: arbitraryCsv.byteLength,
        sourceName: "Customer price list",
      },
      "csv-e2e-arbitrary-intent",
    );
    await upload.upload(
      arbitraryIntent.importId,
      arbitraryIntent.headers.Authorization,
      "text/csv",
      String(arbitraryCsv.byteLength),
      Readable.from([arbitraryCsv]),
    );
    await workflow.finalize(context, arbitraryIntent.importId, "csv-e2e-arbitrary-finalize");
    const arbitraryParseOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `business-import:${arbitraryIntent.importId}:1`,
        },
      },
    });
    await prisma.runtimeOutbox.update({
      where: { id: arbitraryParseOutbox.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const arbitraryParseEnvelope = parseRuntimeQueueEnvelope(arbitraryParseOutbox.payload);
    const arbitraryParseData = {
      ...(arbitraryParseEnvelope.data as unknown as BusinessImportParseJobData),
      runtimeEventId: arbitraryParseOutbox.id,
      runtimeGeneration: arbitraryParseOutbox.generation,
    } satisfies BusinessImportRuntimeData;
    const mappingRequired = await processBusinessImportJob(
      {
        id: arbitraryParseEnvelope.jobId,
        name: arbitraryParseEnvelope.jobName,
        data: arbitraryParseData,
        signal: new AbortController().signal,
      },
      processorDependencies,
    );
    assert.equal(mappingRequired.status, "succeeded");
    assert.equal(mappingRequired.state, "MAPPING_REQUIRED");
    assert.equal(mappingRequired.candidateCount, 0);

    const mappingView = await mappings.get(context, arbitraryIntent.importId);
    assert.equal(mappingView.table.headerRow, 1);
    assert.equal(mappingView.table.totalRows, 1);
    assert.deepEqual(
      mappingView.table.columns.map((column) => [
        column.header,
        column.proposedTarget,
        column.examples[0],
      ]),
      [
        ["Код", "external_id", "mapped-e2e"],
        ["Услуга", "name", "Mapped Advisory"],
        ["Цена", "price", "от 50 EUR"],
        ["Время", "duration", "45 минут"],
      ],
    );
    const mappingReceipt = await mappings.confirm(
      context,
      arbitraryIntent.importId,
      {
        tableKey: mappingView.table.tableKey,
        schemaHash: mappingView.table.schemaHash,
        headerRow: mappingView.table.headerRow,
        columns: mappingView.table.columns.map((column) => ({
          sourceColumnKey: column.sourceColumnKey,
          target: column.proposedTarget,
        })),
        defaults: {
          locale: "ru",
          numberFormat: "DECIMAL_DOT",
          currency: "EUR",
          timezone: null,
          unit: "session",
        },
      },
      mappingView.etag,
      "csv-e2e-arbitrary-mapping",
    );
    assert.equal(mappingReceipt.state, "PARSING");
    assert.equal(mappingReceipt.generation, 2);
    assert.equal(mappingReceipt.idempotencyReplayed, false);

    const staleMappedParseOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `business-import:${arbitraryIntent.importId}:2`,
        },
      },
    });
    await prisma.businessImport.update({
      where: { id: arbitraryIntent.importId },
      data: {
        state: "FAILED_RETRYABLE",
        retryable: true,
        failureCode: "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
        failureStage: "STORAGE",
        etag: { increment: 1 },
      },
    });
    const failedMappedImport = await prisma.businessImport.findUniqueOrThrow({
      where: { id: arbitraryIntent.importId },
    });
    const retriedMappedImport = await workflow.retry(
      context,
      arbitraryIntent.importId,
      { generation: failedMappedImport.generation },
      businessImportEtag(arbitraryIntent.importId, failedMappedImport.etag),
      "csv-e2e-arbitrary-mapped-retry",
    );
    assert.equal(retriedMappedImport.state, "PARSING");
    assert.equal(retriedMappedImport.generation, 3);

    await prisma.runtimeOutbox.update({
      where: { id: staleMappedParseOutbox.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const staleMappedParseEnvelope = parseRuntimeQueueEnvelope(staleMappedParseOutbox.payload);
    const staleMappedResult = await processBusinessImportJob(
      {
        id: staleMappedParseEnvelope.jobId,
        name: staleMappedParseEnvelope.jobName,
        data: {
          ...(staleMappedParseEnvelope.data as unknown as BusinessImportParseJobData),
          runtimeEventId: staleMappedParseOutbox.id,
          runtimeGeneration: staleMappedParseOutbox.generation,
        },
        signal: new AbortController().signal,
      },
      processorDependencies,
    );
    assert.equal(staleMappedResult.status, "cancelled");
    assert.equal(staleMappedResult.reason, "stale_generation");

    const mappedParseOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `business-import:${arbitraryIntent.importId}:3`,
        },
      },
    });
    await prisma.runtimeOutbox.update({
      where: { id: mappedParseOutbox.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const mappedParseEnvelope = parseRuntimeQueueEnvelope(mappedParseOutbox.payload);
    const mappedParseData = {
      ...(mappedParseEnvelope.data as unknown as BusinessImportParseJobData),
      runtimeEventId: mappedParseOutbox.id,
      runtimeGeneration: mappedParseOutbox.generation,
    } satisfies BusinessImportRuntimeData;
    const mappedResult = await processBusinessImportJob(
      {
        id: mappedParseEnvelope.jobId,
        name: mappedParseEnvelope.jobName,
        data: mappedParseData,
        signal: new AbortController().signal,
      },
      processorDependencies,
    );
    assert.equal(mappedResult.status, "succeeded");
    assert.equal(mappedResult.state, "READY_FOR_REVIEW");
    assert.equal(mappedResult.candidateCount, 1);
    const mappedImport = await prisma.businessImport.findUniqueOrThrow({
      where: { id: arbitraryIntent.importId },
      include: {
        candidates: true,
        candidateRevisions: true,
        parsedRevisions: true,
        mappings: true,
        quotaReservation: true,
      },
    });
    assert.equal(mappedImport.state, "READY_FOR_REVIEW");
    assert.equal(mappedImport.generation, 3);
    assert(mappedImport.reviewReadyAt);
    assert.equal(mappedImport.parsedRevisions.length, 2);
    assert.equal(mappedImport.mappings.length, 1);
    assert.equal(mappedImport.candidates.length, 1);
    assert.equal(mappedImport.candidates[0]?.mappingId, mappingReceipt.mappingId);
    assert.equal(mappedImport.candidateRevisions[0]?.mappingId, mappingReceipt.mappingId);
    assert.equal(mappedImport.quotaReservation?.status, "CONSUMED");
    const mappedValue = mappedImport.candidates[0]?.normalizedValue as Record<string, unknown>;
    const mappedPrice = mappedValue.price as Record<string, unknown>;
    const mappedDuration = mappedValue.duration as Record<string, unknown>;
    assert.equal(mappedValue.name, "Mapped Advisory");
    assert.equal(mappedValue.language, "ru");
    assert.equal(mappedPrice.type, "FROM");
    assert.equal(mappedPrice.from, "50");
    assert.equal(mappedPrice.currency, "EUR");
    assert.equal(mappedPrice.unit, "session");
    assert.equal(mappedDuration.minimumMinutes, 45);

    const failedIntent = await upload.createIntent(
      context,
      {
        filename: "malformed-services.csv",
        declaredMimeType: "text/csv",
        byteSize: malformedCsv.byteLength,
        sourceName: "Malformed CSV E2E services",
      },
      "csv-e2e-failed-intent",
    );
    await upload.upload(
      failedIntent.importId,
      failedIntent.headers.Authorization,
      "text/csv",
      String(malformedCsv.byteLength),
      Readable.from([malformedCsv]),
    );
    const failedBeforeFinalize = await prisma.businessImport.findUniqueOrThrow({
      where: { id: failedIntent.importId },
    });
    assert(failedBeforeFinalize.stagingObjectKey);
    assert(failedBeforeFinalize.stagingEncryptionKeyRef);
    assert(failedBeforeFinalize.stagingObjectLedgerId);
    await workflow.finalize(context, failedIntent.importId, "csv-e2e-failed-finalize");
    const failedOutbox = await prisma.runtimeOutbox.findUniqueOrThrow({
      where: {
        tenantId_dedupeKey: {
          tenantId: tenant.id,
          dedupeKey: `business-import:${failedIntent.importId}:1`,
        },
      },
    });
    await prisma.runtimeOutbox.update({
      where: { id: failedOutbox.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const failedEnvelope = parseRuntimeQueueEnvelope(failedOutbox.payload);
    const failedRuntimeData = {
      ...(failedEnvelope.data as unknown as BusinessImportParseJobData),
      runtimeEventId: failedOutbox.id,
      runtimeGeneration: failedOutbox.generation,
    } satisfies BusinessImportRuntimeData;
    await assert.rejects(
      processBusinessImportJob(
        {
          id: failedEnvelope.jobId,
          name: failedEnvelope.jobName,
          data: failedRuntimeData,
          signal: new AbortController().signal,
        },
        processorDependencies,
      ),
      (error: unknown) => error instanceof BusinessImportProcessorError && !error.retryable,
    );
    const failedImport = await prisma.businessImport.findUniqueOrThrow({
      where: { id: failedIntent.importId },
    });
    assert.equal(failedImport.state, "FAILED");
    assert.equal(failedImport.retryable, false);
    assert.equal(failedImport.stagingObjectKey, null);
    assert.equal(failedImport.stagingEncryptionKeyRef, null);
    assert.equal(failedImport.stagingObjectLedgerId, null);
    assert.equal(
      (
        await prisma.businessImportQuotaReservation.findUniqueOrThrow({
          where: {
            tenantId_importId: { tenantId: tenant.id, importId: failedIntent.importId },
          },
        })
      ).status,
      "RELEASED",
    );
    const failedStagingLedger = await prisma.businessImportObjectLedger.findUniqueOrThrow({
      where: { id: failedBeforeFinalize.stagingObjectLedgerId },
    });
    assert.equal(failedStagingLedger.deletionState, "DELETED");
    await assert.rejects(
      objectStore.get(
        failedBeforeFinalize.stagingObjectKey,
        failedBeforeFinalize.stagingEncryptionKeyRef,
      ),
      (error: unknown) =>
        error instanceof KnowledgeObjectStoreError && error.code === "OBJECT_NOT_FOUND",
    );

    console.log(
      "Business import CSV E2E smoke passed (deterministic approved scanner; real ClamAV not exercised).",
    );
  } catch (error) {
    failure = error;
  }
  for (const cleanup of [
    async () => prisma?.$disconnect(),
    async () =>
      maintenance.$queryRawUnsafe(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        databaseName,
      ),
    async () => maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`),
    async () => maintenance.$disconnect(),
    async () => rm(objectRoot, { recursive: true, force: true }),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure instanceof Error) throw failure;
  if (failure !== undefined) throw new Error("Business import CSV E2E smoke failed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
