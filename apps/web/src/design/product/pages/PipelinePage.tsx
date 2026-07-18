import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutGrid,
  List,
  TrendingUp,
  Users,
  Wallet,
  BarChart3,
  ArrowRight,
  ChevronRight,
  Inbox,
  MoreHorizontal,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import { Avatar, ChannelBadge, TempPill, stages, stageOrder, type StageId } from "../shared";
import type { Lead } from "../types";
import { useNav } from "../nav";
import { cn } from "../../lib/utils";
import { Dropdown, DropdownItem, DropdownSeparator, Skeleton, Tip } from "../ui";
import { toast } from "sonner";
import {
  getLead,
  getPipelineSummary,
  updateLead,
  type PipelineSummary,
} from "@/lib/api/leads";
import { listInboxConversations } from "@/lib/api/inbox";
import { leadFromApiLead, statusFromStage } from "../apiAdapters";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/config";
import { useProductPermissions } from "../CurrentUser";
import { ResourceErrorState } from "../ResourceErrorState";

/* ─────────────────────────────────────────────
   Summary helpers
───────────────────────────────────────────── */
type LeadAction = "qualified" | "closed";

type LeadMutationToken = {
  leadId: string;
  generation: number;
};

function leadsFromPipelineSummary(
  summary: PipelineSummary,
  conversationByLeadId: Map<string, string>,
  locale: Locale,
) {
  return summary.stages.flatMap((stage) =>
    stage.leads.map((lead) => leadFromApiLead(lead, conversationByLeadId.get(lead.id), locale)),
  );
}

async function loadConversationMap() {
  const result = await listInboxConversations({ limit: 100 });
  const conversationByLeadId = new Map<string, string>();

  for (const conversation of result.data) {
    if (conversation.leadId) {
      conversationByLeadId.set(conversation.leadId, conversation.id);
    }
  }

  return conversationByLeadId;
}

function fallbackPatchForAction(action: LeadAction): Partial<Lead> {
  switch (action) {
    case "qualified":
      return { stage: "qualified" };
    case "closed":
      return { stage: "closed" };
  }
}

function nextManualStage(stage: StageId): StageId | null {
  if (stage === "new") return "progress";
  if (stage === "progress") return "qualified";
  return null;
}

function canQualifyLead(stage: StageId) {
  return stage === "new" || stage === "progress";
}

function formatLeadAmounts(
  leads: Lead[],
  formatCurrency: (value: number, currency?: string) => string,
  mode: "total" | "average" = "total",
) {
  const groups = new Map<string, { total: number; count: number }>();
  for (const lead of leads) {
    if (lead.value <= 0) continue;
    const group = groups.get(lead.currency) ?? { total: 0, count: 0 };
    group.total += lead.value;
    group.count += 1;
    groups.set(lead.currency, group);
  }

  if (groups.size === 0) return "—";
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, group]) =>
      formatCurrency(
        mode === "average" ? Math.round(group.total / group.count) : group.total,
        currency,
      ),
    )
    .join(" · ");
}

/* ─────────────────────────────────────────────
   Lead card
───────────────────────────────────────────── */
const LeadCard = React.forwardRef<
  HTMLDivElement,
  {
    lead: Lead;
    onAdvance: (id: string) => void;
    onAction: (id: string, action: LeadAction) => void;
    canAdvance: boolean;
    canManage: boolean;
    pending: boolean;
  }
