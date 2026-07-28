import { Router, type IRouter } from "express";
import { and, asc, eq, count, sql, inArray, isNull, desc, lte } from "drizzle-orm";
import { db, usersTable, crewsTable, crewMembersTable, crewChallengesTable } from "@workspace/db";
import { CreateCrewBody, JoinCrewBody, TransferCrewOwnershipBody, CreateCrewChallengeBody } from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { generateInviteCode, resolveActiveCrewId } from "../lib/crews";
import { logger } from "../lib/logger";
import { computeChallengeStandings, maybeCloseChallenge } from "../lib/challengeStandings";
import { dayOf } from "../lib/recap";

const router: IRouter = Router();

// Advisory-lock namespace serializing crew create/join per user (paired with
// the user id), so a double-click can't slip two memberships past the free
// cap. Distinct from the checkout (429_001) and claim lock keys.
const CREW_LOCK_NS = 429_002;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Serialize all owner-gated management (and the role checks they depend on)
// per crew: lock the crew row, THEN read roles. A racing transfer holds this
// lock until commit, so a stale ex-owner can never pass the owner check and
// still fire a privileged mutation. Returns null when the crew is gone.
async function lockCrew(tx: Tx, crewId: number): Promise<CrewRow | null> {
  const [crew] = await tx.select().from(crewsTable).where(eq(crewsTable.id, crewId)).for("update");
  return crew ?? null;
}

// The paid lever: standard accounts hold exactly one crew membership. Founders and
// the demo world ride free; a live server-verified subscription unlocks more.
// Founders and the demo bypass billing, but the FIRST membership is always free.
function mayHoldAnotherCrew(user: {
  isDemo: boolean;
  isFounder: boolean;
  proUntil: Date | null;
}): boolean {
  if (user.isDemo || user.isFounder) return true;
  return user.proUntil != null && user.proUntil.getTime() > Date.now();
}

const MULTI_CREW_CAP_MESSAGE =
  "Your first Crew is included. Add multi-Crew access to join or create another.";

type CrewRow = typeof crewsTable.$inferSelect;

function formatCrew(crew: CrewRow, role: string, memberCount: number, isActive: boolean) {
  return {
    id: crew.id,
    name: crew.name,
    role: role === "owner" ? "owner" : "member",
    inviteCode: crew.inviteCode,
    memberCount,
    isActive,
    createdAt: crew.createdAt.toISOString(),
  };
}

// GET /crews — every crew the signed-in bettor belongs to. Also served on the
// read-only demo mount, where the pov demo bettor sits in the sealed demo crew.
router.get("/crews", requireProfile, async (req, res): Promise<void> => {
  const me = req.currentUser!;
  const memberships = await db
    .select({ crew: crewsTable, role: crewMembersTable.role })
    .from(crewMembersTable)
    .innerJoin(crewsTable, eq(crewMembersTable.crewId, crewsTable.id))
    .where(eq(crewMembersTable.userId, me.id))
    .orderBy(asc(crewsTable.id));
  if (memberships.length === 0) {
    res.json([]);
    return;
  }
  const activeId = await resolveActiveCrewId(me);
  const crewIds = memberships.map((m) => m.crew.id);
  const counts = await db
    .select({ crewId: crewMembersTable.crewId, members: count() })
    .from(crewMembersTable)
    .where(inArray(crewMembersTable.crewId, crewIds))
    .groupBy(crewMembersTable.crewId);
  const countByCrew = new Map(counts.map((c) => [c.crewId, c.members]));
  res.json(
    memberships.map((m) =>
      formatCrew(m.crew, m.role, countByCrew.get(m.crew.id) ?? 1, m.crew.id === activeId),
    ),
  );
});

