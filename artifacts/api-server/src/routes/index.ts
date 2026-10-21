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
import { drizzleProviderStorageStore } from "../lib/providerStorageDrizzle";
import { authMiddleware } from "../middlewares/authMiddleware";

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

router.use(healthRouter);
router.use(storageRouter);
router.use(providersRouter);
router.use(dealsRouter);
router.use(statsRouter);
router.use(waitlistRouter);
router.use("/auth", authRouter);
router.use("/seed", seedRouter);

export default router;
