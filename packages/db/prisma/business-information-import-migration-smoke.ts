import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required for the migration smoke.");

const databaseName = `leadvirt_business_import_${process.pid}_${randomBytes(4).toString("hex")}`;
const maintenanceUrl = new URL(sourceDatabaseUrl);
maintenanceUrl.pathname = "/postgres";
maintenanceUrl.searchParams.set("schema", "public");
const smokeUrl = new URL(sourceDatabaseUrl);
smokeUrl.pathname = `/${databaseName}`;
smokeUrl.searchParams.set("schema", "public");
const currentAttributionIndex = "BusinessInformationAttribution_current_field_key";
const evidenceLedgerIndex = "BusinessImportEvidence_excerpt_ledger_idx";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function command(args: string[], env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["corepack", ...args].join(" ")] : args;
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, commandArgs, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (status) => resolveCommand({ status, stdout, stderr }));
  });
}

function output(result: CommandResult) {
  return `${result.stdout}\n${result.stderr}`;
}

function migrate() {
  return command(["pnpm", "--filter", "@leadvirt/db", "db:migrate"], {
    DATABASE_URL: smokeUrl.toString(),
  });
}

async function verifyIntegrityContracts(database: PrismaClient) {
  await database.$executeRawUnsafe(`
    DO $integrity$
    DECLARE
      approval_time TIMESTAMP(3) := TIMESTAMP '2026-07-21 12:00:00';
      manual_time TIMESTAMP(3) := TIMESTAMP '2026-07-21 13:00:00';
      imported_provenance JSONB := '{
        "/active":{"authority":"SYSTEM"},"/archivedAt":{"authority":"SYSTEM"},
        "/bookingNotes":{"authority":"SYSTEM"},"/category":{"authority":"SYSTEM"},
        "/description":{"authority":"SYSTEM"},"/duration/maximumMinutes":{"authority":"SYSTEM"},
        "/duration/minimumMinutes":{"authority":"SYSTEM"},"/externalId":{"authority":"SYSTEM"},
        "/kind":{"authority":"SYSTEM"},"/language":{"authority":"SYSTEM"},
        "/locationExternalId":{"authority":"SYSTEM"},
        "/name":{"authority":"IMPORTED","evidenceId":"integrity-evidence"},
        "/price/amount":{"authority":"SYSTEM"},"/price/currency":{"authority":"SYSTEM"},
        "/price/from":{"authority":"SYSTEM"},"/price/taxNote":{"authority":"SYSTEM"},
        "/price/to":{"authority":"SYSTEM"},"/price/type":{"authority":"SYSTEM"},
        "/price/unit":{"authority":"SYSTEM"},"/validFrom":{"authority":"SYSTEM"},
        "/validUntil":{"authority":"SYSTEM"}
      }'::jsonb;
      edited_provenance JSONB := '{
        "/active":{"authority":"SYSTEM"},"/archivedAt":{"authority":"SYSTEM"},
        "/bookingNotes":{"authority":"SYSTEM"},"/category":{"authority":"SYSTEM"},
        "/description":{"authority":"SYSTEM"},"/duration/maximumMinutes":{"authority":"SYSTEM"},
        "/duration/minimumMinutes":{"authority":"SYSTEM"},"/externalId":{"authority":"SYSTEM"},
        "/kind":{"authority":"SYSTEM"},"/language":{"authority":"SYSTEM"},
        "/locationExternalId":{"authority":"SYSTEM"},"/name":{"authority":"MANUAL"},
        "/price/amount":{"authority":"SYSTEM"},"/price/currency":{"authority":"SYSTEM"},
        "/price/from":{"authority":"SYSTEM"},"/price/taxNote":{"authority":"SYSTEM"},
        "/price/to":{"authority":"SYSTEM"},"/price/type":{"authority":"SYSTEM"},
        "/price/unit":{"authority":"SYSTEM"},"/validFrom":{"authority":"SYSTEM"},
        "/validUntil":{"authority":"SYSTEM"}
      }'::jsonb;
    BEGIN
      INSERT INTO "Tenant" ("id", "name", "slug", "status", "timezone", "createdAt", "updatedAt")
      VALUES ('integrity-tenant', 'Integrity tenant', 'integrity-tenant', 'ACTIVE', 'UTC', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT INTO "User" ("id", "email", "createdAt", "updatedAt")
      VALUES ('integrity-user', 'integrity@example.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT INTO "Membership" ("id", "tenantId", "userId", "role", "createdAt", "updatedAt")
      VALUES ('integrity-membership', 'integrity-tenant', 'integrity-user', 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT INTO "BusinessInformationState" (
        "tenantId", "revision", "canonicalHash", "etag", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-tenant', 0, repeat('0', 64), 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImportObjectLedger" (
        "id", "tenantId", "objectKind", "objectStorageKey", "encryptionKeyRef",
        "retentionClass", "createdAt", "updatedAt"
      ) VALUES
        ('ledger-staging', 'integrity-tenant', 'STAGING', 'integrity/staging', 'key-v1', 'import', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-raw', 'integrity-tenant', 'RAW_ARTIFACT', 'integrity/raw', 'key-v1', 'import', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-manifest', 'integrity-tenant', 'PARSED_MANIFEST', 'integrity/manifest', 'key-v1', 'import', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-evidence', 'integrity-tenant', 'EVIDENCE_EXCERPT', 'integrity/evidence', 'key-v1', 'import', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-preview', 'integrity-tenant', 'APPLICATION_PREVIEW', 'integrity/preview', 'key-v1', 'import', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-delta', 'integrity-tenant', 'REVISION_DELTA', 'integrity/delta', 'key-v1', 'business-information', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-manual-delta', 'integrity-tenant', 'REVISION_DELTA', 'integrity/manual-delta', 'key-v1', 'business-information', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ledger-lifecycle', 'integrity-tenant', 'RAW_ARTIFACT', 'integrity/lifecycle', 'key-v1', 'import', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT INTO "BusinessImportSource" (
        "id", "tenantId", "lineageKey", "displayName", "createdByUserId", "etag", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-source', 'integrity-tenant', 'integrity-source', 'Integrity source',
        'integrity-user', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImportArtifact" (
        "id", "tenantId", "sourceId", "objectStorageKey", "encryptionKeyRef", "objectLedgerId",
        "objectKind", "sha256", "byteSize", "declaredMimeType", "originalFilename", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-artifact', 'integrity-tenant', 'integrity-source', 'integrity/raw', 'key-v1', 'ledger-raw',
        'RAW_ARTIFACT', repeat('a', 64), 128, 'text/csv', 'services.csv', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImport" (
        "id", "tenantId", "sourceId", "purpose", "format", "state", "generation", "etag",
        "displayName", "originalFilename", "declaredMimeType", "expectedByteSize", "uploadTokenHash",
        "stagingObjectKey", "stagingEncryptionKeyRef", "stagingObjectLedgerId", "stagingObjectKind",
        "artifactId", "artifactSha256", "baseInformationRevision", "baseInformationHash",
        "selectedCategories", "schemaVersion", "expiresAt", "createdByUserId", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-import', 'integrity-tenant', 'integrity-source', 'SERVICES', 'CSV', 'PARSING', 1, 1,
        'Integrity import', 'services.csv', 'text/csv', 128, 'integrity-upload-token',
        'integrity/staging', 'key-v1', 'ledger-staging', 'STAGING',
        'integrity-artifact', repeat('a', 64), 0, repeat('0', 64),
        '["OFFERINGS"]'::jsonb, '1', CURRENT_TIMESTAMP + INTERVAL '1 day', 'integrity-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        INSERT INTO "BusinessImportParsedRevision" (
          "id", "tenantId", "sourceId", "importId", "importGeneration", "artifactId", "artifactSha256",
          "manifestObjectLedgerId", "manifestObjectKind", "manifestObjectKey", "manifestEncryptionKeyRef",
          "manifestHash", "parserVersion", "mapperVersion", "schemaVersion", "extractionContractVersion", "createdAt"
        ) VALUES (
          'stale-parsed', 'integrity-tenant', 'integrity-source', 'integrity-import', 2,
          'integrity-artifact', repeat('a', 64), 'ledger-manifest', 'PARSED_MANIFEST',
          'integrity/manifest', 'key-v1', repeat('b', 64), 'parser-v1', 'mapper-v1', '1', 'extract-v1', CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'stale parsed revision unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%generation is stale%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessImportParsedRevision" (
        "id", "tenantId", "sourceId", "importId", "importGeneration", "artifactId", "artifactSha256",
        "manifestObjectLedgerId", "manifestObjectKind", "manifestObjectKey", "manifestEncryptionKeyRef",
        "manifestHash", "parserVersion", "mapperVersion", "schemaVersion", "extractionContractVersion", "createdAt"
      ) VALUES (
        'integrity-parsed', 'integrity-tenant', 'integrity-source', 'integrity-import', 1,
        'integrity-artifact', repeat('a', 64), 'ledger-manifest', 'PARSED_MANIFEST',
        'integrity/manifest', 'key-v1', repeat('b', 64), 'parser-v1', 'mapper-v1', '1', 'extract-v1', CURRENT_TIMESTAMP
      );

      UPDATE "BusinessImport"
      SET
        "parsedRevisionId" = 'integrity-parsed',
        "parsedManifestObjectKey" = 'integrity/manifest',
        "parsedManifestEncryptionKeyRef" = 'key-v1',
        "parsedManifestObjectLedgerId" = 'ledger-manifest',
        "parsedManifestObjectKind" = 'PARSED_MANIFEST',
        "parsedManifestHash" = repeat('b', 64),
        "parserVersion" = 'parser-v1',
        "mapperVersion" = 'mapper-v1',
        "parsedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'integrity-import';

      BEGIN
        UPDATE "BusinessImportParsedRevision" SET "parserVersion" = 'parser-v2' WHERE "id" = 'integrity-parsed';
        RAISE EXCEPTION 'parsed revision unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessImportMapping" (
        "id", "tenantId", "sourceId", "importId", "tableKey", "schemaHash", "targetCategory",
        "fieldMappings", "revision", "etag", "confirmedByUserId", "confirmedAt", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-mapping-1', 'integrity-tenant', 'integrity-source', 'integrity-import', 'services',
        repeat('c', 64), 'OFFERINGS', '{}'::jsonb, 1, 1, 'integrity-user', approval_time,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        INSERT INTO "BusinessImportMapping" (
          "id", "tenantId", "sourceId", "importId", "tableKey", "schemaHash", "targetCategory",
          "fieldMappings", "revision", "etag", "supersedesMappingId", "supersedesRevision", "createdAt", "updatedAt"
        ) VALUES (
          'wrong-lineage', 'integrity-tenant', 'integrity-source', 'integrity-import', 'other-table',
          repeat('c', 64), 'OFFERINGS', '{}'::jsonb, 2, 1, 'integrity-mapping-1', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'cross-lineage mapping unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;

      INSERT INTO "BusinessImportMapping" (
        "id", "tenantId", "sourceId", "importId", "tableKey", "schemaHash", "targetCategory",
        "fieldMappings", "revision", "etag", "supersedesMappingId", "supersedesRevision", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-mapping-2', 'integrity-tenant', 'integrity-source', 'integrity-import', 'services',
        repeat('c', 64), 'OFFERINGS', '{}'::jsonb, 2, 1, 'integrity-mapping-1', 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessImportMapping" SET "tableKey" = 'mutated' WHERE "id" = 'integrity-mapping-2';
        RAISE EXCEPTION 'mapping lineage unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%lineage is immutable%' THEN RAISE; END IF;
      END;

      UPDATE "BusinessImportMapping"
      SET "confirmedByUserId" = 'integrity-user', "confirmedAt" = approval_time
      WHERE "id" = 'integrity-mapping-2';

      BEGIN
        UPDATE "BusinessImportMapping"
        SET "fieldMappings" = '{"service_name":"name"}'::jsonb
        WHERE "id" = 'integrity-mapping-2';
        RAISE EXCEPTION 'confirmed mapping content unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%confirmed mapping is immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        UPDATE "BusinessImportMapping"
        SET "confirmedAt" = approval_time + INTERVAL '1 second'
        WHERE "id" = 'integrity-mapping-2';
        RAISE EXCEPTION 'mapping confirmation metadata unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%confirmed mapping is immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        DELETE FROM "BusinessImportMapping" WHERE "id" = 'integrity-mapping-2';
        RAISE EXCEPTION 'confirmed mapping unexpectedly deleted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%confirmed mapping is immutable%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessImportCandidate" (
        "id", "tenantId", "sourceId", "importId", "mappingId", "candidateKey", "targetCategory",
        "semanticTargetKey", "action", "normalizedValue", "normalizedValueHash", "risk", "confidence",
        "requiresApproval", "requiredPermission", "version", "etag", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-candidate', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-mapping-2',
        'service:consulting', 'OFFERINGS', 'offering:consulting', 'ADD', '{"name":"Consulting"}'::jsonb,
        repeat('d', 64), 'HIGH', 'HIGH', true, 'business_information.write_sensitive', 1, 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImportCandidateRevision" (
        "id", "tenantId", "sourceId", "importId", "candidateId", "version", "parsedRevisionId",
        "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash", "mappingId",
        "targetCategory", "semanticTargetKey", "action", "normalizedValue", "normalizedValueHash",
        "fieldProvenance", "risk", "confidence", "requiresApproval", "requiredPermission", "createdAt"
      ) VALUES (
        'integrity-candidate-revision', 'integrity-tenant', 'integrity-source', 'integrity-import',
        'integrity-candidate', 1, 'integrity-parsed', 1, 'integrity-artifact', repeat('a', 64),
        repeat('b', 64), 'integrity-mapping-2', 'OFFERINGS', 'offering:consulting', 'ADD',
        '{"name":"Consulting"}'::jsonb, repeat('d', 64), imported_provenance, 'HIGH', 'HIGH', true,
        'business_information.write_sensitive', CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImportCandidateEvidence" (
        "id", "tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash",
        "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash",
        "evidenceRecordHash", "locator", "sourceValueHash", "excerptHash", "excerptObjectKey", "excerptEncryptionKeyRef",
        "excerptObjectLedgerId", "excerptObjectKind", "parserVersion", "extractionContractVersion", "createdAt"
      ) VALUES (
        'integrity-evidence', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-candidate',
        1, repeat('d', 64), 'integrity-artifact', repeat('a', 64), 1, 'integrity-parsed', repeat('b', 64),
        repeat('8', 64), '{"row":2}'::jsonb, repeat('e', 64), repeat('f', 64), 'integrity/evidence', 'key-v1',
        'ledger-evidence', 'EVIDENCE_EXCERPT', 'parser-v1', 'extract-v1', CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImportCandidateRevision" (
        "id", "tenantId", "sourceId", "importId", "candidateId", "version", "parsedRevisionId",
        "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash", "mappingId",
        "targetCategory", "semanticTargetKey", "action", "normalizedValue", "normalizedValueHash",
        "fieldProvenance", "risk", "confidence", "requiresApproval", "requiredPermission", "createdAt"
      ) VALUES (
        'integrity-candidate-revision-2', 'integrity-tenant', 'integrity-source', 'integrity-import',
        'integrity-candidate', 2, 'integrity-parsed', 1, 'integrity-artifact', repeat('a', 64),
        repeat('b', 64), 'integrity-mapping-2', 'OFFERINGS', 'offering:consulting', 'ADD',
        '{"name":"Consulting updated"}'::jsonb, repeat('2', 64), edited_provenance, 'HIGH', 'HIGH', true,
        'business_information.write_sensitive', CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessImportCandidateEvidence" (
        "id", "tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash",
        "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash",
        "evidenceRecordHash", "locator", "sourceValueHash", "excerptHash", "excerptObjectKey", "excerptEncryptionKeyRef",
        "excerptObjectLedgerId", "excerptObjectKind", "parserVersion", "extractionContractVersion", "createdAt"
      ) VALUES (
        'integrity-evidence-reused', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-candidate',
        2, repeat('2', 64), 'integrity-artifact', repeat('a', 64), 1, 'integrity-parsed', repeat('b', 64),
        repeat('9', 64), '{"row":2}'::jsonb, repeat('e', 64), repeat('f', 64), 'integrity/evidence', 'key-v1',
        'ledger-evidence', 'EVIDENCE_EXCERPT', 'parser-v1', 'extract-v1', CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessImportCandidateEvidence" SET "locator" = '{"row":3}'::jsonb
        WHERE "id" = 'integrity-evidence';
        RAISE EXCEPTION 'candidate evidence unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        DELETE FROM "BusinessImportCandidateEvidence" WHERE "id" = 'integrity-evidence-reused';
        RAISE EXCEPTION 'candidate evidence unexpectedly deleted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        INSERT INTO "BusinessImportCandidateEvidence" (
          "id", "tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash",
          "artifactId", "artifactSha256", "importGeneration", "parsedRevisionId", "parsedManifestHash",
          "evidenceRecordHash", "locator", "sourceValueHash", "excerptHash", "excerptObjectKey",
          "excerptEncryptionKeyRef", "excerptObjectLedgerId", "excerptObjectKind", "parserVersion",
          "extractionContractVersion", "createdAt"
        ) VALUES (
          'invalid-evidence-hash', 'integrity-tenant', 'integrity-source', 'integrity-import',
          'integrity-candidate', 2, repeat('2', 64), 'integrity-artifact', repeat('a', 64), 1,
          'integrity-parsed', repeat('b', 64), 'invalid', '{"row":2}'::jsonb, repeat('e', 64),
          repeat('f', 64), 'integrity/evidence', 'key-v1', 'ledger-evidence', 'EVIDENCE_EXCERPT',
          'parser-v1', 'extract-v1', CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'invalid evidence record hash unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;

      INSERT INTO "BusinessImportCandidateApproval" (
        "id", "tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash",
        "requiresApproval", "requiredPermission", "riskReason", "state", "requestedByUserId", "etag",
        "createdAt", "updatedAt"
      ) VALUES (
        'integrity-approval', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-candidate',
        1, repeat('d', 64), true, 'business_information.write_sensitive', 'Sensitive update', 'PENDING',
        'integrity-user', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        INSERT INTO "BusinessImportApprovalGrant" (
          "id", "tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash",
          "requiredPermission", "approvalId", "grantedByUserId", "grantedAt", "decisionHash", "createdAt"
        ) VALUES (
          'pending-grant', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-candidate',
          1, repeat('d', 64), 'business_information.write_sensitive', 'integrity-approval',
          'integrity-user', approval_time, repeat('1', 64), CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'pending approval unexpectedly granted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%exact approved decision%' THEN RAISE; END IF;
      END;

      UPDATE "BusinessImportCandidateApproval"
      SET "state" = 'APPROVED', "decidedByUserId" = 'integrity-user', "decidedAt" = approval_time,
          "decisionReason" = 'Approved', "etag" = 2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'integrity-approval';

      INSERT INTO "BusinessImportApprovalGrant" (
        "id", "tenantId", "sourceId", "importId", "candidateId", "candidateVersion", "candidateValueHash",
        "requiredPermission", "approvalId", "grantedByUserId", "grantedAt", "decisionHash", "createdAt"
      ) VALUES (
        'integrity-grant', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-candidate',
        1, repeat('d', 64), 'business_information.write_sensitive', 'integrity-approval',
        'integrity-user', approval_time, repeat('1', 64), CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessImportCandidateRevision" SET "fieldProvenance" = edited_provenance
        WHERE "id" = 'integrity-candidate-revision';
        RAISE EXCEPTION 'candidate revision unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        INSERT INTO "BusinessImportCandidateRevision" (
          "id", "tenantId", "sourceId", "importId", "candidateId", "version", "parsedRevisionId",
          "importGeneration", "artifactId", "artifactSha256", "parsedManifestHash", "mappingId",
          "targetCategory", "semanticTargetKey", "action", "normalizedValue", "normalizedValueHash",
          "fieldProvenance", "risk", "confidence", "requiresApproval", "requiredPermission", "createdAt"
        ) VALUES (
          'invalid-field-provenance', 'integrity-tenant', 'integrity-source', 'integrity-import',
          'integrity-candidate', 3, 'integrity-parsed', 1, 'integrity-artifact', repeat('a', 64),
          repeat('b', 64), 'integrity-mapping-2', 'OFFERINGS', 'offering:consulting', 'ADD',
          '{"name":"Invalid"}'::jsonb, repeat('6', 64), '{}'::jsonb, 'LOW', 'HIGH', false, '',
          CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'invalid field provenance unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;

      BEGIN
        UPDATE "BusinessImportApprovalGrant" SET "decisionHash" = repeat('2', 64)
        WHERE "id" = 'integrity-grant';
        RAISE EXCEPTION 'approval grant unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessInformationRevision" (
        "id", "tenantId", "revision", "canonicalHash", "origin", "deltaObjectKey",
        "deltaEncryptionKeyRef", "deltaObjectLedgerId", "deltaObjectKind", "deltaHash",
        "affectedResources", "createdByUserId", "createdAt"
      ) VALUES (
        'integrity-business-revision', 'integrity-tenant', 1, repeat('3', 64), 'IMPORT',
        'integrity/delta', 'key-v1', 'ledger-delta', 'REVISION_DELTA', repeat('4', 64),
        '["business-identity"]'::jsonb, 'integrity-user', CURRENT_TIMESTAMP
      );

      INSERT INTO "BusinessIdentity" (
        "id", "tenantId", "displayName", "defaultLocale", "timezone", "defaultCurrency",
        "rowVersion", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-identity', 'integrity-tenant', 'Integrity Business', 'en', 'UTC', 'USD',
        1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessInformationState"
        SET "revision" = 1, "currentRevisionId" = 'integrity-business-revision',
            "canonicalHash" = repeat('9', 64), "etag" = 2, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "tenantId" = 'integrity-tenant';
        RAISE EXCEPTION 'mismatched current revision tuple unexpectedly accepted';
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;

      UPDATE "BusinessInformationState"
      SET "revision" = 1, "currentRevisionId" = 'integrity-business-revision',
          "canonicalHash" = repeat('3', 64), "etag" = 2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tenantId" = 'integrity-tenant';

      INSERT INTO "RuntimeOutbox" (
        "id", "tenantId", "aggregateType", "aggregateId", "aggregateVersion", "eventType",
        "dedupeKey", "payload", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-outbox', 'integrity-tenant', 'BusinessInformationRevision', 'integrity-business-revision',
        1, 'business.import.project.requested', 'integrity-projection', '{}'::jsonb,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        INSERT INTO "BusinessImportApplication" (
          "id", "tenantId", "sourceId", "importId", "kind", "state", "previewManifestHash",
          "previewObjectLedgerId", "previewObjectKind", "previewObjectKey", "previewEncryptionKeyRef",
          "candidateManifestHash", "idempotencyKeyHash", "idempotencyRequestHash",
          "baseInformationRevision", "baseInformationHash",
          "resultingInformationRevision", "resultingInformationHash", "businessRevisionId",
          "affectedResourceVersions", "projectionOutboxDedupeKey", "createdByUserId", "createdAt", "updatedAt"
        ) VALUES (
          'missing-outbox-application', 'integrity-tenant', 'integrity-source', 'integrity-import', 'APPLY', 'COMMITTED',
          repeat('5', 64), 'ledger-preview', 'APPLICATION_PREVIEW', 'integrity/preview', 'key-v1',
          repeat('6', 64), repeat('7', 64), repeat('8', 64), 0, repeat('0', 64), 1, repeat('3', 64),
          'integrity-business-revision', '{}'::jsonb, 'integrity-projection', 'integrity-user',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'application without outbox unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%outbox identity is required%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessImportApplication" (
        "id", "tenantId", "sourceId", "importId", "kind", "state", "previewManifestHash",
        "previewObjectLedgerId", "previewObjectKind", "previewObjectKey", "previewEncryptionKeyRef",
        "candidateManifestHash", "idempotencyKeyHash", "idempotencyRequestHash",
        "baseInformationRevision", "baseInformationHash",
        "resultingInformationRevision", "resultingInformationHash", "businessRevisionId",
        "affectedResourceVersions", "projectionOutboxDedupeKey", "projectionOutboxId",
        "createdByUserId", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-application', 'integrity-tenant', 'integrity-source', 'integrity-import', 'APPLY', 'COMMITTED',
        repeat('5', 64), 'ledger-preview', 'APPLICATION_PREVIEW', 'integrity/preview', 'key-v1',
        repeat('6', 64), repeat('7', 64), repeat('8', 64), 0, repeat('0', 64), 1, repeat('3', 64),
        'integrity-business-revision', '{}'::jsonb, 'integrity-projection', 'integrity-outbox',
        'integrity-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessImportApplication"
        SET "idempotencyRequestHash" = repeat('a', 64)
        WHERE "id" = 'integrity-application';
        RAISE EXCEPTION 'application idempotency request hash unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%idempotency identity is immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        DELETE FROM "BusinessImportApplication"
        WHERE "id" = 'integrity-application';
        RAISE EXCEPTION 'application idempotency record unexpectedly deleted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%idempotency identity is immutable%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessImportApplicationCandidate" (
        "tenantId", "sourceId", "importId", "applicationId", "candidateId", "candidateVersion",
        "candidateValueHash", "action", "targetCategory", "risk", "requiresApproval",
        "requiredPermission", "approvalGrantId", "appliedAt"
      ) VALUES (
        'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-application',
        'integrity-candidate', 1, repeat('d', 64), 'ADD', 'OFFERINGS', 'HIGH', true,
        'business_information.write_sensitive', 'integrity-grant', CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessImport"
        SET "state" = 'APPLIED', "appliedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'integrity-import';
        RAISE EXCEPTION 'import applied without receipt unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%ready application%' THEN RAISE; END IF;
      END;

      INSERT INTO "BusinessInformationProjectionReceipt" (
        "id", "tenantId", "sourceId", "importId", "applicationId", "businessRevisionId",
        "businessRevision", "businessRevisionHash", "knowledgeTargetKey", "knowledgeDraftGeneration",
        "knowledgeDraftManifestHash", "runtimeOutboxId", "runtimeOutboxDedupeKey", "receiptHash",
        "projectedAt", "createdAt"
      ) VALUES (
        'integrity-receipt', 'integrity-tenant', 'integrity-source', 'integrity-import', 'integrity-application',
        'integrity-business-revision', 1, repeat('3', 64), 'tenant:integrity-tenant:business-information',
        1, repeat('8', 64), 'integrity-outbox', 'integrity-projection', repeat('9', 64),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );

      BEGIN
        UPDATE "BusinessImportApplication"
        SET "state" = 'READY', "projectionReceiptHash" = repeat('a', 64),
            "projectedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'integrity-application';
        RAISE EXCEPTION 'application with wrong receipt unexpectedly became ready';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%exact durable projection receipt%' THEN RAISE; END IF;
      END;

      UPDATE "BusinessImportApplication"
      SET "state" = 'READY', "projectionReceiptHash" = repeat('9', 64),
          "projectedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'integrity-application';

      UPDATE "BusinessImport"
      SET "state" = 'APPLIED', "appliedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'integrity-import';

      INSERT INTO "BusinessInformationRevision" (
        "id", "tenantId", "revision", "parentRevisionId", "parentRevision", "canonicalHash",
        "origin", "deltaObjectKey", "deltaEncryptionKeyRef", "deltaObjectLedgerId",
        "deltaObjectKind", "deltaHash", "affectedResources", "createdByUserId", "createdAt"
      ) VALUES (
        'integrity-manual-revision', 'integrity-tenant', 2, 'integrity-business-revision', 1,
        repeat('a', 64), 'MANUAL', 'integrity/manual-delta', 'key-v1', 'ledger-manual-delta',
        'REVISION_DELTA', repeat('b', 64), '["business-identity"]'::jsonb,
        'integrity-user', manual_time
      );

      UPDATE "BusinessInformationState"
      SET "revision" = 2, "currentRevisionId" = 'integrity-manual-revision',
          "canonicalHash" = repeat('a', 64), "etag" = 3, "updatedAt" = manual_time
      WHERE "tenantId" = 'integrity-tenant';

      INSERT INTO "RuntimeOutbox" (
        "id", "tenantId", "aggregateType", "aggregateId", "aggregateVersion", "generation",
        "eventType", "schemaVersion", "dedupeKey", "payload", "createdAt", "updatedAt"
      ) VALUES (
        'integrity-manual-outbox', 'integrity-tenant', 'BusinessInformationRevision',
        'integrity-manual-revision', 2, 2, 'business.information.project.requested', 1,
        'business-information-project:integrity-manual-revision:2',
        jsonb_build_object(
          'queueName', 'business.import',
          'jobName', 'project-revision',
          'jobId', 'business-information-project:integrity-manual-revision:2',
          'data', jsonb_build_object(
            'tenantId', 'integrity-tenant',
            'businessRevisionId', 'integrity-manual-revision',
            'businessRevision', 2,
            'generation', 2,
            'requestedByUserId', 'integrity-user',
            'requestedAt', '2026-07-21T13:00:00.000Z'
          ),
          'attempts', 10,
          'backoffMs', 2000
        ),
        manual_time, manual_time
      );

      BEGIN
        INSERT INTO "BusinessInformationProjectionReceipt" (
          "id", "tenantId", "sourceId", "businessRevisionId", "businessRevision",
          "businessRevisionHash", "knowledgeTargetKey", "knowledgeDraftGeneration",
          "knowledgeDraftManifestHash", "runtimeOutboxId", "runtimeOutboxDedupeKey",
          "receiptHash", "projectedAt", "createdAt"
        ) VALUES (
          'partial-manual-receipt', 'integrity-tenant', 'integrity-source',
          'integrity-manual-revision', 2, repeat('a', 64), 'workspace-v2', 2,
          repeat('c', 64), 'integrity-manual-outbox',
          'business-information-project:integrity-manual-revision:2', repeat('d', 64),
          manual_time, manual_time
        );
        RAISE EXCEPTION 'partial manual receipt context unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;

      INSERT INTO "BusinessInformationProjectionReceipt" (
        "id", "tenantId", "businessRevisionId", "businessRevision", "businessRevisionHash",
        "knowledgeTargetKey", "knowledgeDraftGeneration", "knowledgeDraftManifestHash",
        "runtimeOutboxId", "runtimeOutboxDedupeKey", "receiptHash", "projectedAt", "createdAt"
      ) VALUES (
        'integrity-manual-receipt', 'integrity-tenant', 'integrity-manual-revision', 2,
        repeat('a', 64), 'workspace-v2', 2, repeat('c', 64), 'integrity-manual-outbox',
        'business-information-project:integrity-manual-revision:2', repeat('d', 64),
        manual_time, manual_time
      );

      UPDATE "BusinessInformationState"
      SET "lastProjectedRevisionId" = 'integrity-manual-revision',
          "lastProjectedRevision" = 2, "lastProjectedHash" = repeat('a', 64),
          "lastProjectionReceiptId" = 'integrity-manual-receipt',
          "lastProjectionReceiptHash" = repeat('d', 64), "updatedAt" = manual_time
      WHERE "tenantId" = 'integrity-tenant';

      INSERT INTO "BusinessInformationAttribution" (
        "id", "tenantId", "resourceType", "resourceKey", "identityId", "fieldPath", "currentValueHash",
        "sourceValueHash", "authority", "confidence", "sourceId", "importId", "candidateId",
        "candidateVersion", "candidateValueHash", "evidenceId", "artifactId", "artifactSha256",
        "importGeneration", "parsedRevisionId", "parsedManifestHash", "applicationId",
        "businessRevisionId", "businessRevision", "businessRevisionHash", "parserVersion",
        "mapperVersion", "schemaVersion", "createdAt"
      ) VALUES (
        'integrity-attribution', 'integrity-tenant', 'BUSINESS_IDENTITY', 'integrity-identity',
        'integrity-identity', 'displayName', repeat('a', 64), repeat('e', 64), 'IMPORTED', 'HIGH',
        'integrity-source', 'integrity-import', 'integrity-candidate', 1, repeat('d', 64),
        'integrity-evidence', 'integrity-artifact', repeat('a', 64), 1, 'integrity-parsed',
        repeat('b', 64), 'integrity-application', 'integrity-business-revision', 1, repeat('3', 64),
        'parser-v1', 'mapper-v1', '1', CURRENT_TIMESTAMP
      );

      BEGIN
        INSERT INTO "BusinessInformationAttribution" (
          "id", "tenantId", "resourceType", "resourceKey", "identityId", "fieldPath",
          "currentValueHash", "authority", "businessRevisionId", "businessRevision",
          "businessRevisionHash", "createdAt"
        ) VALUES (
          'free-resource-key', 'integrity-tenant', 'BUSINESS_IDENTITY', 'not-the-identity',
          'integrity-identity', 'description', repeat('a', 64), 'MANUAL',
          'integrity-business-revision', 1, repeat('3', 64), CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'free-form resource key unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;

      BEGIN
        INSERT INTO "BusinessInformationAttribution" (
          "id", "tenantId", "resourceType", "resourceKey", "identityId", "fieldPath",
          "currentValueHash", "authority", "sourceId", "businessRevisionId", "businessRevision",
          "businessRevisionHash", "createdAt"
        ) VALUES (
          'nonimport-provenance', 'integrity-tenant', 'BUSINESS_IDENTITY', 'integrity-identity',
          'integrity-identity', 'legalName', repeat('a', 64), 'MANUAL', 'integrity-source',
          'integrity-business-revision', 1, repeat('3', 64), CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'non-import provenance unexpectedly accepted';
      EXCEPTION WHEN check_violation THEN NULL;
      END;

      BEGIN
        INSERT INTO "BusinessInformationAttribution" (
          "id", "tenantId", "resourceType", "resourceKey", "identityId", "fieldPath",
          "currentValueHash", "authority", "businessRevisionId", "businessRevision",
          "businessRevisionHash", "createdAt"
        ) VALUES (
          'duplicate-current-attribution', 'integrity-tenant', 'BUSINESS_IDENTITY', 'integrity-identity',
          'integrity-identity', 'displayName', repeat('a', 64), 'MANUAL',
          'integrity-business-revision', 1, repeat('3', 64), CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'duplicate current attribution unexpectedly accepted';
      EXCEPTION WHEN unique_violation THEN NULL;
      END;

      DELETE FROM "RuntimeOutbox" WHERE "id" = 'integrity-outbox';
      DELETE FROM "RuntimeOutbox" WHERE "id" = 'integrity-manual-outbox';

      IF NOT EXISTS (
        SELECT 1
        FROM "BusinessImportApplication" application_record
        INNER JOIN "BusinessInformationProjectionReceipt" receipt
          ON receipt."applicationId" = application_record."id"
        WHERE application_record."id" = 'integrity-application'
          AND application_record."projectionOutboxId" IS NULL
          AND application_record."projectionOutboxPrunedAt" IS NOT NULL
          AND application_record."projectionOutboxDedupeKey" = 'integrity-projection'
          AND receipt."runtimeOutboxId" IS NULL
          AND receipt."runtimeOutboxPrunedAt" IS NOT NULL
          AND receipt."runtimeOutboxDedupeKey" = 'integrity-projection'
      ) THEN
        RAISE EXCEPTION 'outbox pruning did not preserve a durable receipt snapshot';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM "BusinessInformationProjectionReceipt"
        WHERE "id" = 'integrity-manual-receipt'
          AND "sourceId" IS NULL
          AND "importId" IS NULL
          AND "applicationId" IS NULL
          AND "runtimeOutboxId" IS NULL
          AND "runtimeOutboxPrunedAt" IS NOT NULL
          AND "runtimeOutboxDedupeKey" = 'business-information-project:integrity-manual-revision:2'
      ) THEN
        RAISE EXCEPTION 'manual projection receipt did not survive outbox pruning';
      END IF;

      BEGIN
        UPDATE "BusinessInformationProjectionReceipt"
        SET "receiptHash" = repeat('a', 64)
        WHERE "id" = 'integrity-receipt';
        RAISE EXCEPTION 'projection receipt unexpectedly mutated';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
      END;

      BEGIN
        UPDATE "BusinessImportObjectLedger"
        SET "deletionState" = 'DELETED', "tombstonedAt" = CURRENT_TIMESTAMP,
            "deletionStartedAt" = CURRENT_TIMESTAMP, "deletedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'ledger-lifecycle';
        RAISE EXCEPTION 'object deletion lifecycle unexpectedly skipped states';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%cannot move backward or skip states%' THEN RAISE; END IF;
      END;

      UPDATE "BusinessImportObjectLedger"
      SET "legalHold" = true, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'ledger-lifecycle';

      BEGIN
        UPDATE "BusinessImportObjectLedger"
        SET "deletionState" = 'TOMBSTONED', "tombstoneReason" = 'expired',
            "tombstonedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'ledger-lifecycle';
        RAISE EXCEPTION 'legally held object unexpectedly tombstoned';
      EXCEPTION WHEN check_violation THEN NULL;
      END;

      UPDATE "BusinessImportObjectLedger"
      SET "legalHold" = false, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'ledger-lifecycle';

      UPDATE "BusinessImportObjectLedger"
      SET "deletionState" = 'TOMBSTONED', "tombstoneReason" = 'expired',
          "tombstonedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'ledger-lifecycle';

      UPDATE "BusinessImportObjectLedger"
      SET "deletionState" = 'DELETING', "deletionStartedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'ledger-lifecycle';

      UPDATE "BusinessImportObjectLedger"
      SET "deletionState" = 'DELETED', "deletedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'ledger-lifecycle';

      BEGIN
        UPDATE "BusinessImportObjectLedger"
        SET "deletionState" = 'RETAINED', "tombstoneReason" = NULL, "tombstonedAt" = NULL,
            "deletionStartedAt" = NULL, "deletedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'ledger-lifecycle';
        RAISE EXCEPTION 'deleted object unexpectedly returned to retained state';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
    END;
    $integrity$;
  `);
}

