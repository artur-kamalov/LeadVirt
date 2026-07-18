import { expect, test, type APIRequestContext } from "@playwright/test";

const apiBase = (process.env.LEADVIRT_API_BASE ?? "http://localhost:4001/api").replace(/\/$/, "");
const healthUrl = apiBase.replace(/\/api$/, "/health");

type Readiness = { ready: true } | { ready: false; reason: string };

type IntakeResult = {
  conversationId: string;
  leadId: string;
  search: string;
  message: string;
  channelType: "TELEGRAM" | "WEBHOOK" | "WEBSITE";
};

type PilotWorkflow = {
  id: string;
  name: string;
  description: string;
};

async function pilotApiReady(request: APIRequestContext): Promise<Readiness> {
  let healthOk = false;
  try {
    const health = await request.get(healthUrl, { timeout: 3000 });
    healthOk = health.ok();
  } catch {
    healthOk = false;
  }

  if (!healthOk) {
    return { ready: false, reason: `Local API is not healthy at ${healthUrl}` };
  }

  try {
    const channels = await request.get(`${apiBase}/channels`, { timeout: 5000 });
    if (!channels.ok()) {
      return { ready: false, reason: "Demo channels are not readable. Run db:seed and start the API." };
    }
    const payload = (await channels.json()) as { data?: Array<{ type?: string; publicKey?: string | null; status?: string }> };
    const seeded = payload.data ?? [];
    const hasTelegram = seeded.some((channel) => channel.type === "TELEGRAM" && channel.publicKey === "demo-telegram-webhook");
    const hasWebhook = seeded.some((channel) => channel.type === "WEBHOOK" && channel.publicKey === "demo-generic-webhook");
    const hasWidget = seeded.some((channel) => channel.type === "WEBSITE" && channel.publicKey === "demo-website-widget");
    if (!hasTelegram || !hasWebhook || !hasWidget) {
      return { ready: false, reason: "Seeded demo Telegram, webhook, or widget public keys are missing." };
    }
  } catch {
    return { ready: false, reason: "Could not verify seeded demo channels." };
  }

  return { ready: true };
}

