import { AsyncLocalStorage } from "node:async_hooks";
import { HttpException } from "@nestjs/common";
import {
  EmailAdapter,
  GoogleCalendarAdapter,
  IntegrationAdapterUnavailableError,
} from "@leadvirt/integrations";
import type { RequestContext } from "../../apps/api/src/common/request-context.js";
import {
  EmailDeliveryFailure,
  type EmailOtpDeliveryService,
} from "../../apps/api/src/modules/auth/email-otp-delivery.service.js";
import type { ChannelsService } from "../../apps/api/src/modules/channels/channels.service.js";
import type { PrismaService } from "../../apps/api/src/modules/database/prisma.service.js";
import { IntegrationRequestsService } from "../../apps/api/src/modules/integrations/integration-requests.service.js";
import { IntegrationsService } from "../../apps/api/src/modules/integrations/integrations.service.js";
import type { TelegramBotApiService } from "../../apps/api/src/modules/telegram/telegram-bot-api.service.js";
import type { TelegramService } from "../../apps/api/src/modules/telegram/telegram.service.js";
import type { WebhookService } from "../../apps/api/src/modules/webhook/webhook.service.js";

const unavailableProviders = [
  { provider: "AMOCRM", capability: "CRM" },
  { provider: "BITRIX24", capability: "CRM" },
  { provider: "RETAILCRM", capability: "CRM" },
  { provider: "WHATSAPP_BUSINESS", capability: "SOCIAL_CHANNEL" },
  { provider: "INSTAGRAM", capability: "SOCIAL_CHANNEL" },
  { provider: "VK", capability: "SOCIAL_CHANNEL" },
  { provider: "EMAIL", capability: "EMAIL_CHANNEL" },
  { provider: "GOOGLE_CALENDAR", capability: "CALENDAR" },
  { provider: "SHOPIFY", capability: "ECOMMERCE" },
  { provider: "SHOP_SCRIPT", capability: "ECOMMERCE" },
  { provider: "OTHER", capability: "CUSTOM" },
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpErrorRecord(error: unknown) {
  if (!(error instanceof HttpException)) return {};
  const response = error.getResponse();
  return isRecord(response) ? response : {};
}

const context: RequestContext = {
  tenantId: "tenant-crm-truthful-state",
  userId: "user-crm-truthful-state",
  role: "OWNER",
  authMode: "credentials",
  tenant: {
    id: "tenant-crm-truthful-state",
    name: "CRM Truthful State",
    slug: "crm-truthful-state",
    status: "ACTIVE",
    businessType: null,
    timezone: "UTC",
  },
  user: {
    id: "user-crm-truthful-state",
    email: "telegram-314159@telegram.leadvirt.internal",
    phone: null,
    name: "CRM Truthful State",
    avatarUrl: null,
    passwordChangeRequired: false,
  },
};

function createService(prisma: PrismaService, webhookService = {} as WebhookService) {
  return new IntegrationsService(
    prisma,
    {} as ChannelsService,
    {} as TelegramBotApiService,
    {} as TelegramService,
    webhookService,
  );
}

async function expectUnavailable(
  operation: () => Promise<unknown>,
  capability: string,
  provider?: string,
) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof HttpException,
      "Unavailable boundary did not return an HTTP exception.",
    );
    assert(
      error.getStatus() === 501,
      `Unavailable boundary returned HTTP ${error.getStatus()} instead of 501.`,
    );
    const response = error.getResponse();
    assert(isRecord(response), "Unavailable boundary returned an invalid error response.");
    assert(
      response.code === "INTEGRATION_NOT_AVAILABLE",
      "Unavailable boundary returned the wrong stable error code.",
    );
    assert(response.retryable === false, "Unavailable errors must not be marked retryable.");
    assert(
      typeof response.message === "string" &&
        response.message.includes("live provider implementation"),
      "Unavailable boundary did not explain why the integration is unavailable.",
    );
    assert(isRecord(response.details), "Unavailable boundary omitted structured error details.");
    assert(
      response.details.capability === capability,
      "Unavailable boundary returned the wrong capability.",
    );
    if (provider) {
      assert(
        response.details.provider === provider,
        "Unavailable boundary returned the wrong provider.",
      );
    } else {
      assert(response.details.provider === undefined, "Generic CRM sync exposed a fake provider.");
    }
    return;
  }
  throw new Error("Unavailable boundary unexpectedly succeeded.");
}

