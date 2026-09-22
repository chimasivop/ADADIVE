/**
 * Backend configuration, read once from the environment.
 *
 * Everything the service needs is here and nothing is read from `process.env`
 * elsewhere, so there is a single place to audit for accidentally-defaulted
 * secrets. Note that no secret *value* is required at import time: the oracle
 * key and the Pinata credential are fetched through their own providers (see
 * `src/oracle/` and `src/pinata/`), which is what lets the service start and
 * report a precise provisioning error rather than crashing on a missing env var.
 */

import { SecretString } from "./security/redact";

/** Which source the oracle keypair comes from. */
export type OracleSecretSource =
  /** Production: an external secrets manager, addressed by id. */
  | "secrets-manager"
  /** Dev/CI: the manager's value injected into the environment. */
  | "env"
  /** Local only: a throwaway keypair file or an ephemeral generated key. */
  | "local-dev";

/** Which source the session signing secret comes from. */
export type SessionSecretSource = OracleSecretSource;

export interface AuthConfig {
  /** Whether wallet-signature auth is enforced on mutating routes. */
  required: boolean;
  /** Where the session signing secret comes from. */
  sessionSecretSource: SessionSecretSource;
  /** Secrets-manager identifier for the session secret (production). */
  sessionSecretId: string | null;
  /** Env-injected session secret (the orchestrator shape). */
  envSecret: SecretString | null;
  /**
   * Session token lifetime, in seconds.
   *
   * Short by design. A session token is a bearer credential; a few hours is
   * long enough for a human to register a deal and raise a dispute, and short
   * enough that a leaked token is not indefinitely useful.
   */
  sessionTtlSeconds: number;
  /**
   * Challenge lifetime, in seconds. Minutes, not hours: a challenge is a
   * one-time value a human is about to sign, so the window only needs to cover
   * "read the prompt and approve it in the wallet".
   */
  challengeTtlSeconds: number;
  /** `iss`/`aud` for issued session tokens. */
  issuer: string;
  audience: string;
  /**
   * Expected sign-in domain/URI, used in the challenge message and checked on
   * verify so a signature obtained for another origin is not accepted here.
   */
  domain: string;
  uri: string;
  /** CAIP-2 chain id embedded in the challenge (`solana:localnet`, …). */
  chainId: `solana:${string}`;
}

export interface PinataConfig {
  /** Pinata API base. Overridable so tests can point at a stub server. */
  apiBase: string;
  /**
   * Pinata JWT. Held as a `SecretString` so it cannot be logged. May be absent
   * in tests that never talk to Pinata.
   */
  jwt: SecretString | null;
  /**
   * Dedicated gateway host used for the retrievability half of verification.
   * When unset, verification trusts the pin-list result alone and says so in
   * its detail string — see `verifyPinStatus`.
   */
  gatewayUrl: string | null;
  timeoutMs: number;
}

export interface OracleKeyConfig {
  source: OracleSecretSource;
  /**
   * Secrets-manager identifier (e.g. an AWS Secrets Manager ARN or a Vault
   * path). Required when `source === "secrets-manager"`.
   */
  secretId: string | null;
  /**
   * Plaintext secret injected by the secrets manager into the environment.
   * Required when `source === "env"`.
   */
  envSecret: SecretString | null;
  /** Dev-only throwaway keypair file. */
  localKeypairPath: string | null;
}

export interface BackendConfig {
  port: number;
  databaseUrl: string;
  /** Default challenge window applied to new deals: 48 hours. */
  challengeWindowSeconds: number;
  /** How often the challenge-window job runs, in milliseconds. */
  jobIntervalMs: number;
  solanaRpcUrl: string;
  pinata: PinataConfig;
  oracle: OracleKeyConfig;
  /**
   * Dev/test only: a provider keypair the backend may sign with.
   *
   * This exists so the auto-settle path can be exercised end-to-end without a
   * browser. It is refused outright when `NODE_ENV=production`, because in
   * production the backend must never hold the provider's key — the provider
   * authorises settlement itself.
   */
  demoProviderKeypairPath: string | null;
  nodeEnv: string;
  auth: AuthConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const DEFAULT_CHALLENGE_WINDOW_SECONDS = 48 * 60 * 60; // 48 hours

/** Sign-in challenge lifetime. Five minutes: enough to approve in a wallet. */
export const DEFAULT_AUTH_CHALLENGE_TTL_SECONDS = 5 * 60;

/** Session token lifetime. One hour: bounded blast radius for a bearer token. */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;

/**
 * Minimum session-secret length, in bytes.
 *
 * 32 bytes = 256 bits, which is the security level of the HMAC-SHA256 it keys.
 * A shorter secret is the whole strength of the token, so this is enforced at
 * startup rather than left to a provider's default.
 */
export const MIN_SESSION_SECRET_BYTES = 32;

/**
 * Read a positive integer from the supplied environment.
 *
 * Takes `env` explicitly rather than reading `process.env`, so that
 * `loadConfig(injectedEnv)` actually depends only on `injectedEnv`. Reading the
 * process environment from inside a helper would make an injected configuration
 * silently inherit real surroundings, which defeats the injection and is exactly
 * the kind of cross-talk that makes a startup guard look tested when it is not.
 */
function intFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return Math.floor(parsed);
}

