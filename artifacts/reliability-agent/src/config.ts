/**
 * Reliability-advisor configuration, read once from the environment.
 *
 * The advisor is a standalone process. It owns no database and mutates nothing:
 * it reads *read-only* provider evidence from the api-server and asks the Meta
 * Model API to summarise it. The only secret it holds is the Meta key.
 *
 * Endpoint, auth header, base URL and model id are the values the official Meta
 * Model API documentation gives (https://dev.meta.ai/docs):
 *
 *   - base URL  https://api.meta.ai/v1
 *   - auth      `Authorization: Bearer $MODEL_API_KEY`
 *   - model     muse-spark-1.3
 *   - endpoint  POST /chat/completions (OpenAI-compatible)
 *
 * Nothing here is guessed: if the docs could not be read this feature would not
 * be built. See HACKATHON.md.
 */

export interface AdvisorConfig {
  /**
   * When true the advisor never calls the network: it replays recorded fixture
   * responses. This is what lets the app run with no Meta key.
   */
  mock: boolean;
  /** Meta Model API base URL, without a trailing slash. */
  metaBaseUrl: string;
  /** Model id sent as `model` on each request. */
  metaModel: string;
  /** The Meta API key, or `null` in mock mode / when unset. */
  metaApiKey: string | null;
  /** Per-request timeout against the Meta API. */
  metaTimeoutMs: number;
  /** api-server base URL including its `/api` prefix. */
  apiBaseUrl: string;
  /** Bearer for the internal, token-guarded read-only evidence route. */
  internalApiToken: string | null;
  /** Bearer for the wallet-authenticated read-only evidence route. */
  sessionToken: string | null;
  /** Provider id to assess when the CLI is not given one. */
  providerId: number | null;
  nodeEnv: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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

/** `META_MOCK` is on for `1` or `true` (any case); anything else is off. */
export function isMockEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.META_MOCK ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Build the config. `env` is injectable so tests and the CLI can construct one
 * without mutating the real process environment.
 *
 * Fail-fast: outside mock mode a Meta key is *required*, because a live run
 * without one would 401 on every call. Refusing at startup is clearer than a
 * loop of failed requests.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdvisorConfig {
  const mock = isMockEnabled(env);
  const rawKey = (env.META_API_KEY ?? "").trim();
  const metaApiKey = rawKey.length > 0 ? rawKey : null;

  if (!mock && metaApiKey === null) {
    throw new ConfigError(
      "META_API_KEY is required unless META_MOCK=1. Set META_API_KEY (see " +
        ".env.example) to call the Meta Model API, or run with META_MOCK=1 to " +
        "replay recorded fixture responses without a key."
    );
  }

  const providerIdRaw = (env.PROVIDER_ID ?? "").trim();
  let providerId: number | null = null;
  if (providerIdRaw.length > 0) {
    const parsed = Number(providerIdRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ConfigError(`PROVIDER_ID must be a positive integer, got ${JSON.stringify(providerIdRaw)}`);
    }
    providerId = parsed;
  }

  return {
    mock,
    metaBaseUrl: stripTrailingSlash(env.META_BASE_URL ?? "https://api.meta.ai/v1"),
    metaModel: (env.META_MODEL ?? "muse-spark-1.3").trim() || "muse-spark-1.3",
    metaApiKey,
    metaTimeoutMs: intFromEnv(env, "META_TIMEOUT_MS", 30_000),
    apiBaseUrl: stripTrailingSlash(env.API_BASE_URL ?? "http://127.0.0.1:5000/api"),
    internalApiToken: (env.INTERNAL_API_TOKEN ?? "").trim() || null,
    sessionToken: (env.RELIABILITY_AGENT_TOKEN ?? "").trim() || null,
    providerId,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
