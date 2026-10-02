import { FEE_BASIS_POINTS_DENOMINATOR } from "./constants";

/** The on-chain `PlatformConfig`, camelCased as Anchor's client decodes it. */
export interface PlatformConfigView {
  feeBasisPoints: number;
  treasury: import("@solana/web3.js").PublicKey;
  authority: import("@solana/web3.js").PublicKey;
  bump: number;
}

/** A settlement split, in lamports. */
export interface FeeSplit {
  /** Lamports delivered to the provider (`amount - fee`). */
  providerAmount: bigint;
  /** Lamports delivered to the treasury. */
  feeAmount: bigint;
  /** The fee as a percentage, for display (derived, never used for math). */
  feePercent: number;
}

/**
 * Reproduce the program's settlement split off-chain.
 *
 * This is a *preview*: the authoritative split is computed on-chain by `settle`
 * from the `PlatformConfig` account. The client derives it only so the UI can
 * show the user what they are about to pay before they sign, and it is
 * intentionally the same integer expression the program uses
 * (`amount * bp / 10_000`, truncating) so the preview cannot disagree with the
 * result. Widened to `bigint` for the same reason the program widens to `u128`:
 * `amount * 10_000` overflows a 64-bit integer for large escrows.
 */
export function computeFeeSplit(
  amountLamports: bigint,
  feeBasisPoints: number
): FeeSplit {
  const bp = BigInt(feeBasisPoints);
  const feeAmount =
    (amountLamports * bp) / FEE_BASIS_POINTS_DENOMINATOR;
  return {
    providerAmount: amountLamports - feeAmount,
    feeAmount,
    feePercent: feeBasisPoints / 100,
  };
}