>(function LeadCard({ lead, onAdvance, onAction, canAdvance, canManage, pending }, ref) {
  const { go } = useNav();
  const { formatCurrency, t } = useI18n();
  const conversationId = lead.conversationId ?? lead.id;
  const canQualify = canQualifyLead(lead.stage);
  const canClose = lead.stage !== "closed";

  return (
    <motion.div
      ref={ref}
      layout
      layoutId={lead.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="group select-none"
      aria-busy={pending}
    >
      <div className="relative rounded-2xl bg-zinc-900/70 border border-white/[0.06] p-4 hover:border-white/[0.12] hover:bg-zinc-900/80 transition-all duration-200">
        <button
          type="button"
          aria-label={`${t("ops.inbox.openConversation")}: ${lead.name}`}
          data-testid={`pipeline-open-${lead.id}`}
          onClick={() => go("conversation", { id: conversationId })}
          className="absolute inset-0 z-10 cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        />
        {/* Header row */}
        <div className="pointer-events-none relative z-20 flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={lead.name} size={34} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{lead.name}</p>
              <p className="text-[11px] text-zinc-500 truncate mt-0.5">{lead.service}</p>
            </div>
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
            <TempPill t={lead.temp} />
            <Dropdown
              trigger={
                <button
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("ops.pipeline.leadActions", { name: lead.name })}
                  disabled={pending}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 transition-all hover:bg-white/[0.06] hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-wait disabled:opacity-40"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              }
            >
              <DropdownItem onClick={() => go("conversation", { id: conversationId })}>
                {t("ops.inbox.openConversation")}
              </DropdownItem>
              {canManage && (canQualify || canClose) ? (
                <>
                  {canQualify ? (
                    <DropdownItem onClick={() => onAction(lead.id, "qualified")}>
                      {t("ops.common.qualified")}
                    </DropdownItem>
                  ) : null}
                  {canQualify && canClose ? <DropdownSeparator /> : null}
                  {canClose ? (
                    <DropdownItem danger onClick={() => onAction(lead.id, "closed")}>
                      {t("ops.pipeline.close")}
                    </DropdownItem>
                  ) : null}
                </>
              ) : null}
            </Dropdown>
          </div>
        </div>

        {/* Badges row */}
        <div className="pointer-events-none relative z-20 flex items-center gap-1.5 mb-3 flex-wrap">
          <ChannelBadge id={lead.channel} />
          {lead.manager !== "—" && (
            <span className="text-[11px] text-zinc-500 bg-white/[0.04] rounded-full px-2 py-0.5 border border-white/[0.05]">
              {lead.manager}
            </span>
          )}
        </div>

        {/* Footer row */}
        <div className="pointer-events-none relative z-20 flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-emerald-400 tracking-tight">
              {lead.value > 0 ? formatCurrency(lead.value, lead.currency) : "—"}
            </span>
            <span className="text-[10px] text-zinc-600 truncate max-w-[120px]">{lead.source}</span>
          </div>

          {/* Advance stage button */}
          {canAdvance && canManage && (
            <Tip content={t("ops.pipeline.advance")}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdvance(lead.id);
                }}
                aria-label={t("ops.pipeline.advanceLead", { name: lead.name })}
                data-testid={`pipeline-advance-${lead.id}`}
                disabled={pending}
                className="pointer-events-auto flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-xl bg-white/[0.05] hover:bg-emerald-500/15 border border-white/[0.06] hover:border-emerald-500/30 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-emerald-400 transition-all duration-150 group/btn shrink-0 disabled:cursor-wait disabled:opacity-40"
              >
                <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
            </Tip>
          )}
        </div>
      </div>
    </motion.div>
  );
});

