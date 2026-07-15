/**
 * Cross-crew privacy hardening. Proves:
 *  - GET /users/:id/badges: another bettor's badge case 404s unless they
 *    share a crew with the requester; same-crew and own always work
 *  - GET /stats/streaks?userId=: same crew-scoped policy
 *  - GET /users: only crew-visible users are listed, and startingBankroll is
 *    null on every row except the requester's own
 *  - request logging: a bet-creation log line carries method/path/status
 *    only — no stake, no email, no body
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { inArray, eq } from "drizzle-orm";
import pino from "pino";
import pinoHttp from "pino-http";

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
import { httpLogSerializers } from "../lib/logger";
import { db, pool, usersTable, betsTable, crewsTable, crewMembersTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser(displayName: string) {
  const username = `test_priv_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName, avatarColor: "#6366f1", startingBankroll: "1000", clerkUserId })
    .returning();
  createdUserIds.push(row.id);
  return { row, clerkUserId };
}

async function putInOneCrew(userIds: number[]) {
  const [crew] = await db
    .insert(crewsTable)
    .values({
      name: `Priv Test Crew ${Date.now()}_${counter++}`,
      ownerId: userIds[0],
      inviteCode: `PRV${Date.now().toString(36).toUpperCase()}${counter}`.slice(0, 16),
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
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("badges are crew-scoped", () => {
  it("cross-crew badge case is reported as not found; same-crew and own work", async () => {
    const { row: me, clerkUserId } = await createUser("Viewer");
    const { row: mate } = await createUser("Crewmate");
    const { row: stranger } = await createUser("Stranger");
    await putInOneCrew([me.id, mate.id]);
    await putInOneCrew([stranger.id]);
    currentClerkUserId = clerkUserId;

    const own = await request(app).get(`/api/users/${me.id}/badges`);
    expect(own.status).toBe(200);

    const crewmate = await request(app).get(`/api/users/${mate.id}/badges`);
    expect(crewmate.status).toBe(200);

    const crossCrew = await request(app).get(`/api/users/${stranger.id}/badges`);
    expect(crossCrew.status).toBe(404);
  });

  it("a crewless viewer can open only their own badge case", async () => {
    const { row: me, clerkUserId } = await createUser("Loner");
    const { row: other } = await createUser("Other Real User");
    currentClerkUserId = clerkUserId;

    expect((await request(app).get(`/api/users/${me.id}/badges`)).status).toBe(200);
    expect((await request(app).get(`/api/users/${other.id}/badges`)).status).toBe(404);
  });
});

describe("streaks are crew-scoped", () => {
  it("cross-crew streaks 404; same-crew and own work", async () => {
    const { row: me, clerkUserId } = await createUser("Viewer");
    const { row: mate } = await createUser("Crewmate");
    const { row: stranger } = await createUser("Stranger");
    await putInOneCrew([me.id, mate.id]);
    await putInOneCrew([stranger.id]);
    currentClerkUserId = clerkUserId;

    expect((await request(app).get("/api/stats/streaks")).status).toBe(200);
    expect((await request(app).get(`/api/stats/streaks?userId=${mate.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/stats/streaks?userId=${stranger.id}`)).status).toBe(404);
  });
});

describe("by-userId stats endpoints are crew-scoped", () => {
  const ENDPOINTS = ["/api/stats/summary", "/api/stats/by-sport", "/api/stats/confidence-analysis", "/api/stats/insights"];

  it("cross-crew stats 404; same-crew and own work", async () => {
    const { row: me, clerkUserId } = await createUser("Viewer");
    const { row: mate } = await createUser("Crewmate");
    const { row: stranger } = await createUser("Stranger");
    await putInOneCrew([me.id, mate.id]);
    await putInOneCrew([stranger.id]);
    // /stats/insights sits behind the Pro gate (402 for free accounts before
    // any data is touched); founders pass it, so the scope check is reachable.
    await db.update(usersTable).set({ isFounder: true }).where(eq(usersTable.id, me.id));
    currentClerkUserId = clerkUserId;

    for (const path of ENDPOINTS) {
      expect((await request(app).get(`${path}?userId=${me.id}`)).status, `${path} own`).toBe(200);
      expect((await request(app).get(`${path}?userId=${mate.id}`)).status, `${path} same-crew`).toBe(200);
      expect((await request(app).get(`${path}?userId=${stranger.id}`)).status, `${path} cross-crew`).toBe(404);
    }
  });
});

describe("user list privacy", () => {
  it("lists only crew-visible users and hides everyone else's starting bankroll", async () => {
    const { row: me, clerkUserId } = await createUser("Viewer");
    const { row: mate } = await createUser("Crewmate");
    const { row: stranger } = await createUser("Stranger");
    await putInOneCrew([me.id, mate.id]);
    await putInOneCrew([stranger.id]);
    currentClerkUserId = clerkUserId;

    const res = await request(app).get("/api/users");
    expect(res.status).toBe(200);
    const ids = res.body.map((u: { id: number }) => u.id);
    expect(ids).toContain(me.id);
    expect(ids).toContain(mate.id);
    expect(ids).not.toContain(stranger.id);

    const mine = res.body.find((u: { id: number }) => u.id === me.id);
    const theirs = res.body.find((u: { id: number }) => u.id === mate.id);
    expect(mine.startingBankroll).toBe(1000);
    expect(theirs.startingBankroll).toBeNull();
  });

  it("a crewless viewer sees only themselves", async () => {
    const { row: me, clerkUserId } = await createUser("Loner");
    await createUser("Other Real User");
    currentClerkUserId = clerkUserId;

    const res = await request(app).get("/api/users");
    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: number }) => u.id)).toEqual([me.id]);
  });
});

describe("request log hygiene", () => {
  it("a captured bet-creation log line has method/path/status but no stake or email", async () => {
    // Same serializers the real app installs, wired to an in-memory sink so
    // the emitted line can be inspected.
    const lines: string[] = [];
    const sink = pino(
      {},
      {
        write(chunk: string) {
          lines.push(chunk);
        },
      },
    );
    const testApp = express();
    testApp.use(pinoHttp({ logger: sink, serializers: httpLogSerializers }));
    testApp.use(express.json());
    testApp.post("/api/bets", (_req, res) => {
      res.status(201).json({ ok: true });
    });

    await request(testApp)
      .post("/api/bets?promo=welcome")
      .send({ stake: 250, pick: "Chiefs ML", email: "bettor@example.com" });

    expect(lines.length).toBeGreaterThan(0);
    const line = lines.find((l) => l.includes("/api/bets")) ?? "";
    const parsed = JSON.parse(line);
    expect(parsed.req.method).toBe("POST");
    expect(parsed.req.url).toBe("/api/bets");
    expect(parsed.res.statusCode).toBe(201);
    expect(typeof parsed.responseTime).toBe("number");
    // Nothing from the body or query string leaks into the line. (The
    // responseTime number can coincidentally contain any digits, so numeric
    // checks go through the serialized req object, not the raw line.)
    expect(Object.keys(parsed.req).sort()).toEqual(["id", "method", "url"]);
    expect(Object.keys(parsed.res).sort()).toEqual(["statusCode"]);
    expect(line).not.toContain("bettor@example.com");
    expect(line).not.toContain("Chiefs");
    expect(line).not.toContain("promo");
    expect(JSON.stringify(parsed.req)).not.toContain("250");
  });
});
