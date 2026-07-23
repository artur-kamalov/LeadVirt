import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  BusinessImportSourceView,
  KnowledgeV2DocumentView,
  KnowledgeV2JobView,
  KnowledgeV2OverviewView,
  KnowledgeV2RevisionPreviewView,
  KnowledgeV2RevisionView,
  KnowledgeV2SourceView,
  KnowledgeV2UpdateSourceRequest,
} from "@leadvirt/types";
import { loginAsCleanUser, type QaLocale } from "./helpers/auth";
import { sourceKnowledgeMessages } from "../../apps/web/src/i18n/knowledge-source-messages";
import { supportedLocales } from "../../apps/web/src/i18n/config";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";

interface CapturedMutation {
  method: string;
  pathname: string;
  body: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
}

interface SourceMockState {
  catalogSource: BusinessImportSourceView | null;
  source: KnowledgeV2SourceView | null;
  document: KnowledgeV2DocumentView;
  revision: KnowledgeV2RevisionView;
  mutations: CapturedMutation[];
  jobPolls: Record<string, number>;
  unavailable: boolean;
  conflictNextPause: boolean;
  conflictNextPatch: boolean;
  activeJobId: string | null;
  activeJobStatus: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | null;
  holdJobs: boolean;
  fileIntentCount: number;
  fileCompleteCount: number;
  fileFailure: "NONE" | "SCANNER_ONCE" | "EXPIRED_ONCE";
  fileUploads: Array<{
    url: string;
    authorization?: string;
    contentType?: string;
    cookie?: string;
    bytes: number;
  }>;
}

const scope = {
  usesTenantDefault: false,
  brandIds: [],
  locationIds: [],
  channelTypes: [],
  assistantIds: [],
  audiences: ["PUBLIC" as const],
  segments: [],
  locales: [],
};

function overview(state: SourceMockState): KnowledgeV2OverviewView {
  const currentJob =
    state.activeJobId && state.activeJobStatus
      ? job(state.activeJobId, state.jobPolls[state.activeJobId] ?? 0, state.activeJobStatus)
      : null;
  return {
    readiness: {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 4,
      candidateManifestHash: "a".repeat(64),
      activePublicationId: null,
      activePublicationSequence: null,
      status: "NEEDS_REVIEW",
      serving: {
        status: "NOT_READY",
        activePublicationId: null,
        activePublicationSequence: null,
        activeEtag: null,
        itemCounts: {
          documentRevisions: 0,
          factVersions: 0,
          guidanceRuleVersions: 0,
          sourcePermissionSnapshots: 0,
        },
        blockers: [],
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        capabilities: [],
      },
      draft: {
        status: "CHANGES_PENDING",
        candidateId: "workspace-v2",
        candidateVersion: 4,
        candidateManifestHash: "a".repeat(64),
        evaluationTestCaseSetHash: "d".repeat(64),
        itemCounts: {
          documentRevisions: 1,
          factVersions: 0,
          guidanceRuleVersions: 0,
          sourcePermissionSnapshots: 1,
        },
        blockers: [],
        warnings: [],
        latestJob: null,
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        capabilities: [],
      },
      capabilities: [],
      blockerCount: 0,
      warningCount: 0,
      needsReviewCount: 0,
      evaluatedAt: "2026-07-12T12:00:00.000Z",
    },
    activePublication: null,
    latestDraftPublication: null,
    counts: {
      sources: state.source ? 1 : 0,
      facts: 0,
      guidanceRules: 0,
      reviewItems: 0,
      failedJobs: state.activeJobStatus === "FAILED" ? 1 : 0,
    },
    recentJobs: currentJob ? [currentJob] : [],
    permissions: {
      canViewRestricted: true,
      canEdit: true,
      canManageSettings: true,
      canVerifyHighRisk: true,
      canPublish: true,
      canRollback: true,
    },
  };
}

function source(): KnowledgeV2SourceView {
  return {
    id: "source-site",
    kind: "WEBSITE",
    displayName: "Company website",
    externalRootKey: "website:opaque",
    canonicalUri: "https://example.com/",
    syncMode: "MANUAL",
    status: "READY",
    defaultScope: {
      ...scope,
      brandIds: ["brand-paris"],
      locationIds: ["location-paris"],
      channelTypes: ["WEBSITE"],
      assistantIds: ["assistant-sales"],
      segments: ["retail"],
      locales: ["en"],
    },
    defaultClassification: "PUBLIC",
    defaultLocale: "en",
    sourcePermissionVersion: 1,
    generation: 2,
    etag: '"source-etag-2"',
    lastAttemptAt: "2026-07-12T11:59:00.000Z",
    lastSuccessAt: "2026-07-12T12:00:00.000Z",
    sourceObservedAt: "2026-07-12T11:58:00.000Z",
    nextSyncAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    documentCount: 1,
    allowedActions: ["EDIT", "SYNC", "PAUSE", "DELETE"],
    createdAt: "2026-07-12T11:55:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    tombstonedAt: null,
    deletedAt: null,
  };
}

