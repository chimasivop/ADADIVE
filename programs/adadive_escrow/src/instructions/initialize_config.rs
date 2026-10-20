use anchor_lang::prelude::*;

use crate::{
    constants::*, error::EscrowError, state::PlatformConfig, DEFAULT_MAX_DEAL_AMOUNT,
    MAX_FEE_BASIS_POINTS,
};

/// One-time setup of the singleton `PlatformConfig`.
///
/// Runs before any deal exists. The fee and treasury are arguments rather than
/// constants so the platform can set them without a redeploy; `authority` is
/// captured in the same account so later changes can be gated on it.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: stored as the config's admin key; never read or used in this
    /// instruction. Distinct from `treasury` on purpose — see `PlatformConfig`.
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PlatformConfig::INIT_SPACE,
        seeds = [PLATFORM_CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(
    ctx: Context<InitializeConfig>,
    fee_basis_points: u16,
    treasury: Pubkey,
    max_deal_amount: Option<u64>,
) -> Result<()> {
    require!(
        u64::from(fee_basis_points) <= MAX_FEE_BASIS_POINTS,
        EscrowError::InvalidFeeBasisPoints
    );
    require!(
        ctx.accounts.authority.key() != Pubkey::default(),
        EscrowError::InvalidConfigAuthority
    );
    require!(
        treasury != Pubkey::default(),
        EscrowError::InvalidConfigTreasury
    );

    // The cap defaults to `DEFAULT_MAX_DEAL_AMOUNT` when the platform does not
    // pass one, so a config created by an older caller still gets a safe
    // ceiling rather than an unlimited one. An explicit 0 is rejected: it would
    // block every deal, which is never a sensible policy.
    let max_deal_amount = max_deal_amount.unwrap_or(DEFAULT_MAX_DEAL_AMOUNT);
    require!(max_deal_amount > 0, EscrowError::InvalidMaxDealAmount);

    let config = &mut ctx.accounts.config;
    config.fee_basis_points = fee_basis_points;
    config.max_deal_amount = max_deal_amount;
    config.treasury = treasury;
    config.authority = ctx.accounts.authority.key();
    config.bump = ctx.bumps.config;

    msg!(
        "Platform config initialized: fee {} bp, max deal {} lamports, treasury {}, authority {}",
        fee_basis_points,
        max_deal_amount,
        treasury,
        ctx.accounts.authority.key()
    );
    Ok(())
}
