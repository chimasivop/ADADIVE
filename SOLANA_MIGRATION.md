# Cardano → Solana migration

Phase 5 replaces ADADIVE's Cardano blockchain integration with the Solana
integration proven in `ADADIVE-solana` (Phases 1–4). The escrow program, fee
model, oracle verification and auth flow are **reused**, not rebuilt. Nothing
user-visible was intended to change; see "Copy status" at the end for the
handful of places where it did and why that is currently unresolved.

## What the swap is, module by module

| Concern | Before (Cardano) | After (Solana) |
| --- | --- | --- |
| Wallet connect | `window.cardano.eternl.enable()` (CIP-30) | `@solana/wallet-adapter` — Phantom, Solflare |
| Address format | bech32 `addr1…` / `addr_test1…` | base58 ed25519 public key |
| Balance | CBOR-decoded `getBalance()` → ADA + THT | `connection.getBalance()` → lamports |
| Tx building | `cardano-serialization-lib`, CIP-1337/721 metadata on a self-transfer | Anchor `initialize`/`settle`/`refund`/`cancel` on the escrow program |
| Settle | two-party manual co-sign | backend oracle: verify pin → challenge window → auto-sign |
| Deal status | `api-server` reading Koios | backend `GET /deals/:id`, `api-server` reading Solana RPC |
| Explorer link | `preprod.cardanoscan.io` | `explorer.solana.com` |
| Fee/treasury | constants in the app | read live from the on-chain `PlatformConfig` account |

## Where the logic lives

- `programs/adadive_escrow` — Anchor program (ported from the prototype).
- `lib/solana-escrow` — shared client: the four flows, wallet adapters, fee
  math, and the `BackendApi` client the browser calls.
- `artifacts/oracle-backend` — the Phase 3 oracle service: auth
  (`/auth/challenge`, `/auth/verify`), deal registration and status
  (`/deals`, `/deals/:id`), settle requests (`/deals/:id/settle`), disputes
  (`/deals/:id/dispute`), the challenge-window scheduler, and Postgres
  migrations.
- `artifacts/cardano-storage/src` — the unchanged UI. Only its wallet context
  and its chain calls were rewired.

The frontend package is still named `cardano-storage`, and several backend
field names still say `ADA`/`lovelace`. These are deliberately left alone:
renaming them would ripple through the database schema, the OpenAPI spec and
the generated clients for no functional gain. They are display-only names that
now carry SOL.

## Why some names are misleading

`thtBalance` and `adaBalance` on the wallet context now both hold the wallet's
SOL balance — the escrow moves a single native asset, and the Cardano build had
two because THT was a separate native token. The wallet context keeps its exact
public shape (`connected`/`connecting`/`address`/`thtBalance`/`adaBalance`/
`error`/`connect`/`disconnect`/`displayAddress`) so that no consumer's JSX had to
change.

## Local development

```
./scripts/devnet-setup.sh          # validator + deploy + PlatformConfig + keys
DEV_ORACLE_KEYPAIR_PATH=$PWD/keys/oracle.json \
  pnpm --filter @workspace/oracle-backend run dev
pnpm --filter @workspace/cardano-storage run dev
```

`scripts/devnet-setup.sh` is idempotent. It starts a local validator, deploys
the program, creates the singleton `PlatformConfig` if absent, and writes
funded `keys/{depositor,provider,oracle}.json` (gitignored, throwaway localnet
keys importable into Phantom/Solflare for the walkthrough).

The opt-in end-to-end test drives a real settle against the live validator:

```
SOLANA_RPC_URL=http://127.0.0.1:8899 \
DATABASE_URL=postgres://postgres@127.0.0.1:5433/adadive_oracle \
  pnpm --filter @workspace/oracle-backend run test:e2e
```

## Copy status (unresolved)

The brief requires that `Cardano`, `THT` and `Eternl` text in the UI not be
changed, and that unchangeable Cardano-specific strings be reported rather than
decided unilaterally. The current working tree changes several such strings —
`CONNECT ETERNL` → `CONNECT PHANTOM`, `SIGN & PIN TO CARDANO` → `…SOLANA`,
`CARDANO TX` → `SOLANA TX`, `THT`/`ADA` → `SOL`/`BAL`, `₳` → `◎`, and explorer
URLs. These are listed in the Phase 5 scope report and are awaiting a decision;
they are the only behavioural difference a user can see.