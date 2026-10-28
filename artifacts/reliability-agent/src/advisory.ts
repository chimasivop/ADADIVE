/**
 * The server-side advisory service: evidence in, cached structured assessment
 * out.
 *
 * This is the piece the api-server embeds. It exists here (rather than in the
 * api-server) so the model call, the prompt, the schema and the caching live in
 * one package and cannot drift between the CLI and the HTTP surface.
 *
 * Three properties it is responsible for:
 *
 *   1. **Cost control.** An assessment is cached per provider for a TTL
 *      (default 60s), and concurrent model calls are capped by a semaphore. A
 *      burst of UI requests for the same provider collapses to one call
 *      (single-flight), and a burst across providers queues behind the cap.
 *   2. **Fail-safe.** `assessProvider` is total, so a transport error or
 *      invalid model output becomes an `unknown` assessment rather than a
 *      thrown error. This service never throws for a model problem.
 *   3. **Inconclusive short-circuit.** When the evidence cannot support any
 *      judgement (a provider with no node and no assignments), the result is
 *      `unknown` *without* a model call — it saves the spend and cannot be
 *      talked into a risk level by the model.
 *
 * It mutates nothing: no signing, no fund release, no deal change.
 */

import { assessProvider } from "./assess";
import { isMockEnabled } from "./config";
import type { ReliabilityEvidence } from "./evidence";
import { silentLogger, type Logger } from "./logger";
import { HttpMetaClient, type ModelClient } from "./metaClient";
import { FixtureMetaClient } from "./mockClient";
import { unknownAssessment, type Assessment } from "./schema";

/** Shown with every assessment. The advisor is advice, never a guarantee. */
export const ADVISORY_DISCLAIMER = "AI advisory, not a guarantee";

export const DEFAULT_CACHE_TTL_MS = 60_000;
export const DEFAULT_MAX_CONCURRENCY = 2;

/** A successful assessment (which may itself be `unknown`). */
export interface AdvisorySuccess {
  kind: "ok";
  providerId: number;
  assessment: Assessment;
  /** True when this came from the cache rather than a fresh model call. */
  cached: boolean;
  /** True when the evidence was too thin to judge, so no model call was made. */
  inconclusive: boolean;
  generatedAt: string;
  model: string;
  mock: boolean;
}

/** The advisor is not configured (no key and mock off). Not an error. */
export interface AdvisoryUnavailable {
  kind: "unavailable";
  reason: string;
}

export type AdvisoryOutcome = AdvisorySuccess | AdvisoryUnavailable;

/**
 * Is there nothing here to judge?
 *
 * A provider with no storage node that has never heartbeated, or one with no
 * assignments at all, offers no liveness and no verification evidence. Both are
 * the "new provider" case: the honest answer is `unknown`, and it is cheaper and
 * more predictable to decide it here than to hope the model says so.
 */
export function isEvidenceInconclusive(evidence: ReliabilityEvidence): boolean {
  const s = evidence.summary;
  if (s.assignmentCount > 0) return false;
  return s.noRegisteredNode || s.neverHeartbeated;
}

/**
 * A counting semaphore. `run` admits at most `max` tasks at once; the rest wait
 * in FIFO order. Used to cap concurrent model calls so a page load cannot open
 * an unbounded number of paid requests.
 */
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

export interface AdvisoryServiceDeps {
  /** `null` means "no model available"; every call returns `unavailable`. */
  client: ModelClient | null;
  model: string;
  mock: boolean;
  cacheTtlMs?: number;
  maxConcurrency?: number;
  /** Injectable clock, so the TTL is testable without sleeping. */
  now?: () => number;
  logger?: Logger;
  /** The reason reported when `client` is `null`. */
  unavailableReason?: string;
}

export class AdvisoryService {
  private readonly client: ModelClient | null;
  private readonly model: string;
  private readonly mock: boolean;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly unavailableReason: string;
  private readonly semaphore: Semaphore;
  private readonly cache = new Map<number, { outcome: AdvisorySuccess; expiresAt: number }>();
  private readonly inFlight = new Map<number, Promise<AdvisoryOutcome>>();

