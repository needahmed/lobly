# Phase 1 — Overwolf Client Foundation

**Goal:** a working Overwolf app that (a) auto-starts with the League client,
(b) knows who is logged in, (c) tracks the gameflow phase and current lobby in real
time, (d) can fire a League invite programmatically, and (e) runs a client-side
listing state machine against a local mock backend.

**Everything in this file assumes you have read `00_BUILD_OVERVIEW.md`.** Constraint
references like "C2" point to §4 of that file.

**Phase 1 does NOT include:** any real backend, any Riot Web API call, any real
listing board UI polish. The desktop window in this phase is a **developer HUD**
that proves the plumbing works.

---

## Critical constraint discovered for this phase (C13)

**The browser `WebSocket` API cannot send custom headers**, so the LCU WebSocket
(which requires an `Authorization: Basic` header on the handshake) may be
unreachable from Overwolf's CEF the normal way. Embedded credentials in the URL
(`wss://riot:pass@127.0.0.1:port`) are rejected by stock Chromium but may be allowed
in Overwolf's CEF.

**Because of this, the architecture for Phase 1 is:**
- **Primary push channel = Overwolf GEP launcher events** (`game_flow`,
  `lobby_info`, `summoner_info`, `lcu_info`). These are delivered by Overwolf with
  no auth problems and cover phase changes and lobby changes.
- **LCU REST via `fetch()`** (headers work fine with fetch) for detail reads
  (`/lol-lobby/v2/lobby`) and commands (invitations). Reads are triggered *by* GEP
  events, never by blind polling loops.
- **LCU WebSocket is an optional upgrade**, attempted once in Milestone 2's spike.
  If it connects, use it for lower-latency lobby updates. If not, lose nothing.

This is why the module is built behind one interface (`LcuEventBus`) with two
implementations (GEP-driven, WS-driven).

---

## Milestone 0 — Compliance kickoff (no code)

Do these before or in parallel with coding; both have waiting periods:

1. **Overwolf developer application:** register at the Overwolf developers site,
   submit the app proposal. Describe LOBLY as *social matchmaking and premade team
   building for League of Legends*. Explicitly state: filters gate who joins a
   premade **before queue**; the app never shows information about matchmade
   opponents and never enables queue dodging or player discrimination (this
   addresses their known rejection reasons). You cannot load unpacked apps until the
   account is whitelisted.
2. **Riot developer portal:** create an account at developer.riotgames.com, note the
   development API key (rotates every 24h; used in Phase 2). Register the product
   ("application") describing LOBLY, including its LCU usage per `00` §8.1.

---

## Milestone 1 — Repo scaffold, manifest, three windows

### 1.1 Root workspace

Create `lobly/package.json`:

```json
{
  "name": "lobly",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "tools/*"],
  "scripts": {
    "ow:dev": "npm --workspace apps/overwolf run build:watch",
    "ow:build": "npm --workspace apps/overwolf run build",
    "mock": "npm --workspace tools/mock-backend run start"
  }
}
```

Create `packages/shared-types/` now (even though Phase 2 fills it out):

```
packages/shared-types/
├─ package.json          { "name": "@lobly/shared-types", "main": "src/index.ts" }
└─ src/
   ├─ index.ts           // re-exports everything
   ├─ listing.ts         // ListingStatus enum + Listing/JoinRequest interfaces
   ├─ lcu.ts             // GameflowPhase type, LcuCredentials, LcuLobby DTO
   └─ socket-events.ts   // client<->server event name constants (Phase 2 fills)
```

`listing.ts` must contain exactly:

```ts
export enum ListingStatus {
  DRAFT = "DRAFT",
  LISTED = "LISTED",
  FILLING = "FILLING",
  READY = "READY",
  PAUSED = "PAUSED",
  IN_SESSION = "IN_SESSION",
  POST_SESSION = "POST_SESSION",
  DELISTED = "DELISTED",
}

export type GameflowPhase =
  | "None" | "Lobby" | "Matchmaking" | "ReadyCheck" | "ChampSelect"
  | "GameStart" | "InProgress" | "WaitingForStats" | "PreEndOfGame" | "EndOfGame";
```

