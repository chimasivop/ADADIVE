/**
 * Ed25519 signature verification for Solana wallets.
 *
 * A wallet signs a challenge message with the private half of its keypair. We
 * need to answer one question: *did this public key produce this signature over
 * these exact bytes?* Nothing else in this file does anything, and nothing here
 * trusts the caller to have already checked it.
 *
 * ## Why `node:crypto` and not a library
 *
 * Ed25519 verification is in Node's standard library. Using it means the
 * verifier has no supply-chain surface, no version drift, and no chance of a
 * subtly different default (a library that silently accepts a malleable
 * signature, say). The one piece of assembly required is wrapping the raw
 * 32-byte Solana public key in the DER/SPKI envelope `crypto.createPublicKey`
 * expects — that is what `SPKI_ED25519_PREFIX` is, and it is the whole trick.
 *
 * ## What this deliberately does not do
 *
 * It does not verify *transactions*, does not touch the cluster, and does not
 * recover a key from a signature. A wallet proves control of an address by
 * signing a message we issued; that is a different (and much smaller) claim
 * than "this key authorised this transaction", and conflating the two is how
 * sign-in flows end up trusting unverified on-chain state.
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import { decodeBase58 } from "../security/base58";

/**
 * DER prefix for a SubjectPublicKeyInfo wrapping a raw Ed25519 public key.
 *
 *   30 2a                SEQUENCE (42 bytes)
 *      30 05             SEQUENCE (5 bytes)
 *         06 03 2b 65 70    OID 1.3.101.112 (Ed25519)
 *      03 21 00          BIT STRING (33 bytes, 0 unused bits)
 *
 * Appending the 32 raw key bytes yields a valid SPKI structure.
 */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** A Solana ed25519 signature is exactly 64 bytes. */
export const SIGNATURE_LENGTH = 64;

/** A Solana public key is exactly 32 bytes. */
const PUBLIC_KEY_LENGTH = 32;

/**
 * Wrap a raw 32-byte Ed25519 public key as a Node `KeyObject`.
 *
 * Throws if the length is wrong. Callers validate public keys when parsing
 * input, so a wrong length here is a programming error, not user input.
 */
function ed25519PublicKeyFromBytes(raw: Uint8Array): KeyObject {
  if (raw.length !== PUBLIC_KEY_LENGTH) {
    throw new Error(
      `ed25519 public key must be ${PUBLIC_KEY_LENGTH} bytes, got ${raw.length}`
    );
  }
  const der = Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(raw)]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/** Parse a base58 public key, returning `null` rather than throwing. */
export function parsePublicKey(base58: string): PublicKey | null {
  try {
    return new PublicKey(base58);
  } catch {
    return null;
  }
}

/**
 * Decode a base58 signature to 64 bytes, or `null` if it is not valid base58 of
 * exactly that length.
 *
 * Returning `null` rather than throwing lets the verify path treat "not a
 * signature at all" uniformly with "wrong signature", which is both the correct
 * security answer and the one that keeps a malformed input from becoming a 500.
 */
export function decodeSignature(base58: string): Uint8Array | null {
  const decoded = decodeBase58(base58);
  if (!decoded || decoded.length !== SIGNATURE_LENGTH) return null;
  return decoded;
}

/**
 * Verify `signature` is `publicKey`'s signature over `message`.
 *
 * Returns a boolean and never throws on malformed input: a short "signature" or
 * a non-base58 key is simply not a valid signature, not an internal error. An
 * exception here would be indistinguishable from a genuine bug and would likely
 * surface as a 500, which is both misleading and a probing oracle for an
 * attacker mapping the input space.
 */
export function verifyEd25519Signature(params: {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
}): boolean {
  const { publicKey, message, signature } = params;

  if (signature.length !== SIGNATURE_LENGTH) return false;
  const keyBytes = publicKey.toBytes();
  if (keyBytes.length !== PUBLIC_KEY_LENGTH) return false;

  try {
    const key = ed25519PublicKeyFromBytes(keyBytes);
    // A `null` algorithm name means "use the key's own algorithm", which for an
    // Ed25519 key is Ed25519. No separate hash step: Ed25519 hashes internally.
    return cryptoVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

/**
 * Convenience form: verify base58 inputs directly.
 *
 * This is what the HTTP layer calls, so the "decode then verify" pairing cannot
 * be got wrong at a call site. Returns `false` for any malformed component.
 */
export function verifyBase58Signature(params: {
  publicKeyBase58: string;
  message: Uint8Array;
  signatureBase58: string;
}): boolean {
  const publicKey = parsePublicKey(params.publicKeyBase58);
  if (!publicKey) return false;
  const signature = decodeSignature(params.signatureBase58);
  if (!signature) return false;
  return verifyEd25519Signature({
    publicKey,
    message: params.message,
    signature,
  });
}
