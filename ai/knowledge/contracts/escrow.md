# ADADIVE Deal Escrow Smart Contract

## Overview
The ADADIVE deal escrow contract is a Cardano Plutus V3 smart contract that manages payment for decentralized storage services. It ensures trustless, secure transactions between clients (file owners) and storage providers.

## Contract Design

### Core Principle
Payment is held in escrow until storage is verified. Neither party can unilaterally access the funds without meeting the contract conditions.

### Participants
| Role | Description |
|------|-------------|
| **Client** | File owner who pays for storage |
| **Provider** | Entity storing the file |
| **Oracle** | Trusted attestor for proof-of-storage |

## Datum Structure
Each escrow UTxO contains a `DealDatum`:

```
DealDatum {
  client: VerificationKeyHash      # Client's public key
  provider: VerificationKeyHash    # Provider's public key
  oracle: VerificationKeyHash      # Oracle's public key
  data_hash: ByteArray             # IPFS CID / content hash
  payment: Int                     # Escrow amount in lovelace
  storage_gb: Int                  # Size in gigabytes
  duration_epochs: Int             # Duration in epochs
  start_time: Int                  # Deal start (POSIX ms)
  deadline: Int                    # Settlement deadline (POSIX ms)
  model: SettlementModel           # v1: OracleAttested
  challenge_window: Int            # v1: 0
  phase: DealPhase                 # v1: Locked
}
```

## Redeemers (Actions)

### Settle
**Who can execute**: Oracle + Provider (co-signed)
**When**: On or before deadline
**Effect**: Provider receives payment

The oracle attests that the provider successfully maintained storage. This is the normal completion path.

```
Settle requires:
- Oracle signature
- Provider signature
- Transaction valid before deadline
- Output paying ≥payment lovelace to provider
```

### Refund
**Who can execute**: Client
**When**: Strictly after deadline
**Effect**: Client reclaims payment

If a deal expires without successful settlement (provider failed), the client can reclaim their funds.

```
Refund requires:
- Client signature
- Transaction valid after deadline
- Output paying ≥payment lovelace to client
```

### Cancel
**Who can execute**: Client + Provider (co-signed)
**When**: Any time (mutual agreement)
**Effect**: Deal cancelled, client refunded

Both parties can agree to cancel a deal early.

```
Cancel requires:
- Client signature
- Provider signature
- Output paying ≥payment lovelace to client
```

## Security Properties

### Fund Protection
1. **Provider cannot steal**: Requires oracle signature for any withdrawal
2. **Oracle cannot steal**: Cannot execute without provider signature
3. **Client protected**: Funds locked until deadline or mutual cancellation
4. **No redirect**: Payment must go to designated recipient

### Role Separation
The contract enforces that all three roles use **distinct keys**:
- `oracle != provider`
- `oracle != client`
- `provider != client`

This prevents single-party control.

### Positive Payment
`payment` must be positive (> 0). This prevents trivial validation bypasses.

## Transaction Validity

### Settle Time Bounds
```
must_end_before(deadline)
must_start_after(start_time)
```
Note: The contract compares against `Finite` bounds. Off-chain code must construct validity ranges accordingly.

### Refund Time Bounds
```
must_start_after(deadline)
```
The lower bound is inclusive by Cardano ledger rules.

## Integration Notes

### Off-Chain Requirements
When building transactions:

1. **Validate datum before locking**:
   - All keys must be distinct
   - `payment > 0`
   - `deadline > start_time`

2. **Settle transactions**:
   - Set `invalid-hereafter ≤ deadline`
   - Include provider output with correct amount

3. **Refund transactions**:
   - Set `invalid-hereafter > deadline`
   - Include client output with correct amount

### v1 Limitations
- Oracle is centralized (trust assumption)
- No automatic proof verification
- Manual oracle attestation required

### v2 Roadmap
Future versions planned:
- **Optimistic Challenge**: Provider posts bond, clients can challenge
- **Fraud Proofs**: On-chain verification of storage proofs
- **Automated Oracles**: Protocol-level proof verification

## Contract Address
The escrow script address is deterministic based on the compiled validator. Mainnet and testnet addresses differ.

For the current deployment address, refer to the [deployment documentation](TESTNET_DEPLOYMENT.md).

## Testing
The contract includes 60+ unit tests covering:
- Happy paths for all redeemers
- Missing signature cases
- Timing violations
- Output amount validation
- Role key distinctness
- Datum bounds validation

Run tests with: `aiken check`

## Security Audit
The contract has been audited. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the full report.