### 1.2 Overwolf app scaffold

```
apps/overwolf/
├─ package.json
├─ manifest.json
├─ tsconfig.json
├─ vite.config.ts
├─ public/icons/          # icon.png 256x256, icon_gray.png 256x256, window_icon.png, launcher.ico, tray.ico
└─ src/
   ├─ windows/background/{background.html, main.ts}
   ├─ windows/desktop/{desktop.html, main.tsx, App.tsx}
   ├─ windows/notifications/{notifications.html, main.tsx}
   ├─ modules/lcu/{credentials.ts, request.ts, endpoints.ts, eventBus.ts, wsClient.ts}
   ├─ modules/gep/{launcherEvents.ts, gameEvents.ts}
   ├─ modules/state/{store.ts, listingMachine.ts}
   ├─ modules/sync/{syncAgent.ts}
   └─ shared/{ow.ts, log.ts, messaging.ts}
```

Dependencies for `apps/overwolf/package.json`:
`react`, `react-dom`, dev: `vite`, `@vitejs/plugin-react`, `typescript`,
`@overwolf/types` (ambient typings for the `overwolf` global).

`vite.config.ts` — one HTML entry per window, relative asset paths (Overwolf loads
from disk, so `base: "./"` is mandatory):

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/windows/background/background.html"),
        desktop: resolve(__dirname, "src/windows/desktop/desktop.html"),
        notifications: resolve(__dirname, "src/windows/notifications/notifications.html"),
      },
    },
  },
});
```

Add scripts: `"build": "vite build && node copy-manifest.mjs"`,
`"build:watch": "vite build --watch"` — `copy-manifest.mjs` copies `manifest.json`
and `public/icons` into `dist/`. **The folder you load into Overwolf is
`apps/overwolf/dist`.**

### 1.3 manifest.json (complete file — adjust paths only if the build output differs)

```json
{
  "manifest_version": 1,
  "type": "WebApp",
  "meta": {
    "name": "LOBLY",
    "author": "LOBLY",
    "version": "0.1.0",
    "minimum-overwolf-version": "0.240.0",
    "description": "Find verified teammates for League of Legends. Real lobbies, real match data, zero name copying.",
    "icon": "icons/icon.png",
    "icon_gray": "icons/icon_gray.png",
    "launcher_icon": "icons/launcher.ico",
    "window_icon": "icons/window_icon.png",
    "dock_button_title": "LOBLY"
  },
  "permissions": ["GameInfo", "Hotkeys", "FileSystem"],
  "data": {
    "start_window": "background",
    "windows": {
      "background": {
        "file": "src/windows/background/background.html",
        "is_background_page": true,
        "allow_local_file_access": true
      },
      "desktop": {
        "file": "src/windows/desktop/desktop.html",
        "desktop_only": true,
        "native_window": true,
        "resizable": true,
        "show_in_taskbar": true,
        "size": { "width": 1200, "height": 760 },
        "min_size": { "width": 980, "height": 620 },
        "allow_local_file_access": true
      },
      "notifications": {
        "file": "src/windows/notifications/notifications.html",
        "desktop_only": true,
        "transparent": true,
        "resizable": false,
        "show_in_taskbar": false,
        "topmost": true,
        "size": { "width": 360, "height": 120 },
        "allow_local_file_access": true
      }
    },
    "game_targeting": { "type": "dedicated", "game_ids": [5426] },
    "game_events": [5426],
    "launch_events": [
      {
        "event": "GameLaunch",
        "event_data": { "game_ids": [10902, 5426] },
        "start_minimized": true
      }
    ],
    "url_protocol": { "schemes": ["lobly"] },
    "developer": {
      "enable_auto_refresh": true,
      "reload_delay": 1000,
      "filter": "*.js;*.html;*.css"
    }
  }
}
```

Notes for the implementing model:
- `start_window: background` + `is_background_page: true` = invisible controller.
  It opens `desktop` on demand (C6: the app is not background-only because desktop
  exists and opens on launch / dock click).
- Vite emits the window HTML files at `dist/src/windows/<name>/<name>.html`, which
  matches the `file` paths above.
- The `developer` block hot-reloads the unpacked app when the Vite watch build
  rewrites `dist` — keep it in dev, delete it for store submission.

### 1.4 Background controller and window management

`src/shared/ow.ts` — promisify the callback-style Overwolf APIs once, use everywhere:

```ts
export function owCall<T>(fn: (cb: (res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((res: any) => {
      if (res && res.success === false) reject(new Error(res.error ?? "overwolf call failed"));
      else resolve(res);
    });
  });
}

