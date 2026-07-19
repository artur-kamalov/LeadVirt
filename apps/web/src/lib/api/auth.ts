import type { User, UserRole } from "@leadvirt/types";
import { apiData, jsonBody } from "./client";

export interface AuthMe extends User {
  locale?: "en" | "es" | "fr" | "de" | "pt" | "ru" | null;
  role: UserRole;
  tenantId: string;
  authMode: "credentials" | "email" | "telegram";
  expiresAt?: string;
  isNewUser?: boolean;
}

export type EmailOtpConfig = {
  enabled: boolean;
  codeLength: number;
  resendAfterSeconds: number;
};

export type EmailOtpRequest = {
  sent: boolean;
  challengeId: string;
  expiresAt: string;
  resendAfterSeconds: number;
  debugCode?: string;
};

export function getAuthMe() {
  return apiData<AuthMe>("/auth/me");
}

export function loginWithPassword(input: {
  email: string;
  password: string;
  twoFactorCode?: string;
}) {
  return apiData<AuthMe>("/auth/login", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function signupWithPassword(input: {
  email: string;
  password: string;
  companyName?: string;
}) {
  return apiData<AuthMe>("/auth/signup", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function getEmailOtpConfig() {
  return apiData<EmailOtpConfig>("/auth/email-otp/config");
}

export function requestEmailOtp(input: { email: string; locale: string }) {
  return apiData<EmailOtpRequest>("/auth/email-otp/request", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function verifyEmailOtp(input: { challengeId: string; code: string }) {
  return apiData<AuthMe>("/auth/email-otp/verify", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function requestPasswordReset(input: { email: string }) {
  return apiData<{ sent: boolean; deliveryMode: string; expiresAt?: string; resetUrl?: string }>(
    "/auth/password-reset/request",
    {
      method: "POST",
      ...jsonBody(input),
    },
  );
}

export function confirmPasswordReset(input: { token: string; newPassword: string }) {
  return apiData<{ updated: boolean; revokedSessions: number }>("/auth/password-reset/confirm", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function logout() {
  return apiData<{ loggedOut: boolean }>("/auth/logout", { method: "POST" });
}
