#!/bin/sh
set -eu

PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-leadvirt.com}"
WWW_DOMAIN="${WWW_DOMAIN:-www.leadvirt.com}"
TARGET_IP="${DOMAIN_TARGET_IP:-193.187.92.88}"
EMAIL="${CERTBOT_EMAIL:-admin@leadvirt.com}"
ENV_FILE="${LEADVIRT_ENV_FILE:-/opt/leadvirt/secrets/.env}"
CURRENT_LINK="${LEADVIRT_CURRENT_LINK:-/opt/leadvirt/current}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RELEASE_ROOT="${LEADVIRT_RELEASE_ROOT:-$(dirname "$SCRIPT_DIR")}"
COMPOSE_FILE="$RELEASE_ROOT/deploy/docker-compose.staging.yml"

is_true() {
  case "$1" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

read_compose_project_name() {
  release_root="$1"
  marker="$release_root/.leadvirt-compose-project"

  if [ ! -e "$marker" ]; then
    return 0
  fi
  if [ ! -f "$marker" ] || [ -L "$marker" ]; then
    echo "Invalid Compose project marker: $marker is not a regular file." >&2
    return 1
  fi

  project_name="$(cat "$marker")"
  marker_size="$(wc -c < "$marker" | tr -d '[:space:]')"
  project_size="${#project_name}"
  if [ "$marker_size" -eq "$project_size" ]; then
    :
  elif [ "$marker_size" -eq $((project_size + 1)) ] &&
    [ "$(tail -c 1 "$marker" | od -An -tu1 | tr -d '[:space:]')" = "10" ]; then
    :
  else
    echo "Invalid Compose project marker encoding: $marker." >&2
    return 1
  fi
  case "$project_name" in
    ""|[-_]*|*[!a-z0-9_-]*)
      echo "Invalid Compose project name in $marker." >&2
      return 1
      ;;
  esac
  printf '%s\n' "$project_name"
}

if [ ! -f "$ENV_FILE" ] || [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$RELEASE_ROOT/deploy/nginx.https.conf" ]; then
  echo "Missing deploy env, Compose file, or nginx HTTPS config." >&2
  exit 1
fi

active_root="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
active_compose_project=""
if [ -n "$active_root" ]; then
  active_compose_project="$(read_compose_project_name "$active_root")"
fi
if [ -n "${LEADVIRT_CERTBOT_WEBROOT:-}" ]; then
  certbot_webroot="$LEADVIRT_CERTBOT_WEBROOT"
elif [ -n "$active_root" ] && [ -d "$active_root/deploy/certbot/www" ]; then
  certbot_webroot="$active_root/deploy/certbot/www"
else
  certbot_webroot="$RELEASE_ROOT/deploy/certbot/www"
fi
mkdir -p "$certbot_webroot"

for domain in "$PRIMARY_DOMAIN" "$WWW_DOMAIN"; do
  resolved_ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  if ! printf '%s\n' "$resolved_ips" | grep -Fx "$TARGET_IP" >/dev/null 2>&1; then
    echo "DNS is not ready: $domain -> ${resolved_ips:-missing}; expected $TARGET_IP" >&2
    exit 1
  fi
done

challenge_token="leadvirt-domain-cutover-$$"
challenge_dir="$certbot_webroot/.well-known/acme-challenge"
challenge_path="$challenge_dir/$challenge_token"
mkdir -p "$challenge_dir"
bootstrap_container=""
remove_acme_bootstrap() {
  rm -f "$challenge_path"
  if [ -n "$bootstrap_container" ]; then
    docker rm -f "$bootstrap_container" >/dev/null
    bootstrap_container=""
  fi
}
cleanup_acme_bootstrap() {
  remove_acme_bootstrap >/dev/null 2>&1 || true
}
trap cleanup_acme_bootstrap EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s' "$challenge_token" > "$challenge_path"

challenge_is_reachable() {
  for domain in "$PRIMARY_DOMAIN" "$WWW_DOMAIN"; do
    response="$(curl --noproxy '*' -fsS --max-time 3 "http://$domain/.well-known/acme-challenge/$challenge_token" || true)"
    if [ "$response" != "$challenge_token" ]; then
      return 1
    fi
  done
}

if ! challenge_is_reachable; then
  bootstrap_container="leadvirt-acme-bootstrap-$$-$(date +%s)"
  if ! docker run -d \
    --name "$bootstrap_container" \
    --label com.leadvirt.role=acme-bootstrap \
    -p 80:80 \
    -v "$certbot_webroot:/usr/share/nginx/html:ro" \
    nginx:1.27-alpine >/dev/null; then
    echo "ACME challenge path is not reachable and the temporary server could not bind port 80; no existing listener was changed." >&2
    exit 1
  fi

  attempts=0
  until challenge_is_reachable; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 15 ]; then
      echo "ACME challenge path is not reachable through both domains." >&2
      exit 1
    fi
    sleep 1
  done
