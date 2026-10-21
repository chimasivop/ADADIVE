use anchor_lang::prelude::*;

use crate::{constants::*, state::Deal, EscrowError};

/// The oracle may sign alone to send funds back to the depositor; after the
/// deadline the depositor may reclaim unilaterally.
///
/// This is the v1 "refund" path from the Cardano validator (`signed_by(client)
/// && must_start_after(deadline)`) generalised so the oracle can also act as
/// the depositor's protector before expiry.
#[derive(Accounts)]
pub struct Refund<'info> {
    /// Either the deal's oracle, or the depositor once the deadline has passed.
    pub authority: Signer<'info>,

    /// CHECK: receives the escrowed lamports; must be `deal.depositor`.
    #[account(mut, address = deal.depositor)]
    pub depositor: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [DEAL_SEED, deal.depositor.as_ref(), deal.deal_id.as_bytes()],
        bump = deal.bump,
        close = depositor,
    )]
    pub deal: Account<'info, Deal>,
}

pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    let deal = &ctx.accounts.deal;
    let signer = ctx.accounts.authority.key();
    let now = Clock::get()?.unix_timestamp;

    let authorized = if signer == deal.oracle {
        true
    } else {
        signer == deal.depositor && now > deal.deadline
    };
    require!(authorized, EscrowError::RefundNotAuthorized);

    msg!(
        "Refunded deal {}: {} lamports returned to depositor",
        deal.deal_id,
        deal.amount
    );
    Ok(())
}
