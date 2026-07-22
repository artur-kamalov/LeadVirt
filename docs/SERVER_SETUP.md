# LeadVirt Server Setup

Last updated: 2026-07-15

## Chosen Server Baseline

- Size: `medium` (`6 vCPU / 12 GB RAM / 160 GB SSD`)
- OS: Ubuntu 24.04 LTS
- Network: `1 IPv4 - Free`
- Hostname: `leadvirt-staging-01`
- Public IPv4: `193.187.92.88`

## SSH Key

Local private key:

```text
C:\Users\camal\.ssh\leadvirt-staging-01_ed25519
```

Public key to paste into the provider panel:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC6GqBM8XOBPX7/QD1iSYyn6TXBjd3C6OrdIMFfXvCyG leadvirt-staging-01
```

Fingerprint:

```text
SHA256:eBkEykzuVQ9RP89QO42ADkHI+QQDsDquKY0efCsK9f0
```

GitHub Actions deploy key installed for `deploy`:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL5FU5NoP1xqvy0VywGcZ8YKeXBYOzht7Aleg9d1R7uK leadvirt-github-actions
```

Fingerprint:

```text
SHA256:DgKg84mqLLPgKMr4Rui6MYf6Q8IXw6vsreNHLoRltvE
```

## Post-Install Script

Script:

```text
artifacts/scripts/server-post-install.sh
```

Run it as `root` after the server is created:

```bash
HOSTNAME=leadvirt-staging-01 \
DEPLOY_USER=deploy \
PUBLIC_SSH_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC6GqBM8XOBPX7/QD1iSYyn6TXBjd3C6OrdIMFfXvCyG leadvirt-staging-01' \
bash server-post-install.sh
```

What it prepares:

- hostname and `/etc/hosts`
- `deploy` user with SSH key and passwordless sudo
- SSH key-only auth, no password auth
- UFW firewall for SSH, HTTP, HTTPS
- fail2ban for SSH
- unattended security upgrades
- Docker Engine and Compose plugin from Docker's official Ubuntu repository
- Docker log rotation
- 4 GB swapfile if missing
- `/opt/leadvirt`, `/opt/leadvirt/secrets`, `/opt/leadvirt/backups`, `/var/log/leadvirt`

After it completes, reconnect as:

```bash
ssh -i ~/.ssh/leadvirt-staging-01_ed25519 deploy@193.187.92.88
```

## Bootstrap Result

Completed on 2026-07-03.

Verified:

- SSH as `root` with the dedicated key works.
- SSH as `deploy` with the dedicated key works.
- Ubuntu: `24.04.4 LTS`.
- Docker: `29.6.1`.
- Docker Compose plugin: `v5.3.0`.
- `deploy` is in `sudo` and `docker` groups.
- `ufw` is active with `22/tcp`, `80/tcp`, and `443/tcp` allowed.
- `fail2ban` is active.
- `unattended-upgrades` is active.
- 4 GB `/swapfile` is enabled.
- `/opt/leadvirt`, `/opt/leadvirt/secrets`, `/opt/leadvirt/backups`, and `/var/log/leadvirt` exist.

## Staging App Deployment

Completed on 2026-07-03.

Runtime:

- Source path: `/opt/leadvirt/current`
- Secrets path: `/opt/leadvirt/secrets/.env`
- Operator credentials path: `/opt/leadvirt/secrets/operator-login.txt`
- Canonical public URL: `https://leadvirt.com`
- Reverse proxy: nginx on ports `80` and `443`
- Services: `postgres`, `redis`, `migrate`, `api`, `worker`, `web`, `nginx`

Domain migration:

- Canonical production domain: `leadvirt.com`.
- `leadvirt.com` and `www.leadvirt.com` must resolve to `193.187.92.88` before cutover.
- Public env and CORS use only `.com`; auth cookies remain secure.
- Unknown HTTP hosts and TLS handshakes are rejected instead of falling through to the app.

DNS check:

```bash
getent ahostsv4 leadvirt.com
getent ahostsv4 www.leadvirt.com
```

HTTPS cutover script:

```bash
cd /opt/leadvirt/current
deploy/enable-leadvirt-com-https.sh
```

The script checks DNS and ACME routing, issues the `.com` certificate, updates public app env, validates nginx, rebuilds the web/API/worker/nginx services, and verifies `/health/ready`. On a first deployment with port `80` free, it serves the webroot through a uniquely named temporary nginx until Certbot finishes. An incompatible existing port `80` listener is never stopped; the cutover fails closed.

