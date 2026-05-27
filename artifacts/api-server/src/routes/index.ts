import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providersRouter from "./providers";
import dealsRouter from "./deals";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(providersRouter);
router.use(dealsRouter);
router.use(statsRouter);

export default router;
