import { createHash } from "node:crypto";
import { compareKnowledgeCanonicalText } from "./canonical-order.js";

export const KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION =
  "knowledge-capability-snapshot-v2" as const;
export const KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1 = "knowledge-requirement-v1" as const;
export const KNOWLEDGE_CAPABILITY_TENANT_SUPPORTED_LOCALES_V1 = "TENANT_SUPPORTED" as const;

export type KnowledgeCapabilityTypeV1 =
  | "GENERAL_FAQ"
  | "LEAD_QUALIFICATION"
  | "PRICING"
  | "APPOINTMENT_DISCOVERY"
  | "APPOINTMENT_BOOKING"
  | "ORDER_ACCOUNT_SUPPORT"
  | "COMMERCE_RECOMMENDATION"
  | "REGULATED_TOPIC";

export type KnowledgeCapabilityAutonomyV1 =
  | "ANSWER_ONLY"
  | "COLLECT_INFORMATION"
  | "PROPOSE_ACTION"
  | "ACT_WITH_CONFIRMATION"
  | "AUTONOMOUS_ACTION";

export type KnowledgeCapabilityRequirementKindV1 =
  | "FACT"
  | "RULE"
  | "DOCUMENT_COVERAGE"
  | "CONNECTOR"
  | "TOOL"
  | "PERMISSION"
  | "LOCALE"
  | "EVALUATION_CASE";

export type KnowledgeCapabilityRequirementOperatorV1 =
  | "FACT_KEY_EQUALS"
  | "FACT_KEY_PREFIX"
  | "FIELD_TYPE_IN"
  | "RULE_TYPE_IN"
  | "DOCUMENT_COUNT"
  | "CONNECTOR_CONNECTED"
  | "TOOL_AVAILABLE"
  | "PERMISSION_GRANTED"
  | "LOCALE_COVERAGE"
  | "EVALUATION_CASE_PASS";

export type KnowledgeCapabilityRequirementSeverityV1 = "BLOCKER" | "WARNING";
export type KnowledgeCapabilityRiskLevelV1 = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type KnowledgeCapabilityRequirementStatusV1 =
  | "SATISFIED"
  | "UNSATISFIED"
  | "STALE"
  | "CONFLICTED"
  | "NOT_APPLICABLE";
export type KnowledgeCapabilityReadinessStatusV1 =
  | "READY"
  | "READY_WITH_WARNINGS"
  | "BLOCKED"
  | "NOT_APPLICABLE";

export interface KnowledgeCapabilityRequirementPredicateV1 {
  schemaVersion: 1;
  operator: KnowledgeCapabilityRequirementOperatorV1;
  values: readonly string[];
  minimumCount?: number;
  minimumCoverageBps?: number;
  maxAgeSeconds?: number;
}

export interface KnowledgeCapabilityScopeV1 {
  brandIds?: readonly string[];
  locationIds?: readonly string[];
  channelTypes?: readonly string[];
  assistantIds?: readonly string[];
  audiences?: readonly string[];
  segments?: readonly string[];
  locales?: readonly string[];
}

export interface KnowledgeCapabilityLocaleConstraintsV1 {
  mode: "ALL" | "ANY";
  locales: readonly string[];
}

export interface KnowledgeCapabilityRequirementDefinitionV1 {
  schemaVersion: 1;
  requirementKey: string;
  definitionVersion: number;
  predicateVersion: typeof KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1;
  kind: KnowledgeCapabilityRequirementKindV1;
  label: string;
  severity: KnowledgeCapabilityRequirementSeverityV1;
  riskLevel: KnowledgeCapabilityRiskLevelV1;
  active: boolean;
  requiredScope?: KnowledgeCapabilityScopeV1 | null;
  localeConstraints?: KnowledgeCapabilityLocaleConstraintsV1 | null;
  freshnessSlaSeconds?: number | null;
  satisfactionPredicate: unknown;
  templateOrigin: string;
  tenantOverride: boolean;
}

export interface KnowledgeCapabilityDefinitionV1 {
  schemaVersion: 1;
  capabilityId: string;
  capabilityType: KnowledgeCapabilityTypeV1;
  targetKey: string;
  name: string;
  enabled: boolean;
  allowedAutonomy: KnowledgeCapabilityAutonomyV1;
  templateKey: string;
  templateVersion: number;
  serverOwned: boolean;
  weight: number;
  requiredScope?: KnowledgeCapabilityScopeV1 | null;
  localeConstraints?: KnowledgeCapabilityLocaleConstraintsV1 | null;
  requirements: readonly KnowledgeCapabilityRequirementDefinitionV1[];
}

export type KnowledgeCapabilityEvidenceRefTypeV1 =
  | "FACT_VERSION"
  | "GUIDANCE_RULE_VERSION"
  | "DOCUMENT_REVISION"
  | "CONNECTOR"
  | "TOOL"
  | "PERMISSION"
  | "LOCALE"
  | "EVALUATION_CASE";

export interface KnowledgeCapabilityEvidenceRefV1 {
  type: KnowledgeCapabilityEvidenceRefTypeV1;
  id: string;
  versionId?: string | null;
  versionHash?: string | null;
}

interface KnowledgeCapabilityEvidenceBaseV1 {
  schemaVersion: 1;
  evidenceId: string;
  kind: KnowledgeCapabilityRequirementKindV1;
  ref: KnowledgeCapabilityEvidenceRefV1;
  scope?: KnowledgeCapabilityScopeV1 | null;
  locales?: readonly string[];
  observedAt?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  expiresAt?: string | null;
  activeConflictIds?: readonly string[];
}

export interface KnowledgeCapabilityFactEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "FACT";
  factKey: string;
  fieldType: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "PENDING_REVIEW" | "REJECTED" | "CONFLICTED";
}

export interface KnowledgeCapabilityRuleEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "RULE";
  ruleType: string;
  reviewStatus: "APPROVED" | "DRAFT" | "PENDING_REVIEW" | "REJECTED" | "DISABLED";
}

export interface KnowledgeCapabilityDocumentEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "DOCUMENT_COVERAGE";
  documentKey: string;
  tags: readonly string[];
  ready: boolean;
  coverageBps?: number;
}

export interface KnowledgeCapabilityConnectorEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "CONNECTOR";
  connectorKey: string;
  connectorType: string;
  connected: boolean;
}

export interface KnowledgeCapabilityToolEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "TOOL";
  toolKey: string;
  available: boolean;
}

export interface KnowledgeCapabilityPermissionEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "PERMISSION";
  permissionKey: string;
  granted: boolean;
}

export interface KnowledgeCapabilityLocaleEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "LOCALE";
  locale: string;
  covered: boolean;
}

export interface KnowledgeCapabilityEvaluationCaseEvidenceV1 extends KnowledgeCapabilityEvidenceBaseV1 {
  kind: "EVALUATION_CASE";
  caseKey: string;
  passed: boolean;
}

export type KnowledgeCapabilityEvidenceV1 =
  | KnowledgeCapabilityFactEvidenceV1
  | KnowledgeCapabilityRuleEvidenceV1
  | KnowledgeCapabilityDocumentEvidenceV1
  | KnowledgeCapabilityConnectorEvidenceV1
  | KnowledgeCapabilityToolEvidenceV1
  | KnowledgeCapabilityPermissionEvidenceV1
  | KnowledgeCapabilityLocaleEvidenceV1
  | KnowledgeCapabilityEvaluationCaseEvidenceV1;

export interface KnowledgeCapabilitySnapshotInputV1 {
  schemaVersion: 1;
  evaluatedAt: string;
  tenantSupportedLocales?: readonly string[];
  capabilities: readonly KnowledgeCapabilityDefinitionV1[];
  evidence: readonly KnowledgeCapabilityEvidenceV1[];
}

export type KnowledgeCapabilityRequirementReasonCodeV1 =
  | "SATISFIED"
  | "CAPABILITY_DISABLED"
  | "REQUIREMENT_INACTIVE"
  | "INVALID_DEFINITION"
  | "INVALID_PREDICATE"
  | "ACTIVE_CONFLICT"
  | "EVIDENCE_STALE"
  | "EVIDENCE_MISSING"
  | "THRESHOLD_NOT_MET"
  | "SCOPE_NOT_COVERED"
  | "LOCALE_NOT_COVERED"
  | "LOCALE_CONTEXT_MISSING";

export interface KnowledgeCapabilityRemediationV1 {
  action: string;
  label: string;
}

export interface KnowledgeCapabilityRequirementEvaluationV1 {
  capabilityId: string;
  requirementKey: string;
  definitionVersion: number;
  kind: KnowledgeCapabilityRequirementKindV1;
  label: string;
  status: KnowledgeCapabilityRequirementStatusV1;
  severity: KnowledgeCapabilityRequirementSeverityV1;
  riskLevel: KnowledgeCapabilityRiskLevelV1;
  reasonCode: KnowledgeCapabilityRequirementReasonCodeV1;
  explanation: string;
  evidenceIds: string[];
  evidenceRefs: KnowledgeCapabilityEvidenceRefV1[];
  remediation: KnowledgeCapabilityRemediationV1 | null;
  details: {
    matchedCount: number;
    qualifyingCount: number;
    requiredCount: number;
    coverageBps: number;
    requiredCoverageBps: number | null;
    resolvedPredicateValues: string[];
  };
  evaluatedAt: string;
  evaluationHash: string;
}

