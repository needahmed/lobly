import { CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("blocks")
@Index("idx_blocks_blocked", ["blockedAccountId"])
export class Block {
  @PrimaryColumn({ name: "blocker_account_id", type: "uuid" })
  blockerAccountId!: string;

  @PrimaryColumn({ name: "blocked_account_id", type: "uuid" })
  blockedAccountId!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