function catalogSource(): BusinessImportSourceView {
  return {
    id: "catalog-teplodom",
    displayName: "Teplodom services",
    status: "ACTIVE",
    latestImport: {
      id: "import-teplodom-v2",
      sourceId: "catalog-teplodom",
      sourceName: "Teplodom services",
      format: "CSV",
      state: "APPLIED",
      generation: 2,
      etag: '"business-import-teplodom-2"',
      originalFilename: "teplodom_services.csv",
      schemaVersion: "services-v1",
      baseBusinessInformationRevision: 1,
      counts: {
        total: 30,
        valid: 30,
        invalid: 0,
        additions: 30,
        updates: 0,
        linked: 0,
        unchanged: 0,
        conflicts: 0,
        pendingApproval: 0,
        applied: 30,
      },
      diagnostics: [],
      projection: {
        businessInformationRevision: 2,
        knowledgeDraftGeneration: 4,
        ready: true,
        errorCode: null,
      },
      allowedActions: [],
      applyEligibility: {
        eligible: false,
        selectedCandidates: 0,
        blockingConflicts: 0,
        blockingInvalid: 0,
        pendingApprovals: 0,
        staleCandidates: 0,
        reasonCodes: ["BUSINESS_IMPORT_NO_SELECTED_CHANGES"],
      },
      retryable: false,
      errorCode: null,
      createdAt: "2026-07-23T12:00:00.000Z",
      updatedAt: "2026-07-23T12:03:00.000Z",
      reviewReadyAt: "2026-07-23T12:01:00.000Z",
      appliedAt: "2026-07-23T12:03:00.000Z",
    },
    createdAt: "2026-07-23T12:00:00.000Z",
    updatedAt: "2026-07-23T12:03:00.000Z",
  };
}

function document(): KnowledgeV2DocumentView {
  return {
    id: "document-home",
    etag: '"document-etag-1"',
    sourceId: "source-site",
    externalKey: "https://example.com/",
    kind: "WEBSITE_PAGE",
    canonicalUri: "https://example.com/",
    title: "Home page",
    canonicalLocale: "en",
    translationGroup: null,
    scope,
    audiences: ["PUBLIC"],
    classification: "PUBLIC",
    permissionVersion: 1,
    currentDraftRevisionId: "revision-home-1",
    currentPublishedRevisionId: null,
    sourceCreatedAt: "2026-07-12T11:55:00.000Z",
    sourceUpdatedAt: "2026-07-12T11:58:00.000Z",
    sourceDeletedAt: null,
    status: "ACTIVE",
    deletionGeneration: 0,
    createdAt: "2026-07-12T11:59:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    tombstonedAt: null,
    deletedAt: null,
  };
}

function revision(): KnowledgeV2RevisionView {
  return {
    id: "revision-home-1",
    etag: '"revision-etag-1"',
    sourceId: "source-site",
    documentId: "document-home",
    revisionNumber: 1,
    contentHash: "content-hash-1",
    artifactId: "artifact-home-1",
    status: "READY",
    parserVersion: "website-parser-v1",
    ocrVersion: null,
    normalizerVersion: "normalizer-v1",
    extractorVersion: "extractor-v1",
    chunkerVersion: "chunker-v1",
    embeddingVersion: null,
    sparseIndexVersion: null,
    pipelineVersion: "website-v1",
    detectedLocale: "en",
    characterCount: 1240,
    tokenCount: 280,
    pageCount: 1,
    tableCount: 0,
    imageCount: 0,
    extractionCoverage: 1,
    parserQuality: { score: 1 },
    sourcePermissionFingerprint: "permission-fingerprint-1",
    scopeSnapshot: scope,
    effectiveFrom: null,
    effectiveUntil: null,
    staleAfter: null,
    supersedesRevisionId: null,
    generation: 1,
    allowedActions: ["PREVIEW", "EXCLUDE"],
    createdBy: null,
    createdAt: "2026-07-12T12:00:00.000Z",
    deletedAt: null,
  };
}

function preview(current: KnowledgeV2RevisionView): KnowledgeV2RevisionPreviewView {
  return {
    revision: current,
    elements: [
      {
        id: "element-title",
        documentId: "document-home",
        revisionId: current.id,
        kind: "TITLE",
        ordinal: 0,
        parentElementId: null,
        headingPath: ["Welcome"],
        pageNumber: 1,
        boundingBox: null,
        urlAnchor: null,
        sheetName: null,
        sheetRange: null,
        normalizedText: "Welcome <script>window.__knowledgeXss = true</script>",
        hasObjectReference: false,
        contentHash: "element-hash-1",
        parserConfidence: 1,
        locale: "en",
        classification: "PUBLIC",
      },
    ],
    chunks: [],
  };
}

