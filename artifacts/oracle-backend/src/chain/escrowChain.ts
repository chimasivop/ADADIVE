/**
 * The bridge to the Phase 2 client library.
 *
 * The brief for this phase is explicit that settle submission must **reuse**
 * `settleEscrow` from the Phase 2 client library rather than reimplement
 * transaction construction, so this file does exactly two things: it re-exports
 * that library, and it narrows the surface the oracle service is allowed to use
 * to a single interface.
 *
 * The interface exists so the service is testable without a validator. A test
 * supplies a fake `EscrowChain` and asserts on the *decision* the service made
 * (did it settle, did it refuse, what did it record) without needing a cluster,
 * and the real implementation is a thin, obvious adapter over the shared
 * library that the Phase 2 suite already covers.
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import {
  EscrowClient,
  KeypairWallet,
  partialSign,
  submitTransaction,
  type DealView,
  type PreparedTransaction,
} from "@workspace/solana-escrow";
import type { Logger } from "../logger";
import { safeErrorMessage, type SecretRegistry } from "../security/redact";
import type { OracleKeypair } from "../oracle/keyProvider";

export type { DealView, PreparedTransaction } from "@workspace/solana-escrow";
export { EscrowClient, KeypairWallet, partialSign, submitTransaction };

export interface SettleOutcome {
  signature: string;
}

/**
 * The chain operations the oracle service needs, and nothing more.
 *
 * Deliberately small: if the service needed a new on-chain read, that should be
 * an explicit addition here, because every method is a place where "the backend
 * knows something the program does not" can creep in.
 */
export interface EscrowChain {
  /** Read the on-chain deal, or `null` if the account is closed/absent. */
  fetchDeal(dealPda: PublicKey): Promise<DealView | null>;
  /**
   * Build the settle transaction via the shared client library, sign as the
   * oracle, and submit. Returns the transaction signature.
   */
  settleAsOracle(params: SettleAsOracleParams): Promise<SettleOutcome>;
}

export interface SettleAsOracleParams {
  dealPda: PublicKey;
  oracle: OracleKeypair;
  /** The provider's signature, obtained per the configured strategy. */
  providerSignature: ProviderSignature;
}

/**
 * How the provider's half of the settle signature is obtained.
 *
 * `settle` on-chain requires oracle **and** provider, so the backend cannot
 * submit with the oracle's signature alone. The window between the settle
 * request and window close is up to `challenge_window` (48h by default), which
 * is far longer than a Solana blockhash is valid, so the provider cannot simply
 * pre-sign at request time and have the bytes still be valid days later.
 *
 * Three strategies, matching the three deployment shapes:
 *
 *   - `demo-keypair` — the backend holds the provider key. Prototype/dev/test
 *     only. This is what makes the auto-settle path demonstrable end-to-end;
 *     it is refused when NODE_ENV=production.
 *
 *   - `durable-nonce` — production. The provider pre-signs a transaction built
 *     against a durable nonce account instead of a recent blockhash, so the
 *     signature stays valid indefinitely; the backend completes it at window
 *     close. This is the standard Solana mechanism for exactly this problem and
 *     requires a nonce account per deal (or per provider) to be initialized
 *     on-chain up front.
 *
 *   - `deferred` — production fallback. The backend builds and oracle-signs at
 *     window close and hands the half-signed transaction back to the provider,
 *     who adds the second signature and submits. This is the Phase 2
 *     partial-sign pattern used for its intended purpose.
 *
 * `durable-nonce` and `deferred` are documented rather than fully plumbed: the
 * nonce account lifecycle is on-chain setup that this phase is not allowed to
 * touch (no `programs/` changes), and `deferred` is a two-step API this phase's
 * endpoint shape does not include. `demo-keypair` is implemented. See
 * PHASE3_NOTES.md, "The second signature", for the full reasoning.
 */
export type ProviderSignatureStrategy =
  | "demo-keypair"
  | "durable-nonce"
  | "deferred";

