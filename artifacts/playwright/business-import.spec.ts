import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
  BusinessImportApplicationView,
  BusinessImportApplyPreviewView,
  BusinessImportCandidateView,
  BusinessImportFormat,
  BusinessImportMappingConfirmRequest,
  BusinessImportMappingView,
  BusinessImportView,
  BusinessProfileData,
  BusinessProfileView,
} from "@leadvirt/types";
import { supportedLocales, type Locale } from "../../apps/web/src/i18n/config";
import { messages } from "../../apps/web/src/i18n/messages";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const importId = "import-1";
const now = "2026-07-21T12:00:00.000Z";

interface ImportMockState {
  view: BusinessImportView;
  candidates: BusinessImportCandidateView[];
  candidateListRequests: Array<string | null>;
  applications: BusinessImportApplicationView[];
  intentRequests: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
  uploads: Array<{ headers: Record<string, string>; bodyLength: number }>;
  finalizeHeaders: Record<string, string>[];
  candidatePatches: Array<{
    id: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }>;
  previews: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
  applies: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
  bulkDecisions: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
  bulkApprovals: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
  mapping: BusinessImportMappingView;
  mappingRequests: number;
  mappingConfirms: Array<{
    body: BusinessImportMappingConfirmRequest;
    headers: Record<string, string>;
  }>;
}

