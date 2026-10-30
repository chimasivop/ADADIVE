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

import { createAdvisoryRouter, DEMO_LIMIT_NOTE, type AdvisorLike } from "../src/routes/advisory";
import { DailyCallBudget } from "../src/lib/advisoryBudget";
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

/**
 * A live-advisor stub: `mock` is false (so the daily budget gates it) and it
 * exposes a `peek` that returns a cached assessment once one has been produced,
 * which is how the cap is expected to serve a cached result for free.
 */
class LiveStubAdvisor implements AdvisorLike {
  calls = 0;
  readonly mock = false;
  private cached: any = null;

  async assess(providerId: number, _evidence: ReliabilityEvidence): Promise<any> {
    this.calls += 1;
    this.cached = {
      kind: "ok",
      providerId,
      assessment: HEALTHY,
      cached: false,
      inconclusive: false,
      generatedAt: NOW.toISOString(),
      model: "live-stub-model",
      mock: false,
    };
    return this.cached;
  }

  peek(): any {
    return this.cached === null ? null : { ...this.cached, cached: true };
  }
}

interface BuildOptions {
  budget?: DailyCallBudget | null;
  fallbackAssessment?: (providerId: number, evidence: ReliabilityEvidence) => Promise<Assessment>;
  rateLimit?: { windowMs?: number; max?: number };
}

function buildApp(
  store: InMemoryProviderStorage,
  advisor: AdvisorLike | null,
  options: BuildOptions = {}
): Express {
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
      budget: options.budget ?? null,
      fallbackAssessment: options.fallbackAssessment,
      rateLimit: options.rateLimit,
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

  it("reports demoLimitReached=false on a normal result", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const res = await request(buildApp(store, new StubAdvisor())).get(
      `/api/providers/${provider.id}/advisory`
    );
    expect(res.body.demoLimitReached).to.equal(false);
    expect(res.body.note).to.equal(null);
  });
});

describe("GET /providers/:id/advisory — per-IP rate limit", () => {
  it("answers 429 once a single IP exceeds the limit", async () => {
    const store = new InMemoryProviderStorage();
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const app = buildApp(store, new StubAdvisor(), {
      rateLimit: { windowMs: 60_000, max: 3 },
    });

    const path = `/api/providers/${provider.id}/advisory`;
    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app).get(path);
      expect(ok.status, `request ${i}`).to.equal(200);
    }
    const limited = await request(app).get(path);
    expect(limited.status).to.equal(429);
    expect(limited.body.error).to.match(/too many advisory requests/i);
  });
});

describe("GET /providers/:id/advisory — daily live-call cap", () => {
  it("spends the budget on live calls and then serves the cached result with a note", async () => {
    const store = new InMemoryProviderStorage();
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const advisor = new LiveStubAdvisor();
    // One live call allowed per day.
    const budget = new DailyCallBudget({ maxPerDay: 1, now: () => NOW.getTime() });
    const app = buildApp(store, advisor, { budget });

    const path = `/api/providers/${provider.id}/advisory`;

    // First request: a live call, no demo note.
    const first = await request(app).get(path);
    expect(first.status).to.equal(200);
    expect(first.body.demoLimitReached).to.equal(false);
    expect(advisor.calls).to.equal(1);

    // Second request: the cap is spent, so no second live call — the cached
    // assessment is served and flagged.
    const second = await request(app).get(path);
    expect(second.status).to.equal(200);
    expect(second.body.demoLimitReached).to.equal(true);
    expect(second.body.note).to.equal(DEMO_LIMIT_NOTE);
    expect(second.body.cached).to.equal(true);
    expect(advisor.calls).to.equal(1, "the capped request must not spend a live call");
  });

  it("serves the injected fixture fallback when the cap is spent and nothing is cached", async () => {
    const store = new InMemoryProviderStorage();
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const advisor = new LiveStubAdvisor();
    let fallbackCalls = 0;
    // Spend the day's single allowance *before* any request, so the first
    // request is already over the cap and the stub has nothing cached to peek.
    const budget = new DailyCallBudget({ maxPerDay: 1, now: () => NOW.getTime() });
    expect(budget.tryConsume()).to.equal(true);

    const app = buildApp(store, advisor, {
      budget,
      fallbackAssessment: async () => {
        fallbackCalls += 1;
        return unknownAssessment("sample");
      },
    });

    const res = await request(app).get(`/api/providers/${provider.id}/advisory`);
    expect(res.status).to.equal(200);
    expect(res.body.demoLimitReached).to.equal(true);
    expect(res.body.note).to.equal(DEMO_LIMIT_NOTE);
    expect(res.body.assessment.risk_level).to.equal("unknown");
    expect(fallbackCalls).to.equal(1);
    expect(advisor.calls).to.equal(0, "the capped request must not spend a live call");
  });

  it("does not spend the budget on a mock (fixture) advisor", async () => {
    const store = new InMemoryProviderStorage();
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    const advisor = new StubAdvisor();
    // A budget of zero would refuse every live call; the mock advisor must not
    // consult it, so requests still succeed with no demo note.
    const budget = new DailyCallBudget({ maxPerDay: 0, now: () => NOW.getTime() });
    const app = buildApp(store, advisor, { budget });

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get(`/api/providers/${provider.id}/advisory`);
      expect(res.status).to.equal(200);
      expect(res.body.demoLimitReached).to.equal(false);
    }
    expect(advisor.calls).to.equal(3);
  });
});
