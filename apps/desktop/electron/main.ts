import { app, BrowserWindow, ipcMain, Menu, type IpcMainEvent } from "electron";
import path from "node:path";
import { installLocalStorageShim } from "./localStorageShim";

installLocalStorageShim();

import {
  appStore,
  configureLoblyCore,
  dispatchMachine,
  canPublish,
  publishWithDraft,
  wireListingMachineToBus,
  refreshLcuState,
  syncAgent,
  ensureSession,
  getAccessToken,
  linkCurrentSummoner,
  fetchBoard,
  acceptJoin,
  declineJoin,
} from "@lobly/client-core";
import { tryDiscoverCredentials } from "./lcu/lockfile";
import { ElectronLcuTransport, ElectronLcuEventBus, type ElectronCreds } from "./lcu/transport";
import { IPC, type StoreAction } from "./ipc";

// Runtime env (dev / tester machine) overrides values baked at pack time.
const BACKEND_URL =
  process.env.LOBLY_BACKEND_URL ||
  process.env.LOBLY_PACKAGED_BACKEND_URL ||
  "http://localhost:8790";
const DEV_EMAIL =
  process.env.LOBLY_DEV_EMAIL ||
  process.env.LOBLY_PACKAGED_DEV_EMAIL ||
  "dev@lobly.local";
const DEV_PASSWORD =
  process.env.LOBLY_DEV_PASSWORD ||
  process.env.LOBLY_PACKAGED_DEV_PASSWORD ||
  "lobly-dev-password";
const DISCOVERY_POLL_MS = 3000;
const APP_USER_MODEL_ID = "com.lobly.desktop";

app.setName("LOBLY");
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow: BrowserWindow | null = null;
let currentCreds: ElectronCreds | null = null;
let lastCredsKey = "";

function isDesktopHidden(): Promise<boolean> {
  if (!mainWindow) return Promise.resolve(true);
  return Promise.resolve(mainWindow.isMinimized() || !mainWindow.isVisible());
}

const transport = {
  request: (<T>(name: string, opts?: any) => {
    if (!currentCreds) return Promise.reject(new Error("LCU not connected"));
    return new ElectronLcuTransport(currentCreds).request<T>(name, opts);
  }) as any,
};

const eventBus = new ElectronLcuEventBus(
  () => currentCreds,
  () => void refreshLcuState()
);

configureLoblyCore({
  backendUrl: BACKEND_URL,
  lcuTransport: transport,
  eventBus,
  isDesktopHidden,
});

function pollForLeagueClient() {
  const found = tryDiscoverCredentials();
  const key = found ? `${found.port}:${found.token}` : "";

  if (found && key !== lastCredsKey) {
    lastCredsKey = key;
    currentCreds = { port: found.port, token: found.token };
    appStore.update({ lcu: { connected: true, port: found.port } });
    appStore.logLine(`LCU credentials found via ${found.source} (port ${found.port})`);
    eventBus.stop();
    eventBus.start();
    // The WebSocket only pushes changes, so read whatever is already true
    // right now — the user may have been sitting in a lobby before launch.
    void refreshLcuState();
  }

  if (found) {
    // Port/token stay the same if the user switches which account is
    // logged into an already-running client — they're tied to the client
    // PROCESS, not the session. Re-checking every tick (not just on
    // rotation) is the only way to notice that kind of switch.
    void verifySummoner();
  }

  if (!found && lastCredsKey !== "") {
    lastCredsKey = "";
    currentCreds = null;
    eventBus.stop();
    appStore.setLcuDown();

    const st = appStore.state.listing.status;
    if (st !== "DRAFT" && st !== "DELISTED") {
      dispatchMachine({ type: "UNPUBLISH" });
    }
  }

  setTimeout(pollForLeagueClient, DISCOVERY_POLL_MS);
}

