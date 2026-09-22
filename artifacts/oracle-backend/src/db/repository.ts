/**
 * Data access for deals and disputes.
 *
 * The important design decision here is that *state transitions are expressed
 * as conditional UPDATEs*, not as read-then-write in application code. Every
 * method that moves a deal returns the updated row or `null`, and `null` means
 * "the guard did not hold". That matters because the challenge-window job and
 * the dispute endpoint run concurrently: a naive `SELECT` then `UPDATE` would
 * let a dispute land in the gap between the job reading `in_challenge_window`
 * and the job writing `settled`, and the dispute would be silently ignored.
 *
 * Postgres gives us the guard for free: `UPDATE ... WHERE status = '...'` takes
 * a row lock and re-evaluates the predicate against the committed row, so
 * exactly one of the two racing writers wins and the other sees zero rows.
 */

import type { Pool, PoolClient } from "pg";

import type { Deal, DealStatus, Dispute, NewDeal } from "./types";

/** Anything a query can run on: the pool, or a client inside a transaction. */
export type Queryable = Pick<Pool | PoolClient, "query">;

interface DealRow {
  id: string;
  deal_id: string;
  deal_pda: string;
  depositor: string;
  provider: string;
  oracle: string;
  cid: string;
  amount_lamports: string;
  status: string;
  challenge_window_seconds: number;
  challenge_window_ends_at: Date | null;
  pin_verified_at: Date | null;
  pin_verification_detail: string | null;
  settle_tx_signature: string | null;
  settle_attempted_at: Date | null;
  settle_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DisputeRow {
  id: string;
  deal_id: string;
  raised_by: string;
  reason: string;
  raised_at: Date;
  resolved: boolean;
}

function toDeal(row: DealRow): Deal {
  return {
    id: Number(row.id),
    dealId: row.deal_id,
    dealPda: row.deal_pda,
    depositor: row.depositor,
    provider: row.provider,
    oracle: row.oracle,
    cid: row.cid,
    // BIGINT arrives as a string to avoid precision loss; the domain type is
    // bigint and lamport amounts fit comfortably.
    amountLamports: BigInt(row.amount_lamports),
    status: row.status as DealStatus,
    challengeWindowSeconds: row.challenge_window_seconds,
    challengeWindowEndsAt: row.challenge_window_ends_at,
    pinVerifiedAt: row.pin_verified_at,
    pinVerificationDetail: row.pin_verification_detail,
    settleTxSignature: row.settle_tx_signature,
    settleAttemptedAt: row.settle_attempted_at,
    settleError: row.settle_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDispute(row: DisputeRow): Dispute {
  return {
    id: Number(row.id),
    dealId: Number(row.deal_id),
    raisedBy: row.raised_by,
    reason: row.reason,
    raisedAt: row.raised_at,
    resolved: row.resolved,
  };
}

const DEAL_COLUMNS = `
  id, deal_id, deal_pda, depositor, provider, oracle, cid, amount_lamports,
  status, challenge_window_seconds, challenge_window_ends_at,
  pin_verified_at, pin_verification_detail,
  settle_tx_signature, settle_attempted_at, settle_error,
  created_at, updated_at
`;

export class DealRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Register a deal. Starts in `pending_verification` — a deal is never created
   * directly into a challenge window, so an unverified deal cannot be swept up
   * by the settle job even if registration is called again.
   *
   * Idempotent on `deal_pda`: re-registering the same PDA returns the existing
   * row untouched rather than resetting its lifecycle. Resetting would be a
   * denial-of-service vector (re-register a disputed deal and watch it
   * auto-settle).
   */
  async create(deal: NewDeal): Promise<Deal> {
    const { rows } = await this.db.query<DealRow>(
      `INSERT INTO deals (
         deal_id, deal_pda, depositor, provider, oracle, cid,
         amount_lamports, status, challenge_window_seconds
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_verification', $8)
       ON CONFLICT (deal_pda) DO NOTHING
       RETURNING ${DEAL_COLUMNS}`,
      [
        deal.dealId,
        deal.dealPda,
        deal.depositor,
        deal.provider,
        deal.oracle,
        deal.cid,
        deal.amountLamports.toString(),
        deal.challengeWindowSeconds,
      ]
    );

    if (rows[0]) return toDeal(rows[0]);

    // Conflict: the row already existed. Return it as-is.
    const existing = await this.findByPda(deal.dealPda);
    if (!existing) {
      throw new Error(`deal ${deal.dealPda} vanished during create`);
    }
    return existing;
  }

  async findByPda(dealPda: string): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `SELECT ${DEAL_COLUMNS} FROM deals WHERE deal_pda = $1`,
      [dealPda]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  async findById(id: number): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `SELECT ${DEAL_COLUMNS} FROM deals WHERE id = $1`,
      [id]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /** Look up by either handle, so the API can accept a PDA or a deal_id. */
  async findByIdentifier(identifier: string): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `SELECT ${DEAL_COLUMNS} FROM deals
         WHERE deal_pda = $1 OR deal_id = $1
         ORDER BY created_at ASC
         LIMIT 1`,
      [identifier]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /**
   * Mark a deal verified and open its challenge window.
   *
   * Conditional on `pending_verification`, so a replayed verification cannot
   * reopen a window that has already closed or been disputed.
   */
  async openChallengeWindow(
    id: number,
    detail: string,
    windowSeconds: number
  ): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `UPDATE deals
          SET status = 'in_challenge_window',
              pin_verified_at = now(),
              pin_verification_detail = $2,
              challenge_window_seconds = $3::int,
              challenge_window_ends_at = now() + make_interval(secs => $3::double precision),
              updated_at = now()
        WHERE id = $1 AND status = 'pending_verification'
        RETURNING ${DEAL_COLUMNS}`,
      [id, detail, windowSeconds]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /** Record that verification said "not pinned, do not settle". */
  async markVerificationFailed(id: number, detail: string): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `UPDATE deals
          SET status = 'settlement_failed',
              pin_verification_detail = $2,
              updated_at = now()
        WHERE id = $1 AND status = 'pending_verification'
        RETURNING ${DEAL_COLUMNS}`,
      [id, detail]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /**
   * Claim a deal for settlement.
   *
   * This is the guard that stops the race between a dispute and the job. It
   * only succeeds while the status is *still* `in_challenge_window` and the
   * window has actually elapsed, and it moves the deal to a status the job no
   * longer selects. The caller then performs the on-chain submission and
   * reports the outcome.
   *
   * The window-bound comparison uses the database clock, not the app's, so
   * clock skew between the service and Postgres cannot make a deal settle early.
   */
  async claimDueForSettlement(id: number): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `UPDATE deals
          SET status = 'settlement_failed',
              settle_attempted_at = now(),
              updated_at = now()
        WHERE id = $1
          AND status = 'in_challenge_window'
          AND challenge_window_ends_at IS NOT NULL
          AND challenge_window_ends_at <= now()
        RETURNING ${DEAL_COLUMNS}`,
      [id]
    );
    // The intermediate `settlement_failed` is a claim marker: the row is out of
    // the job's reach until `recordSettleSuccess` or `recordSettleFailure`
    // resolves it. A crash between claim and submission therefore leaves the
    // deal visibly unsettled rather than silently lost.
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /** Record a confirmed on-chain settle. */
  async recordSettleSuccess(id: number, signature: string): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `UPDATE deals
          SET status = 'settled',
              settle_tx_signature = $2,
              settle_error = NULL,
              updated_at = now()
        WHERE id = $1 AND status = 'settlement_failed'
        RETURNING ${DEAL_COLUMNS}`,
      [id, signature]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /**
   * Record a failed settle and put the deal back in the window.
   *
   * Restoring `in_challenge_window` (with the original, already-elapsed window
   * end) is deliberate: a transient RPC failure should be retried on the next
   * tick, and a permanent failure should be visible as a repeatedly-failing
   * deal rather than a deal that quietly stopped being settleable. The status
   * is *not* restored if a dispute arrived in the meantime — see the guard.
   */
  async recordSettleFailure(id: number, error: string): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `UPDATE deals
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM disputes
                   WHERE disputes.deal_id = deals.id AND disputes.resolved = FALSE
                ) THEN 'disputed'
                ELSE 'in_challenge_window'
              END,
              settle_error = $2,
              updated_at = now()
        WHERE id = $1 AND status = 'settlement_failed'
        RETURNING ${DEAL_COLUMNS}`,
      [id, error]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /** Mark a deal refunded (the depositor reclaimed after the deadline). */
  async markRefunded(id: number): Promise<Deal | null> {
    const { rows } = await this.db.query<DealRow>(
      `UPDATE deals
          SET status = 'refunded', updated_at = now()
        WHERE id = $1 AND status IN ('pending_verification', 'in_challenge_window')
        RETURNING ${DEAL_COLUMNS}`,
      [id]
    );
    return rows[0] ? toDeal(rows[0]) : null;
  }

  /**
   * The job's work list: windows that have closed with no dispute.
   *
   * The `NOT EXISTS` clause is belt-and-braces. The status transition to
   * `disputed` already implies a dispute row exists, so this filter should
   * never exclude anything the status check let through — but stating the
   * invariant in the query means a future bug that forgets to flip the status
   * still cannot auto-settle a disputed deal.
   */
  async findDueForSettlement(limit = 50): Promise<Deal[]> {
    const { rows } = await this.db.query<DealRow>(
      `SELECT ${DEAL_COLUMNS} FROM deals d
        WHERE d.status = 'in_challenge_window'
          AND d.challenge_window_ends_at IS NOT NULL
          AND d.challenge_window_ends_at <= now()
          AND NOT EXISTS (
            SELECT 1 FROM disputes
             WHERE disputes.deal_id = d.id AND disputes.resolved = FALSE
          )
        ORDER BY d.challenge_window_ends_at ASC
        LIMIT $1`,
      [limit]
    );
    return rows.map(toDeal);
  }

  async list(limit = 100): Promise<Deal[]> {
    const { rows } = await this.db.query<DealRow>(
      `SELECT ${DEAL_COLUMNS} FROM deals ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map(toDeal);
  }
}

export class DisputeRepository {
  /**
   * Takes the pool, not a bare `Queryable`: raising a dispute needs a
   * transaction with a `FOR UPDATE` lock, and a pooled client is the only thing
   * that can provide one.
   */
  constructor(private readonly pool: Pool) {}

  /**
   * Raise a dispute, atomically with the status flip.
   *
   * Both writes happen in one transaction so there is no window in which a
   * dispute row exists but the deal still reads `in_challenge_window`.
   */
  async raise(
    dealId: number,
    raisedBy: string,
    reason: string
  ): Promise<{ ok: true; dispute: Dispute; deal: Deal } | { ok: false; code: DisputeRejection }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const dealResult = await client.query<DealRow>(
        `SELECT ${DEAL_COLUMNS} FROM deals WHERE id = $1 FOR UPDATE`,
        [dealId]
      );
      const row = dealResult.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, code: "deal_not_found" };
      }
      const deal = toDeal(row);

      // Explicit, ordered reasons, because "why was my dispute refused" is the
      // question a depositor actually asks and a generic 409 does not answer.
      if (deal.status === "settled") {
        await client.query("ROLLBACK");
        return { ok: false, code: "already_settled" };
      }
      if (deal.status === "refunded") {
        await client.query("ROLLBACK");
        return { ok: false, code: "already_refunded" };
      }
      if (deal.status === "disputed") {
        await client.query("ROLLBACK");
        return { ok: false, code: "already_disputed" };
      }
      if (deal.status !== "in_challenge_window") {
        await client.query("ROLLBACK");
        return { ok: false, code: "not_in_challenge_window" };
      }
      if (
        deal.challengeWindowEndsAt !== null &&
        deal.challengeWindowEndsAt.getTime() <= Date.now()
      ) {
        await client.query("ROLLBACK");
        return { ok: false, code: "window_closed" };
      }

      const disputeResult = await client.query<DisputeRow>(
        `INSERT INTO disputes (deal_id, raised_by, reason)
         VALUES ($1, $2, $3)
         RETURNING id, deal_id, raised_by, reason, raised_at, resolved`,
        [dealId, raisedBy, reason]
      );

      const updated = await client.query<DealRow>(
        `UPDATE deals SET status = 'disputed', updated_at = now()
          WHERE id = $1 AND status = 'in_challenge_window'
          RETURNING ${DEAL_COLUMNS}`,
        [dealId]
      );

      await client.query("COMMIT");

      if (!updated.rows[0]) {
        // The FOR UPDATE lock makes this unreachable, but if it ever fired the
        // safe interpretation is "we do not know the state": refuse rather than
        // report a dispute that may not have taken effect.
        throw new Error("deal status changed while holding the row lock");
      }

      return {
        ok: true,
        dispute: toDispute(disputeResult.rows[0]),
        deal: toDeal(updated.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async findUnresolvedForDeal(dealId: number): Promise<Dispute | null> {
    const { rows } = await this.pool.query<DisputeRow>(
      `SELECT id, deal_id, raised_by, reason, raised_at, resolved
         FROM disputes
        WHERE deal_id = $1 AND resolved = FALSE
        ORDER BY raised_at DESC LIMIT 1`,
      [dealId]
    );
    return rows[0] ? toDispute(rows[0]) : null;
  }

  async listForDeal(dealId: number): Promise<Dispute[]> {
    const { rows } = await this.pool.query<DisputeRow>(
      `SELECT id, deal_id, raised_by, reason, raised_at, resolved
         FROM disputes WHERE deal_id = $1 ORDER BY raised_at DESC`,
      [dealId]
    );
    return rows.map(toDispute);
  }
}

/**
 * Why a dispute was refused. Each maps to a distinct HTTP status at the edge;
 * see `src/http/server.ts`.
 */
export type DisputeRejection =
  | "deal_not_found"
  | "window_closed"
  | "already_settled"
  | "already_refunded"
  | "already_disputed"
  | "not_in_challenge_window";
