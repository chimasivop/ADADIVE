/**
 * MOCK mode: a `ModelClient` that replays recorded fixture responses.
 *
 * With `META_MOCK=1` the advisor never touches the network and needs no Meta
 * key, so the app runs end to end without a key. Crucially it is not a shortcut
 * around the real path: the fixture is a *recorded chat-completion response*, and
 * this client runs it through the same `extractAssistantContent` the HTTP client
 * uses, returning the assistant `content` string. The caller then parses and
 * validates that string exactly as it would a live one — so mock mode exercises
 * the parsing and the Zod validation, and an invalid fixture really fails over to
 * `unknown`.
 *
 * The fixture is chosen from the *evidence in the request payload*, parsed back
 * out of the user message. That keeps the `ModelClient` interface uniform (one
 * `complete(payload)` method) and means mock mode goes through the same
 * `buildModelRequest` serialisation as a live call.
 */

import type { ModelRequestPayload } from "./evidence";
import type { ReliabilityEvidence } from "./evidence";
import type { Logger } from "./logger";
import { extractAssistantContent, MetaApiError, type ModelClient } from "./metaClient";
import { assessProvider } from "./assess";
import type { Assessment } from "./schema";

import healthy from "./fixtures/healthy.json";
import flaky from "./fixtures/flaky.json";
import noNode from "./fixtures/no-node.json";
import invalid from "./fixtures/invalid.json";

/** The recorded responses, keyed by scenario. */
export const FIXTURES: Record<string, unknown> = {
  healthy,
  flaky,
  "no-node": noNode,
  invalid,
};

/**
 * Recover the evidence from a request payload's user message.
 *
 * `buildModelRequest` writes a fixed header line, a blank line, then the evidence
 * as pretty-printed JSON. The evidence is the substring from the first `{` to the
 * last `}`. Returns `null` when it cannot be recovered, in which case the caller
 * falls back to the `healthy` fixture.
 */
export function parseEvidenceFromPayload(
  payload: ModelRequestPayload
): ReliabilityEvidence | null {
  const user = payload.messages.find((m) => m.role === "user");
  if (!user) return null;
  const start = user.content.indexOf("{");
  const end = user.content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(user.content.slice(start, end + 1)) as ReliabilityEvidence;
  } catch {
    return null;
  }
}

/** Which fixture a given evidence most plausibly corresponds to. */
export function chooseFixtureName(evidence: ReliabilityEvidence | null): string {
  if (evidence === null) return "healthy";
  if (evidence.summary.noRegisteredNode) return "no-node";
  if (evidence.summary.atRiskCount > 0 || evidence.provider.heartbeatStale) return "flaky";
  return "healthy";
}

export interface FixtureMetaClientDeps {
  logger: Logger;
  /** Force a specific fixture (tests use `invalid` to prove the fail-safe). */
  fixtureName?: string;
}

export class FixtureMetaClient implements ModelClient {
  constructor(private readonly deps: FixtureMetaClientDeps) {}

  async complete(payload: ModelRequestPayload): Promise<string> {
    const evidence = parseEvidenceFromPayload(payload);
    const name = this.deps.fixtureName ?? chooseFixtureName(evidence);
    const fixture = FIXTURES[name];
    if (fixture === undefined) {
      throw new MetaApiError(`no recorded fixture named ${JSON.stringify(name)}`, 0);
    }
    const content = extractAssistantContent(fixture);
    if (content === null) {
      throw new MetaApiError(
        `fixture ${JSON.stringify(name)} has no assistant message content`,
        0
      );
    }
    this.deps.logger.debug("mock mode: replayed fixture", { fixture: name });
    return content;
  }
}

/**
 * Produce an assessment from a recorded fixture, with no network and no key.
 *
 * This runs the *same* `assessProvider` path a live call does — the fixture is a
 * recorded response, parsed and Zod-validated exactly like a real one — so it is
 * a genuine fallback and not a shortcut around validation. The api-server uses it
 * when the demo's live-call budget is spent: the caller gets a real assessment
 * (marked with the demo note by the route) rather than an error.
 */
export async function assessFromFixture(
  evidence: ReliabilityEvidence,
  model: string,
  logger: Logger
): Promise<Assessment> {
  const client = new FixtureMetaClient({ logger });
  const { assessment } = await assessProvider(evidence, { model, client, logger });
  return assessment;
}
