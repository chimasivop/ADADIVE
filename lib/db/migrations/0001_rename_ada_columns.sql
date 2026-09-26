-- Rename the ADA-era columns now that the app settles in SOL.
--
-- The API server applies its Drizzle schema with `drizzle-kit push`, which
-- cannot tell a rename from a drop-and-add: it would create the new columns
-- empty and drop the old ones, discarding every provider's lifetime earnings
-- and every deal's cost. This migration renames in place so the values survive.
--
-- Both guards make it idempotent: re-running after a rename is a no-op, and a
-- fresh database (neither column present) is left for `drizzle-kit push` to
-- create from the schema.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'providers' AND column_name = 'total_ada_earned'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'providers' AND column_name = 'total_sol_earned'
  ) THEN
    ALTER TABLE providers RENAME COLUMN total_ada_earned TO total_sol_earned;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'total_cost_ada'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deals' AND column_name = 'total_cost_sol'
  ) THEN
    ALTER TABLE deals RENAME COLUMN total_cost_ada TO total_cost_sol;
  END IF;
END $$;
