# Phase 3 — End-to-End Join Flow, Chat, Reputation, Compliance, Launch

**Goal:** wire the Phase 1 client and Phase 2 backend into the complete MVP loop —
request → accept → automated League invite → confirmed shared lobby → session →
chat → endorsements — then harden it, pass compliance, and ship the public beta.

**Prerequisites:** Phases 1 and 2 complete and deployed. Read `00_BUILD_OVERVIEW.md`
§4 (C3, C4, C5, C8, C12), §6, §8.1, §9, §10. Two League test accounts on two
machines are **REQUIRED** for this phase (invite automation cannot be proven on
one client).

**Phase 3 does NOT include (do not build, do not stub beyond a TODO):** Clash
finder, custom games, communities, scheduled lobbies, reverse LFG feed,
champ-select insights, build import, leaderboards, public web profiles
(`lobly.gg/player/...`), RSO / Google / Discord OAuth login, Instant Join,
saved-search alerts, LOBLY Plus, second-screen overlay, Spectator-v5 verification,
duo streak tracker, Partners favorites list. See §Post-MVP backlog.

**Source of truth conflicts:** when this file and `00_BUILD_OVERVIEW.md` disagree,
this file wins. Product/architecture docs are reference only.

---

## Dual Host Architecture (C14) — built ahead of schedule, keep it this way

Partway through the client build, real-world testing surfaced C14 (`00_BUILD_
OVERVIEW.md` §4): Overwolf will not whitelist a League-targeting app without
Riot's blessing, and Riot's production key application "typically requires a
working prototype" — a bootstrapping loop. The resolution was to add a second,
fully independent client host, **`apps/desktop`** (plain Electron, no Overwolf
dependency at all), that proves out the entire LCU + backend loop on its own
and doubles as the compliance demo. Both hosts ship long-term — Overwolf's
developer terms are non-exclusive, so this is not a temporary detour.

This required extracting everything host-agnostic out of `apps/overwolf` into
**`packages/client-core`**: the listing state machine, the store, the sync
agent (socket.io client + invite/lobby-watch orchestration), the backend API
client, and the shared React UI (`ui/App.tsx` — the exact same board/listing/
requests/session/profile views run in both hosts, unmodified).

The seam is `packages/client-core/src/hostAdapter.ts`. Each host calls
`configureLoblyCore({ backendUrl, lcuTransport, eventBus, isDesktopHidden })`
exactly once at boot, before touching anything else from the package:

| Piece | Overwolf (`apps/overwolf`) | Electron (`apps/desktop`) |
|---|---|---|
| Credential discovery | GEP `lcu_info` feature, lockfile fallback via `overwolf.io` | Direct lockfile read / `LeagueClientUx.exe` CIM query (Node `fs`/`child_process`, ported from `tools/lcu-standalone`) |
| `LcuTransport.request()` | `fetch()` from `modules/lcu/request.ts` | Node `https.request` (`electron/lcu/transport.ts`) |
| `CoreEventBus` (phase/lobby push) | GEP-driven (`GepEventBus`); LCU WebSocket only as an optional spike-gated upgrade (C13 — browser `WebSocket` can't set the Basic-auth header) | Node `ws` client with the Authorization header set directly on the handshake — **C13 doesn't apply**, this is the primary and only channel |
| UI shell | `windows/{background,desktop,notifications}`, native Overwolf windows | Single `BrowserWindow` + `preload.ts` `contextBridge`, IPC-backed `window.lobly` |
| `isDesktopHidden()` | `overwolf.windows.getWindowState("desktop", ...)` | `mainWindow.isMinimized() \|\| !mainWindow.isVisible()` |

Rules when extending either host:
1. If new logic doesn't call a platform API (`overwolf.*` or Electron's
   `ipcMain`/`BrowserWindow`/Node built-ins), it belongs in `client-core`, not
   in either app.
2. New socket events, DTOs, or UI screens go into `client-core`'s `api/`,
   `state/`, or `ui/` — both hosts pick them up automatically.