export async function obtainWindow(name: string): Promise<string> {
  const res = await owCall<any>((cb) => overwolf.windows.obtainDeclaredWindow(name, cb));
  return res.window.id;
}

export async function restoreWindow(name: string) {
  const id = await obtainWindow(name);
  await owCall((cb) => overwolf.windows.restore(id, cb));
}
```

`src/windows/background/main.ts` responsibilities (this is the app's brain — every
connection lives here, UI windows are dumb views):

```ts
import { restoreWindow } from "../../shared/ow";
import { startLauncherEvents } from "../../modules/gep/launcherEvents";
import { appStore } from "../../modules/state/store";

async function boot() {
  // expose the store to the other windows (they read it via getMainWindow())
  (window as any).lobly = { store: appStore };

  overwolf.extensions.onAppLaunchTriggered.addListener(() => restoreWindow("desktop"));

  // If the launcher is already running when the app starts, begin immediately;
  // otherwise wait for onLaunched.
  overwolf.games.launchers.getRunningLaunchersInfo((info) => {
    const lol = info.launchers?.find((l) => Math.floor(l.id / 10) === 10902 || l.id === 10902);
    if (lol) startLauncherEvents();
  });
  overwolf.games.launchers.onLaunched.addListener((l) => {
    if (l.id === 10902 || Math.floor(l.id / 10) === 10902) startLauncherEvents();
  });
  overwolf.games.launchers.onTerminated.addListener(() => appStore.setLcuDown());

  await restoreWindow("desktop"); // dev convenience; ship-time: only when user opens
}
boot();
```

(Note the `Math.floor(l.id / 10)` check: Overwolf sometimes reports launcher ids
with a trailing digit, e.g. `109020` — treat any id whose `/10` floor is `10902`,
or that equals `10902`, as the League launcher. The same pattern applies to game id
`5426` vs `54260`+.)

**Cross-window data flow:** UI windows call
`overwolf.windows.getMainWindow()` and read `(mainWindow as any).lobly.store`. The
store is a tiny hand-rolled observable (no Redux):

```ts
// modules/state/store.ts
type Listener = () => void;

export interface AppState {
  lcu: { connected: boolean; port?: string; token?: string };
  summoner?: { puuid: string; gameName: string; tagLine: string; summonerId: number; platform: string };
  gameflowPhase: import("@lobly/shared-types").GameflowPhase;
  lobby?: unknown;               // raw /lol-lobby/v2/lobby payload
  listing: { status: import("@lobly/shared-types").ListingStatus };
  log: string[];                 // ring buffer for the dev HUD
}

