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
 * The model call is the expensive part, so it goes through the shared
 * `AdvisoryService`, which caches each provider's assessment for a TTL (60s) and
 * caps concurrent model calls. `?refresh=1` skips a fresh cache entry (the UI's
 * refresh button) without multiplying calls for the same provider.
 *
 * ## Fail-safe
 *
 * `available: false` means the advisor is not configured (no Meta key and mock
 * off) — the UI hides the panel. A model or transport failure is not an error
 * here: `AdvisoryService.assess` is total and answers an `unknown` assessment, so
 * the route stays 200 and the page keeps working.
 *
 * The store and the advisor are injected, so the route is testable over HTTP with
 * an in-memory store and a stub advisor, exactly like the other provider routes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import type { AdvisoryOutcome } from "@workspace/reliability-agent";

import { logger as defaultLogger } from "../lib/logger";
import type { ProviderStorageStore } from "../lib/providerStorage";
import {
  buildReliabilityEvidence,
  DEFAULT_CONSECUTIVE_NEGATIVES,
  DEFAULT_HEARTBEAT_STALE_MS,
} from "../lib/reliabilityEvidence";

/** The advisor, reduced to what the route needs (so a stub can stand in). */
export interface AdvisorLike {
  assess(
    providerId: number,
    evidence: ReturnType<typeof buildReliabilityEvidence>,
    opts?: { refresh?: boolean }
  ): Promise<AdvisoryOutcome>;
}

export interface AdvisoryRouterDeps {
  store: ProviderStorageStore;
  /** `null` when the advisor is not configured; the route reports unavailable. */
  advisor: AdvisorLike | null;
  /** The disclaimer shown with every assessment. */
  disclaimer: string;
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
  const reliabilityOptions = {
    heartbeatStaleMs: deps.reliability?.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS,
    consecutiveNegatives: deps.reliability?.consecutiveNegatives ?? DEFAULT_CONSECUTIVE_NEGATIVES,
    now: deps.reliability?.now,
  };

  const router: IRouter = Router();

  router.get(
    "/providers/:id/advisory",
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
          res.json({
            available: false,
            providerId: id,
            disclaimer: deps.disclaimer,
            assessment: null,
            cached: false,
            inconclusive: false,
            generatedAt: null,
            model: null,
            mock: false,
          });
          return;
        }

        const evidence = buildReliabilityEvidence(snapshot, reliabilityOptions);
        const outcome = await deps.advisor.assess(id, evidence, {
          refresh: wantsRefresh(req.query),
        });

        if (outcome.kind === "unavailable") {
          log.warn({ providerId: id, reason: outcome.reason }, "advisor unavailable");
          res.json({
            available: false,
            providerId: id,
            disclaimer: deps.disclaimer,
            assessment: null,
            cached: false,
            inconclusive: false,
            generatedAt: null,
            model: null,
            mock: false,
          });
          return;
        }

        res.json({
          available: true,
          providerId: id,
          disclaimer: deps.disclaimer,
          assessment: outcome.assessment,
          cached: outcome.cached,
          inconclusive: outcome.inconclusive,
          generatedAt: outcome.generatedAt,
          model: outcome.model,
          mock: outcome.mock,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, "advisory route failed");
        res.status(500).json({ error: msg });
      }
    }
  );

  return router;
}
