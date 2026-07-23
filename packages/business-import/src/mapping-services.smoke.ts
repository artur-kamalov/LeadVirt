import assert from "node:assert/strict";
import {
  analyzeBusinessServicesCsv,
  isExactBusinessServicesCsvContract,
  parseMappedBusinessServicesCsv,
  proposeBusinessServiceMapping,
  validateConfirmedBusinessServiceMapping,
  type ConfirmedBusinessServiceMapping,
} from "./service-mapping.js";

const bytes = (value: string) => new TextEncoder().encode(value);

async function parseSmartValue(
  target: "price" | "duration",
  value: string,
  defaults: ConfirmedBusinessServiceMapping["defaults"] = {
    locale: null,
    numberFormat: null,
    currency: null,
    timezone: null,
    unit: null,
  },
) {
  const csv = `Service;Value\nConsultation;${value}\n`;
  const analysis = await analyzeBusinessServicesCsv(bytes(csv));
  return parseMappedBusinessServicesCsv(bytes(csv), {
    tableKey: analysis.tableKey,
    schemaHash: analysis.schemaHash,
    headerRow: analysis.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target },
    ],
    defaults,
  });
}

async function assertSmartValueInvalid(
  target: "price" | "duration",
  value: string,
  defaults?: ConfirmedBusinessServiceMapping["defaults"],
) {
  const parsed = await parseSmartValue(target, value, defaults);
  assert.equal(parsed.rows[0]?.valid, false, `${target} '${value}' must fail closed`);
  assert.ok(
    parsed.rows[0]?.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        (target === "price"
          ? "BUSINESS_IMPORT_PRICE_EXPRESSION_INVALID"
          : "BUSINESS_IMPORT_DURATION_EXPRESSION_INVALID"),
    ),
  );
}

const arbitrary = await analyzeBusinessServicesCsv(
  bytes(
    [
      "Прайс-лист Factura;;",
      "Название;Цена;Время",
      "Консультация;от 5 000 ₽;1 час",
      "Аудит;10 000–15 000 ₽;90 минут",
      "Знакомство;бесплатно;30 минут",
    ].join("\r\n"),
  ),
);
assert.equal(arbitrary.delimiter, ";");
assert.equal(arbitrary.headerRow, 2);
assert.equal(arbitrary.rowCount, 3);
assert.deepEqual(
  arbitrary.columns.map((column) => column.columnKey),
  ["column:1", "column:2", "column:3"],
);
assert.deepEqual(
  arbitrary.columns[1]?.samples.map((sample) => sample.value),
  ["от 5 000 ₽", "10 000–15 000 ₽", "бесплатно"],
);

const proposal = proposeBusinessServiceMapping(arbitrary);
assert.deepEqual(
  proposal.columns.map((column) => [column.target, column.status]),
  [
    ["name", "MATCHED"],
    ["price", "MATCHED"],
    ["duration", "MATCHED"],
  ],
);
assert.equal(isExactBusinessServicesCsvContract(arbitrary, proposal), false);

const mapping = {
  tableKey: arbitrary.tableKey,
  schemaHash: arbitrary.schemaHash,
  headerRow: arbitrary.headerRow,
  columns: [
    { sourceColumnKey: "column:1", target: "name" },
    { sourceColumnKey: "column:2", target: "price" },
    { sourceColumnKey: "column:3", target: "duration" },
  ],
  defaults: {
    locale: "ru",
    numberFormat: "DECIMAL_COMMA",
    currency: null,
    timezone: null,
    unit: "service",
  },
} satisfies ConfirmedBusinessServiceMapping;
const parsed = await parseMappedBusinessServicesCsv(
  bytes(
    [
      "Прайс-лист Factura;;",
      "Название;Цена;Время",
      "Консультация;от 5 000 ₽;1 час",
      "Аудит;10 000–15 000 ₽;90 минут",
      "Знакомство;бесплатно;30 минут",
    ].join("\r\n"),
  ),
  mapping,
);
assert.equal(parsed.counts.validRows, 3);
assert.deepEqual(parsed.rows[0]?.price, {
  type: "FROM",
  amount: null,
  from: "5000",
  to: null,
  currency: "RUB",
  unit: "service",
  taxNote: null,
});
assert.deepEqual(parsed.rows[1]?.price, {
  type: "RANGE",
  amount: null,
  from: "10000",
  to: "15000",
  currency: "RUB",
  unit: "service",
  taxNote: null,
});
assert.equal(parsed.rows[2]?.price?.type, "FREE");
assert.deepEqual(parsed.rows[0]?.duration, { minimumMinutes: 60, maximumMinutes: null });
assert.equal(parsed.rows[0]?.language, "ru");
assert.equal(parsed.rows[0]?.evidence.currency?.sourceValue, "от 5 000 ₽");
assert.equal(parsed.rows[0]?.evidence.language, undefined);
assert.equal(parsed.rows[0]?.evidence.price_unit, undefined);

