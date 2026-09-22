/**
 * Browser-side escrow operations.
 *
 * This is the replacement for `lib/cardanoTx.ts`'s single `buildAndSubmitTx`
 * entry point. Where the Cardano version attached CIP-1337/721 metadata to a
 * self-transfer, these functions drive the four real on-chain escrow flows the
 * Solana program exposes:
 *
 *   initializeEscrow → lock SOL into a deal PDA          (depositor signs)
 *   settleEscrow     → pay the provider, fee to treasury (oracle + provider)
 *   refundEscrow     → return funds to the depositor     (oracle, or after deadline)
 *   cancelEscrow     → unwind before work starts         (depositor + provider)
 *
 * Two design points carried over from the proven prototype:
 *
 * **The fee and treasury are read, never hardcoded.** `settleEscrow` fetches the
 * live `PlatformConfig` account immediately before building, so a fee change or
 * treasury rotation by the platform authority is picked up by every client with
 * no release, and the amount shown to the user is the amount the program will
 * actually apply.
 *
 * **Settle is not a browser-side action.** On-chain `settle` requires the oracle
 * signature, and the oracle key is a server-side secret. The browser's settle is
 * a *request* to the oracle backend (`POST /deals/:id/settle`), which verifies
 * the pin, opens a challenge window, and submits at window close. See
 * `backendSettle` below — calling `settleEscrow` directly from the page is only
 * for the two-party relay path that a provider-controlled environment would use.
 */

import { PublicKey, type Connection } from "@solana/web3.js";
import {
  EscrowClient,
  LAMPORTS_PER_SOL,
  type PreparedTransaction,
  type SignableWallet,
} from "@workspace/solana-escrow";
import type { BackendApi } from "@workspace/solana-escrow";

/** Progress callback shape, matching the old `buildAndSubmitTx(onProgress)`. */
export type ProgressFn = (message: string) => void;

export interface EscrowTxResult {
  txHash: string;
  explorerUrl: string;
}

/** SOL → lamports, for form input. Truncates rather than rounds up. */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

/** Lamports → SOL, for display. */
export function lamportsToSol(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export interface InitializeEscrowOptions {
  connection: Connection;
  depositor: SignableWallet;
  provider: PublicKey;
  oracle: PublicKey;
  /** Deal size in lamports. */
  amountLamports: bigint;
  dealId: string;
  onProgress?: ProgressFn;
}

/**
 * Lock `amountLamports` into a new deal PDA.
 *
 * The depositor is the only signer, so this submits immediately rather than
 * returning a prepared transaction: there is no second party to relay to.
 */
export async function initializeEscrow(
  options: InitializeEscrowOptions
): Promise<{ dealPda: PublicKey; signature: string }> {
  const { connection, depositor, provider, oracle, amountLamports, dealId, onProgress } = options;

  onProgress?.("Building initialize transaction…");
  const client = new EscrowClient(connection, depositor);

  const prepared = await client.initializeEscrow({
    depositor,
    provider,
    oracle,
    amount: amountLamports,
    dealId,
  });

  onProgress?.("Awaiting wallet signature — approve in your Solana wallet…");
  const signature = await client.signAndSubmit(prepared, [depositor]);

  onProgress?.("Confirmed on chain");
  return { dealPda: prepared.summary.dealPda, signature };
}

export interface SettleOnChainOptions {
  connection: Connection;
  dealPda: PublicKey;
  /** Both `oracle` and `provider` signatures are required on-chain. */
  signers: SignableWallet[];
  onProgress?: ProgressFn;
}

/**
 * Settle a deal directly on-chain.
 *
 * Reserved for a caller that legitimately holds both keys (a provider-operated
 * server, or a test). The user-facing settle path is `requestBackendSettle`
 * below, because the oracle key is not in the browser.
 */
export async function settleEscrow(
  options: SettleOnChainOptions
): Promise<EscrowTxResult> {
  const { connection, dealPda, signers, onProgress } = options;
  const [feePayer] = signers;
  if (!feePayer) throw new Error("settleEscrow requires at least one signer");

  onProgress?.("Building settle transaction…");
  const client = new EscrowClient(connection, feePayer);
  const prepared = await client.settleEscrow(dealPda, feePayer.publicKey);

  onProgress?.("Awaiting wallet signatures…");
  const signature = await client.signAndSubmit(prepared, signers);
  onProgress?.("Settled on chain");

  return {
    txHash: signature,
    // Filled in by the caller, which knows the configured cluster. Kept out of
    // this module so the chain configuration lives in one place (`lib/chain`).
    explorerUrl: "",
  };
}

export interface RefundEscrowOptions {
  connection: Connection;
  dealPda: PublicKey;
  authority: SignableWallet;
  onProgress?: ProgressFn;
}

/** Return escrowed funds to the depositor. One signature. */
export async function refundEscrow(options: RefundEscrowOptions): Promise<string> {
  const { connection, dealPda, authority, onProgress } = options;
  onProgress?.("Building refund transaction…");
  const client = new EscrowClient(connection, authority);
  const prepared = await client.refundEscrow(dealPda, authority.publicKey);
  onProgress?.("Awaiting wallet signature…");
  return client.signAndSubmit(prepared, [authority]);
}

export interface CancelEscrowOptions {
  connection: Connection;
  dealPda: PublicKey;
  signers: SignableWallet[];
  onProgress?: ProgressFn;
}

/** Unwind a deal before work starts. Depositor and provider both sign. */
export async function cancelEscrow(options: CancelEscrowOptions): Promise<string> {
  const { connection, dealPda, signers, onProgress } = options;
  const [feePayer] = signers;
  if (!feePayer) throw new Error("cancelEscrow requires at least one signer");

  onProgress?.("Building cancel transaction…");
  const client = new EscrowClient(connection, feePayer);
  const prepared = await client.cancelEscrow(dealPda, feePayer.publicKey);
  onProgress?.("Awaiting wallet signatures…");
  return client.signAndSubmit(prepared, signers);
}

/**
 * Ask the oracle backend to settle the deal, then read back its state.
 *
 * This is the production settle shape (see `PHASE4_NOTES.md` in the Solana
 * prototype). The call is authenticated with the session token obtained by
 * signing a challenge; the backend verifies the pin, opens a challenge window,
 * and only settles when the window closes with no dispute. A 202 from the
 * backend means "accepted for later processing" — nothing has settled yet, which
 * is why the UI says a window was opened rather than a deal was settled.
 */
export async function requestBackendSettle(
  api: BackendApi,
  token: string,
  identifier: string,
  onProgress?: ProgressFn
): Promise<{ outcome: string }> {
  onProgress?.("Submitting settle request to the oracle…");
  const result = await api.requestSettle(token, identifier);
  onProgress?.("Challenge window opened — the oracle will settle when it closes");
  return { outcome: result.outcome };
}
