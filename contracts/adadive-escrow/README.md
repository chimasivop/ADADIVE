# ADADIVE Deal Escrow — Cardano smart contracts

On-chain validators for ADADIVE storage deals, written in [Aiken](https://aiken-lang.org/)
(Plutus V3). This package contains the **v1 deal escrow** validator plus its
unit tests and compiled blueprint.

> **Status:** preprod / testnet only. Not yet integrated with the app and not
> audited. Do **not** point this at mainnet or real funds before an independent
> review.

## What it does

A client locks payment into the escrow script when creating a storage deal.
The funds can only leave the script in three ways:

| Redeemer | Who authorizes | When | Effect |
| --- | --- | --- | --- |
| `Settle` | `oracle` **and** `provider` co-sign | on/before `deadline` | provider is paid |
| `Refund` | `client` | strictly after `deadline` | client reclaims escrow |
| `Cancel` | `client` **and** `provider` co-sign | any time | deal is unwound |

The **oracle/arbiter** is a trusted key that co-signs `Settle` to attest that
the provider produced valid proof-of-storage *off-chain*. This is the v1 trust
assumption (see "Why an oracle" below).

### Security properties (v1)

- The provider **cannot** take funds without the oracle's approval.
- The oracle **cannot** take funds without the provider, and is never a fund
  recipient — so a rogue/compromised oracle can only *withhold* settlement
  (grief), it cannot *steal*.
- The client **cannot** reclaim before `deadline`, except via a mutual `Cancel`.
- `Settle` is time-bounded to on/before `deadline`; after that the only path is
  `Refund`, keeping the two flows from overlapping ambiguously.
- The destination of the escrowed funds is enforced on-chain, not just the
  signatures: `Settle` requires an output paying at least `payment` lovelace to
  the `provider`, and `Refund` requires an output paying at least `payment`
  lovelace to the `client`. A correctly-signed transaction therefore cannot
  redirect the escrow to an arbitrary address. `Cancel` is the exception — the
  two co-signing parties (`client` + `provider`) jointly decide where the
  unwound funds go, so its destination is intentionally unconstrained.
- The three roles (`client`, `provider`, `oracle`) must be **distinct keys**.
  The validator rejects any datum where two roles share a key, since that would
  collapse a two-signature requirement to one (e.g. `oracle == provider` would
  let the provider settle alone; `client == provider` would make `Cancel`
  unilateral).

> **Note:** `payment` is interpreted as **lovelace**. The output check uses
> `assets.lovelace_of(output.value) >= payment`, so v1 escrows must hold ADA.
> The `>=` comparison lets the recipient's output also carry change / min-ADA
> without failing the check.

### Off-chain integration note: validity-range bounds

The time checks (`must_end_before` / `must_start_after` in `lib/adadive/escrow.ak`)
compare against the `Finite` bound value and **do not inspect the `is_inclusive`
flag**. The Cardano ledger natively represents the upper validity bound
(`invalid-hereafter`) as **exclusive**, so off-chain transaction builders must
construct ranges to match what the validator expects:

- **`Settle`** requires `upper_bound = Finite(t)` with `t <= deadline`. If the
  off-chain builder uses the standard exclusive upper bound (e.g.
  `invalid-hereafter = deadline + 1` to mean "valid through `deadline`"), the
  resulting `Finite(deadline + 1) <= deadline` check is `False` and a legitimate
  `Settle` will be **rejected**. Build the upper bound so its `Finite` value is
  `<= deadline` (i.e. set `invalid-hereafter <= deadline`).
- **`Refund`** requires `lower_bound = Finite(t)` with `t > deadline` (the
  ledger's lower bound is inclusive, so this is unaffected by the flag).

These are conservative checks — they can only cause valid transactions to be
rejected, never invalid ones to be accepted — but the off-chain code must
construct ranges accordingly.

### Why an oracle (and not pure on-chain proof)?

A Cardano validator cannot natively observe "is this file still pinned on IPFS
right now". Every real storage network resolves this with an **off-chain prover
plus an attestation** that the contract trusts. v1 uses the simplest such
mechanism — a trusted arbiter signature — which is the right trade-off while the
contract is unaudited and THT has real market value.

## Layout

```
contracts/adadive-escrow/
├── aiken.toml
├── plutus.json                      # compiled CIP-57 blueprint (committed)
├── lib/adadive/
│   ├── types.ak                     # DealDatum, DealRedeemer, enums
│   └── escrow.ak                    # pure validate() authorization logic
└── validators/
    ├── deal_escrow.ak               # on-chain spend entrypoint
    └── deal_escrow_test.ak          # 22 unit tests (happy + adversarial)
```

The authorization logic lives in `adadive/escrow.validate` (a pure function) so
it can be unit tested directly; `validators/deal_escrow.ak` is a thin on-chain
wrapper.

## Datum / redeemer

```aiken
type SettlementModel { OracleAttested, OptimisticChallenge }  // v2 reserved
type DealPhase { Locked, Claimed { challenge_deadline: Int } } // v2 reserved

type DealDatum {
  client: VerificationKeyHash,
  provider: VerificationKeyHash,
  oracle: VerificationKeyHash,
  data_hash: ByteArray,        // IPFS CID / data hash
  payment: Int,                // lovelace (enforced as payout amount)
  storage_gb: Int,
  duration_epochs: Int,
  start_time: Int,             // POSIX ms
  deadline: Int,               // POSIX ms — settle-by / refund-after
  model: SettlementModel,      // v1 requires OracleAttested
  challenge_window: Int,       // v1: 0
  phase: DealPhase,            // v1 requires Locked
}

type DealRedeemer { Settle, Refund, Cancel }  // append-only
```

## Forward compatibility with v2 (optimistic + fraud-proof challenge)

v1 was deliberately shaped so the planned v2 model can be added **without a
datum redesign or off-chain re-encoding**:

- **`model` tag** — every deal records its settlement model. The v1 validator
  rejects any datum whose `model != OracleAttested`, so a v1 script can never be
  tricked into running v2 semantics. v2 deals will carry `OptimisticChallenge`
  and live at a *different script hash* (validators are immutable; a new ruleset
  is always a new deployment).
- **`phase` field** — v1 only ever sees `Locked`. v2's flow (provider posts a
  claim → challenge window → finalize) reuses `Claimed { challenge_deadline }`,
  already present in the type, so existing deal records don't change shape.
- **`challenge_window`** — already in the datum (0 for v1); v2 reads it instead
  of adding a field.
- **Append-only redeemer** — v2 adds `ProviderClaim` / `Challenge` / `Finalize`
  constructors *after* the existing three, so off-chain encoders for v1 actions
  keep producing valid data.

In short: the database, API, and off-chain encoders can be written against this
final datum shape today, and migrating to v2 is "deploy a new validator + handle
the new redeemers", not "reshape every deal".

## Develop

Requires the Aiken toolchain (`aikup install v1.1.22`).

```sh
aiken fmt --check   # formatting
aiken check         # type-check + run unit tests
aiken build         # regenerate plutus.json blueprint
```

`aiken check` runs all 22 unit tests in `validators/deal_escrow_test.ak`,
covering each happy path and the adversarial cases (missing signatures, wrong
signer, wrong timing, wrong/underpaid payout destination, non-distinct role
keys, and the v1 scope guards).

## Off-chain integration requirements

When the off-chain code (deferred — see "Not done yet") builds the lock
transaction, it **must** validate the datum before sending funds to the script:

- **Distinct role keys.** `client`, `provider`, and `oracle` must be three
  distinct keys (enforced on-chain via `keys_distinct` in `contracts/adadive-escrow/lib/adadive/escrow.ak`).
  A datum reusing a key across roles fails the v1 scope guard for *every*
  redeemer, so the resulting UTxO is **permanently unspendable** — the funds are
  bricked. Reject such a deal off-chain before locking.
- **Positive `payment` in lovelace.** `payment` is the on-chain payout amount in
  lovelace; the off-chain builder must lock at least that much ADA and should
  reject non-positive values.
- **Validity-range bounds.** Construct `Settle` / `Refund` validity ranges per
  the "Off-chain integration note: validity-range bounds" section above.

## Not done yet

- Off-chain integration with `artifacts/cardano-storage` / `api-server`.
- Preprod end-to-end run (lock → settle / refund / cancel) on a funded testnet
  wallet.
- Independent security review.
- The v2 optimistic-challenge validator.
