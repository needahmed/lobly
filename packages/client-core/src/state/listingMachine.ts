import {
  ListingStatus,
  SocketEvents,
  deriveLobbyCapability,
  isPublishableQueue,
  type GameflowPhase,
  type LobbyCapability,
} from "@lobly/shared-types";
import { appStore } from "./store";
import { syncAgent } from "../sync/syncAgent";
import { getHostAdapter } from "../hostAdapter";
import { getBridge } from "../shared/bridge";
import {
  defaultDraft,
  draftToCreateBody,
  loadDraftForQueue,
  reconcileDraftToCapability,
  saveDraftForQueue,
  type PublishDraft,
} from "./publishDraft";

export type MachineEvent =
  | { type: "PUBLISH" }
  | { type: "UNPUBLISH" }
  | { type: "PHASE"; phase: GameflowPhase }
  | { type: "LOBBY_GONE" }
  | { type: "JOIN_ACCEPTED" }
  | { type: "MEMBER_ARRIVED" }
  | { type: "SLOT_REOPENED" }
  | { type: "EXPIRED" }
  | { type: "QUEUE_AGAIN" };

function status(): ListingStatus {
  return appStore.state.listing.status;
}

function setStatus(next: ListingStatus) {
  appStore.update({ listing: { ...appStore.state.listing, status: next }, publishReason: null });
  appStore.logLine(`listing → ${next}`);
}

function sync(event: string, payload: Record<string, unknown> = {}) {
  syncAgent.send(event, {
    ...payload,
    status: appStore.state.listing.status,
    phase: appStore.state.gameflowPhase,
    queueId: appStore.state.lobbyCapability?.queueId,
  });
}

function ensureDraft(cap: LobbyCapability): PublishDraft {
  const existing = appStore.state.publishDraft;
  if (existing) return existing;
  const saved = loadDraftForQueue(cap.queueId);
  const hints = appStore.state.profileHints;
  const draft =
    saved ??
    defaultDraft(cap, {
      gameName: appStore.state.summoner?.gameName,
      primaryRole: (hints?.primaryRole as never) ?? null,
      secondaryRole: (hints?.secondaryRole as never) ?? null,
      languages: hints?.languages,
      soloTier: hints?.soloTier,
      soloDivision: hints?.soloDivision,
    });
  appStore.update({ publishDraft: draft });
  return draft;
}

async function publishViaApi(): Promise<string | undefined> {
  try {
    const { createListing, linkCurrentSummoner } = await import("../api/session");
    let accountId = appStore.state.riotAccountId;
    if (!accountId) {
      const linked = await linkCurrentSummoner();
      accountId = linked?.id;
    }
    if (!accountId) {
      appStore.logLine("PUBLISH: no riot account — socket-only");
      return undefined;
    }

    const cap = appStore.state.lobbyCapability;
    if (!cap) {
      appStore.logLine("PUBLISH: no lobby capability");
      return undefined;
    }
    const draft = ensureDraft(cap);
    saveDraftForQueue(cap.queueId, draft);

    const body = draftToCreateBody(draft, cap, accountId);
    const listing = await createListing(body);
    appStore.update({ myListing: listing, publishReason: null });
    return listing.id;
  } catch (e: any) {
    const msg = e?.body?.message ?? e?.message ?? "Publish failed";
    appStore.logLine(`PUBLISH API failed: ${msg}`);

    // One active listing per account: adopt the existing one instead of
    // leaving the user stuck on a Publish button that silently does nothing.
    const adopted = await adoptExistingListing();
    if (adopted) {
      appStore.setToast("You already had a live lobby — reopened it here");
      return adopted;
    }

    appStore.update({ publishReason: msg });
    appStore.setToast(msg);
    return undefined;
  }
}

