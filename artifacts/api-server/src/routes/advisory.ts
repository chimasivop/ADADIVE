/**
 * The read-only AI advisory endpoint the provider directory renders.
 *
 * `GET /providers/:id/advisory` returns the reliability advisor's structured
 * assessment for one provider. It is a **read-only, public** route, matching the
 * other provider GETs (`GET /providers`, `GET /providers/:id`) — the directory is
 * public, and the badge on the list needs a per-provider assessment, so an
 * endpoint that only answered for the caller's own wallet could not serve it.
 *
 * What it exposes is derived from provider *status* data that the public
 * directory already returns (reputation, uptime, node liveness, verification
 * state). It does not expose the wallet address, file contents or any secret,
 * and it mutates nothing — no signing, no fund release, no deal change.
 *
 * ## Cost controls
 *
 * The model call is the expensive part, and this route is public, so it is
 * bounded three ways:
 *
 *   1. **Cache.** `AdvisoryService` caches each provider's assessment for a TTL
 *      (60s) and caps concurrent model calls. `?refresh=1` skips a fresh cache
 *      entry (the UI's refresh button) without multiplying calls for the same
 *      provider.
 *   2. **Per-IP rate limit.** A configurable requests-per-minute ceiling
 *      (`ADVISORY_RATE_LIMIT_MAX` / `ADVISORY_RATE_LIMIT_WINDOW_MS`) so one
 *      client cannot drive the spend. Over the limit is a 429.
 *   3. **Global daily cap.** A configurable number of *live* model calls per UTC
 *      day (`ADVISORY_DAILY_CALL_CAP`, default 200). This is the backstop the
 *      per-IP limit cannot be: it bounds total spend regardless of how many IPs
 *      ask. When the cap is reached the route does not fail — it serves the
 *      cached assessment if one is fresh, otherwise a fixture-based sample, and
 *      sets `demoLimitReached: true` with a `note` saying so.
 *
 * The daily cap gates only *live* calls: a mock advisor (fixtures) and a cache
 * hit spend nothing and are never refused.
 *
 * ## Fail-safe
 *
 * `available: false` means the advisor is not configured (no Meta key and mock
 * off) — the UI hides the panel. A model or transport failure is not an error
 * here: `AdvisoryService.assess` is total and answers an `unknown` assessment, so
 * the route stays 200 and the page keeps working.
 *
 * The store, the advisor and the budget are injected, so the route is testable
 * over HTTP with an in-memory store and a stub advisor, exactly like the other
 * provider routes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type {
  AdvisoryOutcome,
  AdvisorySuccess,
  Assessment,
} from "@workspace/reliability-agent";

import { logger as defaultLogger } from "../lib/logger";
import type { ProviderStorageStore } from "../lib/providerStorage";
import {
  buildReliabilityEvidence,
  DEFAULT_CONSECUTIVE_NEGATIVES,
  DEFAULT_HEARTBEAT_STALE_MS,
  type ReliabilityEvidence,
} from "../lib/reliabilityEvidence";
import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  type AdvisoryBudget,
} from "../lib/advisoryBudget";

/**
 * The note attached to a result served after the daily live-call budget is spent.
 * Worded so a judge reading the panel understands why the number may be a
 * sample rather than a fresh model call.
 */
export const DEMO_LIMIT_NOTE =
  "Demo limit reached: the daily live-assessment budget is spent, so this is a " +
  "cached or sample assessment, not a fresh model call. It resets at 00:00 UTC.";

/** The advisor, reduced to what the route needs (so a stub can stand in). */
export interface AdvisorLike {
  assess(
    providerId: number,
    evidence: ReturnType<typeof buildReliabilityEvidence>,
    opts?: { refresh?: boolean }
  ): Promise<AdvisoryOutcome>;
  /** True when the advisor replays fixtures and spends no live call. */
  readonly mock?: boolean;
  /**
   * A fresh cached assessment without a model call, or `null`. Used to serve a
   * cached result for free (and to honour the daily cap without a live call).
   */
  peek?(providerId: number): AdvisorySuccess | null;
}

export interface AdvisoryRouterDeps {
  store: ProviderStorageStore;
  /** `null` when the advisor is not configured; the route reports unavailable. */
  advisor: AdvisorLike | null;
  /** The disclaimer shown with every assessment. */
  disclaimer: string;
  /**
   * The daily live-call budget. Omitted/`null` means unlimited — the default for
   * tests and any deployment that has not opted into a cap.
   */
  budget?: AdvisoryBudget | null;
  /**
   * The fixture-based fallback used when the daily cap is spent and no fresh
   * cache entry exists. Omitted means such a request gets an `unknown`
   * assessment carrying the demo note rather than an error.
   */
  fallbackAssessment?: (
    providerId: number,
    evidence: ReliabilityEvidence
  ) => Promise<Assessment>;
  /** Per-IP rate-limit settings. Defaults are safe for a public demo. */
  rateLimit?: { windowMs?: number; max?: number };
  log?: Pick<typeof defaultLogger, "debug" | "warn" | "error">;
  reliability?: {
    heartbeatStaleMs?: number;
    consecutiveNegatives?: number;
    now?: () => Date;
  };
}

