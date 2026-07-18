"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronDown, LockKeyhole, RefreshCw, TriangleAlert } from "lucide-react";
import type { KnowledgeV2OverviewView } from "@leadvirt/types";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { ApiClientError } from "@/lib/api/client";
import { getKnowledgeV2Overview } from "@/lib/api/knowledge";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { ProductLayout } from "../ProductLayout";
import { LoadingOverlay, Select, StatusBadge } from "../ui";
import { BusinessFactsEditor } from "./BusinessFactsEditor";
import { BusinessProfileEditor } from "./BusinessProfileEditor";
import { GuidanceEditor } from "./GuidanceEditor";
import { KnowledgeOverview } from "./KnowledgeOverview";
import { KnowledgeReviewQueue } from "./KnowledgeReviewQueue";
import { KnowledgeSources } from "./KnowledgeSources";
import { KnowledgeTestPlayground } from "./KnowledgeTestPlayground";
import { KnowledgeSettingsPanel } from "./KnowledgeSettingsPanel";
import { PublicationHistory } from "./PublicationHistory";
import { isKnowledgeView, knowledgeViews, type KnowledgeViewId } from "./knowledge-views";

const OVERVIEW_REFRESH_INTERVAL_MS = 15_000;

type DraftStatus = KnowledgeV2OverviewView["readiness"]["draft"]["status"];

const draftStatusKeys: Record<DraftStatus, TranslationKey> = {
  UP_TO_DATE: "knowledge.status.draft.upToDate",
  CHANGES_PENDING: "knowledge.status.draft.changesPending",
  PROCESSING: "knowledge.status.draft.processing",
  FAILED: "knowledge.status.draft.failed",
};

