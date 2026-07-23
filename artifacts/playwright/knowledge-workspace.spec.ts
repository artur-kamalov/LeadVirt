import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  BusinessProfileView,
  KnowledgeV2BatchEvaluationRunView,
  KnowledgeV2CapabilityView,
  KnowledgeV2JobView,
  KnowledgeV2OverviewView,
  KnowledgeV2PublicationDetail,
  KnowledgeV2PublicationItemCounts,
  KnowledgeV2PublicationSummary,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessView,
  KnowledgeV2ScopeInput,
  KnowledgeV2SettingsView,
} from "@leadvirt/types";
import type { Locale } from "../../apps/web/src/i18n/config";
import { messages } from "../../apps/web/src/i18n/messages";
import { loginAsCleanUser } from "./helpers/auth";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";
const apiBase = process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api";
const evaluatedAt = "2026-07-12T12:00:00.000Z";
const candidateManifestHash8 = "a".repeat(64);
const candidateManifestHash9 = "b".repeat(64);
const evaluationTestCaseSetHash = "c".repeat(64);
const activeCounts: KnowledgeV2PublicationItemCounts = {
  documentRevisions: 0,
  factVersions: 3,
  guidanceRuleVersions: 1,
  sourcePermissionSnapshots: 0,
};
const draftCounts: KnowledgeV2PublicationItemCounts = {
  documentRevisions: 0,
  factVersions: 4,
  guidanceRuleVersions: 2,
  sourcePermissionSnapshots: 0,
};

interface KnowledgeMockState {
  forbidden: boolean;
  canManageSettings: boolean;
  published: boolean;
  overviewGets: number;
  historyGets: number;
  activeGets: number;
  validationBodies: unknown[];
  publicationBodies: unknown[];
  validationKeys: Array<string | undefined>;
  publicationKeys: Array<string | undefined>;
  jobPolls: number;
  jobStatus: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | null;
  holdJob: boolean;
  failJob: boolean;
  candidateVersion: number;
  candidateManifestHash: string;
  validationId: string | null;
  evaluationTestCaseSetHash: string;
  evaluationStatus: KnowledgeV2BatchEvaluationRunView["status"] | null;
  evaluationScenario: "SUCCESS" | "CRITICAL_FAILURE" | "FAILED" | "HOLD";
  evaluationCandidateVersion: number | null;
  evaluationCandidateManifestHash: string | null;
  evaluationRunTestCaseSetHash: string | null;
  evaluationListGets: number;
  evaluationPolls: number;
  evaluationBodies: unknown[];
  evaluationKeys: Array<string | undefined>;
  settings: KnowledgeV2SettingsView;
  settingsBodies: unknown[];
  capability: KnowledgeV2CapabilityView;
  capabilityBodies: unknown[];
}

function publicationSummary(
  sequence: number,
  status: KnowledgeV2PublicationSummary["status"],
  isActive: boolean,
): KnowledgeV2PublicationSummary {
  return {
    id: `publication-${sequence}`,
    targetKey: "workspace-v2",
    sequence,
    status,
    isActive,
    basePublicationId: sequence > 6 ? `publication-${sequence - 1}` : null,
    sourcePublicationId: null,
    validationId: `validation-${sequence}`,
    itemCounts: sequence >= 8 ? draftCounts : activeCounts,
    validationStatus: "PASSED",
    diff:
      sequence === 6
        ? null
        : {
            added: sequence === 8 ? 2 : 1,
            updated: sequence === 8 ? 1 : 0,
            removed: 0,
          },
    allowedActions: isActive ? ["VIEW"] : ["VIEW", "ROLLBACK"],
    createdAt: `2026-07-${String(sequence + 1).padStart(2, "0")}T10:00:00.000Z`,
    createdBy: { id: "user-owner", displayName: "Alex Morgan" },
    approvedAt: `2026-07-${String(sequence + 1).padStart(2, "0")}T10:02:00.000Z`,
    approvedBy: { id: "user-owner", displayName: "Alex Morgan" },
    activatedAt: isActive ? `2026-07-${String(sequence + 1).padStart(2, "0")}T10:03:00.000Z` : null,
    supersededAt: isActive ? null : "2026-07-12T10:03:00.000Z",
    failedAt: null,
    failureCode: null,
  };
}

function publicationDetail(sequence: number): KnowledgeV2PublicationDetail {
  const summary = publicationSummary(sequence, "ACTIVE", true);
  return {
    ...summary,
    validation: {
      id: `validation-${sequence}`,
      candidateId: "workspace-v2",
      candidateVersion: sequence,
      candidateManifestHash: sequence === 8 ? candidateManifestHash8 : candidateManifestHash9,
      targetKey: "workspace-v2",
      status: "PASSED",
      itemCounts: summary.itemCounts,
      blockers: [],
      warnings: [],
      evaluatedAt,
      validUntil: "2026-07-12T12:15:00.000Z",
      version: 1,
      etag: `"kv2-validation-${sequence}"`,
    },
    items: [
      {
        type: "FACT_VERSION",
        id: "fact-business-name",
        versionId: `fact-business-name-v${sequence}`,
        label: "Business name",
        scope: {
          usesTenantDefault: true,
          brandIds: [],
          locationIds: [],
          channelTypes: [],
          assistantIds: [],
          audiences: [],
          segments: [],
          locales: [],
        },
      },
      {
        type: "GUIDANCE_RULE_VERSION",
        id: "guidance-price-policy",
        versionId: `guidance-price-policy-v${sequence}`,
        label: "Price uncertainty",
        scope: {
          usesTenantDefault: true,
          brandIds: [],
          locationIds: [],
          channelTypes: [],
          assistantIds: [],
          audiences: [],
          segments: [],
          locales: [],
        },
      },
    ],
    rollbackReason: null,
  };
}

