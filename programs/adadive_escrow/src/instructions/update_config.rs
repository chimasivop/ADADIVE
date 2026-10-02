use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, state::PlatformConfig, MAX_FEE_BASIS_POINTS};

/// Update the fee and/or treasury after initialization.
///
/// Both fields are optional so a caller can change one without having to
/// re-supply the other. `authority` is deliberately *not* updatable here:
/// rotating the admin key is a separate, higher-impact operation and keeping
/// it off this instruction avoids a single signature both changing the fee and
/// handing control to a new key.
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    /// Must equal `config.authority`.
    #[account(address = config.authority @ EscrowError::ConfigAuthorityMismatch)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    fee_basis_points: Option<u16>,
    treasury: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(bp) = fee_basis_points {
        require!(
            u64::from(bp) <= MAX_FEE_BASIS_POINTS,
            EscrowError::InvalidFeeBasisPoints
        );
        config.fee_basis_points = bp;
    }
    if let Some(t) = treasury {
        require!(t != Pubkey::default(), EscrowError::InvalidConfigTreasury);
        config.treasury = t;
    }

    msg!(
        "Platform config updated: fee {} bp, treasury {}",
        config.fee_basis_points,
        config.treasury
    );
    Ok(())
}
