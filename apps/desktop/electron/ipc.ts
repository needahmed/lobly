/** IPC channel names shared between main and preload. */
export const IPC = {
  GET_STATE: "lobly:getState", // sync
  STATE_PUSH: "lobly:state", // main -> renderer
  ACTION: "lobly:action", // renderer -> main (store.update/logLine/setToast/clearToast/setLcuDown)
  DISPATCH: "lobly:dispatch", // renderer -> main (MachineEvent)
  PUBLISH: "lobly:publish", // renderer -> main (PublishDraft, then PUBLISH)
  CAN_PUBLISH: "lobly:canPublish", // sync
  SEND_CHAT: "lobly:sendChat",
  REFRESH_BOARD: "lobly:refreshBoard", // invoke
  ACCEPT_JOIN: "lobly:acceptJoin", // invoke
  DECLINE_JOIN: "lobly:declineJoin", // invoke
  GET_BACKEND_URL: "lobly:getBackendUrl", // sync
  GET_AUTH_TOKEN: "lobly:getAuthToken", // invoke(force?) -> string | null
  WINDOW_MINIMIZE: "lobly:window:minimize",
  WINDOW_MAXIMIZE: "lobly:window:maximize",
  WINDOW_RESTORE: "lobly:window:restore",
  WINDOW_TOGGLE_MAXIMIZE: "lobly:window:toggleMaximize",
  WINDOW_CLOSE: "lobly:window:close",
  WINDOW_IS_MAXIMIZED: "lobly:window:isMaximized", // sync
  WINDOW_MAXIMIZED_CHANGED: "lobly:window:maximizedChanged", // main -> renderer
  NAVIGATE: "lobly:navigate", // main -> renderer
  SET_OPEN_AT_LOGIN: "lobly:setOpenAtLogin",
  RIOT_SIGN_IN: "lobly:riotSignIn",
  LINK_ACCOUNT: "lobly:linkAccount",
  DEV_SIGN_IN: "lobly:devSignIn",
  SIGN_OUT: "lobly:signOut",
} as const;

export type StoreAction =
  | { type: "update"; patch: Record<string, unknown> }
  | { type: "logLine"; payload: string }
  | { type: "setToast"; payload: string }
  | { type: "clearToast" }
  | { type: "setLcuDown" };
