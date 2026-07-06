import { SettingsPage } from "@/design/product/pages/SettingsPage";

const settingsTabs = ["profile", "team", "channels", "notifications", "billing", "security", "api"] as const;
type SettingsTab = (typeof settingsTabs)[number];

function initialTabFromQuery(value: string | null): SettingsTab {
  return settingsTabs.includes(value as SettingsTab) ? (value as SettingsTab) : "profile";
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  return <SettingsPage initialTab={initialTabFromQuery(params?.tab ?? null)} />;
}