3. `apps/desktop`'s renderer has no `spike` bridge methods (the Overwolf-only
   LCU Lab panel) — `LoblyBridge.spike` is optional and the shared `App.tsx`
   already guards its use; don't make it required.
4. Regression check after touching `client-core`: `npm run ow:build` (Vite)
   AND `npx tsc --noEmit` inside `apps/overwolf` (Vite's esbuild transpile
   does **not** catch all type errors — this repo already had one latent
   const-enum bug that only `tsc` caught), plus `npm run desktop:build` for
   the Electron host.

---

## Milestone 0 — Shared contracts before feature work

Do this first so client and server stay in lockstep.

### 0.1 NestJS modules to add under `apps/api/src/modules/`

| Module | Owns |
|---|---|
| `session` | `sessions` table, lobby confirmation, queue/session lifecycle, chat window TTL |
| `chat` | `chat_messages`, socket room auth, send/history, retention job |
| `reputation` | endorsements, reliability_events, score compute, blocks, reports, admin |
| `join` | join-request accept/decline/invite-result/timeout orchestration (may live inside `lobby` if you prefer one module — keep one clear owner) |

Phase 2 modules stay; extend `lobby` (join accept path, slot lock), `profile`
(reputation fields on card), `realtime` (new events + rooms), `config` (flags +
LCU endpoints already started in Phase 2).

### 0.2 Schema migrations (TypeORM — write these tables exactly)

Extend `users` (Phase 2 table):

```sql
ALTER TABLE users ADD COLUMN banned boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN listing_banned_until timestamptz;
```

New tables:

```sql
sessions(
  id uuid PK default gen_random_uuid(),
  listing_id uuid FK -> listings NOT NULL,
  member_account_ids uuid[] NOT NULL,          -- creator first, then joiners
  league_lobby_confirmed_at timestamptz,
  started_queue_at timestamptz,
  games_played int NOT NULL default 0,
  ended_at timestamptz,
  chat_open_until timestamptz,                 -- set on final session end = ended_at + 10 min
  created_at timestamptz default now()
)

endorsements(
  session_id uuid FK -> sessions NOT NULL,
  from_account_id uuid FK -> riot_accounts NOT NULL,
  to_account_id uuid FK -> riot_accounts NOT NULL,
  kind text NOT NULL,                          -- GOOD_COMMS | GOOD_TEAMMATE | SKILLED
  created_at timestamptz default now(),
  PRIMARY KEY (session_id, from_account_id, to_account_id, kind)
)

reliability_events(
  id bigserial PK,
  account_id uuid FK -> riot_accounts NOT NULL,
  session_id uuid FK -> sessions,
  join_request_id uuid FK -> join_requests,
  kind text NOT NULL,        -- ACCEPTED | SHOWED | NO_SHOW | ABANDONED | COMPLETED
  at timestamptz default now()
)

blocks(
  blocker_account_id uuid FK -> riot_accounts NOT NULL,
  blocked_account_id uuid FK -> riot_accounts NOT NULL,
  created_at timestamptz default now(),
  PRIMARY KEY (blocker_account_id, blocked_account_id)
)

reports(
  id uuid PK default gen_random_uuid(),
  reporter_account_id uuid FK -> riot_accounts,
  reported_account_id uuid FK -> riot_accounts NOT NULL,
  session_id uuid FK -> sessions,
  reason text NOT NULL,                        -- HARASSMENT | SLURS | BAIT_JOIN | OTHER
  detail text,
  status text NOT NULL default 'OPEN',         -- OPEN | RESOLVED | DISMISSED
  admin_action text,                           -- WARN | LISTING_BAN_7D | ACCOUNT_BAN
  created_at timestamptz default now(),
  resolved_at timestamptz
)

chat_messages(
  id bigserial PK,
  session_id uuid FK -> sessions NOT NULL,
  from_account_id uuid FK -> riot_accounts NOT NULL,
  body text NOT NULL,
  created_at timestamptz default now()
)

metrics_events(
  id bigserial PK,
  name text NOT NULL,                          -- listing_published | join_requested | ...
  account_id uuid,
  listing_id uuid,
  session_id uuid,
  join_request_id uuid,
  meta jsonb NOT NULL default '{}',
  at timestamptz default now()
)
```

