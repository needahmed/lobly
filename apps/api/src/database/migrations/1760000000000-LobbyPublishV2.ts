import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lobby publish v2:
 * - listings.queue_meta jsonb
 * - rewrite slots from {role,open} → {id,roles[],open}
 * - backfill queue_meta from queue_id
 */
export class LobbyPublishV21760000000000 implements MigrationInterface {
  name = "LobbyPublishV21760000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS queue_meta jsonb NOT NULL DEFAULT '{}'::jsonb
    `);

    // Backfill queue_meta from known queue ids
    await queryRunner.query(`
      UPDATE listings SET queue_meta = CASE queue_id
        WHEN 420 THEN '{"queueId":420,"gameMode":null,"mapId":null,"maxLobbySize":2,"positional":true,"isCustom":false,"rankSource":"solo","duoRules":true}'::jsonb
        WHEN 440 THEN '{"queueId":440,"gameMode":null,"mapId":null,"maxLobbySize":5,"positional":true,"isCustom":false,"rankSource":"flex","duoRules":false}'::jsonb
        WHEN 450 THEN '{"queueId":450,"gameMode":null,"mapId":null,"maxLobbySize":5,"positional":false,"isCustom":false,"rankSource":null,"duoRules":false}'::jsonb
        ELSE jsonb_build_object(
          'queueId', queue_id,
          'gameMode', null,
          'mapId', null,
          'maxLobbySize', 5,
          'positional', false,
          'isCustom', queue_id IN (0, -1),
          'rankSource', null,
          'duoRules', false
        )
      END
      WHERE queue_meta = '{}'::jsonb OR queue_meta IS NULL
    `);

    // Normalize legacy type values
    await queryRunner.query(`
      UPDATE listings SET type = CASE type
        WHEN 'DUO' THEN 'POSITIONAL'
        WHEN 'FLEX' THEN 'POSITIONAL'
        WHEN 'ARAM' THEN 'OPEN'
        ELSE type
      END
      WHERE type IN ('DUO', 'FLEX', 'ARAM')
    `);

    // Rewrite slots JSONB: {role,open} → {id,roles,open}
    await queryRunner.query(`
      UPDATE listings
      SET slots = (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN elem ? 'roles' AND jsonb_typeof(elem->'roles') = 'array' THEN
              jsonb_build_object(
                'id', COALESCE(elem->>'id', 'legacy_' || ord::text),
                'roles', elem->'roles',
                'open', COALESCE((elem->>'open')::boolean, false),
                'pendingAccountId', elem->'pendingAccountId'
              )
            WHEN elem ? 'role' THEN
              jsonb_build_object(
                'id', COALESCE(elem->>'id', 'legacy_' || ord::text),
                'roles', jsonb_build_array(elem->>'role'),
                'open', COALESCE((elem->>'open')::boolean, false),
                'pendingAccountId', elem->'pendingAccountId'
              )
            ELSE
              jsonb_build_object(
                'id', COALESCE(elem->>'id', 'legacy_' || ord::text),
                'roles', '[]'::jsonb,
                'open', COALESCE((elem->>'open')::boolean, false),
                'pendingAccountId', elem->'pendingAccountId'
              )
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(slots) WITH ORDINALITY AS t(elem, ord)
      )
      WHERE jsonb_typeof(slots) = 'array'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE listings SET type = CASE
        WHEN (queue_meta->>'duoRules')::boolean IS TRUE THEN 'DUO'
        WHEN (queue_meta->>'rankSource') = 'flex' THEN 'FLEX'
        WHEN type = 'OPEN' THEN 'ARAM'
        WHEN type = 'POSITIONAL' THEN 'FLEX'
        ELSE type
      END
    `);

    await queryRunner.query(`
      UPDATE listings
      SET slots = (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'role', COALESCE(elem->'roles'->>0, 'MIDDLE'),
            'open', COALESCE((elem->>'open')::boolean, false),
            'pendingAccountId', elem->'pendingAccountId'
          )
        ), '[]'::jsonb)
        FROM jsonb_array_elements(slots) AS elem
      )
      WHERE jsonb_typeof(slots) = 'array'
    `);

    await queryRunner.query(`
      ALTER TABLE listings DROP COLUMN IF EXISTS queue_meta
    `);
  }
}
