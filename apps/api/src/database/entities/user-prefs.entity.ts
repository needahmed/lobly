import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { User } from "./user.entity";
import type { DiscordReveal, VoicePref } from "@lobly/shared-types";

@Entity("user_prefs")
export class UserPrefs {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId!: string;

  @OneToOne(() => User, (u) => u.prefs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "text", array: true, default: "{}" })
  languages!: string[];

  @Column({ type: "text", default: "NO_VOICE" })
  voice!: VoicePref;

  @Column({ name: "vibe_tags", type: "text", array: true, default: "{}" })
  vibeTags!: string[];

  @Column({ name: "discord_tag", type: "text", nullable: true })
  discordTag!: string | null;

  @Column({ name: "discord_reveal", type: "text", default: "HIDDEN" })
  discordReveal!: DiscordReveal;

  @Column({ name: "auto_accept_lobly_invites", type: "boolean", default: false })
  autoAcceptLoblyInvites!: boolean;
}
