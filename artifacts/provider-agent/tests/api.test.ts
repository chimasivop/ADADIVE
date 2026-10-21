/**
 * The api-server client: bearer auth, the 401-refresh retry, and the three
 * endpoint shapes.
 *
 * Faked at the fetch boundary so the tests see the actual request the agent
 * makes — the path, the method, the bearer header, and the body — which is
 * exactly the contract with the new endpoints.
 */

import { expect } from "chai";

import { ProviderApi, ApiError } from "../src/api";
import type { WalletSession } from "../src/auth";
import { silentLogger } from "../src/logger";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const PEER = "12D3KooWNodeReportsThisPeerId000000000000000000000000000";

/** A session double returning queued tokens. */
class FakeSession {
  ensureCalls = 0;
  refreshCalls = 0;
  private readonly tokens: string[];
  constructor(tokens: string[]) {
    this.tokens = tokens;
  }
  async ensure(): Promise<string> {
    this.ensureCalls += 1;
    return this.tokens[0];
  }
  async refresh(): Promise<string> {
    this.refreshCalls += 1;
    return this.tokens[Math.min(this.refreshCalls, this.tokens.length - 1)];
  }
}

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function build(
  session: FakeSession,
  handler: (seen: Seen) => Response
): { api: ProviderApi; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const record: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(record);
    return handler(record);
  };
  const api = new ProviderApi({
    apiBaseUrl: "https://api.example/api",
    session: session as unknown as WalletSession,
    logger: silentLogger,
    fetchImpl,
  });
  return { api, seen };
}

describe("ProviderApi", () => {
  it("lists assignments with the session token as a bearer header", async () => {
    const session = new FakeSession(["tok"]);
    const { api, seen } = build(session, () =>
      new Response(JSON.stringify({ assignments: [{ assignmentId: 1, dealId: 7, cid: CID, peerId: PEER, status: "assigned", createdAt: "x" }] }), {
        status: 200,
      })
    );

    const assignments = await api.listAssignments();

    expect(assignments).to.have.length(1);
    expect(assignments[0].cid).to.equal(CID);
    expect(seen[0].url).to.equal("https://api.example/api/provider/assignments");
    expect(seen[0].method).to.equal("GET");
    expect(seen[0].auth).to.equal("Bearer tok");
  });

  it("POSTs confirm-pin with the cid and peer id", async () => {
    const session = new FakeSession(["tok"]);
    const { api, seen } = build(session, () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await api.confirmPin(CID, PEER);

    expect(seen[0].url).to.equal("https://api.example/api/provider/confirm-pin");
    expect(seen[0].method).to.equal("POST");
    expect(seen[0].body).to.deep.equal({ cid: CID, peerId: PEER });
  });

  it("POSTs heartbeat with the peer id", async () => {
    const session = new FakeSession(["tok"]);
    const { api, seen } = build(session, () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await api.heartbeat(PEER);

    expect(seen[0].url).to.equal("https://api.example/api/provider/heartbeat");
    expect(seen[0].body).to.deep.equal({ peerId: PEER });
  });

  it("refreshes the session once and retries on a 401", async () => {
    const session = new FakeSession(["stale", "fresh"]);
    let first = true;
    const { api, seen } = build(session, () => {
      if (first) {
        first = false;
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify({ assignments: [] }), { status: 200 });
    });

    const assignments = await api.listAssignments();

    expect(assignments).to.deep.equal([]);
    expect(session.refreshCalls).to.equal(1);
    // Two calls, the second carrying the refreshed token.
    expect(seen).to.have.length(2);
    expect(seen[1].auth).to.equal("Bearer fresh");
  });

  it("throws ApiError with the status on a non-401 failure", async () => {
    const session = new FakeSession(["tok"]);
    const { api } = build(session, () =>
      new Response(JSON.stringify({ error: "no such deal" }), { status: 404 })
    );

    let threw: unknown = null;
    try {
      await api.confirmPin(CID, PEER);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(ApiError);
    expect((threw as ApiError).status).to.equal(404);
  });
});
