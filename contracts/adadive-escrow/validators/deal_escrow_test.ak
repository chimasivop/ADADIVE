//// Unit tests for the v1 deal escrow authorization logic
//// (`adadive/escrow.validate`).
////
//// Happy-path tests assert the validator returns `True`; adversarial tests
//// assert it returns `False`.
////
//// Security-critical test categories:
////   - Cancel theft prevention (H-01)
////   - Datum field bounds (H-02, H-03)
////   - Non-distinct keys on all paths (H-02)
////   - Data hash validation (M-03)
////   - Duration/storage bounds (L-01)

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
// Settle - Happy Path
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

test settle_with_extra_output() {
  escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment), pay_to(stranger, 500_000)],
  )
}

// ----------------------------------------------------------------------------
// Settle - Signature Failures
// ----------------------------------------------------------------------------

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

test settle_fails_for_stranger_pair() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [stranger, stranger],
    [pay_to(provider, payment)],
  )
}

// ----------------------------------------------------------------------------
// Settle - Timing Failures
// ----------------------------------------------------------------------------

test settle_fails_after_deadline() {
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

// ----------------------------------------------------------------------------
// Settle - Payment/Destination Failures
// ----------------------------------------------------------------------------

test settle_fails_when_provider_underpaid() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment - 1)],
  )
}

test settle_fails_when_payment_goes_to_wrong_party() {
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

test settle_fails_when_payment_goes_to_oracle() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(oracle, payment)],
  )
}

test settle_fails_when_payment_goes_to_stranger() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(stranger, payment)],
  )
}

// ----------------------------------------------------------------------------
// Refund - Happy Path
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

test refund_with_extra_payment() {
  escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(client, payment + 100_000)],
  )
}

// ----------------------------------------------------------------------------
// Refund - Timing Failures
// ----------------------------------------------------------------------------

test refund_fails_at_exactly_deadline() {
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

// ----------------------------------------------------------------------------
// Refund - Signature/Payment Failures
// ----------------------------------------------------------------------------

test refund_fails_for_non_client() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [provider],
    [pay_to(client, payment)],
  )
}

test refund_fails_for_oracle() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [oracle],
    [pay_to(client, payment)],
  )
}

test refund_fails_for_stranger() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [stranger],
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
  !escrow.validate(
    base_datum(),
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(provider, payment)],
  )
}

// ----------------------------------------------------------------------------
// Cancel - Happy Path (H-01: Now requires client payout)
// ----------------------------------------------------------------------------

test cancel_with_client_payout() {
  escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(client, payment)],
  )
}

test cancel_with_client_and_provider_payout() {
  escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(client, payment), pay_to(provider, 100_000)],
  )
}

// ----------------------------------------------------------------------------
// Cancel - Signature Failures
// ----------------------------------------------------------------------------

test cancel_fails_without_provider() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client],
    [pay_to(client, payment)],
  )
}

test cancel_fails_without_client() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [provider],
    [pay_to(client, payment)],
  )
}

test cancel_fails_for_stranger_pair() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [stranger, provider],
    [pay_to(client, payment)],
  )
}

test cancel_fails_for_oracle_and_provider() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [oracle, provider],
    [pay_to(client, payment)],
  )
}

test cancel_fails_for_client_and_oracle() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, oracle],
    [pay_to(client, payment)],
  )
}

// ----------------------------------------------------------------------------
// Cancel - H-01: Theft Prevention Tests
// ----------------------------------------------------------------------------

test cancel_fails_with_no_outputs() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [],
  )
}

test cancel_fails_when_funds_go_to_stranger() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(stranger, payment)],
  )
}

test cancel_fails_when_funds_go_to_provider_only() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(provider, payment)],
  )
}

test cancel_fails_when_client_underpaid() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(client, payment - 1)],
  )
}

test cancel_fails_when_client_paid_to_oracle() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(oracle, payment)],
  )
}

// ----------------------------------------------------------------------------
// v1 Scope Guards - Model/Phase
// ----------------------------------------------------------------------------

test settle_fails_when_model_is_optimistic() {
  let d =
    DealDatum {
      ..base_datum(),
      model: OptimisticChallenge,
    }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test refund_fails_when_model_is_optimistic() {
  let d =
    DealDatum {
      ..base_datum(),
      model: OptimisticChallenge,
    }
  !escrow.validate(
    d,
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(client, payment)],
  )
}

