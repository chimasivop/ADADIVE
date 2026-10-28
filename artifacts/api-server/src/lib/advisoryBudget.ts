/**
 * The demo budget for live Meta Model API calls.
 *
 * The advisory route is public, and each cache miss on a live advisor spends a
 * paid model call. On a hosted demo that is a real cost, so this caps the number
 * of *live* calls per UTC day. When the day's allowance is spent the route does
 * not fail: it serves a cached or fixture-based assessment and says so (see
 * `routes/advisory.ts`).
 *
 * Why a day, in UTC, and not a rolling window: the cap exists to bound spend
 * over a demo day, and a UTC day boundary is trivial to reason about and to
 * document. It is deliberately *not* per-IP — a per-IP cap alone can be
 * multiplied by an attacker; this is the global backstop the per-IP rate limiter
 * cannot be.
 *
 * The counter is in-process. A multi-replica deployment would count per replica;
 * that is acceptable here (the demo runs a single api-server instance) and is
 * noted so it is not mistaken for a distributed quota.
 */

export interface DailyCallBudgetOptions {
  /**
   * Maximum live model calls per UTC day. `0` or a negative value disables the
   * cap entirely (an operator who has no cost concern can turn it off).
   */
  maxPerDay: number;
  /** Injectable clock (ms since epoch), so the day rollover is testable. */
  now?: () => number;
}

export interface AdvisoryBudget {
  /** True when another live call may be spent, consuming one unit if so. */
  tryConsume(): boolean;
  /** How many live calls have been spent today. */
  readonly usedToday: number;
  /** How many live calls remain today (Infinity when the cap is disabled). */
  readonly remaining: number;
  /** The cap in force, or `null` when disabled. */
  readonly maxPerDay: number | null;
  /** True when no further live calls may be spent today. */
  readonly exhausted: boolean;
}

/** The UTC calendar day (YYYY-MM-DD) a timestamp falls in. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class DailyCallBudget implements AdvisoryBudget {
  private readonly max: number | null;
  private readonly now: () => number;
  private day: string;
  private used = 0;

  constructor(options: DailyCallBudgetOptions) {
    this.max = options.maxPerDay > 0 ? Math.floor(options.maxPerDay) : null;
    this.now = options.now ?? (() => Date.now());
    this.day = utcDayKey(this.now());
  }

  /** Roll the counter over when the UTC day changes. */
  private roll(): void {
    const today = utcDayKey(this.now());
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }

  tryConsume(): boolean {
    this.roll();
    if (this.max === null) return true;
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }

  get usedToday(): number {
    this.roll();
    return this.used;
  }

  get remaining(): number {
    this.roll();
    return this.max === null ? Infinity : Math.max(0, this.max - this.used);
  }

  get maxPerDay(): number | null {
    return this.max;
  }

  get exhausted(): boolean {
    this.roll();
    return this.max !== null && this.used >= this.max;
  }
}

/** A budget that never refuses — used when the cap is disabled or absent. */
export const unlimitedBudget: AdvisoryBudget = {
  tryConsume: () => true,
  usedToday: 0,
  remaining: Infinity,
  maxPerDay: null,
  exhausted: false,
};

function positiveIntOrZero(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

/**
 * Build the budget from the environment. Safe default: a cap, not unlimited.
 *
 * `ADVISORY_DAILY_CALL_CAP=0` disables it; anything unparseable falls back to the
 * default rather than silently removing the cap.
 */
export function createDailyBudgetFromEnv(env: NodeJS.ProcessEnv): AdvisoryBudget {
  const maxPerDay = positiveIntOrZero(env.ADVISORY_DAILY_CALL_CAP, DEFAULT_DAILY_CALL_CAP);
  return new DailyCallBudget({ maxPerDay });
}

/** 200 live model calls per UTC day: enough for a demo, bounded for a bill. */
export const DEFAULT_DAILY_CALL_CAP = 200;

/** 30 advisory requests per IP per minute: a burst allowance, not a quota. */
export const DEFAULT_RATE_LIMIT_MAX = 30;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * The per-IP rate-limit settings for the advisory route, from the environment.
 *
 * Both fall back to the safe defaults on an unparseable or non-positive value,
 * so a typo cannot remove the limit. (`express-rate-limit` reads `max: 0` as
 * "block everything", which is not what an operator means by `0` here, so zero
 * also falls back.)
 */
export function createRateLimitFromEnv(env: NodeJS.ProcessEnv): {
  max: number;
  windowMs: number;
} {
  const max = env.ADVISORY_RATE_LIMIT_MAX === undefined
    ? DEFAULT_RATE_LIMIT_MAX
    : nonNegativeInt(env.ADVISORY_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const windowMs = env.ADVISORY_RATE_LIMIT_WINDOW_MS === undefined
    ? DEFAULT_RATE_LIMIT_WINDOW_MS
    : nonNegativeInt(env.ADVISORY_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS);
  // `express-rate-limit` treats `max: 0` as "block everything", not "disable";
  // a non-positive window would also be nonsense. Fall back to the default in
  // both cases rather than silently refusing every request.
  return {
    max: max > 0 ? max : DEFAULT_RATE_LIMIT_MAX,
    windowMs: windowMs > 0 ? windowMs : DEFAULT_RATE_LIMIT_WINDOW_MS,
  };
}

function nonNegativeInt(raw: string, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}
