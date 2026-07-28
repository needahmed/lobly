# LOBLY

Overwolf companion app for League of Legends — verified teammates, real lobbies, automated invites.

This repo is a monorepo. **Phase 1** delivers the Overwolf client foundation; **Phase 2** is the NestJS cloud API (auth, Riot linking, verified profiles, listings board, realtime `/sync`).

## Prerequisites

- Node 20+
- [Overwolf](https://www.overwolf.com/) desktop client
- Whitelisted Overwolf developer account (Milestone 0 — see `01_PHASE_1_OVERWOLF_CLIENT.md`)
- League of Legends client (for live GEP/LCU testing)

## Install

```bash
npm install
```

## Dev loop

Terminal A — Vite watch build (outputs to `apps/overwolf/dist`):

```bash
npm run ow:dev
```

Terminal B — mock backend (port 8790):

```bash
npm run mock
```

Then in Overwolf:

1. Settings → About → **Development options** → Load unpacked extension
2. Select `apps/overwolf/dist`
3. Start the League client — the app auto-starts via `launch_events`
4. Right-click the app window → Inspect for CEF DevTools
5. Logs: `%localappdata%\Overwolf\Log\Apps\LOBLY`

One-shot production-shaped build:

```bash
npm run ow:build
```

## Phase 1 Dev HUD

The desktop window is a three-column developer HUD (not product UI):

1. **Connection** — LCU status, summoner, GEP features, gameflow, queueId
2. **Listing machine** — Publish / Unpublish / simulate events
3. **Log + LCU Lab** — spike buttons for REST/WebSocket access tests

Record spike outcomes in `apps/overwolf/SPIKE_RESULTS.md`.

### Mock backend REPL

With `npm run mock` running, type `accept` in that terminal to emit `join.accepted` to all connected clients (triggers a real LCU invite when credentials are live):

```bash
set LOBBY_TEST_SUMMONER_ID=123456789
set LOBBY_TEST_GAME_NAME=Partner
set LOBBY_TEST_TAG=EUW
npm run mock
```

## Phase 2 API

```bash
cp apps/api/.env.example apps/api/.env   # set RIOT_API_KEY + secrets
cd apps/api && docker compose up -d && cd ../..
npm run api:migration:run
npm run api:dev
```

- Health: `GET http://localhost:8790/health`
- REST: `/v1/*` (auth, riot-accounts, profiles, listings, board)
- Socket.io: namespace `/sync` with JWT in `auth.token`
- Details: `apps/api/README.md`

Point the Overwolf client at the real API (same port as the mock) by running `api:dev` instead of `mock`.

## Layout

```
apps/overwolf/          Overwolf Native app (React + TS + Vite)
apps/api/               Phase 2 — NestJS backend
apps/web/               Phase 3 — landing / ToS / privacy
packages/shared-types/  Cross-boundary enums & DTOs
packages/riot-client/   Riot Web API SDK + rate limiter
packages/lcu-endpoints/ Remote-versioned LCU path map
tools/mock-backend/     Phase 1 express + socket.io harness
```

## Docs

| File | Purpose |
|---|---|
| `00_BUILD_OVERVIEW.md` | Master context, constraints, API reference |
| `01_PHASE_1_OVERWOLF_CLIENT.md` | This phase — build checklist |
| `02_PHASE_2_BACKEND.md` | NestJS backend |
| `03_PHASE_3_INTEGRATION_LAUNCH.md` | E2E join flow + submission |

## Compliance (Milestone 0)

Before / while coding:

1. Submit the Overwolf app proposal (social matchmaking / premade team building; no opponent intel, no dodge tools).
2. Register on the Riot developer portal for a development API key (used in Phase 2).
