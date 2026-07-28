import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { RiotAccount } from "./riot-account.entity";

@Entity("profile_snapshots")
export class ProfileSnapshot {
  @PrimaryColumn({ name: "riot_account_id", type: "uuid" })
  riotAccountId!: string;

  @OneToOne(() => RiotAccount, (a) => a.snapshot, { onDelete: "CASCADE" })
  @JoinColumn({ name: "riot_account_id" })
  riotAccount!: RiotAccount;

  @Column({ name: "solo_tier", type: "text", nullable: true })
  soloTier!: string | null;

  @Column({ name: "solo_division", type: "text", nullable: true })
  soloDivision!: string | null;

  @Column({ name: "solo_lp", type: "int", nullable: true })
  soloLp!: number | null;

  @Column({ name: "solo_wins", type: "int", nullable: true })
  soloWins!: number | null;

  @Column({ name: "solo_losses", type: "int", nullable: true })
  soloLosses!: number | null;

  @Column({ name: "flex_tier", type: "text", nullable: true })
  flexTier!: string | null;

  @Column({ name: "flex_division", type: "text", nullable: true })
  flexDivision!: string | null;

  @Column({ name: "flex_lp", type: "int", nullable: true })
  flexLp!: number | null;

  @Column({ name: "flex_wins", type: "int", nullable: true })
  flexWins!: number | null;

  @Column({ name: "flex_losses", type: "int", nullable: true })
  flexLosses!: number | null;

  @Column({ name: "primary_role", type: "text", nullable: true })
  primaryRole!: string | null;

  @Column({ name: "secondary_role", type: "text", nullable: true })
  secondaryRole!: string | null;

  @Column({ name: "form_wr20", type: "numeric", precision: 5, scale: 2, nullable: true })
  formWr20!: string | null;

  @Column({ type: "int", nullable: true })
  streak!: number | null;

  @Column({ name: "summoner_level", type: "int", nullable: true })
  summonerLevel!: number | null;

  @Column({ name: "profile_icon_id", type: "int", nullable: true })
  profileIconId!: number | null;

  @Column({ name: "games_this_season", type: "int", nullable: true })
  gamesThisSeason!: number | null;

  @Column({ name: "refreshed_at", type: "timestamptz" })
  refreshedAt!: Date;
}
