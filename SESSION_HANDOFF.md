# LOBLY — Session Handoff (Cursor Continuation)

**Purpose of this file:** everything done in the Claude Code session that isn't
captured in `00_BUILD_OVERVIEW.md` / `01`–`03` phase docs. Those four files are
the original *plan*; this file is what actually happened when the plan met
reality, including every real bug found and fixed. Read this before touching
the code — several of these bugs are the kind that are easy to reintroduce by
accident if you don't know why the current code looks the way it does.

Written 2026-07-25. Read alongside the phase docs, not instead of them.

---

## 1. Where the project actually is right now

The MVP loop works end-to-end against a real Riot API key and a real League
client, for **one host**: the Electron standalone app (`apps/desktop`). The
Overwolf app (`apps/overwolf`) has all the same fixes applied and typechecks/
builds clean, but has **never been run inside real Overwolf** — there is still
no whitelisted Overwolf dev account (see §7, Compliance status).

What is verified working live, tonight, on the user's own account
(`NeedAhmed#main`, platform `me1`, Emerald IV):

- LCU discovery, auth, gameflow phase, lobby detection (both REST seed and
  live WebSocket events)
- Login/session against the real NestJS API (not the Phase-1 mock)
- Riot account linking → real PUUID resolved server-side, stored, verified
- Profile snapshot ingestion (rank, roles, form, streak, top champions)
- Match history ingestion + a rich per-match/scoreboard API
- The full redesigned UI (sidebar app shell, profile header, match history
  with expandable scoreboards, board, requests, session/chat, diagnostics)
- Real-time lobby state sync between the League client and the app

