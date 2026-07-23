import assert from "node:assert/strict";
import {
  BusinessServicesCsvError,
  compareBusinessImportDecimals,
  createBusinessServicesCsvTemplate,
  parseBusinessServicesCsv,
} from "./service-csv.js";
import {
  createBusinessImportFieldProvenance,
  reviseBusinessImportFieldProvenance,
} from "./field-provenance.js";

function bytes(value: string, encoding: BufferEncoding = "utf8") {
  return new Uint8Array(Buffer.from(value, encoding));
}

const template = createBusinessServicesCsvTemplate();
assert.match(template, /^external_id,category,name,/u);

const parsed = await parseBusinessServicesCsv(
  bytes(
    [
      "external_id;category;name;description;price_type;price_amount;currency;duration_minutes;active;language",
      'svc-1;Consulting;Audit;"Detailed; review";FIXED;1250.50;EUR;60;true;en',
      "svc-2;Consulting;Planning;;ON_REQUEST;;;;false;ru",
    ].join("\r\n"),
  ),
);
assert.equal(parsed.delimiter, ";");
assert.equal(parsed.counts.totalRows, 2);
assert.equal(parsed.counts.validRows, 2);
assert.equal(parsed.rows[0]?.price?.amount, "1250.50");
assert.equal(parsed.rows[0]?.evidence.price_amount?.row, 2);
assert.equal(parsed.rows[0]?.evidence.price_amount?.column, 6);
assert.equal(parsed.rows[1]?.price?.type, "ON_REQUEST");
assert.equal(parsed.rows[1]?.active, false);
const firstRow = parsed.rows[0];
const firstEvidenceIds = Object.fromEntries(
  Object.keys(firstRow.evidence).map((header) => [header, `evidence-${header}`]),
);
const initialProvenance = createBusinessImportFieldProvenance(firstRow, firstEvidenceIds);
assert.deepEqual(initialProvenance["/name"], {
  authority: "IMPORTED",
  evidenceId: "evidence-name",
});
assert.deepEqual(initialProvenance["/kind"], { authority: "SYSTEM" });
const editedProvenance = reviseBusinessImportFieldProvenance(
  firstRow,
  { ...firstRow, description: "Manual description" },
  initialProvenance,
  new Map(Object.values(firstEvidenceIds).map((id) => [id, `${id}-clone`])),
);
assert.deepEqual(editedProvenance["/description"], { authority: "MANUAL" });
assert.deepEqual(editedProvenance["/name"], {
  authority: "IMPORTED",
  evidenceId: "evidence-name-clone",
});

const priceShapes = await parseBusinessServicesCsv(
  bytes(
    [
      "name,price_type,price_amount,price_from,price_to,currency",
      "Fixed,FIXED,10,,,EUR",
      "From explicit,FROM,,20,,EUR",
      "From shorthand,FROM,30,,,EUR",
      "Range,RANGE,,40,50,EUR",
      "Free,FREE,,,,",
      "On request,ON_REQUEST,,,,",
    ].join("\n"),
  ),
);
assert.deepEqual(
  priceShapes.rows.map((row) => row.price),
  [
    {
      type: "FIXED",
      amount: "10",
      from: null,
      to: null,
      currency: "EUR",
      unit: null,
      taxNote: null,
    },
    {
      type: "FROM",
      amount: null,
      from: "20",
      to: null,
      currency: "EUR",
      unit: null,
      taxNote: null,
    },
    {
      type: "FROM",
      amount: null,
      from: "30",
      to: null,
      currency: "EUR",
      unit: null,
      taxNote: null,
    },
    {
      type: "RANGE",
      amount: null,
      from: "40",
      to: "50",
      currency: "EUR",
      unit: null,
      taxNote: null,
    },
    {
      type: "FREE",
      amount: null,
      from: null,
      to: null,
      currency: null,
      unit: null,
      taxNote: null,
    },
    {
      type: "ON_REQUEST",
      amount: null,
      from: null,
      to: null,
      currency: null,
      unit: null,
      taxNote: null,
    },
  ],
);
const shorthandProvenance = createBusinessImportFieldProvenance(priceShapes.rows[2]!, {
  price_type: "type-evidence",
  price_amount: "amount-evidence",
});
assert.deepEqual(shorthandProvenance["/price/from"], {
  authority: "IMPORTED",
  evidenceId: "amount-evidence",
});
assert.deepEqual(shorthandProvenance["/price/amount"], { authority: "SYSTEM" });
assert.equal(compareBusinessImportDecimals("999999999999.9998", "999999999999.9997"), 1);

const exactRange = await parseBusinessServicesCsv(
  bytes(
    "name,price_type,price_from,price_to,currency\nExact range,RANGE,999999999999.9998,999999999999.9997,EUR",
  ),
);
assert.ok(
  exactRange.rows[0]?.diagnostics.some(
    (item) => item.code === "BUSINESS_IMPORT_PRICE_RANGE_REVERSED",
  ),
);

