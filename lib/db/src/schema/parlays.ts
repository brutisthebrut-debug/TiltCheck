import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const parlaysTable = pgTable("parlays", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  stake: numeric("stake", { precision: 12, scale: 2 }).notNull(),
  odds: integer("odds").notNull(), // Combined American odds
  potentialPayout: numeric("potential_payout", { precision: 12, scale: 2 }).notNull(),
  actualPayout: numeric("actual_payout", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("pending"),
  confidenceScore: integer("confidence_score").notNull(),
  rationale: text("rationale"),
  postGameReview: text("post_game_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const parlayLegsTable = pgTable("parlay_legs", {
  id: serial("id").primaryKey(),
  parlayId: integer("parlay_id").notNull().references(() => parlaysTable.id, { onDelete: "cascade" }),
  sport: text("sport").notNull(),
  event: text("event").notNull(),
  betType: text("bet_type").notNull(),
  pick: text("pick").notNull(),
  odds: integer("odds").notNull(),
  gameDate: date("game_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("pending"),
});

export const insertParlaySchema = createInsertSchema(parlaysTable).omit({ id: true, createdAt: true });
export const insertParlayLegSchema = createInsertSchema(parlayLegsTable).omit({ id: true });
export type InsertParlay = z.infer<typeof insertParlaySchema>;
export type InsertParlayLeg = z.infer<typeof insertParlayLegSchema>;
export type Parlay = typeof parlaysTable.$inferSelect;
export type ParlayLeg = typeof parlayLegsTable.$inferSelect;
