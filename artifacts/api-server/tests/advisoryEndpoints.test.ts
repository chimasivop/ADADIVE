/**
 * The read-only AI advisory endpoint, driven over HTTP with `supertest`.
 *
 * Same shape as the other provider-endpoint suites: the real Express router and
 * the real evidence builder run; persistence is the in-memory store. The model is
 * a *stub* advisor, because these tests are about the route's behaviour — the
 * model client, the cache and the fail-safe path have their own suite in the
 * `reliability-agent` package.
 *
 * The properties asserted here:
 *   - it is public and read-only (the directory GETs are public; no mutation);
 *   - it is fail-safe — an unavailable advisor or a model failure is a 200 with
 *     an `unknown` assessment, never a 5xx;
 *   - it never leaks a wallet address or a secret.
 */

import { expect } from "chai";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import request from "supertest";

import { createAdvisoryRouter, type AdvisorLike } from "../src/routes/advisory";
import { unknownAssessment, type Assessment } from "@workspace/reliability-agent";
import type { ReliabilityEvidence } from "@workspace/reliability-agent";
import { InMemoryProviderStorage } from "./helpers/memoryStore";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const WALLET_A = "7xKq8m3vJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFk";
const DISCLAIMER = "AI advisory, not a guarantee";

const NOW = new Date("2025-01-01T00:05:00.000Z");
const STALE_MS = 3 * 60_000;

const HEALTHY: Assessment = {
  risk_level: "low",
  reasons: ["recent heartbeat"],
  evidence_cited: ["heartbeatAgeMs=60000"],
  uncertain: [],
  recommended_action: "No action needed.",
};

/** A stub advisor that records the evidence it was handed and returns a fixed assessment. */
class StubAdvisor implements AdvisorLike {
  calls = 0;
  lastEvidence: ReliabilityEvidence | null = null;
  private readonly assessment: Assessment;

  constructor(assessment: Assessment = HEALTHY) {
    this.assessment = assessment;
  }

  async assess(providerId: number, evidence: ReliabilityEvidence): Promise<any> {
    this.calls += 1;
    this.lastEvidence = evidence;
    return {
      kind: "ok",
      providerId,
      assessment: this.assessment,
      cached: false,
      inconclusive: false,
      generatedAt: NOW.toISOString(),
      model: "stub-model",
      mock: true,
    };
  }
}

/** A stub advisor that simulates "no model reachable". */
class UnavailableAdvisor implements AdvisorLike {
  async assess(): Promise<any> {
    return { kind: "unavailable", reason: "no key" };
  }
}

function buildApp(store: InMemoryProviderStorage, advisor: AdvisorLike | null): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = (() => false) as Request["isAuthenticated"];
    next();
  });
  app.use(
    "/api",
    createAdvisoryRouter({
      store,
      advisor,
      disclaimer: DISCLAIMER,
      log: { debug: () => {}, warn: () => {}, error: () => {} },
      reliability: { now: () => NOW, heartbeatStaleMs: STALE_MS, consecutiveNegatives: 3 },
    })
  );
  return app;
}

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60_000);
}

describe("GET /providers/:id/advisory", () => {
  let store: InMemoryProviderStorage;

  beforeEach(() => {
    store = new InMemoryProviderStorage();
  });

  it("is public (no auth required) and read-only", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const app = buildApp(store, new StubAdvisor());

    const res = await request(app).get(`/api/providers/${provider.id}/advisory`);
    expect(res.status).to.equal(200);
    expect(res.body.available).to.equal(true);
    expect(res.body.assessment.risk_level).to.equal("low");

    // No mutating method is served on the route, and the row is untouched.
    for (const method of ["post", "patch", "put", "delete"] as const) {
      const m = await (request(app) as any)[method](`/api/providers/${provider.id}/advisory`);
      expect(m.status, method).to.be.oneOf([404, 405]);
    }
    expect(store.providers.find((p) => p.id === provider.id)!.peerId).to.equal(PEER);
  });

  it("rejects a malformed id", async () => {
    const res = await request(buildApp(store, new StubAdvisor())).get(
      "/api/providers/abc/advisory"
    );
    expect(res.status).to.equal(400);
  });

  it("answers 404 for an unknown provider", async () => {
    const res = await request(buildApp(store, new StubAdvisor())).get(
      "/api/providers/4242/advisory"
    );
    expect(res.status).to.equal(404);
  });

  it("reports unavailable (200, no assessment) when the advisor is not configured", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const res = await request(buildApp(store, null)).get(
      `/api/providers/${provider.id}/advisory`
    );
    expect(res.status).to.equal(200);
    expect(res.body.available).to.equal(false);
    expect(res.body.assessment).to.equal(null);
  });

  it("reports unavailable (200) when the advisor says it is unavailable at call time", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const res = await request(buildApp(store, new UnavailableAdvisor())).get(
      `/api/providers/${provider.id}/advisory`
    );
    expect(res.status).to.equal(200);
    expect(res.body.available).to.equal(false);
    expect(res.body.assessment).to.equal(null);
  });

  it("passes the built evidence to the advisor and echoes its assessment", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    store.seedReliability(provider.id, { name: "Healthy" });
    const advisor = new StubAdvisor();
    const res = await request(buildApp(store, advisor)).get(
      `/api/providers/${provider.id}/advisory`
    );

    expect(res.status).to.equal(200);
    expect(advisor.calls).to.equal(1);
    expect(advisor.lastEvidence!.provider.name).to.equal("Healthy");
    expect(advisor.lastEvidence!.heartbeatStaleThresholdMs).to.equal(STALE_MS);
    expect(res.body.disclaimer).to.equal(DISCLAIMER);
    expect(res.body.mock).to.equal(true);
  });

  it("surfaces an unknown assessment without failing the request", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const advisor = new StubAdvisor(unknownAssessment("inconclusive"));
    const res = await request(buildApp(store, advisor)).get(
      `/api/providers/${provider.id}/advisory`
    );
    expect(res.status).to.equal(200);
    expect(res.body.assessment.risk_level).to.equal("unknown");
  });

  it("accepts ?refresh=1 and still answers", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const res = await request(buildApp(store, new StubAdvisor())).get(
      `/api/providers/${provider.id}/advisory?refresh=1`
    );
    expect(res.status).to.equal(200);
  });

  it("does not expose the wallet address or any secret", async () => {
    const provider = store.seedProvider({
      walletAddress: WALLET_A,
      peerId: PEER,
      lastHeartbeatAt: minutesAgo(1),
    });
    const res = await request(buildApp(store, new StubAdvisor())).get(
      `/api/providers/${provider.id}/advisory`
    );
    expect(res.status).to.equal(200);
    const text = JSON.stringify(res.body);
    expect(text).to.not.contain(WALLET_A);
    expect(text).to.not.contain("walletAddress");
    expect(text).to.not.contain("secret");
    expect(text).to.not.contain("apiKey");
  });
});
