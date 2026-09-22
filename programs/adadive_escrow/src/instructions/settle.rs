use anchor_lang::prelude::*;

use crate::{
    constants::*, error::EscrowError, state::Deal, state::PlatformConfig,
    FEE_BASIS_POINTS_DENOMINATOR,
};

/// Happy path. The oracle AND the provider must co-sign; the escrowed funds are
/// split between the provider and the platform treasury.
///
/// This mirrors the Cardano `Settle` redeemer, which requires
/// `signed_by(oracle) && signed_by(provider)` and `must_end_before(deadline)`,
/// extended with a platform fee.
///
/// The escrow lives in the `Deal` account itself, which is *data-carrying*, and
/// the system program refuses to debit a data-carrying account
/// (`Transfer: from must not carry data`). The split is therefore performed
/// with direct lamport arithmetic on the `Deal` account, the same mechanism
/// Anchor's own `close` uses for the rent sweep. Both legs are applied in one
/// instruction, so the runtime reverts the whole thing if either would
/// underflow: the provider and treasury are credited together or not at all.
///
/// Both destinations are program decisions — the provider slot is pinned to
/// `deal.provider` and the treasury slot to `config.treasury` — so a caller
/// cannot redirect either payout. Whatever remains in the vault afterwards (its
/// rent, and anything donated to the PDA) is swept to the provider by `close`.
#[derive(Accounts)]
pub struct Settle<'info> {
    /// Must equal `deal.oracle`.
    #[account(address = deal.oracle)]
    pub oracle: Signer<'info>,

    /// Must equal `deal.provider`. Receives `amount - fee`, plus the rent
    /// released when the `Deal` account is closed.
    #[account(mut, address = deal.provider)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [DEAL_SEED, deal.depositor.as_ref(), deal.deal_id.as_bytes()],
        bump = deal.bump,
        close = provider,
    )]
    pub deal: Account<'info, Deal>,

    /// Fee policy. Read-only here; only `update_config` may change it.
    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    /// CHECK: receives the fee. Pinned to `config.treasury`; never signed or read.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let deal = &ctx.accounts.deal;

    // Settlement must land at or before the deadline (mirrors `must_end_before`).
    let now = Clock::get()?.unix_timestamp;
    require!(now <= deal.deadline, EscrowError::SettleDeadlinePassed);

    // The fee is paid out of the escrow account, so a treasury that *is* the
    // escrow or the config account would corrupt the vault balance or be
    // unspendable; require a distinct destination.
    require!(
        ctx.accounts.treasury.key() != ctx.accounts.deal.key()
            && ctx.accounts.treasury.key() != ctx.accounts.config.key(),
        EscrowError::InvalidTreasuryAccount
    );

    // Integer split. The multiplication is widened to u128 because `amount` and
    // the basis points can both be large; the result is bounded by `amount`
    // (basis points are capped at 10_000), so it fits back into u64.
    let fee_amount = (u128::from(deal.amount) * u128::from(ctx.accounts.config.fee_basis_points)
        / u128::from(FEE_BASIS_POINTS_DENOMINATOR)) as u64;
    let provider_amount = deal
        .amount
        .checked_sub(fee_amount)
        .ok_or(EscrowError::InvalidFeeBasisPoints)?;

    // Provider leg.
    ctx.accounts.deal.sub_lamports(provider_amount)?;
    ctx.accounts.provider.add_lamports(provider_amount)?;

    // Platform fee leg.
    if fee_amount > 0 {
        ctx.accounts.deal.sub_lamports(fee_amount)?;
        ctx.accounts.treasury.add_lamports(fee_amount)?;
    }

    // Any lamports remaining in the vault (its rent, and anything donated to the
    // PDA) are swept to the provider by `close`, exactly as before the fee.

    msg!(
        "Settled deal {}: {} lamports to provider, {} lamports platform fee to treasury",
        ctx.accounts.deal.deal_id,
        provider_amount,
        fee_amount
    );
    Ok(())
}