Indexes: `reliability_events(account_id, at)`, `chat_messages(session_id, created_at)`,
`blocks(blocked_account_id)`, `reports(status, created_at)`,
`metrics_events(name, at)`, `sessions(listing_id)`.

### 0.3 Filter engine upgrades (complete Phase 2 placeholders)

In `evaluateEligibility` (Phase 2 §4.2), replace the blocks placeholder and add:

8. **Blocks** — if either direction exists in `blocks` for the two riot accounts →
   ineligible, reason `"BLOCKED"`.
9. **Reliability floor** — if listing.filters has `minReliability` (0–100) and the
   requester has a numeric score (not "New"), require `score >= minReliability`.
   Accounts with zero reliability events **pass** (provisional) and carry
   `provisional: true` on the board row.
10. **Provisional badge** (not a hard block): set `provisional: true` when
    `summoner_level < 30` OR `games_this_season === 0` OR zero reliability events.
    Surface on board row + join-request card. Instant Join does not exist in MVP —
    badge only.

### 0.4 `packages/shared-types` — finish socket events and DTOs

`socket-events.ts` must export exact string constants (client and server import
these; never redeclare):

```ts
// Client → server
export const C2S = {
  PRESENCE_HEARTBEAT: "presence.heartbeat",
  LISTING_PUBLISH: "listing.publish",
  LISTING_PAUSE: "listing.pause",
  LISTING_RELIST: "listing.relist",
  LISTING_DELIST: "listing.delist",
  LISTING_READY: "listing.ready",
  LISTING_REOPEN: "listing.reopen",
  LOBBY_CONFIRMED: "lobby.confirmed",
  MEMBER_LEFT: "member.left",
  SESSION_START: "session.start",
  SESSION_END: "session.end",
  CHAT_SEND: "chat.send",
  STATE_RECONCILE: "state.reconcile",
} as const;

// Server → client
export const S2C = {
  BOARD_DELTA: "board.delta",
  LISTING_STATE: "listing.state",
  JOIN_REQUESTED: "join.requested",
  JOIN_ACCEPTED: "join.accepted",
  JOIN_DECLINED: "join.declined",
  JOIN_FAILED: "join.failed",
  JOIN_REOPENED: "join.reopened",
  SESSION_ACTIVE: "session.active",
  CHAT_MESSAGE: "chat.message",
  ENDORSE_PROMPT: "endorse.prompt",
} as const;
```

Also add types: `JoinRequestCard`, `SessionSummary`, `ReliabilityScore`,
`ChatMessage`, `EndorseKind`, `ReportReason`. Profile card response gains
`endorsements: { goodComms, goodTeammate, skilled }`, `reliability: number | null`
(`null` → client shows `"New"`), `provisional: boolean`.

**Milestone 0 acceptance:** migrations apply clean on Railway + local docker;
shared-types compile from both `apps/api` and `apps/overwolf`; filter unit tests
cover blocks both directions + minReliability + provisional badge cases.

---

## Milestone 1 — The join flow protocol (the product's heart)

### 1.1 REST endpoints (join orchestration)

| Method | Path | Body → Notes |
|---|---|---|
| POST | `/v1/listings/:id/join` | `{roleSlot?, idempotency via header}` → `{joinRequestId, matchScore, offRole}` or 403 `{reasons[]}` |
| POST | `/v1/join-requests/:id/accept` | creator only → `{ok, expiresAt}` (90s window starts) |
| POST | `/v1/join-requests/:id/decline` | creator only → `{ok}` |
| POST | `/v1/join-requests/:id/invite-result` | creator client reports LCU invite: `{ok, error?}` |
| POST | `/v1/join-requests/:id/cancel` | requester cancels PENDING → `{ok}` |
| GET | `/v1/listings/:id/requests` | creator: pending (+ recent decided) for My Listing panel |

