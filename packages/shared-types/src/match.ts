export interface MatchScoreboardEntry {
  puuid: string;
  riotId: string;
  championId: number;
  championName: string | null;
  teamPosition: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damageDealt: number;
  items: number[];
  win: boolean;
  isMe: boolean;
}

export interface MatchHistoryRow {
  matchId: string;
  queueId: number;
  gameMode: string | null;
  gameCreation: string;
  /** Seconds. */
  gameDuration: number;
  win: boolean;
  championId: number;
  championName: string | null;
  champLevel: number | null;
  teamPosition: string | null;
  kills: number;
  deaths: number;
  assists: number;
  /** null when deaths === 0 (perfect KDA has no finite ratio). */
  kda: number | null;
  cs: number;
  csPerMin: number;
  gold: number;
  visionScore: number;
  damageDealt: number;
  damageTaken: number;
  damageShare: number | null;
  killParticipation: number | null;
  items: number[];
  summoner1Id: number | null;
  summoner2Id: number | null;
  primaryRune: number | null;
  subStyle: number | null;
  /** 0 none, 2 double, 3 triple, 4 quadra, 5 penta. */
  multikill: number;
  teammates: MatchScoreboardEntry[];
  opponents: MatchScoreboardEntry[];
}

export const QUEUE_NAMES: Record<number, string> = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  490: "Quickplay",
  700: "Clash",
  720: "ARAM Clash",
  830: "Co-op vs AI",
  840: "Co-op vs AI",
  850: "Co-op vs AI",
  900: "ARURF",
  1020: "One for All",
  1700: "Arena",
  1900: "URF",
};

export function queueName(queueId: number): string {
  return QUEUE_NAMES[queueId] ?? "Custom";
}
