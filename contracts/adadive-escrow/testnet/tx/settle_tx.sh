#!/bin/bash
# =============================================================================
# SETTLE Transaction — Happy path: Oracle + Provider co-sign to release funds
# =============================================================================
# Usage:
#   ESCROW_UTXO="tx_hash#tx_ix" ./settle_tx.sh
#   Or run without args and the script will query UTxOs automatically.
#
# Prerequisites:
#   - Reference script UTxO at escrow address
#   - DealDatum UTxO at escrow address
#   - Funded oracle + provider wallets
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

# Settle redeemer (constructor 0)
SCRIPT_FILE="$TESTNET_DIR/escrow_spend.plutus"
REDEMER_FILE="$TESTNET_DIR/tx/settle_redeemer.json"

cat > "$REDEMER_FILE" << 'EOF'
{"constructor": 0, "fields": []}
EOF

# Resolve wallet addresses
PROVIDER_ADDR=$(cat "$WALLET_DIR/provider/provider.addr" 2>/dev/null) || PROVIDER_ADDR=""
CLIENT_ADDR=$(cat "$WALLET_DIR/client/client.addr" 2>/dev/null) || CLIENT_ADDR=""
ORACLE_VKH=""
PROVIDER_VKH=""

if [ -f "$WALLET_DIR/oracle/oracle.vkey" ]; then
    ORACLE_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$WALLET_DIR/oracle/oracle.vkey" 2>/dev/null)
fi
if [ -f "$WALLET_DIR/provider/provider.vkey" ]; then
    PROVIDER_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$WALLET_DIR/provider/provider.vkey" 2>/dev/null)
fi

log_info "Escrow Address: $ESCROW_ADDR"
log_info "Provider Address: ${PROVIDER_ADDR:-NOT FOUND}"
log_info "Oracle VKH: ${ORACLE_VKH:-NOT FOUND}"

if [ -z "$PROVIDER_ADDR" ] || [ -z "$ORACLE_VKH" ]; then
    log_error "Missing wallet files in $WALLET_DIR/"
    log_info "Required: provider.skey, oracle.skey"
    exit 1
fi

# Find the DealDatum UTxO at escrow address
if [ -z "${ESCROW_UTXO:-}" ]; then
    log_info "ESCROW_UTXO not set — querying escrow address UTxOs..."
    log_info "Query: cardano-cli query utxo --address $ESCROW_ADDR --testnet-magic $PREPROD_MAGIC"
    
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
    log_error "Run lock_tx.sh first to create a deal UTxO."
    exit 1
fi

log_info "Using UTxO: $ESCROW_UTXO"

# Find a funded wallet UTxO for change address
WALLET_ADDR="${CLIENT_ADDR:-$PROVIDER_ADDR}"
log_info "Change address: $WALLET_ADDR"

FUNDED_WALLET_UTXO=$(cardano-cli query utxo --address "$WALLET_ADDR" --testnet-magic $PREPROD_MAGIC 2>&1 | tail -n +4 | awk '{print $1, $2, $3}' | head -1)
if [ -z "$FUNDED_WALLET_UTXO" ]; then
    log_error "No UTxO found at change address $WALLET_ADDR"
    exit 1
fi
log_info "Wallet UTxO for fees: $FUNDED_WALLET_UTXO"

# Settle amount: pay provider the deal amount + fees
DEAL_AMOUNT=10000000
SETTLE_AMOUNT=$((DEAL_AMOUNT + 500000))  # 10 ADA + 0.5 ADA for fees margin

log_info "Building SETTLE transaction..."
log_info "  Redeemer: Settle (constructor 0)"
log_info "  Output to provider: $SETTLE_AMOUNT lovelace ($((SETTLE_AMOUNT/1000000)) ADA)"

cardano-cli transaction build \
    --tx-in "$ESCROW_UTXO" \
    --tx-in-script-file "$SCRIPT_FILE" \
    --tx-in-datum-file "$TESTNET_DIR/tx/lock_datum.json" \
    --tx-in-redeemer-file "$REDEMER_FILE" \
    --required-signer-hash "$ORACLE_VKH" \
    --required-signer-hash "$PROVIDER_VKH" \
    --tx-in "$FUNDED_WALLET_UTXO" \
    --tx-out "$PROVIDER_ADDR+$SETTLE_AMOUNT" \
    --change-address "$WALLET_ADDR" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/settle_tx.draft" \
    --witness-override 3

log_info "Signing (oracle + provider keys)..."
cardano-cli transaction sign \
    --tx-body-file "$TESTNET_DIR/tx/settle_tx.draft" \
    --signing-key-file "$WALLET_DIR/oracle/oracle.skey" \
    --signing-key-file "$WALLET_DIR/provider/provider.skey" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/settle_tx.signed"

log_info "Submitting..."
cardano-cli transaction submit \
    --tx-file "$TESTNET_DIR/tx/settle_tx.signed" \
    --testnet-magic $PREPROD_MAGIC

log_success "SETTLE TX SUBMITTED!"
log_info "Provider received payment. Deal settled."
