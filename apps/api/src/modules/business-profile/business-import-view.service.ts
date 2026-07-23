import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  businessImportEvidenceRecordHash,
  sortedBusinessImportFieldProvenance,
} from "@leadvirt/business-import";
import { Prisma, type BusinessImportState } from "@leadvirt/db";
import { KnowledgeObjectStoreError } from "@leadvirt/knowledge";
import type {
  BusinessImportAllowedAction,
  BusinessImportCandidatePage,
  BusinessImportCandidateView,
  BusinessImportDiagnosticView,
  BusinessImportListQuery,
  BusinessImportPage,
  BusinessImportView,
  BusinessOfferingPriceType,
  BusinessImportOfferingValue,
} from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  businessImportCandidateEtag,
  businessImportEtag,
  businessImportError,
  decodeBusinessImportCursor,
  encodeBusinessImportCursor,
} from "./business-import-http.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";

type ImportRecord = Prisma.BusinessImportGetPayload<{
  include: {
    source: true;
    applications: { include: { projectionReceipt: true }; orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;

type CandidateRecord = Prisma.BusinessImportCandidateGetPayload<{
  include: {
    import: { select: { format: true; state: true } };
    targetOffering: {
      include: {
        prices: { orderBy: { createdAt: "desc" }; take: 1 };
        duration: true;
        sourceBindings: true;
      };
    };
    approvals: { orderBy: { createdAt: "desc" } };
    approvalGrants: { orderBy: { createdAt: "desc" } };
  };
}>;

type CandidateEvidenceRecord = Prisma.BusinessImportCandidateEvidenceGetPayload<{
  include: { excerptObjectLedger: true };
}>;

type CandidateEvidenceValue =
  | {
      row: CandidateEvidenceRecord;
      availability: "AVAILABLE";
      sourceValue: string;
    }
  | {
      row: CandidateEvidenceRecord;
      availability: "EXPIRED" | "UNAVAILABLE" | "CORRUPT";
      sourceValue: null;
    };

async function mapConcurrent<T, U>(values: T[], limit: number, mapper: (value: T) => Promise<U>) {
  const output = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        output[index] = await mapper(values[index]!);
      }
    }),
  );
  return output;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.slice(0, maximum) : null;
}

function stringArray(value: unknown, maximum = 100) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, maximum)
    : [];
}

function diagnosticArray(value: unknown): BusinessImportDiagnosticView[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (typeof entry === "string") {
      return [
        { severity: "WARNING" as const, code: entry.slice(0, 160), message: entry.slice(0, 500) },
      ];
    }
    const item = record(entry);
    const code = text(item.code, 160);
    if (!code) return [];
    const severity = item.severity === "ERROR" ? "ERROR" : "WARNING";
    return [
      {
        severity,
        code,
        message: text(item.message, 500) ?? code,
        ...(typeof item.row === "number" ? { row: item.row } : {}),
        ...(typeof item.column === "number" ? { column: item.column } : {}),
        ...(typeof item.field === "string" ? { field: item.field.slice(0, 160) } : {}),
      },
    ];
  });
}

function offeringValue(value: unknown): BusinessImportOfferingValue {
  const source = record(value);
  const priceValue = record(source.price);
  const durationValue = record(source.duration);
  const priceType = ["FIXED", "FROM", "RANGE", "FREE", "ON_REQUEST"].includes(
    String(priceValue.type),
  )
    ? (priceValue.type as BusinessOfferingPriceType)
    : null;
  const minimumMinutes = Number(durationValue.minimumMinutes);
  const maximumMinutes = Number(durationValue.maximumMinutes);
  return {
    ...(text(source.externalId, 200) ? { externalId: text(source.externalId, 200) } : {}),
    ...(text(source.category, 160) ? { category: text(source.category, 160) } : {}),
    name: text(source.name, 160) ?? "",
    ...(text(source.description, 2_000) ? { description: text(source.description, 2_000) } : {}),
    price: priceType
      ? {
          type: priceType,
          amount: text(priceValue.amount, 64),
          from: text(priceValue.from, 64),
          to: text(priceValue.to, 64),
          currency: text(priceValue.currency, 3),
          unit: text(priceValue.unit, 80),
          taxNote: text(priceValue.taxNote, 500),
        }
      : null,
    duration:
      Number.isInteger(minimumMinutes) && minimumMinutes >= 0
        ? {
            minimumMinutes,
            maximumMinutes:
              Number.isInteger(maximumMinutes) && maximumMinutes >= 0 ? maximumMinutes : null,
          }
        : null,
    ...(text(source.locationExternalId, 200)
      ? { locationExternalId: text(source.locationExternalId, 200) }
      : {}),
    ...(text(source.bookingNotes, 1_000) ? { bookingNotes: text(source.bookingNotes, 1_000) } : {}),
    active: source.active !== false,
    validFrom: text(source.validFrom, 10),
    validUntil: text(source.validUntil, 10),
    language: text(source.language, 35),
  };
}

