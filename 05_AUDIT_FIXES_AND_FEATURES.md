# 05 — Full Audit: Bugs, Broken Flows, Missing Features

**Written:** 2026-10-15, against branch `m1-gameflow-tracker` (commit `8bbc76f`).
**Audience:** the agent that will implement these changes. Every item says
what is wrong, where it is, what to change, and how to know it's done.
**Method:** I read the whole API (`apps/api/src`), `packages/client-core`,
`packages/shared-types`, and both hosts (`apps/desktop`, `apps/overwolf`).
Every finding comes from reading code. **None was reproduced at runtime.**
Before fixing an item marked *(verify)*, reproduce it first.

Related docs, which you must not duplicate:
- `04_LOBBY_SYNC_AND_POSTGAME.md`. M1 is already built. **M2** (party →
  listing sync) and **M3** (end-of-game refresh + endorsements) are still to
  do and are referenced below rather than re-specified.
- `SESSION_HANDOFF.md`. Read §2 (host seam rule) and §6 (past bugs) first.

---

## 0. Rules for the implementer

1. **Work in priority order: P0 → P1 → P2.** Within a priority, follow the
   order given. Some later items depend on earlier ones (noted inline).
2. Host-agnostic logic goes in `packages/client-core` / `packages/shared-types`.
   Hosts only get platform glue (handoff §2).
3. **Do not regress M1.** All phase handling goes through
   `gameFlowTracker` (`packages/client-core/src/lcu/gameFlowTracker.ts`).
   Never call `dispatchMachine({type:"PHASE"})` directly from a host.
4. Every API change needs:
   - a DTO with class-validator decorators, because the global
     `ValidationPipe` uses `forbidNonWhitelisted`;
   - a jest spec under `apps/api/src/**` in the same style as
     `eligibility.spec.ts`.
5. Every client-core logic change needs a jest spec under
   `packages/client-core/src/**`. Run it with
   `node ../../node_modules/jest/bin/jest.js` from `packages/client-core`.
6. Migrations go in new files `apps/api/src/database/migrations/<ts>-<Name>.ts`.
   Use timestamps greater than `1760000000000`. Never edit an old migration.
7. Verify by running these, in this shell, with node directly (`npm run`
   cannot find `node` from cmd.exe here):
   - `node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json`
   - `... -p apps/overwolf/tsconfig.json`
   - `--noEmit -p apps/api/tsconfig.json`
   - both jest suites
8. One commit per numbered item, or a small group of them. The message names
   the item ids, e.g. `P0-3, P0-4: socket auth`.

---

## P0 — Blocking: the product does not work correctly without these

### P0-1. Everyone shares one LOBLY account (hard-coded dev credentials)

**Where:**
- `apps/desktop/electron/main.ts`: the `DEV_EMAIL` / `DEV_PASSWORD`
  constants, used by `ensureSession(...)` at boot and in the
  `GET_AUTH_TOKEN` handler.
- `apps/overwolf/src/windows/background/main.ts`:
  `ensureSession("dev@lobly.local", "lobly-dev-password")`.
- `packages/client-core/src/api/session.ts`: `ensureSession` logs in, and
  **registers** if login fails.

**Effect:** every installed client logs in as the same `users` row. So:
- all Riot accounts link to that one user;
- `PUUID_TAKEN` never fires;
- `listings/mine` returns someone else's listing;
- `pendingRequests`, blocks and prefs are shared by everyone;
- `JOIN_REQUESTED` (sent to `user:<id>`) reaches every client.

The whole multi-user flow is broken outside a single-tester setup.

**Fix:** replace it with **"Sign in with your League client"** (P0-2). Keep
the email/password endpoints for admin and testing only.
- Remove the dev credentials from both hosts. Dev login must exist only
  when `LOBLY_DEV_AUTH=1` (Electron env) or the Overwolf build flag
  `import.meta.env.VITE_LOBLY_DEV_AUTH === "1"`.
- `ensureSession` must **never auto-register**. Delete the register
  fallback.

**Done when:** two different machines (or two Windows users) with different
League accounts get two different `users.id` rows. Each sees only its own
listing and requests.

### P0-2. Riot account "ownership" is not verified (anyone can claim any Riot ID)

**Where:** `apps/api/src/modules/identity/riot-accounts.service.ts` `link()`.
The comment claims the LCU proves ownership. But the endpoint is a plain
authenticated REST call, and any client can POST any `gameName#tagLine`. It
then gets that player's verified profile, rank and reputation, and can
publish listings as them.

**Fix: profile-icon challenge.** This is the interim solution. Riot Sign-On
(RSO) is the long-term one, so write the API so that RSO can replace the
challenge later.

1. **Migration `1770000000000-RiotAuth.ts`:**
   - `ALTER TABLE users ALTER COLUMN email DROP NOT NULL; ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`
     Keep the unique index. Postgres allows multiple NULLs.
   - Update `User` entity types to `string | null`, and fix `auth.service.ts`
     so login rejects users whose `passwordHash` is null.
2. **`POST /v1/auth/riot/challenge`** (`@Public`, throttled to 5/min).
   - Body: `{ gameName, tagLine, platform }`.
   - The server resolves the PUUID via `accountByRiotId` and reads the
     current icon via `summonerByPuuid`.
   - It picks a target icon from the always-owned starter icons **0–28**,
     different from the current one.
   - It stores
     `redis SETEX auth:riotchal:<challengeId> 600 {puuid, gameName, tagLine, platform, iconId, originalIconId}`.
   - Returns `{ challengeId, iconId, expiresAt }`.
