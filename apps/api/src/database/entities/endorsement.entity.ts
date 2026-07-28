import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity("endorsements")
export class Endorsement {
  @PrimaryColumn({ name: "session_id", type: "uuid" })
  sessionId!: string;

  @PrimaryColumn({ name: "from_account_id", type: "uuid" })
  fromAccountId!: string;

  @PrimaryColumn({ name: "to_account_id", type: "uuid" })
  toAccountId!: string;

  @PrimaryColumn({ type: "text" })
  kind!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
