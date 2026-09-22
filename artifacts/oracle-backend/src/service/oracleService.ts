/**
 * The oracle service: the decision logic of optimistic-challenge settlement.
 *
 * This is where the phase's core rules live, separated from HTTP and from the
 * database so both can be tested around it:
 *
 *   1. A provider asks to settle.
 *   2. Verify the CID is actually pinned and retrievable. Not an upload
 *      request — the pin itself (see `verifyPinStatus`).
 *   3. If verified, do *not* settle. Open a challenge window.
 *   4. During the window, the depositor may dispute.
 *   5. If the window closes with no dispute, sign as oracle and submit.
 *   6. If a dispute exists, do not settle. At all. Ever. (Manual resolution is
 *      out of scope; the requirement here is only that auto-settle halts.)
 *
 * The ordering of checks in `runChallengeWindowJob` is the security-critical
 * part, and it is enforced twice: once in application logic (so the reason is
 * legible) and once in SQL (so a bug in the application logic cannot settle a
 * disputed deal). `claimDueForSettlement` only matches rows still in
 * `in_challenge_window`, and a dispute moves the row out of that state inside a
 * transaction. See `DealRepository` for why that is race-free.
 */

import { Keypair, PublicKey } from "@solana/web3.js";

import type { Logger } from "../logger";
import type { DealRepository, DisputeRepository } from "../db/repository";
import type { Deal, DealStatus } from "../db/types";
import type { PinVerification } from "../pinata/pinStatus";
import type { OracleKeypair } from "../oracle/keyProvider";
import type { EscrowChain, ProviderSignatureStrategy } from "../chain/escrowChain";
import { resolveProviderSignature } from "../chain/escrowChain";
import { safeErrorMessage, type SecretRegistry } from "../security/redact";

/**
 * Everything the service needs, injected.
 *
 * `verifyPin` is a function rather than the client object so a test can supply
 * a two-line stub and assert on the verification *decision* without mocking
 * HTTP. The real one is `PinataClient.verifyPinStatus`.
 */
export interface OracleServiceDeps {
  deals: DealRepository;
  disputes: DisputeRepository;
  verifyPin: (cid: string) => Promise<PinVerification>;
  chain: EscrowChain;
  oracle: OracleKeypair;
  logger: Logger;
  registry: SecretRegistry;
  providerSignatureStrategy: ProviderSignatureStrategy;
  /** Development only; refused for non-demo strategies. */
  demoProvider: Keypair | null;
  /**
   * Injectable clock.
   *
   * Tests need to move time past a 48-hour window without waiting two days or
   * mutating `Date.now` globally (which would leak into other tests and into
   * the database's own `now()` comparisons). The job's *authoritative* window
   * check happens in SQL against `now()`, so tests that need the job to fire
   * also shorten the window — see the integration tests, which set a
   * one-second window rather than rewinding the clock.
   */
  now?: () => Date;
}

/** Result of a settle request, before any window opens. */
export type SettleRequestResult =
  | {
      ok: true;
      outcome: "challenge_window_opened";
      deal: Deal;
      verification: PinVerification;
    }
  | {
      ok: false;
      outcome: "already_settled" | "already_disputed" | "already_refunded";
      deal: Deal;
    }
  | {
      ok: false;
      outcome: "not_pinned";
      deal: Deal;
      verification: PinVerification;
    }
  | {
      ok: false;
      outcome: "verification_error";
      deal: Deal;
      error: string;
    };

/** One deal's processing result during a job run. */
export type JobDealResult =
  | { dealPda: string; action: "settled"; signature: string }
  | { dealPda: string; action: "skipped"; reason: string }
  | { dealPda: string; action: "settle_failed"; error: string };

export interface JobRunSummary {
  scanned: number;
  results: JobDealResult[];
}

export class OracleService {
  constructor(private readonly deps: OracleServiceDeps) {}

