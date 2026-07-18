"use client";

import React from "react";
import { MessageSquare, Calendar, Database, Sparkles, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export const HeroVisual = () => {
  const { t } = useI18n();

  return (
    <div className="relative mx-auto flex aspect-[8/1] w-full max-w-4xl items-center justify-center sm:aspect-video">
      {/* Background abstract elements */}
      <div className="absolute inset-0 overflow-hidden rounded-2xl border border-zinc-800/50 bg-gradient-to-b from-transparent via-zinc-900/35 to-transparent sm:rounded-3xl">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      {/* Center AI Node */}
      <div
        className="leadvirt-hero-node-pulse absolute z-20 flex h-12 w-12 rotate-45 items-center justify-center rounded-xl border border-emerald-500/30 bg-zinc-900 sm:h-24 sm:w-24 sm:rounded-2xl"
      >
        <div className="rotate-[-45deg] relative">
          <Sparkles className="h-6 w-6 text-emerald-400 sm:h-8 sm:w-8" />
          <div
            className="absolute -inset-3 rounded-full border border-dashed border-emerald-500/20 sm:-inset-4"
            style={{ animation: "leadvirt-hero-spin 10s linear infinite" }}
          />
        </div>
      </div>

      {/* Incoming Messages (Left) */}
      <div className="absolute left-[3%] top-[14%] z-10 space-y-2 sm:left-[10%] sm:top-[20%] sm:space-y-4">
        {[
          { text: t("hero.message.booking"), delay: 0 },
          { text: t("hero.message.price"), delay: 1.5 },
          { text: t("hero.message.location"), delay: 0.8 },
        ].map((msg, i) => (
          <div
            key={i}
            className={`leadvirt-hero-message-card ${i === 0 ? "flex" : "sr-only sm:not-sr-only sm:flex"} w-24 items-center gap-2 rounded-xl rounded-tl-sm border border-zinc-700 bg-zinc-800/90 p-2 text-xs text-zinc-300 shadow-xl sm:w-48 sm:gap-3 sm:rounded-2xl sm:p-3 sm:text-sm`}
            style={{ animationDelay: `${msg.delay}s` }}
          >
            <MessageSquare className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="truncate">{msg.text}</span>
          </div>
        ))}
      </div>

      {/* Outgoing CRM / Tasks (Right) */}
      <div className="absolute bottom-[14%] right-[3%] z-10 space-y-2 sm:bottom-[20%] sm:right-[10%] sm:space-y-4">
        {[
          { icon: Calendar, text: t("hero.task.booking"), color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20", delay: 0.5 },
          { icon: Database, text: t("hero.task.crm"), color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/20", delay: 2 },
          { icon: CheckCircle2, text: t("hero.task.resolved"), color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20", delay: 1.2 },
        ].map((task, i) => (
          <div
            key={i}
            className={`leadvirt-hero-task-card ${i === 0 ? "flex" : "sr-only sm:not-sr-only sm:flex"} w-24 items-center gap-2 rounded-xl border ${task.border} ${task.bg} p-2 text-xs text-zinc-200 shadow-xl sm:w-52 sm:gap-3 sm:p-3 sm:text-sm`}
            style={{ animationDelay: `${task.delay}s` }}
          >
            <task.icon className={`w-4 h-4 ${task.color} shrink-0`} />
            <span className="truncate">{task.text}</span>
          </div>
        ))}
      </div>

      {/* Connecting Lines (SVG) */}
      <svg viewBox="0 0 1000 500" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none z-0">
        <path
          d="M 0 150 C 250 150 400 250 500 250 C 600 250 750 350 1000 350"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="2"
          fill="none"
          strokeDasharray="6 6"
        />
        <path
          d="M 0 150 C 250 150 400 250 500 250 C 600 250 750 350 1000 350"
          stroke="url(#flowGrad)"
          strokeWidth="3"
          fill="none"
          pathLength={1}
          className="leadvirt-hero-flow-line"
        />
        <defs>
          <linearGradient id="flowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
            <stop offset="50%" stopColor="#34d399" stopOpacity="1" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};
