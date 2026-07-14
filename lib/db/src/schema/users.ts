import { pgTable, serial, text, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  clerkUserId: text("clerk_user_id").unique(),
  email: text("email"),
  displayName: text("display_name").notNull(),
  avatarColor: text("avatar_color").notNull().default("#6366f1"),
  startingBankroll: numeric("starting_bankroll", { precision: 12, scale: 2 }).notNull().default("1000"),
  // Monday (YYYY-MM-DD, UTC) of the last recap week this user opened; null = never
  recapSeenWeek: text("recap_seen_week"),
  // Founder = owner of the board: can manage beta invites and see the founder
  // dashboard. Assigned to the first account that links a profile.
  isFounder: boolean("is_founder").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
