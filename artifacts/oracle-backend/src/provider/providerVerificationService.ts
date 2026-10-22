/**
 * The findprovs verification job's logic, separated from its schedule so it can
 * be driven one tick at a time in a test or by an operator.
 *
 * One tick:
 *
 *   1. List the assignments from the api-server's internal feed.
 *   2. For each, ask the DHT whether the assigned peer is advertising the CID.
 *   3. Apply the decision rule (`decideAssignment`) and write the verdict back.
 *
 * Three properties matter more than the loop:
 *
 *   - **A DHT transport failure leaves the stored state alone.** Reporting
 *     `unknown` must not overwrite a previous good or bad verdict — otherwise a
 *     Kubo restart would blank every deal's status. So the *verdict* (the
 *     at-risk flag and detail) is skipped for `unknown`; only
 *     `verified`/`at_risk` verdicts are persisted.
 *
 *   - **The negative streak is persisted even for `unknown`.** This is the one
 *     thing that must be written on a below-threshold `unknown`, and it is the
 *     whole point of the streak: the counter has to advance across sweeps or it
 *     can never reach the threshold. A DHT transport failure carries the streak
 *     forward unchanged (`decideAssignment` returns the previous value), so a
 *     transient error neither advances nor resets it.
 *
 *   - **One failing assignment does not abort the tick.** Each is wrapped, and a
 *     throw is logged and recorded as `unknown` for that assignment only.
 *
 * Deals with no assignment (the Pinata path) are simply absent from the feed and
 * are untouched by this job — the existing Pinata verification is unchanged.
 */

import type { Logger } from "../logger";
import type { KuboFindProvsClient, FindProvsResult } from "../ipfs/findprovs";
import { describeFindProvsError, isFindProvsTransportError } from "../ipfs/findprovs";
import type { InternalProviderFeed } from "./internalFeed";
import {
  decideAssignment,
  type AssignmentView,
  type VerificationVerdict,
} from "./providerVerification";
import type { SecretRegistry } from "../security/redact";

export interface ProviderVerificationDeps {
  feed: InternalProviderFeed;
  findProvs: KuboFindProvsClient;
  logger: Logger;
  registry: SecretRegistry;
  /** A heartbeat older than this marks the node silent (one half of at-risk). */
  heartbeatStaleMs: number;
  /**
   * How many consecutive conclusive-negative sweeps are required before a deal
   * is flagged at-risk. Default 3; see `decideAssignment` for why one is not
   * enough.
   */
  consecutiveNegatives: number;
  now?: () => Date;
}

export interface AssignmentOutcome {
  assignmentId: number;
  dealId: number;
  outcome: VerificationVerdict["outcome"];
  atRisk: boolean | null;
}

export interface VerificationRunSummary {
  scanned: number;
  atRisk: number;
  verified: number;
  unknown: number;
  results: AssignmentOutcome[];
}

export class ProviderVerificationService {
  constructor(private readonly deps: ProviderVerificationDeps) {}

  async runOnce(): Promise<VerificationRunSummary> {
    const summary: VerificationRunSummary = {
      scanned: 0,
      atRisk: 0,
      verified: 0,
      unknown: 0,
      results: [],
    };

    let assignments: AssignmentView[];
    try {
      assignments = await this.deps.feed.listAssignments();
    } catch (err) {
      // The whole tick could not start. Not per-deal, so this is logged and the
      // summary is returned empty rather than thrown — the scheduler's caller
      // must not die on an api-server blip.
      this.deps.logger.error("provider verification: could not list assignments", {
        error: describeFindProvsError(err, this.deps.registry),
      });
      return summary;
    }

    summary.scanned = assignments.length;

    for (const assignment of assignments) {
      const outcome = await this.#verifyOne(assignment);
      summary.results.push(outcome);
      if (outcome.outcome === "at_risk") summary.atRisk += 1;
      else if (outcome.outcome === "verified") summary.verified += 1;
      else summary.unknown += 1;
    }

    return summary;
  }

  async #verifyOne(assignment: AssignmentView): Promise<AssignmentOutcome> {
    let findProvs: FindProvsResult | null = null;
    try {
      findProvs = await this.deps.findProvs.isPeerAdvertising(
        assignment.cid,
        assignment.peerId
      );
    } catch (err) {
      if (!isFindProvsTransportError(err)) throw err;
      // Transport failure: `findProvs` stays null → the verdict is `unknown`
      // and the stored state is left alone.
      this.deps.logger.warn("findprovs query failed", {
        cid: assignment.cid,
        peerId: assignment.peerId,
        error: describeFindProvsError(err, this.deps.registry),
      });
    }

    const verdict = decideAssignment(assignment, findProvs, {
      heartbeatStaleMs: this.deps.heartbeatStaleMs,
      consecutiveNegatives: this.deps.consecutiveNegatives,
      now: this.deps.now,
    });

    // Two different writes, deliberately:
    //
    //   - A real verdict (`verified`/`at_risk`) writes at_risk + detail + the
    //     streak, and only then is `last_verified_at` touched.
    //   - A below-threshold conclusive negative is `unknown` — there is no verdict
    //     — but its streak must still advance, or the counter could never reach
    //     the threshold. That write touches *only* the counter, so it cannot
    //     clear a stored `at_risk`.
    //
    // The streak write is skipped when the value is unchanged, which is the case
    // for every inconclusive answer and every transport failure: those carry the
    // previous streak forward, so writing would be a pointless PATCH per sweep.
    const previousStreak = assignment.consecutiveConclusiveNegatives ?? 0;
    try {
      if (verdict.outcome !== "unknown") {
        await this.deps.feed.recordVerdict(
          assignment.assignmentId,
          verdict.atRisk,
          verdict.detail,
          verdict.consecutiveConclusiveNegatives
        );
      } else if (verdict.consecutiveConclusiveNegatives !== previousStreak) {
        await this.deps.feed.recordNegativeStreak(
          assignment.assignmentId,
          verdict.consecutiveConclusiveNegatives
        );
      }
    } catch (err) {
      this.deps.logger.error("could not record provider verification verdict", {
        assignmentId: assignment.assignmentId,
        error: describeFindProvsError(err, this.deps.registry),
      });
    }

    if (verdict.outcome === "at_risk") {
      this.deps.logger.warn("deal flagged at-risk", {
        dealId: assignment.dealId,
        cid: assignment.cid,
        peerId: assignment.peerId,
        detail: verdict.detail,
      });
    }

    return {
      assignmentId: assignment.assignmentId,
      dealId: assignment.dealId,
      outcome: verdict.outcome,
      atRisk: verdict.atRisk,
    };
  }
}
