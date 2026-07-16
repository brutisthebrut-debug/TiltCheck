import { pgTable, serial, text, integer, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crewsTable } from "./crews";
import { usersTable } from "./users";

/**
 * Crew challenges: weekly competitions where crew members compete on a single
 * metric (ROI, win rate, calibration, post-mortem rate) over a fixed date
 * window. One active challenge per crew at a time; owners create and cancel.
 *
 * Standings are computed on-demand from settled bets/parlays within the window.
 * When the endDate passes, the standings endpoint auto-closes the challenge:
 * it records the winner and seals the result. History holds the last 8 weeks.
 *
 * DB invariant: the partial unique index crew_challenges_one_active_per_crew
 * guarantees at most one row with closedAt IS NULL per crew, regardless of
 * application-level races.
 */
export const crewChallengesTable = pgTable(
  "crew_challenges",
  {
    id: serial("id").primaryKey(),
    crewId: integer("crew_id")
      .notNull()
      .references(() => crewsTable.id, { onDelete: "cascade" }),
    /** Metric this challenge measures. */
    metric: text("metric").notNull(), // "roi" | "win_rate" | "calibration" | "postmortem_rate"
    /** Human label shown in banners and history (e.g. "Sharp Week"). */
    label: text("label").notNull(),
    /** Inclusive start date of the challenge window (YYYY-MM-DD, UTC). */
    startDate: text("start_date").notNull(),
    /** Inclusive end date of the challenge window (YYYY-MM-DD, UTC). */
    endDate: text("end_date").notNull(),
    /** Member who created the challenge (must be crew owner). */
    createdBy: integer("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Populated when the challenge closes — the member who won. */
    winnerId: integer("winner_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** The winner's metric value at close time. */
    winnerValue: real("winner_value"),
    /** When the challenge was sealed (null = still active or cancelled). */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Partial unique index: at most one open challenge per crew.
     * The application can't bypass this with concurrent requests — the DB
     * rejects the second INSERT with a unique violation (23505), which the
     * create route maps to a 409 challenge_active error.
     */
    uniqueIndex("crew_challenges_one_active_per_crew")
      .on(t.crewId)
      .where(sql`${t.closedAt} IS NULL`),
  ],
);

export type CrewChallenge = typeof crewChallengesTable.$inferSelect;
