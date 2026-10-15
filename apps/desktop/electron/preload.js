import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipc";
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
    onState: (cb) => {
        const handler = (_e, state) => cb(state);
        ipcRenderer.on(IPC.STATE_PUSH, handler);
        return () => ipcRenderer.removeListener(IPC.STATE_PUSH, handler);
    },
    sendAction: (action) => ipcRenderer.send(IPC.ACTION, action),
    dispatch: (event) => ipcRenderer.send(IPC.DISPATCH, event),
    publish: (draft) => ipcRenderer.send(IPC.PUBLISH, draft),
    canPublish: () => ipcRenderer.sendSync(IPC.CAN_PUBLISH),
    sendChat: (sessionId, body) => ipcRenderer.send(IPC.SEND_CHAT, { sessionId, body }),
    refreshBoard: () => ipcRenderer.invoke(IPC.REFRESH_BOARD),
    acceptJoin: (joinRequestId) => ipcRenderer.invoke(IPC.ACCEPT_JOIN, joinRequestId),
    declineJoin: (joinRequestId) => ipcRenderer.invoke(IPC.DECLINE_JOIN, joinRequestId),
    backendUrl: () => ipcRenderer.sendSync(IPC.GET_BACKEND_URL),
    getAuthToken: (force) => ipcRenderer.invoke(IPC.GET_AUTH_TOKEN, force),
    onNavigate: (cb) => {
        const handler = (_e, tab) => cb(tab);
        ipcRenderer.on(IPC.NAVIGATE, handler);
        return () => ipcRenderer.removeListener(IPC.NAVIGATE, handler);
    },
    setOpenAtLogin: (open) => ipcRenderer.send(IPC.SET_OPEN_AT_LOGIN, open),
    riotSignIn: () => ipcRenderer.invoke(IPC.RIOT_SIGN_IN),
    linkAnotherAccount: () => ipcRenderer.invoke(IPC.LINK_ACCOUNT),
    devSignIn: (email, password) => ipcRenderer.invoke(IPC.DEV_SIGN_IN, email, password),
    signOut: () => ipcRenderer.invoke(IPC.SIGN_OUT),
    windowControls: {
        minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
        maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
        restore: () => ipcRenderer.send(IPC.WINDOW_RESTORE),
        toggleMaximize: () => ipcRenderer.send(IPC.WINDOW_TOGGLE_MAXIMIZE),
        close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
        isMaximized: () => ipcRenderer.sendSync(IPC.WINDOW_IS_MAXIMIZED),
        onMaximizedChange: (listener) => {
            const handler = (_e, isMaximized) => listener(isMaximized);
            ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
            return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, handler);
        },
    },
});
