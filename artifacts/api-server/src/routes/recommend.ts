/**
 * The read-only provider *recommendation* endpoint the New Deal page calls.
 *
 * `GET /api/providers/recommend?storageGb=&durationEpochs=&region=` returns the
 * top candidates for a deal the customer is describing: a deterministic ranking
 * (see `@workspace/reliability-agent`'s `ranking.ts`) with, on top of it, a
 * plain-language explanation per candidate written by the Meta model.
 *
 * ## Advisory only, and read-only
 *
 * It never selects a provider, never signs, never releases funds and never
 * changes a deal — it returns a list the customer may ignore. The customer still
 * picks the provider and still signs everything. The route serves GET only, and
 * the store method it calls mutates nothing.
 *
 * ## The model does not rank
 *
 * The order, the scores and the set of candidates are the deterministic ranker's.
 * The model is asked only to rewrite the prose, keyed by index, and anything it
 * returns for an index that was not sent is dropped. So a model failure — or a
 * model that tries to promote its favourite — cannot change who is recommended.
 *
 * ## Cost controls (shared with the advisory endpoint)
 *
 *   1. **Cache** — `RecommendationService` caches per query for a TTL (60s).
 *   2. **Per-IP rate limit** — the same `ADVISORY_RATE_LIMIT_MAX` /
 *      `ADVISORY_RATE_LIMIT_WINDOW_MS` settings as the advisory route.
 *   3. **Global daily live-call cap** — the same `ADVISORY_DAILY_CALL_CAP`
 *      (default 200). When it is spent the route does not fail: it serves a fresh
 *      cached result if one exists, otherwise the deterministic ranking, and sets
 *      `demoLimitReached: true` with a note. Only a *live* call spends budget; a
 *      mock advisor and the deterministic fallback spend nothing.
 *
 * ## Fail-safe
 *
 * An unconfigured advisor (`available: false`), a transport error, invalid model
 * output or an empty candidate list all return 200 with the deterministic
 * ranking and a note. The page never breaks.
 *
 * ## Route ordering
 *
 * `/providers/recommend` must be registered *before* `/providers/:id`, or the
 * latter would capture `recommend` as an id. `routes/index.ts` mounts this router
 * first; `recommendationEndpoints.test.ts` proves it.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { providerRecommendationQuery } from "@workspace/api-zod";
import {
  AI_EXPLANATION_UNAVAILABLE_NOTE,
  deterministicRecommendation,
  NOT_ENOUGH_EVIDENCE_LABEL,
  type RecommendationCandidateInput,
  type RecommendationOutcome,
  type RecommendationQuery,
  type RecommendationSuccess,
  type RecommendedCandidate,
} from "@workspace/reliability-agent";

import { logger as defaultLogger } from "../lib/logger";
import type { ProviderStorageStore } from "../lib/providerStorage";
import {
  buildReliabilityEvidence,
  DEFAULT_CONSECUTIVE_NEGATIVES,
  DEFAULT_HEARTBEAT_STALE_MS,
} from "../lib/reliabilityEvidence";
import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  type AdvisoryBudget,
} from "../lib/advisoryBudget";
import { DEMO_LIMIT_NOTE } from "./advisory";

/** The advisor, reduced to what the route needs (so a stub can stand in). */
export interface RecommendationAdvisorLike {
  recommend(
    candidates: RecommendationCandidateInput[],
    query: RecommendationQuery,
    opts?: { refresh?: boolean }
  ): Promise<RecommendationOutcome>;
  /** True when the advisor replays fixtures and spends no live call. */
  readonly mock?: boolean;
  /** A fresh cached result without a model call, or `null`. */
  peek?(query: RecommendationQuery): RecommendationSuccess | null;
}

export interface RecommendationRouterDeps {
  store: ProviderStorageStore;
  /** `null` when the advisor is not configured; the route still ranks. */
  advisor: RecommendationAdvisorLike | null;
  /** The disclaimer shown with every recommendation. */
  disclaimer: string;
  /**
   * The daily live-call budget. Omitted/`null` means unlimited.
   */
  budget?: AdvisoryBudget | null;
  /** Per-IP rate-limit settings. Defaults are safe for a public demo. */
  rateLimit?: { windowMs?: number; max?: number };
  log?: Pick<typeof defaultLogger, "debug" | "warn" | "error">;
  reliability?: {
    heartbeatStaleMs?: number;
    consecutiveNegatives?: number;
    now?: () => Date;
  };
}

/** `?refresh=1` / `?refresh=true` / `?refresh=yes` forces a fresh explanation. */
function wantsRefresh(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** The human label for a candidate: an explicit "not enough evidence" when so. */
function candidateLabel(candidate: RecommendedCandidate): string {
  if (!candidate.sufficientEvidence) return NOT_ENOUGH_EVIDENCE_LABEL;
  switch (candidate.riskLevel) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
    default:
      return "Unknown";
  }
}