3. **Client** (new `packages/client-core/src/auth/riotSignIn.ts`). It uses
   `getHostAdapter().lcuTransport`, so add endpoints to `lcu-endpoints`:
   - `setSummonerIcon: PUT /lol-summoner/v1/current-summoner/icon`, body
     `{profileIconId}`;
   - bump the map `version` to 3.

   Steps:
   1. Read `currentSummoner` (for `profileIconId`, `gameName`, `tagLine`)
      and `regionLocale`.
   2. Request the challenge.
   3. `PUT` the icon.
   4. Call verify.
   5. **Always** `PUT` the original icon back, in a `finally`.
4. **`POST /v1/auth/riot/verify`** (`@Public`).
   - Body: `{ challengeId, lcuPuuid?, summonerId? }`.
   - The server polls `summonerByPuuid` until `profileIconId === iconId`.
     Poll every 3 s for up to 60 s. If you prefer, return `202 {pending:true}`
     and let the client re-call. Either is fine; pick one and document it in
     the DTO.
   - On success:
     - find the `riot_accounts` row by `puuid`;
     - if none exists, create a `users` row (null email) and a
       `riot_accounts` row (`verifiedAt = now`, `lcuPuuid`, `summonerId`);
     - issue tokens for that row's `userId` (reuse `AuthService.issueTokens`
       by making it package-visible);
     - enqueue an interactive profile refresh;
     - delete the challenge key.
   - On timeout: `400 { code: "ICON_NOT_CHANGED" }`.
5. **`POST /v1/riot-accounts/link`** (adding a second Riot account to an
   already signed-in user) must now **require `challengeId`** and reuse the
   same verification. Remove trust in raw `gameName/tagLine`.
6. **Hosts:** at boot, if stored tokens exist, restore them (P0-3). If they
   don't, show the sign-in gate (P0-1/P2-1 UI) with a "Verify with League
   client" button. It is enabled only when `state.lcu.connected` and
   `state.summoner` are set.
   - If the user switches League accounts mid-run (`verifySummoner` detects a
     PUUID change), and that PUUID is not linked to the current user, show
     the gate again for the new account.

**Done when:**
- (a) Calling `/riot-accounts/link` with someone else's Riot ID and no
  challenge returns 400.
- (b) A full sign-in on a real client creates the user, sets and restores
  the icon, and lands on Profile.
- (c) jest covers challenge creation, the verify success, timeout and
  wrong-icon paths, and the "existing account → same userId" path. Mock
  `RiotService`.

### P0-3. Tokens: no persistence on Electron main, and the socket token expires after 15 minutes

**Where:**
- `packages/client-core/src/sync/syncAgent.ts` `connect()` passes
  `auth: { token: this.token }`, which is a **fixed string**.
- The access TTL is 15 min (`auth.service.ts` `ACCESS_TTL`). After any
  disconnect after 15 min, socket.io reconnects with the expired JWT. The
  gateway's `handleConnection` disconnects it as "bad jwt". `reconnection`
  then loops forever with the same token, so **all realtime (join requests,
  chat, board deltas) silently stops.**

**Fix:**
1. In `syncAgent.connect`, use the function form:
   `auth: (cb) => cb({ token: getAccessToken() ?? this.token })`.
2. On `connect_error`: if `err.message === "unauthorized"`, call a new
   exported `refreshAccessToken()` in `api/client.ts`. It wraps the existing
   private `tryRefresh` and returns a boolean. Then call `this.socket.connect()`.
   If the refresh fails, set a store flag `authExpired: true` so the UI
   shows the sign-in gate.
3. **Server** (`realtime/sync.gateway.ts`): move the JWT check from
   `handleConnection` into a namespace middleware in `afterInit`:
   `server.use((socket, next) => …)`. Call `next(new Error("unauthorized"))`
   on a bad token, so the client actually receives `connect_error` with that
   message. Keep the room joins in `handleConnection`. This also stops
   events being processed before `client.data.userId` is set.
4. **Electron:** `client.ts` stores tokens with `localStorage`, which on
   Electron main is the shim in `apps/desktop/electron/localStorageShim.ts`.
   Check that the shim persists to disk under `app.getPath("userData")`. If
   it does, wrap the value with `safeStorage.encryptString` /
   `decryptString` before writing. If it doesn't persist, make it.

**Done when:** in a unit test of `syncAgent` with a mocked `io`, an expired
token followed by `connect_error("unauthorized")` triggers a refresh and
one reconnect. Manually: leave the app open for over 15 min, restart the
API to force a reconnect, and join requests still arrive.

### P0-4. Dev socket tokens are accepted in production

**Where:** `sync.gateway.ts` `handleConnection`:
`if (token.startsWith("dev-")) userId = "dev:"+token`. Any client can
connect unauthenticated and receive broadcasts to board rooms. Clients also
fall back to `syncAgent.connect("dev-local")` when API auth fails.

**Fix:**
- Accept `dev-` tokens only when `process.env.LOBLY_ALLOW_DEV_SOCKET === "1"`.
- Remove the `syncAgent.connect("dev-local")` fallbacks in both hosts.
  Instead, show "Can't reach LOBLY servers" in the UI (P2-1) and retry
  `ensureSession` with backoff (5 s → 60 s).

### P0-5. Profile refresh stops working after the first run (BullMQ jobId dedupe)

**Where:** `apps/api/src/modules/profile/profile-jobs.service.ts`. Jobs use
the fixed `jobId: refresh:<priority>:<accountId>` with
`removeOnComplete: 100`.

