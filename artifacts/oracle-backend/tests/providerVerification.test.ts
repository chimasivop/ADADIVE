/**
 * `decideAssignment` — the at-risk rule, in isolation.
 *
 * This is the core of the oracle upgrade: at-risk is "heartbeat stale AND the
 * peer has conclusively failed to advertise the CID on enough sweeps in a row",
 * both halves together. The tests pin down each single-signal case, because the
 * tempting bug is to flag on either one alone ("stale heartbeat" or "peer not
 * seen"), and an inconclusive DHT answer or a transport failure must never flag
 * a deal.
 *
 * The threshold is `consecutiveNegatives`. Most of the combination tests below
 * set it to 1 (flag on the first conclusive negative) so they isolate the
 * stale-AND-missing rule; the streak suite then covers the default of 3, where a
 * single negative is deliberately *not* enough.
 *
 * Pure function: no clock, no HTTP, no database. `now` is injected.
 */

import { expect } from "chai";

import { decideAssignment, type AssignmentView } from "../src/provider/providerVerification";
import type { FindProvsResult } from "../src/ipfs/findprovs";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const NOW = new Date("2024-06-01T12:00:00.000Z");

const STALE_MS = 3 * 60_000;

function assignment(overrides: Partial<AssignmentView> = {}): AssignmentView {
  return {
    assignmentId: 1,
    dealId: 7,
    cid: CID,
    dealStatus: "active",
    providerId: 3,
    peerId: PEER,
    status: "confirmed",
    lastHeartbeatAt: NOW.toISOString(),
    consecutiveConclusiveNegatives: 0,
    ...overrides,
  };
}

/** A conclusive findprovs answer. */
function answer(advertising: boolean, providerCount = 4): FindProvsResult {
  return {
    advertising,
    providerCount,
    conclusive: true,
    detail: advertising ? `${PEER} is advertising ${CID}` : `${PEER} is not advertising ${CID}`,
  };
}

const inconclusive: FindProvsResult = {
  advertising: false,
  providerCount: 20,
  conclusive: false,
  detail: "the DHT returned 20 providers (the search limit); inconclusive",
};

/** Threshold 1 by default here: these tests isolate the stale-AND-missing rule. */
function decide(a: AssignmentView, f: FindProvsResult | null, consecutiveNegatives = 1) {
  return decideAssignment(a, f, {
    heartbeatStaleMs: STALE_MS,
    consecutiveNegatives,
    now: () => NOW,
  });
}

describe("decideAssignment", () => {
  it("flags at-risk when the heartbeat is stale AND the peer is not advertising", async () => {
    const stale = new Date(NOW.getTime() - STALE_MS - 60_000).toISOString();
    const verdict = decide(assignment({ lastHeartbeatAt: stale }), answer(false));

    expect(verdict.outcome).to.equal("at_risk");
    expect(verdict.atRisk).to.equal(true);
    expect(verdict.detail).to.contain("stale");
  });

  it("treats a node that never heartbeated as stale", async () => {
    const verdict = decide(assignment({ lastHeartbeatAt: null }), answer(false));

    expect(verdict.outcome).to.equal("at_risk");
    expect(verdict.detail).to.contain("never reported");
  });

  it("does NOT flag when the heartbeat is stale but the peer is still advertising", async () => {
    // One signal alone is a warning, not a verdict: the heartbeat endpoint may
    // be briefly down while the node serves content perfectly well.
    const stale = new Date(NOW.getTime() - STALE_MS - 60_000).toISOString();
    const verdict = decide(assignment({ lastHeartbeatAt: stale }), answer(true));

    expect(verdict.outcome).to.equal("verified");
    expect(verdict.atRisk).to.equal(false);
  });

  it("does NOT flag when the peer is not advertising but the heartbeat is fresh", async () => {
    // The complementary single signal: the node is alive, so a momentary
    // absence from the DHT (propagation lag, reshuffle) is not a verdict.
    const verdict = decide(assignment(), answer(false));

    expect(verdict.outcome).to.equal("verified");
    expect(verdict.atRisk).to.equal(false);
  });

  it("does NOT flag on an inconclusive DHT answer, even with a stale heartbeat", async () => {
    // Absence from a truncated provider list is not evidence of absence.
    const stale = new Date(NOW.getTime() - STALE_MS - 60_000).toISOString();
    const verdict = decide(assignment({ lastHeartbeatAt: stale }), inconclusive);

    expect(verdict.outcome).to.equal("unknown");
    expect(verdict.atRisk).to.equal(null);
    expect(verdict.detail).to.contain("inconclusive");
  });

  it("reports unknown (not at-risk) when the DHT could not be queried", async () => {
    // A transport failure must leave the stored state alone rather than blank a
    // previous good verdict on a Kubo blip.
    const verdict = decide(assignment({ lastHeartbeatAt: null }), null);

    expect(verdict.outcome).to.equal("unknown");
    expect(verdict.atRisk).to.equal(null);
  });

  it("is verified when the heartbeat is fresh and the peer is advertising", async () => {
    const verdict = decide(assignment(), answer(true));

    expect(verdict.outcome).to.equal("verified");
    expect(verdict.atRisk).to.equal(false);
  });

  it("treats a just-inside-the-window heartbeat as fresh", async () => {
    // Boundary: exactly at the threshold is not yet stale.
    const atThreshold = new Date(NOW.getTime() - STALE_MS).toISOString();
    const verdict = decide(assignment({ lastHeartbeatAt: atThreshold }), answer(false));

    expect(verdict.outcome).to.equal("verified");
  });
});

