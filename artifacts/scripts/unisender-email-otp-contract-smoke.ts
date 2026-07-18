import {
  EmailDeliveryFailure,
  EmailOtpDeliveryService,
} from "../../apps/api/src/modules/auth/email-otp-delivery.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFeatureFlag = process.env.AUTH_EMAIL_OTP_ENABLED;
  const originalEmailProvider = process.env.EMAIL_PROVIDER;
  const originalOtpProvider = process.env.EMAIL_OTP_PROVIDER;
  process.env.AUTH_EMAIL_OTP_ENABLED = "true";
  process.env.EMAIL_PROVIDER = "manual";
  process.env.EMAIL_OTP_PROVIDER = "unisender";
  process.env.UNISENDER_API_KEY = "contract-test-secret";
  process.env.UNISENDER_LIST_ID = "321";
  process.env.UNISENDER_SENDER_NAME = "LeadVirt.ai";
  process.env.UNISENDER_SENDER_EMAIL = "verified@leadvirt.com";

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedForm: URLSearchParams | null = null;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedForm = new URLSearchParams(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ result: [{ id: "provider-message-1", email: "owner@example.com" }] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const service = new EmailOtpDeliveryService();
    assert(
      service.config().enabled,
      "OTP delivery must not depend on the password-reset email provider.",
    );
    const result = await service.send({
      challengeId: "a".repeat(48),
      email: "owner@example.com",
      code: "482105",
      locale: "fr",
    });

    assert(
      result.providerMessageId === "provider-message-1",
      "Provider message id was not returned.",
    );
    assert(
      !capturedUrl.includes("contract-test-secret"),
      "UniSender API key must not be placed in the URL.",
    );
    assert(
      capturedForm?.get("api_key") === "contract-test-secret",
      "UniSender API key is missing from the POST body.",
    );
    assert(
      capturedForm?.get("sender_email") === "verified@leadvirt.com",
      "Verified sender email is missing.",
    );
    assert(capturedForm?.get("list_id") === "321", "Dedicated authentication list id is missing.");
    assert(
      capturedForm?.get("track_read") === "0" && capturedForm.get("track_links") === "0",
      "OTP tracking must stay disabled.",
    );
    assert(capturedForm?.get("lang") === "fr", "Email locale was not forwarded.");
    assert(
      capturedForm?.get("body")?.includes("482105"),
      "Localized email body does not contain the OTP code.",
    );
    assert(
      capturedForm?.get("ref_key") === "a".repeat(48),
      "Challenge id was not used as the idempotency key.",
    );

    process.env.EMAIL_PROVIDER = "unisender";
    const resetConfig = service.passwordResetConfig();
    assert(
      resetConfig.enabled && resetConfig.deliveryMode === "unisender",
      "UniSender reset delivery is not ready.",
    );
    capturedForm = null;
    const resetUrl = "https://leadvirt.com/reset-password?token=contract-reset-token";
    const resetResult = await service.sendPasswordReset({
      resetId: "reset-provider-contract-1",
      email: "owner@example.com",
      resetUrl,
    });
    assert(
      resetResult.providerMessageId === "provider-message-1",
      "Reset provider message id was not returned.",
    );
    assert(
      capturedForm?.get("subject")?.includes("Reset"),
      "UniSender reset subject is incorrect.",
    );
    assert(
      capturedForm?.get("body")?.includes(resetUrl),
      "UniSender reset body is missing the reset URL.",
    );
    assert(
      capturedForm?.get("ref_key") === "reset-provider-contract-1",
      "Reset id was not used as the idempotency key.",
    );
    assert(
      capturedForm?.get("metadata[purpose]") === "password_reset",
      "UniSender reset purpose metadata is incorrect.",
    );
    assert(
      capturedForm?.get("track_read") === "0" && capturedForm.get("track_links") === "0",
      "Reset tracking must stay disabled.",
    );

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          result: [
            {
              index: 0,
              email: "owner@example.com",
              errors: [{ code: "retry_later", message: "Provider detail" }],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    let providerError: unknown;
    try {
      await service.send({
        challengeId: "b".repeat(48),
        email: "owner@example.com",
        code: "195204",
        locale: "en",
      });
    } catch (error) {
      providerError = error;
    }
    assert(providerError instanceof Error, "UniSender recipient errors must reject delivery.");
    assert(
      providerError instanceof EmailDeliveryFailure && providerError.outcome === "rejected",
      "A definite UniSender recipient rejection was not classified as rejected.",
    );
    assert(
      providerError.message === "Email delivery is temporarily unavailable.",
      "Provider details must not leak through auth errors.",
    );

    providerError = undefined;
    try {
      await service.sendPasswordReset({
        resetId: "reset-provider-contract-failure",
        email: "owner@example.com",
        resetUrl,
      });
    } catch (error) {
      providerError = error;
    }
    assert(
      providerError instanceof Error,
      "UniSender reset recipient errors must reject delivery.",
    );
    assert(
      providerError.message === "Email delivery is temporarily unavailable.",
      "UniSender reset provider details must not leak through auth errors.",
    );

    globalThis.fetch = async () => new Response("", { status: 503 });
    providerError = undefined;
    try {
      await service.sendOperationalEmail({
        email: "ops@leadvirt.test",
        subject: "LeadVirt.ai integration request: Instagram",
        text: "Tenant ID: tenant-contract",
        referenceKey: "integration-request-contract-503",
        purpose: "integration_connection_request",
      });
    } catch (error) {
      providerError = error;
    }
    assert(
      providerError instanceof EmailDeliveryFailure && providerError.outcome === "unknown",
      "A UniSender 5xx response was incorrectly treated as a definite rejection.",
    );

    globalThis.fetch = async () => new Response("", { status: 429 });
    providerError = undefined;
    try {
      await service.sendOperationalEmail({
        email: "ops@leadvirt.test",
        subject: "LeadVirt.ai integration request: Instagram",
        text: "Tenant ID: tenant-contract",
        referenceKey: "integration-request-contract-429",
        purpose: "integration_connection_request",
      });
    } catch (error) {
      providerError = error;
    }
    assert(
      providerError instanceof EmailDeliveryFailure && providerError.outcome === "rejected",
      "A UniSender rate limit was not classified as a definite rejection.",
    );

    process.env.NODE_ENV = "production";
    delete process.env.AUTH_EMAIL_OTP_ENABLED;
    assert(
      new EmailOtpDeliveryService().config().enabled === false,
      "Production email OTP must require an explicit enable flag.",
    );
    assert(
      service.passwordResetConfig().enabled && !service.passwordResetConfig().exposeResetUrl,
      "Configured production UniSender reset delivery must be enabled without URL exposure.",
    );
    for (const unsupportedProvider of ["mock", "manual", "unsupported"]) {
      process.env.EMAIL_PROVIDER = unsupportedProvider;
      assert(
        !service.passwordResetConfig().enabled,
        `Production ${unsupportedProvider} reset delivery did not fail closed.`,
      );
    }
    console.log(JSON.stringify({ ok: true, checks: 29 }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFeatureFlag === undefined) delete process.env.AUTH_EMAIL_OTP_ENABLED;
    else process.env.AUTH_EMAIL_OTP_ENABLED = originalFeatureFlag;
    if (originalEmailProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = originalEmailProvider;
    if (originalOtpProvider === undefined) delete process.env.EMAIL_OTP_PROVIDER;
    else process.env.EMAIL_OTP_PROVIDER = originalOtpProvider;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
