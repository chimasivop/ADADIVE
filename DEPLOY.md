# Deploying the hosted devnet demo

A step-by-step guide to standing up a **separate, throwaway Railway project**
for the Provider Reliability Agent demo, from the `feat/reliability-agent`
branch. Nothing here touches the existing production project.

> **Scope.** This is a *devnet* demo. It uses a fresh Postgres, fresh oracle and
> authority keypairs generated for the demo alone, and Solana **devnet**. Do not
> reuse any production key, database or secret. The reliability advisor is
> advisory only — it never signs, releases funds or changes a deal, and this
> deployment changes no escrow, fee or auth code.

---

## 0. What you are creating

A **new Railway project** (call it `adadive-devnet-demo`) with three services
and one database. It is fully independent of production:

| Service | Package | What it is |
| ------- | ------- | ---------- |
| `api-server` | `artifacts/api-server` | The HTTP API + the reliability advisor route |
| `oracle-backend` | `artifacts/oracle-backend` | Wallet-signature auth, challenge windows, settle |
| `frontend` | `artifacts/cardano-storage` | The React SPA (Vite) |
| `Postgres` | — | **Two logical databases** on one Railway Postgres: one for the api-server, one for the oracle |

> **Two databases, not one.** The api-server and the oracle-backend each define
> a `deals` table with different shapes; pointing both at one database makes the
> second migration fail. Railway's Postgres add-on gives you one server — create
> two databases inside it (`adadive` and `adadive_oracle`) and give each service
> its own `DATABASE_URL`. This mirrors `scripts/dev-up.sh`.

Railway mints a public hostname per service. Set `api-server` and `oracle-backend`
to expose a public domain; the frontend needs a public domain too, and its build
must know the two backend URLs.

---

## 1. Prerequisites (do these once, on your machine)

You need the Solana CLI and a funded devnet authority wallet. The program id is
fixed by `declare_id!` in `programs/adadive_escrow/src/lib.rs`:

```
7oK8tkw3H8HYqfb23wm2Jss82hSmVffhUDS2R5GE4NdS
```

### 1a. Generate fresh keys for the demo — never reuse production keys

Create a **new** directory outside the repo for the demo keys, and generate a
fresh **authority** keypair and a fresh **oracle** keypair. These are throwaway
and must not be the production oracle or the production deploy authority.

```bash
mkdir -p ~/adadive-devnet-demo-keys && cd ~/adadive-devnet-demo-keys

# Fresh authority: pays for the one-time devnet program deploy and owns
# PlatformConfig. NOT the production authority.
solana-keygen new --no-bip39-passphrase -o ./authority.json

# Fresh oracle: the key the oracle-backend signs settles with. NOT the
# production oracle.
solana-keygen new --no-bip39-passphrase -o ./oracle.json

solana-keygen pubkey ./authority.json   # -> authority public key
solana-keygen pubkey ./oracle.json      # -> ORACLE_PUBKEY for the demo
```

Keep `oracle.json` — its contents become the oracle service's
`ORACLE_KEYPAIR_SECRET`. Keep the authority keypair only long enough to deploy
the program (step 1b); it is not needed at runtime.

### 1b. Fund them with devnet SOL

```bash
solana config set --url https://api.devnet.solana.com

# Fund the authority (needs ~5 SOL to deploy the program).
solana airdrop 5 ./authority.json --url https://api.devnet.solana.com

# Fund the oracle (a little SOL so it can pay settle fees).
solana airdrop 2 ./oracle.json --url https://api.devnet.solana.com

solana balance ./authority.json --url https://api.devnet.solana.com
solana balance ./oracle.json    --url https://api.devnet.solana.com
```

If a faucet rate-limits you, retry later or use https://faucet.solana.com and
paste the address.

### 1c. Deploy the escrow program to devnet (one-time, prerequisite)

Deals only work if the escrow program exists on the cluster the demo points at.
Deploy it **once** to devnet with the demo authority:

