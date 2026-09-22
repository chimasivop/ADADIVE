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
