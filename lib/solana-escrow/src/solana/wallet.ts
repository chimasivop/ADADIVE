import { AnchorProvider, Program } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

import { ESCROW_IDL, type EscrowProgram } from "./idl";
import type { AdadiveEscrow } from "../idl/types/adadive_escrow";
import { ESCROW_PROGRAM_ID } from "./constants";

/**
 * The two wallet shapes this library signs through.
 *
 * Both are reduced to the three members Anchor actually calls, so the
 * transaction builders never branch on where a signature came from. That is
 * what lets the same `settleEscrow` call be driven by a browser wallet adapter
 * in the UI and by a raw `Keypair` in a script.
 *
 * Note this is a structural type rather than Anchor's own `Wallet`: the class
 * Anchor exports requires a `payer: Keypair`, which a browser wallet cannot
 * provide. Everything that needs Anchor's nominal type receives a cast at the
 * single boundary in `makeProvider`.
 */
export interface SignableWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]>;
}

/** The minimal shape `AnchorProvider` needs; `payer` is optional and unused. */
export type AnchorWalletLike = SignableWallet & { payer?: Keypair };

/**
 * Adapt a wallet-adapter `signTransaction`-style object to Anchor's wallet
 * contract.
 *
 * Browser wallets expose sign methods the adapter wraps; Anchor only ever calls
 * `publicKey`, `signTransaction` and `signAllTransactions`, so this adapter is
 * enough to make a connected wallet drive a `Program` directly.
 */
export class AdapterWallet implements SignableWallet {
  constructor(private readonly adapter: SignableWallet) {}

  get publicKey(): PublicKey {
    return this.adapter.publicKey;
  }

  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    return this.adapter.signTransaction(tx);
  }

  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    return this.adapter.signAllTransactions(txs);
  }
}

/**
 * A wallet backed by an in-memory keypair, for scripts and tests.
 *
 * Uses `partialSign` (not `sign`) deliberately: it mirrors what a browser
 * wallet does when it adds its own signature to a transaction another party has
 * already partially signed, and it is what makes the two-party settle flow
 * usable from a plain Node keypair.
 */
export class KeypairWallet implements SignableWallet {
  readonly payer: Keypair;

  constructor(signer: Keypair) {
    this.payer = signer;
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    if (tx instanceof Object && "partialSign" in tx) {
      (tx as Transaction).partialSign(this.payer);
    } else {
      (tx as VersionedTransaction).sign([this.payer]);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * Build an Anchor `Provider` around any wallet.
 *
 * This is a *program* provider, not a sending provider: the transaction
 * builders return transactions for the caller (or the partial-signature relay)
 * to sign and send, so the provider's own send path is never used. It exists
 * because `Program` requires one.
 */
export function makeProvider(
  connection: Connection,
  wallet: SignableWallet,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): AnchorProvider {
  return new AnchorProvider(
    connection,
    wallet as unknown as AnchorWalletLike,
    {
      commitment,
      preflightCommitment: commitment,
    }
  );
}

/**
 * Instantiate the escrow program client for a connection + wallet.
 *
 * The program id comes from the IDL itself (Anchor reads `idl.address`), which
 * is why `ESCROW_PROGRAM_ID` is only used for PDA derivation and for the
 * consistency check below — two sources of truth for the same value is exactly
 * the kind of drift worth catching at startup rather than at the first failed
 * transaction.
 */
export function makeEscrowProgram(
  connection: Connection,
  wallet: SignableWallet
): EscrowProgram {
  assertProgramIdMatchesIdl();
  return new Program<AdadiveEscrow>(
    ESCROW_IDL,
    makeProvider(connection, wallet)
  );
}

let programIdChecked = false;

/**
 * Fail loudly if `ESCROW_PROGRAM_ID` and the IDL disagree.
 *
 * A rebuilt program gets a new address only if its keypair changes, but a
 * stale committed IDL is easy to forget after a program change; a mismatch
 * would otherwise surface as an opaque "account does not exist" at the first
 * RPC call.
 */
export function assertProgramIdMatchesIdl(): void {
  if (programIdChecked) return;
  const idlAddress = (ESCROW_IDL as { address: string }).address;
  if (idlAddress !== ESCROW_PROGRAM_ID.toBase58()) {
    throw new Error(
      `Program id mismatch: constants.ts has ${ESCROW_PROGRAM_ID.toBase58()} ` +
        `but the synced IDL has ${idlAddress}. Re-run \`anchor build && node scripts/sync-idl.mjs\`.`
    );
  }
  programIdChecked = true;
}
