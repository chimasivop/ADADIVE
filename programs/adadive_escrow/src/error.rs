use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Escrow amount must be greater than zero")]
    InvalidAmount,
    #[msg("Depositor, provider and oracle must be distinct keys")]
    RolesNotDistinct,
    #[msg("Deadline must be strictly after the start time")]
    InvalidDeadline,
    #[msg("Deal identifier must be non-empty")]
    EmptyDealId,
    #[msg("Settlement deadline has passed; the deal can no longer be settled")]
    SettleDeadlinePassed,
    #[msg("Refund authority must be the oracle, or the depositor after the deadline")]
    RefundNotAuthorized,
    #[msg("Fee basis points must not exceed 10000 (100%)")]
    InvalidFeeBasisPoints,
    #[msg("Platform config authority must be a non-default public key")]
    InvalidConfigAuthority,
    #[msg("Platform config treasury must be a non-default public key")]
    InvalidConfigTreasury,
    #[msg("Only the platform config authority may update the config")]
    ConfigAuthorityMismatch,
    #[msg("Treasury must not be the escrow account or the platform config account")]
    InvalidTreasuryAccount,
    /// Appended after the v1 variants so existing error codes keep their
    /// numbers — a client decoding `6001` as `RolesNotDistinct` must not start
    /// seeing `DealAmountExceedsMax` there after an upgrade.
    #[msg("Escrow amount exceeds the platform's maximum deal value")]
    DealAmountExceedsMax,
    #[msg("Maximum deal amount must be greater than zero")]
    InvalidMaxDealAmount,
}
