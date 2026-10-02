# Phase 5 handoff — Cardano → Solana migration

Written at commit `9f612a1` on `feat/solana-integration`. Read this with
`SOLANA_MIGRATION.md`, which documents the architecture; this file documents
*where the work stands*.

**This file did not previously exist.** The original task asked for it to be
read if present; it was not, so the migration was assessed by reading the code
and commit history directly. That remains the right approach — if this file and
the code disagree, the code wins.

## 1. Branch and PR state

| | |
| --- | --- |
| Repo | `chimasivop/ADADIVE` |
| Branch | `feat/solana-integration` |
| HEAD | `9f612a145ca2124545d64ed79962e9201d9c5b55` (`9f612a1`) |
| Remote | in sync — remote SHA verified equal to local via the GitHub API |
| Working tree | clean |
| PR | **#11**, `OPEN`, **draft**, base **`main`**, head `feat/solana-integration` @ `9f612a1` |
| PR size | 161 files, +21,115 / −1,345, `mergeable: MERGEABLE` |
| CI | no checks configured on this repo, so nothing to wait on |

Commits on the branch, oldest first:

```
1b8e999  feat: swap Cardano blockchain integration for Solana
3087bda  feat(solana): wire oracle settle flow and finish SOL labelling
a779bdd  Solana migration: refund flow, ADA→SOL rename, full-address fixes
9f612a1  fix(db): make the ADA→SOL column rename impossible to bypass   <- HEAD
```

PR #11 was **not** merged, no new PR was opened, and nothing was pushed to
`ADADIVE-solana` or any other repo.

## 2. Scope status

| | Item | Status |
| --- | --- | --- |
| a | Port the Phase 3 oracle backend | Done — `artifacts/oracle-backend` (auth, deal registration/status, settle, disputes, challenge-window scheduler). 123 tests pass. |
| b | Wallet integration (Wallet Adapter replaces CIP-30) | Done — `WalletContext` uses `@solana/wallet-adapter`; UI reads `CONNECT PHANTOM`. |
| c | On-chain tx building (initialize/settle/refund/cancel) | Done — `programs/adadive_escrow` + `lib/solana-escrow` (14 tests pass). |
| d | Backend-driven settle + challenge-window verification | Done — oracle verifies pin, opens the window, auto-signs; covered by `challengeWindow.test.ts`. |
| e | Deal status wired to the new backend | Done — `DealStatusCard` reads `GET /deals/:id` and the on-chain account. |
| f | Solana address display replaces Cardano | Done — base58 pubkey; `api-zod` explicitly rejects bech32 (11 tests). |
| g | ADA→SOL currency/label changes | Done for code and DB; see the caveat below. |

Caveat on (g): the DB columns were renamed for real, not just labelled —
`providers.total_ada_earned` → `total_sol_earned`, `deals.total_cost_ada` →
`total_cost_sol`. Three **wire-format** names still read `THT` and were
deliberately left: `pricePerEpochTHT`, `totalCostTHT`, `cardanoMetadata`
(plus the `cardano-storage` package name). Renaming those means changing the
OpenAPI spec and regenerating clients. Not done.

Refund is shipped and there is deliberately **no cancel UI**.

## 3. The data-loss fix (committed, `9f612a1`)

`drizzle-kit push` cannot tell a rename from a drop-and-add, so against a
database still holding the ADA columns it would create the SOL columns empty
and drop the ADA ones — destroying every provider's lifetime earnings and every
deal's cost.

Most paths already ran `migrate.mjs` first (which applies
`migrations/0001_rename_ada_columns.sql`). The one gap was the API server's own
`migrate` script, which called `drizzle-kit push --force` directly — and which
also had a pre-existing path bug (`cd ../lib/db` resolves to `artifacts/lib/db`,
which does not exist), so it was failing rather than destroying data. Anyone who
"fixed" that path would have unlocked the destructive behaviour.

Changes:

- `artifacts/api-server/package.json` — `migrate` now `cd ../../lib/db && node
  ./migrate.mjs && drizzle-kit push --force --config ./drizzle.config.ts`.
  Inlined rather than delegated to `pnpm --filter`, because nested `pnpm` is not
  resolvable from inside a package script (`sh: pnpm: not found`).
- `lib/db/drizzle.config.ts` — fail-closed guard. This is the one file *every*
  `drizzle-kit` invocation loads, so no caller can route around it. Spawns the
  probe synchronously (the config bundles as CJS — top-level `await` fails).
- `lib/db/scripts/check-ada-columns.mjs` (new) — read-only catalog probe.
  Exit `0` safe, `3` unsafe, `4` unreachable.
