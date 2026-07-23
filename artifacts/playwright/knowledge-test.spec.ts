import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  KnowledgeV2CreateTestRunRequest,
  KnowledgeV2OverviewView,
  KnowledgeV2TestCaseView,
  KnowledgeV2TestRunView,
} from "@leadvirt/types";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

interface CapturedMutation {
  pathname: string;
  body: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
}

interface TestMockState {
  cases: KnowledgeV2TestCaseView[];
  questions: Record<string, string>;
  mutations: CapturedMutation[];
  runRequests: KnowledgeV2CreateTestRunRequest[];
  currentRun: KnowledgeV2TestRunView;
  runPolls: number;
  runMode: "SUCCESS" | "FAILED" | "REDACTED";
  conflictNextUpdate: boolean;
  forbidInput: boolean;
}

function overview(): KnowledgeV2OverviewView {
  return {
    readiness: {
      targetKey: "workspace-v2",
      candidateId: "workspace-v2",
      candidateVersion: 9,
      candidateManifestHash: "a".repeat(64),
      activePublicationId: "publication-8",
      activePublicationSequence: 8,
      status: "NEEDS_REVIEW",
      serving: {
        status: "READY",
        activePublicationId: "publication-8",
        activePublicationSequence: 8,
        activeEtag: '"active-8"',
        itemCounts: {
          documentRevisions: 2,
          factVersions: 3,
          guidanceRuleVersions: 1,
          sourcePermissionSnapshots: 1,
        },
        blockers: [],
        capabilitySetHash: "b".repeat(64),
        requirementEvaluationSetHash: "c".repeat(64),
        capabilities: [],
      },
      draft: {
        status: "CHANGES_PENDING",
        candidateId: "workspace-v2",
        candidateVersion: 9,
        candidateManifestHash: "a".repeat(64),
        validationId: "validation-9",
        evaluationTestCaseSetHash: "d".repeat(64),
        itemCounts: {
          documentRevisions: 3,
          factVersions: 4,
          guidanceRuleVersions: 2,
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
      needsReviewCount: 1,
      evaluatedAt: "2026-07-12T12:00:00.000Z",
    },
    activePublication: null,
    latestDraftPublication: null,
    counts: { sources: 0, facts: 4, guidanceRules: 2, reviewItems: 1, failedJobs: 0 },
    recentJobs: [],
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

function testCases(): KnowledgeV2TestCaseView[] {
  return [
    {
      id: "case-pricing",
      corpusKind: "STRUCTURED_V2",
      caseKey: "tenant:pricing",
      safeLabel: "First consultation price",
      origin: "TENANT",
      status: "ACTIVE",
      riskLevel: "HIGH",
      critical: true,
      currentVersion: {
        id: "case-pricing-v1",
        versionNumber: 1,
        queryHash: "query-hash-pricing",
        hasRestrictedInput: true,
        expectedBehavior: "ANSWER",
        locale: "en",
        channelType: "WEBSITE",
        audience: "PUBLIC",
        scope: {
          brandIds: ["brand-paris"],
          locationIds: ["location-paris"],
          segments: ["new-customer"],
        },
        sliceKeys: ["pricing"],
        datasetVersion: "tenant-v1",
        riskLevel: "HIGH",
        supersedesVersionId: null,
        immutableHash: "immutable-pricing-v1",
        createdBy: { id: "owner", displayName: "Owner" },
        expectations: [
          {
            id: "expectation-price",
            ordinal: 0,
            kind: "REQUIRED_FACT",
            factId: "fact-price",
            guidanceRuleId: null,
            evidenceReferenceId: null,
            semanticKey: "consultation.price",
            expectedValueHash: null,
            hasRestrictedExpectedValue: true,
            createdAt: "2026-07-12T10:00:00.000Z",
          },
        ],
        createdAt: "2026-07-12T10:00:00.000Z",
      },
      latestVersionNumber: 1,
      createdBy: { id: "owner", displayName: "Owner" },
      archivedBy: null,
      archivedAt: null,
      etag: '"case-pricing:1"',
      allowedActions: ["EDIT", "ARCHIVE"],
      createdAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:00:00.000Z",
    },
    {
      id: "case-handoff",
      corpusKind: "STRUCTURED_V2",
      caseKey: "platform:handoff",
      safeLabel: "Medical advice handoff",
      origin: "PLATFORM",
      status: "ACTIVE",
      riskLevel: "CRITICAL",
      critical: true,
      currentVersion: {
        id: "case-handoff-v1",
        versionNumber: 1,
        queryHash: "query-hash-handoff",
        hasRestrictedInput: true,
        expectedBehavior: "HANDOFF",
        locale: "en",
        channelType: "TELEGRAM",
        audience: "PUBLIC",
        scope: null,
        sliceKeys: ["safety"],
        datasetVersion: "platform-v1",
        riskLevel: "CRITICAL",
        supersedesVersionId: null,
        immutableHash: "immutable-handoff-v1",
        createdBy: null,
        expectations: [],
        createdAt: "2026-07-12T10:00:00.000Z",
      },
      latestVersionNumber: 1,
      createdBy: null,
      archivedBy: null,
      archivedAt: null,
      etag: '"case-handoff:1"',
      allowedActions: [],
      createdAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:00:00.000Z",
    },
  ];
}

function runningRun(): KnowledgeV2TestRunView {
  return {
    id: "test-run-1",
    status: "RUNNING",
    target: "ACTIVE",
    testCaseId: null,
    hasRestrictedQuestion: true,
    context: {
      locale: "en",
      channelType: "WEBSITE",
      audience: "PUBLIC",
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
    targetKey: "workspace-v2",
    publicationId: "publication-8",
    publicationSequence: 8,
    candidateId: null,
    candidateVersion: null,
    candidateManifestHash: null,
    progress: { stage: "CHECKING_KNOWLEDGE", percent: 45 },
    result: null,
    error: null,
    requestedBy: { id: "owner", displayName: "Owner" },
    etag: '"test-run-1:1"',
    pollAfterMs: 100,
    createdAt: "2026-07-12T12:00:00.000Z",
    startedAt: "2026-07-12T12:00:01.000Z",
    completedAt: null,
    updatedAt: "2026-07-12T12:00:01.000Z",
  };
}

const xssText =
  'Answer <img src=x onerror="window.__knowledgeTestXss=1"> <script>window.__knowledgeTestScript=1</script>';

function succeededRun(
  redacted: boolean,
  base: KnowledgeV2TestRunView = runningRun(),
): KnowledgeV2TestRunView {
  return {
    ...base,
    status: "SUCCEEDED",
    progress: { stage: "COMPLETE", percent: 100 },
    result: {
      outcome: redacted ? "HANDED_OFF" : "ANSWERED",
      disposition: redacted ? "HANDOFF" : "AUTO_SEND",
      finalText: redacted ? null : xssText,
      finalTextRedacted: redacted,
      gateReasons: redacted
        ? ["SENSITIVE_CONTENT", "POLICY_REQUIRES_HANDOFF"]
        : ["SUFFICIENT_SUPPORT"],
      facts: [
        {
          factId: "fact-price",
          safeLabel: `Price ${xssText}`,
          safeValue: redacted ? null : "$100",
          redacted,
          verificationStatus: "VERIFIED",
          authority: "OWNER_VERIFIED",
          observedAt: "2026-07-12T11:00:00.000Z",
          expiresAt: "2026-07-13T11:00:00.000Z",
        },
      ],
      guidance: [
        {
          guidanceRuleId: "rule-price",
          safeLabel: `Pricing rule <script>window.__ruleXss=1</script>`,
          safeSummary: redacted ? null : "Quote verified public prices only.",
          redacted,
          riskLevel: "HIGH",
        },
      ],
      documents: [
        {
          evidenceReferenceId: "evidence-public",
          safeLabel: `Pricing page ${xssText}`,
          safeExcerpt: redacted ? null : `Consultation costs $100 ${xssText}`,
          isPublic: true,
          redacted,
          confidence: 0.97,
          observedAt: "2026-07-12T11:00:00.000Z",
          expiresAt: null,
          anchor: {
            pageNumber: 2,
            headingPath: [`Prices <script>window.__headingXss=1</script>`],
            urlAnchor: "pricing",
            publicUrl: "javascript:window.__unsafeLink=1",
          },
        },
        {
          evidenceReferenceId: "evidence-safe-public",
          safeLabel: "Public services page",
          safeExcerpt: "Verified services and prices.",
          isPublic: true,
          redacted: false,
          confidence: 0.95,
          observedAt: "2026-07-12T11:00:00.000Z",
          expiresAt: null,
          anchor: {
            pageNumber: 1,
            headingPath: ["Services", "Consultations"],
            urlAnchor: "consultations",
            publicUrl: "https://example.com/services#consultations",
          },
        },
        {
          evidenceReferenceId: "evidence-internal",
          safeLabel: "Internal policy",
          safeExcerpt: null,
          isPublic: false,
          redacted: true,
          confidence: null,
          observedAt: null,
          expiresAt: null,
          anchor: {
            pageNumber: null,
            headingPath: [],
            urlAnchor: null,
            publicUrl: "https://internal.example/secret",
          },
        },
      ],
      toolCalls: [
        {
          toolCallId: "tool-calendar",
          safeName: `Availability ${xssText}`,
          safeSummary: redacted ? null : "Two slots available.",
          status: "SUCCEEDED",
          redacted,
          calledAt: "2026-07-12T12:00:01.000Z",
          observedAt: "2026-07-12T12:00:01.000Z",
          expiresAt: "2026-07-12T12:05:01.000Z",
        },
      ],
      conflicts: [
        {
          conflictId: "conflict-price",
          safeLabel: redacted ? "Restricted conflict" : "Old campaign price",
          riskLevel: "MEDIUM",
          status: "OPEN",
          redacted,
        },
      ],
      missingSupport: redacted ? ["PERMISSION"] : ["REQUIRED_GUIDANCE"],
      suppressedEvidence: [{ reason: redacted ? "PERMISSION" : "STALE", count: 2 }],
      retrievalTraceId: "trace-test-1",
      latencyMs: 420,
    },
    completedAt: "2026-07-12T12:00:02.000Z",
    updatedAt: "2026-07-12T12:00:02.000Z",
    etag: '"test-run-1:2"',
  };
}

function failedRun(base: KnowledgeV2TestRunView = runningRun()): KnowledgeV2TestRunView {
  return {
    ...base,
    status: "FAILED",
    progress: { stage: "CHECKING_POLICY", percent: 75 },
    result: null,
    error: {
      code: "KNOWLEDGE_DEPENDENCY_RETRIEVAL_UNAVAILABLE",
      message: "The selected snapshot could not be tested.",
      retryable: true,
    },
    completedAt: "2026-07-12T12:00:02.000Z",
    updatedAt: "2026-07-12T12:00:02.000Z",
    etag: '"test-run-1:2"',
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

function capture(route: Route): CapturedMutation {
  const request = route.request();
  return {
    pathname: new URL(request.url()).pathname,
    body: request.postDataJSON(),
    ifMatch: request.headers()["if-match"],
    idempotencyKey: request.headers()["idempotency-key"],
  };
}

async function installMocks(
  page: Page,
  options: Partial<Pick<TestMockState, "runMode" | "conflictNextUpdate" | "forbidInput">> & {
    draftValidated?: boolean;
    draftBlocked?: boolean;
  } = {},
) {
  const state: TestMockState = {
    cases: testCases(),
    questions: {
      "case-pricing": "How much does the first consultation cost?",
      "case-handoff": "Can you diagnose these symptoms?",
    },
    mutations: [],
    runRequests: [],
    currentRun: runningRun(),
    runPolls: 0,
    runMode: options.runMode ?? "SUCCESS",
    conflictNextUpdate: options.conflictNextUpdate ?? false,
    forbidInput: options.forbidInput ?? false,
  };

  await page.route("**/api/auth/me", async (route) => {
    await fulfill(route, {
      data: {
        id: "owner",
        email: "owner@example.com",
        role: "OWNER",
        tenantId: "tenant",
        authMode: "credentials",
      },
    });
  });
  await page.route("**/api/current-tenant", async (route) => {
    await fulfill(route, {
      data: {
        id: "tenant",
        name: "LeadVirt Test Workspace",
        slug: "leadvirt-test",
        status: "ACTIVE",
        timezone: "UTC",
        role: "OWNER",
      },
    });
  });
  await page.route("**/api/billing/current-subscription", async (route) => {
    await fulfill(route, { data: null });
  });
  await page.route("**/api/dashboard/summary", async (route) => {
    await fulfill(route, {
      data: {
        metrics: {
          newLeadsCount: 0,
          aiConversationsCount: 0,
          bookingsOrdersCreated: 0,
          leadsSentToCrm: 0,
          averageResponseTimeSeconds: 0,
          conversionRate: 0,
        },
        recentLeads: [],
        recentActivity: [],
        channelPerformance: [],
        trend: [],
      },
    });
  });

  await page.route("**/api/knowledge/v2/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/knowledge/v2/overview" && method === "GET") {
      const data = overview();
      if (options.draftValidated === false) data.readiness.draft.validationId = null;
      if (options.draftBlocked) {
        data.readiness.draft.validationId = null;
        data.readiness.draft.blockers = [
          {
            code: "KNOWLEDGE_PUBLICATION_FACT_REVIEW_REQUIRED",
            status: "BLOCKED",
            title: "Business fact needs review",
            message: "Review this fact before validating the draft.",
            resource: { type: "FACT", id: "fact-price", label: "Installation price" },
          },
        ];
        data.readiness.blockerCount = 1;
      }
      await fulfill(route, { data });
      return;
    }
    if (pathname === "/api/knowledge/v2/sources" && method === "GET") {
      await fulfill(route, {
        data: {
          items: [],
          pageInfo: { limit: 100, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/test-cases" && method === "GET") {
      let items = state.cases;
      const status = url.searchParams.get("status");
      const risk = url.searchParams.get("riskLevel");
      const query = url.searchParams.get("query")?.toLowerCase();
      if (status) items = items.filter((item) => item.status === status);
      if (risk) items = items.filter((item) => item.riskLevel === risk);
      if (query) items = items.filter((item) => item.safeLabel.toLowerCase().includes(query));
      await fulfill(route, {
        data: {
          items,
          pageInfo: { limit: 25, nextCursor: null, hasNextPage: false },
        },
      });
      return;
    }
    if (pathname === "/api/knowledge/v2/test-cases" && method === "POST") {
      state.mutations.push(capture(route));
      const body = request.postDataJSON() as {
        safeLabel: string;
        question: string;
        locale: string;
        channelType: KnowledgeV2TestCaseView["currentVersion"] extends infer _Version
          ? "WEBSITE"
          : never;
      };
      const created: KnowledgeV2TestCaseView = {
        ...state.cases[0]!,
        id: "case-created",
        caseKey: "tenant:created",
        safeLabel: body.safeLabel,
        riskLevel: "MEDIUM",
        critical: false,
        currentVersion: {
          ...state.cases[0]!.currentVersion!,
          id: "case-created-v1",
          locale: body.locale,
          channelType: body.channelType,
          riskLevel: "MEDIUM",
          expectations: [],
        },
        etag: '"case-created:1"',
      };
      state.cases.unshift(created);
      state.questions[created.id] = body.question;
      await fulfill(route, { data: { resource: created, idempotencyReplayed: false } }, 201, {
        etag: created.etag,
      });
      return;
    }

    const inputMatch = pathname.match(/^\/api\/knowledge\/v2\/test-cases\/([^/]+)\/input$/);
    if (inputMatch && method === "GET") {
      if (state.forbidInput) {
        await fulfill(
          route,
          {
            error: {
              code: "KNOWLEDGE_PERMISSION_TEST_INPUT_REQUIRED",
              message: "Protected input is unavailable for this role.",
            },
          },
          403,
        );
        return;
      }
      const item = state.cases.find((entry) => entry.id === inputMatch[1])!;
      await fulfill(
        route,
        {
          data: {
            testCaseId: item.id,
            versionId: item.currentVersion!.id,
            question: state.questions[item.id],
            expectations: [{ ordinal: 0, restrictedExpectedValue: "$100" }],
          },
        },
        200,
        { "cache-control": "no-store" },
      );
      return;
    }

    const archiveMatch = pathname.match(/^\/api\/knowledge\/v2\/test-cases\/([^/]+)\/archive$/);
    if (archiveMatch && method === "POST") {
      state.mutations.push(capture(route));
      const item = state.cases.find((entry) => entry.id === archiveMatch[1])!;
      item.status = "ARCHIVED";
      item.allowedActions = [];
      item.archivedAt = "2026-07-12T13:00:00.000Z";
      item.etag = `"${item.id}:archived"`;
      await fulfill(route, { data: { resource: item, idempotencyReplayed: false } }, 200, {
        etag: item.etag,
      });
      return;
    }

    const caseMatch = pathname.match(/^\/api\/knowledge\/v2\/test-cases\/([^/]+)$/);
    if (caseMatch && method === "GET") {
      const item = state.cases.find((entry) => entry.id === caseMatch[1]);
      if (!item) {
        await fulfill(route, { error: { code: "NOT_FOUND", message: "Test not found." } }, 404);
        return;
      }
      await fulfill(route, { data: item }, 200, { etag: item.etag });
      return;
    }
    if (caseMatch && method === "PATCH") {
      state.mutations.push(capture(route));
      const item = state.cases.find((entry) => entry.id === caseMatch[1])!;
      if (state.conflictNextUpdate) {
        state.conflictNextUpdate = false;
        item.safeLabel = "Server pricing test";
        item.currentVersion!.datasetVersion = "server-v2";
        item.etag = '"case-pricing:2"';
        state.questions[item.id] = "Server-updated protected question";
        await fulfill(
          route,
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "This test changed after it was loaded.",
              details: { currentEtag: item.etag },
            },
          },
          412,
        );
        return;
      }
      const body = request.postDataJSON() as {
        safeLabel?: string;
        question?: string;
        datasetVersion?: string;
      };
      if (body.safeLabel !== undefined) item.safeLabel = body.safeLabel;
      if (body.question !== undefined) state.questions[item.id] = body.question;
      if (body.datasetVersion !== undefined)
        item.currentVersion!.datasetVersion = body.datasetVersion;
      item.latestVersionNumber += 1;
      item.currentVersion!.versionNumber = item.latestVersionNumber;
      item.etag = `"${item.id}:${item.latestVersionNumber}"`;
      await fulfill(route, { data: { resource: item, idempotencyReplayed: false } }, 200, {
        etag: item.etag,
      });
      return;
    }

    if (pathname === "/api/knowledge/v2/test-runs" && method === "POST") {
      state.mutations.push(capture(route));
      const body = request.postDataJSON() as KnowledgeV2CreateTestRunRequest;
      state.runRequests.push(body);
      state.currentRun = {
        ...runningRun(),
        target: body.target,
        testCaseId: body.testCaseId ?? null,
        publicationId: body.target === "ACTIVE" ? "publication-8" : null,
        publicationSequence: body.target === "ACTIVE" ? 8 : null,
        candidateId: body.target === "DRAFT" ? body.candidateId : null,
        candidateVersion: body.target === "DRAFT" ? body.candidateVersion : null,
        candidateManifestHash: body.target === "DRAFT" ? body.candidateManifestHash : null,
      };
      state.runPolls = 0;
      await fulfill(
        route,
        { data: { resource: state.currentRun, idempotencyReplayed: false } },
        202,
        { etag: '"test-run-1:1"' },
      );
      return;
    }
    if (pathname === "/api/knowledge/v2/test-runs/test-run-1" && method === "GET") {
      state.runPolls += 1;
      const data =
        state.runPolls < 2
          ? state.currentRun
          : state.runMode === "FAILED"
            ? failedRun(state.currentRun)
            : succeededRun(state.runMode === "REDACTED", state.currentRun);
      await fulfill(route, { data }, 200, { etag: data.etag });
      return;
    }

    await fulfill(
      route,
      { error: { code: "UNMOCKED", message: `${method} ${pathname} is not mocked.` } },
      500,
    );
  });

  return state;
}

async function openTest(page: Page, locale = "en") {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: locale, url: webBase, sameSite: "Lax" }]);
  await page.goto(`${webBase}/app/knowledge?view=test`);
  await expect(page.getByTestId("knowledge-test-workspace")).toBeVisible();
}

test("question test shows the authoritative response, evidence, disposition, and safely renders stored strings", async ({
  page,
}) => {
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|\bcsp\b/i.test(message.text())) cspErrors.push(message.text());
  });
  const state = await installMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openTest(page);

  await page.getByTestId("knowledge-test-question").fill("How much is the first consultation?");
  await page.getByTestId("knowledge-test-run").click();
  await expect(
    page.getByTestId("knowledge-test-result").getByText("Test running..."),
  ).toBeVisible();
  await expect(page.getByText("Would send automatically")).toBeVisible({ timeout: 10_000 });
  const result = page.getByTestId("knowledge-test-result");
  await expect(result).toContainText(xssText);
  await expect(result).toContainText("Business facts used");
  await expect(result).toContainText("Rules applied");
  await expect(result).toContainText("Live information checked");
  await expect(result).toContainText("Old campaign price");
  await expect(result).toContainText("Required rule");
  await expect(result).toContainText("Outdated: 2");
  await expect(result.getByRole("link", { name: "Open public source" })).toHaveAttribute(
    "href",
    "https://example.com/services#consultations",
  );
  await expect(result.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(result.locator("script, img")).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      image: (window as Window & { __knowledgeTestXss?: number }).__knowledgeTestXss,
      script: (window as Window & { __knowledgeTestScript?: number }).__knowledgeTestScript,
      unsafe: (window as Window & { __unsafeLink?: number }).__unsafeLink,
    })),
  ).toEqual({ image: undefined, script: undefined, unsafe: undefined });
  expect(cspErrors).toEqual([]);
  expect(state.runRequests).toEqual([
    {
      question: "How much is the first consultation?",
      locale: "en",
      channelType: "WEBSITE",
      audience: "PUBLIC",
      scope: null,
      target: "ACTIVE",
    },
  ]);
  expect(state.mutations[0]?.idempotencyKey).toBeTruthy();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-test-desktop.png",
    fullPage: true,
  });
});