Auth: JWT. All eligibility recomputed server-side on join — never trust a cached
board row.

### 1.2 The protocol, step by step

Actors: **B** = requester, **A** = creator, **S** = server. Message names from
`packages/shared-types/socket-events.ts`. Implement in this exact order.

1. **B requests.** `POST /v1/listings/:id/join {roleSlot}`.
   S re-runs `evaluateEligibility` (including blocks + reliability). Checks:
   - listing status `LISTED` (or `FILLING` with that slot still open),
   - no block either direction,
   - ≤1 `PENDING` request per requester per listing,
   - ≤10 join requests per requester per hour (Redis counter),
   - user not `banned` and not inside `listing_banned_until`,
   - platform not `kr` (C4).
   Creates `join_requests` (`PENDING`), stores `match_score` / `off_role`, logs
   `metrics_events(join_requested)`, emits **`join.requested`** to A:
   `{joinRequestId, card, matchScore, offRole, roleSlot}`.
   *Client A:* notifications toast (name, rank, role, score) with Accept / Decline /
   View; desktop Requests panel lists pending.
   *Failure:* ineligible → 403 with `reasons[]`; B's UI shows them verbatim.

2. **A decides.** Before emitting the card in step 1, S already ran
   `ensureFresh(requester, 'join-open')` (interactive priority, C5). A calls
   `POST /v1/join-requests/:id/accept` or `/decline`.
   On **accept**, single DB transaction:
   - request → `ACCEPTED`, `decided_at = now()`,
   - listing → `FILLING`,
   - lock slot in `slots` jsonb: `{role, open:false, pendingAccountId}`,
   - other PENDING requests for **that same slot** stay PENDING (they expire when
     the slot fills / timeout path),
   - `reliability_events(B, ACCEPTED)`,
   - metrics `join_accepted`,
   - emit **`join.accepted`**:
     - to A: `{joinRequestId, invitee: {summonerId, riotId, tagLine, accountId}}`,
     - to B: `{joinRequestId, listingId, creator: {riotId, tagLine, summonerId}, autoAcceptEligible: true}`,
   - enqueue BullMQ delayed job `join.timeout(joinRequestId)` for **90 seconds**.
   On **decline:** request → `DECLINED`, emit `join.declined` to B with
   `{joinRequestId}` only — **no reason text** (harassment vector).

3. **A's client fires the League invite.** On `join.accepted`, A's **background**
   window (not desktop) runs:
   ```ts
   await lcuRequest("sendInvite", { body: [{ toSummonerId: invitee.summonerId }] });
   ```
   Then `POST /v1/join-requests/:id/invite-result {ok, error?}`.
   Check `/config/flags.inviteAutomation` first (Milestone 4); if false, skip LCU
   write and show manual fallback only.
   *Failure (LCU error / lobby gone):* S reopens slot, request → `EXPIRED`, emits
   `join.reopened` to A and `join.failed` to B.
   *Always visible on A's UI (C3):* invitee Riot ID + copy button + "Invite
   manually in the League client" — permanent fallback, not only an error path.

4. **B accepts the League invite.** On `join.accepted`, if user pref
   `autoAcceptLoblyInvites === true` (default **OFF**, visible toggle on Profile)
   AND `/config/flags.autoAccept` is true:
   - watch received invitations via GEP `lobby_info` / phase signals,
   - also re-read `lcuRequest("receivedInvitations")` on a **5s interval for max
     90s** (bounded polling OK here),
   - find invite where `fromSummonerId === creator.summonerId`,
   - `lcuRequest("acceptInvitation", { params: { invitationId } })`.
   If toggle OFF: toast "Accept the League invite from \<creator\>!" and the
   standard League UI handles it.

