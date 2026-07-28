import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  Block,
  ChampionStat,
  ChatMessage,
  Endorsement,
  JoinRequest,
  Listing,
  MatchSeen,
  ProfileSnapshot,
  ReliabilityEvent,
  Report,
  RiotAccount,
  Session,
  User,
  UserPrefs,
} from "../../database/entities";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RiotAccount)
    private readonly accounts: Repository<RiotAccount>,
    @InjectRepository(ProfileSnapshot)
    private readonly snapshots: Repository<ProfileSnapshot>,
    @InjectRepository(ChampionStat)
    private readonly champs: Repository<ChampionStat>,
    @InjectRepository(MatchSeen)
    private readonly matches: Repository<MatchSeen>,
    @InjectRepository(UserPrefs) private readonly prefs: Repository<UserPrefs>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(JoinRequest) private readonly joins: Repository<JoinRequest>,
    @InjectRepository(ChatMessage)
    private readonly chat: Repository<ChatMessage>,
    @InjectRepository(Endorsement)
    private readonly endorsements: Repository<Endorsement>,
    @InjectRepository(Block) private readonly blocks: Repository<Block>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(ReliabilityEvent)
    private readonly reliability: Repository<ReliabilityEvent>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>
  ) {}

  async deleteMe(userId: string): Promise<{ ok: true }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: "NOT_FOUND" });

    const accounts = await this.accounts.find({ where: { userId } });
    const accountIds = accounts.map((a) => a.id);

    if (accountIds.length) {
      await this.chat.delete({ fromAccountId: In(accountIds) });
      await this.endorsements.delete({ fromAccountId: In(accountIds) });
      await this.endorsements.delete({ toAccountId: In(accountIds) });
      await this.reliability.delete({ accountId: In(accountIds) });
      await this.blocks.delete({ blockerAccountId: In(accountIds) });
      await this.blocks.delete({ blockedAccountId: In(accountIds) });
      await this.reports.update(
        { reporterAccountId: In(accountIds) },
        { reporterAccountId: null as unknown as string }
      );
      await this.joins.delete({ requesterAccountId: In(accountIds) });
      await this.listings.delete({ creatorAccountId: In(accountIds) });
      await this.champs.delete({ riotAccountId: In(accountIds) });
      await this.matches.delete({ riotAccountId: In(accountIds) });
      await this.snapshots.delete({ riotAccountId: In(accountIds) });

      // Remove user from open sessions membership
      const openSessions = await this.sessions.find();
      for (const s of openSessions) {
        if (s.memberAccountIds.some((id) => accountIds.includes(id))) {
          s.memberAccountIds = s.memberAccountIds.filter(
            (id) => !accountIds.includes(id)
          );
          await this.sessions.save(s);
        }
      }

      await this.accounts.delete({ id: In(accountIds) });
    }

    await this.prefs.delete({ userId });
    await this.users.delete({ id: userId });
    return { ok: true };
  }
}
