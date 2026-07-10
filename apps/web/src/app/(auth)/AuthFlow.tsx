"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { Toaster, toast } from "sonner";
import { getTelegramLoginConfig, loginWithTelegram, type TelegramAuthPayload } from "@/lib/api/auth";
import { BrandMark } from "@/design/components/BrandMark";
import { Button } from "@/design/components/ui/Button";

type AuthMode = "login" | "signup";

const modeCopy: Record<
  AuthMode,
  {
    title: string;
    subtitle: string;
    primaryAction: string;
    secondaryHref: string;
    secondaryText: string;
    secondaryAction: string;
  }
> = {
  login: {
    title: "Вход в LeadVirt.ai",
    subtitle: "Войдите через Telegram, чтобы открыть рабочий кабинет.",
    primaryAction: "Войти через Telegram",
    secondaryHref: "/signup",
    secondaryText: "Новый аккаунт?",
    secondaryAction: "Зарегистрироваться"
  },
  signup: {
    title: "Запуск LeadVirt.ai",
    subtitle: "Создайте workspace через Telegram и перейдите к настройке.",
    primaryAction: "Продолжить через Telegram",
    secondaryHref: "/login",
    secondaryText: "Уже есть доступ?",
    secondaryAction: "Войти"
  }
};

const highlights = ["Без пароля", "Подписанный Telegram вход", "Workspace из БД"];
const telegramWidgetScriptSrc = "https://telegram.org/js/telegram-widget.js?22";
const allowLocalTelegramMock = process.env.NODE_ENV !== "production";

declare global {
  interface Window {
    __leadvirtTelegramAuth?: (payload: unknown) => void;
  }
}

function normalizeTelegramBotUsername(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "") ?? "";
  return /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(normalized) ? normalized : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTelegramWidgetPayload(value: unknown): TelegramAuthPayload | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const id = Number(data.id);
  const authDate = Number(data.auth_date);
  const hash = optionalString(data.hash);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(authDate) || !hash) return null;
  return {
    id,
    first_name: optionalString(data.first_name),
    last_name: optionalString(data.last_name),
    username: optionalString(data.username),
    photo_url: optionalString(data.photo_url),
    auth_date: authDate,
    hash
  };
}

function mountTelegramWidget(host: HTMLDivElement, botUsername: string) {
  host.innerHTML = "";
  const script = document.createElement("script");
  script.src = telegramWidgetScriptSrc;
  script.async = true;
  script.setAttribute("data-telegram-login", botUsername);
  script.setAttribute("data-size", "large");
  script.setAttribute("data-userpic", "false");
  script.setAttribute("data-radius", "12");
  script.setAttribute("data-request-access", "write");
  script.setAttribute("data-lang", "ru");
  script.setAttribute("data-onauth", "window.__leadvirtTelegramAuth(user)");
  host.appendChild(script);
}