const ambiguousCurrency = await analyzeBusinessServicesCsv(
  bytes("Service,Cost\nConsultation,$50\n"),
);
const ambiguousParsed = await parseMappedBusinessServicesCsv(
  bytes("Service,Cost\nConsultation,$50\n"),
  {
    tableKey: ambiguousCurrency.tableKey,
    schemaHash: ambiguousCurrency.schemaHash,
    headerRow: ambiguousCurrency.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "price" },
    ],
    defaults: {
      locale: null,
      numberFormat: null,
      currency: null,
      timezone: null,
      unit: null,
    },
  },
);
assert.equal(ambiguousParsed.rows[0]?.valid, false);
assert.ok(
  ambiguousParsed.rows[0]?.diagnostics.some(
    (diagnostic) => diagnostic.code === "BUSINESS_IMPORT_CURRENCY_REQUIRED",
  ),
);

const separateCurrency = await analyzeBusinessServicesCsv(
  bytes("Service;Price;Currency\nConsultation;$50;USD\n"),
);
const separateCurrencyParsed = await parseMappedBusinessServicesCsv(
  bytes("Service;Price;Currency\nConsultation;$50;USD\n"),
  {
    tableKey: separateCurrency.tableKey,
    schemaHash: separateCurrency.schemaHash,
    headerRow: separateCurrency.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "price" },
      { sourceColumnKey: "column:3", target: "currency" },
    ],
    defaults: {
      locale: null,
      numberFormat: null,
      currency: null,
      timezone: null,
      unit: null,
    },
  },
);
assert.equal(separateCurrencyParsed.rows[0]?.valid, true);
assert.equal(separateCurrencyParsed.rows[0]?.price?.amount, "50");
assert.equal(separateCurrencyParsed.rows[0]?.price?.currency, "USD");
assert.equal(separateCurrencyParsed.rows[0]?.evidence.currency?.sourceValue, "USD");

for (const [separate, expectedValid] of [
  ["EUR", true],
  ["USD", false],
] as const) {
  const csv = `Service;Price;Currency\nConsultation;100 EUR;${separate}\n`;
  const analysis = await analyzeBusinessServicesCsv(bytes(csv));
  const result = await parseMappedBusinessServicesCsv(bytes(csv), {
    tableKey: analysis.tableKey,
    schemaHash: analysis.schemaHash,
    headerRow: analysis.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "price" },
      { sourceColumnKey: "column:3", target: "currency" },
    ],
    defaults: {
      locale: "en",
      numberFormat: "DECIMAL_DOT",
      currency: null,
      timezone: null,
      unit: null,
    },
  });
  assert.equal(result.rows[0]?.valid, expectedValid);
  if (!expectedValid) {
    assert.ok(
      result.rows[0]?.diagnostics.some(
        (diagnostic) => diagnostic.code === "BUSINESS_IMPORT_CURRENCY_CONFLICT",
      ),
    );
  }
}

const emptySeparateCurrencyCsv = "Service;Price;Currency\nConsultation;100 EUR;\n";
const emptySeparateCurrencyAnalysis = await analyzeBusinessServicesCsv(
  bytes(emptySeparateCurrencyCsv),
);
const emptySeparateCurrency = await parseMappedBusinessServicesCsv(
  bytes(emptySeparateCurrencyCsv),
  {
    tableKey: emptySeparateCurrencyAnalysis.tableKey,
    schemaHash: emptySeparateCurrencyAnalysis.schemaHash,
    headerRow: emptySeparateCurrencyAnalysis.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "price" },
      { sourceColumnKey: "column:3", target: "currency" },
    ],
    defaults: {
      locale: "en",
      numberFormat: "DECIMAL_DOT",
      currency: null,
      timezone: null,
      unit: null,
    },
  },
);
assert.equal(emptySeparateCurrency.rows[0]?.valid, true);
assert.equal(emptySeparateCurrency.rows[0]?.price?.currency, "EUR");
assert.equal(emptySeparateCurrency.rows[0]?.evidence.currency?.sourceValue, "100 EUR");

