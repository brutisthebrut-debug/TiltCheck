/**
 * GET /stats/lessons — the Lesson Library feed:
 *   - unauthenticated → 401; foreign userId param → 403
 *   - empty for a fresh user
 *   - returns settled bets AND parlays with their journal fields, most
 *     recently settled first; pending plays never appear
 *   - summary aggregates: reviewed counts, sound/flawed counts, miss-reason
 *     breakdown (losses only, "na" excluded), mostRepeatedMistake needs >= 2
 *     occurrences and skips normal_variance
 *   - the demo mount serves the demo POV member read-only
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

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

import app from "../app";
import { db, pool, usersTable, betsTable, parlaysTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createLinkedUser() {
  const username = `lessons_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

type BetOverrides = Partial<typeof betsTable.$inferInsert>;

async function seedBet(userId: number, overrides: BetOverrides = {}) {
  await db.insert(betsTable).values({
    userId,
    sport: "NBA",
    event: "A @ B",
    betType: "spread",
    pick: "A -3.5",
    odds: -110,
    stake: "50.00",
    potentialPayout: "95.45",
    actualPayout: overrides.status === "won" ? "95.45" : overrides.status === "push" ? "50.00" : "0.00",
    status: "lost",
    gameDate: "2026-07-01",
    confidenceScore: 5,
    settledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    ...overrides,
  });
}

async function seedParlay(userId: number, overrides: Partial<typeof parlaysTable.$inferInsert> = {}) {
  await db.insert(parlaysTable).values({
    userId,
    name: "Sunday Special",
    stake: "25.00",
    odds: 260,
    potentialPayout: "90.00",
    actualPayout: overrides.status === "won" ? "90.00" : "0.00",
    status: "lost",
    confidenceScore: 6,
    settledAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
    ...overrides,
  });
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("GET /stats/lessons", () => {
  it("rejects unauthenticated requests and foreign userId params", async () => {
    currentClerkUserId = null;
    const unauth = await request(app).get("/api/stats/lessons");
    expect(unauth.status).toBe(401);

    const { clerkUserId } = await createLinkedUser();
    const { user: other } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const foreign = await request(app).get(`/api/stats/lessons?userId=${other.id}`);
    expect(foreign.status).toBe(403);
  });

  it("returns an empty library for a fresh user", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/stats/lessons");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      summary: {
        settledCount: 0,
        reviewedCount: 0,
        soundCount: 0,
        flawedCount: 0,
        missReasons: [],
        mostRepeatedMistake: null,
      },
      items: [],
    });
  });

  it("returns settled bets and parlays with journal fields, newest settle first; pending excluded", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;

    await seedBet(user.id, {
      status: "won",
      rationale: "Line moved my way all week",
      reasoningQuality: "sound",
      settledAt: new Date("2026-07-10T12:00:00Z"),
    });
    await seedBet(user.id, { status: "pending", settledAt: null });
    await seedParlay(user.id, {
      status: "lost",
      missReason: "emotional",
      whatHappened: "Chased the early loss",
      settledAt: new Date("2026-07-12T12:00:00Z"),
    });

    const res = await request(app).get(`/api/stats/lessons?userId=${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const [first, second] = res.body.items;
    // Parlay settled later → first
    expect(first.type).toBe("parlay");
    expect(first.title).toBe("Parlay: Sunday Special");
    expect(first.sport).toBeNull();
    expect(first.result).toBe("lost");
    expect(first.missReason).toBe("emotional");
    expect(first.whatHappened).toBe("Chased the early loss");
    expect(first.reviewed).toBe(true);
    expect(first.profit).toBe(-25);

    expect(second.type).toBe("bet");
    expect(second.result).toBe("won");
    expect(second.rationale).toBe("Line moved my way all week");
    expect(second.reasoningQuality).toBe("sound");
    expect(second.reviewed).toBe(true);
    expect(second.profit).toBeCloseTo(45.45, 2);
  });

  it("computes summary aggregates and the most repeated mistake", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;

    // Two emotional losses, one bad_read loss, one normal_variance loss,
    // one "na" loss (no signal), one ungraded win.
    await seedBet(user.id, { status: "lost", missReason: "emotional", reasoningQuality: "flawed" });
    await seedBet(user.id, { status: "lost", missReason: "emotional", reasoningQuality: "flawed" });
    await seedBet(user.id, { status: "lost", missReason: "bad_read", reasoningQuality: "sound" });
    await seedBet(user.id, { status: "lost", missReason: "normal_variance" });
    await seedBet(user.id, { status: "lost", missReason: "na" });
    await seedBet(user.id, { status: "won" });

    const res = await request(app).get("/api/stats/lessons");
    expect(res.status).toBe(200);
    const { summary } = res.body;
    expect(summary.settledCount).toBe(6);
    // reviewed: 2 emotional + bad_read + normal_variance = 4 ("na" and blank win don't count)
    expect(summary.reviewedCount).toBe(4);
    expect(summary.soundCount).toBe(1);
    expect(summary.flawedCount).toBe(2);
    expect(summary.missReasons[0]).toEqual({ reason: "emotional", count: 2 });
    expect(summary.missReasons).toHaveLength(3); // na excluded
    expect(summary.mostRepeatedMistake).toEqual({ reason: "emotional", count: 2 });
  });

  it("does not call a single occurrence or normal variance a repeated mistake", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;

    await seedBet(user.id, { status: "lost", missReason: "bad_price" });
    await seedBet(user.id, { status: "lost", missReason: "normal_variance" });
    await seedBet(user.id, { status: "lost", missReason: "normal_variance" });

    const res = await request(app).get("/api/stats/lessons");
    expect(res.body.summary.mostRepeatedMistake).toBeNull();
  });

  it("serves the demo POV member's lessons on the demo mount without auth", async () => {
    currentClerkUserId = null;
    const res = await request(app).get("/api/demo/stats/lessons");
    // Demo world self-seeds at boot; if this environment has it, the shape
    // must hold and every item is a settled play.
    if (res.status === 200) {
      expect(res.body.summary.settledCount).toBe(res.body.items.length);
      for (const item of res.body.items) {
        expect(["won", "lost", "push"]).toContain(item.result);
      }
    } else {
      expect(res.status).toBe(503); // demo not seeded in this run
    }
  });
});
