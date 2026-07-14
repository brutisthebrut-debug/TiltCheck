import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { computeWeeklyRecap, mondayOf, lastCompletedWeekStart } from "../lib/recap";

// ── Pure week math ──────────────────────────────────────────────────────────

describe("week math", () => {
  it("snaps any date to its Monday (UTC)", () => {
    expect(mondayOf("2026-07-14")).toBe("2026-07-13"); // Tuesday → Monday
    expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // Monday stays
    expect(mondayOf("2026-07-12")).toBe("2026-07-06"); // Sunday belongs to prior Monday
  });

  it("last completed week is the Monday before this week's Monday", () => {
    expect(lastCompletedWeekStart("2026-07-14")).toBe("2026-07-06");
    expect(lastCompletedWeekStart("2026-07-13")).toBe("2026-07-06"); // fresh Monday: last week just ended
  });
});

// ── Pure recap engine ───────────────────────────────────────────────────────

const USERS = [
  { id: 1, displayName: "Ari" },
  { id: 2, displayName: "Bo" },
];
const WEEK = "2026-07-06"; // Mon Jul 6 – Sun Jul 12

let seq = 1;
function bet(over: Partial<Parameters<typeof computeWeeklyRecap>[0]["bets"][0]> = {}) {
  return {
    id: seq++,
    userId: 1,
    status: "won",
    odds: -110,
    stake: "100",
    actualPayout: "190.91",
    missReason: null,
    createdAt: new Date("2026-07-07T12:00:00Z"),
    settledAt: new Date("2026-07-08T02:00:00Z"),
    pick: "Celtics -3",
    event: "Celtics @ Knicks",
    sport: "NBA",
    ...over,
  };
}
function parlay(over: Partial<Parameters<typeof computeWeeklyRecap>[0]["parlays"][0]> = {}) {
  return {
    id: seq++,
    userId: 1,
    status: "lost",
    odds: 450,
    stake: "50",
    actualPayout: "0",
    missReason: null,
    createdAt: new Date("2026-07-07T12:00:00Z"),
    settledAt: new Date("2026-07-09T02:00:00Z"),
    name: "Thursday special",
    ...over,
  };
}
const recap = (bets: ReturnType<typeof bet>[], parlays: ReturnType<typeof parlay>[] = [], userId = 1) =>
  computeWeeklyRecap({ users: USERS, bets, parlays, userId, weekStart: WEEK });

describe("computeWeeklyRecap", () => {
  beforeEach(() => { seq = 1; });

  it("only counts plays settled inside the week", () => {
    const inside = bet();
    const before = bet({ settledAt: new Date("2026-07-05T23:59:00Z") });
    const after = bet({ settledAt: new Date("2026-07-13T00:00:00Z") });
    const pending = bet({ status: "pending", settledAt: null, actualPayout: null });
    const r = recap([inside, before, after, pending]);
    expect(r.personal.settledCount).toBe(1);
    expect(r.personal.wins).toBe(1);
    expect(r.personal.profit).toBeCloseTo(90.91, 2);
  });

  it("empty week produces zeros and nulls, not crashes", () => {
    const r = recap([]);
    expect(r.personal.settledCount).toBe(0);
    expect(r.personal.loggedCount).toBe(0);
    expect(r.personal.bestWin).toBeNull();
    expect(r.personal.worstBeat).toBeNull();
    expect(r.personal.leak).toBeNull();
    expect(r.crew.winner).toBeNull();
    expect(r.crew.biggestUpset).toBeNull();
    expect(r.crew.worstBeat).toBeNull();
  });

  it("finds best win and worst beat, skipping dead-zone odds rows", () => {
    const small = bet({ actualPayout: "150", stake: "100" });
    const big = bet({ actualPayout: "400", stake: "100", pick: "Jets ML" });
    const beat = bet({ status: "lost", actualPayout: "0", stake: "200", pick: "Under 44" });
    const deadZone = bet({ odds: 50, actualPayout: "9999", stake: "1" }); // impossible price → ignored
    const r = recap([small, big, beat, deadZone]);
    expect(r.personal.bestWin?.title).toContain("Jets ML");
    expect(r.personal.bestWin?.amount).toBe(300);
    expect(r.personal.worstBeat?.title).toContain("Under 44");
    expect(r.personal.worstBeat?.amount).toBe(-200);
  });

  it("names the most expensive leak — worst sport beats a cheaper miss reason", () => {
    const nbaLoss1 = bet({ status: "lost", actualPayout: "0", stake: "150" });
    const nbaLoss2 = bet({ status: "lost", actualPayout: "0", stake: "150" });
    const nflLoss = bet({ status: "lost", actualPayout: "0", stake: "50", sport: "NFL", missReason: "emotional" });
    const r = recap([nbaLoss1, nbaLoss2, nflLoss]);
    expect(r.personal.leak).toEqual({ kind: "sport", label: "NBA", amount: -300, count: 2 });
  });

  it("parlays become the leak when they cost the most", () => {
    const p1 = parlay({ stake: "200" });
    const p2 = parlay({ stake: "150" });
    const nbaWin = bet();
    const r = recap([nbaWin], [p1, p2]);
    expect(r.personal.leak).toEqual({ kind: "parlays", label: "parlays", amount: -350, count: 2 });
  });

  it("normal_variance and na never count as a leak reason", () => {
    const l1 = bet({ status: "lost", actualPayout: "0", missReason: "normal_variance", stake: "100" });
    const r = recap([l1]);
    expect(r.personal.leak?.kind).toBe("sport"); // falls back to the sport bucket
  });

  it("crew: winner by profit, biggest upset by highest winning plus-odds, worst beat by biggest loss", () => {
    const ariWin = bet({ actualPayout: "190.91", stake: "100" }); // +90.91
    const boUpset = bet({ userId: 2, odds: 320, actualPayout: "420", stake: "100", pick: "Dog ML" }); // +320
    const boBeat = bet({ userId: 2, status: "lost", actualPayout: "0", stake: "500", pick: "Lock of the week" });
    const r = recap([ariWin, boUpset, boBeat]);
    expect(r.crew.winner?.userName).toBe("Ari"); // Bo netted -180
    expect(r.crew.biggestUpset?.userName).toBe("Bo");
    expect(r.crew.biggestUpset?.odds).toBe(320);
    expect(r.crew.worstBeat?.amount).toBe(-500);
    expect(r.crew.worstBeat?.userName).toBe("Bo");
  });

  it("favorite wins don't qualify as upsets", () => {
    const favWin = bet({ odds: -300, actualPayout: "133", stake: "100" });
    const r = recap([favWin]);
    expect(r.crew.biggestUpset).toBeNull();
  });
});

