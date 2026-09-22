use anchor_lang::prelude::*;

use crate::{constants::*, state::Deal};

/// Mutual unwind. Depositor AND provider must co-sign, and the funds go back to
/// the depositor. This mirrors the Cardano `Cancel` redeemer
/// (`signed_by(client) && signed_by(provider)`), whose output check
/// (`paid_at_least(client, payment)`) exists to stop a malicious provider from
/// colluding to steal funds. Here that guarantee is structural: the program
/// closes the account to `deal.depositor`, so no output rewrite can divert it.
#[derive(Accounts)]
pub struct Cancel<'info> {
    /// Must equal `deal.depositor`; receives the refunded lamports via `close`.
    #[account(mut, address = deal.depositor)]
    pub depositor: Signer<'info>,

    /// Must equal `deal.provider`.
    #[account(address = deal.provider)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [DEAL_SEED, deal.depositor.as_ref(), deal.deal_id.as_bytes()],
        bump = deal.bump,
        close = depositor,
    )]
    pub deal: Account<'info, Deal>,
}

pub fn handle_cancel(ctx: Context<Cancel>) -> Result<()> {
    msg!(
        "Cancelled deal {}: {} lamports returned to depositor",
        ctx.accounts.deal.deal_id,
        ctx.accounts.deal.amount
    );
    Ok(())
}