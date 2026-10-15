import { ListingStatus, SocketEvents, deriveLobbyCapability, isPublishableQueue, } from "@lobly/shared-types";
import { appStore } from "./store";
import { syncAgent } from "../sync/syncAgent";
import { getHostAdapter } from "../hostAdapter";
import { getBridge } from "../shared/bridge";
import { gameFlowTracker } from "../lcu/gameFlowTracker";
import { isLobbyShaped } from "../lcu/partyReducer";
import { defaultDraft, draftToCreateBody, loadDraftForQueue, reconcileDraftToCapability, saveDraftForQueue, } from "./publishDraft";
/** Final SESSION_END (Lobby/None) is sent once per session. */
let finalSessionEndSent = false;
function status() {
    return appStore.state.listing.status;
}
function setStatus(next) {
    appStore.update({ listing: { ...appStore.state.listing, status: next }, publishReason: null });
    appStore.logLine(`listing → ${next}`);
}
function sync(event, payload = {}) {
    syncAgent.send(event, {
        ...payload,
        status: appStore.state.listing.status,
        phase: appStore.state.gameflowPhase,
        queueId: appStore.state.lobbyCapability?.queueId,
    });
}
function ensureDraft(cap) {
    const existing = appStore.state.publishDraft;
    if (existing)
        return existing;
    const saved = loadDraftForQueue(cap.queueId);
    const hints = appStore.state.profileHints;
    const draft = saved ??
        defaultDraft(cap, {
            gameName: appStore.state.summoner?.gameName,
            primaryRole: hints?.primaryRole ?? null,
            secondaryRole: hints?.secondaryRole ?? null,
            languages: hints?.languages,
            soloTier: hints?.soloTier,
            soloDivision: hints?.soloDivision,
        });
    appStore.update({ publishDraft: draft });
    return draft;
}
async function publishViaApi() {
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
        appStore.update({ myListing: listing, publishReason: null, queueDrift: false });
        return listing.id;
    }
    catch (e) {
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
async function adoptExistingListing() {
    try {
        const { fetchMyListing } = await import("../api/session");
        const mine = await fetchMyListing();
        if (!mine)
            return undefined;
        appStore.update({ myListing: mine, publishReason: null });
        appStore.logLine(`adopted existing listing ${mine.id} (${mine.status})`);
        return mine.id;
    }
    catch {
        return undefined;
    }
}
export function canPublish() {
    const { gameflowPhase, lobby, lobbyCapability, riotAccountId, summoner } = appStore.state;
    if (gameflowPhase !== "Lobby") {
        return { ok: false, reason: `Need gameflow Lobby (have ${gameflowPhase})` };
    }
    if (!lobby)
        return { ok: false, reason: "No lobby open" };
    const cap = lobbyCapability ?? deriveLobbyCapability(lobby);
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
export function setPublishDraft(patch) {
    const store = getBridge()?.store ?? appStore;
    const cur = store.state.publishDraft;
    const next = cur ? { ...cur, ...patch } : patch;
    try {
        // JSON round-trip: values read back across a contextBridge/Overwolf realm
        // are proxies, and handing those to structuredClone throws.
        store.update({ publishDraft: JSON.parse(JSON.stringify(next)) });
    }
    catch {
        // Mirroring is best-effort — the form keeps its own copy either way.
    }
}
/** Publish using a draft built in a UI realm (single hop, no store round-trip). */
export function publishWithDraft(draft) {
    appStore.update({ publishDraft: draft, publishReason: null });
    dispatchMachine({ type: "PUBLISH" });
}
export function dispatchMachine(event) {
    const from = status();
    if (event.type === "UNPUBLISH") {
        const listingId = appStore.state.listing.id;
        setStatus(ListingStatus.DELISTED);
        sync(SocketEvents.LISTING_DELIST, { listingId });
        if (listingId) {
            void import("../api/session").then(({ delistListing }) => delistListing(listingId).catch((e) => appStore.logLine(`delist API: ${e?.message ?? e}`)));
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
            }
            else if (event.type === "PHASE" && event.phase === "ChampSelect") {
                setStatus(ListingStatus.PAUSED);
                sync(SocketEvents.LISTING_PAUSE);
            }
            else if (event.type === "LOBBY_GONE") {
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
            }
            else if (event.type === "LOBBY_GONE") {
                setStatus(ListingStatus.DELISTED);
                sync(SocketEvents.LISTING_DELIST);
                appStore.update({ myListing: null });
            }
            else if (event.type === "MEMBER_ARRIVED") {
                setStatus(ListingStatus.READY);
                sync(SocketEvents.LISTING_READY);
            }
            else if (event.type === "SLOT_REOPENED") {
                setStatus(ListingStatus.LISTED);
                sync(SocketEvents.LISTING_REOPEN);
            }
            break;
        }
        case ListingStatus.READY: {
            if (event.type === "PHASE" &&
                (event.phase === "Matchmaking" || event.phase === "ChampSelect")) {
                finalSessionEndSent = false;
                setStatus(ListingStatus.IN_SESSION);
                sync(SocketEvents.SESSION_START);
            }
            break;
        }
        case ListingStatus.PAUSED: {
            if (event.type === "QUEUE_AGAIN" && appStore.state.gameflowPhase === "Lobby") {
                setStatus(ListingStatus.LISTED);
                sync(SocketEvents.LISTING_RELIST);
            }
            else if (event.type === "EXPIRED" || event.type === "LOBBY_GONE") {
                setStatus(ListingStatus.DELISTED);
                sync(SocketEvents.LISTING_DELIST);
                appStore.update({ myListing: null });
            }
            break;
        }
        case ListingStatus.IN_SESSION: {
            if (event.type === "PHASE" &&
                (event.phase === "EndOfGame" || event.phase === "Lobby" || event.phase === "None")) {
                setStatus(ListingStatus.POST_SESSION);
                sync(SocketEvents.SESSION_END, {
                    listingId: appStore.state.listing.id,
                    observedPhase: event.phase,
                    final: event.phase === "Lobby" || event.phase === "None",
                });
            }
            break;
        }
        case ListingStatus.POST_SESSION: {
            if (event.type === "PHASE" &&
                (event.phase === "Lobby" || event.phase === "None") &&
                !finalSessionEndSent) {
                finalSessionEndSent = true;
                sync(SocketEvents.SESSION_END, {
                    listingId: appStore.state.listing.id,
                    observedPhase: event.phase,
                    final: true,
                });
            }
            else if (event.type === "QUEUE_AGAIN") {
                finalSessionEndSent = false;
                setStatus(ListingStatus.LISTED);
                sync(SocketEvents.LISTING_RELIST);
            }
            else if (event.type === "EXPIRED") {
                finalSessionEndSent = false;
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
/**
 * Entry point for a bare gameflow phase from any source (GEP game_flow, the
 * /gameflow-phase WS event, REST seeding). Routed through the tracker so that
 * repeats from several channels reach the listing machine once per change.
 */
export function onGameflowPhase(phase) {
    void gameFlowTracker.ingest("phase", phase);
}
/** Applies a phase change the tracker has already de-duplicated. */
function applyGameflowPhase(phase) {
    const prev = appStore.state.gameflowPhase;
    if (prev !== phase) {
        appStore.update({ gameflowPhase: phase });
        appStore.logLine(`gameflow: ${prev} → ${phase}`);
    }
    dispatchMachine({ type: "PHASE", phase });
}
export async function onLobbyChanged() {
    await getHostAdapter().eventBus.notifyLobbySignal?.();
}
let partyReconcileTimer = null;
function schedulePartyReconcile() {
    if (appStore.state.flags?.partySync === false)
        return;
    const s = status();
    if (s !== ListingStatus.LISTED &&
        s !== ListingStatus.FILLING &&
        s !== ListingStatus.PAUSED) {
        return;
    }
    if (partyReconcileTimer)
        clearTimeout(partyReconcileTimer);
    partyReconcileTimer = setTimeout(() => {
        partyReconcileTimer = null;
        const party = appStore.state.party;
        if (party)
            void reconcilePartyNow(party);
    }, 1500);
}
async function reconcilePartyNow(party) {
    const listingId = appStore.state.listing.id;
    const s = status();
    if (!listingId ||
        party.queueId == null ||
        (s !== ListingStatus.LISTED &&
            s !== ListingStatus.FILLING &&
            s !== ListingStatus.PAUSED)) {
        return;
    }
    try {
        const { reconcileListingParty } = await import("../api/session");
        const beforeQueue = appStore.state.myListing?.queueId;
        const summary = await reconcileListingParty(listingId, {
            partyId: party.partyId,
            queueId: party.queueId,
            members: party.members.map((m) => ({
                puuid: m.puuid,
                summonerId: m.summonerId,
                roles: m.roles,
                isLeader: m.isLeader,
            })),
            filledRoles: party.filledRoles,
            phase: party.phase,
        });
        const drifted = summary.status === ListingStatus.DELISTED &&
            beforeQueue != null &&
            party.queueId !== beforeQueue;
        appStore.update({
            myListing: summary,
            queueDrift: drifted || appStore.state.queueDrift,
            listing: { status: summary.status, id: summary.id },
        });
        if (summary.status === ListingStatus.PAUSED) {
            appStore.logLine("listing paused — lobby full");
        }
        if (drifted)
            appStore.logLine("listing delisted — queue changed");
    }
    catch (e) {
        appStore.logLine(`reconcile party: ${e?.message ?? e}`);
    }
}
export function applyLobby(lobby) {
    const prev = appStore.state.lobby;
    if (lobby != null && !isLobbyShaped(lobby))
        return;
    const cap = lobby ? deriveLobbyCapability(lobby) : null;
    const prevCap = prev ? deriveLobbyCapability(prev) : null;
    if (lobby == null) {
        appStore.update({
            lobby: undefined,
            lobbyCapability: null,
            publishDraft: null,
        });
        if (prev != null)
            appStore.logLine("lobby closed");
        const s = status();
        if (s === ListingStatus.LISTED ||
            s === ListingStatus.FILLING ||
            s === ListingStatus.PAUSED) {
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
        }
        else {
            nextDraft = reconcileDraftToCapability(nextDraft, cap);
        }
    }
    appStore.update({
        lobby: lobby ?? undefined,
        lobbyCapability: cap,
        publishDraft: nextDraft,
    });
    const q = cap?.queueId ?? null;
    if (prevCap?.queueId !== q) {
        appStore.logLine(`lobby detected queueId=${q}` +
            (cap
                ? ` seats=${cap.freeSeats}/${cap.maxLobbySize} positional=${cap.positional}`
                : ""));
    }
}
let trackerWired = false;
function wireTracker() {
    if (trackerWired)
        return;
    trackerWired = true;
    gameFlowTracker.configure({
        fetch: (endpoint) => getHostAdapter().lcuTransport.request(endpoint),
        log: (line) => appStore.logLine(line),
    });
    gameFlowTracker.onPhase((edge) => {
        if (!edge.legal) {
            appStore.logLine(`gameflow edge ${edge.from} → ${edge.to} outside transition table`);
        }
        applyGameflowPhase(edge.to);
    });
    gameFlowTracker.onParty((party) => {
        appStore.update({ party });
        schedulePartyReconcile();
    });
    gameFlowTracker.onGameStarted((ctx) => appStore.update({ gameContext: ctx }));
    // LCU gone → forget tracked state so the reconnect replays every phase.
    let wasConnected = appStore.state.lcu.connected;
    appStore.subscribe(() => {
        const connected = appStore.state.lcu.connected;
        if (wasConnected && !connected)
            void gameFlowTracker.reset();
        wasConnected = connected;
    });
}
export function wireListingMachineToBus() {
    wireTracker();
    const bus = getHostAdapter().eventBus;
    bus.on("lobby", (lobby) => {
        applyLobby(lobby);
        void gameFlowTracker.ingest("lobby", lobby);
    });
    bus.on("phase", (phase) => void gameFlowTracker.ingest("phase", phase));
    bus.on("gameflowSession", (s) => void gameFlowTracker.ingest("gameflowSession", s));
    bus.on("champSelect", (cs) => void gameFlowTracker.ingest("champSelect", cs));
    bus.start();
}
/**
 * Re-read everything the push channels would otherwise only report as
 * changes: on (re)connect, the user may already be in a lobby or a game.
 * The gameflow session is the source of truth for phase, queue and gameId;
 * the bare phase endpoint is only the fallback when it can't be read.
 */
export async function refreshLcuState() {
    wireTracker();
    const transport = getHostAdapter().lcuTransport;
    let sessionRead = false;
    try {
        const session = await transport.request("gameflowSession");
        await gameFlowTracker.ingest("gameflowSession", session);
        sessionRead = true;
    }
    catch (e) {
        appStore.logLine(`gameflow session read failed: ${e?.message ?? e}`);
    }
    if (!sessionRead) {
        try {
            const phase = await transport.request("gameflowPhase");
            if (typeof phase === "string" && phase) {
                await gameFlowTracker.ingest("phase", phase);
            }
        }
        catch (e) {
            appStore.logLine(`phase read failed: ${e?.message ?? e}`);
        }
    }
    try {
        const lobby = await transport.request("lobby");
        applyLobby(lobby);
        await gameFlowTracker.ingest("lobby", lobby);
    }
    catch (e) {
        appStore.logLine(`lobby read failed: ${e?.message ?? e}`);
    }
    if (gameFlowTracker.getState().phase === "ChampSelect") {
        try {
            const cs = await transport.request("champSelectSession");
            await gameFlowTracker.ingest("champSelect", cs);
        }
        catch (e) {
            appStore.logLine(`champ select read failed: ${e?.message ?? e}`);
        }
    }
}
