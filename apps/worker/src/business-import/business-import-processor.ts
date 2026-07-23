import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import {
  admitBusinessImportFile,
  analyzeBusinessServicesCsv,
  BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
  BusinessImportFileAdmissionError,
  BusinessServicesCsvError,
  BusinessServicesXlsxError,
  businessImportEvidenceRecordHash,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  createBusinessImportFieldProvenance,
  diffBusinessServiceRows,
  isExactBusinessServicesCsvContract,
  parseMappedBusinessServicesCsv,
  parseBusinessServicesCsv,
  parseBusinessServicesXlsx,
  proposeBusinessServiceMapping,
  type AcceptedBusinessImportFile,
  type BusinessImportCellEvidence,
  type BusinessImportDiagnostic,
  type BusinessImportFileScanner,
  type BusinessServiceCsvHeader,
  type BusinessServiceDiffCandidate,
  type BusinessServiceMappingTarget,
  type ConfirmedBusinessServiceMapping,
  type ParsedBusinessServiceRow,
} from "@leadvirt/business-import";
import { Prisma, type BusinessImportObjectKind, type PrismaClient } from "@leadvirt/db";
import {
  ClamAvKnowledgeFileScanner,
  createDeterministicKnowledgeObjectKey,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
  KnowledgeObjectStoreError,
  type KnowledgeObjectStore,
  type KnowledgeObjectWriteResult,
} from "@leadvirt/knowledge";
import { parseRuntimeQueueEnvelope } from "@leadvirt/runtime-queue";

const CSV_PARSER_VERSION = "leadvirt.csv.services.v1";
const MAPPER_VERSION = "leadvirt.services.mapper.v1";
const EXTRACTION_CONTRACT_VERSION = "leadvirt.business-import.manifest.v1";
const PDF_EXTRACTION_CONTRACT_VERSION = "leadvirt.pdf-extraction.v1";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_PDF_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 32 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const PENDING_RETENTION_PREFIX = "BUSINESS_IMPORT_PENDING";
const MIN_PENDING_RETENTION_MS = 60 * 60_000;
const MAX_PENDING_CLEANUP_BATCH = 100;
const STALE_DELETION_CLAIM_MS = 15 * 60_000;

const runtimeDataKeys = new Set([
  "tenantId",
  "sourceId",
  "importId",
  "generation",
  "operation",
  "requestedByUserId",
  "requestedAt",
  "runtimeEventId",
  "runtimeGeneration",
]);

const activeProcessingStates = ["SCANNING", "PARSING", "EXTRACTING", "FAILED_RETRYABLE"] as const;
const capacityStates = [
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "PARSING",
  "MAPPING_REQUIRED",
  "EXTRACTING",
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "APPLYING",
  "PROJECTING",
  "FAILED_RETRYABLE",
] as const;

type BusinessImportStage =
  | "VALIDATION"
  | "STORAGE"
  | "SCANNING"
  | "PARSING"
  | "EXTRACTING"
  | "PERSISTING";

export interface BusinessImportRuntimeData extends Record<string, unknown> {
  tenantId: string;
  sourceId: string;
  importId: string;
  generation: number;
  operation: "PARSE";
  requestedByUserId: string;
  requestedAt: string;
  runtimeEventId: string;
  runtimeGeneration: number;
}

export interface BusinessImportJobInput {
  id: string;
  name: string;
  data: BusinessImportRuntimeData;
  signal: AbortSignal;
}

export interface BusinessImportProcessorResult {
  status: "succeeded" | "already_succeeded" | "cancelled";
  importId: string;
  generation: number;
  state?: "READY_FOR_REVIEW" | "MAPPING_REQUIRED";
  candidateCount?: number;
  reason?: "stale_generation" | "terminal_replay";
}

interface PdfParserConfig {
  approved: boolean;
  url: string | null;
  version: string;
  timeoutMs: number;
}

export interface BusinessImportProcessorDependencies {
  prisma: PrismaClient;
  objectStore: KnowledgeObjectStore | null;
  objectEncryptionKeyId: string;
  scanner: BusinessImportFileScanner | null;
  maxFileBytes: number;
  maxPendingPerTenant: number;
  scannerTimeoutMs: number;
  pdfParser: PdfParserConfig;
  now: () => Date;
  id: () => string;
  retentionMs: number;
}

export class BusinessImportProcessorError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly stage: BusinessImportStage,
    readonly rejection = false,
    readonly canMutateImportOnFailure = true,
  ) {
    super(code);
    this.name = "BusinessImportProcessorError";
  }
}

type BusinessImportMappingNumberFormat = "DECIMAL_DOT" | "DECIMAL_COMMA";

interface ImportSnapshot {
  mode: "INITIAL" | "MAPPED";
  tenantId: string;
  sourceId: string;
  sourceLineageId: string;
  importId: string;
  generation: number;
  format: "CSV" | "XLSX" | "PDF";
  originalFilename: string;
  declaredMimeType: string;
  expectedByteSize: number;
  stagingObjectKey: string | null;
  stagingEncryptionKeyRef: string | null;
  stagingObjectLedgerId: string | null;
  artifact: ArtifactSnapshot | null;
  mapping: {
    id: string;
    revision: number;
    tableKey: string;
    schemaHash: string;
    headerRow: number;
    sourceGeneration: number;
    parsedRevisionId: string;
    parsedManifestHash: string;
    columns: Array<{ sourceColumnKey: string; target: string }>;
    defaults: {
      locale: string | null;
      numberFormat: BusinessImportMappingNumberFormat | null;
      currency: string | null;
      timezone: string | null;
      unit: string | null;
    };
  } | null;
  requestedByUserId: string;
}

interface StagingObjectReference {
  tenantId: string;
  stagingObjectKey: string;
  stagingEncryptionKeyRef: string;
  stagingObjectLedgerId: string;
}

function stagingObjectReference(snapshot: ImportSnapshot): StagingObjectReference | null {
  if (
    !snapshot.stagingObjectKey ||
    !snapshot.stagingEncryptionKeyRef ||
    !snapshot.stagingObjectLedgerId
  ) {
    return null;
  }
  return {
    tenantId: snapshot.tenantId,
    stagingObjectKey: snapshot.stagingObjectKey,
    stagingEncryptionKeyRef: snapshot.stagingEncryptionKeyRef,
    stagingObjectLedgerId: snapshot.stagingObjectLedgerId,
  };
}

interface ArtifactSnapshot {
  id: string;
  sha256: string;
  objectKey: string;
  encryptionKeyRef: string;
}

interface PdfWord {
  text: string;
  box: [number, number, number, number];
  confidence: number;
}

interface PdfPage {
  pageNumber: number;
  width: number;
  height: number;
  source: "NATIVE" | "OCR" | "UNREADABLE";
  words: PdfWord[];
  characterCount: number;
}

interface PdfExtraction {
  contractVersion: typeof PDF_EXTRACTION_CONTRACT_VERSION;
  parser: { version: string; ocrLanguages: string | null };
  document: { sha256: string; pageCount: number; pdfVersion: string };
  pages: PdfPage[];
  counts: {
    characters: number;
    words: number;
    ocrPages: number;
    ocrPixels: number;
  };
  warnings: string[];
}

interface ParseMetrics {
  expandedBytes: number;
  sheetCount: number;
  rowCount: number;
  columnCount: number;
  cellCount: number;
  pdfPageCount: number;
  ocrPageCount: number;
  ocrPixels: number;
  extractedCharacters: number;
}

interface ParsedImport {
  state: "READY_FOR_REVIEW" | "MAPPING_REQUIRED";
  parserVersion: string;
  ocrVersion: string | null;
  schemaVersion: string;
  schemaHash: string;
  manifest: unknown;
  rows: ParsedBusinessServiceRow[];
  diagnostics: BusinessImportDiagnostic[];
  metrics: ParseMetrics;
}

interface PreparedEvidence {
  id: string;
  field: BusinessServiceCsvHeader;
  sourceRow: number;
  ledgerId: string;
  bytes: Uint8Array;
  sourceValueHash: string;
  excerptHash: string;
  objectKey: string;
  write: KnowledgeObjectWriteResult;
  locator: Prisma.InputJsonObject;
  semanticElementId: string;
  semanticTableId: string | null;
}

interface PreparedCandidate {
  id: string;
  candidateKey: string;
  semanticTargetKey: string;
  action: BusinessServiceDiffCandidate["action"];
  normalizedValue: Prisma.InputJsonObject;
  normalizedValueHash: string;
  fieldProvenance: Prisma.InputJsonObject;
  targetOfferingId: string | null;
  currentFingerprint: string | null;
  risk: BusinessServiceDiffCandidate["riskLevel"];
  confidence: BusinessServiceDiffCandidate["confidence"];
  validationCodes: Prisma.InputJsonArray;
  reasonCodes: Prisma.InputJsonArray;
  requiresApproval: boolean;
  requiredPermission: string;
  evidence: PreparedEvidence[];
}

interface PreparedPublication {
  parsed: ParsedImport;
  manifestBytes: Uint8Array;
  manifestHash: string;
  manifestObjectKey: string;
  manifestLedgerId: string;
  manifestWrite: KnowledgeObjectWriteResult;
  candidates: PreparedCandidate[];
  retainedBytes: number;
}

function validCuid(value: unknown): value is string {
  return typeof value === "string" && /^c[a-z0-9]{20,30}$/u.test(value);
}

function validOpaqueId(value: unknown): value is string {
  return (
    validCuid(value) ||
    (typeof value === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value))
  );
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isBusinessImportRuntimeData(
  data: Record<string, unknown>,
): data is BusinessImportRuntimeData {
  return (
    Object.keys(data).length === runtimeDataKeys.size &&
    Object.keys(data).every((key) => runtimeDataKeys.has(key)) &&
    validCuid(data.tenantId) &&
    validOpaqueId(data.sourceId) &&
    validOpaqueId(data.importId) &&
    validCuid(data.requestedByUserId) &&
    validOpaqueId(data.runtimeEventId) &&
    typeof data.generation === "number" &&
    Number.isInteger(data.generation) &&
    data.generation > 0 &&
    data.operation === "PARSE" &&
    validIsoTimestamp(data.requestedAt) &&
    data.runtimeGeneration === data.generation
  );
}

function hash(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalBusinessImportJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function persistedParseRuntimeData(data: BusinessImportRuntimeData) {
  return {
    tenantId: data.tenantId,
    sourceId: data.sourceId,
    importId: data.importId,
    generation: data.generation,
    operation: data.operation,
    requestedByUserId: data.requestedByUserId,
    requestedAt: data.requestedAt,
  };
}

export function businessImportRuntimeEnvelopeMatches(
  payload: Prisma.JsonValue | null,
  data: BusinessImportRuntimeData,
  jobId: string,
) {
  let envelope;
  try {
    envelope = parseRuntimeQueueEnvelope(payload);
  } catch {
    return false;
  }
  return (
    envelope.queueName === "business.import" &&
    envelope.jobName === "parse" &&
    envelope.jobId === jobId &&
    envelope.attempts === 5 &&
    envelope.backoffMs === 2_000 &&
    canonicalBusinessImportJson(envelope.data) ===
      canonicalBusinessImportJson(persistedParseRuntimeData(data))
  );
}

function jsonObject(value: unknown): Prisma.InputJsonObject {
  const parsed = JSON.parse(JSON.stringify(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_NORMALIZED_VALUE_INVALID",
      false,
      "PARSING",
    );
  }
  return parsed;
}

function jsonArray(value: unknown[]): Prisma.InputJsonArray {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonArray;
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function businessImportXlsxSandboxApproved(value: string | undefined) {
  return enabled(value);
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function assertNotAborted(signal: AbortSignal, stage: BusinessImportStage) {
  if (signal.aborted) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_PROCESSING_INTERRUPTED", true, stage);
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const businessImportMappingTargets = new Set([
  "IGNORE",
  "external_id",
  "category",
  "name",
  "description",
  "price",
  "price_type",
  "price_amount",
  "price_from",
  "price_to",
  "currency",
  "price_unit",
  "tax_note",
  "duration",
  "duration_minutes",
  "duration_max_minutes",
  "location_external_id",
  "booking_notes",
  "active",
  "valid_from",
  "valid_until",
  "language",
]);
const decimalCommaLanguages = new Set(["de", "es", "fr", "it", "pt", "ru", "uk"]);

function legacyMappingNumberFormat(
  locale: string | null,
): BusinessImportMappingNumberFormat | null {
  if (!locale) return null;
  return decimalCommaLanguages.has(locale.toLowerCase().split("-")[0] ?? "")
    ? "DECIMAL_COMMA"
    : "DECIMAL_DOT";
}

function confirmedMappingPayload(value: unknown) {
  const payload = record(value);
  if (
    (payload.version !== 1 && payload.version !== 2) ||
    typeof payload.sourceGeneration !== "number" ||
    !Number.isInteger(payload.sourceGeneration) ||
    payload.sourceGeneration < 1 ||
    !validOpaqueId(payload.parsedRevisionId) ||
    typeof payload.parsedManifestHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(payload.parsedManifestHash) ||
    !Array.isArray(payload.columns) ||
    payload.columns.length < 1 ||
    payload.columns.length > 100
  ) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_MAPPING_INVALID", false, "VALIDATION");
  }
  const numberFormat: BusinessImportMappingNumberFormat | null | undefined =
    payload.version === 1
      ? null
      : payload.numberFormat === null ||
          payload.numberFormat === "DECIMAL_DOT" ||
          payload.numberFormat === "DECIMAL_COMMA"
        ? payload.numberFormat
        : undefined;
  if (numberFormat === undefined) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_MAPPING_INVALID", false, "VALIDATION");
  }
  const seenColumns = new Set<string>();
  const seenTargets = new Set<string>();
  const columns = payload.columns.map((entry) => {
    const column = record(entry);
    const sourceColumnKey =
      typeof column.sourceColumnKey === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(column.sourceColumnKey)
        ? column.sourceColumnKey
        : null;
    const target =
      typeof column.target === "string" && businessImportMappingTargets.has(column.target)
        ? column.target
        : null;
    if (
      !sourceColumnKey ||
      !target ||
      seenColumns.has(sourceColumnKey) ||
      (target !== "IGNORE" && seenTargets.has(target))
    ) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_MAPPING_INVALID",
        false,
        "VALIDATION",
      );
    }
    seenColumns.add(sourceColumnKey);
    if (target !== "IGNORE") seenTargets.add(target);
    return { sourceColumnKey, target };
  });
  if (!seenTargets.has("name")) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_MAPPING_NAME_REQUIRED",
      false,
      "VALIDATION",
    );
  }
  return {
    version: payload.version,
    sourceGeneration: payload.sourceGeneration,
    parsedRevisionId: payload.parsedRevisionId,
    parsedManifestHash: payload.parsedManifestHash,
    numberFormat,
    columns,
  };
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

