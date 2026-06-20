import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, dealsTable, providersTable, activityTable } from "@workspace/db";
import { validate, schemas } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/deals", async (req: Request, res: Response): Promise<void> => {
  try {
    let rows = await db.select().from(dealsTable).orderBy(dealsTable.createdAt);

    // Optional filtering
    const status = req.query.status as string | undefined;
    const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;

    if (status && status !== "all") {
      rows = rows.filter((d) => d.status === status);
    }
    if (providerId != null && !Number.isNaN(providerId)) {
      rows = rows.filter((d) => d.providerId === providerId);
    }

    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post(
  "/deals",
  validate(schemas.createDeal),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body;

      const [provider] = await db
        .select()
        .from(providersTable)
        .where(eq(providersTable.id, body.providerId));

      if (!provider) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }

      const totalCostAda = body.storageGb * body.durationEpochs * provider.pricePerGbPerEpoch;

      const [deal] = await db
        .insert(dealsTable)
        .values({
          providerId: body.providerId,
          providerName: provider.name,
          clientAddress: body.clientAddress,
          storageGb: body.storageGb,
          durationEpochs: body.durationEpochs,
          totalCostAda,
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
  validate(schemas.updateProviderApplication),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid deal ID" });
        return;
      }

      const body = req.body;

      const [deal] = await db
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.id, id));

      if (!deal) {
        res.status(404).json({ error: "Deal not found" });
        return;
      }

      const [updated] = await db
        .update(dealsTable)
        .set({
          status: body.status,
        })
        .where(eq(dealsTable.id, id))
        .returning();

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
          metadata: { totalCostAda: updated.totalCostAda },
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
