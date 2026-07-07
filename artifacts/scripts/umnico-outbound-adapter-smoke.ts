import { WebhookAdapter } from "@leadvirt/integrations";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/managers")) {
      return new Response(JSON.stringify([{ id: 15, role: "owner" }]), { status: 200 });
    }

    if (url.endsWith("/messaging/66589202/send")) {
      return new Response(JSON.stringify([{ messageId: "umnico-outbound-1", customId: "leadvirt-message-1" }]), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const result = await new WebhookAdapter().sendMessage({
      tenantId: "tenant-1",
      channelAccountId: "channel-1",
      conversationId: "conversation-1",
      externalConversationId: "umnico:197166:66589202",
      text: "LeadVirt outbound smoke",
      settings: {
        webhook: {
          provider: "umnico",
          umnico: {
            apiToken: "test-token"
          }
        }
      },
      metadata: {
        messageId: "leadvirt-message-1",
        raw: {
          message: {
            source: { realId: 255 },
            sa: { id: 88 }
          }
        }
      }
    });

    assert(result.status === "sent", `Expected sent, got ${result.status}; calls=${JSON.stringify(calls.map((call) => ({ url: call.url, body: call.init?.body })))}`);
    const sendCall = calls.find((call) => call.url.endsWith("/messaging/66589202/send"));
    assert(sendCall, "Send endpoint was not called.");
    assert(isRecord(sendCall.init), "Send init missing.");
    const body = JSON.parse(String(sendCall.init.body));
    assert(body.message?.text === "LeadVirt outbound smoke", "Message text mismatch.");
    assert(body.source === "255", "Umnico source realId mismatch.");
    assert(body.userId === 15, "Umnico userId mismatch.");
    assert(body.saId === 88, "Umnico saId mismatch.");
    assert(body.customId === "leadvirt-message-1", "Custom id mismatch.");

    console.log(JSON.stringify({ ok: true, result }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
