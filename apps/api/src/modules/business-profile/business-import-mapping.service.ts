import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  BUSINESS_SERVICE_MAPPING_TARGETS,
  BUSINESS_SERVICE_MAPPING_VERSION,
  BusinessServicesCsvError,
  isBusinessImportCurrencyCode,
  validateConfirmedBusinessServiceMapping,
  type BusinessServiceCsvAnalysis,
  type BusinessServiceMappingProposal,
} from "@leadvirt/business-import";
import { Prisma } from "@leadvirt/db";
import type {
  BusinessImportMappingColumnStatus,
  BusinessImportMappingConfirmReceipt,
  BusinessImportMappingConfirmRequest,
  BusinessImportMappingDefaults,
  BusinessImportMappingTarget,
  BusinessImportMappingView,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { canonicalKnowledgeV2Hash } from "../knowledge/knowledge-v2-http.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import {
  assertBusinessImportIfMatch,
  businessImportEtag,
  businessImportError,
} from "./business-import-http.js";
import {
  lockAndExtendRetainedBusinessImportObjects,
  type RetainedBusinessImportObject,
} from "./business-import-object-lifecycle.js";
import { BusinessImportQueueService } from "./business-import-queue.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";

const mappingTargets: ReadonlySet<BusinessImportMappingTarget> = new Set(
  BUSINESS_SERVICE_MAPPING_TARGETS,
);
const mappingStatuses = new Set<BusinessImportMappingColumnStatus>([
  "MATCHED",
  "CHECK_MAPPING",
  "NOT_USED",
]);
const businessImportManifestVersion = "leadvirt.business-import.manifest.v1";
const businessImportCsvParserVersion = "leadvirt.csv.services.v1";
const maximumPreviewColumns = 100;
const maximumExamplesPerColumn = 3;
const maximumPreviewValueCharacters = 200;
const mappingKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const languagePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const timezonePattern = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/u;
const decimalCommaLanguages = new Set(["de", "es", "fr", "it", "pt", "ru", "uk"]);

type HeaderValue = string | string[] | undefined;

interface ManifestColumn {
  sourceColumnKey: string;
  index: number;
  header: string;
  examples: string[];
}

interface MappingManifest {
  analysis: BusinessServiceCsvAnalysis;
  proposal: BusinessServiceMappingProposal;
  tableKey: string;
  schemaHash: string;
  headerRow: number;
  totalRows: number;
  columns: ManifestColumn[];
  proposed: Map<
    string,
    {
      target: BusinessImportMappingTarget;
      status: BusinessImportMappingColumnStatus;
    }
  >;
  defaults: BusinessImportMappingDefaults;
  errorCodes: string[];
  warningCodes: string[];
  proposalHash: string;
}

interface LoadedMapping {
  importId: string;
  sourceId: string;
  format: "CSV";
  generation: number;
  numericEtag: number;
  parsedRevisionId: string;
  parsedManifestHash: string;
  artifactId: string;
  artifactSha256: string;
  retainedObjects: [RetainedBusinessImportObject, RetainedBusinessImportObject];
  manifest: MappingManifest;
}

type MappingConfirmationResult = Omit<
  BusinessImportMappingConfirmReceipt,
  "idempotencyReplayed"
> & {
  eventId: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactText(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableExactText(value: unknown, maximum: number) {
  if (value === null) return null;
  return typeof value === "string" && value.length <= maximum ? value : undefined;
}

function mappingTarget(value: unknown): BusinessImportMappingTarget | null {
  return typeof value === "string" && mappingTargets.has(value as BusinessImportMappingTarget)
    ? (value as BusinessImportMappingTarget)
    : null;
}

function mappingStatus(value: unknown): BusinessImportMappingColumnStatus | null {
  return typeof value === "string" &&
    mappingStatuses.has(value as BusinessImportMappingColumnStatus)
    ? (value as BusinessImportMappingColumnStatus)
    : null;
}

function stringCodes(value: unknown, maximum = 100) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || item.length < 1 || item.length > 160)
  ) {
    return null;
  }
  return value as string[];
}

