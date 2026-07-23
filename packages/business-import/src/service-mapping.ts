import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import {
  BUSINESS_IMPORT_CURRENCY_CODES,
  BUSINESS_SERVICES_CSV_HEADERS,
  BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
  BusinessServicesCsvError,
  isBusinessImportCurrencyCode,
  parseBusinessServiceRow,
  resolveBusinessServiceHeader,
  type BusinessImportCsvCellEvidence,
  type BusinessImportDiagnostic,
  type BusinessServiceCsvHeader,
  type BusinessServiceCsvLimits,
  type ParsedBusinessServicesCsv,
} from "./service-csv.js";

export const BUSINESS_SERVICE_MAPPING_VERSION = "leadvirt.services.mapping.v1";

export const BUSINESS_SERVICE_MAPPING_TARGETS = [
  "IGNORE",
  ...BUSINESS_SERVICES_CSV_HEADERS,
  "price",
  "duration",
] as const;

export type BusinessServiceMappingTarget = (typeof BUSINESS_SERVICE_MAPPING_TARGETS)[number];
export type BusinessServiceMappingStatus = "MATCHED" | "CHECK_MAPPING" | "NOT_USED";

export interface BusinessServiceCsvAnalysisColumn {
  columnKey: string;
  column: number;
  header: string;
  normalizedHeader: string;
  samples: Array<{ row: number; value: string; truncated: boolean }>;
  nonEmptyCount: number;
}

export interface BusinessServiceCsvAnalysis {
  version: typeof BUSINESS_SERVICE_MAPPING_VERSION;
  format: "CSV";
  tableKey: "csv:services";
  schemaHash: string;
  encoding: "utf-8" | "windows-1251";
  delimiter: "," | ";" | "\t";
  headerRow: number;
  rowCount: number;
  columns: BusinessServiceCsvAnalysisColumn[];
}

export interface BusinessServiceMappingProposalColumn {
  columnKey: string;
  target: BusinessServiceMappingTarget;
  status: BusinessServiceMappingStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  reasonCodes: string[];
}

export interface BusinessServiceMappingDefaults {
  locale: string | null;
  numberFormat: "DECIMAL_DOT" | "DECIMAL_COMMA" | null;
  currency: string | null;
  timezone: string | null;
  unit: string | null;
}

export interface BusinessServiceMappingProposal {
  version: typeof BUSINESS_SERVICE_MAPPING_VERSION;
  tableKey: string;
  schemaHash: string;
  headerRow: number;
  columns: BusinessServiceMappingProposalColumn[];
  defaults: BusinessServiceMappingDefaults;
  validation: {
    errorCodes: string[];
    warningCodes: string[];
  };
}

export interface ConfirmedBusinessServiceMapping {
  tableKey: string;
  schemaHash: string;
  headerRow: number;
  columns: Array<{
    sourceColumnKey: string;
    target: BusinessServiceMappingTarget;
  }>;
  defaults: BusinessServiceMappingDefaults;
}

interface CsvMatrix {
  records: string[][];
  delimiter: "," | ";" | "\t";
  encoding: "utf-8" | "windows-1251";
}

const DEFAULT_LIMITS: BusinessServiceCsvLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 10_000,
  maxColumns: 100,
  maxCellCharacters: 8 * 1024,
  maxServices: 200,
  maxTotalCharacters: 1_000_000,
};

const MAX_HEADER_SCAN_ROWS = 20;
const MAX_SAMPLES = 3;
const MAX_SAMPLE_CHARACTERS = 200;

const ALIASES: Record<string, BusinessServiceMappingTarget> = {
  sku: "external_id",
  code: "external_id",
  codigo: "external_id",
  artikelnummer: "external_id",
  "id услуги": "external_id",
  "ид услуги": "external_id",
  "идентификатор услуги": "external_id",
  "код услуги": "external_id",
  артикул: "external_id",
  код: "external_id",
  категория: "category",
  рубрика: "category",
  categorie: "category",
  kategorie: "category",
  categoria: "category",
  название: "name",
  наименование: "name",
  услуга: "name",
  услуги: "name",
  товар: "name",
  product: "name",
  producto: "name",
  produit: "name",
  leistung: "name",
  bezeichnung: "name",
  описание: "description",
  details: "description",
  detalle: "description",
  descripcion: "description",
  description: "description",
  beschreibung: "description",
  цена: "price",
  стоимость: "price",
  тариф: "price",
  preis: "price",
  prix: "price",
  precio: "price",
  preco: "price",
  price: "price",
  cost: "price",
  валюта: "currency",
  moneda: "currency",
  devise: "currency",
  wahrung: "currency",
  waehrung: "currency",
  moeda: "currency",
  currency: "currency",
  длительность: "duration",
  продолжительность: "duration",
  время: "duration",
  dauer: "duration",
  duree: "duration",
  duracion: "duration",
  duracao: "duration",
  duration: "duration",
  minutes: "duration_minutes",
  минуты: "duration_minutes",
  minutos: "duration_minutes",
  активна: "active",
  активно: "active",
  статус: "active",
  enabled: "active",
  active: "active",
  язык: "language",
  sprache: "language",
  idioma: "language",
  langue: "language",
  language: "language",
  единица: "price_unit",
  "единица цены": "price_unit",
  "единица стоимости": "price_unit",
  unit: "price_unit",
  taxes: "tax_note",
  налог: "tax_note",
  примечание: "booking_notes",
  notes: "booking_notes",
  note: "booking_notes",
};

const FREE_VALUES = new Set([
  "free",
  "no charge",
  "бесплатно",
  "бесплатная",
  "gratuit",
  "gratuite",
  "gratis",
  "kostenlos",
]);

const ON_REQUEST_VALUES = new Set([
  "on request",
  "upon request",
  "ask",
  "по запросу",
  "договорная",
  "уточняйте",
  "auf anfrage",
  "sur devis",
  "a consultar",
  "bajo consulta",
  "sob consulta",
]);

