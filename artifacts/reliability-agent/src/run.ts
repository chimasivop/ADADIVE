/**
 * One assessment cycle, factored out of the CLI so it can be driven from tests
 * and from other code without touching `process.argv`.
 *
 * It fetches read-only evidence (or takes it directly), asks the advisor, and
 * returns the assessment. It writes nothing and mutates nothing.
 */

import { assessProvider, type AssessResult } from "./assess";
import type { AdvisorConfig } from "./config";
import type { ReliabilityEvidence } from "./evidence";
import { EvidenceClient } from "./evidenceClient";
import type { Logger } from "./logger";
import { HttpMetaClient, type ModelClient } from "./metaClient";
import { FixtureMetaClient } from "./mockClient";

export interface RunDeps {
  config: AdvisorConfig;
  logger: Logger;
  /** Inject a model client (tests). Defaults from config: mock or HTTP. */
  client?: ModelClient;
  /** Inject an evidence client (tests). Defaults from config. */
  evidenceClient?: Pick<EvidenceClient, "fetch">;
}

/**
 * Build the model client the config asks for.
 *
 * In mock mode this is the fixture client — no network, no key. Otherwise it is
 * the HTTP client, which the config has already guaranteed has a key (it refuses
 * to load without one outside mock mode).
 */
export function buildModelClient(config: AdvisorConfig, logger: Logger): ModelClient {
  if (config.mock) {
    logger.info("META_MOCK is on: replaying recorded fixtures, no network call");
    return new FixtureMetaClient({ logger });
  }
  return new HttpMetaClient({
    baseUrl: config.metaBaseUrl,
    apiKey: config.metaApiKey ?? "",
    timeoutMs: config.metaTimeoutMs,
    logger,
  });
}

/**
 * Fetch evidence for `providerId` unless the caller already has some.
 *
 * `evidence` is an escape hatch for offline use (the CLI's `--evidence <file>`),
 * so the advisor can be demonstrated without a running api-server.
 */
export async function runOnce(
  deps: RunDeps,
  providerId: number,
  evidence?: ReliabilityEvidence
): Promise<AssessResult> {
  const { config, logger } = deps;
  const client = deps.client ?? buildModelClient(config, logger);

  let resolved = evidence;
  if (resolved === undefined) {
    const evidenceClient =
      deps.evidenceClient ??
      new EvidenceClient({
        apiBaseUrl: config.apiBaseUrl,
        logger,
        internalApiToken: config.internalApiToken,
        sessionToken: config.sessionToken,
      });
    logger.info("fetching reliability evidence", {
      providerId,
      source: config.internalApiToken ? "internal" : "wallet",
    });
    resolved = await evidenceClient.fetch(providerId);
  }

  logger.info("assessing provider reliability", {
    providerId: resolved.provider.id,
    model: config.mock ? `mock:${config.metaModel}` : config.metaModel,
  });
  return assessProvider(resolved, { model: config.metaModel, client, logger });
}
