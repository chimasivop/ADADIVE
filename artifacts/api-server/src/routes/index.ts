import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providersRouter from "./providers";
import dealsRouter from "./deals";
import statsRouter from "./stats";
import waitlistRouter from "./waitlist";
import storageRouter from "./storage";
import authRouter from "./auth";
import { authMiddleware } from "../middlewares/authMiddleware";

const router: IRouter = Router();

// Apply auth middleware globally so req.isAuthenticated() is available on every request
router.use(authMiddleware);

router.use(healthRouter);
router.use(storageRouter);
router.use(providersRouter);
router.use(dealsRouter);
router.use(statsRouter);
router.use(waitlistRouter);
router.use("/auth", authRouter);

export default router;
