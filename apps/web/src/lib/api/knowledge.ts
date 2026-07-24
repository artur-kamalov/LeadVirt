import type {
  KnowledgeV2AcceptedMutation,
  KnowledgeV2CreateFactRequest,
  KnowledgeV2CreateEvaluationRunRequest,
  KnowledgeV2CreateGuidanceRuleRequest,
  KnowledgeV2CreateHeaders,
  KnowledgeV2CreatePublicationRequest,
  KnowledgeV2CreateSourceRequest,
  KnowledgeV2CreateFileUploadIntentRequest,
  KnowledgeV2FileUploadIntentView,
  KnowledgeV2FileUploadReceiptView,
  KnowledgeV2DocumentListQuery,
  KnowledgeV2DocumentPage,
  KnowledgeV2DocumentView,
  KnowledgeV2EvaluationRunListQuery,
  KnowledgeV2EvaluationRunMutationResult,
  KnowledgeV2BatchEvaluationRunPage,
  KnowledgeV2BatchEvaluationRunView,
  KnowledgeV2BulkFactVerificationMutationResult,
  KnowledgeV2BulkFactVerificationRequest,
  KnowledgeV2CapabilityListView,
  KnowledgeV2CapabilityType,
  KnowledgeV2CapabilityView,
  KnowledgeV2ExcludeRevisionRequest,
  KnowledgeV2FactAuthority,
  KnowledgeV2FactDecisionRequest,
  KnowledgeV2FactPage,
  KnowledgeV2FactView,
  KnowledgeV2GuidanceDecisionRequest,
  KnowledgeV2GuidanceReviewStatus,
  KnowledgeV2GuidanceRulePage,
  KnowledgeV2GuidanceRuleType,
  KnowledgeV2GuidanceRuleView,
  KnowledgeV2JobView,
  KnowledgeV2LifecycleStatus,
  KnowledgeV2MutationResult,
  KnowledgeV2OverviewView,
  KnowledgeV2PublicationDetail,
  KnowledgeV2PublicationPage,
  KnowledgeV2PublicationStatus,
  KnowledgeV2PublicationValidationView,
  KnowledgeV2ReadinessView,
  KnowledgeV2ConflictDecision,
  KnowledgeV2ConflictPage,
  KnowledgeV2ConflictStatus,
  KnowledgeV2ConflictType,
  KnowledgeV2ConflictView,
  KnowledgeV2BulkReviewExecuteRequest,
  KnowledgeV2BulkReviewMutationResult,
  KnowledgeV2BulkReviewPreviewRequest,
  KnowledgeV2BulkReviewPreviewView,
  KnowledgeV2ReviewAction,
  KnowledgeV2ReviewItemPage,
  KnowledgeV2ReviewItemView,
  KnowledgeV2ReviewReason,
  KnowledgeV2ReviewStatus,
  KnowledgeV2RevisionListQuery,
  KnowledgeV2RevisionPage,
  KnowledgeV2RevisionPreviewView,
  KnowledgeV2RiskLevel,
  KnowledgeV2RollbackPublicationRequest,
  KnowledgeV2SettingsView,
  KnowledgeV2SourceListQuery,
  KnowledgeV2SourceMutationResult,
  KnowledgeV2SourcePage,
  KnowledgeV2SourceView,
  KnowledgeV2ArchiveTestCaseRequest,
  KnowledgeV2CreateTestCaseRequest,
  KnowledgeV2CreateTestRunRequest,
  KnowledgeV2TestCaseListQuery,
  KnowledgeV2TestCaseInputView,
  KnowledgeV2TestCaseMutationResult,
  KnowledgeV2TestCasePage,
  KnowledgeV2TestCaseView,
  KnowledgeV2TestRunMutationResult,
  KnowledgeV2TestRunView,
  KnowledgeV2UpdateFactRequest,
  KnowledgeV2UpdateCapabilityRequest,
  KnowledgeV2UpdateGuidanceRuleRequest,
  KnowledgeV2UpdateHeaders,
  KnowledgeV2UpdateSourceRequest,
  KnowledgeV2UpdateSettingsRequest,
  KnowledgeV2UpdateTestCaseRequest,
  KnowledgeV2ValidatePublicationRequest,
  KnowledgeV2VerificationStatus,
} from "@leadvirt/types";
import { apiData, apiDataResponse, apiDirectUpload, jsonBody, withQuery } from "./client";

const basePath = "/knowledge/v2";

export interface KnowledgeV2PaginationQuery {
  cursor?: string;
  limit?: number;
}

