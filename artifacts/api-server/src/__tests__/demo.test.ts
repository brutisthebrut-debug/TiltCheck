/**
 * Public demo board tests:
 *   - unauthenticated GETs work on /api/demo/* (users, bets, leaderboard, me…)
 *   - every mutation on /api/demo/* gets a friendly 403 demo_read_only
 *   - demo users never leak into the real world (/api/users, /users/unclaimed)
 *   - real users never leak into the demo world (/api/demo/users)
 *   - cross-scope probes with explicit ids 404 (bets, parlays, stats, badges)
 *   - founder overview excludes the demo crew
 */
import { describe, it, expect, afterAll, vi, beforeAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

let currentClerkUserId: string | null = null;

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
    },
  },
}));

// The AI provider must never be hit from tests — any accidental narrative
// generation here would be a real paid call.
const demoGenerateMock = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => demoGenerateMock(...args) } } },
}));

import app from "../app";
import { db, pool, usersTable, betsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createRealUser(opts: { isFounder?: boolean } = {}) {
  const username = `demotest_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Demo Scope Test User",
      avatarColor: "#f43f5e",
      startingBankroll: "1000",
      clerkUserId,
      isFounder: opts.isFounder ?? false,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return { id: row.id, clerkUserId };
}

let demoUserId: number;
let demoBetId: number | undefined;

beforeAll(async () => {
  // Self-sufficient: seed the demo world if a previous test file wiped it.
  const { ensureDemoSeeded } = await import("../lib/demo-seed");
  await ensureDemoSeeded();

  const demoUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isDemo, true))
    .orderBy(usersTable.id);
  expect(demoUsers.length).toBeGreaterThan(0);
  demoUserId = demoUsers[0].id;

  const [demoBet] = await db
    .select({ id: betsTable.id })
    .from(betsTable)
    .where(eq(betsTable.userId, demoUserId))
    .limit(1);
  demoBetId = demoBet?.id;
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("demo board — public reads", () => {
  it("serves users, me, leaderboard, stats, and bets without auth", async () => {
    currentClerkUserId = null;

    const users = await request(app).get("/api/demo/users");
    expect(users.status).toBe(200);
    expect(users.body.length).toBeGreaterThanOrEqual(5);
    for (const u of users.body) {
      expect(u.username.startsWith("demo_")).toBe(true);
    }

    const me = await request(app).get("/api/demo/users/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(demoUserId);

    const leaderboard = await request(app).get("/api/demo/workspace/leaderboard");
    expect(leaderboard.status).toBe(200);
    expect(leaderboard.body.length).toBeGreaterThanOrEqual(5);

    const stats = await request(app).get("/api/demo/stats/summary");
    expect(stats.status).toBe(200);

    // Narrative spend guard: old demo weeks never trigger a fresh generation —
    // anonymous visitors can't fan out paid calls across the seeded history.
    const oldNarrative = await request(app).get("/api/demo/stats/recap/narrative?weekStart=2026-05-04");
    expect(oldNarrative.status).toBe(200);
    expect(oldNarrative.body.narrative).toBeNull();
    expect(demoGenerateMock).not.toHaveBeenCalled();

    const bets = await request(app).get("/api/demo/bets");
    expect(bets.status).toBe(200);
    expect(bets.body.length).toBeGreaterThan(0);

    const recap = await request(app).get("/api/demo/stats/recap");
    expect(recap.status).toBe(200);

    const bankroll = await request(app).get("/api/demo/bankroll");
    expect(bankroll.status).toBe(200);
  });

  it("rejects every mutation with a friendly 403", async () => {
    currentClerkUserId = null;

    const post = await request(app).post("/api/demo/bets").send({});
    expect(post.status).toBe(403);
    expect(post.body.error).toBe("demo_read_only");
    expect(post.body.message).toMatch(/sign up/i);

    const patch = await request(app).patch(`/api/demo/bets/${demoBetId}`).send({ stake: 1 });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toBe("demo_read_only");

    const del = await request(app).delete(`/api/demo/bets/${demoBetId}`);
    expect(del.status).toBe(403);

    const tx = await request(app)
      .post("/api/demo/bankroll/transactions")
      .send({ type: "deposit", amount: 100 });
    expect(tx.status).toBe(403);
  });

  it("never exposes admin routes on the demo mount", async () => {
    currentClerkUserId = null;
    // Unmatched demo paths fall through to the authenticated stack → 401.
    // Either way, no founder data leaks to an anonymous demo visitor.
    const res = await request(app).get("/api/demo/admin/overview");
    expect([401, 404]).toContain(res.status);
  });
});

describe("demo/real world isolation", () => {
  it("real /api/users excludes the demo crew; demo /users excludes real users", async () => {
    const real = await createRealUser();

    const realUsers = await request(app).get("/api/users");
    expect(realUsers.status).toBe(200);
    expect(realUsers.body.some((u: { id: number }) => u.id === demoUserId)).toBe(false);
    expect(realUsers.body.some((u: { id: number }) => u.id === real.id)).toBe(true);

    currentClerkUserId = null;
    const demoUsers = await request(app).get("/api/demo/users");
    expect(demoUsers.body.some((u: { id: number }) => u.id === real.id)).toBe(false);
  });

  it("demo users are never claimable", async () => {
    await createRealUser();
    const res = await request(app).get("/api/users/unclaimed");
    expect(res.status).toBe(200);
    expect(
      res.body.some((u: { username: string }) => u.username.startsWith("demo_")),
    ).toBe(false);
  });

  it("cross-scope id probes 404 in both directions", async () => {
    const real = await createRealUser();
    const created = await request(app).post("/api/bets").send({
      sport: "NBA",
      event: "Demo Scope Test Game",
      betType: "moneyline",
      pick: "Team A ML",
      odds: 150,
      stake: 50,
      gameDate: "2026-07-14",
      confidenceScore: 7,
    });
    expect(created.status).toBe(201);
    const realBetId = created.body.id;

    // Real session probing a demo bet id → 404
    const demoBetFromReal = await request(app).get(`/api/bets/${demoBetId}`);
    expect(demoBetFromReal.status).toBe(404);

    // Real session asking for demo user's stats/badges → 404
    const stats = await request(app).get(`/api/stats/summary?userId=${demoUserId}`);
    expect(stats.status).toBe(404);
    const badges = await request(app).get(`/api/users/${demoUserId}/badges`);
    expect(badges.status).toBe(404);
    const streaks = await request(app).get(`/api/stats/streaks?userId=${demoUserId}`);
    expect(streaks.status).toBe(404);

    // Demo world probing a real bet id → 404
    currentClerkUserId = null;
    const realBetFromDemo = await request(app).get(`/api/demo/bets/${realBetId}`);
    expect(realBetFromDemo.status).toBe(404);
    const realStatsFromDemo = await request(app).get(`/api/demo/stats/summary?userId=${real.id}`);
    expect(realStatsFromDemo.status).toBe(404);
  });

  it("a real sign-in can never claim a demo profile", async () => {
    // Fresh signed-in account with no linked profile yet
    const clerkUserId = `clerk_demotest_claim_${Date.now()}`;
    currentClerkUserId = clerkUserId;

    const res = await request(app).post("/api/users/claim").send({ userId: demoUserId });
    expect(res.status).toBe(404);

    // The demo user must remain unlinked
    const [demoUser] = await db
      .select({ clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(eq(usersTable.id, demoUserId));
    expect(demoUser.clerkUserId).toBeNull();
  });

  it("founder overview excludes the demo crew and its plays", async () => {
    await createRealUser({ isFounder: true });
    const res = await request(app).get("/api/admin/overview");
    expect(res.status).toBe(200);
    const members = res.body.members ?? [];
    expect(members.length).toBeGreaterThan(0);
    expect(members.some((m: { userId: number }) => m.userId === demoUserId)).toBe(false);
  });
});
