/**
 * Unit tests for the deterministic provider ranking.
 *
 * These are pure: no model, no network, no database. They pin the four
 * behaviours the feature's contract depends on:
 *
 *   1. the hard filters (capacity, region, price sanity, active status);
 *   2. "insufficient evidence is never ranked best";
 *   3. the tie-break order (score, then capacity, then cheaper, then id);
 *   4. determinism — same input, same order, every time.
 */

import { expect } from "chai";

import type { ReliabilityEvidence } from "../src/evidence";
import {
  availableCapacityGb,
  DEFAULT_REFERENCE_PRICE_PER_GB_PER_EPOCH,
  humanizeAge,
  passesHardFilters,
  rankCandidates,
  type RecommendationCandidateInput,
} from "../src/ranking";

const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const STALE_MS = 3 * 60_000;

interface EvidenceOverrides {
  id?: number;
  name?: string;
  status?: string;
  region?: string;
  reputationScore?: number | null;
  uptimePercent?: number | null;
  peerId?: string | null;
  heartbeatAgeMs?: number | null;
  heartbeatStale?: boolean;
  neverHeartbeated?: boolean;
  noRegisteredNode?: boolean;
  assignmentCount?: number;
  confirmedCount?: number;
  pendingCount?: number;
  atRiskCount?: number;
  maxConsecutiveConclusiveNegatives?: number;
}

/**
 * A minimal but well-formed evidence object.
 *
 * Defaults describe a healthy provider: a registered node, a fresh heartbeat and
 * one confirmed assignment. Overrides shape each case.
 */
function evidence(overrides: EvidenceOverrides = {}): ReliabilityEvidence {
  const heartbeatAgeMs = overrides.heartbeatAgeMs ?? 30_000;
  const stale = overrides.heartbeatStale ?? (heartbeatAgeMs === null || heartbeatAgeMs > STALE_MS);
  const noNode = overrides.noRegisteredNode ?? false;
  const assignmentCount = overrides.assignmentCount ?? 1;
  return {
    provider: {
      id: overrides.id ?? 1,
      name: overrides.name ?? `Provider ${overrides.id ?? 1}`,
      status: overrides.status ?? "active",
      region: overrides.region ?? "us-east",
      reputationScore: overrides.reputationScore === undefined ? 100 : overrides.reputationScore,
      uptimePercent: overrides.uptimePercent === undefined ? 99.9 : overrides.uptimePercent,
      peerId: overrides.peerId === undefined ? (noNode ? null : PEER) : overrides.peerId,
      lastHeartbeatAt: heartbeatAgeMs === null ? null : "2025-01-01T00:00:00.000Z",
      heartbeatAgeMs,
      heartbeatStale: stale,
    },
    heartbeatStaleThresholdMs: STALE_MS,
    consecutiveNegativesThreshold: 3,
    assignments: [],
    summary: {
      assignmentCount,
      confirmedCount: overrides.confirmedCount ?? (assignmentCount > 0 ? 1 : 0),
      pendingCount: overrides.pendingCount ?? 0,
      atRiskCount: overrides.atRiskCount ?? 0,
      maxConsecutiveConclusiveNegatives: overrides.maxConsecutiveConclusiveNegatives ?? 0,
      neverHeartbeated: overrides.neverHeartbeated ?? heartbeatAgeMs === null,
      noRegisteredNode: noNode,
    },
    generatedAt: "2025-01-01T00:01:00.000Z",
  };
}

function candidate(
  overrides: EvidenceOverrides & {
    totalStorageGb?: number;
    usedStorageGb?: number;
    pricePerGbPerEpoch?: number;
  } = {}
): RecommendationCandidateInput {
  return {
    evidence: evidence(overrides),
    totalStorageGb: overrides.totalStorageGb ?? 1000,
    usedStorageGb: overrides.usedStorageGb ?? 0,
    pricePerGbPerEpoch: overrides.pricePerGbPerEpoch ?? 0.001,
  };
}

const QUERY = { storageGb: 100, durationEpochs: 10, region: null };

