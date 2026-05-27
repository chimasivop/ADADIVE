import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, dealsTable, providersTable, activityTable } from "@workspace/db";
import {
  ListDealsQueryParams,
  CreateDealBody,
  GetDealParams,
  UpdateDealParams,
  UpdateDealBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/deals", async (req, res): Promise<void> => {
  const query = ListDealsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let rows = await db.select().from(dealsTable).orderBy(dealsTable.createdAt);

  const { status, providerId } = query.data;
  if (status && status !== "all") {
    rows = rows.filter((d) => d.status === status);
  }
  if (providerId != null) {
    rows = rows.filter((d) => d.providerId === providerId);
  }

  res.json(rows);
});

router.post("/deals", async (req, res): Promise<void> => {
  const parsed = CreateDealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, parsed.data.providerId));

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  const totalCostAda =
    parsed.data.storageGb * parsed.data.durationEpochs * provider.pricePerGbPerEpoch;

  const [deal] = await db
    .insert(dealsTable)
    .values({
      providerId: parsed.data.providerId,
      providerName: provider.name,
      clientAddress: parsed.data.clientAddress,
      storageGb: parsed.data.storageGb,
      durationEpochs: parsed.data.durationEpochs,
      totalCostAda,
      dataHash: parsed.data.dataHash,
      status: "pending",
    })
    .returning();

  await db.insert(activityTable).values({
    type: "deal_created",
    description: `New deal proposed: ${parsed.data.storageGb} GB with ${provider.name}`,
    relatedId: deal.id,
    metadata: { providerId: provider.id, storageGb: parsed.data.storageGb },
  });

  res.status(201).json(deal);
});

router.get("/deals/:id", async (req, res): Promise<void> => {
  const params = GetDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deal] = await db
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.id, params.data.id));

  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  res.json(deal);
});

router.patch("/deals/:id", async (req, res): Promise<void> => {
  const params = UpdateDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateDealBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [deal] = await db
    .update(dealsTable)
    .set(body.data)
    .where(eq(dealsTable.id, params.data.id))
    .returning();

  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  if (body.data.status === "active") {
    await db.insert(activityTable).values({
      type: "deal_activated",
      description: `Deal #${deal.id} activated with ${deal.providerName}`,
      relatedId: deal.id,
      metadata: { providerId: deal.providerId, storageGb: deal.storageGb },
    });
  } else if (body.data.status === "completed") {
    await db.insert(activityTable).values({
      type: "deal_completed",
      description: `Deal #${deal.id} completed — ${deal.storageGb} GB stored successfully`,
      relatedId: deal.id,
      metadata: { totalCostAda: deal.totalCostAda },
    });
  }

  res.json(deal);
});

export default router;
