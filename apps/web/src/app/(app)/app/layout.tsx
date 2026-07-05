"use client";

import { DesignProviders } from "@/design/DesignProviders";
import { ProductModeProvider } from "@/design/product/ProductMode";
import { RequireAuth } from "@/design/product/RequireAuth";

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DesignProviders>
      <ProductModeProvider mode="app">
        <RequireAuth>{children}</RequireAuth>
      </ProductModeProvider>
    </DesignProviders>
  );
}
