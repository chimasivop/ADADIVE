/**
 * The demo's daily live-call budget.
 *
 * A pure in-process counter, so these tests are about the rollover, the cap and
 * the disabled case — no HTTP, no model, no clock.
 */

import { assert } from "chai";

import {
  createDailyBudgetFromEnv,
  createRateLimitFromEnv,
  DailyCallBudget,
  DEFAULT_DAILY_CALL_CAP,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  unlimitedBudget,
  utcDayKey,
} from "../src/lib/advisoryBudget";

describe("utcDayKey", () => {
  it("is the UTC calendar day", () => {
    assert.equal(utcDayKey(Date.parse("2025-01-01T23:59:59.999Z")), "2025-01-01");
    assert.equal(utcDayKey(Date.parse("2025-01-02T00:00:00.000Z")), "2025-01-02");
  });
});

describe("DailyCallBudget", () => {
  it("allows up to the cap, then refuses", () => {
    const budget = new DailyCallBudget({ maxPerDay: 3 });
    assert.isTrue(budget.tryConsume());
    assert.isTrue(budget.tryConsume());
    assert.isTrue(budget.tryConsume());
    assert.isFalse(budget.tryConsume());
    assert.equal(budget.usedToday, 3);
    assert.equal(budget.remaining, 0);
    assert.isTrue(budget.exhausted);
  });

  it("resets when the UTC day rolls over", () => {
    let now = Date.parse("2025-01-01T12:00:00.000Z");
    const budget = new DailyCallBudget({ maxPerDay: 1, now: () => now });

    assert.isTrue(budget.tryConsume());
    assert.isFalse(budget.tryConsume(), "same day: refused");
    assert.isTrue(budget.exhausted);

    now = Date.parse("2025-01-02T00:00:01.000Z");
    assert.isFalse(budget.exhausted, "a new day clears the count");
    assert.isTrue(budget.tryConsume());
  });

  it("does not roll over within the same UTC day", () => {
    let now = Date.parse("2025-01-01T00:00:00.000Z");
    const budget = new DailyCallBudget({ maxPerDay: 1, now: () => now });
    assert.isTrue(budget.tryConsume());
    now = Date.parse("2025-01-01T23:59:59.000Z");
    assert.isFalse(budget.tryConsume());
  });

  it("is unlimited when the cap is zero or negative", () => {
    for (const maxPerDay of [0, -5]) {
      const budget = new DailyCallBudget({ maxPerDay });
      for (let i = 0; i < 10; i += 1) assert.isTrue(budget.tryConsume());
      assert.equal(budget.maxPerDay, null);
      assert.equal(budget.remaining, Infinity);
      assert.isFalse(budget.exhausted);
    }
  });
});

describe("unlimitedBudget", () => {
  it("never refuses and reports no cap", () => {
    for (let i = 0; i < 5; i += 1) assert.isTrue(unlimitedBudget.tryConsume());
    assert.equal(unlimitedBudget.maxPerDay, null);
    assert.isFalse(unlimitedBudget.exhausted);
  });
});

describe("createDailyBudgetFromEnv", () => {
  it("defaults to a safe cap, not unlimited", () => {
    const budget = createDailyBudgetFromEnv({});
    assert.equal(budget.maxPerDay, DEFAULT_DAILY_CALL_CAP);
  });

  it("reads the cap from the environment", () => {
    assert.equal(createDailyBudgetFromEnv({ ADVISORY_DAILY_CALL_CAP: "5" }).maxPerDay, 5);
  });

  it("treats 0 as 'cap disabled'", () => {
    assert.isNull(createDailyBudgetFromEnv({ ADVISORY_DAILY_CALL_CAP: "0" }).maxPerDay);
  });

  it("falls back to the default on an unparseable value rather than removing the cap", () => {
    for (const raw of ["abc", "-1", "", "  "]) {
      assert.equal(
        createDailyBudgetFromEnv({ ADVISORY_DAILY_CALL_CAP: raw }).maxPerDay,
        DEFAULT_DAILY_CALL_CAP,
        `value ${JSON.stringify(raw)}`
      );
    }
  });
});

describe("createRateLimitFromEnv", () => {
  it("defaults to the safe per-IP limit", () => {
    const { max, windowMs } = createRateLimitFromEnv({});
    assert.equal(max, DEFAULT_RATE_LIMIT_MAX);
    assert.equal(windowMs, DEFAULT_RATE_LIMIT_WINDOW_MS);
  });

  it("reads both values from the environment", () => {
    const { max, windowMs } = createRateLimitFromEnv({
      ADVISORY_RATE_LIMIT_MAX: "5",
      ADVISORY_RATE_LIMIT_WINDOW_MS: "1000",
    });
    assert.equal(max, 5);
    assert.equal(windowMs, 1000);
  });

  it("keeps a safe default when a value is unparseable or non-positive", () => {
    // 0 would make express-rate-limit block everything; a typo must not remove
    // the limit, so both fall back rather than disabling.
    for (const raw of ["abc", "-1", "0", "", "  "]) {
      const { max, windowMs } = createRateLimitFromEnv({
        ADVISORY_RATE_LIMIT_MAX: raw,
        ADVISORY_RATE_LIMIT_WINDOW_MS: raw,
      });
      assert.equal(max, DEFAULT_RATE_LIMIT_MAX, `max for ${JSON.stringify(raw)}`);
      assert.equal(windowMs, DEFAULT_RATE_LIMIT_WINDOW_MS, `windowMs for ${JSON.stringify(raw)}`);
    }
  });
});
