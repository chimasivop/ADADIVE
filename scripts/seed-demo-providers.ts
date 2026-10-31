/**
 * Seed six demo providers for the reliability advisor and the provider
 * recommendation:
 * three healthy, two flaky, one new.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/adadive \
 *     pnpm --filter @workspace/scripts run seed:demo-providers -- --confirm
 *
 * The `--confirm` flag is required. Without it the script prints what it would
 * do and exits without opening a connection, so a copy-pasted command cannot
 * write rows by accident.
 *
 * ## Safety
 *
 * This writes rows, so it refuses to run anywhere that looks like production:
 *
 *   - `NODE_ENV=production` is refused outright.
 *   - a non-local database host is refused (only `localhost`, `127.0.0.1` and
 *     `::1` are accepted).
 *   - a host the repo docs name as production is refused outright, with no
 *     override.
 *
 * Seeding a deliberately disposable *remote* demo database (the hosted demo) is
 * possible, but only through an explicit, two-part confirmation: set BOTH
 * `DEMO_SEED_ALLOW_REMOTE=1` AND `DEMO_SEED_CONFIRM_HOST` to exactly the
 * database host. The host echo is deliberate: a copy-pasted command cannot be
 * redirected to a different database by editing only the connection string.
 * `ALLOW_DEMO_SEED=1` remains as the blunt escape hatch for a local-but-not-
 * loopback dev database; neither override unlocks a production host.
 *
 * `--allow-host=<host>` is the CLI equivalent of the host echo: it unlocks one
 * remote host, and only when it equals the parsed host exactly. It is checked
 * *after* the production-host check, so it can never unlock a `PRODUCTION_HOSTS`
 * entry.
 *
 * ## Cleaning up
 *
 * `--clean` deletes the demo rows and nothing else (the same `node_id LIKE
 * 'demo-%'` filter the seeder uses). It takes the same guards as seeding:
 * `--confirm` to actually delete, and `--allow-host` (or the env override) for a
 * remote host. Without `--confirm` it is a dry run: it opens a connection only to
 * count the demo rows that *would* be deleted, prints that count, and deletes
 * nothing.
 *
 * ## Idempotence
 *
 * Demo rows are identified by a `demo-` prefix on `node_id` (and the matching
 * wallet). Re-running the script deletes the previous demo rows first — the
 * `deal_assignments` and `deals` rows cascade from `providers` — so the script
 * converges on the same six providers rather than piling up duplicates. Only
 * rows whose `node_id` starts with `demo-` are ever deleted or written, so a
 * real provider is never touched.
 *
 * ## What each provider looks like
 *
 *   - healthy: a registered node with a fresh heartbeat, confirmed assignments,
 *     no at-risk flag, zero streak, ample capacity.
 *   - flaky:   a registered node with a stale heartbeat and assignments the
 *     oracle has flagged at-risk with a full consecutive-negative streak.
 *   - new:     no registered node, no heartbeat, no assignments — so the advisor
 *     has nothing to judge and should answer `unknown`.
 *
 * Capacity and price vary across the six so the recommendation ranking has
 * something to order (a provider that cannot fit a deal is filtered out, and a
 * cheaper one scores higher on price fit).
 */

import pg from "pg";
// Pure library, no database at load: `like` builds the `demo-%` predicate the
// seeder and the cleanup share, and `SQL` is its type. (Unlike `@workspace/db`,
// importing this does not require DATABASE_URL.)
import { like, type SQL } from "drizzle-orm";
// Type-only: erased at compile time, so importing this module does not load
// `@workspace/db` (which requires DATABASE_URL at load). The real import is
// dynamic, inside `seed()`, so the exported guards and specs stay pure and can
// be unit-tested with no database.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as DbSchema from "@workspace/db";

const { Pool } = pg;

type SeedDatabase = NodePgDatabase<typeof DbSchema>;

const DEMO_PREFIX = "demo-";