function optional(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  return raw === undefined || raw === "" ? null : raw;
}

/**
 * Build the config from the environment.
 *
 * `env` is injectable so tests can construct configurations without touching
 * the real process environment (and, more importantly, without *mutating* it —
 * a test that set `NODE_ENV=production` globally would leak into other tests).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const nodeEnv = env.NODE_ENV ?? "development";

  const databaseUrl =
    env.DATABASE_URL ??
    // A local default is fine for dev; production sets DATABASE_URL.
    "postgres://postgres@127.0.0.1:5432/adadive_oracle";

  if (nodeEnv === "production") {
    const missing: string[] = [];
    if (!env.DATABASE_URL) missing.push("DATABASE_URL");
    if (!env.PINATA_JWT) missing.push("PINATA_JWT");
    if (missing.length > 0) {
      throw new ConfigError(
        `refusing to start in production without: ${missing.join(", ")}`
      );
    }
  }

  const source = (env.ORACLE_SECRET_SOURCE ?? "local-dev") as OracleSecretSource;
  if (!["secrets-manager", "env", "local-dev"].includes(source)) {
    throw new ConfigError(
      `ORACLE_SECRET_SOURCE must be one of secrets-manager|env|local-dev, got ${JSON.stringify(source)}`
    );
  }

  const secretId = optional(env, "ORACLE_KEYPAIR_SECRET_ID");
  const rawEnvSecret = optional(env, "ORACLE_KEYPAIR_SECRET");
  const localKeypairPath = optional(env, "DEV_ORACLE_KEYPAIR_PATH");

  // Validate the source's own prerequisites here, at startup, rather than at
  // the first settle attempt an hour into the challenge window. A missing key
  // discovered at window-close time means a deal that should have settled
  // silently does not.
  if (source === "secrets-manager" && !secretId) {
    throw new ConfigError(
      "ORACLE_SECRET_SOURCE=secrets-manager requires ORACLE_KEYPAIR_SECRET_ID " +
        "(e.g. an AWS Secrets Manager ARN)"
    );
  }
  if (source === "env" && !rawEnvSecret) {
    throw new ConfigError(
      "ORACLE_SECRET_SOURCE=env requires ORACLE_KEYPAIR_SECRET to be injected " +
        "(in production this value comes from the secrets manager, not from a file)"
    );
  }
  if (source === "local-dev" && nodeEnv === "production") {
    throw new ConfigError(
      "ORACLE_SECRET_SOURCE=local-dev is a development stub and is refused " +
        "when NODE_ENV=production; set ORACLE_SECRET_SOURCE=secrets-manager"
    );
  }

  return {
    port: intFromEnv(env, "PORT", 4000),
    databaseUrl,
    challengeWindowSeconds: intFromEnv(
      env,
      "CHALLENGE_WINDOW_SECONDS",
      DEFAULT_CHALLENGE_WINDOW_SECONDS
    ),
    jobIntervalMs: intFromEnv(env, "JOB_INTERVAL_MS", 15_000),
    solanaRpcUrl: env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
    pinata: {
      apiBase: env.PINATA_API_BASE ?? "https://api.pinata.cloud",
      jwt: env.PINATA_JWT ? new SecretString(env.PINATA_JWT) : null,
      gatewayUrl: optional(env, "PINATA_GATEWAY"),
      timeoutMs: intFromEnv(env, "PINATA_TIMEOUT_MS", 10_000),
    },
    oracle: {
      source,
      secretId,
      envSecret: rawEnvSecret ? new SecretString(rawEnvSecret) : null,
      localKeypairPath,
    },
    demoProviderKeypairPath:
      nodeEnv === "production" ? null : optional(env, "DEMO_PROVIDER_KEYPAIR_PATH"),
    nodeEnv,
    auth: loadAuthConfig(env, nodeEnv),
  };
}

/**
 * Build the auth configuration, with the same startup-time rigour as the oracle
 * key: a misconfigured session secret is a startup failure, not a 500 on the
 * first sign-in attempt hours later.
 *
 * The production guard is the important part. `local-dev` session secrets are
 * per-process random, so in production they would be both unavailable across
 * replicas (a token minted by one instance would fail on another) and silently
 * insecure. Refusing to start is the only safe answer.
 */
