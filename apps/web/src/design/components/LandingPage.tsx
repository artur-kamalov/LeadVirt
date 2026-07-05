import Link from "next/link";
import { 
  Bot, 
  MessageCircle, 
  Zap, 
  LineChart, 
  ChevronRight,
} from "lucide-react";
import { GlowBg } from "./ui/GlowBg";
import { Button } from "./ui/Button";
import { HeroVisual } from "./HeroVisual";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { LandingHeader } from "./LandingHeader";
import { DeferredNichesSection } from "./DeferredNichesSection";
import { PricingSection } from "./PricingSection";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30 selection:text-emerald-200 overflow-x-hidden">
      <GlowBg />
      
      <LandingHeader />

      <main className="relative z-10 pt-32 pb-20">
        
        {/* Global Page Background for sections below Hero */}
        <div className="absolute top-[1040px] inset-x-0 bottom-0 pointer-events-none overflow-hidden -z-10">
          {/* Subtle Grid that fades in after hero */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:linear-gradient(to_bottom,transparent_0%,black_10%,black_90%,transparent_100%)]" />
          
          {/* Central vertical connecting line */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/5 to-transparent transform -translate-x-1/2" />
          
          {/* Scattered glowing ambient orbs */}
          <div className="leadvirt-section-ambient leadvirt-section-ambient-indigo absolute top-[15%] right-[-10%] w-[40rem] h-[40rem]" />
          <div className="leadvirt-section-ambient leadvirt-section-ambient-emerald absolute top-[45%] left-[-10%] w-[50rem] h-[50rem]" />
          <div className="leadvirt-section-ambient leadvirt-section-ambient-teal absolute top-[75%] right-[0%] w-[30rem] h-[30rem]" />
        </div>

        {/* HERO SECTION */}
        <section className="container mx-auto px-6 pt-10 pb-24 lg:pt-20 lg:pb-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            <div
              className="leadvirt-hero-copy-enter max-w-2xl"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/70 border border-zinc-800 text-sm font-medium text-emerald-400 mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Новый стандарт обработки лидов
              </div>
              <h1 className="text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
                AI-администратор для <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400">заявок</span> и сообщений
              </h1>
              <p className="text-lg text-zinc-400 mb-8 leading-relaxed max-w-xl">
                Отвечает 24/7, квалифицирует клиентов, записывает на услуги, помогает с заказами и передаёт заявки в CRM. Идеальный сотрудник, который никогда не спит.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                <Button size="lg" className="h-10 w-full sm:w-auto group" asChild>
                  <Link href="/onboarding" prefetch={false} className="leading-none">
                    Попробовать бесплатно
                    <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="h-10 w-full sm:w-auto" asChild>
                  <Link href="/demo" prefetch={false} className="leading-none">Смотреть демо</Link>
                </Button>
              </div>
            </div>

            <div
              className="leadvirt-hero-visual-enter"
            >
              <HeroVisual />
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="leadvirt-deferred-paint py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-zinc-900/20 border-y border-white/5" />
          <div className="container mx-auto px-6 relative">
            <div className="leadvirt-reveal-up text-center max-w-2xl mx-auto mb-20">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Как это работает</h2>
              <p className="text-zinc-400">Полностью автономный процесс от первого сообщения до записи в вашей системе.</p>
            </div>

            <div className="relative">
              {/* Animated Path Line (Desktop) */}
              <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-[2px] bg-zinc-800/50 z-0 rounded-full overflow-hidden">
                <div className="leadvirt-how-path-sheen absolute top-0 bottom-0 left-0 bg-gradient-to-r from-transparent via-emerald-400 to-transparent w-[40%]" />
              </div>

              <div className="grid md:grid-cols-4 gap-8 relative z-10">
                {[
                  { step: "01", title: "Клиент пишет", desc: "В любой удобный канал: Telegram, WhatsApp, Instagram или виджет на сайте." },
                  { step: "02", title: "AI уточняет", desc: "Задает правильные вопросы, квалифицирует лида и подбирает услугу." },
                  { step: "03", title: "Создаёт запись", desc: "Оформляет заказ или бронирует время в вашем календаре." },
                  { step: "04", title: "Готовый результат", desc: "Команда видит структурированную заявку в CRM или дашборде." }
                ].map((item, i) => (
                  <div
                    key={i} 
                    className="leadvirt-reveal-up relative group"
                    style={{ animationDelay: `${0.12 + i * 0.12}s` }}
                  >
                    <div className="flex flex-col items-center text-center">
                      {/* Node */}
                      <div
                        className="w-20 h-20 mb-8 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center text-xl font-bold text-zinc-500 group-hover:text-emerald-400 group-hover:border-emerald-500/50 group-hover:bg-emerald-500/10 group-hover:shadow-[0_0_30px_rgba(52,211,153,0.2)] group-hover:-translate-y-1 group-hover:scale-105 transition-all duration-300 relative z-10"
                      >
                        <div className="absolute inset-0 rounded-2xl border-2 border-emerald-500/0 group-hover:border-emerald-500/20 transition-colors" />
                        
                        <div className="leadvirt-step-dot-pulse absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.8)] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                        {item.step}
                      </div>
                      
                      {/* Content Card */}
                      <div className="bg-zinc-900/40 border border-zinc-800/50 p-6 rounded-3xl group-hover:bg-zinc-900/80 group-hover:border-zinc-700/80 transition-colors duration-300 w-full h-full">
                        <h3 className="text-xl font-semibold mb-3 text-zinc-100">{item.title}</h3>
                        <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <DeferredNichesSection />

        {/* FEATURES (BENTO GRID) */}
        <section id="features" className="leadvirt-deferred-paint py-24 container mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Что умеет AI Администратор</h2>
            <p className="text-zinc-400 text-lg">Заменяет целый отдел обработки входящих обращений.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 auto-rows-[280px]">
            {/* Feature 1 */}
            <div className="md:col-span-2 rounded-3xl bg-zinc-900 border border-zinc-800 p-8 flex flex-col justify-between overflow-hidden relative group">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-30 transition-opacity duration-500">
                <ImageWithFallback 
                  src="https://images.unsplash.com/photo-1710438399422-2fca27686bcd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbW9kZXJuJTIwYWJzdHJhY3QlMjBiYWNrZ3JvdW5kfGVufDF8fHx8MTc4MTczOTMxOHww&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="Texture"
                  className="w-full h-full object-cover grayscale"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-transparent to-transparent" />
              </div>
              <div className="leadvirt-card-glow-emerald absolute right-0 top-0 w-64 h-64 rounded-full pointer-events-none" />
              <div className="relative z-10 max-w-sm">
                <Zap className="w-8 h-8 text-emerald-400 mb-4" />
                <h3 className="text-2xl font-bold mb-2">Ответы 24/7</h3>
                <p className="text-zinc-400">Мгновенные ответы ночью, в выходные и праздники. Ни один клиент не уйдет к конкурентам из-за долгого ожидания.</p>
              </div>
              <div className="relative z-10 mt-6 bg-zinc-950/80 backdrop-blur rounded-2xl p-4 border border-white/5 max-w-sm">
                <div className="flex gap-3 items-center text-sm text-zinc-300">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Среднее время ответа: 18 сек</span>
                </div>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-8 flex flex-col justify-between relative group overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-500">
                <ImageWithFallback 
                  src="https://images.unsplash.com/photo-1678366633407-7f49da199a42?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGRhcmslMjAzZCUyMHNoYXBlc3xlbnwxfHx8fDE3ODE3MzkzMTV8MA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="3D Shapes"
                  className="w-full h-full object-cover grayscale"
                />
              </div>
              <div className="relative z-10">
                <MessageCircle className="w-8 h-8 text-blue-400 mb-4" />
                <h3 className="text-xl font-bold mb-2">Квалификация лидов</h3>
                <p className="text-zinc-400 text-sm">Сам задаст нужные вопросы и отсеет нецелевые обращения.</p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-8 flex flex-col justify-between relative group overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-500">
                <ImageWithFallback 
                  src="https://images.unsplash.com/photo-1678366633407-7f49da199a42?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGRhcmslMjAzZCUyMHNoYXBlc3xlbnwxfHx8fDE3ODE3MzkzMTV8MA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="3D Shapes"
                  className="w-full h-full object-cover grayscale"
                />
              </div>
              <div className="relative z-10">
                <Bot className="w-8 h-8 text-purple-400 mb-4" />
                <h3 className="text-xl font-bold mb-2">Повторные касания</h3>
                <p className="text-zinc-400 text-sm">Напомнит о записи или предложит повторить заказ через месяц.</p>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="md:col-span-2 rounded-3xl bg-zinc-900 border border-zinc-800 p-8 flex flex-col justify-between relative group overflow-hidden">
              <div className="absolute inset-0 opacity-0 group-hover:opacity-30 transition-opacity duration-500">
                <ImageWithFallback 
                  src="https://images.unsplash.com/photo-1678366633407-7f49da199a42?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGRhcmslMjAzZCUyMHNoYXBlc3xlbnwxfHx8fDE3ODE3MzkzMTV8MA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="3D Shapes"
                  className="w-full h-full object-cover grayscale"
                />
                <div className="absolute inset-0 bg-gradient-to-l from-zinc-900 via-transparent to-transparent" />
              </div>
              <div className="leadvirt-card-glow-indigo absolute left-0 bottom-0 w-64 h-64 rounded-full pointer-events-none" />
              <div className="relative z-10 max-w-md">
                <LineChart className="w-8 h-8 text-indigo-400 mb-4" />
                <h3 className="text-2xl font-bold mb-2">Передача в CRM и Аналитика</h3>
                <p className="text-zinc-400">Вся история переписки, теги, контакты и записи автоматически попадают в вашу CRM-систему (AmoCRM, Bitrix24, Yclients и др.)</p>
              </div>
            </div>
          </div>
        </section>

        {/* METRICS */}
        <section className="leadvirt-deferred-paint py-20 border-y border-white/5 bg-zinc-900/30">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 divide-x divide-white/5">
              {[
                { val: "18 сек", label: "Среднее время ответа" },
                { val: "+28%", label: "Конверсия в запись" },
                { val: "1 248", label: "Обработанных лидов" },
                { val: "20+", label: "Готовых интеграций" }
              ].map((metric, i) => (
                <div key={i} className={`flex flex-col items-center justify-center text-center ${i === 0 || i === 2 ? 'pl-0' : 'pl-8'} ${i === 1 || i === 3 ? 'pr-0' : 'pr-8'} border-l-0 md:border-l first:border-l-0 border-white/5`}>
                  <div className="text-4xl md:text-5xl font-bold text-white mb-2">{metric.val}</div>
                  <div className="text-sm text-zinc-400 uppercase tracking-wider">{metric.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING */}
        <PricingSection />

        {/* CTA SECTION */}
        <section className="leadvirt-deferred-paint py-32 container mx-auto px-6 relative">
          <div className="leadvirt-cta-section-glow absolute inset-0 -z-10" />
          <div className="max-w-4xl mx-auto text-center bg-zinc-900 border border-zinc-800 rounded-[3rem] p-12 md:p-20 relative overflow-hidden group">
            <div className="absolute inset-0 opacity-20 mix-blend-screen pointer-events-none group-hover:scale-105 transition-transform duration-1000">
              <ImageWithFallback 
                src="https://images.unsplash.com/photo-1710438399422-2fca27686bcd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbW9kZXJuJTIwYWJzdHJhY3QlMjBiYWNrZ3JvdW5kfGVufDF8fHx8MTc4MTczOTMxOHww&ixlib=rb-4.1.0&q=80&w=1080"
                alt="Dark background"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/80 to-zinc-900/40" />
            
            <div className="leadvirt-cta-card-glow absolute -top-40 -right-40 w-80 h-80 rounded-full pointer-events-none" />
            
            <div className="relative z-10">
              <h2 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">Не теряйте клиентов, <br/>пока команда занята</h2>
              <p className="text-xl text-zinc-400 mb-10 max-w-2xl mx-auto">
                Подключите AI Администратора сегодня и начните конвертировать каждое сообщение в выручку.
              </p>
              <Button size="lg" className="h-16 px-10 text-lg w-full sm:w-auto shadow-[0_0_40px_rgba(52,211,153,0.3)]" asChild>
                <Link href="/onboarding" prefetch={false}>Подключить AI Администратора</Link>
              </Button>
              <p className="text-sm text-zinc-500 mt-6">Бесплатный тестовый период 7 дней. Привязка карты не требуется.</p>
            </div>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="border-t border-white/5 py-12 bg-zinc-950">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" />
            <span className="text-lg font-bold tracking-tight">AI Администратор</span>
          </div>
          <p className="text-zinc-500 text-sm">© 2026 AI Администратор. Все права защищены.</p>
        </div>
      </footer>
    </div>
  );
}
