"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";

export type Route =
  | "landing"
  | "onboarding"
  | "dashboard"
  | "inbox"
  | "conversation"
  | "pipeline"
  | "automation"
  | "analytics"
  | "audit"
  | "integrations"
  | "billing"
  | "settings";

interface NavState {
  route: Route;
  go: (route: Route, params?: Record<string, unknown>) => void;
  params: Record<string, unknown>;
  mode: "app" | "demo";
}

const NavContext = React.createContext<NavState | null>(null);

const appRoutePaths: Record<Route, string> = {
  landing: "/",
  onboarding: "/onboarding",
  dashboard: "/app",
  inbox: "/app/inbox",
  conversation: "/app/inbox",
  pipeline: "/app/leads",
  automation: "/app/automations",
  analytics: "/app/analytics",
  audit: "/app/audit",
  integrations: "/app/integrations",
  billing: "/app/billing",
  settings: "/app/settings"
};

const demoRoutePaths: Record<Route, string> = {
  landing: "/",
  onboarding: "/demo/onboarding",
  dashboard: "/demo",
  inbox: "/demo/inbox",
  conversation: "/demo/inbox",
  pipeline: "/demo/leads",
  automation: "/demo/automations",
  analytics: "/demo/analytics",
  audit: "/demo/audit",
  integrations: "/demo/integrations",
  billing: "/demo/billing",
  settings: "/demo/settings"
};

function isDemoPath(pathname: string) {
  return pathname === "/demo" || pathname.startsWith("/demo/");
}

function pathFor(route: Route, params: Record<string, unknown>, mode: "app" | "demo" = "app") {
  const paths = mode === "demo" ? demoRoutePaths : appRoutePaths;

  if (route === "conversation") {
    const id = typeof params.id === "string" && params.id.length > 0 ? params.id : "";
    return id ? `${paths.inbox}/${encodeURIComponent(id)}` : paths.inbox;
  }

  return paths[route];
}

export function hrefForRoute(route: Route, params: Record<string, unknown> = {}, mode: "app" | "demo" = "app") {
  return pathFor(route, params, mode);
}

function stateForPath(pathname: string): Pick<NavState, "route" | "params"> {
  if (pathname === "/onboarding" || pathname === "/app/onboarding" || pathname === "/demo/onboarding") {
    return { route: "onboarding", params: {} };
  }

  if (pathname === "/demo") return { route: "dashboard", params: { mode: "demo" } };
  if (pathname === "/demo/inbox") return { route: "inbox", params: { mode: "demo" } };

  if (pathname.startsWith("/demo/inbox/")) {
    const id = decodeURIComponent(pathname.slice("/demo/inbox/".length) || "");
    return { route: "conversation", params: { id, mode: "demo" } };
  }

  if (pathname === "/demo/leads") return { route: "pipeline", params: { mode: "demo" } };
  if (pathname === "/demo/automations") return { route: "automation", params: { mode: "demo" } };
  if (pathname === "/demo/analytics") return { route: "analytics", params: { mode: "demo" } };
  if (pathname === "/demo/audit") return { route: "audit", params: { mode: "demo" } };
  if (pathname === "/demo/integrations") return { route: "integrations", params: { mode: "demo" } };
  if (pathname === "/demo/billing") return { route: "billing", params: { mode: "demo" } };
  if (pathname === "/demo/settings") return { route: "settings", params: { mode: "demo" } };

  if (pathname === "/app") return { route: "dashboard", params: {} };
  if (pathname === "/app/inbox") return { route: "inbox", params: {} };

  if (pathname.startsWith("/app/inbox/")) {
    const id = decodeURIComponent(pathname.slice("/app/inbox/".length) || "");
    return { route: "conversation", params: { id } };
  }

  if (pathname === "/app/leads") return { route: "pipeline", params: {} };
  if (pathname === "/app/automations") return { route: "automation", params: {} };
  if (pathname === "/app/analytics") return { route: "analytics", params: {} };
  if (pathname === "/app/audit") return { route: "audit", params: {} };
  if (pathname === "/app/integrations") return { route: "integrations", params: {} };
  if (pathname === "/app/billing") return { route: "billing", params: {} };
  if (pathname === "/app/settings") return { route: "settings", params: {} };

  return { route: "landing", params: {} };
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const mode = isDemoPath(pathname) ? "demo" : "app";
  const pathnameState = React.useMemo(() => stateForPath(pathname), [pathname]);
  const [params, setParams] = React.useState<Record<string, unknown>>({});

  React.useEffect(() => {
    setParams(pathnameState.params);
  }, [pathnameState.params]);

  const go = React.useCallback((next: Route, p: Record<string, unknown> = {}) => {
    setParams(p);
    router.push(pathFor(next, p, mode));
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  }, [mode, router]);

  return (
    <NavContext.Provider value={{ route: pathnameState.route, go, params, mode }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  const ctx = React.useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}
