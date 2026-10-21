/**
 * The Drizzle implementation of `ProviderStorageStore`.
 *
 * This is the only file in the provider-storage layer that imports `@workspace/db`,
 * so the routes and their tests stay free of a database dependency.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  providersTable,
  dealsTable,
  dealAssignmentsTable,
} from "@workspace/db";
import type {
  AssignmentRecord,
  AssignmentView,
  DealRecord,
  NewProviderInput,
  ProviderRecord,
  ProviderStorageStore,
} from "./providerStorage";

const providerColumns = {
  id: providersTable.id,
  peerId: providersTable.peerId,
  lastHeartbeatAt: providersTable.lastHeartbeatAt,
  walletAddress: providersTable.walletAddress,
};

const dealColumns = {
  id: dealsTable.id,
  dataHash: dealsTable.dataHash,
  status: dealsTable.status,
};

const assignmentColumns = {
  id: dealAssignmentsTable.id,
  dealId: dealAssignmentsTable.dealId,
  providerId: dealAssignmentsTable.providerId,
  peerId: dealAssignmentsTable.peerId,
  status: dealAssignmentsTable.status,
  atRisk: dealAssignmentsTable.atRisk,
  verificationDetail: dealAssignmentsTable.verificationDetail,
  lastVerifiedAt: dealAssignmentsTable.lastVerifiedAt,
  createdAt: dealAssignmentsTable.createdAt,
  confirmedAt: dealAssignmentsTable.confirmedAt,
};

export const drizzleProviderStorageStore: ProviderStorageStore = {
  async findProviderByWallet(wallet: string): Promise<ProviderRecord | null> {
    const [row] = await db
      .select(providerColumns)
      .from(providersTable)
      .where(eq(providersTable.walletAddress, wallet));
    return row ?? null;
  },

  async findProviderById(id: number): Promise<ProviderRecord | null> {
    const [row] = await db
      .select(providerColumns)
      .from(providersTable)
      .where(eq(providersTable.id, id));
    return row ?? null;
  },

  async createProvider(input: NewProviderInput): Promise<ProviderRecord> {
    const [row] = await db
      .insert(providersTable)
      .values({
        name: input.name,
        nodeId: input.nodeId,
        totalStorageGb: input.totalStorageGb,
        pricePerGbPerEpoch: input.pricePerGbPerEpoch,
        region: input.region,
        status: "active",
        reputationScore: 100,
        peerId: input.peerId,
        walletAddress: input.walletAddress,
      })
      .returning(providerColumns);
    return row;
  },

  async setProviderNode(id: number, peerId: string | null): Promise<ProviderRecord> {
    const [row] = await db
      .update(providersTable)
      .set({ peerId })
      .where(eq(providersTable.id, id))
      .returning(providerColumns);
    return row;
  },

  async listPendingAssignments(providerId: number): Promise<AssignmentView[]> {
    const rows = await db
      .select({
        assignment: assignmentColumns,
        deal: dealColumns,
        provider: providerColumns,
      })
      .from(dealAssignmentsTable)
      .innerJoin(dealsTable, eq(dealAssignmentsTable.dealId, dealsTable.id))
      .innerJoin(
        providersTable,
        eq(dealAssignmentsTable.providerId, providersTable.id)
      )
      .where(
        and(
          eq(dealAssignmentsTable.providerId, providerId),
          eq(dealAssignmentsTable.status, "assigned")
        )
      )
      .orderBy(dealAssignmentsTable.createdAt);
    return rows;
  },

  async listAllAssignments(): Promise<AssignmentView[]> {
    const rows = await db
      .select({
        assignment: assignmentColumns,
        deal: dealColumns,
        provider: providerColumns,
      })
      .from(dealAssignmentsTable)
      .innerJoin(dealsTable, eq(dealAssignmentsTable.dealId, dealsTable.id))
      .innerJoin(
        providersTable,
        eq(dealAssignmentsTable.providerId, providersTable.id)
      );
    return rows;
  },

  async findDealByCid(cid: string): Promise<DealRecord | null> {
    const [row] = await db
      .select(dealColumns)
      .from(dealsTable)
      .where(eq(dealsTable.dataHash, cid));
    return row ?? null;
  },

  async findAssignmentByDealId(dealId: number): Promise<AssignmentRecord | null> {
    const [row] = await db
      .select(assignmentColumns)
      .from(dealAssignmentsTable)
      .where(eq(dealAssignmentsTable.dealId, dealId));
    return row ?? null;
  },

  async confirmAssignment(id: number, at: Date): Promise<AssignmentRecord> {
    const [row] = await db
      .update(dealAssignmentsTable)
      .set({ status: "confirmed", confirmedAt: at })
      .where(eq(dealAssignmentsTable.id, id))
      .returning(assignmentColumns);
    return row;
  },

  async recordHeartbeat(providerId: number, at: Date): Promise<void> {
    await db
      .update(providersTable)
      .set({ lastHeartbeatAt: at })
      .where(eq(providersTable.id, providerId));
  },

  async recordVerdict(
    id: number,
    atRisk: boolean,
    detail: string | null,
    at: Date
  ): Promise<AssignmentRecord | null> {
    const [row] = await db
      .update(dealAssignmentsTable)
      .set({ atRisk, verificationDetail: detail, lastVerifiedAt: at })
      .where(eq(dealAssignmentsTable.id, id))
      .returning(assignmentColumns);
    return row ?? null;
  },
};