export function validatePdfExtraction(value: unknown, input: { sha256: string; version: string }) {
  const wrapper = record(value);
  const source = record(wrapper.data);
  const parser = record(source.parser);
  const document = record(source.document);
  const counts = record(source.counts);
  if (
    source.contractVersion !== PDF_EXTRACTION_CONTRACT_VERSION ||
    parser.version !== input.version ||
    document.sha256 !== input.sha256
  ) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_CONTRACT_INVALID",
      false,
      "EXTRACTING",
    );
  }
  const pageCount = boundedInteger(document.pageCount, 1, 100);
  const pdfVersion = boundedString(document.pdfVersion, 32);
  const ocrLanguages =
    parser.ocrLanguages === null ? null : boundedString(parser.ocrLanguages, 160);
  if (
    !pageCount ||
    pdfVersion === null ||
    (ocrLanguages === null && parser.ocrLanguages !== null)
  ) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
      false,
      "EXTRACTING",
    );
  }
  if (!Array.isArray(source.pages) || source.pages.length !== pageCount) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
      false,
      "EXTRACTING",
    );
  }
  let characterCount = 0;
  let wordCount = 0;
  let ocrPageCount = 0;
  const pages = source.pages.map((entry, index): PdfPage => {
    const page = record(entry);
    const pageNumber = boundedInteger(page.pageNumber, 1, pageCount);
    const width = finiteNumber(page.width, 1, 100_000);
    const height = finiteNumber(page.height, 1, 100_000);
    const pageSource = ["NATIVE", "OCR", "UNREADABLE"].includes(String(page.source))
      ? (page.source as PdfPage["source"])
      : null;
    if (
      pageNumber !== index + 1 ||
      width === null ||
      height === null ||
      !pageSource ||
      !Array.isArray(page.words)
    ) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
        false,
        "EXTRACTING",
      );
    }
    const words = page.words.map((wordValue): PdfWord => {
      const word = record(wordValue);
      const text = boundedString(word.text, 8_192);
      const confidence = finiteNumber(word.confidence, 0, 1);
      if (!text || confidence === null || !Array.isArray(word.box) || word.box.length !== 4) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
          false,
          "EXTRACTING",
        );
      }
      const box = word.box.map((coordinate) => finiteNumber(coordinate, 0, 100_000));
      if (box.some((coordinate) => coordinate === null)) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
          false,
          "EXTRACTING",
        );
      }
      const exact = box as [number, number, number, number];
      if (exact[0] > exact[2] || exact[1] > exact[3] || exact[2] > width || exact[3] > height) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
          false,
          "EXTRACTING",
        );
      }
      characterCount += text.length;
      wordCount += 1;
      if (characterCount > 1_000_000 || wordCount > 250_000) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_LIMIT",
          false,
          "EXTRACTING",
        );
      }
      return { text, box: exact, confidence };
    });
    const expectedCharacters = words.reduce((total, word) => total + word.text.length, 0);
    if (
      page.characterCount !== expectedCharacters ||
      (pageSource === "UNREADABLE" && words.length)
    ) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
        false,
        "EXTRACTING",
      );
    }
    if (pageSource === "OCR") ocrPageCount += 1;
    return {
      pageNumber,
      width,
      height,
      source: pageSource,
      words,
      characterCount: expectedCharacters,
    };
  });
  const ocrPixels = boundedInteger(counts.ocrPixels, 0, 50_000_000);
  if (
    counts.characters !== characterCount ||
    counts.words !== wordCount ||
    counts.ocrPages !== ocrPageCount ||
    ocrPixels === null
  ) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
      false,
      "EXTRACTING",
    );
  }
  const warnings = Array.isArray(source.warnings)
    ? source.warnings
        .map((warning) => boundedString(warning, 160))
        .filter((warning): warning is string => warning !== null)
        .slice(0, 200)
    : [];
  if (Array.isArray(source.warnings) && warnings.length !== source.warnings.length) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
      false,
      "EXTRACTING",
    );
  }
  return {
    contractVersion: PDF_EXTRACTION_CONTRACT_VERSION,
    parser: { version: input.version, ocrLanguages },
    document: { sha256: input.sha256, pageCount, pdfVersion },
    pages,
    counts: { characters: characterCount, words: wordCount, ocrPages: ocrPageCount, ocrPixels },
    warnings,
  } satisfies PdfExtraction;
}

async function readBoundedResponse(response: Response, signal: AbortSignal) {
  if (!response.body) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
      false,
      "EXTRACTING",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      assertNotAborted(signal, "EXTRACTING");
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_PDF_OUTPUT_BYTES) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_LIMIT",
          false,
          "EXTRACTING",
        );
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_OUTPUT_INVALID",
      false,
      "EXTRACTING",
    );
  }
}

