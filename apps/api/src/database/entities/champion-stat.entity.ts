import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { RiotAccount } from "./riot-account.entity";

@Entity("champion_stats")
export class ChampionStat {
  @PrimaryColumn({ name: "riot_account_id", type: "uuid" })
  riotAccountId!: string;

  @PrimaryColumn({ name: "champion_id", type: "int" })
  championId!: number;

  @PrimaryColumn({ type: "text" })
  season!: string;

  @ManyToOne(() => RiotAccount, (a) => a.championStats, { onDelete: "CASCADE" })
  @JoinColumn({ name: "riot_account_id" })
  riotAccount!: RiotAccount;

  @Column({ type: "int", default: 0 })
  games!: number;

  @Column({ type: "int", default: 0 })
  wins!: number;

  @Column({ type: "numeric", precision: 5, scale: 2, default: 0 })
  kda!: string;
}
