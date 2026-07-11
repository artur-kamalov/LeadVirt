import type { IntegrationAccount, IntegrationSampleDeliveryResult, IntegrationTestResult } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function listIntegrations() {
  return apiData<IntegrationAccount[]>("/integrations");
}

export function connectIntegration(provider: string, input: { botToken?: string } = {}) {
  return apiData<IntegrationAccount>(`/integrations/${provider}/connect`, {
    method: "POST",
    ...jsonBody(input)
  });
}

export function disconnectIntegration(provider: string) {
  return apiData<IntegrationAccount>(`/integrations/${provider}/disconnect`, { method: "POST" });
}

export function testIntegrationConnection(provider: string) {
  return apiData<IntegrationTestResult>(`/integrations/${provider}/test`, { method: "POST" });
}

export function sendSampleInbound(provider: string) {
  return apiData<IntegrationSampleDeliveryResult>(`/integrations/${provider}/sample-inbound`, { method: "POST" });
}

export function updateIntegrationSettings(provider: string, settings: Record<string, unknown>) {
  return apiData<IntegrationAccount>(`/integrations/${provider}/settings`, {
    method: "PATCH",
    ...jsonBody({ settings })
  });
}