fi

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v "$certbot_webroot:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  --cert-name "$PRIMARY_DOMAIN" \
  -d "$PRIMARY_DOMAIN" -d "$WWW_DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring

if ! remove_acme_bootstrap; then
  echo "Failed to remove the temporary ACME server." >&2
  exit 1
fi
trap - EXIT HUP INT TERM

PRIMARY_DOMAIN="$PRIMARY_DOMAIN" \
WWW_DOMAIN="$WWW_DOMAIN" \
python3 - "$ENV_FILE" <<'PY'
import os
import sys
import tempfile
from pathlib import Path

path = Path(sys.argv[1])
primary = os.environ["PRIMARY_DOMAIN"]
origins = [
    f"https://{primary}",
    f"https://{os.environ['WWW_DOMAIN']}",
]
updates = {
    "APP_URL": origins[0],
    "API_URL": origins[0],
    "NEXT_PUBLIC_API_URL": f"{origins[0]}/api",
    "NEXT_PUBLIC_APP_URL": origins[0],
    "NEXT_PUBLIC_WEB_URL": origins[0],
    "CORS_ORIGINS": ",".join(origins),
    "AUTH_COOKIE_SECURE": "true",
}

source_stat = path.stat()
lines = path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")

fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
try:
    os.fchmod(fd, 0o600)
    try:
        os.fchown(fd, source_stat.st_uid, source_stat.st_gid)
    except PermissionError:
        pass
    with os.fdopen(fd, "w") as temporary_file:
        fd = -1
        temporary_file.write("\n".join(out) + "\n")
        temporary_file.flush()
        os.fsync(temporary_file.fileno())
    os.replace(temporary_name, path)
    directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
finally:
    if fd >= 0:
        os.close(fd)
    try:
        os.unlink(temporary_name)
    except FileNotFoundError:
        pass
PY

python3 "$RELEASE_ROOT/deploy/verify-masterbudet-shared-edge.py" \
  "$RELEASE_ROOT/deploy/nginx.https.conf"
cp "$RELEASE_ROOT/deploy/nginx.https.conf" "$RELEASE_ROOT/deploy/nginx.conf"

if [ -n "$active_root" ] && [ -f "$active_root/deploy/docker-compose.staging.yml" ]; then
  if [ -n "$active_compose_project" ]; then
    nginx_container="$(cd "$active_root" && docker compose --project-name "$active_compose_project" --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml ps -q nginx 2>/dev/null || true)"
  else
    nginx_container="$(cd "$active_root" && docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml ps -q nginx 2>/dev/null || true)"
  fi
  if [ -n "$nginx_container" ]; then
    docker cp "$RELEASE_ROOT/deploy/nginx.https.conf" "$nginx_container:/tmp/leadvirt-nginx.https.conf"
    docker exec "$nginx_container" nginx -t -c /tmp/leadvirt-nginx.https.conf
    docker exec "$nginx_container" rm -f /tmp/leadvirt-nginx.https.conf
  fi
fi

if [ -f "$RELEASE_ROOT/deploy/renew-leadvirt-certificates.sh" ]; then
  chmod +x "$RELEASE_ROOT/deploy/renew-leadvirt-certificates.sh"
  echo '23 3 * * * root /opt/leadvirt/current/deploy/renew-leadvirt-certificates.sh >> /var/log/leadvirt/leadvirt-certbot.log 2>&1' \
    | sudo tee /etc/cron.d/leadvirt-certbot >/dev/null
  sudo chmod 644 /etc/cron.d/leadvirt-certbot
  sudo rm -f /etc/cron.d/leadvirt-ru-certbot
fi

if is_true "${LEADVIRT_SKIP_REBUILD:-false}"; then
  echo "Domain certificate, env, and nginx config are prepared for $PRIMARY_DOMAIN."
  exit 0
fi

cd "$RELEASE_ROOT"
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml up -d --build --force-recreate api worker web nginx
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.staging.yml exec -T nginx nginx -t
curl -fsS "https://$PRIMARY_DOMAIN/health"

echo "HTTPS enabled for $PRIMARY_DOMAIN."
