/**
 * Crews — the social unit, and the Pro lever:
 *   - first crew membership (create OR join) is free
 *   - a second create/join for a free account → 402 pro_required
 *   - founder / live proUntil pass the cap; expired proUntil doesn't
 *   - the cap is race-safe: parallel creates can't both slip past it
 *   - invite codes: join by code, bad code 404, duplicate join 409,
 *     the demo crew's code never matches a real join
 *   - social surfaces (leaderboard) only cover the viewer's active crew
 *   - boot bootstrap migrates a pre-crews real world into one default crew
 *   - demo mount: crews are listable, writes are rejected read-only
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers?: Record<string, string | string[] | undefined> }) => ({
    userId: (req?.headers?.["x-test-clerk-id"] as string | undefined) ?? null,
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

import app from "../app";
import { db, pool, usersTable, crewsTable, crewMembersTable } from "@workspace/db";
import { ensureCrewsBootstrapped } from "../lib/crews";

const createdUserIds: number[] = [];
const createdCrewIds: number[] = [];
let counter = 0;

const FUTURE = new Date("2099-01-01T00:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");

async function createLinkedUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const username = `crew_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId, ...overrides })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

function trackCrew(id: number) {
  createdCrewIds.push(id);
  return id;
}

afterAll(async () => {
  if (createdCrewIds.length > 0) {
    await db.delete(crewsTable).where(inArray(crewsTable.id, createdCrewIds));
  }
  if (createdUserIds.length > 0) {
    // Cascade cleans memberships and crews these users own.
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("POST /api/crews — create & the Pro cap", () => {
  it("first crew is free: 201, owner role, becomes active", async () => {
    const { clerkUserId } = await createLinkedUser();
    const res = await request(app)
      .post("/api/crews")
      .set("x-test-clerk-id", clerkUserId)
      .send({ name: "Test Squad" });
    expect(res.status).toBe(201);
    trackCrew(res.body.id);
    expect(res.body).toMatchObject({ name: "Test Squad", role: "owner", memberCount: 1, isActive: true });
    expect(res.body.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("second crew for a free account → 402 pro_required", async () => {
    const { clerkUserId } = await createLinkedUser();
    const first = await request(app).post("/api/crews").set("x-test-clerk-id", clerkUserId).send({ name: "One" });
    trackCrew(first.body.id);
    const res = await request(app).post("/api/crews").set("x-test-clerk-id", clerkUserId).send({ name: "Two" });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("pro_required");
  });

  it("live Pro horizon passes the cap; expired doesn't", async () => {
    const pro = await createLinkedUser({ proUntil: FUTURE });
    const a = await request(app).post("/api/crews").set("x-test-clerk-id", pro.clerkUserId).send({ name: "Pro One" });
    trackCrew(a.body.id);
    const b = await request(app).post("/api/crews").set("x-test-clerk-id", pro.clerkUserId).send({ name: "Pro Two" });
    expect(b.status).toBe(201);
    trackCrew(b.body.id);

    const lapsed = await createLinkedUser({ proUntil: PAST });
    const c = await request(app).post("/api/crews").set("x-test-clerk-id", lapsed.clerkUserId).send({ name: "Lapsed One" });
    trackCrew(c.body.id);
    const d = await request(app).post("/api/crews").set("x-test-clerk-id", lapsed.clerkUserId).send({ name: "Lapsed Two" });
    expect(d.status).toBe(402);
  });

  it("founder passes the cap", async () => {
    const founder = await createLinkedUser({ isFounder: true });
    const a = await request(app).post("/api/crews").set("x-test-clerk-id", founder.clerkUserId).send({ name: "F One" });
    trackCrew(a.body.id);
    const b = await request(app).post("/api/crews").set("x-test-clerk-id", founder.clerkUserId).send({ name: "F Two" });
    expect(b.status).toBe(201);
    trackCrew(b.body.id);
  });

  it("the cap is race-safe: parallel creates yield exactly one crew", async () => {
    const { clerkUserId } = await createLinkedUser();
    const [r1, r2] = await Promise.all([
      request(app).post("/api/crews").set("x-test-clerk-id", clerkUserId).send({ name: "Race A" }),
      request(app).post("/api/crews").set("x-test-clerk-id", clerkUserId).send({ name: "Race B" }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 402]);
    for (const r of [r1, r2]) if (r.status === 201) trackCrew(r.body.id);
  });

  it("blank name → 400", async () => {
    const { clerkUserId } = await createLinkedUser();
    const res = await request(app).post("/api/crews").set("x-test-clerk-id", clerkUserId).send({ name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/crews/join — invite codes", () => {
  it("joins by code (case-insensitive), switches active, counts members", async () => {
    const owner = await createLinkedUser();
    const created = await request(app).post("/api/crews").set("x-test-clerk-id", owner.clerkUserId).send({ name: "Join Me" });
    trackCrew(created.body.id);

    const joiner = await createLinkedUser();
    const res = await request(app)
      .post("/api/crews/join")
      .set("x-test-clerk-id", joiner.clerkUserId)
      .send({ inviteCode: created.body.inviteCode.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, role: "member", memberCount: 2, isActive: true });
  });

  it("bad code → 404; duplicate join → 409; second crew for free member → 402", async () => {
    const owner = await createLinkedUser();
    const created = await request(app).post("/api/crews").set("x-test-clerk-id", owner.clerkUserId).send({ name: "Codes" });
    trackCrew(created.body.id);

    const joiner = await createLinkedUser();
    const bad = await request(app).post("/api/crews/join").set("x-test-clerk-id", joiner.clerkUserId).send({ inviteCode: "NOPE9999" });
    expect(bad.status).toBe(404);

    const ok = await request(app).post("/api/crews/join").set("x-test-clerk-id", joiner.clerkUserId).send({ inviteCode: created.body.inviteCode });
    expect(ok.status).toBe(200);

    const dup = await request(app).post("/api/crews/join").set("x-test-clerk-id", joiner.clerkUserId).send({ inviteCode: created.body.inviteCode });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("already_in_crew");

    const owner2 = await createLinkedUser();
    const other = await request(app).post("/api/crews").set("x-test-clerk-id", owner2.clerkUserId).send({ name: "Second Board" });
    trackCrew(other.body.id);
    const capped = await request(app).post("/api/crews/join").set("x-test-clerk-id", joiner.clerkUserId).send({ inviteCode: other.body.inviteCode });
    expect(capped.status).toBe(402);
    expect(capped.body.error).toBe("pro_required");
  });

  it("the demo crew's invite code never matches a real join", async () => {
    const demoOwner = await createLinkedUser({ isDemo: true });
    const [demoCrew] = await db
      .insert(crewsTable)
      .values({ name: "Sealed Demo", ownerId: demoOwner.user.id, inviteCode: "DEMOCODE", isDemo: true })
      .returning();
    trackCrew(demoCrew.id);

    const real = await createLinkedUser();
    const res = await request(app).post("/api/crews/join").set("x-test-clerk-id", real.clerkUserId).send({ inviteCode: "DEMOCODE" });
    expect(res.status).toBe(404);
  });
});

describe("switching, listing, rotating", () => {
  it("list shows all memberships with the active flag; activate switches it", async () => {
    const pro = await createLinkedUser({ proUntil: FUTURE });
    const a = await request(app).post("/api/crews").set("x-test-clerk-id", pro.clerkUserId).send({ name: "Alpha" });
    trackCrew(a.body.id);
    const b = await request(app).post("/api/crews").set("x-test-clerk-id", pro.clerkUserId).send({ name: "Bravo" });
    trackCrew(b.body.id);

    let list = await request(app).get("/api/crews").set("x-test-clerk-id", pro.clerkUserId);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.find((c: { id: number }) => c.id === b.body.id).isActive).toBe(true);

    const back = await request(app).post(`/api/crews/${a.body.id}/activate`).set("x-test-clerk-id", pro.clerkUserId);
    expect(back.status).toBe(200);
    list = await request(app).get("/api/crews").set("x-test-clerk-id", pro.clerkUserId);
    expect(list.body.find((c: { id: number }) => c.id === a.body.id).isActive).toBe(true);

    const stranger = await createLinkedUser();
    const nope = await request(app).post(`/api/crews/${a.body.id}/activate`).set("x-test-clerk-id", stranger.clerkUserId);
    expect(nope.status).toBe(404);
  });

  it("rotate is owner-only and kills the old code", async () => {
    const owner = await createLinkedUser();
    const created = await request(app).post("/api/crews").set("x-test-clerk-id", owner.clerkUserId).send({ name: "Rotate" });
    trackCrew(created.body.id);
    const oldCode = created.body.inviteCode;

    const member = await createLinkedUser();
    await request(app).post("/api/crews/join").set("x-test-clerk-id", member.clerkUserId).send({ inviteCode: oldCode });

    const denied = await request(app).post(`/api/crews/${created.body.id}/invite-code`).set("x-test-clerk-id", member.clerkUserId);
    expect(denied.status).toBe(403);

    const rotated = await request(app).post(`/api/crews/${created.body.id}/invite-code`).set("x-test-clerk-id", owner.clerkUserId);
    expect(rotated.status).toBe(200);
    expect(rotated.body.inviteCode).not.toBe(oldCode);

    const outsider = await createLinkedUser();
    const stale = await request(app).post("/api/crews/join").set("x-test-clerk-id", outsider.clerkUserId).send({ inviteCode: oldCode });
    expect(stale.status).toBe(404);
  });
});

describe("crew scoping of social surfaces", () => {
  it("the leaderboard only ranks the viewer's active crew", async () => {
    const u1 = await createLinkedUser();
    const u2 = await createLinkedUser();
    const u3 = await createLinkedUser();

    const crewA = await request(app).post("/api/crews").set("x-test-clerk-id", u1.clerkUserId).send({ name: "Scope A" });
    trackCrew(crewA.body.id);
    await request(app).post("/api/crews/join").set("x-test-clerk-id", u2.clerkUserId).send({ inviteCode: crewA.body.inviteCode });
    const crewB = await request(app).post("/api/crews").set("x-test-clerk-id", u3.clerkUserId).send({ name: "Scope B" });
    trackCrew(crewB.body.id);

    const board = await request(app).get("/api/workspace/leaderboard?period=all").set("x-test-clerk-id", u1.clerkUserId);
    expect(board.status).toBe(200);
    const ids = board.body.map((e: { userId: number }) => e.userId);
    expect(ids).toContain(u1.user.id);
    expect(ids).toContain(u2.user.id);
    expect(ids).not.toContain(u3.user.id);
  });

  it("recap and narrative refuse out-of-crew targets (privacy)", async () => {
    const u1 = await createLinkedUser();
    const u2 = await createLinkedUser();
    const outsider = await createLinkedUser();

    const crew = await request(app).post("/api/crews").set("x-test-clerk-id", u1.clerkUserId).send({ name: "Privacy" });
    trackCrew(crew.body.id);
    await request(app).post("/api/crews/join").set("x-test-clerk-id", u2.clerkUserId).send({ inviteCode: crew.body.inviteCode });
    const otherCrew = await request(app).post("/api/crews").set("x-test-clerk-id", outsider.clerkUserId).send({ name: "Outside" });
    trackCrew(otherCrew.body.id);

    // Crewmate: allowed.
    const mate = await request(app).get(`/api/stats/recap?userId=${u1.user.id}`).set("x-test-clerk-id", u2.clerkUserId);
    expect(mate.status).toBe(200);

    // Different crew: the recap and its narrative are off-limits.
    const recap = await request(app).get(`/api/stats/recap?userId=${u1.user.id}`).set("x-test-clerk-id", outsider.clerkUserId);
    expect(recap.status).toBe(404);
    const narrative = await request(app).get(`/api/stats/recap/narrative?userId=${u1.user.id}`).set("x-test-clerk-id", outsider.clerkUserId);
    expect(narrative.status).toBe(404);
  });

  it("a crewless bettor's board is just themselves", async () => {
    const loner = await createLinkedUser();
    const board = await request(app).get("/api/workspace/leaderboard?period=all").set("x-test-clerk-id", loner.clerkUserId);
    expect(board.status).toBe(200);
    expect(board.body.map((e: { userId: number }) => e.userId)).toEqual([loner.user.id]);
  });
});

describe("boot bootstrap", () => {
  it("migrates a pre-crews real world into one default crew, once", async () => {
    // Simulate the pre-crews world: no real crews at all.
    await db.delete(crewsTable).where(eq(crewsTable.isDemo, false));

    const a = await createLinkedUser();
    const b = await createLinkedUser();

    await ensureCrewsBootstrapped();

    const [crew] = await db.select().from(crewsTable).where(eq(crewsTable.isDemo, false)).limit(1);
    expect(crew).toBeDefined();
    trackCrew(crew.id);
    const members = await db.select().from(crewMembersTable).where(eq(crewMembersTable.crewId, crew.id));
    const memberIds = members.map((m) => m.userId);
    expect(memberIds).toContain(a.user.id);
    expect(memberIds).toContain(b.user.id);

    // Second run is a no-op: a real crew exists, so later sign-ups stay free
    // to spend their one slot wherever they want.
    const later = await createLinkedUser();
    await ensureCrewsBootstrapped();
    const laterMemberships = await db
      .select()
      .from(crewMembersTable)
      .where(eq(crewMembersTable.userId, later.user.id));
    expect(laterMemberships).toHaveLength(0);
  });
});

describe("demo mount", () => {
  it("lists the demo crew read-only; writes are rejected", async () => {
    const list = await request(app).get("/api/demo/crews");
    // The demo world may or may not be seeded when this suite runs; when it
    // is, the sealed demo crew comes back. Either way it's a 200.
    expect(list.status).toBe(200);
    const write = await request(app).post("/api/demo/crews").send({ name: "Sneaky" });
    expect(write.status).toBeGreaterThanOrEqual(400);
  });
});