const unknownSeparateCurrencyCsv = "Service;Price;Currency\nConsultation;$100;NET\n";
const unknownSeparateCurrencyAnalysis = await analyzeBusinessServicesCsv(
  bytes(unknownSeparateCurrencyCsv),
);
const unknownSeparateCurrency = await parseMappedBusinessServicesCsv(
  bytes(unknownSeparateCurrencyCsv),
  {
    tableKey: unknownSeparateCurrencyAnalysis.tableKey,
    schemaHash: unknownSeparateCurrencyAnalysis.schemaHash,
    headerRow: unknownSeparateCurrencyAnalysis.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "price" },
      { sourceColumnKey: "column:3", target: "currency" },
    ],
    defaults: {
      locale: "en",
      numberFormat: "DECIMAL_DOT",
      currency: null,
      timezone: null,
      unit: null,
    },
  },
);
assert.equal(unknownSeparateCurrency.rows[0]?.valid, false);
assert.ok(
  unknownSeparateCurrency.rows[0]?.diagnostics.some(
    (diagnostic) => diagnostic.code === "BUSINESS_IMPORT_CURRENCY_INVALID",
  ),
);

const localizedThousands = await parseSmartValue("price", "1,234 CHF", {
  locale: "en",
  numberFormat: "DECIMAL_DOT",
  currency: "EUR",
  timezone: null,
  unit: null,
});
assert.equal(localizedThousands.rows[0]?.valid, true);
assert.equal(localizedThousands.rows[0]?.price?.amount, "1234");
assert.equal(localizedThousands.rows[0]?.price?.currency, "CHF");

const independentLocale = await parseSmartValue("price", "1,234 CHF", {
  locale: "ru",
  numberFormat: "DECIMAL_DOT",
  currency: null,
  timezone: null,
  unit: null,
});
assert.equal(independentLocale.rows[0]?.price?.amount, "1234");
assert.equal(independentLocale.rows[0]?.language, "ru");

const decimalComma = await parseSmartValue("price", "1.234,56 EUR", {
  locale: "en",
  numberFormat: "DECIMAL_COMMA",
  currency: null,
  timezone: null,
  unit: null,
});
assert.equal(decimalComma.rows[0]?.price?.amount, "1234.56");
assert.equal(decimalComma.rows[0]?.language, "en");

const directLeafCsv = bytes("Service;Amount;Currency\nConsultation;1.234,56;EUR\n");
const directLeafAnalysis = await analyzeBusinessServicesCsv(directLeafCsv);
const directLeaf = await parseMappedBusinessServicesCsv(directLeafCsv, {
  tableKey: directLeafAnalysis.tableKey,
  schemaHash: directLeafAnalysis.schemaHash,
  headerRow: directLeafAnalysis.headerRow,
  columns: [
    { sourceColumnKey: "column:1", target: "name" },
    { sourceColumnKey: "column:2", target: "price_amount" },
    { sourceColumnKey: "column:3", target: "currency" },
  ],
  defaults: {
    locale: null,
    numberFormat: "DECIMAL_COMMA",
    currency: null,
    timezone: null,
    unit: null,
  },
});
assert.equal(directLeaf.rows[0]?.valid, true);
assert.equal(directLeaf.rows[0]?.price?.amount, "1234.56");

for (const currentCurrencyValue of ["100 ZWG", "100 zwg", "100 ZwG"]) {
  const currentCurrency = await parseSmartValue("price", currentCurrencyValue, {
    locale: null,
    numberFormat: null,
    currency: null,
    timezone: null,
    unit: null,
  });
  assert.equal(currentCurrency.rows[0]?.valid, true);
  assert.equal(currentCurrency.rows[0]?.price?.currency, "ZWG");
}
for (const obsoleteOrSpecialCurrency of [
  "100 BGN",
  "100 bgn",
  "100 Bgn",
  "100 zzz",
  "100 XTS",
  "100 XXX",
]) {
  await assertSmartValueInvalid("price", obsoleteOrSpecialCurrency, {
    locale: null,
    numberFormat: null,
    currency: "EUR",
    timezone: null,
    unit: null,
  });
}

const ambiguousThousands = await parseSmartValue("price", "1,234 EUR");
assert.equal(ambiguousThousands.rows[0]?.valid, false);
assert.ok(
  ambiguousThousands.rows[0]?.diagnostics.some(
    (diagnostic) => diagnostic.code === "BUSINESS_IMPORT_PRICE_EXPRESSION_INVALID",
  ),
);

for (const invalidPrice of [
  "-50 EUR",
  "–50 EUR",
  "—50 EUR",
  "−50 EUR",
  "(50) EUR",
  "2 sessions 100 EUR",
  "100 NET",
  "50% OFF",
  "$100 EUR",
  "¥100 USD",
  "$100",
  "¥100",
  "XX$100",
  "up to 50 EUR",
  "50--100 EUR",
]) {
  await assertSmartValueInvalid("price", invalidPrice, {
    locale: "en",
    numberFormat: "DECIMAL_DOT",
    currency: "EUR",
    timezone: null,
    unit: null,
  });
}

