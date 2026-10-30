/**
 * The structured assessment contract, and the JSON Schema handed to the model.
 *
 * The advisor must return *this* shape or nothing: if the model's output does not
 * validate, the caller falls back to an `unknown` assessment (see `assess.ts`).
 * An inconclusive result is a legitimate answer, not a failure.
 *
 * The schema is sent to the Meta Model API as `response_format: { type:
 * "json_schema", … }` on `POST /chat/completions`, which constrains decoding so
 * the output conforms (https://dev.meta.ai/docs/structured-output). It is written
 * as a plain JSON Schema object here rather than derived from Zod, so the exact
 * bytes the model is constrained by are reviewable and stable, and so it does not
 * rely on any Zod→JSON-Schema feature. A test asserts the two stay in step.
 */

import { z } from "zod";

export const RISK_LEVELS = ["low", "medium", "high", "unknown"] as const;

export const assessmentSchema = z.object({
  risk_level: z.enum(RISK_LEVELS),
  reasons: z.array(z.string()),
  evidence_cited: z.array(z.string()),
  uncertain: z.array(z.string()),
  recommended_action: z.string(),
});

export type Assessment = z.infer<typeof assessmentSchema>;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * The JSON Schema given to the model. `additionalProperties: false` and a full
 * `required` list mean the model cannot omit a field or invent one.
 */
export const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    risk_level: {
      type: "string",
      enum: RISK_LEVELS,
      description:
        "Overall reliability risk. Use \"unknown\" when the evidence is " +
        "inconclusive or insufficient.",
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "Short reasons for the risk level, each tied to the evidence.",
    },
    evidence_cited: {
      type: "array",
      items: { type: "string" },
      description:
        "The specific evidence fields relied on, e.g. \"heartbeatAgeMs=540000\" " +
        "or \"assignment 12 atRisk=true\".",
    },
    uncertain: {
      type: "array",
      items: { type: "string" },
      description: "What the evidence does not settle, if anything.",
    },
    recommended_action: {
      type: "string",
      description:
        "A single advisory next step for a human. The advisor never acts.",
    },
  },
  required: ["risk_level", "reasons", "evidence_cited", "uncertain", "recommended_action"],
  additionalProperties: false,
} as const;

/**
 * The assessment returned when the model cannot be used or its output is
 * unusable. Risk is `unknown` and the reason is explicit — never a silent
 * failure, never a fabricated risk level.
 */
export function unknownAssessment(reason: string): Assessment {
  return {
    risk_level: "unknown",
    reasons: [reason],
    evidence_cited: [],
    uncertain: [reason],
    recommended_action:
      "Review the provider's heartbeat and verification evidence manually; the " +
      "automated assessment was inconclusive.",
  };
}
