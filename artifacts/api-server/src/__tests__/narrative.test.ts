import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { assembleRecapFacts } from "../lib/narrative";
import { computeWeeklyRecap } from "../lib/recap";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => ({ userId: "clerk_test_user" }),
}));

// The AI provider is mocked — tests never hit the network. `generateMock`
// stands in for openai.chat.completions.create.
const generateMock = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => generateMock(...args) } } },
}));

import app from "../app";
import { db, usersTable, betsTable, parlaysTable, recapNarrativesTable } from "@workspace/db";

const WEEK = "2026-07-06"; // Mon Jul 6 – Sun Jul 12

let seq = 1;
function betRow(over: Record<string, unknown> = {}) {
  return {
    id: seq++,
    userId: 1,
    status: "won",
    odds: -110,
    stake: "100",
    actualPayout: "190.91",
    missReason: null,
    confidenceScore: 8,
    createdAt: new Date("2026-07-07T12:00:00Z"),
    settledAt: new Date("2026-07-08T02:00:00Z"),
    pick: "Celtics -3",
    event: "Celtics @ Knicks",
    sport: "NBA",
    ...over,
  };
}

// ── Fact assembly (pure) ─────────────────────────────────────────────────────

describe("assembleRecapFacts", () => {
  const users = [{ id: 1, displayName: "Ari" }];

  function facts(bets: ReturnType<typeof betRow>[], parlays: Record<string, unknown>[] = []) {
    const recap = computeWeeklyRecap({
      users,
      bets: bets as never,
      parlays: parlays as never,
      userId: 1,
      weekStart: WEEK,
    });
    return assembleRecapFacts({
      displayName: "Ari",
      recap,
      myBets: bets as never,
      myParlays: parlays as never,
    });
  }

  it("carries the recap numbers through verbatim", () => {
    const f = facts([
      betRow(), // +90.91
      betRow({ status: "lost", actualPayout: "0", stake: "50" }), // -50
    ]);
    expect(f.record).toEqual({ wins: 1, losses: 1, pushes: 0 });
    expect(f.profit).toBe(40.91);
    expect(f.totalWagered).toBe(150);
    expect(f.displayName).toBe("Ari");
    expect(f.weekStart).toBe(WEEK);
  });

  it("computes stake sizing after a loss from settle order", () => {
    const f = facts([
      betRow({ status: "lost", actualPayout: "0", stake: "50", settledAt: new Date("2026-07-07T02:00:00Z") }),
      // settled 10h after the loss — counts as an after-loss play
      betRow({ stake: "200", actualPayout: "381.82", settledAt: new Date("2026-07-07T12:00:00Z") }),
      // settled 3 days later — not chasing
      betRow({ stake: "100", settledAt: new Date("2026-07-10T12:00:00Z") }),
    ]);
    expect(f.stakeSizing?.playsAfterLoss).toBe(1);
    expect(f.stakeSizing?.avgStakeAfterLoss).toBe(200);
    expect(f.stakeSizing?.avgStake).toBeCloseTo(116.67, 1);
  });

  it("buckets confidence vs. outcome and sport concentration", () => {
    const f = facts([
      betRow({ confidenceScore: 9, status: "won" }),
      betRow({ confidenceScore: 8, status: "lost", actualPayout: "0" }),
      betRow({ confidenceScore: 3, status: "won", sport: "MLB", stake: "20", actualPayout: "38.18" }),
    ]);
    expect(f.confidenceCheck?.highConfidence).toEqual({ count: 2, wins: 1 });
    expect(f.confidenceCheck?.lowConfidence).toEqual({ count: 1, wins: 1 });
    expect(f.sportMix[0].sport).toBe("NBA");
    expect(f.sportMix[0].plays).toBe(2);
    expect(f.sportMix.find((s) => s.sport === "MLB")?.profit).toBe(18.18);
  });

  it("never counts pending plays or plays outside the week", () => {
    const f = facts([
      betRow({ status: "pending", actualPayout: null, settledAt: null }),
      betRow({ settledAt: new Date("2026-07-20T02:00:00Z") }), // next week
    ]);
    expect(f.playsSettled).toBe(0);
    expect(f.stakeSizing).toBeNull();
  });
});

// ── Endpoint: caching, quiet week, failure path ─────────────────────────────