/** `?refresh=1` / `?refresh=true` forces a fresh assessment. */
function wantsRefresh(query: unknown): boolean {
  if (typeof query !== "object" || query === null) return false;
  const raw = (query as Record<string, unknown>).refresh;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function createAdvisoryRouter(deps: AdvisoryRouterDeps): IRouter {
  const { store } = deps;
  const log = deps.log ?? defaultLogger;
  const budget = deps.budget ?? null;
  const reliabilityOptions = {
    heartbeatStaleMs: deps.reliability?.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS,
    consecutiveNegatives: deps.reliability?.consecutiveNegatives ?? DEFAULT_CONSECUTIVE_NEGATIVES,
    now: deps.reliability?.now,
  };

  const router: IRouter = Router();

  // Per-IP ceiling on this route only. A generous burst allowance (the UI loads
  // one assessment per provider on the directory page), not a quota; the global
  // daily cap below is what bounds the bill.
  const limiter = rateLimit({
    windowMs: deps.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    max: deps.rateLimit?.max ?? DEFAULT_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many advisory requests, please slow down and try again shortly.",
    },
  });

  /** The 200 body for "advisor not configured". */
  const unavailableBody = (id: number) => ({
    available: false,
    providerId: id,
    disclaimer: deps.disclaimer,
    assessment: null,
    cached: false,
    inconclusive: false,
    generatedAt: null,
    model: null,
    mock: false,
    demoLimitReached: false,
    note: null,
  });

  /** The 200 body for a real assessment (fresh, cached or fixture fallback). */
  const successBody = (
    id: number,
    outcome: AdvisorySuccess,
    demoLimitReached: boolean
  ) => ({
    available: true,
    providerId: id,
    disclaimer: deps.disclaimer,
    assessment: outcome.assessment,
    cached: outcome.cached,
    inconclusive: outcome.inconclusive,
    generatedAt: outcome.generatedAt,
    model: outcome.model,
    mock: outcome.mock,
    demoLimitReached,
    note: demoLimitReached ? DEMO_LIMIT_NOTE : null,
  });

  /**
   * Serve a result without spending a live call: a fresh cache entry if one
   * exists, otherwise the injected fixture fallback, otherwise an `unknown`
   * assessment. Always flagged `demoLimitReached`.
   */
  const serveFromBudget = async (
    id: number,
    evidence: ReliabilityEvidence
  ): Promise<AdvisorySuccess> => {
    const cached = deps.advisor?.peek?.(id) ?? null;
    if (cached !== null) return cached;

    if (deps.fallbackAssessment) {
      const assessment = await deps.fallbackAssessment(id, evidence);
      return {
        kind: "ok",
        providerId: id,
        assessment,
        cached: false,
        inconclusive: false,
        generatedAt: reliabilityOptions.now?.().toISOString() ?? new Date().toISOString(),
        model: "demo-fixture",
        mock: true,
      };
    }

    return {
      kind: "ok",
      providerId: id,
      assessment: {
        risk_level: "unknown",
        reasons: [DEMO_LIMIT_NOTE],
        evidence_cited: [],
        uncertain: [],
        recommended_action: "Try again after the daily budget resets at 00:00 UTC.",
      },
      cached: false,
      inconclusive: true,
      generatedAt: reliabilityOptions.now?.().toISOString() ?? new Date().toISOString(),
      model: "demo-fixture",
      mock: true,
    };
  };

  router.get(
    "/providers/:id/advisory",
    limiter,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: "Invalid provider ID" });
          return;
        }

        const snapshot = await store.getProviderReliabilitySnapshot(id);
        if (snapshot === null) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }

        // Not configured: answer 200 with `available: false` rather than an
        // error, so the UI can hide the panel without treating it as a fault.
        if (deps.advisor === null) {
          res.json(unavailableBody(id));
          return;
        }

        const evidence = buildReliabilityEvidence(snapshot, reliabilityOptions);

        // A mock advisor (fixtures) and the inconclusive short-circuit spend no
        // live call, so the daily budget does not gate them: a demo with no Meta
        // key must keep working past the cap. `tryConsume` is therefore only
        // consulted for a real advisor. When the budget is spent, serve a
        // cached/sample result rather than failing.
        const spendsLiveCall = deps.advisor.mock !== true;
        if (spendsLiveCall && budget !== null && !budget.tryConsume()) {
          log.warn({ providerId: id }, "advisory daily budget exhausted; serving fallback");
          res.json(successBody(id, await serveFromBudget(id, evidence), true));
          return;
        }

        const outcome = await deps.advisor.assess(id, evidence, {
          refresh: wantsRefresh(req.query),
        });

        if (outcome.kind === "unavailable") {
          log.warn({ providerId: id, reason: outcome.reason }, "advisor unavailable");
          res.json(unavailableBody(id));
          return;
        }

        res.json(successBody(id, outcome, false));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, "advisory route failed");
        res.status(500).json({ error: msg });
      }
    }
  );

  return router;
}
