"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Bot,
  MessageSquare,
  Database,
  ClipboardList,
  Filter,
  X,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import { Card, Avatar, ChannelBadge, StatusPill, TempPill, channels, stages } from "../shared";
import type { ChannelId, StageId } from "../shared";
import type { Lead } from "../types";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { EmptyState, Skeleton } from "../ui";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { listInboxConversations } from "@/lib/api/inbox";
import { createLeadTask, sendLeadToCrm } from "@/lib/api/leads";
import { leadFromConversation } from "../apiAdapters";
import { useI18n } from "@/i18n/I18nProvider";
import { useProductPermissions } from "../CurrentUser";
import type { Locale } from "@/i18n/config";
import { ResourceErrorState } from "../ResourceErrorState";

const LIVE_REFRESH_INTERVAL_MS = 4_000;

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function needsReply(lead: Lead): boolean {
  return lead.unread > 0;
}

function useInboxLeads(locale: Locale) {
  const [apiLeads, setApiLeads] = useState<Lead[] | null>(null);
  const [apiError, setApiError] = useState(false);
  const [apiRefreshing, setApiRefreshing] = useState(true);
  const [refreshRevision, setRefreshRevision] = useState(0);

  React.useEffect(() => {
    let active = true;
    let refreshInFlight = false;

    async function refresh() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      setApiRefreshing(true);

      try {
        const result = await listInboxConversations({ limit: 50 });
        if (!active) return;
        setApiLeads(result.data.map((conversation) => leadFromConversation(conversation, locale)));
        setApiError(false);
      } catch {
        if (!active) return;
        setApiError(true);
      } finally {
        refreshInFlight = false;
        if (active) setApiRefreshing(false);
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refresh();
    }

    void refresh();
    const timer = window.setInterval(refreshWhenVisible, LIVE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [locale, refreshRevision]);

  return {
    leads: apiLeads ?? [],
    apiLoaded: apiLeads !== null,
    apiError,
    apiRefreshing,
    retry: () => setRefreshRevision((current) => current + 1),
  };
}

/* ─────────────────────────────────────────────
   Channel filter chip
───────────────────────────────────────────── */
function ChannelChip({
  id,
  active,
  onClick,
}: {
  id: ChannelId | "all";
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  if (id === "all") {
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
          active
            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
            : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/8",
        )}
      >
        {t("ops.inbox.allChannels")}
      </button>
    );
  }
  const ch = channels[id];
  const Icon = ch.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
          : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/8",
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", active ? "text-emerald-400" : ch.color)} />
      {ch.labelKey ? t(ch.labelKey) : ch.label}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Stage filter chip
───────────────────────────────────────────── */
function StageChip({
  id,
  active,
  onClick,
}: {
  id: StageId | "all";
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = id === "all" ? t("ops.inbox.allStatuses") : t(stages[id].labelKey);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
          : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/8",
      )}
    >
      {id !== "all" && <span className={cn("w-1.5 h-1.5 rounded-full", stages[id].dot)} />}
      {label}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Lead row
───────────────────────────────────────────── */
const LeadRow = React.forwardRef<
  HTMLDivElement,
  {
    lead: Lead;
    selected: boolean;
    onSelect: () => void;
    index: number;
  }
>(function LeadRow({ lead, selected, onSelect, index }, ref) {
  const { t } = useI18n();
  const ch = channels[lead.channel];
  const ChIcon = ch.icon;

  return (
    <motion.div
      ref={ref}
      role="listitem"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: "easeOut" }}
      layout
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        data-testid={`inbox-conversation-${lead.id}`}
        onClick={onSelect}
        className={cn(
          "w-full text-left group relative flex items-start gap-3 px-4 py-3.5 rounded-2xl border transition-all cursor-pointer",
          selected
            ? "bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_20px_rgba(52,211,153,0.08)]"
            : "bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/5",
        )}
      >
        {/* Avatar + channel badge */}
        <div className="relative shrink-0 mt-0.5">
          <Avatar name={lead.name} size={40} />
          <span
            aria-hidden="true"
            className={cn(
              "absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-zinc-950 flex items-center justify-center",
              ch.bg,
            )}
          >
            <ChIcon className={cn("w-2.5 h-2.5", ch.color)} />
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-zinc-100 truncate">{lead.name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-zinc-500">{lead.time}</span>
            </div>
          </div>

          <p className="text-xs text-zinc-400 truncate mb-2 leading-snug">{lead.lastMessage}</p>

          <div className="flex items-center gap-1.5 flex-wrap">
            {needsReply(lead) ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
                data-testid="inbox-needs-reply"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                {t("ops.inbox.awaitingReply")}
              </span>
            ) : null}
            <StatusPill stage={lead.stage} />
            <TempPill t={lead.temp} />
            {lead.ai && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 shadow-[0_0_8px_rgba(52,211,153,0.2)]">
                <Bot className="w-2.5 h-2.5" />
                AI
              </span>
            )}
          </div>
        </div>

      </button>
    </motion.div>
  );
});

