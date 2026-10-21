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
  readonly verdicts: Array<{ assignmentId: number; atRisk: boolean; detail: string }> = [];
  private readonly assignments: AssignmentView[];

  constructor(assignments: AssignmentView[]) {
    this.assignments = assignments;
  }

  async listAssignments(): Promise<AssignmentView[]> {
    return this.assignments;
  }

  async recordVerdict(assignmentId: number, atRisk: boolean, detail: string): Promise<void> {
    this.verdicts.push({ assignmentId, atRisk, detail });
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
    ...overrides,
  };
}

function buildService(
  assignments: AssignmentView[],
  findProvs: FakeFindProvs
): { service: ProviderVerificationService; feed: FakeFeed } {
  const feed = new FakeFeed(assignments);
  const service = new ProviderVerificationService({
    feed: feed as unknown as InternalProviderFeed,
    findProvs: findProvs as unknown as KuboFindProvsClient,
    logger: new SilentTestLogger(),
    registry: new SecretRegistry(),
    heartbeatStaleMs: STALE_MS,
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
