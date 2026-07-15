import { Router, type IRouter } from "express";
import { eq, desc, and, or, gte, lte, ilike, isNull, isNotNull, sql } from "drizzle-orm";
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
  UnsettleBetParams,
} from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { isRealCalendarDate, INVALID_GAME_DATE_MESSAGE } from "../lib/dates";
import { isValidAmericanOdds, INVALID_ODDS_MESSAGE } from "../lib/odds";
import { likeContains, clampPageSize } from "../lib/search";
import { userScopeCondition } from "../lib/scope";
import { lockUserLedger } from "../lib/ledger";

const router: IRouter = Router();

function calcPayout(odds: number, stake: number): number {
  if (odds < 0) return stake * (100 / Math.abs(odds)) + stake;
  return stake * (odds / 100) + stake;
}

export function formatBet(b: typeof betsTable.$inferSelect, userName: string) {
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
    sportsbook: b.sportsbook ?? null,
    promoNote: b.promoNote ?? null,
    reasoningQuality: b.reasoningQuality ?? null,
    whatHappened: b.whatHappened ?? null,
    missReason: b.missReason ?? null,
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
  const { userId, status, sport, sportsbook, q, dateFrom, dateTo, oddsMin, oddsMax, day, stakeMin, stakeMax, limit, offset } = query.data;

  // World scoping: the join to users is inner + scoped, so demo sessions only
  // ever see demo bets and real sessions never see demo bets — even when an
  // explicit userId filter points across the boundary.
  const conditions = [userScopeCondition(req)];
  if (userId != null) conditions.push(eq(betsTable.userId, userId));
  if (status != null) conditions.push(eq(betsTable.status, status));
  if (sport != null) conditions.push(eq(betsTable.sport, sport));
  if (sportsbook != null) conditions.push(eq(betsTable.sportsbook, sportsbook));
  if (q != null && q.trim() !== "") {
    const pattern = likeContains(q.trim());
    conditions.push(or(ilike(betsTable.event, pattern), ilike(betsTable.pick, pattern))!);
  }
  if (dateFrom != null) conditions.push(gte(betsTable.gameDate, dateFrom));
  if (dateTo != null) conditions.push(lte(betsTable.gameDate, dateTo));
  if (oddsMin != null) conditions.push(gte(betsTable.odds, oddsMin));
  if (oddsMax != null) conditions.push(lte(betsTable.odds, oddsMax));
  if (day != null) {
    // Same convention as Edge Finder's day lanes: the UTC weekday of the
    // game date (postgres DOW: 0 = Sunday … 6 = Saturday).
    const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(day);
    conditions.push(sql`extract(dow from ${betsTable.gameDate}) = ${dow}`);
  }
  if (stakeMin != null) conditions.push(gte(betsTable.stake, String(stakeMin)));
  if (stakeMax != null) conditions.push(lte(betsTable.stake, String(stakeMax)));

  const rows = await db
    .select({ bet: betsTable, user: usersTable })
    .from(betsTable)
    .innerJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(betsTable.createdAt), desc(betsTable.id))
    .limit(clampPageSize(limit, 50))
    .offset(Math.max(0, offset ?? 0));

  res.json(rows.map(({ bet, user }) => formatBet(bet, user?.displayName ?? "Unknown")));
});

