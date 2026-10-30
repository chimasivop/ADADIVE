/**
 * The provider recommendation endpoint, driven over HTTP with `supertest`.
 *
 * Same shape as `advisoryEndpoints.test.ts`: the real Express router, the real
 * Zod query schema and the real evidence builder run; persistence is the
 * in-memory store and the model is a *stub* advisor. The ranking itself has its
 * own unit suite in the `reliability-agent` package, and the caching/fail-safe
 * logic has a service-level suite there too — these tests are about the route.
 *
 * The properties asserted here:
 *   - it is public and read-only (a GET; no mutation of any row);
 *   - `/recommend` is not captured by `/providers/:id` (the ordering guarantee);
 *   - bad input is a 400 with a field list;
 *   - it is fail-safe — an unavailable advisor or a model failure is a 200 with
 *     the deterministic ranking, never a 5xx, so the page cannot break;
 *   - the daily budget is honoured: at the cap the result is deterministic and
 *     `demoLimitReached` is set, and a fresh cache entry is served for free;
 *   - it never leaks a wallet address or a secret.
 */

import { expect } from "chai";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import request from "supertest";

import {
  createRecommendationRouter,
  type RecommendationAdvisorLike,
} from "../src/routes/recommend";
import { DailyCallBudget } from "../src/lib/advisoryBudget";
import {
  deterministicRecommendation,
  type RecommendationCandidateInput,
  type RecommendationOutcome,
  type RecommendationQuery,
  type RecommendationSuccess,
} from "@workspace/reliability-agent";
import { InMemoryProviderStorage } from "./helpers/memoryStore";

const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const WALLET_A = "7xKq8m3vJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFk";
const DISCLAIMER = "AI advisory, not a guarantee";

const NOW = new Date("2025-01-01T00:05:00.000Z");
const STALE_MS = 3 * 60_000;

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60_000);
}

/**
 * A stub advisor that records what it was asked and returns an "AI" result.
 *
 * It deliberately reorders nothing: it echoes the deterministic ranking back, as
 * the real service does, and only flips `explanationSource` to "ai" to prove the
 * route carries the model's provenance through.
 */
class StubAdvisor implements RecommendationAdvisorLike {
  calls = 0;
  lastCandidates: RecommendationCandidateInput[] | null = null;
  lastQuery: RecommendationQuery | null = null;
  private cached: RecommendationSuccess | null = null;

  async recommend(
    candidates: RecommendationCandidateInput[],
    query: RecommendationQuery
  ): Promise<RecommendationOutcome> {
    this.calls += 1;
    this.lastCandidates = candidates;
    this.lastQuery = query;
    const base = deterministicRecommendation(candidates, query, {
      generatedAt: NOW.toISOString(),
    });
    const outcome: RecommendationSuccess = {
      ...base,
      explanationSource: "ai",
      aiUnavailableReason: null,
      model: "stub-model",
      mock: true,
      candidates: base.candidates.map((c) => ({
        ...c,
        reasons: [`AI reason for ${c.name}`],
        explanationSource: "ai" as const,
      })),
    };
    this.cached = outcome;
    return outcome;
  }

  peek(): RecommendationSuccess | null {
    return this.cached === null ? null : { ...this.cached, cached: true };
  }
}

/** A stub advisor that simulates "no model reachable". */
class UnavailableAdvisor implements RecommendationAdvisorLike {
  async recommend(): Promise<RecommendationOutcome> {
    return { kind: "unavailable", reason: "no key" };
  }
}

/** A live-advisor stub: `mock` is false, so the daily budget gates it. */
class LiveStubAdvisor implements RecommendationAdvisorLike {
  calls = 0;
  readonly mock = false;
  private readonly cache = new Map<string, RecommendationSuccess>();

  private key(query: RecommendationQuery): string {
    return `${query.storageGb}|${query.durationEpochs}|${query.region ?? ""}`;
  }

  async recommend(
    candidates: RecommendationCandidateInput[],
    query: RecommendationQuery
  ): Promise<RecommendationOutcome> {
    this.calls += 1;
    const base = deterministicRecommendation(candidates, query, {
      generatedAt: NOW.toISOString(),
    });
    const outcome: RecommendationSuccess = {
      ...base,
      explanationSource: "ai",
      model: "live-stub-model",
      mock: false,
    };
    this.cache.set(this.key(query), outcome);
    return outcome;
  }

