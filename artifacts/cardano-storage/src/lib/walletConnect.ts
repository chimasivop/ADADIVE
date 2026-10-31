/**
 * The wallet-connect decision, kept out of the React context so it can be
 * tested without a DOM.
 *
 * The context owns state and rendering; this module owns the rules. The one rule
 * that matters is that a wallet which is not actually installed must never reach
 * `adapter.connect()`: the adapter throws a `WalletNotReadyError` with an empty
 * message, so the old code rendered `Failed to connect wallet:` with nothing
 * after it, and the library's default error handler opened the wallet's download
 * page in a new tab. Checking readiness first turns both into a clear message.
 *
 * The types here are structural rather than imported from the wallet adapter so
 * a test can hand in a plain object. `Wallet` from `@solana/wallet-adapter-react`
 * is assignable to `WalletLike`.
 */

/** The two ready states in which `connect()` will actually do something. */
export type ReadyState = "Installed" | "Loadable" | "NotDetected" | "Unsupported";

/** The minimal wallet shape these helpers need. */
export interface WalletLike {
  adapter: {
    name: string;
    connect: () => Promise<void>;
  };
  readyState: string;
}

/** Shown when an adapter exists but the extension is not installed/available. */
export const NOT_DETECTED_MESSAGE =
  "Phantom or Solflare not detected. Install the extension, unlock it, then reload this page.";

/** Shown when the adapter registry knows of no wallet at all. */
export const NO_WALLET_MESSAGE =
  "No Solana wallet found. Please install the Phantom or Solflare browser extension.";

/** Shown when the user dismissed the wallet's approval prompt. */
export const DENIED_MESSAGE =
  "Wallet access denied. Please approve the connection request.";

/** Shown when the adapter threw but gave no usable reason. */
export const GENERIC_CONNECT_MESSAGE = "Failed to connect wallet. Please try again.";

/** True only for the states in which `adapter.connect()` is meaningful. */
export function isAdapterReady(readyState: string): boolean {
  return readyState === "Installed" || readyState === "Loadable";
}

/**
 * Pick the adapter to connect with.
 *
 * Preference order matches what the app tells the user it supports (Phantom,
 * then Solflare); anything else the adapter registry knows is accepted as a
 * fallback so a user with a different wallet is not locked out. Ready wallets
 * win over merely-registered ones, but a not-ready wallet is still returned so
 * the caller can name what is missing instead of reporting "no wallet at all".
 */
export function pickWallet<T extends WalletLike>(wallets: T[]): T | null {
  if (wallets.length === 0) return null;
  const ready = wallets.filter((w) => isAdapterReady(w.readyState));
  const pool = ready.length > 0 ? ready : wallets;
  const preferred = ["Phantom", "Solflare"];
  for (const name of preferred) {
    const match = pool.find((w) =>
      w.adapter.name.toLowerCase().includes(name.toLowerCase())
    );
    if (match) return match;
  }
  return pool[0] ?? null;
}

/**
 * Turn whatever the adapter threw into a message that is never empty.
 *
 * A `WalletNotReadyError` carries no message, and a bare `String(err)` of an
 * object with no `toString` is `"[object Object]"`; both used to surface as
 * `Failed to connect wallet: `. Every path here returns prose.
 */
export function normalizeConnectError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : err == null ? "" : String(err);
  if (/reject|denied|declin/i.test(raw)) return DENIED_MESSAGE;
  const message = raw.trim();
  return message.length > 0 ? `Failed to connect wallet: ${message}` : GENERIC_CONNECT_MESSAGE;
}

export interface ConnectOutcome {
  ok: boolean;
  /** The adapter that connected, when it did. */
  walletName?: string;
  /** A human-readable reason, when it did not. Never empty. */
  error?: string;
}

/**
 * Connect, or explain why not.
 *
 * The readiness check happens before `connect()` is ever called, which is what
 * stops the empty `WalletNotReadyError` (and the tab the library opens for it)
 * from happening. This function itself never opens a tab.
 */
export async function connectWallet(wallets: WalletLike[]): Promise<ConnectOutcome> {
  const wallet = pickWallet(wallets);
  if (!wallet) return { ok: false, error: NO_WALLET_MESSAGE };
  if (!isAdapterReady(wallet.readyState)) {
    return { ok: false, error: NOT_DETECTED_MESSAGE };
  }
  try {
    await wallet.adapter.connect();
    return { ok: true, walletName: wallet.adapter.name };
  } catch (err) {
    return { ok: false, error: normalizeConnectError(err) };
  }
}

/**
 * The `onError` passed to `SolanaWalletProvider`.
 *
 * The library's default handler, used when no `onError` is supplied, calls
 * `window.open(adapter.url, "_blank")` on a `WalletNotReadyError` — which is the
 * stray tab to `phantom.com` this app used to open. Supplying this handler
 * replaces that default entirely; it logs and returns, and deliberately never
 * opens a window.
 */
export function handleAdapterError(
  error: unknown,
  adapter: { name?: string } | null | undefined,
  log: (...args: unknown[]) => void = console.error
): void {
  log(error, adapter?.name ?? "");
}
