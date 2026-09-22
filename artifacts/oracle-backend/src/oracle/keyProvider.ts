/**
 * Oracle key custody.
 *
 * The oracle keypair is the asset this service exists to protect: whoever holds
 * it can authorise settlement of every deal the program points at it. The
 * design goal here is that "where the key comes from" is an explicit, named
 * decision made at startup, and that the development path is *visibly* a
 * different code path from the production one — not the same path with a
 * defaulted file path.
 *
 * Three providers, one interface:
 *
 *   SecretsManagerKeyProvider  — production. Resolves the key from an external
 *                                secrets manager (AWS Secrets Manager, Vault,
 *                                GCP Secret Manager). This file defines the
 *                                interface and the loading logic; the actual
 *                                SDK call is the one thing left to wire, marked
 *                                with a single `TODO` and a documented adapter
 *                                signature. It never touches the filesystem.
 *
 *   EnvKeyProvider             — the deployment shape most teams actually run
 *                                first: the secrets manager injects the value
 *                                into the process environment (Kubernetes
 *                                external-secrets, ECS secrets, Vault Agent,
 *                                systemd credentials). No SDK dependency, and
 *                                still not a file in the repo.
 *
 *   LocalDevKeyProvider        — development and tests *only*. Reads a
 *                                throwaway keypair from `keys/` or generates an
 *                                ephemeral one. Refused when NODE_ENV is
 *                                production, and loud about it.
 *
 * What is deliberately *not* here: a plaintext keypair committed to the repo, a
 * hardcoded key, or a "default" key used when configuration is missing. A
 * missing key is a startup failure with an actionable message.
 */

import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

import { decodeBase58 } from "../security/base58";

import type { OracleKeyConfig } from "../config";
import { ConfigError } from "../config";
import type { Logger } from "../logger";
import {
  SecretRegistry,
  SecretString,
  safeErrorMessage,
} from "../security/redact";

/**
 * A loaded oracle key, wrapped so the secret half cannot be logged.
 *
 * Call sites that need to sign use `.signer`, which is the underlying
 * `Keypair` — but they get it through a named getter on an object whose
 * `toString`/`toJSON`/inspect are redacted, so `logger.info("key", { key })`
 * prints `[redacted]` rather than 64 bytes of secret.
 */
export class OracleKeypair {
  readonly publicKey: Keypair["publicKey"];
  readonly #signer: Keypair;
  readonly #source: string;

  constructor(signer: Keypair, source: string) {
    this.#signer = signer;
    this.publicKey = signer.publicKey;
    this.#source = source;
  }

  /**
   * The raw signer.
   *
   * Named `signer` rather than exposed as a property so every use is greppable
   * and reviewable — this is the only handle that can sign as the oracle.
   */
  get signer(): Keypair {
    return this.#signer;
  }

  /** Human-readable provenance, safe to log ("env", "secrets-manager:arn:..." ). */
  get source(): string {
    return this.#source;
  }

  toString(): string {
    return `OracleKeypair(pubkey=${this.publicKey.toBase58()}, source=${this.#source})`;
  }

  toJSON(): { publicKey: string; source: string } {
    return { publicKey: this.publicKey.toBase58(), source: this.#source };
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

export interface OracleKeyProvider {
  /** Provenance label, safe to log. */
  readonly description: string;
  /** A human-readable statement of how this provider expects to be provisioned. */
  readonly provisioningNote: string;
  load(registry: SecretRegistry): Promise<OracleKeypair>;
}

/**
 * Parse a Solana secret key from any of the encodings a secrets manager might
 * hold it in, and register every representation with the redaction registry.
 *
 * Accepted:
 *   - JSON array of 64 bytes  — the `solana-keygen` file format, and what
 *                               people paste into secret managers
 *   - base58 string           — the wallet import format
 *   - base64 string
 *   - hex string
 *
 * Returns a 64-byte secret key. A 32-byte input is accepted as a seed, since
 * some managers hold the seed rather than the expanded key.
 */
export function parseOracleSecret(
  raw: string,
  registry: SecretRegistry,
  sourceLabel: string
): Keypair {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ConfigError(
      `oracle secret from ${sourceLabel} is empty`
    );
  }

  // Register the verbatim input first: whatever form the manager returned, it
  // must never appear in a log line.
  registry.register(trimmed);

  let bytes: Uint8Array | null = null;

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new ConfigError(
        `oracle secret from ${sourceLabel} looks like a JSON array but does not parse: ` +
          safeErrorMessage(err, registry)
      );
    }
    if (!Array.isArray(parsed) || !parsed.every((n) => Number.isInteger(n))) {
      throw new ConfigError(
        `oracle secret from ${sourceLabel} must be a JSON array of integers`
      );
    }
    bytes = Uint8Array.from(parsed as number[]);
  } else if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    bytes = Uint8Array.from(Buffer.from(trimmed, "hex"));
  } else {
    // Try base58 (the wallet format) then base64. Base58 is the more likely
    // intent for a Solana key, so it is tried first.
    const bs58 = decodeBase58(trimmed);
    if (bs58) {
      bytes = bs58;
    } else {
      try {
        bytes = Uint8Array.from(Buffer.from(trimmed, "base64"));
      } catch {
        bytes = null;
      }
    }
  }

  if (!bytes || bytes.length === 0) {
    throw new ConfigError(
      `oracle secret from ${sourceLabel} could not be decoded as JSON array, base58, hex or base64`
    );
  }

  // Register the decoded bytes in every encoding the registry knows, so a
  // derived form (a hex dump in a stack trace, a JSON array in a debug print)
  // is still scrubbed.
  registry.register(bytes);

  if (bytes.length === 32) {
    // A seed, not an expanded key.
    return Keypair.fromSeed(bytes);
  }
  if (bytes.length !== 64) {
    throw new ConfigError(
      `oracle secret from ${sourceLabel} must be 32 or 64 bytes, got ${bytes.length}`
    );
  }
  return Keypair.fromSecretKey(bytes);
}

