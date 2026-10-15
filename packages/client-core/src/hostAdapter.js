let adapter = null;
export function configureLoblyCore(a) {
    adapter = a;
}
export function getHostAdapter() {
    if (!adapter) {
        throw new Error("@lobly/client-core: configureLoblyCore() must be called before use");
    }
    return adapter;
}
export function isCoreConfigured() {
    return adapter !== null;
}
/**
 * For UI-only JS contexts (a browser tab, an Electron renderer) that only
 * ever call the REST api/* helpers (fetchBoard, requestJoin, ...) and never
 * touch the LCU or the listing-machine/sync-agent bus directly — those live
 * in the host's main/background process, a SEPARATE JS context that must
 * configure the real adapter itself. Electron's main and renderer processes
 * in particular do not share module state, so each needs its own call to
 * configureLoblyCore(); the renderer only needs backendUrl to be correct.
 */
export function createNoopHostAdapter(backendUrl) {
    return {
        backendUrl,
        lcuTransport: {
            request() {
                return Promise.reject(new Error("LCU access is not available from this JS context"));
            },
        },
        eventBus: {
            start() { },
            stop() { },
            on() { },
        },
        isDesktopHidden: () => Promise.resolve(false),
    };
}
