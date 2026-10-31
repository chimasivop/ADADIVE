/**
 * The sign-in nonce, tested against the SIWS grammar.
 *
 * The nonce was base64url, which emits `-` and `_` in roughly three of every
 * four 32-byte draws. The SIWS ABNF defines `message-nonce` as
 * `8*( ALPHA / DIGIT )`, so most challenges were out of grammar even though the
 * message *text* was fine — and a strict wallet parser (Phantom) can reject
 * those. These tests pin the alphabet and the round-trip so the regression
 * cannot come back: the first fails for ~74% of draws against base64url, and
 * the second proves a real SIWS parser accepts what we emit.
 */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  createSignInMessageText,
  parseSignInMessageText,
} from "@solana/wallet-standard-util";

import {
  buildChallengeMessage,
  generateNonce,
} from "../src/auth/challengeMessage";

describe("sign-in nonce (SIWS grammar)", () => {
  it("generates 10,000 nonces that are all 8+ alphanumeric characters", () => {
    const SIWS_NONCE = /^[A-Za-z0-9]{8,}$/;
    const seen = new Set<string>();

    for (let i = 0; i < 10_000; i += 1) {
      const nonce = generateNonce();
      // `expect` inside the loop would stop at the first failure; assert the
      // shape directly so a single bad draw names the offending value.
      if (!SIWS_NONCE.test(nonce)) {
        throw new Error(`nonce ${JSON.stringify(nonce)} is not SIWS-valid`);
      }
      seen.add(nonce);
    }

    // Distinctness is not the security property (the DB UNIQUE constraint and
    // single-use consume are), but 10k identical draws would mean a broken RNG.
    expect(seen.size).to.equal(10_000);
  });

  it("keeps 256 bits of entropy (64 hex characters)", () => {
    const nonce = generateNonce();
    expect(nonce).to.have.length(64);
    expect(nonce).to.match(/^[0-9a-f]{64}$/);
  });

  it("builds a message a real SIWS parser accepts, round-tripping unchanged", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const issuedAt = new Date("2026-10-31T10:00:00.000Z");
    const expiresAt = new Date("2026-10-31T10:05:00.000Z");

    const message = buildChallengeMessage({
      domain: "adadive.xyz",
      uri: "https://adadive.xyz",
      wallet,
      nonce: generateNonce(),
      issuedAt,
      expiresAt,
      chainId: "solana:devnet",
    });

    const parsed = parseSignInMessageText(message);
    expect(parsed, "the wallet-standard parser rejected our message").to.not.equal(
      null
    );
    expect(parsed!.domain).to.equal("adadive.xyz");
    expect(parsed!.address).to.equal(wallet);
    expect(parsed!.chainId).to.equal("solana:devnet");
    expect(parsed!.nonce).to.match(/^[A-Za-z0-9]{8,}$/);

    // Byte-for-byte round-trip: the bytes signed are the bytes stored, so a
    // parse/re-create that changed anything would break verification.
    expect(createSignInMessageText(parsed!)).to.equal(message);
  });
});