function TelegramLoginButton({
  label,
  loading,
  onAuth
}: {
  label: string;
  loading: boolean;
  onAuth: (payload: TelegramAuthPayload) => void;
}) {
  const [telegramBotUsername, setTelegramBotUsername] = React.useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = React.useState(false);
  const widgetHostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    window.__leadvirtTelegramAuth = (rawPayload) => {
      const payload = normalizeTelegramWidgetPayload(rawPayload);
      if (!payload) {
        toast.error("Telegram вернул некорректный ответ");
        return;
      }
      onAuth(payload);
    };
    return () => {
      delete window.__leadvirtTelegramAuth;
    };
  }, [onAuth]);

  React.useEffect(() => {
    let cancelled = false;
    const publicBotUsername = normalizeTelegramBotUsername(process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT);
    getTelegramLoginConfig()
      .then((config) => {
        if (cancelled) return;
        setTelegramBotUsername(normalizeTelegramBotUsername(config.botUsername) ?? publicBotUsername);
        setConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setTelegramBotUsername(publicBotUsername);
          setConfigLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const host = widgetHostRef.current;
    if (!host || !telegramBotUsername) return;
    mountTelegramWidget(host, telegramBotUsername);
    return () => {
      host.innerHTML = "";
    };
  }, [telegramBotUsername]);

  if (allowLocalTelegramMock && configLoaded && !telegramBotUsername) {
    return (
      <Button
        type="button"
        data-testid="telegram-auth-button"
        className="h-12 w-full rounded-2xl text-sm font-semibold"
        disabled={loading}
        onClick={() => {
          onAuth({
            id: 100000001,
            first_name: "Local",
            last_name: "Telegram",
            username: "leadvirt_local",
            auth_date: Math.floor(Date.now() / 1000),
            hash: "local-playwright-mock"
          });
        }}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {label}
      </Button>
    );
  }

  const statusText = !configLoaded
    ? "Готовим Telegram Login..."
    : !telegramBotUsername
      ? "Telegram bot username не задан на API."
      : "";

  return (
    <div className="space-y-3 text-center">
      {configLoaded && telegramBotUsername ? (
        <div className="relative mx-auto h-12 w-[238px] max-w-full">
          <div
            data-testid="telegram-auth-button"
            ref={widgetHostRef}
            aria-label={label}
            className="absolute inset-0 z-10 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:opacity-0"
          />
          <div
            aria-hidden="true"
            data-testid="telegram-brand-button"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-950/30"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {label}
          </div>
        </div>
      ) : null}
      {loading ? (
        <p className="flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Проверяем Telegram...
        </p>
      ) : null}
      {statusText ? <p className="text-xs text-zinc-500">{statusText}</p> : null}
    </div>
  );
}

export function AuthFlow({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const copy = modeCopy[mode];
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleTelegramAuth = React.useCallback(
    async (payload: TelegramAuthPayload) => {
      setError("");
      setLoading(true);

      try {
        const me = await loginWithTelegram(payload);
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("leadvirt.demo.session");
          window.localStorage.setItem(
            "leadvirt.auth.session",
            JSON.stringify({
              email: me.email,
              phone: me.phone,
              name: me.name,
              tenantId: me.tenantId,
              role: me.role,
              authMode: me.authMode,
              expiresAt: me.expiresAt,
              passwordChangeRequired: me.passwordChangeRequired
            })
          );
        }

        toast.success(me.isNewUser ? "Workspace создан" : "Добро пожаловать");
        router.push(mode === "signup" || me.isNewUser ? "/onboarding" : "/app");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось войти через Telegram");
      } finally {
        setLoading(false);
      }
    },
    [mode, router]
  );
  const handleTelegramAuthStart = React.useCallback(
    (payload: TelegramAuthPayload) => {
      void handleTelegramAuth(payload);
    },
    [handleTelegramAuth]
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-50">
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!rounded-2xl !border !border-white/10 !bg-zinc-900 !text-zinc-100 !shadow-2xl",
            description: "!text-zinc-400",
            actionButton: "!bg-emerald-400 !text-zinc-950",
            cancelButton: "!bg-white/10 !text-zinc-300"
          }
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
        <div className="absolute -top-32 right-[8%] h-[32rem] w-[32rem] rounded-full bg-emerald-500/10 blur-[140px]" />
        <div className="absolute bottom-[-12rem] left-[10%] h-[36rem] w-[36rem] rounded-full bg-indigo-500/10 blur-[160px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="h-9 w-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight">AI Администратор</span>
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">На сайт</Link>
          </Button>
        </header>

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1fr_440px] lg:gap-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="hidden lg:block"
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">
              <Sparkles className="h-4 w-4" />
              LeadVirt.ai workspace
            </div>
            <h1 className="max-w-2xl text-5xl font-bold leading-tight tracking-tight">
              AI-администратор уже принимает заявки и ведёт диалоги.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
              Вход без пароля: Telegram подтверждает личность, LeadVirt открывает tenant workspace.
            </p>
            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
              {highlights.map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <CheckCircle2 className="mb-3 h-5 w-5 text-emerald-400" />
                  <p className="text-sm font-semibold text-zinc-100">{item}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05, ease: "easeOut" }}
            className="mx-auto w-full max-w-md"
          >
            <div className="rounded-[2rem] border border-white/10 bg-zinc-900/70 p-5 shadow-2xl shadow-emerald-950/20 backdrop-blur-xl sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-zinc-50">{copy.title}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{copy.subtitle}</p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                </div>
              </div>

              <div className="space-y-4">
                <TelegramLoginButton label={copy.primaryAction} loading={loading} onAuth={handleTelegramAuthStart} />

                {error ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {error}
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-500">
                <span>{copy.secondaryText}</span>
                <Link className="font-semibold text-emerald-400 hover:text-emerald-300" href={copy.secondaryHref}>
                  {copy.secondaryAction}
                </Link>
              </div>
            </div>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
