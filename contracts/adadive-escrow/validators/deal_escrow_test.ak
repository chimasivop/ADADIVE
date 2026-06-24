//// Unit tests for the v1 deal escrow authorization logic
//// (`adadive/escrow.validate`).
////
//// Happy-path tests assert the validator returns `True`; adversarial tests
//// assert it returns `False`.

use adadive/escrow
use adadive/types.{
  Cancel, Claimed, DealDatum, Locked, OptimisticChallenge, OracleAttested,
  Refund, Settle,
}
use aiken/crypto.{VerificationKeyHash}
use aiken/interval
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/transaction.{NoDatum, Output}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const oracle: VerificationKeyHash =
  #"00000000000000000000000000000000000000000000000000000001"

const provider: VerificationKeyHash =
  #"00000000000000000000000000000000000000000000000000000002"

const client: VerificationKeyHash =
  #"00000000000000000000000000000000000000000000000000000003"

const stranger: VerificationKeyHash =
  #"00000000000000000000000000000000000000000000000000000004"

const deadline: Int = 1_700_000_000_000

const payment: Int = 1_000_000

fn base_datum() -> DealDatum {
  DealDatum {
    client,
    provider,
    oracle,
    data_hash: #"deadbeef",
    payment,
    storage_gb: 10,
    duration_epochs: 6,
    start_time: 1_600_000_000_000,
    deadline,
    model: OracleAttested,
    challenge_window: 0,
    phase: Locked,
  }
}

/// An output paying `amount` lovelace to a verification-key payment address.
fn pay_to(recipient: VerificationKeyHash, amount: Int) -> Output {
  Output {
    address: Address {
      payment_credential: VerificationKey(recipient),
      stake_credential: None,
    },
    value: assets.from_lovelace(amount),
    datum: NoDatum,
    reference_script: None,
  }
}

// ----------------------------------------------------------------------------
// Settle
// ----------------------------------------------------------------------------

test settle_with_oracle_and_provider_before_deadline() {
  escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_without_oracle() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_without_provider() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle],
    [pay_to(provider, payment)],
  )
}

test settle_fails_after_deadline() {
  // Range starts after the deadline => upper bound is +inf, so the
  // "must end before deadline" check fails.
  !escrow.validate(
    base_datum(),
    Settle,
    interval.after(deadline + 1),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_with_unbounded_range() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.everything,
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_provider_underpaid() {
  // Correct signers and timing, but the provider output is short of `payment`.
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment - 1)],
  )
}

test settle_fails_when_payment_goes_to_wrong_party() {
  // Correct signers and timing, but the funds are paid to the client instead
  // of the provider.
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(client, payment)],
  )
}

test settle_fails_with_no_outputs() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [],
  )
}

// ----------------------------------------------------------------------------
// Refund
// ----------------------------------------------------------------------------

test refund_by_client_after_deadline() {
  escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(client, payment)],
  )
}

test refund_fails_at_exactly_deadline() {
  // Refund must be strictly after the deadline so it cannot overlap with the
  // on/before-deadline Settle path.
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline),
    [client],
    [pay_to(client, payment)],
  )
}

test refund_fails_before_deadline() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.before(deadline - 1),
    [client],
    [pay_to(client, payment)],
  )
}

test refund_fails_with_unbounded_range() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.everything,
    [client],
    [pay_to(client, payment)],
  )
}

test refund_fails_for_non_client() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [provider],
    [pay_to(client, payment)],
  )
}

test refund_fails_when_client_underpaid() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(client, payment - 1)],
  )
}

test refund_fails_when_payment_goes_to_wrong_party() {
  // Correct signer and timing, but the funds are paid to the provider instead
  // of the client.
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(provider, payment)],
  )
}

// ----------------------------------------------------------------------------
// Cancel
// ----------------------------------------------------------------------------

test cancel_with_both_parties() {
  // Cancel does not constrain the output destination; the co-signing parties
  // decide where the unwound funds go.
  escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [],
  )
}

test cancel_fails_without_provider() {
  !escrow.validate(base_datum(), Cancel, interval.everything, [client], [])
}

test cancel_fails_without_client() {
  !escrow.validate(base_datum(), Cancel, interval.everything, [provider], [])
}

test cancel_fails_for_stranger_pair() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [stranger, provider],
    [],
  )
}

// ----------------------------------------------------------------------------
// v1 scope guards (reserved-for-v2 datum variants must be rejected)
// ----------------------------------------------------------------------------

test settle_fails_when_model_is_optimistic() {
  let d = DealDatum { ..base_datum(), model: OptimisticChallenge }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_phase_is_claimed() {
  let d = DealDatum {
    ..base_datum(),
    phase: Claimed { challenge_deadline: deadline },
  }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

// Distinctness guard: if two roles share a key the two-signature requirements
// would collapse, so the datum must be rejected outright.

test settle_fails_when_oracle_equals_provider() {
  // With oracle == provider, a single provider signature would otherwise
  // satisfy both `signed_by` checks and let the provider settle unilaterally.
  let d = DealDatum { ..base_datum(), oracle: provider }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [provider],
    [pay_to(provider, payment)],
  )
}

test cancel_fails_when_client_equals_provider() {
  // With client == provider, a single signature would otherwise make Cancel
  // unilateral.
  let d = DealDatum { ..base_datum(), provider: client }
  !escrow.validate(d, Cancel, interval.everything, [client], [])
}

test settle_fails_when_payment_is_zero() {
  // A `payment` of 0 would otherwise make `paid_at_least` trivially pass for
  // any output, so the scope guard rejects non-positive payments outright.
  let d = DealDatum { ..base_datum(), payment: 0 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, 0)],
  )
}