class Store {
  private listeners = new Set<Listener>();
  state: AppState = {
    lcu: { connected: false },
    gameflowPhase: "None",
    listing: { status: "DRAFT" as any },
    log: [],
  };
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  update(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  setLcuDown() { this.update({ lcu: { connected: false }, gameflowPhase: "None" }); }
  logLine(s: string) {
    this.state.log = [...this.state.log.slice(-199), `${new Date().toISOString()} ${s}`];
    this.listeners.forEach((l) => l());
  }
}
export const appStore = new Store();
```

React windows subscribe with a `useSyncExternalStore` hook against the main window's
store. Put that hook in `src/shared/messaging.ts`.

### 1.5 Dev workflow (write this into the repo README too)

1. `npm install` at root.
2. `npm run ow:dev` (Vite watch build into `apps/overwolf/dist`).
3. Overwolf desktop client → Settings → About → **Development options** → Load
   unpacked extension → select `apps/overwolf/dist`. (Requires the whitelisted
   account from Milestone 0.)
4. Right-click the app window → Inspect opens CEF devtools (works because
   `developer` block / dev mode). Overwolf logs live under
   `%localappdata%\Overwolf\Log\Apps\LOBLY`.
5. Start the League client. The app should auto-launch (launch_events).

**Milestone 1 acceptance:** all three windows open; desktop shows "hello LOBLY";
background survives closing the desktop window; app auto-starts with the League
client; hot reload works.

---

## Milestone 2 — GEP wiring + the LCU access spike

### 2.1 Launcher events module

`modules/gep/launcherEvents.ts`:

```ts
import { appStore } from "../state/store";
import { onLcuCredentials } from "../lcu/credentials";
import { onGameflowPhase, onLobbyChanged } from "../state/listingMachine";

const LAUNCHER_ID = 10902;
const FEATURES = ["game_flow", "summoner_info", "lobby_info", "champ_select", "end_game", "lcu_info"];

export function startLauncherEvents(attempt = 0) {
  overwolf.games.launchers.events.setRequiredFeatures(LAUNCHER_ID, FEATURES, (res) => {
    if (!res.success) {
      // GEP can be slow to attach right after client start. Retry up to 20x / 3s.
      if (attempt < 20) setTimeout(() => startLauncherEvents(attempt + 1), 3000);
      else appStore.logLine(`GEP setRequiredFeatures FAILED permanently: ${res.error}`);
      return;
    }
    appStore.logLine(`GEP features active: ${JSON.stringify(res.supportedFeatures)}`);
    overwolf.games.launchers.events.onInfoUpdates.addListener(handleInfoUpdate);
    overwolf.games.launchers.events.onNewEvents.addListener(handleNewEvents);
    // Pull the current snapshot once — events only fire on *changes*.
    overwolf.games.launchers.events.getInfo(LAUNCHER_ID, (info) => handleInfoSnapshot(info));
  });
}
```

`handleInfoUpdate` receives objects shaped like
`{ info: { <category>: { <key>: <value> } }, feature: "<feature>" }`. Route by key:

| feature / key | Action |
|---|---|
| `lcu_info` / `credentials.token`, `credentials.port` | feed `onLcuCredentials({port, token})` |
| `game_flow` / `phase` | feed `onGameflowPhase(phase)` |
| `summoner_info` / any | update `store.summoner` (fields: `display_name`, `summoner_id`, `platform_id`, plus puuid via LCU read) |
| `lobby_info` / `queueId`, `player_info` | feed `onLobbyChanged()` → triggers an LCU read of `/lol-lobby/v2/lobby` |
| `end_game` / any | mark session end pending (Phase 3 uses this) |

Important details:
- Values arrive as **strings** even when numeric (`"value":"61862"`); parse
  defensively. `player_info` is a JSON string — `JSON.parse` it.
- Events only fire on change; always call `getInfo()` after subscribing to seed
  initial state (the user may already be sitting in a lobby).
- Keep raw payload logging behind a `DEBUG` flag — payloads contain PUUIDs.

### 2.2 In-game events module (minimal for MVP)

`modules/gep/gameEvents.ts`: on `overwolf.games.onGameLaunched` /
`onGameInfoUpdated` where the game id maps to 5426 and `isRunning`, call
`overwolf.games.events.setRequiredFeatures(["matchState"], cb)` with the same
retry pattern. Listen to `onNewEvents` for `matchStart`. **There is no reliable
matchOutcome event for LoL (C11)** — session end is detected from launcher
`game_flow` returning to `EndOfGame`/`Lobby`/`None`. Do not build anything on
in-game kill/death events in MVP.

### 2.3 THE SPIKE (mandatory, before Milestone 3): validate LCU access from CEF

Write a temporary "LCU Lab" panel in the desktop dev HUD with four buttons, and
record the results in `apps/overwolf/SPIKE_RESULTS.md`:

1. **REST GET** — `fetch("https://127.0.0.1:" + port + "/lol-summoner/v1/current-summoner", { headers: { Authorization: "Basic " + token } })`.
   Expected: 200 JSON with `gameName`, `tagLine`, `puuid`, `summonerId`.
   This validates C2 (self-signed cert accepted by Overwolf CEF for fetch).
2. **REST POST** — with a lobby open and a friendly second account's summonerId,
   `POST /lol-lobby/v2/lobby/invitations` body `[{"toSummonerId": <id>}]`,
   header `Content-Type: application/json`. Expected: invite pops on the other client.
3. **WebSocket A** — `new WebSocket("wss://riot:" + atob(token).split(":")[1] + "@127.0.0.1:" + port + "/", "wamp")`.
   On open, send `JSON.stringify([5, "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"])`.
4. **WebSocket B** (only if A throws) — `new WebSocket("wss://127.0.0.1:" + port + "/", "wamp")` and see whether CEF replays cached Basic credentials from step 1's fetch.

Decision table:

| Result | Consequence |
|---|---|
| 1 & 2 pass (expected) | Proceed. LCU REST is the command/read path. |
| 3 or 4 passes | Set `wsAvailable = true`; `LcuEventBus` uses the WS implementation for lobby/phase updates. |
| 3 & 4 fail (likely) | Fine. GEP remains the only push channel; REST reads are event-triggered. Zero features lost. |
| 1 fails on certificate | Escalate: fall back to GEP-only reads; invites degrade to the manual flow (copy Riot ID + instructions). Flag to the project owner — this changes Phase 3 scope. |

**Do not skip or reorder this spike.** Everything in Milestone 3 depends on its
outcome, and it needs two League accounts on one machine network (two PCs or one PC
+ a laptop) to test the invite.

**Milestone 2 acceptance:** dev HUD live-displays gameflow phase and queueId as you
create/leave lobbies; `SPIKE_RESULTS.md` filled in with all four outcomes.

---

## Milestone 3 — The LCU connector module (production shape)

### 3.1 Endpoint map (C3: remotely configurable)

`packages/lcu-endpoints/endpoints.json` — the ONLY place LCU paths exist:

```json
{
  "version": 1,
  "endpoints": {
    "currentSummoner":      { "method": "GET",  "path": "/lol-summoner/v1/current-summoner" },
    "gameflowPhase":        { "method": "GET",  "path": "/lol-gameflow/v1/gameflow-phase" },
    "lobby":                { "method": "GET",  "path": "/lol-lobby/v2/lobby" },
    "lobbyMembers":         { "method": "GET",  "path": "/lol-lobby/v2/lobby/members" },
    "sendInvite":           { "method": "POST", "path": "/lol-lobby/v2/lobby/invitations" },
    "receivedInvitations":  { "method": "GET",  "path": "/lol-lobby/v2/received-invitations" },
    "acceptInvitation":     { "method": "POST", "path": "/lol-lobby/v2/received-invitations/{invitationId}/accept" }
  },
  "wsEvents": {
    "gameflowPhase": "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
    "lobby": "OnJsonApiEvent_lol-lobby_v2_lobby"
  }
}
```

`modules/lcu/endpoints.ts` loads this bundled copy at startup, then (Phase 3) tries
`GET {backend}/config/lcu-endpoints` and replaces it if the remote `version` is
higher. Store the remote copy in `localStorage`.

### 3.2 Credentials manager

`modules/lcu/credentials.ts`:
- `onLcuCredentials({port, token})` — called by the GEP handler; when both values
  are present, mark connected, run a verification `currentSummoner` read, publish
  `summoner` (including `puuid` and `summonerId`) into the store.
- Credentials **rotate on every client restart** — `onTerminated` clears them, a
  fresh `lcu_info` re-populates them.
- **Fallback** (only if GEP never delivers `lcu_info` within 30s of the launcher
  running): `overwolf.games.launchers.getRunningLaunchersInfo()` → take `path` of
  launcher 10902 → read `<dir>/lockfile` via `overwolf.io.readFileContents` →
  format is `name:pid:port:password:https` → token = `btoa("riot:" + password)`.
- Never write port/token to logs or to the backend (C: LCU secrets are process-local).

### 3.3 Request wrapper (all LCU traffic goes through this one function)

`modules/lcu/request.ts`:

```ts
import { getEndpoint } from "./endpoints";
import { getCreds } from "./credentials";

export class LcuError extends Error {
  constructor(public status: number | "network", public body?: unknown) { super(`LCU ${status}`); }
}

export async function lcuRequest<T>(
  name: string,                                  // key in endpoints.json
  opts: { params?: Record<string, string>; body?: unknown; retries?: number } = {}
): Promise<T> {
  const { method, path } = getEndpoint(name);
  const creds = getCreds();                       // throws if not connected
  let url = `https://127.0.0.1:${creds.port}${path}`;
  for (const [k, v] of Object.entries(opts.params ?? {})) url = url.replace(`{${k}}`, encodeURIComponent(v));

  const retries = opts.retries ?? 2;
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${creds.token}`,
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 404 && method === "GET") return null as T;  // e.g. no lobby open
      if (!res.ok) throw new LcuError(res.status, await res.json().catch(() => undefined));
      return res.status === 204 ? (undefined as T) : await res.json();
    } catch (e) {
      const retriable = e instanceof LcuError ? e.status === 429 || e.status >= 500 : true;
      if (i >= retries || !retriable) throw e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
}
```

Rules: GET `lobby` returning `null` means "no lobby open" — that is a normal state,
not an error. POST bodies for `sendInvite` are arrays:
`[{ "toSummonerId": 3106004487710176 }]`.

### 3.4 Event bus abstraction

`modules/lcu/eventBus.ts` defines:

```ts
export interface LcuEventBus {
  start(): void;
  stop(): void;
  on(evt: "phase" | "lobby", handler: (data: unknown) => void): void;
}
```

- `GepEventBus` (default): translates the Milestone 2 GEP handlers into `phase` /
  `lobby` events; on a `lobby` signal it fetches `lcuRequest("lobby")` and emits the
  full lobby object.
- `WsEventBus` (only if the spike passed): opens the WAMP socket, sends
  `[5, "<eventName>"]` per subscription from `endpoints.json.wsEvents`, parses
  incoming frames `[8, name, {data, eventType, uri}]`, emits accordingly.
  Reconnect with exponential backoff (1s → 30s cap); credentials rotation kills the
  socket, so `stop()` on `onTerminated` and `start()` on fresh creds.

The rest of the app **only** talks to `LcuEventBus` and `lcuRequest` — nothing else
may reference GEP or WebSocket details.

**Milestone 3 acceptance:** kill and restart the League client 3 times → the app
reconnects unaided each time; unplugging (closing client mid-lobby) degrades
gracefully (store shows `lcu.connected=false`, no crash loops); `lobby` object in
the store always matches reality within ~2s of changes.

---

## Milestone 4 — Client listing state machine + dev HUD

### 4.1 State machine

`modules/state/listingMachine.ts` implements the transitions from `00` §6. It is a
pure reducer plus a side-effect dispatcher:

```ts
type MachineEvent =
  | { type: "PUBLISH" }                       // user clicked publish (needs open lobby + phase Lobby)
  | { type: "UNPUBLISH" }                     // user closed the listing
  | { type: "PHASE"; phase: GameflowPhase }   // from LcuEventBus
  | { type: "LOBBY_GONE" }                    // lobby === null while LISTED/FILLING
  | { type: "JOIN_ACCEPTED" }                 // Phase 3: backend accepted someone
  | { type: "MEMBER_ARRIVED" }                // invited player seen in lobbyMembers
  | { type: "SLOT_REOPENED" }
  | { type: "EXPIRED" };
```

Transition table (implement EXACTLY this; anything not listed = ignore event):

| From | Event | To | Side effect |
|---|---|---|---|
| DRAFT | PUBLISH | LISTED | sync `listing.publish` |
| LISTED | JOIN_ACCEPTED | FILLING | run invite flow (Phase 3) |
| LISTED / FILLING | PHASE(ChampSelect) | PAUSED | sync `listing.pause` |
| LISTED / FILLING | LOBBY_GONE | DELISTED | sync `listing.delist` |
| FILLING | MEMBER_ARRIVED | READY | sync `listing.ready` |
| FILLING | SLOT_REOPENED | LISTED | sync `listing.reopen` |
| READY | PHASE(Matchmaking \| ChampSelect) | IN_SESSION | sync `session.start` |
| PAUSED | PHASE(Lobby) + user "queue again" | LISTED | sync `listing.relist` |
| PAUSED | EXPIRED or LOBBY_GONE | DELISTED | sync `listing.delist` |
| IN_SESSION | PHASE(EndOfGame \| Lobby \| None) | POST_SESSION | sync `session.end` |
| POST_SESSION | user "queue again" | LISTED | sync `listing.relist` |
| POST_SESSION | user done / timeout 10min | DELISTED | sync `listing.delist` |
| any | UNPUBLISH | DELISTED | sync `listing.delist` |

"sync X" = call `syncAgent.send(X, payload)`; in Phase 1 that hits the mock backend.
The machine also enforces publish preconditions: `gameflowPhase === "Lobby"` AND
`lobby !== null` AND `lobby.queueId ∈ {420, 440, 450}` — otherwise PUBLISH is
rejected with a store-visible reason string.

### 4.2 Dev HUD (desktop window content for Phase 1)

Single React page, three columns, zero styling effort beyond readable monospace:
1. **Connection** — LCU connected? port, summoner (Riot ID, puuid truncated), GEP
   feature status, gameflow phase (live), current queueId.
2. **Listing machine** — current `ListingStatus`, buttons: Publish / Unpublish /
   simulate JOIN_ACCEPTED / simulate MEMBER_ARRIVED / simulate EXPIRED. The simulate
   buttons exist because the real triggers arrive only in Phase 3.
3. **Log** — the store's ring buffer, plus the LCU Lab spike panel from Milestone 2
   (keep it; it stays useful).

Notifications window: render whatever `store.toast` holds; add a "test toast"
button in the HUD. Auto-hide after 8s; position bottom-right via
`overwolf.windows.changePosition` using `overwolf.utils.getMonitorsList` to find
the primary monitor's work area.

**Milestone 4 acceptance:** walk a real flow — open League lobby (ARAM), Publish in
HUD → LISTED; enter champ select → PAUSED (verified live); dodge back to lobby →
"queue again" → LISTED; close League lobby → DELISTED. All transitions logged.

---

## Milestone 5 — Mock backend + sync agent

`tools/mock-backend/` — one file (`server.mjs`), express + `socket.io`, port 8790:
- `POST /v1/auth/dev-login {email}` → `{accessToken: "dev-" + email}` (no checks).
- `GET /config/lcu-endpoints` → serves `packages/lcu-endpoints/endpoints.json`.
- socket.io namespace `/sync`: log every event received (`listing.publish`,
  `listing.pause`, ...) and echo `{ok: true, serverStatus}` back; keep an in-memory
  listing per socket so reconnects can reconcile.
- A REPL trick for Phase 3 rehearsal: typing `accept` into the mock's stdin emits
  `join.accepted` with a fake requester (name + summonerId from env vars) to all
  connected clients — lets one developer trigger the invite flow manually.

`modules/sync/syncAgent.ts` (client): socket.io-client connection to
`http://localhost:8790/sync` with `auth: {token}`; queue-and-retry buffer (events
are queued while disconnected, flushed in order on reconnect); 30s heartbeat emit
`presence.heartbeat` with `{phase, listingStatus}`. The backend URL comes from a
`config.ts` with `DEV`/`PROD` constants — never hard-code URLs at call sites.

**Milestone 5 / Phase 1 exit criteria (all must pass):**
1. Fresh machine test: install Overwolf → load unpacked `dist` → start League →
   app auto-starts, connects, shows summoner + phase without any manual step.
2. Full listing lifecycle against mock backend with real League client transitions
   (the Milestone 4 walk) — every transition visible in mock backend logs.
3. Typing `accept` in the mock triggers the client to fire a real LCU invite to the
   second test account (wire the `join.accepted` handler minimally: resolve
   summonerId from the mock payload → `lcuRequest("sendInvite", {body: [{toSummonerId}]})`).
4. Kill League client mid-LISTED → listing goes PAUSED/DELISTED, no crash, clean
   reconnect on relaunch.
5. `SPIKE_RESULTS.md` committed; `README.md` documents the dev loop.

Deliverables checklist: `apps/overwolf` complete per this file,
`packages/shared-types` seeded, `packages/lcu-endpoints` created,
`tools/mock-backend` working, both compliance submissions from Milestone 0 sent.