function job(
  jobId: string,
  poll: number,
  forcedStatus?: SourceMockState["activeJobStatus"],
): KnowledgeV2JobView {
  const status = forcedStatus ?? (poll >= 2 ? "SUCCEEDED" : "RUNNING");
  const succeeded = status === "SUCCEEDED";
  return {
    id: jobId,
    stage: "CHUNKING",
    status: status ?? "RUNNING",
    progress: {
      completed: succeeded ? 1 : 0,
      total: 1,
      percent: succeeded ? 100 : 65,
      label: succeeded ? "Durable chunks prepared" : "Preparing durable chunks",
    },
    attempt: 1,
    maxAttempts: 5,
    resources: [{ type: "SOURCE", id: "source-site", label: "Company website" }],
    error:
      status === "FAILED"
        ? {
            code: "KNOWLEDGE_DEPENDENCY_SOURCE_FETCH_FAILED",
            message: "Knowledge processing did not complete.",
            retryable: false,
          }
        : null,
    createdAt: "2026-07-12T12:01:00.000Z",
    startedAt: "2026-07-12T12:01:01.000Z",
    nextAttemptAt: null,
    completedAt: succeeded ? "2026-07-12T12:01:03.000Z" : null,
  };
}

async function fulfill(
  route: Route,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
}

function mutation(request: ReturnType<Route["request"]>): CapturedMutation {
  let body: unknown = null;
  if (request.postData()) {
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
  }
  return {
    method: request.method(),
    pathname: new URL(request.url()).pathname,
    body,
    idempotencyKey: request.headers()["idempotency-key"],
    ifMatch: request.headers()["if-match"],
  };
}