test("saved draft tests send the exact validated manifest identity", async ({ page }) => {
  const state = await installMocks(page);
  await openTest(page);
  await page.getByRole("tab", { name: "Saved tests" }).click();
  await expect(page.getByTestId("knowledge-test-case-detail")).toContainText(
    "First consultation price",
  );
  await page.getByTestId("knowledge-test-case-run").click();
  await expect(page.getByText("First consultation price")).toBeVisible();

  await page.getByLabel("Knowledge version").click();
  await page.getByRole("option", { name: "Exact draft version 9" }).click();
  await page.getByTestId("knowledge-test-run").click();

  await expect.poll(() => state.runRequests.length).toBe(1);
  expect(state.runRequests[0]).toMatchObject({
    testCaseId: "case-pricing",
    target: "DRAFT",
    candidateId: "workspace-v2",
    candidateVersion: 9,
    candidateManifestHash: "a".repeat(64),
  });
});

test("an unvalidated draft explains the blocker and cannot start a test", async ({ page }) => {
  const state = await installMocks(page, { draftValidated: false });
  await openTest(page);
  await page.getByTestId("knowledge-test-question").fill("Can this draft answer me?");
  await page.getByLabel("Knowledge version").click();
  await page.getByRole("option", { name: "Exact draft version 9" }).click();

  await expect(page.getByTestId("knowledge-test-draft-validation-required")).toHaveText(
    "Validate this draft before running a test.",
  );
  await expect(page.getByTestId("knowledge-test-draft-remediation")).toHaveText("Check draft");
  const runButton = page.getByTestId("knowledge-test-run");
  await expect(runButton).toBeDisabled();
  await runButton.evaluate((element) => (element as HTMLButtonElement).click());
  await page.getByTestId("knowledge-test-draft-remediation").click();
  await expect(page).toHaveURL(/\/app\/knowledge\?view=history(?:&|$)/);
  expect(state.runRequests).toEqual([]);
  expect(
    state.mutations.filter((entry) => entry.pathname === "/api/knowledge/v2/test-runs"),
  ).toEqual([]);
});

