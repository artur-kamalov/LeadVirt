import {
  businessOfferingCandidateKey,
  businessOfferingCanonicalValueHash,
  businessOfferingIdentityKey,
  businessOfferingValueHash,
  normalizeBusinessExternalId,
} from "./identity.js";
import {
  BUSINESS_SERVICES_CSV_HEADERS,
  canonicalBusinessImportDecimal,
  type BusinessImportDiagnostic,
  type BusinessServiceCsvHeader,
  type ParsedBusinessServiceRow,
} from "./service-csv.js";

export type BusinessImportRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED";
export type BusinessImportConfidence = "CONFIRMED_FORMAT" | "HIGH" | "MEDIUM" | "LOW";

export type BusinessServiceDiffAction =
  | "ADD"
  | "UPDATE"
  | "LINK"
  | "UNCHANGED"
  | "CONFLICT"
  | "INVALID"
  | "MISSING";

export interface ExistingBusinessOffering {
  id: string;
  value: ParsedBusinessServiceRow;
  valueHash: string;
}

export interface BusinessOfferingSourceBinding {
  offeringId: string;
  externalKey: string;
  identityKey: string;
  sourceValueHash: string;
}

export interface BusinessServiceDiffCandidate {
  candidateKey: string;
  action: BusinessServiceDiffAction;
  riskLevel: BusinessImportRiskLevel;
  confidence: BusinessImportConfidence;
  proposed: ParsedBusinessServiceRow | null;
  current: ExistingBusinessOffering | null;
  targetOfferingId: string | null;
  sourceExternalKey: string | null;
  identityKey: string;
  proposedValueHash: string | null;
  diagnostics: BusinessImportDiagnostic[];
}

function risk(value: ParsedBusinessServiceRow): BusinessImportRiskLevel {
  if (value.price) return "HIGH";
  if (value.duration || value.bookingNotes) return "MEDIUM";
  return "LOW";
}

function conflictDiagnostic(row: number): BusinessImportDiagnostic {
  return {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_POSSIBLE_DUPLICATE",
    message: "This row has no stable external ID and may duplicate an existing service.",
    row,
  };
}

function ambiguousBindingDiagnostic(row: number): BusinessImportDiagnostic {
  return {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_AMBIGUOUS_SOURCE_BINDING",
    message: "This row matches more than one source binding and requires manual resolution.",
    row,
  };
}

function ambiguousIdentityDiagnostic(row: number): BusinessImportDiagnostic {
  return {
    severity: "WARNING",
    code: "BUSINESS_IMPORT_AMBIGUOUS_CANONICAL_IDENTITY",
    message: "This row matches more than one existing service and requires manual resolution.",
    row,
  };
}

function addBinding(
  index: Map<string, BusinessOfferingSourceBinding[]>,
  key: string,
  binding: BusinessOfferingSourceBinding,
) {
  if (!key) return;
  index.set(key, [...(index.get(key) ?? []), binding]);
}

function csvFieldValue(row: ParsedBusinessServiceRow, field: BusinessServiceCsvHeader) {
  switch (field) {
    case "external_id":
      return normalizeBusinessExternalId(row.externalId);
    case "category":
      return row.category;
    case "name":
      return row.name;
    case "description":
      return row.description;
    case "price_type":
      return row.price?.type ?? null;
    case "price_amount":
      return canonicalBusinessImportDecimal(row.price?.amount ?? null);
    case "price_from":
      return canonicalBusinessImportDecimal(row.price?.from ?? null);
    case "price_to":
      return canonicalBusinessImportDecimal(row.price?.to ?? null);
    case "currency":
      return row.price?.currency ?? null;
    case "price_unit":
      return row.price?.unit ?? null;
    case "tax_note":
      return row.price?.taxNote ?? null;
    case "duration_minutes":
      return row.duration?.minimumMinutes ?? null;
    case "duration_max_minutes":
      return row.duration?.maximumMinutes ?? null;
    case "location_external_id":
      return row.locationExternalId;
    case "booking_notes":
      return row.bookingNotes;
    case "active":
      return row.active;
    case "valid_from":
      return row.validFrom;
    case "valid_until":
      return row.validUntil;
    case "language":
      return row.language;
  }
}

function incompleteReplacementDiagnostic(
  row: ParsedBusinessServiceRow,
  current?: ParsedBusinessServiceRow,
) {
  const missing = BUSINESS_SERVICES_CSV_HEADERS.filter(
    (field) =>
      !(field in row.evidence) &&
      (!current || csvFieldValue(row, field) !== csvFieldValue(current, field)),
  );
  if (missing.length === 0) return null;
  return {
    severity: "ERROR" as const,
    code: "BUSINESS_IMPORT_PARTIAL_UPDATE_UNSUPPORTED",
    message: `Updating an existing service requires the complete template. Missing columns: ${missing.join(", ")}.`,
    row: row.sourceRow,
  } satisfies BusinessImportDiagnostic;
}