function readiness(
  published: boolean,
  jobStatus: KnowledgeMockState["jobStatus"] = published ? "SUCCEEDED" : null,
  candidateVersion = 8,
  candidateManifestHash = candidateManifestHash8,
  validationId: string | null = null,
  testCaseSetHash = evaluationTestCaseSetHash,
): KnowledgeV2ReadinessView {
  const servingSequence = published ? 8 : 7;
  const servingCounts = published ? draftCounts : activeCounts;
  const capabilities: KnowledgeV2ReadinessView["draft"]["capabilities"] = [
    {
      capabilityId: "general-faq",
      capabilityType: "GENERAL_FAQ",
      name: "General FAQ",
      enabled: true,
      allowedAutonomy: "ANSWER_ONLY",
      generation: 1,
      etag: '"kv2-capability-general-faq-1"',
      status: "READY_WITH_WARNINGS",
      weight: 100,
      blockerCount: 0,
      warningCount: 1,
      requirements: [
        {
          id: "verified-business-fact",
          kind: "FACT",
          label: "Verified business facts",
          status: "SATISFIED",
          severity: "BLOCKER",
          riskLevel: "LOW",
          explanation: "Verified business facts are available.",
          evidence: [{ type: "FACT", id: "fact-business-name", label: "Business name" }],
          remediation: null,
          evaluatedAt,
        },
        {
          id: "optional-escalation-guidance",
          kind: "RULE",
          label: "Escalation guidance",
          status: "UNSATISFIED",
          severity: "WARNING",
          riskLevel: "LOW",
          explanation: "Optional escalation guidance has not been approved.",
          evidence: [],
          remediation: { action: "CREATE_GUIDANCE_RULE", label: "Add approved guidance" },
          evaluatedAt,
        },
      ],
    },
  ];
  return {
    targetKey: "workspace-v2",
    candidateId: "workspace-v2",
    candidateVersion,
    candidateManifestHash,
    activePublicationId: `publication-${servingSequence}`,
    activePublicationSequence: servingSequence,
    status:
      jobStatus && ["QUEUED", "RUNNING"].includes(jobStatus)
        ? "UPDATING"
        : published
          ? "READY_WITH_WARNINGS"
          : "NEEDS_REVIEW",
    serving: {
      status: "READY",
      activePublicationId: `publication-${servingSequence}`,
      activePublicationSequence: servingSequence,
      activeEtag: `"kv2-active-${servingSequence}"`,
      itemCounts: servingCounts,
      blockers: [],
      capabilitySetHash: "d".repeat(64),
      requirementEvaluationSetHash: "e".repeat(64),
      capabilities,
    },
    draft: {
      status:
        jobStatus === "FAILED"
          ? "FAILED"
          : jobStatus && ["QUEUED", "RUNNING"].includes(jobStatus)
            ? "PROCESSING"
            : published
              ? "UP_TO_DATE"
              : "CHANGES_PENDING",
      candidateId: "workspace-v2",
      candidateVersion,
      candidateManifestHash,
      validationId,
      evaluationTestCaseSetHash: testCaseSetHash,
      itemCounts: draftCounts,
      blockers: [],
      warnings: [
        {
          code: "KNOWLEDGE_PUBLICATION_OPTIONAL_GUIDANCE_COVERAGE",
          status: "WARNING",
          title: "Optional escalation guidance is missing",
          message: "The draft can publish, but escalation coverage can be improved.",
          resource: { type: "FACT", id: "fact-escalation", label: "Escalation policy" },
        },
      ],
      latestJob: jobStatus ? publicationJob(jobStatus) : null,
      capabilitySetHash: "d".repeat(64),
      requirementEvaluationSetHash: "f".repeat(64),
      capabilities,
    },
    capabilities,
    blockerCount: 0,
    warningCount: 1,
    needsReviewCount: published ? 0 : 1,
    evaluatedAt,
  };
}

function publicationJob(status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"): KnowledgeV2JobView {
  const succeeded = status === "SUCCEEDED";
  return {
    id: "job-publish-8",
    stage: "PUBLISHING",
    status,
    progress: {
      completed: succeeded ? 1 : 0,
      total: 1,
      percent: succeeded ? 100 : status === "FAILED" ? 70 : 45,
      label: succeeded ? "Publication activated" : "Activating publication",
    },
    attempt: 1,
    maxAttempts: 5,
    resources: [{ type: "PUBLICATION", id: "publication-8", label: "Publication #8" }],
    error:
      status === "FAILED"
        ? {
            code: "KNOWLEDGE_DEPENDENCY_INDEX_UNAVAILABLE",
            message: "Knowledge processing did not complete.",
            retryable: false,
          }
        : null,
    createdAt: "2026-07-12T12:01:00.000Z",
    startedAt: "2026-07-12T12:01:01.000Z",
    nextAttemptAt: null,
    completedAt: status === "SUCCEEDED" || status === "FAILED" ? "2026-07-12T12:01:03.000Z" : null,
  };
}

function overview(state: KnowledgeMockState): KnowledgeV2OverviewView {
  const { published, jobStatus } = state;
  const currentReadiness = readiness(
    published,
    jobStatus,
    state.candidateVersion,
    state.candidateManifestHash,
    state.validationId,
    state.evaluationTestCaseSetHash,
  );
  return {
    readiness: currentReadiness,
    activePublication: publicationSummary(published ? 8 : 7, "ACTIVE", true),
    latestDraftPublication:
      jobStatus && jobStatus !== "SUCCEEDED"
        ? publicationSummary(8, jobStatus === "FAILED" ? "FAILED" : "PUBLISHING", false)
        : null,
    counts: {
      sources: 0,
      facts: 4,
      guidanceRules: 2,
      reviewItems: published ? 0 : 1,
      failedJobs: jobStatus === "FAILED" ? 1 : 0,
    },
    recentJobs: jobStatus ? [publicationJob(jobStatus)] : [],
    permissions: {
      canViewRestricted: true,
      canEdit: true,
      canManageSettings: state.canManageSettings,
      canVerifyHighRisk: true,
      canPublish: true,
      canRollback: true,
    },
  };
}

