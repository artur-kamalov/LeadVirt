import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { BUSINESS_SERVICE_MAPPING_VERSION } from "@leadvirt/business-import";
import type { BusinessImportMappingConfirmRequest } from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { businessImportEtag } from "./business-import-http.js";
import { BusinessImportMappingService } from "./business-import-mapping.service.js";

const tenantId = "tenant-mapping";
const userId = "user-mapping";
const importId = "import-mapping";
const sourceId = "source-mapping";
const parsedRevisionId = "parsed-mapping";
const objectKey = "mapping-manifest";
const encryptionKeyRef = "mapping-key";
const manifestLedgerId = "manifest-ledger";
const artifactId = "artifact-mapping";
const artifactHash = "b".repeat(64);
const artifactObjectKey = "mapping-raw";
const artifactEncryptionKeyRef = "mapping-raw-key";
const artifactLedgerId = "artifact-ledger";
const schemaHash = "a".repeat(64);
const longExample = "x".repeat(500);
const previewExample = longExample.slice(0, 200);
const manifest = {
  contractVersion: "leadvirt.business-import.manifest.v1",
  format: "CSV",
  status: "MAPPING_REQUIRED",
  parserVersion: "leadvirt.csv.services.v1",
  schemaHash,
  analysis: {
    version: BUSINESS_SERVICE_MAPPING_VERSION,
    format: "CSV",
    tableKey: "csv:services",
    schemaHash,
    encoding: "utf-8",
    delimiter: ",",
    headerRow: 1,
    rowCount: 4,
    columns: [
      {
        columnKey: "column:1",
        column: 1,
        header: "Service",
        normalizedHeader: "service",
        samples: [
          { row: 2, value: "Audit", truncated: false },
          { row: 3, value: "Consulting", truncated: false },
        ],
        nonEmptyCount: 4,
      },
      {
        columnKey: "column:2",
        column: 2,
        header: "Private price",
        normalizedHeader: "private price",
        samples: [
          { row: 2, value: previewExample, truncated: true },
          { row: 3, value: "200 EUR", truncated: false },
          { row: 4, value: "300 EUR", truncated: false },
        ],
        nonEmptyCount: 4,
      },
    ],
  },
  proposal: {
    version: BUSINESS_SERVICE_MAPPING_VERSION,
    tableKey: "csv:services",
    schemaHash,
    headerRow: 1,
    columns: [
      {
        columnKey: "column:1",
        target: "name",
        status: "MATCHED",
        confidence: "HIGH",
        reasonCodes: ["HEADER_ALIAS"],
      },
      {
        columnKey: "column:2",
        target: "price",
        status: "CHECK_MAPPING",
        confidence: "MEDIUM",
        reasonCodes: ["VALUE_SHAPE_PRICE"],
      },
    ],
    defaults: {
      locale: "en",
      numberFormat: "DECIMAL_DOT",
      currency: "EUR",
      timezone: "Europe/Paris",
      unit: null,
    },
    validation: { errorCodes: [], warningCodes: ["BUSINESS_IMPORT_MAPPING_PRICE_REVIEW"] },
  },
  diagnostics: [],
};
const bytes = new TextEncoder().encode(JSON.stringify(manifest));
let storedManifestHash = createHash("sha256").update(bytes).digest("hex");

