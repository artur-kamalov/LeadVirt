import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@leadvirt/db";
import type { IntegrationConnectionRequest, IntegrationProvider } from "@leadvirt/types";
import { isApiDeploymentPreflight } from "../../common/api-deployment-preflight.js";
import type { RequestContext } from "../../common/request-context.js";
import {
  EmailDeliveryFailure,
  EmailOtpDeliveryService,
} from "../auth/email-otp-delivery.service.js";
import { PrismaService } from "../database/prisma.service.js";

const requestableProviders = {
  WHATSAPP_BUSINESS: { name: "WhatsApp Business", category: "Channel" },
  INSTAGRAM: { name: "Instagram", category: "Channel" },
} as const;

const operationKind = "integration.connection_request.email";
const dispatchIntervalMs = 5_000;
const duplicateDeliveryWaitMs = 45_000;
const ambiguousStartedAfterMs = 90_000;
const requestRetentionMs = 2 * 365 * 24 * 60 * 60_000;

type RequestableProvider = keyof typeof requestableProviders;
type DispatchState = "sent" | "in_progress" | "rejected" | "unknown";
type TerminalDeliveryStatus = "SENT" | "FAILED" | "UNKNOWN";
type ReachableContact = {
  kind: "email" | "user_phone" | "business_phone";
  label: string;
  value: string;
};

type IntegrationRequestPayload = {
  schemaVersion: 1;
  tenantId: string;
  integrationId: string;
  provider: RequestableProvider;
  actorUserId: string;
  recipient: string;
  subject: string;
  text: string;
  referenceKey: string;
  requestedAt: string;
};

function parseRequestableProvider(provider: string): RequestableProvider {
  const normalized = provider.toUpperCase().replaceAll("-", "_");
  if (!(normalized in requestableProviders)) {
    throw new BadRequestException("This integration does not accept connection requests.");
  }
  return normalized as RequestableProvider;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integrationRequestError(
  status: number,
  code:
    | "INTEGRATION_REQUEST_CONTACT_REQUIRED"
    | "INTEGRATION_REQUEST_DELIVERY_REJECTED"
    | "INTEGRATION_REQUEST_DELIVERY_UNKNOWN",
  message: string,
  retryable: boolean,
) {
  return new HttpException({ code, message, retryable }, status);
}

function reachableUserEmail(value: unknown) {
  const email = stringValue(value)?.toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return domain === "internal" || domain.endsWith(".internal") ? null : email;
}

function reachablePhone(value: unknown) {
  const phone = stringValue(value);
  if (!phone) return null;
  const digitCount = phone.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15 ? phone : null;
}

function reachableContacts(context: RequestContext, tenantSettings: unknown) {
  const contacts: ReachableContact[] = [];
  const email = reachableUserEmail(context.user.email);
  const userPhone = reachablePhone(context.user.phone);
  const profilePhone = reachablePhone(asRecord(asRecord(tenantSettings).profile).phone);
  if (email) contacts.push({ kind: "email", label: "Requester email", value: email });
  if (userPhone) {
    contacts.push({ kind: "user_phone", label: "Requester phone", value: userPhone });
  }
  if (profilePhone && profilePhone !== userPhone) {
    contacts.push({ kind: "business_phone", label: "Business phone", value: profilePhone });
  }
  return contacts;
}

function storedRequestedAt(settings: unknown, fallback: Date) {
  const value = asRecord(settings).requestedAt;
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback.toISOString();
}

function configuredRecipient() {
  const recipient = process.env.INTEGRATION_REQUEST_EMAIL?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new ServiceUnavailableException("Integration request email is not configured.");
  }
  return recipient;
}

function deliveryPayload(value: Prisma.JsonValue | null): IntegrationRequestPayload | null {
  const payload = asRecord(value);
  const provider = stringValue(payload.provider);
  if (
    payload.schemaVersion !== 1 ||
    !stringValue(payload.tenantId) ||
    !stringValue(payload.integrationId) ||
    !provider ||
    !(provider in requestableProviders) ||
    !stringValue(payload.actorUserId) ||
    !stringValue(payload.recipient) ||
    !stringValue(payload.subject) ||
    !stringValue(payload.text) ||
    !stringValue(payload.referenceKey) ||
    !stringValue(payload.requestedAt)
  ) {
    return null;
  }
  return payload as IntegrationRequestPayload;
}

function errorDetails(error: unknown) {
  return {
    code: error instanceof Error ? error.name : "INTEGRATION_REQUEST_DELIVERY_FAILED",
    message:
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Integration request delivery failed.",
  };
}