function currentOffering(candidate: CandidateRecord): BusinessImportOfferingValue | null {
  const offering = candidate.targetOffering;
  if (!offering) return null;
  const price = offering.prices[0];
  const binding = offering.sourceBindings.find((item) => item.sourceId === candidate.sourceId);
  return {
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
    bookingNotes: offering.bookingNotes,
    active: offering.active,
    validFrom: price?.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    validUntil: price?.effectiveUntil?.toISOString().slice(0, 10) ?? null,
    language: offering.locale,
  };
}

function summary(importRecord: ImportRecord) {
  const safe = record(importRecord.safeSummary);
  const counts = record(safe.counts);
  const number = (key: string) => {
    const value = counts[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  };
  return {
    counts: {
      total: number("total"),
      valid: number("valid"),
      invalid: number("invalid"),
      additions: number("additions"),
      updates: number("updates"),
      linked: number("linked"),
      unchanged: number("unchanged"),
      conflicts: number("conflicts"),
      pendingApproval: number("pendingApproval"),
      applied: number("applied"),
    },
    diagnostics: diagnosticArray(safe.diagnostics),
  };
}

function canEditBusinessImport(role: RequestContext["role"]) {
  return ["OWNER", "ADMIN", "MANAGER"].includes(role);
}

function allowedActions(state: BusinessImportState, canEdit: boolean) {
  const actions: BusinessImportAllowedAction[] = [];
  if (
    [
      "READY_FOR_REVIEW",
      "AWAITING_APPROVAL",
      "PARTIALLY_APPLIED",
      "CLOSED_WITH_REMAINDER",
    ].includes(state)
  ) {
    actions.push("REVIEW");
  }
  if (canEdit) {
    if (state === "CREATED") actions.push("UPLOAD");
    if (state === "UPLOADED") actions.push("FINALIZE");
    if (state === "MAPPING_REQUIRED") actions.push("MAP");
    if (["READY_FOR_REVIEW", "AWAITING_APPROVAL", "PARTIALLY_APPLIED"].includes(state)) {
      actions.push("REBASE", "APPLY");
    }
    if (state === "FAILED_RETRYABLE") actions.push("RETRY");
    if (
      [
        "CREATED",
        "UPLOADING",
        "UPLOADED",
        "SCANNING",
        "PARSING",
        "MAPPING_REQUIRED",
        "EXTRACTING",
        "READY_FOR_REVIEW",
        "AWAITING_APPROVAL",
        "FAILED_RETRYABLE",
      ].includes(state)
    ) {
      actions.push("CANCEL");
    }
  }
  return [...new Set(actions)];
}

@Injectable()
export class BusinessImportViewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
  ) {}

  async list(context: RequestContext, query: BusinessImportListQuery): Promise<BusinessImportPage> {
    this.runtimeService.runtime();
    const cursor = decodeBusinessImportCursor(query.cursor);
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const rows = await this.prisma.businessImport.findMany({
      where: {
        tenantId: context.tenantId,
        ...(query.sourceId ? { sourceId: query.sourceId } : {}),
        ...(query.state ? { state: query.state } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        source: true,
        applications: {
          include: { projectionReceipt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const canEdit = canEditBusinessImport(context.role);
    const items = await Promise.all(
      rows.slice(0, limit).map((row) => this.toView(row, false, canEdit)),
    );
    const last = rows.length > limit ? rows[limit - 1] : undefined;
    return {
      items,
      nextCursor: last
        ? encodeBusinessImportCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    };
  }

  async get(context: RequestContext, importId: string) {
    this.runtimeService.runtime();
    const row = await this.load(context.tenantId, importId);
    return this.toView(row, true, canEditBusinessImport(context.role));
  }

  async listCandidates(
    context: RequestContext,
    importId: string,
    query: { cursor?: string; limit?: number; action?: string; decision?: string; risk?: string },
  ): Promise<BusinessImportCandidatePage> {
    this.runtimeService.runtime();
    await this.assertImport(context.tenantId, importId);
    const cursor = decodeBusinessImportCursor(query.cursor);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = await this.prisma.businessImportCandidate.findMany({
      where: {
        tenantId: context.tenantId,
        importId,
        ...(query.action ? { action: query.action as never } : {}),
        ...(query.decision ? { decision: query.decision as never } : {}),
        ...(query.risk ? { risk: query.risk as never } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        import: { select: { format: true, state: true } },
        targetOffering: {
          include: {
            prices: { orderBy: { createdAt: "desc" }, take: 1 },
            duration: true,
            sourceBindings: true,
          },
        },
        approvals: { orderBy: { createdAt: "desc" } },
        approvalGrants: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const pageRows = rows.slice(0, limit);
    const evidence = await this.currentEvidence(pageRows);
    const canEdit = canEditBusinessImport(context.role);
    const items = pageRows.map((row) => this.toCandidate(row, canEdit, evidence.get(row.id) ?? []));
    const last = rows.length > limit ? rows[limit - 1] : undefined;
    return {
      items,
      nextCursor: last
        ? encodeBusinessImportCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    };
  }

  async getCandidate(context: RequestContext, importId: string, candidateId: string) {
    this.runtimeService.runtime();
    const value = await this.prisma.businessImportCandidate.findFirst({
      where: { id: candidateId, importId, tenantId: context.tenantId },
      include: {
        import: { select: { format: true, state: true } },
        targetOffering: {
          include: {
            prices: { orderBy: { createdAt: "desc" }, take: 1 },
            duration: true,
            sourceBindings: true,
          },
        },
        approvals: { orderBy: { createdAt: "desc" } },
        approvalGrants: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!value) this.notFound();
    const evidence = await this.currentEvidence([value]);
    return this.toCandidate(
      value,
      canEditBusinessImport(context.role),
      evidence.get(value.id) ?? [],
    );
  }

  async getCandidates(context: RequestContext, importId: string, candidateIds: string[]) {
    this.runtimeService.runtime();
    await this.assertImport(context.tenantId, importId);
    const ids = [...new Set(candidateIds)];
    const rows = await this.prisma.businessImportCandidate.findMany({
      where: { tenantId: context.tenantId, importId, id: { in: ids } },
      include: {
        import: { select: { format: true, state: true } },
        targetOffering: {
          include: {
            prices: { orderBy: { createdAt: "desc" }, take: 1 },
            duration: true,
            sourceBindings: true,
          },
        },
        approvals: { orderBy: { createdAt: "desc" } },
        approvalGrants: { orderBy: { createdAt: "desc" } },
      },
    });
    if (rows.length !== ids.length) this.notFound();
    const evidence = await this.currentEvidence(rows);
    const canEdit = canEditBusinessImport(context.role);
    const byId = new Map(
      rows.map((row) => [row.id, this.toCandidate(row, canEdit, evidence.get(row.id) ?? [])]),
    );
    return candidateIds.map((candidateId) => byId.get(candidateId)!);
  }

  private async load(tenantId: string, importId: string) {
    const row = await this.prisma.businessImport.findFirst({
      where: { id: importId, tenantId },
      include: {
        source: true,
        applications: {
          include: { projectionReceipt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!row) this.notFound();
    return row;
  }

  private async assertImport(tenantId: string, importId: string) {
    const row = await this.prisma.businessImport.findFirst({
      where: { id: importId, tenantId },
      select: { id: true },
    });
    if (!row) this.notFound();
  }

  private async toView(
    row: ImportRecord,
    exactCounts: boolean,
    canEdit: boolean,
  ): Promise<BusinessImportView> {
    const stored = summary(row);
    const candidates = exactCounts
      ? await this.prisma.businessImportCandidate.findMany({
          where: { tenantId: row.tenantId, importId: row.id },
          select: {
            id: true,
            action: true,
            decision: true,
            risk: true,
            requiresApproval: true,
            version: true,
            normalizedValueHash: true,
            staleAt: true,
            approvalGrants: {
              select: { id: true, candidateVersion: true, candidateValueHash: true },
            },
            revisions: {
              select: {
                version: true,
                normalizedValueHash: true,
                parsedRevisionId: true,
                importGeneration: true,
                artifactId: true,
                artifactSha256: true,
                parsedManifestHash: true,
                fieldProvenance: true,
              },
            },
            evidence: { include: { excerptObjectLedger: true } },
          },
        })
      : [];
    const counts = exactCounts
      ? {
          total: candidates.length,
          valid: candidates.filter((item) => item.action !== "INVALID").length,
          invalid: candidates.filter((item) => item.action === "INVALID").length,
          additions: candidates.filter((item) => item.action === "ADD").length,
          updates: candidates.filter((item) => item.action === "UPDATE").length,
          linked: candidates.filter((item) => item.action === "LINK").length,
          unchanged: candidates.filter((item) => item.action === "UNCHANGED").length,
          conflicts: candidates.filter((item) => item.action === "CONFLICT").length,
          pendingApproval: candidates.filter(
            (item) =>
              item.requiresApproval &&
              !item.approvalGrants.some(
                (grant) =>
                  grant.candidateVersion === item.version &&
                  grant.candidateValueHash === item.normalizedValueHash,
              ),
          ).length,
          applied: candidates.filter((item) => item.decision === "APPLIED").length,
        }
      : stored.counts;
    const selected = candidates.filter((item) =>
      ["ACCEPTED", "EDITED", "SUBMITTED_FOR_APPROVAL"].includes(item.decision),
    );
    const blockingConflicts = selected.filter((item) => item.action === "CONFLICT").length;
    const blockingInvalid = selected.filter((item) => item.action === "INVALID").length;
    const pendingApprovals = selected.filter(
      (item) =>
        item.requiresApproval &&
        !item.approvalGrants.some(
          (grant) =>
            grant.candidateVersion === item.version &&
            grant.candidateValueHash === item.normalizedValueHash,
        ),
    ).length;
    const staleCandidates = selected.filter((item) => item.staleAt !== null).length;
    const selectedChanges = selected.filter((item) =>
      ["ADD", "UPDATE", "LINK", "ARCHIVE"].includes(item.action),
    );
    const eligibleCount = selectedChanges.length;
    const now = new Date();
    const evidenceUnavailable = selectedChanges.some((candidate) => {
      const revision = candidate.revisions.find(
        (item) =>
          item.version === candidate.version &&
          item.normalizedValueHash === candidate.normalizedValueHash,
      );
      if (!revision) return true;
      let bindings: ReturnType<typeof sortedBusinessImportFieldProvenance>;
      try {
        bindings = sortedBusinessImportFieldProvenance(revision.fieldProvenance);
      } catch {
        return true;
      }
      return bindings.some((binding) => {
        if (binding.authority !== "IMPORTED") return false;
        const exact = candidate.evidence.find(
          (item) =>
            item.id === binding.evidenceId &&
            item.candidateVersion === candidate.version &&
            item.candidateValueHash === candidate.normalizedValueHash &&
            item.parsedRevisionId === revision.parsedRevisionId &&
            item.importGeneration === revision.importGeneration &&
            item.artifactId === revision.artifactId &&
            item.artifactSha256 === revision.artifactSha256 &&
            item.parsedManifestHash === revision.parsedManifestHash,
        );
        return (
          !exact ||
          exact.excerptObjectKind !== "EVIDENCE_EXCERPT" ||
          businessImportEvidenceRecordHash(exact) !== exact.evidenceRecordHash ||
          exact.excerptObjectLedger.deletionState !== "RETAINED" ||
          Boolean(
            exact.excerptObjectLedger.retainUntil && exact.excerptObjectLedger.retainUntil <= now,
          )
        );
      });
    });
    const reasonCodes = [
      ...(eligibleCount === 0 ? ["BUSINESS_IMPORT_NO_SELECTED_CHANGES"] : []),
      ...(blockingConflicts ? ["BUSINESS_IMPORT_CONFLICTS_BLOCK_APPLY"] : []),
      ...(blockingInvalid ? ["BUSINESS_IMPORT_INVALID_CANDIDATES"] : []),
      ...(pendingApprovals ? ["BUSINESS_IMPORT_APPROVAL_REQUIRED"] : []),
      ...(staleCandidates ? ["BUSINESS_IMPORT_CANDIDATES_STALE"] : []),
      ...(evidenceUnavailable ? ["BUSINESS_IMPORT_EVIDENCE_UNAVAILABLE"] : []),
    ];
    const application = row.applications[0];
    const receipt = application?.projectionReceipt;
    return {
      id: row.id,
      sourceId: row.sourceId,
      sourceName: row.source.displayName,
      format: row.format,
      state: row.state,
      generation: row.generation,
      etag: businessImportEtag(row.id, row.etag),
      originalFilename: row.originalFilename,
      schemaVersion: row.schemaVersion,
      baseBusinessInformationRevision: row.baseInformationRevision,
      counts,
      diagnostics: stored.diagnostics,
      projection: {
        businessInformationRevision: application?.resultingInformationRevision ?? null,
        knowledgeDraftGeneration: receipt?.knowledgeDraftGeneration ?? null,
        ready: Boolean(receipt),
        errorCode: row.state === "PROJECTION_DELAYED" ? row.failureCode : null,
      },
      allowedActions: allowedActions(row.state, canEdit),
      applyEligibility: {
        eligible: exactCounts && eligibleCount > 0 && reasonCodes.length === 0,
        selectedCandidates: selected.length,
        blockingConflicts,
        blockingInvalid,
        pendingApprovals,
        staleCandidates,
        reasonCodes,
      },
      retryable: row.retryable,
      errorCode: row.failureCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviewReadyAt: row.reviewReadyAt?.toISOString() ?? null,
      appliedAt: row.appliedAt?.toISOString() ?? null,
    };
  }

  private toCandidate(
    row: CandidateRecord,
    canEdit: boolean,
    evidence: CandidateEvidenceValue[],
  ): BusinessImportCandidateView {
    const currentApproval = row.approvals.find(
      (approval) =>
        approval.candidateVersion === row.version &&
        approval.candidateValueHash === row.normalizedValueHash,
    );
    return {
      id: row.id,
      importId: row.importId,
      action: row.action,
      decision: row.decision,
      riskLevel: row.risk,
      requiresApproval: row.requiresApproval,
      confidence: row.confidence,
      version: row.version,
      etag: businessImportCandidateEtag(row.id, row.etag),
      targetOfferingId: row.targetOfferingId,
      proposed: offeringValue(row.normalizedValue),
      current: currentOffering(row),
      diagnostics: [
        ...diagnosticArray(row.validationCodes),
        ...stringArray(row.reasonCodes).map((code) => ({
          severity: "WARNING" as const,
          code,
          message: code,
        })),
      ],
      evidence: evidence.map(({ row: item, availability, sourceValue }) => {
        const locator = record(item.locator);
        const common = {
          format: row.import.format,
          artifactId: item.artifactId,
          locator: {
            ...(typeof locator.row === "number" ? { row: locator.row } : {}),
            ...(typeof locator.column === "number" ? { column: locator.column } : {}),
            ...(typeof locator.header === "string" ? { header: locator.header.slice(0, 160) } : {}),
            ...(typeof locator.sheet === "string" ? { sheet: locator.sheet.slice(0, 160) } : {}),
            ...(typeof locator.range === "string" ? { range: locator.range.slice(0, 160) } : {}),
            ...(typeof locator.page === "number" ? { page: locator.page } : {}),
            ...(Array.isArray(locator.boundingBox)
              ? {
                  boundingBox: locator.boundingBox
                    .filter((value): value is number => typeof value === "number")
                    .slice(0, 4),
                }
              : {}),
          },
          expiresAt: item.excerptObjectLedger.retainUntil?.toISOString() ?? null,
        };
        return availability === "AVAILABLE"
          ? { ...common, availability, sourceValue }
          : { ...common, availability, sourceValue: null };
      }),
      approval: currentApproval
        ? {
            id: currentApproval.id,
            state: currentApproval.state,
            candidateVersion: currentApproval.candidateVersion,
            decidedAt: currentApproval.decidedAt?.toISOString() ?? null,
          }
        : null,
      selected: ["ACCEPTED", "EDITED", "SUBMITTED_FOR_APPROVAL"].includes(row.decision),
      canEditProposed:
        canEdit &&
        ["READY_FOR_REVIEW", "AWAITING_APPROVAL", "PARTIALLY_APPLIED"].includes(row.import.state) &&
        !["APPLIED", "STALE"].includes(row.decision) &&
        ["ADD", "UPDATE", "LINK", "UNCHANGED", "INVALID", "CONFLICT"].includes(row.action) &&
        row.risk !== "PROHIBITED",
      allowedDecisions:
        canEdit &&
        ["READY_FOR_REVIEW", "AWAITING_APPROVAL", "PARTIALLY_APPLIED"].includes(row.import.state) &&
        !["APPLIED", "STALE"].includes(row.decision)
          ? ["INVALID", "MISSING", "CONFLICT"].includes(row.action) || row.risk === "PROHIBITED"
            ? ["REJECTED"]
            : ["ACCEPTED", "REJECTED"]
          : [],
      appliedAt: row.appliedAt?.toISOString() ?? null,
    };
  }

  private async currentEvidence(rows: CandidateRecord[]) {
    const output = new Map<string, CandidateEvidenceValue[]>();
    if (rows.length === 0) return output;
    const evidence = await this.prisma.businessImportCandidateEvidence.findMany({
      where: {
        tenantId: rows[0]!.tenantId,
        importId: rows[0]!.importId,
        OR: rows.map((row) => ({
          candidateId: row.id,
          candidateVersion: row.version,
          candidateValueHash: row.normalizedValueHash,
        })),
      },
      include: { excerptObjectLedger: true },
      orderBy: [{ candidateId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const bounded: CandidateEvidenceRecord[] = [];
    const counts = new Map<string, number>();
    for (const item of evidence) {
      const count = counts.get(item.candidateId) ?? 0;
      if (count >= 40) continue;
      counts.set(item.candidateId, count + 1);
      bounded.push(item);
    }
    const values = await mapConcurrent(bounded, 8, async (item) => ({
      row: item,
      ...(await this.evidenceValue(item)),
    }));
    for (const value of values) {
      output.set(value.row.candidateId, [...(output.get(value.row.candidateId) ?? []), value]);
    }
    return output;
  }

  private async evidenceValue(item: CandidateEvidenceRecord) {
    const ledger = item.excerptObjectLedger;
    if (ledger.retainUntil && ledger.retainUntil.getTime() <= Date.now()) {
      return { availability: "EXPIRED" as const, sourceValue: null };
    }
    if (ledger.deletionState !== "RETAINED") {
      return { availability: "UNAVAILABLE" as const, sourceValue: null };
    }
    if (businessImportEvidenceRecordHash(item) !== item.evidenceRecordHash) {
      return { availability: "CORRUPT" as const, sourceValue: null };
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.runtimeService
        .runtime()
        .store.get(item.excerptObjectKey, item.excerptEncryptionKeyRef);
    } catch (error) {
      if (error instanceof KnowledgeObjectStoreError && error.code === "OBJECT_CORRUPT") {
        return { availability: "CORRUPT" as const, sourceValue: null };
      }
      return { availability: "UNAVAILABLE" as const, sourceValue: null };
    }
    const evidenceHash = createHash("sha256").update(bytes).digest("hex");
    if (evidenceHash !== item.sourceValueHash || evidenceHash !== item.excerptHash) {
      return { availability: "CORRUPT" as const, sourceValue: null };
    }
    try {
      return {
        availability: "AVAILABLE" as const,
        sourceValue: new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 8_192),
      };
    } catch {
      return { availability: "CORRUPT" as const, sourceValue: null };
    }
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }
}
