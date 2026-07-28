/** Client ↔ server socket event names. */
export const SocketEvents = {
  // Client → server
  LISTING_PUBLISH: "listing.publish",
  LISTING_PAUSE: "listing.pause",
  LISTING_DELIST: "listing.delist",
  LISTING_READY: "listing.ready",
  LISTING_REOPEN: "listing.reopen",
  LISTING_RELIST: "listing.relist",
  SESSION_START: "session.start",
  SESSION_END: "session.end",
  PRESENCE_HEARTBEAT: "presence.heartbeat",
  LOBBY_CONFIRMED: "lobby.confirmed",
  MEMBER_LEFT: "member.left",
  CHAT_SEND: "chat.send",
  STATE_RECONCILE: "state.reconcile",

  // Server → client
  LISTING_STATE: "listing.state",
  BOARD_DELTA: "board.delta",
  JOIN_REQUESTED: "join.requested",
  JOIN_ACCEPTED: "join.accepted",
  JOIN_DECLINED: "join.declined",
  JOIN_FAILED: "join.failed",
  JOIN_REOPENED: "join.reopened",
  SESSION_ACTIVE: "session.active",
  CHAT_MESSAGE: "chat.message",
  ENDORSE_PROMPT: "endorse.prompt",
  SYNC_ACK: "sync.ack",
} as const;

/** Phase 3 aliases matching the C2S / S2C split in the phase doc. */
export const C2S = {
  PRESENCE_HEARTBEAT: SocketEvents.PRESENCE_HEARTBEAT,
  LISTING_PUBLISH: SocketEvents.LISTING_PUBLISH,
  LISTING_PAUSE: SocketEvents.LISTING_PAUSE,
  LISTING_RELIST: SocketEvents.LISTING_RELIST,
  LISTING_DELIST: SocketEvents.LISTING_DELIST,
  LISTING_READY: SocketEvents.LISTING_READY,
  LISTING_REOPEN: SocketEvents.LISTING_REOPEN,
  LOBBY_CONFIRMED: SocketEvents.LOBBY_CONFIRMED,
  MEMBER_LEFT: SocketEvents.MEMBER_LEFT,
  SESSION_START: SocketEvents.SESSION_START,
  SESSION_END: SocketEvents.SESSION_END,
  CHAT_SEND: SocketEvents.CHAT_SEND,
  STATE_RECONCILE: SocketEvents.STATE_RECONCILE,
} as const;

export const S2C = {
  BOARD_DELTA: SocketEvents.BOARD_DELTA,
  LISTING_STATE: SocketEvents.LISTING_STATE,
  JOIN_REQUESTED: SocketEvents.JOIN_REQUESTED,
  JOIN_ACCEPTED: SocketEvents.JOIN_ACCEPTED,
  JOIN_DECLINED: SocketEvents.JOIN_DECLINED,
  JOIN_FAILED: SocketEvents.JOIN_FAILED,
  JOIN_REOPENED: SocketEvents.JOIN_REOPENED,
  SESSION_ACTIVE: SocketEvents.SESSION_ACTIVE,
  CHAT_MESSAGE: SocketEvents.CHAT_MESSAGE,
  ENDORSE_PROMPT: SocketEvents.ENDORSE_PROMPT,
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

export interface PresenceHeartbeatPayload {
  phase?: string;
  listingStatus?: string;
  observedPuuid?: string;
  listingId?: string;
}

export interface ListingStatePayload {
  listingId: string;
  status: string;
  reason?: string;
}

export interface BoardDeltaPayload {
  upsert?: unknown;
  remove?: string;
}

export interface JoinRequestedPayload {
  joinRequestId: string;
  card: unknown;
  matchScore: number;
  offRole: boolean;
  roleSlot: string | null;
}

export interface JoinAcceptedToCreatorPayload {
  joinRequestId: string;
  invitee: {
    summonerId: number;
    riotId: string;
    tagLine: string;
    accountId: string;
  };
}

export interface JoinAcceptedToRequesterPayload {
  joinRequestId: string;
  listingId: string;
  creator: {
    riotId: string;
    tagLine: string;
    summonerId: number;
  };
  autoAcceptEligible: boolean;
}

export interface SessionActivePayload {
  sessionId: string;
  memberAccountIds: string[];
  chatOpen: boolean;
}

export interface ChatMessagePayload {
  id: number;
  sessionId: string;
  from: { accountId: string; riotId: string; tagLine: string };
  body: string;
  at: string;
}

export interface EndorsePromptPayload {
  sessionId: string;
  others: { accountId: string; riotId: string; tagLine: string }[];
}

export interface StateReconcilePayload {
  listingStatus?: string;
  phase?: string;
  listingId?: string;
}
