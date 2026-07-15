import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, isNotNull, desc } from "drizzle-orm";
import { db, usersTable, betsTable, parlaysTable, invitesTable } from "@workspace/db";
import { dayOf, mondayOf } from "@workspace/weeks";
import {
  GetAdminOverviewResponse,
  ListInvitesResponse,
  CreateInviteBody,
  CreateInviteResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/** Founder-only routes. Must run after requireAuth. */
function requireFounder(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser?.isFounder) {
    res.status(403).json({ error: "Founder access only" });
    return;
  }
  next();
}

router.use("/admin", requireFounder);

// Deliberately simple: catches obvious typos, leaves real validation to the
// email provider at sign-in time.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatInvite(inv: typeof invitesTable.$inferSelect, claimedEmails: Set<string>) {
  return {
    id: inv.id,
    email: inv.email,
    claimed: claimedEmails.has(inv.email),
    createdAt: inv.createdAt.toISOString(),
  };
}

async function linkedEmailSet(): Promise<Set<string>> {
  const rows = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(isNotNull(usersTable.clerkUserId));
  return new Set(rows.map((r) => r.email?.toLowerCase()).filter((e): e is string => !!e));
}

// GET /admin/invites — newest first
router.get("/admin/invites", async (_req, res): Promise<void> => {
  const [invites, claimed] = await Promise.all([
    db.select().from(invitesTable).orderBy(desc(invitesTable.id)),
    linkedEmailSet(),
  ]);
  res.json(ListInvitesResponse.parse(invites.map((i) => formatInvite(i, claimed))));
});

// POST /admin/invites — add an email to the beta list
router.post("/admin/invites", async (req, res): Promise<void> => {
  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "That doesn't look like an email address" });
    return;
  }
  const [existing] = await db.select().from(invitesTable).where(eq(invitesTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "That email is already on the invite list" });
    return;
  }
  const [created] = await db
    .insert(invitesTable)
    .values({ email, invitedById: req.currentUser!.id })
    .returning();
  const claimed = await linkedEmailSet();
  res.status(201).json(CreateInviteResponse.parse(formatInvite(created, claimed)));
});

// DELETE /admin/invites/:id — removing an invite does NOT unlink accounts that
// already claimed a profile; it only stops future sign-ups with that email.
router.delete("/admin/invites/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid invite id" });
    return;
  }
  const deleted = await db.delete(invitesTable).where(eq(invitesTable.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  res.status(204).end();
});

// GET /admin/overview — seats, invites, and crew activity for the founder dash
router.get("/admin/overview", async (req, res): Promise<void> => {
  // Founder dash covers the real crew only — the fictional demo bettors and
  // their seeded plays are excluded from every count.
  const [users, bets, parlays, invites] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.isDemo, false)).orderBy(usersTable.id),
    db.select({ userId: betsTable.userId, stake: betsTable.stake, createdAt: betsTable.createdAt }).from(betsTable),
    db.select({ userId: parlaysTable.userId, stake: parlaysTable.stake, createdAt: parlaysTable.createdAt }).from(parlaysTable),
    db.select().from(invitesTable),
  ]);

  const weekStart = new Date(`${mondayOf(dayOf(new Date()))}T00:00:00Z`);
  const realIds = new Set(users.map((u) => u.id));
  const plays = [...bets, ...parlays].filter((p) => realIds.has(p.userId));

  type MemberAgg = { plays: number; playsThisWeek: number; wagered: number; lastPlayAt: Date | null };
  const byUser = new Map<number, MemberAgg>();
  for (const p of plays) {
    const agg = byUser.get(p.userId) ?? { plays: 0, playsThisWeek: 0, wagered: 0, lastPlayAt: null };
    agg.plays += 1;
    agg.wagered += Number(p.stake);
    if (p.createdAt >= weekStart) agg.playsThisWeek += 1;
    if (!agg.lastPlayAt || p.createdAt > agg.lastPlayAt) agg.lastPlayAt = p.createdAt;
    byUser.set(p.userId, agg);
  }

  const linkedEmails = new Set(
    users.filter((u) => u.clerkUserId).map((u) => u.email?.toLowerCase()).filter(Boolean),
  );
  const envConfigured = !!process.env.BETA_ALLOWED_EMAILS?.trim();

  const members = users.map((u) => {
    const agg = byUser.get(u.id);
    return {
      userId: u.id,
      displayName: u.displayName,
      avatarColor: u.avatarColor,
      email: u.email,
      linked: u.clerkUserId != null,
      isFounder: u.isFounder,
      playsLogged: agg?.plays ?? 0,
      playsThisWeek: agg?.playsThisWeek ?? 0,
      totalWagered: Math.round((agg?.wagered ?? 0) * 100) / 100,
      lastPlayAt: agg?.lastPlayAt?.toISOString() ?? null,
    };
  });

  const overview = {
    betaLocked: envConfigured || invites.length > 0,
    linkedSeats: users.filter((u) => u.clerkUserId).length,
    invitesOutstanding: invites.filter((i) => !linkedEmails.has(i.email)).length,
    playsThisWeek: plays.filter((p) => p.createdAt >= weekStart).length,
    wageredThisWeek:
      Math.round(plays.filter((p) => p.createdAt >= weekStart).reduce((a, p) => a + Number(p.stake), 0) * 100) / 100,
    totalPlays: plays.length,
    totalWagered: Math.round(plays.reduce((a, p) => a + Number(p.stake), 0) * 100) / 100,
    members,
  };
  res.json(GetAdminOverviewResponse.parse(overview));
});

export default router;
