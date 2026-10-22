/**
 * Composition root.
 *
 * Wires config → providers → repositories → service → HTTP, and starts the two
 * long-lived things (the HTTP listener and the challenge-window scheduler).
 * Nothing below this file reads `process.env` or constructs its own
 * dependencies, which is what keeps the service testable: the tests build the
 * same object graph with fakes at the leaves.
 *
 * Startup order is deliberate:
 *
 *   1. Load config. Fails fast on a missing production secret rather than at
 *      the first settle attempt.
 *   2. Load the oracle key. If this fails, refuse to start — a service that
 *      accepts settle requests it can never honour is worse than one that is
 *      visibly down.
 *   3. Run migrations. The service owns its schema; there is no separate
 *      migration step to forget.
 *   4. Start serving, then start the scheduler.
 */

import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";

import { loadConfig, type BackendConfig } from "./config";
import { createPool } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { DealRepository, DisputeRepository } from "./db/repository";
import { createLogger, type Logger } from "./logger";
import { PinataClient } from "./pinata/pinStatus";
import { makeOracleKeyProvider } from "./oracle/keyProvider";
import { OracleService } from "./service/oracleService";
import { SolanaEscrowChain } from "./chain/escrowChain";
import { ChallengeWindowScheduler } from "./jobs/challengeWindowScheduler";
import { createApp } from "./http/server";
import { AuthService } from "./auth/authService";
import { AuthChallengeRepository } from "./db/authChallengeRepository";
import { makeSessionSecretProvider } from "./auth/sessionSecret";
import { KuboFindProvsClient } from "./ipfs/findprovs";
import { InternalProviderFeed } from "./provider/internalFeed";
import { ProviderVerificationService } from "./provider/providerVerificationService";
import { ProviderVerificationScheduler } from "./jobs/providerVerificationScheduler";
import { SecretRegistry, safeErrorMessage } from "./security/redact";
import { isMainModule } from "./util/isMainModule";

export interface BuiltService {
  config: BackendConfig;
  app: ReturnType<typeof createApp>;
  scheduler: ChallengeWindowScheduler;
  /** Present only when provider verification is enabled in config. */
  providerScheduler: ProviderVerificationScheduler | null;
  pool: ReturnType<typeof createPool>;
  shutdown: () => Promise<void>;
}

