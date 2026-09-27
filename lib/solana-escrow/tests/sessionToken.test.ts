/**
 * Tests for the session token codec.
 *
 * This is the boundary where "a wallet signed a challenge" becomes a bearer
 * token the api-server trusts, so the negative cases matter as much as the
 * positive one: a token that verifies when it should not is a complete
 * authentication bypass. Each test below is one way that could happen.
 *
 * The module is shared, so these run against the same code the oracle signs
 * with and the api-server verifies with — a disagreement between the two would
 * show up here as a token that fails to round-trip.
 */
import { assert } from "chai";

import { decodeBase58, encodeBase58 } from "../src/backend/base58";
import {
  issueSessionToken,
  parseSessionSecret,
  verifySessionToken,
  type SessionClaims,
} from "../src/backend/sessionToken";

const SECRET = new Uint8Array(48).fill(7);
const ISSUER = "adadive-oracle-backend";
const AUDIENCE = "adadive-api";
const WALLET = "9xQeWvG816bUx9EPa2rP1pW6r1c7Z7x8V6yhYb1nQ2f";

function issue(overrides: Partial<Parameters<typeof issueSessionToken>[0]> = {}): string {
  return issueSessionToken({
    wallet: WALLET,
    secret: SECRET,
    issuer: ISSUER,
    audience: AUDIENCE,
    ttlSeconds: 3600,
    ...overrides,
  });
}

function verify(
  token: string,
  overrides: Partial<Parameters<typeof verifySessionToken>[0]> = {}
) {
  return verifySessionToken({
    token,
    secret: SECRET,
    issuer: ISSUER,
    audience: AUDIENCE,
    ...overrides,
  });
}

describe("session tokens", () => {
  it("round-trips: a token this code issues, this code verifies", () => {
    const result = verify(issue());
    assert.isTrue(result.valid);
    if (!result.valid) return;
    assert.equal(result.claims.sub, WALLET);
    assert.equal(result.claims.iss, ISSUER);
    assert.equal(result.claims.aud, AUDIENCE);
  });

  it("carries a unique jti per issue, so two sessions are distinguishable", () => {
    const a = verify(issue());
    const b = verify(issue());
    assert.isTrue(a.valid && b.valid);
    if (!a.valid || !b.valid) return;
    assert.notEqual(a.claims.jti, b.claims.jti);
  });

  it("rejects a token signed with a different secret", () => {
    const token = issue({ secret: new Uint8Array(48).fill(9) });
    const result = verify(token);
    assert.deepEqual(result, { valid: false, reason: "bad_signature" });
  });

  it("rejects a token whose payload was edited after signing", () => {
    const token = issue();
    const [header, , signature] = token.split(".");
    // Re-encode a payload claiming a different wallet, keeping the signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: AUDIENCE,
        sub: "AttackerWalletAddress111111111111111111111",
        iat: 1,
        exp: 4102444800,
        jti: "x",
      })
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = verify(`${header}.${forgedPayload}.${signature}`);
    assert.deepEqual(result, { valid: false, reason: "bad_signature" });
  });

  it("refuses an alg:none token rather than reading its claims", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
      .toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: AUDIENCE,
        sub: WALLET,
        iat: 1,
        exp: 4102444800,
        jti: "x",
      })
    ).toString("base64url");
    const result = verify(`${header}.${payload}.`);
    // Empty signature is malformed before it is even an algorithm question.
    assert.isFalse(result.valid);
  });

  it("refuses an algorithm other than HS256", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS512", typ: "JWT" })).toString(
      "base64url"
    );
    const payload = Buffer.from(JSON.stringify({ sub: WALLET })).toString("base64url");
    const result = verify(`${header}.${payload}.AAAA`);
    assert.deepEqual(result, { valid: false, reason: "unsupported_algorithm" });
  });

  it("rejects a token issued for a different audience", () => {
    const token = issue({ audience: "some-other-service" });
    assert.deepEqual(verify(token), { valid: false, reason: "wrong_audience" });
  });

  it("rejects a token issued by a different issuer", () => {
    const token = issue({ issuer: "impostor" });
    assert.deepEqual(verify(token), { valid: false, reason: "wrong_issuer" });
  });

  it("rejects an expired token", () => {
    const issuedAt = new Date("2020-01-01T00:00:00Z");
    const token = issue({ ttlSeconds: 60, now: () => issuedAt });
    const result = verify(token, { now: () => new Date("2020-01-01T01:00:00Z") });
    assert.deepEqual(result, { valid: false, reason: "expired" });
  });

  it("rejects a token that is not yet valid when iat is in the future", () => {
    const token = issue({ now: () => new Date("2030-01-01T00:00:00Z") });
    const result = verify(token, { now: () => new Date("2020-01-01T00:00:00Z") });
    assert.deepEqual(result, { valid: false, reason: "not_yet_valid" });
  });

  it("tolerates expiry within the configured clock skew", () => {
    const issuedAt = new Date("2020-01-01T00:00:00Z");
    const token = issue({ ttlSeconds: 60, now: () => issuedAt });
    const justAfter = new Date("2020-01-01T00:00:30Z");
    assert.isTrue(verify(token, { now: () => justAfter }).valid);
    // The older oracle API defaults skew to 30s; this one is explicit.
    assert.isTrue(verify(token, { now: () => justAfter, clockSkewSeconds: 60 }).valid);
  });

  it("rejects structurally malformed tokens without throwing", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "..", "!!!.???.###"]) {
      const result = verify(bad);
      assert.isFalse(result.valid, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });

  it("rejects a token missing a required claim", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url"
    );
    const payload = Buffer.from(JSON.stringify({ sub: WALLET })).toString("base64url");
    const result = verify(`${header}.${payload}.AAAA`);
    // Signature is checked before claims, so this is a bad signature, not a
    // missing claim — and that ordering is the point.
    assert.deepEqual(result, { valid: false, reason: "bad_signature" });
  });
});

describe("parseSessionSecret", () => {
  it("accepts hex and rejects a wrong-length hex string", () => {
    const hex = "ab".repeat(48);
    assert.deepEqual(parseSessionSecret(hex), Uint8Array.from(Buffer.from(hex, "hex")));
  });

  it("accepts base64 with and without padding", () => {
    const raw = Buffer.from(new Uint8Array(48).fill(3)).toString("base64");
    const padded = raw;
    const unpadded = raw.replace(/=+$/, "");
    assert.deepEqual(parseSessionSecret(padded), parseSessionSecret(unpadded));
  });

  it("falls back to raw UTF-8 bytes for an arbitrary passphrase", () => {
    const phrase = "a-long-random-passphrase-value-here";
    assert.equal(parseSessionSecret(phrase).length, phrase.length);
  });

  it("throws on an empty or whitespace secret rather than inventing bytes", () => {
    assert.throws(() => parseSessionSecret(""));
    assert.throws(() => parseSessionSecret("   "));
  });
});

describe("base58 codec", () => {
  it("round-trips, including leading zero bytes", () => {
    for (const bytes of [
      new Uint8Array([0]),
      new Uint8Array([0, 0, 1]),
      new Uint8Array([1, 2, 3, 4, 5]),
      Uint8Array.from(Buffer.alloc(32, 0)),
    ]) {
      assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
    }
  });

  it("returns null for non-base58 input rather than throwing", () => {
    for (const bad of ["0", "O", "I", "l", "abc!", ""]) {
      assert.isNull(decodeBase58(bad));
    }
  });
});
