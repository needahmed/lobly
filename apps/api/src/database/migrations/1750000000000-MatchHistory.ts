import { MigrationInterface, QueryRunner } from "typeorm";

export class MatchHistory1750000000000 implements MigrationInterface {
  name = "MatchHistory1750000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The League client reports a short local uuid, not the Riot Web API
    // PUUID. puuid now always holds the REAL one; lcu_puuid keeps the local
    // one so presence heartbeats can still identify the logged-in account.
    await queryRunner.query(`
      ALTER TABLE riot_accounts
        ADD COLUMN IF NOT EXISTS lcu_puuid text
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_riot_accounts_lcu_puuid
        ON riot_accounts(lcu_puuid)
    `);

    // Full match record, shared across every account that played in it.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id text PRIMARY KEY,
        platform text,
        queue_id int NOT NULL,
        game_mode text,
        game_creation timestamptz NOT NULL,
        game_duration int NOT NULL,
        game_version text,
        participants jsonb NOT NULL DEFAULT '[]',
        fetched_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_matches_creation ON matches(game_creation DESC)`
    );

    // One row per (account, match) — denormalized so the history list is a
    // single indexed read with no JSON parsing.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS match_participations (
        riot_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        match_id text NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
        win boolean NOT NULL,
        champion_id int NOT NULL,
        champion_name text,
        champ_level int,
        team_position text,
        team_id int,
        kills int NOT NULL DEFAULT 0,
        deaths int NOT NULL DEFAULT 0,
        assists int NOT NULL DEFAULT 0,
        cs int NOT NULL DEFAULT 0,
        gold int NOT NULL DEFAULT 0,
        vision_score int NOT NULL DEFAULT 0,
        damage_dealt int NOT NULL DEFAULT 0,
        damage_taken int NOT NULL DEFAULT 0,
        items int[] NOT NULL DEFAULT '{}',
        summoner1_id int,
        summoner2_id int,
        primary_rune int,
        sub_style int,
        multikill int NOT NULL DEFAULT 0,
        queue_id int NOT NULL,
        game_creation timestamptz NOT NULL,
        game_duration int NOT NULL,
        PRIMARY KEY (riot_account_id, match_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_participations_account_time
        ON match_participations(riot_account_id, game_creation DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS match_participations`);
    await queryRunner.query(`DROP TABLE IF EXISTS matches`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_riot_accounts_lcu_puuid`);
    await queryRunner.query(`ALTER TABLE riot_accounts DROP COLUMN IF EXISTS lcu_puuid`);
  }
}