const importRow = () => ({
  id: importId,
  sourceId,
  format: "CSV" as const,
  state: "MAPPING_REQUIRED" as const,
  generation: 1,
  etag: 4,
  expectedByteSize: 512n,
  artifactId,
  artifactSha256: artifactHash,
  parsedRevisionId,
  parsedManifestObjectKey: objectKey,
  parsedManifestEncryptionKeyRef: encryptionKeyRef,
  parsedManifestHash: storedManifestHash,
  artifact: {
    id: artifactId,
    sourceId,
    sha256: artifactHash,
    byteSize: 512n,
    malwareStatus: "CLEAN",
    mimeValidationStatus: "VALID",
    objectKind: "RAW_ARTIFACT",
    objectStorageKey: artifactObjectKey,
    encryptionKeyRef: artifactEncryptionKeyRef,
    objectLedger: {
      id: artifactLedgerId,
      deletionState: "RETAINED",
      objectKind: "RAW_ARTIFACT",
      objectStorageKey: artifactObjectKey,
      encryptionKeyRef: artifactEncryptionKeyRef,
      retentionClass: "BUSINESS_IMPORT_RAW",
      retainUntil: new Date(Date.now() + 60_000),
    },
  },
  currentParsedRevision: {
    id: parsedRevisionId,
    importGeneration: 1,
    artifactId,
    artifactSha256: artifactHash,
    manifestObjectLedgerId: manifestLedgerId,
    manifestObjectKey: objectKey,
    manifestEncryptionKeyRef: encryptionKeyRef,
    manifestHash: storedManifestHash,
    manifestObjectLedger: {
      id: manifestLedgerId,
      deletionState: "RETAINED",
      objectKind: "PARSED_MANIFEST",
      objectStorageKey: objectKey,
      encryptionKeyRef,
      retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
      retainUntil: new Date(Date.now() + 60_000),
    },
  },
});
const currentImport = () => ({
  ...importRow(),
  tenantId,
  purpose: "SERVICES",
  currentParsedRevision: undefined,
});
const source = {
  id: sourceId,
  tenantId,
  status: "ACTIVE",
  lastMappingRevision: null,
  etag: 1,
};
const context = {
  tenantId,
  userId,
  role: "OWNER",
  authMode: "credentials",
  tenant: {},
  user: {},
} as RequestContext;

const captured: {
  createdMapping?: Record<string, unknown>;
  importUpdate?: Record<string, unknown>;
  auditPayload?: unknown;
} = {};
let dispatchedEventId: string | null = null;
let retainedDuringMutation = true;
let retentionExtensions = 0;
let mappingCreateCount = 0;
const transaction = {
  $queryRaw: () => Promise.resolve([{ id: "locked" }]),
  businessImport: {
    findFirst: () => Promise.resolve(currentImport()),
    updateMany: (input: Record<string, unknown>) => {
      captured.importUpdate = input;
      return Promise.resolve({ count: 1 });
    },
  },
  businessImportSource: {
    findFirst: () => Promise.resolve(source),
    update: () => Promise.resolve(source),
  },
  membership: {
    findUnique: () =>
      Promise.resolve({
        role: "OWNER",
        user: { deletedAt: null },
        tenant: { deletedAt: null, status: "ACTIVE" },
      }),
  },
  businessImportMapping: {
    findFirst: () => Promise.resolve(null),
    create: (input: { data: Record<string, unknown> }) => {
      mappingCreateCount += 1;
      captured.createdMapping = input.data;
      return Promise.resolve({ id: "mapping-1", revision: 1 });
    },
  },
  businessImportObjectLedger: {
    findMany: () =>
      Promise.resolve(
        [
          {
            id: artifactLedgerId,
            objectKind: "RAW_ARTIFACT",
            objectStorageKey: artifactObjectKey,
            encryptionKeyRef: artifactEncryptionKeyRef,
            retentionClass: "BUSINESS_IMPORT_RAW",
            deletionState: retainedDuringMutation ? "RETAINED" : "TOMBSTONED",
            retainUntil: new Date(Date.now() + 60_000),
          },
          {
            id: manifestLedgerId,
            objectKind: "PARSED_MANIFEST",
            objectStorageKey: objectKey,
            encryptionKeyRef,
            retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
            deletionState: retainedDuringMutation ? "RETAINED" : "TOMBSTONED",
            retainUntil: new Date(Date.now() + 60_000),
          },
        ].filter(() => retainedDuringMutation),
      ),
    updateMany: () => {
      retentionExtensions += 1;
      return Promise.resolve({ count: 1 });
    },
  },
  auditLog: {
    create: (input: { data: { payload: unknown } }) => {
      captured.auditPayload = input.data.payload;
      return Promise.resolve(input.data);
    },
  },
};
const prisma = {
  businessImport: {
    findFirst: () => Promise.resolve(importRow()),
  },
};
const idempotency = {
  executePrepared: async (
    _input: unknown,
    prepare: () => Promise<unknown>,
    mutation: (
      tx: typeof transaction,
      prepared: unknown,
    ) => Promise<{
      httpStatus: number;
      responseBody: Record<string, unknown>;
      responseRef?: string;
    }>,
  ) => {
    const prepared = await prepare();
    return { ...(await mutation(transaction, prepared)), idempotencyReplayed: false };
  },
};
const queue = {
  createParseEvent: () => Promise.resolve({ id: "event-mapping-1" }),
  dispatch: (eventId: string) => {
    dispatchedEventId = eventId;
  },
};
const runtime = {
  runtime: () => ({
    store: {
      get: (key: string, keyRef: string) => {
        assert.equal(key, objectKey);
        assert.equal(keyRef, encryptionKeyRef);
        return Promise.resolve(bytes);
      },
    },
  }),
};
const service = new BusinessImportMappingService(
  prisma as never,
  idempotency as never,
  queue as never,
  runtime as never,
);