export interface KnowledgeCapabilityEvaluationV1 {
  capabilityId: string;
  capabilityType: KnowledgeCapabilityTypeV1;
  targetKey: string;
  name: string;
  enabled: boolean;
  allowedAutonomy: KnowledgeCapabilityAutonomyV1;
  executable: boolean;
  weight: number;
  status: KnowledgeCapabilityReadinessStatusV1;
  configurationHash: string;
  capabilityHash: string;
  evaluationHash: string;
  requirements: KnowledgeCapabilityRequirementEvaluationV1[];
  blockerCount: number;
  warningCount: number;
  configurationErrors: string[];
}

export interface KnowledgeCapabilitySnapshotV1 {
  schemaVersion: 1;
  evaluatorVersion: typeof KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION;
  evaluatedAt: string;
  capabilitySetHash: string;
  requirementEvaluationSetHash: string;
  snapshotHash: string;
  capabilities: KnowledgeCapabilityEvaluationV1[];
  executableReadiness: {
    status: KnowledgeCapabilityReadinessStatusV1;
    capabilityIds: string[];
    blockerCount: number;
    warningCount: number;
  };
}

const operators = new Set<KnowledgeCapabilityRequirementOperatorV1>([
  "FACT_KEY_EQUALS",
  "FACT_KEY_PREFIX",
  "FIELD_TYPE_IN",
  "RULE_TYPE_IN",
  "DOCUMENT_COUNT",
  "CONNECTOR_CONNECTED",
  "TOOL_AVAILABLE",
  "PERMISSION_GRANTED",
  "LOCALE_COVERAGE",
  "EVALUATION_CASE_PASS",
]);
const predicateKeys = new Set([
  "schemaVersion",
  "operator",
  "values",
  "minimumCount",
  "minimumCoverageBps",
  "maxAgeSeconds",
]);
const scopeKeys = [
  "brandIds",
  "locationIds",
  "channelTypes",
  "assistantIds",
  "audiences",
  "segments",
  "locales",
] as const;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const capabilityTypes = new Set<KnowledgeCapabilityTypeV1>([
  "GENERAL_FAQ",
  "LEAD_QUALIFICATION",
  "PRICING",
  "APPOINTMENT_DISCOVERY",
  "APPOINTMENT_BOOKING",
  "ORDER_ACCOUNT_SUPPORT",
  "COMMERCE_RECOMMENDATION",
  "REGULATED_TOPIC",
]);
const autonomyLevels = new Set<KnowledgeCapabilityAutonomyV1>([
  "ANSWER_ONLY",
  "COLLECT_INFORMATION",
  "PROPOSE_ACTION",
  "ACT_WITH_CONFIRMATION",
  "AUTONOMOUS_ACTION",
]);
const requirementKinds = new Set<KnowledgeCapabilityRequirementKindV1>([
  "FACT",
  "RULE",
  "DOCUMENT_COVERAGE",
  "CONNECTOR",
  "TOOL",
  "PERMISSION",
  "LOCALE",
  "EVALUATION_CASE",
]);
const requirementSeverities = new Set<KnowledgeCapabilityRequirementSeverityV1>([
  "BLOCKER",
  "WARNING",
]);
const riskLevels = new Set<KnowledgeCapabilityRiskLevelV1>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const maximumPredicateValues = 256;
const maximumCount = 10_000;
const maximumFreshnessSeconds = 10 * 365 * 24 * 60 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort(compareKnowledgeCanonicalText);
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && keyPattern.test(value);
}

function canonicalLocale(value: string) {
  if (value === "*") return value;
  try {
    const locale = Intl.getCanonicalLocales(value)[0];
    return locale ? locale.toLowerCase() : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maximum;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

export function parseKnowledgeCapabilityRequirementPredicateV1(
  value: unknown,
): KnowledgeCapabilityRequirementPredicateV1 | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !predicateKeys.has(key))) return null;
  if (
    value.schemaVersion !== 1 ||
    typeof value.operator !== "string" ||
    !operators.has(value.operator as KnowledgeCapabilityRequirementOperatorV1) ||
    !Array.isArray(value.values) ||
    value.values.length < 1 ||
    value.values.length > maximumPredicateValues
  ) {
    return null;
  }
  const operator = value.operator as KnowledgeCapabilityRequirementOperatorV1;
  if (
    !value.values.every(
      (item) =>
        validKey(item) ||
        (operator === "DOCUMENT_COUNT" && item === "*") ||
        (operator === "LOCALE_COVERAGE" &&
          item === KNOWLEDGE_CAPABILITY_TENANT_SUPPORTED_LOCALES_V1),
    )
  ) {
    return null;
  }
  let values = sortedUnique(value.values as string[]);
  if (operator === "LOCALE_COVERAGE") {
    if (values.includes(KNOWLEDGE_CAPABILITY_TENANT_SUPPORTED_LOCALES_V1) && values.length !== 1) {
      return null;
    }
    const locales = values.map((item) =>
      item === KNOWLEDGE_CAPABILITY_TENANT_SUPPORTED_LOCALES_V1 ? item : canonicalLocale(item),
    );
    if (locales.some((locale) => !locale || locale === "*")) return null;
    values = sortedUnique(locales as string[]);
  }
  if (operator === "DOCUMENT_COUNT" && values.includes("*") && values.length !== 1) return null;
  if (operator !== "DOCUMENT_COUNT" && values.includes("*")) return null;
  if (
    (value.minimumCount !== undefined && !positiveInteger(value.minimumCount, maximumCount)) ||
    (value.minimumCoverageBps !== undefined &&
      !boundedInteger(value.minimumCoverageBps, 0, 10_000)) ||
    (value.maxAgeSeconds !== undefined &&
      !boundedInteger(value.maxAgeSeconds, 0, maximumFreshnessSeconds))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    operator,
    values,
    ...(value.minimumCount === undefined ? {} : { minimumCount: value.minimumCount as number }),
    ...(value.minimumCoverageBps === undefined
      ? {}
      : { minimumCoverageBps: value.minimumCoverageBps as number }),
    ...(value.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: value.maxAgeSeconds as number }),
  };
}

