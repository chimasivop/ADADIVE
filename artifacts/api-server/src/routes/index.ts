import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providersRouter from "./providers";
import dealsRouter from "./deals";
import statsRouter from "./stats";
import waitlistRouter from "./waitlist";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(providersRouter);
router.use(dealsRouter);
router.use(statsRouter);
router.use(waitlistRouter);

export default router;
