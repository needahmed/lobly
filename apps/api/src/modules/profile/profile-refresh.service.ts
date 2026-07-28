import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import type { MatchDto, MatchParticipant } from "@lobly/riot-client";
import {
  ChampionStat,
  Match,
  MatchParticipation,
  MatchSeen,
  ProfileSnapshot,
  RiotAccount,
} from "../../database/entities";
import { RiotService } from "../riot/riot.service";
import {
  computeChampionStats,
  computeFormAndStreak,
  computeRoles,
  kdaString,
} from "./profile-compute";

const MAX_NEW_MATCHES = 30;
const CURRENT_SEASON = "2026";

@Injectable()
export class ProfileRefreshService {
  private readonly logger = new Logger(ProfileRefreshService.name);

  constructor(
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(ProfileSnapshot) private readonly snapshots: Repository<ProfileSnapshot>,
    @InjectRepository(ChampionStat) private readonly champStats: Repository<ChampionStat>,
    @InjectRepository(MatchSeen) private readonly matchesSeen: Repository<MatchSeen>,
    @InjectRepository(Match) private readonly matches: Repository<Match>,
    @InjectRepository(MatchParticipation)
    private readonly participations: Repository<MatchParticipation>,
    private readonly riot: RiotService,
    private readonly config: ConfigService
  ) {}

  async refresh(riotAccountId: string): Promise<void> {
    const account = await this.accounts.findOne({ where: { id: riotAccountId } });
    if (!account) {
      this.logger.warn(`account missing ${riotAccountId}`);
      return;
    }

    const { platform, puuid } = account;
    const region = this.riot.client.regionForPlatform(platform);

    const [entries, summoner] = await Promise.all([
      this.riot.client.leagueEntriesByPuuid(platform, puuid),
      this.riot.client.summonerByPuuid(platform, puuid),
    ]);

    const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
    const flex = entries.find((e) => e.queueType === "RANKED_FLEX_SR");

    const seasonStart = Number(this.config.get("SEASON_START_EPOCH") ?? 1743465600);
    const matchIds = await this.riot.client.matchIdsByPuuid(region, puuid, {
      startTime: seasonStart,
      count: 100,
    });

    const seenRows = matchIds.length
      ? await this.matchesSeen.find({
          where: { riotAccountId, matchId: In(matchIds) },
        })
      : [];
    const seen = new Set(seenRows.map((r) => r.matchId));
    const unseen = matchIds.filter((id) => !seen.has(id)).slice(0, MAX_NEW_MATCHES);

    this.logger.log(
      `account=${riotAccountId} matchIds=${matchIds.length} unseen=${unseen.length}`
    );

    const allMatches: MatchDto[] = [];
    const fetched = new Set<string>();

    // Delta: new matches first
    for (const matchId of unseen) {
      try {
        const m = await this.riot.client.matchById(region, matchId);
        allMatches.push(m);
        fetched.add(matchId);
        await this.matchesSeen.save(
          this.matchesSeen.create({ riotAccountId, matchId })
        );
      } catch (e) {
        this.logger.warn(`failed match ${matchId}: ${String(e)}`);
      }
    }

    // Fill role/form window with up to 60 recent match details
    const needDetail = Math.min(60, matchIds.length);
    for (const matchId of matchIds.slice(0, needDetail)) {
      if (fetched.has(matchId)) continue;
      try {
        const m = await this.riot.client.matchById(region, matchId);
        allMatches.push(m);
        fetched.add(matchId);
        if (!seen.has(matchId)) {
          await this.matchesSeen.save(
            this.matchesSeen.create({ riotAccountId, matchId })
          );
        }
      } catch (e) {
        this.logger.warn(`failed detail ${matchId}: ${String(e)}`);
      }
    }

    allMatches.sort((a, b) => b.info.gameCreation - a.info.gameCreation);

    await this.persistMatches(riotAccountId, puuid, platform, allMatches);

    const roles = computeRoles(allMatches, puuid);
    const champs = computeChampionStats(allMatches, puuid, 10);
    const { formWr20, streak } = computeFormAndStreak(allMatches, puuid);
    const gamesThisSeason = allMatches.filter((m) =>
      [420, 440].includes(m.info.queueId)
    ).length;

    await this.snapshots.save(
      this.snapshots.create({
        riotAccountId,
        soloTier: solo?.tier ?? null,
        soloDivision: solo?.rank ?? null,
        soloLp: solo?.leaguePoints ?? null,
        soloWins: solo?.wins ?? null,
        soloLosses: solo?.losses ?? null,
        flexTier: flex?.tier ?? null,
        flexDivision: flex?.rank ?? null,
        flexLp: flex?.leaguePoints ?? null,
        flexWins: flex?.wins ?? null,
        flexLosses: flex?.losses ?? null,
        primaryRole: roles.primaryRole,
        secondaryRole: roles.secondaryRole,
        formWr20: formWr20 != null ? String(formWr20) : null,
        streak,
        summonerLevel: summoner.summonerLevel,
        profileIconId: summoner.profileIconId,
        gamesThisSeason,
        refreshedAt: new Date(),
      })
    );

    await this.champStats.delete({ riotAccountId, season: CURRENT_SEASON });
    for (const c of champs) {
      await this.champStats.save(
        this.champStats.create({
          riotAccountId,
          championId: c.championId,
          season: CURRENT_SEASON,
          games: c.games,
          wins: c.wins,
          kda: kdaString(c.kills, c.deaths, c.assists),
        })
      );
    }
  }

