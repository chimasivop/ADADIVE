/**
 * Provider-agent configuration, read once from the environment.
 *
 * The agent is a standalone process a storage provider runs next to their own
 * IPFS (Kubo) node. It talks to two existing services and owns no database:
 *
 *   - the **oracle backend** (`ORACLE_BASE_URL`) for the wallet-signature
 *     sign-in it reuses — `/auth/challenge`, `/auth/verify`.
 *   - the **api-server** (`API_BASE_URL`) for the provider storage endpoints —
 *     assignments, confirm-pin, heartbeat.
 *   - the **local Kubo node** (`IPFS_API_URL`) it pins to.
 *
 * Everything is overridable so the same binary runs against a local stack or a
 * deployed one.
 */

export interface AgentConfig {
  /** Oracle backend base URL — the only place a signature is verified. */
  oracleBaseUrl: string;
  /** api-server base URL, including its `/api` prefix. */
  apiBaseUrl: string;
  /** Kubo HTTP RPC API of the local IPFS node. */
  ipfsApiUrl: string;
  /** Path to the provider's Solana keypair (JSON array of secret-key bytes). */
  keypairPath: string;
  /** How often to poll for new assignments. */
  pollIntervalMs: number;
  /** How often to send a heartbeat. */
  heartbeatIntervalMs: number;
  /** Timeout for a single IPFS operation. */
  ipfsTimeoutMs: number;
  nodeEnv: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return Math.floor(parsed);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Build the config. `env` is injectable so tests and the CLI can construct one
 * without mutating the real process environment.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const keypairPath = env.PROVIDER_KEYPAIR_PATH ?? "";
  if (keypairPath.trim().length === 0) {
    // Without a keypair the agent cannot sign in, and every call would 401 —
    // better to refuse at startup than to spin a poll loop that never works.
    throw new ConfigError(
      "PROVIDER_KEYPAIR_PATH is required: the agent signs in with the provider " +
        "wallet's keypair (the same wallet-signature flow the browser uses)"
    );
  }

  return {
    oracleBaseUrl: stripTrailingSlash(env.ORACLE_BASE_URL ?? "http://127.0.0.1:5001"),
    apiBaseUrl: stripTrailingSlash(env.API_BASE_URL ?? "http://127.0.0.1:5000/api"),
    ipfsApiUrl: stripTrailingSlash(
      env.IPFS_API_URL ?? "http://127.0.0.1:5001/api/v0"
    ),
    keypairPath,
    pollIntervalMs: intFromEnv(env, "POLL_INTERVAL_MS", 15_000),
    heartbeatIntervalMs: intFromEnv(env, "HEARTBEAT_INTERVAL_MS", 30_000),
    ipfsTimeoutMs: intFromEnv(env, "IPFS_TIMEOUT_MS", 60_000),
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
