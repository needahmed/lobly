export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface RiotSummoner {
  id: string;
  accountId: string;
  puuid: string;
  profileIconId: number;
  revisionDate: number;
  summonerLevel: number;
}

export interface LeagueEntry {
  leagueId?: string;
  queueType: string;
  tier: string;
  rank: string;
  summonerId?: string;
  puuid?: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak?: boolean;
  veteran?: boolean;
  freshBlood?: boolean;
  inactive?: boolean;
}

export interface MatchParticipant {
  puuid: string;
  championId: number;
  championName?: string;
  champLevel?: number;
  teamPosition?: string;
  individualPosition?: string;
  teamId?: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  queueId?: number;
  riotIdGameName?: string;
  riotIdTagline?: string;
  summonerName?: string;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  goldEarned?: number;
  visionScore?: number;
  totalDamageDealtToChampions?: number;
  totalDamageTaken?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  perks?: {
    styles?: {
      description?: string;
      selections?: { perk: number }[];
      style?: number;
    }[];
  };
}

export interface MatchTeam {
  teamId: number;
  win: boolean;
  objectives?: Record<string, { first?: boolean; kills?: number }>;
}

export interface MatchInfo {
  gameId: number;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  gameEndTimestamp?: number;
  gameVersion?: string;
  gameMode?: string;
  participants: MatchParticipant[];
  teams?: MatchTeam[];
}

export interface MatchDto {
  metadata: { matchId: string; participants: string[] };
  info: MatchInfo;
}

export interface ChampionMastery {
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime: number;
}
