import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("chat_messages")
@Index("idx_chat_session_created", ["sessionId", "createdAt"])
export class ChatMessage {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "session_id", type: "uuid" })
  sessionId!: string;

  @Column({ name: "from_account_id", type: "uuid" })
  fromAccountId!: string;

  @Column({ type: "text" })
  body!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
