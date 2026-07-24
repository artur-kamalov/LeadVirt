import assert from "node:assert/strict";

import {
  KNOWLEDGE_CAPABILITY_DEFAULT_REQUIREMENT_TEMPLATES_V1,
  KNOWLEDGE_CAPABILITY_DEFAULT_TEMPLATES_V1,
  KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1,
  KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
  buildDefaultKnowledgeCapabilityDefinitionsV1,
  computeCurrentKnowledgeCapabilityConfigHashV1,
  evaluateKnowledgeCapabilitySnapshotV1,
  hashKnowledgeCapabilitySetV1,
  parseKnowledgeCapabilityRequirementPredicateV1,
  type KnowledgeCapabilityDefinitionV1,
  type KnowledgeCapabilityEvidenceV1,
  type KnowledgeCapabilityRequirementDefinitionV1,
  type KnowledgeCapabilityRequirementKindV1,
  type KnowledgeCapabilityRequirementStatusV1,
} from "./capability-snapshot-v1.js";

const evaluatedAt = "2026-07-14T12:00:00.000Z";

function requirement(
  requirementKey: string,
  kind: KnowledgeCapabilityRequirementKindV1,
  satisfactionPredicate: unknown,
  overrides: Partial<KnowledgeCapabilityRequirementDefinitionV1> = {},
): KnowledgeCapabilityRequirementDefinitionV1 {
  return {
    schemaVersion: 1,
    requirementKey,
    definitionVersion: 1,
    predicateVersion: KNOWLEDGE_CAPABILITY_REQUIREMENT_PREDICATE_V1,
    kind,
    label: requirementKey,
    severity: "BLOCKER",
    riskLevel: "HIGH",
    active: true,
    requiredScope: null,
    localeConstraints: null,
    freshnessSlaSeconds: null,
    satisfactionPredicate,
    templateOrigin: "SMOKE_V1",
    tenantOverride: false,
    ...overrides,
  };
}

function capability(
  requirements: readonly KnowledgeCapabilityRequirementDefinitionV1[],
  overrides: Partial<KnowledgeCapabilityDefinitionV1> = {},
): KnowledgeCapabilityDefinitionV1 {
  return {
    schemaVersion: 1,
    capabilityId: "capability-smoke",
    capabilityType: "GENERAL_FAQ",
    targetKey: "workspace-v2",
    name: "Smoke",
    enabled: true,
    allowedAutonomy: "ANSWER_ONLY",
    templateKey: "smoke.capability",
    templateVersion: 1,
    serverOwned: true,
    weight: 100,
    requiredScope: null,
    localeConstraints: null,
    ...overrides,
    requirements,
  };
}

function snapshot(
  capabilities: readonly KnowledgeCapabilityDefinitionV1[],
  evidence: readonly KnowledgeCapabilityEvidenceV1[] = [],
  tenantSupportedLocales?: readonly string[],
) {
  return evaluateKnowledgeCapabilitySnapshotV1({
    schemaVersion: 1,
    evaluatedAt,
    ...(tenantSupportedLocales === undefined ? {} : { tenantSupportedLocales }),
    capabilities,
    evidence,
  });
}

function statusFor(
  definition: KnowledgeCapabilityDefinitionV1,
  evidence: readonly KnowledgeCapabilityEvidenceV1[] = [],
  tenantSupportedLocales?: readonly string[],
): KnowledgeCapabilityRequirementStatusV1 {
  return snapshot([definition], evidence, tenantSupportedLocales).capabilities[0]!.requirements[0]!
    .status;
}

const allKindRequirements: KnowledgeCapabilityRequirementDefinitionV1[] = [
  requirement("fact", "FACT", {
    schemaVersion: 1,
    operator: "FACT_KEY_EQUALS",
    values: ["business/name"],
    minimumCount: 1,
  }),
  requirement("rule", "RULE", {
    schemaVersion: 1,
    operator: "RULE_TYPE_IN",
    values: ["ESCALATION"],
    minimumCount: 1,
  }),
  requirement("document", "DOCUMENT_COVERAGE", {
    schemaVersion: 1,
    operator: "DOCUMENT_COUNT",
    values: ["APPROVED", "REGULATED"],
    minimumCount: 1,
  }),
  requirement("connector", "CONNECTOR", {
    schemaVersion: 1,
    operator: "CONNECTOR_CONNECTED",
    values: ["calendar"],
    minimumCount: 1,
  }),
  requirement("tool", "TOOL", {
    schemaVersion: 1,
    operator: "TOOL_AVAILABLE",
    values: ["quote.lookup"],
    minimumCount: 1,
  }),
  requirement("permission", "PERMISSION", {
    schemaVersion: 1,
    operator: "PERMISSION_GRANTED",
    values: ["calendar.write"],
    minimumCount: 1,
  }),
  requirement("locale", "LOCALE", {
    schemaVersion: 1,
    operator: "LOCALE_COVERAGE",
    values: ["TENANT_SUPPORTED"],
    minimumCoverageBps: 10_000,
  }),
  requirement("evaluation", "EVALUATION_CASE", {
    schemaVersion: 1,
    operator: "EVALUATION_CASE_PASS",
    values: ["case-a", "case-b"],
    minimumCoverageBps: 10_000,
  }),
];