for (const duration of ["1h 30m", "1 h 30 min", "1 h + 30 min"]) {
  const mixed = await parseSmartValue("duration", duration);
  assert.deepEqual(mixed.rows[0]?.duration, {
    minimumMinutes: 90,
    maximumMinutes: null,
  });
}
const durationRange = await parseSmartValue("duration", "30-45 min");
assert.deepEqual(durationRange.rows[0]?.duration, {
  minimumMinutes: 30,
  maximumMinutes: 45,
});
const repeatedUnitDurationRange = await parseSmartValue("duration", "30 min - 45 min");
assert.deepEqual(repeatedUnitDurationRange.rows[0]?.duration, {
  minimumMinutes: 30,
  maximumMinutes: 45,
});
const negativeDuration = await parseSmartValue("duration", "-30 min");
assert.equal(negativeDuration.rows[0]?.valid, false);
assert.ok(
  negativeDuration.rows[0]?.diagnostics.some(
    (diagnostic) => diagnostic.code === "BUSINESS_IMPORT_DURATION_EXPRESSION_INVALID",
  ),
);
for (const invalidDuration of [
  "–30 min",
  "—30 min",
  "−30 min",
  "(30 min)",
  "1,000 min",
  "1.5 min",
  "1.333 h",
  "90 min / 1.5 h",
  "1 h (60 min)",
  "2",
  "30-45",
  "≤30 min",
  ">30 min",
  "до 30 минут",
  "bis 30 min",
]) {
  await assertSmartValueInvalid("duration", invalidDuration);
}

for (const [value, fallback, expectedCurrency] of [
  ["US$100", "CAD", "USD"],
  ["CA$100", "USD", "CAD"],
  ["C$100", "USD", "CAD"],
  ["A$100", "CAD", "AUD"],
  ["AU$100", "CAD", "AUD"],
  ["NZ$100", "USD", "NZD"],
  ["HK$100", "USD", "HKD"],
  ["S$100", "USD", "SGD"],
  ["CN¥100", "JPY", "CNY"],
  ["JP¥100", "CNY", "JPY"],
] as const) {
  const qualified = await parseSmartValue("price", value, {
    locale: "en",
    numberFormat: "DECIMAL_DOT",
    currency: fallback,
    timezone: null,
    unit: null,
  });
  assert.equal(qualified.rows[0]?.valid, true);
  assert.equal(qualified.rows[0]?.price?.currency, expectedCurrency);
}

for (const value of ["minimum 50 EUR", "50+ EUR"]) {
  const minimum = await parseSmartValue("price", value, {
    locale: "en",
    numberFormat: "DECIMAL_DOT",
    currency: null,
    timezone: null,
    unit: "service",
  });
  assert.equal(minimum.rows[0]?.valid, true);
  assert.equal(minimum.rows[0]?.price?.type, "FROM");
}
const embeddedUnit = await parseSmartValue("price", "50 EUR/hour", {
  locale: "en",
  numberFormat: "DECIMAL_DOT",
  currency: null,
  timezone: null,
  unit: "service",
});
assert.equal(embeddedUnit.rows[0]?.valid, true);
assert.equal(embeddedUnit.rows[0]?.price?.unit, "hour");
assert.equal(embeddedUnit.rows[0]?.evidence.price_unit?.sourceValue, "50 EUR/hour");
const uppercaseEmbeddedUnit = await parseSmartValue("price", "50 EUR PER DAY", {
  locale: "en",
  numberFormat: "DECIMAL_DOT",
  currency: null,
  timezone: null,
  unit: "service",
});
assert.equal(uppercaseEmbeddedUnit.rows[0]?.valid, true);
assert.equal(uppercaseEmbeddedUnit.rows[0]?.price?.unit, "day");
const repeatedCurrencyRange = await parseSmartValue("price", "50 EUR - 100 EUR", {
  locale: "en",
  numberFormat: "DECIMAL_DOT",
  currency: null,
  timezone: null,
  unit: null,
});
assert.equal(repeatedCurrencyRange.rows[0]?.valid, true);
assert.deepEqual(repeatedCurrencyRange.rows[0]?.price, {
  type: "RANGE",
  amount: null,
  from: "50",
  to: "100",
  currency: "EUR",
  unit: null,
  taxNote: null,
});

const structuralDelimiter = await analyzeBusinessServicesCsv(
  bytes("Name;Summary, short, public\nAudit;Review, fast, remote\n"),
);
assert.equal(structuralDelimiter.delimiter, ";");
assert.equal(structuralDelimiter.columns.length, 2);

