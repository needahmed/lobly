import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("reports")
@Index("idx_reports_status_created", ["status", "createdAt"])
export class Report {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "reporter_account_id", type: "uuid", nullable: true })
  reporterAccountId!: string | null;

  @Column({ name: "reported_account_id", type: "uuid" })
  reportedAccountId!: string;

  @Column({ name: "session_id", type: "uuid", nullable: true })
  sessionId!: string | null;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "text", nullable: true })
  detail!: string | null;

  @Column({ type: "text", default: "OPEN" })
  status!: string;

  @Column({ name: "admin_action", type: "text", nullable: true })
  adminAction!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "resolved_at", type: "timestamptz", nullable: true })
  resolvedAt!: Date | null;
}
