# LOBLY, Technical Architecture

Version 0.1 Draft, July 2026

---

## 1. System Overview

LOBLY has three planes:

1. **Client plane**: the Overwolf app on the player's machine. It is the only component that can touch the LCU (League Client Update local API), so anything involving the live lobby, invites, or logged in summoner detection lives here.
2. **Backend plane**: LOBLY's cloud services. Owns all listings, matchmaking logic, profiles, chat, reputation, and every Riot Web API call (the API key must never ship in the client).
3. **Data plane**: Riot Web API (cloud), LCU API (local), Overwolf GEP events (local), Data Dragon and CommunityDragon static assets.

```
┌─────────────────────────────── Player Machine ───────────────────────────────┐
│                                                                              │
│  League Client (LCU)  ◄──── localhost REST + WSS ────┐                       │
│    lockfile / process args (port + token)            │                       │
│                                                      │                       │
│  League Game (live client, port 2999) ◄──────────────┤                       │
│                                                      │                       │
│  ┌──────────────────── Overwolf App: LOBLY ──────────┴────────┐              │
│  │  UI windows (React)                                        │              │
│  │  Background controller (persistent)                        │              │
│  │    • LCU connector (lockfile watch, WSS subscribe)         │              │
│  │    • GEP listener (launcher + in game events)              │              │
│  │    • Invite automator                                      │              │
│  │    • State sync agent  ────────── WSS + HTTPS ─────────────┼──────┐       │
│  └────────────────────────────────────────────────────────────┘      │       │
└──────────────────────────────────────────────────────────────────────┼───────┘
                                                                       │
                              ┌────────────────────────────────────────┴─────┐
                              │              LOBLY Backend (cloud)           │
                              │  API Gateway (REST) + Realtime Gateway (WSS) │
                              │  ┌───────────┐ ┌──────────┐ ┌─────────────┐  │
                              │  │ Identity  │ │  Lobby   │ │  Profile /  │  │
                              │  │  Service  │ │ Service  │ │ Stats Svc   │  │
                              │  └───────────┘ └──────────┘ └──────┬──────┘  │
                              │  ┌───────────┐ ┌──────────┐        │         │
                              │  │   Chat    │ │Reputation│   Riot API       │
                              │  │  Service  │ │ Service  │   Ingestor ──────┼──► Riot Web API
                              │  └───────────┘ └──────────┘   (rate limited) │
                              │  PostgreSQL · Redis · Object storage · Queue │
                              └──────────────────────────────────────────────┘
```

---

## 2. Client Plane (Overwolf App)

### 2.1 Framework choice
Overwolf offers two frameworks: Overwolf Native (CEF based, manifest.json driven) and Overwolf Electron (ow-electron). Recommendation: **Overwolf Native** for MVP. It is the path Porofessor, Facecheck, and Mobalytics use, its GEP integration is first class, and Appstore distribution expectations are built around it. React + TypeScript + Vite inside Overwolf windows; note Overwolf's warning that some UI kits misbehave in non native windows, so keep to plain React with your own components or Radix primitives, and test clicks early.

### 2.2 Window layout
Overwolf requires at least one visible window (background only apps are not approved):
* `background`: invisible controller, owns all connections and state. Single source of truth on the client. Started via launch_events on League launch.
* `desktop`: main window (listing board, profile, lobby management). Usable without League running, in browse only mode.
* `notifications`: small toast window for join requests and invite events.
* `second_screen` (post MVP): companion window during champion select and game.

Manifest declares `game_targeting` for League of Legends (class id 5426) and the launcher (10902), permissions kept minimal (GameInfo, Hotkeys, notifications), `launch_events` on launcher start.

### 2.3 LCU connector module
The core client capability. Responsibilities:

* **Discovery**: obtain port and auth token, preferring the process argument method (`--app-port=`, `--remoting-auth-token=` from LeagueClientUx process command line) with the lockfile as fallback, since install paths vary. Overwolf's launcher info events can also expose this. Re run discovery on client restart; the port and password rotate every launch.
* **Auth and TLS**: HTTP Basic with username `riot`, self signed cert handled by trusting Riot's published root certificate, never by blanket TLS disable.
* **WSS subscription**: connect to the LCU WebSocket and subscribe to events rather than polling. Key subscriptions:
  * `/lol-summoner/v1/current-summoner`: identity of the logged in player (Riot ID, PUUID). Sent to backend for passive account verification.
  * `/lol-gameflow/v1/gameflow-phase`: Lobby, Matchmaking, ChampSelect, InProgress, EndOfGame. Drives the listing state machine.
  * `/lol-lobby/v2/lobby`: current lobby composition, queue id, open slots. Auto fills listing creation and detects when slots change.
  * `/lol-lobby/v2/lobby/members`: to confirm a matched player actually arrived.
* **Command endpoints** (used only on explicit user action):
  * Invite flow: resolve the accepted requester's Riot ID to a summoner, then POST to the lobby invitations endpoint to fire the in client invite.
  * On the requester's side, with prior opt in, accept the incoming invitation via the pending invitations endpoint.
