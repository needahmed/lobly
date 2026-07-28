import type { LcuCredentials } from "@lobly/shared-types";
import { appStore, redactPuuid } from "@lobly/client-core";
import { lcuRequest } from "./request";
import { isLeagueLauncherId, owCall } from "../../shared/ow";

let creds: LcuCredentials | null = null;
let pending: Partial<LcuCredentials> = {};
let lockfileTimer: ReturnType<typeof setTimeout> | null = null;
let verifying = false;

export function getCreds(): LcuCredentials {
  if (!creds) throw new Error("LCU not connected");
  return creds;
}

export function hasCreds(): boolean {
  return creds !== null;
}

export function clearCreds() {
  creds = null;
  pending = {};
  if (lockfileTimer) {
    clearTimeout(lockfileTimer);
    lockfileTimer = null;
  }
  appStore.setLcuDown();
}

export function onLcuCredentials(partial: Partial<LcuCredentials>) {
  pending = { ...pending, ...partial };
  if (pending.port && pending.token) {
    const next = { port: pending.port, token: pending.token };
    const changed = !creds || creds.port !== next.port || creds.token !== next.token;
    creds = next;
    // Never log token
    appStore.update({
      lcu: { connected: true, port: next.port },
    });
    if (changed) {
      appStore.logLine(`LCU credentials ready (port ${next.port})`);
      void verifySummoner();
    }
    if (lockfileTimer) {
      clearTimeout(lockfileTimer);
      lockfileTimer = null;
    }
  }
}

async function verifySummoner() {
  if (!creds || verifying) return;
  verifying = true;
  try {
    const s = await lcuRequest<any>("currentSummoner");
    if (!s) {
      appStore.logLine("currentSummoner returned empty");
      return;
    }
    // current-summoner has no platform/region field — only
    // /riotclient/region-locale exposes it.
    let platform = appStore.state.summoner?.platform || "unknown";
    try {
      const rl = await lcuRequest<any>("regionLocale");
      if (rl?.region) platform = String(rl.region).toLowerCase();
    } catch {
      /* keep previous/unknown — link endpoint rejects this cleanly */
    }
    appStore.update({
      summoner: {
        puuid: s.puuid,
        gameName: s.gameName ?? s.displayName?.split("#")[0] ?? "",
        tagLine: s.tagLine ?? "",
        summonerId: Number(s.summonerId),
        platform,
      },
    });
    appStore.logLine(
      `Summoner verified: ${s.gameName ?? "?"}#${s.tagLine ?? "?"} (${redactPuuid(s.puuid)})`
    );
  } catch (e: any) {
    appStore.logLine(`Summoner verify failed: ${e?.message ?? e}`);
  } finally {
    verifying = false;
  }
}

/** Fallback: read lockfile if GEP never delivers lcu_info within 30s. */
export function scheduleLockfileFallback() {
  if (lockfileTimer || creds) return;
  lockfileTimer = setTimeout(() => {
    lockfileTimer = null;
    if (creds) return;
    void tryLockfileFallback();
  }, 30_000);
}

async function tryLockfileFallback() {
  appStore.logLine("GEP lcu_info missing — trying lockfile fallback");
  try {
    const info = await owCall<any>((cb) =>
      overwolf.games.launchers.getRunningLaunchersInfo(cb)
    );
    const lol = info.launchers?.find((l: any) => isLeagueLauncherId(l.id));
    if (!lol?.path) {
      appStore.logLine("Lockfile fallback: launcher path not found");
      return;
    }
    // path is typically the LeagueClient.exe; lockfile sits beside it
    const dir = lol.path.replace(/[/\\][^/\\]+$/, "");
    const lockPath = `${dir}\\lockfile`.replace(/\//g, "\\");

    const contents = await new Promise<string>((resolve, reject) => {
      overwolf.io.readFileContents(
        lockPath,
        (overwolf.io.enums as any).eEncoding.UTF8,
        (res) => {
          if (!res.success || res.content == null) {
            reject(new Error(res.error ?? "readFileContents failed"));
          } else {
            resolve(res.content);
          }
        }
      );
    });

    // name:pid:port:password:https
    const parts = contents.trim().split(":");
    if (parts.length < 5) {
      appStore.logLine("Lockfile fallback: unexpected format");
      return;
    }
    const port = parts[2];
    const password = parts[3];
    const token = btoa(`riot:${password}`);
    onLcuCredentials({ port, token });
    appStore.logLine("Lockfile fallback succeeded");
  } catch (e: any) {
    appStore.logLine(`Lockfile fallback failed: ${e?.message ?? e}`);
  }
}