async function installMocks(
  page: Page,
  options: {
    catalog?: boolean;
    empty?: boolean;
    unavailable?: boolean;
    conflictNextPause?: boolean;
    conflictNextPatch?: boolean;
    fileFailure?: SourceMockState["fileFailure"];
  } = {},
) {
  const state: SourceMockState = {
    catalogSource: options.catalog ? catalogSource() : null,
    source: options.empty ? null : source(),
    document: document(),
    revision: revision(),
    mutations: [],
    jobPolls: {},
    unavailable: options.unavailable ?? false,
    conflictNextPause: options.conflictNextPause ?? false,
    conflictNextPatch: options.conflictNextPatch ?? false,
    activeJobId: null,
    activeJobStatus: null,
    holdJobs: false,
    fileIntentCount: 0,
    fileCompleteCount: 0,
    fileFailure: options.fileFailure ?? "NONE",
    fileUploads: [],
  };

  await page.route("**/api/business-profile/imports/sources**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await fulfill(route, { error: { code: "HTTP_ERROR", message: "Method not allowed" } }, 405);
      return;
    }
    await fulfill(route, {
      data: {
        items: state.catalogSource ? [state.catalogSource] : [],
        nextCursor: null,
      },
    });
  });

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await fulfill(route, { data: overview(state) });
      return;
    }
    if (pathname === "/api/knowledge/v2/sources" && method === "GET") {
      await fulfill(route, {
        data: {
          items: state.source ? [state.source] : [],
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/sources" && method === "POST") {
      state.mutations.push(mutation(request));
      if (state.unavailable) {
        await fulfill(
          route,
          {
            error: {
              code: "KNOWLEDGE_DEPENDENCY_SOURCE_INGESTION_DISABLED",
              message: "Secure website ingestion is not configured.",
              retryable: false,
              requestId: "request-ingestion-disabled",
            },
          },
          503,
        );
        return;
      }
      state.source = source();
      state.source.status = "CONNECTING";
      state.source.etag = '"source-etag-1"';
      state.source.allowedActions = ["EDIT", "DELETE"];
      state.activeJobId = "job-import";
      state.activeJobStatus = "QUEUED";
      await fulfill(
        route,
        {
          data: {
            jobId: "job-import",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:01:00.000Z",
            resource: { type: "SOURCE", id: state.source.id },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/file-uploads/intents" && method === "POST") {
      state.mutations.push(mutation(request));
      state.fileIntentCount += 1;
      const body = request.postDataJSON() as {
        displayName: string;
        declaredMimeType: "text/plain" | "text/csv";
        byteSize: number;
      };
      const intentId = `file-intent-${state.fileIntentCount}`;
      await fulfill(
        route,
        {
          data: {
            id: intentId,
            uploadUrl: `${apiBase}/knowledge/v2/file-uploads/${intentId}/content`,
            method: "PUT",
            headers: {
              Authorization: `Bearer signed-${intentId}`,
              "Content-Type": body.declaredMimeType,
              "Content-Length": String(body.byteSize),
            },
            policy: {
              maxBytes: 10 * 1024 * 1024,
              expectedBytes: body.byteSize,
              allowedMimeTypes: ["text/plain", "text/csv"],
              expiresAt: "2026-07-12T12:10:00.000Z",
              oneTime: true,
            },
            idempotencyReplayed: false,
          },
        },
        201,
        { "cache-control": "no-store, private" },
      );
      return;
    }
    if (
      /^\/api\/knowledge\/v2\/file-uploads\/file-intent-\d+\/content$/u.test(pathname) &&
      method === "PUT"
    ) {
      state.fileUploads.push({
        url: request.url(),
        authorization: request.headers().authorization,
        contentType: request.headers()["content-type"],
        cookie: request.headers().cookie,
        bytes: request.postDataBuffer()?.byteLength ?? 0,
      });
      await fulfill(
        route,
        {
          data: {
            uploadIntentId: pathname.split("/").at(-2),
            status: "UPLOADED",
            uploadedAt: "2026-07-12T12:01:00.000Z",
          },
        },
        201,
      );
      return;
    }
    if (
      /^\/api\/knowledge\/v2\/file-uploads\/file-intent-\d+\/complete$/u.test(pathname) &&
      method === "POST"
    ) {
      state.mutations.push(mutation(request));
      state.fileCompleteCount += 1;
      if (state.fileFailure === "SCANNER_ONCE" && state.fileCompleteCount === 1) {
        await fulfill(
          route,
          {
            error: {
              code: "KNOWLEDGE_UPLOAD_SCANNER_UNAVAILABLE",
              message: "Scanner unavailable",
              retryable: true,
            },
          },
          503,
        );
        return;
      }
      if (state.fileFailure === "EXPIRED_ONCE" && state.fileCompleteCount === 1) {
        await fulfill(
          route,
          {
            error: {
              code: "KNOWLEDGE_UPLOAD_INTENT_EXPIRED",
              message: "Upload expired",
              retryable: false,
            },
          },
          410,
        );
        return;
      }
      state.source = source();
      state.source.kind = "FILE";
      state.source.displayName = "Service catalog";
      state.source.canonicalUri = null;
      state.source.status = "CONNECTING";
      state.source.documentCount = 0;
      state.source.lastSuccessAt = null;
      state.source.allowedActions = ["EDIT", "DELETE"];
      state.activeJobId = "job-file-import";
      state.activeJobStatus = "QUEUED";
      await fulfill(
        route,
        {
          data: {
            jobId: "job-file-import",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:01:00.000Z",
            resource: { type: "SOURCE", id: "source-site" },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/sources/source-site" && method === "PATCH") {
      state.mutations.push(mutation(request));
      if (state.conflictNextPatch) {
        state.conflictNextPatch = false;
        state.source!.displayName = "Server source title";
        state.source!.defaultLocale = "fr";
        state.source!.etag = '"source-etag-current"';
        await fulfill(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This source changed after it was loaded.",
              retryable: false,
              details: { currentEtag: state.source!.etag },
            },
          },
          412,
        );
        return;
      }
      const body = request.postDataJSON() as KnowledgeV2UpdateSourceRequest;
      const material =
        body.defaultScope !== undefined ||
        body.defaultClassification !== undefined ||
        body.defaultLocale !== undefined;
      if (body.displayName !== undefined) state.source!.displayName = body.displayName;
      if (body.defaultLocale !== undefined) state.source!.defaultLocale = body.defaultLocale;
      if (body.defaultClassification !== undefined) {
        state.source!.defaultClassification = body.defaultClassification;
      }
      if (body.syncMode !== undefined) state.source!.syncMode = body.syncMode;
      if (body.defaultScope !== undefined) {
        state.source!.defaultScope = body.defaultScope
          ? {
              usesTenantDefault: false,
              brandIds: [...(body.defaultScope.brandIds ?? [])],
              locationIds: [...(body.defaultScope.locationIds ?? [])],
              channelTypes: [...(body.defaultScope.channelTypes ?? [])],
              assistantIds: [...(body.defaultScope.assistantIds ?? [])],
              audiences: [...(body.defaultScope.audiences ?? [])],
              segments: [...(body.defaultScope.segments ?? [])],
              locales: [...(body.defaultScope.locales ?? [])],
            }
          : { ...scope, usesTenantDefault: true };
      }
      state.source!.etag = '"source-etag-settings"';
      if (material) {
        state.source!.status = "SYNCING";
        state.source!.generation += 1;
        state.source!.allowedActions = ["EDIT", "DELETE"];
      }
      await fulfill(route, {
        data: {
          resource: state.source,
          job: material
            ? {
                jobId: "job-settings",
                status: "QUEUED",
                acceptedAt: "2026-07-12T12:01:00.000Z",
                resource: { type: "SOURCE", id: "source-site" },
                idempotencyReplayed: false,
              }
            : null,
          idempotencyReplayed: false,
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/sources/source-site" && method === "GET") {
      if (!state.source) {
        await fulfill(
          route,
          { error: { code: "KNOWLEDGE_CONFLICT_RESOURCE_NOT_FOUND", message: "Not found" } },
          404,
        );
        return;
      }
      await fulfill(route, { data: state.source }, 200, { etag: state.source.etag });
      return;
    }
    if (pathname === "/api/knowledge/v2/sources/source-site/sync" && method === "POST") {
      state.mutations.push(mutation(request));
      state.source!.status = "SYNCING";
      state.source!.etag = '"source-etag-3"';
      state.source!.generation += 1;
      state.source!.allowedActions = ["EDIT", "DELETE"];
      state.activeJobId = "job-sync";
      state.activeJobStatus = "QUEUED";
      await fulfill(
        route,
        {
          data: {
            jobId: "job-sync",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:02:00.000Z",
            resource: { type: "SOURCE", id: "source-site" },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/sources/source-site/pause" && method === "POST") {
      state.mutations.push(mutation(request));
      if (state.conflictNextPause) {
        state.conflictNextPause = false;
        state.source!.etag = '"source-etag-current"';
        await fulfill(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This source changed after it was loaded.",
              retryable: false,
              details: { currentEtag: state.source!.etag },
            },
          },
          412,
        );
        return;
      }
      state.source!.status = "PAUSED";
      state.source!.etag = '"source-etag-paused"';
      state.source!.allowedActions = ["EDIT", "RESUME", "DELETE"];
      await fulfill(route, { data: { resource: state.source, idempotencyReplayed: false } });
      return;
    }
    if (pathname === "/api/knowledge/v2/sources/source-site/resume" && method === "POST") {
      state.mutations.push(mutation(request));
      state.source!.status = "SYNCING";
      state.source!.etag = '"source-etag-resumed"';
      state.source!.generation += 1;
      state.source!.allowedActions = ["EDIT", "DELETE"];
      state.activeJobId = "job-resume";
      state.activeJobStatus = "QUEUED";
      await fulfill(
        route,
        {
          data: {
            jobId: "job-resume",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:03:00.000Z",
            resource: { type: "SOURCE", id: "source-site" },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/sources/source-site" && method === "DELETE") {
      state.mutations.push(mutation(request));
      state.source!.status = "DELETING";
      state.source!.etag = '"source-etag-deleting"';
      state.source!.allowedActions = [];
      state.activeJobId = "job-delete";
      state.activeJobStatus = "QUEUED";
      await fulfill(
        route,
        {
          data: {
            jobId: "job-delete",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:04:00.000Z",
            resource: { type: "SOURCE", id: "source-site" },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/documents" && method === "GET") {
      await fulfill(route, {
        data: {
          items: state.source ? [state.document] : [],
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/documents/document-home/revisions" && method === "GET") {
      await fulfill(route, {
        data: {
          items: [state.revision],
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/revisions/revision-home-1/preview" && method === "GET") {
      await fulfill(route, { data: preview(state.revision) }, 200, { etag: state.revision.etag });
      return;
    }
    if (pathname === "/api/knowledge/v2/revisions/revision-home-1/exclude" && method === "POST") {
      state.mutations.push(mutation(request));
      state.revision.status = "REJECTED";
      state.revision.etag = '"revision-etag-2"';
      state.revision.allowedActions = ["PREVIEW"];
      state.source!.status = "SYNCING";
      state.source!.etag = '"source-etag-reconcile"';
      state.source!.allowedActions = ["EDIT", "DELETE"];
      state.activeJobId = "job-exclude";
      state.activeJobStatus = "QUEUED";
      await fulfill(
        route,
        {
          data: {
            jobId: "job-exclude",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:05:00.000Z",
            resource: { type: "REVISION", id: "revision-home-1" },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }
    if (pathname.startsWith("/api/knowledge/v2/jobs/") && method === "GET") {
      const jobId = pathname.split("/").at(-1)!;
      const poll = (state.jobPolls[jobId] ?? 0) + 1;
      state.jobPolls[jobId] = poll;
      if (state.activeJobId === jobId) {
        state.activeJobStatus = state.holdJobs ? "RUNNING" : poll >= 2 ? "SUCCEEDED" : "RUNNING";
        if (state.activeJobStatus === "SUCCEEDED" && state.source) {
          state.source.status = "READY";
          state.source.allowedActions = ["EDIT", "SYNC", "PAUSE", "DELETE"];
        }
      }
      await fulfill(route, { data: job(jobId, poll, state.activeJobStatus) });
      return;
    }

    await fulfill(
      route,
      { error: { code: "HTTP_ERROR", message: `Unhandled mock: ${method} ${pathname}` } },
      501,
    );
  });

  return state;
}

async function authenticate(page: Page, locale: QaLocale = "en") {
  await loginAsCleanUser(page, apiBase, { locale });
}

test("structured service catalog remains visible when document sources are empty", async ({
  page,
}) => {
  await authenticate(page);
  await installMocks(page, { empty: true, catalog: true });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  const catalog = page.getByTestId("knowledge-catalog-source-catalog-teplodom");
  await expect(catalog).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("knowledge-catalog-sources")).toContainText("1 catalog");
  await expect(catalog).toContainText("Teplodom services");
  await expect(catalog).toContainText("teplodom_services.csv");
  await expect(catalog).toContainText("30");
  await expect(catalog).toContainText("Applied");
  await expect(page.getByText("No websites or knowledge files yet")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(catalog.getByRole("link", { name: "Open import" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-service-catalog-mobile.png",
    fullPage: true,
    animations: "disabled",
  });

  await catalog.getByRole("link", { name: "Open import" }).click();
  await expect(page).toHaveURL(/\/app\/knowledge\/imports\/import-teplodom-v2$/u);
});

test("website source stays an unpublished draft and revision exclusion uses ETag and idempotency", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("knowledge-sources")).toBeVisible({
    timeout: 15_000,
  });
  const mobileSourceTargetHeights = await page
    .getByTestId("knowledge-sources")
    .locator('input[aria-label], button[role="combobox"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter(({ height, width }) => height > 0 && width > 0)
        .map(({ height }) => height),
    );
  expect(mobileSourceTargetHeights.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...mobileSourceTargetHeights)).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  await expect(page.getByText("Draft ready").first()).toBeVisible();
  await expect(page.getByText(/does not mean it is published/i)).toBeVisible();
  await expect(page.getByText("Home page").first()).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-sources-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Preview revision 1" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Welcome <script>window.__knowledgeXss = true</script>",
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __knowledgeXss?: boolean }).__knowledgeXss),
    )
    .toBeUndefined();

  await page.getByRole("button", { name: "Exclude revision" }).click();
  await page.getByLabel("Exclusion reason").fill("Duplicate marketing page");
  await page.getByRole("button", { name: "Exclude revision" }).last().click();

  await expect(page.getByTestId("knowledge-source-job")).toBeVisible();
  await expect(page.getByTestId("knowledge-source-job")).toContainText("Revision exclusion");
  await expect(page.getByTestId("knowledge-source-job")).toContainText(
    /does not mean the content is live/i,
    {
      timeout: 10_000,
    },
  );
  const request = state.mutations.find((item) => item.pathname.endsWith("/exclude"));
  expect(request?.ifMatch).toBe('"revision-etag-1"');
  expect(request?.idempotencyKey).toMatch(/^kv2:/);
  expect(request?.body).toEqual({ reason: "Duplicate marketing page" });
});

test("source actions confirm, recover from an ETag conflict, and send mutation guards", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page, { conflictNextPause: true });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "currently published knowledge remains unchanged",
  );
  await page.getByRole("button", { name: "Pause" }).last().click();
  await expect(page.getByRole("dialog")).toContainText("This source changed after it was loaded.");
  await page.getByRole("button", { name: "Reload current state" }).click();

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Pause" }).last().click();
  await expect(page.getByText("Paused").first()).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Resume" }).last().click();
  await expect(page.getByText("Importing").first()).toBeVisible();

  await page.getByRole("button", { name: "Remove source" }).click();
  await page.getByLabel("Removal reason").fill("Website retired");
  await page.getByRole("button", { name: "Remove source" }).last().click();
  await expect(page.getByText("Removing").first()).toBeVisible();

  const guarded = state.mutations.filter((item) => item.pathname.includes("source-site"));
  expect(guarded.length).toBeGreaterThanOrEqual(4);
  for (const request of guarded) {
    expect(request.idempotencyKey).toMatch(/^kv2:/);
    expect(request.ifMatch).toMatch(/^"source-etag-/);
  }
  const deletion = guarded.find((item) => item.method === "DELETE");
  expect(deletion?.body).toEqual({ reason: "Website retired" });
});

test("source work is rediscovered after navigation and resumes bounded polling", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page);
  state.holdJobs = true;
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByRole("button", { name: "Sync now" }).last().click();
  const jobPanel = page.getByTestId("knowledge-source-job");
  await expect(jobPanel).toContainText("job-sync");

  await page.getByTestId("knowledge-tab-overview").click();
  await expect(page).toHaveURL(/\bview=overview\b/);
  await expect(page.getByTestId("knowledge-overview")).toBeVisible();
  await page.getByTestId("knowledge-tab-sources").click();
  await expect(jobPanel).toContainText("job-sync");
  const pollsAfterReturn = state.jobPolls["job-sync"] ?? 0;
  await expect.poll(() => state.jobPolls["job-sync"] ?? 0).toBeGreaterThan(pollsAfterReturn);

  state.holdJobs = false;
  await expect(jobPanel).toContainText("Completed", { timeout: 15_000 });
});

test("failed source work is restored after remount and opens a guarded retry", async ({ page }) => {
  await authenticate(page);
  const state = await installMocks(page);
  state.activeJobId = "job-sync";
  state.activeJobStatus = "FAILED";
  state.source!.status = "FAILED";
  state.source!.lastErrorCode = "KNOWLEDGE_DEPENDENCY_SOURCE_FETCH_FAILED";
  state.source!.lastErrorAt = "2026-07-12T12:03:00.000Z";
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  const jobPanel = page.getByTestId("knowledge-source-job");
  await expect(jobPanel).toContainText("Knowledge processing did not complete.", {
    timeout: 15_000,
  });
  await page.getByTestId("knowledge-source-job-retry").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("knowledge-source-action-confirm").click();
  await expect
    .poll(
      () => state.mutations.filter((item) => item.pathname.endsWith("/source-site/sync")).length,
    )
    .toBe(1);
  const retry = state.mutations.find((item) => item.pathname.endsWith("/source-site/sync"));
  expect(retry?.ifMatch).toBe('"source-etag-2"');
  expect(retry?.idempotencyKey).toMatch(/^kv2:/);
  await expect(jobPanel).toContainText("job-sync");
});

test("source settings preserve edits across conflict and reconcile narrowed permissions", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page, { conflictNextPatch: true });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Source name").fill("Local source title");
  await page.getByLabel("Classification").click();
  await page.getByRole("option", { name: "Internal", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Internal team" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Internal team" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Public", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Public", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText(/does not publish or republish/i);

  await page.getByTestId("knowledge-source-settings-save").click();
  await expect(page.getByText("The latest source version was loaded")).toBeVisible();
  await expect(page.getByLabel("Source name")).toHaveValue("Local source title");
  await expect(page.getByLabel("Default language")).toContainText("French");
  await expect(page.getByRole("checkbox", { name: "Internal team" })).toBeChecked();
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-source-settings-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.getByTestId("knowledge-source-settings-save").click();
  await expect(page.getByTestId("knowledge-source-job")).toContainText("Draft reconciliation");
  await expect(page.getByText("Local source title").first()).toBeVisible();

  const patches = state.mutations.filter((item) => item.method === "PATCH");
  expect(patches).toHaveLength(2);
  expect(patches[0]?.ifMatch).toBe('"source-etag-2"');
  expect(patches[1]?.ifMatch).toBe('"source-etag-current"');
  expect(patches[0]?.idempotencyKey).toMatch(/^kv2:/);
  expect(patches[1]?.idempotencyKey).toMatch(/^kv2:/);
  expect(patches[1]?.idempotencyKey).not.toBe(patches[0]?.idempotencyKey);
  expect(patches[1]?.body).toEqual({
    displayName: "Local source title",
    defaultClassification: "INTERNAL",
    defaultScope: {
      brandIds: ["brand-paris"],
      locationIds: ["location-paris"],
      channelTypes: ["WEBSITE"],
      assistantIds: ["assistant-sales"],
      audiences: ["INTERNAL"],
      segments: ["retail"],
      locales: ["en"],
    },
  });
});

test("disabled secure ingestion is explicit and never reports an accepted import", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page, { empty: true, unavailable: true });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Add website" }).first().click();
  await page.getByLabel("Source name").fill("Company website");
  await page.getByLabel("HTTPS address").fill("http://example.com");
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("The address must start with https://.")).toBeVisible();
  expect(state.mutations).toHaveLength(0);

  await page.getByLabel("HTTPS address").fill("https://example.com");
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByRole("dialog")).toContainText("Website import is not configured");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Website import is not configured").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add website" }).first()).toBeDisabled();
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0]?.idempotencyKey).toMatch(/^kv2:/);
  await expect(page.getByTestId("knowledge-source-job")).toHaveCount(0);
});

test("TXT upload goes directly to the issued API URL and enters durable job recovery", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page, { empty: true });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-source-add-file").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("UTF-8 TXT or CSV only · maximum 10 MiB");
  await expect(dialog).toContainText("PDF import is not available yet");
  await expect(page.getByLabel("Classification")).toContainText("Public");
  await expect(page.getByLabel("Audience")).toContainText("Public");
  await page.getByLabel("Select a TXT or CSV knowledge file").setInputFiles({
    name: "services.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Consultations are available Monday through Friday.", "utf8"),
  });
  await expect(page.getByLabel("Source name")).toHaveValue("services");
  await page.getByLabel("Source name").fill("Service catalog");
  await page.getByTestId("knowledge-file-upload-submit").click();

  await expect.poll(() => state.fileUploads.length).toBe(1);
  await expect(page.getByTestId("knowledge-source-job")).toContainText("job-file-import");
  const intent = state.mutations.find(
    (item) => item.pathname === "/api/knowledge/v2/file-uploads/intents",
  );
  expect(intent?.idempotencyKey).toMatch(/^kv2:/);
  expect(intent?.body).toMatchObject({
    displayName: "Service catalog",
    filename: "services.txt",
    declaredMimeType: "text/plain",
    byteSize: 50,
    defaultClassification: "PUBLIC",
    defaultLocale: "en",
    defaultScope: { audiences: ["PUBLIC"] },
  });
  const direct = state.fileUploads[0]!;
  expect(direct.url).toBe(`${apiBase}/knowledge/v2/file-uploads/file-intent-1/content`);
  expect(new URL(direct.url).origin).toBe(new URL(apiBase).origin);
  expect(direct.authorization).toBe("Bearer signed-file-intent-1");
  expect(direct.contentType).toBe("text/plain");
  expect(direct.bytes).toBe(50);
  expect(direct.cookie).toBeUndefined();
  await expect(page.getByText("File draft ready").first()).toBeVisible({ timeout: 10_000 });
});

test("retryable scanner failure retries finalization without uploading bytes again", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page, { empty: true, fileFailure: "SCANNER_ONCE" });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("knowledge-source-add-file").click();
  await page.getByLabel("Select a TXT or CSV knowledge file").setInputFiles({
    name: "catalog.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("service,price\nConsultation,45", "utf8"),
  });
  await page.getByLabel("Source name").fill("Service catalog");
  await page.getByTestId("knowledge-file-upload-submit").click();
  await expect(page.getByRole("dialog")).toContainText(
    "The security scanner is temporarily unavailable",
  );
  expect(state.fileUploads).toHaveLength(1);
  expect(state.fileCompleteCount).toBe(1);

  await page.getByTestId("knowledge-file-upload-submit").click();
  await expect(page.getByTestId("knowledge-source-job")).toContainText("job-file-import");
  expect(state.fileUploads).toHaveLength(1);
  expect(state.fileCompleteCount).toBe(2);
  expect(state.fileIntentCount).toBe(1);
});

