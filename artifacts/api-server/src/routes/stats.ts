import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, providersTable, dealsTable, activityTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/stats/network", async (_req, res): Promise<void> => {
  const [providerStats] = await db
    .select({
      totalProviders: sql<number>`count(*)::int`,
      activeProviders: sql<number>`count(*) filter (where status = 'active')::int`,
      totalStorageTb: sql<number>`sum(total_storage_gb) / 1024.0`,
      usedStorageTb: sql<number>`sum(used_storage_gb) / 1024.0`,
      avgReputationScore: sql<number>`avg(reputation_score)`,
      totalAdaLocked: sql<number>`coalesce(sum(total_ada_earned), 0)`,
    })
    .from(providersTable);

  const [dealStats] = await db
    .select({
      activeDeals: sql<number>`count(*) filter (where status = 'active')::int`,
      totalDealsAllTime: sql<number>`count(*)::int`,
    })
    .from(dealsTable);

  const currentEpoch = 500 + Math.floor((Date.now() - new Date("2024-01-01").getTime()) / (1000 * 60 * 60 * 5));

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
    totalAdaLocked: Number((providerStats.totalAdaLocked ?? 0).toFixed(2)),
    avgReputationScore: Number((providerStats.avgReputationScore ?? 0).toFixed(1)),
    currentEpoch,
    networkUtilizationPercent: Number(networkUtilizationPercent.toFixed(1)),
  });
});

router.get("/stats/economy", async (_req, res): Promise<void> => {
  const [priceStats] = await db
    .select({
      avgPrice: sql<number>`avg(price_per_gb_per_epoch)`,
      totalAdaEarned: sql<number>`coalesce(sum(total_ada_earned), 0)`,
    })
    .from(providersTable);

  const [dealAgg] = await db
    .select({
      avgDealSizeGb: sql<number>`avg(storage_gb)`,
      avgDealDurationEpochs: sql<number>`avg(duration_epochs)`,
      totalAdaEarnedAllTime: sql<number>`coalesce(sum(total_cost_ada), 0)`,
      dailyAdaVolume: sql<number>`coalesce(sum(total_cost_ada) filter (where created_at > now() - interval '24 hours'), 0)`,
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

  // Generate synthetic price history for the last 20 epochs
  const currentEpoch = 500 + Math.floor((Date.now() - new Date("2024-01-01").getTime()) / (1000 * 60 * 60 * 5));
  const basePrice = Number(priceStats.avgPrice ?? 0.0012);
  const priceHistory = Array.from({ length: 20 }, (_, i) => {
    const epoch = currentEpoch - 19 + i;
    const variance = (Math.sin(i * 0.8) * 0.0002) + (Math.random() * 0.0001 - 0.00005);
    const dealsCount = Math.floor(3 + Math.random() * 8);
    return {
      epoch,
      priceAda: Number(Math.max(0.0005, basePrice + variance).toFixed(6)),
      dealsCount,
    };
  });

  res.json({
    adaPerGbPerEpoch: Number(Number(priceStats.avgPrice ?? 0).toFixed(6)),
    avgDealSizeGb: Number(Number(dealAgg.avgDealSizeGb ?? 0).toFixed(1)),
    avgDealDurationEpochs: Number(Number(dealAgg.avgDealDurationEpochs ?? 0).toFixed(0)),
    totalAdaEarnedAllTime: Number(Number(dealAgg.totalAdaEarnedAllTime ?? 0).toFixed(2)),
    dailyAdaVolume: Number(Number(dealAgg.dailyAdaVolume ?? 0).toFixed(2)),
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
