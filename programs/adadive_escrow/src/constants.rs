use anchor_lang::prelude::*;

#[constant]
pub const DEAL_SEED: &[u8] = b"deal";

/// Seed of the singleton `PlatformConfig` PDA.
#[constant]
pub const PLATFORM_CONFIG_SEED: &[u8] = b"platform_config";

/// Basis-point denominator: `fee_basis_points` is a fraction of 10,000, so
/// 250 bp = 2.5%. Basis points keep the split in integer arithmetic, with no
/// floating point and no rounding drift between off-chain and on-chain.
#[constant]
pub const FEE_BASIS_POINTS_DENOMINATOR: u64 = 10_000;

/// Upper bound on the settle fee: 10,000 bp = 100% of the escrowed amount.
#[constant]
pub const MAX_FEE_BASIS_POINTS: u64 = 10_000;

/// Default per-deal value cap, in lamports (10 SOL).
///
/// The cap actually enforced on-chain lives in `PlatformConfig::max_deal_amount`
/// so it is a platform policy value that `update_config` can raise later without
/// redeploying the program. This constant is only the default applied by
/// `initialize_config` when the platform does not pass an explicit cap; it is
/// deliberately *not* read by `initialize`, which trusts the stored config.
pub const DEFAULT_MAX_DEAL_AMOUNT: u64 = 10_000_000_000;

/// Maximum length of a `deal_id` (the off-chain storage deal identifier).
pub const MAX_DEAL_ID_LEN: usize = 64;