5. **Confirmation.** When A's client sees B's `summonerId` in
   `lcuRequest("lobbyMembers")`, emit **`lobby.confirmed {joinRequestId}`**.
   S (idempotent):
   - cancel `join.timeout` job,
   - request → `COMPLETED`,
   - create/update `sessions` (`league_lobby_confirmed_at = now()`, members =
     creator + B),
   - listing → `READY` if no open slots remain, else stay `FILLING`,
   - `reliability_events(B, SHOWED)` once,
   - metrics `lobby_confirmed`,
   - emit **`session.active {sessionId, memberAccountIds, chatOpen: true}`** to
     all members.
   *Defense in depth:* B also emits `lobby.confirmed` when it sees itself in the
   lobby; S accepts first, ignores duplicates (no double SHOWED).

6. **Timeout.** If `join.timeout` fires before confirmation: request → `NO_SHOW`,
   `reliability_events(B, NO_SHOW)`, reopen slot, listing → `LISTED` if no other
   fills in progress, `board.delta` upsert, `join.reopened` to A, toast to B
   ("Invite expired"), metrics `no_show`.

7. **Session runs.** Creator queues; Phase 1 client machine drives
   `session.start` on Matchmaking/ChampSelect → S sets `started_queue_at`,
   listing → `IN_SESSION`.
   Game ends → clients send `session.end {observedPhase}` → S:
   - `games_played += 1` with **5-minute debounce** per session (idempotent),
   - enqueue `profile.refresh` background for all member accounts (C5
     event-driven ingestion),
   - set `chat_open_until = now() + 10min` **only on final session end**
     (member left / listing delisted / user done) — not between back-to-back
     games,
   - on final end: `reliability_events(COMPLETED)` for members still present,
     emit `endorse.prompt`, metrics `session_completed` (+ `repeat_pair` if this
     pair has a prior COMPLETED session).
   "Queue Again" keeps `sessions` open and relists per Phase 1 machine.
   *Abandon:* A sees member vanish from `lobbyMembers` while status READY (before
   queue) → emit `member.left {accountId}` → S: `ABANDONED`, reopen slot,
   listing back toward `LISTED`/`FILLING`.

### 1.3 Client work (replace Phase 1 simulate HUD)

Wire real socket handlers; remove simulate buttons from the happy path (keep LCU
Lab behind a `DEBUG` flag).

Desktop window — plain React / Radix only (overview §3):

| View | Contents |
|---|---|
| **Board** | filtered list, Match Score sort default, provisional / off-role badges, Request to Join |
| **My Listing** | create form auto-filled from LCU (queueId, party size read-only); title, filters, duration editable; live status + open slots |
| **Requests** | pending cards with Accept/Decline + full verified card |
| **Session** | active session, chat dock, Queue Again / Done |
| **Profile** | own card, prefs, linked accounts, **auto-accept LOBLY invites** toggle (default off) |

Create-listing defaults: title `` `${rank} ${role} looking for ${openRole}` ``;
duration 30; rank filter ±1 tier from viewer; languages from prefs.

Notifications toast types: `join.requested`, `join.accepted` (B), `join.failed`,
`join.reopened`, `session.active`, `endorse.prompt`.

**Milestone 1 acceptance (golden path, two machines):**
B requests → A toasts within 2s → A accepts → B's League client shows the invite
within 3s → (auto-accept ON) B lands in A's lobby hands-free → both apps show
`session.active` / READY → A kills lobby → abandon/reopen events correct.
Then run the failure matrix in §4.1.

---

## Milestone 2 — Session chat

### 2.1 Rules

- Socket rooms `session:<id>`; join allowed only if
  `accountId ∈ sessions.member_account_ids` (re-check on every send).
- Chat window: from `join.accepted` (pre-lobby coordination — manual invite path
  needs chat) until `chat_open_until` (or session cancelled with no confirm).
- Rate limit: 5 messages / 5s / user (Redis). Body ≤ 500 chars.
- Profanity: same wordlist as listing titles — **replace**, don't reject.
- Retention: BullMQ daily job deletes `chat_messages` where
  `created_at < now() - 7 days`. Test with `CHAT_TTL_HOURS` env override.

