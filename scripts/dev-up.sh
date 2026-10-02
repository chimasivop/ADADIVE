#!/usr/bin/env bash
# Bring the whole ADADIVE stack up from a cold checkout: Postgres, a local
# Solana validator with the escrow program deployed, the oracle backend, the
# api-server and the frontend.
#
#   ./scripts/dev-up.sh          start everything (idempotent — safe to re-run)
#   ./scripts/dev-up.sh status   show what is running
#   ./scripts/dev-up.sh stop     stop the app processes (leaves Postgres up)
#
# This exists because bringing the stack up by hand is a sequence of
# easy-to-miss steps, and doing them for a fresh environment used to cost real
# time. It encodes the non-obvious ones:
#
#   * api-server and oracle-backend own *separate* databases. Both define a
#     `deals` table, so pointing them at one database makes the second
#     migration fail (or worse, silently skip). They are split here.
#   * The oracle backend's entry guard (`isMainModule`) does not match under
#     `tsx` in some environments, so `run dev` can exit 0 without doing
#     anything. This runs the esbuild bundle instead, where the guard matches.
#   * The validator starts with an *unfunded* payer, so the deploy needs an
#     airdrop first.
#   * The program id is fixed (`declare_id!`); deploying it needs the matching
#     keypair. A copy is kept at `keys/adadive_escrow-keypair.json` and restored
#     into `target/deploy/` on demand, so a fresh checkout does not depend on
#     the ADADIVE-solana prototype still existing.
#
# Secrets are read from the environment, or from a `.env` file at the repo root
# if one exists (gitignored). `PINATA_JWT` is required for anything that pins.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Toolchains live outside the repository. `/workspace` is typically a persistent
# volume while `/` and `$HOME` are not, so after a container reset the workspace
# survives but the Rust/Solana/Postgres installs do not — hence the `ensure_*`
# checks below.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

RUN_DIR="${ADADIVE_RUN_DIR:-$ROOT/.dev-run}"
mkdir -p "$RUN_DIR"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD

ORACLE_DB="${ORACLE_DB:-adadive_oracle}"
API_DB="${API_DB:-adadive}"

RPC="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
ORACLE_PORT="${ORACLE_PORT:-5001}"
API_PORT="${API_PORT:-5000}"
FRONTEND_PORT="${PORT:-12000}"

# The preview host the frontend is reached through. Override for a different
# forwarded host.
PREVIEW_HOSTS="${PREVIEW_HOSTS:-}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}${PREVIEW_HOSTS:+,$PREVIEW_HOSTS}}"

# Local credentials for the development-only admin surface. Not secrets, not
# valid anywhere but this machine.
ADMIN_PASSWORD="${ADMIN_PASSWORD:-localdev-admin-password}"

# The session-signing key the oracle and api-server must share. Wallet-signed
# sessions are HS256 tokens the oracle mints and the api-server verifies, so
# without a common value the api-server fails closed and Pin Files 401s. The
# oracle's default is a per-process ephemeral key — precisely the wrong thing
# here — so a fixed dev value is set instead, stable across restarts so a
# session outlives one. Override with SESSION_SECRET in `.env` or the
# environment. The value below is not a secret; it is a local dev placeholder.
SESSION_SECRET="${SESSION_SECRET:-localdev-session-signing-secret-not-for-production}"

if [[ -f "$ROOT/.env" ]]; then
  echo "==> Loading $ROOT/.env"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing '$1'. $2" >&2
    exit 1
  }
}

log() { printf '\n==> %s\n' "$*"; }

# ── Toolchain provisioning ───────────────────────────────────────────────────
# These are no-ops when the tool is already present, so re-running `dev-up.sh`
# is cheap. They exist because a container reset clears `/` and `$HOME` while
# leaving `/workspace` intact: the checkout and its node_modules survive, but
# Rust, the Solana CLI and the Postgres cluster do not.

ensure_postgres() {
  command -v pg_isready >/dev/null 2>&1 && return 0
  echo "    installing PostgreSQL (apt)"
  sudo apt-get update -qq
  DEBIAN_FRONTEND=noninteractive sudo apt-get install -y -qq postgresql postgresql-contrib
}

ensure_rust() {
  command -v cargo >/dev/null 2>&1 && return 0
  echo "    installing Rust (rustup, pinned toolchain 1.89.0)"
  curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.89.0 --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
}

ensure_solana() {
  command -v solana >/dev/null 2>&1 && return 0
  echo "    installing the Solana (Agave) CLI"
  curl -sSfL https://release.anza.xyz/stable/install | sh
}

ensure_pnpm() {
  command -v pnpm >/dev/null 2>&1 && return 0
  echo "    enabling pnpm via corepack"
  sudo corepack enable pnpm
}

ensure_pg_running() {
  pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && return 0
  echo "    starting the default Postgres cluster"
  sudo pg_ctlcluster 17 main start 2>/dev/null || true
  sleep 2
  pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1
}

