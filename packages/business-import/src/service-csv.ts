import { Readable } from "node:stream";
import { parse } from "csv-parse";

export const BUSINESS_SERVICES_CSV_SCHEMA_VERSION = "leadvirt.services.v1";

// ISO 4217 List One published 2026-01-01; XTS and XXX are not customer price currencies.
export const BUSINESS_IMPORT_CURRENCY_CODES =
  "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAD XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XUA YER ZAR ZMW ZWG".split(
    " ",
  );
const BUSINESS_IMPORT_CURRENCY_CODE_SET = new Set(BUSINESS_IMPORT_CURRENCY_CODES);

export function isBusinessImportCurrencyCode(value: string) {
  return BUSINESS_IMPORT_CURRENCY_CODE_SET.has(value);
}

export const BUSINESS_SERVICES_CSV_HEADERS = [
  "external_id",
  "category",
  "name",
  "description",
  "price_type",
  "price_amount",
  "price_from",
  "price_to",
  "currency",
  "price_unit",
  "tax_note",
  "duration_minutes",
  "duration_max_minutes",
  "location_external_id",
  "booking_notes",
  "active",
  "valid_from",
  "valid_until",
  "language",
] as const;

export type BusinessServiceCsvHeader = (typeof BUSINESS_SERVICES_CSV_HEADERS)[number];
export type BusinessOfferingPriceType = "FIXED" | "FROM" | "RANGE" | "FREE" | "ON_REQUEST";

export function compareBusinessImportDecimals(left: string, right: string) {
  const scaled = (value: string) => {
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/u.test(value)) {
      throw new RangeError("Invalid business import decimal");
    }
    const [integer, fraction = ""] = value.split(".");
    return BigInt(integer!) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  };
  const difference = scaled(left) - scaled(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function canonicalBusinessImportDecimal(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/u.test(value)) return value;
  const [whole, fraction] = value.split(".");
  const trimmed = fraction?.replace(/0+$/u, "") ?? "";
  return trimmed ? `${whole}.${trimmed}` : whole!;
}

export type BusinessImportDiagnosticSeverity = "ERROR" | "WARNING";

export interface BusinessServiceCsvLimits {
  maxBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCellCharacters: number;
  maxServices: number;
  maxTotalCharacters: number;
}

export interface BusinessImportDiagnostic {
  severity: BusinessImportDiagnosticSeverity;
  code: string;
  message: string;
  row?: number;
  column?: number;
  field?: BusinessServiceCsvHeader;
  sheet?: string;
  cell?: string;
  range?: string;
}

export interface BusinessImportCsvCellEvidence {
  format: "CSV";
  row: number;
  column: number;
  header: BusinessServiceCsvHeader;
  sourceValue: string;
}

export interface BusinessImportXlsxCellEvidence {
  format: "XLSX";
  sheet: string;
  cell: string;
  range: string;
  row: number;
  column: number;
  header: BusinessServiceCsvHeader;
  sourceValue: string;
  cellType: "BLANK" | "SHARED_STRING" | "INLINE_STRING" | "STRING" | "NUMBER" | "BOOLEAN" | "DATE";
  cachedFormula: boolean;
}

export type BusinessImportCellEvidence =
  | BusinessImportCsvCellEvidence
  | BusinessImportXlsxCellEvidence;

export interface BusinessServiceColumnMapping {
  field: BusinessServiceCsvHeader;
  column: number;
}

export type BusinessServiceEvidenceFactory = (input: {
  sourceRow: number;
  column: number;
  field: BusinessServiceCsvHeader;
  sourceValue: string;
}) => BusinessImportCellEvidence | undefined;

export interface ParsedBusinessServiceRow {
  sourceRow: number;
  externalId: string | null;
  category: string | null;
  name: string;
  description: string | null;
  price: {
    type: BusinessOfferingPriceType;
    amount: string | null;
    from: string | null;
    to: string | null;
    currency: string | null;
    unit: string | null;
    taxNote: string | null;
  } | null;
  duration: {
    minimumMinutes: number;
    maximumMinutes: number | null;
  } | null;
  locationExternalId: string | null;
  bookingNotes: string | null;
  active: boolean;
  validFrom: string | null;
  validUntil: string | null;
  language: string | null;
  evidence: Partial<Record<BusinessServiceCsvHeader, BusinessImportCellEvidence>>;
  diagnostics: BusinessImportDiagnostic[];
  valid: boolean;
}