function KanbanScroller({ children, label }: { children: React.ReactNode; label: string }) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateOverflow = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setCanScrollRight(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2);
  }, []);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    window.addEventListener("resize", updateOverflow);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [children, updateOverflow]);

  return (
    <div className="relative min-w-0">
      <div
        ref={viewportRef}
        role="region"
        aria-label={label}
        data-testid="pipeline-kanban-scroll"
        onScroll={updateOverflow}
        className="-mx-1 flex flex-col gap-4 overflow-x-visible px-1 pb-4 md:flex-row md:overflow-x-auto"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.18) transparent",
        }}
      >
        {children}
      </div>
      {canScrollRight ? (
        <div
          aria-hidden="true"
          data-testid="pipeline-scroll-cue"
          className="pointer-events-none absolute inset-y-4 right-0 hidden w-12 items-center justify-end bg-gradient-to-l from-zinc-950 via-zinc-950/90 to-transparent pr-1 text-zinc-300 md:flex"
        >
          <span className="flex h-11 w-8 items-center justify-center rounded-l-xl border-y border-l border-white/10 bg-zinc-900/90 shadow-xl">
            <ChevronRight className="h-5 w-5" />
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Column
───────────────────────────────────────────── */
function KanbanColumn({
  stageId,
  columnLeads,
  onAdvance,
  onAction,
  canManage,
  pendingLeadIds,
}: {
  stageId: StageId;
  columnLeads: Lead[];
  onAdvance: (id: string) => void;
  onAction: (id: string, action: LeadAction) => void;
  canManage: boolean;
  pendingLeadIds: ReadonlySet<string>;
}) {
  const { formatCurrency, t } = useI18n();
  const stage = stages[stageId];
  const canAdvance = nextManualStage(stageId) !== null;
  const total = formatLeadAmounts(columnLeads, formatCurrency);

  return (
    <div className="flex flex-col w-full min-w-0 md:min-w-[292px] md:max-w-[292px]">
      {/* Column header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 rounded-2xl mb-3 bg-zinc-900/40 border",
          stage.border,
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", stage.dot)} />
          <span className={cn("text-sm font-semibold truncate", stage.color)}>
            {t(stage.labelKey)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-xs font-bold text-zinc-100 bg-white/[0.08] rounded-full w-5 h-5 flex items-center justify-center">
            {columnLeads.length}
          </span>
        </div>
      </div>

      {/* Value sub-line */}
      {total !== "—" && (
        <p className="text-[11px] text-zinc-500 font-medium px-1 mb-2">{total}</p>
      )}

      {/* Cards */}
      <div className="flex flex-col gap-2.5 flex-1">
        <AnimatePresence mode="popLayout">
          {columnLeads.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.05] py-10 gap-2"
            >
              <Inbox className="w-5 h-5 text-zinc-700" />
              <span className="text-xs text-zinc-700">{t("ops.pipeline.noLeads")}</span>
            </motion.div>
          ) : (
            columnLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onAdvance={onAdvance}
                onAction={onAction}
                canAdvance={canAdvance}
                canManage={canManage}
                pending={pendingLeadIds.has(lead.id)}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   List view (table fallback)
───────────────────────────────────────────── */
function ListView({
  leads,
  onAdvance,
  canManage,
  pendingLeadIds,
}: {
  leads: Lead[];
  onAdvance: (id: string) => void;
  canManage: boolean;
  pendingLeadIds: ReadonlySet<string>;
}) {
  const { go } = useNav();
  const { formatCurrency, t } = useI18n();
  const headings = [
    t("ops.pipeline.lead"),
    t("ops.pipeline.stage"),
    t("ops.common.channel"),
    t("ops.common.value"),
    t("ops.common.manager"),
    t("ops.pipeline.temperature"),
    "",
  ];
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {headings.map((h, index) => (
              <th
                key={`${h}:${index}`}
                className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {leads.map((lead) => {
              const stage = stages[lead.stage];
              const canAdvance = nextManualStage(lead.stage) !== null;
              return (
                <motion.tr
                  key={lead.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => go("conversation", { id: lead.conversationId ?? lead.id })}
                  className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={lead.name} size={28} />
                      <div>
                        <p className="font-medium text-zinc-100">{lead.name}</p>
                        <p className="text-[11px] text-zinc-500">{lead.service}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-medium", stage.color)}>
                      {t(stage.labelKey)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ChannelBadge id={lead.channel} />
                  </td>
                  <td className="px-4 py-3 font-bold text-emerald-400 whitespace-nowrap">
                    {lead.value > 0 ? formatCurrency(lead.value, lead.currency) : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{lead.manager}</td>
                  <td className="px-4 py-3">
                    <TempPill t={lead.temp} />
                  </td>
                  <td className="px-4 py-3">
                    {canAdvance && canManage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdvance(lead.id);
                        }}
                        aria-label={t("ops.pipeline.advanceLead", { name: lead.name })}
                        data-testid={`pipeline-advance-${lead.id}`}
                        disabled={pendingLeadIds.has(lead.id)}
                        className="flex items-center gap-1 rounded-lg bg-white/[0.05] hover:bg-emerald-500/15 border border-white/[0.06] hover:border-emerald-500/30 px-2 py-1 text-[11px] text-zinc-400 hover:text-emerald-400 transition-all disabled:cursor-wait disabled:opacity-40"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Stat chip
───────────────────────────────────────────── */
function StatChip({
  icon: Icon,
  label,
  value,
  testId,
  accent = "text-emerald-400",
  bg = "bg-emerald-500/10",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  testId?: string;
  accent?: string;
  bg?: string;
}) {
  return (
    <motion.div
      data-testid={testId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 border border-white/[0.06] bg-zinc-900/70",
      )}
    >
      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", bg)}>
        <Icon className={cn("w-4 h-4", accent)} />
      </div>
      <div>
        <p className="text-xs text-zinc-500">{label}</p>
        <p className="text-sm font-bold text-zinc-100 tracking-tight">{value}</p>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
export function PipelinePage() {
  const { formatCurrency, formatNumber, locale, t } = useI18n();
  const permissions = useProductPermissions();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [apiBacked, setApiBacked] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [reloadRevision, setReloadRevision] = useState(0);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [pendingLeadIds, setPendingLeadIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingLeadIdsRef = React.useRef(new Set<string>());
  const leadMutationGenerationRef = React.useRef(new Map<string, number>());

  React.useEffect(() => {
    let active = true;

    setLoadStatus("loading");
    void getPipelineSummary()
      .then(async (summary) => {
        let conversationByLeadId = new Map<string, string>();
        let conversationMapFailed = false;
        try {
          conversationByLeadId = await loadConversationMap();
        } catch {
          conversationMapFailed = true;
        }

        if (!active) return;
        const apiLeads = leadsFromPipelineSummary(summary, conversationByLeadId, locale);
        setLeads(apiLeads);
        setPipelineLoaded(true);
        setApiBacked(true);
        setLoadStatus(conversationMapFailed ? "error" : "success");
      })
      .catch(() => {
        if (!active) return;
        setLoadStatus("error");
      });

    return () => {
      active = false;
    };
  }, [locale, reloadRevision]);

  function replaceLead(id: string, patch: Partial<Lead>) {
    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, ...patch } : lead)));
  }

  function replaceWithApiLead(id: string, apiLead: Parameters<typeof leadFromApiLead>[0]) {
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === id ? leadFromApiLead(apiLead, lead.conversationId, locale) : lead,
      ),
    );
  }

  function beginLeadMutation(leadId: string): LeadMutationToken | null {
    if (pendingLeadIdsRef.current.has(leadId)) return null;
    const generation = (leadMutationGenerationRef.current.get(leadId) ?? 0) + 1;
    leadMutationGenerationRef.current.set(leadId, generation);
    pendingLeadIdsRef.current.add(leadId);
    setPendingLeadIds(new Set(pendingLeadIdsRef.current));
    return { leadId, generation };
  }

  function isCurrentLeadMutation(token: LeadMutationToken) {
    return (
      pendingLeadIdsRef.current.has(token.leadId) &&
      leadMutationGenerationRef.current.get(token.leadId) === token.generation
    );
  }

  function endLeadMutation(token: LeadMutationToken) {
    if (leadMutationGenerationRef.current.get(token.leadId) !== token.generation) return;
    pendingLeadIdsRef.current.delete(token.leadId);
    setPendingLeadIds(new Set(pendingLeadIdsRef.current));
  }

  async function reconcileLead(token: LeadMutationToken) {
    try {
      const refreshed = await getLead(token.leadId);
      if (!isCurrentLeadMutation(token)) return;
      replaceWithApiLead(token.leadId, refreshed);
    } catch {
      // Keep the last confirmed UI state when reconciliation is unavailable.
    }
  }

  /* Advance a lead to the next stage */
  async function advanceStage(id: string) {
    if (!permissions.canManageLeads) return;
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    const next = nextManualStage(lead.stage);
    if (!next) return;

    if (!apiBacked) {
      replaceLead(id, { stage: next });
      toast.success(t("ops.pipeline.moved", { stage: t(stages[next].labelKey) }));
      return;
    }

    const mutationToken = beginLeadMutation(id);
    if (!mutationToken) return;
    try {
      const updated = await updateLead(id, { status: statusFromStage(next) });
      if (!isCurrentLeadMutation(mutationToken)) return;
      replaceWithApiLead(id, updated);
      toast.success(t("ops.pipeline.moved", { stage: t(stages[next].labelKey) }));
    } catch (caught) {
      await reconcileLead(mutationToken);
      if (isCurrentLeadMutation(mutationToken)) {
        toast.error(caught instanceof Error ? caught.message : t("ops.pipeline.moveFailed"));
      }
    } finally {
      endLeadMutation(mutationToken);
    }
  }

  async function runLeadAction(id: string, action: LeadAction) {
    if (!permissions.canManageLeads) return;
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    if (action === "qualified" && !canQualifyLead(lead.stage)) return;
    if (action === "closed" && lead.stage === "closed") return;
    const localPatch = fallbackPatchForAction(action);

    if (!apiBacked) {
      replaceLead(id, localPatch);
      toast.success(t("ops.pipeline.actionDone"));
      return;
    }

    const mutationToken = beginLeadMutation(id);
    if (!mutationToken) return;
    try {
      if (action === "qualified") {
        const updated = await updateLead(id, { status: "QUALIFIED" });
        if (!isCurrentLeadMutation(mutationToken)) return;
        replaceWithApiLead(id, updated);
        toast.success(t("ops.pipeline.leadQualified"));
        return;
      }

      const updated = await updateLead(id, { status: "CLOSED" });
      if (!isCurrentLeadMutation(mutationToken)) return;
      replaceWithApiLead(id, updated);
      toast.success(t("ops.pipeline.leadClosed"));
    } catch (caught) {
      await reconcileLead(mutationToken);
      if (isCurrentLeadMutation(mutationToken)) {
        toast.error(caught instanceof Error ? caught.message : t("ops.common.actionFailed"));
      }
    } finally {
      endLeadMutation(mutationToken);
    }
  }

  /* Summary stats */
  const totalLeads = leads.length;
  const totalValue = useMemo(
    () => formatLeadAmounts(leads, formatCurrency),
    [formatCurrency, leads],
  );
  const qualifiedLeads = useMemo(
    () => leads.filter((lead) => lead.stage === "qualified"),
    [leads],
  );
  const qualificationRate =
    totalLeads > 0 ? Math.round((qualifiedLeads.length / totalLeads) * 100) : 0;
  const averageQualifiedValue = useMemo(
    () => formatLeadAmounts(qualifiedLeads, formatCurrency, "average"),
    [formatCurrency, qualifiedLeads],
  );

  /* Group leads by stage */
  const byStage = useMemo(() => {
    const map: Record<StageId, Lead[]> = {
      new: [],
      progress: [],
      qualified: [],
      booked: [],
      crm: [],
      closed: [],
    };
    leads.forEach((l) => map[l.stage].push(l));
    return map;
  }, [leads]);

  if (!pipelineLoaded) {
    return (
      <ProductLayout title={t("ops.pipeline.title")} mobileTitle={t("product.mobile.pipeline")}>
        {loadStatus === "loading" ? (
          <div className="space-y-6" data-testid="pipeline-loading">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-14 w-64 max-w-full" />
              <Skeleton className="h-10 w-44" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-80" />
              ))}
            </div>
          </div>
        ) : (
          <ResourceErrorState
            testId="pipeline-load-error"
            onRetry={() => setReloadRevision((current) => current + 1)}
          />
        )}
      </ProductLayout>
    );
  }

  return (
    <ProductLayout title={t("ops.pipeline.title")} mobileTitle={t("product.mobile.pipeline")}>
      <div className="flex flex-col gap-6 min-h-full">
        {loadStatus === "error" ? (
          <ResourceErrorState
            testId="pipeline-refresh-error"
            onRetry={() => setReloadRevision((current) => current + 1)}
          />
        ) : null}

        {/* ── Summary header ── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-4"
        >
          {/* Title row */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
                {t("ops.pipeline.heading")}
              </h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                {t("ops.pipeline.count", { count: formatNumber(totalLeads) })} ·{" "}
                {loadStatus === "loading"
                  ? t("ops.pipeline.loading")
                  : apiBacked && loadStatus === "success"
                    ? t("ops.pipeline.synced")
                    : t("ops.pipeline.loadFailed")}
              </p>
            </div>

            {/* View toggle */}
            <div className="flex items-center rounded-xl bg-zinc-900/60 border border-white/[0.06] p-1 gap-1">
              <button
                onClick={() => setView("kanban")}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                  view === "kanban"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/25"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                {t("ops.pipeline.kanban")}
              </button>
              <button
                onClick={() => setView("list")}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                  view === "list"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/25"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <List className="w-3.5 h-3.5" />
                {t("ops.pipeline.list")}
              </button>
            </div>
          </div>

          {/* Stat chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatChip
              icon={Users}
              label={t("ops.pipeline.total")}
              value={formatNumber(totalLeads)}
              testId="pipeline-stat-total"
              accent="text-sky-400"
              bg="bg-sky-500/10"
            />
            <StatChip
              icon={Wallet}
              label={t("ops.pipeline.value")}
              value={totalValue}
              testId="pipeline-stat-value"
              accent="text-emerald-400"
              bg="bg-emerald-500/10"
            />
            <StatChip
              icon={TrendingUp}
              label={t("ops.pipeline.conversion")}
              value={formatNumber(qualificationRate / 100, {
                style: "percent",
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
              })}
              testId="pipeline-stat-qualification"
              accent="text-violet-400"
              bg="bg-violet-500/10"
            />
            <StatChip
              icon={BarChart3}
              label={t("ops.pipeline.average")}
              value={averageQualifiedValue}
              testId="pipeline-stat-qualified-average"
              accent="text-amber-400"
              bg="bg-amber-500/10"
            />
          </div>
        </motion.div>

        {/* ── Board / List ── */}
        <AnimatePresence mode="wait">
          {view === "kanban" ? (
            <motion.div
              key="kanban"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <KanbanScroller label={t("ops.pipeline.heading")}>
                {stageOrder.map((stageId, i) => (
                  <motion.div
                    key={stageId}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.35 }}
                  >
                    <KanbanColumn
                      stageId={stageId}
                      columnLeads={byStage[stageId]}
                      onAdvance={(id) => void advanceStage(id)}
                      onAction={(id, action) => void runLeadAction(id, action)}
                      canManage={permissions.canManageLeads}
                      pendingLeadIds={pendingLeadIds}
                    />
                  </motion.div>
                ))}
              </KanbanScroller>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ListView
                leads={leads}
                onAdvance={(id) => void advanceStage(id)}
                canManage={permissions.canManageLeads}
                pendingLeadIds={pendingLeadIds}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Stage progress bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-2xl bg-zinc-900/40 border border-white/[0.06] p-4"
        >
          <p className="text-xs font-semibold text-zinc-500 mb-3 uppercase tracking-wider">
            {t("ops.pipeline.distribution")}
          </p>
          <div className="flex gap-1.5 h-2 rounded-full overflow-hidden">
            {stageOrder.map((s) => {
              const count = byStage[s].length;
              const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
              if (pct === 0) return null;
              const dotColor = stages[s].dot.replace("bg-", "bg-");
              return (
                <motion.div
                  key={s}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    duration: 0.6,
                    delay: stageOrder.indexOf(s) * 0.07,
                    ease: "easeOut",
                  }}
                  style={{ width: `${pct}%`, originX: 0 }}
                  className={cn("rounded-full h-full", dotColor)}
                  title={`${t(stages[s].labelKey)}: ${formatNumber(count)}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
            {stageOrder.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full shrink-0", stages[s].dot)} />
                <span className="text-[11px] text-zinc-500">
                  {t(stages[s].labelKey)}
                  <span className="ml-1 font-semibold text-zinc-300">
                    {formatNumber(byStage[s].length)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </ProductLayout>
  );
}
