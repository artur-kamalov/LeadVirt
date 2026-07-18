"use client";

import React from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "@/i18n/I18nProvider";
import { signupHref } from "@/lib/acquisition";

export function LandingHeader() {
  const { t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const mobileMenuCloseRef = React.useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMobileMenuOpen(false);

  React.useEffect(() => {
    const desktopViewport = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktopViewport.matches) setMobileMenuOpen(false);
    };
    desktopViewport.addEventListener("change", closeOnDesktop);
    return () => desktopViewport.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-zinc-950/85">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <Link
          href="/"
          aria-label={t("brand.name")}
          className="flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <BrandMark className="h-8 w-8 rounded-lg" />
          <BrandWordmark className="text-xl" />
        </Link>

        <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-zinc-400">
          <a
            href="#niches"
            className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {t("landing.nav.solutions")}
          </a>
          <a
            href="#features"
            className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {t("landing.nav.features")}
          </a>
          <a
            href="#pricing"
            className="inline-flex min-h-11 items-center rounded-md px-2 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {t("landing.nav.pricing")}
          </a>
          {/* <a href="#integrations" className="hover:text-zinc-100 transition-colors">Интеграции</a> */}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <LanguageSwitcher compact />
          <Link
            href="/login"
            prefetch={false}
            data-testid="landing-desktop-login"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {t("landing.nav.login")}
          </Link>
          <Link
            href={signupHref()}
            prefetch={false}
            data-testid="landing-desktop-trial"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-emerald-400 px-3 text-sm font-medium text-zinc-950 shadow-[0_0_22px_rgba(52,211,153,0.18)] transition-all hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {t("landing.nav.trial")}
          </Link>
        </div>

        <div className="md:hidden">
          <DialogPrimitive.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                data-testid="landing-mobile-menu"
                aria-label={t("landing.nav.openMenu")}
                className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <Menu className="h-6 w-6" aria-hidden="true" />
              </button>
            </DialogPrimitive.Trigger>

            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay
                data-testid="landing-mobile-menu-backdrop"
                className="fixed inset-0 z-50 bg-zinc-950 md:hidden"
              />
              <DialogPrimitive.Content
                aria-describedby={undefined}
                aria-modal="true"
                data-testid="landing-mobile-menu-dialog"
                className="leadvirt-mobile-menu-enter fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950 text-zinc-50 outline-none md:hidden"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  mobileMenuCloseRef.current?.focus();
                }}
              >
                <DialogPrimitive.Title className="sr-only">
                  {t("product.menu.navigation")}
                </DialogPrimitive.Title>
                <div className="container mx-auto flex h-20 shrink-0 items-center justify-between border-b border-white/5 px-6">
                  <Link
                    href="/"
                    aria-label={t("brand.name")}
                    onClick={closeMenu}
                    className="flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    <BrandMark className="h-8 w-8 rounded-lg" />
                    <BrandWordmark className="text-xl" />
                  </Link>
                  <DialogPrimitive.Close asChild>
                    <button
                      ref={mobileMenuCloseRef}
                      type="button"
                      data-testid="landing-mobile-menu-close"
                      aria-label={t("landing.nav.closeMenu")}
                      className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    >
                      <X className="h-6 w-6" aria-hidden="true" />
                    </button>
                  </DialogPrimitive.Close>
                </div>
                <nav
                  id="landing-mobile-navigation"
                  aria-label={t("product.menu.navigation")}
                  className="container mx-auto flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6 text-zinc-300"
                >
                  <a
                    href="#niches"
                    onClick={closeMenu}
                    data-testid="landing-mobile-solutions"
                    className="flex min-h-11 items-center"
                  >
                    {t("landing.nav.solutions")}
                  </a>
                  <a href="#features" onClick={closeMenu} className="flex min-h-11 items-center">
                    {t("landing.nav.features")}
                  </a>
                  <a href="#pricing" onClick={closeMenu} className="flex min-h-11 items-center">
                    {t("landing.nav.pricing")}
                  </a>
                  <div className="flex flex-col gap-3 pt-2">
                    <LanguageSwitcher className="h-11 w-fit" />
                    <Link
                      href="/login"
                      prefetch={false}
                      onClick={closeMenu}
                      data-testid="landing-mobile-login"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/15 bg-transparent px-4 py-2 text-sm font-medium text-zinc-100 transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    >
                      {t("landing.nav.login")}
                    </Link>
                    <Link
                      href={signupHref()}
                      prefetch={false}
                      onClick={closeMenu}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-[0_0_22px_rgba(52,211,153,0.18)] transition-all hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    >
                      {t("landing.nav.trial")}
                    </Link>
                  </div>
                </nav>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </div>
    </header>
  );
}
