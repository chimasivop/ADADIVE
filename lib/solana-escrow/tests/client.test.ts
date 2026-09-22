/**
 * Tests for the client library pieces the browser integration depends on.
 *
 * These are deliberately offline: no cluster, no validator. Every function
 * covered here is pure — base58 encoding, the fee preview's integer arithmetic,
 * and PDA derivation — and each is a place where a subtle change would be
 * visible to a user (a signature that "does not verify", a fee preview that
 * disagrees with the on-chain split, a deal PDA the backend cannot find).
 *
 * The on-chain flows themselves are exercised by the oracle backend suite
 * (`artifacts/oracle-backend/tests`), which drives `EscrowClient` against fake
 * and live clusters.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

import { encodeBase58 } from "../src/backend/base58";
import { computeFeeSplit } from "../src/solana/fee";
import { findDealAddress, findPlatformConfigAddress } from "../src/solana/pda";
import { ESCROW_PROGRAM_ID } from "../src/solana/constants";

describe("encodeBase58", () => {
  it("matches the known encoding of an all-zero buffer", () => {
    // 32 zero bytes is the system program / all-zeros key, whose base58 form is
    // the well-known string of 32 '1's (each leading zero byte is one '1').
    assert.equal(encodeBase58(new Uint8Array(32)), "1".repeat(32));
  });

  it("round-trips a random public key through web3.js's own encoder", () => {
    // web3.js is the reference implementation; agreeing with it is what makes a
    // signature the backend receives decodable to the bytes the wallet signed.
    for (let i = 0; i < 20; i++) {
      const key = Keypair.generate().publicKey;
      assert.equal(encodeBase58(key.toBytes()), key.toBase58());
    }
  });

  it("encodes an empty input as an empty string", () => {
    assert.equal(encodeBase58(new Uint8Array(0)), "");
  });

  it("preserves leading zero bytes as leading '1's", () => {
    const bytes = new Uint8Array([0, 0, 1]);
    assert.equal(encodeBase58(bytes), "112");
  });
});

describe("computeFeeSplit", () => {
  it("splits at the configured basis points, truncating like the program", () => {
    const amount = BigInt(1_000_000_000);
    const split = computeFeeSplit(amount, 250);
    assert.equal(split.feeAmount, BigInt(25_000_000));
    assert.equal(split.providerAmount, BigInt(975_000_000));
    assert.equal(split.feePercent, 2.5);
  });

  it("conserves the total: fee + provider always equals the amount", () => {
    for (const amount of [1n, 7n, 999n, 123_456_789n, 5_000_000_000n]) {
      for (const bp of [0, 1, 250, 333, 9999]) {
        const split = computeFeeSplit(amount, bp);
        assert.equal(
          split.feeAmount + split.providerAmount,
          amount,
          `amount=${amount} bp=${bp}`
        );
      }
    }
  });

  it("truncates rather than rounds, matching the on-chain integer division", () => {
    // 1 lamport at 250bp is 0.025 lamports, which the program truncates to 0.
    const split = computeFeeSplit(BigInt(1), 250);
    assert.equal(split.feeAmount, BigInt(0));
    assert.equal(split.providerAmount, BigInt(1));
  });

  it("does not overflow for amounts whose product exceeds u64", () => {
    // The bug the bigint widening exists to prevent: amount * 10_000 for a
    // 5e18-lamport escrow overflows a 64-bit integer but not a bigint.
    const amount = BigInt("5000000000000000000");
    const split = computeFeeSplit(amount, 9999);
    assert.equal(split.feeAmount, (amount * BigInt(9999)) / BigInt(10_000));
    assert.equal(split.feeAmount + split.providerAmount, amount);
  });

  it("handles a zero amount without producing a negative provider share", () => {
    const split = computeFeeSplit(BigInt(0), 250);
    assert.equal(split.feeAmount, BigInt(0));
    assert.equal(split.providerAmount, BigInt(0));
  });
});

describe("PDA derivation", () => {
  it("derives the platform config at a stable address", () => {
    const [first] = findPlatformConfigAddress(ESCROW_PROGRAM_ID);
    const [second] = findPlatformConfigAddress(ESCROW_PROGRAM_ID);
    assert.equal(first.toBase58(), second.toBase58());
  });

  it("gives different depositors different deal addresses for the same id", () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    const [pdaA] = findDealAddress(ESCROW_PROGRAM_ID, a, "deal-1");
    const [pdaB] = findDealAddress(ESCROW_PROGRAM_ID, b, "deal-1");
    assert.notEqual(pdaA.toBase58(), pdaB.toBase58());
  });

  it("gives different ids different deal addresses for the same depositor", () => {
    const depositor = Keypair.generate().publicKey;
    const [pda1] = findDealAddress(ESCROW_PROGRAM_ID, depositor, "deal-1");
    const [pda2] = findDealAddress(ESCROW_PROGRAM_ID, depositor, "deal-2");
    assert.notEqual(pda1.toBase58(), pda2.toBase58());
  });

  it("is deterministic across calls, so the backend finds what the UI wrote", () => {
    const depositor = Keypair.generate().publicKey;
    const [first, bumpA] = findDealAddress(ESCROW_PROGRAM_ID, depositor, "métadata-ïd");
    const [second, bumpB] = findDealAddress(ESCROW_PROGRAM_ID, depositor, "métadata-ïd");
    assert.equal(first.toBase58(), second.toBase58());
    assert.equal(bumpA, bumpB);
  });

  it("hashes the deal id as UTF-8 bytes, not code units", () => {
    // A multi-byte id must derive the same address as an explicit UTF-8 seed,
    // which is what `deal_id.as_bytes()` does on-chain. If the client used
    // `charCodeAt` this would diverge for any non-ASCII id.
    const depositor = Keypair.generate().publicKey;
    const id = "déal-ïd";
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("deal"), depositor.toBuffer(), Buffer.from(id, "utf8")],
      ESCROW_PROGRAM_ID
    );
    const [actual] = findDealAddress(ESCROW_PROGRAM_ID, depositor, id);
    assert.equal(actual.toBase58(), expected.toBase58());
  });
});
