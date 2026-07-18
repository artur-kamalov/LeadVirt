import { DesignProviders } from "@/design/DesignProviders";
import { RequireAuth } from "@/design/product/RequireAuth";
import { OnboardingPage } from "@/design/product/pages/OnboardingPage";
import { authHref, resolveAcquisitionIntent } from "@/lib/acquisition";

interface OnboardingPageProps {
  searchParams?: Promise<{ plan?: string | string[] }>;
}

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const acquisition = resolveAcquisitionIntent({
    plan: first(params?.plan),
    returnTo: first(params?.plan)
      ? `/onboarding?plan=${encodeURIComponent(first(params?.plan) ?? "")}`
      : "/onboarding",
  });
  const loginHref = authHref("/login", acquisition);

  return (
    <DesignProviders>
      <RequireAuth unauthorizedHref={loginHref}>
        <OnboardingPage selectedPlan={acquisition.plan} />
      </RequireAuth>
    </DesignProviders>
  );
}
