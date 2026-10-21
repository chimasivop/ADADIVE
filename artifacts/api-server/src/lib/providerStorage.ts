/**
 * Provider-run storage layer — the seam between the routes and the database.
 *
 * The endpoints that serve the standalone provider-agent (and the oracle's
 * internal feed) are the ones this feature adds, so they are the ones worth
 * testing end to end. They would otherwise be reachable only through Drizzle and
 * a live Postgres, which makes "unit test the new endpoints" impossible.
 *
 * So the handlers depend on this narrow interface rather than on `db` directly.
 * Production wires in the Drizzle implementation (`providerStorageDrizzle.ts`);
 * tests wire in an in-memory one. This file imports no database, which is what
 * lets a test import the router without a `DATABASE_URL`.
 *
 * The pure decision helpers (`decideOwnership`, `peerIdMatches`) are here too:
 * they encode the two authorisation rules the brief calls out — a wallet may
 * only act on its own provider, and a reported peer id must match the node the
 * assignment names — and are the parts most worth pinning down in isolation.
 */

/** The columns of a provider row these routes read or write. */
export interface ProviderRecord {
  id: number;
  peerId: string | null;
  lastHeartbeatAt: Date | null;
  walletAddress: string | null;
}

export interface DealRecord {
  id: number;
  dataHash: string;
  status: string;
}

export interface AssignmentRecord {
  id: number;
  dealId: number;
  providerId: number;
  peerId: string;
  status: string;
  atRisk: boolean;
  verificationDetail: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  confirmedAt: Date | null;
  /**
   * Last heartbeat seen for this assignment's peer. The oracle's at-risk rule
   * reads this, *not* `providers.last_heartbeat_at`, so a provider that rotates
   * to a new node does not make the old node's assignment look alive.
   */
  lastHeartbeatAt: Date | null;
}

/** An assignment joined with the deal it stores and the provider that owns it. */
export interface AssignmentView {
  assignment: AssignmentRecord;
  deal: DealRecord;
  provider: ProviderRecord;
}

export interface NewProviderInput {
  name: string;
  nodeId: string;
  totalStorageGb: number;
  pricePerGbPerEpoch: number;
  region: string;
  peerId: string | null;
  walletAddress: string | null;
}

export interface ProviderStorageStore {
  /** The provider row owned by `wallet`, or `null` when none is registered. */
  findProviderByWallet(wallet: string): Promise<ProviderRecord | null>;
  findProviderById(id: number): Promise<ProviderRecord | null>;
  createProvider(input: NewProviderInput): Promise<ProviderRecord>;
  setProviderNode(id: number, peerId: string | null): Promise<ProviderRecord>;

  /** Assignments for one provider that the agent has not confirmed yet. */
  listPendingAssignments(providerId: number): Promise<AssignmentView[]>;
  /** Every assignment, for the oracle's verification sweep. */
  listAllAssignments(): Promise<AssignmentView[]>;

  /** The deal with this id, to check a confirm's CID matches the assignment. */
  findDealById(id: number): Promise<DealRecord | null>;
  /** The assignment with this id, for a confirm addressed by `assignmentId`. */
  findAssignmentById(id: number): Promise<AssignmentRecord | null>;

  confirmAssignment(id: number, at: Date): Promise<AssignmentRecord>;
  /**
   * Record a heartbeat for one provider *peer*. Writes both the provider-level
   * timestamp and every open assignment bound to that peer, so the oracle's
   * per-assignment staleness check sees the beat. Scoping by peer is what stops
   * a rotated node from reviving the previous node's assignments.
   */
  recordHeartbeat(
    providerId: number,
    peerId: string,
    at: Date
  ): Promise<void>;
  recordVerdict(
    id: number,
    atRisk: boolean,
    detail: string | null,
    at: Date
  ): Promise<AssignmentRecord | null>;
}

// ── Pure decision helpers ────────────────────────────────────────────────────

export type OwnershipDecision = "allow" | "deny" | "skip";

/**
 * Whether an authenticated wallet may act on a provider row.
 *
 * `requireWalletOrOidcAuth` proves *identity*, not *ownership* — it only says a
 * wallet signed in. This is the comparison that says whether that wallet owns
 * the row it is about to touch, mirroring the oracle's settle route and the
 * api-server's deal mutations (see AGENTS.md).
 *
 * `skip` is the OIDC path: when there is no wallet identity (`undefined`) the
 * check is not applied, matching the existing posture. It is unreachable from
 * the UI, which never calls `/auth/login`.
 */
export function decideOwnership(
  authenticatedWallet: string | undefined,
  rowWallet: string | null
): OwnershipDecision {
  if (authenticatedWallet === undefined) return "skip";
  return rowWallet !== null && rowWallet === authenticatedWallet ? "allow" : "deny";
}

/**
 * Whether a reported peer id is the node an assignment or provider names.
 *
 * A provider-agent reports the peer id of the node it is actually connected to.
 * If that disagrees with what was registered, the report is from the wrong node
 * and must be refused rather than recorded against this provider — otherwise a
 * misconfigured agent could confirm (or heartbeat) for a node it does not run.
 *
 * A provider with no registered node (`null`) is not compared: there is nothing
 * to disagree with, and the endpoint's other rules decide.
 */
export function peerIdMatches(
  registeredPeerId: string | null,
  reportedPeerId: string
): boolean {
  if (registeredPeerId === null) return true;
  return registeredPeerId.trim() === reportedPeerId.trim();
}
