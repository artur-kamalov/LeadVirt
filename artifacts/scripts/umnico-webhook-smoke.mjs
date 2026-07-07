const publicApiBase = normalizeApiBase(process.env.LEADVIRT_PUBLIC_API_BASE ?? process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api");
const publicKey = (process.env.LEADVIRT_PUBLIC_WEBHOOK_KEY ?? "").trim();
const webhookSecret = (process.env.LEADVIRT_PUBLIC_WEBHOOK_SECRET ?? "").trim();
const explicitWebhookUrl = (process.env.LEADVIRT_UMNICO_WEBHOOK_URL ?? "").trim();

function normalizeApiBase(value) {
  const cleaned = value.trim().replace(/\/$/, "");
  return cleaned.endsWith("/api") ? cleaned : `${cleaned}/api`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function webhookUrl() {
  if (explicitWebhookUrl) return explicitWebhookUrl;
  assert(publicKey, "Set LEADVIRT_PUBLIC_WEBHOOK_KEY.");
  assert(webhookSecret, "Set LEADVIRT_PUBLIC_WEBHOOK_SECRET.");
  const url = new URL(`${publicApiBase}/public/channels/webhook/${encodeURIComponent(publicKey)}/events`);
  url.searchParams.set("secret", webhookSecret);
  return url.toString();
}

function redactedUrl(value) {
  const url = new URL(value);
  if (url.searchParams.has("secret")) {
    url.searchParams.set("secret", "[redacted]");
  }
  return url.toString();
}

async function main() {
  const url = webhookUrl();
  const suffix = Date.now();
  const body = {
    type: "message.incoming",
    accountId: 1001,
    leadId: `umnico-smoke-lead-${suffix}`,
    isNewLead: true,
    isNewCustomer: true,
    socialAccount: {
      id: 2001,
      type: "instagram",
      username: "leadvirt.ai"
    },
    customer: {
      id: `umnico-customer-${suffix}`,
      username: "umnico_smoke",
      name: "Umnico Smoke"
    },
    message: {
      id: `umnico-message-${suffix}`,
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        text: "Привет, хочу узнать про leadvirt.ai"
      }
    }
  };

  console.log("Umnico webhook smoke");
  console.log(`Endpoint: ${redactedUrl(url)}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json().catch(() => null);
  assert(response.ok, `Webhook request failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
  assert(payload?.data?.ok === true, `Webhook response did not return ok=true: ${JSON.stringify(payload)}`);
  assert(payload?.data?.ignored !== true, `Webhook response was ignored: ${JSON.stringify(payload)}`);
  assert(typeof payload?.data?.conversationId === "string" && payload.data.conversationId.length > 0, "Webhook response did not include conversationId.");
  console.log(`PASS: Umnico payload accepted, conversation=${payload.data.conversationId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