export interface ParsedBusinessServicesCsv {
  schemaVersion: typeof BUSINESS_SERVICES_CSV_SCHEMA_VERSION;
  encoding: "utf-8" | "windows-1251";
  delimiter: "," | ";" | "\t";
  headers: BusinessServiceCsvHeader[];
  rows: ParsedBusinessServiceRow[];
  diagnostics: BusinessImportDiagnostic[];
  counts: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
}

export class BusinessServicesCsvError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: BusinessImportDiagnostic[] = [],
  ) {
    super(message);
    this.name = "BusinessServicesCsvError";
  }
}

const DEFAULT_LIMITS: BusinessServiceCsvLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 10_000,
  maxColumns: 100,
  maxCellCharacters: 8 * 1024,
  maxServices: 200,
  maxTotalCharacters: 1_000_000,
};

const HEADER_ALIASES: Record<string, BusinessServiceCsvHeader> = {
  external_id: "external_id",
  id: "external_id",
  id_услуги: "external_id",
  ид_услуги: "external_id",
  идентификатор_услуги: "external_id",
  код_услуги: "external_id",
  category: "category",
  category_name: "category",
  name: "name",
  service: "name",
  service_name: "name",
  название: "name",
  услуга: "name",
  описание: "description",
  description: "description",
  price_type: "price_type",
  тип_цены: "price_type",
  price: "price_amount",
  price_amount: "price_amount",
  цена: "price_amount",
  price_from: "price_from",
  цена_от: "price_from",
  price_to: "price_to",
  цена_до: "price_to",
  currency: "currency",
  валюта: "currency",
  price_unit: "price_unit",
  единица_цены: "price_unit",
  единица_стоимости: "price_unit",
  tax_note: "tax_note",
  duration: "duration_minutes",
  duration_minutes: "duration_minutes",
  длительность: "duration_minutes",
  duration_max_minutes: "duration_max_minutes",
  location_external_id: "location_external_id",
  booking_notes: "booking_notes",
  active: "active",
  активна: "active",
  valid_from: "valid_from",
  valid_until: "valid_until",
  language: "language",
  язык: "language",
};

const PRICE_TYPES = new Set<BusinessOfferingPriceType>([
  "FIXED",
  "FROM",
  "RANGE",
  "FREE",
  "ON_REQUEST",
]);

function mergedLimits(input?: Partial<BusinessServiceCsvLimits>): BusinessServiceCsvLimits {
  return { ...DEFAULT_LIMITS, ...input };
}

function decodeCsv(bytes: Uint8Array) {
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

function normalizeHeader(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s-]+/gu, "_");
}

export function resolveBusinessServiceHeader(value: string) {
  return HEADER_ALIASES[normalizeHeader(value)] ?? null;
}

async function parseMatrix(
  text: string,
  delimiter: "," | ";" | "\t",
  limits: BusinessServiceCsvLimits,
) {
  const parser = parse({
    bom: true,
    delimiter,
    max_record_size: limits.maxCellCharacters * limits.maxColumns,
    relax_column_count: false,
    relax_quotes: false,
    skip_empty_lines: true,
  });
  const records: string[][] = [];
  const source = Readable.from(
    (function* chunks() {
      for (let offset = 0; offset < text.length; offset += 64 * 1024) {
        yield text.slice(offset, offset + 64 * 1024);
      }
    })(),
  );
  source.pipe(parser);
  for await (const value of parser) {
    const record = value as string[];
    records.push(record);
    if (records.length - 1 > limits.maxRows) {
      source.destroy();
      parser.destroy();
      throw new BusinessServicesCsvError(
        "BUSINESS_IMPORT_CSV_ROW_LIMIT",
        `The CSV file contains more than ${limits.maxRows} data rows.`,
      );
    }
  }
  if (records.length === 0) {
    throw new BusinessServicesCsvError("BUSINESS_IMPORT_CSV_EMPTY", "The CSV file is empty.");
  }
  if (records.length - 1 > limits.maxRows) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_ROW_LIMIT",
      `The CSV file contains more than ${limits.maxRows} data rows.`,
    );
  }
  const width = records[0]?.length ?? 0;
  if (width === 0 || width > limits.maxColumns) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_COLUMN_LIMIT",
      `The CSV file must contain between 1 and ${limits.maxColumns} columns.`,
    );
  }
  for (const record of records) {
    if (record.length !== width) {
      throw new BusinessServicesCsvError(
        "BUSINESS_IMPORT_CSV_INCONSISTENT_COLUMNS",
        "CSV rows contain inconsistent column counts.",
      );
    }
    for (const cell of record) {
      if (cell.length > limits.maxCellCharacters) {
        throw new BusinessServicesCsvError(
          "BUSINESS_IMPORT_CSV_CELL_LIMIT",
          `A CSV value exceeds ${limits.maxCellCharacters} characters.`,
        );
      }
    }
  }
  return records;
}

