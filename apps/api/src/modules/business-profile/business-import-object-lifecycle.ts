import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@leadvirt/db";
import {
  KnowledgeObjectStoreError,
  type KnowledgeObjectStore,
  type KnowledgeObjectWriteResult,
} from "@leadvirt/knowledge";
import type { PrismaService } from "../database/prisma.service.js";

export const BUSINESS_IMPORT_PENDING_RETENTION_PREFIX = "BUSINESS_IMPORT_PENDING";
export const BUSINESS_IMPORT_REPROCESS_RETENTION_MS = 30 * 24 * 60 * 60_000;

const DELETE_CLAIM_PREFIX = "BUSINESS_IMPORT_PENDING_DELETE_CLAIM";

export interface PendingBusinessImportObject {
  ledgerId: string;
  tenantId: string;
  objectKind:
    | "STAGING"
    | "RAW_ARTIFACT"
    | "PARSED_MANIFEST"
    | "EVIDENCE_EXCERPT"
    | "APPLICATION_PREVIEW"
    | "REVISION_DELTA";
  objectStorageKey: string;
  encryptionKeyRef: string;
  retentionClass: string;
  retainUntil: Date;
}

export interface RetainedBusinessImportObject {
  ledgerId: string;
  objectKind: "RAW_ARTIFACT" | "PARSED_MANIFEST";
  objectStorageKey: string;
  encryptionKeyRef: string;
  retentionClass: "BUSINESS_IMPORT_RAW" | "BUSINESS_IMPORT_PARSED_MANIFEST";
}

function exactHash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function ledgerId(input: { tenantId: string; objectStorageKey: string; encryptionKeyRef: string }) {
  return `biol_${createHash("sha256")
    .update(`${input.tenantId}\0${input.objectStorageKey}\0${input.encryptionKeyRef}`, "utf8")
    .digest("hex")}`;
}

export function pendingBusinessImportRetentionClass(scope: string) {
  const normalized = scope
    .trim()
    .replace(/[^A-Za-z0-9:._-]+/gu, "_")
    .slice(0, 300);
  if (!normalized) throw new Error("BUSINESS_IMPORT_PENDING_SCOPE_INVALID");
  return `${BUSINESS_IMPORT_PENDING_RETENTION_PREFIX}:${normalized}`;
}

export async function reservePendingBusinessImportObject(
  prisma: PrismaService,
  input: Omit<PendingBusinessImportObject, "ledgerId" | "retentionClass"> & {
    pendingScope: string;
  },
): Promise<PendingBusinessImportObject> {
  const reservation: PendingBusinessImportObject = {
    ledgerId: ledgerId(input),
    tenantId: input.tenantId,
    objectKind: input.objectKind,
    objectStorageKey: input.objectStorageKey,
    encryptionKeyRef: input.encryptionKeyRef,
    retentionClass: pendingBusinessImportRetentionClass(input.pendingScope),
    retainUntil: input.retainUntil,
  };
  await prisma.businessImportObjectLedger.createMany({
    data: [
      {
        id: reservation.ledgerId,
        tenantId: reservation.tenantId,
        objectKind: reservation.objectKind,
        objectStorageKey: reservation.objectStorageKey,
        encryptionKeyRef: reservation.encryptionKeyRef,
        retentionClass: reservation.retentionClass,
        retainUntil: reservation.retainUntil,
      },
    ],
    skipDuplicates: true,
  });
  const stored = await prisma.businessImportObjectLedger.findUnique({
    where: {
      tenantId_objectStorageKey: {
        tenantId: reservation.tenantId,
        objectStorageKey: reservation.objectStorageKey,
      },
    },
  });
  if (
    !stored ||
    stored.id !== reservation.ledgerId ||
    stored.objectKind !== reservation.objectKind ||
    stored.encryptionKeyRef !== reservation.encryptionKeyRef ||
    stored.retentionClass !== reservation.retentionClass ||
    stored.deletionState !== "RETAINED" ||
    stored.legalHold
  ) {
    throw new Error("BUSINESS_IMPORT_PENDING_OBJECT_IDENTITY_CONFLICT");
  }
  if (!stored.retainUntil || stored.retainUntil < reservation.retainUntil) {
    const extended = await prisma.businessImportObjectLedger.updateMany({
      where: {
        id: reservation.ledgerId,
        tenantId: reservation.tenantId,
        retentionClass: reservation.retentionClass,
        deletionState: "RETAINED",
        legalHold: false,
      },
      data: { retainUntil: reservation.retainUntil },
    });
    if (extended.count !== 1) {
      throw new Error("BUSINESS_IMPORT_PENDING_OBJECT_IDENTITY_CONFLICT");
    }
  }
  return reservation;
}

