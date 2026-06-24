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

fn base_datum() -> DealDatum {
  DealDatum {
    client,
    provider,
    oracle,
    data_hash: #"deadbeef",
    payment: 1_000_000,
    storage_gb: 10,
    duration_epochs: 6,
    start_time: 1_600_000_000_000,
    deadline,
    model: OracleAttested,
    challenge_window: 0,
    phase: Locked,
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
  )
}

test settle_fails_without_oracle() {
  !escrow.validate(base_datum(), Settle, interval.before(deadline), [provider])
}

test settle_fails_without_provider() {
  !escrow.validate(base_datum(), Settle, interval.before(deadline), [oracle])
}

test settle_fails_after_deadline() {
  // Range starts after the deadline => upper bound is +inf, so the
  // "must end before deadline" check fails.
  !escrow.validate(
    base_datum(),
    Settle,
    interval.after(deadline + 1),
    [oracle, provider],
  )
}

test settle_fails_with_unbounded_range() {
  !escrow.validate(
    base_datum(),
    Settle,
    interval.everything,
    [oracle, provider],
  )
}

// ----------------------------------------------------------------------------
// Refund
// ----------------------------------------------------------------------------

test refund_by_client_after_deadline() {
  escrow.validate(base_datum(), Refund, interval.after(deadline + 1), [client])
}

test refund_fails_at_exactly_deadline() {
  // Refund must be strictly after the deadline so it cannot overlap with the
  // on/before-deadline Settle path.
  !escrow.validate(base_datum(), Refund, interval.after(deadline), [client])
}

test refund_fails_before_deadline() {
  !escrow.validate(
    base_datum(),
    Refund,
    interval.before(deadline - 1),
    [client],
  )
}

test refund_fails_with_unbounded_range() {
  !escrow.validate(base_datum(), Refund, interval.everything, [client])
}

test refund_fails_for_non_client() {
  !escrow.validate(base_datum(), Refund, interval.after(deadline), [provider])
}

// ----------------------------------------------------------------------------
// Cancel
// ----------------------------------------------------------------------------

test cancel_with_both_parties() {
  escrow.validate(base_datum(), Cancel, interval.everything, [client, provider])
}

test cancel_fails_without_provider() {
  !escrow.validate(base_datum(), Cancel, interval.everything, [client])
}

test cancel_fails_without_client() {
  !escrow.validate(base_datum(), Cancel, interval.everything, [provider])
}

test cancel_fails_for_stranger_pair() {
  !escrow.validate(
    base_datum(),
    Cancel,
    interval.everything,
    [stranger, provider],
  )
}

// ----------------------------------------------------------------------------
// v1 scope guards (reserved-for-v2 datum variants must be rejected)
// ----------------------------------------------------------------------------

test settle_fails_when_model_is_optimistic() {
  let d = DealDatum { ..base_datum(), model: OptimisticChallenge }
  !escrow.validate(d, Settle, interval.before(deadline), [oracle, provider])
}

test settle_fails_when_phase_is_claimed() {
  let d = DealDatum {
    ..base_datum(),
    phase: Claimed { challenge_deadline: deadline },
  }
  !escrow.validate(d, Settle, interval.before(deadline), [oracle, provider])
}
