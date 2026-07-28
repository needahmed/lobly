export type Platform =
  | "euw1"
  | "eun1"
  | "tr1"
  | "ru"
  | "na1"
  | "br1"
  | "la1"
  | "la2"
  | "jp1"
  | "oc1"
  | "sg2"
  | "tw2"
  | "vn2"
  | "kr";

export type RegionalRoute = "europe" | "americas" | "asia" | "sea";

export interface LinkRiotAccountBody {
  puuid: string;
  gameName: string;
  tagLine: string;
  summonerId: number;
  platform: Platform | string;
}

export interface RiotAccountDto {
  id: string;
  puuid: string;
  riotId: string;
  tagLine: string;
  summonerId: string | null;
  platform: string;
  verifiedAt: string | null;
  lastSeenAt: string | null;
}
