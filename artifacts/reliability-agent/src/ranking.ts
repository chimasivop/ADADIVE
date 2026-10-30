/**
 * The deterministic provider ranking behind "Recommended providers".
 *
 * This is the *decision* half of the feature, and it is deliberately not the
 * model's job. The model writes prose about candidates that are already ranked;
 * it may not reorder them or add one. That split is what makes the page's advice
 * reproducible and auditable: the same inputs always produce the same order, and
 * the reason list is generated from the same fields that produced the score.
 *
 * ## What it consumes
 *
 * Per candidate: the provider's reliability evidence (the same read-only,
 * status-only shape the advisory endpoint uses) plus three columns the evidence
 * does not carry — `totalStorageGb`, `usedStorageGb` and `pricePerGbPerEpoch`.
 * Those are the capacity and price-fit inputs. Nothing else: no file contents,
 * no wallet address, no key.
 *
 * ## Two layers
 *
 *   1. **Hard filters** (capacity, region, price sanity, active status). A
 *      candidate that fails any of them is not ranked at all — it cannot serve
 *      the deal the customer described.
 *   2. **A 0–100 score** over the survivors: liveness (0–40), verification
 *      (0–30), reputation/uptime (0–20) and price fit (0–10).
 *
 * Providers with insufficient evidence (a node-less provider with no
 * assignments — the "unknown" case) are always sorted *below* every provider
 * that has evidence, however low that provider scores. They are shown as "Not
 * enough evidence" and are never labelled the best choice.
 *
 * ## Heartbeat "history"
 *
 * Only the latest heartbeat is stored (per provider and per assignment peer), so
 * the liveness score reads a single age, not a trend. The reason text says so
 * rather than implying a pattern the data cannot show.
 */

import { isEvidenceInconclusive } from "./advisory";
import type { ReliabilityEvidence } from "./evidence";

/** The customer's deal parameters, as far as ranking cares. */
export interface RecommendationQuery {
  storageGb: number;
  durationEpochs: number;
  /** Requested region, or `null`/empty for "any region". */
  region: string | null;
}

/** One candidate: its evidence plus the capacity/price columns. */
export interface RecommendationCandidateInput {
  evidence: ReliabilityEvidence;
  totalStorageGb: number;
  usedStorageGb: number;
  pricePerGbPerEpoch: number;
}

/**
 * The status fields the model is allowed to see, copied out of the evidence.
 *
 * A named subset rather than the whole evidence object on purpose: it makes the
 * prompt's input reviewable (there is no CID, no verification detail string, no
 * wallet) and it is what `recommendationPayload.test.ts` asserts on.
 */
export interface CandidateFacts {
  heartbeatAgeMs: number | null;
  heartbeatStale: boolean;
  neverHeartbeated: boolean;
  noRegisteredNode: boolean;
  assignmentCount: number;
  confirmedCount: number;
  pendingCount: number;
  atRiskCount: number;
  maxConsecutiveConclusiveNegatives: number;
  reputationScore: number | null;
  uptimePercent: number | null;
}

/** A candidate that survived the hard filters, with its score and prose. */
export interface RankedCandidate {
  providerId: number;
  name: string;
  region: string;
  /** 0–100. Higher is better. */
  score: number;
  /** The evidence-derived part of `score` (0–90), before price fit. */
  reliabilityScore: number;
  /** `unknown` whenever `sufficientEvidence` is false. */
  riskLevel: "low" | "medium" | "high" | "unknown";
  /** False for the "no node, no assignments" case — never ranked best. */
  sufficientEvidence: boolean;
  availableGb: number;
  pricePerGbPerEpoch: number;
  /** `storageGb × durationEpochs × price`. */
  estimatedCostSol: number;
  /** Plain-language, generated from the same fields as the score. */
  reasons: string[];
  /** What the evidence does not settle. */
  uncertain: string[];
  facts: CandidateFacts;
}

export interface RankingResult {
  /** Ranked best-first, capped at `limit`. */
  ranked: RankedCandidate[];
  /** How many candidates were offered. */
  consideredCount: number;
  /** How many were dropped by the hard filters. */
  filteredOut: number;
  /** True when every *ranked* candidate lacks sufficient evidence. */
  allInsufficientEvidence: boolean;
}

export interface RankingOptions {
  /** How many candidates to return. Defaults to 3. */
  limit?: number;
  /**
   * The price treated as "a fair deal" for the price-fit score, in SOL per GB
   * per epoch. Cheaper scores higher, up to a cap. Defaults to 0.002.
   */
  referencePricePerGbPerEpoch?: number;
}

export const DEFAULT_RECOMMENDATION_LIMIT = 3;
export const DEFAULT_REFERENCE_PRICE_PER_GB_PER_EPOCH = 0.002;

