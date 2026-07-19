import { PrismaClient } from "@leadvirt/db";
import { loadEnvFile } from "@leadvirt/config";

loadEnvFile();

const apiBase = (process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api").replace(/\/$/, "");
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const email = `email-otp-${suffix}@example.com`;
const prisma = new PrismaClient();
const qaHeaders = { "content-type": "application/json", "x-leadvirt-qa": "playwright" };

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, init);
  const payload = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    message?: unknown;
  } | null;
  return { response, payload };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, memberships: { select: { tenantId: true } } },
  });
  if (user?.memberships.length) {
    await prisma.tenant.deleteMany({
      where: { id: { in: user.memberships.map((membership) => membership.tenantId) } },
    });
  }
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.authEmailOtpChallenge.deleteMany({ where: { email } });
}

async function main() {
  await cleanup();
  try {
    const telegramConfig = await request("/auth/telegram/config");
    assert(telegramConfig.response.ok, "Disabled Telegram auth config must remain readable.");
    assert(
      telegramConfig.payload?.data?.enabled === false &&
        telegramConfig.payload.data.botId === null &&
        telegramConfig.payload.data.botUsername === null,
      "Telegram auth config must be disabled without exposing bot identifiers.",
    );

    const telegramLogin = await request("/auth/telegram", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({
        id: 100000001,
        first_name: "Disabled",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "0".repeat(64),
      }),
    });
    assert(
      telegramLogin.response.status === 404,
      `Disabled Telegram login should return 404, received ${telegramLogin.response.status}.`,
    );

    const telegramOidcLogin = await request("/auth/telegram/oidc", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ idToken: "disabled.telegram.oidc.token" }),
    });
    assert(
      telegramOidcLogin.response.status === 404,
      `Disabled Telegram OIDC login should return 404, received ${telegramOidcLogin.response.status}.`,
    );

    const config = await request("/auth/email-otp/config");
    assert(
      config.response.ok && config.payload?.data?.enabled === true,
      "Email OTP must be enabled for the local mock smoke.",
    );

    const first = await request("/auth/email-otp/request", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ email, locale: "en" }),
    });
    assert(first.response.ok, `OTP request failed with ${first.response.status}.`);
    const challengeId = first.payload?.data?.challengeId;
    const code = first.payload?.data?.debugCode;
    assert(
      typeof challengeId === "string" && challengeId.length === 48,
      "OTP request did not return a valid challenge id.",
    );
    assert(
      typeof code === "string" && /^\d{6}$/.test(code),
      "Local mock OTP request did not expose a six-digit debug code.",
    );

    const resend = await request("/auth/email-otp/request", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ email, locale: "en" }),
    });
    assert(
      resend.response.status === 429,
      `Immediate OTP resend should return 429, received ${resend.response.status}.`,
    );

    const wrong = await request("/auth/email-otp/verify", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ challengeId, code: code === "000000" ? "111111" : "000000" }),
    });
    assert(
      wrong.response.status === 401,
      `Wrong OTP should return 401, received ${wrong.response.status}.`,
    );

    const verified = await request("/auth/email-otp/verify", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ challengeId, code }),
    });
    assert(verified.response.ok, `Valid OTP failed with ${verified.response.status}.`);
    assert(
      verified.payload?.data?.authMode === "email",
      "OTP verification did not return authMode=email.",
    );
    assert(
      verified.payload?.data?.isNewUser === true,
      "First OTP verification should create a new workspace.",
    );
    const cookie = verified.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert(
      cookie?.startsWith("leadvirt_session="),
      "OTP verification did not set the session cookie.",
    );

    const postVerificationResend = await request("/auth/email-otp/request", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ email, locale: "en" }),
    });
    assert(
      postVerificationResend.response.status === 429,
      `Consumed OTP must retain the database resend lock, received ${postVerificationResend.response.status}.`,
    );

    const me = await request("/auth/me", { headers: { cookie } });
    assert(
      me.response.ok && me.payload?.data?.authMode === "email",
      "Email auth mode was not preserved by /auth/me.",
    );

    const replay = await request("/auth/email-otp/verify", {
      method: "POST",
      headers: qaHeaders,
      body: JSON.stringify({ challengeId, code }),
    });
    assert(
      replay.response.status === 401,
      `Consumed OTP should return 401, received ${replay.response.status}.`,
    );

    console.log(JSON.stringify({ ok: true, checks: 11 }));
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
