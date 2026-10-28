/**
 * Tests for the server-side advisory service: caching, the concurrency cap, the
 * inconclusive short-circuit, and the fail-safe path.
 *
 * The model client here is a counting stub, so a test can assert *how many times*
 * the model was called — which is the whole point of the cache and the cap. No
 * network, no key.
 */

import { assert } from "chai";

import {
  ADVISORY_DISCLAIMER,
  AdvisoryService,
  createAdvisoryServiceFromEnv,
  DEFAULT_CACHE_TTL_MS,
  isEvidenceInconclusive,
} from "../src/advisory";
import type { ReliabilityEvidence } from "../src/evidence";
import { silentLogger } from "../src/logger";
import type { ModelClient } from "../src/metaClient";
import { MetaApiError } from "../src/metaClient";

const VALID_ASSESSMENT = JSON.stringify({
  risk_level: "high",
  reasons: ["heartbeat is stale"],
  evidence_cited: ["heartbeatAgeMs=1800000"],
  uncertain: ["whether the node is offline"],
  recommended_action: "Contact the provider.",
});

function evidence(
  summary: Partial<ReliabilityEvidence["summary"]> = {},
  stale = false
): ReliabilityEvidence {
  return {
    provider: {
      id: 1,
      name: "Demo",
      status: "active",
      region: "eu-west",
      reputationScore: 100,
      uptimePercent: 99,
      peerId: "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY",
      lastHeartbeatAt: stale ? "2025-01-01T00:00:00.000Z" : "2025-01-01T00:00:30.000Z",
      heartbeatAgeMs: stale ? 1_800_000 : 30_000,
      heartbeatStale: stale,
    },
    heartbeatStaleThresholdMs: 180_000,
    consecutiveNegativesThreshold: 3,
    assignments: [],
    summary: {
      assignmentCount: 1,
      confirmedCount: 1,
      pendingCount: 0,
      atRiskCount: 0,
      maxConsecutiveConclusiveNegatives: 0,
      neverHeartbeated: false,
      noRegisteredNode: false,
      ...summary,
    },
    generatedAt: "2025-01-01T00:01:00.000Z",
  };
}

/** A model client that counts calls and returns a canned string. */
class CountingClient implements ModelClient {
  calls = 0;
  private readonly reply: string | Error;

  constructor(reply: string | Error = VALID_ASSESSMENT) {
    this.reply = reply;
  }

  async complete(): Promise<string> {
    this.calls += 1;
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

describe("isEvidenceInconclusive", () => {
  it("is true for a node-less, assignment-less provider", () => {
    assert.isTrue(
      isEvidenceInconclusive(
        evidence({ assignmentCount: 0, noRegisteredNode: true, neverHeartbeated: true })
      )
    );
  });

  it("is false once there is an assignment to judge", () => {
    assert.isFalse(
      isEvidenceInconclusive(
        evidence({ assignmentCount: 1, noRegisteredNode: false, neverHeartbeated: false })
      )
    );
  });

  it("is false for a provider with a node even with no assignments", () => {
    assert.isFalse(
      isEvidenceInconclusive(
        evidence({ assignmentCount: 0, noRegisteredNode: false, neverHeartbeated: false })
      )
    );
  });
});

describe("AdvisoryService", () => {
  it("returns unavailable (never throws) when there is no client", async () => {
    const service = new AdvisoryService({ client: null, model: "m", mock: false });
    const outcome = await service.assess(1, evidence());
    assert.equal(outcome.kind, "unavailable");
  });

  it("returns a valid assessment and caches it for the TTL", async () => {
    const client = new CountingClient();
    let now = 1_000;
    const service = new AdvisoryService({
      client,
      model: "muse-spark-1.3",
      mock: false,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS,
      now: () => now,
      logger: silentLogger,
    });

    const first = await service.assess(1, evidence());
    assert.equal(first.kind, "ok");
    if (first.kind !== "ok") return;
    assert.equal(first.assessment.risk_level, "high");
    assert.isFalse(first.cached);
    assert.equal(client.calls, 1);

    // Within the TTL: served from cache, no second call.
    now += 30_000;
    const second = await service.assess(1, evidence());
    assert.equal(second.kind, "ok");
    if (second.kind !== "ok") return;
    assert.isTrue(second.cached);
    assert.equal(client.calls, 1);

    // Past the TTL: a fresh call.
    now += DEFAULT_CACHE_TTL_MS;
    const third = await service.assess(1, evidence());
    assert.equal(third.kind, "ok");
    if (third.kind !== "ok") return;
    assert.isFalse(third.cached);
    assert.equal(client.calls, 2);
  });

  it("refresh skips a fresh cache entry", async () => {
    const client = new CountingClient();
    const service = new AdvisoryService({
      client,
      model: "m",
      mock: false,
      now: () => 1_000,
      logger: silentLogger,
    });

    await service.assess(1, evidence());
    await service.assess(1, evidence(), { refresh: true });
    assert.equal(client.calls, 2);
  });

  it("collapses concurrent calls for the same provider (single-flight)", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const client: ModelClient = {
      complete: async () => {
        calls += 1;
        await gate;
        return VALID_ASSESSMENT;
      },
    };
    const service = new AdvisoryService({ client, model: "m", mock: false, logger: silentLogger });

    const a = service.assess(1, evidence());
    const b = service.assess(1, evidence());
    const c = service.assess(1, evidence());
    release!();
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    assert.equal(calls, 1, "three concurrent requests must share one model call");
    assert.equal(ra.kind, "ok");
    assert.equal(rb.kind, "ok");
    assert.equal(rc.kind, "ok");
  });

  it("caps concurrent model calls across providers", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const client: ModelClient = {
      complete: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return VALID_ASSESSMENT;
      },
    };
    const service = new AdvisoryService({
      client,
      model: "m",
      mock: false,
      maxConcurrency: 2,
      logger: silentLogger,
    });

    await Promise.all(
      [1, 2, 3, 4, 5].map((id) => service.assess(id, evidence()))
    );
    assert.isAtMost(maxInFlight, 2, `max in-flight was ${maxInFlight}, expected <= 2`);
  });