async function verifySummoner() {
  if (!currentCreds) return;
  try {
    const transport = new ElectronLcuTransport(currentCreds);
    const s = await transport.request<any>("currentSummoner");
    if (!s) return;

    // This runs every poll tick (see pollForLeagueClient) specifically to
    // catch switching accounts within an already-running client, where the
    // port/token never change. Only do the extra region-locale call and
    // update the store when something actually changed — otherwise this
    // would hit the LCU twice a tick forever for no reason.
    const prevPuuid = appStore.state.summoner?.puuid;
    if (s.puuid === prevPuuid) return;

    // current-summoner has no platform/region field at all — the LCU only
    // exposes that via /riotclient/region-locale.
    let platform = "unknown";
    try {
      const rl = await transport.request<any>("regionLocale");
      if (rl?.region) platform = String(rl.region).toLowerCase();
    } catch {
      /* fall back to "unknown" — link endpoint rejects this cleanly */
    }

    const switched = prevPuuid != null;
    appStore.update({
      summoner: {
        puuid: s.puuid,
        gameName: s.gameName ?? s.displayName?.split("#")[0] ?? "",
        tagLine: s.tagLine ?? "",
        summonerId: Number(s.summonerId),
        platform,
      },
      // A different Riot ID means a different linked account (or none yet)
      // — carrying over the old riotAccountId/profileHints/myListing would
      // show the previous account's data under the new one's name.
      ...(switched
        ? { riotAccountId: undefined, profileHints: undefined, myListing: null }
        : {}),
    });
    appStore.logLine(
      `${switched ? "Account switched — now " : "Summoner verified: "}${s.gameName ?? "?"}#${s.tagLine ?? ""} (${platform})`
    );
  } catch (e: any) {
    appStore.logLine(`Summoner verify failed: ${e?.message ?? e}`);
  }
}

// Poll-driven equivalent of Overwolf's GEP lobby_info signal: whenever the
// bus's "lobby" handler (wired by wireListingMachineToBus) needs a nudge —
// here it's unnecessary since the WS pushes full lobby objects directly, so
// wireListingMachineToBus's bus.on("lobby", ...) already receives real data.

function applyStoreAction(action: StoreAction) {
  switch (action.type) {
    case "update":
      appStore.update(action.patch as any);
      break;
    case "logLine":
      appStore.logLine(action.payload);
      break;
    case "setToast":
      appStore.setToast(action.payload);
      break;
    case "clearToast":
      appStore.clearToast();
      break;
    case "setLcuDown":
      appStore.setLcuDown();
      break;
  }
}

function getSenderWindow(event: IpcMainEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    window !== mainWindow ||
    window.isDestroyed() ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    return null;
  }
  return window;
}

function pushMaximizedState(window: BrowserWindow) {
  if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, window.isMaximized());
  }
}

