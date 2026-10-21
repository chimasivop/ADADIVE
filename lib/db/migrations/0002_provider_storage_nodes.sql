-- Provider-run storage layer: link a provider to an optional IPFS storage node
-- and track which deals that node is responsible for.
--
-- Additive only. Nothing here alters an existing column, so the centralized
-- Pinata path is untouched: a provider with `peer_id IS NULL` has no node and
-- keeps using Pinata exactly as before.
--
-- Apply with `node ./migrate.mjs` (see lib/db/migrate.ts) before `drizzle-kit
-- push`. As with `0001_rename_ada_columns.sql`, every statement is guarded so
-- the migration is idempotent *and* safe on a fresh database: `migrate.mjs`
-- runs this before `push` has created any table, so an unguarded `ALTER TABLE
-- providers` would fail with `relation "providers" does not exist`. On a fresh
-- database the whole block is skipped and `push` creates everything from the
-- Drizzle schema; on an existing one it adds the columns and the table in place.
DO $$
BEGIN
  -- Nothing to do until `push` (or a previous deploy) has created the base
  -- tables this migration extends.
  IF to_regclass('providers') IS NULL OR to_regclass('deals') IS NULL THEN
    RETURN;
  END IF;

  -- ── providers: optional storage node ──────────────────────────────────────
  --
  -- `peer_id` is the libp2p peer id of the provider's own IPFS (Kubo) node.
  -- NULL means "no node registered" — the signal the rest of the system uses to
  -- fall back to centralized Pinata pinning.
  ALTER TABLE providers ADD COLUMN IF NOT EXISTS peer_id TEXT;

  -- Last time the provider-agent reported the node alive. Used by the oracle's
  -- findprovs verification to decide whether a node has gone silent.
  ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

  -- The wallet that registered / owns this provider row. The provider-agent
  -- authenticates with a wallet-signed session, and
  -- `GET /api/provider/assignments` resolves "authenticated wallet → provider
  -- row" through this column. NULL for rows created before the wallet flow (and
  -- for admin-seeded sample data), which is why it is nullable rather than
  -- required.
  ALTER TABLE providers ADD COLUMN IF NOT EXISTS wallet_address TEXT;

  -- ── deal_assignments: which peer is responsible for which deal ────────────
  --
  -- One row per (deal, provider node) assignment. A deal whose provider has no
  -- peer_id gets no row here and stays on the Pinata verification path.
  CREATE TABLE IF NOT EXISTS deal_assignments (
      -- `SERIAL` / `INTEGER` to match the Drizzle schema exactly: `push` diffs
      -- against that schema, so a `BIGSERIAL` here would look like a type
      -- mismatch and be "corrected" on the next push.
      id                SERIAL PRIMARY KEY,

      deal_id           INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
      provider_id       INTEGER NOT NULL REFERENCES providers (id) ON DELETE CASCADE,

      -- The peer id copied from the provider at assignment time. Copied rather
      -- than joined so a later node re-registration does not retroactively
      -- rewrite which node a past deal was assigned to.
      peer_id           TEXT    NOT NULL,

      -- 'assigned'  — the deal exists and the agent has not confirmed the pin yet
      -- 'confirmed' — the provider-agent fetched and pinned the file, and reported
      --               the matching peer id back via POST /api/provider/confirm-pin
      status            TEXT    NOT NULL DEFAULT 'assigned',

      -- Verification bookkeeping, written by the oracle's findprovs job.
      -- `at_risk` is the explicit flag the brief asks for in place of a silent
      -- failure: true means the heartbeat is stale AND the peer is no longer
      -- advertising the CID. Either signal alone is a warning, not a verdict.
      at_risk           BOOLEAN NOT NULL DEFAULT FALSE,
      verification_detail TEXT,
      last_verified_at  TIMESTAMPTZ,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_at      TIMESTAMPTZ,

      CONSTRAINT deal_assignments_status_check
          CHECK (status IN ('assigned', 'confirmed', 'failed'))
  );

  -- At most one assignment per deal: a deal is stored by one node (or none).
  CREATE UNIQUE INDEX IF NOT EXISTS deal_assignments_deal_id_idx
      ON deal_assignments (deal_id);

  -- The provider-agent's poll: "assignments for this peer that are not confirmed".
  CREATE INDEX IF NOT EXISTS deal_assignments_provider_status_idx
      ON deal_assignments (provider_id, status);

  -- The oracle verification job's hot path: assignments to nodes, newest first.
  CREATE INDEX IF NOT EXISTS deal_assignments_peer_idx
      ON deal_assignments (peer_id);
END $$;