  /**
   * Stores every fetched match plus this account's own row in it, so the
   * history UI never needs a Riot call. Upserts, because the same match is
   * re-seen whenever another linked account played in it.
   */
  private async persistMatches(
    riotAccountId: string,
    puuid: string,
    platform: string,
    matches: MatchDto[]
  ): Promise<void> {
    for (const m of matches) {
      const me = m.info.participants.find((p) => p.puuid === puuid);
      if (!me) continue;

      try {
        await this.matches.upsert(
          {
            matchId: m.metadata.matchId,
            platform,
            queueId: m.info.queueId,
            gameMode: m.info.gameMode ?? null,
            gameCreation: new Date(m.info.gameCreation),
            gameDuration: m.info.gameDuration,
            gameVersion: m.info.gameVersion ?? null,
            participants: m.info.participants,
            fetchedAt: new Date(),
          },
          ["matchId"]
        );

        await this.participations.upsert(
          {
            riotAccountId,
            matchId: m.metadata.matchId,
            win: me.win,
            championId: me.championId,
            championName: me.championName ?? null,
            champLevel: me.champLevel ?? null,
            teamPosition: me.teamPosition ?? null,
            teamId: me.teamId ?? null,
            kills: me.kills,
            deaths: me.deaths,
            assists: me.assists,
            cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),
            gold: me.goldEarned ?? 0,
            visionScore: me.visionScore ?? 0,
            damageDealt: me.totalDamageDealtToChampions ?? 0,
            damageTaken: me.totalDamageTaken ?? 0,
            items: itemsOf(me),
            summoner1Id: me.summoner1Id ?? null,
            summoner2Id: me.summoner2Id ?? null,
            primaryRune: me.perks?.styles?.[0]?.selections?.[0]?.perk ?? null,
            subStyle: me.perks?.styles?.[1]?.style ?? null,
            multikill: multikillOf(me),
            queueId: m.info.queueId,
            gameCreation: new Date(m.info.gameCreation),
            gameDuration: m.info.gameDuration,
          },
          ["riotAccountId", "matchId"]
        );
      } catch (e) {
        this.logger.warn(`persist match ${m.metadata.matchId}: ${String(e)}`);
      }
    }
  }
}

function itemsOf(p: MatchParticipant): number[] {
  return [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map(
    (i) => i ?? 0
  );
}

function multikillOf(p: MatchParticipant): number {
  if (p.pentaKills) return 5;
  if (p.quadraKills) return 4;
  if (p.tripleKills) return 3;
  if (p.doubleKills) return 2;
  return 0;
}
