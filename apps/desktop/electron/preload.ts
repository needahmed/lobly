import { contextBridge, ipcRenderer } from "electron";
import { IPC, type StoreAction } from "./ipc";

/**
 * contextBridge copies DATA properties BY VALUE at expose time and only
 * keeps FUNCTIONS live across the boundary. Exposing a store object with a
 * mutable `state` property therefore hands the renderer a permanent
 * snapshot of whatever the state happened to be when preload ran —
 * subscribe() still fires, but state never changes, so anything main sets
 * later (summoner, riotAccountId, …) is invisible to the UI.
 *
 * So: expose functions only. The renderer owns the live store and mirrors
 * main into it (see renderer/bridge.ts).
 */
contextBridge.exposeInMainWorld("loblyIpc", {
  getInitialState: () => ipcRenderer.sendSync(IPC.GET_STATE),
  onState: (cb: (state: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state);
    ipcRenderer.on(IPC.STATE_PUSH, handler);
    return () => ipcRenderer.removeListener(IPC.STATE_PUSH, handler);
  },

  sendAction: (action: StoreAction) => ipcRenderer.send(IPC.ACTION, action),
  dispatch: (event: unknown) => ipcRenderer.send(IPC.DISPATCH, event),
  publish: (draft: unknown) => ipcRenderer.send(IPC.PUBLISH, draft),
  canPublish: () => ipcRenderer.sendSync(IPC.CAN_PUBLISH),

  sendChat: (sessionId: string, body: string) =>
    ipcRenderer.send(IPC.SEND_CHAT, { sessionId, body }),
  refreshBoard: () => ipcRenderer.invoke(IPC.REFRESH_BOARD),
  acceptJoin: (joinRequestId: string) =>
    ipcRenderer.invoke(IPC.ACCEPT_JOIN, joinRequestId),
  declineJoin: (joinRequestId: string) =>
    ipcRenderer.invoke(IPC.DECLINE_JOIN, joinRequestId),

  backendUrl: (): string => ipcRenderer.sendSync(IPC.GET_BACKEND_URL),
  getAuthToken: (force?: boolean): Promise<string | null> =>
    ipcRenderer.invoke(IPC.GET_AUTH_TOKEN, force),

  windowControls: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    restore: () => ipcRenderer.send(IPC.WINDOW_RESTORE),
    toggleMaximize: () => ipcRenderer.send(IPC.WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    isMaximized: (): boolean => ipcRenderer.sendSync(IPC.WINDOW_IS_MAXIMIZED),
    onMaximizedChange: (listener: (isMaximized: boolean) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, isMaximized: boolean) =>
        listener(isMaximized);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
    },
  },
});
