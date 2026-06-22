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
////     deal at any time.
////
//// Security properties (v1):
////   * The provider cannot take funds without the oracle's approval.
////   * The oracle cannot take funds without the provider (and is never a
////     recipient), so a rogue oracle cannot steal — only withhold/grief.
////   * The client cannot reclaim before `deadline` except by mutual `Cancel`.
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
    escrow.validate(deal, redeemer, self.validity_range, self.extra_signatories)
  }

  else(_) {
    fail
  }
}