export async function putPendingBusinessImportObject(
  prisma: PrismaService,
  store: KnowledgeObjectStore,
  reservation: PendingBusinessImportObject,
  bytes: Uint8Array,
): Promise<KnowledgeObjectWriteResult> {
  try {
    try {
      const write = await store.put(reservation.objectStorageKey, bytes);
      if (
        write.key !== reservation.objectStorageKey ||
        write.encryptionKeyRef !== reservation.encryptionKeyRef
      ) {
        throw new Error("BUSINESS_IMPORT_PENDING_OBJECT_IDENTITY_CONFLICT");
      }
      return write;
    } catch (error) {
      if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_EXISTS") {
        throw error;
      }
      const existing = await store.get(reservation.objectStorageKey, reservation.encryptionKeyRef);
      if (exactHash(existing) !== exactHash(bytes)) {
        throw new Error("BUSINESS_IMPORT_PENDING_OBJECT_CONTENT_CONFLICT");
      }
      return {
        key: reservation.objectStorageKey,
        encryptionKeyRef: reservation.encryptionKeyRef,
        plaintextBytes: bytes.byteLength,
        storedBytes: 0,
      };
    }
  } catch (error) {
    await cleanupPendingBusinessImportObject(prisma, store, reservation).catch(() => undefined);
    throw error;
  }
}

export async function adoptPendingBusinessImportObject(
  tx: Prisma.TransactionClient,
  reservation: PendingBusinessImportObject,
  finalRetentionClass: string,
  retainUntil: Date | null,
) {
  const adopted = await tx.businessImportObjectLedger.updateMany({
    where: {
      id: reservation.ledgerId,
      tenantId: reservation.tenantId,
      objectKind: reservation.objectKind,
      objectStorageKey: reservation.objectStorageKey,
      encryptionKeyRef: reservation.encryptionKeyRef,
      retentionClass: reservation.retentionClass,
      deletionState: "RETAINED",
      legalHold: false,
    },
    data: {
      retentionClass: finalRetentionClass,
      retainUntil,
      lastErrorCode: null,
    },
  });
  if (adopted.count !== 1) {
    throw new Error("BUSINESS_IMPORT_PENDING_OBJECT_ADOPTION_CONFLICT");
  }
}

export async function lockAndExtendRetainedBusinessImportObjects(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    objects: readonly RetainedBusinessImportObject[];
    now: Date;
  },
) {
  const ordered = [...input.objects].sort((left, right) =>
    left.ledgerId.localeCompare(right.ledgerId),
  );
  const ids = ordered.map((object) => object.ledgerId);
  if (!ids.length || new Set(ids).size !== ids.length) return false;

  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "BusinessImportObjectLedger"
    WHERE "tenantId" = ${input.tenantId}
      AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
  const rows = await tx.businessImportObjectLedger.findMany({
    where: { tenantId: input.tenantId, id: { in: ids } },
  });
  if (rows.length !== ordered.length) return false;

  const byId = new Map(rows.map((row) => [row.id, row]));
  const extendTo = new Date(input.now.getTime() + BUSINESS_IMPORT_REPROCESS_RETENTION_MS);
  for (const expected of ordered) {
    const row = byId.get(expected.ledgerId);
    if (
      !row ||
      row.objectKind !== expected.objectKind ||
      row.objectStorageKey !== expected.objectStorageKey ||
      row.encryptionKeyRef !== expected.encryptionKeyRef ||
      row.retentionClass !== expected.retentionClass ||
      row.deletionState !== "RETAINED" ||
      (row.retainUntil !== null && row.retainUntil <= input.now)
    ) {
      return false;
    }
    if (row.retainUntil !== null && row.retainUntil < extendTo) {
      const extended = await tx.businessImportObjectLedger.updateMany({
        where: {
          id: row.id,
          tenantId: input.tenantId,
          objectKind: expected.objectKind,
          objectStorageKey: expected.objectStorageKey,
          encryptionKeyRef: expected.encryptionKeyRef,
          retentionClass: expected.retentionClass,
          deletionState: "RETAINED",
          retainUntil: row.retainUntil,
        },
        data: { retainUntil: extendTo },
      });
      if (extended.count !== 1) return false;
    }
  }
  return true;
}

