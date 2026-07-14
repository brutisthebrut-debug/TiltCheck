import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import betsRouter from "./bets";
import parlaysRouter from "./parlays";
import settlementRouter from "./settlement";
import bankrollRouter from "./bankroll";
import statsRouter from "./stats";
import workspaceRouter from "./workspace";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public
router.use(healthRouter);

// Everything below requires a signed-in session
router.use(requireAuth);
router.use(usersRouter);
router.use(betsRouter);
router.use(parlaysRouter);
router.use(settlementRouter);
router.use(bankrollRouter);
router.use(statsRouter);
router.use(workspaceRouter);

export default router;
