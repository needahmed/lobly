import { discoverCredentials } from "./lockfile.mjs";
import { LcuClient, ENDPOINTS } from "./lcuClient.mjs";
import { fetchVerifiedProfile } from "./riotProfile.mjs";

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function usage() {
  console.log(`LOBLY standalone harness — proves out the LCU + Riot API core without Overwolf.

Usage:
  node src/cli.mjs whoami                                 Show the logged-in summoner
  node src/cli.mjs lobby                                   Show the current lobby
  node src/cli.mjs friends                                 List friends with their summonerId (use this to find who to invite)
  node src/cli.mjs invites                                 List pending received invitations
  node src/cli.mjs invite <summonerId>                     Send a lobby invite (the core LOBLY mechanic)
  node src/cli.mjs accept <invitationId>                   Accept a pending invitation
  node src/cli.mjs watch                                   Live-stream gameflow phase + lobby changes over WS
  node src/cli.mjs profile <platform> <riotId> <tagLine>   Build a verified profile from real Riot match data

Examples:
  node src/cli.mjs whoami
  node src/cli.mjs profile euw1 Faker T1
  node src/cli.mjs invite 3106004487710176
`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    usage();
    return;
  }

  if (cmd === "profile") {
    const [platform, riotId, tagLine] = args;
    if (!platform || !riotId || !tagLine) {
      console.error("Usage: node src/cli.mjs profile <platform> <riotId> <tagLine>");
      process.exit(1);
    }
    await fetchVerifiedProfile(platform, riotId, tagLine);
    return;
  }

  const creds = discoverCredentials();
  log(`LCU credentials found via ${creds.source} (port ${creds.port})`);
  const client = new LcuClient(creds);

  switch (cmd) {
    case "whoami": {
      const s = await client.request(
        ENDPOINTS.currentSummoner.method,
        ENDPOINTS.currentSummoner.path
      );
      if (!s) {
        console.log("No summoner data — is the client logged in?");
        break;
      }
      console.log({
        riotId: `${s.gameName ?? s.displayName ?? "?"}#${s.tagLine ?? ""}`,
        puuid: s.puuid,
        summonerId: s.summonerId,
        platform: s.platformId ?? "?",
        level: s.summonerLevel,
      });
      break;
    }

    case "lobby": {
      const l = await client.request(ENDPOINTS.lobby.method, ENDPOINTS.lobby.path);
      console.log(l ? JSON.stringify(l, null, 2) : "No lobby open right now.");
      break;
    }

    case "friends": {
      const friends = (await client.request(ENDPOINTS.friends.method, ENDPOINTS.friends.path)) ?? [];
      if (!friends.length) {
        console.log("No friends found. Add the person you want to invite as a League friend first.");
        break;
      }
      console.log("Friends (look for the one you want to invite, then use its summonerId with `invite`):\n");
      for (const f of friends) {
        // Field names have drifted across client versions, so print both the
        // friendly summary and the raw object — whichever key holds the
        // numeric id, it's visible below.
        console.log(`${f.gameName ?? f.name ?? "?"}#${f.gameTag ?? f.tagLine ?? ""}`, {
          summonerId: f.summonerId,
          puuid: f.puuid ?? f.pid,
          raw: f,
        });
      }
      break;
    }

    case "invites": {
      const invites =
        (await client.request(
          ENDPOINTS.receivedInvitations.method,
          ENDPOINTS.receivedInvitations.path
        )) ?? [];
      console.log(invites.length ? invites : "No pending invitations.");
      break;
    }

    case "invite": {
      const summonerId = Number(args[0]);
      if (!summonerId) {
        console.error("Usage: node src/cli.mjs invite <summonerId>");
        process.exit(1);
      }
      await client.request(ENDPOINTS.sendInvite.method, ENDPOINTS.sendInvite.path, [
        { toSummonerId: summonerId },
      ]);
      log(`Invite sent to summonerId ${summonerId} — this is the exact call LOBLY's`);
      log(`invite-automation step makes on join.accepted (Phase 3 §1.2 step 3).`);
      break;
    }

    case "accept": {
      const invitationId = args[0];
      if (!invitationId) {
        console.error("Usage: node src/cli.mjs accept <invitationId>");
        process.exit(1);
      }
      await client.request(
        ENDPOINTS.acceptInvitation.method,
        ENDPOINTS.acceptInvitation.path(invitationId)
      );
      log(`Accepted invitation ${invitationId}.`);
      break;
    }

    case "watch": {
      log("Watching gameflow phase + lobby changes over the LCU WebSocket.");
      log("(This is the WS path from the Phase 1 spike — Ctrl+C to quit.)");
      client.connectEvents(
        (name, evt) => {
          if (name.includes("gameflow-phase")) {
            log(`phase -> ${evt.data}`);
          } else if (name.includes("lol-lobby_v2_lobby")) {
            const d = evt.data;
            log(
              `lobby -> queueId=${d?.gameConfig?.queueId ?? "?"} members=${d?.members?.length ?? 0}`
            );
          } else if (name.includes("received-invitations")) {
            log(`received-invitations -> ${JSON.stringify(evt.data)}`);
          } else {
            log(`${name} -> ${evt.eventType}`);
          }
        },
        { onOpen: () => log("WS connected + subscribed") }
      );
      process.stdin.resume(); // keep the process alive until Ctrl+C
      break;
    }

    default:
      usage();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
