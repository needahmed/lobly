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

  /** Null for Riot-only accounts created by the icon challenge (no email login). */
  @Column({ type: "text", unique: true, nullable: true })
  email!: string | null;

  /** Null for Riot-only accounts. Login must reject these instead of hashing null. */
  @Column({ name: "password_hash", type: "text", nullable: true })
  passwordHash!: string | null;

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
