import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providersRouter from "./providers";
import dealsRouter from "./deals";
import statsRouter from "./stats";
import waitlistRouter from "./waitlist";
import storageRouter from "./storage";
import authRouter from "./auth";
import seedRouter from "./seed";
import { createProviderStorageRouter } from "./provider";
import { createAdvisoryRouter } from "./advisory";
import { createRecommendationRouter } from "./recommend";
import { drizzleProviderStorageStore } from "../lib/providerStorageDrizzle";
import { authMiddleware } from "../middlewares/authMiddleware";
import { logger } from "../lib/logger";
import {
  ADVISORY_DISCLAIMER,
  assessFromFixture,
  createAdvisoryServiceFromEnv,
  createRecommendationServiceFromEnv,
  RECOMMENDATION_DISCLAIMER,
} from "@workspace/reliability-agent";
import { createDailyBudgetFromEnv, createRateLimitFromEnv } from "../lib/advisoryBudget";

const router: IRouter = Router();

// Apply auth middleware globally so req.isAuthenticated() is available on every request
router.use(authMiddleware);

// The provider-storage router is built here, at composition time, so its store
// and the internal-feed token are chosen in one place rather than read by the
// module as a side effect of being imported. Mounted after `authMiddleware` so
// `requireWalletOrOidcAuth` sees `req.isAuthenticated`.
router.use(
  createProviderStorageRouter({
    store: drizzleProviderStorageStore,
    internalToken: process.env.INTERNAL_API_TOKEN ?? null,
  })
);

// The read-only AI advisory surface. Built here too, so the Meta client, the
// cache TTL, the concurrency cap and the demo's daily live-call budget are
// chosen once. `available` is false when no Meta key is set and mock mode is
// off, and the route says so rather than erroring — the UI hides the panel.
// Advisory only: this never signs, releases funds, or changes a deal.
const advisor = createAdvisoryServiceFromEnv(process.env);
if (!advisor.available) {
  logger.info(
    { reason: advisor.reason },
    "reliability advisor is not configured; the advisory endpoint will report unavailable"
  );
}
// The daily live-call budget and the per-IP limit only bound *paid* calls, so a
// mock advisor needs neither. They are still wired for a live advisor: the cap
// is the global backstop on spend, and the fixture fallback keeps the panel
// useful (with a clear "demo limit reached" note) once the cap is hit.
const advisoryBudget = createDailyBudgetFromEnv(process.env);
router.use(
  createAdvisoryRouter({
    store: drizzleProviderStorageStore,
    advisor: advisor.available ? advisor.service : null,
    disclaimer: ADVISORY_DISCLAIMER,
    budget: advisor.available && !advisor.mock ? advisoryBudget : null,
    rateLimit: createRateLimitFromEnv(process.env),
    fallbackAssessment: (providerId, evidence) =>
      assessFromFixture(evidence, advisor.model, logger),
  })
);

// The recommendation advisor: the same Meta client and the same daily budget as
// the advisory surface, but a separate service because it explains a list the
// deterministic ranker has already ordered. `available` is false when no key is
// set and mock mode is off — the route then returns the deterministic ranking
// with an "AI explanation unavailable" note rather than erroring.
const recommendation = createRecommendationServiceFromEnv(process.env);
if (!recommendation.available) {
  logger.info(
    { reason: recommendation.reason },
    "recommendation advisor is not configured; the route will return the deterministic ranking"
  );
}

router.use(healthRouter);
router.use(storageRouter);
// Mounted *before* `providersRouter` so `/providers/recommend` is matched
// before `/providers/:id` (which would otherwise read "recommend" as an id).
router.use(
  createRecommendationRouter({
    store: drizzleProviderStorageStore,
    advisor: recommendation.available ? recommendation.service : null,
    disclaimer: RECOMMENDATION_DISCLAIMER,
    budget: recommendation.available && !recommendation.mock ? advisoryBudget : null,
    rateLimit: createRateLimitFromEnv(process.env),
  })
);
router.use(providersRouter);
router.use(dealsRouter);
router.use(statsRouter);
router.use(waitlistRouter);
router.use("/auth", authRouter);
router.use("/seed", seedRouter);

export default router;
