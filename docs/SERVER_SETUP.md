# LeadVirt Server Setup

Last updated: 2026-07-10

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

The script checks DNS and ACME routing, issues the `.com` certificate, updates public app env, validates nginx, rebuilds the web/API/worker/nginx services, and verifies `/health`.

After a successful cutover it installs `/etc/cron.d/leadvirt-certbot`, which renews active certificates daily.

Certificates:

- Canonical path after cutover: `/etc/letsencrypt/live/leadvirt.com`
- Renewal cron: `/etc/cron.d/leadvirt-certbot`

Deploy command:

```bash
cd /opt/leadvirt/current
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml up -d --build
```

Verified:

- `GET https://leadvirt.com/health` returns `200`.
- `GET http://leadvirt.com/` redirects to `https://leadvirt.com/`.
- `https://www.leadvirt.com/` redirects to `https://leadvirt.com/`.
- `GET https://leadvirt.com/api/auth/me` without a cookie returns `401`.
- Landing and `/demo` return `200`.
- Browser visit to `/app` without a session redirects to `/login`.
- The clean staging operator workspace has zero leads, activity, channels, and response-time metrics after signup.
- Strict auth readiness passes for `staging-admin@leadvirt.ai`; 2FA is still disabled and should be enabled before wider external access.
- Real OpenAI provider smoke passes from the staging API container through the FR AI gateway.
- Main reverse proxy was migrated from Caddy to nginx on 2026-07-04.

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
- Allow outbound proxy access only from main staging IP `193.187.92.88`; accept POST-only inbound Telegram webhooks and forward them to LeadVirt for secret verification.
- Disable Telegram access and non-emergency error logs to avoid recording bot paths or tokens.
- Keep local/direct access to OpenAI routes blocked with `403 forbidden`.

Verified:

- `GET http://147-90-14-240.sslip.io/health` returns `200`.
- Local request to `https://147-90-14-240.sslip.io:8443/v1/models` returns gateway `403 forbidden`.
- Request from `193.187.92.88` to the same route reaches OpenAI and returns `401 invalid_api_key` with an intentionally invalid key.
- A configured bot `getMe` request from `193.187.92.88` through `/telegram/` returns `200`; an external request to the same gateway route returns `403`.
- Staging `AI_BASE_URL` now points at `https://147-90-14-240.sslip.io:8443/v1`.
- Staging `TELEGRAM_BOT_API_BASE_URL` points at `https://147-90-14-240.sslip.io:8443/telegram`.
- `qa:ai:provider` passes inside the staging API container.
- Gateway runtime was migrated from Caddy to nginx on 2026-07-04.
