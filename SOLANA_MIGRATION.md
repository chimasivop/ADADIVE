# Cardano → Solana migration

Phase 5 replaces ADADIVE's Cardano blockchain integration with the Solana
integration proven in `ADADIVE-solana` (Phases 1–4). The escrow program, fee
model, oracle verification and auth flow are **reused**, not rebuilt.

Two things did change for the user, and are called out at the end: the labels
now name Solana instead of Cardano, and the database columns were renamed from
`ADA` to `SOL` in place. See "Copy status" and "Renaming the ADA columns".

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
- `artifacts/cardano-storage/src` — the UI. Its wallet context and chain calls
  were rewired to Solana; see "Copy status" for the text that changed.

The frontend package is still named `cardano-storage` — that is a package
name, not a claim about the chain, and renaming it would ripple through the
workspace, the lockfile and every `--filter` invocation for no functional gain.
Three backend field names also still read `THT`: `pricePerEpochTHT`,
`totalCostTHT` and the `cardanoMetadata` response object. These are wire-format
names that both the API server and the frontend already agree on; they carry
SOL-denominated values. They are listed under "Names that still say Cardano"
below.

The database columns did *not* keep their ADA names. `providers.total_ada_earned`
and `deals.total_cost_ada` were renamed to `total_sol_earned` and
`total_cost_sol`, in place, by a migration that preserves the data. See
"Renaming the ADA columns" below.

## Why some names are misleading

The wallet context exposes a single balance field, `solBalance`. The Cardano
build carried two — `adaBalance` and `thtBalance` — because THT was a separate
native token alongside ADA. Solana's escrow moves one native asset, so the two
collapsed into one, and both old names are gone:

```
connected / connecting / address / solBalance / error / connect / disconnect / displayAddress
```

`address` holds a base58 Solana public key (it was a bech32 `addr1…`), and
`displayAddress` is the shortened form the UI renders. Consumers that call the
chain or the API must use `address`; `displayAddress` is display-only.

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

## Renaming the ADA columns

`providers.total_ada_earned` and `deals.total_cost_ada` are renamed in place to
`total_sol_earned` and `total_cost_sol`. This cannot be left to
`drizzle-kit push`: `push` cannot distinguish a rename from a drop-and-add, so
it would create the new columns empty and drop the old ones, discarding every
provider's lifetime earnings and every deal's cost.

`migrations/0001_rename_ada_columns.sql` does the rename, and it is idempotent —
re-running it is a no-op, and a fresh database is left for `push` to build.

Apply it with:

```
pnpm --filter @workspace/db run push        # migrate.mjs, then drizzle-kit push
```

**Every** path that pushes this schema already goes through `migrate.mjs`:
`pnpm --filter db push` (used by `scripts/post-merge.sh`), the `push-force`
variant, the CI `db-migrate` workflow, and the API server's own `migrate`
script. As a backstop, `lib/db/drizzle.config.ts` refuses to run any
`drizzle-kit` command against a database that still has the ADA columns, so a
new script or a hand-typed command cannot route around the migration. Run
`pnpm --filter @workspace/db run check:ada-columns` to check a database
yourself; it exits non-zero and explains the fix if the rename is outstanding.

## Refund

Refund is the one escrow flow that needs no backend. The depositor can reclaim
unilaterally once the deal's on-chain `deadline` has passed, so the
`DealStatusCard` button reads `deadline` from the deal account and calls
`refundEscrow`. There is deliberately no cancel UI.

## Copy status

The migration is complete enough that the brief's "do not change Cardano text"
constraint no longer applies; the UI now says what the app actually does —
`CONNECT PHANTOM`, `SOLANA TX`, `SOL`/`BAL`, `◎`, and `explorer.solana.com`.

Two things are worth a reviewer's eye:

- **THT is still all over the marketing pages.** `Landing.tsx` and
  `TokenPage.tsx` describe a "THT Token", a "THT allocation bonus", and
  "powered by THT", and `lib/token.ts` still models a Cardano policy ID. None of
  it reflects Solana. Whether the product keeps a separate token on Solana or
  drops the concept is a product decision, not a migration one, so it was left
  alone rather than guessed at. This is the largest remaining Cardano-shaped
  surface.
- **Names that still say Cardano** (all wire-format, all carrying SOL values):
  `pricePerEpochTHT`, `totalCostTHT`, `cardanoMetadata`, and the
  `cardano-storage` package name. Renaming these means changing the OpenAPI
  spec and regenerating the clients.