/**
 * Provider-run storage layer — the endpoints the standalone `provider-agent`
 * polls and reports to, plus the internal feed the oracle backend reads.
 *
 * ## Auth
 *
 * The agent-facing routes are gated by `requireWalletOrOidcAuth`, the existing
 * middleware. No new auth is introduced: the agent signs in once against the
 * oracle with the same `/auth/challenge → sign → /auth/verify` flow the browser
 * uses, and presents the resulting bearer token. The authenticated wallet
 * (`req.walletAddress`) is the only identity these handlers trust — a provider
 * may only see and report on the node its own wallet registered.
 *
 * The internal feed is gated by a *shared bearer token* (`INTERNAL_API_TOKEN`),
 * not a wallet session: the oracle is a service, and forcing it through a wallet
 * sign-in would be inventing an identity it does not have. The same token is set
 * on both services. When it is unset the feed routes answer 503 — an internal
 * channel with no credential must be closed, not open.
 *
 * ## Testability
 *
 * `createProviderStorageRouter(store)` takes its persistence as an argument. The
 * production instance passes the Drizzle store; a test passes an in-memory one,
 * so the endpoints can be exercised with `supertest` and no Postgres. See
 * `lib/providerStorage.ts` for why the seam exists.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { validate, schemas } from "@workspace/api-zod";
import { requireWalletOrOidcAuth } from "../middlewares/requireAuth";
import { logger as defaultLogger } from "../lib/logger";
import {
  decideOwnership,
  peerIdMatches,
  type ProviderStorageStore,
  type ProviderRecord,
} from "../lib/providerStorage";

export interface ProviderStorageRouterDeps {
  store: ProviderStorageStore;
  /** The shared token guarding the internal feed; unset closes those routes. */
  internalToken?: string | null;
  /** Injectable for tests, so no real logging happens. */
  log?: Pick<typeof defaultLogger, "debug" | "warn" | "error">;
}

function readBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

