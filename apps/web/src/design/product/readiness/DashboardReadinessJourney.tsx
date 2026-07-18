"use client";

import Link from "next/link";
import {
  AlertCircle,
  Bot,
  Building2,
  Check,
  Circle,
  FlaskConical,
  LockKeyhole,
  MessageSquareMore,
  Plug,
  RefreshCw,
  Rocket,
  Send,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey, TranslationValues } from "@/i18n/messages";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { Card } from "../shared";
import { Skeleton } from "../ui";
import { useNav } from "../nav";
import {
  deriveDashboardReadiness,
  type DashboardReadinessDetail,
  type DashboardReadinessSnapshot,
  type DashboardReadinessStepId,
} from "./dashboardReadiness";

const stepIcons = {
  profile: Building2,
  knowledge: MessageSquareMore,
  test: FlaskConical,
  publish: Rocket,
  channel: Plug,
  replies: Bot,
  inbound: Send,
} as const;

const stepTitleKeys: Record<DashboardReadinessStepId, TranslationKey> = {
  profile: "dashboard.readiness.step.profile",
  knowledge: "dashboard.readiness.step.knowledge",
  test: "dashboard.readiness.step.test",
  publish: "dashboard.readiness.step.publish",
  channel: "dashboard.readiness.step.channel",
  replies: "dashboard.readiness.step.replies",
  inbound: "dashboard.readiness.step.inbound",
};

const actionKeys: Record<DashboardReadinessStepId, TranslationKey> = {
  profile: "dashboard.readiness.action.profile",
  knowledge: "dashboard.readiness.action.knowledge",
  test: "dashboard.readiness.action.test",
  publish: "dashboard.readiness.action.publish",
  channel: "dashboard.readiness.action.channel",
  replies: "dashboard.readiness.action.replies",
  inbound: "dashboard.readiness.action.inbound",
};

function detailMessage(detail: DashboardReadinessDetail): {
  key: TranslationKey;
  values?: TranslationValues;
} {
  switch (detail.kind) {
    case "profile_complete":
      return { key: "dashboard.readiness.detail.profileComplete" };
    case "profile_missing":
      return { key: "dashboard.readiness.detail.profileMissing", values: { count: detail.count } };
    case "knowledge_complete":
      return { key: "dashboard.readiness.detail.knowledgeComplete" };
    case "knowledge_review":
      return { key: "dashboard.readiness.detail.knowledgeReview", values: { count: detail.count } };
    case "knowledge_blocked":
      return {
        key: "dashboard.readiness.detail.knowledgeBlocked",
        values: { count: detail.count },
      };
    case "knowledge_updating":
      return { key: "dashboard.readiness.detail.knowledgeUpdating" };
    case "test_complete":
      return { key: "dashboard.readiness.detail.testComplete" };
    case "test_incomplete":
      return { key: "dashboard.readiness.detail.testIncomplete" };
    case "publish_complete":
      return { key: "dashboard.readiness.detail.publishComplete" };
    case "publish_incomplete":
      return { key: "dashboard.readiness.detail.publishIncomplete" };
    case "channel_complete":
      return { key: "dashboard.readiness.detail.channelComplete" };
    case "channel_incomplete":
      return { key: "dashboard.readiness.detail.channelIncomplete" };
    case "replies_complete":
      return { key: "dashboard.readiness.detail.repliesComplete" };
    case "replies_incomplete":
      return { key: "dashboard.readiness.detail.repliesIncomplete" };
    case "inbound_complete":
      return { key: "dashboard.readiness.detail.inboundComplete" };
    case "inbound_incomplete":
      return { key: "dashboard.readiness.detail.inboundIncomplete" };
    case "needs_check":
      return { key: "dashboard.readiness.detail.needsCheck" };
  }
}

