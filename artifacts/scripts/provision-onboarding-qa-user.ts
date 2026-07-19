import { createHash, randomBytes } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { prisma, type Prisma } from "@leadvirt/db";

loadEnvFile();

const INTERNAL_TEST_MODE = process.env.LEADVIRT_QA_ONBOARDING_INTERNAL_TEST_MODE === "true";
const INTERNAL_TEST_ID = INTERNAL_TEST_MODE
  ? (process.env.LEADVIRT_QA_ONBOARDING_INTERNAL_TEST_ID ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/gu, "")
      .slice(0, 32)
  : "";
if (INTERNAL_TEST_MODE && !INTERNAL_TEST_ID) {
  throw new Error("Internal QA provisioner test mode requires a safe test ID.");
}
const QA_EMAIL = INTERNAL_TEST_ID
  ? `qa.onboarding+${INTERNAL_TEST_ID}@leadvirt.test`
  : "qa.onboarding@leadvirt.test";
const QA_EXTERNAL_AUTH_ID = INTERNAL_TEST_ID
  ? `qa:onboarding:direct-session:test:${INTERNAL_TEST_ID}`
  : "qa:onboarding:direct-session:v1";
const QA_USER_NAME = INTERNAL_TEST_ID
  ? `LeadVirt Onboarding QA ${INTERNAL_TEST_ID}`
  : "LeadVirt Onboarding QA";
const QA_TENANT_NAME = INTERNAL_TEST_ID
  ? `LeadVirt Onboarding QA ${INTERNAL_TEST_ID}`
  : "LeadVirt Onboarding QA Workspace";
const QA_TENANT_SLUG = INTERNAL_TEST_ID ? `qa-onboarding-${INTERNAL_TEST_ID}` : "qa-onboarding";
const QA_MARKER_KEY = "leadvirtQaAccount";
const QA_MARKER = {
  kind: "leadvirt-onboarding-qa",
  version: 1,
};
const ONBOARDING_STEPS = ["business", "channels", "scenario", "company", "crm", "launch"];
const FIRST_ONBOARDING_STEP = "business";
const SESSION_COOKIE_NAME = "leadvirt_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const PRODUCTION_ACK_ENV = "LEADVIRT_QA_ONBOARDING_ALLOW_PRODUCTION";
const modes = ["provision", "reset", "revoke", "status"] as const;

type Mode = (typeof modes)[number];
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactMarker(value: unknown) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "kind" &&
    keys[1] === "version" &&
    value.kind === QA_MARKER.kind &&
    value.version === QA_MARKER.version
  );
}

function hasTenantMarker(settings: unknown) {
  return isRecord(settings) && isExactMarker(settings[QA_MARKER_KEY]);
}

function qaSettings(): Prisma.InputJsonObject {
  return {
    [QA_MARKER_KEY]: { ...QA_MARKER },
  };
}

function sessionTokenHash(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function modeFromArgs(): Mode | "help" {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.length === 0) return "status";
  if (args.length !== 1 || !modes.includes(args[0] as Mode)) {
    throw new Error(`Mode must be one of: ${modes.join(", ")}.`);
  }
  return args[0] as Mode;
}

function printHelp() {
  console.log(`Usage: corepack pnpm qa:onboarding:user [mode]

Modes:
  provision  Create/rotate the marked QA workspace and issue a new seven-day session token.
  reset      Disabled; cleanup must use product domain operations.
  revoke     Revoke every active session for the marked QA identity and workspace.
  status     Show marker, membership, onboarding, and active-session status (default).

Non-local databases require ${PRODUCTION_ACK_ENV}=true.`);
}

function isLocalDatabase(databaseUrl: string) {
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function assertDatabaseSafety() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const local = isLocalDatabase(databaseUrl);
  const environment = `${process.env.NODE_ENV ?? ""} ${process.env.APP_ENV ?? ""}`.toLowerCase();
  const production = environment.includes("production") || !local;
  if (INTERNAL_TEST_MODE && !local) {
    throw new Error("Internal QA provisioner test mode is restricted to a local database.");
  }
  if (production && process.env[PRODUCTION_ACK_ENV] !== "true") {
    throw new Error(
      `Refusing to access a production or non-local database without ${PRODUCTION_ACK_ENV}=true.`,
    );
  }
  return local;
}

