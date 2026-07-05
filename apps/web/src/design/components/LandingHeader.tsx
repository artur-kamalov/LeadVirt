"use client";

import React from "react";
import Link from "next/link";
import { Bot, Menu, X } from "lucide-react";

export function LandingHeader() {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-zinc-950/85">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-zinc-950" />
          </div>
          <span className="text-xl font-bold tracking-tight">AI Администратор</span>
        </div>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
          <a href="#features" className="hover:text-zinc-100 transition-colors">Возможности</a>
          <a href="#niches" className="hover:text-zinc-100 transition-colors">Решения</a>
          <a href="#pricing" className="hover:text-zinc-100 transition-colors">Тарифы</a>
          <a href="#integrations" className="hover:text-zinc-100 transition-colors">Интеграции</a>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            prefetch={false}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            Войти
          </Link>
          <Link
            href="/onboarding"
            prefetch={false}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-400 px-3 text-sm font-medium text-zinc-950 shadow-[0_0_22px_rgba(52,211,153,0.18)] transition-all hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            Попробовать бесплатно
          </Link>
        </div>

        <button
          className="md:hidden text-zinc-400 hover:text-zinc-100"
          type="button"
          aria-expanded={isMenuOpen}
          aria-label="Открыть меню"
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {isMenuOpen && (
        <div className="leadvirt-mobile-menu-enter md:hidden border-t border-white/5 bg-zinc-950/95 overflow-hidden">
          <nav className="container mx-auto px-6 py-6 flex flex-col gap-4 text-zinc-300">
            <a href="#features" onClick={closeMenu} className="py-2">Возможности</a>
            <a href="#niches" onClick={closeMenu} className="py-2">Решения</a>
            <a href="#pricing" onClick={closeMenu} className="py-2">Тарифы</a>
            <a href="#integrations" onClick={closeMenu} className="py-2">Интеграции</a>
            <div className="flex flex-col gap-3 pt-2">
              <Link
                href="/login"
                prefetch={false}
                onClick={closeMenu}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/15 bg-transparent px-4 py-2 text-sm font-medium text-zinc-100 transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                Войти
              </Link>
              <Link
                href="/onboarding"
                prefetch={false}
                onClick={closeMenu}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-[0_0_22px_rgba(52,211,153,0.18)] transition-all hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                Попробовать бесплатно
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