After a successful cutover it installs `/etc/cron.d/leadvirt-certbot`, which renews active certificates daily.

Deployments persist their Compose project in `.leadvirt-compose-project`. HTTPS validation and renewal validate and use that marker; releases without it keep the legacy Compose project lookup.

Certificates:

- Canonical path after cutover: `/etc/letsencrypt/live/leadvirt.com`
- Renewal cron: `/etc/cron.d/leadvirt-certbot`

Deploy command:

```bash
cd /opt/leadvirt/current
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml up -d --build
```

Verified:

- `GET https://leadvirt.com/health` returns `200` for process liveness.
- `GET https://leadvirt.com/health/ready` returns `200` only when PostgreSQL and Redis are reachable.
- `GET http://leadvirt.com/` redirects to `https://leadvirt.com/`.
- `https://www.leadvirt.com/` redirects to `https://leadvirt.com/`.
- `GET https://leadvirt.com/api/auth/me` without a cookie returns `401`.
- Landing and `/demo` return `200`.
- Browser visit to `/app` without a session redirects to `/login`.
- The clean staging operator workspace has zero leads, activity, channels, and response-time metrics after signup.
- Strict auth readiness passes for `staging-admin@leadvirt.ai`; 2FA is still disabled and should be enabled before wider external access.
- Real OpenAI provider smoke passes from the staging API container through the FR AI gateway.
- Main reverse proxy was migrated from Caddy to nginx on 2026-07-04.

Deployment preflight starts an isolated API with `API_DEPLOYMENT_PREFLIGHT=true`, a paused worker, and web while the prior stack remains live. API and worker readiness prove PostgreSQL and Redis before the deployment drains the exact prior writers, stops nginx, switches `current`, and commits to candidate-only recovery before any migration. Canonical promotion reruns migration and retained-key gates, verifies the API in normal mode, activates the worker, proves web/nginx/public readiness, and otherwise leaves nginx stopped. Do not add deployment preflight flags to `/opt/leadvirt/secrets/.env`.

The workflow installs `leadvirt-deployment-reconcile.service`. Before drain it fsyncs `/opt/leadvirt/.deployment-journal.v1` with exact prior container and `current` state; after the synced link switch it durably changes the phase to `committed`. Deploy startup and host boot both reconcile this file. Do not delete or edit the journal manually: rerun `sudo /bin/bash /opt/leadvirt/.deployment-journal.sh reconcile` and inspect its error if automatic recovery remains fail-closed.

Recovery uses the same deployment lock as the workflow. A `precommit` journal restores the exact recorded `current` target and restarts only prior containers recorded as running; a `committed` journal never returns to old code and resumes candidate migration and promotion. Ambiguous or failed recovery retains the journal and keeps nginx stopped. The systemd oneshot starts after Docker and the network and retries after failure.

The Business Import parser is optional. It is built, preflighted, started, and health-checked only when both `BUSINESS_IMPORT_ENABLED=true` and `BUSINESS_IMPORT_PARSER_APPROVED=true`. The journal records that decision. A committed deployment with either flag false stops and removes an old parser container while API, worker, AI, and channel services deploy without a parser image or endpoint.

LeadVirt.com intentionally enables the CSV Business Import core in the production web, API, and worker while pinning XLSX and the parser off. Before traffic drain, candidate deployment validates the exact rollout state, writable encrypted artifact storage and key configuration, and a real clean ClamAV scan. Journal recovery inherits these committed Compose values rather than transient workflow overrides.

Before strict staging validation, deployment may canonicalize a legacy artifact key's base64 text while preserving the exact effective decoded 32 key bytes. Exact duplicate assignments are collapsed using the same last-wins semantics as Compose and the env parser. This is an atomic owner/mode-preserving normalization, not key rotation. Missing or malformed effective assignments still stop deployment and require manual secret repair.

Inspect or retry recovery with:

```bash
sudo systemctl status leadvirt-deployment-reconcile.service
sudo journalctl -u leadvirt-deployment-reconcile.service
sudo /bin/bash /opt/leadvirt/.deployment-journal.sh reconcile
```

Release cleanup retains five marker-valid managed releases and skips releases or images referenced by `current`, the journal, top-level symlinks, or any stopped/running container. Failed reference discovery retains data.