describe("rankCandidates — hard filters", () => {
  it("drops a candidate with too little available capacity", () => {
    const result = rankCandidates(
      [
        candidate({ id: 1, totalStorageGb: 500, usedStorageGb: 0 }),
        candidate({ id: 2, totalStorageGb: 500, usedStorageGb: 450 }), // only 50 GB free
      ],
      { storageGb: 100, durationEpochs: 10, region: null }
    );
    expect(result.ranked.map((c) => c.providerId)).to.deep.equal([1]);
    expect(result.filteredOut).to.equal(1);
  });

  it("treats exactly-enough capacity as fitting (inclusive)", () => {
    const result = rankCandidates(
      [candidate({ id: 1, totalStorageGb: 500, usedStorageGb: 400 })],
      { storageGb: 100, durationEpochs: 10, region: null }
    );
    expect(result.ranked).to.have.length(1);
    expect(availableCapacityGb(candidate({ totalStorageGb: 500, usedStorageGb: 400 }))).to.equal(100);
  });

  it("filters by region when one is requested, case-insensitively", () => {
    const candidates = [
      candidate({ id: 1, region: "eu-west" }),
      candidate({ id: 2, region: "us-east" }),
    ];
    const eu = rankCandidates(candidates, { storageGb: 100, durationEpochs: 10, region: "EU-West" });
    expect(eu.ranked.map((c) => c.providerId)).to.deep.equal([1]);

    const any = rankCandidates(candidates, { storageGb: 100, durationEpochs: 10, region: null });
    expect(any.ranked.map((c) => c.providerId).sort()).to.deep.equal([1, 2]);
  });

  it("drops a candidate with a non-positive or non-finite price", () => {
    const result = rankCandidates(
      [candidate({ id: 1, pricePerGbPerEpoch: 0 }), candidate({ id: 2, pricePerGbPerEpoch: Number.NaN })],
      QUERY
    );
    expect(result.ranked).to.have.length(0);
    expect(result.filteredOut).to.equal(2);
  });

  it("drops a candidate that is not active", () => {
    const result = rankCandidates(
      [candidate({ id: 1, status: "inactive" }), candidate({ id: 2, status: "active" })],
      QUERY
    );
    expect(result.ranked.map((c) => c.providerId)).to.deep.equal([2]);
  });

  it("passesHardFilters agrees with the ranking's exclusions", () => {
    expect(passesHardFilters(candidate(), QUERY)).to.equal(true);
    expect(passesHardFilters(candidate({ status: "inactive" }), QUERY)).to.equal(false);
    expect(passesHardFilters(candidate({ region: "eu-west" }), { ...QUERY, region: "us-east" })).to.equal(
      false
    );
  });
});

describe("rankCandidates — insufficient evidence is never best", () => {
  it("ranks a provider with evidence above a higher-scoring one without", () => {
    // The unknown provider has perfect reputation/uptime and a much cheaper
    // price; the known one has a stale heartbeat and a low reputation. Evidence
    // still wins: the unknown is never the best choice.
    const unknown = candidate({
      id: 1,
      noRegisteredNode: true,
      peerId: null,
      heartbeatAgeMs: null,
      assignmentCount: 0,
      reputationScore: 100,
      uptimePercent: 100,
      pricePerGbPerEpoch: 0.0001,
    });
    const known = candidate({
      id: 2,
      heartbeatAgeMs: 30 * STALE_MS,
      reputationScore: 10,
      uptimePercent: 50,
      pricePerGbPerEpoch: 0.005,
    });

    const result = rankCandidates([unknown, known], QUERY);
    expect(result.ranked.map((c) => c.providerId)).to.deep.equal([2, 1]);
    expect(result.ranked[0]!.sufficientEvidence).to.equal(true);
    expect(result.ranked[1]!.sufficientEvidence).to.equal(false);
    expect(result.ranked[1]!.riskLevel).to.equal("unknown");
    expect(result.allInsufficientEvidence).to.equal(false);
  });

  it("flags allInsufficientEvidence when every candidate is unknown", () => {
    const result = rankCandidates(
      [
        candidate({ id: 1, noRegisteredNode: true, peerId: null, heartbeatAgeMs: null, assignmentCount: 0 }),
        candidate({ id: 2, noRegisteredNode: true, peerId: null, heartbeatAgeMs: null, assignmentCount: 0 }),
      ],
      QUERY
    );
    expect(result.allInsufficientEvidence).to.equal(true);
    expect(result.ranked.every((c) => c.riskLevel === "unknown")).to.equal(true);
  });

  it("treats a node-less, never-heartbeated provider as insufficient", () => {
    const result = rankCandidates(
      [
        candidate({
          id: 1,
          noRegisteredNode: true,
          peerId: null,
          heartbeatAgeMs: null,
          assignmentCount: 0,
        }),
      ],
      QUERY
    );
    expect(result.ranked[0]!.sufficientEvidence).to.equal(false);
  });

  it("treats a provider with a node but no assignments as having enough evidence", () => {
    // Liveness *is* evidence: a live node with a fresh heartbeat is judgeable.
    const result = rankCandidates([candidate({ id: 1, assignmentCount: 0 })], QUERY);
    expect(result.ranked[0]!.sufficientEvidence).to.equal(true);
  });
});