test cancel_fails_when_model_is_optimistic() {
  let d =
    DealDatum {
      ..base_datum(),
      model: OptimisticChallenge,
    }
  !escrow.validate(
    d,
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(client, payment)],
  )
}

test settle_fails_when_phase_is_claimed() {
  let d =
    DealDatum {
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

test refund_fails_when_phase_is_claimed() {
  let d =
    DealDatum {
      ..base_datum(),
      phase: Claimed { challenge_deadline: deadline },
    }
  !escrow.validate(
    d,
    Refund,
    interval.after(deadline + 1),
    [client],
    [pay_to(client, payment)],
  )
}

// ----------------------------------------------------------------------------
// v1 Scope Guards - Key Distinctness (All Paths)
// ----------------------------------------------------------------------------

test settle_fails_when_oracle_equals_provider() {
  let d = DealDatum { ..base_datum(), oracle: provider }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [provider],
    [pay_to(provider, payment)],
  )
}

test refund_fails_when_client_equals_oracle() {
  let d = DealDatum { ..base_datum(), client: oracle }
  !escrow.validate(
    d,
    Refund,
    interval.after(deadline + 1),
    [oracle],
    [pay_to(oracle, payment)],
  )
}

test cancel_fails_when_client_equals_provider() {
  let d = DealDatum { ..base_datum(), provider: client }
  !escrow.validate(
    d,
    Cancel,
    interval.everything,
    [client],
    [pay_to(client, payment)],
  )
}

test cancel_fails_when_client_equals_oracle() {
  let d = DealDatum { ..base_datum(), client: oracle }
  !escrow.validate(
    d,
    Cancel,
    interval.everything,
    [oracle, provider],
    [pay_to(oracle, payment)],
  )
}

test cancel_fails_when_oracle_equals_provider() {
  let d = DealDatum { ..base_datum(), oracle: provider }
  !escrow.validate(
    d,
    Cancel,
    interval.everything,
    [client, provider],
    [pay_to(client, payment)],
  )
}

// ----------------------------------------------------------------------------
// v1 Scope Guards - Payment Validation
// ----------------------------------------------------------------------------

test settle_fails_when_payment_is_zero() {
  let d = DealDatum { ..base_datum(), payment: 0 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, 0)],
  )
}

test settle_fails_when_payment_is_negative() {
  let d = DealDatum { ..base_datum(), payment: -1 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, 0)],
  )
}

// ----------------------------------------------------------------------------
// v1 Scope Guards - Storage/Duration Bounds (H-02, L-01)
// ----------------------------------------------------------------------------

test settle_fails_when_storage_gb_is_zero() {
  let d = DealDatum { ..base_datum(), storage_gb: 0 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_storage_gb_exceeds_max() {
  let d = DealDatum { ..base_datum(), storage_gb: 1_000_001 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_duration_epochs_is_zero() {
  let d = DealDatum { ..base_datum(), duration_epochs: 0 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_duration_epochs_exceeds_max() {
  let d = DealDatum { ..base_datum(), duration_epochs: 100_001 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

// ----------------------------------------------------------------------------
// v1 Scope Guards - Time Ordering (H-03)
// ----------------------------------------------------------------------------

test settle_fails_when_deadline_equals_start_time() {
  let d = DealDatum { ..base_datum(), deadline: base_datum().start_time }
  !escrow.validate(
    d,
    Settle,
    interval.before(d.deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_deadline_before_start_time() {
  let d = DealDatum { ..base_datum(), deadline: base_datum().start_time - 1 }
  !escrow.validate(
    d,
    Settle,
    interval.before(d.deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test refund_fails_when_deadline_before_start_time() {
  let d = DealDatum { ..base_datum(), deadline: base_datum().start_time - 1 }
  !escrow.validate(
    d,
    Refund,
    interval.after(d.deadline + 1),
    [client],
    [pay_to(client, payment)],
  )
}

test settle_fails_when_start_time_is_zero() {
  let d = DealDatum { ..base_datum(), start_time: 0 }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

test settle_fails_when_deadline_is_zero() {
  let d = DealDatum { ..base_datum(), deadline: 0 }
  !escrow.validate(
    d,
    Settle,
    interval.before(0),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}

// ----------------------------------------------------------------------------
// v1 Scope Guards - Data Hash (M-03)
// ----------------------------------------------------------------------------

test settle_fails_with_empty_data_hash() {
  let d = DealDatum { ..base_datum(), data_hash: #"" }
  !escrow.validate(
    d,
    Settle,
    interval.before(deadline),
    [oracle, provider],
    [pay_to(provider, payment)],
  )
}
