/**
 * Migration runner.
 *
 * Deliberately a few dozen lines rather than a framework: migrations are plain
 * `.sql` files applied in filename order, each in its own transaction, recorded
 * in `schema_migrations`. Running it twice is a no-op. That is the whole
 * contract, and it is enough for a service with one table pair.
 *
 *   npm --prefix backend run migrate
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Pool } from "pg";

import { loadConfig } from "../config";
import { isMainModule } from "../util/isMainModule";
import { createPool } from "./pool";

/**
 * Locate the `migrations/` directory.
 *
 * This cannot be a single `resolve(__dirname, ...)` because the service runs
 * from two different layouts:
 *
 *   source             artifacts/oracle-backend/src/db/migrate.ts
 *                      → artifacts/oracle-backend/migrations   (../migrations
 *                        from the bundled `src/index.ts`, hence the `db/` depth)
 *   compiled           dist/index.mjs
 *                      → dist/migrations, which the build script copies
 *
 * The compiled case is why `build.mjs` copies `migrations/` into `dist/`, and
 * why this probes candidates and, on failure, lists where it looked rather than
 * throwing a bare ENOENT.
 */
export function resolveMigrationsDir(): string {
  const candidates = [
    // Explicit override, for a deployment that ships migrations separately.
    process.env.MIGRATIONS_DIR,
    // Compiled layout: the esbuild bundle is a single file at dist/index.mjs,
    // so `__dirname` is `dist`, and `build.mjs` copies the SQL alongside it.
    resolve(__dirname, "migrations"),
    // Source layout: src/index.ts under tsx/ts-mocha → ../migrations.
    resolve(__dirname, "../migrations"),
    resolve(process.cwd(), "migrations"),
    resolve(process.cwd(), "artifacts/oracle-backend/migrations"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "could not find the migrations directory; looked in:\n  " +
      candidates.join("\n  ") +
      "\nset MIGRATIONS_DIR to point at it explicitly"
  );
}

export interface MigrationResult {
  name: string;
  applied: boolean;
}

/**
 * Apply every pending migration.
 *
 * Each file is hashed; if an already-applied file's hash differs, that is a
 * corruption (someone edited a migration that has run in an environment) and it
 * fails loudly rather than applying a divergent schema.
 */
export async function runMigrations(
  pool: Pool,
  dir: string = resolveMigrationsDir()
): Promise<MigrationResult[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Map<string, string>(
    (
      await pool.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM schema_migrations"
      )
    ).rows.map((r) => [r.name, r.checksum])
  );

  const results: MigrationResult[] = [];

  for (const file of files) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `migration ${file} was already applied but its contents changed ` +
            `(recorded ${previous.slice(0, 12)}, found ${checksum.slice(0, 12)}); ` +
            `add a new migration instead of editing an applied one`
        );
      }
      results.push({ name: file, applied: false });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [file, checksum]
      );
      await client.query("COMMIT");
      results.push({ name: file, applied: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return results;
}

/** Entry point when run directly (`npm run migrate`). */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const results = await runMigrations(pool);
    for (const r of results) {
      console.log(`${r.applied ? "applied" : "already applied"}  ${r.name}`);
    }
    if (results.every((r) => !r.applied)) {
      console.log("schema is up to date");
    }
  } finally {
    await pool.end();
  }
}

if (isMainModule("migrate")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