async function expectAdapterUnavailable(
  operation: () => Promise<unknown>,
  provider: string,
  adapterOperation: string,
) {
  try {
    await operation();
  } catch (error) {
    assert(
      error instanceof IntegrationAdapterUnavailableError,
      `${provider} adapter returned the wrong error type.`,
    );
    assert(error.code === "INTEGRATION_ADAPTER_NOT_AVAILABLE", "Adapter error code changed.");
    assert(error.retryable === false, "Unavailable adapter error became retryable.");
    assert(error.provider === provider, "Unavailable adapter returned the wrong provider.");
    assert(
      error.operation === adapterOperation,
      "Unavailable adapter returned the wrong operation.",
    );
    return;
  }
  throw new Error(`${provider} adapter fabricated a successful operation.`);
}

async function main() {
  const databaseAccesses: string[] = [];
  const unavailablePrisma = new Proxy(
    {},
    {
      get(_target, property) {
        databaseAccesses.push(String(property));
        throw new Error(`Unexpected database access: ${String(property)}`);
      },
    },
  ) as PrismaService;
  const service = createService(unavailablePrisma);

  for (const { provider, capability } of unavailableProviders) {
    await expectUnavailable(() => service.connect(context, provider), capability, provider);
    await expectUnavailable(() => service.disconnect(context, provider), capability, provider);
    await expectUnavailable(
      () => service.updateSettings(context, provider, { settings: { apiToken: "must-not-save" } }),
      capability,
      provider,
    );
    await expectUnavailable(() => service.testConnection(context, provider), capability, provider);
    await expectUnavailable(
      () => service.sendSampleInbound(context, provider),
      capability,
      provider,
    );
  }
  await expectUnavailable(() => service.syncLeadToCrm(context, null as never), "CRM");
  assert(
    databaseAccesses.length === 0,
    "An unavailable integration operation touched persistence.",
  );

  type StoredAccount = {
    id: string;
    settings: Record<string, unknown>;
    status: string;
    connectedAt: Date | null;
    lastSyncAt: Date | null;
    updatedAt: Date;
  };
  type StoredOperation = {
    id: string;
    tenantId: string;
    integrationId: string;
    operationKind: string;
    requestHash: string;
    providerIdempotencyKey: string;
    status: string;
    result: Record<string, unknown>;
    attemptCount: number;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    externalReference: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  let storedAccount: StoredAccount = {
    id: "integration-whatsapp-request",
    settings: { legacyMarker: "keep" },
    status: "DISCONNECTED",
    connectedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSyncAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  };
  const storedOperations = new Map<string, StoredOperation>();
  const auditActions: string[] = [];
  const integrationRequestReferences: string[] = [];
  const integrationRequestTexts: string[] = [];
  let integrationRequestEmails = 0;
  let integrationRequestPurpose = "";
  let tenantSettings: Record<string, unknown> = { profile: {} };
  const transactionScope = new AsyncLocalStorage<boolean>();
  let transactionCount = 0;
  let failFinalizeOnce = false;
  let deliveryOutcome: "sent" | "rejected" | "unclassified" = "sent";
  let tenantScopedProjectionReads = 0;
  let transactionTail = Promise.resolve();

  const externalOperation = {
    create: (args: {
      data: {
        id: string;
        tenantId: string;
        integrationId: string;
        operationKind: string;
        requestHash: string;
        providerIdempotencyKey: string;
        status: string;
        result: Record<string, unknown>;
      };
    }) => {
      const operation: StoredOperation = {
        id: args.data.id,
        tenantId: args.data.tenantId,
        integrationId: args.data.integrationId,
        operationKind: args.data.operationKind,
        requestHash: args.data.requestHash,
        providerIdempotencyKey: args.data.providerIdempotencyKey,
        status: args.data.status,
        result: args.data.result,
        attemptCount: 0,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        externalReference: null,
        errorCode: null,
        errorMessage: null,
      };
      storedOperations.set(operation.id, operation);
      return Promise.resolve(operation);
    },
    updateMany: (args: {
      where: { id: string; operationKind: string; status: string };
      data: {
        status?: string;
        attemptCount?: { increment: number };
        startedAt?: Date;
        completedAt?: Date;
        result?: Record<string, unknown>;
        externalReference?: string;
        errorCode?: string | null;
        errorMessage?: string | null;
      };
    }) => {
      const operation = storedOperations.get(args.where.id);
      if (
        !operation ||
        operation.operationKind !== args.where.operationKind ||
        operation.status !== args.where.status
      ) {
        return Promise.resolve({ count: 0 });
      }
      if (args.data.status === "SUCCEEDED" && failFinalizeOnce) {
        failFinalizeOnce = false;
        throw new Error("simulated post-delivery persistence failure");
      }
      if (args.data.status !== undefined) operation.status = args.data.status;
      if (args.data.attemptCount) operation.attemptCount += args.data.attemptCount.increment;
      if (args.data.startedAt) operation.startedAt = args.data.startedAt;
      if (args.data.completedAt) operation.completedAt = args.data.completedAt;
      if (args.data.result) operation.result = args.data.result;
      if (args.data.externalReference) operation.externalReference = args.data.externalReference;
      if (args.data.errorCode !== undefined) operation.errorCode = args.data.errorCode;
      if (args.data.errorMessage !== undefined) operation.errorMessage = args.data.errorMessage;
      return Promise.resolve({ count: 1 });
    },
    findFirst: (args: {
      where: {
        id: string;
        operationKind: string;
        tenantId?: string;
        integrationId?: string;
        status?: string;
      };
      select?: { status: true };
    }) => {
      const operation = storedOperations.get(args.where.id);
      if (
        !operation ||
        operation.operationKind !== args.where.operationKind ||
        (args.where.status !== undefined && operation.status !== args.where.status) ||
        (args.where.tenantId !== undefined && operation.tenantId !== args.where.tenantId) ||
        (args.where.integrationId !== undefined &&
          operation.integrationId !== args.where.integrationId)
      ) {
        return Promise.resolve(null);
      }
      if (args.where.tenantId && args.where.integrationId) tenantScopedProjectionReads += 1;
      return Promise.resolve(args.select ? { status: operation.status } : operation);
    },
  };
  const requestTransaction = {
    $queryRaw: () => Promise.resolve([{ locked: true }]),
    tenant: {
      findUnique: (args: { where: { id: string } }) => {
        assert(args.where.id === context.tenantId, "Request loaded another tenant's profile.");
        return Promise.resolve({ settings: tenantSettings });
      },
    },
    integrationAccount: {
      findUnique: () => Promise.resolve(storedAccount),
      upsert: (args: {
        update: {
          settings: Record<string, unknown>;
          status?: string;
          connectedAt?: Date | null;
          lastSyncAt?: Date | null;
        };
      }) => {
        assert(args.update.status === undefined, "A request reset the integration status.");
        assert(args.update.connectedAt === undefined, "A request reset connectedAt.");
        assert(args.update.lastSyncAt === undefined, "A request reset lastSyncAt.");
        storedAccount = {
          ...storedAccount,
          settings: args.update.settings,
          updatedAt: new Date(),
        };
        return Promise.resolve(storedAccount);
      },
      update: (args: { data: { settings: Record<string, unknown>; deletedAt?: null } }) => {
        storedAccount = {
          ...storedAccount,
          settings: args.data.settings,
          updatedAt: new Date(),
        };
        return Promise.resolve(storedAccount);
      },
    },
    externalOperation,
    auditLog: {
      create: (args: { data: { action: string } }) => {
        auditActions.push(args.data.action);
        return Promise.resolve({ id: `audit-whatsapp-request-${auditActions.length}` });
      },
    },
  };
  const requestPrisma = {
    externalOperation,
    $transaction: (operation: (transaction: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      const result = transactionTail.then(async () => {
        return transactionScope.run(true, () => operation(requestTransaction));
      });
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  } as unknown as PrismaService;
  const requestEmail = {
    requireOperationalEmailDelivery: (email: string) => {
      assert(email === "ops@leadvirt.test", "Request did not use the explicit operator email.");
      return { mode: "mock", recipient: email };
    },
    sendOperationalEmail: (input: { purpose: string; referenceKey: string; text: string }) => {
      assert(
        transactionScope.getStore() !== true,
        "Request email was sent inside a database transaction.",
      );
      integrationRequestEmails += 1;
      integrationRequestPurpose = input.purpose;
      integrationRequestReferences.push(input.referenceKey);
      integrationRequestTexts.push(input.text);
      assert(input.text.includes("WhatsApp Business"), "Request email omitted the provider.");
      assert(input.text.includes(context.tenantId), "Request email omitted the tenant.");
      if (deliveryOutcome === "rejected") {
        throw new EmailDeliveryFailure("rejected");
      }
      if (deliveryOutcome === "unclassified") {
        throw new Error("unclassified provider boundary failure");
      }
      return Promise.resolve({ providerMessageId: `integration-request-${integrationRequestEmails}` });
    },
  } as unknown as EmailOtpDeliveryService;
  const requestService = new IntegrationRequestsService(requestPrisma, requestEmail);
  const previousRequestEmail = process.env.INTEGRATION_REQUEST_EMAIL;
  delete process.env.INTEGRATION_REQUEST_EMAIL;
  const transactionsBeforeMissingConfig = transactionCount;
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("A missing integration request recipient was accepted.");
  } catch (error) {
    assert(
      error instanceof HttpException && error.getStatus() === 503,
      "A missing integration request recipient did not fail closed.",
    );
  }
  assert(
    transactionCount === transactionsBeforeMissingConfig,
    "A missing integration request recipient touched persistence.",
  );
  process.env.INTEGRATION_REQUEST_EMAIL = "ops@leadvirt.test";

  const operationsBeforeMissingContact = storedOperations.size;
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("A request without a reachable contact was accepted.");
  } catch (error) {
    const response = httpErrorRecord(error);
    assert(
      error instanceof HttpException &&
        error.getStatus() === 400 &&
        response.code === "INTEGRATION_REQUEST_CONTACT_REQUIRED" &&
        response.retryable === false,
      "A missing reachable contact did not return the structured fail-closed error.",
    );
  }
  assert(
    storedOperations.size === operationsBeforeMissingContact && integrationRequestEmails === 0,
    "A request without a reachable contact was queued or delivered.",
  );
  tenantSettings = { profile: { phone: "+33123456789" } };

  const [firstRequest, repeatedRequest] = await Promise.all([
    requestService.request(context, "WHATSAPP_BUSINESS"),
    requestService.request(context, "WHATSAPP_BUSINESS"),
  ]);
  assert(firstRequest.status === "REQUESTED", "Connection request did not return REQUESTED.");
  assert(
    repeatedRequest.id === firstRequest.id,
    "A repeated connection request did not return the durable request.",
  );
  assert(integrationRequestEmails === 1, "A repeated connection request sent duplicate email.");
  assert(
    integrationRequestTexts[0]?.includes("Business phone: +33123456789") &&
      !integrationRequestTexts[0]?.includes("telegram.leadvirt.internal"),
    "The operator email did not use the reachable business contact or exposed an internal email.",
  );
  assert(tenantScopedProjectionReads > 0, "A repeated request did not validate tenant ownership.");
  assert(
    auditActions.filter((action) => action === "integration.connection_request_queued").length === 1 &&
      auditActions.filter((action) => action === "integration.connection_requested").length === 1,
    "A durable request did not preserve queued and delivered history.",
  );
  assert(storedAccount.settings.legacyMarker === "keep", "A request erased existing settings.");
  assert(storedAccount.status === "DISCONNECTED", "A request changed the integration status.");
  assert(
    storedAccount.connectedAt?.toISOString() === "2026-01-01T00:00:00.000Z",
    "A request erased connectedAt.",
  );
  assert(
    integrationRequestReferences[0] === `integration-request:${firstRequest.id}`,
    "Connection request did not use its persisted lifecycle reference.",
  );
  assert(
    integrationRequestPurpose === "integration_connection_request",
    "Connection request used the wrong email purpose.",
  );
  const firstOperation = storedOperations.get(firstRequest.id);
  assert(
    firstOperation?.status === "SUCCEEDED" &&
      firstOperation.externalReference === "integration-request-1" &&
      !Object.hasOwn(firstOperation.result, "recipient") &&
      !Object.hasOwn(firstOperation.result, "text") &&
      !JSON.stringify(firstOperation.result).includes("+33123456789"),
    "A successful request did not retain sanitized delivery evidence.",
  );

  storedAccount.settings = { ...storedAccount.settings, requestStatus: "FULFILLED" };
  tenantSettings = { profile: {} };
  context.user.phone = "+33612345678";
  deliveryOutcome = "rejected";
  const rejected = await Promise.allSettled([
    requestService.request(context, "WHATSAPP_BUSINESS"),
    requestService.request(context, "WHATSAPP_BUSINESS"),
  ]);
  assert(
    rejected.every(
      (result) => {
        if (result.status !== "rejected" || !(result.reason instanceof HttpException)) return false;
        const response = httpErrorRecord(result.reason);
        return (
          result.reason.getStatus() === 503 &&
          response.code === "INTEGRATION_REQUEST_DELIVERY_REJECTED" &&
          response.retryable === true
        );
      },
    ),
    "A provider rejection or rate limit was falsely confirmed.",
  );
  assert(integrationRequestEmails === 2, "Concurrent rejected requests sent duplicate email.");
  assert(
    integrationRequestTexts.at(-1)?.includes("Requester phone: +33612345678"),
    "The operator email did not include the reachable user phone.",
  );
  const rejectedRequestId = textValue(storedAccount.settings.requestId);
  assert(rejectedRequestId, "Rejected request lost its persisted lifecycle id.");
  assert(
    storedOperations.get(rejectedRequestId)?.status === "FAILED" &&
      storedAccount.settings.requestStatus === "FAILED",
    "A provider rejection did not persist a retryable failed lifecycle.",
  );
  const rejectedOperation = storedOperations.get(rejectedRequestId);
  assert(
    rejectedOperation !== undefined &&
      !Object.hasOwn(rejectedOperation.result, "recipient") &&
      !Object.hasOwn(rejectedOperation.result, "text") &&
      !JSON.stringify(rejectedOperation.result).includes("+33612345678"),
    "A rejected request retained operator-recipient or requester PII.",
  );

  context.user.phone = null;
  context.user.email = "owner@example.com";
  deliveryOutcome = "unclassified";
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("An unclassified delivery failure was accepted or made retryable.");
  } catch (error) {
    const response = httpErrorRecord(error);
    assert(
      error instanceof HttpException &&
        error.getStatus() === 503 &&
        response.code === "INTEGRATION_REQUEST_DELIVERY_UNKNOWN" &&
        response.retryable === false,
      "An unclassified delivery failure was not fenced as UNKNOWN.",
    );
  }
  assert(
    integrationRequestTexts.at(-1)?.includes("Requester email: owner@example.com") &&
      storedAccount.settings.requestStatus === "DELIVERY_UNKNOWN",
    "A non-internal email was not used or an unclassified failure was not projected UNKNOWN.",
  );
  const unclassifiedRequestId = textValue(storedAccount.settings.requestId);
  assert(
    unclassifiedRequestId && storedOperations.get(unclassifiedRequestId)?.status === "UNKNOWN",
    "An unclassified email exception was marked retryable instead of UNKNOWN.",
  );
  storedAccount.settings = { ...storedAccount.settings, requestStatus: "FULFILLED" };

  deliveryOutcome = "sent";
  const renewedRequest = await requestService.request(context, "WHATSAPP_BUSINESS");
  assert(renewedRequest.id !== firstRequest.id, "A renewed request reused its lifecycle id.");
  assert(
    integrationRequestReferences.at(-1) === `integration-request:${renewedRequest.id}`,
    "A renewed request did not persist a unique provider reference.",
  );
  assert(
    new Set(integrationRequestReferences).size === integrationRequestReferences.length,
    "Separate request lifecycles reused a UniSender ref_key.",
  );

  storedAccount.settings = { ...storedAccount.settings, requestStatus: "FULFILLED" };
  failFinalizeOnce = true;
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("A post-delivery finalization failure was falsely returned as successful.");
  } catch (error) {
    const response = httpErrorRecord(error);
    assert(
      error instanceof HttpException &&
        error.getStatus() === 503 &&
        response.code === "INTEGRATION_REQUEST_DELIVERY_UNKNOWN" &&
        response.retryable === false,
      "A post-delivery finalization failure did not return the durable unknown state.",
    );
  }
  const ambiguousRequestId = textValue(storedAccount.settings.requestId);
  assert(ambiguousRequestId, "An ambiguous request lost its lifecycle id.");
  const emailsBeforeReplay = integrationRequestEmails;
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("An ambiguous delivery was falsely replayed as successful.");
  } catch (error) {
    const response = httpErrorRecord(error);
    assert(
      error instanceof HttpException &&
        error.getStatus() === 503 &&
        response.code === "INTEGRATION_REQUEST_DELIVERY_UNKNOWN" &&
        response.retryable === false,
      "An ambiguous delivery did not remain fenced.",
    );
  }
  const ambiguousOperation = storedOperations.get(ambiguousRequestId);
  assert(
    integrationRequestEmails === emailsBeforeReplay &&
      ambiguousOperation?.status === "UNKNOWN" &&
      ambiguousOperation.externalReference === `integration-request-${emailsBeforeReplay}` &&
      ambiguousOperation.result.providerMessageId ===
        `integration-request-${emailsBeforeReplay}` &&
      !Object.hasOwn(ambiguousOperation.result, "recipient") &&
      !Object.hasOwn(ambiguousOperation.result, "text") &&
      !JSON.stringify(ambiguousOperation.result).includes("owner@example.com") &&
      storedAccount.settings.requestStatus === "DELIVERY_UNKNOWN",
    "A post-delivery persistence failure lost evidence, retained PII, or caused a duplicate send.",
  );

  storedAccount.settings = {
    ...storedAccount.settings,
    requestStatus: "REQUESTED",
    requestDeliveryStatus: "SENT",
    requestId: "missing-managed-request-operation",
  };
  const emailsBeforeProjectionRepair = integrationRequestEmails;
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("A stale request projection falsely succeeded.");
  } catch (error) {
    const response = httpErrorRecord(error);
    assert(
      error instanceof HttpException &&
        error.getStatus() === 503 &&
        response.code === "INTEGRATION_REQUEST_DELIVERY_UNKNOWN" &&
        response.retryable === false,
      "A stale request projection was not repaired and fenced.",
    );
  }
  assert(
    integrationRequestEmails === emailsBeforeProjectionRepair &&
      storedAccount.settings.requestStatus === "DELIVERY_UNKNOWN" &&
      storedAccount.settings.requestDeliveryStatus === "UNKNOWN" &&
      auditActions.includes("integration.connection_request_projection_repaired"),
    "A missing ExternalOperation was resent or not repaired to DELIVERY_UNKNOWN.",
  );

  const timeoutRequestId = "managed-request-wait-timeout";
  const timeoutReference = `integration-request:${timeoutRequestId}`;
  const timeoutRequestedAt = "2026-07-18T12:00:00.000Z";
  storedOperations.set(timeoutRequestId, {
    id: timeoutRequestId,
    tenantId: context.tenantId,
    integrationId: storedAccount.id,
    operationKind: "integration.connection_request.email",
    requestHash: "timeout-request-hash",
    providerIdempotencyKey: timeoutReference,
    status: "STARTED",
    result: {
      schemaVersion: 1,
      tenantId: context.tenantId,
      integrationId: storedAccount.id,
      provider: "WHATSAPP_BUSINESS",
      actorUserId: context.userId,
      recipient: "ops@leadvirt.test",
      subject: "LeadVirt.ai integration request: WhatsApp Business",
      text: "Requester email: owner@example.com",
      referenceKey: timeoutReference,
      requestedAt: timeoutRequestedAt,
    },
    attemptCount: 1,
    createdAt: new Date(timeoutRequestedAt),
    startedAt: new Date(timeoutRequestedAt),
    completedAt: null,
    externalReference: null,
    errorCode: null,
    errorMessage: null,
  });
  storedAccount.settings = {
    ...storedAccount.settings,
    requestStatus: "REQUESTED",
    requestDeliveryStatus: "PENDING",
    requestId: timeoutRequestId,
    requestedAt: timeoutRequestedAt,
  };
  const emailsBeforeWaitTimeout = integrationRequestEmails;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number) =>
    originalSetTimeout(callback, 0)) as typeof globalThis.setTimeout;
  try {
    await requestService.request(context, "WHATSAPP_BUSINESS");
    throw new Error("A timed-out STARTED delivery falsely succeeded.");
  } catch (error) {
    const response = httpErrorRecord(error);
    assert(
      error instanceof HttpException &&
        error.getStatus() === 503 &&
        response.code === "INTEGRATION_REQUEST_DELIVERY_UNKNOWN" &&
        response.retryable === false,
      "A timed-out STARTED delivery did not return the durable UNKNOWN response.",
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  const timedOutOperation = storedOperations.get(timeoutRequestId);
  assert(
    integrationRequestEmails === emailsBeforeWaitTimeout &&
      timedOutOperation?.status === "UNKNOWN" &&
      timedOutOperation.errorCode === "INTEGRATION_REQUEST_DELIVERY_WAIT_TIMEOUT" &&
      !Object.hasOwn(timedOutOperation.result, "recipient") &&
      !Object.hasOwn(timedOutOperation.result, "text") &&
      storedAccount.settings.requestStatus === "DELIVERY_UNKNOWN" &&
      storedAccount.settings.requestDeliveryStatus === "UNKNOWN",
    "A timed-out STARTED delivery was not persistently fenced before the response.",
  );
  if (previousRequestEmail === undefined) delete process.env.INTEGRATION_REQUEST_EMAIL;
  else process.env.INTEGRATION_REQUEST_EMAIL = previousRequestEmail;
  try {
    await requestService.request(context, "VK");
    throw new Error("A non-requestable provider accepted a connection request.");
  } catch (error) {
    assert(
      error instanceof HttpException && error.getStatus() === 400,
      "A non-requestable provider did not fail with HTTP 400.",
    );
  }

  const emailAdapter = new EmailAdapter();
  await expectAdapterUnavailable(
    () => emailAdapter.normalizeInbound({ message: "must-not-normalize" }),
    "EMAIL",
    "NORMALIZE_INBOUND",
  );
  await expectAdapterUnavailable(
    () =>
      emailAdapter.sendMessage({
        tenantId: context.tenantId,
        channelAccountId: "email-account",
        conversationId: "conversation-email",
        externalConversationId: "person@example.com",
        text: "must-not-send",
      }),
    "EMAIL",
    "SEND_MESSAGE",
  );
  await expectAdapterUnavailable(
    () =>
      new GoogleCalendarAdapter().createBooking({
        tenantId: context.tenantId,
        leadId: "lead-calendar",
        title: "Must not create",
        startsAt: "2026-07-15T12:00:00.000Z",
      }),
    "GOOGLE_CALENDAR",
    "CREATE_BOOKING",
  );

  const staleTimestamp = new Date("2026-07-01T10:00:00.000Z");
  const staleUnavailableAccounts = unavailableProviders.map(({ provider, capability }) => ({
    id: `integration-${provider.toLowerCase()}`,
    tenantId: context.tenantId,
    provider,
    status: "CONNECTED",
    name: provider,
    category: capability,
    settings: {
      apiToken: "legacy-plaintext-token",
      syncEnabled: true,
      ...(provider === "INSTAGRAM"
        ? {
            requestStatus: "REQUESTED",
            requestedAt: "2026-07-15T09:00:00.000Z",
          }
        : {}),
    },
    encryptedCredentials: "legacy-encrypted-credentials",
    connectedAt: staleTimestamp,
    lastSyncAt: staleTimestamp,
    deletedAt: null,
    syncLogs: [
      {
        id: `sync-${provider.toLowerCase()}`,
        action: "synthetic.operation",
        status: "SUCCESS",
        message: "Synthetic success",
        createdAt: staleTimestamp,
      },
    ],
  }));
  const telegramAccount = {
    id: "integration-telegram",
    tenantId: context.tenantId,
    provider: "TELEGRAM",
    status: "DISCONNECTED",
    name: "Telegram",
    category: "Channel",
    settings: { botId: "42", botUsername: "truthful_bot", managedByLeadVirt: true },
    encryptedCredentials: null,
    connectedAt: null,
    lastSyncAt: staleTimestamp,
    deletedAt: null,
    syncLogs: [],
  };
  const telegramChannel = {
    id: "channel-telegram-history",
    type: "TELEGRAM",
    publicKey: "telegram-history-public-key",
    settings: { telegram: { webhookSecret: "telegram-history-secret" } },
    encryptedCredentials: "encrypted-telegram-token",
    createdAt: staleTimestamp,
  };
  const webhookAccount = {
    id: "integration-webhook-api",
    tenantId: context.tenantId,
    provider: "WEBHOOK_API",
    status: "DISCONNECTED",
    name: "Webhook/API",
    category: "Developers",
    settings: { syncDirection: "inbound" },
    encryptedCredentials: null,
    connectedAt: null,
    lastSyncAt: null,
    deletedAt: null,
    syncLogs: [],
  };
  const webhookChannel = {
    id: "channel-webhook-authority",
    type: "WEBHOOK",
    publicKey: "webhook-authority-public-key",
    settings: { webhook: { webhookSecret: "webhook-authority-secret" } },
    encryptedCredentials: null,
    createdAt: staleTimestamp,
  };
  const scopedTelegramEvent = {
    id: "event-telegram-scoped",
    provider: `telegram:${telegramChannel.id}`,
    externalEventId: "update-scoped",
    status: "PROCESSED",
    errorMessage: null,
    receivedAt: new Date("2026-07-15T10:01:00.000Z"),
    processedAt: new Date("2026-07-15T10:01:01.000Z"),
  };
  const legacyTelegramEvent = {
    id: "event-telegram-legacy",
    provider: "telegram",
    externalEventId: "update-legacy",
    status: "PROCESSED",
    errorMessage: null,
    receivedAt: new Date("2026-07-15T10:00:00.000Z"),
    processedAt: new Date("2026-07-15T10:00:01.000Z"),
  };
  let queriedWebhookProviders: string[] = [];
  const readPrisma = {
    integrationAccount: {
      findMany: () =>
        Promise.resolve([...staleUnavailableAccounts, telegramAccount, webhookAccount]),
      findFirst: (args: { where: { provider: string } }) =>
        Promise.resolve(args.where.provider === "WEBHOOK_API" ? webhookAccount : null),
    },
    channel: {
      findMany: () => Promise.resolve([telegramChannel, webhookChannel]),
      findFirst: (args: { where: { type: string } }) =>
        Promise.resolve(args.where.type === "WEBHOOK" ? webhookChannel : null),
    },
    webhookEvent: {
      findMany: (args: { where: { provider: { in: string[] } } }) => {
        queriedWebhookProviders = args.where.provider.in;
        return Promise.resolve([scopedTelegramEvent, legacyTelegramEvent]);
      },
    },
    integrationSyncLog: {
      create: () => Promise.resolve({ id: "sync-webhook-sample" }),
    },
    auditLog: {
      create: () => Promise.resolve({ id: "audit-webhook-sample" }),
    },
  } as unknown as PrismaService;
  let webhookSampleCalls = 0;
  const webhookService = {
    handleEvent: () => {
      webhookSampleCalls += 1;
      return Promise.resolve({
        ok: true as const,
        duplicate: false,
        conversationId: "conversation-webhook-sample",
        leadId: "lead-webhook-sample",
        inboundMessageId: "message-webhook-sample",
        aiMessageId: null,
        outboundStatus: "skipped" as const,
        reply: null,
      });
    },
  } as unknown as WebhookService;
  const readService = createService(readPrisma, webhookService);
  const projected = await readService.list(context);

  for (const { provider } of unavailableProviders) {
    const account = projected.find((item) => item.provider === provider);
    assert(account, `Projected ${provider} account is missing.`);
    assert(account.status === "COMING_SOON", `${provider} still projects as connected.`);
    assert(account.connectedAt === null, `${provider} still exposes a connected timestamp.`);
    assert(account.lastSyncAt === null, `${provider} still exposes a synthetic sync timestamp.`);
    assert(
      account.recentSyncLogs.length === 0,
      `${provider} still exposes synthetic success logs.`,
    );
    assert(
      account.settings.implementationStatus === "NOT_AVAILABLE" &&
        account.settings.selfServe === false,
      `${provider} does not expose truthful availability metadata.`,
    );
    assert(account.settings.apiToken === undefined, `${provider} exposed legacy credentials.`);
    if (provider === "INSTAGRAM") {
      assert(
        account.settings.requestStatus === "REQUESTED" &&
          account.settings.requestedAt === "2026-07-15T09:00:00.000Z",
        "Instagram did not expose its durable request state.",
      );
    }
  }

  const telegram = projected.find((item) => item.provider === "TELEGRAM");
  assert(telegram?.status === "CONNECTED", "Telegram connection behavior regressed.");
  assert(telegram.connectedAt === staleTimestamp.toISOString(), "Telegram timestamps regressed.");
  assert(
    queriedWebhookProviders.includes(`telegram:${telegramChannel.id}`) &&
      queriedWebhookProviders.includes("telegram"),
    "Telegram history query omitted a scoped or legacy provider key.",
  );
  assert(
    telegram.recentWebhookEvents?.map((event) => event.id).join(",") ===
      "event-telegram-scoped,event-telegram-legacy",
    "Telegram integration history did not preserve scoped and legacy webhook events.",
  );

  const webhook = projected.find((item) => item.provider === "WEBHOOK_API");
  assert(
    webhook?.status === "CONNECTED",
    "Active Webhook channel did not override stale account state.",
  );
  assert(
    webhook.connectedAt === staleTimestamp.toISOString() && webhook.inboundEndpoint !== null,
    "Webhook projection did not expose the active channel endpoint.",
  );
  const sample = await readService.sendSampleInbound(context, "WEBHOOK_API");
  assert(
    sample.ok && webhookSampleCalls === 1,
    "Stale account status blocked the real channel sample.",
  );

  console.log(
    JSON.stringify({
      ok: true,
      providers: unavailableProviders.map(({ provider }) => provider),
      rejectedBoundaries: unavailableProviders.length * 5 + 1,
      rejectedAdapterOperations: 3,
      telegramWebhookHistoryKeys: queriedWebhookProviders,
      webhookChannelAuthority: true,
      databaseAccessesBeforeRejection: databaseAccesses.length,
      integrationRequestEmails,
    }),
  );
}

void main();