- `lib/db/package.json` — added `check:ada-columns` as a standalone preflight.

Verified against real Postgres, each case starting from a legacy DB holding
`4242` / `1234`: bare `push` and `push --force` are blocked with data intact;
`pnpm --filter db push` (post-merge path), the CI `push-force` path, and the
corrected api-server `migrate` all rename in place with values preserved.
Fresh and empty databases still work. The oracle-backend's separate database is
not falsely blocked. Only one drizzle config exists, so there is no
alternate-config bypass.

**Open item:** `drizzle.config.ts` and `scripts/` are not covered by any
`tsconfig` (`lib/db/tsconfig.json` has `include: ["src"]`, `rootDir: "src"`), so
the guard is not typechecked. It is plain JS-compatible TS and works, but a
future edit has no type safety net.

## 4. Confirmed THT / THETA removal plan — NOT YET IMPLEMENTED

Decision: ADADIVE will have **no token** (Cardano or Solana) for the foreseeable
future. Present the product as a storage marketplace with no token positioning.
Both `THT` (the token) and `THETA` (its branding) come out.

Nothing below has been changed. This is the plan to execute.

### 4a. Delete `artifacts/cardano-storage/src/pages/TokenPage.tsx` (251 lines)

The page is entirely token content (hero, 100M supply donut, distribution chart,
"What THT Powers", "How to Get THT"), so it is deleted outright rather than
stripped. Cascades:

- `App.tsx:15` — remove `import TokenPage from "@/pages/TokenPage";`
- `App.tsx:57` — remove `<Route path="/token" component={TokenPage} />`
- `Landing.tsx:131` — remove `const goToken = () => setLocation("/token");`
  (all five call sites are removed in 4b)
- The page-scoped CSS class `.adadive-token` is defined inside the file
  (lines 12–13), so it goes with it.
- `TokenPage.tsx:137` also holds `THETA TOKEN · POLICY ID: theta1q9...f7a2
  (testnet)` — deleted with the file.

### 4b. Delete `artifacts/cardano-storage/src/lib/token.ts` (10 lines)

Entirely Cardano policy-ID modelling (`policyId` placeholder, `VITE_THT_POLICY_ID`,
`name`/`symbol`/`ticker: "THT"`, `label: a => `${a} THT``). Two consumers:

- `Landing.tsx:4` — `import { THT } from "@/lib/token";` → remove.
- `AppSidebar.tsx:2, 87, 106` — **collateral.** Imports `THT` and renders a
  divider reading `powered by {THT.symbol}`. Change to `powered by SOL`, or drop
  the divider. Needs a call at edit time.

### 4c. `Landing.tsx` — THT/THETA removals (current line numbers)

| Line | Action |
| --- | --- |
| 4 | remove `import { THT } from "@/lib/token";` |
| 153 | `return \`${ada.toFixed(4)} THT\`;` → `SOL` |
| 193 | `by THETA · powered by THT` → `by THETA` (or remove tagline) |
| 200 | remove nav button `THT Token` |
| 220 | remove mobile-nav button `THT Token` |
| 245 | hero copy: drop `earn THT … pay in the same token`, state SOL payment |
| 252 | remove button `THT TOKEN ↗` |
| 260 | stat `THT.label(totalSolLocked)` / label `THT Locked` → SOL + `◎` |
| 294 | step 01 body: `stake THT` → `stake SOL` |
| 295 | step 02 body: `lock THT into escrow` → SOL; `Cardano ledger` → Solana |
| 297 | step 04 title `THT is Released` → `Payment is Released`; body `escrowed THT` → SOL |
| 322 | stat `label:"THT Locked"` + `THT.label(...)` → SOL + `◎` |
| **337–353** | **delete the whole `{/* ─── THT TEASER ─── */}` section** (SectionLabel `Native Token`, floating logo, `THT Token` h2, `THETA · NATIVE CARDANO TOKEN` at 348, "lifeblood" copy at 350, `EXPLORE THT TOKEN →` at 352) |
| 371 | waitlist copy: drop `a THT allocation bonus` |
| 482 | footer `by THETA · powered by THT` → `by THETA` (or remove) |
| 488 | remove footer button `THT Token` |

### 4d. `Landing.tsx` — the 5 approved Cardano→Solana branding fixes

Separate from the THT removals, approved as part of this pass:

