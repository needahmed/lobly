# Phase 2 — Backend: Identity, Verified Profiles, Listings, Realtime

**Goal:** the complete LOBLY cloud for MVP: auth, passive Riot account linking,
the Riot API ingestor with rate limiting, verified profile snapshots, the listing
board with server-side filters and Match Score v1, and the realtime gateway the
Overwolf client connects to instead of the Phase 1 mock.

**Prerequisites:** Phase 1 complete (the client and mock backend define the contract
this backend must satisfy). Read `00_BUILD_OVERVIEW.md` §3, §4 (especially C5, C8,
C10), §6, §8.

**Phase 2 does NOT include:** the join/invite orchestration, chat, endorsements,
moderation (all Phase 3). Phase 2 ends when a client can log in, link a Riot
account, publish a listing, and another client can browse a filtered board with
Match Scores.

---

## Milestone 1 — NestJS skeleton, database, deploy pipeline

### 1.1 App scaffold

`apps/api/` — NestJS 10, TypeScript strict. Module layout (one folder each under
`src/modules/`): `identity`, `riot` (the ingestor + riot-client wiring), `profile`,
`lobby`, `realtime`, `config`, plus `common/` (guards, interceptors, DTO pipes).

Global setup in `main.ts`:
- `app.enableCors({ origin: true, credentials: true })` — C8: Overwolf origins are
  `overwolf-extension://<uid>`; reflect origin, do not use a static allowlist in dev.
- Global `ValidationPipe({ whitelist: true, transform: true })`.
- URI prefix `/v1` for everything except `/config/*` and `/health`.
- Config via `@nestjs/config`; required env vars (fail fast if missing):
  `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `RIOT_API_KEY`.

### 1.2 Database schema (TypeORM migrations — write these tables exactly)

```sql
users(
  id uuid PK default gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz default now()
)

riot_accounts(
  id uuid PK,
  user_id uuid FK -> users NOT NULL,
  puuid text UNIQUE NOT NULL,
  riot_id text NOT NULL,            -- gameName
  tag_line text NOT NULL,
  summoner_id bigint,               -- platform-scoped; needed for LCU invites
  platform text NOT NULL,           -- 'euw1', 'na1', ... 'kr' is rejected (C4)
  verified_at timestamptz,
  last_seen_at timestamptz          -- last time the client observed this account logged in
)

profile_snapshots(
  riot_account_id uuid PK FK -> riot_accounts,
  solo_tier text, solo_division text, solo_lp int, solo_wins int, solo_losses int,
  flex_tier text, flex_division text, flex_lp int, flex_wins int, flex_losses int,
  primary_role text, secondary_role text,     -- TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY
  form_wr20 numeric(5,2),                     -- win rate over last 20 games, 0-100
  streak int,                                 -- + wins / - losses
  summoner_level int, profile_icon_id int,
  games_this_season int,
  refreshed_at timestamptz NOT NULL
)

champion_stats(
  riot_account_id uuid FK, champion_id int, season text,
  games int, wins int, kda numeric(5,2),
  PRIMARY KEY (riot_account_id, champion_id, season)
)

matches_seen(
  riot_account_id uuid FK, match_id text,
  PRIMARY KEY (riot_account_id, match_id)
)                                              -- delta-ingestion cursor support

listings(
  id uuid PK,
  creator_account_id uuid FK -> riot_accounts NOT NULL,
  platform text NOT NULL,
  queue_id int NOT NULL,                       -- 420 | 440 | 450
  type text NOT NULL,                          -- 'DUO' | 'FLEX' | 'ARAM'
  title text NOT NULL,
  description text,
  status text NOT NULL default 'LISTED',       -- ListingStatus enum values
  filters jsonb NOT NULL default '{}',
  slots jsonb NOT NULL,                        -- [{role:'JUNGLE', open:true}, ...]
  voice_required boolean default false,
  languages text[] default '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz default now(),
  paused_at timestamptz, delisted_at timestamptz
)

join_requests(
  id uuid PK,
  listing_id uuid FK NOT NULL,
  requester_account_id uuid FK NOT NULL,
  role_slot text,
  status text NOT NULL default 'PENDING',      -- PENDING|ACCEPTED|DECLINED|EXPIRED|CANCELLED|NO_SHOW|COMPLETED
  match_score int,
  off_role boolean default false,
  created_at timestamptz default now(),
  decided_at timestamptz
)

