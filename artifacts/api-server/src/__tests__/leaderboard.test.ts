/**
 * /workspace/leaderboard ranks the crew by settled results over a time
 * window. These tests prove:
 *  - only settled plays move the ranking (pending = inPlayCount only)
 *  - ranking order is profit desc among members with settled plays, and
 *    members with nothing settled sort below anyone with a record
 *  - the week window excludes old settles, all includes them
 *  - dead-zone-odds rows are excluded like the stats endpoints
 *  - flavor fields (streak, bestSport, favoriteMistake) are computed
 *
 * The dev DB may contain other users, so assertions filter the response to
 * the users created here and compare their relative order, never absolute
 * rank values.
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
import { db, pool, usersTable, betsTable, parlaysTable, crewsTable, crewMembersTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string) {
  const username = `test_lb_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return row;
}

// The board is crew-scoped now: multi-user assertions need the users to
// share a crew. The crew cascades away when its owner (a test user) is deleted.
async function putInOneCrew(userIds: number[]) {
  const [crew] = await db
    .insert(crewsTable)
    .values({
      name: `LB Test Crew ${Date.now()}_${counter++}`,
      ownerId: userIds[0],
      inviteCode: `LBT${Date.now().toString(36).toUpperCase()}${counter}`.slice(0, 16),
    })
    .returning();
  await db.insert(crewMembersTable).values(
    userIds.map((userId, i) => ({ crewId: crew.id, userId, role: i === 0 ? "owner" : "member" })),
  );
  return crew;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

function betRow(userId: number, odds: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    sport: "NBA",
    event: `Event ${counter++}`,
    betType: "moneyline",
    pick: "Home",
    odds,
    stake: "100",
    potentialPayout: "200.00",
    gameDate: "2026-07-01",
    confidenceScore: 5,
    status,
    actualPayout: status === "won" ? "200.00" : status === "lost" ? "0.00" : null,
    settledAt: status === "pending" ? null : new Date(),
    ...overrides,
  };
}

type Row = {
  rank: number;
  userId: number;
  wins: number;
  losses: number;
  profit: number;
  roi: number;
  settledCount: number;
  inPlayCount: number;
  currentStreak: number;
  currentStreakType: string;
  bestSport: string | null;
  favoriteMistake: string | null;
  calibrationScore: number | null;
  postmortemRate: number | null;
  soundRate: number | null;
};

async function fetchMine(ids: number[], period?: string): Promise<Row[]> {
  const res = await request(app).get(
    `/api/workspace/leaderboard${period ? `?period=${period}` : ""}`,
  );
  expect(res.status).toBe(200);
  return (res.body as Row[]).filter((r) => ids.includes(r.userId));
}

describe("GET /workspace/leaderboard", () => {
  it("ranks settled profit, counts pending as in-play only, and idle members sort last", async () => {
    const winner = await createUser("Winner");
    const loser = await createUser("Loser");
    const idle = await createUser("Idle");
    await putInOneCrew([winner.id, loser.id, idle.id]);

    await db.insert(betsTable).values([
      // winner: +150 profit settled, plus one pending that must not count
      betRow(winner.id, 150, "won", { actualPayout: "250.00" }),
      betRow(winner.id, -110, "pending"),
      // loser: -100 settled
      betRow(loser.id, -110, "lost"),
      // idle: pending only
      betRow(idle.id, 120, "pending"),
    ]);

    const rows = await fetchMine([winner.id, loser.id, idle.id]);
    expect(rows.map((r) => r.userId)).toEqual([winner.id, loser.id, idle.id]);

    const w = rows[0];
    expect(w.profit).toBe(150);
    expect(w.wins).toBe(1);
    expect(w.settledCount).toBe(1);
    expect(w.inPlayCount).toBe(1);
    expect(w.roi).toBe(150);

    const l = rows[1];
    expect(l.profit).toBe(-100);

    // idle has no settled plays: sorts below the loser despite profit 0 > -100
    const i = rows[2];
    expect(i.settledCount).toBe(0);
    expect(i.inPlayCount).toBe(1);
    expect(i.profit).toBe(0);

    // ranks are strictly increasing in returned order
    expect(w.rank).toBeLessThan(l.rank);
    expect(l.rank).toBeLessThan(i.rank);
  });

  it("week window excludes old settles that all-time includes", async () => {
    const user = await createUser("Windowed");
    await db.insert(betsTable).values([
      // settled 30+ days ago — outside week, inside all
      betRow(user.id, 150, "won", {
        actualPayout: "250.00",
        settledAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      }),
      // settled now — inside both
      betRow(user.id, -110, "lost"),
    ]);

    const [allRow] = await fetchMine([user.id], "all");
    expect(allRow.settledCount).toBe(2);
    expect(allRow.profit).toBe(50);

    const [weekRow] = await fetchMine([user.id], "week");
    expect(weekRow.settledCount).toBe(1);
    expect(weekRow.profit).toBe(-100);
  });

  it("excludes dead-zone odds rows and fills flavor fields", async () => {
    const user = await createUser("Flavor");
    await db.insert(betsTable).values([
      // corrupted legacy row: dead-zone odds, absurd payout — must be ignored
      betRow(user.id, 50, "won", { actualPayout: "9000.00" }),
      // two straight wins in NFL -> 2W streak, bestSport NFL
      betRow(user.id, 150, "won", { actualPayout: "250.00", sport: "NFL" }),
      betRow(user.id, 130, "won", { actualPayout: "230.00", sport: "NFL" }),
      // two losses tagged emotional earlier (before the wins) -> favoriteMistake
      betRow(user.id, -110, "lost", {
        missReason: "emotional",
        settledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      }),
      betRow(user.id, -110, "lost", {
        missReason: "emotional",
        settledAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }),
    ]);

    const [row] = await fetchMine([user.id], "all");
    expect(row.settledCount).toBe(4); // corrupted row excluded
    expect(row.wins).toBe(2);
    expect(row.losses).toBe(2);
    expect(row.profit).toBe(80); // (250-100) + (230-100) + (0-100) + (0-100)
    expect(row.currentStreakType).toBe("win");
    expect(row.currentStreak).toBe(2);
    expect(row.bestSport).toBe("NFL");
    expect(row.favoriteMistake).toBe("emotional");
  });

  it("computes decision-quality metrics from journaled settled plays", async () => {
    const user = await createUser("Sharp");
    await db.insert(betsTable).values([
      // won at confidence 8 -> squared error 0.04; graded sound (reviewed)
      betRow(user.id, 150, "won", { actualPayout: "250.00", confidenceScore: 8, reasoningQuality: "sound" }),
      // lost at confidence 6 -> squared error 0.36; graded flawed (reviewed)
      betRow(user.id, -110, "lost", { confidenceScore: 6, reasoningQuality: "flawed" }),
      // push — excluded from calibration; "na" reason + whitespace notes is NOT a review
      betRow(user.id, -110, "push", { actualPayout: "100.00", confidenceScore: 9, missReason: "na", whatHappened: "   " }),
      // lost at confidence 5 -> squared error 0.25; reviewed via miss reason alone
      betRow(user.id, -110, "lost", { confidenceScore: 5, missReason: "bad_read" }),
    ]);

    const [row] = await fetchMine([user.id], "all");
    // brier = (0.04 + 0.36 + 0.25) / 3 -> score (1 - 0.21667) * 100 = 78.3
    expect(row.calibrationScore).toBe(78.3);
    // 3 of 4 settled plays reviewed
    expect(row.postmortemRate).toBe(75);
    // 2 graded, 1 sound
    expect(row.soundRate).toBe(50);
  });

  it("decision-quality metrics are null with nothing settled and honor the window", async () => {
    const user = await createUser("NullMetrics");
    await db.insert(betsTable).values([
      betRow(user.id, 120, "pending"),
      // fully journaled win, settled 31 days ago — outside week, inside all
      betRow(user.id, 150, "won", {
        actualPayout: "250.00",
        confidenceScore: 10,
        reasoningQuality: "sound",
        settledAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      }),
    ]);

    const [weekRow] = await fetchMine([user.id], "week");
    expect(weekRow.calibrationScore).toBeNull();
    expect(weekRow.postmortemRate).toBeNull();
    expect(weekRow.soundRate).toBeNull();

    const [allRow] = await fetchMine([user.id], "all");
    expect(allRow.calibrationScore).toBe(100); // confidence 10, won -> perfect
    expect(allRow.postmortemRate).toBe(100);
    expect(allRow.soundRate).toBe(100);
  });

  it("rejects an invalid period", async () => {
    await createUser("BadQuery");
    const res = await request(app).get("/api/workspace/leaderboard?period=fortnight");
    expect(res.status).toBe(400);
  });

  it("returns 403 for a signed-in account with no linked bettor profile", async () => {
    currentClerkUserId = `clerk_unlinked_${Date.now()}`;
    const res = await request(app).get("/api/workspace/leaderboard");
    expect(res.status).toBe(403);
  });
});
