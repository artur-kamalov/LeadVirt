import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  businessImportCanonicalProvenancePath,
  businessImportEvidenceRecordHash,
  businessOfferingValueHash,
  compareBusinessImportDecimals,
  isBusinessImportCurrencyCode,
  normalizeBusinessExternalId,
  sortedBusinessImportFieldProvenance,
  type BusinessImportFieldAuthority,
  type BusinessImportFieldProvenancePath,
} from "@leadvirt/business-import";
import { Prisma } from "@leadvirt/db";
import {
  createDeterministicKnowledgeObjectKey,
  type KnowledgeObjectStore,
} from "@leadvirt/knowledge";
import type {
  BusinessImportApplicationView,
  BusinessImportApplyPreviewRequest,
  BusinessImportApplyPreviewView,
  BusinessImportApplyRequest,
  BusinessImportDiagnosticView,
  BusinessImportOfferingValue,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import { canonicalKnowledgeV2Hash } from "../knowledge/knowledge-v2-http.js";
import { lockKnowledgeV2CorpusTransition } from "../knowledge/knowledge-v2-transition-lock.js";
import {
  assertBusinessImportIfMatch,
  businessImportEtag,
  businessImportError,
  businessImportManifestHash,
  businessInformationEtag,
} from "./business-import-http.js";
import {
  adoptPendingBusinessImportObject,
  cleanupPendingBusinessImportObject,
  putPendingBusinessImportObject,
  reservePendingBusinessImportObject,
  type PendingBusinessImportObject,
} from "./business-import-object-lifecycle.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessInformationStateService } from "./business-information-state.service.js";

const PREVIEW_TTL_MS = 65 * 60 * 1000;
const PREVIEW_IDEMPOTENCY_RETENTION_MS = 60 * 60 * 1000;
const MAX_CANDIDATES = 200;
const PREVIEW_RETENTION_CLASS = "BUSINESS_IMPORT_APPLICATION_PREVIEW";
const REVISION_RETENTION_CLASS = "BUSINESS_INFORMATION_REVISION";
const REVISION_PENDING_TTL_MS = 24 * 60 * 60_000;

type ApplicationRecord = Prisma.BusinessImportApplicationGetPayload<{
  include: { projectionReceipt: true; projectionOutbox: true };
}>;

type OfferingRow = Prisma.BusinessOfferingGetPayload<{
  include: { prices: true; duration: true; sourceBindings: true };
}>;

type CandidateRow = Prisma.BusinessImportCandidateGetPayload<Record<string, never>>;

interface PreviewEvidence {
  id: string;
  evidenceRecordHash: string;
  sourceValueHash: string;
  excerptHash: string;
  artifactId: string;
  artifactSha256: string;
  importGeneration: number;
  parsedRevisionId: string;
  parsedManifestHash: string;
  parserVersion: string;
  ocrVersion: string | null;
  extractionContractVersion: string;
  objectLedgerId: string;
  objectKind: "EVIDENCE_EXCERPT";
  objectKey: string;
  encryptionKeyRef: string;
}

interface PreviewCandidate {
  id: string;
  etag: number;
  version: number;
  valueHash: string;
  candidateKey: string;
  semanticTargetKey: string;
  targetCategory: CandidateRow["targetCategory"];
  action: CandidateRow["action"];
  decision: CandidateRow["decision"];
  normalizedValue: BusinessImportOfferingValue;
  targetOfferingId: string | null;
  currentFingerprint: string | null;
  risk: CandidateRow["risk"];
  confidence: CandidateRow["confidence"];
  requiresApproval: boolean;
  requiredPermission: string;
  approvalGrantId: string | null;
  approvalGrantedByUserId: string | null;
  approvalGrantedAt: string | null;
  revision: {
    id: string;
    parsedRevisionId: string;
    importGeneration: number;
    artifactId: string;
    artifactSha256: string;
    parsedManifestHash: string;
    mappingId: string | null;
  };
  fieldProvenance: Array<{
    path: BusinessImportFieldProvenancePath;
    authority: BusinessImportFieldAuthority;
    evidence: PreviewEvidence | null;
  }>;
}

interface PreviewManifestUnsigned {
  schema: "leadvirt.business-import-application-preview.v4";
  tenantId: string;
  sourceId: string;
  importId: string;
  importGeneration: number;
  importEtag: number;
  parsedRevisionId: string;
  artifactId: string;
  artifactSha256: string;
  parsedManifestHash: string;
  parserVersion: string;
  ocrVersion: string | null;
  mapperVersion: string;
  schemaVersion: string;
  modelVersion: string | null;
  promptVersion: string | null;
  baseBusinessRevisionId: string | null;
  baseInformationRevision: number;
  baseInformationHash: string;
  businessInformationEtag: number;
  candidateIds: string[];
  candidates: PreviewCandidate[];
  candidateManifestHash: string;
  counts: {
    additions: number;
    updates: number;
    linked: number;
    unchanged: number;
    conflicts: number;
  };
  diagnostics: BusinessImportDiagnosticView[];
  createdAt: string;
  expiresAt: string;
}

interface PreviewManifest extends PreviewManifestUnsigned {
  signature: string;
}

interface PreparedPreview {
  manifest: PreviewManifest;
  manifestHash: string;
  objectKey: string;
  encryptionKeyRef: string;
  reservation: PendingBusinessImportObject;
  view: BusinessImportApplyPreviewView;
}

interface CanonicalIdentitySnapshot {
  id: string;
  displayName: string;
  legalName: string | null;
  businessType: string | null;
  description: string | null;
  defaultLocale: string;
  timezone: string;
  defaultCurrency: string;
  rowVersion: number;
}

interface CanonicalPriceSnapshot {
  id: string;
  type: "FIXED" | "FROM" | "RANGE" | "FREE" | "ON_REQUEST";
  amount: string | null;
  amountFrom: string | null;
  amountTo: string | null;
  currency: string;
  unit: string | null;
  taxNote: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  rowVersion: number;
}

interface CanonicalDurationSnapshot {
  id: string;
  minimumMinutes: number;
  maximumMinutes: number | null;
  preparationMinutes: number | null;
  bufferMinutes: number | null;
  rowVersion: number;
}

interface CanonicalOfferingSnapshot {
  id: string;
  kind: "SERVICE" | "PRODUCT" | "MENU_ITEM";
  category: string | null;
  parentCategory: string | null;
  name: string;
  description: string | null;
  locale: string;
  bookingNotes: string | null;
  active: boolean;
  archivedAt: string | null;
  rowVersion: number;
  prices: CanonicalPriceSnapshot[];
  duration: CanonicalDurationSnapshot | null;
}

interface CanonicalSnapshot {
  schema: "leadvirt.business-information.v2";
  identity: CanonicalIdentitySnapshot;
  offerings: CanonicalOfferingSnapshot[];
}

interface FieldMutation {
  resourceType: "OFFERING" | "OFFERING_PRICE" | "OFFERING_DURATION";
  resourceKey: string;
  fieldPath: string;
  value: unknown;
}

interface OfferingMutation {
  candidateId: string;
  offeringId: string;
  priceId: string | null;
  durationId: string | null;
  kind: "ADD" | "UPDATE" | "LINK" | "ARCHIVE";
  expectedOfferingVersion: number | null;
  expectedPriceVersion: number | null;
  expectedDurationVersion: number | null;
  value: BusinessImportOfferingValue;
  fields: FieldMutation[];
}

interface ApplicationPlan {
  before: CanonicalSnapshot;
  after: CanonicalSnapshot;
  beforeRowsHash: string;
  resultingHash: string;
  mutations: OfferingMutation[];
  changedFields: FieldMutation[];
  counts: { additions: number; updates: number; linked: number; unchanged: number };
}

interface PreparedApplyMutation {
  kind: "mutation";
  applicationId: string;
  revisionId: string;
  revisionLedgerId: string;
  revisionObjectKey: string;
  revisionEncryptionKeyRef: string;
  revisionReservation: PendingBusinessImportObject;
  revisionDeltaHash: string;
  previewLedgerId: string;
  manifest: PreviewManifest;
  manifestHash: string;
  idempotencyKeyHash: string;
  idempotencyRequestHash: string;
  committedAt: string;
  plan: ApplicationPlan;
  planHash: string;
}

interface PreparedApplyReplay {
  kind: "replay";
  applicationId: string;
}

type PreparedApply = PreparedApplyMutation | PreparedApplyReplay;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableText(value: unknown, maximum: number) {
  const normalized = typeof value === "string" ? value.normalize("NFC").trim() : "";
  return normalized ? normalized.slice(0, maximum) : null;
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}_${createHash("sha256")
    .update(parts.join("\0"), "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function hashKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalPrecondition(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value.join(",") : value;
  return [
    ...new Set(
      (header ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function applicationIdempotencyRequestHash(input: {
  tenantId: string;
  actorUserId: string;
  importId: string;
  candidateIds: string[];
  previewManifestHash: string;
  importIfMatch: string | string[] | undefined;
  informationIfMatch: string | string[] | undefined;
}) {
  return canonicalKnowledgeV2Hash({
    schema: "leadvirt.business-import-application-request.v1",
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    importId: input.importId,
    candidateIds: [...input.candidateIds].sort(),
    previewManifestHash: input.previewManifestHash,
    importIfMatch: canonicalPrecondition(input.importIfMatch),
    businessInformationIfMatch: canonicalPrecondition(input.informationIfMatch),
  });
}

function isoDate(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function offeringValue(value: unknown): BusinessImportOfferingValue {
  const source = record(value);
  const priceSource = record(source.price);
  const durationSource = record(source.duration);
  const priceType = ["FIXED", "FROM", "RANGE", "FREE", "ON_REQUEST"].includes(
    String(priceSource.type),
  )
    ? (priceSource.type as CanonicalPriceSnapshot["type"])
    : null;
  const name = nullableText(source.name, 160);
  if (!name) invalidCandidateValue();
  const minimumMinutes = Number(durationSource.minimumMinutes);
  const maximumMinutes =
    durationSource.maximumMinutes === null || durationSource.maximumMinutes === undefined
      ? null
      : Number(durationSource.maximumMinutes);
  const duration =
    Object.keys(durationSource).length === 0
      ? null
      : Number.isInteger(minimumMinutes) &&
          minimumMinutes >= 0 &&
          (maximumMinutes === null ||
            (Number.isInteger(maximumMinutes) && maximumMinutes >= minimumMinutes))
        ? { minimumMinutes, maximumMinutes }
        : invalidCandidateValue();
  const price = priceType
    ? {
        type: priceType,
        amount: nullableText(priceSource.amount, 64),
        from: nullableText(priceSource.from, 64),
        to: nullableText(priceSource.to, 64),
        currency: nullableText(priceSource.currency, 3)?.toUpperCase() ?? null,
        unit: nullableText(priceSource.unit, 80),
        taxNote: nullableText(priceSource.taxNote, 500),
      }
    : null;
  assertPrice(price);
  const active = source.active !== false;
  return {
    externalId: nullableText(source.externalId, 200),
    category: nullableText(source.category, 160),
    name,
    description: nullableText(source.description, 2_000),
    price,
    duration,
    locationExternalId: nullableText(source.locationExternalId, 200),
    bookingNotes: nullableText(source.bookingNotes, 1_000),
    active,
    validFrom: dateText(source.validFrom),
    validUntil: dateText(source.validUntil),
    language: nullableText(source.language, 35)?.toLowerCase() ?? null,
  };
}

function dateText(value: unknown) {
  const normalized = nullableText(value, 10);
  if (
    normalized &&
    (!/^(?!0000)\d{4}-\d{2}-\d{2}$/u.test(normalized) ||
      !Number.isFinite(Date.parse(`${normalized}T00:00:00.000Z`)) ||
      new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !== normalized)
  )
    invalidCandidateValue();
  return normalized;
}

function canonicalDecimal(value: string | null | undefined) {
  return value ? new Prisma.Decimal(value).toString() : null;
}

function assertPrice(price: BusinessImportOfferingValue["price"]) {
  if (!price) return;
  const decimal = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/u;
  for (const value of [price.amount, price.from, price.to]) {
    if (value !== null && value !== undefined && !decimal.test(value)) invalidCandidateValue();
  }
  if (
    price.currency !== null &&
    price.currency !== undefined &&
    !isBusinessImportCurrencyCode(price.currency)
  ) {
    invalidCandidateValue();
  }
  if (price.type === "FIXED" && (!price.amount || price.from || price.to)) invalidCandidateValue();
  if (price.type === "FROM" && (price.amount || !price.from || price.to)) invalidCandidateValue();
  if (
    price.type === "RANGE" &&
    (price.amount ||
      !price.from ||
      !price.to ||
      compareBusinessImportDecimals(price.to, price.from) < 0)
  )
    invalidCandidateValue();
  if (["FREE", "ON_REQUEST"].includes(price.type) && (price.amount || price.from || price.to)) {
    invalidCandidateValue();
  }
}

function invalidCandidateValue(): never {
  throw businessImportError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "BUSINESS_IMPORT_CANDIDATE_VALUE_INVALID",
    "The proposed service value is invalid.",
  );
}

function canonicalSnapshot(identity: CanonicalIdentitySnapshot, offerings: OfferingRow[]) {
  return {
    schema: "leadvirt.business-information.v2" as const,
    identity,
    offerings: offerings
      .map((offering) => ({
        id: offering.id,
        kind: offering.kind,
        category: offering.category,
        parentCategory: offering.parentCategory,
        name: offering.name,
        description: offering.description,
        locale: offering.locale,
        bookingNotes: offering.bookingNotes,
        active: offering.active,
        archivedAt: offering.archivedAt?.toISOString() ?? null,
        rowVersion: offering.rowVersion,
        prices: offering.prices
          .map((price) => ({
            id: price.id,
            type: price.type,
            amount: price.amount?.toString() ?? null,
            amountFrom: price.amountFrom?.toString() ?? null,
            amountTo: price.amountTo?.toString() ?? null,
            currency: price.currency,
            unit: price.unit,
            taxNote: price.taxNote,
            effectiveFrom: isoDate(price.effectiveFrom),
            effectiveUntil: isoDate(price.effectiveUntil),
            rowVersion: price.rowVersion,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        duration: offering.duration
          ? {
              id: offering.duration.id,
              minimumMinutes: offering.duration.minimumMinutes,
              maximumMinutes: offering.duration.maximumMinutes,
              preparationMinutes: offering.duration.preparationMinutes,
              bufferMinutes: offering.duration.bufferMinutes,
              rowVersion: offering.duration.rowVersion,
            }
          : null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  } satisfies CanonicalSnapshot;
}

function canonicalContent(snapshot: CanonicalSnapshot) {
  return {
    schema: snapshot.schema,
    identity: {
      id: snapshot.identity.id,
      displayName: snapshot.identity.displayName,
      legalName: snapshot.identity.legalName,
      businessType: snapshot.identity.businessType,
      description: snapshot.identity.description,
      defaultLocale: snapshot.identity.defaultLocale,
      timezone: snapshot.identity.timezone,
      defaultCurrency: snapshot.identity.defaultCurrency,
    },
    offerings: snapshot.offerings.map((offering) => ({
      id: offering.id,
      kind: offering.kind,
      category: offering.category,
      parentCategory: offering.parentCategory,
      name: offering.name,
      description: offering.description,
      locale: offering.locale,
      bookingNotes: offering.bookingNotes,
      active: offering.active,
      archivedAt: offering.archivedAt,
      prices: offering.prices.map((price) => ({
        id: price.id,
        type: price.type,
        amount: price.amount,
        amountFrom: price.amountFrom,
        amountTo: price.amountTo,
        currency: price.currency,
        unit: price.unit,
        taxNote: price.taxNote,
        effectiveFrom: price.effectiveFrom,
        effectiveUntil: price.effectiveUntil,
      })),
      duration: offering.duration
        ? {
            id: offering.duration.id,
            minimumMinutes: offering.duration.minimumMinutes,
            maximumMinutes: offering.duration.maximumMinutes,
            preparationMinutes: offering.duration.preparationMinutes,
            bufferMinutes: offering.duration.bufferMinutes,
          }
        : null,
    })),
  };
}

function cloneSnapshot(snapshot: CanonicalSnapshot) {
  return JSON.parse(JSON.stringify(snapshot)) as CanonicalSnapshot;
}

function candidateManifestHash(candidates: PreviewCandidate[]) {
  return businessImportManifestHash(
    candidates.map((candidate) => ({
      id: candidate.id,
      etag: candidate.etag,
      version: candidate.version,
      valueHash: candidate.valueHash,
      action: candidate.action,
      targetCategory: candidate.targetCategory,
      risk: candidate.risk,
      requiresApproval: candidate.requiresApproval,
      requiredPermission: candidate.requiredPermission,
      approvalGrantId: candidate.approvalGrantId,
      revision: candidate.revision,
      fieldProvenance: candidate.fieldProvenance,
    })),
  );
}

function previewDiagnostics(candidates: PreviewCandidate[]) {
  const diagnostics: BusinessImportDiagnosticView[] = [];
  const targets = new Set<string>();
  const externalKeys = new Set<string>();
  for (const candidate of candidates) {
    const error = (code: string, message: string, field?: string) =>
      diagnostics.push({ severity: "ERROR", code, message, ...(field ? { field } : {}) });
    if (candidate.targetCategory !== "OFFERINGS") {
      error(
        "BUSINESS_IMPORT_TARGET_UNSUPPORTED",
        "Only service offering candidates can be applied.",
      );
    }
    if (!["ACCEPTED", "EDITED", "SUBMITTED_FOR_APPROVAL"].includes(candidate.decision)) {
      error(
        "BUSINESS_IMPORT_CANDIDATE_NOT_SELECTED",
        "A selected candidate has not been accepted.",
      );
    }
    if (["CONFLICT", "INVALID", "MISSING"].includes(candidate.action)) {
      error("BUSINESS_IMPORT_CANDIDATE_NOT_APPLYABLE", "A selected candidate cannot be applied.");
    }
    if (candidate.risk === "PROHIBITED") {
      error("BUSINESS_IMPORT_RISK_PROHIBITED", "A prohibited candidate cannot be applied.");
    }
    if (candidate.requiresApproval && !candidate.approvalGrantId) {
      error("BUSINESS_IMPORT_APPROVAL_REQUIRED", "An exact approval grant is required.");
    }
    if (
      candidate.fieldProvenance.some(
        (binding) => binding.authority === "IMPORTED" && !binding.evidence,
      )
    )
      error("BUSINESS_IMPORT_EVIDENCE_REQUIRED", "Exact retained field evidence is required.");
    if (candidate.normalizedValue.locationExternalId) {
      error(
        "BUSINESS_IMPORT_LOCATION_UNSUPPORTED",
        "Location-specific services cannot be applied by this importer yet.",
        "locationExternalId",
      );
    }
    if (
      !candidate.normalizedValue.price &&
      (candidate.normalizedValue.validFrom || candidate.normalizedValue.validUntil)
    ) {
      error("BUSINESS_IMPORT_PRICE_DATES_INVALID", "Price dates require a typed price.", "price");
    }
    if (candidate.targetOfferingId && ["UPDATE", "LINK", "ARCHIVE"].includes(candidate.action)) {
      if (targets.has(candidate.targetOfferingId)) {
        error("BUSINESS_IMPORT_DUPLICATE_TARGET", "Multiple candidates target the same service.");
      }
      targets.add(candidate.targetOfferingId);
    }
    if (["ADD", "UPDATE", "LINK"].includes(candidate.action)) {
      const externalKey = normalizeBusinessExternalId(
        candidate.normalizedValue.externalId ?? candidate.semanticTargetKey,
      );
      if (externalKeys.has(externalKey)) {
        error(
          "BUSINESS_IMPORT_DUPLICATE_SOURCE_KEY",
          "Multiple candidates use the same source service key.",
          "externalId",
        );
      }
      externalKeys.add(externalKey);
    }
  }
  return diagnostics;
}

function hasBlockingDiagnostics(diagnostics: BusinessImportDiagnosticView[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "ERROR");
}

function assertInformationIfMatch(
  value: string | string[] | undefined,
  tenantId: string,
  etag: number,
) {
  const current = businessInformationEtag(tenantId, etag);
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header?.trim()) {
    throw businessImportError(
      428,
      "BUSINESS_INFORMATION_PRECONDITION_REQUIRED",
      "A Business-Information-If-Match header is required.",
    );
  }
  if (
    header
      .split(",")
      .map((item) => item.trim())
      .includes(current)
  )
    return;
  throw businessImportError(
    HttpStatus.PRECONDITION_FAILED,
    "BUSINESS_INFORMATION_REVISION_CONFLICT",
    "Business information changed after it was loaded.",
    { details: { currentEtag: current } },
  );
}

function assertOptionalInformationIfMatch(
  value: string | string[] | undefined,
  tenantId: string,
  etag: number,
) {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header?.trim()) return;
  assertInformationIfMatch(value, tenantId, etag);
}

function candidateIds(value: string[]) {
  const ids = [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort();
  if (ids.length === 0 || ids.length > MAX_CANDIDATES || ids.length !== value.length) {
    throw businessImportError(
      HttpStatus.BAD_REQUEST,
      "BUSINESS_IMPORT_CANDIDATE_SELECTION_INVALID",
      `Select between 1 and ${MAX_CANDIDATES} distinct candidates.`,
      { field: "candidateIds" },
    );
  }
  return ids;
}

function parseManifest(bytes: Uint8Array): PreviewManifest {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    const value = record(parsed);
    if (
      value.schema !== "leadvirt.business-import-application-preview.v4" ||
      typeof value.signature !== "string" ||
      typeof value.tenantId !== "string" ||
      typeof value.sourceId !== "string" ||
      typeof value.importId !== "string" ||
      typeof value.expiresAt !== "string" ||
      !Array.isArray(value.candidateIds) ||
      !Array.isArray(value.candidates)
    )
      throw new Error("invalid manifest");
    return parsed as PreviewManifest;
  } catch {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_PREVIEW_INTEGRITY_FAILED",
      "The apply preview could not be verified.",
    );
  }
}

function exactSignature(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.byteLength === 32 &&
    rightBytes.byteLength === 32 &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function fallbackIdentity(
  tenant: Prisma.TenantGetPayload<{ include: { onboardingState: true } }>,
  candidates: PreviewCandidate[],
): CanonicalIdentitySnapshot {
  const onboarding = record(tenant.onboardingState?.data);
  const company = record(onboarding.companyInfo);
  const settings = record(tenant.settings);
  const profile = record(settings.profile);
  const currency =
    candidates.find((candidate) => candidate.normalizedValue.price?.currency)?.normalizedValue.price
      ?.currency ??
    nullableText(profile.defaultCurrency, 3)?.toUpperCase() ??
    "USD";
  return {
    id: stableId("bii", tenant.id, "identity"),
    displayName: nullableText(company.name, 240) ?? tenant.name,
    legalName: null,
    businessType: nullableText(onboarding.businessType, 160) ?? tenant.businessType,
    description:
      nullableText(company.description, 4_000) ?? nullableText(profile.description, 4_000),
    defaultLocale: nullableText(profile.defaultLocale, 35)?.toLowerCase() ?? "en",
    timezone: nullableText(onboarding.timezone, 100) ?? tenant.timezone,
    defaultCurrency: currency,
    rowVersion: 1,
  };
}

function identitySnapshot(
  identity: Prisma.BusinessIdentityGetPayload<Record<string, never>>,
): CanonicalIdentitySnapshot {
  return {
    id: identity.id,
    displayName: identity.displayName,
    legalName: identity.legalName,
    businessType: identity.businessType,
    description: identity.description,
    defaultLocale: identity.defaultLocale,
    timezone: identity.timezone,
    defaultCurrency: identity.defaultCurrency,
    rowVersion: identity.rowVersion,
  };
}

function primaryPrice(row: OfferingRow) {
  return [...row.prices].sort((left, right) => {
    const created = right.createdAt.getTime() - left.createdAt.getTime();
    return created || left.id.localeCompare(right.id);
  })[0];
}

function currentOfferingValue(row: OfferingRow, sourceId: string): BusinessImportOfferingValue {
  const price = primaryPrice(row);
  const binding = row.sourceBindings.find((item) => item.sourceId === sourceId && item.active);
  return {
    externalId: binding?.externalKey ?? null,
    category: row.category,
    name: row.name,
    description: row.description,
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
    duration: row.duration
      ? {
          minimumMinutes: row.duration.minimumMinutes,
          maximumMinutes: row.duration.maximumMinutes,
        }
      : null,
    locationExternalId: null,
    bookingNotes: row.bookingNotes,
    active: row.active,
    validFrom: isoDate(price?.effectiveFrom ?? null),
    validUntil: isoDate(price?.effectiveUntil ?? null),
    language: row.locale,
  };
}

function valueHash(value: BusinessImportOfferingValue) {
  return businessOfferingValueHash({
    sourceRow: 0,
    externalId: value.externalId ?? null,
    category: value.category ?? null,
    name: value.name,
    description: value.description ?? null,
    price: value.price
      ? {
          type: value.price.type,
          amount: value.price.amount ?? null,
          from: value.price.from ?? null,
          to: value.price.to ?? null,
          currency: value.price.currency ?? null,
          unit: value.price.unit ?? null,
          taxNote: value.price.taxNote ?? null,
        }
      : null,
    duration: value.duration
      ? {
          minimumMinutes: value.duration.minimumMinutes,
          maximumMinutes: value.duration.maximumMinutes ?? null,
        }
      : null,
    locationExternalId: value.locationExternalId ?? null,
    bookingNotes: value.bookingNotes ?? null,
    active: value.active,
    validFrom: value.validFrom ?? null,
    validUntil: value.validUntil ?? null,
    language: value.language ?? null,
    evidence: {},
    diagnostics: [],
    valid: true,
  });
}

function planApplication(
  identity: CanonicalIdentitySnapshot,
  offerings: OfferingRow[],
  manifest: PreviewManifest,
  committedAt: string,
) {
  const before = canonicalSnapshot(identity, offerings);
  const after = cloneSnapshot(before);
  const rowById = new Map(offerings.map((row) => [row.id, row]));
  const snapshotById = new Map(after.offerings.map((row) => [row.id, row]));
  const mutations: OfferingMutation[] = [];
  const changedFields: FieldMutation[] = [];
  for (const candidate of manifest.candidates) {
    if (candidate.action === "UNCHANGED") continue;
    if (
      candidate.action !== "ADD" &&
      candidate.action !== "UPDATE" &&
      candidate.action !== "LINK" &&
      candidate.action !== "ARCHIVE"
    )
      applicationBlocked();
    const action = candidate.action;
    const value = candidate.normalizedValue;
    const existing = candidate.targetOfferingId ? rowById.get(candidate.targetOfferingId) : null;
    if (candidate.action === "ADD" && existing) applicationIntegrityConflict();
    if (candidate.action !== "ADD" && !existing) applicationIntegrityConflict();
    if (
      existing &&
      (!candidate.currentFingerprint ||
        valueHash(currentOfferingValue(existing, manifest.sourceId)) !==
          candidate.currentFingerprint)
    )
      applicationIntegrityConflict();
    if (candidate.action === "LINK") {
      const externalKey = normalizeBusinessExternalId(
        value.externalId ?? candidate.semanticTargetKey,
      );
      const matchingBindings = offerings.flatMap((offering) =>
        offering.sourceBindings.filter(
          (binding) =>
            binding.sourceId === manifest.sourceId &&
            normalizeBusinessExternalId(binding.externalKey) === externalKey,
        ),
      );
      if (
        matchingBindings.length > 1 ||
        matchingBindings.some((binding) => binding.offeringId !== existing!.id)
      )
        applicationIntegrityConflict();
      if (
        valueHash({ ...currentOfferingValue(existing!, manifest.sourceId), externalId: null }) !==
        valueHash({ ...value, externalId: null })
      )
        applicationIntegrityConflict();
      mutations.push({
        candidateId: candidate.id,
        offeringId: existing!.id,
        priceId: primaryPrice(existing!)?.id ?? null,
        durationId: existing!.duration?.id ?? null,
        kind: "LINK",
        expectedOfferingVersion: existing!.rowVersion,
        expectedPriceVersion: primaryPrice(existing!)?.rowVersion ?? null,
        expectedDurationVersion: existing!.duration?.rowVersion ?? null,
        value,
        fields: [],
      });
      continue;
    }
    if (existing && !value.price && primaryPrice(existing)) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_PRICE_REMOVAL_UNSUPPORTED",
        "An existing structured price cannot be removed by this import.",
      );
    }
    if (existing?.duration && !value.duration) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_DURATION_REMOVAL_UNSUPPORTED",
        "An existing structured duration cannot be removed by this import.",
      );
    }
    const offeringId = existing?.id ?? stableId("bio", manifest.tenantId, candidate.id);
    const current = snapshotById.get(offeringId);
    const previousPrice = existing ? primaryPrice(existing) : undefined;
    const priceId = value.price
      ? (previousPrice?.id ?? stableId("bip", manifest.tenantId, candidate.id))
      : null;
    const durationId = value.duration
      ? (existing?.duration?.id ?? stableId("bid", manifest.tenantId, candidate.id))
      : null;
    const fields: FieldMutation[] = [];
    const addField = (
      resourceType: FieldMutation["resourceType"],
      resourceKey: string,
      fieldPath: string,
      fieldValue: unknown,
    ) => fields.push({ resourceType, resourceKey, fieldPath, value: fieldValue });
    const archivedAt = candidate.action === "ARCHIVE" ? committedAt : null;
    const offering: CanonicalOfferingSnapshot = current ?? {
      id: offeringId,
      kind: "SERVICE",
      category: null,
      parentCategory: null,
      name: value.name,
      description: null,
      locale: identity.defaultLocale,
      bookingNotes: null,
      active: true,
      archivedAt: null,
      rowVersion: 1,
      prices: [],
      duration: null,
    };
    if (candidate.action === "ARCHIVE") {
      offering.active = false;
      offering.archivedAt = archivedAt;
      offering.rowVersion += 1;
      addField("OFFERING", offeringId, "/active", false);
      addField("OFFERING", offeringId, "/archivedAt", archivedAt);
    } else {
      offering.kind = "SERVICE";
      offering.category = value.category ?? null;
      offering.name = value.name;
      offering.description = value.description ?? null;
      offering.locale = value.language ?? identity.defaultLocale;
      offering.bookingNotes = value.bookingNotes ?? null;
      offering.active = value.active;
      offering.archivedAt = null;
      if (current) offering.rowVersion += 1;
      for (const [fieldPath, fieldValue] of [
        ["/kind", offering.kind],
        ["/category", offering.category],
        ["/name", offering.name],
        ["/description", offering.description],
        ["/locale", offering.locale],
        ["/bookingNotes", offering.bookingNotes],
        ["/active", offering.active],
        ["/archivedAt", offering.archivedAt],
      ] as const)
        addField("OFFERING", offeringId, fieldPath, fieldValue);
      if (value.price && priceId) {
        const price = offering.prices.find((item) => item.id === priceId) ?? {
          id: priceId,
          type: value.price.type,
          amount: null,
          amountFrom: null,
          amountTo: null,
          currency: value.price.currency ?? identity.defaultCurrency,
          unit: null,
          taxNote: null,
          effectiveFrom: null,
          effectiveUntil: null,
          rowVersion: 1,
        };
        const existed = offering.prices.some((item) => item.id === priceId);
        price.type = value.price.type;
        price.amount = canonicalDecimal(value.price.amount);
        price.amountFrom = canonicalDecimal(value.price.from);
        price.amountTo = canonicalDecimal(value.price.to);
        price.currency = value.price.currency ?? identity.defaultCurrency;
        price.unit = value.price.unit ?? null;
        price.taxNote = value.price.taxNote ?? null;
        price.effectiveFrom = value.validFrom ?? null;
        price.effectiveUntil = value.validUntil ?? null;
        if (existed) price.rowVersion += 1;
        else offering.prices.push(price);
        for (const [fieldPath, fieldValue] of [
          ["/type", price.type],
          ["/amount", price.amount],
          ["/amountFrom", price.amountFrom],
          ["/amountTo", price.amountTo],
          ["/currency", price.currency],
          ["/unit", price.unit],
          ["/taxNote", price.taxNote],
          ["/effectiveFrom", price.effectiveFrom],
          ["/effectiveUntil", price.effectiveUntil],
        ] as const)
          addField("OFFERING_PRICE", priceId, fieldPath, fieldValue);
      }
      if (value.duration && durationId) {
        const duration = offering.duration ?? {
          id: durationId,
          minimumMinutes: value.duration.minimumMinutes,
          maximumMinutes: value.duration.maximumMinutes ?? null,
          preparationMinutes: null,
          bufferMinutes: null,
          rowVersion: 1,
        };
        const existed = offering.duration !== null;
        duration.minimumMinutes = value.duration.minimumMinutes;
        duration.maximumMinutes = value.duration.maximumMinutes ?? null;
        if (existed) duration.rowVersion += 1;
        offering.duration = duration;
        addField("OFFERING_DURATION", durationId, "/minimumMinutes", duration.minimumMinutes);
        addField("OFFERING_DURATION", durationId, "/maximumMinutes", duration.maximumMinutes);
      }
    }
    if (!current) {
      after.offerings.push(offering);
      snapshotById.set(offering.id, offering);
    }
    offering.prices.sort((left, right) => left.id.localeCompare(right.id));
    mutations.push({
      candidateId: candidate.id,
      offeringId,
      priceId,
      durationId,
      kind: action,
      expectedOfferingVersion: existing?.rowVersion ?? null,
      expectedPriceVersion: previousPrice?.rowVersion ?? null,
      expectedDurationVersion: existing?.duration?.rowVersion ?? null,
      value,
      fields,
    });
    changedFields.push(...fields);
  }
  after.offerings.sort((left, right) => left.id.localeCompare(right.id));
  return {
    before,
    after,
    beforeRowsHash: canonicalKnowledgeV2Hash(before),
    resultingHash: canonicalKnowledgeV2Hash(canonicalContent(after)),
    mutations,
    changedFields,
    counts: {
      additions: manifest.counts.additions,
      updates:
        manifest.counts.updates +
        manifest.candidates.filter((item) => item.action === "ARCHIVE").length,
      linked: manifest.counts.linked,
      unchanged: manifest.counts.unchanged,
    },
  } satisfies ApplicationPlan;
}

function applicationBlocked(): never {
  throw businessImportError(
    HttpStatus.CONFLICT,
    "BUSINESS_IMPORT_APPLICATION_BLOCKED",
    "The selected candidates contain blocking diagnostics.",
  );
}

function applicationIntegrityConflict(): never {
  throw businessImportError(
    HttpStatus.CONFLICT,
    "BUSINESS_IMPORT_INTEGRITY_CONFLICT",
    "Canonical business information changed without a matching revision.",
    { retryable: true },
  );
}

@Injectable()
export class BusinessImportApplicationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
    @Inject(BusinessInformationStateService)
    private readonly informationState: BusinessInformationStateService,
  ) {}

  async preview(
    context: RequestContext,
    importId: string,
    input: BusinessImportApplyPreviewRequest,
    importIfMatch: string | string[] | undefined,
    informationIfMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportApplyPreviewView> {
    this.assertEditor(context);
    const ids = candidateIds(input.candidateIds);
    let preparedObject: PendingBusinessImportObject | null = null;
    let committed = false;
    try {
      const outcome = await this.idempotency.executePrepared<
        BusinessImportApplyPreviewView,
        PreparedPreview
      >(
        {
          tenantId: context.tenantId,
          endpoint: `POST:/business-profile/imports/${importId}/applications/preview`,
          key: idempotencyKey,
          request: { importId, candidateIds: ids, importIfMatch, informationIfMatch },
          retentionMs: PREVIEW_IDEMPOTENCY_RETENTION_MS,
        },
        async () => {
          const prepared = await this.preparePreview(
            context,
            importId,
            ids,
            importIfMatch,
            informationIfMatch,
          );
          preparedObject = prepared.reservation;
          return prepared;
        },
        async (tx, prepared) => {
          await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
          const state = await this.informationState.ensureInTransaction(tx, context);
          const importRecord = await this.lockImportAndCandidates(tx, context, importId, ids);
          assertBusinessImportIfMatch(
            importIfMatch,
            businessImportEtag(importRecord.id, importRecord.etag),
          );
          assertOptionalInformationIfMatch(informationIfMatch, context.tenantId, state.etag);
          await this.assertManifestExact(tx, prepared.manifest, importRecord, state, true);
          await adoptPendingBusinessImportObject(
            tx,
            prepared.reservation,
            PREVIEW_RETENTION_CLASS,
            new Date(prepared.manifest.expiresAt),
          );
          return {
            httpStatus: HttpStatus.OK,
            responseBody: prepared.view,
            responseRef: prepared.objectKey,
          };
        },
      );
      committed = true;
      return outcome.responseBody;
    } finally {
      if (preparedObject && !committed) {
        const runtime = this.runtimeService.runtime();
        await cleanupPendingBusinessImportObject(this.prisma, runtime.store, preparedObject).catch(
          () => undefined,
        );
      }
    }
  }

  async apply(
    context: RequestContext,
    importId: string,
    input: BusinessImportApplyRequest,
    importIfMatch: string | string[] | undefined,
    informationIfMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportApplicationView> {
    this.assertEditor(context);
    const ids = candidateIds(input.candidateIds);
    if (!/^[a-f0-9]{64}$/u.test(input.manifestHash)) this.previewIntegrityFailed();
    const idempotencyRequestHash = applicationIdempotencyRequestHash({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      importId,
      candidateIds: ids,
      previewManifestHash: input.manifestHash,
      importIfMatch,
      informationIfMatch,
    });
    let preparedObject: PendingBusinessImportObject | null = null;
    let committed = false;
    try {
      const outcome = await this.idempotency.executePrepared<
        { importId: string; applicationId: string },
        PreparedApply
      >(
        {
          tenantId: context.tenantId,
          endpoint: `POST:/business-profile/imports/${importId}/applications`,
          key: idempotencyKey,
          request: { idempotencyRequestHash },
          transactionTimeoutMs: 120_000,
        },
        async () => {
          const prepared = await this.prepareApply(
            context,
            importId,
            ids,
            input.manifestHash,
            importIfMatch,
            informationIfMatch,
            idempotencyKey,
            idempotencyRequestHash,
          );
          if (prepared.kind === "mutation") preparedObject = prepared.revisionReservation;
          return prepared;
        },
        async (tx, prepared) => {
          if (prepared.kind === "replay") {
            await this.assertDatabaseEditor(tx, context);
            return {
              httpStatus: HttpStatus.OK,
              responseBody: { importId, applicationId: prepared.applicationId },
              responseRef: prepared.applicationId,
            };
          }
          return this.commitApply(
            tx,
            context,
            importId,
            ids,
            importIfMatch,
            informationIfMatch,
            prepared,
          );
        },
      );
      committed = true;
      return this.getApplication(
        context,
        outcome.responseBody.importId,
        outcome.responseBody.applicationId,
      );
    } finally {
      if (preparedObject && !committed) {
        const runtime = this.runtimeService.runtime();
        await cleanupPendingBusinessImportObject(this.prisma, runtime.store, preparedObject).catch(
          () => undefined,
        );
      }
    }
  }

  async listApplications(
    context: RequestContext,
    importId: string,
  ): Promise<BusinessImportApplicationView[]> {
    await this.assertReadableImport(context, importId);
    const rows = await this.prisma.businessImportApplication.findMany({
      where: { tenantId: context.tenantId, importId },
      include: { projectionReceipt: true, projectionOutbox: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map(applicationView);
  }

  async getApplication(
    context: RequestContext,
    importId: string,
    applicationId: string,
  ): Promise<BusinessImportApplicationView> {
    await this.assertReadableImport(context, importId);
    const row = await this.prisma.businessImportApplication.findFirst({
      where: { id: applicationId, importId, tenantId: context.tenantId },
      include: { projectionReceipt: true, projectionOutbox: true },
    });
    if (!row) this.notFound();
    return applicationView(row);
  }

  private async preparePreview(
    context: RequestContext,
    importId: string,
    ids: string[],
    importIfMatch: string | string[] | undefined,
    informationIfMatch: string | string[] | undefined,
  ): Promise<PreparedPreview> {
    const runtime = this.runtimeService.runtime();
    const [importRecord, state] = await Promise.all([
      this.prisma.businessImport.findFirst({
        where: { id: importId, tenantId: context.tenantId },
      }),
      this.informationState.get(context),
    ]);
    if (!importRecord) this.notFound();
    this.assertReviewState(importRecord.state);
    assertBusinessImportIfMatch(importIfMatch, businessImportEtag(importId, importRecord.etag));
    assertOptionalInformationIfMatch(informationIfMatch, context.tenantId, state.etag);
    this.assertParsedImport(importRecord);
    const rows = await this.prisma.businessImportCandidate.findMany({
      where: { tenantId: context.tenantId, importId, id: { in: ids } },
      orderBy: { id: "asc" },
    });
    if (rows.length !== ids.length) this.notFound();
    const revisions = await this.prisma.businessImportCandidateRevision.findMany({
      where: { tenantId: context.tenantId, importId, candidateId: { in: ids } },
    });
    const grants = await this.prisma.businessImportApprovalGrant.findMany({
      where: { tenantId: context.tenantId, importId, candidateId: { in: ids } },
      include: { approval: true },
      orderBy: [{ grantedAt: "desc" }, { id: "desc" }],
    });
    const evidence = await this.prisma.businessImportCandidateEvidence.findMany({
      where: { tenantId: context.tenantId, importId, candidateId: { in: ids } },
      include: { excerptObjectLedger: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const now = new Date();
    const verifiedEvidenceObjects = new Map<string, Promise<void>>();
    const candidates = await Promise.all(
      rows.map(async (row): Promise<PreviewCandidate> => {
        const revision = revisions.find(
          (item) =>
            item.candidateId === row.id &&
            item.version === row.version &&
            item.normalizedValueHash === row.normalizedValueHash,
        );
        if (!revision) applicationIntegrityConflict();
        const exactGrant = grants.find(
          (item) =>
            item.candidateId === row.id &&
            item.candidateVersion === row.version &&
            item.candidateValueHash === row.normalizedValueHash &&
            item.requiredPermission === row.requiredPermission &&
            item.approval.state === "APPROVED" &&
            item.approval.invalidatedAt === null &&
            item.approval.decidedByUserId === item.grantedByUserId &&
            item.approval.decidedAt?.getTime() === item.grantedAt.getTime(),
        );
        let persistedBindings: ReturnType<typeof sortedBusinessImportFieldProvenance>;
        try {
          persistedBindings = sortedBusinessImportFieldProvenance(revision.fieldProvenance);
        } catch {
          applicationIntegrityConflict();
        }
        const fieldProvenance = await Promise.all(
          persistedBindings.map(async (binding) => {
            if (binding.authority !== "IMPORTED") {
              return { path: binding.path, authority: binding.authority, evidence: null };
            }
            const exactEvidence = evidence.find(
              (item) =>
                item.id === binding.evidenceId &&
                item.candidateId === row.id &&
                item.candidateVersion === row.version &&
                item.candidateValueHash === row.normalizedValueHash &&
                item.parsedRevisionId === revision.parsedRevisionId &&
                item.importGeneration === revision.importGeneration &&
                item.artifactId === revision.artifactId &&
                item.artifactSha256 === revision.artifactSha256 &&
                item.parsedManifestHash === revision.parsedManifestHash,
            );
            if (!exactEvidence) this.evidenceIntegrityFailed();
            if (
              exactEvidence.excerptObjectKind !== "EVIDENCE_EXCERPT" ||
              exactEvidence.excerptObjectLedger.deletionState !== "RETAINED" ||
              (exactEvidence.excerptObjectLedger.retainUntil &&
                exactEvidence.excerptObjectLedger.retainUntil <= now)
            )
              this.evidenceUnavailable();
            if (
              businessImportEvidenceRecordHash(exactEvidence) !== exactEvidence.evidenceRecordHash
            )
              this.evidenceIntegrityFailed();
            let objectVerification = verifiedEvidenceObjects.get(exactEvidence.id);
            if (!objectVerification) {
              objectVerification = this.verifyEvidenceObject(runtime.store, {
                objectKey: exactEvidence.excerptObjectKey,
                encryptionKeyRef: exactEvidence.excerptEncryptionKeyRef,
                sourceValueHash: exactEvidence.sourceValueHash,
                excerptHash: exactEvidence.excerptHash,
              });
              verifiedEvidenceObjects.set(exactEvidence.id, objectVerification);
            }
            await objectVerification;
            return {
              path: binding.path,
              authority: binding.authority,
              evidence: {
                id: exactEvidence.id,
                evidenceRecordHash: exactEvidence.evidenceRecordHash,
                sourceValueHash: exactEvidence.sourceValueHash,
                excerptHash: exactEvidence.excerptHash,
                artifactId: exactEvidence.artifactId,
                artifactSha256: exactEvidence.artifactSha256,
                importGeneration: exactEvidence.importGeneration,
                parsedRevisionId: exactEvidence.parsedRevisionId,
                parsedManifestHash: exactEvidence.parsedManifestHash,
                parserVersion: exactEvidence.parserVersion,
                ocrVersion: exactEvidence.ocrVersion,
                extractionContractVersion: exactEvidence.extractionContractVersion,
                objectLedgerId: exactEvidence.excerptObjectLedgerId,
                objectKind: exactEvidence.excerptObjectKind,
                objectKey: exactEvidence.excerptObjectKey,
                encryptionKeyRef: exactEvidence.excerptEncryptionKeyRef,
              },
            };
          }),
        );
        const normalizedValue = offeringValue(row.normalizedValue);
        if (valueHash(normalizedValue) !== row.normalizedValueHash) applicationIntegrityConflict();
        return {
          id: row.id,
          etag: row.etag,
          version: row.version,
          valueHash: row.normalizedValueHash,
          candidateKey: row.candidateKey,
          semanticTargetKey: row.semanticTargetKey,
          targetCategory: row.targetCategory,
          action: row.action,
          decision: row.decision,
          normalizedValue,
          targetOfferingId: row.targetOfferingId,
          currentFingerprint: row.currentFingerprint,
          risk: row.risk,
          confidence: row.confidence,
          requiresApproval: row.requiresApproval,
          requiredPermission: row.requiredPermission,
          approvalGrantId: row.requiresApproval ? (exactGrant?.id ?? null) : null,
          approvalGrantedByUserId: row.requiresApproval
            ? (exactGrant?.grantedByUserId ?? null)
            : null,
          approvalGrantedAt: row.requiresApproval
            ? (exactGrant?.grantedAt.toISOString() ?? null)
            : null,
          revision: {
            id: revision.id,
            parsedRevisionId: revision.parsedRevisionId,
            importGeneration: revision.importGeneration,
            artifactId: revision.artifactId,
            artifactSha256: revision.artifactSha256,
            parsedManifestHash: revision.parsedManifestHash,
            mappingId: revision.mappingId,
          },
          fieldProvenance,
        };
      }),
    );
    const diagnostics = previewDiagnostics(candidates);
    if (
      importRecord.baseInformationRevision !== state.revision ||
      importRecord.baseInformationHash !== state.canonicalHash ||
      importRecord.baseBusinessRevisionId !== state.currentRevisionId
    ) {
      diagnostics.push({
        severity: "ERROR",
        code: "BUSINESS_IMPORT_REBASE_REQUIRED",
        message: "Business information changed after this import was prepared.",
      });
    }
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PREVIEW_TTL_MS);
    const counts = {
      additions: candidates.filter((item) => item.action === "ADD").length,
      updates: candidates.filter((item) => ["UPDATE", "ARCHIVE"].includes(item.action)).length,
      linked: candidates.filter((item) => item.action === "LINK").length,
      unchanged: candidates.filter((item) => item.action === "UNCHANGED").length,
      conflicts: candidates.filter((item) =>
        ["CONFLICT", "INVALID", "MISSING"].includes(item.action),
      ).length,
    };
    const unsigned: PreviewManifestUnsigned = {
      schema: "leadvirt.business-import-application-preview.v4",
      tenantId: context.tenantId,
      sourceId: importRecord.sourceId,
      importId,
      importGeneration: importRecord.generation,
      importEtag: importRecord.etag,
      parsedRevisionId: importRecord.parsedRevisionId!,
      artifactId: importRecord.artifactId!,
      artifactSha256: importRecord.artifactSha256!,
      parsedManifestHash: importRecord.parsedManifestHash!,
      parserVersion: importRecord.parserVersion!,
      ocrVersion: importRecord.ocrVersion,
      mapperVersion: importRecord.mapperVersion!,
      schemaVersion: importRecord.schemaVersion,
      modelVersion: importRecord.modelVersion,
      promptVersion: importRecord.promptVersion,
      baseBusinessRevisionId: state.currentRevisionId,
      baseInformationRevision: state.revision,
      baseInformationHash: state.canonicalHash,
      businessInformationEtag: state.etag,
      candidateIds: ids,
      candidates,
      candidateManifestHash: candidateManifestHash(candidates),
      counts,
      diagnostics,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const manifest: PreviewManifest = {
      ...unsigned,
      signature: this.runtimeService.previewSignature(unsigned),
    };
    const manifestHash = businessImportManifestHash(manifest);
    const objectKey = this.previewObjectKey(
      context.tenantId,
      importRecord.sourceId,
      importId,
      manifestHash,
    );
    const reservation = await reservePendingBusinessImportObject(this.prisma, {
      tenantId: context.tenantId,
      objectKind: "APPLICATION_PREVIEW",
      objectStorageKey: objectKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `APPLICATION_PREVIEW:${importId}:${manifestHash}`,
      retainUntil: expiresAt,
    });
    const write = await putPendingBusinessImportObject(
      this.prisma,
      runtime.store,
      reservation,
      new TextEncoder().encode(JSON.stringify(manifest)),
    );
    return {
      manifest,
      manifestHash,
      objectKey,
      encryptionKeyRef: write.encryptionKeyRef,
      reservation,
      view: {
        importId,
        candidateIds: ids,
        candidateVersions: Object.fromEntries(candidates.map((item) => [item.id, item.version])),
        manifestHash,
        businessInformationEtag: businessInformationEtag(context.tenantId, state.etag),
        expiresAt: expiresAt.toISOString(),
        counts,
        diagnostics,
      },
    };
  }

  private async prepareApply(
    context: RequestContext,
    importId: string,
    ids: string[],
    manifestHash: string,
    importIfMatch: string | string[] | undefined,
    informationIfMatch: string | string[] | undefined,
    idempotencyKey: string,
    idempotencyRequestHash: string,
  ): Promise<PreparedApply> {
    const idempotencyKeyHash = hashKey(idempotencyKey.trim());
    const existing = await this.prisma.businessImportApplication.findUnique({
      where: {
        tenantId_idempotencyKeyHash: {
          tenantId: context.tenantId,
          idempotencyKeyHash,
        },
      },
    });
    if (existing) {
      if (
        existing.importId === importId &&
        existing.previewManifestHash === manifestHash &&
        existing.idempotencyRequestHash === idempotencyRequestHash
      ) {
        return { kind: "replay", applicationId: existing.id };
      }
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for another application.",
      );
    }
    const runtime = this.runtimeService.runtime();
    const [importRecord, state] = await Promise.all([
      this.prisma.businessImport.findFirst({
        where: { id: importId, tenantId: context.tenantId },
      }),
      this.informationState.get(context),
    ]);
    if (!importRecord) this.notFound();
    this.assertReviewState(importRecord.state);
    assertBusinessImportIfMatch(importIfMatch, businessImportEtag(importId, importRecord.etag));
    assertInformationIfMatch(informationIfMatch, context.tenantId, state.etag);
    const objectKey = this.previewObjectKey(
      context.tenantId,
      importRecord.sourceId,
      importId,
      manifestHash,
    );
    const ledger = await this.prisma.businessImportObjectLedger.findUnique({
      where: {
        tenantId_objectStorageKey: { tenantId: context.tenantId, objectStorageKey: objectKey },
      },
    });
    if (
      !ledger ||
      ledger.objectKind !== "APPLICATION_PREVIEW" ||
      ledger.deletionState !== "RETAINED" ||
      (ledger.retainUntil && ledger.retainUntil.getTime() <= Date.now())
    )
      this.previewExpired();
    let bytes: Uint8Array;
    try {
      bytes = await runtime.store.get(ledger.objectStorageKey, ledger.encryptionKeyRef);
    } catch {
      this.previewIntegrityFailed();
    }
    const manifest = parseManifest(bytes!);
    const { signature, ...unsigned } = manifest;
    if (
      businessImportManifestHash(manifest) !== manifestHash ||
      !exactSignature(signature, this.runtimeService.previewSignature(unsigned)) ||
      manifest.tenantId !== context.tenantId ||
      manifest.sourceId !== importRecord.sourceId ||
      manifest.importId !== importId ||
      manifest.expiresAt !== ledger.retainUntil?.toISOString() ||
      Date.parse(manifest.expiresAt) <= Date.now() ||
      JSON.stringify(manifest.candidateIds) !== JSON.stringify(ids) ||
      candidateManifestHash(manifest.candidates) !== manifest.candidateManifestHash
    )
      this.previewIntegrityFailed();
    await this.verifyManifestEvidenceObjects(runtime.store, manifest);
    if (hasBlockingDiagnostics(manifest.diagnostics)) applicationBlocked();
    if (
      !manifest.candidates.some((item) =>
        ["ADD", "UPDATE", "LINK", "ARCHIVE"].includes(item.action),
      )
    ) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_NO_CHANGES",
        "The selected candidates do not change business information.",
      );
    }
    const [tenant, storedIdentity, offerings] = await Promise.all([
      this.prisma.tenant.findFirst({
        where: { id: context.tenantId, deletedAt: null },
        include: { onboardingState: true },
      }),
      this.prisma.businessIdentity.findUnique({ where: { tenantId: context.tenantId } }),
      this.prisma.businessOffering.findMany({
        where: { tenantId: context.tenantId },
        include: { prices: true, duration: true, sourceBindings: true },
        orderBy: { id: "asc" },
      }),
    ]);
    if (!tenant) this.notFound();
    const identity = storedIdentity
      ? identitySnapshot(storedIdentity)
      : fallbackIdentity(tenant, manifest.candidates);
    const committedAt = new Date().toISOString();
    const plan = planApplication(identity, offerings, manifest, committedAt);
    if (plan.beforeRowsHash !== canonicalKnowledgeV2Hash(plan.before))
      applicationIntegrityConflict();
    if (
      state.revision > 0 &&
      canonicalKnowledgeV2Hash(canonicalContent(plan.before)) !== state.canonicalHash
    )
      applicationIntegrityConflict();
    const applicationId = randomUUID();
    const revisionId = randomUUID();
    const delta = {
      schema: "leadvirt.business-information-revision-delta.v1",
      tenantId: context.tenantId,
      revision: state.revision + 1,
      parentRevisionId: state.currentRevisionId,
      parentRevision: state.revision,
      origin: "IMPORT",
      actorUserId: context.userId,
      applicationId,
      importId,
      importGeneration: manifest.importGeneration,
      previewManifestHash: manifestHash,
      candidateManifestHash: manifest.candidateManifestHash,
      before: plan.before,
      after: plan.after,
      changedFields: plan.changedFields.map(({ resourceType, resourceKey, fieldPath }) => ({
        resourceType,
        resourceKey,
        fieldPath,
      })),
      committedAt,
    };
    const revisionDeltaHash = canonicalKnowledgeV2Hash(delta);
    const revisionObjectKey = createDeterministicKnowledgeObjectKey({
      tenantId: context.tenantId,
      sourceId: "business-information-revisions",
      purpose: "extracted",
      identity: `${revisionId}:${revisionDeltaHash}`,
    });
    const revisionReservation = await reservePendingBusinessImportObject(this.prisma, {
      tenantId: context.tenantId,
      objectKind: "REVISION_DELTA",
      objectStorageKey: revisionObjectKey,
      encryptionKeyRef: runtime.objectEncryptionKeyId,
      pendingScope: `REVISION_DELTA:${importId}:${revisionId}`,
      retainUntil: new Date(Date.now() + REVISION_PENDING_TTL_MS),
    });
    const write = await putPendingBusinessImportObject(
      this.prisma,
      runtime.store,
      revisionReservation,
      new TextEncoder().encode(JSON.stringify(delta)),
    );
    return {
      kind: "mutation",
      applicationId,
      revisionId,
      revisionLedgerId: revisionReservation.ledgerId,
      revisionObjectKey,
      revisionEncryptionKeyRef: write.encryptionKeyRef,
      revisionReservation,
      revisionDeltaHash,
      previewLedgerId: ledger.id,
      manifest,
      manifestHash,
      idempotencyKeyHash,
      idempotencyRequestHash,
      committedAt,
      plan,
      planHash: businessImportManifestHash({
        beforeRowsHash: plan.beforeRowsHash,
        resultingHash: plan.resultingHash,
        mutations: plan.mutations,
      }),
    };
  }

  private async commitApply(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    importId: string,
    ids: string[],
    importIfMatch: string | string[] | undefined,
    informationIfMatch: string | string[] | undefined,
    prepared: PreparedApplyMutation,
  ) {
    await lockKnowledgeV2CorpusTransition(tx, context.tenantId);
    const state = await this.informationState.ensureInTransaction(tx, context);
    const importRecord = await this.lockImportAndCandidates(tx, context, importId, ids);
    assertBusinessImportIfMatch(
      importIfMatch,
      businessImportEtag(importRecord.id, importRecord.etag),
    );
    assertInformationIfMatch(informationIfMatch, context.tenantId, state.etag);
    await this.assertManifestExact(tx, prepared.manifest, importRecord, state);
    if (
      state.revision !== prepared.manifest.baseInformationRevision ||
      state.currentRevisionId !== prepared.manifest.baseBusinessRevisionId ||
      state.canonicalHash !== prepared.manifest.baseInformationHash ||
      importRecord.baseInformationRevision !== state.revision ||
      importRecord.baseBusinessRevisionId !== state.currentRevisionId ||
      importRecord.baseInformationHash !== state.canonicalHash
    )
      this.businessInformationConflict(context.tenantId, state.etag);
    const previewLedger = await tx.businessImportObjectLedger.findFirst({
      where: {
        id: prepared.previewLedgerId,
        tenantId: context.tenantId,
        objectKind: "APPLICATION_PREVIEW",
        objectStorageKey: this.previewObjectKey(
          context.tenantId,
          prepared.manifest.sourceId,
          importId,
          prepared.manifestHash,
        ),
        deletionState: "RETAINED",
      },
    });
    if (
      !previewLedger ||
      previewLedger.encryptionKeyRef.length === 0 ||
      (previewLedger.retainUntil && previewLedger.retainUntil.getTime() <= Date.now())
    )
      this.previewExpired();
    const [tenant, storedIdentity, offerings] = await Promise.all([
      tx.tenant.findFirst({
        where: { id: context.tenantId, deletedAt: null },
        include: { onboardingState: true },
      }),
      tx.businessIdentity.findUnique({ where: { tenantId: context.tenantId } }),
      tx.businessOffering.findMany({
        where: { tenantId: context.tenantId },
        include: { prices: true, duration: true, sourceBindings: true },
        orderBy: { id: "asc" },
      }),
    ]);
    if (!tenant) this.notFound();
    const identity = storedIdentity
      ? identitySnapshot(storedIdentity)
      : fallbackIdentity(tenant, prepared.manifest.candidates);
    const plan = planApplication(identity, offerings, prepared.manifest, prepared.committedAt);
    const planHash = businessImportManifestHash({
      beforeRowsHash: plan.beforeRowsHash,
      resultingHash: plan.resultingHash,
      mutations: plan.mutations,
    });
    if (planHash !== prepared.planHash || plan.beforeRowsHash !== prepared.plan.beforeRowsHash) {
      applicationIntegrityConflict();
    }
    if (
      state.revision > 0 &&
      canonicalKnowledgeV2Hash(canonicalContent(plan.before)) !== state.canonicalHash
    )
      applicationIntegrityConflict();
    if (!storedIdentity) {
      await tx.businessIdentity.create({
        data: {
          id: identity.id,
          tenantId: context.tenantId,
          displayName: identity.displayName,
          legalName: identity.legalName,
          businessType: identity.businessType,
          description: identity.description,
          defaultLocale: identity.defaultLocale,
          timezone: identity.timezone,
          defaultCurrency: identity.defaultCurrency,
          rowVersion: identity.rowVersion,
        },
      });
    }
    await this.writeOfferingMutations(
      tx,
      context,
      prepared.manifest,
      plan.mutations,
      prepared.committedAt,
      identity.defaultLocale,
      identity.defaultCurrency,
    );
    await adoptPendingBusinessImportObject(
      tx,
      prepared.revisionReservation,
      REVISION_RETENTION_CLASS,
      null,
    );
    const resultingRevision = state.revision + 1;
    await tx.businessInformationRevision.create({
      data: {
        id: prepared.revisionId,
        tenantId: context.tenantId,
        revision: resultingRevision,
        parentRevisionId: state.currentRevisionId,
        parentRevision: state.revision === 0 ? null : state.revision,
        canonicalHash: plan.resultingHash,
        origin: "IMPORT",
        deltaObjectKey: prepared.revisionObjectKey,
        deltaEncryptionKeyRef: prepared.revisionEncryptionKeyRef,
        deltaObjectLedgerId: prepared.revisionLedgerId,
        deltaHash: prepared.revisionDeltaHash,
        affectedResources: affectedResources(plan),
        createdByUserId: context.userId,
      },
    });
    const projectionOutboxDedupeKey = `business-import-project:${prepared.applicationId}:${resultingRevision}`;
    const outbox = await tx.runtimeOutbox.create({
      data: {
        tenantId: context.tenantId,
        aggregateType: "BusinessInformationRevision",
        aggregateId: prepared.revisionId,
        aggregateVersion: resultingRevision,
        generation: prepared.manifest.importGeneration,
        eventType: "business.import.project.requested",
        schemaVersion: 1,
        dedupeKey: projectionOutboxDedupeKey,
        payload: {
          queueName: "business.import",
          jobName: "project",
          jobId: projectionOutboxDedupeKey,
          data: {
            tenantId: context.tenantId,
            sourceId: prepared.manifest.sourceId,
            importId,
            applicationId: prepared.applicationId,
            businessRevisionId: prepared.revisionId,
            businessRevision: resultingRevision,
            generation: prepared.manifest.importGeneration,
            requestedByUserId: context.userId,
            requestedAt: prepared.committedAt,
          },
          attempts: 10,
          backoffMs: 2_000,
        },
        traceId: context.sessionId ?? null,
      },
    });
    await tx.businessImportApplication.create({
      data: {
        id: prepared.applicationId,
        tenantId: context.tenantId,
        sourceId: prepared.manifest.sourceId,
        importId,
        kind: "APPLY",
        state: "COMMITTED",
        previewManifestHash: prepared.manifestHash,
        previewObjectLedgerId: previewLedger.id,
        previewObjectKind: "APPLICATION_PREVIEW",
        previewObjectKey: previewLedger.objectStorageKey,
        previewEncryptionKeyRef: previewLedger.encryptionKeyRef,
        candidateManifestHash: prepared.manifest.candidateManifestHash,
        idempotencyKeyHash: prepared.idempotencyKeyHash,
        idempotencyRequestHash: prepared.idempotencyRequestHash,
        baseInformationRevision: state.revision,
        baseInformationHash: state.canonicalHash,
        baseBusinessRevisionId: state.currentRevisionId,
        resultingInformationRevision: resultingRevision,
        resultingInformationHash: plan.resultingHash,
        businessRevisionId: prepared.revisionId,
        affectedResourceVersions: affectedResources(plan),
        projectionOutboxDedupeKey,
        projectionOutboxId: outbox.id,
        createdByUserId: context.userId,
        committedAt: new Date(prepared.committedAt),
      },
    });
    const appliedCandidates = prepared.manifest.candidates.filter((candidate) =>
      ["ADD", "UPDATE", "LINK", "ARCHIVE"].includes(candidate.action),
    );
    for (const candidate of appliedCandidates) {
      await tx.businessImportApplicationCandidate.create({
        data: {
          tenantId: context.tenantId,
          sourceId: prepared.manifest.sourceId,
          importId,
          applicationId: prepared.applicationId,
          candidateId: candidate.id,
          candidateVersion: candidate.version,
          candidateValueHash: candidate.valueHash,
          action: candidate.action as "ADD" | "UPDATE" | "LINK" | "ARCHIVE",
          targetCategory: candidate.targetCategory,
          risk: candidate.risk,
          requiresApproval: candidate.requiresApproval,
          requiredPermission: candidate.requiredPermission,
          approvalGrantId: candidate.approvalGrantId,
          appliedAt: new Date(prepared.committedAt),
        },
      });
    }
    await this.writeAttributions(tx, context, prepared, plan, resultingRevision);
    const stateUpdate = await tx.businessInformationState.updateMany({
      where: {
        tenantId: context.tenantId,
        revision: state.revision,
        currentRevisionId: state.currentRevisionId,
        canonicalHash: state.canonicalHash,
        etag: state.etag,
      },
      data: {
        revision: resultingRevision,
        currentRevisionId: prepared.revisionId,
        canonicalHash: plan.resultingHash,
        etag: { increment: 1 },
        updatedByUserId: context.userId,
      },
    });
    if (stateUpdate.count !== 1) this.businessInformationConflict(context.tenantId, state.etag);
    for (const candidate of prepared.manifest.candidates) {
      const updated = await tx.businessImportCandidate.updateMany({
        where: {
          id: candidate.id,
          tenantId: context.tenantId,
          importId,
          version: candidate.version,
          normalizedValueHash: candidate.valueHash,
          etag: candidate.etag,
        },
        data: {
          decision: "APPLIED",
          appliedAt: new Date(prepared.committedAt),
          etag: { increment: 1 },
        },
      });
      if (updated.count !== 1) this.revisionConflict();
    }
    const importUpdate = await tx.businessImport.updateMany({
      where: {
        id: importId,
        tenantId: context.tenantId,
        generation: prepared.manifest.importGeneration,
        etag: prepared.manifest.importEtag,
      },
      data: {
        state: "PROJECTING",
        applyStartedAt: new Date(prepared.committedAt),
        reviewCompletedAt: new Date(prepared.committedAt),
        etag: { increment: 1 },
      },
    });
    if (importUpdate.count !== 1) this.revisionConflict();
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "business_import.application_committed",
        entityType: "business_import_application",
        entityId: prepared.applicationId,
        payload: {
          importId,
          generation: prepared.manifest.importGeneration,
          candidateCount: prepared.manifest.candidates.length,
          businessInformationRevision: resultingRevision,
          projectionOutboxDedupeKey,
        },
      },
    });
    return {
      httpStatus: HttpStatus.ACCEPTED,
      responseBody: { importId, applicationId: prepared.applicationId },
      responseRef: prepared.applicationId,
    };
  }

  private async assertManifestExact(
    tx: Prisma.TransactionClient,
    manifest: PreviewManifest,
    importRecord: Prisma.BusinessImportGetPayload<Record<string, never>>,
    state: Prisma.BusinessInformationStateGetPayload<Record<string, never>>,
    allowBlocking = false,
  ) {
    if (
      manifest.tenantId !== importRecord.tenantId ||
      manifest.sourceId !== importRecord.sourceId ||
      manifest.importId !== importRecord.id ||
      manifest.importGeneration !== importRecord.generation ||
      manifest.importEtag !== importRecord.etag ||
      manifest.parsedRevisionId !== importRecord.parsedRevisionId ||
      manifest.artifactId !== importRecord.artifactId ||
      manifest.artifactSha256 !== importRecord.artifactSha256 ||
      manifest.parsedManifestHash !== importRecord.parsedManifestHash ||
      manifest.parserVersion !== importRecord.parserVersion ||
      manifest.ocrVersion !== importRecord.ocrVersion ||
      manifest.mapperVersion !== importRecord.mapperVersion ||
      manifest.schemaVersion !== importRecord.schemaVersion ||
      manifest.modelVersion !== importRecord.modelVersion ||
      manifest.promptVersion !== importRecord.promptVersion ||
      manifest.baseBusinessRevisionId !== state.currentRevisionId ||
      manifest.baseInformationRevision !== state.revision ||
      manifest.baseInformationHash !== state.canonicalHash ||
      manifest.businessInformationEtag !== state.etag ||
      candidateManifestHash(manifest.candidates) !== manifest.candidateManifestHash
    )
      this.revisionConflict();
    const parsed = await tx.businessImportParsedRevision.findFirst({
      where: {
        id: manifest.parsedRevisionId,
        tenantId: manifest.tenantId,
        sourceId: manifest.sourceId,
        importId: manifest.importId,
        importGeneration: manifest.importGeneration,
        artifactId: manifest.artifactId,
        artifactSha256: manifest.artifactSha256,
        manifestHash: manifest.parsedManifestHash,
      },
    });
    if (!parsed) this.revisionConflict();
    const rows = await tx.businessImportCandidate.findMany({
      where: {
        tenantId: manifest.tenantId,
        importId: manifest.importId,
        id: { in: manifest.candidateIds },
      },
    });
    if (rows.length !== manifest.candidates.length) this.revisionConflict();
    const revisions = await tx.businessImportCandidateRevision.findMany({
      where: {
        tenantId: manifest.tenantId,
        importId: manifest.importId,
        candidateId: { in: manifest.candidateIds },
      },
    });
    const grantIds = manifest.candidates.flatMap((candidate) =>
      candidate.approvalGrantId ? [candidate.approvalGrantId] : [],
    );
    const evidenceIds = [
      ...new Set(
        manifest.candidates.flatMap((candidate) =>
          candidate.fieldProvenance.flatMap((binding) =>
            binding.authority === "IMPORTED" && binding.evidence ? [binding.evidence.id] : [],
          ),
        ),
      ),
    ];
    const grants = grantIds.length
      ? await tx.businessImportApprovalGrant.findMany({
          where: { tenantId: manifest.tenantId, id: { in: grantIds } },
          include: { approval: true },
        })
      : [];
    const evidence = evidenceIds.length
      ? await tx.businessImportCandidateEvidence.findMany({
          where: { tenantId: manifest.tenantId, id: { in: evidenceIds } },
          include: { excerptObjectLedger: true },
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const candidate of manifest.candidates) {
      const row = byId.get(candidate.id);
      if (
        !row ||
        row.etag !== candidate.etag ||
        row.version !== candidate.version ||
        row.normalizedValueHash !== candidate.valueHash ||
        row.candidateKey !== candidate.candidateKey ||
        row.semanticTargetKey !== candidate.semanticTargetKey ||
        row.targetCategory !== candidate.targetCategory ||
        row.action !== candidate.action ||
        row.decision !== candidate.decision ||
        row.targetOfferingId !== candidate.targetOfferingId ||
        row.currentFingerprint !== candidate.currentFingerprint ||
        row.risk !== candidate.risk ||
        row.confidence !== candidate.confidence ||
        row.requiresApproval !== candidate.requiresApproval ||
        row.requiredPermission !== candidate.requiredPermission ||
        valueHash(offeringValue(row.normalizedValue)) !== candidate.valueHash ||
        valueHash(candidate.normalizedValue) !== candidate.valueHash
      )
        this.revisionConflict();
      const revision = revisions.find(
        (item) =>
          item.id === candidate.revision.id &&
          item.candidateId === candidate.id &&
          item.version === candidate.version &&
          item.normalizedValueHash === candidate.valueHash &&
          item.parsedRevisionId === candidate.revision.parsedRevisionId &&
          item.importGeneration === candidate.revision.importGeneration &&
          item.artifactId === candidate.revision.artifactId &&
          item.artifactSha256 === candidate.revision.artifactSha256 &&
          item.parsedManifestHash === candidate.revision.parsedManifestHash &&
          item.mappingId === candidate.revision.mappingId &&
          item.action === candidate.action &&
          item.targetCategory === candidate.targetCategory &&
          item.risk === candidate.risk &&
          item.requiresApproval === candidate.requiresApproval &&
          item.requiredPermission === candidate.requiredPermission,
      );
      if (!revision) this.revisionConflict();
      let persistedBindings: ReturnType<typeof sortedBusinessImportFieldProvenance>;
      try {
        persistedBindings = sortedBusinessImportFieldProvenance(revision.fieldProvenance);
      } catch {
        this.revisionConflict();
      }
      if (
        JSON.stringify(
          persistedBindings.map((binding) => ({
            path: binding.path,
            authority: binding.authority,
            evidenceId: binding.authority === "IMPORTED" ? binding.evidenceId : null,
          })),
        ) !==
        JSON.stringify(
          candidate.fieldProvenance.map((binding) => ({
            path: binding.path,
            authority: binding.authority,
            evidenceId: binding.evidence?.id ?? null,
          })),
        )
      )
        this.revisionConflict();
      if (candidate.requiresApproval && candidate.approvalGrantId) {
        const grant = grants.find(
          (item) =>
            item.id === candidate.approvalGrantId &&
            item.sourceId === manifest.sourceId &&
            item.importId === manifest.importId &&
            item.candidateId === candidate.id &&
            item.candidateVersion === candidate.version &&
            item.candidateValueHash === candidate.valueHash &&
            item.requiredPermission === candidate.requiredPermission &&
            item.grantedByUserId === candidate.approvalGrantedByUserId &&
            item.grantedAt.toISOString() === candidate.approvalGrantedAt &&
            item.approval.state === "APPROVED" &&
            item.approval.invalidatedAt === null &&
            item.approval.decidedByUserId === item.grantedByUserId &&
            item.approval.decidedAt?.getTime() === item.grantedAt.getTime(),
        );
        if (!grant) this.revisionConflict();
      } else if (!candidate.requiresApproval && candidate.approvalGrantId) {
        this.revisionConflict();
      }
      for (const binding of candidate.fieldProvenance) {
        if (binding.authority !== "IMPORTED") {
          if (binding.evidence) this.revisionConflict();
          continue;
        }
        if (!binding.evidence) this.revisionConflict();
        const exact = evidence.find(
          (item) =>
            item.id === binding.evidence?.id &&
            item.evidenceRecordHash === binding.evidence?.evidenceRecordHash &&
            businessImportEvidenceRecordHash(item) === item.evidenceRecordHash &&
            item.sourceId === manifest.sourceId &&
            item.importId === manifest.importId &&
            item.candidateId === candidate.id &&
            item.candidateVersion === candidate.version &&
            item.candidateValueHash === candidate.valueHash &&
            item.artifactId === binding.evidence?.artifactId &&
            item.artifactSha256 === binding.evidence?.artifactSha256 &&
            item.importGeneration === binding.evidence?.importGeneration &&
            item.parsedRevisionId === binding.evidence?.parsedRevisionId &&
            item.parsedManifestHash === binding.evidence?.parsedManifestHash &&
            item.sourceValueHash === binding.evidence?.sourceValueHash &&
            item.excerptHash === binding.evidence?.excerptHash &&
            item.parserVersion === binding.evidence?.parserVersion &&
            item.ocrVersion === binding.evidence?.ocrVersion &&
            item.extractionContractVersion === binding.evidence?.extractionContractVersion &&
            item.excerptObjectLedgerId === binding.evidence?.objectLedgerId &&
            item.excerptObjectKind === binding.evidence?.objectKind &&
            item.excerptObjectKey === binding.evidence?.objectKey &&
            item.excerptEncryptionKeyRef === binding.evidence?.encryptionKeyRef &&
            item.excerptObjectLedger.deletionState === "RETAINED" &&
            (!item.excerptObjectLedger.retainUntil ||
              item.excerptObjectLedger.retainUntil > new Date()),
        );
        if (!exact) this.revisionConflict();
      }
    }
    const diagnostics = previewDiagnostics(manifest.candidates);
    if (
      importRecord.baseInformationRevision !== state.revision ||
      importRecord.baseInformationHash !== state.canonicalHash ||
      importRecord.baseBusinessRevisionId !== state.currentRevisionId
    ) {
      diagnostics.push({
        severity: "ERROR",
        code: "BUSINESS_IMPORT_REBASE_REQUIRED",
        message: "Business information changed after this import was prepared.",
      });
    }
    if (JSON.stringify(diagnostics) !== JSON.stringify(manifest.diagnostics))
      this.revisionConflict();
    if (!allowBlocking && hasBlockingDiagnostics(diagnostics)) applicationBlocked();
  }

  private async writeOfferingMutations(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    manifest: PreviewManifest,
    mutations: OfferingMutation[],
    committedAt: string,
    defaultLocale: string,
    defaultCurrency: string,
  ) {
    const candidates = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
    for (const mutation of mutations) {
      const candidate = candidates.get(mutation.candidateId);
      if (!candidate) this.revisionConflict();
      const value = mutation.value;
      if (mutation.kind === "LINK") {
        const unchanged = await tx.businessOffering.count({
          where: {
            id: mutation.offeringId,
            tenantId: context.tenantId,
            rowVersion: mutation.expectedOfferingVersion!,
          },
        });
        if (unchanged !== 1) applicationIntegrityConflict();
      } else if (mutation.kind === "ADD") {
        await tx.businessOffering.create({
          data: {
            id: mutation.offeringId,
            tenantId: context.tenantId,
            kind: "SERVICE",
            category: value.category ?? null,
            name: value.name,
            description: value.description ?? null,
            locale: value.language ?? defaultLocale,
            bookingNotes: value.bookingNotes ?? null,
            active: value.active,
          },
        });
      } else {
        const updated = await tx.businessOffering.updateMany({
          where: {
            id: mutation.offeringId,
            tenantId: context.tenantId,
            rowVersion: mutation.expectedOfferingVersion!,
          },
          data:
            mutation.kind === "ARCHIVE"
              ? {
                  active: false,
                  archivedAt: new Date(committedAt),
                  rowVersion: { increment: 1 },
                }
              : {
                  kind: "SERVICE",
                  category: value.category ?? null,
                  name: value.name,
                  description: value.description ?? null,
                  locale: value.language ?? defaultLocale,
                  bookingNotes: value.bookingNotes ?? null,
                  active: value.active,
                  archivedAt: null,
                  rowVersion: { increment: 1 },
                },
        });
        if (updated.count !== 1) applicationIntegrityConflict();
      }
      if (!["LINK", "ARCHIVE"].includes(mutation.kind) && value.price && mutation.priceId) {
        const priceData = {
          type: value.price.type,
          amount: value.price.amount ?? null,
          amountFrom: value.price.from ?? null,
          amountTo: value.price.to ?? null,
          currency: value.price.currency ?? defaultCurrency,
          unit: value.price.unit ?? null,
          taxNote: value.price.taxNote ?? null,
          effectiveFrom: databaseDate(value.validFrom),
          effectiveUntil: databaseDate(value.validUntil),
        };
        if (mutation.expectedPriceVersion === null) {
          await tx.businessOfferingPrice.create({
            data: {
              id: mutation.priceId,
              tenantId: context.tenantId,
              offeringId: mutation.offeringId,
              ...priceData,
            },
          });
        } else {
          const updated = await tx.businessOfferingPrice.updateMany({
            where: {
              id: mutation.priceId,
              tenantId: context.tenantId,
              offeringId: mutation.offeringId,
              rowVersion: mutation.expectedPriceVersion,
            },
            data: { ...priceData, rowVersion: { increment: 1 } },
          });
          if (updated.count !== 1) applicationIntegrityConflict();
        }
      }
      if (!["LINK", "ARCHIVE"].includes(mutation.kind) && value.duration && mutation.durationId) {
        if (mutation.expectedDurationVersion === null) {
          await tx.businessOfferingDuration.create({
            data: {
              id: mutation.durationId,
              tenantId: context.tenantId,
              offeringId: mutation.offeringId,
              minimumMinutes: value.duration.minimumMinutes,
              maximumMinutes: value.duration.maximumMinutes ?? null,
            },
          });
        } else {
          const updated = await tx.businessOfferingDuration.updateMany({
            where: {
              id: mutation.durationId,
              tenantId: context.tenantId,
              offeringId: mutation.offeringId,
              rowVersion: mutation.expectedDurationVersion,
            },
            data: {
              minimumMinutes: value.duration.minimumMinutes,
              maximumMinutes: value.duration.maximumMinutes ?? null,
              rowVersion: { increment: 1 },
            },
          });
          if (updated.count !== 1) applicationIntegrityConflict();
        }
      }
      if (mutation.kind === "ARCHIVE") {
        await tx.businessOfferingSourceBinding.updateMany({
          where: {
            tenantId: context.tenantId,
            sourceId: manifest.sourceId,
            offeringId: mutation.offeringId,
            active: true,
          },
          data: {
            active: false,
            lastSeenImportId: manifest.importId,
            lastSeenSourceValueHash: candidate.valueHash,
          },
        });
        continue;
      }
      const externalKey = value.externalId ?? candidate.semanticTargetKey;
      const normalizedExternalKey = normalizeBusinessExternalId(externalKey);
      const matchingBindings = (
        await tx.businessOfferingSourceBinding.findMany({
          where: { tenantId: context.tenantId, sourceId: manifest.sourceId },
        })
      ).filter((item) => normalizeBusinessExternalId(item.externalKey) === normalizedExternalKey);
      if (matchingBindings.length > 1) applicationIntegrityConflict();
      const binding = matchingBindings[0];
      if (binding && binding.offeringId !== mutation.offeringId) applicationIntegrityConflict();
      await tx.businessOfferingSourceBinding.updateMany({
        where: {
          tenantId: context.tenantId,
          sourceId: manifest.sourceId,
          offeringId: mutation.offeringId,
          externalKey: { not: externalKey },
          active: true,
        },
        data: { active: false },
      });
      if (binding) {
        await tx.businessOfferingSourceBinding.update({
          where: { id: binding.id },
          data: {
            offeringId: mutation.offeringId,
            externalKey,
            normalizedCandidateKey: candidate.candidateKey,
            lastSeenImportId: manifest.importId,
            lastSeenSourceValueHash: candidate.valueHash,
            active: true,
          },
        });
      } else {
        await tx.businessOfferingSourceBinding.create({
          data: {
            tenantId: context.tenantId,
            sourceId: manifest.sourceId,
            offeringId: mutation.offeringId,
            externalKey,
            normalizedCandidateKey: candidate.candidateKey,
            firstSeenImportId: manifest.importId,
            lastSeenImportId: manifest.importId,
            lastSeenSourceValueHash: candidate.valueHash,
            active: true,
          },
        });
      }
    }
  }

  private async writeAttributions(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    prepared: PreparedApplyMutation,
    plan: ApplicationPlan,
    resultingRevision: number,
  ) {
    const byCandidate = new Map(
      prepared.manifest.candidates.map((candidate) => [candidate.id, candidate]),
    );
    for (const mutation of plan.mutations) {
      const candidate = byCandidate.get(mutation.candidateId);
      if (!candidate) this.revisionConflict();
      for (const field of mutation.fields) {
        const provenancePath = businessImportCanonicalProvenancePath(
          field.resourceType,
          field.fieldPath,
          candidate.action,
        );
        const binding = candidate.fieldProvenance.find((item) => item.path === provenancePath);
        if (!binding) this.revisionConflict();
        await tx.businessInformationAttribution.updateMany({
          where: {
            tenantId: context.tenantId,
            resourceType: field.resourceType,
            resourceKey: field.resourceKey,
            fieldPath: field.fieldPath,
            supersededAt: null,
          },
          data: { supersededAt: new Date(prepared.committedAt) },
        });
        const resource = {
          ...(field.resourceType === "OFFERING" ? { offeringId: field.resourceKey } : {}),
          ...(field.resourceType === "OFFERING_PRICE"
            ? { offeringPriceId: field.resourceKey }
            : {}),
          ...(field.resourceType === "OFFERING_DURATION"
            ? { offeringDurationId: field.resourceKey }
            : {}),
        };
        const revision = {
          businessRevisionId: prepared.revisionId,
          businessRevision: resultingRevision,
          businessRevisionHash: plan.resultingHash,
          attributedAt: new Date(prepared.committedAt),
        };
        if (binding.authority !== "IMPORTED") {
          if (binding.evidence) this.revisionConflict();
          await tx.businessInformationAttribution.create({
            data: {
              tenantId: context.tenantId,
              resourceType: field.resourceType,
              resourceKey: field.resourceKey,
              ...resource,
              fieldPath: field.fieldPath,
              currentValueHash: canonicalKnowledgeV2Hash(field.value),
              authority: binding.authority,
              ...revision,
            },
          });
          continue;
        }
        const evidence = binding.evidence;
        if (!evidence) this.revisionConflict();
        await tx.businessInformationAttribution.create({
          data: {
            tenantId: context.tenantId,
            resourceType: field.resourceType,
            resourceKey: field.resourceKey,
            ...resource,
            fieldPath: field.fieldPath,
            currentValueHash: canonicalKnowledgeV2Hash(field.value),
            sourceValueHash: evidence.sourceValueHash,
            authority: "IMPORTED",
            confidence: candidate.confidence,
            sourceId: prepared.manifest.sourceId,
            importId: prepared.manifest.importId,
            candidateId: candidate.id,
            candidateVersion: candidate.version,
            candidateValueHash: candidate.valueHash,
            evidenceId: evidence.id,
            artifactId: evidence.artifactId,
            artifactSha256: evidence.artifactSha256,
            importGeneration: evidence.importGeneration,
            parsedRevisionId: evidence.parsedRevisionId,
            parsedManifestHash: evidence.parsedManifestHash,
            applicationId: prepared.applicationId,
            ...revision,
            parserVersion: evidence.parserVersion,
            ocrVersion: evidence.ocrVersion,
            mapperVersion: prepared.manifest.mapperVersion,
            schemaVersion: prepared.manifest.schemaVersion,
            modelVersion: prepared.manifest.modelVersion,
            promptVersion: prepared.manifest.promptVersion,
            approvedByUserId: candidate.approvalGrantedByUserId,
            approvedAt: candidate.approvalGrantedAt ? new Date(candidate.approvalGrantedAt) : null,
          },
        });
      }
    }
  }

  private async lockImportAndCandidates(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    importId: string,
    ids: string[],
  ) {
    await this.assertDatabaseEditor(tx, context);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImport"
      WHERE "tenantId" = ${context.tenantId} AND "id" = ${importId}
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImportCandidate"
      WHERE "tenantId" = ${context.tenantId}
        AND "importId" = ${importId}
        AND "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const importRecord = await tx.businessImport.findFirst({
      where: { id: importId, tenantId: context.tenantId },
    });
    if (!importRecord) this.notFound();
    this.assertReviewState(importRecord.state);
    return importRecord;
  }

  private async assertDatabaseEditor(tx: Prisma.TransactionClient, context: RequestContext) {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
    });
    if (!membership || !["OWNER", "ADMIN", "MANAGER"].includes(membership.role)) {
      this.permissionDenied();
    }
  }

  private async assertReadableImport(context: RequestContext, importId: string) {
    const [membership, importRecord] = await Promise.all([
      this.prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
      }),
      this.prisma.businessImport.findFirst({
        where: { id: importId, tenantId: context.tenantId },
        select: { id: true },
      }),
    ]);
    if (!membership) this.permissionDenied();
    if (!importRecord) this.notFound();
  }

  private assertParsedImport(importRecord: Prisma.BusinessImportGetPayload<Record<string, never>>) {
    if (
      !importRecord.parsedRevisionId ||
      !importRecord.artifactId ||
      !importRecord.artifactSha256 ||
      !importRecord.parsedManifestHash ||
      !importRecord.parserVersion ||
      !importRecord.mapperVersion
    )
      applicationIntegrityConflict();
  }

  private assertReviewState(state: string) {
    if (!["READY_FOR_REVIEW", "AWAITING_APPROVAL", "PARTIALLY_APPLIED"].includes(state)) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_STATE_CONFLICT",
        "The import is not ready to apply.",
      );
    }
  }

  private previewObjectKey(tenantId: string, sourceId: string, importId: string, hash: string) {
    return createDeterministicKnowledgeObjectKey({
      tenantId,
      sourceId,
      purpose: "extracted",
      identity: `business-import-application-preview:${importId}:${hash}`,
    });
  }

  private assertEditor(context: RequestContext) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(context.role)) this.permissionDenied();
  }

  private businessInformationConflict(tenantId: string, etag: number): never {
    throw businessImportError(
      HttpStatus.PRECONDITION_FAILED,
      "BUSINESS_INFORMATION_REVISION_CONFLICT",
      "Business information changed after it was loaded.",
      { details: { currentEtag: businessInformationEtag(tenantId, etag) } },
    );
  }

  private previewExpired(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_PREVIEW_EXPIRED",
      "The apply preview expired. Create a new preview.",
    );
  }

  private previewIntegrityFailed(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_PREVIEW_INTEGRITY_FAILED",
      "The apply preview could not be verified.",
    );
  }

  private async verifyManifestEvidenceObjects(
    store: KnowledgeObjectStore,
    manifest: PreviewManifest,
  ) {
    const exactBindings = new Map<string, string>();
    const verifications = new Map<string, Promise<void>>();
    for (const candidate of manifest.candidates) {
      for (const binding of candidate.fieldProvenance) {
        if (binding.authority !== "IMPORTED" || !binding.evidence) continue;
        const evidence = binding.evidence;
        const exactBinding = JSON.stringify(evidence);
        const previous = exactBindings.get(evidence.id);
        if (previous && previous !== exactBinding) this.evidenceIntegrityFailed();
        exactBindings.set(evidence.id, exactBinding);
        let verification = verifications.get(evidence.id);
        if (!verification) {
          verification = this.verifyEvidenceObject(store, evidence);
          verifications.set(evidence.id, verification);
        }
        await verification;
      }
    }
  }

  private async verifyEvidenceObject(
    store: KnowledgeObjectStore,
    evidence: {
      objectKey: string;
      encryptionKeyRef: string;
      sourceValueHash: string;
      excerptHash: string;
    },
  ) {
    let bytes: Uint8Array;
    try {
      bytes = await store.get(evidence.objectKey, evidence.encryptionKeyRef);
    } catch {
      this.evidenceUnavailable();
    }
    const hash = createHash("sha256").update(bytes!).digest("hex");
    if (hash !== evidence.sourceValueHash || hash !== evidence.excerptHash) {
      this.evidenceIntegrityFailed();
    }
  }

  private evidenceUnavailable(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE",
      "Exact retained evidence is no longer available. Re-import the source file.",
    );
  }

  private evidenceIntegrityFailed(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_EVIDENCE_INTEGRITY_FAILED",
      "Exact field evidence could not be verified. Re-import the source file.",
    );
  }

  private revisionConflict(): never {
    throw businessImportError(
      HttpStatus.PRECONDITION_FAILED,
      "BUSINESS_IMPORT_REVISION_CONFLICT",
      "The import or a selected candidate changed after the preview was created.",
    );
  }

  private permissionDenied(): never {
    throw businessImportError(
      HttpStatus.FORBIDDEN,
      "BUSINESS_IMPORT_PERMISSION_DENIED",
      "The current user cannot perform this import action.",
    );
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }
}

function databaseDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function affectedResources(plan: ApplicationPlan) {
  return {
    counts: plan.counts,
    offerings: plan.mutations.map((mutation) => {
      const offering = plan.after.offerings.find((item) => item.id === mutation.offeringId)!;
      return {
        candidateId: mutation.candidateId,
        action: mutation.kind,
        offeringId: mutation.offeringId,
        offeringVersion: offering.rowVersion,
        priceId: mutation.priceId,
        priceVersion:
          mutation.priceId === null
            ? null
            : (offering.prices.find((item) => item.id === mutation.priceId)?.rowVersion ?? null),
        durationId: mutation.durationId,
        durationVersion: offering.duration?.rowVersion ?? null,
      };
    }),
  };
}

function applicationView(row: ApplicationRecord): BusinessImportApplicationView {
  const affected = record(row.affectedResourceVersions);
  const counts = record(affected.counts);
  const count = (name: string) => {
    const value = counts[name];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  };
  return {
    id: row.id,
    importId: row.importId,
    state: row.state,
    baseBusinessInformationRevision: row.baseInformationRevision,
    resultingBusinessInformationRevision: row.resultingInformationRevision,
    counts: {
      additions: count("additions"),
      updates: count("updates"),
      linked: count("linked"),
      unchanged: count("unchanged"),
    },
    projection: {
      businessInformationRevision: row.resultingInformationRevision,
      knowledgeDraftGeneration: row.projectionReceipt?.knowledgeDraftGeneration ?? null,
      ready: row.state === "READY" && row.projectionReceipt !== null,
      errorCode: row.projectionOutbox?.lastErrorCode ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    readyAt: row.projectedAt?.toISOString() ?? null,
    revertedAt: row.revertedAt?.toISOString() ?? null,
  };
}