async function main() {
  const maintenance = new PrismaClient({
    datasources: { db: { url: maintenanceUrl.toString() } },
  });
  let database: PrismaClient | null = null;
  let failure: unknown;

  try {
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);

    const initialMigration = await migrate();
    assert.equal(initialMigration.status, 0, output(initialMigration));
    assert.match(
      output(initialMigration),
      /Applied business_information_import_foundation migration \(327 statements\)/u,
    );
    assert.match(
      output(initialMigration),
      /Applied business_information_manual_projection migration \([0-9]+ statements\)/u,
    );
    assert.match(
      output(initialMigration),
      /Business import field provenance already exists; skipping business_import_field_provenance migration/u,
    );
    assert.match(
      output(initialMigration),
      /Business import evidence ledger index already exists; skipping business_import_evidence_ledger_index_repair migration/u,
    );
    assert.match(
      output(initialMigration),
      /Applied business_import_evidence_record_integrity migration \(4 statements\)/u,
    );
    assert.match(
      output(initialMigration),
      /Applied business_import_link_action migration \(1 statements\)/u,
    );
    assert.match(
      output(initialMigration),
      /Applied business_import_application_idempotency_request migration \(5 statements\)/u,
    );
    assert.match(
      output(initialMigration),
      /Applied business_import_mapping_confirmation_immutability migration \(2 statements\)/u,
    );

    const repeatedMigration = await migrate();
    assert.equal(repeatedMigration.status, 0, output(repeatedMigration));
    assert.match(
      output(repeatedMigration),
      /Business information import foundation already exists; skipping business_information_import_foundation migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business information manual projection already exists; skipping business_information_manual_projection migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business import field provenance already exists; skipping business_import_field_provenance migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business import evidence ledger index already exists; skipping business_import_evidence_ledger_index_repair migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business import evidence record integrity already exists; skipping business_import_evidence_record_integrity migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business import link action already exists; skipping business_import_link_action migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business import application idempotency request contract already exists; skipping business_import_application_idempotency_request migration/u,
    );
    assert.match(
      output(repeatedMigration),
      /Business import mapping confirmation immutability already exists; skipping business_import_mapping_confirmation_immutability migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_information_import_foundation migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_information_manual_projection migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_import_evidence_ledger_index_repair migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_import_evidence_record_integrity migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_import_link_action migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_import_application_idempotency_request migration/u,
    );
    assert.doesNotMatch(
      output(repeatedMigration),
      /Applied business_import_mapping_confirmation_immutability migration/u,
    );

    database = new PrismaClient({ datasources: { db: { url: smokeUrl.toString() } } });
    await verifyIntegrityContracts(database);
    await database.$executeRawUnsafe(`DROP INDEX "${currentAttributionIndex}"`);

    const partialMigration = await migrate();
    assert.notEqual(partialMigration.status, 0, "partial foundation unexpectedly passed");
    assert.match(
      output(partialMigration),
      /Business information import foundation is partially installed; refusing to replay its DDL/u,
    );
    assert.match(output(partialMigration), /currentAttribution=false/u);

    await database.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${currentAttributionIndex}"
      ON "BusinessInformationAttribution"("tenantId", "resourceType", "resourceKey", "fieldPath")
      WHERE "supersededAt" IS NULL
    `);
    const restoredMigration = await migrate();
    assert.equal(restoredMigration.status, 0, output(restoredMigration));
    assert.match(
      output(restoredMigration),
      /Business information import foundation already exists; skipping business_information_import_foundation migration/u,
    );

    for (const statement of [
      `ALTER TABLE "BusinessImportCandidateRevision"
        DROP CONSTRAINT "BusinessImportCandidateRevision_value_check"`,
      `ALTER TABLE "BusinessImportCandidateRevision" DROP COLUMN "fieldProvenance"`,
      `DROP FUNCTION "business_import_field_provenance_valid"(JSONB)`,
      `ALTER TABLE "BusinessImportCandidateRevision"
        ADD CONSTRAINT "BusinessImportCandidateRevision_value_check" CHECK (
          "version" > 0
          AND "importGeneration" > 0
          AND "normalizedValueHash" ~ '^[a-f0-9]{64}$'
          AND "artifactSha256" ~ '^[a-f0-9]{64}$'
          AND "parsedManifestHash" ~ '^[a-f0-9]{64}$'
          AND (("requiresApproval" AND length("requiredPermission") > 0) OR (NOT "requiresApproval" AND "requiredPermission" = ''))
        )`,
    ])
      await database.$executeRawUnsafe(statement);
    const upgradeMigration = await migrate();
    assert.equal(upgradeMigration.status, 0, output(upgradeMigration));
    assert.match(
      output(upgradeMigration),
      /Applied business_import_field_provenance migration \(8 statements\)/u,
    );
    const backfilled = await database.$queryRawUnsafe<Array<{ invalid: bigint }>>(`
      SELECT COUNT(*) AS invalid
      FROM "BusinessImportCandidateRevision"
      WHERE "fieldProvenance"->'/name'->>'authority' <> 'SYSTEM'
    `);
    assert.equal(backfilled[0]?.invalid, 0n);

    await database.$executeRawUnsafe(`DROP INDEX "${evidenceLedgerIndex}"`);
    const evidenceIndexRepairMigration = await migrate();
    assert.equal(evidenceIndexRepairMigration.status, 0, output(evidenceIndexRepairMigration));
    assert.match(
      output(evidenceIndexRepairMigration),
      /Business information import foundation already exists; skipping business_information_import_foundation migration/u,
    );
    assert.match(
      output(evidenceIndexRepairMigration),
      /Business import field provenance already exists; skipping business_import_field_provenance migration/u,
    );
    assert.match(
      output(evidenceIndexRepairMigration),
      /Applied business_import_evidence_ledger_index_repair migration \(1 statements\)/u,
    );
    const repairedIndex = await database.$queryRawUnsafe<
      Array<{ valid: boolean; definition: string }>
    >(`
      SELECT
        index_state.indisvalid AND index_state.indisready AND index_state.indislive AS valid,
        pg_get_indexdef(index_record.oid) AS definition
      FROM pg_class AS index_record
      INNER JOIN pg_namespace AS index_schema
        ON index_schema.oid = index_record.relnamespace
        AND index_schema.nspname = current_schema()
      INNER JOIN pg_index AS index_state ON index_state.indexrelid = index_record.oid
      WHERE index_record.relname = '${evidenceLedgerIndex}'
    `);
    assert.equal(repairedIndex.length, 1);
    assert.equal(repairedIndex[0]?.valid, true);
    assert.match(
      repairedIndex[0]?.definition ?? "",
      /USING btree \("tenantId", "excerptObjectLedgerId"\)$/u,
    );

    const repeatedEvidenceIndexRepair = await migrate();
    assert.equal(repeatedEvidenceIndexRepair.status, 0, output(repeatedEvidenceIndexRepair));
    assert.match(
      output(repeatedEvidenceIndexRepair),
      /Business import evidence ledger index already exists; skipping business_import_evidence_ledger_index_repair migration/u,
    );
    assert.doesNotMatch(
      output(repeatedEvidenceIndexRepair),
      /Applied business_import_evidence_ledger_index_repair migration/u,
    );

    await database.$executeRawUnsafe(
      `DROP TRIGGER "BusinessImportCandidateEvidence_immutable" ON "BusinessImportCandidateEvidence"`,
    );
    const partialEvidenceIntegrity = await migrate();
    assert.notEqual(
      partialEvidenceIntegrity.status,
      0,
      "partial evidence integrity unexpectedly passed",
    );
    assert.match(
      output(partialEvidenceIntegrity),
      /Business import evidence record integrity is partially installed; refusing to replay its DDL \(column=true, constraint=true, trigger=false\)/u,
    );
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "BusinessImportCandidateEvidence_immutable"
      BEFORE UPDATE OR DELETE ON "BusinessImportCandidateEvidence"
      FOR EACH ROW EXECUTE FUNCTION "business_import_reject_immutable_mutation"()
    `);
    const restoredEvidenceIntegrity = await migrate();
    assert.equal(restoredEvidenceIntegrity.status, 0, output(restoredEvidenceIntegrity));
    assert.match(
      output(restoredEvidenceIntegrity),
      /Business import evidence record integrity already exists; skipping business_import_evidence_record_integrity migration/u,
    );

    await database.$executeRawUnsafe(
      `DROP TRIGGER "BusinessImportApplication_idempotency_identity_guard" ON "BusinessImportApplication"`,
    );
    const partialApplicationIdempotency = await migrate();
    assert.notEqual(
      partialApplicationIdempotency.status,
      0,
      "partial application idempotency contract unexpectedly passed",
    );
    assert.match(
      output(partialApplicationIdempotency),
      /Business import application idempotency request contract is partially installed; refusing to replay its DDL \(column=true, constraint=true, function=true, trigger=false\)/u,
    );
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "BusinessImportApplication_idempotency_identity_guard"
      BEFORE UPDATE OF "idempotencyKeyHash", "idempotencyRequestHash" OR DELETE
      ON "BusinessImportApplication"
      FOR EACH ROW EXECUTE FUNCTION "business_import_application_idempotency_identity_guard"()
    `);
    const restoredApplicationIdempotency = await migrate();
    assert.equal(restoredApplicationIdempotency.status, 0, output(restoredApplicationIdempotency));
    assert.match(
      output(restoredApplicationIdempotency),
      /Business import application idempotency request contract already exists; skipping business_import_application_idempotency_request migration/u,
    );

    console.log("Business information import migration smoke passed.");
  } catch (error) {
    failure = error;
  }

  for (const cleanup of [
    async () => database?.$disconnect(),
    async () =>
      maintenance.$queryRawUnsafe(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        databaseName,
      ),
    async () => maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`),
    async () => maintenance.$disconnect(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure instanceof Error) throw failure;
  if (failure !== undefined) {
    throw new Error("Business information import migration smoke failed.", { cause: failure });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
