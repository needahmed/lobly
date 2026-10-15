import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Listing } from "./listing.entity";

@Entity("sessions")
@Index("idx_sessions_listing", ["listingId"])
export class Session {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "listing_id", type: "uuid", nullable: true })
  listingId!: string | null;

  /** LISTING for matchmade sessions. ORGANIC stays unused while the flag is off. */
  @Column({ type: "text", default: "LISTING" })
  source!: string;

  @ManyToOne(() => Listing, { onDelete: "CASCADE" })
  @JoinColumn({ name: "listing_id" })
  listing!: Listing;

  @Column({ name: "member_account_ids", type: "uuid", array: true })
  memberAccountIds!: string[];

  @Column({ name: "league_lobby_confirmed_at", type: "timestamptz", nullable: true })
  leagueLobbyConfirmedAt!: Date | null;

  @Column({ name: "started_queue_at", type: "timestamptz", nullable: true })
  startedQueueAt!: Date | null;

  @Column({ name: "games_played", type: "int", default: 0 })
  gamesPlayed!: number;

  /** Riot-confirmed game ids. Also the idempotency set for gamesPlayed. */
  @Column({ name: "riot_verified_game_ids", type: "bigint", array: true, default: "{}" })
  riotVerifiedGameIds!: string[];

  @Column({ name: "ended_at", type: "timestamptz", nullable: true })
  endedAt!: Date | null;

  @Column({ name: "chat_open_until", type: "timestamptz", nullable: true })
  chatOpenUntil!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
