/**
 * Integration tests for ownership enforcement on bets and parlays.
 * User B must get a 403 when trying to delete, edit, or settle user A's
 * bet or parlay — and the row (plus the ledger) must remain unchanged.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
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

import app from "../app";
import {
  db,
  pool,
  usersTable,
  betsTable,
  parlaysTable,
  parlayLegsTable,
  transactionsTable,
} from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(startingBankroll = 1000) {
  const username = `own_test_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Ownership Test User",
      avatarColor: "#6366f1",
      startingBankroll: String(startingBankroll),
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  currentClerkUserId = clerkUserId;
  return { id: row.id, clerkUserId };
}

function actAs(user: { clerkUserId: string }) {
  currentClerkUserId = user.clerkUserId;
}

async function createBet() {
  const res = await request(app)
    .post("/api/bets")
    .send({
      sport: "NBA",
      event: "Ownership Test Game",
      betType: "moneyline",
      pick: "Team A ML",
      odds: 150,
      stake: 100,
      gameDate: "2026-07-14",
      confidenceScore: 7,
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; stake: number };
}

async function createParlay() {
  const res = await request(app)
    .post("/api/parlays")
    .send({
      name: "Ownership Test Parlay",
      stake: 50,
      confidenceScore: 6,
      legs: [
        { sport: "NBA", event: "Game 1", betType: "moneyline", pick: "Team A", odds: 100, gameDate: "2026-07-14" },
        { sport: "NFL", event: "Game 2", betType: "spread", pick: "Team B -3.5", odds: 100, gameDate: "2026-07-14" },
      ],
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; legs: Array<{ id: number }> };
}

async function fetchBetRow(id: number) {
  const [row] = await db.select().from(betsTable).where(eq(betsTable.id, id));
  return row;
}

async function fetchParlayRow(id: number) {
  const [row] = await db.select().from(parlaysTable).where(eq(parlaysTable.id, id));
  return row;
}

async function txCountFor(userId: number) {
  const txs = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId));
  return txs.length;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db.delete(parlayLegsTable).where(
        inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id)),
      );
    }
    await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("bet ownership enforcement", () => {
  it("user B cannot DELETE user A's bet — 403 and the bet remains", async () => {
    const userA = await createUser();
    const bet = await createBet();
    await createUser(); // user B, now the active identity

    const res = await request(app).delete(`/api/bets/${bet.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only delete your own bets");

    const row = await fetchBetRow(bet.id);
    expect(row).toBeDefined();
    expect(row.userId).toBe(userA.id);
    expect(await txCountFor(userA.id)).toBe(0);
  });

  it("user B cannot PATCH user A's bet — 403 and no fields change", async () => {
    await createUser();
    const bet = await createBet();
    const before = await fetchBetRow(bet.id);
    await createUser(); // user B

    const res = await request(app)
      .patch(`/api/bets/${bet.id}`)
      .send({ pick: "Hijacked pick", stake: 999 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only edit your own bets");

    const after = await fetchBetRow(bet.id);
    expect(after.pick).toBe(before.pick);
    expect(after.stake).toBe(before.stake);
    expect(after.potentialPayout).toBe(before.potentialPayout);
  });

  it("user B cannot settle user A's bet — 403, bet stays pending, no ledger entry", async () => {
    const userA = await createUser();
    const bet = await createBet();
    await createUser(); // user B

    const res = await request(app)
      .patch(`/api/bets/${bet.id}/settle`)
      .send({ status: "won" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only settle your own bets");

    const row = await fetchBetRow(bet.id);
    expect(row.status).toBe("pending");
    expect(row.settledAt).toBeNull();
    expect(row.actualPayout).toBeNull();
    expect(await txCountFor(userA.id)).toBe(0);
  });

  it("the owner can still edit and delete their own bet (403 is not blanket)", async () => {
    const userA = await createUser();
    const bet = await createBet();
    await createUser(); // user B
    actAs(userA);

    const patch = await request(app).patch(`/api/bets/${bet.id}`).send({ pick: "Updated pick" });
    expect(patch.status).toBe(200);
    expect(patch.body.pick).toBe("Updated pick");

    const del = await request(app).delete(`/api/bets/${bet.id}`);
    expect(del.status).toBe(204);
  });
});

describe("parlay ownership enforcement", () => {
  it("user B cannot DELETE user A's parlay — 403, parlay and legs remain", async () => {
    const userA = await createUser();
    const parlay = await createParlay();
    await createUser(); // user B

    const res = await request(app).delete(`/api/parlays/${parlay.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only delete your own parlays");

    const row = await fetchParlayRow(parlay.id);
    expect(row).toBeDefined();
    expect(row.userId).toBe(userA.id);
    const legs = await db
      .select()
      .from(parlayLegsTable)
      .where(eq(parlayLegsTable.parlayId, parlay.id));
    expect(legs.length).toBe(2);
  });

  it("user B cannot PATCH user A's parlay — 403 and no fields change", async () => {
    await createUser();
    const parlay = await createParlay();
    const before = await fetchParlayRow(parlay.id);
    await createUser(); // user B

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}`)
      .send({ name: "Hijacked parlay", stake: 999 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only edit your own parlays");

    const after = await fetchParlayRow(parlay.id);
    expect(after.name).toBe(before.name);
    expect(after.stake).toBe(before.stake);
  });

  it("user B cannot settle user A's parlay — 403, parlay stays pending, no ledger entry", async () => {
    const userA = await createUser();
    const parlay = await createParlay();
    await createUser(); // user B

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({ status: "won" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only settle your own parlays");

    const row = await fetchParlayRow(parlay.id);
    expect(row.status).toBe("pending");
    expect(row.settledAt).toBeNull();
    expect(row.actualPayout).toBeNull();
    expect(await txCountFor(userA.id)).toBe(0);
  });

  it("user B cannot settle user A's parlay even when passing that parlay's leg IDs", async () => {
    await createUser();
    const parlay = await createParlay();
    await createUser(); // user B

    const res = await request(app)
      .patch(`/api/parlays/${parlay.id}/settle`)
      .send({
        status: "lost",
        legResults: [{ legId: parlay.legs[0].id, status: "lost" }],
      });
    expect(res.status).toBe(403);

    const legs = await db
      .select()
      .from(parlayLegsTable)
      .where(eq(parlayLegsTable.parlayId, parlay.id));
    for (const leg of legs) {
      expect(leg.status).toBe("pending");
    }
  });

  it("the owner can still edit and delete their own parlay (403 is not blanket)", async () => {
    const userA = await createUser();
    const parlay = await createParlay();
    await createUser(); // user B
    actAs(userA);

    const patch = await request(app)
      .patch(`/api/parlays/${parlay.id}`)
      .send({ name: "Renamed parlay" });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe("Renamed parlay");

    const del = await request(app).delete(`/api/parlays/${parlay.id}`);
    expect(del.status).toBe(204);
  });
});
