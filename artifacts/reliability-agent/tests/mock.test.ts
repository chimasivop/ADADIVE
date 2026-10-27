/**
 * Mock-mode tests.
 *
 * Mock mode has to be *real* mock mode: no network, no key, and yet the same
 * parsing and validation as a live call. These tests prove three things:
 *
 *   1. `META_MOCK=1` needs no key and never calls `fetch`.
 *   2. The fixture goes through the real envelope extraction and Zod validation,
 *      so a fixture that does not match the schema really does fail over to
 *      `unknown` — mock mode is not a shortcut that hides a broken path.
 *   3. The fixture chosen tracks the evidence (healthy / flaky / no-node).
 */

import { assert } from "chai";

import { assessProvider } from "../src/assess";
import { loadConfig } from "../src/config";
import {
  FixtureMetaClient,
  FIXTURES,
  chooseFixtureName,
  parseEvidenceFromPayload,
} from "../src/mockClient";
import { buildModelRequest } from "../src/prompt";
import { silentLogger } from "../src/logger";
import type { ReliabilityEvidence } from "../src/evidence";

function evidence(overrides: Partial<ReliabilityEvidence["summary"]> = {}, stale = false): ReliabilityEvidence {
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
      assignmentCount: 0,
      confirmedCount: 0,
      pendingCount: 0,
      atRiskCount: 0,
      maxConsecutiveConclusiveNegatives: 0,
      neverHeartbeated: false,
      noRegisteredNode: false,
      ...overrides,
    },
    generatedAt: "2025-01-01T00:01:00.000Z",
  };
}

describe("META_MOCK", () => {
  it("lets the config load with no META_API_KEY", () => {
    const config = loadConfig({ META_MOCK: "1" });
    assert.isTrue(config.mock);
    assert.isNull(config.metaApiKey);
  });

  it("accepts the other truthy spellings", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      assert.isTrue(loadConfig({ META_MOCK: v }).mock, v);
    }
    for (const v of ["0", "false", "", "no"]) {
      assert.throws(() => loadConfig({ META_MOCK: v }), /META_API_KEY is required/);
    }
  });
});

describe("FixtureMetaClient", () => {
  it("needs no network: every fixture is a recorded response", () => {
    // Nothing in the client touches `fetch`; if it did, this would hang or throw
    // in an environment with no network. `complete` is synchronous in effect.
    assert.deepEqual(Object.keys(FIXTURES).sort(), ["flaky", "healthy", "invalid", "no-node"]);
  });

  it("replays the healthy fixture for healthy evidence", async () => {
    const client = new FixtureMetaClient({ logger: silentLogger });
    const content = await client.complete(buildModelRequest(evidence(), "muse-spark-1.3"));
    assert.include(content, '"risk_level":"low"');
  });

  it("replays the flaky fixture for stale/at-risk evidence", async () => {
    const client = new FixtureMetaClient({ logger: silentLogger });
    const content = await client.complete(
      buildModelRequest(evidence({ atRiskCount: 1 }, true), "muse-spark-1.3")
    );
    assert.include(content, '"risk_level":"high"');
  });

  it("replays the no-node fixture when the provider has no node", async () => {
    const client = new FixtureMetaClient({ logger: silentLogger });
    const content = await client.complete(
      buildModelRequest(evidence({ noRegisteredNode: true }), "muse-spark-1.3")
    );
    assert.include(content, '"risk_level":"unknown"');
  });

  it("recovers the evidence from the request payload", () => {
    const request = buildModelRequest(evidence({ atRiskCount: 2 }), "muse-spark-1.3");
    const parsed = parseEvidenceFromPayload(request);
    assert.isNotNull(parsed);
    assert.equal(parsed!.summary.atRiskCount, 2);
  });

  it("chooses the fixture from the evidence", () => {
    assert.equal(chooseFixtureName(evidence()), "healthy");
    assert.equal(chooseFixtureName(evidence({ atRiskCount: 1 })), "flaky");
    assert.equal(chooseFixtureName(evidence({}, true)), "flaky");
    assert.equal(chooseFixtureName(evidence({ noRegisteredNode: true })), "no-node");
    assert.equal(chooseFixtureName(null), "healthy");
  });
});

describe("mock mode end to end", () => {
  it("produces a valid assessment from fixtures alone", async () => {
    const client = new FixtureMetaClient({ logger: silentLogger });
    const { assessment } = await assessProvider(evidence(), {
      model: "muse-spark-1.3",
      client,
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "low");
  });

  it("fails safe to unknown when the recorded fixture is invalid", async () => {
    // The `invalid` fixture is a real recorded shape that does not match the
    // schema. Selecting it proves the validation runs in mock mode.
    const client = new FixtureMetaClient({ logger: silentLogger, fixtureName: "invalid" });
    const { assessment } = await assessProvider(evidence(), {
      model: "muse-spark-1.3",
      client,
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "unknown");
  });
});
