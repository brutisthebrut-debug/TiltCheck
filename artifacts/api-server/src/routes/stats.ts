import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, gte, sql, lte } from "drizzle-orm";
import { db, betsTable, parlaysTable, usersTable, transactionsTable, recapNarrativesTable, crewChallengesTable, crewMembersTable } from "@workspace/db";
import { buildPeerBenchmarks, getRoiBand } from "../lib/peerBenchmarks";
import { metricLabel, formatMetricValue, type ChallengeMetric } from "../lib/challengeStandings";
import {
  GetStatsSummaryQueryParams,
  GetStatsBySportQueryParams,
  GetRecentActivityQueryParams,
  GetConfidenceAnalysisQueryParams,
  GetStatsInsightsQueryParams,
  GetLessonsQueryParams,
  GetLeakProfileQueryParams,
  GetEdgeFinderQueryParams,
  GetWeeklyRecapQueryParams,
  GetRecapNarrativeQueryParams,
  PreBetCheckBody,
} from "@workspace/api-zod";
import { isValidAmericanOdds } from "../lib/odds";
import { isRealCalendarDate } from "../lib/dates";
import { computeWeeklyRecap, mondayOf, lastCompletedWeekStart, dayOf } from "../lib/recap";
import { assembleRecapFacts, generateRecapNarrative, NARRATIVE_MODEL } from "../lib/narrative";
import { logger } from "../lib/logger";
import { requireProfile } from "../middlewares/auth";
import { requirePro } from "../middlewares/billing";
import { preBetCheckLimiter } from "../middlewares/rate-limit";
import { userScopeCondition, userInSocialScope, getSocialUsers } from "../lib/scope";
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
  const sportFilter = query.data.sport ?? null;
  const sinceParam = query.data.since ?? null;
  if (sinceParam != null && !isRealCalendarDate(sinceParam)) {
    res.status(400).json({ error: "since must be a real calendar date (YYYY-MM-DD)" });
    return;
  }
  const sinceDate = sinceParam != null ? new Date(`${sinceParam}T00:00:00.000Z`) : null;

  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json(emptySummary(0)); return; }
    userId = u.id;
  } else if (!(await userInSocialScope(req, userId))) {
    // Crew scoping: another bettor's numbers are visible only within a
    // shared crew (same policy as recap, badges, and streaks).
    res.status(404).json({ error: "User not found" });
    return;
  }

  const allBets = await db.select().from(betsTable).where(
    and(
      eq(betsTable.userId, userId),
      ...(sportFilter != null ? [eq(betsTable.sport, sportFilter)] : []),
      ...(sinceDate != null ? [gte(betsTable.settledAt, sinceDate)] : []),
    )
  );
  // A sport slice is straight-bets-only — a parlay spans sports so it can't
  // belong to any single sport's summary.
  const allParlays = sportFilter != null ? [] : await db.select().from(parlaysTable).where(
    and(
      eq(parlaysTable.userId, userId),
      ...(sinceDate != null ? [gte(parlaysTable.settledAt, sinceDate)] : []),
    )
  );
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
    // Win rate is wins ÷ (wins + losses): a push is money back, not a loss,
    // so it must not drag the rate down. Pushes stay visible in the record.
    winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
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
  const sportFilter = query.data.sport ?? null;
  const sinceParam = query.data.since ?? null;
  if (sinceParam != null && !isRealCalendarDate(sinceParam)) {
    res.status(400).json({ error: "since must be a real calendar date (YYYY-MM-DD)" });
    return;
  }
  const sinceDate = sinceParam != null ? new Date(`${sinceParam}T00:00:00.000Z`) : null;

  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json([]); return; }
    userId = u.id;
  } else if (!(await userInSocialScope(req, userId))) {
    // Crew scoping: another bettor's numbers are visible only within a
    // shared crew (same policy as recap, badges, and streaks).
    res.status(404).json({ error: "User not found" });
    return;
  }

  const bets = (
    await db.select().from(betsTable).where(
      and(
        eq(betsTable.userId, userId),
        inArray(betsTable.status, ["won", "lost", "push"]),
        ...(sportFilter != null ? [eq(betsTable.sport, sportFilter)] : []),
        ...(sinceDate != null ? [gte(betsTable.settledAt, sinceDate)] : []),
      )
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
    // Decided bets only — pushes are money back, not losses.
    const decided = s.wins + s.losses;
    const profit = s.payout - s.wagered;
    return {
      sport,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      winRate: decided > 0 ? Math.round((s.wins / decided) * 1000) / 10 : 0,
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

  // Crew scoping: the activity feed shows only the requester's crew (same
  // policy as the bets/parlays lists). userScopeCondition stays as defense
  // in depth on the demo/real boundary.
  const socialUsers = await getSocialUsers(req);
  if (socialUsers.length === 0) {
    res.json([]);
    return;
  }
  const socialIds = socialUsers.map((u) => u.id);

  const bets = await db
    .select({ bet: betsTable, user: usersTable })
    .from(betsTable)
    .innerJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(and(userScopeCondition(req), inArray(betsTable.userId, socialIds)))
    .orderBy(desc(betsTable.createdAt))
    .limit(limit);

  const parlayRows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .innerJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(and(userScopeCondition(req), inArray(parlaysTable.userId, socialIds)))
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
  const sportFilter = query.data.sport ?? null;
  const sinceParam = query.data.since ?? null;
  if (sinceParam != null && !isRealCalendarDate(sinceParam)) {
    res.status(400).json({ error: "since must be a real calendar date (YYYY-MM-DD)" });
    return;
  }
  const sinceDate = sinceParam != null ? new Date(`${sinceParam}T00:00:00.000Z`) : null;

  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json([]); return; }
    userId = u.id;
  } else if (!(await userInSocialScope(req, userId))) {
    // Crew scoping: another bettor's numbers are visible only within a
    // shared crew (same policy as recap, badges, and streaks).
    res.status(404).json({ error: "User not found" });
    return;
  }

  const bets = (
    await db.select().from(betsTable).where(
      and(
        eq(betsTable.userId, userId),
        inArray(betsTable.status, ["won", "lost", "push"]),
        ...(sportFilter != null ? [eq(betsTable.sport, sportFilter)] : []),
        ...(sinceDate != null ? [gte(betsTable.settledAt, sinceDate)] : []),
      )
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
    // Decided bets only — a push proves nothing about the read.
    const decided = inBucket.filter((b) => b.status === "won" || b.status === "lost").length;
    const avgOdds = inBucket.length > 0 ? inBucket.reduce((acc, b) => acc + b.odds, 0) / inBucket.length : 0;
    return {
      confidenceRange: range,
      totalBets: inBucket.length,
      wins,
      winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : 0,
      avgOdds: Math.round(avgOdds),
    };
  });

  res.json(result);
});