export function KnowledgePage() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname() || "/app/knowledge";
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const view: KnowledgeViewId = isKnowledgeView(requestedView) ? requestedView : "business";
  const welcome = searchParams.get("welcome") === "1";
  const [overview, setOverview] = React.useState<KnowledgeV2OverviewView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [forbidden, setForbidden] = React.useState(false);
  const [error, setError] = React.useState<ApiClientError | null>(null);
  const mounted = React.useRef(false);
  const hasOverview = React.useRef(false);
  const requestSequence = React.useRef(0);

  const refresh = React.useCallback(
    async (showLoading = false) => {
      const sequence = ++requestSequence.current;
      if (showLoading) setLoading(true);

      try {
        const next = await getKnowledgeV2Overview();
        if (!mounted.current || sequence !== requestSequence.current) return;
        setOverview(next);
        hasOverview.current = true;
        setForbidden(false);
        setError(null);
      } catch (caught) {
        if (!mounted.current || sequence !== requestSequence.current) return;
        const apiError =
          caught instanceof ApiClientError
            ? caught
            : new ApiClientError(t("knowledge.page.loadErrorFallback"), 500);
        if (apiError.status === 403) setForbidden(true);
        if (!hasOverview.current) setError(apiError);
      } finally {
        if (mounted.current && sequence === requestSequence.current) setLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    mounted.current = true;
    void refresh(true);

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refresh(false);
    }

    const timer = window.setInterval(refreshWhenVisible, OVERVIEW_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  function navigate(nextView: KnowledgeViewId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nextView);
    params.delete("welcome");
    router.push(`${pathname}?${params.toString()}`);
  }

  const mobileViewOptions = knowledgeViews.map((item) => {
    const Icon = item.icon;
    return {
      value: item.id,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="truncate">{t(item.labelKey)}</span>
        </span>
      ),
    };
  });

  return (
    <ProductLayout title="Knowledge">
      <div
        className="mx-auto w-full min-w-0 max-w-[1500px] overflow-x-clip space-y-5"
        data-testid="knowledge-page"
      >
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-zinc-50">{t("knowledge.page.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              {t("knowledge.page.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {overview ? (
              <>
                <StatusBadge
                  status={overview.readiness.serving.status === "READY" ? "success" : "warning"}
                >
                  {t("knowledge.overview.servingEyebrow")}:{" "}
                  {t(
                    overview.readiness.serving.status === "READY"
                      ? "knowledge.status.serving.ready"
                      : "knowledge.status.serving.notReady",
                  )}
                </StatusBadge>
                <StatusBadge
                  status={
                    overview.readiness.draft.status === "FAILED"
                      ? "error"
                      : overview.readiness.draft.status === "UP_TO_DATE"
                        ? "success"
                        : "info"
                  }
                >
                  {t("knowledge.overview.draftEyebrow")}:{" "}
                  {t(draftStatusKeys[overview.readiness.draft.status])}
                </StatusBadge>
              </>
            ) : null}
            <Button
              size="icon"
              variant="outline"
              aria-label={t("knowledge.page.refresh")}
              disabled={loading}
              onClick={() => void refresh(false)}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        {welcome ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-200">
                {t("knowledge.page.welcomeTitle")}
              </p>
              <p className="mt-0.5 text-xs text-emerald-200/65">
                {t("knowledge.page.welcomeDescription")}
              </p>
            </div>
          </div>
        ) : null}

        <div className="sm:hidden" data-testid="knowledge-mobile-navigation">
          <Select
            value={view}
            onValueChange={(nextView) => {
              if (isKnowledgeView(nextView)) navigate(nextView);
            }}
            options={mobileViewOptions}
            ariaLabel={t("knowledge.page.tabsLabel")}
            testId="knowledge-mobile-view-selector"
            className="rounded-lg"
          />
        </div>

        <nav
          aria-label={t("knowledge.page.tabsLabel")}
          className="hidden max-w-full min-w-0 overflow-x-auto overscroll-x-contain border-b border-white/10 scrollbar-none sm:block"
          role="tablist"
        >
          <div className="flex w-max min-w-full gap-1">
            {knowledgeViews.map((item) => {
              const Icon = item.icon;
              const active = item.id === view;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`knowledge-tab-${item.id}`}
                  onClick={() => navigate(item.id)}
                  className={cn(
                    "relative flex h-11 items-center gap-2 px-3 text-sm font-medium transition-colors",
                    active ? "text-emerald-300" : "text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(item.labelKey)}
                  {active ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 bg-emerald-400" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>

        <main
          role="tabpanel"
          aria-label={t(
            knowledgeViews.find((item) => item.id === view)?.labelKey ??
              "knowledge.page.tab.business",
          )}
        >
          {loading && !overview ? <LoadingOverlay label={t("knowledge.page.loading")} /> : null}

          {forbidden ? (
            <RouteState
              icon={LockKeyhole}
              title={t("knowledge.page.accessTitle")}
              description={t("knowledge.page.accessDescription")}
            />
          ) : null}

          {!forbidden && error && !overview ? (
            <RouteState
              icon={TriangleAlert}
              title={t("knowledge.page.loadErrorTitle")}
              description={error.message}
              requestId={error.requestId}
              action={
                <Button onClick={() => void refresh(true)}>{t("knowledge.common.tryAgain")}</Button>
              }
            />
          ) : null}

          {!forbidden && overview ? (
            <KnowledgeView
              view={view}
              overview={overview}
              onNavigate={navigate}
              onChanged={() => void refresh(false)}
            />
          ) : null}
        </main>
      </div>
    </ProductLayout>
  );
}

function KnowledgeView({
  view,
  overview,
  onNavigate,
  onChanged,
}: {
  view: KnowledgeViewId;
  overview: KnowledgeV2OverviewView;
  onNavigate: (view: KnowledgeViewId) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();

  if (view === "overview") {
    return <KnowledgeOverview overview={overview} onNavigate={onNavigate} onRefresh={onChanged} />;
  }
  if (view === "business") {
    return (
      <div className="space-y-5">
        <BusinessProfileEditor canEdit={overview.permissions.canEdit} onChanged={onChanged} />
        <details
          className="group min-w-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/20"
          data-testid="knowledge-business-advanced"
        >
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 marker:hidden sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-200">
                {t("businessProfile.advanced.title")}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {t("businessProfile.advanced.description")}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="min-w-0 space-y-5 border-t border-white/10 p-4 sm:p-5">
            <KnowledgeSettingsPanel
              canEdit={overview.permissions.canManageSettings}
              onChanged={onChanged}
            />
            <BusinessFactsEditor
              canEdit={overview.permissions.canEdit}
              canVerifyHighRisk={overview.permissions.canVerifyHighRisk}
              onChanged={onChanged}
            />
          </div>
        </details>
      </div>
    );
  }
  if (view === "guidance") {
    return (
      <GuidanceEditor
        canEdit={overview.permissions.canEdit}
        canVerifyHighRisk={overview.permissions.canVerifyHighRisk}
        onChanged={onChanged}
      />
    );
  }
  if (view === "history") {
    return (
      <PublicationHistory
        canPublish={overview.permissions.canPublish}
        canRollback={overview.permissions.canRollback}
        readiness={overview.readiness}
        onNavigate={onNavigate}
        onChanged={onChanged}
      />
    );
  }
  if (view === "sources") {
    return (
      <KnowledgeSources
        canManageSources={overview.permissions.canManageSettings}
        recentJobs={overview.recentJobs}
        onChanged={onChanged}
      />
    );
  }
  if (view === "review") {
    return (
      <KnowledgeReviewQueue
        canReview={overview.permissions.canEdit}
        canBulkReview={overview.permissions.canManageSettings}
        canVerifyHighRisk={overview.permissions.canVerifyHighRisk}
        onChanged={onChanged}
      />
    );
  }
  return <KnowledgeTestPlayground overview={overview} onChanged={onChanged} />;
}

function RouteState({
  icon: Icon,
  title,
  description,
  requestId,
  action,
}: {
  icon: typeof LockKeyhole;
  title: string;
  description: string;
  requestId?: string;
  action?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-white/10 bg-zinc-950/30 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/5">
        <Icon className="h-5 w-5 text-zinc-400" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-zinc-100">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-zinc-400">{description}</p>
      {requestId ? (
        <p className="mt-2 text-xs text-zinc-400">
          {t("knowledge.common.request", { id: requestId })}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
