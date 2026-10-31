import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import {
  useConnection,
  useWallet as useAdapterWallet,
} from "@solana/wallet-adapter-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { BALANCE_POLL_MS } from "@/lib/chain";
import { useBackendSession } from "@/hooks/useBackendSession";
import { connectWallet, pickWallet } from "@/lib/walletConnect";

/**
 * Wallet state for the app.
 *
 * This replaces the Cardano CIP-30 context that drove `window.cardano.eternl`.
 * The connect/disconnect surface is the same shape it always was; what changed
 * is underneath:
 *
 *   | before (Cardano)                              | after (Solana)                       |
 *   | --------------------------------------------- | ------------------------------------ |
 *   | `window.cardano.eternl.enable()`              | wallet-adapter `adapter.connect()`   |
 *   | `getUsedAddresses()` → hex → bech32 `addr1…`  | `publicKey.toBase58()`               |
 *   | `getBalance()` CBOR → ADA + THT               | `connection.getBalance()` → lamports |
 *
 * The two Cardano-era balance fields (`thtBalance`, `adaBalance`) are gone.
 * They both held the wallet's SOL balance because the escrow moves a single
 * native asset, and keeping two names for one number invited a consumer to
 * treat them as different values. There is now one field, `solBalance`.
 */

interface WalletState {
  connected: boolean;
  connecting: boolean;
  /** Base58 Solana public key. Was a bech32 `addr1…` Cardano address. */
  address: string | null;
  /** SOL balance. Was the lovelace-derived ADA balance and the THT balance. */
  solBalance: number | null;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  displayAddress: string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Shorten a base58 key for display.
 *
 * The old helper sliced a bech32 string 12/8; a base58 key is 44 characters, so
 * this keeps the same visual weight (a stub, an ellipsis, a stub) while not
 * chopping a key so aggressively that it stops being identifiable.
 */
function shortenAddress(key: string): string {
  if (key.length < 16) return key;
  return key.slice(0, 12) + "..." + key.slice(-8);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const {
    publicKey,
    connected: adapterConnected,
    connecting: adapterConnecting,
    disconnect: adapterDisconnect,
    wallets,
    select,
    wallet,
  } = useAdapterWallet();

  const { ensureSession } = useBackendSession();

  // `@solana/wallet-adapter-react` only tracks an adapter once one has been
  // *selected*; until `select()` has run it reports `connected: false` and a
  // null `publicKey` no matter what the extension does. This app uses a single
  // connect button rather than a picker modal, so select the preferred adapter
  // up front, but only when nothing is selected yet.
  useEffect(() => {
    if (wallet) return;
    const preferred = pickWallet(wallets);
    if (preferred) select(preferred.adapter.name);
  }, [wallet, wallets, select]);

  // Make the wallet-signed session available to the generated API client so
  // mutating calls (`useCreateDeal`, `useUpdateDeal`, …) carry the bearer token.
  // The getter is only invoked by the client on a request that will actually be
  // sent, and only for mutations here — the read hooks pass
  // `auth: "none"`, so browsing deals/providers never triggers a wallet prompt.
  useEffect(() => {
    setAuthTokenGetter(() => (publicKey ? ensureSession() : null));
    return () => setAuthTokenGetter(null);
  }, [publicKey, ensureSession]);

  const [lamports, setLamports] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the balance whenever the key changes, and poll it while connected.
  useEffect(() => {
    if (!publicKey) {
      setLamports(null);
      return;
    }
    let cancelled = false;

    const read = async () => {
      try {
        const next = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) setLamports(next);
      } catch {
        // A transient RPC failure must not clear a balance the user can still
        // see; leave the last good value in place.
      }
    };

    void read();
    const timer = setInterval(() => void read(), BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, publicKey]);

  const connect = useCallback(async () => {
    setError(null);
    // `connectWallet` checks `readyState` before calling `adapter.connect()`.
    // Without that guard a `NotDetected` adapter throws a `WalletNotReadyError`
    // with an empty message — which rendered as a bare "Failed to connect
    // wallet:" — and the wallet library's default handler opened the extension's
    // download page in a new tab. See `lib/walletConnect.ts`.
    const outcome = await connectWallet(wallets);
    if (!outcome.ok) setError(outcome.error ?? null);
  }, [wallets]);

  const disconnect = useCallback(() => {
    setError(null);
    void adapterDisconnect();
  }, [adapterDisconnect]);

  const solBalance = useMemo(
    () => (lamports === null ? null : lamports / LAMPORTS_PER_SOL),
    [lamports]
  );

  const value: WalletContextValue = {
    connected: adapterConnected,
    connecting: adapterConnecting,
    address: publicKey ? publicKey.toBase58() : null,
    solBalance,
    error,
    connect,
    disconnect,
    displayAddress: publicKey ? shortenAddress(publicKey.toBase58()) : null,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