export function createRecommendationRouter(deps: RecommendationRouterDeps): IRouter {
  const { store } = deps;
  const log = deps.log ?? defaultLogger;
  const budget = deps.budget ?? null;
  const reliabilityOptions = {
    heartbeatStaleMs: deps.reliability?.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS,
    consecutiveNegatives: deps.reliability?.consecutiveNegatives ?? DEFAULT_CONSECUTIVE_NEGATIVES,
    now: deps.reliability?.now,
  };

  const router: IRouter = Router();

  const limiter = rateLimit({
    windowMs: deps.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    max: deps.rateLimit?.max ?? DEFAULT_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many recommendation requests, please slow down and try again shortly.",
    },
  });

  const candidateBody = (candidate: RecommendedCandidate) => ({
    rank: candidate.rank,
    providerId: candidate.providerId,
    name: candidate.name,
    region: candidate.region,
    score: candidate.score,
    reliabilityScore: candidate.reliabilityScore,
    riskLevel: candidate.riskLevel,
    sufficientEvidence: candidate.sufficientEvidence,
    label: candidateLabel(candidate),
    availableGb: candidate.availableGb,
    pricePerGbPerEpoch: candidate.pricePerGbPerEpoch,
    estimatedCostSol: candidate.estimatedCostSol,
    reasons: candidate.reasons,
    uncertain: candidate.uncertain,
    explanationSource: candidate.explanationSource,
  });

  /** The 200 body for any deterministic or AI-explained result. */
  const successBody = (
    outcome: RecommendationSuccess,
    opts: { available: boolean; demoLimitReached: boolean }
  ) => {
    const note = opts.demoLimitReached
      ? DEMO_LIMIT_NOTE
      : outcome.explanationSource === "deterministic"
        ? AI_EXPLANATION_UNAVAILABLE_NOTE
        : null;
    return {
      available: opts.available,
      disclaimer: deps.disclaimer,
      query: outcome.query,
      candidates: outcome.candidates.map(candidateBody),
      bestProviderId: outcome.bestProviderId,
      allInsufficientEvidence: outcome.allInsufficientEvidence,
      consideredCount: outcome.consideredCount,
      filteredOut: outcome.filteredOut,
      cached: outcome.cached,
      explanationSource: outcome.explanationSource,
      aiUnavailableReason: outcome.aiUnavailableReason,
      demoLimitReached: opts.demoLimitReached,
      note,
      generatedAt: outcome.generatedAt,
      model: outcome.model,
      mock: outcome.mock,
    };
  };

  /** Build the ranker's input from the store's candidates. */
  const buildCandidates = async (
    minStorageGb: number
  ): Promise<RecommendationCandidateInput[]> => {
    const snapshots = await store.listRecommendationCandidates(minStorageGb);
    return snapshots.map((snapshot) => ({
      evidence: buildReliabilityEvidence(snapshot, reliabilityOptions),
      totalStorageGb: snapshot.provider.totalStorageGb,
      usedStorageGb: snapshot.provider.usedStorageGb,
      pricePerGbPerEpoch: snapshot.provider.pricePerGbPerEpoch,
    }));
  };

  router.get(
    "/providers/recommend",
    limiter,
    async (req: Request, res: Response): Promise<void> => {
      try {
        // Parsed here rather than by the generic `validate` middleware: Express 5
        // exposes `req.query` as a getter with no setter, so the middleware (which
        // assigns the parsed query back) would throw. `safeParse` + reading the
        // parsed value validates and coerces without touching `req.query`.
        const parsed = providerRecommendationQuery.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            success: false,
            error: "Invalid request data",
            details: parsed.error.errors.map((e) => ({
              field: e.path.join(".") || "(root)",
              message: e.message,
            })),
          });
          return;
        }

        const { storageGb, durationEpochs, refresh } = parsed.data;
        const region = parsed.data.region ?? null;
        const query: RecommendationQuery = { storageGb, durationEpochs, region };

        const candidates = await buildCandidates(storageGb);

        // Not configured: still rank, but say the explanation is unavailable
        // rather than failing. The page keeps its recommendations.
        if (deps.advisor === null) {
          const outcome = deterministicRecommendation(candidates, query, {
            generatedAt: reliabilityOptions.now?.().toISOString(),
            reason: "the reliability advisor is not configured",
          });
          res.json(successBody(outcome, { available: false, demoLimitReached: false }));
          return;
        }

        // A mock advisor and the deterministic fallback spend no live call, so
        // the daily budget does not gate them: a demo with no Meta key must keep
        // working past the cap. When the budget is spent, serve a cached result
        // if one exists, else the deterministic ranking.
        const spendsLiveCall = deps.advisor.mock !== true;
        if (spendsLiveCall && budget !== null && !budget.tryConsume()) {
          log.warn({ query }, "recommendation daily budget exhausted; serving fallback");
          const cached = deps.advisor.peek?.(query) ?? null;
          const outcome =
            cached ??
            deterministicRecommendation(candidates, query, {
              generatedAt: reliabilityOptions.now?.().toISOString(),
              reason: "the daily live-call budget is spent",
            });
          res.json(successBody(outcome, { available: true, demoLimitReached: true }));
          return;
        }

        const outcome = await deps.advisor.recommend(candidates, query, {
          refresh: wantsRefresh(refresh),
        });

        if (outcome.kind === "unavailable") {
          log.warn({ reason: outcome.reason }, "recommendation advisor unavailable");
          const fallback = deterministicRecommendation(candidates, query, {
            generatedAt: reliabilityOptions.now?.().toISOString(),
            reason: outcome.reason,
          });
          res.json(successBody(fallback, { available: false, demoLimitReached: false }));
          return;
        }

        res.json(successBody(outcome, { available: true, demoLimitReached: false }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, "recommendation route failed");
        res.status(500).json({ error: msg });
      }
    }
  );

  return router;
}

export default createRecommendationRouter;
