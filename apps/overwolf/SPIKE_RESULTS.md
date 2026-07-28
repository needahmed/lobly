# LCU Access Spike Results (Milestone 2)

Run these from the desktop Dev HUD **LCU Lab** panel while the League client is
logged in. Fill in outcomes below. Do not commit real tokens or full PUUIDs.

| # | Test | Result (PASS / FAIL) | Notes |
|---|---|---|---|
| 1 | REST GET `/lol-summoner/v1/current-summoner` | _pending_ | Validates CEF accepts LCU self-signed cert (C2) |
| 2 | REST POST `/lol-lobby/v2/lobby/invitations` | _pending_ | Needs open lobby + second account summonerId |
| 3 | WebSocket A (`wss://riot:pass@host`) | _pending_ | Embedded credentials |
| 4 | WebSocket B (`wss://host` after REST) | _pending_ | Only if A fails |

## Decision

| Condition | Action |
|---|---|
| 1 & 2 pass | LCU REST is command/read path — proceed |
| 3 or 4 pass | Set `wsAvailable`; optional `WsEventBus` |
| 3 & 4 fail | Expected — GEP remains sole push channel |
| 1 fails (cert) | Escalate: GEP-only reads; manual invite fallback |

## Environment

- Date:
- Overwolf version:
- League client patch:
- Machine notes:
