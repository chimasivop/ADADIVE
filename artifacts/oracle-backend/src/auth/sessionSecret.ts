/**
 * Session-secret custody.
 *
 * The session signing secret is what makes a session token unforgeable. It is a
 * *symmetric* key: whoever holds it can mint a token for any wallet, so it is
 * exactly as sensitive as the oracle key and is treated the same way — loaded
 * through a named provider, never committed, never defaulted, refused in
 * production when it comes from a development source.
 *
 * It is kept deliberately **separate** from the oracle key, in a different
 * environment variable and a different secret. Reusing one key for two purposes
 * means a compromise of either is a compromise of both, and it means the
 * production secret that signs settlements is also the secret that is read on
 * every authenticated request. Different secrets let each be rotated on its own
 * schedule.
 *
 * Three providers, mirroring `oracle/keyProvider.ts`:
 *
 *   SecretsManagerSessionSecretProvider — production. Resolves the secret from
 *                                         AWS Secrets Manager / Vault / GCP.
 *                                         The SDK call is the injected
 *                                         `fetchSecret`, left unwired here for
 *                                         the same reason as the oracle key's.
 *
 *   EnvSessionSecretProvider            — the orchestrator-injected shape
 *                                         (Kubernetes external-secrets, ECS
 *                                         secrets, Vault Agent).
 *
 *   LocalDevSessionSecretProvider       — development and tests only. Generates
 *                                         a random secret per process, so no
 *                                         key material exists on disk and every
 *                                         restart invalidates old sessions —
 *                                         which is the correct behaviour for a
 *                                         throwaway secret. Refused when
 *                                         NODE_ENV=production.
 */

import { randomBytes } from "node:crypto";

import type { AuthConfig, SessionSecretSource } from "../config";
import { ConfigError } from "../config";
import type { Logger } from "../logger";
import {
  SecretRegistry,
  SecretString,
  safeErrorMessage,
} from "../security/redact";
import { encodeBase58 } from "../security/base58";
import { parseSessionSecret } from "./sessionToken";

/**
 * A loaded session secret.
 *
 * Wrapped in a class rather than returned as bare bytes so it can carry its own
 * provenance for logging and so the bytes are only reachable via `reveal()` —
 * the same pattern as `OracleKeypair`, and for the same reason: `logger.info(
 * "secret", { secret })` must print `[redacted]`.
 */
export class SessionSecret {
  readonly #bytes: Uint8Array;
  readonly #source: string;

  constructor(bytes: Uint8Array, source: string) {
    this.#bytes = bytes;
    this.#source = source;
  }

  /** The raw key material. Greppable, so every use is reviewable. */
  reveal(): Uint8Array {
    return this.#bytes;
  }

  get source(): string {
    return this.#source;
  }

  toString(): string {
    return `SessionSecret(source=${this.#source}, length=${this.#bytes.length})`;
  }

