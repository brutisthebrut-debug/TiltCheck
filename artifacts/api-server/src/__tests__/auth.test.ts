/**
 * Auth boundary tests for the Clerk-backed identity model:
 *   - unauthenticated requests are rejected with 401
 *   - signed-in-but-unlinked accounts: /users/me 404, writes 403, claim flow
 *   - claim conflicts: already-claimed profile → 409, double fresh-claim is idempotent
 *   - cross-user writes and private reads (bankroll) are rejected with 403
 *
 * Read scope is intentionally split for the two-tester workspace:
 * bets/parlays/stats reads are shared (head-to-head board), bankroll and
 * transaction reads are private to the session user.
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
import {
  db,
  pool,
  usersTable,
  betsTable,
  transactionsTable,
} from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

function uniqueClerkId() {
  return `authtest_${Date.now()}_${counter++}`;
}

async function createLinkedUser(startingBankroll = 1000) {
  const username = `authtest_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Auth Test User",
      avatarColor: "#22c55e",
      startingBankroll: String(startingBankroll),
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  return { id: row.id, clerkUserId };
}

async function createUnclaimedUser() {
  const username = `authtest_seed_${Date.now()}_${counter++}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Unclaimed Seed",
      avatarColor: "#f59e0b",
      startingBankroll: "1000",
    })
    .returning();
  createdUserIds.push(row.id);
  return { id: row.id };
}

async function createBetFor(user: { id: number; clerkUserId: string }) {
  currentClerkUserId = user.clerkUserId;
  const res = await request(app).post("/api/bets").send({
    sport: "NBA",
    event: "Auth Test Game",
    betType: "moneyline",
    pick: "Team A ML",
    odds: -110,
    stake: 25,
    gameDate: "2026-07-14",
    confidenceScore: 5,
  });
  expect(res.status).toBe(201);
  return res.body as { id: number; userId: number };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(transactionsTable)
      .where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("unauthenticated requests", () => {
  it("rejects all non-health routes with 401", async () => {
    currentClerkUserId = null;
    for (const path of ["/api/users/me", "/api/bets", "/api/parlays", "/api/bankroll", "/api/stats/summary", "/api/workspace"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
    const write = await request(app).post("/api/bets").send({});
    expect(write.status).toBe(401);
  });

  it("keeps /api/healthz public", async () => {
    currentClerkUserId = null;
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  });
});

describe("signed in without a linked profile", () => {
  it("gets 404 from /users/me and 403 on writes", async () => {
    currentClerkUserId = uniqueClerkId();
    const me = await request(app).get("/api/users/me");
    expect(me.status).toBe(404);

    const write = await request(app).post("/api/bets").send({
      sport: "NBA",
      event: "X",
      betType: "moneyline",
      pick: "Y",
      odds: 100,
      stake: 10,
      gameDate: "2026-07-14",
      confidenceScore: 5,
    });
    expect(write.status).toBe(403);
  });

  it("can claim an unclaimed profile; a second account gets 409", async () => {
    const seed = await createUnclaimedUser();

    currentClerkUserId = uniqueClerkId();
    const claim = await request(app).post("/api/users/claim").send({ userId: seed.id });
    expect(claim.status).toBe(200);
    expect(claim.body.id).toBe(seed.id);

    const me = await request(app).get("/api/users/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(seed.id);

    // A different account cannot claim the same profile
    currentClerkUserId = uniqueClerkId();
    const second = await request(app).post("/api/users/claim").send({ userId: seed.id });
    expect(second.status).toBe(409);
  });

  it("can start fresh; repeat claim by the same account is idempotent-ish (409 or same profile)", async () => {
    currentClerkUserId = uniqueClerkId();
    const fresh = await request(app).post("/api/users/claim").send({ displayName: "Fresh Tester" });
    expect(fresh.status).toBe(200);
    createdUserIds.push(fresh.body.id);
    expect(fresh.body.displayName).toBe("Fresh Tester");

    const again = await request(app).post("/api/users/claim").send({ displayName: "Fresh Tester" });
    expect(again.status).toBe(409); // already linked
  });
});

describe("cross-user boundaries", () => {
  it("rejects settling/editing/deleting someone else's bet with 403", async () => {
    const alice = await createLinkedUser();
    const bob = await createLinkedUser();
    const bet = await createBetFor(alice);

    currentClerkUserId = bob.clerkUserId;
    const settle = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won" });
    expect(settle.status).toBe(403);

    const edit = await request(app).patch(`/api/bets/${bet.id}`).send({ stake: 99 });
    expect(edit.status).toBe(403);

    const del = await request(app).delete(`/api/bets/${bet.id}`);
    expect(del.status).toBe(403);
  });

  it("ignores a spoofed userId in the create body — bet lands on the session user", async () => {
    const alice = await createLinkedUser();
    const bob = await createLinkedUser();
    currentClerkUserId = bob.clerkUserId;
    const res = await request(app).post("/api/bets").send({
      userId: alice.id, // spoofed — must be ignored
      sport: "NBA",
      event: "Spoof Game",
      betType: "moneyline",
      pick: "Z",
      odds: 100,
      stake: 10,
      gameDate: "2026-07-14",
      confidenceScore: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(bob.id);
  });

  it("keeps bankroll and transactions private (403 for another user's id)", async () => {
    const alice = await createLinkedUser();
    const bob = await createLinkedUser();
    currentClerkUserId = bob.clerkUserId;

    const bankroll = await request(app).get(`/api/bankroll?userId=${alice.id}`);
    expect(bankroll.status).toBe(403);

    const txs = await request(app).get(`/api/bankroll/transactions?userId=${alice.id}`);
    expect(txs.status).toBe(403);

    // Own bankroll still works
    const own = await request(app).get(`/api/bankroll?userId=${bob.id}`);
    expect(own.status).toBe(200);

    // Spoofed transaction userId is ignored — lands on the session user
    const tx = await request(app)
      .post("/api/bankroll/transactions")
      .send({ userId: alice.id, type: "deposit", amount: 50 });
    expect(tx.status).toBe(201);
    expect(tx.body.userId).toBe(bob.id);
  });
});
