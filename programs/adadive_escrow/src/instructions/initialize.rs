use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::{constants::*, state::Deal, EscrowError};

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

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    amount: u64,
    deal_id: String,
    start_time: i64,
    deadline: i64,
) -> Result<()> {
    // Scope guards mirroring the Aiken `is_v1_scope` block.
    require!(amount > 0, EscrowError::InvalidAmount);
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