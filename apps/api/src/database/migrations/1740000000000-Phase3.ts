import { MigrationInterface, QueryRunner } from "typeorm";

export class Phase31740000000000 implements MigrationInterface {
  name = "Phase31740000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS listing_banned_until timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE user_prefs
        ADD COLUMN IF NOT EXISTS auto_accept_lobly_invites boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        member_account_ids uuid[] NOT NULL,
        league_lobby_confirmed_at timestamptz,
        started_queue_at timestamptz,
        games_played int NOT NULL DEFAULT 0,
        ended_at timestamptz,
        chat_open_until timestamptz,
        created_at timestamptz DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sessions_listing ON sessions(listing_id)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS endorsements (
        session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        from_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        to_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        kind text NOT NULL,
        created_at timestamptz DEFAULT now(),
        PRIMARY KEY (session_id, from_account_id, to_account_id, kind)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reliability_events (
        id bigserial PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
        join_request_id uuid REFERENCES join_requests(id) ON DELETE SET NULL,
        kind text NOT NULL,
        at timestamptz DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_reliability_account_at ON reliability_events(account_id, at)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        blocked_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        created_at timestamptz DEFAULT now(),
        PRIMARY KEY (blocker_account_id, blocked_account_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_account_id)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_account_id uuid REFERENCES riot_accounts(id) ON DELETE SET NULL,
        reported_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
        reason text NOT NULL,
        detail text,
        status text NOT NULL DEFAULT 'OPEN',
        admin_action text,
        created_at timestamptz DEFAULT now(),
        resolved_at timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id bigserial PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        from_account_id uuid NOT NULL REFERENCES riot_accounts(id) ON DELETE CASCADE,
        body text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_chat_session_created ON chat_messages(session_id, created_at)`
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS metrics_events (
        id bigserial PRIMARY KEY,
        name text NOT NULL,
        account_id uuid,
        listing_id uuid,
        session_id uuid,
        join_request_id uuid,
        meta jsonb NOT NULL DEFAULT '{}',
        at timestamptz DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_metrics_name_at ON metrics_events(name, at)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS metrics_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS chat_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS blocks`);
    await queryRunner.query(`DROP TABLE IF EXISTS reliability_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS endorsements`);
    await queryRunner.query(`DROP TABLE IF EXISTS sessions`);
    await queryRunner.query(
      `ALTER TABLE user_prefs DROP COLUMN IF EXISTS auto_accept_lobly_invites`
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS listing_banned_until`
    );
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS banned`);
  }
}
