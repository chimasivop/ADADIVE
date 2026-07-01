#!/bin/bash
# =============================================================================
# REFUND Transaction — Client reclaims funds after deadline has passed
# =============================================================================
# Usage:
#   ESCROW_UTXO="tx_hash#tx_ix" ./refund_tx.sh
#
# Prerequisites:
#   - DealDatum UTxO at escrow address with deadline < current time
#   - Funded client wallet
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_success(){ echo -e "${GREEN}[OK]${NC}   $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTNET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WALLET_DIR="${WALLET_DIR:-$HOME/cardano-wallet}"
PREPROD_MAGIC=1

mkdir -p "$TESTNET_DIR/tx"

ESCROW_ADDR=$(cat "$TESTNET_DIR/escrow.addr" 2>/dev/null || echo "addr_test1wqq2tp7w3wnvmxyey60ullmywn9rs5kk53ylg0ech54e74gq955v2")

# Refund redeemer (constructor 1)
SCRIPT_FILE="$TESTNET_DIR/escrow_spend.plutus"
REDEMER_FILE="$TESTNET_DIR/tx/refund_redeemer.json"

cat > "$REDEMER_FILE" << 'EOF'
{"constructor": 1, "fields": []}
EOF

CLIENT_ADDR=$(cat "$WALLET_DIR/client/client.addr" 2>/dev/null) || CLIENT_ADDR=""
CLIENT_SKEY="$WALLET_DIR/client/client.skey"

log_info "Escrow Address: $ESCROW_ADDR"
log_info "Client Address: ${CLIENT_ADDR:-NOT FOUND}"

if [ -z "$CLIENT_ADDR" ] || [ ! -f "$CLIENT_SKEY" ]; then
    log_error "Client wallet not found in $WALLET_DIR/client/"
    exit 1
fi

# Find the expired DealDatum UTxO at escrow address
if [ -z "${ESCROW_UTXO:-}" ]; then
    log_info "Querying escrow address for expired UTxOs..."
    UTXO_DATA=$(cardano-cli query utxo --address "$ESCROW_ADDR" --testnet-magic $PREPROD_MAGIC 2>&1)
    echo "$UTXO_DATA" | tail -n +4 | awk '{print $1, $2, $3}' | while read -r txhash txix ada; do
        if [ -n "$txhash" ] && [ "$txhash" != "TX" ]; then
            ESCROW_UTXO="${txhash}#${txix}"
            log_info "Found UTxO: $ESCROW_UTXO (${ada})"
            break
        fi
    done
fi

if [ -z "${ESCROW_UTXO:-}" ]; then
    log_error "No UTxO found at escrow address."
    log_error "Run lock_tx.sh first (with a past deadline)."
    exit 1
fi

log_info "Using UTxO: $ESCROW_UTXO"

# Find a funded wallet UTxO for change address
FUNDED_WALLET_UTXO=$(cardano-cli query utxo --address "$CLIENT_ADDR" --testnet-magic $PREPROD_MAGIC 2>&1 | tail -n +4 | awk '{print $1, $2, $3}' | head -1)
if [ -z "$FUNDED_WALLET_UTXO" ]; then
    log_error "No UTxO found at client address $CLIENT_ADDR"
    exit 1
fi
log_info "Wallet UTxO for fees: $FUNDED_WALLET_UTXO"

# Refund amount: full balance minus fees
# The datum specifies the payment amount
DEAL_AMOUNT=10000000
REFUND_AMOUNT=$((DEAL_AMOUNT + 2000000))  # payment + min UTxO

log_info "Building REFUND transaction..."
log_info "  Redeemer: Refund (constructor 1)"
log_info "  Output to client: $REFUND_AMOUNT lovelace ($((REFUND_AMOUNT/1000000)) ADA)"
log_info "  Required: deadline must be in the past"

cardano-cli transaction build \
    --tx-in "$ESCROW_UTXO" \
    --tx-in-script-file "$SCRIPT_FILE" \
    --tx-in-datum-file "$TESTNET_DIR/tx/lock_datum.json" \
    --tx-in-redeemer-file "$REDEMER_FILE" \
    --tx-in "$FUNDED_WALLET_UTXO" \
    --tx-out "$CLIENT_ADDR+$REFUND_AMOUNT" \
    --change-address "$CLIENT_ADDR" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/refund_tx.draft" \
    --witness-override 2

log_info "Signing (client key)..."
cardano-cli transaction sign \
    --tx-body-file "$TESTNET_DIR/tx/refund_tx.draft" \
    --signing-key-file "$CLIENT_SKEY" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/refund_tx.signed"

log_info "Submitting..."
cardano-cli transaction submit \
    --tx-file "$TESTNET_DIR/tx/refund_tx.signed" \
    --testnet-magic $PREPROD_MAGIC

log_success "REFUND TX SUBMITTED!"
log_info "Client reclaimed escrowed funds."