export interface KnowledgeV2FactListQuery extends KnowledgeV2PaginationQuery {
  riskLevel?: KnowledgeV2RiskLevel;
  authority?: KnowledgeV2FactAuthority;
  verificationStatus?: KnowledgeV2VerificationStatus;
  lifecycleStatus?: KnowledgeV2LifecycleStatus;
  entityType?: string;
  locale?: string;
  query?: string;
}

export interface KnowledgeV2GuidanceListQuery extends KnowledgeV2PaginationQuery {
  type?: KnowledgeV2GuidanceRuleType;
  riskLevel?: KnowledgeV2RiskLevel;
  reviewStatus?: KnowledgeV2GuidanceReviewStatus;
  locale?: string;
  query?: string;
}

export interface KnowledgeV2PublicationListQuery extends KnowledgeV2PaginationQuery {
  targetKey?: string;
  status?: KnowledgeV2PublicationStatus;
}

export interface KnowledgeV2SourceActionRequest {
  reason?: string | null;
}

export interface KnowledgeV2ReviewListQuery extends KnowledgeV2PaginationQuery {
  status?: KnowledgeV2ReviewStatus;
  reason?: KnowledgeV2ReviewReason;
  riskLevel?: KnowledgeV2RiskLevel;
  assignedToUserId?: string;
  sourceId?: string;
  conflictId?: string;
  query?: string;
}

export interface KnowledgeV2ConflictListQuery extends KnowledgeV2PaginationQuery {
  status?: KnowledgeV2ConflictStatus;
  conflictType?: KnowledgeV2ConflictType;
  severity?: KnowledgeV2RiskLevel;
  assignedToUserId?: string;
  sourceId?: string;
  query?: string;
}

export interface KnowledgeV2AssignReviewRequest {
  assigneeUserId?: string | null;
}

export interface KnowledgeV2ResolveReviewRequest {
  action: KnowledgeV2ReviewAction;
  rationale?: string;
}

export interface KnowledgeV2DismissReviewRequest {
  rationale: string;
}

export interface KnowledgeV2ResolveConflictRequest {
  resolution: KnowledgeV2ConflictDecision;
  rationale?: string;
}

export interface KnowledgeV2ReviewMutationResult<T> {
  resource: T;
  idempotencyReplayed: boolean;
}

function resourceId(value: string) {
  return encodeURIComponent(value);
}

function createHeaders(headers: KnowledgeV2CreateHeaders): HeadersInit {
  return { "Idempotency-Key": headers["Idempotency-Key"] };
}

function updateHeaders(headers: KnowledgeV2UpdateHeaders): HeadersInit {
  return {
    "Idempotency-Key": headers["Idempotency-Key"],
    "If-Match": headers["If-Match"],
  };
}

export function createKnowledgeV2IdempotencyKey() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random values are unavailable.");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `kv2:${Date.now().toString(36)}:${random}`;
}

export function getKnowledgeV2Overview() {
  return apiData<KnowledgeV2OverviewView>(`${basePath}/overview`);
}

export function getKnowledgeV2Readiness() {
  return apiData<KnowledgeV2ReadinessView>(`${basePath}/readiness`);
}

export function getKnowledgeV2Capabilities() {
  return apiData<KnowledgeV2CapabilityListView>(`${basePath}/capabilities`);
}

export function applyKnowledgeV2CapabilityStarterPreset(idempotencyKey: string) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2CapabilityListView>>(
    `${basePath}/capabilities/presets/starter`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
  );
}