const view = await service.get(context, importId);
assert.equal(view.etag, businessImportEtag(importId, 4));
assert.equal(view.table.columns.length, 2);
assert.deepEqual(view.table.columns[0], {
  sourceColumnKey: "column:1",
  index: 1,
  header: "Service",
  examples: ["Audit", "Consulting"],
  proposedTarget: "name",
  status: "MATCHED",
});
assert.equal(view.table.columns[1]?.examples.length, 3);
assert.equal(view.table.columns[1]?.examples[0]?.length, 200);
assert.equal(view.validation.canConfirm, true);

const request: BusinessImportMappingConfirmRequest = {
  tableKey: view.table.tableKey,
  schemaHash: view.table.schemaHash,
  headerRow: view.table.headerRow,
  columns: view.table.columns.map((column) => ({
    sourceColumnKey: column.sourceColumnKey,
    target: column.proposedTarget,
  })),
  defaults: view.defaults,
};
const receipt = await service.confirm(
  context,
  importId,
  request,
  view.etag,
  "mapping-confirm-smoke",
);
assert.deepEqual(receipt, {
  importId,
  mappingId: "mapping-1",
  generation: 2,
  state: "PARSING",
  etag: businessImportEtag(importId, 5),
  idempotencyReplayed: false,
});
assert.equal(dispatchedEventId, "event-mapping-1");
assert.equal(retentionExtensions, 2);
assert.equal(mappingCreateCount, 1);
assert.deepEqual(captured.createdMapping?.fieldMappings, {
  version: 2,
  sourceGeneration: 1,
  parsedRevisionId,
  parsedManifestHash: storedManifestHash,
  numberFormat: "DECIMAL_DOT",
  columns: [
    { sourceColumnKey: "column:1", target: "name" },
    { sourceColumnKey: "column:2", target: "price" },
  ],
});
assert.equal((captured.importUpdate?.data as Record<string, unknown>).state, "PARSING");
assert.equal((captured.importUpdate?.data as Record<string, unknown>).generation, 2);
assert.equal((captured.importUpdate?.data as Record<string, unknown>).parsedRevisionId, null);
assert.equal("artifactId" in (captured.importUpdate?.data as Record<string, unknown>), false);
const durableText = JSON.stringify(captured);
assert.equal(durableText.includes("Private price"), false);
assert.equal(durableText.includes(previewExample), false);

