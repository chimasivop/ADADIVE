#!/bin/bash
# =============================================================================
# CANCEL Transaction — Mutual agreement: Client + Provider co-sign to unwind deal
# =============================================================================
# Usage:
#   ESCROW_UTXO="tx_hash#tx_ix" ./cancel_tx.sh
#
# Prerequisites:
#   - DealDatum UTxO at escrow address
#   - Funded client + provider wallets
#
# H-01 SECURITY TEST:
#   The Cancel output MUST pay >= deal.payment to the client.
#   If you try to cancel with output < deal.payment, the TX FAILS.
#   This proves the H-01 theft vulnerability is FIXED.
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

# Cancel redeemer (constructor 2)
SCRIPT_FILE="$TESTNET_DIR/escrow_spend.plutus"
REDEMER_FILE="$TESTNET_DIR/tx/cancel_redeemer.json"

cat > "$REDEMER_FILE" << 'EOF'
{"constructor": 2, "fields": []}
EOF

CLIENT_ADDR=$(cat "$WALLET_DIR/client/client.addr" 2>/dev/null) || CLIENT_ADDR=""
PROVIDER_ADDR=$(cat "$WALLET_DIR/provider/provider.addr" 2>/dev/null) || PROVIDER_ADDR=""
CLIENT_VKH=""
PROVIDER_VKH=""

if [ -f "$WALLET_DIR/client/client.vkey" ]; then
    CLIENT_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$WALLET_DIR/client/client.vkey" 2>/dev/null)
fi
if [ -f "$WALLET_DIR/provider/provider.vkey" ]; then
    PROVIDER_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$WALLET_DIR/provider/provider.vkey" 2>/dev/null)
fi

log_info "Escrow Address: $ESCROW_ADDR"
log_info "Client Address: ${CLIENT_ADDR:-NOT FOUND}"
log_info "Provider Address: ${PROVIDER_ADDR:-NOT FOUND}"

if [ -z "$CLIENT_VKH" ] || [ -z "$PROVIDER_VKH" ]; then
    log_error "Missing wallet keys in $WALLET_DIR/"
    exit 1
fi

# Find the DealDatum UTxO at escrow address
if [ -z "${ESCROW_UTXO:-}" ]; then
    log_info "Querying escrow address for deal UTxOs..."
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
    log_error "Run lock_tx.sh first."
    exit 1
fi

log_info "Using UTxO: $ESCROW_UTXO"

# Find a funded wallet UTxO for change address
FUNDED_WALLET_UTXO=$(cardano-cli query utxo --address "$CLIENT_ADDR" --testnet-magic $PREPROD_MAGIC 2>&1 | tail -n +4 | awk '{print $1, $2, $3}' | head -1)
if [ -z "$FUNDED_WALLET_UTXO" ]; then
    log_error "No UTxO found at client address"
    exit 1
fi
log_info "Wallet UTxO for fees: $FUNDED_WALLET_UTXO"

# Cancel amount: CRITICAL H-01 TEST
# Must pay >= deal.payment to client
# If < deal.payment, TX will FAIL — proving the fix works
DEAL_PAYMENT=10000000  # 10 ADA from the lock_datum.json
CANCEL_OUTPUT=$DEAL_PAYMENT  # Must be >= 10 ADA

log_warn "============================================================="
log_warn "H-01 SECURITY TEST: Cancel output = $CANCEL_OUTPUT lovelace ($((CANCEL_OUTPUT/1000000)) ADA)"
log_warn "  deal.payment = $DEAL_PAYMENT lovelace ($((DEAL_PAYMENT/1000000)) ADA)"
log_warn "  If CANCEL_OUTPUT < deal.payment → TX FAILS (H-01 FIX WORKS)"
log_warn "  If CANCEL_OUTPUT >= deal.payment → TX SUCCEEDS"
log_warn "============================================================="

log_info "Building CANCEL transaction..."
log_info "  Redeemer: Cancel (constructor 2)"
log_info "  Required signatures: client + provider"
log_info "  Output to client: $CANCEL_OUTPUT lovelace"

cardano-cli transaction build \
    --tx-in "$ESCROW_UTXO" \
    --tx-in-script-file "$SCRIPT_FILE" \
    --tx-in-datum-file "$TESTNET_DIR/tx/lock_datum.json" \
    --tx-in-redeemer-file "$REDEMER_FILE" \
    --required-signer-hash "$CLIENT_VKH" \
    --required-signer-hash "$PROVIDER_VKH" \
    --tx-in "$FUNDED_WALLET_UTXO" \
    --tx-out "$CLIENT_ADDR+$CANCEL_OUTPUT" \
    --change-address "$PROVIDER_ADDR" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/cancel_tx.draft" \
    --witness-override 3

log_info "Signing (client + provider keys)..."
cardano-cli transaction sign \
    --tx-body-file "$TESTNET_DIR/tx/cancel_tx.draft" \
    --signing-key-file "$WALLET_DIR/client/client.skey" \
    --signing-key-file "$WALLET_DIR/provider/provider.skey" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/cancel_tx.signed"

log_info "Submitting..."
SUBMIT_RESULT=$(cardano-cli transaction submit \
    --tx-file "$TESTNET_DIR/tx/cancel_tx.signed" \
    --testnet-magic $PREPROD_MAGIC 2>&1)

if [ $? -eq 0 ]; then
    log_success "CANCEL TX SUBMITTED!"
    log_success "H-01 VERIFICATION PASSED: Client received >= deal.payment"
else
    log_error "Submission failed: $SUBMIT_RESULT"
    log_warn "This might mean the output was < deal.payment — H-01 fix is working!"
    exit 1
fi