| Line | Current | Change to |
| --- | --- | --- |
| 138 | `<title>` `…Decentralised Storage on Cardano` | `…on Solana` |
| 232 | badge `LIVE ON CARDANO PREPROD` | `LIVE ON SOLANA` |
| 296 | `CID is recorded in Cardano metadata` | `recorded on-chain` |
| 466 | heading `Ready to Store on Cardano?` | `Ready to Store on Solana?` |
| 467 | `Connect your Eternl wallet` | `Connect your Solana wallet` |

### 4e. THETA references outside `Landing.tsx` / `TokenPage.tsx`

| Location | Current |
| --- | --- |
| `pages/PinFiles.tsx:668` | `ADADIVE by THETA` |
| `pages/WaitlistAdmin.tsx:205` | `ADADIVE by THETA — waitlist data stored in your Replit PostgreSQL database` |
| `components/layout/AppSidebar.tsx:81` | `by THETA` (plus the `THT` divider at 87/106, see 4b) |

These three were explicitly named for removal. Note they are *also* the only
other places `THETA` appears, so after this pass no `THT`/`THETA` copy should
remain outside the items listed as deliberately kept in §5.

## 5. Deliberately NOT part of the removal

- `pricePerEpochTHT` (`PinFiles.tsx:162` → `api-server` → `lib/storage.ts`) —
  OpenAPI wire-format field. Renaming means spec + client regeneration.
- `totalCostTHT`, `cardanoMetadata` (`api-server/src/lib/storage.ts`) — same
  reason. Both carry SOL values.
- The `cardano-storage` package name — renaming ripples through the workspace,
  lockfile and every `--filter`.
- `WalletContext.tsx` / `chain.ts` doc comments mentioning THT/ADA — historical
  comments, not user-visible copy.
- `public/ADADIVE-Whitepaper-v1.0.pdf` — a binary PDF, contents unverified,
  still linked from the nav. Likely token-heavy. **Needs a human decision.**
- No cancel UI, per the confirmed plan.

## 6. What is committed/pushed vs. pending

**Committed and pushed (`9f612a1`):** the data-loss guard (`drizzle.config.ts`,
`check-ada-columns.mjs`, `lib/db/package.json`, `artifacts/api-server/package.json`)
and the `SOLANA_MIGRATION.md` corrections.

**Pending — nothing is staged or committed for this:**
1. Implement §4a–§4e.
2. **Show the user the diff before committing** — this is copy/marketing
   content and the standing rule on this project is that the user reviews the
   exact removals first.
3. After approval, commit the THT/THETA removal to `feat/solana-integration`
   and push. Do **not** open a new PR or merge to `main`.

Two smaller pending items:
- Decide whether to bring `drizzle.config.ts` / `scripts/` into a `tsconfig`
  (§3 open item).
- Update `SOLANA_MIGRATION.md` §"Copy status" once the THT copy is gone — it
  currently describes THT as still present.

## 7. Environment gotchas for the next session

- **`git push` hangs on a password prompt.** The repo's stored remote URL
  embeds a stale token. Push with the live token inline instead, and do not
  persist it:
  `git push "https://${GITHUB_TOKEN}@github.com/chimasivop/ADADIVE.git" feat/solana-integration`
  `gh` is authenticated separately and works fine for API reads.
- **Nested `pnpm` is not on `PATH`.** `pnpm run x` invoking `pnpm run y` fails
  with `sh: pnpm: not found` unless pnpm is on `PATH` (CI provides it via
  `pnpm/action-setup`; corepack alone is not enough).
- **`pnpm` is only reachable via `corepack pnpm`** in this container.
- **oracle-backend tests need Postgres on port 5433**
  (`postgres://postgres@127.0.0.1:5433/adadive_oracle_test`); the default
  cluster runs on 5432, so the suite fails with `ECONNREFUSED` until a second
  instance is started. That failure is environmental, not a regression.
- **Full suite baseline:** 123 oracle-backend + 14 solana-escrow + 11 api-zod =
  148 passing; workspace typecheck clean.

## 8. Very next step

**Implement the §4 THT/THETA removal, then stop and show the diff before
committing.**

Concretely: delete `TokenPage.tsx` and `lib/token.ts`; remove the
`App.tsx` import/route and `Landing.tsx`'s `goToken`; apply the §4c THT edits,
the §4d Cardano→Solana branding fixes, and the §4e THETA edits; resolve the
`AppSidebar` `THT` divider (4b) and the `by THETA` tagline treatment. Then run
the workspace typecheck and the 148-test suite to confirm nothing regressed —
deleting `lib/token.ts` and `TokenPage.tsx` will surface any missed import as a
typecheck error, which is the intended safety net. Present the diff for review;
commit and push only after approval.
