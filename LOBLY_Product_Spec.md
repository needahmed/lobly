# LOBLY, Product and Feature Specification

Version 0.1 Draft, July 2026

LOBLY is an Overwolf companion app for League of Legends focused on lobbies and social matchmaking. Where Facecheck and Mobalytics answer "who am I playing with and against," LOBLY answers "who should I be playing with." Players create listed lobbies (duo, flex, clash, ARAM, custom games) and other verified players on the same server discover and join them through profile aware filters powered by real match data.

---

## 1. Core Concept

A LOBLY lobby is a listing layered on top of a real League lobby. The creator makes a League lobby as normal, LOBLY detects it through the local client API, and the creator publishes it to the LOBLY network with filters. Other players browse listings for their server, request to join if their verified profile matches the filters, and on acceptance LOBLY automates the League client invite so both players land in the same in game lobby with zero friend requests or name copying.

The key differentiator: every profile is verified from real Riot data, not self reported. A player claiming to be a Diamond support main is provably a Diamond support main.

---

## 2. User Accounts and Verified Profiles

### 2.1 Account creation and Riot account linking
* Sign in with email, Google, or Discord for the LOBLY account itself.
* Riot account linking happens automatically and passively: when the app runs alongside the League client, it reads the logged in summoner from the local client API. Because only the account owner can be logged into the client on that machine, this doubles as ownership proof. No RSO OAuth flow is required for MVP, though RSO is the long term upgrade path for web access without the client running.
* One LOBLY account can link multiple Riot accounts (smurfs), but each listing and join request is tied to exactly one Riot account, and the profile shown to others is that account only. No merging stats across accounts, since that would misrepresent skill.

### 2.2 Verified profile card
Automatically built and refreshed from the Riot API, shown wherever the player appears:
* Riot ID and tagline, server, profile icon, level.
* Current ranked tier and division for Solo/Duo and Flex, LP, wins and losses this season.
* Primary and secondary role, computed from the last 30 to 60 ranked games (position field in match data), not self declared.
* Top 5 most played champions this season with per champion win rate and KDA.
* Recent form: win rate over last 20 games, current streak.
* Activity signal: last time an online match was detected, average games per week.

### 2.3 Reputation layer (LOBLY native data)
* Post session endorsement flow: after a played together session ends, each participant can endorse the other on three axes: Good Comms, Good Teammate, Skilled. Modeled on honor, but scoped to LOBLY sessions so it cannot be farmed.
* Endorsement counts and a simple reliability score on the profile card.
* Reliability score derives from behavior inside LOBLY: showed up after accepting, did not abandon lobby before queue, completed the session. It is never derived from in game performance.
* Block list: blocked players never see your listings and you never see theirs.
* Report flow for harassment, slurs, or bait joins, feeding a moderation queue.

### 2.4 Player preferences (self declared, clearly labeled as such)
* Languages spoken.
* Voice preference: League voice, Discord, no voice.
* Vibe tags: Tryhard Climb, Chill, Learning, Off Meta, Content Creation.
* Availability windows (evenings, weekends) shown in local time per viewer.
* Discord tag reveal setting: hidden, revealed to accepted teammates, public.

---

## 3. Lobby System (The Heart of LOBLY)

### 3.1 Lobby types
* **Duo Finder**: Solo/Duo ranked. Enforces Riot duo rank restrictions automatically, so a listing from a Gold II player only shows join buttons to players inside the legal duo range.
* **Flex 5v5**: parties of 2 to 5.
* **Clash Team Finder**: recruit for upcoming Clash tournaments, with tier locked filtering and scheduled start time.
* **ARAM and Rotating Modes**: casual, minimal filters by default.
* **Custom Games**: 10 man in houses, scrims, tournament practice. Includes team draft helper and spectator slots.
* **Practice and Coaching**: 1v1 lane practice, coaching sessions, replay review pairs.

### 3.2 Creating a listing
Creation is a 20 second flow because most fields are auto filled from the detected League lobby:
* Queue type, party size, and open slots are read directly from the client, never typed manually.
* Title and optional short description (profanity filtered).
* Role slots: which roles are open. For a duo listing, the creator's own main role is pre filled from their profile and they pick which roles they want in a partner.
* Filters (see 3.3).
* Voice requirement toggle.
* Listing duration: auto expires after 15, 30, or 60 minutes, refreshable with one click.
* If the creator's League lobby closes or they enter champion select, the listing automatically pauses or delists. No ghost listings, ever. This is a hard product rule.

### 3.3 Filter engine
Filters are checked against verified data at join time, server side:
* **Rank range**: min and max tier or division. Duo listings additionally hard enforce Riot's own duo restrictions.
* **Role**: only players whose computed primary or secondary role matches an open role slot can request that slot. A player may request a slot for an off role, but the UI badges the request as Off Role so the creator decides.
* **Champion pool overlap** (optional): e.g. "looking for a hook support," creator selects champions or champion classes, matched against the requester's top played list.
* **Win rate floor** (optional, capped at a reasonable value to prevent toxic gatekeeping).
* **Minimum account level or games played this season** (smurf and bot filter).
* **Language** and **voice** requirements.
* **Reliability floor**: only players above a LOBLY reliability threshold.
* **Fresh lobby protection**: listings can exclude players the creator blocked or reported before.

