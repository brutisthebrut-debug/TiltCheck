import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Earned badges. A row exists only once a badge is earned; badges are never
 * revoked (the fun is in keeping them). Which badges exist and what they mean
 * lives server-side in the badge engine, not in the database.
 */
export const userBadgesTable = pgTable(
  "user_badges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    badgeId: text("badge_id").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_badges_user_badge_unique").on(t.userId, t.badgeId)],
);

export type UserBadge = typeof userBadgesTable.$inferSelect;
