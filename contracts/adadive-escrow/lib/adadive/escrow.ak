//// Pure spend-authorization logic for the ADADIVE deal escrow (v1, oracle
//// model). Kept separate from the `validator` wrapper so it can be unit
//// tested directly.

use adadive/types.{
  Cancel, DealDatum, DealRedeemer, Locked, OracleAttested, Refund, Settle,
}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite, IntervalBound}
use cardano/transaction.{ValidityRange}

/// Decide whether spending an escrowed deal UTxO is authorized.
///
/// v1 only governs `OracleAttested` deals still in the `Locked` phase; any
/// other datum shape is rejected, reserving those variants for the v2
/// optimistic-challenge validator (a separate script hash).
pub fn validate(
  deal: DealDatum,
  redeemer: DealRedeemer,
  range: ValidityRange,
  signatories: List<VerificationKeyHash>,
) -> Bool {
  let is_v1_scope = deal.model == OracleAttested && deal.phase == Locked

  is_v1_scope && when redeemer is {
    // Oracle attests valid proof-of-storage and the provider claims, before
    // the settlement deadline.
    Settle ->
      signed_by(signatories, deal.oracle) && signed_by(
        signatories,
        deal.provider,
      ) && must_end_before(range, deal.deadline)
    // After the deadline the client may unilaterally reclaim the escrow.
    Refund ->
      signed_by(signatories, deal.client) && must_start_after(
        range,
        deal.deadline,
      )
    // Both parties mutually agree to unwind the deal at any time.
    Cancel ->
      signed_by(signatories, deal.client) && signed_by(
        signatories,
        deal.provider,
      )
  }
}

/// True if `vk` is among the transaction's verification-key signatories.
pub fn signed_by(
  signatories: List<VerificationKeyHash>,
  vk: VerificationKeyHash,
) -> Bool {
  list.has(signatories, vk)
}

/// True if the whole transaction validity range is at or after `deadline`,
/// i.e. the transaction cannot be submitted before `deadline`.
pub fn must_start_after(range: ValidityRange, deadline: Int) -> Bool {
  when range.lower_bound is {
    IntervalBound { bound_type: Finite(tx_earliest), .. } ->
      deadline <= tx_earliest
    _ -> False
  }
}

/// True if the whole transaction validity range is at or before `deadline`,
/// i.e. the transaction cannot be submitted after `deadline`.
pub fn must_end_before(range: ValidityRange, deadline: Int) -> Bool {
  when range.upper_bound is {
    IntervalBound { bound_type: Finite(tx_latest), .. } -> tx_latest <= deadline
    _ -> False
  }
}
