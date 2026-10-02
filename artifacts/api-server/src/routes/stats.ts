import { Router, type IRouter } from "express";
import { sql, desc } from "drizzle-orm";
import { db, providersTable, dealsTable, activityTable } from "@workspace/db";
import { getCurrentEpoch } from "../lib/storage";

const router: IRouter = Router();

router.get("/stats/network", async (_req, res): Promise<void> => {
  const [providerStats] = await db
    .select({
      totalProviders: sql<number>`count(*)::int`,
      activeProviders: sql<number>`count(*) filter (where status = 'active')::int`,
      totalStorageTb: sql<number>`sum(total_storage_gb) / 1024.0`,
      usedStorageTb: sql<number>`sum(used_storage_gb) / 1024.0`,
      avgReputationScore: sql<number>`avg(reputation_score)`,
      totalSolLocked: sql<number>`coalesce(sum(total_sol_earned), 0)`,
    })
    .from(providersTable);

  const [dealStats] = await db
    .select({
      activeDeals: sql<number>`count(*) filter (where status = 'active')::int`,
      totalDealsAllTime: sql<number>`count(*)::int`,
    })
    .from(dealsTable);

  // Get the live epoch from the Solana cluster.
  const currentEpoch = await getCurrentEpoch();

  const totalStorageTb = providerStats.totalStorageTb ?? 0;
  const usedStorageTb = providerStats.usedStorageTb ?? 0;
  const networkUtilizationPercent =
    totalStorageTb > 0 ? (usedStorageTb / totalStorageTb) * 100 : 0;

  res.json({
    totalProviders: providerStats.totalProviders,
    activeProviders: providerStats.activeProviders,
    totalStorageTb: Number(totalStorageTb.toFixed(2)),
    usedStorageTb: Number(usedStorageTb.toFixed(2)),
    activeDeals: dealStats.activeDeals,
    totalDealsAllTime: dealStats.totalDealsAllTime,
    totalSolLocked: Number((providerStats.totalSolLocked ?? 0).toFixed(2)),
    avgReputationScore: Number((providerStats.avgReputationScore ?? 0).toFixed(1)),
    currentEpoch,
    currentEpochSource: currentEpoch !== null ? "solana" : "unavailable",
    networkUtilizationPercent: Number(networkUtilizationPercent.toFixed(1)),
  });
});

router.get("/stats/economy", async (_req, res): Promise<void> => {
  const [priceStats] = await db
    .select({
      avgPrice: sql<number>`avg(price_per_gb_per_epoch)`,
      totalSolEarned: sql<number>`coalesce(sum(total_sol_earned), 0)`,
    })
    .from(providersTable);

  const [dealAgg] = await db
    .select({
      avgDealSizeGb: sql<number>`avg(storage_gb)`,
      avgDealDurationEpochs: sql<number>`avg(duration_epochs)`,
      totalSolEarnedAllTime: sql<number>`coalesce(sum(total_cost_sol), 0)`,
      dailySolVolume: sql<number>`coalesce(sum(total_cost_sol) filter (where created_at > now() - interval '24 hours'), 0)`,
    })
    .from(dealsTable);

  const regionStats = await db
    .select({
      region: providersTable.region,
      totalStorageTb: sql<number>`sum(total_storage_gb) / 1024.0`,
      providerCount: sql<number>`count(*)::int`,
      avgPrice: sql<number>`avg(price_per_gb_per_epoch)`,
    })
    .from(providersTable)
    .groupBy(providersTable.region);

  // Get real price history from deal data, aggregated by date
  const priceHistoryRaw = await db
    .select({
      createdDate: sql<string>`date(created_at)`,
      avgPrice: sql<number>`avg(total_cost_sol / nullif(storage_gb * duration_epochs, 0))`,
      dealsCount: sql<number>`count(*)::int`,
    })
    .from(dealsTable)
    .where(sql`created_at > now() - interval '30 days'`)
    .groupBy(sql`date(created_at)`)
    .orderBy(desc(sql`date(created_at)`))
    .limit(20);

  // Get the live epoch from the Solana cluster.
  const currentEpoch = await getCurrentEpoch();

  // Transform to epoch-based history or use as-is for daily history
  const priceHistory = priceHistoryRaw.length > 0
    ? priceHistoryRaw.map((p, i) => ({
        date: p.createdDate,
        priceSol: Number((p.avgPrice ?? priceStats.avgPrice ?? 0.0012).toFixed(6)),
        dealsCount: p.dealsCount,
      }))
    : [{ date: "no_data", priceSol: 0, dealsCount: 0, placeholder: true }];

  res.json({
    solPerGbPerEpoch: Number(Number(priceStats.avgPrice ?? 0).toFixed(6)),
    avgDealSizeGb: Number(Number(dealAgg.avgDealSizeGb ?? 0).toFixed(1)),
    avgDealDurationEpochs: Number(Number(dealAgg.avgDealDurationEpochs ?? 0).toFixed(0)),
    totalSolEarnedAllTime: Number(Number(dealAgg.totalSolEarnedAllTime ?? 0).toFixed(2)),
    dailySolVolume: Number(Number(dealAgg.dailySolVolume ?? 0).toFixed(2)),
    currentEpoch,
    priceHistory,
    storageByRegion: regionStats.map((r) => ({
      region: r.region,
      totalStorageTb: Number((r.totalStorageTb ?? 0).toFixed(2)),
      providerCount: r.providerCount,
      avgPrice: Number((r.avgPrice ?? 0).toFixed(6)),
    })),
  });
});

router.get("/stats/activity", async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(activityTable)
    .orderBy(sql`${activityTable.timestamp} desc`)
    .limit(20);

  res.json(events);
});

export default router;
