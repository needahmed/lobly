import { getHostAdapter } from "../hostAdapter";
export class ApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(typeof body === "object" && body && "message" in body
            ? String(body.message)
            : `HTTP ${status}`);
        this.status = status;
        this.body = body;
        this.name = "ApiError";
    }
}
let accessToken = null;
let refreshToken = null;
const STORAGE_KEY = "lobly.auth";
export function loadStoredAuth() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        accessToken = parsed.accessToken;
        refreshToken = parsed.refreshToken;
        return parsed;
    }
    catch {
        return null;
    }
}
export function storeAuth(access, refresh) {
    accessToken = access;
    refreshToken = refresh;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: access, refreshToken: refresh }));
}
export function clearAuth() {
    accessToken = null;
    refreshToken = null;
    localStorage.removeItem(STORAGE_KEY);
}
export function getAccessToken() {
    return accessToken;
}
export function getRefreshToken() {
    return refreshToken;
}
/** Wraps the private refresh used by 401 retries. True when new tokens were stored. */
export async function refreshAccessToken() {
    if (!refreshToken)
        loadStoredAuth();
    return tryRefresh();
}
export async function logoutRemote() {
    const token = refreshToken;
    if (!token)
        return;
    try {
        const backendUrl = getHostAdapter().backendUrl;
        await fetch(`${backendUrl}/v1/auth/logout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: token }),
        });
    }
    catch {
        /* local clear still happens */
    }
}
let tokenProvider = null;
export function setAuthTokenProvider(provider) {
    tokenProvider = provider;
}
export async function apiFetch(path, init = {}, auth = true) {
    return apiFetchInner(path, init, auth, false);
}
async function apiFetchInner(path, init, auth, retried) {
    const headers = {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
    };
    const token = auth
        ? tokenProvider
            ? await tokenProvider(retried).catch(() => null)
            : accessToken
        : null;
    if (token)
        headers.Authorization = `Bearer ${token}`;
    const backendUrl = getHostAdapter().backendUrl;
    const res = await fetch(`${backendUrl}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (res.status === 401 && auth && !retried) {
        // Delegated auth: ask the owning context to refresh and try once more.
        if (tokenProvider)
            return apiFetchInner(path, init, auth, true);
        if (refreshToken && (await tryRefresh())) {
            return apiFetchInner(path, init, auth, true);
        }
    }
    if (!res.ok)
        throw new ApiError(res.status, body);
    return body;
}
async function tryRefresh() {
    if (!refreshToken)
        return false;
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
        const data = (await res.json());
        storeAuth(data.accessToken, data.refreshToken);
        return true;
    }
    catch {
        clearAuth();
        return false;
    }
}
