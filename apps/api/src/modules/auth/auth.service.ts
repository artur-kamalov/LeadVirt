import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { MembershipRole, Prisma } from "@leadvirt/db";
import type { RequestContext } from "../../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import type { ConfirmPasswordResetDto } from "./dto/confirm-password-reset.dto.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RequestPasswordResetDto } from "./dto/request-password-reset.dto.js";
import type { SignupDto } from "./dto/signup.dto.js";
import type { TelegramAuthDto } from "./dto/telegram-auth.dto.js";
import type { TelegramOidcAuthDto } from "./dto/telegram-oidc-auth.dto.js";
import type { EmailOtpLocale, RequestEmailOtpDto } from "./dto/request-email-otp.dto.js";
import type { VerifyEmailOtpDto } from "./dto/verify-email-otp.dto.js";
import { EmailOtpChallengeService } from "./email-otp-challenge.service.js";
import { EmailOtpDeliveryService } from "./email-otp-delivery.service.js";
import { authIdentifierWhere, parseAuthIdentifier } from "./auth-identifier.js";
import { passwordResetOrigin } from "./password-reset-origin.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  totpAuthUri,
  verifyTotpCode,
} from "./totp.js";

const sessionCookieName = "leadvirt_session";
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const passwordResetTtlMs = 30 * 60 * 1000;
const telegramAuthMaxAgeMs = 24 * 60 * 60 * 1000;

type AuthMeta = {
  ipAddress?: string;
  userAgent?: string;
};

type AuthUser = {
  id: string;
  email: string;
  phone: string | null;
  passwordChangeRequired: boolean;
  name: string | null;
  avatarUrl: string | null;
  locale: string | null;
};

type AuthTenant = {
  id: string;
  name: string;
  slug: string;
  status: "TRIALING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  businessType: string | null;
  timezone: string;
};

type AuthMode = "credentials" | "email" | "telegram";

type TelegramIdentity = {
  telegramId: number;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  auditPayload: Prisma.InputJsonObject;
};

type TelegramJwk = {
  alg?: string;
  e?: string;
  kid?: string;
  kty?: string;
  n?: string;
};

type TelegramOidcClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
  id?: unknown;
  sub?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  preferred_username?: unknown;
  picture?: unknown;
  nonce?: unknown;
};

let telegramJwksCache: { expiresAt: number; keys: TelegramJwk[] } | null = null;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function emailNameSeed(email: string) {
  return (
    email
      .split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim() || "LeadVirt"
  );
}

function hashSecret(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

function localeSetting(locale: EmailOtpLocale) {
  const settings: Record<EmailOtpLocale, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    pt: "pt-BR",
    ru: "ru-RU",
  };
  return settings[locale];
}

function sessionAuthMode(value: string, externalAuthId: string | null): AuthMode {
  if (value === "email" || value === "telegram") return value;
  return externalAuthId?.startsWith("telegram:") ? "telegram" : "credentials";
}

function cookieValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

function envFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function secureCookieEnabled() {
  return envFlag(process.env.AUTH_COOKIE_SECURE) ?? appBaseUrl().startsWith("https://");
}

