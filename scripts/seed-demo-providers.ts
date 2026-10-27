/**
 * Seed six demo providers for the reliability advisor:
 * three healthy, two flaky, one new.
 *
 * Run:
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/adadive \
 *     pnpm --filter @workspace/scripts run seed:demo-providers
 *
 * ## Safety
 *
 * This writes rows, so it refuses to run anywhere that looks like production:
 *
 *   - `NODE_ENV=production` is refused outright.
 *   - a non-local database host is refused (only `localhost`, `127.0.0.1` and
 *     `::1` are accepted).
 *
 * Both guards can be overridden together with `ALLOW_DEMO_SEED=1`, and only for
 * the *local* host check — the production guard cannot be overridden, because a
 * demo seeder that can be pointed at production is a foot-gun, not a feature.
 *
 * ## Idempotence
 *
 * Demo rows are identified by a `demo-` prefix on `node_id` (and the matching
 * wallet). Re-running the script deletes the previous demo rows first — the
 * `deal_assignments` and `deals` rows cascade from `providers` — so the script
 * converges on the same six providers rather than piling up duplicates.
 *
 * ## What each provider looks like
 *
 *   - healthy: a registered node with a fresh heartbeat, confirmed assignments,
 *     no at-risk flag, zero streak.
 *   - flaky:   a registered node with a stale heartbeat and assignments the
 *     oracle has flagged at-risk with a full consecutive-negative streak.
 *   - new:     no registered node, no heartbeat, no assignments — so the advisor
 *     has nothing to judge and should answer `unknown`.
 */

import pg from "pg";
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

/** `localhost`, `127.0.0.1` and `::1` are local; nothing else is. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return false;
  }
  // Node keeps the brackets on an IPv6 literal, so `[::1]` must be unwrapped;
  // an empty host means the URL had no host at all, which is not local either.
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

/**
 * Refuse anything that is not an obvious local development database.
 *
 * `NODE_ENV=production` is refused with no override. A non-local host is refused
 * unless `ALLOW_DEMO_SEED=1`, which is the escape hatch for a deliberate remote
 * dev database; it does not unlock production.
 */
export function assertSeedable(env: NodeJS.ProcessEnv, databaseUrl: string): void {
  if (env.NODE_ENV === "production") {
    throw new SeedGuardError(
      "refusing to seed demo providers with NODE_ENV=production; this script " +
        "writes rows and is for local development only"
    );
  }
  if (!isLocalDatabaseUrl(databaseUrl)) {
    if (env.ALLOW_DEMO_SEED === "1") return;
    throw new SeedGuardError(
      "refusing to seed demo providers against a non-local database " +
        `(${safeHost(databaseUrl)}); set ALLOW_DEMO_SEED=1 only if you are sure ` +
        "this is a disposable development database"
    );
  }
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
      // No node, no heartbeat, no assignments: nothing to judge.
      peerId: null,
      heartbeatAgeMs: null,
      assignments: [],
    },
  ];
}

/** Delete prior demo rows (cascades to deals and assignments). */
async function clearDemoRows(db: SeedDatabase): Promise<void> {
  const { providersTable } = await import("@workspace/db");
  const { like } = await import("drizzle-orm");
  await db
    .delete(providersTable)
    .where(like(providersTable.nodeId, `${DEMO_PREFIX}%`));
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
        totalStorageGb: 500,
        pricePerGbPerEpoch: 0.0013,
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

    for (const [i, assignment] of spec.assignments.entries()) {
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
      void i;
    }
  }

  return result;
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      "DATABASE_URL is required, e.g. " +
        "postgres://postgres:postgres@127.0.0.1:5432/adadive\n"
    );
    return 2;
  }

  try {
    assertSeedable(process.env, databaseUrl);
  } catch (err) {
    if (err instanceof SeedGuardError) {
      process.stderr.write(`refusing to seed: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const { drizzle } = await import("drizzle-orm/node-postgres");
  // Pass the schema so `db` is typed against the real tables; without it the
  // insert/select helpers have no table types to infer from.
  const db = drizzle(pool, { schema: await import("@workspace/db") });
  try {
    const result = await seed(db);
    process.stdout.write(
      `seeded ${result.providers} demo providers ` +
        `(${result.deals} deals, ${result.assignments} assignments)\n` +
        `  3 healthy, 2 flaky, 1 new — run the advisor with:\n` +
        `    PROVIDER_ID=<id> META_MOCK=1 pnpm --filter @workspace/reliability-agent assess\n`
    );
    return 0;
  } finally {
    await pool.end();
  }
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
