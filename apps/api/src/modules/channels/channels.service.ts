import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Channel } from "@leadvirt/types";
import type { Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { CreateChannelDto } from "./dto/create-channel.dto.js";
import type { UpdateChannelDto } from "./dto/update-channel.dto.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function publicKeyPrefix(type: CreateChannelDto["type"]) {
  if (type === "WEBSITE") return "lvw";
  if (type === "TELEGRAM") return "lvtg";
  return "lvwh";
}

function defaultName(type: CreateChannelDto["type"]) {
  if (type === "WEBSITE") return "Website widget";
  if (type === "TELEGRAM") return "Telegram";
  return "Webhook/API";
}

function endpointPath(type: CreateChannelDto["type"], publicKey: string) {
  if (type === "WEBSITE") return `/api/public/widget/${publicKey}/config`;
  if (type === "TELEGRAM") return `/api/public/channels/telegram/${publicKey}/webhook`;
  return `/api/public/channels/webhook/${publicKey}/events`;
}

function generatedSecret() {
  return randomBytes(24).toString("base64url");
}

@Injectable()
export class ChannelsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(context: RequestContext): Promise<Channel[]> {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId: context.tenantId, deletedAt: null },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });
    return channels.map((channel) => this.mapChannel(channel));
  }

  async create(context: RequestContext, dto: CreateChannelDto): Promise<Channel> {
    const existingType = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: dto.type, deletedAt: null },
      select: { id: true }
    });
    if (existingType) {
      throw new ConflictException("Channel already exists for this workspace and type.");
    }

    const publicKey = await this.resolvePublicKey(dto.type, dto.publicKey);
    const providedSettings = isRecord(dto.settings) ? dto.settings : {};
    const settings = this.defaultSettings(dto.type, publicKey, providedSettings);
    const channel = await this.prisma.channel.create({
      data: {
        tenantId: context.tenantId,
        type: dto.type,
        status: dto.status ?? "ACTIVE",
        name: dto.name?.trim() || defaultName(dto.type),
        publicKey,
        settings
      }
    });

    await Promise.all([
      this.ensureCompanionIntegration(context, dto.type, channel),
      this.prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "channel.created",
          entityType: "channel",
          entityId: channel.id,
          payload: {
            type: channel.type,
            status: channel.status,
            publicKey: channel.publicKey,
            endpointPath: endpointPath(dto.type, publicKey)
          }
        }
      })
    ]);

    return this.mapChannel(channel);
  }

  async update(context: RequestContext, id: string, dto: UpdateChannelDto): Promise<Channel> {
    const current = await this.prisma.channel.findFirst({
      where: { id, tenantId: context.tenantId, deletedAt: null }
    });
    if (!current) throw new NotFoundException("Канал не найден");

    const currentSettings = isRecord(current.settings) ? current.settings : {};
    const nextSettings = dto.settings ? { ...currentSettings, ...dto.settings } : currentSettings;
    const channel = await this.prisma.channel.update({
      where: { id: current.id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.settings ? { settings: nextSettings as Prisma.InputJsonObject } : {})
      }
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "channel.updated",
        entityType: "channel",
        entityId: channel.id,
        payload: {
          status: dto.status,
          name: dto.name,
          settingsKeys: dto.settings ? Object.keys(dto.settings) : []
        }
      }
    });

    return this.mapChannel(channel);
  }

  async prepareTelegramChannel(context: RequestContext, options: { rotateWebhookSecret?: boolean } = {}) {
    const existing = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null }
    });
    if (existing?.publicKey) {
      const settings = isRecord(existing.settings) ? existing.settings : {};
      const telegram = isRecord(settings.telegram) ? settings.telegram : {};
      const webhookSecret =
        !options.rotateWebhookSecret && typeof telegram.webhookSecret === "string" && telegram.webhookSecret.trim()
          ? telegram.webhookSecret.trim()
          : generatedSecret();
      if (telegram.webhookSecret !== webhookSecret) {
        await this.prisma.channel.update({
          where: { id: existing.id },
          data: {
            settings: {
              ...settings,
              telegram: { ...telegram, webhookPublicKey: existing.publicKey, webhookSecret }
            }
          }
        });
      }
      return {
        id: existing.id,
        publicKey: existing.publicKey,
        webhookSecret,
        encryptedCredentials: existing.encryptedCredentials
      };
    }

    const publicKey = await this.resolvePublicKey("TELEGRAM", undefined);
    const settings = this.defaultSettings("TELEGRAM", publicKey, {});
    const telegram = asRecord(asRecord(settings).telegram);
    const webhookSecret = String(telegram.webhookSecret);
    const channel = await this.prisma.channel.create({
      data: {
        tenantId: context.tenantId,
        type: "TELEGRAM",
        status: "PENDING",
        name: "Telegram",
        publicKey,
        settings
      }
    });
    return { id: channel.id, publicKey, webhookSecret, encryptedCredentials: null };
  }

  async activateTelegramChannel(
    context: RequestContext,
    input: { channelId: string; botId: number; botUsername: string; encryptedCredentials: string }
  ) {
    const current = await this.prisma.channel.findFirst({
      where: { id: input.channelId, tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null }
    });
    if (!current?.publicKey) throw new NotFoundException("Telegram channel was not found.");

    const settings = isRecord(current.settings) ? current.settings : {};
    const telegram = isRecord(settings.telegram) ? settings.telegram : {};
    const channel = await this.prisma.channel.update({
      where: { id: current.id },
      data: {
        status: "ACTIVE",
        name: `@${input.botUsername}`,
        externalId: String(input.botId),
        encryptedCredentials: input.encryptedCredentials,
        lastHealthAt: new Date(),
        settings: {
          ...settings,
          telegram: {
            ...telegram,
            webhookPublicKey: current.publicKey,
            botId: String(input.botId),
            botUsername: input.botUsername,
            webhookConfigured: true,
            autoReply: true
          }
        }
      }
    });
    await this.ensureCompanionIntegration(context, "TELEGRAM", channel);
    return this.mapChannel(channel);
  }

  async disableTelegramChannel(context: RequestContext) {
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId: context.tenantId, type: "TELEGRAM", deletedAt: null }
    });
    if (!channel) return null;
    const updated = await this.prisma.channel.update({
      where: { id: channel.id },
      data: { status: "DISABLED" }
    });
    return this.mapChannel(updated);
  }

  private async resolvePublicKey(type: CreateChannelDto["type"], requestedPublicKey: string | undefined) {
    if (requestedPublicKey) {
      const publicKey = requestedPublicKey.trim();
      if (publicKey.toLowerCase().startsWith("demo-")) {
        throw new BadRequestException("New workspace channels must not use demo public keys.");
      }
      const existing = await this.prisma.channel.findUnique({ where: { publicKey }, select: { id: true } });
      if (existing) throw new ConflictException("Channel public key is already in use.");
      return publicKey;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const publicKey = `${publicKeyPrefix(type)}_${randomBytes(8).toString("hex")}`;
      const existing = await this.prisma.channel.findUnique({ where: { publicKey }, select: { id: true } });
      if (!existing) return publicKey;
    }

    throw new ConflictException("Could not generate a unique channel public key.");
  }

  private defaultSettings(type: CreateChannelDto["type"], publicKey: string, providedSettings: Record<string, unknown>) {
    if (type === "WEBSITE") {
      const widget = isRecord(providedSettings.widget) ? providedSettings.widget : {};
      return {
        ...providedSettings,
        widget: {
          title: "LeadVirt.ai",
          subtitle: "AI administrator",
          welcomeMessage: "Hello! I am the LeadVirt.ai AI administrator. I can answer questions and pass context to the team.",
          primaryColor: "#34d399",
          accentColor: "#10b981",
          position: "bottom-right",
          locale: "ru-RU",
          suggestedReplies: ["Book a demo", "How much does it cost?", "Call a manager"],
          poweredBy: "LeadVirt.ai",
          ...widget
        }
      };
    }

    if (type === "TELEGRAM") {
      const telegram = isRecord(providedSettings.telegram) ? providedSettings.telegram : {};
      return {
        ...providedSettings,
        telegram: {
          webhookPublicKey: publicKey,
          webhookSecret: generatedSecret(),
          autoReply: true,
          ...telegram
        }
      };
    }

    const webhook = isRecord(providedSettings.webhook) ? providedSettings.webhook : {};
    return {
      ...providedSettings,
      webhook: {
        publicKey,
        secret: generatedSecret(),
        autoReply: true,
        acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"],
        ...webhook
      }
    };
  }

  private async ensureCompanionIntegration(
    context: RequestContext,
    type: CreateChannelDto["type"],
    channel: { id: string; publicKey: string | null }
  ) {
    if (type === "WEBSITE") return;

    const provider = type === "TELEGRAM" ? "TELEGRAM" : "WEBHOOK_API";
    const name = type === "TELEGRAM" ? "Telegram" : "Webhook/API";
    const category = type === "TELEGRAM" ? "Channel" : "Developers";
    const publicKey = channel.publicKey ?? "";
    const now = new Date();

    await this.prisma.integrationAccount.upsert({
      where: { tenantId_provider: { tenantId: context.tenantId, provider } },
      create: {
        tenantId: context.tenantId,
        provider,
        name,
        category,
        status: "CONNECTED",
        connectedAt: now,
        lastSyncAt: now,
        scopes: ["read", "write"],
        settings: {
          syncDirection: "inbound",
          publicKey,
          endpoint: endpointPath(type, publicKey),
          channelId: channel.id
        }
      },
      update: {
        status: "CONNECTED",
        connectedAt: now,
        lastSyncAt: now,
        settings: {
          syncDirection: "inbound",
          publicKey,
          endpoint: endpointPath(type, publicKey),
          channelId: channel.id
        }
      }
    });
  }

  private mapChannel(channel: {
    id: string;
    tenantId: string;
    type: Channel["type"];
    status: Channel["status"];
    name: string;
    publicKey: string | null;
    settings: Prisma.JsonValue | null;
    lastHealthAt: Date | null;
  }): Channel {
    const storedSettings = asRecord(channel.settings);
    const telegramSettings = asRecord(storedSettings.telegram);
    const settings =
      channel.type === "TELEGRAM"
        ? {
            ...storedSettings,
            telegram: {
              ...Object.fromEntries(Object.entries(telegramSettings).filter(([key]) => key !== "webhookSecret")),
              webhookConfigured: telegramSettings.webhookConfigured === true || typeof telegramSettings.webhookSecret === "string"
            }
          }
        : channel.settings;
    return {
      id: channel.id,
      tenantId: channel.tenantId,
      type: channel.type,
      status: channel.status,
      name: channel.name,
      publicKey: channel.publicKey,
      settings,
      lastHealthAt: channel.lastHealthAt?.toISOString() ?? null
    };
  }
}
