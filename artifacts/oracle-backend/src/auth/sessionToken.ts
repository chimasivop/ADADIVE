/**
 * Session tokens.
 *
 * A short-lived bearer token issued after a successful wallet signature check.
 * It is a compact JWS in the `alg: HS256` form (three base64url segments:
 * header.payload.signature), implemented here directly over `node:crypto`
 * rather than via a JWT library.
 *
 * ## Why not a JWT library
 *
 * The verifier is the part that matters, and a hand-written one is ~40 lines
 * that can be read in full: decode, compare the algorithm exactly, recompute the
 * HMAC, compare in constant time, check the claims. The failure modes of a
 * library are the ones people do not read — `alg: none` acceptance, algorithm
 * confusion between HMAC and RSA, a permissive clock skew. `ALGORITHM_CONFUSION`
 * below is the specific defence: the header's `alg` is checked against the one
 * algorithm this service issues, rather than being used to *select* one.
 *
 * ## Claims
 *
 * | claim | meaning                                                        |
 * | ----- | -------------------------------------------------------------- |
 * | `iss` | issuer — the service's configured identifier                     |
 * | `aud` | audience — the service's identifier; a token for elsewhere fails  |
 * | `sub` | subject — the wallet address, base58. This is the authenticated identity |
 * | `iat` | issued-at, seconds since epoch                                   |
 * | `exp` | expiry, seconds since epoch                                      |
 * | `jti` | token id, unique per issue. Not a session store — a hook for revocation later |
 *
 * `sub` is the *only* thing callers should read identity from. It is set from
 * the wallet that was proven to hold the key, never from a request field.
 *
 * ## What a session is not
 *
 * It is not a wallet key, and it cannot sign anything on-chain. Holding one lets
 * a caller act on behalf of that address in *this* service's API — registering a
 * deal, requesting settlement, raising a dispute — and nothing more. That is why
 * the TTL is minutes-to-hours and why the key it is signed with is a separate
 * secret from the oracle key: a leaked session is a bounded, revocable-by-expiry
 * problem, and a leaked session signing key does not imply a leaked oracle key.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { decodeBase58, encodeBase58 } from "../security/base58";

/** The only algorithm this service issues or accepts. */
export const JWT_ALGORITHM = "HS256";

export interface SessionClaims {
  /** Issuer. */
  iss: string;
  /** Audience. */
  aud: string;
  /** Subject: the authenticated wallet, base58. */
  sub: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Unique token id. */
  jti: string;
}

