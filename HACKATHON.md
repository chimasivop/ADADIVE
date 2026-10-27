# Hackathon: Provider Reliability Agent (Meta Model API / Muse Spark)

A **read-only, advisory** agent that turns a provider's existing status data into
a structured reliability assessment using Meta's Muse Spark via the Meta Model
API.

**It only advises.** It never signs transactions, releases funds, or changes a
deal. The escrow program, fee logic and existing auth are untouched.

---

## Baseline

The work sits on top of the tag **`pre-hackathon-baseline`**, created from `main`
before any hackathon change:

```bash
git tag -l pre-hackathon-baseline      # pre-hackathon-baseline
git diff pre-hackathon-baseline --stat # everything this branch adds
```

Branch: **`feat/reliability-agent`**.

---

## What it does

```
                    read-only GET                      POST /v1/chat/completions
 provider rows ──►  /api/internal/provider-reliability/:id  ──►  Muse Spark  ──►  JSON
 (heartbeats,       (or /api/provider/reliability, wallet)       (structured)     assessment
  streaks, at-risk)                                                                │
                                                                                    ▼
                                             { risk_level, reasons[], evidence_cited[],
                                               uncertain[], recommended_action }
```

1. The api-server exposes a **read-only** reliability-evidence route derived from
   data it already has: heartbeat age/staleness, verification streak, at-risk
   flag, active assignments, and a summary.
2. `reliability-agent` fetches that evidence and asks Muse Spark for a
   **structured** assessment, constrained by a JSON Schema.
3. The result is validated with Zod. If it does not validate — or the evidence is
   inconclusive — the answer is `risk_level: "unknown"`. **An inconclusive result
   is not a failure.**

Only provider **status** data is ever sent to the model. Never file contents,
wallet keys or secrets. The one place the wire payload is assembled is
`artifacts/reliability-agent/src/prompt.ts`, so that rule is a property of one
function.

---

## Run it in mock mode (no key, no network)

Mock mode replays recorded API responses (`src/fixtures/*.json`). It runs the
**same** parsing and Zod validation as a live call, so it exercises the real path
and can even fail over to `unknown` on an invalid fixture.

```bash
# Assess a provider by id, from the CLI, with no api-server and no key:
META_MOCK=1 pnpm --filter @workspace/reliability-agent run assess -- \
  --evidence artifacts/reliability-agent/examples/evidence.sample.json

# Or, with the api-server running (evidence fetched over HTTP):
META_MOCK=1 PROVIDER_ID=1 INTERNAL_API_TOKEN=dev-internal-token \
  pnpm --filter @workspace/reliability-agent run assess
```

`--evidence <file>` takes an evidence JSON file, so the advisor can be
demonstrated offline. Fixtures are selected from the evidence
(`healthy` / `flaky` / `no-node`); a recorded `invalid` fixture exists to prove
the fail-safe path.

Exit codes: `0` for any valid assessment (including `unknown`), `2` for a
configuration/usage error, `1` when the evidence could not be fetched.

### Demo data

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/adadive \
  pnpm --filter @workspace/scripts run seed:demo-providers
```

Seeds **3 healthy, 2 flaky, 1 new** provider. The script refuses to run in
production (`NODE_ENV=production`, no override) or against a non-local database
(only `localhost` / `127.0.0.1` / `::1`, unless `ALLOW_DEMO_SEED=1`).

---

## Live mode (needs a real key — not run here)

```bash
META_API_KEY=<your key> INTERNAL_API_TOKEN=<shared token> PROVIDER_ID=1 \
  pnpm --filter @workspace/reliability-agent run assess