function terminalEvidence(
  payload: IntegrationRequestPayload,
  deliveryStatus: TerminalDeliveryStatus,
  changedAt: Date,
  providerMessageId?: string,
) {
  return {
    schemaVersion: payload.schemaVersion,
    tenantId: payload.tenantId,
    integrationId: payload.integrationId,
    provider: payload.provider,
    actorUserId: payload.actorUserId,
    referenceKey: payload.referenceKey,
    requestedAt: payload.requestedAt,
    deliveryStatus,
    deliveryChangedAt: changedAt.toISOString(),
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

function invalidTerminalEvidence(deliveryStatus: "FAILED" | "UNKNOWN", changedAt: Date) {
  return {
    schemaVersion: 1,
    deliveryStatus,
    deliveryChangedAt: changedAt.toISOString(),
    evidenceCode: "INTEGRATION_REQUEST_PAYLOAD_INVALID",
  };
}

@Injectable()
export class IntegrationRequestsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailOtpDeliveryService) private readonly emailDelivery: EmailOtpDeliveryService,
  ) {}

  onModuleInit() {
    if (isApiDeploymentPreflight()) return;
    this.timer = setInterval(() => void this.drain().catch(() => undefined), dispatchIntervalMs);
    this.timer.unref();
    void this.drain().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async request(
    context: RequestContext,
    provider: string,
  ): Promise<IntegrationConnectionRequest> {
    const parsedProvider = parseRequestableProvider(provider);
    const recipient = configuredRecipient();
    this.emailDelivery.requireOperationalEmailDelivery(recipient);
    const catalog = requestableProviders[parsedProvider];

    const persisted = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockProvider(transaction, context.tenantId, parsedProvider);
        const existing = await transaction.integrationAccount.findUnique({
          where: {
            tenantId_provider: { tenantId: context.tenantId, provider: parsedProvider },
          },
        });
        const existingSettings = asRecord(existing?.settings);
        if (
          (existingSettings.requestStatus === "REQUESTED" ||
            existingSettings.requestStatus === "DELIVERY_UNKNOWN") &&
          existing
        ) {
          const requestId = stringValue(existingSettings.requestId);
          const operation = requestId
            ? await transaction.externalOperation.findFirst({
                where: {
                  id: requestId,
                  tenantId: context.tenantId,
                  integrationId: existing.id,
                  operationKind,
                },
              })
            : null;
          const evidence = asRecord(operation?.result);
          const referenceKey = requestId ? `integration-request:${requestId}` : null;
          const operationMatches = Boolean(
            operation &&
              referenceKey &&
              operation.providerIdempotencyKey === referenceKey &&
              evidence.tenantId === context.tenantId &&
              evidence.integrationId === existing.id &&
              evidence.provider === parsedProvider &&
              evidence.referenceKey === referenceKey &&
              ["REQUESTED", "STARTED", "SUCCEEDED", "UNKNOWN"].includes(operation.status),
          );
          const requestedAt = operationMatches
            ? storedRequestedAt(operation?.result, operation!.createdAt)
            : storedRequestedAt(existing.settings, existing.updatedAt);
          if (!operationMatches || !requestId || !operation) {
            const changedAt = new Date();
            await transaction.integrationAccount.update({
              where: { id: existing.id },
              data: {
                deletedAt: null,
                settings: {
                  ...existingSettings,
                  requestStatus: "DELIVERY_UNKNOWN",
                  requestDeliveryStatus: "UNKNOWN",
                  requestDeliveryChangedAt: changedAt.toISOString(),
                },
              },
            });
            await transaction.auditLog.create({
              data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                action: "integration.connection_request_projection_repaired",
                entityType: "integration_request",
                entityId: requestId ?? existing.id,
                payload: {
                  provider: parsedProvider,
                  integrationId: existing.id,
                  reason: requestId ? "EXTERNAL_OPERATION_MISMATCH" : "REQUEST_ID_MISSING",
                },
                createdAt: changedAt,
              },
            });
            return {
              operationId: null,
              deliveryUnknown: true,
              request: this.toRequest(requestId ?? existing.id, parsedProvider, requestedAt),
            };
          }

          const projectedRequestStatus =
            operation.status === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "REQUESTED";
          const projectedDeliveryStatus =
            operation.status === "SUCCEEDED"
              ? "SENT"
              : operation.status === "UNKNOWN"
                ? "UNKNOWN"
                : "PENDING";
          if (
            existing.deletedAt ||
            existingSettings.requestStatus !== projectedRequestStatus ||
            existingSettings.requestDeliveryStatus !== projectedDeliveryStatus ||
            existingSettings.requestedAt !== requestedAt
          ) {
            await transaction.integrationAccount.update({
              where: { id: existing.id },
              data: {
                deletedAt: null,
                settings: {
                  ...existingSettings,
                  requestStatus: projectedRequestStatus,
                  requestDeliveryStatus: projectedDeliveryStatus,
                  requestId,
                  requestedAt,
                },
              },
            });
          }
          return {
            operationId: requestId,
            deliveryUnknown: false,
            request: this.toRequest(requestId, parsedProvider, requestedAt),
          };
        }

        const tenant = await transaction.tenant.findUnique({
          where: { id: context.tenantId },
          select: { settings: true },
        });
        if (!tenant) throw new ServiceUnavailableException("Workspace is temporarily unavailable.");
        const contacts = reachableContacts(context, tenant.settings);
        if (contacts.length === 0) {
          throw integrationRequestError(
            HttpStatus.BAD_REQUEST,
            "INTEGRATION_REQUEST_CONTACT_REQUIRED",
            "Add a reachable email address or phone number before requesting this integration.",
            false,
          );
        }

        const requestId = randomUUID();
        const requestedAt = new Date();
        const referenceKey = `integration-request:${requestId}`;
        const lines = [
          "A workspace requested a managed integration connection.",
          `Integration: ${catalog.name} (${parsedProvider})`,
          `Workspace: ${context.tenant.name} (${context.tenant.slug})`,
          `Tenant ID: ${context.tenantId}`,
          `Request ID: ${requestId}`,
          `Actor user ID: ${context.userId}`,
        ];
        if (context.user.name?.trim()) lines.push(`Requester: ${context.user.name.trim()}`);
        for (const contact of contacts) lines.push(`${contact.label}: ${contact.value}`);
        lines.push(`Requested at: ${requestedAt.toISOString()}`);
        const settings = {
          ...existingSettings,
          requestStatus: "REQUESTED",
          requestDeliveryStatus: "PENDING",
          requestId,
          requestedAt: requestedAt.toISOString(),
        };
        const account = await transaction.integrationAccount.upsert({
          where: { tenantId_provider: { tenantId: context.tenantId, provider: parsedProvider } },
          create: {
            tenantId: context.tenantId,
            provider: parsedProvider,
            name: catalog.name,
            category: catalog.category,
            status: "PENDING",
            settings,
          },
          update: {
            deletedAt: null,
            settings,
          },
        });
        const payload: IntegrationRequestPayload = {
          schemaVersion: 1,
          tenantId: context.tenantId,
          integrationId: account.id,
          provider: parsedProvider,
          actorUserId: context.userId,
          recipient,
          subject: `LeadVirt.ai integration request: ${catalog.name}`,
          text: lines.join("\n"),
          referenceKey,
          requestedAt: requestedAt.toISOString(),
        };
        const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        await transaction.externalOperation.create({
          data: {
            id: requestId,
            tenantId: context.tenantId,
            integrationId: account.id,
            operationKind,
            requestHash,
            status: "REQUESTED",
            providerIdempotencyKey: referenceKey,
            result: payload,
            retentionExpiresAt: new Date(requestedAt.getTime() + requestRetentionMs),
          },
        });
        await transaction.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "integration.connection_request_queued",
            entityType: "integration_request",
            entityId: requestId,
            payload: {
              provider: parsedProvider,
              integrationId: account.id,
              referenceKey,
              requestedAt: requestedAt.toISOString(),
            },
            createdAt: requestedAt,
          },
        });
        return {
          operationId: requestId,
          deliveryUnknown: false,
          request: this.toRequest(requestId, parsedProvider, requestedAt),
        };
      },
      { maxWait: 20_000, timeout: 20_000 },
    );

    if (persisted.deliveryUnknown) {
      throw integrationRequestError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "INTEGRATION_REQUEST_DELIVERY_UNKNOWN",
        "Integration request delivery could not be confirmed. Do not submit it again.",
        false,
      );
    }
    if (persisted.operationId) await this.requireDelivery(persisted.operationId);
    return persisted.request;
  }

  private async requireDelivery(operationId: string) {
    let state = await this.dispatch(operationId);
    if (state === "in_progress") state = await this.waitForDelivery(operationId);
    if (state === "sent") return;
    if (state === "rejected") {
      throw integrationRequestError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "INTEGRATION_REQUEST_DELIVERY_REJECTED",
        "Integration request email was rejected. Please try again later.",
        true,
      );
    }
    throw integrationRequestError(
      HttpStatus.SERVICE_UNAVAILABLE,
      "INTEGRATION_REQUEST_DELIVERY_UNKNOWN",
      "Integration request delivery could not be confirmed. Do not submit it again.",
      false,
    );
  }

  private async dispatch(operationId: string): Promise<DispatchState> {
    const startedAt = new Date();
    const claimed = await this.prisma.externalOperation.updateMany({
      where: { id: operationId, operationKind, status: "REQUESTED" },
      data: {
        status: "STARTED",
        attemptCount: { increment: 1 },
        startedAt,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claimed.count === 0) return this.operationState(operationId);

    const operation = await this.prisma.externalOperation.findFirst({
      where: { id: operationId, operationKind },
    });
    const payload = operation ? deliveryPayload(operation.result) : null;
    if (!operation || !payload) {
      await this.markDeliveryFailure(
        operationId,
        null,
        "rejected",
        "INTEGRATION_REQUEST_PAYLOAD_INVALID",
        "Integration request delivery payload is invalid.",
      );
      return "rejected";
    }

    let providerMessageId: string;
    try {
      const delivery = await this.emailDelivery.sendOperationalEmail({
        email: payload.recipient,
        subject: payload.subject,
        text: payload.text,
        referenceKey: payload.referenceKey,
        purpose: "integration_connection_request",
      });
      providerMessageId = delivery.providerMessageId;
    } catch (error) {
      const outcome = error instanceof EmailDeliveryFailure ? error.outcome : "unknown";
      const details = errorDetails(error);
      await this.markDeliveryFailure(
        operationId,
        payload,
        outcome,
        details.code,
        details.message,
      );
      return outcome;
    }

    try {
      await this.finalizeDelivery(operationId, payload, providerMessageId);
      return "sent";
    } catch (error) {
      const details = errorDetails(error);
      await this.markDeliveryFailure(
        operationId,
        payload,
        "unknown",
        "POST_DELIVERY_PERSISTENCE_UNKNOWN",
        details.message,
        providerMessageId,
      ).catch(() => undefined);
      return "unknown";
    }
  }

  private async finalizeDelivery(
    operationId: string,
    payload: IntegrationRequestPayload,
    providerMessageId: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockProvider(transaction, payload.tenantId, payload.provider);
      const completedAt = new Date();
      const completed = await transaction.externalOperation.updateMany({
        where: { id: operationId, operationKind, status: "STARTED" },
        data: {
          status: "SUCCEEDED",
          externalReference: providerMessageId,
          result: terminalEvidence(payload, "SENT", completedAt, providerMessageId),
          completedAt,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (completed.count !== 1) {
        throw new Error("Integration request delivery state changed before finalization.");
      }
      await this.updateAccountDelivery(transaction, payload, "SENT", completedAt);
      await transaction.auditLog.create({
        data: {
          tenantId: payload.tenantId,
          actorUserId: payload.actorUserId,
          action: "integration.connection_requested",
          entityType: "integration_request",
          entityId: operationId,
          payload: {
            provider: payload.provider,
            integrationId: payload.integrationId,
            requestedAt: payload.requestedAt,
            deliveredAt: completedAt.toISOString(),
            operatorDeliveryMessageId: providerMessageId,
          },
          createdAt: completedAt,
        },
      });
    });
  }

  private async markDeliveryFailure(
    operationId: string,
    payload: IntegrationRequestPayload | null,
    outcome: "rejected" | "unknown",
    errorCode: string,
    errorMessage: string,
    providerMessageId?: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      if (payload) await this.lockProvider(transaction, payload.tenantId, payload.provider);
      const completedAt = new Date();
      const deliveryStatus = outcome === "rejected" ? "FAILED" : "UNKNOWN";
      const changed = await transaction.externalOperation.updateMany({
        where: { id: operationId, operationKind, status: "STARTED" },
        data: {
          status: outcome === "rejected" ? "FAILED" : "UNKNOWN",
          ...(providerMessageId ? { externalReference: providerMessageId } : {}),
          result: payload
            ? terminalEvidence(payload, deliveryStatus, completedAt, providerMessageId)
            : invalidTerminalEvidence(deliveryStatus, completedAt),
          completedAt,
          errorCode,
          errorMessage: errorMessage.slice(0, 500),
        },
      });
      if (changed.count !== 1) {
        if (payload && providerMessageId && outcome === "unknown") {
          await transaction.externalOperation.updateMany({
            where: { id: operationId, operationKind, status: "UNKNOWN" },
            data: {
              externalReference: providerMessageId,
              result: terminalEvidence(payload, "UNKNOWN", completedAt, providerMessageId),
              errorCode,
              errorMessage: errorMessage.slice(0, 500),
            },
          });
        }
        return;
      }
      if (!payload) return;
      await this.updateAccountDelivery(
        transaction,
        payload,
        deliveryStatus,
        completedAt,
      );
      await transaction.auditLog.create({
        data: {
          tenantId: payload.tenantId,
          actorUserId: payload.actorUserId,
          action:
            outcome === "rejected"
              ? "integration.connection_request_delivery_failed"
              : "integration.connection_request_delivery_unknown",
          entityType: "integration_request",
          entityId: operationId,
          payload: {
            provider: payload.provider,
            integrationId: payload.integrationId,
            requestedAt: payload.requestedAt,
            errorCode,
          },
          createdAt: completedAt,
        },
      });
    });
  }

  private async updateAccountDelivery(
    transaction: Prisma.TransactionClient,
    payload: IntegrationRequestPayload,
    deliveryStatus: "SENT" | "FAILED" | "UNKNOWN",
    changedAt: Date,
  ) {
    const account = await transaction.integrationAccount.findUnique({
      where: {
        tenantId_provider: { tenantId: payload.tenantId, provider: payload.provider },
      },
    });
    const settings = asRecord(account?.settings);
    if (!account || settings.requestId !== payload.referenceKey.replace("integration-request:", "")) {
      return;
    }
    await transaction.integrationAccount.update({
      where: { id: account.id },
      data: {
        settings: {
          ...settings,
          requestStatus:
            deliveryStatus === "FAILED"
              ? "FAILED"
              : deliveryStatus === "UNKNOWN"
                ? "DELIVERY_UNKNOWN"
                : "REQUESTED",
          requestDeliveryStatus: deliveryStatus,
          requestDeliveryChangedAt: changedAt.toISOString(),
        },
      },
    });
  }

  private async waitForDelivery(operationId: string): Promise<DispatchState> {
    const attempts = Math.ceil(duplicateDeliveryWaitMs / 250);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const state = await this.operationState(operationId);
      if (state !== "in_progress") return state;
    }
    const operation = await this.prisma.externalOperation.findFirst({
      where: { id: operationId, operationKind, status: "STARTED" },
    });
    if (!operation) return this.operationState(operationId);
    await this.markDeliveryFailure(
      operationId,
      deliveryPayload(operation.result),
      "unknown",
      "INTEGRATION_REQUEST_DELIVERY_WAIT_TIMEOUT",
      "Delivery remained in progress beyond the synchronous request wait window.",
    );
    return this.operationState(operationId);
  }

  private async operationState(operationId: string): Promise<DispatchState> {
    const operation = await this.prisma.externalOperation.findFirst({
      where: { id: operationId, operationKind },
      select: { status: true },
    });
    if (!operation) return "unknown";
    if (operation.status === "SUCCEEDED") return "sent";
    if (operation.status === "FAILED") return "rejected";
    if (operation.status === "UNKNOWN") return "unknown";
    return operation.status === "REQUESTED" || operation.status === "STARTED"
      ? "in_progress"
      : "unknown";
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const stale = await this.prisma.externalOperation.findMany({
        where: {
          operationKind,
          status: "STARTED",
          startedAt: { lte: new Date(Date.now() - ambiguousStartedAfterMs) },
        },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const operation of stale) {
        await this.markDeliveryFailure(
          operation.id,
          deliveryPayload(operation.result),
          "unknown",
          "INTEGRATION_REQUEST_DELIVERY_OUTCOME_UNKNOWN",
          "The delivery worker stopped after claiming this request.",
        ).catch(() => undefined);
      }
      const pending = await this.prisma.externalOperation.findMany({
        where: { operationKind, status: "REQUESTED" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const operation of pending) await this.dispatch(operation.id).catch(() => undefined);
    } finally {
      this.draining = false;
    }
  }

  private lockProvider(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    provider: RequestableProvider,
  ) {
    const lockKey = `integration-request:${tenantId}:${provider}`;
    return transaction.$queryRaw(Prisma.sql`
      SELECT TRUE AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS advisory_lock
    `);
  }

  private toRequest(id: string, provider: IntegrationProvider, requestedAt: Date | string) {
    return {
      id,
      provider,
      status: "REQUESTED" as const,
      requestedAt: typeof requestedAt === "string" ? requestedAt : requestedAt.toISOString(),
    };
  }
}