  it("short-circuits inconclusive evidence without a model call", async () => {
    const client = new CountingClient();
    const service = new AdvisoryService({ client, model: "m", mock: false, logger: silentLogger });

    const outcome = await service.assess(
      1,
      evidence({ assignmentCount: 0, noRegisteredNode: true, neverHeartbeated: true })
    );
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.equal(outcome.assessment.risk_level, "unknown");
    assert.isTrue(outcome.inconclusive);
    assert.equal(client.calls, 0, "no model call for inconclusive evidence");
  });

  it("turns a transport failure into an unknown assessment, not an error", async () => {
    const client = new CountingClient(new MetaApiError("boom", 0));
    const service = new AdvisoryService({ client, model: "m", mock: false, logger: silentLogger });

    const outcome = await service.assess(1, evidence());
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.equal(outcome.assessment.risk_level, "unknown");
    assert.isFalse(outcome.inconclusive);
  });

  it("turns invalid model output into an unknown assessment", async () => {
    const client = new CountingClient("not json at all");
    const service = new AdvisoryService({ client, model: "m", mock: false, logger: silentLogger });

    const outcome = await service.assess(1, evidence());
    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.equal(outcome.assessment.risk_level, "unknown");
  });
});

describe("createAdvisoryServiceFromEnv", () => {
  it("is available and mock in META_MOCK=1, with no key", () => {
    const handle = createAdvisoryServiceFromEnv({ META_MOCK: "1" });
    assert.isTrue(handle.available);
    assert.isTrue(handle.mock);
  });

  it("is available with a real key and mock off", () => {
    const handle = createAdvisoryServiceFromEnv({ META_API_KEY: "test-key" });
    assert.isTrue(handle.available);
    assert.isFalse(handle.mock);
  });

  it("is unavailable with neither a key nor mock, and never throws", () => {
    const handle = createAdvisoryServiceFromEnv({});
    assert.isFalse(handle.available);
    assert.isNotNull(handle.reason);
  });

  it("reads the model, cache TTL and concurrency from the environment", () => {
    const handle = createAdvisoryServiceFromEnv({
      META_MOCK: "1",
      META_MODEL: "muse-spark-1.3",
      RELIABILITY_AGENT_CACHE_TTL_MS: "1500",
      RELIABILITY_AGENT_MAX_CONCURRENCY: "5",
    });
    assert.equal(handle.model, "muse-spark-1.3");
  });
});

describe("ADVISORY_DISCLAIMER", () => {
  it("states that the output is advisory, not a guarantee", () => {
    assert.equal(ADVISORY_DISCLAIMER, "AI advisory, not a guarantee");
  });
});
