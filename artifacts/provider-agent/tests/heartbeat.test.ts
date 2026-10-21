/**
 * The heartbeat, and the wallet-session sign-in it sits on top of.
 *
 * Both are faked at the HTTP boundary (`fetchImpl`) so the actual requests are
 * visible: the challenge → sign → verify exchange the agent reuses from the
 * existing flow, and the heartbeat's "read the node's peer id, then POST it".
 */

import { expect } from "chai";

import { Heartbeat } from "../src/heartbeat";
import { WalletSession, AuthError, loadKeypair } from "../src/auth";
import type { ProviderApi } from "../src/api";
import type { IpfsNode } from "../src/ipfs";
import { silentLogger } from "../src/logger";

const NODE_PEER = "12D3KooWNodeReportsThisPeerId000000000000000000000000000";

class FakeApi {
  readonly beats: string[] = [];
  private readonly error?: Error;
  constructor(error?: Error) {
    this.error = error;
  }
  async listAssignments() {
    return [];
  }
  async confirmPin() {}
  async heartbeat(peerId: string): Promise<void> {
    if (this.error) throw this.error;
    this.beats.push(peerId);
  }
}

class FakeIpfs {
  private readonly peerIdValue: string;
  private readonly error?: Error;
  constructor(peerIdValue: string, error?: Error) {
    this.peerIdValue = peerIdValue;
    this.error = error;
  }
  async pinCid(cid: string) {
    return cid;
  }
  async peerId(): Promise<string> {
    if (this.error) throw this.error;
    return this.peerIdValue;
  }
}

describe("Heartbeat", () => {
  it("reads the node's peer id and posts it", async () => {
    const api = new FakeApi();
    const beat = new Heartbeat({
      api: api as unknown as ProviderApi,
      ipfs: new FakeIpfs(NODE_PEER) as unknown as IpfsNode,
      logger: silentLogger,
      intervalMs: 1000,
    });

    const sent = await beat.runOnce();

    expect(sent).to.equal(NODE_PEER);
    expect(api.beats).to.deep.equal([NODE_PEER]);
  });

  it("returns null and swallows a failure rather than throwing", async () => {
    const api = new FakeApi(new Error("api-server down"));
    const beat = new Heartbeat({
      api: api as unknown as ProviderApi,
      ipfs: new FakeIpfs(NODE_PEER) as unknown as IpfsNode,
      logger: silentLogger,
      intervalMs: 1000,
    });

    const sent = await beat.runOnce();

    expect(sent).to.equal(null);
  });

  it("returns null when the node's peer id cannot be read (so no beat is sent)", async () => {
    const api = new FakeApi();
    const beat = new Heartbeat({
      api: api as unknown as ProviderApi,
      ipfs: new FakeIpfs(NODE_PEER, new Error("ipfs down")) as unknown as IpfsNode,
      logger: silentLogger,
      intervalMs: 1000,
    });

    const sent = await beat.runOnce();

    expect(sent).to.equal(null);
    expect(api.beats).to.deep.equal([]);
  });
});

describe("WalletSession", () => {
  it("performs challenge → sign → verify and caches the token", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/auth/challenge")) {
        const wallet = JSON.parse(String(init?.body)).wallet;
        expect(wallet).to.be.a("string");
        return new Response(
          JSON.stringify({ message: "ADADIVE sign-in nonce: abc", nonce: "abc" }),
          { status: 200 }
        );
      }
      if (url.endsWith("/auth/verify")) {
        const body = JSON.parse(String(init?.body));
        expect(body.nonce).to.equal("abc");
        // The signature is base58 over the challenge bytes — present and non-empty.
        expect(body.signature).to.be.a("string");
        expect(body.signature.length).to.be.greaterThan(0);
        return new Response(
          JSON.stringify({ token: "session-token", expiresAt: null }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const { Keypair } = await import("@solana/web3.js");
    const wallet = Keypair.generate();
    const session = new WalletSession({
      oracleBaseUrl: "http://oracle.test",
      wallet,
      logger: silentLogger,
      fetchImpl,
    });

    const first = await session.ensure();
    const second = await session.ensure();

    expect(first).to.equal("session-token");
    // Cached: the second call did not hit the network.
    expect(second).to.equal("session-token");
    expect(calls).to.have.length(2);
  });

  it("signs in again on refresh()", async () => {
    let verifies = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/challenge")) {
        return new Response(JSON.stringify({ message: "m", nonce: "n" }), { status: 200 });
      }
      verifies += 1;
      return new Response(
        JSON.stringify({ token: `token-${verifies}`, expiresAt: null }),
        { status: 200 }
      );
    };

    const { Keypair } = await import("@solana/web3.js");
    const session = new WalletSession({
      oracleBaseUrl: "http://oracle.test",
      wallet: Keypair.generate(),
      logger: silentLogger,
      fetchImpl,
    });

    expect(await session.ensure()).to.equal("token-1");
    expect(await session.refresh()).to.equal("token-2");
    expect(verifies).to.equal(2);
  });

  it("throws AuthError when the challenge endpoint fails", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("nope", { status: 500 });

    const { Keypair } = await import("@solana/web3.js");
    const session = new WalletSession({
      oracleBaseUrl: "http://oracle.test",
      wallet: Keypair.generate(),
      logger: silentLogger,
      fetchImpl,
    });

    let threw: unknown = null;
    try {
      await session.ensure();
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(AuthError);
    expect((threw as AuthError).status).to.equal(500);
  });

  it("throws AuthError when verify returns no token", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith("/auth/challenge")) {
        return new Response(JSON.stringify({ message: "m", nonce: "n" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const { Keypair } = await import("@solana/web3.js");
    const session = new WalletSession({
      oracleBaseUrl: "http://oracle.test",
      wallet: Keypair.generate(),
      logger: silentLogger,
      fetchImpl,
    });

    let threw: unknown = null;
    try {
      await session.ensure();
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(AuthError);
    expect((threw as Error).message).to.contain("no token");
  });
});