async function extractPdf(
  bytes: Uint8Array,
  sha256: string,
  config: PdfParserConfig,
  signal: AbortSignal,
) {
  if (!config.approved || !config.url || config.version === "unconfigured") {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_UNAVAILABLE",
      true,
      "EXTRACTING",
    );
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetch(`${config.url}/v1/pdf/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "X-LeadVirt-OCR": "true",
      },
      body: Buffer.from(bytes),
      signal: combined,
    });
  } catch {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_PDF_PARSER_UNAVAILABLE",
      true,
      "EXTRACTING",
    );
  }
  if (!response.ok) {
    const retryable = businessImportPdfParserRetryableStatus(response.status);
    throw new BusinessImportProcessorError(
      retryable ? "BUSINESS_IMPORT_PDF_PARSER_UNAVAILABLE" : "BUSINESS_IMPORT_PDF_PARSER_REJECTED",
      retryable,
      "EXTRACTING",
    );
  }
  const payload = await readBoundedResponse(response, combined);
  return validatePdfExtraction(payload, { sha256, version: config.version });
}

export function businessImportPdfParserRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function emptyMetrics(): ParseMetrics {
  return {
    expandedBytes: 0,
    sheetCount: 0,
    rowCount: 0,
    columnCount: 0,
    cellCount: 0,
    pdfPageCount: 0,
    ocrPageCount: 0,
    ocrPixels: 0,
    extractedCharacters: 0,
  };
}

function evidenceMetrics(rows: ParsedBusinessServiceRow[]) {
  const values = rows.flatMap((row) => Object.values(row.evidence).filter(Boolean));
  return {
    cellCount: values.length,
    extractedCharacters: values.reduce((total, value) => total + value.sourceValue.length, 0),
  };
}

function mappingRequiredError(error: unknown) {
  return (
    (error instanceof BusinessServicesCsvError || error instanceof BusinessServicesXlsxError) &&
    [
      "BUSINESS_IMPORT_CSV_DUPLICATE_COLUMN",
      "BUSINESS_IMPORT_CSV_NAME_COLUMN_REQUIRED",
      "BUSINESS_IMPORT_XLSX_DUPLICATE_COLUMN",
      "BUSINESS_IMPORT_XLSX_NAME_COLUMN_REQUIRED",
      "BUSINESS_IMPORT_XLSX_SERVICES_SHEET_REQUIRED",
    ].includes(error.code)
  );
}

function mappingRequiredResult(
  snapshot: ImportSnapshot,
  error: BusinessServicesCsvError | BusinessServicesXlsxError,
): ParsedImport {
  const parserVersion =
    snapshot.format === "CSV" ? CSV_PARSER_VERSION : "leadvirt.xlsx.services.v1";
  const diagnostic: BusinessImportDiagnostic = {
    severity: "WARNING",
    code: error.code,
    message: "The file requires a confirmed column mapping before review.",
  };
  return {
    state: "MAPPING_REQUIRED",
    parserVersion,
    ocrVersion: null,
    schemaVersion: "leadvirt.services.v1",
    schemaHash: hash(`mapping-required\0${snapshot.format}\0${error.code}`),
    manifest: {
      contractVersion: EXTRACTION_CONTRACT_VERSION,
      format: snapshot.format,
      status: "MAPPING_REQUIRED",
      diagnostics: [diagnostic, ...error.diagnostics].slice(0, 100),
    },
    rows: [],
    diagnostics: [diagnostic, ...error.diagnostics].slice(0, 100),
    metrics: emptyMetrics(),
  };
}

function csvMappingRequiredResult(
  snapshot: ImportSnapshot,
  analysis: Awaited<ReturnType<typeof analyzeBusinessServicesCsv>>,
  proposal: ReturnType<typeof proposeBusinessServiceMapping>,
): ParsedImport {
  const diagnostic: BusinessImportDiagnostic = {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_MAPPING_CONFIRMATION_REQUIRED",
    message: "Confirm how the source columns map to service information.",
  };
  return {
    state: "MAPPING_REQUIRED",
    parserVersion: CSV_PARSER_VERSION,
    ocrVersion: null,
    schemaVersion: BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
    schemaHash: analysis.schemaHash,
    manifest: {
      contractVersion: EXTRACTION_CONTRACT_VERSION,
      format: "CSV",
      status: "MAPPING_REQUIRED",
      parserVersion: CSV_PARSER_VERSION,
      schemaHash: analysis.schemaHash,
      analysis,
      proposal,
      diagnostics: [diagnostic],
    },
    rows: [],
    diagnostics: [diagnostic],
    metrics: {
      ...emptyMetrics(),
      sheetCount: 1,
      rowCount: analysis.rowCount,
      columnCount: analysis.columns.length,
      cellCount: analysis.rowCount * analysis.columns.length,
      extractedCharacters: analysis.columns.reduce(
        (total, column) =>
          total +
          column.samples.reduce((sampleTotal, sample) => sampleTotal + sample.value.length, 0),
        0,
      ),
    },
  };
}

async function parseAcceptedFile(
  snapshot: ImportSnapshot,
  accepted: AcceptedBusinessImportFile,
  dependencies: BusinessImportProcessorDependencies,
  signal: AbortSignal,
): Promise<ParsedImport> {
  try {
    if (snapshot.format === "CSV") {
      const analysis = await analyzeBusinessServicesCsv(accepted.bytes, {
        maxBytes: dependencies.maxFileBytes,
      });
      const proposal = proposeBusinessServiceMapping(analysis);
      if (snapshot.mode === "INITIAL" && !isExactBusinessServicesCsvContract(analysis, proposal)) {
        return csvMappingRequiredResult(snapshot, analysis, proposal);
      }
      const confirmedMapping: ConfirmedBusinessServiceMapping | null = snapshot.mapping
        ? {
            tableKey: snapshot.mapping.tableKey,
            schemaHash: snapshot.mapping.schemaHash,
            headerRow: snapshot.mapping.headerRow,
            columns: snapshot.mapping.columns.map((column) => ({
              sourceColumnKey: column.sourceColumnKey,
              target: column.target as BusinessServiceMappingTarget,
            })),
            defaults: snapshot.mapping.defaults,
          }
        : null;
      const parsed = confirmedMapping
        ? await parseMappedBusinessServicesCsv(accepted.bytes, confirmedMapping, {
            maxBytes: dependencies.maxFileBytes,
          })
        : await parseBusinessServicesCsv(accepted.bytes, {
            maxBytes: dependencies.maxFileBytes,
          });
      const evidence = evidenceMetrics(parsed.rows);
      const schemaHash = analysis.schemaHash;
      return {
        state: "READY_FOR_REVIEW",
        parserVersion: CSV_PARSER_VERSION,
        ocrVersion: null,
        schemaVersion: parsed.schemaVersion,
        schemaHash,
        manifest: {
          contractVersion: EXTRACTION_CONTRACT_VERSION,
          format: "CSV",
          parserVersion: CSV_PARSER_VERSION,
          schemaHash,
          parsed,
          ...(snapshot.mapping
            ? {
                mapping: {
                  id: snapshot.mapping.id,
                  revision: snapshot.mapping.revision,
                  tableKey: snapshot.mapping.tableKey,
                  schemaHash: snapshot.mapping.schemaHash,
                },
              }
            : {}),
        },
        rows: parsed.rows,
        diagnostics: parsed.diagnostics,
        metrics: {
          ...emptyMetrics(),
          sheetCount: 1,
          rowCount: parsed.counts.totalRows,
          columnCount: analysis.columns.length,
          cellCount: parsed.counts.totalRows * analysis.columns.length,
          extractedCharacters: evidence.extractedCharacters,
        },
      };
    }
    if (snapshot.format === "XLSX") {
      const parsed = parseBusinessServicesXlsx(accepted, {
        maxBytes: dependencies.maxFileBytes,
      });
      const evidence = evidenceMetrics(parsed.rows);
      const schemaHash = hash(
        canonicalBusinessImportJson(
          parsed.sheets.map((sheet) => ({ name: sheet.name, headers: sheet.headers })),
        ),
      );
      return {
        state: "READY_FOR_REVIEW",
        parserVersion: parsed.parserVersion,
        ocrVersion: null,
        schemaVersion: parsed.schemaVersion,
        schemaHash,
        manifest: {
          contractVersion: EXTRACTION_CONTRACT_VERSION,
          format: "XLSX",
          parserVersion: parsed.parserVersion,
          schemaHash,
          parsed,
        },
        rows: parsed.rows,
        diagnostics: parsed.diagnostics,
        metrics: {
          ...emptyMetrics(),
          sheetCount: parsed.counts.sheetCount,
          rowCount: parsed.counts.workbookRows,
          columnCount: Math.max(0, ...parsed.sheets.map((sheet) => sheet.headers.length)),
          cellCount: parsed.sheets.reduce(
            (total, sheet) => total + sheet.rowCount * sheet.headers.length,
            0,
          ),
          extractedCharacters: evidence.extractedCharacters,
        },
      };
    }
    const extracted = await extractPdf(
      accepted.bytes,
      accepted.provenance.sha256,
      dependencies.pdfParser,
      signal,
    );
    const diagnostic: BusinessImportDiagnostic = {
      severity: "WARNING",
      code: "BUSINESS_IMPORT_PDF_MAPPING_REQUIRED",
      message: "Confirm how the extracted PDF content maps to business information.",
    };
    return {
      state: "MAPPING_REQUIRED",
      parserVersion: extracted.parser.version,
      ocrVersion: extracted.counts.ocrPages > 0 ? extracted.parser.version : null,
      schemaVersion: "leadvirt.services.v1",
      schemaHash: hash(
        canonicalBusinessImportJson({
          contractVersion: extracted.contractVersion,
          pageCount: extracted.document.pageCount,
        }),
      ),
      manifest: {
        contractVersion: EXTRACTION_CONTRACT_VERSION,
        format: "PDF",
        status: "MAPPING_REQUIRED",
        extraction: extracted,
        diagnostics: [diagnostic],
      },
      rows: [],
      diagnostics: [diagnostic],
      metrics: {
        ...emptyMetrics(),
        pdfPageCount: extracted.document.pageCount,
        ocrPageCount: extracted.counts.ocrPages,
        ocrPixels: extracted.counts.ocrPixels,
        extractedCharacters: extracted.counts.characters,
      },
    };
  } catch (error) {
    if (mappingRequiredError(error)) {
      return mappingRequiredResult(
        snapshot,
        error as BusinessServicesCsvError | BusinessServicesXlsxError,
      );
    }
    if (error instanceof BusinessImportProcessorError) throw error;
    if (error instanceof BusinessServicesCsvError || error instanceof BusinessServicesXlsxError) {
      throw new BusinessImportProcessorError(error.code, false, "PARSING");
    }
    throw error;
  }
}

function offeringValue(row: ParsedBusinessServiceRow) {
  return {
    externalId: row.externalId,
    category: row.category,
    name: row.name,
    description: row.description,
    price: row.price,
    duration: row.duration,
    locationExternalId: row.locationExternalId,
    bookingNotes: row.bookingNotes,
    active: row.active,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    language: row.language,
  };
}

function diagnosticValue(value: BusinessImportDiagnostic) {
  return {
    severity: value.severity,
    code: value.code.slice(0, 160),
    message: value.message.slice(0, 500),
    ...(value.row !== undefined ? { row: value.row } : {}),
    ...(value.column !== undefined ? { column: value.column } : {}),
    ...(value.field !== undefined ? { field: value.field } : {}),
    ...(value.sheet !== undefined ? { sheet: value.sheet.slice(0, 160) } : {}),
    ...(value.cell !== undefined ? { cell: value.cell.slice(0, 160) } : {}),
    ...(value.range !== undefined ? { range: value.range.slice(0, 160) } : {}),
  };
}

function evidenceLocator(evidence: BusinessImportCellEvidence): Prisma.InputJsonObject {
  return evidence.format === "CSV"
    ? { row: evidence.row, column: evidence.column, header: evidence.header }
    : {
        sheet: evidence.sheet,
        cell: evidence.cell,
        range: evidence.range,
        row: evidence.row,
        column: evidence.column,
        header: evidence.header,
        cellType: evidence.cellType,
        cachedFormula: evidence.cachedFormula,
      };
}

export function businessImportEvidenceBytes(sourceValue: string) {
  const bytes = new TextEncoder().encode(sourceValue);
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_EVIDENCE_VALUE_LIMIT",
      false,
      "PARSING",
    );
  }
  const exactHash = hash(bytes);
  return { bytes, sourceValueHash: exactHash, excerptHash: exactHash };
}

async function putExactObject(
  store: KnowledgeObjectStore,
  key: string,
  value: Uint8Array,
  encryptionKeyId: string,
) {
  try {
    return await store.put(key, value);
  } catch (error) {
    if (!(error instanceof KnowledgeObjectStoreError) || error.code !== "OBJECT_EXISTS")
      throw error;
    const existing = await store.get(key, encryptionKeyId);
    if (existing.byteLength !== value.byteLength || hash(existing) !== hash(value)) {
      throw new KnowledgeObjectStoreError("OBJECT_CORRUPT");
    }
    return {
      key,
      encryptionKeyRef: encryptionKeyId,
      plaintextBytes: existing.byteLength,
      storedBytes: existing.byteLength,
    } satisfies KnowledgeObjectWriteResult;
  }
}

function pendingRetentionClass(snapshot: ImportSnapshot) {
  return `${PENDING_RETENTION_PREFIX}:${snapshot.importId}:${snapshot.generation}`;
}

function finalRetentionClass(objectKind: BusinessImportObjectKind) {
  switch (objectKind) {
    case "RAW_ARTIFACT":
      return "BUSINESS_IMPORT_RAW";
    case "PARSED_MANIFEST":
      return "BUSINESS_IMPORT_PARSED_MANIFEST";
    case "EVIDENCE_EXCERPT":
      return "BUSINESS_IMPORT_EVIDENCE";
    default:
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_OBJECT_KIND_INVALID",
        false,
        "PERSISTING",
      );
  }
}

function pendingRetainUntil(dependencies: BusinessImportProcessorDependencies) {
  const duration = Math.max(
    MIN_PENDING_RETENTION_MS,
    dependencies.pdfParser.timeoutMs + 15 * 60_000,
  );
  return new Date(dependencies.now().getTime() + duration);
}

async function reserveObjectLedgers(
  snapshot: ImportSnapshot,
  objectKind: BusinessImportObjectKind,
  items: ReadonlyArray<{ id: string; objectKey: string }>,
  dependencies: BusinessImportProcessorDependencies,
) {
  const byKey = new Map<string, string>();
  for (const item of items) {
    if (byKey.has(item.objectKey)) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
        false,
        "PERSISTING",
      );
    }
    byKey.set(item.objectKey, item.id);
  }
  if (!byKey.size) return new Map<string, string>();

  const objectStorageKeys = [...byKey.keys()];
  const retentionClass = pendingRetentionClass(snapshot);
  const retainUntil = pendingRetainUntil(dependencies);
  return dependencies.prisma.$transaction(
    async (tx) => {
      await tx.businessImportObjectLedger.createMany({
        data: objectStorageKeys.map((objectStorageKey) => ({
          id: byKey.get(objectStorageKey)!,
          tenantId: snapshot.tenantId,
          objectKind,
          objectStorageKey,
          encryptionKeyRef: dependencies.objectEncryptionKeyId,
          retentionClass,
          retainUntil,
        })),
        skipDuplicates: true,
      });
      const ledgers = await tx.businessImportObjectLedger.findMany({
        where: {
          tenantId: snapshot.tenantId,
          objectStorageKey: { in: objectStorageKeys },
        },
      });
      if (ledgers.length !== objectStorageKeys.length) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
          false,
          "PERSISTING",
        );
      }
      const durableRetentionClass = finalRetentionClass(objectKind);
      for (const ledger of ledgers) {
        if (
          ledger.objectKind !== objectKind ||
          ledger.encryptionKeyRef !== dependencies.objectEncryptionKeyId ||
          ledger.deletionState !== "RETAINED" ||
          (ledger.retentionClass !== durableRetentionClass &&
            !ledger.retentionClass.startsWith(`${PENDING_RETENTION_PREFIX}:`))
        ) {
          throw new BusinessImportProcessorError(
            "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
            false,
            "PERSISTING",
          );
        }
      }
      const pendingIds = ledgers
        .filter((ledger) => ledger.retentionClass.startsWith(`${PENDING_RETENTION_PREFIX}:`))
        .map((ledger) => ledger.id);
      if (pendingIds.length) {
        const adopted = await tx.businessImportObjectLedger.updateMany({
          where: {
            tenantId: snapshot.tenantId,
            id: { in: pendingIds },
            retentionClass: { startsWith: `${PENDING_RETENTION_PREFIX}:` },
            deletionState: "RETAINED",
          },
          data: { retentionClass, retainUntil, lastErrorCode: null },
        });
        if (adopted.count !== pendingIds.length) {
          throw new BusinessImportProcessorError(
            "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
            false,
            "PERSISTING",
          );
        }
      }
      return new Map(ledgers.map((ledger) => [ledger.objectStorageKey, ledger.id]));
    },
    { isolationLevel: "Serializable", timeout: 20_000 },
  );
}

export async function cleanupBusinessImportPendingLedgerRows(
  tenantId: string,
  ids: string[],
  dependencies: BusinessImportProcessorDependencies,
) {
  const store = dependencies.objectStore;
  if (!store || !ids.length) return;
  const now = dependencies.now();
  const staleDeletionClaim = new Date(now.getTime() - STALE_DELETION_CLAIM_MS);
  await dependencies.prisma.businessImportObjectLedger.updateMany({
    where: {
      tenantId,
      id: { in: ids },
      retentionClass: { startsWith: `${PENDING_RETENTION_PREFIX}:` },
      legalHold: false,
      deletionState: "RETAINED",
    },
    data: {
      deletionState: "TOMBSTONED",
      tombstoneReason: "UNREFERENCED_PENDING_OUTPUT",
      tombstonedAt: now,
    },
  });
  const rows = await dependencies.prisma.businessImportObjectLedger.findMany({
    where: {
      tenantId,
      id: { in: ids },
      retentionClass: { startsWith: `${PENDING_RETENTION_PREFIX}:` },
      legalHold: false,
      OR: [
        { deletionState: { in: ["TOMBSTONED", "FAILED"] } },
        {
          deletionState: "DELETING",
          deletionStartedAt: { lte: staleDeletionClaim },
        },
      ],
    },
    select: {
      id: true,
      objectStorageKey: true,
      deletionState: true,
      lastErrorCode: true,
    },
  });
  for (let offset = 0; offset < rows.length; offset += 8) {
    await Promise.all(
      rows.slice(offset, offset + 8).map(async (row) => {
        const claimToken = `BUSINESS_IMPORT_PENDING_DELETE_CLAIM:${dependencies.id()}`;
        const claimed = await dependencies.prisma.businessImportObjectLedger.updateMany({
          where: {
            id: row.id,
            tenantId,
            retentionClass: { startsWith: `${PENDING_RETENTION_PREFIX}:` },
            legalHold: false,
            deletionState: row.deletionState,
            lastErrorCode: row.lastErrorCode,
            ...(row.deletionState === "DELETING"
              ? { deletionStartedAt: { lte: staleDeletionClaim } }
              : {}),
          },
          data: {
            deletionState: "DELETING",
            ...(row.deletionState === "TOMBSTONED"
              ? { deletionStartedAt: dependencies.now() }
              : {}),
            lastErrorCode: claimToken,
          },
        });
        if (claimed.count !== 1) return;
        try {
          await store.delete(row.objectStorageKey);
          await dependencies.prisma.businessImportObjectLedger.updateMany({
            where: {
              id: row.id,
              tenantId,
              retentionClass: { startsWith: `${PENDING_RETENTION_PREFIX}:` },
              deletionState: "DELETING",
              lastErrorCode: claimToken,
            },
            data: {
              deletionState: "DELETED",
              deletedAt: dependencies.now(),
              lastErrorCode: null,
            },
          });
        } catch {
          await dependencies.prisma.businessImportObjectLedger
            .updateMany({
              where: {
                id: row.id,
                tenantId,
                retentionClass: { startsWith: `${PENDING_RETENTION_PREFIX}:` },
                deletionState: "DELETING",
                lastErrorCode: claimToken,
              },
              data: {
                deletionState: "FAILED",
                lastErrorCode: "BUSINESS_IMPORT_PENDING_OBJECT_DELETE_FAILED",
              },
            })
            .catch(() => undefined);
        }
      }),
    );
  }
}

async function cleanupCurrentPendingOutputs(
  snapshot: ImportSnapshot,
  dependencies: BusinessImportProcessorDependencies,
) {
  const staleDeletionClaim = new Date(dependencies.now().getTime() - STALE_DELETION_CLAIM_MS);
  const rows = await dependencies.prisma.businessImportObjectLedger.findMany({
    where: {
      tenantId: snapshot.tenantId,
      retentionClass: pendingRetentionClass(snapshot),
      legalHold: false,
      OR: [
        { deletionState: { in: ["RETAINED", "TOMBSTONED", "FAILED"] } },
        {
          deletionState: "DELETING",
          OR: [{ deletionStartedAt: null }, { deletionStartedAt: { lte: staleDeletionClaim } }],
        },
      ],
    },
    select: { id: true },
    take: MAX_PENDING_CLEANUP_BATCH,
  });
  await cleanupBusinessImportPendingLedgerRows(
    snapshot.tenantId,
    rows.map((row) => row.id),
    dependencies,
  );
}

async function cleanupExpiredPendingOutputs(
  snapshot: ImportSnapshot,
  dependencies: BusinessImportProcessorDependencies,
) {
  const now = dependencies.now();
  const staleDeletionClaim = new Date(now.getTime() - STALE_DELETION_CLAIM_MS);
  const rows = await dependencies.prisma.businessImportObjectLedger.findMany({
    where: {
      tenantId: snapshot.tenantId,
      retentionClass: {
        startsWith: `${PENDING_RETENTION_PREFIX}:`,
        not: pendingRetentionClass(snapshot),
      },
      legalHold: false,
      OR: [
        { deletionState: { in: ["RETAINED", "TOMBSTONED", "FAILED"] } },
        {
          deletionState: "DELETING",
          OR: [{ deletionStartedAt: null }, { deletionStartedAt: { lte: staleDeletionClaim } }],
        },
      ],
      retainUntil: { lte: now },
    },
    select: { id: true },
    orderBy: { retainUntil: "asc" },
    take: MAX_PENDING_CLEANUP_BATCH,
  });
  await cleanupBusinessImportPendingLedgerRows(
    snapshot.tenantId,
    rows.map((row) => row.id),
    dependencies,
  );
}

async function beginImport(
  input: BusinessImportJobInput,
  dependencies: BusinessImportProcessorDependencies,
): Promise<ImportSnapshot | BusinessImportProcessorResult> {
  return dependencies.prisma.$transaction(
    async (tx) => {
      const runtimeEvent = await tx.runtimeOutbox.findFirst({
        where: { id: input.data.runtimeEventId, tenantId: input.data.tenantId },
      });
      const runtimeEventMatches =
        runtimeEvent !== null &&
        runtimeEvent.aggregateType === "business-import" &&
        runtimeEvent.aggregateId === input.data.importId &&
        runtimeEvent.aggregateVersion === input.data.generation &&
        runtimeEvent.generation === input.data.runtimeGeneration &&
        runtimeEvent.eventType === "business.import.parse.requested" &&
        runtimeEvent.schemaVersion === 1 &&
        runtimeEvent.dedupeKey === input.id &&
        runtimeEvent.payloadRef === null &&
        ["PUBLISHING", "PUBLISHED", "FAILED"].includes(runtimeEvent.status) &&
        businessImportRuntimeEnvelopeMatches(runtimeEvent.payload, input.data, input.id);
      if (!runtimeEvent || !runtimeEventMatches) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_RUNTIME_OUTBOX_FENCE_INVALID",
          false,
          "VALIDATION",
          false,
          false,
        );
      }
      if (!runtimeEvent.deadlineAt || runtimeEvent.deadlineAt <= dependencies.now()) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_RUNTIME_EVENT_EXPIRED",
          false,
          "VALIDATION",
        );
      }
      await tx.$queryRaw(Prisma.sql`
        SELECT TRUE AS "locked"
        FROM (SELECT pg_advisory_xact_lock(hashtextextended(
          ${`business-information-state:${input.data.tenantId}`},
          0
        ))) AS business_information_state_lock
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "BusinessImport"
        WHERE "tenantId" = ${input.data.tenantId} AND "id" = ${input.data.importId}
        FOR UPDATE
      `);
      const value = await tx.businessImport.findFirst({
        where: { id: input.data.importId, tenantId: input.data.tenantId },
        include: {
          source: true,
          stagingObjectLedger: true,
          artifact: { include: { objectLedger: true } },
          mappings: {
            where: {
              confirmedAt: { not: null },
              targetCategory: "OFFERINGS",
              tableKey: "csv:services",
            },
            orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
            take: 1,
          },
        },
      });
      if (!value || value.sourceId !== input.data.sourceId) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_JOB_REFERENCE_INVALID",
          false,
          "VALIDATION",
        );
      }
      if (value.generation !== input.data.generation) {
        return {
          status: "cancelled",
          importId: value.id,
          generation: input.data.generation,
          reason: "stale_generation",
        };
      }
      if (
        ["READY_FOR_REVIEW", "MAPPING_REQUIRED"].includes(value.state) &&
        value.parsedRevisionId &&
        value.parsedManifestHash
      ) {
        return {
          status: "already_succeeded",
          importId: value.id,
          generation: value.generation,
          state: value.state as "READY_FOR_REVIEW" | "MAPPING_REQUIRED",
        };
      }
      if (
        [
          "CANCELLED",
          "REJECTED",
          "FAILED",
          "EXPIRED",
          "APPLIED",
          "PARTIALLY_APPLIED",
          "CLOSED_WITH_REMAINDER",
        ].includes(value.state)
      ) {
        return {
          status: "cancelled",
          importId: value.id,
          generation: value.generation,
          reason: "terminal_replay",
        };
      }
      const membership = await tx.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: input.data.tenantId,
            userId: input.data.requestedByUserId,
          },
        },
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
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_ACTOR_NOT_AUTHORIZED",
          false,
          "VALIDATION",
        );
      }
      if (
        !activeProcessingStates.includes(value.state as (typeof activeProcessingStates)[number]) ||
        value.source.status !== "ACTIVE" ||
        value.purpose !== "SERVICES" ||
        !Array.isArray(value.selectedCategories) ||
        !value.selectedCategories.includes("OFFERINGS") ||
        value.expectedByteSize <= 0n ||
        value.expectedByteSize > BigInt(dependencies.maxFileBytes)
      ) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_JOB_STATE_INVALID",
          false,
          "VALIDATION",
        );
      }
      const hasInitialStaging =
        Boolean(value.stagingObjectKey) &&
        Boolean(value.stagingEncryptionKeyRef) &&
        Boolean(value.stagingObjectLedgerId) &&
        value.stagingObjectKind === "STAGING" &&
        value.stagingObjectLedger?.objectKind === "STAGING" &&
        value.stagingObjectLedger.objectStorageKey === value.stagingObjectKey &&
        value.stagingObjectLedger.encryptionKeyRef === value.stagingEncryptionKeyRef &&
        value.stagingObjectLedger.deletionState === "RETAINED";
      const mappingRecord = value.mappings[0] ?? null;
      const mappingPayload = mappingRecord
        ? confirmedMappingPayload(mappingRecord.fieldMappings)
        : null;
      const mappingSourceRevision =
        mappingRecord && mappingPayload && value.artifactId && value.artifactSha256
          ? await tx.businessImportParsedRevision.findFirst({
              where: {
                id: mappingPayload.parsedRevisionId,
                tenantId: value.tenantId,
                sourceId: value.sourceId,
                importId: value.id,
                importGeneration: mappingPayload.sourceGeneration,
                artifactId: value.artifactId,
                artifactSha256: value.artifactSha256,
                manifestHash: mappingPayload.parsedManifestHash,
              },
              select: { id: true },
            })
          : null;
      const hasMappedArtifact =
        Boolean(mappingRecord) &&
        mappingRecord?.targetCategory === "OFFERINGS" &&
        mappingRecord.headerRow !== null &&
        typeof mappingPayload?.sourceGeneration === "number" &&
        mappingPayload.sourceGeneration < value.generation &&
        Boolean(mappingSourceRevision) &&
        Boolean(value.artifactId) &&
        Boolean(value.artifactSha256) &&
        value.artifact?.id === value.artifactId &&
        value.artifact.sha256 === value.artifactSha256 &&
        value.artifact.byteSize === value.expectedByteSize &&
        value.artifact.malwareStatus === "CLEAN" &&
        value.artifact.mimeValidationStatus === "VALID" &&
        value.artifact.objectKind === "RAW_ARTIFACT" &&
        value.artifact.objectLedger.objectKind === "RAW_ARTIFACT" &&
        value.artifact.objectLedger.objectStorageKey === value.artifact.objectStorageKey &&
        value.artifact.objectLedger.encryptionKeyRef === value.artifact.encryptionKeyRef &&
        value.artifact.objectLedger.deletionState === "RETAINED";
      const mode =
        hasInitialStaging && !mappingRecord
          ? ("INITIAL" as const)
          : !hasInitialStaging && hasMappedArtifact
            ? ("MAPPED" as const)
            : null;
      if (!mode) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_JOB_STATE_INVALID",
          false,
          "VALIDATION",
        );
      }
      if (value.state === "FAILED_RETRYABLE") {
        const activeImports = await tx.businessImport.count({
          where: {
            tenantId: value.tenantId,
            id: { not: value.id },
            state: { in: [...capacityStates] },
          },
        });
        if (activeImports >= dependencies.maxPendingPerTenant) {
          throw new BusinessImportProcessorError(
            "BUSINESS_IMPORT_PENDING_QUOTA_EXCEEDED",
            true,
            "VALIDATION",
          );
        }
        await tx.businessImport.update({
          where: { id: value.id },
          data: {
            state: mode === "INITIAL" ? "SCANNING" : "PARSING",
            failureCode: null,
            failureStage: null,
            retryable: false,
            etag: { increment: 1 },
          },
        });
      }
      const mapping =
        mode === "MAPPED" && mappingRecord && mappingPayload
          ? {
              id: mappingRecord.id,
              revision: mappingRecord.revision,
              tableKey: mappingRecord.tableKey,
              schemaHash: mappingRecord.schemaHash,
              headerRow: mappingRecord.headerRow!,
              sourceGeneration: mappingPayload.sourceGeneration,
              parsedRevisionId: mappingPayload.parsedRevisionId,
              parsedManifestHash: mappingPayload.parsedManifestHash,
              columns: mappingPayload.columns,
              defaults: {
                locale: mappingRecord.defaultLocale,
                numberFormat:
                  mappingPayload.version === 1
                    ? legacyMappingNumberFormat(mappingRecord.defaultLocale)
                    : mappingPayload.numberFormat,
                currency: mappingRecord.defaultCurrency,
                timezone: mappingRecord.defaultTimezone,
                unit: mappingRecord.defaultUnit,
              },
            }
          : null;
      return {
        mode,
        tenantId: value.tenantId,
        sourceId: value.sourceId,
        sourceLineageId: value.source.lineageKey,
        importId: value.id,
        generation: value.generation,
        format: value.format,
        originalFilename: value.originalFilename,
        declaredMimeType: value.declaredMimeType,
        expectedByteSize: Number(value.expectedByteSize),
        stagingObjectKey: value.stagingObjectKey,
        stagingEncryptionKeyRef: value.stagingEncryptionKeyRef,
        stagingObjectLedgerId: value.stagingObjectLedgerId,
        artifact:
          mode === "MAPPED" && value.artifact
            ? {
                id: value.artifact.id,
                sha256: value.artifact.sha256,
                objectKey: value.artifact.objectStorageKey,
                encryptionKeyRef: value.artifact.encryptionKeyRef,
              }
            : null,
        mapping,
        requestedByUserId: input.data.requestedByUserId,
      } satisfies ImportSnapshot;
    },
    { isolationLevel: "Serializable", timeout: 20_000 },
  );
}

async function promoteArtifact(
  snapshot: ImportSnapshot,
  accepted: AcceptedBusinessImportFile,
  dependencies: BusinessImportProcessorDependencies,
) {
  const store = dependencies.objectStore;
  if (!store) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_STORAGE_UNAVAILABLE", true, "STORAGE");
  }
  const objectKey = createDeterministicKnowledgeObjectKey({
    tenantId: snapshot.tenantId,
    sourceId: snapshot.sourceId,
    purpose: "raw",
    identity: `business-import-artifact:${snapshot.importId}:${accepted.provenance.sha256}`,
  });
  const reservedLedgers = await reserveObjectLedgers(
    snapshot,
    "RAW_ARTIFACT",
    [{ id: dependencies.id(), objectKey }],
    dependencies,
  );
  const ledgerId = reservedLedgers.get(objectKey);
  if (!ledgerId) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
      false,
      "PERSISTING",
    );
  }
  const write = await putExactObject(
    store,
    objectKey,
    accepted.bytes,
    dependencies.objectEncryptionKeyId,
  );
  return dependencies.prisma.$transaction(
    async (tx): Promise<ArtifactSnapshot | null> => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "BusinessImport"
        WHERE "tenantId" = ${snapshot.tenantId} AND "id" = ${snapshot.importId}
        FOR UPDATE
      `);
      const current = await tx.businessImport.findFirst({
        where: { id: snapshot.importId, tenantId: snapshot.tenantId },
      });
      if (
        !current ||
        current.generation !== snapshot.generation ||
        !["SCANNING", "PARSING", "EXTRACTING"].includes(current.state)
      )
        return null;
      const existingLedger = await tx.businessImportObjectLedger.findUnique({
        where: {
          tenantId_objectStorageKey: { tenantId: snapshot.tenantId, objectStorageKey: objectKey },
        },
      });
      if (
        !existingLedger ||
        existingLedger.id !== ledgerId ||
        existingLedger.objectKind !== "RAW_ARTIFACT" ||
        existingLedger.encryptionKeyRef !== write.encryptionKeyRef ||
        existingLedger.deletionState !== "RETAINED"
      ) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
          false,
          "PERSISTING",
        );
      }
      const retainUntil = new Date(dependencies.now().getTime() + dependencies.retentionMs);
      await tx.businessImportObjectLedger.updateMany({
        where: {
          id: ledgerId,
          tenantId: snapshot.tenantId,
          objectKind: "RAW_ARTIFACT",
          objectStorageKey: objectKey,
          encryptionKeyRef: write.encryptionKeyRef,
          retentionClass: pendingRetentionClass(snapshot),
          deletionState: "RETAINED",
        },
        data: { retentionClass: "BUSINESS_IMPORT_RAW", retainUntil },
      });
      const ledger = await tx.businessImportObjectLedger.findUnique({ where: { id: ledgerId } });
      if (
        !ledger ||
        ledger.tenantId !== snapshot.tenantId ||
        ledger.objectKind !== "RAW_ARTIFACT" ||
        ledger.objectStorageKey !== objectKey ||
        ledger.encryptionKeyRef !== write.encryptionKeyRef ||
        ledger.retentionClass !== "BUSINESS_IMPORT_RAW" ||
        ledger.deletionState !== "RETAINED"
      ) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
          false,
          "PERSISTING",
        );
      }
      const existingArtifact = await tx.businessImportArtifact.findFirst({
        where: { tenantId: snapshot.tenantId, objectStorageKey: objectKey },
      });
      if (
        existingArtifact &&
        (existingArtifact.objectStorageKey !== objectKey ||
          existingArtifact.encryptionKeyRef !== write.encryptionKeyRef ||
          existingArtifact.objectLedgerId !== ledger.id ||
          existingArtifact.objectKind !== "RAW_ARTIFACT" ||
          existingArtifact.malwareStatus !== "CLEAN" ||
          existingArtifact.mimeValidationStatus !== "VALID")
      ) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_ARTIFACT_IDENTITY_CONFLICT",
          false,
          "PERSISTING",
        );
      }
      const now = dependencies.now();
      const artifact =
        existingArtifact ??
        (await tx.businessImportArtifact.create({
          data: {
            id: dependencies.id(),
            tenantId: snapshot.tenantId,
            sourceId: snapshot.sourceId,
            objectStorageKey: objectKey,
            encryptionKeyRef: write.encryptionKeyRef,
            objectLedgerId: ledger.id,
            objectKind: "RAW_ARTIFACT",
            sha256: accepted.provenance.sha256,
            byteSize: BigInt(accepted.provenance.byteSize),
            detectedMimeType: accepted.provenance.detectedMimeType,
            declaredMimeType: accepted.provenance.declaredMimeType,
            originalFilename: accepted.provenance.filename,
            malwareStatus: "CLEAN",
            mimeValidationStatus: "VALID",
            scannedAt: now,
          },
        }));
      if (
        current.artifactId &&
        (current.artifactId !== artifact.id || current.artifactSha256 !== artifact.sha256)
      ) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_ARTIFACT_IDENTITY_CONFLICT",
          false,
          "PERSISTING",
        );
      }
      await tx.businessImport.update({
        where: { id: current.id },
        data: {
          artifactId: artifact.id,
          artifactSha256: artifact.sha256,
          state: snapshot.format === "PDF" ? "EXTRACTING" : "PARSING",
          etag: { increment: 1 },
        },
      });
      return {
        id: artifact.id,
        sha256: artifact.sha256,
        objectKey,
        encryptionKeyRef: write.encryptionKeyRef,
      };
    },
    { isolationLevel: "Serializable", timeout: 20_000 },
  );
}

