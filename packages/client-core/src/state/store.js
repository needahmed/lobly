import { ListingStatus, } from "@lobly/shared-types";
class Store {
    listeners = new Set();
    state = {
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
        boardRevision: 0,
        pendingRequests: [],
        outgoingRequests: [],
        authChecked: false,
        authenticated: false,
        hasStoredSession: false,
        authExpired: false,
        apiUnreachable: false,
        accountMismatch: false,
        devAuthEnabled: false,
        notificationsEnabled: true,
        autoAcceptQueue: false,
        openOnGameEnd: true,
        postGame: null,
        queueDrift: false,
        signInPhase: null,
        linkedAccountIds: [],
        linkedRiotIds: [],
        linkedLcuPuuids: [],
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
    forwardWrite = null;
    subscribe(fn) {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }
    emit() {
        this.listeners.forEach((l) => l());
    }
    setWriteForwarder(fn) {
        this.forwardWrite = fn;
    }
    /**
     * Replace the whole state with an authoritative snapshot from the owning
     * process. Deliberately does NOT forward — that would echo straight back
     * to the sender.
     */
    applyRemoteState(next) {
        this.state = next;
        this.emit();
    }
    update(patch) {
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
    logLine(s) {
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
    forwardLog = null;
    setLogForwarder(fn) {
        this.forwardLog = fn;
    }
    setToast(message) {
        this.update({ toast: { message, at: Date.now() } });
    }
    clearToast() {
        this.update({ toast: null });
    }
    /** Drop the signed-in session. League client connection stays. */
    resetForSignOut() {
        this.update({
            authenticated: false,
            authExpired: false,
            hasStoredSession: false,
            accountMismatch: false,
            authChecked: true,
            apiUnreachable: false,
            signInPhase: null,
            riotAccountId: undefined,
            profileHints: undefined,
            listing: { status: ListingStatus.DRAFT },
            myListing: null,
            publishDraft: null,
            pendingRequests: [],
            outgoingRequests: [],
            session: undefined,
            endorsePrompt: null,
            manualInvite: null,
            linkedAccountIds: [],
            linkedRiotIds: [],
            linkedLcuPuuids: [],
            uiTab: "profile",
        });
    }
}
export const appStore = new Store();