async function loadQaRecords(client: Prisma.TransactionClient) {
  const [userByEmail, userByExternalAuthId, tenant] = await Promise.all([
    client.user.findUnique({
      where: { email: QA_EMAIL },
      include: {
        memberships: {
          include: { tenant: { select: { slug: true, settings: true } } },
        },
        _count: { select: { passwordResetTokens: true } },
      },
    }),
    client.user.findUnique({ where: { externalAuthId: QA_EXTERNAL_AUTH_ID } }),
    client.tenant.findUnique({
      where: { slug: QA_TENANT_SLUG },
      include: {
        memberships: {
          include: {
            user: { select: { email: true, externalAuthId: true } },
          },
        },
        _count: {
          select: {
            leads: true,
            channels: true,
            conversations: true,
            integrations: true,
            workflows: true,
            knowledgeSources: true,
          },
        },
      },
    }),
  ]);

  if (userByEmail && userByEmail.externalAuthId !== QA_EXTERNAL_AUTH_ID) {
    throw new Error(`Refusing collision: ${QA_EMAIL} is not the marked onboarding QA user.`);
  }
  if (userByExternalAuthId && userByExternalAuthId.email !== QA_EMAIL) {
    throw new Error(
      `Refusing collision: ${QA_EXTERNAL_AUTH_ID} belongs to a different email address.`,
    );
  }
  if (userByEmail && userByExternalAuthId && userByEmail.id !== userByExternalAuthId.id) {
    throw new Error("Refusing collision: the fixed QA email and external identity do not match.");
  }
  if (tenant && !hasTenantMarker(tenant.settings)) {
    throw new Error(
      `Refusing collision: ${QA_TENANT_SLUG} does not contain the exact onboarding QA marker.`,
    );
  }

  const user = userByEmail;
  const foreignMembership = user?.memberships.find(
    (membership) =>
      membership.tenant.slug !== QA_TENANT_SLUG || !hasTenantMarker(membership.tenant.settings),
  );
  if (foreignMembership) {
    throw new Error("Refusing collision: the marked QA user belongs to another workspace.");
  }

  const foreignTenantMember = tenant?.memberships.find(
    (membership) =>
      membership.user.email !== QA_EMAIL || membership.user.externalAuthId !== QA_EXTERNAL_AUTH_ID,
  );
  if (foreignTenantMember) {
    throw new Error("Refusing collision: the marked QA workspace contains another user.");
  }

  return { user, tenant };
}

async function sanitizeQaUser(client: Prisma.TransactionClient, userId?: string) {
  const user = userId
    ? await client.user.update({
        where: { id: userId },
        data: {
          externalAuthId: QA_EXTERNAL_AUTH_ID,
          email: QA_EMAIL,
          phone: null,
          passwordHash: null,
          passwordChangeRequired: false,
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: null,
          twoFactorRecoveryCodes: [],
          twoFactorConfirmedAt: null,
          name: QA_USER_NAME,
          locale: "en",
          deletedAt: null,
        },
      })
    : await client.user.create({
        data: {
          externalAuthId: QA_EXTERNAL_AUTH_ID,
          email: QA_EMAIL,
          phone: null,
          passwordHash: null,
          passwordChangeRequired: false,
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: null,
          twoFactorRecoveryCodes: [],
          twoFactorConfirmedAt: null,
          name: QA_USER_NAME,
          locale: "en",
          deletedAt: null,
        },
      });

  await client.authPasswordResetToken.deleteMany({ where: { userId: user.id } });
  await client.authEmailOtpChallenge.deleteMany({ where: { email: QA_EMAIL } });
  return user;
}

async function createFreshOnboardingState(client: Prisma.TransactionClient, tenantId: string) {
  await client.onboardingState.create({
    data: {
      tenantId,
      businessProfileVersion: 1,
      completedSteps: [],
      currentStep: FIRST_ONBOARDING_STEP,
      data: {},
    },
  });
}

async function createWorkspace(client: Prisma.TransactionClient, userId: string) {
  const tenant = await client.tenant.create({
    data: {
      name: QA_TENANT_NAME,
      slug: QA_TENANT_SLUG,
      status: "ACTIVE",
      timezone: "UTC",
      settings: qaSettings(),
    },
  });
  await client.membership.create({
    data: { tenantId: tenant.id, userId, role: "OWNER" },
  });
  await createFreshOnboardingState(client, tenant.id);
  return tenant;
}

async function ensureWorkspace(client: Prisma.TransactionClient) {
  const existing = await loadQaRecords(client);
  const user = await sanitizeQaUser(client, existing.user?.id);
  if (!existing.tenant) return { user, tenant: await createWorkspace(client, user.id) };
  if (
    existing.tenant.deletedAt ||
    !["ACTIVE", "TRIALING"].includes(existing.tenant.status)
  ) {
    throw new Error(
      "Refusing session rotation: the marked QA workspace is deleted or not operational.",
    );
  }
  await client.membership.upsert({
    where: { tenantId_userId: { tenantId: existing.tenant.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { tenantId: existing.tenant.id, userId: user.id, role: "OWNER" },
  });
  return { user, tenant: existing.tenant };
}

async function provision() {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const result = await prisma.$transaction(async (client) => {
    const { user, tenant } = await ensureWorkspace(client);
    await client.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await client.authSession.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        tokenHash: sessionTokenHash(token),
        authMode: "credentials",
        expiresAt,
        userAgent: "leadvirt-direct-db-onboarding-qa",
      },
    });
    return { expiresAt };
  });

  console.log(
    JSON.stringify(
      {
        mode: "provision",
        email: QA_EMAIL,
        tenantSlug: QA_TENANT_SLUG,
        onboardingSteps: ONBOARDING_STEPS,
        cookieName: SESSION_COOKIE_NAME,
        sessionToken: token,
        expiresAt: result.expiresAt.toISOString(),
      },
      null,
      2,
    ),
  );
}

