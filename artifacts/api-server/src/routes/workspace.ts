import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sum } from "drizzle-orm";
import { db, usersTable, betsTable, parlaysTable, transactionsTable } from "@workspace/db";

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
        .orderBy(desc(transactionsTable.createdAt))
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

export default router;
