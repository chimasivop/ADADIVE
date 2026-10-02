import { defineConfig } from "drizzle-kit";
import { spawnSync } from "node:child_process";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * Refuse to run `drizzle-kit` against a database that still has the ADA-era
 * column names.
 *
 * `push` cannot tell a column rename from a drop-and-add, so it would create
 * `total_sol_earned` / `total_cost_sol` empty and drop `total_ada_earned` /
 * `total_cost_ada`, discarding every provider's lifetime earnings and every
 * deal's cost. `migrations/0001_rename_ada_columns.sql` renames in place
 * instead, and `migrate.mjs` applies it before `push` runs.
 *
 * The check lives here, in the config, because this is the one file *every*
 * `drizzle-kit` invocation loads — `push`, `push-force`, `generate`, `studio`
 * and `migrate` alike. Putting it here rather than in a script means no caller
 * can route around it: a new package script, a shell one-liner, or a CI step
 * all hit this same guard.
 *
 * The probe runs before drizzle-kit diffs anything, so an unsafe invocation
 * fails loudly instead of silently reporting a rename as a drop-and-add. It is
 * a read-only catalog query, so it is safe to run on every invocation, and it
 * is spawned synchronously because the config is bundled as CJS (no top-level
 * `await`). `adadive_escrow` is not checked: it is a separate program with its
 * own migrations.
 */
function assertAdaColumnsMigrated(): void {
  const probe = path.join(__dirname, "scripts", "check-ada-columns.mjs");
  const result = spawnSync(process.execPath, [probe], {
    cwd: __dirname,
    env: process.env,
    encoding: "utf8",
  });

  // 3 = unsafe: the rename has not been applied.
  if (result.status === 3) {
    throw new Error(
      (result.stdout || "").trim() ||
        "ADA-era columns are present; apply the migration before running drizzle-kit"
    );
  }
  // 4 = the probe could not reach the database. Let drizzle-kit try; it will
  // fail on its own connection and report a real error rather than ours.
  if (result.status === 4) {
    process.stderr.write(
      `warning: could not verify ADA-era columns before drizzle-kit ran: ${
        (result.stderr || "").trim()
      }\n`
    );
    return;
  }
  if (result.status !== 0) {
    throw new Error(
      `the ADA-column guard failed unexpectedly (exit ${result.status}): ${
        (result.stderr || result.stdout || "").trim()
      }`
    );
  }
}

assertAdaColumnsMigrated();

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  },
});
