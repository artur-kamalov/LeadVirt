"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { ProductLayout } from "../ProductLayout";
import { BusinessProfileEditor } from "./BusinessProfileEditor";

export function DemoBusinessProfilePage() {
  const { t } = useI18n();

  return (
    <ProductLayout title={t("product.nav.knowledge")}>
      <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-5 overflow-x-clip">
        <header className="border-b border-white/10 pb-5">
          <h1 className="text-2xl font-semibold text-zinc-50">{t("knowledge.page.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">{t("knowledge.page.description")}</p>
        </header>
        <BusinessProfileEditor canEdit={false} onChanged={() => undefined} />
      </div>
    </ProductLayout>
  );
}