// POST /crews — create a crew (and switch to it). The first is included.
router.post("/crews", requireProfile, async (req, res): Promise<void> => {
  const parsed = CreateCrewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Give the crew a name" });
    return;
  }
  const me = req.currentUser!;
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CREW_LOCK_NS}, ${me.id})`);
      // Re-read under the lock so a racing create/join can't both pass the cap.
      const [fresh] = await tx.select().from(usersTable).where(eq(usersTable.id, me.id));
      if (!fresh) return { kind: "gone" as const };
      const [{ memberships }] = await tx
        .select({ memberships: count() })
        .from(crewMembersTable)
        .where(eq(crewMembersTable.userId, me.id));
      if (memberships >= 1 && !mayHoldAnotherCrew(fresh)) {
        return { kind: "capped" as const };
      }
      // Invite codes are unique; regenerate on the (astronomically rare) collision.
      let crew: CrewRow | undefined;
      for (let attempt = 0; attempt < 3 && !crew; attempt++) {
        try {
          [crew] = await tx
            .insert(crewsTable)
            .values({ name, ownerId: me.id, inviteCode: generateInviteCode() })
            .returning();
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
      if (!crew) throw new Error("Could not create crew");
      await tx.insert(crewMembersTable).values({ crewId: crew.id, userId: me.id, role: "owner" });
      await tx.update(usersTable).set({ activeCrewId: crew.id }).where(eq(usersTable.id, me.id));
      return { kind: "created" as const, crew };
    });
    if (outcome.kind === "gone") {
      res.status(403).json({ error: "No bettor profile linked to this account" });
      return;
    }
    if (outcome.kind === "capped") {
      res.status(402).json({ error: "pro_required", message: MULTI_CREW_CAP_MESSAGE });
      return;
    }
    res.status(201).json(formatCrew(outcome.crew, "owner", 1, true));
  } catch (err) {
    logger.error({ err, userId: me.id }, "crews: create failed");
    res.status(500).json({ error: "Could not create crew — try again" });
  }
});

// POST /crews/join — join by invite code (and switch to it). Real crews only:
// the demo crew's code can never link a real account into the fictional world.
router.post("/crews/join", requireProfile, async (req, res): Promise<void> => {
  const parsed = JoinCrewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const code = parsed.data.inviteCode.trim().toUpperCase();
  const me = req.currentUser!;
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CREW_LOCK_NS}, ${me.id})`);
      const [crew] = await tx
        .select()
        .from(crewsTable)
        .where(and(eq(crewsTable.inviteCode, code), eq(crewsTable.isDemo, false)))
        .limit(1);
      if (!crew) return { kind: "not_found" as const };
      const [existing] = await tx
        .select({ id: crewMembersTable.id })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crew.id), eq(crewMembersTable.userId, me.id)))
        .limit(1);
      if (existing) return { kind: "already" as const };
      const [fresh] = await tx.select().from(usersTable).where(eq(usersTable.id, me.id));
      if (!fresh) return { kind: "gone" as const };
      const [{ memberships }] = await tx
        .select({ memberships: count() })
        .from(crewMembersTable)
        .where(eq(crewMembersTable.userId, me.id));
      if (memberships >= 1 && !mayHoldAnotherCrew(fresh)) {
        return { kind: "capped" as const };
      }
      await tx.insert(crewMembersTable).values({ crewId: crew.id, userId: me.id, role: "member" });
      await tx.update(usersTable).set({ activeCrewId: crew.id }).where(eq(usersTable.id, me.id));
      const [{ members }] = await tx
        .select({ members: count() })
        .from(crewMembersTable)
        .where(eq(crewMembersTable.crewId, crew.id));
      return { kind: "joined" as const, crew, members };
    });
    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "invalid_code", message: "No crew behind that code. Check it with whoever sent it." });
      return;
    }
    if (outcome.kind === "already") {
      res.status(409).json({ error: "already_in_crew", message: "You're already running with this crew." });
      return;
    }
    if (outcome.kind === "gone") {
      res.status(403).json({ error: "No bettor profile linked to this account" });
      return;
    }
    if (outcome.kind === "capped") {
      res.status(402).json({ error: "pro_required", message: MULTI_CREW_CAP_MESSAGE });
      return;
    }
    res.json(formatCrew(outcome.crew, "member", outcome.members, true));
  } catch (err) {
    logger.error({ err, userId: me.id }, "crews: join failed");
    res.status(500).json({ error: "Could not join crew — try again" });
  }
});