// POST /bets — always created for the signed-in user
router.post("/bets", requireProfile, async (req, res): Promise<void> => {
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  if (!isRealCalendarDate(d.gameDate)) {
    res.status(400).json({ error: INVALID_GAME_DATE_MESSAGE });
    return;
  }
  if (!isValidAmericanOdds(d.odds)) {
    res.status(400).json({ error: INVALID_ODDS_MESSAGE });
    return;
  }
  const payout = calcPayout(d.odds, Number(d.stake));

  const [bet] = await db
    .insert(betsTable)
    .values({
      userId: req.currentUser!.id,
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
      sportsbook: d.sportsbook ?? null,
      promoNote: d.promoNote ?? null,
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
    .innerJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(and(eq(betsTable.id, params.data.id), userScopeCondition(req)));
  if (rows.length === 0) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  res.json(formatBet(rows[0].bet, rows[0].user?.displayName ?? "Unknown"));
});

// PATCH /bets/:id
router.patch("/bets/:id", requireProfile, async (req, res): Promise<void> => {
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
  if (d.gameDate !== undefined && !isRealCalendarDate(d.gameDate)) {
    res.status(400).json({ error: INVALID_GAME_DATE_MESSAGE });
    return;
  }
  if (d.odds !== undefined && !isValidAmericanOdds(d.odds)) {
    res.status(400).json({ error: INVALID_ODDS_MESSAGE });
    return;
  }
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
  if (existing.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only edit your own bets" });
    return;
  }
  // Financial fields are frozen once a bet is settled: the recorded result
  // and its bankroll ledger entry were computed from the original odds/stake,
  // so editing them would silently desync the bet from the money that moved.
  // Non-financial fields (rationale, tags, etc.) stay editable.
  if (
    (d.odds !== undefined || d.stake !== undefined) &&
    (existing.status !== "pending" || existing.settledAt != null)
  ) {
    res.status(409).json({
      error:
        "This bet is already settled — its odds and stake are locked into the recorded result and bankroll ledger. If the numbers were wrong, delete the bet and re-log it.",
    });
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
router.delete("/bets/:id", requireProfile, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteBetParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(betsTable).where(eq(betsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  if (existing.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only delete your own bets" });
    return;
  }
  // Delete the bet and reverse any bankroll impact atomically so a deleted
  // settled bet can't leave ghost money in the ledger.
  //
  // Ledger convention (see transactionsTable schema): the ledger is
  // append-only and `balanceAfter` is a point-in-time snapshot. We never
  // rewrite `balanceAfter` on rows recorded between the original settle and
  // this deletion — those snapshots were correct when written. Instead we
  // append a compensating "adjustment" row, which preserves the chain
  // invariant balanceAfter[n] = balanceAfter[n-1] + amount[n] for every row.
  const deleted = await db.transaction(async (tx) => {
    await lockUserLedger(tx, existing.userId);
    const [deletedBet] = await tx.delete(betsTable).where(eq(betsTable.id, params.data.id)).returning();
    if (!deletedBet) return null;

    // Find ledger entries tied to this bet and reverse their net impact.
    const linkedTxs = await tx
      .select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.referenceId, deletedBet.id),
          eq(transactionsTable.referenceType, "bet"),
          eq(transactionsTable.userId, deletedBet.userId)
        )
      );
    const netImpact = linkedTxs.reduce((sum, t) => sum + Number(t.amount), 0);

    if (linkedTxs.length > 0 && netImpact !== 0) {
      const lastTx = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.userId, deletedBet.userId))
        .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
        .limit(1);
      const currentBalance = lastTx.length > 0 ? Number(lastTx[0].balanceAfter) : Number(
        (await tx.select().from(usersTable).where(eq(usersTable.id, deletedBet.userId)))[0]?.startingBankroll ?? 0
      );
      await tx.insert(transactionsTable).values({
        userId: deletedBet.userId,
        type: "adjustment",
        amount: String((-netImpact).toFixed(2)),
        balanceAfter: String((currentBalance - netImpact).toFixed(2)),
        referenceId: deletedBet.id,
        referenceType: "bet",
        note: `Reversal: deleted bet ${deletedBet.event}`,
        // Stamped inside the ledger lock with the DB clock (default now() is
        // tx-start time, which can misorder rows for lock waiters; JS clocks
        // can skew across instances).
        createdAt: sql`clock_timestamp()`,
      });
    }

    return deletedBet;
  });
  if (!deleted) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  res.sendStatus(204);
});

// PATCH /bets/:id/settle
router.patch("/bets/:id/settle", requireProfile, async (req, res): Promise<void> => {
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
  const { status, postGameReview, actualPayoutOverride, reasoningQuality, whatHappened, missReason } = parsed.data;
  const [existing] = await db.select().from(betsTable).where(eq(betsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  if (existing.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only settle your own bets" });
    return;
  }
  if (existing.status !== "pending" || existing.settledAt != null) {
    res.status(409).json({ error: `Bet is already settled (status: ${existing.status})` });
    return;
  }

  // Calculate actual payout:
  // - won: use override if provided, else potentialPayout
  // - push/void: return stake (no profit)
  // - lost: 0
  let actualPayout: number;
  if (status === "won") {
    actualPayout = actualPayoutOverride != null ? actualPayoutOverride : Number(existing.potentialPayout);
  } else if (status === "push" || status === "void") {
    actualPayout = Number(existing.stake);
  } else {
    actualPayout = 0;
  }

  // Perform the bet update and the bankroll ledger insert atomically so a
  // mid-settle crash can't leave the bet settled without the balance moving.
  // The write re-checks pending status so two concurrent settles can never
  // both land (a double ledger entry would corrupt the bankroll).
  let updated: typeof betsTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
    await lockUserLedger(tx, existing.userId);
    const [updatedBet] = await tx
      .update(betsTable)
      .set({
        status,
        actualPayout: String(actualPayout.toFixed(2)),
        postGameReview: postGameReview ?? null,
        reasoningQuality: reasoningQuality ?? null,
        whatHappened: whatHappened ?? null,
        missReason: missReason ?? null,
        settledAt: new Date(),
      })
      .where(and(eq(betsTable.id, params.data.id), eq(betsTable.status, "pending"), isNull(betsTable.settledAt)))
      .returning();
    if (!updatedBet) {
      throw Object.assign(new Error("Bet was already settled by another request."), { statusCode: 409 });
    }

    // Get current balance for transaction
    const txRows = await tx
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, existing.userId))
      .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
      .limit(1);
    const currentBalance = txRows.length > 0 ? Number(txRows[0].balanceAfter) : Number(
      (await tx.select().from(usersTable).where(eq(usersTable.id, existing.userId)))[0]?.startingBankroll ?? 0
    );

    // profit: void/push = 0 (stake returned), won = payout - stake, lost = -stake
    const profit = actualPayout - Number(existing.stake);
    const newBalance = currentBalance + profit;
    const txType = status === "won" ? "bet_win"
      : status === "push" ? "bet_push"
      : status === "void" ? "bet_void"
      : "bet_loss";
    const txNote = status === "won" ? `Won: ${existing.event}`
      : status === "push" ? `Push: ${existing.event}`
      : status === "void" ? `Void: ${existing.event}`
      : `Lost: ${existing.event}`;

    await tx.insert(transactionsTable).values({
      userId: existing.userId,
      type: txType,
      amount: String(profit.toFixed(2)),
      balanceAfter: String(newBalance.toFixed(2)),
      referenceId: existing.id,
      referenceType: "bet",
      note: txNote,
      // Stamped inside the ledger lock with the DB clock (default now() is
      // tx-start time, which can misorder rows for lock waiters; JS clocks
      // can skew across instances).
      createdAt: sql`clock_timestamp()`,
    });

    return updatedBet;
    });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  res.json(formatBet(updated, user?.displayName ?? "Unknown"));
});

