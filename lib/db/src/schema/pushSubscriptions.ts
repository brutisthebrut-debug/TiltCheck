import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Web push subscriptions: one row per browser/device that has opted in to
 * TiltCheck push notifications. Each subscription has independent toggles for
 * the three notification types so bettors can tune what they hear about.
 *
 * lastOverdueNotifiedAt / lastTiltNotifiedAt track when we last fired each
 * type so the worker never spams the same user twice in a short window.
 */
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // The push endpoint URL (unique per subscription, browser-issued)
  endpoint: text("endpoint").notNull().unique(),
  // P-256 DH public key (base64url, from PushSubscription.getKey("p256dh"))
  p256dhKey: text("p256dh_key").notNull(),
  // HMAC authentication secret (base64url, from PushSubscription.getKey("auth"))
  authKey: text("auth_key").notNull(),
  // Per-type opt-in toggles
  notifyOverdue: boolean("notify_overdue").notNull().default(true),
  notifyTilt: boolean("notify_tilt").notNull().default(true),
  notifyCrewActivity: boolean("notify_crew_activity").notNull().default(false),
  // Rate-limiting: track when we last sent each type so we don't spam
  lastOverdueNotifiedAt: timestamp("last_overdue_notified_at", { withTimezone: true }),
  lastTiltNotifiedAt: timestamp("last_tilt_notified_at", { withTimezone: true }),
  lastCrewNotifiedAt: timestamp("last_crew_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
