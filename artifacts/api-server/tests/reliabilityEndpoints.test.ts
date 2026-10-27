/**
 * The read-only reliability-evidence endpoints, driven over HTTP with
 * `supertest`.
 *
 * Same shape as `providerEndpoints.test.ts`: the real router, the real
 * `requireWalletOrOidcAuth`, the real evidence builder, a real session token
 * minted with the shared verifier. Only persistence (an in-memory store) is
 * fake. No Postgres, no live node.
 *
 * The tests are about the two properties that matter for this feature:
 *   - the route is *read-only* and exposes status data only; and
 *   - the evidence is derived correctly (staleness, counts, streaks).
 */

import { expect } from "chai";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import request from "supertest";

import {
  issueSessionToken,
  parseSessionSecret,
} from "@workspace/solana-escrow/backend/session";
import { WALLET_SESSION_AUDIENCE, WALLET_SESSION_ISSUER } from "../src/lib/walletAuth";
import { createProviderStorageRouter } from "../src/routes/provider";
import { InMemoryProviderStorage } from "./helpers/memoryStore";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const WALLET_A = "7xKq8m3vJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFk";
const WALLET_B = "9pQr2sT4uV6wX8yZ1aB3cD5eF7gH9jK2mN4pQ6rS8tU0vW";

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes-long";
const SECRET = parseSessionSecret(process.env.SESSION_SECRET);
const INTERNAL = "internal-test-token";

// A fixed clock, so staleness is deterministic and no test sleeps.
const NOW = new Date("2025-01-01T00:05:00.000Z");
const STALE_MS = 3 * 60_000;

function tokenFor(wallet: string): string {
  return issueSessionToken({
    wallet,
    secret: SECRET,
    issuer: WALLET_SESSION_ISSUER,
    audience: WALLET_SESSION_AUDIENCE,
    ttlSeconds: 3600,
  });
}

function buildApp(store: InMemoryProviderStorage): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = (() => false) as Request["isAuthenticated"];
    next();
  });
  app.use(
    "/api",
    createProviderStorageRouter({
      store,
      internalToken: INTERNAL,
      log: { debug: () => {}, warn: () => {}, error: () => {} },
      reliability: { now: () => NOW, heartbeatStaleMs: STALE_MS, consecutiveNegatives: 3 },
    })
  );
  return app;
}

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60_000);
}

describe("GET /provider/reliability", () => {
  let store: InMemoryProviderStorage;

  beforeEach(() => {
    store = new InMemoryProviderStorage();
  });

  it("requires authentication", async () => {
    const res = await request(buildApp(store)).get("/api/provider/reliability");
    expect(res.status).to.equal(401);
  });

  it("answers 404 when the wallet has no provider row", async () => {
    const res = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);
    expect(res.status).to.equal(404);
  });

  it("returns a healthy provider's evidence", async () => {
    const provider = store.seedProvider({
      walletAddress: WALLET_A,
      peerId: PEER,
      lastHeartbeatAt: minutesAgo(1),
    });
    store.seedReliability(provider.id, { name: "Healthy", reputationScore: 100, uptimePercent: 99.9 });
    const deal = store.seedDeal({ dataHash: CID, status: "active" });
    store.seedAssignment({
      dealId: deal.id,
      providerId: provider.id,
      peerId: PEER,
      status: "confirmed",
      lastHeartbeatAt: minutesAgo(1),
    });

    const res = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

    expect(res.status).to.equal(200);
    expect(res.body.provider.name).to.equal("Healthy");
    expect(res.body.provider.heartbeatStale).to.equal(false);
    expect(res.body.provider.heartbeatAgeMs).to.equal(60_000);
    expect(res.body.summary.assignmentCount).to.equal(1);
    expect(res.body.summary.confirmedCount).to.equal(1);
    expect(res.body.summary.atRiskCount).to.equal(0);
    expect(res.body.assignments[0].cid).to.equal(CID);
    expect(res.body.heartbeatStaleThresholdMs).to.equal(STALE_MS);
    expect(res.body.consecutiveNegativesThreshold).to.equal(3);
  });

  it("flags a stale heartbeat and an at-risk assignment", async () => {
    const provider = store.seedProvider({
      walletAddress: WALLET_A,
      peerId: PEER,
      lastHeartbeatAt: minutesAgo(30),
    });
    const deal = store.seedDeal({ dataHash: CID, status: "pending" });
    store.seedAssignment({
      dealId: deal.id,
      providerId: provider.id,
      peerId: PEER,
      status: "assigned",
      atRisk: true,
      consecutiveConclusiveNegatives: 3,
      verificationDetail: "conclusive negative 3/3",
      lastVerifiedAt: minutesAgo(2),
      lastHeartbeatAt: minutesAgo(30),
    });

    const res = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

    expect(res.status).to.equal(200);
    expect(res.body.provider.heartbeatStale).to.equal(true);
    expect(res.body.summary.atRiskCount).to.equal(1);
    expect(res.body.summary.pendingCount).to.equal(1);
    expect(res.body.summary.maxConsecutiveConclusiveNegatives).to.equal(3);
    expect(res.body.assignments[0].atRisk).to.equal(true);
    expect(res.body.assignments[0].verificationDetail).to.equal("conclusive negative 3/3");
  });

  it("treats a never-reported heartbeat as stale and reports a node-less provider", async () => {
    const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: null });

    const res = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

    expect(res.status).to.equal(200);
    expect(res.body.provider.heartbeatStale).to.equal(true);
    expect(res.body.provider.lastHeartbeatAt).to.equal(null);
    expect(res.body.provider.heartbeatAgeMs).to.equal(null);
    expect(res.body.summary.neverHeartbeated).to.equal(true);
    expect(res.body.summary.noRegisteredNode).to.equal(true);
    expect(res.body.summary.assignmentCount).to.equal(0);
  });

  it("does not expose the wallet address (status data only)", async () => {
    const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
    store.seedReliability(provider.id, { name: "Healthy" });

    const res = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

    expect(res.status).to.equal(200);
    // Neither the wallet nor any field named like a secret may appear anywhere
    // in the serialised evidence.
    const text = JSON.stringify(res.body);
    expect(text).to.not.contain(WALLET_A);
    expect(text).to.not.contain("walletAddress");
    expect(text).to.not.contain("secret");
    expect(text).to.not.contain("key");
  });

  it("returns only this provider's assignments", async () => {
    const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
    const b = store.seedProvider({ walletAddress: WALLET_B, peerId: PEER });
    const dealA = store.seedDeal({ dataHash: CID });
    const dealB = store.seedDeal({ dataHash: CID });
    store.seedAssignment({ dealId: dealA.id, providerId: a.id, peerId: PEER });
    store.seedAssignment({ dealId: dealB.id, providerId: b.id, peerId: PEER });

    const res = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

    expect(res.status).to.equal(200);
    expect(res.body.summary.assignmentCount).to.equal(1);
    expect(res.body.assignments[0].dealId).to.equal(dealA.id);
  });

  it("is read-only: no mutation method is served on the route", async () => {
    const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
    for (const method of ["post", "patch", "put", "delete"] as const) {
      const res = await (request(buildApp(store)) as any)
        [method]("/api/provider/reliability")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);
      expect(res.status, method).to.be.oneOf([404, 405]);
    }
    // And the provider row is untouched.
    expect(store.providers.find((p) => p.id === provider.id)!.peerId).to.equal(PEER);
  });
});

