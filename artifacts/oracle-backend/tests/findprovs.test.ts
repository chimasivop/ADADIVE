/**
 * `KuboFindProvsClient` — the peer-scoped DHT query.
 *
 * Stubbed at the HTTP boundary (`fetchImpl`), not at the client boundary, so the
 * tests exercise the URL and form body actually built, the newline-delimited
 * response parsing, both Kubo response shapes, and the inconclusive-answer rule.
 * Mocking the client itself would test nothing.
 *
 * No live IPFS node is involved: the point of the check is *which question is
 * asked*, and that is fully visible in the request the client constructs.
 */

import { expect } from "chai";

import {
  FindProvsTransportError,
  KuboFindProvsClient,
} from "../src/ipfs/findprovs";
import { SilentTestLogger } from "./helpers/silentLogger";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";
const PEER = "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY";
const OTHER = "12D3KooWOtherPeerIdThatIsNotTheAssignedOne1234567890abcde";

/** A fetch stub that records the requests and replays queued bodies. */
function makeClient(options: {
  responses: Array<Response | Error>;
  numProviders?: number;
}): {
  client: KuboFindProvsClient;
  requests: Array<{ url: string; body: string }>;
} {
  const requests: Array<{ url: string; body: string }> = [];
  const queue = [...options.responses];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected fetch: ${input}`);
    if (next instanceof Error) throw next;
    return next;
  };

  const client = new KuboFindProvsClient({
    apiUrl: "http://127.0.0.1:5001/api/v0",
    timeoutMs: 5000,
    numProviders: options.numProviders ?? 20,
    logger: new SilentTestLogger(),
    fetchImpl,
  });
  return { client, requests };
}

/** A Kubo RPC response body is newline-delimited JSON. */
function ndjson(lines: unknown[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join("\n"), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("KuboFindProvsClient", () => {
  it("POSTs to routing/findprovs with the CID in the form body", async () => {
    const { client, requests } = makeClient({
      responses: [ndjson([{ ID: PEER, Type: 6 }])],
    });

    await client.isPeerAdvertising(CID, PEER);

    expect(requests).to.have.length(1);
    expect(requests[0].url).to.equal(
      "http://127.0.0.1:5001/api/v0/routing/findprovs"
    );
    // The form body carries `arg=<cid>` — this is the contract with Kubo.
    const params = new URLSearchParams(requests[0].body);
    expect(params.get("arg")).to.equal(CID);
    expect(params.get("numProviders")).to.equal("20");
  });

  it("reports advertising when the assigned peer is among the providers", async () => {
    const { client } = makeClient({
      responses: [ndjson([{ ID: OTHER, Type: 6 }, { ID: PEER, Type: 6 }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(true);
    expect(result.conclusive).to.equal(true);
    expect(result.providerCount).to.equal(2);
    expect(result.detail).to.contain(PEER);
  });

  it("reports not-advertising (conclusively) when the peer is absent and the list is short", async () => {
    // Fewer providers than the limit means the DHT finished its search: the
    // peer's absence is a real answer.
    const { client } = makeClient({
      numProviders: 20,
      responses: [ndjson([{ ID: OTHER, Type: 6 }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(true);
    expect(result.providerCount).to.equal(1);
  });

  it("is inconclusive when the search hit its limit and the peer was not seen", async () => {
    // The DHT returned exactly `numProviders` and this peer was not among them;
    // there may be more it did not report. Flagging on this would turn a busy
    // DHT into false alarms, so absence here is explicitly not trusted.
    const { client } = makeClient({
      numProviders: 2,
      responses: [ndjson([{ ID: OTHER }, { ID: "12D3KooYetAnotherPeer000000000000000000000000000000000" }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(false);
    expect(result.providerCount).to.equal(2);
    expect(result.detail).to.contain("inconclusive");
  });

  it("still finds the peer when the limit is hit (limit only affects absence)", async () => {
    const { client } = makeClient({
      numProviders: 2,
      responses: [ndjson([{ ID: PEER }, { ID: OTHER }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(true);
    expect(result.conclusive).to.equal(true);
  });

  it("parses the wrapper `Responses` shape as well as bare providers", async () => {
    // Kubo has emitted both framings across versions; a wrong guess here would
    // silently produce "no providers" and flag every deal.
    const { client } = makeClient({
      responses: [
        ndjson([
          { Type: 1, Responses: [{ ID: OTHER, Type: 6 }] },
          { Type: 4, Responses: [{ ID: PEER, Type: 6, Addrs: [] }] },
        ]),
      ],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(true);
    expect(result.providerCount).to.equal(2);
  });

  it("deduplicates providers seen more than once", async () => {
    const { client } = makeClient({
      responses: [ndjson([{ ID: PEER }, { ID: PEER }, { ID: OTHER }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.providerCount).to.equal(2);
  });

  it("throws FindProvsTransportError on a non-2xx response", async () => {
    // "We could not find out" must not be mistaken for "the peer is gone".
    const { client } = makeClient({
      responses: [new Response("boom", { status: 500 })],
    });

    let threw: unknown = null;
    try {
      await client.isPeerAdvertising(CID, PEER);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(FindProvsTransportError);
    expect((threw as Error).message).to.contain("500");
  });

  it("propagates a network error (ECONNREFUSED) rather than reporting an absence", async () => {
    const { client } = makeClient({
      responses: [new Error("ECONNREFUSED")],
    });

    let threw: unknown = null;
    try {
      await client.isPeerAdvertising(CID, PEER);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(Error);
  });

  it("answers conclusively 'not advertising' for an invalid CID without calling Kubo", async () => {
    const { client, requests } = makeClient({ responses: [] });

    const result = await client.isPeerAdvertising("not a cid!!", PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(true);
    expect(requests).to.have.length(0);
  });

  it("answers conclusively 'not advertising' when the assignment has no peer id", async () => {
    const { client, requests } = makeClient({ responses: [] });

    const result = await client.isPeerAdvertising(CID, "   ");

    expect(result.advertising).to.equal(false);
    expect(requests).to.have.length(0);
  });

  it("skips malformed NDJSON lines instead of failing the whole query", async () => {
    const body = [
      JSON.stringify({ ID: OTHER }),
      "{ this is not json",
      JSON.stringify({ ID: PEER }),
    ].join("\n");
    const { client } = makeClient({
      responses: [new Response(body, { status: 200 })],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(true);
  });
});