const CURRENCY_PATTERNS: Array<[RegExp, string]> = [
  [/(?:₽|\bRUB\b|\bруб(?:\.|ля|лей)?\b)/iu, "RUB"],
  [/(?:€|\bEUR\b)/iu, "EUR"],
  [/(?:£|\bGBP\b)/iu, "GBP"],
  [/(?:₸|\bKZT\b|\bтенге\b)/iu, "KZT"],
  [/(?:₴|\bUAH\b|\bгрн\.?\b)/iu, "UAH"],
  [/(?:₹|\bINR\b)/iu, "INR"],
  [/(?:₪|\bILS\b)/iu, "ILS"],
  [/(?:₩|\bKRW\b)/iu, "KRW"],
  [/(?:₺|\bTRY\b)/iu, "TRY"],
  [/\bUS\s*\$/iu, "USD"],
  [/\b(?:CA|C)\s*\$/iu, "CAD"],
  [/\b(?:AU|A)\s*\$/iu, "AUD"],
  [/\bNZ\s*\$/iu, "NZD"],
  [/\bHK\s*\$/iu, "HKD"],
  [/\bS\s*\$/iu, "SGD"],
  [/(?:R\$|\bBRL\b)/iu, "BRL"],
  [/\bCN\s*¥/iu, "CNY"],
  [/\bJP\s*¥/iu, "JPY"],
  [/\bRMB\b/iu, "CNY"],
  [/(?:zł|\bPLN\b)/iu, "PLN"],
  [/(?:د\.?إ|\bAED\b)/iu, "AED"],
  [/\bJPY\b/iu, "JPY"],
  [/\bUSD\b/iu, "USD"],
  [/\bCAD\b/iu, "CAD"],
  [/\bAUD\b/iu, "AUD"],
];

function limits(input?: Partial<BusinessServiceCsvLimits>): BusinessServiceCsvLimits {
  return { ...DEFAULT_LIMITS, ...input };
}

function decode(bytes: Uint8Array) {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ""),
      encoding: "utf-8" as const,
    };
  } catch {
    return {
      text: new TextDecoder("windows-1251", { fatal: true }).decode(bytes),
      encoding: "windows-1251" as const,
    };
  }
}

export function normalizeBusinessServiceMappingHeader(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function matrix(text: string, delimiter: "," | ";" | "\t", input: BusinessServiceCsvLimits) {
  const parser = parse({
    bom: true,
    delimiter,
    max_record_size: input.maxCellCharacters * input.maxColumns,
    relax_column_count: false,
    relax_quotes: false,
    skip_empty_lines: true,
  });
  const records: string[][] = [];
  Readable.from([text]).pipe(parser);
  for await (const value of parser) {
    const record = value as string[];
    if (record.length < 1 || record.length > input.maxColumns) {
      throw new BusinessServicesCsvError(
        "BUSINESS_IMPORT_CSV_COLUMN_LIMIT",
        `The CSV file must contain between 1 and ${input.maxColumns} columns.`,
      );
    }
    for (const cell of record) {
      if (cell.length > input.maxCellCharacters) {
        throw new BusinessServicesCsvError(
          "BUSINESS_IMPORT_CSV_CELL_LIMIT",
          `A CSV value exceeds ${input.maxCellCharacters} characters.`,
        );
      }
    }
    records.push(record);
    if (records.length > input.maxRows + MAX_HEADER_SCAN_ROWS) {
      throw new BusinessServicesCsvError(
        "BUSINESS_IMPORT_CSV_ROW_LIMIT",
        `The CSV file contains more than ${input.maxRows} data rows.`,
      );
    }
  }
  if (records.length === 0) {
    throw new BusinessServicesCsvError("BUSINESS_IMPORT_CSV_EMPTY", "The CSV file is empty.");
  }
  const width = records[0]!.length;
  if (records.some((record) => record.length !== width)) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_INCONSISTENT_COLUMNS",
      "CSV rows contain inconsistent column counts.",
    );
  }
  return records;
}

function knownHeaderCount(record: string[]) {
  return record.filter((cell) => mappingTargetForHeader(cell) !== null).length;
}

async function structuralMatrix(
  bytes: Uint8Array,
  input: BusinessServiceCsvLimits,
): Promise<CsvMatrix> {
  if (bytes.byteLength > input.maxBytes) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_BYTE_LIMIT",
      `The CSV file exceeds ${input.maxBytes} bytes.`,
    );
  }
  const decoded = decode(bytes);
  if (decoded.text.length > input.maxTotalCharacters) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_CHARACTER_LIMIT",
      `The CSV file exceeds ${input.maxTotalCharacters} decoded characters.`,
    );
  }
  const allAttempts = await Promise.all(
    ([",", ";", "\t"] as const).map(async (delimiter) => {
      try {
        const records = await matrix(decoded.text, delimiter, input);
        const width = records[0]?.length ?? 0;
        const populatedRows = records.filter((row) => row.some((cell) => cell.trim())).length;
        const knownHeaders = Math.max(
          ...records.slice(0, MAX_HEADER_SCAN_ROWS).map(knownHeaderCount),
        );
        return { delimiter, records, width, populatedRows, knownHeaders };
      } catch {
        return null;
      }
    }),
  );
  const attempts = allAttempts
    .filter(
      (
        attempt,
      ): attempt is {
        delimiter: "," | ";" | "\t";
        records: string[][];
        width: number;
        populatedRows: number;
        knownHeaders: number;
      } => attempt !== null && attempt.width > 1,
    )
    .sort(
      (left, right) =>
        right.knownHeaders - left.knownHeaders ||
        right.width - left.width ||
        right.populatedRows - left.populatedRows ||
        [",", ";", "\t"].indexOf(left.delimiter) - [",", ";", "\t"].indexOf(right.delimiter),
    );
  const singleColumn = allAttempts.find(
    (attempt) =>
      attempt?.delimiter === "," &&
      attempt.width === 1 &&
      attempt.records
        .slice(0, MAX_HEADER_SCAN_ROWS)
        .some((record) => mappingTargetForHeader(record[0] ?? "") !== null),
  );
  const selected = attempts[0] ?? singleColumn;
  if (!selected) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_DELIMITER_UNKNOWN",
      "LeadVirt could not identify a comma, semicolon, or tab-delimited table.",
    );
  }
  const ambiguous = attempts
    .slice(1)
    .find(
      (attempt) =>
        attempt.width === selected.width &&
        selected.knownHeaders - attempt.knownHeaders <= 1 &&
        canonicalMatrix(attempt.records) !== canonicalMatrix(selected.records),
    );
  if (ambiguous) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_DELIMITER_AMBIGUOUS",
      "The CSV delimiter is ambiguous.",
    );
  }
  return { records: selected.records, delimiter: selected.delimiter, encoding: decoded.encoding };
}

