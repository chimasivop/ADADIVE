/**
 * Session tokens, verified.
 *
 * A wallet proves control of an address by signing a challenge; the oracle
 * backend then issues a short-lived bearer token whose `sub` is that address.
 * The api-server has to accept *that* token — the frontend holds one session,
 * obtained the one way the app knows how — so the verifier lives here, in the
 * library both services already share, rather than being copied into the
 * api-server with one field different.
 *
 * ## Why this is a hand-written verifier
 *
 * The verifier is the part that matters, and this version is ~60 lines that can
 * be read in full: decode, compare the algorithm exactly, recompute the HMAC,
 * compare in constant time, check the claims. The failure modes of a JWT library
 * are the ones people do not read — `alg: none` acceptance, algorithm confusion
 * between HMAC and RSA, a permissive clock skew. `ALGORITHM_CONFUSION` below is
 * the specific defence: the header's `alg` is checked against the one algorithm
 * the service issues, rather than being used to *select* one.
 *
 * ## It verifies for whoever holds the secret, and issues for the oracle
 *
 * The api-server only ever *accepts* a session; it imports the verifier and not
 * the issuer, so nothing on that surface can mint identity. Minting stays in the
 * oracle, behind the signature check that is the only thing entitled to create
 * it.
 *
 * ## Issuing and verifying live together
 *
 * Both directions are in this one file, over the same base64url and HMAC
 * helpers. Splitting them would let the encoder drift from the decoder, and that
 * drift is invisible until a token "just does not verify". Only the oracle calls
 * `issueSessionToken`; the api-server imports the verifier alone, so the property
 * that identity is created in exactly one place is a matter of who calls what,
 * not of which module happens to exist.
 *
 * ## Claims
 *
 * | claim | meaning                                                          |
 * | ----- | ---------------------------------------------------------------- |
 * | `iss` | issuer — the issuing service's configured identifier              |
 * | `aud` | audience — must match; a token for another service fails here     |
 * | `sub` | subject — the wallet address, base58. The authenticated identity  |
 * | `iat` | issued-at, seconds since epoch                                    |
 * | `exp` | expiry, seconds since epoch                                       |
 * | `jti` | token id, unique per issue                                        |
 *
 * `sub` is the *only* thing callers should read identity from. It was set from
 * the wallet that was proven to hold the key, never from a request field.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { decodeBase58 } from "./base58";

/** The only algorithm the session issuer uses. */
export const JWT_ALGORITHM = "HS256";

export interface SessionClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

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
/* base64url                                                           */
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
    // Node's base64 decoder is lenient, so re-encoding and comparing catches
    // input that decoded to something else entirely.
    return base64urlEncode(buf) === input ? buf : null;
  } catch {
    return null;
  }
}

function hmac(secret: Uint8Array, signingInput: string): Buffer {
  return createHmac("sha256", Buffer.from(secret)).update(signingInput, "utf8").digest();
}

/* ------------------------------------------------------------------ */
/* issue / verify                                                      */
/* ------------------------------------------------------------------ */

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
 * Issue a session token for an authenticated wallet.
 *
 * `sub` is taken from the argument, which the caller must have obtained from a
 * verified signature — never from a request body.
 *
 * Only the oracle calls this. It is here so the issuer and verifier share one
 * implementation of the token format; see the file comment.
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
export function verifySessionToken(params: VerifySessionParams): SessionVerification {
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
    // A token claiming `none` or `RS256` is refused outright. We do not look up
    // the algorithm and honour it.
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

  // `exp` is exclusive, `iat` is inclusive, both with optional skew.
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
 * taken as UTF-8) so a value generated by `openssl rand -base64 48` works
 * without re-encoding. Minimum length is enforced by config, not here, so this
 * stays a pure decoder.
 *
 * The precedence matters and is shared with the issuer: if the two sides picked
 * differently, one would derive a key the other never signed with.
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
  if (
    asBase64.length > 0 &&
    asBase64.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")
  ) {
    return Uint8Array.from(asBase64);
  }

  return Uint8Array.from(Buffer.from(trimmed, "utf8"));
}
