#!/usr/bin/env bash
# Bring up a local Solana cluster for the ADADIVE escrow backend and frontend.
#
#   ./scripts/devnet-setup.sh
#
# Starts `solana-test-validator`, deploys `adadive_escrow`, then runs the
# backend package's `setup:localnet` to create the singleton `PlatformConfig`
# and write funded role keypairs to `keys/`.
#
# Local-only: this phase targets a local validator, not devnet or mainnet.
# Stop the validator with `kill "$(cat .anchor/validator.pid)"`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LEDGER="$ROOT/.anchor/test-ledger"
PIDFILE="$ROOT/.anchor/validator.pid"
RPC="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"

# The program is built from `programs/adadive_escrow` into `target/deploy` by
# `cargo build-sbf`; both the deploy below and `Anchor.toml` assume that path.
if [[ ! -f "$ROOT/target/deploy/adadive_escrow.so" ]]; then
  echo "target/deploy/adadive_escrow.so is missing — run 'cargo build-sbf' first" >&2
  exit 1
fi

if solana cluster-version --url "$RPC" >/dev/null 2>&1; then
  echo "Validator already running at $RPC"
else
  echo "Starting solana-test-validator..."
  mkdir -p "$(dirname "$LEDGER")"
  # `--clone-feature-set` matters: the program is built with a current SBF
  # toolchain, and a genesis feature set from an older release refuses to load
  # it with "sbpf_version required by the executable ... not enabled".
  solana-test-validator --reset --ledger "$LEDGER" --rpc-port 8899 \
    --clone-feature-set --url https://api.devnet.solana.com \
    > "$ROOT/.anchor/validator.log" 2>&1 &
  echo $! > "$PIDFILE"

  for _ in $(seq 1 120); do
    if solana cluster-version --url "$RPC" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! solana cluster-version --url "$RPC" >/dev/null 2>&1; then
    echo "Validator did not come up; see $ROOT/.anchor/validator.log" >&2
    exit 1
  fi
fi

if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  echo "No default Solana keypair; creating $HOME/.config/solana/id.json"
  solana-keygen new --no-bip39-passphrase -s -o "$HOME/.config/solana/id.json"
fi

echo "Deploying program..."
solana program deploy \
  --url "$RPC" \
  --keypair "$HOME/.config/solana/id.json" \
  --program-id "$ROOT/target/deploy/adadive_escrow-keypair.json" \
  "$ROOT/target/deploy/adadive_escrow.so"

echo "Initialising config and funding keypairs..."
SOLANA_RPC_URL="$RPC" \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
ADADIVE_KEYS_DIR="$ROOT/keys" \
  pnpm --filter @workspace/oracle-backend run setup:localnet

echo
echo "Ready. Start the backend with:"
echo "  DEV_ORACLE_KEYPAIR_PATH=$ROOT/keys/oracle.json \\"
echo "  pnpm --filter @workspace/oracle-backend run dev"
echo "and the frontend with:"
echo "  pnpm --filter @workspace/cardano-storage run dev"
