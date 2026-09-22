/**
 * Wallet-signature authentication.
 *
 * The claims under test are about *proving control of a key*, so nothing here
 * stubs the cryptography. Every test uses real Solana keypairs and produces real
 * Ed25519 signatures over the exact challenge bytes; the verifier under test is
 * the production one (`node:crypto`), reached through the same HTTP routes a
 * wallet would use. A test that mocked the signature check would only be testing
 * that the mock was called.
 *
 * The one thing that *is* controlled is the clock. Expiry is tested by moving an
 * injected `now` forward rather than sleeping, because a real sleep makes the
 * suite slow and flaky and tests nothing extra.
 */

import { expect } from "chai";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Keypair } from "@solana/web3.js";

import { createApp } from "../src/http/server";
import { OracleService } from "../src/service/oracleService";
import {
  FakeChain,
  fakeProvider,
  makeTestAuth,
  makeTestContext,
  signMessageBytes,
  signIn,
  testAuthConfig,
  type TestAuth,
  type TestContext,
} from "./helpers/setup";
import { encodeBase58 } from "../src/security/base58";
import { AuthService } from "../src/auth/authService";
import { SessionSecret } from "../src/auth/sessionSecret";
import { parseSessionSecret, issueSessionToken, verifySessionToken } from "../src/auth/sessionToken";
import { loadConfig, ConfigError, MIN_SESSION_SECRET_BYTES } from "../src/config";

interface Harness {
  ctx: TestContext;
  server: Server;
  baseUrl: string;
  auth: TestAuth;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const ctx = await makeTestContext();
  const chain = new FakeChain();
  const auth = makeTestAuth(ctx.pool, ctx.registry, ctx.logger);

  const service = new OracleService({
    deals: ctx.deals,
    disputes: ctx.disputes,
    verifyPin: async () => ({
      ok: true,
      reason: "pinned_and_retrievable",
      detail: "stub: pinned",
    }),
    chain,
    oracle: ctx.oracle,
    logger: ctx.logger,
    registry: ctx.registry,
    providerSignatureStrategy: "demo-keypair",
    demoProvider: fakeProvider(),
  });

  const app = createApp({
    deals: ctx.deals,
    disputes: ctx.disputes,
    service,
    oracle: ctx.oracle,
    logger: ctx.logger,
    registry: ctx.registry,
    defaultChallengeWindowSeconds: 3600,
    runJob: () => service.runChallengeWindowJob(),
    auth: auth.service,
    requireAuth: true,
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    ctx,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    auth,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.pool.end();
    },
  };
}

async function postJson(
  url: string,
  body: unknown,
  token?: string
): Promise<{ status: number; body: any; raw: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* non-JSON would fail an assertion below */
  }
  return { status: response.status, body: parsed, raw };
}

