# LOBLY API

NestJS service for auth, Riot account linking, verified profiles, the listings board, join flow, session chat, reputation, and the `/sync` socket.

Full project setup, client apps, and the env table are in the [root README](../../README.md). This file is the API-only loop.

## Local setup

```bash
# from the repo root
cp apps/api/.env.example apps/api/.env
# set RIOT_API_KEY and the JWT / admin secrets

docker compose -f apps/api/docker-compose.yml up -d
npm install
npm run api:migration:run
npm run api:dev
```

Postgres is published on host port **5433**. Redis is on **6379**.

- Health: `GET http://localhost:8790/health`
- LCU path map: `GET http://localhost:8790/config/lcu-endpoints`
- Feature flags: `GET http://localhost:8790/config/flags`
- REST prefix: `/v1`
- Realtime: socket.io namespace `/sync`, JWT in `auth.token`

Do not run `npm run mock` while this process is up. The mock harness uses the same port.

## Scripts

From the repo root:

| Script | Purpose |
|---|---|
| `npm run api:dev` | Nest watch mode |
| `npm run api:build` | Compile |
| `npm run api:start` | Run `dist/main.js` |
| `npm run api:test` | Unit tests |
| `npm run api:migration:run` | Apply TypeORM migrations |
| `npm run api:migration:revert` | Roll back the last migration |

## Deploy

`Dockerfile` is the production image (Node 20). Run it with Postgres and Redis, set every required variable from `.env.example`, and apply migrations before serving traffic. `.github/workflows/api.yml` builds, tests, and migrates on pull requests. It does not deploy.
