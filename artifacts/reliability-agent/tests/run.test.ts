/**
 * `runOnce` tests: the cycle fetches evidence (or takes it) and never writes.
 *
 * The evidence client is a fake here, and the model client is injected, so no
 * network is touched. The point is that `runOnce` picks the right clients from
 * config and passes the evidence straight through to the advisor.
 */

import { assert } from "chai";

import { runOnce } from "../src/run";
import { loadConfig } from "../src/config";
import { FixtureMetaClient } from "../src/mockClient";
import { silentLogger } from "../src/logger";
import type { ReliabilityEvidence } from "../src/evidence";
import type { ModelClient } from "../src/metaClient";

const EVIDENCE: ReliabilityEvidence = {
  provider: {
    id: 5,
    name: "Demo Flaky One",
    status: "active",
    region: "eu-central",
    reputationScore: 62,
    uptimePercent: 87.2,
    peerId: "12D3KooW9yC5fg3vzipwvPps1VAzoUgS2MQ2BHZc6Bbi5TatRAZBHhJj3kLm",
    lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
    heartbeatAgeMs: 1_800_000,
    heartbeatStale: true,
  },
  heartbeatStaleThresholdMs: 180_000,
  consecutiveNegativesThreshold: 3,
  assignments: [],
  summary: {
    assignmentCount: 1,
    confirmedCount: 0,
    pendingCount: 1,
    atRiskCount: 1,
    maxConsecutiveConclusiveNegatives: 3,
    neverHeartbeated: false,
    noRegisteredNode: false,
  },
  generatedAt: "2025-01-01T00:01:00.000Z",
};

describe("runOnce", () => {
  it("fetches evidence and assesses it", async () => {
    let fetchedId = -1;
    const result = await runOnce(
      {
        config: loadConfig({ META_MOCK: "1" }),
        logger: silentLogger,
        client: new FixtureMetaClient({ logger: silentLogger }),
        evidenceClient: {
          fetch: async (id: number) => {
            fetchedId = id;
            return EVIDENCE;
          },
        },
      },
      5
    );
    assert.equal(fetchedId, 5);
    assert.equal(result.assessment.risk_level, "high");
  });

  it("skips the fetch when evidence is supplied directly", async () => {
    let called = false;
    const result = await runOnce(
      {
        config: loadConfig({ META_MOCK: "1" }),
        logger: silentLogger,
        client: new FixtureMetaClient({ logger: silentLogger }),
        evidenceClient: {
          fetch: async () => {
            called = true;
            return EVIDENCE;
          },
        },
      },
      5,
      EVIDENCE
    );
    assert.isFalse(called);
    assert.equal(result.assessment.risk_level, "high");
  });

  it("propagates an evidence-fetch failure (operational, not an assessment)", async () => {
    let threw: unknown = null;
    try {
      await runOnce(
        {
          config: loadConfig({ META_MOCK: "1" }),
          logger: silentLogger,
          client: new FixtureMetaClient({ logger: silentLogger }),
          evidenceClient: {
            fetch: async () => {
              throw new Error("api-server down");
            },
          },
        },
        5
      );
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, Error);
    assert.match((threw as Error).message, /api-server down/);
  });

  it("does not throw when the model client fails; returns unknown", async () => {
    const failing: ModelClient = {
      complete: async () => {
        throw new Error("boom");
      },
    };
    const result = await runOnce(
      {
        config: loadConfig({ META_MOCK: "1" }),
        logger: silentLogger,
        client: failing,
        evidenceClient: { fetch: async () => EVIDENCE },
      },
      5
    );
    assert.equal(result.assessment.risk_level, "unknown");
  });
});
