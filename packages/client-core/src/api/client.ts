import { getHostAdapter } from "../hostAdapter";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(typeof body === "object" && body && "message" in body
      ? String((body as any).message)
      : `HTTP ${status}`);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let refreshToken: string | null = null;

const STORAGE_KEY = "lobly.auth";

export function loadStoredAuth(): { accessToken: string; refreshToken: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accessToken: string; refreshToken: string };
    accessToken = parsed.accessToken;
    refreshToken = parsed.refreshToken;
    return parsed;
  } catch {
    return null;
  }
}

export function storeAuth(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ accessToken: access, refreshToken: refresh })
  );
}

export function clearAuth() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Supplies the access token from somewhere other than this module's own
 * state. Needed by UI-only JS contexts that never log in themselves: an
 * Electron renderer is a separate context from the main process that owns
 * the session, so without this its `accessToken` stays null and every
 * authenticated request 401s. `force` asks the owner to refresh first.
 */
export type AuthTokenProvider = (force?: boolean) => Promise<string | null>;

let tokenProvider: AuthTokenProvider | null = null;

export function setAuthTokenProvider(provider: AuthTokenProvider | null) {
  tokenProvider = provider;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  auth = true
): Promise<T> {
  return apiFetchInner<T>(path, init, auth, false);
}

async function apiFetchInner<T>(
  path: string,
  init: RequestInit,
  auth: boolean,
  retried: boolean
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };

  const token = auth
    ? tokenProvider
      ? await tokenProvider(retried).catch(() => null)
      : accessToken
    : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const backendUrl = getHostAdapter().backendUrl;
  const res = await fetch(`${backendUrl}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (res.status === 401 && auth && !retried) {
    // Delegated auth: ask the owning context to refresh and try once more.
    if (tokenProvider) return apiFetchInner<T>(path, init, auth, true);
    if (refreshToken && (await tryRefresh())) {
      return apiFetchInner<T>(path, init, auth, true);
    }
  }

  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const backendUrl = getHostAdapter().backendUrl;
    const res = await fetch(`${backendUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearAuth();
      return false;
    }
    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    storeAuth(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearAuth();
    return false;
  }
}
