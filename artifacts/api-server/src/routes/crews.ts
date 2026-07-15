import { Router, type IRouter } from "express";
import { and, asc, eq, count, sql, inArray } from "drizzle-orm";
import { db, usersTable, crewsTable, crewMembersTable } from "@workspace/db";
import { CreateCrewBody, JoinCrewBody } from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { generateInviteCode, resolveActiveCrewId } from "../lib/crews";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Advisory-lock namespace serializing crew create/join per user (paired with
// the user id), so a double-click can't slip two memberships past the free
// cap. Distinct from the checkout (429_001) and claim lock keys.
const CREW_LOCK_NS = 429_002;

// The Pro lever: free accounts hold exactly one crew membership. Founders and
// the demo world ride free; a live server-verified subscription unlocks more.
// Mirrors requirePro's bypass rules — but the FIRST membership is always free.
function mayHoldAnotherCrew(user: {
  isDemo: boolean;
  isFounder: boolean;
  proUntil: Date | null;
}): boolean {
  if (user.isDemo || user.isFounder) return true;
  return user.proUntil != null && user.proUntil.getTime() > Date.now();
}

const PRO_CAP_MESSAGE =
  "One crew's free. Running multiple books at once is a Pro move — literally.";

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

// POST /crews — create a crew (and switch to it). First crew free, more is Pro.
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
      res.status(402).json({ error: "pro_required", message: PRO_CAP_MESSAGE });
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
      res.status(402).json({ error: "pro_required", message: PRO_CAP_MESSAGE });
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

export default router;
