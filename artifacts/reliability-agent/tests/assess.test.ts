/**
 * Fail-safe tests for `assessProvider`.
 *
 * The contract: the function is total. Every way the model can misbehave — a
 * transport error, a non-JSON reply, JSON that does not match the schema, or no
 * client at all — must return a valid `unknown` assessment, never throw. An
 * inconclusive result is a legitimate answer, so a test asserting `unknown` is
 * asserting success, not failure.
 */

import { assert } from "chai";

import { assessProvider } from "../src/assess";
import { assessmentSchema } from "../src/schema";
import type { ModelClient } from "../src/metaClient";
import { MetaApiError } from "../src/metaClient";
import type { ReliabilityEvidence } from "../src/evidence";
import { silentLogger } from "../src/logger";

const EVIDENCE: ReliabilityEvidence = {
  provider: {
    id: 1,
    name: "Demo Healthy One",
    status: "active",
    region: "eu-west",
    reputationScore: 100,
    uptimePercent: 99.95,
    peerId: "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY",
    lastHeartbeatAt: "2025-01-01T00:00:30.000Z",
    heartbeatAgeMs: 30_000,
    heartbeatStale: false,
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
  },
  generatedAt: "2025-01-01T00:01:00.000Z",
};

function clientReturning(content: string): ModelClient {
  return { complete: async () => content };
}

function clientThrowing(err: Error): ModelClient {
  return {
    complete: async () => {
      throw err;
    },
  };
}

describe("assessProvider fail-safe", () => {
  it("returns unknown (not a throw) when there is no client", async () => {
    const { assessment, request } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: null,
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "unknown");
    assert.isNull(request);
    assert.doesNotThrow(() => assessmentSchema.parse(assessment));
  });

  it("returns unknown when the model call throws", async () => {
    const { assessment } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: clientThrowing(new MetaApiError("rate limited", 429, "rate_limit_error")),
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "unknown");
    assert.match(assessment.reasons[0], /did not succeed/);
  });

  it("returns unknown when the reply is not JSON", async () => {
    const { assessment } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: clientReturning("I think this provider is probably fine!"),
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "unknown");
    assert.match(assessment.reasons[0], /could not be validated/);
  });

  it("returns unknown when the JSON does not match the schema", async () => {
    const { assessment } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: clientReturning(JSON.stringify({ risk_level: "very-high" })),
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "unknown");
    assert.match(assessment.reasons[0], /could not be validated/);
  });

  it("returns unknown when a required field is missing", async () => {
    const { assessment } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: clientReturning(
        JSON.stringify({ risk_level: "low", reasons: [], evidence_cited: [], uncertain: [] })
      ),
      logger: silentLogger,
    });
    assert.equal(assessment.risk_level, "unknown");
  });

  it("accepts a valid reply as-is", async () => {
    const valid = {
      risk_level: "low" as const,
      reasons: ["heartbeat is fresh"],
      evidence_cited: ["heartbeatStale=false"],
      uncertain: [] as string[],
      recommended_action: "No action needed.",
    };
    const { assessment } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: clientReturning(JSON.stringify(valid)),
      logger: silentLogger,
    });
    assert.deepEqual(assessment, valid);
  });

  it("always returns the request it sent (for auditability) when a client exists", async () => {
    const { request } = await assessProvider(EVIDENCE, {
      model: "muse-spark-1.3",
      client: clientReturning("{}"),
      logger: silentLogger,
    });
    assert.isNotNull(request);
    assert.equal(request!.model, "muse-spark-1.3");
    assert.equal(request!.response_format.type, "json_schema");
    assert.isTrue(request!.response_format.json_schema.strict);
  });

  it("sends only the evidence to the model (no secrets, no file contents)", async () => {
    let seen = "";
    const spy: ModelClient = {
      complete: async (payload) => {
        seen = payload.messages.map((m) => m.content).join("\n");
        return JSON.stringify({
          risk_level: "low",
          reasons: [],
          evidence_cited: [],
          uncertain: [],
          recommended_action: "none",
        });
      },
    };
    await assessProvider(EVIDENCE, { model: "muse-spark-1.3", client: spy, logger: silentLogger });
    // The evidence JSON is present …
    assert.include(seen, "Demo Healthy One");
    // … and nothing that looks like a secret is.
    assert.notInclude(seen.toLowerCase(), "api_key");
    assert.notInclude(seen.toLowerCase(), "authorization");
    assert.notInclude(seen, "PINATA");
  });
});