function cookieOptions(maxAgeSeconds: number) {
  const secure = secureCookieEnabled() ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function baseSlug(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "workspace";
}

function recoveryCodeHashes(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function appBaseUrl() {
  return (process.env.APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

async function lockPasswordCredential(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-password:${userId}`}, 0))`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
  return rows.length === 1;
}

function credentialsAuthEnabled() {
  return envFlag(process.env.AUTH_CREDENTIALS_ENABLED) ?? process.env.NODE_ENV !== "production";
}

function telegramAuthEnabled() {
  return envFlag(process.env.AUTH_TELEGRAM_ENABLED) === true;
}

function requireTelegramAuthEnabled() {
  if (!telegramAuthEnabled()) {
    throw new NotFoundException("Telegram authentication is disabled.");
  }
}

function telegramBotToken() {
  return (process.env.TELEGRAM_LOGIN_BOT_TOKEN || "").trim();
}

function telegramBotId() {
  const configured = process.env.TELEGRAM_LOGIN_BOT_ID?.trim();
  if (configured && /^\d+$/.test(configured)) return configured;
  const tokenPrefix = telegramBotToken().split(":", 1)[0]?.trim();
  return tokenPrefix && /^\d+$/.test(tokenPrefix) ? tokenPrefix : null;
}

function telegramBotUsername() {
  const configured = (process.env.TELEGRAM_LOGIN_BOT_USERNAME || "").trim().replace(/^@/, "");
  return /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(configured) ? configured : null;
}

function technicalTelegramEmail(telegramId: number) {
  return `telegram-${telegramId}@telegram.leadvirt.internal`;
}

function cleanTelegramName(dto: TelegramAuthDto) {
  const fullName = [dto.first_name, dto.last_name]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || dto.username?.trim() || `Telegram ${dto.id}`;
}

function telegramDataCheckString(dto: TelegramAuthDto) {
  return Object.entries(dto)
    .filter(
      ([key, value]) => key !== "hash" && value !== undefined && value !== null && value !== "",
    )
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function verifyTelegramHash(dto: TelegramAuthDto) {
  const token = telegramBotToken();
  if (!token) {
    throw new BadRequestException("Telegram login is not configured.");
  }

  const ageMs = Date.now() - dto.auth_date * 1000;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > telegramAuthMaxAgeMs) {
    throw new UnauthorizedException("Telegram login payload is expired.");
  }

  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(telegramDataCheckString(dto)).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(dto.hash, "hex");

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new UnauthorizedException("Telegram login payload is invalid.");
  }
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function parseJwtPart(value: string) {
  try {
    return JSON.parse(base64UrlDecode(value).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException("Telegram OIDC token is malformed.");
  }
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberClaim(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

async function telegramJwks() {
  if (telegramJwksCache && telegramJwksCache.expiresAt > Date.now()) {
    return telegramJwksCache.keys;
  }

  const response = await fetch("https://oauth.telegram.org/.well-known/jwks.json");
  if (!response.ok) {
    throw new UnauthorizedException("Telegram OIDC keys are unavailable.");
  }

  const body = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((key): key is TelegramJwk => typeof key === "object" && key !== null)
    : [];
  telegramJwksCache = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

async function verifyTelegramOidcToken(dto: TelegramOidcAuthDto): Promise<TelegramOidcClaims> {
  const botId = telegramBotId();
  if (!botId) {
    throw new BadRequestException("Telegram login is not configured.");
  }

  const parts = dto.idToken.split(".");
  if (parts.length !== 3) {
    throw new UnauthorizedException("Telegram OIDC token is malformed.");
  }
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];

  const header = parseJwtPart(encodedHeader);
  const claims = parseJwtPart(encodedClaims) as TelegramOidcClaims;
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new UnauthorizedException("Telegram OIDC token algorithm is unsupported.");
  }

  const key = (await telegramJwks()).find(
    (item) => item.kid === header.kid && item.kty === "RSA" && item.alg === "RS256",
  );
  if (!key) {
    throw new UnauthorizedException("Telegram OIDC key was not found.");
  }

  const publicKey = createPublicKey({ key, format: "jwk" });
  const verified = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    publicKey,
    base64UrlDecode(encodedSignature),
  );
  if (!verified) {
    throw new UnauthorizedException("Telegram OIDC token signature is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = numberClaim(claims.exp);
  const iat = numberClaim(claims.iat);
  const audiences = (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).map((value) =>
    String(value),
  );
  if (
    claims.iss !== "https://oauth.telegram.org" ||
    !audiences.includes(botId) ||
    !exp ||
    exp <= now ||
    !iat ||
    iat > now + 60
  ) {
    throw new UnauthorizedException("Telegram OIDC token claims are invalid.");
  }

  if (dto.nonce && claims.nonce !== dto.nonce) {
    throw new UnauthorizedException("Telegram OIDC nonce is invalid.");
  }

  return claims;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailOtpChallengeService) private readonly emailOtpChallenges: EmailOtpChallengeService,
    @Inject(EmailOtpDeliveryService) private readonly emailDelivery: EmailOtpDeliveryService,
  ) {}

  readSessionToken(request: Request) {
    return parseCookies(cookieValue(request.headers.cookie)).get(sessionCookieName);
  }

  setSessionCookie(response: Response, token: string) {
    response.setHeader(
      "Set-Cookie",
      `${sessionCookieName}=${encodeURIComponent(token)}; ${cookieOptions(sessionTtlMs / 1000)}`,
    );
  }

  clearSessionCookie(response: Response) {
    response.setHeader("Set-Cookie", `${sessionCookieName}=; ${cookieOptions(0)}`);
  }

  async contextForSessionToken(token: string): Promise<RequestContext | null> {
    const now = new Date();
    const session = await this.prisma.authSession.findFirst({
      where: {
        tokenHash: hashSecret(token),
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            avatarUrl: true,
            locale: true,
            passwordChangeRequired: true,
            externalAuthId: true,
            deletedAt: true,
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            businessType: true,
            timezone: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!session || session.user.deletedAt || session.tenant.deletedAt) {
      return null;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: session.tenantId, userId: session.userId } },
      select: { role: true },
    });
    if (!membership) {
      return null;
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });

    const authMode = sessionAuthMode(session.authMode, session.user.externalAuthId);

    return {
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.id,
      role: membership.role,
      authMode,
      tenant: {
        id: session.tenant.id,
        name: session.tenant.name,
        slug: session.tenant.slug,
        status: session.tenant.status,
        businessType: session.tenant.businessType,
        timezone: session.tenant.timezone,
      },
      user: {
        id: session.user.id,
        email: session.user.email,
        phone: session.user.phone,
        name: session.user.name,
        avatarUrl: session.user.avatarUrl,
        locale: session.user.locale,
        passwordChangeRequired: session.user.passwordChangeRequired,
      },
    };
  }

  async login(dto: LoginDto, meta: AuthMeta = {}) {
    if (!credentialsAuthEnabled()) {
      throw new BadRequestException("Password login is disabled. Use email sign-in.");
    }

    const identifier = parseAuthIdentifier(dto.email);
    const user = await this.prisma.user.findFirst({
      where: { ...authIdentifierWhere(identifier), deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatarUrl: true,
        locale: true,
        passwordChangeRequired: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecretEncrypted: true,
        twoFactorRecoveryCodes: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                businessType: true,
                timezone: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (!user || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const membership = user.memberships.find((item) => !item.tenant.deletedAt);
    if (!membership) {
      throw new UnauthorizedException("User does not have access to a workspace.");
    }

    if (user.twoFactorEnabled) {
      await this.verifyLoginTwoFactor(
        {
          id: user.id,
          twoFactorSecretEncrypted: user.twoFactorSecretEncrypted,
          twoFactorRecoveryCodes: user.twoFactorRecoveryCodes,
        },
        dto.twoFactorCode,
        membership.tenant.id,
      );
    }

    return this.issueSession(
      {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        passwordChangeRequired: user.passwordChangeRequired,
      },
      membership.tenant,
      membership.role,
      meta,
    );
  }

  async signup(dto: SignupDto, meta: AuthMeta = {}) {
    if (!credentialsAuthEnabled()) {
      throw new BadRequestException("Password signup is disabled. Use email sign-in.");
    }

    const identifier = parseAuthIdentifier(dto.email);
    const email = identifier.storageEmail;
    const companyName = dto.companyName?.trim() || `${identifier.nameSeed} workspace`;
    const ownerName = dto.name?.trim() || identifier.nameSeed;
    const passwordHash = hashPassword(dto.password);
    const slug = await this.uniqueTenantSlug(companyName);

    const created = await this.prisma.$transaction(async (tx) => {
      const [user] = await tx.user.createManyAndReturn({
        data: {
          email,
          phone: identifier.phone,
          name: ownerName,
          passwordHash,
          passwordChangeRequired: false,
        },
        skipDuplicates: true,
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          locale: true,
          passwordChangeRequired: true,
        },
      });
      if (!user) {
        throw new ConflictException("A user with this login already exists.");
      }

      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          status: "TRIALING",
          businessType: "new signup",
          timezone: "Europe/Moscow",
          settings: {
            productName: "LeadVirt.ai",
            locale: "ru-RU",
            signupSource: "credentials",
          } satisfies Prisma.InputJsonObject,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          businessType: true,
          timezone: true,
        },
      });

      const membership = await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
        select: { role: true },
      });

      await tx.onboardingState.create({
        data: {
          tenantId: tenant.id,
          currentStep: "business",
          completedSteps: [],
          data: { companyName } satisfies Prisma.InputJsonObject,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: "auth.signup",
          entityType: "tenant",
          entityId: tenant.id,
          ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
          ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
          payload: {
            identifierKind: identifier.kind,
            identifier: identifier.publicIdentifier,
            email: user.email,
            phone: user.phone,
          } satisfies Prisma.InputJsonObject,
        },
      });

      return { user, tenant, role: membership.role };
    });

    return this.issueSession(created.user, created.tenant, created.role, meta);
  }

  async loginWithTelegram(dto: TelegramAuthDto, meta: AuthMeta = {}) {
    requireTelegramAuthEnabled();
    verifyTelegramHash(dto);

    return this.loginWithTelegramIdentity(
      {
        telegramId: dto.id,
        displayName: cleanTelegramName(dto),
        username: dto.username ?? null,
        avatarUrl: dto.photo_url?.trim() || null,
        auditPayload: {
          telegramId: dto.id,
          username: dto.username ?? null,
        } satisfies Prisma.InputJsonObject,
      },
      meta,
    );
  }

  async loginWithTelegramOidc(dto: TelegramOidcAuthDto, meta: AuthMeta = {}) {
    requireTelegramAuthEnabled();
    const claims = await verifyTelegramOidcToken(dto);
    const telegramId = numberClaim(claims.id);
    if (!telegramId) {
      throw new UnauthorizedException("Telegram OIDC token is missing user id.");
    }

    const displayName =
      stringClaim(claims.name) ||
      [stringClaim(claims.given_name), stringClaim(claims.family_name)]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      stringClaim(claims.preferred_username) ||
      `Telegram ${telegramId}`;

    return this.loginWithTelegramIdentity(
      {
        telegramId,
        displayName,
        username: stringClaim(claims.preferred_username),
        avatarUrl: stringClaim(claims.picture),
        auditPayload: {
          telegramId,
          username: stringClaim(claims.preferred_username),
          oidcSub: stringClaim(claims.sub),
        } satisfies Prisma.InputJsonObject,
      },
      meta,
    );
  }

  telegramLoginConfig() {
    if (!telegramAuthEnabled()) {
      return { enabled: false, botId: null, botUsername: null };
    }
    return { enabled: true, botId: telegramBotId(), botUsername: telegramBotUsername() };
  }

  emailOtpConfig() {
    return this.emailOtpChallenges.config();
  }

  private async loginWithTelegramIdentity(identity: TelegramIdentity, meta: AuthMeta = {}) {
    const externalAuthId = `telegram:${identity.telegramId}`;
    const displayName = identity.displayName;
    const email = technicalTelegramEmail(identity.telegramId);
    const avatarUrl = identity.avatarUrl?.trim() || null;
    let isNewUser = false;

    const existing = await this.prisma.user.findFirst({
      where: { externalAuthId, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatarUrl: true,
        locale: true,
        passwordChangeRequired: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                businessType: true,
                timezone: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });

    if (existing) {
      const membership = existing.memberships.find((item) => !item.tenant.deletedAt);
      if (!membership) {
        throw new UnauthorizedException("User does not have access to a workspace.");
      }

      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { name: displayName, avatarUrl },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          locale: true,
          passwordChangeRequired: true,
        },
      });
      const session = await this.issueSession(
        user,
        membership.tenant,
        membership.role,
        meta,
        "telegram",
      );
      return { ...session, data: { ...session.data, isNewUser } };
    }

    const companyName = `${displayName} workspace`;
    const slug = await this.uniqueTenantSlug(companyName);
    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          status: "TRIALING",
          businessType: "new telegram signup",
          timezone: "Europe/Moscow",
          settings: {
            productName: "LeadVirt.ai",
            locale: "ru-RU",
            signupSource: "telegram",
          } satisfies Prisma.InputJsonObject,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          businessType: true,
          timezone: true,
        },
      });

      const user = await tx.user.create({
        data: {
          externalAuthId,
          email,
          name: displayName,
          avatarUrl,
          passwordChangeRequired: false,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          locale: true,
          passwordChangeRequired: true,
        },
      });

      const membership = await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
        select: { role: true },
      });

      await tx.onboardingState.create({
        data: {
          tenantId: tenant.id,
          currentStep: "business",
          completedSteps: [],
          data: { companyName, authProvider: "telegram" } satisfies Prisma.InputJsonObject,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: "auth.telegram_signup",
          entityType: "tenant",
          entityId: tenant.id,
          ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
          ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
          payload: identity.auditPayload,
        },
      });

      return { user, tenant, role: membership.role };
    });

    isNewUser = true;
    const session = await this.issueSession(
      created.user,
      created.tenant,
      created.role,
      meta,
      "telegram",
    );
    return { ...session, data: { ...session.data, isNewUser } };
  }

  async requestEmailOtp(dto: RequestEmailOtpDto) {
    return this.emailOtpChallenges.request(dto);
  }

  async verifyEmailOtp(dto: VerifyEmailOtpDto, meta: AuthMeta = {}) {
    const challenge = await this.emailOtpChallenges.verify(dto);
    const now = challenge.verifiedAt;
    const token = randomBytes(32).toString("base64url");
    const sessionExpiresAt = new Date(now.getTime() + sessionTtlMs);
    return this.prisma.$transaction(async (tx) => {
      await this.emailOtpChallenges.consume(tx, challenge);

      const existing = await tx.user.findUnique({
        where: { email: challenge.email },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          locale: true,
          passwordChangeRequired: true,
          deletedAt: true,
          memberships: {
            orderBy: { createdAt: "asc" },
            include: {
              tenant: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  status: true,
                  businessType: true,
                  timezone: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      });

      const activeMembership = !existing?.deletedAt
        ? existing?.memberships.find((membership) => !membership.tenant.deletedAt)
        : undefined;
      let user: AuthUser;
      let tenant: AuthTenant;
      let role: MembershipRole;
      let isNewUser = false;

      if (existing && activeMembership) {
        user = await tx.user.update({
          where: { id: existing.id },
          data: existing.passwordChangeRequired ? { passwordChangeRequired: false } : {},
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            avatarUrl: true,
            locale: true,
            passwordChangeRequired: true,
          },
        });
        tenant = activeMembership.tenant;
        role = activeMembership.role;
      } else {
        const displayName = existing?.name?.trim() || emailNameSeed(challenge.email);
        const companyName = `${displayName} workspace`;
        const slug = await this.uniqueTenantSlug(companyName, tx);
        tenant = await tx.tenant.create({
          data: {
            name: companyName,
            slug,
            status: "TRIALING",
            businessType: "new email signup",
            timezone: "UTC",
            settings: {
              productName: "LeadVirt.ai",
              locale: localeSetting(challenge.locale),
              signupSource: "email_otp",
            } satisfies Prisma.InputJsonObject,
          },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            businessType: true,
            timezone: true,
          },
        });

        user = existing
          ? await tx.user.update({
              where: { id: existing.id },
              data: { name: displayName, deletedAt: null, passwordChangeRequired: false },
              select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                avatarUrl: true,
                locale: true,
                passwordChangeRequired: true,
              },
            })
          : await tx.user.create({
              data: { email: challenge.email, name: displayName, passwordChangeRequired: false },
              select: {
                id: true,
                email: true,
                phone: true,
                name: true,
                avatarUrl: true,
                locale: true,
                passwordChangeRequired: true,
              },
            });

        const membership = await tx.membership.create({
          data: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
          select: { role: true },
        });
        role = membership.role;
        await tx.onboardingState.create({
          data: {
            tenantId: tenant.id,
            currentStep: "business",
            completedSteps: [],
            data: { companyName, authProvider: "email_otp" } satisfies Prisma.InputJsonObject,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            actorUserId: user.id,
            action: "auth.email_signup",
            entityType: "tenant",
            entityId: tenant.id,
            ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
            ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
            payload: {
              email: user.email,
              deliveryMode: challenge.deliveryMode,
            } satisfies Prisma.InputJsonObject,
          },
        });
        isNewUser = true;
      }

      await tx.authSession.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          tokenHash: hashSecret(token),
          authMode: "email",
          expiresAt: sessionExpiresAt,
          ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
          ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: "auth.login",
          entityType: "auth_session",
          ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
          ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
          payload: {
            email: user.email,
            phone: user.phone,
            authMode: "email",
          } satisfies Prisma.InputJsonObject,
        },
      });

      return {
        token,
        expiresAt: sessionExpiresAt,
        data: { ...this.authPayload(user, tenant, role, sessionExpiresAt, "email"), isNewUser },
      };
    });
  }

  async logout(token: string | undefined) {
    if (!token) return { loggedOut: true };
    await this.prisma.authSession.updateMany({
      where: { tokenHash: hashSecret(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto, meta: AuthMeta = {}) {
    if (!credentialsAuthEnabled()) {
      throw new BadRequestException("Password reset is disabled. Use email sign-in.");
    }

    const delivery = this.emailDelivery.requirePasswordResetDelivery();
    const resetOrigin = passwordResetOrigin();
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, passwordHash: { not: null } },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: { tenantId: true },
        },
      },
    });

    if (!user?.passwordHash) {
      return { sent: true, deliveryMode: delivery.deliveryMode };
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSecret(token);
    const expiresAt = new Date(Date.now() + passwordResetTtlMs);
    const stagedAt = new Date();

    const resetToken = await this.prisma.authPasswordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        deliveryMode: delivery.deliveryMode,
        expiresAt,
        usedAt: stagedAt,
      },
      select: { id: true },
    });

    const resetUrl = `${resetOrigin}/reset-password?token=${encodeURIComponent(token)}`;
    let delivered: { providerMessageId: string };
    try {
      delivered = await this.emailDelivery.sendPasswordReset({
        resetId: resetToken.id,
        email: user.email,
        resetUrl,
      });
    } catch {
      console.error(JSON.stringify({ module: "auth", action: "password_reset_delivery_failed" }));
      return { sent: true, deliveryMode: delivery.deliveryMode };
    }

    const activation = await this.prisma.$transaction(async (tx) => {
      const userExists = await lockPasswordCredential(tx, user.id);
      const activatedAt = new Date();
      if (!userExists) return { activated: false } as const;

      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { deletedAt: true, passwordHash: true },
      });
      if (
        currentUser?.deletedAt ||
        !currentUser?.passwordHash ||
        currentUser.passwordHash !== user.passwordHash
      ) {
        return { activated: false } as const;
      }

      const stagedToken = await tx.authPasswordResetToken.findFirst({
        where: {
          id: resetToken.id,
          userId: user.id,
          tokenHash,
          usedAt: stagedAt,
          expiresAt: { gt: activatedAt },
        },
        select: { id: true },
      });
      if (!stagedToken) return { activated: false } as const;

      await tx.authPasswordResetToken.updateMany({
        where: {
          userId: user.id,
          id: { not: resetToken.id },
          usedAt: null,
        },
        data: { usedAt: activatedAt },
      });

      const activated = await tx.authPasswordResetToken.updateMany({
        where: {
          id: resetToken.id,
          tokenHash,
          usedAt: stagedAt,
          expiresAt: { gt: activatedAt },
        },
        data: { usedAt: null },
      });
      if (activated.count !== 1) {
        throw new ServiceUnavailableException("Password reset email could not be finalized.");
      }

      return { activated: true } as const;
    });

    const tenantId = user.memberships[0]?.tenantId;
    if (activation.activated && tenantId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            tenantId,
            actorUserId: user.id,
            action: "auth.password_reset_requested",
            entityType: "user",
            entityId: user.id,
            ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
            ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
            payload: {
              email: user.email,
              deliveryMode: delivery.deliveryMode,
              providerMessageId: delivered.providerMessageId,
            } satisfies Prisma.InputJsonObject,
          },
        });
      } catch {
        console.error(
          JSON.stringify({ module: "auth", action: "password_reset_request_audit_failed" }),
        );
      }
    }

    if (activation.activated && delivery.exposeResetUrl) {
      console.log(
        JSON.stringify({
          module: "auth",
          action: "password_reset_mock_delivery",
          email: user.email,
          resetUrl,
          expiresAt: expiresAt.toISOString(),
        }),
      );
    }

    return {
      sent: true,
      deliveryMode: delivery.deliveryMode,
      ...(activation.activated && delivery.exposeResetUrl
        ? { expiresAt: expiresAt.toISOString(), resetUrl }
        : {}),
    };
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto, meta: AuthMeta = {}) {
    const tokenHash = hashSecret(dto.token);
    const passwordHash = hashPassword(dto.newPassword);
    const revoked = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.authPasswordResetToken.findFirst({
        where: { tokenHash, usedAt: null },
        select: { userId: true },
      });
      if (!candidate || !(await lockPasswordCredential(tx, candidate.userId))) {
        throw new UnauthorizedException("Password reset link is invalid or expired.");
      }

      const now = new Date();
      const resetToken = await tx.authPasswordResetToken.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              deletedAt: true,
              memberships: {
                orderBy: { createdAt: "asc" },
                select: { tenantId: true },
              },
            },
          },
        },
      });

      if (!resetToken || resetToken.user.deletedAt) {
        throw new UnauthorizedException("Password reset link is invalid or expired.");
      }

      const consumed = await tx.authPasswordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("Password reset link is invalid or expired.");
      }

      await tx.authPasswordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
          usedAt: null,
        },
        data: { usedAt: now },
      });

      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          passwordChangeRequired: false,
        },
      });

      const revokedSessions = await tx.authSession.updateMany({
        where: {
          userId: resetToken.userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      const tenantId = resetToken.user.memberships[0]?.tenantId;
      if (tenantId) {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: resetToken.userId,
            action: "auth.password_reset_completed",
            entityType: "user",
            entityId: resetToken.userId,
            ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
            ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
            payload: { revokedSessions: revokedSessions.count } satisfies Prisma.InputJsonObject,
          },
        });
      }

      return revokedSessions;
    });

    return { updated: true, revokedSessions: revoked.count };
  }

  private async issueSession(
    user: AuthUser,
    tenant: AuthTenant,
    role: MembershipRole,
    meta: AuthMeta,
    authMode: AuthMode = "credentials",
  ) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        tokenHash: hashSecret(token),
        authMode,
        expiresAt,
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: "auth.login",
        entityType: "auth_session",
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        payload: {
          email: user.email,
          phone: user.phone,
          authMode,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return {
      token,
      expiresAt,
      data: this.authPayload(user, tenant, role, expiresAt, authMode),
    };
  }

  async changePassword(
    context: RequestContext,
    dto: { currentPassword: string; newPassword: string },
  ) {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("New password must be different from the current password.");
    }

    const user = await this.prisma.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
    if (!user?.passwordHash || !verifyPassword(dto.currentPassword, user.passwordHash)) {
      throw new UnauthorizedException("Current password is invalid.");
    }

    const nextPasswordHash = hashPassword(dto.newPassword);
    const revoked = await this.prisma.$transaction(async (tx) => {
      if (!(await lockPasswordCredential(tx, context.userId))) {
        throw new UnauthorizedException("Current password is invalid.");
      }

      const currentUser = await tx.user.findFirst({
        where: { id: context.userId, deletedAt: null },
        select: { passwordHash: true },
      });
      if (!currentUser?.passwordHash || currentUser.passwordHash !== user.passwordHash) {
        throw new UnauthorizedException("Current password is invalid.");
      }

      const changedAt = new Date();
      const changed = await tx.user.updateMany({
        where: {
          id: context.userId,
          deletedAt: null,
          passwordHash: user.passwordHash,
        },
        data: { passwordHash: nextPasswordHash, passwordChangeRequired: false },
      });
      if (changed.count !== 1) {
        throw new UnauthorizedException("Current password is invalid.");
      }

      await tx.authPasswordResetToken.updateMany({
        where: { userId: context.userId, usedAt: null },
        data: { usedAt: changedAt },
      });

      const revokedSessions = await tx.authSession.updateMany({
        where: {
          userId: context.userId,
          tenantId: context.tenantId,
          revokedAt: null,
          ...(context.sessionId ? { id: { not: context.sessionId } } : {}),
        },
        data: { revokedAt: changedAt },
      });

      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "auth.password_changed",
          entityType: "user",
          entityId: context.userId,
          payload: { revokedSessions: revokedSessions.count } satisfies Prisma.InputJsonObject,
        },
      });

      return revokedSessions;
    });

    return { updated: true, revokedSessions: revoked.count };
  }

  async listSessions(context: RequestContext) {
    const now = new Date();
    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId: context.userId,
        tenantId: context.tenantId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      current: session.id === context.sessionId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    }));
  }

  async revokeSession(context: RequestContext, sessionId: string) {
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        userId: context.userId,
        tenantId: context.tenantId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!session) {
      throw new BadRequestException("Session is not active.");
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "auth.session_revoked",
        entityType: "auth_session",
        entityId: session.id,
        payload: { current: session.id === context.sessionId } satisfies Prisma.InputJsonObject,
      },
    });

    return { id: session.id, revoked: true, current: session.id === context.sessionId };
  }

  async revokeOtherSessions(context: RequestContext) {
    const revoked = await this.prisma.authSession.updateMany({
      where: {
        userId: context.userId,
        tenantId: context.tenantId,
        revokedAt: null,
        ...(context.sessionId ? { id: { not: context.sessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "auth.other_sessions_revoked",
        entityType: "auth_session",
        payload: { count: revoked.count } satisfies Prisma.InputJsonObject,
      },
    });

    return { revoked: revoked.count };
  }

  async twoFactorStatus(context: RequestContext) {
    const user = await this.prisma.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      select: {
        twoFactorEnabled: true,
        twoFactorSecretEncrypted: true,
        twoFactorRecoveryCodes: true,
        twoFactorConfirmedAt: true,
      },
    });

    const recoveryCodesRemaining = user?.twoFactorEnabled
      ? recoveryCodeHashes(user.twoFactorRecoveryCodes).length
      : 0;
    return {
      enabled: Boolean(user?.twoFactorEnabled),
      setupPending: Boolean(user?.twoFactorSecretEncrypted && !user.twoFactorEnabled),
      confirmedAt: user?.twoFactorConfirmedAt?.toISOString() ?? null,
      recoveryCodesRemaining,
    };
  }

  async startTwoFactorSetup(context: RequestContext) {
    const status = await this.twoFactorStatus(context);
    if (status.enabled) {
      throw new BadRequestException("Two-factor authentication is already enabled.");
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: context.userId },
      data: {
        twoFactorSecretEncrypted: encryptTotpSecret(secret),
        twoFactorRecoveryCodes: [],
        twoFactorConfirmedAt: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "auth.two_factor_setup_started",
        entityType: "user",
        entityId: context.userId,
        payload: { authMode: context.authMode } satisfies Prisma.InputJsonObject,
      },
    });

    return {
      secret,
      otpauthUri: totpAuthUri({
        issuer: "LeadVirt.ai",
        accountName: context.user.phone ?? context.user.email,
        secret,
      }),
    };
  }

  async enableTwoFactor(context: RequestContext, code: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: context.userId, deletedAt: null },
      select: { twoFactorEnabled: true, twoFactorSecretEncrypted: true },
    });
    if (!user?.twoFactorSecretEncrypted) {
      throw new BadRequestException("Start two-factor setup before confirming it.");
    }
    if (user.twoFactorEnabled) {
      throw new BadRequestException("Two-factor authentication is already enabled.");
    }

    const secret = this.decryptUserTotpSecret(user.twoFactorSecretEncrypted);
    if (!verifyTotpCode(secret, code)) {
      throw new UnauthorizedException("Two-factor code is invalid.");
    }

    const recoveryCodes = generateRecoveryCodes();
    const confirmedAt = new Date();
    await this.prisma.user.update({
      where: { id: context.userId },
      data: {
        twoFactorEnabled: true,
        twoFactorConfirmedAt: confirmedAt,
        twoFactorRecoveryCodes: recoveryCodes.map((recoveryCode) =>
          hashPassword(normalizeRecoveryCode(recoveryCode)),
        ),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "auth.two_factor_enabled",
        entityType: "user",
        entityId: context.userId,
        payload: { recoveryCodes: recoveryCodes.length } satisfies Prisma.InputJsonObject,
      },
    });

    return {
      twoFactor: {
        enabled: true,
        setupPending: false,
        confirmedAt: confirmedAt.toISOString(),
        recoveryCodesRemaining: recoveryCodes.length,
      },
      recoveryCodes,
    };
  }

  async disableTwoFactor(context: RequestContext, currentPassword: string) {
    await this.assertCurrentPassword(context.userId, currentPassword);
    await this.prisma.user.update({
      where: { id: context.userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecretEncrypted: null,
        twoFactorRecoveryCodes: [],
        twoFactorConfirmedAt: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "auth.two_factor_disabled",
        entityType: "user",
        entityId: context.userId,
        payload: {} satisfies Prisma.InputJsonObject,
      },
    });

    return { twoFactor: await this.twoFactorStatus(context) };
  }

  async regenerateTwoFactorRecoveryCodes(context: RequestContext, currentPassword: string) {
    await this.assertCurrentPassword(context.userId, currentPassword);
    const status = await this.twoFactorStatus(context);
    if (!status.enabled) {
      throw new BadRequestException(
        "Enable two-factor authentication before regenerating recovery codes.",
      );
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: context.userId },
      data: {
        twoFactorRecoveryCodes: recoveryCodes.map((recoveryCode) =>
          hashPassword(normalizeRecoveryCode(recoveryCode)),
        ),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "auth.two_factor_recovery_codes_regenerated",
        entityType: "user",
        entityId: context.userId,
        payload: { recoveryCodes: recoveryCodes.length } satisfies Prisma.InputJsonObject,
      },
    });

    return {
      twoFactor: {
        ...status,
        recoveryCodesRemaining: recoveryCodes.length,
      },
      recoveryCodes,
    };
  }

  private authPayload(
    user: AuthUser,
    tenant: AuthTenant,
    role: MembershipRole,
    expiresAt: Date,
    authMode: AuthMode,
  ) {
    return {
      ...user,
      role,
      tenantId: tenant.id,
      authMode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async uniqueTenantSlug(
    companyName: string,
    client: Pick<Prisma.TransactionClient, "tenant"> = this.prisma,
  ) {
    const root = baseSlug(companyName);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix =
        attempt === 0 ? randomBytes(3).toString("hex") : randomBytes(4).toString("hex");
      const slug = `${root}-${suffix}`.slice(0, 64).replace(/-$/g, "");
      const exists = await client.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) return slug;
    }
    throw new BadRequestException("Could not create a unique workspace slug.");
  }

  private decryptUserTotpSecret(encryptedSecret: string) {
    try {
      return decryptTotpSecret(encryptedSecret);
    } catch {
      throw new BadRequestException("Two-factor setup is not readable. Restart setup.");
    }
  }

  private async assertCurrentPassword(userId: string, currentPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException("Current password is invalid.");
    }
  }

  private async verifyLoginTwoFactor(
    user: {
      id: string;
      twoFactorSecretEncrypted: string | null;
      twoFactorRecoveryCodes: Prisma.JsonValue | null;
    },
    code: string | undefined,
    tenantId: string,
  ) {
    if (!code) {
      throw new UnauthorizedException("Two-factor code is required.");
    }

    if (
      user.twoFactorSecretEncrypted &&
      verifyTotpCode(this.decryptUserTotpSecret(user.twoFactorSecretEncrypted), code)
    ) {
      return;
    }

    const hashes = recoveryCodeHashes(user.twoFactorRecoveryCodes);
    const recoveryCode = normalizeRecoveryCode(code);
    const usedIndex = hashes.findIndex((hash) => verifyPassword(recoveryCode, hash));
    if (usedIndex >= 0) {
      const remaining = hashes.filter((_, index) => index !== usedIndex);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorRecoveryCodes: remaining },
      });
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: user.id,
          action: "auth.two_factor_recovery_code_used",
          entityType: "user",
          entityId: user.id,
          payload: { recoveryCodesRemaining: remaining.length } satisfies Prisma.InputJsonObject,
        },
      });
      return;
    }

    throw new UnauthorizedException("Two-factor code is invalid.");
  }
}
