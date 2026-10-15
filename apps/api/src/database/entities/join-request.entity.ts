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
import { RiotAccount } from "./riot-account.entity";

@Entity("join_requests")
@Index("idx_join_requests_listing_status", ["listingId", "status"])
export class JoinRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "listing_id", type: "uuid" })
  listingId!: string;

  @ManyToOne(() => Listing, (l) => l.joinRequests, { onDelete: "CASCADE" })
  @JoinColumn({ name: "listing_id" })
  listing!: Listing;

  @Column({ name: "requester_account_id", type: "uuid" })
  requesterAccountId!: string;

  @ManyToOne(() => RiotAccount, { onDelete: "CASCADE" })
  @JoinColumn({ name: "requester_account_id" })
  requesterAccount!: RiotAccount;

  @Column({ name: "role_slot", type: "text", nullable: true })
  roleSlot!: string | null;

  @Column({ type: "text", default: "PENDING" })
  status!: string;

  @Column({ name: "match_score", type: "int", nullable: true })
  matchScore!: number | null;

  @Column({ name: "off_role", type: "boolean", default: false })
  offRole!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "decided_at", type: "timestamptz", nullable: true })
  decidedAt!: Date | null;

  /** Set when the creator's client reports the League invite was actually sent. */
  @Column({ name: "invite_sent_at", type: "timestamptz", nullable: true })
  inviteSentAt!: Date | null;
}
