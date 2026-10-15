import { restoreWindow, showWindowBehind, isLeagueLauncherId } from "../../shared/ow";
import { startLauncherEvents } from "../../modules/gep/launcherEvents";
import { startGameEvents } from "../../modules/gep/gameEvents";
import { clearCreds } from "../../modules/lcu/credentials";
import { lcuRequest } from "../../modules/lcu/request";
import { lcuEventBus } from "../../modules/lcu/eventBus";
import { refreshEndpointsFromBackend } from "../../modules/lcu/endpoints";
import {
  spikeRestGet,
  spikeRestPost,
  spikeWsA,
  spikeWsB,
} from "../../modules/lcu/spike";
import { BACKEND_URL } from "../../config";
import {
  appStore,
  configureLoblyCore,
  dispatchMachine,
  canPublish,
  publishWithDraft,
  wireListingMachineToBus,
  syncAgent,
  startSessionBootstrap,
  ensureSession,
  signOut,
  completeRiotSignIn,
  linkAnotherAccount,
  loadClientSettings,
  watchClientSettings,
  gameFlowTracker,
  type LoblyBridge,
} from "@lobly/client-core";

function isDesktopHidden(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      overwolf.windows.getWindowState("desktop", (res: any) => {
        resolve(res?.window_state === "minimized" || res?.window_state === "hidden");
      });
    } catch {
      resolve(false);
    }
  });
}

async function boot() {
  // Overwolf's LCU access: fetch-based REST wrapper + GEP-driven event bus.
  // See 00_BUILD_OVERVIEW.md C1/C2/C13 for why this differs from Electron.
  const devAuth = import.meta.env.VITE_LOBLY_DEV_AUTH === "1";
  configureLoblyCore({
    backendUrl: BACKEND_URL,
    lcuTransport: { request: lcuRequest },
    eventBus: lcuEventBus,
    isDesktopHidden,
    showWindowInactive: () => {
      void showWindowBehind("desktop");
    },
    isDevAuthEnabled: () => devAuth,
    notify: (_title, _body, opts) => {
      if (!appStore.state.notificationsEnabled) return;
      void restoreWindow("notifications");
      if (opts?.tab) appStore.update({ uiTab: opts.tab });
    },
  });

  const bridge: LoblyBridge = {
    store: appStore,
    dispatch: dispatchMachine,
    canPublish,
    publish: (draft) => publishWithDraft(draft as never),
    setToast: (m) => appStore.setToast(m),
    refreshBoard: async () => {
      const { fetchBoard } = await import("@lobly/client-core");
      const rows = await fetchBoard();
      appStore.update({ board: rows });
      appStore.logLine(`Board: ${rows.length} eligible listings`);
    },
    sendChat: (sessionId, body) => syncAgent.sendChat(sessionId, body),
    acceptJoin: async (joinRequestId) => {
      const { acceptJoin } = await import("@lobly/client-core");
      await acceptJoin(joinRequestId);
    },
    declineJoin: async (joinRequestId) => {
      const { declineJoin } = await import("@lobly/client-core");
      await declineJoin(joinRequestId);
    },
    navigate: (tab) => appStore.update({ uiTab: tab }),
    riotSignIn: async () => {
      await completeRiotSignIn();
    },
    linkAnotherAccount: async () => {
      await linkAnotherAccount();
    },
    devSignIn: async (email, password) => {
      await ensureSession(email, password);
    },
    signOut: async () => {
      await signOut();
    },
    spike: {
      restGet: spikeRestGet,
      restPost: spikeRestPost,
      wsA: spikeWsA,
      wsB: spikeWsB,
    },
  };
  (window as any).lobly = bridge;

  wireListingMachineToBus();
  startGameEvents();
  void refreshEndpointsFromBackend();
  setInterval(() => void refreshEndpointsFromBackend(), 6 * 60 * 60 * 1000);

  loadClientSettings();
  watchClientSettings();
  appStore.update({ devAuthEnabled: devAuth });
  startSessionBootstrap(
    devAuth
      ? {
          devAuth: true,
          devEmail: "dev@lobly.local",
          devPassword: "lobly-dev-password",
        }
      : undefined
  );

  overwolf.extensions.onAppLaunchTriggered.addListener(() => {
    void restoreWindow("desktop");
  });

  overwolf.games.launchers.getRunningLaunchersInfo((info) => {
    const lol = info.launchers?.find((l) => isLeagueLauncherId(l.id));
    if (lol) startLauncherEvents();
  });

  overwolf.games.launchers.onLaunched.addListener((l) => {
    if (isLeagueLauncherId(l.id)) startLauncherEvents();
  });

  overwolf.games.launchers.onTerminated.addListener((l) => {
    if (l?.id != null && !isLeagueLauncherId(l.id)) return;
    gameFlowTracker.noteLauncherClosed();
    // Client gone → delist (no ghost listings; exit criterion 4)
    const st = appStore.state.listing.status;
    if (st !== "DRAFT" && st !== "DELISTED") {
      dispatchMachine({ type: "UNPUBLISH" });
    }
    clearCreds();
    appStore.update({ gep: { features: [], active: false } });
  });

  appStore.logLine("Background controller booted");
  await restoreWindow("desktop");
}

boot().catch((e) => {
  console.error("[LOBLY] boot failed", e);
});
