import { useEffect, useState } from "react";
import { fetchStaticData, type StaticData } from "../api/session";

let cache: StaticData | null = null;
let inflight: Promise<StaticData> | null = null;

/**
 * Data Dragon asset maps (champions, spells, runes, URL templates), fetched
 * once per app run and shared across every component that renders Riot art.
 */
export function useStaticData(): StaticData | null {
  const [data, setData] = useState<StaticData | null>(cache);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    inflight ??= fetchStaticData();
    void inflight
      .then((d) => {
        cache = d;
        if (alive) setData(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return data;
}

export function championIcon(sd: StaticData | null, championId: number): string | null {
  return sd?.champions?.[String(championId)]?.iconUrl ?? null;
}

export function championDisplayName(
  sd: StaticData | null,
  championId: number,
  fallback?: string | null
): string {
  return sd?.champions?.[String(championId)]?.name ?? fallback ?? `#${championId}`;
}

export function itemIcon(sd: StaticData | null, itemId: number): string | null {
  if (!sd || !itemId) return null;
  return sd.itemIconTemplate.replace("{id}", String(itemId));
}

export function profileIcon(sd: StaticData | null, iconId?: number | null): string | null {
  if (!sd || iconId == null) return null;
  return sd.profileIconTemplate.replace("{id}", String(iconId));
}

export function spellIcon(sd: StaticData | null, spellId?: number | null): string | null {
  if (!sd || spellId == null) return null;
  return sd.summonerSpells?.[String(spellId)]?.iconUrl ?? null;
}

export function runeIcon(sd: StaticData | null, runeId?: number | null): string | null {
  if (!sd || runeId == null) return null;
  return sd.runes?.[String(runeId)]?.iconUrl ?? null;
}
