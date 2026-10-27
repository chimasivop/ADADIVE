/**
 * The agent function: evidence in, structured assessment out.
 *
 * `assessProvider` is total — it never throws. Every way the model can be
 * unusable collapses to an `unknown` assessment with an explicit reason:
 *
 *   - no client (misconfigured)               → unknown
 *   - transport / HTTP error from the API     → unknown
 *   - response content is not JSON            → unknown
 *   - JSON that does not match the Zod schema → unknown
 *
 * An inconclusive result is a legitimate outcome, not a failure: `unknown` is a
 * first-class risk level and carries the reason it was chosen. A caller can treat
 * every return value as a valid assessment.
 *
 * The assessment is advisory only. Nothing here signs, releases funds, or writes
 * to a deal.
 */

import { unknownAssessment, assessmentSchema, type Assessment } from "./schema";
import type { ReliabilityEvidence, ModelRequestPayload } from "./evidence";
import type { ModelClient } from "./metaClient";
import type { Logger } from "./logger";
import { silentLogger } from "./logger";
import { buildModelRequest } from "./prompt";

export interface AssessOptions {
  /** The model id to request. */
  model: string;
  /** The transport. `null` means "no model available" → always `unknown`. */
  client: ModelClient | null;
  logger?: Logger;
}

/** The assessment plus the exact payload sent, for auditability. */
export interface AssessResult {
  assessment: Assessment;
  request: ModelRequestPayload | null;
}

function parseAndValidate(content: string, logger: Logger): Assessment | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    logger.warn("model output was not valid JSON; returning unknown");
    return null;
  }

  const result = assessmentSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn("model output did not match the assessment schema; returning unknown", {
      issues: result.error.issues.map((i) => i.path.join(".") || "(root)"),
    });
    return null;
  }
  return result.data;
}

/**
 * Turn one provider's evidence into an assessment.
 *
 * Returns both the assessment and the request that produced it, so a caller can
 * show exactly what was sent. The request is `null` only when there was no client
 * to send it to.
 */
export async function assessProvider(
  evidence: ReliabilityEvidence,
  options: AssessOptions
): Promise<AssessResult> {
  const logger = options.logger ?? silentLogger;

  if (options.client === null) {
    return {
      assessment: unknownAssessment(
        "no model client is configured (set META_API_KEY, or run with META_MOCK=1)"
      ),
      request: null,
    };
  }

  const request = buildModelRequest(evidence, options.model);

  let content: string;
  try {
    content = await options.client.complete(request);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("model call failed; returning unknown", { error: detail });
    return {
      assessment: unknownAssessment(`the model call did not succeed: ${detail}`),
      request,
    };
  }

  const assessment = parseAndValidate(content, logger);
  if (assessment === null) {
    return {
      assessment: unknownAssessment(
        "the model returned output that could not be validated against the assessment schema"
      ),
      request,
    };
  }

  return { assessment, request };
}
