import { SocketEvents, isEndOfGamePhase, isGameflowPhase, isInGamePhase, isLegalTransition, } from "@lobly/shared-types";
import { getHostAdapter } from "../hostAdapter";
import { syncAgent } from "../sync/syncAgent";
import { appStore } from "../state/store";
import { SerialQueue } from "./serialQueue";
import { emptyParty, isLobbyShaped, reduceChampSelect, reduceGameflowSession, reduceLobby, reducePhase, samePartyState, } from "./partyReducer";
/** LCU endpoint (lcu-endpoints name) to re-read when a pushed payload is unusable. */
const REST_FALLBACK = {
    phase: "gameflowPhase",
    lobby: "lobby",
    gameflowSession: "gameflowSession",
    champSelect: "champSelectSession",
};
const GAME_CONTEXT_KEY = "lobly.gameContext";
const LAST_ENDED_KEY = "lobly.lastEndedGameId";
/**
 * Single pipeline for every LCU push and REST read (04 doc §3.2.2):
 *
 *   raw event → serial queue → per-input dedupe → validate (REST re-read on
 *   failure) → reduce → emit "party" on change / "phase" on a phase change
 *
 * Phase listeners get every real phase CHANGE once (repeats from GEP + WS
 * are dropped). `edge.legal` says whether the change is in FLOW_TRANSITIONS;
 * once-per-game hooks must check it, the listing machine does not need to.
 */
