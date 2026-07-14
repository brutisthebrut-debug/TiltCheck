import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db, betsTable, usersTable, transactionsTable } from "@workspace/db";
import {
  ListBetsQueryParams,
  CreateBetBody,
  GetBetParams,
  UpdateBetParams,
  UpdateBetBody,
  DeleteBetParams,
  SettleBetParams,
  SettleBetBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function calcPayout(odds: number, stake: number): number {
  if (odds < 0) return stake * (100 / Math.abs(odds)) + stake;
  return stake * (odds / 100) + stake;
}

function formatBet(b: typeof betsTable.$inferSelect, userName: string) {
  return {
    id: b.id,
    userId: b.userId,
    userName,
    sport: b.sport,
    event: b.event,
    betType: b.betType,
    pick: b.pick,
    odds: b.odds,
    stake: Number(b.stake),
    potentialPayout: Number(b.potentialPayout),
    actualPayout: b.actualPayout != null ? Number(b.actualPayout) : null,
    status: b.status,
    gameDate: b.gameDate,
    confidenceScore: b.confidenceScore,
    rationale: b.rationale ?? null,
    postGameReview: b.postGameReview ?? null,
    tags: b.tags ?? [],
    createdAt: b.createdAt.toISOString(),
    settledAt: b.settledAt ? b.settledAt.toISOString() : null,
  };
}

// GET /bets
router.get("/bets", async (req, res): Promise<void> => {
  const query = ListBetsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { userId, status, sport, limit } = query.data;

  const conditions = [];
  if (userId != null) conditions.push(eq(betsTable.userId, userId));
  if (status != null) conditions.push(eq(betsTable.status, status));
  if (sport != null) conditions.push(eq(betsTable.sport, sport));

  const rows = await db
    .select({ bet: betsTable, user: usersTable })
    .from(betsTable)
    .leftJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(betsTable.createdAt))
    .limit(limit ?? 50);

  res.json(rows.map(({ bet, user }) => formatBet(bet, user?.displayName ?? "Unknown")));
});

// POST /bets
router.post("/bets", async (req, res): Promise<void> => {
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const payout = calcPayout(d.odds, Number(d.stake));

  const [bet] = await db
    .insert(betsTable)
    .values({
      userId: d.userId,
      sport: d.sport,
      event: d.event,
      betType: d.betType,
      pick: d.pick,
      odds: d.odds,
      stake: String(d.stake),
      potentialPayout: String(payout.toFixed(2)),
      gameDate: d.gameDate,
      confidenceScore: d.confidenceScore,
      rationale: d.rationale ?? null,
      tags: d.tags ?? [],
    })
    .returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, bet.userId));
  res.status(201).json(formatBet(bet, user?.displayName ?? "Unknown"));
});

// GET /bets/:id
router.get("/bets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetBetParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({ bet: betsTable, user: usersTable })
    .from(betsTable)
    .leftJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(eq(betsTable.id, params.data.id));
  if (rows.length === 0) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  res.json(formatBet(rows[0].bet, rows[0].user?.displayName ?? "Unknown"));
});

// PATCH /bets/:id
router.patch("/bets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateBetParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const updateValues: Record<string, unknown> = {};
  if (d.sport !== undefined) updateValues.sport = d.sport;
  if (d.event !== undefined) updateValues.event = d.event;
  if (d.betType !== undefined) updateValues.betType = d.betType;
  if (d.pick !== undefined) updateValues.pick = d.pick;
  if (d.odds !== undefined) updateValues.odds = d.odds;
  if (d.stake !== undefined) updateValues.stake = String(d.stake);
  if (d.gameDate !== undefined) updateValues.gameDate = d.gameDate;
  if (d.confidenceScore !== undefined) updateValues.confidenceScore = d.confidenceScore;
  if (d.rationale !== undefined) updateValues.rationale = d.rationale;
  if (d.tags !== undefined) updateValues.tags = d.tags;

  // Recalculate payout if odds or stake changed
  const [existing] = await db.select().from(betsTable).where(eq(betsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  if (d.odds !== undefined || d.stake !== undefined) {
    const newOdds = d.odds ?? existing.odds;
    const newStake = d.stake ?? Number(existing.stake);
    updateValues.potentialPayout = String(calcPayout(newOdds, Number(newStake)).toFixed(2));
  }

  const [updated] = await db
    .update(betsTable)
    .set(updateValues)
    .where(eq(betsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  res.json(formatBet(updated, user?.displayName ?? "Unknown"));
});

// DELETE /bets/:id
router.delete("/bets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteBetParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(betsTable).where(eq(betsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  res.sendStatus(204);
});

// PATCH /bets/:id/settle
router.patch("/bets/:id/settle", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SettleBetParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SettleBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, postGameReview } = parsed.data;
  const [existing] = await db.select().from(betsTable).where(eq(betsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }

  const actualPayout = status === "won"
    ? Number(existing.potentialPayout)
    : status === "push"
    ? Number(existing.stake)
    : 0;

  const [updated] = await db
    .update(betsTable)
    .set({
      status,
      actualPayout: String(actualPayout.toFixed(2)),
      postGameReview: postGameReview ?? null,
      settledAt: new Date(),
    })
    .where(eq(betsTable.id, params.data.id))
    .returning();

  // Get current balance for transaction
  const txRows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, existing.userId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(1);
  const currentBalance = txRows.length > 0 ? Number(txRows[0].balanceAfter) : Number(
    (await db.select().from(usersTable).where(eq(usersTable.id, existing.userId)))[0]?.startingBankroll ?? 0
  );

  const profit = actualPayout - Number(existing.stake);
  const newBalance = currentBalance + profit;
  const txType = status === "won" ? "bet_win" : status === "push" ? "bet_push" : "bet_loss";

  await db.insert(transactionsTable).values({
    userId: existing.userId,
    type: txType,
    amount: String(profit.toFixed(2)),
    balanceAfter: String(newBalance.toFixed(2)),
    referenceId: existing.id,
    referenceType: "bet",
    note: `${status === "won" ? "Won" : status === "push" ? "Push" : "Lost"}: ${existing.event}`,
  });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  res.json(formatBet(updated, user?.displayName ?? "Unknown"));
});

export default router;
