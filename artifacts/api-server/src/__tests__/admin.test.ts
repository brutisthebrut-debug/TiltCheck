/**
 * Founder dashboard tests:
 *   - non-founders get 403 on every /admin route
 *   - invite CRUD (add lowercases + dedupes, remove, list marks claimed)
 *   - DB invites gate the claim flow (union with BETA_ALLOWED_EMAILS env)
 *   - first linked account becomes the founder
 *   - overview aggregates seats/plays/wagered per member
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray, like } from "drizzle-orm";

let currentClerkUserId: string | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers?: Record<string, string | string[] | undefined> }) => ({
    userId: (req?.headers?.["x-test-clerk-id"] as string | undefined) ?? currentClerkUserId,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        primaryEmailAddress: { emailAddress: `${id}@example.com` },
        emailAddresses: [{ emailAddress: `${id}@example.com` }],
        firstName: "Test",
        lastName: "User",
      }),
    },
  },
}));

process.env.BETA_SEAT_LIMIT = "0";
delete process.env.BETA_ALLOWED_EMAILS;

import app from "../app";
import { db, pool, usersTable, betsTable, invitesTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createLinkedUser(opts: { isFounder?: boolean } = {}) {
  const username = `admintest_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Admin Test User",
      avatarColor: "#22c55e",
      startingBankroll: "1000",
      clerkUserId,
      email: `${username}@example.com`,
      isFounder: opts.isFounder ?? false,
    })
    .returning();
  createdUserIds.push(row.id);
  return { id: row.id, clerkUserId, email: `${username}@example.com` };
}

afterAll(async () => {
  await db.delete(invitesTable).where(like(invitesTable.email, "%admintest%"));
  await db.delete(invitesTable).where(like(invitesTable.email, "%gatetest%"));
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await db.delete(usersTable).where(like(usersTable.username, "gatetest%"));
  await pool.end();
});

describe("founder-only access", () => {
  it("rejects non-founders on every /admin route with 403", async () => {
    const user = await createLinkedUser();
    currentClerkUserId = user.clerkUserId;
    for (const [method, path] of [
      ["get", "/api/admin/overview"],
      ["get", "/api/admin/invites"],
      ["post", "/api/admin/invites"],
      ["delete", "/api/admin/invites/1"],
    ] as const) {
      const res = await (request(app) as any)[method](path).send({ email: "x@example.com" });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("invite management", () => {
  it("adds (lowercased), lists, dedupes, and removes invites", async () => {
    const founder = await createLinkedUser({ isFounder: true });
    currentClerkUserId = founder.clerkUserId;
    const email = `Friend.AdminTest.${Date.now()}@Example.COM`;

    const created = await request(app).post("/api/admin/invites").send({ email });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(email.toLowerCase());
    expect(created.body.claimed).toBe(false);

    const dupe = await request(app).post("/api/admin/invites").send({ email: email.toLowerCase() });
    expect(dupe.status).toBe(409);

    const bad = await request(app).post("/api/admin/invites").send({ email: "not-an-email" });
    expect(bad.status).toBe(400);

    const list = await request(app).get("/api/admin/invites");
    expect(list.status).toBe(200);
    expect(list.body.some((i: { id: number }) => i.id === created.body.id)).toBe(true);

    const del = await request(app).delete(`/api/admin/invites/${created.body.id}`);
    expect(del.status).toBe(204);
    const delAgain = await request(app).delete(`/api/admin/invites/${created.body.id}`);
    expect(delAgain.status).toBe(404);
  });
});

describe("DB invites gate the claim flow", () => {
  it("blocks uninvited claims once any invite exists, allows invited ones", async () => {
    const founder = await createLinkedUser({ isFounder: true });
    currentClerkUserId = founder.clerkUserId;

    const invitedId = `gatetest_in_${Date.now()}_${counter++}`;
    const created = await request(app)
      .post("/api/admin/invites")
      .send({ email: `${invitedId}@example.com` });
    expect(created.status).toBe(201);

    try {
      // Stranger blocked by the DB invite list (no env var set)
      currentClerkUserId = `gatetest_out_${Date.now()}_${counter++}`;
      const blocked = await request(app).post("/api/users/claim").send({});
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe("not_invited");

      // Invited email gets in
      currentClerkUserId = invitedId;
      const allowed = await request(app).post("/api/users/claim").send({});
      expect(allowed.status).toBe(200);
      createdUserIds.push(allowed.body.id);

      // Invite now shows as claimed
      currentClerkUserId = founder.clerkUserId;
      const list = await request(app).get("/api/admin/invites");
      const row = list.body.find((i: { id: number }) => i.id === created.body.id);
      expect(row?.claimed).toBe(true);
    } finally {
      await db.delete(invitesTable).where(inArray(invitesTable.id, [created.body.id]));
    }
  });
});

describe("founder overview", () => {
  it("reports seats, invite counts, and per-member activity", async () => {
    const founder = await createLinkedUser({ isFounder: true });
    currentClerkUserId = founder.clerkUserId;
    const bet = await request(app).post("/api/bets").send({
      sport: "NBA",
      event: "Overview Game",
      betType: "moneyline",
      pick: "A ML",
      odds: -110,
      stake: 25,
      gameDate: "2026-07-14",
      confidenceScore: 5,
    });
    expect(bet.status).toBe(201);

    const res = await request(app).get("/api/admin/overview");
    expect(res.status).toBe(200);
    expect(res.body.linkedSeats).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.betaLocked).toBe("boolean");
    const me = res.body.members.find((m: { userId: number }) => m.userId === founder.id);
    expect(me).toBeTruthy();
    expect(me.isFounder).toBe(true);
    expect(me.linked).toBe(true);
    expect(me.playsLogged).toBe(1);
    expect(me.playsThisWeek).toBe(1);
    expect(me.totalWagered).toBe(25);
    expect(me.lastPlayAt).toBeTruthy();
  });
});

describe("FOUNDER_EMAIL control", () => {
  it("makes the configured email founder, bypassing the gate; others never auto-assign", async () => {
    const founderId = `gatetest_owner_${Date.now()}_${counter++}`;
    const strangerId = `gatetest_rando_${Date.now()}_${counter++}`;
    process.env.FOUNDER_EMAIL = ` ${founderId}@Example.com `;
    // Activate the gate with an invite for the stranger, so we can verify the
    // stranger gets in but does NOT become founder even while claiming first.
    process.env.BETA_ALLOWED_EMAILS = `${strangerId}@example.com`;
    try {
      currentClerkUserId = strangerId;
      const strangerClaim = await request(app).post("/api/users/claim").send({});
      expect(strangerClaim.status).toBe(200);
      expect(strangerClaim.body.isFounder).toBe(false);
      createdUserIds.push(strangerClaim.body.id);

      // Configured founder is not on any invite list but always passes the gate
      currentClerkUserId = founderId;
      const founderClaim = await request(app).post("/api/users/claim").send({});
      expect(founderClaim.status).toBe(200);
      expect(founderClaim.body.isFounder).toBe(true);
      createdUserIds.push(founderClaim.body.id);
    } finally {
      delete process.env.FOUNDER_EMAIL;
      delete process.env.BETA_ALLOWED_EMAILS;
    }
  });
});

describe("founder auto-assignment", () => {
  it("exposes isFounder on /users/me", async () => {
    const founder = await createLinkedUser({ isFounder: true });
    currentClerkUserId = founder.clerkUserId;
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(200);
    expect(res.body.isFounder).toBe(true);

    const other = await createLinkedUser();
    currentClerkUserId = other.clerkUserId;
    const res2 = await request(app).get("/api/users/me");
    expect(res2.body.isFounder).toBe(false);
  });
});
