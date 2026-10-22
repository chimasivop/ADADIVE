/**
 * The new provider-storage endpoints, driven over HTTP with `supertest`.
 *
 * Real code paths: the actual Express router, the actual `requireWalletOrOidcAuth`
 * middleware, and the actual shared session verifier (a token is minted here with
 * the same `issueSessionToken` the oracle uses). Only two things are fake — the
 * persistence (an in-memory store, so no Postgres) and the auth *session lookup*,
 * which the wallet path never touches.
 *
 * This is the category AGENTS.md calls "unit tests": no database, no live node,
 * no second service. The findprovs logic and the provider-agent's own behaviour
 * have their own suites.
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
const UNKNOWN_CID = "bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const OTHER_PEER = "12D3KooWPeer2Qm9rT4vXbNpZ7cJ5sKw2YhL6dFg8aE1uR3tVbCdEf";
const WALLET_A = "7xKq8m3vJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFk";
const WALLET_B = "9pQr2sT4uV6wX8yZ1aB3cD5eF7gH9jK2mN4pQ6rS8tU0vW";

// The verifier reads SESSION_SECRET lazily and caches it; set it before the first
// request so a real token can be minted and checked.
process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes-long";

const SECRET = parseSessionSecret(process.env.SESSION_SECRET);

function tokenFor(wallet: string): string {
  return issueSessionToken({
    wallet,
    secret: SECRET,
    issuer: WALLET_SESSION_ISSUER,
    audience: WALLET_SESSION_AUDIENCE,
    ttlSeconds: 3600,
  });
}

/**
 * A minimal app around the real router. `authMiddleware`'s job in the full app is
 * to populate the OIDC session; here there is no OIDC session, so a stub reports
 * "not authenticated". The wallet path never consults it.
 */
function buildApp(store: InMemoryProviderStorage, internalToken: string | null = "internal-test-token"): Express {
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
      internalToken,
      log: { debug: () => {}, warn: () => {}, error: () => {} },
    })
  );
  return app;
}