const legacyDefaults = Object.fromEntries(
  Object.entries(manifest.proposal.defaults).filter(([key]) => key !== "numberFormat"),
);
const legacyManifest = {
  ...manifest,
  proposal: {
    ...manifest.proposal,
    defaults: legacyDefaults,
  },
};
const legacyBytes = new TextEncoder().encode(JSON.stringify(legacyManifest));
storedManifestHash = createHash("sha256").update(legacyBytes).digest("hex");
const legacyService = new BusinessImportMappingService(
  prisma as never,
  idempotency as never,
  queue as never,
  {
    runtime: () => ({
      store: {
        get: () => Promise.resolve(legacyBytes),
      },
    }),
  } as never,
);
const legacyView = await legacyService.get(context, importId);
assert.equal(legacyView.defaults.locale, "en");
assert.equal(legacyView.defaults.numberFormat, "DECIMAL_DOT");

const blockedManifest = {
  ...manifest,
  proposal: {
    ...manifest.proposal,
    validation: {
      ...manifest.proposal.validation,
      errorCodes: ["BUSINESS_IMPORT_MAPPING_SOURCE_BLOCKED"],
    },
  },
};
const blockedBytes = new TextEncoder().encode(JSON.stringify(blockedManifest));
storedManifestHash = createHash("sha256").update(blockedBytes).digest("hex");
const blockedService = new BusinessImportMappingService(
  prisma as never,
  idempotency as never,
  queue as never,
  {
    runtime: () => ({
      store: {
        get: () => Promise.resolve(blockedBytes),
      },
    }),
  } as never,
);
const blockedView = await blockedService.get(context, importId);
assert.equal(blockedView.validation.canConfirm, false);
assert.deepEqual(blockedView.validation.errorCodes, ["BUSINESS_IMPORT_MAPPING_SOURCE_BLOCKED"]);
await assert.rejects(
  blockedService.confirm(
    context,
    importId,
    request,
    blockedView.etag,
    "mapping-confirm-manifest-blocked",
  ),
  (error: unknown) => {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    return (
      error.getStatus() === 422 &&
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === "BUSINESS_IMPORT_MAPPING_INVALID" &&
      "details" in response &&
      JSON.stringify(response.details).includes("BUSINESS_IMPORT_MAPPING_SOURCE_BLOCKED")
    );
  },
);
assert.equal(mappingCreateCount, 1);
storedManifestHash = createHash("sha256").update(bytes).digest("hex");

for (const defaults of [
  { ...request.defaults, currency: "ZZZ" },
  { ...request.defaults, numberFormat: "INVALID" },
]) {
  await assert.rejects(
    service.confirm(
      context,
      importId,
      { ...request, defaults } as BusinessImportMappingConfirmRequest,
      view.etag,
      `mapping-confirm-invalid-default-${String(defaults.currency)}-${String(defaults.numberFormat)}`,
    ),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 422,
  );
}

await assert.rejects(
  service.confirm(
    context,
    importId,
    { ...request, columns: request.columns.slice(0, 1) },
    view.etag,
    "mapping-confirm-incomplete",
  ),
  (error: unknown) => {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    return (
      error.getStatus() === 422 &&
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === "BUSINESS_IMPORT_MAPPING_INVALID"
    );
  },
);

await assert.rejects(
  service.confirm(
    { ...context, role: "VIEWER" },
    importId,
    request,
    view.etag,
    "mapping-confirm-viewer",
  ),
  (error: unknown) => error instanceof HttpException && error.getStatus() === 403,
);

retainedDuringMutation = false;
await assert.rejects(
  service.confirm(context, importId, request, view.etag, "mapping-confirm-expired-artifact"),
  (error: unknown) => {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    return (
      error.getStatus() === 409 &&
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === "BUSINESS_IMPORT_MAPPING_MANIFEST_UNAVAILABLE"
    );
  },
);
retainedDuringMutation = true;

storedManifestHash = "0".repeat(64);
await assert.rejects(service.get(context, importId), (error: unknown) => {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  return (
    error.getStatus() === 409 &&
    typeof response === "object" &&
    response !== null &&
    "code" in response &&
    response.code === "BUSINESS_IMPORT_MAPPING_MANIFEST_UNAVAILABLE"
  );
});

process.stdout.write("business import mapping service smoke passed\n");