user_prefs(
  user_id uuid PK FK -> users,
  languages text[] default '{}',
  voice text default 'NO_VOICE',               -- LEAGUE_VOICE|DISCORD|NO_VOICE
  vibe_tags text[] default '{}',
  discord_tag text, discord_reveal text default 'HIDDEN'
)
```

(Phase 3 adds `sessions`, `endorsements`, `reliability_events`, `blocks`,
`reports`.) Indexes: `listings(platform, status, queue_id)`,
`listings(expires_at)`, `join_requests(listing_id, status)`.

### 1.3 Deploy

Railway project with three services: `api` (Dockerfile in `apps/api`), Postgres
plugin, Redis plugin. CI (GitHub Actions): lint → build → run migrations → deploy on
main. `/health` returns `{ok, db, redis, riotKeyLoaded}`. Do this milestone-1-early
so every later milestone is testable against a real URL from the Overwolf client.

**Milestone 1 acceptance:** deployed `/health` green; migrations idempotent; local
`docker-compose up` (postgres+redis) documented in `apps/api/README.md`.

---

## Milestone 2 — Identity: auth + passive Riot linking

### 2.1 Auth endpoints (email/password MVP per C9)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/v1/auth/register` | `{email, password}` → `{accessToken, refreshToken, user}` |
| POST | `/v1/auth/login` | `{email, password}` → same |
| POST | `/v1/auth/refresh` | `{refreshToken}` → `{accessToken, refreshToken}` (rotating) |
| POST | `/v1/auth/logout` | invalidates refresh token (Redis denylist) |

bcrypt cost 12; access token 15min, refresh 30d; JWT payload `{sub: userId}`.
Guard: `JwtAuthGuard` global except `@Public()` routes. Rate limit auth routes:
10/min/IP (use `@nestjs/throttler` with Redis storage).

### 2.2 Passive Riot account linking (the LOBLY signature move)

Flow (client side already exists from Phase 1 — it knows the logged-in summoner):

