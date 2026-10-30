/**
 * An in-memory `ProviderStorageStore` for the endpoint tests.
 *
 * Deliberately a real implementation of the interface rather than a mock: the
 * tests assert on the data the handlers actually read and write (a confirmed
 * assignment really flips to `confirmed`, a heartbeat really records a time), so
 * a spy that returned canned values would test nothing. There is no Postgres in
 * these tests, which is the whole reason the store seam exists.
 */

import type {
  AssignmentRecord,
  AssignmentView,
  DealRecord,
  NewProviderInput,
  ProviderRecord,
  ProviderReliabilitySnapshot,
  ProviderStorageStore,
  RecommendationCandidateSnapshot,
} from "../../src/lib/providerStorage";

/**
 * A provider's reliability metadata. Seeded separately from `ProviderRecord`
 * because the reliability snapshot reads columns (name, status, region, …) the
 * other endpoints do not.
 */
interface SeededReliability {
  name: string;
  status: string;
  region: string;
  reputationScore: number | null;
  uptimePercent: number | null;
  totalStorageGb: number;
  usedStorageGb: number;
  pricePerGbPerEpoch: number;
}

export class InMemoryProviderStorage implements ProviderStorageStore {
  readonly providers: ProviderRecord[] = [];
  readonly deals: DealRecord[] = [];
  readonly assignments: AssignmentRecord[] = [];
  readonly reliability = new Map<number, SeededReliability>();

  private providerSeq = 1;
  private dealSeq = 1;
  private assignmentSeq = 1;

  seedProvider(row: Partial<ProviderRecord> = {}): ProviderRecord {
    const provider: ProviderRecord = {
      id: row.id ?? this.providerSeq++,
      peerId: row.peerId ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt ?? null,
      walletAddress: row.walletAddress ?? null,
    };
    this.providers.push(provider);
    if (provider.id >= this.providerSeq) this.providerSeq = provider.id + 1;
    // Give it reliability metadata by default, so the snapshot method works for
    // every seeded provider without the caller having to remember.
    if (!this.reliability.has(provider.id)) {
      this.reliability.set(provider.id, {
        name: `Provider ${provider.id}`,
        status: "active",
        region: "us-east",
        reputationScore: 100,
        uptimePercent: 99.9,
        totalStorageGb: 1000,
        usedStorageGb: 0,
        pricePerGbPerEpoch: 0.001,
      });
    }
    return provider;
  }

  /** Override the reliability metadata for a seeded provider. */
  seedReliability(providerId: number, row: Partial<SeededReliability>): void {
    const current = this.reliability.get(providerId) ?? {
      name: `Provider ${providerId}`,
      status: "active",
      region: "us-east",
      reputationScore: 100,
      uptimePercent: 99.9,
      totalStorageGb: 1000,
      usedStorageGb: 0,
      pricePerGbPerEpoch: 0.001,
    };
    this.reliability.set(providerId, { ...current, ...row });
  }

  seedDeal(row: Partial<DealRecord> = {}): DealRecord {
    const deal: DealRecord = {
      id: row.id ?? this.dealSeq++,
      dataHash: row.dataHash ?? "bafydefault",
      status: row.status ?? "active",
    };
    this.deals.push(deal);
    if (deal.id >= this.dealSeq) this.dealSeq = deal.id + 1;
    return deal;
  }

  seedAssignment(
    row: Partial<AssignmentRecord> & {
      dealId: number;
      providerId: number;
      peerId: string;
    }
  ): AssignmentRecord {
    const assignment: AssignmentRecord = {
      id: row.id ?? this.assignmentSeq++,
      dealId: row.dealId,
      providerId: row.providerId,
      peerId: row.peerId,
      status: row.status ?? "assigned",
      atRisk: row.atRisk ?? false,
      consecutiveConclusiveNegatives: row.consecutiveConclusiveNegatives ?? 0,
      verificationDetail: row.verificationDetail ?? null,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      createdAt: row.createdAt ?? new Date("2024-06-01T00:00:00.000Z"),
      confirmedAt: row.confirmedAt ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt ?? null,
    };
    this.assignments.push(assignment);
    if (assignment.id >= this.assignmentSeq) this.assignmentSeq = assignment.id + 1;
    return assignment;
  }

  async findProviderByWallet(wallet: string): Promise<ProviderRecord | null> {
    return this.providers.find((p) => p.walletAddress === wallet) ?? null;
  }
  async findProviderById(id: number): Promise<ProviderRecord | null> {
    return this.providers.find((p) => p.id === id) ?? null;
  }
  async createProvider(input: NewProviderInput): Promise<ProviderRecord> {
    return this.seedProvider({
      peerId: input.peerId,
      walletAddress: input.walletAddress,
    });
  }
  async setProviderNode(id: number, peerId: string | null): Promise<ProviderRecord> {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new Error(`no provider ${id}`);
    provider.peerId = peerId;
    return provider;
  }