/* ------------------------------------------------------------------ */
/* Production providers                                                */
/* ------------------------------------------------------------------ */

/**
 * The production path.
 *
 * The key lives in an external secrets manager and is fetched at startup over
 * the manager's authenticated API. Nothing is read from the filesystem and
 * nothing is read from a committed file.
 *
 * The one unimplemented piece is the SDK call, behind `fetchSecret`. It is left
 * as an injected function rather than an inline import so that:
 *
 *   - this repo does not take a dependency on any one cloud's SDK, and
 *   - the fetch can be stubbed in tests without a network or a cloud account.
 *
 * A real deployment supplies, for AWS Secrets Manager:
 *
 *   import { SecretsManagerClient, GetSecretValueCommand }
 *     from "@aws-sdk/client-secrets-manager";
 *   const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
 *   const fetchSecret = async (secretId) => {
 *     const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
 *     return res.SecretString ?? null;   // never logged
 *   };
 *
 * or, for Vault, a read of `secret/data/<path>` with the agent's token. Either
 * way the value is handed to `parseOracleSecret`, which registers it with the
 * redaction registry before it can reach a log line.
 */
export class SecretsManagerKeyProvider implements OracleKeyProvider {
  constructor(
    private readonly secretId: string,
    private readonly fetchSecret: (secretId: string) => Promise<string | null>,
    private readonly logger: Logger
  ) {}

  get description(): string {
    // The identifier is an ARN or a path: not a secret, and essential for
    // diagnosing "which secret is wrong".
    return `secrets-manager:${this.secretId}`;
  }

  get provisioningNote(): string {
    return (
      "Provision the oracle keypair as a secret in AWS Secrets Manager / " +
      "HashiCorp Vault / GCP Secret Manager, containing the 64-byte key as a " +
      "JSON array, base58 or hex. Grant this service read-only access to that " +
      "secret and nothing else. Rotate it by writing a new version and " +
      "restarting; the on-chain deal stores the oracle pubkey, so a key change " +
      "requires new deals to be initialized against the new key."
    );
  }

  async load(registry: SecretRegistry): Promise<OracleKeypair> {
    let raw: string | null;
    try {
      raw = await this.fetchSecret(this.secretId);
    } catch (err) {
      // The manager's own error may quote the secret back (some SDKs do on
      // validation failures), so it goes through the registry.
      throw new ConfigError(
        `failed to read oracle key from secrets manager (${this.secretId}): ` +
          safeErrorMessage(err, registry)
      );
    }
    if (!raw) {
      throw new ConfigError(
        `secrets manager returned no value for ${this.secretId}`
      );
    }

    const keypair = parseOracleSecret(raw, registry, this.description);
    this.logger.info("loaded oracle keypair", {
      source: this.description,
      publicKey: keypair.publicKey.toBase58(),
    });
    return new OracleKeypair(keypair, this.description);
  }
}

/**
 * The "secrets manager injects the value into the environment" shape.
 *
 * This is the pragmatic first production deployment for most teams: the
 * orchestrator (Kubernetes external-secrets, ECS `secrets`, Vault Agent,
 * systemd `LoadCredential`) reads the secret and exports it, so the process
 * never talks to the manager directly and never needs its credentials.
 *
 * It is still not a file, still not in the repo, and still overrides a
 * `SecretString` so the value cannot be logged accidentally.
 */
export class EnvKeyProvider implements OracleKeyProvider {
  constructor(private readonly secret: SecretString, private readonly logger: Logger) {}

  get description(): string {
    return "env:ORACLE_KEYPAIR_SECRET";
  }

