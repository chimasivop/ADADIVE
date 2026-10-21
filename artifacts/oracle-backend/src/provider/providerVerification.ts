/**
 * Provider-node verification decision.
 *
 * This is the pure rule the brief asks for, isolated from HTTP and the
 * database so it can be tested directly:
 *
 *   A deal assigned to a provider node is **at-risk** when
 *   (a) the provider's heartbeat is stale **and**
 *   (b) `findprovs` no longer shows the assigned peer id advertising the CID.
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
 *     busy DHT into false positives across the whole network.
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
}

export type VerificationVerdict =
  | { outcome: "verified"; atRisk: false; detail: string }
  | { outcome: "at_risk"; atRisk: true; detail: string }
  | { outcome: "unknown"; atRisk: null; detail: string };

export interface VerifyOptions {
  /** How old a heartbeat may be before the node is considered silent. */
  heartbeatStaleMs: number;
  /** Injectable clock, for tests that must not sleep. */
  now?: () => Date;
}

/**
 * Decide a single assignment's state.
 *
 * `findProvs` is the already-resolved DHT answer, or `null` when the query
 * could not be completed (transport error) — in which case the verdict is
 * `unknown` and the caller must not change the stored state.
 */
export function decideAssignment(
  assignment: AssignmentView,
  findProvs: FindProvsResult | null,
  options: VerifyOptions
): VerificationVerdict {
  const now = (options.now ?? (() => new Date()))();

  if (findProvs === null) {
    return {
      outcome: "unknown",
      atRisk: null,
      detail:
        `could not query the DHT for ${assignment.cid}; ` +
        `leaving the previous verification state unchanged`,
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

  // 2. Is the peer still advertising? An inconclusive answer is not evidence of
  //    absence, so it can never contribute to an at-risk verdict.
  const peerMissing = findProvs.conclusive && !findProvs.advertising;

  if (heartbeatStale && peerMissing) {
    return {
      outcome: "at_risk",
      atRisk: true,
      detail:
        `heartbeat is stale ` +
        (Number.isFinite(heartbeatAgeMs)
          ? `(${Math.round(heartbeatAgeMs / 1000)}s old) `
          : "(never reported) ") +
        `and ${findProvs.detail}`,
    };
  }

  if (heartbeatStale && !findProvs.conclusive) {
    return {
      outcome: "unknown",
      atRisk: null,
      detail:
        `heartbeat is stale but the DHT answer was inconclusive ` +
        `(${findProvs.detail}); not flagging on a partial answer`,
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
    };
  }

  // Fresh heartbeat: the node is alive. Whether it still advertises the content
  // is checked and reported, but a fresh heartbeat alone does not flag a deal —
  // it is the "both signals" rule.
  return {
    outcome: "verified",
    atRisk: false,
    detail: `heartbeat is fresh and ${findProvs.detail}`,
  };
}
