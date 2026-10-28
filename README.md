# ADADIVE

A decentralized storage economy on Solana: an Anchor escrow program
(`programs/adadive_escrow`), an oracle backend that runs the challenge window and
settles deals, an api-server that fronts IPFS pinning and provider data, and a
React SPA (`artifacts/cardano-storage`).

The current hackathon feature is the **Provider Reliability Agent** — a
read-only, advisory agent that turns provider status data into a structured
reliability assessment via the Meta Model API (Muse Spark). See `HACKATHON.md`
for the design and `DEPLOY.md` to stand up a hosted devnet demo.

## Try it

A judge can see the reliability panel in about two minutes, against **devnet**
(no real funds). You need the [Phantom](https://phantom.app) browser extension.

### 1. Point Phantom at devnet

1. Open Phantom → **Settings** (gear icon) → **Developer Settings**.
2. Turn on **Testnet Mode** and choose **Solana Devnet**.
   (Phantom labels this "Change Network" on some versions; pick **Devnet**.)

### 2. Get devnet SOL

Devnet SOL is free and worthless; you need a little to connect and create deals.

1. In Phantom, copy your wallet address.
2. Go to https://faucet.solana.com, paste the address, select **Devnet**, and
   request an airdrop (1 SOL is plenty).
3. Wait a few seconds and confirm Phantom shows a devnet balance.

### 3. Open the demo and connect

1. Open the demo URL (the frontend from `DEPLOY.md`). You should see the
   **DEVNET DEMO** banner at the top — that confirms you are on the demo build,
   not production.
2. Click **Connect** (the button reads "CONNECT PHANTOM" until a wallet is
   connected) and approve the connection in Phantom. The button switches to your
   shortened address.

### 4. Walk the click path to the reliability panel

1. In the left sidebar, click **Providers**. The directory lists the six seeded
   demo providers, each with a small reliability **badge** (Low risk / High risk
   / Unknown) next to its name.
2. Click a provider — pick **Demo Flaky One** or **Demo Flaky Two** to see a
   risk assessment with reasons.
3. On the provider detail page, scroll to the **Reliability Advisor** panel. It
   shows:
   - the **risk level** badge (e.g. `HIGH`),
   - **REASONS** — why the advisor reached that level,
   - **EVIDENCE CITED** — the concrete signals it used,
   - **UNCERTAIN** — what it could not tell,
   - **RECOMMENDED ACTION** — advice for a human (it is text; the panel has no
     button that signs, releases funds or changes a deal),
   - the disclaimer **"AI advisory, not a guarantee"**.
4. Click the **refresh** icon in the panel header to ask for a fresh
   assessment. If the hosted demo's daily live-call budget is spent, the panel
   shows a **"Demo limit reached"** note and serves the cached or sample
   assessment instead of failing.
5. Try **Demo New Provider**: it has no node and no assignments, so the advisor
   honestly reports **Unknown** with a "not enough evidence to judge yet" note —
   it never guesses.

That is the whole feature: provider status in, a structured, clearly-advisory
reliability assessment out.

### If the advisor panel is hidden

The panel hides itself when the advisor is not configured (no Meta key and mock
mode off) — this is a normal state, not an error. On the hosted demo it is
configured; if you are running locally, start the api-server with `META_MOCK=1`
to run the whole feature with no key and no network.

## Where things live

| Path | What |
| ---- | ---- |
| `programs/adadive_escrow` | Anchor escrow program |
| `artifacts/oracle-backend` | Oracle: auth, challenge window, settle, findprovs sweep |
| `artifacts/api-server` | HTTP API, IPFS pinning, the advisory route |
| `artifacts/cardano-storage` | The React SPA |
| `artifacts/reliability-agent` | The advisory agent package (model client, prompt, schema) |
| `artifacts/provider-agent` | The provider-run storage agent |
| `scripts/dev-up.sh` | Bring the whole stack up locally |
| `DEPLOY.md` | Deploy the hosted devnet demo |
| `HACKATHON.md` | The reliability-agent design and verification notes |