function suffix() {
  return `${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

async function createPilotWorkflow(request: APIRequestContext, id: string): Promise<PilotWorkflow> {
  const workflow = {
    name: `Pilot Intake Workflow ${id}`,
    description: "Temporary workflow created by qa:pilot:intake.",
    status: "ACTIVE",
    steps: [
      {
        type: "TRIGGER",
        name: "Pilot inbound trigger",
        positionX: 80,
        positionY: 120,
        config: {
          channels: { telegram: true, whatsapp: false, instagram: true, web: true },
          keywordFilter: "",
          enabled: true,
          blockType: "trigger",
        },
      },
      {
        type: "AI_MESSAGE",
        name: "Pilot AI greeting",
        positionX: 320,
        positionY: 120,
        config: {
          greetingText: "Pilot workflow prepared a reply for {{name}}.",
          enabled: true,
          blockType: "ai",
        },
      },
      {
        type: "END",
        name: "Pilot workflow complete",
        positionX: 560,
        positionY: 120,
        config: { enabled: true, blockType: "end" },
      },
    ],
  };

  const created = await request.post(`${apiBase}/workflows`, { data: workflow });
  expect(created.ok()).toBe(true);
  const createdBody = (await created.json()) as { data?: { id?: string } };
  const workflowId = createdBody.data?.id ?? "";
  expect(workflowId).toBeTruthy();

  const published = await request.post(`${apiBase}/workflows/${workflowId}/publish`);
  expect(published.ok()).toBe(true);
  return { id: workflowId, name: workflow.name, description: workflow.description };
}

async function archivePilotWorkflow(request: APIRequestContext, workflow: PilotWorkflow | null) {
  if (!workflow) return;
  await request.patch(`${apiBase}/workflows/${workflow.id}`, {
    data: {
      name: workflow.name,
      description: workflow.description,
      status: "ARCHIVED",
    },
  });
}

async function postTelegram(request: APIRequestContext, id: string): Promise<IntakeResult> {
  const search = `Pilot TG ${id}`;
  const message = `Pilot Telegram intake ${id}: need an appointment`;
  const response = await request.post(`${apiBase}/public/channels/telegram/demo-telegram-webhook/webhook`, {
    headers: { "x-telegram-bot-api-secret-token": "demo-telegram-secret" },
    data: {
      update_id: `pilot-tg-${id}`,
      message: {
        message_id: `pilot-tg-message-${id}`,
        date: Math.floor(Date.now() / 1000),
        chat: { id: `pilot-tg-chat-${id}` },
        from: {
          id: `pilot-tg-customer-${id}`,
          first_name: "Pilot",
          last_name: `TG ${id}`,
          username: `pilot_tg_${id.replace(/\W/g, "_")}`,
        },
        text: message,
      },
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data?: { conversationId?: string; leadId?: string | null } };
  expect(body.data?.conversationId).toBeTruthy();
  expect(body.data?.leadId).toBeTruthy();
  return {
    conversationId: body.data?.conversationId ?? "",
    leadId: body.data?.leadId ?? "",
    search,
    message,
    channelType: "TELEGRAM",
  };
}

async function postWebhook(request: APIRequestContext, id: string): Promise<IntakeResult> {
  const search = `Pilot Webhook ${id}`;
  const message = `Pilot webhook intake ${id}: asking for pricing and booking`;
  const response = await request.post(`${apiBase}/public/channels/webhook/demo-generic-webhook/events`, {
    headers: { "x-leadvirt-webhook-secret": "demo-webhook-secret" },
    data: {
      eventId: `pilot-webhook-${id}`,
      source: "Pilot social landing webhook",
      conversationId: `pilot-webhook-conversation-${id}`,
      message: {
        id: `pilot-webhook-message-${id}`,
        text: message,
        timestamp: new Date().toISOString(),
      },
      customer: {
        id: `pilot-webhook-customer-${id}`,
        name: search,
        phone: "+79990000000",
      },
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data?: { conversationId?: string; leadId?: string | null } };
  expect(body.data?.conversationId).toBeTruthy();
  expect(body.data?.leadId).toBeTruthy();
  return {
    conversationId: body.data?.conversationId ?? "",
    leadId: body.data?.leadId ?? "",
    search,
    message,
    channelType: "WEBHOOK",
  };
}

async function postWidget(request: APIRequestContext, id: string): Promise<IntakeResult> {
  const search = `Pilot Widget ${id}`;
  const message = `Pilot widget intake ${id}: need available slots tomorrow`;
  const response = await request.post(`${apiBase}/public/widget/demo-website-widget/messages`, {
    data: {
      sessionId: `pilot-widget-session-${id}`,
      clientMessageId: `pilot-widget-message-${id}`,
      text: message,
      customer: {
        name: search,
        phone: "+79991111111",
      },
      pageUrl: "https://pilot.local/social-landing",
      referrer: "https://instagram.com/",
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data?: { conversationId?: string; leadId?: string | null } };
  expect(body.data?.conversationId).toBeTruthy();
  expect(body.data?.leadId).toBeTruthy();
  return {
    conversationId: body.data?.conversationId ?? "",
    leadId: body.data?.leadId ?? "",
    search,
    message,
    channelType: "WEBSITE",
  };
}

async function assertVisibleInInbox(request: APIRequestContext, intake: IntakeResult) {
  const response = await request.get(`${apiBase}/inbox/conversations?search=${encodeURIComponent(intake.search)}&limit=20`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data?: Array<{
      id?: string;
      leadId?: string | null;
      channelType?: string | null;
      lastMessage?: string | null;
      lead?: { name?: string | null; interest?: string | null } | null;
    }>;
  };
  const row = body.data?.find((item) => item.id === intake.conversationId);
  expect(row).toBeTruthy();
  expect(row?.leadId).toBe(intake.leadId);
  expect(row?.lead?.name).toBe(intake.search);
  expect(row?.channelType).toBe(intake.channelType);
  expect(row?.lastMessage).toBe(intake.message);
  expect(row?.lead?.interest).toBe(intake.message.trim().slice(0, 80));
}

async function assertVisibleInPipeline(request: APIRequestContext, intake: IntakeResult) {
  const response = await request.get(`${apiBase}/leads/pipeline/summary`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data?: {
      stages?: Array<{
        leads?: Array<{
          id?: string;
          name?: string | null;
          channelType?: string | null;
          interest?: string | null;
        }>;
      }>;
    };
  };
  const lead = body.data?.stages?.flatMap((stage) => stage.leads ?? []).find((item) => item.id === intake.leadId);
  expect(lead).toBeTruthy();
  expect(lead?.name).toBe(intake.search);
  expect(lead?.channelType).toBe(intake.channelType);
  expect(lead?.interest).toBe(intake.message.trim().slice(0, 80));
}

async function assertWorkflowTimelineEvent(request: APIRequestContext, intake: IntakeResult, workflow: PilotWorkflow) {
  const response = await request.get(`${apiBase}/conversations/${intake.conversationId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data?: { events?: Array<{ type?: string; message?: string | null }> };
  };
  const workflowEvent = body.data?.events?.find(
    (event) => event.type === "workflow_run_completed" && event.message === workflow.name
  );
  expect(workflowEvent).toBeTruthy();
}

async function sendManagerFollowUp(request: APIRequestContext, intake: IntakeResult) {
  const followUp = `Manager follow-up for ${intake.search}`;
  const response = await request.post(`${apiBase}/conversations/${intake.conversationId}/messages`, {
    data: { text: followUp },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data?: { messages?: Array<{ text?: string | null; senderType?: string }> } };
  const message = body.data?.messages?.find((item) => item.text === followUp);
  expect(message).toBeTruthy();
  expect(message?.senderType).toBe("USER");
}

test.describe.configure({ mode: "serial" });

test("seeded demo public intake creates visible leads and supports manager follow-up", async ({ request }) => {
  const readiness = await pilotApiReady(request);
  if (!readiness.ready) {
    test.skip(true, readiness.reason);
  }

  const id = suffix();
  let workflow: PilotWorkflow | null = null;

  try {
    workflow = await createPilotWorkflow(request, id);
    const intakes = [
      await postTelegram(request, id),
      await postWebhook(request, id),
      await postWidget(request, id),
    ];

    for (const intake of intakes) {
      await assertVisibleInInbox(request, intake);
      await assertVisibleInPipeline(request, intake);
      await assertWorkflowTimelineEvent(request, intake, workflow);
    }

    await sendManagerFollowUp(request, intakes[0]);
  } finally {
    await archivePilotWorkflow(request, workflow);
  }
});
