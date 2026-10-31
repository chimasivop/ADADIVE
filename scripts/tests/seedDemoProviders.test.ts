/**
 * Seed-script guard tests.
 *
 * The seed script writes rows, so its safety checks are the part most worth
 * pinning: it must refuse production, refuse a non-local database, and still
 * describe six providers (3 healthy / 2 flaky / 1 new) with valid addresses and
 * peer ids.
 *
 * These are pure: no database is opened. `assertSeedable` and `demoSpecs` are
 * exported precisely so they can be tested without one.
 */

import { assert } from "chai";

import {
  assertSeedable,
  databaseHost,
  demoRowFilter,
  demoSpecs,
  hasCleanFlag,
  hasConfirmFlag,
  isLocalDatabaseUrl,
  isProductionHost,
  parseAllowHost,
  PRODUCTION_HOSTS,
  resolveCommand,
  SeedGuardError,
} from "../seed-demo-providers";

const LOCAL = "postgres://postgres:postgres@127.0.0.1:5432/adadive";
const LOCALHOST = "postgres://postgres:postgres@localhost:5432/adadive";
const REMOTE = "postgres://user:pw@db.prod.example.com:5432/adadive";
const REMOTE_HOST = "db.prod.example.com";
// A real Railway demo database host, shaped like the ones the platform mints.
const RAILWAY_DEMO =
  "postgres://postgres:pw@roundhouse.proxy.rlwy.net:41234/railway";
const RAILWAY_DEMO_HOST = "roundhouse.proxy.rlwy.net";
// The production Supabase host named in artifacts/api-server/E2E_STATUS.md.
const PROD_SUPABASE =
  "postgresql://postgres.knaigsdfjfeuaucozoba:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

describe("isLocalDatabaseUrl", () => {
  it("accepts localhost and loopback literals", () => {
    assert.isTrue(isLocalDatabaseUrl(LOCAL));
    assert.isTrue(isLocalDatabaseUrl(LOCALHOST));
    assert.isTrue(isLocalDatabaseUrl("postgres://u:p@[::1]:5432/db"));
  });

  it("rejects a remote host", () => {
    assert.isFalse(isLocalDatabaseUrl(REMOTE));
  });

  it("rejects an unparseable URL", () => {
    assert.isFalse(isLocalDatabaseUrl("not a url"));
  });
});

