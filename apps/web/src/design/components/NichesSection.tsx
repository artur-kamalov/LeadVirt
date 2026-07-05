import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Scissors, 
  HeartPulse, 
  ShoppingBag, 
  GraduationCap, 
  Car, 
  Briefcase, 
  Bot, 
  User, 
  CheckCircle2,
  Database
} from "lucide-react";
import { cn } from "../lib/utils";

const niches = [
  {
    id: "beauty",
    icon: Scissors,
    title: "Бьюти-сфера",
    desc: "Автоматическая запись, консультация по прайсу и напоминания о визитах.",
    color: "text-pink-400",
    bgColor: "bg-pink-400/10",
    gradient: "from-pink-500/20",
    userMsg: "Привет! Есть свободное окно на стрижку сегодня вечером?",
    aiMsg: "Здравствуйте! Да, к мастеру Алексею есть окна на 18:00 и 19:30. Записать вас на какое время?",
    crmTask: "Новая запись: Стрижка, 19:30",
    crmColor: "text-pink-400",
    crmBg: "bg-pink-500/10",
    crmBorder: "border-pink-500/20"
  },
  {
    id: "medicine",
    icon: HeartPulse,
    title: "Медицина",
    desc: "Квалификация симптомов, запись к врачам, сбор первичного анамнеза.",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    gradient: "from-blue-500/20",
    userMsg: "Добрый день. Как записаться к кардиологу?",
    aiMsg: "Добрый день! Ближайшая запись к доктору Смирнову — завтра в 14:00. Подсказать стоимость приема?",
    crmTask: "Лид в CRM: Запись к кардиологу",
    crmColor: "text-blue-400",
    crmBg: "bg-blue-500/10",
    crmBorder: "border-blue-500/20"
  },
  {
    id: "ecom",
    icon: ShoppingBag,
    title: "E-commerce",
    desc: "Ответы по наличию, помощь с выбором размера, статусы заказов.",
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    gradient: "from-orange-500/20",
    userMsg: "А этот свитер есть в размере L в черном цвете?",
    aiMsg: "Да, черный свитер в размере L есть в наличии (осталось 2 шт). Оформить заказ с доставкой?",
    crmTask: "Новый заказ: Свитер (L, Черный)",
    crmColor: "text-orange-400",
    crmBg: "bg-orange-500/10",
    crmBorder: "border-orange-500/20"
  },
  {
    id: "edu",
    icon: GraduationCap,
    title: "Образование",
    desc: "Продажа курсов, отправка ссылок на вебинары, ответы на частые вопросы.",
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
    gradient: "from-purple-500/20",
    userMsg: "Сколько длится курс по дизайну?",
    aiMsg: "Курс длится 3 месяца. Обучение проходит онлайн, 2 раза в неделю. Отправить вам полную программу?",
    crmTask: "Запрос: Программа курса 'Дизайн'",
    crmColor: "text-purple-400",
    crmBg: "bg-purple-500/10",
    crmBorder: "border-purple-500/20"
  },
  {
    id: "auto",
    icon: Car,
    title: "Автосервисы",
    desc: "Запись на ТО, расчет примерной стоимости работ, статус ремонта.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-400/10",
    gradient: "from-yellow-500/20",
    userMsg: "Сколько стоит поменять масло на Toyota Camry?",
    aiMsg: "Замена масла с вашими расходниками — 1500₽. Работа + наше масло — от 6500₽. Записать вас?",
    crmTask: "Лид: Замена масла (Camry)",
    crmColor: "text-yellow-400",
    crmBg: "bg-yellow-500/10",
    crmBorder: "border-yellow-500/20"
  },
  {
    id: "services",
    icon: Briefcase,
    title: "Услуги (B2B/B2C)",
    desc: "Клининг, юристы, ремонт. Оценка стоимости по фото и сбор деталей.",
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    gradient: "from-emerald-500/20",
    userMsg: "Нужна генеральная уборка 2-комнатной квартиры. Сколько стоит?",
    aiMsg: "Генеральная уборка 2-комн. квартиры стоит от 4500₽ (около 4 часов). На какой день вам удобно?",
    crmTask: "Лид: Ген. уборка (2к)",
    crmColor: "text-emerald-400",
    crmBg: "bg-emerald-500/10",
    crmBorder: "border-emerald-500/20"
  }
];