async function detectDelimiter(text: string, limits: BusinessServiceCsvLimits) {
  const attempts = (
    await Promise.all(
      ([",", ";", "\t"] as const).map(async (delimiter) => {
        try {
          const records = await parseMatrix(text, delimiter, limits);
          const rawHeaders = records[0] ?? [];
          const knownHeaders = rawHeaders.filter(
            (header) => HEADER_ALIASES[normalizeHeader(header)],
          ).length;
          return { delimiter, records, knownHeaders, width: rawHeaders.length };
        } catch {
          return null;
        }
      }),
    )
  ).filter((attempt) => attempt !== null);
  const viable = attempts
    .filter((attempt) => attempt.knownHeaders > 0 && attempt.width > 1)
    .sort((left, right) => right.knownHeaders - left.knownHeaders || right.width - left.width);
  const singleColumn = attempts.find(
    (attempt) => attempt.delimiter === "," && attempt.knownHeaders > 0 && attempt.width === 1,
  );
  const selected = viable[0] ?? singleColumn;
  if (!selected) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_DELIMITER_UNKNOWN",
      "LeadVirt could not identify a comma, semicolon, or tab-delimited services table.",
    );
  }
  const tied = viable[1];
  if (
    tied &&
    tied.knownHeaders === selected.knownHeaders &&
    tied.width === selected.width &&
    tied.delimiter !== selected.delimiter
  ) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_DELIMITER_AMBIGUOUS",
      "The CSV delimiter is ambiguous. Export the file with a consistent comma or semicolon delimiter.",
    );
  }
  return selected;
}

function nullable(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function diagnostic(
  diagnostics: BusinessImportDiagnostic[],
  input: Omit<BusinessImportDiagnostic, "severity"> & {
    severity?: BusinessImportDiagnosticSeverity;
  },
) {
  diagnostics.push({ severity: input.severity ?? "ERROR", ...input });
}

function exactDecimal(
  value: string | null,
  field: BusinessServiceCsvHeader,
  row: number,
  diagnostics: BusinessImportDiagnostic[],
) {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/u.test(value)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_INVALID",
      message: "Use a non-negative decimal with a dot and at most four decimal places.",
      row,
      field,
    });
    return null;
  }
  return value;
}

function positiveInteger(
  value: string | null,
  field: BusinessServiceCsvHeader,
  row: number,
  diagnostics: BusinessImportDiagnostic[],
) {
  if (value === null) return null;
  if (!/^[1-9]\d{0,5}$/u.test(value)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_DURATION_INVALID",
      message: "Duration must be a positive whole number of minutes.",
      row,
      field,
    });
    return null;
  }
  return Number(value);
}

function isoDate(
  value: string | null,
  field: BusinessServiceCsvHeader,
  row: number,
  diagnostics: BusinessImportDiagnostic[],
) {
  if (value === null) return null;
  const timestamp = `${value}T00:00:00.000Z`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_DATE_INVALID",
      message: "Use an ISO date in YYYY-MM-DD format.",
      row,
      field,
    });
    return null;
  }
  return value;
}

function activeValue(value: string | null, row: number, diagnostics: BusinessImportDiagnostic[]) {
  if (value === null) return true;
  const normalized = value.toLocaleLowerCase();
  if (["true", "1", "yes", "да", "ja", "oui", "si", "sí", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "нет", "nein", "non", "nao", "não"].includes(normalized)) return false;
  diagnostic(diagnostics, {
    code: "BUSINESS_IMPORT_ACTIVE_INVALID",
    message: "Active must be true or false.",
    row,
    field: "active",
  });
  return true;
}