test("a blocked draft routes directly to its readiness blockers", async ({ page }, testInfo) => {
  const state = await installMocks(page, { draftBlocked: true });
  await openTest(page);
  await page.getByLabel("Knowledge version").click();
  await page.getByRole("option", { name: "Exact draft version 9" }).click();

  await expect(page.getByTestId("knowledge-test-draft-validation-required")).toHaveText(
    "This draft has blockers that must be resolved before validation.",
  );
  await expect(page.getByTestId("knowledge-test-run")).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("knowledge-test-blocked-draft.png"),
    fullPage: false,
    animations: "disabled",
  });
  await page.getByTestId("knowledge-test-draft-remediation").click();
  await expect(page).toHaveURL(/\/app\/knowledge\?view=overview(?:&|$)/);
  expect(state.runRequests).toEqual([]);
});

test("failed tests never fabricate a successful answer", async ({ page }) => {
  await installMocks(page, { runMode: "FAILED" });
  await openTest(page);
  await page.getByTestId("knowledge-test-question").fill("Can this snapshot answer me?");
  await page.getByTestId("knowledge-test-run").click();
  await expect(
    page.getByTestId("knowledge-test-result").getByText("Test running..."),
  ).toBeVisible();
  await expect(page.getByText("Test failed")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(
      "Question testing is not available in this deployment. No result was generated.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Would send automatically")).toHaveCount(0);
  await expect(page.getByText("Final response")).toHaveCount(0);
});