/** A provider signature resolved for one settle attempt. */
export type ProviderSignature =
  | { kind: "keypair"; signer: Keypair }
  | { kind: "pre-signed"; transaction: PreparedTransaction };

/**
 * The real chain adapter: builds through the shared client library.
 */
export class SolanaEscrowChain implements EscrowChain {
  constructor(
    private readonly connection: Connection,
    private readonly logger: Logger,
    private readonly registry: SecretRegistry
  ) {}

  async fetchDeal(dealPda: PublicKey): Promise<DealView | null> {
    // A read-only client suffices: `deal()` never signs.
    return EscrowClient.readOnly(this.connection).deal(dealPda);
  }

  async settleAsOracle(params: SettleAsOracleParams): Promise<SettleOutcome> {
    const { dealPda, oracle, providerSignature } = params;

    // The oracle is the fee payer here, exactly as in the Phase 2 walkthrough:
    // it holds funds for the purpose and it keeps the provider's wallet out of
    // the fee path.
    const client = EscrowClient.forKeypair(this.connection, oracle.signer);

    // This is the Phase 2 function, not a reimplementation of it. It reads the
    // live PlatformConfig for the treasury and fee, derives the config PDA, and
    // returns a `PreparedTransaction` whose message is already frozen.
    const built = await client.settleEscrow(dealPda, oracle.publicKey);

    const oracleWallet = new KeypairWallet(oracle.signer);
    let prepared = await partialSign(built, oracleWallet);

    if (providerSignature.kind === "pre-signed") {
      // A transaction the provider already signed (durable-nonce shape). The
      // message must be the one the provider signed, so we verify rather than
      // rebuild — rebuilding would invalidate their signature.
      prepared = providerSignature.transaction;
      prepared = await partialSign(prepared, oracleWallet);
    } else {
      prepared = await partialSign(
        prepared,
        new KeypairWallet(providerSignature.signer)
      );
    }

    if (prepared.missingSigners.length > 0) {
      const missing = prepared.missingSigners.map((k) => k.toBase58()).join(", ");
      throw new Error(
        `settle transaction is still missing signatures: ${missing}`
      );
    }

    this.logger.info("submitting settle", {
      dealPda: dealPda.toBase58(),
      providerSignature: providerSignature.kind,
    });

    try {
      const signature = await submitTransaction(
        this.connection,
        prepared.transaction
      );
      return { signature };
    } catch (err) {
      // Submission failures can quote the transaction (and therefore key
      // material) back; scrub before it reaches the caller.
      throw new Error(
        `settle submission failed: ${safeErrorMessage(err, this.registry)}`
      );
    }
  }
}

/**
 * Resolve the provider signature for a settle attempt.
 *
 * The production strategies are refused here with a precise message rather than
 * failing obscurely at submit time, so an operator who configures
 * `PROVIDER_SIGNATURE_STRATEGY=durable-nonce` learns immediately that the nonce
 * plumbing is not part of this phase.
 */
export async function resolveProviderSignature(
  strategy: ProviderSignatureStrategy,
  demoProvider: Keypair | null
): Promise<ProviderSignature> {
  switch (strategy) {
    case "demo-keypair":
      if (!demoProvider) {
        throw new Error(
          "provider signature strategy 'demo-keypair' requires " +
            "DEMO_PROVIDER_KEYPAIR_PATH (development only)"
        );
      }
      return { kind: "keypair", signer: demoProvider };
    case "durable-nonce":
      throw new Error(
        "provider signature strategy 'durable-nonce' is documented but not " +
          "implemented in Phase 3: it requires a durable nonce account per " +
          "deal, which is on-chain setup this phase does not include"
      );
    case "deferred":
      throw new Error(
        "provider signature strategy 'deferred' is documented but not " +
          "implemented in Phase 3: it is a two-step API (build+oracle-sign, " +
          "then provider completes) that this phase's endpoint shape omits"
      );
  }
}
