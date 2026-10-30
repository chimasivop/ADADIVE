/**
 * The server-side recommendation service: ranked candidates in, cached
 * AI-explained candidates out.
 *
 * This is the piece the api-server embeds for `GET /api/providers/recommend`.
 * It is the recommendation analogue of `advisory.ts`, and it reuses the same
 * transport (`ModelClient`), the same caching shape and the same fail-safe
 * discipline — but it is a separate service because its contract is different:
 * it explains a *list* that a deterministic ranker has already ordered, and it
 * may not reorder that list.
 *
 * ## The model may not rank
 *
 * The order and the scores come from `ranking.ts`. The model receives the ranked
 * candidates and returns, per index, a plain-language `reasons`/`uncertain`
 * pair. Anything the model returns for an index that was not sent is dropped;
 * any index it omits keeps its deterministic prose. The model therefore cannot
 * add a provider, drop one, or change the order — the worst it can do is write
 * poor prose for a candidate that is already placed.
 *
 * ## Fail-safe
 *
 * `recommend` is total. A transport error, non-JSON output, output that fails
 * Zod validation, or output that names no candidate all fall back to the
 * deterministic result with `explanationSource: "deterministic"` and an explicit
 * reason. The page never breaks and never loses its ranking.
 *
 * ## Cost control
 *
 * The same bounds as the advisory endpoint: a per-query TTL cache, a semaphore
 * on concurrent model calls, and (in the route) a per-IP rate limit and a global
 * daily live-call cap. A cached result and a deterministic fallback spend
 * nothing.
 */

import { isMockEnabled } from "./config";
import { silentLogger, type Logger } from "./logger";
import { HttpMetaClient, type ModelClient } from "./metaClient";
import { FixtureMetaClient } from "./mockClient";
import { buildRecommendationRequest, RECOMMENDATION_FIXTURE_NAME } from "./prompt";
import {
  rankCandidates,
  type RankedCandidate,
  type RankingOptions,
  type RecommendationCandidateInput,
  type RecommendationQuery,
} from "./ranking";
import {
  recommendationExplanationSchema,
  type RecommendationExplanation,
} from "./schema";

/** Shown with every recommendation. The advisor is advice, never a guarantee. */
export const RECOMMENDATION_DISCLAIMER = "AI advisory, not a guarantee";

/** The note shown when the model could not write the explanations. */
export const AI_EXPLANATION_UNAVAILABLE_NOTE =
  "AI explanation unavailable — showing the deterministic ranking with plain reasons.";

/** The label for a candidate with too little evidence to judge. */
export const NOT_ENOUGH_EVIDENCE_LABEL = "Not enough evidence";

export const DEFAULT_RECOMMENDATION_CACHE_TTL_MS = 60_000;
export const DEFAULT_RECOMMENDATION_MAX_CONCURRENCY = 2;

/** A candidate as the route returns it: the ranking plus the explanation's origin. */
export interface RecommendedCandidate extends RankedCandidate {
  /** 1-based position in the returned list. */
  rank: number;
  explanationSource: "ai" | "deterministic";
}

/** A successful recommendation (which may carry deterministic prose only). */
export interface RecommendationSuccess {
  kind: "ok";
  query: RecommendationQuery;
  candidates: RecommendedCandidate[];
  /** The top candidate's id, or `null` when there is nothing to recommend. */
  bestProviderId: number | null;
  /** True when every returned candidate lacks sufficient evidence. */
  allInsufficientEvidence: boolean;
  consideredCount: number;
  filteredOut: number;
  /** True when this came from the cache rather than a fresh model call. */
  cached: boolean;
  explanationSource: "ai" | "deterministic";
  /** Why the explanations are deterministic, or `null` when they are from the model. */
  aiUnavailableReason: string | null;
  generatedAt: string;
  model: string | null;
  mock: boolean;
}

/** The advisor is not configured (no key and mock off). Not an error. */
export interface RecommendationUnavailable {
  kind: "unavailable";
  reason: string;
}

export type RecommendationOutcome = RecommendationSuccess | RecommendationUnavailable;

/**
 * The cache key for a query. Two requests with the same parameters share one
 * assessment, so a customer nudging the size slider does not multiply calls.
 */
export function recommendationCacheKey(query: RecommendationQuery): string {
  const region = (query.region ?? "").trim().toLowerCase();
  return `${query.storageGb}|${query.durationEpochs}|${region}`;
}

/** A counting semaphore, identical in shape to the advisory service's. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function withRanks(
  ranked: RankedCandidate[],
  source: "ai" | "deterministic"
): RecommendedCandidate[] {
  return ranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    explanationSource: source,
  }));
}

/**
 * The best provider's id, or `null` when nothing should be recommended.
 *
 * `null` covers two cases: an empty list, and a list whose top candidate has
 * insufficient evidence (rule 4 — a provider the ranker could not judge is never
 * labelled the best choice). When *every* candidate is unknown the caller sees
 * `bestProviderId: null` with `allInsufficientEvidence: true`.
 */
