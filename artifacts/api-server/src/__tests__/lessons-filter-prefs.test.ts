/**
 * #167: Lessons-page filters saved on the profile (cross-device sync), and
 * #189: the leak-profile roiBand respects the benchmarks opt-out.
 *   - PATCH /users/:id accepts the three lessons filter fields
 *   - the saved view comes back on /users/me (what other devices read)
 *   - invalid enum values are rejected with 400
 *   - roiBand is null for a bettor who opted out of benchmarks
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

const createdUserIds: number[] = [];
let counter = 0;

async function createLinkedUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const username = `lessonsprefs_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId, ...overrides })
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

describe("Lessons filter preferences", () => {
  it("saves the filters and returns them on /users/me", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;

    const patch = await request(app)
      .patch(`/api/users/${user.id}`)
      .set("x-test-clerk-id", clerkUserId)
      .send({ lessonsResultFilter: "lost", lessonsQualityFilter: "flawed", lessonsReasonFilter: "emotional" });
    expect(patch.status).toBe(200);
    expect(patch.body.lessonsResultFilter).toBe("lost");
    expect(patch.body.lessonsQualityFilter).toBe("flawed");
    expect(patch.body.lessonsReasonFilter).toBe("emotional");

    const me = await request(app).get("/api/users/me").set("x-test-clerk-id", clerkUserId);
    expect(me.status).toBe(200);
    expect(me.body.lessonsResultFilter).toBe("lost");
    expect(me.body.lessonsQualityFilter).toBe("flawed");
    expect(me.body.lessonsReasonFilter).toBe("emotional");
  });

  it("defaults to 'all' for a fresh profile", async () => {
    const { clerkUserId } = await createLinkedUser();
    const me = await request(app).get("/api/users/me").set("x-test-clerk-id", clerkUserId);
    expect(me.status).toBe(200);
    expect(me.body.lessonsResultFilter).toBe("all");
    expect(me.body.lessonsQualityFilter).toBe("all");
    expect(me.body.lessonsReasonFilter).toBe("all");
  });

  it("rejects out-of-enum filter values", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    const bad = await request(app)
      .patch(`/api/users/${user.id}`)
      .set("x-test-clerk-id", clerkUserId)
      .send({ lessonsResultFilter: "banana" });
    expect(bad.status).toBe(400);
  });
});

describe("Leak profile roiBand gating (#189)", () => {
  it("is null for a bettor who opted out of benchmarks", async () => {
    const { clerkUserId } = await createLinkedUser({
      includedInBenchmarks: false,
      proUntil: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await request(app).get("/api/stats/leak-profile").set("x-test-clerk-id", clerkUserId);
    expect(res.status).toBe(200);
    expect(res.body.roiBand).toBeNull();
  });
});
