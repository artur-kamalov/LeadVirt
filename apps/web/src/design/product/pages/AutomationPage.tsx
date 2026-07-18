import React, { useEffect, useMemo, useState } from "react";
import type { Workflow, WorkflowStatus, WorkflowStepType } from "@leadvirt/types";
import { ProductLayout } from "../ProductLayout";
import { Card } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { ConfirmDialog, Modal, Skeleton, Tip, Select as BrandSelect } from "../ui";
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
  AlertTriangle,
  Square,
  UserRoundCheck,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { messages, type TranslationKey, type TranslationValues } from "@/i18n/messages";
import { supportedLocales } from "@/i18n/config";
import { useProductPermissions } from "../CurrentUser";
import { ResourceErrorState } from "../ResourceErrorState";

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockType =
  | "trigger"
  | "ai"
  | "qualify"
  | "condition"
  | "booking"
  | "followup"
  | "crm"
  | "handoff"
  | "end";

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
type Translate = (key: TranslationKey, values?: TranslationValues) => string;

// ─── Data ─────────────────────────────────────────────────────────────────────

function translated(t: Translate | undefined, key: TranslationKey, fallback: string) {
  return t ? t(key) : fallback;
}

function defaultConfigForType(type: BlockType, t?: Translate): WorkflowBlockConfig {
  switch (type) {
    case "trigger":
      return {
        channels: { telegram: true, whatsapp: false, instagram: false, web: true },
        keywordFilter: "",
      };
    case "ai":
      return {
        greetingText: translated(t, "suite.automation.greetingDefault", "Hi, {{name}}! I am an AI assistant. How can I help?"),
        tone: "friendly",
        responseDelaySec: "1",
      };
    case "qualify":
      return {
        questions: [
          translated(t, "suite.automation.questionService", "Which service are you interested in?"),
          translated(t, "suite.automation.questionTiming", "When are you planning to start?"),
          translated(t, "suite.automation.questionBudget", "What is your budget?"),
        ],
        maxQuestions: "3",
      };
    case "condition":
      return {
        rules: [
          { field: translated(t, "suite.automation.fieldBudget", "budget"), op: "gt", value: "5000" },
          { field: translated(t, "suite.automation.fieldInterest", "interest"), op: "eq", value: translated(t, "suite.automation.valueHigh", "high") },
        ],
      };
    case "booking":
      return {
        bookingSystem: "google",
        bookingConfirmationTemplate: translated(t, "suite.automation.bookingDefault", "Your appointment is booked for {{date}} at {{time}}. See you then!"),
        bookingRequiresConfirmation: true,
      };
    case "followup":
      return {
        followupDelayHours: "24",
        followupMaxAttempts: "2",
        followupText: translated(t, "suite.automation.followupDefault", "{{name}}, are you still deciding? I am ready to answer questions."),
      };
    case "crm":
      return {
        crmSystem: "amocrm",
        crmPipeline: translated(t, "suite.automation.pipelineDefault", "New leads"),
        crmFields: { name: true, phone: true, source: true, budget: true, request: true },
      };
    case "handoff":
    case "end":
      return {};
  }
}

function cloneConfig(config: WorkflowBlockConfig): WorkflowBlockConfig {
  return JSON.parse(JSON.stringify(config)) as WorkflowBlockConfig;
}

const INITIAL_BLOCK_DEFINITIONS: Array<Omit<WorkflowBlock, "title" | "subtitle" | "config"> & {
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
}> = [
  {
    id: "trigger",
    type: "trigger",
    titleKey: "suite.automation.blockTrigger",
    subtitleKey: "suite.automation.blockTriggerSub",
    icon: MessageCircle,
    accent: "from-violet-500 to-indigo-500",
    glowColor: "rgba(139,92,246,0.35)",
    enabled: true,
  },
  {
    id: "greeting",
    type: "ai",
    titleKey: "suite.automation.blockGreeting",
    subtitleKey: "suite.automation.blockGreetingSub",
    icon: Bot,
    accent: "from-emerald-500 to-teal-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
  },
  {
    id: "qualify",
    type: "qualify",
    titleKey: "suite.automation.blockQualify",
    subtitleKey: "suite.automation.blockQualifySub",
    icon: ListChecks,
    accent: "from-sky-500 to-blue-500",
    glowColor: "rgba(14,165,233,0.35)",
    enabled: true,
  },
  {
    id: "condition",
    type: "condition",
    titleKey: "suite.automation.blockCondition",
    subtitleKey: "suite.automation.blockConditionSub",
    icon: GitBranch,
    accent: "from-amber-500 to-orange-500",
    glowColor: "rgba(245,158,11,0.35)",
    enabled: true,
  },
  {
    id: "booking",
    type: "booking",
    titleKey: "suite.automation.blockBooking",
    subtitleKey: "suite.automation.blockBookingSub",
    icon: CalendarCheck,
    accent: "from-emerald-500 to-green-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
  },
  {
    id: "followup",
    type: "followup",
    titleKey: "suite.automation.blockFollowup",
    subtitleKey: "suite.automation.blockFollowupSub",
    icon: Repeat,
    accent: "from-rose-500 to-pink-500",
    glowColor: "rgba(244,63,94,0.35)",
    enabled: true,
  },
  {
    id: "crm",
    type: "crm",
    titleKey: "suite.automation.blockCrm",
    subtitleKey: "suite.automation.blockCrmSub",
    icon: Database,
    accent: "from-teal-500 to-cyan-500",
    glowColor: "rgba(20,184,166,0.35)",
    enabled: true,
  },
  {
    id: "handoff",
    type: "handoff",
    titleKey: "suite.automation.blockHandoff",
    subtitleKey: "suite.automation.blockHandoffSub",
    icon: UserRoundCheck,
    accent: "from-cyan-500 to-emerald-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
  },
  {
    id: "end",
    type: "end",
    titleKey: "suite.automation.blockEnd",
    subtitleKey: "suite.automation.blockEndSub",
    icon: Square,
    accent: "from-zinc-500 to-zinc-600",
    glowColor: "rgba(113,113,122,0.25)",
    enabled: true,
  },
];

