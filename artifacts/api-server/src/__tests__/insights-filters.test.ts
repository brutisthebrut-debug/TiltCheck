/**
 * /stats/insights sport + since filters:
 *   - sport slices the feed to straight bets in that sport (parlays drop out
 *     — a parlay spans sports, so it can't belong to any single sport)
 *   - since keeps only plays settled on or after that date (bets AND parlays)
 *   - invalid since dates are rejected with a 400, not silently ignored
 *   - unfiltered behavior is unchanged (everything counts)
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
import { db, pool, usersTable, betsTable, parlaysTable } from "@workspace/db";
import { dayOf } from "@workspace/weeks";

const createdUserIds: number[] = [];
let counter = 0;
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function createProUser() {
  const username = `test_insf_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Test User",
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
      proUntil: FUTURE,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return row;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

function betRow(userId: number, sport: string, settledAt: Date, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    sport,
    event: `${sport} game`,
    betType: "moneyline",
    pick: "Home",
    odds: -110,
    stake: "100",
    potentialPayout: "190.91",
    gameDate: "2026-06-01",
    confidenceScore: 5,
    status: "lost",
    actualPayout: "0.00",
    settledAt,
    missReason: "bad_read",
    whatHappened: `Note for ${sport} on ${dayOf(settledAt)}`,
    ...overrides,
  };
}

const OLD = new Date("2026-01-10T00:00:00Z");
const RECENT = new Date("2026-07-01T00:00:00Z");

describe("GET /stats/insights filters", () => {
  it("filters by sport (straight bets only — parlays excluded)", async () => {
    const user = await createProUser();
    await db.insert(betsTable).values([
      betRow(user.id, "NBA", RECENT),
      betRow(user.id, "NBA", RECENT, { missReason: "emotional" }),
      betRow(user.id, "NFL", RECENT, { missReason: "bad_price" }),
    ]);
    await db.insert(parlaysTable).values({
      userId: user.id,
      name: "Combo",
      stake: "50",
      odds: 264,
      potentialPayout: "182.00",
      confidenceScore: 5,
      status: "lost",
      actualPayout: "0.00",
      settledAt: RECENT,
      missReason: "normal_variance",
      whatHappened: "Parlay note",
    });

    const all = await request(app).get(`/api/stats/insights?userId=${user.id}`);
    expect(all.status).toBe(200);
    expect(all.body.lossesWithReason).toBe(4);

    const nba = await request(app).get(`/api/stats/insights?userId=${user.id}&sport=NBA`);
    expect(nba.status).toBe(200);
    expect(nba.body.lossesWithReason).toBe(2);
    const reasons = nba.body.missReasons.map((r: { reason: string }) => r.reason).sort();
    expect(reasons).toEqual(["bad_read", "emotional"]);
    // parlay note must not leak into a sport slice
    const notes = nba.body.recentNotes.map((n: { whatHappened: string }) => n.whatHappened);
    expect(notes.every((n: string) => n.includes("NBA"))).toBe(true);
  });

  it("filters by since date across bets and parlays", async () => {
    const user = await createProUser();
    await db.insert(betsTable).values([
      betRow(user.id, "NBA", OLD),
      betRow(user.id, "NBA", RECENT),
    ]);
    await db.insert(parlaysTable).values({
      userId: user.id,
      name: "Old combo",
      stake: "50",
      odds: 264,
      potentialPayout: "182.00",
      confidenceScore: 5,
      status: "lost",
      actualPayout: "0.00",
      settledAt: OLD,
      missReason: "bad_read",
      whatHappened: "Old parlay note",
    });

    const all = await request(app).get(`/api/stats/insights?userId=${user.id}`);
    expect(all.body.reviewedCount).toBe(3);

    const sliced = await request(app).get(`/api/stats/insights?userId=${user.id}&since=2026-06-01`);
    expect(sliced.status).toBe(200);
    expect(sliced.body.reviewedCount).toBe(1);
    expect(sliced.body.lossesWithReason).toBe(1);
    expect(sliced.body.recentNotes).toHaveLength(1);
    expect(sliced.body.recentNotes[0].whatHappened).toContain("2026-07-01");
  });

  it("combines sport and since", async () => {
    const user = await createProUser();
    await db.insert(betsTable).values([
      betRow(user.id, "NBA", OLD),
      betRow(user.id, "NBA", RECENT),
      betRow(user.id, "NFL", RECENT),
    ]);
    const res = await request(app).get(`/api/stats/insights?userId=${user.id}&sport=NBA&since=2026-06-01`);
    expect(res.status).toBe(200);
    expect(res.body.reviewedCount).toBe(1);
  });

  it("rejects an invalid since date with 400", async () => {
    const user = await createProUser();
    const bad = await request(app).get(`/api/stats/insights?userId=${user.id}&since=2026-02-30`);
    expect(bad.status).toBe(400);
    const garbage = await request(app).get(`/api/stats/insights?userId=${user.id}&since=nonsense`);
    expect(garbage.status).toBe(400);
  });

  it("returns empty aggregates for a sport with no bets", async () => {
    const user = await createProUser();
    await db.insert(betsTable).values([betRow(user.id, "NBA", RECENT)]);
    const res = await request(app).get(`/api/stats/insights?userId=${user.id}&sport=MLB`);
    expect(res.status).toBe(200);
    expect(res.body.reviewedCount).toBe(0);
    expect(res.body.missReasons).toEqual([]);
    expect(res.body.recentNotes).toEqual([]);
  });
});
