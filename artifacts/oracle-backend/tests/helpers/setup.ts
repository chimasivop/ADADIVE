/**
 * Shared test scaffolding.
 *
 * Three concerns, each of which had a wrong answer that was tempting:
 *
 *   1. **The database.** Tests run against a real Postgres, not a mock. The
 *      thing being tested in the challenge-window design is *transactional
 *      behaviour* — that a dispute and a settlement claim cannot both win — and
 *      a mock would test the mock. Each test gets a clean schema.
 *
 *   2. **The chain.** Mocked, via the `EscrowChain` interface. This is the one
 *      place mocking is right: the real implementation is a thin adapter over
 *      the Phase 2 client library, which the Phase 2 suite already exercises
 *      against a live validator. What *these* tests need to observe is the
 *      service's decision, not Solana's.
 *
 *   3. **Pinata.** Stubbed at the HTTP layer (`fetchImpl`) for the tests of
 *      `verifyPinStatus` itself, so parsing, status handling and reason
 *      classification are really exercised. Tests of the *service* stub
 *      `verifyPin` directly, because they are about the window logic.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import type { Pool } from "pg";

import { createPool } from "../../src/db/pool";
import { runMigrations } from "../../src/db/migrate";
import { DealRepository, DisputeRepository } from "../../src/db/repository";
import { AuthChallengeRepository } from "../../src/db/authChallengeRepository";
import { SilentTestLogger } from "./silentLogger";
import { SecretRegistry } from "../../src/security/redact";
import { encodeBase58 } from "../../src/security/base58";
import { OracleKeypair } from "../../src/oracle/keyProvider";
import { AuthService } from "../../src/auth/authService";
import { SessionSecret } from "../../src/auth/sessionSecret";
import {
  DEFAULT_AUTH_CHALLENGE_TTL_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  type AuthConfig,
} from "../../src/config";
import { verifyBase58Signature } from "../../src/auth/signature";
import type { EscrowChain, SettleAsOracleParams } from "../../src/chain/escrowChain";
import type { DealView } from "@workspace/solana-escrow";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:5433/adadive_oracle_test";

/**
 * A pool on the test database with a freshly-migrated schema.
 *
 * Migrations run per suite rather than per test: creating a pool and migrating
 * costs a few hundred milliseconds, and per-test `TRUNCATE` gives isolation
 * without that cost.
 */
export async function makeTestPool(): Promise<Pool> {
  const pool = createPool(TEST_DATABASE_URL, { max: 5 });
  await runMigrations(pool);
  return pool;
}

/** Empty the tables between tests without paying for a new schema. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    "TRUNCATE disputes, deals, auth_challenges RESTART IDENTITY CASCADE"
  );
}

export interface TestContext {
  pool: Pool;
  deals: DealRepository;
  disputes: DisputeRepository;
  registry: SecretRegistry;
  oracle: OracleKeypair;
  logger: SilentTestLogger;
}

export async function makeTestContext(): Promise<TestContext> {
  const pool = await makeTestPool();
  await truncateAll(pool);
  const registry = new SecretRegistry();
  const oracleKeypair = Keypair.generate();
  registry.register(oracleKeypair.secretKey);
  return {
    pool,
    deals: new DealRepository(pool),
    disputes: new DisputeRepository(pool),
    registry,
    oracle: new OracleKeypair(oracleKeypair, "test"),
    logger: new SilentTestLogger(),
  };
}

/**
 * A fake chain that records what it was asked to do.
 *
 * `settleAsOracle` succeeds by default and returns a deterministic signature.
 * `failWith` makes it throw, which is how the "submission failed, deal returns
 * to the window" path is exercised.
 */
export class FakeChain implements EscrowChain {
  readonly settleCalls: SettleAsOracleParams[] = [];
  failWith: Error | null = null;
  private counter = 0;

  async fetchDeal(_dealPda: PublicKey): Promise<DealView | null> {
    return null;
  }

  async settleAsOracle(
    params: SettleAsOracleParams
  ): Promise<{ signature: string }> {
    this.settleCalls.push(params);
    if (this.failWith) throw this.failWith;
    this.counter += 1;
    return { signature: `FAKE_SIG_${this.counter}` };
  }
}

/** A provider keypair, standing in for the development demo key. */
export function fakeProvider(): Keypair {
  return Keypair.generate();
}

/** Deterministic, valid base58 keys for cases where identity is irrelevant. */
export function fakeKey(index: number): string {
  return Keypair.fromSeed(
    Uint8Array.from(Buffer.alloc(32, index + 1))
  ).publicKey.toBase58();
}

