import {
  ListingStatus,
  type FeatureFlags,
  type GameflowPhase,
  type LobbyCapability,
  type ListingSummary,
  type GameContext,
  type PartyState,
} from "@lobly/shared-types";
import type { PublishDraft } from "./publishDraft";

type Listener = () => void;

export interface PendingRequest {
  joinRequestId: string;
  card: any;
  matchScore: number;
  offRole: boolean;
  roleSlot: string | null;
}

export interface AppState {
  lcu: { connected: boolean; port?: string; token?: string };
  summoner?: {
    puuid: string;
    gameName: string;
    tagLine: string;
    summonerId: number;
    platform: string;
  };
  gameflowPhase: GameflowPhase;
  lobby?: unknown;
  /** The user's own League party as seen by the GameFlowTracker. */
  party?: PartyState | null;
  /** Frozen when a game starts (input for the end-of-game loop). */
  gameContext?: GameContext | null;
  /** Derived from the live League lobby gameConfig. */
  lobbyCapability?: LobbyCapability | null;
  listing: { status: ListingStatus; id?: string };
  /** Last known listing summary (for edit / Find Team own card). */
  myListing?: ListingSummary | null;
  publishDraft?: PublishDraft | null;
  riotAccountId?: string;
  gep: { features: string[]; active: boolean };
  sync: { connected: boolean };
  wsAvailable: boolean;
  log: string[];
  toast: { message: string; at: number } | null;
  publishReason: string | null;
  sessionEndPending: boolean;
  board?: unknown[];
  /** Bumped on board.delta so Find Team can refetch. */
  boardRevision?: number;
  pendingRequests?: PendingRequest[];
  session?: {
    id: string;
    memberAccountIds: string[];
    chat: any[];
  };
  endorsePrompt?: {
    sessionId: string;
    others: { accountId: string; riotId: string; tagLine: string }[];
  } | null;
  manualInvite?: { joinRequestId: string; riotId: string } | null;
  autoAcceptLoblyInvites?: boolean;
  flags?: FeatureFlags;
  lcuError?: string | null;
  /** Profile rank hints used by publish rank presets. */
  profileHints?: {
    soloTier?: string | null;
    soloDivision?: string | null;
    flexTier?: string | null;
    flexDivision?: string | null;
    primaryRole?: string | null;
    secondaryRole?: string | null;
    languages?: string[];
  };
}

class Store {
  private listeners = new Set<Listener>();
  state: AppState = {
    lcu: { connected: false },
    gameflowPhase: "None",
    listing: { status: ListingStatus.DRAFT },
    lobbyCapability: null,
    party: null,
    gameContext: null,
    publishDraft: null,
    myListing: null,
    gep: { features: [], active: false },
    sync: { connected: false },
    wsAvailable: false,
    log: [],
    toast: null,
    publishReason: null,
    sessionEndPending: false,
    boardRevision: 0,
    pendingRequests: [],
    autoAcceptLoblyInvites: false,
    endorsePrompt: null,
    manualInvite: null,
    lcuError: null,
  };

  /**
   * Set by a realm that mirrors — but does not own — the state (Electron's
   * renderer). Writes are applied locally for instant feedback and also
   * forwarded to the owning process, which is what the listing machine and
   * sync agent actually read.
   */
  private forwardWrite: ((patch: Partial<AppState>) => void) | null = null;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  setWriteForwarder(fn: ((patch: Partial<AppState>) => void) | null) {
    this.forwardWrite = fn;
  }

  /**
   * Replace the whole state with an authoritative snapshot from the owning
   * process. Deliberately does NOT forward — that would echo straight back
   * to the sender.
   */
  applyRemoteState(next: AppState) {
    this.state = next;
    this.emit();
  }

  update(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
    this.forwardWrite?.(patch);
  }

  setLcuDown() {
    this.update({
      lcu: { connected: false },
      gameflowPhase: "None",
      lobby: undefined,
      lobbyCapability: null,
      party: null,
    });
    this.logLine("LCU down — credentials cleared");
  }

  logLine(s: string) {
    // Mirroring realms have no authority over the log — the owner appends
    // and pushes the result back — so forward instead of writing locally.
    if (this.forwardWrite) {
      this.forwardLog?.(s);
      return;
    }
    this.state = {
      ...this.state,
      log: [...this.state.log.slice(-199), `${new Date().toISOString()} ${s}`],
    };
    this.emit();
  }

  private forwardLog: ((s: string) => void) | null = null;

  setLogForwarder(fn: ((s: string) => void) | null) {
    this.forwardLog = fn;
  }

  setToast(message: string) {
    this.update({ toast: { message, at: Date.now() } });
  }

  clearToast() {
    this.update({ toast: null });
  }
}

export type { Store };
export const appStore = new Store();
