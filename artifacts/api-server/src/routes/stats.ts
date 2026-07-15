import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { db, betsTable, parlaysTable, usersTable, transactionsTable } from "@workspace/db";
import {
  GetStatsSummaryQueryParams,
  GetStatsBySportQueryParams,
  GetRecentActivityQueryParams,
  GetConfidenceAnalysisQueryParams,
  GetStatsInsightsQueryParams,
  GetWeeklyRecapQueryParams,
} from "@workspace/api-zod";
import { isValidAmericanOdds } from "../lib/odds";
import { isRealCalendarDate } from "../lib/dates";
import { computeWeeklyRecap, mondayOf, lastCompletedWeekStart, dayOf } from "../lib/recap";
import { requireProfile } from "../middlewares/auth";
import { userScopeCondition, userInScope } from "../lib/scope";

const router: IRouter = Router();

// Rows saved before the dead-zone odds guard existed may carry American odds
// between -99 and +99 — prices that don't exist. Their payout figures are
// nonsense, so stats math must skip them entirely (they are surfaced for
// re-entry by scripts/src/audit-dead-zone-odds.ts instead).
const hasValidOdds = (row: { odds: number }) => isValidAmericanOdds(row.odds);

// GET /stats/summary
router.get("/stats/summary", async (req, res): Promise<void> => {
  const query = GetStatsSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json(emptySummary(0)); return; }
    userId = u.id;
  } else if (!(await userInScope(req, userId))) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const allBets = await db.select().from(betsTable).where(eq(betsTable.userId, userId));
  const allParlays = await db.select().from(parlaysTable).where(eq(parlaysTable.userId, userId));
  const bets = allBets.filter(hasValidOdds);
  const parlays = allParlays.filter(hasValidOdds);

  const settled = bets.filter((b) => ["won", "lost", "push"].includes(b.status));
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const pushes = settled.filter((b) => b.status === "push").length;
  const pending = bets.filter((b) => b.status === "pending").length;

  // Money math (totalWagered/totalProfit/ROI) includes settled parlays
  // (won/lost/push; void excluded) so the stats page agrees with the bankroll
  // page's rule. Top-level win/loss/push counts stay straight-bet-only — the
  // parlay record is broken out separately in parlayRecord.
  const parlaySettled = parlays.filter((p) => ["won", "lost", "push"].includes(p.status));
  const totalWagered =
    settled.reduce((acc, b) => acc + Number(b.stake), 0) +
    parlaySettled.reduce((acc, p) => acc + Number(p.stake), 0);
  const totalPayout =
    settled.reduce((acc, b) => acc + (b.actualPayout != null ? Number(b.actualPayout) : 0), 0) +
    parlaySettled.reduce((acc, p) => acc + (p.actualPayout != null ? Number(p.actualPayout) : 0), 0);
  const totalProfit = totalPayout - totalWagered;
  const roi = totalWagered > 0 ? (totalProfit / totalWagered) * 100 : 0;

  const avgOdds = bets.length > 0 ? bets.reduce((acc, b) => acc + b.odds, 0) / bets.length : 0;
  const avgConfidence = bets.length > 0 ? bets.reduce((acc, b) => acc + b.confidenceScore, 0) / bets.length : 0;

  // Streaks
  const sortedSettled = [...settled].sort((a, b) => new Date(a.settledAt!).getTime() - new Date(b.settledAt!).getTime());
  let longestWin = 0, longestLoss = 0, curWin = 0, curLoss = 0;
  for (const b of sortedSettled) {
    if (b.status === "won") { curWin++; curLoss = 0; longestWin = Math.max(longestWin, curWin); }
    else if (b.status === "lost") { curLoss++; curWin = 0; longestLoss = Math.max(longestLoss, curLoss); }
    else { curWin = 0; curLoss = 0; }
  }
  const currentStreak = curWin > 0 ? curWin : curLoss > 0 ? -curLoss : 0;
  const currentStreakType = curWin > 0 ? "win" : curLoss > 0 ? "loss" : "none";

  const bestBet = settled.reduce((best, b) => {
    const p = (b.actualPayout != null ? Number(b.actualPayout) : 0) - Number(b.stake);
    return p > (best ? (Number(best.actualPayout ?? 0) - Number(best.stake)) : -Infinity) ? b : best;
  }, null as (typeof betsTable.$inferSelect) | null);
  const worstBet = settled.reduce((worst, b) => {
    const p = (b.actualPayout != null ? Number(b.actualPayout) : 0) - Number(b.stake);
    return p < (worst ? (Number(worst.actualPayout ?? 0) - Number(worst.stake)) : Infinity) ? b : worst;
  }, null as (typeof betsTable.$inferSelect) | null);

  const parlayWins = parlaySettled.filter((p) => p.status === "won").length;
  const parlayLosses = parlaySettled.filter((p) => p.status === "lost").length;
  const parlayPushes = parlaySettled.filter((p) => p.status === "push").length;

  res.json({
    userId,
    totalBets: bets.length + parlays.length,
    wins,
    losses,
    pushes,
    pending,
    winRate: settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : 0,
    totalWagered: Math.round(totalWagered * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    avgOdds: Math.round(avgOdds),
    avgConfidence: Math.round(avgConfidence * 10) / 10,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    currentStreak: Math.abs(currentStreak),
    currentStreakType,
    bestBetProfit: bestBet ? Math.round(((Number(bestBet.actualPayout ?? 0)) - Number(bestBet.stake)) * 100) / 100 : 0,
    worstBetLoss: worstBet ? Math.round(((Number(worstBet.actualPayout ?? 0)) - Number(worstBet.stake)) * 100) / 100 : 0,
    parlayRecord: { wins: parlayWins, losses: parlayLosses, pushes: parlayPushes },
    straightBetRecord: { wins, losses, pushes },
  });
});