### 2.2 API + events

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/sessions/:id/messages` | last 100, member-only; backfill on reopen |
| GET | `/v1/sessions/:id` | summary for session view |

Socket: `chat.send {sessionId, body}` → persist → broadcast
`chat.message {id, from, body, at}` to `session:<id>`.

Also enforce blocks: if either member blocked the other after accept (edge),
reject send with a clear error.

### 2.3 Client

Chat panel docks in the desktop Session view. Unread badge → notifications toast
**only** when desktop is minimized
(`overwolf.windows.getWindowState`).

**Acceptance:** two clients chat pre-invite and post-game; rate limit + filter
verified; shortened TTL job purges messages.

---

## Milestone 3 — Reputation: endorsements, reliability, blocks, reports

### 3.1 Endorsements

- Trigger: final `session.end` (when `chat_open_until` is set) → emit
  `endorse.prompt {sessionId, others: [{accountId, riotId, tagLine}]}` to each
  member.
- `POST /v1/sessions/:id/endorse`
  `{toAccountId, kinds: ("GOOD_COMMS"|"GOOD_TEAMMATE"|"SKILLED")[]}`.
  Validation: both session members, not self, `ended_at` within 24h, PK blocks
  duplicates. No un-endorse in MVP.
- Profile + board card show lifetime counts per kind.

### 3.2 Reliability score (server-computed only)

```
score = 100
      - 15 * NO_SHOW(90d)
      - 20 * ABANDONED(90d)
      +  1 * SHOWED(90d)      // bonus capped +10
      +  2 * COMPLETED(90d)   // bonus capped +10
clamp to [0, 100]
```

Zero events → expose `reliability: null` (UI: `"New"`). Compute on read; cache
`rep:<accountId>` in Redis 15 min; invalidate on new `reliability_events`.

Listing filter `minReliability` uses this score (Milestone 0.3).

### 3.3 Blocks and reports

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/blocks` | `{accountId}` (riot_account id) |
| DELETE | `/v1/blocks/:accountId` | |
| GET | `/v1/blocks` | my block list |
| POST | `/v1/reports` | `{accountId, sessionId?, reason, detail?}` — 10/day/user |
| GET | `/v1/admin/reports?status=OPEN` | header `X-Admin-Token: $ADMIN_TOKEN` |
| PATCH | `/v1/admin/reports/:id` | `{status, action?}` |

Enforcement (all server-side): board query both directions, join create, chat send.

Admin actions:
- `WARN` — log + optional email stub,
- `LISTING_BAN_7D` — set `users.listing_banned_until = now()+7d`; enforce on
  listing create + join request with clear 403,
- `ACCOUNT_BAN` — `users.banned = true`; `JwtAuthGuard` rejects.

**Acceptance:** endorse after a real ARAM; no-show drops B by 15 on the board;
blocked pairs mutually invisible (board + join + chat); report → admin → 7-day
listing ban blocks publish with a clear client message.

---

## Milestone 4 — Hardening

Do all of these; each is small.

1. **Remote LCU endpoint config (C3):** `GET /config/lcu-endpoints` serves
   `packages/lcu-endpoints/endpoints.json` + `version`. Client checks at boot and
   every 6h; higher remote version → replace local + `localStorage`. Bumping
   version on the server is the League-patch hotfix path.

2. **Kill switches:** `GET /config/flags` →
   ```json
   {
     "inviteAutomation": true,
     "autoAccept": true,
     "board": true,
     "allowedPlatforms": ["euw1"]
   }
   ```
   Cache client-side 5 min. Every automated LCU **write** checks its flag; OFF →
   manual fallback UI only. Emergency brake if Riot objects (architecture risk
   table).

3. **Reconciliation:** on socket reconnect, client emits
   `state.reconcile {listingStatus, phase, listingId?}`; server replies
   `listing.state` authoritative; client adopts. Cover: laptop sleep, backend
   deploy, Overwolf restart mid-session.

4. **Idempotency:** `POST /v1/listings` and `POST /v1/listings/:id/join` accept
   `Idempotency-Key` header (Redis SETNX, 10-min TTL) — sync agent retry buffer
   can double-send.

