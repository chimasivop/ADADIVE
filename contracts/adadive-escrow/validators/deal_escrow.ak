//// ADADIVE deal escrow validator (v1 — oracle/arbiter attestation).
////
//// A client locks payment into this script when creating a storage deal. The
//// funds can leave the script in exactly three ways:
////
////   * `Settle` — the trusted `oracle` and the `provider` co-sign. The oracle
////     signature attests that the provider produced valid proof-of-storage
////     off-chain. Only valid up to `deadline`.
////   * `Refund` — after `deadline`, the `client` may unilaterally reclaim the
////     escrow because the provider never settled.
////   * `Cancel` — the `client` and `provider` mutually agree to unwind the
////     deal at any time. The client must receive at least `payment` back.
////
//// Security properties (v1):
////   * The provider cannot take funds without the oracle's approval.
////   * The oracle cannot take funds without the provider (and is never a
////     recipient), so a rogue oracle cannot steal — only withhold/grief.
////   * The client cannot reclaim before `deadline` except by mutual `Cancel`.
////   * The fund destination is enforced on-chain: `Settle` must pay the
////     provider and `Refund` must pay the client (each at least `payment`
////     lovelace), so a correctly-signed spend cannot be redirected elsewhere.
////     `Cancel` requires the client to receive at least `payment` back,
////     preventing fund theft via client+provider collusion.
////   * The `client`, `provider`, and `oracle` keys must be distinct; a datum
////     that reuses a key across roles is rejected, so a shared key can never
////     collapse a two-signature requirement to one.
////   * `payment` must be positive; a datum with `payment <= 0` is rejected so
////     the payout check cannot be trivially satisfied.
////   * Deal parameters have bounds: storage_gb > 0, duration_epochs > 0,
////     deadline > start_time, data_hash non-empty.
////
//// The actual authorization logic lives in `adadive/escrow.validate` so it can
//// be unit tested directly; this module is just the on-chain entrypoint.

use adadive/escrow
use adadive/types.{DealDatum, DealRedeemer}
use cardano/transaction.{OutputReference, Transaction}

validator deal_escrow {
  spend(
    datum: Option<DealDatum>,
    redeemer: DealRedeemer,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(deal) = datum
    escrow.validate(
      deal,
      redeemer,
      self.validity_range,
      self.extra_signatories,
      self.outputs,
    )
  }

  else(_) {
    fail
  }
}