  get provisioningNote(): string {
    return (
      "Provide ORACLE_KEYPAIR_SECRET via your orchestrator's secret injection " +
      "(Kubernetes external-secrets, ECS/Cloud Run secret refs, Vault Agent, " +
      "systemd credentials). Do not put it in a .env file that is committed, " +
      "and do not export it from a shell profile on a shared host."
    );
  }

  async load(registry: SecretRegistry): Promise<OracleKeypair> {
    const keypair = parseOracleSecret(
      this.secret.reveal(),
      registry,
      this.description
    );
    this.logger.info("loaded oracle keypair", {
      source: this.description,
      publicKey: keypair.publicKey.toBase58(),
    });
    return new OracleKeypair(keypair, this.description);
  }
}

/* ------------------------------------------------------------------ */
/* Development provider                                                */
/* ------------------------------------------------------------------ */

/**
 * Development and test only.
 *
 * Two modes, both visibly throwaway:
 *   - a keypair file, for `scripts/devnet-setup.ts`'s `keys/oracle.json` so the
 *     local validator flow works;
 *   - an ephemeral generated keypair, when no path is configured, so tests need
 *     no fixture at all and no key material exists on disk.
 *
 * Both log a loud warning, because the point is that nobody should be able to
 * run this in production by accident. `config.ts` additionally refuses
 * `NODE_ENV=production` with this source.
 */
export class LocalDevKeyProvider implements OracleKeyProvider {
  constructor(private readonly path: string | null, private readonly logger: Logger) {}

  get description(): string {
    return this.path ? `local-dev-file:${this.path}` : "local-dev-ephemeral";
  }

  get provisioningNote(): string {
    return (
      "DEVELOPMENT ONLY. Reads a throwaway localnet keypair from disk, or " +
      "generates an ephemeral one when no path is set. This key must never " +
      "hold real funds and this provider must never be used in production; " +
      "set ORACLE_SECRET_SOURCE=secrets-manager or env instead."
    );
  }

  async load(registry: SecretRegistry): Promise<OracleKeypair> {
    this.logger.warn(
      "USING DEVELOPMENT ORACLE KEY — not for production; " +
        "set ORACLE_SECRET_SOURCE to secrets-manager or env",
      { source: this.description }
    );

    if (!this.path) {
      const generated = Keypair.generate();
      // Register the generated secret too: it is worthless, but a test that
      // asserts "the oracle key is never logged" should hold for this path as
      // well, and the same redaction must cover it.
      registry.register(generated.secretKey);
      this.logger.info("generated ephemeral development oracle keypair", {
        publicKey: generated.publicKey.toBase58(),
      });
      return new OracleKeypair(generated, this.description);
    }

    let contents: string;
    try {
      contents = readFileSync(this.path, "utf8");
    } catch (err) {
      throw new ConfigError(
        `could not read development oracle keypair at ${this.path}: ` +
          safeErrorMessage(err, registry)
      );
    }
    const keypair = parseOracleSecret(contents, registry, this.description);
    this.logger.info("loaded development oracle keypair from file", {
      publicKey: keypair.publicKey.toBase58(),
      source: this.description,
    });
    return new OracleKeypair(keypair, this.description);
  }
}

/**
 * Pick a provider from configuration.
 *
 * This is the single place the environment decides *which* custody model is in
 * force. Everything downstream sees an `OracleKeypair` and cannot tell the
 * difference — so tests exercise the same signing code as production, with only
 * the source of the key differing.
 */
export function makeOracleKeyProvider(
  config: OracleKeyConfig,
  logger: Logger,
  secretsManagerFetcher?: (secretId: string) => Promise<string | null>
): OracleKeyProvider {
  switch (config.source) {
    case "secrets-manager":
      if (!config.secretId) {
        throw new ConfigError("ORACLE_KEYPAIR_SECRET_ID is required");
      }
      return new SecretsManagerKeyProvider(
        config.secretId,
        secretsManagerFetcher ??
          (() =>
            Promise.reject(
              new ConfigError(
                "no secrets-manager fetcher wired up: pass one to " +
                  "makeOracleKeyProvider (see SecretsManagerKeyProvider docs) " +
                  "or set ORACLE_SECRET_SOURCE=env with the manager injecting " +
                  "ORACLE_KEYPAIR_SECRET"
              )
            )),
        logger
      );
    case "env":
      if (!config.envSecret) {
        throw new ConfigError("ORACLE_KEYPAIR_SECRET is required");
      }
      return new EnvKeyProvider(config.envSecret, logger);
    case "local-dev":
      return new LocalDevKeyProvider(config.localKeypairPath, logger);
    default: {
      const exhaustive: never = config.source;
      throw new ConfigError(`unknown oracle secret source: ${String(exhaustive)}`);
    }
  }
}