5. **Telemetry** (`00` §10 metrics): write structured rows to `metrics_events`
   for `listing_published`, `join_requested`, `join_accepted`, `lobby_confirmed`,
   `no_show`, `session_completed`, `repeat_pair`.
   `GET /v1/admin/metrics/funnel?day=` (admin token) returns median
   time-to-full-lobby, fill rate, no-show rate, repeat-partner rate.

6. **Error surfaces:** every LCU failure path shows a human message + manual
   fallback — never silent. Grep client `catch` blocks that only log; each must
   set a store-visible status.

7. **Performance:** background window mounts **no React UI** (controller only);
   board renders throttled to ≤1/s; desktop ≤ 200MB RAM with 50 listings
   (Overwolf QA cares — architecture risk table).

### 4.1 Failure test matrix (run before submission, two machines)

| # | Scenario | Expected |
|---|---|---|
| 1 | B requests, A ignores 90s | request stays PENDING (timer starts at accept, not request) |
| 2 | A accepts, B never accepts invite | NO_SHOW at 90s, slot reopens, B score −15 |
| 3 | A accepts, A's League lobby already closed | invite-result error → slot reopens, `join.failed` to B |
| 4 | A accepts, B declines the League invite | falls under #2 (no League decline signal consumed) |
| 5 | B accepts manually, auto-accept OFF | confirmation via lobbyMembers still works |
| 6 | A enters champ select with request PENDING | listing PAUSED, board delta, pending auto-declined / reopen notice |
| 7 | Network drop on A during FILLING | heartbeat lapse → server pauses at 90s; reconnect reconciles |
| 8 | Both clients emit `lobby.confirmed` | one session row, one SHOWED event |
| 9 | B blocked by A requests | 403; listing never visible to B on board |
| 10 | Simulate broken path in remote `endpoints.json` | manual invite UI, no crash; fixing remote config heals without OPK update |
| 11 | KR platform link/list/join | 403 `REGION_NOT_SUPPORTED` at each gate (C4) |
| 12 | Double-submit join with same Idempotency-Key | one join_request row |

**Milestone 4 acceptance:** matrix green on deployed Railway + production-shaped
client build; funnel endpoint returns numbers from the test runs.

---

## Milestone 5 — Compliance and launch (`00` §10 — order matters)

### 5.1 `apps/web` (Next.js, static export OK)

Scaffold `apps/web/` in the monorepo workspace:

```
apps/web/
├─ package.json
├─ next.config.ts          # static export or Node host on Railway
├─ app/
│  ├─ page.tsx             # landing
│  ├─ terms/page.tsx
│  └─ privacy/page.tsx
└─ public/
```

Landing: product one-liner + Overwolf install CTA (store URL when live). **No**
public player profiles in MVP.

**Privacy policy must inventory PII:** email, PUUID, Riot ID, match-derived stats,
chat contents (7-day), endorsements, reports. State: no real names stored;
Discord tags only with user prefs; contact for deletion. Host on an owned domain
(e.g. `lobly.gg`) — **required before** the Riot production key application (C5).

### 5.2 GDPR deletion

`DELETE /v1/users/me`:
- cascade/delete: riot_accounts, snapshots, champion_stats, matches_seen, prefs,
  listings, join_requests, chat_messages, sessions membership handling,
  blocks,
- endorsements: anonymize `from_account_id` (or delete rows where user is from),
- reports: keep row for moderation integrity, null `reporter_account_id`,
- invalidate all refresh tokens.

Document the endpoint in the privacy policy. Integration-test it.

### 5.3 Riot production API key

Apply on the developer portal with: live website (ToS + privacy), product
description, screenshots of the working two-client prototype. Emphasize:
server-side key custody, event-driven match ingestion, no scraping, no
queue-dodge / opponent intel. Expect iteration; **gate public beta until granted**
(C5). Dev key is for test accounts only.

### 5.4 Riot LCU usage notification

Submit **exactly** the endpoint list from `00` §8.1 — nothing more. State:
- invite automation is user-initiated (one invite per explicit Accept),
- auto-accept is opt-in per user (default off),
- KR is region-gated at link, listing, and join.

