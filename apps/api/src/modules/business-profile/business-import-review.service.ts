import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  businessImportEvidenceRecordHash,
  businessOfferingIdentityKey,
  canonicalBusinessImportDecimal,
  compareBusinessImportDecimals,
  isBusinessImportCurrencyCode,
  normalizeBusinessExternalId,
  reviseBusinessImportFieldProvenance,
  type BusinessImportFieldProvenance,
} from "@leadvirt/business-import";
import { Prisma } from "@leadvirt/db";
import type {
  BusinessImportApprovalDecisionRequest,
  BusinessImportBulkApprovalRequest,
  BusinessImportBulkApprovalView,
  BusinessImportBulkCandidateDecisionRequest,
  BusinessImportCandidateAction,
  BusinessImportCandidateDecisionRequest,
  BusinessImportCandidatePage,
  BusinessImportCandidateView,
  BusinessImportOfferingValue,
  BusinessImportView,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import {
  assertBusinessImportIfMatch,
  businessImportCandidateEtag,
  businessImportEtag,
  businessImportError,
  businessImportManifestHash,
} from "./business-import-http.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";

interface PreparedEvidence {
  id: string;
  previousId: string;
  locator: Prisma.InputJsonValue;
  sourceValueHash: string;
  excerptHash: string;
  objectLedgerId: string;
  objectKey: string;
  encryptionKeyRef: string;
  semanticElementId: string | null;
  semanticTableId: string | null;
  parserVersion: string;
  ocrVersion: string | null;
  extractionContractVersion: string;
}

interface PreparedEdit {
  candidateId: string;
  expectedVersion: number;
  expectedHash: string;
  normalized: BusinessImportOfferingValue;
  normalizedHash: string;
  fieldProvenance: BusinessImportFieldProvenance;
  evidence: PreparedEvidence[];
}

const MAX_BULK_APPROVAL_CANDIDATES = 200;

function clean(value: string | null | undefined, maximum: number) {
  const normalized = value?.normalize("NFC").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function decimal(value: string | null | undefined) {
  const normalized = clean(value, 64);
  if (normalized === null) return null;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/u.test(normalized)) invalidValue();
  return normalized;
}

function normalizedOffering(input: BusinessImportOfferingValue): BusinessImportOfferingValue {
  const name = clean(input.name, 160);
  if (!name) invalidValue();
  const price = input.price
    ? {
        type: input.price.type,
        amount: decimal(input.price.amount),
        from: decimal(input.price.from),
        to: decimal(input.price.to),
        currency: clean(input.price.currency, 3)?.toUpperCase() ?? null,
        unit: clean(input.price.unit, 80),
        taxNote: clean(input.price.taxNote, 500),
      }
    : null;
  if (price) {
    if (price.currency !== null && !isBusinessImportCurrencyCode(price.currency)) invalidValue();
    if (
      price.type === "FIXED" &&
      (price.amount === null || price.from !== null || price.to !== null)
    )
      invalidValue();
    if (
      price.type === "FROM" &&
      (price.amount !== null || price.from === null || price.to !== null)
    )
      invalidValue();
    if (price.type === "RANGE") {
      if (
        price.amount !== null ||
        price.from === null ||
        price.to === null ||
        compareBusinessImportDecimals(price.to, price.from) < 0
      )
        invalidValue();
    }
    if (
      ["FREE", "ON_REQUEST"].includes(price.type) &&
      (price.amount !== null || price.from !== null || price.to !== null)
    ) {
      invalidValue();
    }
    if (!["FREE", "ON_REQUEST"].includes(price.type) && price.currency === null) invalidValue();
  }
  const duration = input.duration
    ? {
        minimumMinutes: input.duration.minimumMinutes,
        maximumMinutes: input.duration.maximumMinutes ?? null,
      }
    : null;
  if (
    duration &&
    (!Number.isInteger(duration.minimumMinutes) ||
      duration.minimumMinutes <= 0 ||
      (duration.maximumMinutes !== null &&
        (!Number.isInteger(duration.maximumMinutes) ||
          duration.maximumMinutes < duration.minimumMinutes)))
  )
    invalidValue();
  const validFrom = clean(input.validFrom, 10);
  const validUntil = clean(input.validUntil, 10);
  if (
    (validFrom && !exactCalendarDate(validFrom)) ||
    (validUntil && !exactCalendarDate(validUntil)) ||
    (validFrom && validUntil && validUntil < validFrom) ||
    ((validFrom !== null || validUntil !== null) && price === null)
  )
    invalidValue();
  if (typeof input.active !== "boolean") invalidValue();
  return {
    externalId: clean(input.externalId, 200),
    category: clean(input.category, 160),
    name,
    description: clean(input.description, 2_000),
    price,
    duration,
    locationExternalId: clean(input.locationExternalId, 200),
    bookingNotes: clean(input.bookingNotes, 1_000),
    active: input.active,
    validFrom,
    validUntil,
    language: clean(input.language, 35)?.toLowerCase() ?? null,
  };
}

function exactCalendarDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fieldProvenanceConflict(): never {
  throw businessImportError(
    HttpStatus.CONFLICT,
    "BUSINESS_IMPORT_FIELD_PROVENANCE_INTEGRITY_FAILED",
    "The candidate field provenance could not be verified.",
  );
}

function offeringHash(value: BusinessImportOfferingValue, includeExternalId = true) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        active: value.active,
        bookingNotes: value.bookingNotes ?? null,
        category: value.category ?? null,
        description: value.description ?? null,
        duration: value.duration
          ? {
              maximumMinutes: value.duration.maximumMinutes ?? null,
              minimumMinutes: value.duration.minimumMinutes,
            }
          : null,
        ...(includeExternalId ? { externalId: value.externalId ?? null } : {}),
        language: value.language ?? null,
        locationExternalId: value.locationExternalId ?? null,
        name: value.name,
        price: value.price
          ? {
              amount: canonicalBusinessImportDecimal(value.price.amount),
              currency: value.price.currency ?? null,
              from: canonicalBusinessImportDecimal(value.price.from),
              taxNote: value.price.taxNote ?? null,
              to: canonicalBusinessImportDecimal(value.price.to),
              type: value.price.type,
              unit: value.price.unit ?? null,
            }
          : null,
        validFrom: value.validFrom ?? null,
        validUntil: value.validUntil ?? null,
      }),
    )
    .digest("hex");
}