/**
 * The consecutive-negative streak — the mitigation for "a cleanly-ended-but-early
 * findprovs stream is indistinguishable from a completed search".
 *
 * The point of these tests: a *single* conclusive negative must never flag a deal
 * on its own, only a sustained run of them. The streak is carried on the
 * assignment (injected here as `consecutiveConclusiveNegatives`) and returned by
 * `decideAssignment` so the caller can persist it.
 */
describe("decideAssignment — consecutive-negative streak", () => {
  const stale = new Date(NOW.getTime() - STALE_MS - 60_000).toISOString();

  it("does NOT flag on a single conclusive negative at the default threshold of 3", () => {
    // The exact case the review raised: one truncated-but-apparently-conclusive
    // negative is not enough.
    const verdict = decide(assignment({ lastHeartbeatAt: stale }), answer(false), 3);

    expect(verdict.outcome).to.equal("unknown");
    expect(verdict.atRisk).to.equal(null);
    expect(verdict.consecutiveConclusiveNegatives).to.equal(1);
    expect(verdict.reachedThreshold).to.equal(false);
    expect(verdict.detail).to.contain("1 of 3");
  });

  it("does NOT flag on the second of three, and advances the streak", () => {
    const verdict = decide(
      assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 1 }),
      answer(false),
      3
    );

    expect(verdict.outcome).to.equal("unknown");
    expect(verdict.consecutiveConclusiveNegatives).to.equal(2);
    expect(verdict.reachedThreshold).to.equal(false);
  });

  it("flags at-risk on the third consecutive conclusive negative", () => {
    const verdict = decide(
      assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 }),
      answer(false),
      3
    );

    expect(verdict.outcome).to.equal("at_risk");
    expect(verdict.atRisk).to.equal(true);
    expect(verdict.consecutiveConclusiveNegatives).to.equal(3);
    expect(verdict.reachedThreshold).to.equal(true);
  });

  it("keeps flagging on the fourth and beyond", () => {
    const verdict = decide(
      assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 3 }),
      answer(false),
      3
    );

    expect(verdict.outcome).to.equal("at_risk");
    expect(verdict.consecutiveConclusiveNegatives).to.equal(4);
  });

  it("resets the streak to zero when the peer is advertising again", () => {
    // A conclusive positive is proof the earlier negatives were spurious, so the
    // counter must not carry over into the next incident.
    const verdict = decide(
      assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 }),
      answer(true),
      3
    );

    expect(verdict.outcome).to.equal("verified");
    expect(verdict.consecutiveConclusiveNegatives).to.equal(0);
  });

  it("leaves the streak untouched on an inconclusive answer", () => {
    // Inconclusive is not evidence in either direction: it must neither advance
    // the streak (which would let a flaky DHT manufacture a verdict) nor reset it
    // (which would let a flaky DHT hide a real disappearance).
    const verdict = decide(
      assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 }),
      inconclusive,
      3
    );

    expect(verdict.outcome).to.equal("unknown");
    expect(verdict.consecutiveConclusiveNegatives).to.equal(2);
  });

  it("leaves the streak untouched on a transport failure", () => {
    const verdict = decide(
      assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 }),
      null,
      3
    );

    expect(verdict.outcome).to.equal("unknown");
    expect(verdict.consecutiveConclusiveNegatives).to.equal(2);
  });

  it("advances the streak even when the heartbeat is fresh, but does not flag", () => {
    // The streak counts the *DHT* signal, independent of liveness: a fresh
    // heartbeat does not change the fact that the DHT conclusively says the peer
    // is not advertising. So the counter advances, but the verdict is `verified`
    // because the both-signals rule needs the heartbeat stale too. The payoff is
    // that a node which has been missing from the DHT for the threshold sweeps is
    // flagged on the first sweep *after* its heartbeat goes stale, rather than
    // needing the threshold to elapse a second time.
    const verdict = decide(assignment({ consecutiveConclusiveNegatives: 2 }), answer(false), 3);

    expect(verdict.outcome).to.equal("verified");
    expect(verdict.atRisk).to.equal(false);
    expect(verdict.consecutiveConclusiveNegatives).to.equal(3);
    expect(verdict.reachedThreshold).to.equal(true);
  });

  it("flags on the first negative when configured with threshold 1", () => {
    // The escape hatch: an operator who trusts their Kubo setup can restore the
    // old behaviour without a code change.
    const verdict = decide(assignment({ lastHeartbeatAt: stale }), answer(false), 1);

    expect(verdict.outcome).to.equal("at_risk");
    expect(verdict.consecutiveConclusiveNegatives).to.equal(1);
  });

  it("clamps a non-positive threshold to 1 rather than never flagging", () => {
    // A misconfigured 0 must not disable the at-risk path entirely.
    const verdict = decide(assignment({ lastHeartbeatAt: stale }), answer(false), 0);

    expect(verdict.outcome).to.equal("at_risk");
  });
});