# The program id is fixed by `declare_id!`, so the deploy needs the matching
# keypair. Keep a copy under `$ROOT/keys/` (gitignored) so a fresh environment
# does not depend on the ADADIVE-solana prototype still existing.
seed_program_keypair() {
  local dest="$ROOT/target/deploy/adadive_escrow-keypair.json"
  local seed="$ROOT/keys/adadive_escrow-keypair.json"
  [[ -f "$dest" ]] && return 0
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$seed" ]]; then
    cp "$seed" "$dest"
    echo "    restored program keypair from keys/"
    return 0
  fi
  cat >&2 <<'MSG'
    target/deploy/adadive_escrow-keypair.json is missing, and there is no copy
    under keys/. The program id is fixed by `declare_id!` in
    programs/adadive_escrow/src/lib.rs, so deployment requires the matching
    keypair. Obtain it from the project maintainer and place it at either path.
MSG
  exit 1
}

# `devnet-setup.ts` writes freshly generated role keypairs on every run. They
# are funded on this throwaway localnet, so persistence is not required, but
# keeping them makes a restart stable and makes `ORACLE_PUBKEY` consistent.
seed_role_keys() {
  local persistent="${ADADIVE_KEYS_DIR:-}"
  [[ -n "$persistent" && -d "$persistent" ]] || return 0
  mkdir -p "$ROOT/keys"
  for k in oracle depositor provider; do
    if [[ -f "$persistent/$k.json" && ! -f "$ROOT/keys/$k.json" ]]; then
      cp "$persistent/$k.json" "$ROOT/keys/$k.json"
      echo "    restored $k keypair from $persistent"
    fi
  done
}

