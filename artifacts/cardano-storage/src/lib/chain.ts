/**
 * Chain configuration for the browser.
 *
 * Replaces the Cardano settings that used to be split between `token.ts` (the
 * THT policy id) and `cardanoTx.ts` (the Preprod explorer URL and the CSL CDN).
 * There is no longer a token policy id to configure: the escrow moves native
 * SOL, and the platform fee and treasury are read live from the on-chain
 * `PlatformConfig` account rather than being constants in the app.
 */

/**
 * Solana RPC endpoint.
 *
 * Defaults to a relative path so it hits the Vite `/rpc` dev proxy (see
 * `vite.config.ts`). That matters when the page is opened through a forwarded
 * host: a literal `127.0.0.1:8899` would resolve to the *viewer's* machine.
 * `VITE_RPC_ENDPOINT` overrides it for a deployed cluster.
 */
export const RPC_ENDPOINT =
  (import.meta.env.VITE_RPC_ENDPOINT as string | undefined) ??
  `${window.location.origin}/rpc`;

/**
 * Solana cluster, used for the explorer link and for the sign-in challenge's
 * CAIP-2 chain id. Kept as one value so the two cannot disagree.
 */
export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";

export const SOLANA_CLUSTER: SolanaCluster =
  (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster | undefined) ?? "devnet";

/** Explorer query suffix per cluster, for the transaction links. */
const EXPLORER_CLUSTER_PARAM: Record<SolanaCluster, string> = {
  "mainnet-beta": "",
  devnet: "?cluster=devnet",
  testnet: "?cluster=testnet",
  localnet: "?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899",
};

/**
 * The explorer URL for a transaction signature.
 *
 * Replaces the old `https://preprod.cardanoscan.io/transaction/…` link. Held in
 * one place so the PinFiles result card and any future caller agree.
 */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER_PARAM[SOLANA_CLUSTER]}`;
}

/** The explorer URL for an account, used when showing a wallet address. */
export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}${EXPLORER_CLUSTER_PARAM[SOLANA_CLUSTER]}`;
}

/** Display label for the network, matching the old footer's placement. */
export const NETWORK_LABEL = `${SOLANA_CLUSTER.toUpperCase()} TESTNET`.replace(
  /LOCALNET/,
  "LOCALNET"
);

/** How often balances are refreshed, in milliseconds. */
export const BALANCE_POLL_MS = 4000;