```bash
# Build the program (writes target/deploy/adadive_escrow.so and, if the
# keypair is absent, a NEW random one — see the warning below).
anchor build

# The program id is fixed by declare_id!, so the deploy needs the matching
# keypair. If target/deploy/adadive_escrow-keypair.json is missing, the
# maintainer keeps a copy at keys/adadive_escrow-keypair.json. Restore it and
# confirm the address matches declare_id! BEFORE deploying.
cp keys/adadive_escrow-keypair.json target/deploy/adadive_escrow-keypair.json
solana-keygen pubkey target/deploy/adadive_escrow-keypair.json
# must print 7oK8tkw3H8HYqfb23wm2Jss82hSmVffhUDS2R5GE4NdS

solana program deploy \
  --url https://api.devnet.solana.com \
  --keypair ~/adadive-devnet-demo-keys/authority.json \
  --program-id target/deploy/adadive_escrow-keypair.json
```

> **Do not run `cargo build-sbf`/`anchor build` before restoring the keypair.**
> A build with no keypair present silently generates a fresh random one, and a
> deploy with it fails (or lands under the wrong id). `scripts/dev-up.sh`
> restores it automatically; a standalone build does not.

### 1d. Create the singleton `PlatformConfig` on devnet

The program requires a `PlatformConfig` account before any deal can be created.
`initialize_config` takes `(fee_basis_points, treasury, max_deal_amount:
Option<u64>)`. The repo's `artifacts/oracle-backend/scripts/devnet-setup.ts`
creates it, but it also writes local role keys and airdrops — for the hosted demo
run only the config step against devnet, or create it with the maintainer's
`PlatformConfig` initialisation. Confirm it exists:

```bash
solana account $(solana-keygen pubkey ./authority.json) --url https://api.devnet.solana.com
```

If you already have a devnet `PlatformConfig` from a previous demo run, reuse it
— `initialize_config` is a one-time, idempotent-at-the-account-level step (it
fails if the account already exists, which is fine).

---

## 2. Create the Railway project

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → this
   repository → branch **`feat/reliability-agent`**. Name it
   `adadive-devnet-demo`.
2. **Add Postgres**: in the project, **Create → Database → PostgreSQL**.
3. In the Postgres service, open the **Data** tab (or use `psql`) and create a
   second database for the oracle:

   ```sql
   CREATE DATABASE adadive;         -- api-server
   CREATE DATABASE adadive_oracle;  -- oracle-backend
   ```

   The api-server uses `adadive`; the oracle uses `adadive_oracle`. Both
   connection strings come from the Postgres service's **Variables** tab
   (`DATABASE_URL`, `DATABASE_PUBLIC_URL`). Append the database name and, for
   `DATABASE_URL` inside Railway's private network, use the internal host.

4. **Create three services** from the same repo/branch, one per package. Railway
   lets you set a **Root Directory** per service and override the build/start
   commands. Configure each as in section 3.

> Every service needs the workspace installed first. The repo is a pnpm
> workspace, so each service's build command must run from the repo root and use
> a `--filter`.

---

## 3. Build and start commands (from the repo's real scripts)

All three services share the same install step. Railway's **Build Command**
field accepts `&&` chains; run them from the repo root.

### Shared install (prefix for every service's build)

```bash
pnpm install --frozen-lockfile
```

### api-server

| Setting | Command |
| ------- | ------- |
| Build | `pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build` |
| Pre-deploy / release (one-off) | `pnpm --filter @workspace/api-server run migrate` |
| Start | `pnpm --filter @workspace/api-server run start` |

- `build` → `node ./build.mjs` (esbuild bundle → `artifacts/api-server/dist/index.mjs`).
- `start` → `node --enable-source-maps ./dist/index.mjs`.
- `migrate` → `cd ../../lib/db && node ./migrate.mjs && drizzle-kit push --force`.
  Run this **once** after the first deploy, against the api-server's
  `DATABASE_URL`. Railway's *Pre-deploy Command* (or a one-off shell) is the
  right place. It is idempotent.

### oracle-backend

| Setting | Command |
| ------- | ------- |
| Build | `pnpm install --frozen-lockfile && pnpm --filter @workspace/oracle-backend run build` |
| Start | `pnpm --filter @workspace/oracle-backend run start` |

- `build` → `node ./build.mjs` (bundle + copies `migrations/` into `dist/`).
- `start` → `node --enable-source-maps ./dist/index.mjs`.
- **No separate migrate step**: the oracle applies its own migrations on
  startup (`runMigrations` in `src/index.ts`), reading `dist/migrations`.

