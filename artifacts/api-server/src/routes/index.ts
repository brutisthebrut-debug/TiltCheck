import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import betsRouter from "./bets";
import parlaysRouter from "./parlays";
import settlementRouter from "./settlement";
import exportRouter from "./export";
import bankrollRouter from "./bankroll";
import statsRouter from "./stats";
import badgesRouter from "./badges";
import workspaceRouter from "./workspace";
import adminRouter from "./admin";
import billingRouter from "./billing";
import crewsRouter from "./crews";
import { requireAuth } from "../middlewares/auth";
import { demoReadOnly, demoSession } from "../middlewares/demo";

const router: IRouter = Router();

// Public
router.use(healthRouter);

// Public demo board — no sign-in, strictly read-only, and scoped to the
// fictional demo crew (see middlewares/demo.ts and lib/scope.ts). Reuses the
// exact same route handlers as the real app so the demo IS the product.
// Admin routes are deliberately not mounted here.
const demoRouter: IRouter = Router();
demoRouter.use(demoReadOnly);
demoRouter.use(demoSession);
demoRouter.use(usersRouter);
demoRouter.use(betsRouter);
demoRouter.use(parlaysRouter);
demoRouter.use(settlementRouter);
demoRouter.use(exportRouter);
demoRouter.use(bankrollRouter);
demoRouter.use(statsRouter);
demoRouter.use(badgesRouter);
demoRouter.use(workspaceRouter);
// Crews on the demo mount are read-only by demoReadOnly: the switcher can
// list the sealed demo crew, but create/join/switch writes are rejected.
demoRouter.use(crewsRouter);
router.use("/demo", demoRouter);

// Everything below requires a signed-in session
router.use(requireAuth);
router.use(usersRouter);
router.use(betsRouter);
router.use(parlaysRouter);
router.use(settlementRouter);
router.use(exportRouter);
router.use(bankrollRouter);
router.use(statsRouter);
router.use(badgesRouter);
router.use(workspaceRouter);
router.use(adminRouter);
// Billing is deliberately NOT mounted on the demo router — the demo world
// reports Pro via its own bypass in requirePro, never through checkout.
router.use(billingRouter);
router.use(crewsRouter);

export default router;
