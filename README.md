# LOBLY

LOBLY finds verified League of Legends teammates. A player opens a real League lobby, publishes it with filters (rank, role, language, voice), and other players on the same server request to join. Profiles come from Riot match data. When a creator accepts a request, LOBLY sends the League invite from the local client so neither player has to copy a Riot ID.

The product answers “who should I play with,” not “who am I already matched against.” Filters apply before queue. There is no opponent intel and no dodge tooling.

## What is in this repo

| Piece | Where | Role |
|---|---|---|
| Desktop client | `apps/desktop` | Electron app. This is the host used for local development. |
| Overwolf client | `apps/overwolf` | Same UI and logic, packaged as an Overwolf app. Needs a whitelisted Overwolf developer account to load. |
| Shared client | `packages/client-core` | Listing state machine, LCU gameflow tracker, sync agent, API client, and the React UI. Both hosts render this. |
| API | `apps/api` | NestJS API: auth, Riot linking, profiles, listings, join flow, chat, reputation, post-game. |
| Website | `apps/web` | Next.js landing page, Terms, and Privacy. |
| Shared contracts | `packages/shared-types` | DTOs, socket event names, queue and rank types. |
| Riot SDK | `packages/riot-client` | Riot Web API client, regional routing, rate limiter. The API key stays here, on the server. |
| LCU paths | `packages/lcu-endpoints` | Remote-versioned League client paths. The API serves them at `GET /config/lcu-endpoints`. |
| Mock API | `tools/mock-backend` | Early socket harness on port 8790. Use it only when the real API is not running. |
| LCU CLI | `tools/lcu-standalone` | Node CLI that talks to the League client and Riot directly. |

Korea (`kr`) is refused by the Riot client. A development Riot API key never ships inside either desktop host.

## Prerequisites