export async function cleanupPendingBusinessImportObject(
  prisma: PrismaService,
  store: KnowledgeObjectStore,
  reservation: PendingBusinessImportObject,
) {
  const claimToken = `${DELETE_CLAIM_PREFIX}:${randomUUID()}`;
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImportObjectLedger"
      WHERE "tenantId" = ${reservation.tenantId}
        AND "id" = ${reservation.ledgerId}
      FOR UPDATE
    `);
    const row = await tx.businessImportObjectLedger.findUnique({
      where: { id: reservation.ledgerId },
    });
    if (
      !row ||
      row.tenantId !== reservation.tenantId ||
      row.objectKind !== reservation.objectKind ||
      row.objectStorageKey !== reservation.objectStorageKey ||
      row.encryptionKeyRef !== reservation.encryptionKeyRef ||
      row.retentionClass !== reservation.retentionClass ||
      row.legalHold ||
      !["RETAINED", "TOMBSTONED", "FAILED"].includes(row.deletionState)
    ) {
      return false;
    }
    const now = new Date();
    if (row.deletionState === "RETAINED") {
      const tombstoned = await tx.businessImportObjectLedger.updateMany({
        where: {
          id: row.id,
          retentionClass: reservation.retentionClass,
          deletionState: "RETAINED",
          legalHold: false,
        },
        data: {
          deletionState: "TOMBSTONED",
          tombstoneReason: "BUSINESS_IMPORT_PENDING_WRITE_ABORTED",
          tombstonedAt: now,
        },
      });
      if (tombstoned.count !== 1) return false;
    }
    const deleting = await tx.businessImportObjectLedger.updateMany({
      where: {
        id: row.id,
        retentionClass: reservation.retentionClass,
        deletionState: row.deletionState === "FAILED" ? "FAILED" : "TOMBSTONED",
        legalHold: false,
      },
      data: {
        deletionState: "DELETING",
        ...(row.deletionState === "FAILED" ? {} : { deletionStartedAt: now }),
        lastErrorCode: claimToken,
      },
    });
    return deleting.count === 1;
  });
  if (!claimed) return false;
  try {
    await store.delete(reservation.objectStorageKey);
    const deletedAt = new Date();
    const deleted = await prisma.businessImportObjectLedger.updateMany({
      where: {
        id: reservation.ledgerId,
        tenantId: reservation.tenantId,
        retentionClass: reservation.retentionClass,
        deletionState: "DELETING",
        lastErrorCode: claimToken,
      },
      data: { deletionState: "DELETED", deletedAt, lastErrorCode: null },
    });
    return deleted.count === 1;
  } catch {
    await prisma.businessImportObjectLedger.updateMany({
      where: {
        id: reservation.ledgerId,
        tenantId: reservation.tenantId,
        retentionClass: reservation.retentionClass,
        deletionState: "DELETING",
        lastErrorCode: claimToken,
      },
      data: {
        deletionState: "FAILED",
        lastErrorCode: "BUSINESS_IMPORT_PENDING_OBJECT_DELETE_FAILED",
      },
    });
    return false;
  }
}
