import {
  EmailDeliveryFailure,
  EmailOtpDeliveryService,
  type SmtpTransportFactory,
} from "../../apps/api/src/modules/auth/email-otp-delivery.service.js";
import { passwordResetOrigin } from "../../apps/api/src/modules/auth/password-reset-origin.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertResetOriginRejected(environment: Parameters<typeof passwordResetOrigin>[0]) {
  let error: unknown;
  try {
    passwordResetOrigin(environment);
  } catch (caught) {
    error = caught;
  }
  assert(
    error instanceof Error && error.message === "Password reset link origin is not configured.",
    "An unsafe reset origin was accepted or leaked configuration details.",
  );
}

async function main() {
  assert(
    passwordResetOrigin({
      NODE_ENV: "production",
      APP_URL: "https://leadvirt.com/",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    }) === "https://leadvirt.com",
    "The canonical production reset origin was not normalized.",
  );
  assert(
    passwordResetOrigin({ NODE_ENV: "development", APP_URL: "http://localhost:3001/" }) ===
      "http://localhost:3001",
    "The local reset origin contract regressed.",
  );
  for (const environment of [
    {
      NODE_ENV: "production",
      APP_URL: "http://leadvirt.com",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    },
    {
      NODE_ENV: "production",
      APP_URL: "https://operator:secret@leadvirt.com",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    },
    {
      NODE_ENV: "production",
      APP_URL: "https://leadvirt.com/reset",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    },
    {
      NODE_ENV: "production",
      APP_URL: "https://leadvirt.com?source=invalid",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    },
    {
      NODE_ENV: "production",
      APP_URL: "https://leadvirt.com#invalid",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    },
    {
      NODE_ENV: "production",
      APP_URL: "https://wrong.example",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com",
    },
    {
      NODE_ENV: "production",
      APP_URL: "https://leadvirt.com",
      NEXT_PUBLIC_APP_URL: "https://leadvirt.com/untrusted-path",
    },
  ]) {
    assertResetOriginRejected(environment);
  }

  process.env.NODE_ENV = "production";
  process.env.AUTH_EMAIL_OTP_ENABLED = "true";
  process.env.EMAIL_PROVIDER = "smtp";
  process.env.EMAIL_OTP_PROVIDER = "smtp";
  process.env.EMAIL_FROM = "LeadVirt.ai <noreply@leadvirt.com>";
  process.env.SMTP_HOST = "smtp.beget.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_SECURE = "true";
  process.env.SMTP_USER = "noreply@leadvirt.com";
  process.env.SMTP_PASSWORD = "smtp-contract-secret";

  let capturedOptions: Parameters<SmtpTransportFactory>[0] | undefined;
  let capturedMessage: Record<string, unknown> | undefined;
  let closed = false;
  const factory: SmtpTransportFactory = (options) => {
    capturedOptions = options;
    return {
      sendMail: async (message) => {
        capturedMessage = message;
        return { messageId: "smtp-message-1" };
      },
      close: () => {
        closed = true;
      },
    };
  };

  const service = new EmailOtpDeliveryService(factory);
  assert(
    service.config().enabled,
    "SMTP OTP must be enabled with complete production configuration.",
  );
  const result = await service.send({
    challengeId: "c".repeat(48),
    email: "owner@example.com",
    code: "482105",
    locale: "de",
  });

  assert(result.providerMessageId === "smtp-message-1", "SMTP message id was not returned.");
  assert(capturedOptions?.host === "smtp.beget.com", "SMTP host was not forwarded.");
  assert(
    capturedOptions.port === 465 && capturedOptions.secure,
    "SMTP implicit TLS configuration is incorrect.",
  );
  assert(capturedOptions.auth.user === "noreply@leadvirt.com", "SMTP username was not forwarded.");
  assert(
    capturedOptions.auth.pass === "smtp-contract-secret",
    "SMTP password was not forwarded to transport auth.",
  );
  assert(
    capturedOptions.tls.rejectUnauthorized,
    "SMTP TLS certificate validation must stay enabled.",
  );
  assert(
    capturedOptions.connectionTimeout <= 10_000,
    "SMTP connection timeout is too long for an auth request.",
  );
  assert(capturedMessage?.to === "owner@example.com", "SMTP recipient is incorrect.");
  assert(
    JSON.stringify(capturedMessage.from) ===
      JSON.stringify({ name: "LeadVirt.ai", address: "noreply@leadvirt.com" }),
    "SMTP sender is incorrect.",
  );
  assert(
    String(capturedMessage.subject).includes("LeadVirt.ai"),
    "SMTP subject is missing product identity.",
  );
  assert(
    String(capturedMessage.html).includes("482105"),
    "SMTP HTML body is missing the OTP code.",
  );
  assert(
    String(capturedMessage.text).includes("482105"),
    "SMTP text body is missing the OTP code.",
  );
  assert(
    capturedMessage.disableFileAccess === true && capturedMessage.disableUrlAccess === true,
    "SMTP message access controls are disabled.",
  );
  assert(
    !JSON.stringify(capturedMessage).includes("smtp-contract-secret"),
    "SMTP password leaked into message content.",
  );
  assert(closed, "SMTP transport was not closed after delivery.");

  const resetConfig = service.passwordResetConfig();
  assert(
    resetConfig.enabled && resetConfig.deliveryMode === "smtp",
    "SMTP password reset delivery is not ready.",
  );
  assert(!resetConfig.exposeResetUrl, "Production SMTP reset URLs must not be exposed by the API.");
  capturedMessage = undefined;
  closed = false;
  const resetUrl = "https://leadvirt.com/reset-password?token=contract-reset-token";
  const resetResult = await service.sendPasswordReset({
    resetId: "reset-contract-1",
    email: "owner@example.com",
    resetUrl,
  });
  assert(
    resetResult.providerMessageId === "smtp-message-1",
    "SMTP reset message id was not returned.",
  );
  assert(capturedMessage?.to === "owner@example.com", "SMTP reset recipient is incorrect.");
  assert(String(capturedMessage?.subject).includes("Reset"), "SMTP reset subject is incorrect.");
  assert(
    String(capturedMessage?.html).includes(resetUrl),
    "SMTP reset HTML is missing the reset URL.",
  );
  assert(
    String(capturedMessage?.text).includes(resetUrl),
    "SMTP reset text is missing the reset URL.",
  );
  assert(
    JSON.stringify(capturedMessage?.headers) ===
      JSON.stringify({ "X-LeadVirt-Purpose": "password_reset" }),
    "SMTP reset purpose header is incorrect.",
  );
  assert(closed, "SMTP transport was not closed after reset delivery.");

  capturedMessage = undefined;
  closed = false;
  process.env.EMAIL_PROVIDER = "mock";
  const operationalResult = await service.sendOperationalEmail({
    subject: "LeadVirt.ai plan request: Professional",
    text: "Tenant ID: tenant-contract\nRequested plan: PROFESSIONAL",
    referenceKey: "billing-plan-contract-1",
    purpose: "billing_plan_selection",
  });
  assert(
    operationalResult.providerMessageId === "smtp-message-1",
    "SMTP operational message id was not returned.",
  );
  assert(
    capturedMessage?.to === "noreply@leadvirt.com",
    "Operational email did not fall back to the configured sender address.",
  );
  assert(
    String(capturedMessage?.html).includes("tenant-contract"),
    "Operational HTML body is missing request context.",
  );
  assert(
    JSON.stringify(capturedMessage?.headers) ===
      JSON.stringify({ "X-LeadVirt-Purpose": "billing_plan_selection" }),
    "SMTP operational purpose header is incorrect.",
  );
  const stableOperationalMessageId = capturedMessage?.messageId;
  assert(
    typeof stableOperationalMessageId === "string" &&
      /^<leadvirt\.[a-f0-9]{40}@leadvirt\.com>$/.test(stableOperationalMessageId),
    "SMTP operational delivery has no deterministic Message-ID.",
  );
  await service.sendOperationalEmail({
    subject: "LeadVirt.ai plan request: Professional",
    text: "Tenant ID: tenant-contract\nRequested plan: PROFESSIONAL",
    referenceKey: "billing-plan-contract-1",
    purpose: "billing_plan_selection",
  });
  assert(
    capturedMessage?.messageId === stableOperationalMessageId,
    "SMTP retry identity changed for the same persisted reference.",
  );
  await service.sendOperationalEmail({
    subject: "LeadVirt.ai plan request: Professional",
    text: "Tenant ID: tenant-contract\nRequested plan: PROFESSIONAL",
    referenceKey: "billing-plan-contract-2",
    purpose: "billing_plan_selection",
  });
  assert(
    capturedMessage?.messageId !== stableOperationalMessageId,
    "Separate SMTP lifecycles reused a Message-ID.",
  );
  assert(closed, "SMTP transport was not closed after operational delivery.");
  process.env.EMAIL_PROVIDER = "smtp";

  let failureClosed = false;
  const failureFactory: SmtpTransportFactory = () => ({
    sendMail: async () => {
      throw new Error("Authentication details from provider");
    },
    close: () => {
      failureClosed = true;
    },
  });
  let deliveryError: unknown;
  const failureService = new EmailOtpDeliveryService(failureFactory);
  try {
    await failureService.send({
      challengeId: "d".repeat(48),
      email: "owner@example.com",
      code: "195204",
      locale: "en",
    });
  } catch (error) {
    deliveryError = error;
  }
  assert(deliveryError instanceof Error, "SMTP provider errors must reject delivery.");
  assert(
    deliveryError.message === "Email delivery is temporarily unavailable.",
    "SMTP provider details leaked through the auth error.",
  );
  assert(failureClosed, "SMTP transport was not closed after a delivery error.");

  failureClosed = false;
  deliveryError = undefined;
  try {
    await failureService.sendPasswordReset({
      resetId: "reset-contract-failure",
      email: "owner@example.com",
      resetUrl,
    });
  } catch (error) {
    deliveryError = error;
  }
  assert(deliveryError instanceof Error, "SMTP reset provider errors must reject delivery.");
  assert(
    deliveryError.message === "Email delivery is temporarily unavailable.",
    "SMTP reset provider details leaked through the auth error.",
  );
  assert(failureClosed, "SMTP transport was not closed after a reset delivery error.");

  failureClosed = false;
  deliveryError = undefined;
  try {
    await failureService.sendOperationalEmail({
      email: "ops@leadvirt.test",
      subject: "LeadVirt.ai integration request: Instagram",
      text: "Tenant ID: tenant-contract",
      referenceKey: "integration-request-contract-smtp-failure",
      purpose: "integration_connection_request",
    });
  } catch (error) {
    deliveryError = error;
  }
  assert(
    deliveryError instanceof EmailDeliveryFailure && deliveryError.outcome === "unknown",
    "An ambiguous SMTP operational failure was not classified as UNKNOWN.",
  );
  assert(failureClosed, "SMTP transport was not closed after an operational delivery error.");

  delete process.env.SMTP_PASSWORD;
  assert(
    new EmailOtpDeliveryService(factory).config().enabled === false,
    "SMTP OTP must fail closed without a password.",
  );
  assert(
    new EmailOtpDeliveryService(factory).passwordResetConfig().enabled === false,
    "SMTP password reset must fail closed without a password.",
  );

  process.env.NODE_ENV = "development";
  process.env.EMAIL_PROVIDER = "mock";
  const mockService = new EmailOtpDeliveryService(factory);
  const mockConfig = mockService.passwordResetConfig();
  assert(
    mockConfig.enabled && mockConfig.exposeResetUrl,
    "Development mock reset delivery is unavailable.",
  );
  const mockResult = await mockService.sendPasswordReset({
    resetId: "reset-contract-mock",
    email: "owner@example.com",
    resetUrl,
  });
  assert(
    mockResult.providerMessageId === "mock:reset-contract-mock",
    "Development mock reset result is incorrect.",
  );
  const operationalMockResult = await mockService.sendOperationalEmail({
    subject: "LeadVirt.ai plan request: Start",
    text: "Tenant ID: tenant-mock",
    referenceKey: "billing-plan-mock",
    purpose: "billing_plan_selection",
  });
  assert(
    operationalMockResult.providerMessageId === "mock:billing-plan-mock",
    "Development operational mock result is incorrect.",
  );
  console.log(JSON.stringify({ ok: true, checks: 50 }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