BullMQ **ignores `add()` while a job with the same id exists**, and that
includes completed jobs kept in the last-100 set. After the first refresh,
later refreshes (`ensureFresh('game_ended' | 'publishing' | …)`, linking)
are silently dropped until 100 other jobs complete. So ranks, form and
match history go stale. *(verify: enqueue twice and check
`queue.getJobCounts()`)*

**Fix:**
- Keep the dedupe for *waiting* jobs only. Before adding, check
  `await queue.getJob(jobId)`. If it exists and its state is `completed` or
  `failed`, call `await job.remove()`. Then `add()`.
- Alternatively, use `removeOnComplete: true, removeOnFail: true`. That is
  simpler, and acceptable.
- Add a jest spec with a fake queue that asserts a second enqueue after
  completion results in a second job.

### P0-6. Nobody can join any listing: language/voice eligibility with no way to set prefs

**Where:**
- `packages/client-core/src/state/publishDraft.ts` defaults listing
  `languages: ["en"]` (`defaultDraft`, `draftToCreateBody`).
- `apps/api/src/modules/lobby/eligibility.ts` §5: if the listing has
  languages and the requester's `prefs.languages` doesn't overlap, the
  result is `LANGUAGE_MISMATCH`.
- Requesters have **no UI to set languages or voice**. `ProfileView` only
  edits `autoAcceptLoblyInvites`. So `prefs.languages` is `[]` and every
  listing is ineligible.
- §6 `voiceRequired` has the same problem: `NO_VOICE` by default.

**Fix:**
1. `eligibility.ts`: treat an **empty or missing requester language list as
   "no preference"**, so it passes. Add spec cases for both.
2. Add the **Settings screen** (P2-1) with languages (multi-select of ISO
   codes: en, de, fr, es, pt, it, pl, tr, ru, ar, ko, ja, zh), voice
   (`LEAGUE_VOICE | DISCORD | NO_VOICE`), Discord tag + reveal, and
   auto-accept.
3. On first sign-in, if prefs don't exist, call `PUT /v1/prefs` with
   `languages: [navigator.language.slice(0,2)]` and `voice: "LEAGUE_VOICE"`.
4. Replace the PublishForm's free-text languages input
   (`ui/PublishForm.tsx`, the comma-separated input) with the same
   multi-select component.

**Done when:** a fresh account can request to join a default listing.
Spec: an `evaluateEligibility` case with the listing `["en"]` and requester
prefs `null` / `[]` is eligible.

### P0-7. Any user can start or end any lobby's session (authorization hole)

**Where:** `apps/api/src/modules/session/session.service.ts`
`findActiveForUser(userId, listingId)`. When a `listingId` is given, it
returns that listing's session **without checking membership**.
`onSessionStart` then sets the listing to `IN_SESSION` and removes it from
the board. `onSessionEnd` increments games, records `COMPLETED` reputation
and refreshes profiles. Any client can send `session.start {listingId}` for
any listing and kill it.

**Fix:** in `findActiveForUser`, when `listingId` is given, also require
`memberAccountIds` to overlap the user's account ids. Otherwise return
`null`. Add a spec.

### P0-8. The session never ends, so endorsements never prompt (doc 04 G1)

**Where:**
- `listingMachine.ts` sends `SESSION_END` via `sync()`, whose payload is
  `{status, phase, queueId}`.
- `sync.gateway.ts` `onSessionEnd` reads `observedPhase` / `final`, which
  are never sent. So `final` is always false, `endedAt` is never set, and
  `ENDORSE_PROMPT` is never sent.
- `POST_SESSION` never sends a second, final end.

**Fix (minimal, independent of M3):**
- In `dispatchMachine`, for `IN_SESSION` → `POST_SESSION`, send
  `sync(SocketEvents.SESSION_END, { listingId: appStore.state.listing.id, observedPhase: event.phase, final: event.phase === "Lobby" || event.phase === "None" })`.
- Add to the `POST_SESSION` case: on `PHASE` with `Lobby | None`, send
  `SESSION_END {listingId, observedPhase, final:true}` **once**. Keep a
  module flag reset on `QUEUE_AGAIN` / `EXPIRED`.
- Add a server-side safety net (P1-12): a session sweeper ends idle sessions.

M3 in doc 04 later replaces the endorsement trigger with Riot-confirmed
games. This fix is still needed now.

**Done when:** a spec in `client-core` for `dispatchMachine` with a mocked
`syncAgent.send` asserts the payloads above.

### P0-9. Accepting a join request races and can over-fill a lobby

**Where:** `apps/api/src/modules/join/join.service.ts` `accept()`. It:
- doesn't check the listing status (it can accept into a DELISTED, PAUSED,
  IN_SESSION or expired listing);
- if no matching open slot exists (`idx < 0`), still marks the request
  ACCEPTED and the listing FILLING, with no slot reserved;
- has no row lock, so two concurrent accepts can take the same slot.

**Fix:**
- Inside the transaction:
  1. Re-load the listing with
     `manager.findOne(Listing, { where:{id}, lock:{ mode:"pessimistic_write" } })`.
  2. Require `status ∈ {LISTED, FILLING}` and `expiresAt > now`. Otherwise
     throw `400 LISTING_NOT_OPEN`.
  3. Find the slot. If `idx < 0`, throw `409 NO_SLOT` and don't change the
     request.
  4. Re-check `jr.status === "PENDING"` under the lock.
