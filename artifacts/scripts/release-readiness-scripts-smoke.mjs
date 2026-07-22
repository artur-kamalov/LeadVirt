import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "leadvirt-release-smoke-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(script, env, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function read(path) {
  return readFileSync(path, "utf8");
}

function sourceFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function assertOrdered(text, markers, message) {
  let cursor = -1;
  for (const marker of markers) {
    const next = text.indexOf(marker, cursor + 1);
    assert(next > cursor, `${message}: missing or out of order: ${marker}`);
    cursor = next;
  }
}

function shellFunctionBody(source, name) {
  const marker = `${name}() {`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Expected shell function ${name}.`);
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const indent = source.slice(lineStart, start);
  const end = source.indexOf(`\n${indent}}`, start);
  assert(end > start, `Expected shell function boundary for ${name}.`);
  return source.slice(start, end + indent.length + 2);
}

function workflowRunBlock(source, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Expected workflow step ${stepName}.`);
  const nextStep = source.indexOf("\n      - name:", start + marker.length);
  const runMarker = "        run: |\n";
  const runStart = source.indexOf(runMarker, start + marker.length);
  assert(
    runStart >= 0 && (nextStep < 0 || runStart < nextStep),
    `Expected workflow run block ${stepName}.`,
  );
  const contentStart = runStart + runMarker.length;
  const contentEnd = nextStep >= 0 ? nextStep : source.length;
  return source
    .slice(contentStart, contentEnd)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