async function existingOfferingDiffContext(
  snapshot: ImportSnapshot,
  dependencies: BusinessImportProcessorDependencies,
) {
  const offerings = await dependencies.prisma.businessOffering.findMany({
    where: { tenantId: snapshot.tenantId, archivedAt: null },
    include: {
      prices: { orderBy: { createdAt: "desc" }, take: 1 },
      duration: true,
      sourceBindings: { where: { sourceId: snapshot.sourceId, active: true } },
    },
  });
  const existing = offerings.map((offering) => {
    const price = offering.prices[0];
    const binding = offering.sourceBindings[0];
    const value: ParsedBusinessServiceRow = {
      sourceRow: 0,
      externalId: binding?.externalKey ?? null,
      category: offering.category,
      name: offering.name,
      description: offering.description,
      price: price
        ? {
            type: price.type,
            amount: price.amount?.toString() ?? null,
            from: price.amountFrom?.toString() ?? null,
            to: price.amountTo?.toString() ?? null,
            currency: price.currency,
            unit: price.unit,
            taxNote: price.taxNote,
          }
        : null,
      duration: offering.duration
        ? {
            minimumMinutes: offering.duration.minimumMinutes,
            maximumMinutes: offering.duration.maximumMinutes,
          }
        : null,
      locationExternalId: null,
      bookingNotes: offering.bookingNotes,
      active: offering.active,
      validFrom: price?.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      validUntil: price?.effectiveUntil?.toISOString().slice(0, 10) ?? null,
      language: offering.locale,
      evidence: {},
      diagnostics: [],
      valid: true,
    };
    return { id: offering.id, value, valueHash: businessOfferingValueHash(value) };
  });
  const byId = new Map(existing.map((item) => [item.id, item]));
  const sourceBindings = offerings.flatMap((offering) =>
    offering.sourceBindings.map((binding) => ({
      offeringId: offering.id,
      externalKey: binding.externalKey,
      identityKey: businessOfferingIdentityKey(
        byId.get(offering.id)?.value ??
          existing[0]?.value ?? {
            category: null,
            name: "",
            locationExternalId: null,
            language: null,
          },
      ),
      sourceValueHash: binding.lastSeenSourceValueHash,
    })),
  );
  return { existing, sourceBindings };
}

