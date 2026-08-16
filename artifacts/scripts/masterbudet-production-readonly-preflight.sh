#!/usr/bin/env bash
set -euo pipefail

# Keep Git inspection from refreshing or locking a production index.
export GIT_OPTIONAL_LOCKS=0

deploy_path="${DEPLOY_PATH:-/opt/masterbudet}"
leadvirt_root="${LEADVIRT_ROOT:-/opt/leadvirt}"
env_file="$deploy_path/.env.production"

section() {
  printf '\n== %s ==\n' "$1"
}

safe_sha_file() {
  local path="$1"
  if [ -f "$path" ] && [ ! -L "$path" ]; then
    printf '%s=' "$(basename "$path")"
    sed -n '1p' "$path"
  else
    printf '%s=missing-or-unsafe\n' "$(basename "$path")"
  fi
}

section identity
printf 'captured_at_utc=%s\n' "$(date -u +%FT%TZ)"
printf 'hostname=%s\n' "$(hostname)"
printf 'operator=%s uid=%s\n' "$(id -un)" "$(id -u)"
printf 'kernel=%s\n' "$(uname -sr)"

section paths-and-permissions
for path in "$deploy_path" "$deploy_path/backend" "$deploy_path/frontend" \
  "$deploy_path/.deploy" "$deploy_path/backups/postgres" "$env_file"; do
  if [ -e "$path" ] || [ -L "$path" ]; then
    stat -Lc '%n|kind=%F|mode=%a|owner=%U:%G|size=%s|mtime=%y' "$path"
  else
    printf '%s|missing\n' "$path"
  fi
done

section source-and-ledger
for app in backend frontend; do
  checkout="$deploy_path/$app"
  printf '[%s]\n' "$app"
  if [ -d "$checkout/.git" ]; then
    printf 'head=%s\n' "$(git -C "$checkout" rev-parse HEAD)"
    printf 'branch=%s\n' "$(git -C "$checkout" branch --show-current)"
    printf 'status-count=%s\n' "$(git -C "$checkout" status --porcelain=v1 --untracked-files=all | wc -l | tr -d '[:space:]')"
    git -C "$checkout" status --short --untracked-files=all
    printf 'index-special-count=%s\n' "$(git -C "$checkout" ls-files -v | awk '/^[a-zS]/ { count += 1 } END { print count + 0 }')"
    git -C "$checkout" diff --stat
    git -C "$checkout" diff --numstat
  else
    printf 'checkout=missing\n'
  fi
  safe_sha_file "$deploy_path/.deploy/$app.current.sha"
  safe_sha_file "$deploy_path/.deploy/$app.previous.sha"
  for bundle in "$deploy_path/.deploy/$app.bundle" "$deploy_path/incoming/$app.bundle.next"; do
    if [ -f "$bundle" ] && [ ! -L "$bundle" ]; then
      sha256sum "$bundle"
      stat -Lc '%n|mode=%a|owner=%U:%G|size=%s|mtime=%y' "$bundle"
    fi
  done
done

section compose-source
for path in "$deploy_path/docker-compose.prod.yml" \
  "$deploy_path/docker-compose.shared-edge.yml" \
  "$deploy_path/backend/deploy/production/docker-compose.prod.yml" \
  "$deploy_path/backend/deploy/production/docker-compose.shared-edge.yml"; do
  if [ -f "$path" ] && [ ! -L "$path" ]; then
    sha256sum "$path"
  else
    printf '%s|missing-or-unsafe\n' "$path"
  fi
done
if [ -f "$env_file" ] && [ ! -L "$env_file" ]; then
  printf 'env-key-count=%s\n' "$(awk -F= '/^[A-Z][A-Z0-9_]*=/{count++} END{print count+0}' "$env_file")"
  for key in TRUST_PROXY_HOPS SMS_PROVIDER NODE_ENV APP_ENV; do
    count="$(awk -F= -v key="$key" '$1 == key { count += 1 } END { print count + 0 }' "$env_file")"
    if [ "$key" = TRUST_PROXY_HOPS ]; then
      valid="$(awk -F= '$1 == "TRUST_PROXY_HOPS" && $2 == "1" { valid += 1 } END { print valid + 0 }' "$env_file")"
      printf '%s|count=%s|exact-one=%s\n' "$key" "$count" "$valid"
    else
      printf '%s|count=%s\n' "$key" "$count"
    fi
  done
  printf 'leadvirt-env-key-count=%s\n' "$(awk -F= '/^LEADVIRT_[A-Z0-9_]*=/{count++} END{print count+0}' "$env_file")"
