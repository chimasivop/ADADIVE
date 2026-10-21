/**
 * Deal → provider-node assignment.
 *
 * A deal is assigned to a provider's own IPFS node only when that provider has
 * registered a `peer_id`. A provider with no node (the default, and every row
 * created before this feature) gets no assignment, and its deals keep the
 * existing centralized Pinata verification path untouched.
 *
 * The assignment is created at `POST /deals` rather than as a separate dispatch
 * step: the deal's provider — and therefore its node — is known the moment the
 * deal is proposed, and deferring it would only add a window in which a deal
 * exists with no storage responsibility recorded.
 */

import { eq } from "drizzle-orm";
import { db, dealAssignmentsTable, type Provider } from "@workspace/db";

export interface AssignmentResult {
  /** True when an assignment row was created for a provider node. */
  assigned: boolean;
  /** The node's peer id, when assigned. */
  peerId?: string;
}

/**
 * Create the assignment row for `dealId` if `provider` has a node.
 *
 * Idempotent on `deal_id` (there is a unique index): re-assigning the same deal
 * is a no-op. The peer id is copied from the provider row so a later node
 * change does not rewrite which node a past deal was assigned to.
 */
export async function assignDealToProvider(
  dealId: number,
  provider: Pick<Provider, "id" | "peerId">
): Promise<AssignmentResult> {
  const peerId = provider.peerId?.trim();
  if (!peerId) return { assigned: false };

  await db
    .insert(dealAssignmentsTable)
    .values({
      dealId,
      providerId: provider.id,
      peerId,
      status: "assigned",
    })
    .onConflictDoNothing({ target: dealAssignmentsTable.dealId });

  return { assigned: true, peerId };
}

/**
 * The deal's assignment, when it has one.
 *
 * `null` means the deal is on the Pinata path (no node), which is a normal,
 * expected answer rather than an error.
 */
export async function findAssignmentForDeal(dealId: number) {
  const [row] = await db
    .select()
    .from(dealAssignmentsTable)
    .where(eq(dealAssignmentsTable.dealId, dealId));
  return row ?? null;
}