// ── Endpoint ────────────────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => ({ userId: "clerk_test_user" }),
}));

import app from "../app";
import { db, usersTable, betsTable } from "@workspace/db";

let counter = 0;
async function createUser(displayName = "Recap Tester") {
  const [u] = await db
    .insert(usersTable)
    .values({
      username: `test_recap_${counter++}`,
      displayName,
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId: "clerk_test_user",
    })
    .returning();
  return u;
}

describe("GET /stats/recap", () => {
  beforeEach(async () => {
    const { parlayLegsTable, parlaysTable, transactionsTable, userBadgesTable } = await import("@workspace/db");
    await db.delete(parlayLegsTable);
    await db.delete(parlaysTable);
    await db.delete(betsTable);
    await db.delete(transactionsTable);
    await db.delete(userBadgesTable);
    await db.delete(usersTable);
  });

  it("defaults to the signed-in bettor and last completed week", async () => {
    const user = await createUser();
    const res = await request(app).get("/api/stats/recap");
    expect(res.status).toBe(200);
    expect(res.body.personal.userId).toBe(user.id);
    // weekStart is a Monday and the week has fully ended
    expect(new Date(`${res.body.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(res.body.weekEnd > res.body.weekStart).toBe(true);
  });

  it("snaps weekStart to Monday and computes settled facts", async () => {
    const user = await createUser();
    await db.insert(betsTable).values({
      userId: user.id,
      sport: "NBA",
      event: "Celtics @ Knicks",
      pick: "Celtics -3",
      betType: "spread",
      odds: -110,
      stake: "100",
      potentialPayout: "190.91",
      actualPayout: "190.91",
      confidenceScore: 7,
      sportsbook: "Test",
      gameDate: "2026-07-07",
      status: "won",
      settledAt: new Date("2026-07-08T02:00:00Z"),
    });
    const res = await request(app).get("/api/stats/recap?weekStart=2026-07-09"); // Thursday → snaps to 7/6
    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe("2026-07-06");
    expect(res.body.weekEnd).toBe("2026-07-12");
    expect(res.body.personal.wins).toBe(1);
    expect(res.body.personal.profit).toBeCloseTo(90.91, 2);
    expect(res.body.crew.winner.userId).toBe(user.id);
  });

  it("rejects unfinished weeks and garbage dates", async () => {
    await createUser();
    const future = await request(app).get("/api/stats/recap?weekStart=2099-01-04");
    expect(future.status).toBe(400);
    const garbage = await request(app).get("/api/stats/recap?weekStart=2026-02-31");
    expect(garbage.status).toBe(400);
  });
});
