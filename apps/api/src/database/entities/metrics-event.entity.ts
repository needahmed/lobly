import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("metrics_events")
@Index("idx_metrics_name_at", ["name", "at"])
export class MetricsEvent {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ name: "account_id", type: "uuid", nullable: true })
  accountId!: string | null;

  @Column({ name: "listing_id", type: "uuid", nullable: true })
  listingId!: string | null;

  @Column({ name: "session_id", type: "uuid", nullable: true })
  sessionId!: string | null;

  @Column({ name: "join_request_id", type: "uuid", nullable: true })
  joinRequestId!: string | null;

  @Column({ type: "jsonb", default: {} })
  meta!: Record<string, unknown>;

  @CreateDateColumn({ name: "at", type: "timestamptz" })
  at!: Date;
}
