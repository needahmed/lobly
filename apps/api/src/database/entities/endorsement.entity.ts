import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity("endorsements")
export class Endorsement {
  @PrimaryColumn({ name: "session_id", type: "uuid" })
  sessionId!: string;

  /** 0 for rows written before per-game endorsements. */
  @PrimaryColumn({ name: "game_id", type: "bigint", default: 0 })
  gameId!: string;

  @PrimaryColumn({ name: "from_account_id", type: "uuid" })
  fromAccountId!: string;

  @PrimaryColumn({ name: "to_account_id", type: "uuid" })
  toAccountId!: string;

  @PrimaryColumn({ type: "text" })
  kind!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
