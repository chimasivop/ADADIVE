# ADADIVE — agent notes

## Wallet connect (Solana)

`@solana/wallet-adapter-react` only tracks an adapter once one has been
**selected**. `WalletProviderBase` resolves `adapter` from the persisted
`walletName` (localStorage key `walletName`) and binds the adapter's
`connect`/`disconnect` listeners to it. Until `select()` has run it reports
`connected: false` and `publicKey: null` permanently, no matter what the wallet
extension does.

Consequences for this app, which uses a single connect button rather than a
picker modal:

- `contexts/WalletContext.tsx` calls `select(preferred.adapter.name)` on mount
  (only when nothing is already selected) so the context follows the adapter.
- `connect` must call the context's `connect()`, not `wallet.adapter.connect()`
  directly — the direct call bypasses the library's `connecting` state and the
  listener that flips `connected`.
- Avoid letting `WalletNotReadyError` escape from `connect()`: the library's
  default error handler opens `adapter.url` in a new tab. Check
  `readyState === "Installed" | "Loadable"` first and surface an error instead.

Symptoms when this is broken: the extension shows the site as connected, the UI
stays on "CONNECT PHANTOM", and no error appears in the console.

## Wallet-signature auth (api-server and oracle)

The browser signs in once, against the **oracle**, and the resulting bearer
token is accepted by **both** services:

1. `POST :5001/auth/challenge {wallet}` — oracle mints a one-time message.
2. `wallet.signMessage(utf8(message))` — a message, not a transaction.
3. `POST :5001/auth/verify {wallet, nonce, signature}` — oracle verifies over
   the *stored* message and returns an HS256 session token.
4. `Authorization: Bearer <token>` on oracle mutations and on `POST /api/storage/pin`.

Key points that are easy to get wrong:

- **`SESSION_SECRET` must be identical in both services.** The oracle *issues*
  (default source is a per-process ephemeral key — wrong for dev) and the
  api-server only *verifies*; a mismatch fails closed to a 401 with a log line
  `wallet session rejected`. `scripts/dev-up.sh` sets a shared dev value and
  `SESSION_SECRET_SOURCE=env` for the oracle. The token format, base58 codec,
  issuer (`adadive-oracle-backend`) and audience (`adadive-api`) all live in
  `lib/solana-escrow/src/backend/{sessionToken,base58}.ts` and are shared; do
  not copy them.
- **The OIDC `requireAuth` path is dead from the UI.** No `/auth/login` call is
  ever made, so no `sid` cookie is set. Routes still gated by `requireAuth` are
  unreachable from the app. `POST /storage/pin`, `POST /deals`,
  `PATCH /deals/:id` and `POST /providers` are gated by `requireWalletOrOidcAuth`.
  Any further mutating route the frontend needs must be moved the same way; the
  GET routes are unauthenticated by design.
- **Subpath exports need a `paths` entry.** The oracle's `moduleResolution` is
  `node`, which does not read `package.json` `exports`, so
  `tsconfig.json` maps `@workspace/solana-escrow/backend/*` explicitly. The
  api-server ships the package as a dependency (`workspace:*`); the oracle
  already had it.
- **`PINATA_GATEWAY` empty-string trap.** Deployment tooling exports it as `""`
  when unset; `process.env.X ?? default` keeps `""` and produces hostless
  gateway URLs like `/bafy…`. The api-server uses `?.trim() || default`.

Symptom when the secret is missing or mismatched: Pin Files signs successfully
but `POST /api/storage/pin` answers `401 {"error":"Authentication required"}`.

## Testing the frontend without a wallet extension

The headless browser has no extension, so `Installed` adapters never appear. To
exercise the real connect flow, serve a temporary HTML page that injects a fake
`window.phantom.solana` (plus `window.isPhantomInstalled = true`) with the
extension's event shape (`connect`, `disconnect`, `accountChanged`), then load
the real app against it. Delete the harness when done.

## Oracle-backend calls from the browser: `fetch` must be bound

