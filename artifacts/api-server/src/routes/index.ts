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
import { drizzleProviderStorageStore } from "../lib/providerStorageDrizzle";
import { authMiddleware } from "../middlewares/authMiddleware";
import { logger } from "../lib/logger";
import {
  ADVISORY_DISCLAIMER,
  assessFromFixture,
  createAdvisoryServiceFromEnv,
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

router.use(healthRouter);
router.use(storageRouter);
router.use(providersRouter);
router.use(dealsRouter);
router.use(statsRouter);
router.use(waitlistRouter);
router.use("/auth", authRouter);
router.use("/seed", seedRouter);

export default router;
