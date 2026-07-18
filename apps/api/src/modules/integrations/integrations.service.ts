import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from "@nestjs/common";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  type TelegramWebhookInfo,
} from "@leadvirt/integrations";
import type {
  ChannelType,
  IntegrationAccount,
  IntegrationInboundEndpoint,
  IntegrationSampleDeliveryResult,
  IntegrationTestResult,
  IntegrationWebhookEventSummary,
} from "@leadvirt/types";
import { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import {
  type TelegramBotLifecycleLock,
  withTelegramLifecycleLock,
} from "../../common/telegram-lifecycle-lock.js";
import { ChannelsService, type TelegramWebhookSecretStage } from "../channels/channels.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TelegramBotApiService } from "../telegram/telegram-bot-api.service.js";
import { TelegramService } from "../telegram/telegram.service.js";
import { WebhookService } from "../webhook/webhook.service.js";
import type { ConnectIntegrationDto } from "./dto/connect-integration.dto.js";
import type { UpdateIntegrationSettingsDto } from "./dto/update-integration-settings.dto.js";
import {
  mergeIntegrationAccountCredentials,
  partitionIntegrationAccountSettings,
} from "./integration-account-credentials.js";

const providers = [
  "AMOCRM",
  "BITRIX24",
  "RETAILCRM",
  "TELEGRAM",
  "WHATSAPP_BUSINESS",
  "INSTAGRAM",
  "VK",
  "EMAIL",
  "GOOGLE_CALENDAR",
  "SHOPIFY",
  "SHOP_SCRIPT",
  "WEBHOOK_API",
  "OTHER",
] as const;

type ProviderParam = (typeof providers)[number];
type CrmProvider = "AMOCRM" | "BITRIX24" | "RETAILCRM";
type InboundChannelProjection = {
  id: string;
  type: ChannelType;
  publicKey: string | null;
  settings: Prisma.JsonValue | null;
  encryptedCredentials: string | null;
  createdAt: Date;
};
type UnavailableProvider = Exclude<ProviderParam, "TELEGRAM" | "WEBHOOK_API">;
type UnavailableCapability =
  | "CRM"
  | "SOCIAL_CHANNEL"
  | "EMAIL_CHANNEL"
  | "CALENDAR"
  | "ECOMMERCE"
  | "CUSTOM";
const telegramAllowedUpdates = ["message", "edited_message"];

const providerCatalog: Record<
  ProviderParam,
  { name: string; category: string; settings: Prisma.InputJsonObject }
> = {
  AMOCRM: { name: "amoCRM", category: "CRM", settings: { syncDirection: "two-way" } },
  BITRIX24: { name: "Bitrix24", category: "CRM", settings: { syncDirection: "two-way" } },
  RETAILCRM: { name: "RetailCRM", category: "CRM", settings: { syncDirection: "two-way" } },
  TELEGRAM: { name: "Telegram", category: "Канал", settings: { syncDirection: "inbound" } },
  WHATSAPP_BUSINESS: {
    name: "WhatsApp Business",
    category: "Канал",
    settings: { syncDirection: "inbound" },
  },
  INSTAGRAM: { name: "Instagram", category: "Канал", settings: { syncDirection: "inbound" } },
  VK: { name: "VK", category: "Канал", settings: { syncDirection: "inbound" } },
  EMAIL: { name: "Email", category: "Канал", settings: { syncDirection: "inbound" } },
  GOOGLE_CALENDAR: {
    name: "Google Calendar",
    category: "Календарь",
    settings: { syncDirection: "two-way" },
  },
  SHOPIFY: { name: "Shopify", category: "E-commerce", settings: { syncDirection: "two-way" } },
  SHOP_SCRIPT: {
    name: "Shop-Script",
    category: "E-commerce",
    settings: { syncDirection: "two-way" },
  },
  WEBHOOK_API: {
    name: "Webhook/API",
    category: "Разработчикам",
    settings: { syncDirection: "inbound" },
  },
  OTHER: { name: "Other integration", category: "Other", settings: { syncDirection: "manual" } },
};

const selfServeConnectProviders = new Set<ProviderParam>(["TELEGRAM", "WEBHOOK_API"]);

const unavailableProviderCapabilities: Readonly<
  Record<UnavailableProvider, UnavailableCapability>
> = {
  AMOCRM: "CRM",
  BITRIX24: "CRM",
  RETAILCRM: "CRM",
  WHATSAPP_BUSINESS: "SOCIAL_CHANNEL",
  INSTAGRAM: "SOCIAL_CHANNEL",
  VK: "SOCIAL_CHANNEL",
  EMAIL: "EMAIL_CHANNEL",
  GOOGLE_CALENDAR: "CALENDAR",
  SHOPIFY: "ECOMMERCE",
  SHOP_SCRIPT: "ECOMMERCE",
  OTHER: "CUSTOM",
};

function isUnavailableProvider(provider: string): provider is UnavailableProvider {
  return provider in unavailableProviderCapabilities;
}

function integrationUnavailable(provider: UnavailableProvider) {
  const name = providerCatalog[provider].name;
  return new NotImplementedException({
    code: "INTEGRATION_NOT_AVAILABLE",
    message: `${name} is not available because LeadVirt does not have a live provider implementation yet.`,
    retryable: false,
    details: {
      capability: unavailableProviderCapabilities[provider],
      provider,
    },
  });
}

function crmSyncUnavailable() {
  return new NotImplementedException({
    code: "INTEGRATION_NOT_AVAILABLE",
    message:
      "CRM lead sync is not available because LeadVirt does not have a live provider implementation yet.",
    retryable: false,
    details: { capability: "CRM" },
  });
}

function rejectUnavailableProvider(provider: ProviderParam) {
  if (isUnavailableProvider(provider)) throw integrationUnavailable(provider);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
}

type LeadForCrmSync = Prisma.LeadGetPayload<{
  include: {
    conversations: {
      include: {
        channel: true;
        messages: { orderBy: { createdAt: "desc" }; take: 3 };
      };
      orderBy: { lastMessageAt: "desc" };
      take: 3;
    };
  };
}>;

export interface CrmLeadSyncResult {
  provider: CrmProvider;
  integrationId: string;
  syncLogId: string;
  externalId: string;
  url: string | null;
  syncedAt: Date;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChannelsService) private readonly channelsService: ChannelsService,
    @Inject(TelegramBotApiService) private readonly telegramBotApi: TelegramBotApiService,
    @Inject(TelegramService) private readonly telegramService: TelegramService,
    @Inject(WebhookService) private readonly webhookService: WebhookService,
  ) {}

  async list(context: RequestContext): Promise<IntegrationAccount[]> {
    const [integrations, channels] = await Promise.all([
      this.prisma.integrationAccount.findMany({
        where: { tenantId: context.tenantId, deletedAt: null },
        include: {
          syncLogs: {
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true, action: true, status: true, message: true, createdAt: true },
          },
        },
        orderBy: [{ status: "asc" }, { name: "asc" }],
      }),
      this.prisma.channel.findMany({
        where: {
          tenantId: context.tenantId,
          deletedAt: null,
          status: "ACTIVE",
          type: { in: ["TELEGRAM", "WEBHOOK"] },
        },
        select: {
          id: true,
          type: true,
          publicKey: true,
          settings: true,
          encryptedCredentials: true,
          createdAt: true,
        },
      }),
    ]);
    const webhookProviders = [
      ...new Set(channels.flatMap((channel) => this.webhookProvidersForChannel(channel))),
    ];
    const webhookEvents =
      webhookProviders.length > 0
        ? await this.prisma.webhookEvent.findMany({
            where: {
              tenantId: context.tenantId,
              provider: { in: webhookProviders },
            },
            orderBy: { receivedAt: "desc" },
            take: Math.max(12, webhookProviders.length * 3),
            select: {
              id: true,
              provider: true,
              externalEventId: true,
              status: true,
              errorMessage: true,
              receivedAt: true,
              processedAt: true,
            },
          })
        : [];

    return integrations.map((integration) => {
      const unavailable = isUnavailableProvider(integration.provider);
      const channelBacked =
        integration.provider === "TELEGRAM" || integration.provider === "WEBHOOK_API";
      const operationalChannel = this.operationalChannelForProvider(integration.provider, channels);
      const channelConnected = operationalChannel !== null;
      return {
        id: integration.id,
        tenantId: integration.tenantId,
        provider: integration.provider,
        status: unavailable
          ? "COMING_SOON"
          : channelBacked
            ? channelConnected
              ? "CONNECTED"
              : "DISCONNECTED"
            : integration.status,
        name: integration.name,
        category: integration.category,
        settings: this.integrationSettings(
          integration.provider,
          integration.settings,
          integration.encryptedCredentials,
        ),
        connectedAt: unavailable
          ? null
          : channelBacked
            ? (operationalChannel?.createdAt.toISOString() ?? null)
            : (integration.connectedAt?.toISOString() ?? null),
        lastSyncAt: unavailable ? null : (integration.lastSyncAt?.toISOString() ?? null),
        inboundEndpoint: channelConnected
          ? this.inboundEndpointForProvider(integration.provider, channels)
          : null,
        recentWebhookEvents: this.webhookEventsForProvider(
          integration.provider,
          channels,
          webhookEvents,
        ),
        recentSyncLogs: unavailable
          ? []
          : integration.syncLogs.map((log) => ({
              id: log.id,
              action: log.action,
              status: log.status,
              message: log.message,
              createdAt: log.createdAt.toISOString(),
            })),
      };
    });
  }

  async connect(
    context: RequestContext,
    provider: string,
    dto: ConnectIntegrationDto = {},
  ): Promise<IntegrationAccount> {
    const parsedProvider = this.parseProvider(provider);
    rejectUnavailableProvider(parsedProvider);
    if (!selfServeConnectProviders.has(parsedProvider)) {
      throw new BadRequestException(
        "This integration is not available for self-service connection in the pilot.",
      );
    }
    if (parsedProvider === "TELEGRAM") return this.connectTelegram(context, dto.botToken);

    const channel = await this.loadInboundChannel(context.tenantId, "WEBHOOK");
    const integration = await this.loadOrCreateByProvider(context.tenantId, parsedProvider);
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: { status: "CONNECTED", connectedAt: channel.createdAt, lastSyncAt: new Date() },
    });
    await this.logSync(
      context.tenantId,
      updated.id,
      "connect",
      "SUCCESS",
      `${updated.name} linked to the active Webhook/API channel.`,
    );
    await this.logAudit(context, "integration.connected", updated.id, {
      provider: updated.provider,
    });
    return (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated);
  }

  async disconnect(context: RequestContext, provider: string): Promise<IntegrationAccount> {
    const parsedProvider = this.parseProvider(provider);
    rejectUnavailableProvider(parsedProvider);
    if (parsedProvider === "TELEGRAM") {
      return this.withTelegramLifecycleLock(context.tenantId, (lockBotIdentities) =>
        this.disconnectTelegram(context, lockBotIdentities),
      );
    }
    const integration = await this.loadByProvider(context.tenantId, parsedProvider);
    if (integration.provider === "WEBHOOK_API") {
      const channel = await this.prisma.channel.findFirst({
        where: { tenantId: context.tenantId, type: "WEBHOOK", deletedAt: null },
        select: { id: true, status: true },
      });
      if (channel && channel.status !== "DISABLED") {
        await this.channelsService.update(context, channel.id, { status: "DISABLED" });
      }
    }
    return this.markIntegrationDisconnected(context, integration);
  }

  private async disconnectTelegram(
    context: RequestContext,
    lockBotIdentities: TelegramBotLifecycleLock,
  ): Promise<IntegrationAccount> {
    const integration = await this.loadByProvider(context.tenantId, "TELEGRAM");
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null },
      select: {
        id: true,
        publicKey: true,
        externalId: true,
        encryptedCredentials: true,
        settings: true,
      },
    });
    const botToken = this.telegramBotToken(channel?.encryptedCredentials);
    const retiredBotCredentials = this.telegramRetiredBotCredentials(channel?.settings);
    const retiredBotToken = this.telegramBotToken(retiredBotCredentials);
    await lockBotIdentities([
      channel?.externalId,
      this.telegramBotIdFromToken(botToken),
      this.telegramBotIdFromToken(retiredBotToken),
    ]);

    const retiredBotCleaned =
      !channel || !retiredBotCredentials
        ? true
        : await this.cleanupTelegramRetiredBot(context, {
            channelId: channel.id,
            retiredEncryptedCredentials: retiredBotCredentials,
            expectedEncryptedCredentials: channel.encryptedCredentials,
          });
    let activeBotCleaned = true;
    if (botToken) {
      try {
        const secrets = this.telegramWebhookSecrets(channel?.settings ?? null);
        const webhookSecret = secrets.pending ?? secrets.active;
        activeBotCleaned = Boolean(
          channel?.publicKey &&
          webhookSecret &&
          (await this.removeTelegramWebhookWhenDrained({
            botToken,
            restoreUrl: this.telegramWebhookUrl(channel.publicKey),
            restoreSecret: webhookSecret,
          })),
        );
      } catch {
        activeBotCleaned = false;
      }
    }
    if (!retiredBotCleaned || !activeBotCleaned) {
      const message =
        "Telegram is still connected because webhook cleanup is pending. Try disconnecting again.";
      await this.prisma.integrationAccount.update({
        where: { id: integration.id },
        data: {
          settings: {
            ...asRecord(integration.settings),
            previousBotCleanupPending: !retiredBotCleaned,
          },
        },
      });
      await this.logSync(context.tenantId, integration.id, "disconnect", "FAILED", message);
      await this.logAudit(context, "integration.disconnect_failed", integration.id, {
        provider: "TELEGRAM",
        retiredBotCleanupPending: !retiredBotCleaned,
        activeBotCleanupPending: !activeBotCleaned,
      });
      throw new BadRequestException(message);
    }
    await this.channelsService.disableTelegramChannel(context);
    return this.markIntegrationDisconnected(context, integration);
  }

  private async markIntegrationDisconnected(
    context: RequestContext,
    integration: Awaited<ReturnType<IntegrationsService["loadByProvider"]>>,
  ) {
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: {
        status: "DISCONNECTED",
        connectedAt: null,
        ...(integration.provider === "TELEGRAM"
          ? {
              settings: {
                ...asRecord(integration.settings),
                previousBotCleanupPending: false,
              },
            }
          : {}),
      },
    });
    await this.logSync(
      context.tenantId,
      updated.id,
      "disconnect",
      "SUCCESS",
      `${updated.name} отключено в демо-режиме.`,
    );
    await this.logAudit(context, "integration.disconnected", updated.id, {
      provider: updated.provider,
    });
    return (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated);
  }

  async updateSettings(
    context: RequestContext,
    provider: string,
    dto: UpdateIntegrationSettingsDto,
  ): Promise<IntegrationAccount> {
    const parsedProvider = this.parseProvider(provider);
    rejectUnavailableProvider(parsedProvider);
    if (parsedProvider === "TELEGRAM") {
      throw new BadRequestException("Use the Telegram connect flow to update the bot safely.");
    }
    const integration = await this.loadByProvider(context.tenantId, parsedProvider);
    const stored = partitionIntegrationAccountSettings(
      parsedProvider,
      asRecord(integration.settings),
    );
    const incoming = partitionIntegrationAccountSettings(parsedProvider, dto.settings);
    const sanitizedSettings =
      parsedProvider === "WEBHOOK_API"
        ? await this.configureWebhookProvider(context, incoming.publicSettings)
        : incoming.publicSettings;
    const encryptedCredentials = mergeIntegrationAccountCredentials(
      integration.encryptedCredentials,
      stored.credentials,
      incoming.credentials,
    );
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: {
        settings: sanitizedSettings as Prisma.InputJsonObject,
        encryptedCredentials,
      },
    });
    await this.logAudit(context, "integration.settings_updated", updated.id, {
      provider: updated.provider,
    });
    return (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated);
  }

  async testConnection(context: RequestContext, provider: string): Promise<IntegrationTestResult> {
    const parsedProvider = this.parseProvider(provider);
    rejectUnavailableProvider(parsedProvider);
    if (parsedProvider === "TELEGRAM") return this.testTelegramConnection(context);
    const integration = await this.loadByProvider(context.tenantId, parsedProvider);
    const checkedAt = new Date();
    const channel = await this.loadInboundChannel(context.tenantId, "WEBHOOK").catch(() => null);
    const status = channel ? "SUCCESS" : "FAILED";
    const message = channel
      ? "Webhook/API inbound endpoint and secret are configured."
      : "Webhook/API channel is not fully configured and active.";
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: channel
        ? {
            status: "CONNECTED",
            connectedAt: channel.createdAt,
            lastSyncAt: checkedAt,
          }
        : { status: "DISCONNECTED", connectedAt: null },
    });

    const syncLog = await this.prisma.integrationSyncLog.create({
      data: {
        tenantId: context.tenantId,
        integrationId: integration.id,
        action: "test_connection",
        status,
        message,
        metadata: {
          provider: integration.provider,
          channelId: channel?.id ?? null,
        },
        createdAt: checkedAt,
      },
    });

    await this.logAudit(context, "integration.test_connection", integration.id, {
      provider: integration.provider,
      status,
      syncLogId: syncLog.id,
    });

    return {
      ok: status === "SUCCESS",
      provider: updated.provider,
      integrationId: updated.id,
      status,
      message,
      checkedAt: checkedAt.toISOString(),
      integration:
        (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated),
    };
  }

  async sendSampleInbound(
    context: RequestContext,
    provider: string,
  ): Promise<IntegrationSampleDeliveryResult> {
    const parsedProvider = this.parseProvider(provider);
    rejectUnavailableProvider(parsedProvider);
    const integration = await this.loadByProvider(context.tenantId, parsedProvider);

    if (parsedProvider === "TELEGRAM") {
      const channel = await this.loadInboundChannel(context.tenantId, "TELEGRAM");
      const id = Date.now();
      const result = await this.telegramService.handleWebhook(
        channel.publicKey!,
        {
          update_id: id,
          message: {
            message_id: id,
            date: Math.floor(id / 1000),
            chat: { id: id % 1_000_000_000, type: "private", username: "leadvirt_sample" },
            from: {
              id: id % 1_000_000_000,
              is_bot: false,
              first_name: "LeadVirt",
              last_name: "Sample",
              username: "leadvirt_sample",
            },
            text: "Тестовое входящее сообщение Telegram со страницы интеграций",
          },
        },
        this.sampleHeaders(channel, "TELEGRAM"),
        "INTERNAL_SAMPLE",
      );
      await this.logSync(
        context.tenantId,
        integration.id,
        "sample_inbound",
        "SUCCESS",
        `Тестовое входящее событие ${integration.name} обработано.`,
      );
      await this.logAudit(context, "integration.sample_inbound", integration.id, {
        provider: parsedProvider,
        conversationId: result.conversationId,
      });
      return this.sampleDeliveryResult(context, parsedProvider, integration.id, result);
    }

    if (parsedProvider === "WEBHOOK_API") {
      const channel = await this.loadInboundChannel(context.tenantId, "WEBHOOK");
      const id = Date.now();
      const result = await this.webhookService.handleEvent(
        channel.publicKey!,
        {
          eventId: `leadvirt-sample-${id}`,
          conversationId: `leadvirt-sample-thread-${id}`,
          source: "Страница интеграций LeadVirt.ai",
          customer: {
            id: `leadvirt-sample-customer-${id}`,
            name: "Тестовый лид LeadVirt",
            phone: "+1 555 0101",
            email: "sample.lead@leadvirt.ai",
          },
          message: {
            id: `leadvirt-sample-message-${id}`,
            text: "Тестовое входящее сообщение Webhook/API со страницы интеграций",
            timestamp: new Date(id).toISOString(),
          },
        },
        this.sampleHeaders(channel, "WEBHOOK"),
      );
      await this.logSync(
        context.tenantId,
        integration.id,
        "sample_inbound",
        "SUCCESS",
        `Тестовое входящее событие ${integration.name} обработано.`,
      );
      await this.logAudit(context, "integration.sample_inbound", integration.id, {
        provider: parsedProvider,
        conversationId: result.conversationId,
      });
      return this.sampleDeliveryResult(context, parsedProvider, integration.id, result);
    }

    throw new BadRequestException("Тестовый входящий трафик доступен для Telegram и Webhook/API.");
  }

  private async connectTelegram(context: RequestContext, submittedBotToken?: string) {
    return this.withTelegramLifecycleLock(context.tenantId, async (lockBotIdentities) => {
      const existingChannel = await this.prisma.channel.findFirst({
        where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null },
        select: { id: true, externalId: true, encryptedCredentials: true, settings: true },
      });
      const storedBotToken = this.telegramBotToken(existingChannel?.encryptedCredentials);
      const botToken = optionalString(submittedBotToken) ?? storedBotToken;
      if (!botToken) {
        throw new BadRequestException("Paste the bot token from BotFather to connect Telegram.");
      }

      let profile: Awaited<ReturnType<TelegramBotApiService["getMe"]>>;
      try {
        profile = await this.telegramBotApi.getMe(botToken);
      } catch (error) {
        throw new BadRequestException(this.telegramErrorMessage(error));
      }
      if (!profile.is_bot || !profile.username) {
        throw new BadRequestException("Telegram did not return a valid bot username.");
      }
      const botUsername = profile.username;
      const existingBotToken = this.telegramBotToken(existingChannel?.encryptedCredentials);
      const existingRetiredBotCredentials = this.telegramRetiredBotCredentials(
        existingChannel?.settings,
      );
      await lockBotIdentities([
        profile.id,
        existingChannel?.externalId,
        this.telegramBotIdFromToken(botToken),
        this.telegramBotIdFromToken(existingBotToken),
        this.telegramBotIdFromToken(this.telegramBotToken(existingRetiredBotCredentials)),
      ]);
      const duplicateBot = await this.prisma.channel.findFirst({
        where: {
          type: "TELEGRAM",
          externalId: String(profile.id),
          tenantId: { not: context.tenantId },
          status: "ACTIVE",
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicateBot)
        throw new BadRequestException(
          "This Telegram bot is already connected to another workspace.",
        );

      const integration = await this.loadOrCreateByProvider(context.tenantId, "TELEGRAM");
      const replacingBot = Boolean(existingBotToken && existingBotToken !== botToken);
      let previousBotCleanupPending = Boolean(existingRetiredBotCredentials);
      if (existingChannel && existingRetiredBotCredentials) {
        previousBotCleanupPending = !(await this.cleanupTelegramRetiredBot(context, {
          channelId: existingChannel.id,
          retiredEncryptedCredentials: existingRetiredBotCredentials,
          expectedEncryptedCredentials: existingChannel.encryptedCredentials,
        }));
      }
      if (replacingBot && previousBotCleanupPending) {
        throw new BadRequestException(
          "Previous Telegram bot cleanup is still pending. Run the connection check and try again.",
        );
      }
      const channel = await this.channelsService.prepareTelegramChannel(context, {
        rotateWebhookSecret: replacingBot,
      });
      const secretStage = await this.channelsService.stageTelegramWebhookSecret(context, {
        channelId: channel.id,
        candidateSecret: channel.webhookSecret,
        candidateBotId: String(profile.id),
        expectedEncryptedCredentials: channel.encryptedCredentials,
      });
      const webhookUrl = this.telegramWebhookUrl(channel.publicKey);
      try {
        const registered = await this.telegramBotApi.setWebhook({
          botToken,
          url: webhookUrl,
          secretToken: channel.webhookSecret,
          allowedUpdates: telegramAllowedUpdates,
        });
        if (!registered) throw new Error("Telegram rejected webhook registration.");
        const webhookInfo = await this.telegramBotApi.getWebhookInfo(botToken);
        if (webhookInfo.url !== webhookUrl || !this.telegramAllowedUpdatesMatch(webhookInfo)) {
          throw new Error("Telegram webhook verification failed. Please try again.");
        }
      } catch (error) {
        await this.compensateTelegramConnectFailure(context, {
          channelId: channel.id,
          webhookUrl,
          botToken,
          existingBotToken,
          replacingBot,
          expectedEncryptedCredentials: channel.encryptedCredentials,
          secretStage,
        });
        throw new BadRequestException(this.telegramErrorMessage(error));
      }

      const encryptedCredentials = encryptIntegrationCredentials({ botToken });
      try {
        await this.channelsService.activateTelegramChannel(context, {
          channelId: channel.id,
          botId: profile.id,
          botUsername,
          encryptedCredentials,
          expectedEncryptedCredentials: channel.encryptedCredentials,
          webhookSecret: channel.webhookSecret,
          retainPreviousBotWebhookCleanup: replacingBot,
        });
      } catch (error) {
        await this.compensateTelegramConnectFailure(context, {
          channelId: channel.id,
          webhookUrl,
          botToken,
          existingBotToken,
          replacingBot,
          expectedEncryptedCredentials: channel.encryptedCredentials,
          secretStage,
        });
        throw error;
      }
      if (replacingBot && channel.encryptedCredentials) {
        previousBotCleanupPending = !(await this.cleanupTelegramRetiredBot(context, {
          channelId: channel.id,
          retiredEncryptedCredentials: channel.encryptedCredentials,
          expectedEncryptedCredentials: encryptedCredentials,
        }));
      }
      const connectedAt = new Date();
      const updated = await this.prisma.integrationAccount.update({
        where: { id: integration.id },
        data: {
          status: "CONNECTED",
          name: `Telegram @${botUsername}`,
          connectedAt,
          lastSyncAt: connectedAt,
          settings: {
            syncDirection: "two-way",
            botId: String(profile.id),
            botUsername,
            tokenConfigured: true,
            webhookConfigured: true,
            managedByLeadVirt: true,
            allowedUpdates: telegramAllowedUpdates,
            previousBotCleanupPending,
          },
        },
      });
      await this.logSync(
        context.tenantId,
        updated.id,
        "connect",
        "SUCCESS",
        `Telegram @${botUsername} connected automatically.`,
      );
      if (previousBotCleanupPending) {
        await this.logSync(
          context.tenantId,
          updated.id,
          "cleanup_previous_bot",
          "FAILED",
          "The new Telegram bot is active, but cleanup of the previous bot is pending.",
        );
      }
      await this.logAudit(context, "integration.connected", updated.id, {
        provider: "TELEGRAM",
        botId: String(profile.id),
        botUsername,
        webhookManaged: true,
        previousBotCleanupPending,
      });
      return (
        (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated)
      );
    });
  }

  private async testTelegramConnection(context: RequestContext): Promise<IntegrationTestResult> {
    return this.withTelegramLifecycleLock(context.tenantId, (lockBotIdentities) =>
      this.testTelegramConnectionLocked(context, lockBotIdentities),
    );
  }

  private async testTelegramConnectionLocked(
    context: RequestContext,
    lockBotIdentities: TelegramBotLifecycleLock,
  ): Promise<IntegrationTestResult> {
    const integration = await this.loadByProvider(context.tenantId, "TELEGRAM");
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null },
      select: {
        id: true,
        status: true,
        publicKey: true,
        externalId: true,
        encryptedCredentials: true,
        settings: true,
      },
    });
    const botToken = this.telegramBotToken(channel?.encryptedCredentials);
    const retiredBotCredentials = this.telegramRetiredBotCredentials(channel?.settings);
    await lockBotIdentities([
      channel?.externalId,
      this.telegramBotIdFromToken(botToken),
      this.telegramBotIdFromToken(this.telegramBotToken(retiredBotCredentials)),
    ]);
    const checkedAt = new Date();
    let status: "SUCCESS" | "FAILED" = "FAILED";
    let message = "Telegram is not connected. Paste the bot token and connect it again.";
    let webhookRepaired = false;
    let pendingUpdates = 0;
    let deliveryError = false;
    let allowedUpdatesValid = false;
    let previousBotCleanupPending = Boolean(this.telegramRetiredBotCredentials(channel?.settings));
    let previousBotCleanupRepaired = false;

    if (channel?.status === "ACTIVE" && botToken && channel.publicKey) {
      try {
        if (retiredBotCredentials) {
          previousBotCleanupRepaired = await this.cleanupTelegramRetiredBot(context, {
            channelId: channel.id,
            retiredEncryptedCredentials: retiredBotCredentials,
            expectedEncryptedCredentials: channel.encryptedCredentials,
          });
          previousBotCleanupPending = !previousBotCleanupRepaired;
        }
        const expectedWebhookUrl = this.telegramWebhookUrl(channel.publicKey);
        const [profile, initialWebhookInfo] = await Promise.all([
          this.telegramBotApi.getMe(botToken),
          this.telegramBotApi.getWebhookInfo(botToken),
        ]);
        let webhookInfo = initialWebhookInfo;
        const storedSecrets = this.telegramWebhookSecrets(channel.settings);
        if (storedSecrets.pending && storedSecrets.pendingBotId !== channel.externalId) {
          throw new Error(
            "Telegram bot replacement is incomplete. Reconnect the intended bot to finish it safely.",
          );
        }
        let webhookSecret = storedSecrets.pending ?? storedSecrets.active;
        let stagedWebhookSecret = storedSecrets.pending !== undefined;
        let generatedWebhookSecret = false;
        if (!webhookSecret) {
          const prepared = await this.channelsService.prepareTelegramChannel(context);
          if (!channel.encryptedCredentials) {
            throw new Error("Telegram credentials are missing. Reconnect the bot.");
          }
          webhookSecret = await this.channelsService.ensureTelegramWebhookSecret(context, {
            channelId: channel.id,
            candidateSecret: prepared.webhookSecret,
            expectedEncryptedCredentials: channel.encryptedCredentials,
          });
          generatedWebhookSecret = true;
        }
        const staleWebhook =
          generatedWebhookSecret ||
          stagedWebhookSecret ||
          webhookInfo.url !== expectedWebhookUrl ||
          !this.telegramAllowedUpdatesMatch(webhookInfo) ||
          this.telegramDeliveryFailed(webhookInfo);

        if (staleWebhook && webhookSecret) {
          const registered = await this.telegramBotApi.setWebhook({
            botToken,
            url: expectedWebhookUrl,
            secretToken: webhookSecret,
            allowedUpdates: telegramAllowedUpdates,
          });
          if (!registered) throw new Error("Telegram rejected webhook repair.");
          webhookRepaired = true;
          webhookInfo = await this.telegramBotApi.getWebhookInfo(botToken);
        }

        pendingUpdates = Math.max(0, webhookInfo.pending_update_count);
        deliveryError = this.telegramDeliveryFailed(webhookInfo);
        allowedUpdatesValid = this.telegramAllowedUpdatesMatch(webhookInfo);
        if (
          stagedWebhookSecret &&
          webhookSecret &&
          channel.encryptedCredentials &&
          webhookInfo.url === expectedWebhookUrl &&
          allowedUpdatesValid
        ) {
          await this.channelsService.finalizeTelegramWebhookSecret(context, {
            channelId: channel.id,
            candidateSecret: webhookSecret,
            botId: String(profile.id),
            expectedEncryptedCredentials: channel.encryptedCredentials,
          });
          stagedWebhookSecret = false;
        }
        if (webhookInfo.url !== expectedWebhookUrl) {
          message = webhookSecret
            ? "Telegram webhook repair did not complete. Try again."
            : "Telegram webhook needs repair. Reconnect the bot in one click.";
        } else if (!allowedUpdatesValid) {
          message = "Telegram incoming-message subscription needs repair. Try the check again.";
        } else if (stagedWebhookSecret) {
          message = "Telegram webhook secret promotion did not complete. Try the check again.";
        } else if (pendingUpdates > 0) {
          message = deliveryError
            ? "Telegram cannot deliver incoming messages. LeadVirt tried to repair the webhook; try the check again shortly."
            : "Telegram is connected, but incoming updates are still waiting. Try the check again shortly.";
        } else if (previousBotCleanupPending) {
          message =
            "The new Telegram bot is ready, but cleanup of the previous bot is still pending. Try the check again.";
        } else {
          status = "SUCCESS";
          message =
            webhookRepaired || previousBotCleanupRepaired
              ? `Telegram @${profile.username ?? profile.first_name} was repaired automatically and is ready.`
              : `Telegram @${profile.username ?? profile.first_name} is connected and ready.`;
          await this.prisma.channel.update({
            where: { id: channel.id },
            data: { status: "ACTIVE", lastHealthAt: checkedAt },
          });
        }
      } catch (error) {
        message = this.telegramErrorMessage(error);
      }
    }

    await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: {
        settings: {
          ...asRecord(integration.settings),
          previousBotCleanupPending,
        },
        ...(status === "SUCCESS" ? { status: "CONNECTED", lastSyncAt: checkedAt } : {}),
      },
    });

    const syncLog = await this.prisma.integrationSyncLog.create({
      data: {
        tenantId: context.tenantId,
        integrationId: integration.id,
        action: "test_connection",
        status,
        message,
        metadata: {
          provider: "TELEGRAM",
          webhookManaged: true,
          webhookRepaired,
          pendingUpdates,
          deliveryError,
          allowedUpdatesValid,
          previousBotCleanupPending,
          previousBotCleanupRepaired,
        },
        createdAt: checkedAt,
      },
    });
    await this.logAudit(context, "integration.test_connection", integration.id, {
      provider: "TELEGRAM",
      status,
      syncLogId: syncLog.id,
    });
    const current = (await this.list(context)).find((item) => item.id === integration.id);
    return {
      ok: status === "SUCCESS",
      provider: "TELEGRAM",
      integrationId: integration.id,
      status,
      message,
      checkedAt: checkedAt.toISOString(),
      integration: current ?? this.toDto(integration),
    };
  }

  private telegramWebhookUrl(publicKey: string) {
    const relayUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim();
    if (relayUrl) {
      return `${relayUrl.replace(/\/+$/, "")}/${publicKey}/webhook`;
    }
    const apiUrl = (process.env.API_URL ?? "http://localhost:4001").replace(/\/+$/, "");
    return `${apiUrl}/api/public/channels/telegram/${publicKey}/webhook`;
  }

  private withTelegramLifecycleLock<T>(
    tenantId: string,
    operation: (lockBotIdentities: TelegramBotLifecycleLock) => Promise<T>,
  ) {
    return withTelegramLifecycleLock(this.prisma, tenantId, operation);
  }

  private telegramBotIdFromToken(botToken: string | undefined) {
    const match = botToken?.match(/^([1-9]\d*):/u);
    return match?.[1] ?? null;
  }

  private telegramBotToken(encryptedCredentials?: string | null) {
    if (!encryptedCredentials) return undefined;
    try {
      return firstString(decryptIntegrationCredentials(encryptedCredentials).botToken);
    } catch {
      return undefined;
    }
  }

  private telegramWebhookSecrets(settings: Prisma.JsonValue | null) {
    const telegram = asRecord(asRecord(settings).telegram);
    return {
      active: optionalString(
        typeof telegram.webhookSecret === "string" ? telegram.webhookSecret : undefined,
      ),
      pending: optionalString(
        typeof telegram.webhookPendingSecret === "string"
          ? telegram.webhookPendingSecret
          : undefined,
      ),
      pendingBotId: optionalString(
        typeof telegram.webhookPendingBotId === "string" ? telegram.webhookPendingBotId : undefined,
      ),
    };
  }

  private telegramRetiredBotCredentials(settings: Prisma.JsonValue | null | undefined) {
    const telegram = asRecord(asRecord(settings).telegram);
    return optionalString(
      typeof telegram.retiredBotEncryptedCredentials === "string"
        ? telegram.retiredBotEncryptedCredentials
        : undefined,
    );
  }

  private async cleanupTelegramRetiredBot(
    context: RequestContext,
    input: {
      channelId: string;
      retiredEncryptedCredentials: string;
      expectedEncryptedCredentials: string | null;
    },
  ) {
    const retiredBotToken = this.telegramBotToken(input.retiredEncryptedCredentials);
    if (!retiredBotToken) return false;
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: input.channelId,
        tenantId: context.tenantId,
        type: "TELEGRAM",
        deletedAt: null,
      },
      select: { publicKey: true, encryptedCredentials: true, settings: true },
    });
    if (
      !channel?.publicKey ||
      channel.encryptedCredentials !== input.expectedEncryptedCredentials
    ) {
      return false;
    }
    const telegram = asRecord(asRecord(channel.settings).telegram);
    const retiredBotId = optionalString(
      typeof telegram.retiredBotId === "string" ? telegram.retiredBotId : undefined,
    );
    const tokenBotId = this.telegramBotIdFromToken(retiredBotToken);
    if (retiredBotId && retiredBotId !== tokenBotId) return false;
    try {
      const removed = await this.telegramBotApi.deleteWebhook(retiredBotToken, {
        dropPendingUpdates: true,
      });
      if (!removed) return false;
      const after = await this.telegramBotApi.getWebhookInfo(retiredBotToken);
      if (after.url || after.pending_update_count !== 0) return false;
    } catch {
      return false;
    }
    return this.channelsService.clearTelegramRetiredBotWebhook(context, input);
  }

  private async removeTelegramWebhookWhenDrained(input: {
    botToken: string;
    restoreUrl: string;
    restoreSecret: string;
  }) {
    const restore = async () => {
      await this.telegramBotApi.setWebhook({
        botToken: input.botToken,
        url: input.restoreUrl,
        secretToken: input.restoreSecret,
        allowedUpdates: telegramAllowedUpdates,
      });
    };
    const before = await this.telegramBotApi.getWebhookInfo(input.botToken);
    if (before.pending_update_count !== 0) {
      if (!before.url) await restore();
      return false;
    }
    if (!before.url) return true;
    if (!(await this.telegramBotApi.deleteWebhook(input.botToken))) return false;

    const after = await this.telegramBotApi.getWebhookInfo(input.botToken);
    if (!after.url && after.pending_update_count === 0) return true;
    if (!after.url && after.pending_update_count > 0) await restore();
    return false;
  }

  private telegramAllowedUpdatesMatch(webhookInfo: TelegramWebhookInfo) {
    const actual = webhookInfo.allowed_updates;
    if (!Array.isArray(actual) || actual.length !== telegramAllowedUpdates.length) return false;
    const unique = new Set(actual);
    return (
      unique.size === telegramAllowedUpdates.length &&
      telegramAllowedUpdates.every((update) => unique.has(update))
    );
  }

  private telegramDeliveryFailed(webhookInfo: TelegramWebhookInfo) {
    return (
      webhookInfo.pending_update_count > 0 && this.telegramWebhookHasDeliveryError(webhookInfo)
    );
  }

  private telegramWebhookHasDeliveryError(webhookInfo: TelegramWebhookInfo) {
    return (
      typeof webhookInfo.last_error_date === "number" ||
      optionalString(webhookInfo.last_error_message) !== undefined
    );
  }

  private telegramErrorMessage(error: unknown) {
    return error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Telegram setup failed. Please try again.";
  }

  private async compensateTelegramConnectFailure(
    context: RequestContext,
    input: {
      channelId: string;
      webhookUrl: string;
      botToken: string;
      existingBotToken: string | undefined;
      replacingBot: boolean;
      expectedEncryptedCredentials: string | null;
      secretStage: TelegramWebhookSecretStage;
    },
  ) {
    let remoteRestored = false;
    try {
      if (
        input.existingBotToken &&
        !input.replacingBot &&
        input.secretStage.previousWebhookSecret
      ) {
        remoteRestored = await this.telegramBotApi.setWebhook({
          botToken: input.botToken,
          url: input.webhookUrl,
          secretToken: input.secretStage.previousWebhookSecret,
          allowedUpdates: telegramAllowedUpdates,
        });
      } else {
        remoteRestored = await this.telegramBotApi.deleteWebhook(input.botToken, {
          dropPendingUpdates: true,
        });
      }
    } catch {
      remoteRestored = false;
    }
    if (!remoteRestored || !input.secretStage.staged) return;
    await this.channelsService
      .rollbackTelegramWebhookSecret(context, {
        channelId: input.channelId,
        candidateSecret: input.secretStage.webhookSecret,
        expectedEncryptedCredentials: input.expectedEncryptedCredentials,
        previousPendingWebhookSecret: input.secretStage.previousPendingWebhookSecret,
        previousPendingBotId: input.secretStage.previousPendingBotId,
      })
      .catch(() => undefined);
  }

  syncLeadToCrm(context: RequestContext, lead: LeadForCrmSync): Promise<CrmLeadSyncResult> {
    void context;
    void lead;
    return Promise.reject(crmSyncUnavailable());
  }

  private async loadByProvider(tenantId: string, provider: string) {
    const parsedProvider = this.parseProvider(provider);
    const integration = await this.prisma.integrationAccount.findFirst({
      where: { tenantId, provider: parsedProvider, deletedAt: null },
    });
    if (!integration) {
      throw new NotFoundException("Integration was not found.");
    }
    return integration;
  }

  private async loadOrCreateByProvider(tenantId: string, provider: string) {
    const parsedProvider = this.parseProvider(provider);
    const integration = await this.prisma.integrationAccount.findFirst({
      where: { tenantId, provider: parsedProvider, deletedAt: null },
    });
    if (integration) return integration;

    const catalog = providerCatalog[parsedProvider];
    return this.prisma.integrationAccount.upsert({
      where: { tenantId_provider: { tenantId, provider: parsedProvider } },
      create: {
        tenantId,
        provider: parsedProvider,
        name: catalog.name,
        category: catalog.category,
        status: "DISCONNECTED",
        scopes: ["read", "write"],
        settings: catalog.settings,
      },
      update: {
        deletedAt: null,
        name: catalog.name,
        category: catalog.category,
        status: "DISCONNECTED",
        connectedAt: null,
        scopes: ["read", "write"],
        settings: catalog.settings,
      },
    });
  }

  private async loadInboundChannel(tenantId: string, type: "TELEGRAM" | "WEBHOOK") {
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId, type, status: "ACTIVE", deletedAt: null, publicKey: { not: null } },
      select: {
        id: true,
        type: true,
        publicKey: true,
        settings: true,
        encryptedCredentials: true,
        createdAt: true,
      },
    });
    const provider = type === "TELEGRAM" ? "TELEGRAM" : "WEBHOOK_API";
    if (!channel || !this.operationalChannelForProvider(provider, [channel])) {
      throw new BadRequestException(`${type} channel is not fully configured and active.`);
    }
    return channel;
  }

  private async configureWebhookProvider(
    context: RequestContext,
    settings: Record<string, unknown>,
  ) {
    await this.loadInboundChannel(context.tenantId, "WEBHOOK");
    const provider = "generic";

    const sanitizedWebhook = asRecord(settings.webhook);
    return {
      ...(typeof settings.displayName === "string"
        ? { displayName: settings.displayName.trim() }
        : {}),
      ...(typeof settings.endpointUrl === "string"
        ? { endpointUrl: settings.endpointUrl.trim() }
        : {}),
      ...(typeof settings.syncMode === "string" ? { syncMode: settings.syncMode } : {}),
      ...(typeof settings.syncEnabled === "boolean" ? { syncEnabled: settings.syncEnabled } : {}),
      ...(typeof settings.notes === "string" ? { notes: settings.notes.trim() } : {}),
      ...(isRecord(settings.ui) ? { ui: settings.ui as Prisma.InputJsonObject } : {}),
      provider,
      webhook: {
        ...(typeof sanitizedWebhook.endpointUrl === "string"
          ? { endpointUrl: sanitizedWebhook.endpointUrl.trim() }
          : {}),
        provider,
      },
    };
  }

  private sampleHeaders(
    channel: { settings: Prisma.JsonValue | null },
    type: "TELEGRAM" | "WEBHOOK",
  ): Record<string, string | string[] | undefined> {
    const settings = asRecord(channel.settings);
    if (type === "TELEGRAM") {
      const telegram = asRecord(settings.telegram);
      const secret = optionalString(
        typeof telegram.webhookSecret === "string" ? telegram.webhookSecret : undefined,
      );
      return secret ? { "x-telegram-bot-api-secret-token": secret } : {};
    }
    const webhook = asRecord(settings.webhook);
    const secret = optionalString(
      firstString(webhook.secret, webhook.webhookSecret, settings.secret, settings.webhookSecret),
    );
    return secret ? { "x-leadvirt-webhook-secret": secret } : {};
  }

  private async sampleDeliveryResult(
    context: RequestContext,
    provider: ProviderParam,
    integrationId: string,
    result: {
      ok: true;
      duplicate: boolean;
      conversationId: string;
      leadId: string | null;
      inboundMessageId: string | null;
      aiMessageId: string | null;
      outboundStatus: "queued" | "sent" | "failed" | "skipped";
      reply: string | null;
    },
  ): Promise<IntegrationSampleDeliveryResult> {
    const integration = (await this.list(context)).find((item) => item.id === integrationId);
    if (!integration) {
      throw new NotFoundException("Integration was not found after sample delivery.");
    }
    return {
      ok: result.ok,
      provider,
      integrationId,
      duplicate: result.duplicate,
      conversationId: result.conversationId,
      leadId: result.leadId,
      inboundMessageId: result.inboundMessageId,
      aiMessageId: result.aiMessageId,
      outboundStatus: result.outboundStatus,
      reply: result.reply,
      integration,
    };
  }

  private parseProvider(provider: string): ProviderParam {
    const normalized = provider.toUpperCase().replaceAll("-", "_");
    if (!providers.includes(normalized as ProviderParam)) {
      throw new BadRequestException("Unsupported integration provider.");
    }
    return normalized as ProviderParam;
  }

  private toDto(
    integration: Awaited<ReturnType<typeof this.prisma.integrationAccount.update>>,
    inboundEndpoint: IntegrationInboundEndpoint | null = null,
  ): IntegrationAccount {
    const unavailable = isUnavailableProvider(integration.provider);
    return {
      id: integration.id,
      tenantId: integration.tenantId,
      provider: integration.provider,
      status: unavailable ? "COMING_SOON" : integration.status,
      name: integration.name,
      category: integration.category,
      settings: this.integrationSettings(
        integration.provider,
        integration.settings,
        integration.encryptedCredentials,
      ),
      connectedAt: unavailable ? null : (integration.connectedAt?.toISOString() ?? null),
      lastSyncAt: unavailable ? null : (integration.lastSyncAt?.toISOString() ?? null),
      inboundEndpoint,
      recentWebhookEvents: [],
      recentSyncLogs: [],
    };
  }

  private integrationSettings(
    provider: ProviderParam,
    settings: Prisma.JsonValue | null,
    encryptedCredentials: string | null,
  ) {
    if (isUnavailableProvider(provider)) {
      const base = asRecord(settings);
      return {
        implementationStatus: "NOT_AVAILABLE",
        selfServe: false,
        ...(["REQUESTED", "DELIVERY_UNKNOWN"].includes(String(base.requestStatus))
          ? { requestStatus: base.requestStatus }
          : {}),
        ...(["PENDING", "SENT", "FAILED", "UNKNOWN"].includes(
          String(base.requestDeliveryStatus),
        )
          ? { requestDeliveryStatus: base.requestDeliveryStatus }
          : {}),
        ...(typeof base.requestedAt === "string" ? { requestedAt: base.requestedAt } : {}),
      };
    }
    const base = asRecord(settings);
    if (provider === "TELEGRAM") {
      return {
        ...(typeof base.botId === "string" ? { botId: base.botId } : {}),
        ...(typeof base.botUsername === "string" ? { botUsername: base.botUsername } : {}),
        tokenConfigured:
          base.tokenConfigured === true ||
          typeof base.apiToken === "string" ||
          typeof base.botToken === "string",
        webhookConfigured: base.webhookConfigured === true,
        managedByLeadVirt: base.managedByLeadVirt === true,
        previousBotCleanupPending: base.previousBotCleanupPending === true,
        syncDirection: "two-way",
      };
    }
    const partitioned = partitionIntegrationAccountSettings(provider, base);
    const publicSettings = partitioned.publicSettings;
    const credentialsConfigured =
      encryptedCredentials !== null || Object.keys(partitioned.credentials).length > 0;
    if (provider !== "WEBHOOK_API") {
      return { ...publicSettings, credentialsConfigured };
    }

    const genericProvider = "generic";
    return {
      ...(typeof publicSettings.displayName === "string"
        ? { displayName: publicSettings.displayName }
        : {}),
      ...(typeof publicSettings.endpointUrl === "string"
        ? { endpointUrl: publicSettings.endpointUrl }
        : {}),
      ...(typeof publicSettings.syncMode === "string" ? { syncMode: publicSettings.syncMode } : {}),
      ...(typeof publicSettings.syncEnabled === "boolean"
        ? { syncEnabled: publicSettings.syncEnabled }
        : {}),
      ...(typeof publicSettings.notes === "string" ? { notes: publicSettings.notes } : {}),
      ...(isRecord(publicSettings.ui) ? { ui: publicSettings.ui } : {}),
      credentialsConfigured,
      provider: genericProvider,
      webhook: {
        provider: genericProvider,
      },
    };
  }

  private operationalChannelForProvider(
    provider: ProviderParam,
    channels: InboundChannelProjection[],
  ): InboundChannelProjection | null {
    if (provider === "TELEGRAM") {
      return (
        channels.find(
          (channel) =>
            channel.type === "TELEGRAM" &&
            Boolean(channel.publicKey) &&
            Boolean(channel.encryptedCredentials) &&
            typeof this.sampleHeaders(channel, "TELEGRAM")["x-telegram-bot-api-secret-token"] ===
              "string",
        ) ?? null
      );
    }
    if (provider === "WEBHOOK_API") {
      return (
        channels.find(
          (channel) =>
            channel.type === "WEBHOOK" &&
            Boolean(channel.publicKey) &&
            typeof this.sampleHeaders(channel, "WEBHOOK")["x-leadvirt-webhook-secret"] === "string",
        ) ?? null
      );
    }
    return null;
  }

  private inboundEndpointForProvider(
    provider: ProviderParam,
    channels: InboundChannelProjection[],
  ): IntegrationInboundEndpoint | null {
    if (provider === "TELEGRAM") {
      const channel = this.operationalChannelForProvider(provider, channels);
      if (!channel?.publicKey) return null;
      return {
        channelType: "TELEGRAM",
        publicKey: channel.publicKey,
        endpointPath: `/api/public/channels/telegram/${channel.publicKey}/webhook`,
        secretHeader: "x-telegram-bot-api-secret-token",
        samplePayload: {
          update_id: 88001,
          message: {
            message_id: 101,
            chat: { id: 555123, type: "private", username: "sample_client" },
            from: {
              id: 555123,
              first_name: "Sample",
              last_name: "Telegram",
              username: "sample_client",
            },
            text: "I want to book an appointment from Telegram",
          },
        },
      };
    }

    if (provider === "WEBHOOK_API") {
      const channel = this.operationalChannelForProvider(provider, channels);
      if (!channel?.publicKey) return null;
      return {
        channelType: "WEBHOOK",
        publicKey: channel.publicKey,
        endpointPath: `/api/public/channels/webhook/${channel.publicKey}/events`,
        secretHeader: "x-leadvirt-webhook-secret",
        samplePayload: {
          eventId: "leadvirt-sample-event",
          conversationId: "leadvirt-sample-thread-42",
          source: "Партнерская лендинг-форма",
          customer: {
            id: "leadvirt-sample-customer-42",
            name: "Тестовый клиент Webhook",
            phone: "+1 555 0100",
            email: "webhook.sample@example.com",
          },
          message: {
            id: "leadvirt-sample-message-42",
            text: "Нужна цена и запись через webhook API",
          },
        },
      };
    }

    return null;
  }

  private webhookProvidersForChannel(channel: { id: string; type: ChannelType }) {
    if (channel.type === "TELEGRAM") return [`telegram:${channel.id}`, "telegram"];
    if (channel.type === "WEBHOOK") return [`webhook:${channel.id}`];
    return [];
  }

  private webhookProviderKeysForIntegration(
    provider: ProviderParam,
    channels: { id: string; type: ChannelType }[],
  ): string[] {
    if (provider === "TELEGRAM") {
      const channel = channels.find((item) => item.type === "TELEGRAM");
      return channel ? [`telegram:${channel.id}`, "telegram"] : [];
    }
    if (provider === "WEBHOOK_API") {
      const channel = channels.find((item) => item.type === "WEBHOOK");
      return channel ? [`webhook:${channel.id}`] : [];
    }
    return [];
  }

  private webhookEventsForProvider(
    provider: ProviderParam,
    channels: { id: string; type: ChannelType }[],
    events: {
      id: string;
      provider: string;
      externalEventId: string;
      status: string;
      errorMessage: string | null;
      receivedAt: Date;
      processedAt: Date | null;
    }[],
  ): IntegrationWebhookEventSummary[] {
    const webhookProviders = this.webhookProviderKeysForIntegration(provider, channels);
    if (webhookProviders.length === 0) return [];
    return events
      .filter((event) => webhookProviders.includes(event.provider))
      .slice(0, 3)
      .map((event) => ({
        id: event.id,
        provider: event.provider,
        externalEventId: event.externalEventId,
        status: event.status,
        errorMessage: event.errorMessage,
        receivedAt: event.receivedAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null,
      }));
  }

  private async logSync(
    tenantId: string,
    integrationId: string,
    action: string,
    status: string,
    message: string,
  ) {
    await this.prisma.integrationSyncLog.create({
      data: { tenantId, integrationId, action, status, message },
    });
  }

  private async logAudit(
    context: RequestContext,
    action: string,
    entityId: string,
    payload: Prisma.InputJsonObject,
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "integration",
        entityId,
        payload,
      },
    });
  }
}
