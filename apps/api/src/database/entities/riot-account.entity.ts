import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./user.entity";
import { ProfileSnapshot } from "./profile-snapshot.entity";
import { ChampionStat } from "./champion-stat.entity";
import { Listing } from "./listing.entity";

@Entity("riot_accounts")
export class RiotAccount {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, (u) => u.riotAccounts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  /** The REAL Riot PUUID (78 chars), resolved server-side via account-v1. */
  @Column({ type: "text", unique: true })
  puuid!: string;

  /**
   * The short local UUID the League client reports for this account. Riot's
   * Web API rejects it, so it is never used for lookups — it exists only so
   * the presence heartbeat can match "who is logged in right now" against a
   * linked account.
   */
  @Column({ name: "lcu_puuid", type: "text", nullable: true })
  lcuPuuid!: string | null;

  @Column({ name: "riot_id", type: "text" })
  riotId!: string;

  @Column({ name: "tag_line", type: "text" })
  tagLine!: string;

  @Column({ name: "summoner_id", type: "bigint", nullable: true })
  summonerId!: string | null;

  @Column({ type: "text" })
  platform!: string;

  @Column({ name: "verified_at", type: "timestamptz", nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: "last_seen_at", type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @OneToOne(() => ProfileSnapshot, (s) => s.riotAccount)
  snapshot?: ProfileSnapshot;

  @OneToMany(() => ChampionStat, (c) => c.riotAccount)
  championStats?: ChampionStat[];

  @OneToMany(() => Listing, (l) => l.creatorAccount)
  listings?: Listing[];
}
