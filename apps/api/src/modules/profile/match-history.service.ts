import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { MatchParticipant } from "@lobly/riot-client";
import {
  Match,
  MatchParticipation,
  RiotAccount,
} from "../../database/entities";

export interface MatchHistoryRow {
  matchId: string;
  queueId: number;
  gameMode: string | null;
  gameCreation: string;
  gameDuration: number;
  win: boolean;
  championId: number;
  championName: string | null;
  champLevel: number | null;
  teamPosition: string | null;
  kills: number;
  deaths: number;
  assists: number;
  kda: number | null;
  cs: number;
  csPerMin: number;
  gold: number;
  visionScore: number;
  damageDealt: number;
  damageTaken: number;
  /** Share of own team's champion damage, 0-100. */
  damageShare: number | null;
  killParticipation: number | null;
  items: number[];
  summoner1Id: number | null;
  summoner2Id: number | null;
  primaryRune: number | null;
  subStyle: number | null;
  multikill: number;
  teammates: MatchScoreboardEntry[];
  opponents: MatchScoreboardEntry[];
}

export interface MatchScoreboardEntry {
  puuid: string;
  riotId: string;
  championId: number;
  championName: string | null;
  teamPosition: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damageDealt: number;
  items: number[];
  win: boolean;
  isMe: boolean;
}

@Injectable()
export class MatchHistoryService {
  constructor(
    @InjectRepository(MatchParticipation)
    private readonly participations: Repository<MatchParticipation>,
    @InjectRepository(Match) private readonly matches: Repository<Match>,
    @InjectRepository(RiotAccount)
    private readonly accounts: Repository<RiotAccount>
  ) {}

  async list(
    riotAccountId: string,
    opts: { limit?: number; queueId?: number } = {}
  ): Promise<MatchHistoryRow[]> {
    const account = await this.accounts.findOne({ where: { id: riotAccountId } });
    if (!account) throw new NotFoundException({ code: "NOT_FOUND" });

    const limit = Math.min(opts.limit ?? 20, 50);
    const qb = this.participations
      .createQueryBuilder("p")
      .where("p.riot_account_id = :id", { id: riotAccountId })
      .orderBy("p.game_creation", "DESC")
      .take(limit);
    if (opts.queueId) qb.andWhere("p.queue_id = :q", { q: opts.queueId });

    const rows = await qb.getMany();
    if (!rows.length) return [];

    const matchRows = await this.matches.findByIds(rows.map((r) => r.matchId));
    const byId = new Map(matchRows.map((m) => [m.matchId, m]));

    return rows.map((r) => this.toRow(r, byId.get(r.matchId), account.puuid));
  }

  private toRow(
    p: MatchParticipation,
    match: Match | undefined,
    myPuuid: string
  ): MatchHistoryRow {
    const all = match?.participants ?? [];
    const myTeam = all.filter((x) => x.teamId === p.teamId);
    const enemyTeam = all.filter((x) => x.teamId !== p.teamId);

    const teamDamage = myTeam.reduce(
      (sum, x) => sum + (x.totalDamageDealtToChampions ?? 0),
      0
    );
    const teamKills = myTeam.reduce((sum, x) => sum + x.kills, 0);
    const minutes = p.gameDuration > 0 ? p.gameDuration / 60 : 0;

    return {
      matchId: p.matchId,
      queueId: p.queueId,
      gameMode: match?.gameMode ?? null,
      gameCreation: p.gameCreation.toISOString(),
      gameDuration: p.gameDuration,
      win: p.win,
      championId: p.championId,
      championName: p.championName,
      champLevel: p.champLevel,
      teamPosition: p.teamPosition,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      // Perfect KDA (0 deaths) has no finite value — null, so the UI can
      // render "Perfect" instead of a misleading number.
      kda: p.deaths === 0 ? null : round2((p.kills + p.assists) / p.deaths),
      cs: p.cs,
      csPerMin: minutes > 0 ? round2(p.cs / minutes) : 0,
      gold: p.gold,
      visionScore: p.visionScore,
      damageDealt: p.damageDealt,
      damageTaken: p.damageTaken,
      damageShare:
        teamDamage > 0 ? Math.round((p.damageDealt / teamDamage) * 100) : null,
      killParticipation:
        teamKills > 0
          ? Math.round(((p.kills + p.assists) / teamKills) * 100)
          : null,
      items: p.items ?? [],
      summoner1Id: p.summoner1Id,
      summoner2Id: p.summoner2Id,
      primaryRune: p.primaryRune,
      subStyle: p.subStyle,
      multikill: p.multikill,
      teammates: myTeam.map((x) => this.toEntry(x, myPuuid)),
      opponents: enemyTeam.map((x) => this.toEntry(x, myPuuid)),
    };
  }

  private toEntry(x: MatchParticipant, myPuuid: string): MatchScoreboardEntry {
    const name = x.riotIdGameName ?? x.summonerName ?? "Unknown";
    return {
      puuid: x.puuid,
      riotId: x.riotIdTagline ? `${name}#${x.riotIdTagline}` : name,
      championId: x.championId,
      championName: x.championName ?? null,
      teamPosition: x.teamPosition ?? null,
      kills: x.kills,
      deaths: x.deaths,
      assists: x.assists,
      cs: (x.totalMinionsKilled ?? 0) + (x.neutralMinionsKilled ?? 0),
      damageDealt: x.totalDamageDealtToChampions ?? 0,
      items: [x.item0, x.item1, x.item2, x.item3, x.item4, x.item5, x.item6].map(
        (i) => i ?? 0
      ),
      win: x.win,
      isMe: x.puuid === myPuuid,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