export const NichesSection = () => {
  const [activeNicheId, setActiveNicheId] = useState(niches[0].id);
  const active = niches.find(n => n.id === activeNicheId) || niches[0];

  return (
    <section id="niches" className="py-32 container mx-auto px-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        className="flex flex-col md:flex-row gap-12 items-end mb-16"
      >
        <div className="flex-1">
          <h2 className="text-3xl md:text-5xl font-bold mb-4 leading-tight">
            Идеально подходит для <br/>
            <span className="text-zinc-500">любого бизнеса</span>
          </h2>
          <p className="text-zinc-400 text-lg max-w-md">
            AI мгновенно адаптируется под специфику вашей сферы, изучает услуги, прайс и общается в вашем Tone of Voice.
          </p>
        </div>
      </motion.div>

      <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left Side: Tabs */}
        <div className="lg:col-span-5 space-y-2">
          {niches.map((niche) => {
            const isActive = niche.id === activeNicheId;
            return (
              <button
                key={niche.id}
                onClick={() => setActiveNicheId(niche.id)}
                className={cn(
                  "w-full text-left p-5 rounded-2xl transition-all duration-300 border flex gap-4 group",
                  isActive 
                    ? "bg-zinc-900 border-zinc-700 shadow-lg" 
                    : "bg-transparent border-transparent hover:bg-zinc-900/50 hover:border-zinc-800/50 opacity-60 hover:opacity-100"
                )}
              >
                <div className={cn(
                  "w-12 h-12 shrink-0 rounded-xl flex items-center justify-center transition-colors duration-300",
                  isActive ? niche.bgColor : "bg-zinc-800",
                  isActive ? niche.color : "text-zinc-400 group-hover:text-zinc-300"
                )}>
                  <niche.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className={cn(
                    "text-xl font-semibold mb-1 transition-colors",
                    isActive ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-200"
                  )}>
                    {niche.title}
                  </h3>
                  <AnimatePresence>
                    {isActive && (
                      <motion.p 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-sm text-zinc-400 leading-relaxed overflow-hidden"
                      >
                        {niche.desc}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Side: Interactive Visual */}
        <div className="lg:col-span-7">
          <div className="rounded-[2.5rem] bg-zinc-900 border border-zinc-800 overflow-hidden relative min-h-[500px] flex items-center justify-center p-6 md:p-12 shadow-2xl">
            {/* Dynamic Background Glow */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`bg-${active.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className={cn(
                  "absolute -top-40 -right-40 w-80 h-80 blur-3xl rounded-full pointer-events-none bg-gradient-to-br",
                  active.gradient,
                  "to-transparent"
                )}
              />
            </AnimatePresence>

            {/* Pattern Overlay */}
            <div className="grain-noise absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay" />

            <div className="w-full max-w-md relative z-10 space-y-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`chat-${active.id}`}
                  className="space-y-6"
                >
                  {/* User Message */}
                  <motion.div 
                    initial={{ opacity: 0, x: 20, y: 10 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="flex items-end gap-3 justify-end"
                  >
                    <div className="bg-zinc-800 text-zinc-200 p-4 rounded-2xl rounded-br-sm shadow-md max-w-[85%] text-sm leading-relaxed">
                      {active.userMsg}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-zinc-400" />
                    </div>
                  </motion.div>

                  {/* AI Message */}
                  <motion.div 
                    initial={{ opacity: 0, x: -20, y: 10 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.8, ease: "easeOut" }}
                    className="flex items-end gap-3 justify-start"
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                      active.bgColor
                    )}>
                      <Bot className={cn("w-4 h-4", active.color)} />
                    </div>
                    <div className="bg-zinc-950 border border-zinc-800 text-zinc-300 p-4 rounded-2xl rounded-bl-sm shadow-md max-w-[85%] text-sm leading-relaxed">
                      {active.aiMsg}
                    </div>
                  </motion.div>

                  {/* Floating CRM Card */}
                  <motion.div 
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.6, delay: 2, ease: "backOut" }}
                    className="absolute -bottom-8 -right-4 md:-right-12 z-20"
                  >
                    <div className={cn(
                      "flex items-center gap-3 p-4 rounded-xl border shadow-2xl",
                      "bg-zinc-900/80",
                      active.crmBorder
                    )}>
                      <div className={cn("p-2 rounded-lg", active.crmBg)}>
                        <Database className={cn("w-5 h-5", active.color)} />
                      </div>
                      <div>
                        <div className="text-xs text-zinc-400 font-medium mb-0.5">Добавлено в CRM</div>
                        <div className="text-sm font-semibold text-zinc-100">{active.crmTask}</div>
                      </div>
                      <CheckCircle2 className={cn("w-5 h-5 ml-2", active.color)} />
                    </div>
                  </motion.div>

                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
