/**
 * GET /api/bankroll/transactions — offset paging:
 *   - pages are non-overlapping and in newest-first order
 *   - offset walks the full ledger; past the end returns an empty page
 *   - offset defaults to 0 when omitted (back-compat)
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
import { db, pool, usersTable, transactionsTable } from "@workspace/db";

const createdUserIds: number[] = [];

async function createLinkedUser() {
  const username = `txpage_${Date.now()}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId, startingBankroll: "1000" })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("GET /api/bankroll/transactions offset paging", () => {
  it("pages through the ledger without overlap or gaps", async () => {
    const { user, clerkUserId } = await createLinkedUser();

    // Seed 7 ledger rows with a running balance chain.
    let balance = 1000;
    for (let i = 0; i < 7; i++) {
      balance += 10;
      await db.insert(transactionsTable).values({
        userId: user.id,
        type: "deposit",
        amount: "10",
        balanceAfter: String(balance),
        note: `seed ${i}`,
      });
    }

    const get = (qs: string) =>
      request(app).get(`/api/bankroll/transactions?${qs}`).set("x-test-clerk-id", clerkUserId);

    const page1 = await get("limit=3&offset=0");
    const page2 = await get("limit=3&offset=3");
    const page3 = await get("limit=3&offset=6");
    const past = await get("limit=3&offset=100");

    expect(page1.status).toBe(200);
    expect(page1.body).toHaveLength(3);
    expect(page2.body).toHaveLength(3);
    expect(page3.body).toHaveLength(1);
    expect(past.body).toHaveLength(0);

    const all = [...page1.body, ...page2.body, ...page3.body];
    const ids = all.map((t: { id: number }) => t.id);
    expect(new Set(ids).size).toBe(7); // no overlap across pages

    // Newest-first across page boundaries (ids ascend with insertion order).
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });

  it("defaults offset to 0 when omitted", async () => {
    // Reuse the seeded user from the previous test.
    const [user] = await db.select().from(usersTable).where(inArray(usersTable.id, createdUserIds));
    const res = await request(app)
      .get("/api/bankroll/transactions?limit=2")
      .set("x-test-clerk-id", user.clerkUserId!);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].note).toBe("seed 6"); // newest row first
  });
});