### frontend

| Setting | Command |
| ------- | ------- |
| Build | `pnpm install --frozen-lockfile && pnpm --filter @workspace/cardano-storage run build` |
| Start | `pnpm --filter @workspace/cardano-storage run serve` |

- `build` → `vite build --config vite.config.ts` (static output in
  `artifacts/cardano-storage/dist/public`).
- `serve` → `vite preview --config vite.config.ts --host 0.0.0.0`. It reads
  `PORT` from the environment, so Railway's injected `PORT` is honoured.

> **`VITE_*` variables are build-time.** Vite inlines `import.meta.env.*` into the
> bundle, so the frontend's `VITE_*` variables must be set as **build** variables
> (present during `vite build`). Changing them after a build requires a rebuild.

---

## 4. Environment variables (names only)

Names only — set the values in Railway's Variables tab. "Safe devnet value" is
what to use for this demo.

### api-server

| Variable | Safe devnet value | Notes |
| -------- | ----------------- | ----- |
| `NODE_ENV` | `production` | |
| `PORT` | *(Railway sets it)* | |
| `DATABASE_URL` | the `adadive` database on the demo Postgres | own database |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | devnet RPC |
| `ORACLE_PUBKEY` | the fresh demo oracle public key | must match the oracle's key |
| `SESSION_SECRET` | `openssl rand -base64 48` | **identical** to the oracle's |
| `INTERNAL_API_TOKEN` | `openssl rand -hex 32` | **identical** to the oracle's |
| `WALLET_SESSION_ISSUER` | `adadive-oracle-backend` | must match the oracle |
| `WALLET_SESSION_AUDIENCE` | `adadive-api` | must match the oracle |
| `ALLOWED_ORIGIN` | the frontend's public URL | CORS allow-list, comma-separated |
| `ADMIN_PASSWORD` | any demo password | only guards the waitlist admin |
| `META_API_KEY` | a demo Meta Model API key | **server only** — never in the frontend |
| `META_BASE_URL` | `https://api.meta.ai/v1` | |
| `META_MODEL` | `muse-spark-1.3` | |
| `META_MOCK` | `0` (live) or `1` (no key, fixtures) | `1` runs the whole demo with no Meta key |
| `META_TIMEOUT_MS` | `30000` | |
| `ADVISORY_DAILY_CALL_CAP` | `200` | live Meta calls per UTC day |
| `ADVISORY_RATE_LIMIT_MAX` | `30` | advisory requests per IP per window |
| `ADVISORY_RATE_LIMIT_WINDOW_MS` | `60000` | rate-limit window |
| `PINATA_JWT` | *(optional)* a demo Pinata JWT | only for Pin Files |
| `PINATA_GATEWAY` | *(optional)* leave unset | blank means the default gateway |

### oracle-backend

| Variable | Safe devnet value | Notes |
| -------- | ----------------- | ----- |
| `NODE_ENV` | `production` | |
| `PORT` | *(Railway sets it)* | |
| `DATABASE_URL` | the `adadive_oracle` database | **separate** from the api-server's |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | devnet RPC |
| `ORACLE_SECRET_SOURCE` | `env` | production refuses `local-dev` |
| `ORACLE_KEYPAIR_SECRET` | the fresh demo oracle keypair, as the JSON secret-key array | **never** a production key |
| `SESSION_SECRET_SOURCE` | `env` | |
| `SESSION_SECRET` | the same value as the api-server's | shared, ≥32 bytes |
| `AUTH_REQUIRED` | `true` | production refuses `false` |
| `AUTH_ISSUER` | `adadive-oracle-backend` | must match `WALLET_SESSION_ISSUER` |
| `AUTH_AUDIENCE` | `adadive-api` | must match `WALLET_SESSION_AUDIENCE` |
| `INTERNAL_API_TOKEN` | the same value as the api-server's | shared |
| `API_SERVER_BASE_URL` | the api-server's URL + `/api` | e.g. `https://…/api` |
| `PROVIDER_VERIFICATION_ENABLED` | `false` | the findprovs sweep needs a Kubo node; leave off |
| `PINATA_JWT` | *(optional)* the demo Pinata JWT | |
| `CHALLENGE_WINDOW_SECONDS` | *(optional)* default | |
| `JOB_INTERVAL_MS` | *(optional)* default | |

