import type { OnboardingState } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export function getOnboardingState() {
  return apiData<OnboardingState>("/onboarding/state");
}

export function updateOnboardingState(
  body: Partial<Pick<OnboardingState, "currentStep" | "data">>,
  options: { ifMatch?: string } = {},
) {
  return apiData<OnboardingState>("/onboarding/state", {
    method: "PATCH",
    ...(options.ifMatch ? { headers: { "If-Match": options.ifMatch } } : {}),
    ...jsonBody(body),
  });
}

export function completeOnboardingStep(step: string) {
  return apiData<OnboardingState>("/onboarding/complete-step", {
    method: "POST",
    ...jsonBody({ step }),
  });
}

export function advanceOnboarding(
  step: string,
  data: Record<string, unknown>,
  options: { ifMatch?: string } = {},
) {
  return apiData<OnboardingState>("/onboarding/advance", {
    method: "POST",
    ...(options.ifMatch ? { headers: { "If-Match": options.ifMatch } } : {}),
    ...jsonBody({ step, data }),
  });
}