export function diffBusinessServiceRows(input: {
  sourceLineageId: string;
  rows: ParsedBusinessServiceRow[];
  existing: ExistingBusinessOffering[];
  sourceBindings: BusinessOfferingSourceBinding[];
}): BusinessServiceDiffCandidate[] {
  const existingById = new Map(input.existing.map((item) => [item.id, item]));
  const existingByIdentity = new Map<string, ExistingBusinessOffering[]>();
  for (const item of input.existing) {
    const key = businessOfferingIdentityKey(item.value);
    existingByIdentity.set(key, [...(existingByIdentity.get(key) ?? []), item]);
  }
  const bindingsByExternal = new Map<string, BusinessOfferingSourceBinding[]>();
  const bindingsByIdentity = new Map<string, BusinessOfferingSourceBinding[]>();
  for (const binding of input.sourceBindings) {
    addBinding(bindingsByExternal, normalizeBusinessExternalId(binding.externalKey), binding);
    addBinding(bindingsByIdentity, binding.identityKey, binding);
  }
  const matchedOfferingIds = new Set<string>();
  const candidates = input.rows.map((row): BusinessServiceDiffCandidate => {
    const identityKey = businessOfferingIdentityKey(row);
    const proposedValueHash = businessOfferingValueHash(row);
    const candidateKey = businessOfferingCandidateKey(input.sourceLineageId, row);
    if (!row.valid) {
      return {
        candidateKey,
        action: "INVALID",
        riskLevel: risk(row),
        confidence: "CONFIRMED_FORMAT",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: row.diagnostics,
      };
    }
    const externalKey = normalizeBusinessExternalId(row.externalId);
    const matchingBindings = externalKey
      ? (bindingsByExternal.get(externalKey) ?? [])
      : (bindingsByIdentity.get(identityKey) ?? []);
    if (matchingBindings.length > 1) {
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "LOW",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, ambiguousBindingDiagnostic(row.sourceRow)],
      };
    }
    const binding = matchingBindings[0];
    const bound = binding ? existingById.get(binding.offeringId) : undefined;
    if (bound) {
      matchedOfferingIds.add(bound.id);
      const changed = bound.valueHash !== proposedValueHash;
      const incomplete = changed ? incompleteReplacementDiagnostic(row) : null;
      return {
        candidateKey,
        action: incomplete ? "INVALID" : changed ? "UPDATE" : "UNCHANGED",
        riskLevel: risk(row),
        confidence: "CONFIRMED_FORMAT",
        proposed: row,
        current: bound,
        targetOfferingId: bound.id,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: incomplete ? [...row.diagnostics, incomplete] : row.diagnostics,
      };
    }
    const exact = existingByIdentity.get(identityKey) ?? [];
    if (exact.length > 1) {
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "LOW",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, ambiguousIdentityDiagnostic(row.sourceRow)],
      };
    }
    if (exact.length === 1) {
      const exactOffering = exact[0]!;
      const exactSourceBindings = input.sourceBindings.filter(
        (item) => item.offeringId === exactOffering.id,
      );
      if (
        externalKey &&
        matchingBindings.length === 0 &&
        exactSourceBindings.length === 1 &&
        exactSourceBindings[0]?.identityKey === identityKey &&
        !matchedOfferingIds.has(exactOffering.id)
      ) {
        matchedOfferingIds.add(exactOffering.id);
        const changed = exactOffering.valueHash !== proposedValueHash;
        const incomplete = changed
          ? incompleteReplacementDiagnostic(row, exactOffering.value)
          : null;
        return {
          candidateKey,
          action: incomplete ? "INVALID" : changed ? "UPDATE" : "UNCHANGED",
          riskLevel: risk(row),
          confidence: "HIGH",
          proposed: row,
          current: exactOffering,
          targetOfferingId: exactOffering.id,
          sourceExternalKey: row.externalId,
          identityKey,
          proposedValueHash,
          diagnostics: incomplete ? [...row.diagnostics, incomplete] : row.diagnostics,
        };
      }
      if (
        !input.sourceBindings.some((item) => item.offeringId === exactOffering.id) &&
        businessOfferingCanonicalValueHash(exactOffering.value) ===
          businessOfferingCanonicalValueHash(row)
      ) {
        matchedOfferingIds.add(exactOffering.id);
        return {
          candidateKey,
          action: "LINK",
          riskLevel: "LOW",
          confidence: "HIGH",
          proposed: row,
          current: exactOffering,
          targetOfferingId: exactOffering.id,
          sourceExternalKey: row.externalId,
          identityKey,
          proposedValueHash,
          diagnostics: row.diagnostics,
        };
      }
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "MEDIUM",
        proposed: row,
        current: exact[0] ?? null,
        targetOfferingId: exact[0]?.id ?? null,
        sourceExternalKey: row.externalId,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, conflictDiagnostic(row.sourceRow)],
      };
    }
    const sourceAlreadyHasRows = input.sourceBindings.length > 0;
    if (!externalKey && sourceAlreadyHasRows) {
      return {
        candidateKey,
        action: "CONFLICT",
        riskLevel: risk(row),
        confidence: "LOW",
        proposed: row,
        current: null,
        targetOfferingId: null,
        sourceExternalKey: null,
        identityKey,
        proposedValueHash,
        diagnostics: [...row.diagnostics, conflictDiagnostic(row.sourceRow)],
      };
    }
    return {
      candidateKey,
      action: "ADD",
      riskLevel: risk(row),
      confidence: "CONFIRMED_FORMAT",
      proposed: row,
      current: null,
      targetOfferingId: null,
      sourceExternalKey: row.externalId,
      identityKey,
      proposedValueHash,
      diagnostics: row.diagnostics,
    };
  });
  for (const binding of input.sourceBindings) {
    if (matchedOfferingIds.has(binding.offeringId)) continue;
    const existing = existingById.get(binding.offeringId);
    if (!existing) continue;
    candidates.push({
      candidateKey: businessOfferingCandidateKey(input.sourceLineageId, existing.value),
      action: "MISSING",
      riskLevel: "HIGH",
      confidence: "CONFIRMED_FORMAT",
      proposed: null,
      current: existing,
      targetOfferingId: existing.id,
      sourceExternalKey: binding.externalKey || null,
      identityKey: binding.identityKey,
      proposedValueHash: null,
      diagnostics: [
        {
          severity: "WARNING",
          code: "BUSINESS_IMPORT_MISSING_FROM_REVISION",
          message: "This existing service is absent from the new file and will remain unchanged.",
        },
      ],
    });
  }
  return candidates;
}
