import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, parlaysTable, parlayLegsTable, usersTable, transactionsTable } from "@workspace/db";
import {
  ListParlaysQueryParams,
  CreateParlayBody,
} from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import {
  GetParlayParams,
  UpdateParlayParams,
  UpdateParlayBody,
  DeleteParlayParams,
  SettleParlayParams,
  SettleParlayBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function formatLeg(leg: typeof parlayLegsTable.$inferSelect) {
  return {
    id: leg.id,
    parlayId: leg.parlayId,
    sport: leg.sport,
    event: leg.event,
    betType: leg.betType,
    pick: leg.pick,
    odds: leg.odds,
    gameDate: leg.gameDate,
    status: leg.status,
  };
}

async function formatParlay(p: typeof parlaysTable.$inferSelect, userName: string) {
  const legs = await db.select().from(parlayLegsTable).where(eq(parlayLegsTable.parlayId, p.id));
  return {
    id: p.id,
    userId: p.userId,
    userName,
    name: p.name,
    stake: Number(p.stake),
    odds: p.odds,
    potentialPayout: Number(p.potentialPayout),
    actualPayout: p.actualPayout != null ? Number(p.actualPayout) : null,
    status: p.status,
    legs: legs.map(formatLeg),
    confidenceScore: p.confidenceScore,
    rationale: p.rationale ?? null,
    postGameReview: p.postGameReview ?? null,
    sportsbook: p.sportsbook ?? null,
    promoNote: p.promoNote ?? null,
    reasoningQuality: p.reasoningQuality ?? null,
    whatHappened: p.whatHappened ?? null,
    missReason: p.missReason ?? null,
    createdAt: p.createdAt.toISOString(),
    settledAt: p.settledAt ? p.settledAt.toISOString() : null,
  };
}

function americanToDecimal(odds: number): number {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function combineParlayOdds(legOdds: number[]): number {
  const combined = legOdds.reduce((acc, o) => acc * americanToDecimal(o), 1);
  return decimalToAmerican(combined);
}

function calcParlayPayout(combinedDecimal: number, stake: number): number {
  return combinedDecimal * stake;
}

// GET /parlays
router.get("/parlays", async (req, res): Promise<void> => {
  const query = ListParlaysQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { userId, status } = query.data;
  const conditions = [];
  if (userId != null) conditions.push(eq(parlaysTable.userId, userId));
  if (status != null) conditions.push(eq(parlaysTable.status, status));

  const rows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .leftJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(parlaysTable.createdAt));

  const results = await Promise.all(
    rows.map(({ parlay, user }) => formatParlay(parlay, user?.displayName ?? "Unknown"))
  );
  res.json(results);
});

// POST /parlays — always created for the signed-in user
router.post("/parlays", requireProfile, async (req, res): Promise<void> => {
  const parsed = CreateParlayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const legOddsArr = d.legs.map((l) => l.odds);
  const combinedOdds = combineParlayOdds(legOddsArr);
  const combinedDecimal = legOddsArr.reduce((acc, o) => acc * americanToDecimal(o), 1);
  const payout = calcParlayPayout(combinedDecimal, Number(d.stake));

  // Insert the parlay and its legs atomically so an interrupted request
  // can't leave a parlay row with zero legs.
  const parlay = await db.transaction(async (tx) => {
    const [createdParlay] = await tx
      .insert(parlaysTable)
      .values({
        userId: req.currentUser!.id,
        name: d.name,
        stake: String(d.stake),
        odds: combinedOdds,
        potentialPayout: String(payout.toFixed(2)),
        confidenceScore: d.confidenceScore,
        rationale: d.rationale ?? null,
        sportsbook: d.sportsbook ?? null,
        promoNote: d.promoNote ?? null,
      })
      .returning();

    await tx.insert(parlayLegsTable).values(
      d.legs.map((leg) => ({
        parlayId: createdParlay.id,
        sport: leg.sport,
        event: leg.event,
        betType: leg.betType,
        pick: leg.pick,
        odds: leg.odds,
        gameDate: leg.gameDate,
      }))
    );

    return createdParlay;
  });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parlay.userId));
  res.status(201).json(await formatParlay(parlay, user?.displayName ?? "Unknown"));
});

