import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "leadvirt-release-smoke-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(script, env) {
  return spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function read(path) {
  return readFileSync(path, "utf8");
}

try {
  const secret = "fake-live-webhook-secret-should-not-be-written";
  const redactedPacket = join(tempDir, "pilot-packet-redacted.md");
  const includedPacket = join(tempDir, "pilot-packet-included.md");
  const report = join(tempDir, "public-ready-report.md");

  const packetBaseEnv = {
    LEADVIRT_WEB_BASE: "http://127.0.0.1:1",
    LEADVIRT_API_BASE: "http://127.0.0.1:1/api",
    LEADVIRT_PUBLIC_WEB_BASE: "https://leadvirt.ru",
    LEADVIRT_PUBLIC_API_BASE: "https://leadvirt.ru/api",
    LEADVIRT_PUBLIC_WEBHOOK_KEY: "lvwh_fake_smoke",
    LEADVIRT_PUBLIC_WEBHOOK_SECRET: secret,
  };

  const redacted = runNode("artifacts/scripts/pilot-packet.mjs", {
    ...packetBaseEnv,
    LEADVIRT_PILOT_PACKET_OUT: redactedPacket,
  });
  assert(redacted.status === 0, `pilot-packet redacted run failed: ${redacted.stderr || redacted.stdout}`);
  const redactedText = read(redactedPacket);
  assert(redactedText.includes("lvwh_fake_smoke"), "Expected packet to include the configured webhook key.");
  assert(!redactedText.includes(secret), "Expected packet to redact env-provided webhook secret.");
  assert(redactedText.includes("[set LEADVIRT_PUBLIC_WEBHOOK_SECRET locally]"), "Expected packet to explain local secret setup.");

  const included = runNode("artifacts/scripts/pilot-packet.mjs", {
    ...packetBaseEnv,
    LEADVIRT_PILOT_PACKET_OUT: includedPacket,
    LEADVIRT_PILOT_PACKET_INCLUDE_SECRETS: "1",
  });
  assert(included.status === 0, `pilot-packet secret-included run failed: ${included.stderr || included.stdout}`);
  assert(read(includedPacket).includes(secret), "Expected explicit include mode to write the fake webhook secret.");

  const publicReady = runNode("artifacts/scripts/public-release-ready.mjs", {
    LEADVIRT_PUBLIC_READY_REPORT_OUT: report,
    LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT: "1",
  });
  assert(publicReady.status !== 0, "Expected public-release-ready smoke to fail closed with missing release env.");
  assert(publicReady.stdout.includes("Public URL preflight will be skipped"), "Expected skip warning in public-release-ready output.");
  const reportText = read(report);
  assert(
    reportText.includes("Public URL preflight: skipped by LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT"),
    "Expected report to record skipped public URL preflight mode.",
  );

  console.log("PASS: release readiness scripts redact live packet secrets and report non-browser preflight mode.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
