import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { db, betsTable, parlaysTable, usersTable, transactionsTable } from "@workspace/db";
import {
  GetStatsSummaryQueryParams,
  GetStatsBySportQueryParams,
  GetRecentActivityQueryParams,
  GetConfidenceAnalysisQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /stats/summary
router.get("/stats/summary", async (req, res): Promise<void> => {
  const query = GetStatsSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).orderBy(usersTable.id).limit(1);
    if (!u) { res.json(emptySummary(0)); return; }
    userId = u.id;
  }

  const bets = await db.select().from(betsTable).where(eq(betsTable.userId, userId));
  const parlays = await db.select().from(parlaysTable).where(eq(parlaysTable.userId, userId));

  const settled = bets.filter((b) => ["won", "lost", "push"].includes(b.status));
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const pushes = settled.filter((b) => b.status === "push").length;
  const pending = bets.filter((b) => b.status === "pending").length;

  const totalWagered = settled.reduce((acc, b) => acc + Number(b.stake), 0);
  const totalPayout = settled.reduce((acc, b) => acc + (b.actualPayout != null ? Number(b.actualPayout) : 0), 0);
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

  const parlaySettled = parlays.filter((p) => ["won", "lost", "push"].includes(p.status));
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
    const [u] = await db.select().from(usersTable).orderBy(usersTable.id).limit(1);
    if (!u) { res.json([]); return; }
    userId = u.id;
  }

  const bets = await db.select().from(betsTable).where(
    and(eq(betsTable.userId, userId), inArray(betsTable.status, ["won", "lost", "push"]))
  );

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
    .leftJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .orderBy(desc(betsTable.createdAt))
    .limit(limit);

  const parlayRows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .leftJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
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
    const [u] = await db.select().from(usersTable).orderBy(usersTable.id).limit(1);
    if (!u) { res.json([]); return; }
    userId = u.id;
  }

  const bets = await db.select().from(betsTable).where(
    and(eq(betsTable.userId, userId), inArray(betsTable.status, ["won", "lost", "push"]))
  );

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

export default router;