// POST /crews/:id/activate — switch which crew the social views cover.
router.post("/crews/:id/activate", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: "Invalid crew id" });
    return;
  }
  const me = req.currentUser!;
  const [membership] = await db
    .select({ role: crewMembersTable.role, crew: crewsTable })
    .from(crewMembersTable)
    .innerJoin(crewsTable, eq(crewMembersTable.crewId, crewsTable.id))
    .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "You're not in this crew" });
    return;
  }
  await db.update(usersTable).set({ activeCrewId: crewId }).where(eq(usersTable.id, me.id));
  const [{ members }] = await db
    .select({ members: count() })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.crewId, crewId));
  res.json(formatCrew(membership.crew, membership.role, members, true));
});

// POST /crews/:id/invite-code — owner-only rotation: old shared codes die.
router.post("/crews/:id/invite-code", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: "Invalid crew id" });
    return;
  }
  const me = req.currentUser!;
  const [membership] = await db
    .select({ role: crewMembersTable.role })
    .from(crewMembersTable)
    .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "You're not in this crew" });
    return;
  }
  if (membership.role !== "owner") {
    res.status(403).json({ error: "owner_only", message: "Only the crew owner can rotate the code." });
    return;
  }
  const [updated] = await db
    .update(crewsTable)
    .set({ inviteCode: generateInviteCode() })
    .where(eq(crewsTable.id, crewId))
    .returning();
  const [{ members }] = await db
    .select({ members: count() })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.crewId, crewId));
  const activeId = await resolveActiveCrewId(me);
  res.json(formatCrew(updated, "owner", members, activeId === crewId));
});

// GET /crews/:id/members — the roster, visible to any member. Powers the
// management view (remove / transfer targets).
router.get("/crews/:id/members", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: "Invalid crew id" });
    return;
  }
  const me = req.currentUser!;
  const [membership] = await db
    .select({ id: crewMembersTable.id })
    .from(crewMembersTable)
    .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "You're not in this crew" });
    return;
  }
  const rows = await db
    .select({
      userId: crewMembersTable.userId,
      role: crewMembersTable.role,
      joinedAt: crewMembersTable.joinedAt,
      displayName: usersTable.displayName,
      username: usersTable.username,
    })
    .from(crewMembersTable)
    .innerJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
    .where(eq(crewMembersTable.crewId, crewId))
    .orderBy(asc(crewMembersTable.id));
  res.json(
    rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      username: r.username,
      role: r.role === "owner" ? "owner" : "member",
      joinedAt: r.joinedAt.toISOString(),
    })),
  );
});

// POST /crews/:id/leave — a member walks; their free slot opens back up. The
// owner can't leave — the crew needs an owner, so it's transfer or delete.
router.post("/crews/:id/leave", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: "Invalid crew id" });
    return;
  }
  const me = req.currentUser!;
  try {
    const outcome = await db.transaction(async (tx) => {
      // Per-user lock guards the free-slot accounting; the crew row lock makes
      // the role check atomic against a concurrent ownership transfer (a
      // member who just became owner mid-leave must not slip out ownerless).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CREW_LOCK_NS}, ${me.id})`);
      const crew = await lockCrew(tx, crewId);
      if (!crew) return { kind: "not_member" as const };
      const [membership] = await tx
        .select({ role: crewMembersTable.role })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
        .limit(1);
      if (!membership) return { kind: "not_member" as const };
      if (membership.role === "owner") return { kind: "owner" as const };
      await tx
        .delete(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)));
      // Point the active crew away from the one just left; the resolver would
      // fall back anyway, but a stale pointer is a stale pointer.
      await tx
        .update(usersTable)
        .set({ activeCrewId: null })
        .where(and(eq(usersTable.id, me.id), eq(usersTable.activeCrewId, crewId)));
      return { kind: "left" as const };
    });
    if (outcome.kind === "not_member") {
      res.status(404).json({ error: "You're not in this crew" });
      return;
    }
    if (outcome.kind === "owner") {
      res.status(409).json({
        error: "owner_cannot_leave",
        message: "The owner can't just walk. Hand off ownership first, or shut the crew down.",
      });
      return;
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err, userId: me.id, crewId }, "crews: leave failed");
    res.status(500).json({ error: "Could not leave the crew — try again" });
  }
});

