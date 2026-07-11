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
  Inbox,
  MoreHorizontal,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import {
  Avatar,
  ChannelBadge,
  TempPill,
  stages,
  stageOrder,
  type StageId,
} from "../shared";
import type { Lead } from "../types";
import { useNav } from "../nav";
import { cn } from "../../lib/utils";
import { Dropdown, DropdownItem, DropdownSeparator, Tip } from "../ui";
import { toast } from "sonner";
import {
  bookLeadAppointment,
  createLeadTask,
  getPipelineSummary,
  sendLeadToCrm,
  updateLead,
  type PipelineSummary,
} from "@/lib/api/leads";
import { listInboxConversations } from "@/lib/api/inbox";
import { leadFromApiLead, statusFromStage } from "../apiAdapters";

/* ─────────────────────────────────────────────
   Summary helpers
───────────────────────────────────────────── */
function fmt(n: number) {
  return n.toLocaleString("ru-RU");
}

type LeadAction = "qualified" | "crm" | "task" | "booking" | "closed";

function leadsFromPipelineSummary(summary: PipelineSummary, conversationByLeadId: Map<string, string>) {
  return summary.stages.flatMap((stage) =>
    stage.leads.map((lead) => leadFromApiLead(lead, conversationByLeadId.get(lead.id)))
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
    case "crm":
      return { stage: "crm" };
    case "booking":
      return { stage: "booked" };
    case "closed":
      return { stage: "closed" };
    case "task":
      return {};
  }
}