function canonicalMatrix(records: string[][]) {
  return JSON.stringify(records);
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function columnKey(column: number) {
  return `column:${column}`;
}

export async function analyzeBusinessServicesCsv(
  bytes: Uint8Array,
  inputLimits?: Partial<BusinessServiceCsvLimits>,
): Promise<BusinessServiceCsvAnalysis> {
  const input = limits(inputLimits);
  const parsed = await structuralMatrix(bytes, input);
  const scan = parsed.records.slice(0, MAX_HEADER_SCAN_ROWS);
  const minimumHeaderCells = Math.max(1, Math.ceil((parsed.records[0]?.length ?? 1) * 0.6));
  const headerCandidates = scan
    .map((record, index) => {
      const populated = record.filter((cell) => cell.trim()).length;
      const textual = record.some((cell) => {
        const value = cell.trim();
        return value && !/^[-+]?\d+(?:[.,]\d+)?$/u.test(value);
      });
      return {
        index,
        eligible: populated >= minimumHeaderCells && textual,
        knownHeaders: knownHeaderCount(record),
      };
    })
    .filter((candidate) => candidate.eligible);
  const strongHeaderThreshold = Math.max(2, Math.ceil((parsed.records[0]?.length ?? 1) * 0.5));
  const headerIndex =
    headerCandidates
      .filter((candidate) => candidate.knownHeaders >= strongHeaderThreshold)
      .sort((left, right) => right.knownHeaders - left.knownHeaders || left.index - right.index)[0]
      ?.index ??
    headerCandidates[0]?.index ??
    0;
  const header = parsed.records[headerIndex]!;
  const data = parsed.records
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim()));
  if (data.length > input.maxServices) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_SERVICE_LIMIT",
      `The file contains more than ${input.maxServices} services.`,
    );
  }
  const columns = header.map((rawHeader, index) => {
    const unique = new Set<string>();
    const samples: BusinessServiceCsvAnalysisColumn["samples"] = [];
    let nonEmptyCount = 0;
    data.forEach((row, dataIndex) => {
      const raw = row[index] ?? "";
      const value = raw.trim();
      if (!value) return;
      nonEmptyCount += 1;
      const normalized = value.normalize("NFKC");
      if (unique.has(normalized) || samples.length >= MAX_SAMPLES) return;
      unique.add(normalized);
      samples.push({
        row: headerIndex + dataIndex + 2,
        value: value.slice(0, MAX_SAMPLE_CHARACTERS),
        truncated: value.length > MAX_SAMPLE_CHARACTERS,
      });
    });
    return {
      columnKey: columnKey(index + 1),
      column: index + 1,
      header: rawHeader.trim().slice(0, 500),
      normalizedHeader: normalizeBusinessServiceMappingHeader(rawHeader),
      samples,
      nonEmptyCount,
    };
  });
  const schemaHash = hash({
    version: 1,
    delimiter: parsed.delimiter,
    headerRow: headerIndex + 1,
    columns: columns.map((column) => ({
      column: column.column,
      normalizedHeader: column.normalizedHeader,
    })),
  });
  return {
    version: BUSINESS_SERVICE_MAPPING_VERSION,
    format: "CSV",
    tableKey: "csv:services",
    schemaHash,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    headerRow: headerIndex + 1,
    rowCount: data.length,
    columns,
  };
}

function mappingTargetForHeader(header: string): BusinessServiceMappingTarget | null {
  const normalized = normalizeBusinessServiceMappingHeader(header);
  if (!normalized) return null;
  const canonical = resolveBusinessServiceHeader(header);
  if (canonical === "price_amount" && normalized !== "price amount") return "price";
  if (canonical === "duration_minutes" && normalized !== "duration minutes") return "duration";
  if (canonical) return canonical;
  return ALIASES[normalized] ?? ALIASES[normalized.replace(/\s+/gu, "_")] ?? null;
}

function looksLikePrice(values: string[]) {
  if (values.length === 0) return false;
  return (
    values.filter(
      (value) =>
        /(?:(?:₽|€|£|₸|₴|₹|\$)\s*\d|\d[\d\s.,]*\s*(?:₽|€|£|₸|₴|₹|\$)|\b(?:RUB|EUR|USD|GBP|KZT|UAH|CHF|AED|TRY|CNY|JPY|CAD|AUD|BRL|INR|PLN)\b)/iu.test(
          value,
        ) ||
        FREE_VALUES.has(normalizeBusinessServiceMappingHeader(value)) ||
        ON_REQUEST_VALUES.has(normalizeBusinessServiceMappingHeader(value)),
    ).length /
      values.length >=
    0.6
  );
}

function looksLikeDuration(values: string[]) {
  if (values.length === 0) return false;
  return (
    values.filter((value) =>
      /\d(?:[.,]\d+)?\s*(?:m|min(?:ute)?s?|mins?|minutes?|мин(?:ут[аы]?)?|h|hours?|hrs?|час(?:а|ов)?|stunde[n]?|heure[s]?|hora[s]?)(?:\b|$)/iu.test(
        value,
      ),
    ).length /
      values.length >=
    0.6
  );
}

function looksLikeBoolean(values: string[]) {
  if (values.length === 0) return false;
  return values.every((value) =>
    /^(?:true|false|yes|no|1|0|да|нет|ja|nein|oui|non|si|sí|sim|nao|não)$/iu.test(value.trim()),
  );
}

