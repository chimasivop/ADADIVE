#!/bin/bash
# =============================================================================
# REFUND Transaction for ADADIVE Escrow Contract
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/.."
TESTNET_DIR="$CONTRACT_DIR/testnet"

# Configuration
SCRIPT_FILE="$TESTNET_DIR/escrow_spend.plutus"
DATUM_FILE="$TESTNET_DIR/tx/refund_datum.json"
REDEMER_FILE="$TESTNET_DIR/tx/refund_redeemer.json"

mkdir -p "$TESTNET_DIR/tx"

# Create datum file
cat > "$DATUM_FILE" << 'DATUM_EOF'
{
  "constructor": 0,
  "fields": [
    {
      "bytes": "aabbccdd"
    },
    {
      "bytes": "11223344"
    },
    {
      "bytes": "aabbccdd"
    },
    {
      "bytes": "deadbeef1234"
    },
    {
      "int": 1000000
    },
    {
      "int": 10
    },
    {
      "int": 6
    },
    {
      "int": 1782637327241
    },
    {
      "int": 1782720127241
    },
    {
      "constructor": 0,
      "fields": []
    },
    {
      "int": 0
    },
    {
      "constructor": 0,
      "fields": []
    }
  ]
}
DATUM_EOF

# Create redeemer file
cat > "$REDEMER_FILE" << 'REDEMER_EOF'
{"constructor": 1, "fields": []}
REDEMER_EOF

# Build transaction
TX_UTXO="${ESCROW_UTXO:-<tx_hash>#<utxo_index>}"
PROVIDER_ADDR="${PROVIDER_ADDR:-addr_test1...}"
CLIENT_ADDR="${CLIENT_ADDR:-addr_test1...}"
WALLET_ADDR="${WALLET_ADDR:-addr_test1...}"

OUT_ADDR="$CLIENT_ADDR"  
OUT_AMOUNT="<full_balance_minus_fees>"

cardano-cli transaction build \
    --tx-in "$TX_UTXO" \
    --tx-in-script-file "$SCRIPT_FILE" \
    --tx-in-datum-file "$DATUM_FILE" \
    --tx-in-redeemer-file "$REDEMER_FILE" \
    --tx-out "$OUT_ADDR+$OUT_AMOUNT" \
    --change-address "$WALLET_ADDR" \
    --testnet-magic 1 \
    --out-file "$TESTNET_DIR/tx/refund_tx.draft"

# Sign transaction
cardano-cli transaction sign \
    --tx-body-file "$TESTNET_DIR/tx/refund_tx.draft" \
    --signing-key-file <key1.skey> \
    --signing-key-file <key2.skey> \
    --testnet-magic 1 \
    --out-file "$TESTNET_DIR/tx/refund_tx.signed"

# Submit
cardano-cli transaction submit \
    --tx-file "$TESTNET_DIR/tx/refund_tx.signed" \
    --testnet-magic 1
