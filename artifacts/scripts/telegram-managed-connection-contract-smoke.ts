import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  TelegramAdapter,
  TelegramBotApiClient,
} from "@leadvirt/integrations";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = "telegram-contract-key";

const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
let webhookUrl = "";
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = url.split("/").at(-1) ?? "";
  const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  requests.push({ method, payload });

  let result: unknown = true;
  if (method === "getMe") {
    result = {
      id: 987654321,
      is_bot: true,
      first_name: "LeadVirt Test",
      username: "leadvirt_test_bot",
    };
  } else if (method === "setWebhook") {
    webhookUrl = String(payload.url ?? "");
  } else if (method === "getWebhookInfo") {
    result = { url: webhookUrl, pending_update_count: 0 };
  } else if (method === "sendMessage") {
    result = { message_id: 55 };
  }

  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main() {
  const botToken = "987654321:AA-contract-token";
  const encrypted = encryptIntegrationCredentials({ botToken });
  assert(!encrypted.includes(botToken), "Encrypted credentials contain the raw bot token.");
  assert(
    decryptIntegrationCredentials(encrypted).botToken === botToken,
    "Encrypted credential round trip failed.",
  );

  const client = new TelegramBotApiClient(fetcher, "https://telegram.contract.test");
  const profile = await client.getMe(botToken);
  assert(profile.username === "leadvirt_test_bot", "getMe did not return the bot profile.");

  await client.setWebhook({
    botToken,
    url: "https://leadvirt.com/api/public/channels/telegram/lvtg_contract/webhook",
    secretToken: "generated-secret_token",
    allowedUpdates: ["message", "edited_message"],
  });
  const setWebhook = requests.find((request) => request.method === "setWebhook");
  assert(
    setWebhook?.payload.secret_token === "generated-secret_token",
    "Webhook secret was not registered.",
  );
  assert(
    Array.isArray(setWebhook.payload.allowed_updates) &&
      setWebhook.payload.allowed_updates.length === 2,
    "Allowed Telegram updates were not registered.",
  );

  const webhookInfo = await client.getWebhookInfo(botToken);
  assert(webhookInfo.url === webhookUrl, "Webhook verification returned the wrong URL.");

  const adapter = new TelegramAdapter(client);
  const sent = await adapter.sendMessage({
    tenantId: "tenant-contract",
    channelAccountId: "987654321",
    conversationId: "conversation-contract",
    externalConversationId: "telegram:445566",
    text: "Contract reply",
    credentials: { botToken },
  });
  assert(sent.status === "sent", "Telegram adapter did not report a sent message.");
  assert(sent.externalMessageId === "telegram:55", "Telegram message id was not normalized.");
  const sendMessage = requests.find((request) => request.method === "sendMessage");
  assert(sendMessage?.payload.chat_id === "445566", "Telegram chat id was not extracted.");

  await client.deleteWebhook(botToken);
  assert(
    requests.some((request) => request.method === "deleteWebhook"),
    "Webhook disconnect was not called.",
  );
  console.log("Telegram managed connection contract: 10/10 checks passed");
}

void main();