export function DashboardReadinessJourney({
  snapshot,
  isLoading,
  isError,
  onRetry,
}: {
  snapshot: DashboardReadinessSnapshot | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const { mode } = useNav();

  if (!snapshot && isLoading) {
    return (
      <Card className="min-w-0 p-4 sm:p-6" data-testid="dashboard-readiness-loading">
        <div className="flex items-center gap-3" role="status">
          <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
        <p className="sr-only">{t("dashboard.readiness.loading")}</p>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card
        className="min-w-0 border-amber-400/20 bg-amber-400/[0.035] p-4 sm:p-6"
        data-testid="dashboard-readiness-load-error"
        role="alert"
      >
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-amber-400/25 bg-amber-400/10 text-amber-300">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100">
                {t("dashboard.readiness.error.title")}
              </h2>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                {t("dashboard.readiness.error.description")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 gap-2 sm:w-auto"
            data-testid="dashboard-readiness-retry"
            onClick={onRetry}
          >
            <RefreshCw className="h-4 w-4" />
            {t("dashboard.readiness.retry")}
          </Button>
        </div>
      </Card>
    );
  }

  const model = deriveDashboardReadiness(snapshot);
  const progress = Math.round((model.completedCount / model.steps.length) * 100);
  const primaryLabel = model.primaryStepId
    ? t(actionKeys[model.primaryStepId])
    : t("dashboard.readiness.action.ready");
  const primaryHref =
    mode === "demo"
      ? model.primaryHref.replace(/^\/app(?=\/|$)/, "/demo")
      : model.primaryHref;

  return (
    <Card
      className="min-w-0 overflow-hidden border-emerald-500/15 bg-emerald-500/[0.025]"
      data-testid="dashboard-readiness"
      data-ready={model.isReady ? "true" : "false"}
      aria-busy={isLoading}
    >
      {isError ? (
        <div
          className="flex min-w-0 flex-col gap-3 border-b border-amber-400/15 bg-amber-400/[0.045] px-4 py-3 sm:flex-row sm:items-center sm:px-5"
          data-testid="dashboard-readiness-refresh-error"
          role="alert"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-200">
                {t("dashboard.readiness.error.title")}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                {t("dashboard.readiness.error.description")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 gap-2 sm:w-auto"
            data-testid="dashboard-readiness-refresh-retry"
            onClick={onRetry}
          >
            <RefreshCw className="h-4 w-4" />
            {t("dashboard.readiness.retry")}
          </Button>
        </div>
      ) : null}
      <div className="grid min-w-0 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.55fr)]">
        <div className="min-w-0 border-b border-white/10 p-4 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
                model.isReady
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "border-white/10 bg-white/[0.04] text-zinc-300",
              )}
            >
              {model.isReady ? <Check className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-50">
                {t(
                  model.isReady
                    ? "dashboard.readiness.title.ready"
                    : "dashboard.readiness.title.incomplete",
                )}
              </h2>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                {t(
                  model.isReady
                    ? "dashboard.readiness.description.ready"
                    : "dashboard.readiness.description.incomplete",
                )}
              </p>
            </div>
          </div>

          <div className="mt-5" data-testid="dashboard-readiness-progress">
            <div className="mb-2 text-xs">
              <span className="font-medium text-zinc-300">
                {t("dashboard.readiness.progress", {
                  completed: model.completedCount,
                  total: model.steps.length,
                })}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={model.steps.length}
              aria-valuenow={model.completedCount}
            >
              <div
                className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <Button
            asChild
            variant="primary"
            className="mt-5 w-full justify-center sm:w-auto lg:w-full"
            data-testid="dashboard-readiness-primary"
          >
            <Link href={primaryHref}>
              {primaryLabel}
              <Rocket className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-center gap-2 text-zinc-400"
            data-testid="dashboard-readiness-refresh"
            disabled={isLoading}
            onClick={onRetry}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            {t("dashboard.readiness.retry")}
          </Button>
          {isLoading ? (
            <p className="mt-2 text-xs text-zinc-600">{t("dashboard.readiness.loading")}</p>
          ) : null}
        </div>

        <ol
          className="min-w-0 divide-y divide-white/[0.06]"
          aria-label={t("dashboard.readiness.title.incomplete")}
        >
          {model.steps.map((step, index) => {
            const Icon = stepIcons[step.id];
            const detail = detailMessage(step.detail);
            const needsCheck = step.evidence === "needs_check";
            const statusLabel =
              step.state === "completed"
                ? t("dashboard.readiness.status.completed")
                : step.state === "current" && needsCheck
                  ? t("dashboard.readiness.status.needsCheck")
                  : step.state === "current"
                    ? t("dashboard.readiness.status.current")
                    : t("dashboard.readiness.status.blocked");
            const StateIcon =
              step.state === "completed"
                ? Check
                : step.state === "current" && needsCheck
                  ? AlertCircle
                  : step.state === "current"
                    ? Circle
                    : LockKeyhole;

            return (
              <li
                key={step.id}
                data-testid={`dashboard-readiness-step-${step.id}`}
                data-state={step.state}
                data-evidence={step.evidence}
                aria-current={step.state === "current" ? "step" : undefined}
                className={cn(
                  "grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-4 py-3.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center sm:px-5",
                  step.state === "current" && "bg-emerald-400/[0.055]",
                )}
              >
                <div
                  className={cn(
                    "row-span-2 flex h-9 w-9 items-center justify-center rounded-md border text-zinc-500",
                    step.state === "completed" &&
                      "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
                    step.state === "current" &&
                      "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">
                    <span className="mr-1.5 text-zinc-600">{index + 1}.</span>
                    {t(stepTitleKeys[step.id])}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                    {t(detail.key, detail.values)}
                  </p>
                </div>
                <div
                  className={cn(
                    "col-start-2 mt-1 inline-flex w-fit items-center gap-1.5 text-xs font-medium sm:col-start-3 sm:row-start-1 sm:mt-0 sm:whitespace-nowrap",
                    step.state === "completed" && "text-emerald-400",
                    step.state === "current" && !needsCheck && "text-emerald-300",
                    needsCheck && "text-amber-300",
                    step.state === "blocked" && !needsCheck && "text-zinc-600",
                  )}
                >
                  <StateIcon className="h-3.5 w-3.5" />
                  {statusLabel}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