function profileData(): BusinessProfileData {
  return {
    businessType: "services",
    name: "Northstar Studio",
    description: "A service business with a structured catalog.",
    avgCheck: "EUR 95",
    servicesCatalog: "Consultations and implementation packages.",
    services: [
      {
        id: "existing-implementation",
        name: "Implementation package",
        description: "Existing business service.",
        price: "EUR 900",
        duration: "5 days",
      },
    ],
    hours: "Monday to Friday",
    weeklySchedule: [
      { day: "MON", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      { day: "TUE", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      { day: "WED", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      { day: "THU", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      { day: "FRI", enabled: true, opensAt: "09:00", closesAt: "18:00" },
      { day: "SAT", enabled: false, opensAt: "10:00", closesAt: "16:00" },
      { day: "SUN", enabled: false, opensAt: "10:00", closesAt: "16:00" },
    ],
    availability: "Book one day ahead.",
    faq: "Remote consultations are available.",
    policies: "Final scope requires confirmation.",
    escalationRules: "Escalate discounts to the owner.",
    timezone: "Europe/Paris",
  };
}

function profileView(): BusinessProfileView {
  return {
    profile: profileData(),
    version: 1,
    etag: '"business-profile-1"',
    updatedAt: now,
  };
}

function readyImport(initiallySelected = false): BusinessImportView {
  return {
    id: importId,
    sourceId: "source-1",
    sourceName: "July service catalog",
    format: "CSV",
    state: "READY_FOR_REVIEW",
    generation: 1,
    etag: '"business-import-1"',
    originalFilename: "services-july.csv",
    schemaVersion: "leadvirt-services-v1",
    baseBusinessInformationRevision: 4,
    counts: {
      total: 2,
      valid: 2,
      invalid: 0,
      additions: 1,
      updates: 1,
      linked: 0,
      unchanged: 0,
      conflicts: 0,
      pendingApproval: 0,
      applied: 0,
    },
    diagnostics: [],
    projection: { ready: false },
    allowedActions: ["REVIEW", "APPLY", "CANCEL"],
    applyEligibility: {
      eligible: initiallySelected,
      selectedCandidates: initiallySelected ? 2 : 0,
      blockingConflicts: 0,
      blockingInvalid: 0,
      pendingApprovals: 0,
      staleCandidates: 0,
      reasonCodes: initiallySelected ? [] : ["BUSINESS_IMPORT_NO_SELECTED_CHANGES"],
    },
    retryable: false,
    createdAt: now,
    updatedAt: now,
    reviewReadyAt: now,
  };
}

function mappingRequiredImport(): BusinessImportView {
  return {
    ...readyImport(false),
    state: "MAPPING_REQUIRED",
    counts: {
      total: 0,
      valid: 0,
      invalid: 0,
      additions: 0,
      updates: 0,
      linked: 0,
      unchanged: 0,
      conflicts: 0,
      pendingApproval: 0,
      applied: 0,
    },
    allowedActions: ["CANCEL"],
    applyEligibility: {
      eligible: false,
      selectedCandidates: 0,
      blockingConflicts: 0,
      blockingInvalid: 0,
      pendingApprovals: 0,
      staleCandidates: 0,
      reasonCodes: ["BUSINESS_IMPORT_MAPPING_REQUIRED"],
    },
    reviewReadyAt: null,
  };
}

function mappingProposal(): BusinessImportMappingView {
  return {
    importId,
    etag: '"business-import-1"',
    format: "CSV",
    table: {
      tableKey: "csv:services",
      schemaHash: "a".repeat(64),
      headerRow: 1,
      totalRows: 3,
      totalColumns: 4,
      columns: [
        {
          sourceColumnKey: "column:1",
          index: 1,
          header: "Наименование",
          examples: ["Консультация", "Настройка рекламы", "Аудит"],
          proposedTarget: "name",
          status: "MATCHED",
        },
        {
          sourceColumnKey: "column:2",
          index: 2,
          header: "Стоимость",
          examples: ["5 000", "от 12 000", "по запросу"],
          proposedTarget: "price",
          status: "CHECK_MAPPING",
        },
        {
          sourceColumnKey: "column:3",
          index: 3,
          header: "Подробности",
          examples: ["60 минут", "Запуск под ключ"],
          proposedTarget: "description",
          status: "MATCHED",
        },
        {
          sourceColumnKey: "column:4",
          index: 4,
          header: "Внутренняя метка",
          examples: ["A-101", "A-102"],
          proposedTarget: "IGNORE",
          status: "NOT_USED",
        },
      ],
    },
    defaults: {
      locale: "ru",
      numberFormat: "DECIMAL_COMMA",
      currency: null,
      timezone: "Europe/Paris",
      unit: null,
    },
    validation: {
      canConfirm: true,
      errorCodes: [],
      warningCodes: ["BUSINESS_IMPORT_MAPPING_UNUSED_COLUMNS"],
    },
  };
}

function importCandidates(initiallySelected = false): BusinessImportCandidateView[] {
  return [
    {
      id: "candidate-add",
      importId,
      action: "ADD",
      decision: initiallySelected ? "ACCEPTED" : "PENDING",
      riskLevel: "LOW",
      requiresApproval: false,
      confidence: "CONFIRMED_FORMAT",
      version: 1,
      etag: '"candidate-add-1"',
      proposed: {
        externalId: "consultation",
        category: "Consulting",
        name: "Initial consultation",
        description: "Requirements review and written recommendations.",
        price: { type: "FIXED", amount: "45", currency: "EUR", unit: "session" },
        duration: { minimumMinutes: 45 },
        active: true,
        language: "en",
      },
      current: null,
      diagnostics: [],
      evidence: [
        {
          format: "CSV",
          artifactId: "artifact-1",
          locator: { row: 2, column: 1, header: "name" },
          availability: "AVAILABLE",
          sourceValue: "Initial consultation,45,EUR,45",
          expiresAt: "2026-07-22T12:00:00.000Z",
        },
      ],
      selected: initiallySelected,
      canEditProposed: true,
      allowedDecisions: ["ACCEPTED", "REJECTED"],
    },
    {
      id: "candidate-update",
      importId,
      action: "UPDATE",
      decision: initiallySelected ? "ACCEPTED" : "PENDING",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      confidence: "HIGH",
      version: 1,
      etag: '"candidate-update-1"',
      targetOfferingId: "existing-implementation",
      proposed: {
        externalId: "implementation",
        category: "Delivery",
        name: "Implementation package",
        description: "Updated delivery package.",
        price: { type: "FROM", from: "1200", currency: "EUR", unit: "project" },
        duration: { minimumMinutes: 2400, maximumMinutes: 4800 },
        active: true,
        language: "en",
      },
      current: {
        externalId: "implementation",
        category: "Delivery",
        name: "Implementation package",
        description: "Existing delivery package.",
        price: { type: "FIXED", amount: "900", currency: "EUR", unit: "project" },
        duration: { minimumMinutes: 2400 },
        active: true,
        language: "en",
      },
      diagnostics: [],
      evidence: [
        {
          format: "CSV",
          artifactId: "artifact-1",
          locator: { row: 3, column: 5, header: "price" },
          availability: "AVAILABLE",
          sourceValue: "Implementation package,1200,EUR",
          expiresAt: "2026-07-22T12:00:00.000Z",
        },
      ],
      selected: initiallySelected,
      canEditProposed: true,
      allowedDecisions: ["ACCEPTED", "REJECTED"],
    },
  ];
}

function twoPageCandidates(): BusinessImportCandidateView[] {
  const template = importCandidates()[0]!;
  return [
    ...Array.from({ length: 100 }, (_, index) => ({
      ...template,
      id: `candidate-filler-${index + 1}`,
      etag: `"candidate-filler-${index + 1}-1"`,
      decision: "REJECTED" as const,
      proposed: { ...template.proposed, name: `Filler service ${index + 1}` },
      selected: false,
    })),
    {
      ...template,
      id: "candidate-page-two",
      etag: '"candidate-page-two-1"',
      decision: "REJECTED",
      proposed: { ...template.proposed, name: "Page two target service" },
      selected: false,
    },
  ];
}

function application(state: BusinessImportApplicationView["state"]): BusinessImportApplicationView {
  return {
    id: "application-1",
    importId,
    state,
    baseBusinessInformationRevision: 4,
    resultingBusinessInformationRevision: 5,
    counts: { additions: 1, updates: 1, linked: 0, unchanged: 0 },
    projection: {
      businessInformationRevision: 5,
      knowledgeDraftGeneration: state === "READY" ? 12 : null,
      ready: state === "READY",
    },
    createdAt: now,
    readyAt: state === "READY" ? now : null,
  };
}

const corsHeaders = {
  "access-control-allow-origin": webBase,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS",
  "access-control-allow-headers":
    "authorization,content-type,idempotency-key,if-match,x-business-information-if-match",
};

async function json(
  route: Route,
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...headers },
    body: JSON.stringify(payload),
  });
}

async function installMocks(
  page: Page,
  options: {
    previewDiagnostics?: BusinessImportApplyPreviewView["diagnostics"];
    enabledFormats?: BusinessImportFormat[];
    role?: "OWNER" | "VIEWER";
    uploadOutcomes?: Array<"SUCCESS" | "EXPIRED" | "ALREADY_USED" | "LOST_RESPONSE">;
    applyOutcomes?: Array<"SUCCESS" | "TRANSIENT" | "EXPIRED">;
    paginateCandidates?: boolean;
    initiallySelected?: boolean;
    locale?: Locale;
    mappingRequired?: boolean;
    mappingLoadOutcomes?: Array<"SUCCESS" | "FAIL">;
    mappingConfirmOutcomes?: Array<"SUCCESS" | "CONFLICT" | "TRANSIENT">;
  } = {},
) {
  const state: ImportMockState = {
    view: options.mappingRequired
      ? mappingRequiredImport()
      : readyImport(options.initiallySelected ?? false),
    candidates: options.paginateCandidates
      ? twoPageCandidates()
      : importCandidates(options.initiallySelected ?? false),
    candidateListRequests: [],
    applications: [],
    intentRequests: [],
    uploads: [],
    finalizeHeaders: [],
    candidatePatches: [],
    previews: [],
    applies: [],
    bulkDecisions: [],
    bulkApprovals: [],
    mapping: mappingProposal(),
    mappingRequests: 0,
    mappingConfirms: [],
  };
  if (options.paginateCandidates) {
    state.view = {
      ...state.view,
      counts: {
        ...state.view.counts,
        total: state.candidates.length,
        valid: state.candidates.length,
        additions: state.candidates.length,
        updates: 0,
        linked: 0,
      },
      applyEligibility: {
        ...state.view.applyEligibility,
        eligible: false,
        selectedCandidates: 0,
        reasonCodes: ["BUSINESS_IMPORT_NO_SELECTED_CHANGES"],
      },
    };
  }
  const role = options.role ?? "OWNER";
  if (role === "VIEWER") {
    state.view = {
      ...state.view,
      allowedActions: state.view.state === "MAPPING_REQUIRED" ? [] : ["REVIEW"],
    };
    state.candidates = state.candidates.map((candidate) => ({
      ...candidate,
      canEditProposed: false,
      allowedDecisions: [],
    }));
  }
  const profile = profileView();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = new URL(request.url());
    const pathname = requestUrl.pathname;

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      await json(route, {
        data: {
          id: "owner-1",
          email: "owner@example.test",
          name: "Workspace owner",
          locale: options.locale ?? "en",
          role,
          tenantId: "tenant-1",
          authMode: "email",
        },
      });
      return;
    }
    if (pathname === "/api/current-tenant" && method === "GET") {
      await json(route, {
        data: {
          id: "tenant-1",
          name: "Northstar Studio",
          slug: "northstar",
          status: "ACTIVE",
          timezone: "Europe/Paris",
          role,
        },
      });
      return;
    }
    if (pathname === "/api/billing/current-subscription" && method === "GET") {
      await json(route, { data: null });
      return;
    }
    if (pathname === "/api/dashboard/summary" && method === "GET") {
      await json(route, { data: { recentActivity: [] } });
      return;
    }
    if (pathname === "/api/business-profile" && method === "GET") {
      await json(route, { data: profile }, 200, { etag: profile.etag });
      return;
    }
    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      await json(route, {
        data: {
          readiness: {
            serving: { status: "READY" },
            draft: { status: "CHANGES_PENDING" },
          },
          permissions: {
            canViewRestricted: true,
            canEdit: role === "OWNER",
            canManageSettings: role === "OWNER",
            canVerifyHighRisk: role === "OWNER",
            canPublish: role === "OWNER",
            canRollback: role === "OWNER",
          },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/settings" && method === "GET") {
      await json(route, {
        data: {
          version: 1,
          etag: '"settings-1"',
          defaultLocale: "en",
          supportedLocales: ["en"],
          defaultScope: null,
          defaultScopeGeneration: 0,
          defaultScopeHash: null,
          autoPublishPolicy: "OFF",
          publicationApprovalPolicy: "OWNER_OR_ADMIN",
          publicationSchedule: null,
          createdAt: now,
          updatedAt: now,
          updatedBy: { id: "owner-1", displayName: "Workspace owner" },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/facts" && method === "GET") {
      await json(route, {
        data: { items: [], pageInfo: { limit: 50, nextCursor: null, hasNextPage: false } },
      });
      return;
    }
    if (pathname === "/api/business-profile/import-templates" && method === "GET") {
      await json(route, {
        data: {
          items: [
            {
              id: "services-csv-v1",
              format: "CSV",
              target: "SERVICES",
              filename: "leadvirt-services.csv",
              downloadUrl: `${apiBase}/business-profile/import-templates/services-csv-v1/content`,
              declaredMimeType: "text/csv",
              maxBytes: 1_048_576,
              enabled: options.enabledFormats?.includes("CSV") ?? true,
            },
            {
              id: "services-xlsx-v1",
              format: "XLSX",
              target: "SERVICES",
              filename: "leadvirt-services.xlsx",
              downloadUrl: `${apiBase}/business-profile/imports/templates/services.xlsx`,
              declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              maxBytes: 1_048_576,
              enabled: options.enabledFormats?.includes("XLSX") ?? false,
            },
            {
              id: "services-pdf-v1",
              format: "PDF",
              target: "SERVICES",
              filename: "",
              downloadUrl: null,
              declaredMimeType: "application/pdf",
              maxBytes: 1_048_576,
              enabled: options.enabledFormats?.includes("PDF") ?? false,
            },
          ],
        },
      });
      return;
    }
    if (pathname === "/api/business-profile/imports" && method === "GET") {
      const requestedState = requestUrl.searchParams.get("state");
      const items = requestedState && state.view.state !== requestedState ? [] : [state.view];
      await json(route, { data: { items, nextCursor: null } });
      return;
    }
    if (pathname === "/api/business-profile/imports/intents" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.intentRequests.push({ body, headers: request.headers() });
      await json(route, {
        data: {
          id: "intent-1",
          importId,
          uploadUrl: `${apiBase}/business-profile/imports/${importId}/content`,
          method: "PUT",
          headers: {
            Authorization: "Bearer upload-once-token",
            "Content-Type": String(body.declaredMimeType),
            "Content-Length": String(body.byteSize),
          },
          policy: {
            maxBytes: 1_048_576,
            expectedBytes: body.byteSize,
            allowedMimeTypes: [String(body.declaredMimeType)],
            expiresAt: "2026-07-21T12:15:00.000Z",
            oneTime: true,
          },
          idempotencyReplayed: false,
        },
      });
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}/content` && method === "PUT") {
      state.uploads.push({
        headers: request.headers(),
        bodyLength: request.postDataBuffer()?.byteLength ?? 0,
      });
      const outcome = options.uploadOutcomes?.[state.uploads.length - 1] ?? "SUCCESS";
      if (outcome === "LOST_RESPONSE") {
        await route.abort("connectionreset");
        return;
      }
      if (outcome === "EXPIRED") {
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_UPLOAD_EXPIRED",
              message: "The upload link has expired.",
              retryable: false,
            },
          },
          410,
        );
        return;
      }
      if (outcome === "ALREADY_USED") {
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_UPLOAD_ALREADY_USED",
              message: "This one-time upload link has already been used.",
              retryable: false,
            },
          },
          409,
        );
        return;
      }
      await json(route, { data: { importId, status: "UPLOADED", uploadedAt: now } });
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}/finalize` && method === "POST") {
      state.finalizeHeaders.push(request.headers());
      await json(route, { data: state.view }, 202, { etag: state.view.etag });
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}` && method === "GET") {
      const current = state.view;
      await json(route, { data: current }, 200, { etag: current.etag });
      if (current.state === "PARSING" && state.mappingConfirms.length > 0) {
        state.view = {
          ...readyImport(false),
          etag: '"business-import-mapped-ready"',
          generation: current.generation,
        };
      }
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}/mapping` && method === "GET") {
      state.mappingRequests += 1;
      const outcome = options.mappingLoadOutcomes?.shift() ?? "SUCCESS";
      if (outcome === "FAIL") {
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_MAPPING_UNAVAILABLE",
              message: "The detected columns could not be loaded.",
              retryable: true,
            },
          },
          503,
        );
        return;
      }
      await json(route, { data: state.mapping }, 200, { etag: state.mapping.etag });
      return;
    }
    if (
      pathname === `/api/business-profile/imports/${importId}/mapping/confirm` &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as BusinessImportMappingConfirmRequest;
      state.mappingConfirms.push({ body, headers: request.headers() });
      const outcome = options.mappingConfirmOutcomes?.shift() ?? "SUCCESS";
      if (outcome === "TRANSIENT") {
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_MAPPING_TEMPORARILY_UNAVAILABLE",
              message: "The mapping could not be saved yet.",
              retryable: true,
            },
          },
          503,
        );
        return;
      }
      if (outcome === "CONFLICT") {
        state.mapping = { ...state.mapping, etag: '"business-import-refreshed"' };
        state.view = { ...state.view, etag: state.mapping.etag };
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_MAPPING_STALE",
              message: "The mapping changed.",
              retryable: false,
            },
          },
          412,
        );
        return;
      }
      state.view = {
        ...state.view,
        state: "PARSING",
        generation: state.view.generation + 1,
        etag: '"business-import-mapped"',
      };
      await json(
        route,
        {
          data: {
            importId,
            mappingId: "mapping-1",
            generation: state.view.generation,
            state: "PARSING",
            etag: state.view.etag,
            idempotencyReplayed: false,
          },
        },
        202,
        { etag: state.view.etag },
      );
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}/candidates` && method === "GET") {
      const cursor = requestUrl.searchParams.get("cursor");
      state.candidateListRequests.push(cursor);
      const items = options.paginateCandidates
        ? cursor === "candidate-page-2"
          ? state.candidates.slice(100)
          : state.candidates.slice(0, 100)
        : state.candidates;
      await json(route, {
        data: {
          items,
          nextCursor: options.paginateCandidates && !cursor ? "candidate-page-2" : null,
        },
      });
      return;
    }
    if (
      pathname === `/api/business-profile/imports/${importId}/decisions/bulk` &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.bulkDecisions.push({ body, headers: request.headers() });
      const decisions = new Map(
        ((body.candidates as Array<{ id: string; decision: "ACCEPTED" | "REJECTED" }>) ?? []).map(
          (candidate) => [candidate.id, candidate.decision],
        ),
      );
      state.candidates = state.candidates.map((candidate) => {
        const decision = decisions.get(candidate.id);
        return decision
          ? {
              ...candidate,
              decision,
              selected: decision === "ACCEPTED",
              etag: `"${candidate.id}-bulk-${state.bulkDecisions.length}"`,
            }
          : candidate;
      });
      const selectedCandidates = state.candidates.filter((candidate) => candidate.selected).length;
      const pendingApprovals = state.candidates.filter(
        (candidate) => candidate.selected && candidate.requiresApproval,
      ).length;
      state.view = {
        ...state.view,
        etag: `"business-import-bulk-${state.bulkDecisions.length}"`,
        applyEligibility: {
          ...state.view.applyEligibility,
          eligible: selectedCandidates > 0 && pendingApprovals === 0,
          selectedCandidates,
          pendingApprovals,
          reasonCodes:
            selectedCandidates === 0
              ? ["BUSINESS_IMPORT_NO_SELECTED_CHANGES"]
              : pendingApprovals > 0
                ? ["BUSINESS_IMPORT_APPROVAL_REQUIRED"]
                : [],
        },
      };
      await json(route, { data: { items: state.candidates.slice(0, 100), nextCursor: null } });
      return;
    }
    const candidateMatch = pathname.match(
      new RegExp(`^/api/business-profile/imports/${importId}/candidates/([^/]+)$`, "u"),
    );
    if (candidateMatch && method === "PATCH") {
      const candidateId = decodeURIComponent(candidateMatch[1]);
      const body = request.postDataJSON() as Record<string, unknown>;
      state.candidatePatches.push({ id: candidateId, body, headers: request.headers() });
      const current = state.candidates.find((candidate) => candidate.id === candidateId);
      if (!current) {
        await json(route, { error: { code: "NOT_FOUND", message: "Candidate not found" } }, 404);
        return;
      }
      const decision = body.decision as "ACCEPTED" | "REJECTED";
      const proposed =
        (body.proposed as BusinessImportCandidateView["proposed"] | undefined) ?? current.proposed;
      const correctedAction =
        body.proposed && ["INVALID", "CONFLICT"].includes(current.action)
          ? current.targetOfferingId
            ? "UPDATE"
            : "ADD"
          : current.action;
      const nextVersion = current.version + (body.proposed ? 1 : 0);
      const updated: BusinessImportCandidateView = {
        ...current,
        action: correctedAction,
        proposed,
        decision,
        selected: decision === "ACCEPTED",
        diagnostics: correctedAction === current.action ? current.diagnostics : [],
        allowedDecisions:
          correctedAction === current.action ? current.allowedDecisions : ["ACCEPTED", "REJECTED"],
        version: nextVersion,
        etag: `"${candidateId}-etag-${state.candidatePatches.length}"`,
      };
      state.candidates = state.candidates.map((candidate) =>
        candidate.id === candidateId ? updated : candidate,
      );
      state.view = { ...state.view, etag: '"business-import-2"', updatedAt: now };
      await json(route, { data: updated }, 200, { etag: updated.etag });
      return;
    }
    if (
      pathname === `/api/business-profile/imports/${importId}/apply-preview` &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.previews.push({ body, headers: request.headers() });
      const preview: BusinessImportApplyPreviewView = {
        importId,
        candidateIds: body.candidateIds as string[],
        candidateVersions: Object.fromEntries(
          state.candidates.map((candidate) => [candidate.id, candidate.version]),
        ),
        manifestHash: "manifest-hash-1",
        businessInformationEtag: '"business-information-4"',
        expiresAt: "2026-07-21T12:10:00.000Z",
        counts: { additions: 1, updates: 1, linked: 0, unchanged: 0, conflicts: 0 },
        diagnostics: options.previewDiagnostics ?? [],
      };
      await json(route, { data: preview });
      return;
    }
    if (
      pathname === `/api/business-profile/imports/${importId}/approvals/bulk` &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.bulkApprovals.push({ body, headers: request.headers() });
      const requested = new Set(
        ((body.candidates as Array<{ id: string }> | undefined) ?? []).map((item) => item.id),
      );
      state.candidates = state.candidates.map((candidate) =>
        requested.has(candidate.id)
          ? {
              ...candidate,
              decision: "ACCEPTED",
              approval: {
                id: `approval-${candidate.id}`,
                state: "APPROVED",
                candidateVersion: candidate.version,
                decidedAt: now,
              },
              etag: `"${candidate.id}-${candidate.version + 1}"`,
            }
          : candidate,
      );
      state.view = {
        ...state.view,
        etag: '"business-import-approved"',
        counts: { ...state.view.counts, pendingApproval: 0 },
        applyEligibility: {
          ...state.view.applyEligibility,
          eligible: true,
          pendingApprovals: 0,
          reasonCodes: [],
        },
      };
      const candidates = state.candidates.filter((candidate) => requested.has(candidate.id));
      await json(route, {
        data: {
          import: state.view,
          candidates,
          summary: {
            selected: candidates.length,
            newlyApproved: candidates.length,
            approvalRequestsCreated: candidates.length,
            alreadyApproved: 0,
          },
        },
      });
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}/apply` && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.applies.push({ body, headers: request.headers() });
      const outcome = options.applyOutcomes?.shift() ?? "SUCCESS";
      if (outcome === "TRANSIENT") {
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_APPLY_UNAVAILABLE",
              message: "The change could not be committed. Try again.",
              retryable: true,
            },
          },
          503,
        );
        return;
      }
      if (outcome === "EXPIRED") {
        await json(
          route,
          {
            error: {
              code: "BUSINESS_IMPORT_PREVIEW_EXPIRED",
              message: "This preview expired. Create a new preview.",
              retryable: true,
            },
          },
          409,
        );
        return;
      }
      const readyApplication = application("READY");
      state.applications = [readyApplication];
      state.view = {
        ...state.view,
        state: "APPLIED",
        etag: '"business-import-3"',
        counts: { ...state.view.counts, applied: 2 },
        allowedActions: ["REVERT"],
        applyEligibility: { ...state.view.applyEligibility, eligible: false },
        projection: {
          businessInformationRevision: 5,
          knowledgeDraftGeneration: 12,
          ready: true,
        },
        appliedAt: now,
        updatedAt: now,
      };
      state.candidates = state.candidates.map((candidate) => ({
        ...candidate,
        decision: "APPLIED",
        selected: false,
        allowedDecisions: [],
        appliedAt: now,
      }));
      await json(route, { data: application("PROJECTING") }, 202);
      return;
    }
    if (pathname === `/api/business-profile/imports/${importId}/applications` && method === "GET") {
      await json(route, { data: { items: state.applications, nextCursor: null } });
      return;
    }

    await json(
      route,
      {
        error: {
          code: "UNHANDLED_TEST_ROUTE",
          message: `Unhandled business import mock: ${method} ${pathname}`,
          retryable: false,
        },
      },
      501,
    );
  });

  return state;
}

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
}

