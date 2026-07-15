import { Router, type IRouter } from "express";
import { eq, and, desc, lt, gte, inArray, notInArray } from "drizzle-orm";
import { db, betsTable, parlaysTable, parlayLegsTable, usersTable } from "@workspace/db";
import { GetNeedsSettlingQueryParams } from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { todayInTimeZone } from "../lib/dates";
import { formatBet } from "./bets";
import { formatParlay } from "./parlays";

const router: IRouter = Router();

// GET /settlement/needs-settling — the signed-in user's overdue pending items.
//
// A straight bet needs settling when its game date is strictly before today.
// A parlay needs settling only when EVERY leg's game date is before today —
// a parlay can't be graded while any leg is still upcoming.
//
// "Today" is the bettor's local day when the client supplies its timezone —
// otherwise the nag would flip at UTC midnight, hours before a west-of-UTC
// bettor's game day has actually ended.
router.get("/settlement/needs-settling", requireProfile, async (req, res): Promise<void> => {
  const query = GetNeedsSettlingQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const userId = req.currentUser!.id;
  // Today's date as YYYY-MM-DD in the bettor's timezone (UTC fallback) —
  // game dates are stored as plain dates.
  const today = todayInTimeZone(query.data.tz);

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
