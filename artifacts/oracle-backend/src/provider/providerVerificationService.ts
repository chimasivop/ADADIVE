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
 * Two properties matter more than the loop:
 *
 *   - **A DHT transport failure leaves the stored state alone.** Reporting
 *     `unknown` must not overwrite a previous good or bad verdict — otherwise a
 *     Kubo restart would blank every deal's status. So the write is skipped for
 *     `unknown` verdicts; only `verified`/`at_risk` are persisted.
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
      now: this.deps.now,
    });

    // Only persist a real verdict. An `unknown` leaves last_verified_at and the
    // at-risk flag exactly as they were.
    if (verdict.outcome !== "unknown") {
      try {
        await this.deps.feed.recordVerdict(
          assignment.assignmentId,
          verdict.atRisk,
          verdict.detail
        );
      } catch (err) {
        this.deps.logger.error("could not record provider verification verdict", {
          assignmentId: assignment.assignmentId,
          error: describeFindProvsError(err, this.deps.registry),
        });
      }
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
