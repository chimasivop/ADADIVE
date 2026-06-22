//// Shared on-chain types for the ADADIVE deal escrow.
////
//// The datum is intentionally designed to be forward compatible with a
//// future v2 "optimistic + fraud-proof challenge" settlement model. v1 only
//// uses the oracle/arbiter path, but the datum already carries the fields v2
//// needs (a settlement `model` tag, a `challenge_window`, and a `phase`) so
//// that the off-chain code and database can be written against the final
//// shape now and v2 can be introduced as a new validator without reshaping
//// existing deal records.

use aiken/crypto.{VerificationKeyHash}

/// Which settlement rules govern a deal. v1 deals are always `OracleAttested`.
/// `OptimisticChallenge` is reserved for v2 and is rejected by the v1
/// validator, so a v1 script can never be tricked into running v2 semantics.
pub type SettlementModel {
  /// v1: a trusted arbiter (`oracle`) co-signs settlement to attest that the
  /// provider has demonstrated valid proof-of-storage off-chain.
  OracleAttested
  /// v2 (reserved): provider claims optimistically; anyone may submit a fraud
  /// proof during `challenge_window` before funds finalize.
  OptimisticChallenge
}

/// Lifecycle phase of the escrowed deal. v1 only ever sees `Locked`; the other
/// phases exist so v2's claim/challenge flow slots in without a datum change.
pub type DealPhase {
  /// Funds are escrowed; awaiting settlement, refund, or cancellation.
  Locked
  /// v2 (reserved): provider has posted a completion claim; challenge window
  /// is open until `challenge_deadline`.
  Claimed { challenge_deadline: Int }
}

/// The datum attached to an escrowed deal UTxO.
pub type DealDatum {
  /// Client who funded the deal and may reclaim on expiry/cancellation.
  client: VerificationKeyHash,
  /// Provider who receives payment on successful settlement.
  provider: VerificationKeyHash,
  /// Trusted arbiter that attests proof-of-storage in the v1 oracle model.
  oracle: VerificationKeyHash,
  /// Hash / IPFS CID of the stored data this deal covers.
  data_hash: ByteArray,
  /// Amount escrowed for the provider (lovelace, or THT quantity), informational
  /// for indexers; spend authorization is enforced via signatures + timing.
  payment: Int,
  /// Storage size in gigabytes the provider committed to.
  storage_gb: Int,
  /// Storage duration in Cardano epochs.
  duration_epochs: Int,
  /// POSIX time (ms) when the deal became active.
  start_time: Int,
  /// POSIX time (ms) by which the provider must settle; afterwards the client
  /// may unilaterally refund.
  deadline: Int,
  /// Settlement model in force. v1 requires `OracleAttested`.
  model: SettlementModel,
  /// v2 challenge window length (ms). Ignored by v1; set to 0 for v1 deals.
  challenge_window: Int,
  /// Current lifecycle phase. v1 requires `Locked`.
  phase: DealPhase,
}

/// Actions that can be taken against an escrowed deal UTxO.
///
/// Constructors are append-only: v2 will add `ProviderClaim`, `Challenge`, and
/// `Finalize` without removing or reordering these, so existing off-chain
/// encoders remain valid.
pub type DealRedeemer {
  /// v1: oracle + provider co-sign to release payment to the provider.
  Settle
  /// Client reclaims the escrow after `deadline` has passed with no settlement.
  Refund
  /// Client and provider mutually agree to unwind the deal at any time.
  Cancel
}
