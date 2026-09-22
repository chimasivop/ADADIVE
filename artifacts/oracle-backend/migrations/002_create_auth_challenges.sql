-- Phase 3.5: wallet-signature authentication.
--
-- One row per issued sign-in challenge. The row is what makes a challenge
-- single-use: `verifyAndIssueSession` consumes it with a conditional UPDATE, so
-- a replayed challenge (or two concurrent submissions of the same signature)
-- can only ever produce one session.
--
-- Apply with `npm --prefix backend run migrate` (see src/db/migrate.ts), which
-- runs each file in this directory once and records it in schema_migrations.
CREATE TABLE IF NOT EXISTS auth_challenges (
    id          BIGSERIAL PRIMARY KEY,

    -- The wallet the challenge was issued *to*. The verify step requires the
    -- signature's key to equal this, so a challenge issued for wallet A cannot
    -- be consumed by wallet B even if B somehow learns the message.
    wallet      TEXT        NOT NULL,

    -- The nonce embedded in the message, stored separately so an operator can
    -- look a challenge up without re-parsing the message text.
    nonce       TEXT        NOT NULL UNIQUE,

    -- The exact bytes the wallet is asked to sign. Stored verbatim rather than
    -- regenerated on verify: signature verification is over these exact bytes,
    -- and re-deriving them would mean a formatting change (locale, newline,
    -- key order) silently invalidates every outstanding challenge.
    message     TEXT        NOT NULL UNIQUE,

    -- Domain the challenge was issued for (the SIWS `domain` field). Kept so a
    -- multi-origin deployment can reject a challenge minted for another origin.
    domain      TEXT        NOT NULL,

    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Challenges are short-lived. The verify query requires
    -- `expires_at > now()`, so an expired challenge is refused by the database
    -- even if application logic forgot to check.
    expires_at  TIMESTAMPTZ NOT NULL,

    -- NULL means "not yet used". Set exactly once, by the conditional UPDATE
    -- that consumes the challenge, which is also what serialises two racing
    -- verify attempts.
    consumed_at TIMESTAMPTZ,

    CONSTRAINT auth_challenges_expiry_after_issue CHECK (expires_at > issued_at)
);

-- Issuing is per-wallet; an operator debugging "why did sign-in fail for this
-- key" looks up by wallet.
CREATE INDEX IF NOT EXISTS auth_challenges_wallet_idx
    ON auth_challenges (wallet);

-- A cleanup sweep ("delete consumed and expired rows") scans by time.
CREATE INDEX IF NOT EXISTS auth_challenges_expires_at_idx
    ON auth_challenges (expires_at);
