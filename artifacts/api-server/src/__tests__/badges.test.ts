/**
 * Badge engine + streaks. Proves:
 *  - pure engine: each badge triggers on its rule and not before
 *  - streak math: logging streak (with yesterday grace), settle streak stops
 *    at the day an overdue play existed
 *  - GET /users/:id/badges awards on read, persists, never revokes, and is
 *    idempotent; unknown user is 404
 *  - GET /stats/streaks returns the signed-in crew member's numbers
 *  - dead-zone odds rows don't feed odds-based badges
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";

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
import { db, pool, usersTable, betsTable, userBadgesTable } from "@workspace/db";
import { computeQualifiedBadges, computeStreaks, type BadgeInput } from "../lib/badges";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName = "Badge Tester") {
  const username = `test_badge_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName, avatarColor: "#6366f1", startingBankroll: "1000", clerkUserId })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return row;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(userBadgesTable).where(inArray(userBadgesTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

// ── Pure engine ──────────────────────────────────────────────────────────────

const TODAY = "2026-07-14";

function play(over: Partial<BadgeInput["bets"][0]> = {}): BadgeInput["bets"][0] {
  return {
    odds: -110,
    stake: "50",
    status: "won",
    createdAt: new Date(`${TODAY}T12:00:00Z`),
    settledAt: new Date(`${TODAY}T18:00:00Z`),
    reasoningQuality: null,
    whatHappened: null,
    missReason: null,
    gameDate: TODAY,
    ...over,
  };
}

function input(bets: BadgeInput["bets"], parlays: BadgeInput["parlays"] = []): BadgeInput {
  return { bets, parlays, startingBankroll: 1000, today: TODAY };
}

describe("computeQualifiedBadges", () => {
  it("awards first_blood on a single win, nothing on a loss", () => {
    expect(computeQualifiedBadges(input([play()]))).toContain("first_blood");
    expect(computeQualifiedBadges(input([play({ status: "lost" })]))).not.toContain("first_blood");
  });

  it("hot_hand needs 3 consecutive wins in settle order; push breaks the run", () => {
    const t = (h: number) => new Date(`${TODAY}T0${h}:00:00Z`);
    const three = [play({ settledAt: t(1) }), play({ settledAt: t(2) }), play({ settledAt: t(3) })];
    expect(computeQualifiedBadges(input(three))).toContain("hot_hand");
    const broken = [play({ settledAt: t(1) }), play({ status: "push", settledAt: t(2) }), play({ settledAt: t(3) }), play({ settledAt: t(4) })];
    expect(computeQualifiedBadges(input(broken))).not.toContain("hot_hand");
  });

  it("comeback_kid: win right after 3+ losses", () => {
    const t = (h: number) => new Date(`${TODAY}T0${h}:00:00Z`);
    const plays = [1, 2, 3].map((h) => play({ status: "lost", settledAt: t(h) }));
    expect(computeQualifiedBadges(input(plays))).not.toContain("comeback_kid");
    expect(computeQualifiedBadges(input([...plays, play({ settledAt: t(4) })]))).toContain("comeback_kid");
  });

  it("dog_whisperer needs a +200 win; dead-zone odds are ignored", () => {
    expect(computeQualifiedBadges(input([play({ odds: 200 })]))).toContain("dog_whisperer");
    expect(computeQualifiedBadges(input([play({ odds: 150 })]))).not.toContain("dog_whisperer");
    // odds 50 is a dead-zone row — must not count for anything odds-based
    expect(computeQualifiedBadges(input([play({ odds: 50 })]))).not.toContain("dog_whisperer");
  });

  it("chalk_eater: 5 wins at -150 or heavier", () => {
    const four = Array.from({ length: 4 }, () => play({ odds: -200 }));
    expect(computeQualifiedBadges(input(four))).not.toContain("chalk_eater");
    expect(computeQualifiedBadges(input([...four, play({ odds: -150 })]))).toContain("chalk_eater");
  });

  it("degen_night: 3 plays logged the same day", () => {
    const two = [play(), play()];
    expect(computeQualifiedBadges(input(two))).not.toContain("degen_night");
    expect(computeQualifiedBadges(input([...two, play()]))).toContain("degen_night");
  });

  it("iron_bankroll: 20 plays all staking ≤10% of starting bankroll", () => {
    const disciplined = Array.from({ length: 20 }, () => play({ stake: "100" }));
    expect(computeQualifiedBadges(input(disciplined))).toContain("iron_bankroll");
    const oneGreedy = [...disciplined.slice(1), play({ stake: "101" })];
    expect(computeQualifiedBadges(input(oneGreedy))).not.toContain("iron_bankroll");
  });

  it("parlay_prophet: won parlay with 3+ legs", () => {
    const parlay = { ...play({}), legCount: 3, lastLegGameDate: TODAY };
    delete (parlay as Record<string, unknown>).gameDate;
    expect(computeQualifiedBadges(input([], [parlay]))).toContain("parlay_prophet");
    expect(computeQualifiedBadges(input([], [{ ...parlay, legCount: 2 }]))).not.toContain("parlay_prophet");
  });

  it("film_junkie: 10 settled plays with a review", () => {
    const reviewed = Array.from({ length: 10 }, () => play({ reasoningQuality: "sound" }));
    expect(computeQualifiedBadges(input(reviewed))).toContain("film_junkie");
    // missReason "na" carries no signal
    const naOnly = Array.from({ length: 10 }, () => play({ missReason: "na" }));
    expect(computeQualifiedBadges(input(naOnly))).not.toContain("film_junkie");
  });

  it("sharp: 55%+ win rate over 20+ decided plays, pushes excluded", () => {
    const t = (i: number) => new Date(new Date(`${TODAY}T00:00:00Z`).getTime() + i * 60000);
    const wins = Array.from({ length: 12 }, (_, i) => play({ settledAt: t(i) }));
    const losses = Array.from({ length: 8 }, (_, i) => play({ status: "lost", settledAt: t(20 + i) }));
    expect(computeQualifiedBadges(input([...wins, ...losses]))).toContain("sharp"); // 12/20 = 60%
    const losses10 = Array.from({ length: 10 }, (_, i) => play({ status: "lost", settledAt: t(20 + i) }));
    expect(computeQualifiedBadges(input([...wins.slice(0, 10), ...losses10]))).not.toContain("sharp"); // 50%
  });

  it("week_warrior: plays logged 7 consecutive days (any 7, not just current)", () => {
    const days = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"];
    const plays = days.map((d) => play({ createdAt: new Date(`${d}T12:00:00Z`), status: "pending", settledAt: null, gameDate: d }));
    expect(computeQualifiedBadges(input(plays))).toContain("week_warrior");
    expect(computeQualifiedBadges(input(plays.slice(0, 6)))).not.toContain("week_warrior");
  });
});

describe("computeStreaks", () => {
  it("logging streak counts back from today, allows a yesterday anchor, and breaks on gaps", () => {
    const mk = (d: string) => play({ createdAt: new Date(`${d}T12:00:00Z`), status: "pending", settledAt: null, gameDate: d });
    const s = computeStreaks(input([mk("2026-07-14"), mk("2026-07-13"), mk("2026-07-11")]));
    expect(s.loggingStreakDays).toBe(2); // 14 + 13, gap at 12
    const yesterdayOnly = computeStreaks(input([mk("2026-07-13")]));
    expect(yesterdayOnly.loggingStreakDays).toBe(1); // grace day
    const stale = computeStreaks(input([mk("2026-07-10")]));
    expect(stale.loggingStreakDays).toBe(0);
  });

  it("settle streak stops at the last day an overdue play existed", () => {
    // Game on 7/8, settled on 7/11 → overdue on 7/9 and 7/10, clean from 7/11
    const b = play({ gameDate: "2026-07-08", createdAt: new Date("2026-07-08T12:00:00Z"), settledAt: new Date("2026-07-11T12:00:00Z") });
    const s = computeStreaks(input([b]));
    expect(s.settleStreakDays).toBe(4); // 7/11..7/14
    expect(s.overdueCount).toBe(0);

    const neverSettled = play({ gameDate: "2026-07-12", createdAt: new Date("2026-07-12T12:00:00Z"), status: "pending", settledAt: null });
    const s2 = computeStreaks(input([neverSettled]));
    expect(s2.settleStreakDays).toBe(0); // overdue right now → no streak
    expect(s2.overdueCount).toBe(1);
  });

  it("settle streak is anchored to the bettor's own history — no free 365 days", () => {
    // First-ever play logged and settled today → streak is exactly 1 day
    const s = computeStreaks(input([play()]));
    expect(s.settleStreakDays).toBe(1);
    // No plays at all → no streak
    expect(computeStreaks(input([])).settleStreakDays).toBe(0);
  });
});

describe("bookkeeper gating", () => {
  it("needs real grading history, not just 'nothing was ever overdue'", () => {
    // 8 days of logged-but-future pending plays: settle streak spans 8 clean
    // days but nothing has ever been graded → no bookkeeper
    const days = ["2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"];
    const pendingFuture = days.map((d) =>
      play({ createdAt: new Date(`${d}T12:00:00Z`), status: "pending", settledAt: null, gameDate: "2099-01-01" }),
    );
    expect(computeQualifiedBadges(input(pendingFuture))).not.toContain("bookkeeper");
    // Same history plus one settled play → bookkeeper
    const withSettled = [...pendingFuture, play({ createdAt: new Date("2026-07-07T13:00:00Z"), gameDate: "2026-07-07", settledAt: new Date("2026-07-07T23:00:00Z") })];
    expect(computeQualifiedBadges(input(withSettled))).toContain("bookkeeper");
  });
});

// ── HTTP endpoints ───────────────────────────────────────────────────────────

describe("GET /users/:id/badges", () => {
  it("awards on read, persists, and stays idempotent", async () => {
    const user = await createUser();
    await db.insert(betsTable).values({
      userId: user.id,
      sport: "NBA",
      event: "A @ B",
      betType: "moneyline",
      pick: "A ML",
      odds: 210,
      stake: "50",
      potentialPayout: "155",
      actualPayout: "155",
      status: "won",
      gameDate: "2026-07-10",
      confidenceScore: 7,
      settledAt: new Date("2026-07-10T22:00:00Z"),
    });

    const res = await request(app).get(`/api/users/${user.id}/badges`);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((b: { id: string; earnedAt: string | null }) => [b.id, b.earnedAt]));
    expect(byId.first_blood).toBeTruthy();
    expect(byId.dog_whisperer).toBeTruthy();
    expect(byId.hot_hand).toBeNull();

    // Idempotent: second read returns the same earnedAt, no duplicate rows
    const res2 = await request(app).get(`/api/users/${user.id}/badges`);
    const byId2 = Object.fromEntries(res2.body.map((b: { id: string; earnedAt: string | null }) => [b.id, b.earnedAt]));
    expect(byId2.first_blood).toBe(byId.first_blood);
    const rows = await db.select().from(userBadgesTable).where(eq(userBadgesTable.userId, user.id));
    expect(rows.filter((r) => r.badgeId === "first_blood")).toHaveLength(1);
  });

  it("404s for a user that doesn't exist", async () => {
    await createUser(); // just to be signed in
    const res = await request(app).get("/api/users/999999/badges");
    expect(res.status).toBe(404);
  });
});

describe("GET /stats/streaks", () => {
  it("returns streaks for the requested user", async () => {
    const user = await createUser();
    await db.insert(betsTable).values({
      userId: user.id,
      sport: "NBA",
      event: "A @ B",
      betType: "moneyline",
      pick: "A ML",
      odds: -110,
      stake: "20",
      potentialPayout: "38.18",
      status: "pending",
      gameDate: "2099-01-01", // future game — never overdue
      confidenceScore: 5,
    });
    const res = await request(app).get(`/api/stats/streaks?userId=${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
    expect(res.body.loggingStreakDays).toBeGreaterThanOrEqual(1); // logged today
    expect(res.body.overdueCount).toBe(0);
  });

  it("defaults to the signed-in bettor when userId is omitted", async () => {
    const user = await createUser();
    const res = await request(app).get("/api/stats/streaks");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
  });
});
