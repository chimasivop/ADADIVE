import { pgTable, serial, text, real, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const providerStatusEnum = pgEnum("provider_status", ["active", "inactive"]);

export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nodeId: text("node_id").notNull().unique(),
  totalStorageGb: real("total_storage_gb").notNull(),
  usedStorageGb: real("used_storage_gb").notNull().default(0),
  pricePerGbPerEpoch: real("price_per_gb_per_epoch").notNull(),
  reputationScore: real("reputation_score").notNull().default(100),
  status: providerStatusEnum("status").notNull().default("active"),
  region: text("region").notNull(),
  uptimePercent: real("uptime_percent"),
  activeDeals: integer("active_deals").default(0),
  totalSolEarned: real("total_sol_earned").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProviderSchema = createInsertSchema(providersTable).omit({ id: true, createdAt: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providersTable.$inferSelect;
