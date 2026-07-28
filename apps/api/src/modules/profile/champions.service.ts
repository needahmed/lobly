import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";

const CACHE_KEY = "static:champions";
const STATIC_KEY = "static:ddragon";
const TTL_SEC = 24 * 60 * 60;

export type ChampionMap = Record<
  string,
  { name: string; key: string; iconUrl: string }
>;

export interface StaticData {
  version: string;
  champions: ChampionMap;
  /** Summoner spell id -> icon url (e.g. 4 -> SummonerFlash.png). */
  summonerSpells: Record<string, { name: string; iconUrl: string }>;
  /** Rune / rune-tree id -> icon url. */
  runes: Record<string, { name: string; iconUrl: string }>;
  /** URL templates the client fills in — avoids hardcoding CDN paths in UI. */
  itemIconTemplate: string;
  profileIconTemplate: string;
}

@Injectable()
export class ChampionsService {
  private readonly logger = new Logger(ChampionsService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getChampionMap(): Promise<ChampionMap> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as ChampionMap;
    const data = await this.getStaticData();
    return data.champions;
  }

  /**
   * Everything the UI needs to render Riot art: champion/spell/rune maps
   * plus URL templates for id-addressable assets (items, profile icons).
   * Cached 24h — Data Dragon is immutable per patch.
   */
  async getStaticData(): Promise<StaticData> {
    const cached = await this.redis.get(STATIC_KEY);
    if (cached) return JSON.parse(cached) as StaticData;

    const versionsRes = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json"
    );
    const versions = (await versionsRes.json()) as string[];
    const version = versions[0];
    const cdn = `https://ddragon.leagueoflegends.com/cdn/${version}`;

    const [champRes, spellRes, runeRes] = await Promise.all([
      fetch(`${cdn}/data/en_US/champion.json`),
      fetch(`${cdn}/data/en_US/summoner.json`),
      fetch(`${cdn}/data/en_US/runesReforged.json`),
    ]);

    const champPayload = (await champRes.json()) as {
      data: Record<string, { key: string; id: string; name: string }>;
    };
    const champions: ChampionMap = {};
    for (const champ of Object.values(champPayload.data)) {
      champions[champ.key] = {
        name: champ.name,
        key: champ.id,
        iconUrl: `${cdn}/img/champion/${champ.id}.png`,
      };
    }

    const spellPayload = (await spellRes.json()) as {
      data: Record<string, { key: string; id: string; name: string }>;
    };
    const summonerSpells: StaticData["summonerSpells"] = {};
    for (const spell of Object.values(spellPayload.data)) {
      summonerSpells[spell.key] = {
        name: spell.name,
        iconUrl: `${cdn}/img/spell/${spell.id}.png`,
      };
    }

    // runesReforged paths are CDN-root relative and version-independent.
    const runePayload = (await runeRes.json()) as {
      id: number;
      name: string;
      icon: string;
      slots: { runes: { id: number; name: string; icon: string }[] }[];
    }[];
    const runes: StaticData["runes"] = {};
    for (const tree of runePayload) {
      runes[String(tree.id)] = {
        name: tree.name,
        iconUrl: `https://ddragon.leagueoflegends.com/cdn/img/${tree.icon}`,
      };
      for (const slot of tree.slots) {
        for (const rune of slot.runes) {
          runes[String(rune.id)] = {
            name: rune.name,
            iconUrl: `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`,
          };
        }
      }
    }

    const data: StaticData = {
      version,
      champions,
      summonerSpells,
      runes,
      itemIconTemplate: `${cdn}/img/item/{id}.png`,
      profileIconTemplate: `${cdn}/img/profileicon/{id}.png`,
    };

    await this.redis.set(STATIC_KEY, JSON.stringify(data), "EX", TTL_SEC);
    await this.redis.set(CACHE_KEY, JSON.stringify(champions), "EX", TTL_SEC);
    this.logger.log(
      `Cached DDragon v${version}: ${Object.keys(champions).length} champions, ` +
        `${Object.keys(summonerSpells).length} spells, ${Object.keys(runes).length} runes`
    );
    return data;
  }
}
