/**
 * Bundle the reliability advisor to `dist/index.mjs` with esbuild, mirroring the
 * api-server's, oracle-backend's and provider-agent's build scripts. Only `zod`
 * is imported, and it is bundled.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: ["*.node"],
    sourcemap: "linked",
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
globalThis.require = __bannerCrReq(import.meta.url);
      `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
