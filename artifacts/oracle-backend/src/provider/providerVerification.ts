/**
 * Provider-node verification decision.
 *
 * This is the pure rule the brief asks for, isolated from HTTP and the
 * database so it can be tested directly:
 *
 *   A deal assigned to a provider node is **at-risk** when
 *   (a) the provider's heartbeat is stale **and**
 *   (b) `findprovs` has conclusively failed to show the assigned peer id
 *       advertising the CID on `consecutiveNegatives` sweeps **in a row**.
 *
 * The two halves are deliberate:
 *
 *   - Either signal alone is a warning, not a verdict. A node can be briefly
 *     unreachable over the heartbeat channel while still serving content (the
 *     heartbeat endpoint may be down, or a beat lost), and a node can broadcast
 *     a fresh heartbeat while the content has been garbage-collected. One says
 *     "maybe gone", the other says "claiming to be here"; only both together mean
 *     "paying for storage that is not there".
 *
 *   - An **inconclusive** findprovs answer (e.g. the search hit its provider
 *     limit) never flags a deal. Flagging on an incomplete answer would turn a
 *     busy DHT into false positives across the whole network. It is also not a
 *     *positive* result: an inconclusive answer is decided **before** the
 *     heartbeat is consulted, so it can neither flag a deal nor clear a stored
 *     flag. See `decideAssignment`.
 *
 *   - A **single conclusive negative** is not enough either. `findprovs` has no
 *     terminal sentinel, and a response that ends cleanly but early is
 *     byte-identical to a completed search (see `ipfs/findprovs.ts`), so one
 *     "nobody has it" cannot be trusted on its own. Requiring a run of them means
 *     a one-off truncation — or any other transient that looks like an absence —
 *     cannot flag a deal; only a *sustained* pattern does. The count is
 *     `consecutiveNegatives` (config:
 *     `PROVIDER_VERIFICATION_CONSECUTIVE_NEGATIVES`, default 3) and the running
 *     streak lives on the assignment row, so it survives an oracle restart. A
 *     conclusive *positive* resets it to zero.
 *
 * A transport failure querying the DHT is *not* a verdict either: it is
 * reported as `unknown`, and the caller leaves the deal's existing verification
 * state untouched rather than overwriting a good result with a guess.
 *
 * The result is explicit — `atRisk: true` with a reason — never a silent failure.
 */

import type { FindProvsResult } from "../ipfs/findprovs";

/** One assignment as the api-server's internal feed reports it. */
export interface AssignmentView {
  assignmentId: number;
  dealId: number;
  cid: string;
  dealStatus: string;
  providerId: number;
  peerId: string;
  status: string;
  /**
   * Last heartbeat for this assignment's *peer* (as the api-server reports it),
   * not the provider row's — so a provider that rotated to a different node does
   * not read as liveness for a deal still bound to the old peer.
   */
  lastHeartbeatAt: string | null;
  /**
   * The streak of consecutive conclusive-negative sweeps recorded so far. The
   * oracle reads this, adds one for the current negative, and writes the total
   * back, so the at-risk flag needs `consecutiveNegatives` sightings rather than
   * one (see `decideAssignment` for why one is not enough).
   */
  consecutiveConclusiveNegatives: number;
}

export type VerificationVerdict =
  | { outcome: "verified"; atRisk: false; detail: string }
  | { outcome: "at_risk"; atRisk: true; detail: string }
  | { outcome: "unknown"; atRisk: null; detail: string };

export interface VerifyOptions {
  /** How old a heartbeat may be before the node is considered silent. */
  heartbeatStaleMs: number;
  /**
   * How many *consecutive* conclusive-negative sweeps are required before a deal
   * is flagged at-risk. 1 restores "flag on the first negative".
   */
  consecutiveNegatives: number;
  /** Injectable clock, for tests that must not sleep. */
  now?: () => Date;
}

/**
 * The streak to store after this sweep, and the verdict that follows from it.
 *
 * Exported so the service can persist the streak even when the outcome is
 * `unknown` (below the threshold) — otherwise the counter would never advance.
 */
export interface StreakOutcome {
  /** Consecutive conclusive negatives including this sweep. */
  consecutiveConclusiveNegatives: number;
  /** True when the threshold has been reached and the deal should be flagged. */
  reachedThreshold: boolean;
}

/**
 * Decide a single assignment's state.
 *
 * `findProvs` is the already-resolved DHT answer, or `null` when the query
 * could not be completed (transport error). **Anything that is not a conclusive
 * answer** — a transport error (`null`) or an inconclusive result — yields
 * `unknown`, and the caller must not change the stored verdict. Both are
 * checked *before* the heartbeat, so a fresh heartbeat can never turn a partial
 * answer into a `verified`/`atRisk: false` write that clears a stored flag.
 *
 * The returned value also carries the new consecutive-negative streak, which the
 * caller must persist *even when the outcome is `unknown`* (below the
 * threshold): otherwise the counter could never reach it. See the module header
 * and `consecutiveNegatives` for why a single negative is not acted on.
 */
