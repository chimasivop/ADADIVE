/**
 * `ProviderVerificationService` — one sweep, with the DHT and the api-server's
 * internal feed both faked at their boundaries.
 *
 * These are *stubbed-service* tests in the AGENTS.md taxonomy: the service's own
 * job logic (which findings get written back, and which do not) is real, while
 * its two collaborators — the internal feed (an HTTP client) and the findprovs
 * client — are replaced with in-memory doubles. No database, no live node, no
 * second service.
 *
 * The behaviours that matter:
 *
 *   - a real verdict (`verified` / `at_risk`) is written back;
 *   - an `unknown` verdict is *not* written, so a Kubo outage cannot blank the
 *     stored state;
 *   - one assignment failing does not abort the sweep.
 */

import { expect } from "chai";

import { ProviderVerificationService } from "../src/provider/providerVerificationService";
import type { InternalProviderFeed } from "../src/provider/internalFeed";
import type { AssignmentView } from "../src/provider/providerVerification";
import type { FindProvsResult, KuboFindProvsClient } from "../src/ipfs/findprovs";
import { FindProvsTransportError } from "../src/ipfs/findprovs";
import { SilentTestLogger } from "./helpers/silentLogger";
import { SecretRegistry } from "../src/security/redact";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const NOW = new Date("2024-06-01T12:00:00.000Z");
const STALE_MS = 3 * 60_000;

/** A feed double that records what the service wrote. */
class FakeFeed {
  readonly verdicts: Array<{
    assignmentId: number;
    atRisk: boolean;
    detail: string;
    streak: number;
  }> = [];
  /** Streak-only writes, kept apart from full verdicts so tests can tell them apart. */
  readonly streakWrites: Array<{ assignmentId: number; streak: number }> = [];
  private readonly assignments: AssignmentView[];

  constructor(assignments: AssignmentView[]) {
    this.assignments = assignments;
  }

  async listAssignments(): Promise<AssignmentView[]> {
    return this.assignments;
  }

  async recordVerdict(
    assignmentId: number,
    atRisk: boolean,
    detail: string,
    streak: number
  ): Promise<void> {
    this.verdicts.push({ assignmentId, atRisk, detail, streak });
  }

  async recordNegativeStreak(assignmentId: number, streak: number): Promise<void> {
    this.streakWrites.push({ assignmentId, streak });
  }
}

/** A findprovs double keyed by CID. */
class FakeFindProvs {
  private readonly answers: Record<string, FindProvsResult | Error>;

  constructor(answers: Record<string, FindProvsResult | Error>) {
    this.answers = answers;
  }

