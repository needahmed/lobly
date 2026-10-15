import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import type {
  BoardRow,
  BoardSort,
  Role,
  UserPrefs,
} from "@lobly/shared-types";
import {
  normalizeSlots,
  queueMetaFromQueueId,
  rankToInt,
} from "@lobly/shared-types";
import {
  JoinRequest,
  Listing,
  ProfileSnapshot,
  RiotAccount,
  UserPrefs as UserPrefsEntity,
  ChampionStat,
} from "../../database/entities";
import { ProfileService } from "../profile/profile.service";
import { ChampionsService } from "../profile/champions.service";
import { evaluateEligibility } from "./eligibility";
import { matchScore } from "./match-score";
import { BoardCacheService } from "./board-cache.service";
import { ListingsService } from "./listings.service";
import { ReputationService } from "../reputation/reputation.service";
import { FlagsService } from "../config/flags.service";

function parseRankBound(raw?: string): number | null {
  if (!raw) return null;
  // Accept "GOLD" or "GOLD_II" / "GOLD II" / "GOLD-II"
  const cleaned = raw.trim().toUpperCase().replace(/[-\s]+/g, "_");
  const [tier, div] = cleaned.split("_");
  return rankToInt(tier, div ?? "IV");
}

@Injectable()
export class BoardService {
  constructor(
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(JoinRequest) private readonly joinRequests: Repository<JoinRequest>,
    @InjectRepository(RiotAccount) private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(ProfileSnapshot) private readonly snapshots: Repository<ProfileSnapshot>,
    @InjectRepository(UserPrefsEntity) private readonly prefsRepo: Repository<UserPrefsEntity>,
    @InjectRepository(ChampionStat) private readonly champStats: Repository<ChampionStat>,
    private readonly profiles: ProfileService,
    private readonly champions: ChampionsService,
    private readonly cache: BoardCacheService,
    private readonly listingsService: ListingsService,
    @Optional() private readonly reputation?: ReputationService,
    @Optional() private readonly flags?: FlagsService
  ) {}

