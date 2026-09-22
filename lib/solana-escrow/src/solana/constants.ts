import { PublicKey } from "@solana/web3.js";

/**
 * Seed constants mirrored from `programs/adadive_escrow/src/constants.rs`.
 *
 * These are duplicated rather than imported from the IDL because Anchor's IDL
 * exposes PDA seeds only as per-instruction metadata; the client needs them as
 * standalone values to derive addresses before it has a `Deal` account to read
 * (e.g. to look up whether a deal exists at all).
 */
export const DEAL_SEED = Buffer.from("deal");
export const PLATFORM_CONFIG_SEED = Buffer.from("platform_config");

/**
 * Basis-point denominator, matching `FEE_BASIS_POINTS_DENOMINATOR` on-chain.
 *
 * The client reproduces the program's split arithmetic so it can *preview* the
 * fee before signing. It is deliberately integer math on `bigint`: the on-chain
 * result is `amount * fee_basis_points / 10_000` truncated toward zero, and the
 * client must land on exactly the same number, which a float would not
 * guarantee.
 */
export const FEE_BASIS_POINTS_DENOMINATOR = BigInt(10_000);

/**
 * Program id. Kept in sync with `declare_id!` in `lib.rs` and the `address`
 * field of the generated IDL; `assertProgramIdMatchesIdl` checks that at
 * runtime so a rebuilt program cannot silently mismatch this constant.
 */
export const ESCROW_PROGRAM_ID = new PublicKey(
  "B6kX44TWx7p75rEXaJmQ5jQJ3L9wGhZqaQ8xEK2j1cGp"
);

/** Lamports per SOL, for display and form parsing only. */
export const LAMPORTS_PER_SOL = 1_000_000_000;
