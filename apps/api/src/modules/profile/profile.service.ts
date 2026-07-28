import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type {
  ProfileCard,
  ProfileSnapshot as ProfileSnapshotDto,
  UpdatePrefsBody,
  UserPrefs as UserPrefsDto,
  Role,
} from "@lobly/shared-types";
import {
  ChampionStat,
  ProfileSnapshot,
  RiotAccount,
  UserPrefs,
} from "../../database/entities";
import { ProfileJobsService, type RefreshPriority } from "./profile-jobs.service";
import { ChampionsService } from "./champions.service";
import { Optional, Inject, forwardRef } from "@nestjs/common";
import { ReputationService } from "../reputation/reputation.service";

export type FreshnessMoment =
  | "browsing"
  | "publishing"
  | "join_request"
  | "game_ended";

/**
 * How long an interactive caller (publish / join request) will wait for a
 * profile refresh before proceeding with the snapshot it already has.
 * Riot refreshes can fail outright (bad or missing key), so this must stay
 * short enough to feel instant in the UI.
 */
const INTERACTIVE_REFRESH_WAIT_MS = Number(
  process.env.PROFILE_REFRESH_WAIT_MS ?? 3000
);
const REFRESH_POLL_MS = 250;

const FRESHNESS_MS: Record<FreshnessMoment, number | "always"> = {
  browsing: 6 * 60 * 60 * 1000,
  publishing: 30 * 60 * 1000,
  join_request: 30 * 60 * 1000,
  game_ended: "always",
};

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(ProfileSnapshot) private readonly snapshots: Repository<ProfileSnapshot>,
    @InjectRepository(ChampionStat) private readonly champStats: Repository<ChampionStat>,
    @InjectRepository(UserPrefs) private readonly prefs: Repository<UserPrefs>,
    private readonly jobs: ProfileJobsService,
    private readonly champions: ChampionsService,
    @Optional()
    @Inject(forwardRef(() => ReputationService))
    private readonly reputation?: ReputationService
  ) {}

  async ensureFresh(
    accountId: string,
    moment: FreshnessMoment
  ): Promise<ProfileSnapshot | null> {
    const snap = await this.snapshots.findOne({ where: { riotAccountId: accountId } });
    const maxAge = FRESHNESS_MS[moment];
    const priority: RefreshPriority =
      moment === "publishing" || moment === "join_request"
        ? "interactive"
        : "background";

    if (maxAge === "always") {
      await this.jobs.enqueueRefresh(accountId, priority);
      return snap;
    }

    const age = snap ? Date.now() - snap.refreshedAt.getTime() : Infinity;
    if (age > maxAge) {
      if (moment === "browsing") {
        // serve stale, refresh in background
        await this.jobs.enqueueRefresh(accountId, "background");
        return snap;
      }
      // publishing / join_request: give the refresh a short head start, but
      // never hold the request open for it. A rank snapshot that is a few
      // minutes stale is fine; a publish that appears frozen is not.
      await this.jobs.enqueueRefresh(accountId, "interactive");
      const deadline = Date.now() + INTERACTIVE_REFRESH_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(REFRESH_POLL_MS);
        const fresh = await this.snapshots.findOne({
          where: { riotAccountId: accountId },
        });
        if (fresh && Date.now() - fresh.refreshedAt.getTime() <= maxAge) {
          return fresh;
        }
      }
      return snap ?? this.snapshots.findOne({ where: { riotAccountId: accountId } });
    }

    return snap;
  }

  async getCard(riotAccountId: string): Promise<ProfileCard> {
    const account = await this.accounts.findOne({ where: { id: riotAccountId } });
    if (!account) throw new NotFoundException({ code: "NOT_FOUND" });

    await this.ensureFresh(riotAccountId, "browsing");
    const snap = await this.snapshots.findOne({ where: { riotAccountId } });
    const champs = await this.champStats.find({
      where: { riotAccountId },
      order: { games: "DESC" },
      take: 10,
    });
    const prefs = await this.prefs.findOne({ where: { userId: account.userId } });
    const champMap = await this.champions.getChampionMap();

    const reputation = this.reputation
      ? await this.reputation.getReputationBlock(riotAccountId)
      : undefined;

    return {
      account: {
        id: account.id,
        puuid: account.puuid,
        riotId: account.riotId,
        tagLine: account.tagLine,
        platform: account.platform,
        summonerId: account.summonerId,
        verifiedAt: account.verifiedAt?.toISOString() ?? null,
        lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
      },
      snapshot: snap ? this.toSnapshotDto(snap) : null,
      champions: champs.map((c) => {
        const meta = champMap[String(c.championId)];
        return {
          championId: c.championId,
          season: c.season,
          games: c.games,
          wins: c.wins,
          kda: Number(c.kda),
          name: meta?.name,
          iconUrl: meta?.iconUrl,
        };
      }),
      prefs: prefs ? this.toPrefsDto(prefs) : null,
      reputation,
    };
  }

  async getMyCards(userId: string): Promise<ProfileCard[]> {
    // Without an explicit order Postgres returns rows arbitrarily, so any
    // caller falling back to "the first card" would get a different account
    // run to run. Most-recently-seen first is also the best default: it's
    // the account the player is actually using.
    const accounts = await this.accounts.find({
      where: { userId },
      order: { lastSeenAt: "DESC", verifiedAt: "DESC" },
    });
    return Promise.all(accounts.map((a) => this.getCard(a.id)));
  }

  async updatePrefs(userId: string, body: UpdatePrefsBody): Promise<UserPrefsDto> {
    let row = await this.prefs.findOne({ where: { userId } });
    if (!row) {
      row = this.prefs.create({
        userId,
        languages: body.languages ?? [],
        voice: body.voice ?? "NO_VOICE",
        vibeTags: body.vibeTags ?? [],
        discordTag: body.discordTag ?? null,
        discordReveal: body.discordReveal ?? "HIDDEN",
        autoAcceptLoblyInvites: body.autoAcceptLoblyInvites ?? false,
      });
    } else {
      if (body.languages !== undefined) row.languages = body.languages;
      if (body.voice !== undefined) row.voice = body.voice;
      if (body.vibeTags !== undefined) row.vibeTags = body.vibeTags;
      if (body.discordTag !== undefined) row.discordTag = body.discordTag;
      if (body.discordReveal !== undefined) row.discordReveal = body.discordReveal;
      if (body.autoAcceptLoblyInvites !== undefined) {
        row.autoAcceptLoblyInvites = body.autoAcceptLoblyInvites;
      }
    }
    row = await this.prefs.save(row);
    return this.toPrefsDto(row);
  }

  async getPrefs(userId: string): Promise<UserPrefsDto | null> {
    const row = await this.prefs.findOne({ where: { userId } });
    return row ? this.toPrefsDto(row) : null;
  }

  async getSnapshotEntity(accountId: string): Promise<ProfileSnapshot | null> {
    return this.snapshots.findOne({ where: { riotAccountId: accountId } });
  }

  toSnapshotDto(snap: ProfileSnapshot): ProfileSnapshotDto {
    return {
      riotAccountId: snap.riotAccountId,
      solo: {
        tier: snap.soloTier,
        division: snap.soloDivision,
        lp: snap.soloLp,
        wins: snap.soloWins,
        losses: snap.soloLosses,
      },
      flex: {
        tier: snap.flexTier,
        division: snap.flexDivision,
        lp: snap.flexLp,
        wins: snap.flexWins,
        losses: snap.flexLosses,
      },
      primaryRole: snap.primaryRole as Role | null,
      secondaryRole: snap.secondaryRole as Role | null,
      formWr20: snap.formWr20 != null ? Number(snap.formWr20) : null,
      streak: snap.streak,
      summonerLevel: snap.summonerLevel,
      profileIconId: snap.profileIconId,
      gamesThisSeason: snap.gamesThisSeason,
      refreshedAt: snap.refreshedAt.toISOString(),
    };
  }

  private toPrefsDto(row: UserPrefs): UserPrefsDto {
    return {
      languages: row.languages ?? [],
      voice: row.voice,
      vibeTags: row.vibeTags ?? [],
      discordTag: row.discordTag,
      discordReveal: row.discordReveal,
      autoAcceptLoblyInvites: row.autoAcceptLoblyInvites ?? false,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
