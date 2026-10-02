/**
 * Apply the hand-written SQL migrations before `drizzle-kit push` runs.
 *
 * `push` cannot distinguish a column rename from a drop-and-add: a rename
 * expressed only in the Drizzle schema would create the new column empty and
 * drop the old one, discarding its data. The files in `migrations/` are written
 * to be idempotent, so running them against an already-renamed or fresh
 * database is a no-op, and `push` then reconciles everything else.
 *
 * Invoked from the `push`/`push-force` scripts, so it is on the same path that
 * `post-merge.sh` and the API server's `migrate` already use.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set; cannot apply migrations");
  process.exit(1);
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

try {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await pool.query(readFileSync(resolve(dir, file), "utf8"));
    console.log("applied migration", file);
  }
} finally {
  await pool.end();
}
