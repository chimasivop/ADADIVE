import { pgTable, serial, text, real, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dealStatusEnum = pgEnum("deal_status", ["pending", "active", "completed", "failed"]);

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull(),
  providerName: text("provider_name").notNull(),
  clientAddress: text("client_address").notNull(),
  storageGb: real("storage_gb").notNull(),
  durationEpochs: integer("duration_epochs").notNull(),
  totalCostAda: real("total_cost_ada").notNull(),
  status: dealStatusEnum("status").notNull().default("pending"),
  dataHash: text("data_hash").notNull(),
  startEpoch: integer("start_epoch"),
  endEpoch: integer("end_epoch"),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDealSchema = createInsertSchema(dealsTable).omit({ id: true, createdAt: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;