const incompleteBlocks = await parseBusinessServicesCsv(
  bytes(
    ["name,currency,duration_max_minutes,valid_from", "Incomplete,EUR,90,2026-03-01"].join("\n"),
  ),
);
assert.deepEqual(
  incompleteBlocks.rows[0]?.diagnostics.map((item) => item.code),
  [
    "BUSINESS_IMPORT_DURATION_MINIMUM_REQUIRED",
    "BUSINESS_IMPORT_PRICE_TYPE_INVALID",
    "BUSINESS_IMPORT_PRICE_DATES_REQUIRE_PRICE",
  ],
);

const invalidCalendarDate = await parseBusinessServicesCsv(
  bytes("name,valid_from,valid_until\nImpossible date,2026-02-30,2026-13-01"),
);
assert.equal(invalidCalendarDate.rows[0]?.validFrom, null);
assert.equal(invalidCalendarDate.rows[0]?.validUntil, null);
assert.deepEqual(
  invalidCalendarDate.rows[0]?.diagnostics.map((item) => [item.code, item.field]),
  [
    ["BUSINESS_IMPORT_DATE_INVALID", "valid_from"],
    ["BUSINESS_IMPORT_DATE_INVALID", "valid_until"],
  ],
);

const multiline = await parseBusinessServicesCsv(
  bytes('name,description,price_type,currency\nAudit,"Line one\nLine two",FREE,\n'),
);
assert.equal(multiline.rows[0]?.description, "Line one\nLine two");

const formulaLiteral = await parseBusinessServicesCsv(bytes("name\n=SUM(A1:A2)\n"));
assert.equal(formulaLiteral.rows[0]?.name, "=SUM(A1:A2)");

const bom = await parseBusinessServicesCsv(bytes("\uFEFFname,description\nAudit,Review\n"));
assert.equal(bom.encoding, "utf-8");
assert.equal(bom.rows[0]?.name, "Audit");

const windows1251 = await parseBusinessServicesCsv(
  new Uint8Array([0xf3, 0xf1, 0xeb, 0xf3, 0xe3, 0xe0, 0x0a, 0xc0, 0xf3, 0xe4, 0xe8, 0xf2, 0x0a]),
);
assert.equal(windows1251.encoding, "windows-1251");
assert.equal(windows1251.rows[0]?.name, "Аудит");

const invalid = await parseBusinessServicesCsv(
  bytes("name,price_type,price_amount,currency,duration_minutes\nAudit,FIXED,12,EUR,0\n"),
);
assert.equal(invalid.counts.invalidRows, 1);
assert.ok(
  invalid.rows[0]?.diagnostics.some((item) => item.code === "BUSINESS_IMPORT_DURATION_INVALID"),
);

const invalidCurrency = await parseBusinessServicesCsv(
  bytes("name,price_type,price_amount,currency\nAudit,FIXED,12,ZZZ\n"),
);
assert.equal(invalidCurrency.rows[0]?.valid, false);
assert.ok(
  invalidCurrency.rows[0]?.diagnostics.some(
    (item) => item.code === "BUSINESS_IMPORT_CURRENCY_INVALID",
  ),
);

const russianHeaders = await parseBusinessServicesCsv(
  bytes("услуга;описание;тип цены;цена;валюта\nАудит;Проверка;FIXED;1000;RUB\n"),
);
assert.equal(russianHeaders.rows[0]?.name, "Аудит");

const excessiveServices = [
  "name",
  ...Array.from({ length: 201 }, (_, index) => `Service ${index + 1}`),
].join("\n");
await assert.rejects(
  parseBusinessServicesCsv(bytes(excessiveServices)),
  (error: unknown) =>
    error instanceof BusinessServicesCsvError && error.code === "BUSINESS_IMPORT_SERVICE_LIMIT",
);

await assert.rejects(
  parseBusinessServicesCsv(bytes("name,price\nAudit,10\nAudit 2,20\n"), { maxServices: 1 }),
  (error: unknown) =>
    error instanceof BusinessServicesCsvError && error.code === "BUSINESS_IMPORT_SERVICE_LIMIT",
);

await assert.rejects(
  parseBusinessServicesCsv(bytes("name,service_name\nAudit,Duplicate\n")),
  (error: unknown) =>
    error instanceof BusinessServicesCsvError &&
    error.code === "BUSINESS_IMPORT_CSV_DUPLICATE_COLUMN",
);

await assert.rejects(
  parseBusinessServicesCsv(bytes("name,description\nAudit\n")),
  (error: unknown) =>
    error instanceof BusinessServicesCsvError &&
    error.code === "BUSINESS_IMPORT_CSV_DELIMITER_UNKNOWN",
);

process.stdout.write("business services CSV smoke passed\n");