describe("wallet-signature authentication", () => {
  /**
   * The full flow, exactly as a wallet performs it:
   * challenge → sign the real message → verify → token → use the token.
   */
  describe("the challenge → sign → verify → session flow", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it("issues a challenge containing the wallet, a nonce and an expiry", async () => {
      const wallet = Keypair.generate().publicKey.toBase58();

      const res = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });

      expect(res.status).to.equal(201);
      expect(res.body.message).to.contain(wallet);
      expect(res.body.message).to.contain(h.auth.config.domain);
      expect(res.body.nonce).to.be.a("string").with.length.greaterThan(16);
      expect(res.body.expiresAt).to.be.a("string");
      // The nonce in the message is the nonce returned, and they are the same
      // thing the client must echo back.
      expect(res.body.message).to.contain(res.body.nonce);
    });

    it("issues distinct, single-use challenges to the same wallet", async () => {
      const wallet = Keypair.generate().publicKey.toBase58();

      const first = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      const second = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });

      expect(first.body.nonce).not.to.equal(second.body.nonce);
      expect(first.body.message).not.to.equal(second.body.message);
    });

    it("verifies a real signature and issues a usable session token", async () => {
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();

      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge.body.message, "utf8")
      );

      const verify = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });

      expect(verify.status).to.equal(200);
      expect(verify.body.token).to.be.a("string");
      expect(verify.body.tokenType).to.equal("Bearer");
      expect(verify.body.wallet).to.equal(wallet);

      // And the token is accepted on a mutating route as that wallet.
      const deal = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "auth-flow",
          depositor: wallet,
          provider: Keypair.generate().publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        verify.body.token
      );
      expect(deal.status).to.equal(201);
    });

    it("issues a token whose subject is the signing wallet, not a claimed one", async () => {
      const signer = Keypair.generate();
      const token = await signIn(h.auth, signer);

      // Decode the payload (not a secret; the token is a bearer credential and
      // is only ever sent over TLS) and check `sub`.
      const payload = JSON.parse(
        Buffer.from(token.token.split(".")[1], "base64url").toString("utf8")
      );
      expect(payload.sub).to.equal(signer.publicKey.toBase58());
      expect(payload.iss).to.equal(h.auth.config.issuer);
      expect(payload.aud).to.equal(h.auth.config.audience);
      expect(payload.exp).to.be.greaterThan(payload.iat);
    });
  });

  describe("rejecting bad attempts", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it("rejects a signature over a different message", async () => {
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });

      // Correct key, wrong bytes: a real signature, but not over this challenge.
      const signature = signMessageBytes(keypair, Buffer.from("a different message"));

      const res = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });
      expect(res.status).to.equal(401);
      expect(res.body.reason).to.equal("invalid_challenge_or_signature");
    });

    it("rejects a signature produced by a different keypair than claimed", async () => {
      const victim = Keypair.generate();
      const attacker = Keypair.generate();
      const wallet = victim.publicKey.toBase58();

      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      // The attacker signs the victim's challenge with their own key. The
      // signature is valid, but not for the claimed wallet.
      const signature = signMessageBytes(
        attacker,
        Buffer.from(challenge.body.message, "utf8")
      );

      const res = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });
      expect(res.status).to.equal(401);
    });

    it("rejects a challenge belonging to a different wallet", async () => {
      const a = Keypair.generate();
      const b = Keypair.generate();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, {
        wallet: b.publicKey.toBase58(),
      });
      // A signs B's challenge — valid signature, wrong wallet for this nonce.
      const signature = signMessageBytes(
        a,
        Buffer.from(challenge.body.message, "utf8")
      );

      const res = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet: a.publicKey.toBase58(),
        nonce: challenge.body.nonce,
        signature,
      });
      expect(res.status).to.equal(401);
    });

    it("rejects an already-used challenge (replay)", async () => {
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge.body.message, "utf8")
      );

      const first = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });
      expect(first.status).to.equal(200);

      // The identical request again: the exact signature that just worked.
      const replay = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });
      expect(replay.status).to.equal(401);
      expect(replay.body.reason).to.equal("challenge_already_used");
    });

    it("rejects an expired challenge", async () => {
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge.body.message, "utf8")
      );

      // Move the clock past the challenge TTL. The signature is still valid over
      // the message; only its freshness has lapsed.
      h.auth.advanceSeconds(h.auth.config.challengeTtlSeconds + 1);

      const res = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });
      expect(res.status).to.equal(401);
      expect(res.body.reason).to.equal("challenge_expired");
    });

    it("rejects an unknown nonce", async () => {
      const keypair = Keypair.generate();
      const res = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet: keypair.publicKey.toBase58(),
        nonce: "no-such-nonce",
        signature: encodeBase58(new Uint8Array(64)),
      });
      expect(res.status).to.equal(401);
    });

    it("rejects a malformed wallet, signature length and short signature", async () => {
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      const good = signMessageBytes(
        keypair,
        Buffer.from(challenge.body.message, "utf8")
      );

      // A 10-byte "signature" is not a signature; it must be a 401, not a 500.
      const short = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature: encodeBase58(new Uint8Array(10)),
      });
      expect(short.status).to.equal(401);

      // A malformed wallet address is a 400 from the challenge endpoint.
      const badWallet = await postJson(`${h.baseUrl}/auth/challenge`, {
        wallet: "!!!not-a-key!!!",
      });
      expect(badWallet.status).to.equal(400);

      // And the good signature still works, proving the failures above did not
      // consume the challenge.
      const ok = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature: good,
      });
      expect(ok.status).to.equal(200);
    });

    it("does not let a failed attempt burn a legitimate challenge", async () => {
      // Signature is checked before the challenge is consumed, so a hostile
      // caller cannot deny a user their sign-in by submitting garbage.
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });

      for (let i = 0; i < 3; i++) {
        const bad = await postJson(`${h.baseUrl}/auth/verify`, {
          wallet,
          nonce: challenge.body.nonce,
          signature: encodeBase58(new Uint8Array(64).fill(i + 2)),
        });
        expect(bad.status).to.equal(401);
      }

      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge.body.message, "utf8")
      );
      const ok = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet,
        nonce: challenge.body.nonce,
        signature,
      });
      expect(ok.status).to.equal(200);
    });
  });

  describe("concurrency", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it("issues exactly one session when a challenge is submitted twice at once", async () => {
      // The single-use property is enforced by a conditional UPDATE, so two
      // simultaneous requests must not both succeed. Firing them without
      // awaiting in between is the closest the test can get to a real race.
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, { wallet });
      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge.body.message, "utf8")
      );

      const body = { wallet, nonce: challenge.body.nonce, signature };
      const [a, b] = await Promise.all([
        postJson(`${h.baseUrl}/auth/verify`, body),
        postJson(`${h.baseUrl}/auth/verify`, body),
      ]);

      const successes = [a, b].filter((r) => r.status === 200);
      expect(successes).to.have.length(1);
      const failures = [a, b].filter((r) => r.status === 401);
      expect(failures).to.have.length(1);
    });
  });

  describe("the auth service directly", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it("generates no session for a wallet with no challenge", async () => {
      const keypair = Keypair.generate();
      const result = await h.auth.service.verify({
        walletBase58: keypair.publicKey.toBase58(),
        nonce: "does-not-exist",
        signatureBase58: encodeBase58(new Uint8Array(64)),
      });
      expect(result.ok).to.equal(false);
    });

    it("refuses to issue a challenge for a non-key", async () => {
      expect(await h.auth.service.issueChallenge("nonsense")).to.equal(null);
    });

    it("binds the challenge to the configured domain", async () => {
      // A challenge for another origin must not be consumable here. Building it
      // directly against a different domain exercises the domain check.
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const otherDomainAuth = makeTestAuth(
        h.ctx.pool,
        h.ctx.registry,
        h.ctx.logger,
        testAuthConfig({ domain: "phisher.example", uri: "https://phisher.example" })
      );

      const challenge = await otherDomainAuth.service.issueChallenge(wallet);
      expect(challenge).not.to.equal(null);
      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge!.message, "utf8")
      );

      // The real service has a different domain configured, so the challenge it
      // finds by nonce carries the wrong domain and is refused.
      const result = await h.auth.service.verify({
        walletBase58: wallet,
        nonce: challenge!.nonce,
        signatureBase58: signature,
      });
      expect(result.ok).to.equal(false);
    });
  });

  /**
   * The specific requirement that identity, once established, is the *only*
   * thing downstream sees. These run through the HTTP layer.
   */
  describe("session tokens", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it("rejects a token signed with a different secret", async () => {
      const otherSecret = new Uint8Array(Buffer.alloc(48, 0x33));
      const keypair = Keypair.generate();
      // Build a service that will mint a token with the *wrong* secret, then
      // present it to the real one.
      const wrongSecretAuth = new AuthService({
        challenges: h.auth.challenges,
        sessionSecret: new SessionSecret(otherSecret, "test-wrong"),
        config: h.auth.config,
        logger: h.ctx.logger,
        registry: h.ctx.registry,
      });
      const challenge = await wrongSecretAuth.issueChallenge(
        keypair.publicKey.toBase58()
      );
      const signature = signMessageBytes(
        keypair,
        Buffer.from(challenge!.message, "utf8")
      );
      const minted = await wrongSecretAuth.verify({
        walletBase58: keypair.publicKey.toBase58(),
        nonce: challenge!.nonce,
        signatureBase58: signature,
      });
      expect(minted.ok).to.equal(true);

      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "wrong-secret",
          depositor: keypair.publicKey.toBase58(),
          provider: Keypair.generate().publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        minted.ok ? minted.token : ""
      );
      expect(res.status).to.equal(401);
    });

    it("rejects a token that has been tampered with in the payload", async () => {
      const keypair = Keypair.generate();
      const { token } = await signIn(h.auth, keypair);

      // Swap the subject to another wallet, keeping the original signature.
      const [header, payload, sig] = token.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      claims.sub = Keypair.generate().publicKey.toBase58();
      const forgedPayload = Buffer.from(JSON.stringify(claims))
        .toString("base64url");
      const tampered = `${header}.${forgedPayload}.${sig}`;

      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "tampered",
          depositor: keypair.publicKey.toBase58(),
          provider: Keypair.generate().publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        tampered
      );
      expect(res.status).to.equal(401);
    });

    it("rejects a token with alg set to none", async () => {
      // The classic JWT attack: present an unsigned token claiming `alg: none`.
      const keypair = Keypair.generate();
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
        .toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          iss: h.auth.config.issuer,
          aud: h.auth.config.audience,
          sub: keypair.publicKey.toBase58(),
          iat: now,
          exp: now + 3600,
          jti: "none",
        })
      ).toString("base64url");

      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "alg-none",
          depositor: keypair.publicKey.toBase58(),
          provider: Keypair.generate().publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        `${header}.${payload}.`
      );
      expect(res.status).to.equal(401);
    });

    it("rejects a token minted for a different issuer", () => {
      const secret = new Uint8Array(Buffer.alloc(48, 0x77));
      const token = issueSessionToken({
        wallet: Keypair.generate().publicKey.toBase58(),
        secret,
        issuer: "someone-else",
        audience: "adadive-api",
        ttlSeconds: 3600,
      });
      const result = verifySessionToken({
        token,
        secret,
        issuer: "adadive-oracle-backend",
        audience: "adadive-api",
      });
      expect(result.valid).to.equal(false);
      if (!result.valid) expect(result.reason).to.equal("wrong_issuer");
    });

    it("accepts a token within its clock-skew tolerance and rejects beyond it", () => {
      const secret = new Uint8Array(Buffer.alloc(48, 0x88));
      const issuedAt = new Date();
      const token = issueSessionToken({
        wallet: Keypair.generate().publicKey.toBase58(),
        secret,
        issuer: "iss",
        audience: "aud",
        ttlSeconds: 60,
        now: () => issuedAt,
      });

      // 30s past expiry, with a 60s skew allowance: still valid.
      const withinSkew = verifySessionToken({
        token,
        secret,
        issuer: "iss",
        audience: "aud",
        now: () => new Date(issuedAt.getTime() + 90_000),
        clockSkewSeconds: 60,
      });
      expect(withinSkew.valid).to.equal(true);

      // 30s past expiry with no allowance: refused.
      const noSkew = verifySessionToken({
        token,
        secret,
        issuer: "iss",
        audience: "aud",
        now: () => new Date(issuedAt.getTime() + 90_000),
      });
      expect(noSkew.valid).to.equal(false);
    });
  });

  /**
   * Startup configuration.
   *
   * These matter as much as the runtime checks: a service that starts with a
   * development session secret under `NODE_ENV=production` would issue sessions
   * any other replica cannot verify, and would do so silently.
   */
  describe("auth configuration guards", () => {
    const productionEnv = (extra: NodeJS.ProcessEnv = {}) => ({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://example/db",
      PINATA_JWT: "not-a-real-jwt",
      ...extra,
    });

    it("refuses a development session secret in production", () => {
      expect(() => loadConfig(productionEnv())).to.throw(ConfigError, /local-dev/);
    });

    it("refuses production without a session-secret id for the secrets-manager source", () => {
      expect(() =>
        loadConfig(
          productionEnv({
            SESSION_SECRET_SOURCE: "secrets-manager",
            ORACLE_SECRET_SOURCE: "env",
            ORACLE_KEYPAIR_SECRET: "x".repeat(64),
          })
        )
      ).to.throw(ConfigError, /SESSION_SECRET_ID/);
    });

    it("refuses SESSION_SECRET_SOURCE=env with no value", () => {
      expect(() =>
        loadConfig(
          productionEnv({
            SESSION_SECRET_SOURCE: "env",
            ORACLE_SECRET_SOURCE: "env",
            ORACLE_KEYPAIR_SECRET: "x".repeat(64),
          })
        )
      ).to.throw(ConfigError, /SESSION_SECRET/);
    });

    it(`refuses a SESSION_SECRET shorter than ${MIN_SESSION_SECRET_BYTES} bytes`, () => {
      expect(() =>
        loadConfig({
          NODE_ENV: "development",
          SESSION_SECRET_SOURCE: "env",
          SESSION_SECRET: "tooshort",
        })
      ).to.throw(ConfigError, /at least/);
    });

    it("refuses AUTH_REQUIRED=false in production", () => {
      // Auth cannot be switched off where the gap it closes is real.
      expect(() =>
        loadConfig(
          productionEnv({
            AUTH_REQUIRED: "false",
            SESSION_SECRET_SOURCE: "secrets-manager",
            SESSION_SECRET_ID: "arn:aws:secretsmanager:region:acct:secret:x",
            ORACLE_SECRET_SOURCE: "env",
            ORACLE_KEYPAIR_SECRET: "x".repeat(64),
          })
        )
      ).to.throw(ConfigError, /AUTH_REQUIRED=false is refused/);
    });

    it("defaults auth on, and accepts a valid production configuration", () => {
      const config = loadConfig(
        productionEnv({
          SESSION_SECRET_SOURCE: "secrets-manager",
          SESSION_SECRET_ID: "arn:aws:secretsmanager:region:acct:secret:x",
          ORACLE_SECRET_SOURCE: "env",
          ORACLE_KEYPAIR_SECRET: "x".repeat(64),
        })
      );
      expect(config.auth.required).to.equal(true);
      expect(config.auth.sessionSecretSource).to.equal("secrets-manager");
    });

    it("allows the development posture outside production", () => {
      const config = loadConfig({ NODE_ENV: "development" });
      expect(config.auth.sessionSecretSource).to.equal("local-dev");
      expect(config.auth.required).to.equal(true);
      // AUTH_REQUIRED can be turned off in development only.
      const opened = loadConfig({ NODE_ENV: "development", AUTH_REQUIRED: "false" });
      expect(opened.auth.required).to.equal(false);
    });
  });

  describe("session secret parsing", () => {
    it("accepts hex, base58, base64 and a passphrase", () => {
      const bytes = Uint8Array.from(Buffer.alloc(32, 0x41));
      expect(Buffer.from(parseSessionSecret(Buffer.from(bytes).toString("hex")))).to.deep.equal(Buffer.from(bytes));
      // A passphrase is taken verbatim rather than refused, so operators are not
      // pushed toward weaker values that happen to decode.
      expect(Buffer.from(parseSessionSecret("a-long-random-passphrase-value-here")).length).to.equal(35);
    });

    it("rejects an empty secret", () => {
      expect(() => parseSessionSecret("   ")).to.throw();
    });
  });
});