await assert.rejects(
  () => analyzeBusinessServicesCsv(bytes("foo,name;price\nx,cut;100\n")),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    error.code === "BUSINESS_IMPORT_CSV_DELIMITER_AMBIGUOUS",
);

const sparsePreamble = await analyzeBusinessServicesCsv(bytes("Price;\nItem;Rate\nAudit;100\n"));
assert.equal(sparsePreamble.headerRow, 2);
assert.deepEqual(
  sparsePreamble.columns.map((column) => column.header),
  ["Item", "Rate"],
);

const populatedPreamble = await analyzeBusinessServicesCsv(
  bytes("Price list;2026\nService;Price\nCut;100 EUR\n"),
);
assert.equal(populatedPreamble.headerRow, 2);
assert.deepEqual(
  populatedPreamble.columns.map((column) => column.header),
  ["Service", "Price"],
);

const arbitraryHeadersBeforeAliasLikeData = await analyzeBusinessServicesCsv(
  bytes("Offering title;Rate\nService;EUR\n"),
);
assert.equal(arbitraryHeadersBeforeAliasLikeData.headerRow, 1);

const localizedBooleans = await analyzeBusinessServicesCsv(
  bytes(
    [
      "Service;Flag",
      "One;ja",
      "Two;nein",
      "Three;oui",
      "Four;non",
      "Five;sí",
      "Six;sim",
      "Seven;nao",
      "Eight;não",
    ].join("\n"),
  ),
);
const localizedBooleanProposal = proposeBusinessServiceMapping(localizedBooleans);
assert.deepEqual(
  localizedBooleanProposal.columns.map((column) => [column.target, column.status]),
  [
    ["name", "MATCHED"],
    ["active", "CHECK_MAPPING"],
  ],
);
const localizedBooleanRows = await parseMappedBusinessServicesCsv(
  bytes(
    [
      "Service;Flag",
      "One;ja",
      "Two;nein",
      "Three;oui",
      "Four;non",
      "Five;sí",
      "Six;sim",
      "Seven;nao",
      "Eight;não",
    ].join("\n"),
  ),
  {
    tableKey: localizedBooleans.tableKey,
    schemaHash: localizedBooleans.schemaHash,
    headerRow: localizedBooleans.headerRow,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "active" },
    ],
    defaults: {
      locale: null,
      numberFormat: null,
      currency: null,
      timezone: null,
      unit: null,
    },
  },
);
assert.equal(localizedBooleanRows.counts.validRows, 8);
assert.deepEqual(
  localizedBooleanRows.rows.map((row) => row.active),
  [true, false, true, false, true, true, false, false],
);

const incompatibleLeaves = await analyzeBusinessServicesCsv(
  bytes("Service;Amount;From;To\nAudit;50;100;200\n"),
);
assert.throws(
  () =>
    validateConfirmedBusinessServiceMapping(incompatibleLeaves, {
      tableKey: incompatibleLeaves.tableKey,
      schemaHash: incompatibleLeaves.schemaHash,
      headerRow: incompatibleLeaves.headerRow,
      columns: [
        { sourceColumnKey: "column:1", target: "name" },
        { sourceColumnKey: "column:2", target: "price_amount" },
        { sourceColumnKey: "column:3", target: "price_from" },
        { sourceColumnKey: "column:4", target: "price_to" },
      ],
      defaults: {
        locale: null,
        numberFormat: null,
        currency: "EUR",
        timezone: null,
        unit: null,
      },
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    error.code === "BUSINESS_IMPORT_MAPPING_TARGET_AMBIGUOUS",
);

const exact = await analyzeBusinessServicesCsv(
  bytes("external_id,category,name,price_type,price_amount,currency\n1,Hair,Cut,FIXED,25,EUR\n"),
);
assert.equal(isExactBusinessServicesCsvContract(exact, proposeBusinessServiceMapping(exact)), true);

await assert.rejects(
  () =>
    parseMappedBusinessServicesCsv(bytes("Service,Cost\nConsultation,50 EUR\n"), {
      tableKey: "csv:services",
      schemaHash: "0".repeat(64),
      headerRow: 1,
      columns: [
        { sourceColumnKey: "column:1", target: "name" },
        { sourceColumnKey: "column:2", target: "price" },
      ],
      defaults: {
        locale: null,
        numberFormat: null,
        currency: null,
        timezone: null,
        unit: null,
      },
    }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    error.code === "BUSINESS_IMPORT_MAPPING_SCHEMA_CHANGED",
);

console.log("business import mapping smoke passed");