async function reset() {
  throw new Error(
    "Direct reset is disabled because it cannot replace integration and knowledge domain cleanup. Reuse the marked workspace or clean it through product workflows.",
  );
}

async function revoke() {
  const revoked = await prisma.$transaction(async (client) => {
    const { user, tenant } = await loadQaRecords(client);
    if (!user || !tenant) return 0;
    const result = await client.authSession.updateMany({
      where: { userId: user.id, tenantId: tenant.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  });
  console.log(JSON.stringify({ mode: "revoke", email: QA_EMAIL, revokedSessions: revoked }));
}

async function status() {
  const result = await prisma.$transaction(async (client) => {
    const { user, tenant } = await loadQaRecords(client);
    const membership =
      user && tenant
        ? await client.membership.findUnique({
            where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
            select: { role: true },
          })
        : null;
    const onboarding = tenant
      ? await client.onboardingState.findUnique({
          where: { tenantId: tenant.id },
          select: { currentStep: true, completedSteps: true, completedAt: true },
        })
      : null;
    const activeSessions =
      user && tenant
        ? await client.authSession.findMany({
            where: {
              userId: user.id,
              tenantId: tenant.id,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { expiresAt: true },
            orderBy: { expiresAt: "desc" },
          })
        : [];
    const pendingEmailOtpChallenges = await client.authEmailOtpChallenge.count({
      where: { email: QA_EMAIL, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    const retiredWorkspaceCount = await client.tenant.count({
      where: {
        slug: { startsWith: `${QA_TENANT_SLUG}-retired-` },
        deletedAt: { not: null },
      },
    });
    return {
      user,
      tenant,
      membership,
      onboarding,
      activeSessions,
      pendingEmailOtpChallenges,
      retiredWorkspaceCount,
    };
  });

  console.log(
    JSON.stringify(
      {
        mode: "status",
        email: QA_EMAIL,
        externalAuthId: QA_EXTERNAL_AUTH_ID,
        tenantSlug: QA_TENANT_SLUG,
        provisioned: Boolean(
          result.user &&
            result.tenant &&
            !result.tenant.deletedAt &&
            ["ACTIVE", "TRIALING"].includes(result.tenant.status) &&
            result.membership &&
            result.onboarding,
        ),
        role: result.membership?.role ?? null,
        alternateCredentialsCleared: Boolean(
          result.user &&
          result.user.phone === null &&
          result.user.passwordHash === null &&
          result.user.twoFactorEnabled === false &&
          result.user.twoFactorSecretEncrypted === null &&
          Array.isArray(result.user.twoFactorRecoveryCodes) &&
          result.user.twoFactorRecoveryCodes.length === 0 &&
          result.user.twoFactorConfirmedAt === null &&
          result.user._count.passwordResetTokens === 0 &&
          result.pendingEmailOtpChallenges === 0,
        ),
        onboarding: result.onboarding
          ? {
              currentStep: result.onboarding.currentStep,
              completedSteps: result.onboarding.completedSteps,
              completedAt: result.onboarding.completedAt?.toISOString() ?? null,
              expectedSteps: ONBOARDING_STEPS,
            }
          : null,
        activeSessionCount: result.activeSessions.length,
        latestSessionExpiresAt: result.activeSessions[0]?.expiresAt.toISOString() ?? null,
        workspaceDataCounts: result.tenant?._count ?? null,
        retiredWorkspaceCount: result.retiredWorkspaceCount,
      },
      null,
      2,
    ),
  );
}

function safeErrorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return message;
  message = message.replaceAll(databaseUrl, "[DATABASE_URL]");
  try {
    const password = new URL(databaseUrl).password;
    if (password) message = message.replaceAll(password, "[redacted]");
  } catch {
    // DATABASE_URL validation reports a fixed message before any connection is attempted.
  }
  return message;
}

async function main() {
  const mode = modeFromArgs();
  if (mode === "help") {
    printHelp();
    return;
  }
  assertDatabaseSafety();
  if (mode === "provision") await provision();
  if (mode === "reset") await reset();
  if (mode === "revoke") await revoke();
  if (mode === "status") await status();
}

main()
  .catch((error: unknown) => {
    console.error(`ONBOARDING_QA_USER: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
