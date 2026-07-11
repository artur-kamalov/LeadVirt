import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured =
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY ??
    process.env.ENCRYPTION_KEY ??
    process.env.SESSION_SECRET;
  const source =
    configured ??
    (process.env.NODE_ENV === "production" ? "" : "leadvirt-local-integration-credentials");
  if (!source) {
    throw new Error("Integration credential encryption is not configured.");
  }
  return createHash("sha256").update(source).digest();
}

export function encryptIntegrationCredentials(credentials: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptIntegrationCredentials(encryptedCredentials: string) {
  const [version, iv, tag, encrypted] = encryptedCredentials.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported integration credential format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const value: unknown = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Integration credentials are invalid.");
  }
  return value as Record<string, unknown>;
}