/* ─────────────────────────────────────────────
   Lead card
───────────────────────────────────────────── */
const LeadCard = React.forwardRef<HTMLDivElement, {
  lead: Lead;
  onAdvance: (id: string) => void;
  onAction: (id: string, action: LeadAction) => void;
  isLast: boolean;
}>(function LeadCard({ lead, onAdvance, onAction, isLast }, ref) {
  const { go } = useNav();
  const conversationId = lead.conversationId ?? lead.id;

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
      className="group cursor-pointer select-none"
      onClick={() => go("conversation", { id: conversationId })}
    >
      <div className="rounded-2xl bg-zinc-900/70 border border-white/[0.06] p-4 hover:border-white/[0.12] hover:bg-zinc-900/80 transition-all duration-200">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={lead.name} size={34} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{lead.name}</p>
              <p className="text-[11px] text-zinc-500 truncate mt-0.5">{lead.service}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <TempPill t={lead.temp} />
            <Dropdown
              trigger={
                <button
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Действия лида: ${lead.name}`}
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              }
            >
              <DropdownItem onClick={() => go("conversation", { id: conversationId })}>
                Открыть диалог
              </DropdownItem>
              <DropdownItem onClick={() => onAction(lead.id, "qualified")}>
                Отметить квалифицированным
              </DropdownItem>
              <DropdownItem onClick={() => onAction(lead.id, "crm")}>
                Отправить в CRM
              </DropdownItem>
              <DropdownItem onClick={() => onAction(lead.id, "task")}>
                Создать задачу
              </DropdownItem>
              <DropdownItem onClick={() => onAction(lead.id, "booking")}>
                Записать на приём
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem danger onClick={() => onAction(lead.id, "closed")}>
                Закрыть лид
              </DropdownItem>
            </Dropdown>
          </div>
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <ChannelBadge id={lead.channel} />
          {lead.manager !== "—" && (
            <span className="text-[11px] text-zinc-500 bg-white/[0.04] rounded-full px-2 py-0.5 border border-white/[0.05]">
              {lead.manager}
            </span>
          )}
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-emerald-400 tracking-tight">
              {lead.value > 0 ? `${fmt(lead.value)} ₽` : "—"}
            </span>
            <span className="text-[10px] text-zinc-600 truncate max-w-[120px]">{lead.source}</span>
          </div>

          {/* Advance stage button */}
          {!isLast && (
            <Tip content="Переместить на следующий этап">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdvance(lead.id);
                }}
                aria-label={`Переместить лид: ${lead.name}`}
                className="flex items-center gap-1 rounded-xl bg-white/[0.05] hover:bg-emerald-500/15 border border-white/[0.06] hover:border-emerald-500/30 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-emerald-400 transition-all duration-150 group/btn shrink-0"
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

/* ─────────────────────────────────────────────
   Column
───────────────────────────────────────────── */
function KanbanColumn({
  stageId,
  columnLeads,
  onAdvance,
  onAction,
}: {
  stageId: StageId;
  columnLeads: Lead[];
  onAdvance: (id: string) => void;
  onAction: (id: string, action: LeadAction) => void;
}) {
  const stage = stages[stageId];
  const isLast = stageId === "closed";
  const total = columnLeads.reduce((s, l) => s + l.value, 0);

  return (
    <div className="flex flex-col w-full min-w-0 md:min-w-[292px] md:max-w-[292px]">
      {/* Column header */}
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 rounded-2xl mb-3 bg-zinc-900/40 border",
          stage.border
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", stage.dot)} />
          <span className={cn("text-sm font-semibold truncate", stage.color)}>
            {stage.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-xs font-bold text-zinc-100 bg-white/[0.08] rounded-full w-5 h-5 flex items-center justify-center">
            {columnLeads.length}
          </span>
        </div>
      </div>

      {/* Value sub-line */}
      {total > 0 && (
        <p className="text-[11px] text-zinc-500 font-medium px-1 mb-2">
          {fmt(total)} ₽
        </p>
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
              <span className="text-xs text-zinc-700">Нет лидов</span>
            </motion.div>
          ) : (
            columnLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onAdvance={onAdvance}
                onAction={onAction}
                isLast={isLast}
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
function ListView({ leads, onAdvance }: { leads: Lead[]; onAdvance: (id: string) => void }) {
  const { go } = useNav();
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {["Лид", "Этап", "Канал", "Сумма", "Менеджер", "Температура", ""].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {leads.map((lead) => {
              const stage = stages[lead.stage];
              const isLast = lead.stage === "closed";
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
                      {stage.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ChannelBadge id={lead.channel} />
                  </td>
                  <td className="px-4 py-3 font-bold text-emerald-400 whitespace-nowrap">
                    {lead.value > 0 ? `${fmt(lead.value)} ₽` : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{lead.manager}</td>
                  <td className="px-4 py-3">
                    <TempPill t={lead.temp} />
                  </td>
                  <td className="px-4 py-3">
                    {!isLast && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAdvance(lead.id); }}
                        aria-label={`Переместить лид: ${lead.name}`}
                        className="flex items-center gap-1 rounded-lg bg-white/[0.05] hover:bg-emerald-500/15 border border-white/[0.06] hover:border-emerald-500/30 px-2 py-1 text-[11px] text-zinc-400 hover:text-emerald-400 transition-all"
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
  accent = "text-emerald-400",
  bg = "bg-emerald-500/10",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
  bg?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 border border-white/[0.06] bg-zinc-900/70"
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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [apiBacked, setApiBacked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "list">("kanban");

  React.useEffect(() => {
    let active = true;

    setIsLoading(true);
    void getPipelineSummary()
      .then(async (summary) => {
        let conversationByLeadId = new Map<string, string>();
        try {
          conversationByLeadId = await loadConversationMap();
        } catch {
          conversationByLeadId = new Map<string, string>();
        }

        if (!active) return;
        const apiLeads = leadsFromPipelineSummary(summary, conversationByLeadId);
        setLeads(apiLeads);
        setApiBacked(true);
      })
      .catch(() => {
        if (!active) return;
        setLeads([]);
        setApiBacked(false);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function replaceLead(id: string, patch: Partial<Lead>) {
    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, ...patch } : lead)));
  }

  function replaceWithApiLead(id: string, apiLead: Parameters<typeof leadFromApiLead>[0]) {
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === id ? leadFromApiLead(apiLead, lead.conversationId) : lead
      )
    );
  }

  /* Advance a lead to the next stage */
  async function advanceStage(id: string) {
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    const idx = stageOrder.indexOf(lead.stage);
    if (idx === stageOrder.length - 1) return;
    const next = stageOrder[idx + 1];
    replaceLead(id, { stage: next });

    if (!apiBacked) {
      toast.success(`Лид перемещён: ${stages[next].label}`);
      return;
    }

    try {
      const updated = await updateLead(id, { status: statusFromStage(next) });
      replaceWithApiLead(id, updated);
      toast.success(`Лид перемещён: ${stages[next].label}`);
    } catch (caught) {
      replaceLead(id, lead);
      toast.error(caught instanceof Error ? caught.message : "Не удалось обновить этап лида");
    }
  }

  async function runLeadAction(id: string, action: LeadAction) {
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    const localPatch = fallbackPatchForAction(action);
    replaceLead(id, localPatch);

    if (!apiBacked) {
      toast.success(action === "task" ? "Задача создана" : "Действие выполнено");
      return;
    }

    try {
      if (action === "qualified") {
        const updated = await updateLead(id, { status: "QUALIFIED" });
        replaceWithApiLead(id, updated);
        toast.success("Лид квалифицирован");
        return;
      }

      if (action === "crm") {
        const updated = await sendLeadToCrm(id);
        replaceWithApiLead(id, updated);
        toast.success("Лид отправлен в CRM");
        return;
      }

      if (action === "task") {
        await createLeadTask(id, "Связаться с лидом из воронки");
        toast.success("Задача создана");
        return;
      }

      if (action === "booking") {
        await bookLeadAppointment(id, lead.service || "Запись", new Date(Date.now() + 24 * 60 * 60_000).toISOString());
        replaceLead(id, { stage: "booked" });
        toast.success("Запись создана");
        return;
      }

      const updated = await updateLead(id, { status: "CLOSED" });
      replaceWithApiLead(id, updated);
      toast.success("Лид закрыт");
    } catch (caught) {
      replaceLead(id, lead);
      toast.error(caught instanceof Error ? caught.message : "Не удалось выполнить действие");
    }
  }

  /* Summary stats */
  const totalLeads = leads.length;
  const totalValue = useMemo(() => leads.reduce((s, l) => s + l.value, 0), [leads]);
  const bookedLeads = leads.filter((l) => l.stage === "booked" || l.stage === "crm" || l.stage === "closed").length;
  const convRate = totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 100) : 0;
  const avgCheck = bookedLeads > 0
    ? Math.round(leads.filter((l) => l.value > 0).reduce((s, l) => s + l.value, 0) / leads.filter((l) => l.value > 0).length)
    : 0;

  /* Group leads by stage */
  const byStage = useMemo(() => {
    const map: Record<StageId, Lead[]> = {
      new: [], progress: [], qualified: [], booked: [], crm: [], closed: [],
    };
    leads.forEach((l) => map[l.stage].push(l));
    return map;
  }, [leads]);

  return (
    <ProductLayout title="Воронка / CRM">
      <div className="flex flex-col gap-6 min-h-full">

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
                Воронка продаж
              </h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                {totalLeads} лидов · {isLoading ? "загружаем данные" : apiBacked ? "синхронизировано с API" : "не удалось загрузить данные"}
              </p>
            </div>

            {/* View toggle */}
            <div className="flex items-center rounded-xl bg-zinc-900/60 border border-white/[0.06] p-1 gap-1">
              <button
                onClick={() => setView("kanban")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  view === "kanban"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/25"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Канбан
              </button>
              <button
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  view === "list"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/25"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <List className="w-3.5 h-3.5" />
                Список
              </button>
            </div>
          </div>

          {/* Stat chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatChip
              icon={Users}
              label="Всего лидов"
              value={String(totalLeads)}
              accent="text-sky-400"
              bg="bg-sky-500/10"
            />
            <StatChip
              icon={Wallet}
              label="Сумма воронки"
              value={`${fmt(totalValue)} ₽`}
              accent="text-emerald-400"
              bg="bg-emerald-500/10"
            />
            <StatChip
              icon={TrendingUp}
              label="Конверсия"
              value={`${convRate}%`}
              accent="text-violet-400"
              bg="bg-violet-500/10"
            />
            <StatChip
              icon={BarChart3}
              label="Средний чек"
              value={avgCheck > 0 ? `${fmt(avgCheck)} ₽` : "—"}
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
              /* Horizontal scroll on desktop; vertical stack on mobile */
              className="flex flex-col md:flex-row gap-4 overflow-x-visible md:overflow-x-auto pb-4 -mx-1 px-1"
              style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}
            >
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
                    onAdvance={advanceStage}
                    onAction={runLeadAction}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ListView leads={leads} onAdvance={advanceStage} />
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
            Распределение по этапам
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
                  transition={{ duration: 0.6, delay: stageOrder.indexOf(s) * 0.07, ease: "easeOut" }}
                  style={{ width: `${pct}%`, originX: 0 }}
                  className={cn("rounded-full h-full", dotColor)}
                  title={`${stages[s].label}: ${count}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
            {stageOrder.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full shrink-0", stages[s].dot)} />
                <span className="text-[11px] text-zinc-500">
                  {stages[s].label}
                  <span className="ml-1 font-semibold text-zinc-300">{byStage[s].length}</span>
                </span>
              </div>
            ))}
          </div>
        </motion.div>

      </div>
    </ProductLayout>
  );
}
