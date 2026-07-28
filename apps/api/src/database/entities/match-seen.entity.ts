import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { RiotAccount } from "./riot-account.entity";

@Entity("matches_seen")
export class MatchSeen {
  @PrimaryColumn({ name: "riot_account_id", type: "uuid" })
  riotAccountId!: string;

  @PrimaryColumn({ name: "match_id", type: "text" })
  matchId!: string;

  @ManyToOne(() => RiotAccount, { onDelete: "CASCADE" })
  @JoinColumn({ name: "riot_account_id" })
  riotAccount!: RiotAccount;
}
