# 04 — Party Lobby Sync & Post-Game Reputation Loop

**Status:** design / implementation plan — nothing in this doc is built yet.
**Written:** 2026-10-15. Read after `SESSION_HANDOFF.md`.
**Scope:**

1. **Party lobby sync.** While the League client is in *Lobby* or *Champ Select*,
   read who is in **your own party**, which roles they hold, and which queue
   it is. Keep the published LOBLY listing in sync with that. This is the same
   job as Mobalytics' lobby/game-flow tracking, **limited to your party**.
2. **Close the loop at end of game.** On the end-of-game transition, refresh
   the verified profile from Riot and prompt endorsements. Mobalytics uses
   that moment for highlights and a post-game page. LOBLY uses it for
   **reputation**. The profile, match history and champion stats LOBLY already
   shows are enough. **No second analytics product.**

The doc is in four parts:
§1 what Mobalytics actually does (reverse engineered),
§2 where LOBLY is today and what is missing,
§3 the design,
§4 the build plan, file by file, with tests.

---

## 1. What Mobalytics does (reverse-engineering findings)

### 1.1 Method and evidence

- **Target:** Mobalytics Desktop, Overwolf extension
  `kccgdmdllebbgifgafjfmcjdgmhoknfhjdnobcho`, version **1.956.344**. It was
  installed on this machine at
  `%LOCALAPPDATA%\Overwolf\Extensions\kccgdmdllebbgifgafjfmcjdgmhoknfhjdnobcho\1.956.344\`.
- **Source maps ship with the app** (`source-map/background/background.js.map`,
  6.4 MB, 1,111 sources). The original TypeScript of 593 first-party modules
  was recovered from `sourcesContent`. Every quote below comes from those
  recovered files. Only the decorator helpers were trimmed.
- **REA static analysis** of the shipped `background/background.js`:
  - Application graph: `ev_4d04c6ced35107b87bea068657c20de5d0ee40595208af15a47bac7f46c8f5b1`.
    Coverage was **partial**: the worker ran out of heap on the 1.6 MB bundle,
    so the semantic graph is incomplete. That gap is why the recovered source
    is the primary evidence here.
  - Trace for `/lol-end-of-game/v1/eog-stats-block`:
    `ev_c84dcc26e28e03151e274885df179e6907164f1d6bb22bc60849189cac15d325`.
    It shows the endpoint observed as a `fetch` call at `background.js:1759:83929`.
- **Evidence types used:**
  - *Observed:* read in the shipped code or the recovered source.
  - *Inferred:* reasoned from that code but not run.
  - Nothing here was observed at runtime. Mobalytics was never launched for
    this work.

### 1.2 Architecture (observed)

Mobalytics runs everything that touches the LCU in the **background window**.
The pieces are DI singletons wired with tsyringe:

| Layer | Module (recovered path under `src/lol/`) | Job |
|---|---|---|
| Credentials | `utils/lol-lcu-lockfile.ts` | Reads `lockfile` next to `LeagueClient.exe` (two directory levels are tried). Falls back to parsing `--remoting-auth-token` / `--app-port` from the launcher command line. |
| Push channel | `services/riot-lcu/lcu-rtd-service/lcu-rtd-service.impl.ts` + `common/api/connectors/ow-websocket-connector` | **One WAMP WebSocket to the LCU, subscribed to `OnJsonApiEvent` (everything)**. Messages go into a `queue` with `concurrency: 1`. They are de-duplicated per URI with `fast-deep-equal`, then schema-validated and normalized. If validation fails, the code **falls back to a REST GET** of the same URI. |
| State | `services/riot-lcu/lcu-state-service/lcu-state-service.impl.ts` | One `LcuState` object: `{flowPhase, phase, queueInfo, queueType, matchId, allies, enemies, bans, observableSummoner}`. `init()` seeds it with REST (`/lol-gameflow/v1/session`, then `/lol-champ-select/v1/session`). WS events mutate it after that. A change is emitted only when `!equal(prev, next)`. |
| Phase router | `controllers/lol-game-controller/lol-game-controller.impl.ts` | Turns state changes into `LOL_PHASE_CHANGED {from, to, state}`. Runs `onEnter*` hooks only when `isPhaseChanged(from, to)` passes a **legal-transition table**. |
| Post-game | `controllers/lol-post-game-controller/*` + `storages/lol-lc-post-game-data-storage` | On `InProgress`: registers the match with their backend. On `WaitingForStats`: snapshots state and fetches the post-game data with retries. Emits `LOL_POST_GAME_DATA` when **all** inputs have arrived. |
| Windows | `controllers/lol-window-controller` | Opens or restores windows on phase edges, each once per game. Sets a flag per trigger: `isMainWndShowOnMatchmaking`, `…OnLobbyStart`, `…OnChampionLock`, `…OnEndOfGame`. |

### 1.3 Findings that matter for LOBLY

**F1. The LCU WebSocket works inside Overwolf. (observed)**
`ow-websocket-connector.impl.ts` does not use the browser `WebSocket`. It uses
Overwolf's native API:

```ts
createWebSocket({ credentials: { username, password }, port,
                  protocols: ['wamp'], secured: true })   // overwolf.web.createWebSocket
// then: ws.send(JSON.stringify([5, 'OnJsonApiEvent']))
```

It sends a heartbeat (`[0]` ping, then pong-age check), checks connection
status, and reconnects. **This is the fix for LOBLY's open problem.**
`SESSION_HANDOFF.md` §2 says the Overwolf host cannot use the LCU WebSocket
because "browser `WebSocket` can't set the Basic-auth header". So the
Overwolf host currently runs on GEP plus REST pulls. Mobalytics shows that
`overwolf.web.createWebSocket` takes credentials directly. This removes the
need for spike tests 3 and 4 in `apps/overwolf/SPIKE_RESULTS.md`.

**F2. Gameflow is driven by `/lol-gameflow/v1/session`, not `/gameflow-phase`. (observed)**
The session object carries `phase`, `gameData.gameId`, `gameData.queue
{id, type, gameMode}`, and `teamOne/teamTwo`. Mobalytics reads the queue and
the **gameId** from it. `matchId = gameData.gameId` is captured at
`GameStart`/`InProgress` (`lcu-flow-phase.utils.ts`). This one detail makes a
reliable post-game step possible: you know which match to look up before the
game even ends.

**F3. A legal-transition table filters out phase flapping. (observed)**
See `utils/utils.ts` → `flowPhaseTransitionMap` + `isPhaseChanged`. Examples:
`InProgress → {TerminatedInError, WaitingForStats, PreEndOfGame, EndOfGame}`,
`WaitingForStats → {PreEndOfGame, EndOfGame, None}`,
`Reconnect → {InProgress, WaitingForStats}`. Repeated or out-of-order events
do not fire the hooks again. `isValidData()` also drops flow-session events
whose queue id disagrees with the current queue during
ChampSelect/GameStart/InProgress/WaitingForStats. Those are stale events
from the previous queue.

**F4. The post-game trigger is `WaitingForStats`, gated by "all inputs ready" and de-duplicated by match id. (observed)**
- `onPhaseChanged` → `case WaitingForStats: onEnterWaitingForStatsPhase`.
- If `matchId === 0`, it recovers the id from `GET /lol-end-of-game/v1/eog-stats-block`
  (`.gameId`).
- It fetches `/lol-match-history/v1/games/{id}` and `/game-timelines/{id}` from
  the **LCU** with retries: 60 tries × 500 ms, with backoff after 50. If
  either fails, it falls back to `eog-stats-block` (100 tries × 1 s, 2-minute
  timeout).
- `LolLcPostGameDataStorage.mayBePostGameDataSourceReady()` fires
  `LOL_POST_GAME_DATA_SOURCE_READY` only once, and only after every input is
  set. `reset()` runs when the next game starts.
- `shouldProceedProcessing()` refuses a `matchId` equal to
  `lastAcquredMatchID`. That is the idempotency guard.
- It then uploads (gzip+base64) to their GraphQL `lol.gameUpdate` with
  `status: lol_game_finished`, retrying `until: !!response.lol.gameUpdate.match`.

**F5. The end-of-game window opens once per game, on the `EndOfGame` edge. (observed)**
The windows are closed at `WaitingForStats`/`PreEndOfGame`. The main window
is restored when `EndOfGame` is reached, guarded by `isMainWndShowOnEndOfGame`.
This is the "moment" the post-game page uses.

**F6. Mobalytics does NOT read the party lobby. (observed, bounded search)**
A grep of all 593 recovered first-party sources for `lol-lobby` matches only
`/lol-lobby-team-builder/champ-select/v1/session`. Their "lobby tracking" is
gameflow plus champ select (allies/enemies, bans, picks). **LOBLY's party
roster sync is LOBLY's own feature.** There is nothing to copy for the
`/lol-lobby/v2/lobby` part. What can be copied is the approach: a pipeline
of queue, de-dup, validation, and REST fallback.

**F7. Mobalytics de-anonymizes champ select. LOBLY must not. (observed)**
`team-mates-utils.ts` resolves every `myTeam[].summonerId` through
`GET /lol-summoner/v1/summoners/{id}` to get `gameName#tagLine`. In ranked
champ select those names are hidden from players **on purpose**. LOBLY's
scope is "limited to your party". In champ select LOBLY uses **only cells
whose puuid/summonerId belongs to a member of the party lobby we already
saw**. It never looks up strangers.

**F8. Robustness patterns worth copying. (observed)**
- A single-consumer queue for LCU events. Async handlers never interleave.
- A per-URI deep-equal cache. Duplicate events are no-ops.
- Schema validation, with REST re-fetch on failure.
- Launcher-terminated is **deferred while the game is live**. Closing the
  client mid-game does not reset state (`onLauncherTerminate`,
  `isTerminationDeferred`).
- On stop, if the phase was ChampSelect/ReadyCheck/PreEndOfGame/WaitingForStats,
  the app navigates back to the profile instead of leaving a stale screen.

---

## 2. LOBLY today

### 2.1 What exists

| Piece | Where | State |
|---|---|---|
| LCU REST transport, both hosts | `apps/overwolf/src/modules/lcu/request.ts`, `apps/desktop/electron/lcu/transport.ts` | Works |
| Push: Electron | `apps/desktop/electron/lcu/transport.ts`, Node `ws`, subscribes to gameflow-phase + lobby | Works (live-verified) |
| Push: Overwolf | `apps/overwolf/src/modules/lcu/eventBus.ts`: `GepEventBus` (phase from GEP `game_flow`, lobby re-read on GEP `lobby_info`). `WsEventBus` stays gated behind the never-run spike | GEP only |
| Endpoints registry | `packages/lcu-endpoints/endpoints.json` | `gameflowPhase`, `lobby`, `lobbyMembers`, invites. **No** `gameflowSession`, `champSelectSession`, `eogStatsBlock` |
| Lobby → capability | `packages/shared-types/src/queues.ts` `deriveLobbyCapability()` | queueId, `maxLobbySize`, `freeSeats`, `positional`. **Members are counted, not described** |
| Listing state machine | `packages/client-core/src/state/listingMachine.ts` | DRAFT→LISTED→FILLING→READY→IN_SESSION→POST_SESSION. `maybeReconcileSlots()` posts **only `freeSeats`** |
| Session end + endorse | `apps/api/src/modules/session/session.service.ts` `onSessionEnd()` | Increments `gamesPlayed`. Calls `profiles.ensureFresh(…,'game_ended')`. Emits `ENDORSE_PROMPT` only when `final` |
| Endorsements | `reputation.service.ts` `endorse()`, `endorsements` table (PK session, from, to, kind) | Works. Requires `session.endedAt`; 24 h window |
| Client endorse state | `client-core/src/sync/syncAgent.ts` stores `endorsePrompt` and shows a toast | No dedicated post-game screen |

### 2.2 Gaps and bugs (found by reading the code, not by running it)

- **G1. The endorse prompt probably never fires. (bug)**
  `listingMachine.ts:289` sends `SESSION_END` through `sync()`, which builds
  the payload as `{status, phase, queueId}`. `sync.gateway.ts:204` reads
  `payload.observedPhase` and `payload.final`, and neither is ever sent. So
  `final` is computed as false. `IN_SESSION → POST_SESSION` also happens on
  the **first** of EndOfGame/Lobby/None, and `POST_SESSION` never sends
  `SESSION_END` again. Result: `session.endedAt` is never set, `ENDORSE_PROMPT`
  is never emitted, and `endorse()` would reject with `SESSION_NOT_ENDED`
  anyway. *Verify with a two-account run before fixing, because this is
  inferred from code.*
- **G2. The profile refresh at game end usually misses the game that just ended.**
  `FRESHNESS_MS.game_ended = "always"` enqueues the refresh right away. But
  Riot `match-v5` usually publishes a match 30 s to a few minutes after
  `EndOfGame`. The refresh job finishes, reads the match list, and does not
  find the new match. It does not retry. Mobalytics has the same problem on
  the LCU side and solves it with 60×500 ms retries keyed on a known gameId
  (F4).
- **G3. The refresh only runs for LOBLY sessions.** `ensureFresh('game_ended')`
  is called only inside `onSessionEnd`. Someone who plays solo, or with
  friends found outside LOBLY, never gets an end-of-game refresh. The brief
  says "refresh the verified profile" on every end-of-game.
- **G4. The listing does not describe the party.** The board knows the seat
  count, but not *who* holds the filled seats or *which roles* are taken. A
  listing for "need SUP" can stay published after a friend joins the lobby
  and takes support.
- **G5. No gameId is captured.** Nothing records `gameData.gameId`. So the
  server cannot tie "these accounts played match X together" to a Riot match.
  That link is what makes endorsements trustworthy (§3.3.4).
- **G6. The Overwolf push channel is weak.** It relies on GEP `lobby_info`
  signals plus a REST re-read, so lobby changes arrive late or get merged
  together. F1 removes the reason for this.
- **G7. No transition guard.** `onGameflowPhase()` dispatches every phase it
  receives. Flapping (`Lobby → Matchmaking → Lobby`, reconnect, GEP and WS
  both delivering) can drive the machine twice.

---

## 3. Design

### 3.1 Principles

1. **Your party only.** We read `/lol-lobby/v2/lobby` (you can already see
   these people) and the champ-select cells of those same people. We **never**
   call `/lol-summoner/v1/summoners/{id}` for a champ-select cell that is not a
   known party member. Enemy team data is never read. Live-game data
   (`127.0.0.1:2999`) is never read.
2. **The client observes, the server decides.** Clients report raw facts
   (party roster, phase, gameId). The server does the listing mutations,
   session attestation, refresh scheduling and endorsement eligibility.
   Clients are never trusted for reputation. Riot `match-v5` is the
   tie-breaker.
3. **Host-agnostic logic lives in `packages/client-core`** (handoff §2 rule).
   Hosts only provide transport and push.
4. **Copy Mobalytics' robustness, not its features.** That means a
   single-consumer queue, de-dup, a transition table, REST fallback,
   idempotency keyed on gameId, and "fire once when all inputs are ready".

### 3.2 Part A: Party lobby sync

#### 3.2.1 LCU data sources

Add these to `packages/lcu-endpoints/endpoints.json`:

```jsonc
"gameflowSession":    { "method": "GET", "path": "/lol-gameflow/v1/session" },
"champSelectSession": { "method": "GET", "path": "/lol-champ-select/v1/session" },
"eogStatsBlock":      { "method": "GET", "path": "/lol-end-of-game/v1/eog-stats-block" },
// wsEvents
"gameflowSession":    "OnJsonApiEvent_lol-gameflow_v1_session",
"champSelectSession": "OnJsonApiEvent_lol-champ-select_v1_session"
```

Keep `gameflowPhase` as a cheap fallback. **`gameflowSession` becomes the
source of truth** for phase, queue and gameId (F2).

**Push channel, per host:**

- **Electron:** extend the existing `ws` subscriptions in
  `electron/lcu/transport.ts` with the two new events. Keep the **exact URI
  matching** (handoff §6.9 bug). Champ-select also publishes sub-URIs such
  as `/lol-champ-select/v1/session/timer` that are not session objects.
- **Overwolf:** replace the spike-gated `WsEventBus`/`wsClient.ts` with a
  connector built on `overwolf.web.createWebSocket({credentials:{username:'riot',
  password: token}, port, protocols:['wamp'], secured:true})`. Model it on
  Mobalytics' connector (F1): subscribe `[5, "<event>"]` per event, not
  `OnJsonApiEvent` (we need 4 URIs, not the firehose), ping `[0]` every N s,
  reconnect on close, and fire `connected/disconnected` events. **Keep GEP**
  as a redundant phase source and as the `lcu_info` credential source. If the
  socket is down, fall back to today's GEP + REST path. Leave the manifest
  alone: `createWebSocket` is under the `Web` permission, which Mobalytics'
  manifest also declares. Confirm LOBLY's manifest has it.

#### 3.2.2 One event pipeline in `client-core`

New module: `packages/client-core/src/lcu/gameFlowTracker.ts`. Both hosts
feed it raw `{uri, data}` messages through `CoreEventBus`. Widen the `on()`
union to `"phase" | "lobby" | "gameflowSession" | "champSelect"`. Hosts that
only have phase+lobby keep working.

```
raw event ─► SerialQueue(concurrency 1)
           ─► dedupe: deepEqual(cache[uri], data) → drop
           ─► validate+normalize (zod-like guards; on fail → REST GET same name)
           ─► reducer(prev PartyState, event) → next PartyState
           ─► if !deepEqual(prev,next): emit "party:changed"
           ─► if phase edge passes isLegalTransition(prevPhase, nextPhase): emit "phase:edge" {from,to,state}
```

- `SerialQueue`: about 20 lines. A promise chain, so we do not need the
  `queue` npm package.
- `isLegalTransition`: port Mobalytics' `flowPhaseTransitionMap` (F3) into
  `packages/shared-types/src/gameflow.ts`. Add `TerminatedInError` and
  `Reconnect` to the `GameflowPhase` type, because LOBLY's type does not
  have them yet.
- `isValidData` guard: drop a `gameflowSession` whose `queue.id` differs from
  the current one while the phase is ChampSelect/GameStart/InProgress/WaitingForStats.
- `listingMachine.onGameflowPhase` subscribes to `phase:edge` instead of raw
  phases. This fixes G7.

#### 3.2.3 The `PartyState` model (new in `shared-types/src/party.ts`)

```ts
export interface PartyMember {
  puuid: string;              // LCU lobby member puuid (local UUID — see handoff §4.1)
  summonerId: number;
  riotId: string | null;      // gameName#tagLine from lobby member (visible to you already)
  isLeader: boolean;
  isLocal: boolean;
  /** Lobby: from first/secondPositionPreference. Champ select: assignedPosition. */
  roles: Role[];              // [] = FILL/UNSELECTED
  ready?: boolean;
  /** Champ select only, and only for members matched to a party member. */
  champSelect?: { assignedRole: Role | null; championLocked: boolean };
  /** Filled in by the server from riot_accounts.lcu_puuid — null if not a LOBLY user. */
  loblyAccountId?: string | null;
}

