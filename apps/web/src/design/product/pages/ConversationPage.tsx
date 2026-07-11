import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  Send,
  Paperclip,
  Smile,
  ChevronDown,
  ChevronUp,
  Database,
  CheckSquare,
  CalendarPlus,
  BadgeCheck,
  Clock,
  User,
  Zap,
  MoreVertical,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { Dropdown, DropdownItem, DropdownSeparator } from "../ui";
import { toast } from "sonner";
import { ProductLayout, BackButton } from "../ProductLayout";
import { useProductMode } from "../ProductMode";
import { Card, Avatar, ChannelBadge, StatusPill, TempPill } from "../shared";
import type { ChatMessage, Lead } from "../types";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../ui";
import { cn } from "../../lib/utils";
import {
  draftAiReply,
  getConversation,
  handoffConversation,
  type ConversationAttachmentDraft,
  sendConversationMessage,
  updateConversationStatus,
} from "@/lib/api/conversations";
import {
  bookLeadAppointment,
  createLeadTask,
  sendLeadToCrm,
  updateLead,
} from "@/lib/api/leads";
import type { ConversationDetail, ConversationStatus, Lead as ApiLead, LeadEvent } from "@leadvirt/types";
import { leadFromConversation, messagesFromConversation, relativeTimeLabel } from "../apiAdapters";

/* ── helpers ─────────────────────────────────────────────────── */
function formatValue(v: number) {
  return v.toLocaleString("ru-RU");
}