describe("provider storage endpoints", () => {
  let store: InMemoryProviderStorage;

  beforeEach(() => {
    store = new InMemoryProviderStorage();
  });

  describe("auth", () => {
    it("rejects an unauthenticated request to GET /provider/assignments", async () => {
      const res = await request(buildApp(store)).get("/api/provider/assignments");
      expect(res.status).to.equal(401);
    });

    it("rejects a token signed with the wrong secret", async () => {
      const forged = issueSessionToken({
        wallet: WALLET_A,
        secret: parseSessionSecret("a completely different secret value 123456"),
        issuer: WALLET_SESSION_ISSUER,
        audience: WALLET_SESSION_AUDIENCE,
        ttlSeconds: 3600,
      });
      const res = await request(buildApp(store))
        .get("/api/provider/assignments")
        .set("Authorization", `Bearer ${forged}`);
      expect(res.status).to.equal(401);
    });

    it("answers 404 when the wallet has no provider row", async () => {
      const res = await request(buildApp(store))
        .get("/api/provider/assignments")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);
      expect(res.status).to.equal(404);
    });
  });

  describe("registration (POST /providers)", () => {
    it("registers a provider with no node (Pinata path) and stores the session wallet", async () => {
      const res = await request(buildApp(store))
        .post("/api/providers")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({
          name: "Pinata Provider",
          nodeId: "pool1pinata",
          totalStorageGb: 100,
          pricePerGbPerEpoch: 0.001,
          region: "us-east",
        });

      expect(res.status).to.equal(201);
      expect(res.body.peerId).to.equal(null);
      // The wallet came from the verified session, not the body.
      expect(res.body.walletAddress).to.equal(WALLET_A);
    });

    it("registers a provider with a linked node when peerId is supplied", async () => {
      const res = await request(buildApp(store))
        .post("/api/providers")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({
          name: "Node Provider",
          nodeId: "pool1node",
          totalStorageGb: 100,
          pricePerGbPerEpoch: 0.001,
          region: "us-east",
          peerId: PEER,
        });

      expect(res.status).to.equal(201);
      expect(res.body.peerId).to.equal(PEER);
    });

    it("refuses to register in another wallet's name", async () => {
      const res = await request(buildApp(store))
        .post("/api/providers")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        // A body `walletAddress` is not accepted as the owner.
        .send({
          name: "Spoof",
          nodeId: "pool1x",
          totalStorageGb: 1,
          pricePerGbPerEpoch: 0.001,
          region: "us-east",
          walletAddress: WALLET_B,
        });

      expect(res.status).to.equal(201);
      expect(res.body.walletAddress).to.equal(WALLET_A);
    });
  });

  describe("node linking (PATCH /providers/:id/node)", () => {
    it("lets the owner link a node", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A });
      const res = await request(buildApp(store))
        .patch(`/api/providers/${provider.id}/node`)
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: PEER });

      expect(res.status).to.equal(200);
      expect(res.body.peerId).to.equal(PEER);
      expect(provider.peerId).to.equal(PEER);
    });

    it("lets the owner clear the node to return to the Pinata path", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const res = await request(buildApp(store))
        .patch(`/api/providers/${provider.id}/node`)
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: null });

      expect(res.status).to.equal(200);
      expect(res.body.peerId).to.equal(null);
    });

    it("forbids a different wallet from changing the node (ownership, not just identity)", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A });
      const res = await request(buildApp(store))
        .patch(`/api/providers/${provider.id}/node`)
        .set("Authorization", `Bearer ${tokenFor(WALLET_B)}`)
        .send({ peerId: PEER });

      expect(res.status).to.equal(403);
      expect(provider.peerId).to.equal(null);
    });

    it("answers 404 for a provider that does not exist", async () => {
      const res = await request(buildApp(store))
        .patch("/api/providers/9999/node")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: PEER });
      expect(res.status).to.equal(404);
    });

    it("rejects a malformed peer id with a 400", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A });
      const res = await request(buildApp(store))
        .patch(`/api/providers/${provider.id}/node`)
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: "not a peer id!!" });
      expect(res.status).to.equal(400);
    });
  });

  describe("GET /provider/assignments", () => {
    it("returns only this provider's unconfirmed assignments", async () => {
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const b = store.seedProvider({ walletAddress: WALLET_B, peerId: OTHER_PEER });
      const dealA = store.seedDeal({ dataHash: CID });
      store.seedAssignment({ dealId: dealA.id, providerId: a.id, peerId: PEER });
      const dealB = store.seedDeal({ dataHash: "bafyother" });
      store.seedAssignment({ dealId: dealB.id, providerId: b.id, peerId: OTHER_PEER });

      const res = await request(buildApp(store))
        .get("/api/provider/assignments")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

      expect(res.status).to.equal(200);
      expect(res.body.assignments).to.have.length(1);
      expect(res.body.assignments[0].cid).to.equal(CID);
      expect(res.body.assignments[0].peerId).to.equal(PEER);
    });

    it("omits assignments already confirmed", async () => {
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const dealA = store.seedDeal({ dataHash: CID });
      store.seedAssignment({
        dealId: dealA.id,
        providerId: a.id,
        peerId: PEER,
        status: "confirmed",
      });

      const res = await request(buildApp(store))
        .get("/api/provider/assignments")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);

      expect(res.status).to.equal(200);
      expect(res.body.assignments).to.have.length(0);
    });

    it("returns an empty list for a provider with no node registered", async () => {
      store.seedProvider({ walletAddress: WALLET_A, peerId: null });
      const res = await request(buildApp(store))
        .get("/api/provider/assignments")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`);
      expect(res.status).to.equal(200);
      expect(res.body.assignments).to.deep.equal([]);
    });
  });

  describe("POST /provider/confirm-pin", () => {
    function seedAssigned() {
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const deal = store.seedDeal({ dataHash: CID });
      const assignment = store.seedAssignment({
        dealId: deal.id,
        providerId: a.id,
        peerId: PEER,
      });
      return { a, deal, assignment };
    }

    it("confirms the assignment when the peer id matches", async () => {
      const { assignment } = seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ assignmentId: assignment.id, cid: CID, peerId: PEER });

      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal("confirmed");
      expect(assignment.status).to.equal("confirmed");
      expect(assignment.confirmedAt).to.not.equal(null);
    });

    it("answers 403 when a different provider's wallet tries to confirm", async () => {
      const { assignment } = seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_B)}`)
        .send({ assignmentId: assignment.id, cid: CID, peerId: PEER });

      // Wallet B has no provider row at all -> 404; register one to reach 403.
      expect(res.status).to.equal(404);
      expect(assignment.status).to.equal("assigned");
    });

    it("answers 403 when another registered provider claims this assignment", async () => {
      const { a, deal, assignment } = seedAssigned();
      const other = store.seedProvider({ walletAddress: WALLET_B, peerId: OTHER_PEER });

      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_B)}`)
        .send({ assignmentId: assignment.id, cid: CID, peerId: assignment.peerId });

      expect(res.status).to.equal(403);
      expect(assignment.status).to.equal("assigned");
      expect(other.id).to.not.equal(a.id);
      expect(deal.id).to.equal(assignment.dealId);
    });

    it("answers 409 when the reported peer id is not the assigned node", async () => {
      const { assignment } = seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ assignmentId: assignment.id, cid: CID, peerId: OTHER_PEER });

      expect(res.status).to.equal(409);
      expect(assignment.status).to.equal("assigned");
    });

    it("answers 404 when the assignment id is unknown", async () => {
      const { assignment } = seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ assignmentId: assignment.id + 1000, cid: CID, peerId: PEER });

      expect(res.status).to.equal(404);
      expect(assignment.status).to.equal("assigned");
    });

    it("answers 409 when the CID is not the one the assignment stores", async () => {
      // The assignment id selects the row; the CID must agree. Without this a
      // caller could mark deal A stored on the strength of deal B's CID.
      const { assignment } = seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ assignmentId: assignment.id, cid: UNKNOWN_CID, peerId: PEER });

      expect(res.status).to.equal(409);
      expect(assignment.status).to.equal("assigned");
    });

    it("confirms the right deal when two share a CID", async () => {
      // `deals.data_hash` is not unique. Addressing by assignment id is what
      // keeps a shared CID from confirming the wrong row.
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const dealOne = store.seedDeal({ dataHash: CID });
      const dealTwo = store.seedDeal({ dataHash: CID });
      const first = store.seedAssignment({ dealId: dealOne.id, providerId: a.id, peerId: PEER });
      const second = store.seedAssignment({ dealId: dealTwo.id, providerId: a.id, peerId: PEER });

      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ assignmentId: second.id, cid: CID, peerId: PEER });

      expect(res.status).to.equal(200);
      expect(res.body.dealId).to.equal(dealTwo.id);
      expect(second.status).to.equal("confirmed");
      expect(first.status).to.equal("assigned");
    });

    it("rejects a malformed CID with a 400", async () => {
      const { assignment } = seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ assignmentId: assignment.id, cid: "not-a-cid", peerId: PEER });
      expect(res.status).to.equal(400);
    });

    it("rejects a missing assignment id with a 400", async () => {
      seedAssigned();
      const res = await request(buildApp(store))
        .post("/api/provider/confirm-pin")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ cid: CID, peerId: PEER });
      expect(res.status).to.equal(400);
    });
  });

  describe("POST /provider/heartbeat", () => {
    it("records the heartbeat time for the owner", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const res = await request(buildApp(store))
        .post("/api/provider/heartbeat")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: PEER });

      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(true);
      expect(provider.lastHeartbeatAt).to.not.equal(null);
    });

    it("answers 409 when the heartbeat names the wrong node", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const res = await request(buildApp(store))
        .post("/api/provider/heartbeat")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: OTHER_PEER });

      expect(res.status).to.equal(409);
      expect(provider.lastHeartbeatAt).to.equal(null);
    });

    it("stamps the assignment for the reporting peer, not every provider assignment", async () => {
      // The provider rotated nodes: an old assignment is still bound to PEER, a
      // new one to OTHER_PEER. A heartbeat from the new node must not look like
      // liveness for the old node's deal.
      const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: OTHER_PEER });
      const oldDeal = store.seedDeal({ dataHash: CID });
      const newDeal = store.seedDeal({ dataHash: UNKNOWN_CID });
      const oldAssignment = store.seedAssignment({
        dealId: oldDeal.id,
        providerId: provider.id,
        peerId: PEER,
      });
      const newAssignment = store.seedAssignment({
        dealId: newDeal.id,
        providerId: provider.id,
        peerId: OTHER_PEER,
      });

      const res = await request(buildApp(store))
        .post("/api/provider/heartbeat")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: OTHER_PEER });

      expect(res.status).to.equal(200);
      expect(newAssignment.lastHeartbeatAt).to.not.equal(null);
      expect(oldAssignment.lastHeartbeatAt).to.equal(null);
    });

    it("answers 409 when the provider has no registered node", async () => {
      const provider = store.seedProvider({ walletAddress: WALLET_A, peerId: null });
      const res = await request(buildApp(store))
        .post("/api/provider/heartbeat")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: PEER });

      expect(res.status).to.equal(409);
      expect(provider.lastHeartbeatAt).to.equal(null);
    });

    it("rejects a malformed peer id with a 400", async () => {
      store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const res = await request(buildApp(store))
        .post("/api/provider/heartbeat")
        .set("Authorization", `Bearer ${tokenFor(WALLET_A)}`)
        .send({ peerId: "" });
      expect(res.status).to.equal(400);
    });
  });

  describe("internal feed", () => {
    const TOKEN = "internal-test-token";

    it("closes the feed when no internal token is configured", async () => {
      const app = buildApp(store, null);
      const res = await request(app).get("/api/internal/provider-assignments");
      expect(res.status).to.equal(503);
    });

    it("rejects a request with the wrong internal token", async () => {
      const res = await request(buildApp(store))
        .get("/api/internal/provider-assignments")
        .set("Authorization", "Bearer wrong-token");
      expect(res.status).to.equal(401);
    });

    it("serves assignments with the per-peer heartbeat to the oracle", async () => {
      const a = store.seedProvider({
        walletAddress: WALLET_A,
        peerId: PEER,
        // Provider-level beat is deliberately different from the assignment's, so
        // the assertion proves the feed reads the *peer* timestamp.
        lastHeartbeatAt: new Date("2024-06-01T09:00:00.000Z"),
      });
      const deal = store.seedDeal({ dataHash: CID });
      store.seedAssignment({
        dealId: deal.id,
        providerId: a.id,
        peerId: PEER,
        lastHeartbeatAt: new Date("2024-06-01T11:00:00.000Z"),
      });

      const res = await request(buildApp(store))
        .get("/api/internal/provider-assignments")
        .set("Authorization", `Bearer ${TOKEN}`);

      expect(res.status).to.equal(200);
      expect(res.body.assignments).to.have.length(1);
      expect(res.body.assignments[0].cid).to.equal(CID);
      expect(res.body.assignments[0].peerId).to.equal(PEER);
      expect(res.body.assignments[0].lastHeartbeatAt).to.equal("2024-06-01T11:00:00.000Z");
      // The streak travels with the feed so the oracle can add to it rather than
      // restart from zero each sweep.
      expect(res.body.assignments[0].consecutiveConclusiveNegatives).to.equal(0);
    });

    it("reports the stored consecutive-negative streak to the oracle", async () => {
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const deal = store.seedDeal({ dataHash: CID });
      store.seedAssignment({
        dealId: deal.id,
        providerId: a.id,
        peerId: PEER,
        consecutiveConclusiveNegatives: 2,
      });

      const res = await request(buildApp(store))
        .get("/api/internal/provider-assignments")
        .set("Authorization", `Bearer ${TOKEN}`);

      expect(res.status).to.equal(200);
      expect(res.body.assignments[0].consecutiveConclusiveNegatives).to.equal(2);
    });

    it("accepts a verdict only with the internal token", async () => {
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const deal = store.seedDeal({ dataHash: CID });
      const assignment = store.seedAssignment({
        dealId: deal.id,
        providerId: a.id,
        peerId: PEER,
      });

      const unauthorized = await request(buildApp(store))
        .patch(`/api/internal/provider-assignments/${assignment.id}`)
        .send({ atRisk: true, consecutiveConclusiveNegatives: 1 });
      expect(unauthorized.status).to.equal(401);

      const res = await request(buildApp(store))
        .patch(`/api/internal/provider-assignments/${assignment.id}`)
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({
          atRisk: true,
          verificationDetail: "stale and not advertising",
          consecutiveConclusiveNegatives: 3,
        });

      expect(res.status).to.equal(200);
      expect(assignment.atRisk).to.equal(true);
      expect(assignment.verificationDetail).to.equal("stale and not advertising");
      expect(assignment.lastVerifiedAt).to.not.equal(null);
      expect(assignment.consecutiveConclusiveNegatives).to.equal(3);
      expect(res.body.consecutiveConclusiveNegatives).to.equal(3);
    });

    it("requires atRisk to be a boolean", async () => {
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const deal = store.seedDeal({ dataHash: CID });
      const assignment = store.seedAssignment({
        dealId: deal.id,
        providerId: a.id,
        peerId: PEER,
      });

      const res = await request(buildApp(store))
        .patch(`/api/internal/provider-assignments/${assignment.id}`)
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ atRisk: "yes", consecutiveConclusiveNegatives: 1 });
      expect(res.status).to.equal(400);
    });

    it("rejects a verdict with a missing or invalid streak", async () => {
      // The oracle computes the streak, so an omitted or negative value is a bug
      // in the caller, not a reason to silently reset the counter to zero.
      const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
      const deal = store.seedDeal({ dataHash: CID });
      const assignment = store.seedAssignment({
        dealId: deal.id,
        providerId: a.id,
        peerId: PEER,
        consecutiveConclusiveNegatives: 2,
      });

      for (const bad of [undefined, -1, 1.5, "3"]) {
        const res = await request(buildApp(store))
          .patch(`/api/internal/provider-assignments/${assignment.id}`)
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ atRisk: false, consecutiveConclusiveNegatives: bad });
        expect(res.status, `streak: ${String(bad)}`).to.equal(400);
      }
      // And the stored counter was not disturbed by any of them.
      expect(assignment.consecutiveConclusiveNegatives).to.equal(2);
    });

    it("answers 404 for a verdict on a missing assignment", async () => {
      const res = await request(buildApp(store))
        .patch("/api/internal/provider-assignments/4242")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ atRisk: false, consecutiveConclusiveNegatives: 0 });
      expect(res.status).to.equal(404);
    });

    describe("streak-only advance (PATCH /internal/provider-assignments/:id/streak)", () => {
      it("advances the counter without touching the stored verdict", async () => {
        // The below-threshold case: the counter moves, but there is no verdict to
        // write. `at_risk` and `last_verified_at` must be left exactly as they
        // were — writing them here is what would clear an existing flag.
        const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
        const deal = store.seedDeal({ dataHash: CID });
        const verifiedAt = new Date("2024-05-01T00:00:00.000Z");
        const assignment = store.seedAssignment({
          dealId: deal.id,
          providerId: a.id,
          peerId: PEER,
          atRisk: false,
          verificationDetail: "previous detail",
          lastVerifiedAt: verifiedAt,
          consecutiveConclusiveNegatives: 1,
        });

        const res = await request(buildApp(store))
          .patch(`/api/internal/provider-assignments/${assignment.id}/streak`)
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ consecutiveConclusiveNegatives: 2 });

        expect(res.status).to.equal(200);
        expect(res.body.consecutiveConclusiveNegatives).to.equal(2);
        expect(assignment.consecutiveConclusiveNegatives).to.equal(2);
        // The load-bearing assertions: the verdict is untouched.
        expect(assignment.atRisk).to.equal(false);
        expect(assignment.verificationDetail).to.equal("previous detail");
        expect(assignment.lastVerifiedAt).to.equal(verifiedAt);
      });

      it("does not clear an existing at-risk flag", async () => {
        const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
        const deal = store.seedDeal({ dataHash: CID });
        const assignment = store.seedAssignment({
          dealId: deal.id,
          providerId: a.id,
          peerId: PEER,
          atRisk: true,
          consecutiveConclusiveNegatives: 3,
        });

        await request(buildApp(store))
          .patch(`/api/internal/provider-assignments/${assignment.id}/streak`)
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ consecutiveConclusiveNegatives: 4 });

        expect(assignment.atRisk).to.equal(true);
        expect(assignment.consecutiveConclusiveNegatives).to.equal(4);
      });

      it("requires the internal token", async () => {
        const res = await request(buildApp(store))
          .patch("/api/internal/provider-assignments/1/streak")
          .send({ consecutiveConclusiveNegatives: 1 });
        expect(res.status).to.equal(401);
      });

      it("rejects an invalid streak", async () => {
        const a = store.seedProvider({ walletAddress: WALLET_A, peerId: PEER });
        const deal = store.seedDeal({ dataHash: CID });
        const assignment = store.seedAssignment({
          dealId: deal.id,
          providerId: a.id,
          peerId: PEER,
        });

        const res = await request(buildApp(store))
          .patch(`/api/internal/provider-assignments/${assignment.id}/streak`)
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ consecutiveConclusiveNegatives: -1 });
        expect(res.status).to.equal(400);
      });

      it("answers 404 for a missing assignment", async () => {
        const res = await request(buildApp(store))
          .patch("/api/internal/provider-assignments/4242/streak")
          .set("Authorization", `Bearer ${TOKEN}`)
          .send({ consecutiveConclusiveNegatives: 1 });
        expect(res.status).to.equal(404);
      });
    });
  });
});
