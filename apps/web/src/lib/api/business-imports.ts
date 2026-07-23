import type {
  BusinessImportApplicationView,
  BusinessImportApprovalDecisionRequest,
  BusinessImportApprovalMutationView,
  BusinessImportApplyPreviewRequest,
  BusinessImportApplyPreviewView,
  BusinessImportApplyRequest,
  BusinessImportBulkCandidateDecisionRequest,
  BusinessImportBulkApprovalRequest,
  BusinessImportBulkApprovalView,
  BusinessImportCancelView,
  BusinessImportCandidateDecisionRequest,
  BusinessImportCandidatePage,
  BusinessImportCandidateView,
  BusinessImportCreateIntentRequest,
  BusinessImportFormat,
  BusinessImportListQuery,
  BusinessImportMappingConfirmReceipt,
  BusinessImportMappingConfirmRequest,
  BusinessImportMappingView,
  BusinessImportPage,
  BusinessImportRebaseRequest,
  BusinessImportRetryRequest,
  BusinessImportUploadIntentView,
  BusinessImportUploadReceiptView,
  BusinessImportView,
} from "@leadvirt/types";
import {
  apiData,
  apiDataResponse,
  apiDirectUpload,
  createIdempotencyKey,
  jsonBody,
  withQuery,
} from "./client";

const basePath = "/business-profile/imports";

export interface BusinessImportTemplateView {
  id: string;
  format: BusinessImportFormat;
  target: "SERVICES";
  filename: string;
  downloadUrl?: string | null;
  declaredMimeType: BusinessImportCreateIntentRequest["declaredMimeType"];
  maxBytes: number;
  enabled: boolean;
}

export interface BusinessImportTemplateCatalogView {
  items: BusinessImportTemplateView[];
}

export interface BusinessImportCandidateListQuery {
  cursor?: string;
  limit?: number;
  action?: string;
  decision?: string;
  search?: string;
}

export interface BusinessImportApplicationPageView {
  items: BusinessImportApplicationView[];
  nextCursor?: string | null;
}

export type BusinessImportCreateHeaders = { "Idempotency-Key": string };
export type BusinessImportUpdateHeaders = BusinessImportCreateHeaders & { "If-Match": string };
export type BusinessImportApplyHeaders = BusinessImportUpdateHeaders & {
  "X-Business-Information-If-Match": string;
};

function resourceId(value: string) {
  return encodeURIComponent(value);
}

export function createBusinessImportIdempotencyKey() {
  return createIdempotencyKey("business-import");
}

export function getBusinessImportTemplates() {
  return apiData<BusinessImportTemplateCatalogView>("/business-profile/import-templates");
}

export function listBusinessImports(query: BusinessImportListQuery = {}) {
  return apiData<BusinessImportPage>(withQuery(basePath, query));
}

export function createBusinessImportIntent(
  body: BusinessImportCreateIntentRequest,
  headers: BusinessImportCreateHeaders,
) {
  return apiDataResponse<BusinessImportUploadIntentView>(`${basePath}/intents`, {
    method: "POST",
    headers,
    ...jsonBody(body),
  });
}

export async function uploadBusinessImport(
  intent: BusinessImportUploadIntentView,
  file: File,
  signal?: AbortSignal,
) {
  const response = await apiDirectUpload<{ data: BusinessImportUploadReceiptView }>({
    url: intent.uploadUrl,
    method: intent.method,
    headers: intent.headers,
    body: file,
    expectedPath: `${basePath}/${resourceId(intent.importId)}/content`,
    ...(signal ? { signal } : {}),
  });
  return { ...response, data: response.data.data };
}

export function finalizeBusinessImport(importId: string, headers: BusinessImportCreateHeaders) {
  return apiDataResponse<BusinessImportView>(`${basePath}/${resourceId(importId)}/finalize`, {
    method: "POST",
    headers,
  });
}

export function getBusinessImport(importId: string) {
  return apiData<BusinessImportView>(`${basePath}/${resourceId(importId)}`);
}

export function getBusinessImportMapping(importId: string) {
  return apiData<BusinessImportMappingView>(`${basePath}/${resourceId(importId)}/mapping`);
}

export function confirmBusinessImportMapping(
  importId: string,
  body: BusinessImportMappingConfirmRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportMappingConfirmReceipt>(
    `${basePath}/${resourceId(importId)}/mapping/confirm`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function listBusinessImportCandidates(
  importId: string,
  query: BusinessImportCandidateListQuery = {},
) {
  return apiData<BusinessImportCandidatePage>(
    withQuery(`${basePath}/${resourceId(importId)}/candidates`, query),
  );
}

export function updateBusinessImportCandidate(
  importId: string,
  candidateId: string,
  body: BusinessImportCandidateDecisionRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportCandidateView>(
    `${basePath}/${resourceId(importId)}/candidates/${resourceId(candidateId)}`,
    { method: "PATCH", headers, ...jsonBody(body) },
  );
}

export function bulkDecideBusinessImportCandidates(
  importId: string,
  body: BusinessImportBulkCandidateDecisionRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportCandidatePage>(
    `${basePath}/${resourceId(importId)}/decisions/bulk`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function requestBusinessImportApproval(
  importId: string,
  body: { candidateIds: string[] },
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportApprovalMutationView>(
    `${basePath}/${resourceId(importId)}/approval-requests`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function decideBusinessImportApproval(
  importId: string,
  approvalId: string,
  body: BusinessImportApprovalDecisionRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportApprovalMutationView>(
    `${basePath}/${resourceId(importId)}/approvals/${resourceId(approvalId)}/decision`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function bulkApproveBusinessImportCandidates(
  importId: string,
  body: BusinessImportBulkApprovalRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportBulkApprovalView>(
    `${basePath}/${resourceId(importId)}/approvals/bulk`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function rebaseBusinessImport(
  importId: string,
  body: BusinessImportRebaseRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportView>(`${basePath}/${resourceId(importId)}/rebase`, {
    method: "POST",
    headers,
    ...jsonBody(body),
  });
}

export function previewBusinessImportApply(
  importId: string,
  body: BusinessImportApplyPreviewRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportApplyPreviewView>(
    `${basePath}/${resourceId(importId)}/apply-preview`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function applyBusinessImport(
  importId: string,
  body: BusinessImportApplyRequest,
  headers: BusinessImportApplyHeaders,
) {
  return apiDataResponse<BusinessImportApplicationView>(
    `${basePath}/${resourceId(importId)}/apply`,
    { method: "POST", headers, ...jsonBody(body) },
  );
}

export function listBusinessImportApplications(
  importId: string,
  query: { cursor?: string; limit?: number } = {},
) {
  return apiData<BusinessImportApplicationPageView>(
    withQuery(`${basePath}/${resourceId(importId)}/applications`, query),
  );
}

export function retryBusinessImport(
  importId: string,
  body: BusinessImportRetryRequest,
  headers: BusinessImportUpdateHeaders,
) {
  return apiDataResponse<BusinessImportView>(`${basePath}/${resourceId(importId)}/retry`, {
    method: "POST",
    headers,
    ...jsonBody(body),
  });
}

export function cancelBusinessImport(importId: string, headers: BusinessImportUpdateHeaders) {
  return apiDataResponse<BusinessImportCancelView>(`${basePath}/${resourceId(importId)}/cancel`, {
    method: "POST",
    headers,
  });
}