* **Resilience rules**: every LCU call goes through a thin wrapper with retry, and every feature degrades gracefully to a manual fallback (copyable Riot ID + "invite manually" instructions) because the LCU is unsupported and endpoints can change or vanish on any patch. Endpoint paths live in a remotely configurable JSON so a Riot patch can be hotfixed server side without shipping a new OPK.

### 2.4 GEP listener
Overwolf's Game Events Provider supplements the LCU:
* Launcher events: `lobby_info` (queue id, player_info with PUUID), `champ_select`. Useful redundancy if an LCU endpoint breaks.
* In game events: `matchState`, `kill`, live_client_data. MVP only needs match start and end to drive session state and trigger the post game endorsement prompt. Register via `setRequiredFeatures` from the background controller only, after success callback.

### 2.5 State sync agent
* Maintains one authenticated WSS connection to the LOBLY Realtime Gateway.
* Uplink: gameflow phase changes, lobby composition changes, invite confirmations, heartbeat every 30 seconds.
* Downlink: join requests, acceptance events, chat messages, listing state changes.
* All writes are optimistic locally with server reconciliation; the server remains authoritative on listing state.

### 2.6 Client state machine (listing lifecycle)

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

The transition into PAUSED on ChampSelect is enforced client side and verified server side (missed heartbeat or stale phase also pauses). This guarantees the "no ghost listings" product rule.

---

## 3. Backend Plane

### 3.1 Stack recommendation
Plays to your existing strengths and is genuinely well suited:
* **NestJS (Node, TypeScript)** monorepo with modular services. Start as a modular monolith, split later only if needed.
* **PostgreSQL** as primary store.
* **Redis** for listing board cache, presence, rate limiting, and pub/sub fan out to WSS gateways.
* **BullMQ** (Redis backed) for the Riot ingestion job queue.
* **WSS gateway** via NestJS gateways (socket.io or ws) with Redis adapter for horizontal scale.
* Deploy on Railway or Fly.io for MVP (you already know Railway from OTP Inbox), move to AWS if scale demands.

### 3.2 Services (modules)

**Identity Service**
* LOBLY auth (email, Google, Discord OAuth), JWT access + refresh tokens.
* Riot account linking: client submits the current summoner PUUID observed from the LCU; server validates it exists via Riot API and binds it. A periodic re observation check keeps links honest. RSO OAuth is the post MVP replacement and the only path Riot fully blesses for web only login.

**Profile and Stats Service**
* Owns verified profile cards. Data model: `riot_accounts`, `profile_snapshots`, `champion_stats`, `role_distribution`.
* Computes primary role from position fields across recent ranked matches, champion pools, form, and activity.
* Serves cached snapshots; freshness policy in section 4.

**Lobby Service**
* CRUD for listings, the authoritative listing state machine, filter evaluation, Match Score computation, join request workflow, slot management, expiry sweeper (Redis TTL + cron reconciliation).
* Filter evaluation is pure server side against stored verified snapshots, so a tampered client cannot bypass anything.
* Emits domain events (`listing.created`, `join.requested`, `join.accepted`, `session.started`) onto Redis pub/sub for realtime fan out.

**Chat Service**
* Ephemeral session rooms keyed by session id, message retention 7 days, profanity filter pipeline, rate limits per user.

**Reputation Service**
* Endorsements, reliability ledger (append only events: accepted, showed, no_show, abandoned, completed), score computation, block lists, report queue.

**Riot API Ingestor**
* The only component holding the Riot production API key.
* Centralized token bucket rate limiter honoring per method and per region limits, priority queue (interactive profile lookups outrank background refreshes).
* Endpoints used: Account v1 (Riot ID ↔ PUUID), Summoner v4, League v4 (ranked entries), Match v5 (ids + match detail), Champion Mastery v4, Spectator v5 (optional, to verify a session actually started).
* Match v5 note: match data is served from regional routing values (americas, europe, asia, sea), so the ingestor maps each platform shard to its routing region.

### 3.3 Data model core (simplified)

```
users(id, email, auth_provider, created_at)
riot_accounts(id, user_id, puuid, riot_id, tag_line, platform, verified_at)
profile_snapshots(riot_account_id, tier, division, lp, wins, losses,
                  primary_role, secondary_role, form_wr20, refreshed_at)
champion_stats(riot_account_id, champion_id, games, wr, kda, season)
listings(id, creator_account_id, queue_id, type, title, status,
         filters_jsonb, slots_jsonb, expires_at, created_at)
join_requests(id, listing_id, requester_account_id, role_slot,
              status, match_score, created_at)
sessions(id, listing_id, member_ids[], league_lobby_confirmed_at,
         games_played, ended_at)
endorsements(session_id, from_id, to_id, kind)
reliability_events(account_id, session_id, kind, at)
blocks(blocker_id, blocked_id)
```