What is **not yet exercised**: publishing a listing and going through the
actual join/invite flow with a second account (Phase 3's join protocol).
Everything up to "My Lobby shows my real League lobby, Publish button is
enabled" is confirmed. Nobody has clicked Publish against the real backend
yet in this session.

---

## 2. The big pivot: why `apps/desktop` (Electron) exists at all

This wasn't in the original 3-phase plan. Overwolf whitelisting turned out to
require Riot's blessing first, and Riot's production API key application
explicitly wants a working prototype before approving — a bootstrapping loop
neither party could break alone (documented as **C14** in
`00_BUILD_OVERVIEW.md`).

**Resolution:** build a second, fully independent client host with zero
Overwolf dependency — `apps/desktop`, a plain Electron app — that proves the
whole loop out on its own and doubles as demo material for both Riot and
Overwolf. This is not throwaway/demo-only code: Overwolf's developer terms
are non-exclusive, so both hosts are meant to ship long-term. Overwolf gives
app-store discovery; the standalone Electron build gives a no-review-queue
direct-download channel.

This required extracting everything host-agnostic out of `apps/overwolf`
into a new shared package, **`packages/client-core`**: the listing state
machine, the store, the sync agent, the backend API client, and — as of this
session — the **entire UI**. Both hosts render the literal same React
components.

### The seam: `packages/client-core/src/hostAdapter.ts`

Every host calls `configureLoblyCore({ backendUrl, lcuTransport, eventBus,
isDesktopHidden })` once at boot, before touching anything else from the
package. Each host supplies its own implementation of `LcuTransport`
(how to make one LCU request) and `CoreEventBus` (how phase/lobby push
events arrive).

| Piece | Overwolf | Electron |
|---|---|---|
| Credential discovery | GEP `lcu_info` feature, lockfile fallback via `overwolf.io` | Direct lockfile read / `LeagueClientUx.exe` CIM query (`electron/lcu/lockfile.ts`) |
| `LcuTransport.request()` | `fetch()` (`modules/lcu/request.ts`) | Node `https.request` (`electron/lcu/transport.ts`) |
| `CoreEventBus` | GEP-driven; LCU WebSocket only as an optional spike-gated upgrade (browser `WebSocket` can't set the Basic-auth header) | Node `ws` client, headers set directly on the handshake — this is the **primary and only** channel, no workaround needed |
| UI shell | `windows/{background,desktop,notifications}` | Single `BrowserWindow` + `preload.ts` contextBridge |

**Rule going forward:** if new logic doesn't call a platform API
(`overwolf.*` or Electron's `ipcMain`/`BrowserWindow`/Node built-ins), it
belongs in `packages/client-core`, not in either app. New socket events,
DTOs, or UI screens go into `client-core`'s `api/`, `state/`, or `ui/` — both
hosts pick them up automatically once they typecheck/build.

---

## 3. `tools/lcu-standalone` — keep this around

A plain Node CLI (`tools/lcu-standalone/`) that talks to the LCU and Riot Web
API directly with zero Overwolf/Electron involvement. Originally built to
break the compliance loop (record a demo for Riot/Overwolf without needing
either party's approval first). It is also now the fastest way to debug raw
LCU behavior without going through the full app — used repeatedly this
session to diagnose bugs (see §6).

Commands: `whoami`, `lobby`, `friends`, `invites`, `invite <summonerId>`,
`accept <invitationId>`, `watch` (live phase/lobby stream), `profile
<platform> <riotId> <tagLine>` (builds a verified profile straight from
Riot's API, no backend needed).

A diagnostic script was added during this session:
`tools/lcu-standalone/wsdump.mjs <seconds>` — dumps every raw WAMP event URI
for a lobby subscription. Use this whenever LCU event behavior is suspicious;
it was the tool that would have caught the URI-matching bug in §6.9 fastest
(it wasn't actually run in time to catch it live — worth running proactively
next time something looks like duplicate/flapping state).

---

## 4. Backend changes this session (beyond the original phase-2/3 plan)

### 4.1 Riot account linking was fundamentally broken — now fixed

**The original plan (`02_PHASE_2_BACKEND.md`) assumed the LCU's `puuid` could
be sent straight to Riot's Web API.** This is wrong. The LCU's
`current-summoner` response contains a **local UUID**, not the real 78-char
Riot PUUID. Sending it to `account-v1/by-puuid` fails with `"Exception
decrypting"`.

**Fix:** identity now travels as the Riot ID (`gameName#tagLine`), and the
server resolves the real PUUID itself via `account-v1/by-riot-id`. Ownership
proof is unchanged (only the account owner can be logged into that client).
The LCU's local UUID is still stored — as `lcu_puuid` — purely so presence
heartbeats can match "who's online right now" to a linked account.

Files: `apps/api/src/database/entities/riot-account.entity.ts` (new
`lcuPuuid` column), `apps/api/src/modules/identity/dto/link-riot.dto.ts`
(rewritten — no more `puuid`/`summonerId` required fields, now `gameName` +
`tagLine` + `platform` + optional `lcuPuuid`/`summonerId`),
`apps/api/src/modules/identity/riot-accounts.service.ts` (`link()` rewritten
around `accountByRiotId`), `packages/riot-client/src/client.ts` (new
`accountByRiotId` method), client side:
`packages/client-core/src/api/session.ts`'s `linkCurrentSummoner()` sends
`lcuPuuid` instead of `puuid`.

**If you ever add a new platform/region**, note `me1` (Middle East) was
missing from the routing table entirely — `packages/riot-client/src/
regions.ts` now includes it, routed via `europe`. Riot's platform list keeps
growing; don't assume the original 14-platform table in `00_BUILD_OVERVIEW.md`
§8.2 is complete.

### 4.2 Match history — new feature, not in original phase docs

The user asked for detailed match history (Mobalytics-style). Built:

- **Migration** `apps/api/src/database/migrations/1750000000000-MatchHistory.ts`
  — adds `riot_accounts.lcu_puuid`, plus two new tables:
  - `matches` — one row per match, full participant list as JSONB (powers
    the expanded scoreboard).
  - `match_participations` — one row per (account, match), denormalized so
    the history list is a single indexed read, no JSON parsing per request.
- **Entities:** `apps/api/src/database/entities/match.entity.ts`,
  `match-participation.entity.ts`.
- **Ingestion:** `apps/api/src/modules/profile/profile-refresh.service.ts`
  gained `persistMatches()` — runs inside the existing profile-refresh job,
  upserts every match it already fetches (no new Riot API calls).
- **Read API:** `apps/api/src/modules/profile/match-history.service.ts` +
  `GET /v1/profiles/:riotAccountId/matches?limit=&queueId=`. Computes KDA,
  CS/min, damage share (% of own team's champion damage), kill
  participation, and returns full teammate/opponent scoreboards.
- **Types:** `packages/shared-types/src/match.ts` (`MatchHistoryRow`,
  `MatchScoreboardEntry`, `queueName()` helper).
- **Static assets endpoint:** `champions.service.ts` extended from just
  champion icons to a full `StaticData` bundle — champions + summoner spells
  + rune tree + item/profile-icon URL templates, all from one Data Dragon
  fetch, cached 24h in Redis. New route: `GET /static/ddragon`.

### 4.3 Two real crash bugs fixed (not cosmetic — these took the whole API
down)

1. **`bcrypt` + NestJS webpack build.** `node-pre-gyp`'s S3-fallback code
   path pulls in optional deps (`aws-sdk`, `mock-aws-s3`, `nock`) that
   aren't installed, and Nest's webpack build tries to bundle them anyway.
   Fixed with a custom `apps/api/webpack.config.js` that externalizes
   `bcrypt` (referenced via `nest-cli.json`'s `webpackConfigPath`). **Do not
   set `webpack: false` in nest-cli.json as an alternative fix** — that was
   tried first and breaks the build differently, because `apps/api`'s
   tsconfig path-maps `packages/shared-types` and `packages/riot-client` as
   raw `.ts` source outside the project root, and plain `tsc` computes an
   outDir structure Nest's non-webpack runner doesn't expect
   (`dist/apps/api/src/main.js` instead of `dist/main.js`). Webpack must
   stay on.
2. **Presence sweeper crash from anonymous socket connections.**
   `SyncGateway.handleConnection` accepts a `dev-` prefixed token as an
   anonymous pseudo-user (`userId = "dev:" + token`) for local testing. It
   was calling `presence.watchUser(userId)` unconditionally, which added the
   non-UUID string to Redis's `presence:watch` set. The 15-second sweeper
   (`PresenceService.sweepMissingPresence`) then ran a real UUID-typed
   Postgres query against every watched id with **no error handling** —
   one bad entry crashed the entire Node process. Fixed two ways: (a)
   `sync.gateway.ts` no longer calls `watchUser` for `dev:` pseudo-users at
   all (they have no real listings to track), and (b) `presence.service.ts`
   now wraps each sweep iteration in try/catch as defense-in-depth, so no
   future malformed entry can ever repeat this.
3. **`server.adapter is not a function`** in `SyncGateway.afterInit`. A
   namespace-scoped `@WebSocketGateway({ namespace: "/sync" })` injects the
   socket.io *Namespace* object for `@WebSocketServer() server`, not the
   root `Server` — only the root has `.adapter()`. Fixed by reaching
   `(server as any).server.adapter(...)`.
4. **Circular DI resolution failure.** `ReputationService` injects
   `ProfileService` (and vice versa) — a genuine circular module
   dependency. `ProfileService`'s side already had
   `@Inject(forwardRef(() => ReputationService))`; `ReputationService`'s
   injection of `ProfileService` was missing the matching
   `@Inject(forwardRef(...))`. Both sides of a circular injection need it,
   not just one.

### 4.4 Error handling polish

`riot-accounts.service.ts`'s `link()` used to rethrow any non-404
`RiotHttpError` (401 bad key, 429 rate limit, Riot 5xx) as a raw `Error`,
surfacing as an opaque `500` to the client. Now returns a clean `503
RIOT_API_UNAVAILABLE`. Unknown/unmapped platform now returns `400
INVALID_PLATFORM` instead of throwing inside `regionForPlatform()`
(`isKnownPlatform()` guard added to `packages/riot-client/src/regions.ts`,
checked before routing).

---

## 5. Client changes this session

### 5.1 Full UI redesign — `packages/client-core/src/ui/`

The Phase-1 "developer HUD" prototype (plain monospace debug panel) is gone.
Replaced with a real app shell, shared by both hosts:

| File | Contents |
|---|---|
| `theme.ts` | Design tokens: color palette, rank-tier colors, role icons/labels (inline SVG paths, no icon font dependency), font stack, radius/shadow scale, one injected global stylesheet (`GLOBAL_CSS`) |
| `components.tsx` | Primitives: `Card`, `Button` (primary/ghost/subtle/danger), `Tag`, `RoleIcon`/`RoleLabel`, `RankBadge`, `Avatar`, `StatBlock`, `WinRateBar`, `Spinner`, `EmptyState`, `LoadingBlock` |
| `useStaticData.ts` | Fetches `/static/ddragon` once, module-level cached across the app run; `championIcon()`, `itemIcon()`, `spellIcon()`, `runeIcon()`, `profileIcon()` helpers |
| `MatchHistory.tsx` | The centerpiece: match list with queue filters, per-row KDA/CS/damage/vision stats, item/rune/spell icons, multikill badges, **click-to-expand full 10-player scoreboard** with per-player damage bars |
| `ProfileView.tsx` | Header (avatar ring colored by rank tier, form/streak/reliability stat blocks), ranked solo+flex cards with win-rate bars, top-champion list, embeds `MatchHistory`, settings (auto-accept toggle, endorsement counts) |
| `BoardView.tsx` | Listing board cards with a circular SVG match-score ring, rank badges, role icons |
| `LobbyViews.tsx` | `ListingView` (My Lobby — detected lobby + publish controls + manual-invite fallback), `RequestsView`, `SessionView` (chat + endorsement prompts) |
| `DebugView.tsx` | Renamed "Diagnostics" — connection facts table, state-machine simulate buttons, LCU Lab (Overwolf-only, hidden when `bridge.spike` is absent), event log |
| `App.tsx` | Sidebar shell (nav, connection status panel, toast), header (gameflow phase pill, listing status tag), routes the six tabs |

All exported from `packages/client-core/src/index.ts`.

### 5.2 Design verification method (no literal screenshot capability)

The Claude Code browser pane in this environment can't composite frames for a
real screenshot. Verification was done instead with:
- `apps/desktop/renderer/preview.tsx` + `preview.html` — a dev-only Vite
  entry that renders the real `<App/>` against the **real backend** in a
  plain browser tab (logs in with the dev account, seeds a fake
  `lcu.connected` state so the shell renders as if a client were attached).
  Run with `npm run preview` inside `apps/desktop` (port 5199), separate
  from the shipped `index.html` entry — confirmed **not** bundled into the
  production build.
- `mcp__Claude_Browser__javascript_tool` calls to assert computed styles,
  image load counts (239 images, 0 broken, real Data Dragon URLs),
  DOM text content per tab, and interaction (clicking a match row expands
  the scoreboard with real player data).

If you want an actual visual screenshot, do it from Cursor/your own machine
— `npm run preview` inside `apps/desktop`, open `localhost:5199/preview.html`
in a normal browser.

### 5.3 `apps/desktop` (Electron) bug fixes

These were found by actually running the app repeatedly and reading the
console — not caught by typecheck or the design preview, because the
preview harness (§5.2) accidentally masked most of them by manually seeding
state the real app has to earn.

1. **`contextBridge.exposeInMainWorld` drops class prototype methods.**
   `preload.ts`'s `RendererStore` class defined `subscribe`, `update`, etc.
   as normal `method() {}` syntax (prototype methods). Electron's
   contextBridge only clones/proxies **own enumerable properties** of the
   exposed object — prototype methods vanish across the bridge. Symptom:
   `TypeError: u.subscribe is not a function`, and because this crashed
   *before* React could mount anything, the window showed nothing but its
   dark background — completely silent, no error visible without opening
   DevTools. **Fix: every method on `RendererStore` is now an arrow-function
   class field** (assigned as an own instance property in the constructor).
   If you add new methods to that class, they must follow the same pattern
   or this bug comes back.

2. **Renderer has no auth token — every authenticated call 401s.** Main
   process and renderer are separate JS contexts with separate module
   state. Main calls `ensureSession()` and holds the JWT; the renderer's own
   copy of the API client starts with `accessToken = null`. Every
   authenticated fetch from the UI (profile, board, match history) went out
   with no `Authorization` header. Fixed with a **delegated auth provider**:
   `packages/client-core/src/api/client.ts` gained
   `setAuthTokenProvider()` — a UI-only context can register a function that
   supplies the token from elsewhere instead of owning a session itself. In
   Electron: `apps/desktop/renderer/main.tsx` calls
   `setAuthTokenProvider((force) => window.LOBLY_GET_AUTH_TOKEN(force))`,
   which is an IPC round-trip (`preload.ts` exposes it, `main.ts` handles
   `IPC.GET_AUTH_TOKEN` by calling `ensureSession()` again if forced/missing
   and returning the current token). On a `401`, `apiFetch` now asks the
   provider to re-auth and retries once automatically.
   **Overwolf had the identical latent bug** (its desktop window is also a
   separate module-state context from the background window) — fixed there
   too, but with the host-appropriate mechanism: Overwolf windows share an
   origin/`localStorage`, so `windows/desktop/main.tsx` just calls
   `loadStoredAuth()` to read back what the background window already
   stored, no IPC needed.

3. **Gameflow phase was never wired up in Electron at all.** When
   `client-core`'s `wireListingMachineToBus()` was extracted, it only
   subscribed to `"lobby"` bus events. Overwolf survives this because its
   GEP module calls `onGameflowPhase()` directly as a separate code path —
   the bus's `"phase"` handler was already dead code for Overwolf.
   Electron's *only* phase source is the bus, so phase silently stayed at
   `"None"` forever, permanently blocking Publish
   (`"Need gameflow Lobby (have None)"` even while sitting in a lobby).
   Fixed: `wireListingMachineToBus()` now also subscribes to `"phase"` and
   calls `onGameflowPhase()`.

4. **App was blind to state that already existed at launch, and after any
   reconnect.** The LCU WebSocket only pushes *changes* — if you're already
   sitting in a lobby before LOBLY starts, no event ever fires and the app
   sees nothing until something changes. Added
   `refreshLcuState()` (`packages/client-core/src/state/listingMachine.ts`)
   — a one-shot REST read of current phase + lobby. Called from
   `apps/desktop/electron/main.ts` on every credential discovery, **and**
   passed as an `onSubscribed` callback into `ElectronLcuEventBus` so it
   re-runs after every WebSocket (re)connect, not just the first one.

5. **Early state pushes silently dropped, freezing the UI on stale data.**
   Main pushes the full app state to the renderer on every store change via
   `mainWindow.webContents.send(IPC.STATE_PUSH, ...)`. Anything sent before
   the renderer finished loading its scripts was discarded by Electron —
   this is why "League client: connected" could show correctly (pushed
   early) while "LOBLY server: offline" stayed wrong forever (pushed a few
   hundred ms later, lost). Fixed: `main.ts` now listens for
   `webContents.on("did-finish-load", ...)` and resends the complete
   current state at that point, so the renderer always gets at least one
   authoritative full snapshot after it's actually ready to receive it.

6. **WAMP event name matching was substring-based, catching sub-resources.**
   `ElectronLcuEventBus`'s WebSocket message handler matched
   `name.includes("lobby")` to route events to the lobby handler. A
   subscription to `/lol-lobby/v2/lobby` also delivers events for its
   **sub-resources** — `/lol-lobby/v2/lobby/members`,
   `.../invitations`, etc. — whose payloads aren't lobby objects (e.g.
   `members` is a bare array with no `queueId`). Symptom: the log alternated
   `lobby detected queueId=420` / `queueId=null` many times per event burst,
   non-deterministically ending on whichever event landed last. **Fixed two
   layers deep:**
   - `apps/desktop/electron/lcu/transport.ts` now matches the **exact URI**
     (`evt.uri === LOBBY_URI`) sourced from the same
     `packages/lcu-endpoints/endpoints.json` every other LCU call uses, not
     a name substring. Non-matching URIs are ignored outright.
   - `packages/client-core/src/state/listingMachine.ts`'s new `applyLobby()`
     additionally has a **shape guard** (`isLobbyShaped()` — requires
     `gameConfig`, `queueId`, or `partyId` to be present) so that even an
     unexpected/malformed payload can never silently overwrite known-good
     lobby state. This guard protects both hosts, not just Electron.
   - Also normalized WAMP `Delete` events to `null` explicitly (a Delete
     event's `data` field may still echo the last known value rather than
     being empty).
   - **This fix is typechecked/built but not yet confirmed against a live
     leave/create-lobby event** — see §8 below. Use
     `tools/lcu-standalone/wsdump.mjs 60` to watch raw URIs while
     leaving/creating a lobby if you want hard proof before trusting it
     fully.

7. Devtools no longer auto-open on every launch (was added as a debugging
   aid, now gated behind `LOBLY_DEVTOOLS=1` env var). Several
   `webContents.on(...)` diagnostic listeners were added and are worth
   keeping permanently: `console-message` (renderer console → main's
   stdout, since Electron doesn't forward this by default),
   `did-fail-load`, `render-process-gone`, `preload-error`.

### 5.4 `localStorage` shim for Electron main process

`packages/client-core`'s auth persistence (`api/client.ts`) calls the
browser `localStorage` global directly — correct for Overwolf (runs in a
real Chromium window) but Electron's **main process** is plain Node with no
such global at all. `ensureSession()` running in main was failing with
`localStorage is not defined`, silently falling through to an unauthenticated
"dev-local" sync path every launch. Fixed with a small file-backed shim
(`apps/desktop/electron/localStorageShim.ts`) — installed once at the top of
`main.ts`, before any other import's code can run.

---

## 6. Infra / environment notes specific to this machine

- **A native PostgreSQL 18 Windows service already occupies port 5432** on
  this machine, unrelated to LOBLY. Docker's Postgres container is remapped
  to host port **5433** — see `apps/api/docker-compose.yml` and
  `apps/api/.env`'s `DATABASE_URL`. Don't "fix" this back to 5432; it'll
  silently connect to the wrong database.
- Docker credential helper (`docker-credential-desktop.exe`) isn't always on
  PATH in a fresh shell — if `docker compose` fails with
  `error getting credentials`, add
  `C:\Program Files\Docker\Docker\resources\bin` to PATH for that shell.
- `RIOT_API_KEY` in `apps/api/.env` is currently a **live, valid personal
  key** — do not commit `.env`, it's already gitignored. If it stops working
  ("Unknown apikey" from Riot), the key was regenerated/expired on the Riot
  dev portal dashboard — go get the current value, don't assume it's a code
  bug (this exact confusion cost real time earlier in the session — the
  first "expired key" was actually just the wrong key pasted in).
- The user's real test account: Riot ID `NeedAhmed#main`, platform `me1`
  (Middle East shard — routes via `europe` for Match-v5/Account-v1), Emerald
  IV solo, Emerald IV flex.
- Multiple stray `electron.exe`/`node.exe` processes accumulate fast across
  repeated rebuild/relaunch cycles (each `npm run desktop:start` that isn't
  cleanly closed leaves orphans) and can eventually cause bizarre resource-
  starvation build failures (`vite build` crashing with exit code
  3221226505 was traced to ~50 accumulated zombie processes, not a code
  bug). If a build fails with a weird native-crash exit code for no reason,
  check `Get-Process electron,node` first before debugging the code.

---

## 7. Compliance status (unchanged from `00_BUILD_OVERVIEW.md` C14, still open)

- Overwolf app-idea proposal: submitted (form filled in an earlier part of
  this session), status was **not yet approved** as of this session — see
  the "Submit Your App Idea" flow and the Overwolf DevRel reply asking for
  proof of Riot approval.
- Riot developer portal: Personal API Key **approved**, App ID `862817`.
  Riot's production key is the actual unblock target — Riot's FAQ
  explicitly allows submitting during the planning stage; approval (not
  submission) is what waits on a complete product. The Electron app now
  running end-to-end with real data is legitimate demo material for that
  application — screen-record the sequence in
  `tools/lcu-standalone/README.md`'s "Recording the demo" section (same
  sequence, now doable through the real app UI instead of just the CLI).
- Nothing new was submitted to either Riot or Overwolf during this session;
  this is still an open action item for the user.

---

## 8. What's unverified / immediate next steps

In rough priority order:

1. **Confirm the WAMP URI-matching fix (§5.3.6) against a live lobby
   leave/create cycle.** Run `node tools/lcu-standalone/wsdump.mjs 60` in
   one terminal, leave and recreate a League lobby, confirm you only see
   `uri=/lol-lobby/v2/lobby` events (not `/members`, `/invitations`) and
   that the app's own log shows a single clean transition with no
   `null`/`queueId` flapping.
2. **Actually click Publish** on a real lobby and confirm a listing gets
   created server-side (`POST /v1/listings` — check `listings` table or
   `GET /v1/listings/mine`).
3. **Run the full join flow with a second account** — this is all of Phase
   3's protocol (`03_PHASE_3_INTEGRATION_LAUNCH.md` §Milestone 1) and has
   not been exercised even once against the real backend yet. Two machines
   or two accounts needed.
4. Session chat, endorsements, block/report — built per the phase-3 plan,
   never smoke-tested this session.
5. Continue the design pass if desired — current UI is real and functional
   but the user's bar is "Mobalytics-grade" and ongoing. Candidates
   mentioned: champion splash art in the profile header, LP-over-time
   graph, per-role performance breakdown, a dedicated champion detail page.
6. Push the Overwolf/Riot compliance items forward (§7) — nothing blocks
   this now that there's a working, demo-able app.

---

## 9. How to run everything (current commands)

From `D:\LOBLY` (repo root) unless noted:

```bash
# One-time / after a machine restart:
docker compose -f apps/api/docker-compose.yml up -d   # Postgres (5433) + Redis (6379)
npm run api:migration:run                               # only if migrations changed

# Every session:
npm run api:dev            # NestJS backend, :8790
npm run desktop:build      # renderer (Vite) + main/preload (esbuild)
npm run desktop:start      # launch the Electron app

# Design-only preview (no League client needed, real backend):
cd apps/desktop && npm run preview   # http://localhost:5199/preview.html

# Standalone LCU/Riot CLI (no app needed):
cd tools/lcu-standalone && node src/cli.mjs whoami
node wsdump.mjs 60         # raw WAMP event dump, see §8.1
```

Regression checks worth running after any change to `packages/client-core`
or `apps/api`:

```bash
cd apps/overwolf && npx tsc --noEmit    # Overwolf still compiles
cd apps/desktop  && npx tsc --noEmit    # Electron still compiles
cd apps/api      && npx tsc -p tsconfig.build.json --noEmit && npx jest --silent
npm run ow:build && npm run desktop:build   # both actually bundle clean
```

If port `8790` refuses to bind (`EADDRINUSE`) after a crash, a stray
`node.exe` is still holding it —
`Get-NetTCPConnection -LocalPort 8790 -State Listen` (PowerShell) shows the
PID to kill.