Re-verify KR rejection with a forced test payload before filing.

### 5.5 Overwolf OPK submission (C6, C12)

1. Remove the manifest `developer` block used for unpacked loading.
2. Final icons: 256×256 color + gray, ico set per Phase 1 paths.
3. Store listing copy + screenshots (board, join toast, verified card).
4. Build OPK = zip of `apps/overwolf/dist` renamed `.opk`.
5. VirusTotal clean — no third-party binaries, no `extra-objects` native plugins.
6. Submit via Overwolf dev console; answer QA. Known review focus: no
   queue-dodge features, not background-only, performance.

### 5.6 Launch gating

- Single-server launch first: EUW (`allowedPlatforms: ["euw1"]` in flags).
- Seed supply via community partnerships (outside code scope — architecture cold
  start risk).
- Flip `board: true` for the waitlist cohort only after production Riot key is
  live.

**Phase 3 / MVP exit criteria (all must pass):**
1. Golden path + full failure matrix green on production infra with the
   **production** Riot key.
2. Compliance items 5.1–5.5 submitted; Overwolf QA + Riot prod key approved (or
   explicitly waitlisted with install gated).
3. Metrics funnel endpoint reporting real numbers from dogfood.
4. A stranger can install from the Overwolf store, register, link, publish, and
   sit in a full League lobby in under 3 minutes median (product success metric).

---

## Client ↔ server event cheat sheet (Phase 3 additions)

| Direction | Event | Payload (minimal) |
|---|---|---|
| C→S | `lobby.confirmed` | `{joinRequestId}` |
| C→S | `member.left` | `{accountId}` |
| C→S | `chat.send` | `{sessionId, body}` |
| C→S | `state.reconcile` | `{listingStatus, phase, listingId?}` |
| S→C | `join.requested` | `{joinRequestId, card, matchScore, offRole, roleSlot}` |
| S→C | `join.accepted` | A: `{joinRequestId, invitee}` / B: `{joinRequestId, listingId, creator, autoAcceptEligible}` |
| S→C | `join.declined` | `{joinRequestId}` |
| S→C | `join.failed` | `{joinRequestId, code}` |
| S→C | `join.reopened` | `{listingId, joinRequestId?}` |
| S→C | `session.active` | `{sessionId, memberAccountIds}` |
| S→C | `chat.message` | `{id, sessionId, from, body, at}` |
| S→C | `endorse.prompt` | `{sessionId, others[]}` |

Phase 2 events (`presence.heartbeat`, `listing.*`, `board.delta`, `listing.state`,
`session.start`, `session.end`) remain unchanged.

---

## Deliverables checklist

- [ ] Migrations: sessions, endorsements, reliability_events, blocks, reports,
      chat_messages, metrics_events; users.banned / listing_banned_until
- [ ] Join protocol + 90s timeout job + invite-result path
- [ ] Client: Board / My Listing / Requests / Session / Profile (auto-accept toggle)
- [ ] Notifications wired to real S2C events
- [ ] Session chat + 7-day retention job
- [ ] Endorsements + reliability score + board/filter integration
- [ ] Blocks + reports + admin token surface
- [ ] Remote LCU endpoints + kill-switch flags + reconciliation + idempotency
- [ ] Telemetry funnel admin endpoint
- [ ] Failure matrix documented green
- [ ] `apps/web` live on owned domain (landing, ToS, privacy)
- [ ] `DELETE /v1/users/me` tested
- [ ] Riot production key applied; LCU notification filed with §8.1 list
- [ ] OPK submitted; VirusTotal clean
- [ ] Launch flags: EUW-first `allowedPlatforms`

---

## Post-MVP backlog (do NOT build now)

Clash finder, communities, scheduled lobbies, reverse LFG feed, champ-select
insights, build import, leaderboards, public web profiles, RSO OAuth login,
Google/Discord OAuth (`lobly://` already in manifest for later), saved-search
alerts, Instant Join, LOBLY Plus subscription, second-screen window,
Spectator-v5 session verification, Partners list, duo streak tracker, Discord
invite reveal in session.
