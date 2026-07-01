#!/bin/bash
# =============================================================================
# LOCK Transaction — Fund an escrow deal UTxO at the ADADIVE escrow address
# =============================================================================
# Usage:
#   WALLET_DIR=~/cardano-wallet ./lock_tx.sh
#
# Prerequisites:
#   - cardano-cli in PATH
#   - Client wallet keys in $WALLET_DIR/client/
#   - Reference script UTxO already exists at escrow address
#   - Funded client UTxO
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTNET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WALLET_DIR="${WALLET_DIR:-$HOME/cardano-wallet}"
PREPROD_MAGIC=1

mkdir -p "$TESTNET_DIR/tx"

# Load addresses
if [ ! -f "$TESTNET_DIR/escrow.addr" ]; then
    log_error "escrow.addr not found. Run 01_deploy_validator.py first."
    exit 1
fi
ESCROW_ADDR=$(cat "$TESTNET_DIR/escrow.addr")

# Check wallet
CLIENT_ADDR_FILE="$WALLET_DIR/client/client.addr"
if [ ! -f "$CLIENT_ADDR_FILE" ]; then
    log_error "Client wallet not found at $CLIENT_ADDR_FILE"
    log_info "Generate keys with:"
    log_info "  cardano-cli address key-gen --signing-key-file $WALLET_DIR/client/client.skey --verification-key-file $WALLET_DIR/client/client.vkey"
    log_info "  cardano-cli address build --payment-verification-key-file $WALLET_DIR/client/client.vkey --testnet-magic 1 --out-file $CLIENT_ADDR_FILE"
    exit 1
fi
CLIENT_ADDR=$(cat "$CLIENT_ADDR_FILE")
CLIENT_SKEY="$WALLET_DIR/client/client.skey"
CLIENT_VKEY="$WALLET_DIR/client/client.vkey"

log_info "Escrow Address: $ESCROW_ADDR"
log_info "Client Address: $CLIENT_ADDR"

# Get verification key hashes
log_info "Computing key hashes..."
CLIENT_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$CLIENT_VKEY")
PROVIDER_VKEY="$WALLET_DIR/provider/provider.vkey"
ORACLE_VKEY="$WALLET_DIR/oracle/oracle.vkey"

if [ ! -f "$PROVIDER_VKEY" ] || [ ! -f "$ORACLE_VKEY" ]; then
    log_error "Provider and/or oracle keys not found in $WALLET_DIR/"
    log_error "Generate them first with the key-gen commands."
    exit 1
fi

PROVIDER_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$PROVIDER_VKEY")
ORACLE_VKH=$(cardano-cli key-hash-verification-key --verification-key-file "$ORACLE_VKEY")

log_info "Client VKH:    $CLIENT_VKH"
log_info "Provider VKH:  $PROVIDER_VKH"
log_info "Oracle VKH:    $ORACLE_VKH"

# Deal parameters
DEAL_AMOUNT=10000000   # 10 ADA in lovelace
STORAGE_GB=10
DURATION_EPOCHS=6
DATA_HASH="51c0d36c69d411c3fe6f2b64c3b8b3a9e3c9d2b1a5f6e7d8c9b0a1f2e3d4c5"  # example IPFS CID hash
START_TIME=$(date +%s000)
DEADLINE=$(( $(date +%s) + 86400 ))000  # 24 hours from now

log_info "Deal Amount:    $DEAL_AMOUNT lovelace ($((DEAL_AMOUNT / 1000000)) ADA)"
log_info "Storage:        $STORAGE_GB GB"
log_info "Duration:       $DURATION_EPOCHS epochs"
log_info "Start Time:     $START_TIME"
log_info "Deadline:       $DEADLINE"

# Create datum
DATUM_FILE="$TESTNET_DIR/tx/lock_datum.json"
cat > "$DATUM_FILE" << EOF
{
  "constructor": 0,
  "fields": [
    {"bytes": "$CLIENT_VKH"},
    {"bytes": "$PROVIDER_VKH"},
    {"bytes": "$ORACLE_VKH"},
    {"bytes": "$DATA_HASH"},
    {"int": $DEAL_AMOUNT},
    {"int": $STORAGE_GB},
    {"int": $DURATION_EPOCHS},
    {"int": $START_TIME},
    {"int": $DEADLINE},
    {"constructor": 0, "fields": []},
    {"int": 0},
    {"constructor": 0, "fields": []}
  ]
}
EOF
log_info "Datum written: $DATUM_FILE"

