import { Router, type IRouter } from "express";
import { eq, asc, inArray } from "drizzle-orm";
import { db, betsTable, parlaysTable, parlayLegsTable, transactionsTable } from "@workspace/db";
import { requireProfile } from "../middlewares/auth";
import { toCsv, type CsvValue } from "../lib/csv";

const router: IRouter = Router();

function sendCsv(res: import("express").Response, filenameStem: string, csv: string): void {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="edgeboard-${filenameStem}-${date}.csv"`);
  // UTF-8 BOM so Excel detects the encoding for non-ASCII characters.
  res.send("\ufeff" + csv);
}

// Column order is part of the export contract — users build spreadsheets on
// top of it. Append new columns at the end; never reorder or rename.
export const BET_CSV_HEADER = [
  "id", "sport", "event", "bet_type", "pick", "odds", "stake",
  "potential_payout", "actual_payout", "status", "game_date", "sportsbook",
  "confidence_score", "tags", "rationale", "created_at", "settled_at",
];

export const PARLAY_CSV_HEADER = [
  "parlay_id", "parlay_name", "parlay_status", "parlay_odds", "stake",
  "potential_payout", "actual_payout", "sportsbook", "confidence_score",
  "created_at", "settled_at", "leg_number", "leg_id", "leg_sport",
  "leg_event", "leg_bet_type", "leg_pick", "leg_odds", "leg_game_date",
  "leg_status",
];

export const TRANSACTION_CSV_HEADER = [
  "id", "type", "amount", "balance_after", "note", "reference_type",
  "reference_id", "created_at",
];

// GET /export/bets.csv — signed-in user's straight bets, oldest first.
router.get("/export/bets.csv", requireProfile, async (req, res): Promise<void> => {
  const userId = req.currentUser!.id;
  const rows = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.userId, userId))
    .orderBy(asc(betsTable.createdAt), asc(betsTable.id));

  const data: CsvValue[][] = rows.map((b) => [
    b.id,
    b.sport,
    b.event,
    b.betType,
    b.pick,
    b.odds,
    Number(b.stake),
    Number(b.potentialPayout),
    b.actualPayout != null ? Number(b.actualPayout) : null,
    b.status,
    b.gameDate,
    b.sportsbook ?? null,
    b.confidenceScore,
    (b.tags ?? []).join("; "),
    b.rationale ?? null,
    b.createdAt.toISOString(),
    b.settledAt ? b.settledAt.toISOString() : null,
  ]);

  sendCsv(res, "bets", toCsv(BET_CSV_HEADER, data));
});

// GET /export/parlays.csv — one row per leg, parlay columns repeated so
// spreadsheets can pivot on parlay_id.
router.get("/export/parlays.csv", requireProfile, async (req, res): Promise<void> => {
  const userId = req.currentUser!.id;
  const parlays = await db
    .select()
    .from(parlaysTable)
    .where(eq(parlaysTable.userId, userId))
    .orderBy(asc(parlaysTable.createdAt), asc(parlaysTable.id));

  const legsByParlay = new Map<number, (typeof parlayLegsTable.$inferSelect)[]>();
  if (parlays.length > 0) {
    const legs = await db
      .select()
      .from(parlayLegsTable)
      .where(inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id)))
      .orderBy(asc(parlayLegsTable.id));
    for (const leg of legs) {
      const list = legsByParlay.get(leg.parlayId) ?? [];
      list.push(leg);
      legsByParlay.set(leg.parlayId, list);
    }
  }

  const data: CsvValue[][] = [];
  for (const p of parlays) {
    const legs = legsByParlay.get(p.id) ?? [];
    legs.forEach((leg, i) => {
      data.push([
        p.id,
        p.name,
        p.status,
        p.odds,
        Number(p.stake),
        Number(p.potentialPayout),
        p.actualPayout != null ? Number(p.actualPayout) : null,
        p.sportsbook ?? null,
        p.confidenceScore,
        p.createdAt.toISOString(),
        p.settledAt ? p.settledAt.toISOString() : null,
        i + 1,
        leg.id,
        leg.sport,
        leg.event,
        leg.betType,
        leg.pick,
        leg.odds,
        leg.gameDate,
        leg.status,
      ]);
    });
  }

  sendCsv(res, "parlays", toCsv(PARLAY_CSV_HEADER, data));
});

// GET /export/bankroll.csv — the signed-in user's full ledger, oldest first.
router.get("/export/bankroll.csv", requireProfile, async (req, res): Promise<void> => {
  const userId = req.currentUser!.id;
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId))
    .orderBy(asc(transactionsTable.createdAt), asc(transactionsTable.id));

  const data: CsvValue[][] = rows.map((t) => [
    t.id,
    t.type,
    Number(t.amount),
    Number(t.balanceAfter),
    t.note ?? null,
    t.referenceType ?? null,
    t.referenceId ?? null,
    t.createdAt.toISOString(),
  ]);

  sendCsv(res, "bankroll", toCsv(TRANSACTION_CSV_HEADER, data));
});

export default router;