  private view(assignment: AssignmentRecord): AssignmentView | null {
    const deal = this.deals.find((d) => d.id === assignment.dealId);
    const provider = this.providers.find((p) => p.id === assignment.providerId);
    if (!deal || !provider) return null;
    return { assignment, deal, provider };
  }

  async listPendingAssignments(providerId: number): Promise<AssignmentView[]> {
    return this.assignments
      .filter((a) => a.providerId === providerId && a.status === "assigned")
      .map((a) => this.view(a))
      .filter((v): v is AssignmentView => v !== null);
  }
  async listAllAssignments(): Promise<AssignmentView[]> {
    return this.assignments
      .map((a) => this.view(a))
      .filter((v): v is AssignmentView => v !== null);
  }

  async getProviderReliabilitySnapshot(
    providerId: number
  ): Promise<ProviderReliabilitySnapshot | null> {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) return null;
    const meta = this.reliability.get(providerId) ?? {
      name: `Provider ${providerId}`,
      status: "active",
      region: "us-east",
      reputationScore: null,
      uptimePercent: null,
    };
    const assignments = this.assignments
      .filter((a) => a.providerId === providerId)
      .map((a) => this.view(a))
      .filter((v): v is AssignmentView => v !== null);
    return {
      provider: {
        id: provider.id,
        name: meta.name,
        status: meta.status,
        region: meta.region,
        reputationScore: meta.reputationScore,
        uptimePercent: meta.uptimePercent,
        peerId: provider.peerId,
        lastHeartbeatAt: provider.lastHeartbeatAt,
      },
      assignments,
    };
  }

  async findDealById(id: number): Promise<DealRecord | null> {
    return this.deals.find((d) => d.id === id) ?? null;
  }

  /**
   * Every provider with its assignments, for the recommendation ranker.
   *
   * Unlike the Drizzle store this does not pre-filter by capacity or status —
   * the ranker does both, and a test store that returns everything keeps the
   * ranking the thing under test.
   */
  async listRecommendationCandidates(
    _minStorageGb: number
  ): Promise<RecommendationCandidateSnapshot[]> {
    return this.providers.map((provider) => {
      const meta = this.reliability.get(provider.id) ?? {
        name: `Provider ${provider.id}`,
        status: "active",
        region: "us-east",
        reputationScore: null,
        uptimePercent: null,
        totalStorageGb: 0,
        usedStorageGb: 0,
        pricePerGbPerEpoch: 0,
      };
      const assignments = this.assignments
        .filter((a) => a.providerId === provider.id)
        .map((a) => this.view(a))
        .filter((v): v is AssignmentView => v !== null);
      return {
        provider: {
          id: provider.id,
          name: meta.name,
          status: meta.status,
          region: meta.region,
          reputationScore: meta.reputationScore,
          uptimePercent: meta.uptimePercent,
          peerId: provider.peerId,
          lastHeartbeatAt: provider.lastHeartbeatAt,
          totalStorageGb: meta.totalStorageGb,
          usedStorageGb: meta.usedStorageGb,
          pricePerGbPerEpoch: meta.pricePerGbPerEpoch,
        },
        assignments,
      };
    });
  }

  async findAssignmentById(id: number): Promise<AssignmentRecord | null> {
    return this.assignments.find((a) => a.id === id) ?? null;
  }

  async confirmAssignment(id: number, at: Date): Promise<AssignmentRecord> {
    const assignment = this.assignments.find((a) => a.id === id);
    if (!assignment) throw new Error(`no assignment ${id}`);
    assignment.status = "confirmed";
    assignment.confirmedAt = at;
    return assignment;
  }
  async recordHeartbeat(providerId: number, peerId: string, at: Date): Promise<void> {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`no provider ${providerId}`);
    provider.lastHeartbeatAt = at;
    // Mirror the Drizzle store: per-peer, so a rotated node's beat does not
    // touch assignments bound to the previous peer.
    for (const assignment of this.assignments) {
      if (assignment.providerId === providerId && assignment.peerId === peerId) {
        assignment.lastHeartbeatAt = at;
      }
    }
  }
  async recordVerdict(
    id: number,
    atRisk: boolean,
    detail: string | null,
    at: Date,
    consecutiveConclusiveNegatives: number
  ): Promise<AssignmentRecord | null> {
    const assignment = this.assignments.find((a) => a.id === id);
    if (!assignment) return null;
    assignment.atRisk = atRisk;
    assignment.verificationDetail = detail;
    assignment.lastVerifiedAt = at;
    assignment.consecutiveConclusiveNegatives = consecutiveConclusiveNegatives;
    return assignment;
  }

  async recordNegativeStreak(
    id: number,
    consecutiveConclusiveNegatives: number
  ): Promise<AssignmentRecord | null> {
    const assignment = this.assignments.find((a) => a.id === id);
    if (!assignment) return null;
    assignment.consecutiveConclusiveNegatives = consecutiveConclusiveNegatives;
    return assignment;
  }
}
