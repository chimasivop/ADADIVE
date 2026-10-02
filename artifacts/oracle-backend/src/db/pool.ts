/**
 * Postgres pool construction.
 *
 * One pool per process, sized conservatively: this service is a low-throughput
 * settle coordinator, not an application backend, and the challenge-window job
 * is the only thing that fans out queries.
 */

import { Pool, type PoolConfig } from "pg";

export function createPool(databaseUrl: string, overrides: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
}

export type { Pool } from "pg";
