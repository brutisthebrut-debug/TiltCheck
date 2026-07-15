import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, gte, sql } from "drizzle-orm";
import { db, betsTable, parlaysTable, usersTable, transactionsTable, recapNarrativesTable } from "@workspace/db";
import {
  GetStatsSummaryQueryParams,
  GetStatsBySportQueryParams,
  GetRecentActivityQueryParams,
  GetConfidenceAnalysisQueryParams,
  GetStatsInsightsQueryParams,
  GetLeakProfileQueryParams,
  GetEdgeFinderQueryParams,
  GetWeeklyRecapQueryParams,
  GetRecapNarrativeQueryParams,
} from "@workspace/api-zod";
import { isValidAmericanOdds } from "../lib/odds";
import { isRealCalendarDate } from "../lib/dates";
import { computeWeeklyRecap, mondayOf, lastCompletedWeekStart, dayOf } from "../lib/recap";
import { assembleRecapFacts, generateRecapNarrative, NARRATIVE_MODEL } from "../lib/narrative";
import { logger } from "../lib/logger";
import { requireProfile } from "../middlewares/auth";
import { userScopeCondition, userInScope } from "../lib/scope";
import { isDemoRequest } from "../middlewares/demo";

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

// GET /stats/leak-profile — the signed-in bettor's recurring leak signals,
// aggregated across their whole settled history so the bet form can warn
// before they repeat their most common mistake. Private: this is self-audit
// data, so a userId param is only accepted when it matches the session user.
router.get("/stats/leak-profile", requireProfile, async (req, res): Promise<void> => {
  const query = GetLeakProfileQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const self = req.currentUser!.id;
  if (query.data.userId != null && query.data.userId !== self) {
    res.status(403).json({ error: "You can only view your own leak profile" });
    return;
  }

  const bets = await db.select().from(betsTable).where(
    and(eq(betsTable.userId, self), inArray(betsTable.status, ["won", "lost", "push"]))
  );
  const parlays = await db.select().from(parlaysTable).where(
    and(eq(parlaysTable.userId, self), inArray(parlaysTable.status, ["won", "lost", "push"]))
  );

  const settledCount = bets.length;

  // Recent window for trend reporting — the dashboard compares each leak's
  // recent damage against its all-time figure to tell the bettor whether the
  // habit is shrinking or getting worse.
  const RECENT_WINDOW_DAYS = 30;
  const recentCutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const isRecent = (r: { settledAt: Date | null }) =>
    r.settledAt != null && r.settledAt.getTime() >= recentCutoff;

  // Average stake across settled straight bets — the baseline for spotting
  // an oversized "get it back" stake. Needs a real sample to mean anything.
  const avgStake =
    bets.length >= 5
      ? Math.round((bets.reduce((s, b) => s + Number(b.stake), 0) / bets.length) * 100) / 100
      : null;

  // Most recent settled loss (bet or parlay) — chasing only makes sense
  // relative to when the last L actually landed.
  const lossTimes = [...bets, ...parlays]
    .filter((r) => r.status === "lost" && r.settledAt != null)
    .map((r) => r.settledAt!.getTime());
  const lastLossAt = lossTimes.length > 0 ? new Date(Math.max(...lossTimes)).toISOString() : null;

  // Worst sport by net dollars, counting only rows whose payout math is
  // trustworthy (see hasValidOdds). Only reported once it has cost real
  // money over a real sample.
  const bySport: Record<string, { net: number; count: number }> = {};
  for (const b of bets) {
    if (!hasValidOdds(b)) continue;
    const net = Number(b.actualPayout ?? 0) - Number(b.stake);
    const entry = (bySport[b.sport] ??= { net: 0, count: 0 });
    entry.net += net;
    entry.count += 1;
  }
  const worstEntry = Object.entries(bySport)
    .filter(([, v]) => v.count >= 5 && v.net <= -50)
    .sort((a, b) => a[1].net - b[1].net)[0];
  let worstSport: { sport: string; netLoss: number; bets: number; recentNet: number; recentBets: number } | null = null;
  if (worstEntry) {
    const recentRows = bets.filter((b) => hasValidOdds(b) && b.sport === worstEntry[0] && isRecent(b));
    const recentNet = recentRows.reduce((s, b) => s + (Number(b.actualPayout ?? 0) - Number(b.stake)), 0);
    worstSport = {
      sport: worstEntry[0],
      netLoss: Math.round(worstEntry[1].net * 100) / 100,
      bets: worstEntry[1].count,
      recentNet: Math.round(recentNet * 100) / 100,
      recentBets: recentRows.length,
    };
  }

  // Overconfidence: how 7+ confidence plays actually hit. Only reported when
  // the sample is real and the hit rate is genuinely bad (<45%).
  const highConf = [...bets, ...parlays].filter(
    (r) => r.confidenceScore >= 7 && (r.status === "won" || r.status === "lost")
  );
  let overconfidence: { winRate: number; sample: number; recentWinRate: number | null; recentSample: number } | null = null;
  if (highConf.length >= 5) {
    const wins = highConf.filter((r) => r.status === "won").length;
    const winRate = Math.round((wins / highConf.length) * 1000) / 10;
    if (winRate < 45) {
      const recent = highConf.filter(isRecent);
      const recentWins = recent.filter((r) => r.status === "won").length;
      overconfidence = {
        winRate,
        sample: highConf.length,
        recentWinRate: recent.length > 0 ? Math.round((recentWins / recent.length) * 1000) / 10 : null,
        recentSample: recent.length,
      };
    }
  }

  // Most common self-graded miss reason across losses. Normal variance is
  // excluded — it isn't a mistake, and "na" carries no signal.
  const reasonAgg: Record<string, { count: number; netLoss: number }> = {};
  for (const r of [...bets, ...parlays]) {
    if (r.status !== "lost") continue;
    if (r.missReason == null || r.missReason === "na" || r.missReason === "normal_variance") continue;
    const entry = (reasonAgg[r.missReason] ??= { count: 0, netLoss: 0 });
    entry.count += 1;
    entry.netLoss += Number(r.stake);
  }
  const topReasonEntry = Object.entries(reasonAgg).sort(
    (a, b) => b[1].count - a[1].count || b[1].netLoss - a[1].netLoss
  )[0];
  let topMissReason: { reason: string; count: number; netLoss: number; recentCount: number; recentNetLoss: number } | null = null;
  if (topReasonEntry && topReasonEntry[1].count >= 3) {
    const recentRows = [...bets, ...parlays].filter(
      (r) => r.status === "lost" && r.missReason === topReasonEntry[0] && isRecent(r)
    );
    const recentNetLoss = recentRows.reduce((s, r) => s + Number(r.stake), 0);
    topMissReason = {
      reason: topReasonEntry[0],
      count: topReasonEntry[1].count,
      netLoss: Math.round(topReasonEntry[1].netLoss * 100) / 100,
      recentCount: recentRows.length,
      recentNetLoss: Math.round(recentNetLoss * 100) / 100,
    };
  }

  // Tilt spiral — is the bettor mid-spiral *right now*? Fires only when all
  // three hold inside a short window: (1) two or more settled losses landed,
  // (2) since the first of those Ls they've logged a burst of 3+ new plays,
  // and (3) that burst is staked well above their own baseline. Needs a real
  // avgStake sample so it never fires on thin data. This is a session-level
  // pattern check — the single-bet chasing warning on the bet form covers
  // the one-off oversized stake.
  const TILT_WINDOW_HOURS = 12;
  const TILT_MIN_LOSSES = 2;
  const TILT_MIN_PLAYS = 3;
  const TILT_STAKE_RATIO = 1.5;
  let tiltSpiral: {
    windowHours: number;
    recentLosses: number;
    rapidPlays: number;
    burstAvgStake: number;
    stakeRatio: number;
  } | null = null;
  if (avgStake != null && avgStake > 0) {
    const tiltCutoff = new Date(Date.now() - TILT_WINDOW_HOURS * 60 * 60 * 1000);
    const recentLossTimes = [...bets, ...parlays]
      .filter((r) => r.status === "lost" && r.settledAt != null && r.settledAt >= tiltCutoff)
      .map((r) => r.settledAt!.getTime())
      .sort((a, b) => a - b);
    if (recentLossTimes.length >= TILT_MIN_LOSSES) {
      const firstLossAt = new Date(recentLossTimes[0]);
      // Every play (any status) logged since that first L landed — the burst.
      const burstBets = await db
        .select({ stake: betsTable.stake })
        .from(betsTable)
        .where(and(eq(betsTable.userId, self), gte(betsTable.createdAt, firstLossAt)));
      const burstParlays = await db
        .select({ stake: parlaysTable.stake })
        .from(parlaysTable)
        .where(and(eq(parlaysTable.userId, self), gte(parlaysTable.createdAt, firstLossAt)));
      const burst = [...burstBets, ...burstParlays];
      if (burst.length >= TILT_MIN_PLAYS) {
        const burstAvgStake = burst.reduce((s, r) => s + Number(r.stake), 0) / burst.length;
        const stakeRatio = burstAvgStake / avgStake;
        if (stakeRatio >= TILT_STAKE_RATIO) {
          tiltSpiral = {
            windowHours: TILT_WINDOW_HOURS,
            recentLosses: recentLossTimes.length,
            rapidPlays: burst.length,
            burstAvgStake: Math.round(burstAvgStake * 100) / 100,
            stakeRatio: Math.round(stakeRatio * 10) / 10,
          };
        }
      }
    }
  }

  // One-time trend-flip celebration. The reported leak is the same priority
  // order the dashboard uses (worst sport > miss reason > overconfidence),
  // and "improving" mirrors its trend rules exactly. This GET only *reports*
  // that the celebration is available — it is consumed by
  // POST /users/me/leak-celebration-seen, which the client calls only after
  // the celebratory card actually rendered. That way other consumers of this
  // endpoint (e.g. the bet form's pre-bet warning) can never silently burn
  // the one-time celebration. Demo requests never flip.
  const topLeakImproving = worstSport
    ? worstSport.recentBets === 0 || worstSport.recentNet >= 0
    : topMissReason
      ? topMissReason.recentCount === 0
      : overconfidence
        ? overconfidence.recentSample === 0 ||
          overconfidence.recentWinRate == null ||
          overconfidence.recentWinRate > overconfidence.winRate
        : false;
  const trendFlip =
    topLeakImproving && !isDemoRequest(req) && req.currentUser!.leakTrendCelebratedAt == null;

  res.json({
    settledCount,
    recentWindowDays: RECENT_WINDOW_DAYS,
    avgStake,
    lastLossAt,
    worstSport,
    overconfidence,
    topMissReason,
    tiltSpiral,
    trendFlip,
  });
});