function manifestDefaults(value: unknown): BusinessImportMappingDefaults | null {
  const item = record(value);
  if (!item) return null;
  const locale = nullableExactText(item.locale, 35);
  const numberFormat =
    item.numberFormat === undefined
      ? locale && decimalCommaLanguages.has(locale.toLowerCase().split("-")[0] ?? "")
        ? "DECIMAL_COMMA"
        : locale
          ? "DECIMAL_DOT"
          : null
      : item.numberFormat === null ||
          item.numberFormat === "DECIMAL_DOT" ||
          item.numberFormat === "DECIMAL_COMMA"
        ? item.numberFormat
        : undefined;
  const currency = nullableExactText(item.currency, 3);
  const timezone = nullableExactText(item.timezone, 100);
  const unit = nullableExactText(item.unit, 80);
  if (
    locale === undefined ||
    numberFormat === undefined ||
    currency === undefined ||
    timezone === undefined ||
    unit === undefined ||
    (locale !== null && !languagePattern.test(locale)) ||
    (currency !== null && !isBusinessImportCurrencyCode(currency)) ||
    (timezone !== null && !timezonePattern.test(timezone)) ||
    (unit !== null && unit.length < 1)
  ) {
    return null;
  }
  return { locale, numberFormat, currency, timezone, unit };
}

function manifestSamples(value: unknown) {
  if (!Array.isArray(value) || value.length > maximumExamplesPerColumn) return null;
  const parsed: BusinessServiceCsvAnalysis["columns"][number]["samples"] = [];
  for (const raw of value) {
    const item = record(raw);
    const row = item ? integer(item.row) : null;
    const sample = item ? exactText(item.value, maximumPreviewValueCharacters) : null;
    if (
      !item ||
      row === null ||
      row < 1 ||
      sample === null ||
      typeof item.truncated !== "boolean"
    ) {
      return null;
    }
    parsed.push({ row, value: sample, truncated: item.truncated });
  }
  return parsed;
}