function resolveKnowledgeCapabilityPredicateV1(
  predicate: KnowledgeCapabilityRequirementPredicateV1,
  tenantSupportedLocales: readonly string[] | undefined,
) {
  if (
    predicate.operator !== "LOCALE_COVERAGE" ||
    !predicate.values.includes(KNOWLEDGE_CAPABILITY_TENANT_SUPPORTED_LOCALES_V1)
  ) {
    return { predicate, localeContextMissing: false as const };
  }
  const locales = normalizeLocaleList(tenantSupportedLocales, false);
  if (!locales || locales.length === 0) {
    return { predicate: null, localeContextMissing: true as const };
  }
  return {
    predicate: { ...predicate, values: locales },
    localeContextMissing: false as const,
  };
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? JSON.stringify(value) : `"$invalid:number"`;
  if (typeof value !== "object" || value === undefined)
    return JSON.stringify(`$invalid:${typeof value}`);
  if (seen.has(value)) return `"$invalid:cycle"`;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  const record = value as Record<string, unknown>;
  const result = `{${Object.keys(record)
    .sort(compareKnowledgeCanonicalText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`)
    .join(",")}}`;
  seen.delete(value);
  return result;
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function normalizeStringSet(value: unknown, locale = false): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumPredicateValues)
    return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (!validKey(item)) return null;
    const next = locale ? canonicalLocale(item) : item;
    if (!next) return null;
    normalized.push(next);
  }
  return sortedUnique(normalized);
}

function normalizeScope(value: KnowledgeCapabilityScopeV1 | null | undefined) {
  if (value === null || value === undefined) return { valid: true as const, value: null };
  if (!isRecord(value) || Object.keys(value).some((key) => !scopeKeys.includes(key as never))) {
    return { valid: false as const, value: null };
  }
  const normalized: Record<string, string[]> = {};
  for (const key of scopeKeys) {
    const raw = value[key];
    if (raw === undefined) continue;
    const values = normalizeStringSet(raw, key === "locales");
    if (!values) return { valid: false as const, value: null };
    normalized[key] = values;
  }
  return {
    valid: true as const,
    value: Object.keys(normalized).length === 0 ? null : (normalized as KnowledgeCapabilityScopeV1),
  };
}

function normalizeLocaleConstraints(
  value: KnowledgeCapabilityLocaleConstraintsV1 | null | undefined,
) {
  if (value === null || value === undefined) return { valid: true as const, value: null };
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "mode" && key !== "locales")) {
    return { valid: false as const, value: null };
  }
  if (value.mode !== "ALL" && value.mode !== "ANY") return { valid: false as const, value: null };
  const locales = normalizeStringSet(value.locales, true);
  if (!locales || locales.includes("*")) return { valid: false as const, value: null };
  return { valid: true as const, value: { mode: value.mode, locales } };
}

function normalizedHashValue<T>(
  original: T,
  normalized: { valid: boolean; value: unknown },
  errorKey: string,
) {
  return normalized.valid ? normalized.value : { [errorKey]: original };
}

function compareCanonicalValues(left: unknown, right: unknown) {
  return compareKnowledgeCanonicalText(canonicalJson(left), canonicalJson(right));
}

function definitionHashValue(capability: KnowledgeCapabilityDefinitionV1) {
  const requirements = [...capability.requirements]
    .map((requirement) => ({
      schemaVersion: requirement.schemaVersion,
      requirementKey: requirement.requirementKey,
      definitionVersion: requirement.definitionVersion,
      predicateVersion: requirement.predicateVersion,
      kind: requirement.kind,
      severity: requirement.severity,
      riskLevel: requirement.riskLevel,
      active: requirement.active,
      requiredScope: normalizedHashValue(
        requirement.requiredScope,
        normalizeScope(requirement.requiredScope),
        "$invalidScope",
      ),
      localeConstraints: normalizedHashValue(
        requirement.localeConstraints,
        normalizeLocaleConstraints(requirement.localeConstraints),
        "$invalidLocaleConstraints",
      ),
      freshnessSlaSeconds: requirement.freshnessSlaSeconds ?? null,
      satisfactionPredicate:
        parseKnowledgeCapabilityRequirementPredicateV1(requirement.satisfactionPredicate) ??
        requirement.satisfactionPredicate,
      templateOrigin: requirement.templateOrigin,
      tenantOverride: requirement.tenantOverride,
    }))
    .sort((left, right) => {
      const byKey = compareKnowledgeCanonicalText(left.requirementKey, right.requirementKey);
      if (byKey !== 0) return byKey;
      const byVersion = left.definitionVersion - right.definitionVersion;
      return byVersion === 0 ? compareCanonicalValues(left, right) : byVersion;
    });
  return {
    schemaVersion: capability.schemaVersion,
    capabilityId: capability.capabilityId,
    capabilityType: capability.capabilityType,
    targetKey: capability.targetKey,
    enabled: capability.enabled,
    allowedAutonomy: capability.allowedAutonomy,
    templateKey: capability.templateKey,
    templateVersion: capability.templateVersion,
    serverOwned: capability.serverOwned,
    weight: capability.weight,
    requiredScope: normalizedHashValue(
      capability.requiredScope,
      normalizeScope(capability.requiredScope),
      "$invalidScope",
    ),
    localeConstraints: normalizedHashValue(
      capability.localeConstraints,
      normalizeLocaleConstraints(capability.localeConstraints),
      "$invalidLocaleConstraints",
    ),
    requirements,
  };
}

export function hashKnowledgeCapabilitySetV1(
  capabilities: readonly KnowledgeCapabilityDefinitionV1[],
) {
  const definitions = [...capabilities].map(definitionHashValue).sort((left, right) => {
    const byTarget = compareKnowledgeCanonicalText(left.targetKey, right.targetKey);
    if (byTarget !== 0) return byTarget;
    const byType = compareKnowledgeCanonicalText(left.capabilityType, right.capabilityType);
    if (byType !== 0) return byType;
    const byId = compareKnowledgeCanonicalText(left.capabilityId, right.capabilityId);
    return byId === 0 ? compareCanonicalValues(left, right) : byId;
  });
  return sha256({
    schemaVersion: 1,
    evaluatorVersion: KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
    capabilities: definitions,
  });
}

export function computeCurrentKnowledgeCapabilityConfigHashV1(
  capabilities: readonly KnowledgeCapabilityDefinitionV1[] = buildDefaultKnowledgeCapabilityDefinitionsV1(),
) {
  return hashKnowledgeCapabilitySetV1(capabilities);
}

function operatorKind(operator: KnowledgeCapabilityRequirementOperatorV1) {
  if (operator.startsWith("FACT_") || operator === "FIELD_TYPE_IN") return "FACT";
  if (operator === "RULE_TYPE_IN") return "RULE";
  if (operator === "DOCUMENT_COUNT") return "DOCUMENT_COVERAGE";
  if (operator === "CONNECTOR_CONNECTED") return "CONNECTOR";
  if (operator === "TOOL_AVAILABLE") return "TOOL";
  if (operator === "PERMISSION_GRANTED") return "PERMISSION";
  if (operator === "LOCALE_COVERAGE") return "LOCALE";
  return "EVALUATION_CASE";
}

function validInstant(value: unknown) {
  if (value === null || value === undefined) return true;
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function requiredInstant(value: unknown): value is string {
  return typeof value === "string" && validInstant(value);
}

function normalizeLocaleList(value: unknown, allowWildcard: boolean) {
  if (!Array.isArray(value) || value.length > maximumPredicateValues) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item !== item.trim()) return null;
    if (item === "*" && allowWildcard) {
      normalized.push(item);
      continue;
    }
    const locale = canonicalLocale(item);
    if (!locale || locale === "*") return null;
    normalized.push(locale);
  }
  return sortedUnique(normalized);
}

function normalizeEvidenceLocales(evidence: KnowledgeCapabilityEvidenceV1) {
  const values = evidence.kind === "LOCALE" ? [evidence.locale] : [...(evidence.locales ?? [])];
  return normalizeLocaleList(values, evidence.kind !== "LOCALE");
}

const evidenceRefTypeByKind: Record<
  KnowledgeCapabilityRequirementKindV1,
  KnowledgeCapabilityEvidenceRefTypeV1
> = {
  FACT: "FACT_VERSION",
  RULE: "GUIDANCE_RULE_VERSION",
  DOCUMENT_COVERAGE: "DOCUMENT_REVISION",
  CONNECTOR: "CONNECTOR",
  TOOL: "TOOL",
  PERMISSION: "PERMISSION",
  LOCALE: "LOCALE",
  EVALUATION_CASE: "EVALUATION_CASE",
};

function validEvidenceRef(
  ref: KnowledgeCapabilityEvidenceRefV1,
  kind: KnowledgeCapabilityRequirementKindV1,
) {
  return (
    isRecord(ref) &&
    Object.keys(ref).every(
      (key) => key === "type" || key === "id" || key === "versionId" || key === "versionHash",
    ) &&
    ref.type === evidenceRefTypeByKind[kind] &&
    validKey(ref.id) &&
    (ref.versionId === undefined || ref.versionId === null || validKey(ref.versionId)) &&
    (ref.versionHash === undefined || ref.versionHash === null || validKey(ref.versionHash))
  );
}

function validEvidence(evidence: KnowledgeCapabilityEvidenceV1) {
  if (
    !isRecord(evidence) ||
    evidence.schemaVersion !== 1 ||
    !validKey(evidence.evidenceId) ||
    !validEvidenceRef(evidence.ref, evidence.kind) ||
    !normalizeScope(evidence.scope).valid ||
    normalizeEvidenceLocales(evidence) === null ||
    !validInstant(evidence.observedAt) ||
    !validInstant(evidence.effectiveFrom) ||
    !validInstant(evidence.effectiveUntil) ||
    !validInstant(evidence.expiresAt) ||
    (evidence.activeConflictIds !== undefined &&
      (!Array.isArray(evidence.activeConflictIds) || !evidence.activeConflictIds.every(validKey)))
  ) {
    return false;
  }
  switch (evidence.kind) {
    case "FACT":
      return validKey(evidence.factKey) && validKey(evidence.fieldType);
    case "RULE":
      return validKey(evidence.ruleType);
    case "DOCUMENT_COVERAGE":
      return (
        validKey(evidence.documentKey) &&
        Array.isArray(evidence.tags) &&
        evidence.tags.length > 0 &&
        evidence.tags.length <= maximumPredicateValues &&
        evidence.tags.every(validKey) &&
        (evidence.coverageBps === undefined || boundedInteger(evidence.coverageBps, 0, 10_000))
      );
    case "CONNECTOR":
      return validKey(evidence.connectorKey) && validKey(evidence.connectorType);
    case "TOOL":
      return validKey(evidence.toolKey);
    case "PERMISSION":
      return validKey(evidence.permissionKey);
    case "LOCALE":
      return canonicalLocale(evidence.locale) !== null && evidence.locale !== "*";
    case "EVALUATION_CASE":
      return validKey(evidence.caseKey);
  }
}

function selectorMatches(
  evidence: KnowledgeCapabilityEvidenceV1,
  predicate: KnowledgeCapabilityRequirementPredicateV1,
) {
  const values = new Set(predicate.values);
  switch (predicate.operator) {
    case "FACT_KEY_EQUALS":
      return evidence.kind === "FACT" && values.has(evidence.factKey);
    case "FACT_KEY_PREFIX":
      return (
        evidence.kind === "FACT" &&
        predicate.values.some((value) => evidence.factKey.startsWith(value))
      );
    case "FIELD_TYPE_IN":
      return evidence.kind === "FACT" && values.has(evidence.fieldType);
    case "RULE_TYPE_IN":
      return evidence.kind === "RULE" && values.has(evidence.ruleType);
    case "DOCUMENT_COUNT":
      return (
        evidence.kind === "DOCUMENT_COVERAGE" &&
        (values.has("*") || predicate.values.every((value) => evidence.tags.includes(value)))
      );
    case "CONNECTOR_CONNECTED":
      return (
        evidence.kind === "CONNECTOR" &&
        (values.has(evidence.connectorKey) || values.has(evidence.connectorType))
      );
    case "TOOL_AVAILABLE":
      return evidence.kind === "TOOL" && values.has(evidence.toolKey);
    case "PERMISSION_GRANTED":
      return evidence.kind === "PERMISSION" && values.has(evidence.permissionKey);
    case "LOCALE_COVERAGE": {
      if (evidence.kind !== "LOCALE") return false;
      const locale = canonicalLocale(evidence.locale);
      return Boolean(locale && values.has(locale));
    }
    case "EVALUATION_CASE_PASS":
      return evidence.kind === "EVALUATION_CASE" && values.has(evidence.caseKey);
  }
}

function evidenceQualifies(evidence: KnowledgeCapabilityEvidenceV1) {
  switch (evidence.kind) {
    case "FACT":
      return evidence.verificationStatus === "VERIFIED";
    case "RULE":
      return evidence.reviewStatus === "APPROVED";
    case "DOCUMENT_COVERAGE":
      return evidence.ready;
    case "CONNECTOR":
      return evidence.connected;
    case "TOOL":
      return evidence.available;
    case "PERMISSION":
      return evidence.granted;
    case "LOCALE":
      return evidence.covered;
    case "EVALUATION_CASE":
      return evidence.passed;
  }
}

function effectiveRequirementScope(
  capability: KnowledgeCapabilityScopeV1 | null,
  requirement: KnowledgeCapabilityScopeV1 | null,
) {
  if (!capability) return { valid: true, value: requirement };
  if (!requirement) return { valid: true, value: capability };
  const merged: Record<string, readonly string[]> = {};
  for (const key of scopeKeys) {
    const parent = capability[key];
    const child = requirement[key];
    if (parent && child && child.some((value) => !parent.includes(value))) {
      return { valid: false, value: null };
    }
    const selected = child ?? parent;
    if (selected) merged[key] = selected;
  }
  return { valid: true, value: merged as KnowledgeCapabilityScopeV1 };
}

function effectiveLocaleConstraints(
  capability: KnowledgeCapabilityLocaleConstraintsV1 | null,
  requirement: KnowledgeCapabilityLocaleConstraintsV1 | null,
) {
  if (!capability) return { valid: true, value: requirement };
  if (!requirement) return { valid: true, value: capability };
  if (requirement.locales.some((locale) => !capability.locales.includes(locale))) {
    return { valid: false, value: null };
  }
  return { valid: true, value: requirement };
}

function scopeRelevant(
  evidence: KnowledgeCapabilityScopeV1 | null,
  required: KnowledgeCapabilityScopeV1 | null,
) {
  if (!required || !evidence) return true;
  return scopeKeys.every((key) => {
    const expected = required[key];
    const actual = evidence[key];
    return !expected || !actual || actual.some((value) => expected.includes(value));
  });
}

function scopeCovered(
  evidence: readonly KnowledgeCapabilityEvidenceV1[],
  required: KnowledgeCapabilityScopeV1 | null,
) {
  if (!required) return true;
  return scopeKeys.every((key) => {
    const expected = required[key];
    if (!expected) return true;
    return expected.every((value) =>
      evidence.some((item) => {
        const actual = normalizeScope(item.scope).value?.[key];
        return !actual || actual.includes(value);
      }),
    );
  });
}

function localesCovered(
  evidence: readonly KnowledgeCapabilityEvidenceV1[],
  constraints: KnowledgeCapabilityLocaleConstraintsV1 | null,
) {
  if (!constraints) return true;
  const covered = new Set(
    evidence
      .flatMap((item) => normalizeEvidenceLocales(item) ?? [])
      .flatMap((locale) => (locale === "*" ? constraints.locales : [locale])),
  );
  return constraints.mode === "ALL"
    ? constraints.locales.every((locale) => covered.has(locale))
    : constraints.locales.some((locale) => covered.has(locale));
}

type Freshness = "FRESH" | "STALE" | "FUTURE" | "INVALID";

function evidenceFreshness(
  evidence: KnowledgeCapabilityEvidenceV1,
  nowMs: number,
  maxAgeSeconds: number | null,
): Freshness {
  if (
    !validInstant(evidence.observedAt) ||
    !validInstant(evidence.effectiveFrom) ||
    !validInstant(evidence.effectiveUntil) ||
    !validInstant(evidence.expiresAt)
  ) {
    return "INVALID";
  }
  const effectiveFrom = evidence.effectiveFrom ? Date.parse(evidence.effectiveFrom) : null;
  const effectiveUntil = evidence.effectiveUntil ? Date.parse(evidence.effectiveUntil) : null;
  const expiresAt = evidence.expiresAt ? Date.parse(evidence.expiresAt) : null;
  if (effectiveFrom !== null && effectiveFrom > nowMs) return "FUTURE";
  if (
    (effectiveUntil !== null && effectiveUntil <= nowMs) ||
    (expiresAt !== null && expiresAt <= nowMs)
  ) {
    return "STALE";
  }
  if (maxAgeSeconds !== null) {
    if (!evidence.observedAt) return "STALE";
    const observedAt = Date.parse(evidence.observedAt);
    if (observedAt > nowMs || nowMs - observedAt > maxAgeSeconds * 1_000) return "STALE";
  }
  return "FRESH";
}

function coverageBps(
  evidence: readonly KnowledgeCapabilityEvidenceV1[],
  predicate: KnowledgeCapabilityRequirementPredicateV1,
) {
  if (predicate.operator === "DOCUMENT_COUNT") {
    return evidence.reduce(
      (maximum, item) =>
        item.kind === "DOCUMENT_COVERAGE" ? Math.max(maximum, item.coverageBps ?? 10_000) : maximum,
      0,
    );
  }
  const covered = new Set<string>();
  for (const item of evidence) {
    if (item.kind === "LOCALE") {
      const locale = canonicalLocale(item.locale);
      if (locale) covered.add(locale);
    } else if (item.kind === "EVALUATION_CASE") {
      covered.add(item.caseKey);
    } else if (item.kind === "FACT") {
      if (predicate.operator === "FIELD_TYPE_IN") covered.add(item.fieldType);
      else if (predicate.operator === "FACT_KEY_EQUALS") covered.add(item.factKey);
      else {
        const prefix = predicate.values.find((value) => item.factKey.startsWith(value));
        if (prefix) covered.add(prefix);
      }
    } else if (item.kind === "RULE") covered.add(item.ruleType);
    else if (item.kind === "CONNECTOR") {
      const value = predicate.values.find(
        (candidate) => candidate === item.connectorKey || candidate === item.connectorType,
      );
      if (value) covered.add(value);
    } else if (item.kind === "TOOL") covered.add(item.toolKey);
    else if (item.kind === "PERMISSION") covered.add(item.permissionKey);
  }
  return Math.floor((covered.size * 10_000) / predicate.values.length);
}

function evidenceRefKey(ref: KnowledgeCapabilityEvidenceRefV1) {
  return `${ref.type}:${ref.id}:${ref.versionId ?? ""}:${ref.versionHash ?? ""}`;
}

function sortedEvidence(evidence: readonly KnowledgeCapabilityEvidenceV1[]) {
  const ordered = [...evidence].sort((left, right) => {
    const byId = compareKnowledgeCanonicalText(left.evidenceId, right.evidenceId);
    return byId === 0 ? compareCanonicalValues(left, right) : byId;
  });
  const byId = new Map<string, KnowledgeCapabilityEvidenceV1>();
  for (const item of ordered) if (!byId.has(item.evidenceId)) byId.set(item.evidenceId, item);
  return [...byId.values()];
}

const missingRemediation: Record<
  KnowledgeCapabilityRequirementKindV1,
  KnowledgeCapabilityRemediationV1
> = {
  FACT: { action: "ADD_OR_VERIFY_FACT", label: "Add or verify the required fact." },
  RULE: { action: "ADD_OR_APPROVE_RULE", label: "Add or approve the required guidance." },
  DOCUMENT_COVERAGE: {
    action: "ADD_OR_REFRESH_DOCUMENTS",
    label: "Add or refresh the required documents.",
  },
  CONNECTOR: { action: "CONNECT_INTEGRATION", label: "Connect the required integration." },
  TOOL: { action: "ENABLE_TOOL", label: "Enable the required tool." },
  PERMISSION: { action: "GRANT_PERMISSION", label: "Grant the required permission." },
  LOCALE: { action: "ADD_LOCALE_COVERAGE", label: "Add the required locale coverage." },
  EVALUATION_CASE: {
    action: "PASS_EVALUATION_CASE",
    label: "Fix and pass the required evaluation case.",
  },
};

function resultText(reasonCode: KnowledgeCapabilityRequirementReasonCodeV1) {
  switch (reasonCode) {
    case "SATISFIED":
      return "Requirement is satisfied by current evidence.";
    case "CAPABILITY_DISABLED":
      return "Capability is disabled, so this requirement is not executable.";
    case "REQUIREMENT_INACTIVE":
      return "Requirement definition is inactive.";
    case "INVALID_DEFINITION":
      return "Requirement definition is invalid and failed closed.";
    case "INVALID_PREDICATE":
      return "Requirement predicate is invalid or unsupported and failed closed.";
    case "ACTIVE_CONFLICT":
      return "Relevant evidence has an unresolved conflict.";
    case "EVIDENCE_STALE":
      return "Matching evidence exists but is stale or expired.";
    case "SCOPE_NOT_COVERED":
      return "Current evidence does not cover the required scope.";
    case "LOCALE_NOT_COVERED":
      return "Current evidence does not cover the required locales.";
    case "LOCALE_CONTEXT_MISSING":
      return "Tenant-supported locales are missing or invalid, so locale coverage failed closed.";
    case "THRESHOLD_NOT_MET":
      return "Current evidence does not meet the configured threshold.";
    case "EVIDENCE_MISSING":
      return "Required evidence is missing.";
  }
}

function remediationFor(
  kind: KnowledgeCapabilityRequirementKindV1,
  reasonCode: KnowledgeCapabilityRequirementReasonCodeV1,
) {
  if (
    reasonCode === "SATISFIED" ||
    reasonCode === "CAPABILITY_DISABLED" ||
    reasonCode === "REQUIREMENT_INACTIVE"
  ) {
    return null;
  }
  if (reasonCode === "INVALID_DEFINITION" || reasonCode === "INVALID_PREDICATE") {
    return { action: "FIX_REQUIREMENT_DEFINITION", label: "Correct the requirement definition." };
  }
  if (reasonCode === "ACTIVE_CONFLICT") {
    return { action: "RESOLVE_CONFLICT", label: "Resolve the conflicting evidence." };
  }
  if (reasonCode === "EVIDENCE_STALE") {
    return { action: "REFRESH_EVIDENCE", label: "Refresh or reverify the required evidence." };
  }
  if (reasonCode === "LOCALE_CONTEXT_MISSING") {
    return {
      action: "CONFIGURE_SUPPORTED_LOCALES",
      label: "Configure the tenant-supported locales.",
    };
  }
  return missingRemediation[kind];
}

function makeRequirementEvaluation(
  input: Omit<KnowledgeCapabilityRequirementEvaluationV1, "evaluationHash">,
) {
  const evidenceIds = sortedUnique(input.evidenceIds);
  const evidenceRefs = [...input.evidenceRefs].sort((left, right) =>
    compareKnowledgeCanonicalText(evidenceRefKey(left), evidenceRefKey(right)),
  );
  const details = {
    ...input.details,
    resolvedPredicateValues: sortedUnique(input.details.resolvedPredicateValues),
  };
  const output = {
    ...input,
    evidenceIds,
    evidenceRefs,
    details,
  };
  const hashValue = {
    schemaVersion: 1,
    evaluatorVersion: KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
    capabilityId: input.capabilityId,
    requirementKey: input.requirementKey,
    definitionVersion: input.definitionVersion,
    kind: input.kind,
    status: input.status,
    severity: input.severity,
    riskLevel: input.riskLevel,
    reasonCode: input.reasonCode,
    evidenceIds,
    evidenceRefs,
    details,
  };
  return { ...output, evaluationHash: sha256(hashValue) };
}

function notApplicable(
  capability: KnowledgeCapabilityDefinitionV1,
  requirement: KnowledgeCapabilityRequirementDefinitionV1,
  evaluatedAt: string,
  reasonCode: "CAPABILITY_DISABLED" | "REQUIREMENT_INACTIVE",
) {
  return makeRequirementEvaluation({
    capabilityId: capability.capabilityId,
    requirementKey: requirement.requirementKey,
    definitionVersion: requirement.definitionVersion,
    kind: requirement.kind,
    label: requirement.label,
    status: "NOT_APPLICABLE",
    severity: requirement.severity,
    riskLevel: requirement.riskLevel,
    reasonCode,
    explanation: resultText(reasonCode),
    evidenceIds: [],
    evidenceRefs: [],
    remediation: null,
    details: {
      matchedCount: 0,
      qualifyingCount: 0,
      requiredCount: 0,
      coverageBps: 0,
      requiredCoverageBps: null,
      resolvedPredicateValues: [],
    },
    evaluatedAt,
  });
}

function evaluateRequirement(
  capability: KnowledgeCapabilityDefinitionV1,
  requirement: KnowledgeCapabilityRequirementDefinitionV1,
  evidence: readonly KnowledgeCapabilityEvidenceV1[],
  evaluatedAt: string,
  capabilityScope: ReturnType<typeof normalizeScope>,
  capabilityLocales: ReturnType<typeof normalizeLocaleConstraints>,
  duplicateRequirement: boolean,
  tenantSupportedLocales: readonly string[] | undefined,
) {
  if (!capability.enabled)
    return notApplicable(capability, requirement, evaluatedAt, "CAPABILITY_DISABLED");
  if (!requirement.active)
    return notApplicable(capability, requirement, evaluatedAt, "REQUIREMENT_INACTIVE");
  const predicate = parseKnowledgeCapabilityRequirementPredicateV1(
    requirement.satisfactionPredicate,
  );
  const resolved = predicate
    ? resolveKnowledgeCapabilityPredicateV1(predicate, tenantSupportedLocales)
    : { predicate: null, localeContextMissing: false as const };
  const requirementScope = normalizeScope(requirement.requiredScope);
  const requirementLocales = normalizeLocaleConstraints(requirement.localeConstraints);
  const scope =
    capabilityScope.valid && requirementScope.valid
      ? effectiveRequirementScope(capabilityScope.value, requirementScope.value)
      : { valid: false, value: null };
  const locales =
    capabilityLocales.valid && requirementLocales.valid
      ? effectiveLocaleConstraints(capabilityLocales.value, requirementLocales.value)
      : { valid: false, value: null };
  const validDefinition =
    capability.schemaVersion === 1 &&
    requirement.schemaVersion === 1 &&
    validKey(capability.capabilityId) &&
    validKey(requirement.requirementKey) &&
    requirementKinds.has(requirement.kind) &&
    requirementSeverities.has(requirement.severity) &&
    riskLevels.has(requirement.riskLevel) &&
    typeof requirement.active === "boolean" &&
    positiveInteger(requirement.definitionVersion, 1_000_000) &&
    requirement.predicateVersion === KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1 &&
    (requirement.freshnessSlaSeconds === undefined ||
      requirement.freshnessSlaSeconds === null ||
      boundedInteger(requirement.freshnessSlaSeconds, 0, maximumFreshnessSeconds)) &&
    validKey(requirement.templateOrigin) &&
    typeof requirement.tenantOverride === "boolean" &&
    scope.valid &&
    locales.valid &&
    !duplicateRequirement;
  const invalidReason = !validDefinition
    ? "INVALID_DEFINITION"
    : !predicate
      ? "INVALID_PREDICATE"
      : null;
  if (invalidReason || (predicate && operatorKind(predicate.operator) !== requirement.kind)) {
    const reasonCode = invalidReason ?? "INVALID_PREDICATE";
    return makeRequirementEvaluation({
      capabilityId: capability.capabilityId,
      requirementKey: requirement.requirementKey,
      definitionVersion: requirement.definitionVersion,
      kind: requirement.kind,
      label: requirement.label,
      status: "UNSATISFIED",
      severity: requirement.severity,
      riskLevel: requirement.riskLevel,
      reasonCode,
      explanation: resultText(reasonCode),
      evidenceIds: [],
      evidenceRefs: [],
      remediation: remediationFor(requirement.kind, reasonCode),
      details: {
        matchedCount: 0,
        qualifyingCount: 0,
        requiredCount: 1,
        coverageBps: 0,
        requiredCoverageBps: null,
        resolvedPredicateValues: [],
      },
      evaluatedAt,
    });
  }
  if (resolved.localeContextMissing) {
    const reasonCode = "LOCALE_CONTEXT_MISSING" as const;
    return makeRequirementEvaluation({
      capabilityId: capability.capabilityId,
      requirementKey: requirement.requirementKey,
      definitionVersion: requirement.definitionVersion,
      kind: requirement.kind,
      label: requirement.label,
      status: "UNSATISFIED",
      severity: requirement.severity,
      riskLevel: requirement.riskLevel,
      reasonCode,
      explanation: resultText(reasonCode),
      evidenceIds: [],
      evidenceRefs: [],
      remediation: remediationFor(requirement.kind, reasonCode),
      details: {
        matchedCount: 0,
        qualifyingCount: 0,
        requiredCount: 1,
        coverageBps: 0,
        requiredCoverageBps: predicate!.minimumCoverageBps ?? null,
        resolvedPredicateValues: [],
      },
      evaluatedAt,
    });
  }
  const evaluatedPredicate = resolved.predicate!;
  const maxAgeSeconds = [evaluatedPredicate.maxAgeSeconds, requirement.freshnessSlaSeconds]
    .filter((value): value is number => typeof value === "number")
    .reduce<
      number | null
    >((minimum, value) => (minimum === null ? value : Math.min(minimum, value)), null);
  const nowMs = Date.parse(evaluatedAt);
  const selected = sortedEvidence(evidence).filter(
    (item) =>
      validEvidence(item) &&
      item.kind === requirement.kind &&
      selectorMatches(item, evaluatedPredicate) &&
      scopeRelevant(normalizeScope(item.scope).value, scope.value),
  );
  const conflictEvidence = selected.filter((item) => (item.activeConflictIds?.length ?? 0) > 0);
  const qualified = selected.filter(evidenceQualifies);
  const fresh = qualified.filter(
    (item) => evidenceFreshness(item, nowMs, maxAgeSeconds) === "FRESH",
  );
  const stale = qualified.filter(
    (item) => evidenceFreshness(item, nowMs, maxAgeSeconds) === "STALE",
  );
  const requiredCount = evaluatedPredicate.minimumCount ?? 1;
  const requiredCoverageBps = evaluatedPredicate.minimumCoverageBps ?? null;
  const meets = (items: readonly KnowledgeCapabilityEvidenceV1[]) => {
    const coverage = coverageBps(items, evaluatedPredicate);
    return (
      items.length >= requiredCount &&
      (requiredCoverageBps === null || coverage >= requiredCoverageBps) &&
      scopeCovered(items, scope.value) &&
      (evaluatedPredicate.operator === "LOCALE_COVERAGE" || localesCovered(items, locales.value))
    );
  };
  let status: KnowledgeCapabilityRequirementStatusV1;
  let reasonCode: KnowledgeCapabilityRequirementReasonCodeV1;
  let used: KnowledgeCapabilityEvidenceV1[];
  if (conflictEvidence.length > 0) {
    status = "CONFLICTED";
    reasonCode = "ACTIVE_CONFLICT";
    used = conflictEvidence;
  } else if (meets(fresh)) {
    status = "SATISFIED";
    reasonCode = "SATISFIED";
    used = fresh;
  } else if (stale.length > 0 && meets([...fresh, ...stale])) {
    status = "STALE";
    reasonCode = "EVIDENCE_STALE";
    used = [...fresh, ...stale];
  } else {
    status = "UNSATISFIED";
    used = selected;
    if (selected.length === 0) reasonCode = "EVIDENCE_MISSING";
    else if (!scopeCovered(fresh, scope.value)) reasonCode = "SCOPE_NOT_COVERED";
    else if (
      evaluatedPredicate.operator !== "LOCALE_COVERAGE" &&
      !localesCovered(fresh, locales.value)
    ) {
      reasonCode = "LOCALE_NOT_COVERED";
    } else reasonCode = "THRESHOLD_NOT_MET";
  }
  const evidenceItems = sortedEvidence(used);
  return makeRequirementEvaluation({
    capabilityId: capability.capabilityId,
    requirementKey: requirement.requirementKey,
    definitionVersion: requirement.definitionVersion,
    kind: requirement.kind,
    label: requirement.label,
    status,
    severity: requirement.severity,
    riskLevel: requirement.riskLevel,
    reasonCode,
    explanation: resultText(reasonCode),
    evidenceIds: evidenceItems.map((item) => item.evidenceId),
    evidenceRefs: evidenceItems.map((item) => item.ref),
    remediation: remediationFor(requirement.kind, reasonCode),
    details: {
      matchedCount: selected.length,
      qualifyingCount: fresh.length,
      requiredCount,
      coverageBps: coverageBps(fresh, evaluatedPredicate),
      requiredCoverageBps,
      resolvedPredicateValues: [...evaluatedPredicate.values],
    },
    evaluatedAt,
  });
}

function validActiveRequirementConfiguration(
  capability: KnowledgeCapabilityDefinitionV1,
  requirement: KnowledgeCapabilityRequirementDefinitionV1,
) {
  if (requirement.active === false) return true;
  const predicate = parseKnowledgeCapabilityRequirementPredicateV1(
    requirement.satisfactionPredicate,
  );
  const capabilityScope = normalizeScope(capability.requiredScope);
  const requirementScope = normalizeScope(requirement.requiredScope);
  const capabilityLocales = normalizeLocaleConstraints(capability.localeConstraints);
  const requirementLocales = normalizeLocaleConstraints(requirement.localeConstraints);
  return (
    requirement.schemaVersion === 1 &&
    validKey(requirement.requirementKey) &&
    positiveInteger(requirement.definitionVersion, 1_000_000) &&
    requirementKinds.has(requirement.kind) &&
    requirementSeverities.has(requirement.severity) &&
    riskLevels.has(requirement.riskLevel) &&
    requirement.active === true &&
    requirement.predicateVersion === KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1 &&
    validKey(requirement.templateOrigin) &&
    typeof requirement.tenantOverride === "boolean" &&
    (requirement.freshnessSlaSeconds === undefined ||
      requirement.freshnessSlaSeconds === null ||
      boundedInteger(requirement.freshnessSlaSeconds, 0, maximumFreshnessSeconds)) &&
    capabilityScope.valid &&
    requirementScope.valid &&
    effectiveRequirementScope(capabilityScope.value, requirementScope.value).valid &&
    capabilityLocales.valid &&
    requirementLocales.valid &&
    effectiveLocaleConstraints(capabilityLocales.value, requirementLocales.value).valid &&
    predicate !== null &&
    operatorKind(predicate.operator) === requirement.kind
  );
}

function capabilityConfigurationErrors(capability: KnowledgeCapabilityDefinitionV1) {
  const errors: string[] = [];
  if (
    capability.schemaVersion !== 1 ||
    !validKey(capability.capabilityId) ||
    !capabilityTypes.has(capability.capabilityType) ||
    !validKey(capability.targetKey) ||
    !validKey(capability.templateKey) ||
    !positiveInteger(capability.templateVersion, 1_000_000) ||
    !autonomyLevels.has(capability.allowedAutonomy) ||
    typeof capability.serverOwned !== "boolean" ||
    typeof capability.enabled !== "boolean"
  ) {
    errors.push("INVALID_CAPABILITY_IDENTITY");
  }
  if (!Number.isInteger(capability.weight) || capability.weight < 0 || capability.weight > 10_000) {
    errors.push("INVALID_CAPABILITY_WEIGHT");
  }
  if (!normalizeScope(capability.requiredScope).valid) errors.push("INVALID_CAPABILITY_SCOPE");
  if (!normalizeLocaleConstraints(capability.localeConstraints).valid)
    errors.push("INVALID_CAPABILITY_LOCALES");
  if (
    capability.requirements.some(
      (requirement) => !validActiveRequirementConfiguration(capability, requirement),
    )
  ) {
    errors.push("INVALID_ACTIVE_REQUIREMENT");
  }
  if (
    capability.enabled &&
    !capability.requirements.some((requirement) => requirement.active === true)
  ) {
    errors.push("NO_ACTIVE_REQUIREMENTS");
  }
  return errors;
}

export function evaluateKnowledgeCapabilitySnapshotV1(
  input: KnowledgeCapabilitySnapshotInputV1,
): KnowledgeCapabilitySnapshotV1 {
  if (input.schemaVersion !== 1 || !requiredInstant(input.evaluatedAt)) {
    throw new TypeError(
      "Knowledge capability snapshot input must use schemaVersion 1 and a valid timestamp.",
    );
  }
  const evaluatedAt = new Date(input.evaluatedAt).toISOString();
  const duplicateCapabilities = new Set<string>();
  const capabilityIds = new Set<string>();
  for (const capability of input.capabilities) {
    if (capabilityIds.has(capability.capabilityId))
      duplicateCapabilities.add(capability.capabilityId);
    capabilityIds.add(capability.capabilityId);
  }
  const capabilities = [...input.capabilities]
    .sort((left, right) => {
      const byId = compareKnowledgeCanonicalText(left.capabilityId, right.capabilityId);
      return byId === 0
        ? compareCanonicalValues(definitionHashValue(left), definitionHashValue(right))
        : byId;
    })
    .map((capability) => {
      const keys = new Set<string>();
      const duplicateRequirements = new Set<string>();
      for (const requirement of capability.requirements) {
        if (keys.has(requirement.requirementKey))
          duplicateRequirements.add(requirement.requirementKey);
        keys.add(requirement.requirementKey);
      }
      const capabilityScope = normalizeScope(capability.requiredScope);
      const capabilityLocales = normalizeLocaleConstraints(capability.localeConstraints);
      const requirements = [...capability.requirements]
        .sort((left, right) => {
          const byKey = compareKnowledgeCanonicalText(left.requirementKey, right.requirementKey);
          return byKey === 0 ? compareCanonicalValues(left, right) : byKey;
        })
        .map((requirement) =>
          evaluateRequirement(
            capability,
            requirement,
            input.evidence,
            evaluatedAt,
            capabilityScope,
            capabilityLocales,
            duplicateRequirements.has(requirement.requirementKey),
            input.tenantSupportedLocales,
          ),
        );
      const configurationErrors = capabilityConfigurationErrors(capability);
      if (duplicateCapabilities.has(capability.capabilityId))
        configurationErrors.push("DUPLICATE_CAPABILITY_ID");
      if (duplicateRequirements.size > 0) configurationErrors.push("DUPLICATE_REQUIREMENT_KEY");
      const applicable = requirements.filter(
        (requirement) => requirement.status !== "NOT_APPLICABLE",
      );
      const blockerCount = applicable.filter(
        (requirement) => requirement.severity === "BLOCKER" && requirement.status !== "SATISFIED",
      ).length;
      const warningCount = applicable.filter(
        (requirement) => requirement.severity === "WARNING" && requirement.status !== "SATISFIED",
      ).length;
      const status: KnowledgeCapabilityReadinessStatusV1 = !capability.enabled
        ? "NOT_APPLICABLE"
        : configurationErrors.length > 0 || blockerCount > 0
          ? "BLOCKED"
          : warningCount > 0
            ? "READY_WITH_WARNINGS"
            : "READY";
      const executable = capability.enabled && status !== "BLOCKED";
      const capabilityHash = sha256(definitionHashValue(capability));
      const evaluationValue = {
        capabilityId: capability.capabilityId,
        capabilityHash,
        status,
        executable,
        blockerCount,
        warningCount,
        configurationErrors: sortedUnique(configurationErrors),
        requirementEvaluationHashes: requirements.map((requirement) => requirement.evaluationHash),
      };
      return {
        capabilityId: capability.capabilityId,
        capabilityType: capability.capabilityType,
        targetKey: capability.targetKey,
        name: capability.name,
        enabled: capability.enabled,
        allowedAutonomy: capability.allowedAutonomy,
        executable,
        weight: capability.weight,
        status,
        configurationHash: capabilityHash,
        capabilityHash,
        evaluationHash: sha256(evaluationValue),
        requirements,
        blockerCount,
        warningCount,
        configurationErrors: sortedUnique(configurationErrors),
      };
    });
  const requirementEvaluationSetHash = sha256({
    schemaVersion: 1,
    evaluations: capabilities.flatMap((capability) =>
      capability.requirements.map((requirement) => ({
        capabilityId: capability.capabilityId,
        requirementKey: requirement.requirementKey,
        evaluationHash: requirement.evaluationHash,
      })),
    ),
  });
  const enabled = capabilities.filter((capability) => capability.enabled);
  const executable = enabled.filter((capability) => capability.executable);
  const blockerCount = enabled.reduce((sum, capability) => sum + capability.blockerCount, 0);
  const warningCount = enabled.reduce((sum, capability) => sum + capability.warningCount, 0);
  const executableStatus: KnowledgeCapabilityReadinessStatusV1 =
    enabled.length === 0
      ? "NOT_APPLICABLE"
      : executable.length === 0
        ? "BLOCKED"
        : blockerCount > 0 ||
            executable.some((capability) => capability.status === "READY_WITH_WARNINGS")
          ? "READY_WITH_WARNINGS"
          : "READY";
  const capabilitySetHash = hashKnowledgeCapabilitySetV1(input.capabilities);
  const snapshotValue = {
    schemaVersion: 1,
    evaluatorVersion: KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
    evaluatedAt,
    capabilitySetHash,
    requirementEvaluationSetHash,
    capabilityEvaluationHashes: capabilities.map((capability) => capability.evaluationHash),
    executableReadiness: {
      status: executableStatus,
      capabilityIds: executable.map((capability) => capability.capabilityId),
      blockerCount,
      warningCount,
    },
  };
  return {
    schemaVersion: 1,
    evaluatorVersion: KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
    evaluatedAt,
    capabilitySetHash,
    requirementEvaluationSetHash,
    snapshotHash: sha256(snapshotValue),
    capabilities,
    executableReadiness: {
      status: executableStatus,
      capabilityIds: executable.map((capability) => capability.capabilityId),
      blockerCount,
      warningCount,
    },
  };
}

export interface KnowledgeCapabilityDefaultTemplateV1 {
  capabilityType: KnowledgeCapabilityTypeV1;
  targetKey: "workspace-v2";
  enabled: boolean;
  allowedAutonomy: "ANSWER_ONLY";
  templateKey: string;
  templateVersion: 1;
  serverOwned: true;
}

export interface KnowledgeCapabilityDefaultRequirementTemplateV1 {
  capabilityType: KnowledgeCapabilityTypeV1;
  requirementKey: string;
  definitionVersion: 2;
  kind: KnowledgeCapabilityRequirementKindV1;
  severity: KnowledgeCapabilityRequirementSeverityV1;
  riskLevel: KnowledgeCapabilityRiskLevelV1;
  active: true;
  freshnessSlaSeconds: number | null;
  requiredScope: null;
  localeConstraints: null;
  satisfactionPredicate: KnowledgeCapabilityRequirementPredicateV1;
  predicateVersion: typeof KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1;
  templateOrigin: "PLATFORM_V2";
  tenantOverride: false;
}

const capabilityTemplateRows = [
  ["GENERAL_FAQ", "platform.capability.general-faq"],
  ["LEAD_QUALIFICATION", "platform.capability.lead-qualification"],
  ["PRICING", "platform.capability.pricing"],
  ["APPOINTMENT_DISCOVERY", "platform.capability.appointment-discovery"],
  ["APPOINTMENT_BOOKING", "platform.capability.appointment-booking"],
  ["ORDER_ACCOUNT_SUPPORT", "platform.capability.order-account-support"],
  ["COMMERCE_RECOMMENDATION", "platform.capability.commerce-recommendation"],
  ["REGULATED_TOPIC", "platform.capability.regulated-topic"],
] as const satisfies readonly (readonly [KnowledgeCapabilityTypeV1, string])[];

const safeLaunchCapabilityTypes = new Set<KnowledgeCapabilityTypeV1>([
  "GENERAL_FAQ",
  "PRICING",
  "APPOINTMENT_DISCOVERY",
  "COMMERCE_RECOMMENDATION",
]);

export const KNOWLEDGE_CAPABILITY_DEFAULT_TEMPLATES_V1: readonly KnowledgeCapabilityDefaultTemplateV1[] =
  capabilityTemplateRows.map(([capabilityType, templateKey]) => ({
    capabilityType,
    targetKey: "workspace-v2",
    enabled: safeLaunchCapabilityTypes.has(capabilityType),
    allowedAutonomy: "ANSWER_ONLY",
    templateKey,
    templateVersion: 1,
    serverOwned: true,
  }));

type KnowledgeCapabilityDefaultRequirementRowV1 = readonly [
  KnowledgeCapabilityTypeV1,
  string,
  KnowledgeCapabilityRequirementKindV1,
  KnowledgeCapabilityRequirementSeverityV1,
  KnowledgeCapabilityRiskLevelV1,
  KnowledgeCapabilityRequirementOperatorV1,
  readonly string[],
  number | null,
  number | null,
  number | null,
  number | null,
];

const requirementTemplateRows = [
  [
    "GENERAL_FAQ",
    "business_identity",
    "FACT",
    "WARNING",
    "LOW",
    "FACT_KEY_EQUALS",
    ["business/name"],
    1,
    null,
    null,
    null,
  ],
  [
    "GENERAL_FAQ",
    "contact_route",
    "FACT",
    "WARNING",
    "LOW",
    "FACT_KEY_PREFIX",
    ["contact/"],
    1,
    null,
    null,
    null,
  ],
  [
    "GENERAL_FAQ",
    "approved_knowledge",
    "DOCUMENT_COVERAGE",
    "WARNING",
    "LOW",
    "DOCUMENT_COUNT",
    ["APPROVED"],
    1,
    null,
    null,
    null,
  ],
  [
    "GENERAL_FAQ",
    "escalation_route",
    "RULE",
    "WARNING",
    "MEDIUM",
    "RULE_TYPE_IN",
    ["ESCALATION"],
    1,
    null,
    null,
    null,
  ],
  [
    "GENERAL_FAQ",
    "supported_locales",
    "LOCALE",
    "WARNING",
    "LOW",
    "LOCALE_COVERAGE",
    ["TENANT_SUPPORTED"],
    null,
    10_000,
    null,
    null,
  ],
  [
    "LEAD_QUALIFICATION",
    "qualification_fields",
    "FACT",
    "WARNING",
    "MEDIUM",
    "FACT_KEY_PREFIX",
    ["lead/qualification/"],
    1,
    null,
    null,
    null,
  ],
  [
    "LEAD_QUALIFICATION",
    "disqualifier_rules",
    "RULE",
    "WARNING",
    "HIGH",
    "RULE_TYPE_IN",
    ["PROHIBITION"],
    1,
    null,
    null,
    null,
  ],
  [
    "LEAD_QUALIFICATION",
    "collection_consent",
    "PERMISSION",
    "BLOCKER",
    "HIGH",
    "PERMISSION_GRANTED",
    ["lead_data_collection"],
    1,
    null,
    null,
    null,
  ],
  [
    "LEAD_QUALIFICATION",
    "routing_rules",
    "RULE",
    "WARNING",
    "MEDIUM",
    "RULE_TYPE_IN",
    ["ESCALATION"],
    1,
    null,
    null,
    null,
  ],
  [
    "PRICING",
    "structured_price",
    "FACT",
    "WARNING",
    "HIGH",
    "FIELD_TYPE_IN",
    ["MONEY"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "PRICING",
    "pricing_conditions",
    "FACT",
    "WARNING",
    "HIGH",
    "FACT_KEY_PREFIX",
    ["pricing/"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "PRICING",
    "quote_policy",
    "RULE",
    "WARNING",
    "HIGH",
    "RULE_TYPE_IN",
    ["APPROVAL", "PROHIBITION"],
    1,
    null,
    null,
    null,
  ],
  [
    "PRICING",
    "dynamic_quote_tool",
    "TOOL",
    "WARNING",
    "HIGH",
    "TOOL_AVAILABLE",
    ["quote.lookup"],
    1,
    null,
    null,
    300,
  ],
  [
    "APPOINTMENT_DISCOVERY",
    "service_details",
    "FACT",
    "WARNING",
    "MEDIUM",
    "FACT_KEY_PREFIX",
    ["service/"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "APPOINTMENT_DISCOVERY",
    "business_hours",
    "FACT",
    "WARNING",
    "MEDIUM",
    "FACT_KEY_PREFIX",
    ["location/"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "APPOINTMENT_DISCOVERY",
    "booking_policy",
    "RULE",
    "WARNING",
    "HIGH",
    "RULE_TYPE_IN",
    ["APPROVAL", "PROHIBITION"],
    1,
    null,
    null,
    null,
  ],
  [
    "APPOINTMENT_DISCOVERY",
    "calendar_connector",
    "CONNECTOR",
    "WARNING",
    "HIGH",
    "CONNECTOR_CONNECTED",
    ["calendar"],
    1,
    null,
    null,
    300,
  ],
  [
    "APPOINTMENT_DISCOVERY",
    "availability_tool",
    "TOOL",
    "WARNING",
    "HIGH",
    "TOOL_AVAILABLE",
    ["calendar.availability"],
    1,
    null,
    null,
    300,
  ],
  [
    "APPOINTMENT_BOOKING",
    "booking_constraints",
    "FACT",
    "BLOCKER",
    "HIGH",
    "FACT_KEY_PREFIX",
    ["booking/"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "APPOINTMENT_BOOKING",
    "confirmation_rule",
    "RULE",
    "BLOCKER",
    "HIGH",
    "RULE_TYPE_IN",
    ["APPROVAL"],
    1,
    null,
    null,
    null,
  ],
  [
    "APPOINTMENT_BOOKING",
    "calendar_connector",
    "CONNECTOR",
    "BLOCKER",
    "HIGH",
    "CONNECTOR_CONNECTED",
    ["calendar"],
    1,
    null,
    null,
    300,
  ],
  [
    "APPOINTMENT_BOOKING",
    "booking_tool",
    "TOOL",
    "BLOCKER",
    "HIGH",
    "TOOL_AVAILABLE",
    ["calendar.booking"],
    1,
    null,
    null,
    300,
  ],
  [
    "APPOINTMENT_BOOKING",
    "booking_permission",
    "PERMISSION",
    "BLOCKER",
    "HIGH",
    "PERMISSION_GRANTED",
    ["calendar.write"],
    1,
    null,
    null,
    null,
  ],
  [
    "APPOINTMENT_BOOKING",
    "booking_safety_cases",
    "EVALUATION_CASE",
    "BLOCKER",
    "HIGH",
    "EVALUATION_CASE_PASS",
    ["appointment_booking", "double_booking", "confirmation"],
    null,
    10_000,
    604_800,
    604_800,
  ],
  [
    "ORDER_ACCOUNT_SUPPORT",
    "support_policy",
    "RULE",
    "BLOCKER",
    "HIGH",
    "RULE_TYPE_IN",
    ["ESCALATION", "PROHIBITION"],
    1,
    null,
    null,
    null,
  ],
  [
    "ORDER_ACCOUNT_SUPPORT",
    "account_lookup_tool",
    "TOOL",
    "BLOCKER",
    "HIGH",
    "TOOL_AVAILABLE",
    ["account.lookup", "order.lookup"],
    1,
    null,
    null,
    300,
  ],
  [
    "ORDER_ACCOUNT_SUPPORT",
    "customer_state_permission",
    "PERMISSION",
    "BLOCKER",
    "HIGH",
    "PERMISSION_GRANTED",
    ["customer_state.read"],
    1,
    null,
    null,
    null,
  ],
  [
    "ORDER_ACCOUNT_SUPPORT",
    "identity_verification_cases",
    "EVALUATION_CASE",
    "BLOCKER",
    "HIGH",
    "EVALUATION_CASE_PASS",
    ["identity_verification", "data_disclosure"],
    null,
    10_000,
    604_800,
    604_800,
  ],
  [
    "COMMERCE_RECOMMENDATION",
    "product_attributes",
    "FACT",
    "WARNING",
    "MEDIUM",
    "FACT_KEY_PREFIX",
    ["product/"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "COMMERCE_RECOMMENDATION",
    "commerce_policies",
    "RULE",
    "WARNING",
    "HIGH",
    "RULE_TYPE_IN",
    ["APPROVAL", "PROHIBITION"],
    1,
    null,
    null,
    null,
  ],
  [
    "COMMERCE_RECOMMENDATION",
    "inventory_tool",
    "TOOL",
    "WARNING",
    "HIGH",
    "TOOL_AVAILABLE",
    ["inventory.lookup"],
    1,
    null,
    null,
    300,
  ],
  [
    "COMMERCE_RECOMMENDATION",
    "catalog_connector",
    "CONNECTOR",
    "WARNING",
    "MEDIUM",
    "CONNECTOR_CONNECTED",
    ["commerce_catalog"],
    1,
    null,
    null,
    3_600,
  ],
  [
    "REGULATED_TOPIC",
    "approved_wording",
    "DOCUMENT_COVERAGE",
    "BLOCKER",
    "CRITICAL",
    "DOCUMENT_COUNT",
    ["APPROVED", "REGULATED"],
    1,
    null,
    null,
    86_400,
  ],
  [
    "REGULATED_TOPIC",
    "regulated_rules",
    "RULE",
    "BLOCKER",
    "CRITICAL",
    "RULE_TYPE_IN",
    ["PROHIBITION", "ESCALATION"],
    2,
    null,
    null,
    null,
  ],
  [
    "REGULATED_TOPIC",
    "specialist_permission",
    "PERMISSION",
    "BLOCKER",
    "CRITICAL",
    "PERMISSION_GRANTED",
    ["regulated_specialist_handoff"],
    1,
    null,
    null,
    null,
  ],
  [
    "REGULATED_TOPIC",
    "regulated_safety_cases",
    "EVALUATION_CASE",
    "BLOCKER",
    "CRITICAL",
    "EVALUATION_CASE_PASS",
    ["regulated_refusal", "mandatory_disclaimer", "specialist_handoff"],
    null,
    10_000,
    604_800,
    604_800,
  ],
] as const satisfies readonly KnowledgeCapabilityDefaultRequirementRowV1[];

export const KNOWLEDGE_CAPABILITY_DEFAULT_REQUIREMENT_TEMPLATES_V1: readonly KnowledgeCapabilityDefaultRequirementTemplateV1[] =
  requirementTemplateRows.map(
    ([
      capabilityType,
      requirementKey,
      kind,
      severity,
      riskLevel,
      operator,
      values,
      minimumCount,
      minimumCoverageBps,
      maxAgeSeconds,
      freshnessSlaSeconds,
    ]) => ({
      capabilityType,
      requirementKey,
      definitionVersion: 2,
      kind,
      severity,
      riskLevel,
      active: true,
      freshnessSlaSeconds,
      requiredScope: null,
      localeConstraints: null,
      satisfactionPredicate: {
        schemaVersion: 1,
        operator,
        values: [...values],
        ...(minimumCount === null ? {} : { minimumCount }),
        ...(minimumCoverageBps === null ? {} : { minimumCoverageBps }),
        ...(maxAgeSeconds === null ? {} : { maxAgeSeconds }),
      },
      predicateVersion: KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1,
      templateOrigin: "PLATFORM_V2",
      tenantOverride: false,
    }),
  );

const capabilityNames: Record<KnowledgeCapabilityTypeV1, string> = {
  GENERAL_FAQ: "General FAQ",
  LEAD_QUALIFICATION: "Lead qualification",
  PRICING: "Pricing",
  APPOINTMENT_DISCOVERY: "Appointment discovery",
  APPOINTMENT_BOOKING: "Appointment booking",
  ORDER_ACCOUNT_SUPPORT: "Order and account support",
  COMMERCE_RECOMMENDATION: "Commerce recommendation",
  REGULATED_TOPIC: "Regulated topics",
};

function defaultCapabilityId(capabilityType: KnowledgeCapabilityTypeV1) {
  return `platform-v1:${capabilityType.toLowerCase().replaceAll("_", "-")}`;
}

export function buildDefaultKnowledgeCapabilityIdV1(
  tenantId: string,
  capabilityType: KnowledgeCapabilityTypeV1,
) {
  const digest = createHash("md5")
    .update(`${tenantId}:${capabilityType}:workspace-v2`, "utf8")
    .digest("hex");
  return `kvc_v1_${digest}`;
}

function requirementLabel(requirementKey: string) {
  return requirementKey
    .split("_")
    .map((part, index) => (index === 0 ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

export interface BuildDefaultKnowledgeCapabilityDefinitionsOptionsV1 {
  tenantId?: string;
  capabilityIds?: Partial<Record<KnowledgeCapabilityTypeV1, string>>;
  enabled?: Partial<Record<KnowledgeCapabilityTypeV1, boolean>>;
  allowedAutonomy?: Partial<Record<KnowledgeCapabilityTypeV1, KnowledgeCapabilityAutonomyV1>>;
}

export function buildDefaultKnowledgeCapabilityDefinitionsV1(
  options: BuildDefaultKnowledgeCapabilityDefinitionsOptionsV1 = {},
): KnowledgeCapabilityDefinitionV1[] {
  return KNOWLEDGE_CAPABILITY_DEFAULT_TEMPLATES_V1.map((template) => ({
    schemaVersion: 1,
    capabilityId:
      options.capabilityIds?.[template.capabilityType] ??
      (options.tenantId
        ? buildDefaultKnowledgeCapabilityIdV1(options.tenantId, template.capabilityType)
        : defaultCapabilityId(template.capabilityType)),
    capabilityType: template.capabilityType,
    targetKey: template.targetKey,
    name: capabilityNames[template.capabilityType],
    enabled: options.enabled?.[template.capabilityType] ?? template.enabled,
    allowedAutonomy: options.allowedAutonomy?.[template.capabilityType] ?? template.allowedAutonomy,
    templateKey: template.templateKey,
    templateVersion: template.templateVersion,
    serverOwned: template.serverOwned,
    weight: 100,
    requiredScope: null,
    localeConstraints: null,
    requirements: KNOWLEDGE_CAPABILITY_DEFAULT_REQUIREMENT_TEMPLATES_V1.filter(
      (requirement) => requirement.capabilityType === template.capabilityType,
    ).map((requirement) => ({
      schemaVersion: 1,
      requirementKey: requirement.requirementKey,
      definitionVersion: requirement.definitionVersion,
      predicateVersion: requirement.predicateVersion,
      kind: requirement.kind,
      label: requirementLabel(requirement.requirementKey),
      severity: requirement.severity,
      riskLevel: requirement.riskLevel,
      active: requirement.active,
      requiredScope: requirement.requiredScope,
      localeConstraints: requirement.localeConstraints,
      freshnessSlaSeconds: requirement.freshnessSlaSeconds,
      satisfactionPredicate: {
        ...requirement.satisfactionPredicate,
        values: [...requirement.satisfactionPredicate.values],
      },
      templateOrigin: requirement.templateOrigin,
      tenantOverride: requirement.tenantOverride,
    })),
  }));
}
