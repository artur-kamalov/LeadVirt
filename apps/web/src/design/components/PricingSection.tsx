"use client";

import React from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { plans } from "../product/plans";
import { cn } from "../lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { signupHref } from "@/lib/acquisition";

const corporateContactHref = process.env.NEXT_PUBLIC_CORPORATE_CONTACT_URL?.trim();

const planCopy: Record<string, { tagline: TranslationKey; cta: TranslationKey; features: TranslationKey[] }> = {
  start: {
    tagline: "pricing.start.tagline",
    cta: "pricing.start.cta",
    features: ["pricing.feature.ai500", "pricing.feature.channels2", "pricing.feature.users3", "pricing.feature.scenarios3", "pricing.feature.basicAnalytics"],
  },
  pro: {
    tagline: "pricing.pro.tagline",
    cta: "pricing.pro.cta",
    features: ["pricing.feature.ai2500", "pricing.feature.channels5", "pricing.feature.users10", "pricing.feature.scenarios15", "pricing.feature.basicAnalytics"],
  },
  business: {
    tagline: "pricing.business.tagline",
    cta: "pricing.business.cta",
    features: ["pricing.feature.ai10000", "pricing.feature.channels10", "pricing.feature.users25", "pricing.feature.scenarios50", "pricing.feature.basicAnalytics"],
  },
  corporate: {
    tagline: "pricing.corporate.tagline",
    cta: "pricing.corporate.cta",
    features: ["pricing.feature.customLimits"],
  },
};

export function PricingSection() {
  const { formatNumber, t } = useI18n();

  return (
    <section id="pricing" className="scroll-mt-20 py-24 container mx-auto px-6 relative">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/50 border border-zinc-800 text-sm font-medium text-emerald-400 mb-6 backdrop-blur-sm">
          <Sparkles className="w-3.5 h-3.5" />
          {t("pricing.badge")}
        </div>
        <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">{t("pricing.title")}</h2>
        <p className="text-zinc-400 text-lg">
          {t("pricing.description")}
        </p>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-stretch">
        {plans.map((plan, i) => (
          <div
            key={plan.id}
            className={cn(
              "leadvirt-reveal-up relative flex flex-col rounded-3xl border p-8 backdrop-blur-sm",
              plan.popular
                ? "bg-gradient-to-b from-emerald-500/10 to-zinc-900/60 border-emerald-500/40 shadow-[0_0_50px_rgba(52,211,153,0.15)] xl:-translate-y-3"
                : "bg-zinc-900/40 border-zinc-800"
            )}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            {plan.popular && (
              <>
                <div className="absolute -top-px left-1/2 -translate-x-1/2 h-px w-2/3 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-3 py-1 text-xs font-bold text-zinc-950 shadow-[0_0_20px_rgba(52,211,153,0.5)]">
                    <Sparkles className="w-3.5 h-3.5" />
                    {t("pricing.popular")}
                  </span>
                </div>
              </>
            )}

            <h3 className="text-xl font-bold tracking-tight mb-1">{plan.name}</h3>
            <p className="text-sm text-zinc-400 mb-6 min-h-[40px]">{t(planCopy[plan.id].tagline)}</p>

            <div className="mb-6 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span
                  data-testid={`pricing-price-${plan.id}`}
                  className={cn(
                    "whitespace-nowrap font-bold tracking-tight",
                    plan.id === "corporate" ? "text-[22px]" : "text-4xl",
                  )}
                >
                  {plan.id === "corporate"
                    ? t("pricing.corporate.price", {
                        price: `${formatNumber(plan.priceMonthlyRub)} RUB`,
                      })
                    : `${formatNumber(plan.priceMonthlyRub)} RUB`}
                </span>
              </div>
              <span className="text-sm text-zinc-500">{t("pricing.perMonth")}</span>
            </div>

            <Button
              variant={plan.popular ? "primary" : "outline"}
              className="w-full mb-8"
              asChild
            >
              {plan.id === "corporate" && corporateContactHref ? (
                <a href={corporateContactHref} data-testid="pricing-cta-corporate">
                  {t(planCopy[plan.id].cta)}
                </a>
              ) : (
                <Link
                  href={signupHref(plan.id)}
                  prefetch={false}
                  data-testid={`pricing-cta-${plan.id}`}
                >
                  {t(planCopy[plan.id].cta)}
                </Link>
              )}
            </Button>

            <ul className="space-y-3 mt-auto">
              {planCopy[plan.id].features.map((featureKey) => (
                <li key={featureKey} className="flex items-start gap-3 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center",
                      plan.popular ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-zinc-400"
                    )}
                  >
                    <Check className="w-3 h-3" />
                  </span>
                  <span className="text-zinc-300">{t(featureKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-zinc-500 mt-10">
        {t("pricing.note")}
      </p>
    </section>
  );
}
