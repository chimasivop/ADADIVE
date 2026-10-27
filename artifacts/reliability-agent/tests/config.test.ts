/**
 * Config and evidence-client tests.
 *
 * The config tests pin the fail-fast rule (no key outside mock mode) and the
 * documented defaults (base URL, model id) so they cannot drift from the Meta
 * docs without a test failing. The client tests pin the read-only rule: only GET
 * is issued, and the right credential is chosen.
 */

import { assert } from "chai";

import { ConfigError, loadConfig, isMockEnabled } from "../src/config";
import { EvidenceClient, EvidenceError } from "../src/evidenceClient";
import { silentLogger } from "../src/logger";

describe("loadConfig", () => {
  it("refuses to load without a key when not mocking", () => {
    assert.throws(() => loadConfig({}), ConfigError);
    assert.throws(() => loadConfig({}), /META_API_KEY is required/);
  });

  it("applies the documented Meta defaults", () => {
    const config = loadConfig({ META_API_KEY: "LLM_1_abc" });
    assert.equal(config.metaBaseUrl, "https://api.meta.ai/v1");
    assert.equal(config.metaModel, "muse-spark-1.3");
    assert.isFalse(config.mock);
  });

  it("does not require a key in mock mode", () => {
    const config = loadConfig({ META_MOCK: "1" });
    assert.isTrue(config.mock);
    assert.isNull(config.metaApiKey);
  });

  it("treats an empty key as absent", () => {
    assert.throws(() => loadConfig({ META_API_KEY: "   " }), /META_API_KEY is required/);
  });

  it("strips trailing slashes from the base URL", () => {
    const config = loadConfig({ META_API_KEY: "k", META_BASE_URL: "https://example.test/v1//" });
    assert.equal(config.metaBaseUrl, "https://example.test/v1");
  });

  it("parses PROVIDER_ID and rejects a bad one", () => {
    assert.equal(loadConfig({ META_MOCK: "1", PROVIDER_ID: "7" }).providerId, 7);
    assert.isNull(loadConfig({ META_MOCK: "1" }).providerId);
    assert.throws(() => loadConfig({ META_MOCK: "1", PROVIDER_ID: "0" }), ConfigError);
    assert.throws(() => loadConfig({ META_MOCK: "1", PROVIDER_ID: "abc" }), ConfigError);
  });

  it("reads the internal and session tokens, treating blank as absent", () => {
    const config = loadConfig({
      META_MOCK: "1",
      INTERNAL_API_TOKEN: "  ",
      RELIABILITY_AGENT_TOKEN: "session-token",
    });
    assert.isNull(config.internalApiToken);
    assert.equal(config.sessionToken, "session-token");
  });
});

describe("isMockEnabled", () => {
  it("is off unless explicitly on", () => {
    assert.isFalse(isMockEnabled({}));
    assert.isFalse(isMockEnabled({ META_MOCK: "0" }));
    assert.isTrue(isMockEnabled({ META_MOCK: "1" }));
  });
});

describe("EvidenceClient", () => {
  const evidenceBody = { provider: { id: 3 }, assignments: [], summary: {} };

  it("GETs the internal route with the shared token when one is set", async () => {
    let seenUrl = "";
    let seenMethod = "";
    let seenAuth = "";
    const client = new EvidenceClient({
      apiBaseUrl: "http://api.test/api",
      logger: silentLogger,
      internalApiToken: "internal-token",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seenUrl = String(url);
        seenMethod = String(init.method);
        seenAuth = String((init.headers as Record<string, string>).authorization);
        return new Response(JSON.stringify(evidenceBody), { status: 200 });
      }) as unknown as typeof fetch,
    });

    await client.fetch(3);
    assert.equal(seenUrl, "http://api.test/api/internal/provider-reliability/3");
    assert.equal(seenMethod, "GET");
    assert.equal(seenAuth, "Bearer internal-token");
  });

  it("falls back to the wallet route when only a session token is set", async () => {
    let seenUrl = "";
    const client = new EvidenceClient({
      apiBaseUrl: "http://api.test/api",
      logger: silentLogger,
      sessionToken: "session-token",
      fetchImpl: (async (url: string) => {
        seenUrl = String(url);
        return new Response(JSON.stringify(evidenceBody), { status: 200 });
      }) as unknown as typeof fetch,
    });

    await client.fetch(3);
    assert.equal(seenUrl, "http://api.test/api/provider/reliability");
  });

  it("refuses to fetch with no credential at all", async () => {
    const client = new EvidenceClient({ apiBaseUrl: "http://api.test/api", logger: silentLogger });
    let threw: unknown = null;
    try {
      await client.fetch(3);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, EvidenceError);
  });

  it("throws EvidenceError with the status on a non-2xx response", async () => {
    const client = new EvidenceClient({
      apiBaseUrl: "http://api.test/api",
      logger: silentLogger,
      internalApiToken: "t",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: "not found" }), { status: 404 })) as unknown as typeof fetch,
    });
    let threw: unknown = null;
    try {
      await client.fetch(3);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, EvidenceError);
    assert.equal((threw as EvidenceError).status, 404);
  });
});