  /**
   * A provider asks to settle a deal.
   *
   * The deal must already be registered (it is created when the deal is
   * initialized; see the API's register endpoint). The flow:
   *
   *   - terminal states short-circuit: a settled/disputed/refunded deal is not
   *     re-openable, and the response says which one it is.
   *   - verification runs against `deal.cid`, which is stored on the deal
   *     rather than supplied by the caller, so a settle request cannot point
   *     the verifier at a healthy CID that is not this deal's.
   *   - a verified deal moves to `in_challenge_window` and *stops there*. No
   *     transaction is built, no signature is produced.
   *
   * Note what is absent: this method never submits a settle. Settlement is
   * exclusively the job's job.
   */
  async requestSettle(deal: Deal): Promise<SettleRequestResult> {
    if (deal.status === "settled") {
      return { ok: false, outcome: "already_settled", deal };
    }
    if (deal.status === "disputed") {
      return { ok: false, outcome: "already_disputed", deal };
    }
    if (deal.status === "refunded") {
      return { ok: false, outcome: "already_refunded", deal };
    }
    if (deal.status === "in_challenge_window") {
      // Idempotent: a second request is not an error, it just reports where the
      // deal already is. Re-verifying would be wasted work and re-opening the
      // window would extend it, which an adversarial provider could farm.
      return {
        ok: true,
        outcome: "challenge_window_opened",
        deal,
        verification: {
          ok: true,
          reason: "pinned_and_retrievable",
          detail: "challenge window already open; verification not repeated",
        },
      };
    }

    let verification: PinVerification;
    try {
      verification = await this.deps.verifyPin(deal.cid);
    } catch (err) {
      // Unknown, not "not pinned": a Pinata outage must not permanently fail a
      // deal. The deal stays in `pending_verification` and the provider can ask
      // again.
      const message = safeErrorMessage(err, this.deps.registry);
      this.deps.logger.warn("pin verification failed to complete", {
        dealPda: deal.dealPda,
        error: message,
      });
      return { ok: false, outcome: "verification_error", deal, error: message };
    }

    if (!verification.ok) {
      // Definitively not pinned. Record it and refuse.
      const updated =
        (await this.deps.deals.markVerificationFailed(
          deal.id,
          verification.detail
        )) ?? deal;
      this.deps.logger.info("settle refused: pin not verified", {
        dealPda: deal.dealPda,
        cid: deal.cid,
        reason: verification.reason,
      });
      return { ok: false, outcome: "not_pinned", deal: updated, verification };
    }

    const opened = await this.deps.deals.openChallengeWindow(
      deal.id,
      verification.detail,
      // The window recorded on the deal, not the service default. A deal
      // registered with a shorter (or longer) window must get that one; using
      // the default here would silently override per-deal configuration.
      deal.challengeWindowSeconds
    );

    if (!opened) {
      // Lost a race (another request verified concurrently, or a dispute
      // arrived). Re-read and report the truth rather than pretending.
      const current = (await this.deps.deals.findByPda(deal.dealPda)) ?? deal;
      this.deps.logger.info("challenge window not opened (state changed)", {
        dealPda: deal.dealPda,
        status: current.status,
      });
      return current.status === "in_challenge_window"
        ? {
            ok: true,
            outcome: "challenge_window_opened",
            deal: current,
            verification,
          }
        : { ok: false, outcome: "already_disputed", deal: current };
    }

    this.deps.logger.info("challenge window opened", {
      dealPda: opened.dealPda,
      cid: opened.cid,
      endsAt: opened.challengeWindowEndsAt?.toISOString(),
      windowSeconds: opened.challengeWindowSeconds,
    });

    return {
      ok: true,
      outcome: "challenge_window_opened",
      deal: opened,
      verification,
    };
  }

  /**
   * The challenge-window job: settle every deal whose window has closed clean.
   *
   * Runs on a timer (see `src/jobs/`), and is safe to run concurrently with
   * itself and with dispute requests:
   *
   *   - `findDueForSettlement` filters out disputed deals in SQL;
   *   - `claimDueForSettlement` moves a deal out of `in_challenge_window` under
   *     a conditional UPDATE, so two job instances cannot both settle the same
   *     deal and a dispute that lands first wins.
   *
   * A deal claimed but not settled (crash, RPC failure) is left in
   * `settlement_failed`, which is *visible* — the next run's failure path
   * attempts to restore it to the window. Silently dropping a due deal is the
   * one outcome this design refuses to allow.
   */
  async runChallengeWindowJob(): Promise<JobRunSummary> {
    const due = await this.deps.deals.findDueForSettlement();
    const results: JobDealResult[] = [];

    for (const deal of due) {
      results.push(await this.processDueDeal(deal));
    }

    if (due.length > 0) {
      this.deps.logger.info("challenge window job complete", {
        scanned: due.length,
        settled: results.filter((r) => r.action === "settled").length,
        failed: results.filter((r) => r.action === "settle_failed").length,
      });
    }

    return { scanned: due.length, results };
  }

  /** Settle (or decline to settle) one deal whose window is due. */
  private async processDueDeal(deal: Deal): Promise<JobDealResult> {
    // Re-check the dispute condition immediately before claiming. The SQL
    // filter already did this, but this read makes the *reason* legible in the
    // logs and closes the gap between the list query and the claim.
    const dispute = await this.deps.disputes.findUnresolvedForDeal(deal.id);
    if (dispute) {
      this.deps.logger.info("skipping settlement: unresolved dispute", {
        dealPda: deal.dealPda,
        raisedBy: dispute.raisedBy,
      });
      return {
        dealPda: deal.dealPda,
        action: "skipped",
        reason: `unresolved dispute raised by ${dispute.raisedBy}`,
      };
    }

    const claimed = await this.deps.deals.claimDueForSettlement(deal.id);
    if (!claimed) {
      // Another worker got it, or a dispute landed, or the window moved. All
      // benign; report and move on.
      return {
        dealPda: deal.dealPda,
        action: "skipped",
        reason: "deal was claimed by another worker or changed state",
      };
    }

    try {
      const providerSignature = await resolveProviderSignature(
        this.deps.providerSignatureStrategy,
        this.deps.demoProvider
      );

      const { signature } = await this.deps.chain.settleAsOracle({
        dealPda: new PublicKey(claimed.dealPda),
        oracle: this.deps.oracle,
        providerSignature,
      });

      await this.deps.deals.recordSettleSuccess(claimed.id, signature);
      this.deps.logger.info("auto-settled deal", {
        dealPda: claimed.dealPda,
        signature,
      });
      return { dealPda: claimed.dealPda, action: "settled", signature };
    } catch (err) {
      const message = safeErrorMessage(err, this.deps.registry);
      await this.deps.deals.recordSettleFailure(claimed.id, message);
      this.deps.logger.error("auto-settle failed; deal returned to the window", {
        dealPda: claimed.dealPda,
        error: message,
      });
      return { dealPda: claimed.dealPda, action: "settle_failed", error: message };
    }
  }

  /**
   * Raise a dispute. Thin pass-through so the HTTP layer never touches the
   * repositories directly.
   */
  async raiseDispute(dealId: number, raisedBy: string, reason: string) {
    return this.deps.disputes.raise(dealId, raisedBy, reason);
  }
}

/** Convenience for tests and the API: is this status terminal? */
export function isTerminal(status: DealStatus): boolean {
  return status === "settled" || status === "refunded" || status === "disputed";
}