// GET /parlays/:id
router.get("/parlays/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetParlayParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .leftJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(eq(parlaysTable.id, params.data.id));
  if (rows.length === 0) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  res.json(await formatParlay(rows[0].parlay, rows[0].user?.displayName ?? "Unknown"));
});

// PATCH /parlays/:id
router.patch("/parlays/:id", requireProfile, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateParlayParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateParlayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [owned] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, params.data.id));
  if (!owned) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  if (owned.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only edit your own parlays" });
    return;
  }
  const updateValues: Record<string, unknown> = {};
  if (d.name !== undefined) updateValues.name = d.name;
  if (d.stake !== undefined) updateValues.stake = String(d.stake);
  if (d.confidenceScore !== undefined) updateValues.confidenceScore = d.confidenceScore;
  if (d.rationale !== undefined) updateValues.rationale = d.rationale;

  const [updated] = await db
    .update(parlaysTable)
    .set(updateValues)
    .where(eq(parlaysTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  res.json(await formatParlay(updated, user?.displayName ?? "Unknown"));
});

// DELETE /parlays/:id
router.delete("/parlays/:id", requireProfile, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteParlayParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [owned] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, params.data.id));
  if (!owned) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  if (owned.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only delete your own parlays" });
    return;
  }
  const [deleted] = await db.delete(parlaysTable).where(eq(parlaysTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  res.sendStatus(204);
});

// PATCH /parlays/:id/settle
router.patch("/parlays/:id/settle", requireProfile, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SettleParlayParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SettleParlayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, postGameReview, legResults, actualPayoutOverride, reasoningQuality, whatHappened, missReason } = parsed.data;
  const [existing] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  if (existing.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only settle your own parlays" });
    return;
  }
  if (existing.status !== "pending" || existing.settledAt != null) {
    res.status(409).json({ error: `Parlay is already settled (status: ${existing.status})` });
    return;
  }

  let actualPayout: number;
  if (status === "won") {
    actualPayout = actualPayoutOverride != null ? actualPayoutOverride : Number(existing.potentialPayout);
  } else if (status === "push" || status === "void") {
    actualPayout = Number(existing.stake);
  } else {
    actualPayout = 0;
  }

  // Perform the parlay update, leg updates, and the bankroll ledger insert
  // atomically so a mid-settle crash can't leave the parlay settled without
  // the balance moving.
  const updated = await db.transaction(async (tx) => {
    const [updatedParlay] = await tx
      .update(parlaysTable)
      .set({
        status,
        actualPayout: String(actualPayout.toFixed(2)),
        postGameReview: postGameReview ?? null,
        reasoningQuality: reasoningQuality ?? null,
        whatHappened: whatHappened ?? null,
        missReason: missReason ?? null,
        settledAt: new Date(),
      })
      .where(eq(parlaysTable.id, params.data.id))
      .returning();

    // Update leg statuses if provided
    if (legResults && legResults.length > 0) {
      for (const lr of legResults as Array<{ legId: number; status: string }>) {
        await tx.update(parlayLegsTable).set({ status: lr.status }).where(eq(parlayLegsTable.id, lr.legId));
      }
    }

    // Record transaction
    const txRows = await tx
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, existing.userId))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(1);
    const currentBalance = txRows.length > 0 ? Number(txRows[0].balanceAfter) : Number(
      (await tx.select().from(usersTable).where(eq(usersTable.id, existing.userId)))[0]?.startingBankroll ?? 0
    );

    const profit = actualPayout - Number(existing.stake);
    const newBalance = currentBalance + profit;
    const txType = status === "won" ? "bet_win"
      : status === "push" ? "bet_push"
      : status === "void" ? "bet_void"
      : "bet_loss";
    const txNote = status === "won" ? `Won parlay: ${existing.name}`
      : status === "push" ? `Push parlay: ${existing.name}`
      : status === "void" ? `Void parlay: ${existing.name}`
      : `Lost parlay: ${existing.name}`;

    await tx.insert(transactionsTable).values({
      userId: existing.userId,
      type: txType,
      amount: String(profit.toFixed(2)),
      balanceAfter: String(newBalance.toFixed(2)),
      referenceId: existing.id,
      referenceType: "parlay",
      note: txNote,
    });

    return updatedParlay;
  });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  res.json(await formatParlay(updated, user?.displayName ?? "Unknown"));
});

export default router;
