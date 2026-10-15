export enum ListingStatus {
  DRAFT = "DRAFT",
  LISTED = "LISTED",
  FILLING = "FILLING",
  READY = "READY",
  PAUSED = "PAUSED",
  IN_SESSION = "IN_SESSION",
  POST_SESSION = "POST_SESSION",
  DELISTED = "DELISTED",
}

export const ACTIVE_LISTING_STATUSES: ListingStatus[] = [
  ListingStatus.LISTED,
  ListingStatus.FILLING,
  ListingStatus.READY,
  ListingStatus.PAUSED,
];

export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "WaitingForStats"
  | "PreEndOfGame"
  | "EndOfGame"
  | "TerminatedInError"
  | "Reconnect"
  | "WatchInProgress"
  | "CheckedIntoTournament";

export interface Listing {
  id?: string;
  status: ListingStatus;
  queueId?: number;
  title?: string;
  reason?: string;
}

export type JoinRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED"
  | "NO_SHOW"
  | "COMPLETED";

export interface JoinRequest {
  id: string;
  listingId: string;
  summonerId: number;
  gameName: string;
  tagLine: string;
  puuid?: string;
  status?: JoinRequestStatus;
  matchScore?: number;
  offRole?: boolean;
}
