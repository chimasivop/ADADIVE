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
 * Reject a config where two of the three configured endpoints share an origin.
 *
 * Same host *and* same port means the same process is answering both, which is
 * never what the agent wants: it signs in to the oracle and pins through Kubo,
 * and those are different daemons. A shared origin silently misroutes one of
 * them, so this is a startup error naming both variables.
 */
function assertDistinctOrigins(entries: Array<{ name: string; url: string }>): void {
  const seen = new Map<string, string>();
  for (const { name, url } of entries) {
    let origin: string;
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
    } catch {
      throw new ConfigError(`${name} is not a valid URL: ${JSON.stringify(url)}`);
    }
    const previous = seen.get(origin);
    if (previous !== undefined) {
      throw new ConfigError(
        `${name} and ${previous} both resolve to ${origin}; the oracle and the ` +
          `IPFS (Kubo) node must be reachable on different origins. Point ` +
          `ORACLE_BASE_URL at the oracle and IPFS_API_URL at the node's HTTP RPC ` +
          `(Kubo defaults to http://127.0.0.1:5001/api/v0, so give the oracle a ` +
          `different port)`
      );
    }
    seen.set(origin, name);
  }
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

  const oracleBaseUrl = stripTrailingSlash(
    env.ORACLE_BASE_URL ?? "http://127.0.0.1:5001"
  );
  const apiBaseUrl = stripTrailingSlash(env.API_BASE_URL ?? "http://127.0.0.1:5000/api");
  const ipfsApiUrl = stripTrailingSlash(
    env.IPFS_API_URL ?? "http://127.0.0.1:5001/api/v0"
  );

  // The three services must be reachable on distinct origins. The trap is that
  // the oracle's default port (5001) is also Kubo's default: with only
  // `PROVIDER_KEYPAIR_PATH` set, sign-in and `pin.add` would both go to
  // `127.0.0.1:5001` — one of them to the wrong process. Whichever daemon does
  // not own the port makes the default `--once` cycle fail, and the failure
  // looks like a Kubo/oracle bug rather than a config one. `scripts/dev-up.sh`
  // hits the same wall (it runs the oracle on 5001) and documents moving Kubo.
  // Refuse at startup and say which variable to change, rather than spin a loop
  // that can never sign in.
  assertDistinctOrigins([
    { name: "ORACLE_BASE_URL", url: oracleBaseUrl },
    { name: "API_BASE_URL", url: apiBaseUrl },
    { name: "IPFS_API_URL", url: ipfsApiUrl },
  ]);

  return {
    oracleBaseUrl,
    apiBaseUrl,
    ipfsApiUrl,
    keypairPath,
    pollIntervalMs: intFromEnv(env, "POLL_INTERVAL_MS", 15_000),
    heartbeatIntervalMs: intFromEnv(env, "HEARTBEAT_INTERVAL_MS", 30_000),
    ipfsTimeoutMs: intFromEnv(env, "IPFS_TIMEOUT_MS", 60_000),
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