export function proposeBusinessServiceMapping(
  analysis: BusinessServiceCsvAnalysis,
): BusinessServiceMappingProposal {
  const usedTargets = new Set<BusinessServiceMappingTarget>();
  const columns = analysis.columns.map((column) => {
    const byHeader = mappingTargetForHeader(column.header);
    const values = column.samples.map((sample) => sample.value);
    let target = byHeader;
    let confidence: BusinessServiceMappingProposalColumn["confidence"] = byHeader ? "HIGH" : "NONE";
    let status: BusinessServiceMappingStatus = byHeader ? "MATCHED" : "NOT_USED";
    let reasonCodes = byHeader ? ["HEADER_ALIAS"] : ["NO_SAFE_MATCH"];
    if (!target && looksLikePrice(values)) {
      target = "price";
      confidence = "MEDIUM";
      status = "CHECK_MAPPING";
      reasonCodes = ["VALUE_SHAPE_PRICE"];
    } else if (!target && looksLikeDuration(values)) {
      target = "duration";
      confidence = "MEDIUM";
      status = "CHECK_MAPPING";
      reasonCodes = ["VALUE_SHAPE_DURATION"];
    } else if (!target && looksLikeBoolean(values)) {
      target = "active";
      confidence = "MEDIUM";
      status = "CHECK_MAPPING";
      reasonCodes = ["VALUE_SHAPE_BOOLEAN"];
    }
    target ??= "IGNORE";
    if (target !== "IGNORE" && usedTargets.has(target)) {
      status = "CHECK_MAPPING";
      confidence = "LOW";
      reasonCodes = [...reasonCodes, "DUPLICATE_TARGET"];
    } else if (target !== "IGNORE") {
      usedTargets.add(target);
    }
    return {
      columnKey: column.columnKey,
      target,
      status,
      confidence,
      reasonCodes,
    };
  });
  return {
    version: BUSINESS_SERVICE_MAPPING_VERSION,
    tableKey: analysis.tableKey,
    schemaHash: analysis.schemaHash,
    headerRow: analysis.headerRow,
    columns,
    defaults: {
      locale: null,
      numberFormat: null,
      currency: null,
      timezone: null,
      unit: null,
    },
    validation: {
      errorCodes: [],
      warningCodes: columns.some((column) => column.target === "name")
        ? []
        : ["BUSINESS_IMPORT_MAPPING_NAME_REQUIRED"],
    },
  };
}

export function isExactBusinessServicesCsvContract(
  analysis: BusinessServiceCsvAnalysis,
  proposal: BusinessServiceMappingProposal,
) {
  if (analysis.headerRow !== 1) return false;
  const seen = new Set<BusinessServiceCsvHeader>();
  for (const column of analysis.columns) {
    const resolved = resolveBusinessServiceHeader(column.header);
    if (
      !resolved ||
      normalizeBusinessServiceMappingHeader(column.header) !== resolved.replace(/_/gu, " ") ||
      seen.has(resolved)
    ) {
      return false;
    }
    seen.add(resolved);
  }
  return (
    seen.has("name") &&
    proposal.columns.every(
      (column) =>
        column.target !== "IGNORE" &&
        column.target !== "price" &&
        column.target !== "duration" &&
        column.status === "MATCHED",
    )
  );
}

export function validateConfirmedBusinessServiceMapping(
  analysis: BusinessServiceCsvAnalysis,
  mapping: ConfirmedBusinessServiceMapping,
) {
  if (
    !mapping.defaults ||
    (mapping.defaults.numberFormat !== null &&
      !["DECIMAL_DOT", "DECIMAL_COMMA"].includes(mapping.defaults.numberFormat)) ||
    (mapping.defaults.currency !== null && !isBusinessImportCurrencyCode(mapping.defaults.currency))
  ) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_MAPPING_DEFAULTS_INVALID",
      "The confirmed mapping contains invalid defaults.",
    );
  }
  if (
    mapping.tableKey !== analysis.tableKey ||
    mapping.schemaHash !== analysis.schemaHash ||
    mapping.headerRow !== analysis.headerRow
  ) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_MAPPING_SCHEMA_CHANGED",
      "The source table no longer matches the confirmed mapping.",
    );
  }
  const expected = new Set(analysis.columns.map((column) => column.columnKey));
  const seenColumns = new Set<string>();
  const seenTargets = new Set<BusinessServiceMappingTarget>();
  for (const item of mapping.columns) {
    if (
      !expected.has(item.sourceColumnKey) ||
      seenColumns.has(item.sourceColumnKey) ||
      !BUSINESS_SERVICE_MAPPING_TARGETS.includes(item.target)
    ) {
      throw new BusinessServicesCsvError(
        "BUSINESS_IMPORT_MAPPING_INVALID",
        "The confirmed mapping contains an unknown or duplicate column.",
      );
    }
    seenColumns.add(item.sourceColumnKey);
    if (item.target !== "IGNORE") {
      if (seenTargets.has(item.target)) {
        throw new BusinessServicesCsvError(
          "BUSINESS_IMPORT_MAPPING_TARGET_DUPLICATE",
          "A target field can be mapped only once.",
        );
      }
      seenTargets.add(item.target);
    }
  }
  if (seenColumns.size !== expected.size || !seenTargets.has("name")) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_MAPPING_INCOMPLETE",
      "The confirmed mapping must cover every source column and include a service name.",
    );
  }
  if (
    (seenTargets.has("price") &&
      [...seenTargets].some((target) =>
        ["price_type", "price_amount", "price_from", "price_to"].includes(target),
      )) ||
    (seenTargets.has("duration") &&
      [...seenTargets].some((target) =>
        ["duration_minutes", "duration_max_minutes"].includes(target),
      ))
  ) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_MAPPING_TARGET_AMBIGUOUS",
      "Composite and leaf mappings cannot be mixed.",
    );
  }
  if (
    (seenTargets.has("price_amount") &&
      (seenTargets.has("price_from") || seenTargets.has("price_to"))) ||
    (seenTargets.has("price_to") && !seenTargets.has("price_from")) ||
    (seenTargets.has("duration_max_minutes") && !seenTargets.has("duration_minutes"))
  ) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_MAPPING_TARGET_AMBIGUOUS",
      "The selected leaf fields cannot form one unambiguous value.",
    );
  }
}