test("saved test edits preserve dirty protected input through 412 and archive with mutation guards", async ({
  page,
}) => {
  const state = await installMocks(page, { conflictNextUpdate: true });
  await openTest(page);
  await page.getByRole("tab", { name: "Saved tests" }).click();
  await expect(page.getByTestId("knowledge-test-case-detail")).toContainText(
    "First consultation price",
  );
  await page.getByTestId("knowledge-test-case-edit").click();
  const dialog = page.getByRole("dialog");
  await expect(page.getByTestId("knowledge-test-case-question")).toHaveValue(
    "How much does the first consultation cost?",
  );
  await dialog.getByLabel("Test name").fill("Edited pricing test");
  await page
    .getByTestId("knowledge-test-case-question")
    .fill("What is the verified consultation price?");
  await page.getByTestId("knowledge-test-case-save").click();

  await expect(dialog).toContainText("changed in another session");
  await expect(dialog.getByLabel("Test name")).toHaveValue("Edited pricing test");
  await expect(page.getByTestId("knowledge-test-case-question")).toHaveValue(
    "What is the verified consultation price?",
  );
  await expect(dialog.getByLabel("Test set version")).toHaveValue("server-v2");
  await page.getByTestId("knowledge-test-case-save").click();
  await expect(page.getByText("Saved test updated.")).toBeVisible();

  const patches = state.mutations.filter(
    (entry) => entry.pathname === "/api/knowledge/v2/test-cases/case-pricing",
  );
  expect(patches).toHaveLength(2);
  expect(patches.map((entry) => entry.ifMatch)).toEqual(['"case-pricing:1"', '"case-pricing:2"']);
  expect(patches[1]?.body).toEqual({
    safeLabel: "Edited pricing test",
    question: "What is the verified consultation price?",
  });
  expect(patches.every((entry) => Boolean(entry.idempotencyKey))).toBe(true);

  await page.getByTestId("knowledge-test-case-archive").click();
  await page.getByTestId("knowledge-test-archive-reason").fill("Replaced by a broader test.");
  await page.getByTestId("knowledge-test-archive-confirm").click();
  await expect(page.getByText("Saved test archived.")).toBeVisible();
  expect(state.mutations.at(-1)).toMatchObject({
    pathname: "/api/knowledge/v2/test-cases/case-pricing/archive",
    body: { reason: "Replaced by a broader test." },
  });
});

