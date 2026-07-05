import React from "react";
import { MessageSquare, Calendar, Database, Sparkles, CheckCircle2 } from "lucide-react";

export const HeroVisual = () => {
  return (
    <div className="relative w-full aspect-square md:aspect-video max-w-4xl mx-auto mt-16 lg:mt-0 flex items-center justify-center">
      {/* Background abstract elements */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-900/35 to-transparent border border-zinc-800/50 rounded-3xl overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      {/* Center AI Node */}
      <div
        className="leadvirt-hero-node-pulse absolute z-20 w-24 h-24 rounded-2xl bg-zinc-900 border border-emerald-500/30 flex items-center justify-center rotate-45"
      >
        <div className="rotate-[-45deg] relative">
          <Sparkles className="w-8 h-8 text-emerald-400" />
          <div
            className="absolute -inset-4 border border-dashed border-emerald-500/20 rounded-full"
            style={{ animation: "leadvirt-hero-spin 10s linear infinite" }}
          />
        </div>
      </div>

      {/* Incoming Messages (Left) */}
      <div className="absolute left-[10%] top-[20%] space-y-4 z-10">
        {[
          { text: "Хочу записаться на завтра", delay: 0 },
          { text: "Сколько стоит услуга?", delay: 1.5 },
          { text: "Где вы находитесь?", delay: 0.8 },
        ].map((msg, i) => (
          <div
            key={i}
            className="leadvirt-hero-message-card flex items-center gap-3 bg-zinc-800/90 border border-zinc-700 p-3 rounded-2xl rounded-tl-sm text-sm text-zinc-300 w-48 shadow-xl"
            style={{ animationDelay: `${msg.delay}s` }}
          >
            <MessageSquare className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="truncate">{msg.text}</span>
          </div>
        ))}
      </div>

      {/* Outgoing CRM / Tasks (Right) */}
      <div className="absolute right-[10%] bottom-[20%] space-y-4 z-10">
        {[
          { icon: Calendar, text: "Новая запись: 14:00", color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20", delay: 0.5 },
          { icon: Database, text: "Лид добавлен в CRM", color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/20", delay: 2 },
          { icon: CheckCircle2, text: "Вопрос решен", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20", delay: 1.2 },
        ].map((task, i) => (
          <div
            key={i}
            className={`leadvirt-hero-task-card flex items-center gap-3 ${task.bg} border ${task.border} p-3 rounded-xl text-sm text-zinc-200 w-52 shadow-xl`}
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
