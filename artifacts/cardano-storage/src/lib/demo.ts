/**
 * Build-time flags for the hosted devnet demo.
 *
 * `VITE_DEVNET_DEMO` is set on the demo's frontend build (see `DEPLOY.md`). It
 * only turns on a visible banner that says the app is running against Solana
 * devnet with demo data — it changes no behaviour, so a build without it is
 * byte-for-byte the normal app plus the absence of a banner.
 *
 * Vite inlines `import.meta.env.*` at build time, so this is a constant in the
 * bundle, not a runtime lookup.
 */
function enabled(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** True when this build is the hosted devnet demo. */
export const DEVNET_DEMO = enabled(import.meta.env.VITE_DEVNET_DEMO);
