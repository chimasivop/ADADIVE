/**
 * The poller's cycle, against fakes for the api-server and the IPFS node.
 *
 * The poller is where "an assignment becomes a pinned file" happens, and its
 * value is in the *failure* semantics, so that is what these tests pin down:
 *
 *   - a pinned CID is confirmed with the node's own peer id (not the one the
 *     assignment carried);
 *   - a pin that fails leaves the assignment unconfirmed and does not stop the
 *     cycle (transient network failures must retry, not abort);
 *   - a failure to read the node's peer id sends no confirmations at all, rather
 *     than confirming with a possibly-wrong id;
 *   - a failure to list assignments is swallowed for the next tick.
 *
 * The api and ipfs doubles are real implementations of the interfaces the poller
 * depends on (`ProviderApi`, `IpfsNode`), recording what they were asked to do.
 */

import { expect } from "chai";

import { AssignmentPoller } from "../src/poller";
import type { ProviderApi, Assignment } from "../src/api";
import type { IpfsNode } from "../src/ipfs";
import { silentLogger } from "../src/logger";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const NODE_PEER = "12D3KooWNodeReportsThisPeerId000000000000000000000000000";

/** A `ProviderApi` double that records calls. */
class FakeApi {
  readonly confirmed: Array<{ assignmentId: number; cid: string; peerId: string }> = [];
  listCalls = 0;
  private readonly assignments: Assignment[];
  private readonly listError?: Error;

  constructor(assignments: Assignment[], listError?: Error) {
    this.assignments = assignments;
    this.listError = listError;
  }

  async listAssignments(): Promise<Assignment[]> {
    this.listCalls += 1;
    if (this.listError) throw this.listError;
    return this.assignments;
  }

  async confirmPin(assignmentId: number, cid: string, peerId: string): Promise<void> {
    this.confirmed.push({ assignmentId, cid, peerId });
  }

  async heartbeat(): Promise<void> {}
}

/** An `IpfsNode` double: pins succeed unless the CID is listed in `pinFails`. */
class FakeIpfs {
  readonly pinned: string[] = [];
  peerIdCalls = 0;
  private readonly peerIdValue: string;
  private readonly pinFails: Set<string>;
  private readonly peerIdError?: Error;

  constructor(peerIdValue: string, pinFails: Set<string> = new Set(), peerIdError?: Error) {
    this.peerIdValue = peerIdValue;
    this.pinFails = pinFails;
    this.peerIdError = peerIdError;
  }

  async pinCid(cid: string): Promise<string> {
    if (this.pinFails.has(cid)) throw new Error(`IPFS refused ${cid}`);
    this.pinned.push(cid);
    return cid;
  }

  async peerId(): Promise<string> {
    this.peerIdCalls += 1;
    if (this.peerIdError) throw this.peerIdError;
    return this.peerIdValue;
  }
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    assignmentId: 1,
    dealId: 7,
    cid: CID,
    peerId: NODE_PEER,
    status: "assigned",
    createdAt: "2024-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function build(api: FakeApi, ipfs: FakeIpfs): AssignmentPoller {
  return new AssignmentPoller({
    api: api as unknown as ProviderApi,
    ipfs: ipfs as unknown as IpfsNode,
    logger: silentLogger,
    intervalMs: 1000,
  });
}

describe("AssignmentPoller", () => {
  it("pins each assignment and confirms with the node's peer id", async () => {
    const api = new FakeApi([assignment()]);
    const ipfs = new FakeIpfs(NODE_PEER);

    const result = await build(api, ipfs).runOnce();

    expect(result).to.deep.equal({ scanned: 1, pinned: 1, failed: 0 });
    expect(ipfs.pinned).to.deep.equal([CID]);
    expect(api.confirmed).to.deep.equal([
      { assignmentId: 1, cid: CID, peerId: NODE_PEER },
    ]);
  });

  it("confirms with the node's own peer id even when the assignment names another", async () => {
    // The agent reports what the node says. If it echoed the assignment's peer id
    // a misconfigured agent would look correct; the api-server is meant to catch
    // the mismatch (409), which requires the agent to be honest here.
    const api = new FakeApi([assignment({ peerId: "12D3KooWSomeoneElse" })]);
    const ipfs = new FakeIpfs(NODE_PEER);

    await build(api, ipfs).runOnce();

    expect(api.confirmed[0].peerId).to.equal(NODE_PEER);
  });

  it("does not stop the cycle when one pin fails", async () => {
    const cid2 = "bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const api = new FakeApi([assignment(), assignment({ assignmentId: 2, dealId: 8, cid: cid2 })]);
    const ipfs = new FakeIpfs(NODE_PEER, new Set([CID]));

    const result = await build(api, ipfs).runOnce();

    expect(result).to.deep.equal({ scanned: 2, pinned: 1, failed: 1 });
    expect(api.confirmed).to.deep.equal([
      { assignmentId: 2, cid: cid2, peerId: NODE_PEER },
    ]);
  });

  it("sends no confirmations when the node's peer id cannot be read", async () => {
    const api = new FakeApi([assignment()]);
    const ipfs = new FakeIpfs(NODE_PEER, new Set(), new Error("node unreachable"));

    const result = await build(api, ipfs).runOnce();

    expect(result).to.deep.equal({ scanned: 1, pinned: 0, failed: 0 });
    expect(ipfs.pinned).to.deep.equal([]);
    expect(api.confirmed).to.deep.equal([]);
  });

  it("reads the node's peer id once per cycle, not once per assignment", async () => {
    const cid2 = "bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const api = new FakeApi([assignment(), assignment({ assignmentId: 2, dealId: 8, cid: cid2 })]);
    const ipfs = new FakeIpfs(NODE_PEER);

    await build(api, ipfs).runOnce();

    expect(ipfs.peerIdCalls).to.equal(1);
  });

  it("skips the cycle when there are no assignments", async () => {
    const api = new FakeApi([]);
    const ipfs = new FakeIpfs(NODE_PEER);

    const result = await build(api, ipfs).runOnce();

    expect(result).to.deep.equal({ scanned: 0, pinned: 0, failed: 0 });
    // No point asking the node for its peer id if there is nothing to confirm.
    expect(ipfs.peerIdCalls).to.equal(0);
  });

  it("swallows a failure to list assignments (the next tick retries)", async () => {
    const api = new FakeApi([], new Error("api-server down"));
    const ipfs = new FakeIpfs(NODE_PEER);

    const result = await build(api, ipfs).runOnce();

    expect(result).to.deep.equal({ scanned: 0, pinned: 0, failed: 0 });
    expect(api.listCalls).to.equal(1);
  });

  it("does not run two cycles at once", async () => {
    const api = new FakeApi([assignment()]);
    const ipfs = new FakeIpfs(NODE_PEER);
    const poller = build(api, ipfs);

    const [first, second] = await Promise.all([poller.runOnce(), poller.runOnce()]);

    // One of the two saw the overlap guard and returned the empty result.
    const empty = { scanned: 0, pinned: 0, failed: 0 };
    const full = { scanned: 1, pinned: 1, failed: 0 };
    expect([first, second]).to.deep.include.members([empty]).and.to.deep.include(full);
    expect(api.confirmed).to.have.length(1);
  });
});