/** The score weights, named so the reason text and the tests can reference them. */
export const SCORE_WEIGHTS = {
  /** Liveness (heartbeat freshness). */
  livenessMax: 40,
  /** Verification (at-risk flag and the consecutive-negative streak). */
  verificationMax: 30,
  /** Reputation + uptime. */
  qualityMax: 20,
  /** Price fit against the reference price. */
  priceMax: 10,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Available capacity, never negative. */
export function availableCapacityGb(candidate: RecommendationCandidateInput): number {
  const total = Number.isFinite(candidate.totalStorageGb) ? candidate.totalStorageGb : 0;
  const used = Number.isFinite(candidate.usedStorageGb) ? candidate.usedStorageGb : 0;
  return Math.max(0, total - used);
}

/**
 * The hard filters. A candidate must be able to serve the described deal.
 *
 * Capacity is `total - used >= storageGb`; region matches when none was asked
 * for or when it matches case-insensitively; price must be a positive finite
 * number (a zero/NaN price is a data fault, not a free provider); and the
 * provider must be active.
 */
export function passesHardFilters(
  candidate: RecommendationCandidateInput,
  query: RecommendationQuery
): boolean {
  if (candidate.evidence.provider.status !== "active") return false;
  if (!Number.isFinite(candidate.pricePerGbPerEpoch) || candidate.pricePerGbPerEpoch <= 0) {
    return false;
  }
  if (availableCapacityGb(candidate) < query.storageGb) return false;
  const wanted = query.region?.trim().toLowerCase();
  if (wanted && candidate.evidence.provider.region.trim().toLowerCase() !== wanted) {
    return false;
  }
  return true;
}

function livenessScore(evidence: ReliabilityEvidence): number {
  const s = evidence.summary;
  if (s.noRegisteredNode || s.neverHeartbeated) return 0;
  const age = evidence.provider.heartbeatAgeMs;
  if (age === null || !Number.isFinite(age)) return 0;
  const threshold = evidence.heartbeatStaleThresholdMs;
  if (age <= threshold) return SCORE_WEIGHTS.livenessMax;
  if (age <= 2 * threshold) return Math.round(SCORE_WEIGHTS.livenessMax * 0.7);
  if (age <= 4 * threshold) return Math.round(SCORE_WEIGHTS.livenessMax * 0.35);
  return 0;
}

function verificationScore(evidence: ReliabilityEvidence): number {
  const s = evidence.summary;
  if (s.atRiskCount > 0) return 0;
  const streak = s.maxConsecutiveConclusiveNegatives;
  if (streak >= evidence.consecutiveNegativesThreshold) return Math.round(SCORE_WEIGHTS.verificationMax * 0.15);
  if (streak > 0) return Math.round(SCORE_WEIGHTS.verificationMax * 0.6);
  if (s.assignmentCount === 0) return Math.round(SCORE_WEIGHTS.verificationMax * 0.5);
  return SCORE_WEIGHTS.verificationMax;
}

function qualityScore(evidence: ReliabilityEvidence): number {
  const rep = evidence.provider.reputationScore;
  const uptime = evidence.provider.uptimePercent;
  const half = SCORE_WEIGHTS.qualityMax / 2;
  const repPart = rep === null ? half * 0.5 : clamp((rep / 100) * half, 0, half);
  const upPart = uptime === null ? half * 0.5 : clamp((uptime / 100) * half, 0, half);
  return repPart + upPart;
}

function priceScore(price: number, reference: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return clamp(round2(SCORE_WEIGHTS.priceMax * (reference / price)), 0, SCORE_WEIGHTS.priceMax);
}

function riskFromScore(sufficient: boolean, reliabilityScore: number): RankedCandidate["riskLevel"] {
  if (!sufficient) return "unknown";
  if (reliabilityScore >= 65) return "low";
  if (reliabilityScore >= 35) return "medium";
  return "high";
}

/** A human-readable age ("30s", "12m", "3h"), for the reason text. */
export function humanizeAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "an unknown time";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function factsFrom(evidence: ReliabilityEvidence): CandidateFacts {
  const s = evidence.summary;
  return {
    heartbeatAgeMs: evidence.provider.heartbeatAgeMs,
    heartbeatStale: evidence.provider.heartbeatStale,
    neverHeartbeated: s.neverHeartbeated,
    noRegisteredNode: s.noRegisteredNode,
    assignmentCount: s.assignmentCount,
    confirmedCount: s.confirmedCount,
    pendingCount: s.pendingCount,
    atRiskCount: s.atRiskCount,
    maxConsecutiveConclusiveNegatives: s.maxConsecutiveConclusiveNegatives,
    reputationScore: evidence.provider.reputationScore,
    uptimePercent: evidence.provider.uptimePercent,
  };
}

function buildReasons(candidate: {
  facts: CandidateFacts;
  availableGb: number;
  pricePerGbPerEpoch: number;
}): string[] {
  const { facts } = candidate;
  const reasons: string[] = [];

  if (facts.noRegisteredNode) {
    reasons.push("No storage node is registered, so there is no node liveness to judge.");
  } else if (facts.neverHeartbeated) {
    reasons.push("The node has never reported a heartbeat.");
  } else if (!facts.heartbeatStale) {
    reasons.push(
      `The node reported a heartbeat ${humanizeAge(facts.heartbeatAgeMs)} ago, which is fresh.`
    );
  } else {
    reasons.push(
      `The node's last heartbeat was ${humanizeAge(facts.heartbeatAgeMs)} ago, which is stale.`
    );
  }

  if (facts.atRiskCount > 0) {
    reasons.push(
      `The oracle has flagged ${facts.atRiskCount} assignment${facts.atRiskCount === 1 ? "" : "s"} at-risk.`
    );
  } else if (facts.maxConsecutiveConclusiveNegatives > 0) {
    reasons.push(
      `The consecutive conclusive-negative streak is ${facts.maxConsecutiveConclusiveNegatives}, which has not yet reached the at-risk threshold.`
    );
  } else if (facts.assignmentCount === 0) {
    reasons.push("The provider has no assignments, so it has no verification track record yet.");
  } else {
    reasons.push(
      `No assignment is flagged at-risk, and ${facts.confirmedCount} of ${facts.assignmentCount} are confirmed.`
    );
  }

  if (facts.reputationScore !== null) {
    reasons.push(`Reputation score is ${facts.reputationScore}/100.`);
  }
  if (facts.uptimePercent !== null) {
    reasons.push(`Reported uptime is ${facts.uptimePercent}%.`);
  }

  reasons.push(
    `Capacity available is ${Math.round(candidate.availableGb)} GB at ` +
      `${candidate.pricePerGbPerEpoch} SOL/GB/epoch.`
  );

  return reasons;
}

function buildUncertain(facts: CandidateFacts, sufficient: boolean): string[] {
  const uncertain: string[] = [];
  if (!sufficient) {
    uncertain.push("There is not enough evidence to judge this provider's reliability.");
  }
  if (facts.assignmentCount === 0) {
    uncertain.push("No assignment has been verified, so storage behaviour is unproven.");
  }
  // Rule 6: only the latest heartbeat is stored, so no claim about history.
  uncertain.push(
    "Only the latest heartbeat is stored, so a past outage would not be visible in this data."
  );
  return uncertain;
}

/**
 * Rank candidates deterministically.
 *
 * Pure and total: same inputs, same order, every time. Survivors of the hard
 * filters are ordered by `sufficientEvidence` first (a provider with evidence
 * always outranks one without, regardless of score), then score, then capacity,
 * then cheaper price, then provider id — so a tie is broken by data, never by
 * input order.
 */
export function rankCandidates(
  candidates: RecommendationCandidateInput[],
  query: RecommendationQuery,
  options: RankingOptions = {}
): RankingResult {
  const limit = Math.max(1, options.limit ?? DEFAULT_RECOMMENDATION_LIMIT);
  const reference =
    options.referencePricePerGbPerEpoch ?? DEFAULT_REFERENCE_PRICE_PER_GB_PER_EPOCH;

  const ranked: RankedCandidate[] = [];
  for (const candidate of candidates) {
    if (!passesHardFilters(candidate, query)) continue;

    const evidence = candidate.evidence;
    const facts = factsFrom(evidence);
    const sufficientEvidence = !isEvidenceInconclusive(evidence);
    const liveness = livenessScore(evidence);
    const verification = verificationScore(evidence);
    const quality = qualityScore(evidence);
    const reliabilityScore = round2(liveness + verification + quality);
    const price = priceScore(candidate.pricePerGbPerEpoch, reference);
    const availableGb = availableCapacityGb(candidate);
    const score = round2(reliabilityScore + price);

    ranked.push({
      providerId: evidence.provider.id,
      name: evidence.provider.name,
      region: evidence.provider.region,
      score,
      reliabilityScore,
      riskLevel: riskFromScore(sufficientEvidence, reliabilityScore),
      sufficientEvidence,
      availableGb,
      pricePerGbPerEpoch: candidate.pricePerGbPerEpoch,
      estimatedCostSol: round2(query.storageGb * query.durationEpochs * candidate.pricePerGbPerEpoch),
      reasons: buildReasons({
        facts,
        availableGb,
        pricePerGbPerEpoch: candidate.pricePerGbPerEpoch,
      }),
      uncertain: buildUncertain(facts, sufficientEvidence),
      facts,
    });
  }

  ranked.sort(
    (a, b) =>
      Number(b.sufficientEvidence) - Number(a.sufficientEvidence) ||
      b.score - a.score ||
      b.availableGb - a.availableGb ||
      a.pricePerGbPerEpoch - b.pricePerGbPerEpoch ||
      a.providerId - b.providerId
  );

  const top = ranked.slice(0, limit);

  return {
    ranked: top,
    consideredCount: candidates.length,
    filteredOut: candidates.length - ranked.length,
    allInsufficientEvidence: top.length > 0 && top.every((c) => !c.sufficientEvidence),
  };
}
