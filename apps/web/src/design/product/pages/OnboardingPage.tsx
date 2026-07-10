import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bot,
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Scissors,
  ShoppingBag,
  Stethoscope,
  GraduationCap,
  Car,
  MapPin,
  Briefcase,
  CalendarCheck,
  PackageCheck,
  MessageSquare,
  HeadphonesIcon,
  Building2,
  Clock,
  DollarSign,
  Database,
} from "lucide-react";
import { useNav } from "../nav";
import { Button } from "../../components/ui/Button";
import { BrandMark } from "../../components/BrandMark";
import { Card, channels } from "../shared";
import { cn } from "../../lib/utils";
import { completeOnboardingStep, getOnboardingState, updateOnboardingState } from "@/lib/api/onboarding";

/* ------------------------------------------------------------------ */
/* Types & constants                                                    */
/* ------------------------------------------------------------------ */

type ChannelId = keyof typeof channels;

interface CompanyInfo {
  name: string;
  description: string;
  hours: string;
  avgCheck: string;
  servicesCatalog: string;
  availability: string;
  faq: string;
  policies: string;
  escalationRules: string;
}

const TOTAL_STEPS = 6;
const stepIds = ["business", "channels", "scenario", "company", "crm", "launch"] as const;

const businessTypes = [
  { id: "services", label: "Услуги", icon: Briefcase },
  { id: "beauty", label: "Бьюти-студия", icon: Scissors },
  { id: "shop", label: "Интернет-магазин", icon: ShoppingBag },
  { id: "clinic", label: "Клиника", icon: Stethoscope },
  { id: "education", label: "Образование", icon: GraduationCap },
  { id: "auto", label: "Автосервис", icon: Car },
  { id: "local", label: "Локальный бизнес", icon: MapPin },
];

const aiScenarios = [
  {
    id: "booking",
    label: "Запись на услугу",
    desc: "AI записывает клиентов автоматически, уточняет дату, время и специалиста",
    icon: CalendarCheck,
  },
  {
    id: "order",
    label: "Оформление заказа",
    desc: "Принимает заказы, уточняет детали и передаёт в обработку",
    icon: PackageCheck,
  },
  {
    id: "consult",
    label: "Консультация и квалификация",
    desc: "Отвечает на вопросы, выявляет потребности и квалифицирует лиды",
    icon: MessageSquare,
  },
  {
    id: "support",
    label: "Поддержка клиентов",
    desc: "Обрабатывает типовые обращения, снижает нагрузку на команду",
    icon: HeadphonesIcon,
  },
];

const crmOptions = [
  { id: "amo", label: "amoCRM", desc: "Популярная CRM для продаж в России", icon: Database },
  { id: "bitrix", label: "Bitrix24", desc: "Корпоративный портал с воронкой продаж", icon: Building2 },
  { id: "retail", label: "RetailCRM", desc: "Специализированная CRM для e-commerce", icon: ShoppingBag },
  { id: "none", label: "Без CRM (дашборд)", desc: "Все лиды будут в AI Администраторе", icon: Bot },
];

const channelIds: ChannelId[] = ["instagram", "whatsapp", "telegram", "website", "webhook", "vk", "email", "call"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stepIndexFromId(id: string) {
  const index = stepIds.findIndex((stepId) => stepId === id);
  return index >= 0 ? index : 0;
}

function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && channelIds.includes(value as ChannelId);
}