function validatePrice(
  values: Partial<Record<BusinessServiceCsvHeader, string>>,
  row: number,
  diagnostics: BusinessImportDiagnostic[],
) {
  const rawType = nullable(values.price_type)?.toLocaleUpperCase() ?? null;
  const amount = exactDecimal(nullable(values.price_amount), "price_amount", row, diagnostics);
  const from = exactDecimal(nullable(values.price_from), "price_from", row, diagnostics);
  const to = exactDecimal(nullable(values.price_to), "price_to", row, diagnostics);
  const currency = nullable(values.currency)?.toLocaleUpperCase() ?? null;
  const unit = nullable(values.price_unit);
  const taxNote = nullable(values.tax_note);
  const hasPrice = [rawType, amount, from, to, currency, unit, taxNote].some(
    (value) => value !== null,
  );
  if (!hasPrice) return null;
  const type = rawType as BusinessOfferingPriceType | null;
  if (!type || !PRICE_TYPES.has(type)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_TYPE_INVALID",
      message: "Price type must be FIXED, FROM, RANGE, FREE, or ON_REQUEST.",
      row,
      field: "price_type",
    });
    return null;
  }
  if (currency && !isBusinessImportCurrencyCode(currency)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_CURRENCY_INVALID",
      message: "Currency must be a current three-letter ISO 4217 code.",
      row,
      field: "currency",
    });
  }
  if (type === "FIXED" && amount === null) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_AMOUNT_REQUIRED",
      message: "FIXED prices require price_amount.",
      row,
      field: "price_amount",
    });
  }
  if (type === "FROM" && from === null && amount === null) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_FROM_REQUIRED",
      message: "FROM prices require price_from or price_amount.",
      row,
      field: "price_from",
    });
  }
  if (type === "RANGE" && (from === null || to === null)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_RANGE_REQUIRED",
      message: "RANGE prices require price_from and price_to.",
      row,
      field: "price_from",
    });
  }
  if (from !== null && to !== null && compareBusinessImportDecimals(from, to) > 0) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_RANGE_REVERSED",
      message: "price_from cannot exceed price_to.",
      row,
      field: "price_to",
    });
  }
  if ((type === "FREE" || type === "ON_REQUEST") && (amount || from || to)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_VALUE_NOT_ALLOWED",
      message: `${type} must not contain a numeric price.`,
      row,
      field: "price_amount",
    });
  }
  if (!["FREE", "ON_REQUEST"].includes(type) && !currency) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_CURRENCY_REQUIRED",
      message: "A currency is required for numeric prices.",
      row,
      field: "currency",
    });
  }
  return {
    type,
    amount: type === "FIXED" ? amount : null,
    from: type === "FROM" ? (from ?? amount) : type === "RANGE" ? from : null,
    to: type === "RANGE" ? to : null,
    currency,
    unit,
    taxNote,
  };
}

export function parseBusinessServiceRow(
  record: string[],
  sourceRow: number,
  columns: BusinessServiceColumnMapping[],
  evidenceFactory: BusinessServiceEvidenceFactory = ({
    sourceRow: row,
    column,
    field,
    sourceValue,
  }) => ({ format: "CSV", row, column, header: field, sourceValue }),
) {
  const diagnostics: BusinessImportDiagnostic[] = [];
  const values: Partial<Record<BusinessServiceCsvHeader, string>> = {};
  const evidence: Partial<Record<BusinessServiceCsvHeader, BusinessImportCellEvidence>> = {};
  for (const { field, column } of columns) {
    const sourceValue = record[column - 1] ?? "";
    values[field] = sourceValue;
    const sourceEvidence = evidenceFactory({ sourceRow, column, field, sourceValue });
    if (sourceEvidence) evidence[field] = sourceEvidence;
  }
  const name = nullable(values.name) ?? "";
  if (!name) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_SERVICE_NAME_REQUIRED",
      message: "Service name is required.",
      row: sourceRow,
      field: "name",
    });
  } else if (name.length > 160) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_SERVICE_NAME_TOO_LONG",
      message: "Service name must not exceed 160 characters.",
      row: sourceRow,
      field: "name",
    });
  }
  const description = nullable(values.description);
  if (description && description.length > 2_000) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_SERVICE_DESCRIPTION_TOO_LONG",
      message: "Service description must not exceed 2,000 characters.",
      row: sourceRow,
      field: "description",
    });
  }
  const minimumMinutes = positiveInteger(
    nullable(values.duration_minutes),
    "duration_minutes",
    sourceRow,
    diagnostics,
  );
  const maximumMinutes = positiveInteger(
    nullable(values.duration_max_minutes),
    "duration_max_minutes",
    sourceRow,
    diagnostics,
  );
  if (minimumMinutes === null && maximumMinutes !== null) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_DURATION_MINIMUM_REQUIRED",
      message: "duration_max_minutes requires duration_minutes.",
      row: sourceRow,
      field: "duration_minutes",
    });
  }
  if (minimumMinutes !== null && maximumMinutes !== null && minimumMinutes > maximumMinutes) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_DURATION_RANGE_REVERSED",
      message: "duration_minutes cannot exceed duration_max_minutes.",
      row: sourceRow,
      field: "duration_max_minutes",
    });
  }
  const validFrom = isoDate(nullable(values.valid_from), "valid_from", sourceRow, diagnostics);
  const validUntil = isoDate(nullable(values.valid_until), "valid_until", sourceRow, diagnostics);
  if (validFrom && validUntil && validFrom > validUntil) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_VALIDITY_REVERSED",
      message: "valid_from cannot be after valid_until.",
      row: sourceRow,
      field: "valid_until",
    });
  }
  const language = nullable(values.language)?.toLocaleLowerCase() ?? null;
  if (language && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(language)) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_LANGUAGE_INVALID",
      message: "Language must be a valid BCP 47-style tag such as en or ru-RU.",
      row: sourceRow,
      field: "language",
    });
  }
  const price = validatePrice(values, sourceRow, diagnostics);
  if ((validFrom || validUntil) && !price) {
    diagnostic(diagnostics, {
      code: "BUSINESS_IMPORT_PRICE_DATES_REQUIRE_PRICE",
      message: "valid_from and valid_until require a typed price.",
      row: sourceRow,
      field: validFrom ? "valid_from" : "valid_until",
    });
  }
  return {
    sourceRow,
    externalId: nullable(values.external_id),
    category: nullable(values.category),
    name,
    description,
    price,
    duration: minimumMinutes === null ? null : { minimumMinutes, maximumMinutes },
    locationExternalId: nullable(values.location_external_id),
    bookingNotes: nullable(values.booking_notes),
    active: activeValue(nullable(values.active), sourceRow, diagnostics),
    validFrom,
    validUntil,
    language,
    evidence,
    diagnostics,
    valid: diagnostics.every((item) => item.severity !== "ERROR"),
  } satisfies ParsedBusinessServiceRow;
}

