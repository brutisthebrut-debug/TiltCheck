import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  betsTable,
  parlaysTable,
  parlayLegsTable,
  usersTable,
  userBadgesTable,
} from "@workspace/db";
import { GetStreaksQueryParams } from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { userInSocialScope } from "../lib/scope";
import {
  BADGE_DEFINITIONS,
  computeQualifiedBadges,
  computeStreaks,
  type BadgeInput,
} from "../lib/badges";

const router: IRouter = Router();

/** Everything the badge engine needs about one bettor, in one place. */
export async function loadBadgeInput(userId: number): Promise<BadgeInput | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return null;

  const bets = await db.select().from(betsTable).where(eq(betsTable.userId, userId));
  const parlays = await db.select().from(parlaysTable).where(eq(parlaysTable.userId, userId));

  const legsByParlay: Record<number, { count: number; lastGameDate: string | null }> = {};
  if (parlays.length > 0) {
    const legs = await db
      .select({ parlayId: parlayLegsTable.parlayId, gameDate: parlayLegsTable.gameDate })
      .from(parlayLegsTable);
    for (const leg of legs) {
      const entry = (legsByParlay[leg.parlayId] ??= { count: 0, lastGameDate: null });
      entry.count++;
      if (entry.lastGameDate == null || leg.gameDate > entry.lastGameDate)
        entry.lastGameDate = leg.gameDate;
    }
  }

  return {
    bets,
    parlays: parlays.map((p) => ({
      ...p,
      legCount: legsByParlay[p.id]?.count ?? 0,
      lastLegGameDate: legsByParlay[p.id]?.lastGameDate ?? null,
    })),
    startingBankroll: Number(user.startingBankroll),
  };
}

// GET /users/:id/badges — the badge case. Awards newly qualified badges on
// read (idempotent; unique constraint makes double-awards impossible) and
// returns every definition with earnedAt for the earned ones.
router.get("/users/:id/badges", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  // Crew scoping (same policy as recap and the other by-userId stats
  // endpoints): another bettor's badge case is visible only when they share a
  // crew with the requester; your own always works. Demo sessions cover the
  // demo world. Outside that scope the user is reported as not found.
  if (!(await userInSocialScope(req, id))) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const input = await loadBadgeInput(id);
  if (!input) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const qualified = computeQualifiedBadges(input);
  const existing = await db.select().from(userBadgesTable).where(eq(userBadgesTable.userId, id));
  const existingIds = new Set(existing.map((b) => b.badgeId));
  const toAward = [...qualified].filter((badgeId) => !existingIds.has(badgeId));
  if (toAward.length > 0) {
    await db
      .insert(userBadgesTable)
      .values(toAward.map((badgeId) => ({ userId: id, badgeId })))
      .onConflictDoNothing();
  }

  const earned = await db.select().from(userBadgesTable).where(eq(userBadgesTable.userId, id));
  const earnedAtById = new Map(earned.map((b) => [b.badgeId, b.earnedAt]));

  res.json(
    BADGE_DEFINITIONS.map((def) => ({
      ...def,
      earnedAt: earnedAtById.get(def.id)?.toISOString() ?? null,
    })),
  );
});

// GET /stats/streaks — logging streak + settle streak for the dashboard
// strip. Defaults to the signed-in bettor; an explicit userId is allowed for
// crew visibility (same policy as badges and the other stats endpoints).
router.get("/stats/streaks", requireProfile, async (req, res): Promise<void> => {
  const query = GetStreaksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const userId = query.data.userId ?? req.currentUser!.id;
  if (query.data.userId != null && !(await userInSocialScope(req, query.data.userId))) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const input = await loadBadgeInput(userId);
  if (!input) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ userId, ...computeStreaks(input) });
});

export default router;
