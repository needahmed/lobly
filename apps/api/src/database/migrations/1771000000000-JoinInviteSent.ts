import { MigrationInterface, QueryRunner } from "typeorm";

export class JoinInviteSent1771000000000 implements MigrationInterface {
  name = "JoinInviteSent1771000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE join_requests
      ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE join_requests
      DROP COLUMN IF EXISTS invite_sent_at
    `);
  }
}
