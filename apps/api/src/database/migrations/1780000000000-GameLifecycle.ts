import { MigrationInterface, QueryRunner } from "typeorm";

export class GameLifecycle1780000000000 implements MigrationInterface {
  name = "GameLifecycle1780000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS game_reports (
        game_id            bigint      NOT NULL,
        platform           text        NOT NULL,
        riot_account_id    uuid        NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        queue_id           int,
        party_id           text,
        member_lcu_puuids  text[]      NOT NULL DEFAULT '{}',
        session_id         uuid        NULL REFERENCES sessions(id) ON DELETE SET NULL,
        started_at         timestamptz,
        ended_at           timestamptz,
        terminated_in_error boolean    NOT NULL DEFAULT false,
        riot_match_id      text        NULL,
        riot_confirmed_at  timestamptz NULL,
        PRIMARY KEY (game_id, platform, riot_account_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_game_reports_session ON game_reports(session_id)
    `);

    await queryRunner.query(`
      ALTER TABLE endorsements ADD COLUMN IF NOT EXISTS game_id bigint
    `);
    await queryRunner.query(`
      UPDATE endorsements SET game_id = 0 WHERE game_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements ALTER COLUMN game_id SET DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements ALTER COLUMN game_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements DROP CONSTRAINT IF EXISTS endorsements_pkey
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements
      ADD PRIMARY KEY (session_id, game_id, from_account_id, to_account_id, kind)
    `);

    await queryRunner.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS riot_verified_game_ids bigint[] NOT NULL DEFAULT '{}'
    `);
    await queryRunner.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'LISTING'
    `);
    await queryRunner.query(`
      ALTER TABLE sessions ALTER COLUMN listing_id DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sessions ALTER COLUMN listing_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE sessions DROP COLUMN IF EXISTS source
    `);
    await queryRunner.query(`
      ALTER TABLE sessions DROP COLUMN IF EXISTS riot_verified_game_ids
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements DROP CONSTRAINT IF EXISTS endorsements_pkey
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements DROP COLUMN IF EXISTS game_id
    `);
    await queryRunner.query(`
      ALTER TABLE endorsements
      ADD PRIMARY KEY (session_id, from_account_id, to_account_id, kind)
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS game_reports`);
  }
}
