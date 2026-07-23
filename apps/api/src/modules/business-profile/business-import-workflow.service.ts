import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type { BusinessImportCancelView, BusinessImportRetryRequest } from "@leadvirt/types";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeV2IdempotencyService } from "../knowledge/knowledge-v2-idempotency.service.js";
import {
  assertBusinessImportIfMatch,
  businessImportEtag,
  businessImportError,
} from "./business-import-http.js";
import { lockAndExtendRetainedBusinessImportObjects } from "./business-import-object-lifecycle.js";
import { BusinessImportQueueService } from "./business-import-queue.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";

const CANCELLABLE_STATES = [
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
] as const;

const CAPACITY_STATES = [
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "PARSING",
  "MAPPING_REQUIRED",
  "EXTRACTING",
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "APPLYING",
  "PROJECTING",
  "FAILED_RETRYABLE",
] as const;

@Injectable()
export class BusinessImportWorkflowService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeV2IdempotencyService)
    private readonly idempotency: KnowledgeV2IdempotencyService,
    @Inject(BusinessImportQueueService) private readonly queue: BusinessImportQueueService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtimeService: BusinessImportRuntimeService,
    @Inject(BusinessImportViewService) private readonly views: BusinessImportViewService,
  ) {}

  async finalize(context: RequestContext, importId: string, idempotencyKey: string) {
    this.assertEditor(context);
    this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<{ importId: string; eventId: string }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/finalize`,
        key: idempotencyKey,
        request: { importId },
      },
      async (tx) => {
        await this.assertCurrentEditor(tx, context);
        const value = await tx.businessImport.findFirst({
          where: { id: importId, tenantId: context.tenantId },
        });
        if (!value) this.notFound();
        if (value.state !== "UPLOADED") {
          throw businessImportError(
            HttpStatus.CONFLICT,
            "BUSINESS_IMPORT_STATE_CONFLICT",
            "Only a completed upload can be finalized.",
          );
        }
        if (
          !value.stagingObjectKey ||
          !value.stagingEncryptionKeyRef ||
          !value.stagingObjectLedgerId ||
          value.stagingObjectKind !== "STAGING"
        ) {
          throw businessImportError(
            HttpStatus.CONFLICT,
            "BUSINESS_IMPORT_UPLOAD_INCOMPLETE",
            "The uploaded file is not durably registered.",
          );
        }
        const now = new Date();
        const updated = await tx.businessImport.updateMany({
          where: { id: value.id, tenantId: context.tenantId, state: "UPLOADED", etag: value.etag },
          data: {
            state: "SCANNING",
            finalizedAt: now,
            failureCode: null,
            failureStage: null,
            retryable: false,
            etag: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stateConflict();
        const event = await this.queue.createParseEvent(tx, {
          tenantId: value.tenantId,
          sourceId: value.sourceId,
          importId: value.id,
          generation: value.generation,
          operation: "PARSE",
          requestedByUserId: context.userId,
          requestedAt: now.toISOString(),
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.finalized",
            entityType: "business_import",
            entityId: value.id,
            payload: { generation: value.generation, eventId: event.id },
          },
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: { importId: value.id, eventId: event.id },
          responseRef: value.id,
        };
      },
    );
    this.queue.dispatch(outcome.responseBody.eventId);
    return this.views.get(context, outcome.responseBody.importId);
  }

  async retry(
    context: RequestContext,
    importId: string,
    input: BusinessImportRetryRequest,
    ifMatch: string | string[] | undefined,
    idempotencyKey: string,
  ) {
    this.assertEditor(context);
    const runtime = this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<{ importId: string; eventId: string }>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/retry`,
        key: idempotencyKey,
        request: { importId, input, ifMatch },
      },
      async (tx) => {
        await this.assertCurrentEditor(tx, context);
        await tx.$queryRaw(Prisma.sql`
          SELECT TRUE AS "locked"
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(
            ${`business-information-state:${context.tenantId}`},
            0
          ))) AS business_information_state_lock
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "BusinessImport"
          WHERE "tenantId" = ${context.tenantId} AND "id" = ${importId}
          FOR UPDATE
        `);
        const value = await tx.businessImport.findFirst({
          where: { id: importId, tenantId: context.tenantId },
          include: {
            artifact: { include: { objectLedger: true } },
            mappings: {
              where: {
                confirmedAt: { not: null },
                targetCategory: "OFFERINGS",
                tableKey: "csv:services",
              },
              orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
              take: 1,
            },
          },
        });
        if (!value) this.notFound();
        assertBusinessImportIfMatch(ifMatch, businessImportEtag(value.id, value.etag));
        if (
          value.state !== "FAILED_RETRYABLE" ||
          !value.retryable ||
          input.generation !== value.generation
        ) {
          this.stateConflict();
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "BusinessImportSource"
          WHERE "tenantId" = ${context.tenantId} AND "id" = ${value.sourceId}
          FOR UPDATE
        `);
        const source = await tx.businessImportSource.findFirst({
          where: { tenantId: context.tenantId, id: value.sourceId },
          select: { status: true },
        });
        if (!source || source.status !== "ACTIVE") this.stateConflict();
        const activeImports = await tx.businessImport.count({
          where: {
            tenantId: context.tenantId,
            id: { not: value.id },
            state: { in: [...CAPACITY_STATES] },
          },
        });
        if (activeImports >= runtime.maxPendingPerTenant) {
          throw businessImportError(
            HttpStatus.TOO_MANY_REQUESTS,
            "BUSINESS_IMPORT_PENDING_QUOTA_EXCEEDED",
            "The workspace already has the maximum number of active imports.",
            { retryable: true },
          );
        }
        const mappedRetryCandidate =
          !value.stagingObjectKey &&
          !value.stagingEncryptionKeyRef &&
          !value.stagingObjectLedgerId &&
          Boolean(value.artifactId) &&
          Boolean(value.artifactSha256) &&
          value.mappings.length === 1;
        const initialRetry =
          Boolean(value.stagingObjectKey) &&
          Boolean(value.stagingEncryptionKeyRef) &&
          Boolean(value.stagingObjectLedgerId) &&
          value.stagingObjectKind === "STAGING";
        const now = new Date();
        if (!mappedRetryCandidate && !initialRetry) this.stateConflict();
        if (mappedRetryCandidate) {
          const artifact = value.artifact;
          if (
            !artifact ||
            artifact.id !== value.artifactId ||
            artifact.sourceId !== value.sourceId ||
            artifact.sha256 !== value.artifactSha256 ||
            artifact.byteSize !== value.expectedByteSize ||
            artifact.malwareStatus !== "CLEAN" ||
            artifact.mimeValidationStatus !== "VALID" ||
            artifact.objectKind !== "RAW_ARTIFACT" ||
            artifact.objectLedger.objectKind !== "RAW_ARTIFACT" ||
            artifact.objectLedger.objectStorageKey !== artifact.objectStorageKey ||
            artifact.objectLedger.encryptionKeyRef !== artifact.encryptionKeyRef ||
            artifact.objectLedger.retentionClass !== "BUSINESS_IMPORT_RAW"
          ) {
            this.stateConflict();
          }
          const retained = await lockAndExtendRetainedBusinessImportObjects(tx, {
            tenantId: context.tenantId,
            objects: [
              {
                ledgerId: artifact.objectLedger.id,
                objectKind: "RAW_ARTIFACT",
                objectStorageKey: artifact.objectStorageKey,
                encryptionKeyRef: artifact.encryptionKeyRef,
                retentionClass: "BUSINESS_IMPORT_RAW",
              },
            ],
            now,
          });
          if (!retained) this.stateConflict();
        }
        const mappedRetry = mappedRetryCandidate;
        const nextGeneration = value.generation + 1;
        const updated = await tx.businessImport.updateMany({
          where: {
            id: value.id,
            tenantId: context.tenantId,
            state: "FAILED_RETRYABLE",
            generation: value.generation,
            etag: value.etag,
          },
          data: {
            generation: nextGeneration,
            state: mappedRetry ? "PARSING" : "SCANNING",
            parsedRevisionId: null,
            parsedManifestObjectKey: null,
            parsedManifestEncryptionKeyRef: null,
            parsedManifestObjectLedgerId: null,
            parsedManifestObjectKind: null,
            parsedManifestHash: null,
            parserVersion: null,
            ocrVersion: null,
            mapperVersion: null,
            modelVersion: null,
            promptVersion: null,
            failureCode: null,
            failureStage: null,
            retryable: false,
            finalizedAt: now,
            etag: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stateConflict();
        const event = await this.queue.createParseEvent(tx, {
          tenantId: value.tenantId,
          sourceId: value.sourceId,
          importId: value.id,
          generation: nextGeneration,
          operation: "PARSE",
          requestedByUserId: context.userId,
          requestedAt: now.toISOString(),
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.retried",
            entityType: "business_import",
            entityId: value.id,
            payload: {
              previousGeneration: value.generation,
              generation: nextGeneration,
              eventId: event.id,
            },
          },
        });
        return {
          httpStatus: HttpStatus.ACCEPTED,
          responseBody: { importId: value.id, eventId: event.id },
          responseRef: value.id,
        };
      },
    );
    this.queue.dispatch(outcome.responseBody.eventId);
    return this.views.get(context, outcome.responseBody.importId);
  }

  async cancel(
    context: RequestContext,
    importId: string,
    ifMatch: string | string[] | undefined,
    idempotencyKey: string,
  ): Promise<BusinessImportCancelView> {
    this.assertEditor(context);
    this.runtimeService.runtime();
    const outcome = await this.idempotency.execute<BusinessImportCancelView>(
      {
        tenantId: context.tenantId,
        endpoint: `POST:/business-profile/imports/${importId}/cancel`,
        key: idempotencyKey,
        request: { importId, ifMatch },
      },
      async (tx) => {
        await this.assertCurrentEditor(tx, context);
        const value = await tx.businessImport.findFirst({
          where: { id: importId, tenantId: context.tenantId },
        });
        if (!value) this.notFound();
        assertBusinessImportIfMatch(ifMatch, businessImportEtag(value.id, value.etag));
        if (!CANCELLABLE_STATES.includes(value.state as (typeof CANCELLABLE_STATES)[number])) {
          this.stateConflict();
        }
        const now = new Date();
        const updated = await tx.businessImport.updateMany({
          where: {
            id: value.id,
            tenantId: context.tenantId,
            generation: value.generation,
            etag: value.etag,
            state: { in: [...CANCELLABLE_STATES] },
          },
          data: {
            generation: { increment: 1 },
            state: "CANCELLED",
            ...(value.stagingObjectLedgerId
              ? {
                  stagingObjectKey: null,
                  stagingEncryptionKeyRef: null,
                  stagingObjectLedgerId: null,
                  stagingObjectKind: null,
                }
              : {}),
            cancelledAt: now,
            cancelledByUserId: context.userId,
            retryable: false,
            etag: { increment: 1 },
          },
        });
        if (updated.count !== 1) this.stateConflict();
        await tx.businessImportQuotaReservation.updateMany({
          where: { tenantId: context.tenantId, importId: value.id, status: "RESERVED" },
          data: { status: "RELEASED", releasedAt: now },
        });
        if (
          value.stagingObjectLedgerId &&
          value.stagingObjectKey &&
          value.stagingEncryptionKeyRef
        ) {
          await tx.businessImportObjectLedger.updateMany({
            where: {
              id: value.stagingObjectLedgerId,
              tenantId: context.tenantId,
              objectKind: "STAGING",
              objectStorageKey: value.stagingObjectKey,
              encryptionKeyRef: value.stagingEncryptionKeyRef,
              retentionClass: "BUSINESS_IMPORT_STAGING",
              legalHold: false,
              deletionState: "RETAINED",
            },
            data: {
              deletionState: "TOMBSTONED",
              tombstoneReason: "IMPORT_CANCELLED",
              tombstonedAt: now,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "business_import.cancelled",
            entityType: "business_import",
            entityId: value.id,
            payload: {
              cancelledGeneration: value.generation,
              nextGeneration: value.generation + 1,
            },
          },
        });
        return {
          httpStatus: HttpStatus.OK,
          responseBody: { importId: value.id, state: "CANCELLED", cancelledAt: now.toISOString() },
          responseRef: value.id,
        };
      },
    );
    return outcome.responseBody;
  }

  private assertEditor(context: RequestContext) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(context.role)) this.permissionDenied();
  }

  private async assertCurrentEditor(tx: Prisma.TransactionClient, context: RequestContext) {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
    });
    if (!membership || !["OWNER", "ADMIN", "MANAGER"].includes(membership.role)) {
      this.permissionDenied();
    }
  }

  private permissionDenied(): never {
    throw businessImportError(
      HttpStatus.FORBIDDEN,
      "BUSINESS_IMPORT_PERMISSION_DENIED",
      "Only an owner, administrator, or manager can change an import.",
    );
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }

  private stateConflict(): never {
    throw businessImportError(
      HttpStatus.CONFLICT,
      "BUSINESS_IMPORT_STATE_CONFLICT",
      "The import is not in a state that allows this action.",
    );
  }
}