function initialSettings(): KnowledgeV2SettingsView {
  return {
    version: 3,
    etag: '"kv2-settings-3"',
    defaultLocale: "en",
    supportedLocales: ["en", "fr"],
    defaultScope: {
      usesTenantDefault: false,
      brandIds: ["brand-private"],
      locationIds: ["location-private"],
      channelTypes: ["WEBSITE"],
      assistantIds: ["assistant-private"],
      audiences: ["PUBLIC"],
      segments: ["vip"],
      locales: ["en"],
    },
    defaultScopeGeneration: 2,
    defaultScopeHash: "d".repeat(64),
    autoPublishPolicy: "OFF",
    publicationApprovalPolicy: "OWNER_OR_ADMIN",
    publicationSchedule: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
    updatedBy: { id: "user-owner", displayName: "Alex Morgan" },
  };
}

function businessProfile(): BusinessProfileView {
  return {
    profile: {
      businessType: "services",
      name: "Knowledge workspace fixture",
      description: "A deterministic profile for Knowledge workspace navigation tests.",
      avgCheck: "EUR 80",
      servicesCatalog: "Consultations and ongoing service packages.",
      services: [],
      hours: "Weekdays",
      weeklySchedule: [],
      availability: "By appointment",
      faq: "",
      policies: "",
      escalationRules: "",
      timezone: "Europe/Paris",
    },
    version: 1,
    etag: '"business-profile-workspace-1"',
    updatedAt: "2026-07-12T09:00:00.000Z",
  };
}

function validationResult(state: KnowledgeMockState): KnowledgeV2PublicationValidationView {
  return {
    id: `validation-${state.candidateVersion}`,
    candidateId: "workspace-v2",
    candidateVersion: state.candidateVersion,
    candidateManifestHash: state.candidateManifestHash,
    targetKey: "workspace-v2",
    status: "PASSED",
    itemCounts: draftCounts,
    blockers: [],
    warnings: [],
    evaluatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
    version: 1,
    etag: `"kv2-validation-${state.candidateVersion}"`,
  };
}

function evaluationRun(state: KnowledgeMockState): KnowledgeV2BatchEvaluationRunView {
  const status = state.evaluationStatus ?? "QUEUED";
  const completed = status === "SUCCEEDED";
  const criticalFailure = completed && state.evaluationScenario === "CRITICAL_FAILURE";
  const aggregate = {
    total: completed ? 2 : status === "RUNNING" ? 1 : 0,
    passed: completed ? (criticalFailure ? 1 : 2) : status === "RUNNING" ? 1 : 0,
    warning: 0,
    failed: criticalFailure ? 1 : 0,
    error: 0,
    skipped: 0,
    criticalTotal: completed ? 1 : 0,
    criticalPassed: completed && !criticalFailure ? 1 : 0,
    passRate: completed ? (criticalFailure ? 0.5 : 1) : null,
    aggregateHash: "d".repeat(64),
  };
  return {
    id: "evaluation-publication-1",
    corpusKind: "STRUCTURED_V2",
    runKey: "evaluation-publication-1",
    runKind: "PUBLICATION",
    status,
    snapshotKind: "DRAFT_CANDIDATE",
    target: "DRAFT",
    targetKey: "workspace-v2",
    publicationId: null,
    candidateId: "workspace-v2",
    candidateVersion: state.evaluationCandidateVersion ?? state.candidateVersion,
    candidateManifestHash: state.evaluationCandidateManifestHash ?? state.candidateManifestHash,
    datasetVersion: "publication-dataset-v1",
    testCaseSetHash: state.evaluationRunTestCaseSetHash ?? state.evaluationTestCaseSetHash,
    configHash: "e".repeat(64),
    hasRestrictedConfig: true,
    versions: {
      parser: null,
      normalizer: null,
      chunker: null,
      embedding: null,
      sparse: null,
      reranker: null,
      retrievalPolicy: "knowledge-v2",
      promptPolicy: "knowledge-v2",
      graph: "knowledge-v2-test-v1",
      generatorModel: "mock-model",
      judgeModel: null,
      judgePrompt: null,
      codeCommit: "mock-commit",
    },
    provider: "mock",
    modelProcessorPolicyHash: "f".repeat(64),
    environment: "test",
    requestedBy: { id: "user-owner", displayName: "Alex Morgan" },
    startedAt: status === "QUEUED" ? null : "2026-07-12T12:00:01.000Z",
    completedAt: completed || status === "FAILED" ? "2026-07-12T12:00:03.000Z" : null,
    cancelledAt: status === "CANCELLED" ? "2026-07-12T12:00:03.000Z" : null,
    results: [],
    aggregate,
    etag: `"evaluation-publication-1-${status.toLowerCase()}"`,
    pollAfterMs: status === "QUEUED" || status === "RUNNING" ? 750 : null,
    error:
      status === "FAILED"
        ? {
            code: "KNOWLEDGE_CONFLICT_DRAFT_SNAPSHOT_UNAVAILABLE",
            message: "The exact draft snapshot is no longer available.",
            retryable: false,
          }
        : null,
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:03.000Z",
  };
}