test("business import translations cover every supported locale", () => {
  const englishKeys = Object.keys(messages.en).filter((key) => key.startsWith("businessImport."));
  expect(englishKeys.length).toBeGreaterThan(140);
  for (const locale of supportedLocales) {
    const localized = messages[locale] as Record<string, string>;
    for (const key of englishKeys) {
      expect(localized[key], `${locale}:${key}`).toBeTruthy();
      expect(localized[key], `${locale}:${key}`).not.toBe(key);
    }
  }
});

test("candidate diagnostics use the active locale", async ({ context, page }) => {
  const state = await installMocks(page, { locale: "ru" });
  state.candidates = [
    {
      ...state.candidates[0]!,
      diagnostics: [
        {
          severity: "ERROR",
          code: "BUSINESS_IMPORT_SERVICE_NAME_REQUIRED",
          message: "A service name is required.",
          field: "name",
        },
      ],
    },
  ];
  state.view = {
    ...state.view,
    counts: { ...state.view.counts, total: 1, valid: 0, invalid: 1 },
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" },
  ]);

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  const row = page.getByTestId("business-import-candidate-candidate-add");
  await expect(row).toContainText("Укажите название услуги.");
  await expect(row).not.toContainText("A service name is required.");
});

test("recent imports remain discoverable for read-only workspace members", async ({
  context,
  page,
}) => {
  await installMocks(page, { role: "VIEWER" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("business-profile-import-file")).not.toBeVisible();
  await page.getByTestId("business-profile-import-history").click();
  await expect(page.getByTestId("business-import-history-dialog")).toBeVisible();
  await expect(page.getByTestId(`business-import-history-item-${importId}`)).toContainText(
    "July service catalog",
  );
  await expect(page.getByTestId(`business-import-history-item-${importId}`)).toContainText(
    "Ready for review",
  );
  const historyWidth = await page
    .getByTestId("business-import-history-dialog")
    .evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(historyWidth).toBeLessThanOrEqual(1);
  await page.getByTestId(`business-import-history-item-${importId}`).click();
  await expect(page).toHaveURL(new RegExp(`/app/knowledge/imports/${importId}$`, "u"));
});

test("the upload dialog exposes only server-enabled formats", async ({ context, page }) => {
  await installMocks(page, { enabledFormats: ["CSV"] });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("business-profile-import-file").click();

  const dialog = page.getByTestId("business-import-upload-dialog");
  await expect(dialog).toContainText("CSV, up to 1 MB");
  await expect(dialog).not.toContainText("XLSX");
  await expect(dialog).not.toContainText("PDF");
  await expect(page.getByLabel("Service or price-list file")).toHaveAttribute(
    "accept",
    ".csv,text/csv",
  );
});

test("unsaved profile changes are gated and direct upload omits ambient credentials", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const state = await installMocks(page);
  state.view = {
    ...state.view,
    diagnostics: [
      {
        severity: "WARNING",
        code: "BUSINESS_IMPORT_UNUSED_COLUMN",
        message: "The column legacy_code was not imported.",
        field: "legacy_code",
      },
    ],
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
    { name: "upload-sentinel", value: "must-not-leak", url: new URL(apiBase).origin },
  ]);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("business-profile-editor")).toBeVisible();
  await page.getByTestId("business-profile-name").fill("Unsaved local name");
  await page.getByTestId("business-profile-import-file").click();
  await expect(page.getByRole("heading", { name: "Save current changes first?" })).toBeVisible();
  await page.getByTestId("business-import-discard-and-open").click();

  const fileContents = "external_id,name,price,currency\nconsultation,Consultation,45,EUR\n";
  await page.getByLabel("Service or price-list file").setInputFiles({
    name: "july-services.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fileContents),
  });
  await page.getByTestId("business-import-upload-submit").click();

  await expect(page).toHaveURL(new RegExp(`/app/knowledge/imports/${importId}$`, "u"));
  await expect(page.getByTestId("business-import-review-table")).toBeVisible();
  await expect(page.getByTestId("business-import-diagnostics")).toContainText(
    "The column legacy_code was not imported.",
  );
  expect(state.intentRequests).toHaveLength(1);
  expect(state.intentRequests[0].body).toMatchObject({
    filename: "july-services.csv",
    declaredMimeType: "text/csv",
    byteSize: Buffer.byteLength(fileContents),
    sourceName: "july-services",
  });
  expect(state.intentRequests[0].headers["idempotency-key"]).toMatch(/^business-import:/u);
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0].bodyLength).toBe(Buffer.byteLength(fileContents));
  expect(state.uploads[0].headers.authorization).toBe("Bearer upload-once-token");
  expect(state.uploads[0].headers.cookie).toBeUndefined();
  expect(state.finalizeHeaders).toHaveLength(1);
  expect(state.finalizeHeaders[0]["idempotency-key"]).toMatch(/^business-import:/u);
  expect(state.finalizeHeaders[0]["idempotency-key"]).not.toBe(
    state.intentRequests[0].headers["idempotency-key"],
  );
});