fi

section docker-runtime
docker version --format 'server={{.Server.Version}} api={{.Server.APIVersion}}'
docker compose version
docker ps --no-trunc --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'
for service in postgres backend frontend; do
  while IFS= read -r container; do
    [ -n "$container" ] || continue
    docker inspect --format \
      '{{.Name}}|id={{.Id}}|image={{.Image}}|created={{.Created}}|running={{.State.Running}}|health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|project={{index .Config.Labels "com.docker.compose.project"}}|service={{index .Config.Labels "com.docker.compose.service"}}|working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}|config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}|networks={{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}' \
      "$container"
  done < <(docker ps -a --no-trunc \
    --filter "label=com.docker.compose.project=masterbudet" \
    --filter "label=com.docker.compose.service=$service" \
    --format '{{.ID}}')
done
docker network inspect shared_edge --format \
  'name={{.Name}} id={{.Id}} driver={{.Driver}} scope={{.Scope}} containers={{len .Containers}} created={{.Created}}'

section health
curl -fsS http://127.0.0.1:4000/health
printf '\n'
curl -fsS http://127.0.0.1:3000/ >/dev/null
printf 'frontend-loopback=200\n'
curl -fsS --resolve masterbudet.ru:443:127.0.0.1 https://masterbudet.ru/health
printf '\n'
masterbudet_public_status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w '%{http_code}' https://masterbudet.ru/ || true)"
printf 'masterbudet-public-status=%s\n' "${masterbudet_public_status:-unreachable}"

section database-migrations
postgres_container="$(docker ps --no-trunc \
  --filter 'label=com.docker.compose.project=masterbudet' \
  --filter 'label=com.docker.compose.service=postgres' \
  --format '{{.ID}}' | sed -n '1p')"
test -n "$postgres_container"
docker exec -i "$postgres_container" sh -eu -c \
  'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT 'ledger|' || count(*) || '|completed|' || count(*) FILTER (WHERE finished_at IS NOT NULL) || '|unfinished|' || count(*) FILTER (WHERE finished_at IS NULL) || '|rolled_back|' || count(*) FILTER (WHERE rolled_back_at IS NOT NULL) FROM _prisma_migrations;
SELECT 'migration|' || migration_name || '|finished=' || (finished_at IS NOT NULL)::text || '|rolled_back=' || (rolled_back_at IS NOT NULL)::text FROM _prisma_migrations ORDER BY started_at, migration_name;
SELECT 'business-counts|users=' || (SELECT count(*) FROM users) || '|orders=' || (SELECT count(*) FROM orders) || '|payments=' || (SELECT count(*) FROM payments) || '|payouts=' || (SELECT count(*) FROM payouts) || '|change_orders=' || (SELECT count(*) FROM change_orders);
SQL

section backups
backup_root="$deploy_path/backups/postgres"
if [ -d "$backup_root" ] && [ ! -L "$backup_root" ]; then
  find "$backup_root" -maxdepth 1 -type f -name 'master_budet_*.sql.gz' \
    -printf '%f|mode=%m|owner=%u:%g|size=%s|mtime=%TY-%Tm-%TdT%TH:%TM:%TSZ\n' | sort
  backup_count="$(find "$backup_root" -maxdepth 1 -type f -name 'master_budet_*.sql.gz' | wc -l | tr -d '[:space:]')"
  printf 'backup-count=%s\n' "$backup_count"
  newest_backup="$(find "$backup_root" -maxdepth 1 -type f -name 'master_budet_*.sql.gz' -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')"
  if [ -n "$newest_backup" ]; then
    gzip -t "$newest_backup"
    sha256sum "$newest_backup"
    printf 'newest-gzip=valid\n'
  fi
  printf 'temp-residue-count=%s\n' "$(find "$backup_root" -maxdepth 1 -type f -name '*.tmp' | wc -l | tr -d '[:space:]')"
fi