// DELETE /crews/:id/members/:userId — owner-only kick. Frees the target's slot.
router.delete("/crews/:id/members/:userId", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  const targetId = parseInt(String(req.params.userId), 10);
  if (isNaN(crewId) || isNaN(targetId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const me = req.currentUser!;
  try {
    const outcome = await db.transaction(async (tx) => {
      const crew = await lockCrew(tx, crewId);
      if (!crew) return { kind: "not_member" as const };
      const [mine] = await tx
        .select({ role: crewMembersTable.role })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
        .limit(1);
      if (!mine) return { kind: "not_member" as const };
      if (mine.role !== "owner") return { kind: "not_owner" as const };
      if (targetId === me.id) return { kind: "self" as const };
      const removed = await tx
        .delete(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, targetId)))
        .returning({ id: crewMembersTable.id });
      if (removed.length === 0) return { kind: "target_missing" as const };
      await tx
        .update(usersTable)
        .set({ activeCrewId: null })
        .where(and(eq(usersTable.id, targetId), eq(usersTable.activeCrewId, crewId)));
      return { kind: "removed" as const };
    });
    if (outcome.kind === "not_member") {
      res.status(404).json({ error: "You're not in this crew" });
      return;
    }
    if (outcome.kind === "not_owner") {
      res.status(403).json({ error: "owner_only", message: "Only the crew owner can remove members." });
      return;
    }
    if (outcome.kind === "self") {
      res.status(409).json({
        error: "cannot_remove_owner",
        message: "You can't kick yourself. Hand off ownership or shut the crew down.",
      });
      return;
    }
    if (outcome.kind === "target_missing") {
      res.status(404).json({ error: "That bettor isn't in this crew" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err, userId: me.id, crewId, targetId }, "crews: remove member failed");
    res.status(500).json({ error: "Could not remove the member — try again" });
  }
});

// POST /crews/:id/transfer — hand the keys to another member; the previous
// owner stays on the board as a regular member.
router.post("/crews/:id/transfer", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: "Invalid crew id" });
    return;
  }
  const parsed = TransferCrewOwnershipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const targetId = parsed.data.userId;
  const me = req.currentUser!;
  try {
    const outcome = await db.transaction(async (tx) => {
      const crew0 = await lockCrew(tx, crewId);
      if (!crew0) return { kind: "not_member" as const };
      const [mine] = await tx
        .select({ role: crewMembersTable.role })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
        .limit(1);
      if (!mine) return { kind: "not_member" as const };
      if (mine.role !== "owner") return { kind: "not_owner" as const };
      if (targetId === me.id) return { kind: "target_missing" as const };
      const [target] = await tx
        .select({ id: crewMembersTable.id })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, targetId)))
        .limit(1);
      if (!target) return { kind: "target_missing" as const };
      const [crew] = await tx
        .update(crewsTable)
        .set({ ownerId: targetId })
        .where(eq(crewsTable.id, crewId))
        .returning();
      await tx
        .update(crewMembersTable)
        .set({ role: "owner" })
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, targetId)));
      await tx
        .update(crewMembersTable)
        .set({ role: "member" })
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)));
      const [{ members }] = await tx
        .select({ members: count() })
        .from(crewMembersTable)
        .where(eq(crewMembersTable.crewId, crewId));
      return { kind: "transferred" as const, crew, members };
    });
    if (outcome.kind === "not_member") {
      res.status(404).json({ error: "You're not in this crew" });
      return;
    }
    if (outcome.kind === "not_owner") {
      res.status(403).json({ error: "owner_only", message: "Only the crew owner can hand off ownership." });
      return;
    }
    if (outcome.kind === "target_missing") {
      res.status(404).json({ error: "That bettor isn't in this crew" });
      return;
    }
    const activeId = await resolveActiveCrewId(me);
    res.json(formatCrew(outcome.crew, "member", outcome.members, activeId === crewId));
  } catch (err) {
    logger.error({ err, userId: me.id, crewId }, "crews: transfer failed");
    res.status(500).json({ error: "Could not transfer ownership — try again" });
  }
});