export class GameFlowTracker {
    deps;
    queue = new SerialQueue();
    state = emptyParty();
    lastRaw = new Map();
    gameContext = null;
    partyListeners = new Set();
    phaseListeners = new Set();
    gameListeners = new Set();
    /** Last phase actually observed (null until the first one arrives). */
    lastPhase = null;
    /** One ready-check accept attempt per visit to ReadyCheck. Not retried. */
    readyCheckAttempted = false;
    readyCheckTimer = null;
    /** True after a legal entry into GameStart / InProgress. */
    inGameEntryLegal = false;
    lastEndedGameId = null;
    lastEndedWasError = false;
    lastShownGameId = null;
    awaitingErrorResolution = false;
    /** Launcher died mid-game; send game.ended only after we know how it finished. */
    deferredTermination = false;
    localEog = null;
    constructor(deps = {}) {
        this.deps = deps;
        this.gameContext = readStoredContext();
        this.lastEndedGameId = readLastEnded();
    }
    configure(deps) {
        this.deps = { ...this.deps, ...deps };
    }
    getState() {
        return this.state;
    }
    getGameContext() {
        return this.gameContext;
    }
    onParty(fn) {
        this.partyListeners.add(fn);
        return () => this.partyListeners.delete(fn);
    }
    onPhase(fn) {
        this.phaseListeners.add(fn);
        return () => this.phaseListeners.delete(fn);
    }
    /** Fires once per gameId, when a game is first seen in progress. */
    onGameStarted(fn) {
        this.gameListeners.add(fn);
        return () => this.gameListeners.delete(fn);
    }
    ingest(input, data) {
        return this.queue.push(() => this.process(input, data));
    }
    /**
     * League closed while a game was in progress. Keep GameContext and wait
     * until the client comes back before deciding the game ended.
     */
    noteLauncherClosed() {
        if (this.gameContext && this.lastEndedGameId !== this.gameContext.gameId) {
            this.deferredTermination = true;
            this.log("tracker: launcher closed during a game — deferring game.ended");
        }
    }
    /** Waits for everything ingested so far (tests, seeding). */
    idle() {
        return this.queue.idle();
    }
    /** LCU went away: forget everything so the next connection replays cleanly. */
    reset() {
        return this.queue.push(() => {
            if (this.readyCheckTimer)
                clearTimeout(this.readyCheckTimer);
            this.readyCheckTimer = null;
            this.readyCheckAttempted = false;
            this.lastRaw.clear();
            this.lastPhase = null;
            this.inGameEntryLegal = false;
            const prev = this.state;
            this.state = emptyParty();
            if (!samePartyState(prev, this.state))
                this.emitParty();
        });
    }
    log(line) {
        this.deps.log?.(line);
    }
    now() {
        return this.deps.now?.() ?? Date.now();
    }
    async process(input, data) {
        // Byte-identical repeats of the chatty feeds are dropped before any work.
        // Phase-bearing inputs skip this: "phase" and "gameflowSession" both carry
        // the phase, so a repeat on one can still be news after the other moved
        // it — their reducers are idempotent instead.
        if (input === "lobby" || input === "champSelect") {
            let raw;
            try {
                raw = JSON.stringify(data ?? null);
            }
            catch {
                return;
            }
            if (this.lastRaw.get(input) === raw)
                return;
            this.lastRaw.set(input, raw);
        }
        let payload = data;
        if (!this.isValid(input, payload)) {
            payload = await this.refetch(input);
            if (!this.isValid(input, payload)) {
                this.log(`tracker: dropped unusable ${input} payload`);
                return;
            }
        }
        const prev = this.state;
        const now = this.now();
        let next = prev;
        switch (input) {
            case "phase":
                next = reducePhase(prev, payload, now);
                break;
            case "lobby":
                next = reduceLobby(prev, payload, now);
                break;
            case "champSelect":
                next = reduceChampSelect(prev, payload, now);
                break;
            case "gameflowSession": {
                const r = reduceGameflowSession(prev, payload, now);
                if (r.kind === "stale") {
                    this.log(`tracker: ignored stale gameflow session (${r.reason})`);
                    return;
                }
                if (r.kind === "invalid")
                    return;
                next = r.state;
                break;
            }
        }
        this.state = next;
        if (!samePartyState(prev, next))
            this.emitParty();
        const phaseBearing = input === "phase" || input === "gameflowSession";
        if (phaseBearing && next.phase !== this.lastPhase) {
            const from = this.lastPhase;
            const legal = isLegalTransition(from, next.phase);
            this.lastPhase = next.phase;
            if (legal && isInGamePhase(next.phase))
                this.inGameEntryLegal = true;
            if (!isInGamePhase(next.phase))
                this.inGameEntryLegal = false;
            this.emitPhase({ from, to: next.phase, legal, state: next });
            if (legal)
                await this.onLegalEdge(from, next.phase);
        }
        this.maybeStartGame(next);
    }
    async onLegalEdge(from, to) {
        if (to === "TerminatedInError")
            this.awaitingErrorResolution = true;
        if (from === "Reconnect" && to === "InProgress")
            this.awaitingErrorResolution = false;
        if (isEndOfGamePhase(to)) {
            this.awaitingErrorResolution = false;
            this.deferredTermination = false;
            await this.maybeEndGame(false);
        }
        else if (this.awaitingErrorResolution && (to === "None" || to === "Lobby")) {
            this.awaitingErrorResolution = false;
            await this.maybeEndGame(true);
        }
        else if (this.deferredTermination && (to === "None" || to === "Lobby")) {
            this.deferredTermination = false;
            await this.maybeEndGame(true);
        }
        if (to === "EndOfGame")
            this.maybeOpenPostGame();
        if (to === "Lobby" || to === "Matchmaking")
            this.collapsePostGame();
    }
    maybeStartGame(s) {
        if (!this.inGameEntryLegal || !isInGamePhase(s.phase) || s.gameId == null)
            return;
        if (this.gameContext?.gameId === s.gameId)
            return;
        const ctx = {
            gameId: s.gameId,
            queueId: s.queueId,
            partyId: s.partyId,
            memberPuuids: s.members.map((m) => m.puuid).filter(Boolean),
            startedAt: this.now(),
        };
        this.gameContext = ctx;
        persistContext(ctx);
        this.log(`tracker: game ${ctx.gameId} started (queue ${ctx.queueId ?? "?"})`);
        this.sendGame(SocketEvents.GAME_STARTED, {
            gameId: ctx.gameId,
            queueId: ctx.queueId ?? undefined,
            partyId: ctx.partyId,
            memberPuuids: ctx.memberPuuids,
        });
        for (const fn of this.gameListeners)
            safe(() => fn(ctx), this.deps.log);
    }
    async maybeEndGame(terminatedInError) {
        let gameId = this.gameContext?.gameId ?? this.state.gameId;
        if (gameId == null || gameId <= 0) {
            if (terminatedInError)
                return;
            gameId = await this.resolveEogGameId();
        }
        if (gameId == null || gameId <= 0) {
            this.log("tracker: game ended without a gameId");
            return;
        }
        if (this.lastEndedGameId === gameId && !(this.lastEndedWasError && !terminatedInError))
            return;
        this.lastEndedGameId = gameId;
        this.lastEndedWasError = terminatedInError;
        persistLastEnded(gameId);
        const ctx = this.gameContext;
        this.sendGame(SocketEvents.GAME_ENDED, {
            gameId,
            queueId: ctx?.queueId ?? this.state.queueId ?? undefined,
            partyId: ctx?.partyId ?? this.state.partyId,
            memberPuuids: ctx?.memberPuuids ?? this.state.members.map((m) => m.puuid).filter(Boolean),
            endedAt: this.now(),
            terminatedInError,
        });
    }
    async resolveEogGameId() {
        if (!this.deps.fetch)
            return null;
        const attempts = this.deps.eogAttempts ?? 60;
        const delay = this.deps.eogDelayMs ?? 1000;
        for (let i = 0; i < attempts; i++) {
            try {
                const block = await this.deps.fetch("eogStatsBlock");
                const parsed = readEog(block);
                if (parsed.local)
                    this.localEog = parsed.local;
                if (parsed.gameId) {
                    if (!this.gameContext) {
                        this.gameContext = {
                            gameId: parsed.gameId,
                            queueId: this.state.queueId,
                            partyId: this.state.partyId,
                            memberPuuids: this.state.members.map((m) => m.puuid).filter(Boolean),
                            startedAt: this.now(),
                        };
                        persistContext(this.gameContext);
                    }
                    return parsed.gameId;
                }
            }
            catch (e) {
                this.log(`tracker: eog read failed: ${e?.message ?? e}`);
            }
            if (i < attempts - 1 && delay > 0)
                await sleep(delay);
        }
        return null;
    }
    maybeOpenPostGame() {
        const gameId = this.gameContext?.gameId ?? this.state.gameId ?? this.lastEndedGameId;
        const hints = appStore.state.profileHints;
        const previous = appStore.state.postGame;
        appStore.update({
            uiTab: "postgame",
            postGame: {
                gameId: gameId ?? null,
                queueId: this.gameContext?.queueId ?? this.state.queueId,
                local: this.localEog ?? previous?.local ?? null,
                ready: previous?.ready && previous.ready.gameId === gameId ? previous.ready : null,
                mode: "full",
                dismissed: false,
                rankBefore: hints
                    ? { tier: hints.soloTier ?? null, division: hints.soloDivision ?? null }
                    : null,
            },
        });
        if (gameId == null || this.lastShownGameId === gameId)
            return;
        if (appStore.state.openOnGameEnd === false)
            return;
        this.lastShownGameId = gameId;
        try {
            getHostAdapter().showWindowInactive?.();
        }
        catch (e) {
            this.log(`tracker: show window failed: ${e?.message ?? e}`);
        }
    }
    collapsePostGame() {
        const cur = appStore.state.postGame;
        if (!cur || cur.dismissed || cur.mode === "hidden" || cur.mode === "banner")
            return;
        appStore.update({
            uiTab: appStore.state.uiTab === "postgame" ? "listing" : appStore.state.uiTab,
            postGame: { ...cur, mode: "banner" },
        });
    }
    sendGame(event, payload) {
        if (appStore.state.flags?.postgameLoop === false)
            return;
        try {
            if (this.deps.send)
                this.deps.send(event, payload);
            else
                syncAgent.send(event, payload);
        }
        catch (e) {
            this.log(`tracker: ${event} not sent: ${e?.message ?? e}`);
        }
    }
    isValid(input, data) {
        switch (input) {
            case "phase":
                return isGameflowPhase(data);
            case "lobby":
                return data == null || isLobbyShaped(data);
            case "gameflowSession":
                return data == null || (typeof data === "object" && isGameflowPhase(data.phase));
            case "champSelect":
                return data == null || (typeof data === "object" && Array.isArray(data.myTeam));
        }
    }
    async refetch(input) {
        if (!this.deps.fetch)
            return undefined;
        try {
            return await this.deps.fetch(REST_FALLBACK[input]);
        }
        catch (e) {
            this.log(`tracker: REST fallback for ${input} failed: ${e?.message ?? e}`);
            return undefined;
        }
    }
    emitParty() {
        for (const fn of this.partyListeners)
            safe(() => fn(this.state), this.deps.log);
    }
    emitPhase(edge) {
        this.scheduleReadyCheck(edge.to);
        for (const fn of this.phaseListeners)
            safe(() => fn(edge), this.deps.log);
    }
    scheduleReadyCheck(to) {
        if (to !== "ReadyCheck") {
            if (this.readyCheckTimer)
                clearTimeout(this.readyCheckTimer);
            this.readyCheckTimer = null;
            this.readyCheckAttempted = false;
            return;
        }
        if (this.readyCheckAttempted)
            return;
        const enabled = appStore.state.autoAcceptQueue === true;
        if (!enabled)
            return;
        this.readyCheckAttempted = true;
        this.readyCheckTimer = setTimeout(() => {
            this.readyCheckTimer = null;
            if (this.state.phase !== "ReadyCheck")
                return;
            void this.deps
                .fetch?.("readyCheckAccept")
                .then(() => this.log("ready-check auto-accepted"))
                .catch((e) => this.log(`ready-check auto-accept failed: ${e?.message ?? e}`));
        }, 1500);
    }
}
function readStoredContext() {
    try {
        if (typeof localStorage === "undefined")
            return null;
        const raw = localStorage.getItem(GAME_CONTEXT_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        return typeof parsed?.gameId === "number" && parsed.gameId > 0 ? parsed : null;
    }
    catch {
        return null;
    }
}
function readLastEnded() {
    try {
        if (typeof localStorage === "undefined")
            return null;
        const n = Number(localStorage.getItem(LAST_ENDED_KEY));
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    catch {
        return null;
    }
}
function persistContext(ctx) {
    try {
        if (typeof localStorage === "undefined")
            return;
        if (!ctx)
            localStorage.removeItem(GAME_CONTEXT_KEY);
        else
            localStorage.setItem(GAME_CONTEXT_KEY, JSON.stringify(ctx));
    }
    catch {
        /* host storage is best-effort */
    }
}
function persistLastEnded(gameId) {
    try {
        if (typeof localStorage === "undefined")
            return;
        localStorage.setItem(LAST_ENDED_KEY, String(gameId));
    }
    catch {
        /* ignore */
    }
}
function readEog(block) {
    if (!block || typeof block !== "object")
        return { gameId: null, local: null };
    const b = block;
    const gameId = Number(b.gameId ?? b.gameData?.gameId);
    const stats = b.localPlayer?.stats ?? {};
    const teams = Array.isArray(b.teams) ? b.teams : [];
    const playerTeam = teams.find((t) => t.isPlayerTeam) ?? teams[0];
    const win = typeof playerTeam?.isWinningTeam === "boolean"
        ? playerTeam.isWinningTeam
        : stats.WIN
            ? true
            : stats.LOSE
                ? false
                : null;
    return {
        gameId: Number.isFinite(gameId) && gameId > 0 ? gameId : null,
        local: {
            win,
            championId: Number(b.localPlayer?.championId) || null,
            kills: numberOrNull(stats.CHAMPIONS_KILLED),
            deaths: numberOrNull(stats.NUM_DEATHS),
            assists: numberOrNull(stats.ASSISTS),
            durationSec: Number(b.gameLength) || null,
        },
    };
}
function numberOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function safe(fn, log) {
    try {
        fn();
    }
    catch (e) {
        log?.(`tracker listener threw: ${e?.message ?? e}`);
    }
}
export const gameFlowTracker = new GameFlowTracker();
