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
  isFindProvsTransportError,
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
  it("POSTs to routing/findprovs with arg and num-providers in the URL query", async () => {
    const { client, requests } = makeClient({
      responses: [ndjson([{ ID: PEER, Type: 6 }])],
    });

    await client.isPeerAdvertising(CID, PEER);

    expect(requests).to.have.length(1);
    // Kubo reads positional args and options from the *query string*, not the
    // body — the contract is `arg=<cid>&num-providers=<limit>`. Asserting the
    // parsed query (not the raw string) keeps the test independent of param
    // ordering while still pinning both names, including the hyphen in
    // `num-providers`.
    const url = new URL(requests[0].url);
    expect(`${url.origin}${url.pathname}`).to.equal(
      "http://127.0.0.1:5001/api/v0/routing/findprovs"
    );
    expect(url.searchParams.get("arg")).to.equal(CID);
    expect(url.searchParams.get("num-providers")).to.equal("20");
    expect(requests[0].body).to.equal("");
  });

  it("reports advertising when the assigned peer is among the providers", async () => {
    const { client } = makeClient({
      responses: [ndjson([{ ID: OTHER, Type: 4 }, { ID: PEER, Type: 4 }])],
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
      responses: [ndjson([{ ID: OTHER, Type: 4 }])],
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

  it("is inconclusive when the body is empty, not a stream we can read", async () => {
    // An empty 200 body is not "the DHT says nobody has it" — read as absence it
    // would flag the deal at-risk on a non-answer.
    const { client } = makeClient({ responses: [new Response("", { status: 200 })] });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(false);
    expect(result.providerCount).to.equal(0);
    expect(result.detail).to.contain("inconclusive");
  });

  it("is inconclusive when the body is an HTML error page served as 200", async () => {
    // A proxy or misconfiguration can return 200 with a non-NDJSON body. None of
    // its lines parse as JSON, so nothing is recognised.
    const { client } = makeClient({
      responses: [new Response("<html><body>gateway</body></html>", { status: 200 })],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.conclusive).to.equal(false);
    expect(result.advertising).to.equal(false);
  });

  it("is inconclusive when the lines are JSON but not a findprovs framing", async () => {
    // Valid JSON that carries neither a numeric event Type nor a peer id is a
    // framing we do not understand. Treating it as an empty provider list would
    // be the same misread as an empty body.
    const { client } = makeClient({
      responses: [ndjson([{ unexpected: "shape" }, { another: 42 }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.conclusive).to.equal(false);
    expect(result.detail).to.contain("inconclusive");
  });

  it("finds no providers in a clean search and reports conclusive absence", async () => {
    // Codex case 1: the real "peer is gone" case. A completed search — the query
    // ran (PeerResponse events) and reported nobody providing the CID — is a
    // trustworthy absence and must still be conclusive, or the whole feature can
    // never flag anything.
    const { client } = makeClient({
      numProviders: 20,
      responses: [
        ndjson([
          { Type: 0, ID: OTHER }, // SendingQuery
          { Type: 1, ID: OTHER, Responses: [] }, // PeerResponse: this peer had nobody
        ]),
      ],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(true);
    // providerCount counts ids seen in the stream (the queried peer's included),
    // so it is not asserted to be 0 here; the load-bearing part is conclusive
    // absence for the assigned peer.
  });

  it("is inconclusive when the stream is only a query error", async () => {
    // Codex case 2. kad-dht reports a fatal lookup failure as a bare QueryError,
    // which carries no providers — indistinguishable from "nobody has it" unless
    // the error is treated as invalidating the answer.
    const { client } = makeClient({
      responses: [ndjson([{ Type: 3, Extra: "lookup failure" }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(false);
    expect(result.detail).to.contain("error");
    expect(result.detail).to.contain("inconclusive");
  });

  it("is inconclusive for an unrecognised or unsupported event type", async () => {
    // Codex case 3. A type that is neither a result nor the known error — a
    // future/additional event this build does not understand — must not be read
    // as a completed search. The id is the *queried* peer's (as SendingQuery and
    // QueryError carry), not a provider, so it is not evidence either.
    // (`FinalPeer`=2 and `AddingPeer`=6 are defined but never emitted by kad-dht;
    // 99 stands for any unknown type.)
    const { client } = makeClient({
      numProviders: 20,
      responses: [ndjson([{ Type: 99, ID: OTHER }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(false);
  });

  it("is inconclusive when a successful event is followed by a query error", async () => {
    // Codex case 4. The error marks the search as unfinished; it must not be
    // overridden by the earlier success, so this is not a conclusive absence.
    const { client } = makeClient({
      numProviders: 20,
      responses: [
        ndjson([
          { Type: 1, ID: OTHER, Responses: [] }, // success: a response came back
          { Type: 3, Extra: "later failure" }, // then the query errored
        ]),
      ],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(false);
    expect(result.detail).to.contain("inconclusive");
  });

  it("is inconclusive for a truncated stream that named a peer but never answered", async () => {
    // Codex case 5. A SendingQuery is a recognised line, but no response came
    // back before the stream ended — a truncated search, not an empty one. The
    // SendingQuery id is the queried peer, so it is not provider evidence.
    const { client } = makeClient({
      numProviders: 20,
      responses: [ndjson([{ Type: 0, ID: OTHER }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(false);
    expect(result.conclusive).to.equal(false);
  });

  it("throws FindProvsTransportError when the body read is aborted mid-stream", async () => {
    // The one *reliable* transport-level signal for truncation: undici rejects a
    // body read that is cut off before the terminating chunk (`TypeError:
    // terminated`). It must become a transport error, not escape as a bare
    // `TypeError` — the service re-throws anything that is not a transport error,
    // which would abort the whole sweep instead of recording one `unknown`.
    const aborted = {
      ok: true,
      status: 200,
      text: async () => {
        const err = new TypeError("terminated");
        (err as { cause?: unknown }).cause = new Error("other side closed");
        throw err;
      },
    } as unknown as Response;
    const { client } = makeClient({ responses: [aborted] });

    let threw: unknown = null;
    try {
      await client.isPeerAdvertising(CID, PEER);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(FindProvsTransportError);
    expect((threw as Error).message).to.contain("could not read the findprovs response body");
    expect(isFindProvsTransportError(threw)).to.equal(true);
  });

  it("treats a stalled read (timeout abort) as a transport error too", async () => {
    const stalled = {
      ok: true,
      status: 200,
      text: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    } as unknown as Response;
    const { client } = makeClient({ responses: [stalled] });

    let threw: unknown = null;
    try {
      await client.isPeerAdvertising(CID, PEER);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(FindProvsTransportError);
  });

  it("still finds the peer when the body is recognised", async () => {
    const { client } = makeClient({
      responses: [ndjson([{ Type: 4, Responses: [{ ID: PEER }] }])],
    });

    const result = await client.isPeerAdvertising(CID, PEER);

    expect(result.advertising).to.equal(true);
    expect(result.conclusive).to.equal(true);
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

  it("maps a network error (ECONNREFUSED) to a transport error, not an absence", async () => {
    // Not just `instanceOf(Error)`: the specific type matters, because the service
    // re-throws anything that is not a `FindProvsTransportError`. A bare
    // `TypeError: fetch failed` escaping here would abort the whole sweep.
    const { client } = makeClient({
      responses: [new Error("ECONNREFUSED")],
    });

    let threw: unknown = null;
    try {
      await client.isPeerAdvertising(CID, PEER);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(FindProvsTransportError);
    expect(isFindProvsTransportError(threw)).to.equal(true);
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

/**
 * The transport-level question the streak exists to answer: can a truncated read
 * be told apart from a completed one?
 *
 * These drive a *real* HTTP server (a real socket, real chunked framing) rather
 * than a stub `Response`, because the distinction is made by undici's body
 * reader, not by our code. The findings, which are the rationale for the streak
 * in `providerVerification.ts`:
 *
 *   - A connection cut **mid-body** (before the terminating chunk) is detected:
 *     `text()` rejects, and the client turns that into `FindProvsTransportError`.
 *     The sweep records `unknown` and moves on.
 *   - A stream that ends **cleanly but early** (a valid terminator, but the
 *     search never completed) is *not* detectable here: `text()` resolves and the
 *     bytes are indistinguishable from a finished search. Only app-level events
 *     could know, and findprovs has no terminal sentinel — hence requiring a
 *     sustained run of negatives instead of trusting one.
 */
describe("KuboFindProvsClient — truncation vs clean end (real socket)", () => {
  /** Start a server that writes `body`, then either destroys or ends cleanly. */
  async function withServer(
    body: string,
    mode: "abort" | "clean"
  ): Promise<{ client: KuboFindProvsClient; close: () => Promise<void> }> {
    const http = await import("node:http");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (mode === "abort") {
        // Send a partial body then cut the socket without the terminating chunk.
        res.write(body);
        res.socket?.destroy();
      } else {
        res.end(body);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const client = new KuboFindProvsClient({
      apiUrl: `http://127.0.0.1:${port}/api/v0`,
      timeoutMs: 5000,
      numProviders: 20,
      logger: new SilentTestLogger(),
    });
    return {
      client,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        }),
    };
  }

  it("turns a mid-body connection cut into FindProvsTransportError", async () => {
    // A response event *is* sent before the cut, so a naive "did we see a result?"
    // check would call this conclusive. The transport rejects it, which is the
    // signal the client converts to `unknown`.
    const body = `${JSON.stringify({ Type: 4, Responses: [{ ID: PEER }] })}\n`;
    const { client, close } = await withServer(body, "abort");
    try {
      let threw: unknown = null;
      try {
        await client.isPeerAdvertising(CID, PEER);
      } catch (err) {
        threw = err;
      }
      expect(threw).to.be.instanceOf(FindProvsTransportError);
    } finally {
      await close();
    }
  });

  it("cannot tell a cleanly-ended-but-early stream from a completed search", async () => {
    // This is the residual gap, pinned as a test so the mitigation is not
    // mistaken for a fix: the bytes end with a valid terminator, so the read
    // resolves. `findprovs` has no terminal event, so a search that stopped early
    // is byte-identical to one that finished — which is exactly why the decision
    // layer requires several consecutive negatives before flagging.
    const body = `${JSON.stringify({ Type: 4, Responses: [{ ID: OTHER }] })}\n`;
    const { client, close } = await withServer(body, "clean");
    try {
      const result = await client.isPeerAdvertising(CID, PEER);
      // No error: it parsed as a completed search that simply did not list PEER.
      expect(result.advertising).to.equal(false);
      expect(result.conclusive).to.equal(true);
    } finally {
      await close();
    }
  });
});