describe("assertSeedable", () => {
  it("refuses NODE_ENV=production outright", () => {
    assert.throws(
      () => assertSeedable({ NODE_ENV: "production" }, LOCAL),
      SeedGuardError
    );
  });

  it("refuses production even when ALLOW_DEMO_SEED is set", () => {
    assert.throws(
      () => assertSeedable({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" }, LOCAL),
      /NODE_ENV=production/
    );
  });

  it("refuses a non-local database", () => {
    assert.throws(() => assertSeedable({}, REMOTE), /non-local database/);
  });

  it("allows a non-local database only with ALLOW_DEMO_SEED=1", () => {
    assert.doesNotThrow(() => assertSeedable({ ALLOW_DEMO_SEED: "1" }, REMOTE));
  });

  it("allows a local development database", () => {
    assert.doesNotThrow(() => assertSeedable({ NODE_ENV: "development" }, LOCAL));
    assert.doesNotThrow(() => assertSeedable({}, LOCALHOST));
  });
});

describe("databaseHost / isProductionHost", () => {
  it("extracts the bare host, unwrapping an IPv6 literal", () => {
    assert.equal(databaseHost(LOCAL), "127.0.0.1");
    assert.equal(databaseHost("postgres://u:p@[::1]:5432/db"), "::1");
    assert.isNull(databaseHost("not a url"));
  });

  it("names the documented production hosts", () => {
    assert.isTrue(isProductionHost("aws-0-eu-west-1.pooler.supabase.com"));
    assert.isTrue(isProductionHost("adadive.xyz"));
    // A subdomain of a production host is still production.
    assert.isTrue(isProductionHost("api.adadive.xyz"));
    assert.isFalse(isProductionHost("roundhouse.proxy.rlwy.net"));
    assert.isFalse(isProductionHost(null));
  });
});

describe("assertSeedable — remote demo override", () => {
  it("still refuses a remote database with no override", () => {
    assert.throws(() => assertSeedable({}, REMOTE), /non-local database/);
  });

  it("refuses a documented production host with no override at all", () => {
    assert.throws(
      () => assertSeedable({}, PROD_SUPABASE),
      /production host/
    );
  });

  it("refuses a production host even with the full demo override", () => {
    assert.throws(
      () =>
        assertSeedable(
          {
            DEMO_SEED_ALLOW_REMOTE: "1",
            DEMO_SEED_CONFIRM_HOST: "aws-0-eu-west-1.pooler.supabase.com",
          },
          PROD_SUPABASE
        ),
      /production host/
    );
  });

  it("refuses a production host even with ALLOW_DEMO_SEED=1", () => {
    assert.throws(
      () => assertSeedable({ ALLOW_DEMO_SEED: "1" }, PROD_SUPABASE),
      /production host/
    );
  });

  it("requires the host echo when DEMO_SEED_ALLOW_REMOTE=1", () => {
    assert.throws(
      () => assertSeedable({ DEMO_SEED_ALLOW_REMOTE: "1" }, REMOTE),
      /requires DEMO_SEED_CONFIRM_HOST/
    );
  });

  it("refuses when the confirmed host does not match", () => {
    assert.throws(
      () =>
        assertSeedable(
          { DEMO_SEED_ALLOW_REMOTE: "1", DEMO_SEED_CONFIRM_HOST: "other.host" },
          REMOTE
        ),
      /does not match/
    );
  });

  it("allows a remote demo database when both parts are present and match", () => {
    assert.doesNotThrow(() =>
      assertSeedable(
        {
          DEMO_SEED_ALLOW_REMOTE: "1",
          DEMO_SEED_CONFIRM_HOST: RAILWAY_DEMO_HOST,
        },
        RAILWAY_DEMO
      )
    );
  });

  it("matches the host exactly, not as a suffix", () => {
    // A confirmation of the bare domain must not unlock a differently-named host.
    assert.throws(
      () =>
        assertSeedable(
          { DEMO_SEED_ALLOW_REMOTE: "1", DEMO_SEED_CONFIRM_HOST: "proxy.rlwy.net" },
          RAILWAY_DEMO
        ),
      /does not match/
    );
  });

  it("still refuses NODE_ENV=production with the demo override set", () => {
    assert.throws(
      () =>
        assertSeedable(
          {
            NODE_ENV: "production",
            DEMO_SEED_ALLOW_REMOTE: "1",
            DEMO_SEED_CONFIRM_HOST: REMOTE_HOST,
          },
          REMOTE
        ),
      /NODE_ENV=production/
    );
  });
});

describe("hasConfirmFlag", () => {
  it("is false with no arguments", () => {
    assert.isFalse(hasConfirmFlag([]));
  });

  it("is false for unrelated flags", () => {
    assert.isFalse(hasConfirmFlag(["--dry-run", "--verbose"]));
  });

  it("is true only for the exact --confirm flag", () => {
    assert.isTrue(hasConfirmFlag(["--confirm"]));
    assert.isTrue(hasConfirmFlag(["--other", "--confirm"]));
    assert.isFalse(hasConfirmFlag(["--confirmed"]));
  });
});

describe("hasCleanFlag", () => {
  it("is false with no arguments", () => {
    assert.isFalse(hasCleanFlag([]));
  });

  it("is true only for the exact --clean flag", () => {
    assert.isTrue(hasCleanFlag(["--clean"]));
    assert.isTrue(hasCleanFlag(["--confirm", "--clean"]));
    assert.isFalse(hasCleanFlag(["--cleaner"]));
  });
});

describe("parseAllowHost", () => {
  it("is null when the flag is absent", () => {
    assert.isNull(parseAllowHost([]));
    assert.isNull(parseAllowHost(["--confirm", "--clean"]));
  });

  it("is null for an empty value", () => {
    assert.isNull(parseAllowHost(["--allow-host="]));
    assert.isNull(parseAllowHost(["--allow-host=   "]));
  });

  it("is null for the bare flag without a value", () => {
    // Only the `--allow-host=<host>` form carries a host.
    assert.isNull(parseAllowHost(["--allow-host"]));
  });

  it("reads the host from the --allow-host=<host> form", () => {
    assert.equal(parseAllowHost(["--allow-host=db.example.com"]), "db.example.com");
    assert.equal(
      parseAllowHost(["--confirm", "--allow-host=db.example.com", "--clean"]),
      "db.example.com"
    );
  });
});

describe("assertSeedable — --allow-host", () => {
  it("unlocks a remote host only when it matches exactly", () => {
    assert.doesNotThrow(() => assertSeedable({}, REMOTE, REMOTE_HOST));
  });

  it("refuses when --allow-host does not match the host", () => {
    assert.throws(
      () => assertSeedable({}, REMOTE, "other.host"),
      /non-local database/
    );
  });

  it("matches the host exactly, not as a suffix", () => {
    assert.throws(
      () => assertSeedable({}, RAILWAY_DEMO, "proxy.rlwy.net"),
      /non-local database/
    );
  });

  it("cannot unlock a PRODUCTION_HOSTS entry", () => {
    for (const prodHost of PRODUCTION_HOSTS) {
      assert.throws(
        () => assertSeedable({}, `postgres://u:p@${prodHost}:5432/postgres`, prodHost),
        /production host/,
        prodHost
      );
    }
  });

  it("cannot unlock a production host via a subdomain", () => {
    assert.throws(
      () =>
        assertSeedable(
          {},
          "postgres://u:p@api.adadive.xyz:5432/postgres",
          "api.adadive.xyz"
        ),
      /production host/
    );
  });

  it("cannot unlock a production host even with the env override too", () => {
    assert.throws(
      () =>
        assertSeedable(
          {
            DEMO_SEED_ALLOW_REMOTE: "1",
            DEMO_SEED_CONFIRM_HOST: "aws-0-eu-west-1.pooler.supabase.com",
          },
          PROD_SUPABASE,
          "aws-0-eu-west-1.pooler.supabase.com"
        ),
      /production host/
    );
  });

  it("does not bypass NODE_ENV=production", () => {
    assert.throws(
      () => assertSeedable({ NODE_ENV: "production" }, REMOTE, REMOTE_HOST),
      /NODE_ENV=production/
    );
  });

  it("does not gate a local database (no flag needed)", () => {
    assert.doesNotThrow(() => assertSeedable({}, LOCAL, null));
    assert.doesNotThrow(() => assertSeedable({}, LOCALHOST, null));
  });
});

describe("resolveCommand", () => {
  it("defaults to a seeding dry run with no flags", () => {
    assert.deepEqual(resolveCommand([]), {
      action: "seed",
      confirmed: false,
      allowHost: null,
      dryRun: true,
    });
  });

  it("is a seeding dry run without --confirm", () => {
    const command = resolveCommand(["--allow-host=db.example.com"]);
    assert.equal(command.action, "seed");
    assert.isFalse(command.confirmed);
    assert.isTrue(command.dryRun);
    assert.equal(command.allowHost, "db.example.com");
  });

  it("seeds for real only with --confirm", () => {
    const command = resolveCommand(["--confirm"]);
    assert.equal(command.action, "seed");
    assert.isTrue(command.confirmed);
    assert.isFalse(command.dryRun);
  });

  it("is a cleaning dry run for --clean without --confirm", () => {
    const command = resolveCommand(["--clean"]);
    assert.equal(command.action, "clean");
    assert.isFalse(command.confirmed);
    assert.isTrue(command.dryRun);
  });

  it("cleans for real with --clean --confirm", () => {
    const command = resolveCommand(["--clean", "--confirm"]);
    assert.equal(command.action, "clean");
    assert.isTrue(command.confirmed);
    assert.isFalse(command.dryRun);
  });
});

/**
 * The `demo-` predicate that `--clean` deletes with.
 *
 * The delete is `node_id LIKE 'demo-%'`, which SQL evaluates as an anchored
 * prefix match (no `_` or `%` before the literal). The compiled statement is
 * asserted directly, then the same pattern is applied to a sample set that
 * includes a real-looking provider to show it survives.
 */
describe("demoRowFilter (the --clean delete predicate)", () => {
  /** SQL LIKE for a pattern of the form `literal%` — exactly what is compiled. */
  function likeMatches(value: string, pattern: string): boolean {
    if (!pattern.endsWith("%")) return value === pattern;
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }

  it("compiles to node_id LIKE 'demo-%'", async () => {
    const { providersTable } = await import("@workspace/db/schema");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const compiled = new PgDialect().sqlToQuery(demoRowFilter(providersTable.nodeId));
    assert.equal(compiled.sql, '"providers"."node_id" like $1');
    assert.deepEqual(compiled.params, ["demo-%"]);
    assert.equal(providersTable.nodeId.name, "node_id");
  });

  it("matches every demo node id the seeder writes", () => {
    for (const spec of demoSpecs(new Date("2025-01-01T00:00:00.000Z"))) {
      assert.isTrue(likeMatches(spec.nodeId, "demo-%"), spec.nodeId);
    }
  });

  it("never matches a non-demo provider, which therefore survives", () => {
    const rows = [
      "demo-healthy-1",
      "demo-flaky-2",
      "pool1abc123", // a real provider
      "provider-alpha",
      "dem", // almost the prefix
      "x-demo-1", // demo- not at the start
      "demo", // prefix without the dash
    ];
    const matched = rows.filter((nodeId) => likeMatches(nodeId, "demo-%"));
    assert.deepEqual(matched, ["demo-healthy-1", "demo-flaky-2"]);
    assert.notInclude(matched, "pool1abc123");
    assert.notInclude(matched, "provider-alpha");
  });
});

describe("demoSpecs", () => {
  const specs = demoSpecs(new Date("2025-01-01T00:00:00.000Z"));

  it("describes six providers: 3 healthy, 2 flaky, 1 new", () => {
    assert.lengthOf(specs, 6);
    assert.lengthOf(specs.filter((s) => s.nodeId.includes("healthy")), 3);
    assert.lengthOf(specs.filter((s) => s.nodeId.includes("flaky")), 2);
    assert.lengthOf(specs.filter((s) => s.nodeId.includes("new")), 1);
  });

  it("gives every provider a distinct node id and wallet", () => {
    assert.lengthOf(new Set(specs.map((s) => s.nodeId)), 6);
    assert.lengthOf(new Set(specs.map((s) => s.wallet)), 6);
  });

  it("prefixes every node id so the seeder can find and clear its own rows", () => {
    for (const spec of specs) {
      assert.match(spec.nodeId, /^demo-/);
    }
  });

  it("gives healthy providers a fresh heartbeat and no at-risk assignments", () => {
    for (const spec of specs.filter((s) => s.nodeId.includes("healthy"))) {
      assert.isNotNull(spec.peerId);
      assert.isBelow(spec.heartbeatAgeMs!, 60_000);
      assert.isTrue(spec.assignments.every((a) => !a.atRisk && a.streak === 0));
    }
  });

  it("gives flaky providers a stale heartbeat and at-risk assignments", () => {
    for (const spec of specs.filter((s) => s.nodeId.includes("flaky"))) {
      assert.isNotNull(spec.peerId);
      assert.isAbove(spec.heartbeatAgeMs!, 3 * 60_000);
      assert.isTrue(spec.assignments.length > 0);
      assert.isTrue(spec.assignments.every((a) => a.atRisk && a.streak >= 3));
    }
  });

  it("gives the new provider no node, no heartbeat and no assignments", () => {
    const spec = specs.find((s) => s.nodeId.includes("new"))!;
    assert.isNull(spec.peerId);
    assert.isNull(spec.heartbeatAgeMs);
    assert.lengthOf(spec.assignments, 0);
  });

  it("uses wallets that are valid 32-byte base58 public keys", () => {
    const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const decode = (value: string): Uint8Array => {
      const bytes: number[] = [];
      for (const char of value) {
        let carry = ALPHABET.indexOf(char);
        if (carry < 0) throw new Error(`bad base58 char in ${value}`);
        for (let j = 0; j < bytes.length; j++) {
          carry += bytes[j] * 58;
          bytes[j] = carry & 0xff;
          carry >>= 8;
        }
        while (carry > 0) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      for (const char of value) {
        if (char !== "1") break;
        bytes.push(0);
      }
      return Uint8Array.from(bytes.reverse());
    };
    for (const spec of specs) {
      assert.lengthOf(decode(spec.wallet), 32, spec.wallet);
    }
  });

  it("uses peer ids that pass the api-zod peerId shape rule", () => {
    for (const spec of specs) {
      if (spec.peerId === null) continue;
      assert.match(spec.peerId, /^[1-9A-HJ-NP-Za-km-z]{10,128}$/);
    }
  });

  it("gives every provider a positive capacity and price for the ranker", () => {
    for (const spec of specs) {
      assert.isAbove(spec.totalStorageGb, 0, spec.nodeId);
      assert.isAtLeast(spec.usedStorageGb, 0, spec.nodeId);
      assert.isAtMost(spec.usedStorageGb, spec.totalStorageGb, spec.nodeId);
      assert.isAbove(spec.pricePerGbPerEpoch, 0, spec.nodeId);
    }
  });

  it("varies capacity and price so the ranking has something to order", () => {
    assert.isAbove(new Set(specs.map((s) => s.pricePerGbPerEpoch)).size, 1);
    assert.isAbove(new Set(specs.map((s) => s.totalStorageGb)).size, 1);
  });

  it("includes at least one provider too small for a 500 GB deal", () => {
    assert.isTrue(specs.some((s) => s.totalStorageGb - s.usedStorageGb < 500));
  });
});
