"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { motion } from "motion/react";
import { Bot, CheckCircle2, Loader2, RefreshCw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { Toaster, toast } from "sonner";
import { getTelegramLoginConfig, loginWithTelegram, loginWithTelegramOidc, logout, type TelegramAuthPayload, type TelegramOidcAuthPayload } from "@/lib/api/auth";
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
const telegramBotUsername = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT?.trim() ?? "";
const telegramOidcPopupCloseGraceMs = 8_000;

type TelegramOidcPopupResult = {
  event?: string;
  result?: string;
  error?: string;
};

function randomNonce() {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function telegramOidcAuthUrl(botId: string, nonce: string) {
  const url = new URL("https://oauth.telegram.org/auth");
  url.searchParams.set("response_type", "post_message");
  url.searchParams.set("client_id", botId);
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("redirect_uri", `${window.location.origin}/login`);
  url.searchParams.set("scope", "openid profile telegram:bot_access");
  url.searchParams.set("prompt", "login select_account");
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("lang", "ru");
  return url.toString();
}

function waitForTelegramOidcAuth(botId: string) {
  const nonce = randomNonce();
  return new Promise<TelegramOidcAuthPayload>((resolve, reject) => {
    let popup: Window | null = null;
    let finished = false;
    let closeTimer: number | null = null;
    let timeout: number | null = null;
    let popupClosedAt: number | null = null;
    const cleanup = () => {
      finished = true;
      if (closeTimer !== null) window.clearInterval(closeTimer);
      if (timeout !== null) window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    };
    const fail = (error: Error) => {
      if (finished) return;
      cleanup();
      reject(error);
    };
    const done = (idToken: string) => {
      if (finished) return;
      cleanup();
      resolve({ idToken, nonce });
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://oauth.telegram.org") return;
      let data: TelegramOidcPopupResult;
      try {
        data = typeof event.data === "string" ? (JSON.parse(event.data) as TelegramOidcPopupResult) : (event.data as TelegramOidcPopupResult);
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      if (data.event !== "auth_result") return;
      if (data.error) {
        fail(new Error(data.error));
        return;
      }
      if (typeof data.result === "string" && data.result) {
        popup?.close();
        done(data.result);
      }
    };

    window.addEventListener("message", handleMessage);
    popup = window.open(
      telegramOidcAuthUrl(botId, nonce),
      "leadvirt_telegram_oidc",
      "width=550,height=650,status=0,location=0,menubar=0,toolbar=0"
    );

    if (!popup) {
      fail(new Error("popup_blocked"));
      return;
    }
    if (finished) {
      popup.close();
      return;
    }

    popup.focus();
    closeTimer = window.setInterval(() => {
      if (!popup?.closed) {
        popupClosedAt = null;
        return;
      }
      popupClosedAt ??= Date.now();
      if (Date.now() - popupClosedAt >= telegramOidcPopupCloseGraceMs) {
        fail(new Error("popup_closed"));
      }
    }, 300);
    timeout = window.setTimeout(() => fail(new Error("timeout")), 5 * 60 * 1000);
  });
}

declare global {
  interface Window {
    leadvirtTelegramAuth?: (payload: TelegramAuthPayload) => void;
  }
}

function TelegramLoginButton({
  label,
  loading,
  onAuth,
  onOidcAuth
}: {
  label: string;
  loading: boolean;
  onAuth: (payload: TelegramAuthPayload) => void;
  onOidcAuth: (payload: TelegramOidcAuthPayload) => Promise<void> | void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [telegramBotId, setTelegramBotId] = React.useState<string | null>(null);
  const [switchingAccount, setSwitchingAccount] = React.useState(false);
  const [widgetVersion, setWidgetVersion] = React.useState(0);

  React.useEffect(() => {
    if (!telegramBotUsername) return;
    let cancelled = false;
    getTelegramLoginConfig()
      .then((config) => {
        if (!cancelled) setTelegramBotId(config.botId);
      })
      .catch(() => {
        if (!cancelled) setTelegramBotId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTelegramAccount = React.useCallback(async () => {
    if (!telegramBotId) {
      toast.error("Telegram bot id не настроен");
      return;
    }

    setSwitchingAccount(true);
    try {
      const telegramAuth = waitForTelegramOidcAuth(telegramBotId);
      window.localStorage.removeItem("leadvirt.auth.session");
      window.localStorage.removeItem("leadvirt.demo.session");
      await logout().catch(() => undefined);
      setWidgetVersion((value) => value + 1);
      const oidcPayload = await telegramAuth;
      await onOidcAuth(oidcPayload);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "popup_blocked") {
        toast.error("Браузер заблокировал окно Telegram. Разрешите всплывающие окна и попробуйте снова.");
      } else if (caught instanceof Error && caught.message === "popup_closed") {
        toast.error("Telegram закрыл окно без результата. Попробуйте ещё раз.");
      } else {
        toast.error("Не удалось войти через другой Telegram аккаунт");
      }
      setSwitchingAccount(false);
    }
  }, [onOidcAuth, telegramBotId]);

  React.useEffect(() => {
    window.leadvirtTelegramAuth = onAuth;
    const container = containerRef.current;
    if (!container || !telegramBotUsername) {
      return () => {
        delete window.leadvirtTelegramAuth;
      };
    }

    container.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", telegramBotUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "16");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-init-auth", "0");
    script.setAttribute("data-lang", "ru");
    script.setAttribute("data-min-width", "300");
    script.setAttribute("data-max-width", "360");
    script.setAttribute("data-onauth", "leadvirtTelegramAuth(user)");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete window.leadvirtTelegramAuth;
    };
  }, [onAuth, widgetVersion]);

  if (telegramBotUsername) {
    return (
      <div className="space-y-3">
        <div
          data-testid="telegram-auth-button"
          className="group relative mx-auto h-12 w-full max-w-[360px]"
        >
          <div
            ref={containerRef}
            className={[
              "absolute inset-0 z-10 flex h-12 w-full items-center justify-center",
              "[&_iframe]:!h-12 [&_iframe]:!w-full [&_iframe]:!min-w-full [&_iframe]:rounded-2xl",
              loading ? "pointer-events-none opacity-40" : ""
            ].join(" ")}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/25 bg-gradient-to-r from-emerald-400 to-teal-400 px-4 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-950/30 transition duration-200 group-hover:from-emerald-300 group-hover:to-teal-300 group-hover:shadow-emerald-900/40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="truncate">{label}</span>
          </div>
          {loading ? (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-zinc-950/45">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-100" />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          data-testid="telegram-switch-account"
          className="mx-auto flex items-center justify-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || switchingAccount || !telegramBotId}
          onClick={() => void switchTelegramAccount()}
        >
          {switchingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Другой Telegram аккаунт
        </button>
      </div>
    );
  }

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
  const handleTelegramOidcAuth = React.useCallback(
    async (payload: TelegramOidcAuthPayload) => {
      setError("");
      setLoading(true);

      try {
        const me = await loginWithTelegramOidc(payload);
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
        throw caught;
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
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600">
              <Bot className="h-5 w-5 text-zinc-950" />
            </span>
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
                <TelegramLoginButton label={copy.primaryAction} loading={loading} onAuth={handleTelegramAuthStart} onOidcAuth={handleTelegramOidcAuth} />

                {!telegramBotUsername ? (
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                    Telegram bot username не задан. Для production укажите NEXT_PUBLIC_TELEGRAM_LOGIN_BOT.
                  </div>
                ) : null}

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