function mappingManifest(value: unknown): MappingManifest | null {
  const envelope = record(value);
  const rawAnalysis = envelope ? record(envelope.analysis) : null;
  const rawProposal = envelope ? record(envelope.proposal) : null;
  if (
    !envelope ||
    envelope.contractVersion !== businessImportManifestVersion ||
    envelope.format !== "CSV" ||
    envelope.status !== "MAPPING_REQUIRED" ||
    envelope.parserVersion !== businessImportCsvParserVersion ||
    !Array.isArray(envelope.diagnostics) ||
    !rawAnalysis ||
    !rawProposal
  ) {
    return null;
  }
  const tableKey = exactText(rawAnalysis.tableKey, 200);
  const schemaHash = exactText(rawAnalysis.schemaHash, 64);
  const envelopeSchemaHash = exactText(envelope.schemaHash, 64);
  const headerRow = integer(rawAnalysis.headerRow);
  const totalRows = integer(rawAnalysis.rowCount);
  if (
    rawAnalysis.version !== BUSINESS_SERVICE_MAPPING_VERSION ||
    rawAnalysis.format !== "CSV" ||
    tableKey !== "csv:services" ||
    !schemaHash ||
    !/^[a-f0-9]{64}$/u.test(schemaHash) ||
    envelopeSchemaHash !== schemaHash ||
    !["utf-8", "windows-1251"].includes(String(rawAnalysis.encoding)) ||
    ![",", ";", "\t"].includes(String(rawAnalysis.delimiter)) ||
    headerRow === null ||
    headerRow < 1 ||
    headerRow > 20 ||
    totalRows === null ||
    totalRows < 0 ||
    totalRows > 10_000 ||
    !Array.isArray(rawAnalysis.columns) ||
    rawAnalysis.columns.length < 1 ||
    rawAnalysis.columns.length > maximumPreviewColumns
  ) {
    return null;
  }

  const analysisColumns: BusinessServiceCsvAnalysis["columns"] = [];
  const columns: ManifestColumn[] = [];
  const seenKeys = new Set<string>();
  for (const [position, raw] of rawAnalysis.columns.entries()) {
    const item = record(raw);
    const sourceColumnKey = item ? exactText(item.columnKey, 200) : null;
    const index = item ? integer(item.column) : null;
    const header = item ? exactText(item.header, 500) : null;
    const normalizedHeader = item ? exactText(item.normalizedHeader, 500) : null;
    const nonEmptyCount = item ? integer(item.nonEmptyCount) : null;
    const samples = item ? manifestSamples(item.samples) : null;
    if (
      !item ||
      !sourceColumnKey ||
      !mappingKeyPattern.test(sourceColumnKey) ||
      index === null ||
      index !== position + 1 ||
      sourceColumnKey !== `column:${index}` ||
      header === null ||
      normalizedHeader === null ||
      nonEmptyCount === null ||
      nonEmptyCount < 0 ||
      nonEmptyCount > totalRows ||
      samples === null ||
      seenKeys.has(sourceColumnKey) ||
      samples.some((sample) => sample.row <= headerRow)
    ) {
      return null;
    }
    seenKeys.add(sourceColumnKey);
    analysisColumns.push({
      columnKey: sourceColumnKey,
      column: index,
      header,
      normalizedHeader,
      samples,
      nonEmptyCount,
    });
    columns.push({
      sourceColumnKey,
      index,
      header,
      examples: samples.map((sample) => sample.value),
    });
  }
  const analysis: BusinessServiceCsvAnalysis = {
    version: BUSINESS_SERVICE_MAPPING_VERSION,
    format: "CSV",
    tableKey,
    schemaHash,
    encoding: rawAnalysis.encoding as BusinessServiceCsvAnalysis["encoding"],
    delimiter: rawAnalysis.delimiter as BusinessServiceCsvAnalysis["delimiter"],
    headerRow,
    rowCount: totalRows,
    columns: analysisColumns,
  };

  if (
    rawProposal.version !== BUSINESS_SERVICE_MAPPING_VERSION ||
    rawProposal.tableKey !== tableKey ||
    rawProposal.schemaHash !== schemaHash ||
    rawProposal.headerRow !== headerRow ||
    !Array.isArray(rawProposal.columns) ||
    rawProposal.columns.length !== columns.length
  ) {
    return null;
  }
  const proposalColumns: BusinessServiceMappingProposal["columns"] = [];
  const proposed = new Map<
    string,
    { target: BusinessImportMappingTarget; status: BusinessImportMappingColumnStatus }
  >();
  for (const raw of rawProposal.columns) {
    const item = record(raw);
    const sourceColumnKey = item ? exactText(item.columnKey, 200) : null;
    const target = item ? mappingTarget(item.target) : null;
    const status = item ? mappingStatus(item.status) : null;
    const confidence =
      item && ["HIGH", "MEDIUM", "LOW", "NONE"].includes(String(item.confidence))
        ? (item.confidence as BusinessServiceMappingProposal["columns"][number]["confidence"])
        : null;
    const reasonCodes = item ? stringCodes(item.reasonCodes, 20) : null;
    if (
      !item ||
      !sourceColumnKey ||
      !seenKeys.has(sourceColumnKey) ||
      proposed.has(sourceColumnKey) ||
      !target ||
      !status ||
      !confidence ||
      !reasonCodes
    ) {
      return null;
    }
    proposed.set(sourceColumnKey, { target, status });
    proposalColumns.push({ columnKey: sourceColumnKey, target, status, confidence, reasonCodes });
  }

  const validation = record(rawProposal.validation);
  const errorCodes = validation ? stringCodes(validation.errorCodes) : null;
  const warningCodes = validation ? stringCodes(validation.warningCodes) : null;
  const parsedDefaults = manifestDefaults(rawProposal.defaults);
  if (!validation || !errorCodes || !warningCodes || !parsedDefaults) return null;
  const proposal: BusinessServiceMappingProposal = {
    version: BUSINESS_SERVICE_MAPPING_VERSION,
    tableKey,
    schemaHash,
    headerRow,
    columns: proposalColumns,
    defaults: parsedDefaults,
    validation: { errorCodes, warningCodes },
  };
  return {
    analysis,
    proposal,
    tableKey,
    schemaHash,
    headerRow,
    totalRows,
    columns,
    proposed,
    defaults: parsedDefaults,
    errorCodes,
    warningCodes,
    proposalHash: canonicalKnowledgeV2Hash(proposal),
  };
}

