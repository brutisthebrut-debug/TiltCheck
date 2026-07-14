import { Router, type IRouter } from "express";
import { and, eq, isNull, isNotNull, asc, count, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import {
  ClaimProfileBody,
  ClaimProfileResponse,
  GetCurrentUserResponse,
  ListUnclaimedUsersResponse,
  ListUsersResponse,
  UpdateUserBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const AVATAR_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4"];

// Seats = accounts linked to a sign-in. Unlimited by default — anyone with the
// link can join the crew. The owner can still set a ceiling via the
// BETA_SEAT_LIMIT env var (any positive number); 0/unset means no cap.
// Read at request time so config changes apply without a rebuild.
type Dbish = Pick<typeof db, "select">;
async function betaIsFull(dbx: Dbish = db): Promise<boolean> {
  const limit = Number(process.env.BETA_SEAT_LIMIT ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const [{ linked }] = await dbx
    .select({ linked: count() })
    .from(usersTable)
    .where(isNotNull(usersTable.clerkUserId));
  return linked >= limit;
}

// Optional email allowlist for the private beta. When BETA_ALLOWED_EMAILS is
// set (comma-separated, case-insensitive), only those addresses may claim or
// create a profile; everyone else gets a clear "not invited" rejection.
// Accounts that are already linked are never affected. Read at request time so
// config changes apply without a rebuild. Unset/empty means no restriction.
function allowedEmailSet(): Set<string> | null {
  const raw = process.env.BETA_ALLOWED_EMAILS;
  if (!raw?.trim()) return null;
  const set = new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.size > 0 ? set : null;
}

// Advisory-lock key that serializes claim requests, so the seat-cap check and
// the claim/create write are atomic (concurrent claims can't overshoot the cap).
const CLAIM_LOCK_KEY = 0x5ea75;

// GET /users/me — the signed-in user's linked bettor profile
router.get("/users/me", async (req, res): Promise<void> => {
  if (!req.currentUser) {
    res.status(404).json({ error: "No bettor profile linked to this account" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(formatUser(req.currentUser)));
});

// GET /users/unclaimed — profiles not yet linked to a sign-in account
router.get("/users/unclaimed", async (_req, res): Promise<void> => {
  const users = await db
    .select()
    .from(usersTable)
    .where(isNull(usersTable.clerkUserId))
    .orderBy(asc(usersTable.id));
  res.json(ListUnclaimedUsersResponse.parse(users.map(formatUser)));
});

// POST /users/claim — claim an existing unclaimed profile or create a fresh one
router.post("/users/claim", async (req, res): Promise<void> => {
  const clerkUserId = req.clerkUserId!;
  if (req.currentUser) {
    res.status(409).json({ error: "This account is already linked to a bettor profile" });
    return;
  }
  const parsed = ClaimProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, displayName } = parsed.data;

  // Look up the Clerk account for email / name defaults
  let email: string | null = null;
  let fallbackName: string | null = null;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    email = clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? null;
    const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
    fallbackName = fullName || null;
  } catch {
    // Clerk lookup is best-effort; claiming still works without it
  }

  type ClaimOutcome = { status: number; body: unknown };
  let outcome: ClaimOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<ClaimOutcome> => {
      // Serialize seat-cap check + write: concurrent claims queue up here, so
      // the count can never be observed stale and the cap can't be overshot.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CLAIM_LOCK_KEY})`);

      // Double-submit: if this account got linked while waiting on the lock,
      // return the existing profile instead of failing.
      const [alreadyLinked] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);
      if (alreadyLinked) {
        return { status: 200, body: ClaimProfileResponse.parse(formatUser(alreadyLinked)) };
      }

      // Email allowlist runs before the seat-cap check: an uninvited account
      // should hear "not invited", not "beta full". No email on the Clerk
      // account counts as not invited when an allowlist is configured.
      const allowlist = allowedEmailSet();
      if (allowlist && (!email || !allowlist.has(email.toLowerCase()))) {
        return { status: 403, body: { error: "not_invited" } };
      }

      if (await betaIsFull(tx)) {
        return { status: 403, body: { error: "beta_full" } };
      }

      if (userId != null) {
        // Claim an existing profile — the isNull guard means two accounts can
        // never claim the same profile
        const [claimed] = await tx
          .update(usersTable)
          .set({ clerkUserId, email })
          .where(and(eq(usersTable.id, userId), isNull(usersTable.clerkUserId)))
          .returning();
        if (!claimed) {
          const [existing] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
          if (!existing) {
            return { status: 404, body: { error: "Profile not found" } };
          }
          return { status: 409, body: { error: "Profile already claimed by another account" } };
        }
        return { status: 200, body: ClaimProfileResponse.parse(formatUser(claimed)) };
      }

      // Start fresh — derive a unique username from email (or account id)
      const name = displayName?.trim() || fallbackName || email?.split("@")[0] || "Bettor";
      const base = (email?.split("@")[0] ?? name)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 24) || "bettor";
      let username = base;
      for (let attempt = 0; ; attempt++) {
        const existing = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
        if (existing.length === 0) break;
        username = `${base}${attempt + 2}`;
      }
      const usedColors = (await tx.select({ c: usersTable.avatarColor }).from(usersTable)).map((r) => r.c);
      const avatarColor = AVATAR_COLORS.find((c) => !usedColors.includes(c)) ?? AVATAR_COLORS[0];

      const [created] = await tx
        .insert(usersTable)
        .values({
          username,
          displayName: name,
          avatarColor,
          startingBankroll: "1000",
          clerkUserId,
          email,
        })
        .returning();
      return { status: 200, body: ClaimProfileResponse.parse(formatUser(created)) };
    });
  } catch {
    // Unexpected write failure (e.g. unique-constraint collision). If this
    // account did end up linked, return that profile; otherwise ask to retry.
    const [linked] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    outcome = linked
      ? { status: 200, body: ClaimProfileResponse.parse(formatUser(linked)) }
      : { status: 409, body: { error: "Could not create profile — try again" } };
  }
  res.status(outcome.status).json(outcome.body);
});

// GET /users
router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  res.json(ListUsersResponse.parse(users.map(formatUser)));
});

// PATCH /users/:id — update own profile only
router.patch("/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (!req.currentUser || req.currentUser.id !== id) {
    res.status(403).json({ error: "You can only update your own profile" });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { startingBankroll, displayName, avatarColor } = parsed.data;
  const updateValues: Record<string, unknown> = {};
  if (startingBankroll !== undefined) updateValues.startingBankroll = String(startingBankroll);
  if (displayName !== undefined) updateValues.displayName = displayName;
  if (avatarColor !== undefined) updateValues.avatarColor = avatarColor;

  if (Object.keys(updateValues).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updateValues)
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated));
});

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    startingBankroll: Number(u.startingBankroll),
    createdAt: u.createdAt.toISOString(),
  };
}

export default router;