const initialBlockTypes = new Set<BlockType>(["trigger", "handoff", "end"]);
const executableBlockTypes = new Set<BlockType>(["trigger", "condition", "handoff", "end"]);

function blockTemplates(t?: Translate) {
  return INITIAL_BLOCK_DEFINITIONS.map(({ titleKey, subtitleKey, ...block }) => ({
    ...block,
    title: translated(t, titleKey, titleKey),
    subtitle: translated(t, subtitleKey, subtitleKey),
    config: cloneConfig(defaultConfigForType(block.type, t)),
  }));
}

function freshInitialBlocks(t?: Translate) {
  return blockTemplates(t).filter((block) => initialBlockTypes.has(block.type));
}

function isSystemTranslation(value: string, key: TranslationKey) {
  return supportedLocales.some((locale) => messages[locale][key] === value);
}

function localizeBlockLabels(block: WorkflowBlock, t: Translate): WorkflowBlock {
  const definition = INITIAL_BLOCK_DEFINITIONS.find((item) => item.type === block.type);
  if (!definition) return block;

  const title = isSystemTranslation(block.title, definition.titleKey)
    ? t(definition.titleKey)
    : block.title;
  const subtitle = isSystemTranslation(block.subtitle, definition.subtitleKey)
    ? t(definition.subtitleKey)
    : block.subtitle;

  return title === block.title && subtitle === block.subtitle
    ? block
    : { ...block, title, subtitle };
}

function isExecutableBlock(block: Pick<WorkflowBlock, "type">) {
  return executableBlockTypes.has(block.type);
}

const apiStepTypeToBlockType: Partial<Record<WorkflowStepType, BlockType>> = {
  TRIGGER: "trigger",
  AI_MESSAGE: "ai",
  QUESTION: "qualify",
  CONDITION: "condition",
  ACTION: "crm",
  DELAY: "followup",
  HANDOFF: "handoff",
  END: "end",
};