function runStdinDrainCase(bash, guarded) {
  return new Promise((resolveCase, rejectCase) => {
    const child = spawn(bash, ["-s"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let tailSent = false;
    let childError;
    let stdinError;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!tailSent && stdout.includes("COMPOSE_ENTERED")) {
        tailSent = true;
        child.stdin.end("printf 'TAIL_SURVIVED\\n'\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", (error) => {
      stdinError = error;
    });
    child.once("error", (error) => {
      childError = error;
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      if (timedOut) {
        rejectCase(new Error("Timed out while exercising the Bash stdin-drain guard."));
        return;
      }
      if (childError || stdinError) {
        rejectCase(childError || stdinError);
        return;
      }
      resolveCase({ status, stdout, stderr });
    });
    child.stdin.write(
      [
        "set -euo pipefail",
        "compose_probe() {",
        "  printf 'COMPOSE_ENTERED\\n'",
        "  cat >/dev/null",
        "}",
        `compose_probe${guarded ? " </dev/null" : ""}`,
        "",
      ].join("\n"),
    );
  });
}

function runBufferedRemoteProgramCase(bash) {
  const completionToken = "a".repeat(64);
  const remoteProgram = [
    "set -euo pipefail",
    "unset DEPLOY_COMPLETION_TOKEN",
    'DEPLOY_COMPLETION_TOKEN="$1"',
    "shift",
    "cat >/dev/null",
    `bash -c 'test -z "\${DEPLOY_COMPLETION_TOKEN+x}"'`,
    `printf 'BUFFERED_TAIL:%s\\n' "$DEPLOY_COMPLETION_TOKEN"`,
    "",
  ].join("\n");
  return {
    completionToken,
    result: spawnSync(
      bash,
      ["-c", 'remote_program=$(cat); bash -c "$remote_program" -- "$1"', "--", completionToken],
      {
        input: remoteProgram,
        encoding: "utf8",
        env: { ...process.env, DEPLOY_COMPLETION_TOKEN: "preexisting-export" },
      },
    ),
  };
}

function runCompletionContractCase(bash, { emitMarker, producerStatus, teeStatus }) {
  const releaseSha = "b".repeat(40);
  const completionToken = "c".repeat(64);
  const script = [
    "set -euo pipefail",
    'remote_deploy_log="$(mktemp)"',
    `trap 'rm -f "$remote_deploy_log"' EXIT`,
    'emit_marker="$1"',
    'producer_status="$2"',
    'tee_status="$3"',
    'release_sha="$4"',
    'completion_token="$5"',
    "producer() {",
    '  if [ "$emit_marker" = "1" ]; then',
    `    printf 'DEPLOY_REMOTE_COMPLETE:%s:%s\\n' "$release_sha" "$completion_token"`,
    "  fi",
    '  return "$producer_status"',
    "}",
    "capture() {",
    '  command tee "$remote_deploy_log"',
    '  return "$tee_status"',
    "}",
    "producer | capture",
    'if ! grep -Fx "DEPLOY_REMOTE_COMPLETE:$release_sha:$completion_token" "$remote_deploy_log" >/dev/null; then',
    "  exit 96",
    "fi",
    "",
  ].join("\n");
  return spawnSync(
    bash,
    [
      "-c",
      script,
      "--",
      emitMarker ? "1" : "0",
      String(producerStatus),
      String(teeStatus),
      releaseSha,
      completionToken,
    ],
    { encoding: "utf8" },
  );
}

function bashPath(path) {
  if (process.platform !== "win32") return path;
  return path
    .replace(/^([A-Za-z]):\\/u, (_, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll("\\", "/");
}

function findBash() {
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"]
      : ["/usr/bin/bash", "/bin/bash"];
  return candidates.find((candidate) => existsSync(candidate));
}

try {
  const secret = "fake-live-webhook-secret-should-not-be-written";
  const redactedPacket = join(tempDir, "pilot-packet-redacted.md");
  const includedPacket = join(tempDir, "pilot-packet-included.md");
  const report = join(tempDir, "public-ready-report.md");
  const stagingEnv = join(tempDir, "staging.env");

  const packetBaseEnv = {
    LEADVIRT_WEB_BASE: "http://127.0.0.1:1",
    LEADVIRT_API_BASE: "http://127.0.0.1:1/api",
    LEADVIRT_PUBLIC_WEB_BASE: "https://leadvirt.com",
    LEADVIRT_PUBLIC_API_BASE: "https://leadvirt.com/api",
    LEADVIRT_PUBLIC_WEBHOOK_KEY: "lvwh_fake_smoke",
    LEADVIRT_PUBLIC_WEBHOOK_SECRET: secret,
  };

  const redacted = runNode("artifacts/scripts/pilot-packet.mjs", {
    ...packetBaseEnv,
    LEADVIRT_PILOT_PACKET_OUT: redactedPacket,
  });
  assert(
    redacted.status === 0,
    `pilot-packet redacted run failed: ${redacted.stderr || redacted.stdout}`,
  );
  const redactedText = read(redactedPacket);
  assert(
    redactedText.includes("lvwh_fake_smoke"),
    "Expected packet to include the configured webhook key.",
  );
  assert(!redactedText.includes(secret), "Expected packet to redact env-provided webhook secret.");
  assert(
    redactedText.includes("[set LEADVIRT_PUBLIC_WEBHOOK_SECRET locally]"),
    "Expected packet to explain local secret setup.",
  );

  const included = runNode("artifacts/scripts/pilot-packet.mjs", {
    ...packetBaseEnv,
    LEADVIRT_PILOT_PACKET_OUT: includedPacket,
    LEADVIRT_PILOT_PACKET_INCLUDE_SECRETS: "1",
  });
  assert(
    included.status === 0,
    `pilot-packet secret-included run failed: ${included.stderr || included.stdout}`,
  );
  assert(
    read(includedPacket).includes(secret),
    "Expected explicit include mode to write the fake webhook secret.",
  );

  const publicReady = runNode("artifacts/scripts/public-release-ready.mjs", {
    LEADVIRT_PUBLIC_READY_REPORT_OUT: report,
    LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT: "1",
  });
  assert(
    publicReady.status !== 0,
    "Expected public-release-ready smoke to fail closed with missing release env.",
  );
  assert(
    publicReady.stdout.includes("Public URL preflight will be skipped"),
    "Expected skip warning in public-release-ready output.",
  );
  const reportText = read(report);
  assert(
    reportText.includes(
      "Public URL preflight: skipped by LEADVIRT_PUBLIC_READY_SKIP_PUBLIC_PREFLIGHT",
    ),
    "Expected report to record skipped public URL preflight mode.",
  );

  writeFileSync(
    stagingEnv,
    [
      "KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID=acceptance-query-v1",
      'KNOWLEDGE_QUERY_HMAC_KEYS={"acceptance-query-v1":"CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk="}',
    ].join("\n"),
  );
  const fixtureKeyRejected = runNode(
    "artifacts/scripts/knowledge-v2-staging-ready.mjs",
    {
      KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID: "production-query-v1",
      KNOWLEDGE_QUERY_HMAC_KEYS: JSON.stringify({
        "production-query-v1": Buffer.alloc(32, 0x33).toString("base64"),
      }),
    },
    [stagingEnv],
  );
  assert(
    fixtureKeyRejected.status !== 0,
    "Expected staging readiness to reject a known fixture key from the authoritative env file.",
  );

  const deployWorkflow = read(join(repoRoot, ".github/workflows/deploy-leadvirt-com.yml"));
  const deploymentJournal = read(join(repoRoot, "artifacts/scripts/deployment-journal.sh"));
  const stagingEnvTemplate = read(join(repoRoot, "deploy/env.staging.example"));
  const businessImportProductionReadyPath = join(
    repoRoot,
    "artifacts/scripts/business-import-production-ready.mjs",
  );
  const businessImportProductionReady = read(businessImportProductionReadyPath);
  const artifactKeyCanonicalizerPath = join(
    repoRoot,
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
  );
  const artifactKeyCanonicalizer = read(artifactKeyCanonicalizerPath);
  const knowledgeStagingReady = read(
    join(repoRoot, "artifacts/scripts/knowledge-v2-staging-ready.mjs"),
  );
  const businessImportProductionReadySyntax = spawnSync(
    process.execPath,
    ["--check", businessImportProductionReadyPath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert(
    businessImportProductionReadySyntax.status === 0,
    `Business Import production readiness syntax failed: ${businessImportProductionReadySyntax.stderr}`,
  );
  const artifactKeyCanonicalizerSyntax = spawnSync(
    process.execPath,
    ["--check", artifactKeyCanonicalizerPath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert(
    artifactKeyCanonicalizerSyntax.status === 0,
    `Knowledge artifact key canonicalizer syntax failed: ${artifactKeyCanonicalizerSyntax.stderr}`,
  );
  const artifactKeyFixture = join(tempDir, "artifact-key.env");
  const canonicalArtifactKey = Buffer.alloc(32, 0x2a).toString("base64");
  const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const canonicalFinalIndex = base64Alphabet.indexOf(canonicalArtifactKey[42]);
  const nonCanonicalArtifactKey = `${canonicalArtifactKey.slice(0, 42)}${base64Alphabet[canonicalFinalIndex + 1]}=`;
  assert(
    Buffer.from(nonCanonicalArtifactKey, "base64").toString("base64") === canonicalArtifactKey,
    "Expected a byte-equivalent non-canonical artifact key fixture.",
  );
  writeFileSync(
    artifactKeyFixture,
    `UNCHANGED=value\nKNOWLEDGE_ARTIFACT_ENCRYPTION_KEY='${nonCanonicalArtifactKey}'\n`,
    { mode: 0o640 },
  );
  const canonicalizedArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [artifactKeyFixture],
  );
  const canonicalizedArtifactEnv = read(artifactKeyFixture);
  assert(
    canonicalizedArtifactKey.status === 0 &&
      canonicalizedArtifactEnv.includes(`UNCHANGED=value\n`) &&
      canonicalizedArtifactEnv.includes(
        `KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY='${canonicalArtifactKey}'\n`,
      ) &&
      !canonicalizedArtifactKey.stdout.includes(canonicalArtifactKey) &&
      !canonicalizedArtifactKey.stdout.includes(nonCanonicalArtifactKey),
    `Expected atomic byte-preserving artifact key canonicalization: ${canonicalizedArtifactKey.stderr}`,
  );
  const repeatedArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [artifactKeyFixture],
  );
  assert(
    repeatedArtifactKey.status === 0 && read(artifactKeyFixture) === canonicalizedArtifactEnv,
    "Expected artifact key canonicalization to be idempotent.",
  );
  const duplicateArtifactKeyFixture = join(tempDir, "duplicate-artifact-key.env");
  const shadowedArtifactKey = "invalid-shadowed-value";
  writeFileSync(
    duplicateArtifactKeyFixture,
    `KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY=${shadowedArtifactKey}\nUNCHANGED_DUPLICATE=value\nKNOWLEDGE_ARTIFACT_ENCRYPTION_KEY='${nonCanonicalArtifactKey}'\n`,
    { mode: 0o640 },
  );
  const normalizedDuplicateArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [duplicateArtifactKeyFixture],
  );
  const normalizedDuplicateArtifactEnv = read(duplicateArtifactKeyFixture);
  assert(
    normalizedDuplicateArtifactKey.status === 0 &&
      (normalizedDuplicateArtifactEnv.match(/^KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY=/gmu)?.length ??
        0) === 1 &&
      normalizedDuplicateArtifactEnv.includes("UNCHANGED_DUPLICATE=value\n") &&
      normalizedDuplicateArtifactEnv.includes(
        `KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY='${canonicalArtifactKey}'\n`,
      ) &&
      !normalizedDuplicateArtifactEnv.includes(shadowedArtifactKey) &&
      !normalizedDuplicateArtifactKey.stdout.includes(shadowedArtifactKey) &&
      !normalizedDuplicateArtifactKey.stderr.includes(shadowedArtifactKey) &&
      !normalizedDuplicateArtifactKey.stdout.includes(canonicalArtifactKey) &&
      !normalizedDuplicateArtifactKey.stderr.includes(canonicalArtifactKey) &&
      !normalizedDuplicateArtifactKey.stdout.includes(nonCanonicalArtifactKey) &&
      !normalizedDuplicateArtifactKey.stderr.includes(nonCanonicalArtifactKey),
    `Expected last-wins duplicate normalization without changing the effective key: ${normalizedDuplicateArtifactKey.stderr}`,
  );
  const canonicalDuplicateArtifactKeyFixture = join(
    tempDir,
    "canonical-duplicate-artifact-key.env",
  );
  const canonicalDuplicateArtifactKeyContents =
    ` KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY = invalid-shadowed-value\r\n` +
    `PRESERVED_CRLF=value\r\n` +
    ` KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY = "${canonicalArtifactKey}" \r\n`;
  writeFileSync(canonicalDuplicateArtifactKeyFixture, canonicalDuplicateArtifactKeyContents, {
    mode: 0o640,
  });
  const normalizedCanonicalDuplicateArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [canonicalDuplicateArtifactKeyFixture],
  );
  assert(
    normalizedCanonicalDuplicateArtifactKey.status === 0 &&
      read(canonicalDuplicateArtifactKeyFixture) ===
        `PRESERVED_CRLF=value\r\n KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY = "${canonicalArtifactKey}" \r\n`,
    `Expected canonical last-wins duplicates to collapse while preserving CRLF and formatting: ${normalizedCanonicalDuplicateArtifactKey.stderr}`,
  );
  const invalidEffectiveArtifactKeyFixture = join(tempDir, "invalid-effective-artifact-key.env");
  const invalidEffectiveArtifactKeyContents =
    `KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY=${canonicalArtifactKey}\n` +
    `KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY=invalid-effective-value\n`;
  writeFileSync(invalidEffectiveArtifactKeyFixture, invalidEffectiveArtifactKeyContents, {
    mode: 0o640,
  });
  const invalidEffectiveArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [invalidEffectiveArtifactKeyFixture],
  );
  assert(
    invalidEffectiveArtifactKey.status !== 0 &&
      read(invalidEffectiveArtifactKeyFixture) === invalidEffectiveArtifactKeyContents &&
      !invalidEffectiveArtifactKey.stdout.includes(canonicalArtifactKey) &&
      !invalidEffectiveArtifactKey.stderr.includes(canonicalArtifactKey),
    "Expected an invalid effective last assignment to fail without falling back or modifying the file.",
  );
  const missingArtifactKeyFixture = join(tempDir, "missing-artifact-key.env");
  const missingArtifactKeyContents = "UNCHANGED_MISSING=value\n";
  writeFileSync(missingArtifactKeyFixture, missingArtifactKeyContents, { mode: 0o640 });
  const missingArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [missingArtifactKeyFixture],
  );
  assert(
    missingArtifactKey.status !== 0 &&
      read(missingArtifactKeyFixture) === missingArtifactKeyContents,
    "Expected a missing assignment to fail without modifying the file.",
  );
  const invalidArtifactKeyFixture = join(tempDir, "invalid-artifact-key.env");
  writeFileSync(invalidArtifactKeyFixture, "KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY=invalid\n", {
    mode: 0o640,
  });
  const invalidArtifactKey = runNode(
    "artifacts/scripts/knowledge-artifact-key-canonicalize.mjs",
    {},
    [invalidArtifactKeyFixture],
  );
  assert(
    invalidArtifactKey.status !== 0 &&
      read(invalidArtifactKeyFixture) === "KNOWLEDGE_ARTIFACT_ENCRYPTION_KEY=invalid\n" &&
      artifactKeyCanonicalizer.includes("await temporaryHandle.sync()") &&
      artifactKeyCanonicalizer.includes(
        "await temporaryHandle.chown(metadata.uid, metadata.gid)",
      ) &&
      knowledgeStagingReady.includes(
        'artifactEncryptionKeyBytes.toString("base64") !== artifactEncryptionKey',
      ),
    "Expected malformed keys to remain unchanged and all readiness paths to require canonical base64.",
  );
  assert(
    stagingEnvTemplate.includes("NEXT_PUBLIC_BUSINESS_IMPORT_ENABLED=true") &&
      stagingEnvTemplate.includes("BUSINESS_IMPORT_ENABLED=true") &&
      stagingEnvTemplate.includes("BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED=false") &&
      stagingEnvTemplate.includes("BUSINESS_IMPORT_PARSER_APPROVED=false") &&
      stagingEnvTemplate.includes("BUSINESS_IMPORT_PARSER_URL=\n") &&
      stagingEnvTemplate.includes("BUSINESS_IMPORT_PARSER_VERSION=unconfigured"),
    "Expected the production template to enable CSV imports while keeping XLSX and the parser disabled.",
  );
  const bash = findBash();
  assert(bash, "Expected Bash for deployment journal validation.");
  const journalScriptPath = join(repoRoot, "artifacts/scripts/deployment-journal.sh");
  const journalSyntax = spawnSync(bash, ["-n", bashPath(journalScriptPath)], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert(
    journalSyntax.status === 0,
    `Deployment journal syntax failed: ${journalSyntax.stderr || journalSyntax.stdout}`,
  );
  const deployStepScript = workflowRunBlock(deployWorkflow, "Deploy on VPS");
  assert(
    deployStepScript.trimStart().startsWith("set -euo pipefail\n") &&
      !deployStepScript.includes("set +o pipefail"),
    "Expected pipefail before the remote deployment output pipeline.",
  );
  const deployStepSyntax = spawnSync(bash, ["-n", "-s"], {
    input: deployStepScript,
    encoding: "utf8",
  });
  assert(
    deployStepSyntax.status === 0,
    `Deploy workflow shell syntax failed: ${deployStepSyntax.stderr || deployStepSyntax.stdout}`,
  );
  for (const [source, name] of [
    [deployWorkflow, "release_compose"],
    [deployWorkflow, "release_compose_paused_worker"],
    [deploymentJournal, "journal_compose"],
    [deploymentJournal, "journal_compose_paused_worker"],
  ]) {
    assert(
      shellFunctionBody(source, name).includes('"$@" </dev/null'),
      `Expected ${name} to detach Compose from the caller's script stdin.`,
    );
  }
  const installedJournalCalls = deployWorkflow.match(
    /bash "\$installed_deployment_journal"[^\n]*/gu,
  );
  assert(
    installedJournalCalls?.length === 5 &&
      installedJournalCalls.every((call) => call.includes("</dev/null")),
    "Expected every installed deployment-journal invocation to detach inherited stdin.",
  );
  assert(
    deployWorkflow.includes(
      'bash "$release_dir/artifacts/scripts/deployment-journal.sh" install-service </dev/null',
    ) &&
      deployWorkflow.includes('sh "$release_dir/deploy/enable-leadvirt-com-https.sh" </dev/null'),
    "Expected pre-gate deployment helpers to detach inherited stdin.",
  );
  assert(
    deployWorkflow.includes('remote_deploy_log="$(mktemp)"') &&
      deployWorkflow.includes('remote_completion_token="$(openssl rand -hex 32)"') &&
      deployWorkflow.includes(
        `bash -c 'remote_program=\\$(cat); bash -c \\"\\$remote_program\\" -- \\"\\$1\\"' -- '$remote_completion_token'`,
      ) &&
      deployWorkflow.includes("unset DEPLOY_COMPLETION_TOKEN") &&
      deployWorkflow.includes('DEPLOY_COMPLETION_TOKEN="$1"') &&
      !deployWorkflow.includes("export DEPLOY_COMPLETION_TOKEN") &&
      !deployWorkflow.includes("DEPLOY_COMPLETION_TOKEN='$remote_completion_token'") &&
      deployWorkflow.includes(`<<'REMOTE' | tee "$remote_deploy_log"`) &&
      deployWorkflow.includes(`trap 'rm -f "$remote_deploy_log"' EXIT`) &&
      deployWorkflow.includes(
        'if ! grep -Fx "DEPLOY_REMOTE_COMPLETE:$GITHUB_SHA:$remote_completion_token" "$remote_deploy_log" >/dev/null; then',
      ),
    "Expected a buffered remote program and non-exported completion token with exact verification.",
  );
  assertOrdered(
    deployStepScript,
    [
      `<<'REMOTE' | tee "$remote_deploy_log"`,
      "unset DEPLOY_COMPLETION_TOKEN",
      'DEPLOY_COMPLETION_TOKEN="$1"',
      "shift",
    ],
    "Expected the remote program to clear any inherited export attribute before assigning the token",
  );
  const bufferedRemoteProgram = runBufferedRemoteProgramCase(bash);
  assert(
    bufferedRemoteProgram.result.status === 0 &&
      bufferedRemoteProgram.result.stdout.includes(
        `BUFFERED_TAIL:${bufferedRemoteProgram.completionToken}`,
      ),
    `Expected buffering to preserve the remote tail and keep the token out of child environments: ${bufferedRemoteProgram.result.stderr}`,
  );
  const validCompletion = runCompletionContractCase(bash, {
    emitMarker: true,
    producerStatus: 0,
    teeStatus: 0,
  });
  const missingCompletion = runCompletionContractCase(bash, {
    emitMarker: false,
    producerStatus: 0,
    teeStatus: 0,
  });
  const failedProducer = runCompletionContractCase(bash, {
    emitMarker: true,
    producerStatus: 7,
    teeStatus: 0,
  });
  const failedTee = runCompletionContractCase(bash, {
    emitMarker: true,
    producerStatus: 0,
    teeStatus: 8,
  });
  assert(
    validCompletion.status === 0 &&
      missingCompletion.status !== 0 &&
      failedProducer.status !== 0 &&
      failedTee.status !== 0,
    "Expected completion verification to reject a missing marker and producer or tee failures.",
  );
  const stdinDrainControl = await runStdinDrainCase(bash, false);
  const stdinDrainGuard = await runStdinDrainCase(bash, true);
  assert(
    stdinDrainControl.status === 0 && !stdinDrainControl.stdout.includes("TAIL_SURVIVED"),
    `Expected the unguarded control to consume the remaining bash -s program: ${stdinDrainControl.stderr}`,
  );
  assert(
    stdinDrainGuard.status === 0 && stdinDrainGuard.stdout.includes("TAIL_SURVIVED"),
    `Expected the Compose stdin guard to preserve the remaining bash -s program: ${stdinDrainGuard.stderr}`,
  );

  if (process.platform !== "win32") {
    const journalRoot = join(tempDir, "deployment-journal-root");
    const releaseId = "abcdef123456-attempt-Ab12Cd";
    const releaseSha = "a".repeat(40);
    const releaseDir = join(journalRoot, "releases", releaseId);
    const fakeBin = join(tempDir, "deployment-journal-bin");
    const fakeDocker = join(fakeBin, "docker");
    const fakeDockerLog = join(tempDir, "deployment-journal-docker.log");
    const journalEnvFile = join(journalRoot, "secrets", ".env");
    mkdirSync(join(releaseDir, "deploy"), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(join(journalRoot, "secrets"), { recursive: true });
    writeFileSync(join(releaseDir, ".leadvirt-release-sha"), `${releaseSha}\n`);
    writeFileSync(join(releaseDir, ".leadvirt-image-tag"), `${releaseId}\n`);
    writeFileSync(join(releaseDir, ".leadvirt-compose-project"), "deploy\n");
    writeFileSync(join(releaseDir, "deploy", "docker-compose.staging.yml"), "services: {}\n");
    writeFileSync(journalEnvFile, "POSTGRES_PASSWORD=contract-only\n");
    writeFileSync(fakeDockerLog, "");
    writeFileSync(
      fakeDocker,
      [
        "#!/usr/bin/env bash",
        'case "${1:-}" in',
        "  info) exit 0 ;;",
        '  ps) [ "${FAKE_DOCKER_PS_FAILURE:-0}" = "1" ] && exit 92; exit 0 ;;',
        "  image)",
        '    if [ "${2:-}" = "ls" ]; then',
        '      [ -z "${FAKE_DOCKER_IMAGE_TAG:-}" ] || printf \'%s %s\\n\' "${3:-}" "$FAKE_DOCKER_IMAGE_TAG"',
        "      exit 0",
        "    fi",
        '    if [ "${2:-}" = "rm" ]; then',
        '      printf \'%s\\n\' "${3:-}" >> "$FAKE_DOCKER_LOG"',
        "      exit 0",
        "    fi",
        "    exit 91",
        "    ;;",
        "  *) exit 91 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);
    const journalWriteEnvironment = {
      ...process.env,
      LEADVIRT_DEPLOY_LOCK_HELD: "1",
      DEPLOY_ROOT: journalRoot,
      JOURNAL_RELEASE_DIR: releaseDir,
      JOURNAL_RELEASE_ID: releaseId,
      JOURNAL_RELEASE_SHA: releaseSha,
      JOURNAL_COMPOSE_PROJECT: "deploy",
      JOURNAL_ENV_FILE: journalEnvFile,
      JOURNAL_PUBLIC_URL: "https://leadvirt.com",
      JOURNAL_PREVIOUS_CURRENT_KIND: "missing",
      JOURNAL_PREVIOUS_LINK_TARGET: "",
      JOURNAL_PREVIOUS_ROOT: "",
      JOURNAL_PREVIOUS_PATH_IDENTITY: "",
      JOURNAL_PREVIOUS_BACKUP_DIR: "",
      JOURNAL_PREVIOUS_API_CONTAINER: "",
      JOURNAL_PREVIOUS_API_RUNNING: "0",
      JOURNAL_PREVIOUS_WORKER_CONTAINER: "",
      JOURNAL_PREVIOUS_WORKER_RUNNING: "0",
      JOURNAL_PREVIOUS_WEB_CONTAINER: "",
      JOURNAL_PREVIOUS_WEB_RUNNING: "0",
      JOURNAL_PREVIOUS_BUSINESS_IMPORT_PARSER_CONTAINER: "",
      JOURNAL_PREVIOUS_BUSINESS_IMPORT_PARSER_RUNNING: "0",
      JOURNAL_BUSINESS_IMPORT_PARSER_ENABLED: "0",
      JOURNAL_PREVIOUS_NGINX_CONTAINER: "",
      JOURNAL_PREVIOUS_NGINX_RUNNING: "0",
      FAKE_DOCKER_LOG: fakeDockerLog,
    };
    const writeJournal = (phase = "precommit", extraEnvironment = {}) =>
      spawnSync(
        bash,
        [
          "-c",
          'PATH="$1:$PATH"; shift; exec bash "$@"',
          "deployment-journal-smoke",
          fakeBin,
          journalScriptPath,
          "write",
          phase,
        ],
        {
          cwd: repoRoot,
          env: { ...journalWriteEnvironment, ...extraEnvironment },
          encoding: "utf8",
        },
      );
    const firstJournalWrite = writeJournal();
    assert(
      firstJournalWrite.status === 0,
      `Deployment journal write failed: ${firstJournalWrite.stderr || firstJournalWrite.stdout}`,
    );
    const writtenJournal = read(join(journalRoot, ".deployment-journal.v1"));
    assert(
      writtenJournal.includes("phase precommit\n") &&
        writtenJournal.includes(`release_id ${releaseId}\n`) &&
        writtenJournal.includes("business_import_parser_enabled 0\n") &&
        writtenJournal.includes("previous_business_import_parser_container \n") &&
        writtenJournal.includes("previous_business_import_parser_running 0\n"),
      "Expected a durable precommit journal with the exact attempt identity.",
    );
    const duplicateJournalWrite = writeJournal();
    assert(
      duplicateJournalWrite.status !== 0 &&
        duplicateJournalWrite.stderr.includes("An unresolved deployment journal already exists.") &&
        read(join(journalRoot, ".deployment-journal.v1")) === writtenJournal,
      "Expected an unresolved journal to fence a second deployment attempt without changing evidence.",
    );
    symlinkSync(releaseDir, join(journalRoot, "current"), "dir");
    const changedParserGateCommit = writeJournal("committed", {
      JOURNAL_BUSINESS_IMPORT_PARSER_ENABLED: "1",
    });
    assert(
      changedParserGateCommit.status !== 0 &&
        changedParserGateCommit.stderr.includes(
          "Committed journal identity differs from precommit.",
        ) &&
        read(join(journalRoot, ".deployment-journal.v1")) === writtenJournal,
      "Expected the durable parser deployment decision to be immutable across commit.",
    );
    const committedJournalWrite = writeJournal("committed");
    assert(
      committedJournalWrite.status === 0 &&
        read(join(journalRoot, ".deployment-journal.v1")).includes("phase committed\n"),
      `Expected an exact precommit-to-committed transition: ${committedJournalWrite.stderr}`,
    );
    const staleReleaseId = "bbbbbbbbbbbb-attempt-Zy98Xw";
    const staleReleaseDir = join(journalRoot, "releases", staleReleaseId);
    mkdirSync(join(staleReleaseDir, "deploy"), { recursive: true });
    writeFileSync(join(staleReleaseDir, ".leadvirt-release-sha"), `${"b".repeat(40)}\n`);
    writeFileSync(join(staleReleaseDir, ".leadvirt-image-tag"), `${staleReleaseId}\n`);
    writeFileSync(join(staleReleaseDir, ".leadvirt-compose-project"), "deploy\n");
    writeFileSync(join(staleReleaseDir, "deploy", "docker-compose.staging.yml"), "services: {}\n");
    journalWriteEnvironment.FAKE_DOCKER_IMAGE_TAG = staleReleaseId;
    const pruneJournal = (extraEnvironment = {}) =>
      spawnSync(
        bash,
        [
          "-c",
          'PATH="$1:$PATH"; shift; exec bash "$@"',
          "deployment-journal-smoke",
          bashPath(fakeBin),
          bashPath(journalScriptPath),
          "prune",
          "0",
        ],
        {
          cwd: repoRoot,
          env: { ...journalWriteEnvironment, ...extraEnvironment },
          encoding: "utf8",
        },
      );
    const failedInventoryPrune = pruneJournal({ FAKE_DOCKER_PS_FAILURE: "1" });
    assert(
      failedInventoryPrune.status === 0 && existsSync(staleReleaseDir),
      `Expected failed reference discovery to retain the release: ${failedInventoryPrune.stderr}`,
    );
    const provenUnreferencedPrune = pruneJournal();
    assert(
      provenUnreferencedPrune.status === 0 &&
        !existsSync(staleReleaseDir) &&
        existsSync(releaseDir) &&
        read(fakeDockerLog) ===
          `leadvirt-app:${staleReleaseId}\nleadvirt-business-import-parser:${staleReleaseId}\n`,
      `Expected only the proven-unreferenced release to be pruned: ${provenUnreferencedPrune.stderr}`,
    );
  }
  const stagingCompose = read(join(repoRoot, "deploy/docker-compose.staging.yml"));
  const publicAppAnchor = stagingCompose.slice(
    stagingCompose.indexOf("x-leadvirt-app:"),
    stagingCompose.indexOf("x-leadvirt-runtime:"),
  );
  const runtimeAppAnchor = stagingCompose.slice(
    stagingCompose.indexOf("x-leadvirt-runtime:"),
    stagingCompose.indexOf("services:"),
  );
  const webService = stagingCompose.slice(
    stagingCompose.indexOf("  web:"),
    stagingCompose.indexOf("  nginx:"),
  );
  const parserService = stagingCompose.slice(
    stagingCompose.indexOf("  business-import-parser:"),
    stagingCompose.indexOf("  migrate:"),
  );
  const apiService = stagingCompose.slice(
    stagingCompose.indexOf("  api:"),
    stagingCompose.indexOf("  worker:"),
  );
  const workerService = stagingCompose.slice(
    stagingCompose.indexOf("  worker:"),
    stagingCompose.indexOf("  web:"),
  );
  const workerMain = read(join(repoRoot, "apps/worker/src/main.ts"));
  const workerMetricsServer = read(
    join(repoRoot, "apps/worker/src/observability/metrics-server.ts"),
  );
  const apiPreflight = read(join(repoRoot, "apps/api/src/common/api-deployment-preflight.ts"));
  const apiHealth = read(join(repoRoot, "apps/api/src/modules/health/health.controller.ts"));
  const apiReadiness = read(
    join(repoRoot, "apps/api/src/modules/health/runtime-readiness.service.ts"),
  );
  const authStagingReadiness = read(join(repoRoot, "artifacts/scripts/auth-staging-ready.mjs"));
  const apiWriterFiles = [
    "apps/api/src/modules/ai/runtime-queue.service.ts",
    "apps/api/src/modules/business-profile/business-import-queue.service.ts",
    "apps/api/src/modules/integrations/integration-requests.service.ts",
    "apps/api/src/modules/knowledge/knowledge-publication-dispatcher.service.ts",
    "apps/api/src/modules/knowledge/knowledge-source-queue.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-content-reconciliation.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-publication-dispatcher.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-review-decision.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-test-run.service.ts",
  ];
  assert(
    authStagingReadiness.includes('"INTEGRATION_REQUEST_EMAIL"') &&
      authStagingReadiness.includes("managed integration requests fail closed"),
    "Expected strict auth readiness to validate the managed-integration operator recipient.",
  );

  assert(
    parserService.includes(
      "image: leadvirt-business-import-parser:${LEADVIRT_IMAGE_TAG:-staging}",
    ) &&
      parserService.includes("restart: unless-stopped") &&
      parserService.includes("profiles:\n      - business-import-parser") &&
      parserService.includes("read_only: true") &&
      !parserService.includes("env_file:"),
    "Expected a release-tagged, restartable parser without application secrets.",
  );
  assert(
    !workerService.includes("business-import-parser:\n        condition:") &&
      workerService.includes("BUSINESS_IMPORT_PARSER_URL: ${BUSINESS_IMPORT_PARSER_URL:-}") &&
      workerService.includes(
        "BUSINESS_IMPORT_PARSER_VERSION: ${BUSINESS_IMPORT_PARSER_VERSION:-unconfigured}",
      ),
    "Expected core worker readiness to be independent from the optional parser container.",
  );
  const csvRolloutEnvironment = [
    'BUSINESS_IMPORT_ENABLED: "true"',
    'BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED: "false"',
    'BUSINESS_IMPORT_PARSER_APPROVED: "false"',
    'KNOWLEDGE_FILE_SCANNER_APPROVED: "true"',
    "KNOWLEDGE_FILE_SCANNER_HOST: clamav",
    'KNOWLEDGE_FILE_SCANNER_PORT: "3310"',
    "KNOWLEDGE_OBJECT_STORE_PATH: /var/lib/leadvirt/knowledge-artifacts",
  ];
  assert(
    publicAppAnchor.includes('NEXT_PUBLIC_BUSINESS_IMPORT_ENABLED: "true"') &&
      [apiService, workerService].every((service) =>
        csvRolloutEnvironment.every((entry) => service.includes(entry)),
      ) &&
      deployStepScript.includes("DEPLOY_GATE: business-import-csv-rollout-enabled") &&
      deployStepScript.includes("NEXT_PUBLIC_BUSINESS_IMPORT_ENABLED==='true'") &&
      deployStepScript.includes(
        "node /app/artifacts/scripts/business-import-production-ready.mjs",
      ) &&
      businessImportProductionReady.includes('BUSINESS_IMPORT_ENABLED: "true"') &&
      businessImportProductionReady.includes('BUSINESS_IMPORT_XLSX_SANDBOX_APPROVED: "false"') &&
      businessImportProductionReady.includes('BUSINESS_IMPORT_PARSER_APPROVED: "false"') &&
      businessImportProductionReady.includes("BUSINESS_IMPORT_OBJECT_STORE_UNAVAILABLE") &&
      businessImportProductionReady.includes("BUSINESS_IMPORT_OBJECT_STORE_PROBE_FAILED") &&
      businessImportProductionReady.includes("await handle.sync()") &&
      businessImportProductionReady.includes("BUSINESS_IMPORT_ENCRYPTION_KEY_INVALID") &&
      businessImportProductionReady.includes("BUSINESS_IMPORT_SCANNER_UNAVAILABLE") &&
      businessImportProductionReady.includes('Buffer.from("zINSTREAM\\0", "utf8")'),
    "Expected an exact, candidate-verified CSV-only Business Import production rollout.",
  );
  assert(
    authStagingReadiness.includes('emailOtpFlag === "true"') &&
      authStagingReadiness.includes('"AUTH_EMAIL_OTP_ENABLED"') &&
      authStagingReadiness.includes('telegramAuthFlag === "false"') &&
      authStagingReadiness.includes('"AUTH_TELEGRAM_ENABLED"'),
    "Expected strict auth readiness to require explicit email-only authentication flags.",
  );

  assert(
    publicAppAnchor.length > 0 &&
      !publicAppAnchor.includes("env_file:") &&
      runtimeAppAnchor.includes("env_file:") &&
      stagingCompose.includes("  migrate:\n    <<: *leadvirt-runtime") &&
      stagingCompose.includes("  api:\n    <<: *leadvirt-runtime") &&
      stagingCompose.includes("  worker:\n    <<: *leadvirt-runtime") &&
      webService.includes("<<: *leadvirt-app") &&
      !webService.includes("env_file:") &&
      !webService.includes("*leadvirt-runtime"),
    "Expected only API, worker, and migration containers to receive the production secrets env file.",
  );

  assert(
    stagingCompose.includes(
      "  clamav:\n    image: clamav/clamav:1.4.5@sha256:e7ead98e7e07231b151bce988e0cfb0a3b46e6e7046d9dd44fd838c0df724a03\n    platform: linux/amd64\n",
    ),
    "Expected the available ClamAV 1.4.5 runtime image to be pinned by OCI digest.",
  );

  assertOrdered(
    deployWorkflow,
    [
      "corepack pnpm exec playwright install --with-deps chromium",
      "corepack pnpm exec playwright test artifacts/playwright/inbox-live-refresh.spec.ts --reporter=line --workers=1",
    ],
    "Expected the matching Chromium binary before live Inbox acceptance",
  );

  const parserImageSmoke = workflowRunBlock(deployWorkflow, "Verify business import parser image");
  const parserImageSmokeSyntax = spawnSync(bash, ["-n", "-s"], {
    input: parserImageSmoke,
    encoding: "utf8",
  });
  assert(
    parserImageSmokeSyntax.status === 0 &&
      parserImageSmoke.includes(
        'if [ "$BUSINESS_IMPORT_ENABLED" != "true" ] || [ "$BUSINESS_IMPORT_PARSER_APPROVED" != "true" ]; then',
      ) &&
      deployWorkflow.includes('BUSINESS_IMPORT_PARSER_APPROVED: "true"') &&
      parserImageSmoke.includes(
        "docker build --tag leadvirt-business-import-parser:ci deploy/business-import-parser",
      ) &&
      parserImageSmoke.includes("--read-only \\") &&
      parserImageSmoke.includes("--cap-drop ALL \\") &&
      parserImageSmoke.includes("--security-opt no-new-privileges \\") &&
      parserImageSmoke.includes("--pids-limit 64 \\") &&
      parserImageSmoke.includes("--memory 768m \\") &&
      parserImageSmoke.includes("payload.get('version') == 'poppler-tesseract-v1'") &&
      parserImageSmoke.includes("payload.get('contractVersion') == 'leadvirt.pdf-extraction.v1'") &&
      parserImageSmoke.includes(
        'docker exec -i "$parser_container" python - < deploy/business-import-parser/runtime_smoke.py',
      ) &&
      parserImageSmoke.includes("PRIVATE_SERVICE_SENTINEL_7843") &&
      parserImageSmoke.includes("SERVICE PRICE 25 EUR") &&
      parserImageSmoke.includes("Business import parser leaked extracted content") &&
      parserImageSmoke.includes('trap \'docker rm -f "$parser_container"'),
    `Expected CI to build and health-check the hardened parser image contract: ${parserImageSmokeSyntax.stderr}`,
  );

  assert(
    deployWorkflow.includes(
      'validator_script="$release_dir/artifacts/scripts/knowledge-v2-staging-ready.mjs"',
    ) &&
      deployWorkflow.includes(
        '[ ! -f "$validator_script" ] || [ -L "$validator_script" ] || [ ! -r "$validator_script" ]',
      ) &&
      deployWorkflow.includes(
        '[ ! -f "$DEPLOY_ENV_FILE" ] || [ -L "$DEPLOY_ENV_FILE" ] || [ ! -r "$DEPLOY_ENV_FILE" ]',
      ) &&
      deployWorkflow.includes(
        'key_canonicalizer="$release_dir/artifacts/scripts/knowledge-artifact-key-canonicalize.mjs"',
      ) &&
      deployWorkflow.includes("--cap-add CHOWN \\") &&
      deployWorkflow.includes("--cap-add DAC_OVERRIDE \\") &&
      deployWorkflow.includes("src=$key_canonicalizer,dst=/canonicalizer.mjs,readonly") &&
      deployWorkflow.includes("src=$deploy_env_directory,dst=/run/leadvirt-secrets") &&
      deployWorkflow.includes('node /canonicalizer.mjs "/run/leadvirt-secrets/$deploy_env_name"') &&
      deployWorkflow.includes("docker run --rm \\") &&
      deployWorkflow.includes("--network none \\") &&
      deployWorkflow.includes("--read-only \\") &&
      deployWorkflow.includes("--cap-drop ALL \\") &&
      deployWorkflow.includes("--security-opt no-new-privileges \\") &&
      deployWorkflow.includes("--pids-limit 64 \\") &&
      deployWorkflow.includes("--memory 128m \\") &&
      deployWorkflow.includes("--cpus 0.5 \\") &&
      deployWorkflow.includes('--user "$(id -u):$(id -g)" \\') &&
      deployWorkflow.includes("src=$validator_script,dst=/validator.mjs,readonly") &&
      deployWorkflow.includes("src=$DEPLOY_ENV_FILE,dst=/run/secrets/leadvirt.env,readonly") &&
      deployWorkflow.includes(
        "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d \\",
      ) &&
      deployWorkflow.includes("node /validator.mjs /run/secrets/leadvirt.env") &&
      !deployWorkflow.includes(
        'node "$release_dir/artifacts/scripts/knowledge-v2-staging-ready.mjs"',
      ),
    "Expected staging readiness to use an isolated Node 24 container without a VPS host runtime.",
  );
  assertOrdered(
    deployWorkflow,
    [
      'printf \'%s\\n\' "$release_id" > "$release_dir/.leadvirt-image-tag"',
      'key_canonicalizer="$release_dir/artifacts/scripts/knowledge-artifact-key-canonicalize.mjs"',
      'node /canonicalizer.mjs "/run/leadvirt-secrets/$deploy_env_name"',
      "DEPLOY_PREPARE: knowledge-artifact-key-canonical",
      "node /validator.mjs /run/secrets/leadvirt.env",
      'bash "$release_dir/artifacts/scripts/deployment-journal.sh" install-service',
    ],
    "Expected isolated staging readiness before deployment service installation",
  );

  const deployExecutionMarker = 'active_root="$(readlink -f "$current_link" 2>/dev/null || true)"';
  const deployExecutionIndex = deployWorkflow.indexOf(deployExecutionMarker);
  assert(deployExecutionIndex >= 0, "Expected the remote deployment execution block.");
  const deployExecution = deployWorkflow.slice(deployExecutionIndex);
  const rollforwardStart = deploymentJournal.indexOf("recover_committed() {");
  const rollforwardEnd = deploymentJournal.indexOf("\nreconcile() {", rollforwardStart);
  assert(
    rollforwardStart >= 0 && rollforwardEnd > rollforwardStart,
    "Expected a bounded durable candidate-only roll-forward function.",
  );
  const rollforwardBody = deploymentJournal.slice(rollforwardStart, rollforwardEnd);
  const rollbackStart = deploymentJournal.indexOf("recover_precommit() {");
  const rollbackEnd = deploymentJournal.indexOf("\njournal_compose() {", rollbackStart);
  assert(
    rollbackStart >= 0 && rollbackEnd > rollbackStart,
    "Expected a bounded durable exact-state rollback function.",
  );
  const rollbackBody = deploymentJournal.slice(rollbackStart, rollbackEnd);

  assertOrdered(
    deployExecution,
    [
      "release_compose config --quiet",
      "release_compose build migrate",
      'business_import_parser_enabled="$(release_compose run --rm --no-deps -T api node -e',
      "release_compose build business-import-parser",
      "release_compose up -d --no-recreate postgres redis qdrant clamav",
      "wait_for_stateful_dependencies",
      'telegram_bot_api_base="$(release_compose run --rm --no-deps -T api printenv',
      "relay_status=",
      "assert_previous_containers_unchanged",
      "persist_deployment_journal precommit",
      'deployment_phase="rollback"',
      '--name "$candidate_parser_container"',
      "business-import-parser >/dev/null",
      '--name "$candidate_api_container"',
      "-e API_DEPLOYMENT_PREFLIGHT=true",
      'candidate_worker_parser_args=(-e "BUSINESS_IMPORT_PARSER_URL=http://$candidate_parser_container:8080")',
      '--name "$candidate_worker_container"',
      "-e WORKER_DEPLOYMENT_PAUSED=true",
      '--name "$candidate_web_container"',
      "DEPLOY_GATE: business-import-csv-rollout-enabled",
      "Candidate business import parser did not become ready with the expected contract.",
      "deploymentPreflight===true",
      "Paused candidate worker preflight did not become ready.",
      "Candidate worker cannot reach the candidate business import parser contract.",
      "Candidate web preflight did not become ready.",
      "release_compose run --rm --no-deps -T nginx nginx -t",
      "remove_candidate_preflights",
      "assert_previous_containers_unchanged",
      "DEPLOY_GATE: isolated-candidate-api-worker-and-web-ready parser-enabled=",
      'docker stop --time 120 "${previous_writer_container_ids[@]}"',
      "DEPLOY_GATE: exact-prior-writers-drained",
      'docker stop --time 30 "${previous_nginx_container_ids[@]}"',
      "DEPLOY_GATE: public-nginx-stopped",
      'atomic_replace_current_symlink "$release_dir"',
      "persist_deployment_journal committed",
      'deployment_phase="rollforward"',
      "DEPLOY_COMMIT: old-code-rollback-disarmed",
      "rollforward_candidate primary",
      "DEPLOY_COMPLETE: health-worker-and-key-coverage-succeeded",
      'deployment_phase="complete"',
      "trap - EXIT HUP INT TERM",
      'bash "$installed_deployment_journal" prune 5',
      'printf \'DEPLOY_REMOTE_COMPLETE:%s:%s\\n\' "$RELEASE_SHA" "$DEPLOY_COMPLETION_TOKEN"',
      "\n          REMOTE\n",
      'grep -Fx "DEPLOY_REMOTE_COMPLETE:$GITHUB_SHA:$remote_completion_token" "$remote_deploy_log"',
    ],
    "Expected optional parser and core app preflight before candidate-only commit and remote completion",
  );

  assertOrdered(
    rollforwardBody,
    [
      "remove_candidate_preflights",
      "stop_project_services api worker business-import-parser nginx",
      "wait_stateful_dependencies",
      "--exit-code-from migrate migrate",
      "journal_compose up -d --no-deps --no-build --force-recreate business-import-parser",
      "wait_parser_container_health",
      "remove_project_service_containers business-import-parser",
      "journal_compose_paused_worker up -d --no-deps --no-build --force-recreate api worker web",
      "deploymentPreflight===false",
      "x.v.ready&&!x.v.active&&x.v.deploymentPaused",
      "fetch('http://127.0.0.1:3001')",
      "knowledge-query-hmac-retained-keys-ready.ts",
      "journal_compose run --rm --no-deps -T nginx nginx -t",
      "journal_compose kill -s SIGUSR2 worker",
      "x.v.ready&&x.v.active",
      "journal_compose up -d --no-deps --no-build --force-recreate nginx",
      'curl -fsS "$journal_public_url/health/ready"',
      'curl -fsS "$journal_public_url/"',
      '"$journal_public_url/api/auth/me"',
      "clear_journal",
    ],
    "Expected durable migration-first roll-forward to prove the candidate before reopening nginx",
  );
  assert(
    rollforwardBody.includes('if [ "$journal_business_import_parser_enabled" = "1" ]; then') &&
      rollforwardBody.includes("remove_project_service_containers business-import-parser") &&
      deploymentJournal.includes('BUSINESS_IMPORT_PARSER_URL="$parser_url"') &&
      deploymentJournal.includes('parser_url=""') &&
      deploymentJournal.includes('parser_version="unconfigured"'),
    "Expected committed recovery to start and prove only an enabled parser, or remove every disabled canonical parser container.",
  );
  assert(
    (deploymentJournal.match(/--exit-code-from migrate/g) ?? []).length === 1 &&
      !rollforwardBody.includes("docker start") &&
      !deployExecution
        .slice(0, deployExecution.indexOf("DEPLOY_COMMIT:"))
        .includes("--exit-code-from migrate"),
    "Expected migrations only inside candidate-only roll-forward after rollback is disarmed.",
  );

  assertOrdered(
    rollbackBody,
    [
      "remove_candidate_preflights",
      "verify_prior_identity",
      'set_container_running "$nginx_id" 0',
      "restore_previous_current",
      "for service in business-import-parser api worker web",
      "wait_parser_container_health",
      "wait_container_http",
      '"http://127.0.0.1:4002/health/ready"',
      'set_container_running "$nginx_id" "${journal[previous_nginx_running]}"',
      "verify_prior_identity",
      "verify_prior_running_state",
      'curl -fsS "$journal_public_url/health/ready"',
      '"$journal_public_url/api/auth/me"',
      "clear_journal",
    ],
    "Expected exact recorded precommit containers and current path to be restored before traffic",
  );

  assert(
    deployWorkflow.includes(
      'release_dir="$(mktemp -d "$DEPLOY_ROOT/releases/${release_sha_id}-attempt-XXXXXX")"',
    ) &&
      deployWorkflow.includes('exec 9>"$DEPLOY_ROOT/.deploy.lock"') &&
      deployWorkflow.includes("if ! flock -n 9; then") &&
      deployWorkflow.includes(
        'printf \'%s\\n\' "$RELEASE_SHA" > "$release_dir/.leadvirt-release-sha"',
      ) &&
      !deployWorkflow.includes('rm -rf "$release_dir"'),
    "Expected every deployment attempt to use a unique release path while retaining SHA identity.",
  );

  assert(
    deployWorkflow.includes("docker ps -a --no-trunc \\") &&
      deployWorkflow.includes('--filter "label=com.docker.compose.service=$service"') &&
      deployWorkflow.includes('--filter "label=com.docker.compose.oneoff=False"') &&
      deployWorkflow.includes("com.docker.compose.project.working_dir") &&
      deployWorkflow.includes("com.docker.compose.project.config_files") &&
      deployWorkflow.includes("Ambiguous canonical Compose projects for the prior release") &&
      deployWorkflow.includes(
        "No unambiguous canonical Compose project is tied to the current release.",
      ) &&
      deployWorkflow.includes(
        'previous_project_marker="$previous_root/.leadvirt-compose-project"',
      ) &&
      deployWorkflow.includes('marker_size="$(wc -c < "$previous_project_marker"') &&
      deployWorkflow.includes('tail -c 1 "$previous_project_marker"') &&
      deployWorkflow.includes(
        "Canonical container project disagrees with the current release marker.",
      ) &&
      deployWorkflow.includes("previous_running_container_by_service") &&
      deployWorkflow.includes(
        'printf \'%s\\n\' "$compose_project_name" > "$release_dir/.leadvirt-compose-project"',
      ) &&
      !deployWorkflow.includes('ps -q "$service"') &&
      (deployWorkflow.match(/--project-name "\$compose_project_name"/g) ?? []).length >= 2,
    "Expected stopped-aware discovery to retain one authoritative Compose project.",
  );
  assert(
    deployWorkflow.includes("wait_for_stateful_dependencies()") &&
      deployWorkflow.includes("pg_isready -U leadvirt -d leadvirt") &&
      deployWorkflow.includes("redis-cli ping | grep -Fx PONG") &&
      deployWorkflow.includes("fetch('http://qdrant:6333/healthz'") &&
      deployWorkflow.includes("host:'clamav',port:3310") &&
      deployWorkflow.includes("DEPLOY_PREPARE: stateful-dependencies-ready"),
    "Expected bounded app-network readiness for every stateful dependency.",
  );
  assert(
    deployWorkflow.includes('previous_link_target="$(readlink "$current_link")"') &&
      deployWorkflow.includes('mv -Tf -- "$pending_current_link" "$current_link"') &&
      !deployWorkflow.includes("ln -sfn") &&
      deploymentJournal.includes(
        'atomic_replace_current_symlink "$journal_previous_link_target"',
      ) &&
      deploymentJournal.includes("current_resolves_to_candidate || return 1") &&
      deploymentJournal.includes('mv -- "$journal_previous_backup_dir" "$current_link"'),
    "Expected rollback to restore the exact prior current target without removing an unowned path.",
  );
  assert(
    deployWorkflow.includes('previous_current_kind="missing"') &&
      deploymentJournal.includes("First-deploy journal cannot claim prior app containers") &&
      deploymentJournal.includes("remove_candidate_current"),
    "Expected first-deploy rollback handling.",
  );
  assert(
    deployWorkflow.includes("trap handle_deployment_exit EXIT") &&
      !deployWorkflow.includes("--use-aliases") &&
      deployWorkflow.includes('--name "$candidate_parser_container"') &&
      deployWorkflow.includes(
        'release_compose run -d --no-deps \\\n            --name "$candidate_api_container"',
      ) &&
      deployWorkflow.includes(
        'release_compose run -d --no-deps \\\n            --name "$candidate_web_container"',
      ) &&
      deployWorkflow.includes(
        'for candidate_container in "$candidate_parser_container" "$candidate_api_container" "$candidate_worker_container" "$candidate_web_container"; do',
      ) &&
      deployWorkflow.includes('previous_container_by_service[$service]="$candidate_container"') &&
      deployWorkflow.includes(
        "Canonical $service container changed while deployment preflight was running.",
      ) &&
      deployWorkflow.includes('bash "$installed_deployment_journal" reconcile') &&
      deploymentJournal.includes("verify_recorded_container") &&
      deploymentJournal.includes("verify_prior_running_state") &&
      deploymentJournal.includes("journal retained and nginx held stopped") &&
      deployWorkflow.includes('exit "$original_status"'),
    "Expected alias-isolated candidate preflights and trapped failures to use the durable startup reconciler.",
  );
  assert(
    deployWorkflow.includes("business_import_parser_enabled=0") &&
      deployWorkflow.includes('business_import_parser_url=""') &&
      deployWorkflow.includes('business_import_parser_version="unconfigured"') &&
      deployExecution.includes(
        "parse('BUSINESS_IMPORT_ENABLED')&&parse('BUSINESS_IMPORT_PARSER_APPROVED')?'1':'0'",
      ) &&
      deployExecution.includes('if [ "$business_import_parser_enabled" = "1" ]; then') &&
      deployExecution.includes("candidate_worker_parser_args=()") &&
      deployExecution.includes('"${candidate_worker_parser_args[@]}"') &&
      !deployExecution.includes(
        '-e BUSINESS_IMPORT_PARSER_URL="http://$candidate_parser_container:8080"',
      ),
    "Expected disabled deployment to skip parser build, candidate, health, and worker URL while preserving core preflight.",
  );
  assert(
    deployWorkflow.includes(
      "for service in api worker web business-import-parser nginx postgres redis qdrant clamav",
    ) &&
      deployWorkflow.includes("api|worker|web|business-import-parser|nginx") &&
      deployWorkflow.includes(
        'JOURNAL_PREVIOUS_BUSINESS_IMPORT_PARSER_CONTAINER="${previous_container_by_service[business-import-parser]:-}"',
      ) &&
      deployWorkflow.includes(
        'JOURNAL_PREVIOUS_BUSINESS_IMPORT_PARSER_RUNNING="$previous_business_import_parser_running"',
      ) &&
      deployWorkflow.includes(
        'JOURNAL_BUSINESS_IMPORT_PARSER_ENABLED="$business_import_parser_enabled"',
      ) &&
      deploymentJournal.includes(
        "tracked_release_services=(api worker web business-import-parser nginx)",
      ) &&
      deploymentJournal.includes("business_import_parser_enabled %s") &&
      deploymentJournal.includes(
        "release_image_repositories=(leadvirt-app leadvirt-business-import-parser)",
      ) &&
      deploymentJournal.includes('image_tag_is_referenced "$repository" "$tag"'),
    "Expected the parser to share exact release ownership and image-retention accounting.",
  );
  assertOrdered(
    deploymentJournal,
    [
      'sync_path "$temporary_journal"',
      'mv -Tf -- "$temporary_journal" "$journal_file"',
      'sync_path "$DEPLOY_ROOT"',
    ],
    "Expected journal replacement to fsync the file before rename and its parent after rename",
  );
  assert(
    deploymentJournal.includes("Only a precommit journal can transition to committed.") &&
      deploymentJournal.includes("Committed journal identity differs from precommit.") &&
      deploymentJournal.includes("Current does not point to the candidate at journal commit.") &&
      deploymentJournal.includes("HostConfig.RestartPolicy.Name") &&
      deploymentJournal.includes(
        "Prior $service container contract is unsafe for reboot recovery.",
      ) &&
      deploymentJournal.includes("systemctl enable leadvirt-deployment-reconcile.service") &&
      deploymentJournal.includes("systemctl is-enabled --quiet") &&
      deploymentJournal.includes("sync_path /etc/systemd/system/multi-user.target.wants") &&
      deploymentJournal.includes("After=docker.service network-online.target") &&
      deployWorkflow.indexOf('bash "$installed_deployment_journal" reconcile') <
        deployWorkflow.indexOf('release_dir="$(mktemp -d') &&
      deployWorkflow.includes(
        'bash "$release_dir/artifacts/scripts/deployment-journal.sh" install-service',
      ),
    "Expected attempt-fenced journal transitions and reconciliation on both deploy and host startup.",
  );
  assert(
    deploymentJournal.includes("release_is_referenced") &&
      deploymentJournal.includes("managed_release") &&
      deploymentJournal.includes("image_tag_is_referenced") &&
      deploymentJournal.includes(
        'symlink_paths="$(find "$DEPLOY_ROOT" -mindepth 1 -maxdepth 1 -type l -print)" || return 0',
      ) &&
      deploymentJournal.includes('container_references="$(docker ps -a --no-trunc') &&
      deploymentJournal.includes('container_ids="$(docker ps -aq --no-trunc)" || return 0') &&
      deploymentJournal.includes('container_image="$(docker inspect') &&
      deploymentJournal.includes('release_listing="$(') &&
      deploymentJournal.includes('for repository in "${release_image_repositories[@]}"; do') &&
      deploymentJournal.includes(
        "docker image ls \"$repository\" --format '{{.Repository}} {{.Tag}}'",
      ) &&
      deploymentJournal.includes("Release ownership changed during pruning.") &&
      !deployWorkflow.includes("tail -n +6") &&
      !deployWorkflow.includes("xargs -r rm -rf"),
    "Expected pruning to remove only validated releases and image tags with no durable references.",
  );
  assert(
    deploymentJournal.includes("deploymentPreflight===false") &&
      stagingCompose.includes('API_DEPLOYMENT_PREFLIGHT: "false"') &&
      apiHealth.includes("deploymentPreflight: isApiDeploymentPreflight()"),
    "Expected candidate and canonical API health checks to prove opposite deployment modes.",
  );
  assert(
    deployStepScript.includes("http://127.0.0.1:4001/api/auth/email-otp/config") &&
      deployStepScript.includes("x.ok&&x.v.data?.enabled===true") &&
      deployStepScript.includes(
        "Candidate API email OTP authentication is not enabled and ready.",
      ) &&
      deployStepScript.includes("http://127.0.0.1:4001/api/auth/telegram/config") &&
      deployStepScript.includes(
        "x.ok&&x.v.data?.enabled===false&&x.v.data?.botId===null&&x.v.data?.botUsername===null",
      ) &&
      deployStepScript.includes(
        "Candidate API Telegram account authentication is not explicitly disabled.",
      ),
    "Expected isolated candidate API checks to prove the email-only authentication contract.",
  );
  assertOrdered(
    deployStepScript,
    [
      "http://127.0.0.1:4001/health/ready",
      "http://127.0.0.1:4001/api/auth/email-otp/config",
      "http://127.0.0.1:4001/api/auth/telegram/config",
      "DEPLOY_GATE: candidate-email-otp-enabled-and-telegram-auth-disabled",
      "DEPLOY_GATE: isolated-candidate-api-worker-and-web-ready parser-enabled=",
      "DEPLOY_GATE: exact-prior-writers-drained",
    ],
    "Expected candidate auth checks before draining the prior release",
  );
  assert(
    apiPreflight.includes("API_DEPLOYMENT_PREFLIGHT?.trim().toLowerCase()") &&
      apiPreflight.includes('throw new Error("API_DEPLOYMENT_PREFLIGHT must be a boolean value.")'),
    "Expected invalid API preflight mode values to fail closed.",
  );

  const apiRoot = join(repoRoot, "apps/api/src");
  const startupHookFiles = sourceFiles(apiRoot)
    .filter((path) => read(path).includes("onModuleInit()"))
    .map((path) => path.slice(repoRoot.length + 1).replaceAll("\\", "/"))
    .sort();
  const classifiedStartupHooks = [
    ...apiWriterFiles,
    "apps/api/src/modules/database/prisma.service.ts",
    "apps/api/src/modules/metrics/knowledge-dependency-health.service.ts",
  ].sort();
  assert(
    JSON.stringify(startupHookFiles) === JSON.stringify(classifiedStartupHooks),
    `Expected every API startup hook to remain classified; found ${startupHookFiles.join(", ")}.`,
  );
  for (const file of apiWriterFiles) {
    const source = read(join(repoRoot, file));
    const hook = source.indexOf("onModuleInit()");
    const guard = source.indexOf("if (isApiDeploymentPreflight()) return;", hook);
    const timer = source.indexOf("this.timer = setInterval", hook);
    assert(
      source.includes("api-deployment-preflight.js") && hook >= 0 && guard > hook && timer > guard,
      `Expected ${file} to disable its recurring writer before scheduling work.`,
    );
  }
  assert(
    !deployWorkflow.includes("docker compose down") &&
      !deployWorkflow.includes("docker volume rm") &&
      !deploymentJournal.includes("docker compose down") &&
      !deploymentJournal.includes("docker volume rm"),
    "Deployment rollback must not tear down shared infrastructure or volumes.",
  );

  assert(
    stagingCompose.includes(
      "corepack pnpm --filter @leadvirt/db db:migrate && corepack pnpm --filter @leadvirt/api exec tsx ../../artifacts/scripts/knowledge-query-hmac-retained-keys-ready.ts",
    ),
    "Expected the migration gate to retain pre-start HMAC key coverage.",
  );
  assert(
    (stagingCompose.match(/condition: service_completed_successfully/g) ?? []).length >= 2,
    "Expected API and worker to remain gated on successful migration completion.",
  );
  assert(
    stagingCompose.includes("stop_grace_period: 30s") &&
      stagingCompose.includes("stop_grace_period: 2m"),
    "Expected explicit API and worker drain periods.",
  );
  assert(
    stagingCompose.includes("working_dir: /app/apps/api") &&
      stagingCompose.includes(
        'command: ["node", "--import", "tsx", "dist/apps/api/src/main.js"]',
      ) &&
      stagingCompose.includes("working_dir: /app/apps/worker") &&
      stagingCompose.includes(
        'command: ["node", "--import", "tsx", "dist/apps/worker/src/main.js"]',
      ) &&
      stagingCompose.includes("WORKER_DEPLOYMENT_PAUSED: ${WORKER_DEPLOYMENT_PAUSED:-false}") &&
      stagingCompose.includes("http://127.0.0.1:4002/health/ready") &&
      stagingCompose.includes("x.v.ready&&x.v.active?0:1"),
    "Expected Compose to expose and gate the active worker contract.",
  );
  assert(
    workerMain.includes("autorun: false") &&
      workerMain.includes("await worker.waitUntilReady()") &&
      workerMain.includes("await rename(temporaryPath, activationMarkerPath)") &&
      workerMain.includes('process.on("SIGUSR2"') &&
      workerMain.includes("if (deploymentPaused && !(await activationMarkerExists()))") &&
      workerMain.includes("const workerRunPromises = new Map") &&
      workerMain.includes("const workerRunFailures = new Map"),
    "Expected a connected paused worker with persistent same-container activation.",
  );
  assertOrdered(
    workerMain,
    [
      "await startRuntimeOutbox();",
      "const runPromise = worker.run();",
      "workerRunPromises.set(worker, runPromise);",
      "void runPromise.catch((error) => {",
      "health.active = false;",
      "void shutdown(1);",
      "await new Promise<void>((resolve) => setImmediate(resolve));",
      "workerRunFailures.has(worker)",
      "!worker.isRunning()",
      "health.active = true;",
    ],
    "Expected worker activation to prove outbox and BullMQ run-loop startup before reporting active",
  );
  assert(
    workerMetricsServer.includes('pathname === "/health" || pathname === "/health/live"') &&
      workerMetricsServer.includes('pathname === "/health/ready"') &&
      workerMetricsServer.includes('health.status === "ready" ? 200 : 503') &&
      workerMetricsServer.includes("dependencies: { database, redis }") &&
      workerMetricsServer.includes("if (readinessPromise) return readinessPromise"),
    "Expected worker liveness and dependency-backed readiness to remain separate.",
  );
  assert(
    apiHealth.includes('status: "alive"') &&
      apiHealth.includes("@Inject(RuntimeReadinessService)") &&
      apiHealth.includes("this.readiness.check()") &&
      apiHealth.includes("HttpStatus.SERVICE_UNAVAILABLE") &&
      apiReadiness.includes("this.prisma.$queryRaw`SELECT 1`") &&
      apiReadiness.includes("RedisReadinessProbe"),
    "Expected API liveness to stay shallow and readiness to probe PostgreSQL and Redis.",
  );

  console.log("PASS: release readiness scripts and failure-atomic deployment gate checks passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