function coalesceDiffCandidates(candidates: BusinessServiceDiffCandidate[]) {
  const grouped = new Map<string, BusinessServiceDiffCandidate[]>();
  for (const candidate of candidates) {
    grouped.set(candidate.candidateKey, [
      ...(grouped.get(candidate.candidateKey) ?? []),
      candidate,
    ]);
  }
  return [...grouped.values()].map((items) => {
    const first = items[0]!;
    if (items.length === 1)
      return { candidate: first, rows: first.proposed ? [first.proposed] : [] };
    const diagnostic: BusinessImportDiagnostic = {
      severity: "ERROR",
      code: "BUSINESS_IMPORT_DUPLICATE_IDENTITY",
      message: "More than one row resolves to the same service identity.",
    };
    return {
      candidate: {
        ...first,
        action: "CONFLICT" as const,
        confidence: "LOW" as const,
        diagnostics: [...first.diagnostics, diagnostic],
      },
      rows: items.flatMap((item) => (item.proposed ? [item.proposed] : [])),
    };
  });
}

async function prepareEvidence(
  snapshot: ImportSnapshot,
  candidateKey: string,
  rows: ParsedBusinessServiceRow[],
  dependencies: BusinessImportProcessorDependencies,
  signal: AbortSignal,
) {
  assertNotAborted(signal, "PERSISTING");
  const store = dependencies.objectStore;
  if (!store) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_STORAGE_UNAVAILABLE", true, "STORAGE");
  }
  const entries = rows.flatMap((row) =>
    Object.entries(row.evidence).flatMap(([field, evidence]) =>
      evidence ? [{ field, evidence }] : [],
    ),
  );
  const prepared = entries.map(({ field, evidence }) => {
    const exact = businessImportEvidenceBytes(evidence.sourceValue);
    const identity = [
      "business-import-evidence",
      snapshot.importId,
      snapshot.generation,
      candidateKey,
      field,
      evidence.format === "CSV" ? evidence.row : `${evidence.sheet}:${evidence.cell}`,
      exact.sourceValueHash,
    ].join(":");
    const objectKey = createDeterministicKnowledgeObjectKey({
      tenantId: snapshot.tenantId,
      sourceId: snapshot.sourceId,
      purpose: "extracted",
      identity,
    });
    return {
      id: dependencies.id(),
      field: field as BusinessServiceCsvHeader,
      sourceRow: evidence.row,
      desiredLedgerId: dependencies.id(),
      ...exact,
      objectKey,
      locator: evidenceLocator(evidence),
      semanticElementId: hash(`${candidateKey}\0${field}\0${identity}`),
      semanticTableId:
        evidence.format === "XLSX"
          ? hash(`xlsx-table\0${evidence.sheet}`)
          : hash("csv-table\0services"),
    };
  });
  const reservedLedgers = await reserveObjectLedgers(
    snapshot,
    "EVIDENCE_EXCERPT",
    prepared.map((item) => ({ id: item.desiredLedgerId, objectKey: item.objectKey })),
    dependencies,
  );
  const output: PreparedEvidence[] = [];
  for (let offset = 0; offset < prepared.length; offset += 8) {
    assertNotAborted(signal, "PERSISTING");
    const batch = await Promise.all(
      prepared.slice(offset, offset + 8).map(async (item) => {
        assertNotAborted(signal, "PERSISTING");
        const ledgerId = reservedLedgers.get(item.objectKey);
        if (!ledgerId) {
          throw new BusinessImportProcessorError(
            "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
            false,
            "PERSISTING",
          );
        }
        const write = await putExactObject(
          store,
          item.objectKey,
          item.bytes,
          dependencies.objectEncryptionKeyId,
        );
        return {
          id: item.id,
          field: item.field,
          sourceRow: item.sourceRow,
          ledgerId,
          bytes: item.bytes,
          sourceValueHash: item.sourceValueHash,
          excerptHash: item.excerptHash,
          objectKey: item.objectKey,
          write,
          locator: item.locator,
          semanticElementId: item.semanticElementId,
          semanticTableId: item.semanticTableId,
        } satisfies PreparedEvidence;
      }),
    );
    assertNotAborted(signal, "PERSISTING");
    output.push(...batch);
  }
  return output;
}

