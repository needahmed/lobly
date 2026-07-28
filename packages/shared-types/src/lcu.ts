import type { GameflowPhase } from "./listing";
import type { Role } from "./profile";
import type { LcuGameConfigLike } from "./queues";

export type { GameflowPhase };

export interface LcuCredentials {
  port: string;
  token: string;
}

export interface LcuSummoner {
  puuid: string;
  gameName: string;
  tagLine: string;
  summonerId: number;
  platform: string;
  displayName?: string;
}

export interface LcuLobbyMember {
  summonerId: number;
  puuid?: string;
  gameName?: string;
  tagLine?: string;
  summonerName?: string;
  firstPositionPreference?: Role | string | null;
  secondPositionPreference?: Role | string | null;
  isLeader?: boolean;
}

export interface LcuLobby {
  queueId?: number;
  members?: LcuLobbyMember[];
  partyId?: string;
  localMember?: LcuLobbyMember;
  gameConfig?: LcuGameConfigLike;
  [key: string]: unknown;
}
