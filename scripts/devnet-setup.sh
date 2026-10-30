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
# The program address is fixed by `declare_id!`; keep this in step with
# `programs/adadive_escrow/src/lib.rs` and `Anchor.toml`.
PROGRAM_ID="${PROGRAM_ID:-7oK8tkw3H8HYqfb23wm2Jss82hSmVffhUDS2R5GE4NdS}"
SO="$ROOT/target/deploy/adadive_escrow.so"

# The program is built from `programs/adadive_escrow` into `target/deploy` by
# `cargo build-sbf`; both the genesis load below and `Anchor.toml` assume that
# path.
if [[ ! -f "$SO" ]]; then
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
  #
  # `--bpf-program` places the program at `PROGRAM_ID` in the validator's
  # genesis. This replaces `solana program deploy`, which would need the
  # program's *keypair* — gitignored, and absent on a fresh checkout. Loading it
  # by address needs no keypair and lands it at exactly the id `declare_id!`
  # fixes, which is what the clients derive PDAs against. `--reset` wipes any
  # existing ledger so the genesis program is (re)loaded on every start.
  solana-test-validator --reset --ledger "$LEDGER" --rpc-port 8899 \
    --clone-feature-set --url https://api.devnet.solana.com \
    --bpf-program "$PROGRAM_ID" "$SO" \
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

# Confirm the program actually made it into genesis; a missing program would
# otherwise surface later as an opaque "account does not exist" on the first
# escrow call.
if solana program show --url "$RPC" "$PROGRAM_ID" >/dev/null 2>&1; then
  echo "Program $PROGRAM_ID is loaded on $RPC"
else
  echo "warning: program $PROGRAM_ID is not present on $RPC" >&2
fi

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
