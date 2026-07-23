import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { businessImportEvidenceRecordHash } from "@leadvirt/business-import";
import { KnowledgeObjectStoreError } from "@leadvirt/knowledge";
import { BusinessImportViewService } from "./business-import-view.service.js";

type EvidenceResult =
  | { availability: "AVAILABLE"; sourceValue: string }
  | { availability: "EXPIRED" | "UNAVAILABLE" | "CORRUPT"; sourceValue: null };

const values = new Map<string, Uint8Array>();
const runtime = {
  runtime: () => ({
    store: {
      get: (key: string) => {
        if (key === "store-corrupt") {
          return Promise.reject(new KnowledgeObjectStoreError("OBJECT_CORRUPT"));
        }
        const value = values.get(key);
        return value ? Promise.resolve(value) : Promise.reject(new Error("missing"));
      },
    },
  }),
};
const service = new BusinessImportViewService({} as never, runtime as never);
const read = (item: unknown) =>
  (service as unknown as { evidenceValue(value: unknown): Promise<EvidenceResult> }).evidenceValue(
    item,
  );
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const future = new Date("2100-01-01T00:00:00.000Z");

function evidence(
  key: string,
  excerptHash: string,
  deletionState = "RETAINED",
  retainUntil: Date | null = future,
) {
  const record = {
    id: `evidence-${key}`,
    tenantId: "tenant",
    sourceId: "source",
    importId: "import",
    candidateId: "candidate",
    candidateVersion: 1,
    candidateValueHash: "a".repeat(64),
    artifactId: "artifact",
    artifactSha256: "b".repeat(64),
    importGeneration: 1,
    parsedRevisionId: "parsed",
    parsedManifestHash: "c".repeat(64),
    semanticElementId: null,
    semanticTableId: null,
    locator: { row: 1 },
    sourceValueHash: excerptHash,
    excerptHash,
    excerptObjectKey: key,
    excerptEncryptionKeyRef: "test-key",
    excerptObjectLedgerId: "ledger",
    excerptObjectKind: "EVIDENCE_EXCERPT",
    parserVersion: "parser-v1",
    ocrVersion: null,
    extractionContractVersion: "contract-v1",
  };
  return {
    ...record,
    evidenceRecordHash: businessImportEvidenceRecordHash(record),
    excerptObjectLedger: { deletionState, retainUntil },
  };
}

const blank = new Uint8Array();
values.set("blank", blank);
assert.deepEqual(await read(evidence("blank", hash(blank))), {
  availability: "AVAILABLE",
  sourceValue: "",
});

assert.deepEqual(
  await read(evidence("expired", hash(blank), "RETAINED", new Date("2000-01-01T00:00:00.000Z"))),
  { availability: "EXPIRED", sourceValue: null },
);
assert.deepEqual(await read(evidence("removed", hash(blank), "TOMBSTONED")), {
  availability: "UNAVAILABLE",
  sourceValue: null,
});
assert.deepEqual(await read(evidence("missing", hash(blank))), {
  availability: "UNAVAILABLE",
  sourceValue: null,
});
assert.deepEqual(await read(evidence("store-corrupt", hash(blank))), {
  availability: "CORRUPT",
  sourceValue: null,
});
assert.deepEqual(
  await read({ ...evidence("invalid-record", hash(blank)), evidenceRecordHash: "0".repeat(64) }),
  { availability: "CORRUPT", sourceValue: null },
);

const changed = new TextEncoder().encode("changed");
values.set("hash-invalid", changed);
assert.deepEqual(await read(evidence("hash-invalid", hash(new TextEncoder().encode("original")))), {
  availability: "CORRUPT",
  sourceValue: null,
});

const invalidUtf8 = Uint8Array.from([0xc3, 0x28]);
values.set("invalid-utf8", invalidUtf8);
assert.deepEqual(await read(evidence("invalid-utf8", hash(invalidUtf8))), {
  availability: "CORRUPT",
  sourceValue: null,
});