// GET /stats/edge-finder — the signed-in bettor's settled straight bets
// sliced into lanes (sport, fav/dog, odds band, day of week, stake band) so
// the Edge Finder page can show where they actually make money. Private
// self-audit data: a userId param is only accepted when it matches the
// session user. Lanes below EDGE_MIN_SAMPLE are still returned — the client
// greys them out rather than pretending small samples mean something.
const EDGE_MIN_SAMPLE = 5;

router.get("/stats/edge-finder", requireProfile, async (req, res): Promise<void> => {
  const query = GetEdgeFinderQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const self = req.currentUser!.id;
  if (query.data.userId != null && query.data.userId !== self) {
    res.status(403).json({ error: "You can only view your own edge finder" });
    return;
  }

  // Optional filters: a settledAt window (matching the leaderboard's
  // week/month convention) and an exact sport.
  const period = query.data.period ?? "all";
  const windowStart =
    period === "week"
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      : period === "month"
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : null;
  const sportFilter = query.data.sport;

  const bets = (
    await db.select().from(betsTable).where(
      and(eq(betsTable.userId, self), inArray(betsTable.status, ["won", "lost", "push"]))
    )
  )
    .filter(hasValidOdds)
    .filter((b) => windowStart == null || (b.settledAt != null && b.settledAt >= windowStart))
    .filter((b) => sportFilter == null || b.sport === sportFilter);

  const settledCount = bets.length;
  const avgStake =
    bets.length > 0
      ? Math.round((bets.reduce((s, b) => s + Number(b.stake), 0) / bets.length) * 100) / 100
      : null;

  type Row = (typeof bets)[number];
  type LaneAgg = { wins: number; losses: number; pushes: number; wagered: number; payout: number };

  const aggregate = (keyOf: (b: Row) => string): Map<string, LaneAgg> => {
    const map = new Map<string, LaneAgg>();
    for (const b of bets) {
      const key = keyOf(b);
      let lane = map.get(key);
      if (!lane) {
        lane = { wins: 0, losses: 0, pushes: 0, wagered: 0, payout: 0 };
        map.set(key, lane);
      }
      if (b.status === "won") lane.wins++;
      else if (b.status === "lost") lane.losses++;
      else lane.pushes++;
      lane.wagered += Number(b.stake);
      lane.payout += b.actualPayout != null ? Number(b.actualPayout) : 0;
    }
    return map;
  };

  const toLanes = (map: Map<string, LaneAgg>, order?: string[]) => {
    const lanes = [...map.entries()].map(([key, l]) => {
      const netProfit = l.payout - l.wagered;
      return {
        key,
        wins: l.wins,
        losses: l.losses,
        pushes: l.pushes,
        bets: l.wins + l.losses + l.pushes,
        wagered: Math.round(l.wagered * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        roi: l.wagered > 0 ? Math.round((netProfit / l.wagered) * 10000) / 100 : 0,
      };
    });
    if (order) {
      lanes.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    } else {
      lanes.sort((a, b) => b.netProfit - a.netProfit);
    }
    return lanes;
  };

  // Fav/dog and odds bands: dead-zone rows are already excluded, so every
  // odds value here is <= -100 or >= +100.
  const favDogKey = (b: Row) => (b.odds <= -100 ? "favorite" : "underdog");
  const oddsBandKey = (b: Row) =>
    b.odds <= -200 ? "heavy_fav" : b.odds <= -100 ? "fav" : b.odds < 200 ? "dog" : "long_shot";

  // Day of week from the game date (UTC) — when the bet's game was played,
  // not when it was logged.
  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const dayKey = (b: Row) => DAY_KEYS[new Date(`${b.gameDate}T00:00:00Z`).getUTCDay()];

  // Stake bands are relative to the bettor's own average — a $100 play is
  // "heavy" for a $40 bettor and "light" for a whale.
  const stakeBandKey = (b: Row) => {
    const stake = Number(b.stake);
    if (avgStake == null || avgStake <= 0) return "standard";
    if (stake < avgStake * 0.75) return "light";
    if (stake <= avgStake * 1.5) return "standard";
    return "heavy";
  };

  res.json({
    settledCount,
    minSample: EDGE_MIN_SAMPLE,
    avgStake,
    sport: toLanes(aggregate((b) => b.sport)),
    favDog: toLanes(aggregate(favDogKey), ["favorite", "underdog"]),
    oddsBand: toLanes(aggregate(oddsBandKey), ["heavy_fav", "fav", "dog", "long_shot"]),
    dayOfWeek: toLanes(aggregate(dayKey), ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    stakeBand: toLanes(aggregate(stakeBandKey), ["light", "standard", "heavy"]),
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

// GET /stats/recap/narrative — AI-narrated review of one bettor-week.
// Generated once per user per week from the SAME computed facts the recap
// shows (never raw rows), stored, and served from the cache ever after.
// Any generation failure degrades to { narrative: null } — the recap page
// works exactly as before, the section just doesn't appear.
router.get("/stats/recap/narrative", requireProfile, async (req, res): Promise<void> => {
  const query = GetRecapNarrativeQueryParams.safeParse(req.query);
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

  // Cache hit: one generation per user per week, ever.
  const [cached] = await db
    .select()
    .from(recapNarrativesTable)
    .where(and(eq(recapNarrativesTable.userId, userId), eq(recapNarrativesTable.weekStart, weekStart)))
    .limit(1);
  if (cached) {
    res.json({ weekStart, narrative: cached.narrative });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [users, allBets, allParlays] = await Promise.all([
    db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(userScopeCondition(req)),
    db.select().from(betsTable).where(eq(betsTable.userId, userId)),
    db.select().from(parlaysTable).where(eq(parlaysTable.userId, userId)),
  ]);
  const recap = computeWeeklyRecap({ users, bets: allBets, parlays: allParlays, userId, weekStart });

  // Quiet week or nothing graded yet (e.g. a bettor's first week with only
  // pending bets) — no decision tape to review. Short-circuit before the AI
  // call: no generation cost, and crucially no cache write, so the week gets
  // its narrative later if bets from it are ever settled.
  const factsResult = assembleRecapFacts({
    displayName: user.displayName,
    recap,
    myBets: allBets,
    myParlays: allParlays,
  });
  if (!factsResult.hasData) {
    res.json({ weekStart, narrative: null });
    return;
  }

  // Spend guard for the public demo board: anonymous visitors only trigger
  // fresh generation for the latest completed week (one per demo bettor per
  // week); older demo weeks serve the cache or nothing.
  if (isDemoRequest(req) && weekStart !== latest) {
    res.json({ weekStart, narrative: null });
    return;
  }

  // Spend guard for members browsing deep history: the latest completed week
  // always generates (that's the weekly tape), but older weeks draw from a
  // daily budget of fresh generations per bettor. Cached weeks are free and
  // never touch the budget — flipping back through already-generated history
  // costs nothing. Only successful generations count (rows in the table), so
  // provider failures don't burn budget.
  if (weekStart !== latest) {
    const todayStartUtc = new Date(`${today}T00:00:00Z`);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(recapNarrativesTable)
      .where(
        and(
          eq(recapNarrativesTable.userId, userId),
          sql`${recapNarrativesTable.weekStart} <> ${latest}`,
          sql`${recapNarrativesTable.createdAt} >= ${todayStartUtc}`,
        ),
      );
    if ((row?.count ?? 0) >= HISTORY_NARRATIVE_DAILY_BUDGET) {
      res.json({ weekStart, narrative: null, limitReached: true });
      return;
    }
  }

  try {
    // Singleflight: concurrent first views of the same bettor-week share one
    // in-flight generation instead of each paying for their own.
    const flightKey = `${userId}:${weekStart}`;
    let flight = narrativeFlights.get(flightKey);
    if (!flight) {
      flight = (async () => {
        const narrative = await generateRecapNarrative(factsResult.facts);
        // The unique index makes sure only one row lands even across processes.
        // A failed save must never throw away the paid-for narrative: the
        // generation already happened, so deliver it regardless. Retry the
        // insert once (transient DB hiccups are the common case), then log
        // loudly — the worst outcome is a re-generation on a later request,
        // never a blank tape for this one.
        const persist = () =>
          db
            .insert(recapNarrativesTable)
            .values({ userId, weekStart, narrative, model: NARRATIVE_MODEL })
            .onConflictDoNothing();
        try {
          await persist();
        } catch (saveErr) {
          logger.warn({ err: saveErr, userId, weekStart }, "Recap narrative save failed — retrying once");
          try {
            await new Promise((r) => setTimeout(r, 250));
            await persist();
          } catch (retryErr) {
            logger.error(
              { err: retryErr, userId, weekStart },
              "Recap narrative save failed twice — returning unsaved narrative (will regenerate next time)",
            );
          }
        }
        return narrative;
      })();
      narrativeFlights.set(flightKey, flight);
      // Swallow the side-channel rejection: every caller awaits `flight`
      // itself, this chain only exists to clear the slot.
      void flight.catch(() => {}).finally(() => narrativeFlights.delete(flightKey));
    }
    const narrative = await flight;

    const [stored] = await db
      .select()
      .from(recapNarrativesTable)
      .where(and(eq(recapNarrativesTable.userId, userId), eq(recapNarrativesTable.weekStart, weekStart)))
      .limit(1);
    res.json({ weekStart, narrative: stored?.narrative ?? narrative });
  } catch (err) {
    logger.warn({ err, userId, weekStart }, "Recap narrative generation unavailable");
    res.json({ weekStart, narrative: null });
  }
});

// In-flight narrative generations, keyed `${userId}:${weekStart}`.
const narrativeFlights = new Map<string, Promise<string>>();

/**
 * How many *older* (non-latest) weeks' narratives one bettor can freshly
 * generate per UTC day. Keeps a deep-history browse from turning into an
 * unbounded string of paid generations while still letting members work
 * backward through their tape a few weeks at a time.
 */
export const HISTORY_NARRATIVE_DAILY_BUDGET = 4;

export default router;
