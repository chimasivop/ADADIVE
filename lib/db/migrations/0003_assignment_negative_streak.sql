-- Track a *streak* of conclusive-negative findprovs results per assignment.
--
-- Additive only: one new column on an existing table, no existing column altered
-- and nothing dropped, so the Pinata path and every existing row are untouched.
-- The default of 0 means "no evidence of absence yet", which is the correct
-- starting state for a row that predates this migration.
--
-- Why the streak exists: a findprovs stream has no terminal sentinel, and a
-- response that is ended cleanly but early is byte-identical to a completed
-- search (see `artifacts/oracle-backend/src/ipfs/findprovs.ts`). A single
-- conclusive negative therefore cannot be trusted to mean "the peer is gone", so
-- the oracle requires PROVIDER_VERIFICATION_CONSECUTIVE_NEGATIVES of them in a
-- row before it will set `at_risk`. This column is that counter. It is reset to
-- 0 whenever a sweep sees the peer advertising again.
--
-- Apply with `node ./migrate.mjs` (see lib/db/migrate.ts) before `drizzle-kit
-- push`. Guarded like 0002 so it is idempotent and safe on a fresh database,
-- where `push` has not created the table yet: an unguarded ALTER would fail with
-- `relation "deal_assignments" does not exist`.
DO $$
BEGIN
  -- Nothing to do until `push` (or a previous deploy) has created the table.
  IF to_regclass('deal_assignments') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE deal_assignments
      ADD COLUMN IF NOT EXISTS consecutive_conclusive_negatives INTEGER NOT NULL DEFAULT 0;
END $$;
