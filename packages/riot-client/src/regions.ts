export type Platform =
  | "euw1"
  | "eun1"
  | "tr1"
  | "ru"
  | "me1"
  | "na1"
  | "br1"
  | "la1"
  | "la2"
  | "jp1"
  | "oc1"
  | "sg2"
  | "tw2"
  | "vn2"
  | "kr";

export type RegionalRoute = "europe" | "americas" | "asia" | "sea";

/** Platform → regional routing map (00_BUILD_OVERVIEW §8.2). */
export const PLATFORM_TO_REGION: Record<Platform, RegionalRoute> = {
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  me1: "europe", // Middle East shard — not in the original platform list, routes via EMEA
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  jp1: "asia",
  kr: "asia",
  oc1: "sea",
  sg2: "sea",
  tw2: "sea",
  vn2: "sea",
};

export const BLOCKED_PLATFORMS = new Set<string>(["kr"]);

export function platformHost(platform: string): string {
  return `https://${platform}.api.riotgames.com`;
}

export function regionalHost(region: RegionalRoute | string): string {
  return `https://${region}.api.riotgames.com`;
}

export function isKnownPlatform(platform: string): platform is Platform {
  return Object.prototype.hasOwnProperty.call(PLATFORM_TO_REGION, platform);
}

export function regionForPlatform(platform: string): RegionalRoute {
  const mapped = PLATFORM_TO_REGION[platform as Platform];
  if (!mapped) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return mapped;
}
