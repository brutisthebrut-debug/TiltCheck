/**
 * POST /users/me/recap-seen — the server-stored "seen recap week" flag:
 *   - unauthenticated → 401, signed-in-but-unlinked → 404
 *   - marking records the server-computed last completed week (UTC Monday)
 *   - the flag comes back on /users/me so every device sees the same state
 *   - re-marking is idempotent
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
import { db, pool, usersTable } from "@workspace/db";
import { dayOf, lastCompletedWeekStart } from "../lib/recap";

const createdUserIds: number[] = [];
let counter = 0;

async function createLinkedUser() {
  const username = `recapseen_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("POST /users/me/recap-seen", () => {
  it("rejects unauthenticated requests", async () => {
    currentClerkUserId = null;
    const res = await request(app).post("/api/users/me/recap-seen");
    expect(res.status).toBe(401);
  });

  it("404s for a signed-in account with no linked profile", async () => {
    currentClerkUserId = `unlinked_${Date.now()}`;
    const res = await request(app).post("/api/users/me/recap-seen");
    expect(res.status).toBe(404);
  });

  it("records the server-computed last completed week and surfaces it on /users/me", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;

    // Fresh profile: never seen
    const before = await request(app).get("/api/users/me");
    expect(before.status).toBe(200);
    expect(before.body.recapSeenWeek ?? null).toBeNull();

    const expectedWeek = lastCompletedWeekStart(dayOf(new Date()));
    const res = await request(app).post("/api/users/me/recap-seen");
    expect(res.status).toBe(200);
    expect(res.body.recapSeenWeek).toBe(expectedWeek);
    // Monday, YYYY-MM-DD
    expect(res.body.recapSeenWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${res.body.recapSeenWeek}T00:00:00Z`).getUTCDay()).toBe(1);

    // Any other device fetching the profile sees the same flag
    const after = await request(app).get("/api/users/me");
    expect(after.body.recapSeenWeek).toBe(expectedWeek);

    // Idempotent
    const again = await request(app).post("/api/users/me/recap-seen");
    expect(again.status).toBe(200);
    expect(again.body.recapSeenWeek).toBe(expectedWeek);
  });

  it("keeps the flag per user", async () => {
    const a = await createLinkedUser();
    const b = await createLinkedUser();

    const res = await request(app)
      .post("/api/users/me/recap-seen")
      .set("x-test-clerk-id", a.clerkUserId);
    expect(res.status).toBe(200);

    const other = await request(app)
      .get("/api/users/me")
      .set("x-test-clerk-id", b.clerkUserId);
    expect(other.status).toBe(200);
    expect(other.body.recapSeenWeek ?? null).toBeNull();
  });
});
