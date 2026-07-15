import { Router, type IRouter } from "express";
import { eq, desc, and, or, ilike, inArray, isNull, sql } from "drizzle-orm";
import { db, parlaysTable, parlayLegsTable, usersTable, transactionsTable } from "@workspace/db";
import {
  ListParlaysQueryParams,
  CreateParlayBody,
} from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { likeContains, clampPageSize } from "../lib/search";
import { userScopeCondition } from "../lib/scope";
import { isRealCalendarDate, INVALID_GAME_DATE_MESSAGE } from "../lib/dates";
import {
  isValidAmericanOdds,
  INVALID_ODDS_MESSAGE,
  combineAmerican,
  combineDecimalExact,
} from "../lib/odds";
import {
  GetParlayParams,
  UpdateParlayParams,
  UpdateParlayBody,
  DeleteParlayParams,
  SettleParlayParams,
  SettleParlayBody,
  UpdateParlayLegParams,
  RecomputeParlayOddsParams,
  UpdateParlayLegBody,
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

export async function formatParlay(p: typeof parlaysTable.$inferSelect, userName: string) {
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
  const { userId, status, sport, sportsbook, q, dateFrom, dateTo, limit, offset } = query.data;
  // World scoping: inner join + scope condition keeps demo and real parlays
  // strictly separated regardless of any explicit userId filter.
  const conditions = [userScopeCondition(req)];
  if (userId != null) conditions.push(eq(parlaysTable.userId, userId));
  if (status != null) conditions.push(eq(parlaysTable.status, status));
  if (sportsbook != null) conditions.push(eq(parlaysTable.sportsbook, sportsbook));
  if (sport != null) {
    // A parlay matches a sport filter when at least one leg is in that sport.
    conditions.push(
      inArray(
        parlaysTable.id,
        db
          .select({ id: parlayLegsTable.parlayId })
          .from(parlayLegsTable)
          .where(eq(parlayLegsTable.sport, sport))
      )
    );
  }
  if (q != null && q.trim() !== "") {
    const pattern = likeContains(q.trim());
    conditions.push(
      or(
        ilike(parlaysTable.name, pattern),
        inArray(
          parlaysTable.id,
          db
            .select({ id: parlayLegsTable.parlayId })
            .from(parlayLegsTable)
            .where(or(ilike(parlayLegsTable.event, pattern), ilike(parlayLegsTable.pick, pattern)))
        )
      )!
    );
  }
  // Date range compares the creation date (what the list displays).
  if (dateFrom != null) conditions.push(sql`${parlaysTable.createdAt}::date >= ${dateFrom}::date`);
  if (dateTo != null) conditions.push(sql`${parlaysTable.createdAt}::date <= ${dateTo}::date`);

  const rows = await db
    .select({ parlay: parlaysTable, user: usersTable })
    .from(parlaysTable)
    .innerJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(parlaysTable.createdAt), desc(parlaysTable.id))
    .limit(clampPageSize(limit, 50))
    .offset(Math.max(0, offset ?? 0));

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
  const badDateLeg = d.legs.find((l) => !isRealCalendarDate(l.gameDate));
  if (badDateLeg) {
    res.status(400).json({
      error: `${INVALID_GAME_DATE_MESSAGE} (got "${badDateLeg.gameDate}" for ${badDateLeg.event})`,
    });
    return;
  }
  const badOddsLeg = d.legs.find((l) => !isValidAmericanOdds(l.odds));
  if (badOddsLeg) {
    res.status(400).json({
      error: `${INVALID_ODDS_MESSAGE} (got ${badOddsLeg.odds} for ${badOddsLeg.event})`,
    });
    return;
  }
  const legOddsArr = d.legs.map((l) => l.odds);
  const combinedOdds = combineAmerican(legOddsArr);
  const combinedDecimal = combineDecimalExact(legOddsArr);
  const payout = calcParlayPayout(combinedDecimal, Number(d.stake));

  // Even with each leg's odds bounded, the *combined* odds of many long-shot
  // legs can exceed what the database can store (int4 odds, numeric(12,2)
  // payout). Reject those up front with a clear 400 instead of a DB 500.
  const INT4_MAX = 2147483647;
  const MAX_PAYOUT = 9_999_999_999.99; // numeric(12,2) ceiling
  if (!Number.isFinite(combinedOdds) || Math.abs(combinedOdds) > INT4_MAX || payout > MAX_PAYOUT) {
    res.status(400).json({
      error:
        "Combined parlay odds are too large to store. Remove a leg or use less extreme odds.",
    });
    return;
  }

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
    .innerJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(and(eq(parlaysTable.id, params.data.id), userScopeCondition(req)));
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
  // The stake is frozen once a parlay is settled: the recorded payout and its
  // bankroll ledger entry were computed from the original stake, so editing it
  // would silently desync the parlay from the money that moved. (Leg odds are
  // guarded the same way in PATCH /parlays/:id/legs/:legId.)
  if (d.stake !== undefined && (owned.status !== "pending" || owned.settledAt != null)) {
    res.status(409).json({
      error:
        "This parlay is already settled — its stake is locked into the recorded result and bankroll ledger. If the numbers were wrong, delete the parlay and re-log it.",
    });
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

// PATCH /parlays/:id/legs/:legId — correct a pending parlay leg's odds.
//
// Rows saved before the dead-zone guard existed can carry impossible American
// odds (abs(odds) < 100). Only the owner knows the real price, so this lets
// them fix a single leg without rebuilding the whole parlay. The parlay's
// combined odds and potential payout are recomputed from ALL legs (math
// mirrors POST /parlays and scripts/src/audit-dead-zone-odds.ts).
//
// Settled parlays are intentionally rejected with 409: their actual payout is
// already part of the bankroll ledger, so rewriting leg odds after settlement
// would desync the recorded payout from the money that moved.
router.patch("/parlays/:id/legs/:legId", requireProfile, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawLegId = Array.isArray(req.params.legId) ? req.params.legId[0] : req.params.legId;
  const params = UpdateParlayLegParams.safeParse({
    id: parseInt(rawId, 10),
    legId: parseInt(rawLegId, 10),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateParlayLegBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const newOdds = parsed.data.odds;
  if (!isValidAmericanOdds(newOdds)) {
    res.status(400).json({ error: `${INVALID_ODDS_MESSAGE} (got ${newOdds})` });
    return;
  }

  const [parlay] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, params.data.id));
  if (!parlay) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  if (parlay.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only edit your own parlays" });
    return;
  }
  if (parlay.status !== "pending" || parlay.settledAt != null) {
    res.status(409).json({
      error:
        "This parlay is already settled, so its legs can't be edited — the recorded payout is part of the bankroll ledger.",
    });
    return;
  }

  const legs = await db
    .select()
    .from(parlayLegsTable)
    .where(eq(parlayLegsTable.parlayId, params.data.id));
  const targetLeg = legs.find((l) => l.id === params.data.legId);
  if (!targetLeg) {
    res.status(404).json({ error: "Leg not found on this parlay" });
    return;
  }

  // Recompute combined odds and payout from all legs with the corrected price.
  const legOddsArr = legs.map((l) => (l.id === targetLeg.id ? newOdds : l.odds));
  const combinedOdds = combineAmerican(legOddsArr);
  const combinedDecimal = combineDecimalExact(legOddsArr);
  const payout = calcParlayPayout(combinedDecimal, Number(parlay.stake));

  // Same storage bounds as POST /parlays (int4 odds, numeric(12,2) payout).
  const INT4_MAX = 2147483647;
  const MAX_PAYOUT = 9_999_999_999.99;
  if (!Number.isFinite(combinedOdds) || Math.abs(combinedOdds) > INT4_MAX || payout > MAX_PAYOUT) {
    res.status(400).json({
      error:
        "With these odds the combined parlay odds become too large to store. Double-check the corrected price.",
    });
    return;
  }

  // Update the leg and the parlay's derived numbers atomically so a crash
  // can't leave the combined odds out of sync with the legs. The parlay
  // write re-checks pending status so a settle landing mid-request can't
  // have its ledger-recorded numbers overwritten (no row -> rollback).
  let updated: typeof parlaysTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      await tx
        .update(parlayLegsTable)
        .set({ odds: newOdds })
        .where(and(eq(parlayLegsTable.id, targetLeg.id), eq(parlayLegsTable.parlayId, params.data.id)));
      const [updatedParlay] = await tx
        .update(parlaysTable)
        .set({
          odds: combinedOdds,
          potentialPayout: String(payout.toFixed(2)),
        })
        .where(
          and(
            eq(parlaysTable.id, params.data.id),
            eq(parlaysTable.status, "pending"),
            isNull(parlaysTable.settledAt),
          ),
        )
        .returning();
      if (!updatedParlay) {
        throw Object.assign(
          new Error(
            "This parlay was settled while the correction was in flight — its recorded payout is part of the bankroll ledger and can no longer change.",
          ),
          { statusCode: 409 },
        );
      }
      return updatedParlay;
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
  res.json(await formatParlay(updated, user?.displayName ?? "Unknown"));
});

// POST /parlays/:id/recompute-odds — for parlays whose stored combined odds
// are wrong (e.g. a dead-zone price) while every leg is valid. Owner-only,
// pending-only; recomputes exactly like a leg correction does.
router.post("/parlays/:id/recompute-odds", requireProfile, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = RecomputeParlayOddsParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [parlay] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, params.data.id));
  if (!parlay) {
    res.status(404).json({ error: "Parlay not found" });
    return;
  }
  if (parlay.userId !== req.currentUser!.id) {
    res.status(403).json({ error: "You can only edit your own parlays" });
    return;
  }
  if (parlay.status !== "pending" || parlay.settledAt != null) {
    res.status(409).json({
      error:
        "This parlay is already settled, so its odds can't be recomputed — the recorded payout is part of the bankroll ledger.",
    });
    return;
  }

  const legs = await db
    .select()
    .from(parlayLegsTable)
    .where(eq(parlayLegsTable.parlayId, params.data.id));
  if (legs.length === 0) {
    res.status(400).json({ error: "This parlay has no legs to recompute from." });
    return;
  }
  const invalidLegs = legs.filter((l) => !isValidAmericanOdds(l.odds));
  if (invalidLegs.length > 0) {
    res.status(400).json({
      error: `${invalidLegs.length === 1 ? "One leg still carries" : `${invalidLegs.length} legs still carry`} odds that aren't a real American price. Correct the flagged legs first — the combined odds recompute automatically with each correction.`,
    });
    return;
  }

  const legOddsArr = legs.map((l) => l.odds);
  const combinedOdds = combineAmerican(legOddsArr);
  const combinedDecimal = combineDecimalExact(legOddsArr);
  const payout = calcParlayPayout(combinedDecimal, Number(parlay.stake));

  // Same storage bounds as POST /parlays (int4 odds, numeric(12,2) payout).
  const INT4_MAX = 2147483647;
  const MAX_PAYOUT = 9_999_999_999.99;
  if (!Number.isFinite(combinedOdds) || Math.abs(combinedOdds) > INT4_MAX || payout > MAX_PAYOUT) {
    res.status(400).json({
      error: "The recomputed combined odds are too large to store. Double-check the leg prices.",
    });
    return;
  }

  // Enforce pending-only in the write itself, not just the pre-check — a
  // settle landing between the read and this update must not overwrite a
  // now-settled parlay's numbers (they're part of the bankroll ledger).
  const [updated] = await db
    .update(parlaysTable)
    .set({ odds: combinedOdds, potentialPayout: String(payout.toFixed(2)) })
    .where(
      and(
        eq(parlaysTable.id, params.data.id),
        eq(parlaysTable.status, "pending"),
        isNull(parlaysTable.settledAt),
      ),
    )
    .returning();
  if (!updated) {
    res.status(409).json({
      error:
        "This parlay was settled while the recompute was in flight — its recorded payout is part of the bankroll ledger and can no longer change.",
    });
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
  // Delete the parlay (and its legs) and reverse any bankroll impact
  // atomically so a deleted settled parlay can't leave ghost money in the ledger.
  //
  // Ledger convention (see transactionsTable schema): the ledger is
  // append-only and `balanceAfter` is a point-in-time snapshot. Rows recorded
  // between the original settle and this deletion keep their snapshots; the
  // appended "adjustment" row preserves the chain invariant
  // balanceAfter[n] = balanceAfter[n-1] + amount[n] for every row.
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(parlayLegsTable).where(eq(parlayLegsTable.parlayId, params.data.id));
    const [deletedParlay] = await tx.delete(parlaysTable).where(eq(parlaysTable.id, params.data.id)).returning();
    if (!deletedParlay) return null;

    // Find ledger entries tied to this parlay and reverse their net impact.
    const linkedTxs = await tx
      .select()
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.referenceId, deletedParlay.id),
          eq(transactionsTable.referenceType, "parlay"),
          eq(transactionsTable.userId, deletedParlay.userId)
        )
      );
    const netImpact = linkedTxs.reduce((sum, t) => sum + Number(t.amount), 0);

    if (linkedTxs.length > 0 && netImpact !== 0) {
      const lastTx = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.userId, deletedParlay.userId))
        .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
        .limit(1);
      const currentBalance = lastTx.length > 0 ? Number(lastTx[0].balanceAfter) : Number(
        (await tx.select().from(usersTable).where(eq(usersTable.id, deletedParlay.userId)))[0]?.startingBankroll ?? 0
      );
      await tx.insert(transactionsTable).values({
        userId: deletedParlay.userId,
        type: "adjustment",
        amount: String((-netImpact).toFixed(2)),
        balanceAfter: String((currentBalance - netImpact).toFixed(2)),
        referenceId: deletedParlay.id,
        referenceType: "parlay",
        note: `Reversal: deleted parlay ${deletedParlay.name}`,
      });
    }

    return deletedParlay;
  });
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

  // Verify every legId in legResults belongs to this parlay before touching
  // anything — a stray legId must never mutate another parlay's legs.
  if (legResults && legResults.length > 0) {
    const ownLegs = await db
      .select({ id: parlayLegsTable.id })
      .from(parlayLegsTable)
      .where(eq(parlayLegsTable.parlayId, params.data.id));
    const ownLegIds = new Set(ownLegs.map((l) => l.id));
    const foreignLegIds = (legResults as Array<{ legId: number }>)
      .map((lr) => lr.legId)
      .filter((legId) => !ownLegIds.has(legId));
    if (foreignLegIds.length > 0) {
      res.status(400).json({
        error: `legResults contains leg IDs that do not belong to this parlay: ${foreignLegIds.join(", ")}`,
      });
      return;
    }

    // Reject duplicate legIds — two entries for the same leg are ambiguous.
    const seenLegIds = new Set<number>();
    for (const lr of legResults as Array<{ legId: number }>) {
      if (seenLegIds.has(lr.legId)) {
        res.status(400).json({
          error: `legResults contains duplicate entries for leg ${lr.legId}`,
        });
        return;
      }
      seenLegIds.add(lr.legId);
    }

    // Cross-check the parlay status against the provided leg results so a
    // parlay can never be recorded as "won" while its own legs say it lost
    // (or vice versa). Partial legResults are intentionally allowed — legs
    // not listed simply keep their current status — so the "lost" check only
    // fires when every leg's result was provided (an unlisted leg could be
    // the losing one).
    const legStatuses = (legResults as Array<{ status: string }>).map((lr) => lr.status);
    const hasLostLeg = legStatuses.includes("lost");
    if ((status === "won" || status === "push" || status === "void") && hasLostLeg) {
      res.status(400).json({
        error: `Parlay cannot be settled as "${status}" when legResults marks a leg as lost. A lost leg means the parlay is lost.`,
      });
      return;
    }
    if (status === "lost" && legResults.length === ownLegIds.size && !hasLostLeg) {
      res.status(400).json({
        error: `Parlay cannot be settled as "lost" when every leg result is ${[...new Set(legStatuses)].map((s) => `"${s}"`).join("/")}. At least one leg must be lost.`,
      });
      return;
    }
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
  let updated: typeof parlaysTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
    // The write re-checks pending status so two concurrent settles can never
    // both land (a double ledger entry would corrupt the bankroll).
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
      .where(and(eq(parlaysTable.id, params.data.id), eq(parlaysTable.status, "pending"), isNull(parlaysTable.settledAt)))
      .returning();
    if (!updatedParlay) {
      throw Object.assign(new Error("Parlay was already settled by another request."), { statusCode: 409 });
    }

    // Update leg statuses if provided
    if (legResults && legResults.length > 0) {
      for (const lr of legResults as Array<{ legId: number; status: string }>) {
        // Scope the update to this parlay so a stray legId can never touch
        // another parlay's legs; a non-matching row aborts the transaction.
        const updatedLegs = await tx
          .update(parlayLegsTable)
          .set({ status: lr.status })
          .where(and(eq(parlayLegsTable.id, lr.legId), eq(parlayLegsTable.parlayId, params.data.id)))
          .returning({ id: parlayLegsTable.id });
        if (updatedLegs.length === 0) {
          throw Object.assign(new Error(`Leg ${lr.legId} does not belong to parlay ${params.data.id}`), {
            statusCode: 400,
          });
        }
      }
    }

    // Record transaction
    const txRows = await tx
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, existing.userId))
      .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
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
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 400 || statusCode === 409) {
      res.status(statusCode).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  res.json(await formatParlay(updated, user?.displayName ?? "Unknown"));
});

export default router;
