import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, providersTable, dealsTable } from "@workspace/db";
import { validate, schemas } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/providers", async (req: Request, res: Response): Promise<void> => {
  try {
    let rows = await db.select().from(providersTable).orderBy(providersTable.reputationScore);

    // Optional filtering by status and reputation score
    const status = req.query.status as string | undefined;
    const minReputation = req.query.minReputation ? parseInt(req.query.minReputation as string) : undefined;

    if (status && status !== "all") {
      rows = rows.filter((p) => p.status === status);
    }
    if (minReputation != null && !Number.isNaN(minReputation)) {
      rows = rows.filter((p) => p.reputationScore >= minReputation);
    }

    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post(
  "/providers",
  validate(schemas.providerApplication),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body;
      const [provider] = await db
        .insert(providersTable)
        .values({
          name: body.name,
          email: body.email,
          wallet: body.wallet,
          capacity: body.capacity,
          region: body.region,
          reason: body.reason,
        })
        .returning();

      res.status(201).json(provider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

router.get(
  "/providers/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
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
