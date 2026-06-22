---
name: testing-cardano-storage-frontend
description: Run and test the ADADIVE cardano-storage React SPA locally. Use when verifying landing-page UI, nav/footer links, static assets, or other frontend changes.
---

# Testing the ADADIVE frontend (cardano-storage SPA)

The user-facing app lives in `artifacts/cardano-storage` (React 19 + Vite 7 + Wouter, pnpm workspace monorepo). The marketing landing page is `src/pages/Landing.tsx`; the in-app routes (Dashboard, Providers, Deals, etc.) are under the `Shell` in `src/App.tsx`.

## Setup

```bash
# from repo root
pnpm install
# run the frontend dev server (defaults to port 5173)
cd artifacts/cardano-storage && PORT=5173 pnpm run dev
```

Then open `http://localhost:5173/`. Routes: `/` (Landing), `/token` (TokenPage), `/app`, `/providers`, `/deals`, `/pin`, etc.

Verify changes compile before/after UI testing:
```bash
pnpm run typecheck   # full monorepo typecheck
pnpm run build       # typecheck + build all packages
```

## Notes / gotchas

- **Backend is optional for static UI tests.** The landing page calls the waitlist API, but link/asset/layout tests don't need the API server or `DATABASE_URL`. Only run the API (`pnpm --filter @workspace/api-server run dev`, port 5000) when testing data-driven flows; the Vite dev server proxies `/api` to `http://localhost:5000`.
- **Static assets** (PDFs, images, robots.txt) go in `artifacts/cardano-storage/public/` and are served at the site root, e.g. `/ADADIVE-Whitepaper-v1.0.pdf`. Reference them with `${import.meta.env.BASE_URL}<file>` so the configurable base path (`BASE_PATH` env) is respected. Quick check: `curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:5173/<file>`.
- **Landing stats are hardcoded** marketing figures (36 TB, 5 providers, etc.) in `Landing.tsx`, not live data — don't treat them as API output when testing.
- The DOM returned alongside browser screenshots is useful for asserting link `href`s directly (e.g. confirm `<a href="/ADADIVE-Whitepaper-v1.0.pdf">`).
- No CI is configured on the repo as of this writing; rely on local `pnpm run typecheck` / `build` as the gate.

## Devin Secrets Needed

- None for static landing-page UI testing.
- For full data-driven flows: `DATABASE_URL` (Postgres), and `PINATA_API_KEY`/`PINATA_API_SECRET` for the storage/pin upload flow.