test("owners create a protected saved test without publishing knowledge", async ({ page }) => {
  const state = await installMocks(page);
  await openTest(page);
  await page.getByRole("tab", { name: "Saved tests" }).click();
  await page.getByTestId("knowledge-test-case-add").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Test name").fill("Booking availability");
  await page
    .getByTestId("knowledge-test-case-question")
    .fill("Do you have an appointment tomorrow?");
  await page.getByTestId("knowledge-test-case-save").click();
  await expect(page.getByText("Saved test updated.")).toBeVisible();
  await expect(page.getByTestId("knowledge-test-case-detail")).toContainText(
    "Booking availability",
  );

  const creation = state.mutations.find(
    (entry) => entry.pathname === "/api/knowledge/v2/test-cases",
  );
  expect(creation).toMatchObject({
    body: {
      safeLabel: "Booking availability",
      question: "Do you have an appointment tomorrow?",
      status: "ACTIVE",
      riskLevel: "MEDIUM",
      expectedBehavior: "ANSWER",
      locale: "en",
      channelType: "WEBSITE",
      audience: "PUBLIC",
      datasetVersion: "tenant-v1",
      expectations: [],
    },
  });
  expect(creation?.idempotencyKey).toBeTruthy();
});

test("protected input failure is explicit and blocks editing without exposing plaintext", async ({
  page,
}) => {
  await installMocks(page, { forbidInput: true });
  await openTest(page);
  await page.getByRole("tab", { name: "Saved tests" }).click();
  await page.getByTestId("knowledge-test-case-edit").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("You do not have permission for this test action.");
  await expect(page.getByTestId("knowledge-test-case-question")).toHaveValue("");
  await expect(page.getByTestId("knowledge-test-case-save")).toBeDisabled();
  await expect(dialog).not.toContainText("How much does the first consultation cost?");
});

