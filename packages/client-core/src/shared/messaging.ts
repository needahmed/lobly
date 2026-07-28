import { useSyncExternalStore } from "react";
import type { AppState, Store } from "../state/store";
import { getBridge } from "./bridge";

function getMainStore(): Store | null {
  return getBridge()?.store ?? null;
}

export function useAppStore(): AppState {
  return useSyncExternalStore(
    (onStoreChange) => {
      let unsub: (() => void) | null = null;
      const store = getMainStore();
      if (store) {
        unsub = store.subscribe(onStoreChange);
        return () => unsub?.();
      }
      // Bridge may not be ready on the first paint (Electron preload race).
      const id = window.setInterval(() => {
        const s = getMainStore();
        if (s && !unsub) {
          window.clearInterval(id);
          unsub = s.subscribe(onStoreChange);
          onStoreChange();
        }
      }, 50);
      return () => {
        window.clearInterval(id);
        unsub?.();
      };
    },
    () => getMainStore()?.state ?? EMPTY_STATE,
    () => EMPTY_STATE
  );
}

export function getAppStore(): Store | null {
  return getMainStore();
}

const EMPTY_STATE: AppState = {
  lcu: { connected: false },
  gameflowPhase: "None",
  listing: { status: "DRAFT" as any },
  lobbyCapability: null,
  publishDraft: null,
  myListing: null,
  gep: { features: [], active: false },
  sync: { connected: false },
  wsAvailable: false,
  log: [],
  toast: null,
  publishReason: null,
  sessionEndPending: false,
  boardRevision: 0,
  pendingRequests: [],
  autoAcceptLoblyInvites: false,
  endorsePrompt: null,
  manualInvite: null,
  lcuError: null,
};