Local verification covers Bash syntax, static recovery/order assertions, a mocked first-deploy journal write and duplicate-attempt fence, and mocked fail-closed pruning. It does not prove real Linux Docker/systemd crash recovery. Before treating the recovery path as production-proven, run the checklist crash matrix on a disposable Linux host with real containers, `SIGKILL`, and reboot.

## Knowledge Query HMAC Keys

Generate each production key as 32 random bytes encoded in canonical base64:

```bash
openssl rand -base64 32
```

Store the active key ID and JSON keyring only in `/opt/leadvirt/secrets/.env`:

```dotenv
KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID=knowledge-query-2026-07
KNOWLEDGE_QUERY_HMAC_KEYS={"knowledge-query-2026-07":"<base64-key>"}
```

Rotation:

1. Add a new uniquely named key to `KNOWLEDGE_QUERY_HMAC_KEYS`, retain every old key, and change `KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID` to the new ID.
2. Deploy. The release drains query-hash writers before migrations and the retained-key gate; new services start only after the gate passes.
3. Never change material behind an existing key ID or reuse an ID. The immutable registry rejects either action.
4. Remove an old verify-only key only after no retained database record references it and the coverage gate passes.

On the first gated deploy, legacy rows without key metadata or referenced key IDs absent from the immutable registry fail closed. Explicitly regenerate or purge legacy artifacts according to retention policy; do not relabel raw hashes or silently adopt a referenced key ID. The nullable expand schema remains until all pre-HMAC writers are retired, then a contract migration will require the metadata.

## FR External API Gateway

Completed on 2026-07-03.

Runtime:

- Hostname: `fr-vmnano`
- Public IPv4: `147.90.14.240`
- OpenAI gateway URL: `https://147-90-14-240.sslip.io:8443/v1`
- Telegram gateway URL: `https://147-90-14-240.sslip.io:8443/telegram`
- Telegram webhook relay URL: `https://147-90-14-240.sslip.io:8443/telegram-webhook`
- Source path: `/opt/leadvirt/ai-gateway`
- Compose file: `deploy/ai-gateway/docker-compose.yml`
- Reverse proxy: nginx on ports `80` and `8443`
- Existing `xray` service remains on port `443`.
- Certbot certificate: `/etc/letsencrypt/live/147-90-14-240.sslip.io`, expires `2026-10-02`.
- Cert renewal: `/etc/cron.d/leadvirt-ai-gateway-certbot` runs `/opt/leadvirt/ai-gateway/renew-cert.sh` daily.

Purpose:

- Route staging OpenAI and Telegram Bot API traffic through a supported-region VPS.
- Allow outbound proxy access only from main staging IP `193.187.92.88`; accept POST-only inbound Telegram webhooks, limit each source IP to `50` requests per second with a burst of `100`, and forward them to LeadVirt for secret verification.
- Disable Telegram access and non-emergency error logs to avoid recording bot paths or tokens.
- Keep local/direct access to OpenAI routes blocked with `403 forbidden`.

Verified:

- `GET http://147-90-14-240.sslip.io/health` returns `200`.
- Local request to `https://147-90-14-240.sslip.io:8443/v1/models` returns gateway `403 forbidden`.
- Request from `193.187.92.88` to the same route reaches OpenAI and returns `401 invalid_api_key` with an intentionally invalid key.
- A configured bot `getMe` request from `193.187.92.88` through `/telegram/` returns `200`; an external request to the same gateway route returns `403`.
- The POST-only `/telegram-webhook/` relay preserves Telegram's secret header and body; production migration drained seven pending updates to zero and all seven returned `201` from LeadVirt.
- Staging `AI_BASE_URL` now points at `https://147-90-14-240.sslip.io:8443/v1`.
- Staging `TELEGRAM_BOT_API_BASE_URL` points at `https://147-90-14-240.sslip.io:8443/telegram`.
- Staging `TELEGRAM_WEBHOOK_BASE_URL` points at `https://147-90-14-240.sslip.io:8443/telegram-webhook`. The Integrations health action checks Telegram's backlog, delivery error state, relay URL, and exact inbound update policy, then repairs stale registration once before reporting readiness; the internal sample does not test the relay.
- `qa:ai:provider` passes inside the staging API container.
- Gateway runtime was migrated from Caddy to nginx on 2026-07-04.
