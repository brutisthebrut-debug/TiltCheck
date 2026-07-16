import { pgTable, serial, text, numeric, timestamp, boolean, integer } from "drizzle-orm/pg-core";
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
  // When the leak card's one-time "trend flipped" celebration was shown for
  // this user's reported leak; null = never celebrated. Set server-side the
  // first time the leak-profile endpoint reports an improving trend, so the
  // acknowledgement never repeats on later visits.
  leakTrendCelebratedAt: timestamp("leak_trend_celebrated_at", { withTimezone: true }),
  // Founder = owner of the board: can manage beta invites and see the founder
  // dashboard. Assigned to the first account that links a profile.
  isFounder: boolean("is_founder").notNull().default(false),
  // Preferred odds display format ("american" | "decimal"). Stored on the
  // profile so the choice follows the user across devices.
  oddsFormat: text("odds_format").notNull().default("american"),
  // Saved Lessons-page filters ("all" by default) — stored on the profile so
  // the bettor's filter view follows them across devices (#167).
  lessonsResultFilter: text("lessons_result_filter").notNull().default("all"),
  lessonsQualityFilter: text("lessons_quality_filter").notNull().default("all"),
  lessonsReasonFilter: text("lessons_reason_filter").notNull().default("all"),
  // TiltCheck Pro: end of the server-verified subscription horizon. Written
  // only by the billing routes after the payment provider confirms an active
  // membership — never from client state. Acts as a bounded cache (max ~24h)
  // so gated endpoints stay DB-only and a cancelled sub expires within a day.
  proUntil: timestamp("pro_until", { withTimezone: true }),
  // Whop hosted-checkout configuration created for this bettor. Payments made
  // through it are how the server verifies the purchase after the redirect.
  whopCheckoutConfigId: text("whop_checkout_config_id"),
  // The crew whose leaderboard/head-to-head/recap this user is currently
  // viewing. Plain integer (no FK) to avoid a circular schema import; the
  // crews routes validate membership before writing it, and readers fall back
  // to the user's first membership when it's null or stale.
  activeCrewId: integer("active_crew_id"),
  // Demo crew member: fictional data shown on the public demo board only.
  // Every real-user query is scoped to isDemo=false and every demo query to
  // isDemo=true, so the two worlds never mix.
  isDemo: boolean("is_demo").notNull().default(false),
  // Peer benchmarking opt-out. When false the user's data is excluded from
  // the platform-wide percentile computation AND they can't see their own
  // benchmarks (because their sample would be biased — they see the pool
  // they opted into). Defaults true so new users are included automatically.
  includedInBenchmarks: boolean("included_in_benchmarks").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