function validationCodes(manifest: MappingManifest, input: BusinessImportMappingConfirmRequest) {
  const errors: string[] = [...manifest.errorCodes];
  if (typeof input.tableKey !== "string" || !mappingKeyPattern.test(input.tableKey)) {
    errors.push("BUSINESS_IMPORT_MAPPING_TABLE_INVALID");
  }
  if (typeof input.schemaHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.schemaHash)) {
    errors.push("BUSINESS_IMPORT_MAPPING_SCHEMA_INVALID");
  }
  if (!Number.isInteger(input.headerRow) || input.headerRow < 1 || input.headerRow > 10_000) {
    errors.push("BUSINESS_IMPORT_MAPPING_HEADER_INVALID");
  }
  if (
    !Array.isArray(input.columns) ||
    input.columns.length < 1 ||
    input.columns.length > maximumPreviewColumns
  ) {
    errors.push("BUSINESS_IMPORT_MAPPING_COLUMNS_INVALID");
    return [...new Set(errors)];
  }
  if (
    !input.defaults ||
    (input.defaults.locale !== null &&
      (typeof input.defaults.locale !== "string" ||
        !languagePattern.test(input.defaults.locale))) ||
    (input.defaults.numberFormat !== null &&
      input.defaults.numberFormat !== "DECIMAL_DOT" &&
      input.defaults.numberFormat !== "DECIMAL_COMMA") ||
    (input.defaults.currency !== null &&
      (typeof input.defaults.currency !== "string" ||
        !isBusinessImportCurrencyCode(input.defaults.currency))) ||
    (input.defaults.timezone !== null &&
      (typeof input.defaults.timezone !== "string" ||
        input.defaults.timezone.length > 100 ||
        !timezonePattern.test(input.defaults.timezone))) ||
    (input.defaults.unit !== null &&
      (typeof input.defaults.unit !== "string" ||
        input.defaults.unit.length < 1 ||
        input.defaults.unit.length > 80))
  ) {
    errors.push("BUSINESS_IMPORT_MAPPING_DEFAULTS_INVALID");
  }
  let structurallyValidColumns = true;
  for (const column of input.columns) {
    if (
      typeof column !== "object" ||
      column === null ||
      typeof column.sourceColumnKey !== "string" ||
      !mappingKeyPattern.test(column.sourceColumnKey)
    ) {
      errors.push("BUSINESS_IMPORT_MAPPING_COLUMNS_INVALID");
      structurallyValidColumns = false;
      continue;
    }
    if (!mappingTargets.has(column.target)) {
      errors.push("BUSINESS_IMPORT_MAPPING_TARGET_INVALID");
      structurallyValidColumns = false;
    }
  }
  if (structurallyValidColumns) {
    try {
      validateConfirmedBusinessServiceMapping(manifest.analysis, input);
    } catch (error) {
      errors.push(
        error instanceof BusinessServicesCsvError ? error.code : "BUSINESS_IMPORT_MAPPING_INVALID",
      );
    }
  }
  return [...new Set(errors)];
}