function bestProviderIdOf(ranked: RankedCandidate[]): number | null {
  const top = ranked[0];
  if (top === undefined || !top.sufficientEvidence) return null;
  return top.providerId;
}

/** The deterministic result, with no model call. Exported for the route's cap path. */
export function deterministicRecommendation(
  candidates: RecommendationCandidateInput[],
  query: RecommendationQuery,
  options: RankingOptions & { generatedAt?: string; reason?: string | null } = {}
): RecommendationSuccess {
  const ranking = rankCandidates(candidates, query, options);
  return {
    kind: "ok",
    query,
    candidates: withRanks(ranking.ranked, "deterministic"),
    bestProviderId: bestProviderIdOf(ranking.ranked),
    allInsufficientEvidence: ranking.allInsufficientEvidence,
    consideredCount: ranking.consideredCount,
    filteredOut: ranking.filteredOut,
    cached: false,
    explanationSource: "deterministic",
    aiUnavailableReason: options.reason ?? null,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    model: null,
    mock: false,
  };
}

/**
 * Apply a validated explanation to the ranked list.
 *
 * Only the prose changes, and only for indexes that were actually sent. The
 * order, the scores and the set of candidates are untouched — that is the
 * guarantee that the model cannot rank.
 */
function applyExplanations(
  ranked: RankedCandidate[],
  explanation: RecommendationExplanation
): RankedCandidate[] {
  const byIndex = new Map<number, { reasons: string[]; uncertain: string[] }>();
  for (const entry of explanation.candidates) {
    if (entry.index >= 0 && entry.index < ranked.length) {
      byIndex.set(entry.index, { reasons: entry.reasons, uncertain: entry.uncertain });
    }
  }
  return ranked.map((candidate, index) => {
    const found = byIndex.get(index);
    if (!found) return candidate;
    return {
      ...candidate,
      reasons: found.reasons.length > 0 ? found.reasons : candidate.reasons,
      uncertain: found.uncertain.length > 0 ? found.uncertain : candidate.uncertain,
    };
  });
}

export interface RecommendationServiceDeps {
  /** `null` means "no model available"; every call returns `unavailable`. */
  client: ModelClient | null;
  model: string;
  mock: boolean;
  cacheTtlMs?: number;
  maxConcurrency?: number;
  /** Injectable clock, so the TTL is testable without sleeping. */
  now?: () => number;
  logger?: Logger;
  unavailableReason?: string;
  /** Ranking options (list length, reference price) passed through to the ranker. */
  ranking?: RankingOptions;
}

