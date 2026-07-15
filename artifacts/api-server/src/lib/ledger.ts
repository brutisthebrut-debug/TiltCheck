import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Stable app-wide namespace for per-user bankroll ledger locks.
const LEDGER_LOCK_NS = 7931;

/**
 * Serialize bankroll ledger appends for one user within the current
 * database transaction.
 *
 * Every path that appends a transactionsTable row derives `balanceAfter`
 * from the previous latest row. Without serialization, two concurrent
 * appends (e.g. a deposit and a bet settling at the same moment) can read
 * the same snapshot and both write balances computed from it, breaking the
 * chain invariant balanceAfter[n] = balanceAfter[n-1] + amount[n].
 *
 * The lock is transaction-scoped (pg_advisory_xact_lock), so it releases
 * automatically on commit or rollback. Call it as the FIRST statement of
 * any transaction that will append to the ledger, before reading the
 * latest balance.
 */
export async function lockUserLedger(tx: Tx, userId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_NS}, ${userId})`);
}