const allKindEvidence: KnowledgeCapabilityEvidenceV1[] = [
  {
    schemaVersion: 1,
    evidenceId: "fact-1",
    kind: "FACT",
    ref: { type: "FACT_VERSION", id: "fact-1", versionId: "fact-version-1" },
    factKey: "business/name",
    fieldType: "TEXT",
    verificationStatus: "VERIFIED",
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "rule-1",
    kind: "RULE",
    ref: { type: "GUIDANCE_RULE_VERSION", id: "rule-1", versionId: "rule-version-1" },
    ruleType: "ESCALATION",
    reviewStatus: "APPROVED",
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "document-1",
    kind: "DOCUMENT_COVERAGE",
    ref: { type: "DOCUMENT_REVISION", id: "document-1", versionId: "revision-1" },
    documentKey: "regulated-wording",
    tags: ["REGULATED", "APPROVED"],
    ready: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "connector-1",
    kind: "CONNECTOR",
    ref: { type: "CONNECTOR", id: "connector-1" },
    connectorKey: "calendar-primary",
    connectorType: "calendar",
    connected: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "tool-1",
    kind: "TOOL",
    ref: { type: "TOOL", id: "tool-1" },
    toolKey: "quote.lookup",
    available: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "permission-1",
    kind: "PERMISSION",
    ref: { type: "PERMISSION", id: "permission-1" },
    permissionKey: "calendar.write",
    granted: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "locale-en",
    kind: "LOCALE",
    ref: { type: "LOCALE", id: "locale-en" },
    locale: "en",
    covered: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "locale-fr",
    kind: "LOCALE",
    ref: { type: "LOCALE", id: "locale-fr" },
    locale: "fr",
    covered: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "case-a",
    kind: "EVALUATION_CASE",
    ref: { type: "EVALUATION_CASE", id: "case-a", versionHash: "hash-a" },
    caseKey: "case-a",
    passed: true,
    observedAt: evaluatedAt,
  },
  {
    schemaVersion: 1,
    evidenceId: "case-b",
    kind: "EVALUATION_CASE",
    ref: { type: "EVALUATION_CASE", id: "case-b", versionHash: "hash-b" },
    caseKey: "case-b",
    passed: true,
    observedAt: evaluatedAt,
  },
];

