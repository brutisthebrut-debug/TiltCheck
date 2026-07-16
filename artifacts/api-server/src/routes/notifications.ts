/**
 * Notification subscription management.
 *
 * POST   /notifications/subscribe      — store (or update) a push subscription
 * DELETE /notifications/unsubscribe    — remove a push subscription
 * PATCH  /notifications/preferences   — update notification type toggles
 * GET    /notifications/vapid-public-key — return the VAPID public key for
 *                                          subscription creation on the client
 */

import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { requireProfile } from "../middlewares/auth";
import { logger } from "../lib/logger";
// Zod validators are generated from operation ids (subscribePush →
// SubscribePushBody, etc.) — verified against the generated api.ts.
import {
  SubscribePushBody,
  UnsubscribePushBody,
  UpdateNotificationPreferencesBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /notifications/vapid-public-key — VAPID public key needed by the
// browser to create a push subscription. Not sensitive — it's public.
router.get("/notifications/vapid-public-key", requireProfile, (req, res): void => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(503).json({ error: "Push notifications are not configured on this server." });
    return;
  }
  res.json({ publicKey: key });
});

// POST /notifications/subscribe — upsert a push subscription for the current
// user. Idempotent: re-subscribing the same endpoint just refreshes the keys
// and preferences.
router.post("/notifications/subscribe", requireProfile, async (req, res): Promise<void> => {
  const parsed = SubscribePushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { endpoint, p256dhKey, authKey, notifyOverdue, notifyTilt, notifyCrewActivity } =
    parsed.data;
  const userId = req.currentUser!.id;

  try {
    const existing = await db
      .select({ id: pushSubscriptionsTable.id, userId: pushSubscriptionsTable.userId })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .limit(1);

    if (existing.length > 0) {
      // Only the original owner may refresh their own subscription. If a
      // different authenticated user supplies the same endpoint we reject
      // with 409 — we never blindly reassign ownership, which would let any
      // authenticated user hijack another bettor's push subscription just by
      // knowing (or guessing) their endpoint URL.
      if (existing[0].userId !== userId) {
        res.status(409).json({
          error: "subscription_owned_by_another_user",
          message:
            "This push endpoint is already registered to a different account. " +
            "Unsubscribe in your browser settings and then re-enable notifications.",
        });
        return;
      }
      await db
        .update(pushSubscriptionsTable)
        .set({
          p256dhKey,
          authKey,
          ...(notifyOverdue !== undefined && { notifyOverdue }),
          ...(notifyTilt !== undefined && { notifyTilt }),
          ...(notifyCrewActivity !== undefined && { notifyCrewActivity }),
        })
        .where(
          and(
            eq(pushSubscriptionsTable.endpoint, endpoint),
            eq(pushSubscriptionsTable.userId, userId)
          )
        );
    } else {
      await db.insert(pushSubscriptionsTable).values({
        userId,
        endpoint,
        p256dhKey,
        authKey,
        notifyOverdue: notifyOverdue ?? true,
        notifyTilt: notifyTilt ?? true,
        notifyCrewActivity: notifyCrewActivity ?? false,
      });
    }

    const [sub] = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.endpoint, endpoint), eq(pushSubscriptionsTable.userId, userId)));
    res.json({
      notifyOverdue: sub.notifyOverdue,
      notifyTilt: sub.notifyTilt,
      notifyCrewActivity: sub.notifyCrewActivity,
    });
  } catch (err) {
    logger.error({ err, userId }, "notifications: subscribe failed");
    res.status(500).json({ error: "Failed to save subscription." });
  }
});

// DELETE /notifications/unsubscribe — remove a push subscription so the
// browser endpoint stops receiving notifications.
router.delete("/notifications/unsubscribe", requireProfile, async (req, res): Promise<void> => {
  const parsed = UnsubscribePushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { endpoint } = parsed.data;
  const userId = req.currentUser!.id;

  try {
    // Scope the delete by both endpoint AND the caller's userId so one bettor
    // cannot remove another bettor's subscription even if they know the URL.
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.endpoint, endpoint),
          eq(pushSubscriptionsTable.userId, userId)
        )
      );
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "notifications: unsubscribe failed");
    res.status(500).json({ error: "Failed to remove subscription." });
  }
});

// GET /notifications/preferences — return the caller's current preference
// state. Hydrated from their most recent push subscription row; falls back to
// app defaults when they have no subscription yet (safe to call at any time).
router.get("/notifications/preferences", requireProfile, async (req, res): Promise<void> => {
  const userId = req.currentUser!.id;
  try {
    const [sub] = await db
      .select({
        notifyOverdue: pushSubscriptionsTable.notifyOverdue,
        notifyTilt: pushSubscriptionsTable.notifyTilt,
        notifyCrewActivity: pushSubscriptionsTable.notifyCrewActivity,
      })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId))
      .orderBy(pushSubscriptionsTable.createdAt)
      .limit(1);
    res.json(
      sub ?? { notifyOverdue: true, notifyTilt: true, notifyCrewActivity: false }
    );
  } catch (err) {
    logger.error({ err, userId }, "notifications: get preferences failed");
    res.status(500).json({ error: "Failed to fetch preferences." });
  }
});

// PATCH /notifications/preferences — update the type toggles for all of this
// user's push subscriptions (applies device-wide so all their browsers match).
router.patch("/notifications/preferences", requireProfile, async (req, res): Promise<void> => {
  const parsed = UpdateNotificationPreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { notifyOverdue, notifyTilt, notifyCrewActivity } = parsed.data;
  const userId = req.currentUser!.id;

  const updates: Partial<typeof pushSubscriptionsTable.$inferInsert> = {};
  if (notifyOverdue !== undefined) updates.notifyOverdue = notifyOverdue;
  if (notifyTilt !== undefined) updates.notifyTilt = notifyTilt;
  if (notifyCrewActivity !== undefined) updates.notifyCrewActivity = notifyCrewActivity;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No preferences to update." });
    return;
  }

  try {
    await db
      .update(pushSubscriptionsTable)
      .set(updates)
      .where(eq(pushSubscriptionsTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "notifications: preferences update failed");
    res.status(500).json({ error: "Failed to update preferences." });
  }
});

export default router;