  toJSON(): { source: string; length: number } {
    return { source: this.#source, length: this.#bytes.length };
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

export interface SessionSecretProvider {
  readonly description: string;
  readonly provisioningNote: string;
  load(registry: SecretRegistry): Promise<SessionSecret>;
}

/* ------------------------------------------------------------------ */
/* Production providers                                                */
/* ------------------------------------------------------------------ */

/**
 * The production path: the secret lives in an external secrets manager and is
 * fetched at startup over the manager's authenticated API.
 *
 * As with the oracle key, the SDK call is an injected function so this repo
 * takes no dependency on any one cloud's SDK and the fetch can be stubbed in
 * tests. A real deployment supplies, for AWS Secrets Manager:
 *
 *   import { SecretsManagerClient, GetSecretValueCommand }
 *     from "@aws-sdk/client-secrets-manager";
 *   const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
 *   const fetchSecret = async (id) => {
 *     const res = await client.send(new GetSecretValueCommand({ SecretId: id }));
 *     return res.SecretString ?? null;   // never logged
 *   };
 *
 * Generate the value with at least 32 bytes of entropy, e.g.
 * `openssl rand -base64 48`. Rotating it invalidates every outstanding session,
 * which is the intended blast radius and requires no other coordination.
 */
export class SecretsManagerSessionSecretProvider implements SessionSecretProvider {
  constructor(
    private readonly secretId: string,
    private readonly fetchSecret: (secretId: string) => Promise<string | null>,
    private readonly logger: Logger
  ) {}

  get description(): string {
    return `secrets-manager:${this.secretId}`;
  }

  get provisioningNote(): string {
    return (
      "Provision the session signing secret as its own secret in AWS Secrets " +
      "Manager / HashiCorp Vault / GCP Secret Manager — separate from the " +
      "oracle key. Use at least 32 bytes of entropy (`openssl rand -base64 48`). " +
      "Grant this service read-only access. Rotating it invalidates all " +
      "outstanding sessions, which is the intended effect."
    );
  }

  async load(registry: SecretRegistry): Promise<SessionSecret> {
    let raw: string | null;
    try {
      raw = await this.fetchSecret(this.secretId);
    } catch (err) {
      // Some SDKs quote the value back on a validation failure, so the error
      // goes through the registry.
      throw new ConfigError(
        `failed to read session secret from secrets manager (${this.secretId}): ` +
          safeErrorMessage(err, registry)
      );
    }
    if (!raw) {
      throw new ConfigError(
        `secrets manager returned no value for ${this.secretId}`
      );
    }
    return new SessionSecret(
      registerSecret(parseSessionSecret(raw), registry),
      this.description
    );
  }
}

/**
 * The "orchestrator injects the value into the environment" shape — the
 * pragmatic first production deployment, as with the oracle key.
 */
export class EnvSessionSecretProvider implements SessionSecretProvider {
  constructor(private readonly secret: SecretString, private readonly logger: Logger) {}

  get description(): string {
    return "env:SESSION_SECRET";
  }

  get provisioningNote(): string {
    return (
      "Provide SESSION_SECRET via your orchestrator's secret injection " +
      "(Kubernetes external-secrets, ECS/Cloud Run secret refs, Vault Agent, " +
      "systemd credentials). Do not put it in a committed .env file. This must " +
      "be a different secret from the oracle key."
    );
  }

  async load(registry: SecretRegistry): Promise<SessionSecret> {
    return new SessionSecret(
      registerSecret(parseSessionSecret(this.secret.reveal()), registry),
      this.description
    );
  }
}

/* ------------------------------------------------------------------ */
/* Development provider                                                */
/* ------------------------------------------------------------------ */

/**
 * Development and test only.
 *
 * Generates a fresh random secret per process. There is deliberately no file
 * mode: a session secret that persists across restarts in dev is a secret
 * somebody eventually copies into a shared config, and nothing is gained by
 * keeping sessions alive. Every restart invalidating dev sessions is correct.
 */
export class LocalDevSessionSecretProvider implements SessionSecretProvider {
  constructor(private readonly logger: Logger) {}

  get description(): string {
    return "local-dev-ephemeral";
  }

  get provisioningNote(): string {
    return (
      "DEVELOPMENT ONLY. Generates a random session secret per process, so " +
      "sessions do not survive a restart and no key material touches disk. " +
      "Set SESSION_SECRET_SOURCE=secrets-manager or env in production."
    );
  }

  async load(registry: SecretRegistry): Promise<SessionSecret> {
    this.logger.warn(
      "USING DEVELOPMENT SESSION SECRET — not for production; " +
        "set SESSION_SECRET_SOURCE to secrets-manager or env",
      { source: this.description }
    );
    const generated = randomBytes(48);
    return new SessionSecret(registerSecret(generated, registry), this.description);
  }
}

/**
 * Register the secret's encoded forms so it cannot reach a log or a response.
 *
 * A symmetric key has no public half, so every encoding is sensitive. The
 * literal string form is registered by `parseSessionSecret`'s callers via the
 * registry in `load`, and the base58 form here covers a value that a Solana SDK
 * error might quote back.
 */
function registerSecret(bytes: Uint8Array, registry: SecretRegistry): Uint8Array {
  registry.register(bytes);
  registry.register(encodeBase58(bytes));
  return bytes;
}

/**
 * Pick a provider from configuration.
 *
 * The single place the environment decides which custody model is in force, so
 * everything downstream sees a `SessionSecret` and cannot tell the difference.
 */
export function makeSessionSecretProvider(
  config: AuthConfig,
  logger: Logger,
  secretsManagerFetcher?: (secretId: string) => Promise<string | null>
): SessionSecretProvider {
  switch (config.sessionSecretSource) {
    case "secrets-manager":
      if (!config.sessionSecretId) {
        throw new ConfigError("SESSION_SECRET_ID is required");
      }
      return new SecretsManagerSessionSecretProvider(
        config.sessionSecretId,
        secretsManagerFetcher ??
          (() =>
            Promise.reject(
              new ConfigError(
                "no secrets-manager fetcher wired up: pass one to " +
                  "makeSessionSecretProvider (see " +
                  "SecretsManagerSessionSecretProvider docs) or set " +
                  "SESSION_SECRET_SOURCE=env with the manager injecting " +
                  "SESSION_SECRET"
              )
            )),
        logger
      );
    case "env":
      if (!config.envSecret) {
        throw new ConfigError("SESSION_SECRET is required");
      }
      return new EnvSessionSecretProvider(config.envSecret, logger);
    case "local-dev":
      return new LocalDevSessionSecretProvider(logger);
    default: {
      const exhaustive: never = config.sessionSecretSource;
      throw new ConfigError(`unknown session secret source: ${String(exhaustive)}`);
    }
  }
}

export type { SessionSecretSource };
