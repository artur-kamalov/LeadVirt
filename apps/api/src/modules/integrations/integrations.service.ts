import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AmoCrmAdapter, BitrixAdapter, type CrmAdapter } from "@leadvirt/integrations";
import type {
  ChannelType,
  IntegrationAccount,
  IntegrationInboundEndpoint,
  IntegrationSampleDeliveryResult,
  IntegrationTestResult,
  IntegrationWebhookEventSummary
} from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { TelegramService } from "../telegram/telegram.service.js";
import { WebhookService } from "../webhook/webhook.service.js";
import type { UpdateIntegrationSettingsDto } from "./dto/update-integration-settings.dto.js";

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
  "OTHER"
] as const;

type ProviderParam = (typeof providers)[number];
type CrmProvider = "AMOCRM" | "BITRIX24" | "RETAILCRM";

const providerCatalog: Record<ProviderParam, { name: string; category: string; settings: Prisma.InputJsonObject }> = {
  AMOCRM: { name: "amoCRM", category: "CRM", settings: { syncDirection: "two-way" } },
  BITRIX24: { name: "Bitrix24", category: "CRM", settings: { syncDirection: "two-way" } },
  RETAILCRM: { name: "RetailCRM", category: "CRM", settings: { syncDirection: "two-way" } },
  TELEGRAM: { name: "Telegram", category: "Канал", settings: { syncDirection: "inbound" } },
  WHATSAPP_BUSINESS: { name: "WhatsApp Business", category: "Канал", settings: { syncDirection: "inbound" } },
  INSTAGRAM: { name: "Instagram", category: "Канал", settings: { syncDirection: "inbound" } },
  VK: { name: "VK", category: "Канал", settings: { syncDirection: "inbound" } },
  EMAIL: { name: "Email", category: "Канал", settings: { syncDirection: "inbound" } },
  GOOGLE_CALENDAR: { name: "Google Calendar", category: "Календарь", settings: { syncDirection: "two-way" } },
  SHOPIFY: { name: "Shopify", category: "E-commerce", settings: { syncDirection: "two-way" } },
  SHOP_SCRIPT: { name: "Shop-Script", category: "E-commerce", settings: { syncDirection: "two-way" } },
  WEBHOOK_API: { name: "Webhook/API", category: "Разработчикам", settings: { syncDirection: "inbound" } },
  OTHER: { name: "Other integration", category: "Other", settings: { syncDirection: "manual" } }
};

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
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
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
    @Inject(TelegramService) private readonly telegramService: TelegramService,
    @Inject(WebhookService) private readonly webhookService: WebhookService
  ) {}

  async list(context: RequestContext): Promise<IntegrationAccount[]> {
    const [integrations, channels] = await Promise.all([
      this.prisma.integrationAccount.findMany({
        where: { tenantId: context.tenantId, deletedAt: null },
        include: {
          syncLogs: {
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true, action: true, status: true, message: true, createdAt: true }
          }
        },
        orderBy: [{ status: "asc" }, { name: "asc" }]
      }),
      this.prisma.channel.findMany({
        where: {
          tenantId: context.tenantId,
          deletedAt: null,
          status: "ACTIVE",
          type: { in: ["TELEGRAM", "WEBHOOK"] }
        },
        select: { id: true, type: true, publicKey: true, settings: true }
      })
    ]);
    const webhookProviders = [...new Set(channels.flatMap((channel) => this.webhookProvidersForChannel(channel)))];
    const webhookEvents =
      webhookProviders.length > 0
        ? await this.prisma.webhookEvent.findMany({
            where: {
              tenantId: context.tenantId,
              provider: { in: webhookProviders }
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
              processedAt: true
            }
          })
        : [];

    return integrations.map((integration) => ({
      id: integration.id,
      tenantId: integration.tenantId,
      provider: integration.provider,
      status: integration.status,
      name: integration.name,
      category: integration.category,
      settings: this.integrationSettings(integration.provider, integration.settings, channels),
      connectedAt: integration.connectedAt?.toISOString() ?? null,
      lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      inboundEndpoint: this.inboundEndpointForProvider(integration.provider, channels),
      recentWebhookEvents: this.webhookEventsForProvider(integration.provider, channels, webhookEvents),
      recentSyncLogs: integration.syncLogs.map((log) => ({
        id: log.id,
        action: log.action,
        status: log.status,
        message: log.message,
        createdAt: log.createdAt.toISOString()
      }))
    }));
  }

  async connect(context: RequestContext, provider: string): Promise<IntegrationAccount> {
    const integration = await this.loadOrCreateByProvider(context.tenantId, provider);
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: { status: "CONNECTED", connectedAt: new Date(), lastSyncAt: new Date() }
    });
    await this.logSync(context.tenantId, updated.id, "connect", "SUCCESS", `${updated.name} подключено в демо-режиме.`);
    await this.logAudit(context, "integration.connected", updated.id, { provider: updated.provider });
    return (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated);
  }

  async disconnect(context: RequestContext, provider: string): Promise<IntegrationAccount> {
    const integration = await this.loadByProvider(context.tenantId, provider);
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: { status: "DISCONNECTED", connectedAt: null }
    });
    await this.logSync(context.tenantId, updated.id, "disconnect", "SUCCESS", `${updated.name} отключено в демо-режиме.`);
    await this.logAudit(context, "integration.disconnected", updated.id, { provider: updated.provider });
    return (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated);
  }

  async updateSettings(context: RequestContext, provider: string, dto: UpdateIntegrationSettingsDto): Promise<IntegrationAccount> {
    const integration = await this.loadByProvider(context.tenantId, provider);
    const parsedProvider = this.parseProvider(provider);
    const sanitizedSettings = parsedProvider === "WEBHOOK_API" ? await this.configureWebhookProvider(context, dto.settings) : dto.settings;
    const updated = await this.prisma.integrationAccount.update({
      where: { id: integration.id },
      data: { settings: sanitizedSettings as Prisma.InputJsonObject }
    });
    await this.logAudit(context, "integration.settings_updated", updated.id, { provider: updated.provider });
    return (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated);
  }

  async testConnection(context: RequestContext, provider: string): Promise<IntegrationTestResult> {
    const integration = await this.loadByProvider(context.tenantId, provider);
    const checkedAt = new Date();
    const status = this.connectionTestStatus(integration.status);
    const message = this.connectionTestMessage(integration.name, integration.status);
    const updated =
      status === "SUCCESS"
        ? await this.prisma.integrationAccount.update({
            where: { id: integration.id },
            data: { lastSyncAt: checkedAt }
          })
        : integration;

    const syncLog = await this.prisma.integrationSyncLog.create({
      data: {
        tenantId: context.tenantId,
        integrationId: integration.id,
        action: "test_connection",
        status,
        message,
        metadata: {
          provider: integration.provider,
          integrationStatus: integration.status
        },
        createdAt: checkedAt
      }
    });

    await this.logAudit(context, "integration.test_connection", integration.id, {
      provider: integration.provider,
      status,
      syncLogId: syncLog.id
    });

    return {
      ok: status === "SUCCESS",
      provider: updated.provider,
      integrationId: updated.id,
      status,
      message,
      checkedAt: checkedAt.toISOString(),
      integration: (await this.list(context)).find((item) => item.id === updated.id) ?? this.toDto(updated)
    };
  }

  async sendSampleInbound(context: RequestContext, provider: string): Promise<IntegrationSampleDeliveryResult> {
    const parsedProvider = this.parseProvider(provider);
    const integration = await this.loadByProvider(context.tenantId, parsedProvider);
    if (integration.status !== "CONNECTED") {
      throw new BadRequestException(`${integration.name} должен быть подключен перед отправкой тестового входящего сообщения.`);
    }

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
            from: { id: id % 1_000_000_000, is_bot: false, first_name: "LeadVirt", last_name: "Sample", username: "leadvirt_sample" },
            text: "Тестовое входящее сообщение Telegram со страницы интеграций"
          }
        },
        this.sampleHeaders(channel, "TELEGRAM")
      );
      await this.logSync(context.tenantId, integration.id, "sample_inbound", "SUCCESS", `Тестовое входящее событие ${integration.name} обработано.`);
      await this.logAudit(context, "integration.sample_inbound", integration.id, { provider: parsedProvider, conversationId: result.conversationId });
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
            email: "sample.lead@leadvirt.ai"
          },
          message: {
            id: `leadvirt-sample-message-${id}`,
            text: "Тестовое входящее сообщение Webhook/API со страницы интеграций",
            timestamp: new Date(id).toISOString()
          }
        },
        this.sampleHeaders(channel, "WEBHOOK")
      );
      await this.logSync(context.tenantId, integration.id, "sample_inbound", "SUCCESS", `Тестовое входящее событие ${integration.name} обработано.`);
      await this.logAudit(context, "integration.sample_inbound", integration.id, { provider: parsedProvider, conversationId: result.conversationId });
      return this.sampleDeliveryResult(context, parsedProvider, integration.id, result);
    }

    throw new BadRequestException("Тестовый входящий трафик доступен для Telegram и Webhook/API.");
  }

  async syncLeadToCrm(context: RequestContext, lead: LeadForCrmSync): Promise<CrmLeadSyncResult> {
    const integration = await this.findConnectedCrm(context.tenantId);
    const provider = integration.provider as CrmProvider;
    const adapter = this.adapterForProvider(provider);
    const syncedAt = new Date();
    const fields = this.leadFieldsForCrm(lead);

    try {
      const result = await adapter.createLead({
        tenantId: context.tenantId,
        leadId: lead.id,
        fields
      });

      const syncLog = await this.prisma.integrationSyncLog.create({
        data: {
          tenantId: context.tenantId,
          integrationId: integration.id,
          action: "lead.create",
          status: "SUCCESS",
          message: `Лид синхронизирован с ${integration.name}.`,
          metadata: {
            provider,
            leadId: lead.id,
            externalId: result.externalId,
            url: result.url ?? null,
            fields
          },
          createdAt: syncedAt
        }
      });

      await Promise.all([
        this.prisma.integrationAccount.update({
          where: { id: integration.id },
          data: { lastSyncAt: syncedAt }
        }),
        this.incrementCrmUsage(context.tenantId, syncedAt),
        this.logAudit(context, "crm.lead_synced", integration.id, {
          provider,
          leadId: lead.id,
          syncLogId: syncLog.id,
          externalId: result.externalId,
          url: result.url ?? null
        })
      ]);

      return {
        provider,
        integrationId: integration.id,
        syncLogId: syncLog.id,
        externalId: result.externalId,
        url: result.url ?? null,
        syncedAt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "CRM sync failed.";
      const syncLog = await this.prisma.integrationSyncLog.create({
        data: {
          tenantId: context.tenantId,
          integrationId: integration.id,
          action: "lead.create",
          status: "FAILED",
          message,
          metadata: { provider, leadId: lead.id, fields },
          createdAt: syncedAt
        }
      });
      await this.logAudit(context, "crm.lead_sync_failed", integration.id, {
        provider,
        leadId: lead.id,
        syncLogId: syncLog.id,
        error: message
      });
      throw new BadRequestException(message);
    }
  }

  private async loadByProvider(tenantId: string, provider: string) {
    const parsedProvider = this.parseProvider(provider);
    const integration = await this.prisma.integrationAccount.findFirst({
      where: { tenantId, provider: parsedProvider, deletedAt: null }
    });
    if (!integration) {
      throw new NotFoundException("Integration was not found.");
    }
    return integration;
  }

  private async loadOrCreateByProvider(tenantId: string, provider: string) {
    const parsedProvider = this.parseProvider(provider);
    const integration = await this.prisma.integrationAccount.findFirst({
      where: { tenantId, provider: parsedProvider, deletedAt: null }
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
        settings: catalog.settings
      },
      update: {
        deletedAt: null,
        name: catalog.name,
        category: catalog.category,
        status: "DISCONNECTED",
        connectedAt: null,
        scopes: ["read", "write"],
        settings: catalog.settings
      }
    });
  }

  private async loadInboundChannel(tenantId: string, type: "TELEGRAM" | "WEBHOOK") {
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId, type, status: "ACTIVE", deletedAt: null, publicKey: { not: null } },
      select: { id: true, type: true, publicKey: true, settings: true }
    });
    if (!channel?.publicKey) {
      throw new BadRequestException(`${type} channel is not active or has no public key.`);
    }
    return channel;
  }

  private async configureWebhookProvider(context: RequestContext, settings: Record<string, unknown>) {
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: "WEBHOOK", status: "ACTIVE", deletedAt: null, publicKey: { not: null } },
      select: { id: true, settings: true }
    });
    if (!channel) {
      throw new BadRequestException("Webhook/API channel is not active or has no public key.");
    }

    const currentSettings = asRecord(channel.settings);
    const currentWebhook = asRecord(currentSettings.webhook);
    const currentUmnico = asRecord(currentWebhook.umnico);
    const incomingWebhook = asRecord(settings.webhook);
    const incomingUmnico = isRecord(settings.umnico) ? settings.umnico : asRecord(incomingWebhook.umnico);
    const apiToken = optionalString(firstString(settings.apiToken, settings.umnicoApiToken, incomingUmnico.apiToken, incomingUmnico.token));
    const apiBase = optionalString(firstString(settings.endpointUrl, settings.umnicoApiBase, incomingUmnico.apiBase, incomingUmnico.baseUrl));
    const provider = optionalString(firstString(settings.provider, incomingWebhook.provider, incomingUmnico.provider)) ?? (apiToken || currentUmnico.apiToken ? "umnico" : firstString(currentWebhook.provider, "generic"));

    const nextUmnico: Prisma.InputJsonObject = {
      ...currentUmnico,
      ...(apiBase ? { apiBase } : {}),
      ...(apiToken ? { apiToken } : {})
    };
    const nextWebhook: Prisma.InputJsonObject = {
      ...currentWebhook,
      provider,
      ...(provider === "umnico" ? { umnico: nextUmnico } : {})
    };

    await this.prisma.channel.update({
      where: { id: channel.id },
      data: {
        settings: {
          ...currentSettings,
          webhook: nextWebhook
        }
      }
    });

    const sanitized = { ...settings };
    delete sanitized.apiToken;
    delete sanitized.umnicoApiToken;
    const tokenConfigured = Boolean(apiToken || currentUmnico.apiToken);
    return {
      ...sanitized,
      provider,
      apiTokenStatus: tokenConfigured ? "configured" : "missing",
      endpointUrl: apiBase ?? firstString(currentUmnico.apiBase, ""),
      webhook: {
        ...asRecord(sanitized.webhook),
        provider,
        ...(provider === "umnico"
          ? {
              umnico: {
                ...asRecord(asRecord(sanitized.webhook).umnico),
                ...(apiBase ? { apiBase } : {}),
                apiTokenStatus: tokenConfigured ? "configured" : "missing"
              }
            }
          : {})
      }
    };
  }

  private async findConnectedCrm(tenantId: string) {
    const integration = await this.prisma.integrationAccount.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        status: "CONNECTED",
        provider: { in: ["AMOCRM", "BITRIX24", "RETAILCRM"] }
      },
      orderBy: [{ provider: "asc" }, { connectedAt: "desc" }]
    });
    if (!integration) {
      throw new BadRequestException("Connect amoCRM, Bitrix24, or retailCRM before sending leads to CRM.");
    }
    return integration;
  }

  private adapterForProvider(provider: CrmProvider): CrmAdapter {
    switch (provider) {
      case "BITRIX24":
        return new BitrixAdapter();
      case "AMOCRM":
      case "RETAILCRM":
        return new AmoCrmAdapter();
    }
  }

  private leadFieldsForCrm(lead: LeadForCrmSync): Prisma.InputJsonObject {
    const latestConversation = lead.conversations[0];
    const fields: Prisma.InputJsonObject = {
      name: lead.name ?? "Untitled lead",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      companyName: lead.companyName ?? "",
      source: lead.source ?? "",
      channelType: lead.channelType ?? "",
      status: lead.status,
      temperature: lead.temperature,
      valueAmount: lead.valueAmount ?? 0,
      currency: lead.currency,
      interest: lead.interest ?? "",
      summary: lead.summary ?? "",
      lastMessageAt: lead.lastMessageAt?.toISOString() ?? "",
      conversationSubject: latestConversation?.subject ?? "",
      conversationStatus: latestConversation?.status ?? "",
      recentMessages:
        latestConversation?.messages.map((message) => ({
          senderType: message.senderType,
          text: message.text ?? "",
          createdAt: message.createdAt.toISOString()
        })) ?? []
    };
    return fields;
  }

  private sampleHeaders(
    channel: { settings: Prisma.JsonValue | null },
    type: "TELEGRAM" | "WEBHOOK"
  ): Record<string, string | string[] | undefined> {
    const settings = asRecord(channel.settings);
    if (type === "TELEGRAM") {
      const telegram = asRecord(settings.telegram);
      const secret = optionalString(typeof telegram.webhookSecret === "string" ? telegram.webhookSecret : undefined);
      return secret ? { "x-telegram-bot-api-secret-token": secret } : {};
    }
    const webhook = asRecord(settings.webhook);
    const secret = optionalString(firstString(webhook.secret, webhook.webhookSecret, settings.secret, settings.webhookSecret));
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
    }
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
      integration
    };
  }

  private async incrementCrmUsage(tenantId: string, syncedAt: Date) {
    await this.prisma.usageCounter.updateMany({
      where: {
        tenantId,
        periodStart: { lte: syncedAt },
        periodEnd: { gte: syncedAt }
      },
      data: { crmSyncs: { increment: 1 } }
    });
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
    inboundEndpoint: IntegrationInboundEndpoint | null = null
  ): IntegrationAccount {
    return {
      id: integration.id,
      tenantId: integration.tenantId,
      provider: integration.provider,
      status: integration.status,
      name: integration.name,
      category: integration.category,
      settings: integration.settings,
      connectedAt: integration.connectedAt?.toISOString() ?? null,
      lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      inboundEndpoint,
      recentWebhookEvents: [],
      recentSyncLogs: []
    };
  }

  private integrationSettings(
    provider: ProviderParam,
    settings: Prisma.JsonValue | null,
    channels: { id: string; type: ChannelType; publicKey: string | null; settings?: Prisma.JsonValue | null }[]
  ) {
    const base = asRecord(settings);
    if (provider !== "WEBHOOK_API") return base;

    const channel = channels.find((item) => item.type === "WEBHOOK");
    const channelSettings = asRecord(channel?.settings);
    const webhook = asRecord(channelSettings.webhook);
    const umnico = asRecord(webhook.umnico);
    const apiTokenConfigured = Boolean(umnico.apiToken);
    return {
      ...base,
      provider: firstString(webhook.provider, base.provider),
      apiTokenStatus: apiTokenConfigured ? "configured" : firstString(base.apiTokenStatus, "missing"),
      endpointUrl: firstString(umnico.apiBase, base.endpointUrl),
      webhook: {
        ...asRecord(base.webhook),
        provider: firstString(webhook.provider, asRecord(base.webhook).provider),
        ...(webhook.provider === "umnico"
          ? {
              umnico: {
                ...asRecord(asRecord(base.webhook).umnico),
                apiBase: firstString(umnico.apiBase),
                apiTokenStatus: apiTokenConfigured ? "configured" : "missing"
              }
            }
          : {})
      }
    };
  }

  private inboundEndpointForProvider(
    provider: ProviderParam,
    channels: { id: string; type: ChannelType; publicKey: string | null }[]
  ): IntegrationInboundEndpoint | null {
    if (provider === "TELEGRAM") {
      const channel = channels.find((item) => item.type === "TELEGRAM" && item.publicKey);
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
            from: { id: 555123, first_name: "Sample", last_name: "Telegram", username: "sample_client" },
            text: "I want to book an appointment from Telegram"
          }
        }
      };
    }

    if (provider === "WEBHOOK_API") {
      const channel = channels.find((item) => item.type === "WEBHOOK" && item.publicKey);
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
            email: "webhook.sample@example.com"
          },
          message: {
            id: "leadvirt-sample-message-42",
            text: "Нужна цена и запись через webhook API"
          }
        }
      };
    }

    return null;
  }

  private webhookProvidersForChannel(channel: { id: string; type: ChannelType }) {
    if (channel.type === "TELEGRAM") return ["telegram"];
    if (channel.type === "WEBHOOK") return [`webhook:${channel.id}`];
    return [];
  }

  private webhookProviderForIntegration(provider: ProviderParam, channels: { id: string; type: ChannelType }[]): string | null {
    if (provider === "TELEGRAM" && channels.some((channel) => channel.type === "TELEGRAM")) return "telegram";
    if (provider === "WEBHOOK_API") {
      const channel = channels.find((item) => item.type === "WEBHOOK");
      return channel ? `webhook:${channel.id}` : null;
    }
    return null;
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
    }[]
  ): IntegrationWebhookEventSummary[] {
    const webhookProvider = this.webhookProviderForIntegration(provider, channels);
    if (!webhookProvider) return [];
    return events
      .filter((event) => event.provider === webhookProvider)
      .slice(0, 3)
      .map((event) => ({
        id: event.id,
        provider: event.provider,
        externalEventId: event.externalEventId,
        status: event.status,
        errorMessage: event.errorMessage,
        receivedAt: event.receivedAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null
      }));
  }

  private connectionTestStatus(status: string): IntegrationTestResult["status"] {
    if (status === "CONNECTED") return "SUCCESS";
    if (status === "COMING_SOON") return "SKIPPED";
    return "FAILED";
  }

  private connectionTestMessage(name: string, status: string) {
    if (status === "CONNECTED") {
      return `${name}: локальная проверка подключения прошла успешно.`;
    }
    if (status === "COMING_SOON") {
      return `${name} is visible in the catalog but is not enabled for this MVP yet.`;
    }
    return `${name} не подключен. Подключите интеграцию перед проверкой live-трафика.`;
  }

  private async logSync(tenantId: string, integrationId: string, action: string, status: string, message: string) {
    await this.prisma.integrationSyncLog.create({
      data: { tenantId, integrationId, action, status, message }
    });
  }

  private async logAudit(context: RequestContext, action: string, entityId: string, payload: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "integration",
        entityId,
        payload
      }
    });
  }
}
