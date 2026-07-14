import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sum } from "drizzle-orm";
import { db, usersTable, betsTable, parlaysTable, transactionsTable } from "@workspace/db";
import { GetWorkspaceLeaderboardQueryParams } from "@workspace/api-zod";
import { isValidAmericanOdds } from "../lib/odds";
import { requireProfile } from "../middlewares/auth";

const router: IRouter = Router();

// GET /workspace
router.get("/workspace", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  const betCount = await db.select({ count: betsTable.id }).from(betsTable);

  res.json({
    id: 1,
    name: "EdgeBoard Workspace",
    members: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarColor: u.avatarColor,
      startingBankroll: Number(u.startingBankroll),
      createdAt: u.createdAt.toISOString(),
    })),
    totalBets: betCount.length,
    createdAt: new Date().toISOString(),
  });
});

// GET /workspace/compare
router.get("/workspace/compare", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);

  const comparisons = await Promise.all(
    users.map(async (user) => {
      const bets = await db.select().from(betsTable).where(eq(betsTable.userId, user.id));
      const settled = bets.filter((b) => ["won", "lost", "push"].includes(b.status));
      const wins = settled.filter((b) => b.status === "won").length;
      const losses = settled.filter((b) => b.status === "lost").length;
      const winRate = settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : 0;

      const totalWagered = settled.reduce((acc, b) => acc + Number(b.stake), 0);
      const totalPayout = settled.reduce((acc, b) => acc + (b.actualPayout != null ? Number(b.actualPayout) : 0), 0);
      const profit = totalPayout - totalWagered;
      const roi = totalWagered > 0 ? Math.round((profit / totalWagered) * 10000) / 100 : 0;
      const avgConfidence = bets.length > 0 ? Math.round(bets.reduce((acc, b) => acc + b.confidenceScore, 0) / bets.length * 10) / 10 : 0;

      // Current bankroll
      const txRows = await db
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.userId, user.id))
        .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
        .limit(1);
      const currentBankroll = txRows.length > 0 ? Number(txRows[0].balanceAfter) : Number(user.startingBankroll);

      // Hot sport (most wins)
      const sportWins: Record<string, number> = {};
      settled.filter((b) => b.status === "won").forEach((b) => {
        sportWins[b.sport] = (sportWins[b.sport] ?? 0) + 1;
      });
      const hotSport = Object.keys(sportWins).length > 0
        ? Object.entries(sportWins).sort(([, a], [, b]) => b - a)[0][0]
        : null;

      return {
        userId: user.id,
        userName: user.displayName,
        avatarColor: user.avatarColor,
        totalBets: bets.length,
        wins,
        losses,
        winRate,
        roi,
        totalProfit: Math.round(profit * 100) / 100,
        currentBankroll,
        avgConfidence,
        hotSport,
      };
    })
  );

  res.json(comparisons);
});

// GET /workspace/leaderboard — crew ranked by settled results over a window.
// Settled plays only decide the ranking; pending plays surface as inPlayCount.
// Dead-zone-odds rows are excluded exactly like the stats endpoints do.
router.get("/workspace/leaderboard", requireProfile, async (req, res): Promise<void> => {
  const query = GetWorkspaceLeaderboardQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const period = query.data.period ?? "all";
  const windowStart =
    period === "week"
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      : period === "month"
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : null;

  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  const allBets = (await db.select().from(betsTable)).filter((b) => isValidAmericanOdds(b.odds));
  const allParlays = (await db.select().from(parlaysTable)).filter((p) => isValidAmericanOdds(p.odds));

  const SETTLED = ["won", "lost", "push"];
  const inWindow = (settledAt: Date | null) =>
    windowStart == null || (settledAt != null && settledAt >= windowStart);

  const rows = users.map((user) => {
    const bets = allBets.filter((b) => b.userId === user.id);
    const parlays = allParlays.filter((p) => p.userId === user.id);

    // Everything settled (any time) — used for the current streak, which is
    // inherently "right now" and shouldn't reset at a window boundary.
    const settledAll = [
      ...bets.filter((b) => SETTLED.includes(b.status)),
      ...parlays.filter((p) => SETTLED.includes(p.status)),
    ].sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));

    let curWin = 0;
    let curLoss = 0;
    for (const item of settledAll) {
      if (item.status === "won") { curWin++; curLoss = 0; }
      else if (item.status === "lost") { curLoss++; curWin = 0; }
      else { curWin = 0; curLoss = 0; }
    }
    const currentStreak = curWin > 0 ? curWin : curLoss;
    const currentStreakType = curWin > 0 ? "win" : curLoss > 0 ? "loss" : "none";

    // Window-scoped settled plays decide the ranking numbers
    const settled = settledAll.filter((item) => inWindow(item.settledAt));
    const wins = settled.filter((i) => i.status === "won").length;
    const losses = settled.filter((i) => i.status === "lost").length;
    const pushes = settled.filter((i) => i.status === "push").length;
    const totalWagered = settled.reduce((acc, i) => acc + Number(i.stake), 0);
    const totalPayout = settled.reduce(
      (acc, i) => acc + (i.actualPayout != null ? Number(i.actualPayout) : 0),
      0,
    );
    const profit = totalPayout - totalWagered;
    const roi = totalWagered > 0 ? (profit / totalWagered) * 100 : 0;

    const inPlayCount =
      bets.filter((b) => b.status === "pending").length +
      parlays.filter((p) => p.status === "pending").length;

    // Best sport = most wins inside the window (straight bets carry the sport)
    const sportWins: Record<string, number> = {};
    for (const b of bets) {
      if (b.status !== "won" || !inWindow(b.settledAt)) continue;
      sportWins[b.sport] = (sportWins[b.sport] ?? 0) + 1;
    }
    const bestSport =
      Object.keys(sportWins).length > 0
        ? Object.entries(sportWins).sort(([, a], [, b]) => b - a)[0][0]
        : null;

    // Favorite mistake = most common miss reason on losses inside the window
    const reasonCounts: Record<string, number> = {};
    for (const item of settled) {
      if (item.status !== "lost") continue;
      if (item.missReason == null || item.missReason === "na") continue;
      reasonCounts[item.missReason] = (reasonCounts[item.missReason] ?? 0) + 1;
    }
    const favoriteMistake =
      Object.keys(reasonCounts).length > 0
        ? Object.entries(reasonCounts).sort(([, a], [, b]) => b - a)[0][0]
        : null;

    return {
      userId: user.id,
      userName: user.displayName,
      avatarColor: user.avatarColor,
      wins,
      losses,
      pushes,
      settledCount: settled.length,
      profit: Math.round(profit * 100) / 100,
      totalWagered: Math.round(totalWagered * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      inPlayCount,
      currentStreak,
      currentStreakType,
      bestSport,
      favoriteMistake,
    };
  });

  // Rank: members with settled plays first (profit desc, ROI, wins), then the
  // rest — so an idle member never outranks someone actually down money by
  // "not betting".
  rows.sort((a, b) => {
    if ((a.settledCount > 0) !== (b.settledCount > 0)) return a.settledCount > 0 ? -1 : 1;
    if (a.profit !== b.profit) return b.profit - a.profit;
    if (a.roi !== b.roi) return b.roi - a.roi;
    return b.wins - a.wins;
  });

  res.json(rows.map((row, i) => ({ rank: i + 1, ...row })));
});

export default router;
