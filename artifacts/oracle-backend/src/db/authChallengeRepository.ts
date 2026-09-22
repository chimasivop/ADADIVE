/**
 * Data access for sign-in challenges.
 *
 * The security property this file exists to provide is **single-use**. A
 * challenge is a value a wallet signs; if the same signature could be replayed,
 * a captured one would be a permanent key to the account. Consuming the
 * challenge is therefore a conditional `UPDATE ... WHERE consumed_at IS NULL`,
 * not a read-then-write.
 *
 * That distinction is the whole point. Two concurrent `POST /auth/verify` calls
 * carrying the same challenge would both pass a naive `SELECT consumed_at` and
 * both mint a session. With the conditional UPDATE, Postgres takes a row lock
 * and re-evaluates the predicate against the committed row, so exactly one wins
 * and the other sees zero rows — the same reasoning as the deal state machine in
 * `db/repository.ts`. Unlike disputes, this needs no explicit transaction: it is
 * a single atomic statement, so the row lock is held for the statement's
 * duration and no `BEGIN` is required.
 */

import type { Pool } from "pg";

/** Anything a query can run on. */
export type Queryable = Pick<Pool, "query">;

export interface AuthChallenge {
  id: number;
  wallet: string;
  nonce: string;
  message: string;
  domain: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

interface AuthChallengeRow {
  id: string;
  wallet: string;
  nonce: string;
  message: string;
  domain: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

const CHALLENGE_COLUMNS =
  "id, wallet, nonce, message, domain, issued_at, expires_at, consumed_at";

function toChallenge(row: AuthChallengeRow): AuthChallenge {
  return {
    id: Number(row.id),
    wallet: row.wallet,
    nonce: row.nonce,
    message: row.message,
    domain: row.domain,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

/** Why a challenge consumption was refused. */
export type ChallengeFailureReason =
  | "not_found"
  | "expired"
  | "already_used"
  | "wallet_mismatch"
  | "domain_mismatch";

export interface ConsumeChallengeParams {
  /** The nonce the caller claims, taken from the challenge they signed. */
  nonce: string;
  /** The wallet attempting to consume it. Must match the row's wallet. */
  wallet: string;
  /** The domain the caller is authenticating against. */
  domain: string;
}

export type ConsumeChallengeResult =
  | { ok: true; challenge: AuthChallenge }
  | { ok: false; reason: ChallengeFailureReason };

export class AuthChallengeRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Store an issued challenge.
   *
   * Issuing does not invalidate any prior challenge for the same wallet: a user
   * who opens two tabs gets two valid challenges, both single-use, and neither
   * is a replay of the other. Invalidating on issue would be a denial-of-service
   * vector (anyone could kill your pending sign-in by requesting one of their
   * own for your address).
   */
  async issue(params: {
    wallet: string;
    nonce: string;
    message: string;
    domain: string;
    expiresAt: Date;
  }): Promise<AuthChallenge> {
    const { rows } = await this.pool.query<AuthChallengeRow>(
      `INSERT INTO auth_challenges (wallet, nonce, message, domain, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${CHALLENGE_COLUMNS}`,
      [
        params.wallet,
        params.nonce,
        params.message,
        params.domain,
        params.expiresAt,
      ]
    );
    return toChallenge(rows[0]);
  }

  /** Look up a challenge by nonce, without consuming it. For diagnostics. */
  async findByNonce(nonce: string): Promise<AuthChallenge | null> {
    const { rows } = await this.pool.query<AuthChallengeRow>(
      `SELECT ${CHALLENGE_COLUMNS} FROM auth_challenges WHERE nonce = $1`,
      [nonce]
    );
    return rows[0] ? toChallenge(rows[0]) : null;
  }

  /**
   * Atomically consume a challenge, returning it exactly once.
   *
   * The conditions are all in the `WHERE`, so there is no window between
   * checking and consuming. Each reason is checked separately first so the
   * caller gets a legible answer rather than a bare "no rows"; but the
   * *guarantee* comes from the final conditional UPDATE, because the pre-checks
   * can themselves race.
   *
   * Order of the pre-checks matters for the response, not the security:
   * already-used before expired, so replaying a used challenge reports "already
   * used" (the actionable answer) rather than the age of the row.
   */
  async consume(params: ConsumeChallengeParams): Promise<ConsumeChallengeResult> {
    const existing = await this.findByNonce(params.nonce);
    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.consumedAt !== null) return { ok: false, reason: "already_used" };
    if (existing.wallet !== params.wallet) {
      return { ok: false, reason: "wallet_mismatch" };
    }
    if (existing.domain !== params.domain) {
      return { ok: false, reason: "domain_mismatch" };
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "expired" };
    }

    // The authoritative check. `expires_at > now()` is evaluated by the
    // database, so a clock difference between the service and Postgres cannot
    // let an expired challenge through.
    const { rows } = await this.pool.query<AuthChallengeRow>(
      `UPDATE auth_challenges
          SET consumed_at = now()
        WHERE nonce = $1
          AND consumed_at IS NULL
          AND wallet = $2
          AND domain = $3
          AND expires_at > now()
        RETURNING ${CHALLENGE_COLUMNS}`,
      [params.nonce, params.wallet, params.domain]
    );

    if (!rows[0]) {
      // The row changed between the pre-checks and the UPDATE. Re-read to say
      // which condition actually failed, since "lost the race" is not useful
      // to a client.
      const now = await this.findByNonce(params.nonce);
      if (!now) return { ok: false, reason: "not_found" };
      if (now.consumedAt !== null) return { ok: false, reason: "already_used" };
      if (now.wallet !== params.wallet) {
        return { ok: false, reason: "wallet_mismatch" };
      }
      if (now.domain !== params.domain) {
        return { ok: false, reason: "domain_mismatch" };
      }
      return { ok: false, reason: "expired" };
    }

    return { ok: true, challenge: toChallenge(rows[0]) };
  }

  /**
   * Delete challenges that are expired or already consumed.
   *
   * A housekeeping hook, not a correctness mechanism — an unconsumed expired
   * challenge is already refused by `consume`. Returns the number of rows
   * removed so a caller can log or assert on it.
   */
  async prune(cutoff: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM auth_challenges
        WHERE expires_at < $1 OR consumed_at IS NOT NULL`,
      [cutoff]
    );
    return rowCount ?? 0;
  }
}
