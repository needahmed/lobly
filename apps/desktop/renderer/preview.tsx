/**
 * Design preview harness — renders the real App against the real backend in
 * a plain browser, with a stub bridge standing in for the Electron preload.
 * Dev-only: never bundled into the shipped app (separate Vite entry).
 */
import { createRoot } from "react-dom/client";
import {
  App,
  appStore,
  configureLoblyCore,
  createNoopHostAdapter,
  storeAuth,
} from "@lobly/client-core";

const BACKEND = "http://localhost:8790";

configureLoblyCore(createNoopHostAdapter(BACKEND));

// Minimal stand-in for preload's contextBridge bridge.
(window as any).lobly = {
  store: appStore,
  dispatch: (e: unknown) => console.log("[preview] dispatch", e),
  canPublish: () => ({ ok: false, reason: "Preview mode — no League client" }),
  setToast: (m: string) => appStore.setToast(m),
  refreshBoard: async () => {
    const { fetchBoard } = await import("@lobly/client-core");
    appStore.update({ board: await fetchBoard() });
  },
  sendChat: (s: string, b: string) => console.log("[preview] chat", s, b),
  acceptJoin: async () => undefined,
  declineJoin: async () => undefined,
};

async function boot() {
  const res = await fetch(`${BACKEND}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "dev@lobly.local",
      password: "lobly-dev-password",
    }),
  });
  const tokens = await res.json();
  storeAuth(tokens.accessToken, tokens.refreshToken);

  // Fake the client-connected state so the shell renders its live styling.
  appStore.update({
    lcu: { connected: true, port: "61727" },
    sync: { connected: true },
    gameflowPhase: "Lobby",
    summoner: {
      puuid: "preview",
      gameName: "NeedAhmed",
      tagLine: "main",
      summonerId: 3527195321779392,
      platform: "me1",
    },
  });
  appStore.logLine("Preview harness booted");
  appStore.logLine("LCU credentials found via LeagueClientUx.exe (port 61727)");
  appStore.logLine("Summoner verified: NeedAhmed#main (me1)");

  createRoot(document.getElementById("root")!).render(<App />);
}

void boot();
