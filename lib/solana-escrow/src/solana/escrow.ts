import { BN, type AnchorProvider } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type ConfirmOptions,
  type Signer,
} from "@solana/web3.js";

import { ESCROW_PROGRAM_ID, LAMPORTS_PER_SOL } from "./constants";
import { computeFeeSplit, type FeeSplit, type PlatformConfigView } from "./fee";
import { findDealAddress, findPlatformConfigAddress } from "./pda";
import type { EscrowProgram } from "./idl";
import {
  AdapterWallet,
  KeypairWallet,
  makeEscrowProgram,
  type SignableWallet,
} from "./wallet";

/** A `Deal` account as the client decodes it. */
export interface DealView {
  depositor: PublicKey;
  provider: PublicKey;
  oracle: PublicKey;
  amount: BN;
  dealId: string;
  startTime: BN;
  deadline: BN;
  bump: number;
}

/** Default escrow window when the caller does not supply one: one day. */
export const DEFAULT_DEAL_DURATION_SECONDS = 86_400;

export interface InitializeEscrowParams {
  /** Funds the escrow and pays for the `Deal` account's rent. */
  depositor: SignableWallet;
  /** Receives `amount - fee` on settle. */
  provider: PublicKey;
  /** Attests completion; co-signs settle, or may refund unilaterally. */
  oracle: PublicKey;
  /** Lamports to escrow. Native SOL only in this phase — no SPL tokens. */
  amount: bigint | number;
  /** Off-chain deal identifier; hashed into the PDA, max 64 bytes. */
  dealId: string;
  /** Unix seconds. Defaults to "now". */
  startTime?: number;
  /** Unix seconds. Defaults to `startTime + DEFAULT_DEAL_DURATION_SECONDS`. */
  deadline?: number;
}

/**
 * An unsigned-or-partially-signed transaction plus the metadata a counterparty
 * needs to finish it.
 *
 * This is the unit of exchange in the two-party settle flow: one party produces
 * a `PreparedTransaction`, serialises it, and hands the bytes to the other.
 * Carrying `requiredSigners` and `missingSigners` alongside the raw transaction
 * is what lets a UI say "waiting on the oracle" rather than "signature
 * verification failed".
 */
export interface PreparedTransaction {
  transaction: Transaction;
  /** Signers the compiled message requires, in the message's own order. */
  requiredSigners: PublicKey[];
  /** Those that have not signed yet. */
  missingSigners: PublicKey[];
  /** Fee payer baked into the message (always a required signer). */
  feePayer: PublicKey;
  /** Human-readable account/amount summary for a confirmation screen. */
  summary: TransactionSummary;
}

export interface TransactionSummary {
  action: "initialize" | "settle" | "refund" | "cancel";
  dealPda: PublicKey;
  programId: PublicKey;
  /** Present for initialize/settle. */
  amountLamports?: bigint;
  /** Settlement split preview, read from the live `PlatformConfig`. */
  feeSplit?: FeeSplit;
  /** Treasury the fee is destined for, read from the live config. */
  treasury?: PublicKey;
}

/* ------------------------------------------------------------------ */
/* Account reads                                                       */
/* ------------------------------------------------------------------ */

/** Derive the singleton config PDA for this program id. */
export function platformConfigAddress(
  programId: PublicKey = ESCROW_PROGRAM_ID
): PublicKey {
  return findPlatformConfigAddress(programId)[0];
}

/**
 * Read the live `PlatformConfig`.
 *
 * The client never hardcodes the treasury or the fee. Both are read from this
 * account immediately before a settlement is built, so a fee change or a
 * treasury rotation by the platform authority is picked up by every client with
 * no release, and the amount the user is shown is the amount the program will
 * actually apply.
 */
export async function fetchPlatformConfig(
  program: EscrowProgram
): Promise<PlatformConfigView> {
  const address = platformConfigAddress(program.programId);
  const config = await program.account.platformConfig.fetch(address);
  return config as unknown as PlatformConfigView;
}

