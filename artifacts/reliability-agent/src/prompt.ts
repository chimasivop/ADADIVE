/**
 * The single place the model request payload is assembled.
 *
 * Keeping it here is what makes the privacy rule checkable: the only user-role
 * content is `JSON.stringify(evidence)`, and the evidence carries provider status
 * data only. There is no place to smuggle a file, a key or a secret in, because
 * the function's only input is the evidence object.
 *
 * The system instruction pins the model to its advisory role: it may not suggest
 * releasing funds, signing, or changing a deal, because the advisor cannot do any
 * of those and saying so would misrepresent what the output means.
 */

import type { ReliabilityEvidence, ModelRequestPayload } from "./evidence";
import type { RankedCandidate, RecommendationQuery } from "./ranking";
import { ASSESSMENT_JSON_SCHEMA, RECOMMENDATION_JSON_SCHEMA } from "./schema";

/**
 * The mock-mode fixture the recommendation client replays.
 *
 * The recommendation path is a *different* request shape from the single-provider
 * assessment, so it needs its own recorded response rather than the
 * `healthy`/`flaky`/`no-node` set — replaying one of those would produce a
 * provider assessment the recommendation schema would (correctly) reject.
 */
export const RECOMMENDATION_FIXTURE_NAME = "recommendation";

export const SYSTEM_PROMPT = [
  "You are ADADIVE's provider reliability advisor. You receive read-only status",
  "evidence about one storage provider and return a structured risk assessment.",
  "",
  "You only advise. You never sign transactions, release funds, or change deals,",
  "and your recommended_action must be a human next step, never an action you",
  "take. Do not suggest releasing, refunding, or moving funds.",
  "",
  "Judge reliability from the evidence alone. Key signals:",
  "- heartbeatAgeMs and heartbeatStale: how long since the node last reported.",
  "  A never-reported heartbeat (heartbeatAgeMs null, heartbeatStale true) is a",
  "  strong signal.",
  "- atRisk and consecutiveConclusiveNegatives on assignments: the oracle's",
  "  verification state, where atRiskCount > 0 means the oracle has already",
  "  concluded the node is not serving the content.",
  "- noRegisteredNode: the provider has no storage node, so there is no node",
  "  liveness to judge.",
  "",
  "The evidence has no heartbeat *history*, only the latest timestamp and its age,",
  "so do not claim a pattern over time that the data does not show.",
  "",
  "Use risk_level \"unknown\" when the evidence is inconclusive or insufficient to",
  "choose low/medium/high. An inconclusive result is acceptable and expected.",
  "Cite the specific evidence you relied on in evidence_cited, and list what the",
  "evidence does not settle in uncertain.",
].join("\n");

/**
 * Build the request payload for one provider's evidence.
 *
 * `model` is the id the caller configured (default `muse-spark-1.3`, the id the
 * official docs use). The response format constrains decoding to
 * `ASSESSMENT_JSON_SCHEMA`.
 */
export function buildModelRequest(
  evidence: ReliabilityEvidence,
  model: string
): ModelRequestPayload {
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Assess this provider's reliability from the evidence below and " +
          "return the structured assessment.\n\n" +
          JSON.stringify(evidence, null, 2),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ProviderReliabilityAssessment",
        // `strict: true` makes the server validate the schema against the Meta
        // Model API's strict subset (docs: /docs/structured-output). The schema
        // already satisfies it — plain-object root, `additionalProperties:
        // false`, `required` listing every property — so a schema mistake is a
        // 400 at request time rather than a silently accepted request.
        strict: true,
        schema: ASSESSMENT_JSON_SCHEMA,
      },
    },
  };
}

// ── Recommendation explanations ─────────────────────────────────────────────

/**
 * The system instruction for the recommendation path.
 *
 * It pins the two properties the feature depends on: the order is already
 * decided, and the advisor only advises. The model is told, in the instruction
 * itself, that it may not reorder or add a provider — so even a model that tried
 * would be violating an explicit rule, not a hidden one. The schema enforces the
 * same thing structurally (there is no field to express an order).
 */
export const RECOMMENDATION_SYSTEM_PROMPT = [
  "You are ADADIVE's provider recommendation explainer. You receive a deal's",
  "requirements and a list of storage providers that a deterministic ranker has",
  "ALREADY ranked. You do not rank.",
  "",
  "For each candidate you are sent, write plain-language `reasons` (why it is a",
  "good or poor fit) and `uncertain` (what the facts do not settle). Key each entry",
  "by its `index`, exactly as given. Do not add a candidate, drop one, or suggest a",
  "different order: the order is fixed and your output cannot change it.",
  "",
  "You only advise. You never sign transactions, release funds, or change deals.",
  "Do not tell the customer that a provider is guaranteed to be reliable, and do not",
  "tell them which provider to pick — the customer chooses. Refer to each provider",
  "as \"this provider\" rather than naming a winner.",
  "",
  "Judge only from the facts given: heartbeat freshness, the verification streak and",
  "at-risk flag, reputation/uptime, capacity and price. A provider with",
  "`sufficientEvidence: false` (no node, no assignments) must be described as having",
  "not enough evidence — never as a good choice.",
  "",
  "The data carries only the latest heartbeat, not a history, so never claim a",
  "pattern over time. Keep reasons short and concrete, each tied to a fact.",
].join("\n");

/**
 * Build the request payload for a recommendation.
 *
 * `model` is the id the caller configured (default `muse-spark-1.3`). The
 * response format constrains decoding to `RECOMMENDATION_JSON_SCHEMA`.
 *
 * The only user-role content is `JSON.stringify(...)` of the deal requirements
 * and the already-ranked candidates, reduced to a named, status-only subset
 * (`CandidateFacts`) — so "no file contents, no wallet addresses, no secrets" is
 * a property of this one function. `recommendationPayload.test.ts` asserts it.
 */
export function buildRecommendationRequest(
  query: RecommendationQuery,
  ranked: RankedCandidate[],
  model: string
): ModelRequestPayload {
  const payload = {
    dealRequirements: {
      storageGb: query.storageGb,
      durationEpochs: query.durationEpochs,
      region: query.region,
    },
    // The ranker's decision, passed through so the model explains the same list
    // the customer will see. The prose (`reasons`/`uncertain`) is deliberately
    // omitted: the model is replacing it, not echoing it.
    candidates: ranked.map((candidate, index) => ({
      index,
      rank: index + 1,
      name: candidate.name,
      region: candidate.region,
      score: candidate.score,
      reliabilityScore: candidate.reliabilityScore,
      riskLevel: candidate.riskLevel,
      sufficientEvidence: candidate.sufficientEvidence,
      availableGb: candidate.availableGb,
      pricePerGbPerEpoch: candidate.pricePerGbPerEpoch,
      estimatedCostSol: candidate.estimatedCostSol,
      facts: candidate.facts,
    })),
  };

  return {
    model,
    messages: [
      { role: "system", content: RECOMMENDATION_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Write the reasons and uncertainties for each of these already-ranked " +
          "providers, keyed by index. Do not reorder them.\n\n" +
          JSON.stringify(payload, null, 2),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ProviderRecommendationExplanations",
        strict: true,
        schema: RECOMMENDATION_JSON_SCHEMA,
      },
    },
  };
}
