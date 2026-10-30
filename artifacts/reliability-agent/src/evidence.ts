/**
 * The reliability evidence the advisor consumes.
 *
 * Structurally identical to the api-server's `ReliabilityEvidence`
 * (`artifacts/api-server/src/lib/reliabilityEvidence.ts`) — the JSON on the wire
 * is the contract. It is *mirrored* rather than imported because the advisor is a
 * standalone package that must not depend on the api-server, exactly as the
 * oracle backend mirrors the api-server's `AssignmentView`.
 *
 * Only provider status data appears here. No file contents, no wallet keys, no
 * secrets. See the api-server file for the field-by-field rationale.
 */

export interface ReliabilityEvidence {
  provider: {
    id: number;
    name: string;
    status: string;
    region: string;
    reputationScore: number | null;
    uptimePercent: number | null;
    peerId: string | null;
    lastHeartbeatAt: string | null;
    heartbeatAgeMs: number | null;
    heartbeatStale: boolean;
  };
  heartbeatStaleThresholdMs: number;
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
    neverHeartbeated: boolean;
    noRegisteredNode: boolean;
  };
  generatedAt: string;
}

/**
 * The exact object sent to the model. It is the evidence plus a fixed system
 * instruction; nothing else. Built by `prompt.ts`, which is the single place the
 * wire payload is assembled — so "only provider status data is sent" is a
 * property of one function, not a claim scattered across the codebase.
 */
export interface ModelRequestPayload {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: {
    type: "json_schema";
    json_schema: { name: string; strict: boolean; schema: unknown };
  };
}
