import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import betsRouter from "./bets";
import parlaysRouter from "./parlays";
import bankrollRouter from "./bankroll";
import statsRouter from "./stats";
import workspaceRouter from "./workspace";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(betsRouter);
router.use(parlaysRouter);
router.use(bankrollRouter);
router.use(statsRouter);
router.use(workspaceRouter);

export default router;
