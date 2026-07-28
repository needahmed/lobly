import { Column, Entity, PrimaryColumn } from "typeorm";
import type { MatchParticipant } from "@lobly/riot-client";

@Entity("matches")
export class Match {
  @PrimaryColumn({ name: "match_id", type: "text" })
  matchId!: string;

  @Column({ type: "text", nullable: true })
  platform!: string | null;

  @Column({ name: "queue_id", type: "int" })
  queueId!: number;

  @Column({ name: "game_mode", type: "text", nullable: true })
  gameMode!: string | null;

  @Column({ name: "game_creation", type: "timestamptz" })
  gameCreation!: Date;

  /** Seconds. */
  @Column({ name: "game_duration", type: "int" })
  gameDuration!: number;

  @Column({ name: "game_version", type: "text", nullable: true })
  gameVersion!: string | null;

  /** Full participant list — powers the expanded scoreboard view. */
  @Column({ type: "jsonb", default: () => "'[]'" })
  participants!: MatchParticipant[];

  @Column({ name: "fetched_at", type: "timestamptz", default: () => "now()" })
  fetchedAt!: Date;
}