function emptySummary(userId: number) {
  return {
    userId,
    totalBets: 0, wins: 0, losses: 0, pushes: 0, pending: 0,
    winRate: 0, totalWagered: 0, totalProfit: 0, roi: 0,
    avgOdds: 0, avgConfidence: 0, longestWinStreak: 0, longestLossStreak: 0,
    currentStreak: 0, currentStreakType: "none",
    bestBetProfit: 0, worstBetLoss: 0,
    parlayRecord: { wins: 0, losses: 0, pushes: 0 },
    straightBetRecord: { wins: 0, losses: 0, pushes: 0 },
  };
}

// GET /stats/by-sport
router.get("/stats/by-sport", async (req, res): Promise<void> => {
  const query = GetStatsBySportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json([]); return; }
    userId = u.id;
  } else if (!(await userInScope(req, userId))) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const bets = (
    await db.select().from(betsTable).where(
      and(eq(betsTable.userId, userId), inArray(betsTable.status, ["won", "lost", "push"]))
    )
  ).filter(hasValidOdds);

  const sportMap: Record<string, { wins: number; losses: number; pushes: number; wagered: number; payout: number; confidence: number[] }> = {};
  for (const b of bets) {
    if (!sportMap[b.sport]) sportMap[b.sport] = { wins: 0, losses: 0, pushes: 0, wagered: 0, payout: 0, confidence: [] };
    const s = sportMap[b.sport];
    if (b.status === "won") s.wins++;
    else if (b.status === "lost") s.losses++;
    else s.pushes++;
    s.wagered += Number(b.stake);
    s.payout += b.actualPayout != null ? Number(b.actualPayout) : 0;
    s.confidence.push(b.confidenceScore);
  }

  const result = Object.entries(sportMap).map(([sport, s]) => {
    const total = s.wins + s.losses + s.pushes;
    const profit = s.payout - s.wagered;
    return {
      sport,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      winRate: total > 0 ? Math.round((s.wins / total) * 1000) / 10 : 0,
      totalWagered: Math.round(s.wagered * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      roi: s.wagered > 0 ? Math.round((profit / s.wagered) * 10000) / 100 : 0,
      avgConfidence: s.confidence.length > 0 ? Math.round(s.confidence.reduce((a, b) => a + b, 0) / s.confidence.length * 10) / 10 : 0,
    };
  });

  res.json(result);
});

