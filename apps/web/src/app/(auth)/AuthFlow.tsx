"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { getEmailOtpConfig, requestEmailOtp, verifyEmailOtp, type AuthMe } from "@/lib/api/auth";
import { BrandMark } from "@/design/components/BrandMark";
import { LanguageSwitcher } from "@/design/components/LanguageSwitcher";
import { BrandWordmark } from "@/design/components/BrandWordmark";
import { Button } from "@/design/components/ui/Button";
import { cn } from "@/design/lib/utils";
import { plans } from "@/design/product/plans";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/messages";
import { authHref, resolveAcquisitionIntent, type AcquisitionIntent } from "@/lib/acquisition";

type AuthMode = "login" | "signup";

const modeCopyKeys: Record<
  AuthMode,
  {
    title: TranslationKey;
    subtitle: TranslationKey;
    secondaryHref: string;
    secondaryText: TranslationKey;
    secondaryAction: TranslationKey;
  }
> = {
  login: {
    title: "auth.login.title",
    subtitle: "auth.login.subtitle",
    secondaryHref: "/signup",
    secondaryText: "auth.login.secondaryText",
    secondaryAction: "auth.login.secondaryAction",
  },
  signup: {
    title: "auth.signup.title",
    subtitle: "auth.signup.subtitle",
    secondaryHref: "/login",
    secondaryText: "auth.signup.secondaryText",
    secondaryAction: "auth.signup.secondaryAction",
  },
};

const highlightKeys: TranslationKey[] = [
  "auth.highlight.passwordless",
  "auth.highlight.email",
  "auth.highlight.database",
];

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 180;
}

function OtpCodeInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
}) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

  const replaceFrom = (index: number, input: string) => {
    const inserted = input.replace(/\D/g, "");
    if (!inserted) {
      const next = digits.slice();
      next[index] = "";
      onChange(next.join(""));
      return;
    }

    const next = digits.slice();
    inserted
      .slice(0, 6 - index)
      .split("")
      .forEach((digit, offset) => {
        next[index + offset] = digit;
      });
    const normalized = next.join("").slice(0, 6);
    onChange(normalized);
    refs.current[Math.min(index + inserted.length, 5)]?.focus();
  };

  return (
    <div className="grid grid-cols-6 gap-2" data-testid="email-otp-code-input">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`${label} ${index + 1}`}
          onChange={(event) => replaceFrom(index, event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            replaceFrom(index, event.clipboardData.getData("text"));
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digit && index > 0) {
              refs.current[index - 1]?.focus();
            }
            if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
            if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
          }}
          className="h-12 min-w-0 rounded-md border border-white/10 bg-zinc-950/80 text-center text-lg font-bold text-zinc-50 outline-none transition-colors focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-60"
        />
      ))}
    </div>
  );
}

