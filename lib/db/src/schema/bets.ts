import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  sport: text("sport").notNull(),
  event: text("event").notNull(),
  betType: text("bet_type").notNull(), // moneyline, spread, total, prop, futures
  pick: text("pick").notNull(),
  odds: integer("odds").notNull(), // American odds
  stake: numeric("stake", { precision: 12, scale: 2 }).notNull(),
  potentialPayout: numeric("potential_payout", { precision: 12, scale: 2 }).notNull(),
  actualPayout: numeric("actual_payout", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("pending"), // pending, won, lost, push, void
  gameDate: date("game_date", { mode: "string" }).notNull(),
  confidenceScore: integer("confidence_score").notNull(),
  rationale: text("rationale"),
  postGameReview: text("post_game_review"),
  // Sportsbook & promo tracking
  sportsbook: text("sportsbook"),
  promoNote: text("promo_note"),
  // Post-result review (structured)
  reasoningQuality: text("reasoning_quality"), // 'sound' | 'flawed'
  whatHappened: text("what_happened"),
  missReason: text("miss_reason"), // bad_read | bad_price | lineup_injury | emotional | misunderstood_market | normal_variance | na
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const insertBetSchema = createInsertSchema(betsTable).omit({ id: true, createdAt: true });
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;