// GET /stats/recent-activity
router.get("/stats/recent-activity", async (req, res): Promise<void> => {
  const query = GetRecentActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = query.data.limit ?? 20;

  const bets = await db
    .select({ bet: betsTable, user: usersTable })
    .from(betsTable)
    .innerJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(userScopeCondition(req))
    .orderBy(desc(betsTable.createdAt))
    .limit(limit);

  const parlayRows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .innerJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(userScopeCondition(req))
    .orderBy(desc(parlaysTable.createdAt))
    .limit(limit);

  const activities = [
    ...bets.map(({ bet, user }) => ({
      id: bet.id,
      type: "bet" as const,
      referenceId: bet.id,
      userId: bet.userId,
      userName: user?.displayName ?? "Unknown",
      description: `${bet.pick} (${bet.event})`,
      status: bet.status as "pending" | "won" | "lost" | "push" | "void",
      stake: Number(bet.stake),
      profit: bet.actualPayout != null ? Number(bet.actualPayout) - Number(bet.stake) : null,
      sport: bet.sport,
      createdAt: bet.createdAt.toISOString(),
    })),
    ...parlayRows.map(({ parlay, user }) => ({
      id: parlay.id + 100000,
      type: "parlay" as const,
      referenceId: parlay.id,
      userId: parlay.userId,
      userName: user?.displayName ?? "Unknown",
      description: `Parlay: ${parlay.name}`,
      status: parlay.status as "pending" | "won" | "lost" | "push" | "void",
      stake: Number(parlay.stake),
      profit: parlay.actualPayout != null ? Number(parlay.actualPayout) - Number(parlay.stake) : null,
      sport: "Parlay",
      createdAt: parlay.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  res.json(activities);
});

// GET /stats/confidence-analysis
router.get("/stats/confidence-analysis", async (req, res): Promise<void> => {
  const query = GetConfidenceAnalysisQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json([]); return; }
    userId = u.id;
  } else if (!(await userInScope(req, userId))) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const bets = (
    await db.select().from(betsTable).where(
      and(eq(betsTable.userId, userId), inArray(betsTable.status, ["won", "lost", "push"]))
    )
  ).filter(hasValidOdds);

  const buckets = [
    { range: "1-3", min: 1, max: 3 },
    { range: "4-6", min: 4, max: 6 },
    { range: "7-10", min: 7, max: 10 },
  ];

  const result = buckets.map(({ range, min, max }) => {
    const inBucket = bets.filter((b) => b.confidenceScore >= min && b.confidenceScore <= max);
    const wins = inBucket.filter((b) => b.status === "won").length;
    const avgOdds = inBucket.length > 0 ? inBucket.reduce((acc, b) => acc + b.odds, 0) / inBucket.length : 0;
    return {
      confidenceRange: range,
      totalBets: inBucket.length,
      wins,
      winRate: inBucket.length > 0 ? Math.round((wins / inBucket.length) * 1000) / 10 : 0,
      avgOdds: Math.round(avgOdds),
    };
  });

  res.json(result);
});

// GET /stats/insights
router.get("/stats/insights", async (req, res): Promise<void> => {
  const query = GetStatsInsightsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const emptyInsights = {
    reviewedCount: 0,
    lossesWithReason: 0,
    missReasons: [],
    soundReasoning: { total: 0, wins: 0, winRate: 0 },
    flawedReasoning: { total: 0, wins: 0, winRate: 0 },
    recentNotes: [],
  };
  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json(emptyInsights); return; }
    userId = u.id;
  } else if (!(await userInScope(req, userId))) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const bets = await db.select().from(betsTable).where(
    and(eq(betsTable.userId, userId), inArray(betsTable.status, ["won", "lost", "push"]))
  );
  const parlays = await db.select().from(parlaysTable).where(
    and(eq(parlaysTable.userId, userId), inArray(parlaysTable.status, ["won", "lost", "push"]))
  );

  type Reviewable = {
    id: number;
    type: "bet" | "parlay";
    title: string;
    status: string;
    reasoningQuality: string | null;
    missReason: string | null;
    whatHappened: string | null;
    settledAt: Date | null;
  };

  const items: Reviewable[] = [
    ...bets.map((b) => ({
      id: b.id,
      type: "bet" as const,
      title: `${b.pick} (${b.event})`,
      status: b.status,
      reasoningQuality: b.reasoningQuality,
      missReason: b.missReason,
      whatHappened: b.whatHappened,
      settledAt: b.settledAt,
    })),
    ...parlays.map((p) => ({
      id: p.id,
      type: "parlay" as const,
      title: `Parlay: ${p.name}`,
      status: p.status,
      reasoningQuality: p.reasoningQuality,
      missReason: p.missReason,
      whatHappened: p.whatHappened,
      settledAt: p.settledAt,
    })),
  ];

  const hasReview = (i: Reviewable) =>
    i.reasoningQuality != null ||
    (i.missReason != null && i.missReason !== "na") ||
    (i.whatHappened != null && i.whatHappened.trim() !== "");

  const reviewedCount = items.filter(hasReview).length;

  // Miss-reason breakdown across losses (exclude "na" — it carries no signal)
  const reasonCounts: Record<string, number> = {};
  let lossesWithReason = 0;
  for (const i of items) {
    if (i.status !== "lost") continue;
    if (i.missReason == null || i.missReason === "na") continue;
    lossesWithReason++;
    reasonCounts[i.missReason] = (reasonCounts[i.missReason] ?? 0) + 1;
  }
  const missReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // Sound vs flawed reasoning win rates (pushes excluded from win-rate denominator)
  const qualityStats = (quality: "sound" | "flawed") => {
    const group = items.filter((i) => i.reasoningQuality === quality);
    const decided = group.filter((i) => i.status === "won" || i.status === "lost");
    const wins = decided.filter((i) => i.status === "won").length;
    return {
      total: group.length,
      wins,
      winRate: decided.length > 0 ? Math.round((wins / decided.length) * 1000) / 10 : 0,
    };
  };

  // 5 most recent "what happened" notes
  const recentNotes = items
    .filter((i) => i.whatHappened != null && i.whatHappened.trim() !== "")
    .sort((a, b) => (b.settledAt?.getTime() ?? 0) - (a.settledAt?.getTime() ?? 0))
    .slice(0, 5)
    .map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      status: i.status as "won" | "lost" | "push" | "void",
      whatHappened: i.whatHappened as string,
      settledAt: i.settledAt ? i.settledAt.toISOString() : null,
    }));

  res.json({
    reviewedCount,
    lossesWithReason,
    missReasons,
    soundReasoning: qualityStats("sound"),
    flawedReasoning: qualityStats("flawed"),
    recentNotes,
  });
});

