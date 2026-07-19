# LeadVirt Staging Deploy

Target: `https://leadvirt.com`, host `193.187.92.88`, `/opt/leadvirt/current`.

Runtime env lives outside git at:

```text
/opt/leadvirt/secrets/.env
```

Create it from `deploy/env.staging.example`, replacing all `change-me` values and adding `AI_API_KEY`.

## GitHub Actions Deploy

Primary deploy path:

```text
.github/workflows/deploy-leadvirt-com.yml
```

It verifies the app, uploads a release package, prepares `.com` DNS/TLS/env, switches `/opt/leadvirt/current`, rebuilds Docker Compose, and checks `https://leadvirt.com/health/ready`.

Setup details are in `docs/GITHUB_ACTIONS_DEPLOY.md`.

## Manual Deploy

Deploy from `/opt/leadvirt/current`:

```bash
mkdir -p deploy/certbot/www
docker rm -f deploy-caddy-1 2>/dev/null || true
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml up -d --build --remove-orphans
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml ps
curl -fsS https://leadvirt.com/health
curl -fsS https://leadvirt.com/health/ready
```

After cutover, public env uses `https://leadvirt.com` and `AUTH_COOKIE_SECURE=true`.

## AI Acceptance Smoke

The deterministic clean-tenant `qa:ai:acceptance` runs in CI before deployment. It uses the non-production mock email OTP provider and must not run against production, where OTP codes are intentionally never exposed to scripts.

After cutover, verify `/health/ready`, then perform email login through a monitored inbox and test the website widget and managed Telegram business channel as separate customer-intake paths.

If the HTTPS/domain config must be reapplied:

```bash
cd /opt/leadvirt/current
deploy/enable-leadvirt-com-https.sh
```

The cutover script installs daily certificate renewal through `/etc/cron.d/leadvirt-certbot`.

Staging operator credentials are stored on the server at:

```text
/opt/leadvirt/secrets/operator-login.txt
```

Reverse proxy: nginx. `.com` is canonical and `www.leadvirt.com` redirects to the apex.

## Observability Profile

Prometheus and Grafana are optional and do not start with the normal app stack.

Local:

```bash
docker compose --profile observability up -d prometheus grafana
```

Local Grafana: `http://localhost:3003` (`admin` / `admin`). Prometheus scrapes API `localhost:4001/metrics` and worker `localhost:4002/metrics` through `host.docker.internal`. Tempo receives OTLP HTTP traces on `http://localhost:4318/v1/traces`.

Staging:

```bash
docker compose --env-file /opt/leadvirt/secrets/.env -f deploy/docker-compose.staging.yml --profile observability up -d prometheus grafana
```

Staging binds Prometheus and Grafana to `127.0.0.1`; access them through SSH port forwarding. Set `GRAFANA_ADMIN_PASSWORD` in `/opt/leadvirt/secrets/.env` before enabling.

OpenTelemetry tracing is opt-in. Set `OTEL_ENABLED=true` and point `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the profile Tempo endpoint or another OTLP HTTP collector. The app emits manual spans for HTTP requests, queue publishing, worker jobs, LangGraph runs/nodes, and channel delivery.
