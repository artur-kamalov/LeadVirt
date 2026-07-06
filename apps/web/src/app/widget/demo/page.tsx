import { LeadVirtWidget } from "@/components/widget/LeadVirtWidget";

const publicKey = "demo-website-widget";

export default function WidgetDemoPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#08090b] text-zinc-50">
      <section className="container-page grid min-h-screen gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Живое демо виджета
          </div>
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-normal text-zinc-50 md:text-6xl">Виджет LeadVirt.ai для сайта</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
              Клиентский чат подключен к демо-пространству, воронке лидов, inbox и AI-ответчику LeadVirt.ai.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Сессия", "Сохраняется в браузере"],
              ["Канал", "Сайт"],
              ["AI", "Демо-ответчик"]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{value}</p>
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
              <span className="ml-3 text-xs text-zinc-500">studio-leto.local</span>
            </div>
          </div>
          <div className="grid gap-6 p-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6 pr-20 sm:pr-6">
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Запись в студию</p>
              <h2 className="mt-3 text-2xl font-semibold text-zinc-50">Запись, цены и сбор лида в одном чате</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Страница выглядит как сайт бизнеса, а чат проходит локальный demo-сценарий без записи в базу.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {["Окрашивание", "Детейлинг", "Консультация", "Заказ товара"].map((item) => (
                <div key={item} className="rounded-lg border border-white/10 bg-zinc-900/70 p-4">
                  <p className="text-sm font-medium text-zinc-100">{item}</p>
                  <div className="mt-3 h-2 w-3/4 rounded-full bg-white/10" />
                  <div className="mt-2 h-2 w-1/2 rounded-full bg-white/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <LeadVirtWidget publicKey={publicKey} />
    </main>
  );
}
