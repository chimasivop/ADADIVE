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
import { ASSESSMENT_JSON_SCHEMA } from "./schema";

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
