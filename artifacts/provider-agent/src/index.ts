/**
 * Provider-agent entry point.
 *
 * Composition root: config → keypair → session → api/ipfs clients → poller and
 * heartbeat. Nothing below reads `process.env` directly, so the whole graph can
 * be built with fakes in tests.
 *
 * `--once` runs a single poll cycle (and one heartbeat) and exits, which is what
 * an operator uses to verify the setup before leaving it running, and what a
 * cron-driven deployment would invoke.
 */

import { loadConfig, type AgentConfig } from "./config";
import { createLogger } from "./logger";
import { loadKeypair, WalletSession } from "./auth";
import { createKuboClient, type IpfsNode } from "./ipfs";
import { ProviderApi } from "./api";
import { AssignmentPoller } from "./poller";
import { Heartbeat } from "./heartbeat";

export interface Agent {
  poller: AssignmentPoller;
  heartbeat: Heartbeat;
  stop: () => void;
}

/** Build the agent's object graph without starting any timers. */
export async function buildAgent(
  config: AgentConfig = loadConfig()
): Promise<Agent> {
  const logger = createLogger(config.nodeEnv === "production" ? "info" : "debug");

  const keypair = loadKeypair(config.keypairPath);
  logger.info("provider agent starting", {
    wallet: keypair.publicKey.toBase58(),
    api: config.apiBaseUrl,
    oracle: config.oracleBaseUrl,
    ipfs: config.ipfsApiUrl,
  });

  const session = new WalletSession({
    oracleBaseUrl: config.oracleBaseUrl,
    wallet: keypair,
    logger,
  });

  const api = new ProviderApi({ apiBaseUrl: config.apiBaseUrl, session, logger });
  const ipfs: IpfsNode = await createKuboClient({
    apiUrl: config.ipfsApiUrl,
    timeoutMs: config.ipfsTimeoutMs,
    logger,
  });

  const poller = new AssignmentPoller({
    api,
    ipfs,
    logger,
    intervalMs: config.pollIntervalMs,
  });
  const heartbeat = new Heartbeat({
    api,
    ipfs,
    logger,
    intervalMs: config.heartbeatIntervalMs,
  });

  return {
    poller,
    heartbeat,
    stop: () => {
      poller.stop();
      heartbeat.stop();
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const agent = await buildAgent(config);
  const once = process.argv.includes("--once");

  if (once) {
    await agent.heartbeat.runOnce();
    const result = await agent.poller.runOnce();
    process.stdout.write(`poll complete: ${JSON.stringify(result)}\n`);
    return;
  }

  agent.heartbeat.start();
  agent.poller.start();

  const shutdown = () => {
    agent.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // No logger may exist yet if config failed, so this is the one raw print.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