test("uploading a new revision preserves the existing source lineage", async ({
  context,
  page,
}) => {
  const state = await installMocks(page);
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId("business-import-upload-revision").click();
  await expect(page.getByTestId("business-import-revision-source")).toContainText(
    "July service catalog",
  );
  const contents = "external_id,name,price,currency\nconsultation,Consultation,55,EUR\n";
  await page.getByLabel("Service or price-list file").setInputFiles({
    name: "services-august.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(contents),
  });
  await page.getByTestId("business-import-upload-submit").click();

  await expect.poll(() => state.intentRequests.length).toBe(1);
  expect(state.intentRequests[0].body).toMatchObject({
    filename: "services-august.csv",
    sourceId: "source-1",
    sourceName: "July service catalog",
  });
});

test("an expired upload capability is replaced before retry", async ({ context, page }) => {
  const state = await installMocks(page, { uploadOutcomes: ["EXPIRED", "SUCCESS"] });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("business-profile-import-file").click();
  await page.getByLabel("Service or price-list file").setInputFiles({
    name: "services.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name\nAudit\n"),
  });
  await page.getByTestId("business-import-upload-submit").click();
  await expect(page.getByRole("alert")).toContainText("expired");
  await page.getByTestId("business-import-upload-submit").click();
  await expect(page).toHaveURL(new RegExp(`/app/knowledge/imports/${importId}$`, "u"));
  expect(state.intentRequests).toHaveLength(2);
  expect(state.uploads).toHaveLength(2);
  expect(state.finalizeHeaders).toHaveLength(1);
});

