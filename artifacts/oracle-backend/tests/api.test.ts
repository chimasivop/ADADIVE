/**
 * The HTTP surface, driven end-to-end against a real database.
 *
 * `createApp` returns an Express app; tests start it on an ephemeral port and
 * talk to it over real HTTP rather than calling handlers directly. That matters
 * for two of the required cases:
 *
 *   - "a dispute raised after the window closes is rejected" is a statement
 *     about the *response status*, which only exists at the HTTP layer.
 *   - "the oracle key is never exposed in any response body" can only be
 *     checked against bytes that actually went out on the wire.
 */

import { expect } from "chai";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PublicKey } from "@solana/web3.js";

import { createApp } from "../src/http/server";
import { OracleService } from "../src/service/oracleService";
import {
  FakeChain,
  fakeKey,
  fakeProvider,
  makeTestAuth,
  makeTestContext,
  signIn,
  type TestAuth,
  type TestContext,
} from "./helpers/setup";
import { ESCROW_PROGRAM_ID, findDealAddress } from "@workspace/solana-escrow";
import { encodeBase58 } from "../src/security/base58";
import { Keypair } from "@solana/web3.js";

/** Base58 of a raw byte key, for the leak tests. */
const encodeBase58ForTest = encodeBase58;

interface Harness {
  ctx: TestContext;
  server: Server;
  baseUrl: string;
  chain: FakeChain;
  auth: TestAuth;
  /** A signed-in depositor, for the routes that now require identification. */
  depositor: Keypair;
  /** A signed-in provider. */
  provider: Keypair;
  depositorToken: string;
  providerToken: string;
  close: () => Promise<void>;
}

/**
 * Start the app with wallet-signature auth wired.
 *
 * The harness signs in as a depositor and a provider with real keypairs, so
 * every mutating call below carries a genuine session token. The default
 * challenge-window and TTLs are injected through config rather than stubbed.
 */