function registerIpc() {
  ipcMain.on(IPC.GET_STATE, (event) => {
    event.returnValue = appStore.state;
  });

  ipcMain.on(IPC.ACTION, (_event, action: StoreAction) => applyStoreAction(action));

  ipcMain.on(IPC.DISPATCH, (_event, machineEvent) => dispatchMachine(machineEvent));

  ipcMain.on(IPC.PUBLISH, (_event, draft) => publishWithDraft(draft));

  ipcMain.on(IPC.CAN_PUBLISH, (event) => {
    event.returnValue = canPublish();
  });

  ipcMain.on(IPC.GET_BACKEND_URL, (event) => {
    event.returnValue = BACKEND_URL;
  });

  // The renderer has no session of its own — main owns it and hands out the
  // current token. `force` means the renderer just got a 401, so re-auth
  // before answering.
  let announcedRendererAuth = false;
  ipcMain.handle(IPC.GET_AUTH_TOKEN, async (_event, force?: boolean) => {
    if (force || !getAccessToken()) {
      try {
        await ensureSession(DEV_EMAIL, DEV_PASSWORD);
      } catch (e: any) {
        appStore.logLine(`Re-auth failed: ${e?.message ?? e}`);
        return null;
      }
    }
    const token = getAccessToken();
    if (!announcedRendererAuth) {
      announcedRendererAuth = true;
      appStore.logLine(
        token ? "UI authenticated via main session" : "UI has no session token"
      );
    }
    return token;
  });

  ipcMain.on(IPC.SEND_CHAT, (_event, { sessionId, body }) => {
    syncAgent.sendChat(sessionId, body);
  });

  ipcMain.handle(IPC.REFRESH_BOARD, async () => {
    const rows = await fetchBoard();
    appStore.update({ board: rows });
    appStore.logLine(`Board: ${rows.length} eligible listings`);
  });

  ipcMain.handle(IPC.ACCEPT_JOIN, async (_event, id: string) => {
    await acceptJoin(id);
  });

  ipcMain.handle(IPC.DECLINE_JOIN, async (_event, id: string) => {
    await declineJoin(id);
  });

  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
    getSenderWindow(event)?.minimize();
  });

  ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
    const window = getSenderWindow(event);
    if (window?.isMaximizable() && !window.isMaximized()) window.maximize();
  });

  ipcMain.on(IPC.WINDOW_RESTORE, (event) => {
    const window = getSenderWindow(event);
    if (window?.isMaximized() || window?.isMinimized()) window.restore();
  });

  ipcMain.on(IPC.WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const window = getSenderWindow(event);
    if (!window?.isMaximizable()) return;
    if (window.isMaximized()) window.restore();
    else window.maximize();
  });

  ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
    getSenderWindow(event)?.close();
  });

  ipcMain.on(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    event.returnValue = getSenderWindow(event)?.isMaximized() ?? false;
  });

  let lastLoggedLine = "";
  appStore.subscribe(() => {
    const line = appStore.state.log.at(-1);
    if (line && line !== lastLoggedLine) {
      lastLoggedLine = line;
      console.log(line);
    }
    mainWindow?.webContents.send(IPC.STATE_PUSH, appStore.state);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    title: "LOBLY",
    icon: path.join(__dirname, "../assets/lobly.ico"),
    frame: false,
    thickFrame: true,
    roundedCorners: true,
    autoHideMenuBar: true,
    backgroundColor: "#070b14",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  window.removeMenu();
  window.on("maximize", () => pushMaximizedState(window));
  window.on("unmaximize", () => pushMaximizedState(window));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  // Electron does NOT forward renderer console output to this terminal by
  // default — without these, a blank window is undebuggable from the CLI.
  window.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  window.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] render-process-gone`, details);
  });
  window.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error(`[renderer] preload-error ${preloadPath}`, error);
  });
  // Anything pushed while the renderer was still loading was dropped on the
  // floor, so re-send the whole state once it can actually receive it —
  // otherwise the UI is stuck showing whatever preload happened to snapshot.
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) window.webContents.send(IPC.STATE_PUSH, appStore.state);
  });
  // Opt-in only: LOBLY_DEVTOOLS=1 npm run desktop:start
  if (process.env.LOBLY_DEVTOOLS === "1") {
    window.webContents.openDevTools({ mode: "detach" });
  }

  const indexPath = path.join(__dirname, "../dist/renderer/index.html");
  console.log(`Loading renderer from ${indexPath}`);
  void window.loadFile(indexPath);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  wireListingMachineToBus();
  pollForLeagueClient();

  try {
    appStore.logLine(`Connecting to ${BACKEND_URL}…`);
    // Never let a hung backend leave the app silently signed-out with no
    // clue in the log about what it is waiting for.
    await withTimeout(
      ensureSession(DEV_EMAIL, DEV_PASSWORD),
      15_000,
      "backend did not respond within 15s"
    );
    let lastPuuid: string | undefined;
    appStore.subscribe(() => {
      const puuid = appStore.state.summoner?.puuid;
      // puuid !== lastPuuid is the only de-dup key that should exist here.
      // This used to ALSO skip whenever riotAccountId was already set,
      // which was correct for "don't re-link the same account twice" but
      // wrong for "a different account just logged in" — riotAccountId
      // stays set from the FIRST link for the rest of the process's life,
      // so switching League accounts without restarting LOBLY silently
      // kept showing the old account forever. verifySummoner() now clears
      // riotAccountId itself when it detects a puuid change, so this check
      // alone is sufficient again.
      if (!puuid || puuid === lastPuuid) return;
      lastPuuid = puuid;
      void linkCurrentSummoner().catch((e) =>
        appStore.logLine(`link: ${e?.message ?? e}`)
      );
    });
  } catch (e: any) {
    appStore.logLine(`API auth failed (${e?.message ?? e}) — using dev-local sync`);
    syncAgent.connect("dev-local");
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}