// DELETE /crews/:id — owner-only shutdown. Memberships cascade with the crew
// row; former members' active pointers are cleared so the resolver falls back
// to whatever crew they still have (or crewless).
router.delete("/crews/:id", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: "Invalid crew id" });
    return;
  }
  const me = req.currentUser!;
  try {
    const outcome = await db.transaction(async (tx) => {
      const crew = await lockCrew(tx, crewId);
      if (!crew) return { kind: "not_member" as const };
      const [mine] = await tx
        .select({ role: crewMembersTable.role })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
        .limit(1);
      if (!mine) return { kind: "not_member" as const };
      if (mine.role !== "owner") return { kind: "not_owner" as const };
      await tx.update(usersTable).set({ activeCrewId: null }).where(eq(usersTable.activeCrewId, crewId));
      await tx.delete(crewsTable).where(eq(crewsTable.id, crewId));
      return { kind: "deleted" as const };
    });
    if (outcome.kind === "not_member") {
      res.status(404).json({ error: "You're not in this crew" });
      return;
    }
    if (outcome.kind === "not_owner") {
      res.status(403).json({ error: "owner_only", message: "Only the crew owner can shut it down." });
      return;
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err, userId: me.id, crewId }, "crews: delete failed");
    res.status(500).json({ error: "Could not delete the crew — try again" });
  }
});

// ── Crew challenges ────────────────────────────────────────────────────────

const CHALLENGE_METRICS = ["roi", "win_rate", "calibration", "postmortem_rate"] as const;
const DEFAULT_LABELS: Record<string, string> = {
  roi: "Best ROI",
  win_rate: "Hot Streak",
  calibration: "Sharpest Read",
  postmortem_rate: "Discipline Run",
};

/** Membership guard: returns the member row or null. */
async function getCrewMembership(crewId: number, userId: number) {
  const [m] = await db
    .select({ role: crewMembersTable.role })
    .from(crewMembersTable)
    .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, userId)))
    .limit(1);
  return m ?? null;
}

/** All user IDs currently in a crew. */
async function getCrewMemberIds(crewId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: crewMembersTable.userId })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.crewId, crewId));
  return rows.map((r) => r.userId);
}

function formatChallenge(
  c: typeof crewChallengesTable.$inferSelect,
  winnerName: string | null,
  today: string,
) {
  return {
    id: c.id,
    crewId: c.crewId,
    metric: c.metric,
    label: c.label,
    startDate: c.startDate,
    endDate: c.endDate,
    createdBy: c.createdBy,
    winnerId: c.winnerId,
    winnerValue: c.winnerValue,
    closedAt: c.closedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    winnerName,
    isActive: c.closedAt == null && c.endDate >= today,
  };
}

