import type { User, UserRole } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export interface AuthMe extends User {
  role: UserRole;
  tenantId: string;
  authMode: "credentials" | "telegram";
  expiresAt?: string;
  isNewUser?: boolean;
}

export type TelegramAuthPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export type TelegramLoginConfig = {
  botId: string | null;
  botUsername?: string | null;
};

export type TelegramOidcAuthPayload = {
  idToken: string;
  nonce?: string;
};

export function getAuthMe() {
  return apiData<AuthMe>("/auth/me");
}

export function loginWithPassword(input: { email: string; password: string; twoFactorCode?: string }) {
  return apiData<AuthMe>("/auth/login", {
    method: "POST",
    ...jsonBody(input)
  });
}

export function signupWithPassword(input: { email: string; password: string; companyName?: string }) {
  return apiData<AuthMe>("/auth/signup", {
    method: "POST",
    ...jsonBody(input)
  });
}

export function loginWithTelegram(input: TelegramAuthPayload) {
  return apiData<AuthMe>("/auth/telegram", {
    method: "POST",
    ...jsonBody(input)
  });
}

export function loginWithTelegramOidc(input: TelegramOidcAuthPayload) {
  return apiData<AuthMe>("/auth/telegram/oidc", {
    method: "POST",
    ...jsonBody(input)
  });
}

export function getTelegramLoginConfig() {
  return apiData<TelegramLoginConfig>("/auth/telegram/config");
}

export function requestPasswordReset(input: { email: string }) {
  return apiData<{ sent: boolean; deliveryMode: string; expiresAt?: string; resetUrl?: string }>("/auth/password-reset/request", {
    method: "POST",
    ...jsonBody(input)
  });
}

export function confirmPasswordReset(input: { token: string; newPassword: string }) {
  return apiData<{ updated: boolean; revokedSessions: number }>("/auth/password-reset/confirm", {
    method: "POST",
    ...jsonBody(input)
  });
}

export function logout() {
  return apiData<{ loggedOut: boolean }>("/auth/logout", { method: "POST" });
}
