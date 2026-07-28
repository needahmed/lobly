import type { ReliabilityKind } from "@lobly/shared-types";

export function computeReliabilityScore(
  events: { kind: string }[]
): number | null {
  if (!events.length) return null;

  let noshow = 0;
  let abandoned = 0;
  let showed = 0;
  let completed = 0;
  for (const e of events) {
    const k = e.kind as ReliabilityKind;
    if (k === "NO_SHOW") noshow++;
    else if (k === "ABANDONED") abandoned++;
    else if (k === "SHOWED") showed++;
    else if (k === "COMPLETED") completed++;
  }

  let score =
    100 -
    15 * noshow -
    20 * abandoned +
    Math.min(10, 1 * showed) +
    Math.min(10, 2 * completed);
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

export function isProvisional(opts: {
  reliability: number | null;
  summonerLevel: number | null;
  gamesThisSeason: number | null;
}): boolean {
  if (opts.reliability == null) return true;
  if ((opts.summonerLevel ?? 0) < 30) return true;
  if ((opts.gamesThisSeason ?? 0) === 0) return true;
  return false;
}