const sourceQueries: Array<Record<string, unknown>> = [];
const importedAt = new Date("2026-07-23T12:00:00.000Z");
const importRow = (id: string, sourceId: string, sourceName: string, filename: string) => ({
  id,
  tenantId: "tenant-catalog",
  sourceId,
  format: "CSV",
  state: "APPLIED",
  generation: 2,
  etag: 3,
  originalFilename: filename,
  schemaVersion: "services-v1",
  baseInformationRevision: 1,
  safeSummary: {
    counts: {
      total: 30,
      valid: 30,
      invalid: 0,
      additions: 30,
      updates: 0,
      linked: 0,
      unchanged: 0,
      conflicts: 0,
      pendingApproval: 0,
      applied: 30,
    },
    diagnostics: [],
  },
  retryable: false,
  failureCode: null,
  createdAt: importedAt,
  updatedAt: importedAt,
  reviewReadyAt: importedAt,
  appliedAt: importedAt,
  source: { displayName: sourceName },
  applications: [
    {
      resultingInformationRevision: 2,
      projectionReceipt: { knowledgeDraftGeneration: 4 },
    },
  ],
});
const sourceRows = [
  {
    id: "catalog-a",
    tenantId: "tenant-catalog",
    displayName: "Teplodom services",
    status: "ACTIVE",
    createdAt: importedAt,
    updatedAt: new Date("2026-07-23T12:03:00.000Z"),
    latestImport: importRow(
      "import-a-v2",
      "catalog-a",
      "Teplodom services",
      "teplodom_services.csv",
    ),
  },
  {
    id: "catalog-b",
    tenantId: "tenant-catalog",
    displayName: "Installation",
    status: "ACTIVE",
    createdAt: importedAt,
    updatedAt: new Date("2026-07-23T12:02:00.000Z"),
    latestImport: importRow("import-b-v1", "catalog-b", "Installation", "installation.csv"),
  },
  {
    id: "catalog-c",
    tenantId: "tenant-catalog",
    displayName: "Archived list",
    status: "ARCHIVED",
    createdAt: importedAt,
    updatedAt: new Date("2026-07-23T12:01:00.000Z"),
    latestImport: null,
  },
];
const sourceService = new BusinessImportViewService(
  {
    businessImportSource: {
      findMany: (query: Record<string, unknown>) => {
        sourceQueries.push(query);
        return Promise.resolve(sourceRows);
      },
    },
  } as never,
  runtime as never,
);
const sourceContext = {
  tenantId: "tenant-catalog",
  userId: "owner",
  role: "OWNER",
  authMode: "email",
  tenant: {
    id: "tenant-catalog",
    name: "Catalog tenant",
    slug: "catalog",
    status: "ACTIVE",
    businessType: null,
    timezone: "UTC",
  },
  user: {
    id: "owner",
    email: "owner@example.com",
    phone: null,
    name: "Owner",
    avatarUrl: null,
    passwordChangeRequired: false,
  },
} as const;
const catalogPage = await sourceService.listSources(sourceContext, {
  limit: 2,
  query: "teplodom_services.csv",
});
assert.deepEqual(
  catalogPage.items.map((item) => [item.id, item.latestImport?.id, item.latestImport?.sourceId]),
  [
    ["catalog-a", "import-a-v2", "catalog-a"],
    ["catalog-b", "import-b-v1", "catalog-b"],
  ],
);
assert.equal(catalogPage.items[0]?.latestImport?.counts.total, 30);
assert.ok(catalogPage.nextCursor);
const firstSourceQuery = sourceQueries[0] as {
  where: {
    tenantId: string;
    OR: Array<Record<string, unknown>>;
  };
  take: number;
};
assert.equal(firstSourceQuery.where.tenantId, "tenant-catalog");
assert.equal(firstSourceQuery.where.OR.length, 2);
assert.equal(firstSourceQuery.take, 3);

await sourceService.listSources(sourceContext, {
  limit: 2,
  cursor: catalogPage.nextCursor ?? undefined,
});
const cursorSourceQuery = sourceQueries[1] as {
  where: { tenantId: string; AND: { OR: Array<Record<string, unknown>> } };
};
assert.equal(cursorSourceQuery.where.tenantId, "tenant-catalog");
assert.equal(cursorSourceQuery.where.AND.OR.length, 2);

process.stdout.write("business import view smoke passed\n");
