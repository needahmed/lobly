import bundled from "@lobly/lcu-endpoints";
import { BACKEND_URL } from "../../config";
import { appStore } from "@lobly/client-core";

export interface EndpointDef {
  method: string;
  path: string;
}

export interface EndpointMap {
  version: number;
  endpoints: Record<string, EndpointDef>;
  wsEvents: Record<string, string>;
}

const STORAGE_KEY = "lobly.lcu-endpoints";

let map: EndpointMap = structuredClone(bundled as EndpointMap);

export function getEndpoint(name: string): EndpointDef {
  const ep = map.endpoints[name];
  if (!ep) throw new Error(`Unknown LCU endpoint: ${name}`);
  return ep;
}

export function getWsEvent(name: string): string | undefined {
  return map.wsEvents[name];
}

export function getEndpointMap(): EndpointMap {
  return map;
}

function loadCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const remote = JSON.parse(raw) as EndpointMap;
    if (remote.version > map.version) {
      map = remote;
      appStore.logLine(`LCU endpoints loaded from cache v${remote.version}`);
    }
  } catch {
    /* ignore */
  }
}

/** Phase 3: pull remote map if version is higher. Safe to call in Phase 1. */
export async function refreshEndpointsFromBackend(): Promise<void> {
  loadCached();
  try {
    const res = await fetch(`${BACKEND_URL}/config/lcu-endpoints`);
    if (!res.ok) return;
    const remote = (await res.json()) as EndpointMap;
    if (remote.version > map.version) {
      map = remote;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      appStore.logLine(`LCU endpoints updated from backend v${remote.version}`);
    }
  } catch {
    /* mock/backend may be offline */
  }
}

loadCached();