- Node.js 20 or newer
- Docker, for local Postgres and Redis
- League of Legends client, logged in, for anything that reads the lobby or signs in
- A [Riot development API key](https://developer.riotgames.com/)
- Overwolf, only if you are loading `apps/overwolf`

## First-time setup

From the repo root:

```bash
npm install
```

Create the API env file and put your own Riot key in `RIOT_API_KEY`. On PowerShell:

```powershell
Copy-Item apps\api\.env.example apps\api\.env
```

On macOS or Linux:

```bash
cp apps/api/.env.example apps/api/.env
```

`apps/api/.env.example` uses placeholders. Generate long random values for `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ADMIN_TOKEN` before you share a machine or a deploy.

Start Postgres and Redis. Postgres is published on host port **5433** so it does not collide with a local Postgres already bound to 5432.

```bash
docker compose -f apps/api/docker-compose.yml up -d
npm run api:migration:run
```

## Run the app

Use two terminals. Do not run `npm run mock` at the same time as the API. Both listen on port 8790.

**API**

```bash
npm run api:dev
```

- Health: `GET http://localhost:8790/health`
- REST: `http://localhost:8790/v1/...`
- Realtime: socket.io namespace `/sync`, JWT in `auth.token`

**Desktop client**

Leave the League client open and logged in, then:

```bash
npm run desktop:dev
```

That builds the renderer and the Electron main process, then launches the window. The default API is `http://localhost:8790`. Override it with `LOBLY_BACKEND_URL`.

Sign in from the gate with **Verify with League client**. The API asks you to change your profile icon to one it chooses, checks that change through the Riot API, then the client puts the original icon back. Email and password login is for admin and local testing. It runs only when `LOBLY_DEV_AUTH=1`.

```powershell
$env:LOBLY_DEV_AUTH = "1"
$env:LOBLY_BACKEND_URL = "http://localhost:8790"
npm run desktop:dev
```

Open DevTools for that window with `LOBLY_DEVTOOLS=1`.

## Scripts

All of these run from the repo root.

| Script | What it does |
|---|---|
| `npm run api:dev` | API in watch mode |
| `npm run api:build` | Compile the API |
| `npm run api:start` | Run the compiled API |
| `npm run api:test` | API unit tests |
| `npm run api:migration:run` | Apply TypeORM migrations |
| `npm run api:migration:revert` | Roll back the last migration |
| `npm run desktop:dev` | Build and launch the Electron app |
| `npm run desktop:build` | Build the Electron app without launching it |
| `npm run desktop:start` | Launch the last Electron build |
| `npm run desktop:pack` | Windows portable `.exe` in `apps/desktop/release` |
| `npm run desktop:pack:installer` | Windows NSIS installer |
| `npm run ow:dev` | Watch-build the Overwolf app into `apps/overwolf/dist` |
| `npm run ow:build` | One-shot Overwolf build |
| `npm run web:dev` | Landing site on port 3000 |
| `npm run web:build` | Production Next.js build, standalone output |
| `npm run mock` | Mock backend on port 8790 |
| `npm run lcu -- whoami` | LCU CLI. Replace `whoami` with any command below |
| `npm test --workspace @lobly/client-core` | Client-core unit tests |

Packaged builds bake the API URL in at pack time:

```powershell
$env:LOBLY_BACKEND_URL = "https://api.example.com"
npm run desktop:pack
```

## Desktop and Overwolf

Both hosts call `configureLoblyCore(...)` once at boot and then render `App` from `@lobly/client-core`. New screens, socket handlers, and listing rules go in `packages/client-core` unless they call `overwolf.*` or Electron IPC.

| | Electron (`apps/desktop`) | Overwolf (`apps/overwolf`) |
|---|---|---|
| League credentials | Lockfile, or the `LeagueClientUx.exe` command line | Overwolf launcher events (`lcu_info`), lockfile fallback |
| LCU HTTP | Node `https` | `fetch` from the extension page |
| LCU events | Node `ws` with the Basic auth header | Overwolf websocket API |
| Windows | One `BrowserWindow` | `background`, `desktop`, `notifications` |

The shared UI is a sidebar app:

- **Find Team** — live board for your platform
- **My Lobby** — the detected League lobby, publish and pause
- **Requests** — incoming and outgoing join requests
- **Session** — accepted premade, including chat
- **Profile** — verified rank, roles, champions, match history
- **Post-game** — recap and endorsements after a game
- **Settings** — languages, voice, accounts, diagnostics

### Overwolf load steps

1. `npm run ow:dev`
2. Overwolf → Settings → About → Development options → Load unpacked extension
3. Select `apps/overwolf/dist`
4. Start League. The manifest launches on the League client and the game.
5. Logs: `%localappdata%\Overwolf\Log\Apps\LOBLY`

`apps/overwolf/src/config.ts` points local builds at `http://localhost:8790`.

## Website

```bash
npm run web:dev
```

Pages: `/`, `/terms`, `/privacy`.

`NEXT_PUBLIC_LOBLY_DOWNLOAD_URL` sets the download button. It defaults to `https://download.lobly.gg/windows/latest`. `npm run web:build` emits a Next.js standalone server and flattens it so a host can start `.next/standalone/server.js`.

## API

Required env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `RIOT_API_KEY`.

The global prefix is `/v1`, except `GET /health`, `GET /config/*`, and `GET /static/*`. CORS reflects the request origin so the Overwolf extension origin works. Request bodies are validated and unknown fields are rejected.

| Area | Routes |
|---|---|
| Auth | `POST /v1/auth/register`, `/login`, `/refresh`, `/logout`, `/riot/challenge`, `/riot/verify` |
| Account | `DELETE /v1/users/me`, `POST /v1/riot-accounts/link`, `GET /v1/riot-accounts`, `DELETE /v1/riot-accounts/:id` |
| Profile | `GET /v1/profiles/me`, `GET /v1/profiles/:riotAccountId`, `GET /v1/profiles/:riotAccountId/matches`, `PUT /v1/prefs` |
| Listings | `GET /v1/listings/mine`, `POST /v1/listings`, `PATCH /v1/listings/:id`, `PATCH /v1/listings/:id/party`, `POST /v1/listings/:id/state` |
| Board | `GET /v1/board` |
| Join | `POST /v1/listings/:id/join`, `GET /v1/listings/:id/requests`, `GET /v1/join-requests/mine`, accept, decline, cancel, and `POST /v1/join-requests/:id/invite-result` |
| Session | `GET /v1/sessions/active`, `GET /v1/sessions/:id`, `GET /v1/sessions/:id/messages` |
| Trust | `POST /v1/blocks`, `DELETE /v1/blocks/:accountId`, `GET /v1/blocks`, `POST /v1/reports`, `POST /v1/sessions/:id/endorse` |
| Admin | `GET /v1/admin/reports`, `PATCH /v1/admin/reports/:id`, `GET /v1/admin/metrics/funnel` with `ADMIN_TOKEN` |
| Public config | `GET /health`, `GET /config/lcu-endpoints`, `GET /config/flags`, `GET /static/ddragon`, `GET /static/champions` |

Socket.io namespace `/sync` carries presence, listing state, board deltas, join requests, session and chat events, and `game.started` / `game.ended` / `postgame.ready`. Event names live in `packages/shared-types/src/socket-events.ts`.

`LOBLY_ALLOW_DEV_SOCKET=1` accepts a `dev-` token on the socket for local experiments. Leave it unset outside local development.

### Environment reference

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres URL. Local Docker uses port 5433. |
| `REDIS_URL` | yes | Redis for cache, presence, socket adapter, and BullMQ. |
| `JWT_SECRET` | yes | Access-token signing secret. |
| `JWT_REFRESH_SECRET` | yes | Refresh-token signing secret. |
| `RIOT_API_KEY` | yes | Riot development or production key. Server only. |
| `PORT` | no | API port. Default `8790`. |
| `ADMIN_TOKEN` | for admin routes | Bearer token for the moderation and funnel routes. |
| `ALLOWED_PLATFORMS` | no | Comma-separated platform ids. Empty means every platform except the hard `kr` block. |
| `RIOT_SHORT_MAX` / `RIOT_SHORT_WINDOW_MS` | no | Short Riot rate-limit bucket. Defaults follow the dev-key window. |
| `RIOT_LONG_MAX` / `RIOT_LONG_WINDOW_MS` | no | Long Riot rate-limit bucket. |
| `SEASON_START_EPOCH` | no | Unix seconds when the ranked season started. Default is 2025-04-01 UTC. |
| `CURRENT_SEASON` | no | Season label stored with profile snapshots. |
| `DUO_LEGALITY_JSON` | no | Override for duo rank-legality rules. |
| `CHAT_TTL_HOURS` | no | How long session chat is kept. Default 168. |
| `PROFILE_REFRESH_WAIT_MS` | no | How long a profile read waits for an in-flight refresh. Default 3000. |
| `FLAG_INVITE_AUTOMATION` | no | `false` disables automated League invites. Default on. |
| `FLAG_AUTO_ACCEPT` | no | `false` disables client auto-accept. Default on. |
| `FLAG_BOARD` | no | `false` hides the public board. Default on. |
| `FLAG_PARTY_SYNC` | no | `false` stops mirroring the League party onto the listing. Default on. |
| `FLAG_POSTGAME_LOOP` | no | `false` disables end-of-game refresh and endorsement prompts. Default on. |
| `FLAG_ORGANIC_ENDORSE` | no | `true` enables organic endorsements. Default off. |
| `FLAG_CLIENT_LOBBY_WATCH` | no | `false` disables the client lobby watch. Default on. |

Client-only variables:

| Variable | Where | Purpose |
|---|---|---|
| `LOBLY_BACKEND_URL` | Electron, and baked in by `desktop:pack` | API origin. Default `http://localhost:8790`. |
| `LOBLY_DEV_AUTH` | Electron | `1` enables the built-in email login. |
| `LOBLY_DEV_EMAIL` / `LOBLY_DEV_PASSWORD` | Electron, only with dev auth | Credentials for that login. |
| `LOBLY_DEVTOOLS` | Electron | `1` opens DevTools on launch. |
| `VITE_LOBLY_DEV_AUTH` | Overwolf build | `1` enables the same dev login in the extension. |
| `NEXT_PUBLIC_LOBLY_DOWNLOAD_URL` | Website | Download button target. |

## Tools

**Mock backend.** `npm run mock` speaks a smaller version of `/sync` for early client work. With it running, type `accept` in that terminal to emit `join.accepted`. Optional env for a scripted invite target: `LOBBY_TEST_SUMMONER_ID`, `LOBBY_TEST_GAME_NAME`, `LOBBY_TEST_TAG`.

**LCU CLI.** League client open, except `profile`, which only needs `RIOT_API_KEY` in `apps/api/.env`.

```bash
npm run lcu -- whoami
npm run lcu -- lobby
npm run lcu -- friends
npm run lcu -- invites
npm run lcu -- invite <summonerId>
npm run lcu -- accept <invitationId>
npm run lcu -- watch
npm run lcu -- profile euw1 Faker T1
```

`watch` streams gameflow and lobby changes. `profile` builds a verified card from Riot with no API process. Details: `tools/lcu-standalone/README.md`.

## Tests and CI

```bash
npm run api:test
npm test --workspace @lobly/client-core
```

GitHub Actions (`.github/workflows/api.yml`) runs on changes to `apps/api` and `packages`: install, `api:build`, `api:test`, and `api:migration:run` against Postgres 15 and Redis 7.

## Deploy

**API.** `apps/api/Dockerfile` is a Node 20 multi-stage build. The intended host is Railway with three services: this image, Postgres, and Redis. Set the required variables from the table above, then run migrations before serving traffic. The GitHub workflow checks the build. It does not deploy.

**Desktop.** `npm run desktop:pack` writes a portable Windows build. `npm run desktop:pack:installer` writes a one-click NSIS installer. Set `LOBLY_BACKEND_URL` in that shell so the package talks to the deployed API.

**Website.** `npm run web:build`. The standalone server is what a Node host such as Hostinger starts.

## Docs in this repo

The numbered files are the design history. When they disagree with the code, the code and this README win.

| File | What it is |
|---|---|
| `LOBLY_Product_Spec.md` | Product scope, MVP cut line, and later ideas |
| `LOBLY_Architecture.md` | Earlier architecture write-up |
| `00_BUILD_OVERVIEW.md` | Constraints that shaped the build (LCU certs, rate limits, Korea, dual host) |
| `01_PHASE_1_OVERWOLF_CLIENT.md` | Original Overwolf client plan |
| `02_PHASE_2_BACKEND.md` | Original API plan |
| `03_PHASE_3_INTEGRATION_LAUNCH.md` | Join flow, compliance, and the Electron host decision |
| `04_LOBBY_SYNC_AND_POSTGAME.md` | Party sync and end-of-game reputation design |
| `05_AUDIT_FIXES_AND_FEATURES.md` | Audit that drove Riot sign-in, socket auth, and the missing product flows |
| `SESSION_HANDOFF.md` | Bugs found while wiring the first live Electron loop, and why the code looks the way it does |
| `apps/api/README.md` | Short API setup notes |
| `apps/overwolf/SPIKE_RESULTS.md` | Early LCU spike notes |
| `tools/lcu-standalone/README.md` | CLI usage |

## Rules that are easy to break

- Put host-agnostic UI and sync logic in `packages/client-core`. Keep `overwolf.*` and Electron IPC inside the matching app.
- League client paths change. Add or edit them in `packages/lcu-endpoints/endpoints.json` instead of hard-coding a new path in a host.
- The LCU `puuid` is a local id. Riot identity is `gameName#tagLine`, and the API resolves the real PUUID with `account-v1`.
- Do not call `dispatchMachine({ type: "PHASE" })` from a host. Phase changes go through `gameFlowTracker`.
- Migrations are new files under `apps/api/src/database/migrations`. Do not edit a migration that has already run.
- The API webpack build externalizes `bcrypt`. Leave webpack enabled. Turning it off breaks the path-mapped workspace packages.
