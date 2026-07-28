# LOBLY — Build Overview (Read This First)

This document is the master context file for building LOBLY. It is written so that a
code-generation model with limited context can build the app phase by phase without
guessing. Read this file fully before starting any phase file.

The build is split into exactly three phases, each with its own file:

| File | Phase | Deliverable |
|---|---|---|
| `01_PHASE_1_OVERWOLF_CLIENT.md` | Phase 1 | Overwolf app skeleton, GEP integration, LCU connector, client state machine, mock backend |
| `02_PHASE_2_BACKEND.md` | Phase 2 | NestJS backend: auth, Riot ingestor, verified profiles, listings + filters, realtime gateway |
| `03_PHASE_3_INTEGRATION_LAUNCH.md` | Phase 3 | End-to-end join flow with invite automation, chat, reputation, compliance, submission |

Source product documents (for reference only — the phase files are self-contained):
`LOBLY_Product_Spec.md`, `LOBLY_Architecture.md`.

---

## 1. What LOBLY Is (One Paragraph)

LOBLY is an Overwolf desktop app for League of Legends players. A player creates a
normal League lobby (duo, flex, ARAM), LOBLY detects it through the local League
Client API (LCU), and the player publishes it as a **listing** with filters (rank
range, role, language, voice). Other players browse listings for their server; every
profile is **verified from real Riot match data**, never self-reported. When the
creator accepts a join request, LOBLY automatically fires the in-client League invite
so both players land in the same lobby without exchanging names. After the game they
endorse each other, building a reputation layer.

---

## 2. The Three Planes