function candidateReasonCodes(candidate: BusinessServiceDiffCandidate) {
  return [
    ...(candidate.action === "MISSING" ? ["BUSINESS_IMPORT_MISSING_FROM_REVISION"] : []),
    ...(candidate.action === "CONFLICT" ? ["BUSINESS_IMPORT_REVIEW_CONFLICT"] : []),
    ...(candidate.action === "INVALID" ? ["BUSINESS_IMPORT_INVALID_ROW"] : []),
  ];
}

export function businessImportInitialDecision(
  action: BusinessServiceDiffCandidate["action"],
): "PENDING" | "REJECTED" {
  return action === "MISSING" ? "REJECTED" : "PENDING";
}

async function preparePublication(
  snapshot: ImportSnapshot,
  parsed: ParsedImport,
  dependencies: BusinessImportProcessorDependencies,
  signal: AbortSignal,
) {
  assertNotAborted(signal, "PERSISTING");
  const store = dependencies.objectStore;
  if (!store) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_STORAGE_UNAVAILABLE", true, "STORAGE");
  }
  const manifestBytes = new TextEncoder().encode(canonicalBusinessImportJson(parsed.manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new BusinessImportProcessorError("BUSINESS_IMPORT_MANIFEST_LIMIT", false, "PARSING");
  }
  const manifestHash = hash(manifestBytes);
  const manifestObjectKey = createDeterministicKnowledgeObjectKey({
    tenantId: snapshot.tenantId,
    sourceId: snapshot.sourceId,
    purpose: "extracted",
    identity: `business-import-manifest:${snapshot.importId}:${snapshot.generation}:${manifestHash}`,
  });
  const reservedLedgers = await reserveObjectLedgers(
    snapshot,
    "PARSED_MANIFEST",
    [{ id: dependencies.id(), objectKey: manifestObjectKey }],
    dependencies,
  );
  const manifestLedgerId = reservedLedgers.get(manifestObjectKey);
  if (!manifestLedgerId) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
      false,
      "PERSISTING",
    );
  }
  const manifestWrite = await putExactObject(
    store,
    manifestObjectKey,
    manifestBytes,
    dependencies.objectEncryptionKeyId,
  );
  assertNotAborted(signal, "PERSISTING");
  const candidates: PreparedCandidate[] = [];
  if (parsed.rows.length) {
    const context = await existingOfferingDiffContext(snapshot, dependencies);
    const diff = coalesceDiffCandidates(
      diffBusinessServiceRows({
        sourceLineageId: snapshot.sourceLineageId,
        rows: parsed.rows,
        existing: context.existing,
        sourceBindings: context.sourceBindings,
      }),
    );
    for (const { candidate, rows } of diff) {
      assertNotAborted(signal, "PERSISTING");
      const proposed = candidate.proposed ?? candidate.current?.value;
      if (!proposed) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_NORMALIZED_VALUE_INVALID",
          false,
          "PARSING",
        );
      }
      const normalizedValueHash =
        candidate.proposedValueHash ??
        candidate.current?.valueHash ??
        businessOfferingValueHash(proposed);
      const requiresApproval =
        candidate.riskLevel === "HIGH" && ["ADD", "UPDATE"].includes(candidate.action);
      const preparedEvidence = await prepareEvidence(
        snapshot,
        candidate.candidateKey,
        rows,
        dependencies,
        signal,
      );
      const evidenceIds = Object.fromEntries(
        preparedEvidence
          .filter((item) => item.sourceRow === proposed.sourceRow)
          .map((item) => [item.field, item.id]),
      );
      candidates.push({
        id: dependencies.id(),
        candidateKey: candidate.candidateKey,
        semanticTargetKey: candidate.identityKey,
        action: candidate.action,
        normalizedValue: jsonObject(offeringValue(proposed)),
        normalizedValueHash,
        fieldProvenance: jsonObject(createBusinessImportFieldProvenance(proposed, evidenceIds)),
        targetOfferingId: candidate.targetOfferingId,
        currentFingerprint: candidate.current?.valueHash ?? null,
        risk: candidate.riskLevel,
        confidence: candidate.confidence,
        validationCodes: jsonArray(candidate.diagnostics.map(diagnosticValue)),
        reasonCodes: jsonArray(candidateReasonCodes(candidate)),
        requiresApproval,
        requiredPermission: requiresApproval ? "business_information.approve" : "",
        evidence: preparedEvidence,
      });
    }
  }
  const retainedBytes =
    snapshot.expectedByteSize +
    manifestBytes.byteLength +
    candidates.reduce(
      (total, candidate) =>
        total +
        candidate.evidence.reduce(
          (evidenceTotal, evidence) => evidenceTotal + evidence.bytes.byteLength,
          0,
        ),
      0,
    );
  return {
    parsed,
    manifestBytes,
    manifestHash,
    manifestObjectKey,
    manifestLedgerId,
    manifestWrite,
    candidates,
    retainedBytes,
  } satisfies PreparedPublication;
}

function summary(publication: PreparedPublication) {
  const candidates = publication.candidates;
  return {
    counts: {
      total: candidates.length,
      valid: candidates.filter((item) => item.action !== "INVALID").length,
      invalid: candidates.filter((item) => item.action === "INVALID").length,
      additions: candidates.filter((item) => item.action === "ADD").length,
      updates: candidates.filter((item) => item.action === "UPDATE").length,
      linked: candidates.filter((item) => item.action === "LINK").length,
      unchanged: candidates.filter((item) => item.action === "UNCHANGED").length,
      conflicts: candidates.filter((item) => item.action === "CONFLICT").length,
      pendingApproval: candidates.filter((item) => item.requiresApproval).length,
      applied: 0,
    },
    diagnostics: publication.parsed.diagnostics.slice(0, 100).map(diagnosticValue),
  };
}

