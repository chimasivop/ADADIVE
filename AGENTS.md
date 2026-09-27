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