test("a lost successful upload response replays the same capability", async ({ context, page }) => {
  const state = await installMocks(page, {
    uploadOutcomes: ["LOST_RESPONSE", "SUCCESS"],
  });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("business-profile-import-file").click();
  await page.getByLabel("Service or price-list file").setInputFiles({
    name: "services.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name\nAudit\n"),
  });
  await page.getByTestId("business-import-upload-submit").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByTestId("business-import-upload-submit").click();
  await expect(page).toHaveURL(new RegExp(`/app/knowledge/imports/${importId}$`, "u"));
  expect(state.intentRequests).toHaveLength(1);
  expect(state.uploads).toHaveLength(2);
  expect(state.finalizeHeaders).toHaveLength(1);
});

test("XLSX follows the enabled policy and PDF stays unavailable without mapping", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const state = await installMocks(page, { enabledFormats: ["CSV", "XLSX"] });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("business-profile-import-file").click();
  await expect(page.getByTestId("business-import-upload-dialog")).not.toContainText("PDF");
  await page.getByLabel("Service or price-list file").setInputFiles({
    name: "services.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("PK\u0003\u0004xlsx-test"),
  });
  await expect(page.getByTestId("business-import-upload-submit")).toBeEnabled();
  await page.getByTestId("business-import-upload-submit").click();
  await expect(page).toHaveURL(new RegExp(`/app/knowledge/imports/${importId}$`, "u"));

  await page.goto(`${webBase}/app/knowledge?view=business`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("business-profile-import-file").click();
  await page.getByLabel("Service or price-list file").setInputFiles({
    name: "price-list.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\npdf-test"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("business-import-upload-submit")).toBeDisabled();

  expect(state.intentRequests.map((request) => request.body)).toEqual([
    expect.objectContaining({
      filename: "services.xlsx",
      declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceName: "services",
    }),
  ]);
  expect(state.uploads).toHaveLength(1);
});

test("arbitrary price-list columns are mapped, confirmed, and prepared for review", async ({
  context,
  page,
}, testInfo) => {
  const state = await installMocks(page, { mappingRequired: true });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  const workspace = page.getByTestId("business-import-mapping-workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("business-import-metrics")).toHaveCount(0);
  await expect(workspace).toContainText("Наименование");
  await expect(workspace).toContainText("Консультация");
  await expect(workspace).toContainText("2 matched");
  await expect(workspace).toContainText("1 to check");
  await expect(workspace).toContainText("1 not used");
  await expect(page.getByTestId("business-import-mapping-confirm")).toBeDisabled();
  await expect(page.getByTestId("business-import-mapping-cancel")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("business-import-mapping-desktop.png"),
    fullPage: true,
  });

  await page.getByTestId("business-import-mapping-target-column:4").click();
  await expect(page.getByRole("option", { name: "Amount", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("business-import-mapping-advanced-toggle").click();
  await page.getByTestId("business-import-mapping-target-column:4").click();
  await expect(page.getByRole("option", { name: "Amount", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("business-import-mapping-target-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await expect(page.getByTestId("business-import-mapping-default-currency")).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-confirm")).toBeEnabled();
  await page.getByTestId("business-import-mapping-default-currency").click();
  await page.getByRole("option", { name: "EUR · €", exact: true }).click();
  await page.getByTestId("business-import-mapping-default-unit").fill("session");

  await expect(page.getByTestId("business-import-mapping-confirm")).toBeEnabled();
  await page.getByTestId("business-import-mapping-confirm").click();
  await expect(page.getByTestId("business-import-review-table")).toBeVisible({ timeout: 10_000 });

  expect(state.mappingConfirms).toHaveLength(1);
  expect(state.mappingConfirms[0].body).toEqual({
    tableKey: "csv:services",
    schemaHash: "a".repeat(64),
    headerRow: 1,
    columns: [
      { sourceColumnKey: "column:1", target: "name" },
      { sourceColumnKey: "column:2", target: "price" },
      { sourceColumnKey: "column:3", target: "description" },
      { sourceColumnKey: "column:4", target: "IGNORE" },
    ],
    defaults: {
      locale: "ru",
      numberFormat: "DECIMAL_COMMA",
      currency: "EUR",
      timezone: "Europe/Paris",
      unit: "session",
    },
  });
  expect(state.mappingConfirms[0].headers["if-match"]).toBe('"business-import-1"');
  expect(state.mappingConfirms[0].headers["idempotency-key"]).toMatch(/^business-import:/u);
});

test("server validation blocks mapping confirmation after local checks pass", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, { mappingRequired: true });
  state.mapping = {
    ...state.mapping,
    validation: {
      canConfirm: false,
      errorCodes: ["BUSINESS_IMPORT_MAPPING_SOURCE_BLOCKED"],
      warningCodes: [],
    },
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId("business-import-mapping-target-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await expect(
    page.getByText(
      "This file has a validation issue that must be resolved before mapping can continue.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-confirm")).toBeDisabled();
  expect(state.mappingConfirms).toHaveLength(0);
});

test("mapping requires one service-name column and reloads stale proposals", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, {
    mappingRequired: true,
    mappingConfirmOutcomes: ["CONFLICT"],
  });
  state.mapping = {
    ...state.mapping,
    table: {
      ...state.mapping.table,
      columns: state.mapping.table.columns.map((column) =>
        column.proposedTarget === "name" ? { ...column, status: "CHECK_MAPPING" as const } : column,
      ),
    },
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByText("Choose exactly one column for Service name.")).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-confirm")).toBeDisabled();
  await page.getByTestId("business-import-mapping-target-column:1").click();
  await page.getByRole("option", { name: "Service name", exact: true }).click();
  await page.getByTestId("business-import-mapping-target-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await page.getByTestId("business-import-mapping-default-currency").click();
  await page.getByRole("option", { name: "EUR · €", exact: true }).click();
  await page.getByTestId("business-import-mapping-confirm").click();

  await expect(page.getByTestId("business-import-mapping-save-error")).toContainText(
    "changed in another session",
  );
  expect(state.mappingRequests).toBeGreaterThanOrEqual(2);
  expect(state.mappingConfirms).toHaveLength(1);
  await page.getByTestId("business-import-mapping-target-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await expect(page.getByTestId("business-import-mapping-save-error")).toHaveCount(0);
});

test("smart price mapping can use a separate currency column", async ({ context, page }) => {
  const state = await installMocks(page, { mappingRequired: true });
  const priceColumn = state.mapping.table.columns.find(
    (column) => column.sourceColumnKey === "column:2",
  )!;
  state.mapping = {
    ...state.mapping,
    table: {
      ...state.mapping.table,
      totalColumns: 6,
      columns: [
        ...state.mapping.table.columns.map((column) =>
          column.sourceColumnKey === priceColumn.sourceColumnKey
            ? { ...column, status: "MATCHED" as const }
            : column,
        ),
        {
          sourceColumnKey: "column:5",
          index: 5,
          header: "Валюта",
          examples: ["RUB", "RUB", "RUB"],
          proposedTarget: "currency",
          status: "MATCHED",
        },
        {
          sourceColumnKey: "column:6",
          index: 6,
          header: "Language",
          examples: ["en", "ru", "de"],
          proposedTarget: "language",
          status: "MATCHED",
        },
      ],
    },
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("business-import-mapping-confirm")).toBeEnabled();
  await expect(page.getByTestId("business-import-mapping-number-format")).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-default-locale")).toHaveCount(0);
  await page.getByTestId("business-import-mapping-target-column:2").click();
  await expect(
    page.getByRole("option", {
      name: "Price (detect format)",
      exact: true,
    }),
  ).not.toHaveAttribute("data-disabled");
  await page.keyboard.press("Escape");
  await page.getByTestId("business-import-mapping-target-column:5").click();
  await expect(page.getByRole("option", { name: "Currency", exact: true })).not.toHaveAttribute(
    "data-disabled",
  );
});

test("a failed mapping proposal can be retried without replacing the import", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, {
    mappingRequired: true,
    mappingLoadOutcomes: ["FAIL", "SUCCESS"],
  });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  const error = page.getByTestId("business-import-mapping-error");
  await expect(error).toBeVisible();
  await expect(error.getByTestId("business-import-mapping-cancel")).toBeVisible();
  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("business-import-mapping-workspace")).toBeVisible();
  expect(state.mappingRequests).toBe(2);
});

test("a failed mapping refresh preserves unsaved column choices", async ({ context, page }) => {
  const state = await installMocks(page, {
    mappingRequired: true,
    mappingLoadOutcomes: ["SUCCESS", "FAIL", "SUCCESS"],
  });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("business-import-mapping-target-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await expect(page.getByTestId("business-import-mapping-target-column:2")).toContainText(
    "Price (detect format)",
  );

  await page.getByTestId("business-import-refresh").click();
  const refreshError = page.getByTestId("business-import-mapping-refresh-error");
  await expect(refreshError).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-target-column:2")).toContainText(
    "Price (detect format)",
  );
  await refreshError.getByRole("button", { name: "Try again" }).click();
  await expect(refreshError).toHaveCount(0);
  await expect(page.getByTestId("business-import-mapping-target-column:2")).toContainText(
    "Price (detect format)",
  );
  expect(state.mappingRequests).toBe(3);
});

test("mapping confirmation reuses one idempotency key after a transient failure", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, {
    mappingRequired: true,
    mappingConfirmOutcomes: ["TRANSIENT", "SUCCESS"],
  });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("business-import-mapping-target-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await page.getByTestId("business-import-mapping-confirm").click();
  await expect(page.getByTestId("business-import-mapping-save-error")).toBeVisible();
  await page.getByTestId("business-import-mapping-confirm").click();
  await expect(page.getByTestId("business-import-review-table")).toBeVisible({ timeout: 10_000 });

  expect(state.mappingConfirms).toHaveLength(2);
  expect(state.mappingConfirms[1].body).toEqual(state.mappingConfirms[0].body);
  expect(state.mappingConfirms[1].headers["idempotency-key"]).toBe(
    state.mappingConfirms[0].headers["idempotency-key"],
  );
});