1. **Client plane** — the Overwolf app on the player's machine. The ONLY component
   that can talk to the LCU (League's local API). Handles lobby detection, invite
   automation, logged-in summoner detection.
2. **Backend plane** — LOBLY cloud (NestJS + PostgreSQL + Redis). Owns listings,
   filters, matchmaking, chat, reputation, and ALL Riot Web API calls. The Riot API
   key never ships in the client.
3. **Data plane** — Riot Web API (cloud), LCU API (local), Overwolf GEP events
   (local), Data Dragon static assets.

---

## 3. Fixed Technology Decisions (Do Not Re-Decide These)

| Area | Decision |
|---|---|
| Client framework | **Overwolf Native** (manifest.json, CEF). NOT ow-electron. |
| Client UI | React 18 + TypeScript + Vite. Plain components / Radix primitives only. No heavy UI kits (they misbehave in Overwolf windows). |
| Client windows | `background` (invisible controller), `desktop` (main UI), `notifications` (toasts). |
| Backend | NestJS (Node 20, TypeScript), modular monolith, single deployable. |
| Database | PostgreSQL 15+. Migrations with TypeORM. |
| Cache / realtime fan-out / queues | Redis 7 (cache, pub/sub, presence) + BullMQ (job queue). |
| Realtime | socket.io on a NestJS gateway, `@socket.io/redis-adapter` for scale. |
| Deploy (MVP) | Railway (API + Postgres + Redis). |
| Repo | Single monorepo `lobly/` with npm workspaces (layout in §7). |
| Auth (MVP) | Email + password (bcrypt) + JWT access/refresh. OAuth (Google/Discord) is post-MVP — see Constraint C9. |
| Riot account linking (MVP) | Passive: client reports the logged-in summoner's PUUID from the LCU; backend verifies the PUUID exists via Riot API and binds it. NO RSO OAuth in MVP. |

---

## 4. Constraints Discovered During Research (and the Workarounds Baked Into the Plan)

These were found by reading the Overwolf SDK docs and the community LCU (Hextech)
docs. Each one changed the plan. **The phase files already account for all of these —
this list explains WHY the plan looks the way it does.**

### C1. LCU credentials come from Overwolf GEP, not from lockfile parsing
The classic LCU discovery methods (reading the `lockfile` in the League install
directory, or scanning `LeagueClientUx.exe` process arguments) are awkward inside an
Overwolf app (browser-sandboxed JS, no child-process access). **Overwolf's League
Launcher Events Provider (launcher id 10902) exposes an `lcu_info` feature that
pushes the LCU `port` and a `token` directly to the app.** The `token` value is the
**already-Base64-encoded** `riot:<password>` string, i.e. it can be used verbatim as
`Authorization: Basic <token>`.

Example payloads Overwolf delivers:
```json
{"feature":"lcu_info","category":"credentials","key":"token","value":"cmlvdDoyZ3ltZUNKN3JxNUNNdTliaGlCUlNR"}
{"feature":"lcu_info","category":"credentials","key":"port","value":"61862"}
```
Primary discovery = GEP `lcu_info`. Fallback = reading the lockfile with the
`FileSystem` permission using the install path from
`overwolf.games.launchers.getRunningLaunchersInfo()`. Both are specified in Phase 1.

### C2. The LCU uses a self-signed TLS certificate
Every LCU call is `https://127.0.0.1:<port>/...` with a self-signed cert. Node
programs work around this with a trusted Riot root cert or relaxed TLS. Inside
Overwolf's CEF, community apps call the LCU directly with `fetch()` and the Basic
auth header and this generally works, but **Phase 1 Milestone 2 is a mandatory spike
that verifies `fetch()` and `WebSocket` against the LCU from inside an Overwolf
window before anything is built on top**. If blocked, the documented fallback is:
use GEP features (`game_flow`, `lobby_info`, `summoner_info`) for all READS, and
keep only the invite POST on the LCU path (retried, with manual fallback per C4).

### C3. The LCU is unsupported and can change on any League patch
Riot gives no guarantees. Therefore:
- Every LCU endpoint path lives in a **remote-configurable JSON file**
  (`packages/lcu-endpoints/endpoints.json`, served by the backend at
  `/config/lcu-endpoints`, cached locally). A Riot patch that renames a path is fixed
  by editing a JSON file on the server — no client release.
- Every LCU call goes through one wrapper (`lcuRequest`) with retry + timeout.
- Every automated feature has a **manual fallback** in the UI (e.g. "Copy Riot ID and
  invite manually").

### C4. Riot policy: LCU apps must be reported to Riot; Korea is excluded
Riot requires notification before releasing an app that uses the LCU, and only
endpoints on their approved list may be used. **KR region is region-gated out**
(backend refuses listings/joins from platform `kr`). The exact endpoint list LOBLY
uses (kept deliberately tiny) is in §8 and the submission steps are in Phase 3.

### C5. The Riot Web API key is the scarcest resource
A development key is limited to roughly **20 requests/second and 100 requests/2
minutes per region** and must never ship in the client. All Riot Web API calls go
through one backend module (`riot-client`) with a token-bucket rate limiter and a
priority queue. Freshness policy: profile snapshots are fresh for 6 hours for
browsing; re-verified only at two hot moments (publishing a listing; a creator
opening a join request). Match ingestion is **event-driven** — the client says "my
game just ended", only then does the backend pull new matches. No polling.
A production key application (needs a hosted website with ToS + privacy policy)
happens in Phase 3; the public beta cannot launch on a dev key.

### C6. Overwolf requires at least one visible window and whitelists app ideas first
Background-only apps are rejected. LOBLY's `desktop` window is the start window.
Also, Overwolf approves app *proposals* before development and unreleased apps can
only be loaded as unpacked apps by whitelisted developer accounts — submitting the
proposal is Phase 1, task 0. No in-game overlay in MVP (Overwolf restricts overlays
during active gameplay; LOBLY uses a desktop "second screen" pattern post-MVP).

### C7. Overwolf windows are plain browser JS — no Node
No `require`, no `fs`, no `child_process`. File access only via `overwolf.io` (with
the `FileSystem` permission). All networking is `fetch`/`WebSocket`. The Vite build
must output plain static HTML/JS per window.

### C8. CORS: backend must allow the Overwolf origin
Overwolf app pages are served from an `overwolf-extension://<app-uid>` origin. The
NestJS backend must set permissive CORS (`origin: true`, reflecting the request
origin) or explicitly allow the extension origin, for both REST and socket.io.

### C9. OAuth inside Overwolf is fiddly → email/password for MVP
Browser-based OAuth needs an external browser hop plus a deep link back into the app
(`url_protocol` in the manifest). That is real work with edge cases. MVP ships
email + password auth; the manifest already registers the `lobly://` protocol so
OAuth can be added post-MVP without a manifest resubmission.

### C10. Match-v5 data lives on regional routing hosts, not platform hosts
Platform hosts (`euw1`, `na1`, ...) serve summoner/league data; match data is served
from routing regions (`americas`, `europe`, `asia`, `sea`). The mapping table is in
§8 and hard-coded into `riot-client`.

### C11. In-game GEP has no reliable "match ended with result" event for LoL
Overwolf's LoL in-game events provide `matchStart` but no clean `matchOutcome`.
Plan: use **launcher** `game_flow` phase transitions (`InProgress` →
`WaitingForStats`/`EndOfGame`) as the authoritative session-end signal, with the
in-game `matchState` events as redundancy. Game *results* always come from Match-v5
on the backend, never from client events.

### C13. Browser `WebSocket` cannot send an Authorization header
The LCU WebSocket requires Basic auth on the handshake, but the browser WebSocket
API (all Overwolf windows are browser JS, C7) cannot set headers. Therefore the
**primary push channel is GEP launcher events** (`game_flow`, `lobby_info`, etc.),
LCU REST via `fetch()` (headers work) is used for detail reads and commands, and the
LCU WebSocket is only an optional latency upgrade attempted in the Phase 1 spike
(embedded-credential URLs may work in Overwolf's CEF). No feature depends on the
LCU WebSocket.

### C12. Overwolf OPK submission requires a clean VirusTotal scan
No third-party binaries in the package. No native plugins (`extra-objects`) are used
anywhere in this plan.

### C14. Overwolf whitelisting and Riot's production key form a bootstrapping loop
Overwolf will not whitelist a League-targeting app until Riot has blessed the
concept; Riot's production key page says it "typically requires a working
prototype." Neither party requires the *other's* packaging, though — LOBLY's
LCU integration and backend loop can be fully proven without Overwolf at all.
**Resolution: build and ship a second, thin client host — `apps/desktop`, a
plain Electron app — in parallel with the Overwolf app.** It talks to the same
backend and reuses the exact same connector/state-machine/sync logic. This
breaks the loop (a demo recording of `apps/desktop` working end to end is the
"working prototype" for Riot's application) and is not throwaway work:
Overwolf's developer terms are non-exclusive, so both hosts can ship and stay
live indefinitely — Overwolf for app-store discovery, `apps/desktop` as a
direct download from LOBLY's own site with no review queue. See
`03_PHASE_3_INTEGRATION_LAUNCH.md` §Dual Host Architecture for the extraction
this required (`packages/client-core`) and how each host's LCU access differs
(Overwolf: GEP + fetch per C13; Electron: plain Node `https`/`ws`, no C13
workaround needed at all since Node's WebSocket client can set the
`Authorization` header the browser one can't).

---

## 5. Glossary (Small Model: Memorize These)

| Term | Meaning |
|---|---|
| **LCU** | League Client Update — the local League client and its REST/WSS API at `https://127.0.0.1:<port>`, Basic auth user `riot`. |
| **GEP** | Overwolf Game Events Provider — pushes game/launcher state into the app via `overwolf.games.launchers.events` (launcher) and `overwolf.games.events` (in-game). |
| **Launcher id 10902** | Overwolf's id for the League client (launcher). |
| **Game id 5426** | Overwolf's id for the League game itself (the match process). |
| **PUUID** | Riot's globally-unique player id (78 chars). Stable across name changes. |
| **Riot ID** | `gameName#tagLine`, the player-visible name. |
| **summonerId** | Platform-scoped numeric id; needed for LCU lobby invitations. |
| **Listing** | A LOBLY posting layered over a real League lobby. |
| **Snapshot** | Cached verified profile data (rank, roles, champions) computed by the backend from Riot data. |
| **OPK** | Overwolf app package format for store submission. |
| **WAMP** | The WebSocket message protocol the LCU uses (JSON arrays with opcodes). |
| **Data Dragon** | Riot's static asset CDN (champion names, icons, queue metadata). |

**Queue IDs used everywhere:**

| queueId | Queue |
|---|---|
| 420 | Ranked Solo/Duo |
| 440 | Ranked Flex 5v5 |
| 450 | ARAM |
| 400 | Normal Draft |
| 430 | Normal Blind |
| 490 | Quickplay |
| 700 | Clash |
| 1700 | Arena |

**Gameflow phases (LCU `/lol-gameflow/v1/gameflow-phase`, also GEP `game_flow.phase`):**
`None`, `Lobby`, `Matchmaking`, `ReadyCheck`, `ChampSelect`, `GameStart`,
`InProgress`, `WaitingForStats`, `PreEndOfGame`, `EndOfGame`.

---

## 6. The Listing State Machine (Shared Truth, Client and Server)

```
DRAFT ──publish──► LISTED ──join accepted──► FILLING ──lobby confirmed──► READY
  ▲                  │  ▲                       │                           │
  │                  │  └──slot reopened────────┘                           │
  │        creator enters champ select                            queue started
  │                  ▼                                                      ▼
  └───────────── PAUSED ◄──game ended, "queue again"────────────────── IN_SESSION
                     │                                                      │
                 expired / creator closed lobby                       session ended
                     ▼                                                      ▼
                 DELISTED ◄───────────────────────────────────────── POST_SESSION
```

Enum (identical string values in client, server, and shared-types package):
`DRAFT`, `LISTED`, `FILLING`, `READY`, `PAUSED`, `IN_SESSION`, `POST_SESSION`,
`DELISTED`.

Hard product rule: **no ghost listings**. Entering ChampSelect pauses the listing
(client-enforced, server-verified); a missed heartbeat (>90s) or stale gameflow phase
also pauses it server-side; expiry delists it.

---

## 7. Monorepo Layout (Create Exactly This)

```
lobly/
├─ package.json               # npm workspaces root
├─ apps/
│  ├─ overwolf/               # Phase 1. Overwolf Native app (React + TS + Vite)
│  │  ├─ manifest.json
│  │  ├─ public/              # icons, static assets
│  │  ├─ src/
│  │  │  ├─ windows/
│  │  │  │  ├─ background/    # invisible controller (owns Overwolf-specific glue only)
│  │  │  │  ├─ desktop/       # main UI (thin: renders @lobly/client-core's App)
│  │  │  │  └─ notifications/ # toast window
│  │  │  ├─ modules/
│  │  │  │  ├─ lcu/           # Overwolf-only: creds via GEP, fetch-based REST, optional WSS spike
│  │  │  │  └─ gep/           # launcher + in-game event listeners (Overwolf-only)
│  │  │  └─ shared/           # ow.ts window helpers (Overwolf-only)
│  │  └─ vite.config.ts       # multi-page build (one HTML entry per window)
│  ├─ desktop/                 # C14. Electron host — same core, no Overwolf dependency
│  │  ├─ electron/
│  │  │  ├─ main.ts            # orchestration: configureLoblyCore, IPC, LCU discovery poll
│  │  │  ├─ preload.ts         # contextBridge exposes window.lobly (IPC-backed LoblyBridge)
│  │  │  └─ lcu/                # Node https + ws transport & event bus (no C13 workaround needed)
│  │  ├─ renderer/              # same @lobly/client-core App, plain Vite+React
│  │  └─ esbuild.mjs           # bundles main+preload (renderer uses Vite)
│  ├─ api/                    # Phase 2. NestJS backend
│  │  └─ src/modules/         # identity, profile, lobby, chat, reputation, riot, realtime, config
│  └─ web/                    # Phase 3. Next.js: landing, ToS, privacy (needed for Riot prod key)
├─ packages/
│  ├─ shared-types/           # DTOs, enums, state machine types, socket event names
│  ├─ client-core/            # C14. Host-agnostic: store, listingMachine, syncAgent, api client, UI (App.tsx)
│  │                          #   Host seam = hostAdapter.ts (LcuTransport, CoreEventBus, backendUrl, isDesktopHidden)
│  ├─ lcu-endpoints/          # endpoints.json (remote-versioned LCU endpoint map)
│  └─ riot-client/            # Riot Web API SDK w/ rate limiter (backend-only import)
└─ tools/
   ├─ mock-backend/           # Phase 1 dev harness: tiny express + ws mock
   └─ lcu-standalone/         # Node CLI proving LCU+Riot API access with zero Overwolf (demo/compliance tool)
```

Rules for the implementing model:
1. **Never invent an endpoint path.** LCU paths come from `packages/lcu-endpoints/endpoints.json`. Riot Web API paths come from the table in §8. Backend REST paths come from the tables in Phase 2.
2. **Never put the Riot API key, or any secret, in `apps/overwolf`, `apps/desktop`, or `apps/web`.**
3. All cross-boundary types (client↔server) live in `packages/shared-types` and are imported, never redeclared.
4. Server is authoritative for listing state; client writes are optimistic and reconciled.
5. All filter/eligibility checks are computed **server-side** from server-stored snapshots.
6. When a phase file and this overview disagree, the phase file wins (it is newer and more specific).
7. **All client logic that isn't a literal platform API call belongs in `packages/client-core`, not in `apps/overwolf` or `apps/desktop`.** Each host implements only: LCU credential discovery, the `LcuTransport`/`CoreEventBus` pair (via `hostAdapter.ts`), window chrome, and its own `main`/boot wiring. If you find yourself duplicating listing-machine or sync-agent logic in a host, it belongs in `client-core` instead.

---

## 8. External API Quick Reference

### 8.1 LCU endpoints LOBLY uses (the complete list — do not add more without updating C4 compliance)

| Method | Path | Purpose |
|---|---|---|
| GET | `/lol-summoner/v1/current-summoner` | Logged-in player identity (puuid, gameName, tagLine, summonerId) |
| GET | `/lol-gameflow/v1/gameflow-phase` | Current phase string (drives state machine) |
| GET | `/lol-lobby/v2/lobby` | Current lobby: queueId, members, open slots |
| GET | `/lol-lobby/v2/lobby/members` | Confirm a matched player arrived |
| POST | `/lol-lobby/v2/lobby/invitations` | Fire invite. Body: `[{"toSummonerId": <number>}]` |
| GET | `/lol-lobby/v2/received-invitations` | Requester side: see pending invites |
| POST | `/lol-lobby/v2/received-invitations/{invitationId}/accept` | Requester side: auto-accept (opt-in only) |

LCU auth: header `Authorization: Basic <token>` where `<token>` is the GEP-provided
value (already base64 of `riot:<password>`). Base URL `https://127.0.0.1:<port>`.

**LCU WebSocket (WAMP 1.0):** connect to `wss://127.0.0.1:<port>/` with the same
Authorization header. Messages are JSON arrays, first element is an opcode:
- Subscribe: `[5, "<EventName>"]` — e.g. `[5, "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"]`
- Unsubscribe: `[6, "<EventName>"]`
- Incoming event: `[8, "<EventName>", {"data": ..., "eventType": "Create|Update|Delete", "uri": "/lol-gameflow/v1/gameflow-phase"}]`

Per-endpoint event names are `OnJsonApiEvent_` + the URI with `/` replaced by `_`
(drop the leading slash). Subscribe to the three specific events LOBLY needs
(`gameflow-phase`, `lobby`, `current-summoner`) — do NOT subscribe to the global
`OnJsonApiEvent` (firehose; and you cannot subscribe to the firehose and then
unsubscribe from sub-events).

### 8.2 Riot Web API endpoints (backend only)

| API | Method + Path | Host type |
|---|---|---|
| Account v1 | `GET /riot/account/v1/accounts/by-puuid/{puuid}` | regional |
| Summoner v4 | `GET /lol/summoner/v4/summoners/by-puuid/{puuid}` | platform |
| League v4 | `GET /lol/league/v4/entries/by-puuid/{puuid}` | platform |
| Match v5 | `GET /lol/match/v5/matches/by-puuid/{puuid}/ids?startTime=&count=` | regional |
| Match v5 | `GET /lol/match/v5/matches/{matchId}` | regional |
| Champion Mastery v4 | `GET /lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top?count=10` | platform |

Hosts: platform = `https://{platform}.api.riotgames.com` (e.g. `euw1`), regional =
`https://{region}.api.riotgames.com`. Auth header: `X-Riot-Token: <key>`.

**Platform → regional routing map (hard-code in `riot-client`):**

| Regional route | Platforms |
|---|---|
| `europe` | euw1, eun1, tr1, ru |
| `americas` | na1, br1, la1, la2 |
| `asia` | kr (BLOCKED by C4), jp1 |
| `sea` | oc1, sg2, tw2, vn2 |

### 8.3 Data Dragon (static, cache aggressively)
- Versions: `https://ddragon.leagueoflegends.com/api/versions.json` (first element = latest)
- Champions: `https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json`
- Champion icon: `https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{ChampionName}.png`
- Profile icon: `https://ddragon.leagueoflegends.com/cdn/{version}/img/profileicon/{iconId}.png`

Backend caches champion data in Redis (24h TTL) and serves it to clients at
`/static/champions`; clients never hit Data Dragon per-request.

### 8.4 Overwolf APIs used (client only)

| API | Use |
|---|---|
| `overwolf.windows` | obtain/restore/minimize/close windows, window messaging |
| `overwolf.games.launchers` | `getRunningLaunchersInfo`, `onLaunched`, `onTerminated` (id 10902) |
| `overwolf.games.launchers.events` | `setRequiredFeatures(10902, [...])`, `onInfoUpdates`, `onNewEvents` |
| `overwolf.games.events` | in-game events for game 5426 (`setRequiredFeatures`, `onNewEvents`) |
| `overwolf.games` | `onGameLaunched`, `onGameInfoUpdated` (detect game 5426 running) |
| `overwolf.notifications` / toast window | join-request toasts |
| `overwolf.io` (FileSystem permission) | lockfile fallback read only |
| `overwolf.extensions` | relaunch, version info |

Manifest permissions (complete list): `GameInfo`, `Hotkeys`, `FileSystem`.
`game_targeting`: dedicated, `[5426]`. `game_events`: `[5426]`. `launch_events`:
GameLaunch on `[10902]` (auto-start when the League client opens), plus
`LaunchWithOverwolf`.

---

## 9. MVP Cut Line (What to Build, What to Skip)

**IN (the three phases build exactly this):** passive Riot account linking, verified
profile cards, listing types Duo (420) / Flex (440) / ARAM (450), filter engine
(rank range, role, language, voice), listing board with Match Score v1 (rank + role
+ language only), join flow with invite automation + 90s timeout, session chat,
endorsements + reliability v1, block & report, no-ghost-listing enforcement.

**OUT (do not build, do not stub beyond a TODO comment):** Clash finder, custom game
tools, communities, scheduled lobbies, reverse LFG feed, champ select insights,
build import, leaderboards, public web profiles, RSO login, subscriptions/payments,
overlays, spectator verification, saved-search alerts, Instant Join.

---

## 10. Order of Operations (Compliance Gates)

1. **Before Phase 1 coding:** submit the Overwolf app proposal (whitelisting) and
   register on the Riot developer portal for a dev key. Both are free and asynchronous.
2. **During Phase 2:** run everything on the dev key, test accounts only.
3. **During Phase 3:** deploy `apps/web` (ToS + privacy on owned domain) → apply for
   Riot production key → file the Riot LCU usage notification with the §8.1 endpoint
   list → submit the OPK to Overwolf QA.
4. Gate the public beta until the production key is granted (C5).

Success metrics to instrument from day one: time-from-open-to-full-lobby, listing
fill rate, no-show rate on accepted joins, repeat-partner session rate.
