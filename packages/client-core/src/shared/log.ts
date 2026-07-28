const DEBUG = true;

export function debugLog(...args: unknown[]) {
  if (DEBUG) console.log("[LOBLY]", ...args);
}

export function redactPuuid(puuid: string | undefined): string {
  if (!puuid) return "";
  if (puuid.length <= 12) return puuid;
  return `${puuid.slice(0, 8)}…${puuid.slice(-4)}`;
}
