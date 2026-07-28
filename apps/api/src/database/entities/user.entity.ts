import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { RiotAccount } from "./riot-account.entity";
import { UserPrefs } from "./user-prefs.entity";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text", unique: true })
  email!: string;

  @Column({ name: "password_hash", type: "text" })
  passwordHash!: string;

  @Column({ type: "boolean", default: false })
  banned!: boolean;

  @Column({ name: "listing_banned_until", type: "timestamptz", nullable: true })
  listingBannedUntil!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => RiotAccount, (a) => a.user)
  riotAccounts?: RiotAccount[];

  @OneToOne(() => UserPrefs, (p) => p.user)
  prefs?: UserPrefs;
}
