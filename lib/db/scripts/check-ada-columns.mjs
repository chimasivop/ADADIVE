/**
 * Read-only guard: does this database still have the ADA-era column names?
 *
 * Called from `drizzle.config.ts` before every drizzle-kit command, and usable
 * standalone as a preflight. Exit codes:
 *
 *   0  the rename has been applied (or the tables do not exist yet)
 *   3  unsafe — `total_ada_earned` / `total_cost_ada` are still present
 *   4  the database could not be reached (the caller decides what to do)
 *
 * Kept as a plain `node` script so it can be spawned synchronously from the
 * config, which drizzle-kit bundles as CJS and where top-level `await` is not
 * available.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL is not set; cannot check for ADA-era columns\n");
  process.exit(4);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

let rows;
try {
  ({ rows } = await pool.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name IN (
          'total_ada_earned', 'total_sol_earned',
          'total_cost_ada',   'total_cost_sol'
        )
        AND table_name IN ('providers', 'deals')`
  ));
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  await pool.end().catch(() => {});
  process.exit(4);
}

await pool.end().catch(() => {});

const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
const adaColumns = ["providers.total_ada_earned", "deals.total_cost_ada"].filter((c) =>
  present.has(c)
);
if (adaColumns.length === 0) process.exit(0);

// A database holding both the ADA and the SOL column cannot be repaired
// automatically: `migrate.mjs` only renames when the SOL column is absent, and
// picking a winner here would mean dropping a column and its data. Fail loudly
// and let a human decide.
const bothPresent = [
  ["providers.total_ada_earned", "providers.total_sol_earned"],
  ["deals.total_cost_ada", "deals.total_cost_sol"],
].filter(([ada, sol]) => present.has(ada) && present.has(sol));

const guidance =
  bothPresent.length > 0
    ? [
        "This database has both the ADA-era and the SOL column for:",
        `  ${bothPresent.map(([ada, sol]) => `${ada} + ${sol}`).join(", ")}`,
        "",
        "That is a partially-applied state the migration will not guess at, because",
        "resolving it means dropping one column and its data. Inspect the two",
        "columns, copy across anything the SOL column is missing, drop the ADA",
        "column by hand, then re-run:",
      ]
    : [
        "`drizzle-kit push` treats a rename as a drop-and-add, so it would create",
        "the SOL columns empty and drop the ADA ones, destroying provider earnings",
        "and deal costs. Apply the data-preserving migration first:",
      ];

process.stdout.write(
  [
    `Refusing to run drizzle-kit: the database still has ADA-era columns (${adaColumns.join(", ")}).`,
    "",
    ...guidance,
    "",
    "  pnpm --filter @workspace/db run push        # migrate.mjs, then push",
    "",
    "If this ran via a package's own `migrate` script, that script is bypassing",
    "`migrate.mjs`; point it at `pnpm --filter @workspace/db run push`.",
    "",
  ].join("\n")
);
process.exit(3);
