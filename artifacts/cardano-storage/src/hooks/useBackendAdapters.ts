/**
 * The two adapter shapes the shared `BackendApi` and `SignableWallet` expect.
 *
 * `useSignableWallet` and `useMessageSigner` bridge the wallet adapter's
 * `useWallet()` result into those shapes. They live here rather than in their
 * own modules so the four escrow flows, the sign-in flow and the deal-status
 * card can all import one hook file; keeping them split produced import churn
 * with no benefit.
 *
 * The casts are needed only because the wallet adapter declares its sign
 * methods non-generically (they always return the same transaction type they
 * were given), while the library's `SignableWallet` is generic over
 * `Transaction | VersionedTransaction`.
 */

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { MessageSigner, SignableWallet } from "@workspace/solana-escrow";

/** A wallet that can sign transactions, for the four on-chain escrow flows. */
export function useSignableWallet(): SignableWallet | null {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  return useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return {
      publicKey,
      signTransaction: (tx) => signTransaction(tx as never),
      signAllTransactions: (txs) => signAllTransactions(txs as never),
    } as SignableWallet;
  }, [publicKey, signTransaction, signAllTransactions]);
}

/**
 * A wallet that can sign a plain message, for the backend sign-in challenge.
 *
 * Returns `null` when the connected wallet cannot sign messages. Phantom and
 * Solflare both can; the check exists so the UI can explain the gap instead of
 * throwing "signMessage is not a function" deep inside a click handler.
 */
export function useMessageSigner(): MessageSigner | null {
  const { publicKey, signMessage } = useWallet();

  return useMemo(() => {
    if (!publicKey || !signMessage) return null;
    return {
      publicKey,
      signMessage: (message: Uint8Array) => signMessage(message),
    };
  }, [publicKey, signMessage]);
}