  async isPeerAdvertising(cid: string, _peerId: string): Promise<FindProvsResult> {
    const answer = this.answers[cid];
    if (answer === undefined) throw new Error(`no fake answer for ${cid}`);
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

function assignment(overrides: Partial<AssignmentView> = {}): AssignmentView {
  return {
    assignmentId: 1,
    dealId: 7,
    cid: CID,
    dealStatus: "active",
    providerId: 3,
    peerId: PEER,
    status: "confirmed",
    lastHeartbeatAt: NOW.toISOString(),
    consecutiveConclusiveNegatives: 0,
    ...overrides,
  };
}

/**
 * Threshold 1 by default: the existing tests here isolate "is the verdict written
 * or not", not the streak length. The streak suite below passes 3 explicitly.
 */
function buildService(
  assignments: AssignmentView[],
  findProvs: FakeFindProvs,
  consecutiveNegatives = 1
): { service: ProviderVerificationService; feed: FakeFeed } {
  const feed = new FakeFeed(assignments);
  const service = new ProviderVerificationService({
    feed: feed as unknown as InternalProviderFeed,
    findProvs: findProvs as unknown as KuboFindProvsClient,
    logger: new SilentTestLogger(),
    registry: new SecretRegistry(),
    heartbeatStaleMs: STALE_MS,
    consecutiveNegatives,
    now: () => NOW,
  });
  return { service, feed };
}

describe("ProviderVerificationService", () => {
  it("records at_risk when heartbeat is stale and the peer is not advertising", async () => {
    const stale = new Date(NOW.getTime() - STALE_MS - 1000).toISOString();
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale })],
      new FakeFindProvs({
        [CID]: { advertising: false, providerCount: 1, conclusive: true, detail: "not advertising" },
      })
    );

    const summary = await service.runOnce();

    expect(summary.atRisk).to.equal(1);
    expect(feed.verdicts).to.have.length(1);
    expect(feed.verdicts[0].assignmentId).to.equal(1);
    expect(feed.verdicts[0].atRisk).to.equal(true);
  });

  it("records verified (atRisk=false) when the peer is still advertising", async () => {
    const { service, feed } = buildService(
      [assignment()],
      new FakeFindProvs({
        [CID]: { advertising: true, providerCount: 3, conclusive: true, detail: "advertising" },
      })
    );

    const summary = await service.runOnce();

    expect(summary.verified).to.equal(1);
    expect(feed.verdicts).to.have.length(1);
    expect(feed.verdicts[0].atRisk).to.equal(false);
  });

  it("does NOT write a verdict when the DHT query fails (leaves stored state alone)", async () => {
    const stale = new Date(NOW.getTime() - STALE_MS - 1000).toISOString();
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale })],
      new FakeFindProvs({ [CID]: new FindProvsTransportError("Kubo is down", 502) })
    );

    const summary = await service.runOnce();

    expect(summary.unknown).to.equal(1);
    // The load-bearing assertion: nothing was written, so a previous atRisk value
    // (or its absence) is untouched.
    expect(feed.verdicts).to.have.length(0);
  });

  it("does NOT write a verdict for an inconclusive DHT answer", async () => {
    const stale = new Date(NOW.getTime() - STALE_MS - 1000).toISOString();
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale })],
      new FakeFindProvs({
        [CID]: { advertising: false, providerCount: 20, conclusive: false, detail: "hit the limit" },
      })
    );

    await service.runOnce();

    expect(feed.verdicts).to.have.length(0);
  });

  it("leaves the stored at-risk verdict unchanged for every inconclusive shape", async () => {
    // Codex case 6: end-to-end, not just the parser's return value. A stale
    // heartbeat is one half of at-risk; each of these DHT answers is inconclusive,
    // so `decideAssignment` must return `unknown` and the service must write
    // nothing — which is what "the stored state is unchanged" means, since a
    // previous atRisk value lives in the row this would otherwise overwrite.
    //
    // Deliberately varied: an error-only payload, a success followed by an error,
    // a truncated stream that named a peer but never returned a response, and an
    // unrecognised framing. All reach the client as the same `conclusive: false`.
    const stale = new Date(NOW.getTime() - STALE_MS - 1000).toISOString();
    const inconclusiveDetails = [
      "the findprovs stream contained a query error for the CID (0 providers parsed); inconclusive",
      "the findprovs stream contained a query error after a response; inconclusive",
      "the response was not a recognisable, completed findprovs stream (0 providers parsed); inconclusive",
      "the DHT returned 20 providers (the search limit) and the peer was not among them; inconclusive",
    ];

    for (const detail of inconclusiveDetails) {
      const { service, feed } = buildService(
        [assignment({ lastHeartbeatAt: stale })],
        new FakeFindProvs({
          [CID]: { advertising: false, providerCount: 0, conclusive: false, detail },
        })
      );

      const summary = await service.runOnce();

      expect(summary.unknown, `detail: ${detail}`).to.equal(1);
      expect(summary.atRisk, `detail: ${detail}`).to.equal(0);
      // The load-bearing assertion: with a stale heartbeat the deal *would* be
      // at-risk if the answer were conclusive absence. Nothing was written, so an
      // existing at-risk flag (or its absence) is untouched.
      expect(feed.verdicts, `detail: ${detail}`).to.have.length(0);
    }
  });

  it("processes every assignment and counts each outcome", async () => {
    const stale = new Date(NOW.getTime() - STALE_MS - 1000).toISOString();
    const cid2 = "bafyOTHER0000000000000000000000000000000000000000000000000000000000";
    const { service, feed } = buildService(
      [
        assignment({ assignmentId: 1, cid: CID, lastHeartbeatAt: stale }),
        assignment({ assignmentId: 2, dealId: 8, cid: cid2, lastHeartbeatAt: NOW.toISOString() }),
      ],
      new FakeFindProvs({
        [CID]: { advertising: false, providerCount: 1, conclusive: true, detail: "missing" },
        [cid2]: { advertising: true, providerCount: 2, conclusive: true, detail: "ok" },
      })
    );

    const summary = await service.runOnce();

    expect(summary.scanned).to.equal(2);
    expect(summary.atRisk).to.equal(1);
    expect(summary.verified).to.equal(1);
    expect(feed.verdicts).to.have.length(2);
  });

  it("returns an empty summary when the feed itself could not be read", async () => {
    const feed = {
      listAssignments: async () => {
        throw new Error("api-server unreachable");
      },
    };
    const service = new ProviderVerificationService({
      feed: feed as unknown as InternalProviderFeed,
      findProvs: new FakeFindProvs({}) as unknown as KuboFindProvsClient,
      logger: new SilentTestLogger(),
      registry: new SecretRegistry(),
      heartbeatStaleMs: STALE_MS,
      consecutiveNegatives: 1,
      now: () => NOW,
    });

    const summary = await service.runOnce();

    expect(summary.scanned).to.equal(0);
    expect(summary.results).to.have.length(0);
  });

  it("does one assignment's failure stop the sweep? no", async () => {
    const cid2 = "bafyOTHER0000000000000000000000000000000000000000000000000000000000";
    const findProvs = {
      // First CID throws a transport error; the second must still be processed.
      isPeerAdvertising: async (cid: string) => {
        if (cid === CID) throw new FindProvsTransportError("boom");
        return { advertising: true, providerCount: 1, conclusive: true, detail: "ok" };
      },
    };
    const feed = new FakeFeed([
      assignment({ assignmentId: 1, cid: CID }),
      assignment({ assignmentId: 2, dealId: 8, cid: cid2 }),
    ]);
    const service = new ProviderVerificationService({
      feed: feed as unknown as InternalProviderFeed,
      findProvs: findProvs as unknown as KuboFindProvsClient,
      logger: new SilentTestLogger(),
      registry: new SecretRegistry(),
      heartbeatStaleMs: STALE_MS,
      consecutiveNegatives: 1,
      now: () => NOW,
    });

    const summary = await service.runOnce();

    expect(summary.scanned).to.equal(2);
    expect(summary.unknown).to.equal(1);
    expect(summary.verified).to.equal(1);
    expect(feed.verdicts).to.have.length(1);
    expect(feed.verdicts[0].assignmentId).to.equal(2);
  });
});

