"use client";

import { LeadVirtWidget } from "@/components/widget/LeadVirtWidget";
import { useI18n } from "@/i18n/I18nProvider";
import { widgetMessage, type WidgetMessageKey } from "@/i18n/widget-messages";

const publicKey = "demo-website-widget";

export default function WidgetDemoPage() {
  const { locale } = useI18n();
  const t = (key: WidgetMessageKey) => widgetMessage(locale, key);
  const stats: Array<[WidgetMessageKey, WidgetMessageKey]> = [
    ["widget.demo.stat.session", "widget.demo.stat.sessionValue"],
    ["widget.demo.stat.channel", "widget.demo.stat.channelValue"],
    ["widget.demo.stat.ai", "widget.demo.stat.aiValue"],
  ];
  const services: WidgetMessageKey[] = [
    "widget.demo.service.coloring",
    "widget.demo.service.detailing",
    "widget.demo.service.consultation",
    "widget.demo.service.order",
  ];

  return (
    <main
      lang={locale}
      data-testid="widget-demo"
      data-widget-demo-locale={locale}
      className="min-h-screen overflow-x-hidden bg-[#08090b] text-zinc-50"
    >
      <section className="container-page grid min-h-screen gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            {t("widget.demo.badge")}
          </div>
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-normal text-zinc-50 md:text-6xl">
              {t("widget.demo.title")}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
              {t("widget.demo.description")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map(([labelKey, valueKey]) => (
              <div
                key={labelKey}
                className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-4"
              >
                <p className="text-xs text-zinc-400">{t(labelKey)}</p>
                <p className="mt-1 break-words text-sm font-semibold text-zinc-100">
                  {t(valueKey)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative min-h-[560px] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40">
          <div className="border-b border-white/10 bg-zinc-900/80 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-400" />
              <span className="h-3 w-3 rounded-full bg-amber-300" />
              <span className="h-3 w-3 rounded-full bg-emerald-300" />
              <span className="ml-3 text-xs text-zinc-400">studio-leto.local</span>
            </div>
          </div>
          <div className="grid gap-6 p-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6 pr-20 sm:pr-6">
              <p className="text-xs uppercase tracking-normal text-emerald-300">
                {t("widget.demo.preview.eyebrow")}
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-zinc-50">
                {t("widget.demo.preview.title")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {t("widget.demo.preview.description")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((itemKey) => (
                <div
                  key={itemKey}
                  className="min-w-0 rounded-lg border border-white/10 bg-zinc-900/70 p-4"
                >
                  <p className="break-words text-sm font-medium text-zinc-100">{t(itemKey)}</p>
                  <div className="mt-3 h-2 w-3/4 rounded-full bg-white/10" />
                  <div className="mt-2 h-2 w-1/2 rounded-full bg-white/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <LeadVirtWidget publicKey={publicKey} demoLocale={locale} />
    </main>
  );
}
