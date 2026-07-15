import { Router, type IRouter } from "express";
import { and, eq, isNull, isNotNull, asc, count, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, usersTable, invitesTable } from "@workspace/db";
import { dayOf, lastCompletedWeekStart } from "../lib/recap";
import { userScopeCondition } from "../lib/scope";
import { founderEmail } from "../lib/founder";
import {
  MarkLeakCelebrationSeenResponse,
  MarkRecapSeenResponse,
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


// The beta gate combines two invite sources: the founder-managed invites table
// and the optional BETA_ALLOWED_EMAILS env var. The gate is open (no
// restriction) only when both are empty. Emails in the invites table are
// stored lowercased.
type InviteGate = "open" | "allowed" | "blocked";
async function inviteGate(dbx: Dbish, email: string | null): Promise<InviteGate> {
  const envSet = allowedEmailSet();
  const [{ invites }] = await dbx.select({ invites: count() }).from(invitesTable);
  if (!envSet && invites === 0) return "open";
  if (!email) return "blocked";
  const lower = email.trim().toLowerCase();
  if (envSet?.has(lower)) return "allowed";
  const [row] = await dbx
    .select({ id: invitesTable.id })
    .from(invitesTable)
    .where(eq(invitesTable.email, lower))
    .limit(1);
  return row ? "allowed" : "blocked";
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

// POST /users/me/recap-seen — record that this user opened the current week's
// recap. The week is computed server-side (UTC, Monday-start) so clients can't
// write arbitrary values and every device agrees on which week was seen.
router.post("/users/me/recap-seen", async (req, res): Promise<void> => {
  if (!req.currentUser) {
    res.status(404).json({ error: "No bettor profile linked to this account" });
    return;
  }
  const seenWeek = lastCompletedWeekStart(dayOf(new Date()));
  const [updated] = await db
    .update(usersTable)
    .set({ recapSeenWeek: seenWeek })
    .where(eq(usersTable.id, req.currentUser.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(MarkRecapSeenResponse.parse(formatUser(updated)));
});

// POST /users/me/leak-celebration-seen — consume the one-time leak trend-flip
// celebration. Called by the client only after the celebratory card actually
// rendered, so a background fetch of GET /stats/leak-profile can never burn
// the celebration unseen. The IS NULL guard keeps the first timestamp under
// concurrent acknowledgements; repeat calls are harmless no-ops.
router.post("/users/me/leak-celebration-seen", async (req, res): Promise<void> => {
  if (!req.currentUser) {
    res.status(404).json({ error: "No bettor profile linked to this account" });
    return;
  }
  await db
    .update(usersTable)
    .set({ leakTrendCelebratedAt: new Date() })
    .where(and(eq(usersTable.id, req.currentUser.id), isNull(usersTable.leakTrendCelebratedAt)));
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.currentUser.id))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(MarkLeakCelebrationSeenResponse.parse(formatUser(user)));
});

// GET /users/unclaimed — profiles not yet linked to a sign-in account.
// Scoped to the request's world: demo crew members are unlinked by design and
// must never show up as claimable profiles for real sign-ups.
router.get("/users/unclaimed", async (req, res): Promise<void> => {
  const users = await db
    .select()
    .from(usersTable)
    .where(and(isNull(usersTable.clerkUserId), userScopeCondition(req)))
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

      const configuredFounder = founderEmail();
      const isConfiguredFounder =
        configuredFounder != null && email != null && email.trim().toLowerCase() === configuredFounder;

      // Invite gate runs before the seat-cap check: an uninvited account
      // should hear "not invited", not "beta full". No email on the Clerk
      // account counts as not invited when the gate is active. The configured
      // founder is always allowed through.
      if (!isConfiguredFounder && (await inviteGate(tx, email)) === "blocked") {
        return { status: 403, body: { error: "not_invited" } };
      }

      if (!isConfiguredFounder && (await betaIsFull(tx))) {
        return { status: 403, body: { error: "beta_full" } };
      }

      // Founder assignment: FOUNDER_EMAIL is authoritative when set. Without
      // it, the first account to link becomes founder (safe under the
      // advisory lock — two simultaneous first claims can't both win).
      let becomesFounder: boolean;
      if (configuredFounder != null) {
        becomesFounder = isConfiguredFounder;
      } else {
        const [{ linkedCount }] = await tx
          .select({ linkedCount: count() })
          .from(usersTable)
          .where(isNotNull(usersTable.clerkUserId));
        becomesFounder = linkedCount === 0;
      }

      if (userId != null) {
        // Claim an existing profile — the isNull guard means two accounts can
        // never claim the same profile, and the isDemo guard means the
        // fictional demo crew (whose ids are publicly listed on the demo
        // board) can never be linked to a real sign-in.
        const [claimed] = await tx
          .update(usersTable)
          .set({ clerkUserId, email, ...(becomesFounder ? { isFounder: true } : {}) })
          .where(
            and(
              eq(usersTable.id, userId),
              isNull(usersTable.clerkUserId),
              eq(usersTable.isDemo, false),
            ),
          )
          .returning();
        if (!claimed) {
          const [existing] = await tx
            .select({ id: usersTable.id, isDemo: usersTable.isDemo })
            .from(usersTable)
            .where(eq(usersTable.id, userId))
            .limit(1);
          if (!existing || existing.isDemo) {
            // Demo profiles are invisible to the real world — report them
            // exactly like a nonexistent id.
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
          isFounder: becomesFounder,
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

// GET /users — scoped: real sessions see the real crew, demo sessions see the
// fictional demo crew, never both.
router.get("/users", async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).where(userScopeCondition(req)).orderBy(usersTable.id);
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
  const { startingBankroll, displayName, avatarColor, oddsFormat } = parsed.data;
  const updateValues: Record<string, unknown> = {};
  if (startingBankroll !== undefined) updateValues.startingBankroll = String(startingBankroll);
  if (displayName !== undefined) updateValues.displayName = displayName;
  if (avatarColor !== undefined) updateValues.avatarColor = avatarColor;
  if (oddsFormat !== undefined) updateValues.oddsFormat = oddsFormat;

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
    recapSeenWeek: u.recapSeenWeek,
    isFounder: u.isFounder,
    oddsFormat: u.oddsFormat,
  };
}

export default router;
