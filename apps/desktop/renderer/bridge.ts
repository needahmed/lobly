import {
  appStore,
  type AppState,
  type LoblyBridge,
  type MachineEvent,
} from "@lobly/client-core";

/** The function-only surface preload exposes (see electron/preload.ts). */
interface LoblyIpc {
  getInitialState: () => AppState;
  onState: (cb: (state: AppState) => void) => () => void;
  sendAction: (action: unknown) => void;
  dispatch: (event: MachineEvent) => void;
  publish: (draft: unknown) => void;
  canPublish: () => { ok: boolean; reason: string | null };
  sendChat: (sessionId: string, body: string) => void;
  refreshBoard: () => Promise<void>;
  acceptJoin: (joinRequestId: string) => Promise<void>;
  declineJoin: (joinRequestId: string) => Promise<void>;
  backendUrl: () => string;
  getAuthToken: (force?: boolean) => Promise<string | null>;
  windowControls: NonNullable<LoblyBridge["windowControls"]>;
  onNavigate: (cb: (tab: string) => void) => () => void;
  setOpenAtLogin: (open: boolean) => void;
  riotSignIn: () => Promise<void>;
  linkAnotherAccount: () => Promise<void>;
  devSignIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function getIpc(): LoblyIpc {
  const ipc = (window as unknown as { loblyIpc?: LoblyIpc }).loblyIpc;
  if (!ipc) throw new Error("preload did not expose loblyIpc");
  return ipc;
}

/**
 * Builds the renderer's live store + bridge.
 *
 * The store MUST live here rather than in preload: contextBridge freezes
 * data properties at expose time, so a store handed across the boundary
 * would never see another state change. Here it is an ordinary object in
 * the renderer's own realm, mirrored from main via IPC.
 */
export function installBridge(): void {
  const ipc = getIpc();

  // main → renderer. applyRemoteState deliberately does not forward back.
  appStore.applyRemoteState(ipc.getInitialState());
  ipc.onState((state) => appStore.applyRemoteState(state));

  // renderer → main. Local apply keeps the UI instant; the forward is what
  // makes main's listing machine / sync agent actually see the change.
  appStore.setWriteForwarder((patch) =>
    ipc.sendAction({ type: "update", patch })
  );
  appStore.setLogForwarder((payload) =>
    ipc.sendAction({ type: "logLine", payload })
  );

  const bridge: LoblyBridge = {
    store: appStore,
    dispatch: (event) => ipc.dispatch(event),
    publish: (draft) => ipc.publish(draft),
    canPublish: () => ipc.canPublish(),
    setToast: (message) => ipc.sendAction({ type: "setToast", payload: message }),
    refreshBoard: () => ipc.refreshBoard(),
    sendChat: (sessionId, body) => ipc.sendChat(sessionId, body),
    acceptJoin: (id) => ipc.acceptJoin(id),
    declineJoin: (id) => ipc.declineJoin(id),
    navigate: (tab) => appStore.update({ uiTab: tab }),
    onNavigate: (cb) => ipc.onNavigate(cb),
    riotSignIn: () => ipc.riotSignIn(),
    linkAnotherAccount: () => ipc.linkAnotherAccount(),
    devSignIn: (email, password) => ipc.devSignIn(email, password),
    signOut: () => ipc.signOut(),
    setOpenAtLogin: (open) => ipc.setOpenAtLogin(open),
    windowControls: ipc.windowControls,
    // No LCU Lab spike panel on the Electron host — C13's browser-WebSocket
    // constraint doesn't apply here, so there's nothing to spike.
  };

  (window as unknown as { lobly: LoblyBridge }).lobly = bridge;
}