const blockTypeToApiStepType: Record<BlockType, WorkflowStepType> = {
  trigger: "TRIGGER",
  ai: "AI_MESSAGE",
  qualify: "QUESTION",
  condition: "CONDITION",
  booking: "ACTION",
  followup: "DELAY",
  crm: "ACTION",
  handoff: "HANDOFF",
  end: "END",
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
    value === "crm" ||
    value === "handoff" ||
    value === "end"
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

function blockTemplateForType(type: BlockType, t?: Translate) {
  const blocks = blockTemplates(t);
  return blocks.find((block) => block.type === type) ?? blocks[0];
}

function blocksFromWorkflow(workflow: Workflow, t?: Translate): WorkflowBlock[] {
  const blocks = workflow.steps
    ?.map((step) => {
      const type = blockTypeFromStep(step);
      if (!type) return null;
      const template = blockTemplateForType(type, t);
      const config = stepConfig(step);
      return {
        ...template,
        id: step.id,
        type,
        title: step.name ? localizeStepName(step.name, t) : template.title,
        subtitle: typeof config.subtitle === "string"
          ? config.subtitle
          : typeof workflow.description === "string" && workflow.description.length > 0
            ? workflow.description
            : template.subtitle,
        enabled: typeof config.enabled === "boolean" ? config.enabled : workflow.status !== "PAUSED" && workflow.status !== "ARCHIVED",
        config: {
          ...cloneConfig(defaultConfigForType(type, t)),
          ...config,
        },
      };
    })
    .filter((block): block is WorkflowBlock => block !== null);

  return blocks && blocks.length > 0 ? blocks : freshInitialBlocks(t);
}

function workflowIsRuntimeBlocked(workflow: Workflow) {
  if (workflow.execution) return !workflow.execution.executable;
  const steps = workflow.steps ?? [];
  const hasUnsupportedStep = steps.some((step) => {
    const type = blockTypeFromStep(step);
    return !type || !executableBlockTypes.has(type);
  });
  const enabledTriggerCount = steps.filter(
    (step) => step.type === "TRIGGER" && stepConfig(step).enabled !== false,
  ).length;
  return hasUnsupportedStep || enabledTriggerCount !== 1;
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

function workflowStatusMeta(
  workflow: Workflow | null,
  restored: boolean,
  blocked: boolean,
  t: Translate,
) {
  if (restored) {
    return {
      label: t("suite.automation.statusRestored"),
      className: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    };
  }

  if (!workflow) {
    return {
      label: t("suite.automation.statusTemplate"),
      className: "border-white/10 bg-white/5 text-zinc-400",
    };
  }

  if (blocked && workflow.status === "ACTIVE") {
    return {
      label: t("suite.automation.statusBlocked"),
      className: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    };
  }

  if (workflow.status === "ACTIVE") {
    return {
      label: t("suite.automation.statusActive"),
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (workflow.status === "DRAFT") {
    return {
      label: t("suite.automation.statusDraft"),
      className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }

  if (workflow.status === "ARCHIVED") {
    return {
      label: t("suite.automation.statusArchive"),
      className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
    };
  }

  return {
    label: t("suite.automation.statusPaused"),
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  };
}

function WorkflowStatusBadge({
  workflow,
  restored = false,
  compact = false,
  blocked,
}: {
  workflow: Workflow | null;
  restored?: boolean;
  compact?: boolean;
  blocked?: boolean;
}) {
  const { t } = useI18n();
  const meta = workflowStatusMeta(
    workflow,
    restored,
    blocked ?? Boolean(workflow && workflowIsRuntimeBlocked(workflow)),
    t,
  );

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
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold leading-none text-amber-300">
      {t("suite.automation.unsaved")}
    </span>
  );
}

function localizeWorkflowName(name: string, t: Translate) {
  const labels: Record<string, TranslationKey> = {
    "Lead qualification": "suite.automation.blockQualify",
    "Booking appointment": "suite.automation.scenarioBooking",
    "Order assistance": "suite.automation.scenarioOrder",
    "Follow-up": "suite.automation.blockFollowup",
    "Send to CRM": "suite.automation.blockCrm",
    "New message": "suite.automation.blockTrigger",
    "AI response": "suite.automation.blockGreeting",
  };
  return labels[name] ? t(labels[name]) : name;
}

function localizeStepName(name: string, t?: Translate) {
  if (!t) return name;
  const labels: Record<string, TranslationKey> = {
    "Collect key details": "suite.automation.blockQualify",
    "AI response": "suite.automation.blockGreeting",
    "New message": "suite.automation.blockTrigger",
  };
  return labels[name] ? t(labels[name]) : name;
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
        "min-h-11 w-full rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none transition-all placeholder-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30",
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
      className="w-full resize-none rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none transition-all placeholder-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
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
      className="h-11"
    />
  );
}

function MiniToggle({
  checked,
  label,
  onChange,
  stopPropagation = false,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
  stopPropagation?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
        onChange();
      }}
      className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-emerald-400/60"
    >
      <span className={cn("relative h-[18px] w-8 rounded-full transition-colors duration-200", checked ? "bg-emerald-500" : "bg-white/10")}>
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all duration-200",
            checked ? "left-[calc(100%-14px-2px)]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

// Animated connector between blocks
function Connector() {
  return (
    <div className="flex flex-col items-center relative" style={{ height: 48 }}>
      <div className="relative w-px flex-1 bg-gradient-to-b from-emerald-500/30 to-emerald-500/10" />
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

function conditionRulesSetting(config: WorkflowBlockConfig, t?: Translate) {
  const fallback = defaultConfigForType("condition", t).rules ?? [];
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
  const { t } = useI18n();
  const defaults = defaultConfigForType("ai", t);
  const text = stringSetting(config, "greetingText", String(defaults.greetingText));
  const tone = stringSetting(config, "tone", String(defaults.tone));
  const delay = stringSetting(config, "responseDelaySec", String(defaults.responseDelaySec));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.greetingText")}</label>
        <DarkTextarea value={text} onChange={(greetingText) => onChange({ greetingText })} rows={4} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.tone")}</label>
        <DarkSelect
          value={tone}
          onChange={(nextTone) => onChange({ tone: nextTone })}
          options={[
            { label: t("suite.automation.toneFriendly"), value: "friendly" },
            { label: t("suite.automation.toneBusiness"), value: "business" },
            { label: t("suite.automation.toneNeutral"), value: "neutral" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.responseDelay")}</label>
        <DarkInput value={delay} onChange={(responseDelaySec) => onChange({ responseDelaySec })} placeholder="1" />
      </div>
    </div>
  );
}

function QualifySettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const { t } = useI18n();
  const defaults = defaultConfigForType("qualify", t);
  const questions = stringArraySetting(config, "questions", defaults.questions ?? []);
  const maxQuestions = stringSetting(config, "maxQuestions", String(defaults.maxQuestions));
  const [newQ, setNewQ] = useState("");

  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">{t("suite.automation.qualificationQuestions")}</label>
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
        <DarkInput value={newQ} onChange={setNewQ} placeholder={t("suite.automation.newQuestion")} />
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
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.maxQuestions")}</label>
        <DarkInput value={maxQuestions} onChange={(nextMaxQuestions) => onChange({ maxQuestions: nextMaxQuestions })} />
      </div>
    </div>
  );
}

function ConditionSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const { t } = useI18n();
  const rules = conditionRulesSetting(config, t);

  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">{t("suite.automation.conditions")}</label>
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
                { label: t("suite.automation.contains"), value: "contains" },
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
        <Plus className="w-3 h-3" /> {t("suite.automation.addCondition")}
      </button>
    </div>
  );
}

function BookingSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const { t } = useI18n();
  const defaults = defaultConfigForType("booking", t);
  const calendar = stringSetting(config, "bookingSystem", String(defaults.bookingSystem));
  const confirmationTemplate = stringSetting(config, "bookingConfirmationTemplate", String(defaults.bookingConfirmationTemplate));
  const confirm = booleanSetting(config, "bookingRequiresConfirmation", Boolean(defaults.bookingRequiresConfirmation));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.bookingSystem")}</label>
        <DarkSelect
          value={calendar}
          onChange={(bookingSystem) => onChange({ bookingSystem })}
          options={[
            { label: "Google Calendar", value: "google" },
            { label: "Yclients", value: "yclients" },
            { label: t("suite.automation.customLink"), value: "custom" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.confirmationTemplate")}</label>
        <DarkTextarea value={confirmationTemplate} onChange={(bookingConfirmationTemplate) => onChange({ bookingConfirmationTemplate })} rows={3} />
      </div>
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-zinc-400">{t("suite.automation.requestConfirmation")}</span>
        <MiniToggle
          checked={confirm}
          label={t("suite.automation.requestConfirmation")}
          onChange={() => onChange({ bookingRequiresConfirmation: !confirm })}
        />
      </div>
    </div>
  );
}

function FollowupSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const { t } = useI18n();
  const defaults = defaultConfigForType("followup", t);
  const delay = stringSetting(config, "followupDelayHours", String(defaults.followupDelayHours));
  const maxAttempts = stringSetting(config, "followupMaxAttempts", String(defaults.followupMaxAttempts));
  const text = stringSetting(config, "followupText", String(defaults.followupText));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.followupDelay")}</label>
        <DarkInput value={delay} onChange={(followupDelayHours) => onChange({ followupDelayHours })} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.maxAttempts")}</label>
        <DarkInput value={maxAttempts} onChange={(followupMaxAttempts) => onChange({ followupMaxAttempts })} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.followupText")}</label>
        <DarkTextarea value={text} onChange={(followupText) => onChange({ followupText })} rows={3} />
      </div>
    </div>
  );
}

function CrmSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const { t } = useI18n();
  const defaults = defaultConfigForType("crm", t);
  const system = stringSetting(config, "crmSystem", String(defaults.crmSystem));
  const pipeline = stringSetting(config, "crmPipeline", String(defaults.crmPipeline));
  const crmFields = crmFieldsSetting(config);
  const fieldRows = [
    { id: "name", label: t("suite.automation.name") },
    { id: "phone", label: t("suite.automation.phone") },
    { id: "source", label: t("suite.automation.source") },
    { id: "budget", label: t("suite.automation.budget") },
    { id: "request", label: t("suite.automation.request") },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.crmSystem")}</label>
        <DarkSelect
          value={system}
          onChange={(crmSystem) => onChange({ crmSystem })}
          options={[
            { label: "amoCRM", value: "amocrm" },
            { label: t("suite.automation.bitrix"), value: "bitrix" },
            { label: "HubSpot", value: "hubspot" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.pipeline")}</label>
        <DarkInput value={pipeline} onChange={(crmPipeline) => onChange({ crmPipeline })} placeholder={t("suite.automation.pipelineDefault")} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.fields")}</label>
        {fieldRows.map((field) => (
          <div key={field.id} className="flex items-center justify-between py-0.5">
            <span className="text-xs text-zinc-300">{field.label}</span>
            <MiniToggle
              checked={Boolean(crmFields[field.id])}
              label={field.label}
              onChange={() => onChange({ crmFields: { ...crmFields, [field.id]: !crmFields[field.id] } })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TriggerSettings({ config, onChange }: { config: WorkflowBlockConfig; onChange: (patch: WorkflowBlockConfig) => void }) {
  const { t } = useI18n();
  const channels = triggerChannelsSetting(config);
  const keywordFilter = stringSetting(config, "keywordFilter", "");

  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">{t("suite.automation.activeChannels")}</label>
      {(["telegram", "web"] as const).map((ch) => (
        <div key={ch} className="flex items-center justify-between">
          <span className="text-sm text-zinc-200 capitalize">{ch === "web" ? t("suite.automation.webChat") : ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
          <MiniToggle
            checked={channels[ch]}
            label={ch === "web" ? t("suite.automation.webChat") : "Telegram"}
            onChange={() => onChange({ channels: { ...channels, [ch]: !channels[ch] } })}
          />
        </div>
      ))}
      <div className="space-y-1.5 mt-2">
        <label className="text-xs font-medium text-zinc-400">{t("suite.automation.keywordFilter")}</label>
        <DarkInput value={keywordFilter} onChange={(nextKeywordFilter) => onChange({ keywordFilter: nextKeywordFilter })} placeholder={t("suite.automation.keywordPlaceholder")} />
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
  const { t } = useI18n();
  const settingsMap: Record<BlockType, React.ReactNode> = {
    trigger: <TriggerSettings config={block.config} onChange={onConfigChange} />,
    ai: <GreetingSettings config={block.config} onChange={onConfigChange} />,
    qualify: <QualifySettings config={block.config} onChange={onConfigChange} />,
    condition: <ConditionSettings config={block.config} onChange={onConfigChange} />,
    booking: <BookingSettings config={block.config} onChange={onConfigChange} />,
    followup: <FollowupSettings config={block.config} onChange={onConfigChange} />,
    crm: <CrmSettings config={block.config} onChange={onConfigChange} />,
    handoff: (
      <p className="text-xs leading-relaxed text-emerald-300">
        {t("suite.automation.runtimeReady")}
      </p>
    ),
    end: (
      <p className="text-xs leading-relaxed text-emerald-300">
        {t("suite.automation.runtimeReady")}
      </p>
    ),
  };

  return (
    <div className="space-y-5">
      {!isExecutableBlock(block) && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-200">
            {t("suite.automation.draftOnlyDescription")}
          </p>
        </div>
      )}
      {isExecutableBlock(block) ? settingsMap[block.type] : null}

      {/* Delete */}
      {block.type !== "trigger" && (
        <button
          type="button"
          onClick={onDelete}
          className="group flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs text-rose-500 transition-colors hover:bg-rose-500/5 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
        >
          <Trash2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          {t("suite.automation.deleteBlock")}
        </button>
      )}
    </div>
  );
}

// ─── Block Node Card ──────────────────────────────────────────────────────────

function BlockNode({
  block,
  index,
  selected,
  onClick,
  onToggle,
  editable,
}: {
  block: WorkflowBlock;
  index: number;
  selected: boolean;
  onClick: () => void;
  onToggle: () => void;
  editable: boolean;
}) {
  const { t } = useI18n();
  const Icon = block.icon;
  const isCondition = block.type === "condition";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div
        data-testid={`automation-block-${block.type}`}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        role="group"
        aria-label={block.title}
        tabIndex={0}
        aria-current={selected ? "step" : undefined}
        className={cn(
          "group relative cursor-pointer rounded-2xl border p-4 outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-emerald-400/60",
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
          <span
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-white/8 bg-white/4 text-xs font-semibold text-zinc-500"
          >
            {index + 1}
          </span>

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
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate text-sm font-semibold leading-snug text-zinc-100">
                {block.title}
              </p>
              {!isExecutableBlock(block) && (
                <span className="shrink-0 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                  {t("suite.automation.draftOnly")}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 truncate mt-0.5">{block.subtitle}</p>
          </div>

          {/* Toggle */}
          {editable ? (
            <Tip content={block.enabled ? t("suite.automation.disableBlock") : t("suite.automation.enableBlock")}>
              <MiniToggle
                checked={block.enabled}
                label={block.enabled ? t("suite.automation.disableBlock") : t("suite.automation.enableBlock")}
                onChange={onToggle}
                stopPropagation
              />
            </Tip>
          ) : null}
        </div>

        {/* Condition branches */}
        {isCondition && (
          <div className="flex gap-3 mt-3 pl-[52px] relative z-10">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">{t("suite.automation.yes")}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-xs text-rose-400 font-medium">{t("suite.automation.no")}</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AutomationPage() {
  const { formatNumber, t } = useI18n();
  const permissions = useProductPermissions();
  const scenarioDefaults = Array.from({ length: 3 }, (_, index) =>
    t("suite.automation.scenarioNumber", { count: formatNumber(index + 1) }),
  );
  const [workflows, setWorkflows] = useState<Array<Workflow | null>>([]);
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const [workflowLoadStatus, setWorkflowLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [workflowReloadRevision, setWorkflowReloadRevision] = useState(0);
  const [blocks, setBlocks] = useState<WorkflowBlock[]>(() => freshInitialBlocks(t));
  const [selectedId, setSelectedId] = useState<string>("trigger");
  const [scenarioActive, setScenarioActive] = useState(false);
  const [activeScenario, setActiveScenario] = useState(0);
  const [scenarioName, setScenarioName] = useState(scenarioDefaults[0]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "test" | "duplicate" | "archive" | null>(null);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archivedWorkflows, setArchivedWorkflows] = useState<Workflow[]>([]);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [archiveLoadStatus, setArchiveLoadStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [restoreWorkflowId, setRestoreWorkflowId] = useState<string | null>(null);
  const [restoredWorkflowIds, setRestoredWorkflowIds] = useState<Set<string>>(() => new Set());
  const [savedDraftSnapshot, setSavedDraftSnapshot] = useState(() =>
    workflowDraftSnapshot({
      name: scenarioDefaults[0],
      active: false,
      blocks: freshInitialBlocks(t),
      includeIds: false,
    })
  );

  const localizedBlocks = useMemo(
    () => blocks.map((block) => localizeBlockLabels(block, t)),
    [blocks, t],
  );
  const selectedBlock = localizedBlocks.find((b) => b.id === selectedId) ?? localizedBlocks[0];
  const activeWorkflow = workflows[activeScenario] ?? null;
  const activeWorkflowRestored = Boolean(activeWorkflow && restoredWorkflowIds.has(activeWorkflow.id));
  const scenarioTabs = Array.from(
    { length: Math.max(scenarioDefaults.length, workflows.length) },
    (_, index) => {
      const workflow = workflows[index];
      return workflow
        ? localizeWorkflowName(workflow.name, t)
        : scenarioDefaults[index] ?? t("suite.automation.scenarioNumber", { count: formatNumber(index + 1) });
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
  const unsupportedBlocks = localizedBlocks.filter((block) => !isExecutableBlock(block));
  const enabledTriggerCount = blocks.filter(
    (block) => block.type === "trigger" && block.enabled,
  ).length;
  const enabledEndIndex = blocks.findIndex((block) => block.type === "end" && block.enabled);
  const hasUnreachableBlock =
    enabledEndIndex >= 0 && blocks.slice(enabledEndIndex + 1).some((block) => block.enabled);
  const runtimeBlocked =
    unsupportedBlocks.length > 0 || enabledTriggerCount !== 1 || hasUnreachableBlock;
  const testRequiresConversation = blocks.some(
    (block) => block.type === "handoff" && block.enabled,
  );
  const canAddCondition = !blocks.some((block) => block.type === "condition");
  const canAddHandoff = !blocks.some((block) => block.type === "handoff");

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
    return index === -1 ? Math.max(workflows.length, scenarioDefaults.length) : index;
  }

  function hydrateWorkflow(workflow: Workflow, index: number) {
    const nextBlocks = blocksFromWorkflow(workflow, t);
    const nextName = localizeWorkflowName(workflow.name, t);
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
    const nextBlocks = freshInitialBlocks(t);
    setActiveScenario(index);
    setScenarioName(name);
    setScenarioActive(false);
    setBlocks(nextBlocks);
    setSelectedId(nextBlocks[0]?.id ?? "trigger");
    setSavedDraftSnapshot(
      workflowDraftSnapshot({
        name,
        active: false,
        blocks: nextBlocks,
        includeIds: false,
      })
    );
  }

  useEffect(() => {
    let cancelled = false;

    setWorkflowLoadStatus("loading");
    void listWorkflows()
      .then((items) => {
        if (cancelled) return;
        setWorkflows(items);
        setWorkflowsLoaded(true);
        setWorkflowLoadStatus("success");
        if (items.length > 0) {
          hydrateWorkflow(items[0], 0);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setWorkflowLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [workflowReloadRevision]);

  const toggleBlock = (id: string) => {
    if (!permissions.canManageWorkflows) return;
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, enabled: !b.enabled } : b));
  };

  const updateBlockConfig = (id: string, patch: WorkflowBlockConfig) => {
    if (!permissions.canManageWorkflows) return;
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
    if (!permissions.canManageWorkflows) return;
    setPendingDeleteId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteBlock = () => {
    if (!permissions.canManageWorkflows) return;
    if (!pendingDeleteId) return;
    setBlocks((prev) => prev.filter((b) => b.id !== pendingDeleteId));
    setSelectedId("trigger");
    setPendingDeleteId(null);
    toast.success(t("suite.automation.blockDeleted"));
  };

  const addBlock = (type: "condition" | "handoff") => {
    if (!permissions.canManageWorkflows) return;
    const template = blockTemplateForType(type, t);
    const newBlock: WorkflowBlock = {
      ...template,
      id: `block-${Date.now()}`,
      config: cloneConfig(defaultConfigForType(type, t)),
    };
    setBlocks((prev) => {
      const endIndex = prev.findIndex((block) => block.type === "end");
      if (endIndex === -1) return [...prev, newBlock];
      return [...prev.slice(0, endIndex), newBlock, ...prev.slice(endIndex)];
    });
    setSelectedId(newBlock.id);
    toast(t("suite.automation.blockAdded"));
  };

  async function saveScenario() {
    if (!permissions.canManageWorkflows) return;
    if (scenarioActive && runtimeBlocked) {
      toast.error(t("suite.automation.runtimeBlocked"));
      return;
    }
    setPendingAction("save");
    try {
      const status = statusFromActive(scenarioActive);
      const payload = {
        name: scenarioName.trim() || scenarioDefaults[activeScenario] || t("suite.automation.newScenario"),
        description: activeWorkflow?.description ?? t("suite.automation.createdDescription"),
        status,
        steps: stepsFromBlocks(blocks, { includeIds: Boolean(activeWorkflow) }),
      };
      const savedWorkflow = activeWorkflow
        ? await updateWorkflow(activeWorkflow.id, payload)
        : await createWorkflow(payload);
      const finalWorkflow = scenarioActive ? await publishWorkflow(savedWorkflow.id) : savedWorkflow;
      setWorkflowSlot(activeScenario, finalWorkflow);
      hydrateWorkflow(finalWorkflow, activeScenario);
      toast.success(scenarioActive ? t("suite.automation.published") : t("suite.automation.saved"));
    } catch {
      toast.error(t("suite.automation.saveFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function duplicateScenario() {
    if (!permissions.canManageWorkflows) return;
    setPendingAction("duplicate");
    try {
      const copyName = `${scenarioName.trim() || scenarioDefaults[activeScenario] || t("suite.automation.newScenario")} (${t("suite.automation.copySuffix")})`;
      const created = await createWorkflow({
        name: copyName,
        description: t("suite.automation.copyDescription"),
        status: "PAUSED",
        steps: stepsFromBlocks(blocks, { includeIds: false }),
      });
      const nextSlot = nextEmptyWorkflowSlot();
      setWorkflowSlot(nextSlot, created);
      hydrateWorkflow(created, nextSlot);
      toast.success(t("suite.automation.duplicated"));
    } catch {
      toast.error(t("suite.automation.duplicateFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function archiveScenario() {
    if (!permissions.canManageWorkflows) return;
    if (!activeWorkflow) {
      toast(t("suite.automation.saveFirst"));
      return;
    }

    setPendingAction("archive");
    try {
      await updateWorkflow(activeWorkflow.id, {
        name: scenarioName,
        description: activeWorkflow.description ?? t("suite.automation.builderDescription"),
        status: "ARCHIVED",
        steps: stepsFromBlocks(blocks),
      });
      clearWorkflowSlot(activeScenario);
      hydrateDraftScenario(activeScenario, scenarioDefaults[activeScenario] ?? t("suite.automation.scenarioNumber", { count: formatNumber(activeScenario + 1) }));
      toast.success(t("suite.automation.archived"));
    } catch {
      toast.error(t("suite.automation.archiveFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function loadArchivedWorkflows() {
    setArchiveLoadStatus("loading");
    try {
      const items = await listWorkflows({ includeArchived: true });
      setArchivedWorkflows(items.filter((workflow) => workflow.status === "ARCHIVED"));
      setArchiveLoaded(true);
      setArchiveLoadStatus("success");
    } catch {
      setArchiveLoadStatus("error");
      toast.error(t("suite.automation.archiveLoadFailed"));
    }
  }

  function openArchiveModal() {
    setArchiveModalOpen(true);
    void loadArchivedWorkflows();
  }

  async function restoreArchivedWorkflow(workflow: Workflow) {
    if (!permissions.canManageWorkflows) return;
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
      toast.success(t("suite.automation.restored"));
    } catch {
      toast.error(t("suite.automation.restoreFailed"));
    } finally {
      setRestoreWorkflowId(null);
    }
  }

  async function runScenarioTest() {
    if (!permissions.canManageWorkflows) return;
    if (runtimeBlocked) {
      toast.error(t("suite.automation.runtimeBlocked"));
      return;
    }
    if (testRequiresConversation) {
      toast.error(t("suite.automation.testNeedsConversation"));
      return;
    }
    if (!activeWorkflow) {
      toast(t("suite.automation.saveFirst"));
      return;
    }

    setPendingAction("test");
    try {
      const result = await testWorkflow(activeWorkflow.id);
      if (result.status === "COMPLETED") {
        toast.success(t("suite.automation.testCompleted"));
      } else {
        toast.error(t("suite.automation.testFailed"));
      }
    } catch {
      toast.error(t("suite.automation.testFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  if (!workflowsLoaded) {
    return (
      <ProductLayout title={t("suite.automation.title")}>
        {workflowLoadStatus === "loading" ? (
          <div className="space-y-5" data-testid="automation-loading">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-40" />
              ))}
            </div>
            <Skeleton className="h-12" />
            <div className="grid min-h-[32rem] grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
              <Skeleton className="h-full" />
              <Skeleton className="h-full" />
            </div>
          </div>
        ) : (
          <ResourceErrorState
            testId="automation-load-error"
            onRetry={() => setWorkflowReloadRevision((current) => current + 1)}
          />
        )}
      </ProductLayout>
    );
  }

  return (
    <ProductLayout title={t("suite.automation.title")}>
      <div
        className="h-full flex flex-col gap-0 min-h-0"
        data-testid={permissions.canManageWorkflows ? "automation-editor" : "automation-read-only"}
      >
        {workflowLoadStatus === "error" ? (
          <ResourceErrorState
            testId="automation-refresh-error"
            onRetry={() => setWorkflowReloadRevision((current) => current + 1)}
          />
        ) : null}
        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-3 mb-5 flex-shrink-0">
          {/* Scenario tabs */}
          <div
            className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 scrollbar-none overscroll-x-contain"
            aria-label={t("suite.automation.title")}
          >
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
                    "flex min-h-11 max-w-full shrink-0 snap-start items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-400/60",
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
              aria-label={t("suite.automation.nameLabel")}
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              readOnly={!permissions.canManageWorkflows}
              className="flex-1 min-w-[180px] bg-transparent border-b border-white/10 pb-0.5 text-base font-bold text-zinc-100 tracking-tight outline-none focus:border-emerald-500/50 transition-colors placeholder-zinc-600"
            />
            <WorkflowStatusBadge
              workflow={activeWorkflow}
              restored={activeWorkflowRestored}
              blocked={runtimeBlocked}
            />
            {permissions.canManageWorkflows && hasUnsavedChanges ? <UnsavedChangesBadge /> : null}

            {/* Active toggle */}
            {permissions.canManageWorkflows ? <Tip
              content={
                !scenarioActive && runtimeBlocked
                  ? t("suite.automation.runtimeBlocked")
                  : scenarioActive
                    ? t("suite.automation.disableScenario")
                    : t("suite.automation.enableScenario")
              }
            >
              <button
                type="button"
                aria-pressed={scenarioActive}
                aria-label={scenarioActive ? t("suite.automation.disableScenario") : t("suite.automation.enableScenario")}
                onClick={() => {
                  if (!scenarioActive && runtimeBlocked) {
                    toast.error(t("suite.automation.runtimeBlocked"));
                    return;
                  }
                  const next = !scenarioActive;
                  setScenarioActive(next);
                }}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                  scenarioActive && runtimeBlocked
                    ? "bg-rose-500/10 border-rose-500/25 text-rose-300"
                    : scenarioActive
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                    : "bg-white/4 border-white/8 text-zinc-500"
                )}
              >
                {scenarioActive ? (
                  <ToggleRight className="w-4 h-4" />
                ) : (
                  <ToggleLeft className="w-4 h-4" />
                )}
                {scenarioActive && runtimeBlocked
                  ? t("suite.automation.statusBlocked")
                  : scenarioActive
                    ? t("suite.automation.statusActive")
                    : t("suite.automation.disabled")}
              </button>
            </Tip> : null}

            {permissions.canManageWorkflows ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 text-xs"
                  disabled={pendingAction !== null || runtimeBlocked || testRequiresConversation || !activeWorkflow}
                  title={testRequiresConversation ? t("suite.automation.testNeedsConversation") : !activeWorkflow ? t("suite.automation.saveFirst") : undefined}
                  onClick={() => void runScenarioTest()}
                >
                  <Play className="w-3.5 h-3.5" />
                  {pendingAction === "test" ? t("suite.automation.testing") : t("suite.automation.test")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 text-xs"
                  disabled={pendingAction !== null || (scenarioActive && runtimeBlocked)}
                  onClick={() => void duplicateScenario()}
                >
                  <Copy className="w-3.5 h-3.5" />
                  {pendingAction === "duplicate" ? t("suite.automation.duplicating") : t("suite.automation.duplicate")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 text-xs"
                  disabled={pendingAction !== null || !activeWorkflow}
                  onClick={() => void archiveScenario()}
                >
                  <Archive className="w-3.5 h-3.5" />
                  {pendingAction === "archive" ? t("suite.automation.archiving") : t("suite.automation.archive")}
                </Button>
              </>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 text-xs"
              disabled={pendingAction !== null}
              onClick={() => void openArchiveModal()}
              data-testid="automation-open-archive"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t("suite.automation.archivedList")}
            </Button>
            {permissions.canManageWorkflows ? (
              <Button
                size="sm"
                className="min-h-11 gap-1.5 text-xs"
                disabled={pendingAction !== null || (scenarioActive && runtimeBlocked)}
                onClick={() => void saveScenario()}
              >
                <Save className="w-3.5 h-3.5" />
                {pendingAction === "save" ? t("suite.automation.saving") : hasUnsavedChanges ? t("suite.automation.saveChanges") : t("suite.automation.save")}
              </Button>
            ) : null}
          </div>
          {testRequiresConversation ? (
            <p className="text-xs leading-relaxed text-zinc-500" data-testid="automation-test-note">
              {t("suite.automation.testNeedsConversation")}
            </p>
          ) : null}
        </div>

        {runtimeBlocked && (
          <div
            className="mb-4 flex shrink-0 items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3"
            data-testid="automation-runtime-blocked"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-200">
                {t("suite.automation.runtimeBlocked")}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-200/75">
                {t("suite.automation.runtimeBlockedDescription")}
              </p>
              {unsupportedBlocks.length > 0 ? (
                <p className="mt-1 truncate text-xs text-amber-100/60">
                  {unsupportedBlocks.map((block) => block.title).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Main layout ── */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] lg:overflow-hidden">
          {/* ── LEFT: Canvas ── */}
          <div className="pr-1 lg:overflow-y-auto scrollbar-thin">
            <div className="max-w-lg mx-auto pb-8">
              <AnimatePresence mode="popLayout">
                {localizedBlocks.map((block, index) => (
                  <div key={block.id}>
                    <BlockNode
                      block={block}
                      index={index}
                      selected={selectedId === block.id}
                      onClick={() => setSelectedId(block.id)}
                      onToggle={() => toggleBlock(block.id)}
                      editable={permissions.canManageWorkflows}
                    />
                    {index < blocks.length - 1 && <Connector />}
                  </div>
                ))}
              </AnimatePresence>

              {permissions.canManageWorkflows && (canAddCondition || canAddHandoff) ? <motion.div
                className="mt-4 flex flex-wrap justify-center gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                {canAddCondition ? (
                  <button
                    type="button"
                    onClick={() => addBlock("condition")}
                    className="group flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-white/12 px-4 py-2 text-sm text-zinc-500 outline-none transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    <GitBranch className="h-4 w-4 transition-colors group-hover:text-emerald-400" />
                    {t("suite.automation.addCondition")}
                  </button>
                ) : null}
                {canAddHandoff ? (
                  <button
                    type="button"
                    onClick={() => addBlock("handoff")}
                    className="group flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-white/12 px-4 py-2 text-sm text-zinc-500 outline-none transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    <UserRoundCheck className="h-4 w-4 transition-colors group-hover:text-emerald-400" />
                    {t("suite.automation.blockHandoff")}
                  </button>
                ) : null}
              </motion.div> : null}
            </div>
          </div>

          {/* ── RIGHT: Settings panel ── */}
          <div className="lg:overflow-y-auto">
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
                      <p className="text-xs text-zinc-500 mt-0.5">{t("suite.automation.blockSettings")}</p>
                    </div>
                  </div>

                  <fieldset disabled={!permissions.canManageWorkflows}>
                    <BlockSettings
                      block={selectedBlock}
                      onDelete={() => requestDeleteBlock(selectedBlock.id)}
                      onConfigChange={(patch) => updateBlockConfig(selectedBlock.id, patch)}
                    />
                  </fieldset>
                </Card>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <Modal
        open={archiveModalOpen}
        onOpenChange={setArchiveModalOpen}
        title={t("suite.automation.archiveTitle")}
        description={t("suite.automation.archiveDescription")}
        className="max-w-2xl"
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {(archiveLoadStatus === "loading" || archiveLoadStatus === "idle") && !archiveLoaded ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">
              {t("suite.automation.archiveLoading")}
            </div>
          ) : (
            <>
              {archiveLoadStatus === "error" ? (
                <ResourceErrorState
                  testId="automation-archive-load-error"
                  onRetry={() => void loadArchivedWorkflows()}
                />
              ) : null}
              {archivedWorkflows.length === 0 ? (
                archiveLoadStatus === "success" ? (
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">
                    {t("suite.automation.archiveEmpty")}
                  </div>
                ) : null
              ) : (
                archivedWorkflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{localizeWorkflowName(workflow.name, t)}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t("suite.automation.archiveMeta", {
                        blocks: formatNumber(workflow.steps?.length ?? 0),
                      })}
                      </p>
                    </div>
                    {permissions.canManageWorkflows ? <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 gap-1.5 text-xs sm:self-center"
                      disabled={restoreWorkflowId === workflow.id}
                      onClick={() => void restoreArchivedWorkflow(workflow)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {restoreWorkflowId === workflow.id ? t("suite.automation.restoring") : t("suite.automation.restore")}
                    </Button> : null}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </Modal>
      {permissions.canManageWorkflows ? <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("suite.automation.deleteTitle")}
        description={t("suite.automation.deleteDescription")}
        danger
        confirmLabel={t("suite.automation.delete")}
        onConfirm={confirmDeleteBlock}
      /> : null}
    </ProductLayout>
  );
}
