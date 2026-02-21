const envApiBase = String(import.meta.env.VITE_API_BASE ?? "").trim();
export const API_BASE = (envApiBase || "http://localhost:8000").replace(/\/+$/, "");
const TOKEN_KEY = "auth_token";

function buildRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

type RequestOptions = RequestInit & { signal?: AbortSignal };

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("X-Request-ID", buildRequestId());

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const fallback = await res.text();
    let payload:
      | {
          error?: { message?: string; code?: string };
          request_id?: string;
        }
      | null = null;
    try {
      payload = JSON.parse(fallback) as {
        error?: { message?: string; code?: string };
        request_id?: string;
      };
    } catch {
      payload = null;
    }
    const message = payload?.error?.message || fallback || `HTTP ${res.status}`;
    const code = payload?.error?.code ? `[${payload.error.code}] ` : "";
    const requestId = payload?.request_id ? ` (request_id: ${payload.request_id})` : "";
    throw new Error(`${code}${message}${requestId}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const payload = await res.json();
  if (
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    (payload as { ok?: boolean }).ok === true &&
    "data" in payload
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export async function apiGet<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "GET", signal: options?.signal });
}

export async function apiPost<T>(path: string, body: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export async function apiDelete<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "DELETE", signal: options?.signal });
}

export async function apiDownload(path: string, options?: { signal?: AbortSignal }): Promise<Blob> {
  const token = getToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("X-Request-ID", buildRequestId());

  const res = await fetch(`${API_BASE}${path}`, { method: "GET", headers, signal: options?.signal });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.blob();
}
