import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "@leadvirt/config";
import { prisma } from "@leadvirt/db";

loadEnvFile();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

const testId = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `qa.onboarding+${testId}@leadvirt.test`;
const externalAuthId = `qa:onboarding:direct-session:test:${testId}`;
const tenantSlug = `qa-onboarding-${testId}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.resolve(repoRoot, "artifacts/scripts/provision-onboarding-qa-user.ts");
const tsxCli = path.resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs");

function tokenHash(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function run(mode: string) {
  const result = spawnSync(process.execPath, [tsxCli, scriptPath, mode], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: [path.resolve(repoRoot, "apps/api/node_modules"), process.env.NODE_PATH]
        .filter(Boolean)
        .join(path.delimiter),
      LEADVIRT_QA_ONBOARDING_INTERNAL_TEST_MODE: "true",
      LEADVIRT_QA_ONBOARDING_INTERNAL_TEST_ID: testId,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function payload(output: string) {
  const trimmed = output.trim();
  const start = Math.max(trimmed.lastIndexOf("\n{"), trimmed.indexOf("{"));
  if (start < 0) throw new Error(`Provisioner output did not contain JSON: ${trimmed}`);
  return JSON.parse(trimmed.slice(trimmed[start] === "\n" ? start + 1 : start)) as Record<
    string,
    unknown
  >;
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (tenant) await tx.tenant.delete({ where: { id: tenant.id } });
    await tx.user.deleteMany({ where: { email } });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  assert(Boolean(databaseUrl), "DATABASE_URL is required.");
  const hostname = new URL(databaseUrl!).hostname.toLowerCase();
  assert(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Provisioner smoke is restricted to a local database.",
  );

  await cleanup();
  try {
    await prisma.user.create({
      data: { email, externalAuthId: `collision:${testId}`, name: "Collision" },
    });
    const collision = run("provision");
    assert(collision.status !== 0, "Provisioner accepted a fixed-email identity collision.");
    assert(
      collision.stderr.includes("Refusing collision"),
      "Collision failure did not explain the refusal.",
    );
    assert(
      !`${collision.stdout}\n${collision.stderr}`.includes(databaseUrl!),
      "Collision output exposed DATABASE_URL.",
    );
    await prisma.user.deleteMany({ where: { email } });

    const first = run("provision");
    assert(first.status === 0, `First provision failed: ${first.stderr}`);
    const firstPayload = payload(first.stdout);
    const firstToken = firstPayload.sessionToken;
    assert(typeof firstToken === "string" && firstToken.length >= 32, "First token is missing.");

    const created = await prisma.tenant.findUniqueOrThrow({
      where: { slug: tenantSlug },
      include: { onboardingState: true, memberships: { include: { user: true } } },
    });
    assert(created.memberships[0]?.user.email === email, "First provision created the wrong user.");
    assert(
      created.memberships[0]?.user.externalAuthId === externalAuthId,
      "First provision created the wrong external identity.",
    );
    assert(created.memberships[0]?.role === "OWNER", "First provision did not grant OWNER.");
    assert(
      Array.isArray(created.memberships[0]?.user.twoFactorRecoveryCodes) &&
        created.memberships[0]?.user.twoFactorRecoveryCodes.length === 0,
      "First provision did not clear alternate authentication state.",
    );
    assert(
      created.onboardingState?.currentStep === "business" &&
        created.onboardingState.completedSteps.length === 0,
      "First provision did not create clean onboarding state.",
    );
    assert(
      (await prisma.authSession.count({
        where: { tenantId: created.id, tokenHash: tokenHash(firstToken as string), revokedAt: null },
      })) === 1,
      "First session token was not stored with the expected hash.",
    );

    await prisma.tenant.update({ where: { id: created.id }, data: { status: "SUSPENDED" } });
    const suspendedRotation = run("provision");
    assert(suspendedRotation.status !== 0, "Rotation accepted a suspended QA workspace.");
    assert(
      suspendedRotation.stderr.includes("deleted or not operational"),
      "Suspended-workspace refusal is unclear.",
    );
    assert(
      (await prisma.authSession.count({ where: { tenantId: created.id, revokedAt: null } })) === 1,
      "Rejected rotation revoked the usable existing session.",
    );
    await prisma.tenant.update({ where: { id: created.id }, data: { status: "ACTIVE" } });

    await prisma.tenant.update({
      where: { id: created.id },
      data: {
        name: "Preserved QA Business",
        businessType: "custom-business",
        settings: { leadvirtQaAccount: { kind: "leadvirt-onboarding-qa", version: 1 }, preserveMe: true },
      },
    });
    await prisma.onboardingState.update({
      where: { tenantId: created.id },
      data: {
        currentStep: "channels",
        completedSteps: ["business"],
        data: { businessType: "custom-business" },
      },
    });

    const rotated = run("provision");
    assert(rotated.status === 0, `Session rotation failed: ${rotated.stderr}`);
    const rotatedPayload = payload(rotated.stdout);
    const rotatedToken = rotatedPayload.sessionToken;
    assert(
      typeof rotatedToken === "string" && rotatedToken !== firstToken,
      "Session rotation reused the previous token.",
    );
    const preserved = await prisma.tenant.findUniqueOrThrow({
      where: { slug: tenantSlug },
      include: { onboardingState: true },
    });
    assert(preserved.id === created.id, "Rotation replaced the existing QA workspace.");
    assert(
      preserved.name === "Preserved QA Business" && preserved.businessType === "custom-business",
      "Rotation rewrote canonical business data.",
    );
    assert(
      (preserved.settings as Record<string, unknown>).preserveMe === true,
      "Rotation rewrote workspace settings.",
    );
    assert(
      preserved.onboardingState?.currentStep === "channels" &&
        preserved.onboardingState.completedSteps.includes("business"),
      "Rotation rewrote onboarding progress.",
    );
    const sessions = await prisma.authSession.findMany({
      where: { tenantId: created.id },
      orderBy: { createdAt: "asc" },
    });
    assert(
      sessions.filter((session) => session.revokedAt === null).length === 1 &&
        sessions.some((session) => session.tokenHash === tokenHash(rotatedToken as string)),
      "Rotation did not leave exactly one new active session.",
    );

    const reset = run("reset");
    assert(reset.status !== 0, "Direct reset was unexpectedly enabled.");
    assert(reset.stderr.includes("Direct reset is disabled"), "Reset refusal is unclear.");
    const afterReset = await prisma.onboardingState.findUniqueOrThrow({
      where: { tenantId: created.id },
    });
    assert(afterReset.currentStep === "channels", "Reset refusal still mutated onboarding.");

    const status = run("status");
    assert(status.status === 0, `Status failed: ${status.stderr}`);
    const statusPayload = payload(status.stdout);
    assert(statusPayload.provisioned === true, "Status did not report a provisioned workspace.");
    assert(!("sessionToken" in statusPayload), "Status exposed a session token.");

    const revoked = run("revoke");
    assert(revoked.status === 0, `Revoke failed: ${revoked.stderr}`);
    assert(
      (await prisma.authSession.count({ where: { tenantId: created.id, revokedAt: null } })) === 0,
      "Revoke left an active QA session.",
    );

    console.log(`Onboarding QA provisioner smoke: ${checks}/${checks} checks passed`);
  } finally {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
