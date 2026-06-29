#!/bin/bash
# =============================================================================
# ADADIVE Escrow Contract - Preprod Testnet Deployment & E2E Test Script
# =============================================================================
# Prerequisites:
#   1. cardano-cli installed and in PATH
#   2. Funded test wallet with Preprod test ADA
#   3. Validator compiled (aiken build)
# =============================================================================

set -e

CONTRACT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREPROD_MAGIC=1
WALLET_DIR="${WALLET_DIR:-$HOME/cardano-wallet}"
OUTPUT_DIR="$CONTRACT_DIR/testnet"

echo "[INFO] ADADIVE Escrow Contract - Preprod Testnet Deployment"
echo "============================================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

mkdir -p "$OUTPUT_DIR"

# Check prerequisites
log_info "Checking prerequisites..."
if ! command -v cardano-cli &> /dev/null; then
    log_error "cardano-cli not found"
    exit 1
fi
cardano-cli --version | head -1

# Check Plutus script
if [ ! -f "$CONTRACT_DIR/plutus.json" ]; then
    log_error "plutus.json not found. Run 'aiken build' first."
    exit 1
fi

# Extract script from plutus.json
log_info "Extracting validator script from plutus.json..."
SCRIPT_CBOR=$(python3 -c "
import json
with open('$CONTRACT_DIR/plutus.json') as f:
    data = json.load(f)
    for v in data.get('validators', []):
        if 'deal_escrow.deal_escrow.if_this' in v.get('title', ''):
            print(v.get('compiledCode', ''))
            break
")

if [ -z "$SCRIPT_CBOR" ]; then
    log_error "Could not extract validator from plutus.json"
    exit 1
fi

# Create Plutus script JSON
cat > "$OUTPUT_DIR/escrow.plutus" << EOF
{
  "type": "PlutusScriptV2",
  "description": "ADADIVE Deal Escrow Validator",
  "cborHex": "$SCRIPT_CBOR"
}
EOF

# Build script address
log_info "Building validator address..."
ESCROW_ADDR=$(cardano-cli address build     --payment-script-file "$OUTPUT_DIR/escrow.plutus"     --testnet-magic $PREPROD_MAGIC)

echo "$ESCROW_ADDR" > "$OUTPUT_DIR/escrow.addr"
log_info "Escrow Address: $ESCROW_ADDR"

# Get protocol parameters
log_info "Fetching protocol parameters..."
cardano-cli query protocol-parameters     --testnet-magic $PREPROD_MAGIC     --out-file "$OUTPUT_DIR/protocol.json"

# Get script hash
SCRIPT_HASH=$(cardano-cli transaction policyid --script-file "$OUTPUT_DIR/escrow.plutus")
log_info "Script Hash: $SCRIPT_HASH"
echo "$SCRIPT_HASH" > "$OUTPUT_DIR/script.hash"

log_info ""
log_info "Deployment preparation complete!"
log_warn ""
log_warn "NEXT STEPS:"
log_warn "1. Request test ADA from faucet: https://docs.cardano.org/cardano-testnet/tools/faucet/"
log_warn "2. Send ADA to escrow address: $ESCROW_ADDR"
log_warn "3. Create DealDatum UTxO at the escrow address"
log_warn "4. Execute: Settle, Refund, or Cancel transactions"
log_warn ""
log_info "Files created in: $OUTPUT_DIR/"
ls -la "$OUTPUT_DIR/"