export interface PartyState {
  phase: GameflowPhase;
  queueId: number | null;
  gameMode: string | null;
  partyId: string | null;     // lobby.partyId — stable for the party's life
  gameId: number | null;      // gameflow session gameData.gameId (0 until GameStart)
  members: PartyMember[];
  maxLobbySize: number;
  positional: boolean;
  filledRoles: Role[];        // derived: union of members' primary role (positional queues)
  openRoles: Role[];          // derived: ALL_ROLES − filledRoles (positional queues), else []
  observedAt: number;
}
```

**Reducers:**

| Input | Effect |
|---|---|
| `lobby` (from `/lol-lobby/v2/lobby`) | Replace `members` from `lobby.members[]`. `roles = [firstPositionPreference, secondPositionPreference]` mapped through the existing `Role` mapping (`TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY`; `FILL`/`UNSELECTED` → `[]`). Set `partyId`, `queueId` (via `deriveLobbyCapability`), `maxLobbySize`, `positional`. Recompute `filledRoles`/`openRoles`. `lobby == null` → `members=[]` (the existing LOBBY_GONE path stays). |
| `gameflowSession` | Set `phase`, `queueId`, `gameMode`. When `phase ∈ {GameStart, InProgress}` **and** `gameData.gameId > 0`, set `gameId` (F2). Reset `gameId` to `null` on the `Lobby`/`None` edge after an end-of-game. |
| `champSelect` | Build `partyIds = Set(members.map(m => m.summonerId))`. For each `myTeam[]` cell with `summonerId ∈ partyIds`, set `champSelect.assignedRole` from `assignedPosition`. Set `championLocked` from the matching completed `pick` action (`actorCellId == cellId`). **Ignore every other cell (F7).** In positional draft, `assignedPosition` is authoritative, so overwrite `filledRoles` with the party's assigned roles. |
| `eogStatsBlock` | Only fills a missing `gameId` (F4 fallback). |

`appStore` gets `party: PartyState | null`. `lobby`/`lobbyCapability` stay as
they are, because the publish draft code depends on them.

#### 3.2.4 Keeping the listing in sync

Today `maybeReconcileSlots()` posts `freeSeats`. Replace it with a debounced
**party reconcile**:

- **Client.** In `listingMachine.ts`, on `party:changed`, while the listing is
  LISTED/FILLING/PAUSED, debounce for 1.5 s (keep the existing throttle)
  and call `PATCH /listings/:id/party` with body:

  ```ts
  { partyId, queueId, members: [{ puuid, summonerId, roles, isLeader }], filledRoles, phase }
  ```

  This replaces `reconcileListingSlots(listingId, freeSeats)`. The server can
  derive `freeSeats` from `members.length`.

- **Server.** New endpoint in `ListingsService.reconcileParty()`:

  1. **Authorization.** The caller must own the listing, and the caller's
     `riot_accounts.lcu_puuid` must appear in `members[]`.
  2. **Queue drift.** If `queueId !== listing.queueId`, delist with reason
     `QUEUE_CHANGED`. The user moved to another queue, so the listing no
     longer describes the lobby. The client already rebuilds the draft when
     the queue changes. Also emit `LISTING_STATE {reason}` so the UI can
     offer "republish for this queue".
  3. **Who is in the party.** Map members to LOBLY accounts with
     `lcu_puuid IN (…)`. Store `listing.party` (new JSONB column) as
     `{ members: [{accountId|null, riotId, roles, isLeader}], updatedAt }`.
     Store riotIds **only** for members who are LOBLY users or who the
     creator invited through LOBLY. Others are stored as
     `{ riotId: null, roles }` ("1 friend · JUNGLE"). This keeps the board
     from exposing non-users' identities.
  4. **Slot reconciliation** (positional queues). For each open
     `ListingSlot`, if every role in `slot.roles` is now in `filledRoles`,
     close it with `open=false, closedReason:'FILLED_IN_CLIENT'`. If a
     member leaves and their role frees up, reopen the slot **only if the
     slot was closed by `FILLED_IN_CLIENT`**. Never reopen a slot the
     creator closed by hand.
  5. **Seat count.** If `members.length >= maxLobbySize` → `PAUSED`
     (behavior as today). If seats free up and the status is `PAUSED` with
     reason `LOBBY_FULL`, set it back to `LISTED`.
  6. **Join tracking.** For a PENDING/ACCEPTED join request whose requester's
     `lcu_puuid` now appears in `members`, this is a server-side
     `LOBBY_CONFIRMED`. This makes the client's 3-second
     `startLobbyWatch` polling in `syncAgent.ts` redundant. Keep the polling
     as a fallback for one release, then delete it.
  7. Invalidate the board cache, then `fanout.emitBoardUpsert`.

- **Board card** (`BoardView.tsx`, `ListingSummary`). Show the party strip:
  role icons for filled roles, plus the open roles. In non-positional queues
  (ARAM, Arena) show "3/5". This is the visible result of "keep the listing
  in sync".

**Champ select.** The listing is already `PAUSED` on ChampSelect. During
champ select we report `assignedRole`s only, so the **session record**
(§3.3) knows each LOBLY member's real position. That is useful later for
role-accuracy reputation. It is not shown on the board.

#### 3.2.5 Presence heartbeat

Add `partyId` and `gameId` to `PresenceHeartbeatPayload`. The server uses
them for the attestation in §3.3.4. This costs nothing, because the
heartbeat already runs every `HEARTBEAT_MS`.

### 3.3 Part B: The end-of-game loop

#### 3.3.1 Detecting the moment (client)

In `gameFlowTracker`, on a `phase:edge`:

| Edge (must pass `isLegalTransition`) | Action |
|---|---|
| `→ GameStart` / `→ InProgress` | Freeze a **GameContext** `{gameId, queueId, partyId, partyMembers (puuids), startedAt}`. Persist it in host storage, so it survives a LOBLY restart mid-game (Mobalytics keeps it in memory, which LOBLY does not want). Send `game.started {gameId, queueId, partyId, memberPuuids}`. |
| `→ WaitingForStats` / `→ PreEndOfGame` / `→ EndOfGame` (first of them) | **Game-ended edge.** If `gameId` is missing or 0, GET `eogStatsBlock` with retries (F4: 1 s × up to 60). Send `game.ended {gameId, queueId, partyId, memberPuuids, endedAt, terminatedInError:false}` **once per gameId** (client guard `lastEndedGameId`, same idea as Mobalytics `lastAcquredMatchID`). |
| `→ TerminatedInError` | Do nothing yet. Wait for `Reconnect → InProgress`. If the client sits at `None`/`Lobby` without passing through stats, send `game.ended {…, terminatedInError:true}`. The server treats that as "probably a remake/crash": refresh the profile, but do not prompt endorsements unless Riot confirms the match. |
| Launcher closed while InProgress/GameStart | Copy F8: **defer**. Keep the GameContext. When the client comes back, or after `GAME_INFO_UPDATED isRunning=false`, re-read `gameflowSession` and continue. |
| `→ EndOfGame` | **UI moment** (F5): open or focus the LOBLY window **once per gameId** on the Post-game screen (§3.3.5). Respect a user setting `openOnGameEnd` (default **on**). Never steal focus while the League client is in the foreground and its EOG screen is still loading. Use `showWindowBehind`-style placement on Overwolf. On Electron use `win.showInactive()`. |

`game.ended` is sent **for every game**, not only for LOBLY sessions. This
fixes G3. The listing machine keeps its own IN_SESSION → POST_SESSION
transitions, and `SESSION_END` is fixed separately (§3.3.3).

#### 3.3.2 Server: `GameLifecycleService` (new, `apps/api/src/modules/game/`)

New socket events, added to `shared-types/src/socket-events.ts`:

```ts
GAME_STARTED: "game.started",   // C2S
GAME_ENDED:   "game.ended",     // C2S
POSTGAME_READY: "postgame.ready", // S2C — profile refreshed + endorse targets resolved
```

New table `game_reports`, migration `1770000000000-GameLifecycle.ts`:

```sql
CREATE TABLE game_reports (
  game_id          bigint      NOT NULL,
  platform         text        NOT NULL,
  riot_account_id  uuid        NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
  queue_id         int,
  party_id         text,
  member_lcu_puuids text[]     NOT NULL DEFAULT '{}',
  session_id       uuid        NULL REFERENCES sessions(id) ON DELETE SET NULL,
  started_at       timestamptz,
  ended_at         timestamptz,
  terminated_in_error boolean NOT NULL DEFAULT false,
  riot_match_id    text        NULL,     -- e.g. EUW1_7012345678 once confirmed
  riot_confirmed_at timestamptz NULL,
  PRIMARY KEY (game_id, platform, riot_account_id)
);
CREATE INDEX idx_game_reports_session ON game_reports(session_id);
```

`onGameEnded(userId, payload)`:

1. Resolve the caller's active `riot_account` (platform comes from the account).
   Upsert the `game_reports` row. **Idempotent on the PK**, so retries and
   duplicate edges do nothing.
2. **Attach to a session.** If the user has an active LOBLY session whose
   `memberAccountIds` all reported the same `(game_id, platform)` (or this
   report completes that set), set `session_id`. Then call
   `SessionService.onGameEnded(session, gameId)`. This replaces the
   game-count part of today's broken `onSessionEnd` path (G1).
3. **Schedule a Riot-confirmed refresh** (fixes G2). Enqueue the BullMQ job
   `postgame:{platform}:{gameId}:{accountId}` with a **delayed** first run
   of 45 s, then backoff 30 s, 60 s, 120 s, 240 s, 480 s (about 16 min
   total). The `jobId` de-duplicates. Each attempt:
   - `GET match-v5 /lol/match/v5/matches/{PLATFORM}_{gameId}` through
     `riot-client.matchById(regionalRoute, id)`. Note that match ids are
     uppercase platform + `_` + gameId, e.g. `ME1_123…`.
   - On **404**, throw so BullMQ retries.
   - On **200**, set `riot_match_id`/`riot_confirmed_at`. Run
     `ProfileRefreshService.refresh(accountId)`, which now **includes** the
     new match. The existing `persistMatches` and champion-stat code then
     update match history and champion stats. No new analytics.
   - **Verify the party.** Read `info.participants[].puuid`. Every LOBLY
     member of the session must be present, and members of the same
     session must share a `teamId`. Store the result on the session as
     `riot_verified_game_ids`.
   - Emit `POSTGAME_READY {gameId, profileRefreshed:true, endorse: {sessionId, others[]}|null}`
     to the user.
   - On final failure (match never appeared: custom game, practice tool, or
     a remake that Riot drops): run a plain `refresh()` anyway so rank/LP
     stays current. Emit `POSTGAME_READY {profileRefreshed:true, riotConfirmed:false, endorse:null}`.
4. Skip queues that Riot does not put in match-v5 or that make no sense for
   reputation: practice tool, tutorial, and (configurable) custom games.
   Gate this with `isPublishableQueue` / a new `isReputationQueue(queueId)`
   in `queues.ts`.

**Rate budget.** One `matchById` per attempt, at most about 6 attempts per
player-game. Members of the same session share the request: the job key is
per `(platform, gameId)` for the *fetch*, and the result fans out to each
member's refresh. Use a Redis lock `postgame:fetch:{platform}:{gameId}`
with a 30 s TTL. This fits the existing `riot-client` rate limiter.

#### 3.3.3 Fix the session-end and endorsement path (G1)

- **Client** (`listingMachine.ts`): `SESSION_END` must send
  `{listingId, observedPhase: phase, final}`. Set
  `final = (phase === 'Lobby' || phase === 'None')`. Also send a **second**
  `SESSION_END {final:true}` when POST_SESSION sees `Lobby`/`None`. Better:
  make `POST_SESSION` handle `PHASE Lobby|None` by sending
  `SESSION_END {final:true}` once.
- **Server:** remove the endorsement trigger from `onSessionEnd(final)`.
  **Endorsement eligibility comes from Riot confirmation** instead (step 3
  above):
  - `endorse()` keeps the 24 h window, but the window starts at
    `max(session.endedAt, riot_confirmed_at)`. If `session.endedAt` is null,
    accept `riot_verified_game_ids` being non-empty as "ended enough" for
    that game.
  - Add an `endorsements.game_id` column (nullable) to the PK, or a unique
    index on `(session_id, game_id, from, to, kind)`. This allows **one
    endorsement per teammate per verified game**, not one per session. A
    5-game duo session can earn up to 5 per teammate. To limit farming,
    cap the score so each pair counts once per 24 h:
    `reputation.getEndorsementCounts` uses `COUNT(DISTINCT (from, date_trunc('day', created_at)))`.
- **Organic parties (optional, behind flag `organicEndorse`).** Two LOBLY
  users can queue together without going through a listing (friends who
  both have LOBLY). If the server sees ≥2 linked accounts report the same
  `(platform, gameId, partyId)` and Riot confirms both on the same team, it
  creates a lightweight `sessions` row with `listing_id = NULL`. That needs
  `listing_id` to become nullable plus a `source: 'LISTING'|'ORGANIC'`
  column. Those users then become endorsable. Default **off** for launch,
  because reputation should be anchored to LOBLY matchmaking first.

#### 3.3.4 Why attestation + Riot is the trust anchor

Nothing a client says creates reputation by itself:

- `game.ended` from one client creates only that client's `game_reports` row.
- Endorsement needs (a) a LOBLY session the server created from an accepted
  join, **and** (b) Riot's match-v5 showing both puuids on the same team in
  that `gameId`.
- PUUID mapping uses the server-resolved real PUUID from
  `riot_accounts.puuid`, **not** the LCU-local UUID (handoff §4.1). The LCU
  `lcu_puuid` is only used to map lobby members to accounts. Match-v5
  verification uses the real `puuid`.

#### 3.3.5 Post-game screen (client UI)

New route `PostGameView.tsx` in `client-core/src/ui/`. It opens on the
`EndOfGame` edge. It has three blocks, all built from data LOBLY already
shows:

1. **Result row.** Win/loss, champion, KDA, queue, duration. Before Riot
   confirms, show "Fetching your game from Riot…" from local
   `eogStatsBlock` data (`localPlayer.stats`, `teams[].isWinningTeam`). This
   is the local preview Mobalytics also falls back to (F4). After
   `POSTGAME_READY`, swap in the confirmed `MatchHistory` row component that
   already exists, with the expandable scoreboard.
2. **Profile delta.** Rank/LP before → after (snapshot diff), and the
   recent-form strip updated. Reuse `ProfileView` header pieces.
3. **Endorse teammates.** Shown only if `POSTGAME_READY.endorse` is non-null.
   One card per party teammate from the LOBLY session: riotId, the role
   they played (from `champSelect.assignedRole`, or from Riot
   `teamPosition`), and three toggle chips GOOD_COMMS / GOOD_TEAMMATE /
   SKILLED. Then **Send** → `POST /reputation/endorse` (exists). Also a
   quiet "Report" link to the existing report flow. Add a "Skip" button.
   Endorsing is optional and never blocks anything.

On `→ Lobby`/`→ Matchmaking`, the screen collapses into a dismissible
banner "Endorse your last teammates (23 h left)". It does not stay as a
full page. That mirrors Mobalytics resetting windows on the Lobby edge.

Notifications: if the LOBLY window is hidden, show a toast through the
existing `isDesktopHidden()` path when `POSTGAME_READY.endorse` arrives.

### 3.4 Compliance and privacy notes

- **Your party only.** We read the lobby (visible to the user), champ-select
  cells **only for known party members**, and our own EOG block. No
  summoner lookups of champ-select strangers (contrast with F7). No
  live-client-data API. No enemy information.
- The board shows party members' Riot IDs **only** for LOBLY users who are
  in the listing's session. Other people in a party are shown by role only.
- `game_reports` keeps `member_lcu_puuids` for 30 days and then nulls
  them. The `chat-retention` sweeper pattern can be reused.
- This is all ordinary Riot match-v5 usage under the production key. No new
  Riot API products are needed.

---

## 4. Build plan

### Milestone M1: Event pipeline and Overwolf WebSocket (client-only)

| File | Change |
|---|---|
| `packages/lcu-endpoints/endpoints.json` | + `gameflowSession`, `champSelectSession`, `eogStatsBlock`. + 2 wsEvents |
| `packages/shared-types/src/listing.ts` | `GameflowPhase` += `TerminatedInError`, `Reconnect` |
| `packages/shared-types/src/gameflow.ts` (new) | `FLOW_TRANSITIONS`, `isLegalTransition()` (port of F3), `isEndOfGameEdge()` |
| `packages/shared-types/src/party.ts` (new) | `PartyMember`, `PartyState`, `GameContext` |
| `packages/client-core/src/hostAdapter.ts` | Widen `CoreEventBus.on` event union |
| `packages/client-core/src/lcu/serialQueue.ts` (new) | Promise-chain queue |
| `packages/client-core/src/lcu/gameFlowTracker.ts` (new) | Pipeline + reducers (§3.2.2–3.2.3). Emits `party:changed`, `phase:edge` |
| `packages/client-core/src/state/store.ts` | + `party`, `gameContext`, `postGame` |
| `packages/client-core/src/state/listingMachine.ts` | Subscribe to `phase:edge` (G7). Seed with `refreshLcuState()` reading `gameflowSession` + `champSelectSession` |
| `apps/desktop/electron/lcu/transport.ts` | Subscribe to and route the 2 new events (exact URI match) |
| `apps/overwolf/src/modules/lcu/owWsConnector.ts` (new) | `overwolf.web.createWebSocket` connector: subscribe per event, `[0]` heartbeat, reconnect |
| `apps/overwolf/src/modules/lcu/eventBus.ts` | `WsEventBus` uses the new connector. Remove the spike gate. GEP stays as a fallback |
| `apps/overwolf/manifest.json` | Confirm the `Web` permission |
| `tools/lcu-standalone/wsdump.mjs` | Use it to capture real payloads for fixtures |

**Done when:** in the DebugView, joining, leaving and changing role in a
real lobby updates `party` within 1 s on **both** hosts. Spamming queue
cancel produces exactly one `phase:edge` per real transition.

### Milestone M2: Listing ↔ party sync

| File | Change |
|---|---|
| migration `1765000000000-ListingParty.ts` | `listings.party jsonb default '{}'`. `ListingSlot.closedReason` lives inside JSONB, so no DDL |
| `apps/api/src/modules/lobby/dto/listing.dto.ts` | `ReconcilePartyDto` (class-validator, members ≤ 5 (≤ 8 for custom), roles enum) |
| `listings.controller.ts` / `listings.service.ts` | `PATCH /listings/:id/party` → `reconcileParty()` (§3.2.4 steps 1–7). Remove the old `freeSeats` reconcile after one release |
| `join.service.ts` | `confirmLobbyFromParty(listing, memberAccountIds)`, the server-side LOBBY_CONFIRMED |
| `board.service.ts` / `ListingSummary` | Include the `party` strip (role-only for non-users) |
| `client-core/src/api/session.ts` | `reconcileListingParty()` |
| `client-core/src/state/listingMachine.ts` | Replace `maybeReconcileSlots` with the party reconcile |
| `client-core/src/ui/BoardView.tsx`, `LobbyViews.tsx` | Party strip, open roles, "queue changed, republish?" banner |
| `sync/syncAgent.ts` | Keep `startLobbyWatch*` as a fallback behind flag `clientLobbyWatch` |

**Done when:** a friend joins and takes the slot's role, and the listing
slot closes on the board for a second viewer within 3 s. The friend leaves,
and the slot reopens. Switching from Flex to Solo delists with
`QUEUE_CHANGED`.

### Milestone M3: End-of-game loop

| File | Change |
|---|---|
| migration `1770000000000-GameLifecycle.ts` | `game_reports`. `endorsements.game_id` + unique index. `sessions.riot_verified_game_ids bigint[]` |
| `shared-types/src/socket-events.ts` | `GAME_STARTED`, `GAME_ENDED`, `POSTGAME_READY` + payload types. `PresenceHeartbeatPayload += partyId, gameId` |
| `apps/api/src/modules/game/` (new module) | `game-lifecycle.service.ts`, `postgame.processor.ts` (BullMQ, delayed + backoff, Redis fetch lock), `game.module.ts` |
| `realtime/sync.gateway.ts` | Handlers for `GAME_STARTED` / `GAME_ENDED`. Fix the `SESSION_END` payload contract |
| `session/session.service.ts` | `onSessionEnd`: stop emitting ENDORSE_PROMPT. New `onGameEnded(session, gameId)` for gamesPlayed (replaces the Redis debounce with gameId idempotency) |
| `profile/profile.service.ts` | `FRESHNESS_MS.game_ended`: route through the postgame job, not an immediate refresh |
| `profile/profile-refresh.service.ts` | `refresh(accountId, {mustIncludeMatchId?})`. If set and the match list lacks it, throw a retryable error |
| `reputation/reputation.service.ts` | Eligibility via `riot_verified_game_ids`. Per-game endorsements. Day-capped counting |
| `client-core/src/lcu/gameFlowTracker.ts` | GameContext persistence. `game.started`/`game.ended` edges. EOG gameId fallback. Deferred launcher termination |
| `client-core/src/state/listingMachine.ts` | `SESSION_END {listingId, observedPhase, final}`. POST_SESSION sends the final end on Lobby/None (G1) |
| `client-core/src/ui/PostGameView.tsx` (new) + `App.tsx` route | §3.3.5 |
| `apps/overwolf/src/windows/background/main.ts`, `apps/desktop/electron/main.ts` | Focus/show the window on the EndOfGame edge, once per gameId, behind setting `openOnGameEnd` |

**Done when** (two real accounts, a LOBLY duo in Flex):
- Both clients send `game.ended` with the same gameId exactly once.
- Within about 5 min both get `POSTGAME_READY` with `riotConfirmed: true`.
- The new match appears in match history, and LP/rank is updated.
- Each can endorse the other. A third account cannot endorse
  (`NOT_SESSION_MEMBER`). A replayed endorse is a no-op.
- For a solo game (no session), the profile still refreshes and there is no
  endorse block.

### 4.1 Tests

- **Unit (`shared-types`):** `isLegalTransition` table tests, including
  flapping sequences (Lobby↔Matchmaking ×10, Reconnect path,
  TerminatedInError→Lobby).
- **Unit (`client-core`):** reducers fed with **recorded** LCU payloads
  captured by `wsdump.mjs`, saved as `__fixtures__/lcu/*.json`. Cases:
  role-change in lobby, member leave, positional vs ARAM, champ-select
  with strangers (assert no non-party cell leaks into `PartyState`), and
  gameId capture at GameStart vs EOG fallback.
- **Unit (`api`):** `reconcileParty` slot close/reopen rules (reopen only
  `FILLED_IN_CLIENT`), queue drift, authorization (caller not in members →
  403). Postgame processor: 404→retry, 200→refresh+verify, team mismatch →
  no endorse, final failure → plain refresh. Endorse per-game uniqueness
  and day-capped counting. Extend `eligibility.spec.ts` / `reliability.spec.ts`
  in the existing style.
- **E2E (manual, two accounts),** as in M2/M3 "Done when". Log each run in a
  new `apps/overwolf/SPIKE_RESULTS.md` row, including the first live
  Overwolf `createWebSocket` result.

### 4.2 Rollout and flags (`config/flags.service.ts`)

| Flag | Default | Purpose |
|---|---|---|
| `partySync` | on (M2) | Client sends the party reconcile. Off = old `freeSeats` reconcile |
| `owLcuWebSocket` | on (M1) | Overwolf uses `createWebSocket`. Off = GEP+REST. *As built in M1 this is a local kill switch (`localStorage["lobly.owLcuWs"] = "off"`), not yet a server flag* |
| `postgameLoop` | on (M3) | `game.ended` + delayed Riot refresh |
| `openOnGameEnd` | user setting, on | Focus LOBLY on EndOfGame |
| `organicEndorse` | **off** | §3.3.3 organic parties |
| `clientLobbyWatch` | on → off after M2 is stable | Legacy 3 s polling |

### 4.3 Risks and open questions

1. **The Overwolf `createWebSocket` API surface.** Mobalytics uses it
   through `owPromisify(overwolf.web.createWebSocket)` with
   `{credentials, port, protocols, secured}`. Check this against the current
   Overwolf docs and LOBLY's minimum Overwolf version before relying on it.
   Mobalytics needs `minimum-overwolf-version 0.251.2.1`. *Still unconfirmed
   for LOBLY: LOBLY has never run inside Overwolf (handoff §1).*
2. **Match-v5 latency** varies by region. `me1` routes through `europe`. If
   16 min is not enough often, add one more delayed run at 30 min.
3. **Lobby member identity fields.** `/lol-lobby/v2/lobby` members carry
   `puuid` (LCU-local), `summonerId`, `gameName`, `tagLine`. The account
   mapping depends on `riot_accounts.lcu_puuid` being populated. It is set
   at link time today. Accounts linked before that migration need one
   re-link heartbeat. Use the presence heartbeat's `observedPuuid` to
   backfill.
4. **G1 is inferred from reading the code.** Reproduce it before changing
   behavior, so the fix is not built on a wrong premise.
5. **Clash / custom games.** These have different lobby shapes
   (`maxLobbySize` and team structure). M2 must not close slots for custom
   lobbies. `positional === false`, so it falls back to seat counting.

---

## Appendix A: Recovered Mobalytics references (for whoever builds this)

Paths are relative to the recovered source tree `moba-desktop-ow/src/lol/`.
That tree is regenerated from the shipped `source-map/background/background.js.map`.
None of it is copied into LOBLY. Only the patterns above are reused.

| Topic | File |
|---|---|
| LCU WS connector (Overwolf native WS, heartbeat, reconnect) | `../common/api/connectors/ow-websocket-connector/ow-websocket-connector.impl.ts` |
| WS message pipeline (queue, de-dup, validate, REST fallback) | `services/riot-lcu/lcu-rtd-service/lcu-rtd-service.impl.ts` |
| State seeding + reducers | `services/riot-lcu/lcu-state-service/lcu-state-service.impl.ts`, `utils/riot-lcu-data/lcu-data-handlers-utils/*` |
| Transition table | `utils/utils.ts` (`flowPhaseTransitionMap`, `isPhaseChanged`) |
| Post-game trigger + idempotency | `controllers/lol-post-game-controller/lol-post-game-controller.impl.ts` |
| "All inputs ready" latch | `storages/lol-lc-post-game-data-storage/lol-lc-post-game-data.storage.impl.ts` |
| Retry budgets (match 60×500 ms; EOG 100×1 s) | `api/requests/lc-api-requests-config.ts` |
| Window-on-phase-edge, once per game | `controllers/lol-window-controller/lol-window-controller.impl.ts` |
| Lockfile / cmdline credentials | `utils/lol-lcu-lockfile.ts` |
| LCU URIs + WS event names + QueueId table | `types/lcu-rtd.types.ts` |

## Appendix B: Gameflow edges LOBLY reacts to

```
None ─► Lobby ─► Matchmaking ─► ReadyCheck ─► ChampSelect ─► GameStart ─► InProgress
                      ▲   │             │            │                        │
                      └───┘(cancel)     └─(decline)──┘(dodge → Lobby/Matchmaking)
InProgress ─► WaitingForStats ─► PreEndOfGame ─► EndOfGame ─► Lobby | None
InProgress ─► TerminatedInError ─► Reconnect ─► InProgress | WaitingForStats

LOBLY hooks:
  Lobby/ChampSelect (any)        → party reconcile (debounced)
  ChampSelect (enter)            → listing PAUSED (exists)
  GameStart|InProgress (enter)   → freeze GameContext, game.started
  WaitingForStats|PreEoG|EoG (first) → game.ended (once per gameId)
  EndOfGame (enter)              → open Post-game screen (once per gameId)
  Lobby|None after EoG           → SESSION_END{final:true}; collapse post-game to banner
```
