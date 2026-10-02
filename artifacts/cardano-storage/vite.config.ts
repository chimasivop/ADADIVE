import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT || "5173";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

const apiTarget = process.env.API_URL || "http://localhost:5000";

// The Solana JSON-RPC endpoint the browser reads (`lib/chain.ts`). Defaults to
// the public devnet cluster, matching `SOLANA_CLUSTER`; a local validator would
// be `http://127.0.0.1:8899`. Proxied rather than called cross-origin so the
// page works through a forwarded host without CORS.
const rpcTarget = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// The oracle backend (`lib/backend/endpoint.ts`) — pin verification, the
// challenge-window settle flow and wallet-signature auth. Defaults to the
// port the backend's own dev script binds.
const backendTarget = process.env.BACKEND_URL || "http://localhost:5001";

const proxy = {
  "/api": {
    target: apiTarget,
    changeOrigin: true,
  },
  "/rpc": {
    target: rpcTarget,
    changeOrigin: true,
  },
  // `BackendApi` builds URLs as `<baseUrl>/health`, `/deals`, … with
  // `<baseUrl>` ending in `/backend`, but the backend serves those routes at
  // its root. Strip the prefix here or every call 404s.
  "/backend": {
    target: backendTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/backend/, ""),
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy,
  },
});