export interface IssueSessionParams {
  /** The authenticated wallet. Becomes `sub`. */
  wallet: string;
  /** Signing secret. */
  secret: Uint8Array;
  issuer: string;
  audience: string;
  /** Token lifetime in seconds. */
  ttlSeconds: number;
  /** Injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Result of verifying a token.
 *
 * A discriminated union rather than a boolean, because "expired" and "bad
 * signature" are different answers to an operator and both are 401s to the
 * client. Collapsing them loses the only signal that distinguishes a clock
 * problem from an attack.
 */
export type SessionVerification =
  | { valid: true; claims: SessionClaims }
  | { valid: false; reason: SessionFailureReason };

export type SessionFailureReason =
  | "malformed"
  | "unsupported_algorithm"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_issuer"
  | "wrong_audience"
  | "missing_claim";

/* ------------------------------------------------------------------ */
/* base64url helpers                                                   */
/* ------------------------------------------------------------------ */

function base64urlEncode(input: Uint8Array | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const buf = Buffer.from(padded + padding, "base64");
    // Round-trip check: node's base64 decoder is lenient, so re-encoding and
    // comparing catches input that decoded to something else entirely.
    return base64urlEncode(buf) === input ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Derive the HMAC key from an arbitrary-length secret.
 *
 * The secret may be provided as raw bytes, hex, base64, or base58 (see the
 * session secret provider). `createHmac` accepts any length, so no stretching
 * is needed; what matters is that the *same* bytes are derived every time.
 * Config validation enforces a minimum length so the key is not guessable.
 */
function hmac(secret: Uint8Array, signingInput: string): Buffer {
  return createHmac("sha256", Buffer.from(secret)).update(signingInput, "utf8").digest();
}

/* ------------------------------------------------------------------ */
/* issue / verify                                                      */
/* ------------------------------------------------------------------ */

/**
 * Issue a session token for an authenticated wallet.
 *
 * `sub` is taken from the argument, which callers must have obtained from a
 * verified signature — never from a request body. See `AuthService.verify`.
 */
export function issueSessionToken(params: IssueSessionParams): string {
  const now = params.now ? params.now() : new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);

  const header = { alg: JWT_ALGORITHM, typ: "JWT" };
  const claims: SessionClaims = {
    iss: params.issuer,
    aud: params.audience,
    sub: params.wallet,
    iat: issuedAt,
    exp: issuedAt + params.ttlSeconds,
    jti: randomBytes(16).toString("base64url"),
  };

  const signingInput =
    `${base64urlEncode(JSON.stringify(header))}.` +
    `${base64urlEncode(JSON.stringify(claims))}`;
  const signature = base64urlEncode(hmac(params.secret, signingInput));

  return `${signingInput}.${signature}`;
}

export interface VerifySessionParams {
  token: string;
  secret: Uint8Array;
  issuer: string;
  audience: string;
  /** Injectable clock, for expiry tests. */
  now?: () => Date;
  /** Tolerated clock skew, in seconds, applied symmetrically. Default 0. */
  clockSkewSeconds?: number;
}

/**
 * Verify a session token and return its claims.
 *
 * The order of checks is deliberate: structure, then algorithm, then signature
 * (before parsing the payload as JSON), then claims. Verifying the signature
 * before trusting *any* payload content means a forged payload is rejected
 * before its claims are ever read.
 */
export function verifySessionToken(
  params: VerifySessionParams
): SessionVerification {
  const { token, secret, issuer, audience } = params;
  const nowSeconds = Math.floor((params.now ? params.now() : new Date()).getTime() / 1000);
  const skew = params.clockSkewSeconds ?? 0;

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [headerPart, payloadPart, signaturePart] = parts;

  const headerBytes = base64urlDecode(headerPart);
  const payloadBytes = base64urlDecode(payloadPart);
  const providedSignature = base64urlDecode(signaturePart);
  if (!headerBytes || !payloadBytes || !providedSignature) {
    return { valid: false, reason: "malformed" };
  }

  let header: unknown;
  try {
    header = JSON.parse(headerBytes.toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (
    typeof header !== "object" ||
    header === null ||
    (header as Record<string, unknown>).alg !== JWT_ALGORITHM
  ) {
    // The algorithm-confusion defence: a token claiming `none` or `RS256` is
    // refused outright. We do not look up the algorithm and honour it.
    return { valid: false, reason: "unsupported_algorithm" };
  }

  const expectedSignature = hmac(secret, `${headerPart}.${payloadPart}`);
  if (providedSignature.length !== expectedSignature.length) {
    return { valid: false, reason: "bad_signature" };
  }
  // Constant-time: a byte-by-byte early return leaks how much of a forged
  // signature was correct, which is enough to forge one incrementally.
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return { valid: false, reason: "bad_signature" };
  }

  // Only now is the payload trustworthy enough to parse.
  let claims: unknown;
  try {
    claims = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof claims !== "object" || claims === null) {
    return { valid: false, reason: "malformed" };
  }
  const c = claims as Record<string, unknown>;

  if (
    typeof c.iss !== "string" ||
    typeof c.aud !== "string" ||
    typeof c.sub !== "string" ||
    typeof c.iat !== "number" ||
    typeof c.exp !== "number" ||
    typeof c.jti !== "string"
  ) {
    return { valid: false, reason: "missing_claim" };
  }
  if (c.iss !== issuer) return { valid: false, reason: "wrong_issuer" };
  if (c.aud !== audience) return { valid: false, reason: "wrong_audience" };

  // `exp` is exclusive, `iat` is inclusive, both with optional skew. A token
  // whose `iat` is far in the future is not "not yet valid" in practice, but
  // rejecting it closes a window where a clock-skewed issuer mints tokens that
  // outlive their stated lifetime.
  if (c.exp <= nowSeconds - skew) return { valid: false, reason: "expired" };
  if (c.iat > nowSeconds + skew) return { valid: false, reason: "not_yet_valid" };

  return {
    valid: true,
    claims: {
      iss: c.iss,
      aud: c.aud,
      sub: c.sub,
      iat: c.iat,
      exp: c.exp,
      jti: c.jti,
    },
  };
}

/* ------------------------------------------------------------------ */
/* secret parsing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Parse a session signing secret from the encodings a secrets manager might
 * hold it in.
 *
 * Accepts hex, base64, or base58, and also raw passphrase-style strings (bytes
 * taken as UTF-8) so a value generated by `openssl rand -base64 48` or similar
 * works without re-encoding. The minimum length is enforced by config, not here,
 * so this stays a pure decoder.
 *
 * Note this is deliberately *not* the oracle key parser: the session secret is
 * a symmetric key, not a keypair, and interpreting 32 bytes as a Solana seed
 * (which `parseOracleSecret` would do) would silently accept a value that is
 * not a keypair at all.
 */
export function parseSessionSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("session secret is empty");
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const bytes = Uint8Array.from(Buffer.from(trimmed, "hex"));
    if (bytes.length > 0) return bytes;
  }

  const asBase58 = decodeBase58(trimmed);
  if (asBase58 && asBase58.length > 0) return asBase58;

  // Base64 last, and only if it round-trips: `Buffer.from(x, "base64")` accepts
  // almost anything, so a check is the difference between "decoded your secret"
  // and "invented some bytes".
  const asBase64 = Buffer.from(trimmed, "base64");
  if (asBase64.length > 0 && asBase64.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
    return Uint8Array.from(asBase64);
  }

  // Fall back to the literal bytes. A 48-character random passphrase is a fine
  // HMAC key, and refusing it would push operators toward weaker "decodable"
  // values.
  return Uint8Array.from(Buffer.from(trimmed, "utf8"));
}

/** Exported for the redaction registry, which registers the encoded forms. */
export { encodeBase58 };
