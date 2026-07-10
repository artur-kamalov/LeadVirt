import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const workflowPath = ".github/workflows/deploy-leadvirt-com.yml";
const workflow = read(workflowPath);
const nginx = read("deploy/nginx.https.conf");
const cutover = read("deploy/enable-leadvirt-com-https.sh");
const stagingEnv = read("deploy/env.staging.example");
const readinessSmoke = read("artifacts/scripts/release-readiness-scripts-smoke.mjs");
const pilotPacket = read("docs/PILOT_PACKET.md");

assert(
  !existsSync(resolve(root, ".github/workflows/deploy-leadvirt-ru.yml")),
  "Legacy deploy workflow still exists.",
);
assert(
  !existsSync(resolve(root, ".github/workflows/deploy-leadvirt-ai.yml")),
  "Mistaken .ai deploy workflow still exists.",
);
assert(
  !existsSync(resolve(root, "deploy/enable-leadvirt-ai-https.sh")),
  "Mistaken .ai cutover script still exists.",
);
assert(
  workflow.includes("name: Deploy LeadVirt.com"),
  "Deploy workflow is not named for LeadVirt.com.",
);
assert(
  workflow.includes("PUBLIC_URL: https://leadvirt.com"),
  "Deploy workflow public URL is not canonical.",
);
assert(
  workflow.includes("environment: leadvirt-com"),
  "Deploy workflow does not use the leadvirt-com environment.",
);

const prepareIndex = workflow.indexOf("enable-leadvirt-com-https.sh");
const switchIndex = workflow.indexOf('if [ -L "$current_link" ]');
assert(
  prepareIndex >= 0 && switchIndex > prepareIndex,
  "Domain preparation must finish before the active release changes.",
);

assert(nginx.includes("server_name leadvirt.com;"), "Canonical nginx server is missing.");
assert(
  nginx.includes("/etc/letsencrypt/live/leadvirt.com/fullchain.pem"),
  "Canonical certificate path is missing.",
);
assert(
  nginx.includes("server_name leadvirt.ru www.leadvirt.ru;"),
  "Legacy nginx server is missing.",
);
assert(
  nginx.includes("/etc/letsencrypt/live/leadvirt.ru/fullchain.pem"),
  "Legacy certificate path is missing.",
);

const legacyServer = nginx.slice(nginx.indexOf("server_name leadvirt.ru www.leadvirt.ru;"));
assert(
  /location \/api\/ \{[\s\S]*?proxy_pass http:\/\/leadvirt_api;/.test(legacyServer),
  "Legacy API compatibility proxy is missing.",
);
assert(
  legacyServer.includes("return 308 https://leadvirt.com$request_uri;"),
  "Legacy browser redirect is missing.",
);

assert(
  cutover.includes('PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-leadvirt.com}"'),
  "Cutover script has the wrong primary domain.",
);
assert(
  cutover.includes("ACME challenge path is not reachable"),
  "Cutover script does not preflight ACME routing.",
);
assert(
  cutover.includes("$certbot_webroot/.well-known/acme-challenge"),
  "Cutover preflight writes outside the ACME challenge directory.",
);
assert(
  cutover.includes('--cert-name "$PRIMARY_DOMAIN"'),
  "Cutover certificate path is not deterministic.",
);
assert(
  cutover.includes("nginx -t -c /tmp/leadvirt-nginx.https.conf"),
  "Cutover script does not validate candidate nginx config.",
);
assert(
  stagingEnv.includes("NEXT_PUBLIC_APP_URL=https://leadvirt.com"),
  "Staging frontend origin is not canonical.",
);
assert(
  readinessSmoke.includes('LEADVIRT_PUBLIC_WEB_BASE: "https://leadvirt.com"'),
  "Release smoke still targets the legacy domain.",
);
assert(
  pilotPacket.includes("Public web: https://leadvirt.com"),
  "Pilot packet does not target the canonical domain.",
);
assert(
  !pilotPacket.includes("https://leadvirt.ru"),
  "Pilot packet still publishes legacy-domain links.",
);
assert(
  !pilotPacket.includes("demo-webhook-secret"),
  "Pilot packet contains a fallback webhook secret.",
);
assert(
  nginx.includes("server_name masterbudet.ru www.masterbudet.ru;"),
  "Shared Master Budet proxy routes are missing.",
);
assert(
  nginx.includes("resolver 127.0.0.11 valid=30s ipv6=off;"),
  "Master Budet proxy does not use deferred Docker DNS.",
);
assert(
  nginx.includes("ssl_certificate /etc/letsencrypt/live/masterbudet.ru/fullchain.pem;"),
  "Master Budet apex TLS certificate is not configured.",
);
assert(
  nginx.includes("return 308 https://masterbudet.ru$request_uri;"),
  "Master Budet HTTP traffic does not redirect to the HTTPS apex.",
);

console.log("PASS: LeadVirt.com cutover is gated and legacy-domain compatibility is configured.");
