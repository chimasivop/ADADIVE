/**
 * The Ed25519 verification primitive, tested at the boundary.
 *
 * These are the cases that decide whether the whole phase is sound: a verifier
 * that returns `true` for a malformed signature, or that throws instead of
 * returning `false`, would either admit an attacker or turn every bad input into
 * a 500. Neither shows up in the HTTP tests, which only ever exercise
 * well-formed inputs.
 *
 * The signer is `@noble/curves`' Ed25519 over the keypair's seed — the same
 * primitive Solana's `Keypair` uses. The verifier is Node's `crypto.verify`,
 * which is the production path. Testing one against the other is meaningful
 * precisely because they are independent implementations of the same standard.
 */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";

import {
  decodeSignature,
  parsePublicKey,
  verifyBase58Signature,
  verifyEd25519Signature,
} from "../src/auth/signature";
import { encodeBase58 } from "../src/security/base58";

function sign(keypair: Keypair, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, keypair.secretKey.slice(0, 32));
}

describe("ed25519 signature verification", () => {
  it("accepts a genuine signature over the exact bytes", () => {
    const keypair = Keypair.generate();
    const message = Buffer.from("sign me", "utf8");
    const signature = sign(keypair, message);

    expect(
      verifyEd25519Signature({ publicKey: keypair.publicKey, message, signature })
    ).to.equal(true);
  });

  it("rejects a signature over different bytes", () => {
    const keypair = Keypair.generate();
    const signature = sign(keypair, Buffer.from("original", "utf8"));

    expect(
      verifyEd25519Signature({
        publicKey: keypair.publicKey,
        message: Buffer.from("tampered", "utf8"),
        signature,
      })
    ).to.equal(false);
  });

  it("rejects a signature from a different keypair", () => {
    const signer = Keypair.generate();
    const other = Keypair.generate();
    const message = Buffer.from("sign me", "utf8");
    const signature = sign(signer, message);

    expect(
      verifyEd25519Signature({ publicKey: other.publicKey, message, signature })
    ).to.equal(false);
  });

  it("rejects a single flipped bit in the signature", () => {
    const keypair = Keypair.generate();
    const message = Buffer.from("sign me", "utf8");
    const signature = Uint8Array.from(sign(keypair, message));
    signature[0] ^= 0x01;

    expect(
      verifyEd25519Signature({ publicKey: keypair.publicKey, message, signature })
    ).to.equal(false);
  });

  it("rejects a bit-flipped message", () => {
    const keypair = Keypair.generate();
    const message = Uint8Array.from(Buffer.from("sign me", "utf8"));
    const signature = sign(keypair, message);
    message[0] ^= 0x01;

    expect(
      verifyEd25519Signature({ publicKey: keypair.publicKey, message, signature })
    ).to.equal(false);
  });

  it("returns false, never throws, for a wrong-length signature", () => {
    const keypair = Keypair.generate();
    const message = Buffer.from("sign me", "utf8");

    for (const length of [0, 1, 32, 63, 65, 128]) {
      expect(
        verifyEd25519Signature({
          publicKey: keypair.publicKey,
          message,
          signature: new Uint8Array(length),
        }),
        `length ${length} should be rejected without throwing`
      ).to.equal(false);
    }
  });

  it("decodes a base58 signature only at exactly 64 bytes", () => {
    const keypair = Keypair.generate();
    const signature = sign(keypair, Buffer.from("x"));
    expect(decodeSignature(encodeBase58(signature))).to.have.length(64);
    expect(decodeSignature(encodeBase58(new Uint8Array(32)))).to.equal(null);
    expect(decodeSignature("not base58 !!")).to.equal(null);
    expect(decodeSignature("")).to.equal(null);
  });

  it("parses public keys and rejects malformed ones without throwing", () => {
    const keypair = Keypair.generate();
    expect(parsePublicKey(keypair.publicKey.toBase58())?.toBase58()).to.equal(
      keypair.publicKey.toBase58()
    );
    expect(parsePublicKey("not-a-key")).to.equal(null);
    expect(parsePublicKey("")).to.equal(null);
  });

  it("verifies through the base58 convenience path and rejects bad inputs", () => {
    const keypair = Keypair.generate();
    const message = Buffer.from("sign me", "utf8");
    const signature = encodeBase58(sign(keypair, message));

    expect(
      verifyBase58Signature({
        publicKeyBase58: keypair.publicKey.toBase58(),
        message,
        signatureBase58: signature,
      })
    ).to.equal(true);

    // Bad key, bad signature, wrong message: all false, none throw.
    expect(
      verifyBase58Signature({
        publicKeyBase58: "nonsense",
        message,
        signatureBase58: signature,
      })
    ).to.equal(false);
    expect(
      verifyBase58Signature({
        publicKeyBase58: keypair.publicKey.toBase58(),
        message,
        signatureBase58: "nonsense",
      })
    ).to.equal(false);
    expect(
      verifyBase58Signature({
        publicKeyBase58: keypair.publicKey.toBase58(),
        message: Buffer.from("other", "utf8"),
        signatureBase58: signature,
      })
    ).to.equal(false);
  });

  it("does not accept a signature where a raw public key is not 32 bytes", () => {
    // The SPKI wrapper must be fed exactly 32 bytes; anything else is a
    // programming error surfaced as `false` rather than an exception.
    const keypair = Keypair.generate();
    const message = Buffer.from("sign me", "utf8");
    const signature = sign(keypair, message);

    const fakeKey = {
      toBytes: () => new Uint8Array(31),
      toBase58: () => keypair.publicKey.toBase58(),
    } as unknown as import("@solana/web3.js").PublicKey;

    expect(
      verifyEd25519Signature({ publicKey: fakeKey, message, signature })
    ).to.equal(false);
  });
});
