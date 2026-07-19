import { expect, test } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test("web routes publish the constrained browser security policy", async ({ request }) => {
  const response = await request.get(`${webBase}/`);
  expect(response.ok()).toBe(true);

  const headers = response.headers();
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("script-src-attr 'none'");
  expect(csp).toContain("frame-src 'none'");
  expect(csp).not.toContain("telegram.org");
  expect(csp).not.toContain("oauth.telegram.org");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("script-src *");
  expect(csp).not.toContain("frame-src *");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["permissions-policy"]).toBe(
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
});

test("only the public widget frame allows customer-site embedding", async ({ request }) => {
  const response = await request.get(`${webBase}/widget/frame?publicKey=security-header-smoke`);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-security-policy"] ?? "").toContain("frame-ancestors *");
  expect(response.headers()["x-frame-options"]).toBeUndefined();
});
