"use client";

import { DesignProviders } from "@/design/DesignProviders";
import { DemoDashboardPage } from "@/design/demo/DemoDashboardPage";
import { ProductModeProvider } from "@/design/product/ProductMode";

export default function Page() {
  return (
    <DesignProviders>
      <ProductModeProvider mode="demo">
        <DemoDashboardPage />
      </ProductModeProvider>
    </DesignProviders>
  );
}
