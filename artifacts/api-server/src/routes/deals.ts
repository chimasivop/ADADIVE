import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, dealsTable, providersTable, activityTable } from "@workspace/db";
import { validate, schemas } from "@workspace/api-zod";
import { requireWalletOrOidcAuth } from "../middlewares/requireAuth";
import { assignDealToProvider } from "../lib/assignments";

const router: IRouter = Router();

router.get("/deals", async (req: Request, res: Response): Promise<void> => {
  try {
    type DealStatus = (typeof dealsTable.status.enumValues)[number];
    const status = req.query.status as DealStatus | "all" | undefined;
    const providerIdParam = req.query.providerId as string | undefined;
    const providerId = providerIdParam ? parseInt(providerIdParam) : undefined;

    // Build SQL WHERE conditions
    const conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(dealsTable.status, status));
    }
    if (providerId != null && !Number.isNaN(providerId)) {
      conditions.push(eq(dealsTable.providerId, providerId));
    }

    const rows = await db
      .select()
      .from(dealsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(dealsTable.createdAt);

    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post(
  "/deals",
  requireWalletOrOidcAuth,
  validate(schemas.createDeal),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body;

      // `requireWalletOrOidcAuth` proves *who* is calling, not that they own the
      // deal being created. `clientAddress` is the deal's owning wallet, so a
      // caller may only propose a deal for themselves — otherwise any
      // authenticated wallet could create a deal in someone else's name. Same
      // posture as the oracle's settle route: skip when there is no wallet
      // identity (the OIDC path, unreachable from the app), enforce otherwise.
      if (
        req.walletAddress !== undefined &&
        req.walletAddress !== body.clientAddress
      ) {
        res.status(403).json({
          error: "the authenticated wallet is not the client for this deal",
        });
        return;
      }

      const [provider] = await db
        .select()
        .from(providersTable)
        .where(eq(providersTable.id, body.providerId));

      if (!provider) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }

      const totalCostSol = body.storageGb * body.durationEpochs * provider.pricePerGbPerEpoch;

      const [deal] = await db
        .insert(dealsTable)
        .values({
          providerId: body.providerId,
          providerName: provider.name,
          clientAddress: body.clientAddress,
          storageGb: body.storageGb,
          durationEpochs: body.durationEpochs,
          totalCostSol,
          dataHash: body.dataHash,
          status: "pending",
        })
        .returning();

      await db.insert(activityTable).values({
        type: "deal_created",
        description: `New deal proposed: ${body.durationEpochs} epochs with provider ${provider.name}`,
        relatedId: deal.id,
        metadata: { providerName: provider.name, durationEpochs: body.durationEpochs },
      });

      // If the provider has registered a storage node, record which peer is
      // responsible for this deal. A provider with no `peer_id` gets no
      // assignment and its deals keep the centralized Pinata path — the
      // assignment is additive, not a replacement.
      try {
        await assignDealToProvider(deal.id, provider);
      } catch (assignErr) {
        // A failed assignment must not fail the deal: the deal is valid, it just
        // falls back to the Pinata path. Logged so the operator can see it.
        req.log?.error({ err: assignErr, dealId: deal.id }, "deal assignment failed");
      }

      res.status(201).json(deal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

router.get(
  "/deals/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid deal ID" });
        return;
      }

      const [deal] = await db
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, id));

      if (!deal) {
        res.status(404).json({ error: "Deal not found" });
        return;
      }

      res.json(deal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

router.patch(
  "/deals/:id",
  requireWalletOrOidcAuth,
  validate(schemas.updateDeal),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);

      // Load the row before touching it: the deal's `clientAddress` is the
      // owning wallet, and only that wallet may change the deal. Without this
      // read the update ran on any id, so any authenticated wallet could flip
      // the status of any deal. Mirrors the oracle's settle ownership check.
      const [existing] = await db
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, id));

      if (!existing) {
        res.status(404).json({ error: "Deal not found" });
        return;
      }

      if (
        req.walletAddress !== undefined &&
        req.walletAddress !== existing.clientAddress
      ) {
        res.status(403).json({
          error: "the authenticated wallet is not the client for this deal",
        });
        return;
      }

      const body = req.body;
      const updateData: Partial<typeof dealsTable.$inferInsert> = {};
      if (body.status !== undefined) updateData.status = body.status;
      if (body.startEpoch !== undefined) updateData.startEpoch = body.startEpoch;
      if (body.endEpoch !== undefined) updateData.endEpoch = body.endEpoch;
      if (body.txHash !== undefined) updateData.txHash = body.txHash;

      const [updated] = await db
        .update(dealsTable)
        .set(updateData)
        .where(eq(dealsTable.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Deal not found" });
        return;
      }

      if (body.status === "active") {
        await db.insert(activityTable).values({
          type: "deal_activated",
          description: `Deal #${updated.id} activated`,
          relatedId: updated.id,
          metadata: { providerName: updated.providerName },
        });
      } else if (body.status === "completed") {
        await db.insert(activityTable).values({
          type: "deal_completed",
          description: `Deal #${updated.id} completed successfully`,
          relatedId: updated.id,
          metadata: { totalCostSol: updated.totalCostSol },
        });
      }

      res.json(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

export default router;
