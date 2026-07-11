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
  ChevronRight,
} from "lucide-react";
import { ProductLayout } from "../ProductLayout";
import {
  Card,
  Avatar,
  ChannelBadge,
  StatusPill,
  TempPill,
  channels,
  stages,
} from "../shared";
import type { ChannelId, StageId } from "../shared";
import type { Lead } from "../types";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../ui";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { listInboxConversations } from "@/lib/api/inbox";
import { createLeadTask, sendLeadToCrm } from "@/lib/api/leads";
import { leadFromConversation } from "../apiAdapters";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function formatValue(v: number): string {
  if (v === 0) return "—";
  return v.toLocaleString("ru-RU") + " ₽";
}

function needsReply(lead: Lead): boolean {
  return lead.unread > 0;
}

function useInboxLeads() {
  const [apiLeads, setApiLeads] = useState<Lead[] | null>(null);
  const [apiError, setApiError] = useState(false);

  React.useEffect(() => {
    let active = true;

    void listInboxConversations({ limit: 50 })
      .then((result) => {
        if (active) {
          setApiLeads(result.data.map(leadFromConversation));
          setApiError(false);
        }
      })
      .catch(() => {
        if (active) {
          setApiLeads([]);
          setApiError(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return {
    leads: apiLeads ?? [],
    apiLoaded: apiLeads !== null,
    apiError,
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
  if (id === "all") {
    return (
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border",
          active
            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
            : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/8"
        )}
      >
        Все каналы
      </button>
    );
  }
  const ch = channels[id];
  const Icon = ch.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border",
        active
          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
          : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/8"
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", active ? "text-emerald-400" : ch.color)} />
      {ch.label}
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
  const label = id === "all" ? "Все статусы" : stages[id].label;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border whitespace-nowrap",
        active
          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
          : "bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/8"
      )}
    >
      {id !== "all" && (
        <span className={cn("w-1.5 h-1.5 rounded-full", stages[id].dot)} />
      )}
      {label}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Lead row
───────────────────────────────────────────── */
const LeadRow = React.forwardRef<HTMLDivElement, {
  lead: Lead;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  index: number;
}>(function LeadRow({ lead, selected, onSelect, onOpen, index }, ref) {
  const ch = channels[lead.channel];
  const ChIcon = ch.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: "easeOut" }}
      layout
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          "w-full text-left group relative flex items-start gap-3 px-4 py-3.5 rounded-2xl border transition-all cursor-pointer",
          selected
            ? "bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_20px_rgba(52,211,153,0.08)]"
            : "bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/5"
        )}
      >
        {/* Avatar + channel badge */}
        <div className="relative shrink-0 mt-0.5">
          <Avatar name={lead.name} size={40} />
          <span
            className={cn(
              "absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-zinc-950 flex items-center justify-center",
              ch.bg
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
              {lead.unread > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[10px] font-bold text-zinc-950 flex items-center justify-center shadow-[0_0_10px_rgba(52,211,153,0.5)]">
                  {lead.unread}
                </span>
              )}
              <span className="text-[11px] text-zinc-500">{lead.time}</span>
            </div>
          </div>

          <p className="text-xs text-zinc-400 truncate mb-2 leading-snug">{lead.lastMessage}</p>

          <div className="flex items-center gap-1.5 flex-wrap">
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

        {/* Open affordance on desktop hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="hidden lg:flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity items-center gap-1 self-center text-[11px] text-emerald-400 font-medium hover:text-emerald-300"
        >
          Открыть
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
});

/* ─────────────────────────────────────────────
   Right pane – lead summary
───────────────────────────────────────────── */
function LeadSummary({ lead }: { lead: Lead }) {
  const { go } = useNav();
  const [pendingAction, setPendingAction] = useState<"crm" | "task" | null>(null);

  const fields: { label: string; value: string }[] = [
    { label: "Источник", value: lead.source },
    { label: "Услуга", value: lead.service },
    { label: "Менеджер", value: lead.manager },
    { label: "Сумма", value: formatValue(lead.value) },
    { label: "Канал", value: channels[lead.channel].label },
  ];

  const handleSendToCrm = async () => {
    if (!lead.apiLeadId) {
      toast.error("Действие доступно только для API-лида");
      return;
    }
    setPendingAction("crm");
    try {
      await sendLeadToCrm(lead.apiLeadId);
      toast.success("Лид отправлен в CRM");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить лида в CRM");
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateTask = async () => {
    if (!lead.apiLeadId) {
      toast.error("Действие доступно только для API-лида");
      return;
    }
    setPendingAction("task");
    try {
      await createLeadTask(lead.apiLeadId, `Связаться с ${lead.name}`);
      toast.success("Задача создана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать задачу");
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
            Последнее сообщение
          </p>
          <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
            <p className="text-xs text-zinc-300 leading-relaxed">{lead.lastMessage}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{lead.time} назад</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full justify-center"
            onClick={() => go("conversation", { id: lead.conversationId ?? lead.id })}
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            Открыть диалог
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={pendingAction !== null}
            onClick={() => void handleSendToCrm()}
          >
            <Database className="w-4 h-4 mr-1.5" />
            {pendingAction === "crm" ? "Отправляем..." : "В CRM"}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-center"
            disabled={pendingAction !== null}
            onClick={() => void handleCreateTask()}
          >
            <ClipboardList className="w-4 h-4 mr-1.5" />
            {pendingAction === "task" ? "Создаём..." : "Создать задачу"}
          </Button>
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
  const { leads: inboxLeads, apiLoaded, apiError } = useInboxLeads();

  const [selectedId, setSelectedId] = useState<string>("");
  const [channelFilter, setChannelFilter] = useState<ChannelId | "all">("all");
  const [stageFilter, setStageFilter] = useState<StageId | "all">("all");
  const [search, setSearch] = useState(initialSearch);

  React.useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  React.useEffect(() => {
    if (inboxLeads.length === 0) {
      if (selectedId) setSelectedId("");
      return;
    }

    if (!inboxLeads.some((lead) => lead.id === selectedId)) {
      setSelectedId(inboxLeads[0]?.id ?? "");
    }
  }, [inboxLeads, selectedId]);

  const selectedLead = inboxLeads.find((l) => l.id === selectedId) ?? inboxLeads[0] ?? null;
  const hasActiveFilters = channelFilter !== "all" || stageFilter !== "all" || search.trim().length > 0;

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

  const needsReplyCount = filtered.filter(needsReply).length;

  const channelIds = Object.keys(channels) as ChannelId[];
  const stageIds = Object.keys(stages) as StageId[];

  return (
    <ProductLayout title="Входящие">
      <div className="h-[calc(100vh-9rem)] flex flex-col gap-0 -mx-4 lg:-mx-8 -mt-6 px-0">
        {/* Two-pane layout */}
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_340px] gap-0 divide-x divide-white/5">

          {/* ── LEFT PANE ── */}
          <div className="flex flex-col min-h-0 overflow-hidden">

            {/* Filter bar */}
            <div className="shrink-0 px-4 lg:px-6 pt-5 pb-3 space-y-3 border-b border-white/5 bg-zinc-950/95">

              {/* Search */}
              <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 px-3 h-9 focus-within:border-emerald-500/30 focus-within:bg-emerald-500/5 transition-all">
                <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <input
                  aria-label="Поиск в диалогах"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени или сообщению..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600 text-zinc-100"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-zinc-500 hover:text-zinc-300 text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Channel chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
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
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
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
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-zinc-600" />
                <span className="text-xs text-zinc-500">
                  <span className="text-zinc-300 font-medium">{filtered.length}</span>
                  {" "}диалог{filtered.length === 1 ? "" : filtered.length < 5 ? "а" : "ов"}
                  {needsReplyCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-emerald-400 font-medium">{needsReplyCount}</span>
                      {" "}требуют ответа
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Lead list */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-10"
                  >
                    <EmptyState
                      icon={Search}
                      title={hasActiveFilters ? "Ничего не найдено" : "Диалогов пока нет"}
                      description={
                        hasActiveFilters
                          ? "Нет диалогов, соответствующих выбранным фильтрам или поисковому запросу."
                          : apiLoaded
                            ? "Когда клиенты напишут в подключённые каналы, новые диалоги появятся здесь."
                            : apiError
                              ? "Не удалось загрузить диалоги. Обновите страницу или войдите снова."
                              : "Загружаем диалоги..."
                      }
                      action={hasActiveFilters ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setChannelFilter("all");
                            setStageFilter("all");
                            setSearch("");
                          }}
                        >
                          Сбросить фильтры
                        </Button>
                      ) : undefined}
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
                      onOpen={() => go("conversation", { id: lead.id })}
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
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="Нет выбранного диалога"
                description="Выберите диалог из списка или дождитесь нового входящего обращения."
              />
            )}
          </div>
        </div>
      </div>
    </ProductLayout>
  );
}