/** Pull the account's existing active listing into local state, if any. */
async function adoptExistingListing(): Promise<string | undefined> {
  try {
    const { fetchMyListing } = await import("../api/session");
    const mine = await fetchMyListing();
    if (!mine) return undefined;
    appStore.update({ myListing: mine, publishReason: null });
    appStore.logLine(`adopted existing listing ${mine.id} (${mine.status})`);
    return mine.id;
  } catch {
    return undefined;
  }
}

export function canPublish(): { ok: boolean; reason: string | null } {
  const { gameflowPhase, lobby, lobbyCapability, riotAccountId, summoner } =
    appStore.state;

  if (gameflowPhase !== "Lobby") {
    return { ok: false, reason: `Need gameflow Lobby (have ${gameflowPhase})` };
  }
  if (!lobby) return { ok: false, reason: "No lobby open" };

  const cap = lobbyCapability ?? deriveLobbyCapability(lobby as never);
  if (!cap) {
    return { ok: false, reason: "Can't read lobby queue from League client" };
  }
  if (!isPublishableQueue(cap.queueId)) {
    return {
      ok: false,
      reason: `This queue (${cap.queueId}) can't be published`,
    };
  }
  if (cap.freeSeats < 1) {
    return { ok: false, reason: "Lobby is full — leave a seat open to publish" };
  }
  if (!summoner && !riotAccountId) {
    return { ok: false, reason: "Link your Riot account first" };
  }

  const draft = appStore.state.publishDraft;
  if (draft && (!draft.title || draft.title.trim().length < 3)) {
    return { ok: false, reason: "Title must be at least 3 characters" };
  }
  if (draft && draft.slotCount < 1) {
    return { ok: false, reason: "Need at least one open slot" };
  }

  return { ok: true, reason: null };
}

/**
 * Write publish-draft patches through the host bridge store when one exists
 * (Electron renderer / Overwolf desktop window). Those windows have a separate
 * JS realm from the process that owns listingMachine's module-level appStore —
 * updating appStore here would silently no-op the UI.
 */
export function setPublishDraft(patch: Partial<PublishDraft>) {
  const store = getBridge()?.store ?? appStore;
  const cur = store.state.publishDraft;
  const next = cur ? { ...cur, ...patch } : patch;
  try {
    // JSON round-trip: values read back across a contextBridge/Overwolf realm
    // are proxies, and handing those to structuredClone throws.
    store.update({ publishDraft: JSON.parse(JSON.stringify(next)) });
  } catch {
    // Mirroring is best-effort — the form keeps its own copy either way.
  }
}

/** Publish using a draft built in a UI realm (single hop, no store round-trip). */
export function publishWithDraft(draft: PublishDraft) {
  appStore.update({ publishDraft: draft, publishReason: null });
  dispatchMachine({ type: "PUBLISH" });
}

