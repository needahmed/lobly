const DEBUG = true;
export function debugLog(...args) {
    if (DEBUG)
        console.log("[LOBLY]", ...args);
}
export function redactPuuid(puuid) {
    if (!puuid)
        return "";
    if (puuid.length <= 12)
        return puuid;
    return `${puuid.slice(0, 8)}…${puuid.slice(-4)}`;
}
