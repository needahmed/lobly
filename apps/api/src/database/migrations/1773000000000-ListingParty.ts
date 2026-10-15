import { MigrationInterface, QueryRunner } from "typeorm";

export class ListingParty1773000000000 implements MigrationInterface {
  name = "ListingParty1773000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS party jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings DROP COLUMN IF EXISTS party
    `);
  }
}