export function AuthFlow({ mode, intent }: { mode: AuthMode; intent?: AcquisitionIntent }) {
  const { formatCurrency, locale, t } = useI18n();
  const router = useRouter();
  const copyKeys = modeCopyKeys[mode];
  const copy = {
    title: t(copyKeys.title),
    subtitle: t(copyKeys.subtitle),
    secondaryHref: authHref(copyKeys.secondaryHref as "/login" | "/signup", intent),
    secondaryText: t(copyKeys.secondaryText),
    secondaryAction: t(copyKeys.secondaryAction),
  };
  const [emailOtpStatus, setEmailOtpStatus] = React.useState<
    "loading" | "enabled" | "disabled" | "error"
  >("loading");
  const [emailStep, setEmailStep] = React.useState<"address" | "code">("address");
  const [email, setEmail] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [challengeId, setChallengeId] = React.useState("");
  const [code, setCode] = React.useState("");
  const [resendSeconds, setResendSeconds] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const emailOtpConfigRequestRef = React.useRef(0);
  const acquisition = resolveAcquisitionIntent(intent);
  const selectedPlan = acquisition.plan
    ? (plans.find((plan) => plan.id === acquisition.plan) ?? null)
    : null;
  const selectedPlanPrice = selectedPlan
    ? selectedPlan.id === "corporate"
      ? t("pricing.corporate.price", {
          price: formatCurrency(selectedPlan.priceMonthlyRub),
        })
      : formatCurrency(selectedPlan.priceMonthlyRub)
    : null;
  const emailValid = isValidEmail(email);
  const showEmailValidation = emailTouched && Boolean(email.trim()) && !emailValid;

  const loadEmailOtpConfig = React.useCallback(async () => {
    const requestId = emailOtpConfigRequestRef.current + 1;
    emailOtpConfigRequestRef.current = requestId;
    setEmailOtpStatus("loading");
    try {
      const config = await getEmailOtpConfig();
      if (emailOtpConfigRequestRef.current !== requestId) return;
      setEmailOtpStatus(config.enabled ? "enabled" : "disabled");
    } catch {
      if (emailOtpConfigRequestRef.current === requestId) {
        setEmailOtpStatus("error");
      }
    }
  }, []);

  React.useEffect(() => {
    void loadEmailOtpConfig();
  }, [loadEmailOtpConfig]);

  React.useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const completeAuth = React.useCallback(
    (me: AuthMe) => {
      window.localStorage.removeItem("leadvirt.demo.session");
      window.localStorage.removeItem("leadvirt.auth.session");
      toast.success(me.isNewUser ? t("auth.toast.created") : t("auth.toast.welcome"));
      router.push(acquisition.returnTo ?? (me.isNewUser ? "/onboarding" : "/app"));
    },
    [acquisition.returnTo, router, t],
  );

  const requestCode = React.useCallback(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) return;
    setError("");
    setLoading(true);
    try {
      const response = await requestEmailOtp({ email: normalizedEmail, locale });
      setEmail(normalizedEmail);
      setChallengeId(response.challengeId);
      setCode(response.debugCode ?? "");
      setEmailStep("code");
      setResendSeconds(response.resendAfterSeconds);
      toast.success(t("auth.email.sent"));
    } catch {
      setError(t("auth.email.requestError"));
    } finally {
      setLoading(false);
    }
  }, [email, locale, t]);

  const handleEmailRequest = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setEmailTouched(true);
      if (!emailValid) return;
      void requestCode();
    },
    [emailValid, requestCode],
  );

  const handleEmailVerify = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!challengeId || code.length !== 6) return;
      setError("");
      setLoading(true);
      try {
        completeAuth(await verifyEmailOtp({ challengeId, code }));
      } catch {
        setError(t("auth.email.verifyError"));
      } finally {
        setLoading(false);
      }
    },
    [challengeId, code, completeAuth, t],
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
            cancelButton: "!bg-white/10 !text-zinc-300",
          },
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
        <div className="absolute -top-32 right-[8%] h-[32rem] w-[32rem] rounded-full bg-emerald-500/10 blur-[140px]" />
        <div className="absolute bottom-[-12rem] left-[10%] h-[36rem] w-[36rem] rounded-full bg-indigo-500/10 blur-[160px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            aria-label={t("brand.name")}
            className="flex h-11 min-w-11 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <BrandMark className="h-9 w-9 rounded-xl" />
            <BrandWordmark className="hidden text-lg sm:inline-flex" />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Button variant="ghost" size="sm" className="min-h-11" asChild>
              <Link href="/">{t("auth.website")}</Link>
            </Button>
          </div>
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
              {t("auth.hero.title")}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
              {t("auth.hero.description")}
            </p>
            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
              {highlightKeys.map((key) => (
                <div key={key} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                  <CheckCircle2 className="mb-3 h-5 w-5 text-emerald-400" />
                  <p className="text-sm font-semibold text-zinc-100">{t(key)}</p>
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

              {selectedPlan ? (
                <div
                  className="mb-4 flex min-w-0 items-center justify-between gap-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5"
                  data-testid="auth-selected-plan"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-500">{t("auth.plan.selected")}</p>
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {selectedPlan.name}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {selectedPlanPrice} {t("pricing.perMonth")}
                    </p>
                  </div>
                  <Link
                    href="/#pricing"
                    className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    {t("auth.plan.change")}
                  </Link>
                </div>
              ) : null}

              <div className="space-y-4">
                {emailOtpStatus === "loading" ? (
                  <div
                    role="status"
                    data-testid="email-otp-config-loading"
                    className="flex min-h-24 items-center justify-center text-zinc-500"
                  >
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  </div>
                ) : null}

                {emailOtpStatus === "disabled" ? (
                  <div
                    role="alert"
                    data-testid="email-otp-config-disabled"
                    className="rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                  >
                    {t("auth.email.disabled")}
                  </div>
                ) : null}

                {emailOtpStatus === "error" ? (
                  <div
                    role="alert"
                    data-testid="email-otp-config-error"
                    className="space-y-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                  >
                    <p>{t("auth.email.unavailable")}</p>
                    <button
                      type="button"
                      data-testid="email-otp-config-retry"
                      onClick={() => void loadEmailOtpConfig()}
                      className="inline-flex min-h-11 items-center font-semibold text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    >
                      {t("auth.sessionRetry")}
                    </button>
                  </div>
                ) : null}

                {emailOtpStatus === "enabled" && emailStep === "address" ? (
                  <form
                    className="space-y-4"
                    data-testid="email-otp-request-form"
                    onSubmit={handleEmailRequest}
                  >
                    <label className="block space-y-2 text-sm font-medium text-zinc-300">
                      <span>{t("auth.email.label")}</span>
                      <span className="relative block">
                        <Mail
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                          aria-hidden="true"
                        />
                        <input
                          type="email"
                          name="email"
                          autoComplete="email"
                          required
                          maxLength={180}
                          autoFocus
                          value={email}
                          disabled={loading}
                          onChange={(event) => setEmail(event.target.value)}
                          onBlur={() => setEmailTouched(true)}
                          aria-invalid={showEmailValidation}
                          aria-describedby={
                            showEmailValidation ? "email-otp-address-error" : undefined
                          }
                          placeholder={t("auth.email.placeholder")}
                          className={cn(
                            "h-12 w-full rounded-md border bg-zinc-950/80 pl-10 pr-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 focus:ring-2 disabled:opacity-60",
                            showEmailValidation
                              ? "border-amber-400/70 focus:border-amber-400 focus:ring-amber-400/20"
                              : "border-white/10 focus:border-emerald-400 focus:ring-emerald-400/20",
                          )}
                        />
                      </span>
                      {showEmailValidation ? (
                        <span
                          id="email-otp-address-error"
                          data-testid="email-otp-address-error"
                          className="block text-xs leading-5 text-amber-300"
                        >
                          {t("auth.email.invalid")}
                        </span>
                      ) : null}
                    </label>
                    <Button
                      type="submit"
                      data-testid="email-otp-request"
                      className="h-12 w-full rounded-md text-sm font-semibold"
                      disabled={loading || !emailValid}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      {loading ? t("auth.email.sending") : t("auth.email.send")}
                    </Button>
                  </form>
                ) : null}

                {emailOtpStatus === "enabled" && emailStep === "code" ? (
                  <form
                    className="space-y-4"
                    data-testid="email-otp-verify-form"
                    onSubmit={(event) => {
                      void handleEmailVerify(event);
                    }}
                  >
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                      onClick={() => {
                        setEmailStep("address");
                        setChallengeId("");
                        setCode("");
                        setResendSeconds(0);
                        setError("");
                      }}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("auth.email.change")}
                    </button>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                        <KeyRound className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                        {t("auth.email.codeLabel")}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {t("auth.email.codeHint", { email })}
                      </p>
                    </div>
                    <OtpCodeInput
                      value={code}
                      onChange={setCode}
                      disabled={loading}
                      label={t("auth.email.codeLabel")}
                    />
                    <Button
                      type="submit"
                      data-testid="email-otp-verify"
                      className="h-12 w-full rounded-md text-sm font-semibold"
                      disabled={loading || code.length !== 6}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      {loading ? t("auth.email.verifying") : t("auth.email.verify")}
                    </Button>
                    <button
                      type="button"
                      data-testid="email-otp-resend"
                      disabled={loading || resendSeconds > 0}
                      onClick={() => void requestCode()}
                      className="mx-auto flex min-h-11 items-center justify-center px-2 text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-wait disabled:text-zinc-600"
                    >
                      {resendSeconds > 0
                        ? t("auth.email.resendIn", { seconds: resendSeconds })
                        : t("auth.email.resend")}
                    </button>
                  </form>
                ) : null}

                {error ? (
                  <div
                    role="alert"
                    className="rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
                  >
                    {error}
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-500">
                <span>{copy.secondaryText}</span>
                <Link
                  className="inline-flex min-h-11 items-center px-1 font-semibold text-emerald-400 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  href={copy.secondaryHref}
                >
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
