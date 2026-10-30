/**
 * The recommendation payload's privacy boundary.
 *
 * Rule 2 of the feature: the model may only ever see provider *status* data.
 * The wire payload is assembled in exactly one place — `buildRecommendationRequest`
 * — and its only user-role content is `JSON.stringify(payload)`. This suite
 * proves that, by building the payload from evidence deliberately stuffed with
 * values that must never leave: a peer id, a content id and a secret in the
 * verification detail (and a wallet address in the input, which the evidence
 * type does not even carry), then asserting none of them appears anywhere in the
 * bytes the model would receive.
 *
 * It is a real check, not a claim: if a future change added `provider.peerId` or
 * a wallet column to `CandidateFacts`, this test fails.
 */

import { assert } from "chai";

import type { ReliabilityEvidence } from "../src/evidence";
import { buildRecommendationRequest } from "../src/prompt";
import { rankCandidates, type RecommendationCandidateInput } from "../src/ranking";

// Values chosen to be recognisable if they leak.
const WALLET = "7xKq8m3vJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFk";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const SECRET = "sk-live-SUPERSECRET-abcdef123456";
const PINATA = "PINATA_JWT_eyJhbGciOi";

function evidence(): ReliabilityEvidence {
  return {
    provider: {
      id: 42,
      name: "Provider Alpha",
      status: "active",
      region: "eu-west",
      reputationScore: 88,
      uptimePercent: 99.5,
      peerId: PEER,
      lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
      heartbeatAgeMs: 30_000,
      heartbeatStale: false,
    },
    heartbeatStaleThresholdMs: 3 * 60_000,
    consecutiveNegativesThreshold: 3,
    assignments: [
      {
        assignmentId: 1,
        dealId: 2,
        dealStatus: "active",
        cid: CID,
        peerId: PEER,
        status: "confirmed",
        atRisk: false,
        consecutiveConclusiveNegatives: 0,
        verificationDetail: `verified with ${SECRET}`,
        lastVerifiedAt: "2025-01-01T00:00:00.000Z",
        lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
        heartbeatAgeMs: 30_000,
        heartbeatStale: false,
        createdAt: "2024-12-01T00:00:00.000Z",
        confirmedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    summary: {
      assignmentCount: 1,
      confirmedCount: 1,
      pendingCount: 0,
      atRiskCount: 0,
      maxConsecutiveConclusiveNegatives: 0,
      neverHeartbeated: false,
      noRegisteredNode: false,
    },
    generatedAt: "2025-01-01T00:01:00.000Z",
  };
}

function candidate(): RecommendationCandidateInput {
  return {
    evidence: evidence(),
    totalStorageGb: 1000,
    usedStorageGb: 200,
    pricePerGbPerEpoch: 0.001,
  };
}

/** Everything the model would receive: system prompt and user content. */
function wireText(): string {
  const ranked = rankCandidates([candidate()], {
    storageGb: 100,
    durationEpochs: 10,
    region: null,
  }).ranked;
  const payload = buildRecommendationRequest(
    { storageGb: 100, durationEpochs: 10, region: null },
    ranked,
    "muse-spark-1.3"
  );
  return payload.messages.map((m) => m.content).join("\n");
}

describe("recommendation model payload — privacy", () => {
  it("includes the provider status facts the model is meant to explain", () => {
    const text = wireText();
    assert.include(text, "Provider Alpha");
    assert.include(text, "eu-west");
    assert.include(text, "heartbeatAgeMs");
    assert.include(text, "sufficientEvidence");
  });

  it("never includes a wallet address, peer id, CID or secret", () => {
    const text = wireText();
    for (const value of [WALLET, PEER, CID, SECRET, PINATA]) {
      assert.notInclude(text, value, `payload leaked ${value.slice(0, 12)}…`);
    }
  });

  it("never includes a field that sounds like a credential or a wallet", () => {
    const text = wireText().toLowerCase();
    for (const forbidden of ["wallet", "api_key", "apikey", "secret", "authorization", "bearer", "pinata", "cid"]) {
      assert.notInclude(text, forbidden, `payload mentioned ${forbidden}`);
    }
  });

  it("carries exactly the allowed status fields per candidate", () => {
    const ranked = rankCandidates([candidate()], {
      storageGb: 100,
      durationEpochs: 10,
      region: null,
    }).ranked;
    const payload = buildRecommendationRequest(
      { storageGb: 100, durationEpochs: 10, region: null },
      ranked,
      "muse-spark-1.3"
    );
    const parsed = JSON.parse(payload.messages[1]!.content.slice(payload.messages[1]!.content.indexOf("{")));
    const entry = parsed.candidates[0];
    assert.deepEqual(Object.keys(entry).sort(), [
      "availableGb",
      "estimatedCostSol",
      "facts",
      "index",
      "name",
      "pricePerGbPerEpoch",
      "rank",
      "region",
      "reliabilityScore",
      "riskLevel",
      "score",
      "sufficientEvidence",
    ]);
    // The facts subset is the whitelist, not the whole evidence object.
    assert.deepEqual(Object.keys(entry.facts).sort(), [
      "assignmentCount",
      "atRiskCount",
      "confirmedCount",
      "heartbeatAgeMs",
      "heartbeatStale",
      "maxConsecutiveConclusiveNegatives",
      "neverHeartbeated",
      "noRegisteredNode",
      "pendingCount",
      "reputationScore",
      "uptimePercent",
    ]);
  });
});
