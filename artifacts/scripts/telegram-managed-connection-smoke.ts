import { randomUUID } from "node:crypto";
import { loadEnvFile } from "@leadvirt/config";
import { decryptIntegrationCredentials } from "@leadvirt/integrations";
import { prisma, type Prisma } from "@leadvirt/db";
import type { AiReplyEnqueueRequest, AiReplyJobData } from "@leadvirt/types";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import type { AiReplyQueueService } from "../../apps/api/src/modules/ai/ai-reply-queue.service.js";
import { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import { ConversationsService } from "../../apps/api/src/modules/conversations/conversations.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramBotApiService } from "../../apps/api/src/modules/telegram/telegram-bot-api.service.js";
import { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";
import type { WorkflowsService } from "../../apps/api/src/modules/workflows/workflows.service.js";
import type { RuntimeQueueService } from "../../apps/api/src/modules/ai/runtime-queue.service.js";

loadEnvFile();
process.env.API_URL = "https://leadvirt.test";
process.env.TELEGRAM_WEBHOOK_BASE_URL = "https://telegram-gateway.test/telegram-webhook/";
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = "telegram-managed-connection-smoke";

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

function contextFor(tenant: RequestContext["tenant"], userId: string): RequestContext {
  return {
    tenantId: tenant.id,
    userId,
    role: "OWNER",
    authMode: "credentials",
    tenant,
    user: {
      id: userId,
      email: `telegram-smoke-${tenant.id}@leadvirt.ai`,
      phone: null,
      name: "Telegram Smoke",
      avatarUrl: null,
      passwordChangeRequired: false,
    },
  };
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const botToken = "987654321:AA-managed-connection-token";
  const replacementToken = "987654322:AA-replacement-connection-token";
  const raceToken = "987654323:AA-concurrent-connection-token";
  let tenantId: string | null = null;
  let userId: string | null = null;
  let webhookUrl = "";
  let webhookSecret = "";
  let deleteCalls = 0;
  let setWebhookCalls = 0;
  let failNextSetWebhook = false;
  let reportedWebhookUrl: string | null = null;
  let pendingUpdates = 0;
  let lastDeliveryError = false;
  let clearDeliveryFailureOnSet = false;
  let requirePersistedSecretOnNextSet = false;
  let expectedPreviousSecretOnNextSet: string | null = null;
  let activeWebhookBotToken = "";
  let retiredPendingUpdates = 0;
  let retiredLastDeliveryError = false;
  let retiredWebhookDeleted = false;
  let retiredWebhookUrl = "";
  let deliverOldBotUpdateOnNextInfo = false;
  let oldBotDrainInboundMessageId: string | null = null;
  let failDeleteWebhookForToken: string | null = null;
  const deleteTokens: string[] = [];
  const deleteDropPending: boolean[] = [];
  let webhookAllowedUpdates: string[] = [];
  let reportedAllowedUpdates: string[] | null = null;
  const queuedJobs: AiReplyJobData[] = [];
  const enqueuedJobs: AiReplyJobData[] = [];
  let rejectNextQueueAdmission = false;
  let workflowRuns = 0;
  let telegramService: TelegramService;

  const projectJob = async (
    database: Prisma.TransactionClient | typeof prisma,
    request: AiReplyEnqueueRequest,
  ): Promise<AiReplyJobData> => {
    const identity = await database.authenticatedCustomerIdentity.findFirst({
      where: {
        tenantId: request.tenantId,
        conversationId: request.conversationId,
        messageId: request.triggerMessageId,
      },
      select: { id: true, version: true, subjectHash: true, attestationHash: true },
    });
    return {
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      triggerMessageId: request.triggerMessageId,
      source: request.source,
      ...(request.requestedByUserId !== undefined
        ? { requestedByUserId: request.requestedByUserId }
        : {}),
      ...(identity?.version === 1
        ? {
            customerIdentity: {
              id: identity.id,
              version: 1,
              subjectHash: identity.subjectHash,
              attestationHash: identity.attestationHash,
            },
          }
        : {}),
    };
  };

  const botApi = {
    getMe: async (token: string) => ({
      id: token === replacementToken ? 987654322 : token === raceToken ? 987654323 : 987654321,
      is_bot: true,
      first_name: "Client Magic",
      username:
        token === replacementToken
          ? "replacement_magic_bot"
          : token === raceToken
            ? "concurrent_magic_bot"
            : "client_magic_bot",
    }),
    setWebhook: async (input: {
      botToken: string;
      url: string;
      secretToken: string;
      allowedUpdates: string[];
    }) => {
      setWebhookCalls += 1;
      assert(
        input.allowedUpdates.length === 2 &&
          input.allowedUpdates.includes("message") &&
          input.allowedUpdates.includes("edited_message"),
        "Telegram webhook registration did not request the exact inbound update policy.",
      );
      if (requirePersistedSecretOnNextSet) {
        const activeChannel = await prisma.channel.findFirst({
          where: { tenantId: tenantId!, type: "TELEGRAM", deletedAt: null },
          select: { settings: true },
        });
        const settings = activeChannel?.settings as Record<string, unknown> | null;
        const telegram = settings?.telegram as Record<string, unknown> | undefined;
        assert(
          telegram?.webhookSecret === input.secretToken ||
            telegram?.webhookPendingSecret === input.secretToken,
          "Telegram webhook registration raced ahead of secret persistence.",
        );
        if (expectedPreviousSecretOnNextSet) {
          assert(
            telegram?.webhookSecret === expectedPreviousSecretOnNextSet &&
              (input.secretToken === expectedPreviousSecretOnNextSet
                ? telegram.webhookPendingSecret === undefined ||
                  telegram.webhookPendingSecret === input.secretToken
                : telegram.webhookPendingSecret === input.secretToken),
            input.secretToken === expectedPreviousSecretOnNextSet
              ? "Telegram bot replacement did not reuse the active webhook secret."
              : "Telegram webhook rotation did not retain the active secret while staging the candidate.",
          );
        }
        requirePersistedSecretOnNextSet = false;
        expectedPreviousSecretOnNextSet = null;
      }
      if (failNextSetWebhook) {
        failNextSetWebhook = false;
        throw new Error("Arranged Telegram webhook failure.");
      }
      if (input.botToken === replacementToken && activeWebhookBotToken === botToken) {
        retiredWebhookUrl = webhookUrl;
      }
      webhookUrl = input.url;
      webhookSecret = input.secretToken;
      activeWebhookBotToken = input.botToken;
      if (input.botToken === botToken) retiredWebhookDeleted = false;
      webhookAllowedUpdates = [...input.allowedUpdates];
      reportedWebhookUrl = null;
      reportedAllowedUpdates = null;
      if (clearDeliveryFailureOnSet) {
        clearDeliveryFailureOnSet = false;
        pendingUpdates = 0;
        lastDeliveryError = false;
      }
      return true;
    },
    getWebhookInfo: async (token: string) => {
      if (token === botToken && activeWebhookBotToken === replacementToken) {
        const reportedRetiredPendingUpdates = retiredPendingUpdates;
        if (deliverOldBotUpdateOnNextInfo) {
          deliverOldBotUpdateOnNextInfo = false;
          const activeChannel = await prisma.channel.findFirstOrThrow({
            where: { tenantId: tenantId!, type: "TELEGRAM", deletedAt: null },
            select: { publicKey: true },
          });
          const result = await telegramService.handleWebhook(
            activeChannel.publicKey!,
            {
              update_id: 1_800_000_123,
              message: {
                message_id: 123,
                date: Math.floor(Date.now() / 1000),
                chat: { id: -100_123, type: "group", title: "Old bot drain" },
                from: { id: 123, is_bot: false, first_name: "Drain" },
                text: "Old bot update during replacement",
              },
            },
            { "x-telegram-bot-api-secret-token": webhookSecret },
            "TELEGRAM_WEBHOOK",
          );
          oldBotDrainInboundMessageId = result.inboundMessageId;
          retiredPendingUpdates = 0;
        }
        return {
          url: retiredWebhookDeleted ? "" : retiredWebhookUrl || webhookUrl,
          pending_update_count: reportedRetiredPendingUpdates,
          allowed_updates: webhookAllowedUpdates,
          ...(retiredLastDeliveryError
            ? { last_error_date: Math.floor(Date.now() / 1000), last_error_message: "Timed out" }
            : {}),
        };
      }
      return {
        url: reportedWebhookUrl ?? webhookUrl,
        pending_update_count: pendingUpdates,
        allowed_updates: reportedAllowedUpdates ?? webhookAllowedUpdates,
        ...(lastDeliveryError
          ? { last_error_date: Math.floor(Date.now() / 1000), last_error_message: "Timed out" }
          : {}),
      };
    },
    deleteWebhook: async (token: string, options: { dropPendingUpdates?: boolean } = {}) => {
      deleteCalls += 1;
      deleteTokens.push(token);
      deleteDropPending.push(options.dropPendingUpdates ?? false);
      if (failDeleteWebhookForToken === token) {
        failDeleteWebhookForToken = null;
        throw new Error("Arranged Telegram webhook cleanup failure.");
      }
      if (token === activeWebhookBotToken) {
        webhookUrl = "";
        webhookAllowedUpdates = [];
        reportedWebhookUrl = null;
        reportedAllowedUpdates = null;
      }
      if (token === botToken && activeWebhookBotToken === replacementToken) {
        retiredWebhookDeleted = true;
        if (options.dropPendingUpdates) {
          retiredPendingUpdates = 0;
          deliverOldBotUpdateOnNextInfo = false;
        }
      }
      return true;
    },
  } as TelegramBotApiService;

  const aiReplyQueue = {
    enabled: true,
    createEvent: async (tx: Prisma.TransactionClient, request: AiReplyEnqueueRequest) => {
      if (rejectNextQueueAdmission) {
        rejectNextQueueAdmission = false;
        return { created: false, reason: "CONVERSATION_AI_DISABLED" as const };
      }
      const data = await projectJob(tx, request);
      queuedJobs.push(data);
      return {
        created: true,
        event: { id: `runtime-inbound:${request.triggerMessageId}` },
      };
    },
    enqueue: async (request: AiReplyEnqueueRequest) => {
      const data = await projectJob(prisma, request);
      enqueuedJobs.push(data);
      return {
        queued: true,
        jobId: `ai-reply:${request.conversationId}:${request.triggerMessageId}`,
      };
    },
  } as unknown as AiReplyQueueService;
  telegramService = new TelegramService(prisma as unknown as PrismaService, aiReplyQueue, {
    runForEvent: async () => {
      workflowRuns += 1;
      return { matched: 0, runs: [] };
    },
  } as unknown as WorkflowsService);

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name: "Telegram Managed Connection Smoke",
        slug: `telegram-managed-${suffix}`,
        timezone: "Europe/Paris",
      },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { email: `telegram-managed-${suffix}@leadvirt.ai`, name: "Telegram Smoke" },
    });
    userId = user.id;
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
    });

    const context = contextFor(tenant, user.id);
    const channels = new ChannelsService(prisma as unknown as PrismaService);
    const integrations = new IntegrationsService(
      prisma as unknown as PrismaService,
      channels,
      botApi,
      telegramService,
      {} as WebhookService,
    );

    const connected = await integrations.connect(context, "TELEGRAM", { botToken });
    assert(connected.status === "CONNECTED", "Telegram integration was not connected.");
    assert(
      connected.name.includes("@client_magic_bot"),
      "Bot username was not derived from getMe.",
    );
    assert(
      webhookUrl.startsWith("https://telegram-gateway.test/telegram-webhook/lvtg_") &&
        webhookUrl.endsWith("/webhook"),
      "Managed webhook relay URL was not registered.",
    );
    assert(webhookSecret.length >= 24, "Managed webhook secret was not generated.");
    assert(
      !JSON.stringify(connected).includes(botToken),
      "Integration response leaked the bot token.",
    );
    assert(
      !JSON.stringify(connected).includes(webhookSecret),
      "Integration response leaked the webhook secret.",
    );

    const channel = await prisma.channel.findFirst({
      where: { tenantId: tenant.id, type: "TELEGRAM", deletedAt: null },
    });
    assert(channel?.status === "ACTIVE", "Telegram channel was not activated.");
    assert(channel.externalId === "987654321", "Telegram bot id was not stored.");
    assert(Boolean(channel.encryptedCredentials), "Telegram credentials were not stored.");
    assert(
      !channel.encryptedCredentials!.includes(botToken),
      "Stored credentials contain the raw bot token.",
    );
    assert(
      decryptIntegrationCredentials(channel.encryptedCredentials!).botToken === botToken,
      "Stored Telegram credentials could not be decrypted.",
    );
    assert(
      !JSON.stringify(await channels.list(context)).includes(webhookSecret),
      "Channel response leaked the Telegram webhook secret.",
    );

    const settingsBeforeStage = JSON.stringify(channel.settings);
    const stagedCandidate = `staged_${randomUUID().replaceAll("-", "")}`;
    const stagedSecret = await channels.stageTelegramWebhookSecret(context, {
      channelId: channel.id,
      candidateSecret: stagedCandidate,
      candidateBotId: channel.externalId!,
      expectedEncryptedCredentials: channel.encryptedCredentials,
    });
    assert(stagedSecret.staged, "Telegram webhook candidate was not staged.");
    assert(
      stagedSecret.previousWebhookSecret === webhookSecret,
      "Telegram webhook stage did not retain the active secret.",
    );
    const stagedChannel = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    assert(
      JSON.stringify(stagedChannel.settings).includes(stagedCandidate) &&
        JSON.stringify(stagedChannel.settings).includes(webhookSecret),
      "Telegram webhook stage did not persist both accepted secrets.",
    );
    assert(
      !JSON.stringify(await channels.list(context)).includes(stagedCandidate),
      "Channel response leaked the staged Telegram webhook secret.",
    );
    const stagedEventCount = await prisma.webhookEvent.count({ where: { tenantId: tenant.id } });
    let stagedInboundRejected = false;
    try {
      await telegramService.handleWebhook(
        channel.publicKey!,
        {
          update_id: 1_800_000_018,
          message: {
            message_id: 18,
            date: Math.floor(Date.now() / 1000),
            chat: { id: -100_018, type: "group", title: "Secret rotation test" },
            from: { id: 18, is_bot: false, first_name: "Rotation" },
            text: "Inbound while the webhook secret is staged",
          },
        },
        { "x-telegram-bot-api-secret-token": stagedCandidate },
        "TELEGRAM_WEBHOOK",
      );
    } catch (error) {
      stagedInboundRejected =
        error instanceof Error && error.message.includes("still being activated");
    }
    assert(
      stagedInboundRejected &&
        (await prisma.webhookEvent.count({ where: { tenantId: tenant.id } })) === stagedEventCount,
      "Telegram pending secret crossed the inbound persistence boundary before activation.",
    );
    assert(
      await channels.rollbackTelegramWebhookSecret(context, {
        channelId: channel.id,
        candidateSecret: stagedCandidate,
        expectedEncryptedCredentials: channel.encryptedCredentials,
        previousPendingWebhookSecret: stagedSecret.previousPendingWebhookSecret,
        previousPendingBotId: stagedSecret.previousPendingBotId,
      }),
      "Telegram webhook candidate rollback did not complete.",
    );
    const rolledBackChannel = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    assert(
      JSON.stringify(rolledBackChannel.settings) === settingsBeforeStage,
      "Telegram webhook candidate rollback did not restore the exact prior settings.",
    );

    const privateUpdate = {
      update_id: Number(`${Date.now()}`.slice(-9)),
      message: {
        message_id: 19,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 8_173_697_473, type: "private", first_name: "Private Client" },
        from: {
          id: 8_173_697_473,
          is_bot: false,
          first_name: "Private Client",
          language_code: "en",
        },
        text: "Need services and pricing",
      },
    };
    let wrongSecretRejected = false;
    try {
      await telegramService.handleWebhook(
        channel.publicKey!,
        privateUpdate,
        {
          "x-telegram-bot-api-secret-token": "wrong-secret",
        },
        "TELEGRAM_WEBHOOK",
      );
    } catch {
      wrongSecretRejected = true;
    }
    assert(wrongSecretRejected, "Managed Telegram inbound accepted the wrong webhook secret.");

    const webhookEventsBeforeMalformed = await prisma.webhookEvent.count({
      where: { tenantId: tenant.id },
    });
    const malformedTelegramUpdates = [
      { update_id: privateUpdate.update_id + 500 },
      {
        update_id: privateUpdate.update_id + 501,
        message: {
          ...privateUpdate.message,
          message_id: "19",
        },
      },
      {
        update_id: privateUpdate.update_id + 502,
        message: {
          ...privateUpdate.message,
          chat: { ...privateUpdate.message.chat, id: "8173697473" },
        },
      },
    ];
    for (const malformedUpdate of malformedTelegramUpdates) {
      let malformedRejected = false;
      try {
        await telegramService.handleWebhook(
          channel.publicKey!,
          malformedUpdate,
          { "x-telegram-bot-api-secret-token": webhookSecret },
          "TELEGRAM_WEBHOOK",
        );
      } catch (error) {
        malformedRejected = error instanceof Error && error.message.includes("payload is invalid");
      }
      assert(malformedRejected, "Malformed Telegram payload crossed the persistence boundary.");
    }
    assert(
      (await prisma.webhookEvent.count({ where: { tenantId: tenant.id } })) ===
        webhookEventsBeforeMalformed,
      "Malformed Telegram payload created a webhook event.",
    );

    const inbound = await telegramService.handleWebhook(
      channel.publicKey!,
      privateUpdate,
      {
        "x-telegram-bot-api-secret-token": webhookSecret,
      },
      "TELEGRAM_WEBHOOK",
    );
    assert(!inbound.duplicate, "First managed Telegram update was treated as a duplicate.");
    assert(inbound.inboundMessageId !== null, "Managed Telegram update did not create a message.");
    assert(
      inbound.outboundStatus === "queued",
      "Managed Telegram update did not queue an AI reply.",
    );
    const replay = await telegramService.handleWebhook(
      channel.publicKey!,
      privateUpdate,
      {
        "x-telegram-bot-api-secret-token": webhookSecret,
      },
      "TELEGRAM_WEBHOOK",
    );
    assert(replay.duplicate, "Managed Telegram update replay was not deduplicated.");

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: inbound.conversationId },
      include: { lead: true, messages: true },
    });
    assert(
      conversation.externalConversationId === "telegram:8173697473",
      "Private Telegram chat id was not normalized as the conversation identity.",
    );
    assert(conversation.lead?.channelType === "TELEGRAM", "Telegram lead was not persisted.");
    assert(
      conversation.messages.filter(
        (message) =>
          message.direction === "INBOUND" &&
          message.externalMessageId === "telegram:bot:987654321:message:19",
      ).length === 1,
      "Managed Telegram replay created more than one inbound message.",
    );
    const privateQueuedJob = queuedJobs.find(
      (job) => job.source === "telegram" && job.triggerMessageId === inbound.inboundMessageId,
    );
    assert(
      privateQueuedJob !== undefined,
      "Managed Telegram inbound did not persist the queue request with the message identity.",
    );
    assert(
      !Object.prototype.hasOwnProperty.call(privateQueuedJob, "text") &&
        !JSON.stringify(privateQueuedJob).includes(privateUpdate.message.text),
      "Managed Telegram inbound leaked raw text into the queue job.",
    );
    const privateEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: `telegram:${channel.id}`,
          externalEventId: `telegram:bot:987654321:update:${privateUpdate.update_id}`,
        },
      },
    });
    const privateIdentities = await prisma.authenticatedCustomerIdentity.findMany({
      where: { tenantId: tenant.id, messageId: inbound.inboundMessageId },
    });
    assert(
      privateIdentities.length === 1,
      "Private Telegram webhook replay did not retain exactly one customer identity.",
    );
    const privateIdentity = privateIdentities[0]!;
    assert(
      privateIdentity.tenantId === tenant.id &&
        privateIdentity.channelId === channel.id &&
        privateIdentity.conversationId === conversation.id &&
        privateIdentity.messageId === inbound.inboundMessageId &&
        privateIdentity.webhookEventId === privateEvent.id,
      "Private Telegram identity was not linked to the exact inbound boundary records.",
    );
    assert(
      privateIdentity.version === 1 &&
        privateIdentity.provider === "TELEGRAM" &&
        privateIdentity.authenticationMethod === "TELEGRAM_WEBHOOK_SECRET" &&
        privateIdentity.subjectSource === "TELEGRAM_MESSAGE_FROM_ID" &&
        privateIdentity.conversationType === "PRIVATE",
      "Private Telegram identity did not persist the immutable authentication contract.",
    );
    assert(
      privateIdentity.eventPayloadHash === privateEvent.payloadHash &&
        privateIdentity.authenticatedAt.getTime() === privateEvent.receivedAt.getTime() &&
        privateEvent.status === "PROCESSED",
      "Private Telegram identity did not preserve the exact processed webhook evidence.",
    );
    assert(
      [
        privateIdentity.subjectHash,
        privateIdentity.channelBindingHash,
        privateIdentity.eventPayloadHash,
        privateIdentity.attestationHash,
      ].every((value) => /^[a-f0-9]{64}$/.test(value)),
      "Private Telegram identity hashes do not satisfy the persisted contract.",
    );
    const expectedIdentityReference = {
      id: privateIdentity.id,
      version: 1,
      subjectHash: privateIdentity.subjectHash,
      attestationHash: privateIdentity.attestationHash,
    };
    const referencesPrivateIdentity = (job: AiReplyJobData | undefined) =>
      job?.customerIdentity?.id === expectedIdentityReference.id &&
      job.customerIdentity.version === expectedIdentityReference.version &&
      job.customerIdentity.subjectHash === expectedIdentityReference.subjectHash &&
      job.customerIdentity.attestationHash === expectedIdentityReference.attestationHash;
    assert(
      referencesPrivateIdentity(
        queuedJobs.find((job) => job.triggerMessageId === inbound.inboundMessageId),
      ),
      "Persisted Telegram runtime event did not carry the exact customer identity reference.",
    );
    assert(
      !enqueuedJobs.find((job) => job.triggerMessageId === inbound.inboundMessageId),
      "Telegram intake redundantly enqueued an AI job outside its durable transaction.",
    );

    const activeLeaseAcquiredAt = new Date();
    await prisma.webhookEvent.update({
      where: { id: privateEvent.id },
      data: {
        status: "RECEIVED",
        errorMessage: null,
        processedAt: null,
        leaseToken: `managed-smoke-active-${suffix}`,
        leaseAcquiredAt: activeLeaseAcquiredAt,
        leaseExpiresAt: new Date(activeLeaseAcquiredAt.getTime() + 5 * 60_000),
      },
    });
    let inProgressRetryRejected = false;
    try {
      await telegramService.handleWebhook(
        channel.publicKey!,
        privateUpdate,
        { "x-telegram-bot-api-secret-token": webhookSecret },
        "TELEGRAM_WEBHOOK",
      );
    } catch (error) {
      inProgressRetryRejected =
        error instanceof Error && error.message.includes("still in progress");
    }
    assert(
      inProgressRetryRejected,
      "An in-progress Telegram update retry was acknowledged before processing completed.",
    );

    const enqueuedBeforeResume = enqueuedJobs.length;
    const workflowsBeforeResume = workflowRuns;
    await prisma.webhookEvent.update({
      where: { id: privateEvent.id },
      data: {
        status: "FAILED",
        errorMessage: "retry smoke",
        processedAt: new Date(),
        leaseToken: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
      },
    });
    const resumed = await telegramService.handleWebhook(
      channel.publicKey!,
      privateUpdate,
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    const resumedEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: privateEvent.id },
    });
    assert(!resumed.duplicate, "Failed Telegram webhook was not resumed.");
    assert(
      resumedEvent.status === "PROCESSED" &&
        resumedEvent.receivedAt.getTime() === privateEvent.receivedAt.getTime(),
      "Telegram webhook retry changed immutable authentication receipt time.",
    );
    assert(
      resumedEvent.processingAttempt === privateEvent.processingAttempt + 1 &&
        resumedEvent.leaseToken === null &&
        resumedEvent.leaseAcquiredAt === null &&
        resumedEvent.leaseExpiresAt === null,
      "Telegram webhook retry did not use and release a distinct processing lease.",
    );
    assert(
      enqueuedJobs.length === enqueuedBeforeResume && workflowRuns === workflowsBeforeResume,
      "A completed Telegram AI or workflow stage was replayed after the event was marked failed.",
    );
    assert(
      (await prisma.authenticatedCustomerIdentity.count({
        where: { tenantId: tenant.id, messageId: inbound.inboundMessageId },
      })) === 1,
      "Telegram webhook retry duplicated the authenticated customer identity.",
    );

    const enqueuedBeforeAlternateUpdate = enqueuedJobs.length;
    const workflowsBeforeAlternateUpdate = workflowRuns;
    const alternateUpdate = await telegramService.handleWebhook(
      channel.publicKey!,
      { ...privateUpdate, update_id: privateUpdate.update_id + 10 },
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    assert(
      alternateUpdate.inboundMessageId === inbound.inboundMessageId,
      "An alternate Telegram update id did not resolve to the existing message.",
    );
    assert(
      enqueuedJobs.length === enqueuedBeforeAlternateUpdate &&
        workflowRuns === workflowsBeforeAlternateUpdate,
      "An alternate Telegram update id reran AI or workflow side effects for the same message.",
    );

    const editedText = "Need updated services and pricing";
    const edited = await telegramService.handleWebhook(
      channel.publicKey!,
      {
        update_id: privateUpdate.update_id + 11,
        edited_message: { ...privateUpdate.message, text: editedText },
      },
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    assert(
      edited.inboundMessageId === inbound.inboundMessageId,
      "Telegram edit did not resolve to the original Inbox message.",
    );
    const editedMessage = await prisma.message.findUniqueOrThrow({
      where: { id: inbound.inboundMessageId },
    });
    assert(editedMessage.text === editedText, "Telegram edit was not reflected in persisted text.");
    assert(
      enqueuedJobs.length === enqueuedBeforeAlternateUpdate &&
        workflowRuns === workflowsBeforeAlternateUpdate,
      "Telegram edit reran AI or workflow side effects for an existing message.",
    );

    let identityUpdateRejected = false;
    try {
      await prisma.authenticatedCustomerIdentity.update({
        where: { id: privateIdentity.id },
        data: { version: 1 },
      });
    } catch {
      identityUpdateRejected = true;
    }
    assert(identityUpdateRejected, "Authenticated Telegram identity accepted a direct update.");

    let identityDeleteRejected = false;
    try {
      await prisma.authenticatedCustomerIdentity.delete({ where: { id: privateIdentity.id } });
    } catch {
      identityDeleteRejected = true;
    }
    assert(identityDeleteRejected, "Authenticated Telegram identity accepted a direct delete.");
    assert(
      (await prisma.authenticatedCustomerIdentity.count({
        where: { id: privateIdentity.id },
      })) === 1,
      "Rejected identity mutation removed the persisted Telegram identity.",
    );
    const conversations = new ConversationsService(
      prisma as unknown as PrismaService,
      {} as AiProvider,
      {} as RuntimeQueueService,
    );
    const inbox = await conversations.list(context, { page: 1, limit: 50 });
    assert(
      inbox.data.some((item) => item.id === conversation.id),
      "Managed Telegram conversation was not visible through the Inbox query.",
    );
    assert(
      inbox.data.find((item) => item.id === conversation.id)?.lastMessage === editedText,
      "The Inbox query did not expose the edited Telegram message.",
    );
    assert(
      inbox.data.find((item) => item.id === conversation.id)?.unreadCount === 1,
      "The Inbox did not mark a latest inbound Telegram message as needing a reply.",
    );

    const newestTelegramDate = privateUpdate.message.date + 120;
    await telegramService.handleWebhook(
      channel.publicKey!,
      {
        ...privateUpdate,
        update_id: privateUpdate.update_id + 20,
        message: {
          ...privateUpdate.message,
          message_id: 21,
          date: newestTelegramDate,
          text: "Newest ordered Telegram message",
        },
      },
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    await telegramService.handleWebhook(
      channel.publicKey!,
      {
        ...privateUpdate,
        update_id: privateUpdate.update_id + 21,
        message: {
          ...privateUpdate.message,
          message_id: 22,
          date: newestTelegramDate - 60,
          text: "Delayed older Telegram message",
        },
      },
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    const orderedConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { lead: true },
    });
    assert(
      orderedConversation.lastMessageAt?.getTime() === newestTelegramDate * 1000 &&
        orderedConversation.lead?.lastMessageAt?.getTime() === newestTelegramDate * 1000,
      "A delayed Telegram update moved conversation or lead recency backward.",
    );
    const orderedInbox = await conversations.list(context, { page: 1, limit: 50 });
    assert(
      orderedInbox.data.find((item) => item.id === conversation.id)?.lastMessage ===
        "Newest ordered Telegram message",
      "A delayed Telegram update replaced the Inbox preview with older content.",
    );

    const concurrentDates = [150, 210, 180, 165].map(
      (offset) => privateUpdate.message.date + offset,
    );
    await Promise.all(
      concurrentDates.map((date, index) =>
        telegramService.handleWebhook(
          channel.publicKey!,
          {
            ...privateUpdate,
            update_id: privateUpdate.update_id + 30 + index,
            message: {
              ...privateUpdate.message,
              message_id: 30 + index,
              date,
              text: `Concurrent Telegram message ${date}`,
            },
          },
          { "x-telegram-bot-api-secret-token": webhookSecret },
          "TELEGRAM_WEBHOOK",
        ),
      ),
    );
    const concurrentMaxDate = Math.max(...concurrentDates);
    const concurrentConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { lead: true },
    });
    assert(
      concurrentConversation.lastMessageAt?.getTime() === concurrentMaxDate * 1000 &&
        concurrentConversation.lead?.lastMessageAt?.getTime() === concurrentMaxDate * 1000,
      "Concurrent Telegram updates did not preserve the greatest activity timestamp.",
    );

    const sameSecondDate = concurrentMaxDate + 60;
    const sameSecondResults = [];
    for (const [index, text] of ["Same-second Telegram A", "Same-second Telegram B"].entries()) {
      sameSecondResults.push(
        await telegramService.handleWebhook(
          channel.publicKey!,
          {
            ...privateUpdate,
            update_id: privateUpdate.update_id + 40 + index,
            message: {
              ...privateUpdate.message,
              message_id: 40 + index,
              date: sameSecondDate,
              text,
            },
          },
          { "x-telegram-bot-api-secret-token": webhookSecret },
          "TELEGRAM_WEBHOOK",
        ),
      );
    }
    const sameSecondMessages = await prisma.message.findMany({
      where: {
        id: {
          in: sameSecondResults
            .map((result) => result.inboundMessageId)
            .filter((id): id is string => id !== null),
        },
      },
      orderBy: { id: "desc" },
      select: { id: true, text: true },
    });
    const sameSecondConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { lead: true },
    });
    const sameSecondInbox = await conversations.list(context, { page: 1, limit: 50 });
    assert(
      sameSecondMessages.length === 2 &&
        sameSecondConversation.lead?.interest === concurrentConversation.lead?.interest &&
        sameSecondInbox.data.find((item) => item.id === conversation.id)?.lastMessage ===
          sameSecondMessages[0]?.text,
      "Same-second Telegram ordering did not preserve classified interest and the canonical latest message.",
    );

    const queuedLeadEventsBeforeRejection = await prisma.leadEvent.count({
      where: { tenantId: tenant.id, type: "telegram_ai_reply_queued" },
    });
    const fallbackEnqueuesBeforeRejection = enqueuedJobs.length;
    rejectNextQueueAdmission = true;
    const rejectedQueueUpdateId = privateUpdate.update_id + 50;
    const rejectedQueue = await telegramService.handleWebhook(
      channel.publicKey!,
      {
        ...privateUpdate,
        update_id: rejectedQueueUpdateId,
        message: {
          ...privateUpdate.message,
          message_id: 50,
          date: sameSecondDate + 60,
          text: "Queue admission rejection",
        },
      },
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    const rejectedQueueEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: `telegram:${channel.id}`,
          externalEventId: `telegram:bot:987654321:update:${rejectedQueueUpdateId}`,
        },
      },
    });
    assert(
      rejectedQueue.outboundStatus === "skipped" &&
        rejectedQueueEvent.aiDispatchCompletedAt !== null &&
        enqueuedJobs.length === fallbackEnqueuesBeforeRejection &&
        (await prisma.leadEvent.count({
          where: { tenantId: tenant.id, type: "telegram_ai_reply_queued" },
        })) === queuedLeadEventsBeforeRejection,
      "Rejected Telegram AI admission was reported or retried as queued work.",
    );

    const tested = await integrations.testConnection(context, "TELEGRAM");
    assert(tested.ok, "Managed Telegram connection check failed.");

    const sample = await integrations.sendSampleInbound(context, "TELEGRAM");
    assert(sample.inboundMessageId !== null, "Internal Telegram sample did not create a message.");
    assert(
      (await prisma.authenticatedCustomerIdentity.count({
        where: { tenantId: tenant.id, messageId: sample.inboundMessageId },
      })) === 0,
      "Internal Telegram sample minted an authenticated customer identity.",
    );
    assert(
      !enqueuedJobs.find((job) => job.triggerMessageId === sample.inboundMessageId)
        ?.customerIdentity,
      "Internal Telegram sample queued a customer identity reference.",
    );

    const nonPersonalUpdates = [
      {
        label: "group",
        body: {
          update_id: privateUpdate.update_id + 100,
          message: {
            message_id: 119,
            date: privateUpdate.message.date,
            chat: { id: -8_173_697_574, type: "group", title: "Group Client" },
            from: { id: 8_173_697_475, is_bot: false, first_name: "Group Sender" },
            text: "Group question",
          },
        },
      },
      {
        label: "supergroup",
        body: {
          update_id: privateUpdate.update_id + 101,
          message: {
            message_id: 120,
            date: privateUpdate.message.date,
            chat: { id: -8_173_697_575, type: "supergroup", title: "Supergroup Client" },
            from: { id: 8_173_697_476, is_bot: false, first_name: "Supergroup Sender" },
            text: "Supergroup question",
          },
        },
      },
      {
        label: "malformed private sender",
        body: {
          update_id: privateUpdate.update_id + 102,
          message: {
            message_id: 121,
            date: privateUpdate.message.date,
            chat: { id: 8_173_697_577, type: "private", first_name: "Malformed Client" },
            from: { id: "8173697577", is_bot: false, first_name: "Malformed Client" },
            text: "Malformed sender question",
          },
        },
      },
    ];
    const nonPersonalMessageIds: string[] = [];
    for (const entry of nonPersonalUpdates) {
      const result = await telegramService.handleWebhook(
        channel.publicKey!,
        entry.body,
        { "x-telegram-bot-api-secret-token": webhookSecret },
        "TELEGRAM_WEBHOOK",
      );
      assert(result.inboundMessageId !== null, `${entry.label} Telegram update was not persisted.`);
      nonPersonalMessageIds.push(result.inboundMessageId);
      assert(
        !enqueuedJobs.find((job) => job.triggerMessageId === result.inboundMessageId)
          ?.customerIdentity,
        `${entry.label} Telegram update queued a customer identity reference.`,
      );
    }
    assert(
      (await prisma.authenticatedCustomerIdentity.count({
        where: { tenantId: tenant.id, messageId: { in: nonPersonalMessageIds } },
      })) === 0,
      "Group, supergroup, or malformed Telegram sender minted a customer identity.",
    );

    const legacyWebhookSecret = `legacy-${webhookSecret}`;
    const legacyChannel = await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        type: "TELEGRAM",
        status: "ACTIVE",
        name: "Legacy Telegram channel",
        publicKey: `legacy-telegram-${suffix}`,
        settings: { telegram: { webhookSecret: legacyWebhookSecret } },
      },
    });
    let legacyInboundRejected = false;
    try {
      await telegramService.handleWebhook(
        legacyChannel.publicKey!,
        {
          update_id: privateUpdate.update_id + 103,
          message: {
            message_id: 122,
            date: privateUpdate.message.date,
            chat: { id: 8_173_697_578, type: "private", first_name: "Legacy Client" },
            from: { id: 8_173_697_578, is_bot: false, first_name: "Legacy Client" },
            text: "Legacy channel question",
          },
        },
        { "x-telegram-bot-api-secret-token": legacyWebhookSecret },
        "TELEGRAM_WEBHOOK",
      );
    } catch (error) {
      legacyInboundRejected =
        error instanceof Error && error.message.includes("identity is not ready");
    }
    assert(legacyInboundRejected, "Telegram channel without a bot identity did not fail closed.");
    await prisma.channel.update({
      where: { id: legacyChannel.id },
      data: { status: "DISABLED", deletedAt: new Date() },
    });

    const missingSecretSettings = JSON.parse(JSON.stringify(channel.settings)) as {
      telegram: Record<string, unknown>;
    };
    delete missingSecretSettings.telegram.webhookSecret;
    await prisma.channel.update({
      where: { id: channel.id },
      data: { settings: missingSecretSettings },
    });
    let missingSecretRejected = false;
    try {
      await telegramService.handleWebhook(
        channel.publicKey!,
        { ...privateUpdate, update_id: privateUpdate.update_id + 1 },
        {},
        "TELEGRAM_WEBHOOK",
      );
    } catch {
      missingSecretRejected = true;
    }
    assert(missingSecretRejected, "Telegram inbound without a managed secret did not fail closed.");
    pendingUpdates = 1;
    lastDeliveryError = true;
    requirePersistedSecretOnNextSet = true;
    const repairsBeforeMissingSecret = setWebhookCalls;
    const repairedMissingSecret = await integrations.testConnection(context, "TELEGRAM");
    assert(
      !repairedMissingSecret.ok,
      "Telegram health reported ready before the pending repair backlog drained.",
    );
    assert(
      setWebhookCalls === repairsBeforeMissingSecret + 1,
      "Missing Telegram webhook secret did not trigger exactly one repair.",
    );
    const repairedChannel = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    assert(
      JSON.stringify(repairedChannel.settings).includes(webhookSecret),
      "Repaired Telegram webhook secret was not persisted.",
    );
    const repairedInbound = await telegramService.handleWebhook(
      channel.publicKey!,
      {
        ...privateUpdate,
        update_id: privateUpdate.update_id + 1,
        message: { ...privateUpdate.message, message_id: 20 },
      },
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    assert(
      repairedInbound.inboundMessageId !== null,
      "A pending Telegram update could not use the durably repaired secret.",
    );
    pendingUpdates = 0;
    lastDeliveryError = false;
    const recoveredMissingSecret = await integrations.testConnection(context, "TELEGRAM");
    assert(recoveredMissingSecret.ok, "Telegram health did not recover after the backlog drained.");

    const repairsBeforeMismatch = setWebhookCalls;
    reportedWebhookUrl = "https://stale-webhook.invalid/telegram";
    const repairedMismatch = await integrations.testConnection(context, "TELEGRAM");
    assert(repairedMismatch.ok, "Stale Telegram webhook URL was not repaired automatically.");
    assert(
      setWebhookCalls === repairsBeforeMismatch + 1,
      "Stale Telegram webhook URL did not trigger exactly one repair.",
    );

    const repairsBeforeAllowedUpdateDrift = setWebhookCalls;
    reportedAllowedUpdates = ["callback_query"];
    const repairedAllowedUpdates = await integrations.testConnection(context, "TELEGRAM");
    assert(
      repairedAllowedUpdates.ok,
      "Drifted Telegram allowed_updates were not repaired automatically.",
    );
    assert(
      setWebhookCalls === repairsBeforeAllowedUpdateDrift + 1,
      "Drifted Telegram allowed_updates did not trigger exactly one repair.",
    );

    const repairsBeforeDeliveryError = setWebhookCalls;
    pendingUpdates = 4;
    lastDeliveryError = true;
    clearDeliveryFailureOnSet = true;
    const repairedDelivery = await integrations.testConnection(context, "TELEGRAM");
    assert(repairedDelivery.ok, "Telegram delivery failure was not repaired automatically.");
    assert(
      setWebhookCalls === repairsBeforeDeliveryError + 1,
      "Telegram delivery failure did not trigger exactly one repair.",
    );

    pendingUpdates = 2;
    const repairsBeforeBacklog = setWebhookCalls;
    const pendingHealth = await integrations.testConnection(context, "TELEGRAM");
    assert(!pendingHealth.ok, "Pending Telegram updates were reported as ready.");
    assert(
      setWebhookCalls === repairsBeforeBacklog,
      "A pending Telegram backlog without a delivery error triggered an unsafe repair.",
    );
    pendingUpdates = 0;

    reportedWebhookUrl = "https://unreachable-webhook.invalid/telegram";
    failNextSetWebhook = true;
    const failedRepair = await integrations.testConnection(context, "TELEGRAM");
    assert(!failedRepair.ok, "Failed Telegram webhook repair was reported as successful.");
    assert(
      !failedRepair.message.includes(botToken) && !failedRepair.message.includes(webhookSecret),
      "Failed Telegram health response leaked credentials.",
    );
    reportedWebhookUrl = null;

    await integrations.connect(context, "TELEGRAM", {});
    assert(webhookUrl.length > 0, "Token-free reconnect did not reuse stored credentials.");

    const firstSecret = webhookSecret;
    const credentialsBeforeReplacement = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
      select: { encryptedCredentials: true },
    });
    if (!credentialsBeforeReplacement.encryptedCredentials) {
      throw new Error("Telegram credentials disappeared before replacement.");
    }
    const previousPendingSecret = `pending_${randomUUID().replaceAll("-", "")}`;
    await channels.stageTelegramWebhookSecret(context, {
      channelId: channel.id,
      candidateSecret: previousPendingSecret,
      candidateBotId: channel.externalId!,
      expectedEncryptedCredentials: credentialsBeforeReplacement.encryptedCredentials,
    });
    const beforeFailedReplacement = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    const deletesBeforeFailedReplacement = deleteCalls;
    requirePersistedSecretOnNextSet = true;
    expectedPreviousSecretOnNextSet = firstSecret;
    failNextSetWebhook = true;
    let replacementFailed = false;
    try {
      await integrations.connect(context, "TELEGRAM", { botToken: replacementToken });
    } catch {
      replacementFailed = true;
    }
    assert(replacementFailed, "Arranged Telegram bot replacement failure did not fail.");
    const afterFailedReplacement = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    assert(
      JSON.stringify(afterFailedReplacement.settings) ===
        JSON.stringify(beforeFailedReplacement.settings),
      "Failed Telegram bot replacement changed the active webhook secret.",
    );
    assert(
      afterFailedReplacement.encryptedCredentials === beforeFailedReplacement.encryptedCredentials,
      "Failed Telegram bot replacement changed the active credentials.",
    );
    assert(
      deleteCalls === deletesBeforeFailedReplacement + 1,
      "Failed Telegram bot replacement did not clean up the candidate webhook.",
    );

    const deletesBeforeReplacement = deleteCalls;
    requirePersistedSecretOnNextSet = true;
    expectedPreviousSecretOnNextSet = firstSecret;
    retiredPendingUpdates = 1;
    failDeleteWebhookForToken = botToken;
    const replaced = await integrations.connect(context, "TELEGRAM", {
      botToken: replacementToken,
    });
    assert(replaced.name.includes("@replacement_magic_bot"), "Replacement bot was not connected.");
    assert(webhookSecret !== firstSecret, "Replacing a bot reused the retired webhook secret.");
    assert(
      deleteCalls === deletesBeforeReplacement + 1 && deleteDropPending.at(-1) === true,
      "Replacing a bot did not force retirement of the previous webhook.",
    );
    const replacedSettings = replaced.settings as Record<string, unknown>;
    assert(
      replacedSettings.previousBotCleanupPending === true,
      "Failed previous-bot cleanup was not visible on the integration.",
    );
    const cleanupPendingChannel = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    const cleanupPendingTelegram = (cleanupPendingChannel.settings as Record<string, unknown>)
      .telegram as Record<string, unknown>;
    const retiredBotCredentials = cleanupPendingTelegram.retiredBotEncryptedCredentials;
    assert(
      typeof retiredBotCredentials === "string",
      "Failed previous-bot cleanup was not persisted durably.",
    );
    assert(
      decryptIntegrationCredentials(retiredBotCredentials).botToken === botToken,
      "Durable previous-bot cleanup credentials did not identify the retired bot.",
    );
    assert(
      cleanupPendingTelegram.retiredBotWebhookSecret === firstSecret &&
        cleanupPendingTelegram.retiredBotId === "987654321",
      "Durable previous-bot cleanup state lost the retired webhook identity.",
    );
    assert(
      !JSON.stringify(await channels.list(context)).includes(retiredBotCredentials) &&
        !JSON.stringify(await channels.list(context)).includes(firstSecret),
      "Channel response leaked retired-bot cleanup state.",
    );

    const eventsBeforeOldSecret = await prisma.webhookEvent.count({
      where: { tenantId: tenant.id },
    });
    let oldSecretRejected = false;
    try {
      await telegramService.handleWebhook(
        channel.publicKey!,
        privateUpdate,
        { "x-telegram-bot-api-secret-token": firstSecret },
        "TELEGRAM_WEBHOOK",
      );
    } catch (error) {
      oldSecretRejected = error instanceof Error && error.message.includes("secret is invalid");
    }
    assert(
      oldSecretRejected &&
        (await prisma.webhookEvent.count({ where: { tenantId: tenant.id } })) ===
          eventsBeforeOldSecret,
      "Retired Telegram secret crossed the inbound persistence boundary.",
    );
    const replacementInbound = await telegramService.handleWebhook(
      channel.publicKey!,
      privateUpdate,
      { "x-telegram-bot-api-secret-token": webhookSecret },
      "TELEGRAM_WEBHOOK",
    );
    assert(
      replacementInbound.inboundMessageId !== null &&
        replacementInbound.inboundMessageId !== inbound.inboundMessageId,
      "Equal raw Telegram ids from distinct bots were incorrectly deduplicated.",
    );
    assert(
      (await prisma.message.count({
        where: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          externalMessageId: {
            in: ["telegram:bot:987654321:message:19", "telegram:bot:987654322:message:19"],
          },
        },
      })) === 2,
      "Telegram message idempotency was not scoped by bot identity.",
    );

    retiredPendingUpdates = 1;
    retiredLastDeliveryError = true;
    failDeleteWebhookForToken = botToken;
    const deletesBeforeFailedCleanup = deleteCalls;
    const failedCleanup = await integrations.testConnection(context, "TELEGRAM");
    assert(!failedCleanup.ok, "Failed previous-bot cleanup was reported as ready.");
    assert(
      deleteCalls === deletesBeforeFailedCleanup + 1,
      "Telegram health did not attempt previous-bot cleanup exactly once.",
    );
    assert(
      (failedCleanup.integration.settings as Record<string, unknown>).previousBotCleanupPending ===
        true,
      "Failed previous-bot cleanup was not retained for retry.",
    );

    const deletesBeforeCleanupRecovery = deleteCalls;
    const repairsBeforeCleanupRecovery = setWebhookCalls;
    const recoveredCleanup = await integrations.testConnection(context, "TELEGRAM");
    assert(recoveredCleanup.ok, "Telegram health did not recover previous-bot cleanup.");
    assert(
      deleteCalls === deletesBeforeCleanupRecovery + 1,
      "Telegram health did not retry previous-bot cleanup exactly once.",
    );
    assert(
      deleteDropPending.at(-1) === true && retiredPendingUpdates === 0,
      "Telegram health did not drop retired-bot pending updates during cleanup.",
    );
    assert(
      setWebhookCalls === repairsBeforeCleanupRecovery,
      "Retired-bot cleanup unexpectedly rewrote the active webhook.",
    );
    assert(
      (recoveredCleanup.integration.settings as Record<string, unknown>)
        .previousBotCleanupPending === false,
      "Recovered previous-bot cleanup remained visible as pending.",
    );
    const cleanupRecoveredChannel = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
    });
    const cleanupRecoveredTelegram = (cleanupRecoveredChannel.settings as Record<string, unknown>)
      .telegram as Record<string, unknown>;
    assert(
      cleanupRecoveredTelegram.retiredBotEncryptedCredentials === undefined &&
        cleanupRecoveredTelegram.retiredBotWebhookSecret === undefined &&
        cleanupRecoveredTelegram.retiredBotId === undefined,
      "Recovered previous-bot cleanup state was not cleared atomically.",
    );
    retiredLastDeliveryError = false;

    pendingUpdates = 1;
    const deletesBeforePendingDisconnect = deleteCalls;
    let pendingDisconnectFailed = false;
    try {
      await integrations.disconnect(context, "TELEGRAM");
    } catch {
      pendingDisconnectFailed = true;
    }
    assert(
      pendingDisconnectFailed,
      "Telegram disconnected while active webhook updates were still queued.",
    );
    assert(
      deleteCalls === deletesBeforePendingDisconnect,
      "Telegram deleted the active webhook before queued updates drained.",
    );
    pendingUpdates = 0;

    const deletesBeforeDisconnect = deleteCalls;
    const disconnected = await integrations.disconnect(context, "TELEGRAM");
    assert(disconnected.status === "DISCONNECTED", "Telegram integration was not disconnected.");
    assert(
      deleteCalls === deletesBeforeDisconnect + 1,
      "Telegram deleteWebhook lifecycle calls were incomplete.",
    );
    const disabledChannel = await prisma.channel.findUnique({ where: { id: channel.id } });
    assert(disabledChannel?.status === "DISABLED", "Telegram channel was not disabled.");

    const raceTenants = await Promise.all(
      ["a", "b"].map(async (label) => {
        const raceTenant = await prisma.tenant.create({
          data: {
            name: `Telegram connection race ${label}`,
            slug: `telegram-race-${label}-${suffix}`,
            timezone: "Europe/Paris",
          },
        });
        const raceUser = await prisma.user.create({
          data: {
            email: `telegram-race-${label}-${suffix}@leadvirt.ai`,
            name: `Telegram Race ${label}`,
          },
        });
        await prisma.membership.create({
          data: { tenantId: raceTenant.id, userId: raceUser.id, role: "OWNER" },
        });
        return {
          context: contextFor(raceTenant, raceUser.id),
          tenantId: raceTenant.id,
          userId: raceUser.id,
        };
      }),
    );
    try {
      const setWebhookBeforeRace = setWebhookCalls;
      const raceResults = await Promise.allSettled(
        raceTenants.map((entry) =>
          integrations.connect(entry.context, "TELEGRAM", { botToken: raceToken }),
        ),
      );
      const raceWinners = raceResults
        .map((result, index) => ({ result, index }))
        .filter((entry) => entry.result.status === "fulfilled");
      assert(raceWinners.length === 1, "Concurrent workspaces both claimed the same Telegram bot.");
      assert(
        setWebhookCalls === setWebhookBeforeRace + 1,
        "A rejected concurrent workspace replaced the winning Telegram webhook.",
      );
      assert(
        (await prisma.channel.count({
          where: {
            type: "TELEGRAM",
            externalId: "987654323",
            status: "ACTIVE",
            deletedAt: null,
          },
        })) === 1,
        "Concurrent Telegram connection left ambiguous active bot ownership.",
      );
      await integrations.disconnect(raceTenants[raceWinners[0]!.index]!.context, "TELEGRAM");
    } finally {
      for (const entry of raceTenants) {
        await prisma.tenant.delete({ where: { id: entry.tenantId } }).catch(() => undefined);
        await prisma.user.delete({ where: { id: entry.userId } }).catch(() => undefined);
      }
    }

    const cascadeWebhookEventIds = (
      await prisma.webhookEvent.findMany({
        where: { tenantId: tenant.id },
        select: { id: true },
      })
    ).map((event) => event.id);
    await prisma.tenant.delete({ where: { id: tenant.id } });
    tenantId = null;
    assert(
      (await prisma.authenticatedCustomerIdentity.findUnique({
        where: { id: privateIdentity.id },
      })) === null,
      "Tenant cascade did not remove the authenticated Telegram identity.",
    );
    await prisma.webhookEvent.deleteMany({ where: { id: { in: cascadeWebhookEventIds } } });

    console.log(`Telegram managed connection smoke: ${checks}/${checks} checks passed`);
  } finally {
    if (tenantId) {
      const webhookEventIds = await prisma.webhookEvent
        .findMany({ where: { tenantId }, select: { id: true } })
        .then((events) => events.map((event) => event.id))
        .catch(() => []);
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      if (webhookEventIds.length > 0) {
        await prisma.webhookEvent
          .deleteMany({ where: { id: { in: webhookEventIds } } })
          .catch(() => undefined);
      }
    }
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main();
