import { pgTable, serial, integer, text, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * AI-narrated weekly recap reviews — generated once per user per week and
 * served from here on every later view. Cascade-deletes with the user so
 * test cleanup and demo reseeds never orphan rows.
 */
export const recapNarrativesTable = pgTable(
  "recap_narratives",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Monday (UTC) of the completed week this narrative reviews. */
    weekStart: date("week_start").notNull(),
    narrative: text("narrative").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recap_narratives_user_week_idx").on(t.userId, t.weekStart)],
);

export type RecapNarrative = typeof recapNarrativesTable.$inferSelect;
