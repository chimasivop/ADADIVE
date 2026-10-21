/**
 * `decideAssignment` — the at-risk rule, in isolation.
 *
 * This is the core of the oracle upgrade: at-risk is "heartbeat stale AND the
 * peer is no longer advertising the CID", both halves together. The tests pin
 * down each single-signal case, because the tempting bug is to flag on either
 * one alone ("stale heartbeat" or "peer not seen"), and an inconclusive DHT
 * answer or a transport failure must never flag a deal.
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

function decide(a: AssignmentView, f: FindProvsResult | null) {
  return decideAssignment(a, f, { heartbeatStaleMs: STALE_MS, now: () => NOW });
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
