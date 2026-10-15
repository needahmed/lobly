import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("game_reports")
@Index("idx_game_reports_session", ["sessionId"])
export class GameReport {
  @PrimaryColumn({ name: "game_id", type: "bigint" })
  gameId!: string;

  @PrimaryColumn({ type: "text" })
  platform!: string;

  @PrimaryColumn({ name: "riot_account_id", type: "uuid" })
  riotAccountId!: string;

  @Column({ name: "queue_id", type: "int", nullable: true })
  queueId!: number | null;

  @Column({ name: "party_id", type: "text", nullable: true })
  partyId!: string | null;

  @Column({ name: "member_lcu_puuids", type: "text", array: true, default: "{}" })
  memberLcuPuuids!: string[];

  @Column({ name: "session_id", type: "uuid", nullable: true })
  sessionId!: string | null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "ended_at", type: "timestamptz", nullable: true })
  endedAt!: Date | null;

  @Column({ name: "terminated_in_error", type: "boolean", default: false })
  terminatedInError!: boolean;

  @Column({ name: "riot_match_id", type: "text", nullable: true })
  riotMatchId!: string | null;

  @Column({ name: "riot_confirmed_at", type: "timestamptz", nullable: true })
  riotConfirmedAt!: Date | null;
}