function loadAuthConfig(env: NodeJS.ProcessEnv, nodeEnv: string): AuthConfig {
  const sessionSecretSource = (env.SESSION_SECRET_SOURCE ??
    "local-dev") as SessionSecretSource;
  if (!["secrets-manager", "env", "local-dev"].includes(sessionSecretSource)) {
    throw new ConfigError(
      `SESSION_SECRET_SOURCE must be one of secrets-manager|env|local-dev, ` +
        `got ${JSON.stringify(sessionSecretSource)}`
    );
  }

  const sessionSecretId = optional(env, "SESSION_SECRET_ID");
  const rawEnvSecret = optional(env, "SESSION_SECRET");

  if (sessionSecretSource === "secrets-manager" && !sessionSecretId) {
    throw new ConfigError(
      "SESSION_SECRET_SOURCE=secrets-manager requires SESSION_SECRET_ID " +
        "(e.g. an AWS Secrets Manager ARN)"
    );
  }
  if (sessionSecretSource === "env" && !rawEnvSecret) {
    throw new ConfigError(
      "SESSION_SECRET_SOURCE=env requires SESSION_SECRET to be injected " +
        "(in production this value comes from the secrets manager, not from a file)"
    );
  }
  if (sessionSecretSource === "local-dev" && nodeEnv === "production") {
    throw new ConfigError(
      "SESSION_SECRET_SOURCE=local-dev generates a per-process secret and is " +
        "refused when NODE_ENV=production; set SESSION_SECRET_SOURCE=secrets-manager"
    );
  }

  // Length is checked here for the `env` source, where the value is in hand.
  // The secrets-manager source is checked in its provider once fetched.
  if (rawEnvSecret !== undefined && rawEnvSecret !== null) {
    const bytes = new TextEncoder().encode(rawEnvSecret);
    if (bytes.length < MIN_SESSION_SECRET_BYTES) {
      throw new ConfigError(
        `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_BYTES} bytes ` +
          `(got ${bytes.length}); generate one with \`openssl rand -base64 48\``
      );
    }
  }

  const domain = env.AUTH_DOMAIN ?? "localhost";
  const uri = env.AUTH_URI ?? "http://localhost";
  const issuer = env.AUTH_ISSUER ?? "adadive-oracle-backend";
  const audience = env.AUTH_AUDIENCE ?? "adadive-api";

  const required = env.AUTH_REQUIRED ? env.AUTH_REQUIRED !== "false" : true;
  if (!required && nodeEnv === "production") {
    // Turning auth off in production would re-open exactly the gap this phase
    // closes: unauthenticated callers opening challenge windows and raising
    // disputes on other people's deals.
    throw new ConfigError(
      "AUTH_REQUIRED=false is refused when NODE_ENV=production; wallet-signature " +
        "authentication may only be disabled in development and tests"
    );
  }

  return {
    // Enforced on by default. A deployment that wants the development posture
    // must say so explicitly, rather than getting no auth by forgetting a flag.
    required,
    sessionSecretSource,
    sessionSecretId,
    envSecret: rawEnvSecret ? new SecretString(rawEnvSecret) : null,
    sessionTtlSeconds: intFromEnv(
      env,
      "SESSION_TTL_SECONDS",
      DEFAULT_SESSION_TTL_SECONDS
    ),
    challengeTtlSeconds: intFromEnv(
      env,
      "AUTH_CHALLENGE_TTL_SECONDS",
      DEFAULT_AUTH_CHALLENGE_TTL_SECONDS
    ),
    issuer,
    audience,
    domain,
    uri,
    chainId: (env.SOLANA_CHAIN_ID ?? "solana:localnet") as `solana:${string}`,
  };
}
