export type EndorseKind = "GOOD_COMMS" | "GOOD_TEAMMATE" | "SKILLED";

export type ReportReason = "HARASSMENT" | "SLURS" | "BAIT_JOIN" | "OTHER";

export type ReliabilityKind =
  | "ACCEPTED"
  | "SHOWED"
  | "NO_SHOW"
  | "ABANDONED"
  | "COMPLETED"
  | "CANCELLED_AFTER_ACCEPT";

export interface SessionSummary {
  id: string;
  listingId: string | null;
  memberAccountIds: string[];
  leagueLobbyConfirmedAt: string | null;
  startedQueueAt: string | null;
  gamesPlayed: number;
  endedAt: string | null;
  chatOpenUntil: string | null;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  fromAccountId: string;
  body: string;
  createdAt: string;
}

export interface EndorsementCounts {
  goodComms: number;
  goodTeammate: number;
  skilled: number;
}

export interface ReputationBlock {
  reliability: number | null;
  endorsements: EndorsementCounts;
  provisional: boolean;
}

export interface FeatureFlags {
  inviteAutomation: boolean;
  autoAccept: boolean;
  board: boolean;
  allowedPlatforms: string[];
  /** Client sends PATCH /listings/:id/party. Default on. */
  partySync: boolean;
  /** game.ended schedules the delayed Riot refresh. Default on. */
  postgameLoop: boolean;
  /** Organic (non-listing) sessions can be endorsed. Default off. */
  organicEndorse: boolean;
  /** Legacy 3s lobby polling. Default on until party sync is stable. */
  clientLobbyWatch: boolean;
}
