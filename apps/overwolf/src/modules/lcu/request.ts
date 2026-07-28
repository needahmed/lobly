import { getEndpoint } from "./endpoints";
import { getCreds } from "./credentials";

export class LcuError extends Error {
  constructor(
    public status: number | "network",
    public body?: unknown
  ) {
    super(`LCU ${status}`);
    this.name = "LcuError";
  }
}

export async function lcuRequest<T>(
  name: string,
  opts: { params?: Record<string, string>; body?: unknown; retries?: number } = {}
): Promise<T> {
  const { method, path } = getEndpoint(name);
  const creds = getCreds();
  let url = `https://127.0.0.1:${creds.port}${path}`;
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    url = url.replace(`{${k}}`, encodeURIComponent(v));
  }

  const retries = opts.retries ?? 2;
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${creds.token}`,
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 404 && method === "GET") return null as T;
      if (!res.ok) {
        throw new LcuError(res.status, await res.json().catch(() => undefined));
      }
      return res.status === 204 ? (undefined as T) : await res.json();
    } catch (e) {
      const retriable =
        e instanceof LcuError ? e.status === 429 || (typeof e.status === "number" && e.status >= 500) : true;
      if (i >= retries || !retriable) throw e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
}

/** Direct REST for the LCU Lab spike (bypasses endpoint map). */
export async function lcuRawFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const creds = getCreds();
  const res = await fetch(`https://127.0.0.1:${creds.port}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${creds.token}`,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, body };
}
