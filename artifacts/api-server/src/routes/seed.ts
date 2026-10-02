import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { providersTable, dealsTable, activityTable } from "@workspace/db/schema";

const router = Router();

// Seed database with sample data
router.post("/seed", async (req: Request, res: Response) => {
  try {
    // Check if data already exists
    const existingProviders = await db.select().from(providersTable).limit(1);
    if (existingProviders.length > 0) {
      return res.json({ message: "Database already seeded" });
    }

    // Insert sample providers
    await db.insert(providersTable).values([
      {
        name: "ProStorage Alpha",
        nodeId: "pool1abc123",
        totalStorageGb: 500,
        usedStorageGb: 150,
        pricePerGbPerEpoch: 2.5,
        reputationScore: 98,
        status: "active",
        region: "us-east",
        uptimePercent: 99.5,
        activeDeals: 12,
        totalSolEarned: 5000,
      },
      {
        name: "DataChain Beta",
        nodeId: "pool1def456",
        totalStorageGb: 1000,
        usedStorageGb: 400,
        pricePerGbPerEpoch: 1.8,
        reputationScore: 95,
        status: "active",
        region: "eu-west",
        uptimePercent: 98.2,
        activeDeals: 25,
        totalSolEarned: 12000,
      },
      {
        name: "SecureVault Gamma",
        nodeId: "pool1ghi789",
        totalStorageGb: 250,
        usedStorageGb: 100,
        pricePerGbPerEpoch: 3.2,
        reputationScore: 92,
        status: "active",
        region: "asia-pacific",
        uptimePercent: 97.8,
        activeDeals: 8,
        totalSolEarned: 3500,
      },
    ]);

    // Insert sample deals
    await db.insert(dealsTable).values([
      {
        providerId: 1,
        providerName: "ProStorage Alpha",
        clientAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        storageGb: 50,
        durationEpochs: 5,
        totalCostSol: 1250,
        status: "active",
        dataHash: "abc123def456",
        startEpoch: 450,
        endEpoch: 455,
      },
      {
        providerId: 2,
        providerName: "DataChain Beta",
        clientAddress: "3yZe7d9Qrbk9AqNB2ELbQZEEHUxDWpWQaUgDHKQEb1hJ",
        storageGb: 100,
        durationEpochs: 10,
        totalCostSol: 3600,
        status: "active",
        dataHash: "def456ghi789",
        startEpoch: 448,
        endEpoch: 458,
      },
      {
        providerId: 3,
        providerName: "SecureVault Gamma",
        clientAddress: "7v91jFhP3S3LkxEBmCAA6aGWHVwBqZRFkJk7VRabRWnQ",
        storageGb: 25,
        durationEpochs: 3,
        totalCostSol: 240,
        status: "completed",
        dataHash: "ghi789jkl012",
        startEpoch: 440,
        endEpoch: 443,
      },
    ]);

    // Insert sample activity
    await db.insert(activityTable).values([
      {
        type: "deal_created",
        description: "New storage deal created",
        relatedId: 1,
        metadata: { dealId: 1, providerId: 1 },
      },
      {
        type: "deal_activated",
        description: "Storage deal activated",
        relatedId: 2,
        metadata: { dealId: 2, providerId: 2 },
      },
      {
        type: "provider_joined",
        description: "New provider joined network",
        relatedId: 3,
        metadata: { providerId: 3 },
      },
    ]);

    return res.json({ message: "Database seeded successfully" });
  } catch (error) {
    console.error("Error seeding database:", error);
    return res.status(500).json({ error: "Failed to seed database" });
  }
});

export default router;
