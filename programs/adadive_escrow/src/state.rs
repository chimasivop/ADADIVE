use anchor_lang::prelude::*;

use crate::MAX_DEAL_ID_LEN;

/// The escrowed deal. Stored at a PDA seeded by
/// `[DEAL_SEED, depositor, deal_id]`.
///
/// The escrowed lamports live in this account itself, so every terminal
/// action is expressed as "authorize, then close the account to the payee".
/// That keeps the payout destination structurally impossible to redirect:
/// unlike a UTxO validator that must inspect the transaction's outputs, the
/// program decides the recipient.
#[account]
#[derive(InitSpace)]
pub struct Deal {
    /// Client who funded the deal; receives funds on refund/cancel.
    pub depositor: Pubkey,
    /// Provider who receives payment on successful settlement.
    pub provider: Pubkey,
    /// Trusted arbiter that attests proof-of-storage off-chain.
    pub oracle: Pubkey,
    /// Amount escrowed for the provider, in lamports.
    pub amount: u64,
    /// Off-chain storage deal identifier (mirrors Cardano's `data_hash` role).
    #[max_len(MAX_DEAL_ID_LEN)]
    pub deal_id: String,
    /// Unix timestamp (seconds) when the deal became active.
    pub start_time: i64,
    /// Unix timestamp (seconds) by which the provider must settle.
    /// At or before this instant only `settle` is time-valid; strictly after
    /// it, the depositor may reclaim.
    pub deadline: i64,
    /// PDA bump for `[DEAL_SEED, depositor, deal_id]`.
    pub bump: u8,
}

/// Program-wide configuration. Singleton PDA at `[PLATFORM_CONFIG_SEED]`.
///
/// Split out from `Deal` because the fee is a platform-level policy that must
/// be changeable without redeploying: it lives in one account that `settle`
/// reads, and `update_config` rewrites. The admin key that may rewrite it is
/// `authority`, held deliberately separate from `treasury` so that the
/// spending destination and the control key can be rotated independently.
#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    /// Fee charged on settlement, in basis points of the escrowed amount
    /// (250 = 2.5%). Applied as `amount * fee_basis_points / 10_000` so the
    /// math stays in integers.
    pub fee_basis_points: u16,
    /// Maximum value a single deal may escrow, in lamports. `initialize`
    /// rejects any deposit above this, so it is a hard on-chain ceiling on
    /// worst-case loss per deal. Stored here rather than as a program constant
    /// so it is a policy the platform can raise later via `update_config`
    /// without redeploying.
    pub max_deal_amount: u64,
    /// Destination of the settle fee. Not a signer: it only ever receives
    /// lamports, and is referenced by address in `settle`.
    pub treasury: Pubkey,
    /// Admin key authorized to call `update_config` and `transfer_authority`.
    /// A single wallet today; pointing it at a multisig later is a call to
    /// `transfer_authority`, not a program change, because this field is the
    /// only thing the signer check reads.
    pub authority: Pubkey,
    /// PDA bump for `[PLATFORM_CONFIG_SEED]`.
    pub bump: u8,
}
