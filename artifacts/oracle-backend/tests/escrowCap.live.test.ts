/**
 * On-chain proof of the per-deal value cap, against a **real validator**.
 *
 * Opt-in, like `e2e.live.test.ts`: it needs a local validator with
 * `adadive_escrow` deployed and a `PlatformConfig` account (both created by
 * `scripts/devnet-setup.sh`), so it is excluded from the default `pnpm test`
 * run and is invoked with `pnpm --filter @workspace/oracle-backend run test:cap`.
 *
 * It deliberately builds the `initialize` instruction by hand rather than going
 * through `buildInitializeTransaction`. That helper carries a client-side
 * preview of the cap and would throw *before* the transaction was ever sent —
 * which would prove the client agrees with the policy, not that the program
 * enforces it. Submitting the raw instruction makes an accept/reject decision
 * the program's own, which is the property under test: a caller who skips the
 * client cannot lock more than the cap.
 *
 * The cap is read from the live config rather than hardcoded, so the boundary
 * probes stay correct whatever the platform's current policy is.
 */

import { expect } from "chai";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import {
  BN,
  ESCROW_PROGRAM_ID,
  KeypairWallet,
  findDealAddress,
  findPlatformConfigAddress,
  makeEscrowProgram,
} from "@workspace/solana-escrow";

const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";

/** Airdrop in 1 SOL chunks; the local validator rejects large single requests. */
async function fund(
  connection: Connection,
  publicKey: PublicKey,
  targetLamports: bigint
): Promise<void> {
  let balance = BigInt(await connection.getBalance(publicKey));
  let attempts = 0;
  while (balance < targetLamports && attempts < 120) {
    attempts += 1;
    const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature: sig, ...latest },
      "confirmed"
    );
    balance = BigInt(await connection.getBalance(publicKey));
  }
  if (balance < targetLamports) {
    throw new Error(
      `could not fund ${publicKey.toBase58()} to ${targetLamports} lamports ` +
        `(reached ${balance}); the validator may be rate-limiting airdrops`
    );
  }
}

describe("escrow per-deal value cap on a live validator", function () {
  this.timeout(120_000);

  let connection: Connection;
  let payer: Keypair;
  let depositor: Keypair;
  let provider: Keypair;
  let oracle: Keypair;
  let configAddress: PublicKey;
  let program: ReturnType<typeof makeEscrowProgram>;
  let cap: bigint;
  let available = false;

  before(async () => {
    connection = new Connection(RPC, "confirmed");

    // Skip with a clear message rather than failing when the local validator,
    // the deployed program or the config account is absent.
    try {
      await connection.getVersion();
    } catch (err) {
      console.log(
        `    (skipping: no local validator at ${RPC} — ${(err as Error).message})`
      );
      return;
    }

    const programAccount = await connection.getAccountInfo(ESCROW_PROGRAM_ID);
    if (!programAccount) {
      console.log(
        "    (skipping: adadive_escrow not deployed — run scripts/devnet-setup.sh)"
      );
      return;
    }

    payer = Keypair.generate();
    depositor = Keypair.generate();
    provider = Keypair.generate();
    oracle = Keypair.generate();
    // `payer` only backs the provider wallet object; it never signs or pays, so
    // it needs no real balance. The depositor funds the deal account's rent and
    // the escrowed amount, so it is topped up to the cap plus a margin.
    await fund(connection, payer.publicKey, 1n * BigInt(LAMPORTS_PER_SOL));
    await fund(connection, depositor.publicKey, 60n * BigInt(LAMPORTS_PER_SOL));

    program = makeEscrowProgram(connection, new KeypairWallet(payer));
    configAddress = findPlatformConfigAddress(ESCROW_PROGRAM_ID)[0];

    const config = await program.account.platformConfig.fetchNullable(
      configAddress
    );
    if (!config) {
      console.log(
        "    (skipping: no PlatformConfig — run scripts/devnet-setup.sh)"
      );
      return;
    }
    cap = BigInt(config.maxDealAmount.toString());
    // The depositor must be able to cover the at-cap deposit plus rent.
    await fund(connection, depositor.publicKey, cap + 10n * BigInt(LAMPORTS_PER_SOL));
    available = true;
  });

  beforeEach(function () {
    if (!available) this.skip();
  });

  /**
   * Submit a raw `initialize` for `amount` and report what the program did.
   *
   * Returns the on-chain error text when the instruction fails, so a test can
   * assert on the program's own error code rather than on a generic failure.
   */
  async function submitDeposit(amount: bigint): Promise<
    | { ok: true; amount: string }
    | { ok: false; errorText: string; named: boolean }
  > {
    const dealId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [dealPda] = findDealAddress(
      ESCROW_PROGRAM_ID,
      depositor.publicKey,
      dealId
    );
    const now = Math.floor(Date.now() / 1000);
    try {
      await program.methods
        .initialize(
          new BN(amount.toString()),
          dealId,
          new BN(now),
          new BN(now + 86_400)
        )
        .accountsPartial({
          depositor: depositor.publicKey,
          provider: provider.publicKey,
          oracle: oracle.publicKey,
          deal: dealPda,
          config: configAddress,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor])
        .rpc();
      const acct = await program.account.deal.fetchNullable(dealPda);
      return { ok: true, amount: acct?.amount.toString() ?? "" };
    } catch (err) {
      const logs = ((err as { logs?: string[] }).logs ?? []).join("\n");
      return {
        ok: false,
        errorText: `${(err as Error).message}\n${logs}`,
        named: /DealAmountExceedsMax/.test(logs),
      };
    }
  }

  it("accepts a deposit exactly at the cap", async () => {
    const result = await submitDeposit(cap);
    expect(result.ok, `at-cap deposit (${cap}) should be accepted`).to.equal(true);
    if (result.ok) {
      expect(result.amount).to.equal(cap.toString());
    }
  });

  it("rejects a deposit one lamport over the cap, on-chain", async () => {
    const result = await submitDeposit(cap + 1n);
    expect(result.ok, "over-cap deposit should be rejected").to.equal(false);
    if (!result.ok) {
      expect(result.named, `expected DealAmountExceedsMax, got:\n${result.errorText}`)
        .to.equal(true);
    }
  });
});