async function persistPublication(
  snapshot: ImportSnapshot,
  artifact: ArtifactSnapshot,
  publication: PreparedPublication,
  startedAt: number,
  dependencies: BusinessImportProcessorDependencies,
): Promise<BusinessImportProcessorResult> {
  const result = await dependencies.prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "BusinessImport"
        WHERE "tenantId" = ${snapshot.tenantId} AND "id" = ${snapshot.importId}
        FOR UPDATE
      `);
      const current = await tx.businessImport.findFirst({
        where: { id: snapshot.importId, tenantId: snapshot.tenantId },
      });
      const expectedState = snapshot.format === "PDF" ? "EXTRACTING" : "PARSING";
      if (
        !current ||
        current.generation !== snapshot.generation ||
        current.state !== expectedState ||
        current.artifactId !== artifact.id ||
        current.artifactSha256 !== artifact.sha256
      )
        return { status: "stale" as const };
      const membership = await tx.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: snapshot.tenantId,
            userId: snapshot.requestedByUserId,
          },
        },
        include: {
          user: { select: { deletedAt: true } },
          tenant: { select: { deletedAt: true, status: true } },
        },
      });
      const source = await tx.businessImportSource.findFirst({
        where: { id: snapshot.sourceId, tenantId: snapshot.tenantId },
        select: { status: true },
      });
      if (
        !membership ||
        !["OWNER", "ADMIN", "MANAGER"].includes(membership.role) ||
        membership.user.deletedAt ||
        membership.tenant.deletedAt ||
        !["ACTIVE", "TRIALING"].includes(membership.tenant.status) ||
        source?.status !== "ACTIVE"
      ) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_ACTOR_NOT_AUTHORIZED",
          false,
          "PERSISTING",
        );
      }
      const now = dependencies.now();
      const retainUntil = new Date(now.getTime() + dependencies.retentionMs);
      const manifestLedger = await tx.businessImportObjectLedger.updateMany({
        where: {
          id: publication.manifestLedgerId,
          tenantId: snapshot.tenantId,
          objectKind: "PARSED_MANIFEST",
          objectStorageKey: publication.manifestObjectKey,
          encryptionKeyRef: publication.manifestWrite.encryptionKeyRef,
          retentionClass: pendingRetentionClass(snapshot),
          deletionState: "RETAINED",
        },
        data: { retentionClass: "BUSINESS_IMPORT_PARSED_MANIFEST", retainUntil },
      });
      if (manifestLedger.count !== 1) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
          false,
          "PERSISTING",
        );
      }
      const parsedRevision = await tx.businessImportParsedRevision.create({
        data: {
          id: dependencies.id(),
          tenantId: snapshot.tenantId,
          sourceId: snapshot.sourceId,
          importId: snapshot.importId,
          importGeneration: snapshot.generation,
          artifactId: artifact.id,
          artifactSha256: artifact.sha256,
          manifestObjectLedgerId: publication.manifestLedgerId,
          manifestObjectKind: "PARSED_MANIFEST",
          manifestObjectKey: publication.manifestObjectKey,
          manifestEncryptionKeyRef: publication.manifestWrite.encryptionKeyRef,
          manifestHash: publication.manifestHash,
          parserVersion: publication.parsed.parserVersion,
          ocrVersion: publication.parsed.ocrVersion,
          mapperVersion: MAPPER_VERSION,
          schemaVersion: publication.parsed.schemaVersion,
          extractionContractVersion: EXTRACTION_CONTRACT_VERSION,
        },
      });
      const previousCandidates = await tx.businessImportCandidate.findMany({
        where: { tenantId: snapshot.tenantId, importId: snapshot.importId },
        include: { approvals: true },
      });
      const previousByKey = new Map(previousCandidates.map((item) => [item.candidateKey, item]));
      for (const prepared of publication.candidates) {
        const previous = previousByKey.get(prepared.candidateKey);
        const candidateId = previous?.id ?? prepared.id;
        const version = (previous?.version ?? 0) + 1;
        const initialDecision = businessImportInitialDecision(prepared.action);
        if (previous) {
          for (const approval of previous.approvals.filter(
            (item) => item.state !== "INVALIDATED",
          )) {
            await tx.businessImportCandidateApproval.update({
              where: { id: approval.id },
              data: {
                state: "INVALIDATED",
                decidedByUserId: approval.decidedByUserId ?? snapshot.requestedByUserId,
                decidedAt: approval.decidedAt ?? now,
                invalidatedAt: now,
                etag: { increment: 1 },
              },
            });
          }
          await tx.businessImportCandidate.update({
            where: { id: candidateId },
            data: {
              mappingId: snapshot.mapping?.id ?? null,
              targetCategory: "OFFERINGS",
              semanticTargetKey: prepared.semanticTargetKey,
              action: prepared.action,
              normalizedValue: prepared.normalizedValue,
              normalizedValueHash: prepared.normalizedValueHash,
              targetOfferingId: prepared.targetOfferingId,
              currentFingerprint: prepared.currentFingerprint,
              risk: prepared.risk,
              confidence: prepared.confidence,
              validationCodes: prepared.validationCodes,
              reasonCodes: prepared.reasonCodes,
              decision: initialDecision,
              requiresApproval: prepared.requiresApproval,
              requiredPermission: prepared.requiredPermission,
              version,
              etag: { increment: 1 },
              decidedByUserId: null,
              decidedAt: null,
              staleAt: null,
              appliedAt: null,
            },
          });
        } else {
          await tx.businessImportCandidate.create({
            data: {
              id: candidateId,
              tenantId: snapshot.tenantId,
              sourceId: snapshot.sourceId,
              importId: snapshot.importId,
              mappingId: snapshot.mapping?.id ?? null,
              candidateKey: prepared.candidateKey,
              targetCategory: "OFFERINGS",
              semanticTargetKey: prepared.semanticTargetKey,
              action: prepared.action,
              normalizedValue: prepared.normalizedValue,
              normalizedValueHash: prepared.normalizedValueHash,
              targetOfferingId: prepared.targetOfferingId,
              currentFingerprint: prepared.currentFingerprint,
              risk: prepared.risk,
              confidence: prepared.confidence,
              validationCodes: prepared.validationCodes,
              reasonCodes: prepared.reasonCodes,
              decision: initialDecision,
              requiresApproval: prepared.requiresApproval,
              requiredPermission: prepared.requiredPermission,
              version,
            },
          });
        }
        await tx.businessImportCandidateRevision.create({
          data: {
            id: dependencies.id(),
            tenantId: snapshot.tenantId,
            sourceId: snapshot.sourceId,
            importId: snapshot.importId,
            candidateId,
            version,
            parsedRevisionId: parsedRevision.id,
            importGeneration: snapshot.generation,
            artifactId: artifact.id,
            artifactSha256: artifact.sha256,
            parsedManifestHash: publication.manifestHash,
            mappingId: snapshot.mapping?.id ?? null,
            targetCategory: "OFFERINGS",
            semanticTargetKey: prepared.semanticTargetKey,
            action: prepared.action,
            normalizedValue: prepared.normalizedValue,
            normalizedValueHash: prepared.normalizedValueHash,
            fieldProvenance: prepared.fieldProvenance,
            targetOfferingId: prepared.targetOfferingId,
            currentFingerprint: prepared.currentFingerprint,
            risk: prepared.risk,
            confidence: prepared.confidence,
            validationCodes: prepared.validationCodes,
            reasonCodes: prepared.reasonCodes,
            requiresApproval: prepared.requiresApproval,
            requiredPermission: prepared.requiredPermission,
          },
        });
        if (prepared.evidence.length) {
          if (
            prepared.evidence.some(
              (evidence) => evidence.write.encryptionKeyRef !== dependencies.objectEncryptionKeyId,
            )
          ) {
            throw new BusinessImportProcessorError(
              "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
              false,
              "PERSISTING",
            );
          }
          const evidenceLedgers = await tx.businessImportObjectLedger.updateMany({
            where: {
              id: { in: prepared.evidence.map((evidence) => evidence.ledgerId) },
              tenantId: snapshot.tenantId,
              objectKind: "EVIDENCE_EXCERPT",
              encryptionKeyRef: dependencies.objectEncryptionKeyId,
              retentionClass: pendingRetentionClass(snapshot),
              deletionState: "RETAINED",
            },
            data: { retentionClass: "BUSINESS_IMPORT_EVIDENCE", retainUntil },
          });
          if (evidenceLedgers.count !== prepared.evidence.length) {
            throw new BusinessImportProcessorError(
              "BUSINESS_IMPORT_OBJECT_IDENTITY_CONFLICT",
              false,
              "PERSISTING",
            );
          }
          await tx.businessImportCandidateEvidence.createMany({
            data: prepared.evidence.map((evidence) => {
              const record = {
                id: evidence.id,
                tenantId: snapshot.tenantId,
                sourceId: snapshot.sourceId,
                importId: snapshot.importId,
                candidateId,
                candidateVersion: version,
                candidateValueHash: prepared.normalizedValueHash,
                artifactId: artifact.id,
                artifactSha256: artifact.sha256,
                importGeneration: snapshot.generation,
                parsedRevisionId: parsedRevision.id,
                parsedManifestHash: publication.manifestHash,
                semanticElementId: evidence.semanticElementId,
                semanticTableId: evidence.semanticTableId,
                locator: evidence.locator,
                sourceValueHash: evidence.sourceValueHash,
                excerptHash: evidence.excerptHash,
                excerptObjectKey: evidence.objectKey,
                excerptEncryptionKeyRef: evidence.write.encryptionKeyRef,
                excerptObjectLedgerId: evidence.ledgerId,
                excerptObjectKind: "EVIDENCE_EXCERPT" as const,
                parserVersion: publication.parsed.parserVersion,
                ocrVersion: publication.parsed.ocrVersion,
                extractionContractVersion: EXTRACTION_CONTRACT_VERSION,
              };
              return {
                ...record,
                evidenceRecordHash: businessImportEvidenceRecordHash(record),
              };
            }),
          });
        }
        previousByKey.delete(prepared.candidateKey);
      }
      for (const previous of previousByKey.values()) {
        for (const approval of previous.approvals.filter((item) => item.state !== "INVALIDATED")) {
          await tx.businessImportCandidateApproval.update({
            where: { id: approval.id },
            data: {
              state: "INVALIDATED",
              decidedByUserId: approval.decidedByUserId ?? snapshot.requestedByUserId,
              decidedAt: approval.decidedAt ?? now,
              invalidatedAt: now,
              etag: { increment: 1 },
            },
          });
        }
        await tx.businessImportCandidate.update({
          where: { id: previous.id },
          data: {
            decision: "STALE",
            staleAt: now,
            decidedByUserId: null,
            decidedAt: null,
            etag: { increment: 1 },
          },
        });
      }
      const quota = await tx.businessImportQuotaReservation.updateMany({
        where: {
          tenantId: snapshot.tenantId,
          importId: snapshot.importId,
          status: snapshot.mode === "INITIAL" ? "RESERVED" : "CONSUMED",
        },
        data: {
          ...(snapshot.mode === "INITIAL"
            ? {
                status: "CONSUMED" as const,
                consumedAt: now,
                retainedBytes: BigInt(publication.retainedBytes),
              }
            : {
                processorSeconds: {
                  increment: Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)),
                },
                retainedBytes: {
                  increment: BigInt(
                    Math.max(0, publication.retainedBytes - snapshot.expectedByteSize),
                  ),
                },
              }),
          rawBytes: BigInt(snapshot.expectedByteSize),
          expandedBytes: BigInt(publication.parsed.metrics.expandedBytes),
          sheetCount: publication.parsed.metrics.sheetCount,
          rowCount: publication.parsed.metrics.rowCount,
          columnCount: publication.parsed.metrics.columnCount,
          cellCount: BigInt(publication.parsed.metrics.cellCount),
          pdfPageCount: publication.parsed.metrics.pdfPageCount,
          ocrPageCount: publication.parsed.metrics.ocrPageCount,
          ocrPixels: BigInt(publication.parsed.metrics.ocrPixels),
          ...(snapshot.mode === "INITIAL"
            ? {
                processorSeconds: Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)),
              }
            : {}),
          extractedCharacters: publication.parsed.metrics.extractedCharacters,
          candidateCount: publication.candidates.length,
        },
      });
      if (quota.count !== 1) {
        throw new BusinessImportProcessorError(
          "BUSINESS_IMPORT_QUOTA_RESERVATION_INVALID",
          false,
          "PERSISTING",
        );
      }
      await tx.businessImport.update({
        where: { id: snapshot.importId },
        data: {
          state: publication.parsed.state,
          stagingObjectKey: null,
          stagingEncryptionKeyRef: null,
          stagingObjectLedgerId: null,
          stagingObjectKind: null,
          parsedRevisionId: parsedRevision.id,
          parsedManifestObjectKey: publication.manifestObjectKey,
          parsedManifestEncryptionKeyRef: publication.manifestWrite.encryptionKeyRef,
          parsedManifestObjectLedgerId: publication.manifestLedgerId,
          parsedManifestObjectKind: "PARSED_MANIFEST",
          parsedManifestHash: publication.manifestHash,
          parserVersion: publication.parsed.parserVersion,
          ocrVersion: publication.parsed.ocrVersion,
          mapperVersion: MAPPER_VERSION,
          schemaVersion: publication.parsed.schemaVersion,
          safeSummary: summary(publication),
          failureCode: null,
          failureStage: null,
          retryable: false,
          parsedAt: now,
          reviewReadyAt: publication.parsed.state === "READY_FOR_REVIEW" ? now : null,
          etag: { increment: 1 },
        },
      });
      await tx.businessImportSource.update({
        where: { id: snapshot.sourceId },
        data: {
          ...(publication.parsed.state === "READY_FOR_REVIEW"
            ? { lastSchemaHash: publication.parsed.schemaHash }
            : {}),
          ...(snapshot.mapping ? { lastMappingRevision: snapshot.mapping.revision } : {}),
          updatedByUserId: snapshot.requestedByUserId,
          etag: { increment: 1 },
        },
      });
      if (snapshot.mode === "INITIAL" && snapshot.stagingObjectLedgerId) {
        await tx.businessImportObjectLedger.updateMany({
          where: {
            id: snapshot.stagingObjectLedgerId,
            tenantId: snapshot.tenantId,
            objectKind: "STAGING",
            deletionState: "RETAINED",
            legalHold: false,
          },
          data: {
            deletionState: "TOMBSTONED",
            tombstoneReason: "PROMOTED_TO_RAW_ARTIFACT",
            tombstonedAt: now,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: snapshot.tenantId,
          actorUserId: snapshot.requestedByUserId,
          action: "business_import.parsed",
          entityType: "business_import",
          entityId: snapshot.importId,
          payload: {
            generation: snapshot.generation,
            format: snapshot.format,
            state: publication.parsed.state,
            candidateCount: publication.candidates.length,
            manifestHash: publication.manifestHash,
            mappingId: snapshot.mapping?.id ?? null,
            mappingRevision: snapshot.mapping?.revision ?? null,
          },
        },
      });
      return { status: "persisted" as const };
    },
    { isolationLevel: "Serializable", timeout: 60_000 },
  );
  if (result.status === "stale") {
    return {
      status: "cancelled",
      importId: snapshot.importId,
      generation: snapshot.generation,
      reason: "stale_generation",
    };
  }
  const staging = stagingObjectReference(snapshot);
  if (staging) await deleteTombstonedStaging(staging, dependencies);
  return {
    status: "succeeded",
    importId: snapshot.importId,
    generation: snapshot.generation,
    state: publication.parsed.state,
    candidateCount: publication.candidates.length,
  };
}

async function deleteTombstonedStaging(
  snapshot: StagingObjectReference,
  dependencies: BusinessImportProcessorDependencies,
) {
  if (!dependencies.objectStore) return;
  const claimToken = `BUSINESS_IMPORT_STAGING_DELETE_CLAIM:${dependencies.id()}`;
  const claimed = await dependencies.prisma.businessImportObjectLedger.updateMany({
    where: {
      id: snapshot.stagingObjectLedgerId,
      tenantId: snapshot.tenantId,
      objectKind: "STAGING",
      deletionState: "TOMBSTONED",
      legalHold: false,
    },
    data: {
      deletionState: "DELETING",
      deletionStartedAt: dependencies.now(),
      lastErrorCode: claimToken,
    },
  });
  if (claimed.count !== 1) return;
  try {
    await dependencies.objectStore.delete(snapshot.stagingObjectKey);
    await dependencies.prisma.businessImportObjectLedger.updateMany({
      where: {
        id: snapshot.stagingObjectLedgerId,
        tenantId: snapshot.tenantId,
        deletionState: "DELETING",
        lastErrorCode: claimToken,
      },
      data: {
        deletionState: "DELETED",
        deletedAt: dependencies.now(),
        lastErrorCode: null,
      },
    });
  } catch {
    await dependencies.prisma.businessImportObjectLedger
      .updateMany({
        where: {
          id: snapshot.stagingObjectLedgerId,
          tenantId: snapshot.tenantId,
          deletionState: "DELETING",
          lastErrorCode: claimToken,
        },
        data: {
          deletionState: "FAILED",
          lastErrorCode: "BUSINESS_IMPORT_STAGING_DELETE_FAILED",
        },
      })
      .catch(() => undefined);
  }
}

function normalizedError(error: unknown): BusinessImportProcessorError {
  if (error instanceof BusinessImportProcessorError) return error;
  if (error instanceof BusinessImportFileAdmissionError) {
    return new BusinessImportProcessorError(
      error.code,
      error.retryable,
      "SCANNING",
      !error.retryable,
    );
  }
  if (error instanceof KnowledgeObjectStoreError) {
    return new BusinessImportProcessorError(
      error.code === "OBJECT_CORRUPT"
        ? "BUSINESS_IMPORT_STORED_OBJECT_CORRUPT"
        : "BUSINESS_IMPORT_STORAGE_UNAVAILABLE",
      error.code !== "OBJECT_CORRUPT",
      "STORAGE",
    );
  }
  return new BusinessImportProcessorError("BUSINESS_IMPORT_PROCESSING_FAILED", true, "PERSISTING");
}

export function businessImportSafeError(error: unknown) {
  const normalized = normalizedError(error);
  return {
    code: normalized.code,
    retryable: normalized.retryable,
    stage: normalized.stage,
    message: normalized.retryable
      ? "Business import processing is temporarily unavailable."
      : normalized.rejection
        ? "The file did not pass the business import security policy."
        : "The business import could not be processed safely.",
  };
}

async function failImport(
  snapshot: ImportSnapshot,
  error: BusinessImportProcessorError,
  dependencies: BusinessImportProcessorDependencies,
) {
  const now = dependencies.now();
  const terminal = !error.retryable;
  const state = error.retryable ? "FAILED_RETRYABLE" : error.rejection ? "REJECTED" : "FAILED";
  let tombstoneStaging = false;
  await dependencies.prisma.$transaction(async (tx) => {
    const updated = await tx.businessImport.updateMany({
      where: {
        id: snapshot.importId,
        tenantId: snapshot.tenantId,
        generation: snapshot.generation,
        state: { in: ["SCANNING", "PARSING", "EXTRACTING"] },
      },
      data: {
        state,
        ...(terminal
          ? {
              stagingObjectKey: null,
              stagingEncryptionKeyRef: null,
              stagingObjectLedgerId: null,
              stagingObjectKind: null,
            }
          : {}),
        failureCode: error.code,
        failureStage: error.stage,
        retryable: error.retryable,
        etag: { increment: 1 },
      },
    });
    if (updated.count !== 1) return;
    if (terminal) {
      await tx.businessImportQuotaReservation.updateMany({
        where: {
          tenantId: snapshot.tenantId,
          importId: snapshot.importId,
          status: "RESERVED",
        },
        data: { status: "RELEASED", releasedAt: now },
      });
    }
    if (terminal && snapshot.stagingObjectLedgerId) {
      const tombstoned = await tx.businessImportObjectLedger.updateMany({
        where: {
          id: snapshot.stagingObjectLedgerId,
          tenantId: snapshot.tenantId,
          objectKind: "STAGING",
          deletionState: "RETAINED",
          legalHold: false,
        },
        data: {
          deletionState: "TOMBSTONED",
          tombstoneReason: error.code,
          tombstonedAt: now,
        },
      });
      tombstoneStaging = tombstoned.count === 1;
    }
    await tx.auditLog.create({
      data: {
        tenantId: snapshot.tenantId,
        actorUserId: snapshot.requestedByUserId,
        action: "business_import.processing_failed",
        entityType: "business_import",
        entityId: snapshot.importId,
        payload: {
          generation: snapshot.generation,
          stage: error.stage,
          code: error.code,
          retryable: error.retryable,
        },
      },
    });
  });
  const staging = stagingObjectReference(snapshot);
  if (tombstoneStaging && staging) await deleteTombstonedStaging(staging, dependencies);
}

async function failUnstartedImport(
  data: BusinessImportRuntimeData,
  error: BusinessImportProcessorError,
  dependencies: BusinessImportProcessorDependencies,
) {
  const now = dependencies.now();
  const tombstonedStaging = await dependencies.prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImport"
      WHERE "id" = ${data.importId}
        AND "tenantId" = ${data.tenantId}
        AND "sourceId" = ${data.sourceId}
        AND "generation" = ${data.generation}
      FOR UPDATE
    `);
    const current = await tx.businessImport.findFirst({
      where: {
        id: data.importId,
        tenantId: data.tenantId,
        sourceId: data.sourceId,
        generation: data.generation,
      },
    });
    if (!current) return null;
    const terminal = !error.retryable;
    const updated = await tx.businessImport.updateMany({
      where: {
        id: data.importId,
        tenantId: data.tenantId,
        sourceId: data.sourceId,
        generation: data.generation,
        state: { in: [...activeProcessingStates] },
      },
      data: {
        state: error.retryable ? "FAILED_RETRYABLE" : "FAILED",
        ...(terminal
          ? {
              stagingObjectKey: null,
              stagingEncryptionKeyRef: null,
              stagingObjectLedgerId: null,
              stagingObjectKind: null,
            }
          : {}),
        failureCode: error.code,
        failureStage: error.stage,
        retryable: error.retryable,
        etag: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    if (terminal) {
      await tx.businessImportQuotaReservation.updateMany({
        where: { tenantId: data.tenantId, importId: data.importId, status: "RESERVED" },
        data: { status: "RELEASED", releasedAt: now },
      });
    }
    if (
      !terminal ||
      !current.stagingObjectKey ||
      !current.stagingEncryptionKeyRef ||
      !current.stagingObjectLedgerId ||
      current.stagingObjectKind !== "STAGING"
    )
      return null;
    const tombstoned = await tx.businessImportObjectLedger.updateMany({
      where: {
        id: current.stagingObjectLedgerId,
        tenantId: data.tenantId,
        objectKind: "STAGING",
        objectStorageKey: current.stagingObjectKey,
        encryptionKeyRef: current.stagingEncryptionKeyRef,
        retentionClass: "BUSINESS_IMPORT_STAGING",
        deletionState: "RETAINED",
        legalHold: false,
      },
      data: {
        deletionState: "TOMBSTONED",
        tombstoneReason: error.code,
        tombstonedAt: now,
      },
    });
    return tombstoned.count === 1
      ? {
          tenantId: data.tenantId,
          stagingObjectKey: current.stagingObjectKey,
          stagingEncryptionKeyRef: current.stagingEncryptionKeyRef,
          stagingObjectLedgerId: current.stagingObjectLedgerId,
        }
      : null;
  });
  if (tombstonedStaging) {
    await deleteTombstonedStaging(tombstonedStaging, dependencies);
  }
}