/** Valid 32-byte base58 Solana public keys, deterministic per role. */
const WALLET = {
  healthy1: "HqMwfGWE4q4LLrJuvL87X2EMmLxxDTKUVM6JiUSgmQMi",
  healthy2: "CnMy4BhXa8KRsJrNrvuyZS6aTY9yygvVmHKdfYVg7Sc9",
  healthy3: "3FfChWFb8SfzKbhvtF81KbFCw1pD2JZzvD1LtLPaqiG2",
  flaky1: "9yC5fg3vzipwvPps1VAzoUgS2MQ2BHZc6Bbi5TatRAZB",
  flaky2: "GdiaiDajaFTqcvntbK7gMADsENq6ThCrmjg5hDVTEXBm",
  new1: "2q48WGXcwaSPp3NXyBVYdVpcoxD4SJfqaXCxAmTDdvd5",
} as const;

/** Valid libp2p peer ids (base58, `12D3Koo…` inline-key form). */
const PEER = {
  healthy1: "12D3KooWJbGQVJvGzS8m5cJvV5zZ5s4v1tQbJ3xQ5cZ8mFkQ9rQW3dG7hZ2xY",
  healthy2: "12D3KooWCnMy4BhXa8KRsJrNrvuyZS6aTY9yygvVmHKdfYVg7Sc9QqQ9wErT5",
  healthy3: "12D3KooW3FfChWFb8SfzKbhvtF81KbFCw1pD2JZzvD1LtLPaqiG2MmNn4bVc",
  flaky1: "12D3KooW9yC5fg3vzipwvPps1VAzoUgS2MQ2BHZc6Bbi5TatRAZBHhJj3kLm",
  flaky2: "12D3KooWGdiaiDajaFTqcvntbK7gMADsENq6ThCrmjg5hDVTEXBmPpQq7rSt",
} as const;

/** A CID that is plausibly valid for `data_hash` (CIDv1, `bafy…`). */
const CID = "bafybeigdyrzt5k5c5w3z2s4o5tq7vw3h4k5r6m7n8p9q0r1s2t3u4v5w6x7y";

const MINUTE = 60_000;

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedGuardError";
  }
}

/**
 * The bare hostname of a database URL, or `null` when it cannot be parsed.
 *
 * Node keeps the brackets on an IPv6 literal, so `[::1]` is unwrapped; an empty
 * host (a URL with no host at all) also returns `null`.
 */
export function databaseHost(databaseUrl: string): string | null {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare.length > 0 ? bare : null;
}

/**
 * Hosts the repo's own documentation names as production. Seeding any of these
 * is refused with no override: they are the deployed demo/production database,
 * and a demo seeder pointed at one is a foot-gun, not a feature.
 *
 * Source: `artifacts/api-server/E2E_STATUS.md` (the Supabase session pooler) and
 * the Railway production api-server host. Keep this list in sync when the
 * deployment moves.
 */
export const PRODUCTION_HOSTS: readonly string[] = [
  "aws-0-eu-west-1.pooler.supabase.com",
  "db.knaigsdfjfeuaucozoba.supabase.co",
  "workspaceapi-server-production-c05a.up.railway.app",
  "adadive.xyz",
];

/** Is this host one the docs name as production? */
export function isProductionHost(host: string | null): boolean {
  if (host === null) return false;
  return PRODUCTION_HOSTS.some(
    (prod) => host === prod || host.endsWith(`.${prod}`)
  );
}

