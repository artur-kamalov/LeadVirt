"use client";

import { DesignProviders } from "@/design/DesignProviders";
import { ProductModeProvider } from "@/design/product/ProductMode";

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DesignProviders>
      <ProductModeProvider mode="demo">{children}</ProductModeProvider>
    </DesignProviders>
  );
}