test("non-CSV mapping states fail truthfully without calling the CSV mapper", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, { mappingRequired: true });
  state.view = {
    ...state.view,
    format: "XLSX",
    originalFilename: "services.xlsx",
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("business-import-mapping-unsupported")).toContainText(
    "XLSX column mapping is not available",
  );
  await expect(page.getByTestId("business-import-mapping-workspace")).toHaveCount(0);
  await expect(
    page.getByTestId("business-import-mapping-unsupported").getByRole("button"),
  ).toBeVisible();
  expect(state.mappingRequests).toBe(0);
});

test("editors can complete mapping on mobile without overflow", async ({
  context,
  page,
}, testInfo) => {
  await installMocks(page, { mappingRequired: true });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId("business-import-mapping-target-mobile-column:2").click();
  await page.getByRole("option", { name: "Price (detect format)", exact: true }).click();
  await expect(page.getByTestId("business-import-mapping-confirm")).toBeEnabled();
  await expectTouchTarget(page.getByTestId("business-import-mapping-confirm"));
  await expectTouchTarget(page.getByTestId("business-import-mapping-cancel"));
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  await page.screenshot({
    path: testInfo.outputPath("business-import-mapping-editor-mobile.png"),
    fullPage: true,
  });
});

test("viewers can inspect mapping samples on mobile without mutation or overflow", async ({
  context,
  page,
}, testInfo) => {
  await installMocks(page, { mappingRequired: true, role: "VIEWER" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("business-import-mapping-mobile")).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-read-only")).toBeVisible();
  await expect(page.getByTestId("business-import-mapping-confirm")).toHaveCount(0);
  await expect(page.getByTestId("business-import-mapping-target-mobile-column:1")).toBeDisabled();
  await expectTouchTarget(page.getByTestId("business-import-mapping-target-mobile-column:1"));
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  await page.screenshot({
    path: testInfo.outputPath("business-import-mapping-mobile.png"),
    fullPage: true,
  });
});

test("fresh pending services can be included in one visible-scope decision", async ({ page }) => {
  const state = await installMocks(page);
  const expected = state.candidates.map((candidate) => ({
    id: candidate.id,
    etag: candidate.etag,
    decision: "ACCEPTED",
  }));

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await expect(page.getByTestId("business-import-bulk-decisions")).toContainText("Pending: 2");
  await expect(page.getByTestId("business-import-apply-selected")).toBeDisabled();
  await page.getByTestId("business-import-include-visible").click();

  await expect(page.getByTestId("business-import-bulk-decisions")).toContainText("Included: 2");
  await expect(page.getByTestId("business-import-apply-selected")).toBeEnabled();
  expect(state.bulkDecisions).toHaveLength(1);
  expect(state.bulkDecisions[0].body).toEqual({ candidates: expected });
  expect(state.bulkDecisions[0].headers["if-match"]).toBe('"business-import-1"');
});

test("a pending missing-source row can be explicitly excluded and never requests approval", async ({
  page,
}) => {
  const state = await installMocks(page);
  const template = state.candidates[0]!;
  state.candidates = [
    {
      ...template,
      id: "candidate-missing",
      action: "MISSING",
      decision: "PENDING",
      riskLevel: "HIGH",
      requiresApproval: false,
      selected: false,
      canEditProposed: false,
      allowedDecisions: ["REJECTED"],
      etag: '"candidate-missing-1"',
      proposed: { ...template.proposed, name: "Legacy service" },
    },
  ];
  state.view = {
    ...state.view,
    counts: {
      ...state.view.counts,
      total: 1,
      valid: 1,
      additions: 0,
      updates: 0,
      pendingApproval: 0,
    },
    applyEligibility: {
      ...state.view.applyEligibility,
      eligible: false,
      selectedCandidates: 0,
      pendingApprovals: 0,
      reasonCodes: ["BUSINESS_IMPORT_NO_SELECTED_CHANGES"],
    },
  };

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await expect(page.getByRole("button", { name: "Include Legacy service" })).toBeDisabled();
  await expect(page.getByTestId("business-import-candidate-candidate-missing")).not.toContainText(
    "Approval required",
  );
  await page.getByRole("button", { name: "Exclude Legacy service" }).click();

  await expect(page.getByTestId("business-import-candidate-candidate-missing")).toContainText(
    "Excluded",
  );
  expect(state.candidatePatches[0]).toMatchObject({
    id: "candidate-missing",
    body: { decision: "REJECTED" },
  });
});

test("a blocking apply preview cannot be confirmed and exposes rebase recovery", async ({
  page,
}) => {
  const state = await installMocks(page, {
    initiallySelected: true,
    previewDiagnostics: [
      {
        severity: "ERROR",
        code: "BUSINESS_IMPORT_REBASE_REQUIRED",
        message: "Business information changed after this import was prepared.",
      },
    ],
  });
  state.view = { ...state.view, allowedActions: [...state.view.allowedActions, "REBASE"] };

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await page.getByTestId("business-import-apply-selected").click();

  await expect(page.getByTestId("business-import-operation-error")).toContainText(
    messages.en["businessImport.diagnostic.dataChanged"],
  );
  await expect(page.getByTestId("business-import-rebase")).toBeVisible();
  await expect(page.getByTestId("business-import-apply-confirm")).not.toBeVisible();
  expect(state.applies).toHaveLength(0);
});

test("apply retry keeps one idempotency key and shows failure inside the dialog", async ({
  page,
}) => {
  const state = await installMocks(page, {
    initiallySelected: true,
    applyOutcomes: ["TRANSIENT", "SUCCESS"],
  });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await page.getByTestId("business-import-apply-selected").click();
  await page.getByTestId("business-import-apply-confirm").click();

  await expect(page.getByTestId("business-import-apply-error")).toContainText(
    "The change could not be committed",
  );
  await page.getByTestId("business-import-apply-confirm").click();
  await expect(page.getByTestId("business-import-applied")).toBeVisible();
  expect(state.applies).toHaveLength(2);
  expect(state.applies[0].headers["idempotency-key"]).toBe(
    state.applies[1].headers["idempotency-key"],
  );
});

test("an owner approves all selected high-risk services in one request", async ({ page }) => {
  const state = await installMocks(page, { initiallySelected: true });
  state.candidates = state.candidates.map((candidate) => ({
    ...candidate,
    riskLevel: "HIGH",
    requiresApproval: true,
    approval: null,
  }));
  state.view = {
    ...state.view,
    counts: { ...state.view.counts, pendingApproval: state.candidates.length },
    applyEligibility: {
      ...state.view.applyEligibility,
      eligible: false,
      pendingApprovals: state.candidates.length,
      reasonCodes: ["BUSINESS_IMPORT_APPROVAL_REQUIRED"],
    },
  };
  const expectedCandidates = state.candidates.map((candidate) => ({
    id: candidate.id,
    version: candidate.version,
    etag: candidate.etag,
  }));

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await expect(page.getByTestId("business-import-approve-selected")).toContainText("2");
  await page.getByTestId("business-import-approve-selected").click();

  await expect(page.getByTestId("business-import-approve-selected")).not.toBeVisible();
  await expect(page.getByTestId("business-import-apply-selected")).toBeEnabled();
  expect(state.bulkApprovals).toHaveLength(1);
  expect(state.bulkApprovals[0].body).toEqual({
    candidates: expectedCandidates,
  });
  expect(state.bulkApprovals[0].headers["if-match"]).toBe('"business-import-1"');
});

test("a rejected approval version must be edited before it can be selected again", async ({
  page,
}) => {
  const state = await installMocks(page);
  const candidate = state.candidates[0]!;
  state.candidates = [
    {
      ...candidate,
      riskLevel: "HIGH",
      requiresApproval: true,
      selected: false,
      decision: "REJECTED",
      approval: {
        id: "approval-rejected",
        state: "REJECTED",
        candidateVersion: candidate.version,
        decidedAt: now,
      },
    },
  ];
  state.view = {
    ...state.view,
    counts: { ...state.view.counts, total: 1, valid: 1, pendingApproval: 1 },
    applyEligibility: {
      ...state.view.applyEligibility,
      eligible: false,
      selectedCandidates: 0,
      pendingApprovals: 1,
      reasonCodes: ["BUSINESS_IMPORT_APPROVAL_REQUIRED"],
    },
  };

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await expect(page.getByRole("button", { name: "Include Initial consultation" })).toBeDisabled();
  await expect(page.getByTestId("business-import-candidate-candidate-add")).toContainText(
    "Edit the service before requesting approval again",
  );
  await expect(page.getByTestId("business-import-request-approval")).not.toBeVisible();
});

test("an expired apply preview closes and requires a fresh preview", async ({ page }) => {
  const state = await installMocks(page, {
    initiallySelected: true,
    applyOutcomes: ["EXPIRED", "SUCCESS"],
  });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`);
  await page.getByTestId("business-import-apply-selected").click();
  await page.getByTestId("business-import-apply-confirm").click();

  await expect(page.getByTestId("business-import-apply-preview")).not.toBeVisible();
  await expect(page.getByTestId("business-import-operation-error")).toContainText(
    "This preview expired",
  );
  await page.getByTestId("business-import-apply-selected").click();
  await expect(page.getByTestId("business-import-apply-preview")).toBeVisible();
  expect(state.previews).toHaveLength(2);
});

test("read-only users can inspect evidence without mutation controls", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, { role: "VIEWER" });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("business-import-review-table")).toBeVisible();
  await expect(page.getByTestId("business-import-upload-revision")).toHaveCount(0);
  await expect(page.getByTestId("business-import-apply-selected")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Initial consultation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Include Initial consultation" })).toBeDisabled();
  await page.getByRole("button", { name: "Open source for Initial consultation" }).click();
  await expect(page.getByTestId("business-import-evidence-dialog")).toContainText(
    "Initial consultation,45,EUR,45",
  );
  expect(state.candidatePatches).toHaveLength(0);
  expect(state.previews).toHaveLength(0);
  expect(state.applies).toHaveLength(0);
});

test("source evidence distinguishes blank, expired, unavailable, and corrupt previews", async ({
  context,
  page,
}) => {
  const state = await installMocks(page);
  const available = state.candidates[0]!.evidence[0]!;
  state.candidates[0] = {
    ...state.candidates[0]!,
    evidence: [
      { ...available, artifactId: "artifact-blank", availability: "AVAILABLE", sourceValue: "" },
      {
        ...available,
        artifactId: "artifact-expired",
        availability: "EXPIRED",
        sourceValue: null,
        expiresAt: "2026-07-20T12:00:00.000Z",
      },
      {
        ...available,
        artifactId: "artifact-unavailable",
        availability: "UNAVAILABLE",
        sourceValue: null,
        expiresAt: "2026-07-23T12:00:00.000Z",
      },
      {
        ...available,
        artifactId: "artifact-corrupt",
        availability: "CORRUPT",
        sourceValue: null,
        expiresAt: "2026-07-24T12:00:00.000Z",
      },
    ],
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);

  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Open source for Initial consultation" }).click();
  const dialog = page.getByTestId("business-import-evidence-dialog");
  await expect(dialog.locator('[data-evidence-availability="AVAILABLE"]')).toContainText(
    "This source cell is blank.",
  );
  await expect(dialog.locator('[data-evidence-availability="EXPIRED"]')).toContainText(
    "expired on Jul 20, 2026",
  );
  await expect(dialog.locator('[data-evidence-availability="UNAVAILABLE"]')).toContainText(
    "unavailable or has been removed",
  );
  await expect(dialog.locator('[data-evidence-availability="UNAVAILABLE"]')).toContainText(
    "Retention deadline: Jul 23, 2026",
  );
  await expect(dialog.locator('[data-evidence-availability="CORRUPT"]')).toContainText(
    "failed its integrity check",
  );
});

test("search and review filters include candidates returned on the second page", async ({
  context,
  page,
}) => {
  const state = await installMocks(page, { paginateCandidates: true });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect.poll(() => state.candidateListRequests).toContain("candidate-page-2");
  await page.getByTestId("business-import-search").fill("Page two target");
  await expect(page.getByTestId("business-import-candidate-candidate-page-two")).toBeVisible();
  await expect(page.getByTestId("business-import-candidate-candidate-filler-1")).toHaveCount(0);
});

test("an invalid candidate can be edited but not accepted until it is corrected", async ({
  context,
  page,
}) => {
  const state = await installMocks(page);
  const invalid: BusinessImportCandidateView = {
    ...state.candidates[0]!,
    id: "candidate-invalid",
    etag: '"candidate-invalid-1"',
    action: "INVALID",
    decision: "PENDING",
    selected: false,
    diagnostics: [
      {
        severity: "ERROR",
        code: "BUSINESS_IMPORT_REQUIRED_FIELD",
        message: "The service row requires correction.",
      },
    ],
    allowedDecisions: ["REJECTED"],
    canEditProposed: true,
    proposed: { ...state.candidates[0]!.proposed, name: "Broken service" },
  };
  state.candidates = [invalid];
  state.view = {
    ...state.view,
    counts: {
      ...state.view.counts,
      total: 1,
      valid: 0,
      invalid: 1,
      additions: 0,
      updates: 0,
      linked: 0,
    },
    applyEligibility: {
      ...state.view.applyEligibility,
      eligible: false,
      selectedCandidates: 0,
      blockingInvalid: 1,
      reasonCodes: ["BUSINESS_IMPORT_INVALID_CANDIDATES"],
    },
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByRole("button", { name: "Include Broken service" })).toBeDisabled();
  await expect(page.getByTestId("business-import-candidate-candidate-invalid")).toContainText(
    "The service row requires correction.",
  );
  await page.getByRole("button", { name: "Edit Broken service" }).click();
  await page
    .getByTestId("business-import-edit-dialog")
    .getByLabel("Service name")
    .fill("Corrected service");
  await page
    .getByTestId("business-import-edit-dialog")
    .getByLabel("Source ID")
    .fill("corrected-service-key");
  await page.getByTestId("business-import-edit-save").click();

  const correctedRow = page.getByTestId("business-import-candidate-candidate-invalid");
  await expect(correctedRow).toContainText("Corrected service");
  await expect(correctedRow).toContainText("Add");
  await expect(page.getByRole("button", { name: "Include Corrected service" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(state.candidatePatches[0]).toMatchObject({
    id: "candidate-invalid",
    body: {
      decision: "ACCEPTED",
      proposed: { name: "Corrected service", externalId: "corrected-service-key" },
    },
  });
});

test("desktop review exposes source evidence, saves edits, and applies an exact preview", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const state = await installMocks(page, { initiallySelected: true });
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("business-import-review-table")).toBeVisible();
  await expect(page.getByTestId("business-import-candidate-candidate-update")).toContainText(
    "Price type",
  );
  await expect(page.getByTestId("business-import-candidate-candidate-update")).toContainText(
    "Amount from",
  );
  await expect(page.getByTestId("business-import-candidate-candidate-add")).toContainText(
    "Source ID",
  );
  await expect(page.getByTestId("business-import-evidence-panel")).toBeVisible();
  await expect(page.getByTestId("business-import-evidence-panel")).toContainText(
    "Initial consultation,45,EUR,45",
  );
  await page.screenshot({
    path: testInfo.outputPath("business-import-desktop-review.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit Initial consultation" }).click();
  await page
    .getByTestId("business-import-edit-dialog")
    .getByLabel("Service name")
    .fill("Strategy consultation");
  await page.getByTestId("business-import-edit-save").click();
  await expect(page.getByText("Strategy consultation", { exact: true }).first()).toBeVisible();
  expect(state.candidatePatches).toHaveLength(1);
  expect(state.candidatePatches[0]).toMatchObject({
    id: "candidate-add",
    body: { decision: "ACCEPTED", proposed: { name: "Strategy consultation" } },
  });
  expect(state.candidatePatches[0].headers["if-match"]).toBe('"candidate-add-1"');
  expect(state.candidatePatches[0].headers["idempotency-key"]).toMatch(/^business-import:/u);

  await page.getByRole("button", { name: "Open source for Strategy consultation" }).click();
  await expect(page.getByTestId("business-import-evidence-dialog")).toContainText(
    "CSV row 2, column name",
  );
  await page.keyboard.press("Escape");

  await page.getByTestId("business-import-apply-selected").click();
  await expect(page.getByTestId("business-import-apply-preview")).toBeVisible();
  await expect(page.getByTestId("business-import-apply-items")).toContainText(
    "Strategy consultation",
  );
  await expect(page.getByTestId("business-import-apply-items")).toContainText(
    "Implementation package",
  );
  await expect(page.getByTestId("business-import-apply-items")).toContainText("Current");
  await expect(page.getByTestId("business-import-apply-items")).toContainText("Proposed");
  expect(state.previews).toHaveLength(1);
  expect(state.previews[0].body).toEqual({
    candidateIds: ["candidate-add", "candidate-update"],
  });
  expect(state.previews[0].headers["if-match"]).toBe('"business-import-2"');
  await page.getByTestId("business-import-apply-confirm").click();

  await expect(page.getByTestId("business-import-applied")).toBeVisible();
  await expect(page.getByTestId("business-import-applied")).toContainText(
    "Added 1; updated 1; linked 0.",
  );
  await expect(page.getByTestId("business-import-review-draft")).toHaveAttribute(
    "href",
    "/app/knowledge?view=overview",
  );
  await page.screenshot({
    path: testInfo.outputPath("business-import-applied.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(state.applies).toHaveLength(1);
  expect(state.applies[0].body).toEqual({
    candidateIds: ["candidate-add", "candidate-update"],
    manifestHash: "manifest-hash-1",
  });
  expect(state.applies[0].headers["if-match"]).toBe('"business-import-2"');
  expect(state.applies[0].headers["x-business-information-if-match"]).toBe(
    '"business-information-4"',
  );
  expect(state.applies[0].headers["idempotency-key"]).toMatch(/^business-import:/u);
});

test("mobile review uses cards, touch-sized actions, and no horizontal overflow", async ({
  context,
  page,
}, testInfo) => {
  const state = await installMocks(page);
  state.candidates[0] = {
    ...state.candidates[0],
    proposed: {
      ...state.candidates[0].proposed,
      name: "A deliberately long localized consultation service name that must wrap safely",
    },
  };
  await context.addCookies([
    { name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/knowledge/imports/${importId}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("business-import-review-mobile")).toBeVisible();
  await expect(page.getByTestId("business-import-review-table")).not.toBeVisible();
  await expectTouchTarget(page.getByTestId("business-import-apply-selected"));
  await expectTouchTarget(
    page
      .getByTestId("business-import-candidate-card-candidate-add")
      .getByRole("button", { name: /Open source for/u }),
  );
  await expectTouchTarget(page.getByRole("button", { name: /Include A deliberately long/u }));

  const geometry = await page.evaluate(() => {
    const apply = document.querySelector<HTMLElement>(
      '[data-testid="business-import-apply-selected"]',
    );
    const rect = apply?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      applyLeft: rect?.left ?? -1,
      applyRight: rect?.right ?? Number.POSITIVE_INFINITY,
      applyBottom: rect?.bottom ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.applyLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.applyRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.applyBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  await page.screenshot({
    path: testInfo.outputPath("business-import-mobile-review.png"),
    fullPage: true,
  });
});