test("expired one-time link restarts from a new intent and PDF stays client-side", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installMocks(page, { empty: true, fileFailure: "EXPIRED_ONCE" });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("knowledge-source-add-file").click();
  const input = page.getByLabel("Select a TXT or CSV knowledge file");
  await input.setInputFiles({
    name: "manual.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7", "utf8"),
  });
  await expect(page.getByRole("dialog")).toContainText("PDF import is not available yet");
  expect(state.fileIntentCount).toBe(0);

  await input.setInputFiles({
    name: "manual.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Support manual", "utf8"),
  });
  await page.getByLabel("Source name").fill("Support manual");
  await page.getByTestId("knowledge-file-upload-submit").click();
  await expect(page.getByRole("dialog")).toContainText("one-time upload link expired");
  await page.getByTestId("knowledge-file-upload-submit").click();
  await expect(page.getByTestId("knowledge-source-job")).toContainText("job-file-import");
  expect(state.fileIntentCount).toBe(2);
  expect(state.fileUploads).toHaveLength(2);
  expect(state.fileCompleteCount).toBe(2);
});

test("file upload states are localized in all six product locales", async () => {
  const keys = [
    "knowledge.sources.addFile",
    "knowledge.sources.file.phase.preparing",
    "knowledge.sources.file.phase.uploading",
    "knowledge.sources.file.phase.scanning",
    "knowledge.sources.file.phase.processing",
    "knowledge.sources.file.phase.review",
    "knowledge.sources.file.phase.ready",
    "knowledge.sources.file.error.scanner",
    "knowledge.sources.file.error.storage",
    "knowledge.sources.file.error.restart",
    "knowledge.sources.file.pdfUnavailable",
  ] as const;
  for (const locale of supportedLocales) {
    for (const key of keys) {
      expect(sourceKnowledgeMessages[locale][key], `${locale}:${key}`).toBeTruthy();
      expect(sourceKnowledgeMessages[locale][key]).not.toContain("knowledge.sources.");
    }
  }
});

test("file upload modal does not overflow a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page, "ru");
  await installMocks(page, { empty: true });
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("knowledge-source-add-file").click();
  await expect(page.getByRole("dialog")).toContainText("Добавить файл знаний");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!(dialog instanceof HTMLElement)) return 999;
        return dialog.scrollWidth - dialog.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-file-upload-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("Sources is localized and does not overflow a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page, "ru");
  await installMocks(page);
  await page.goto(`${webBase}/app/knowledge?view=sources`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("knowledge-sources")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Источники", exact: true })).toBeVisible();
  await expect(page.getByText("Черновик готов").first()).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Настройки источника");
  await expect(page.getByRole("dialog")).toContainText(
    "Изменения прав действуют в черновике немедленно",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator("body")).not.toContainText(/knowledge\.sources\./i);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-source-settings-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