- Before accepting, require the **requester to be online**: the Redis key
  `presence:<requesterUserId>` exists. Otherwise throw `409 REQUESTER_OFFLINE`
  and mark the request `EXPIRED` (no reputation penalty). This avoids the
  90 s no-show trap for people who closed the app.

**Done when:** specs cover: listing delisted → 400; no slot → 409; and two
parallel accepts on a 1-slot listing → exactly one succeeds. Mock the
transaction with a simple in-memory lock if a real database isn't available
in jest.

### P0-10. Client state is lost on restart (listing, session, requests)

**Where:**
- After the app restarts, `appStore.listing` is `DRAFT` with no id, even
  though the server still has a LISTED listing. "My Lobby" doesn't show it.
- `canPublish` then hits `ACTIVE_LISTING_EXISTS`. `adoptExistingListing()`
  only runs on a publish failure.
- `state.session` and `state.pendingRequests` are also lost. There is no API
  to fetch "my active session".

**Fix:**
1. **Server, `sync.gateway.ts` `onReconcile`:** always look up
   `listings.mine(userId)`, even without `listingId` in the payload, and
   emit `LISTING_STATE`.
   - Also emit `SESSION_ACTIVE` for the user's active session (new
     `SessionService.findActiveSummaryForUser(userId)`), and re-join the
     socket to that session room (`client.join(fanout.sessionRoom(id))`).
     This also fixes P1-9.
   - Also emit `JOIN_REQUESTED` for every PENDING request on the user's
     listing (reuse `JoinService.listForListing`). Mark them with
     `replay: true`, so the client doesn't toast each one.
2. **New REST endpoint `GET /v1/sessions/active`** returning the summary or
   `null`, for the REST path.
3. **Client, `syncAgent.ts`:**
   - `LISTING_STATE` handler: also set `myListing` via `fetchMyListing()`
     when the id differs from the stored one.
   - `JOIN_REQUESTED`: de-dupe by `joinRequestId` (it currently appends
     blindly) and skip the toast when `payload.replay`.
   - `SESSION_ACTIVE`: also call `fetchSessionMessages` (P1-10).

**Done when:** publish, then restart the app, and My Lobby shows the live
listing with its pending requests. Delist works.

---

## P1 — Flow breakers and correctness bugs

### P1-1. Pending join requests never expire and are never cleaned up

**Where:** `join.service.ts`. Requests stay `PENDING` forever when:
- the listing is delisted, expired, paused, or fills up;
- the creator ignores them.

The requester is never told.

**Fix:**
- Add a TTL. In `requestJoin`, enqueue
  `queue.add("pending-timeout", {joinRequestId}, {delay: 10*60_000, jobId:"join-pending-"+id, removeOnComplete:true})`.
  The handler sets `EXPIRED` if still PENDING and emits `JOIN_FAILED {code:"EXPIRED"}`
  to the requester. No penalty.
- New `JoinService.closePendingForListing(listingId, code)`. It sets every
  PENDING request to `EXPIRED` and notifies each requester with
  `JOIN_FAILED {code}`. Call it from:
  - `ListingsService.applyStateInternal` when the new status is DELISTED;
  - `expireDue` (code `LISTING_EXPIRED`);
  - `confirmLobby` when the listing becomes READY with no open slot
    (`LOBBY_FULL`);
  - `SessionService.onSessionStart` (`LOBBY_IN_GAME`).

  To avoid the circular dependency `ListingsService ↔ JoinService`, put it
  in a small `JoinCleanupService` in the join module and inject it into
  lobby/session with `forwardRef`. Or emit through a Nest
  `EventEmitter2` event `listing.closed`; either is fine.
- Client `syncAgent` `JOIN_FAILED` handler: map codes to text
  (`EXPIRED` → "Request expired", `LISTING_EXPIRED`/`LOBBY_FULL`/`LOBBY_IN_GAME`
  → "That lobby is no longer available") and remove the request from
  `outgoingRequests` (P1-3).

### P1-2. The creator isn't told when a requester cancels, and a request can't be withdrawn after accept

**Where:** `join.service.ts` `cancel()` only allows PENDING and doesn't
notify the creator. The creator's `pendingRequests` keeps a dead card.

**Fix:**
- Emit a new `JOIN_CANCELLED {joinRequestId}` (add it to
  `shared-types/socket-events.ts` S2C) to the creator. The client removes it
  from `pendingRequests`.
- Allow cancelling `ACCEPTED` too:
  - set the status to `CANCELLED`;
  - remove the timeout job;
  - `reopenSlot`;
  - emit `JOIN_REOPENED` to the creator;
  - record **no** NO_SHOW.

  To prevent abuse, cancelling an ACCEPTED request records the reliability
  kind `"CANCELLED_AFTER_ACCEPT"` with weight −5 in
  `reputation/reliability.ts`. Add it to the `ReliabilityKind` type.

### P1-3. The requester has no "My requests" view and cannot cancel

**Missing feature.** The cancel API exists, but the client never calls it.
After clicking Join, the board gives no sign that a request is pending, and
the user can click Join again (the server answers `ALREADY_PENDING`).

**Fix:**
- New `GET /v1/join-requests/mine`. It returns the user's requests from the
  last 24 h:
  `{id, listingId, status, roleSlot, createdAt, listing: ListingSummary | null, creator: {riotId, tagLine}}`.
- `client-core/api/session.ts`: add `fetchMyJoinRequests()` and
  `cancelJoin(id)`.
- New store field `outgoingRequests`. Fill it on boot and after
  `requestJoin`. Update it from `JOIN_ACCEPTED`, `JOIN_DECLINED` and
  `JOIN_FAILED`.
