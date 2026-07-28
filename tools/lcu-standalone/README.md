# LOBLY Standalone Harness (No Overwolf Required)

This is a plain Node CLI that exercises the exact same LCU calls and Riot Web
API calls the real app makes, without needing an Overwolf whitelist. It exists
to break the Overwolf-whitelist ⇄ Riot-production-key chicken-and-egg loop:
you can record a working-prototype demo for Riot's production key application
and for Overwolf's DevRel team using this tool alone.

It is a **dev/demo tool only** — it disables TLS verification against
`127.0.0.1` (the LCU's self-signed cert) and reads Riot's key from
`apps/api/.env`. Never reuse this pattern outside localhost.

## Setup

```bash
cd tools/lcu-standalone
npm install
```

## Commands

Run these with the League client open and logged in (except `profile`, which
only needs a Riot API key and works with the League client closed):

```bash
node src/cli.mjs whoami
```
Confirms LCU discovery + auth works (proves C2 — self-signed cert handling).

```bash
node src/cli.mjs lobby
```
Shows the current lobby (queue id, members) — same data the client-side
listing state machine reads to auto-fill a listing.

```bash
node src/cli.mjs watch
```
Opens the LCU WebSocket with a real `Authorization` header (something a
browser `WebSocket` cannot do — see `00_BUILD_OVERVIEW.md` C13) and
live-streams gameflow phase + lobby changes as you create/leave a lobby or
enter champ select. Leave this running while you play with the client to
show the full state machine driving live.

```bash
node src/cli.mjs invite <summonerId>
```
Fires a real lobby invitation — the exact call LOBLY's invite-automation step
makes (`Phase 3 §1.2` step 3). Needs an open lobby with a free slot and a
second account's `summonerId` (get it by running `whoami` on that account, or
from the `card` payload once the backend is wired up).

```bash
node src/cli.mjs invites
node src/cli.mjs accept <invitationId>
```
Lists/accepts pending invitations — the requester side of the same flow.

```bash
node src/cli.mjs profile euw1 Faker T1
```
Builds a verified profile card (rank, primary/secondary role, top champions,
recent form) directly from the Riot Web API using your personal/dev key —
the same computation `apps/api/src/modules/profile/profile-compute.ts` does,
run standalone. Works without the League client running at all.

## Recording the demo for Riot + Overwolf

A convincing "working prototype" recording, in order:

1. `whoami` — show LCU auth succeeding live.
2. `profile <platform> <riotId> <tagLine>` on your own account — show a real,
   non-self-reported profile card built from live match data.
3. Open a League lobby (ARAM or Duo) → `watch` in one terminal → change queue
   type / enter champ select in the client → show the phase events streaming.
4. With a second account/machine, run `invite <theirSummonerId>` → show the
   League invite popping on their client. That's the full loop: verified
   profile → lobby detection → automated invite, with zero Overwolf
   involvement.

If you only have one machine/account, steps 1–3 alone are still a legitimate
"working prototype" for Riot's application (their FAQ explicitly allows
submitting during the planning stage — approval, not submission, is what
waits on a complete product).
