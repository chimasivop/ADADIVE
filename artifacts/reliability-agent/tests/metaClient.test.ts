/**
 * HTTP Meta client tests, against a stubbed transport.
 *
 * These exercise the real request assembly and the real response/error parsing —
 * the only fake is the `fetch` call itself. They pin the two things that are easy
 * to get wrong: the endpoint path and auth header, and turning the API's
 * OpenAI-style error envelope into a `MetaApiError` the caller can fail safe on.
 *
 * They are *stubbed*, not live: no request reaches api.meta.ai. A live call is a
 * separate, opt-in check that needs a real META_API_KEY (see HACKATHON.md).
 */

import { assert } from "chai";

import { HttpMetaClient, MetaApiError, extractAssistantContent } from "../src/metaClient";
import { buildModelRequest } from "../src/prompt";
import { silentLogger } from "../src/logger";
import type { ReliabilityEvidence } from "../src/evidence";

const EVIDENCE: ReliabilityEvidence = {
  provider: {
    id: 1,
    name: "Demo",
    status: "active",
    region: "eu-west",
    reputationScore: 100,
    uptimePercent: 99,
    peerId: null,
    lastHeartbeatAt: null,
    heartbeatAgeMs: null,
    heartbeatStale: true,
  },
  heartbeatStaleThresholdMs: 180_000,
  consecutiveNegativesThreshold: 3,
  assignments: [],
  summary: {
    assignmentCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
    atRiskCount: 0,
    maxConsecutiveConclusiveNegatives: 0,
    neverHeartbeated: true,
    noRegisteredNode: true,
  },
  generatedAt: "2025-01-01T00:00:00.000Z",
};

const PAYLOAD = buildModelRequest(EVIDENCE, "muse-spark-1.3");

function clientWith(fetchImpl: typeof fetch): HttpMetaClient {
  return new HttpMetaClient({
    baseUrl: "https://api.meta.ai/v1",
    apiKey: "LLM_test_key",
    timeoutMs: 1000,
    logger: silentLogger,
    fetchImpl,
  });
}

describe("HttpMetaClient", () => {
  it("POSTs to /chat/completions with the bearer key", async () => {
    let url = "";
    let method = "";
    let auth = "";
    let body = "";
    const client = clientWith((async (u: string, init: RequestInit) => {
      url = String(u);
      method = String(init.method);
      auth = String((init.headers as Record<string, string>).authorization);
      body = String(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" } }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch);

    await client.complete(PAYLOAD);
    assert.equal(url, "https://api.meta.ai/v1/chat/completions");
    assert.equal(method, "POST");
    assert.equal(auth, "Bearer LLM_test_key");
    assert.equal(JSON.parse(body).model, "muse-spark-1.3");
    assert.equal(JSON.parse(body).response_format.type, "json_schema");
  });

  it("returns the assistant content", async () => {
    const client = clientWith((async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"ok":true}' } }] }),
        { status: 200 }
      )) as unknown as typeof fetch);
    assert.equal(await client.complete(PAYLOAD), '{"ok":true}');
  });

  it("throws MetaApiError carrying the API error type on a 4xx", async () => {
    const client = clientWith((async () =>
      new Response(
        JSON.stringify({ error: { message: "invalid model", type: "invalid_request_error" } }),
        { status: 400 }
      )) as unknown as typeof fetch);

    let threw: unknown = null;
    try {
      await client.complete(PAYLOAD);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, MetaApiError);
    assert.equal((threw as MetaApiError).status, 400);
    assert.equal((threw as MetaApiError).type, "invalid_request_error");
    assert.match((threw as MetaApiError).message, /invalid model/);
  });

  it("throws MetaApiError with status 0 on a transport failure", async () => {
    const client = clientWith((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);

    let threw: unknown = null;
    try {
      await client.complete(PAYLOAD);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, MetaApiError);
    assert.equal((threw as MetaApiError).status, 0);
  });

  it("throws when the response has no assistant content", async () => {
    const client = clientWith((async () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch);
    let threw: unknown = null;
    try {
      await client.complete(PAYLOAD);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, MetaApiError);
  });
});

describe("extractAssistantContent", () => {
  it("reads choices[0].message.content", () => {
    assert.equal(
      extractAssistantContent({ choices: [{ message: { content: "hi" } }] }),
      "hi"
    );
  });

  it("returns null for shapes that are not an OpenAI completion", () => {
    assert.isNull(extractAssistantContent(null));
    assert.isNull(extractAssistantContent({}));
    assert.isNull(extractAssistantContent({ choices: [] }));
    assert.isNull(extractAssistantContent({ choices: [{}] }));
    assert.isNull(extractAssistantContent({ choices: [{ message: { content: 42 } }] }));
  });
});