// POST /crews/:id/challenges — owner creates a 7-day challenge
router.post("/crews/:id/challenges", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) { res.status(400).json({ error: "Invalid crew id" }); return; }

  const parsed = CreateCrewChallengeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { metric, label } = parsed.data;
  if (!CHALLENGE_METRICS.includes(metric as typeof CHALLENGE_METRICS[number])) {
    res.status(400).json({ error: "Invalid metric" }); return;
  }

  const me = req.currentUser!;
  const today = dayOf(new Date());

  // ── Authorization first — no mutations until the caller is verified ────────
  const earlyMembership = await getCrewMembership(crewId, me.id);
  if (!earlyMembership) { res.status(404).json({ error: "You're not in this crew" }); return; }
  if (earlyMembership.role !== "owner") {
    res.status(403).json({ error: "owner_only", message: "Only the crew owner can start a challenge." });
    return;
  }

  const endDate = (() => {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 6); // 7-day window (today is day 1)
    return dayOf(d);
  })();

  // ── Pre-transaction: finalize expired challenges with winner metadata ───────
  // Must happen outside the transaction because maybeCloseChallenge issues its
  // own DB queries (standings computation) that can't share a tx handle.
  // Runs only after authorization is confirmed — no mutations before auth.
  {
    const expired = await db
      .select()
      .from(crewChallengesTable)
      .where(
        and(
          eq(crewChallengesTable.crewId, crewId),
          isNull(crewChallengesTable.closedAt),
          sql`${crewChallengesTable.endDate} < ${today}`,
        ),
      );
    if (expired.length > 0) {
      const memberIds = await getCrewMemberIds(crewId);
      for (const c of expired) {
        await maybeCloseChallenge(c, memberIds);
      }
    }
  }

  type CreateOutcome =
    | { kind: "not_member" }
    | { kind: "not_owner" }
    | { kind: "challenge_active" }
    | { kind: "created"; challenge: typeof crewChallengesTable.$inferSelect };

  let outcome: CreateOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<CreateOutcome> => {
      // Lock the crew row — serializes all owner-gated mutations for this crew
      // so that two concurrent POST /challenges requests can't both slip past
      // the active-challenge guard.
      const crew = await lockCrew(tx, crewId);
      if (!crew) return { kind: "not_member" };

      // Re-verify membership and role inside the lock (ownership may have
      // transferred between the early check and the transaction).
      const [mine] = await tx
        .select({ role: crewMembersTable.role })
        .from(crewMembersTable)
        .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, me.id)))
        .limit(1);
      if (!mine) return { kind: "not_member" };
      if (mine.role !== "owner") return { kind: "not_owner" };

      // Now check for a genuinely active challenge (endDate >= today, not closed).
      // Expired rows were finalized before the transaction started.
      const [open] = await tx
        .select({ id: crewChallengesTable.id })
        .from(crewChallengesTable)
        .where(
          and(
            eq(crewChallengesTable.crewId, crewId),
            isNull(crewChallengesTable.closedAt),
            sql`${crewChallengesTable.endDate} >= ${today}`,
          ),
        )
        .limit(1);
      if (open) return { kind: "challenge_active" };

      const [challenge] = await tx
        .insert(crewChallengesTable)
        .values({
          crewId,
          metric,
          label: label.trim() || DEFAULT_LABELS[metric] || metric,
          startDate: today,
          endDate,
          createdBy: me.id,
        })
        .returning();

      return { kind: "created", challenge };
    });
  } catch (err: unknown) {
    // The partial unique index (crew_challenges_one_active_per_crew) is the
    // final DB-level guard. If two concurrent transactions both pass the
    // application check and one wins the race, the loser gets a 23505
    // unique-violation — map it to 409 instead of 500.
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "challenge_active", message: "A challenge is already running. Cancel it or wait for it to close." });
      return;
    }
    throw err;
  }

  if (outcome.kind === "not_member") { res.status(404).json({ error: "You're not in this crew" }); return; }
  if (outcome.kind === "not_owner") {
    res.status(403).json({ error: "owner_only", message: "Only the crew owner can start a challenge." });
    return;
  }
  if (outcome.kind === "challenge_active") {
    res.status(409).json({ error: "challenge_active", message: "A challenge is already running. Cancel it or wait for it to close." });
    return;
  }

  res.status(201).json(formatChallenge(outcome.challenge, null, today));
});

// GET /crews/:id/challenges — active challenge first, then up to 8 completed
router.get("/crews/:id/challenges", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) { res.status(400).json({ error: "Invalid crew id" }); return; }

  const me = req.currentUser!;
  const membership = await getCrewMembership(crewId, me.id);
  if (!membership) { res.status(404).json({ error: "You're not in this crew" }); return; }

  const today = dayOf(new Date());
  const memberIds = await getCrewMemberIds(crewId);

  // Load last 9 challenges (8 completed + possibly 1 active)
  const challenges = await db
    .select()
    .from(crewChallengesTable)
    .where(eq(crewChallengesTable.crewId, crewId))
    .orderBy(desc(crewChallengesTable.createdAt))
    .limit(9);

  // Auto-close any that have passed their end date
  for (const c of challenges) {
    if (c.closedAt == null && c.endDate < today) {
      await maybeCloseChallenge(c, memberIds);
      // Refresh from DB — patch the local object
      const [fresh] = await db.select().from(crewChallengesTable).where(eq(crewChallengesTable.id, c.id));
      if (fresh) Object.assign(c, fresh);
    }
  }

  // Resolve winner names
  const winnerIds = challenges.map((c) => c.winnerId).filter((id): id is number => id != null);
  const winners =
    winnerIds.length > 0
      ? await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(inArray(usersTable.id, winnerIds))
      : [];
  const winnerNameById = new Map(winners.map((w) => [w.id, w.displayName]));

  // Sort: active first, then newest
  challenges.sort((a, b) => {
    const aActive = a.closedAt == null && a.endDate >= today;
    const bActive = b.closedAt == null && b.endDate >= today;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const closed = challenges.filter((c) => c.closedAt != null);
  const active = challenges.filter((c) => c.closedAt == null && c.endDate >= today);
  const result = [...active, ...closed.slice(0, 8)];

  res.json(result.map((c) => formatChallenge(c, c.winnerId ? (winnerNameById.get(c.winnerId) ?? null) : null, today)));
});

