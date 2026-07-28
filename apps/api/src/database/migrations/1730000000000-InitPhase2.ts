import { MigrationInterface, QueryRunner } from "typeorm";

export class InitPhase21730000000000 implements MigrationInterface {
  name = "InitPhase21730000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS riot_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        puuid text UNIQUE NOT NULL,
        riot_id text NOT NULL,
        tag_line text NOT NULL,
        summoner_id bigint,
        platform text NOT NULL,
        verified_at timestamptz,
        last_seen_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS profile_snapshots (
        riot_account_id uuid PRIMARY KEY REFERENCES riot_accounts(id) ON DELETE CASCADE,
        solo_tier text, solo_division text, solo_lp int, solo_wins int, solo_losses int,
        flex_tier text, flex_division text, flex_lp int, flex_wins int, flex_losses int,
        primary_role text, secondary_role text,
        form_wr20 numeric(5,2),
        streak int,
        summoner_level int, profile_icon_id int,
        games_this_season int,
        refreshed_at timestamptz NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS champion_stats (
        riot_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        champion_id int NOT NULL,
        season text NOT NULL,
        games int NOT NULL DEFAULT 0,
        wins int NOT NULL DEFAULT 0,
        kda numeric(5,2) NOT NULL DEFAULT 0,
        PRIMARY KEY (riot_account_id, champion_id, season)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS matches_seen (
        riot_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        match_id text NOT NULL,
        PRIMARY KEY (riot_account_id, match_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS listings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        platform text NOT NULL,
        queue_id int NOT NULL,
        type text NOT NULL,
        title text NOT NULL,
        description text,
        status text NOT NULL DEFAULT 'LISTED',
        filters jsonb NOT NULL DEFAULT '{}',
        slots jsonb NOT NULL,
        voice_required boolean DEFAULT false,
        languages text[] DEFAULT '{}',
        expires_at timestamptz NOT NULL,
        created_at timestamptz DEFAULT now(),
        paused_at timestamptz,
        delisted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_listings_platform_status_queue
      ON listings (platform, status, queue_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings (expires_at)
    `);

    // Max ONE active listing per riot account
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_listings_one_active_per_account
      ON listings (creator_account_id)
      WHERE status IN ('LISTED','FILLING','READY','PAUSED')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS join_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        requester_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        role_slot text,
        status text NOT NULL DEFAULT 'PENDING',
        match_score int,
        off_role boolean DEFAULT false,
        created_at timestamptz DEFAULT now(),
        decided_at timestamptz
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_join_requests_listing_status
      ON join_requests (listing_id, status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        languages text[] DEFAULT '{}',
        voice text DEFAULT 'NO_VOICE',
        vibe_tags text[] DEFAULT '{}',
        discord_tag text,
        discord_reveal text DEFAULT 'HIDDEN'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_prefs`);
    await queryRunner.query(`DROP TABLE IF EXISTS join_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS listings`);
    await queryRunner.query(`DROP TABLE IF EXISTS matches_seen`);
    await queryRunner.query(`DROP TABLE IF EXISTS champion_stats`);
    await queryRunner.query(`DROP TABLE IF EXISTS profile_snapshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS riot_accounts`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
