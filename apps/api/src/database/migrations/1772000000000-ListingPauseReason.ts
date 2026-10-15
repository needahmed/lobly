import { MigrationInterface, QueryRunner } from "typeorm";

export class ListingPauseReason1772000000000 implements MigrationInterface {
  name = "ListingPauseReason1772000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS pause_reason text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings DROP COLUMN IF EXISTS pause_reason
    `);
  }
}