  peek(query: RecommendationQuery): RecommendationSuccess | null {
    const hit = this.cache.get(this.key(query));
    return hit === undefined ? null : { ...hit, cached: true };
  }
}

interface BuildOptions {
  budget?: DailyCallBudget | null;
  rateLimit?: { windowMs?: number; max?: number };
}

function buildApp(
  store: InMemoryProviderStorage,
  advisor: RecommendationAdvisorLike | null,
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
    createRecommendationRouter({
      store,
      advisor,
      disclaimer: DISCLAIMER,
      budget: options.budget ?? null,
      rateLimit: options.rateLimit,
      log: { debug: () => {}, warn: () => {}, error: () => {} },
      reliability: { now: () => NOW, heartbeatStaleMs: STALE_MS, consecutiveNegatives: 3 },
    })
  );
  // A stand-in for the real `/providers/:id` route, registered *after* the
  // recommendation router exactly as `routes/index.ts` does. If ordering were
  // wrong, `/providers/recommend` would land here and return `{ id: "recommend" }`.
  app.get("/api/providers/:id", (req, res) => {
    res.json({ id: req.params.id, name: "captured-by-id-route" });
  });
  return app;
}

/** A store with three healthy providers and one capacity-starved one. */
function seedStore(): InMemoryProviderStorage {
  const store = new InMemoryProviderStorage();
  const healthy = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
  store.seedReliability(healthy.id, {
    name: "Provider Healthy",
    status: "active",
    region: "us-east",
    reputationScore: 95,
    uptimePercent: 99.9,
    totalStorageGb: 1000,
    usedStorageGb: 100,
    pricePerGbPerEpoch: 0.001,
  });

  const flaky = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(30) });
  store.seedReliability(flaky.id, {
    name: "Provider Flaky",
    status: "active",
    region: "us-east",
    reputationScore: 60,
    uptimePercent: 80,
    totalStorageGb: 1000,
    usedStorageGb: 100,
    pricePerGbPerEpoch: 0.003,
  });

  const unknown = store.seedProvider({ peerId: null, lastHeartbeatAt: null });
  store.seedReliability(unknown.id, {
    name: "Provider New",
    status: "active",
    region: "us-east",
    reputationScore: 0,
    uptimePercent: null,
    totalStorageGb: 1000,
    usedStorageGb: 0,
    pricePerGbPerEpoch: 0.0005,
  });

  const starved = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
  store.seedReliability(starved.id, {
    name: "Provider Small",
    status: "active",
    region: "us-east",
    reputationScore: 99,
    uptimePercent: 99.9,
    totalStorageGb: 50,
    usedStorageGb: 0,
    pricePerGbPerEpoch: 0.001,
  });

  return store;
}

const QUERY = "storageGb=100&durationEpochs=10";

describe("GET /providers/recommend — routing and shape", () => {
  it("is public (no auth) and read-only", async () => {
    const store = seedStore();
    const app = buildApp(store, new StubAdvisor());

    const res = await request(app).get(`/api/providers/recommend?${QUERY}`);
    expect(res.status).to.equal(200);
    expect(res.body.available).to.equal(true);
    expect(res.body.disclaimer).to.equal(DISCLAIMER);
    expect(res.body.candidates).to.be.an("array").that.is.not.empty;

    for (const method of ["post", "patch", "put", "delete"] as const) {
      const m = await (request(app) as any)[method](`/api/providers/recommend?${QUERY}`);
      expect(m.status, method).to.be.oneOf([404, 405]);
    }
    // No row was touched.
    expect(store.providers.find((p) => p.id === 1)!.peerId).to.equal(PEER);
  });

  it("is not captured by the /providers/:id route", async () => {
    // The same Express app registers a `/providers/:id` route after the
    // recommendation router. If ordering were wrong, this would return the
    // stand-in body instead of a recommendation.
    const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
      `/api/providers/recommend?${QUERY}`
    );
    expect(res.status).to.equal(200);
    expect(res.body).to.not.have.property("name", "captured-by-id-route");
    expect(res.body).to.have.property("candidates");
  });

  it("returns the deterministic ranking with the AI explanation attached", async () => {
    const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
      `/api/providers/recommend?${QUERY}`
    );
    expect(res.status).to.equal(200);
    expect(res.body.explanationSource).to.equal("ai");
    expect(res.body.candidates[0].reasons[0]).to.match(/^AI reason for /);
    expect(res.body.bestProviderId).to.equal(res.body.candidates[0].providerId);
  });

  it("filters out a provider with too little capacity", async () => {
    const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
      `/api/providers/recommend?${QUERY}`
    );
    const names = res.body.candidates.map((c: { name: string }) => c.name);
    expect(names).to.not.include("Provider Small");
    expect(res.body.filteredOut).to.be.greaterThan(0);
  });

  it("passes the parsed numbers (not strings) to the advisor", async () => {
    const advisor = new StubAdvisor();
    await request(buildApp(seedStore(), advisor)).get(`/api/providers/recommend?${QUERY}`);
    expect(advisor.lastQuery).to.deep.equal({ storageGb: 100, durationEpochs: 10, region: null });
  });

  it("passes a region through when given", async () => {
    const advisor = new StubAdvisor();
    await request(buildApp(seedStore(), advisor)).get(
      `/api/providers/recommend?storageGb=100&durationEpochs=10&region=eu-west`
    );
    expect(advisor.lastQuery!.region).to.equal("eu-west");
  });
});

