import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_TO_REGION = {
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  jp1: "asia",
  kr: "asia", // blocked at product level per 00_BUILD_OVERVIEW.md C4 — fine to read here for a demo, never ship
  oc1: "sea",
  sg2: "sea",
  tw2: "sea",
  vn2: "sea",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadApiKey() {
  if (process.env.RIOT_API_KEY) return process.env.RIOT_API_KEY;
  // Fall back to apps/api/.env so you don't have to duplicate the key.
  const envPath = path.resolve(__dirname, "../../../apps/api/.env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    const match = raw.match(/^RIOT_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env, fine */
  }
  throw new Error(
    "No Riot API key found. Set RIOT_API_KEY env var or apps/api/.env."
  );
}

async function riotGet(host, urlPath, apiKey) {
  const res = await fetch(`https://${host}.api.riotgames.com${urlPath}`, {
    headers: { "X-Riot-Token": apiKey },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
    console.warn(`[riot] 429, waiting ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return riotGet(host, urlPath, apiKey);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Riot ${res.status} on ${urlPath}: ${body}`);
  }
  return res.json();
}

const ROLE_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

/**
 * Builds a lightweight verified profile card straight from Riot Web API
 * calls — no LOBLY backend required. This is the standalone equivalent of
 * apps/api/src/modules/profile/profile-compute.ts, trimmed for a live demo.
 */
export async function fetchVerifiedProfile(platform, gameName, tagLine) {
  const region = PLATFORM_TO_REGION[platform];
  if (!region) throw new Error(`Unknown platform "${platform}"`);
  const apiKey = loadApiKey();

  console.log(`Looking up ${gameName}#${tagLine} on ${platform}...`);
  const account = await riotGet(
    region,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey
  );

  const [summoner, entries, matchIds] = await Promise.all([
    riotGet(platform, `/lol/summoner/v4/summoners/by-puuid/${account.puuid}`, apiKey),
    riotGet(platform, `/lol/league/v4/entries/by-puuid/${account.puuid}`, apiKey),
    riotGet(region, `/lol/match/v5/matches/by-puuid/${account.puuid}/ids?count=20`, apiKey),
  ]);

  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  const flex = entries.find((e) => e.queueType === "RANKED_FLEX_SR");

  console.log(`Pulling ${matchIds.length} recent matches for role + form...`);
  const roleCounts = {};
  let wins = 0;
  const champGames = {};

  for (const matchId of matchIds) {
    const match = await riotGet(region, `/lol/match/v5/matches/${matchId}`, apiKey);
    const me = match.info.participants.find((p) => p.puuid === account.puuid);
    if (!me) continue;
    if (me.win) wins++;
    if (me.teamPosition) {
      roleCounts[me.teamPosition] = (roleCounts[me.teamPosition] ?? 0) + 1;
    }
    const key = me.championName;
    champGames[key] = champGames[key] ?? { games: 0, wins: 0 };
    champGames[key].games++;
    if (me.win) champGames[key].wins++;
  }

  const rolesByCount = ROLE_ORDER.filter((r) => roleCounts[r]).sort(
    (a, b) => (roleCounts[b] ?? 0) - (roleCounts[a] ?? 0)
  );
  const topChamps = Object.entries(champGames)
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 5)
    .map(([name, s]) => `${name} (${s.games}g, ${Math.round((s.wins / s.games) * 100)}% wr)`);

  const card = {
    riotId: `${account.gameName}#${account.tagLine}`,
    puuid: account.puuid,
    level: summoner.summonerLevel,
    solo: solo ? `${solo.tier} ${solo.rank} ${solo.leaguePoints}LP (${solo.wins}W ${solo.losses}L)` : "Unranked",
    flex: flex ? `${flex.tier} ${flex.rank} ${flex.leaguePoints}LP (${flex.wins}W ${flex.losses}L)` : "Unranked",
    primaryRole: rolesByCount[0] ?? "unknown",
    secondaryRole: rolesByCount[1] ?? "unknown",
    formWr20: matchIds.length ? `${Math.round((wins / matchIds.length) * 100)}%` : "n/a",
    topChampions: topChamps,
  };

  console.log("\nVerified profile (built live from Riot Web API — no self-reported data):\n");
  console.log(JSON.stringify(card, null, 2));
  return card;
}