/**
 * The consecutive-negative streak, end to end through the service.
 *
 * The headline behaviour: a *single* truncated-but-apparently-conclusive negative
 * does NOT flag a deal at-risk. Only a sustained run does. This is the mitigation
 * for the fact that a findprovs stream has no terminal sentinel, so a response
 * that ends cleanly but early is indistinguishable from a completed search — one
 * such answer must never be enough on its own.
 *
 * These drive the real `runOnce` loop and assert on what it writes, so they cover
 * both the decision rule and the service's choice of *which* write to make.
 */
describe("ProviderVerificationService — consecutive-negative streak", () => {
  const stale = new Date(NOW.getTime() - STALE_MS - 1000).toISOString();
  const missing: FindProvsResult = {
    advertising: false,
    providerCount: 1,
    conclusive: true,
    detail: "not advertising",
  };

  /** Run `sweeps` sweeps, carrying the stored streak forward between them. */
  async function runSweeps(
    sweeps: number,
    storedStreak: number,
    consecutiveNegatives = 3
  ): Promise<{ feed: FakeFeed; summaries: Awaited<ReturnType<ProviderVerificationService["runOnce"]>>[] }> {
    // The assignment's stored streak is what the feed reports each tick; the
    // service reads it, decides, and writes the new value back. Rebuild the
    // service per sweep with the value the previous sweep wrote, mirroring the
    // round-trip through the database.
    const summaries = [];
    let feed: FakeFeed | null = null;
    let streak = storedStreak;
    for (let i = 0; i < sweeps; i++) {
      const built = buildService(
        [assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: streak })],
        new FakeFindProvs({ [CID]: missing }),
        consecutiveNegatives
      );
      summaries.push(await built.service.runOnce());
      feed = built.feed;
      // Mirror the write back into the next sweep's stored value.
      if (built.feed.verdicts.length > 0) {
        streak = built.feed.verdicts[0].streak;
      } else if (built.feed.streakWrites.length > 0) {
        streak = built.feed.streakWrites[built.feed.streakWrites.length - 1].streak;
      }
    }
    return { feed: feed as FakeFeed, summaries };
  }

  it("does NOT flag a deal on a single conclusive negative", async () => {
    // The exact regression the review asked to prevent: one negative is not
    // enough at the default threshold of 3.
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale })],
      new FakeFindProvs({ [CID]: missing }),
      3
    );

    const summary = await service.runOnce();

    expect(summary.atRisk).to.equal(0);
    expect(summary.unknown).to.equal(1);
    // No verdict written at all — so an existing at-risk flag (or its absence) is
    // untouched. This is the load-bearing assertion.
    expect(feed.verdicts).to.have.length(0);
    // But the counter advanced, so a later sweep can reach the threshold.
    expect(feed.streakWrites).to.deep.equal([{ assignmentId: 1, streak: 1 }]);
  });

  it("does NOT flag on the second consecutive negative", async () => {
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 1 })],
      new FakeFindProvs({ [CID]: missing }),
      3
    );

    const summary = await service.runOnce();

    expect(summary.atRisk).to.equal(0);
    expect(feed.verdicts).to.have.length(0);
    expect(feed.streakWrites).to.deep.equal([{ assignmentId: 1, streak: 2 }]);
  });

  it("flags at-risk only once the third consecutive negative is seen", async () => {
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 })],
      new FakeFindProvs({ [CID]: missing }),
      3
    );

    const summary = await service.runOnce();

    expect(summary.atRisk).to.equal(1);
    expect(feed.verdicts).to.have.length(1);
    expect(feed.verdicts[0].atRisk).to.equal(true);
    expect(feed.verdicts[0].streak).to.equal(3);
    // The full verdict carries the streak, so no separate streak write.
    expect(feed.streakWrites).to.have.length(0);
  });

  it("flags on the third sweep of a sustained run, not the first", async () => {
    // The whole point, as a sequence: sweeps 1 and 2 write no verdict, sweep 3
    // does. A single truncated-but-conclusive negative cannot flag a deal.
    const { summaries } = await runSweeps(3, 0, 3);

    expect(summaries.map((s) => s.atRisk)).to.deep.equal([0, 0, 1]);
    expect(summaries.map((s) => s.unknown)).to.deep.equal([1, 1, 0]);
  });

  it("does not write a streak-only update on an inconclusive answer", async () => {
    // An inconclusive answer carries the streak forward, so the service skips the
    // write entirely rather than PATCHing the same value every sweep.
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 })],
      new FakeFindProvs({
        [CID]: { advertising: false, providerCount: 20, conclusive: false, detail: "hit the limit" },
      }),
      3
    );

    await service.runOnce();

    expect(feed.verdicts).to.have.length(0);
    expect(feed.streakWrites).to.have.length(0);
  });

  it("resets the streak through the service when the peer reappears", async () => {
    // Two negatives, then a positive: the verdict is `verified` and the streak is
    // written back as 0, so a subsequent incident starts counting from scratch.
    const { service, feed } = buildService(
      [assignment({ lastHeartbeatAt: stale, consecutiveConclusiveNegatives: 2 })],
      new FakeFindProvs({
        [CID]: { advertising: true, providerCount: 3, conclusive: true, detail: "advertising" },
      }),
      3
    );

    const summary = await service.runOnce();

    expect(summary.verified).to.equal(1);
    expect(feed.verdicts).to.have.length(1);
    expect(feed.verdicts[0].atRisk).to.equal(false);
    expect(feed.verdicts[0].streak).to.equal(0);
  });
});