export class RecommendationService {
  private readonly client: ModelClient | null;
  private readonly model: string;
  /** True when the service replays fixtures and spends no live model call. */
  readonly mock: boolean;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly unavailableReason: string;
  private readonly rankingOptions: RankingOptions;
  private readonly semaphore: Semaphore;
  private readonly cache = new Map<string, { outcome: RecommendationSuccess; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<RecommendationOutcome>>();

  constructor(deps: RecommendationServiceDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.mock = deps.mock;
    this.ttlMs = deps.cacheTtlMs ?? DEFAULT_RECOMMENDATION_CACHE_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
    this.logger = deps.logger ?? silentLogger;
    this.unavailableReason =
      deps.unavailableReason ?? "no model client is configured for the reliability advisor";
    this.rankingOptions = deps.ranking ?? {};
    this.semaphore = new Semaphore(
      Math.max(1, deps.maxConcurrency ?? DEFAULT_RECOMMENDATION_MAX_CONCURRENCY)
    );
  }

  /**
   * Recommend providers for a deal. Total: it never throws.
   *
   * `refresh` skips a fresh cache entry but still shares an already-running
   * computation, so a refresh storm cannot multiply model calls.
   */
  async recommend(
    candidates: RecommendationCandidateInput[],
    query: RecommendationQuery,
    opts: { refresh?: boolean } = {}
  ): Promise<RecommendationOutcome> {
    const client = this.client;
    const key = recommendationCacheKey(query);

    if (client === null) {
      return { kind: "unavailable", reason: this.unavailableReason };
    }

    if (!opts.refresh) {
      const hit = this.cache.get(key);
      if (hit && hit.expiresAt > this.now()) {
        return { ...hit.outcome, cached: true };
      }
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const run = this.compute(candidates, query, key, client).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async compute(
    candidates: RecommendationCandidateInput[],
    query: RecommendationQuery,
    key: string,
    client: ModelClient
  ): Promise<RecommendationOutcome> {
    const ranking = rankCandidates(candidates, query, this.rankingOptions);
    const generatedAt = new Date(this.now()).toISOString();

    const deterministic = (reason: string | null): RecommendationSuccess => ({
      kind: "ok",
      query,
      candidates: withRanks(ranking.ranked, "deterministic"),
      bestProviderId: bestProviderIdOf(ranking.ranked),
      allInsufficientEvidence: ranking.allInsufficientEvidence,
      consideredCount: ranking.consideredCount,
      filteredOut: ranking.filteredOut,
      cached: false,
      explanationSource: "deterministic",
      aiUnavailableReason: reason,
      generatedAt,
      model: null,
      mock: false,
    });

    // Nothing to explain: no candidate survived the filters. Skip the model call
    // entirely — there is no list for it to talk about.
    if (ranking.ranked.length === 0) {
      const outcome = deterministic(null);
      this.store(key, outcome);
      return outcome;
    }

    const request = buildRecommendationRequest(query, ranking.ranked, this.model);

    // The semaphore is held only across the model call.
    return this.semaphore.run(async () => {
      const explanation = await this.explain(client, request);

      if (explanation === null) {
        const outcome = deterministic(
          "the model returned output that could not be validated against the recommendation schema"
        );
        this.store(key, outcome);
        return outcome;
      }

      const outcome: RecommendationSuccess = {
        kind: "ok",
        query,
        candidates: withRanks(applyExplanations(ranking.ranked, explanation), "ai"),
        bestProviderId: bestProviderIdOf(ranking.ranked),
        allInsufficientEvidence: ranking.allInsufficientEvidence,
        consideredCount: ranking.consideredCount,
        filteredOut: ranking.filteredOut,
        cached: false,
        explanationSource: "ai",
        aiUnavailableReason: null,
        generatedAt,
        model: this.model,
        mock: this.mock,
      };
      this.store(key, outcome);
      return outcome;
    });
  }

  /**
   * Ask the model for the explanations and validate the recommendation schema.
   * Returns `null` — never throws — when the output is unusable, so the caller
   * falls back to the deterministic prose.
   */
  private async explain(
    client: ModelClient,
    request: ReturnType<typeof buildRecommendationRequest>
  ): Promise<RecommendationExplanation | null> {
    let content: string;
    try {
      content = await client.complete(request);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn("recommendation model call failed; using the deterministic ranking", {
        error: detail,
      });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger.warn(
        "recommendation model output was not valid JSON; using the deterministic ranking"
      );
      return null;
    }

    const result = recommendationExplanationSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(
        "recommendation model output did not match the schema; using the deterministic ranking",
        { issues: result.error.issues.map((i) => i.path.join(".") || "(root)") }
      );
      return null;
    }
    return result.data;
  }

  private store(key: string, outcome: RecommendationSuccess): void {
    this.cache.set(key, { outcome, expiresAt: this.now() + this.ttlMs });
  }

  /**
   * A fresh cached result, without touching the model. Used by the route when
   * the daily budget is spent: a cached result is free, so it is served in
   * preference to the deterministic fallback.
   */
  peek(query: RecommendationQuery): RecommendationSuccess | null {
    const hit = this.cache.get(recommendationCacheKey(query));
    if (hit && hit.expiresAt > this.now()) return { ...hit.outcome, cached: true };
    return null;
  }

  clear(): void {
    this.cache.clear();
  }

  /** Visible for tests: how many results are cached right now. */
  get cacheSize(): number {
    return this.cache.size;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export interface RecommendationEnvHandle {
  service: RecommendationService;
  model: string;
  mock: boolean;
  /** False when no model can be reached (no key, mock off). */
  available: boolean;
  /** Why it is unavailable, or `null` when available. */
  reason: string | null;
}

/**
 * Build the recommendation service from the environment.
 *
 * It shares the advisory service's env vars and adds none: `META_MOCK` wins
 * (fixtures, no key), then a real key, then nothing (the route still returns the
 * deterministic ranking, with `available: false`). It never throws.
 */
export function createRecommendationServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = silentLogger
): RecommendationEnvHandle {
  const mock = isMockEnabled(env);
  const model = (env.META_MODEL ?? "").trim() || "muse-spark-1.3";
  const cacheTtlMs = positiveInt(
    env.RELIABILITY_AGENT_CACHE_TTL_MS,
    DEFAULT_RECOMMENDATION_CACHE_TTL_MS
  );
  const maxConcurrency = positiveInt(
    env.RELIABILITY_AGENT_MAX_CONCURRENCY,
    DEFAULT_RECOMMENDATION_MAX_CONCURRENCY
  );

  let client: ModelClient | null = null;
  let reason: string | null = null;

  if (mock) {
    client = new FixtureMetaClient({ logger, fixtureName: RECOMMENDATION_FIXTURE_NAME });
  } else {
    const key = (env.META_API_KEY ?? "").trim();
    if (key.length > 0) {
      client = new HttpMetaClient({
        baseUrl: stripTrailingSlash((env.META_BASE_URL ?? "").trim() || "https://api.meta.ai/v1"),
        apiKey: key,
        timeoutMs: positiveInt(env.META_TIMEOUT_MS, 30_000),
        logger,
      });
    } else {
      reason = "no META_API_KEY is configured and META_MOCK is off";
    }
  }

  const service = new RecommendationService({
    client,
    model,
    mock,
    cacheTtlMs,
    maxConcurrency,
    logger,
    unavailableReason: reason ?? undefined,
  });

  return { service, model, mock, available: client !== null, reason };
}