export function decideAssignment(
  assignment: AssignmentView,
  findProvs: FindProvsResult | null,
  options: VerifyOptions
): VerificationVerdict & StreakOutcome {
  const now = (options.now ?? (() => new Date()))();
  const threshold = Math.max(1, options.consecutiveNegatives);
  const previousStreak = assignment.consecutiveConclusiveNegatives ?? 0;

  if (findProvs === null) {
    return {
      outcome: "unknown",
      atRisk: null,
      detail:
        `could not query the DHT for ${assignment.cid}; ` +
        `leaving the previous verification state unchanged`,
      // No evidence either way: the streak is carried forward untouched.
      consecutiveConclusiveNegatives: previousStreak,
      reachedThreshold: false,
    };
  }

  // An inconclusive answer is not evidence in *either* direction, so it is
  // decided before the heartbeat is even consulted — exactly like a transport
  // failure above, and for the same reason: the stored verdict must not be
  // overwritten by a guess. This has to come first. Gating it behind
  // `heartbeatStale` used to let a fresh heartbeat fall through to the
  // `verified` return below, writing `atRisk: false` on a partial answer and
  // silently clearing a previously-stored at-risk flag even though nothing was
  // confirmed. The streak is carried forward untouched.
  if (!findProvs.conclusive) {
    return {
      outcome: "unknown",
      atRisk: null,
      detail:
        `the DHT answer for ${assignment.cid} was inconclusive ` +
        `(${findProvs.detail}); not flagging on a partial answer`,
      consecutiveConclusiveNegatives: previousStreak,
      reachedThreshold: false,
    };
  }

  // 1. Is the heartbeat stale? No heartbeat at all is treated as stale: a node
  //    that has never reported in cannot be assumed alive.
  const heartbeatAgeMs =
    assignment.lastHeartbeatAt === null
      ? Number.POSITIVE_INFINITY
      : now.getTime() - Date.parse(assignment.lastHeartbeatAt);
  const heartbeatStale =
    !Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs > options.heartbeatStaleMs;

  // 2. Is the peer still advertising? From here the answer is conclusive, so a
  //    non-advertising result *is* evidence of absence.
  const peerMissing = !findProvs.advertising;

  // The streak only moves on a *conclusive* answer: a conclusive negative
  // advances it, a conclusive positive resets it.
  const streak = peerMissing ? previousStreak + 1 : 0;
  const reachedThreshold = peerMissing && streak >= threshold;

  if (heartbeatStale && peerMissing && reachedThreshold) {
    return {
      outcome: "at_risk",
      atRisk: true,
      detail:
        `heartbeat is stale ` +
        (Number.isFinite(heartbeatAgeMs)
          ? `(${Math.round(heartbeatAgeMs / 1000)}s old) `
          : "(never reported) ") +
        `and ${findProvs.detail} ` +
        `(conclusive negative ${streak}/${threshold} sweeps in a row)`,
      consecutiveConclusiveNegatives: streak,
      reachedThreshold,
    };
  }

  if (heartbeatStale && peerMissing) {
    // Below the threshold. This is the important case: one conclusive negative is
    // not enough, because a cleanly-ended-but-early stream is indistinguishable
    // from a completed search. Report `unknown` so the stored verdict is not
    // overwritten, but the streak (above) is carried forward.
    return {
      outcome: "unknown",
      atRisk: null,
      detail:
        `heartbeat is stale and ${findProvs.detail}, but that is only ` +
        `${streak} of ${threshold} consecutive conclusive negatives ` +
        `required; not flagging yet`,
      consecutiveConclusiveNegatives: streak,
      reachedThreshold,
    };
  }

  if (heartbeatStale) {
    return {
      outcome: "verified",
      atRisk: false,
      detail:
        `heartbeat is stale ` +
        (Number.isFinite(heartbeatAgeMs)
          ? `(${Math.round(heartbeatAgeMs / 1000)}s old) `
          : "(never reported) ") +
        `but ${findProvs.detail}`,
      consecutiveConclusiveNegatives: streak,
      reachedThreshold,
    };
  }

  // Fresh heartbeat: the node is alive. Whether it still advertises the content
  // is checked and reported, but a fresh heartbeat alone does not flag a deal —
  // it is the "both signals" rule.
  return {
    outcome: "verified",
    atRisk: false,
    detail: `heartbeat is fresh and ${findProvs.detail}`,
    consecutiveConclusiveNegatives: streak,
    reachedThreshold,
  };
}