function invalidValue(): never {
  throw businessImportError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "BUSINESS_IMPORT_CANDIDATE_VALUE_INVALID",
    "The proposed service value is invalid.",
  );
}

@Injectable()
export class BusinessImportReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
    @Inject(BusinessImportViewService) private readonly views: BusinessImportViewService,
  ) {}

  private async classifyEditedOffering(
    tx: Prisma.TransactionClient,
    candidate: {
      action: BusinessImportCandidateAction;
      semanticTargetKey: string;
      tenantId: string;
      sourceId: string;
      targetOfferingId: string | null;
    },
    proposed: BusinessImportOfferingValue,
    proposedHash: string,
  ): Promise<{
    action: Extract<BusinessImportCandidateAction, "ADD" | "UPDATE" | "LINK" | "UNCHANGED">;
    semanticTargetKey: string;
    targetOfferingId: string | null;
    currentFingerprint: string | null;
  }> {
    const offerings = await tx.businessOffering.findMany({
      where: { tenantId: candidate.tenantId, archivedAt: null },
      include: {
        prices: { orderBy: { createdAt: "desc" }, take: 1 },
        duration: true,
        sourceBindings: { where: { sourceId: candidate.sourceId } },
      },
    });
    const semanticTargetKey = businessOfferingIdentityKey({
      category: proposed.category ?? null,
      name: proposed.name,
      locationExternalId: proposed.locationExternalId ?? null,
      language: proposed.language ?? null,
    });
    const priorTarget = candidate.targetOfferingId
      ? offerings.find((offering) => offering.id === candidate.targetOfferingId)
      : undefined;
    if (candidate.targetOfferingId && !priorTarget) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_TARGET_CHANGED",
        "The target service changed. Rebase the import before editing it.",
      );
    }
    let target =
      candidate.action !== "CONFLICT" || candidate.semanticTargetKey === semanticTargetKey
        ? priorTarget
        : undefined;
    if (!target && proposed.externalId) {
      const externalId = normalizeBusinessExternalId(proposed.externalId);
      const matches = offerings.filter((offering) =>
        offering.sourceBindings.some(
          (binding) => normalizeBusinessExternalId(binding.externalKey) === externalId,
        ),
      );
      if (matches.length > 1) this.editedCandidateStillConflicted();
      target = matches[0];
    }
    if (!target) {
      const matches = offerings.filter((offering) => {
        return (
          businessOfferingIdentityKey({
            category: offering.category,
            name: offering.name,
            locationExternalId: null,
            language: offering.locale,
          }) === semanticTargetKey
        );
      });
      if (matches.length > 1) this.editedCandidateStillConflicted();
      target = matches[0];
    }
    if (!target) {
      return {
        action: "ADD",
        semanticTargetKey,
        targetOfferingId: null,
        currentFingerprint: null,
      };
    }
    const price = target.prices[0];
    const binding = target.sourceBindings.find((item) => item.active);
    const current: BusinessImportOfferingValue = {
      externalId: binding?.externalKey ?? null,
      category: target.category,
      name: target.name,
      description: target.description,
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
      duration: target.duration
        ? {
            minimumMinutes: target.duration.minimumMinutes,
            maximumMinutes: target.duration.maximumMinutes,
          }
        : null,
      locationExternalId: null,
      bookingNotes: target.bookingNotes,
      active: target.active,
      validFrom: price?.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      validUntil: price?.effectiveUntil?.toISOString().slice(0, 10) ?? null,
      language: target.locale,
    };
    const currentFingerprint = offeringHash(current);
    const canonicalMatch = offeringHash(current, false) === offeringHash(proposed, false);
    if (binding && canonicalMatch && currentFingerprint !== proposedHash) {
      this.editedCandidateStillConflicted();
    }
    return {
      action:
        currentFingerprint === proposedHash
          ? "UNCHANGED"
          : !binding && canonicalMatch
            ? "LINK"
            : "UPDATE",
      semanticTargetKey,
      targetOfferingId: target.id,
      currentFingerprint,
    };
  }

  async decideCandidate(
    context: RequestContext,
    importId: string,
    candidateId: string,
    input: BusinessImportCandidateDecisionRequest,
    ifMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportCandidateView> {
    this.assertEditor(context);
    const runtime = this.runtimeService.runtime();
    const outcome = await this.idempotency.executePrepared<
      { importId: string; candidateId: string },
      PreparedEdit | null
    >(
      {
        tenantId: context.tenantId,
        endpoint: `PATCH:/business-profile/imports/${importId}/candidates/${candidateId}`,
        key: idempotencyKey,
        request: { importId, candidateId, input, ifMatch },
      },
      async () => {
        if (!input.proposed) return null;
        const candidate = await this.prisma.businessImportCandidate.findFirst({
          where: { id: candidateId, importId, tenantId: context.tenantId },
        });
        if (!candidate) this.notFound();
        assertBusinessImportIfMatch(
          ifMatch,
          businessImportCandidateEtag(candidate.id, candidate.etag),
        );
        const normalized = normalizedOffering(input.proposed);
        const revision = await this.prisma.businessImportCandidateRevision.findFirst({
          where: {
            tenantId: context.tenantId,
            sourceId: candidate.sourceId,
            importId,
            candidateId,
            version: candidate.version,
            normalizedValueHash: candidate.normalizedValueHash,
          },
        });
        if (!revision) this.revisionConflict();
        const currentEvidence = await this.prisma.businessImportCandidateEvidence.findMany({
          where: {
            tenantId: context.tenantId,
            importId,
            candidateId,
            candidateVersion: candidate.version,
            candidateValueHash: candidate.normalizedValueHash,
          },
          include: { excerptObjectLedger: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 40,
        });
        const evidence: PreparedEvidence[] = [];
        for (const item of currentEvidence) {
          if (
            item.candidateVersion !== candidate.version ||
            item.candidateValueHash !== candidate.normalizedValueHash ||
            item.excerptObjectLedger.deletionState !== "RETAINED" ||
            (item.excerptObjectLedger.retainUntil &&
              item.excerptObjectLedger.retainUntil.getTime() <= Date.now())
          )
            continue;
          if (businessImportEvidenceRecordHash(item) !== item.evidenceRecordHash) {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_EVIDENCE_INTEGRITY_FAILED",
              "The candidate evidence could not be verified.",
            );
          }
          let bytes: Uint8Array;
          try {
            bytes = await runtime.store.get(item.excerptObjectKey, item.excerptEncryptionKeyRef);
          } catch {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE",
              "The candidate evidence is no longer available. Re-import the source file.",
            );
          }
          const evidenceHash = createHash("sha256").update(bytes).digest("hex");
          if (evidenceHash !== item.sourceValueHash || evidenceHash !== item.excerptHash) {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_EVIDENCE_INTEGRITY_FAILED",
              "The candidate evidence could not be verified.",
            );
          }
          evidence.push({
            id: randomUUID(),
            previousId: item.id,
            locator: item.locator as Prisma.InputJsonValue,
            sourceValueHash: item.sourceValueHash,
            excerptHash: item.excerptHash,
            objectLedgerId: item.excerptObjectLedgerId,
            objectKey: item.excerptObjectKey,
            encryptionKeyRef: item.excerptEncryptionKeyRef,
            semanticElementId: item.semanticElementId,
            semanticTableId: item.semanticTableId,
            parserVersion: item.parserVersion,
            ocrVersion: item.ocrVersion,
            extractionContractVersion: item.extractionContractVersion,
          });
        }
        let fieldProvenance: BusinessImportFieldProvenance;
        try {
          fieldProvenance = reviseBusinessImportFieldProvenance(
            candidate.normalizedValue as unknown as BusinessImportOfferingValue,
            normalized,
            revision.fieldProvenance,
            new Map(evidence.map((item) => [item.previousId, item.id])),
          );
        } catch {
          fieldProvenanceConflict();
        }
        return {
          candidateId,
          expectedVersion: candidate.version,
          expectedHash: candidate.normalizedValueHash,
          normalized,
          normalizedHash: offeringHash(normalized),
          fieldProvenance,
          evidence,
        };
      },
      async (tx, prepared) => {
        await this.lockImport(tx, context, importId);
        const candidate = await tx.businessImportCandidate.findFirst({
          where: { id: candidateId, importId, tenantId: context.tenantId },
        });
        if (!candidate) this.notFound();
        assertBusinessImportIfMatch(
          ifMatch,
          businessImportCandidateEtag(candidate.id, candidate.etag),
        );
        if (prepared) this.assertEditAllowed(candidate.action, candidate.risk, candidate.decision);
        else
          this.assertDecisionAllowed(
            candidate.action,
            candidate.risk,
            candidate.decision,
            input.decision,
          );
        const now = new Date();
        if (prepared) {
          if (
            prepared.expectedVersion !== candidate.version ||
            prepared.expectedHash !== candidate.normalizedValueHash
          )
            this.revisionConflict();
          const previous = await tx.businessImportCandidateRevision.findFirst({
            where: {
              tenantId: context.tenantId,
              sourceId: candidate.sourceId,
              importId,
              candidateId,
              version: candidate.version,
              normalizedValueHash: candidate.normalizedValueHash,
            },
          });
          if (!previous) this.revisionConflict();
          const nextVersion = candidate.version + 1;
          let exactFieldProvenance: BusinessImportFieldProvenance;
          try {
            exactFieldProvenance = reviseBusinessImportFieldProvenance(
              candidate.normalizedValue as unknown as BusinessImportOfferingValue,
              prepared.normalized,
              previous.fieldProvenance,
              new Map(prepared.evidence.map((item) => [item.previousId, item.id])),
            );
          } catch {
            fieldProvenanceConflict();
          }
          if (
            businessImportManifestHash(exactFieldProvenance) !==
            businessImportManifestHash(prepared.fieldProvenance)
          )
            fieldProvenanceConflict();
          const classification = await this.classifyEditedOffering(
            tx,
            candidate,
            prepared.normalized,
            prepared.normalizedHash,
          );
          const risk =
            classification.action === "LINK"
              ? "LOW"
              : prepared.normalized.price
                ? "HIGH"
                : prepared.normalized.duration || prepared.normalized.bookingNotes
                  ? "MEDIUM"
                  : "LOW";
          this.assertDecisionAllowed(
            classification.action,
            risk,
            candidate.decision,
            input.decision,
          );
          const requiresApproval =
            risk === "HIGH" && ["ADD", "UPDATE"].includes(classification.action);
          const requiredPermission = requiresApproval ? "business_information.approve" : "";
          await this.invalidateApprovals(tx, candidate, context.userId, now);
          await tx.businessImportCandidateRevision.create({
            data: {
              tenantId: candidate.tenantId,
              sourceId: candidate.sourceId,
              importId: candidate.importId,
              candidateId: candidate.id,
              version: nextVersion,
              parsedRevisionId: previous.parsedRevisionId,
              importGeneration: previous.importGeneration,
              artifactId: previous.artifactId,
              artifactSha256: previous.artifactSha256,
              parsedManifestHash: previous.parsedManifestHash,
              mappingId: previous.mappingId,
              targetCategory: previous.targetCategory,
              semanticTargetKey: classification.semanticTargetKey,
              action: classification.action,
              normalizedValue: prepared.normalized as unknown as Prisma.InputJsonValue,
              normalizedValueHash: prepared.normalizedHash,
              fieldProvenance: exactFieldProvenance,
              targetOfferingId: classification.targetOfferingId,
              currentFingerprint: classification.currentFingerprint,
              risk,
              confidence: previous.confidence,
              validationCodes: Prisma.JsonNull,
              reasonCodes: Prisma.JsonNull,
              requiresApproval,
              requiredPermission,
            },
          });
          for (const item of prepared.evidence) {
            const ledgers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id"
              FROM "BusinessImportObjectLedger"
              WHERE "id" = ${item.objectLedgerId}
                AND "tenantId" = ${candidate.tenantId}
                AND "objectKind" = 'EVIDENCE_EXCERPT'::"BusinessImportObjectKind"
                AND "objectStorageKey" = ${item.objectKey}
                AND "encryptionKeyRef" = ${item.encryptionKeyRef}
                AND "deletionState" = 'RETAINED'::"BusinessImportArtifactDeletionState"
                AND ("retainUntil" IS NULL OR "retainUntil" > ${now})
              FOR SHARE
            `);
            if (ledgers.length !== 1) {
              throw businessImportError(
                HttpStatus.CONFLICT,
                "BUSINESS_IMPORT_EVIDENCE_EXPIRED",
                "The candidate evidence expired before the edit was saved.",
              );
            }
            const evidenceRecord = {
              id: item.id,
              tenantId: candidate.tenantId,
              sourceId: candidate.sourceId,
              importId: candidate.importId,
              candidateId: candidate.id,
              candidateVersion: nextVersion,
              candidateValueHash: prepared.normalizedHash,
              artifactId: previous.artifactId,
              artifactSha256: previous.artifactSha256,
              importGeneration: previous.importGeneration,
              parsedRevisionId: previous.parsedRevisionId,
              parsedManifestHash: previous.parsedManifestHash,
              semanticElementId: item.semanticElementId,
              semanticTableId: item.semanticTableId,
              locator: item.locator,
              sourceValueHash: item.sourceValueHash,
              excerptHash: item.excerptHash,
              excerptObjectKey: item.objectKey,
              excerptEncryptionKeyRef: item.encryptionKeyRef,
              excerptObjectLedgerId: item.objectLedgerId,
              excerptObjectKind: "EVIDENCE_EXCERPT" as const,
              parserVersion: item.parserVersion,
              ocrVersion: item.ocrVersion,
              extractionContractVersion: item.extractionContractVersion,
            };
            await tx.businessImportCandidateEvidence.create({
              data: {
                ...evidenceRecord,
                evidenceRecordHash: businessImportEvidenceRecordHash(evidenceRecord),
              },
            });
          }
          const updated = await tx.businessImportCandidate.updateMany({
            where: {
              id: candidate.id,
              tenantId: candidate.tenantId,
              version: candidate.version,
              etag: candidate.etag,
            },
            data: {
              normalizedValue: prepared.normalized as unknown as Prisma.InputJsonValue,
              normalizedValueHash: prepared.normalizedHash,
              semanticTargetKey: classification.semanticTargetKey,
              action: classification.action,
              targetOfferingId: classification.targetOfferingId,
              currentFingerprint: classification.currentFingerprint,
              version: nextVersion,
              etag: { increment: 1 },
              risk,
              requiresApproval,
              requiredPermission,
              validationCodes: Prisma.JsonNull,
              reasonCodes: Prisma.JsonNull,
              decision: input.decision === "REJECTED" ? "REJECTED" : "EDITED",
              decidedByUserId: context.userId,
              decidedAt: now,
              staleAt: null,
            },
          });
          if (updated.count !== 1) this.revisionConflict();
        } else {
          if (candidate.decision === "SUBMITTED_FOR_APPROVAL") {
            await this.invalidateApprovals(
              tx,
              candidate,
              context.userId,
              now,
              input.decision === "REJECTED" ? "CANDIDATE_REJECTED" : "CANDIDATE_REVIEW_REOPENED",
              false,
            );
          }
          const updated = await tx.businessImportCandidate.updateMany({
            where: { id: candidate.id, tenantId: candidate.tenantId, etag: candidate.etag },
            data: {
              decision: input.decision,
              decidedByUserId: context.userId,
              decidedAt: now,
              etag: { increment: 1 },
            },
          });
          if (updated.count !== 1) this.revisionConflict();
        }
        const nextImportState = await this.reviewState(tx, context.tenantId, importId);
        await tx.businessImport.update({
          where: { id: importId },
          data: { state: nextImportState, etag: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: prepared
              ? "business_import.candidate_edited"
              : "business_import.candidate_decided",
            entityType: "business_import_candidate",
            entityId: candidate.id,
            payload: {
              importId,
              decision: input.decision,
              previousVersion: candidate.version,
              resultingVersion: prepared ? candidate.version + 1 : candidate.version,
              previousAction: candidate.action,
            },
          },
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { importId, candidateId },
          responseRef: candidate.id,
        };
      },
    );
    return this.loadCandidate(
      context,
      outcome.responseBody.importId,
      outcome.responseBody.candidateId,
    );
  }

  async bulkDecide(
    context: RequestContext,
    importId: string,
    input: BusinessImportBulkCandidateDecisionRequest,
    importIfMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportCandidatePage> {
    this.assertEditor(context);
    this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<{ importId: string }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/decisions/bulk`,
        key: idempotencyKey,
        request: { importId, input, importIfMatch },
      },
      async (tx) => {
        const importRecord = await this.lockImport(tx, context, importId);
        assertBusinessImportIfMatch(importIfMatch, businessImportEtag(importId, importRecord.etag));
        const refs = [...input.candidates].sort((left, right) => left.id.localeCompare(right.id));
        const rows = await tx.businessImportCandidate.findMany({
          where: { tenantId: context.tenantId, importId, id: { in: refs.map((item) => item.id) } },
        });
        if (rows.length !== refs.length) this.notFound();
        const byId = new Map(rows.map((row) => [row.id, row]));
        const now = new Date();
        for (const ref of refs) {
          const candidate = byId.get(ref.id)!;
          assertBusinessImportIfMatch(
            ref.etag,
            businessImportCandidateEtag(candidate.id, candidate.etag),
          );
          this.assertDecisionAllowed(
            candidate.action,
            candidate.risk,
            candidate.decision,
            ref.decision,
          );
          if (candidate.decision === "SUBMITTED_FOR_APPROVAL") {
            await this.invalidateApprovals(
              tx,
              candidate,
              context.userId,
              now,
              ref.decision === "REJECTED" ? "CANDIDATE_REJECTED" : "CANDIDATE_REVIEW_REOPENED",
              false,
            );
          }
          const updated = await tx.businessImportCandidate.updateMany({
            where: { id: candidate.id, tenantId: context.tenantId, etag: candidate.etag },
            data: {
              decision: ref.decision,
              decidedByUserId: context.userId,
              decidedAt: now,
              etag: { increment: 1 },
            },
          });
          if (updated.count !== 1) this.revisionConflict();
        }
        const nextImportState = await this.reviewState(tx, context.tenantId, importId);
        const importUpdated = await tx.businessImport.updateMany({
          where: { id: importId, tenantId: context.tenantId, etag: importRecord.etag },
          data: { state: nextImportState, etag: { increment: 1 } },
        });
        if (importUpdated.count !== 1) this.revisionConflict();
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.candidates_bulk_decided",
            entityType: "business_import",
            entityId: importId,
            payload: { candidateCount: refs.length },
          },
        });
        return { httpStatus: HttpStatus.OK, responseBody: { importId }, responseRef: importId };
      },
    );
    return this.views.listCandidates(context, outcome.responseBody.importId, { limit: 100 });
  }

  async requestApproval(
    context: RequestContext,
    importId: string,
    candidateIds: string[],
    importIfMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<{ import: BusinessImportView; candidates: BusinessImportCandidateView[] }> {
    this.assertEditor(context);
    this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<{ importId: string; candidateIds: string[] }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/approval-requests`,
        key: idempotencyKey,
        request: { importId, candidateIds, importIfMatch },
      },
      async (tx) => {
        const importRecord = await this.lockImport(tx, context, importId);
        assertBusinessImportIfMatch(importIfMatch, businessImportEtag(importId, importRecord.etag));
        const ids = [...new Set(candidateIds)].sort();
        const candidates = await tx.businessImportCandidate.findMany({
          where: { tenantId: context.tenantId, importId, id: { in: ids } },
        });
        if (candidates.length !== ids.length) this.notFound();
        const now = new Date();
        for (const candidate of candidates) {
          if (
            !candidate.requiresApproval ||
            !candidate.requiredPermission ||
            !["ACCEPTED", "EDITED", "SUBMITTED_FOR_APPROVAL"].includes(candidate.decision)
          ) {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_APPROVAL_NOT_REQUIRED",
              "The selected candidate does not require approval.",
            );
          }
          const existing = await tx.businessImportCandidateApproval.findUnique({
            where: {
              tenantId_candidateId_candidateVersion_candidateValueHash_requiredPermission: {
                tenantId: context.tenantId,
                candidateId: candidate.id,
                candidateVersion: candidate.version,
                candidateValueHash: candidate.normalizedValueHash,
                requiredPermission: candidate.requiredPermission,
              },
            },
          });
          let decision: "SUBMITTED_FOR_APPROVAL" | "ACCEPTED" = "SUBMITTED_FOR_APPROVAL";
          if (!existing) {
            await tx.businessImportCandidateApproval.create({
              data: {
                tenantId: context.tenantId,
                sourceId: candidate.sourceId,
                importId,
                candidateId: candidate.id,
                candidateVersion: candidate.version,
                candidateValueHash: candidate.normalizedValueHash,
                requiresApproval: true,
                requiredPermission: candidate.requiredPermission,
                riskReason: candidate.risk,
                requestedByUserId: context.userId,
              },
            });
          } else if (existing.state === "APPROVED") {
            const grant = await tx.businessImportApprovalGrant.findFirst({
              where: {
                tenantId: context.tenantId,
                importId,
                candidateId: candidate.id,
                candidateVersion: candidate.version,
                candidateValueHash: candidate.normalizedValueHash,
                requiredPermission: candidate.requiredPermission,
                approvalId: existing.id,
              },
              select: { id: true },
            });
            if (!grant) this.revisionConflict();
            decision = "ACCEPTED";
          } else if (
            existing.state === "INVALIDATED" &&
            ["CANDIDATE_REJECTED", "CANDIDATE_REVIEW_REOPENED"].includes(
              existing.decisionReason ?? "",
            )
          ) {
            await tx.businessImportCandidateApproval.update({
              where: { id: existing.id },
              data: {
                state: "PENDING",
                requestedByUserId: context.userId,
                decidedByUserId: null,
                decisionReason: null,
                decidedAt: null,
                invalidatedAt: null,
                etag: { increment: 1 },
              },
            });
          } else if (existing.state !== "PENDING") {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_APPROVAL_VERSION_CLOSED",
              "This exact candidate version cannot be submitted again.",
            );
          }
          await tx.businessImportCandidate.update({
            where: { id: candidate.id },
            data: {
              decision,
              decidedByUserId: context.userId,
              decidedAt: now,
              etag: { increment: 1 },
            },
          });
        }
        const nextImportState = await this.reviewState(tx, context.tenantId, importId);
        await tx.businessImport.update({
          where: { id: importId },
          data: {
            state: nextImportState,
            etag: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.approval_requested",
            entityType: "business_import",
            entityId: importId,
            payload: { candidateCount: ids.length },
          },
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { importId, candidateIds: ids },
          responseRef: importId,
        };
      },
    );
    return this.approvalMutationView(
      context,
      outcome.responseBody.importId,
      outcome.responseBody.candidateIds,
    );
  }

  async decideApproval(
    context: RequestContext,
    importId: string,
    approvalId: string,
    input: BusinessImportApprovalDecisionRequest,
    importIfMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<{ import: BusinessImportView; candidates: BusinessImportCandidateView[] }> {
    this.assertApprover(context);
    this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<{ importId: string; candidateIds: string[] }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/approvals/${approvalId}/decision`,
        key: idempotencyKey,
        request: { importId, approvalId, input, importIfMatch },
      },
      async (tx) => {
        const importRecord = await this.lockImport(tx, context, importId, true);
        assertBusinessImportIfMatch(importIfMatch, businessImportEtag(importId, importRecord.etag));
        const approval = await tx.businessImportCandidateApproval.findFirst({
          where: { id: approvalId, tenantId: context.tenantId, importId },
          include: { candidate: true },
        });
        if (!approval) this.notFound();
        if (approval.state !== "PENDING") {
          throw businessImportError(
            HttpStatus.CONFLICT,
            "BUSINESS_IMPORT_APPROVAL_ALREADY_DECIDED",
            "This approval has already been decided.",
          );
        }
        if (
          approval.candidate.version !== approval.candidateVersion ||
          approval.candidate.normalizedValueHash !== approval.candidateValueHash ||
          approval.candidate.decision !== "SUBMITTED_FOR_APPROVAL"
        )
          this.revisionConflict();
        const now = new Date();
        await tx.businessImportCandidateApproval.update({
          where: { id: approval.id },
          data: {
            state: input.decision,
            decidedByUserId: context.userId,
            decisionReason: clean(input.reason, 500),
            decidedAt: now,
            etag: { increment: 1 },
          },
        });
        if (input.decision === "APPROVED") {
          await tx.businessImportApprovalGrant.create({
            data: {
              tenantId: context.tenantId,
              sourceId: approval.sourceId,
              importId,
              candidateId: approval.candidateId,
              candidateVersion: approval.candidateVersion,
              candidateValueHash: approval.candidateValueHash,
              requiredPermission: approval.requiredPermission,
              approvalId: approval.id,
              grantedByUserId: context.userId,
              grantedAt: now,
              decisionHash: businessImportManifestHash({
                approvalId: approval.id,
                candidateId: approval.candidateId,
                candidateVersion: approval.candidateVersion,
                candidateValueHash: approval.candidateValueHash,
                requiredPermission: approval.requiredPermission,
                grantedByUserId: context.userId,
                grantedAt: now.toISOString(),
              }),
            },
          });
          await tx.businessImportCandidate.update({
            where: { id: approval.candidateId },
            data: { decision: "ACCEPTED", etag: { increment: 1 } },
          });
        } else {
          await tx.businessImportCandidate.update({
            where: { id: approval.candidateId },
            data: {
              decision: "REJECTED",
              decidedByUserId: context.userId,
              decidedAt: now,
              etag: { increment: 1 },
            },
          });
        }
        const nextImportState = await this.reviewState(tx, context.tenantId, importId);
        await tx.businessImport.update({
          where: { id: importId },
          data: { state: nextImportState, etag: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.approval_decided",
            entityType: "business_import_approval",
            entityId: approval.id,
            payload: {
              importId,
              candidateId: approval.candidateId,
              candidateVersion: approval.candidateVersion,
              decision: input.decision,
            },
          },
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { importId, candidateIds: [approval.candidateId] },
          responseRef: approval.id,
        };
      },
    );
    return this.approvalMutationView(
      context,
      outcome.responseBody.importId,
      outcome.responseBody.candidateIds,
    );
  }

  async bulkApprove(
    context: RequestContext,
    importId: string,
    input: BusinessImportBulkApprovalRequest,
    importIfMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportBulkApprovalView> {
    this.assertApprover(context);
    await this.assertCurrentApprover(context);
    this.runtimeService.runtime();
    const refs = this.bulkApprovalRefs(input);
    const outcome = await this.idempotency.execute<{
      importId: string;
      candidateIds: string[];
      summary: BusinessImportBulkApprovalView["summary"];
    }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/approvals/bulk`,
        key: idempotencyKey,
        request: { actorUserId: context.userId, importId, candidates: refs, importIfMatch },
      },
      async (tx) => {
        const importRecord = await this.lockImport(tx, context, importId, true);
        assertBusinessImportIfMatch(importIfMatch, businessImportEtag(importId, importRecord.etag));
        const candidates = await tx.businessImportCandidate.findMany({
          where: {
            tenantId: context.tenantId,
            importId,
            id: { in: refs.map((item) => item.id) },
          },
        });
        if (candidates.length !== refs.length) this.notFound();
        const approvals = await tx.businessImportCandidateApproval.findMany({
          where: {
            tenantId: context.tenantId,
            importId,
            OR: candidates.map((candidate) => ({
              candidateId: candidate.id,
              candidateVersion: candidate.version,
              candidateValueHash: candidate.normalizedValueHash,
              requiredPermission: candidate.requiredPermission,
            })),
          },
          include: { grants: true },
        });
        const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const exactApprovals = new Map<string, (typeof approvals)[number]>();

        for (const ref of refs) {
          const candidate = candidatesById.get(ref.id)!;
          if (candidate.version !== ref.version) this.revisionConflict();
          assertBusinessImportIfMatch(
            ref.etag,
            businessImportCandidateEtag(candidate.id, candidate.etag),
            { candidateId: candidate.id, candidateVersion: candidate.version },
          );
          if (
            !candidate.requiresApproval ||
            candidate.risk !== "HIGH" ||
            !["ADD", "UPDATE"].includes(candidate.action) ||
            candidate.requiredPermission !== "business_information.approve"
          ) {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_APPROVAL_NOT_REQUIRED",
              "The selected candidate is not eligible for high-risk approval.",
            );
          }
          const exact = approvals.filter(
            (approval) =>
              approval.candidateId === candidate.id &&
              approval.candidateVersion === candidate.version &&
              approval.candidateValueHash === candidate.normalizedValueHash &&
              approval.requiredPermission === candidate.requiredPermission,
          );
          if (exact.length > 1) this.revisionConflict();
          const approval = exact[0];
          if (!approval) {
            if (!["ACCEPTED", "EDITED"].includes(candidate.decision)) this.revisionConflict();
            continue;
          }
          if (["REJECTED", "INVALIDATED"].includes(approval.state)) {
            throw businessImportError(
              HttpStatus.CONFLICT,
              "BUSINESS_IMPORT_APPROVAL_VERSION_CLOSED",
              "This exact candidate version cannot be approved again. Edit it first.",
            );
          }
          if (approval.state === "PENDING") {
            if (
              candidate.decision !== "SUBMITTED_FOR_APPROVAL" ||
              approval.invalidatedAt !== null ||
              approval.decidedByUserId !== null ||
              approval.decidedAt !== null ||
              approval.grants.length !== 0
            )
              this.revisionConflict();
          } else {
            const grant = approval.grants[0];
            if (
              approval.state !== "APPROVED" ||
              approval.invalidatedAt !== null ||
              candidate.decision !== "ACCEPTED" ||
              approval.grants.length !== 1 ||
              !grant ||
              grant.candidateVersion !== candidate.version ||
              grant.candidateValueHash !== candidate.normalizedValueHash ||
              grant.requiredPermission !== candidate.requiredPermission ||
              grant.grantedByUserId !== approval.decidedByUserId ||
              grant.grantedAt.getTime() !== approval.decidedAt?.getTime() ||
              grant.decisionHash !==
                businessImportManifestHash({
                  approvalId: approval.id,
                  candidateId: candidate.id,
                  candidateVersion: candidate.version,
                  candidateValueHash: candidate.normalizedValueHash,
                  requiredPermission: candidate.requiredPermission,
                  grantedByUserId: grant.grantedByUserId,
                  grantedAt: grant.grantedAt.toISOString(),
                })
            )
              this.revisionConflict();
          }
          exactApprovals.set(candidate.id, approval);
        }

        const now = new Date();
        let approvalRequestsCreated = 0;
        let newlyApproved = 0;
        let alreadyApproved = 0;
        for (const ref of refs) {
          const candidate = candidatesById.get(ref.id)!;
          let approval = exactApprovals.get(candidate.id);
          if (approval?.state === "APPROVED") {
            alreadyApproved += 1;
            continue;
          }
          if (!approval) {
            approval = await tx.businessImportCandidateApproval.create({
              data: {
                tenantId: context.tenantId,
                sourceId: candidate.sourceId,
                importId,
                candidateId: candidate.id,
                candidateVersion: candidate.version,
                candidateValueHash: candidate.normalizedValueHash,
                requiresApproval: true,
                requiredPermission: candidate.requiredPermission,
                riskReason: candidate.risk,
                state: "APPROVED",
                requestedByUserId: context.userId,
                decidedByUserId: context.userId,
                decidedAt: now,
              },
              include: { grants: true },
            });
            approvalRequestsCreated += 1;
          } else {
            const updated = await tx.businessImportCandidateApproval.updateMany({
              where: {
                id: approval.id,
                tenantId: context.tenantId,
                state: "PENDING",
                candidateVersion: candidate.version,
                candidateValueHash: candidate.normalizedValueHash,
                etag: approval.etag,
              },
              data: {
                state: "APPROVED",
                decidedByUserId: context.userId,
                decisionReason: null,
                decidedAt: now,
                etag: { increment: 1 },
              },
            });
            if (updated.count !== 1) this.revisionConflict();
          }
          await tx.businessImportApprovalGrant.create({
            data: {
              tenantId: context.tenantId,
              sourceId: candidate.sourceId,
              importId,
              candidateId: candidate.id,
              candidateVersion: candidate.version,
              candidateValueHash: candidate.normalizedValueHash,
              requiredPermission: candidate.requiredPermission,
              approvalId: approval.id,
              grantedByUserId: context.userId,
              grantedAt: now,
              decisionHash: businessImportManifestHash({
                approvalId: approval.id,
                candidateId: candidate.id,
                candidateVersion: candidate.version,
                candidateValueHash: candidate.normalizedValueHash,
                requiredPermission: candidate.requiredPermission,
                grantedByUserId: context.userId,
                grantedAt: now.toISOString(),
              }),
            },
          });
          const candidateUpdated = await tx.businessImportCandidate.updateMany({
            where: {
              id: candidate.id,
              tenantId: context.tenantId,
              version: candidate.version,
              normalizedValueHash: candidate.normalizedValueHash,
              etag: candidate.etag,
              decision: candidate.decision,
            },
            data: {
              decision: "ACCEPTED",
              decidedByUserId: context.userId,
              decidedAt: now,
              etag: { increment: 1 },
            },
          });
          if (candidateUpdated.count !== 1) this.revisionConflict();
          newlyApproved += 1;
        }

        if (newlyApproved > 0) {
          const nextImportState = await this.reviewState(tx, context.tenantId, importId);
          const importUpdated = await tx.businessImport.updateMany({
            where: { id: importId, tenantId: context.tenantId, etag: importRecord.etag },
            data: { state: nextImportState, etag: { increment: 1 } },
          });
          if (importUpdated.count !== 1) this.revisionConflict();
          await tx.auditLog.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: "business_import.approvals_bulk_approved",
              entityType: "business_import",
              entityId: importId,
              payload: {
                selected: refs.length,
                newlyApproved,
                approvalRequestsCreated,
                alreadyApproved,
              },
            },
          });
        }
        return {
          httpStatus: HttpStatus.OK,
          responseBody: {
            importId,
            candidateIds: refs.map((item) => item.id),
            summary: {
              selected: refs.length,
              newlyApproved,
              approvalRequestsCreated,
              alreadyApproved,
            },
          },
          responseRef: importId,
        };
      },
    );
    return {
      ...(await this.approvalMutationView(
        context,
        outcome.responseBody.importId,
        outcome.responseBody.candidateIds,
      )),
      summary: outcome.responseBody.summary,
    };
  }

  private async approvalMutationView(
    context: RequestContext,
    importId: string,
    candidateIds: string[],
  ) {
    const [importView, candidates] = await Promise.all([
      this.views.get(context, importId),
      this.views.getCandidates(context, importId, candidateIds),
    ]);
    return {
      import: importView,
      candidates,
    };
  }

  private bulkApprovalRefs(input: BusinessImportBulkApprovalRequest) {
    if (
      !Array.isArray(input.candidates) ||
      input.candidates.length < 1 ||
      input.candidates.length > MAX_BULK_APPROVAL_CANDIDATES ||
      new Set(input.candidates.map((candidate) => candidate.id)).size !== input.candidates.length ||
      input.candidates.some(
        (candidate) =>
          typeof candidate.id !== "string" ||
          !candidate.id ||
          candidate.id.length > 200 ||
          !Number.isInteger(candidate.version) ||
          candidate.version < 1 ||
          typeof candidate.etag !== "string" ||
          candidate.etag.trim().length < 8 ||
          candidate.etag.length > 200,
      )
    ) {
      throw businessImportError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "BUSINESS_IMPORT_APPROVAL_SELECTION_INVALID",
        `Select between 1 and ${MAX_BULK_APPROVAL_CANDIDATES} distinct candidate versions.`,
      );
    }
    return [...input.candidates].sort((left, right) => left.id.localeCompare(right.id));
  }

  private async loadCandidate(context: RequestContext, importId: string, candidateId: string) {
    return this.views.getCandidate(context, importId, candidateId);
  }

  private async lockImport(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    importId: string,
    approver = false,
  ) {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
    });
    const allowed = approver ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "MANAGER"];
    if (!membership || !allowed.includes(membership.role)) this.permissionDenied();
    await tx.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(
        ${`business-information-state:${context.tenantId}`},
        0
      ))) AS business_information_state_lock
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "BusinessImport"
      WHERE "id" = ${importId} AND "tenantId" = ${context.tenantId}
      FOR UPDATE
    `);
    const value = await tx.businessImport.findFirst({
      where: { id: importId, tenantId: context.tenantId },
    });
    if (!value) this.notFound();
    if (!["READY_FOR_REVIEW", "AWAITING_APPROVAL", "PARTIALLY_APPLIED"].includes(value.state)) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_STATE_CONFLICT",
        "The import is not ready for review.",
      );
    }
    return value;
  }

  private async invalidateApprovals(
    tx: Prisma.TransactionClient,
    candidate: { tenantId: string; id: string; version: number; normalizedValueHash: string },
    actorUserId: string,
    now: Date,
    reason = "CANDIDATE_CHANGED",
    invalidateDecided = true,
  ) {
    await tx.businessImportCandidateApproval.updateMany({
      where: {
        tenantId: candidate.tenantId,
        candidateId: candidate.id,
        candidateVersion: candidate.version,
        candidateValueHash: candidate.normalizedValueHash,
        state: "PENDING",
      },
      data: {
        state: "INVALIDATED",
        decidedByUserId: actorUserId,
        decisionReason: reason,
        decidedAt: now,
        invalidatedAt: now,
        etag: { increment: 1 },
      },
    });
    if (invalidateDecided) {
      await tx.businessImportCandidateApproval.updateMany({
        where: {
          tenantId: candidate.tenantId,
          candidateId: candidate.id,
          candidateVersion: candidate.version,
          candidateValueHash: candidate.normalizedValueHash,
          state: { in: ["APPROVED", "REJECTED"] },
        },
        data: {
          state: "INVALIDATED",
          invalidatedAt: now,
          etag: { increment: 1 },
        },
      });
    }
  }

  private async reviewState(
    tx: Prisma.TransactionClient,
    tenantId: string,
    importId: string,
  ): Promise<"READY_FOR_REVIEW" | "AWAITING_APPROVAL" | "PARTIALLY_APPLIED"> {
    const pendingApprovals = await tx.businessImportCandidateApproval.count({
      where: {
        tenantId,
        importId,
        state: "PENDING",
        candidate: { decision: "SUBMITTED_FOR_APPROVAL" },
      },
    });
    if (pendingApprovals > 0) return "AWAITING_APPROVAL";
    const appliedCandidates = await tx.businessImportCandidate.count({
      where: { tenantId, importId, decision: "APPLIED" },
    });
    return appliedCandidates > 0 ? "PARTIALLY_APPLIED" : "READY_FOR_REVIEW";
  }

  private assertDecisionAllowed(
    action: string,
    risk: string,
    currentDecision: string,
    decision: "ACCEPTED" | "REJECTED",
  ) {
    if (["APPLIED", "STALE"].includes(currentDecision)) this.candidateDecisionFinal();
    if (decision === "REJECTED") return;
    if (["INVALID", "MISSING", "CONFLICT"].includes(action) || risk === "PROHIBITED") {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_CANDIDATE_NOT_APPLYABLE",
        "This candidate cannot be accepted.",
      );
    }
  }

  private assertEditAllowed(action: string, risk: string, currentDecision: string) {
    if (["APPLIED", "STALE"].includes(currentDecision)) this.candidateDecisionFinal();
    if (
      !["ADD", "UPDATE", "LINK", "UNCHANGED", "INVALID", "CONFLICT"].includes(action) ||
      risk === "PROHIBITED"
    ) {
      throw businessImportError(
        HttpStatus.CONFLICT,
        "BUSINESS_IMPORT_CANDIDATE_NOT_EDITABLE",
        "This candidate cannot be corrected in the review editor.",
      );
    }
  }

  private candidateDecisionFinal(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_CANDIDATE_DECISION_FINAL",
      "This candidate can no longer be changed.",
    );
  }

  private editedCandidateStillConflicted(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_CANDIDATE_STILL_CONFLICTED",
      "The edited service still matches more than one existing service.",
    );
  }

  private assertEditor(context: RequestContext) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(context.role)) this.permissionDenied();
  }

  private assertApprover(context: RequestContext) {
    if (!["OWNER", "ADMIN"].includes(context.role)) this.permissionDenied();
  }

  private async assertCurrentApprover(context: RequestContext) {
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
      select: { role: true },
    });
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) this.permissionDenied();
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

  private revisionConflict(): never {
    throw businessImportError(
      HttpStatus.PRECONDITION_FAILED,
      "BUSINESS_IMPORT_REVISION_CONFLICT",
      "The candidate changed after it was loaded.",
    );
  }
}
