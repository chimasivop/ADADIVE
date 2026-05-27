import { Router, type IRouter } from "express";
import { eq, and, gte, sql } from "drizzle-orm";
import { db, providersTable, dealsTable } from "@workspace/db";
import {
  ListProvidersQueryParams,
  CreateProviderBody,
  GetProviderParams,
  GetProviderDealsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/providers", async (req, res): Promise<void> => {
  const query = ListProvidersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let rows = await db.select().from(providersTable).orderBy(providersTable.reputationScore);

  const { status, minReputation } = query.data;
  if (status && status !== "all") {
    rows = rows.filter((p) => p.status === status);
  }
  if (minReputation != null) {
    rows = rows.filter((p) => p.reputationScore >= minReputation);
  }

  res.json(rows);
});

router.post("/providers", async (req, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db
    .insert(providersTable)
    .values({
      name: parsed.data.name,
      nodeId: parsed.data.nodeId,
      totalStorageGb: parsed.data.totalStorageGb,
      pricePerGbPerEpoch: parsed.data.pricePerGbPerEpoch,
      region: parsed.data.region,
    })
    .returning();

  res.status(201).json(provider);
});

router.get("/providers/:id", async (req, res): Promise<void> => {
  const params = GetProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, params.data.id));

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  res.json(provider);
});

router.get("/providers/:id/deals", async (req, res): Promise<void> => {
  const params = GetProviderDealsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deals = await db
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.providerId, params.data.id))
    .orderBy(dealsTable.createdAt);

  res.json(deals);
});

export default router;