section shared-edge
leadvirt_current="$(readlink -f "$leadvirt_root/current" 2>/dev/null || true)"
printf 'leadvirt-current=%s\n' "$leadvirt_current"
if [ -n "$leadvirt_current" ]; then
  safe_sha_file "$leadvirt_current/.leadvirt-release-sha"
  safe_sha_file "$leadvirt_current/.leadvirt-compose-project"
  for path in "$leadvirt_current/deploy/nginx.https.conf" \
    "$leadvirt_current/deploy/docker-compose.staging.yml"; do
    if [ -f "$path" ] && [ ! -L "$path" ]; then
      sha256sum "$path"
    fi
  done
fi
mapfile -t public_edge_containers < <(
  docker ps --no-trunc --filter 'publish=443' --format '{{.ID}}'
)
if [ "${#public_edge_containers[@]}" -ne 1 ]; then
  echo "Expected exactly one running container publishing TCP/443; found ${#public_edge_containers[@]}." >&2
  exit 1
fi
nginx_container="${public_edge_containers[0]}"
edge_service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$nginx_container")"
if [ "$edge_service" != nginx ]; then
  echo "The only running container publishing TCP/443 is not the authoritative nginx service." >&2
  exit 1
fi
docker inspect --format \
  '{{.Name}}|id={{.Id}}|image={{.Image}}|created={{.Created}}|running={{.State.Running}}|health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|project={{index .Config.Labels "com.docker.compose.project"}}|working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}|config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}' \
  "$nginx_container"
docker exec "$nginx_container" nginx -t
docker exec "$nginx_container" sha256sum /etc/nginx/nginx.conf
nginx_config="$(docker exec "$nginx_container" nginx -T 2>&1)"
printf '%s\n' "$nginx_config" | \
  grep -E 'server_name|ssl_certificate(_key)?|limit_req(_zone|_status)?|limit_conn(_zone|_status)?|X-Forwarded-For|client_max_body_size' || true
active_domains="$(
  printf '%s\n' "$nginx_config" | awk '
    /^[[:space:]]*server_name[[:space:]]/ {
      for (field = 2; field <= NF; field += 1) {
        domain = $field
        sub(/;$/, "", domain)
        if (domain ~ /^[a-z0-9][a-z0-9.-]*\.[a-z][a-z0-9-]*$/) print domain
      }
    }
  ' | sort -u
)"
while IFS= read -r domain; do
  [ -n "$domain" ] || continue
  root_status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w '%{http_code}' \
    --resolve "$domain:443:127.0.0.1" "https://$domain/" || true)"
  health_status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w '%{http_code}' \
    --resolve "$domain:443:127.0.0.1" "https://$domain/health" || true)"
  printf 'active-domain=%s|root-status=%s|health-status=%s\n' \
    "$domain" "${root_status:-unreachable}" "${health_status:-unreachable}"
done <<< "$active_domains"

section tls-and-renewal
openssl x509 -in /etc/letsencrypt/live/masterbudet.ru/cert.pem -noout \
  -subject -issuer -serial -fingerprint -sha256 -startdate -enddate
systemctl is-enabled certbot.timer 2>/dev/null || true
systemctl is-active certbot.timer 2>/dev/null || true
systemctl list-timers --all certbot.timer --no-pager 2>/dev/null || true
systemctl is-enabled cron 2>/dev/null || true
systemctl is-active cron 2>/dev/null || true
find /etc/cron.d /etc/cron.daily /etc/systemd/system /lib/systemd/system \
  -maxdepth 2 -type f \( -iname '*certbot*' -o -iname '*letsencrypt*' \) \
  -printf '%p|mode=%m|mtime=%TY-%Tm-%TdT%TH:%TM:%TSZ\n' 2>/dev/null | sort
find /var/log/letsencrypt -maxdepth 1 -type f \
  -printf '%p|size=%s|mtime=%TY-%Tm-%TdT%TH:%TM:%TSZ\n' 2>/dev/null | sort | tail -n 20

section capacity
df -hT "$deploy_path" /var/lib/docker
free -h
docker system df

section listeners
ss -lntup | awk 'NR == 1 || /:22 |:80 |:443 |127\.0\.0\.1:3000 |127\.0\.0\.1:4000 /'

printf '\nREAD_ONLY_PREFLIGHT_COMPLETE\n'
