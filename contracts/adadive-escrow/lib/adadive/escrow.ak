//// Pure spend-authorization logic for the ADADIVE deal escrow (v1, oracle
//// model). Kept separate from the `validator` wrapper so it can be unit
//// tested directly.

use adadive/types.{
  Cancel, DealDatum, DealRedeemer, Locked, OracleAttested, Refund, Settle,
}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite, IntervalBound}
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/transaction.{Output, ValidityRange}

/// Decide whether spending an escrowed deal UTxO is authorized.
///
/// v1 only governs `OracleAttested` deals still in the `Locked` phase; any
/// other datum shape is rejected, reserving those variants for the v2
/// optimistic-challenge validator (a separate script hash).
///
/// Authorization is enforced via signatures, timing, **and** the destination of
/// the escrowed funds: `Settle` must pay the provider and `Refund` must pay the
/// client (each at least `deal.payment` lovelace). Signatures alone do not
/// authorize an arbitrary spend.
pub fn validate(
  deal: DealDatum,
  redeemer: DealRedeemer,
  range: ValidityRange,
  signatories: List<VerificationKeyHash>,
  outputs: List<Output>,
) -> Bool {
  let is_v1_scope = deal.model == OracleAttested && deal.phase == Locked

  is_v1_scope && when redeemer is {
    // Oracle attests valid proof-of-storage and the provider claims, before
    // the settlement deadline, and the escrow is paid out to the provider.
    Settle ->
      signed_by(signatories, deal.oracle) && signed_by(
        signatories,
        deal.provider,
      ) && must_end_before(range, deal.deadline) && paid_at_least(
        outputs,
        deal.provider,
        deal.payment,
      )
    // After the deadline the client may unilaterally reclaim the escrow back to
    // itself.
    Refund ->
      signed_by(signatories, deal.client) && must_start_after(
        range,
        deal.deadline,
      ) && paid_at_least(outputs, deal.client, deal.payment)
    // Both parties mutually agree to unwind the deal at any time. The
    // destination is left to the co-signing parties.
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

/// True if at least one transaction output pays `>= amount` lovelace to a
/// payment address controlled by `recipient` (a verification-key credential).
///
/// Uses `>=` so the recipient may also receive change / min-ADA in the same
/// output without failing the check. Stake credentials are not constrained.
pub fn paid_at_least(
  outputs: List<Output>,
  recipient: VerificationKeyHash,
  amount: Int,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      let Output { address, value, .. } = output
      when address is {
        Address { payment_credential: VerificationKey(vk), .. } ->
          vk == recipient && assets.lovelace_of(value) >= amount
        _ -> False
      }
    },
  )
}

/// True if the whole transaction validity range is strictly after `deadline`,
/// i.e. the transaction cannot be submitted at or before `deadline`. This keeps
/// the `Refund` path from overlapping with the on/before-`deadline` `Settle`
/// path at exactly `deadline`.
pub fn must_start_after(range: ValidityRange, deadline: Int) -> Bool {
  when range.lower_bound is {
    IntervalBound { bound_type: Finite(tx_earliest), .. } ->
      deadline < tx_earliest
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