  async browse(
    userId: string,
    query: {
      queueId?: number;
      roles?: string;
      minRank?: string;
      maxRank?: string;
      voice?: string;
      language?: string;
      sort?: BoardSort;
      riotAccountId?: string;
    }
  ): Promise<BoardRow[]> {
    const viewerAccount = await this.resolveViewerAccount(userId, query.riotAccountId);
    await this.profiles.ensureFresh(viewerAccount.id, "browsing");

    const snap = await this.snapshots.findOne({
      where: { riotAccountId: viewerAccount.id },
    });
    if (!snap) {
      throw new BadRequestException({
        code: "NO_SNAPSHOT",
        message: "Profile snapshot not ready yet — try again shortly",
      });
    }

    const prefsRow = await this.prefsRepo.findOne({ where: { userId } });
    const prefs: UserPrefs | null = prefsRow
      ? {
          languages: prefsRow.languages ?? [],
          voice: prefsRow.voice,
          vibeTags: prefsRow.vibeTags ?? [],
          discordTag: prefsRow.discordTag,
          discordReveal: prefsRow.discordReveal,
          autoAcceptLoblyInvites: prefsRow.autoAcceptLoblyInvites ?? false,
        }
      : null;

    const flags = this.flags?.getFlags();
    if (flags && flags.board === false) return [];
    if (
      flags?.allowedPlatforms?.length &&
      !flags.allowedPlatforms.includes(viewerAccount.platform)
    ) {
      return [];
    }

    const blocked = this.reputation
      ? await this.reputation.getBlockedPairsForViewer(viewerAccount.id)
      : new Set<string>();
    const viewerReliability = this.reputation
      ? await this.reputation.getReliability(viewerAccount.id)
      : null;

    const candidateIds = await this.cache.getCandidateIds(
      viewerAccount.platform,
      query.queueId
    );

    const candidates = candidateIds.length
      ? await this.listings.find({ where: { id: In(candidateIds) } })
      : [];

    // Own listing may be PAUSED/READY and missing from the candidate cache —
    // always merge it in so "Find Team" shows your lobby.
    const ownSummary = await this.listingsService.mine(userId);
    let ownRow: Listing | null = null;
    if (ownSummary) {
      ownRow = await this.listings.findOne({ where: { id: ownSummary.id } });
      if (ownRow && !candidates.some((c) => c.id === ownRow!.id)) {
        if (query.queueId == null || ownRow.queueId === query.queueId) {
          candidates.unshift(ownRow);
        }
      }
    }

    const myRequestByListing = await this.loadMyRequests(
      userId,
      candidates.map((c) => c.id)
    );

    const creatorIds = [...new Set(candidates.map((c) => c.creatorAccountId))];
    const creators = creatorIds.length
      ? await this.accounts.find({ where: { id: In(creatorIds) } })
      : [];
    const creatorSnaps = creatorIds.length
      ? await this.snapshots.find({ where: { riotAccountId: In(creatorIds) } })
      : [];
    const creatorChamps = creatorIds.length
      ? await this.champStats.find({
          where: { riotAccountId: In(creatorIds) },
          order: { games: "DESC" },
        })
      : [];
    const champMap = await this.champions.getChampionMap();

    const creatorById = new Map(creators.map((c) => [c.id, c]));
    const snapById = new Map(creatorSnaps.map((s) => [s.riotAccountId, s]));
    const champsById = new Map<string, ChampionStat[]>();
    for (const c of creatorChamps) {
      const arr = champsById.get(c.riotAccountId) ?? [];
      if (arr.length < 3) arr.push(c);
      champsById.set(c.riotAccountId, arr);
    }

    const viewerSnapView = {
      platform: viewerAccount.platform,
      soloTier: snap.soloTier,
      soloDivision: snap.soloDivision,
      flexTier: snap.flexTier,
      flexDivision: snap.flexDivision,
      primaryRole: snap.primaryRole as Role | null,
      secondaryRole: snap.secondaryRole as Role | null,
      gamesThisSeason: snap.gamesThisSeason,
    };

    const roleFilter = query.roles
      ? new Set(query.roles.split(",").map((r) => r.trim().toUpperCase()))
      : null;
    const viewerMinRank = parseRankBound(query.minRank);
    const viewerMaxRank = parseRankBound(query.maxRank);

    const rows: BoardRow[] = [];
    for (const listing of candidates) {
      const isOwn = listing.creatorAccountId === viewerAccount.id;
      if (!isOwn && blocked.has(listing.creatorAccountId)) continue;
      if (query.voice === "required" && !listing.voiceRequired) continue;
      if (query.language) {
        const lang = query.language.toLowerCase();
        if (!listing.languages?.some((l) => l.toLowerCase() === lang)) continue;
      }

      const slots = normalizeSlots(listing.slots);
      if (roleFilter) {
        const open = slots.filter((s) => s.open);
        const hit = open.some(
          (s) =>
            s.roles.length === 0 ||
            s.roles.some((r) => roleFilter.has(r))
        );
        if (!hit) continue;
      }

      const creator = creatorById.get(listing.creatorAccountId);
      const creatorSnap = snapById.get(listing.creatorAccountId);
      if (!creator || !creatorSnap) continue;

      const meta =
        listing.queueMeta && Object.keys(listing.queueMeta).length
          ? listing.queueMeta
          : queueMetaFromQueueId(listing.queueId);

      // Viewer-side rank filter against the creator's displayed rank
      if (!isOwn && (viewerMinRank != null || viewerMaxRank != null)) {
        const useFlex = meta.rankSource === "flex";
        const cInt = rankToInt(
          useFlex ? creatorSnap.flexTier : creatorSnap.soloTier,
          useFlex ? creatorSnap.flexDivision : creatorSnap.soloDivision
        );
        if (cInt == null) continue;
        if (viewerMinRank != null && cInt < viewerMinRank) continue;
        if (viewerMaxRank != null && cInt > viewerMaxRank) continue;
      }

      const elig = isOwn
        ? { eligible: true, reasons: [] as string[], offRole: false, provisional: false }
        : evaluateEligibility(
            {
              ...listing,
              slots,
              queueMeta: meta,
            },
            viewerSnapView,
            prefs,
            {
              soloTier: creatorSnap.soloTier,
              soloDivision: creatorSnap.soloDivision,
            },
            null,
            {
              blocked: false,
              reliability: viewerReliability,
            }
          );

      const score = isOwn
        ? 100
        : matchScore(
            {
              ...listing,
              slots,
              queueMeta: meta,
            },
            {
              soloTier: creatorSnap.soloTier,
              soloDivision: creatorSnap.soloDivision,
              flexTier: creatorSnap.flexTier,
              flexDivision: creatorSnap.flexDivision,
              primaryRole: creatorSnap.primaryRole as Role | null,
              secondaryRole: creatorSnap.secondaryRole as Role | null,
            },
            viewerSnapView,
            prefs
          );

      const useFlex = meta.rankSource === "flex";
      const top = (champsById.get(creator.id) ?? []).map((c) => {
        const metaChamp = champMap[String(c.championId)];
        return {
          championId: c.championId,
          name: metaChamp?.name,
          iconUrl: metaChamp?.iconUrl,
        };
      });

      const creatorRep = this.reputation
        ? await this.reputation.getReputationBlock(creator.id)
        : null;

      rows.push({
        listing: this.listingsService.toSummary(listing),
        creator: {
          riotId: creator.riotId,
          tagLine: creator.tagLine,
          platform: creator.platform,
          tier: useFlex ? creatorSnap.flexTier : creatorSnap.soloTier,
          division: useFlex ? creatorSnap.flexDivision : creatorSnap.soloDivision,
          lp: useFlex ? creatorSnap.flexLp : creatorSnap.soloLp,
          primaryRole: creatorSnap.primaryRole as Role | null,
          topChampions: top,
          formWr20:
            creatorSnap.formWr20 != null ? Number(creatorSnap.formWr20) : null,
        },
        matchScore: score,
        offRole: elig.offRole,
        eligible: elig.eligible,
        reasons: elig.reasons,
        provisional: creatorRep?.provisional ?? elig.provisional,
        reliability: creatorRep?.reliability ?? null,
        isOwn,
        myRequest: myRequestByListing.get(listing.id) ?? null,
      });
    }

    const sort = query.sort ?? "score";
    rows.sort((a, b) => {
      // Own listing always pinned first
      if (a.isOwn && !b.isOwn) return -1;
      if (!a.isOwn && b.isOwn) return 1;
      if (sort === "newest") {
        return (
          Date.parse(b.listing.createdAt) - Date.parse(a.listing.createdAt)
        );
      }
      if (sort === "rank") {
        const ai = rankToInt(a.creator.tier, a.creator.division) ?? -1;
        const bi = rankToInt(b.creator.tier, b.creator.division) ?? -1;
        return bi - ai;
      }
      // Eligible before ineligible, then by score
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.matchScore - a.matchScore;
    });

    return rows.slice(0, 50);
  }

