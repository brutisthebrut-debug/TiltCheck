/**
 * Integration tests for GET /api/settlement/needs-settling.
 *
 * Proves:
 *   - pending bets with a past game date are returned; future-dated and
 *     already-settled bets are not
 *   - a parlay appears only when EVERY leg's game date is in the past
 *   - results are scoped to the signed-in user
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

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

import app from "../app";
import { todayInTimeZone } from "../lib/dates";
import { addDays } from "@workspace/weeks";
import {
  db,
  pool,
  usersTable,
  betsTable,
  parlaysTable,
  parlayLegsTable,
} from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser() {
  const username = `test_nudge_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Nudge Tester",
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  return { row, clerkUserId };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db.delete(parlayLegsTable).where(
        inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id))
      );
      await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    }
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

const PAST = "2026-01-05";
const FUTURE = "2099-01-05";

function makeBet(userId: number, overrides: Partial<typeof betsTable.$inferInsert> = {}) {
  return {
    userId,
    sport: "NFL",
    event: "Chiefs vs Raiders",
    betType: "moneyline" as const,
    pick: "Chiefs ML",
    odds: -110,
    stake: "100",
    potentialPayout: "190.91",
    gameDate: PAST,
    confidenceScore: 5,
    ...overrides,
  };
}

async function createParlayWithLegs(userId: number, name: string, legGameDates: string[]) {
  const [parlay] = await db
    .insert(parlaysTable)
    .values({
      userId,
      name,
      stake: "50",
      odds: 264,
      potentialPayout: "182.00",
      confidenceScore: 3,
    })
    .returning();
  await db.insert(parlayLegsTable).values(
    legGameDates.map((gameDate, i) => ({
      parlayId: parlay.id,
      sport: "NFL",
      event: `Game ${i}`,
      betType: "moneyline" as const,
      pick: `Pick ${i}`,
      odds: -110,
      gameDate,
    }))
  );
  return parlay;
}

describe("GET /api/settlement/needs-settling", () => {
  it("returns only the user's overdue pending bets and fully-finished parlays", async () => {
    const { row: me, clerkUserId } = await createUser();
    const { row: other } = await createUser();
    currentClerkUserId = clerkUserId;

    await db.insert(betsTable).values([
      makeBet(me.id, { event: "Overdue bet", gameDate: PAST }),
      makeBet(me.id, { event: "Future bet", gameDate: FUTURE }),
      makeBet(me.id, { event: "Settled bet", gameDate: PAST, status: "won" }),
      makeBet(other.id, { event: "Someone else's overdue bet", gameDate: PAST }),
    ]);

    const done = await createParlayWithLegs(me.id, "All legs done", [PAST, PAST]);
    await createParlayWithLegs(me.id, "One leg upcoming", [PAST, FUTURE]);
    await createParlayWithLegs(other.id, "Other user's done parlay", [PAST, PAST]);

    const res = await request(app).get("/api/settlement/needs-settling");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.bets).toHaveLength(1);
    expect(res.body.bets[0].event).toBe("Overdue bet");
    expect(res.body.parlays).toHaveLength(1);
    expect(res.body.parlays[0].id).toBe(done.id);
    expect(res.body.parlays[0].legs).toHaveLength(2);
  });

  it("returns an empty result when the user is settled up", async () => {
    const { clerkUserId } = await createUser();
    currentClerkUserId = clerkUserId;

    const res = await request(app).get("/api/settlement/needs-settling");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, bets: [], parlays: [] });
  });

  it("requires a linked profile", async () => {
    currentClerkUserId = `clerk_missing_${Date.now()}`;
    const res = await request(app).get("/api/settlement/needs-settling");
    expect(res.status).toBe(403);
  });

  it("judges 'today' in the bettor's timezone when tz is provided", async () => {
    const { clerkUserId } = await createUser();
    currentClerkUserId = clerkUserId;

    // A bet dated "today" in the requested zone is still in progress there
    // and must not be nagged; a bet dated the day before must be.
    const tz = "America/Los_Angeles";
    const todayThere = todayInTimeZone(tz);
    const yesterdayThere = addDays(todayThere, -1);

    const me = createdUserIds[createdUserIds.length - 1];
    await db.insert(betsTable).values([
      makeBet(me, { event: "Game day still running", gameDate: todayThere }),
      makeBet(me, { event: "Finished yesterday", gameDate: yesterdayThere }),
    ]);

    const res = await request(app).get(`/api/settlement/needs-settling?tz=${encodeURIComponent(tz)}`);
    expect(res.status).toBe(200);
    expect(res.body.bets.map((b: { event: string }) => b.event)).toEqual(["Finished yesterday"]);
    // Parlay legs use the same clock: a leg dated today-there keeps the
    // parlay out of the list.
    await createParlayWithLegs(me, "Leg still running locally", [yesterdayThere, todayThere]);
    const res2 = await request(app).get(`/api/settlement/needs-settling?tz=${encodeURIComponent(tz)}`);
    expect(res2.body.parlays).toHaveLength(0);
  });

  it("an unknown tz falls back to UTC instead of failing", async () => {
    const { clerkUserId } = await createUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/settlement/needs-settling?tz=Not/AZone");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, bets: [], parlays: [] });
  });
});

describe("todayInTimeZone", () => {
  it("west-of-UTC evening: UTC has rolled to tomorrow but the bettor's day hasn't ended", async () => {
    // 2026-07-15T03:00Z is still the evening of July 14 in Los Angeles.
    const instant = new Date("2026-07-15T03:00:00Z");
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2026-07-14");
    expect(todayInTimeZone(undefined, instant)).toBe("2026-07-15");
  });

  it("east-of-UTC morning: the bettor's day is already tomorrow", async () => {
    // 2026-07-14T22:00Z is already July 15 in Tokyo.
    const instant = new Date("2026-07-14T22:00:00Z");
    expect(todayInTimeZone("Asia/Tokyo", instant)).toBe("2026-07-15");
  });

  it("invalid or empty tz falls back to UTC", async () => {
    const instant = new Date("2026-07-15T03:00:00Z");
    expect(todayInTimeZone("Not/AZone", instant)).toBe("2026-07-15");
    expect(todayInTimeZone(null, instant)).toBe("2026-07-15");
    expect(todayInTimeZone("", instant)).toBe("2026-07-15");
  });
});
