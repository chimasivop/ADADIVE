/**
 * "Was this file the process entry point?"
 *
 * The service runs under two loaders that disagree about the idiom:
 *
 *   - Under `tsx`/`ts-mocha` (dev and tests) files load as CommonJS, where
 *     `require.main === module` is the check and is exact.
 *   - Under the packaged bundle (`node dist/index.mjs`) everything is one ESM
 *     module: two different `isMainModule()` call sites inside it would each
 *     see the same `__filename`, so a path comparison cannot tell them apart.
 *
 * `entryName` is therefore matched against the *filename* of `process.argv[1]`.
 * That is coarser than identity, but it is the only thing that distinguishes
 * the bundle's entries, and the names are distinct: the served entry is
 * `index.mjs` (from `src/index.ts`) and the CLI one `migrate.ts|js`.
 */
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

export function isMainModule(entryName: string): boolean {
  // CommonJS: exact and unambiguous, so prefer it whenever it is available.
  try {
    if (typeof require !== "undefined" && typeof module !== "undefined") {
      return require.main === module;
    }
  } catch {
    // `module` is not defined in ESM output — fall through to the name check.
  }

  const entry = process.argv[1];
  if (!entry) return false;

  return basename(realpathOrSelf(entry)).startsWith(entryName);
}

function realpathOrSelf(p: string): string {
  // The entry may be a symlink (pnpm's `node_modules/.bin`) or relative.
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}