export function createProviderStorageRouter(
  deps: ProviderStorageRouterDeps
): IRouter {
  const { store } = deps;
  const log = deps.log ?? defaultLogger;
  const internalToken = deps.internalToken?.trim() || null;

  const router: IRouter = Router();

  /** Guard the internal feed with the shared token, or close it. */
  const internalAuth = (req: Request, res: Response): boolean => {
    if (!internalToken) {
      res.status(503).json({ error: "internal provider feed is not configured" });
      return false;
    }
    if (readBearer(req.headers["authorization"]) !== internalToken) {
      res.status(401).json({ error: "Authentication required" });
      return false;
    }
    return true;
  };

  const fail = (res: Response, err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  };

  // ── POST /providers ────────────────────────────────────────────────────────
  // Provider registration. Authenticated by the wallet session; linking a
  // storage node is *optional* — `peerId` absent means the provider exists with
  // no node and its deals stay on the centralized Pinata path.
  router.post(
    "/providers",
    requireWalletOrOidcAuth,
    validate(schemas.createProvider),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body as {
          name: string;
          nodeId: string;
          totalStorageGb: number;
          pricePerGbPerEpoch: number;
          region: string;
          peerId?: string | null;
        };
        const provider = await store.createProvider({
          name: body.name,
          nodeId: body.nodeId,
          totalStorageGb: body.totalStorageGb,
          pricePerGbPerEpoch: body.pricePerGbPerEpoch,
          region: body.region,
          peerId: body.peerId?.trim() || null,
          // The wallet is taken from the verified session, never the body: a
          // caller cannot register a provider in someone else's name.
          walletAddress: req.walletAddress ?? null,
        });
        res.status(201).json(provider);
      } catch (err) {
        fail(res, err);
      }
    }
  );

  // ── PATCH /providers/:id/node ──────────────────────────────────────────────
  // Link, change, or clear the provider's storage node after registration.
  // `peerId: null` clears it, returning the provider to the Pinata path. Only
  // the wallet that owns the row may change it.
  router.patch(
    "/providers/:id/node",
    requireWalletOrOidcAuth,
    validate(schemas.updateProviderNode),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = Number(req.params.id);
        const { peerId } = req.body as { peerId: string | null };

        const existing = await store.findProviderById(id);
        if (!existing) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }
        // Ownership: identity is not ownership. See `decideOwnership`.
        if (decideOwnership(req.walletAddress, existing.walletAddress) === "deny") {
          res.status(403).json({
            error: "the authenticated wallet does not own this provider",
          });
          return;
        }

        const updated = await store.setProviderNode(id, peerId?.trim() || null);
        res.json(updated);
      } catch (err) {
        fail(res, err);
      }
    }
  );

  // ── GET /provider/assignments ──────────────────────────────────────────────
  // The provider-agent's poll: deals assigned to this wallet's node that have
  // not been confirmed yet. A provider with no node — or none registered — gets
  // an empty list; the Pinata path needs no agent work.
  router.get(
    "/provider/assignments",
    requireWalletOrOidcAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const provider = await requireProvider(req, res, store);
        if (provider === null) return;

        const rows = await store.listPendingAssignments(provider.id);
        res.json({
          assignments: rows.map(({ assignment, deal }) => ({
            assignmentId: assignment.id,
            dealId: assignment.dealId,
            cid: deal.dataHash,
            peerId: assignment.peerId,
            status: assignment.status,
            createdAt: assignment.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  // ── POST /provider/confirm-pin ─────────────────────────────────────────────
  // "I fetched this CID and pinned it on my node." Flips the *named assignment*
  // to `confirmed`, but only for the provider that owns it and only when the
  // reported peer id is the node the assignment names. The agent echoes the
  // `assignmentId` it received from the poll: a CID lookup is ambiguous, because
  // `deals.data_hash` is not unique and two deals may share one CID.
  router.post(
    "/provider/confirm-pin",
    requireWalletOrOidcAuth,
    validate(schemas.providerConfirmPin),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { assignmentId, cid, peerId } = req.body as {
          assignmentId: number;
          cid: string;
          peerId: string;
        };

        const provider = await requireProvider(req, res, store);
        if (provider === null) return;

        const assignment = await store.findAssignmentById(assignmentId);
        if (!assignment) {
          res.status(404).json({ error: "No such assignment" });
          return;
        }

        // Ownership: the assignment belongs to a specific provider. Without this
        // any authenticated wallet could confirm a pin for someone else's node.
        if (assignment.providerId !== provider.id) {
          res.status(403).json({ error: "this assignment belongs to a different provider" });
          return;
        }

        // The CID must be the one *this* assignment stores. The id selects the
        // row; the CID guards against a stale list or a mispaired report, so a
        // confirmation cannot mark one deal stored on the strength of another.
        const deal = await store.findDealById(assignment.dealId);
        if (!deal) {
          res.status(404).json({ error: "the assignment's deal no longer exists" });
          return;
        }
        if (deal.dataHash !== cid) {
          res.status(409).json({
            error: "cid does not match the cid assigned to this assignment",
          });
          return;
        }

        // The reported peer id must be the one assigned: a confirmation from the
        // wrong node must not mark this assignment stored.
        if (!peerIdMatches(assignment.peerId, peerId)) {
          res.status(409).json({
            error: "peer id does not match the node assigned to this deal",
          });
          return;
        }

        const updated = await store.confirmAssignment(assignment.id, new Date());
        res.json({
          ok: true,
          assignmentId: updated.id,
          dealId: updated.dealId,
          cid,
          peerId: updated.peerId,
          status: updated.status,
          confirmedAt: updated.confirmedAt?.toISOString() ?? null,
        });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  // ── POST /provider/heartbeat ───────────────────────────────────────────────
  // Periodic liveness report. Updates the provider's and the peer's
  // `last_heartbeat_at`, which the oracle's findprovs job treats as one half of
  // the at-risk check.
  router.post(
    "/provider/heartbeat",
    requireWalletOrOidcAuth,
    validate(schemas.providerHeartbeat),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { peerId } = req.body as { peerId: string };

        const provider = await requireProvider(req, res, store);
        if (provider === null) return;

        // A provider must have a *registered* node before its heartbeat can
        // count. The heartbeat's whole purpose is one half of the oracle's
        // at-risk check, and that check only runs for deals in
        // `deal_assignments` — which only exist for providers with a peer id.
        // Recording a beat for a provider with no node would be meaningless at
        // best and, if the row later gained a node, a stale beat would look like
        // fresh liveness for a node that never reported. Refuse it explicitly
        // rather than accept a beat nothing will ever read.
        if (provider.peerId === null || provider.peerId.trim() === "") {
          res.status(409).json({
            error:
              "no storage node is registered for this provider; " +
              "register a peer id before sending heartbeats",
          });
          return;
        }

        // A heartbeat must come from the node the provider registered; otherwise
        // a misconfigured agent would revive a node it does not run.
        if (!peerIdMatches(provider.peerId, peerId)) {
          res.status(409).json({
            error: "peer id does not match the registered node for this provider",
          });
          return;
        }

        const now = new Date();
        await store.recordHeartbeat(provider.id, peerId, now);
        log.debug({ peerId, providerId: provider.id }, "provider heartbeat");
        res.json({ ok: true, peerId, lastHeartbeatAt: now.toISOString() });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  // ── GET /internal/provider-assignments ─────────────────────────────────────
  // Read-only feed for the oracle's findprovs sweep. The two services own
  // separate databases, so the oracle cannot query `deal_assignments` directly.
  router.get(
    "/internal/provider-assignments",
    async (req: Request, res: Response): Promise<void> => {
      if (!internalAuth(req, res)) return;
      try {
        const rows = await store.listAllAssignments();
        res.json({
          assignments: rows.map(({ assignment, deal, provider }) => ({
            assignmentId: assignment.id,
            dealId: assignment.dealId,
            cid: deal.dataHash,
            dealStatus: deal.status,
            providerId: provider.id,
            peerId: assignment.peerId,
            status: assignment.status,
            atRisk: assignment.atRisk,
            verificationDetail: assignment.verificationDetail,
            lastVerifiedAt: assignment.lastVerifiedAt?.toISOString() ?? null,
            // Per-peer liveness, not the provider row's: the assignment is bound
            // to a specific peer, and a provider that rotated nodes must not have
            // its new node's beats read as liveness for this (older) assignment.
            lastHeartbeatAt: assignment.lastHeartbeatAt?.toISOString() ?? null,
          })),
        });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  // ── PATCH /internal/provider-assignments/:id ───────────────────────────────
  // The oracle writes its verdict back: `at_risk`, the detail, and a timestamp.
  router.patch(
    "/internal/provider-assignments/:id",
    async (req: Request, res: Response): Promise<void> => {
      if (!internalAuth(req, res)) return;
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: "Invalid assignment ID" });
          return;
        }
        const body = req.body as { atRisk?: unknown; verificationDetail?: unknown };
        if (typeof body.atRisk !== "boolean") {
          res.status(400).json({ error: "atRisk must be a boolean" });
          return;
        }
        const detail =
          typeof body.verificationDetail === "string"
            ? body.verificationDetail.slice(0, 2000)
            : null;

        const updated = await store.recordVerdict(id, body.atRisk, detail, new Date());
        if (!updated) {
          res.status(404).json({ error: "Assignment not found" });
          return;
        }
        res.json({
          ok: true,
          assignmentId: updated.id,
          atRisk: updated.atRisk,
          verificationDetail: updated.verificationDetail,
          lastVerifiedAt: updated.lastVerifiedAt?.toISOString() ?? null,
        });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  return router;
}

/**
 * Resolve the caller's provider row, answering 404 when the wallet owns none.
 *
 * A wallet that signed in but never registered a provider is a 404, not a 403:
 * there is nothing yet to be forbidden from. These routes are the agent's, and
 * the agent always signs in with a wallet, so an identity with no wallet
 * (the unreachable OIDC path) is refused as well.
 */
async function requireProvider(
  req: Request,
  res: Response,
  store: ProviderStorageStore
): Promise<ProviderRecord | null> {
  const wallet = req.walletAddress;
  if (wallet === undefined) {
    res.status(404).json({ error: "No provider registered for this wallet" });
    return null;
  }
  const provider = await store.findProviderByWallet(wallet);
  if (!provider) {
    res.status(404).json({ error: "No provider registered for this wallet" });
    return null;
  }
  if (decideOwnership(wallet, provider.walletAddress) === "deny") {
    res.status(403).json({ error: "the authenticated wallet does not own this provider" });
    return null;
  }
  return provider;
}

export default createProviderStorageRouter;
