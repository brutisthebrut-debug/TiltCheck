/**
 * Integration tests for GET /api/bets and GET /api/parlays filtering,
 * search, and paging.
 *
 * These prove the server (not the client) does the work:
 *   - sport / sportsbook / status filters combine with AND semantics
 *   - `q` matches event/pick (bets) and name/leg event/pick (parlays),
 *     case-insensitively, with LIKE wildcards in the term treated literally
 *   - dateFrom/dateTo bound the game date (bets) / creation date (parlays)
 *   - limit/offset page through results in a stable order
 *
 * All rows are scoped to isolated test users (the list endpoints are
 * workspace-shared, so assertions always pin userId or a unique token).
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
  const username = `test_filter_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Filter Tester",
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return row;
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
    gameDate: "2026-07-01",
    confidenceScore: 5,
    ...overrides,
  };
}

describe("GET /api/bets filtering", () => {
  it("combines sport, sportsbook, status, q, and date range filters", async () => {
    const user = await createUser();
    const token = `zq${Date.now()}`; // unique search token, no wildcards

    await db.insert(betsTable).values([
      makeBet(user.id, { event: `${token} Chiefs vs Raiders`, sport: "NFL", sportsbook: "DraftKings", gameDate: "2026-06-10" }),
      makeBet(user.id, { event: `${token} Lakers vs Suns`, sport: "NBA", sportsbook: "FanDuel", gameDate: "2026-06-15" }),
      makeBet(user.id, { event: `${token} Yankees vs Sox`, sport: "MLB", sportsbook: "DraftKings", gameDate: "2026-06-20", status: "won" }),
    ]);

    // sport filter
    let res = await request(app).get("/api/bets").query({ userId: user.id, sport: "NBA" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].sport).toBe("NBA");

    // sportsbook filter
    res = await request(app).get("/api/bets").query({ userId: user.id, sportsbook: "DraftKings" });
    expect(res.body).toHaveLength(2);

    // combined: sportsbook AND status
    res = await request(app)
      .get("/api/bets")
      .query({ userId: user.id, sportsbook: "DraftKings", status: "won" });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].event).toContain("Yankees");

    // text search over event, case-insensitive
    res = await request(app).get("/api/bets").query({ q: `${token} LAKERS` });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].sport).toBe("NBA");

    // date range
    res = await request(app)
      .get("/api/bets")
      .query({ userId: user.id, dateFrom: "2026-06-12", dateTo: "2026-06-18" });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].gameDate).toBe("2026-06-15");
  });

  it("searches pick text and treats LIKE wildcards literally", async () => {
    const user = await createUser();
    const token = `wq${Date.now()}`;
    await db.insert(betsTable).values([
      makeBet(user.id, { pick: `Over 47.5 ${token}` }),
      makeBet(user.id, { pick: `100% legit ${token}x` }),
    ]);

    // pick is searched
    let res = await request(app).get("/api/bets").query({ q: `over 47.5 ${token}` });
    expect(res.body).toHaveLength(1);

    // "%" must not act as a wildcard
    res = await request(app).get("/api/bets").query({ q: `100% legit ${token}` });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].pick).toContain("100%");
  });

  it("pages with limit/offset in a stable order", async () => {
    const user = await createUser();
    await db.insert(betsTable).values(
      Array.from({ length: 5 }, (_, i) => makeBet(user.id, { event: `Page bet ${i}` }))
    );

    const page1 = await request(app).get("/api/bets").query({ userId: user.id, limit: 2, offset: 0 });
    const page2 = await request(app).get("/api/bets").query({ userId: user.id, limit: 2, offset: 2 });
    const page3 = await request(app).get("/api/bets").query({ userId: user.id, limit: 2, offset: 4 });

    expect(page1.body).toHaveLength(2);
    expect(page2.body).toHaveLength(2);
    expect(page3.body).toHaveLength(1);

    const ids = [...page1.body, ...page2.body, ...page3.body].map((b: { id: number }) => b.id);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("GET /api/parlays filtering", () => {
  async function createParlayWithLegs(
    userId: number,
    name: string,
    legs: Array<{ sport: string; event: string; pick: string }>,
    overrides: Partial<typeof parlaysTable.$inferInsert> = {}
  ) {
    const [parlay] = await db
      .insert(parlaysTable)
      .values({
        userId,
        name,
        stake: "50",
        odds: 264,
        potentialPayout: "182.00",
        confidenceScore: 3,
        ...overrides,
      })
      .returning();
    await db.insert(parlayLegsTable).values(
      legs.map((l) => ({
        parlayId: parlay.id,
        sport: l.sport,
        event: l.event,
        betType: "moneyline" as const,
        pick: l.pick,
        odds: -110,
        gameDate: "2026-07-01",
      }))
    );
    return parlay;
  }

  it("filters by leg sport and searches name and leg text", async () => {
    const user = await createUser();
    const token = `pq${Date.now()}`;

    await createParlayWithLegs(user.id, `${token} Sunday special`, [
      { sport: "NFL", event: "Chiefs vs Raiders", pick: "Chiefs ML" },
      { sport: "NBA", event: `Lakers vs Suns ${token}leg`, pick: "Lakers -3" },
    ]);
    await createParlayWithLegs(user.id, `${token} Puck line duo`, [
      { sport: "NHL", event: "Rangers vs Devils", pick: "Rangers ML" },
      { sport: "NHL", event: "Kraken vs Sharks", pick: "Over 5.5" },
    ]);

    // leg sport filter — parlay matches when any leg is in the sport
    let res = await request(app).get("/api/parlays").query({ userId: user.id, sport: "NBA" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toContain("Sunday special");

    // name search
    res = await request(app).get("/api/parlays").query({ q: `${token} puck line` });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toContain("Puck line");

    // leg event search
    res = await request(app).get("/api/parlays").query({ q: `${token}leg` });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toContain("Sunday special");
  });

  it("pages with limit/offset", async () => {
    const user = await createUser();
    for (let i = 0; i < 3; i++) {
      await createParlayWithLegs(user.id, `Paged parlay ${i}`, [
        { sport: "NFL", event: `Game ${i}`, pick: `Pick ${i}` },
        { sport: "NFL", event: `Game ${i}b`, pick: `Pick ${i}b` },
      ]);
    }

    const page1 = await request(app).get("/api/parlays").query({ userId: user.id, limit: 2, offset: 0 });
    const page2 = await request(app).get("/api/parlays").query({ userId: user.id, limit: 2, offset: 2 });
    expect(page1.body).toHaveLength(2);
    expect(page2.body).toHaveLength(1);
    const ids = [...page1.body, ...page2.body].map((p: { id: number }) => p.id);
    expect(new Set(ids).size).toBe(3);
  });
});
