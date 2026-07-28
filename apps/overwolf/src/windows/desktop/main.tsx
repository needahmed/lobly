import { createRoot } from "react-dom/client";
import {
  App,
  configureLoblyCore,
  createNoopHostAdapter,
  loadStoredAuth,
} from "@lobly/client-core";
import { BACKEND_URL } from "../../config";

// The desktop window is a separate JS context from the background window
// (each Overwolf window is its own Vite entry/bundle) — it never touches
// the LCU directly (that's background's job), but App.tsx's own views
// (Profile, Board, Requests, ...) call api/session helpers straight from
// here, so this context needs its own configureLoblyCore() too.
configureLoblyCore(createNoopHostAdapter(BACKEND_URL));

// This window has its own module state, so its API client starts with no
// token. Unlike Electron's renderer, Overwolf windows share an origin (and
// therefore localStorage) with the background window, so the session the
// background window stored can simply be read back here.
loadStoredAuth();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