/* ------------------------------------------------------------------ */
/* Authentication fixtures                                             */
/* ------------------------------------------------------------------ */

/**
 * A test auth configuration.
 *
 * Short TTLs so expiry is testable by moving an injected clock rather than
 * sleeping, and a fixed secret so a test can construct a token by hand if it
 * needs to forge one.
 */
export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    required: true,
    sessionSecretSource: "local-dev",
    sessionSecretId: null,
    envSecret: null,
    sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    challengeTtlSeconds: DEFAULT_AUTH_CHALLENGE_TTL_SECONDS,
    issuer: "adadive-oracle-backend",
    audience: "adadive-api",
    domain: "test.local",
    uri: "https://test.local",
    chainId: "solana:localnet",
    ...overrides,
  };
}

/** A fixed, non-secret session signing secret for tests. */
export const TEST_SESSION_SECRET_BYTES = new Uint8Array(
  Buffer.alloc(48, 0x5a)
);

export interface TestAuth {
  service: AuthService;
  challenges: AuthChallengeRepository;
  secret: SessionSecret;
  config: AuthConfig;
  /** The clock the service reads. Mutate to test expiry without sleeping. */
  setNow: (date: Date) => void;
  /** Let the clock run forward from its current point. */
  advanceSeconds: (seconds: number) => void;
}

/** Build an auth service over the given pool, with a controllable clock. */
export function makeTestAuth(
  pool: Pool,
  registry: SecretRegistry,
  logger: SilentTestLogger,
  config: AuthConfig = testAuthConfig()
): TestAuth {
  const challenges = new AuthChallengeRepository(pool);
  const secret = new SessionSecret(TEST_SESSION_SECRET_BYTES, "test");
  registry.register(TEST_SESSION_SECRET_BYTES);

  let current = new Date();
  const service = new AuthService({
    challenges,
    sessionSecret: secret,
    config,
    logger,
    registry,
    now: () => current,
  });

  return {
    service,
    challenges,
    secret,
    config,
    setNow: (date: Date) => {
      current = date;
    },
    advanceSeconds: (seconds: number) => {
      current = new Date(current.getTime() + seconds * 1000);
    },
  };
}

/**
 * Run a full sign-in for `keypair`, returning the session token.
 *
 * This is the real flow, end to end: issue a challenge, sign the actual
 * message bytes with the keypair, verify, return the token. Tests that then hit
 * a mutating endpoint over HTTP use a token produced exactly the way a wallet
 * would produce one — no shortcut through the service's internals.
 *
 * `signMessage` here mirrors what a wallet's `signMessage` does: Ed25519 over
 * the UTF-8 bytes of the message. Solana's `Keypair` exposes only transaction
 * signing, so the raw signature is produced with the same primitive
 * (`@noble/curves`) that backs it, and the *verifier* under test is still Node's
 * `crypto.verify` — so this genuinely exercises the production verification
 * path rather than testing a signer against itself.
 */
export async function signIn(
  auth: TestAuth,
  keypair: Keypair
): Promise<{ token: string; wallet: string; nonce: string; message: string }> {
  const wallet = keypair.publicKey.toBase58();
  const challenge = await auth.service.issueChallenge(wallet);
  if (!challenge) throw new Error("test: challenge issuance failed");

  const signature = signMessageBytes(
    keypair,
    Buffer.from(challenge.message, "utf8")
  );

  const result = await auth.service.verify({
    walletBase58: wallet,
    nonce: challenge.nonce,
    signatureBase58: signature,
  });
  if (!result.ok) {
    throw new Error(`test: sign-in failed: ${result.reason}`);
  }
  return {
    token: result.token,
    wallet,
    nonce: challenge.nonce,
    message: challenge.message,
  };
}

/**
 * Sign raw message bytes with a Solana keypair, returning base58.
 *
 * Uses `@noble/curves`' Ed25519 directly on the keypair's 32-byte seed. Kept as
 * a test helper rather than production code because production only ever
 * *verifies*; nothing in the service signs arbitrary messages.
 */
export function signMessageBytes(keypair: Keypair, message: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ed25519 } = require("@noble/curves/ed25519") as {
    ed25519: {
      sign: (msg: Uint8Array, priv: Uint8Array) => Uint8Array;
    };
  };
  const seed = keypair.secretKey.slice(0, 32);
  return encodeBase58Bytes(ed25519.sign(message, seed));
}

/** Local base58 encode, re-exported so tests do not each import it. */
export function encodeBase58Bytes(bytes: Uint8Array): string {
  return encodeBase58(bytes);
}

/** Re-export the verifier so tests can assert on it directly. */
export { verifyBase58Signature };
