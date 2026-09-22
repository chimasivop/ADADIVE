import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { SignableWallet } from "@workspace/solana-escrow";

/**
 * Bridge the wallet adapter's `useWallet()` result to the client library's
 * `SignableWallet`.
 *
 * The shared escrow library never imports anything from the adapter packages: it
 * signs through this narrow interface, which is what lets the same code run
 * under a browser wallet here and a `Keypair` in the backend's tests. The cast is
 * needed only because the adapter declares its sign methods non-generically
 * (they always return the same transaction type they were given), while the
 * library's type is generic over `Transaction | VersionedTransaction`.
 */
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
