import { InboxPage } from "@/design/product/pages/InboxPage";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  return <InboxPage initialSearch={params?.q ?? ""} />;
}