### 3.4 Realtime topology
* Client WSS connections terminate at gateway instances; Redis pub/sub bridges instances.
* Listing board updates are region sharded channels (`board:euw`, `board:eun`, ...) with server side filter pre application, so clients only receive listings they could theoretically join. Cuts bandwidth and prevents data scraping of ineligible players.
* Presence: Redis keys with TTL refreshed by heartbeat; missed heartbeats pause the user's listings.

---

## 4. Data Freshness and Rate Limit Strategy

The Riot API rate limit is the scarcest resource in this system. Budget it deliberately:

* **Tiered freshness**: profile snapshot considered fresh for 6 hours for browsing, but re verified on demand at two hot moments: when a player publishes a listing and when a join request is opened by a creator. Those two lookups are what filters and decisions actually depend on.
* **Event driven refresh beats polling**: the client tells the backend "my game just ended" (GEP/LCU event), and only then does the ingestor pull the new match. Zero blind polling of match history.
* **Delta ingestion**: Match v5 match id list with a `startTime` cursor per account, fetch only unseen matches.
* **Cache Data Dragon** (champions, items, queue ids) in the backend and ship a versioned bundle to clients; never hit it per request.
* **Development reality**: a dev key allows small scale testing only; the beta waitlist should be gated until a production key is granted, because a public launch on a dev key will both throttle and violate policy.

---

## 5. Security Model

* Riot API key: backend only, in a secret manager, one product per key per Riot policy.
* Client → backend auth: short lived JWTs; WSS auth on connect and on token refresh.
* All filter checks, join eligibility, duo rank legality, and reliability gating are computed server side from server stored snapshots.
* LCU credentials (local port and token) never leave the machine; they are process local secrets.
* Anti abuse: rate limits per user and per IP on listing creation, join requests, chat; anomaly flags on accounts mass requesting joins.
* Overwolf OPK submission requires a clean VirusTotal scan; keep third party binaries out of the package.
* PII minimalism: store PUUIDs and Riot IDs, no real names; Discord tags only with explicit reveal consent; full purge endpoint for account deletion.

---

## 6. Approval and Compliance Path (Do This Before Writing Much Code)

Order of operations matters here:

1. **Overwolf app proposal** first. Overwolf whitelists app ideas before development, and without a whitelisted developer account you cannot even sideload unreleased apps for testing. Frame LOBLY as social matchmaking and premade team building; explicitly address their rule that apps must not encourage queue dodging or player discrimination (LOBLY filters gate premade formation before queue, never provide dodge intel on matchmade opponents).
2. **Riot developer portal registration** with a personal/dev key immediately for development.
3. **Riot LCU usage notification**: Riot requires being told before releasing any app using the League Client API in any region, and only endpoints on their approved list may be used. Submit the exact endpoint list (current summoner, gameflow phase, lobby read, lobby invitations). Note Korea is excluded from LCU apps entirely, so LOBLY must region gate KR.
4. **Riot production key application** once a working prototype and website with ToS and privacy policy exist (both are required for approval; the app must be hosted on a domain you own).
5. **Overwolf QA submission** of the OPK when MVP is ready.

---

## 7. Suggested Repo and Delivery Structure

```
lobly/
├─ apps/
│  ├─ overwolf/          # Overwolf Native app (React + TS + Vite)
│  │  ├─ manifest.json
│  │  ├─ windows/        # background, desktop, notifications
│  │  └─ modules/        # lcu-connector, gep-listener, sync-agent
│  ├─ api/               # NestJS backend
│  └─ web/               # Next.js: landing, ToS, privacy, public profiles
├─ packages/
│  ├─ shared-types/      # DTOs, listing state machine types
│  ├─ lcu-endpoints/     # remotely versioned endpoint map
│  └─ riot-client/       # ingestor SDK w/ rate limiter
└─ infra/                # IaC, CI (OPK build + VirusTotal check)
```

Build order: (1) LCU connector spike proving lockfile/process discovery, gameflow subscription, and programmatic invite on your own two accounts, (2) backend identity + profiles + ingestor, (3) listing board + join flow end to end, (4) chat + reputation, (5) polish, compliance docs, submissions.

---

## 8. Key Technical Risks

| Risk | Severity | Mitigation |
|---|---|---|
| LCU endpoints change without notice on any patch | High | Remote endpoint config, graceful manual fallbacks, integration test suite run on every League patch day |
| Riot production key rejected or delayed | High | Design works read only from LCU with zero Riot Web API as absolute fallback (degraded profiles); apply early with polished prototype |
| Invite automation judged too aggressive by Riot | Medium | Keep it strictly user initiated, one invite per explicit acceptance; manual copy Riot ID fallback always present |
| Rate limit exhaustion at scale | Medium | Event driven ingestion, tiered freshness, priority queue, request coalescing |
| Cold start network effect (empty board) | High (product) | Launch one server at a time, seed via community partnerships and Discord servers, reverse LFG feed lowers listing dependence |
| Overwolf performance complaints | Low | Native framework discipline, background window does no rendering, throttle board updates |
