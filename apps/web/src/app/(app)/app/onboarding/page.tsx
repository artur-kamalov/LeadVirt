import { redirect } from "next/navigation";

interface LegacyOnboardingPageProps {
  searchParams?: Promise<{ plan?: string | string[] }>;
}

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: LegacyOnboardingPageProps) {
  const params = await searchParams;
  const plan = first(params?.plan);
  redirect(plan ? `/onboarding?plan=${encodeURIComponent(plan)}` : "/onboarding");
}
