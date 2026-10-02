use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, state::PlatformConfig};

/// Hand control of the config to a new authority key.
///
/// Kept deliberately separate from `update_config`: rotating the admin key is a
/// higher-impact operation than changing a number, and a separate instruction
/// means the two can never be bundled into one signature. This is also the hook
/// that makes a future move to a multisig a configuration change rather than a
/// code change — point `authority` at the multisig account (or its vault PDA)
/// and every subsequent admin call routes through it.
#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    /// Must equal `config.authority`; the outgoing admin must consent.
    #[account(address = config.authority @ EscrowError::ConfigAuthorityMismatch)]
    pub authority: Signer<'info>,

    /// CHECK: stored verbatim as the new `config.authority`; not read here. The
    /// key need not be a signer at this point — if it is a multisig, control
    /// simply shifts to whatever that account's signing policy is.
    pub new_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,
}

pub fn handle_transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
    require!(
        ctx.accounts.new_authority.key() != Pubkey::default(),
        EscrowError::InvalidConfigAuthority
    );

    let previous = ctx.accounts.config.authority;
    ctx.accounts.config.authority = ctx.accounts.new_authority.key();

    msg!(
        "Platform config authority transferred from {} to {}",
        previous,
        ctx.accounts.new_authority.key()
    );
    Ok(())
}
