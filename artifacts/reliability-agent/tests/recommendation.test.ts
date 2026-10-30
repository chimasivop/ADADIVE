/**
 * Tests for the server-side recommendation service: caching, single-flight, the
 * model-failure fail-safe, the "the model cannot rank" guarantee, and mock mode.
 *
 * The model client here is a counting stub, so a test can assert *how many times*
 * the model was called — the whole point of the cache — and can hand back
 * whatever output it likes to prove the deterministic ranking survives it. No
 * network, no key.
 */

import { assert } from "chai";

import type { ReliabilityEvidence } from "../src/evidence";
import { silentLogger } from "../src/logger";
import type { ModelClient } from "../src/metaClient";
import { MetaApiError } from "../src/metaClient";
import {
  createRecommendationServiceFromEnv,
  deterministicRecommendation,
  RecommendationService,
  recommendationCacheKey,
} from "../src/recommendation";
import type { RecommendationCandidateInput } from "../src/ranking";

const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const STALE_MS = 3 * 60_000;

const VALID_EXPLANATION = JSON.stringify({
  candidates: [
    { index: 0, reasons: ["the model's reason for the top candidate"], uncertain: ["the model's caveat"] },
    { index: 1, reasons: ["the model's reason for the second"], uncertain: [] },
  ],
});

interface EvidenceOverrides {
  id?: number;
  heartbeatAgeMs?: number | null;
  noRegisteredNode?: boolean;
  assignmentCount?: number;
  reputationScore?: number | null;
  uptimePercent?: number | null;
}

function evidence(overrides: EvidenceOverrides = {}): ReliabilityEvidence {
  const heartbeatAgeMs = overrides.heartbeatAgeMs === undefined ? 30_000 : overrides.heartbeatAgeMs;
  const noNode = overrides.noRegisteredNode ?? false;
  const assignmentCount = overrides.assignmentCount ?? 1;
  const stale = heartbeatAgeMs === null || heartbeatAgeMs > STALE_MS;
  return {
    provider: {
      id: overrides.id ?? 1,
      name: `Provider ${overrides.id ?? 1}`,
      status: "active",
      region: "us-east",
      reputationScore: overrides.reputationScore === undefined ? 100 : overrides.reputationScore,
      uptimePercent: overrides.uptimePercent === undefined ? 99.9 : overrides.uptimePercent,
      peerId: noNode ? null : PEER,
      lastHeartbeatAt: heartbeatAgeMs === null ? null : "2025-01-01T00:00:00.000Z",
      heartbeatAgeMs,
      heartbeatStale: stale,
    },
    heartbeatStaleThresholdMs: STALE_MS,
    consecutiveNegativesThreshold: 3,
    assignments: [],
    summary: {
      assignmentCount,
      confirmedCount: assignmentCount > 0 ? 1 : 0,
      pendingCount: 0,
      atRiskCount: 0,
      maxConsecutiveConclusiveNegatives: 0,
      neverHeartbeated: heartbeatAgeMs === null,
      noRegisteredNode: noNode,
    },
    generatedAt: "2025-01-01T00:01:00.000Z",
  };
}

function candidate(
  overrides: EvidenceOverrides & { pricePerGbPerEpoch?: number; totalStorageGb?: number } = {}
): RecommendationCandidateInput {
  return {
    evidence: evidence(overrides),
    totalStorageGb: overrides.totalStorageGb ?? 1000,
    usedStorageGb: 0,
    pricePerGbPerEpoch: overrides.pricePerGbPerEpoch ?? 0.001,
  };
}

const QUERY = { storageGb: 100, durationEpochs: 10, region: null };

/** A model client that counts calls and returns a canned string (or throws). */
class CountingClient implements ModelClient {
  calls = 0;
  readonly payloads: unknown[] = [];
  private readonly reply: string | Error;

  constructor(reply: string | Error = VALID_EXPLANATION) {
    this.reply = reply;
  }

