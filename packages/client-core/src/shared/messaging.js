import { useSyncExternalStore } from "react";
import { getBridge } from "./bridge";
function getMainStore() {
    return getBridge()?.store ?? null;
}
export function useAppStore() {
    return useSyncExternalStore((onStoreChange) => {
        let unsub = null;
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
    }, () => getMainStore()?.state ?? EMPTY_STATE, () => EMPTY_STATE);
}
export function getAppStore() {
    return getMainStore();
}
const EMPTY_STATE = {
    lcu: { connected: false },
    gameflowPhase: "None",
    listing: { status: "DRAFT" },
    lobbyCapability: null,
    publishDraft: null,
    myListing: null,
    gep: { features: [], active: false },
    sync: { connected: false },
    wsAvailable: false,
    log: [],
    toast: null,
    publishReason: null,
    boardRevision: 0,
    pendingRequests: [],
    outgoingRequests: [],
    authChecked: false,
    authenticated: false,
    hasStoredSession: false,
    authExpired: false,
    apiUnreachable: false,
    accountMismatch: false,
    devAuthEnabled: false,
    notificationsEnabled: true,
    autoAcceptQueue: false,
    openOnGameEnd: false,
    signInPhase: null,
    linkedAccountIds: [],
    linkedRiotIds: [],
    linkedLcuPuuids: [],
    autoAcceptLoblyInvites: false,
    endorsePrompt: null,
    manualInvite: null,
    lcuError: null,
};
