import { app, BrowserWindow, ipcMain, Menu, Notification, Tray } from "electron";
import path from "node:path";
import { installLocalStorageShim } from "./localStorageShim";
installLocalStorageShim();
import { appStore, configureLoblyCore, dispatchMachine, canPublish, publishWithDraft, wireListingMachineToBus, refreshLcuState, syncAgent, ensureSession, getAccessToken, refreshAccessToken, startSessionBootstrap, noteSummonerSwitch, adoptLinkedAccounts, signOut, completeRiotSignIn, linkAnotherAccount, loadClientSettings, watchClientSettings, gameFlowTracker, fetchBoard, acceptJoin, declineJoin, } from "@lobly/client-core";
import { tryDiscoverCredentials } from "./lcu/lockfile";
import { ElectronLcuTransport, ElectronLcuEventBus } from "./lcu/transport";
import { IPC } from "./ipc";
// Runtime env (dev / tester machine) overrides values baked at pack time.
const BACKEND_URL = process.env.LOBLY_BACKEND_URL ||
    process.env.LOBLY_PACKAGED_BACKEND_URL ||
    "http://localhost:8790";
const DEV_EMAIL = process.env.LOBLY_DEV_EMAIL ||
    process.env.LOBLY_PACKAGED_DEV_EMAIL ||
    "dev@lobly.local";
const DEV_PASSWORD = process.env.LOBLY_DEV_PASSWORD ||
    process.env.LOBLY_PACKAGED_DEV_PASSWORD ||
    "lobly-dev-password";