const defaults = buildDefaultKnowledgeCapabilityDefinitionsV1();
assert.equal(
  KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION,
  "knowledge-capability-snapshot-v2",
);
assert.notEqual(
  computeCurrentKnowledgeCapabilityConfigHashV1(),
  "fe5dc01bff09f40141937149fc58d9f59be9878542b3e729291084a9ae59b1d0",
);
assert.equal(KNOWLEDGE_CAPABILITY_DEFAULT_TEMPLATES_V1.length, 8);
assert.equal(KNOWLEDGE_CAPABILITY_DEFAULT_REQUIREMENT_TEMPLATES_V1.length, 36);
assert.equal(defaults.length, 8);
assert.equal(defaults.flatMap((item) => item.requirements).length, 36);
assert.deepEqual(
  defaults.filter((item) => item.enabled).map((item) => item.capabilityType),
  ["GENERAL_FAQ", "PRICING", "APPOINTMENT_DISCOVERY", "COMMERCE_RECOMMENDATION"],
);
assert.ok(
  defaults
    .flatMap((item) => item.requirements)
    .every((item) => item.definitionVersion === 2 && item.templateOrigin === "PLATFORM_V2"),
);
const defaultRequirementsByCapability = new Map(
  defaults.map((item) => [item.capabilityType, item.requirements]),
);
for (const capabilityType of [
  "GENERAL_FAQ",
  "PRICING",
  "APPOINTMENT_DISCOVERY",
  "COMMERCE_RECOMMENDATION",
] as const) {
  assert.ok(
    defaultRequirementsByCapability
      .get(capabilityType)!
      .every((requirement) => requirement.severity === "WARNING"),
    `${capabilityType} must launch in grounded answer-only mode without setup blockers.`,
  );
}
assert.deepEqual(
  defaultRequirementsByCapability
    .get("LEAD_QUALIFICATION")!
    .filter((requirement) => requirement.severity === "BLOCKER")
    .map((requirement) => requirement.requirementKey),
  ["collection_consent"],
);
assert.deepEqual(
  [...new Set(defaults.flatMap((item) => item.requirements.map((entry) => entry.kind)))].sort(),
  [
    "CONNECTOR",
    "DOCUMENT_COVERAGE",
    "EVALUATION_CASE",
    "FACT",
    "LOCALE",
    "PERMISSION",
    "RULE",
    "TOOL",
  ],
);
assert.ok(
  defaults
    .flatMap((item) => item.requirements)
    .every((item) => parseKnowledgeCapabilityRequirementPredicateV1(item.satisfactionPredicate)),
);
assert.match(computeCurrentKnowledgeCapabilityConfigHashV1(), /^[a-f0-9]{64}$/u);

const allKinds = capability(allKindRequirements);
const ready = snapshot([allKinds], allKindEvidence, ["fr", "en"]);
assert.equal(ready.evaluatorVersion, KNOWLEDGE_CAPABILITY_SNAPSHOT_V1_EVALUATOR_VERSION);
assert.equal(ready.capabilities[0]!.status, "READY");
assert.equal(ready.executableReadiness.status, "READY");
assert.equal(ready.capabilities[0]!.configurationHash, ready.capabilities[0]!.capabilityHash);
assert.ok(ready.capabilities[0]!.requirements.every((item) => item.status === "SATISFIED"));
assert.ok(ready.capabilities[0]!.requirements.every((item) => item.explanation.length > 0));
assert.ok(ready.capabilities[0]!.requirements.every((item) => item.remediation === null));
assert.ok(ready.capabilities[0]!.requirements.every((item) => item.evidenceRefs.length > 0));

const reversed = snapshot(
  [capability([...allKindRequirements].reverse())],
  [...allKindEvidence].reverse(),
  ["en", "fr"],
);
assert.equal(reversed.capabilitySetHash, ready.capabilitySetHash);
assert.equal(reversed.requirementEvaluationSetHash, ready.requirementEvaluationSetHash);
assert.equal(reversed.snapshotHash, ready.snapshotHash);

const laterReady = evaluateKnowledgeCapabilitySnapshotV1({
  schemaVersion: 1,
  evaluatedAt: "2026-07-14T12:00:01.000Z",
  tenantSupportedLocales: ["en", "fr"],
  capabilities: [allKinds],
  evidence: allKindEvidence,
});
assert.equal(laterReady.requirementEvaluationSetHash, ready.requirementEvaluationSetHash);
assert.notEqual(laterReady.snapshotHash, ready.snapshotHash);

const reorderedPredicateCapability = capability(
  allKindRequirements.map((item) =>
    item.requirementKey === "evaluation"
      ? {
          ...item,
          satisfactionPredicate: {
            schemaVersion: 1,
            operator: "EVALUATION_CASE_PASS",
            values: ["case-b", "case-a", "case-b"],
            minimumCoverageBps: 10_000,
          },
        }
      : item,
  ),
);
assert.equal(
  hashKnowledgeCapabilitySetV1([reorderedPredicateCapability]),
  hashKnowledgeCapabilitySetV1([allKinds]),
);
assert.equal(
  snapshot([reorderedPredicateCapability], allKindEvidence, ["fr", "en"])
    .requirementEvaluationSetHash,
  ready.requirementEvaluationSetHash,
);

const driftedRequirement = requirement("fact", "FACT", {
  schemaVersion: 1,
  operator: "FACT_KEY_EQUALS",
  values: ["business/name"],
  minimumCount: 2,
});
assert.notEqual(
  hashKnowledgeCapabilitySetV1([capability([driftedRequirement])]),
  hashKnowledgeCapabilitySetV1([capability([allKindRequirements[0]!])]),
);

