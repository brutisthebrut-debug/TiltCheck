import { Router, type IRouter } from "express";
import { eq, and, desc, lt, gte, inArray, notInArray } from "drizzle-orm";
import { db, betsTable, parlaysTable, parlayLegsTable, usersTable } from "@workspace/db";
import { dayOf } from "@workspace/weeks";
import { requireProfile } from "../middlewares/auth";
import { formatBet } from "./bets";
import { formatParlay } from "./parlays";

const router: IRouter = Router();

// GET /settlement/needs-settling — the signed-in user's overdue pending items.
//
// A straight bet needs settling when its game date is strictly before today.
// A parlay needs settling only when EVERY leg's game date is before today —
// a parlay can't be graded while any leg is still upcoming.
router.get("/settlement/needs-settling", requireProfile, async (req, res): Promise<void> => {
  const userId = req.currentUser!.id;
  // Today's date (UTC) as YYYY-MM-DD — game dates are stored as plain dates.
  const today = dayOf(new Date());

  const betRows = await db
    .select({ bet: betsTable, user: usersTable })
    .from(betsTable)
    .leftJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(and(eq(betsTable.userId, userId), eq(betsTable.status, "pending"), lt(betsTable.gameDate, today)))
    .orderBy(betsTable.gameDate, desc(betsTable.id));

  // Pending parlays with no leg on or after today (i.e. all legs finished).
  const parlayRows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .leftJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(
      and(
        eq(parlaysTable.userId, userId),
        eq(parlaysTable.status, "pending"),
        // Guard against zero-leg data anomalies: a parlay with no legs would
        // vacuously pass the "no unfinished leg" check below.
        inArray(
          parlaysTable.id,
          db.select({ id: parlayLegsTable.parlayId }).from(parlayLegsTable)
        ),
        notInArray(
          parlaysTable.id,
          db
            .select({ id: parlayLegsTable.parlayId })
            .from(parlayLegsTable)
            .where(gte(parlayLegsTable.gameDate, today))
        )
      )
    )
    .orderBy(desc(parlaysTable.createdAt), desc(parlaysTable.id));

  // Reuse the same response shapes as the list endpoints.
  const bets = betRows.map(({ bet, user }) => formatBet(bet, user?.displayName ?? "Unknown"));
  const parlays = await Promise.all(
    parlayRows.map(({ parlay, user }) => formatParlay(parlay, user?.displayName ?? "Unknown"))
  );

  res.json({ count: bets.length + parlays.length, bets, parlays });
});

export default router;
