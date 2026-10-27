/**
 * Reliability evidence — the read-only, provider-status-only view the
 * reliability advisor reasons over.
 *
 * This is the *producer* side of the shape. The advisor package declares its own
 * structurally-identical interface (documented as mirroring this one), exactly as
 * the oracle backend declares its own `AssignmentView` mirroring the api-server's
 * internal feed. The two services version independently, so the type is not
 * shared by import; the JSON on the wire is the contract.
 *
 * ## What is in here, and what deliberately is not
 *
 * Only provider status data: identity (name/id/region/status), reputation and
 * uptime, the registered node's peer id, heartbeat timestamps and their derived
 * age/staleness, and per-assignment verification state (at-risk flag, the
 * consecutive-negative streak, the oracle's detail string, last-verified and
 * last-heartbeat times, and the deal's CID/status).
 *
 * Never included: file contents, wallet keys or secrets, and the provider's
 * wallet *address* (a public value, but not needed to judge reliability, so it is
 * simply left out). The CID is a content identifier, not the content.
 *
 * ## Heartbeat "history"
 *
 * The schema stores only the *latest* heartbeat per provider and per assignment
 * peer — there is no time series to replay. So the honest evidence is the latest
 * timestamp plus its derived age and staleness, not a history. That limitation is
 * surfaced to the model rather than papered over.
 */

import type { ProviderReliabilitySnapshot } from "./providerStorage";

export interface ReliabilityEvidence {
  provider: {
    id: number;
    name: string;
    status: string;
    region: string;
    reputationScore: number | null;
    uptimePercent: number | null;
    /** The registered storage node, or `null` when the provider has none. */
    peerId: string | null;
    /** Latest provider-level heartbeat, or `null` when never reported. */
    lastHeartbeatAt: string | null;
    /** Milliseconds since the last heartbeat; `null` when never reported. */
    heartbeatAgeMs: number | null;
    /** Never-reported counts as stale, matching the oracle's rule. */
    heartbeatStale: boolean;
  };
  /** The staleness cutoff the oracle also uses, so the model can weigh ages. */
  heartbeatStaleThresholdMs: number;
  /** Consecutive conclusive-negative sweeps the oracle needs before at-risk. */
  consecutiveNegativesThreshold: number;
  assignments: Array<{
    assignmentId: number;
    dealId: number;
    dealStatus: string;
    cid: string;
    peerId: string;
    status: string;
    atRisk: boolean;
    consecutiveConclusiveNegatives: number;
    verificationDetail: string | null;
    lastVerifiedAt: string | null;
    /** Per-peer heartbeat for this assignment, or `null` when never reported. */
    lastHeartbeatAt: string | null;
    heartbeatAgeMs: number | null;
    heartbeatStale: boolean;
    createdAt: string;
    confirmedAt: string | null;
  }>;
  summary: {
    assignmentCount: number;
    confirmedCount: number;
    pendingCount: number;
    atRiskCount: number;
    maxConsecutiveConclusiveNegatives: number;
    /** True when the provider row itself has never reported a heartbeat. */
    neverHeartbeated: boolean;
    /** True when the provider has no registered node at all. */
    noRegisteredNode: boolean;
  };
  generatedAt: string;
}

export interface EvidenceOptions {
  /** A heartbeat older than this is stale. Defaults to the oracle's 3 minutes. */
  heartbeatStaleMs: number;
  /** Consecutive-negative threshold the oracle uses. Defaults to 3. */
  consecutiveNegatives: number;
  /** Injectable clock, for tests that must not depend on wall time. */
  now?: () => Date;
}

/**
 * The oracle's defaults, repeated here rather than imported: the api-server does
 * not depend on the oracle package. Keep in sync with
 * `artifacts/oracle-backend/src/config.ts` (`PROVIDER_HEARTBEAT_STALE_MS` 3 min,
 * `PROVIDER_VERIFICATION_CONSECUTIVE_NEGATIVES` 3).
 */
export const DEFAULT_HEARTBEAT_STALE_MS = 3 * 60_000;
export const DEFAULT_CONSECUTIVE_NEGATIVES = 3;

function ageMs(at: Date | null, now: Date): number | null {
  if (at === null) return null;
  return now.getTime() - at.getTime();
}

/**
 * Turn a provider snapshot into the evidence the advisor consumes.
 *
 * Pure and total: it derives staleness and the summary counts, formats dates as
 * ISO strings, and never throws. The same shape is produced whether the caller is
 * the wallet route or the internal feed, so the two can never drift.
 */
export function buildReliabilityEvidence(
  snapshot: ProviderReliabilitySnapshot,
  options: EvidenceOptions
): ReliabilityEvidence {
  const now = (options.now ?? (() => new Date()))();
  const threshold = options.heartbeatStaleMs;

  const isStale = (age: number | null): boolean =>
    age === null || age > threshold;

  const providerAge = ageMs(snapshot.provider.lastHeartbeatAt, now);

  const assignments = snapshot.assignments.map(({ assignment, deal }) => {
    const assignmentAge = ageMs(assignment.lastHeartbeatAt, now);
    return {
      assignmentId: assignment.id,
      dealId: assignment.dealId,
      dealStatus: deal.status,
      cid: deal.dataHash,
      peerId: assignment.peerId,
      status: assignment.status,
      atRisk: assignment.atRisk,
      consecutiveConclusiveNegatives: assignment.consecutiveConclusiveNegatives,
      verificationDetail: assignment.verificationDetail,
      lastVerifiedAt: assignment.lastVerifiedAt?.toISOString() ?? null,
      lastHeartbeatAt: assignment.lastHeartbeatAt?.toISOString() ?? null,
      heartbeatAgeMs: assignmentAge,
      heartbeatStale: isStale(assignmentAge),
      createdAt: assignment.createdAt.toISOString(),
      confirmedAt: assignment.confirmedAt?.toISOString() ?? null,
    };
  });

  return {
    provider: {
      id: snapshot.provider.id,
      name: snapshot.provider.name,
      status: snapshot.provider.status,
      region: snapshot.provider.region,
      reputationScore: snapshot.provider.reputationScore,
      uptimePercent: snapshot.provider.uptimePercent,
      peerId: snapshot.provider.peerId,
      lastHeartbeatAt: snapshot.provider.lastHeartbeatAt?.toISOString() ?? null,
      heartbeatAgeMs: providerAge,
      heartbeatStale: isStale(providerAge),
    },
    heartbeatStaleThresholdMs: threshold,
    consecutiveNegativesThreshold: options.consecutiveNegatives,
    assignments,
    summary: {
      assignmentCount: assignments.length,
      confirmedCount: assignments.filter((a) => a.status === "confirmed").length,
      pendingCount: assignments.filter((a) => a.status === "assigned").length,
      atRiskCount: assignments.filter((a) => a.atRisk).length,
      maxConsecutiveConclusiveNegatives: assignments.reduce(
        (max, a) => Math.max(max, a.consecutiveConclusiveNegatives),
        0
      ),
      neverHeartbeated: snapshot.provider.lastHeartbeatAt === null,
      noRegisteredNode:
        snapshot.provider.peerId === null || snapshot.provider.peerId.trim() === "",
    },
    generatedAt: now.toISOString(),
  };
}
