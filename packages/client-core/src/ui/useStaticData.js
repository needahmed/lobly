import { useEffect, useState } from "react";
import { fetchStaticData } from "../api/session";
let cache = null;
let inflight = null;
/**
 * Data Dragon asset maps (champions, spells, runes, URL templates), fetched
 * once per app run and shared across every component that renders Riot art.
 */
export function useStaticData() {
    const [data, setData] = useState(cache);
    useEffect(() => {
        if (cache)
            return;
        let alive = true;
        inflight ??= fetchStaticData();
        void inflight
            .then((d) => {
            cache = d;
            if (alive)
                setData(d);
        })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);
    return data;
}
export function championIcon(sd, championId) {
    return sd?.champions?.[String(championId)]?.iconUrl ?? null;
}
export function championDisplayName(sd, championId, fallback) {
    return sd?.champions?.[String(championId)]?.name ?? fallback ?? `#${championId}`;
}
export function itemIcon(sd, itemId) {
    if (!sd || !itemId)
        return null;
    return sd.itemIconTemplate.replace("{id}", String(itemId));
}
export function profileIcon(sd, iconId) {
    if (!sd || iconId == null)
        return null;
    return sd.profileIconTemplate.replace("{id}", String(iconId));
}
export function spellIcon(sd, spellId) {
    if (!sd || spellId == null)
        return null;
    return sd.summonerSpells?.[String(spellId)]?.iconUrl ?? null;
}
export function runeIcon(sd, runeId) {
    if (!sd || runeId == null)
        return null;
    return sd.runes?.[String(runeId)]?.iconUrl ?? null;
}