async function startHarness(
  options: { challengeWindowSeconds?: number; requireAuth?: boolean } = {}
): Promise<Harness> {
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

  const depositor = Keypair.generate();
  const provider = Keypair.generate();
  const depositorSession = await signIn(auth, depositor);
  const providerSession = await signIn(auth, provider);

  const app = createApp({
    deals: ctx.deals,
    disputes: ctx.disputes,
    service,
    oracle: ctx.oracle,
    logger: ctx.logger,
    registry: ctx.registry,
    defaultChallengeWindowSeconds: options.challengeWindowSeconds ?? 3600,
    runJob: () => service.runChallengeWindowJob(),
    auth: auth.service,
    requireAuth: options.requireAuth ?? true,
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    ctx,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    chain,
    auth,
    depositor,
    provider,
    depositorToken: depositorSession.token,
    providerToken: providerSession.token,
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
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* non-JSON responses would surface as a failed assertion below */
  }
  return { status: response.status, body: parsed, raw };
}

/**
 * Assert an operation is refused *before* any handler runs.
 *
 * The observable proof is that no handler-side effect occurred: a mutating call
 * with a bad token must not have created a deal. Checking the status alone would
 * miss a route that ran its logic and then decided to return 401.
 */
async function assertUnauthorized(
  url: string,
  body: unknown,
  token: string | undefined,
  ctx: TestContext
): Promise<void> {
  const res = await postJson(url, body, token);
  expect(res.status).to.equal(401);
  const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM deals");
  expect(rows[0].n, "a rejected request still reached the handler").to.equal(0);
}

/**
 * Build a token with the right shape but the wrong signing secret.
 *
 * This is the forgery a real attacker attempts: they can read a token, so they
 * know the header and payload format, and the only thing between them and a
 * session for any wallet is the HMAC. If the verifier compared signatures
 * non-constant-time or skipped the check, this would be accepted.
 */
function forgeTokenWithWrongSecret(h: Harness, wallet: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const b64 = (s: string) =>
    Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(
    JSON.stringify({
      iss: h.auth.config.issuer,
      aud: h.auth.config.audience,
      sub: wallet,
      iat: now,
      exp: now + 3600,
      jti: "forged",
    })
  );
  const signingInput = `${header}.${payload}`;
  // A wrong secret: not the one configured.
  const wrongSecret = Buffer.alloc(48, 0x11);
  const sig = createHmac("sha256", wrongSecret)
    .update(signingInput, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${signingInput}.${sig}`;
}

describe("oracle backend HTTP API", () => {
  describe("deal registration and settle request", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it("registers a deal, deriving the PDA from program seeds", async () => {
      const depositor = h.depositor.publicKey.toBase58();
      const provider = h.provider.publicKey.toBase58();
      const [expectedPda] = findDealAddress(
        ESCROW_PROGRAM_ID,
        new PublicKey(depositor),
        "deal-http"
      );

      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-http",
          depositor,
          provider,
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );

      expect(res.status).to.equal(201);
      expect(res.body.deal.dealPda).to.equal(expectedPda.toBase58());
      expect(res.body.deal.status).to.equal("pending_verification");
    });

    it("rejects registering a deal for a depositor other than the caller", async () => {
      // The forgery case for registration: a valid session, but for a wallet
      // that is not the depositor being registered.
      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-http",
          depositor: fakeKey(1),
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      expect(res.status).to.equal(403);
      expect(res.body.error).to.contain("not the depositor");
    });

    it("rejects a claimed PDA that does not match the derived one", async () => {
      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-http",
          depositor: h.depositor.publicKey.toBase58(),
          provider: h.provider.publicKey.toBase58(),
          dealPda: fakeKey(9),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      expect(res.status).to.equal(400);
      expect(res.body.error).to.contain("does not match the derived PDA");
    });

    it("rejects a deal whose oracle is not this backend", async () => {
      const res = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-http",
          depositor: h.depositor.publicKey.toBase58(),
          provider: h.provider.publicKey.toBase58(),
          oracle: fakeKey(3),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      expect(res.status).to.equal(400);
      expect(res.body.error).to.contain("is the oracle");
    });

    it("settle accepts with 202 and does not settle immediately", async () => {
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-http",
          depositor: h.depositor.publicKey.toBase58(),
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;

      const settle = await postJson(
        `${h.baseUrl}/deals/${pda}/settle`,
        {},
        h.providerToken
      );

      expect(settle.status).to.equal(202);
      expect(settle.body.outcome).to.equal("challenge_window_opened");
      expect(settle.body.deal.status).to.equal("in_challenge_window");
      expect(settle.body.deal.challengeWindowEndsAt).to.be.a("string");
      // 202 means "later", and no settle transaction has been built.
      expect(h.chain.settleCalls).to.have.length(0);
    });

    it("rejects a settle request from a wallet that is not the provider", async () => {
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-http",
          depositor: h.depositor.publicKey.toBase58(),
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;

      // The depositor's valid session cannot request settlement — that is the
      // provider's action.
      const settle = await postJson(
        `${h.baseUrl}/deals/${pda}/settle`,
        {},
        h.depositorToken
      );
      expect(settle.status).to.equal(403);
      expect(settle.body.error).to.contain("only the provider");
    });
  });

  describe("dispute endpoint", () => {
    let h: Harness;

    beforeEach(async () => {
      // A very short window so the "closed" case is testable without waiting.
      h = await startHarness({ challengeWindowSeconds: 1 });
    });
    afterEach(async () => {
      await h.close();
    });

    async function registerAndOpen() {
      const depositor = h.depositor.publicKey.toBase58();
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-dispute",
          depositor,
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;
      await postJson(`${h.baseUrl}/deals/${pda}/settle`, {}, h.providerToken);
      return { depositor, pda };
    }

    it("accepts a dispute from the depositor while the window is open", async () => {
      const { depositor, pda } = await registerAndOpen();

      const res = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: "I cannot retrieve my file",
        },
        h.depositorToken
      );

      expect(res.status).to.equal(201);
      expect(res.body.deal.status).to.equal("disputed");
      expect(res.body.dispute.reason).to.equal("I cannot retrieve my file");
      expect(res.body.dispute.resolved).to.equal(false);
    });

    it("rejects a dispute raised after the window closed, with 409", async () => {
      const { depositor, pda } = await registerAndOpen();
      await new Promise((r) => setTimeout(r, 1200));

      const res = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: "too late",
        },
        h.depositorToken
      );

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("window_closed");
    });

    it("rejects a dispute raised by someone who is not the depositor", async () => {
      const { pda } = await registerAndOpen();

      // A valid session for the provider — a different wallet entirely. The
      // token is genuine; the identity is simply not the depositor.
      const res = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        { reason: "not my deal" },
        h.providerToken
      );

      expect(res.status).to.equal(403);
      expect(res.body.error).to.contain("only the depositor");
    });

    it("rejects a dispute whose raisedBy contradicts the authenticated wallet", async () => {
      const { depositor, pda } = await registerAndOpen();

      // Authenticated as the depositor, but claiming to be someone else: the
      // field is cross-checked rather than trusted, so this is refused.
      const res = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        { raisedBy: fakeKey(7), reason: "impersonation" },
        h.depositorToken
      );

      expect(res.status).to.equal(403);
      expect(res.body.error).to.contain("does not match the authenticated wallet");
    });

    it("rejects a dispute with no reason", async () => {
      const { depositor, pda } = await registerAndOpen();
      const res = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        { raisedBy: depositor },
        h.depositorToken
      );
      expect(res.status).to.equal(400);
    });

    it("rejects a dispute on a settled deal", async () => {
      const { depositor, pda } = await registerAndOpen();
      await new Promise((r) => setTimeout(r, 1200));
      // Drive the job so the deal actually settles.
      await postJson(`${h.baseUrl}/jobs/challenge-window`, {}, h.providerToken);
      expect(h.chain.settleCalls).to.have.length(1);

      const res = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: "too late",
        },
        h.depositorToken
      );
      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("already_settled");
    });

    it("exposes the window and dispute state on GET", async () => {
      const { depositor, pda } = await registerAndOpen();
      await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: "cannot retrieve",
        },
        h.depositorToken
      );

      const res = await fetch(`${h.baseUrl}/deals/${pda}`);
      const body = (await res.json()) as any;

      expect(res.status).to.equal(200);
      expect(body.deal.status).to.equal("disputed");
      expect(body.disputes).to.have.length(1);
      expect(body.canDispute).to.equal(false);
    });
  });

  describe("mutating routes require a session", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    const dealBody = () => ({
      dealId: "auth-check",
      depositor: h.depositor.publicKey.toBase58(),
      provider: h.provider.publicKey.toBase58(),
      cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
      amountLamports: "1000000000",
    });

    it("rejects a mutating request with no token, before any handler runs", async () => {
      await assertUnauthorized(`${h.baseUrl}/deals`, dealBody(), undefined, h.ctx);
    });

    it("rejects a malformed token before any handler runs", async () => {
      await assertUnauthorized(`${h.baseUrl}/deals`, dealBody(), "not-a-jwt", h.ctx);
    });

    it("rejects a token signed with the wrong secret", async () => {
      // Structurally valid JWT, forged signature. This is the attack that the
      // constant-time HMAC comparison exists to stop.
      const forged = forgeTokenWithWrongSecret(h, h.depositor.publicKey.toBase58());
      await assertUnauthorized(`${h.baseUrl}/deals`, dealBody(), forged, h.ctx);
    });

    it("rejects an expired token with 401", async () => {
      // Sign in, then move the auth clock past the token's expiry.
      const token = h.depositorToken;
      h.auth.advanceSeconds(h.auth.config.sessionTtlSeconds + 60);
      await assertUnauthorized(`${h.baseUrl}/deals`, dealBody(), token, h.ctx);
    });

    it("rejects a token whose audience is for another service", async () => {
      const { issueSessionToken } = await import("../src/auth/sessionToken");
      const foreign = issueSessionToken({
        wallet: h.depositor.publicKey.toBase58(),
        secret: h.auth.secret.reveal(),
        issuer: "adadive-oracle-backend",
        audience: "some-other-service",
        ttlSeconds: 3600,
      });
      await assertUnauthorized(`${h.baseUrl}/deals`, dealBody(), foreign, h.ctx);
    });

    it("leaves reads and health open", async () => {
      // Health reveals the oracle public key, which is not a secret, and an
      // operator needs it when auth is misconfigured.
      expect((await fetch(`${h.baseUrl}/health`)).status).to.equal(200);
      // A read of a nonexistent deal is a 404, not a 401: reads are not
      // authenticated, and the deal id is not an authorisation boundary.
      const read = await fetch(`${h.baseUrl}/deals/${fakeKey(9)}`);
      expect(read.status).to.equal(404);
    });

    it("admits a genuine session", async () => {
      const res = await postJson(`${h.baseUrl}/deals`, dealBody(), h.depositorToken);
      expect(res.status).to.equal(201);
    });

    it("has no configuration that bypasses the session check", async () => {
      // Phase 3 had an `authorize` hook that tests could pass to admit a request
      // without a session. It is gone: with a real `auth` configured, any such
      // hook could only be a bypass. This asserts that supplying one has no
      // effect, so the property cannot regress by someone re-adding it.
      const ctx = await makeTestContext();
      const chain = new FakeChain();
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
      const auth = makeTestAuth(ctx.pool, ctx.registry, ctx.logger);
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
        // @ts-expect-error proving the removed hook is not honoured
        authorize: () => true,
      });
      const server = app.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const res = await postJson(`http://127.0.0.1:${port}/deals`, {
          dealId: "bypass-attempt",
          depositor: fakeKey(1),
          provider: fakeKey(2),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        });
        expect(res.status).to.equal(401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await ctx.pool.end();
      }
    });
  });

  describe("development posture (auth explicitly disabled)", () => {
    it("allows mutating routes when requireAuth is false and no auth is wired", async () => {
      // `AUTH_REQUIRED=false`, which `loadConfig` refuses in production. Built
      // here without an AuthService to reproduce the development shape.
      const ctx = await makeTestContext();
      const chain = new FakeChain();
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
        requireAuth: false,
      });
      const server = app.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const res = await postJson(`http://127.0.0.1:${port}/deals`, {
          dealId: "dev-posture",
          depositor: fakeKey(1),
          provider: fakeKey(2),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        });
        expect(res.status).to.equal(201);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await ctx.pool.end();
      }
    });

    it("refuses when requireAuth is true and no auth is configured", async () => {
      const ctx = await makeTestContext();
      const chain = new FakeChain();
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
        requireAuth: true,
      });
      const server = app.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const res = await postJson(`http://127.0.0.1:${port}/deals`, {
          dealId: "no-auth",
          depositor: fakeKey(1),
          provider: fakeKey(2),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        });
        expect(res.status).to.equal(401);
        expect(res.body.detail).to.contain("no auth service is configured");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await ctx.pool.end();
      }
    });
  });

  /**
   * The "never in any response body" requirement, checked against real bytes.
   *
   * Every route is exercised — success, 4xx and a forced 5xx — and each response
   * body is scanned for the oracle key in all its encodings. The 5xx case uses a
   * chain that fails with the key embedded in its error text, which is the
   * realistic leak (an SDK quoting the credential it rejected) and the one the
   * registry plus `scrubKeyShapedTokens` have to catch together.
   */
  describe("no route ever returns the oracle key", () => {
    let h: Harness;
    let keyForms: Record<string, string>;

    beforeEach(async () => {
      h = await startHarness({ challengeWindowSeconds: 1 });
      const secretKey = h.ctx.oracle.signer.secretKey;
      const sessionSecret = h.auth.secret.reveal();
      keyForms = {
        base58: h.ctx.oracle.publicKey.toBase58(), // public — expected to appear
        secretJson: JSON.stringify(Array.from(secretKey)),
        secretHex: Buffer.from(secretKey).toString("hex"),
        secretBase64: Buffer.from(secretKey).toString("base64"),
        // The session signing secret is a symmetric key with no public half, so
        // the sign-in routes must not echo it either.
        sessionSecretHex: Buffer.from(sessionSecret).toString("hex"),
        sessionSecretBase64: Buffer.from(sessionSecret).toString("base64"),
      };
    });
    afterEach(async () => {
      await h.close();
    });

    function assertClean(raw: string, where: string) {
      for (const [name, value] of Object.entries(keyForms)) {
        if (name === "base58") continue; // the public key is fine
        if (value.length < 8) continue;
        expect(raw, `${where} leaked a secret as ${name}`).not.to.contain(value);
      }
      expect(raw, `${where} leaked the words "secretKey"`).not.to.contain(
        "secretKey"
      );
    }

    it("stays clean across health, auth, registration, settle, dispute, GET and job", async () => {
      const responses: Array<{ where: string; raw: string }> = [];

      const health = await fetch(`${h.baseUrl}/health`);
      responses.push({ where: "GET /health", raw: await health.text() });

      // The sign-in flow, including both failure modes, since it is the route
      // most likely to echo input back.
      const challenge = await postJson(`${h.baseUrl}/auth/challenge`, {
        wallet: h.depositor.publicKey.toBase58(),
      });
      responses.push({ where: "POST /auth/challenge", raw: challenge.raw });

      const badVerify = await postJson(`${h.baseUrl}/auth/verify`, {
        wallet: h.depositor.publicKey.toBase58(),
        nonce: challenge.body.nonce,
        signature: "not-a-signature",
      });
      responses.push({ where: "POST /auth/verify (401)", raw: badVerify.raw });

      const badWallet = await postJson(`${h.baseUrl}/auth/challenge`, {
        wallet: "not-a-key",
      });
      responses.push({ where: "POST /auth/challenge (400)", raw: badWallet.raw });

      const depositor = h.depositor.publicKey.toBase58();
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-leak",
          depositor,
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      responses.push({ where: "POST /deals", raw: reg.raw });
      const pda = reg.body.deal.dealPda;

      const settle = await postJson(
        `${h.baseUrl}/deals/${pda}/settle`,
        {},
        h.providerToken
      );
      responses.push({ where: "POST /settle", raw: settle.raw });

      const get = await fetch(`${h.baseUrl}/deals/${pda}`);
      responses.push({ where: "GET /deals/:id", raw: await get.text() });

      const dispute = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: "cannot retrieve",
        },
        h.depositorToken
      );
      responses.push({ where: "POST /dispute", raw: dispute.raw });

      // Error paths: bad PDA, foreign oracle, non-depositor dispute, not found.
      const badPda = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-leak",
          depositor,
          provider: h.provider.publicKey.toBase58(),
          dealPda: fakeKey(9),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      responses.push({ where: "POST /deals (bad pda)", raw: badPda.raw });

      const forbidden = await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        { reason: "not mine" },
        h.providerToken
      );
      responses.push({ where: "POST /dispute (403)", raw: forbidden.raw });

      const unauthorized = await postJson(`${h.baseUrl}/jobs/challenge-window`, {});
      responses.push({ where: "POST /jobs (401)", raw: unauthorized.raw });

      const missing = await fetch(`${h.baseUrl}/deals/${fakeKey(9)}`);
      responses.push({
        where: "GET /deals/:id (404)",
        raw: await missing.text(),
      });

      const job = await postJson(
        `${h.baseUrl}/jobs/challenge-window`,
        {},
        h.providerToken
      );
      responses.push({ where: "POST /jobs", raw: job.raw });

      expect(responses.length).to.be.greaterThan(7);
      for (const { where, raw } of responses) assertClean(raw, where);
    });

    it("does not leak the key when settle submission fails with a key-bearing error", async () => {
      // The realistic leak: an RPC/SDK error that quotes the credential it
      // rejected. `safeErrorMessage` must scrub it before it becomes a response.
      const secretBase58 = encodeBase58ForTest(h.ctx.oracle.signer.secretKey);
      h.chain.failWith = new Error(
        `Transaction simulation failed: signature verification failed for key ${secretBase58}`
      );

      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-leak-5xx",
          depositor: h.depositor.publicKey.toBase58(),
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;
      await postJson(`${h.baseUrl}/deals/${pda}/settle`, {}, h.providerToken);
      await new Promise((r) => setTimeout(r, 1200));

      const job = await postJson(
        `${h.baseUrl}/jobs/challenge-window`,
        {},
        h.providerToken
      );

      expect(job.raw).not.to.contain(secretBase58);
      expect(job.raw).to.contain("[redacted]");
      // And the deal is recoverable rather than lost.
      const state = await fetch(`${h.baseUrl}/deals/${pda}`);
      const body = (await state.json()) as any;
      expect(body.deal.status).to.equal("in_challenge_window");
    });

    it("does not leak the key in a dispute reason that echoes it back", async () => {
      // A caller could echo the key into a reason string; it must not come back
      // out verbatim through the GET, to avoid the API laundering it into logs.
      const secretBase58 = encodeBase58ForTest(h.ctx.oracle.signer.secretKey);
      const depositor = h.depositor.publicKey.toBase58();
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-leak-reason",
          depositor,
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;
      await postJson(`${h.baseUrl}/deals/${pda}/settle`, {}, h.providerToken);
      await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: `the oracle ${secretBase58} never settled`,
        },
        h.depositorToken
      );

      const get = await fetch(`${h.baseUrl}/deals/${pda}`);
      const body = (await get.json()) as any;
      expect(body.disputes[0].reason).not.to.contain(secretBase58);
      expect(body.disputes[0].reason).to.contain("[redacted]");
    });
  });

  describe("the challenge-window job endpoint", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await startHarness({ challengeWindowSeconds: 1 });
    });
    afterEach(async () => {
      await h.close();
    });

    it("settles a due, undisputed deal", async () => {
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-job",
          depositor: h.depositor.publicKey.toBase58(),
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;
      await postJson(`${h.baseUrl}/deals/${pda}/settle`, {}, h.providerToken);
      await new Promise((r) => setTimeout(r, 1200));

      const run = await postJson(
        `${h.baseUrl}/jobs/challenge-window`,
        {},
        h.providerToken
      );

      expect(run.status).to.equal(200);
      expect(run.body.scanned).to.equal(1);
      expect(run.body.results[0].action).to.equal("settled");

      const state = await fetch(`${h.baseUrl}/deals/${pda}`);
      expect(((await state.json()) as any).deal.status).to.equal("settled");
    });

    it("does not settle a disputed deal", async () => {
      const depositor = h.depositor.publicKey.toBase58();
      const reg = await postJson(
        `${h.baseUrl}/deals`,
        {
          dealId: "deal-job-disputed",
          depositor,
          provider: h.provider.publicKey.toBase58(),
          cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
          amountLamports: "1000000000",
        },
        h.depositorToken
      );
      const pda = reg.body.deal.dealPda;
      await postJson(`${h.baseUrl}/deals/${pda}/settle`, {}, h.providerToken);
      await postJson(
        `${h.baseUrl}/deals/${pda}/dispute`,
        {
          raisedBy: depositor,
          reason: "cannot retrieve",
        },
        h.depositorToken
      );
      await new Promise((r) => setTimeout(r, 1200));

      const run = await postJson(
        `${h.baseUrl}/jobs/challenge-window`,
        {},
        h.providerToken
      );

      expect(run.body.scanned).to.equal(0);
      expect(h.chain.settleCalls).to.have.length(0);
    });
  });
});