const DEV_AUTH = process.env.LOBLY_DEV_AUTH === "1";
const DISCOVERY_POLL_MS = 3000;
const APP_USER_MODEL_ID = "com.lobly.desktop";
app.setName("LOBLY");
if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
}
let mainWindow = null;
let tray = null;
let quitting = false;
let currentCreds = null;
let lastCredsKey = "";
const startHidden = process.argv.includes("--hidden");
let hiddenUntilLeague = startHidden;
function isDesktopHidden() {
    if (!mainWindow)
        return Promise.resolve(true);
    return Promise.resolve(mainWindow.isMinimized() || !mainWindow.isVisible());
}
const transport = {
    request: ((name, opts) => {
        if (!currentCreds)
            return Promise.reject(new Error("LCU not connected"));
        return new ElectronLcuTransport(currentCreds).request(name, opts);
    }),
};
const eventBus = new ElectronLcuEventBus(() => currentCreds, () => void refreshLcuState());
configureLoblyCore({
    backendUrl: BACKEND_URL,
    lcuTransport: transport,
    eventBus,
    isDesktopHidden,
    isDevAuthEnabled: () => DEV_AUTH,
    notify: (title, body, opts) => {
        if (!Notification.isSupported())
            return;
        const hidden = !mainWindow ||
            mainWindow.isDestroyed() ||
            mainWindow.isMinimized() ||
            !mainWindow.isVisible() ||
            !mainWindow.isFocused();
        if (!hidden)
            return;
        const note = new Notification({ title, body });
        note.on("click", () => {
            showMainWindow();
            if (opts?.tab) {
                appStore.update({ uiTab: opts.tab });
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(IPC.NAVIGATE, opts.tab);
                }
            }
        });
        note.show();
    },
    showWindowInactive: () => showMainWindowInactive(),
    setOpenAtLogin: (open) => {
        app.setLoginItemSettings({ openAtLogin: open, args: open ? ["--hidden"] : [] });
        appStore.update({ openAtLogin: open });
    },
});
function pollForLeagueClient() {
    const found = tryDiscoverCredentials();
    const key = found ? `${found.port}:${found.token}` : "";
    if (found && key !== lastCredsKey) {
        lastCredsKey = key;
        currentCreds = { port: found.port, token: found.token };
        appStore.update({ lcu: { connected: true, port: found.port } });
        appStore.logLine(`LCU credentials found via ${found.source} (port ${found.port})`);
        if (hiddenUntilLeague)
            showMainWindow();
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
        gameFlowTracker.noteLauncherClosed();
        appStore.setLcuDown();
        const st = appStore.state.listing.status;
        if (st !== "DRAFT" && st !== "DELISTED") {
            dispatchMachine({ type: "UNPUBLISH" });
        }
    }
    setTimeout(pollForLeagueClient, DISCOVERY_POLL_MS);
}
async function verifySummoner() {
    if (!currentCreds)
        return;
    try {
        const transport = new ElectronLcuTransport(currentCreds);
        const s = await transport.request("currentSummoner");
        if (!s)
            return;
        // This runs every poll tick (see pollForLeagueClient) specifically to
        // catch switching accounts within an already-running client, where the
        // port/token never change. Only do the extra region-locale call and
        // update the store when something actually changed — otherwise this
        // would hit the LCU twice a tick forever for no reason.
        const prevPuuid = appStore.state.summoner?.puuid;
        if (s.puuid === prevPuuid)
            return;
        // current-summoner has no platform/region field at all — the LCU only
        // exposes that via /riotclient/region-locale.
        let platform = "unknown";
        try {
            const rl = await transport.request("regionLocale");
            if (rl?.region)
                platform = String(rl.region).toLowerCase();
        }
        catch {
            /* fall back to "unknown" — link endpoint rejects this cleanly */
        }
        const gameName = s.gameName ?? s.displayName?.split("#")[0] ?? "";
        const tagLine = s.tagLine ?? "";
        const switched = await noteSummonerSwitch({ puuid: s.puuid, gameName, tagLine });
        appStore.update({
            summoner: {
                puuid: s.puuid,
                gameName,
                tagLine,
                summonerId: Number(s.summonerId),
                platform,
                profileIconId: typeof s.profileIconId === "number" ? s.profileIconId : undefined,
            },
        });
        if (switched && appStore.state.authenticated && !appStore.state.accountMismatch) {
            void adoptLinkedAccounts().catch((e) => appStore.logLine(`accounts: ${e?.message ?? e}`));
        }
        appStore.logLine(`${switched ? "Account switched — now " : "Summoner verified: "}${s.gameName ?? "?"}#${s.tagLine ?? ""} (${platform})`);
    }
    catch (e) {
        appStore.logLine(`Summoner verify failed: ${e?.message ?? e}`);
    }
}
// Poll-driven equivalent of Overwolf's GEP lobby_info signal: whenever the
// bus's "lobby" handler (wired by wireListingMachineToBus) needs a nudge —
// here it's unnecessary since the WS pushes full lobby objects directly, so
// wireListingMachineToBus's bus.on("lobby", ...) already receives real data.
function applyStoreAction(action) {
    switch (action.type) {
        case "update":
            appStore.update(action.patch);
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
function getSenderWindow(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window ||
        window !== mainWindow ||
        window.isDestroyed() ||
        event.senderFrame !== event.sender.mainFrame) {
        return null;
    }
    return window;
}
function pushMaximizedState(window) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, window.isMaximized());
    }
}
function registerIpc() {
    ipcMain.on(IPC.GET_STATE, (event) => {
        event.returnValue = appStore.state;
    });
    ipcMain.on(IPC.ACTION, (_event, action) => applyStoreAction(action));
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
    ipcMain.handle(IPC.GET_AUTH_TOKEN, async (_event, force) => {
        if (force) {
            const refreshed = await refreshAccessToken();
            if (!refreshed && DEV_AUTH) {
                try {
                    await ensureSession(DEV_EMAIL, DEV_PASSWORD);
                }
                catch (e) {
                    appStore.logLine(`Re-auth failed: ${e?.message ?? e}`);
                    return null;
                }
            }
        }
        const token = getAccessToken();
        if (!announcedRendererAuth) {
            announcedRendererAuth = true;
            appStore.logLine(token ? "UI authenticated via main session" : "UI has no session token");
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
    ipcMain.handle(IPC.ACCEPT_JOIN, async (_event, id) => {
        await acceptJoin(id);
    });
    ipcMain.handle(IPC.DECLINE_JOIN, async (_event, id) => {
        await declineJoin(id);
    });
    ipcMain.handle(IPC.RIOT_SIGN_IN, async () => {
        await completeRiotSignIn();
    });
    ipcMain.handle(IPC.LINK_ACCOUNT, async () => {
        await linkAnotherAccount();
    });
    ipcMain.handle(IPC.DEV_SIGN_IN, async (_event, email, password) => {
        if (!DEV_AUTH)
            throw new Error("Dev login is disabled");
        await ensureSession(email, password);
    });
    ipcMain.handle(IPC.SIGN_OUT, async () => {
        await signOut();
    });
    ipcMain.on(IPC.SET_OPEN_AT_LOGIN, (_event, open) => {
        app.setLoginItemSettings({ openAtLogin: !!open, args: open ? ["--hidden"] : [] });
        appStore.update({ openAtLogin: !!open });
    });
    ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
        getSenderWindow(event)?.minimize();
    });
    ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
        const window = getSenderWindow(event);
        if (window?.isMaximizable() && !window.isMaximized())
            window.maximize();
    });
    ipcMain.on(IPC.WINDOW_RESTORE, (event) => {
        const window = getSenderWindow(event);
        if (window?.isMaximized() || window?.isMinimized())
            window.restore();
    });
    ipcMain.on(IPC.WINDOW_TOGGLE_MAXIMIZE, (event) => {
        const window = getSenderWindow(event);
        if (!window?.isMaximizable())
            return;
        if (window.isMaximized())
            window.restore();
        else
            window.maximize();
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
    window.once("ready-to-show", () => {
        if (!startHidden)
            window.show();
    });
    window.on("close", (event) => {
        if (quitting)
            return;
        if (listingOrSessionOpen()) {
            event.preventDefault();
            window.hide();
        }
    });
    window.on("closed", () => {
        if (mainWindow === window)
            mainWindow = null;
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
        if (!window.isDestroyed())
            window.webContents.send(IPC.STATE_PUSH, appStore.state);
    });
    // Opt-in only: LOBLY_DEVTOOLS=1 npm run desktop:start
    if (process.env.LOBLY_DEVTOOLS === "1") {
        window.webContents.openDevTools({ mode: "detach" });
    }
    const indexPath = path.join(__dirname, "../dist/renderer/index.html");
    console.log(`Loading renderer from ${indexPath}`);
    void window.loadFile(indexPath);
}
function showMainWindow() {
    hiddenUntilLeague = false;
    if (!mainWindow || mainWindow.isDestroyed())
        createWindow();
    const window = mainWindow;
    if (!window || window.isDestroyed())
        return;
    if (window.isMinimized())
        window.restore();
    window.show();
    window.focus();
}
/** End-of-game: show LOBLY without taking focus from the League client. */
function showMainWindowInactive() {
    hiddenUntilLeague = false;
    if (!mainWindow || mainWindow.isDestroyed())
        createWindow();
    const window = mainWindow;
    if (!window || window.isDestroyed())
        return;
    if (window.isMinimized())
        window.restore();
    window.showInactive();
}
function listingOrSessionOpen() {
    const st = appStore.state.listing.status;
    const listingLive = st !== "DRAFT" && st !== "DELISTED";
    const sessionOpen = !!appStore.state.session && !appStore.state.session.endedAt;
    return listingLive || sessionOpen;
}
function createTray() {
    try {
        const icon = path.join(__dirname, "../assets/lobly.ico");
        tray = new Tray(icon);
        tray.setToolTip("LOBLY");
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: "Open LOBLY", click: () => showMainWindow() },
            { label: "Unpublish lobby", click: () => dispatchMachine({ type: "UNPUBLISH" }) },
            { label: "Quit", click: () => void quitApp() },
        ]));
        tray.on("click", () => showMainWindow());
    }
    catch (e) {
        console.error("tray icon unavailable", e);
    }
}
async function quitApp() {
    quitting = true;
    const st = appStore.state.listing.status;
    if (st !== "DRAFT" && st !== "DELISTED") {
        dispatchMachine({ type: "UNPUBLISH" });
        await new Promise((r) => setTimeout(r, 400));
    }
    app.quit();
}
if (!app.requestSingleInstanceLock()) {
    app.quit();
}
else {
    app.on("second-instance", () => showMainWindow());
    app.whenReady().then(() => {
        Menu.setApplicationMenu(null);
        loadClientSettings();
        watchClientSettings();
        appStore.update({
            devAuthEnabled: DEV_AUTH,
            openAtLogin: app.getLoginItemSettings().openAtLogin,
        });
        registerIpc();
        createWindow();
        createTray();
        wireListingMachineToBus();
        pollForLeagueClient();
        appStore.logLine(`Connecting to ${BACKEND_URL}…`);
        startSessionBootstrap(DEV_AUTH
            ? { devAuth: true, devEmail: DEV_EMAIL, devPassword: DEV_PASSWORD }
            : undefined);
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0)
                createWindow();
        });
    });
}
app.on("before-quit", () => {
    quitting = true;
});
app.on("window-all-closed", () => {
    if (quitting && process.platform !== "darwin")
        app.quit();
    else if (!listingOrSessionOpen() && process.platform !== "darwin")
        app.quit();
});