// GET /crews/:id/challenges/active/standings — live standings + auto-close
router.get("/crews/:id/challenges/active/standings", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  if (isNaN(crewId)) { res.status(400).json({ error: "Invalid crew id" }); return; }

  const me = req.currentUser!;
  const membership = await getCrewMembership(crewId, me.id);
  if (!membership) { res.status(404).json({ error: "You're not in this crew" }); return; }

  const today = dayOf(new Date());

  // Find active challenge
  const challengeRows = await db
    .select()
    .from(crewChallengesTable)
    .where(and(eq(crewChallengesTable.crewId, crewId), isNull(crewChallengesTable.closedAt)))
    .orderBy(desc(crewChallengesTable.createdAt))
    .limit(1);

  const challenge = challengeRows[0];
  if (!challenge) { res.status(404).json({ error: "No active challenge for this crew" }); return; }

  const memberIds = await getCrewMemberIds(crewId);

  // Auto-close if endDate has passed
  await maybeCloseChallenge(challenge, memberIds);

  // Reload (may have just been closed)
  const [fresh] = await db.select().from(crewChallengesTable).where(eq(crewChallengesTable.id, challenge.id));
  const current = fresh ?? challenge;

  const standings = await computeChallengeStandings(current, memberIds);

  // Resolve winner name if closed
  let winnerName: string | null = null;
  if (current.winnerId) {
    const [w] = await db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, current.winnerId));
    winnerName = w?.displayName ?? null;
  }

  // Days remaining: -1 if closed, 0 if last day, N otherwise
  const endEpoch = new Date(`${current.endDate}T00:00:00.000Z`).getTime();
  const nowEpoch = Date.now();
  const msLeft = endEpoch - nowEpoch;
  const daysRemaining = current.closedAt != null ? -1 : Math.max(-1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  res.json({
    challenge: formatChallenge(current, winnerName, today),
    standings,
    daysRemaining,
  });
});

// DELETE /crews/:id/challenges/:challengeId — owner cancels active challenge
router.delete("/crews/:id/challenges/:challengeId", requireProfile, async (req, res): Promise<void> => {
  const crewId = parseInt(String(req.params.id), 10);
  const challengeId = parseInt(String(req.params.challengeId), 10);
  if (isNaN(crewId) || isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const me = req.currentUser!;
  const membership = await getCrewMembership(crewId, me.id);
  if (!membership) { res.status(404).json({ error: "You're not in this crew" }); return; }
  if (membership.role !== "owner") {
    res.status(403).json({ error: "owner_only", message: "Only the crew owner can cancel a challenge." });
    return;
  }

  const [challenge] = await db
    .select()
    .from(crewChallengesTable)
    .where(and(eq(crewChallengesTable.id, challengeId), eq(crewChallengesTable.crewId, crewId)))
    .limit(1);

  if (!challenge) { res.status(404).json({ error: "Challenge not found" }); return; }
  if (challenge.closedAt != null) {
    res.status(409).json({ error: "challenge_closed", message: "This challenge already closed — it can't be cancelled." });
    return;
  }

  const today = dayOf(new Date());
  if (challenge.endDate < today) {
    // The challenge window passed without being explicitly cancelled — auto-
    // finalize it so winner data is preserved, then report it as already closed.
    const memberIds = await getCrewMemberIds(crewId);
    await maybeCloseChallenge(challenge, memberIds);
    res.status(409).json({ error: "challenge_closed", message: "The challenge window already ended — the results have been saved." });
    return;
  }

  await db.delete(crewChallengesTable).where(eq(crewChallengesTable.id, challengeId));
  res.status(204).end();
});

export default router;