describe("GET /internal/provider-reliability/:id", () => {
  let store: InMemoryProviderStorage;

  beforeEach(() => {
    store = new InMemoryProviderStorage();
  });

  it("closes the route when no internal token is configured", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createProviderStorageRouter({
        store,
        internalToken: null,
        log: { debug: () => {}, warn: () => {}, error: () => {} },
      })
    );
    const res = await request(app).get("/api/internal/provider-reliability/1");
    expect(res.status).to.equal(503);
  });

  it("rejects a wrong token", async () => {
    const res = await request(buildApp(store))
      .get("/api/internal/provider-reliability/1")
      .set("Authorization", "Bearer wrong");
    expect(res.status).to.equal(401);
  });

  it("serves the evidence with the shared token", async () => {
    const provider = store.seedProvider({ peerId: PEER, lastHeartbeatAt: minutesAgo(1) });
    store.seedReliability(provider.id, { name: "Internal Healthy" });

    const res = await request(buildApp(store))
      .get(`/api/internal/provider-reliability/${provider.id}`)
      .set("Authorization", `Bearer ${INTERNAL}`);

    expect(res.status).to.equal(200);
    expect(res.body.provider.name).to.equal("Internal Healthy");
  });

  it("rejects a malformed id", async () => {
    const res = await request(buildApp(store))
      .get("/api/internal/provider-reliability/abc")
      .set("Authorization", `Bearer ${INTERNAL}`);
    expect(res.status).to.equal(400);
  });

  it("answers 404 for an unknown provider", async () => {
    const res = await request(buildApp(store))
      .get("/api/internal/provider-reliability/4242")
      .set("Authorization", `Bearer ${INTERNAL}`);
    expect(res.status).to.equal(404);
  });

  it("produces the same shape as the wallet route", async () => {
    const provider = store.seedProvider({
      walletAddress: WALLET_A,
      peerId: PEER,
      lastHeartbeatAt: minutesAgo(1),
    });
    const deal = store.seedDeal({ dataHash: CID });
    store.seedAssignment({
      dealId: deal.id,
      providerId: provider.id,
      peerId: PEER,
      lastHeartbeatAt: minutesAgo(1),
    });

    const walletRes = await request(buildApp(store))
      .get("/api/provider/reliability")
      .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);
    const internalRes = await request(buildApp(store))
      .get(`/api/internal/provider-reliability/${provider.id}`)
      .set("Authorization", `Bearer ${INTERNAL}`);

    expect(walletRes.body).to.deep.equal(internalRes.body);
  });
});
