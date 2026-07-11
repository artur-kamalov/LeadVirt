import React, { useEffect, useMemo, useState } from "react";
import type { Workflow, WorkflowStatus, WorkflowStepType } from "@leadvirt/types";
import { ProductLayout } from "../ProductLayout";
import { Card } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { ConfirmDialog, Modal, Tip, Select as BrandSelect } from "../ui";
import { toast } from "sonner";
import { createWorkflow, listWorkflows, publishWorkflow, testWorkflow, updateWorkflow, type WorkflowStepPayload } from "@/lib/api/workflows";
import {
  MessageCircle,
  Bot,
  ListChecks,
  GitBranch,
  CalendarCheck,
  Repeat,
  Database,
  GripVertical,
  Plus,
  Trash2,
  Play,
  Save,
  Copy,
  Archive,
  RotateCcw,
  ToggleLeft,
  ToggleRight,
  X,
  Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockType = "trigger" | "ai" | "qualify" | "condition" | "booking" | "followup" | "crm";

type TriggerChannels = { telegram: boolean; whatsapp: boolean; instagram: boolean; web: boolean };
type ConditionRule = { field: string; op: string; value: string };

interface WorkflowBlockConfig {
  channels?: TriggerChannels;
  keywordFilter?: string;
  greetingText?: string;
  tone?: string;
  responseDelaySec?: string;
  questions?: string[];
  maxQuestions?: string;
  rules?: ConditionRule[];
  bookingSystem?: string;
  bookingConfirmationTemplate?: string;
  bookingRequiresConfirmation?: boolean;
  followupDelayHours?: string;
  followupMaxAttempts?: string;
  followupText?: string;
  crmSystem?: string;
  crmPipeline?: string;
  crmFields?: Record<string, boolean>;
  [key: string]: unknown;
}

interface WorkflowBlock {
  id: string;
  type: BlockType;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
  glowColor: string;
  enabled: boolean;
  config: WorkflowBlockConfig;
}

type ApiWorkflowStep = NonNullable<Workflow["steps"]>[number];

// ─── Data ─────────────────────────────────────────────────────────────────────

const SCENARIOS = ["Запись на услугу", "Оформление заказа", "Возврат клиента"];

function defaultConfigForType(type: BlockType): WorkflowBlockConfig {
  switch (type) {
    case "trigger":
      return {
        channels: { telegram: true, whatsapp: true, instagram: false, web: true },
        keywordFilter: "",
      };
    case "ai":
      return {
        greetingText: "Привет, {{имя}}! Я AI-ассистент. Чем могу помочь?",
        tone: "friendly",
        responseDelaySec: "1",
      };
    case "qualify":
      return {
        questions: ["Какая услуга вас интересует?", "Когда планируете начать?", "Каков ваш бюджет?"],
        maxQuestions: "3",
      };
    case "condition":
      return {
        rules: [
          { field: "бюджет", op: "gt", value: "5000" },
          { field: "интерес", op: "eq", value: "высокий" },
        ],
      };
    case "booking":
      return {
        bookingSystem: "google",
        bookingConfirmationTemplate: "Запись оформлена на {{дата}} в {{время}}. До встречи!",
        bookingRequiresConfirmation: true,
      };
    case "followup":
      return {
        followupDelayHours: "24",
        followupMaxAttempts: "2",
        followupText: "{{имя}}, вы ещё думаете? Готов ответить на вопросы!",
      };
    case "crm":
      return {
        crmSystem: "amocrm",
        crmPipeline: "Новые лиды",
        crmFields: { name: true, phone: true, source: true, budget: true, request: true },
      };
  }
}

function cloneConfig(config: WorkflowBlockConfig): WorkflowBlockConfig {
  return JSON.parse(JSON.stringify(config)) as WorkflowBlockConfig;
}

const INITIAL_BLOCKS: WorkflowBlock[] = [
  {
    id: "trigger",
    type: "trigger",
    title: "Триггер: Новое сообщение",
    subtitle: "Клиент пишет в любой канал",
    icon: MessageCircle,
    accent: "from-violet-500 to-indigo-500",
    glowColor: "rgba(139,92,246,0.35)",
    enabled: true,
    config: defaultConfigForType("trigger"),
  },
  {
    id: "greeting",
    type: "ai",
    title: "AI-приветствие",
    subtitle: "Персональное приветствие и сбор контекста",
    icon: Bot,
    accent: "from-emerald-500 to-teal-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
    config: defaultConfigForType("ai"),
  },
  {
    id: "qualify",
    type: "qualify",
    title: "Квалификация",
    subtitle: "AI задаёт уточняющие вопросы",
    icon: ListChecks,
    accent: "from-sky-500 to-blue-500",
    glowColor: "rgba(14,165,233,0.35)",
    enabled: true,
    config: defaultConfigForType("qualify"),
  },
  {
    id: "condition",
    type: "condition",
    title: "Условие",
    subtitle: "Целевой лид?",
    icon: GitBranch,
    accent: "from-amber-500 to-orange-500",
    glowColor: "rgba(245,158,11,0.35)",
    enabled: true,
    config: defaultConfigForType("condition"),
  },
  {
    id: "booking",
    type: "booking",
    title: "Запись / Заказ",
    subtitle: "Бронирование времени или оформление заказа",
    icon: CalendarCheck,
    accent: "from-emerald-500 to-green-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
    config: defaultConfigForType("booking"),
  },
  {
    id: "followup",
    type: "followup",
    title: "Повторное касание",
    subtitle: "Напоминание через 24ч если нет ответа",
    icon: Repeat,
    accent: "from-rose-500 to-pink-500",
    glowColor: "rgba(244,63,94,0.35)",
    enabled: true,
    config: defaultConfigForType("followup"),
  },
  {
    id: "crm",
    type: "crm",
    title: "Отправка в CRM",
    subtitle: "Структурированный лид уходит в amoCRM",
    icon: Database,
    accent: "from-teal-500 to-cyan-500",
    glowColor: "rgba(20,184,166,0.35)",
    enabled: true,
    config: defaultConfigForType("crm"),
  },
];

function freshInitialBlocks() {
  return INITIAL_BLOCKS.map((block) => ({
    ...block,
    config: cloneConfig(block.config),
  }));
}

const apiStepTypeToBlockType: Partial<Record<WorkflowStepType, BlockType>> = {
  TRIGGER: "trigger",
  AI_MESSAGE: "ai",
  QUESTION: "qualify",
  CONDITION: "condition",
  ACTION: "crm",
  DELAY: "followup",
  HANDOFF: "crm",
};

const blockTypeToApiStepType: Record<BlockType, WorkflowStepType> = {
  trigger: "TRIGGER",
  ai: "AI_MESSAGE",
  qualify: "QUESTION",
  condition: "CONDITION",
  booking: "ACTION",
  followup: "DELAY",
  crm: "ACTION",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockType(value: unknown): value is BlockType {
  return (
    value === "trigger" ||
    value === "ai" ||
    value === "qualify" ||
    value === "condition" ||
    value === "booking" ||
    value === "followup" ||
    value === "crm"
  );
}

function stepConfig(step: ApiWorkflowStep) {
  return isRecord(step.config) ? step.config : {};
}

function blockTypeFromStep(step: ApiWorkflowStep): BlockType | null {
  const configBlockType = stepConfig(step).blockType;
  if (isBlockType(configBlockType)) return configBlockType;
  return apiStepTypeToBlockType[step.type] ?? null;
}

function blockTemplateForType(type: BlockType) {
  return INITIAL_BLOCKS.find((block) => block.type === type) ?? INITIAL_BLOCKS[1];
}

function blocksFromWorkflow(workflow: Workflow): WorkflowBlock[] {
  const blocks = workflow.steps
    ?.map((step) => {
      const type = blockTypeFromStep(step);
      if (!type) return null;
      const template = blockTemplateForType(type);
      const config = stepConfig(step);
      return {
        ...template,
        id: step.id,
        type,
        title: step.name ? localizeStepName(step.name) : template.title,
        subtitle: typeof config.subtitle === "string"
          ? config.subtitle
          : typeof workflow.description === "string" && workflow.description.length > 0
            ? localizeWorkflowDescription(workflow.description) ?? workflow.description
            : template.subtitle,
        enabled: typeof config.enabled === "boolean" ? config.enabled : workflow.status !== "PAUSED" && workflow.status !== "ARCHIVED",
        config: {
          ...cloneConfig(defaultConfigForType(type)),
          ...config,
        },
      };
    })
    .filter((block): block is WorkflowBlock => block !== null);

  return blocks && blocks.length > 0 ? blocks : freshInitialBlocks();
}

function stepsFromBlocks(blocks: WorkflowBlock[], { includeIds = true }: { includeIds?: boolean } = {}): WorkflowStepPayload[] {
  return blocks.map((block, index) => ({
    ...(includeIds ? { id: block.id } : {}),
    type: blockTypeToApiStepType[block.type],
    name: block.title,
    positionX: 80 + index * 240,
    positionY: 120,
    config: {
      ...block.config,
      blockType: block.type,
      subtitle: block.subtitle,
      enabled: block.enabled,
    },
  }));
}

function workflowDraftSnapshot({
  name,
  active,
  blocks,
  includeIds,
}: {
  name: string;
  active: boolean;
  blocks: WorkflowBlock[];
  includeIds: boolean;
}) {
  return JSON.stringify({
    name,
    active,
    steps: stepsFromBlocks(blocks, { includeIds }),
  });
}

function statusFromActive(active: boolean): WorkflowStatus {
  return active ? "ACTIVE" : "PAUSED";
}

function workflowStatusMeta(workflow: Workflow | null, restored: boolean) {
  if (restored) {
    return {
      label: "Восстановлен",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    };
  }

  if (!workflow) {
    return {
      label: "Шаблон",
      className: "border-white/10 bg-white/5 text-zinc-400",
    };
  }

  if (workflow.status === "ACTIVE") {
    return {
      label: "Активен",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (workflow.status === "DRAFT") {
    return {
      label: "Черновик",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }

  if (workflow.status === "ARCHIVED") {
    return {
      label: "Архив",
      className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
    };
  }

  return {
    label: "Пауза",
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  };
}

function WorkflowStatusBadge({ workflow, restored = false, compact = false }: { workflow: Workflow | null; restored?: boolean; compact?: boolean }) {
  const meta = workflowStatusMeta(workflow, restored);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border font-semibold leading-none",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

function UnsavedChangesBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold leading-none text-amber-300">
      Несохранено
    </span>
  );
}

function localizeWorkflowName(name: string) {
  const labels: Record<string, string> = {
    "Lead qualification": "Квалификация лида",
    "Booking appointment": "Запись на услугу",
    "Order assistance": "Оформление заказа",
    "FAQ response": "Ответы на FAQ",
    "Follow-up": "Повторное касание",
    "Send to CRM": "Отправка в CRM",
    "New message": "Новое сообщение",
    "AI response": "AI-ответ",
  };
  return labels[name] ?? name;
}

function localizeWorkflowDescription(description: string | null | undefined) {
  const labels: Record<string, string> = {
    "Collect contact details, need, budget, and urgency.": "Собирает контакты, потребность, бюджет и срочность.",
    "Offer available slots and create a booking draft.": "Предлагает свободные окна и создает черновик записи.",
    "Help collect product, delivery, and payment details.": "Собирает детали товара, доставки и оплаты.",
    "Answer common questions with safe fallback rules.": "Отвечает на частые вопросы с безопасными правилами fallback.",
    "Recover silent leads with polite reminders.": "Возвращает молчащих лидов вежливыми напоминаниями.",
    "Package qualified leads and sync them to amoCRM.": "Передает квалифицированных лидов в amoCRM.",
  };
  return description ? labels[description] ?? description : null;
}

function localizeStepName(name: string) {
  const labels: Record<string, string> = {
    "New customer message": "Новое сообщение клиента",
    "Collect key details": "Сбор ключевых деталей",
    "Safe AI reply": "Безопасный AI-ответ",
    "Create event or handoff": "Событие или передача менеджеру",
    "End": "Завершение",
    "AI response": "AI-ответ",
    "New message": "Новое сообщение",
  };
  return labels[name] ?? name;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DarkInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all",
        className
      )}
    />
  );
}

function DarkTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all resize-none"
    />
  );
}

function DarkSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <BrandSelect
      value={value}
      onValueChange={onChange}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      className="h-10"
    />
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        "relative w-8 h-4.5 rounded-full transition-colors duration-200 flex-shrink-0",
        checked ? "bg-emerald-500" : "bg-white/10"
      )}
      style={{ height: "18px" }}
    >
      <span
        className={cn(
          "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all duration-200 shadow-sm",
          checked ? "left-[calc(100%-14px-2px)]" : "left-0.5"
        )}
      />
    </button>
  );
}

// Animated connector between blocks
function Connector({ index }: { index: number }) {
  return (
    <div className="flex flex-col items-center relative" style={{ height: 48 }}>
      {/* Static gradient line */}
      <div className="w-px flex-1 bg-gradient-to-b from-emerald-500/30 to-emerald-500/10 relative overflow-hidden">
        {/* Traveling pulse */}
        <motion.div
          className="absolute w-full"
          style={{
            height: 24,
            background: "linear-gradient(to bottom, transparent, #10b981, transparent)",
          }}
          animate={{ top: ["-24px", "calc(100% + 24px)"] }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "linear",
            delay: index * 0.28,
          }}
        />
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function stringSetting(config: WorkflowBlockConfig, key: keyof WorkflowBlockConfig, fallback: string) {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function booleanSetting(config: WorkflowBlockConfig, key: keyof WorkflowBlockConfig, fallback: boolean) {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringArraySetting(config: WorkflowBlockConfig, key: keyof WorkflowBlockConfig, fallback: string[]) {
  const value = config[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function triggerChannelsSetting(config: WorkflowBlockConfig) {
  const fallback = defaultConfigForType("trigger").channels ?? { telegram: true, whatsapp: true, instagram: false, web: true };
  return isRecord(config.channels)
    ? {
        telegram: typeof config.channels.telegram === "boolean" ? config.channels.telegram : fallback.telegram,
        whatsapp: typeof config.channels.whatsapp === "boolean" ? config.channels.whatsapp : fallback.whatsapp,
        instagram: typeof config.channels.instagram === "boolean" ? config.channels.instagram : fallback.instagram,
        web: typeof config.channels.web === "boolean" ? config.channels.web : fallback.web,
      }
    : fallback;
}

function conditionRulesSetting(config: WorkflowBlockConfig) {
  const fallback = defaultConfigForType("condition").rules ?? [];
  const value = config.rules;
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is ConditionRule => isRecord(item))
    .map((item) => ({
      field: typeof item.field === "string" ? item.field : "",
      op: typeof item.op === "string" ? item.op : "eq",
      value: typeof item.value === "string" ? item.value : "",
    }));
}

function crmFieldsSetting(config: WorkflowBlockConfig) {
  const fallback = defaultConfigForType("crm").crmFields ?? {};
  const value = config.crmFields;
  if (!isRecord(value)) return fallback;
  return {
    name: typeof value.name === "boolean" ? value.name : fallback.name,
    phone: typeof value.phone === "boolean" ? value.phone : fallback.phone,
    source: typeof value.source === "boolean" ? value.source : fallback.source,
    budget: typeof value.budget === "boolean" ? value.budget : fallback.budget,
    request: typeof value.request === "boolean" ? value.request : fallback.request,
  };
}

function GreetingSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const defaults = defaultConfigForType("ai");
  const text = stringSetting(config, "greetingText", String(defaults.greetingText));
  const tone = stringSetting(config, "tone", String(defaults.tone));
  const delay = stringSetting(config, "responseDelaySec", String(defaults.responseDelaySec));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Текст приветствия</label>
        <DarkTextarea value={text} onChange={(greetingText) => onChange({ greetingText })} rows={4} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Тон общения</label>
        <DarkSelect
          value={tone}
          onChange={(nextTone) => onChange({ tone: nextTone })}
          options={[
            { label: "Дружелюбный", value: "friendly" },
            { label: "Деловой", value: "business" },
            { label: "Нейтральный", value: "neutral" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Задержка ответа (сек)</label>
        <DarkInput value={delay} onChange={(responseDelaySec) => onChange({ responseDelaySec })} placeholder="1" />
      </div>
    </div>
  );
}

function QualifySettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const defaults = defaultConfigForType("qualify");
  const questions = stringArraySetting(config, "questions", defaults.questions as string[]);
  const maxQuestions = stringSetting(config, "maxQuestions", String(defaults.maxQuestions));
  const [newQ, setNewQ] = useState("");

  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">Вопросы для квалификации</label>
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span className="text-xs text-zinc-500 w-4 flex-shrink-0">{i + 1}.</span>
            <div className="flex-1 bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-zinc-200">
              {q}
            </div>
            <button
              onClick={() => onChange({ questions: questions.filter((_, j) => j !== i) })}
              className="text-zinc-600 hover:text-rose-400 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <DarkInput value={newQ} onChange={setNewQ} placeholder="Новый вопрос..." />
        <button
          onClick={() => {
            if (newQ.trim()) {
              onChange({ questions: [...questions, newQ.trim()] });
              setNewQ("");
            }
          }}
          className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-all flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Макс. вопросов подряд</label>
        <DarkInput value={maxQuestions} onChange={(nextMaxQuestions) => onChange({ maxQuestions: nextMaxQuestions })} />
      </div>
    </div>
  );
}

function ConditionSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const rules = conditionRulesSetting(config);

  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">Условия (все должны совпасть)</label>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <DarkInput value={r.field} onChange={(v) => onChange({ rules: rules.map((x, j) => j === i ? { ...x, field: v } : x) })} className="flex-1 min-w-0" />
            <DarkSelect
              value={r.op}
              onChange={(v) => onChange({ rules: rules.map((x, j) => j === i ? { ...x, op: v } : x) })}
              options={[
                { label: ">", value: "gt" },
                { label: "=", value: "eq" },
                { label: "<", value: "lt" },
                { label: "содержит", value: "contains" },
              ]}
            />
            <DarkInput value={r.value} onChange={(v) => onChange({ rules: rules.map((x, j) => j === i ? { ...x, value: v } : x) })} className="flex-1 min-w-0" />
            <button onClick={() => onChange({ rules: rules.filter((_, j) => j !== i) })} className="text-zinc-600 hover:text-rose-400 transition-colors flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange({ rules: [...rules, { field: "", op: "eq", value: "" }] })}
        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        <Plus className="w-3 h-3" /> Добавить условие
      </button>
    </div>
  );
}

function BookingSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const defaults = defaultConfigForType("booking");
  const calendar = stringSetting(config, "bookingSystem", String(defaults.bookingSystem));
  const confirmationTemplate = stringSetting(config, "bookingConfirmationTemplate", String(defaults.bookingConfirmationTemplate));
  const confirm = booleanSetting(config, "bookingRequiresConfirmation", Boolean(defaults.bookingRequiresConfirmation));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Система бронирования</label>
        <DarkSelect
          value={calendar}
          onChange={(bookingSystem) => onChange({ bookingSystem })}
          options={[
            { label: "Google Calendar", value: "google" },
            { label: "Yclients", value: "yclients" },
            { label: "Кастомная ссылка", value: "custom" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Шаблон подтверждения</label>
        <DarkTextarea value={confirmationTemplate} onChange={(bookingConfirmationTemplate) => onChange({ bookingConfirmationTemplate })} rows={3} />
      </div>
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-zinc-400">Запрос подтверждения</span>
        <MiniToggle checked={confirm} onChange={() => onChange({ bookingRequiresConfirmation: !confirm })} />
      </div>
    </div>
  );
}

function FollowupSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const defaults = defaultConfigForType("followup");
  const delay = stringSetting(config, "followupDelayHours", String(defaults.followupDelayHours));
  const maxAttempts = stringSetting(config, "followupMaxAttempts", String(defaults.followupMaxAttempts));
  const text = stringSetting(config, "followupText", String(defaults.followupText));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Задержка напоминания (часов)</label>
        <DarkInput value={delay} onChange={(followupDelayHours) => onChange({ followupDelayHours })} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Макс. попыток</label>
        <DarkInput value={maxAttempts} onChange={(followupMaxAttempts) => onChange({ followupMaxAttempts })} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Текст напоминания</label>
        <DarkTextarea value={text} onChange={(followupText) => onChange({ followupText })} rows={3} />
      </div>
    </div>
  );
}

function CrmSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const defaults = defaultConfigForType("crm");
  const system = stringSetting(config, "crmSystem", String(defaults.crmSystem));
  const pipeline = stringSetting(config, "crmPipeline", String(defaults.crmPipeline));
  const crmFields = crmFieldsSetting(config);
  const fieldRows = [
    { id: "name", label: "Имя" },
    { id: "phone", label: "Телефон" },
    { id: "source", label: "Источник" },
    { id: "budget", label: "Бюджет" },
    { id: "request", label: "Запрос" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">CRM-система</label>
        <DarkSelect
          value={system}
          onChange={(crmSystem) => onChange({ crmSystem })}
          options={[
            { label: "amoCRM", value: "amocrm" },
            { label: "Битрикс24", value: "bitrix" },
            { label: "HubSpot", value: "hubspot" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Воронка</label>
        <DarkInput value={pipeline} onChange={(crmPipeline) => onChange({ crmPipeline })} placeholder="Новые лиды" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Поля для передачи</label>
        {fieldRows.map((field) => (
          <div key={field.id} className="flex items-center justify-between py-0.5">
            <span className="text-xs text-zinc-300">{field.label}</span>
            <MiniToggle
              checked={Boolean(crmFields[field.id])}
              onChange={() => onChange({ crmFields: { ...crmFields, [field.id]: !crmFields[field.id] } })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TriggerSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const channels = triggerChannelsSetting(config);
  const keywordFilter = stringSetting(config, "keywordFilter", "");

  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">Активные каналы</label>
      {(Object.entries(channels) as [keyof typeof channels, boolean][]).map(([ch, val]) => (
        <div key={ch} className="flex items-center justify-between">
          <span className="text-sm text-zinc-200 capitalize">{ch === "web" ? "Web-чат" : ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
          <MiniToggle checked={val} onChange={() => onChange({ channels: { ...channels, [ch]: !channels[ch] } })} />
        </div>
      ))}
      <div className="space-y-1.5 mt-2">
        <label className="text-xs font-medium text-zinc-400">Фильтр по ключевым словам</label>
        <DarkInput value={keywordFilter} onChange={(nextKeywordFilter) => onChange({ keywordFilter: nextKeywordFilter })} placeholder="Оставьте пустым для всех сообщений" />
      </div>
    </div>
  );
}

function BlockSettings({
  block,
  onDelete,
  onConfigChange,
}: {
  block: WorkflowBlock;
  onDelete: () => void;
  onConfigChange: (patch: WorkflowBlockConfig) => void;
}) {
  const settingsMap: Record<BlockType, React.ReactNode> = {
    trigger: <TriggerSettings config={block.config} onChange={onConfigChange} />,
    ai: <GreetingSettings config={block.config} onChange={onConfigChange} />,
    qualify: <QualifySettings config={block.config} onChange={onConfigChange} />,
    condition: <ConditionSettings config={block.config} onChange={onConfigChange} />,
    booking: <BookingSettings config={block.config} onChange={onConfigChange} />,
    followup: <FollowupSettings config={block.config} onChange={onConfigChange} />,
    crm: <CrmSettings config={block.config} onChange={onConfigChange} />,
  };

  return (
    <div className="space-y-5">
      {settingsMap[block.type]}

      {/* Variables hint */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-white/3 border border-white/5">
        <Info className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-500 leading-relaxed">
          Используйте <span className="text-emerald-400 font-mono">{"{{переменная}}"}</span> для подстановки данных:{" "}
          <span className="text-zinc-400">имя, телефон, источник, бюджет, дата</span>
        </p>
      </div>

      {/* Delete */}
      {block.type !== "trigger" && (
        <button
          onClick={onDelete}
          className="flex items-center gap-2 text-xs text-rose-500 hover:text-rose-400 transition-colors group"
        >
          <Trash2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          Удалить блок
        </button>
      )}
    </div>
  );
}

// ─── Block Node Card ──────────────────────────────────────────────────────────

function BlockNode({
  block,
  selected,
  onClick,
  onToggle,
}: {
  block: WorkflowBlock;
  selected: boolean;
  onClick: () => void;
  onToggle: () => void;
}) {
  const Icon = block.icon;
  const isCondition = block.type === "condition";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div
        onClick={onClick}
        className={cn(
          "relative cursor-pointer rounded-2xl border p-4 transition-all duration-300 group",
          "bg-zinc-900/70",
          selected
            ? "border-emerald-500/50 shadow-[0_0_24px_rgba(16,185,129,0.18)]"
            : "border-white/5 hover:border-white/12"
        )}
      >
        {/* Selected glow */}
        {selected && (
          <motion.div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{ background: "radial-gradient(ellipse at center, rgba(16,185,129,0.06) 0%, transparent 70%)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          />
        )}

        <div className="flex items-center gap-3 relative z-10">
          {/* Drag handle */}
          <Tip content="Перетащить блок">
            <span className="cursor-grab active:cursor-grabbing">
              <GripVertical className="w-4 h-4 text-zinc-600 group-hover:text-zinc-500 flex-shrink-0 transition-colors" />
            </span>
          </Tip>

          {/* Icon */}
          <div
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
              `bg-gradient-to-br ${block.accent}`,
              "shadow-lg"
            )}
          >
            <Icon className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 leading-snug truncate">{block.title}</p>
            <p className="text-xs text-zinc-500 truncate mt-0.5">{block.subtitle}</p>
          </div>

          {/* Toggle */}
          <Tip content={block.enabled ? "Выключить блок" : "Включить блок"}>
            <div className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              <MiniToggle checked={block.enabled} onChange={onToggle} />
            </div>
          </Tip>
        </div>

        {/* Condition branches */}
        {isCondition && (
          <div className="flex gap-3 mt-3 pl-[52px] relative z-10">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">Да</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-xs text-rose-400 font-medium">Нет</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AutomationPage() {
  const [workflows, setWorkflows] = useState<Array<Workflow | null>>([]);
  const [blocks, setBlocks] = useState<WorkflowBlock[]>(() => freshInitialBlocks());
  const [selectedId, setSelectedId] = useState<string>("trigger");
  const [scenarioActive, setScenarioActive] = useState(true);
  const [activeScenario, setActiveScenario] = useState(0);
  const [scenarioName, setScenarioName] = useState(SCENARIOS[0]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "test" | "duplicate" | "archive" | null>(null);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archivedWorkflows, setArchivedWorkflows] = useState<Workflow[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [restoreWorkflowId, setRestoreWorkflowId] = useState<string | null>(null);
  const [restoredWorkflowIds, setRestoredWorkflowIds] = useState<Set<string>>(() => new Set());
  const [savedDraftSnapshot, setSavedDraftSnapshot] = useState(() =>
    workflowDraftSnapshot({
      name: SCENARIOS[0],
      active: true,
      blocks: freshInitialBlocks(),
      includeIds: false,
    })
  );

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? blocks[0];
  const activeWorkflow = workflows[activeScenario] ?? null;
  const activeWorkflowRestored = Boolean(activeWorkflow && restoredWorkflowIds.has(activeWorkflow.id));
  const scenarioTabs = Array.from(
    { length: Math.max(SCENARIOS.length, workflows.length) },
    (_, index) => {
      const workflow = workflows[index];
      return workflow ? localizeWorkflowName(workflow.name) : SCENARIOS[index] ?? `Сценарий ${index + 1}`;
    }
  );
  const currentDraftSnapshot = useMemo(
    () =>
      workflowDraftSnapshot({
        name: scenarioName,
        active: scenarioActive,
        blocks,
        includeIds: Boolean(activeWorkflow),
      }),
    [activeWorkflow, blocks, scenarioActive, scenarioName]
  );
  const hasUnsavedChanges = currentDraftSnapshot !== savedDraftSnapshot;

  function setWorkflowSlot(index: number, workflow: Workflow) {
    setWorkflows((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push(null);
      next[index] = workflow;
      return next;
    });
  }

  function clearWorkflowSlot(index: number) {
    setWorkflows((prev) => {
      const next = [...prev];
      if (index < next.length) {
        next[index] = null;
      }
      return next;
    });
  }

  function nextEmptyWorkflowSlot() {
    const index = workflows.findIndex((workflow) => workflow === null);
    return index === -1 ? Math.max(workflows.length, SCENARIOS.length) : index;
  }

  function hydrateWorkflow(workflow: Workflow, index: number) {
    const nextBlocks = blocksFromWorkflow(workflow);
    const nextName = localizeWorkflowName(workflow.name);
    const nextActive = workflow.status === "ACTIVE";
    setActiveScenario(index);
    setScenarioName(nextName);
    setScenarioActive(nextActive);
    setBlocks(nextBlocks);
    setSelectedId(nextBlocks[0]?.id ?? "trigger");
    setSavedDraftSnapshot(
      workflowDraftSnapshot({
        name: nextName,
        active: nextActive,
        blocks: nextBlocks,
        includeIds: true,
      })
    );
  }

  function hydrateDraftScenario(index: number, name: string) {
    const nextBlocks = freshInitialBlocks();
    setActiveScenario(index);
    setScenarioName(name);
    setScenarioActive(true);
    setBlocks(nextBlocks);
    setSelectedId(nextBlocks[0]?.id ?? "trigger");
    setSavedDraftSnapshot(
      workflowDraftSnapshot({
        name,
        active: true,
        blocks: nextBlocks,
        includeIds: false,
      })
    );
  }

  useEffect(() => {
    let cancelled = false;

    void listWorkflows()
      .then((items) => {
        if (cancelled) return;
        setWorkflows(items);
        if (items.length > 0) {
          hydrateWorkflow(items[0], 0);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setWorkflows([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleBlock = (id: string) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, enabled: !b.enabled } : b));
  };

  const updateBlockConfig = (id: string, patch: WorkflowBlockConfig) => {
    setBlocks((prev) =>
      prev.map((block) =>
        block.id === id
          ? {
              ...block,
              config: {
                ...block.config,
                ...patch,
              },
            }
          : block
      )
    );
  };

  const requestDeleteBlock = (id: string) => {
    setPendingDeleteId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteBlock = () => {
    if (!pendingDeleteId) return;
    setBlocks((prev) => prev.filter((b) => b.id !== pendingDeleteId));
    setSelectedId("trigger");
    setPendingDeleteId(null);
    toast.success("Блок удалён");
  };

  const addBlock = () => {
    const newBlock: WorkflowBlock = {
      id: `block-${Date.now()}`,
      type: "ai",
      title: "Новый блок",
      subtitle: "Настройте действие",
      icon: Bot,
      accent: "from-emerald-500 to-teal-500",
      glowColor: "rgba(16,185,129,0.35)",
      enabled: true,
      config: cloneConfig(defaultConfigForType("ai")),
    };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedId(newBlock.id);
    toast("Блок добавлен");
  };

  async function saveScenario() {
    setPendingAction("save");
    try {
      const status = statusFromActive(scenarioActive);
      const payload = {
        name: scenarioName.trim() || SCENARIOS[activeScenario] || "Новый сценарий",
        description: activeWorkflow?.description ?? "Сценарий создан в конструкторе Automation",
        status,
        steps: stepsFromBlocks(blocks, { includeIds: Boolean(activeWorkflow) }),
      };
      const savedWorkflow = activeWorkflow
        ? await updateWorkflow(activeWorkflow.id, payload)
        : await createWorkflow(payload);
      const finalWorkflow = scenarioActive ? await publishWorkflow(savedWorkflow.id) : savedWorkflow;
      setWorkflowSlot(activeScenario, finalWorkflow);
      hydrateWorkflow(finalWorkflow, activeScenario);
      toast.success(scenarioActive ? "Сценарий опубликован" : "Сценарий сохранён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить сценарий");
    } finally {
      setPendingAction(null);
    }
  }

  async function duplicateScenario() {
    setPendingAction("duplicate");
    try {
      const status = statusFromActive(scenarioActive);
      const copyName = `${scenarioName.trim() || SCENARIOS[activeScenario] || "Новый сценарий"} (копия)`;
      const created = await createWorkflow({
        name: copyName,
        description: "Копия сценария из конструктора Automation",
        status,
        steps: stepsFromBlocks(blocks, { includeIds: false }),
      });
      const finalWorkflow = scenarioActive ? await publishWorkflow(created.id) : created;
      const nextSlot = nextEmptyWorkflowSlot();
      setWorkflowSlot(nextSlot, finalWorkflow);
      hydrateWorkflow(finalWorkflow, nextSlot);
      toast.success("Сценарий продублирован");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось продублировать сценарий");
    } finally {
      setPendingAction(null);
    }
  }

  async function archiveScenario() {
    if (!activeWorkflow) {
      toast("Сначала сохраните сценарий");
      return;
    }

    setPendingAction("archive");
    try {
      await updateWorkflow(activeWorkflow.id, {
        name: scenarioName,
        description: activeWorkflow.description ?? "Сценарий из конструктора Automation",
        status: "ARCHIVED",
        steps: stepsFromBlocks(blocks),
      });
      clearWorkflowSlot(activeScenario);
      hydrateDraftScenario(activeScenario, SCENARIOS[activeScenario] ?? `Сценарий ${activeScenario + 1}`);
      toast.success("Сценарий архивирован");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось архивировать сценарий");
    } finally {
      setPendingAction(null);
    }
  }

  async function openArchiveModal() {
    setArchiveModalOpen(true);
    setArchiveLoading(true);
    try {
      const items = await listWorkflows({ includeArchived: true });
      setArchivedWorkflows(items.filter((workflow) => workflow.status === "ARCHIVED"));
    } catch (error) {
      setArchivedWorkflows([]);
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить архив");
    } finally {
      setArchiveLoading(false);
    }
  }

  async function restoreArchivedWorkflow(workflow: Workflow) {
    setRestoreWorkflowId(workflow.id);
    try {
      const restored = await updateWorkflow(workflow.id, {
        name: workflow.name,
        description: workflow.description ?? undefined,
        status: "PAUSED",
      });
      setArchivedWorkflows((prev) => prev.filter((item) => item.id !== workflow.id));
      setRestoredWorkflowIds((prev) => new Set(prev).add(restored.id));
      const slot = nextEmptyWorkflowSlot();
      setWorkflowSlot(slot, restored);
      hydrateWorkflow(restored, slot);
      setArchiveModalOpen(false);
      toast.success("Сценарий восстановлен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось восстановить сценарий");
    } finally {
      setRestoreWorkflowId(null);
    }
  }

  async function runScenarioTest() {
    if (!activeWorkflow) {
      toast("Запускаю тест...", { description: "AI пройдёт сценарий на тестовом диалоге" });
      return;
    }

    setPendingAction("test");
    try {
      const result = await testWorkflow(activeWorkflow.id);
      toast.success(result.message, { description: result.runId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить тест сценария");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <ProductLayout title="Автоматизация">
      <div className="h-full flex flex-col gap-0 min-h-0">
        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-3 mb-5 flex-shrink-0">
          {/* Scenario tabs */}
          <div className="flex gap-2 flex-wrap">
            {scenarioTabs.map((s, i) => {
              const workflow = workflows[i] ?? null;
              const restored = Boolean(workflow && restoredWorkflowIds.has(workflow.id));
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (workflow) {
                      hydrateWorkflow(workflow, i);
                      return;
                    }
                    hydrateDraftScenario(i, s);
                  }}
                  className={cn(
                    "flex max-w-full items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                    i === activeScenario
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : "bg-white/3 border-white/6 text-zinc-400 hover:text-zinc-200 hover:border-white/12"
                  )}
                >
                  <span className="truncate">{s}</span>
                  <WorkflowStatusBadge workflow={workflow} restored={restored} compact />
                </button>
              );
            })}
          </div>

          {/* Main toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              aria-label="Название сценария"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="flex-1 min-w-[180px] bg-transparent border-b border-white/10 pb-0.5 text-base font-bold text-zinc-100 tracking-tight outline-none focus:border-emerald-500/50 transition-colors placeholder-zinc-600"
            />
            <WorkflowStatusBadge workflow={activeWorkflow} restored={activeWorkflowRestored} />
            {hasUnsavedChanges && <UnsavedChangesBadge />}

            {/* Active toggle */}
            <Tip content={scenarioActive ? "Выключить сценарий" : "Включить сценарий"}>
              <button
                onClick={() => {
                  const next = !scenarioActive;
                  setScenarioActive(next);
                  toast(next ? "Сценарий включён" : "Сценарий выключен");
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-200",
                  scenarioActive
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                    : "bg-white/4 border-white/8 text-zinc-500"
                )}
              >
                {scenarioActive ? (
                  <ToggleRight className="w-4 h-4" />
                ) : (
                  <ToggleLeft className="w-4 h-4" />
                )}
                {scenarioActive ? "Активен" : "Выключен"}
              </button>
            </Tip>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={pendingAction !== null}
              onClick={() => void runScenarioTest()}
            >
              <Play className="w-3.5 h-3.5" />
              {pendingAction === "test" ? "Тест..." : "Тест"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={pendingAction !== null}
              onClick={() => void duplicateScenario()}
            >
              <Copy className="w-3.5 h-3.5" />
              {pendingAction === "duplicate" ? "Копируем..." : "Дублировать"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={pendingAction !== null || !activeWorkflow}
              onClick={() => void archiveScenario()}
            >
              <Archive className="w-3.5 h-3.5" />
              {pendingAction === "archive" ? "Архив..." : "Архив"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={pendingAction !== null}
              onClick={() => void openArchiveModal()}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Архивные
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              disabled={pendingAction !== null}
              onClick={() => void saveScenario()}
            >
              <Save className="w-3.5 h-3.5" />
              {pendingAction === "save" ? "Сохраняем..." : hasUnsavedChanges ? "Сохранить изменения" : "Сохранить"}
            </Button>
          </div>
        </div>

        {/* ── Main layout ── */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 overflow-hidden">
          {/* ── LEFT: Canvas ── */}
          <div className="overflow-y-auto pr-1 scrollbar-thin">
            <div className="max-w-lg mx-auto pb-8">
              <AnimatePresence mode="popLayout">
                {blocks.map((block, index) => (
                  <div key={block.id}>
                    <BlockNode
                      block={block}
                      selected={selectedId === block.id}
                      onClick={() => setSelectedId(block.id)}
                      onToggle={() => toggleBlock(block.id)}
                    />
                    {index < blocks.length - 1 && <Connector index={index} />}
                  </div>
                ))}
              </AnimatePresence>

              {/* Add block button */}
              <motion.div
                className="mt-4 flex justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <button
                  onClick={addBlock}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl border border-dashed border-white/12 text-sm text-zinc-500 hover:text-zinc-300 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all duration-200 group"
                >
                  <Plus className="w-4 h-4 group-hover:text-emerald-400 transition-colors" />
                  Добавить блок
                </button>
              </motion.div>
            </div>
          </div>

          {/* ── RIGHT: Settings panel ── */}
          <div className="overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Card className="rounded-2xl border border-white/5 bg-zinc-900/70 p-5">
                  {/* Panel header */}
                  <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/5">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
                        `bg-gradient-to-br ${selectedBlock.accent}`
                      )}
                    >
                      {React.createElement(selectedBlock.icon, { className: "w-4 h-4 text-white" })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{selectedBlock.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">Настройки блока</p>
                    </div>
                  </div>

                  <BlockSettings
                    block={selectedBlock}
                    onDelete={() => requestDeleteBlock(selectedBlock.id)}
                    onConfigChange={(patch) => updateBlockConfig(selectedBlock.id, patch)}
                  />
                </Card>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <Modal
        open={archiveModalOpen}
        onOpenChange={setArchiveModalOpen}
        title="Архивные сценарии"
        description="Восстановленные сценарии возвращаются в конструктор выключенными, чтобы их можно было проверить перед публикацией."
        className="max-w-2xl"
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {archiveLoading ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">
              Загружаем архив...
            </div>
          ) : archivedWorkflows.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">
              Архивных сценариев пока нет.
            </div>
          ) : (
            archivedWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{localizeWorkflowName(workflow.name)}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {workflow.steps?.length ?? 0} блоков · версия {workflow.version}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs sm:self-center"
                  disabled={restoreWorkflowId === workflow.id}
                  onClick={() => void restoreArchivedWorkflow(workflow)}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {restoreWorkflowId === workflow.id ? "Восстанавливаем..." : "Восстановить"}
                </Button>
              </div>
            ))
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Удалить блок?"
        description="Это действие нельзя отменить."
        danger
        confirmLabel="Удалить"
        onConfirm={confirmDeleteBlock}
      />
    </ProductLayout>
  );
}
