import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Riot icon-challenge accounts have no email or password.
 * The unique index on email stays; Postgres allows multiple NULLs.
 */
export class RiotAuth1770000000000 implements MigrationInterface {
  name = "RiotAuth1770000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL`
    );
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN email SET NOT NULL`);
  }
}