export function createBusinessServicesCsvTemplate() {
  return `${BUSINESS_SERVICES_CSV_HEADERS.join(",")}\r\n`;
}

export async function parseBusinessServicesCsv(
  bytes: Uint8Array,
  inputLimits?: Partial<BusinessServiceCsvLimits>,
): Promise<ParsedBusinessServicesCsv> {
  const limits = mergedLimits(inputLimits);
  if (bytes.byteLength > limits.maxBytes) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_BYTE_LIMIT",
      `The CSV file exceeds ${limits.maxBytes} bytes.`,
    );
  }
  const decoded = decodeCsv(bytes);
  if (decoded.text.length > limits.maxTotalCharacters) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_CHARACTER_LIMIT",
      `The CSV file exceeds ${limits.maxTotalCharacters} decoded characters.`,
    );
  }
  const selected = await detectDelimiter(decoded.text, limits);
  const rawHeaders = selected.records[0] ?? [];
  const diagnostics: BusinessImportDiagnostic[] = [];
  const used = new Set<BusinessServiceCsvHeader>();
  const columns: Array<{ field: BusinessServiceCsvHeader; column: number }> = [];
  rawHeaders.forEach((rawHeader, index) => {
    const field = resolveBusinessServiceHeader(rawHeader);
    if (!field) {
      diagnostic(diagnostics, {
        severity: "WARNING",
        code: "BUSINESS_IMPORT_COLUMN_UNUSED",
        message: `Column '${rawHeader.trim() || index + 1}' is not used.`,
        column: index + 1,
      });
      return;
    }
    if (used.has(field)) {
      throw new BusinessServicesCsvError(
        "BUSINESS_IMPORT_CSV_DUPLICATE_COLUMN",
        `More than one CSV column maps to '${field}'.`,
      );
    }
    used.add(field);
    columns.push({ field, column: index + 1 });
  });
  if (!used.has("name")) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_CSV_NAME_COLUMN_REQUIRED",
      "The CSV file requires a service name column.",
    );
  }
  const records = selected.records.slice(1);
  if (records.length > limits.maxServices) {
    throw new BusinessServicesCsvError(
      "BUSINESS_IMPORT_SERVICE_LIMIT",
      `The file contains more than ${limits.maxServices} services.`,
    );
  }
  const rows = records.map((record, index) => parseBusinessServiceRow(record, index + 2, columns));
  if (decoded.encoding === "windows-1251") {
    diagnostic(diagnostics, {
      severity: "WARNING",
      code: "BUSINESS_IMPORT_ENCODING_INFERRED",
      message: "The file was read as Windows-1251. Confirm text before applying changes.",
    });
  }
  const validRows = rows.filter((row) => row.valid).length;
  return {
    schemaVersion: BUSINESS_SERVICES_CSV_SCHEMA_VERSION,
    encoding: decoded.encoding,
    delimiter: selected.delimiter,
    headers: columns.map(({ field }) => field),
    rows,
    diagnostics,
    counts: {
      totalRows: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
    },
  };
}
