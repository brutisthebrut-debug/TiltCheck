import { pgTable, serial, text, integer, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Crews: the social unit of TiltCheck. The leaderboard, head-to-head, and
 * weekly recap highlights only ever cover the members of the viewer's active
 * crew. Standard accounts live in exactly one crew; creating or joining more
 * requires paid multi-Crew access (enforced server-side in the crews routes).
 *
 * Demo isolation: the fictional demo board gets its own crew with
 * isDemo=true. Real joins only ever match isDemo=false crews, so the two
 * worlds can never mix through an invite code.
 */
export const crewsTable = pgTable("crews", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Deleting the owner deletes the crew (cascade keeps demo re-seeds and
  // founder-driven account wipes from tripping over FK references).
  ownerId: integer("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Shareable join code (uppercase, unambiguous alphabet). Rotatable by the
  // owner; joining is what costs a free slot, sharing the code is free.
  inviteCode: text("invite_code").notNull().unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crewMembersTable = pgTable(
  "crew_members",
  {
    id: serial("id").primaryKey(),
    crewId: integer("crew_id")
      .notNull()
      .references(() => crewsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // "owner" | "member"
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("crew_members_crew_user_unique").on(t.crewId, t.userId)],
);

export type Crew = typeof crewsTable.$inferSelect;
export type CrewMember = typeof crewMembersTable.$inferSelect;