function formatAttachmentSize(sizeBytes?: number | null) {
  if (!sizeBytes) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${Math.round(sizeBytes / 1024)} KB`;
}

/* ── Timeline data ───────────────────────────────────────────── */
type TimelineItem = {
  icon: typeof User;
  label: string;
  time: string;
  color: string;
};

const quickReplies = [
  "Уточнить услугу",
  "Предложить время",
  "Отправить прайс",
  "Подтвердить запись",
  "Передать менеджеру",
];

const emojiOptions = ["🙂", "👍", "🔥", "✅", "🙏", "❤️", "📅", "💬"];

const demoReplayTypingMs = 900;
const demoReplayGapMs = 2100;
const ATTACHMENT_MAX_BYTES = 60 * 1024;
const acceptedAttachmentTypes = ["image/png", "image/jpeg", "application/pdf", "text/plain"];

type PendingAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
};

function liveTime() {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function liveDemoMessage(id: string, from: ChatMessage["from"], text: string): ChatMessage {
  return { id, from, text, time: liveTime() };
}

function demoReplayScript(conversationId: string, sourceMessages: ChatMessage[]) {
  if (conversationId === "demo-conv-anna") {
    return [
      liveDemoMessage("demo-replay-anna-1", "client", "Здравствуйте! Хочу окрашивание и стрижку. В пятницу после 17:00 есть свободное время?"),
      liveDemoMessage("demo-replay-anna-2", "ai", "Здравствуйте! Есть пятница 18:00 у мастера Алины. Чтобы точнее сориентировать по цене: волосы до плеч или длиннее?"),
      liveDemoMessage("demo-replay-anna-3", "client", "До плеч. Хочу тёплый блонд без сильного осветления."),
      liveDemoMessage("demo-replay-anna-4", "ai", "Тогда ориентир 8 000-10 000 ₽ и около 3 часов. Забронировать пятницу 18:00?"),
      liveDemoMessage("demo-replay-anna-5", "client", "Да, забронируйте. Телефон +7 999 123-45-67."),
      liveDemoMessage("demo-replay-anna-6", "ai", "Готово: закрепила пятницу 18:00, создала лид и передала менеджеру карточку с услугой, бюджетом и телефоном."),
    ];
  }

  const normalized = sourceMessages.map((message, index) => ({ ...message, id: `demo-replay-${conversationId}-${index}`, time: liveTime() }));
  if (normalized.length > 0 && normalized[normalized.length - 1].from === "client") {
    normalized.push(
      liveDemoMessage(
        `demo-replay-${conversationId}-ai-followup`,
        "ai",
        "Спасибо! Я уточню детали, предложу ближайшее время и сохраню лид для менеджера."
      )
    );
  }
  return normalized;
}

function demoTypingLabel(from: ChatMessage["from"]) {
  if (from === "client") return "Клиент печатает...";
  if (from === "ai") return "AI отвечает...";
  return "Менеджер печатает...";
}

function eventIconAndColor(type: string): Pick<TimelineItem, "icon" | "color"> {
  if (type.includes("crm")) return { icon: Database, color: "text-emerald-400" };
  if (type.includes("task")) return { icon: CheckSquare, color: "text-sky-400" };
  if (type.includes("booking") || type.includes("appointment")) return { icon: CalendarPlus, color: "text-violet-400" };
  if (type.includes("qualified") || type.includes("updated")) return { icon: BadgeCheck, color: "text-emerald-400" };
  if (type.includes("ai")) return { icon: Bot, color: "text-emerald-400" };
  if (type.includes("message")) return { icon: User, color: "text-zinc-400" };
  return { icon: Zap, color: "text-amber-400" };
}

function localizeEventTitle(event: LeadEvent) {
  const labels: Record<string, string> = {
    "Message sent": "Сообщение отправлено",
    "AI reply queued": "AI-ответ поставлен в очередь",
    "Lead sent to CRM": "Лид отправлен в CRM",
  };
  return labels[event.title] ?? event.title;
}

function timelineFromEvents(events?: LeadEvent[]) {
  if (!events?.length) return [];
  return events.slice(0, 6).map((event) => ({
    ...eventIconAndColor(event.type),
    label: localizeEventTitle(event),
    time: relativeTimeLabel(event.createdAt),
  }));
}

function senderLabel(from: ChatMessage["from"]) {
  if (from === "client") return "Клиент";
  if (from === "ai") return "AI";
  return "Менеджер";
}

function sanitizeFilePart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "conversation";
}

function buildTranscript(lead: Lead, messages: ChatMessage[], conversationId: string, status: ConversationStatus) {
  const header = [
    "LeadVirt conversation export",
    `Conversation ID: ${conversationId}`,
    `Lead: ${lead.name}`,
    `Service: ${lead.service}`,
    `Source: ${lead.source}`,
    `Status: ${status}`,
    "",
    "Messages:",
  ];

  const body = messages.map((message) => `[${message.time}] ${senderLabel(message.from)}: ${message.text}`);
  return [...header, ...body, ""].join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Message bubble ──────────────────────────────────────────── */
function MessageBubble({ msg, index, customerInitial }: { msg: ChatMessage; index: number; customerInitial: string }) {
  const isClient = msg.from === "client";
  const isAI = msg.from === "ai";
  const isManager = msg.from === "manager";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: "easeOut" }}
      className={cn(
        "flex gap-2.5 max-w-[85%] sm:max-w-[72%]",
        isClient ? "self-start" : "self-end flex-row-reverse"
      )}
    >
      {isClient && (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-semibold">
            {customerInitial}
          </div>
        </div>
      )}
      {isAI && (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        </div>
      )}
      {isManager && (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 text-xs font-semibold">
            М
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {isAI && (
          <span className="text-[10px] font-semibold text-emerald-400 self-end pr-1">AI</span>
        )}
        {isManager && (
          <span className="text-[10px] font-semibold text-indigo-400 self-end pr-1">Менеджер</span>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isClient && "bg-zinc-800 text-zinc-100 rounded-tl-sm",
            isAI && "bg-emerald-500/15 border border-emerald-500/20 text-zinc-100 rounded-tr-sm",
            isManager && "bg-indigo-500/15 border border-indigo-500/20 text-zinc-100 rounded-tr-sm"
          )}
        >
          {msg.text ? <p>{msg.text}</p> : null}
          {msg.attachments?.length ? (
            <div className={cn("flex flex-col gap-1.5", msg.text && "mt-2")}>
              {msg.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  download={attachment.filename ?? "attachment"}
                  data-testid={`conversation-message-attachment-${attachment.id}`}
                  className="flex max-w-64 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-emerald-400/30 hover:text-emerald-200"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{attachment.filename ?? "attachment"}</span>
                  {formatAttachmentSize(attachment.sizeBytes) ? (
                    <span className="shrink-0 text-zinc-500">{formatAttachmentSize(attachment.sizeBytes)}</span>
                  ) : null}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <span className="text-[10px] text-zinc-600 px-1">{msg.time}</span>
      </div>
    </motion.div>
  );
}

function TypingBubble({ from, customerInitial }: { from: ChatMessage["from"]; customerInitial: string }) {
  const isClient = from === "client";
  const isAI = from === "ai";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className={cn("flex gap-2.5 max-w-[85%] sm:max-w-[72%]", isClient ? "self-start" : "self-end flex-row-reverse")}
    >
      {isClient ? (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 text-xs font-semibold">
            {customerInitial}
          </div>
        </div>
      ) : null}
      {isAI ? (
        <div className="shrink-0 mt-1">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isClient && "bg-zinc-800 text-zinc-100 rounded-tl-sm",
          isAI && "bg-emerald-500/15 border border-emerald-500/20 text-zinc-100 rounded-tr-sm"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">{demoTypingLabel(from)}</span>
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((dot) => (
              <motion.span
                key={dot}
                animate={{ opacity: [0.35, 1, 0.35], y: [0, -2, 0] }}
                transition={{ duration: 0.8, repeat: Infinity, delay: dot * 0.12 }}
                className={cn("h-1.5 w-1.5 rounded-full", isAI ? "bg-emerald-300" : "bg-zinc-400")}
              />
            ))}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Lead info panel ─────────────────────────────────────────── */
type LeadAction = "crm" | "task" | "appointment" | "qualified";
type ConversationAction = "handoff" | "close" | "open";

function LeadInfoPanel({
  lead,
  timelineItems,
  pendingAction,
  onAction,
}: {
  lead: Lead;
  timelineItems: TimelineItem[];
  pendingAction: LeadAction | null;
  onAction: (action: LeadAction) => void;
}) {
  const isPending = (action: LeadAction) => pendingAction === action;

  return (
    <div className="flex flex-col gap-4">
      {/* Info card */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-tight mb-4">
          Информация о лиде
        </h3>
        <div className="space-y-3">
          <InfoRow label="Статус">
            <StatusPill stage={lead.stage} />
          </InfoRow>
          <InfoRow label="Температура">
            <TempPill t={lead.temp} />
          </InfoRow>
          <InfoRow label="Менеджер">
            <span className="text-sm text-zinc-300">{lead.manager}</span>
          </InfoRow>
          <InfoRow label="Источник">
            <span className="text-sm text-zinc-300">{lead.source}</span>
          </InfoRow>
          <InfoRow label="Услуга">
            <span className="text-sm text-zinc-300">{lead.service}</span>
          </InfoRow>
          <InfoRow label="Сумма">
            <span className="text-sm font-semibold text-emerald-400">
              {formatValue(lead.value)} ₽
            </span>
          </InfoRow>
          <InfoRow label="Канал">
            <ChannelBadge id={lead.channel} withLabel />
          </InfoRow>
        </div>
      </Card>

      {/* Actions */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-tight mb-3">Действия</h3>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="w-full justify-start gap-2" disabled={Boolean(pendingAction)} onClick={() => onAction("crm")}>
            {isPending("crm") ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            Отправить в CRM
          </Button>
          <button disabled={Boolean(pendingAction)} onClick={() => onAction("task")} className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed">
            {isPending("task") ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : <CheckSquare className="w-4 h-4 text-zinc-400" />}
            Создать задачу
          </button>
          <button disabled={Boolean(pendingAction)} onClick={() => onAction("appointment")} className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed">
            {isPending("appointment") ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : <CalendarPlus className="w-4 h-4 text-zinc-400" />}
            Записать на приём
          </button>
          <button disabled={Boolean(pendingAction)} onClick={() => onAction("qualified")} className="w-full flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors px-3 py-2 text-sm font-medium text-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed">
            {isPending("qualified") ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
            Отметить квалифицированным
          </button>
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-zinc-300 tracking-tight mb-4">Таймлайн</h3>
        <div className="relative">
          <div className="absolute left-[13px] top-1 bottom-1 w-px bg-white/5" />
          <div className="space-y-4">
            {timelineItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.07 }}
                  className="flex items-start gap-3 relative"
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0 z-10",
                      item.color
                    )}
                  >
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-xs text-zinc-300 font-medium">{item.label}</p>
                    <p className="text-[10px] text-zinc-600 flex items-center gap-1 mt-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {item.time}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <div className="flex items-center justify-end">{children}</div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export function ConversationPage() {
  const { demo } = useProductMode();
  const { params } = useNav();
  const conversationId = typeof params.id === "string" && params.id.length > 0 ? params.id : "";

  const [apiConversation, setApiConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [demoReplayMessages, setDemoReplayMessages] = useState<ChatMessage[]>([]);
  const [demoReplayState, setDemoReplayState] = useState<"idle" | "playing" | "paused" | "done" | "skipped">("idle");
  const [demoTypingFrom, setDemoTypingFrom] = useState<ChatMessage["from"] | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showLeadInfo, setShowLeadInfo] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDraftingAiReply, setIsDraftingAiReply] = useState(false);
  const [pendingLeadAction, setPendingLeadAction] = useState<LeadAction | null>(null);
  const [pendingConversationAction, setPendingConversationAction] = useState<ConversationAction | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const demoReplayTimersRef = useRef<number[]>([]);
  const lead = apiConversation ? leadFromConversation(apiConversation) : null;
  const apiLeadId = apiConversation?.lead?.id ?? null;
  const timelineItems = timelineFromEvents(apiConversation?.events);
  const conversationStatus = apiConversation?.status ?? "OPEN";
  const conversationModeLabel =
    conversationStatus === "WAITING_FOR_HUMAN"
      ? "Передано менеджеру"
      : conversationStatus === "CLOSED"
        ? "Диалог закрыт"
        : apiConversation?.aiEnabled === false
          ? "AI выключен"
          : "AI ведёт диалог";
  const customerInitial = lead?.name.trim().charAt(0).toUpperCase() || "К";
  const isDemoConversation = demo && conversationId.startsWith("demo-conv-");
  const hasDemoReplay = isDemoConversation && demoReplayMessages.length > 0;

  function clearDemoReplayTimers() {
    demoReplayTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    demoReplayTimersRef.current = [];
  }

  function revealDemoReplay(state: "paused" | "done" | "skipped") {
    clearDemoReplayTimers();
    setDemoTypingFrom(null);
    if (demoReplayMessages.length > 0) setMessages(demoReplayMessages);
    setDemoReplayState(state);
  }

  function pauseDemoReplayForInteraction() {
    if (demoReplayState === "playing") revealDemoReplay("paused");
  }

  function restartDemoReplay() {
    if (!hasDemoReplay) return;
    clearDemoReplayTimers();
    setMessages([]);
    setDemoTypingFrom(null);
    setDemoReplayState("playing");
  }

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, demoTypingFrom]);

  useEffect(() => {
    return () => {
      clearDemoReplayTimers();
    };
  }, []);

  useEffect(() => {
    clearDemoReplayTimers();

    if (!hasDemoReplay || demoReplayState !== "playing") return;

    setMessages([]);
    setDemoTypingFrom(null);

    let offset = 500;
    demoReplayMessages.forEach((message, index) => {
      const typingTimer = window.setTimeout(() => {
        setDemoTypingFrom(message.from);
      }, offset);
      const messageTimer = window.setTimeout(() => {
        setMessages((current) => [...current, message]);
        setDemoTypingFrom(null);
        if (index === demoReplayMessages.length - 1) setDemoReplayState("done");
      }, offset + demoReplayTypingMs);

      demoReplayTimersRef.current.push(typingTimer, messageTimer);
      offset += demoReplayTypingMs + demoReplayGapMs;
    });

    return () => {
      clearDemoReplayTimers();
    };
  }, [conversationId, demoReplayMessages, demoReplayState, hasDemoReplay]);

  useEffect(() => {
    let active = true;

    setApiConversation(null);
    setMessages([]);
    setPendingAttachments([]);

    if (!conversationId) {
      setIsLoadingConversation(false);
      return () => {
        active = false;
      };
    }

    setIsLoadingConversation(true);
    void getConversation(conversationId)
      .then((conversation) => {
        if (!active) return;
        setApiConversation(conversation);
        const nextMessages = messagesFromConversation(conversation);
        if (demo && conversationId.startsWith("demo-conv-")) {
          const replayMessages = demoReplayScript(conversationId, nextMessages);
          setDemoReplayMessages(replayMessages);
          setMessages([]);
          setDemoTypingFrom(null);
          setDemoReplayState(replayMessages.length > 0 ? "playing" : "idle");
        } else {
          setDemoReplayMessages([]);
          setDemoTypingFrom(null);
          setDemoReplayState("idle");
          setMessages(nextMessages);
        }
      })
      .catch(() => {
        if (!active) return;
        setApiConversation(null);
        setMessages([]);
      })
      .finally(() => {
        if (active) setIsLoadingConversation(false);
      });

    return () => {
      active = false;
    };
  }, [conversationId, demo]);

  if (!lead) {
    return (
      <ProductLayout title="Диалог">
        <BackButton to="inbox" label="Назад во входящие" />
        <div className="flex min-h-[50vh] items-center justify-center">
          <EmptyState
            icon={MessageSquare}
            title={isLoadingConversation ? "Загружаем диалог" : "Диалог не найден"}
            description={
              isLoadingConversation
                ? "Проверяем обращение в базе workspace."
                : "Откройте диалог из списка входящих. В рабочем пространстве показываются только реальные обращения из вашей базы."
            }
          />
        </div>
      </ProductLayout>
    );
  }

  async function handleAttachmentSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!acceptedAttachmentTypes.includes(file.type)) {
      toast.error("Можно прикрепить PNG, JPG, PDF или TXT");
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error("Файл должен быть до 60 КБ");
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("empty")));
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
      setPendingAttachments([
        {
          id: `pending-${Date.now()}`,
          filename: file.name,
          mimeType: file.type,
          url: dataUrl,
          sizeBytes: file.size,
        },
      ]);
      toast.success("Файл прикреплён");
    } catch {
      toast.error("Не удалось прочитать файл");
    }
  }

  async function handleSend() {
    const text = inputValue.trim();
    if ((!text && pendingAttachments.length === 0) || isSending) return;
    pauseDemoReplayForInteraction();
    const attachments = pendingAttachments;
    const newMsg: ChatMessage = {
      id: `m${Date.now()}`,
      from: "manager",
      text,
      time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        url: attachment.url,
        sizeBytes: attachment.sizeBytes,
      })),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputValue("");
    setPendingAttachments([]);

    if (!apiConversation) return;

    setIsSending(true);
    try {
      const attachmentPayload: ConversationAttachmentDraft[] = attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        dataUrl: attachment.url,
        sizeBytes: attachment.sizeBytes,
      }));
      const updated = await sendConversationMessage(apiConversation.id, text, attachmentPayload);
      setApiConversation(updated);
      const nextMessages = messagesFromConversation(updated);
      setMessages(nextMessages.length > 0 ? nextMessages : [newMsg]);
      toast.success("Сообщение отправлено");
    } catch (caught) {
      setInputValue(text);
      setPendingAttachments(attachments);
      toast.error(caught instanceof Error ? caught.message : "Не удалось отправить сообщение");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleQuickReply(text: string) {
    pauseDemoReplayForInteraction();
    setInputValue(text);
  }

  function handleEmojiSelect(emoji: string) {
    pauseDemoReplayForInteraction();
    setInputValue((value) => `${value}${emoji}`);
    setEmojiOpen(false);
  }

  function handleExportTranscript() {
    const filename = `leadvirt-${sanitizeFilePart(lead.name)}-${sanitizeFilePart(conversationId)}.txt`;
    downloadTextFile(filename, buildTranscript(lead, messages, conversationId, conversationStatus));
    toast.success("Экспорт переписки готов");
  }

  async function handleDraftAiReply() {
    if (isDraftingAiReply) return;
    pauseDemoReplayForInteraction();

    if (!apiConversation) {
      toast.error("AI-подсказка доступна для API-диалога");
      return;
    }

    setIsDraftingAiReply(true);
    try {
      const draft = await draftAiReply(apiConversation.id);
      setInputValue(draft.reply);
      toast.success("AI-подсказка готова", {
        description: draft.handoffRequired ? "Проверьте текст: AI рекомендует менеджера." : "Можно отредактировать и отправить.",
      });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Не удалось подготовить AI-подсказку");
    } finally {
      setIsDraftingAiReply(false);
    }
  }

  function applyApiLead(updatedLead: ApiLead) {
    setApiConversation((current) => (current ? { ...current, lead: updatedLead } : current));
  }

  async function refreshConversation() {
    if (!apiConversation) return;
    const updated = await getConversation(apiConversation.id);
    setApiConversation(updated);
    const nextMessages = messagesFromConversation(updated);
    setMessages(nextMessages);
  }

  function applyConversationUpdate(updated: ConversationDetail) {
    setApiConversation(updated);
    const nextMessages = messagesFromConversation(updated);
    setMessages(nextMessages);
  }

  async function changeConversationStatus(status: ConversationStatus) {
    if (!apiConversation) return null;
    return updateConversationStatus(apiConversation.id, status);
  }

  async function handleConversationAction(action: ConversationAction) {
    if (pendingConversationAction) return;
    pauseDemoReplayForInteraction();

    if (!apiConversation) {
      toast.error("Действие доступно для API-диалога");
      return;
    }

    setPendingConversationAction(action);
    try {
      if (action === "handoff") {
        const updated = await handoffConversation(apiConversation.id);
        applyConversationUpdate(updated);
        toast.success("Диалог передан менеджеру");
      }

      if (action === "close") {
        const updated = await changeConversationStatus("CLOSED");
        if (updated) applyConversationUpdate(updated);
        toast.success("Диалог закрыт");
      }

      if (action === "open") {
        const updated = await changeConversationStatus("OPEN");
        if (updated) applyConversationUpdate(updated);
        toast.success("Диалог открыт");
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Действие с диалогом не выполнено");
    } finally {
      setPendingConversationAction(null);
    }
  }

  async function handleLeadAction(action: LeadAction) {
    pauseDemoReplayForInteraction();
    if (!apiLeadId) {
      toast.error("Действие доступно для API-лида");
      return;
    }

    setPendingLeadAction(action);
    try {
      if (action === "crm") {
        const updated = await sendLeadToCrm(apiLeadId);
        applyApiLead(updated);
        toast.success("Лид отправлен в CRM");
      }

      if (action === "task") {
        await createLeadTask(apiLeadId, "Связаться с лидом из диалога");
        toast.success("Задача создана");
      }

      if (action === "appointment") {
        await bookLeadAppointment(
          apiLeadId,
          lead.service || "Запись",
          new Date(Date.now() + 24 * 60 * 60_000).toISOString()
        );
        await refreshConversation();
        toast.success("Запись создана");
      }

      if (action === "qualified") {
        const updated = await updateLead(apiLeadId, { status: "QUALIFIED" });
        applyApiLead(updated);
        toast.success("Лид квалифицирован");
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Действие не выполнено");
    } finally {
      setPendingLeadAction(null);
    }
  }

  return (
    <ProductLayout title="Диалог">
      <BackButton to="inbox" label="Назад во входящие" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-10rem)] lg:h-[calc(100vh-9rem)]">
        {/* ── LEFT: Chat column ── */}
        <div className="flex flex-col min-h-0">
          <Card className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-3xl">
            {/* Chat header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                <Avatar name={lead.name} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-zinc-100 truncate">{lead.name}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <ChannelBadge id={lead.channel} withLabel />
                    <StatusPill stage={lead.stage} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 w-full sm:w-auto">
                {/* AI active indicator */}
                <div className="hidden sm:flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-medium text-emerald-300">{conversationModeLabel}</span>
                </div>

                {/* Mobile toggle for lead info */}
                <button
                  className="lg:hidden flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300"
                  onClick={() => setShowLeadInfo((v) => !v)}
                >
                  Информация о лиде
                  {showLeadInfo ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Chat options menu */}
                <Dropdown
                  trigger={
                    <button
                      aria-label="Действия с диалогом"
                      className="w-8 h-8 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-all"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  }
                >
                  <DropdownItem onClick={() => void handleConversationAction("handoff")}>
                    {pendingConversationAction === "handoff" ? "Передаём..." : "Передать менеджеру"}
                  </DropdownItem>
                  <DropdownItem onClick={() => void handleDraftAiReply()}>
                    {isDraftingAiReply ? "Готовим AI-подсказку..." : "AI-подсказка"}
                  </DropdownItem>
                  <DropdownItem onClick={handleExportTranscript}>
                    Экспорт переписки
                  </DropdownItem>
                  <DropdownSeparator />
                  {conversationStatus === "CLOSED" ? (
                    <DropdownItem onClick={() => void handleConversationAction("open")}>
                      {pendingConversationAction === "open" ? "Открываем..." : "Открыть диалог"}
                    </DropdownItem>
                  ) : (
                    <DropdownItem danger onClick={() => void handleConversationAction("close")}>
                      {pendingConversationAction === "close" ? "Закрываем..." : "Закрыть диалог"}
                    </DropdownItem>
                  )}
                </Dropdown>
              </div>
            </div>

            {hasDemoReplay && (
              <div className="flex flex-col gap-2 border-b border-emerald-500/10 bg-emerald-500/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2 text-xs text-emerald-200">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {demoReplayState === "playing" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /> : null}
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="truncate">
                    {demoReplayState === "playing" ? "Live demo: клиент и AI общаются сейчас" : "Live demo диалога готов к повтору"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {demoReplayState === "playing" ? (
                    <button
                      type="button"
                      onClick={() => revealDemoReplay("skipped")}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100"
                    >
                      Пропустить
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={restartDemoReplay}
                    className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-400/15"
                  >
                    Повторить demo
                  </button>
                </div>
              </div>
            )}

            {/* Mobile collapsible lead info */}
            <AnimatePresence>
              {showLeadInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="lg:hidden overflow-hidden border-b border-white/5"
                >
                  <div className="p-4 max-h-80 overflow-y-auto">
                    <LeadInfoPanel
                      lead={lead}
                      timelineItems={timelineItems}
                      pendingAction={pendingLeadAction}
                      onAction={(action) => void handleLeadAction(action)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages area */}
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-3">
                {isLoadingConversation && (
                  <div className="self-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
                    Загрузка диалога...
                  </div>
                )}
                {messages.map((msg, i) => (
                  <MessageBubble key={msg.id} msg={msg} index={i} customerInitial={customerInitial} />
                ))}
                <AnimatePresence>
                  {demoTypingFrom ? <TypingBubble from={demoTypingFrom} customerInitial={customerInitial} /> : null}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Quick replies */}
            <div className="px-5 py-2 border-t border-white/5 shrink-0">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {quickReplies.map((qr) => (
                  <button
                    key={qr}
                    onClick={() => handleQuickReply(qr)}
                    className="shrink-0 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-emerald-500/30 transition-colors px-3 py-1.5 text-xs font-medium text-zinc-300"
                  >
                    {qr}
                  </button>
                ))}
              </div>
            </div>

            {/* Input bar */}
            <div className="px-4 pb-4 pt-2 shrink-0">
              {pendingAttachments.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      data-testid="conversation-pending-attachment"
                      className="flex max-w-full items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{attachment.filename}</span>
                      <span className="shrink-0 text-emerald-300/70">{formatAttachmentSize(attachment.sizeBytes)}</span>
                      <button
                        type="button"
                        aria-label="Удалить файл"
                        onClick={() => setPendingAttachments([])}
                        className="ml-1 rounded-md px-1 text-emerald-200/70 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 focus-within:border-emerald-500/40 transition-colors">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept={acceptedAttachmentTypes.join(",")}
                  className="hidden"
                  data-testid="conversation-attachment-input"
                  onChange={(event) => void handleAttachmentSelected(event)}
                />
                <button
                  type="button"
                  aria-label="Прикрепить файл"
                  data-testid="conversation-attach-file"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="mb-1 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <Paperclip className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                </button>
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Написать сообщение..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none leading-relaxed max-h-28 overflow-y-auto py-1"
                />
                <div className="relative flex items-center gap-1.5 mb-1 shrink-0">
                  <button
                    type="button"
                    aria-label="Открыть эмодзи"
                    data-testid="conversation-emoji"
                    onClick={() => setEmojiOpen((open) => !open)}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <Smile className="w-[18px] h-[18px]" />
                  </button>
                  {emojiOpen && (
                    <div
                      data-testid="conversation-emoji-panel"
                      className="absolute bottom-10 right-0 z-50 grid w-36 grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl shadow-black/50"
                    >
                      {emojiOptions.map((emoji, index) => (
                        <button
                          key={emoji}
                          type="button"
                          data-testid={`conversation-emoji-option-${index}`}
                          aria-label={`Добавить ${emoji}`}
                          onClick={() => handleEmojiSelect(emoji)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-lg transition-colors hover:bg-white/10"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    aria-label="Отправить сообщение"
                    onClick={handleSend}
                    disabled={(!inputValue.trim() && pendingAttachments.length === 0) || isSending}
                    className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center transition-all",
                      (inputValue.trim() || pendingAttachments.length > 0) && !isSending
                        ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-[0_0_16px_rgba(52,211,153,0.4)]"
                        : "bg-white/5 text-zinc-600 cursor-not-allowed"
                    )}
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── RIGHT: Lead info (desktop) ── */}
        <div className="hidden lg:flex flex-col gap-4 overflow-y-auto pb-4">
          <LeadInfoPanel
            lead={lead}
            timelineItems={timelineItems}
            pendingAction={pendingLeadAction}
            onAction={(action) => void handleLeadAction(action)}
          />
        </div>
      </div>

      {/* Sticky mobile actions */}
      <div className="lg:hidden fixed bottom-16 inset-x-0 z-30 px-4 pb-2 pt-2 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          <Button size="sm" className="flex-1 justify-center gap-2" disabled={Boolean(pendingLeadAction)} onClick={() => void handleLeadAction("crm")}>
            {pendingLeadAction === "crm" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            В CRM
          </Button>
          <button disabled={Boolean(pendingLeadAction)} onClick={() => void handleLeadAction("appointment")} className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {pendingLeadAction === "appointment" ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" /> : <CalendarPlus className="w-4 h-4 text-zinc-400" />}
            Записать
          </button>
        </div>
      </div>
    </ProductLayout>
  );
}
