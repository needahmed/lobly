import { appStore } from "./store";

const KEY = "lobly.clientSettings";

export function loadClientSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      notificationsEnabled?: boolean;
      autoAcceptQueue?: boolean;
      openOnGameEnd?: boolean;
    };
    appStore.update({
      notificationsEnabled: parsed.notificationsEnabled !== false,
      autoAcceptQueue: !!parsed.autoAcceptQueue,
      openOnGameEnd: parsed.openOnGameEnd !== false,
    });
  } catch {
    /* ignore corrupt prefs */
  }
}

function snapshot(): string {
  const s = appStore.state;
  return JSON.stringify({
    notificationsEnabled: s.notificationsEnabled,
    autoAcceptQueue: s.autoAcceptQueue,
    openOnGameEnd: s.openOnGameEnd,
  });
}

let watching = false;
let last = "";

export function watchClientSettings() {
  if (watching) return;
  watching = true;
  last = snapshot();
  appStore.subscribe(() => {
    const next = snapshot();
    if (next === last) return;
    last = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* best-effort */
    }
  });
}
