# ADADIVE Escrow Contract - Preprod Testnet Deployment Guide

## Contract Information

**Script Hash:** `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b`

**Validators:**
- `deal_escrow.deal_escrow.spend` - Main validator
- `deal_escrow.deal_escrow.else` - Fallback validator

## Prerequisites

1. **Cardano CLI** installed (v8.x+)
2. **Funded Test Wallet** on Preprod
3. **Preprod Node** connection (socket or public endpoint)

## Step 1: Get Test ADA

Request test ADA from the Cardano Testnet Faucet:
https://docs.cardano.org/cardano-testnet/tools/faucet/

## Step 2: Build Escrow Address

```bash
# Using cardano-cli
cardano-cli address build \
    --payment-script-file escrow_spend.plutus \
    --testnet-magic 1

# Expected: addr_test1... (script address)
```

## Step 3: Create DealDatum UTxO

The escrow requires a UTxO with a `DealDatum` at the script address.

**DealDatum Structure:**
```json
{
  "client": "client_vkh",           // VerificationKeyHash
  "provider": "provider_vkh",       // VerificationKeyHash  
  "oracle": "oracle_vkh",           // VerificationKeyHash
  "data_hash": "deadbeef...",       // ByteArray
  "payment": 1000000,               // Lovelace amount
  "storage_gb": 10,                 // Storage size
  "duration_epochs": 6,              // Duration
  "start_time": 1600000000000,       // Unix timestamp ms
  "deadline": 1700000000000,         // Unix timestamp ms
  "model": "OracleAttested",         // Or "OptimisticChallenge"
  "challenge_window": 0,
  "phase": "Locked"                  // Or "Claimed"
}
```

## Step 4: Execute Redeemers

### Settle (Oracle + Provider signatures, before deadline)
```bash
cardano-cli transaction build \
    --tx-in <escrow_utxo>#<utxo_index> \
    --tx-in-script-file escrow_spend.plutus \
    --tx-in-datum-value <deal_datum_json> \
    --tx-in-redeemer-value "Settle" \
    --tx-out <provider_addr>+<amount> \
    --change-address <wallet_addr> \
    --testnet-magic 1 \
    --witness-override 3 \
    --out-file tx.draft
```

### Refund (Client signature, after deadline)
```bash
cardano-cli transaction build \
    --tx-in <escrow_utxo>#<utxo_index> \
    --tx-in-script-file escrow_spend.plutus \
    --tx-in-datum-value <deal_datum_json> \
    --tx-in-redeemer-value "Refund" \
    --tx-out <client_addr>+<amount> \
    --change-address <wallet_addr> \
    --testnet-magic 1 \
    --witness-override 2 \
    --out-file tx.draft
```

### Cancel (Client + Provider signatures, anytime)
```bash
cardano-cli transaction build \
    --tx-in <escrow_utxo>#<utxo_index> \
    --tx-in-script-file escrow_spend.plutus \
    --tx-in-datum-value <deal_datum_json> \
    --tx-in-redeemer-value "Cancel" \
    --tx-out <client_addr>+<amount> \
    --change-address <wallet_addr> \
    --testnet-magic 1 \
    --witness-override 3 \
    --out-file tx.draft
```

## Step 5: Sign and Submit

```bash
# Sign with required keys
cardano-cli transaction sign \
    --tx-body-file tx.draft \
    --signing-key-file <key1.skey> \
    --signing-key-file <key2.skey> \
    --testnet-magic 1 \
    --out-file tx.signed

# Submit
cardano-cli transaction submit \
    --tx-file tx.signed \
    --testnet-magic 1
```

## Security Fix Verified

The **H-01 Cancel theft fix** requires that Cancel transactions MUST pay at least `deal.payment` lovelace to the `deal.client` address. This prevents the previously possible attack where client+provider could collude to steal escrowed funds.

## Test Results

All 56 unit tests pass locally:
```
Summary 56 checks, 0 errors, 0 warnings
```

E2E testnet verification requires funded wallet and node access.