export async function buildService(
  config: BackendConfig = loadConfig()
): Promise<BuiltService> {
  // The registry is created first: it is passed to everything that might log or
  // return text, so a secret can be registered the moment it is decoded.
  const registry = new SecretRegistry();
  const logger: Logger = createLogger(
    config.nodeEnv === "production" ? "info" : "debug",
    registry
  );

  const pool = createPool(config.databaseUrl);

  // Fail fast on an unavailable database: a service that starts and then cannot
  // answer any request is harder to diagnose than one that refuses to start.
  await pool.query("SELECT 1");

  const migrations = await runMigrations(pool);
  for (const m of migrations.filter((m) => m.applied)) {
    logger.info("applied migration", { name: m.name });
  }

  const oracleProvider = makeOracleKeyProvider(config.oracle, logger);
  logger.info("oracle key provisioning", {
    source: oracleProvider.description,
    note: oracleProvider.provisioningNote,
  });
  const oracle = await oracleProvider.load(registry);

  const pinata = new PinataClient({
    apiBase: config.pinata.apiBase,
    // The `SecretString` is unwrapped exactly once, here, and never stored in
    // plain form anywhere else.
    jwt: config.pinata.jwt ? config.pinata.jwt.reveal() : null,
    gatewayUrl: config.pinata.gatewayUrl,
    timeoutMs: config.pinata.timeoutMs,
    logger,
    registry,
  });
  if (config.pinata.jwt) registry.register(config.pinata.jwt.reveal());

  const deals = new DealRepository(pool);
  const disputes = new DisputeRepository(pool);

  const chain = new SolanaEscrowChain(
    new Connection(config.solanaRpcUrl, "confirmed"),
    logger,
    registry
  );

  const demoProvider = loadDemoProvider(config, registry, logger);

  const service = new OracleService({
    deals,
    disputes,
    verifyPin: (cid) => pinata.verifyPinStatus(cid),
    chain,
    oracle,
    logger,
    registry,
    providerSignatureStrategy:
      demoProvider !== null ? "demo-keypair" : "durable-nonce",
    demoProvider,
  });

  const scheduler = new ChallengeWindowScheduler({
    runJob: () => service.runChallengeWindowJob(),
    intervalMs: config.jobIntervalMs,
    logger,
    registry,
  });

  // Session-secret custody, mirroring the oracle key: a named provider, its own
  // secret, refused in production when it comes from a development source. The
  // two secrets are deliberately distinct — see `auth/sessionSecret.ts`.
  const sessionSecretProvider = makeSessionSecretProvider(config.auth, logger);
  logger.info("session secret provisioning", {
    source: sessionSecretProvider.description,
    note: sessionSecretProvider.provisioningNote,
  });
  const sessionSecret = await sessionSecretProvider.load(registry);

  const auth = new AuthService({
    challenges: new AuthChallengeRepository(pool),
    sessionSecret,
    config: config.auth,
    logger,
    registry,
  });

  const app = createApp({
    deals,
    disputes,
    service,
    oracle,
    logger,
    registry,
    defaultChallengeWindowSeconds: config.challengeWindowSeconds,
    runJob: () => service.runChallengeWindowJob(),
    auth,
    // Wallet-signature auth is enforced by default (see `loadConfig`). A
    // deployment that sets AUTH_REQUIRED=false gets the development posture,
    // which config refuses to allow in production.
    requireAuth: config.auth.required,
  });

  // Provider-node verification is additive and off by default. When on, it reads
  // the api-server's internal provider feed over HTTP (the two services keep
  // separate databases) and sweeps assigned nodes via DHT findprovs. Deals with
  // no provider node are absent from that feed and keep the Pinata path.
  let providerScheduler: ProviderVerificationScheduler | null = null;
  if (config.providerVerification.enabled) {
    const token = config.providerVerification.internalApiToken!.reveal();
    registry.register(config.providerVerification.internalApiToken!.reveal());
    const feed = new InternalProviderFeed({
      baseUrl: config.providerVerification.apiServerBaseUrl,
      token,
      timeoutMs: config.providerVerification.timeoutMs,
      logger,
      registry,
    });
    const findProvs = new KuboFindProvsClient({
      apiUrl: config.providerVerification.ipfsApiUrl,
      timeoutMs: config.providerVerification.timeoutMs,
      numProviders: config.providerVerification.numProviders,
      logger,
      registry,
    });
    const providerVerification = new ProviderVerificationService({
      feed,
      findProvs,
      logger,
      registry,
      heartbeatStaleMs: config.providerVerification.heartbeatStaleMs,
      consecutiveNegatives: config.providerVerification.consecutiveNegatives,
    });
    providerScheduler = new ProviderVerificationScheduler({
      runJob: () => providerVerification.runOnce(),
      intervalMs: config.providerVerification.intervalMs,
      logger,
      registry,
    });
    logger.info("provider verification enabled", {
      ipfsApiUrl: config.providerVerification.ipfsApiUrl,
      apiServerBaseUrl: config.providerVerification.apiServerBaseUrl,
      intervalMs: config.providerVerification.intervalMs,
    });
  }

  return {
    config,
    app,
    scheduler,
    providerScheduler,
    pool,
    shutdown: async () => {
      scheduler.stop();
      providerScheduler?.stop();
      await pool.end();
    },
  };
}

/**
 * Load the development-only provider keypair.
 *
 * Refused in production by `loadConfig` (which nulls it out), so this can only
 * ever run in dev/test. The warning is loud because this key signing a real
 * settle is the one thing that would make the prototype's convenience a real
 * problem: in production the provider authorises settlement, not the backend.
 */
function loadDemoProvider(
  config: BackendConfig,
  registry: SecretRegistry,
  logger: Logger
): Keypair | null {
  if (!config.demoProviderKeypairPath) return null;
  try {
    const raw = readFileSync(config.demoProviderKeypairPath, "utf8");
    const keypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(raw) as number[])
    );
    registry.register(keypair.secretKey);
    logger.warn(
      "loaded DEMO provider keypair — the backend will sign as the provider; " +
        "DEVELOPMENT ONLY, never configure this in production",
      { publicKey: keypair.publicKey.toBase58() }
    );
    return keypair;
  } catch (err) {
    throw new Error(
      `could not read demo provider keypair at ${config.demoProviderKeypairPath}: ` +
        safeErrorMessage(err, registry)
    );
  }
}

async function main() {
  const built = await buildService();
  const { config, app, scheduler, providerScheduler, shutdown } = built;

  const server = app.listen(config.port, () => {
    // Intentionally no secret in this line; the oracle's public key is printed
    // by its own logger call in `buildService`.
    process.stdout.write(
      `oracle backend listening on :${config.port} (challenge window ${config.challengeWindowSeconds}s)\n`
    );
  });

  scheduler.start();
  providerScheduler?.start();

  const stop = async () => {
    server.close();
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

if (isMainModule("index")) {
  main().catch((err) => {
    // No logger yet if config failed, so this is the one place a raw message is
    // printed; `loadConfig` never includes a secret value in its errors.
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
