import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import { RiotAccount } from "./riot-account.entity";
import { JoinRequest } from "./join-request.entity";
import type {
  ListingFilters,
  ListingParty,
  ListingQueueMeta,
  ListingSlot,
  ListingType,
} from "@lobly/shared-types";

@Entity("listings")
@Index("idx_listings_platform_status_queue", ["platform", "status", "queueId"])
@Index("idx_listings_expires_at", ["expiresAt"])
export class Listing {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "creator_account_id", type: "uuid" })
  creatorAccountId!: string;

  @ManyToOne(() => RiotAccount, (a) => a.listings, { onDelete: "CASCADE" })
  @JoinColumn({ name: "creator_account_id" })
  creatorAccount!: RiotAccount;

  @Column({ type: "text" })
  platform!: string;

  @Column({ name: "queue_id", type: "int" })
  queueId!: number;

  @Column({ type: "text" })
  type!: ListingType;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "text", default: "LISTED" })
  status!: string;

  @Column({ type: "jsonb", default: {} })
  filters!: ListingFilters;

  @Column({ type: "jsonb" })
  slots!: ListingSlot[];

  /** Live party snapshot from the creator's client. Default {}. */
  @Column({ type: "jsonb", default: {} })
  party!: ListingParty;

  @Column({ name: "queue_meta", type: "jsonb", default: {} })
  queueMeta!: ListingQueueMeta;

  @Column({ name: "voice_required", type: "boolean", default: false })
  voiceRequired!: boolean;

  @Column({ type: "text", array: true, default: "{}" })
  languages!: string[];

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "paused_at", type: "timestamptz", nullable: true })
  pausedAt!: Date | null;

  /** Set to NO_SEATS when the seat reconciler pauses the listing. */
  @Column({ name: "pause_reason", type: "text", nullable: true })
  pauseReason!: string | null;

  @Column({ name: "delisted_at", type: "timestamptz", nullable: true })
  delistedAt!: Date | null;

  @OneToMany(() => JoinRequest, (j) => j.listing)
  joinRequests?: JoinRequest[];
}
