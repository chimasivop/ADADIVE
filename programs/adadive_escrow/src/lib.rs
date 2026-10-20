pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("7oK8tkw3H8HYqfb23wm2Jss82hSmVffhUDS2R5GE4NdS");

#[program]
pub mod adadive_escrow {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        amount: u64,
        deal_id: String,
        start_time: i64,
        deadline: i64,
    ) -> Result<()> {
        crate::instructions::initialize::handle_initialize(
            ctx, amount, deal_id, start_time, deadline,
        )
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        crate::instructions::settle::handle_settle(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        crate::instructions::refund::handle_refund(ctx)
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        crate::instructions::cancel::handle_cancel(ctx)
    }

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_basis_points: u16,
        treasury: Pubkey,
        max_deal_amount: Option<u64>,
    ) -> Result<()> {
        crate::instructions::initialize_config::handle_initialize_config(
            ctx,
            fee_basis_points,
            treasury,
            max_deal_amount,
        )
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_basis_points: Option<u16>,
        treasury: Option<Pubkey>,
        max_deal_amount: Option<u64>,
    ) -> Result<()> {
        crate::instructions::update_config::handle_update_config(
            ctx,
            fee_basis_points,
            treasury,
            max_deal_amount,
        )
    }

    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        crate::instructions::transfer_authority::handle_transfer_authority(ctx)
    }
}