function stringFromData(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function channelsFromData(data: Record<string, unknown>): ChannelId[] {
  const value = data.selectedChannels;
  return Array.isArray(value) ? value.filter(isChannelId) : [];
}

function companyInfoFromData(data: Record<string, unknown>): CompanyInfo {
  const value = data.companyInfo;
  const record = isRecord(value) ? value : {};
  return {
    name: typeof record.name === "string" ? record.name : "",
    description: typeof record.description === "string" ? record.description : "",
    hours: typeof record.hours === "string" ? record.hours : "",
    avgCheck: typeof record.avgCheck === "string" ? record.avgCheck : "",
    servicesCatalog: typeof record.servicesCatalog === "string" ? record.servicesCatalog : "",
    availability: typeof record.availability === "string" ? record.availability : "",
    faq: typeof record.faq === "string" ? record.faq : "",
    policies: typeof record.policies === "string" ? record.policies : "",
    escalationRules: typeof record.escalationRules === "string" ? record.escalationRules : "",
  };
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

function GlowOrbs() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute top-1/2 -right-60 w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/3 w-[400px] h-[400px] rounded-full bg-teal-500/8 blur-[100px]" />
      </div>
      {/* subtle grid */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
        }}
      />
    </>
  );
}

function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 group" aria-label="AI Администратор">
      <BrandMark className="h-9 w-9 rounded-xl shadow-lg shadow-emerald-500/20" />
      <span className="font-bold text-zinc-100 tracking-tight text-sm hidden sm:block">
        AI Администратор
      </span>
    </button>
  );
}

function ProgressBar({ step }: { step: number }) {
  const pct = ((step + 1) / TOTAL_STEPS) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-500 whitespace-nowrap">
        Шаг {step + 1} из {TOTAL_STEPS}
      </span>
      <div className="w-24 sm:w-40 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}

/* SelectCard — reusable single/multi select card */
function SelectCard({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative rounded-2xl border p-4 text-left transition-all duration-200 cursor-pointer w-full",
        selected
          ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_24px_rgba(52,211,153,0.15)]"
          : "border-white/5 bg-zinc-900/50 hover:border-white/10 hover:bg-zinc-900/80",
        className
      )}
    >
      {selected && (
        <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center">
          <Check className="w-3 h-3 text-zinc-950" />
        </span>
      )}
      {children}
    </motion.button>
  );
}

/* Step slide variants */
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

const transition = { duration: 0.35, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] };

/* ------------------------------------------------------------------ */
/* Steps                                                                */
/* ------------------------------------------------------------------ */

