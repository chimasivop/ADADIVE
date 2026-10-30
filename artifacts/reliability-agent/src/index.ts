/**
 * CLI entry point.
 *
 *   PROVIDER_ID=3 META_MOCK=1 pnpm --filter @workspace/reliability-agent assess
 *   PROVIDER_ID=3 META_API_KEY=… INTERNAL_API_TOKEN=… pnpm … assess
 *   pnpm … assess -- --evidence ./evidence.json   # no api-server needed
 *
 * It prints the assessment as JSON to stdout and exits 0 for any valid
 * assessment — including `unknown`, because an inconclusive result is not a
 * failure. It exits non-zero only when the evidence could not be fetched at all,
 * which is an operational error, not an assessment.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadConfig, ConfigError } from "./config";
import type { ReliabilityEvidence } from "./evidence";
import { EvidenceError } from "./evidenceClient";
import { createLogger } from "./logger";
import { runOnce } from "./run";

function parseArgs(argv: string[]): { providerId: number | null; evidencePath: string | null } {
  let providerId: number | null = null;
  let evidencePath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider" || arg === "-p") {
      providerId = Number(argv[++i]);
    } else if (arg.startsWith("--provider=")) {
      providerId = Number(arg.slice("--provider=".length));
    } else if (arg === "--evidence" || arg === "-e") {
      evidencePath = argv[++i] ?? null;
    } else if (arg.startsWith("--evidence=")) {
      evidencePath = arg.slice("--evidence=".length);
    }
  }
  return { providerId, evidencePath };
}

async function main(): Promise<number> {
  const logger = createLogger(process.env.LOG_LEVEL === "debug" ? "debug" : "info");

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error("configuration error", { error: err.message });
      return 2;
    }
    throw err;
  }

  const { providerId: argProviderId, evidencePath } = parseArgs(process.argv.slice(2));
  const providerId = argProviderId ?? config.providerId;

  let evidence: ReliabilityEvidence | undefined;
  if (evidencePath) {
    try {
      evidence = JSON.parse(await readFile(resolve(evidencePath), "utf8")) as ReliabilityEvidence;
    } catch (err) {
      logger.error("could not read evidence file", {
        path: evidencePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return 2;
    }
  }

  if (evidence === undefined && (providerId === null || !Number.isInteger(providerId))) {
    logger.error("no provider id: pass --provider <id>, set PROVIDER_ID, or use --evidence <file>");
    return 2;
  }

  let result;
  try {
    result = await runOnce({ config, logger }, providerId as number, evidence);
  } catch (err) {
    if (err instanceof EvidenceError) {
      logger.error("could not fetch reliability evidence", { error: err.message });
      return 1;
    }
    logger.error("unexpected error", { error: err instanceof Error ? err.message : String(err) });
    return 1;
  }

  // The assessment is the machine-readable output; the request is omitted from
  // stdout (it may be large) and is only logged at debug level.
  process.stdout.write(JSON.stringify(result.assessment, null, 2) + "\n");
  if (result.request) logger.debug("request sent", { payload: result.request });
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