/** Fetch a deal, or `null` if no account exists at the PDA. */
export async function fetchDeal(
  program: EscrowProgram,
  dealPda: PublicKey
): Promise<DealView | null> {
  const deal = await program.account.deal.fetchNullable(dealPda);
  return (deal as unknown as DealView) ?? null;
}

/**
 * The settlement split for a deal, according to the *current* on-chain config.
 *
 * Used by the UI to show the user what they will be charged before they sign,
 * and by the settle builder to assert that the preview still matches what the
 * program will do.
 */
export async function previewSettleSplit(
  program: EscrowProgram,
  dealPda: PublicKey
): Promise<{ deal: DealView; config: PlatformConfigView; split: FeeSplit }> {
  const deal = await fetchDeal(program, dealPda);
  if (!deal) throw new Error(`No deal account at ${dealPda.toBase58()}`);
  const config = await fetchPlatformConfig(program);
  return {
    deal,
    config,
    split: computeFeeSplit(BigInt(deal.amount.toString()), config.feeBasisPoints),
  };
}

/* ------------------------------------------------------------------ */
/* Transaction assembly                                                */
/* ------------------------------------------------------------------ */

async function attachBlockhash(
  connection: Connection,
  tx: Transaction
): Promise<Transaction> {
  if (!tx.recentBlockhash) {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
  }
  return tx;
}

function requiredSigners(tx: Transaction): PublicKey[] {
  // `compileMessage` caches the message, so this does not rebuild it on each
  // call once the transaction is assembled.
  const message = tx.compileMessage();
  const signed = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  return signed;
}

/**
 * Build the `initialize` transaction: lock `amount` into a deal PDA.
 *
 * The depositor is the only signer. `startTime` and `deadline` are explicit
 * because the program validates them (`deadline > start_time`, both positive);
 * the caller-supplied `dealId` is part of the PDA, so the same depositor can
 * open any number of distinct deals.
 */