export function dispatchMachine(event: MachineEvent) {
  const from = status();

  if (event.type === "UNPUBLISH") {
    const listingId = appStore.state.listing.id;
    setStatus(ListingStatus.DELISTED);
    sync(SocketEvents.LISTING_DELIST, { listingId });
    if (listingId) {
      void import("../api/session").then(({ delistListing }) =>
        delistListing(listingId).catch((e) =>
          appStore.logLine(`delist API: ${e?.message ?? e}`)
        )
      );
    }
    appStore.update({ myListing: null });
    return;
  }

  switch (from) {
    case ListingStatus.DRAFT:
    case ListingStatus.DELISTED: {
      if (event.type === "PUBLISH") {
        const check = canPublish();
        if (!check.ok) {
          appStore.update({ publishReason: check.reason });
          appStore.logLine(`PUBLISH rejected: ${check.reason}`);
          return;
        }
        setStatus(ListingStatus.LISTED);
        void publishViaApi().then((listingId) => {
          if (!listingId) {
            // Roll back optimistic status if API failed
            setStatus(ListingStatus.DRAFT);
            return;
          }
          appStore.update({
            listing: { status: ListingStatus.LISTED, id: listingId },
          });
          sync(SocketEvents.LISTING_PUBLISH, { listingId });
        });
      }
      break;
    }
    case ListingStatus.LISTED: {
      if (event.type === "JOIN_ACCEPTED") {
        setStatus(ListingStatus.FILLING);
      } else if (event.type === "PHASE" && event.phase === "ChampSelect") {
        setStatus(ListingStatus.PAUSED);
        sync(SocketEvents.LISTING_PAUSE);
      } else if (event.type === "LOBBY_GONE") {
        setStatus(ListingStatus.DELISTED);
        sync(SocketEvents.LISTING_DELIST);
        appStore.update({ myListing: null });
      }
      break;
    }
    case ListingStatus.FILLING: {
      if (event.type === "PHASE" && event.phase === "ChampSelect") {
        setStatus(ListingStatus.PAUSED);
        sync(SocketEvents.LISTING_PAUSE);
      } else if (event.type === "LOBBY_GONE") {
        setStatus(ListingStatus.DELISTED);
        sync(SocketEvents.LISTING_DELIST);
        appStore.update({ myListing: null });
      } else if (event.type === "MEMBER_ARRIVED") {
        setStatus(ListingStatus.READY);
        sync(SocketEvents.LISTING_READY);
      } else if (event.type === "SLOT_REOPENED") {
        setStatus(ListingStatus.LISTED);
        sync(SocketEvents.LISTING_REOPEN);
      }
      break;
    }
    case ListingStatus.READY: {
      if (
        event.type === "PHASE" &&
        (event.phase === "Matchmaking" || event.phase === "ChampSelect")
      ) {
        setStatus(ListingStatus.IN_SESSION);
        sync(SocketEvents.SESSION_START);
      }
      break;
    }
    case ListingStatus.PAUSED: {
      if (event.type === "QUEUE_AGAIN" && appStore.state.gameflowPhase === "Lobby") {
        setStatus(ListingStatus.LISTED);
        sync(SocketEvents.LISTING_RELIST);
      } else if (event.type === "EXPIRED" || event.type === "LOBBY_GONE") {
        setStatus(ListingStatus.DELISTED);
        sync(SocketEvents.LISTING_DELIST);
        appStore.update({ myListing: null });
      }
      break;
    }
    case ListingStatus.IN_SESSION: {
      if (
        event.type === "PHASE" &&
        (event.phase === "EndOfGame" || event.phase === "Lobby" || event.phase === "None")
      ) {
        setStatus(ListingStatus.POST_SESSION);
        sync(SocketEvents.SESSION_END);
      }
      break;
    }
    case ListingStatus.POST_SESSION: {
      if (event.type === "QUEUE_AGAIN") {
        setStatus(ListingStatus.LISTED);
        sync(SocketEvents.LISTING_RELIST);
      } else if (event.type === "EXPIRED") {
        setStatus(ListingStatus.DELISTED);
        sync(SocketEvents.LISTING_DELIST);
        appStore.update({ myListing: null });
      }
      break;
    }
    default:
      break;
  }
}

export function onGameflowPhase(phase: GameflowPhase) {
  const prev = appStore.state.gameflowPhase;
  if (prev !== phase) {
    appStore.update({ gameflowPhase: phase });
    appStore.logLine(`gameflow: ${prev} → ${phase}`);
  }
  dispatchMachine({ type: "PHASE", phase });

  if (phase === "EndOfGame" || phase === "WaitingForStats") {
    appStore.update({ sessionEndPending: true });
  }
}

export async function onLobbyChanged() {
  await getHostAdapter().eventBus.notifyLobbySignal?.();
}

function isLobbyShaped(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const l = v as any;
  return l.gameConfig != null || l.queueId != null || l.partyId != null;
}

let lastReconcileAt = 0;
let lastFreeSeats: number | null = null;