// GET /stats/insights
router.get("/stats/insights", requirePro, async (req, res): Promise<void> => {
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
  const sportFilter = query.data.sport ?? null;
  const sinceParam = query.data.since ?? null;
  if (sinceParam != null && !isRealCalendarDate(sinceParam)) {
    res.status(400).json({ error: "since must be a real calendar date (YYYY-MM-DD)" });
    return;
  }
  const sinceDate = sinceParam != null ? new Date(`${sinceParam}T00:00:00.000Z`) : null;

  let userId = query.data.userId;
  if (userId == null) {
    const [u] = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id).limit(1);
    if (!u) { res.json(emptyInsights); return; }
    userId = u.id;
  } else if (!(await userInSocialScope(req, userId))) {
    // Crew scoping: another bettor's numbers are visible only within a
    // shared crew (same policy as recap, badges, and streaks).
    res.status(404).json({ error: "User not found" });
    return;
  }

  const bets = await db.select().from(betsTable).where(
    and(
      eq(betsTable.userId, userId),
      inArray(betsTable.status, ["won", "lost", "push"]),
      ...(sportFilter != null ? [eq(betsTable.sport, sportFilter)] : []),
      ...(sinceDate != null ? [gte(betsTable.settledAt, sinceDate)] : []),
    )
  );
  // A sport slice is straight-bets-only — a parlay spans sports, so it can't
  // honestly belong to any single sport's lessons.
  const parlays = sportFilter != null ? [] : await db.select().from(parlaysTable).where(
    and(
      eq(parlaysTable.userId, userId),
      inArray(parlaysTable.status, ["won", "lost", "push"]),
      ...(sinceDate != null ? [gte(parlaysTable.settledAt, sinceDate)] : []),
    )
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

// GET /stats/lessons — the Lesson Library: every settled play with its full
// post-mortem journal, plus the summary-strip aggregates. Private self-audit
// data like the leak profile: a userId param is only accepted when it matches
// the session user (the demo mount browses as the demo POV member).
router.get("/stats/lessons", requireProfile, async (req, res): Promise<void> => {
  const query = GetLessonsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const self = req.currentUser!.id;
  if (query.data.userId != null && query.data.userId !== self) {
    res.status(403).json({ error: "You can only review your own lessons" });
    return;
  }

  const bets = await db.select().from(betsTable).where(
    and(eq(betsTable.userId, self), inArray(betsTable.status, ["won", "lost", "push"]))
  );
  const parlays = await db.select().from(parlaysTable).where(
    and(eq(parlaysTable.userId, self), inArray(parlaysTable.status, ["won", "lost", "push"]))
  );

  const isReviewed = (r: { reasoningQuality: string | null; missReason: string | null; whatHappened: string | null }) =>
    r.reasoningQuality != null ||
    (r.missReason != null && r.missReason !== "na") ||
    (r.whatHappened != null && r.whatHappened.trim() !== "");

  const items = [
    ...bets.map((b) => ({
      id: b.id,
      type: "bet" as const,
      title: `${b.pick} (${b.event})`,
      sport: b.sport,
      result: b.status as "won" | "lost" | "push",
      stake: Number(b.stake),
      odds: b.odds,
      profit: b.actualPayout != null ? Math.round((Number(b.actualPayout) - Number(b.stake)) * 100) / 100 : null,
      confidenceScore: b.confidenceScore,
      rationale: b.rationale,
      reasoningQuality: b.reasoningQuality as "sound" | "flawed" | null,
      missReason: b.missReason,
      whatHappened: b.whatHappened,
      reviewed: isReviewed(b),
      settledAt: b.settledAt ? b.settledAt.toISOString() : null,
    })),
    ...parlays.map((p) => ({
      id: p.id,
      type: "parlay" as const,
      title: `Parlay: ${p.name}`,
      sport: null,
      result: p.status as "won" | "lost" | "push",
      stake: Number(p.stake),
      odds: p.odds,
      profit: p.actualPayout != null ? Math.round((Number(p.actualPayout) - Number(p.stake)) * 100) / 100 : null,
      confidenceScore: p.confidenceScore,
      rationale: p.rationale,
      reasoningQuality: p.reasoningQuality as "sound" | "flawed" | null,
      missReason: p.missReason,
      whatHappened: p.whatHappened,
      reviewed: isReviewed(p),
      settledAt: p.settledAt ? p.settledAt.toISOString() : null,
    })),
  ].sort((a, b) => {
    const ta = a.settledAt ? new Date(a.settledAt).getTime() : 0;
    const tb = b.settledAt ? new Date(b.settledAt).getTime() : 0;
    return tb - ta;
  });

  // Miss-reason breakdown across losses (exclude "na" — it carries no signal)
  const reasonCounts: Record<string, number> = {};
  for (const i of items) {
    if (i.result !== "lost") continue;
    if (i.missReason == null || i.missReason === "na") continue;
    reasonCounts[i.missReason] = (reasonCounts[i.missReason] ?? 0) + 1;
  }
  const missReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // The most repeated *mistake* — normal variance isn't one, and a single
  // occurrence isn't a pattern.
  const mostRepeatedMistake =
    missReasons.find((r) => r.reason !== "normal_variance" && r.count >= 2) ?? null;

  res.json({
    summary: {
      settledCount: items.length,
      reviewedCount: items.filter((i) => i.reviewed).length,
      soundCount: items.filter((i) => i.reasoningQuality === "sound").length,
      flawedCount: items.filter((i) => i.reasoningQuality === "flawed").length,
      missReasons,
      mostRepeatedMistake,
    },
    items,
  });
});

// GET /stats/leak-profile — the signed-in bettor's recurring leak signals,
// aggregated across their whole settled history so the bet form can warn
// before they repeat their most common mistake. Private: this is self-audit
// data, so a userId param is only accepted when it matches the session user.
router.get("/stats/leak-profile", requireProfile, requirePro, async (req, res): Promise<void> => {
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

  // Tighter 14-day window used for the mistake warning so the signal reflects
  // current behaviour, not ancient history. The trend reporting still uses the
  // 30-day window for the other leak signals.
  const MISTAKE_WINDOW_DAYS = 14;
  const mistakeCutoff = Date.now() - MISTAKE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const isMistakeRecent = (r: { settledAt: Date | null }) =>
    r.settledAt != null && r.settledAt.getTime() >= mistakeCutoff;

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
  let topMissReason: { reason: string; count: number; netLoss: number; recentCount: number; recentNetLoss: number; mistakeWindowDays: number } | null = null;
  if (topReasonEntry && topReasonEntry[1].count >= 3) {
    // Use the 14-day mistake window for recentCount so the warning reflects
    // current behaviour instead of a 30-day average that smooths out old history.
    const recentRows = [...bets, ...parlays].filter(
      (r) => r.status === "lost" && r.missReason === topReasonEntry[0] && isMistakeRecent(r)
    );
    const recentNetLoss = recentRows.reduce((s, r) => s + Number(r.stake), 0);
    topMissReason = {
      reason: topReasonEntry[0],
      count: topReasonEntry[1].count,
      netLoss: Math.round(topReasonEntry[1].netLoss * 100) / 100,
      recentCount: recentRows.length,
      recentNetLoss: Math.round(recentNetLoss * 100) / 100,
      mistakeWindowDays: MISTAKE_WINDOW_DAYS,
    };
  }

  // Historical tilt cost — how much has the bettor lost across all detected
  // tilt sessions in the last 90 days? A "tilt session" is any 12-hour window
  // with two or more settled losses (same threshold as the live spiral check).
  // We use a greedy forward scan so overlapping windows are only counted once.
  // The result makes the current warning more concrete ("your last N nights
  // cost you $X") rather than just flagging that the pattern is happening.
  const TILT_HISTORY_DAYS = 90;
  const tiltHistoryCutoff = new Date(Date.now() - TILT_HISTORY_DAYS * 24 * 60 * 60 * 1000);

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
  const TILT_WINDOW_MS = TILT_WINDOW_HOURS * 60 * 60 * 1000;
  let tiltSpiral: {
    windowHours: number;
    recentLosses: number;
    rapidPlays: number;
    burstAvgStake: number;
    stakeRatio: number;
    tiltCostDollars: number | null;
    tiltEventCount: number;
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
          // Historical tilt cost: scan all settled losses in the last 90 days
          // using a greedy forward pass so overlapping 12h windows only count
          // once. Each cluster of TILT_MIN_LOSSES+ losses within the window is
          // one "tilt night"; we sum the stakes lost across all such nights.
          const historicLosses = [...bets, ...parlays]
            .filter((r) => r.status === "lost" && r.settledAt != null && r.settledAt >= tiltHistoryCutoff)
            .sort((a, b) => a.settledAt!.getTime() - b.settledAt!.getTime());

          let tiltCostDollars: number | null = null;
          let tiltEventCount = 0;
          let histIdx = 0;
          while (histIdx < historicLosses.length) {
            const clusterStart = historicLosses[histIdx].settledAt!.getTime();
            const inCluster: (typeof historicLosses)[0][] = [];
            let j = histIdx;
            while (j < historicLosses.length && historicLosses[j].settledAt!.getTime() - clusterStart <= TILT_WINDOW_MS) {
              inCluster.push(historicLosses[j]);
              j++;
            }
            if (inCluster.length >= TILT_MIN_LOSSES) {
              tiltEventCount++;
              tiltCostDollars = (tiltCostDollars ?? 0) + inCluster.reduce((s, r) => s + Number(r.stake), 0);
              histIdx = j; // skip past this cluster so events don't overlap
            } else {
              histIdx++;
            }
          }
          if (tiltCostDollars !== null) {
            tiltCostDollars = Math.round(tiltCostDollars * 100) / 100;
          }
          // Per the API contract: tiltCostDollars is null unless two or more
          // distinct tilt sessions were detected — one night of data isn't
          // enough to quote a reliable historical cost.
          if (tiltEventCount < 2) {
            tiltCostDollars = null;
          }

          tiltSpiral = {
            windowHours: TILT_WINDOW_HOURS,
            recentLosses: recentLossTimes.length,
            rapidPlays: burst.length,
            burstAvgStake: Math.round(burstAvgStake * 100) / 100,
            stakeRatio: Math.round(stakeRatio * 10) / 10,
            tiltCostDollars,
            tiltEventCount,
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

  // #189: where this bettor's ROI sits against the anonymous peer pool.
  // Gated exactly like the benchmarks endpoint: opted-out users see nothing
  // (they're not in the sample they'd be compared against) and demo requests
  // never touch the platform pool. Failure here must never break the profile.
  let roiBand: string | null = null;
  if (!isDemoRequest(req) && req.currentUser!.includedInBenchmarks) {
    try {
      roiBand = await getRoiBand(self);
    } catch (err) {
      req.log?.warn?.({ err }, "leak-profile: roiBand computation failed");
      roiBand = null;
    }
  }

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
    roiBand,
  });
});

// GET /stats/edge-finder — the signed-in bettor's settled straight bets
// sliced into lanes (sport, fav/dog, odds band, day of week, stake band) so
// the Edge Finder page can show where they actually make money. Private
// self-audit data: a userId param is only accepted when it matches the
// session user. Lanes below EDGE_MIN_SAMPLE are still returned — the client
// greys them out rather than pretending small samples mean something.
const EDGE_MIN_SAMPLE = 5;

router.get("/stats/edge-finder", requireProfile, requirePro, async (req, res): Promise<void> => {
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
  // Crew-aware: a recap for someone outside your active crew is a privacy
  // leak, not a feature — same 404 as a nonexistent user.
  if (query.data.userId != null && !(await userInSocialScope(req, query.data.userId))) {
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

  // Crew highlights only ever cover the viewer's active crew: the demo recap
  // talks about the demo crew, real recaps never mention demo bettors or
  // members of other crews.
  const [crewUsers, allBets, allParlays] = await Promise.all([
    getSocialUsers(req),
    db.select().from(betsTable),
    db.select().from(parlaysTable),
  ]);
  const users = crewUsers.map((u) => ({ id: u.id, displayName: u.displayName }));
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
  // Crew-aware: the narrative endpoint hands back a bettor's private tape —
  // only their own crewmates (or themselves) may pull it. World-level checks
  // aren't enough now that crews partition the real world.
  if (query.data.userId != null && !(await userInSocialScope(req, query.data.userId))) {
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

  const [crewUsersForNarrative, allBets, allParlays] = await Promise.all([
    getSocialUsers(req),
    db.select().from(betsTable).where(eq(betsTable.userId, userId)),
    db.select().from(parlaysTable).where(eq(parlaysTable.userId, userId)),
  ]);
  const users = crewUsersForNarrative.map((u) => ({ id: u.id, displayName: u.displayName }));
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

  // ── Richer bettor context (Task #201) ────────────────────────────────────
  // Enrich the facts with all-time leak profile, ROI band, calibration, and
  // Edge Finder sport lanes. Every computation is best-effort — any failure
  // leaves the corresponding fact null rather than blocking the narrative.
  try {
    const settledBets = allBets.filter(hasValidOdds).filter((b) => b.status === "won" || b.status === "lost" || b.status === "push");
    const settledAll = [...allBets, ...allParlays].filter((r) => r.status === "won" || r.status === "lost" || r.status === "push");

    // ── Worst sport ─────────────────────────────────────────────────────────
    const bySport: Record<string, { net: number; count: number }> = {};
    for (const b of settledBets) {
      const net = Number(b.actualPayout ?? 0) - Number(b.stake);
      const entry = (bySport[b.sport] ??= { net: 0, count: 0 });
      entry.net += net;
      entry.count += 1;
    }
    const worstEntry = Object.entries(bySport)
      .filter(([, v]) => v.count >= 5 && v.net <= -50)
      .sort((a, b) => a[1].net - b[1].net)[0];

    // ── Top miss reason ──────────────────────────────────────────────────────
    const NARRATIVE_MISTAKE_WINDOW_DAYS = 14;
    const narrativeMistakeCutoff = Date.now() - NARRATIVE_MISTAKE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const reasonAgg: Record<string, { count: number; netLoss: number }> = {};
    for (const r of settledAll) {
      if (r.status !== "lost") continue;
      if (!r.missReason || r.missReason === "na" || r.missReason === "normal_variance") continue;
      const entry = (reasonAgg[r.missReason] ??= { count: 0, netLoss: 0 });
      entry.count += 1;
      entry.netLoss += Number(r.stake);
    }
    const topReasonEntry = Object.entries(reasonAgg).sort((a, b) => b[1].count - a[1].count || b[1].netLoss - a[1].netLoss)[0];
    const leakMissReason =
      topReasonEntry && topReasonEntry[1].count >= 3
        ? {
            reason: topReasonEntry[0],
            count: topReasonEntry[1].count,
            recentCount: settledAll.filter(
              (r) => r.status === "lost" && r.missReason === topReasonEntry[0] && r.settledAt != null && r.settledAt.getTime() >= narrativeMistakeCutoff,
            ).length,
          }
        : null;

    // ── Overconfidence ────────────────────────────────────────────────────────
    const highConf = settledAll.filter((r) => (r.confidenceScore ?? 0) >= 7 && (r.status === "won" || r.status === "lost"));
    const highConfWins = highConf.filter((r) => r.status === "won").length;
    const leakOverconf =
      highConf.length >= 5 && highConfWins / highConf.length < 0.45
        ? { winRate: Math.round((highConfWins / highConf.length) * 1000) / 10, sample: highConf.length }
        : null;

    factsResult.facts.leakContext =
      worstEntry || leakMissReason || leakOverconf
        ? {
            worstSport: worstEntry
              ? { sport: worstEntry[0], netLoss: Math.round(worstEntry[1].net * 100) / 100, bets: worstEntry[1].count }
              : null,
            topMissReason: leakMissReason,
            overconfidence: leakOverconf,
          }
        : null;

    // ── Calibration context ──────────────────────────────────────────────────
    // All-time high-confidence (7+) plays, any status settled.
    const calibHigh = settledAll.filter((r) => (r.confidenceScore ?? 0) >= 7 && (r.status === "won" || r.status === "lost"));
    factsResult.facts.calibrationContext =
      calibHigh.length >= 10
        ? {
            highConfWinRate: Math.round((calibHigh.filter((r) => r.status === "won").length / calibHigh.length) * 1000) / 10,
            highConfSample: calibHigh.length,
          }
        : null;

    // ── Edge Finder sport summary (≥10 settled bets per sport) ──────────────
    const NARRATIVE_EDGE_MIN = 10;
    const sportLanes = new Map<string, { wagered: number; payout: number; bets: number }>();
    for (const b of settledBets) {
      let lane = sportLanes.get(b.sport);
      if (!lane) { lane = { wagered: 0, payout: 0, bets: 0 }; sportLanes.set(b.sport, lane); }
      lane.bets += 1;
      lane.wagered += Number(b.stake);
      lane.payout += b.actualPayout != null ? Number(b.actualPayout) : 0;
    }
    const sportSummary = [...sportLanes.entries()]
      .map(([sport, l]) => ({
        sport,
        bets: l.bets,
        roi: l.wagered > 0 ? Math.round(((l.payout - l.wagered) / l.wagered) * 10000) / 100 : 0,
        netProfit: Math.round((l.payout - l.wagered) * 100) / 100,
      }))
      .filter((s) => s.bets >= NARRATIVE_EDGE_MIN)
      .sort((a, b) => b.roi - a.roi);
    factsResult.facts.edgeFinderSummary =
      sportSummary.length >= 2
        ? { top: sportSummary.slice(0, 2), bottom: [...sportSummary].reverse().slice(0, 2) }
        : null;

    // ── ROI percentile band ──────────────────────────────────────────────────
    // Only for the bettor viewing their own narrative, opted in, not demo.
    factsResult.facts.roiPercentileBand = null;
    if (!isDemoRequest(req) && userId === req.currentUser!.id && req.currentUser!.includedInBenchmarks) {
      try {
        factsResult.facts.roiPercentileBand = await getRoiBand(userId);
      } catch (bandErr) {
        logger.warn({ err: bandErr, userId }, "Narrative: roiBand lookup failed — continuing without it");
      }
    }
  } catch (enrichErr) {
    logger.warn({ err: enrichErr, userId, weekStart }, "Narrative: bettor context enrichment failed — continuing with base facts");
    // Leave the new fields as undefined — the model prompt treats missing/null as "skip"
  }

  // ── Challenge winner injection ────────────────────────────────────────────
  // If a challenge for the bettor's active crew closed during this recap week,
  // inject the winner into facts so the AI can call it out. Best-effort —
  // a failure here never blocks narrative generation.
  try {
    const [activeUser] = await db
      .select({ activeCrewId: usersTable.activeCrewId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const activeCrewId = activeUser?.activeCrewId;
    if (activeCrewId != null) {
      const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
      const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      // Find a challenge that closed during this week
      const [closedChallenge] = await db
        .select()
        .from(crewChallengesTable)
        .where(
          and(
            eq(crewChallengesTable.crewId, activeCrewId),
            sql`${crewChallengesTable.closedAt} >= ${weekStartDate}`,
            lte(crewChallengesTable.closedAt, weekEndDate),
          ),
        )
        .orderBy(desc(crewChallengesTable.closedAt))
        .limit(1);

      if (closedChallenge?.winnerId != null && closedChallenge.winnerValue != null) {
        const [winner] = await db
          .select({ displayName: usersTable.displayName })
          .from(usersTable)
          .where(eq(usersTable.id, closedChallenge.winnerId))
          .limit(1);
        if (winner) {
          factsResult.facts.closedChallenge = {
            label: closedChallenge.label,
            metric: closedChallenge.metric,
            winnerName: winner.displayName,
            formattedValue: formatMetricValue(
              closedChallenge.metric as ChallengeMetric,
              closedChallenge.winnerValue,
            ),
            isNarrator: closedChallenge.winnerId === userId,
          };
        }
      }
    }
  } catch (challengeErr) {
    logger.warn({ err: challengeErr, userId, weekStart }, "Challenge winner lookup failed — continuing without it");
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

// ── Pre-bet Arc coaching check ──────────────────────────────────────────────

const PRE_BET_SYSTEM_PROMPT = `You are EdgeBoard's pre-bet coach. EdgeBoard is a private bet tracker a friend group uses to study their own decision-making — it never gives picks.

Voice (non-negotiable): blunt like a trainer reviewing game tape, big-sibling energy, dry humor welcome. Never mean, never preachy, no clichés. Address the bettor as "you".

Hard rules:
- You may ONLY reference the numbers in the provided JSON. Never invent or extrapolate.
- Reflection only: talk about their historical tendencies in this sport/bet-type/odds range. NEVER suggest what to bet, which team to pick, or predict outcomes.
- If history is thin (<5 settled plays), say so directly — don't pad with generic advice.
- 2–3 sentences maximum. End with a short punchy sentence (can end with "Your call." or similar).
- Plain text only. No headings, no bullets, no emoji, no markdown.

Richer context rules (only when the corresponding fact is non-null):
- favDogPerformance: if the proposed odds put this in the "favorite" or "underdog" bucket, cite their win rate and ROI in that bucket to anchor how this price has historically worked for them.
- sportRoi: cite their all-time ROI in this sport when it is a clear positive or a clear negative edge (outside the –5% to +5% break-even zone). Use the dollar figure or percentage — whichever is more damning or impressive.
- topMissReasonInSport: if there is a repeated mistake pattern in this sport, name it. Do not moralize — just state the pattern and how often it has appeared.`;

/** Demo coaching notes keyed by sport — deterministic, no AI call. */
function demoPrebetNote(sport: string, odds: number): string {
  const isFavorite = odds < 0;
  const notes: Record<string, string> = {
    NFL: isFavorite
      ? "In the demo, this bettor is 4–9 on NFL favorites laying more than a field goal — a 31% clip that's cost 18 units. The sample's big enough to be a pattern, not noise. Your call."
      : "In the demo, they're 6–3 on NFL dogs in this range — but all three losses came in primetime road spots. Worth knowing.",
    NBA: "In the demo, NBA totals have been a -12 unit bleed over 23 plays. The over is hitting at 39% — that's the house's number, not a bettor's. Your call.",
    MLB: "In the demo, MLB is the worst sport by ROI: -31 units on 41 bets. The sample is too big to be bad luck. It means something.",
    NCAAF: "In the demo, NCAAF spreads are 8–17 — a 32% clip. Most of the losses came laying points on road teams. Something to watch.",
    NCAAB: "In the demo, NCAAB has been a wash: 11–11 against the spread, roughly break-even after juice. No edge identified here.",
    default: "In the demo, this angle doesn't have enough history to say anything meaningful — fewer than 5 settled plays in this sport and bet type. The data isn't there yet.",
  };
  return notes[sport] ?? notes.default;
}

/** POST /stats/pre-bet-check — Arc coaching note for an in-progress bet. */
router.post(
  "/stats/pre-bet-check",
  requireProfile,
  requirePro,
  preBetCheckLimiter,
  async (req, res): Promise<void> => {
    const parsed = PreBetCheckBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { sport, betType, odds, stake, pick } = parsed.data;
    const userId = req.currentUser!.id;

    // Demo: return a deterministic seeded note, no AI call.
    if (isDemoRequest(req)) {
      res.json({ note: demoPrebetNote(sport, odds) });
      return;
    }

    // Pull settled straight bets for this bettor in the relevant sport and
    // bet type — this is the history Arc reads.
    const where = [
      eq(betsTable.userId, userId),
      inArray(betsTable.status, ["won", "lost", "push"]),
      eq(betsTable.sport, sport),
      ...(betType ? [eq(betsTable.betType, betType as "moneyline" | "spread" | "total" | "prop" | "futures")] : []),
    ];
    const history = (await db.select().from(betsTable).where(and(...where)).orderBy(desc(betsTable.settledAt)).limit(60)).filter(hasValidOdds);

    // Compute a compact fact summary — the AI only ever sees aggregates, never raw rows.
    const decided = history.filter((b) => b.status === "won" || b.status === "lost");
    const wins = decided.filter((b) => b.status === "won").length;
    const winRate = decided.length > 0 ? Math.round((wins / decided.length) * 1000) / 10 : null;
    const totalProfit = history.reduce((s, b) => s + (Number(b.actualPayout ?? 0) - Number(b.stake)), 0);
    const avgOdds = history.length > 0 ? Math.round(history.reduce((s, b) => s + b.odds, 0) / history.length) : null;

    // Similar-price bucket: ±50 from the proposed odds
    const similar = history.filter((b) => Math.abs(b.odds - odds) <= 50);
    const similarDecided = similar.filter((b) => b.status === "won" || b.status === "lost");
    const similarWins = similarDecided.filter((b) => b.status === "won").length;

    const facts = {
      sport,
      betType: betType ?? "all",
      proposedOdds: odds,
      proposedStake: stake ?? null,
      pick: pick ?? null,
      settledPlays: history.length,
      record: { wins, losses: decided.length - wins, pushes: history.length - decided.length },
      winRate,
      netProfit: Math.round(totalProfit * 100) / 100,
      avgOdds,
      similarOddsRange: {
        plays: similar.length,
        wins: similarWins,
        losses: similarDecided.length - similarWins,
        winRate: similarDecided.length > 0 ? Math.round((similarWins / similarDecided.length) * 1000) / 10 : null,
      },
    };

    // ── Richer coaching context (Task #201) ────────────────────────────────
    // Fav/dog performance, sport ROI, and top repeated mistake — computed
    // from the already-loaded history. All null when sample is too thin.
    // The AI prompt instructs the model to only cite these when non-null.
    const isFavorite = odds <= -100;
    const bucketBets = history.filter((b) => (isFavorite ? b.odds <= -100 : b.odds >= 100));
    const bucketDecided = bucketBets.filter((b) => b.status === "won" || b.status === "lost");
    const bucketWins = bucketDecided.filter((b) => b.status === "won").length;
    const bucketWagered = bucketBets.reduce((s, b) => s + Number(b.stake), 0);
    const bucketPayout = bucketBets.reduce((s, b) => s + Number(b.actualPayout ?? 0), 0);

    const favDogPerformance =
      bucketBets.length >= 3
        ? {
            bucket: isFavorite ? "favorite" : "underdog",
            plays: bucketBets.length,
            wins: bucketWins,
            losses: bucketDecided.length - bucketWins,
            winRate:
              bucketDecided.length > 0
                ? Math.round((bucketWins / bucketDecided.length) * 1000) / 10
                : null,
            roi:
              bucketWagered > 0
                ? Math.round(((bucketPayout - bucketWagered) / bucketWagered) * 10000) / 100
                : null,
          }
        : null;

    const missReasonAgg: Record<string, number> = {};
    for (const b of history) {
      if (b.status !== "lost" || !b.missReason || b.missReason === "na" || b.missReason === "normal_variance") continue;
      missReasonAgg[b.missReason] = (missReasonAgg[b.missReason] ?? 0) + 1;
    }
    const topMissEntry = Object.entries(missReasonAgg).sort((a, b) => b[1] - a[1])[0];
    const topMissReasonInSport =
      topMissEntry && topMissEntry[1] >= 2 ? { reason: topMissEntry[0], count: topMissEntry[1] } : null;

    const sportWagered = history.reduce((s, b) => s + Number(b.stake), 0);
    const sportPayout = history.reduce((s, b) => s + Number(b.actualPayout ?? 0), 0);
    const sportRoi =
      sportWagered > 0 && history.length >= 5
        ? Math.round(((sportPayout - sportWagered) / sportWagered) * 10000) / 100
        : null;

    const enrichedFacts = { ...facts, favDogPerformance, topMissReasonInSport, sportRoi };

    try {
      const { openai } = await import("@workspace/integrations-openai-ai-server");
      // A slow provider must not hang the request — the form is waiting on
      // this. Race the call against a hard deadline; a timeout falls through
      // to the same 503 the client already knows how to shrug off.
      const rawTimeout = Number(process.env.PRE_BET_AI_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.floor(rawTimeout) : 8000;
      let deadline: NodeJS.Timeout | undefined;
      const completion = await Promise.race([
        openai.chat.completions.create({
          model: "gpt-4.1-mini",
          max_completion_tokens: 200,
          messages: [
            { role: "system", content: PRE_BET_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Here is this bettor's history for the bet they're about to place. Give them the coaching note.\n\n${JSON.stringify(enrichedFacts, null, 2)}`,
            },
          ],
        }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error(`AI provider timed out after ${timeoutMs}ms`)), timeoutMs);
          deadline.unref?.();
        }),
      ]).finally(() => clearTimeout(deadline));
      const note = completion.choices[0]?.message?.content?.trim();
      if (!note) throw new Error("Empty response from AI");
      res.json({ note });
    } catch (err) {
      logger.warn({ err, userId, sport }, "Pre-bet coaching note unavailable");
      res.status(503).json({ error: "coaching_unavailable", message: "Arc is taking a breather — try again in a moment." });
    }
  }
);

// GET /stats/peer-benchmarks — anonymous platform-wide percentile comparison (Pro)
router.get("/stats/peer-benchmarks", requireProfile, requirePro, async (req, res): Promise<void> => {
  const me = req.currentUser!;

  // Opted-out users get a clean response — they're not in the sample and
  // can't view benchmarks (the pool they'd compare against excludes them).
  if (!me.includedInBenchmarks) {
    res.json({ optedOut: true, sampleSize: 0, computedAt: null, benchmarks: [] });
    return;
  }

  // Lazy refresh + per-user benchmark computation. Best-effort: if the
  // aggregate job fails (e.g. no users yet), we still return the user's
  // own values with null percentile bands.
  try {
    const result = await buildPeerBenchmarks(me.id);
    res.json({ optedOut: false, ...result });
  } catch (err) {
    logger.warn({ err, userId: me.id }, "Peer benchmark computation failed");
    res.json({ optedOut: false, sampleSize: 0, computedAt: null, benchmarks: [] });
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
