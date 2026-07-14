import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Beta invite list, managed from the founder dashboard. When any rows exist
 * (or BETA_ALLOWED_EMAILS is set), claiming/creating a profile requires the
 * signed-in account's email to match a row (case-insensitive; emails are
 * stored lowercased). Already-linked accounts are never affected.
 */
export const invitesTable = pgTable("invites", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  invitedById: integer("invited_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invite = typeof invitesTable.$inferSelect;