describe("GET /providers/recommend — validation", () => {
  it("rejects a missing storageGb", async () => {
    const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
      "/api/providers/recommend?durationEpochs=10"
    );
    expect(res.status).to.equal(400);
    expect(res.body.success).to.equal(false);
  });

  it("rejects a non-positive or non-numeric storageGb", async () => {
    for (const value of ["0", "-5", "abc", ""]) {
      const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
        `/api/providers/recommend?storageGb=${value}&durationEpochs=10`
      );
      expect(res.status, value).to.equal(400);
    }
  });

  it("rejects a non-integer or missing durationEpochs", async () => {
    for (const value of ["1.5", "abc", ""]) {
      const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
        `/api/providers/recommend?storageGb=100&durationEpochs=${value}`
      );
      expect(res.status, value).to.equal(400);
    }
  });

  it("names the offending field in the error body", async () => {
    const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
      "/api/providers/recommend?storageGb=abc&durationEpochs=10"
    );
    expect(res.body.details.map((d: { field: string }) => d.field)).to.include("storageGb");
  });
});

describe("GET /providers/recommend — fail-safe", () => {
  it("returns the deterministic ranking when the advisor is unavailable", async () => {
    const res = await request(buildApp(seedStore(), new UnavailableAdvisor())).get(
      `/api/providers/recommend?${QUERY}`
    );
    expect(res.status).to.equal(200);
    expect(res.body.available).to.equal(false);
    expect(res.body.explanationSource).to.equal("deterministic");
    expect(res.body.candidates).to.be.an("array").that.is.not.empty;
    expect(res.body.note).to.match(/AI explanation unavailable/);
  });

  it("returns the deterministic ranking when no advisor is configured at all", async () => {
    const res = await request(buildApp(seedStore(), null)).get(
      `/api/providers/recommend?${QUERY}`
    );
    expect(res.status).to.equal(200);
    expect(res.body.available).to.equal(false);
    expect(res.body.candidates).to.be.an("array").that.is.not.empty;
  });

  it("still returns 200 with an empty candidate list when nothing fits", async () => {
    const res = await request(buildApp(seedStore(), new StubAdvisor())).get(
      "/api/providers/recommend?storageGb=100000&durationEpochs=10"
    );
    expect(res.status).to.equal(200);
    expect(res.body.candidates).to.deep.equal([]);
    expect(res.body.bestProviderId).to.equal(null);
  });

  it("labels an unknown provider as 'Not enough evidence' and never best", async () => {
    const store = new InMemoryProviderStorage();
    const unknown = store.seedProvider({ peerId: null, lastHeartbeatAt: null });
    store.seedReliability(unknown.id, { name: "Provider New", status: "active", region: "us-east" });
    const res = await request(buildApp(store, new StubAdvisor())).get(
      `/api/providers/recommend?${QUERY}`
    );
    expect(res.status).to.equal(200);
    expect(res.body.allInsufficientEvidence).to.equal(true);
    expect(res.body.candidates[0].label).to.equal("Not enough evidence");
    expect(res.body.bestProviderId).to.equal(null);
  });
});

