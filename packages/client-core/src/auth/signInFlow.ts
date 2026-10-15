import { adoptLinkedAccounts, ensureDefaultPrefs } from "../api/session";
import { appStore } from "../state/store";
import { syncAgent } from "../sync/syncAgent";
import { riotSignIn } from "./riotSignIn";

/** Store tokens, open the socket, and seed prefs after a League icon challenge. */
export async function completeRiotSignIn(): Promise<void> {
  appStore.update({ signInPhase: "Changing your icon…" });
  try {
    const tokens = await riotSignIn();
    const puuid = appStore.state.summoner?.puuid;
    appStore.update({
      authenticated: true,
      authExpired: false,
      accountMismatch: false,
      apiUnreachable: false,
      hasStoredSession: true,
      authChecked: true,
      signInPhase: "Restoring icon…",
      linkedLcuPuuids: puuid
        ? [...new Set([...(appStore.state.linkedLcuPuuids ?? []), puuid])]
        : appStore.state.linkedLcuPuuids,
    });
    syncAgent.disconnect();
    syncAgent.connect(tokens.accessToken);
    await ensureDefaultPrefs().catch((e: any) =>
      appStore.logLine(`prefs: ${e?.message ?? e}`)
    );
    await adoptLinkedAccounts().catch((e: any) =>
      appStore.logLine(`accounts: ${e?.message ?? e}`)
    );
    appStore.logLine("Signed in with League client");
  } finally {
    appStore.update({ signInPhase: null });
  }
}

/** Add another League account to the signed-in user via the same icon challenge. */
export async function linkAnotherAccount(): Promise<void> {
  const { linkCurrentSummoner } = await import("../api/session");
  appStore.update({ signInPhase: "Changing your icon…" });
  try {
    appStore.update({ signInPhase: "Verifying with Riot…" });
    const account = await linkCurrentSummoner();
    if (!account) throw new Error("Not signed in");
    await adoptLinkedAccounts().catch(() => undefined);
    syncAgent.disconnect();
    syncAgent.connect();
    appStore.logLine("Riot account linked");
  } finally {
    appStore.update({ signInPhase: null });
  }
}
