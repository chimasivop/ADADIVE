/**
 * `verifyPinStatus` — the discrete, testable pin check.
 *
 * These stub Pinata at the HTTP boundary (`fetchImpl`) rather than at the
 * `verifyPinStatus` boundary, so the tests really exercise the URL built, the
 * status handling, the response parsing, the gateway check and the reason
 * classification. Stubbing the function itself would test nothing.
 */

import { expect } from "chai";

import { PinataClient, PinataTransportError } from "../src/pinata/pinStatus";
import { SilentTestLogger } from "./helpers/silentLogger";

const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";

function makeClient(options: {
  pinListResponses: Array<Response | Error>;
  gatewayResponse?: Response | Error;
  gatewayUrl?: string | null;
  jwt?: string | null;
}): { client: PinataClient; calls: string[] } {
  const calls: string[] = [];
  const pinListQueue = [...options.pinListResponses];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/data/pinList")) {
      const next = pinListQueue.shift();
      if (next === undefined) throw new Error(`unexpected pinList call: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }
    if (url.includes("/ipfs/")) {
      const next = options.gatewayResponse;
      if (!next) throw new Error(`unexpected gateway call: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const client = new PinataClient({
    apiBase: "https://api.pinata.cloud",
    jwt: options.jwt === undefined ? "test-jwt" : options.jwt,
    gatewayUrl: options.gatewayUrl === undefined ? null : options.gatewayUrl,
    timeoutMs: 1000,
    logger: new SilentTestLogger(),
    fetchImpl,
  });
  return { client, calls };
}

function pinListResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ count: rows.length, rows }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyPinStatus", () => {
  it("reports ok when Pinata lists the pin and the gateway serves it", async () => {
    const { client, calls } = makeClient({
      gatewayUrl: "https://gateway.example",
      pinListResponses: [
        pinListResponse([
          {
            ipfs_pin_hash: CID,
            size: 1234,
            date_pinned: "2024-01-02T03:04:05.000Z",
          },
        ]),
      ],
      gatewayResponse: new Response(null, { status: 200 }),
    });

    const result = await client.verifyPinStatus(CID);

    expect(result.ok).to.equal(true);
    expect(result.reason).to.equal("pinned_and_retrievable");
    expect(result.sizeBytes).to.equal(1234);
    expect(result.pinnedAt?.toISOString()).to.equal("2024-01-02T03:04:05.000Z");
    // Both checks ran, against the right endpoints.
    expect(calls.some((u) => u.includes("/data/pinList?hash="))).to.equal(true);
    expect(calls.some((u) => u.includes("/ipfs/"))).to.equal(true);
  });

  it("reports not_pinned when Pinata returns no rows", async () => {
    const { client, calls } = makeClient({
      pinListResponses: [pinListResponse([])],
    });

    const result = await client.verifyPinStatus(CID);

    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal("not_pinned");
    // Crucially, it did not bother with the gateway: nothing to retrieve.
    expect(calls.every((u) => !u.includes("/ipfs/"))).to.equal(true);
  });

  it("reports not_pinned when Pinata rows exist but none match the CID", async () => {
    // Pinata's `hash=` filter has historically been a prefix/substring filter in
    // some API versions. Trusting `count > 0` would let a prefix collision
    // settle a deal whose own CID is not pinned.
    const { client } = makeClient({
      pinListResponses: [
        pinListResponse([{ ipfs_pin_hash: "bafyOTHER", size: 10 }]),
      ],
    });

    const result = await client.verifyPinStatus(CID);

    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal("not_pinned");
  });

  it("reports not_pinned for a syntactically invalid CID without calling Pinata", async () => {
    const { client, calls } = makeClient({ pinListResponses: [] });

    const result = await client.verifyPinStatus("not a cid!!");

    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal("not_pinned");
    expect(calls).to.have.length(0);
  });

  it("reports pinned_but_not_retrievable when the gateway 404s", async () => {
    const { client } = makeClient({
      gatewayUrl: "https://gateway.example",
      pinListResponses: [pinListResponse([{ ipfs_pin_hash: CID }])],
      gatewayResponse: new Response(null, { status: 404 }),
    });

    const result = await client.verifyPinStatus(CID);

    expect(result.ok).to.equal(false);
    expect(result.reason).to.equal("pinned_but_not_retrievable");
    expect(result.detail).to.contain("404");
  });

  it("is ok but says retrievability was untested when no gateway is configured", async () => {
    const { client } = makeClient({
      gatewayUrl: null,
      pinListResponses: [pinListResponse([{ ipfs_pin_hash: CID }])],
    });

    const result = await client.verifyPinStatus(CID);

    expect(result.ok).to.equal(true);
    // The weaker claim is *named*, not silently upgraded to "retrievable".
    expect(result.reason).to.equal("pinned_not_checked_for_retrievability");
    expect(result.detail).to.contain("not tested");
  });

  it("throws (rather than reporting not-pinned) when Pinata itself fails", async () => {
    // A 500 is "we could not find out", not "it is not pinned". Conflating the
    // two would permanently fail a legitimate deal on a transient blip.
    const { client } = makeClient({
      pinListResponses: [new Response("boom", { status: 500 })],
    });

    let threw: unknown = null;
    try {
      await client.verifyPinStatus(CID);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(PinataTransportError);
    expect((threw as Error).message).to.contain("500");
  });

  it("throws when a network error prevents asking the question", async () => {
    const { client } = makeClient({
      pinListResponses: [new Error("ECONNREFUSED")],
    });

    let threw: unknown = null;
    try {
      await client.verifyPinStatus(CID);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(Error);
  });

  it("throws when no Pinata JWT is configured", async () => {
    const { client } = makeClient({
      jwt: null,
      pinListResponses: [],
    });

    let threw: unknown = null;
    try {
      await client.verifyPinStatus(CID);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(PinataTransportError);
    expect((threw as Error).message).to.contain("PINATA_JWT");
  });

  it("sends the JWT as a bearer header and never in the URL", async () => {
    // A token in a query string ends up in access logs, proxies and error
    // reports; the whole reason it is a header is to keep it out of those.
    const seen: Array<{ url: string; auth: string | null }> = [];
    const client = new PinataClient({
      apiBase: "https://api.pinata.cloud",
      jwt: "super-secret-jwt",
      gatewayUrl: null,
      timeoutMs: 1000,
      logger: new SilentTestLogger(),
      fetchImpl: async (input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seen.push({
          url: String(input),
          auth: headers.Authorization ?? null,
        });
        return pinListResponse([{ ipfs_pin_hash: CID }]);
      },
    });

    await client.verifyPinStatus(CID);

    expect(seen).to.have.length(1);
    expect(seen[0].auth).to.equal("Bearer super-secret-jwt");
    expect(seen[0].url).not.to.contain("super-secret-jwt");
  });
});
