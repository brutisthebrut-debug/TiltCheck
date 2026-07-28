/**
 * Crew helpers: invite codes, active-crew resolution, and boot-time
 * bootstrapping that migrates pre-crews worlds into their first crew.
 *
 * Cap policy lives in routes/crews.ts: free accounts hold exactly one crew
 * membership; creating/joining beyond that requires paid multi-Crew access.
 */
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, crewsTable, crewMembersTable } from "@workspace/db";
import { logger } from "./logger";

// Unambiguous alphabet (no 0/O/1/I/L) — codes get read out loud in group chats.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

type Dbish = Pick<typeof db, "select">;

/**
 * The crew whose social views (leaderboard, head-to-head, recap highlights)
 * this user currently sees: their stored activeCrewId when it's still a live
 * membership, otherwise their oldest membership, otherwise null (crewless).
 */
export async function resolveActiveCrewId(
  user: { id: number; activeCrewId: number | null },
  dbx: Dbish = db,
): Promise<number | null> {
  if (user.activeCrewId != null) {
    const [member] = await dbx
      .select({ id: crewMembersTable.id })
      .from(crewMembersTable)
      .where(and(eq(crewMembersTable.crewId, user.activeCrewId), eq(crewMembersTable.userId, user.id)))
      .limit(1);
    if (member) return user.activeCrewId;
  }
  const [first] = await dbx
    .select({ crewId: crewMembersTable.crewId })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.userId, user.id))
    .orderBy(asc(crewMembersTable.crewId))
    .limit(1);
  return first?.crewId ?? null;
}

export async function crewMemberCount(crewId: number, dbx: Dbish = db): Promise<number> {
  const [{ members }] = await dbx
    .select({ members: count() })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.crewId, crewId));
  return members;
}

/**
 * Boot-time bootstrap, idempotent and safe to run every start:
 *
 * - Real world: when no real crew exists yet but real users do, create one
 *   default crew, put every current real user in it, and point their active
 *   crew at it — the pre-crews experience carries over unchanged. Runs once
 *   in effect (a real crew existing afterwards short-circuits it), so later
 *   sign-ups start crewless and spend their free slot where they choose.
 * - Demo world: when the demo bettors exist but their crew doesn't, create
 *   it. The demo crew is isDemo=true and can never be joined by real users.
 */
// Advisory-lock key serializing the bootstrap across processes: two servers
// booting at once (deploy overlap, dev + test run) must not both create the
// default crew and double-enroll everyone. Distinct from checkout (429_001)
// and the per-user crew-cap lock (429_002).
const BOOTSTRAP_LOCK_KEY = 429_003;

export async function ensureCrewsBootstrapped(): Promise<void> {
  await db.transaction(async (tx) => {
    // Held until commit; the second booter waits, then sees the crews the
    // first one created and short-circuits.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);
    // ── Real world ──
    const [realCrew] = await tx
      .select({ id: crewsTable.id })
      .from(crewsTable)
      .where(eq(crewsTable.isDemo, false))
      .limit(1);
    if (!realCrew) {
      const realUsers = await tx
        .select({ id: usersTable.id, isFounder: usersTable.isFounder })
        .from(usersTable)
        .where(eq(usersTable.isDemo, false))
        .orderBy(asc(usersTable.id));
      if (realUsers.length > 0) {
        const owner = realUsers.find((u) => u.isFounder) ?? realUsers[0];
        const [crew] = await tx
          .insert(crewsTable)
          .values({ name: "The Day Ones", ownerId: owner.id, inviteCode: generateInviteCode() })
          .returning();
        await tx.insert(crewMembersTable).values(
          realUsers.map((u) => ({
            crewId: crew.id,
            userId: u.id,
            role: u.id === owner.id ? "owner" : "member",
          })),
        );
        await tx
          .update(usersTable)
          .set({ activeCrewId: crew.id })
          .where(inArray(usersTable.id, realUsers.map((u) => u.id)));
        logger.info({ crewId: crew.id, members: realUsers.length }, "Crews: migrated real users into default crew");
      }
    }

    // ── Demo world ──
    const [demoCrew] = await tx
      .select({ id: crewsTable.id })
      .from(crewsTable)
      .where(eq(crewsTable.isDemo, true))
      .limit(1);
    if (!demoCrew) {
      const demoUsers = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.isDemo, true))
        .orderBy(asc(usersTable.id));
      if (demoUsers.length > 0) {
        const [crew] = await tx
          .insert(crewsTable)
          .values({
            name: "The Fictional Five",
            ownerId: demoUsers[0].id,
            inviteCode: generateInviteCode(),
            isDemo: true,
          })
          .returning();
        await tx.insert(crewMembersTable).values(
          demoUsers.map((u, i) => ({
            crewId: crew.id,
            userId: u.id,
            role: i === 0 ? "owner" : "member",
          })),
        );
        logger.info({ crewId: crew.id }, "Crews: demo crew created");
      }
    }
  });
}