// POST /bets/:id/unsettle — reopen a settled bet so a wrong result can be
// fixed. Owner-only. Appends a compensating ledger adjustment reversing the
// settlement's net impact (the ledger is append-only — recorded rows are
// never rewritten) and returns the bet to pending so the normal settle flow
// can run again with the right result.
router.post("/bets/:id/unsettle", requireProfile, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UnsettleBetParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(betsTable).where(eq(betsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }
  if (existing.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only reopen your own bets" });
    return;
  }

  let reopened: typeof betsTable.$inferSelect;
  try {
    reopened = await db.transaction(async (tx) => {
      await lockUserLedger(tx, existing.userId);
      // The WHERE re-checks settled state so a concurrent unsettle (or a
      // racing settle) can never double-append the reversal.
      const [updatedBet] = await tx
        .update(betsTable)
        .set({ status: "pending", actualPayout: null, settledAt: null })
        .where(and(eq(betsTable.id, params.data.id), isNotNull(betsTable.settledAt)))
        .returning();
      if (!updatedBet) {
        throw Object.assign(new Error("This bet isn't settled — there's nothing to reopen."), { statusCode: 409 });
      }

      // Reverse the settlement's net ledger impact with a compensating
      // adjustment, exactly like deletion does.
      const linkedTxs = await tx
        .select()
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.referenceId, updatedBet.id),
            eq(transactionsTable.referenceType, "bet"),
            eq(transactionsTable.userId, updatedBet.userId)
          )
        );
      const netImpact = linkedTxs.reduce((sum, t) => sum + Number(t.amount), 0);
      if (linkedTxs.length > 0 && netImpact !== 0) {
        const lastTx = await tx
          .select()
          .from(transactionsTable)
          .where(eq(transactionsTable.userId, updatedBet.userId))
          .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
          .limit(1);
        const currentBalance = lastTx.length > 0 ? Number(lastTx[0].balanceAfter) : Number(
          (await tx.select().from(usersTable).where(eq(usersTable.id, updatedBet.userId)))[0]?.startingBankroll ?? 0
        );
        await tx.insert(transactionsTable).values({
          userId: updatedBet.userId,
          type: "adjustment",
          amount: String((-netImpact).toFixed(2)),
          balanceAfter: String((currentBalance - netImpact).toFixed(2)),
          referenceId: updatedBet.id,
          referenceType: "bet",
          note: `Reversal: reopened bet ${updatedBet.event}`,
          // Stamped inside the ledger lock with the DB clock (default now() is
          // tx-start time, which can misorder rows for lock waiters; JS clocks
          // can skew across instances).
          createdAt: sql`clock_timestamp()`,
        });
      }
      return updatedBet;
    });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, reopened.userId));
  res.json(formatBet(reopened, user?.displayName ?? "Unknown"));
});

export default router;