`lib/solana-escrow/src/backend/api.ts` stores the transport as an instance
field and calls it as `this.fetchImpl(...)`. A bare `fetch` reference is then
invoked with the `BackendApi` instance as its receiver, which browsers reject
with `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
Node's `fetch` ignores the receiver, so this never reproduces under mocha or a
`tsx` script — only in a real browser. Bind it
(`globalThis.fetch.bind(globalThis)`) and only when no implementation was
injected, so test stubs are untouched.

Symptom: every oracle-backend call from the UI fails with a message ending in
"Illegal invocation" (e.g. the deal page's Settlement Status card), while the
same request succeeds from `curl`.

## CORS for the preview origin

The preview host is not `localhost`, so `ALLOWED_ORIGIN` must include it or the
browser gets an HTML "Not allowed by CORS" page instead of the API's JSON. The
api-server takes a comma-separated list:

    ALLOWED_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://localhost:12000,https://work-1-<host>.prod-runtime.all-hands.dev,https://work-2-<host>.prod-runtime.all-hands.dev

`POST /api/storage/pin` with a preview `Origin` should answer `401` with
`content-type: application/json` and an `access-control-allow-origin` echoing
that origin — not an HTML `500`.

## Resource-level ownership on api-server deal mutations

`requireWalletOrOidcAuth` proves *identity*, not ownership. Gating a handler with
it only says "a wallet signed in"; it does not say the wallet owns the row the
handler touches. Both deal mutations originally stopped there, so any
authenticated wallet could create a deal naming any `clientAddress` and could
PATCH any deal by id.

The deal's owning wallet is `deals.clientAddress` (there is no wallet-valued
provider column here — `providers.nodeId` holds opaque ids like `pool1abc123`,
not a pubkey). Both handlers now compare `req.walletAddress` to it and answer
`403` on mismatch, mirroring the oracle's settle route
(`req.authenticatedWallet !== deal.provider`). PATCH loads the row first so a
missing deal is still `404` and a present-but-not-owned one is `403`.

Posture, matching the oracle: the check is **skipped when `req.walletAddress` is
`undefined`** (the OIDC path, unreachable from the UI), and enforced whenever a
wallet session is present. When adding another mutating route, remember the
middleware alone is authentication only — add the ownership comparison too.

Note the React client now *does* attach the bearer token: `WalletContext`
registers `setAuthTokenGetter(() => ensureSession())` while a key is connected,
and `custom-fetch` calls the getter only for mutating methods (GET/HEAD are the
public reads and must not trigger a signature prompt). `NewDeal` prefills
`clientAddress` with the connected wallet, and `DealDetail` exposes an
owner-only status control so the PATCH path is reachable. Before that wiring
existed the hooks carried no token and these routes `401`ed from the UI; the
ownership check is still the boundary for direct API callers, so don't read a
passing UI flow as proof the check is unnecessary.

To verify the flow end to end without a wallet extension, drive the real app in
Chromium with a fake `window.phantom.solana` and delegate signing back to Node
(`page.exposeFunction`), because `@solana/wallet-adapter-phantom` needs an
`ed25519` implementation the injected script does not have. Checks that matter:
wallet A creates a deal and the stored `clientAddress` equals A; wallet B's
PATCH is `403` and the UI surfaces it; A's own PATCH is `2xx` (positive control
that the `403` is an ownership decision, not a blanket refusal).

## Test report taxonomy

Do not report one combined pass count. Three categories, and they prove
different things:

1. **Unit tests** — `pnpm test` (oracle-backend `tests/*.test.ts` excluding
   `e2e.live.test.ts`, plus solana-escrow, api-zod, api-server and
   provider-agent). Real Postgres for oracle-backend; the chain is a `FakeChain`
   and the *service* tests stub `verifyPin` directly (they are about
   challenge-window logic). api-server and provider-agent need **no** Postgres:
   the endpoint suite drives the real router with an in-memory store, and the
   agent suite uses fakes for the api-server and the IPFS node.
2. **Tests that stub `verifyPin`** — the service-level suites
   (`api.test.ts`, `auth.test.ts`, `challengeWindow.test.ts`). They exercise the
   window/settle/auth decisions, not Pinata. `pinStatus.test.ts` is the
   exception: it stubs Pinata at the HTTP `fetchImpl` boundary, so it really
   tests the pin check.
3. **Opt-in live Pinata E2E curl check** — the manual, per-route walkthrough
   with a real oracle-issued token (pin → real CID, `POST /providers`,
   `POST /deals`, `PATCH /deals/:id`). Requires real Pinata credentials and a
   running stack; it is not part of `pnpm test`. The oracle's on-chain E2E
   (`npm run test:e2e` in oracle-backend, `tests/e2e.live.test.ts`) is a
   separate opt-in that needs a local validator — also not in `pnpm test`.

Report each category separately so a green unit run is never mistaken for a
live Pinata check that did not run.

A fourth, separate check exists for the ownership rule specifically: a
browser-driven UI E2E (see above) that drives the real app with a fake Phantom
wallet. It is opt-in, needs the frontend + oracle + api-server running, and is
not part of `pnpm test`; report it on its own line, not folded into the unit
count.

The provider-storage suites fit into category 1 (no database, no live node):

- `artifacts/api-server/tests/providerEndpoints.test.ts` — the new endpoints
  over HTTP with `supertest`. The real router and the real
  `requireWalletOrOidcAuth` run; only persistence (in-memory store) and the OIDC
  session lookup are faked. Tokens are minted with the *shared*
  `issueSessionToken`, so a 401 really means the verifier rejected it.
- `artifacts/oracle-backend/tests/{findprovs,providerVerification,providerVerificationService}.test.ts`
  — the findprovs client stubs `fetchImpl` (so parsing and the peer-scoped
  answer are really exercised); the decision rule is pure; the service test
  stubs the feed and the findprovs client.
- `artifacts/provider-agent/tests/*.test.ts` — the poller/heartbeat cycles and
  the wallet sign-in, against fakes for `ProviderApi` and `IpfsNode`.
- `lib/api-zod/tests/providerStorage.test.ts` — the `peerId` validator and the
  new request schemas.

## Provider-run storage layer

An additive second storage path. A provider with no registered node
(`providers.peer_id IS NULL`) keeps the centralized Pinata flow exactly as
before; the provider-agent path only engages once a `peer_id` exists.

- **Schema** (`lib/db/migrations/0002_provider_storage_nodes.sql`) adds
  `providers.peer_id`, `providers.last_heartbeat_at`, `providers.wallet_address`
  and the `deal_assignments` table. The whole migration is wrapped in a
  `DO $$ … $$` block that returns early when `providers`/`deals` do not exist
  yet, because `migrate.mjs` runs *before* `drizzle-kit push` on a fresh
  database — an unguarded `ALTER TABLE providers` fails there with
  `relation "providers" does not exist`. Use `SERIAL`, not `BIGSERIAL`: `push`
  diffs against the Drizzle schema and would "correct" a type mismatch.
  `0003_assignment_negative_streak.sql` adds
  `deal_assignments.consecutive_conclusive_negatives` (`INTEGER NOT NULL
  DEFAULT 0`) and is guarded the same way, for the same reason.
- **api-server** — `routes/provider.ts` exports
  `createProviderStorageRouter(store)`. The handlers depend on the
  `ProviderStorageStore` seam (`lib/providerStorage.ts`), not on `db`, so they
  can be tested without Postgres; production wires `drizzleProviderStorageStore`
  from `routes/index.ts`. Endpoints: `GET /api/provider/assignments`,
  `POST /api/provider/confirm-pin`, `POST /api/provider/heartbeat`,
  `POST /api/providers` (now also sets `peerId`), `PATCH /api/providers/:id/node`,
  plus the token-guarded `GET|PATCH /api/internal/provider-assignments` and
  `PATCH /api/internal/provider-assignments/:id/streak`. The streak route exists
  so a below-threshold conclusive negative can advance the counter *without*
  writing a verdict — the full-verdict route would clear a stored `at_risk`.
- **oracle-backend** — `ipfs/findprovs.ts` (hand-written Kubo client: the oracle
  is CJS and `kubo-rpc-client` is ESM-only), `provider/providerVerification.ts`
  (the pure decision rule), `provider/providerVerificationService.ts`,
  `provider/internalFeed.ts` and `jobs/providerVerificationScheduler.ts`.
  Disabled unless `PROVIDER_VERIFICATION_ENABLED=true`; enabling it *requires*
  `INTERNAL_API_TOKEN`, so a half-configured sweep fails at startup rather than
  401ing every tick. It reads the api-server's feed over HTTP because the two
  services own separate databases (see the wallet-auth notes above).
- **provider-agent** — `artifacts/provider-agent`, a standalone ESM package
  (not part of api-server). It reuses the existing wallet-signature flow via the
  oracle (`/auth/challenge → sign → /auth/verify`), polls assignments, pins on a
  local Kubo node through `kubo-rpc-client`, confirms, and heartbeats. `--once`
  runs a single cycle and exits.
- **The at-risk rule**: a deal is flagged only when the heartbeat is stale
  **and** `findprovs` has conclusively failed to show the peer on
  `consecutiveNegatives` sweeps **in a row** (config
  `PROVIDER_VERIFICATION_CONSECUTIVE_NEGATIVES`, default 3; the running count
  lives on `deal_assignments.consecutive_conclusive_negatives`). An inconclusive
  DHT answer (search hit its limit) never flags; a transport failure is
  `unknown` and leaves the stored state untouched. The flag is explicit
  (`deal_assignments.at_risk` + `verification_detail`), never a silent failure.

  The streak is not belt-and-braces: it is the mitigation for a gap that cannot
  be closed at the transport level. See the findprovs trap below.

Three traps worth knowing before touching this layer:

- **Liveness is per *peer*, not per provider.** A provider may rotate nodes; the
  assignment stays bound to the `peer_id` it was created with (deliberately —
  see the migration comment), so `providers.last_heartbeat_at` alone is wrong:
  a newly-rotated-in node B would keep the row fresh while `findprovs` no longer
  finds A, and A's assignment would read as verified instead of at-risk. The
  heartbeat endpoint therefore stamps `deal_assignments.last_heartbeat_at` for
  every open assignment whose `peer_id` matches the reporting node, and the
  oracle reads *that* (the internal feed exposes it) — not the provider row.
- **Confirm by `assignmentId`, not by CID.** `deals.data_hash` is not unique, so
  a CID-only lookup can resolve to the wrong row. The poll already returns
  `assignmentId`; the agent echoes it and `POST /api/provider/confirm-pin`
  loads that row, checks ownership, then checks the CID matches before
  confirming. A CID-only confirm can leave the intended assignment pending
  forever (or confirm someone else's).
- **Kubo RPC wants its args in the URL query.** `routing/findprovs` takes the
  CID as `arg` and the limit as `num-providers` — hyphenated, in the query
  string, not a form body, and *not* `numProviders` (that is the Go-struct name
  from the library API; Kubo ignores it). Get this wrong and Kubo rejects the
  call for a missing `arg`, which the service records as `unknown`, so no
  verification or at-risk verdict is ever written.
- **A `findprovs` body must be *recognised* before an absence is believed, and a
  query error is not a completed search.** Kubo closes the stream when the search
  ends — there is no final sentinel object, so end-of-stream is EOF. (`FinalPeer`
  and `AddingPeer` exist in go-libp2p's `QueryEventType` enum but kad-dht never
  emits them; real streams carry only `SendingQuery`=0, `PeerResponse`=1,
  `QueryError`=3, `Provider`=4, `Value`=5, `DialingPeer`=7.) So an empty or
  truncated body, an HTML error page served with HTTP 200, or an unrecognised
  framing all parse to zero providers, which is indistinguishable from "the DHT
  answered: nobody has it". The parser therefore tracks two flags rather than one
  "recognised" bit, and they are decided by **event type**, not by whether an id
  is present (`SendingQuery`, `PeerResponse` and `QueryError` all carry an `ID`,
  but there it is the *queried* peer, not a provider):
  - `sawResult` — a `Provider`/`PeerResponse`/`Value` event, or a bare record
    with an id (the simple provider shape). This is the evidence a query ran and
    reported. A `SendingQuery`-only body does *not* count: that is a truncated
    search, not an empty one.
  - `sawError` — a `QueryError` event. kad-dht emits this *per peer* on a failed
    dial, including inside a lookup that otherwise completes, so it is a
    step-level signal; but it is also how a fatal lookup failure is reported, so
    it must not be overridden by an earlier success.

  `isPeerAdvertising` reports `conclusive: false` unless `sawResult && !sawError`,
  so an errors-only payload, a success-then-error payload, a truncated stream
  that never got a response, an unknown event type, an empty body, an HTML page
  or an unrecognised framing can none of them be misread as a conclusive
  negative. A *clean* completed search that genuinely names no providers **is** a
  trustworthy absence — that is the content-gone case the feature exists to
  catch, so do not "fix" it into always-inconclusive. The cost of the
  error-is-fatal rule is that a lookup that tolerated one unreachable peer will
  not flag a vanished provider on that sweep; that is the fail-safe direction
  (never a false at-risk), and the next clean sweep still flags it.

  Ids are collected permissively (any `ID`/`Peer`/`id`, recursing into
  `Responses`) so `providerCount` is "ids seen", not a strict provider count;
  that errs toward `advertising: true`, i.e. toward *not* flagging. Only the
  `sawResult`/`sawError` decision, not the id set, gates conclusiveness.

- **A truncated read is not the same as a completed search — but only *some*
  truncations are visible.** Measured against a real socket (a real chunked
  response, not a stub `Response`), because the distinction is made by undici's
  body reader:
  - A connection cut **mid-body** (before the terminating chunk) *is* detected:
    `response.text()` rejects with `TypeError: terminated`, and the client maps
    that — and a `TimeoutError` from the abort signal, and a `fetch` rejection
    like `TypeError: fetch failed` when the socket dies at the response — to
    `FindProvsTransportError`. This matters beyond tidiness: the service
    re-throws anything that is *not* a transport error, so a bare `TypeError`
    escaping here would abort the whole sweep instead of recording one
    `unknown`. Both the request call and the body read are wrapped for this
    reason; do not unwrap them.
  - A stream that ends **cleanly but early** (a valid terminator, but the search
    never completed) is *not* detectable. The bytes are byte-identical to a
    finished search, and `findprovs` has no terminal sentinel to check, so no
    amount of parser hardening closes this. It is pinned as a test
    (`findprovs.test.ts`, "cannot tell a cleanly-ended-but-early stream…") so it
    is not mistaken for a fix.

  That residual gap is why a *single* conclusive negative is not trusted and the
  decision layer requires `consecutiveNegatives` of them in a row. The streak
  advances only on a conclusive negative, resets to 0 on a conclusive positive,
  and is left untouched by an inconclusive answer or a transport failure (so
  neither a flaky DHT nor a Kubo blip can manufacture or hide a verdict). It is
  persisted even when the verdict is `unknown` (below threshold) via the
  streak-only route, which cannot clear a stored `at_risk`; the full-verdict
  route writes `at_risk` + detail + streak together. Setting
  `PROVIDER_VERIFICATION_CONSECUTIVE_NEGATIVES=1` restores
  flag-on-first-negative for an operator who trusts their Kubo setup.

`dev-up.sh` sets a shared dev `INTERNAL_API_TOKEN` and passes it to both
services, so the internal-feed channel is never open. The oracle's findprovs
sweep is **off by default** there (`PROVIDER_VERIFICATION_ENABLED=false`): it
needs a running Kubo node, and Kubo's default API port (5001) collides with the
oracle's own port in that script. Set `PROVIDER_VERIFICATION_ENABLED=true` and
point `IPFS_API_URL` at a real node to exercise the provider-run path locally —
the script prints those instructions when the sweep is off.

## CI

`.github/workflows/solana-ci.yml` runs on paths touching
`programs/adadive_escrow/**`, `lib/solana-escrow/**`, `lib/api-zod/**`,
`lib/db/**`, or the `artifacts/{oracle-backend,api-server,provider-agent}/**`
packages. Two jobs: `rust` (clippy `-D warnings` + `cargo test --workspace`) and
`typescript` (`solana-escrow` + `oracle-backend`'s `test:ci` + `api-zod` +
`api-server` + `provider-agent`).

`test:ci` is the oracle-backend subset that needs **no Postgres** —
`oracleKeySecurity`, `pinStatus`, `scheduler`, `signature`, plus the new
`findprovs`/`providerVerification`/`providerVerificationService` suites. The
DB-backed suites (`api`, `auth`, `challengeWindow`) are excluded there but still
run in `pnpm test`, which needs a real database. Keep the two lists in sync when
adding a suite: if it uses `makeTestPool`/`makeTestContext`, add an `--ignore` to
`test:ci`; if it does not, leave it in.

`test:e2e` and `test:cap` never run in CI — they need a validator and real time.
The `rust` job gates on `cargo fmt --all --check` too, so run `cargo fmt` before
pushing a Rust change.

## Escrow program keypair: run `dev-up.sh`, never `cargo build-sbf` first

The escrow program id is fixed by `declare_id!`, and deploying needs the
matching keypair. That keypair is gitignored, so it is kept at
`keys/adadive_escrow-keypair.json` and `dev-up.sh` restores it into
`target/deploy/` on demand.

`cargo build-sbf` does **not** read `declare_id!`. If `target/deploy/` has no
keypair it silently generates a fresh random one and writes it there — so
running `cargo build-sbf` before `dev-up.sh` produces a keypair whose address
does not match `declare_id!`, and a deploy with it fails (or worse, deploys
under the wrong id). It will also overwrite a keypair already placed in
`target/deploy/`.

Correct order: `dev-up.sh` first (it seeds `target/deploy/` from `keys/`, then
builds and deploys). If you must build standalone, copy the keypair back before
deploying:

    cp keys/adadive_escrow-keypair.json target/deploy/adadive_escrow-keypair.json

and confirm it matches: `solana-keygen pubkey target/deploy/adadive_escrow-keypair.json`
must equal the `declare_id!` value.

## Per-deal value cap (`PlatformConfig.max_deal_amount`)

`initialize` requires the singleton `PlatformConfig` account and rejects any
deposit above `max_deal_amount` (lamports) with `DealAmountExceedsMax` (6011).
The cap is a config field, not a constant, so `update_config` can raise it
without a redeploy; `initialize_config` takes an `Option<u64>` and falls back to
`DEFAULT_MAX_DEAL_AMOUNT` (10 SOL) when `None`. The comparison is inclusive:
exactly the cap is allowed, one lamport over is rejected. The check is on-chain,
so the client-side preview in `buildInitializeTransaction` is a UX nicety only —
bypassing it still hits the program.

Two consequences when touching this area:

- The instruction signature changed. Any hand-encoded caller must add the
  trailing `Option<u64>` tag to `initialize_config` (`Buffer.from([0])` for
  `None`) and pass the config PDA to `initialize`. `devnet-setup.ts` does this.
- New error variants are appended *after* the existing ones so the numeric codes
  of the v1 errors do not shift under a deployed client.

`test:cap` in oracle-backend (`tests/escrowCap.live.test.ts`) is the opt-in
on-chain proof. It submits raw `initialize` instructions rather than going
through the client builder, so a pass means the *program* enforced the boundary,
not that the client refused early. It needs the same local validator +
`PlatformConfig` as `test:e2e`, and is excluded from `pnpm test`.