```

The key is read **only** from `META_API_KEY` on the server. Never commit it; see
`.env.example`.

Endpoint, auth and model id come from the official Meta Model API docs
(<https://dev.meta.ai/docs>), verified against `/docs/overview`,
`/docs/quickstart` and `/docs/structured-output`:

| Setting          | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Base URL         | `https://api.meta.ai/v1`                                     |
| Auth             | `Authorization: Bearer $META_API_KEY`                        |
| Endpoint         | `POST /v1/chat/completions` (OpenAI-compatible)              |
| Structured output| `response_format: { type: "json_schema", json_schema: {...} }` |
| Model            | `muse-spark-1.3` (the docs' default; override with `META_MODEL`) |

> **Not verified in this environment.** No live call to `api.meta.ai` was made —
> there is no real key here. Everything about the live path is either read from
> the official docs or exercised against a stubbed transport. See "What is
> verified" below.

---

## New files

**`artifacts/reliability-agent/`** — the standalone advisor (mirrors
`artifacts/provider-agent`'s layout; esbuild bundle to `dist/index.mjs`).

| File | Purpose |
| ---- | ------- |
| `package.json`, `tsconfig.json`, `tsconfig.test.json`, `build.mjs` | package + build, repo conventions |
| `src/config.ts` | env config; **refuses to start without a key outside mock mode** |
| `src/logger.ts` | tiny logger (no `pino`); secrets are never logged |
| `src/schema.ts` | the Zod assessment schema + the JSON Schema handed to the model + `unknownAssessment` |
| `src/evidence.ts` | the evidence interface the advisor consumes (mirrors the api-server's) |
| `src/prompt.ts` | the single place the wire payload is assembled (privacy boundary) |
| `src/metaClient.ts` | the real HTTP client + `MetaApiError` + envelope extraction |
| `src/mockClient.ts` | MOCK mode: replays fixtures through the real extraction path |
| `src/fixtures/*.json` | recorded responses: `healthy`, `flaky`, `no-node`, `invalid` |
| `src/assess.ts` | the agent function: evidence in, validated assessment out, total |
| `src/evidenceClient.ts` | read-only GET client (internal token or wallet session) |
| `src/run.ts` | one cycle: fetch evidence → assess |
| `src/index.ts` | CLI entry point |
| `tests/*.test.ts` | schema, fail-safe, mock mode, config, client, run |

**`artifacts/api-server/`** — the read-only evidence source.

| File | Change |
| ---- | ------ |
| `src/lib/reliabilityEvidence.ts` | **new** — evidence shape + pure builder |
| `src/lib/providerStorage.ts` | new store types + `getProviderReliabilitySnapshot` |
| `src/lib/providerStorageDrizzle.ts` | Drizzle implementation of that method |
| `src/routes/provider.ts` | `GET /provider/reliability` (wallet) + `GET /internal/provider-reliability/:id` (shared token) |
| `tests/helpers/memoryStore.ts` | in-memory implementation for the new method |
| `tests/reliabilityEndpoints.test.ts` | **new** — the endpoint tests |

**`scripts/`**

| File | Purpose |
| ---- | ------- |
| `seed-demo-providers.ts` | **new** — 3 healthy / 2 flaky / 1 new, with production + non-local guards |
| `tests/seedDemoProviders.test.ts` | **new** — guard + spec tests |
| `package.json`, `tsconfig.json`, `tsconfig.test.json` | the `scripts` package |

**Root**: `.env.example` (placeholders only), `package.json` (test glob),
`.github/workflows/solana-ci.yml` (new packages), `HACKATHON.md` (this file),
`AGENTS.md` (new section).

---

## What is verified, and what is not

Reported in three separate categories, per the repo's test taxonomy.

### 1. Unit tests — `pnpm test` (no live Meta call, no live Pinata)

- `artifacts/reliability-agent` — schema/validation, the fail-safe path, mock
  mode, config, the HTTP client against a stubbed transport, `runOnce`.
- `artifacts/api-server` — the reliability endpoints over HTTP with `supertest`
  (real router, real auth middleware, in-memory store).
- `scripts` — the seed guards and provider specs (pure, no database).

### 2. Tests that stub an external boundary

The HTTP Meta client tests stub `fetch`; the evidence-client tests stub `fetch`;
the mock-mode tests replay recorded fixtures. These exercise the real parsing,
validation and fail-safe logic, but **no request reaches `api.meta.ai`**.

### 3. Live / opt-in — **not run here**

- **A live Meta Model API call: not run.** No real `META_API_KEY` was available,
  so no request was sent to `api.meta.ai`. The endpoint, auth header, model id
  and structured-output shape were read from the official docs and are pinned by
  tests against a stub — that is not the same as a live call.
- **Live Pinata E2E and the on-chain E2E / cap checks: not run** (unchanged by
  this work).

### Not verified

- The **live** request/response against `api.meta.ai` (no key).
- A **live** end-to-end run against a seeded Postgres + running api-server
  (no Postgres in this environment). The endpoint and the advisor are each
  covered separately; their composition over a real socket was not exercised.
- The `seed-demo-providers.ts` **database writes** (its guards and specs are
  unit-tested; the inserts need a live Postgres).

---

## Safety properties (and where they are enforced)

- **Advisory only.** The advisor has no write path: it issues only `GET`s and
  returns an assessment. It holds no wallet and cannot sign.
- **Read-only endpoints.** `GET /provider/reliability` and
  `GET /internal/provider-reliability/:id` only read; a test asserts no
  mutating method is served on the route.
- **Same auth as existing provider routes.** The wallet route uses
  `requireWalletOrOidcAuth`; the internal route uses the shared
  `INTERNAL_API_TOKEN` and answers `503` when it is unset, so the channel is
  closed rather than open.
- **Status data only.** The evidence carries no wallet address, no file
  contents, no keys; a test asserts the wallet address never appears in the
  serialised evidence.
- **Fail-safe.** A missing client, a transport error, non-JSON output, or output
  that fails Zod validation all return `risk_level: "unknown"` with an explicit
  reason. The agent function never throws.