/** `localhost`, `127.0.0.1` and `::1` are local; nothing else is. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  const bare = databaseHost(databaseUrl);
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

/** True for `1`/`true`/`yes` (any case); anything else is false. */
function flagEnabled(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Refuse anything that is not an obvious local development database, unless the
 * caller proves it means a specific remote demo database.
 *
 * Guards, in order:
 *
 *   1. `NODE_ENV=production` is refused with no override.
 *   2. A host named as production in the repo docs is refused with no override.
 *   3. A local host is allowed.
 *   4. A remote host needs EITHER the two-part demo override
 *      (`DEMO_SEED_ALLOW_REMOTE=1` AND `DEMO_SEED_CONFIRM_HOST` equal to the
 *      database host), the CLI host echo `allowHost` (the `--allow-host=<host>`
 *      flag, equal to the database host), OR the blunt `ALLOW_DEMO_SEED=1`
 *      escape hatch.
 *
 * The `allowHost` check sits *after* the production check on purpose: a
 * `--allow-host` naming a `PRODUCTION_HOSTS` entry is still refused, so the flag
 * can never unlock a documented production database.
 */
export function assertSeedable(
  env: NodeJS.ProcessEnv,
  databaseUrl: string,
  allowHost: string | null = null
): void {
  if (env.NODE_ENV === "production") {
    throw new SeedGuardError(
      "refusing to seed demo providers with NODE_ENV=production; this script " +
        "writes rows and is for local development only"
    );
  }

  const host = databaseHost(databaseUrl);
  if (isProductionHost(host)) {
    throw new SeedGuardError(
      `refusing to seed demo providers against a production host (${host}); ` +
        "this is a documented production database and cannot be seeded, with " +
        "or without an override"
    );
  }

  if (isLocalDatabaseUrl(databaseUrl)) return;

  // The CLI host echo. Exact match only, and only after the production check.
  if (allowHost !== null && host !== null && allowHost === host) return;

  const confirmHost = (env.DEMO_SEED_CONFIRM_HOST ?? "").trim();
  if (flagEnabled(env.DEMO_SEED_ALLOW_REMOTE)) {
    if (confirmHost.length === 0) {
      throw new SeedGuardError(
        "DEMO_SEED_ALLOW_REMOTE=1 also requires DEMO_SEED_CONFIRM_HOST to be " +
          `set to exactly the database host (${safeHost(databaseUrl)})`
      );
    }
    if (host === null || confirmHost !== host) {
      throw new SeedGuardError(
        "refusing to seed a remote database: DEMO_SEED_CONFIRM_HOST " +
          `(${confirmHost}) does not match the database host (${host ?? "unknown"})`
      );
    }
    return;
  }

  if (flagEnabled(env.ALLOW_DEMO_SEED)) return;

  throw new SeedGuardError(
    "refusing to seed demo providers against a non-local database " +
      `(${safeHost(databaseUrl)}); for the hosted demo set both ` +
      "DEMO_SEED_ALLOW_REMOTE=1 and DEMO_SEED_CONFIRM_HOST=<database host>, or " +
      "set ALLOW_DEMO_SEED=1 only if you are sure this is a disposable " +
      "development database"
  );
}

function safeHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

interface DemoSpec {
  nodeId: string;
  name: string;
  wallet: string;
  region: string;
  reputationScore: number;
  uptimePercent: number;
  /** Total storage the provider advertises, in GB. */
  totalStorageGb: number;
  /** Storage already committed, in GB. */
  usedStorageGb: number;
  /** Price in SOL per GB per epoch. */
  pricePerGbPerEpoch: number;
  peerId: string | null;
  /** Heartbeat age in ms, or `null` for "never reported". */
  heartbeatAgeMs: number | null;
  assignments: Array<{
    status: "assigned" | "confirmed";
    atRisk: boolean;
    streak: number;
    detail: string | null;
  }>;
}

export function demoSpecs(now: Date): DemoSpec[] {
  const healthyAssignment = {
    status: "confirmed" as const,
    atRisk: false,
    streak: 0,
    detail: "peer is advertising the content",
  };
  return [
    {
      nodeId: `${DEMO_PREFIX}healthy-1`,
      name: "Demo Healthy One",
      wallet: WALLET.healthy1,
      region: "eu-west",
      reputationScore: 100,
      uptimePercent: 99.95,
      totalStorageGb: 2000,
      usedStorageGb: 200,
      pricePerGbPerEpoch: 0.0011,
      peerId: PEER.healthy1,
      heartbeatAgeMs: 30_000,
      assignments: [healthyAssignment, healthyAssignment],
    },
    {
      nodeId: `${DEMO_PREFIX}healthy-2`,
      name: "Demo Healthy Two",
      wallet: WALLET.healthy2,
      region: "us-east",
      reputationScore: 98,
      uptimePercent: 99.8,
      totalStorageGb: 1500,
      usedStorageGb: 100,
      pricePerGbPerEpoch: 0.0016,
      peerId: PEER.healthy2,
      heartbeatAgeMs: 45_000,
      assignments: [healthyAssignment],
    },
    {
      nodeId: `${DEMO_PREFIX}healthy-3`,
      name: "Demo Healthy Three",
      wallet: WALLET.healthy3,
      region: "ap-south",
      reputationScore: 96,
      uptimePercent: 99.5,
      // Deliberately small: a large deal filters this one out, which is the
      // capacity filter the recommendation demonstrates.
      totalStorageGb: 120,
      usedStorageGb: 20,
      pricePerGbPerEpoch: 0.0013,
      peerId: PEER.healthy3,
      heartbeatAgeMs: 20_000,
      assignments: [healthyAssignment],
    },
    {
      nodeId: `${DEMO_PREFIX}flaky-1`,
      name: "Demo Flaky One",
      wallet: WALLET.flaky1,
      region: "eu-central",
      reputationScore: 62,
      uptimePercent: 87.2,
      totalStorageGb: 1000,
      usedStorageGb: 0,
      pricePerGbPerEpoch: 0.0009,
      peerId: PEER.flaky1,
      heartbeatAgeMs: 30 * MINUTE,
      assignments: [
        {
          status: "assigned",
          atRisk: true,
          streak: 3,
          detail:
            "heartbeat is stale (1800s old) and the DHT shows no provider for " +
            "the CID (conclusive negative 3/3 sweeps in a row)",
        },
      ],
    },
    {
      nodeId: `${DEMO_PREFIX}flaky-2`,
      name: "Demo Flaky Two",
      wallet: WALLET.flaky2,
      region: "us-west",
      reputationScore: 70,
      uptimePercent: 90.1,
      totalStorageGb: 1000,
      usedStorageGb: 0,
      pricePerGbPerEpoch: 0.0012,
      peerId: PEER.flaky2,
      heartbeatAgeMs: 12 * MINUTE,
      assignments: [
        {
          status: "assigned",
          atRisk: true,
          streak: 3,
          detail:
            "heartbeat is stale (720s old) and the DHT shows no provider for " +
            "the CID (conclusive negative 3/3 sweeps in a row)",
        },
      ],
    },
    {
      nodeId: `${DEMO_PREFIX}new-1`,
      name: "Demo New Provider",
      wallet: WALLET.new1,
      region: "us-east",
      reputationScore: 100,
      uptimePercent: 100,
      totalStorageGb: 1000,
      usedStorageGb: 0,
      pricePerGbPerEpoch: 0.001,
      // No node, no heartbeat, no assignments: nothing to judge.
      peerId: null,
      heartbeatAgeMs: null,
      assignments: [],
    },
  ];
}

/**
 * The predicate that identifies the seeder's own rows: `node_id LIKE 'demo-%'`.
 * Takes the `node_id` column and is exported so a test can prove it matches only
 * `demo-` rows — never a real provider — without a database.
 */
export function demoRowFilter(nodeId: unknown): SQL {
  return like(nodeId as never, `${DEMO_PREFIX}%`);
}

/** Delete prior demo rows (cascades to deals and assignments). */
async function clearDemoRows(db: SeedDatabase): Promise<void> {
  const { providersTable } = await import("@workspace/db");
  await db.delete(providersTable).where(demoRowFilter(providersTable.nodeId));
}

/** How many demo rows exist right now (for the `--clean` dry run). */
async function countDemoRows(db: SeedDatabase): Promise<number> {
  const { providersTable } = await import("@workspace/db");
  const { count } = await import("drizzle-orm");
  const [row] = await db
    .select({ value: count() })
    .from(providersTable)
    .where(demoRowFilter(providersTable.nodeId));
  return row?.value ?? 0;
}

export interface SeedResult {
  providers: number;
  deals: number;
  assignments: number;
}

/** Insert the demo providers (and their deals/assignments). Exported for tests. */
export async function seed(
  db: SeedDatabase,
  now: Date = new Date()
): Promise<SeedResult> {
  const { providersTable, dealsTable, dealAssignmentsTable } = await import(
    "@workspace/db"
  );
  await clearDemoRows(db);

  const result: SeedResult = { providers: 0, deals: 0, assignments: 0 };

  for (const spec of demoSpecs(now)) {
    const lastHeartbeatAt =
      spec.heartbeatAgeMs === null ? null : new Date(now.getTime() - spec.heartbeatAgeMs);

    const [provider] = await db
      .insert(providersTable)
      .values({
        name: spec.name,
        nodeId: spec.nodeId,
        totalStorageGb: spec.totalStorageGb,
        usedStorageGb: spec.usedStorageGb,
        pricePerGbPerEpoch: spec.pricePerGbPerEpoch,
        region: spec.region,
        status: "active",
        reputationScore: spec.reputationScore,
        uptimePercent: spec.uptimePercent,
        peerId: spec.peerId,
        lastHeartbeatAt,
        walletAddress: spec.wallet,
      })
      .returning({ id: providersTable.id });
    result.providers += 1;

    for (const assignment of spec.assignments) {
      const [deal] = await db
        .insert(dealsTable)
        .values({
          providerId: provider.id,
          providerName: spec.name,
          clientAddress: WALLET.healthy1,
          storageGb: 10,
          durationEpochs: 30,
          totalCostSol: 0.39,
          status: assignment.status === "confirmed" ? "active" : "pending",
          dataHash: CID,
          startEpoch: 0,
          endEpoch: 30,
        })
        .returning({ id: dealsTable.id });
      result.deals += 1;

      await db.insert(dealAssignmentsTable).values({
        dealId: deal.id,
        providerId: provider.id,
        // An assignment exists only when the provider has a node; the "new"
        // provider has none, so it gets no assignments.
        peerId: spec.peerId ?? PEER.healthy1,
        status: assignment.status,
        atRisk: assignment.atRisk,
        consecutiveConclusiveNegatives: assignment.streak,
        verificationDetail: assignment.detail,
        lastVerifiedAt: assignment.detail === null ? null : new Date(now.getTime() - 60_000),
        lastHeartbeatAt,
        confirmedAt: assignment.status === "confirmed" ? new Date(now.getTime() - 2 * MINUTE) : null,
      });
      result.assignments += 1;
    }
  }

  return result;
}

/** True when the CLI was passed `--confirm` (the explicit write consent). */
export function hasConfirmFlag(argv: readonly string[]): boolean {
  return argv.includes("--confirm");
}

/** True when the CLI was passed `--clean` (delete demo rows, do not seed). */
export function hasCleanFlag(argv: readonly string[]): boolean {
  return argv.includes("--clean");
}

/**
 * The host from `--allow-host=<host>`, or `null` when the flag is absent or
 * empty. The value is taken verbatim (after trimming); the guard compares it to
 * the parsed host exactly, so a partial or suffixed value does not match.
 */
export function parseAllowHost(argv: readonly string[]): string | null {
  const prefix = "--allow-host=";
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (hit === undefined) return null;
  const value = hit.slice(prefix.length).trim();
  return value.length > 0 ? value : null;
}

/**
 * The action the CLI was asked to take, resolved purely from argv so it can be
 * asserted without a database. `dryRun` is `true` whenever `--confirm` is
 * absent: seeding then prints the plan and writes nothing, and `--clean` counts
 * the demo rows and deletes nothing.
 */
export interface SeedCommand {
  action: "seed" | "clean";
  /** `--confirm`: the explicit consent to write/delete. */
  confirmed: boolean;
  /** The `--allow-host=<host>` value, or `null`. */
  allowHost: string | null;
  /** True when the command will not write (i.e. `--confirm` was not passed). */
  dryRun: boolean;
}

export function resolveCommand(argv: readonly string[]): SeedCommand {
  const confirmed = hasConfirmFlag(argv);
  return {
    action: hasCleanFlag(argv) ? "clean" : "seed",
    confirmed,
    allowHost: parseAllowHost(argv),
    dryRun: !confirmed,
  };
}

/**
 * Connect, run `run`, and always close the pool. The single place a pool is
 * opened, so `--clean` and the seed share the connect/close lifecycle.
 */
async function withDatabase<T>(
  databaseUrl: string,
  run: (db: SeedDatabase) => Promise<T>
): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl });
  const { drizzle } = await import("drizzle-orm/node-postgres");
  // Pass the schema so `db` is typed against the real tables; without it the
  // insert/select helpers have no table types to infer from.
  const db = drizzle(pool, { schema: await import("@workspace/db") });
  try {
    return await run(db);
  } finally {
    await pool.end();
  }
}

