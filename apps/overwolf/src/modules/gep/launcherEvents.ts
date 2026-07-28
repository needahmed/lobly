import { appStore, onGameflowPhase, onLobbyChanged, redactPuuid } from "@lobly/client-core";
import { onLcuCredentials, scheduleLockfileFallback } from "../lcu/credentials";
import type { GameflowPhase } from "@lobly/shared-types";

const LAUNCHER_ID = 10902;
const FEATURES = [
  "game_flow",
  "summoner_info",
  "lobby_info",
  "champ_select",
  "end_game",
  "lcu_info",
];

const DEBUG = false;
let listening = false;

export function startLauncherEvents(attempt = 0) {
  scheduleLockfileFallback();

  overwolf.games.launchers.events.setRequiredFeatures(LAUNCHER_ID, FEATURES, (res) => {
    if (!res.success) {
      if (attempt < 20) {
        appStore.logLine(`GEP setRequiredFeatures retry ${attempt + 1}/20: ${res.error}`);
        setTimeout(() => startLauncherEvents(attempt + 1), 3000);
      } else {
        appStore.logLine(`GEP setRequiredFeatures FAILED permanently: ${res.error}`);
      }
      return;
    }

    const supported = (res as any).supportedFeatures ?? FEATURES;
    appStore.update({ gep: { features: supported, active: true } });
    appStore.logLine(`GEP features active: ${JSON.stringify(supported)}`);

    if (!listening) {
      overwolf.games.launchers.events.onInfoUpdates.addListener(handleInfoUpdate);
      overwolf.games.launchers.events.onNewEvents.addListener(handleNewEvents);
      listening = true;
    }

    overwolf.games.launchers.events.getInfo(LAUNCHER_ID, (info) => {
      handleInfoSnapshot(info);
    });
  });
}

function handleInfoUpdate(payload: any) {
  if (DEBUG) console.log("[GEP info]", payload);
  const feature = payload?.feature as string | undefined;
  const info = payload?.info ?? payload;
  routeInfo(feature, info);
}

function handleInfoSnapshot(infoRes: any) {
  if (!infoRes?.success && infoRes?.res == null && !infoRes?.info) {
    // older shape: { success, res } or direct
  }
  const info = infoRes?.res ?? infoRes?.info ?? infoRes;
  if (DEBUG) console.log("[GEP snapshot]", info);
  if (!info || typeof info !== "object") return;

  // Snapshot often nests by feature name
  for (const [feature, categoryMap] of Object.entries(info)) {
    if (categoryMap && typeof categoryMap === "object") {
      routeInfo(feature, { [feature]: categoryMap, ...categoryMap } as any);
      // Also walk categories
      for (const [cat, keys] of Object.entries(categoryMap as object)) {
        if (keys && typeof keys === "object") {
          routeCategory(feature, cat, keys as Record<string, unknown>);
        } else {
          routeKey(feature, cat, keys);
        }
      }
    }
  }
}

function handleNewEvents(payload: any) {
  if (DEBUG) console.log("[GEP events]", payload);
  const events = payload?.events ?? [];
  for (const ev of events) {
    if (ev?.name === "end_game" || payload?.feature === "end_game") {
      appStore.update({ sessionEndPending: true });
      appStore.logLine("GEP end_game event");
    }
  }
}

function routeInfo(feature: string | undefined, info: any) {
  if (!info || typeof info !== "object") return;

  // Common shapes:
  // { lcu_info: { credentials: { token, port } } }
  // { info: { credentials: { token, port } }, feature: "lcu_info" }
  if (feature === "lcu_info" || info.lcu_info || info.credentials) {
    const creds =
      info.lcu_info?.credentials ?? info.credentials ?? info.lcu_info ?? info;
    const port = pickString(creds, "port") ?? pickNested(info, ["credentials", "port"]);
    const token = pickString(creds, "token") ?? pickNested(info, ["credentials", "token"]);
    if (port || token) onLcuCredentials({ port: port ?? undefined, token: token ?? undefined });
  }

  if (feature === "game_flow" || info.game_flow || info.phase != null) {
    const phase =
      pickString(info.game_flow ?? info, "phase") ??
      pickNested(info, ["game_flow", "phase"]);
    if (phase) onGameflowPhase(phase as GameflowPhase);
  }

  if (feature === "summoner_info" || info.summoner_info) {
    const s = info.summoner_info ?? info;
    updateSummonerFromGep(s);
  }

  if (feature === "lobby_info" || info.lobby_info || info.queueId != null || info.player_info) {
    void onLobbyChanged();
  }

  if (feature === "end_game" || info.end_game) {
    appStore.update({ sessionEndPending: true });
  }
}

function routeCategory(feature: string, category: string, keys: Record<string, unknown>) {
  if (feature === "lcu_info" && category === "credentials") {
    const port = stringify(keys.port);
    const token = stringify(keys.token);
    if (port || token) onLcuCredentials({ port: port ?? undefined, token: token ?? undefined });
  }
  if ((feature === "game_flow" || category === "game_flow") && keys.phase != null) {
    onGameflowPhase(String(keys.phase) as GameflowPhase);
  }
  if (feature === "summoner_info") {
    updateSummonerFromGep(keys);
  }
  if (feature === "lobby_info") {
    void onLobbyChanged();
  }
}

function routeKey(feature: string | undefined, key: string, value: unknown) {
  if (feature === "lcu_info" || key === "token" || key === "port") {
    if (key === "port") onLcuCredentials({ port: stringify(value) ?? undefined });
    if (key === "token") onLcuCredentials({ token: stringify(value) ?? undefined });
  }
  if (key === "phase" && value != null) {
    onGameflowPhase(String(value) as GameflowPhase);
  }
}

function updateSummonerFromGep(s: Record<string, unknown>) {
  const display = stringify(s.display_name) ?? stringify(s.displayName);
  const summonerId = Number(s.summoner_id ?? s.summonerId);
  const platform = stringify(s.platform_id ?? s.platformId) ?? "unknown";
  let gameName = "";
  let tagLine = "";
  if (display?.includes("#")) {
    [gameName, tagLine] = display.split("#");
  }
  const prev = appStore.state.summoner;
  appStore.update({
    summoner: {
      puuid: prev?.puuid ?? "",
      gameName: gameName || prev?.gameName || "",
      tagLine: tagLine || prev?.tagLine || "",
      summonerId: Number.isFinite(summonerId) ? summonerId : prev?.summonerId ?? 0,
      platform,
    },
  });
  if (DEBUG) {
    appStore.logLine(`GEP summoner_info ${display} ${redactPuuid(prev?.puuid)}`);
  }
}

function pickString(obj: any, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  return stringify(obj[key]);
}

function pickNested(obj: any, path: string[]): string | null {
  let cur = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return stringify(cur);
}

function stringify(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    // player_info may be JSON string
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}