const DOLLAR_CURRENCIES = new Set(["AUD", "CAD", "HKD", "NZD", "SGD", "USD"]);
const KNOWN_CURRENCY_CODES = new Set(BUSINESS_IMPORT_CURRENCY_CODES);
const NON_CURRENCY_CODES = new Set(["MIN", "TAX", "TTC", "VAT"]);
const CURRENCY_WORDS = new Set(["грн", "руб", "рубля", "рублей", "тенге"]);
const NUMBER_EXPRESSION = /\d(?:[\d.,' \u00A0\u202F]*\d)?/gu;
const RANGE_WORDS = new Set(["a", "até", "bis", "до", "hasta", "to", "à"]);
const HOUR_UNITS = new Set([
  "h",
  "hr",
  "hrs",
  "hour",
  "hours",
  "stunde",
  "stunden",
  "heure",
  "heures",
  "hora",
  "horas",
  "час",
  "часа",
  "часов",
  "ч",
]);
const MINUTE_UNITS = new Set([
  "m",
  "min",
  "mins",
  "minute",
  "minutes",
  "minuto",
  "minutos",
  "minute",
  "minuten",
  "мин",
  "минута",
  "минуты",
  "минут",
]);
const DURATION_FILLER_WORDS = new Set([
  "about",
  "approximately",
  "approx",
  "ca",
  "circa",
  "около",
  "примерно",
]);
const ADDITIVE_DURATION_WORDS = new Set(["and", "e", "et", "und", "y", "и"]);
const MAXIMUM_PREFIX =
  /^(?:up to|under|at most|no more than|maximum|max|до|не более|bis zu|bis|höchstens|hasta|máximo|jusqu a|jusqu à|au plus|até)(?:\s|$)/iu;
const MINIMUM_PRICE_PREFIX =
  /^(?:from|starting|minimum|min|at least|not less than|от|минимум|не менее|ab|mindestens|desde|mínimo|a partir|partir de)(?:\s|$)/iu;
const PRICE_UNIT_EXPRESSION =
  /(?:\/|\b(?:each|par|per|por|pro|за)\b)\s*([\p{L}][\p{L}\p{N}_-]{0,39})/iu;
const QUALIFIED_DOLLAR_EXPRESSION = /(?:\b(?:US|CA|C|AU|A|NZ|HK|S)\s*\$|R\$)/giu;
const QUALIFIED_YEN_EXPRESSION = /\b(?:CN|JP)\s*¥/giu;
const DOLLAR_QUALIFIERS = new Set([
  "A",
  "AU",
  "AUD",
  "BRL",
  "C",
  "CA",
  "CAD",
  "HK",
  "HKD",
  "NZ",
  "NZD",
  "R",
  "S",
  "SGD",
  "US",
  "USD",
]);
const YEN_QUALIFIERS = new Set(["CN", "CNY", "JP", "JPY", "RMB"]);

function decimalSeparator(numberFormat: BusinessServiceMappingDefaults["numberFormat"]) {
  if (numberFormat === "DECIMAL_COMMA") return "," as const;
  if (numberFormat === "DECIMAL_DOT") return "." as const;
  return null;
}

function normalizedWhole(value: string, groupingCharacters: Set<string>) {
  const parts: string[] = [];
  let current = "";
  for (const character of value) {
    if (groupingCharacters.has(character)) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  if (parts.some((part) => !/^\d+$/u.test(part))) return null;
  if (
    parts.length > 1 &&
    (parts[0]!.length < 1 ||
      parts[0]!.length > 3 ||
      parts.slice(1).some((part) => part.length !== 3))
  ) {
    return null;
  }
  const joined = parts.join("").replace(/^0+(?=\d)/u, "");
  return joined.length <= 12 ? joined : null;
}

function decimal(value: string, numberFormat: BusinessServiceMappingDefaults["numberFormat"]) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("-")) return null;
  const unsigned = trimmed.replace(/^\+/u, "");
  if (!/^\d[\d.,' \u00A0\u202F]*\d$|^\d$/u.test(unsigned)) return null;

  const localeDecimal = decimalSeparator(numberFormat);
  const commaCount = [...unsigned].filter((character) => character === ",").length;
  const dotCount = [...unsigned].filter((character) => character === ".").length;
  let whole = unsigned;
  let fraction: string | null = null;
  const grouping = new Set([" ", "\u00A0", "\u202F", "'"]);

  if (commaCount > 0 && dotCount > 0) {
    const separator = unsigned.lastIndexOf(",") > unsigned.lastIndexOf(".") ? "," : ".";
    if ([...unsigned].filter((character) => character === separator).length !== 1) return null;
    const index = unsigned.lastIndexOf(separator);
    whole = unsigned.slice(0, index);
    fraction = unsigned.slice(index + 1);
    grouping.add(separator === "," ? "." : ",");
  } else if (commaCount + dotCount > 0) {
    const separator = commaCount > 0 ? "," : ".";
    const count = commaCount + dotCount;
    const parts = unsigned.split(separator);
    if (count > 1) {
      if (parts.slice(1).every((part) => part.length === 3)) {
        grouping.add(separator);
      } else {
        return null;
      }
    } else {
      const candidateFraction = parts[1] ?? "";
      if (candidateFraction.length === 3) {
        if (!localeDecimal) return null;
        if (separator === localeDecimal) {
          whole = parts[0]!;
          fraction = candidateFraction;
        } else {
          grouping.add(separator);
        }
      } else {
        if (
          candidateFraction.length < 1 ||
          candidateFraction.length > 4 ||
          (localeDecimal !== null && separator !== localeDecimal)
        ) {
          return null;
        }
        whole = parts[0]!;
        fraction = candidateFraction;
      }
    }
  }

  if (fraction !== null && !/^\d{1,4}$/u.test(fraction)) return null;
  const normalized = normalizedWhole(whole, grouping);
  return normalized ? `${normalized}${fraction === null ? "" : `.${fraction}`}` : null;
}

function numberExpressions(value: string) {
  const matches = [...value.matchAll(NUMBER_EXPRESSION)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = start + match[0].length;
    const previous = index > 0 ? matches[index - 1] : null;
    const previousEnd = previous ? previous.index + previous[0].length : 0;
    const prefix = value.slice(previousEnd, start);
    const rangeFromPrevious =
      previous !== null &&
      [...prefix].filter((character) => /[-–—−]/u.test(character)).length <= 1 &&
      isRangeConnector(prefix, true);
    const unmatchedOpeningParenthesis =
      value.lastIndexOf("(", start) > value.lastIndexOf(")", start) && value.indexOf(")", end) >= 0;
    return {
      raw: match[0],
      start,
      end,
      negative:
        (!rangeFromPrevious && /[-–—−]\s*(?:[\p{Sc}]|[A-Za-z]{3})?\s*$/u.test(prefix)) ||
        unmatchedOpeningParenthesis,
    };
  });
}

function currency(value: string, fallback: string | null) {
  const detected = new Set<string>();
  let invalidExplicitCode = false;
  const unitWords = new Set(
    [...(value.match(PRICE_UNIT_EXPRESSION)?.[0].matchAll(/\b[A-Za-z]{3}\b/gu) ?? [])].map(
      (match) => match[0].toLocaleUpperCase(),
    ),
  );
  for (const [pattern, code] of CURRENCY_PATTERNS) {
    if (pattern.test(value)) detected.add(code);
  }
  for (const match of value.matchAll(/\b[A-Za-z]{3}\b/gu)) {
    const code = match[0].toLocaleUpperCase();
    if (KNOWN_CURRENCY_CODES.has(code)) {
      detected.add(code);
    } else if (!NON_CURRENCY_CODES.has(code) && !unitWords.has(code)) {
      invalidExplicitCode = true;
    }
  }
  const invalidQualifiedSymbol = [...value.matchAll(/\b([A-Za-z]{1,3})\s*([$¥])/gu)].some(
    (match) => {
      const qualifier = match[1]!.toLocaleUpperCase();
      return match[2] === "$" ? !DOLLAR_QUALIFIERS.has(qualifier) : !YEN_QUALIFIERS.has(qualifier);
    },
  );
  const unqualifiedDollar = value.replace(QUALIFIED_DOLLAR_EXPRESSION, "").includes("$");
  const unqualifiedYen = value.replace(QUALIFIED_YEN_EXPRESSION, "").includes("¥");
  if (invalidExplicitCode || invalidQualifiedSymbol || detected.size > 1) {
    return { code: null, explicit: true, invalid: true };
  }
  const explicit = [...detected][0] ?? null;
  if (
    explicit &&
    ((unqualifiedDollar && !DOLLAR_CURRENCIES.has(explicit)) ||
      (unqualifiedYen && !["CNY", "JPY"].includes(explicit)))
  ) {
    return { code: null, explicit: true, invalid: true };
  }
  if (explicit) return { code: explicit, explicit: true, invalid: false };
  if (unqualifiedDollar) {
    if (fallback && !DOLLAR_CURRENCIES.has(fallback)) {
      return { code: null, explicit: false, invalid: true };
    }
    return {
      code: fallback && DOLLAR_CURRENCIES.has(fallback) ? fallback : null,
      explicit: false,
      invalid: false,
    };
  }
  if (unqualifiedYen) {
    if (fallback && !["CNY", "JPY"].includes(fallback)) {
      return { code: null, explicit: false, invalid: true };
    }
    return {
      code: fallback && ["CNY", "JPY"].includes(fallback) ? fallback : null,
      explicit: false,
      invalid: false,
    };
  }
  if (/[\p{Sc}]/u.test(value)) return { code: null, explicit: true, invalid: true };
  return { code: fallback, explicit: false, invalid: false };
}

function isRangeConnector(value: string, stripUnits = false) {
  const hasRangePunctuation = /(?:[-–—−]|\.\.{2,})/u.test(value);
  const tokens = normalizeBusinessServiceMappingHeader(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !KNOWN_CURRENCY_CODES.has(token.toLocaleUpperCase()))
    .filter((token) => !CURRENCY_WORDS.has(token))
    .filter((token) => !stripUnits || (!HOUR_UNITS.has(token) && !MINUTE_UNITS.has(token)));
  return (
    (hasRangePunctuation && tokens.length === 0) ||
    (tokens.length === 1 && RANGE_WORDS.has(tokens[0]!))
  );
}

function priceExpression(
  value: string,
  fallbackCurrency: string | null,
  numberFormat: BusinessServiceMappingDefaults["numberFormat"],
) {
  const normalized = normalizeBusinessServiceMappingHeader(value);
  if (!normalized) return { values: {}, sourceFields: [] as BusinessServiceCsvHeader[] };
  if (FREE_VALUES.has(normalized)) {
    return {
      values: { price_type: "FREE" },
      sourceFields: ["price_type"] as BusinessServiceCsvHeader[],
    };
  }
  if (ON_REQUEST_VALUES.has(normalized)) {
    return {
      values: { price_type: "ON_REQUEST" },
      sourceFields: ["price_type"] as BusinessServiceCsvHeader[],
    };
  }
  if (MAXIMUM_PREFIX.test(normalized) || /^\s*(?:<|≤)/u.test(value)) {
    return null;
  }
  const matches = numberExpressions(value);
  if (matches.length < 1 || matches.length > 2) return null;
  if (matches.some((match) => match.negative)) return null;
  const numbers = matches.map((match) => decimal(match.raw, numberFormat));
  if (numbers.some((number) => number === null)) return null;
  if (matches.length === 2 && !isRangeConnector(value.slice(matches[0]!.end, matches[1]!.start))) {
    return null;
  }
  const resolvedCurrency = currency(value, fallbackCurrency);
  if (resolvedCurrency.invalid) return null;
  const unitMatch = value.match(PRICE_UNIT_EXPRESSION);
  const parsedUnit = unitMatch?.[1] ? normalizeBusinessServiceMappingHeader(unitMatch[1]) : null;
  const from =
    MINIMUM_PRICE_PREFIX.test(normalized) ||
    /^\s*(?:≥|>)/u.test(value) ||
    /^\s*\+/u.test(value.slice(matches[0]!.end)) ||
    /\+\s*$/u.test(value);
  if (numbers.length === 2) {
    return {
      values: {
        price_type: "RANGE",
        price_from: numbers[0]!,
        price_to: numbers[1]!,
        ...(resolvedCurrency.code ? { currency: resolvedCurrency.code } : {}),
        ...(parsedUnit ? { price_unit: parsedUnit } : {}),
      },
      sourceFields: [
        "price_type",
        "price_from",
        "price_to",
        ...(resolvedCurrency.explicit ? (["currency"] as const) : []),
        ...(parsedUnit ? (["price_unit"] as const) : []),
      ] as BusinessServiceCsvHeader[],
    };
  }
  return {
    values: {
      price_type: from ? "FROM" : "FIXED",
      [from ? "price_from" : "price_amount"]: numbers[0]!,
      ...(resolvedCurrency.code ? { currency: resolvedCurrency.code } : {}),
      ...(parsedUnit ? { price_unit: parsedUnit } : {}),
    },
    sourceFields: [
      "price_type",
      from ? "price_from" : "price_amount",
      ...(resolvedCurrency.explicit ? (["currency"] as const) : []),
      ...(parsedUnit ? (["price_unit"] as const) : []),
    ] as BusinessServiceCsvHeader[],
  };
}

function durationUnit(value: string) {
  const tokens = durationTokens(value);
  const hasHours = tokens.some((token) => HOUR_UNITS.has(token));
  const hasMinutes = tokens.some((token) => MINUTE_UNITS.has(token));
  if (hasHours === hasMinutes) return hasHours ? ("CONFLICT" as const) : null;
  return hasHours ? ("HOURS" as const) : ("MINUTES" as const);
}

function durationTokens(value: string) {
  return normalizeBusinessServiceMappingHeader(
    value.replace(/(\d)(\p{L})/gu, "$1 $2").replace(/(\p{L})(\d)/gu, "$1 $2"),
  )
    .split(" ")
    .filter(Boolean);
}

function durationNumber(
  value: string,
  numberFormat: BusinessServiceMappingDefaults["numberFormat"],
) {
  const normalized = decimal(value, numberFormat);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationResidueValid(value: string) {
  return durationTokens(value).every(
    (token) =>
      /^\d+$/u.test(token) ||
      HOUR_UNITS.has(token) ||
      MINUTE_UNITS.has(token) ||
      RANGE_WORDS.has(token) ||
      DURATION_FILLER_WORDS.has(token) ||
      ADDITIVE_DURATION_WORDS.has(token),
  );
}

function minutes(value: number, unit: "HOURS" | "MINUTES" | null) {
  if (unit === null) return null;
  const result = Math.round(value * (unit === "HOURS" ? 60 : 1));
  if (!Number.isInteger(value * (unit === "HOURS" ? 60 : 1))) return null;
  return result >= 1 && result <= 999_999 ? result : null;
}

function additiveDurationConnector(value: string) {
  if (/[/\\|=()[\]{};]/u.test(value)) return false;
  return durationTokens(value)
    .filter((token) => !HOUR_UNITS.has(token) && !MINUTE_UNITS.has(token))
    .filter((token) => !DURATION_FILLER_WORDS.has(token))
    .every((token) => ADDITIVE_DURATION_WORDS.has(token));
}

function durationExpression(
  value: string,
  numberFormat: BusinessServiceMappingDefaults["numberFormat"],
) {
  if (!value.trim()) return { values: {}, sourceFields: [] as BusinessServiceCsvHeader[] };
  const matches = numberExpressions(value);
  if (matches.length < 1 || matches.length > 2 || !durationResidueValid(value)) return null;
  if (matches.some((match) => match.negative)) return null;
  if (
    MAXIMUM_PREFIX.test(normalizeBusinessServiceMappingHeader(value)) ||
    /^\s*(?:<|>|≤|≥)/u.test(value)
  ) {
    return null;
  }
  const values = matches.map((match) => durationNumber(match.raw, numberFormat));
  if (values.some((item) => item === null)) return null;

  const firstEnd = matches[0]!.end;
  const between =
    matches.length === 2 ? value.slice(firstEnd, matches[1]!.start) : value.slice(firstEnd);
  const afterSecond = matches.length === 2 ? value.slice(matches[1]!.end) : value.slice(firstEnd);
  const firstUnit = durationUnit(between);
  const secondUnit = matches.length === 2 ? durationUnit(afterSecond) : firstUnit;
  if (firstUnit === "CONFLICT" || secondUnit === "CONFLICT") return null;

  let minimum: number | null;
  let maximum: number | null = null;
  if (matches.length === 1) {
    if (firstUnit === null) return null;
    minimum = minutes(values[0]!, firstUnit);
  } else if (isRangeConnector(between, true)) {
    if (firstUnit && secondUnit && firstUnit !== secondUnit) return null;
    const unit = firstUnit ?? secondUnit;
    if (unit === null) return null;
    minimum = minutes(values[0]!, unit);
    maximum = minutes(values[1]!, unit);
  } else if (
    firstUnit &&
    secondUnit &&
    firstUnit !== secondUnit &&
    additiveDurationConnector(between)
  ) {
    const first = minutes(values[0]!, firstUnit);
    const second = minutes(values[1]!, secondUnit);
    minimum = first !== null && second !== null ? first + second : null;
  } else {
    return null;
  }
  if (minimum === null || (maximum !== null && maximum < minimum)) return null;
  return {
    values: {
      duration_minutes: String(minimum),
      ...(maximum !== null ? { duration_max_minutes: String(maximum) } : {}),
    },
    sourceFields: [
      "duration_minutes",
      ...(maximum !== null ? (["duration_max_minutes"] as const) : []),
    ] as BusinessServiceCsvHeader[],
  };
}

export async function parseMappedBusinessServicesCsv(
  bytes: Uint8Array,
  mapping: ConfirmedBusinessServiceMapping,
  inputLimits?: Partial<BusinessServiceCsvLimits>,
): Promise<ParsedBusinessServicesCsv> {
  const input = limits(inputLimits);
  const analysis = await analyzeBusinessServicesCsv(bytes, input);
  validateConfirmedBusinessServiceMapping(analysis, mapping);
  const parsed = await structuralMatrix(bytes, input);
  if (parsed.delimiter !== analysis.delimiter || parsed.encoding !== analysis.encoding) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_MAPPING_SCHEMA_CHANGED",
      "The source table no longer matches the confirmed mapping.",
    );
  }
  const sourceColumnByKey = new Map(
    analysis.columns.map((column) => [column.columnKey, column.column] as const),
  );
  const sourceRows = parsed.records
    .slice(analysis.headerRow)
    .map((record, offset) => ({ record, row: analysis.headerRow + offset + 1 }))
    .filter(({ record }) => record.some((cell) => cell.trim()));
  const diagnostics: BusinessImportDiagnostic[] = [];
  const rows = sourceRows.map(({ record, row: sourceRow }) => {
    const canonicalValues: Partial<Record<BusinessServiceCsvHeader, string>> = {};
    const evidenceByField = new Map<
      BusinessServiceCsvHeader,
      { column: number; sourceValue: string }
    >();
    const rowErrors: BusinessImportDiagnostic[] = [];
    let inlineCurrency: { code: string; column: number; sourceValue: string } | null = null;
    const orderedAssignments = [...mapping.columns].sort(
      (left, right) =>
        Number(left.target !== "price" && left.target !== "duration") -
        Number(right.target !== "price" && right.target !== "duration"),
    );
    for (const assignment of orderedAssignments) {
      if (assignment.target === "IGNORE") continue;
      const column = sourceColumnByKey.get(assignment.sourceColumnKey)!;
      const sourceValue = record[column - 1] ?? "";
      if (assignment.target === "price") {
        const result = priceExpression(
          sourceValue,
          mapping.defaults.currency,
          mapping.defaults.numberFormat,
        );
        if (!result) {
          rowErrors.push({
            severity: "ERROR",
            code: "BUSINESS_IMPORT_PRICE_EXPRESSION_INVALID",
            message: "The price value could not be interpreted safely.",
            row: sourceRow,
            column,
          });
          continue;
        }
        Object.assign(canonicalValues, result.values);
        result.sourceFields.forEach((field) => evidenceByField.set(field, { column, sourceValue }));
        if (
          "currency" in result.values &&
          result.values.currency &&
          result.sourceFields.includes("currency")
        ) {
          inlineCurrency = { code: result.values.currency, column, sourceValue };
        }
        continue;
      }
      if (assignment.target === "duration") {
        const result = durationExpression(sourceValue, mapping.defaults.numberFormat);
        if (!result) {
          rowErrors.push({
            severity: "ERROR",
            code: "BUSINESS_IMPORT_DURATION_EXPRESSION_INVALID",
            message: "The duration value could not be interpreted safely.",
            row: sourceRow,
            column,
          });
          continue;
        }
        Object.assign(canonicalValues, result.values);
        result.sourceFields.forEach((field) => evidenceByField.set(field, { column, sourceValue }));
        continue;
      }
      if (
        assignment.target === "price_amount" ||
        assignment.target === "price_from" ||
        assignment.target === "price_to"
      ) {
        const raw = sourceValue.trim();
        const normalized = raw ? decimal(raw, mapping.defaults.numberFormat) : "";
        if (raw && normalized === null) {
          rowErrors.push({
            severity: "ERROR",
            code: "BUSINESS_IMPORT_PRICE_EXPRESSION_INVALID",
            message: "The price value could not be interpreted safely.",
            row: sourceRow,
            column,
          });
          continue;
        }
        canonicalValues[assignment.target] = normalized ?? "";
        evidenceByField.set(assignment.target, { column, sourceValue });
        continue;
      }
      if (assignment.target === "currency") {
        const directCurrency = sourceValue.trim().toLocaleUpperCase();
        if (!directCurrency) continue;
        if (inlineCurrency && directCurrency !== inlineCurrency.code) {
          rowErrors.push({
            severity: "ERROR",
            code: "BUSINESS_IMPORT_CURRENCY_CONFLICT",
            message: "Inline and separately mapped currencies disagree.",
            row: sourceRow,
            column,
          });
        }
      }
      canonicalValues[assignment.target] = sourceValue;
      evidenceByField.set(assignment.target, { column, sourceValue });
    }
    if (
      !canonicalValues.price_type &&
      (canonicalValues.price_amount || canonicalValues.price_from || canonicalValues.price_to)
    ) {
      canonicalValues.price_type =
        canonicalValues.price_from && canonicalValues.price_to
          ? "RANGE"
          : canonicalValues.price_from
            ? "FROM"
            : "FIXED";
      const priceEvidence =
        evidenceByField.get("price_amount") ??
        evidenceByField.get("price_from") ??
        evidenceByField.get("price_to");
      if (priceEvidence) evidenceByField.set("price_type", priceEvidence);
    }
    if (
      canonicalValues.price_type &&
      !["FREE", "ON_REQUEST"].includes(canonicalValues.price_type.toLocaleUpperCase()) &&
      !canonicalValues.currency &&
      mapping.defaults.currency
    ) {
      canonicalValues.currency = mapping.defaults.currency;
    }
    if (canonicalValues.price_type && !canonicalValues.price_unit && mapping.defaults.unit) {
      canonicalValues.price_unit = mapping.defaults.unit;
    }
    if (!canonicalValues.language && mapping.defaults.locale) {
      canonicalValues.language = mapping.defaults.locale;
    }
    const normalizedCurrency = canonicalValues.currency?.trim().toLocaleUpperCase() ?? "";
    if (
      /^[A-Z]{3}$/u.test(normalizedCurrency) &&
      !isBusinessImportCurrencyCode(normalizedCurrency)
    ) {
      rowErrors.push({
        severity: "ERROR",
        code: "BUSINESS_IMPORT_CURRENCY_INVALID",
        message: "Currency must be a recognized three-letter ISO 4217 code.",
        row: sourceRow,
        field: "currency",
      });
    }
    const canonicalRecord = BUSINESS_SERVICES_CSV_HEADERS.map(
      (field) => canonicalValues[field] ?? "",
    );
    const canonicalColumns = BUSINESS_SERVICES_CSV_HEADERS.map((field, index) => ({
      field,
      column: index + 1,
    }));
    const normalized = parseBusinessServiceRow(
      canonicalRecord,
      sourceRow,
      canonicalColumns,
      ({ field }) => {
        const source = evidenceByField.get(field);
        if (!source) return undefined;
        return {
          format: "CSV",
          row: sourceRow,
          column: source.column,
          header: field,
          sourceValue: source.sourceValue,
        } satisfies BusinessImportCsvCellEvidence;
      },
    );
    if (rowErrors.length > 0) {
      normalized.diagnostics.push(...rowErrors);
      normalized.valid = false;
    }
    return normalized;
  });
  if (analysis.encoding === "windows-1251") {
    diagnostics.push({
      severity: "WARNING",
      code: "BUSINESS_IMPORT_ENCODING_INFERRED",
      message: "The file was read as Windows-1251. Confirm text before applying changes.",
    });
  }
  const validRows = rows.filter((row) => row.valid).length;
  return {
    schemaVersion: BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
    encoding: analysis.encoding,
    delimiter: analysis.delimiter,
    headers: BUSINESS_SERVICES_CSV_HEADERS.filter((field) =>
      rows.some((row) => row.evidence[field] !== undefined),
    ),
    rows,
    diagnostics,
    counts: {
      totalRows: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
    },
  };
}