const evidenceDrift = allKindEvidence.map((item) =>
  item.kind === "TOOL" ? { ...item, available: false } : item,
);
const driftedEvaluation = snapshot([allKinds], evidenceDrift, ["en", "fr"]);
assert.equal(driftedEvaluation.capabilities[0]!.status, "BLOCKED");
assert.equal(driftedEvaluation.capabilities[0]!.executable, false);
assert.deepEqual(driftedEvaluation.executableReadiness.capabilityIds, []);
assert.equal(driftedEvaluation.executableReadiness.status, "BLOCKED");
assert.notEqual(driftedEvaluation.requirementEvaluationSetHash, ready.requirementEvaluationSetHash);
assert.notEqual(
  driftedEvaluation.capabilities[0]!.evaluationHash,
  ready.capabilities[0]!.evaluationHash,
);

const factRequirement = requirement("fresh-fact", "FACT", {
  schemaVersion: 1,
  operator: "FACT_KEY_EQUALS",
  values: ["business/name"],
  maxAgeSeconds: 60,
});
const factCapability = capability([factRequirement]);
const factEvidence = allKindEvidence[0]!;
assert.equal(statusFor(factCapability, [factEvidence]), "SATISFIED");
assert.equal(statusFor(factCapability), "UNSATISFIED");
assert.equal(
  statusFor(factCapability, [{ ...factEvidence, observedAt: "2026-07-14T11:58:00.000Z" }]),
  "STALE",
);
assert.equal(
  statusFor(factCapability, [{ ...factEvidence, activeConflictIds: ["conflict-1"] }]),
  "CONFLICTED",
);
assert.equal(
  statusFor(capability([factRequirement], { enabled: false }), [factEvidence]),
  "NOT_APPLICABLE",
);
const disabled = snapshot([capability([factRequirement], { enabled: false })], [factEvidence]);
assert.equal(disabled.executableReadiness.status, "NOT_APPLICABLE");
assert.deepEqual(disabled.executableReadiness.capabilityIds, []);

const staleBySla = capability([
  requirement(
    "sla-fact",
    "FACT",
    {
      schemaVersion: 1,
      operator: "FACT_KEY_EQUALS",
      values: ["business/name"],
      maxAgeSeconds: 300,
    },
    { freshnessSlaSeconds: 30 },
  ),
]);
assert.equal(
  statusFor(staleBySla, [{ ...factEvidence, observedAt: "2026-07-14T11:59:00.000Z" }]),
  "STALE",
);

const scoped = capability([
  requirement(
    "scoped-fact",
    "FACT",
    { schemaVersion: 1, operator: "FACT_KEY_EQUALS", values: ["business/name"] },
    { requiredScope: { brandIds: ["brand-a", "brand-b"] } },
  ),
]);
const brandA: KnowledgeCapabilityEvidenceV1 = {
  ...factEvidence,
  evidenceId: "fact-brand-a",
  ref: { type: "FACT_VERSION", id: "fact-brand-a" },
  scope: { brandIds: ["brand-a"] },
};
const brandB: KnowledgeCapabilityEvidenceV1 = {
  ...factEvidence,
  evidenceId: "fact-brand-b",
  ref: { type: "FACT_VERSION", id: "fact-brand-b" },
  scope: { brandIds: ["brand-b"] },
};
assert.equal(statusFor(scoped, [brandA, brandB]), "SATISFIED");
const scopedFailure = snapshot([scoped], [brandA]).capabilities[0]!.requirements[0]!;
assert.equal(scopedFailure.status, "UNSATISFIED");
assert.equal(scopedFailure.reasonCode, "SCOPE_NOT_COVERED");
assert.equal(scopedFailure.remediation?.action, "ADD_OR_VERIFY_FACT");

const localeConstrained = capability([
  requirement(
    "localized-fact",
    "FACT",
    { schemaVersion: 1, operator: "FACT_KEY_EQUALS", values: ["business/name"] },
    { localeConstraints: { mode: "ALL", locales: ["en", "fr"] } },
  ),
]);
assert.equal(statusFor(localeConstrained, [{ ...factEvidence, locales: ["*"] }]), "SATISFIED");
assert.equal(statusFor(localeConstrained, [{ ...factEvidence, locales: ["en"] }]), "UNSATISFIED");