// GET /stats/recap — one week's story: personal facts + crew highlights.
// Defaults to the signed-in bettor and the most recently completed week.
router.get("/stats/recap", requireProfile, async (req, res): Promise<void> => {
  const query = GetWeeklyRecapQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const userId = query.data.userId ?? req.currentUser!.id;
  if (query.data.userId != null && !(await userInScope(req, query.data.userId))) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const today = dayOf(new Date());
  const latest = lastCompletedWeekStart(today);
  let weekStart = latest;
  if (query.data.weekStart != null) {
    if (!isRealCalendarDate(query.data.weekStart)) {
      res.status(400).json({ error: "weekStart must be a valid calendar date in YYYY-MM-DD format" });
      return;
    }
    weekStart = mondayOf(query.data.weekStart);
    if (weekStart > latest) {
      res.status(400).json({ error: "That week isn't finished yet — recaps cover completed weeks only" });
      return;
    }
  }

  // Crew highlights only ever cover the request's world: the demo recap talks
  // about the demo crew, real recaps never mention demo bettors.
  const [users, allBets, allParlays] = await Promise.all([
    db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(userScopeCondition(req)),
    db.select().from(betsTable),
    db.select().from(parlaysTable),
  ]);
  const scopedIds = new Set(users.map((u) => u.id));
  const bets = allBets.filter((b) => scopedIds.has(b.userId));
  const parlays = allParlays.filter((p) => scopedIds.has(p.userId));

  res.json(computeWeeklyRecap({ users, bets, parlays, userId, weekStart }));
});

export default router;
