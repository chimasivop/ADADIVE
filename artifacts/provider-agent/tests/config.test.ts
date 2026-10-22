/**
 * Config parsing and keypair loading.
 *
 * The config is where a misconfiguration must be caught, so the tests are about
 * what is refused as much as what is accepted: a missing keypair path is a
 * startup error (otherwise the agent spins a poll loop that 401s forever), and a
 * non-positive interval is a typo, not a value.
 */

import { expect } from "chai";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

import { ConfigError, loadConfig } from "../src/config";
import { loadKeypair } from "../src/auth";

describe("loadConfig", () => {
  it("requires a keypair path", () => {
    expect(() => loadConfig({})).to.throw(ConfigError);
  });

  it("refuses a default config whose oracle and Kubo share a port", () => {
    // With only the keypair path set, `ORACLE_BASE_URL` (the oracle's port,
    // 5001) and `IPFS_API_URL` (Kubo's default, also 5001) resolve to the same
    // origin. One process cannot be both, so the default `--once` cycle could
    // never work. Refuse at startup and name the fix.
    expect(() =>
      loadConfig({ PROVIDER_KEYPAIR_PATH: "/tmp/key.json" })
    ).to.throw(ConfigError, /5001/);
  });

  it("accepts distinct endpoints and applies the documented defaults", () => {
    const config = loadConfig({
      PROVIDER_KEYPAIR_PATH: "/tmp/key.json",
      ORACLE_BASE_URL: "http://127.0.0.1:5001",
      IPFS_API_URL: "http://127.0.0.1:5002/api/v0",
    });
    expect(config.apiBaseUrl).to.equal("http://127.0.0.1:5000/api");
    expect(config.oracleBaseUrl).to.equal("http://127.0.0.1:5001");
    expect(config.ipfsApiUrl).to.equal("http://127.0.0.1:5002/api/v0");
    expect(config.pollIntervalMs).to.equal(15_000);
    expect(config.heartbeatIntervalMs).to.equal(30_000);
  });

  it("rejects an IPFS URL on the same origin as the oracle even off the default", () => {
    expect(() =>
      loadConfig({
        PROVIDER_KEYPAIR_PATH: "/tmp/key.json",
        ORACLE_BASE_URL: "https://shared.example:5001",
        IPFS_API_URL: "https://shared.example:5001/api/v0",
      })
    ).to.throw(ConfigError, /different origins/);
  });

  it("strips trailing slashes from base URLs", () => {
    const config = loadConfig({
      PROVIDER_KEYPAIR_PATH: "/tmp/key.json",
      API_BASE_URL: "https://api.example/api/",
      ORACLE_BASE_URL: "https://oracle.example/",
    });
    expect(config.apiBaseUrl).to.equal("https://api.example/api");
    expect(config.oracleBaseUrl).to.equal("https://oracle.example");
  });

  it("reads the IPFS API URL from the environment", () => {
    const config = loadConfig({
      PROVIDER_KEYPAIR_PATH: "/tmp/key.json",
      IPFS_API_URL: "http://kubo.internal:5001/api/v0",
    });
    expect(config.ipfsApiUrl).to.equal("http://kubo.internal:5001/api/v0");
  });

  it("rejects a non-positive interval", () => {
    expect(() =>
      loadConfig({ PROVIDER_KEYPAIR_PATH: "/tmp/key.json", POLL_INTERVAL_MS: "0" })
    ).to.throw(ConfigError);
    expect(() =>
      loadConfig({ PROVIDER_KEYPAIR_PATH: "/tmp/key.json", POLL_INTERVAL_MS: "-5" })
    ).to.throw(ConfigError);
    expect(() =>
      loadConfig({ PROVIDER_KEYPAIR_PATH: "/tmp/key.json", POLL_INTERVAL_MS: "soon" })
    ).to.throw(ConfigError);
  });
});

describe("loadKeypair", () => {
  it("loads a solana-keygen JSON keypair from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "adadive-agent-"));
    const path = join(dir, "key.json");
    const keypair = Keypair.generate();
    writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));

    const loaded = loadKeypair(path);
    expect(loaded.publicKey.toBase58()).to.equal(keypair.publicKey.toBase58());
  });
});
