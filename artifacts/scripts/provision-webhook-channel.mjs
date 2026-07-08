import { writeFile } from "node:fs/promises";

const apiBase = normalizeApiBase(process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const publicApiBase = normalizeApiBase(process.env.LEADVIRT_PUBLIC_API_BASE ?? process.env.LEADVIRT_PROVISION_PUBLIC_API_BASE ?? apiBase);
const apiOrigin = apiBase.replace(/\/api$/, "");
const publicApiOrigin = publicApiBase.replace(/\/api$/, "");
const email = normalizeEmail(process.env.LEADVIRT_PROVISION_EMAIL ?? "admin@leadvirt.ai");
const password = process.env.LEADVIRT_PROVISION_PASSWORD ?? (isLocalUrl(apiBase) ? "demo-demo" : "");
const twoFactorCode = process.env.LEADVIRT_PROVISION_2FA_CODE;
const channelName = process.env.LEADVIRT_PROVISION_CHANNEL_NAME ?? "Master Budet Webhook";
const strict = isTruthy(process.env.LEADVIRT_PROVISION_STRICT) || !isLocalUrl(apiBase);
const outputPath = process.env.LEADVIRT_PROVISION_OUT;

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizeBase(value) {
  return value.trim().replace(/\/$/, "");
}

function normalizeApiBase(value) {
  const cleaned = normalizeBase(value);
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function isLocalUrl(value) {
  return /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function webhookSecret(channel) {
  const settings = asRecord(channel?.settings);
  const webhook = asRecord(settings.webhook);
  const secret = webhook.secret ?? webhook.webhookSecret ?? settings.secret ?? settings.webhookSecret;
  return typeof secret === "string" ? secret : "";
}

function webhookEndpoint(publicKey) {
  return `${publicApiOrigin}/api/public/channels/webhook/${encodeURIComponent(publicKey)}/events`;
}

async function apiRequest(path, { method = "GET", cookie, data } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function login() {
  assert(password, "Set LEADVIRT_PROVISION_PASSWORD for non-local API provisioning.");

  const loginBody = {
    email,
    password,
    ...(twoFactorCode ? { twoFactorCode } : {}),
  };
  const result = await apiRequest("/auth/login", { method: "POST", data: loginBody });
  assert(result.response.ok, `Login failed for ${email}: HTTP ${result.response.status}`);

  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Login did not return a session cookie.");
  return cookie;
}

async function listChannels(cookie) {
  const result = await apiRequest("/channels", { cookie });
  assert(result.response.ok, `Could not list channels: HTTP ${result.response.status}`);
  return Array.isArray(result.payload?.data) ? result.payload.data : [];
}

async function createWebhookChannel(cookie) {
  const result = await apiRequest("/channels", {
    method: "POST",
    cookie,
    data: {
      type: "WEBHOOK",
      name: channelName,
      status: "ACTIVE",
    },
  });
  assert(result.response.ok, `Could not create Webhook/API channel: HTTP ${result.response.status}`);
  return result.payload?.data;
}

async function activateChannel(cookie, channel) {
  if (channel.status === "ACTIVE") return channel;

  const result = await apiRequest(`/channels/${encodeURIComponent(channel.id)}`, {
    method: "PATCH",
    cookie,
    data: { status: "ACTIVE" },
  });
  assert(result.response.ok, `Could not activate Webhook/API channel: HTTP ${result.response.status}`);
  return result.payload?.data;
}

function packet(channel) {
  const publicKey = channel.publicKey ?? "";
  const secret = webhookSecret(channel);
  const endpoint = webhookEndpoint(publicKey);
  return {
    channelId: channel.id,
    channelName: channel.name,
    publicKey,
    secret,
    endpoint,
    secretHeader: "x-leadvirt-webhook-secret",
  };
}

function renderPacket(details) {
  return [
    "# LeadVirt Webhook/API Channel",
    "",
    `API base: ${apiBase}`,
    `Public API base: ${publicApiBase}`,
    `User: ${email}`,
    `Channel: ${details.channelName} (${details.channelId})`,
    "",
    "## Master Budet env",
    "",
    `LEADVIRT_AI_ADMIN_ENABLED=true`,
    `LEADVIRT_WEBHOOK_URL=${details.endpoint}`,
    `LEADVIRT_WEBHOOK_SECRET=${details.secret}`,
    "",
    "## LeadVirt public preflight env",
    "",
    `LEADVIRT_PUBLIC_WEBHOOK_KEY=${details.publicKey}`,
    `LEADVIRT_PUBLIC_WEBHOOK_SECRET=${details.secret}`,
    "",
    "## PowerShell",
    "",
    `$env:LEADVIRT_AI_ADMIN_ENABLED="true"`,
    `$env:LEADVIRT_WEBHOOK_URL="${details.endpoint}"`,
    `$env:LEADVIRT_WEBHOOK_SECRET="${details.secret}"`,
    `$env:LEADVIRT_PUBLIC_WEBHOOK_KEY="${details.publicKey}"`,
    `$env:LEADVIRT_PUBLIC_WEBHOOK_SECRET="${details.secret}"`,
    "",
    `Secret header: ${details.secretHeader}`,
    "",
  ].join("\n");
}

async function main() {
  console.log("LeadVirt Webhook/API Provisioning");
  console.log(`API: ${apiBase}`);
  console.log(`Public API: ${publicApiBase}`);
  console.log(`User: ${email}`);
  console.log("");

  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
  assert(health?.ok, `LeadVirt API is not healthy at ${apiOrigin}.`);

  const cookie = await login();
  const channels = await listChannels(cookie);
  let channel = channels.find((item) => item?.type === "WEBHOOK");

  if (channel) {
    channel = await activateChannel(cookie, channel);
  } else {
    channel = await createWebhookChannel(cookie);
  }

  assert(channel?.type === "WEBHOOK", "Provisioning did not return a Webhook/API channel.");
  assert(channel?.publicKey, "Webhook/API channel does not have a public key.");

  const details = packet(channel);
  assert(details.secret, "Webhook/API channel does not expose a webhook secret in settings.");

  const demoKey = details.publicKey.startsWith("demo-") || details.publicKey.includes("demo");
  if (demoKey && strict) {
    throw new Error(`Refusing to use demo Webhook/API public key in strict/non-local provisioning: ${details.publicKey}`);
  }
  if (demoKey) {
    console.log(`WARN Existing local Webhook/API channel uses demo public key: ${details.publicKey}`);
    console.log("WARN Run this against staging/public or a clean workspace to provision an lvwh_ key.");
    console.log("");
  }

  const rendered = renderPacket(details);
  console.log(rendered);

  if (outputPath) {
    await writeFile(outputPath, rendered, "utf8");
    console.log(`Wrote ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
