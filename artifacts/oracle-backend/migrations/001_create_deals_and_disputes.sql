-- Phase 3: deals under optimistic-challenge settlement, and their disputes.
--
-- Apply with `npm --prefix backend run migrate` (see src/db/migrate.ts), which
-- runs each file in this directory once and records it in schema_migrations.

-- One row per on-chain deal under this backend's supervision.
--
-- `deal_id` / `deal_pda` identify the on-chain account; everything else is the
-- backend's own bookkeeping. Nothing here is authoritative for funds — the
-- program is. This table is the index the settle endpoint and the challenge
-- window job need in order to remember, across restarts, where a deal is in its
-- lifecycle.
CREATE TABLE IF NOT EXISTS deals (
    id                        BIGSERIAL PRIMARY KEY,

    -- On-chain identity. `deal_pda` is the unique handle clients use; the
    -- deal_id is kept for display and for re-deriving the PDA.
    deal_id                   TEXT        NOT NULL,
    deal_pda                  TEXT        NOT NULL UNIQUE,

    -- The three parties, as base58 public keys. Purely descriptive: the program
    -- is what enforces who may settle, and `depositor` is what the dispute
    -- endpoint checks against.
    depositor                 TEXT        NOT NULL,
    provider                  TEXT        NOT NULL,
    oracle                    TEXT        NOT NULL,

    -- The IPFS CID this deal's pin verification is performed against. Kept on
    -- the deal (not passed per request) so the settle request cannot point the
    -- verifier at a different, healthy CID than the one the deal is about.
    cid                       TEXT        NOT NULL,

    amount_lamports           BIGINT      NOT NULL,

    -- Lifecycle. See PHASE3_NOTES.md for the state machine.
    status                    TEXT        NOT NULL,

    -- When the challenge window closes, and how long it was configured to be.
    -- The duration is stored per-row so a config change does not retroactively
    -- shorten windows already opened.
    challenge_window_seconds  INTEGER     NOT NULL DEFAULT 172800,
    challenge_window_ends_at  TIMESTAMPTZ,

    -- Pin verification bookkeeping, retained for audit ("was it pinned when we
    -- let it into the window?").
    pin_verified_at           TIMESTAMPTZ,
    pin_verification_detail   TEXT,

    -- Settle submission bookkeeping.
    settle_tx_signature       TEXT,
    settle_attempted_at       TIMESTAMPTZ,
    settle_error              TEXT,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT deals_status_check CHECK (status IN (
        'pending_verification',
        'in_challenge_window',
        'disputed',
        'settled',
        'refunded',
        'settlement_failed'
    )),

    -- A window that is open must say when it closes; the job's query depends on
    -- it, and a null here would silently make a deal uncollectable.
    CONSTRAINT deals_window_ends_when_open CHECK (
        status <> 'in_challenge_window' OR challenge_window_ends_at IS NOT NULL
    )
);

-- The challenge-window job's hot path: "all open windows that are due".
CREATE INDEX IF NOT EXISTS deals_due_for_settlement_idx
    ON deals (challenge_window_ends_at)
    WHERE status = 'in_challenge_window';

-- Lookups by the human-readable id (the API accepts either handle).
CREATE INDEX IF NOT EXISTS deals_deal_id_idx ON deals (deal_id);

-- A dispute is the depositor's objection to a settlement, raised while the
-- challenge window is open. Its existence is what stops the auto-settle job.
--
-- `resolved` and the manual-resolution workflow are deliberately inert in this
-- phase: the only behaviour implemented is "a dispute halts auto-settlement".
-- The column exists so the shape does not have to change when resolution is
-- built.
CREATE TABLE IF NOT EXISTS disputes (
    id          BIGSERIAL PRIMARY KEY,

    deal_id     BIGINT      NOT NULL REFERENCES deals (id) ON DELETE CASCADE,

    -- Base58 public key of the party raising the dispute. The API additionally
    -- requires this to equal the deal's depositor; see PHASE3_NOTES.md for why
    -- that check is not sufficient on its own without an authenticated session.
    raised_by   TEXT        NOT NULL,
    reason      TEXT        NOT NULL,

    raised_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved    BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS disputes_deal_id_idx ON disputes (deal_id);

-- At most one unresolved dispute per deal. A second dispute adds no
-- information (the deal is already halted) and would let an attacker grow the
-- table unboundedly; re-raising is rejected by the API instead.
CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_unresolved_per_deal_idx
    ON disputes (deal_id)
    WHERE resolved = FALSE;