export async function processBusinessImportJob(
  input: BusinessImportJobInput,
  dependencies: BusinessImportProcessorDependencies,
): Promise<BusinessImportProcessorResult> {
  if (
    input.name !== "parse" ||
    input.id !== `business-import:${input.data.importId}:${input.data.generation}` ||
    !isBusinessImportRuntimeData(input.data)
  ) {
    throw new BusinessImportProcessorError(
      "BUSINESS_IMPORT_JOB_PAYLOAD_INVALID",
      false,
      "VALIDATION",
    );
  }
  const startedAt = Date.now();
  assertNotAborted(input.signal, "VALIDATION");
  let started: Awaited<ReturnType<typeof beginImport>>;
  try {
    started = await beginImport(input, dependencies);
  } catch (error) {
    const normalized = normalizedError(error);
    if (normalized.canMutateImportOnFailure) {
      await failUnstartedImport(input.data, normalized, dependencies).catch(() => undefined);
    }
    throw normalized;
  }
  if ("status" in started) return started;
  const snapshot = started;
  try {
    await cleanupExpiredPendingOutputs(snapshot, dependencies).catch(() => undefined);
    if (
      snapshot.format === "XLSX" &&
      !businessImportXlsxSandboxApproved(process.env.BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED)
    ) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_XLSX_SANDBOX_NOT_APPROVED",
        false,
        "VALIDATION",
      );
    }
    const store = dependencies.objectStore;
    if (!store || !dependencies.scanner) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_RUNTIME_UNAVAILABLE",
        true,
        "SCANNING",
      );
    }
    assertNotAborted(input.signal, "STORAGE");
    const sourceBytes =
      snapshot.mode === "MAPPED"
        ? await store.get(snapshot.artifact!.objectKey, snapshot.artifact!.encryptionKeyRef)
        : await store.get(snapshot.stagingObjectKey!, snapshot.stagingEncryptionKeyRef!);
    if (sourceBytes.byteLength !== snapshot.expectedByteSize) {
      throw new BusinessImportProcessorError(
        snapshot.mode === "MAPPED"
          ? "BUSINESS_IMPORT_ARTIFACT_LENGTH_MISMATCH"
          : "BUSINESS_IMPORT_STAGING_LENGTH_MISMATCH",
        false,
        "STORAGE",
      );
    }
    if (snapshot.mode === "MAPPED" && hash(sourceBytes) !== snapshot.artifact!.sha256) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_ARTIFACT_HASH_MISMATCH",
        false,
        "STORAGE",
      );
    }
    const accepted = await admitBusinessImportFile(
      {
        filename: snapshot.originalFilename,
        declaredMimeType: snapshot.declaredMimeType,
        stream: Readable.from([sourceBytes]),
      },
      {
        environment: process.env.NODE_ENV === "test" ? "TEST" : "PRODUCTION",
        maxBytes: dependencies.maxFileBytes,
        scannerTimeoutMs: dependencies.scannerTimeoutMs,
        scanner: dependencies.scanner,
        signal: input.signal,
      },
    );
    assertNotAborted(input.signal, "PERSISTING");
    if (
      snapshot.mode === "MAPPED" &&
      (accepted.provenance.sha256 !== snapshot.artifact!.sha256 ||
        accepted.provenance.byteSize !== snapshot.expectedByteSize)
    ) {
      throw new BusinessImportProcessorError(
        "BUSINESS_IMPORT_ARTIFACT_IDENTITY_CONFLICT",
        false,
        "STORAGE",
      );
    }
    const artifact =
      snapshot.mode === "MAPPED"
        ? snapshot.artifact
        : await promoteArtifact(snapshot, accepted, dependencies);
    if (!artifact) {
      await cleanupCurrentPendingOutputs(snapshot, dependencies).catch(() => undefined);
      return {
        status: "cancelled",
        importId: snapshot.importId,
        generation: snapshot.generation,
        reason: "stale_generation",
      };
    }
    const parsed = await parseAcceptedFile(snapshot, accepted, dependencies, input.signal);
    assertNotAborted(input.signal, snapshot.format === "PDF" ? "EXTRACTING" : "PARSING");
    const publication = await preparePublication(snapshot, parsed, dependencies, input.signal);
    assertNotAborted(input.signal, "PERSISTING");
    const result = await persistPublication(
      snapshot,
      artifact,
      publication,
      startedAt,
      dependencies,
    );
    if (result.status === "cancelled") {
      await cleanupCurrentPendingOutputs(snapshot, dependencies).catch(() => undefined);
    }
    return result;
  } catch (error) {
    const normalized = normalizedError(error);
    let failureStateChecked = false;
    try {
      await failImport(snapshot, normalized, dependencies);
      failureStateChecked = true;
    } catch {
      failureStateChecked = false;
    }
    if (!normalized.retryable && failureStateChecked) {
      await cleanupCurrentPendingOutputs(snapshot, dependencies).catch(() => undefined);
    }
    throw normalized;
  }
}

export function createBusinessImportDependencies(
  prisma: PrismaClient,
  overrides: Partial<BusinessImportProcessorDependencies> = {},
): BusinessImportProcessorDependencies {
  const maxFileBytes = positiveInteger(
    process.env.BUSINESS_IMPORT_MAX_FILE_BYTES,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_BYTES,
  );
  const keyId = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY_ID?.trim() || "knowledge-artifact-v1";
  let objectStore: KnowledgeObjectStore | null = null;
  const rootPath = process.env.KNOWLEDGE_OBJECT_STORE_PATH?.trim() ?? "";
  const encodedKey = process.env.KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY?.trim() ?? "";
  if (
    enabled(process.env.BUSINESS_IMPORT_ENABLED) &&
    rootPath &&
    isAbsolute(rootPath) &&
    encodedKey
  ) {
    try {
      objectStore = new EncryptedFileKnowledgeObjectStore({
        rootPath,
        activeKey: { id: keyId, key: decodeKnowledgeObjectEncryptionKey(encodedKey) },
        maxPlaintextBytes: maxFileBytes,
      });
    } catch {
      objectStore = null;
    }
  }
  const scannerHost = process.env.KNOWLEDGE_FILE_SCANNER_HOST?.trim() ?? "";
  const scanner =
    enabled(process.env.BUSINESS_IMPORT_ENABLED) &&
    enabled(process.env.KNOWLEDGE_FILE_SCANNER_APPROVED) &&
    scannerHost
      ? (new ClamAvKnowledgeFileScanner({
          host: scannerHost,
          port: positiveInteger(process.env.KNOWLEDGE_FILE_SCANNER_PORT, 3310, 65_535),
          version: process.env.KNOWLEDGE_FILE_SCANNER_VERSION?.trim() || "clamav",
          approvedForProduction: true,
        }) as unknown as BusinessImportFileScanner)
      : null;
  const defaults: BusinessImportProcessorDependencies = {
    prisma,
    objectStore,
    objectEncryptionKeyId: keyId,
    scanner,
    maxFileBytes,
    maxPendingPerTenant: positiveInteger(
      process.env.BUSINESS_IMPORT_MAX_PENDING_PER_TENANT,
      5,
      100,
    ),
    scannerTimeoutMs: positiveInteger(
      process.env.KNOWLEDGE_FILE_SCANNER_TIMEOUT_MS,
      10_000,
      60_000,
    ),
    pdfParser: {
      approved: enabled(process.env.BUSINESS_IMPORT_PARSER_APPROVED),
      url: process.env.BUSINESS_IMPORT_PARSER_URL?.replace(/\/$/u, "") || null,
      version: process.env.BUSINESS_IMPORT_PARSER_VERSION?.trim() || "unconfigured",
      timeoutMs: positiveInteger(process.env.BUSINESS_IMPORT_PARSER_TIMEOUT_MS, 300_000, 600_000),
    },
    now: () => new Date(),
    id: () => randomUUID(),
    retentionMs: RETENTION_MS,
  };
  return { ...defaults, ...overrides };
}