### frontend

| Variable | Safe devnet value | Notes |
| -------- | ----------------- | ----- |
| `PORT` | *(Railway sets it)* | read by `vite preview` |
| `BASE_PATH` | `/` | |
| `VITE_API_URL` | the api-server's public URL | the SPA's API base |
| `VITE_API_ENDPOINT` | the api-server's public URL + `/api` | alternative API base |
| `VITE_BACKEND_ENDPOINT` | the oracle-backend's public URL | challenge/verify/settle |
| `VITE_RPC_ENDPOINT` | `https://api.devnet.solana.com` | browser RPC |
| `VITE_SOLANA_CLUSTER` | `devnet` | explorer links + sign-in chain id |
| `VITE_ORACLE_PUBKEY` | the fresh demo oracle public key | shown on Pin Files |
| `VITE_DEVNET_DEMO` | `1` | shows the "Devnet demo" banner |

> **No secret on the frontend.** The Meta key, `SESSION_SECRET`,
> `INTERNAL_API_TOKEN` and the oracle keypair live only on the server services.
> `VITE_*` values are compiled into a public bundle — put nothing secret there.

---

## 5. First-deploy order

1. Deploy **Postgres**; create both databases (section 2).
2. Deploy **oracle-backend**. It migrates `adadive_oracle` on startup and listens.
   Check `GET https://<oracle>/health`.
3. Run the **api-server migrate** one-off against `adadive`
   (`pnpm --filter @workspace/api-server run migrate`).
4. Deploy **api-server**. Check `GET https://<api>/api/healthz` → `{"status":"ok"}`.
5. Set `API_SERVER_BASE_URL` on the oracle to the api-server URL (if it was not
   known earlier) and redeploy the oracle.
6. Build and deploy the **frontend** with the `VITE_*` values from section 4.
7. Seed the demo data (section 6).
8. Smoke-test: open the frontend, and confirm
   `GET https://<api>/api/providers/<id>/advisory` answers JSON.

---

## 6. Seed the hosted demo database (guarded, one-off)

The seed script refuses remote databases by default. To seed the **hosted demo**
database you must pass an explicit two-part confirmation:

- `DEMO_SEED_ALLOW_REMOTE=1`, **and**
- `DEMO_SEED_CONFIRM_HOST` set to **exactly** the database host.

It also refuses outright — with no override — if the host matches any production
host listed in the repo docs (`artifacts/api-server/E2E_STATUS.md` and this file):
`aws-0-eu-west-1.pooler.supabase.com`, `db.knaigsdfjfeuaucozoba.supabase.co`,
`workspaceapi-server-production-c05a.up.railway.app`, `adadive.xyz`. And it
refuses `NODE_ENV=production` outright.

Run it from your machine (or a Railway one-off shell) against the **demo**
database, substituting the host you see in the demo Postgres connection string:

```bash
DATABASE_URL='postgres://postgres:<pw>@<demo-db-host>:<port>/adadive' \
DEMO_SEED_ALLOW_REMOTE=1 \
DEMO_SEED_CONFIRM_HOST='<demo-db-host>' \
  pnpm --filter @workspace/scripts run seed:demo-providers
```

The host echo is deliberate: a copy-pasted command cannot be redirected to a
different database by editing only the connection string. It writes six
providers (3 healthy, 2 flaky, 1 new) and is idempotent — re-running deletes the
previous demo rows first. **Do not** point this at the production database; the
production-host guard will refuse, but the intent is that you never try.

---

## 7. Verifying the demo

- `GET https://<api>/api/healthz` → `{"status":"ok"}`.
- `GET https://<oracle>/health` → ok.
- `GET https://<api>/api/providers` → the six seeded providers.
- `GET https://<api>/api/providers/<id>/advisory` → a structured assessment
  (`risk_level`, `reasons`, `evidence_cited`, `uncertain`, `recommended_action`,
  and `demoLimitReached: false`). With `META_MOCK=1` this works with no Meta key.
- The frontend shows the **"Devnet demo"** banner when `VITE_DEVNET_DEMO=1`.

See the root `README.md` → **Try it** for the click path a judge follows.
