/**
 * End-to-end: the oracle backend against a **real validator** and real Postgres.
 *
 * Unlike the other suites, this one is opt-in. It requires a local validator
 * with `adadive_escrow` deployed, a `PlatformConfig` account and the funded keys
 * that `scripts/devnet-setup.sh` creates, so it cannot run in a bare CI job.
 *
 *   source ../.toolchain/env.sh
 *   npm run test:e2e
 *
 * Everything else in `tests/` runs against real Postgres but a *fake* chain, by
 * design — the challenge-window logic is what those suites are about. This is
 * the other half: it proves the settle path actually lands on-chain through the
 * Phase 2 client library, with a real oracle signature and a real transaction
 * that can be looked up afterwards. It is the executable form of the claim
 * "the backend signs as oracle and submits settle".
 *
 * It is a mocha test rather than a script because `app/src/lib/solana` is an
 * ESM package and mocha's loader can import it where a bare `ts-node` run of a
 * CommonJS backend file cannot. The narration is preserved in the test names and
 * in `console.log` output, so running it still reads as a walkthrough.
 */

import { expect } from "chai";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";

import {
  ESCROW_PROGRAM_ID,
  EscrowClient,
  KeypairWallet,
  findDealAddress,
  findPlatformConfigAddress,
  type PlatformConfigView,
} from "@workspace/solana-escrow";
import { OracleService } from "../src/service/oracleService";
import {
  SolanaEscrowChain,
  type EscrowChain,
  type SettleAsOracleParams,
} from "../src/chain/escrowChain";
import { DealRepository, DisputeRepository } from "../src/db/repository";
import { createPool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";
import { OracleKeypair } from "../src/oracle/keyProvider";
import { SecretRegistry } from "../src/security/redact";
import { createLogger } from "../src/logger";
import { SilentTestLogger } from "./helpers/silentLogger";

// `tests/` sits at `artifacts/oracle-backend/tests`, so the repo root — where
// `scripts/devnet-setup.sh` writes `keys/` — is three levels up.
const ROOT = resolve(__dirname, "../../..");
const KEYS = resolve(ROOT, "keys");
const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/adadive_oracle";
/** Short so the window can actually be observed closing. */
const WINDOW_SECONDS = 2;

function keypairFromFile(path: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[])
  );
}

