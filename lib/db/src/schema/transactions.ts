import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  type: text("type").notNull(), // deposit, withdraw, bet_win, bet_loss, bet_push, adjustment
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  // Running-balance convention: the transactions ledger is APPEND-ONLY.
  // `balanceAfter` is a point-in-time snapshot of the bankroll immediately
  // after this row was recorded, and it is never rewritten afterwards — not
  // even when a bet/parlay referenced by an earlier row is later deleted.
  // Deletions append a compensating "adjustment" row instead, so the chain
  // invariant always holds for rows ordered by (createdAt, id):
  //   balanceAfter[n] = balanceAfter[n-1] + amount[n]
  //   (with balanceAfter[0] = user.startingBankroll + amount[0])
  // Consequently, summing `amount` over history and reading the latest
  // `balanceAfter` always agree, and any balance-over-time display can use
  // `balanceAfter` row by row without recomputation.
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"), // bet, parlay
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
