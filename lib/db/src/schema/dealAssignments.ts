import { pgTable, serial, integer, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";
import { dealsTable } from "./deals";

/**
 * Which provider storage node is responsible for a deal.
 *
 * A row exists only when the deal's provider has registered a `peer_id`. Deals
 * whose provider has no node get no row here and keep the existing Pinata
 * verification path — see `POST /deals` in the api-server, which creates the
 * assignment, and the oracle's findprovs job, which verifies it.
 */
export const dealAssignmentsTable = pgTable(
  "deal_assignments",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => dealsTable.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "cascade" }),
    // Copied from the provider at assignment time so a later node change does
    // not rewrite which node a past deal was assigned to.
    peerId: text("peer_id").notNull(),
    // 'assigned' | 'confirmed' | 'failed' (CHECK constraint in the migration).
    status: text("status").notNull().default("assigned"),
    // Last heartbeat seen for *this* peer. Per-assignment, not only
    // provider-level, so rotating a provider to a new node cannot make the old
    // node's deal look alive (see the migration comment).
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    // Set by the oracle's findprovs verification; `true` is the explicit
    // at-risk signal, never a silent failure.
    atRisk: boolean("at_risk").notNull().default(false),
    verificationDetail: text("verification_detail"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("deal_assignments_deal_id_idx").on(table.dealId),
    index("deal_assignments_provider_status_idx").on(table.providerId, table.status),
    index("deal_assignments_peer_idx").on(table.peerId),
  ]
);

export const insertDealAssignmentSchema = createInsertSchema(dealAssignmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDealAssignment = z.infer<typeof insertDealAssignmentSchema>;
export type DealAssignment = typeof dealAssignmentsTable.$inferSelect;