export function updateKnowledgeV2Capability(
  capabilityType: KnowledgeV2CapabilityType,
  body: KnowledgeV2UpdateCapabilityRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2CapabilityView>>(
    `${basePath}/capabilities/${resourceId(capabilityType)}`,
    {
      method: "PATCH",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function listKnowledgeV2TestCases(query: KnowledgeV2TestCaseListQuery = {}) {
  return apiData<KnowledgeV2TestCasePage>(withQuery(`${basePath}/test-cases`, query));
}

export function getKnowledgeV2TestCase(testCaseId: string) {
  return apiDataResponse<KnowledgeV2TestCaseView>(
    `${basePath}/test-cases/${resourceId(testCaseId)}`,
  );
}

export function getKnowledgeV2TestCaseInput(testCaseId: string) {
  return apiDataResponse<KnowledgeV2TestCaseInputView>(
    `${basePath}/test-cases/${resourceId(testCaseId)}/input`,
  );
}

export function createKnowledgeV2TestCase(
  body: KnowledgeV2CreateTestCaseRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2TestCaseMutationResult>(`${basePath}/test-cases`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export function updateKnowledgeV2TestCase(
  testCaseId: string,
  body: KnowledgeV2UpdateTestCaseRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2TestCaseMutationResult>(
    `${basePath}/test-cases/${resourceId(testCaseId)}`,
    { method: "PATCH", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function archiveKnowledgeV2TestCase(
  testCaseId: string,
  body: KnowledgeV2ArchiveTestCaseRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2TestCaseMutationResult>(
    `${basePath}/test-cases/${resourceId(testCaseId)}/archive`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function createKnowledgeV2TestRun(
  body: KnowledgeV2CreateTestRunRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2TestRunMutationResult>(`${basePath}/test-runs`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export function getKnowledgeV2TestRun(testRunId: string) {
  return apiDataResponse<KnowledgeV2TestRunView>(`${basePath}/test-runs/${resourceId(testRunId)}`);
}

export function listKnowledgeV2ReviewItems(query: KnowledgeV2ReviewListQuery = {}) {
  return apiData<KnowledgeV2ReviewItemPage>(withQuery(`${basePath}/review-items`, query));
}

export function getKnowledgeV2ReviewItem(reviewItemId: string) {
  return apiDataResponse<KnowledgeV2ReviewItemView>(
    `${basePath}/review-items/${resourceId(reviewItemId)}`,
  );
}

export function previewKnowledgeV2BulkReview(body: KnowledgeV2BulkReviewPreviewRequest) {
  return apiDataResponse<KnowledgeV2BulkReviewPreviewView>(
    `${basePath}/review-items/bulk-resolve/preview`,
    { method: "POST", ...jsonBody(body) },
  );
}

export function executeKnowledgeV2BulkReview(
  body: KnowledgeV2BulkReviewExecuteRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2BulkReviewMutationResult>(
    `${basePath}/review-items/bulk-resolve`,
    { method: "POST", headers: createHeaders(headers), ...jsonBody(body) },
  );
}

export function assignKnowledgeV2ReviewItem(
  reviewItemId: string,
  body: KnowledgeV2AssignReviewRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2ReviewMutationResult<KnowledgeV2ReviewItemView>>(
    `${basePath}/review-items/${resourceId(reviewItemId)}/assign`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function resolveKnowledgeV2ReviewItem(
  reviewItemId: string,
  body: KnowledgeV2ResolveReviewRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2ReviewMutationResult<KnowledgeV2ReviewItemView>>(
    `${basePath}/review-items/${resourceId(reviewItemId)}/resolve`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function dismissKnowledgeV2ReviewItem(
  reviewItemId: string,
  body: KnowledgeV2DismissReviewRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2ReviewMutationResult<KnowledgeV2ReviewItemView>>(
    `${basePath}/review-items/${resourceId(reviewItemId)}/dismiss`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function listKnowledgeV2Conflicts(query: KnowledgeV2ConflictListQuery = {}) {
  return apiData<KnowledgeV2ConflictPage>(withQuery(`${basePath}/conflicts`, query));
}

export function getKnowledgeV2Conflict(conflictId: string) {
  return apiDataResponse<KnowledgeV2ConflictView>(
    `${basePath}/conflicts/${resourceId(conflictId)}`,
  );
}

export function assignKnowledgeV2Conflict(
  conflictId: string,
  body: KnowledgeV2AssignReviewRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2ReviewMutationResult<KnowledgeV2ConflictView>>(
    `${basePath}/conflicts/${resourceId(conflictId)}/assign`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function resolveKnowledgeV2Conflict(
  conflictId: string,
  body: KnowledgeV2ResolveConflictRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2ReviewMutationResult<KnowledgeV2ConflictView>>(
    `${basePath}/conflicts/${resourceId(conflictId)}/resolve`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function dismissKnowledgeV2Conflict(
  conflictId: string,
  body: KnowledgeV2DismissReviewRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2ReviewMutationResult<KnowledgeV2ConflictView>>(
    `${basePath}/conflicts/${resourceId(conflictId)}/dismiss`,
    { method: "POST", headers: updateHeaders(headers), ...jsonBody(body) },
  );
}

export function listKnowledgeV2Sources(query: KnowledgeV2SourceListQuery = {}) {
  return apiData<KnowledgeV2SourcePage>(withQuery(`${basePath}/sources`, query));
}

export function getKnowledgeV2Source(sourceId: string) {
  return apiDataResponse<KnowledgeV2SourceView>(`${basePath}/sources/${resourceId(sourceId)}`);
}

export function createKnowledgeV2Source(
  body: KnowledgeV2CreateSourceRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(`${basePath}/sources`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export function createKnowledgeV2FileUploadIntent(
  body: KnowledgeV2CreateFileUploadIntentRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2FileUploadIntentView>(`${basePath}/file-uploads/intents`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export async function uploadKnowledgeV2File(
  intent: KnowledgeV2FileUploadIntentView,
  file: File,
  signal?: AbortSignal,
) {
  const response = await apiDirectUpload<{ data: KnowledgeV2FileUploadReceiptView }>({
    url: intent.uploadUrl,
    method: intent.method,
    headers: intent.headers,
    body: file,
    ...(signal ? { signal } : {}),
  });
  return { ...response, data: response.data.data };
}

export function completeKnowledgeV2FileUpload(intentId: string, headers: KnowledgeV2CreateHeaders) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(
    `${basePath}/file-uploads/${resourceId(intentId)}/complete`,
    { method: "POST", headers: createHeaders(headers) },
  );
}

export function updateKnowledgeV2Source(
  sourceId: string,
  body: KnowledgeV2UpdateSourceRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2SourceMutationResult>(
    `${basePath}/sources/${resourceId(sourceId)}`,
    {
      method: "PATCH",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function syncKnowledgeV2Source(
  sourceId: string,
  body: KnowledgeV2SourceActionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(
    `${basePath}/sources/${resourceId(sourceId)}/sync`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function pauseKnowledgeV2Source(
  sourceId: string,
  body: KnowledgeV2SourceActionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2SourceView>>(
    `${basePath}/sources/${resourceId(sourceId)}/pause`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function resumeKnowledgeV2Source(
  sourceId: string,
  body: KnowledgeV2SourceActionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(
    `${basePath}/sources/${resourceId(sourceId)}/resume`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function deleteKnowledgeV2Source(
  sourceId: string,
  body: { reason: string },
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(
    `${basePath}/sources/${resourceId(sourceId)}`,
    {
      method: "DELETE",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function listKnowledgeV2Documents(query: KnowledgeV2DocumentListQuery = {}) {
  return apiData<KnowledgeV2DocumentPage>(withQuery(`${basePath}/documents`, query));
}

export function getKnowledgeV2Document(documentId: string) {
  return apiDataResponse<KnowledgeV2DocumentView>(
    `${basePath}/documents/${resourceId(documentId)}`,
  );
}

export function listKnowledgeV2DocumentRevisions(
  documentId: string,
  query: KnowledgeV2RevisionListQuery = {},
) {
  return apiData<KnowledgeV2RevisionPage>(
    withQuery(`${basePath}/documents/${resourceId(documentId)}/revisions`, query),
  );
}

export function previewKnowledgeV2Revision(revisionId: string) {
  return apiDataResponse<KnowledgeV2RevisionPreviewView>(
    `${basePath}/revisions/${resourceId(revisionId)}/preview`,
  );
}

export function excludeKnowledgeV2Revision(
  revisionId: string,
  body: KnowledgeV2ExcludeRevisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(
    `${basePath}/revisions/${resourceId(revisionId)}/exclude`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function getKnowledgeV2Settings() {
  return apiDataResponse<KnowledgeV2SettingsView>(`${basePath}/settings`);
}

export function updateKnowledgeV2Settings(
  body: KnowledgeV2UpdateSettingsRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2SettingsView>>(
    `${basePath}/settings`,
    {
      method: "PATCH",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function listKnowledgeV2Facts(query: KnowledgeV2FactListQuery = {}) {
  return apiData<KnowledgeV2FactPage>(withQuery(`${basePath}/facts`, query));
}

export function createKnowledgeV2Fact(
  body: KnowledgeV2CreateFactRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2FactView>>(`${basePath}/facts`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export function updateKnowledgeV2Fact(
  factId: string,
  body: KnowledgeV2UpdateFactRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2FactView>>(
    `${basePath}/facts/${resourceId(factId)}`,
    {
      method: "PATCH",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function verifyKnowledgeV2Fact(
  factId: string,
  body: KnowledgeV2FactDecisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2FactView>>(
    `${basePath}/facts/${resourceId(factId)}/verify`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function bulkVerifyKnowledgeV2Facts(
  body: KnowledgeV2BulkFactVerificationRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2BulkFactVerificationMutationResult>(
    `${basePath}/facts/bulk-verify`,
    {
      method: "POST",
      headers: createHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function rejectKnowledgeV2Fact(
  factId: string,
  body: KnowledgeV2FactDecisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2FactView>>(
    `${basePath}/facts/${resourceId(factId)}/reject`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function listKnowledgeV2Guidance(query: KnowledgeV2GuidanceListQuery = {}) {
  return apiData<KnowledgeV2GuidanceRulePage>(withQuery(`${basePath}/guidance`, query));
}

export function createKnowledgeV2GuidanceRule(
  body: KnowledgeV2CreateGuidanceRuleRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>>(
    `${basePath}/guidance`,
    {
      method: "POST",
      headers: createHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function updateKnowledgeV2GuidanceRule(
  ruleId: string,
  body: KnowledgeV2UpdateGuidanceRuleRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>>(
    `${basePath}/guidance/${resourceId(ruleId)}`,
    {
      method: "PATCH",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

function decideKnowledgeV2GuidanceRule(
  ruleId: string,
  action: "approve" | "reject" | "disable",
  body: KnowledgeV2GuidanceDecisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2GuidanceRuleView>>(
    `${basePath}/guidance/${resourceId(ruleId)}/${action}`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function approveKnowledgeV2GuidanceRule(
  ruleId: string,
  body: KnowledgeV2GuidanceDecisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return decideKnowledgeV2GuidanceRule(ruleId, "approve", body, headers);
}

export function rejectKnowledgeV2GuidanceRule(
  ruleId: string,
  body: KnowledgeV2GuidanceDecisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return decideKnowledgeV2GuidanceRule(ruleId, "reject", body, headers);
}

export function disableKnowledgeV2GuidanceRule(
  ruleId: string,
  body: KnowledgeV2GuidanceDecisionRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return decideKnowledgeV2GuidanceRule(ruleId, "disable", body, headers);
}

export function getActiveKnowledgeV2Publication() {
  return apiDataResponse<KnowledgeV2PublicationDetail | null>(`${basePath}/publications/active`);
}

export function listKnowledgeV2Publications(query: KnowledgeV2PublicationListQuery = {}) {
  return apiData<KnowledgeV2PublicationPage>(withQuery(`${basePath}/publications`, query));
}

export function listKnowledgeV2EvaluationRuns(query: KnowledgeV2EvaluationRunListQuery = {}) {
  return apiData<KnowledgeV2BatchEvaluationRunPage>(
    withQuery(`${basePath}/evaluation-runs`, query),
  );
}

export function createKnowledgeV2EvaluationRun(
  body: KnowledgeV2CreateEvaluationRunRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2EvaluationRunMutationResult>(`${basePath}/evaluation-runs`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export function getKnowledgeV2EvaluationRun(runId: string) {
  return apiData<KnowledgeV2BatchEvaluationRunView>(
    `${basePath}/evaluation-runs/${resourceId(runId)}`,
  );
}

export function cancelKnowledgeV2EvaluationRun(runId: string, headers: KnowledgeV2CreateHeaders) {
  return apiDataResponse<KnowledgeV2EvaluationRunMutationResult>(
    `${basePath}/evaluation-runs/${resourceId(runId)}/cancel`,
    {
      method: "POST",
      headers: createHeaders(headers),
    },
  );
}

export function getKnowledgeV2Publication(publicationId: string) {
  return apiDataResponse<KnowledgeV2PublicationDetail>(
    `${basePath}/publications/${resourceId(publicationId)}`,
  );
}

export function validateKnowledgeV2Publication(
  body: KnowledgeV2ValidatePublicationRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2MutationResult<KnowledgeV2PublicationValidationView>>(
    `${basePath}/publications/validate`,
    {
      method: "POST",
      headers: createHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function createKnowledgeV2Publication(
  body: KnowledgeV2CreatePublicationRequest,
  headers: KnowledgeV2CreateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(`${basePath}/publications`, {
    method: "POST",
    headers: createHeaders(headers),
    ...jsonBody(body),
  });
}

export function rollbackKnowledgeV2Publication(
  publicationId: string,
  body: KnowledgeV2RollbackPublicationRequest,
  headers: KnowledgeV2UpdateHeaders,
) {
  return apiDataResponse<KnowledgeV2AcceptedMutation>(
    `${basePath}/publications/${resourceId(publicationId)}/rollback`,
    {
      method: "POST",
      headers: updateHeaders(headers),
      ...jsonBody(body),
    },
  );
}

export function getKnowledgeV2Job(jobId: string) {
  return apiData<KnowledgeV2JobView>(`${basePath}/jobs/${resourceId(jobId)}`);
}
