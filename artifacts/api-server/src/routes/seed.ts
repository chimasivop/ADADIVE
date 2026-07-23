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
        totalAdaEarned: 5000,
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
        totalAdaEarned: 12000,
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
        totalAdaEarned: 3500,
      },
    ]);

    // Insert sample deals
    await db.insert(dealsTable).values([
      {
        providerId: 1,
        providerName: "ProStorage Alpha",
        clientAddress: "addr1qxtz8jnhv4f5us5q9a3d4e6r7t8y9u0i1o2p3q4r5s6t7u8v9w0x1y2z",
        storageGb: 50,
        durationEpochs: 5,
        totalCostAda: 1250,
        status: "active",
        dataHash: "abc123def456",
        startEpoch: 450,
        endEpoch: 455,
      },
      {
        providerId: 2,
        providerName: "DataChain Beta",
        clientAddress: "addr1yzx9876543210qweasdzxcrtyfvbguhnmjkioplkmn",
        storageGb: 100,
        durationEpochs: 10,
        totalCostAda: 3600,
        status: "active",
        dataHash: "def456ghi789",
        startEpoch: 448,
        endEpoch: 458,
      },
      {
        providerId: 3,
        providerName: "SecureVault Gamma",
        clientAddress: "addr1abc654321qweasdzxcrtyfvbguhnmjkioplkmn",
        storageGb: 25,
        durationEpochs: 3,
        totalCostAda: 240,
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
        metadata: { dealId: 1, providerId: 1 },
      },
      {
        type: "deal_activated",
        description: "Storage deal activated",
        metadata: { dealId: 2, providerId: 2 },
      },
      {
        type: "provider_joined",
        description: "New provider joined network",
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
