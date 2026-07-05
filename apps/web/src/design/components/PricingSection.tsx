import React from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { plans } from "../product/plans";
import { cn } from "../lib/utils";

export function PricingSection() {
  return (
    <section id="pricing" className="leadvirt-deferred-paint py-24 container mx-auto px-6 relative">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/50 border border-zinc-800 text-sm font-medium text-emerald-400 mb-6 backdrop-blur-sm">
          <Sparkles className="w-3.5 h-3.5" />
          Прозрачные тарифы
        </div>
        <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">Выберите свой тариф</h2>
        <p className="text-zinc-400 text-lg">
          Начните с малого и масштабируйтесь по мере роста. Без скрытых платежей и долгих контрактов.
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
                    Популярный
                  </span>
                </div>
              </>
            )}

            <h3 className="text-xl font-bold tracking-tight mb-1">{plan.name}</h3>
            <p className="text-sm text-zinc-400 mb-6 min-h-[40px]">{plan.tagline}</p>

            <div className="mb-6">
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight">{plan.price}</span>
              </div>
              <span className="text-sm text-zinc-500">{plan.priceNote}</span>
            </div>

            <Button
              variant={plan.popular ? "primary" : "outline"}
              className="w-full mb-8"
              asChild
            >
              <Link href="/onboarding" prefetch={false}>{plan.cta}</Link>
            </Button>

            <ul className="space-y-3 mt-auto">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center",
                      plan.popular ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-zinc-400"
                    )}
                  >
                    <Check className="w-3 h-3" />
                  </span>
                  <span className="text-zinc-300">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-zinc-500 mt-10">
        Все тарифы включают бесплатный пробный период 7 дней. Привязка карты не требуется.
      </p>
    </section>
  );
}