/* ─────────────────────────────────────────────
   Right pane – lead summary
───────────────────────────────────────────── */
function LeadSummary({ lead }: { lead: Lead }) {
  const { go } = useNav();
  const { formatCurrency, t } = useI18n();
  const permissions = useProductPermissions();
  const [pendingAction, setPendingAction] = useState<"crm" | "task" | null>(null);

  const fields: { label: string; value: string }[] = [
    { label: t("ops.common.source"), value: lead.source },
    { label: t("ops.common.service"), value: lead.service },
    { label: t("ops.common.manager"), value: lead.manager },
    {
      label: t("ops.common.value"),
      value: lead.value === 0 ? "—" : formatCurrency(lead.value, lead.currency),
    },
    {
      label: t("ops.common.channel"),
      value: channels[lead.channel].labelKey
        ? t(channels[lead.channel].labelKey)
        : channels[lead.channel].label,
    },
  ];

  const handleSendToCrm = async () => {
    if (!permissions.canManageLeads) return;
    if (!lead.apiLeadId) {
      toast.error(t("ops.common.apiLeadOnly"));
      return;
    }
    setPendingAction("crm");
    try {
      await sendLeadToCrm(lead.apiLeadId);
      toast.success(t("ops.common.crmSent"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ops.common.crmFailed"));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateTask = async () => {
    if (!permissions.canManageLeads) return;
    if (!lead.apiLeadId) {
      toast.error(t("ops.common.apiLeadOnly"));
      return;
    }
    setPendingAction("task");
    try {
      await createLeadTask(lead.apiLeadId, t("ops.inbox.taskTitle", { name: lead.name }));
      toast.success(t("ops.common.taskCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ops.common.taskFailed"));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <motion.div
      key={lead.id}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="h-full flex flex-col gap-4 overflow-y-auto pr-0.5"
      data-testid="inbox-lead-summary"
    >
      {/* Profile card */}
      <Card className="p-5">
        <div className="flex items-start gap-4 mb-5">
          <Avatar name={lead.name} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-zinc-50 tracking-tight leading-snug mb-2">
              {lead.name}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ChannelBadge id={lead.channel} withLabel />
              <StatusPill stage={lead.stage} />
              <TempPill t={lead.temp} />
              {lead.ai && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                  <Bot className="w-2.5 h-2.5" />
                  AI
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Field list */}
        <div className="space-y-3 mb-5">
          {fields.map((f) => (
            <div key={f.label} className="flex items-start justify-between gap-3">
              <span className="text-xs text-zinc-500 shrink-0 pt-0.5">{f.label}</span>
              <span className="text-xs text-zinc-200 font-medium text-right">{f.value}</span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/5 mb-5" />

        {/* Last message preview */}
        <div className="mb-5">
          <p className="text-[11px] text-zinc-500 mb-1.5 font-medium uppercase tracking-wider">
            {t("ops.inbox.lastMessage")}
          </p>
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
            <p className="text-xs text-zinc-300 leading-relaxed">{lead.lastMessage}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{lead.time}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full justify-center"
            onClick={() => go("conversation", { id: lead.conversationId ?? lead.id })}
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            {t("ops.inbox.openConversation")}
          </Button>
          {permissions.canManageLeads ? (
            <>
              <Button
                variant="outline"
                className="w-full justify-center"
                disabled={pendingAction !== null}
                onClick={() => void handleSendToCrm()}
              >
                <Database className="w-4 h-4 mr-1.5" />
                {pendingAction === "crm" ? t("ops.common.sending") : t("ops.common.toCrm")}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-center"
                disabled={pendingAction !== null}
                onClick={() => void handleCreateTask()}
              >
                <ClipboardList className="w-4 h-4 mr-1.5" />
                {pendingAction === "task" ? t("ops.common.creating") : t("ops.common.createTask")}
              </Button>
            </>
          ) : null}
        </div>
      </Card>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────
   Main page
───────────────────────────────────────────── */
export function InboxPage({ initialSearch = "" }: { initialSearch?: string }) {
  const { go } = useNav();
  const { locale, t } = useI18n();
  const { leads: inboxLeads, apiLoaded, apiError, apiRefreshing, retry } = useInboxLeads(locale);

  const [selectedId, setSelectedId] = useState<string>("");
  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">("all");
  const [stageFilter, setStageFilter] = useState<StageId | "all">("all");
  const [search, setSearch] = useState(initialSearch);

  React.useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  const hasActiveFilters =
    channelFilter !== "all" || stageFilter !== "all" || search.trim().length > 0;

  const filtered = useMemo(() => {
    return inboxLeads.filter((l) => {
      if (channelFilter !== "all" && l.channel !== channelFilter) return false;
      if (stageFilter !== "all" && l.stage !== stageFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!l.name.toLowerCase().includes(q) && !l.lastMessage.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [channelFilter, inboxLeads, stageFilter, search]);

  React.useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId) setSelectedId("");
      return;
    }

    if (!filtered.some((lead) => lead.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? "");
    }
  }, [filtered, selectedId]);

  const selectedLead = filtered.find((lead) => lead.id === selectedId) ?? filtered[0] ?? null;

  const needsReplyCount = filtered.filter(needsReply).length;

  const channelIds = Object.keys(channels) as ChannelId[];
  const stageIds = Object.keys(stages) as StageId[];

  return (
    <ProductLayout title={t("ops.inbox.title")}>
      <div className="h-[calc(100vh-9rem)] flex flex-col gap-0 -mx-4 lg:-mx-8 -mt-6 px-0">
        {/* Two-pane layout */}
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_340px] gap-0 divide-x divide-white/5">
          {/* ── LEFT PANE ── */}
          <div className="flex flex-col min-h-0 overflow-hidden">
            {/* Filter bar */}
            <div className="shrink-0 px-4 lg:px-6 pt-5 pb-3 space-y-3 border-b border-white/5 bg-zinc-950/95">
              {/* Search */}
              <div className="flex min-h-11 items-center gap-2 rounded-xl border border-white/5 bg-white/5 pl-3 focus-within:border-emerald-500/30 focus-within:bg-emerald-500/5 transition-all">
                <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <input
                  aria-label={t("ops.inbox.searchLabel")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("ops.inbox.searchPlaceholder")}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600 text-zinc-100"
                />
                {search && (
                  <button
                    type="button"
                    aria-label={t("ops.inbox.clearSearch")}
                    onClick={() => setSearch("")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Channel chips */}
              <div
                role="group"
                aria-label={t("ops.inbox.channelFilters")}
                className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
              >
                <ChannelChip
                  id="all"
                  active={channelFilter === "all"}
                  onClick={() => setChannelFilter("all")}
                />
                {channelIds.map((id) => (
                  <ChannelChip
                    key={id}
                    id={id}
                    active={channelFilter === id}
                    onClick={() => setChannelFilter(id)}
                  />
                ))}
              </div>

              {/* Stage chips */}
              <div
                role="group"
                aria-label={t("ops.inbox.statusFilters")}
                className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
              >
                <StageChip
                  id="all"
                  active={stageFilter === "all"}
                  onClick={() => setStageFilter("all")}
                />
                {stageIds.map((id) => (
                  <StageChip
                    key={id}
                    id={id}
                    active={stageFilter === id}
                    onClick={() => setStageFilter(id)}
                  />
                ))}
              </div>

              {/* Summary */}
              <div className="flex items-center gap-2" role="status" aria-live="polite">
                <Filter className="w-3.5 h-3.5 text-zinc-600" />
                <span className="text-xs text-zinc-500">
                  {!apiLoaded
                    ? apiError
                      ? t("ops.inbox.loadFailed")
                      : t("resource.loading")
                    : t("ops.inbox.conversations", { count: filtered.length })}
                  {apiLoaded && needsReplyCount > 0 ? (
                    <>
                      {" · "}
                      <span className="font-medium text-amber-300">
                        {t("ops.inbox.needReply", { count: needsReplyCount })}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>

            {apiError && apiLoaded ? (
              <div className="shrink-0 border-b border-white/5 px-3 py-3">
                <ResourceErrorState testId="inbox-refresh-error" onRetry={retry} />
              </div>
            ) : null}

            {/* Lead list */}
            <div
              aria-label={
                apiLoaded && filtered.length > 0 ? t("ops.inbox.conversationList") : undefined
              }
              className="flex-1 space-y-1 overflow-y-auto px-3 py-3"
              role={apiLoaded && filtered.length > 0 ? "list" : undefined}
            >
              <AnimatePresence mode="popLayout">
                {!apiLoaded && apiRefreshing && !apiError ? (
                  <div className="space-y-2" data-testid="inbox-loading">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="h-24 w-full" />
                    ))}
                  </div>
                ) : apiError && !apiLoaded ? (
                  <ResourceErrorState testId="inbox-load-error" onRetry={retry} />
                ) : filtered.length === 0 ? (
                  <motion.div
                    key="empty"
                    data-testid="inbox-empty-state"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-10"
                  >
                    <EmptyState
                      icon={Search}
                      title={hasActiveFilters ? t("ops.inbox.noResults") : t("ops.inbox.empty")}
                      description={
                        hasActiveFilters
                          ? t("ops.inbox.noResultsDetail")
                          : apiLoaded
                            ? t("ops.inbox.emptyDetail")
                            : apiError
                              ? t("ops.inbox.loadFailed")
                              : t("ops.inbox.loading")
                      }
                      action={
                        hasActiveFilters ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setChannelFilter("all");
                              setStageFilter("all");
                              setSearch("");
                            }}
                          >
                            {t("ops.inbox.resetFilters")}
                          </Button>
                        ) : undefined
                      }
                    />
                  </motion.div>
                ) : (
                  filtered.map((lead, i) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      selected={lead.id === selectedId}
                      index={i}
                      onSelect={() => {
                        setSelectedId(lead.id);
                        // On mobile: go straight to conversation
                        if (window.innerWidth < 1024) {
                          go("conversation", { id: lead.id });
                        }
                      }}
                    />
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── RIGHT PANE (desktop only) ── */}
          <div className="hidden lg:flex flex-col min-h-0 px-5 py-5 overflow-y-auto bg-zinc-950/20">
            {selectedLead ? (
              <LeadSummary lead={selectedLead} />
            ) : !apiLoaded && !apiError ? (
              <div className="space-y-3" data-testid="inbox-detail-loading">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : apiError && !apiLoaded ? (
              <ResourceErrorState testId="inbox-detail-load-error" onRetry={retry} />
            ) : (
              <EmptyState
                icon={MessageSquare}
                title={t("ops.inbox.noneSelected")}
                description={t("ops.inbox.noneSelectedDetail")}
              />
            )}
          </div>
        </div>
      </div>
    </ProductLayout>
  );
}
