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
  ProviderReliabilitySnapshot,
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
  consecutiveConclusiveNegatives: dealAssignmentsTable.consecutiveConclusiveNegatives,
  verificationDetail: dealAssignmentsTable.verificationDetail,
  lastVerifiedAt: dealAssignmentsTable.lastVerifiedAt,
  lastHeartbeatAt: dealAssignmentsTable.lastHeartbeatAt,
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

  async getProviderReliabilitySnapshot(
    providerId: number
  ): Promise<ProviderReliabilitySnapshot | null> {
    // The provider row is read on its own, not inner-joined: a provider with no
    // assignments still has a reliability snapshot (all-zero counts), whereas
    // `listAllAssignments` only returns providers that have assignments.
    const [provider] = await db
      .select({
        id: providersTable.id,
        name: providersTable.name,
        status: providersTable.status,
        region: providersTable.region,
        reputationScore: providersTable.reputationScore,
        uptimePercent: providersTable.uptimePercent,
        peerId: providersTable.peerId,
        lastHeartbeatAt: providersTable.lastHeartbeatAt,
      })
      .from(providersTable)
      .where(eq(providersTable.id, providerId));
    if (!provider) return null;

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
      .where(eq(dealAssignmentsTable.providerId, providerId));

    return { provider, assignments: rows };
  },

  async findDealById(id: number): Promise<DealRecord | null> {
    const [row] = await db
      .select(dealColumns)
      .from(dealsTable)
      .where(eq(dealsTable.id, id));
    return row ?? null;
  },

  async findAssignmentById(id: number): Promise<AssignmentRecord | null> {
    const [row] = await db
      .select(assignmentColumns)
      .from(dealAssignmentsTable)
      .where(eq(dealAssignmentsTable.id, id));
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

  async recordHeartbeat(providerId: number, peerId: string, at: Date): Promise<void> {
    // Provider-level timestamp, kept for the provider feed and operators.
    await db
      .update(providersTable)
      .set({ lastHeartbeatAt: at })
      .where(eq(providersTable.id, providerId));

    // Per-assignment timestamp, scoped to this peer. The oracle's at-risk check
    // reads *this*, so a heartbeat from a rotated-in node cannot mark the old
    // node's deals alive. `confirmed` rows are included too: a node that has
    // pinned content must keep proving it is still serving it.
    await db
      .update(dealAssignmentsTable)
      .set({ lastHeartbeatAt: at })
      .where(
        and(
          eq(dealAssignmentsTable.providerId, providerId),
          eq(dealAssignmentsTable.peerId, peerId)
        )
      );
  },

  async recordVerdict(
    id: number,
    atRisk: boolean,
    detail: string | null,
    at: Date,
    consecutiveConclusiveNegatives: number
  ): Promise<AssignmentRecord | null> {
    const [row] = await db
      .update(dealAssignmentsTable)
      .set({
        atRisk,
        verificationDetail: detail,
        lastVerifiedAt: at,
        consecutiveConclusiveNegatives,
      })
      .where(eq(dealAssignmentsTable.id, id))
      .returning(assignmentColumns);
    return row ?? null;
  },

  async recordNegativeStreak(
    id: number,
    consecutiveConclusiveNegatives: number
  ): Promise<AssignmentRecord | null> {
    // Only the counter: `at_risk`, `verification_detail` and `last_verified_at`
    // are deliberately left alone, so a below-threshold negative cannot clear an
    // existing verdict or fabricate one.
    const [row] = await db
      .update(dealAssignmentsTable)
      .set({ consecutiveConclusiveNegatives })
      .where(eq(dealAssignmentsTable.id, id))
      .returning(assignmentColumns);
    return row ?? null;
  },
};