- Add a `BoardRow.myRequest?: {id, status} | null` field. The server fills it
  in `board.service.ts` with one query of the viewer's PENDING/ACCEPTED
  requests for the candidate listings. In `BoardView`, show
  "Requested · Cancel" instead of Join.
- Add an "Outgoing" section to the `Requests` tab, with status and a cancel
  button.

### P1-4. A requester gets a NO_SHOW penalty even if the creator never sent the invite

**Where:** `join.service.ts` `handleTimeout`. A NO_SHOW is recorded 90 s
after accept regardless of whether the creator's client actually invited.
`inviteResult(ok:true)` stores nothing. The creator's app may have been
minimized, crashed, or had `inviteAutomation` off ("invite manually").

**Fix:**
- Migration: add `join_requests.invite_sent_at timestamptz NULL`.
- `inviteResult(ok:true)` sets it.
- In `handleTimeout`:
  - if `inviteSentAt` is null → status `EXPIRED`, **no** reputation event,
    `JOIN_FAILED {code:"INVITE_NOT_SENT"}`;
  - otherwise NO_SHOW as now.
- Restart the 90 s timer from `inviteSentAt`: when `inviteResult(ok)`
  arrives, remove the job and re-add it with `delay: 90_000`.
- Manual-invite path (`syncAgent.handleJoinAccepted` when
  `!flags.inviteAutomation`): add an "I've sent the invite" button on the
  manual-invite banner in `LobbyViews.tsx` that calls
  `reportInviteResult(id, true)`.

### P1-5. One player can be accepted into several lobbies at once

**Where:** `requestJoin` has no limit on concurrent requests and doesn't
check whether the requester is already ACCEPTED elsewhere, in an active
session, or the creator of an active listing.

**Fix:** in `requestJoin`:
- reject if the requester has any `ACCEPTED` request (`409 ALREADY_ACCEPTED_ELSEWHERE`);
- reject if they have more than 3 `PENDING` (`429 TOO_MANY_PENDING`);
- reject if they are a member of an open session (`409 IN_SESSION`).

In `accept()`, when one request is accepted, expire the requester's other
PENDING requests (`closePendingForRequester`, code `ACCEPTED_ELSEWHERE`).

### P1-6. `memberLeft` lets a creator give an ABANDONED penalty to anyone

**Where:** `join.service.ts` `memberLeft(userId, accountId)`. The gateway
`MEMBER_LEFT` takes any `accountId`. Nothing checks that the account was a
member of the creator's session.

**Fix:**
- Require an open session for that listing whose `memberAccountIds` includes
  `accountId`.
- Only record `ABANDONED` if the session has `startedQueueAt == null`
  (they left before queueing). Otherwise do nothing.
- Remove the account from `memberAccountIds`.
- Once M2 lands, the server detects leavers itself from the party reconcile
  and this socket event can be deprecated.

### P1-7. Slot reconcile adds unwanted slots and closes slots that have a pending join

**Where:** `listings.service.ts` `reconcileSlots`.

- When `openCount < seats`, it **adds new any-role slots**. Example: a
  creator who wanted one jungler in a 5-person Flex lobby with 3 free seats
  is suddenly advertising 3 "any role" seats.
- When closing, it closes the first open slots regardless of
  `pendingAccountId`, which breaks an in-flight join.
- `seats === 0` pauses the listing, but nothing un-pauses it when seats free
  up again.

**Fix (until M2 replaces this endpoint):**
- Never add slots. Only close or reopen slots the reconciler itself closed:
  - add `closedReason?: "LOBBY_FULL" | "OWNER" | "FILLED"` to the
    `ListingSlot` type in `shared-types/board.ts`, optional;
  - close in this order: any-role slots first, never slots with
    `pendingAccountId`;
  - reopen only `closedReason === "LOBBY_FULL"`.
- If the status is PAUSED and the listing was paused by this reconciler
  (store `queueMeta`-independent `pauseReason` on the listing: migration
  `listings.pause_reason text NULL`) and `seats > 0` → set it back to LISTED
  and emit a board upsert.
- Specs for all three behaviors.

### P1-8. Listing create/patch trust client-supplied `pendingAccountId`, and patch can edit closed listings

**Where:** `listings.service.ts` `normalizeAndValidateSlots` copies
`s.pendingAccountId` from the request body. `patch()` has no status check,
and it replaces `slots` even while a join is ACCEPTED, which loses the
reservation.

**Fix:**
- In create: force `pendingAccountId: null`.
- In patch: reject unless the status is LISTED, FILLING or PAUSED
  (`400 LISTING_CLOSED`).
- When patching slots, carry over `pendingAccountId` and `open:false` for
  any existing slot id that has a pending account, and reject a patch that
  removes such a slot (`409 SLOT_HAS_PENDING_JOIN`).
- Emit `fanout.emitBoardUpsert` after a patch. It's currently missing, so
  other viewers see stale data until 30 s cache expiry or another event.
- Remove `pendingAccountId` from `SlotDto` (`dto/listing.dto.ts`) entirely.

### P1-9. Socket rooms are not joined for accounts linked after connect, nor for sessions after reconnect

**Where:** `sync.gateway.ts` `handleConnection` joins `account:<id>` and
`board:<platform>` only for accounts linked **at connect time**. The first
link always happens after connect, so after first sign-in the user misses:
- `LISTING_STATE` (sent to the account room);
- `BOARD_DELTA`;
- session rooms (`joinSessionRoom` only joins sockets connected at
  confirm time).

