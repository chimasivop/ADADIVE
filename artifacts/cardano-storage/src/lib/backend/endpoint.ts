/**
 * The browser-side oracle-backend endpoint.
 *
 * `@workspace/solana-escrow/backend`'s `BackendApi` takes a `baseUrl` and
 * defaults to a relative `/backend` path so it hits Vite's proxy (see
 * `vite.config.ts`) and works whether the page is opened locally or through a
 * forwarded host. `VITE_BACKEND_ENDPOINT` overrides it to talk to a deployed
 * backend directly without the proxy.
 *
 * This lives in its own module, and not inside the shared package, because the
 * shared package is also imported by the Node-run oracle backend where
 * `import.meta` is not available the same way.
 */
const override = import.meta.env.VITE_BACKEND_ENDPOINT as string | undefined;

export const BACKEND_ENDPOINT =
  override && override.length > 0
    ? override.replace(/\/+$/, "")
    : `${window.location.origin}/backend`;

/**
 * The browser-side api-server endpoint.
 *
 * A different service from the oracle above: this is the `/api` proxy in
 * `vite.config.ts`, which fronts the api-server (pinning, providers, stats). It
 * is a separate constant because the two live on different bases — the oracle
 * is `/backend` with the prefix stripped by the proxy, the api-server keeps its
 * `/api` prefix.
 *
 * `VITE_API_ENDPOINT` overrides it to talk to a deployed api-server directly.
 */
const apiOverride = import.meta.env.VITE_API_ENDPOINT as string | undefined;

export const API_ENDPOINT =
  apiOverride && apiOverride.length > 0
    ? apiOverride.replace(/\/+$/, "")
    : `${window.location.origin}/api`;