wait_for_port() {
  local port="$1" tries="${2:-60}"
  for (( i=0; i<tries; i++ )); do
    if (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

start_bg() {
  local name="$1"
  local pidfile="$RUN_DIR/$name.pid" logfile="$RUN_DIR/$name.log"
  shift
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "    $name already running (pid $(cat "$pidfile"))"
    return 0
  fi
  # `setsid` puts each service in its own process group so `stop` can take the
  # whole tree down — `pnpm … run dev` spawns vite as a child, and killing only
  # pnpm would leave vite holding the port.
  ( setsid "$@" >"$logfile" 2>&1 & echo $! >"$pidfile" )
  echo "    $name started (pid $(cat "$pidfile")) -> $logfile"
}

stop_one() {
  local name="$1"
  local pidfile="$RUN_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    local pid; pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      echo "    stopped $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
}

status() {
  echo "Postgres:   $PGHOST:$PGPORT $(pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && echo up || echo down)"
  echo "Validator:  $RPC $(solana cluster-version --url "$RPC" >/dev/null 2>&1 && echo up || echo down)"
  for entry in "oracle-backend:$ORACLE_PORT" "api-server:$API_PORT" "frontend:$FRONTEND_PORT"; do
    name="${entry%%:*}"; port="${entry##*:}"
    pidfile="$RUN_DIR/$name.pid"
    if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      echo "$(printf '%-11s' "$name:")  port $port up (pid $(cat "$pidfile"))"
    else
      echo "$(printf '%-11s' "$name:")  port $port down"
    fi
  done
}

cmd_stop() {
  log "Stopping app processes"
  stop_one frontend
  stop_one api-server
  stop_one oracle-backend
  echo "    (Postgres and the validator are left running; use pg_ctlcluster / solana-test-validator to stop those)"
}

cmd_up() {
  log "Toolchains"
  ensure_pnpm
  ensure_postgres
  ensure_rust
  ensure_solana
  echo "    node $(node -v), pnpm $(pnpm -v), $(cargo --version), $(solana --version | awk '{print $1, $2}')"

  log "Postgres"
  ensure_pg_running || { echo "could not reach Postgres at $PGHOST:$PGPORT; start it and re-run" >&2; exit 1; }
  for db in "$ORACLE_DB" "$API_DB"; do
    if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE $db" >/dev/null
      echo "    created database $db"
    fi
  done
  echo "    databases: $ORACLE_DB (oracle), $API_DB (api-server)"

  log "Workspace dependencies"
  pnpm install --frozen-lockfile

  log "Building shared libraries"
  pnpm exec tsc --build || true

  log "Anchor escrow program"
  seed_role_keys
  seed_program_keypair
  if [[ ! -f "$ROOT/target/deploy/adadive_escrow.so" ]] \
     || [[ "$ROOT/programs/adadive_escrow/src/lib.rs" -nt "$ROOT/target/deploy/adadive_escrow.so" ]]; then
    echo "    cargo build-sbf (this can take a few minutes on a cold cache)"
    cargo build-sbf
  else
    echo "    program already built"
  fi

  log "Local validator and program deploy"
  # The deploy needs a funded payer, and a fresh validator starts every account
  # at zero — so `devnet-setup.sh` fails on a first cold run. Start the
  # validator, fund the payer, then run it again; the script is idempotent
  # (it skips the deploy when the program is already there, and skips
  # `PlatformConfig` initialisation when it already exists).
  if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
    solana-keygen new --no-bip39-passphrase -s -o "$HOME/.config/solana/id.json" >/dev/null
  fi
  bash "$ROOT/scripts/devnet-setup.sh" || true
  if solana cluster-version --url "$RPC" >/dev/null 2>&1; then
    if [[ "$(solana balance --url "$RPC" 2>/dev/null | awk '{print $1}')" == "0" ]]; then
      echo "    airdropping 100 SOL to $(solana address)"
      solana airdrop 100 --url "$RPC" >/dev/null
    fi
    bash "$ROOT/scripts/devnet-setup.sh"   # funded: deploy + PlatformConfig + keys
  else
    echo "validator not reachable at $RPC; see $ROOT/.anchor/validator.log" >&2
    exit 1
  fi

  log "Database schema"
  # The oracle applies its own migrations on startup, so only the api-server's
  # schema is pushed here.
  ( cd "$ROOT/lib/db" \
      && DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$API_DB" \
         node ./migrate.mjs \
      && DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$API_DB" \
         pnpm exec drizzle-kit push --config ./drizzle.config.ts )
  echo "    api-server schema pushed to $API_DB"

  log "Building service bundles"
  ( cd "$ROOT/artifacts/oracle-backend" && node ./build.mjs >/dev/null )
  ( cd "$ROOT/artifacts/api-server" && node ./build.mjs >/dev/null )

  ORACLE_PUBKEY="${ORACLE_PUBKEY:-$(solana-keygen pubkey "$ROOT/keys/oracle.json" 2>/dev/null || true)}"
  if [[ -z "$ORACLE_PUBKEY" ]]; then
    echo "    warning: could not derive ORACLE_PUBKEY from keys/oracle.json" >&2
  fi

  log "Starting services"
  start_bg oracle-backend env \
    PORT="$ORACLE_PORT" \
    NODE_ENV=development \
    DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$ORACLE_DB" \
    SOLANA_RPC_URL="$RPC" \
    ORACLE_SECRET_SOURCE=local-dev \
    DEV_ORACLE_KEYPAIR_PATH="$ROOT/keys/oracle.json" \
    SESSION_SECRET_SOURCE=env \
    SESSION_SECRET="$SESSION_SECRET" \
    AUTH_REQUIRED=true \
    PINATA_JWT="${PINATA_JWT:-}" \
    node --enable-source-maps "$ROOT/artifacts/oracle-backend/dist/index.mjs"

  start_bg api-server env \
    PORT="$API_PORT" \
    NODE_ENV=development \
    DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$API_DB" \
    SOLANA_RPC_URL="$RPC" \
    ORACLE_PUBKEY="$ORACLE_PUBKEY" \
    ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    SESSION_SECRET="$SESSION_SECRET" \
    ALLOWED_ORIGIN="$ALLOWED_ORIGIN" \
    PINATA_JWT="${PINATA_JWT:-}" \
    PINATA_GATEWAY="${PINATA_GATEWAY:-}" \
    node --enable-source-maps "$ROOT/artifacts/api-server/dist/index.mjs"

  start_bg frontend env \
    PORT="$FRONTEND_PORT" \
    BASE_PATH=/ \
    NODE_ENV=development \
    API_URL="http://localhost:$API_PORT" \
    BACKEND_URL="http://localhost:$ORACLE_PORT" \
    SOLANA_RPC_URL="$RPC" \
    VITE_SOLANA_CLUSTER=localnet \
    pnpm --filter @workspace/cardano-storage run dev

  log "Waiting for services"
  wait_for_port "$ORACLE_PORT" 60 && echo "    oracle-backend up on $ORACLE_PORT" || { echo "oracle-backend did not come up; see $RUN_DIR/oracle-backend.log" >&2; exit 1; }
  wait_for_port "$API_PORT" 60 && echo "    api-server up on $API_PORT" || { echo "api-server did not come up; see $RUN_DIR/api-server.log" >&2; exit 1; }
  wait_for_port "$FRONTEND_PORT" 60 && echo "    frontend up on $FRONTEND_PORT" || { echo "frontend did not come up; see $RUN_DIR/frontend.log" >&2; exit 1; }

  echo
  echo "Stack is up:"
  echo "  frontend        http://localhost:$FRONTEND_PORT/"
  echo "  api-server      http://localhost:$API_PORT/api/healthz"
  echo "  oracle-backend  http://localhost:$ORACLE_PORT/health"
  echo "  solana rpc      $RPC"
  if [[ -z "${PINATA_JWT:-}" ]]; then
    echo
    echo "NOTE: PINATA_JWT is not set, so Pin Files will answer 503. Export it"
    echo "      (or put it in $ROOT/.env) and re-run to enable pinning."
  fi
}

case "${1:-up}" in
  up)     cmd_up ;;
  stop)   cmd_stop ;;
  status) status ;;
  restart) cmd_stop; cmd_up ;;
  *) echo "usage: $0 [up|stop|status|restart]" >&2; exit 2 ;;
esac