### 3.4 Discovery and browsing
* Live listing board filtered to the viewer's server and shard, with search and sort (newest, best match, rank proximity, reliability).
* **Match Score**: every listing shows a personalized 0 to 100 compatibility score for the viewer, computed from rank proximity, role complementarity (their main synergizes with your main), champion synergy from aggregate win rate data, overlapping play hours, and language match. The board defaults to sorting by this score.
* Reverse discovery: "Players Looking" feed where solo players post an LFG card ("Plat jungle main, evenings, voice yes") and lobby creators invite them directly.
* Saved searches with notifications: "alert me when an Emerald+ ADC duo listing appears on EUW."
* Quick filters as one tap chips: My Rank Range, Voice, My Language, High Reliability.

### 3.5 Join flow
1. Player taps Request to Join on a listing (choosing a role slot where relevant).
2. Creator sees the requester's full verified profile card and Match Score, then accepts or declines. Optional Instant Join mode lets qualifying players skip approval.
3. On acceptance, LOBLY automates the League invite through the local client API on the creator's machine: the requester's Riot ID is added and invited automatically. The requester's client pops the standard League invite and the requester's LOBLY app can auto accept it with their permission.
4. Both apps confirm through the local client API that both players are in the same League lobby, then the LOBLY session switches to Active and the listing slot closes.
5. If the invite is not accepted within 90 seconds, the slot reopens and the no show is logged against reliability.

### 3.6 In session experience
* Session chat room (text) between LOBLY matched players, active from acceptance until 10 minutes post game, so players can coordinate before the friend invite lands and debrief afterward.
* One click Discord: creator can attach a Discord invite revealed only to accepted members.
* Session persistence: after a game ends, "Queue Again" keeps the group and listing state, "Reopen Slot" relists if someone leaves.
* Duo streak tracker: games played, won, and lost with this specific partner, all time.

### 3.7 Post session
* Endorsement prompt (see 2.3).
* Add to Partners: a favorites list. Partners see when you are online in the client and can send direct duo invites through LOBLY.
* Session history: every LOBLY session with who, what queue, and results pulled from match history.

---

## 4. Companion Features (Table Stakes for the Category)

These make LOBLY usable as a primary companion so users do not need a second app running:

* **Champion select insights (lite)**: when a match starts from a LOBLY session, show the standard pregame view: teammates' and opponents' ranks, win rates, and main champions, sourced from the Riot API. Scoped intentionally lighter than Mobalytics; LOBLY is not trying to win the analytics war.
* **Build import**: recommended runes and items importable into the client through the local client API, sourced from an aggregate data provider or own pipeline.
* **Post game summary**: result, KDA, CS, damage share, tied into the duo streak tracker so partner synergy stats accumulate.
* **Overlay (optional, off by default)**: second screen window rather than intrusive in game overlay for MVP. Complies with Overwolf's rule against overlays that appear during active gameplay.

---

## 5. Social and Community Layer

* **Partner network**: your roster of past teammates, sortable by win rate together.
* **Communities**: persistent groups (a university club, a Discord server's LoL wing, Pakistan LoL community, etc.) with private listing boards visible only to members. This is a strong retention hook and monetization surface.
* **Scheduled lobbies**: create a listing for a future time ("Clash practice, Saturday 9 PM PKT"), players RSVP, LOBLY sends reminders and opens the live lobby link when it starts.
* **Leaderboards**: most reliable players, best duo pairs by win rate, most endorsed, per server and per community.
* **Profile sharing**: public web profile page (lobly.gg/player/RiotID) that works without the app, doubling as an acquisition channel.

---

## 6. Trust, Safety, and Fair Play

* All filter enforcement is server side; the client is never trusted.
* No filters on anything Riot would consider discriminatory or that encourage queue dodging. Filters gate who joins your premade before queue, never provide information designed to dodge a matchmade game. This distinction is critical for both Overwolf and Riot approval.
* Rate limits on join requests and listing creation to prevent spam.
* New account friction: accounts under a minimum League level or with no ranked history get a Provisional badge and cannot Instant Join.
* Moderation dashboard, automated slur filtering in titles and chat, escalating penalties (warning, listing ban, account ban).
* GDPR style data deletion: unlink Riot account and purge derived data on request.

---

## 7. Monetization (Post MVP)

* **LOBLY Plus subscription**: unlimited saved search alerts, listing pinning and boosted visibility, advanced filters (champion pool overlap, win rate floor), extended session history, ad free.
* Overwolf ad framework in free tier (non intrusive placements per Overwolf compliance rules).
* Community tier: paid features for community owners (custom branding, larger member caps, tournament tools).
* No pay to bypass filters or reliability requirements, ever. Trust features are never for sale.

---

## 8. MVP Cut Line

**In MVP:**
Riot account linking via client detection, verified profile cards, Duo Finder and Flex and ARAM listing types, filter engine (rank, role, language, voice), listing board with Match Score v1 (rank + role + language only), join flow with invite automation, session chat, endorsements and reliability v1, block and report.

**Post MVP:**
Clash finder, custom game tools, communities, scheduled lobbies, reverse discovery feed, champion select insights, build import, leaderboards, web profiles, RSO login, LOBLY Plus.

---

## 9. Success Metrics

* Time from opening app to sitting in a full League lobby (target under 3 minutes median).
* Fill rate: percentage of listings that reach a completed session.
* No show rate on accepted joins (target under 10 percent).
* D7 retention and repeat session rate with the same partner (the real product magic metric: are people finding actual duo partners, not just one game fills).