function sol(lamports: number | bigint): string {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(9);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Top a keypair up to `targetLamports` in chunks.
 *
 * A single `requestAirdrop` is capped (the local validator rejects large ones),
 * so this loops until the balance is reached. Each airdrop is confirmed before
 * the next, because firing them in parallel makes the validator drop some.
 */
async function ensureFunded(
  connection: Connection,
  publicKey: PublicKey,
  targetLamports: number
): Promise<void> {
  const CHUNK = LAMPORTS_PER_SOL;
  let balance = await connection.getBalance(publicKey);
  let attempts = 0;
  while (balance < targetLamports && attempts < 20) {
    attempts += 1;
    const sig = await connection.requestAirdrop(publicKey, CHUNK);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    balance = await connection.getBalance(publicKey);
  }
  if (balance < targetLamports) {
    throw new Error(
      `could not fund ${publicKey.toBase58()} to 8 SOL (reached ` +
        `${(balance / LAMPORTS_PER_SOL).toFixed(3)}); the validator may be ` +
        `rate-limiting airdrops`
    );
  }
}

/**
 * Wraps the real chain adapter and records submissions, so a test can assert
 * that a disputed deal was never even submitted — a stronger claim than "the
 * database status did not change".
 */
class RecordingChain implements EscrowChain {
  readonly submitted: SettleAsOracleParams[] = [];
  private readonly inner: SolanaEscrowChain;
  constructor(inner: SolanaEscrowChain) {
    this.inner = inner;
  }
  fetchDeal(pda: PublicKey) {
    return this.inner.fetchDeal(pda);
  }
  settleAsOracle(params: SettleAsOracleParams) {
    this.submitted.push(params);
    return this.inner.settleAsOracle(params);
  }
}

describe("E2E: optimistic challenge settlement on a live validator", function () {
  this.timeout(120_000);

  let connection: Connection;
  let pool: Pool;
  let deals: DealRepository;
  let disputes: DisputeRepository;
  let oracle: OracleKeypair;
  let oracleKp: Keypair;
  let providerKp: Keypair;
  let depositorKp: Keypair;
  let registry: SecretRegistry;
  let config: PlatformConfigView;
  let treasury: PublicKey;
  let chain: RecordingChain;
  let service: OracleService;
  let available = false;

  before(async () => {
    connection = new Connection(RPC, "confirmed");

    // Skip the suite with a clear message rather than failing, when the local
    // validator or keys are absent. A red suite that means "you did not run
    // devnet-setup" trains people to ignore red.
    try {
      await connection.getVersion();
      for (const f of ["oracle.json", "provider.json", "depositor.json"]) {
        readFileSync(resolve(KEYS, f));
      }
    } catch (err) {
      available = false;
      console.log(
        `    (skipping: local validator or keys/ not ready — ${(err as Error).message})`
      );
      return;
    }

    registry = new SecretRegistry();
    const logger = createLogger("debug", registry);

    oracleKp = keypairFromFile(resolve(KEYS, "oracle.json"));
    providerKp = keypairFromFile(resolve(KEYS, "provider.json"));
    depositorKp = keypairFromFile(resolve(KEYS, "depositor.json"));
    oracle = new OracleKeypair(oracleKp, "e2e:keys/oracle.json");
    registry.register(oracleKp.secretKey);
    registry.register(providerKp.secretKey);

    const readClient = EscrowClient.readOnly(connection);
    const configAddress = findPlatformConfigAddress(ESCROW_PROGRAM_ID)[0];
    const fetched = await readClient.program.account.platformConfig.fetchNullable(
      configAddress
    );
    if (!fetched) {
      available = false;
      console.log("    (skipping: no PlatformConfig — run scripts/devnet-setup.sh)");
      return;
    }
    config = fetched as PlatformConfigView;
    treasury = config.treasury;

    // Fund each role so rent and fees cannot cause a spurious failure.
    //
    // The target is generous relative to the suite's spend (each test locks 1
    // SOL into escrow; the total is a few SOL), and the top-up runs on every
    // invocation. A lower target would still pass on a fresh ledger and then
    // fail on the fourth test of a second run against the same ledger — which
    // is exactly the flake this avoids.
    for (const kp of [oracleKp, providerKp, depositorKp]) {
      await ensureFunded(connection, kp.publicKey, 8 * LAMPORTS_PER_SOL);
    }

    pool = createPool(DATABASE_URL, { max: 4 });
    await pool.query("SELECT 1");
    await runMigrations(pool);
    deals = new DealRepository(pool);
    disputes = new DisputeRepository(pool);

    chain = new RecordingChain(new SolanaEscrowChain(connection, logger, registry));

    service = new OracleService({
      deals,
      disputes,
      // Stubbed: this suite is about the on-chain half. Pin logic is covered by
      // the mocked-Pinata tests in `pinStatus.test.ts`.
      verifyPin: async (cid) => ({
        ok: true,
        reason: "pinned_and_retrievable" as const,
        detail: `e2e stub: ${cid} treated as pinned`,
      }),
      chain,
      oracle,
      logger,
      registry,
      providerSignatureStrategy: "demo-keypair",
      demoProvider: providerKp,
    });

    available = true;
  });

  after(async () => {
    if (pool) await pool.end();
  });

  beforeEach(function () {
    if (!available) this.skip();
  });

  /** Initialize an on-chain deal through the Phase 2 library, as the UI does. */
  async function initDeal(amountSol: number): Promise<PublicKey> {
    const dealId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const depositorWallet = new KeypairWallet(depositorKp);
    const depositorClient = new EscrowClient(connection, depositorWallet);
    const [dealPda] = findDealAddress(
      ESCROW_PROGRAM_ID,
      depositorKp.publicKey,
      dealId
    );

    // `initializeEscrow` builds the transaction; `signAndSubmit` signs with the
    // depositor (the sole required signer) and sends — the same pairing the
    // demo UI uses.
    const built = await depositorClient.initializeEscrow({
      depositor: depositorWallet,
      provider: providerKp.publicKey,
      oracle: oracleKp.publicKey,
      amount: BigInt(amountSol * LAMPORTS_PER_SOL),
      dealId,
    });
    await depositorClient.signAndSubmit(built, [depositorWallet]);
    return dealPda;
  }

  async function register(dealPda: PublicKey, amountLamports: bigint) {
    return deals.create({
      dealId: `e2e-${dealPda.toBase58().slice(0, 8)}`,
      dealPda: dealPda.toBase58(),
      depositor: depositorKp.publicKey.toBase58(),
      provider: providerKp.publicKey.toBase58(),
      oracle: oracleKp.publicKey.toBase58(),
      cid: `e2e-${dealPda.toBase58().slice(0, 8)}`,
      amountLamports,
      challengeWindowSeconds: WINDOW_SECONDS,
    });
  }

  it("settles on-chain after the window closes with no dispute, paying the fee", async () => {
    const ONE_SOL = BigInt(LAMPORTS_PER_SOL);
    const dealPda = await initDeal(1);
    console.log(`    initialized deal at ${dealPda.toBase58()}`);

    const providerBefore = await connection.getBalance(providerKp.publicKey);
    const treasuryBefore = await connection.getBalance(treasury);

    const row = await register(dealPda, ONE_SOL);

    const requested = await service.requestSettle(row);
    expect(requested.ok, "settle request should be accepted").to.equal(true);
    expect(requested.ok && requested.outcome).to.equal("challenge_window_opened");
    if (requested.ok) {
      console.log(
        `    challenge window opens, closing ${requested.deal.challengeWindowEndsAt?.toISOString()}`
      );
    }

    // A tick inside the window must do nothing at all.
    const early = await service.runChallengeWindowJob();
    expect(early.scanned, "job must not scan a deal inside its window").to.equal(0);
    expect(chain.submitted, "no settle submitted inside the window").to.have.length(0);

    await sleep((WINDOW_SECONDS + 1) * 1000);

    const run = await service.runChallengeWindowJob();
    expect(run.scanned).to.equal(1);
    expect(run.results[0].action).to.equal("settled");
    expect(chain.submitted).to.have.length(1);

    const settled = (await deals.findById(row.id))!;
    expect(settled.status).to.equal("settled");
    const signature = settled.settleTxSignature!;
    console.log(`    settled on-chain in tx ${signature}`);

    // The transaction really is on the cluster and really succeeded.
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    expect(tx, "settle transaction should be found on-chain").to.not.equal(null);
    expect(tx!.meta?.err ?? null, "settle transaction should have no error").to.equal(
      null
    );
    console.log(`    confirmed at slot ${tx!.slot}`);

    // The fee arithmetic matches the on-chain config: 2.5% to the treasury.
    const feeBps = Number(config.feeBasisPoints.toString());
    const expectedFee = (Number(ONE_SOL) * feeBps) / 10_000;
    const treasuryAfter = await connection.getBalance(treasury);
    expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
    console.log(
      `    treasury received ${sol(expectedFee)} SOL (${feeBps}bp of 1 SOL)`
    );

    const providerAfter = await connection.getBalance(providerKp.publicKey);
    console.log(
      `    provider balance change: +${sol(providerAfter - providerBefore)} SOL ` +
        `(escrow minus fee, plus rent swept on close)`
    );

    // Settle closes the deal account.
    expect(
      await connection.getAccountInfo(dealPda),
      "deal account should be closed after settle"
    ).to.equal(null);
  });

  it("does NOT settle on-chain when a dispute was raised inside the window", async () => {
    const dealPda = await initDeal(1);
    const row = await register(dealPda, BigInt(LAMPORTS_PER_SOL));

    const requested = await service.requestSettle(row);
    expect(requested.ok).to.equal(true);

    // Dispute while the window is open.
    const dispute = await disputes.raise(
      row.id,
      depositorKp.publicKey.toBase58(),
      "e2e: I cannot retrieve my file"
    );
    expect(dispute.ok, "in-window dispute should be accepted").to.equal(true);
    console.log("    dispute raised; deal status is now 'disputed'");

    const submissionsBefore = chain.submitted.length;
    await sleep((WINDOW_SECONDS + 1) * 1000);

    const run = await service.runChallengeWindowJob();

    expect(run.scanned, "a disputed deal must not be scanned").to.equal(0);
    expect(
      chain.submitted.length,
      "no settle transaction may be submitted for a disputed deal"
    ).to.equal(submissionsBefore);

    const after = (await deals.findById(row.id))!;
    expect(after.status).to.equal("disputed");
    expect(
      await connection.getAccountInfo(dealPda),
      "the deal account must still exist: the deal did not settle"
    ).to.not.equal(null);
    console.log(
      "    deal did not settle; still on-chain, funds escrowed, flagged for manual review"
    );
  });

  it("rejects a dispute raised after the window closes, and then settles", async () => {
    const dealPda = await initDeal(1);
    const row = await register(dealPda, BigInt(LAMPORTS_PER_SOL));
    await service.requestSettle(row);

    await sleep((WINDOW_SECONDS + 1) * 1000);

    const late = await disputes.raise(
      row.id,
      depositorKp.publicKey.toBase58(),
      "too late"
    );
    expect(late.ok, "a post-window dispute must be rejected").to.equal(false);
    expect(late.ok === false && late.code).to.equal("window_closed");
    console.log("    post-window dispute rejected with code 'window_closed'");

    // With no dispute, the deal settles normally.
    const run = await service.runChallengeWindowJob();
    expect(run.results[0].action).to.equal("settled");
    console.log("    the undisputed deal then settled normally");
  });

  it("never logs the oracle key while doing all of the above", async () => {
    // Rebuild the service with a *capturing* logger so every line the service
    // wrote during a real settle is inspectable. The service's own logger is
    // used here, not the production one, so a leak is visible rather than
    // redacted away.
    const captureLogger = new SilentTestLogger();
    const capturingService = new OracleService({
      deals,
      disputes,
      verifyPin: async (cid) => ({
        ok: true,
        reason: "pinned_and_retrievable" as const,
        detail: `e2e stub: ${cid}`,
      }),
      chain,
      oracle,
      logger: captureLogger,
      registry,
      providerSignatureStrategy: "demo-keypair",
      demoProvider: providerKp,
    });

    const dealPda = await initDeal(1);
    const row = await register(dealPda, BigInt(LAMPORTS_PER_SOL));
    await capturingService.requestSettle(row);
    await sleep((WINDOW_SECONDS + 1) * 1000);
    await capturingService.runChallengeWindowJob();

    const secretKey = oracleKp.secretKey;
    const forms = {
      hex: Buffer.from(secretKey).toString("hex"),
      base64: Buffer.from(secretKey).toString("base64"),
      json: JSON.stringify(Array.from(secretKey)),
    };
    for (const [name, value] of Object.entries(forms)) {
      expect(captureLogger.text, `logs leaked the oracle key as ${name}`).not.to
        .contain(value);
    }
    // "Never logged" must mean "there were logs to leak from", or the assertion
    // above passes vacuously.
    expect(captureLogger.text, "the service logged nothing to check").to.not
      .equal("");
    expect(captureLogger.text).to.contain("auto-settled deal");
  });
});