test("redacted mobile result is localized, hides internal links, and does not overflow", async ({
  page,
}) => {
  const state = await installMocks(page, { runMode: "REDACTED" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTest(page, "ru");
  const mobileTestTargetHeights = await page
    .getByTestId("knowledge-test-playground")
    .locator('input[aria-label], button[role="combobox"]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter(({ height, width }) => height > 0 && width > 0)
        .map(({ height }) => height),
    );
  expect(mobileTestTargetHeights.length).toBeGreaterThanOrEqual(6);
  expect(Math.min(...mobileTestTargetHeights)).toBeGreaterThanOrEqual(44);
  await page.getByTestId("knowledge-test-question").fill("Нужна ли передача специалисту?");
  await page.getByLabel("Версия знаний").click();
  await page.getByRole("option", { name: "Точная версия черновика 9" }).click();
  await page.getByTestId("knowledge-test-run").click();
  const result = page.getByTestId("knowledge-test-result");
  await expect(result.getByText("Будет передано человеку").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(result).toContainText("Текст ответа закрыт для вашей роли.");
  await expect(result.getByRole("link", { name: "Открыть публичный источник" })).toHaveCount(1);
  await expect(result.locator('a[href*="internal.example"]')).toHaveCount(0);
  expect(state.runRequests[0]).toMatchObject({
    target: "DRAFT",
    candidateId: "workspace-v2",
    candidateVersion: 9,
    candidateManifestHash: "a".repeat(64),
  });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/screenshots/knowledge-test-mobile.png",
    fullPage: true,
  });
});