let counter = 0;
async function createUser(displayName = "Narrative Tester") {
  const [u] = await db
    .insert(usersTable)
    .values({
      username: `test_narr_${counter++}_${Date.now()}`,
      displayName,
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId: "clerk_test_user",
    })
    .returning();
  return u;
}

async function addSettledBet(userId: number) {
  await db.insert(betsTable).values({
    userId,
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
    createdAt: new Date("2026-07-07T12:00:00Z"),
    settledAt: new Date("2026-07-08T02:00:00Z"),
  });
}

describe("GET /stats/recap/narrative", () => {
  beforeEach(async () => {
    generateMock.mockReset();
    generateMock.mockResolvedValue({
      choices: [{ message: { content: "You went 1-0. Nice tape.\n\nWatch next week: your stake sizing." } }],
    });
    const { parlayLegsTable, transactionsTable, userBadgesTable } = await import("@workspace/db");
    await db.delete(recapNarrativesTable);
    await db.delete(parlayLegsTable);
    await db.delete(parlaysTable);
    await db.delete(betsTable);
    await db.delete(transactionsTable);
    await db.delete(userBadgesTable);
    await db.delete(usersTable);
  });

  it("generates once, then serves the stored narrative on repeat views", async () => {
    const user = await createUser();
    await addSettledBet(user.id);

    const first = await request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`);
    expect(first.status).toBe(200);
    expect(first.body.weekStart).toBe(WEEK);
    expect(first.body.narrative).toMatch(/Watch next week/);
    expect(generateMock).toHaveBeenCalledTimes(1);

    const second = await request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`);
    expect(second.status).toBe(200);
    expect(second.body.narrative).toBe(first.body.narrative);
    expect(generateMock).toHaveBeenCalledTimes(1); // cache hit — no second generation

    const rows = await db.select().from(recapNarrativesTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(user.id);
    expect(rows[0].weekStart).toBe(WEEK);
  });

  it("the model only receives computed facts — never raw bet rows", async () => {
    const user = await createUser();
    await addSettledBet(user.id);
    await request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`);

    const [params] = generateMock.mock.calls[0] as [
      { messages: { role: string; content: string }[] },
    ];
    const userMessage = params.messages.find((m) => m.role === "user")!.content;
    // Computed facts are present…
    expect(userMessage).toContain('"wins": 1');
    expect(userMessage).toContain('"totalWagered": 100');
    // …raw row fields are not
    expect(userMessage).not.toContain("potentialPayout");
    expect(userMessage).not.toContain("gameDate");
    expect(userMessage).not.toContain("sportsbook");
  });

  it("returns null without generating for a quiet week", async () => {
    await createUser();
    const res = await request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body.narrative).toBeNull();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("degrades to null when generation fails — and caches nothing", async () => {
    const user = await createUser();
    await addSettledBet(user.id);
    generateMock.mockRejectedValue(new Error("provider down"));

    const res = await request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`);
    expect(res.status).toBe(200);
    expect(res.body.narrative).toBeNull();
    expect(await db.select().from(recapNarrativesTable)).toHaveLength(0);

    // The numeric recap is untouched by the failure
    const recap = await request(app).get(`/api/stats/recap?weekStart=${WEEK}`);
    expect(recap.status).toBe(200);
    expect(recap.body.personal.wins).toBe(1);

    // Next view retries generation (failure was not cached)
    generateMock.mockResolvedValue({
      choices: [{ message: { content: "Back online. Watch next week: nothing." } }],
    });
    const retry = await request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`);
    expect(retry.body.narrative).toMatch(/Back online/);
    expect(await db.select().from(recapNarrativesTable)).toHaveLength(1);
    void user;
  });

  it("concurrent first views share a single generation", async () => {
    const user = await createUser();
    await addSettledBet(user.id);
    let release!: (v: unknown) => void;
    generateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    // supertest requests are lazy — calling .then() starts them in flight.
    const a = request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`).then((r) => r);
    const b = request(app).get(`/api/stats/recap/narrative?weekStart=${WEEK}`).then((r) => r);
    // Let both requests reach the generation step before releasing the model.
    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    release({ choices: [{ message: { content: "One tape, two viewers. Watch next week: sharing." } }] });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.body.narrative).toBe(rb.body.narrative);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(await db.select().from(recapNarrativesTable)).toHaveLength(1);
  });

  it("rejects unfinished weeks like the recap does", async () => {
    await createUser();
    const res = await request(app).get(`/api/stats/recap/narrative?weekStart=2027-01-04`);
    expect(res.status).toBe(400);
  });
});