describe("GET /providers/recommend — budget and rate limit", () => {
  it("honours the daily cap: at the cap the result is deterministic with a note", async () => {
    const advisor = new LiveStubAdvisor();
    const budget = new DailyCallBudget({ maxPerDay: 1 });
    const app = buildApp(seedStore(), advisor, { budget });

    // First request spends the one live call.
    const first = await request(app).get(`/api/providers/recommend?${QUERY}`);
    expect(first.status).to.equal(200);
    expect(first.body.demoLimitReached).to.equal(false);
    expect(advisor.calls).to.equal(1);

    // Second request: the budget is spent, so no model call, but a *cached*
    // result is served for free and flagged.
    const second = await request(app).get(`/api/providers/recommend?${QUERY}`);
    expect(second.status).to.equal(200);
    expect(second.body.demoLimitReached).to.equal(true);
    expect(second.body.cached).to.equal(true);
    expect(second.body.note).to.match(/Demo limit reached/);
    expect(advisor.calls).to.equal(1, "the cap must prevent a second live call");
  });

  it("serves the deterministic ranking at the cap when there is no cache entry", async () => {
    const advisor = new LiveStubAdvisor();
    // Spend the only unit on a *different* query, so this query has no cache hit.
    const budget = new DailyCallBudget({ maxPerDay: 1 });
    const app = buildApp(seedStore(), advisor, { budget });
    await request(app).get("/api/providers/recommend?storageGb=100&durationEpochs=10");

    const res = await request(app).get("/api/providers/recommend?storageGb=200&durationEpochs=10");
    expect(res.status).to.equal(200);
    expect(res.body.demoLimitReached).to.equal(true);
    expect(res.body.cached).to.equal(false);
    expect(res.body.explanationSource).to.equal("deterministic");
  });

  it("does not gate a mock advisor behind the budget", async () => {
    const advisor = new StubAdvisor(); // mock: true
    const budget = new DailyCallBudget({ maxPerDay: 0 }); // already exhausted
    const res = await request(buildApp(seedStore(), advisor, { budget })).get(
      `/api/providers/recommend?${QUERY}`
    );
    expect(res.status).to.equal(200);
    expect(res.body.demoLimitReached).to.equal(false);
    expect(advisor.calls).to.equal(1);
  });

  it("answers 429 once the per-IP rate limit is exceeded", async () => {
    const app = buildApp(seedStore(), new StubAdvisor(), {
      rateLimit: { windowMs: 60_000, max: 2 },
    });
    await request(app).get(`/api/providers/recommend?${QUERY}`);
    await request(app).get(`/api/providers/recommend?${QUERY}`);
    const third = await request(app).get(`/api/providers/recommend?${QUERY}`);
    expect(third.status).to.equal(429);
  });
});

describe("GET /providers/recommend — privacy", () => {
  it("never returns a wallet address or a secret", async () => {
    const store = seedStore();
    store.seedProvider({
      peerId: PEER,
      lastHeartbeatAt: minutesAgo(1),
      walletAddress: WALLET_A,
    });
    const res = await request(buildApp(store, new StubAdvisor())).get(
      `/api/providers/recommend?${QUERY}`
    );
    const body = JSON.stringify(res.body);
    expect(body).to.not.contain(WALLET_A);
    expect(body).to.not.match(/api[_-]?key|secret|token|bearer/i);
    // And the evidence handed to the advisor carries no wallet address either.
    // (The advisor receives evidence + capacity/price only.)
  });

  it("sends the model only provider-status facts, never a wallet address", async () => {
    const advisor = new StubAdvisor();
    const store = seedStore();
    store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1), walletAddress: WALLET_A });
    await request(buildApp(store, advisor)).get(`/api/providers/recommend?${QUERY}`);

    // What the route hands the advisor is the ranker's input: evidence (status
    // data) plus capacity and price. Serialise it and prove no wallet leaks.
    const payload = JSON.stringify(advisor.lastCandidates);
    expect(payload).to.not.contain(WALLET_A);
    expect(payload).to.not.match(/wallet|address/i);
    for (const candidate of advisor.lastCandidates!) {
      expect(Object.keys(candidate).sort()).to.deep.equal([
        "evidence",
        "pricePerGbPerEpoch",
        "totalStorageGb",
        "usedStorageGb",
      ]);
    }
  });
});
