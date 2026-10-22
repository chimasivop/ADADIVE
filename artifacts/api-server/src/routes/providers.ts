import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gte } from "drizzle-orm";
import { db, providersTable, dealsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/providers", async (req: Request, res: Response): Promise<void> => {
  try {
    type ProviderStatus = (typeof providersTable.status.enumValues)[number];
    const status = req.query.status as ProviderStatus | "all" | undefined;
    const minReputationParam = req.query.minReputation as string | undefined;
    const minReputation = minReputationParam ? parseInt(minReputationParam) : undefined;

    // Build SQL WHERE conditions
    const conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(providersTable.status, status));
    }
    if (minReputation != null && !Number.isNaN(minReputation)) {
      conditions.push(gte(providersTable.reputationScore, minReputation));
    }

    const rows = await db
      .select()
      .from(providersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(providersTable.reputationScore);

    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get(
  "/providers/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid provider ID" });
        return;
      }

      const [provider] = await db
        .select()
        .from(providersTable)
        .where(eq(providersTable.id, id));

      if (!provider) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }

      res.json(provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

router.get(
  "/providers/:id/deals",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid provider ID" });
        return;
      }

      const deals = await db
        .select()
        .from(dealsTable)
        .where(eq(dealsTable.providerId, id))
        .orderBy(dealsTable.createdAt);

      res.json(deals);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

export default router;
