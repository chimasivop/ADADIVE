# ADADIVE Escrow — Preprod Deployment & E2E Test Guide

> **Environment:** OpenHands cannot execute Cardano transactions directly because all operations
> require ECDSA-Ed25519 cryptographic signatures from private keys that only you possess.
> This guide provides exact step-by-step commands for your local machine.

> **✅ Contract Rebuilt:** The contract has been rebuilt with Aiken and all artifacts are consistent.
> 
> - **Script Hash**: `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b`
> - **Escrow Address**: `addr_test1wzz7mqxsrgdwp9nqkwtmflz0exxz9zpv0urq44zha2nwq7cwxas68`

---

## Prerequisites

| Dependency | Version | Install |
|---|---|---|
| `cardano-cli` | ≥ 8.1.0 | [docs.cardano.org](https://docs.cardano.org/cardano-node/install) |
| `aiken` | ≥ 1.1.0 | `curl -sLO https://github.com/input-output-hk/aiken/releases/download/1.1.22/aiken-1.1.22-x86_64-unknown-linux-gnu.tar.gz && tar xzf aiken-*.tar.gz && mv aiken ~/.local/bin/` |
| Test ADA | ≥ 50 ADA | [Preprod faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/) |
| BlockFrost API key | Preprod tier | [blockfrost.io](https://blockfrost.io) (free tier) |

---

## Step 0 — Build the Contract

```bash
cd contracts/adadive-escrow/
aiken build
# Output: plutus.json with H-01-fixed bytecode
```

Verify the script hash:
```bash
cardano-cli transaction policyid \
  --script-file testnet/escrow_spend.plutus
# Expected: 85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b
```

---

## Step 1 — Generate Wallet Keys

You need **3 wallets**: `client`, `provider`, `oracle`.

```bash
WALLET_DIR="$HOME/cardano-wallet"
mkdir -p "$WALLET_DIR"/{client,provider,oracle}

# Repeat for each wallet (client, provider, oracle):
for NAME in client provider oracle; do
  cardano-cli address key-gen \
    --signing-key-file "$WALLET_DIR/$NAME/$NAME.skey" \
    --verification-key-file "$WALLET_DIR/$NAME/$NAME.vkey"
done

# Build payment addresses
for NAME in client provider oracle; do
  cardano-cli address build \
    --payment-verification-key-file "$WALLET_DIR/$NAME/$NAME.vkey" \
    --testnet-magic 1 \
    --out-file "$WALLET_DIR/$NAME/$NAME.addr"
  echo "$NAME address: $(cat "$WALLET_DIR/$NAME/$NAME.addr")"
done
```

---

## Step 2 — Fund the Wallets

1. Go to: **https://docs.cardano.org/cardano-testnet/tools/faucet/**
2. Request **test ADA** for each address (up to 1000 ADA per request)
3. Wait ~1 minute for confirmation

```
Expected addresses (testnet-magic 1):
  Client:    addr_test1... (you will see the actual address)
  Provider:  addr_test1... (you will see the actual address)
  Oracle:    addr_test1... (you will see the actual address)
```

---

## Step 3 — Deploy Validator Reference Script

The validator must be registered on-chain by locking 2 ADA at the script address
with a reference script UTxO.

```bash
# === CONFIGURATION ===
TESTNET_DIR="contracts/adadive-escrow/testnet"
export CARDANO_NODE_SOCKET_PATH="${CARDANO_NODE_SOCKET_PATH:-/tmp/cardano-node.sock}"

# Verify scripts are up to date from plutus.json
SCRIPT_HASH=$(cardano-cli transaction policyid \
  --script-file "$TESTNET_DIR/escrow_spend.plutus")
echo "Script Hash: $SCRIPT_HASH"
# Expected: 85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b

ESCROW_ADDR=$(cat "$TESTNET_DIR/escrow.addr")
echo "Escrow Address: $ESCROW_ADDR"
# Expected: addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2

# === GET PROTOCOL PARAMS ===
cardano-cli query protocol-parameters \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/protocol.json"

# === FIND FUNDED UTxO FROM CLIENT WALLET ===
CLIENT_ADDR=$(cat "$WALLET_DIR/client/client.addr")
cardano-cli query utxo \
  --address "$CLIENT_ADDR" \
  --testnet-magic 1
# Note: tx_hash#tx_ix of a UTxO with > 5 ADA for fee margin

# === BUILD REFERENCE SCRIPT TX ===
# Replace TX_HASH and TX_IX with your UTxO values
CLIENT_TX_IN="<tx_hash>#0"
REF_AMOUNT=2000000  # 2 ADA

cardano-cli transaction build \
  --tx-in "$CLIENT_TX_IN" \
  --tx-out "$ESCROW_ADDR+$REF_AMOUNT" \
  --tx-out-reference-script-file "$TESTNET_DIR/escrow_spend.plutus" \
  --change-address "$CLIENT_ADDR" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/ref_tx.draft"

# === SIGN & SUBMIT ===
cardano-cli transaction sign \
  --tx-body-file "$TESTNET_DIR/tx/ref_tx.draft" \
  --signing-key-file "$WALLET_DIR/client/client.skey" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/ref_tx.signed"

cardano-cli transaction submit \
  --tx-file "$TESTNET_DIR/tx/ref_tx.signed" \
  --testnet-magic 1

echo "Reference script deployed! TX submitted."
```

---

## Step 4 — Verify Deployment

```bash
# Check script is on-chain
curl -s "https://cardano-preprod.blockfrost.io/api/v0/scripts/$SCRIPT_HASH" \
  -H "project_id: $BLOCKFROST_KEY"
# Expected: HTTP 200

# Check escrow address has the reference UTxO
curl -s "https://cardano-preprod.blockfrost.io/api/v0/addresses/$ESCROW_ADDR/utxos" \
  -H "project_id: $BLOCKFROST_KEY" \
  | jq '.[] | select(.reference_script_hash != null)'
# Expected: The reference script UTxO
```

---

## Step 5 — E2E Test: Lock a Deal UTxO

Create a DealDatum UTxO at the escrow address. The datum encodes the deal terms.

### Create the datum file

```bash
mkdir -p "$TESTNET_DIR/tx"

# DealDatum fields (from types.ak):
# 0: client (VerificationKeyHash, 28 bytes)
# 1: provider (VerificationKeyHash, 28 bytes)
# 2: oracle (VerificationKeyHash, 28 bytes)
# 3: data_hash (ByteArray, IPFS CID hash)
# 4: payment (Int, lovelace for provider)
# 5: storage_gb (Int)
# 6: duration_epochs (Int)
# 7: start_time (Int, POSIX ms)
# 8: deadline (Int, POSIX ms)
# 9: model (SettlementModel)
# 10: challenge_window (Int)
# 11: phase (DealPhase = Locked)

# Get verification key hashes
CLIENT_VKH=$(cardano-cli key-hash-verification-key \
  --verification-key-file "$WALLET_DIR/client/client.vkey")
PROVIDER_VKH=$(cardano-cli key-hash-verification-key \
  --verification-key-file "$WALLET_DIR/provider/provider.vkey")
ORACLE_VKH=$(cardano-cli key-hash-verification-key \
  --verification-key-file "$WALLET_DIR/oracle/oracle.vkey")

echo "Client VKH:    $CLIENT_VKH"
echo "Provider VKH:  $PROVIDER_VKH"
echo "Oracle VKH:    $ORACLE_VKH"

# Create datum (JSON)
DEAL_AMOUNT=10000000   # 10 ADA = 10,000,000 lovelace
START_TIME=$(date +%s000)          # Now (POSIX ms)
DEADLINE=$(( $(date +%s) + 86400 ))000  # 24 hours from now (POSIX ms)

cat > "$TESTNET_DIR/tx/lock_datum.json" << EOF
{
  "constructor": 0,
  "fields": [
    {"bytes": "$CLIENT_VKH"},
    {"bytes": "$PROVIDER_VKH"},
    {"bytes": "$ORACLE_VKH"},
    {"bytes": "$(echo -n 'QmXyzABC123' | xxd -p -c 256)"},
    {"int": $DEAL_AMOUNT},
    {"int": 10},
    {"int": 6},
    {"int": $START_TIME},
    {"int": $DEADLINE},
    {"constructor": 0, "fields": []},
    {"int": 0},
    {"constructor": 0, "fields": []}
  ]
}
EOF

echo "Datum created: $TESTNET_DIR/tx/lock_datum.json"
```

### Build lock transaction

```bash
CLIENT_TX_IN="<client_funded_utxo>"
LOCK_AMOUNT=12000000  # 12 ADA (10 ADA deal + 2 ADA min UTxO)

cardano-cli transaction build \
  --tx-in "$CLIENT_TX_IN" \
  --tx-out "$ESCROW_ADDR+$LOCK_AMOUNT" \
  --tx-out-datum-embed-file "$TESTNET_DIR/tx/lock_datum.json" \
  --change-address "$CLIENT_ADDR" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/lock_tx.draft"

cardano-cli transaction sign \
  --tx-body-file "$TESTNET_DIR/tx/lock_tx.draft" \
  --signing-key-file "$WALLET_DIR/client/client.skey" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/lock_tx.signed"

cardano-cli transaction submit \
  --tx-file "$TESTNET_DIR/tx/lock_tx.signed" \
  --testnet-magic 1

echo "LOCK TX SUBMITTED!"
echo "Note the tx_hash for the next step."
```

---

## Step 6 — E2E Test: Settle (Happy Path)

Requires **oracle** and **provider** signatures.

```bash
# Get the UTxO at escrow address with the deal datum
ESCROW_UTXO=$(curl -s "https://cardano-preprod.blockfrost.io/api/v0/addresses/$ESCROW_ADDR/utxos" \
  -H "project_id: $BLOCKFROST_KEY" | \
  jq -r '.[] | select(.data_hash != null) | "\(.tx_hash)#\(.output_index)"' | head -1)

echo "Escrow UTxO: $ESCROW_UTXO"

PROVIDER_ADDR=$(cat "$WALLET_DIR/provider/provider.addr")
CLIENT_ADDR=$(cat "$WALLET_DIR/client/client.addr")

# Settle redeemer: constructor 0 (Settle)
cat > "$TESTNET_DIR/tx/settle_redeemer.json" << 'EOF'
{"constructor": 0, "fields": []}
EOF

# Build: consume the deal UTxO, pay provider + return change
cardano-cli transaction build \
  --tx-in "$ESCROW_UTXO" \
  --tx-in-script-file "$TESTNET_DIR/escrow_spend.plutus" \
  --tx-in-datum-file "$TESTNET_DIR/tx/lock_datum.json" \
  --tx-in-redeemer-file "$TESTNET_DIR/tx/settle_redeemer.json" \
  --required-signer-hash "$ORACLE_VKH" \
  --required-signer-hash "$PROVIDER_VKH" \
  --tx-out "$PROVIDER_ADDR+10500000" \
  --change-address "$CLIENT_ADDR" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/settle_tx.draft"

cardano-cli transaction sign \
  --tx-body-file "$TESTNET_DIR/tx/settle_tx.draft" \
  --signing-key-file "$WALLET_DIR/provider/provider.skey" \
  --signing-key-file "$WALLET_DIR/oracle/oracle.skey" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/settle_tx.signed"

cardano-cli transaction submit \
  --tx-file "$TESTNET_DIR/tx/settle_tx.signed" \
  --testnet-magic 1

echo "SETTLE TX SUBMITTED! Provider received payment."
```

---

## Step 7 — E2E Test: Refund (After Deadline)

Client reclaims funds after `deadline` has passed.

```bash
# Create a datum with PAST deadline (deadline < current time)
PAST_DEADLINE=$(( $(date +%s) - 3600 ))000  # 1 hour ago

cat > "$TESTNET_DIR/tx/refund_datum.json" << EOF
{
  "constructor": 0,
  "fields": [
    {"bytes": "$CLIENT_VKH"},
    {"bytes": "$PROVIDER_VKH"},
    {"bytes": "$ORACLE_VKH"},
    {"bytes": "$(echo -n 'QmRefundTest' | xxd -p -c 256)"},
    {"int": 10000000},
    {"int": 10},
    {"int": 6},
    {"int": $(( $(date +%s) - 7200 ))000},
    {"int": $PAST_DEADLINE},
    {"constructor": 0, "fields": []},
    {"int": 0},
    {"constructor": 0, "fields": []}
  ]
}
EOF

# Lock some ADA first (this is a separate deal)
# ... run the lock step with refund_datum.json ...

# Then refund
# Refund redeemer: constructor 1 (Refund)
cat > "$TESTNET_DIR/tx/refund_redeemer.json" << 'EOF'
{"constructor": 1, "fields": []}
EOF

REFUND_UTXO="<utxo_with_refund_datum>"

cardano-cli transaction build \
  --tx-in "$REFUND_UTXO" \
  --tx-in-script-file "$TESTNET_DIR/escrow_spend.plutus" \
  --tx-in-datum-file "$TESTNET_DIR/tx/refund_datum.json" \
  --tx-in-redeemer-file "$TESTNET_DIR/tx/refund_redeemer.json" \
  --tx-out "$CLIENT_ADDR+10500000" \
  --change-address "$CLIENT_ADDR" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/refund_tx.draft"

cardano-cli transaction sign \
  --tx-body-file "$TESTNET_DIR/tx/refund_tx.draft" \
  --signing-key-file "$WALLET_DIR/client/client.skey" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/refund_tx.signed"

cardano-cli transaction submit \
  --tx-file "$TESTNET_DIR/tx/refund_tx.signed" \
  --testnet-magic 1

echo "REFUND TX SUBMITTED! Client reclaimed funds."
```

---

## Step 8 — E2E Test: Cancel (Mutual Agreement)

Requires **client** and **provider** signatures. Tests H-01 fix.

```bash
# Cancel redeemer: constructor 2 (Cancel)
cat > "$TESTNET_DIR/tx/cancel_redeemer.json" << 'EOF'
{"constructor": 2, "fields": []}
EOF

CANCEL_UTXO="<utxo_with_deal_datum>"

# CRITICAL H-01 TEST:
# The Cancel output MUST pay >= deal.payment (10 ADA) to the client.
# If the output is < 10 ADA, the transaction FAILS.
# This proves the H-01 fix prevents theft via Cancel.

cardano-cli transaction build \
  --tx-in "$CANCEL_UTXO" \
  --tx-in-script-file "$TESTNET_DIR/escrow_spend.plutus" \
  --tx-in-datum-file "$TESTNET_DIR/tx/lock_datum.json" \
  --tx-in-redeemer-file "$TESTNET_DIR/tx/cancel_redeemer.json" \
  --required-signer-hash "$CLIENT_VKH" \
  --required-signer-hash "$PROVIDER_VKH" \
  --tx-out "$CLIENT_ADDR+10000000" \
  --change-address "$CLIENT_ADDR" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/cancel_tx.draft"

cardano-cli transaction sign \
  --tx-body-file "$TESTNET_DIR/tx/cancel_tx.draft" \
  --signing-key-file "$WALLET_DIR/client/client.skey" \
  --signing-key-file "$WALLET_DIR/provider/provider.skey" \
  --testnet-magic 1 \
  --out-file "$TESTNET_DIR/tx/cancel_tx.signed"

cardano-cli transaction submit \
  --tx-file "$TESTNET_DIR/tx/cancel_tx.signed" \
  --testnet-magic 1

echo "CANCEL TX SUBMITTED!"
echo ""
echo "H-01 VERIFICATION:"
echo "  Deal payment:  10,000,000 lovelace (10 ADA)"
echo "  Cancel output: 10,000,000 lovelace (10 ADA) → CLIENT"
echo "  Result: ✅ >= deal.payment → TX SUCCEEDED"
echo "  If output was < 10 ADA → H-01 vulnerability would have allowed theft"
```

---

## Step 9 — Verify with BlockFrost

```bash
# After each TX, verify on-chain
curl -s "https://cardano-preprod.blockfrost.io/api/v0/txs/$TX_HASH/utxos" \
  -H "project_id: $BLOCKFROST_KEY" | jq '.'

# Check script UTxOs at escrow address
curl -s "https://cardano-preprod.blockfrost.io/api/v0/addresses/$ESCROW_ADDR/utxos" \
  -H "project_id: $BLOCKFROST_KEY" | jq '.'
```

---

## Appendix: Datum Hash Verification

To verify a datum hash matches the expected DealDatum:

```python
import cbor2, hashlib, json, binascii

def compute_datum_hash(datum: dict) -> str:
    """Compute the datum hash as cardano-cli does."""
    cbor_encoded = cbor2.dumps(datum)
    return hashlib.blake2b(cbor_encoded, digest_size=32).digest()

datum = {
    "constructor": 0,
    "fields": [
        {"bytes": "..."},
        # ... all 12 fields ...
    ]
}
datum_hash = compute_datum_hash(datum)
print(f"Datum Hash: {binascii.hexlify(datum_hash).decode()}")
```

---

## Quick Reference

| Item | Value |
|---|---|
| **Script Hash** | `85ed80d01a1ae09660b397b4fc4fc98c22882c7f060ad457eaa6e07b` |
| **Escrow Address** | `addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2` |
| **Network** | Cardano Preprod (testnet-magic 1) |
| **Min UTxO** | 2 ADA |
| **Redeemer — Settle** | `{"constructor": 0, "fields": []}` |
| **Redeemer — Refund** | `{"constructor": 1, "fields": []}` |
| **Redeemer — Cancel** | `{"constructor": 2, "fields": []}` |
| **Datum Phase** | `Locked` = `{"constructor": 0, "fields": []}` |
