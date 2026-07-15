/**
 * Self-serve account deletion. Proves:
 *  - POST /users/me/delete removes every row the user owns — bets, parlays
 *    (and legs), transactions, badges, crew memberships, recap narratives —
 *    plus the user row itself, with no orphans left behind
 *  - the invite row matching the user's email is deleted; invites they SENT
 *    survive with the sender reference detached
 *  - owned crews transfer to the longest-standing remaining member; a
 *    sole-member crew is deleted outright
 *  - other users' data is untouched
 *  - signed-out / profile-less callers can't delete anything
 *  - the Clerk sign-in account is removed best-effort
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";

let currentClerkUserId: string | null = null;
const clerkDeletedIds: string[] = [];

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: currentClerkUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: null,
        emailAddresses: [],
        firstName: null,
        lastName: null,
      }),
      deleteUser: async (id: string) => {
        clerkDeletedIds.push(id);
      },
    },
  },
}));

import app from "../app";
import {
  db,
  pool,
  usersTable,
  betsTable,
  parlaysTable,
  parlayLegsTable,
  transactionsTable,
  userBadgesTable,
  invitesTable,
  crewsTable,
  crewMembersTable,
  recapNarrativesTable,
} from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string, email?: string) {
  const username = `test_del_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
      email: email ?? null,
    })
    .returning();
  createdUserIds.push(row.id);
  return { row, clerkUserId };
}

function as(clerkUserId: string | null) {
  currentClerkUserId = clerkUserId;
}

async function seedOwnedData(userId: number) {
  const [bet] = await db
    .insert(betsTable)
    .values({
      userId,
      sport: "NBA",
      event: "LAL @ BOS",
      betType: "spread",
      pick: "BOS -4.5",
      odds: -110,
      stake: "50",
      potentialPayout: "95.45",
      status: "pending",
      gameDate: "2026-07-14",
      confidenceScore: 6,
    })
    .returning();
  const [parlay] = await db
    .insert(parlaysTable)
    .values({
      userId,
      name: "Test parlay",
      stake: "20",
      odds: 264,
      potentialPayout: "72.80",
      status: "pending",
      confidenceScore: 5,
    })
    .returning();
  await db.insert(parlayLegsTable).values({
    parlayId: parlay.id,
    sport: "NFL",
    event: "KC @ BUF",
    betType: "moneyline",
    pick: "BUF ML",
    odds: -110,
    gameDate: "2026-07-14",
  });
  await db.insert(transactionsTable).values({
    userId,
    type: "deposit",
    amount: "100",
    balanceAfter: "1100",
  });
  await db.insert(userBadgesTable).values({ userId, badgeId: "first_bet" });
  return { betId: bet.id, parlayId: parlay.id };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(invitesTable).where(inArray(invitesTable.invitedById, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(userBadgesTable).where(inArray(userBadgesTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("POST /users/me/delete", () => {
  it("removes every owned row, handles invites, and leaves other users intact", async () => {
    const { row: victim, clerkUserId: victimClerk } = await createUser(
      "Leaver",
      `leaver_${Date.now()}@example.com`,
    );
    const { row: bystander } = await createUser("Bystander");
    const { betId, parlayId } = await seedOwnedData(victim.id);
    const bystanderData = await seedOwnedData(bystander.id);

    // Their own invite row (how they got in) + an invite they sent.
    await db.insert(invitesTable).values({ email: victim.email!, invitedById: null });
    const inviteeEmail = `invitee_${Date.now()}@example.com`;
    await db.insert(invitesTable).values({ email: inviteeEmail, invitedById: victim.id });

    // Recap narrative (cascades with the user row).
    await db.insert(recapNarrativesTable).values({
      userId: victim.id,
      weekStart: "2026-07-06",
      narrative: "test narrative",
      model: "test-model",
    });

    as(victimClerk);
    const res = await request(app).post("/api/users/me/delete");
    expect(res.status).toBe(204);

    // Everything owned is gone — no orphans.
    expect(await db.select().from(usersTable).where(eq(usersTable.id, victim.id))).toHaveLength(0);
    expect(await db.select().from(betsTable).where(eq(betsTable.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(parlaysTable).where(eq(parlaysTable.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(parlayLegsTable).where(eq(parlayLegsTable.parlayId, parlayId))).toHaveLength(0);
    expect(
      await db.select().from(transactionsTable).where(eq(transactionsTable.userId, victim.id)),
    ).toHaveLength(0);
    expect(await db.select().from(userBadgesTable).where(eq(userBadgesTable.userId, victim.id))).toHaveLength(0);
    expect(
      await db.select().from(recapNarrativesTable).where(eq(recapNarrativesTable.userId, victim.id)),
    ).toHaveLength(0);

    // Their own invite row is gone; the one they sent survives, detached.
    expect(await db.select().from(invitesTable).where(eq(invitesTable.email, victim.email!))).toHaveLength(0);
    const [sentInvite] = await db.select().from(invitesTable).where(eq(invitesTable.email, inviteeEmail));
    expect(sentInvite).toBeDefined();
    expect(sentInvite.invitedById).toBeNull();
    await db.delete(invitesTable).where(eq(invitesTable.email, inviteeEmail));

    // The sign-in account was removed too.
    expect(clerkDeletedIds).toContain(victimClerk);

    // The bystander's world is untouched.
    expect(await db.select().from(usersTable).where(eq(usersTable.id, bystander.id))).toHaveLength(1);
    expect(await db.select().from(betsTable).where(eq(betsTable.id, bystanderData.betId))).toHaveLength(1);
    expect(await db.select().from(parlaysTable).where(eq(parlaysTable.id, bystanderData.parlayId))).toHaveLength(1);
  });

  it("hands an owned crew to the longest-standing remaining member", async () => {
    const { row: owner, clerkUserId: ownerClerk } = await createUser("Crew Owner");
    const { row: elder } = await createUser("Elder Member");
    const { row: rookie } = await createUser("Rookie Member");
    const [crew] = await db
      .insert(crewsTable)
      .values({
        name: `Del Crew ${Date.now()}`,
        ownerId: owner.id,
        inviteCode: `DEL${Date.now().toString(36).toUpperCase()}${counter++}`.slice(0, 16),
      })
      .returning();
    // Insert order = seniority (crew_members ids ascend).
    await db.insert(crewMembersTable).values({ crewId: crew.id, userId: owner.id, role: "owner" });
    await db.insert(crewMembersTable).values({ crewId: crew.id, userId: elder.id, role: "member" });
    await db.insert(crewMembersTable).values({ crewId: crew.id, userId: rookie.id, role: "member" });

    as(ownerClerk);
    expect((await request(app).post("/api/users/me/delete")).status).toBe(204);

    const [after] = await db.select().from(crewsTable).where(eq(crewsTable.id, crew.id));
    expect(after).toBeDefined();
    expect(after.ownerId).toBe(elder.id);
    const [elderMembership] = await db
      .select()
      .from(crewMembersTable)
      .where(eq(crewMembersTable.userId, elder.id));
    expect(elderMembership.role).toBe("owner");
    // The deleted owner's membership cascaded away.
    const remaining = await db.select().from(crewMembersTable).where(eq(crewMembersTable.crewId, crew.id));
    expect(remaining.map((m) => m.userId).sort()).toEqual([elder.id, rookie.id].sort());
  });

  it("shuts down a crew whose owner was its only member", async () => {
    const { row: solo, clerkUserId: soloClerk } = await createUser("Solo Owner");
    const [crew] = await db
      .insert(crewsTable)
      .values({
        name: `Solo Crew ${Date.now()}`,
        ownerId: solo.id,
        inviteCode: `SOL${Date.now().toString(36).toUpperCase()}${counter++}`.slice(0, 16),
      })
      .returning();
    await db.insert(crewMembersTable).values({ crewId: crew.id, userId: solo.id, role: "owner" });

    as(soloClerk);
    expect((await request(app).post("/api/users/me/delete")).status).toBe(204);
    expect(await db.select().from(crewsTable).where(eq(crewsTable.id, crew.id))).toHaveLength(0);
    expect(await db.select().from(crewMembersTable).where(eq(crewMembersTable.crewId, crew.id))).toHaveLength(0);
  });

  it("rejects callers without a session or without a linked profile", async () => {
    as(null);
    expect((await request(app).post("/api/users/me/delete")).status).toBe(401);
    as(`clerk_unlinked_${Date.now()}`);
    expect((await request(app).post("/api/users/me/delete")).status).toBe(404);
    // Nobody can aim deletion at someone else — the route only ever targets
    // the session's own profile; there is no id parameter to abuse.
  });

  it("is not reachable through the read-only demo mount", async () => {
    as(null);
    const res = await request(app).post("/api/demo/users/me/delete");
    expect([403, 404, 405]).toContain(res.status);
    expect(res.status).not.toBe(204);
  });
});