  async complete(payload: unknown): Promise<string> {
    this.calls += 1;
    this.payloads.push(payload);
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

function service(client: ModelClient | null, overrides: Partial<{ now: () => number; ttl: number }> = {}) {
  return new RecommendationService({
    client,
    model: "muse-spark-1.3",
    mock: false,
    cacheTtlMs: overrides.ttl ?? 60_000,
    now: overrides.now,
    logger: silentLogger,
  });
}

describe("RecommendationService — the model explains but does not rank", () => {
  it("returns the deterministic order and only the prose comes from the model", async () => {
    const client = new CountingClient();
    const svc = service(client);
    const candidates = [
      candidate({ id: 2, pricePerGbPerEpoch: 0.004 }),
      candidate({ id: 1, pricePerGbPerEpoch: 0.001 }),
    ];

    const outcome = await svc.recommend(candidates, QUERY);
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;

    // The ranker's order (cheapest first), not the model's or the input's.
    assert.deepEqual(outcome.candidates.map((c) => c.providerId), [1, 2]);
    assert.equal(outcome.explanationSource, "ai");
    assert.equal(outcome.candidates[0]!.reasons[0], "the model's reason for the top candidate");
    assert.equal(client.calls, 1);
  });

  it("drops prose for an index that was not sent, keeping the deterministic reasons", async () => {
    const client = new CountingClient(
      JSON.stringify({
        candidates: [
          { index: 0, reasons: ["ok"], uncertain: [] },
          { index: 99, reasons: ["for a candidate that does not exist"], uncertain: [] },
        ],
      })
    );
    const svc = service(client);
    const outcome = await svc.recommend([candidate({ id: 1 }), candidate({ id: 2 })], QUERY);
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.lengthOf(outcome.candidates, 2);
    // Index 99 was ignored, so index 1 keeps its deterministic reasons.
    assert.notInclude(outcome.candidates[1]!.reasons.join(" "), "does not exist");
    assert.include(outcome.candidates[1]!.reasons.join(" "), "SOL/GB/epoch");
  });

  it("cannot be reordered even if the model names a different winner", async () => {
    // The model has no field to express an order; whatever it returns for index 0
    // is attached to the candidate the ranker placed first.
    const client = new CountingClient(
      JSON.stringify({
        candidates: [
          { index: 0, reasons: ["actually the second provider is better"], uncertain: [] },
          { index: 1, reasons: ["this is the best"], uncertain: [] },
        ],
      })
    );
    const svc = service(client);
    const candidates = [
      candidate({ id: 1, pricePerGbPerEpoch: 0.001 }),
      candidate({ id: 2, pricePerGbPerEpoch: 0.004 }),
    ];
    const outcome = await svc.recommend(candidates, QUERY);
    if (outcome.kind !== "ok") return assert.fail("expected ok");
    assert.deepEqual(outcome.candidates.map((c) => c.providerId), [1, 2]);
  });
});

describe("RecommendationService — fail-safe", () => {
  it("falls back to the deterministic ranking when the model throws", async () => {
    const client = new CountingClient(new MetaApiError("boom", 500));
    const outcome = await service(client).recommend([candidate({ id: 1 })], QUERY);
    if (outcome.kind !== "ok") return assert.fail("expected ok");
    assert.equal(outcome.explanationSource, "deterministic");
    assert.isNotNull(outcome.aiUnavailableReason);
    assert.include(outcome.candidates[0]!.reasons.join(" "), "SOL/GB/epoch");
  });

  it("falls back when the model returns non-JSON", async () => {
    const outcome = await service(new CountingClient("not json")).recommend(
      [candidate({ id: 1 })],
      QUERY
    );
    if (outcome.kind !== "ok") return assert.fail("expected ok");
    assert.equal(outcome.explanationSource, "deterministic");
  });

  it("falls back when the model output fails the schema", async () => {
    const outcome = await service(
      new CountingClient(JSON.stringify({ candidates: [{ index: "zero", reasons: "nope" }] }))
    ).recommend([candidate({ id: 1 })], QUERY);
    if (outcome.kind !== "ok") return assert.fail("expected ok");
    assert.equal(outcome.explanationSource, "deterministic");
  });

  it("reports unavailable (never throws) when no client is configured", async () => {
    const outcome = await service(null).recommend([candidate({ id: 1 })], QUERY);
    assert.equal(outcome.kind, "unavailable");
  });

  it("skips the model entirely when no candidate survives the filters", async () => {
    const client = new CountingClient();
    const outcome = await service(client).recommend(
      [candidate({ id: 1, totalStorageGb: 10 })],
      { storageGb: 500, durationEpochs: 10, region: null }
    );
    if (outcome.kind !== "ok") return assert.fail("expected ok");
    assert.lengthOf(outcome.candidates, 0);
    assert.equal(client.calls, 0, "no candidate means no model call");
  });
});

describe("RecommendationService — cache and single-flight", () => {
  it("serves a second identical query from the cache without a model call", async () => {
    let now = 0;
    const client = new CountingClient();
    const svc = service(client, { now: () => now });
    const candidates = [candidate({ id: 1 })];

    const first = await svc.recommend(candidates, QUERY);
    assert.equal(first.kind, "ok");
    if (first.kind === "ok") assert.equal(first.cached, false);

    const second = await svc.recommend(candidates, QUERY);
    if (second.kind !== "ok") return assert.fail("expected ok");
    assert.equal(second.cached, true);
    assert.equal(client.calls, 1, "the second query must not spend a model call");

    // After the TTL the cache entry is stale and the model is called again.
    now = 61_000;
    await svc.recommend(candidates, QUERY);
    assert.equal(client.calls, 2);
  });

  it("collapses concurrent identical queries into one model call", async () => {
    let resolveReply: (value: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      resolveReply = resolve;
    });
    const client: ModelClient = {
      complete: () => {
        client_calls += 1;
        return gate;
      },
    };
    let client_calls = 0;
    const svc = service(client);
    const candidates = [candidate({ id: 1 })];

    const a = svc.recommend(candidates, QUERY);
    const b = svc.recommend(candidates, QUERY);
    resolveReply(VALID_EXPLANATION);
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(client_calls, 1);
    assert.equal(ra.kind, "ok");
    assert.equal(rb.kind, "ok");
  });

  it("keys the cache on the query, so a different size is a different entry", () => {
    assert.notEqual(
      recommendationCacheKey({ storageGb: 100, durationEpochs: 10, region: null }),
      recommendationCacheKey({ storageGb: 200, durationEpochs: 10, region: null })
    );
    assert.equal(
      recommendationCacheKey({ storageGb: 100, durationEpochs: 10, region: "EU-west" }),
      recommendationCacheKey({ storageGb: 100, durationEpochs: 10, region: "eu-west" })
    );
  });

  it("peek returns a fresh cached result and never calls the model", async () => {
    let now = 0;
    const client = new CountingClient();
    const svc = service(client, { now: () => now });
    const candidates = [candidate({ id: 1 })];
    assert.isNull(svc.peek(QUERY));
    await svc.recommend(candidates, QUERY);
    assert.isNotNull(svc.peek(QUERY));
    assert.equal(client.calls, 1);
    now = 61_000;
    assert.isNull(svc.peek(QUERY));
  });
});

describe("deterministicRecommendation", () => {
  it("produces the deterministic result with no model and no client", () => {
    const result = deterministicRecommendation([candidate({ id: 1 })], QUERY, { reason: "no key" });
    assert.equal(result.explanationSource, "deterministic");
    assert.equal(result.aiUnavailableReason, "no key");
    assert.equal(result.bestProviderId, 1);
    assert.equal(result.model, null);
  });
});

describe("createRecommendationServiceFromEnv", () => {
  it("is available and mock in META_MOCK mode, with no key", () => {
    const handle = createRecommendationServiceFromEnv({ META_MOCK: "1" });
    assert.isTrue(handle.available);
    assert.isTrue(handle.mock);
    assert.isNull(handle.reason);
  });

  it("is unavailable with no key and no mock, but does not throw", () => {
    const handle = createRecommendationServiceFromEnv({});
    assert.isFalse(handle.available);
    assert.isFalse(handle.mock);
    assert.isNotNull(handle.reason);
  });

  it("is available when a key is set", () => {
    const handle = createRecommendationServiceFromEnv({ META_API_KEY: "test-key" });
    assert.isTrue(handle.available);
    assert.isFalse(handle.mock);
  });

  it("in mock mode replays the recommendation fixture through the real path", async () => {
    const handle = createRecommendationServiceFromEnv({ META_MOCK: "1" });
    const outcome = await handle.service.recommend(
      [candidate({ id: 1 }), candidate({ id: 2 })],
      QUERY
    );
    if (outcome.kind !== "ok") return assert.fail("expected ok");
    assert.equal(outcome.explanationSource, "ai");
    assert.isTrue(outcome.mock);
    assert.include(outcome.candidates[0]!.reasons.join(" "), "heartbeat");
  });
});