describe("rankCandidates — scoring and tie-breaking", () => {
  it("scores a healthy, cheap provider highest", () => {
    const result = rankCandidates(
      [
        candidate({ id: 1, heartbeatAgeMs: 10_000, pricePerGbPerEpoch: 0.0005 }),
        candidate({ id: 2, heartbeatAgeMs: 10_000, pricePerGbPerEpoch: 0.004 }),
      ],
      QUERY
    );
    expect(result.ranked[0]!.providerId).to.equal(1);
    expect(result.ranked[0]!.score).to.be.greaterThan(result.ranked[1]!.score);
  });

  it("breaks a score tie by more available capacity", () => {
    const result = rankCandidates(
      [
        candidate({ id: 1, totalStorageGb: 500 }),
        candidate({ id: 2, totalStorageGb: 900 }),
      ],
      QUERY
    );
    expect(result.ranked.map((c) => c.providerId)).to.deep.equal([2, 1]);
  });

  it("breaks a capacity tie by the cheaper price", () => {
    const result = rankCandidates(
      [
        candidate({ id: 1, pricePerGbPerEpoch: 0.002 }),
        candidate({ id: 2, pricePerGbPerEpoch: 0.001 }),
      ],
      QUERY
    );
    expect(result.ranked.map((c) => c.providerId)).to.deep.equal([2, 1]);
  });

  it("breaks a full tie by provider id, so the order is stable", () => {
    const result = rankCandidates(
      [candidate({ id: 7 }), candidate({ id: 3 }), candidate({ id: 5 })],
      QUERY
    );
    expect(result.ranked.map((c) => c.providerId)).to.deep.equal([3, 5, 7]);
  });

  it("caps the list at three by default and honours a custom limit", () => {
    const many = [1, 2, 3, 4, 5].map((id) => candidate({ id }));
    expect(rankCandidates(many, QUERY).ranked).to.have.length(3);
    expect(rankCandidates(many, QUERY, { limit: 2 }).ranked).to.have.length(2);
  });

  it("is deterministic: the same input produces the same order", () => {
    const candidates = [
      candidate({ id: 4, pricePerGbPerEpoch: 0.001 }),
      candidate({ id: 2, pricePerGbPerEpoch: 0.001 }),
      candidate({ id: 3, heartbeatAgeMs: 5 * STALE_MS }),
    ];
    const first = rankCandidates(candidates, QUERY).ranked.map((c) => c.providerId);
    const second = rankCandidates(candidates, QUERY).ranked.map((c) => c.providerId);
    expect(first).to.deep.equal(second);
  });

  it("counts considered and filtered-out candidates", () => {
    const result = rankCandidates(
      [
        candidate({ id: 1 }),
        candidate({ id: 2, status: "inactive" }),
        candidate({ id: 3, totalStorageGb: 10, usedStorageGb: 0 }),
      ],
      QUERY
    );
    expect(result.consideredCount).to.equal(3);
    expect(result.filteredOut).to.equal(2);
    expect(result.ranked).to.have.length(1);
  });
});

describe("rankCandidates — reasons and uncertainty", () => {
  it("explains a fresh heartbeat, clean verification and the price", () => {
    const result = rankCandidates([candidate({ id: 1, heartbeatAgeMs: 30_000 })], QUERY);
    const text = result.ranked[0]!.reasons.join(" ");
    expect(text).to.contain("fresh");
    expect(text).to.contain("at-risk");
    expect(text).to.contain("SOL/GB/epoch");
  });

  it("flags a stale heartbeat and an at-risk assignment", () => {
    const result = rankCandidates(
      [candidate({ id: 1, heartbeatAgeMs: 30 * STALE_MS, atRiskCount: 2 })],
      QUERY
    );
    const text = result.ranked[0]!.reasons.join(" ");
    expect(text).to.contain("stale");
    expect(text).to.contain("at-risk");
    expect(result.ranked[0]!.riskLevel).to.equal("high");
  });

  it("never claims a heartbeat history (rule 6)", () => {
    const result = rankCandidates([candidate({ id: 1 })], QUERY);
    const uncertain = result.ranked[0]!.uncertain.join(" ");
    expect(uncertain).to.contain("latest heartbeat");
    expect(uncertain).to.match(/past outage would not be visible/i);
  });

  it("says 'not enough evidence' in the uncertainty list for an unknown candidate", () => {
    const result = rankCandidates(
      [candidate({ id: 1, noRegisteredNode: true, peerId: null, heartbeatAgeMs: null, assignmentCount: 0 })],
      QUERY
    );
    expect(result.ranked[0]!.uncertain.join(" ")).to.match(/not enough evidence/i);
  });

  it("estimates the deal cost from size × duration × price", () => {
    const result = rankCandidates(
      [candidate({ id: 1, pricePerGbPerEpoch: 0.002 })],
      { storageGb: 100, durationEpochs: 10, region: null }
    );
    expect(result.ranked[0]!.estimatedCostSol).to.be.closeTo(2, 1e-9);
  });
});

describe("humanizeAge", () => {
  it("formats seconds, minutes and hours", () => {
    expect(humanizeAge(30_000)).to.equal("30s");
    expect(humanizeAge(12 * 60_000)).to.equal("12m");
    expect(humanizeAge(3 * 60 * 60_000)).to.equal("3h");
    expect(humanizeAge(null)).to.equal("an unknown time");
  });
});

describe("DEFAULT_REFERENCE_PRICE_PER_GB_PER_EPOCH", () => {
  it("is a positive number so price fit is well defined", () => {
    expect(DEFAULT_REFERENCE_PRICE_PER_GB_PER_EPOCH).to.be.greaterThan(0);
  });
});