/** `--clean`: delete the demo rows and nothing else. */
async function runClean(databaseUrl: string, confirmed: boolean): Promise<number> {
  return withDatabase(databaseUrl, async (db) => {
    if (!confirmed) {
      const existing = await countDemoRows(db);
      process.stdout.write(
        "dry run: no --confirm flag, so nothing was deleted.\n" +
          `demo providers currently in the database: ${existing}\n` +
          `would delete ${existing} provider row(s) where node_id LIKE 'demo-%' ` +
          "(their deals and assignments cascade).\n" +
          "\nre-run with --confirm to delete them:\n" +
          "  pnpm --filter @workspace/scripts run seed:demo-providers -- --clean --confirm\n"
      );
      return 0;
    }
    const existing = await countDemoRows(db);
    await clearDemoRows(db);
    process.stdout.write(
      `deleted ${existing} demo provider row(s) where node_id LIKE 'demo-%' ` +
        "(their deals and assignments cascaded).\n"
    );
    return 0;
  });
}

/** The default action: seed the six demo providers. */
async function runSeed(databaseUrl: string): Promise<number> {
  const result = await withDatabase(databaseUrl, (db) => seed(db));
  process.stdout.write(
    `seeded ${result.providers} demo providers ` +
      `(${result.deals} deals, ${result.assignments} assignments)\n` +
      `  3 healthy, 2 flaky, 1 new — run the advisor with:\n` +
      `    PROVIDER_ID=<id> META_MOCK=1 pnpm --filter @workspace/reliability-agent assess\n` +
      `  and the recommendation with:\n` +
      `    curl "http://127.0.0.1:3000/api/providers/recommend?storageGb=100&durationEpochs=10"\n`
  );
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = resolveCommand(argv);
  const { action, confirmed, allowHost } = command;

  // Both actions write, so both need the explicit consent gate. Without
  // `--confirm` no write happens: seeding prints the plan and opens nothing;
  // `--clean` opens a read-only connection only to count the demo rows.
  if (!confirmed && action === "seed") {
    const specs = demoSpecs(new Date());
    process.stdout.write(
      "dry run: no --confirm flag, so nothing was written.\n" +
        `would seed ${specs.length} demo providers (3 healthy, 2 flaky, 1 new):\n` +
        specs.map((s) => `  - ${s.nodeId}  ${s.name}`).join("\n") +
        "\n\nre-run with --confirm to write them:\n" +
        "  pnpm --filter @workspace/scripts run seed:demo-providers -- --confirm\n"
    );
    return 0;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      "DATABASE_URL is required, e.g. " +
        "postgres://postgres:postgres@127.0.0.1:5432/adadive\n"
    );
    return 2;
  }

  try {
    assertSeedable(process.env, databaseUrl, allowHost);
  } catch (err) {
    if (err instanceof SeedGuardError) {
      process.stderr.write(`refusing to ${action}: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  return action === "clean" ? runClean(databaseUrl, confirmed) : runSeed(databaseUrl);
}

// Only run when invoked directly, so the exported helpers can be imported by a
// test without a database connection.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("seed-demo-providers.ts") ||
    process.argv[1].endsWith("seed-demo-providers.mjs"));

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 1;
    });
}

export { clearDemoRows };
