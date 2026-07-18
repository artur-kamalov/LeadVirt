"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bot, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { getAuthMe, type AuthMe } from "@/lib/api/auth";
import { ApiClientError } from "@/lib/api/client";
import { Button } from "../components/ui/Button";
import { CurrentUserProvider } from "./CurrentUser";

type AuthCheckStatus = "checking" | "authorized" | "error";

export function RequireAuth({
  children,
  unauthorizedHref = "/login",
}: {
  children: React.ReactNode;
  unauthorizedHref?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = React.useState<AuthCheckStatus>("checking");
  const [user, setUser] = React.useState<AuthMe | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  const updateUserLocale = React.useCallback((locale: NonNullable<AuthMe["locale"]>) => {
    setUser((current) => (current ? { ...current, locale } : current));
  }, []);

  React.useEffect(() => {
    let active = true;
    setStatus("checking");
    setUser(null);

    void getAuthMe()
      .then((authenticatedUser) => {
        if (!active) return;
        setUser(authenticatedUser);
        setStatus("authorized");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiClientError && error.status === 401) {
          router.replace(unauthorizedHref);
          return;
        }
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [attempt, router, unauthorizedHref]);

  if (status !== "authorized" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <div
          className="flex max-w-md items-start gap-3 border border-white/10 bg-white/[0.03] px-5 py-4"
          data-testid={status === "error" ? "auth-check-error" : "auth-check-loading"}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-emerald-400 text-zinc-950">
            {status === "error" ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <Bot className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-200">
              {status === "error" ? t("auth.sessionCheckFailed") : t("auth.sessionChecking")}
            </p>
            {status === "error" ? (
              <>
                <p className="mt-1 text-sm text-zinc-500">{t("auth.sessionCheckFailedDetail")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-2"
                  onClick={() => setAttempt((current) => current + 1)}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("auth.sessionRetry")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <CurrentUserProvider user={user} onLocaleChange={updateUserLocale}>
      {children}
    </CurrentUserProvider>
  );
}