@Injectable()
export class BusinessImportMappingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(BusinessImportQueueService) private readonly queue: BusinessImportQueueService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
  ) {}

  async get(context: RequestContext, importId: string): Promise<BusinessImportMappingView> {
    const loaded = await this.load(context.tenantId, importId);
    return this.toView(loaded);
  }

  async confirm(
    context: RequestContext,
    importId: string,
    input: BusinessImportMappingConfirmRequest,
    ifMatch: HeaderValue,
    idempotencyKey: string,
  ): Promise<BusinessImportMappingConfirmReceipt> {
    this.assertEditor(context);
    const outcome = await this.idempotency.executePrepared<
      MappingConfirmationResult,
      LoadedMapping
    >(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/mapping/confirm`,
        key: idempotencyKey,
        request: { importId, input, ifMatch },
      },
      async () => {
        const loaded = await this.load(context.tenantId, importId);
        const errors = validationCodes(loaded.manifest, input);
        if (errors.length > 0) this.mappingInvalid(errors);
        return loaded;
      },
      async (tx, prepared) => {
        const now = new Date();
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Tenant"
          WHERE "id" = ${context.tenantId}
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "BusinessImport"
          WHERE "tenantId" = ${context.tenantId} AND "id" = ${importId}
          FOR UPDATE
        `);
        const current = await tx.businessImport.findFirst({
          where: { id: importId, tenantId: context.tenantId },
        });
        if (!current) this.notFound();
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "BusinessImportSource"
          WHERE "tenantId" = ${context.tenantId} AND "id" = ${current.sourceId}
          FOR UPDATE
        `);
        const source = await tx.businessImportSource.findFirst({
          where: { id: current.sourceId, tenantId: context.tenantId },
        });
        if (!source) this.notFound();
        await this.assertCurrentEditor(tx, context);
        assertBusinessImportIfMatch(ifMatch, businessImportEtag(current.id, current.etag));
        if (
          current.state !== "MAPPING_REQUIRED" ||
          source.status !== "ACTIVE" ||
          current.sourceId !== prepared.sourceId ||
          current.generation !== prepared.generation ||
          current.etag !== prepared.numericEtag ||
          current.parsedRevisionId !== prepared.parsedRevisionId ||
          current.parsedManifestHash !== prepared.parsedManifestHash ||
          current.artifactId !== prepared.artifactId ||
          current.artifactSha256 !== prepared.artifactSha256
        ) {
          this.stateConflict();
        }
        const retained = await lockAndExtendRetainedBusinessImportObjects(tx, {
          tenantId: context.tenantId,
          objects: prepared.retainedObjects,
          now,
        });
        if (!retained) this.manifestUnavailable();
        const errors = validationCodes(prepared.manifest, input);
        if (errors.length > 0) this.mappingInvalid(errors);
        const targetByColumn = new Map(
          input.columns.map((column) => [column.sourceColumnKey, column.target]),
        );

        const previous = await tx.businessImportMapping.findFirst({
          where: {
            tenantId: context.tenantId,
            sourceId: source.id,
            tableKey: input.tableKey,
            targetCategory: "OFFERINGS",
          },
          orderBy: { revision: "desc" },
        });
        const revision = (previous?.revision ?? 0) + 1;
        const mapping = await tx.businessImportMapping.create({
          data: {
            tenantId: context.tenantId,
            sourceId: source.id,
            importId: current.id,
            tableKey: input.tableKey,
            schemaHash: input.schemaHash,
            headerRow: input.headerRow,
            targetCategory: "OFFERINGS",
            fieldMappings: {
              version: 2,
              sourceGeneration: current.generation,
              parsedRevisionId: current.parsedRevisionId,
              parsedManifestHash: current.parsedManifestHash,
              numberFormat: input.defaults.numberFormat,
              columns: prepared.manifest.columns.map((column) => ({
                sourceColumnKey: column.sourceColumnKey,
                target: targetByColumn.get(column.sourceColumnKey)!,
              })),
            },
            defaultLocale: input.defaults.locale,
            defaultCurrency: input.defaults.currency,
            defaultTimezone: input.defaults.timezone,
            defaultUnit: input.defaults.unit,
            revision,
            ...(previous
              ? {
                  supersedesMappingId: previous.id,
                  supersedesRevision: previous.revision,
                }
              : {}),
            confirmedByUserId: context.userId,
            confirmedAt: now,
          },
        });
        const nextGeneration = current.generation + 1;
        const updated = await tx.businessImport.updateMany({
          where: {
            id: current.id,
            tenantId: context.tenantId,
            sourceId: source.id,
            state: "MAPPING_REQUIRED",
            generation: current.generation,
            etag: current.etag,
            parsedRevisionId: current.parsedRevisionId,
            parsedManifestHash: current.parsedManifestHash,
          },
          data: {
            generation: nextGeneration,
            state: "PARSING",
            parsedRevisionId: null,
            parsedManifestObjectKey: null,
            parsedManifestEncryptionKeyRef: null,
            parsedManifestObjectLedgerId: null,
            parsedManifestObjectKind: null,
            parsedManifestHash: null,
            parserVersion: null,
            ocrVersion: null,
            mapperVersion: null,
            modelVersion: null,
            promptVersion: null,
            safeSummary: Prisma.DbNull,
            failureCode: null,
            failureStage: null,
            retryable: false,
            parsedAt: null,
            reviewReadyAt: null,
            reviewCompletedAt: null,
            etag: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stateConflict();
        await tx.businessImportSource.update({
          where: { id: source.id },
          data: {
            lastMappingRevision: revision,
            updatedByUserId: context.userId,
            etag: { increment: 1 },
          },
        });
        const event = await this.queue.createParseEvent(tx, {
          tenantId: current.tenantId,
          sourceId: source.id,
          importId: current.id,
          generation: nextGeneration,
          operation: "PARSE",
          requestedByUserId: context.userId,
          requestedAt: now.toISOString(),
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.mapping_confirmed",
            entityType: "business_import_mapping",
            entityId: mapping.id,
            payload: {
              importId: current.id,
              sourceId: source.id,
              mappingId: mapping.id,
              mappingRevision: revision,
              sourceGeneration: current.generation,
              generation: nextGeneration,
              schemaHash: input.schemaHash,
              parsedRevisionId: prepared.parsedRevisionId,
              parsedManifestHash: prepared.parsedManifestHash,
              proposalHash: prepared.manifest.proposalHash,
              eventId: event.id,
            },
          },
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: {
            importId: current.id,
            mappingId: mapping.id,
            generation: nextGeneration,
            state: "PARSING" as const,
            etag: businessImportEtag(current.id, current.etag + 1),
            eventId: event.id,
          },
          responseRef: mapping.id,
        };
      },
    );
    this.queue.dispatch(outcome.responseBody.eventId);
    return {
      importId: outcome.responseBody.importId,
      mappingId: outcome.responseBody.mappingId,
      generation: outcome.responseBody.generation,
      state: outcome.responseBody.state,
      etag: outcome.responseBody.etag,
      idempotencyReplayed: outcome.idempotencyReplayed,
    };
  }

  private async load(tenantId: string, importId: string): Promise<LoadedMapping> {
    const row = await this.prisma.businessImport.findFirst({
      where: { id: importId, tenantId },
      select: {
        id: true,
        sourceId: true,
        format: true,
        state: true,
        generation: true,
        etag: true,
        expectedByteSize: true,
        artifactId: true,
        artifactSha256: true,
        parsedRevisionId: true,
        parsedManifestObjectKey: true,
        parsedManifestEncryptionKeyRef: true,
        parsedManifestHash: true,
        artifact: {
          select: {
            id: true,
            sourceId: true,
            sha256: true,
            byteSize: true,
            malwareStatus: true,
            mimeValidationStatus: true,
            objectKind: true,
            objectStorageKey: true,
            encryptionKeyRef: true,
            objectLedger: {
              select: {
                id: true,
                deletionState: true,
                objectKind: true,
                objectStorageKey: true,
                encryptionKeyRef: true,
                retentionClass: true,
                retainUntil: true,
              },
            },
          },
        },
        currentParsedRevision: {
          select: {
            id: true,
            importGeneration: true,
            artifactId: true,
            artifactSha256: true,
            manifestObjectLedgerId: true,
            manifestObjectKey: true,
            manifestEncryptionKeyRef: true,
            manifestHash: true,
            manifestObjectLedger: {
              select: {
                id: true,
                deletionState: true,
                objectKind: true,
                objectStorageKey: true,
                encryptionKeyRef: true,
                retentionClass: true,
                retainUntil: true,
              },
            },
          },
        },
      },
    });
    if (!row) this.notFound();
    if (row.state !== "MAPPING_REQUIRED") this.stateConflict();
    if (row.format !== "CSV") this.manifestUnavailable();
    const now = new Date();
    const revision = row.currentParsedRevision;
    const artifact = row.artifact;
    if (
      !row.artifactId ||
      !row.artifactSha256 ||
      !artifact ||
      artifact.id !== row.artifactId ||
      artifact.sourceId !== row.sourceId ||
      artifact.sha256 !== row.artifactSha256 ||
      artifact.byteSize !== row.expectedByteSize ||
      artifact.malwareStatus !== "CLEAN" ||
      artifact.mimeValidationStatus !== "VALID" ||
      artifact.objectKind !== "RAW_ARTIFACT" ||
      artifact.objectLedger.deletionState !== "RETAINED" ||
      artifact.objectLedger.objectKind !== "RAW_ARTIFACT" ||
      artifact.objectLedger.objectStorageKey !== artifact.objectStorageKey ||
      artifact.objectLedger.encryptionKeyRef !== artifact.encryptionKeyRef ||
      artifact.objectLedger.retentionClass !== "BUSINESS_IMPORT_RAW" ||
      (artifact.objectLedger.retainUntil !== null && artifact.objectLedger.retainUntil <= now) ||
      !row.parsedRevisionId ||
      !row.parsedManifestObjectKey ||
      !row.parsedManifestEncryptionKeyRef ||
      !row.parsedManifestHash ||
      !revision ||
      revision.id !== row.parsedRevisionId ||
      revision.importGeneration !== row.generation ||
      revision.artifactId !== row.artifactId ||
      revision.artifactSha256 !== row.artifactSha256 ||
      revision.manifestObjectLedgerId !== revision.manifestObjectLedger.id ||
      revision.manifestObjectKey !== row.parsedManifestObjectKey ||
      revision.manifestEncryptionKeyRef !== row.parsedManifestEncryptionKeyRef ||
      revision.manifestHash !== row.parsedManifestHash ||
      revision.manifestObjectLedger.deletionState !== "RETAINED" ||
      revision.manifestObjectLedger.objectKind !== "PARSED_MANIFEST" ||
      revision.manifestObjectLedger.objectStorageKey !== row.parsedManifestObjectKey ||
      revision.manifestObjectLedger.encryptionKeyRef !== row.parsedManifestEncryptionKeyRef ||
      revision.manifestObjectLedger.retentionClass !== "BUSINESS_IMPORT_PARSED_MANIFEST" ||
      (revision.manifestObjectLedger.retainUntil !== null &&
        revision.manifestObjectLedger.retainUntil <= now)
    ) {
      this.manifestUnavailable();
    }
    const runtime = this.runtimeService.runtime();
    let bytes: Uint8Array;
    try {
      bytes = await runtime.store.get(
        row.parsedManifestObjectKey,
        row.parsedManifestEncryptionKeyRef,
      );
    } catch {
      this.manifestUnavailable();
    }
    if (createHash("sha256").update(bytes!).digest("hex") !== row.parsedManifestHash) {
      this.manifestUnavailable();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes!)) as unknown;
    } catch {
      this.manifestUnavailable();
    }
    const manifest = mappingManifest(parsed);
    if (!manifest) this.manifestUnavailable();
    return {
      importId: row.id,
      sourceId: row.sourceId,
      format: row.format,
      generation: row.generation,
      numericEtag: row.etag,
      parsedRevisionId: row.parsedRevisionId,
      parsedManifestHash: row.parsedManifestHash,
      artifactId: row.artifactId,
      artifactSha256: row.artifactSha256,
      retainedObjects: [
        {
          ledgerId: artifact.objectLedger.id,
          objectKind: "RAW_ARTIFACT",
          objectStorageKey: artifact.objectStorageKey,
          encryptionKeyRef: artifact.encryptionKeyRef,
          retentionClass: "BUSINESS_IMPORT_RAW",
        },
        {
          ledgerId: revision.manifestObjectLedger.id,
          objectKind: "PARSED_MANIFEST",
          objectStorageKey: revision.manifestObjectKey,
          encryptionKeyRef: revision.manifestEncryptionKeyRef,
          retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST",
        },
      ],
      manifest,
    };
  }

  private toView(value: LoadedMapping): BusinessImportMappingView {
    const proposedAssignments = {
      tableKey: value.manifest.tableKey,
      schemaHash: value.manifest.schemaHash,
      headerRow: value.manifest.headerRow,
      columns: value.manifest.columns.map((column) => ({
        sourceColumnKey: column.sourceColumnKey,
        target: value.manifest.proposed.get(column.sourceColumnKey)?.target ?? "IGNORE",
      })),
      defaults: value.manifest.defaults,
    } satisfies BusinessImportMappingConfirmRequest;
    const derivedErrors = validationCodes(value.manifest, proposedAssignments);
    return {
      importId: value.importId,
      etag: businessImportEtag(value.importId, value.numericEtag),
      format: value.format,
      table: {
        tableKey: value.manifest.tableKey,
        schemaHash: value.manifest.schemaHash,
        headerRow: value.manifest.headerRow,
        totalRows: value.manifest.totalRows,
        totalColumns: value.manifest.columns.length,
        columns: value.manifest.columns.map((column) => {
          const proposal = value.manifest.proposed.get(column.sourceColumnKey);
          return {
            ...column,
            proposedTarget: proposal?.target ?? "IGNORE",
            status: proposal?.status ?? "NOT_USED",
          };
        }),
      },
      defaults: value.manifest.defaults,
      validation: {
        canConfirm: value.manifest.errorCodes.length === 0 && derivedErrors.length === 0,
        errorCodes: [...new Set([...value.manifest.errorCodes, ...derivedErrors])],
        warningCodes: value.manifest.warningCodes,
      },
    };
  }

  private assertEditor(context: RequestContext) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(context.role)) this.permissionDenied();
  }

  private async assertCurrentEditor(tx: Prisma.TransactionClient, context: RequestContext) {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
      include: {
        user: { select: { deletedAt: true } },
        tenant: { select: { deletedAt: true, status: true } },
      },
    });
    if (
      !membership ||
      !["OWNER", "ADMIN", "MANAGER"].includes(membership.role) ||
      membership.user.deletedAt ||
      membership.tenant.deletedAt ||
      !["ACTIVE", "TRIALING"].includes(membership.tenant.status)
    ) {
      this.permissionDenied();
    }
  }

  private permissionDenied(): never {
    throw businessImportError(
      HttpStatus.FORBIDDEN,
      "BUSINESS_IMPORT_PERMISSION_DENIED",
      "Only an owner, administrator, or manager can confirm an import mapping.",
    );
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }

  private stateConflict(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_STATE_CONFLICT",
      "The import is not waiting for a column mapping.",
    );
  }

  private manifestUnavailable(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_MAPPING_MANIFEST_UNAVAILABLE",
      "The mapping proposal can no longer be verified.",
    );
  }

  private mappingInvalid(codes: string[]): never {
    throw businessImportError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "BUSINESS_IMPORT_MAPPING_INVALID",
      "The column mapping is incomplete or invalid.",
      { details: { codes } },
    );
  }
}