function StepBusinessType({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          С каким бизнесом работаем?
        </h2>
        <p className="text-zinc-400 mt-2">Выберите тип бизнеса — AI подстроится под вашу нишу</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {businessTypes.map((b) => {
          const Icon = b.icon;
          return (
            <SelectCard key={b.id} selected={value === b.id} onClick={() => onChange(b.id)}>
              <div className="flex flex-col items-start gap-2 pr-4">
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center",
                    value === b.id ? "bg-emerald-400/20" : "bg-white/5"
                  )}
                >
                  <Icon className={cn("w-4.5 h-4.5", value === b.id ? "text-emerald-400" : "text-zinc-400")} />
                </div>
                <span className={cn("text-sm font-semibold", value === b.id ? "text-emerald-300" : "text-zinc-200")}>
                  {b.label}
                </span>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepChannels({
  value,
  onChange,
}: {
  value: ChannelId[];
  onChange: (v: ChannelId[]) => void;
}) {
  const toggle = (id: ChannelId) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          Откуда приходят клиенты?
        </h2>
        <p className="text-zinc-400 mt-2">Выберите каналы, которые хотите подключить</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {channelIds.map((id) => {
          const ch = channels[id];
          const Icon = ch.icon;
          const sel = value.includes(id);
          return (
            <SelectCard key={id} selected={sel} onClick={() => toggle(id)}>
              <div className="flex items-center gap-2.5 pr-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", ch.bg)}>
                  <Icon className={cn("w-4 h-4", ch.color)} />
                </div>
                <span className={cn("text-sm font-semibold", sel ? "text-emerald-300" : "text-zinc-200")}>
                  {ch.label}
                </span>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepScenario({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          Выберите сценарий AI
        </h2>
        <p className="text-zinc-400 mt-2">Как должен работать ваш AI-ассистент?</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {aiScenarios.map((s) => {
          const Icon = s.icon;
          const sel = value === s.id;
          return (
            <SelectCard key={s.id} selected={sel} onClick={() => onChange(s.id)}>
              <div className="flex flex-col gap-2 pr-4">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", sel ? "bg-emerald-400/20" : "bg-white/5")}>
                  <Icon className={cn("w-4.5 h-4.5", sel ? "text-emerald-400" : "text-zinc-400")} />
                </div>
                <div>
                  <div className={cn("text-sm font-bold", sel ? "text-emerald-300" : "text-zinc-100")}>{s.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{s.desc}</div>
                </div>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepCompanyInfo({
  value,
  onChange,
}: {
  value: CompanyInfo;
  onChange: (v: CompanyInfo) => void;
}) {
  const field = (k: keyof CompanyInfo) => ({
    value: value[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...value, [k]: e.target.value }),
  });
  const inputCls =
    "w-full h-11 bg-white/5 border border-white/5 rounded-xl px-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:bg-white/[0.07] transition-colors";
  const textareaCls = cn(inputCls, "h-auto py-3 resize-none leading-relaxed");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          Информация о компании
        </h2>
        <p className="text-zinc-400 mt-2">AI использует эти данные для общения с клиентами</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Название компании</label>
          <input
            {...field("name")}
            placeholder="Например: Студия красоты «Аура»"
            className={inputCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">О компании</label>
          <textarea
            {...(field("description") as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={3}
            placeholder="Чем занимается ваша компания, ваши преимущества..."
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Каталог, услуги и цены</label>
          <textarea
            {...(field("servicesCatalog") as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={5}
            placeholder="Например: стрижка женская - 2500 ₽, 60 минут; окрашивание - от 6000 ₽; консультация - бесплатно."
            className={textareaCls}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3 h-3" />Рабочие часы
            </label>
            <input
              {...field("hours")}
              placeholder="Пн–Пт 9:00–18:00"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-3 h-3" />Средний чек
            </label>
            <input
              {...field("avgCheck")}
              placeholder="2 000 – 5 000 ₽"
              className={inputCls}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Свободные окна и правила записи</label>
          <textarea
            {...(field("availability") as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={4}
            placeholder="Например: свободные окна вторник-четверг 12:00-17:00; запись минимум за 2 часа; перенос не позже чем за сутки."
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">FAQ и частые возражения</label>
          <textarea
            {...(field("faq") as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={4}
            placeholder="Например: можно ли с детьми, сколько держится результат, какие есть противопоказания, чем вы отличаетесь."
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Правила, ограничения, что нельзя обещать</label>
          <textarea
            {...(field("policies") as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={4}
            placeholder="Например: не обещать точную цену без консультации; не давать медицинских гарантий; скидки только после согласования."
            className={textareaCls}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Когда звать человека</label>
          <textarea
            {...(field("escalationRules") as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={3}
            placeholder="Например: клиент злится, просит возврат, хочет нестандартную скидку, спрашивает юридические или медицинские детали."
            className={textareaCls}
          />
        </div>
      </div>
    </div>
  );
}

function StepCRM({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
          Куда отправлять лиды?
        </h2>
        <p className="text-zinc-400 mt-2">Выберите CRM или оставьте всё внутри системы</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {crmOptions.map((c) => {
          const Icon = c.icon;
          const sel = value === c.id;
          return (
            <SelectCard key={c.id} selected={sel} onClick={() => onChange(c.id)}>
              <div className="flex flex-col gap-2 pr-4">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", sel ? "bg-emerald-400/20" : "bg-white/5")}>
                  <Icon className={cn("w-4.5 h-4.5", sel ? "text-emerald-400" : "text-zinc-400")} />
                </div>
                <div>
                  <div className={cn("text-sm font-bold", sel ? "text-emerald-300" : "text-zinc-100")}>{c.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{c.desc}</div>
                </div>
              </div>
            </SelectCard>
          );
        })}
      </div>
    </div>
  );
}

function StepLaunch({
  businessType,
  selectedChannels,
  scenario,
  crm,
  companyName,
  onLaunch,
}: {
  businessType: string | null;
  selectedChannels: ChannelId[];
  scenario: string | null;
  crm: string | null;
  companyName: string;
  onLaunch: () => void;
}) {
  const btLabel = businessTypes.find((b) => b.id === businessType)?.label ?? "—";
  const scenLabel = aiScenarios.find((s) => s.id === scenario)?.label ?? "—";
  const crmLabel = crmOptions.find((c) => c.id === crm)?.label ?? "—";
  const channelLabels = selectedChannels.map((id) => channels[id].label);

  const summaryItems = [
    { label: "Бизнес", value: btLabel },
    { label: "Каналы", value: channelLabels.length ? channelLabels.join(", ") : "Не выбраны" },
    { label: "Сценарий AI", value: scenLabel },
    { label: "CRM", value: crmLabel },
    ...(companyName ? [{ label: "Компания", value: companyName }] : []),
  ];

  return (
    <div className="space-y-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
          className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-2xl shadow-emerald-500/30"
        >
          <Check className="w-10 h-10 text-zinc-950 stroke-[2.5]" />
        </motion.div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">
            Всё готово! 🚀
          </h2>
          <p className="text-zinc-400 mt-2">
            AI Администратор настроен и готов к работе
          </p>
        </div>
      </div>

      {/* Summary card */}
      <Card className="p-5 text-left">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Итог настройки</div>
        <div className="space-y-2.5">
          {summaryItems.map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-4">
              <span className="text-sm text-zinc-500 shrink-0">{item.label}</span>
              <span className="text-sm text-zinc-200 font-medium text-right">{item.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Launch button (desktop) */}
      <div className="hidden sm:flex justify-center">
        <Button size="lg" onClick={onLaunch} className="gap-2 shadow-xl shadow-emerald-500/20">
          Запустить AI Администратора
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                            */
/* ------------------------------------------------------------------ */

export function OnboardingPage() {
  const { go } = useNav();

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1); // slide direction
  const [saving, setSaving] = useState(false);
  const hasLocalChangesRef = useRef(false);

  // Step state
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<ChannelId[]>([]);
  const [scenario, setScenario] = useState<string | null>(null);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({
    name: "",
    description: "",
    hours: "",
    avgCheck: "",
    servicesCatalog: "",
    availability: "",
    faq: "",
    policies: "",
    escalationRules: "",
  });
  const [crm, setCrm] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getOnboardingState()
      .then((state) => {
        if (!active) return;
        if (hasLocalChangesRef.current) return;
        const data = isRecord(state.data) ? state.data : {};
        setBusinessType(stringFromData(data, "businessType"));
        setSelectedChannels(channelsFromData(data));
        setScenario(stringFromData(data, "scenario"));
        setCompanyInfo(companyInfoFromData(data));
        setCrm(stringFromData(data, "crm"));
        setStep(stepIndexFromId(state.currentStep));
      })
      .catch(() => {
        if (!active) return;
      });

    return () => {
      active = false;
    };
  }, []);

  const navigate = (nextStep: number) => {
    setDir(nextStep > step ? 1 : -1);
    setStep(nextStep);
  };

  const markLocalChange = () => {
    hasLocalChangesRef.current = true;
  };

  const updateBusinessType = (value: string) => {
    markLocalChange();
    setBusinessType(value);
  };

  const updateSelectedChannels = (value: ChannelId[]) => {
    markLocalChange();
    setSelectedChannels(value);
  };

  const updateScenario = (value: string) => {
    markLocalChange();
    setScenario(value);
  };

  const updateCompanyInfo = (value: CompanyInfo) => {
    markLocalChange();
    setCompanyInfo(value);
  };

  const updateCrm = (value: string) => {
    markLocalChange();
    setCrm(value);
  };

  const onboardingData = () => ({
    businessType,
    selectedChannels,
    scenario,
    companyInfo,
    crm,
  });

  const persistProgress = async (completedStepId: (typeof stepIds)[number], nextStepId: (typeof stepIds)[number]) => {
    try {
      await updateOnboardingState({ currentStep: completedStepId, data: onboardingData() });
      await completeOnboardingStep(completedStepId);
      if (nextStepId !== completedStepId) {
        await updateOnboardingState({ currentStep: nextStepId, data: onboardingData() });
      }
    } catch {
      // Keep the copied demo flow usable when the API is offline during visual QA.
    }
  };

  const isStepValid = () => {
    if (step === 0) return !!businessType;
    if (step === 1) return selectedChannels.length > 0;
    if (step === 2) return !!scenario;
    if (step === 3) return companyInfo.name.trim().length > 0 && companyInfo.description.trim().length > 0;
    if (step === 4) return !!crm;
    return true;
  };

  const handleNext = async () => {
    if (!isStepValid() || saving) return;

    if (step < TOTAL_STEPS - 1) {
      const nextStep = step + 1;
      setSaving(true);
      await persistProgress(stepIds[step], stepIds[nextStep]);
      setSaving(false);
      navigate(nextStep);
      return;
    }

    await handleLaunch();
  };

  const handleBack = () => {
    if (step > 0 && !saving) navigate(step - 1);
  };

  const handleLaunch = async () => {
    if (saving) return;
    setSaving(true);
    await persistProgress("launch", "launch");
    setSaving(false);
    go("dashboard");
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepBusinessType value={businessType} onChange={updateBusinessType} />;
      case 1:
        return <StepChannels value={selectedChannels} onChange={updateSelectedChannels} />;
      case 2:
        return <StepScenario value={scenario} onChange={updateScenario} />;
      case 3:
        return <StepCompanyInfo value={companyInfo} onChange={updateCompanyInfo} />;
      case 4:
        return <StepCRM value={crm} onChange={updateCrm} />;
      case 5:
        return (
          <StepLaunch
            businessType={businessType}
            selectedChannels={selectedChannels}
            scenario={scenario}
            crm={crm}
            companyName={companyInfo.name}
            onLaunch={() => void handleLaunch()}
          />
        );
      default:
        return null;
    }
  };

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-50 flex flex-col overflow-x-hidden">
      <GlowOrbs />

      {/* ---- Top bar ---- */}
      <header className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-white/5 backdrop-blur-sm bg-zinc-950/70">
        <Logo onClick={() => go("landing")} />
        <ProgressBar step={step} />
        <button
          onClick={() => go("dashboard")}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="w-4 h-4" />
          <span className="hidden sm:inline">Пропустить</span>
        </button>
      </header>

      {/* ---- Step content ---- */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 pb-32 sm:pb-12">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              <Card className="p-6 sm:p-8">
                {renderStep()}
              </Card>
            </motion.div>
          </AnimatePresence>

          {/* ---- Desktop navigation ---- */}
          {!isLastStep && (
            <div className="hidden sm:flex items-center justify-between mt-6">
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={step === 0 || saving}
                className="gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                Назад
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleNext()}
                disabled={!isStepValid() || saving}
                className="gap-1.5"
              >
                Далее
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* ---- Mobile sticky bottom bar ---- */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-20 border-t border-white/5 bg-zinc-950/90 backdrop-blur-xl px-4 py-3 safe-area-inset-bottom">
        {isLastStep ? (
          <Button size="lg" onClick={() => void handleLaunch()} disabled={saving} className="w-full gap-2 shadow-xl shadow-emerald-500/20">
            Запустить AI Администратора
            <ChevronRight className="w-5 h-5" />
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={step === 0 || saving}
              className="h-12 w-12 shrink-0 p-0 flex items-center justify-center"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleNext()}
              disabled={!isStepValid() || saving}
              className="flex-1 gap-1.5"
            >
              Далее
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
