import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

// Plugins and bundled CJS packages may use `require` to resolve dependencies.
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(artifactDir, "dist");

async function buildAll() {
  rmSync(distDir, { recursive: true, force: true });

  // Bundling (rather than a plain `tsc` emit) is what makes the shared
  // `@workspace/solana-escrow` library usable here: that package ships
  // TypeScript sources with a `workspace` export condition, so a compiled
  // `require()` would try to load `.ts` files at runtime. Inlining them keeps
  // the backend's deal-PDA derivation exactly the code the browser runs, which
  // is the property that makes the oracle find deals the UI initialized.
  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Native modules and packages that read sibling files at runtime cannot be
    // bundled; `pg-native` is the only one this service can reach.
    external: ["*.node", "pg-native"],
    sourcemap: "linked",
    // Express and `pg` are CJS; the banner gives them a `require` in the ESM
    // output, and gives this file `__dirname` so the migration path resolves.
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // `esbuild` emits only JavaScript, so the `.sql` migrations would be absent
  // from `dist/` and the runner would find nothing to apply. Copy them beside
  // the bundle, which is where `resolveMigrationsDir` looks first.
  const migrations = path.resolve(artifactDir, "migrations");
  if (!existsSync(migrations)) {
    throw new Error(`no migrations directory at ${migrations}`);
  }
  mkdirSync(distDir, { recursive: true });
  cpSync(migrations, path.resolve(distDir, "migrations"), { recursive: true });
  console.log(`copied migrations -> ${path.resolve(distDir, "migrations")}`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
