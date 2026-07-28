# LOBLY API (Phase 2)

NestJS modular monolith: auth, Riot linking, verified profiles, listings + board, realtime `/sync`.

## Local setup

```bash
# from repo root
cp apps/api/.env.example apps/api/.env
# put your Riot dev key in RIOT_API_KEY

cd apps/api
docker compose up -d          # postgres + redis
cd ../..
npm install
npm run api:migration:run
npm run api:dev
```

Health: `GET http://localhost:8790/health`  
LCU endpoints: `GET http://localhost:8790/config/lcu-endpoints`  
REST prefix: `/v1/*`  
Realtime: socket.io namespace `/sync` with `auth.token` = JWT access token

## Scripts (repo root)

| Script | Purpose |
|---|---|
| `npm run api:dev` | Nest watch mode |
| `npm run api:build` | Compile |
| `npm run api:test` | Unit tests (filter engine) |
| `npm run api:migration:run` | Apply TypeORM migrations |

## Deploy (Railway)

Three services: `api` (this Dockerfile), Postgres plugin, Redis plugin. Set the required env vars from `.env.example`. CI on `main`: lint → build → migrate → deploy.