export async function buildInitializeTransaction(
  program: EscrowProgram,
  connection: Connection,
  params: InitializeEscrowParams
): Promise<PreparedTransaction> {
  const { depositor, provider, oracle, dealId } = params;
  const amount = BigInt(params.amount);
  if (amount <= BigInt(0)) throw new Error("amount must be greater than zero");
  if (dealId.length === 0) throw new Error("dealId must not be empty");

  const depositorKey = depositor.publicKey;
  if (
    depositorKey.equals(provider) ||
    depositorKey.equals(oracle) ||
    provider.equals(oracle)
  ) {
    throw new Error("depositor, provider and oracle must be distinct keys");
  }

  const startTime =
    params.startTime ?? Math.floor(Date.now() / 1000);
  const deadline =
    params.deadline ?? startTime + DEFAULT_DEAL_DURATION_SECONDS;
  if (deadline <= startTime) {
    throw new Error("deadline must be strictly after startTime");
  }

  const [dealPda] = findDealAddress(program.programId, depositorKey, dealId);
  const wallet = new AdapterWallet(depositor);
  const scoped = makeEscrowProgram(connection, wallet);

  // The program enforces the per-deal cap on-chain; reading the config here
  // lets us fail with a clear message before the user signs, and gives the
  // instruction the config account it needs.
  const configAddress = platformConfigAddress(program.programId);
  const config = await fetchPlatformConfig(scoped);
  if (amount > BigInt(config.maxDealAmount.toString())) {
    throw new Error(
      `amount ${amount} exceeds the platform maximum deal value ` +
        `${config.maxDealAmount} lamports`
    );
  }

  const tx = await scoped.methods
    .initialize(
      new BN(amount.toString()),
      dealId,
      new BN(startTime),
      new BN(deadline)
    )
    .accountsPartial({
      depositor: depositorKey,
      provider,
      oracle,
      deal: dealPda,
      config: configAddress,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  tx.feePayer = depositorKey;
  await attachBlockhash(connection, tx);

  return {
    transaction: tx,
    requiredSigners: requiredSigners(tx),
    missingSigners: requiredSigners(tx),
    feePayer: depositorKey,
    summary: {
      action: "initialize",
      dealPda,
      programId: program.programId,
      amountLamports: amount,
    },
  };
}

/**
 * Build the `settle` transaction.
 *
 * Two things matter here and both are deliberate:
 *
 * 1. **The treasury is read, never hardcoded.** The `PlatformConfig` account is
 *    fetched and its `treasury` field is used as the settlement destination, so
 *    a rotated treasury is honoured without a client change. Passing the wrong
 *    treasury would be rejected on-chain anyway (the account carries
 *    `address = config.treasury`), but reading it means the client's fee
 *    preview and its instruction agree by construction rather than by luck.
 * 2. **The config PDA is derived from the program id**, so the client and the
 *    program cannot disagree about the seeds.
 *
 * The returned transaction is *unsigned*. Both `oracle` and `provider` must
 * sign; see `partialSign` and `serializeTransaction` for the relay, and
 * `PHASE2_NOTES.md` for why a partial-sign-and-forward pattern was chosen over
 * a backend relayer.
 */
export async function buildSettleTransaction(
  program: EscrowProgram,
  connection: Connection,
  dealPda: PublicKey,
  feePayer: PublicKey
): Promise<PreparedTransaction> {
  const deal = await fetchDeal(program, dealPda);
  if (!deal) throw new Error(`No deal account at ${dealPda.toBase58()}`);
  const config = await fetchPlatformConfig(program);

  const tx = await program.methods
    .settle()
    .accountsPartial({
      oracle: deal.oracle,
      provider: deal.provider,
      deal: dealPda,
      config: platformConfigAddress(program.programId),
      treasury: config.treasury,
    })
    .transaction();

  tx.feePayer = feePayer;
  await attachBlockhash(connection, tx);

  const split = computeFeeSplit(
    BigInt(deal.amount.toString()),
    config.feeBasisPoints
  );

  return {
    transaction: tx,
    requiredSigners: requiredSigners(tx),
    missingSigners: requiredSigners(tx),
    feePayer,
    summary: {
      action: "settle",
      dealPda,
      programId: program.programId,
      amountLamports: BigInt(deal.amount.toString()),
      feeSplit: split,
      treasury: config.treasury,
    },
  };
}

/**
 * Build the `refund` transaction.
 *
 * `authority` is whichever key is entitled to the refund: the oracle at any
 * time, or the depositor once the deadline has passed. The program enforces
 * which is legal; the client only has to name it. Only one signature is needed,
 * so there is no relay step.
 */
export async function buildRefundTransaction(
  program: EscrowProgram,
  connection: Connection,
  dealPda: PublicKey,
  authority: PublicKey
): Promise<PreparedTransaction> {
  const deal = await fetchDeal(program, dealPda);
  if (!deal) throw new Error(`No deal account at ${dealPda.toBase58()}`);

  const tx = await program.methods
    .refund()
    .accountsPartial({
      authority,
      depositor: deal.depositor,
      deal: dealPda,
    })
    .transaction();

  tx.feePayer = authority;
  await attachBlockhash(connection, tx);

  return {
    transaction: tx,
    requiredSigners: requiredSigners(tx),
    missingSigners: requiredSigners(tx),
    feePayer: authority,
    summary: {
      action: "refund",
      dealPda,
      programId: program.programId,
      amountLamports: BigInt(deal.amount.toString()),
    },
  };
}

/**
 * Build the `cancel` transaction.
 *
 * Like `settle`, this needs two signatures — depositor **and** provider — so it
 * goes through the same relay. The funds return to the depositor and no fee is
 * charged.
 */
export async function buildCancelTransaction(
  program: EscrowProgram,
  connection: Connection,
  dealPda: PublicKey,
  feePayer: PublicKey
): Promise<PreparedTransaction> {
  const deal = await fetchDeal(program, dealPda);
  if (!deal) throw new Error(`No deal account at ${dealPda.toBase58()}`);

  const tx = await program.methods
    .cancel()
    .accountsPartial({
      depositor: deal.depositor,
      provider: deal.provider,
      deal: dealPda,
    })
    .transaction();

  tx.feePayer = feePayer;
  await attachBlockhash(connection, tx);

  return {
    transaction: tx,
    requiredSigners: requiredSigners(tx),
    missingSigners: requiredSigners(tx),
    feePayer,
    summary: {
      action: "cancel",
      dealPda,
      programId: program.programId,
      amountLamports: BigInt(deal.amount.toString()),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Partial signing and relay                                           */
/* ------------------------------------------------------------------ */

/**
 * Add one party's signature to a transaction, leaving the other slots empty.
 *
 * Uses `Transaction.partialSign`, which signs the message as compiled today and
 * writes the signature into that signer's own slot. Critically, it does **not**
 * reset the other slots when the signer order already matches the compiled
 * message — which is guaranteed here because every transaction this library
 * hands out is either freshly built (so `_compile` establishes the order) or
 * came back through `deserializeTransaction` (so the order is fixed by the wire
 * bytes). That is what makes the forward-and-back relay safe.
 *
 * Caveat, and it is the sharp edge of this whole approach: the blockhash, the
 * fee payer and the instruction list are all part of the signed message, so
 * they must be finalised *before* the first signature and must not be touched
 * afterwards. `build*Transaction` does that; nothing here mutates them.
 */
export async function partialSign(
  prepared: PreparedTransaction,
  wallet: SignableWallet
): Promise<PreparedTransaction> {
  const { transaction } = prepared;
  const key = wallet.publicKey.toBase58();
  const expected = prepared.requiredSigners.map((k) => k.toBase58());
  if (!expected.includes(key)) {
    throw new Error(
      `Wallet ${key} is not a required signer of this transaction. ` +
        `Required: ${expected.join(", ")}`
    );
  }
  await wallet.signTransaction(transaction);
  return {
    ...prepared,
    missingSigners: prepared.missingSigners.filter((k) => k.toBase58() !== key),
  };
}

/**
 * Serialise a partially signed transaction for transport to the next signer.
 *
 * `requireAllSignatures: false` is essential — a half-signed transaction is
 * exactly what we intend to send, and default verification would reject it.
 */
export function serializeTransaction(tx: Transaction): string {
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

/**
 * Rebuild a transaction received from the other party.
 *
 * `Transaction.from` restores the message byte-for-byte (fee payer, blockhash,
 * instruction order, signatures with empty slots as `null`), which is what
 * keeps the second signature valid against the first. Any re-derivation of the
 * message here would change the bytes and invalidate the signature already
 * collected.
 */
export function deserializeTransaction(encoded: string): Transaction {
  return Transaction.from(Buffer.from(encoded, "base64"));
}

/**
 * Re-attach the client-side view to a transaction received from a counterparty.
 *
 * A bare `Transaction` off the wire does not know which action it is or what
 * the fee split was, so the relay carries the summary separately (see
 * `relayEnvelope`) and this recombines them for the second signer's UI.
 */
export function prepareReceivedTransaction(
  tx: Transaction,
  summary: TransactionSummary
): PreparedTransaction {
  const required = requiredSigners(tx);
  const signed = new Set(
    tx.signatures
      .filter((pair) => pair.signature !== null)
      .map((pair) => pair.publicKey.toBase58())
  );
  return {
    transaction: tx,
    requiredSigners: required,
    missingSigners: required.filter((k) => !signed.has(k.toBase58())),
    feePayer: tx.feePayer ?? required[0],
    summary,
  };
}

/** What one party sends the other over any out-of-band channel. */
export interface RelayEnvelope {
  /** Base64 wire transaction, still missing at least one signature. */
  transaction: string;
  /** The action, deal and fee split, so the second signer sees what they sign. */
  summary: SerializedSummary;
  /** Who still needs to sign. */
  missingSigners: string[];
}

/** `TransactionSummary` with keys rendered as base58 for JSON transport. */
export interface SerializedSummary {
  action: TransactionSummary["action"];
  dealPda: string;
  programId: string;
  amountLamports?: string;
  feeAmountLamports?: string;
  providerAmountLamports?: string;
  feePercent?: number;
  treasury?: string;
}

export function serializeSummary(summary: TransactionSummary): SerializedSummary {
  return {
    action: summary.action,
    dealPda: summary.dealPda.toBase58(),
    programId: summary.programId.toBase58(),
    amountLamports: summary.amountLamports?.toString(),
    feeAmountLamports: summary.feeSplit?.feeAmount.toString(),
    providerAmountLamports: summary.feeSplit?.providerAmount.toString(),
    feePercent: summary.feeSplit?.feePercent,
    treasury: summary.treasury?.toBase58(),
  };
}

export function deserializeSummary(summary: SerializedSummary): TransactionSummary {
  return {
    action: summary.action,
    dealPda: new PublicKey(summary.dealPda),
    programId: new PublicKey(summary.programId),
    amountLamports: summary.amountLamports
      ? BigInt(summary.amountLamports)
      : undefined,
    feeSplit:
      summary.feeAmountLamports && summary.providerAmountLamports
        ? {
            feeAmount: BigInt(summary.feeAmountLamports),
            providerAmount: BigInt(summary.providerAmountLamports),
            feePercent: summary.feePercent ?? 0,
          }
        : undefined,
    treasury: summary.treasury ? new PublicKey(summary.treasury) : undefined,
  };
}

/** Package a partially signed transaction for the other signer. */
export function relayEnvelope(
  prepared: PreparedTransaction
): RelayEnvelope {
  return {
    transaction: serializeTransaction(prepared.transaction),
    summary: serializeSummary(prepared.summary),
    missingSigners: prepared.missingSigners.map((k) => k.toBase58()),
  };
}

/** Unpackage a relayed transaction. */
export function openEnvelope(envelope: RelayEnvelope): PreparedTransaction {
  return prepareReceivedTransaction(
    deserializeTransaction(envelope.transaction),
    deserializeSummary(envelope.summary)
  );
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

/**
 * Broadcast a fully signed transaction and wait for confirmation.
 *
 * The blockhash is read back off the transaction rather than re-fetched, so the
 * confirmation uses the same blockhash the signatures committed to. Waiting on
 * `lastValidBlockHeight` rather than a wall-clock timeout means an expired
 * transaction fails deterministically instead of hanging.
 */
export async function submitTransaction(
  connection: Connection,
  tx: Transaction,
  opts: ConfirmOptions = { commitment: "confirmed" }
): Promise<string> {
  const missing = tx.signatures.filter((pair) => pair.signature === null);
  if (missing.length > 0) {
    throw new Error(
      `Transaction is not fully signed; missing ${missing
        .map((pair) => pair.publicKey.toBase58())
        .join(", ")}`
    );
  }
  const blockhash = tx.recentBlockhash;
  const signature = await connection.sendRawTransaction(
    tx.serialize({ requireAllSignatures: true, verifySignatures: true }),
    { skipPreflight: false, maxRetries: 3, preflightCommitment: opts.commitment }
  );
  if (blockhash) {
    const latest = await connection.getLatestBlockhash(opts.commitment);
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      opts.commitment
    );
  }
  return signature;
}

/* ------------------------------------------------------------------ */
/* High-level client                                                   */
/* ------------------------------------------------------------------ */

/**
 * Convenience wrapper tying a connection + wallet to the four escrow flows.
 *
 * The `prepare*` methods return transactions for the two-party relay;
 * `signAndSubmit` is the single-signer shortcut used by initialize and refund,
 * and by a party that already holds both keys (the manual test script).
 */
export class EscrowClient {
  readonly connection: Connection;
  readonly program: EscrowProgram;

  constructor(connection: Connection, wallet: SignableWallet) {
    this.connection = connection;
    this.program = makeEscrowProgram(connection, new AdapterWallet(wallet));
  }

  static forKeypair(connection: Connection, signer: Signer): EscrowClient {
    if (!("secretKey" in signer)) {
      throw new Error("forKeypair expects a Keypair");
    }
    return new EscrowClient(connection, new KeypairWallet(signer as never));
  }

  /**
   * A client for reads only — `config()`, `deal()`, `previewSettle()`.
   *
   * Reading accounts goes through an Anchor `Program`, and a `Program` needs a
   * wallet. The generated keypair here is never asked to sign anything; it only
   * satisfies that constructor requirement. This exists so the UI can show the
   * platform fee *before* the user connects, which matters because the fee is
   * part of the decision to use the app at all.
   */
  static readOnly(connection: Connection): EscrowClient {
    return new EscrowClient(
      connection,
      new KeypairWallet(Keypair.generate())
    );
  }

  /**
   * The four escrow flows, named as the Phase 2 brief names them.
   *
   * These are thin aliases for the `prepare*` methods, kept because the brief
   * specifies these names and they are what a caller looks for first. They
   * return a `PreparedTransaction` — unsigned — rather than submitting, because
   * settle and cancel need two signatures.
   *
   * For settle that second signature is the *backend's*: in production the
   * oracle is an automated verifier whose key is held server-side, so the
   * natural caller is a settle endpoint that builds here, signs as oracle, and
   * lets the provider sign in the browser. See `PHASE2_NOTES.md`; the
   * partial-sign-and-forward relay is retained as a reference pattern for two
   * independent wallets that share no server, and `signAndSubmit` is the
   * shortcut when one caller holds every key.
   */
  initializeEscrow(
    params: Omit<InitializeEscrowParams, "depositor"> & {
      depositor: SignableWallet;
    }
  ): Promise<PreparedTransaction> {
    return this.prepareInitialize(params);
  }

  /** Derives and passes the PlatformConfig PDA from the on-chain config. */
  settleEscrow(dealPda: PublicKey, feePayer: PublicKey) {
    return this.prepareSettle(dealPda, feePayer);
  }

  refundEscrow(dealPda: PublicKey, authority: PublicKey) {
    return this.prepareRefund(dealPda, authority);
  }

  cancelEscrow(dealPda: PublicKey, feePayer: PublicKey) {
    return this.prepareCancel(dealPda, feePayer);
  }

  /** `[b"deal", depositor, dealId]` for this program. */
  dealAddress(depositor: PublicKey, dealId: string): PublicKey {
    return findDealAddress(this.program.programId, depositor, dealId)[0];
  }

  prepareInitialize(params: Omit<InitializeEscrowParams, "depositor"> & {
    depositor: SignableWallet;
  }): Promise<PreparedTransaction> {
    return buildInitializeTransaction(this.program, this.connection, params);
  }

  prepareSettle(
    dealPda: PublicKey,
    feePayer: PublicKey
  ): Promise<PreparedTransaction> {
    return buildSettleTransaction(
      this.program,
      this.connection,
      dealPda,
      feePayer
    );
  }

  prepareRefund(
    dealPda: PublicKey,
    authority: PublicKey
  ): Promise<PreparedTransaction> {
    return buildRefundTransaction(
      this.program,
      this.connection,
      dealPda,
      authority
    );
  }

  prepareCancel(
    dealPda: PublicKey,
    feePayer: PublicKey
  ): Promise<PreparedTransaction> {
    return buildCancelTransaction(
      this.program,
      this.connection,
      dealPda,
      feePayer
    );
  }

  /**
   * Sign with each wallet in turn and submit.
   *
   * Sequential, not parallel: each signature must be applied to the same
   * compiled message, and the second signer's slot is only correct because the
   * first did not disturb the order. In a browser the equivalent calls are
   * split across two users via `relayEnvelope`/`openEnvelope`.
   */
  async signAndSubmit(
    prepared: PreparedTransaction,
    wallets: SignableWallet[]
  ): Promise<string> {
    let current = prepared;
    for (const wallet of wallets) {
      current = await partialSign(current, wallet);
    }
    return submitTransaction(this.connection, current.transaction);
  }

  /** Read the live fee + treasury. */
  config(): Promise<PlatformConfigView> {
    return fetchPlatformConfig(this.program);
  }

  /** The split a settle would apply right now. */
  previewSettle(dealPda: PublicKey) {
    return previewSettleSplit(this.program, dealPda);
  }

  deal(dealPda: PublicKey): Promise<DealView | null> {
    return fetchDeal(this.program, dealPda);
  }
}

/** Re-exported so consumers do not need a second import for SOL formatting. */
export { LAMPORTS_PER_SOL };
export type { EscrowProgram, AnchorProvider };