1. Client `POST /v1/riot-accounts/link` with
   `{puuid, gameName, tagLine, summonerId, platform}` (all read from the LCU on the
   user's machine — only the account owner can be logged into that client).
2. Server validation, in order:
   a. `platform !== 'kr'` (C4) else 403 `REGION_NOT_SUPPORTED`.
   b. Riot Account-v1 `by-puuid` on the platform's regional route → must exist and
      `gameName#tagLine` must match (case-insensitive) what the client sent.
   c. If the puuid is already linked to a DIFFERENT user: 409 `PUUID_TAKEN`
      (support flow post-MVP; do not silently re-bind).
3. Create/refresh `riot_accounts` row, set `verified_at = now()`, enqueue a
   `profile.refresh` job (Milestone 3).
4. **Continuous honesty check:** the realtime heartbeat (Phase 1 sync agent)
   includes the currently-observed puuid; if it matches a linked account, bump
   `last_seen_at`. Listings can only be created for accounts seen in the last 24h.

Endpoints: `POST /v1/riot-accounts/link`, `GET /v1/riot-accounts` (mine),
`DELETE /v1/riot-accounts/:id` (unlink + purge snapshots — GDPR groundwork).

**Milestone 2 acceptance:** register → login → link the real dev account from the
running Overwolf client → row appears verified; linking a garbage puuid fails; KR
platform rejected.

---

## Milestone 3 — riot-client package + ingestor + profile snapshots

### 3.1 `packages/riot-client` (backend-only import)

One class, `RiotClient`, constructor `{apiKey, redis}`. Responsibilities:

- **Host resolution:** platform hosts vs regional routing per `00` §8.2 (hard-code
  the platform→region map; export it).
- **Rate limiting (C5):** token bucket in Redis (Lua script or `ioredis` multi) with
  TWO buckets per region: 20 tokens/1s and 100 tokens/120s (dev key defaults; make
  the numbers env-configurable because the production key raises them). Every
  request consumes from both. When empty, the request waits in a queue.
- **Priority queue:** two levels. `interactive` (profile refresh needed for an open
  join request / publish) outranks `background` (post-game ingestion). Simple
  implementation: two BullMQ queues consumed by one worker that always drains
  `interactive` first; the worker is the only code that calls `RiotClient.request`.
- **429 handling:** honor `Retry-After` header, requeue with that delay, log a
  metric. Never hard-fail a job on 429.
- **Methods** (thin wrappers, all typed): `accountByPuuid(region, puuid)`,
  `summonerByPuuid(platform, puuid)`, `leagueEntriesByPuuid(platform, puuid)`,
  `matchIdsByPuuid(region, puuid, {startTime, count})`,
  `matchById(region, matchId)`, `topMasteries(platform, puuid, count)`.

### 3.2 Snapshot computation (`profile` module)

Job `profile.refresh(riotAccountId, priority)`:

1. `leagueEntriesByPuuid` → solo (queueType `RANKED_SOLO_5x5`) and flex
   (`RANKED_FLEX_SR`) tier/division/LP/wins/losses.
2. `summonerByPuuid` → level, profileIconId.
3. `matchIdsByPuuid` with `startTime` = season start epoch, `count=100`, filtered
   through `matches_seen` → fetch only unseen match details (delta ingestion, C5),
   cap 30 new matches per refresh.
4. From stored + new ranked matches (queues 420/440) compute:
   - **primary/secondary role**: count `teamPosition` of this puuid's participant
     over the last 60 ranked games; primary = most frequent, secondary = second
     (require ≥15% share, else null).
   - **champion_stats**: per champion games/wins/KDA this season, keep top 10.
   - **form_wr20** and **streak** from the 20 most recent games (any queue of
     420/440/450).
   - **games_this_season** = count of ranked matches seen.
5. Upsert `profile_snapshots.refreshed_at = now()`.

**Freshness policy (C5) — implement as `ProfileService.ensureFresh(accountId, moment)`:**

| Moment | Max age before forced refresh | Priority |
|---|---|---|
| browsing board | 6 hours (serve stale, refresh in background if older) | background |
| publishing a listing | 30 minutes | interactive |
| creator opens a join request | 30 minutes | interactive |
| client reports game ended (Phase 3) | always ingest new matches | background |

### 3.3 Profile read API

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/profiles/:riotAccountId` | full card: snapshot + top champions + prefs + (Phase 3: reputation) |
| GET | `/v1/profiles/me` | all my linked accounts' cards |
| PUT | `/v1/prefs` | languages, voice, vibe tags, discord settings |
| GET | `/static/champions` | Redis-cached Data Dragon champion map `{id → {name, key, iconUrl}}`, 24h TTL |

**Milestone 3 acceptance:** linking the dev account produces a snapshot with
believable rank/roles/champions within 60s on a dev key; a second forced refresh
fetches only unseen matches (verify via logs); hammering refresh 50x queues without
any 403/429 leaking to the caller.

---

## Milestone 4 — Listings: CRUD, filters, Match Score, board

### 4.1 Listing lifecycle endpoints (server is authoritative, C: overview §7 rule 4)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/listings` | create+publish. Body: `{riotAccountId, queueId, type, title, description?, slots, filters, voiceRequired, languages, durationMin (15\|30\|60)}` |
| PATCH | `/v1/listings/:id` | creator edits title/filters/duration (refresh resets `expires_at`) |
| POST | `/v1/listings/:id/state` | client state machine sync: `{event: "pause"\|"relist"\|"delist"\|"ready"\|"reopen", phase}` |
| GET | `/v1/listings/mine` | my active listing (max ONE active listing per riot account — enforce with a partial unique index on `status IN ('LISTED','FILLING','READY','PAUSED')`) |
| GET | `/v1/board` | the browse endpoint (below) |

Create-time validation: account is mine, `verified_at` set, `last_seen_at` within
24h, platform not `kr`, queueId ∈ {420,440,450}, snapshot fresh per §3.2 policy
(force refresh if stale, THEN evaluate), title profanity-filtered (use a plain
wordlist lib, e.g. `obscenity`), duration ∈ {15,30,60}.

Expiry sweeper: BullMQ repeatable job every 60s → `UPDATE listings SET
status='DELISTED', delisted_at=now() WHERE status IN (...) AND expires_at < now()`
→ publish board deltas for each. Also a **stale-phase sweeper**: any listing whose
creator's presence heartbeat is >90s old → `PAUSED` (no ghost listings, `00` §6).

### 4.2 Filter engine (pure function, unit-test heavily)

`evaluateEligibility(listing, requesterSnapshot, requesterPrefs): {eligible: boolean, reasons: string[], offRole: boolean}`

Checks, in order (collect ALL failing reasons, don't short-circuit):
1. **Platform match** — requester's account platform === listing platform.
2. **Rank range** — listing.filters `{minTier, minDivision, maxTier, maxDivision}`
   against the snapshot's solo tier (flex tier for FLEX listings; ARAM skips rank).
   Implement tier math as a single integer: `tierIndex*4 + divisionIndex` with the
   order IRON < BRONZE < SILVER < GOLD < PLATINUM < EMERALD < DIAMOND < MASTER <
   GRANDMASTER < CHALLENGER (Master+ have one division).
3. **Duo legality (queue 420 only)** — hard rule on top of the creator's filters,
   from a config table (env-overridable JSON since Riot tweaks it): both players
   within the legal Solo/Duo range. MVP table: IRON..EMERALD → within ±1 tier;
   DIAMOND → within 2 divisions; MASTER+ → duo not allowed. If creator's own filter
   range is wider than legality, legality wins.
4. **Role** — requested slot open; `offRole = slot.role ∉ {primary, secondary}`.
   Off-role does NOT make ineligible; it sets the badge flag.
5. **Languages** — non-empty intersection if the listing declares languages.
6. **Voice** — if `voiceRequired`, requester pref must not be `NO_VOICE`.
7. **Games floor** — `games_this_season >= filters.minGames` (default 0; provisional
   accounts get badged in Phase 3, not blocked in Phase 2).
8. **Blocks** — placeholder returning pass (table lands in Phase 3; keep the hook).

### 4.3 Match Score v1 (rank + role + language only, per MVP cut line)

`matchScore(listing, creatorSnap, viewerSnap, viewerPrefs): number  // 0..100`

```
rankProximity  = max(0, 1 - abs(creatorRankInt - viewerRankInt) / 8)     // 8 divisions = 2 tiers
roleComplement = 1.0 if viewer primary fills an open slot
               = 0.7 if viewer secondary fills an open slot
               = 0.3 otherwise
languageMatch  = 1.0 if intersection, else 0.0 (1.0 if listing declares none)

score = round(50*rankProximity + 30*roleComplement + 20*languageMatch)
```

Document the weights as constants in one file; Phase 3+ tunes them.

### 4.4 The board

`GET /v1/board?queueId=&roles=&minRank=&maxRank=&voice=&language=&sort=score|newest|rank`
- Scope: viewer's platform only (from their linked account), status `LISTED` or
  `FILLING` (with open slots), not expired.
- Server-side pre-filter (C: anti-scrape): **only return listings the viewer is
  eligible for** (run `evaluateEligibility`; include `offRole` ones, they're
  eligible-with-badge). Cap 50 results.
- Each row: listing summary + creator's public card subset (riotId, tier/div/lp,
  primary role, top 3 champs, form) + `matchScore` + `offRole` + `eligible:true`.
- Cache layer: keep the *candidate set* per platform+queue in Redis (invalidated on
  listing create/state change); per-viewer eligibility+score computed on request
  (cheap: pure functions over two snapshots).

### 4.5 Realtime gateway (replaces the mock)

Socket.io namespace `/sync`, JWT in `auth.token` on connect (reject otherwise).
Redis adapter from day one. Events (names in `packages/shared-types/socket-events.ts`):

**Client → server:** `presence.heartbeat {phase, listingStatus, observedPuuid}`
(every 30s; refresh Redis presence key TTL 90s), `listing.publish/pause/relist/
delist/ready/reopen` (same payloads the mock accepted — the Phase 1 client should
connect UNCHANGED except the URL), `session.start`, `session.end`.

**Server → client:** `board.delta {upsert?: ListingRow, remove?: listingId}`
(rooms per platform+queue: `board:euw1:420`), `listing.state {listingId, status}`
(reconciliation: server echoes authoritative state after every write; client adopts
it if it differs), `join.requested` / `join.accepted` / `join.declined` (Phase 3
payloads, define the event names now).

Presence expiry watcher: when a heartbeat key vanishes and the user has an active
listing → pause it → emit deltas (this is the server half of the no-ghost rule).

**Milestone 4 acceptance (Phase 2 exit):** with TWO real accounts on two machines
(or one machine + one scripted socket client): A publishes a Duo listing from the
Overwolf client → B's board shows it with a sensible Match Score → B's rank outside
the filter hides it (verify by tightening filters) → A enters champ select → B sees
the listing vanish (`board.delta remove`) within 3s → A's client killed hard → the
listing pauses within 90s. Filter engine has unit tests covering: every reason
string, duo legality edges (Emerald/Diamond boundary, Master), tier math, ARAM
skipping rank. Load sanity: 500 fake listings + 50 fake viewers script stays under
dev-key rate limits (all board reads hit snapshots, zero Riot calls).
