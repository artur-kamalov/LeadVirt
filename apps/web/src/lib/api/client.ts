import type { ApiEnvelope } from "@leadvirt/types";
import { demoApiRequest, shouldUseDemoApi } from "./demo-runtime";

const defaultApiUrl = "http://localhost:4001/api";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL ?? defaultApiUrl).replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return "API request failed";
  const message = payload.message;
  if (Array.isArray(message)) return message.filter((item): item is string => typeof item === "string").join(", ");
  if (typeof message === "string") return message;
  if (typeof payload.error === "string") return payload.error;
  return "API request failed";
}

function urlFor(path: string) {
  if (path.startsWith("http")) return path;
  return `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function withQuery<TQuery extends object>(path: string, query: TQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if ((typeof value === "string" || typeof value === "number" || typeof value === "boolean") && value !== "") {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (shouldUseDemoApi()) {
    return Promise.resolve(demoApiRequest<T>(path, init));
  }

  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(urlFor(path), {
    ...init,
    credentials: init.credentials ?? "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiClientError(messageFromPayload(payload), response.status);
  }
  return payload as T;
}

export async function apiData<T>(path: string, init: RequestInit = {}): Promise<T> {
  const envelope = await apiRequest<ApiEnvelope<T>>(path, init);
  return envelope.data;
}

export function jsonBody(body: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(body) };
}
