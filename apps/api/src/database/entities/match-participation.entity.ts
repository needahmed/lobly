import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { RiotAccount } from "./riot-account.entity";
import { Match } from "./match.entity";

/** One row per (account, match) — the history list reads only this table. */
@Entity("match_participations")
export class MatchParticipation {
  @PrimaryColumn({ name: "riot_account_id", type: "uuid" })
  riotAccountId!: string;

  @PrimaryColumn({ name: "match_id", type: "text" })
  matchId!: string;

  @ManyToOne(() => RiotAccount, { onDelete: "CASCADE" })
  @JoinColumn({ name: "riot_account_id" })
  riotAccount?: RiotAccount;

  @ManyToOne(() => Match, { onDelete: "CASCADE" })
  @JoinColumn({ name: "match_id" })
  match?: Match;

  @Column({ type: "boolean" })
  win!: boolean;

  @Column({ name: "champion_id", type: "int" })
  championId!: number;

  @Column({ name: "champion_name", type: "text", nullable: true })
  championName!: string | null;

  @Column({ name: "champ_level", type: "int", nullable: true })
  champLevel!: number | null;

  @Column({ name: "team_position", type: "text", nullable: true })
  teamPosition!: string | null;

  @Column({ name: "team_id", type: "int", nullable: true })
  teamId!: number | null;

  @Column({ type: "int", default: 0 })
  kills!: number;

  @Column({ type: "int", default: 0 })
  deaths!: number;

  @Column({ type: "int", default: 0 })
  assists!: number;

  @Column({ type: "int", default: 0 })
  cs!: number;

  @Column({ type: "int", default: 0 })
  gold!: number;

  @Column({ name: "vision_score", type: "int", default: 0 })
  visionScore!: number;

  @Column({ name: "damage_dealt", type: "int", default: 0 })
  damageDealt!: number;

  @Column({ name: "damage_taken", type: "int", default: 0 })
  damageTaken!: number;

  @Column({ type: "int", array: true, default: () => "'{}'" })
  items!: number[];

  @Column({ name: "summoner1_id", type: "int", nullable: true })
  summoner1Id!: number | null;

  @Column({ name: "summoner2_id", type: "int", nullable: true })
  summoner2Id!: number | null;

  @Column({ name: "primary_rune", type: "int", nullable: true })
  primaryRune!: number | null;

  @Column({ name: "sub_style", type: "int", nullable: true })
  subStyle!: number | null;

  /** 0 none, 2 double, 3 triple, 4 quadra, 5 penta. */
  @Column({ type: "int", default: 0 })
  multikill!: number;

  @Column({ name: "queue_id", type: "int" })
  queueId!: number;

  @Column({ name: "game_creation", type: "timestamptz" })
  gameCreation!: Date;

  @Column({ name: "game_duration", type: "int" })
  gameDuration!: number;
}
