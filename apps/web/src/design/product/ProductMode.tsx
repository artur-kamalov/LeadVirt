"use client";

import React from "react";

export type ProductMode = "app" | "demo";

interface ProductModeState {
  mode: ProductMode;
  demo: boolean;
}

const ProductModeContext = React.createContext<ProductModeState>({
  mode: "app",
  demo: false,
});

export function ProductModeProvider({
  mode,
  children,
}: {
  mode: ProductMode;
  children: React.ReactNode;
}) {
  return (
    <ProductModeContext.Provider value={{ mode, demo: mode === "demo" }}>
      {children}
    </ProductModeContext.Provider>
  );
}

export function useProductMode() {
  return React.useContext(ProductModeContext);
}
