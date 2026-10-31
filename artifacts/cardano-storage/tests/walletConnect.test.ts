/**
 * Unit tests for the wallet-connect guard.
 *
 * These cover the bug that produced a blank error: a wallet adapter that is not
 * installed reports `readyState: "NotDetected"`, and calling `connect()` on it
 * throws a `WalletNotReadyError` whose message is empty — so the UI rendered a
 * bare "Failed to connect wallet:". The guard must decide from `readyState`
 * *before* calling `connect()`, and no failure may surface an empty reason.
 *
 * No DOM, no React: `connectWallet` takes a plain wallet-like object.
 */
import { assert } from "chai";

import {
  DENIED_MESSAGE,
  GENERIC_CONNECT_MESSAGE,
  NO_WALLET_MESSAGE,
  NOT_DETECTED_MESSAGE,
  connectWallet,
  handleAdapterError,
  isAdapterReady,
  normalizeConnectError,
  pickWallet,
  type WalletLike,
} from "../src/lib/walletConnect";

/** A wallet whose `connect` records whether it was called. */
function makeWallet(
  name: string,
  readyState: string,
  connect: () => Promise<void> = async () => {}
): WalletLike & { connected: boolean } {
  const wallet = {
    connected: false,
    adapter: {
      name,
      connect: async () => {
        wallet.connected = true;
        await connect();
      },
    },
    readyState,
  };
  return wallet;
}

describe("isAdapterReady", () => {
  it("accepts only Installed and Loadable", () => {
    assert.isTrue(isAdapterReady("Installed"));
    assert.isTrue(isAdapterReady("Loadable"));
    assert.isFalse(isAdapterReady("NotDetected"));
    assert.isFalse(isAdapterReady("Unsupported"));
    assert.isFalse(isAdapterReady(""));
  });
});

describe("pickWallet", () => {
  it("returns null when there are no wallets at all", () => {
    assert.isNull(pickWallet([]));
  });

  it("prefers a ready Phantom over a ready Solflare", () => {
    const wallets = [makeWallet("Solflare", "Installed"), makeWallet("Phantom", "Installed")];
    assert.equal(pickWallet(wallets)?.adapter.name, "Phantom");
  });

  it("prefers any ready wallet over a not-ready one", () => {
    const wallets = [
      makeWallet("Phantom", "NotDetected"),
      makeWallet("Solflare", "Installed"),
    ];
    assert.equal(pickWallet(wallets)?.adapter.name, "Solflare");
  });

  it("still returns a not-ready wallet so the caller can name what is missing", () => {
    const wallets = [makeWallet("Phantom", "NotDetected")];
    assert.equal(pickWallet(wallets)?.adapter.name, "Phantom");
  });

  it("falls back to the first wallet when none is preferred by name", () => {
    const wallets = [makeWallet("Backpack", "Installed"), makeWallet("Glow", "Installed")];
    assert.equal(pickWallet(wallets)?.adapter.name, "Backpack");
  });
});

describe("connectWallet", () => {
  it("does not call connect() on a NotDetected adapter and explains why", async () => {
    const wallet = makeWallet("Phantom", "NotDetected");
    const outcome = await connectWallet([wallet]);

    assert.isFalse(outcome.ok);
    assert.isFalse(wallet.connected, "connect() must not be called when not ready");
    assert.equal(outcome.error, NOT_DETECTED_MESSAGE);
    assert.isAbove(outcome.error!.length, 0);
  });

  it("reports the no-wallet message when the registry is empty", async () => {
    const outcome = await connectWallet([]);
    assert.isFalse(outcome.ok);
    assert.equal(outcome.error, NO_WALLET_MESSAGE);
  });

  it("connects a ready adapter", async () => {
    const wallet = makeWallet("Phantom", "Installed");
    const outcome = await connectWallet([wallet]);

    assert.isTrue(outcome.ok);
    assert.isTrue(wallet.connected);
    assert.equal(outcome.walletName, "Phantom");
  });

  it("treats a Loadable adapter as connectable", async () => {
    const outcome = await connectWallet([makeWallet("Solflare", "Loadable")]);
    assert.isTrue(outcome.ok);
  });

  it("surfaces a rejection as the denied message", async () => {
    const wallet = makeWallet("Phantom", "Installed", async () => {
      throw new Error("User rejected the request.");
    });
    const outcome = await connectWallet([wallet]);
    assert.isFalse(outcome.ok);
    assert.equal(outcome.error, DENIED_MESSAGE);
  });
});

describe("normalizeConnectError", () => {
  it("never returns an empty or 'Failed to connect wallet:' message", () => {
    // The exact shape that caused the blank error: an Error with no message.
    assert.equal(normalizeConnectError(new Error("")), GENERIC_CONNECT_MESSAGE);
    assert.equal(normalizeConnectError(new Error()), GENERIC_CONNECT_MESSAGE);

    const notAnError = {};
    assert.equal(
      normalizeConnectError(notAnError),
      "Failed to connect wallet: [object Object]"
    );
    assert.notEqual(normalizeConnectError(notAnError), "Failed to connect wallet: ");

    assert.equal(normalizeConnectError(null), GENERIC_CONNECT_MESSAGE);
    assert.equal(normalizeConnectError(undefined), GENERIC_CONNECT_MESSAGE);
  });

  it("maps a rejection to the denied message", () => {
    assert.equal(normalizeConnectError(new Error("User denied")), DENIED_MESSAGE);
    assert.equal(normalizeConnectError(new Error("Request declined")), DENIED_MESSAGE);
  });

  it("keeps a genuine message", () => {
    assert.equal(
      normalizeConnectError(new Error("something specific broke")),
      "Failed to connect wallet: something specific broke"
    );
  });
});

describe("handleAdapterError", () => {
  it("logs and does not open a window", () => {
    // The library's default handler opens `adapter.url` on a WalletNotReadyError;
    // this handler must replace that. Assert no `window.open` is reached.
    const opened: unknown[] = [];
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      open: (...args: unknown[]) => opened.push(args),
    };
    try {
      const logged: unknown[][] = [];
      handleAdapterError(new Error("nope"), { name: "Phantom" }, (...args) => logged.push(args));
      assert.equal(logged.length, 1);
      assert.equal(opened.length, 0, "handleAdapterError must not open a window");
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
