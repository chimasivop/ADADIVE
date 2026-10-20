use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::{
    constants::*,
    state::{Deal, PlatformConfig},
    EscrowError,
};

#[derive(Accounts)]
#[instruction(amount: u64, deal_id: String, start_time: i64, deadline: i64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: role key only; compared against the oracle argument, never read.
    pub provider: UncheckedAccount<'info>,

    /// CHECK: role key only; compared against the oracle argument, never read.
    pub oracle: UncheckedAccount<'info>,

    #[account(
        init,
        payer = depositor,
        space = 8 + Deal::INIT_SPACE,
        seeds = [DEAL_SEED, depositor.key().as_ref(), deal_id.as_bytes()],
        bump
    )]
    pub deal: Account<'info, Deal>,

    /// Platform policy account, read to enforce the per-deal value cap. Required
    /// so a deal cannot be opened before the platform has set its policy; the
    /// `[PLATFORM_CONFIG_SEED]` PDA and the program's ownership of it mean this
    /// cannot be a look-alike account.
    #[account(seeds = [PLATFORM_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    amount: u64,
    deal_id: String,
    start_time: i64,
    deadline: i64,
) -> Result<()> {
    // Scope guards mirroring the Aiken `is_v1_scope` block. The amount guards
    // (positive, within the platform cap) are factored into
    // `validate_deposit_amount` so they can be unit tested directly.
    validate_deposit_amount(amount, ctx.accounts.config.max_deal_amount)?;
    require!(!deal_id.is_empty(), EscrowError::EmptyDealId);
    require!(
        ctx.accounts.depositor.key() != ctx.accounts.provider.key()
            && ctx.accounts.depositor.key() != ctx.accounts.oracle.key()
            && ctx.accounts.provider.key() != ctx.accounts.oracle.key(),
        EscrowError::RolesNotDistinct
    );
    require!(start_time > 0, EscrowError::InvalidDeadline);
    require!(deadline > start_time, EscrowError::InvalidDeadline);

    // Lock the funds in the deal account. The account address is a PDA over
    // the depositor and deal_id, so no third party can substitute a deal.
    let cpi_ctx = CpiContext::new(
        system_program::ID,
        Transfer {
            from: ctx.accounts.depositor.to_account_info(),
            to: ctx.accounts.deal.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, amount)?;

    let deal = &mut ctx.accounts.deal;
    deal.depositor = ctx.accounts.depositor.key();
    deal.provider = ctx.accounts.provider.key();
    deal.oracle = ctx.accounts.oracle.key();
    deal.amount = amount;
    deal.deal_id = deal_id;
    deal.start_time = start_time;
    deal.deadline = deadline;
    deal.bump = ctx.bumps.deal;

    msg!(
        "Escrow locked: {} lamports for deal {}",
        amount,
        deal.deal_id
    );
    Ok(())
}

/// Guard a requested deposit against the platform policy.
///
/// Split out from `handle_initialize` so the two amount rules — positive, and
/// no greater than the live `PlatformConfig::max_deal_amount` — are a pure
/// function that can be unit tested without a `Context`. The cap comparison is
/// inclusive: a deposit of exactly `max_deal_amount` is allowed, and only a
/// strictly greater amount is rejected.
pub fn validate_deposit_amount(amount: u64, max_deal_amount: u64) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);
    require!(amount <= max_deal_amount, EscrowError::DealAmountExceedsMax);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A deal exactly at the cap is accepted (boundary is inclusive).
    #[test]
    fn deposit_at_cap_is_accepted() {
        assert!(validate_deposit_amount(10_000_000_000, 10_000_000_000).is_ok());
    }

    /// One lamport over the cap is rejected.
    #[test]
    fn deposit_over_cap_is_rejected() {
        let err = validate_deposit_amount(10_000_000_001, 10_000_000_000)
            .expect_err("over-cap deposit must be rejected");
        assert_eq!(err, EscrowError::DealAmountExceedsMax.into());
    }

    /// A comfortably-under-cap deposit is accepted.
    #[test]
    fn deposit_under_cap_is_accepted() {
        assert!(validate_deposit_amount(1, 10_000_000_000).is_ok());
    }

    /// Zero is still rejected by the positivity rule, not the cap rule.
    #[test]
    fn zero_deposit_is_rejected() {
        let err =
            validate_deposit_amount(0, 10_000_000_000).expect_err("zero deposit must be rejected");
        assert_eq!(err, EscrowError::InvalidAmount.into());
    }

    /// The cap is read from config, so a raised cap admits a previously
    /// over-cap amount — this is the "raise it later" path.
    #[test]
    fn raising_the_cap_admits_larger_deposit() {
        let amount = 50_000_000_000;
        assert!(validate_deposit_amount(amount, 10_000_000_000).is_err());
        assert!(validate_deposit_amount(amount, 100_000_000_000).is_ok());
    }
}
