/**
 * The challenge-window core: settlement gated by a dispute.
 *
 * These tests run against a real Postgres, because the property under test is
 * transactional: a dispute and a settle claim must not both succeed. A mock
 * would assert that the mock behaves, which is not the question.
 *
 * The other deliberate choice: instead of mocking the clock (which would also
 * have to be mocked *inside* Postgres, since the job's authoritative window
 * check is `challenge_window_ends_at <= now()`), tests use a one-second window
 * and wait for it. That keeps the tested path identical to production — the
 * same SQL, the same comparison — at the cost of a second per timing test.
 */

import { expect } from "chai";
import type { PinVerification } from "../src/pinata/pinStatus";
import type { Pool } from "pg";

import { OracleService } from "../src/service/oracleService";
import {
  FakeChain,
  fakeKey,
  fakeProvider,
  makeTestContext,
  truncateAll,
  type TestContext,
} from "./helpers/setup";

const ONE_SECOND_WINDOW = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("optimistic challenge settlement", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestContext();
  });

  afterEach(async () => {
    await ctx.pool.end();
  });

  /** A registered deal in `pending_verification`, using this context's oracle. */
  async function registerDeal(overrides: Record<string, unknown> = {}) {
    return ctx.deals.create({
      dealId: "deal-1",
      dealPda: fakeKey(200),
      depositor: fakeKey(1),
      provider: fakeKey(2),
      oracle: ctx.oracle.publicKey.toBase58(),
      cid: "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y",
      amountLamports: 1_000_000_000n,
      challengeWindowSeconds: ONE_SECOND_WINDOW,
      ...overrides,
    });
  }

  function makeService(options: {
    chain: FakeChain;
    verifyPin?: (cid: string) => Promise<PinVerification>;
  }): OracleService {
    return new OracleService({
      deals: ctx.deals,
      disputes: ctx.disputes,
      verifyPin:
        options.verifyPin ??
        (async () => ({
          ok: true,
          reason: "pinned_and_retrievable",
          detail: "stub: pinned",
        })),
      chain: options.chain,
      oracle: ctx.oracle,
      logger: ctx.logger,
      registry: ctx.registry,
      providerSignatureStrategy: "demo-keypair",
      demoProvider: fakeProvider(),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Pin verification gates the window                                 */
  /* ---------------------------------------------------------------- */

  it("does not open a challenge window when the pin is not verified", async () => {
    const chain = new FakeChain();
    const service = makeService({
      chain,
      verifyPin: async () => ({
        ok: false,
        reason: "not_pinned",
        detail: "Pinata reports no pin",
      }),
    });

    const deal = await registerDeal();
    const result = await service.requestSettle(deal);

    expect(result.ok).to.equal(false);
    expect(result.outcome).to.equal("not_pinned");
    // No window, and definitively no settle.
    const after = await ctx.deals.findById(deal.id);
    expect(after?.status).to.equal("settlement_failed");
    expect(after?.challengeWindowEndsAt).to.equal(null);
    expect(chain.settleCalls).to.have.length(0);
  });

  it("does not open a window when verification itself errors, and stays retryable", async () => {
    const chain = new FakeChain();
    const service = makeService({
      chain,
      verifyPin: async () => {
        throw new Error("pinata 503");
      },
    });

    const deal = await registerDeal();
    const result = await service.requestSettle(deal);

    expect(result.ok).to.equal(false);
    expect(result.outcome).to.equal("verification_error");
    // Still pending, not failed: an outage must not kill the deal.
    const after = await ctx.deals.findById(deal.id);
    expect(after?.status).to.equal("pending_verification");
    expect(chain.settleCalls).to.have.length(0);
  });

  it("verifies against the CID stored on the deal, not one supplied by the caller", async () => {
    const chain = new FakeChain();
    const seenCids: string[] = [];
    const service = makeService({
      chain,
      verifyPin: async (cid: string) => {
        seenCids.push(cid);
        return { ok: true, reason: "pinned_and_retrievable" as const, detail: "stub" };
      },
    });

    const deal = await registerDeal();
    await service.requestSettle(deal);

    expect(seenCids).to.deep.equal([deal.cid]);
  });

  it("opens a challenge window on verified pin without settling", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal();
    const result = await service.requestSettle(deal);

    expect(result.ok).to.equal(true);
    expect(result.outcome).to.equal("challenge_window_opened");
    if (result.ok) {
      expect(result.deal.status).to.equal("in_challenge_window");
      expect(result.deal.challengeWindowEndsAt).to.not.equal(null);
      // Roughly the configured window away.
      const deltaSeconds =
        (result.deal.challengeWindowEndsAt!.getTime() - Date.now()) / 1000;
      expect(deltaSeconds).to.be.greaterThan(0);
      expect(deltaSeconds).to.be.lessThanOrEqual(ONE_SECOND_WINDOW + 1);
    }
    // The load-bearing assertion: verified does NOT mean settled.
    expect(chain.settleCalls).to.have.length(0);
  });

  it("is idempotent: a second settle request does not extend the window", async () => {
    const service = makeService({ chain: new FakeChain() });

    const deal = await registerDeal();
    const first = await service.requestSettle(deal);
    expect(first.ok).to.equal(true);
    const endsAt = first.ok ? first.deal.challengeWindowEndsAt!.getTime() : 0;

    await sleep(600);
    const second = await service.requestSettle(
      (await ctx.deals.findById(deal.id))!
    );

    expect(second.ok).to.equal(true);
    if (second.ok) {
      // Unchanged, so a provider cannot farm extra window time by re-requesting.
      expect(second.deal.challengeWindowEndsAt?.getTime()).to.equal(endsAt);
    }
  });

  /* ---------------------------------------------------------------- */
  /* No dispute → auto-settle                                         */
  /* ---------------------------------------------------------------- */

  it("auto-settles once the window closes with no dispute", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal();
    await service.requestSettle(deal);

    // Window not elapsed yet: the job must do nothing.
    const early = await service.runChallengeWindowJob();
    expect(early.scanned).to.equal(0);
    expect(chain.settleCalls).to.have.length(0);

    await sleep(1200);
    const run = await service.runChallengeWindowJob();

    expect(run.scanned).to.equal(1);
    expect(run.results[0].action).to.equal("settled");
    expect(chain.settleCalls).to.have.length(1);

    const after = await ctx.deals.findById(deal.id);
    expect(after?.status).to.equal("settled");
    expect(after?.settleTxSignature).to.equal("FAKE_SIG_1");
    expect(after?.settleError).to.equal(null);
  });

  it("does not settle a deal whose window is still open", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 3600 });
    await service.requestSettle(deal);

    const run = await service.runChallengeWindowJob();

    expect(run.scanned).to.equal(0);
    expect(chain.settleCalls).to.have.length(0);
    expect((await ctx.deals.findById(deal.id))?.status).to.equal(
      "in_challenge_window"
    );
  });

  /* ---------------------------------------------------------------- */
  /* Dispute → no auto-settle                                         */
  /* ---------------------------------------------------------------- */

  it("a dispute raised inside the window blocks auto-settle", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 3 });
    await service.requestSettle(deal);

    const dispute = await ctx.disputes.raise(
      deal.id,
      deal.depositor,
      "I cannot retrieve my file"
    );
    expect(dispute.ok).to.equal(true);

    const afterDispute = await ctx.deals.findById(deal.id);
    expect(afterDispute?.status).to.equal("disputed");

    await sleep(3200);
    const run = await service.runChallengeWindowJob();

    // The deal is not even scanned: the job's query excludes disputed deals.
    expect(run.scanned).to.equal(0);
    expect(chain.settleCalls).to.have.length(0);
    expect((await ctx.deals.findById(deal.id))?.status).to.equal("disputed");
  });

  it("a dispute raised after the window closes is rejected", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);
    await sleep(1200);

    const result = await ctx.disputes.raise(
      deal.id,
      deal.depositor,
      "too late"
    );

    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.code).to.equal("window_closed");
    // And the deal is untouched, still settleable by the job.
    expect((await ctx.deals.findById(deal.id))?.status).to.equal(
      "in_challenge_window"
    );
  });

  it("a dispute is rejected once the deal has settled", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);
    await sleep(1200);
    await service.runChallengeWindowJob();
    expect((await ctx.deals.findById(deal.id))?.status).to.equal("settled");

    const result = await ctx.disputes.raise(deal.id, deal.depositor, "late");
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.code).to.equal("already_settled");
  });

  it("rejects a second dispute while one is already open", async () => {
    const service = makeService({ chain: new FakeChain() });
    const deal = await registerDeal({ challengeWindowSeconds: 60 });
    await service.requestSettle(deal);

    const first = await ctx.disputes.raise(deal.id, deal.depositor, "one");
    expect(first.ok).to.equal(true);
    const second = await ctx.disputes.raise(deal.id, deal.depositor, "two");

    expect(second.ok).to.equal(false);
    if (!second.ok) expect(second.code).to.equal("already_disputed");
    // Exactly one dispute row, so the table cannot be grown by retrying.
    expect(await ctx.disputes.listForDeal(deal.id)).to.have.length(1);
  });

  it("a dispute raised near the end of the window still blocks settlement once the window elapses", async () => {
    // The interleaving that matters: the dispute lands while the window is
    // *still open* but close to expiry, so the job must still find the deal
    // excluded when it next runs. (A dispute raised strictly *after* the window
    // closes is refused outright — see the test above — so this is the latest
    // moment a dispute can legitimately arrive.)
    const chain = new FakeChain();
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 2 });
    await service.requestSettle(deal);
    await sleep(1000); // window still open

    const dispute = await ctx.disputes.raise(
      deal.id,
      deal.depositor,
      "raised just before the deadline"
    );
    expect(dispute.ok).to.equal(true);

    await sleep(1200); // window now elapsed
    const run = await service.runChallengeWindowJob();

    expect(run.scanned).to.equal(0);
    expect(chain.settleCalls).to.have.length(0);
    expect((await ctx.deals.findById(deal.id))?.status).to.equal("disputed");
  });

  it("a settle claim cannot proceed on a deal whose window already closed disputed", async () => {
    // Directly exercises the SQL guard: even if application logic tried to
    // claim this deal, the conditional UPDATE matches nothing.
    const service = makeService({ chain: new FakeChain() });
    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);
    await ctx.disputes.raise(deal.id, deal.depositor, "blocked");
    await sleep(1200);

    const claimed = await ctx.deals.claimDueForSettlement(deal.id);
    expect(claimed).to.equal(null);
  });

  /* ---------------------------------------------------------------- */
  /* Failure handling                                                  */
  /* ---------------------------------------------------------------- */

  it("returns a deal to the window when settle submission fails, and retries", async () => {
    const chain = new FakeChain();
    chain.failWith = new Error("RPC unavailable");
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);
    await sleep(1200);

    const failed = await service.runChallengeWindowJob();
    expect(failed.results[0].action).to.equal("settle_failed");

    const afterFailure = await ctx.deals.findById(deal.id);
    // Back in the window (with the elapsed end), so the next tick retries it.
    expect(afterFailure?.status).to.equal("in_challenge_window");
    expect(afterFailure?.settleError).to.contain("RPC unavailable");

    // Next run, with the failure cleared, settles.
    chain.failWith = null;
    const retry = await service.runChallengeWindowJob();
    expect(retry.results[0].action).to.equal("settled");
    expect((await ctx.deals.findById(deal.id))?.status).to.equal("settled");
  });

  it("a transient failure does not let a deal settle after a later dispute", async () => {
    const chain = new FakeChain();
    chain.failWith = new Error("RPC unavailable");
    const service = makeService({ chain });

    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);
    await sleep(1200);
    await service.runChallengeWindowJob();
    expect((await ctx.deals.findById(deal.id))?.status).to.equal(
      "in_challenge_window"
    );

    // Now the depositor disputes. The window has *elapsed*, so a dispute is
    // refused — the honest behaviour, and the reason the window must be
    // meaningfully longer than the retry interval in production.
    const late = await ctx.disputes.raise(deal.id, deal.depositor, "too late");
    expect(late.ok).to.equal(false);

    // The retry settles, which is correct: no dispute exists.
    chain.failWith = null;
    const retry = await service.runChallengeWindowJob();
    expect(retry.results[0].action).to.equal("settled");
  });

  /* ---------------------------------------------------------------- */
  /* Idempotency / re-registration                                     */
  /* ---------------------------------------------------------------- */

  it("re-registering a settled deal does not reset it into a window", async () => {
    // A reset here would be a denial-of-service vector: re-register a disputed
    // or settled deal and watch it become settleable again.
    const service = makeService({ chain: new FakeChain() });
    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);
    await sleep(1200);
    await service.runChallengeWindowJob();

    const again = await ctx.deals.create({
      dealId: "deal-1",
      dealPda: deal.dealPda,
      depositor: deal.depositor,
      provider: deal.provider,
      oracle: deal.oracle,
      cid: deal.cid,
      amountLamports: deal.amountLamports,
      challengeWindowSeconds: 3600,
    });

    expect(again.id).to.equal(deal.id);
    expect(again.status).to.equal("settled");
    // The window end recorded at settle time is unchanged, and the settled
    // status was not reset: re-registration touched nothing.
    const settled = (await ctx.deals.findById(deal.id))!;
    expect(again.challengeWindowEndsAt?.getTime()).to.equal(
      settled.challengeWindowEndsAt?.getTime()
    );
    expect(again.challengeWindowSeconds).to.equal(1);
  });

  it("refuses to settle a refunded deal", async () => {
    const chain = new FakeChain();
    const service = makeService({ chain });
    const deal = await registerDeal({ challengeWindowSeconds: 1 });
    await service.requestSettle(deal);

    await ctx.deals.markRefunded(deal.id);
    await sleep(1200);
    const run = await service.runChallengeWindowJob();

    expect(run.scanned).to.equal(0);
    expect(chain.settleCalls).to.have.length(0);
  });
});
