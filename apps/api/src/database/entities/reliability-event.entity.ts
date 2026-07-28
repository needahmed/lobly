import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("reliability_events")
@Index("idx_reliability_account_at", ["accountId", "at"])
export class ReliabilityEvent {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "account_id", type: "uuid" })
  accountId!: string;

  @Column({ name: "session_id", type: "uuid", nullable: true })
  sessionId!: string | null;

  @Column({ name: "join_request_id", type: "uuid", nullable: true })
  joinRequestId!: string | null;

  @Column({ type: "text" })
  kind!: string;

  @CreateDateColumn({ name: "at", type: "timestamptz" })
  at!: Date;
}
