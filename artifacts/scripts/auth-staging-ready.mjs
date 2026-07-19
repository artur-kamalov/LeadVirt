import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(
  new URL("../../packages/db/package.json", import.meta.url),
);
const { PrismaClient } = requireFromDbPackage("@prisma/client");

const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/leadvirt?schema=public";
const hadExplicitDatabaseUrl = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ??= localDatabaseUrl;

const databaseUrl = process.env.DATABASE_URL;
const ownerEmail = normalizeEmail(process.env.LEADVIRT_AUTH_READY_EMAIL ?? "admin@leadvirt.ai");
const appEnv = process.env.APP_ENV ?? "local";
const nodeEnv = process.env.NODE_ENV ?? "development";
const strict =
  isTruthy(process.env.LEADVIRT_AUTH_READY_STRICT) ||
  nodeEnv === "production" ||
  ["staging", "production", "public"].includes(appEnv.toLowerCase());
const apiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const apiOrigin = apiBase.replace(/\/api$/, "");

const checks = [];

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizeBase(value) {
  return value.trim().replace(/\/$/, "");
}

function normalizeApiBase(value) {
  const cleaned = normalizeBase(value);
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function canonicalHttpsOrigin(value) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function pass(name, detail = "") {
  checks.push({ level: "PASS", name, detail });
}

function warn(name, detail = "") {
  checks.push({ level: "WARN", name, detail });
}

function fail(name, detail = "") {
  checks.push({ level: "FAIL", name, detail });
}

function requireCheck(condition, name, passDetail, failDetail = passDetail) {
  if (condition) pass(name, passDetail);
  else fail(name, failDetail);
}

function strictCheck(condition, name, passDetail, failDetail = passDetail) {
  if (condition) {
    pass(name, passDetail);
    return;
  }

  if (strict) fail(name, failDetail);
  else warn(name, failDetail);
}

function status(result) {
  if (result.ok) return `HTTP ${result.status}`;
  return result.error ? result.error : `HTTP ${result.status}`;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function checkRequiredColumns(prisma, tableName, columns) {
  const missing = [];
  for (const column of columns) {
    if (!(await columnExists(prisma, tableName, column))) {
      missing.push(column);
    }
  }

  requireCheck(
    missing.length === 0,
    `${tableName} auth columns`,
    columns.join(", "),
    missing.length ? `missing: ${missing.join(", ")}` : "missing columns",
  );
}

async function checkDatabaseSchema(prisma) {
  const databaseRows = await prisma.$queryRaw`
    SELECT current_database() AS "database", current_schema() AS "schema"
  `;
  const target = databaseRows[0];
  pass("Database connection", `${target?.database ?? "unknown"}.${target?.schema ?? "unknown"}`);

  const authSessionExists = await tableExists(prisma, "AuthSession");
  requireCheck(
    authSessionExists,
    "AuthSession table",
    "present",
    "missing; run db:migrate against this database",
  );
  if (authSessionExists) {
    await checkRequiredColumns(prisma, "AuthSession", [
      "userId",
      "tenantId",
      "tokenHash",
      "expiresAt",
      "revokedAt",
      "lastUsedAt",
      "ipAddress",
      "userAgent",
    ]);
  }

  await checkRequiredColumns(prisma, "User", [
    "passwordHash",
    "passwordChangeRequired",
    "twoFactorEnabled",
    "twoFactorSecretEncrypted",
    "twoFactorRecoveryCodes",
    "twoFactorConfirmedAt",
  ]);

  const resetTokenExists = await tableExists(prisma, "AuthPasswordResetToken");
  requireCheck(
    resetTokenExists,
    "AuthPasswordResetToken table",
    "present",
    "missing; run db:migrate against this database",
  );
  if (resetTokenExists) {
    await checkRequiredColumns(prisma, "AuthPasswordResetToken", [
      "userId",
      "tokenHash",
      "deliveryMode",
      "expiresAt",
      "usedAt",
    ]);
  }
}

async function checkSeedOwner(prisma) {
  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      passwordChangeRequired: true,
      twoFactorEnabled: true,
      memberships: {
        select: {
          role: true,
          tenant: {
            select: {
              name: true,
              slug: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  requireCheck(
    Boolean(owner),
    "Seed credential user",
    ownerEmail,
    `${ownerEmail} not found; run db:seed or create/update release credentials`,
  );
  if (!owner) return;

  requireCheck(
    Boolean(owner.passwordHash),
    "Seed user password hash",
    "present",
    "missing; user cannot log in with local credentials",
  );
  strictCheck(
    owner.passwordChangeRequired === false ||
      isTruthy(process.env.LEADVIRT_AUTH_READY_ALLOW_TEMP_PASSWORD),
    "Seed user permanent password",
    "passwordChangeRequired=false",
    "passwordChangeRequired=true; set a permanent staging password or LEADVIRT_AUTH_READY_ALLOW_TEMP_PASSWORD=1",
  );

  const activeMemberships = owner.memberships.filter((membership) => !membership.tenant.deletedAt);
  requireCheck(
    activeMemberships.length > 0,
    "Seed user tenant membership",
    `${activeMemberships.length} active membership(s)`,
    "no active tenant membership",
  );

  const privilegedMembership = activeMemberships.find((membership) =>
    ["OWNER", "ADMIN"].includes(membership.role),
  );
  requireCheck(
    Boolean(privilegedMembership),
    "Seed user workspace role",
    privilegedMembership
      ? `${privilegedMembership.role} on ${privilegedMembership.tenant.slug}`
      : "OWNER/ADMIN",
    "no OWNER/ADMIN membership",
  );

  if (owner.twoFactorEnabled) {
    pass("Seed user 2FA state", "enabled");
  } else {
    warn(
      "Seed user 2FA state",
      "disabled; enable it for shared staging/admin accounts before broad external access",
    );
  }
}

function checkEnvironment() {
  if (hadExplicitDatabaseUrl) {
    pass("DATABASE_URL", "explicitly set");
  } else {
    warn("DATABASE_URL", `not set; using local default ${localDatabaseUrl}`);
  }

  const twoFactorKey = process.env.AUTH_2FA_ENCRYPTION_KEY ?? "";
  strictCheck(
    Boolean(twoFactorKey) && !twoFactorKey.includes("dev-change-me"),
    "AUTH_2FA_ENCRYPTION_KEY",
    "configured",
    "missing or still set to the dev placeholder",
  );

  strictCheck(
    process.env.AUTH_RATE_LIMIT_DISABLED !== "true",
    "AUTH_RATE_LIMIT_DISABLED",
    "not true",
    "true; public auth endpoints are not rate limited",
  );

  const emailProvider = (process.env.EMAIL_PROVIDER ?? "mock").trim().toLowerCase();
  strictCheck(
    ["smtp", "unisender"].includes(emailProvider),
    "EMAIL_PROVIDER",
    emailProvider,
    `${emailProvider}; production password reset requires EMAIL_PROVIDER=smtp or unisender`,
  );

  const requiredEmailProviders = new Set([emailProvider]);
  strictCheck(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.INTEGRATION_REQUEST_EMAIL?.trim() ?? ""),
    "INTEGRATION_REQUEST_EMAIL",
    "configured",
    "missing or invalid; managed integration requests fail closed without an operator recipient",
  );
  const emailOtpFlag = String(process.env.AUTH_EMAIL_OTP_ENABLED ?? "")
    .trim()
    .toLowerCase();
  strictCheck(
    emailOtpFlag === "true",
    "AUTH_EMAIL_OTP_ENABLED",
    "true",
    `${emailOtpFlag || "missing"}; public email-only authentication requires explicit true`,
  );
  const telegramAuthFlag = String(process.env.AUTH_TELEGRAM_ENABLED ?? "")
    .trim()
    .toLowerCase();
  strictCheck(
    telegramAuthFlag === "false",
    "AUTH_TELEGRAM_ENABLED",
    "false",
    `${telegramAuthFlag || "missing"}; public email-only authentication requires explicit false`,
  );

  const emailOtpProvider = (process.env.EMAIL_OTP_PROVIDER ?? "mock").trim().toLowerCase();
  strictCheck(
    ["smtp", "unisender"].includes(emailOtpProvider),
    "Email OTP provider",
    emailOtpProvider,
    `${emailOtpProvider}; public email-only authentication requires EMAIL_OTP_PROVIDER=smtp or unisender in production`,
  );
  requiredEmailProviders.add(emailOtpProvider);
  strictCheck(
    (process.env.AUTH_EMAIL_OTP_PEPPER?.trim().length ?? 0) >= 32,
    "AUTH_EMAIL_OTP_PEPPER",
    "configured",
    "missing or shorter than 32 characters",
  );

  if (requiredEmailProviders.has("smtp")) {
    strictCheck(
      Boolean(process.env.SMTP_HOST?.trim()),
      "SMTP_HOST",
      process.env.SMTP_HOST ?? "missing",
      "missing",
    );
    strictCheck(
      /^\d+$/.test(process.env.SMTP_PORT?.trim() ?? "") && Number(process.env.SMTP_PORT) > 0,
      "SMTP_PORT",
      process.env.SMTP_PORT ?? "missing",
      "missing or not a positive integer",
    );
    strictCheck(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.SMTP_USER?.trim() ?? ""),
      "SMTP_USER",
      process.env.SMTP_USER ?? "missing",
      "missing or invalid",
    );
    strictCheck(Boolean(process.env.SMTP_PASSWORD), "SMTP_PASSWORD", "configured", "missing");
    strictCheck(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.SMTP_FROM_EMAIL?.trim() ?? ""),
      "SMTP_FROM_EMAIL",
      process.env.SMTP_FROM_EMAIL ?? "missing",
      "missing or invalid",
    );
  }
  if (requiredEmailProviders.has("unisender")) {
    strictCheck(
      Boolean(process.env.UNISENDER_API_KEY?.trim()),
      "UNISENDER_API_KEY",
      "configured",
      "missing",
    );
    strictCheck(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.UNISENDER_SENDER_EMAIL?.trim() ?? ""),
      "UNISENDER_SENDER_EMAIL",
      process.env.UNISENDER_SENDER_EMAIL ?? "missing",
      "missing or invalid; sender verification must also be completed in UniSender",
    );
    strictCheck(
      /^\d+$/.test(process.env.UNISENDER_LIST_ID?.trim() ?? "") &&
        Number(process.env.UNISENDER_LIST_ID) > 0,
      "UNISENDER_LIST_ID",
      process.env.UNISENDER_LIST_ID ?? "missing",
      "missing or not a positive integer",
    );
  }

  strictCheck(
    nodeEnv === "production",
    "NODE_ENV",
    nodeEnv,
    `${nodeEnv}; production cookie/reset behavior is not active`,
  );

  const appOrigin = canonicalHttpsOrigin(process.env.APP_URL);
  const expectedAppOrigin = canonicalHttpsOrigin(process.env.NEXT_PUBLIC_APP_URL);
  strictCheck(
    Boolean(appOrigin),
    "APP_URL reset origin",
    appOrigin ?? "invalid",
    "must be a public credential-free HTTPS origin without path, query, or hash",
  );
  strictCheck(
    Boolean(expectedAppOrigin),
    "NEXT_PUBLIC_APP_URL reset origin",
    expectedAppOrigin ?? "invalid",
    "must be a public credential-free HTTPS origin without path, query, or hash",
  );
  strictCheck(
    Boolean(appOrigin && expectedAppOrigin && appOrigin === expectedAppOrigin),
    "Password reset origin match",
    appOrigin ?? "invalid",
    "APP_URL must exactly match the deployed NEXT_PUBLIC_APP_URL origin",
  );
}

async function checkApiBoundary() {
  const health = await fetchJson(`${apiOrigin}/health`);
  if (!health.ok) {
    strictCheck(
      false,
      "API health",
      `${apiOrigin}/health`,
      `${apiOrigin}/health (${status(health)})`,
    );
    return;
  }

  pass("API health", `${apiOrigin}/health (${status(health)})`);

  const protectedRoutes = ["/auth/me", "/current-tenant", "/dashboard/summary"];
  for (const route of protectedRoutes) {
    const result = await fetchJson(`${apiBase}${route}`);
    requireCheck(
      result.status === 401,
      `No-cookie ${route}`,
      "401",
      `${status(result)}; protected workspace APIs must not fall back to demo data`,
    );
  }
}

async function main() {
  console.log("LeadVirt Auth Staging Readiness");
  console.log(`Mode: ${strict ? "strict" : "local/warn"}`);
  console.log(`APP_ENV: ${appEnv}`);
  console.log(`NODE_ENV: ${nodeEnv}`);
  console.log(`API: ${apiBase}`);
  console.log(`Seed user: ${ownerEmail}`);
  console.log("");

  checkEnvironment();

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await checkDatabaseSchema(prisma);
    await checkSeedOwner(prisma);
  } finally {
    await prisma.$disconnect();
  }

  await checkApiBoundary();

  for (const check of checks) {
    console.log(`${check.level} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  const failures = checks.filter((check) => check.level === "FAIL");
  const warnings = checks.filter((check) => check.level === "WARN");
  console.log("");
  if (failures.length) {
    console.log(
      `Auth readiness failed: ${failures.length} failure(s), ${warnings.length} warning(s).`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Auth readiness passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