  constructor(deps: AdvisoryServiceDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.mock = deps.mock;
    this.ttlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
    this.logger = deps.logger ?? silentLogger;
    this.unavailableReason =
      deps.unavailableReason ?? "no model client is configured for the reliability advisor";
    this.semaphore = new Semaphore(Math.max(1, deps.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY));
  }

  /**
   * Assess one provider. Total: it never throws.
   *
   * `refresh` skips a fresh cache entry (the UI's refresh button) but still
   * shares an already-running computation, so a refresh storm cannot multiply
   * model calls.
   */
  async assess(
    providerId: number,
    evidence: ReliabilityEvidence,
    opts: { refresh?: boolean } = {}
  ): Promise<AdvisoryOutcome> {
    const client = this.client;
    if (client === null) {
      return { kind: "unavailable", reason: this.unavailableReason };
    }

    if (!opts.refresh) {
      const hit = this.cache.get(providerId);
      if (hit && hit.expiresAt > this.now()) {
        return { ...hit.outcome, cached: true };
      }
    }

    const pending = this.inFlight.get(providerId);
    if (pending) return pending;

    const run = this.compute(providerId, evidence, client).finally(() => {
      this.inFlight.delete(providerId);
    });
    this.inFlight.set(providerId, run);
    return run;
  }

  private async compute(
    providerId: number,
    evidence: ReliabilityEvidence,
    client: ModelClient
  ): Promise<AdvisoryOutcome> {
    if (isEvidenceInconclusive(evidence)) {
      this.logger.info("evidence is inconclusive; returning unknown without a model call", {
        providerId,
      });
      const outcome: AdvisorySuccess = {
        kind: "ok",
        providerId,
        assessment: unknownAssessment(
          "the evidence is inconclusive: the provider has no storage node and no assignments to judge"
        ),
        cached: false,
        inconclusive: true,
        generatedAt: new Date(this.now()).toISOString(),
        model: this.model,
        mock: this.mock,
      };
      this.store(providerId, outcome);
      return outcome;
    }

    // The semaphore is held only across the model call, so the cap is on
    // concurrent *calls*, not on the whole request path.
    return this.semaphore.run(async () => {
      const { assessment } = await assessProvider(evidence, {
        model: this.model,
        client,
        logger: this.logger,
      });
      const outcome: AdvisorySuccess = {
        kind: "ok",
        providerId,
        assessment,
        cached: false,
        inconclusive: false,
        generatedAt: new Date(this.now()).toISOString(),
        model: this.model,
        mock: this.mock,
      };
      this.store(providerId, outcome);
      return outcome;
    });
  }

  private store(providerId: number, outcome: AdvisorySuccess): void {
    this.cache.set(providerId, { outcome, expiresAt: this.now() + this.ttlMs });
  }

  /** Drop one provider's cached assessment, or all of them. */
  clear(providerId?: number): void {
    if (providerId === undefined) this.cache.clear();
    else this.cache.delete(providerId);
  }

  /** Visible for tests: how many assessments are cached right now. */
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

/** The service plus the facts the caller needs to describe it. */
export interface AdvisorEnvHandle {
  service: AdvisoryService;
  model: string;
  mock: boolean;
  /** False when no model can be reached (no key, mock off). */
  available: boolean;
  /** Why it is unavailable, or `null` when available. */
  reason: string | null;
}

/**
 * Build the advisory service from the environment.
 *
 * Precedence, matching the CLI's `loadConfig`: `META_MOCK` wins (fixtures, no
 * key), then a real key, then nothing (the endpoint reports itself
 * unavailable). It never throws — an unconfigured advisor is a normal state the
 * UI hides, not a crash.
 */
export function createAdvisoryServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = silentLogger
): AdvisorEnvHandle {
  const mock = isMockEnabled(env);
  const model = (env.META_MODEL ?? "").trim() || "muse-spark-1.3";
  const cacheTtlMs = positiveInt(env.RELIABILITY_AGENT_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
  const maxConcurrency = positiveInt(
    env.RELIABILITY_AGENT_MAX_CONCURRENCY,
    DEFAULT_MAX_CONCURRENCY
  );

  let client: ModelClient | null = null;
  let reason: string | null = null;

  if (mock) {
    client = new FixtureMetaClient({ logger });
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

  const service = new AdvisoryService({
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