**Fix:**
- Add `RealtimeFanoutService.joinAccountRooms(userId)`. It fetches the user's
  sockets (`server.in(userRoom).fetchSockets()`) and joins the account and
  board rooms for every linked account.
- Call it at the end of `riot-accounts.service.ts` `link()` and the P0-2
  verify, through an injected `RealtimeFanoutService` (use `forwardRef` if
  there's a cycle).
- Session room re-join on reconnect: handled in P0-10.

### P1-10. Chat history is never loaded, and message authors show as UUIDs

**Where:**
- `client-core` never calls `fetchSessionMessages`.
- The REST history shape `{fromAccountId, createdAt}` differs from the
  socket shape `{from:{accountId,riotId,tagLine}, at}`.
- `SessionView` shows `m.from?.riotId ?? m.fromAccountId`, so a raw UUID is
  shown for history rows.

**Fix:**
- `session.service.ts` `history()`: return the same shape as
  `CHAT_MESSAGE` (join riot_accounts for the riotId/tagLine).
- Type it as `ChatMessagePayload[]` in `shared-types/socket-events.ts`.
- Client: on `SESSION_ACTIVE` (and on reconcile), call `fetchSessionMessages`
  and merge into `session.chat`, de-duping by `id`.
- `SessionView`:
  - show `riotId#tagLine` and a time;
  - mark your own messages, aligned right; compare against the user's own
    account ids from `riotAccountId`;
  - auto-scroll to the bottom on a new message.

### P1-11. Session chat input stays enabled after the session ends; the session UI never clears

**Fix:**
- Add `endedAt` and `chatOpenUntil` to the `SESSION_ACTIVE` payload. Also
  emit a new `SESSION_ENDED {sessionId, chatOpenUntil}` S2C event from
  `onSessionEnd(final)` to the session room.
- Client: store `session.endedAt` / `chatOpenUntil`. Disable the input after
  `chatOpenUntil` with "Chat closed". Show a "Leave" button that clears
  `state.session`.
- Show `CHAT_RATE` / `BLOCKED` / `CHAT_CLOSED` errors. The current
  `sendChat` path is fire-and-forget over the socket, so add an ack callback
  in `syncAgent.sendChat` and toast `ack.error`.

### P1-12. Sessions never end server-side if clients don't report it

**Where:** sessions with `endedAt IS NULL` stay open forever. This blocks
P1-5 checks and keeps `findActiveForUser` returning stale sessions.

**Fix:** add a repeatable BullMQ job in `session.module.ts`, modelled on
`chat-retention.service.ts`, that runs every 10 min. It ends any open
session where:
- `created_at < now - 6h`; or
- no member has a live `presence:<userId>` key and the last activity was
  more than 30 min ago (use `max(started_queue_at, league_lobby_confirmed_at, created_at)`).

Set `endedAt` and `chatOpenUntil = now`. **Don't** record COMPLETED and
**don't** prompt endorsements; that is M3's job.

### P1-13. Profile refresh re-downloads up to 60 matches every time (Riot rate limit)

**Where:** `profile-refresh.service.ts` `refresh()`. The "fill role/form
window" loop calls `matchById` for up to 60 recent matches that **are
already stored** in the `matches` table. Only `fetched` (this run) is
skipped. With a dev or personal key (100 req / 2 min), one refresh can
consume the whole budget.

**Fix:**
- For ids already in `seen`, load them from the database
  (`matches.find({where:{matchId: In(ids)}})`). Rebuild `MatchDto`-like
  objects from `participants` JSONB plus the columns: `info.queueId`,
  `gameCreation`, `gameDuration`, `participants`, `metadata.matchId`.
  `computeRoles`, `computeChampionStats` and `computeFormAndStreak` only
  read these.
- Call Riot only for unseen ids.
- Spec: given 60 seen ids and 2 unseen, `matchById` is called twice.

### P1-14. `profiles/:riotAccountId` leaks Discord tags and private prefs

**Where:** `profile.service.ts` `getCard` returns full `prefs`, including
`discordTag`, to **any** authenticated caller. This ignores
`discordReveal: HIDDEN | ACCEPTED | PUBLIC`.

**Fix:**
- Add a `viewerUserId` parameter to `getCard`.
- Return `discordTag` only if:
  - the viewer owns the account; or
  - `discordReveal === "PUBLIC"`; or
  - `discordReveal === "ACCEPTED"` and the viewer and the owner share a
    session or an ACCEPTED/COMPLETED join request.
- Never return `autoAcceptLoblyInvites` to non-owners.
- Update all callers: the controller, `join.service` (the card sent to the
  creator), and `listForListing`.

### P1-15. Board "Join" sends the wrong role

**Where:** `ui/BoardView.tsx`, Join `onClick`:
`joinRole = open?.roles?.[0] ?? role`.
- It uses the **first role of the first open slot**, not the viewer's role.
  A MID main joining a `[JUNGLE, MIDDLE]` slot requests JUNGLE and is marked
  off-role.
- When the role filter is `""`, it sends `roleSlot: ""`.

**Fix:**
- Compute the request role as the first of
  `[profile primaryRole, secondaryRole]` accepted by any open slot
  (`slotAcceptsRole` from shared-types). Fall back to the first role of the
  slot. Use `undefined` for any-role slots. `profileHints.primaryRole` /
  `secondaryRole` are in the store.
- When more than one role is possible, show a small role picker dropdown on
  the button.
- Server: validate `JoinDto.roleSlot` with `@IsIn(ROLES)`; it is currently
  any string.

### P1-16. Relisting an old listing can hit the unique index and return 500

**Where:**
- `listings.service.ts` `applyStateInternal` accepts any event from any
  status. `relist` on a DELISTED or POST_SESSION listing while another
  active listing exists violates `uq_listings_one_active_per_account`, which
  surfaces as a 500.
- `relist` on an expired listing re-activates it with `expiresAt` in the
  past.

**Fix:** add an explicit transition table on the server:
- `pause`: from {LISTED, FILLING, READY}
- `relist`: from {PAUSED, POST_SESSION, DELISTED-if-not-expired}; reset
  `expiresAt = now + 30min` if expired; check that no other active listing
  exists (`409 ACTIVE_LISTING_EXISTS`)
- `delist`: from any non-DELISTED
- `ready`: from {FILLING}
- `reopen`: from {READY, FILLING}

Return `409 INVALID_TRANSITION` otherwise. Catch the unique-violation code
`23505` and map it to `409 ACTIVE_LISTING_EXISTS`.

### P1-17. Reports accept non-existent or self targets

**Where:** `reputation.service.ts` `report()`.

**Fix:** check that `accountId` exists and is not one of the reporter's
accounts. If `sessionId` is given, require the reporter to be a member.
Return `400` codes `NOT_FOUND` / `CANNOT_REPORT_SELF` / `NOT_MEMBER`.

### P1-18. `deleteMe` loads every session in the database

**Where:** `identity/users.service.ts` `deleteMe` calls
`this.sessions.find()` with no filter.

**Fix:** query with `ArrayOverlap(accountIds)` (TypeORM) or raw
`member_account_ids && :ids`. Also delete or anonymize `game_reports` once
M3 exists.

### P1-19. Unlinking an account leaves dangling realtime and listing state

**Where:** `riot-accounts.service.ts` `unlink`. The cascade deletes
listings and join requests silently. Nobody is notified, and the board
cache isn't invalidated.

**Fix:** before deleting:
- delist the active listing through `ListingsService.applyStateInternal(…, "delist")`,
  which triggers the P1-1 cleanup and the board removal;
- cancel the user's outgoing PENDING/ACCEPTED requests through the P1-2
  path.

### P1-20. The Overwolf notification "Accept" doesn't clear the request; the avatar is broken

- `apps/overwolf/src/windows/notifications/main.tsx`: after
  `acceptJoin` / `declineJoin`, also remove the request from
  `pendingRequests`, as `LobbyViews.RequestsView.decide` does. Better:
  move that removal into one exported helper
  `decideJoin(id, accept)` in `client-core/api/session.ts` and use it in
  both places.
- `ui/App.tsx` uses `(state.summoner as any).profileIconId`, which never
  exists. Add `profileIconId?: number` to `AppState.summoner`. Set it in
  `verifySummoner` (both hosts) from `current-summoner.profileIconId`.
  Remove the `as any`.

### P1-21. Dead state and hard-coded season constants

- `sessionEndPending` is written in three places but never read. Remove it
  from `AppState`, `messaging.ts`, the listing machine, and
  `launcherEvents.ts`. M3 replaces it.
- `profile-refresh.service.ts` has `CURRENT_SEASON = "2026"` and the
  `SEASON_START_EPOCH` default `1743465600` (2025-04-01). Move both to
  env-driven config with a sane derived default: the season string comes
  from `SEASON_START_EPOCH`'s year. Log a warning at boot when the env vars
  are unset.

---

## P2 — Missing features for a complete LFG app

### P2-1. Sign-in gate, Settings screen, connection states

There is no sign-in UI, no settings, and no error state when the backend is
down.

Add in `client-core/src/ui/`:
- **`SignInGate.tsx`**. Shown when no valid session exists (`authExpired`
  or no tokens):
  - states: "Open League client" → "Verify with League client" (P0-2) →
    progress ("Changing your icon… verifying with Riot… restoring icon");
  - errors with retry.
  - Dev login is visible only when the dev flag is on.
- **`SettingsView.tsx`**. Replaces the gear's current target. Move Debug to
  a "Diagnostics" sub-tab. Sections:
  - **Matchmaking prefs:** languages, voice, Discord tag + reveal (P0-6),
    auto-accept LOBLY invites (move it from ProfileView).
  - **App:** "Open LOBLY when a game ends" (M3 `openOnGameEnd`), desktop
    notifications on/off (P2-3), and on Electron "Start with Windows"
    (P2-4).
  - **Accounts:** linked Riot accounts (`GET /riot-accounts`), "Add another
    account" (P0-2 link flow), Unlink (with confirm).
  - **Privacy:** Blocked players list (`GET /blocks`, unblock), and "Delete
    my LOBLY account" (`DELETE /users/me`, typed confirmation) followed by
    sign-out.
  - **Sign out:** call `POST /auth/logout`, `clearAuth()`,
    `syncAgent.disconnect()`, and reset the store.
- **Offline banner** in `App.tsx`: when `!state.sync.connected` for more than
  5 s, show "Reconnecting to LOBLY…". When the API is unreachable at boot,
  show "Can't reach LOBLY servers — retrying".

### P2-2. Block and report from the UI

The APIs exist (`POST /blocks`, `POST /reports`), but there is no UI.

- Add a "⋯" menu on request cards (`RequestsView`), on session members
  (`SessionView`, a new member list from `memberAccountIds` and their
  cards), and on board rows.
- Menu items:
  - **Block:** confirm. Then decline the request if pending, remove the row
    from the board, and toast.
  - **Report:** a modal with the reason enum
    `HARASSMENT | SLURS | BAIT_JOIN | OTHER`, optional detail (≤ 500 chars),
    and `sessionId` when it comes from a session.
- Add client functions `blockAccount`, `unblockAccount`, `listBlocks` and
  `reportAccount` to `api/session.ts`.

### P2-3. Desktop notifications for join, accept and invite events (Electron)

**Where:** Electron only shows in-app toasts. A creator sitting in the
League client never sees "Join request" or "Accepted". Overwolf has a
notifications window.

**Fix:**
- Add an optional `notify?(title, body, opts?: {actions?: {id,label}[]}) => void`
  to `HostAdapter`.
- Electron: implement it with `new Notification({...}).show()`, only when
  `isDesktopHidden()` or the window isn't focused. Clicking the
  notification focuses the window and switches to the relevant tab: send a
  new IPC `NAVIGATE` with the tab id, and have `App.tsx` listen for it.
- Overwolf: route to the existing notifications window (no change in
  behavior).
- Call `notify` from `syncAgent` on `JOIN_REQUESTED` (unless replay),
  `JOIN_ACCEPTED` (requester side: "Accept the League invite from X"),
  `JOIN_FAILED`, `SESSION_ACTIVE` and `CHAT_MESSAGE` (hidden only).
  Respect the P2-1 setting.

### P2-4. Electron app basics: single instance, tray, auto-start

**Where:** `apps/desktop/electron/main.ts`.
- `app.requestSingleInstanceLock()`. On a second instance, focus the
  existing window. Two instances currently both talk to the LCU and the
  backend.
- A tray icon (reuse `assets/` icons). Closing the window hides it to the
  tray while a listing is active or a session is open. The tray menu has
  "Open LOBLY", "Unpublish lobby" and "Quit". Quitting with an active
  listing dispatches `UNPUBLISH` first.
- "Start with Windows": `app.setLoginItemSettings({openAtLogin, args:["--hidden"]})`
  from Settings. When started with `--hidden`, don't show the window until
  the League client is detected or the user opens it.

### P2-5. In-app navigation from the board's own row and toasts

`BoardView` "Edit / Unpublish" on your own row only toasts "Edit this lobby
from My Lobby".
- Add `navigate(tab)` to the bridge (`shared/bridge.ts`) and implement it in
  `App.tsx`: lift `setTab` into a small store field `uiTab`, or a context.
- Use it for this button, for notification clicks (P2-3) and for the
  join-accepted toast (→ My Lobby / Session).

### P2-6. Party → listing sync (doc 04 **M2**) and post-game reputation (doc 04 **M3**)

These are core features for this app and are already fully specified. Do
them **after** P0 and P1. They depend on:
- P0-2 (identity mapping via `lcu_puuid`);
- P0-8 (the session end contract);
- P1-1 (`closePendingForListing`);
- P1-7 (`closedReason` on slots; M2's `FILLED_IN_CLIENT` reason extends that
  union).

Implement them exactly as `04_LOBBY_SYNC_AND_POSTGAME.md` §3–§4 describes.
When M2 is done, delete `reconcileSlots` and its client caller
(`maybeReconcileSlots`).

### P2-7. Ready-check auto-accept (optional, behind a setting)

This is common in LFG companion apps, and the `acceptMatch`-style endpoint
is standard LCU. Add the `lcu-endpoints` entry
`readyCheckAccept: POST /lol-matchmaking/v1/ready-check/accept` and a
setting "Auto-accept queue pop", default **off**. In `gameFlowTracker`'s
`onPhase`, when `to === "ReadyCheck"` and the setting is on, wait
`1500 ms`, then call it once per ready check. Log it. Don't retry.

---

## Appendix A: Verification checklist (end-to-end, two accounts A and B)

Run after P0 and P1. These are manual; record the results in
`apps/overwolf/SPIKE_RESULTS.md` or a new `QA_LOG.md`.

1. A and B each sign in with the League client. They get distinct users,
   and their icons are restored.
2. A publishes a Flex listing. B sees it within 3 s. B's Join button sends
   B's main role.
3. B requests. A gets a desktop notification and an in-app card. B's board
   shows "Requested · Cancel".
4. B cancels. A's card disappears. B requests again, and A accepts. A's
   client sends the invite. B auto-accepts or accepts manually. The session
   becomes active on both, and the chat history loads on both after a
   restart.
5. A restarts LOBLY mid-session. My Lobby, Session and chat are all
   restored.
6. Delist while C has a PENDING request. C gets "That lobby is no longer
   available".
7. Leave the app open for more than 20 min, then restart the API. The
   socket reconnects (no `bad jwt` loop) and requests still arrive.
8. Play a game, then return to the lobby. The session is ended
   (`endedAt` set), an endorse prompt is received, and endorsing works once
   per teammate.
9. A third account cannot `session.start` A's listing (P0-7), cannot claim
   A's Riot ID (P0-2), and cannot see A's Discord tag (P1-14).
10. Riot calls per refresh with no new matches is ≤ 3 (P1-13). Check the API
    logs.

## Appendix B: Out of scope (noted, not to be done now)

- Duo-legality rules in `lobby/duo-legality.ts` are an MVP approximation.
  Re-check them against Riot's current published Solo/Duo restrictions
  before launch; the rules change between seasons.
- `board.service.ts` does N+1 queries for `getReputationBlock` (up to 50
  rows). It's fine at current scale; batch it if board latency exceeds
  300 ms.
- RSO (Riot Sign-On) should replace the icon challenge once LOBLY has a
  production key. Keep the `/auth/riot/*` controller as the seam.
