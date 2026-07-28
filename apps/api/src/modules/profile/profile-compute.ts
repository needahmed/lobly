import type { MatchDto } from "@lobly/riot-client";
import type { Role } from "@lobly/shared-types";

const RANKED_QUEUES = new Set([420, 440]);
const FORM_QUEUES = new Set([420, 440, 450]);
const ROLE_MAP: Record<string, Role> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MIDDLE",
  BOTTOM: "BOTTOM",
  UTILITY: "UTILITY",
};

export interface ComputedRoles {
  primaryRole: Role | null;
  secondaryRole: Role | null;
}

export function computeRoles(
  matches: MatchDto[],
  puuid: string,
  lookback = 60
): ComputedRoles {
  const counts = new Map<Role, number>();
  let considered = 0;

  for (const m of matches) {
    if (!RANKED_QUEUES.has(m.info.queueId)) continue;
    const p = m.info.participants.find((x) => x.puuid === puuid);
    if (!p) continue;
    const pos = (p.teamPosition || p.individualPosition || "").toUpperCase();
    const role = ROLE_MAP[pos];
    if (!role) continue;
    counts.set(role, (counts.get(role) ?? 0) + 1);
    considered++;
    if (considered >= lookback) break;
  }

  if (considered === 0) return { primaryRole: null, secondaryRole: null };

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const primary = sorted[0];
  const secondary = sorted[1];
  const minShare = Math.ceil(considered * 0.15);

  return {
    primaryRole: primary && primary[1] >= minShare ? primary[0] : null,
    secondaryRole: secondary && secondary[1] >= minShare ? secondary[0] : null,
  };
}

export interface ChampAgg {
  championId: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export function computeChampionStats(
  matches: MatchDto[],
  puuid: string,
  topN = 10
): ChampAgg[] {
  const map = new Map<number, ChampAgg>();

  for (const m of matches) {
    if (!RANKED_QUEUES.has(m.info.queueId)) continue;
    const p = m.info.participants.find((x) => x.puuid === puuid);
    if (!p) continue;
    const cur = map.get(p.championId) ?? {
      championId: p.championId,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
    cur.games++;
    if (p.win) cur.wins++;
    cur.kills += p.kills;
    cur.deaths += p.deaths;
    cur.assists += p.assists;
    map.set(p.championId, cur);
  }

  return [...map.values()]
    .sort((a, b) => b.games - a.games)
    .slice(0, topN)
    .map((c) => ({
      ...c,
    }));
}

export function computeFormAndStreak(
  matches: MatchDto[],
  puuid: string
): { formWr20: number | null; streak: number } {
  const recent: boolean[] = [];
  for (const m of matches) {
    if (!FORM_QUEUES.has(m.info.queueId)) continue;
    const p = m.info.participants.find((x) => x.puuid === puuid);
    if (!p) continue;
    recent.push(p.win);
    if (recent.length >= 20) break;
  }

  if (recent.length === 0) return { formWr20: null, streak: 0 };

  const wins = recent.filter(Boolean).length;
  const formWr20 = Math.round((wins / recent.length) * 10000) / 100;

  let streak = 0;
  const first = recent[0];
  for (const w of recent) {
    if (w !== first) break;
    streak += first ? 1 : -1;
  }

  return { formWr20, streak };
}

export function kdaString(kills: number, deaths: number, assists: number): string {
  const d = deaths === 0 ? 1 : deaths;
  return ((kills + assists) / d).toFixed(2);
}