const localeRequirement = capability([allKindRequirements.find((item) => item.kind === "LOCALE")!]);
const missingLocaleContext = snapshot([localeRequirement], allKindEvidence);
assert.equal(
  missingLocaleContext.capabilities[0]!.requirements[0]!.reasonCode,
  "LOCALE_CONTEXT_MISSING",
);
assert.equal(
  statusFor(
    localeRequirement,
    allKindEvidence.filter((item) => item.kind === "LOCALE"),
    ["en", "fr"],
  ),
  "SATISFIED",
);

const regulatedDocument = capability([
  allKindRequirements.find((item) => item.kind === "DOCUMENT_COVERAGE")!,
]);
const genericApproved = allKindEvidence.find((item) => item.kind === "DOCUMENT_COVERAGE")!;
assert.equal(
  statusFor(regulatedDocument, [{ ...genericApproved, tags: ["APPROVED"] }]),
  "UNSATISFIED",
);

const invalidPredicates: unknown[] = [
  { schemaVersion: 2, operator: "FACT_KEY_EQUALS", values: ["business/name"] },
  { schemaVersion: 1, operator: "UNKNOWN", values: ["business/name"] },
  { schemaVersion: 1, operator: "FACT_KEY_EQUALS", values: ["business/name"], extra: true },
  { schemaVersion: 1, operator: "RULE_TYPE_IN", values: ["ESCALATION"] },
];
for (const invalidPredicate of invalidPredicates) {
  const capabilityEvaluation = snapshot([
    capability([requirement("invalid", "FACT", invalidPredicate, { severity: "WARNING" })]),
  ]).capabilities[0]!;
  const evaluation = capabilityEvaluation.requirements[0]!;
  assert.equal(evaluation.status, "UNSATISFIED");
  assert.equal(evaluation.reasonCode, "INVALID_PREDICATE");
  assert.equal(capabilityEvaluation.status, "BLOCKED");
  assert.ok(capabilityEvaluation.configurationErrors.includes("INVALID_ACTIVE_REQUIREMENT"));
}

assert.ok(
  parseKnowledgeCapabilityRequirementPredicateV1({
    schemaVersion: 1,
    operator: "DOCUMENT_COUNT",
    values: ["*"],
    minimumCoverageBps: 0,
    maxAgeSeconds: 0,
  }),
);
assert.ok(
  parseKnowledgeCapabilityRequirementPredicateV1({
    schemaVersion: 1,
    operator: "LOCALE_COVERAGE",
    values: ["TENANT_SUPPORTED"],
  }),
);
assert.equal(
  parseKnowledgeCapabilityRequirementPredicateV1({
    schemaVersion: 1,
    operator: "LOCALE_COVERAGE",
    values: ["TENANT_SUPPORTED", "en"],
  }),
  null,
);

const warningOnly = capability([
  requirement(
    "warning",
    "FACT",
    { schemaVersion: 1, operator: "FACT_KEY_EQUALS", values: ["missing"] },
    { severity: "WARNING" },
  ),
]);
assert.equal(snapshot([warningOnly]).capabilities[0]!.status, "READY_WITH_WARNINGS");
const mixedLaunch = snapshot([
  warningOnly,
  capability([factRequirement], {
    capabilityId: "blocked-optional-capability",
    capabilityType: "APPOINTMENT_BOOKING",
  }),
]);
assert.deepEqual(mixedLaunch.executableReadiness.capabilityIds, [warningOnly.capabilityId]);
assert.equal(mixedLaunch.executableReadiness.status, "READY_WITH_WARNINGS");
assert.equal(mixedLaunch.executableReadiness.blockerCount, 1);

const duplicateEvidenceA = { ...factEvidence, verificationStatus: "VERIFIED" as const };
const duplicateEvidenceB = { ...factEvidence, verificationStatus: "UNVERIFIED" as const };
assert.equal(
  snapshot([factCapability], [duplicateEvidenceA, duplicateEvidenceB]).requirementEvaluationSetHash,
  snapshot([factCapability], [duplicateEvidenceB, duplicateEvidenceA]).requirementEvaluationSetHash,
);

const defaultSnapshot = snapshot(defaults, [], ["en"]);
assert.deepEqual(
  defaultSnapshot.executableReadiness.capabilityIds,
  defaults
    .filter((item) => item.enabled)
    .map((item) => item.capabilityId)
    .sort(),
);
assert.equal(defaultSnapshot.executableReadiness.status, "READY_WITH_WARNINGS");
assert.ok(
  defaultSnapshot.capabilities
    .filter((item) => !item.enabled)
    .every((item) => item.status === "NOT_APPLICABLE"),
);

console.log("knowledge capability snapshot v1 smoke passed");