  private async loadMyRequests(
    userId: string,
    listingIds: string[]
  ): Promise<Map<string, { id: string; status: string }>> {
    const map = new Map<string, { id: string; status: string }>();
    if (!listingIds.length) return map;
    const mine = await this.accounts.find({ where: { userId } });
    const accountIds = mine.map((a) => a.id);
    if (!accountIds.length) return map;
    const rows = await this.joinRequests.find({
      where: {
        listingId: In(listingIds),
        requesterAccountId: In(accountIds),
        status: In(["PENDING", "ACCEPTED"]),
      },
      order: { createdAt: "DESC" },
    });
    for (const row of rows) {
      const prev = map.get(row.listingId);
      if (!prev || (row.status === "ACCEPTED" && prev.status !== "ACCEPTED")) {
        map.set(row.listingId, { id: row.id, status: row.status });
      }
    }
    return map;
  }

  private async resolveViewerAccount(
    userId: string,
    riotAccountId?: string
  ): Promise<RiotAccount> {
    if (riotAccountId) {
      const a = await this.accounts.findOne({
        where: { id: riotAccountId, userId },
      });
      if (!a) throw new BadRequestException({ code: "ACCOUNT_NOT_YOURS" });
      return a;
    }
    const accounts = await this.accounts.find({
      where: { userId },
      order: { lastSeenAt: "DESC" },
    });
    if (!accounts.length) {
      throw new BadRequestException({
        code: "NO_RIOT_ACCOUNT",
        message: "Link a Riot account first",
      });
    }
    return accounts[0];
  }
}
