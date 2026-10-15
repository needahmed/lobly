import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { App, configureLoblyCore, createNoopHostAdapter, setAuthTokenProvider, } from "@lobly/client-core";
import { getIpc, installBridge } from "./bridge";
// The store lives in THIS realm and mirrors main over IPC — see bridge.ts
// for why it cannot live in preload. Must run before <App/> mounts so the
// first paint already has real state.
installBridge();
const ipc = getIpc();
// The renderer is a separate JS context from electron/main.ts — it never
// touches the LCU directly (that's main's job), but App.tsx's own views
// (Profile, Board, Requests, ...) call api/session helpers straight from
// here, so this context needs its own configureLoblyCore() too. The backend
// URL comes from main, so there is exactly one place it is decided.
configureLoblyCore(createNoopHostAdapter(ipc.backendUrl()));
// This context never logs in — main owns the session, so borrow its token
// per request (and let it re-auth when a request comes back 401).
setAuthTokenProvider((force) => ipc.getAuthToken(force));
const root = document.getElementById("root");
if (root) {
    createRoot(root).render(_jsx(App, {}));
}