async function fulfillJson(
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

async function installKnowledgeMocks(page: Page, forbidden = false, canManageSettings = true) {
  const state: KnowledgeMockState = {
    forbidden,
    canManageSettings,
    published: false,
    overviewGets: 0,
    historyGets: 0,
    activeGets: 0,
    validationBodies: [],
    publicationBodies: [],
    validationKeys: [],
    publicationKeys: [],
    jobPolls: 0,
    jobStatus: null,
    holdJob: false,
    failJob: false,
    candidateVersion: 8,
    candidateManifestHash: candidateManifestHash8,
    validationId: null,
    evaluationTestCaseSetHash,
    evaluationStatus: null,
    evaluationScenario: "SUCCESS",
    evaluationCandidateVersion: null,
    evaluationCandidateManifestHash: null,
    evaluationRunTestCaseSetHash: null,
    evaluationListGets: 0,
    evaluationPolls: 0,
    evaluationBodies: [],
    evaluationKeys: [],
    settings: initialSettings(),
    settingsBodies: [],
    capability: {
      id: "general-faq",
      capabilityType: "GENERAL_FAQ",
      targetKey: "workspace-v2",
      name: "General FAQ",
      enabled: true,
      allowedAutonomy: "ANSWER_ONLY",
      scope: null,
      templateKey: "platform.capability.general-faq",
      templateVersion: 1,
      serverOwned: true,
      version: 1,
      etag: '"kv2-capability-general-faq-1"',
      updatedAt: evaluatedAt,
    },
    capabilityBodies: [],
  };

  await page.route("**/api/business-profile", async (route) => {
    const profile = businessProfile();
    await fulfillJson(route, { data: profile }, 200, { etag: profile.etag });
  });

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      state.overviewGets += 1;
      if (state.forbidden) {
        await fulfillJson(
          route,
          {
            error: {
              code: "HTTP_ERROR",
              message: "Insufficient workspace role.",
              requestId: "request-knowledge-forbidden",
              retryable: false,
            },
          },
          403,
        );
        return;
      }
      await fulfillJson(route, { data: overview(state) });
      return;
    }

    if (pathname === "/api/knowledge/v2/readiness" && method === "GET") {
      await fulfillJson(route, {
        data: readiness(
          state.published,
          state.jobStatus,
          state.candidateVersion,
          state.candidateManifestHash,
          state.validationId,
          state.evaluationTestCaseSetHash,
        ),
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/capabilities" && method === "GET") {
      await fulfillJson(route, {
        data: {
          targetKey: "workspace-v2",
          capabilitySetHash: "d".repeat(64),
          items: [state.capability],
        },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/capabilities/GENERAL_FAQ" && method === "PATCH") {
      const body = request.postDataJSON() as {
        enabled?: boolean;
        allowedAutonomy?: KnowledgeV2CapabilityView["allowedAutonomy"];
      };
      state.capabilityBodies.push(body);
      const version = state.capability.version + 1;
      state.capability = {
        ...state.capability,
        ...body,
        version,
        etag: `"kv2-capability-general-faq-${version}"`,
      };
      await fulfillJson(
        route,
        { data: { resource: state.capability, idempotencyReplayed: false } },
        200,
        { etag: state.capability.etag },
      );
      return;
    }

    if (pathname === "/api/knowledge/v2/settings" && method === "GET") {
      await fulfillJson(route, { data: state.settings }, 200, { etag: state.settings.etag });
      return;
    }

    if (pathname === "/api/knowledge/v2/settings" && method === "PATCH") {
      const body = request.postDataJSON() as {
        defaultLocale?: string;
        supportedLocales?: string[];
        defaultScope?: KnowledgeV2ScopeInput | null;
      };
      state.settingsBodies.push(body);
      const defaultScope =
        body.defaultScope === undefined
          ? state.settings.defaultScope
          : body.defaultScope === null
            ? null
            : {
                usesTenantDefault: false,
                brandIds: body.defaultScope.brandIds ?? [],
                locationIds: body.defaultScope.locationIds ?? [],
                channelTypes: body.defaultScope.channelTypes ?? [],
                assistantIds: body.defaultScope.assistantIds ?? [],
                audiences: body.defaultScope.audiences ?? [],
                segments: body.defaultScope.segments ?? [],
                locales: body.defaultScope.locales ?? [],
              };
      state.settings = {
        ...state.settings,
        version: state.settings.version + 1,
        etag: `"kv2-settings-${state.settings.version + 1}"`,
        defaultLocale: body.defaultLocale ?? state.settings.defaultLocale,
        supportedLocales: body.supportedLocales ?? state.settings.supportedLocales,
        defaultScope,
        defaultScopeGeneration:
          body.defaultScope === undefined
            ? state.settings.defaultScopeGeneration
            : state.settings.defaultScopeGeneration + 1,
        defaultScopeHash:
          body.defaultScope === undefined ? state.settings.defaultScopeHash : "e".repeat(64),
      };
      await fulfillJson(
        route,
        { data: { resource: state.settings, idempotencyReplayed: false } },
        200,
        { etag: state.settings.etag },
      );
      return;
    }

    if (pathname === "/api/knowledge/v2/sources" && method === "GET") {
      await fulfillJson(route, {
        data: { items: [], pageInfo: { limit: 25, nextCursor: null, hasNextPage: false } },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/review-items" && method === "GET") {
      await fulfillJson(route, {
        data: {
          items: [],
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/facts" && method === "GET") {
      await fulfillJson(route, {
        data: { items: [], pageInfo: { limit: 50, nextCursor: null, hasNextPage: false } },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/guidance" && method === "GET") {
      await fulfillJson(route, {
        data: { items: [], pageInfo: { limit: 100, nextCursor: null, hasNextPage: false } },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/evaluation-runs" && method === "GET") {
      state.evaluationListGets += 1;
      await fulfillJson(route, {
        data: {
          items: state.evaluationStatus ? [evaluationRun(state)] : [],
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/evaluation-runs" && method === "POST") {
      const body = request.postDataJSON() as {
        candidateVersion: number;
        candidateManifestHash: string;
      };
      state.evaluationBodies.push(body);
      state.evaluationKeys.push(request.headers()["idempotency-key"]);
      state.evaluationCandidateVersion = body.candidateVersion;
      state.evaluationCandidateManifestHash = body.candidateManifestHash;
      state.evaluationRunTestCaseSetHash = state.evaluationTestCaseSetHash;
      state.evaluationStatus = "QUEUED";
      state.evaluationPolls = 0;
      await fulfillJson(
        route,
        { data: { resource: evaluationRun(state), idempotencyReplayed: false } },
        202,
        { etag: '"evaluation-publication-1-queued"' },
      );
      return;
    }

    if (
      pathname === "/api/knowledge/v2/evaluation-runs/evaluation-publication-1" &&
      method === "GET"
    ) {
      state.evaluationPolls += 1;
      if (state.evaluationScenario === "HOLD") state.evaluationStatus = "RUNNING";
      else if (state.evaluationScenario === "FAILED") state.evaluationStatus = "FAILED";
      else state.evaluationStatus = state.evaluationPolls >= 2 ? "SUCCEEDED" : "RUNNING";
      await fulfillJson(route, { data: evaluationRun(state) });
      return;
    }

    if (pathname === "/api/knowledge/v2/publications/active" && method === "GET") {
      state.activeGets += 1;
      const sequence = state.published ? 8 : 7;
      await fulfillJson(route, { data: publicationDetail(sequence) }, 200, {
        etag: `"kv2-active-${sequence}"`,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/publications" && method === "GET") {
      state.historyGets += 1;
      const items = state.published
        ? [
            publicationSummary(8, "ACTIVE", true),
            publicationSummary(7, "SUPERSEDED", false),
            publicationSummary(6, "SUPERSEDED", false),
          ]
        : [publicationSummary(7, "ACTIVE", true), publicationSummary(6, "SUPERSEDED", false)];
      await fulfillJson(route, {
        data: { items, pageInfo: { limit: 25, nextCursor: null, hasNextPage: false } },
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/publications/validate" && method === "POST") {
      state.validationBodies.push(request.postDataJSON());
      state.validationKeys.push(request.headers()["idempotency-key"]);
      state.validationId = `validation-${state.candidateVersion}`;
      await fulfillJson(
        route,
        { data: { resource: validationResult(state), idempotencyReplayed: false } },
        201,
        { etag: `"kv2-validation-${state.candidateVersion}"` },
      );
      return;
    }

    if (pathname === "/api/knowledge/v2/publications" && method === "POST") {
      state.publicationBodies.push(request.postDataJSON());
      state.publicationKeys.push(request.headers()["idempotency-key"]);
      state.jobStatus = "QUEUED";
      await fulfillJson(
        route,
        {
          data: {
            jobId: "job-publish-8",
            status: "QUEUED",
            acceptedAt: "2026-07-12T12:01:00.000Z",
            resource: { type: "PUBLICATION", id: "publication-8", label: "Publication #8" },
            idempotencyReplayed: false,
          },
        },
        202,
      );
      return;
    }

    if (pathname === "/api/knowledge/v2/jobs/job-publish-8" && method === "GET") {
      state.jobPolls += 1;
      if (state.failJob) state.jobStatus = "FAILED";
      else if (state.holdJob) state.jobStatus = "RUNNING";
      else if (state.jobPolls >= 2) {
        state.jobStatus = "SUCCEEDED";
        state.published = true;
      } else {
        state.jobStatus = "RUNNING";
      }
      await fulfillJson(route, {
        data: publicationJob(state.jobStatus),
      });
      return;
    }

    await fulfillJson(
      route,
      {
        error: {
          code: "HTTP_ERROR",
          message: `Unhandled Knowledge mock: ${method} ${pathname}`,
          requestId: "request-unhandled-knowledge-mock",
          retryable: false,
        },
      },
      501,
    );
  });

  return state;
}

async function authenticate(page: Page) {
  await loginAsCleanUser(page, apiBase);
  const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
    data: { locale: "en" },
  });
  expect(localeResponse.ok()).toBeTruthy();
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
}

async function expectNoHorizontalPageOverflow(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
        }),
      { message: "The Knowledge workspace must not overflow the page horizontally." },
    )
    .toBeLessThanOrEqual(1);
}

async function selectMobileKnowledgeView(page: Page, label: string) {
  await page.getByTestId("knowledge-mobile-view-selector").click();
  const options = page.getByRole("option");
  const optionHeights = await options.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height),
  );
  expect(optionHeights.length).toBeGreaterThan(0);
  expect(Math.min(...optionHeights)).toBeGreaterThanOrEqual(44);
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function expectNoRawKnowledgeKeys(page: Page) {
  await expect.poll(() => page.locator("body").innerText()).not.toMatch(/knowledge\.[a-z]/i);
}

async function openAdvancedBusinessSettings(page: Page) {
  const advanced = page.getByTestId("knowledge-business-advanced");
  await advanced.locator("summary").click();
  await expect(advanced).toHaveAttribute("open", "");
}

test("Knowledge defaults to English and switches to Russian without raw keys", async ({ page }) => {
  await authenticate(page);
  await installKnowledgeMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=overview`, { waitUntil: "domcontentloaded" });

  const switcher = page.locator('[data-testid="language-switcher"]:visible').first();
  await expect(switcher).toHaveAttribute("data-locale", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Business knowledge" })).toBeVisible();
  await expect(page.getByTestId("knowledge-tab-overview")).toHaveText(/Overview/);
  await expectNoRawKnowledgeKeys(page);

  await switcher.click();
  await page.getByTestId("language-option-ru").click();
  await expect(switcher).toHaveAttribute("data-locale", "ru");
  await expect(page.getByRole("heading", { level: 1, name: "Знания о бизнесе" })).toBeVisible();
  await expect(page.getByTestId("knowledge-tab-overview")).toHaveText(/Обзор/);
  await expect(page.getByText("Опубликованные знания активны")).toBeVisible();

  await page.getByTestId("knowledge-tab-business").click();
  await openAdvancedBusinessSettings(page);
  await expect(page.getByText("Языки клиентов")).toBeVisible();
  await expect(page.getByText("Фактов о компании пока нет")).toBeVisible();

  await page.getByTestId("knowledge-tab-guidance").click();
  await expect(page.getByRole("heading", { name: "Правила общения" })).toBeVisible();

  await page.getByTestId("knowledge-tab-sources").click();
  await expect(page.getByRole("heading", { name: "Источники", exact: true })).toBeVisible();
  await expect(page.getByText("Источников пока нет")).toBeVisible();

  await page.getByTestId("knowledge-tab-history").click();
  await expect(page.getByRole("heading", { name: "Опубликованные версии" })).toBeVisible();
  await expect(page.getByTestId("knowledge-validate-button")).toHaveText(/Проверить черновик/);
  await expectNoRawKnowledgeKeys(page);
});

test("capability controls keep published state separate and update the draft with ETags", async ({
  page,
}) => {
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=overview`, { waitUntil: "domcontentloaded" });

  const serving = page.getByTestId("knowledge-serving-capabilities");
  const draft = page.getByTestId("knowledge-draft-capabilities");
  await expect(serving.getByText("General questions")).toBeVisible();
  await expect(draft.locator('[data-capability-type="GENERAL_FAQ"]')).toBeVisible();

  const row = draft.locator('[data-capability-type="GENERAL_FAQ"]');
  await row.getByRole("switch", { name: "Disable General questions" }).click();
  await expect.poll(() => state.capabilityBodies).toContainEqual({ enabled: false });
  await expect(row.getByText("Saved")).toBeVisible();
  await expect(serving.getByText("General questions")).toBeVisible();

  await row.getByRole("combobox", { name: "Allowed behavior for General questions" }).click();
  await expect(page.getByRole("option", { name: "Act after confirmation" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Act automatically" })).toHaveCount(0);
  await page.getByRole("option", { name: "Collect information" }).click();
  await expect
    .poll(() => state.capabilityBodies)
    .toContainEqual({
      allowedAutonomy: "COLLECT_INFORMATION",
    });
  await expect(row.getByText("Collect information")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/playwright/knowledge-capabilities-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(draft.locator('[data-capability-type="GENERAL_FAQ"]')).toBeVisible();
  const mobileCapabilityTargets = row.locator('button[role="combobox"], button[role="switch"]');
  const mobileCapabilitySizes = await mobileCapabilityTargets.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    }),
  );
  expect(mobileCapabilitySizes).toHaveLength(2);
  expect(mobileCapabilitySizes.every(({ height, width }) => height >= 44 && width >= 44)).toBe(
    true,
  );
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/playwright/knowledge-capabilities-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("Knowledge default audience preserves hidden scope and is read-only without permission", async ({
  page,
  browser,
}) => {
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${webBase}/app/knowledge`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("knowledge-mobile-view-selector")).toContainText(
    "Business information",
  );
  await openAdvancedBusinessSettings(page);

  const settingsPanel = page.getByTestId("knowledge-language-settings");
  const defaultAudience = page.getByTestId("knowledge-default-audience");
  await expect(defaultAudience.getByRole("radio", { name: "Everyone" })).toBeChecked();
  await expect(settingsPanel).not.toContainText("brand-private");
  await expect(settingsPanel).not.toContainText("location-private");

  await defaultAudience.getByText("Signed-in customers", { exact: true }).click();
  await expect.poll(() => state.settingsBodies.length).toBe(1);
  expect(state.settingsBodies[0]).toMatchObject({
    defaultScope: {
      brandIds: ["brand-private"],
      locationIds: ["location-private"],
      channelTypes: ["WEBSITE"],
      assistantIds: ["assistant-private"],
      audiences: ["AUTHENTICATED_CUSTOMER"],
      segments: ["vip"],
      locales: ["en"],
    },
  });
  await expect(defaultAudience.getByRole("radio", { name: "Signed-in customers" })).toBeChecked();
  await expect(settingsPanel.getByText("Saved")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const readOnlyContext = await browser.newContext();
  const readOnlyPage = await readOnlyContext.newPage();
  try {
    await authenticate(readOnlyPage);
    const readOnlyState = await installKnowledgeMocks(readOnlyPage, false, false);
    await readOnlyPage.goto(`${webBase}/app/knowledge`, { waitUntil: "domcontentloaded" });
    await readOnlyPage.getByTestId("knowledge-tab-business").click();
    await openAdvancedBusinessSettings(readOnlyPage);
    const readOnlyAudience = readOnlyPage.getByTestId("knowledge-default-audience");
    await expect(readOnlyAudience.getByRole("radio", { name: "Everyone" })).toBeDisabled();
    await expect(
      readOnlyAudience.getByRole("radio", { name: "Signed-in customers" }),
    ).toBeDisabled();
    await expect(readOnlyAudience.getByRole("radio", { name: "Team only" })).toBeDisabled();
    expect(readOnlyState.settingsBodies).toHaveLength(0);
  } finally {
    await readOnlyContext.close();
  }
});

test("app Knowledge navigation preserves all views and shows honest availability", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await authenticate(page);
  await installKnowledgeMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });

  const sidebarLink = page.locator('aside nav a[href="/app/knowledge"]');
  await expect(sidebarLink).toBeVisible({ timeout: 15_000 });
  await sidebarLink.click();
  await expect(page).toHaveURL(`${webBase}/app/knowledge`, { timeout: 45_000 });
  await expect(page.getByTestId("knowledge-page")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByTestId("knowledge-tab-business")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("business-profile-editor")).toBeVisible();
  await page.getByTestId("knowledge-tab-overview").click();

  await expect(page.getByText("Serving customers: Ready")).toBeVisible();
  await expect(page.getByText("Draft workspace: Changes pending")).toBeVisible();
  await expect(page.getByText("Published knowledge is active")).toBeVisible();
  await expect(page.getByText("Draft version 8")).toBeVisible();
  await expect(
    page.getByTestId("knowledge-serving-capabilities").getByText("General questions"),
  ).toBeVisible();
  await expect(page.getByText("Ready with warnings", { exact: true })).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-overview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/knowledge\?view=business(?:&|$)/);
  await page.getByTestId("knowledge-tab-overview").click();
  await expect(page.getByTestId("knowledge-overview")).toBeVisible();

  const tabs = [
    "overview",
    "business",
    "sources",
    "guidance",
    "review",
    "test",
    "history",
  ] as const;
  for (const view of tabs) {
    const tab = page.getByTestId(`knowledge-tab-${view}`);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`/app/knowledge\\?view=${view}(?:&|$)`));
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("knowledge-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`knowledge-tab-${view}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    if (view === "sources") {
      await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
      await expect(page.getByText("No sources yet")).toBeVisible();
    } else if (view === "review") {
      await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
      await expect(page.getByText("Nothing needs review")).toBeVisible();
    } else if (view === "test") {
      await expect(page.getByRole("heading", { name: "Test knowledge" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Question test" })).toBeVisible();
    }
  }

  for (let index = tabs.length - 2; index >= 0; index -= 1) {
    await page.goBack();
    const view = tabs[index];
    await expect(page).toHaveURL(new RegExp(`/app/knowledge\\?view=${view}(?:&|$)`));
    await expect(page.getByTestId(`knowledge-tab-${view}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
});

test("History validates and publishes one exact candidate before refetching state", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("knowledge-publication-history")).toBeVisible();

  const initialOverviewGets = state.overviewGets;
  const initialHistoryGets = state.historyGets;
  await page.getByTestId("knowledge-validate-button").click();
  await expect(page.getByRole("heading", { name: "Check before publishing" })).toBeVisible();
  await expect(
    page.getByTestId("knowledge-validation-result").getByText("Passed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No required fixes or warnings were reported.")).toBeVisible();
  const evaluationPanel = page.getByTestId("knowledge-publication-evaluation");
  await expect(evaluationPanel.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(evaluationPanel).toContainText("Critical tests passed: 1 of 1");
  await expect(evaluationPanel).toContainText("Passed: 2");

  expect(state.validationBodies).toEqual([
    { targetKey: "workspace-v2", candidateId: "workspace-v2", candidateVersion: 8 },
  ]);
  expect(state.validationKeys[0]).toMatch(/^kv2:/);
  expect(state.evaluationBodies).toEqual([
    {
      target: "DRAFT",
      runKind: "PUBLICATION",
      candidateId: "workspace-v2",
      candidateVersion: 8,
      candidateManifestHash: candidateManifestHash8,
    },
  ]);
  expect(state.evaluationKeys[0]).toMatch(/^kv2:/);

  await expect(page.getByTestId("knowledge-publish-review-button")).toBeEnabled();
  await page.getByTestId("knowledge-publish-review-button").click();
  await expect(page.getByRole("dialog", { name: "Publish this reviewed version?" })).toBeVisible();
  await page.getByRole("button", { name: "Start publishing" }).click();

  expect(state.publicationBodies).toEqual([
    {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 8,
      validationId: "validation-8",
    },
  ]);
  expect(state.publicationKeys[0]).toMatch(/^kv2:/);

  const operation = page
    .locator('section[aria-live="polite"]')
    .filter({ hasText: "Publishing update" });
  await expect(operation).toContainText("Publishing update");
  await expect(operation).toContainText("Completed", { timeout: 15_000 });
  await expect(page.getByTestId("knowledge-publication-row-publication-8")).toBeVisible();
  await expect.poll(() => state.jobPolls).toBeGreaterThanOrEqual(2);
  await expect.poll(() => state.historyGets).toBeGreaterThan(initialHistoryGets);
  await expect.poll(() => state.overviewGets).toBeGreaterThan(initialOverviewGets);
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-history-published-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("History blocks publishing when a critical publication test fails", async ({ page }) => {
  test.setTimeout(60_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  state.evaluationScenario = "CRITICAL_FAILURE";
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-validate-button").click();
  const evaluationPanel = page.getByTestId("knowledge-publication-evaluation");
  await expect(evaluationPanel.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(evaluationPanel).toContainText("Critical tests requiring attention: 1");
  await expect(evaluationPanel).toContainText("Critical tests passed: 0 of 1");
  await expect(evaluationPanel).toContainText("Failed: 1");
  await expect(evaluationPanel.getByRole("button", { name: "View tests" })).toBeVisible();
  await expect(evaluationPanel.getByRole("button", { name: "Open review" })).toBeVisible();
  await expect(page.getByTestId("knowledge-publish-review-button")).toBeDisabled();
  expect(state.publicationBodies).toHaveLength(0);
});

test("History preserves a stale evaluation without reusing it for the latest draft", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  state.evaluationScenario = "HOLD";
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-validate-button").click();
  await expect(
    page.getByTestId("knowledge-publication-evaluation").getByText("In progress", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close" }).click();

  state.candidateVersion = 9;
  state.candidateManifestHash = candidateManifestHash9;
  state.validationId = null;
  await page.getByTestId("knowledge-tab-overview").click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("knowledge-tab-history").click();

  const evaluationPanel = page.getByTestId("knowledge-publication-evaluation");
  await expect(evaluationPanel).toContainText("Tests belong to an earlier draft");
  await expect(evaluationPanel).toContainText(
    "Draft version 8 was tested; the current draft is version 9.",
  );
  await expect(evaluationPanel.getByRole("button", { name: "View tests" })).toBeVisible();
  await expect(evaluationPanel.getByRole("button", { name: "Open review" })).toBeVisible();
  await expect(evaluationPanel.getByRole("button", { name: "Review and publish" })).toHaveCount(0);
});

test("History recovers an exact running evaluation after navigation", async ({ page }) => {
  test.setTimeout(60_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  state.evaluationScenario = "HOLD";
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-validate-button").click();
  await expect(
    page.getByTestId("knowledge-publication-evaluation").getByText("In progress", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close" }).click();
  const pollsBeforeNavigation = state.evaluationPolls;
  const listsBeforeNavigation = state.evaluationListGets;

  await page.getByTestId("knowledge-tab-overview").click();
  await expect(page.getByTestId("knowledge-overview")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("knowledge-tab-history").click();
  const recoveredPanel = page.getByTestId("knowledge-publication-evaluation");
  await expect(recoveredPanel.getByText("In progress", { exact: true })).toBeVisible();
  await expect.poll(() => state.evaluationListGets).toBeGreaterThan(listsBeforeNavigation);
  await expect.poll(() => state.evaluationPolls).toBeGreaterThan(pollsBeforeNavigation);
  expect(state.evaluationBodies).toHaveLength(1);
});

test("critical publication diagnostics fit the mobile History modal", async ({ page }) => {
  test.setTimeout(60_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  state.evaluationScenario = "CRITICAL_FAILURE";
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-validate-button").click();
  const evaluationPanel = page.getByTestId("knowledge-publication-evaluation");
  await expect(evaluationPanel).toContainText("Critical tests requiring attention: 1", {
    timeout: 15_000,
  });
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-history-evaluation-failed-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("publishing progress is rediscovered after navigation and resumes one poller", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  state.holdJob = true;
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-validate-button").click();
  await expect(page.getByTestId("knowledge-publish-review-button")).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByTestId("knowledge-publish-review-button").click();
  await page.getByRole("button", { name: "Start publishing" }).click();
  const operation = page.locator('section[aria-live="polite"]').filter({
    hasText: "Publishing update",
  });
  await expect(operation).toContainText("job-publish-8");
  await expect(operation).toContainText(/Waiting|In progress/);

  await page.getByTestId("knowledge-tab-overview").click();
  await expect(page.getByTestId("knowledge-overview")).toBeVisible();
  await page.getByTestId("knowledge-tab-history").click();
  await expect(operation).toContainText("job-publish-8");
  const pollsAfterReturn = state.jobPolls;
  await expect.poll(() => state.jobPolls).toBeGreaterThan(pollsAfterReturn);

  state.holdJob = false;
  await expect(operation).toContainText("Completed", { timeout: 15_000 });
  await expect(page.getByTestId("knowledge-publication-row-publication-8")).toBeVisible();
});

test("failed publication context survives remount and retries from a mobile layout", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const state = await installKnowledgeMocks(page);
  state.failJob = true;
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  await page.getByTestId("knowledge-validate-button").click();
  await expect(page.getByTestId("knowledge-publish-review-button")).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByTestId("knowledge-publish-review-button").click();
  await page.getByRole("button", { name: "Start publishing" }).click();
  const operation = page.locator('section[aria-live="polite"]').filter({
    hasText: "Publishing update",
  });
  await expect(operation).toContainText("Failed", { timeout: 15_000 });

  await page.getByTestId("knowledge-tab-overview").click();
  await expect(page.getByTestId("knowledge-overview")).toBeVisible();
  await expect(page).toHaveURL(/view=overview/);
  await page.setViewportSize({ width: 375, height: 812 });
  await selectMobileKnowledgeView(page, "History");
  await expect(page).toHaveURL(/view=history/);
  await expect(page.getByTestId("knowledge-publication-history")).toBeVisible();
  await expect(operation).toContainText("Knowledge processing did not complete.");
  await expect(operation.getByRole("button", { name: "Try again" })).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-history-failed-job-mobile.png",
    fullPage: true,
    animations: "disabled",
  });

  const validationsBeforeRetry = state.validationBodies.length;
  await operation.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Check before publishing" })).toBeVisible();
  await expect.poll(() => state.validationBodies.length).toBeGreaterThan(validationsBeforeRetry);
});

test("mobile Knowledge navigation keeps direct links, history, and localized views visible", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await authenticate(page);
  await installKnowledgeMocks(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${webBase}/app/knowledge?view=history`, { waitUntil: "domcontentloaded" });

  const selector = page.getByTestId("knowledge-mobile-view-selector");
  await expect(selector).toBeVisible();
  await expect(selector).toContainText("History");
  await expect(page.getByTestId("knowledge-tab-history")).toBeHidden();
  await expect(page.getByTestId("knowledge-publication-history")).toBeVisible();
  const selectorBox = await selector.boundingBox();
  expect(selectorBox?.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalPageOverflow(page);

  await selectMobileKnowledgeView(page, "Sources");
  await expect(page).toHaveURL(/\/app\/knowledge\?view=sources$/);
  await expect(selector).toContainText("Sources");
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/knowledge\?view=history$/);
  await expect(selector).toContainText("History");
  await expect(page.getByTestId("knowledge-publication-history")).toBeVisible();
  await page.goForward({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/knowledge\?view=sources$/);
  await expect(selector).toContainText("Sources");

  const localizedSources = ["ru", "de", "fr"] as const satisfies readonly Locale[];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of localizedSources) {
    const localeResponse = await page.request.patch(`${apiBase}/settings/preferences/locale`, {
      data: { locale },
    });
    expect(localeResponse.ok()).toBeTruthy();
    await page
      .context()
      .addCookies([{ name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" }]);
    await page.goto(`${webBase}/app/knowledge?view=sources`, {
      waitUntil: "domcontentloaded",
    });
    await expect(selector).toContainText(messages[locale]["knowledge.page.tab.sources"]);
    await expect(
      page.getByRole("heading", {
        name: messages[locale]["knowledge.sources.title"],
        exact: true,
      }),
    ).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  }

  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-sources-mobile-selector.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("demo sidebar exposes read-only Knowledge", async ({ page }) => {
  test.setTimeout(60_000);
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "en", url: webBase, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/demo`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const demoNavigation = page.locator("aside nav");
  await expect(demoNavigation.getByRole("link", { name: "Settings" })).toBeVisible({
    timeout: 15_000,
  });
  const knowledgeLink = demoNavigation.getByRole("link", { name: "Knowledge", exact: true });
  await expect(knowledgeLink).toBeVisible();
  await expect(knowledgeLink).toHaveAttribute("href", "/demo/knowledge");
});

test("forbidden Knowledge request renders the route permission state", async ({ page }) => {
  await authenticate(page);
  await installKnowledgeMocks(page, true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/knowledge`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Knowledge access is restricted")).toBeVisible();
  await expect(
    page.getByText("Only workspace owners, administrators, and managers can open this area."),
  ).toBeVisible();
  await expect(page.getByText("Knowledge could not be loaded")).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-forbidden-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});
