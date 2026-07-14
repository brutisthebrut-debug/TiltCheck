/**
 * Audit (and optionally repair) rows saved before the American-odds dead-zone
 * guard existed.
 *
 * American odds are never between -99 and +99, so any stored bet, parlay leg,
 * or parlay combined-odds value with abs(odds) < 100 is corrupt and feeds
 * nonsense numbers into potential-payout and ROI figures.
 *
 * What this script does:
 *   1. Lists every bet with dead-zone odds. These cannot be auto-repaired —
 *      the real price is unknowable — so they are flagged for re-entry by
 *      their owner.
 *   2. Lists every parlay leg with dead-zone odds (same: flagged for re-entry).
 *   3. Lists every parlay whose *stored combined odds* are in the dead zone.
 *      When all of that parlay's legs carry valid odds, the combined odds and
 *      potential payout CAN be recomputed from the legs — pass --fix to apply
 *      that repair to pending parlays. Settled parlays are never rewritten
 *      (their actual payout is already part of the bankroll ledger).
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/scripts run audit-dead-zone-odds          # report only
 *   pnpm --filter @workspace/scripts run audit-dead-zone-odds -- --fix # apply parlay repairs
 */
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  betsTable,
  parlaysTable,
  parlayLegsTable,
  usersTable,
} from "@workspace/db";

const MIN_ODDS_MAGNITUDE = 100;
const isValidAmericanOdds = (odds: number): boolean =>
  Number.isFinite(odds) && Math.abs(odds) >= MIN_ODDS_MAGNITUDE;

// Mirrors the parlay math in artifacts/api-server/src/routes/parlays.ts.
function americanToDecimal(odds: number): number {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

const applyFix = process.argv.includes("--fix");

async function main() {
  let issues = 0;

  // ---- 1. Bets with dead-zone odds --------------------------------------
  const badBets = await db
    .select({
      id: betsTable.id,
      odds: betsTable.odds,
      event: betsTable.event,
      status: betsTable.status,
      stake: betsTable.stake,
      potentialPayout: betsTable.potentialPayout,
      owner: usersTable.displayName,
    })
    .from(betsTable)
    .leftJoin(usersTable, eq(betsTable.userId, usersTable.id))
    .where(sql`abs(${betsTable.odds}) < ${MIN_ODDS_MAGNITUDE}`);

  console.log(`\n== Bets with dead-zone odds: ${badBets.length} ==`);
  for (const b of badBets) {
    issues++;
    console.log(
      `  bet #${b.id} [${b.status}] owner=${b.owner ?? "?"} odds=${b.odds} ` +
        `stake=${b.stake} potentialPayout=${b.potentialPayout} — "${b.event}"` +
        `\n    -> odds are not a real American price; owner must re-enter the correct odds ` +
        `(PATCH /api/bets/${b.id} with the true odds recalculates the payout).`
    );
  }

  // ---- 2. Parlay legs with dead-zone odds --------------------------------
  const badLegs = await db
    .select({
      id: parlayLegsTable.id,
      parlayId: parlayLegsTable.parlayId,
      odds: parlayLegsTable.odds,
      event: parlayLegsTable.event,
      parlayName: parlaysTable.name,
      parlayStatus: parlaysTable.status,
      owner: usersTable.displayName,
    })
    .from(parlayLegsTable)
    .innerJoin(parlaysTable, eq(parlayLegsTable.parlayId, parlaysTable.id))
    .leftJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(sql`abs(${parlayLegsTable.odds}) < ${MIN_ODDS_MAGNITUDE}`);

  console.log(`\n== Parlay legs with dead-zone odds: ${badLegs.length} ==`);
  for (const l of badLegs) {
    issues++;
    console.log(
      `  leg #${l.id} of parlay #${l.parlayId} "${l.parlayName}" [${l.parlayStatus}] ` +
        `owner=${l.owner ?? "?"} odds=${l.odds} — "${l.event}"` +
        `\n    -> leg odds are not a real price; the parlay's combined odds cannot be trusted ` +
        `until the owner re-enters this leg.`
    );
  }

  // ---- 3. Parlays whose stored combined odds are in the dead zone --------
  const badParlays = await db
    .select({
      id: parlaysTable.id,
      name: parlaysTable.name,
      odds: parlaysTable.odds,
      status: parlaysTable.status,
      stake: parlaysTable.stake,
      potentialPayout: parlaysTable.potentialPayout,
      owner: usersTable.displayName,
    })
    .from(parlaysTable)
    .leftJoin(usersTable, eq(parlaysTable.userId, usersTable.id))
    .where(sql`abs(${parlaysTable.odds}) < ${MIN_ODDS_MAGNITUDE}`);

  console.log(`\n== Parlays with dead-zone combined odds: ${badParlays.length} ==`);
  const legsByParlay = new Map<number, { odds: number }[]>();
  if (badParlays.length > 0) {
    const legs = await db
      .select({ parlayId: parlayLegsTable.parlayId, odds: parlayLegsTable.odds })
      .from(parlayLegsTable)
      .where(inArray(parlayLegsTable.parlayId, badParlays.map((p) => p.id)));
    for (const leg of legs) {
      const arr = legsByParlay.get(leg.parlayId) ?? [];
      arr.push({ odds: leg.odds });
      legsByParlay.set(leg.parlayId, arr);
    }
  }

  for (const p of badParlays) {
    issues++;
    const legs = legsByParlay.get(p.id) ?? [];
    const allLegsValid = legs.length > 0 && legs.every((l) => isValidAmericanOdds(l.odds));
    const header =
      `  parlay #${p.id} "${p.name}" [${p.status}] owner=${p.owner ?? "?"} ` +
      `storedOdds=${p.odds} stake=${p.stake} potentialPayout=${p.potentialPayout}`;

    if (!allLegsValid) {
      console.log(
        `${header}\n    -> cannot recompute: ${legs.length === 0 ? "parlay has no legs" : "one or more legs also carry dead-zone odds"}; flagged for owner re-entry.`
      );
      continue;
    }

    const combinedDecimal = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
    const correctOdds = decimalToAmerican(combinedDecimal);
    const correctPayout = (combinedDecimal * Number(p.stake)).toFixed(2);

    if (p.status !== "pending") {
      console.log(
        `${header}\n    -> legs are valid (correct combined odds would be ${correctOdds}, payout ${correctPayout}), ` +
          `but the parlay is already settled — leaving the record untouched to keep the bankroll ledger consistent.`
      );
      continue;
    }

    if (applyFix) {
      await db
        .update(parlaysTable)
        .set({ odds: correctOdds, potentialPayout: correctPayout })
        .where(eq(parlaysTable.id, p.id));
      console.log(
        `${header}\n    -> FIXED: combined odds ${p.odds} -> ${correctOdds}, potential payout ${p.potentialPayout} -> ${correctPayout} (recomputed from legs).`
      );
    } else {
      console.log(
        `${header}\n    -> repairable from legs: combined odds should be ${correctOdds}, potential payout ${correctPayout}. Re-run with --fix to apply.`
      );
    }
  }

  console.log(
    issues === 0
      ? "\nNo dead-zone odds found — bets, parlay legs, and parlays are all clean."
      : `\n${issues} affected row(s) found.${applyFix ? "" : " (report-only run; pass --fix to repair pending parlays with valid legs)"}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
