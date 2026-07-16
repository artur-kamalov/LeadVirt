import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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

  if (process.platform !== "win32") {
    const journalRoot = join(tempDir, "deployment-journal-root");
    const releaseId = "abcdef123456-attempt-Ab12Cd";
    const releaseSha = "a".repeat(40);
    const releaseDir = join(journalRoot, "releases", releaseId);
    const fakeBin = join(tempDir, "deployment-journal-bin");
    const fakeDocker = join(fakeBin, "docker");
    const journalEnvFile = join(journalRoot, "secrets", ".env");
    mkdirSync(join(releaseDir, "deploy"), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(join(journalRoot, "secrets"), { recursive: true });
    writeFileSync(join(releaseDir, ".leadvirt-release-sha"), `${releaseSha}\n`);
    writeFileSync(join(releaseDir, ".leadvirt-image-tag"), `${releaseId}\n`);
    writeFileSync(join(releaseDir, ".leadvirt-compose-project"), "deploy\n");
    writeFileSync(join(releaseDir, "deploy", "docker-compose.staging.yml"), "services: {}\n");
    writeFileSync(journalEnvFile, "POSTGRES_PASSWORD=contract-only\n");
    writeFileSync(
      fakeDocker,
      [
        "#!/usr/bin/env bash",
        'case "${1:-}" in',
        "  info) exit 0 ;;",
        '  ps) [ "${FAKE_DOCKER_PS_FAILURE:-0}" = "1" ] && exit 92; exit 0 ;;',
        '  image) [ "${2:-}" = "ls" ] && exit 0; exit 91 ;;',
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
      JOURNAL_PREVIOUS_NGINX_CONTAINER: "",
      JOURNAL_PREVIOUS_NGINX_RUNNING: "0",
    };
    const writeJournal = () =>
      spawnSync(
        bash,
        [
          "-c",
          'PATH="$1:$PATH"; shift; exec bash "$@"',
          "deployment-journal-smoke",
          fakeBin,
          journalScriptPath,
          "write",
          "precommit",
        ],
        { cwd: repoRoot, env: journalWriteEnvironment, encoding: "utf8" },
      );
    const firstJournalWrite = writeJournal();
    assert(
      firstJournalWrite.status === 0,
      `Deployment journal write failed: ${firstJournalWrite.stderr || firstJournalWrite.stdout}`,
    );
    const writtenJournal = read(join(journalRoot, ".deployment-journal.v1"));
    assert(
      writtenJournal.includes("phase precommit\n") &&
        writtenJournal.includes(`release_id ${releaseId}\n`),
      "Expected a durable precommit journal with the exact attempt identity.",
    );
    const duplicateJournalWrite = writeJournal();
    assert(
      duplicateJournalWrite.status !== 0 &&
        duplicateJournalWrite.stderr.includes("An unresolved deployment journal already exists.") &&
        read(join(journalRoot, ".deployment-journal.v1")) === writtenJournal,
      "Expected an unresolved journal to fence a second deployment attempt without changing evidence.",
    );
    const staleReleaseId = "bbbbbbbbbbbb-attempt-Zy98Xw";
    const staleReleaseDir = join(journalRoot, "releases", staleReleaseId);
    mkdirSync(join(staleReleaseDir, "deploy"), { recursive: true });
    writeFileSync(join(staleReleaseDir, ".leadvirt-release-sha"), `${"b".repeat(40)}\n`);
    writeFileSync(join(staleReleaseDir, ".leadvirt-image-tag"), `${staleReleaseId}\n`);
    writeFileSync(join(staleReleaseDir, ".leadvirt-compose-project"), "deploy\n");
    writeFileSync(join(staleReleaseDir, "deploy", "docker-compose.staging.yml"), "services: {}\n");
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
        existsSync(releaseDir),
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
  const workerMain = read(join(repoRoot, "apps/worker/src/main.ts"));
  const workerMetricsServer = read(
    join(repoRoot, "apps/worker/src/observability/metrics-server.ts"),
  );
  const apiPreflight = read(join(repoRoot, "apps/api/src/common/api-deployment-preflight.ts"));
  const apiHealth = read(join(repoRoot, "apps/api/src/modules/health/health.controller.ts"));
  const apiReadiness = read(
    join(repoRoot, "apps/api/src/modules/health/runtime-readiness.service.ts"),
  );
  const apiWriterFiles = [
    "apps/api/src/modules/ai/runtime-queue.service.ts",
    "apps/api/src/modules/knowledge/knowledge-publication-dispatcher.service.ts",
    "apps/api/src/modules/knowledge/knowledge-source-queue.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-content-reconciliation.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-publication-dispatcher.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-review-decision.service.ts",
    "apps/api/src/modules/knowledge/knowledge-v2-test-run.service.ts",
  ];

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

  assertOrdered(
    deployWorkflow,
    [
      "corepack pnpm exec playwright install --with-deps chromium",
      "corepack pnpm exec playwright test artifacts/playwright/inbox-live-refresh.spec.ts --reporter=line --workers=1",
    ],
    "Expected the matching Chromium binary before live Inbox acceptance",
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
      "release_compose up -d --no-recreate postgres redis qdrant clamav",
      "wait_for_stateful_dependencies",
      'telegram_bot_api_base="$(release_compose run --rm --no-deps -T api printenv',
      "relay_status=",
      "assert_previous_containers_unchanged",
      "persist_deployment_journal precommit",
      'deployment_phase="rollback"',
      '--name "$candidate_api_container"',
      "-e API_DEPLOYMENT_PREFLIGHT=true",
      '--name "$candidate_worker_container"',
      "-e WORKER_DEPLOYMENT_PAUSED=true",
      '--name "$candidate_web_container"',
      "deploymentPreflight===true",
      "Paused candidate worker preflight did not become ready.",
      "Candidate web preflight did not become ready.",
      "release_compose run --rm --no-deps -T nginx nginx -t",
      "remove_candidate_preflights",
      "assert_previous_containers_unchanged",
      "DEPLOY_GATE: isolated-candidate-api-worker-and-web-ready",
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
    ],
    "Expected three-service preflight before drain and an explicit candidate-only commit",
  );

  assertOrdered(
    rollforwardBody,
    [
      "remove_candidate_preflights",
      "stop_project_services api worker nginx",
      "wait_stateful_dependencies",
      "--exit-code-from migrate migrate",
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
      "for service in api worker web",
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
      deployWorkflow.includes(
        'release_compose run -d --no-deps \\\n            --name "$candidate_api_container"',
      ) &&
      deployWorkflow.includes(
        'release_compose run -d --no-deps \\\n            --name "$candidate_web_container"',
      ) &&
      deployWorkflow.includes(
        'for candidate_container in "$candidate_api_container" "$candidate_worker_container" "$candidate_web_container"; do',
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
      deploymentJournal.includes('image_listing="$(docker image ls leadvirt-app') &&
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