async function maybeReconcileSlots(cap: LobbyCapability) {
  const listingId = appStore.state.listing.id;
  const s = status();
  if (
    !listingId ||
    (s !== ListingStatus.LISTED &&
      s !== ListingStatus.FILLING &&
      s !== ListingStatus.PAUSED)
  ) {
    return;
  }
  if (lastFreeSeats === cap.freeSeats) return;
  const now = Date.now();
  if (now - lastReconcileAt < 1500) return;
  lastReconcileAt = now;
  lastFreeSeats = cap.freeSeats;

  try {
    const { reconcileListingSlots } = await import("../api/session");
    const summary = await reconcileListingSlots(listingId, cap.freeSeats);
    appStore.update({
      myListing: summary,
      listing: { status: summary.status as ListingStatus, id: summary.id },
    });
    if (summary.status === ListingStatus.PAUSED && cap.freeSeats === 0) {
      appStore.logLine("listing paused — lobby full");
    }
  } catch (e: any) {
    appStore.logLine(`reconcile slots: ${e?.message ?? e}`);
  }
}

export function applyLobby(lobby: unknown) {
  const prev = appStore.state.lobby;

  if (lobby != null && !isLobbyShaped(lobby)) return;

  const cap = lobby ? deriveLobbyCapability(lobby as never) : null;
  const prevCap = prev ? deriveLobbyCapability(prev as never) : null;

  if (lobby == null) {
    appStore.update({
      lobby: undefined,
      lobbyCapability: null,
      publishDraft: null,
    });
    if (prev != null) appStore.logLine("lobby closed");
    lastFreeSeats = null;
    const s = status();
    if (
      s === ListingStatus.LISTED ||
      s === ListingStatus.FILLING ||
      s === ListingStatus.PAUSED
    ) {
      dispatchMachine({ type: "LOBBY_GONE" });
    }
    return;
  }

  // Rebuild the publish draft only when the lobby's queue actually changes.
  // Lobby events fire constantly (and can briefly flap mid queue-switch), so
  // rebuilding on every event would wipe the user's in-progress edits.
  let nextDraft = appStore.state.publishDraft ?? null;
  if (cap) {
    if (!nextDraft || nextDraft.queueId !== cap.queueId) {
      const hints = appStore.state.profileHints;
      nextDraft =
        loadDraftForQueue(cap.queueId) ??
        defaultDraft(cap, {
          gameName: appStore.state.summoner?.gameName,
          languages: hints?.languages,
          soloTier: hints?.soloTier,
          soloDivision: hints?.soloDivision,
        });
    } else {
      nextDraft = reconcileDraftToCapability(nextDraft, cap);
    }
  }

  appStore.update({
    lobby: lobby ?? undefined,
    lobbyCapability: cap,
    publishDraft: nextDraft,
  });

  if (cap) void maybeReconcileSlots(cap);

  const q = cap?.queueId ?? null;
  if (prevCap?.queueId !== q) {
    appStore.logLine(
      `lobby detected queueId=${q}` +
        (cap
          ? ` seats=${cap.freeSeats}/${cap.maxLobbySize} positional=${cap.positional}`
          : "")
    );
  }
}

export function wireListingMachineToBus() {
  const bus = getHostAdapter().eventBus;
  bus.on("lobby", applyLobby);
  bus.on("phase", (phase) => {
    if (typeof phase === "string") onGameflowPhase(phase as GameflowPhase);
  });
  bus.start();
}

export async function refreshLcuState(): Promise<void> {
  const transport = getHostAdapter().lcuTransport;

  try {
    const phase = await transport.request<string | null>("gameflowPhase");
    if (typeof phase === "string" && phase) {
      onGameflowPhase(phase as GameflowPhase);
    }
  } catch (e: any) {
    appStore.logLine(`phase read failed: ${e?.message ?? e}`);
  }

  try {
    applyLobby(await transport.request<unknown>("lobby"));
  } catch (e: any) {
    appStore.logLine(`lobby read failed: ${e?.message ?? e}`);
  }
}