# Find a funded UTxO at the client address
log_info "Querying client UTxOs..."
UTXO_OUTPUT=$(cardano-cli query utxo --address "$CLIENT_ADDR" --testnet-magic $PREPROD_MAGIC 2>&1)
echo "$UTXO_OUTPUT" | tail -n +4 | awk '{print $1, $2, $3}' | while read -r txhash txix ada; do
    if [ -n "$txhash" ] && [ -n "$txix" ]; then
        lovelace=$(echo "$ada" | sed 's/lovelace//' | tr -d ' ')
        lovelace_int=${lovelace:-0}
        if [ "$lovelace_int" -gt 15000000 ]; then  # > 15 ADA to cover lock + fees
            log_info "Found UTxO: ${txhash}#${txix} with ${ada}"
            FUNDED_TX_IN="${txhash}#${txix}"
            break
        fi
    fi
done

if [ -z "${FUNDED_TX_IN:-}" ]; then
    log_error "No sufficiently funded UTxO found at client address."
    log_error "Request test ADA from the Preprod faucet: https://docs.cardano.org/cardano-testnet/tools/faucet/"
    echo "$UTXO_OUTPUT"
    exit 1
fi

# Build lock amount: deal amount + min UTxO
LOCK_AMOUNT=$((DEAL_AMOUNT + 2000000))  # 10 ADA + 2 ADA min UTxO

log_info "Building lock transaction..."
log_info "  Input:  $FUNDED_TX_IN"
log_info "  Output: $ESCROW_ADDR + $LOCK_AMOUNT lovelace"

cardano-cli transaction build \
    --tx-in "$FUNDED_TX_IN" \
    --tx-out "$ESCROW_ADDR+$LOCK_AMOUNT" \
    --tx-out-datum-embed-file "$DATUM_FILE" \
    --change-address "$CLIENT_ADDR" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/lock_tx.draft"

log_info "Signing transaction..."
cardano-cli transaction sign \
    --tx-body-file "$TESTNET_DIR/tx/lock_tx.draft" \
    --signing-key-file "$CLIENT_SKEY" \
    --testnet-magic $PREPROD_MAGIC \
    --out-file "$TESTNET_DIR/tx/lock_tx.signed"

log_info "Submitting transaction..."
SUBMIT_OUTPUT=$(cardano-cli transaction submit \
    --tx-file "$TESTNET_DIR/tx/lock_tx.signed" \
    --testnet-magic $PREPROD_MAGIC 2>&1)

if [ $? -eq 0 ]; then
    TX_HASH=$(cat "$TESTNET_DIR/tx/lock_tx.draft" | python3 -c "
import json, sys
d = json.load(sys.stdin)
# The tx hash is the merkle root of the tx body
# For display, get from the signed file's witness set hash
# Actually, read from the draft JSON
body = json.load(open('$TESTNET_DIR/tx/lock_tx.draft'))
print('Draft created, TX not yet submitted' if not body else 'TX submitted')
" 2>/dev/null || echo "submitted")
    log_success "LOCK TX SUBMITTED!"
    log_info "Escrow deal UTxO created at: $ESCROW_ADDR"
    log_info "Datum Hash: $(python3 -c "
import cbor2, hashlib, json
with open('$DATUM_FILE') as f:
    d = json.load(f)
h = hashlib.blake2b(cbor2.dumps(d), digest_size=32).digest()
import binascii; print(binascii.hexlify(h).decode())
" 2>/dev/null)"
    log_info ""
    log_info "TX Hash: (check block explorer: https://preprod.cardano.org/tx/$TX_HASH)"
    log_warn "Next step: Run settle_tx.sh, refund_tx.sh, or cancel_tx.sh"
else
    log_error "Submission failed: $SUBMIT_OUTPUT"
    exit 1
fi
